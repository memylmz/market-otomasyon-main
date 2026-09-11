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

import { simdi } from '@market/shared';
import type { Vt } from '../db/surucu.js';
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
      isaretle(vt, talimat.id, null, 'Talimat gövdesi okunamadı.');
      basarisiz++;
      continue;
    }

    // Nakit ödemeli fatura açık çekmece ister; kasa kapalıyken talimat bekler.
    if (talimat.tip === 'OLUSTUR' && Number(govde.odenen_tutar ?? 0) > 0 && govde.odeme_tipi === 'NAKIT' && !aktor.kasaOturumId) {
      continue;
    }

    try {
      const faturaId = uygula(baglam, aktor, talimat, govde);
      vt.hazirla(
        'UPDATE alis_talimatlari SET uygulandi_mi = 1, sonuc_fatura_id = ?, hata = NULL, updated_at = ? WHERE id = ?',
      ).calistir(faturaId, simdi(), talimat.id);
      uygulanan++;
      baglam.kayit.bilgi('Panelden gelen alış talimatı uygulandı', { talimat_id: talimat.id, tip: talimat.tip });
    } catch (hata) {
      const mesaj = hata instanceof Error ? hata.message : String(hata);
      isaretle(vt, talimat.id, null, mesaj);
      basarisiz++;
      baglam.kayit.uyari('Panelden gelen alış talimatı uygulanamadı', { talimat_id: talimat.id, mesaj });
    }
  }

  return { uygulanan, basarisiz };
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
