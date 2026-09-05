/**
 * Yazdırma servisi (§13.2, §20).
 *
 * KRİTİK: Yazdırma **asla** satışı bloke etmez. Fiş basılamazsa satış kesinleşmiş
 * sayılır ve `fis_yazdirildi = 0` kalır; kullanıcı sonradan tekrar yazdırabilir.
 */

import { AYAR, type Kurus } from '@market/shared';
import { ayarBool, ayarMetin, ayarSayi } from '../depo/ayar.js';
import { cariBul, ekstre } from '../depo/cari.js';
import { oturumBul, oturumOzeti } from '../depo/kasa.js';
import { urunBul, urununBarkodlari } from '../depo/katalog.js';
import { fisYazdirildiIsaretle, satisDetayi } from '../depo/satis.js';
import { cariEkstreFisi, gunSonuFisi, satisFisi, urunEtiketi, type IsletmeBilgisi } from '../donanim/fis.js';
import { yaziciOlustur, type YazdirmaSonucu, type YaziciAyari, type YaziciTipiDb } from '../donanim/yazici.js';
import { hatalar } from '@market/shared';
import type { Aktor, Baglam } from './baglam.js';

export function yaziciAyariniOku(baglam: Baglam): YaziciAyari {
  const { vt } = baglam;
  const tipHam = ayarMetin(vt, AYAR.YAZICI_TIPI, 'YOK');
  const gecerliTipler: YaziciTipiDb[] = ['YOK', 'USB', 'AG', 'OTOMATIK', 'DOSYA', 'WINDOWS_PAYLASIM'];
  const tip = (gecerliTipler as string[]).includes(tipHam) ? (tipHam as YaziciTipiDb) : 'YOK';
  return {
    tip,
    hedef: ayarMetin(vt, AYAR.YAZICI_HEDEF, ''),
    usbAdi: ayarMetin(vt, AYAR.YAZICI_USB_ADI, ''),
    satirGenisligi: ayarSayi(vt, AYAR.YAZICI_GENISLIK, 48),
    cekmeceAc: ayarBool(vt, AYAR.CEKMECE_ACIK, true),
  };
}

export function isletmeBilgisiniOku(baglam: Baglam): IsletmeBilgisi {
  const { vt } = baglam;
  return {
    ad: ayarMetin(vt, AYAR.ISLETME_ADI, 'Market'),
    adres: ayarMetin(vt, AYAR.ISLETME_ADRES, '') || null,
    telefon: ayarMetin(vt, AYAR.ISLETME_TELEFON, '') || null,
    vergiNo: ayarMetin(vt, AYAR.ISLETME_VERGI_NO, '') || null,
    altMetin: ayarMetin(vt, AYAR.FIS_ALT_METIN, 'Bizi tercih ettiğiniz için teşekkürler.') || null,
  };
}

/**
 * Satış fişini yazdırır. Başarısız olsa bile **hata fırlatmaz**; sonucu döner ve
 * çağıran (satış ekranı) kullanıcıya "fiş yazdırılamadı, tekrar dene" gösterir.
 */
export async function satisFisiYazdir(
  baglam: Baglam,
  satisId: string,
  secenekler: { kopyaMi?: boolean; cekmeceyiAc?: boolean } = {},
): Promise<YazdirmaSonucu> {
  const detay = satisDetayi(baglam.vt, satisId);
  if (!detay) throw hatalar.bulunamadi('Satış');

  const ayar = yaziciAyariniOku(baglam);
  const yazici = yaziciOlustur(ayar);
  const isletme = isletmeBilgisiniOku(baglam);

  const baytlar = satisFisi(detay, isletme, {
    satirGenisligi: ayar.satirGenisligi,
    kopyaMi: secenekler.kopyaMi ?? false,
    kasiyerAdi: detay.satis.kullanici_adi ?? null,
  });

  let sonuc: YazdirmaSonucu;
  try {
    sonuc = await yazici.yazdir(baytlar);
  } catch (hata) {
    sonuc = { basarili: false, hata: hata instanceof Error ? hata.message : String(hata) };
  }

  if (sonuc.basarili) {
    fisYazdirildiIsaretle(baglam.vt, satisId, true);
    // Çekmece yalnız nakit içeren satışlarda açılır.
    const nakitVar = detay.odemeler.some((o) => o.odeme_tipi === 'NAKIT');
    if ((secenekler.cekmeceyiAc ?? ayar.cekmeceAc) && nakitVar) {
      await yazici.cekmeceyiAc().catch(() => undefined);
    }
  } else {
    baglam.kayit.uyari('Fiş yazdırılamadı — satış etkilenmedi', {
      satis_id: satisId,
      fis_no: detay.satis.fis_no,
      hata: sonuc.hata,
    });
  }
  return sonuc;
}

export async function gunSonuFisiYazdir(baglam: Baglam, aktor: Aktor, oturumId: string): Promise<YazdirmaSonucu> {
  const oturum = oturumBul(baglam.vt, oturumId);
  if (!oturum) throw hatalar.bulunamadi('Kasa oturumu');
  const ayar = yaziciAyariniOku(baglam);
  const baytlar = gunSonuFisi(
    oturumOzeti(baglam.vt, oturumId),
    {
      isletme: isletmeBilgisiniOku(baglam),
      kasiyerAdi: oturum.kullanici_adi ?? aktor.ad,
      acilis: oturum.acilis_zamani,
      kapanis: oturum.kapanis_zamani ?? new Date().toISOString(),
      sayilanNakit: oturum.sayilan_nakit ?? 0,
      beklenenNakit: oturum.beklenen_nakit ?? 0,
      kasaFarki: oturum.kasa_farki ?? 0,
    },
    ayar.satirGenisligi,
  );
  return yaziciOlustur(ayar)
    .yazdir(baytlar)
    .catch((hata) => ({ basarili: false, hata: String(hata) }));
}

export async function cariEkstresiYazdir(
  baglam: Baglam,
  cariId: string,
  baslangic?: string,
  bitis?: string,
): Promise<YazdirmaSonucu> {
  const cari = cariBul(baglam.vt, cariId);
  if (!cari) throw hatalar.bulunamadi('Cari hesap');
  const ayar = yaziciAyariniOku(baglam);
  const baytlar = cariEkstreFisi(
    { ad_unvan: cari.ad_unvan, telefon: cari.telefon, bakiye: cari.bakiye },
    ekstre(baglam.vt, cariId, baslangic, bitis),
    isletmeBilgisiniOku(baglam),
    ayar.satirGenisligi,
  );
  return yaziciOlustur(ayar)
    .yazdir(baytlar)
    .catch((hata) => ({ basarili: false, hata: String(hata) }));
}

export async function etiketYazdir(baglam: Baglam, urunId: string, adet = 1): Promise<YazdirmaSonucu> {
  const urun = urunBul(baglam.vt, urunId);
  if (!urun) throw hatalar.bulunamadi('Ürün');
  const barkodlar = urununBarkodlari(baglam.vt, urunId).filter((b) => b.aktif_mi);
  const ayar = yaziciAyariniOku(baglam);
  const yazici = yaziciOlustur(ayar);

  let son: YazdirmaSonucu = { basarili: true };
  for (let i = 0; i < Math.min(Math.max(1, adet), 100); i++) {
    const baytlar = urunEtiketi(urun, barkodlar[0]?.barkod ?? '', Math.min(ayar.satirGenisligi, 32));
    son = await yazici.yazdir(baytlar).catch((hata) => ({ basarili: false, hata: String(hata) }));
    if (!son.basarili) break;
  }
  return son;
}

export async function yaziciTesti(baglam: Baglam): Promise<YazdirmaSonucu> {
  const ayar = yaziciAyariniOku(baglam);
  return yaziciOlustur(ayar)
    .test()
    .catch((hata) => ({ basarili: false, hata: hata instanceof Error ? hata.message : String(hata) }));
}

export async function cekmeceyiAc(baglam: Baglam, aktor: Aktor): Promise<YazdirmaSonucu> {
  // Çekmeceyi keyfî açmak nakit güvenliği açısından yetki gerektirir.
  if (!aktor.yetkiler.has('kasa.giris_cikis') && !aktor.yetkiler.has('satis.yap')) {
    throw hatalar.yetki('Çekmeceyi açma yetkiniz yok.');
  }
  const ayar = yaziciAyariniOku(baglam);
  baglam.kayit.bilgi('Çekmece elle açıldı', { kullanici_id: aktor.kullaniciId });
  return yaziciOlustur(ayar)
    .cekmeceyiAc()
    .catch((hata) => ({ basarili: false, hata: hata instanceof Error ? hata.message : String(hata) }));
}

/** Yazdırılamamış fişler — kullanıcıya "tekrar yazdır" listesi (§20). */
export function yazdirilamayanFisler(
  baglam: Baglam,
  limit = 50,
): { id: string; fis_no: string; tarih: string; genel_toplam: Kurus }[] {
  return baglam.vt
    .hazirla(
      `SELECT id, fis_no, tarih, genel_toplam FROM satislar
       WHERE fis_yazdirildi = 0 AND iptal_mi = 0
       ORDER BY tarih DESC LIMIT ?`,
    )
    .tumu<{ id: string; fis_no: string; tarih: string; genel_toplam: number }>(limit);
}
