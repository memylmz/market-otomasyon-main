/**
 * Panelden gelen cari talimatlarını uygular (§10.7).
 *
 * NEDEN TALİMAT: `cari_hareketler` değiştirilemez bir defterdir ve tek
 * yazıcısı kasadır. Bulut kendi başına hareket üretirse kasa ondan habersiz
 * kalır; aynı müşterinin borcu iki yerde farklı görünür. Panel yalnız "şu
 * hesabın açılışı şudur", "bakiyesi şu olmalı", "şu tahsilat iptal" der —
 * hareketi kasa kendi servisleriyle üretir. Yani panelden yapılan düzeltme,
 * kasadan yapılanla birebir aynı yoldan geçer: aynı doğrulama, aynı denetim
 * kaydı, aynı ters kayıt mantığı.
 *
 * NEDEN HEMEN UYGULANMAZ: nakit bir tahsilatın iptali KASA OTURUMU ister —
 * para fiziksel olarak çekmeceden geri çıkar. Senkron kasa kapalıyken de
 * çalıştığı için talimat yerelde bekletilir ve koşullar oluşunca işlenir.
 */

import { simdi } from '@market/shared';
import type { Vt } from '../db/surucu.js';
import { bakiyeOku } from '../depo/cari.js';
import { acilisBakiyesi, bakiyeDuzelt, tahsilatIptal } from './cari-servis.js';
import { yetkisiVarMi, type Aktor, type Baglam } from './baglam.js';

export interface CariTalimati {
  id: string;
  cari_id: string;
  tip: string;
  tutar: number;
  hedef_hareket_id: string | null;
  neden: string;
  hedef_cihaz_id: string;
  /** TAHSILAT_IPTAL'de paranın geri dönüş yolu; boşsa orijinal yol. */
  para_yolu?: 'NAKIT' | 'KART' | null;
}

/** Pull'da gelen talimatı yerele yazar. Aynı id tekrar inerse üzerine yazılmaz. */
export function cariTalimatiniSakla(vt: Vt, veri: Record<string, unknown>, zaman = simdi()): void {
  const id = String(veri.id ?? '');
  if (!id) return;
  vt.hazirla(
    `INSERT INTO cari_talimatlari (id, cari_id, tip, tutar, hedef_hareket_id, neden, hedef_cihaz_id,
                                   kullanici_id, created_at, updated_at, para_yolu)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).calistir(
    id,
    String(veri.cari_id ?? ''),
    String(veri.tip ?? 'DUZELTME'),
    Number(veri.tutar ?? 0),
    (veri.hedef_hareket_id as string | null) ?? null,
    String(veri.neden ?? 'Panelden düzeltme'),
    String(veri.hedef_cihaz_id ?? ''),
    (veri.kullanici_id as string | null) ?? null,
    String(veri.created_at ?? zaman),
    zaman,
    veri.para_yolu === 'NAKIT' || veri.para_yolu === 'KART' ? veri.para_yolu : null,
  );
}

export interface IslemSonucu {
  uygulanan: number;
  basarisiz: number;
}

/**
 * Bekleyen talimatları uygular.
 *
 * ERTELEME İLE HATA AYRIMI ÖNEMLİDİR. Yetkisi olmayan kasiyer oturumdayken ya
 * da nakit iptali için kasa kapalıyken talimat SESSİZCE BEKLER — bu bir hata
 * değil, henüz sırası gelmemiş bir iştir; `hata` yazılırsa panelde kırmızı
 * görünür ve kullanıcı olmayan bir sorunu kovalar. Gerçek hata (hesap
 * bulunamadı, tahsilat zaten iptal edilmiş) ise kaydedilir ve görünür kalır.
 */
export function bekleyenCariTalimatlariniIsle(baglam: Baglam, aktor: Aktor): IslemSonucu {
  const { vt, cihazId } = baglam;
  const bekleyenler = vt
    .hazirla(
      `SELECT id, cari_id, tip, tutar, hedef_hareket_id, neden, hedef_cihaz_id, para_yolu
       FROM cari_talimatlari WHERE uygulandi_mi = 0 ORDER BY created_at`,
    )
    .tumu<CariTalimati>();

  let uygulanan = 0;
  let basarisiz = 0;

  for (const talimat of bekleyenler) {
    // Talimat BU kasaya yazılmışsa uygulanır; iki kasa uygularsa düzeltme iki kez işlenir.
    if (talimat.hedef_cihaz_id && talimat.hedef_cihaz_id !== cihazId) continue;
    if (!uygulanabilirMi(baglam, aktor, talimat)) continue;

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
      const hareketId = vt.islem(() => {
        const id = uygula(baglam, aktor, talimat);
        vt.hazirla(
          'UPDATE cari_talimatlari SET uygulandi_mi = 1, sonuc_hareket_id = ?, hata = NULL, updated_at = ? WHERE id = ?',
        ).calistir(id, simdi(), talimat.id);
        return id;
      });
      uygulanan++;
      baglam.kayit.bilgi('Panelden gelen cari talimatı uygulandı', {
        talimat_id: talimat.id,
        tip: talimat.tip,
        hareket_id: hareketId,
      });
    } catch (hata) {
      const mesaj = hata instanceof Error ? hata.message : String(hata);
      vt.hazirla('UPDATE cari_talimatlari SET hata = ?, updated_at = ? WHERE id = ?').calistir(mesaj, simdi(), talimat.id);
      basarisiz++;
      baglam.kayit.uyari('Panelden gelen cari talimatı uygulanamadı', { talimat_id: talimat.id, mesaj });
    }
  }

  return { uygulanan, basarisiz };
}

/** Koşullar oluşmadıysa talimat hata değil, ERTELEME sayılır. */
function uygulanabilirMi(baglam: Baglam, aktor: Aktor, talimat: CariTalimati): boolean {
  if (talimat.tip === 'TAHSILAT_IPTAL') {
    if (!yetkisiVarMi(aktor, 'cari.tahsilat')) return false;
    /*
     * Para NAKİT dönecekse ters kayıt açık bir çekmece ister; kasa kapalıyken
     * talimat bekler. Yol seçilmemişse orijinal ödemenin yolu geçerlidir —
     * mal kabul ödemesinde kasa hareketi faturaya bağlı olduğu için ekstre
     * sorgusundaki aynı kuralla bakılır.
     */
    const orijinalNakit = baglam.vt
      .hazirla(
        `SELECT 1 AS v FROM cari_hareketler h
          WHERE h.id = ? AND (
            EXISTS (SELECT 1 FROM kasa_hareketleri k WHERE k.belge_id = h.id)
            OR (h.belge_tipi = 'ALIS_ODEME' AND EXISTS (
              SELECT 1 FROM kasa_hareketleri k WHERE k.belge_id = h.belge_id AND k.tip = 'ODEME')))`,
      )
      .tek<{ v: number }>(talimat.hedef_hareket_id ?? '');
    const yol = talimat.para_yolu ?? (orijinalNakit ? 'NAKIT' : 'KART');
    return yol !== 'NAKIT' || Boolean(aktor.kasaOturumId);
  }
  return yetkisiVarMi(aktor, 'cari.duzenle');
}

function uygula(baglam: Baglam, aktor: Aktor, talimat: CariTalimati): string {
  switch (talimat.tip) {
    case 'ACILIS':
      return acilisBakiyesi(baglam, aktor, talimat.cari_id, talimat.tutar, talimat.neden);

    case 'TAHSILAT_IPTAL':
      if (!talimat.hedef_hareket_id) throw new Error('İptal edilecek hareket belirtilmemiş.');
      tahsilatIptal(baglam, aktor, talimat.hedef_hareket_id, talimat.neden, talimat.para_yolu ?? undefined);
      return talimat.hedef_hareket_id;

    default: {
      /*
       * `tutar` FARK DEĞİL, olması istenen HEDEF BAKİYEDİR — farkı burada,
       * kasanın kendi güncel bakiyesine göre hesaplarız. Panel farkı kendi
       * hesaplasaydı, senkron beklerken düşen bir tahsilat tabanı kaydırır ve
       * sonuç kullanıcının yazdığı rakam olmazdı (§11.5'teki stok kuralı).
       */
      const fark = talimat.tutar - bakiyeOku(baglam.vt, talimat.cari_id);
      // Bakiye zaten hedefteyse yazacak bir şey yok; boş bir DUZELTME kaydı
      // defteri gereksiz şişirir.
      if (fark === 0) return '';
      return bakiyeDuzelt(baglam, aktor, talimat.cari_id, fark, talimat.neden);
    }
  }
}
