/**
 * Panelden gelen alış faturası talimatlarını uygular (§11.8).
 *
 * NEDEN TALİMAT: fatura kaydedildiğinde stok ARTAR ve tedarikçiye cari BORÇ
 * doğar. İki defterin de tek yazıcısı kasadır; bulut kendi başına hareket
 * üretirse kasa ondan habersiz kalır ve aynı stok iki yerde farklı görünür.
 * Panel yalnız "şu tedarikçiden şu ürünleri şu fiyata aldık" der — belgeyi ve
 * hareketleri kasa kendi `malKabulOnayla` servisiyle üretir. Yani panelden
 * girilen fatura, kasadan girilenle birebir aynı yoldan geçer.
 *
 * NEDEN HEMEN UYGULANMAZ: nakit ödenen bir fatura KASA OTURUMU ister (para
 * çekmeceden çıkar). Senkron kasa kapalıyken de çalıştığı için talimat yerelde
 * bekletilir ve koşullar oluşunca işlenir.
 */

import { simdi, uuid } from '@market/shared';
import type { Vt } from '../db/surucu.js';
import { olayYaz } from '../depo/senkron.js';
import { alisFaturasiGuncelle, alisFaturasiIptal, malKabulOnayla } from './stok-servis.js';
import { yetkisiVarMi, type Aktor, type Baglam } from './baglam.js';

export interface AlisTalimati {
  id: string;
  tip: string;
  fatura_id: string | null;
  veri: string;
  hedef_cihaz_id: string;
}

/** Pull'da gelen talimatı yerele yazar. Aynı id tekrar inerse üzerine yazılmaz. */
export function alisTalimatiniSakla(vt: Vt, veri: Record<string, unknown>, zaman = simdi()): void {
  const id = String(veri.id ?? '');
  if (!id) return;
  vt.hazirla(
    `INSERT INTO alis_talimatlari (id, tip, fatura_id, veri, hedef_cihaz_id, kullanici_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).calistir(
    id,
    String(veri.tip ?? 'OLUSTUR'),
    (veri.fatura_id as string | null) ?? null,
    typeof veri.veri === 'string' ? veri.veri : JSON.stringify(veri.veri ?? {}),
    String(veri.hedef_cihaz_id ?? ''),
    (veri.kullanici_id as string | null) ?? null,
    String(veri.created_at ?? zaman),
    zaman,
  );
}

export interface IslemSonucu {
  uygulanan: number;
  basarisiz: number;
}

/**
 * Bekleyen talimatları uygular.
 *
 * ERTELEME İLE HATA AYRIMI: yetkisi olmayan kasiyer oturumdayken ya da nakit
 * ödemeli fatura için kasa kapalıyken talimat SESSİZCE BEKLER — bu bir arıza
 * değil, henüz sırası gelmemiş bir iştir. Gerçek hata (ürün bulunamadı, fatura
 * zaten iptal edilmiş) kaydedilir ve panelde görünür kalır.
 */
export function bekleyenAlisTalimatlariniIsle(baglam: Baglam, aktor: Aktor): IslemSonucu {
  const { vt, cihazId } = baglam;
  const bekleyenler = vt
    .hazirla(
      `SELECT id, tip, fatura_id, veri, hedef_cihaz_id
       FROM alis_talimatlari WHERE uygulandi_mi = 0 ORDER BY created_at`,
    )
    .tumu<AlisTalimati>();

  let uygulanan = 0;
  let basarisiz = 0;

  for (const talimat of bekleyenler) {
    // Talimat BU kasaya yazılmışsa uygulanır; iki kasa uygularsa fatura iki kez işlenir.
    if (talimat.hedef_cihaz_id && talimat.hedef_cihaz_id !== cihazId) continue;
    if (!yetkisiVarMi(aktor, 'stok.giris')) continue;

    let govde: Record<string, unknown>;
    try {
      govde = JSON.parse(talimat.veri) as Record<string, unknown>;
    } catch {
      const mesaj = 'Talimat gövdesi okunamadı.';
      vt.islem(() => {
        isaretle(vt, talimat.id, null, mesaj);
        sonucuBildir(vt, cihazId, talimat.id, null, mesaj);
      });
      basarisiz++;
      continue;
    }

    // Nakit ödemeli fatura açık çekmece ister; kasa kapalıyken talimat bekler.
    if (talimat.tip === 'OLUSTUR' && Number(govde.odenen_tutar ?? 0) > 0 && govde.odeme_tipi === 'NAKIT' && !aktor.kasaOturumId) {
      continue;
    }

    try {
      /*
       * UYGULAMA VE "UYGULANDI" İŞARETİ TEK İŞLEMDE.
       *
       * Eskiden ikisi ayrı yazmaydı: talimat uygulanıyor, ardından ayrı bir
       * UPDATE ile işaretleniyordu. Arada elektrik kesilirse işlem yapılmış
       * ama talimat "bekliyor" kalıyor ve bir sonraki senkronda TEKRAR
       * uygulanıyordu. Deneyle doğrulandı: alış faturasında stok 10→20 adet,
       * tedarikçi borcu 120→240 TL, fatura sayısı 1→2 oldu; hiçbir koruma
       * devreye girmedi.
       *
       * Sürücü iç içe işlemi SAVEPOINT ile desteklediği için, içeride kendi
       * `vt.islem`ini açan servisler bundan etkilenmez.
       */
      const faturaId = vt.islem(() => {
        const id = uygula(baglam, aktor, talimat, govde);
        const zaman = simdi();
        vt.hazirla(
          'UPDATE alis_talimatlari SET uygulandi_mi = 1, sonuc_fatura_id = ?, hata = NULL, updated_at = ? WHERE id = ?',
        ).calistir(id, zaman, talimat.id);
        // Sonuç buluta da GİDER: yoksa talimat orada sonsuza kadar "bekliyor"
        // kalır ve panel o faturayı bir daha açmaz. Olay aynı işlemde yazılır
        // ki uygulama ile bildirim birbirinden ayrı düşmesin.
        sonucuBildir(vt, cihazId, talimat.id, id, null, zaman);
        return id;
      });
      uygulanan++;
      // Sonuç kimliği de loglanır: "bu talimat hangi faturayı üretti" sorusu
      // sonradan yalnız logdan cevaplanabiliyor.
      baglam.kayit.bilgi('Panelden gelen alış talimatı uygulandı', {
        talimat_id: talimat.id,
        tip: talimat.tip,
        fatura_id: faturaId,
      });
    } catch (hata) {
      const mesaj = hata instanceof Error ? hata.message : String(hata);
      vt.islem(() => {
        isaretle(vt, talimat.id, null, mesaj);
        // Hata da bildirilir: panelde "bekliyor" yazıp duran talimatın neden
        // ilerlemediği ancak böyle görülebiliyor.
        sonucuBildir(vt, cihazId, talimat.id, null, mesaj);
      });
      basarisiz++;
      baglam.kayit.uyari('Panelden gelen alış talimatı uygulanamadı', { talimat_id: talimat.id, mesaj });
    }
  }

  return { uygulanan, basarisiz };
}

/**
 * ZATEN UYGULANMIŞ ama sonucu hiç bildirilmemiş talimatları geriye dönük
 * bildirir — tek seferlik telafi.
 *
 * Sonuç bildirimi sonradan eklendi. O ana kadar uygulanmış talimatlar bulutta
 * sonsuza kadar "bekliyor" kaldı ve panel o faturaların düzenle/iptal
 * düğmelerini bir daha açmadı. Bu kilidi kendiliğinden açmanın tek doğru yolu
 * budur: hangi talimatın uygulandığını YALNIZ KASA bilir, bulutta o bilgi hiç
 * yok. Bulut üzerinde elle tahmin yürütmek yanlış faturayı kapatabilirdi.
 *
 * `sonuc_bildirildi_mi` işareti sayesinde bir kez çalışır; sonraki açılışlarda
 * sorgu boş döner.
 */
export function bildirilmemisSonuclariGonder(baglam: Baglam): number {
  const { vt, cihazId } = baglam;
  const eksikler = vt
    .hazirla(
      `SELECT id, sonuc_fatura_id FROM alis_talimatlari
        WHERE uygulandi_mi = 1 AND sonuc_bildirildi_mi = 0`,
    )
    .tumu<{ id: string; sonuc_fatura_id: string | null }>();
  if (eksikler.length === 0) return 0;

  vt.islem(() => {
    for (const talimat of eksikler) {
      sonucuBildir(vt, cihazId, talimat.id, talimat.sonuc_fatura_id, null);
    }
  });
  baglam.kayit.bilgi('Bildirilmemiş talimat sonuçları geriye dönük gönderildi', { adet: eksikler.length });
  return eksikler.length;
}

/**
 * Talimatın sonucunu senkron kuyruğuna yazar.
 *
 * Talimat akışı tek yönlüydü: panel niyeti yazıyor, kasa uyguluyor, orada
 * bitiyordu. Bulut sonucu öğrenmediği için satır sonsuza kadar "bekliyor"
 * kalıyor, panel de o faturanın düzenle/iptal düğmelerini bir daha açmıyordu.
 *
 * `varlik` alanı şimdilik hep aynı: cari/iade/stok talimatlarında da aynı
 * defekt var, aynı olay tipiyle kapatılabilsinler diye ayrı tutuldu.
 */
function sonucuBildir(
  vt: Vt,
  cihazId: string,
  talimatId: string,
  faturaId: string | null,
  hata: string | null,
  zaman = simdi(),
): void {
  vt.hazirla('UPDATE alis_talimatlari SET sonuc_bildirildi_mi = 1 WHERE id = ?').calistir(talimatId);
  olayYaz(
    vt,
    {
      id: uuid(),
      olay_tipi: 'TALIMAT_SONUCLANDI',
      entity: 'alis_talimatlari',
      entity_id: talimatId,
      veri: {
        varlik: 'alis_talimatlari',
        talimat_id: talimatId,
        uygulandi_mi: hata === null,
        sonuc_fatura_id: faturaId,
        hata,
        sonuc_zamani: zaman,
      },
      olusturma_zamani: zaman,
    },
    cihazId,
    zaman,
  );
}

function isaretle(vt: Vt, id: string, faturaId: string | null, hata: string | null): void {
  vt.hazirla(
    'UPDATE alis_talimatlari SET hata = ?, sonuc_fatura_id = COALESCE(?, sonuc_fatura_id), updated_at = ? WHERE id = ?',
  ).calistir(hata, faturaId, simdi(), id);
}

function uygula(baglam: Baglam, aktor: Aktor, talimat: AlisTalimati, govde: Record<string, unknown>): string {
  switch (talimat.tip) {
    case 'IPTAL': {
      if (!talimat.fatura_id) throw new Error('İptal edilecek fatura belirtilmemiş.');
      alisFaturasiIptal(baglam, aktor, talimat.fatura_id, String(govde.neden ?? 'Panelden iptal'));
      return talimat.fatura_id;
    }

    case 'GUNCELLE': {
      if (!talimat.fatura_id) throw new Error('Güncellenecek fatura belirtilmemiş.');
      alisFaturasiGuncelle(baglam, aktor, talimat.fatura_id, {
        fatura_no: govde.fatura_no as string | null | undefined,
        vade_tarihi: govde.vade_tarihi as string | null | undefined,
        notlar: govde.notlar as string | null | undefined,
      });
      return talimat.fatura_id;
    }

    default:
      // Doğrulamayı `malKabulOnayla` kendi şemasıyla yapar; panel ile kasa aynı
      // kurala tabi olsun diye girdiyi olduğu gibi geçiriyoruz.
      return malKabulOnayla(baglam, aktor, govde).faturaId;
  }
}
