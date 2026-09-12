/**
 * Yazdırma servisi (§13.2, §20).
 *
 * KRİTİK: Yazdırma **asla** satışı bloke etmez. Fiş basılamazsa satış kesinleşmiş
 * sayılır ve `fis_yazdirildi = 0` kalır; kullanıcı sonradan tekrar yazdırabilir.
 */

import { AYAR, ETIKET_VARSAYILAN, type EtiketDili, type Kurus } from '@market/shared';
import { ayarBool, ayarMetin, ayarSayi } from '../depo/ayar.js';
import { cariBul, ekstre } from '../depo/cari.js';
import { oturumBul, oturumOzeti } from '../depo/kasa.js';
import { urunBul, urununBarkodlari } from '../depo/katalog.js';
import { fisYazdirildiIsaretle, satisDetayi } from '../depo/satis.js';
import { cariEkstreFisi, gunSonuFisi, satisFisi, YASAL_UYARI, type IsletmeBilgisi } from '../donanim/fis.js';
import {
  etiketBaytlari,
  etiketYerlesimi,
  kalibrasyonEtiketi,
  kalibrasyonYerlesimi,
  type EtiketIcerigi,
  type EtiketOlcusu,
  type EtiketSecenekleri,
  type EtiketYerlesimi,
} from '../donanim/etiket.js';
import { ekstreBelgesi, gunSonuBelgesi, satisBelgesi } from '../donanim/fis-belge.js';
import { belgeHtml, ekstreHtml, gunSonuHtml } from '../donanim/fis-html.js';
import { fisiGorselleStir, kagitNoktaGenisligi, rasterKomutu, siyahBeyazaIndir, kuyrukKomutlari } from '../donanim/fis-gorsel.js';
import { electronCizici } from '../donanim/gorsel-cizici.js';
import { EscPosYazici, type FisOnizlemesi } from '../donanim/escpos.js';
import {
  testFisi,
  yaziciOlustur,
  type Yazici,
  type YazdirmaSonucu,
  type YaziciAyari,
  type YaziciTipiDb,
} from '../donanim/yazici.js';
import { hatalar } from '@market/shared';
import type { Aktor, Baglam } from './baglam.js';

/**
 * HENÜZ KAYDEDİLMEMİŞ ayarlar — canlı önizleme için (§13.2, §13.3).
 *
 * Ayarlar ekranında kullanıcı bir değeri değiştirdiğinde önizleme ANINDA
 * güncellenmelidir; "Kaydet"e basmadan. Veritabanı o an hâlâ eski değeri
 * tutuyor olacağı için ekrandaki değerler bu üstveri ile geçilir. Kaydedilmemiş
 * ayarlarla baskı YAPILMAZ — üstveri yalnız önizleme yollarına verilir.
 */
export type AyarUstverisi = Record<string, string> | undefined;

function ustMetin(baglam: Baglam, ustveri: AyarUstverisi, anahtar: string, varsayilan: string): string {
  const deger = ustveri?.[anahtar];
  return deger !== undefined ? deger : ayarMetin(baglam.vt, anahtar, varsayilan);
}

function ustSayi(baglam: Baglam, ustveri: AyarUstverisi, anahtar: string, varsayilan: number): number {
  const deger = ustveri?.[anahtar];
  if (deger === undefined) return ayarSayi(baglam.vt, anahtar, varsayilan);
  // Kullanıcı yazarken alan bir an boş ya da yarım kalabilir; varsayılana düş.
  const sayi = Number(String(deger).replace(',', '.'));
  return Number.isFinite(sayi) && sayi > 0 ? sayi : varsayilan;
}

function ustBool(baglam: Baglam, ustveri: AyarUstverisi, anahtar: string, varsayilan: boolean): boolean {
  const deger = ustveri?.[anahtar];
  return deger !== undefined ? deger === '1' : ayarBool(baglam.vt, anahtar, varsayilan);
}

export function yaziciAyariniOku(baglam: Baglam, ustveri?: AyarUstverisi): YaziciAyari {
  const tipHam = ustMetin(baglam, ustveri, AYAR.YAZICI_TIPI, 'YOK');
  const gecerliTipler: YaziciTipiDb[] = ['YOK', 'USB', 'AG', 'OTOMATIK', 'DOSYA', 'WINDOWS_PAYLASIM'];
  const tip = (gecerliTipler as string[]).includes(tipHam) ? (tipHam as YaziciTipiDb) : 'YOK';
  return {
    tip,
    hedef: ustMetin(baglam, ustveri, AYAR.YAZICI_HEDEF, ''),
    usbAdi: ustMetin(baglam, ustveri, AYAR.YAZICI_USB_ADI, ''),
    satirGenisligi: ustSayi(baglam, ustveri, AYAR.YAZICI_GENISLIK, 48),
    cekmeceAc: ustBool(baglam, ustveri, AYAR.CEKMECE_ACIK, true),
  };
}

export function isletmeBilgisiniOku(baglam: Baglam, ustveri?: AyarUstverisi): IsletmeBilgisi {
  return {
    ad: ustMetin(baglam, ustveri, AYAR.ISLETME_ADI, 'Market'),
    adres: ustMetin(baglam, ustveri, AYAR.ISLETME_ADRES, '') || null,
    telefon: ustMetin(baglam, ustveri, AYAR.ISLETME_TELEFON, '') || null,
    vergiNo: ustMetin(baglam, ustveri, AYAR.ISLETME_VERGI_NO, '') || null,
    altMetin: ustMetin(baglam, ustveri, AYAR.FIS_ALT_METIN, 'Bizi tercih ettiğiniz için teşekkürler.') || null,
  };
}

/**
 * Satış fişini yazdırır. Başarısız olsa bile **hata fırlatmaz**; sonucu döner ve
 * çağıran (satış ekranı) kullanıcıya "fiş yazdırılamadı, tekrar dene" gösterir.
 */
/**
 * Fişi yazıcıya gönderir; ayar açıksa önce GÖRÜNTÜYE çevirir (§13.2).
 *
 * Üç fiş yolu (satış, gün sonu, cari ekstresi) da buradan geçer: biri
 * unutulursa Türkçe o fişte bozuk çıkar ve fark ancak müşteri elindeki
 * kağıtta görülür.
 *
 * Görüntüye çevirme başarısız olursa METİN fişi basılır. Bir render hatası
 * satışı durdurmamalı; fiş hiç çıkmamaktansa Türkçesiz çıksın (§3).
 */
async function fisiBas(
  baglam: Baglam,
  yazici: Yazici,
  baytlar: Buffer,
  satirGenisligi: number,
  html?: string,
): Promise<YazdirmaSonucu> {
  if (!ustBool(baglam, undefined, AYAR.YAZICI_GORSEL_FIS, true)) return yazici.yazdir(baytlar);

  /*
   * YAPILANDIRILMIŞ BELGE VARSA ONDAN ÇİZİLİR.
   *
   * Belge; ürün adını, miktarı, birim fiyatı ve tutarı ayrı alanlar olarak
   * taşır; sütunlu ve tipografik bir yerleşim ancak böyle çizilebilir. Belgesi
   * henüz çıkarılmamış fiş türleri (gün sonu, cari ekstresi) eski yolu
   * kullanır: bayt akışı geri çözülüp satır satır çizilir.
   */
  if (html) {
    try {
      const enNokta = kagitNoktaGenisligi(satirGenisligi);
      const { bgra, en, boy } = await electronCizici(html, enNokta);
      if (boy > 0 && en > 0) {
        const gorsel = Buffer.concat([
          Buffer.from([0x1b, 0x40]),
          rasterKomutu(siyahBeyazaIndir(bgra, en, boy), en, boy),
          kuyrukKomutlari(baytlar),
        ]);
        return yazici.yazdir(gorsel);
      }
    } catch (hata) {
      // Çizim hatası satışı durdurmaz; metin fişine düşülür (§3).
      baglam.kayit.uyari('Belge çizilemedi, metin olarak basılıyor', {
        hata: hata instanceof Error ? hata.message : String(hata),
      });
      return yazici.yazdir(baytlar);
    }
  }

  const cevrim = await fisiGorselleStir(baytlar, satirGenisligi, electronCizici);
  if (!cevrim.gorsel) {
    baglam.kayit.uyari('Fiş görüntüye çevrilemedi, metin olarak basılıyor', { hata: cevrim.hata });
  }
  return yazici.yazdir(cevrim.baytlar);
}

/** Yasal uyarı: ayardan gelir ama boş bırakılamaz (§17.1). */
function yasalUyariyiOku(baglam: Baglam): string {
  return ustMetin(baglam, undefined, AYAR.FIS_YASAL_UYARI, YASAL_UYARI).trim() || YASAL_UYARI;
}

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
    sonuc = await fisiBas(
      baglam,
      yazici,
      baytlar,
      ayar.satirGenisligi,
      belgeHtml(
        satisBelgesi(detay, isletme, {
          kopyaMi: secenekler.kopyaMi ?? false,
          kasiyerAdi: detay.satis.kullanici_adi ?? null,
          yasalUyari: yasalUyariyiOku(baglam),
        }),
        kagitNoktaGenisligi(ayar.satirGenisligi),
      ),
    );
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
  /*
   * Özet ve oturum bilgisi BİR KEZ hazırlanır: metin fişi ile görüntü fişi
   * aynı rakamları göstermeli. İki ayrı okuma arasında kasaya para girse
   * ikisi ayrışır ve hangisinin doğru olduğu belirsizleşir.
   */
  const ozetVerisi = oturumOzeti(baglam.vt, oturumId);
  const bilgiVerisi = {
    isletme: isletmeBilgisiniOku(baglam),
    kasiyerAdi: oturum.kullanici_adi ?? aktor.ad,
    acilis: oturum.acilis_zamani,
    kapanis: oturum.kapanis_zamani ?? new Date().toISOString(),
    sayilanNakit: oturum.sayilan_nakit ?? 0,
    beklenenNakit: oturum.beklenen_nakit ?? 0,
    kasaFarki: oturum.kasa_farki ?? 0,
  };
  const baytlar = gunSonuFisi(ozetVerisi, bilgiVerisi, ayar.satirGenisligi);
  return fisiBas(
    baglam,
    yaziciOlustur(ayar),
    baytlar,
    ayar.satirGenisligi,
    gunSonuHtml(gunSonuBelgesi(ozetVerisi, bilgiVerisi, yasalUyariyiOku(baglam)), kagitNoktaGenisligi(ayar.satirGenisligi)),
  ).catch((hata) => ({
    basarili: false,
    hata: String(hata),
  }));
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
  const isletme = isletmeBilgisiniOku(baglam);
  // Hareketler BİR KEZ okunur: metin fişi ile görüntü fişi aynı veriyi
  // göstermeli, iki ayrı sorgu arasında yeni bir tahsilat girilse ikisi
  // ayrışırdı.
  const hareketler = ekstre(baglam.vt, cariId, baslangic, bitis);
  const baytlar = cariEkstreFisi(
    { ad_unvan: cari.ad_unvan, telefon: cari.telefon, bakiye: cari.bakiye },
    hareketler,
    isletme,
    ayar.satirGenisligi,
  );
  return fisiBas(
    baglam,
    yaziciOlustur(ayar),
    baytlar,
    ayar.satirGenisligi,
    ekstreHtml(
      ekstreBelgesi(
        { ad_unvan: cari.ad_unvan, telefon: cari.telefon, bakiye: cari.bakiye },
        hareketler,
        isletme,
        { yasalUyari: yasalUyariyiOku(baglam), baslangic, bitis },
      ),
      kagitNoktaGenisligi(ayar.satirGenisligi),
    ),
  ).catch((hata) => ({
    basarili: false,
    hata: String(hata),
  }));
}

/**
 * Etiket yazıcısı ayarları — FİŞ yazıcısından ayrı bir cihaz (§13.3).
 *
 * Tanımlı değilse fiş yazıcısına DÜŞMEZ. Eskiden raf etiketi fiş yazıcısına
 * basılıyordu: 80 mm termal kağıda, sonunda kağıt kesme komutuyla. Ortaya
 * rafa yapıştırılamayan bir fiş çıkıyordu. Etiket yazıcısı yoksa kullanıcı
 * bunu bilmeli, yanlış cihazdan çıktı almamalı.
 */
export function etiketYaziciAyariniOku(baglam: Baglam, ustveri?: AyarUstverisi): YaziciAyari {
  const tipHam = ustMetin(baglam, ustveri, AYAR.ETIKET_YAZICI_TIPI, 'YOK');
  const gecerliTipler: YaziciTipiDb[] = ['YOK', 'USB', 'AG', 'OTOMATIK', 'DOSYA', 'WINDOWS_PAYLASIM'];
  return {
    tip: (gecerliTipler as string[]).includes(tipHam) ? (tipHam as YaziciTipiDb) : 'YOK',
    hedef: ustMetin(baglam, ustveri, AYAR.ETIKET_YAZICI_HEDEF, ''),
    usbAdi: ustMetin(baglam, ustveri, AYAR.ETIKET_YAZICI_USB_ADI, ''),
    // Etiket yazıcısında "satır genişliği" kavramı yok; önizleme için taşınır.
    satirGenisligi: 32,
    cekmeceAc: false,
  };
}

export function etiketOlcusunuOku(baglam: Baglam, ustveri?: AyarUstverisi): EtiketOlcusu {
  return {
    enMm: ustSayi(baglam, ustveri, AYAR.ETIKET_EN_MM, ETIKET_VARSAYILAN.EN_MM),
    boyMm: ustSayi(baglam, ustveri, AYAR.ETIKET_BOY_MM, ETIKET_VARSAYILAN.BOY_MM),
    boslukMm: ustSayi(baglam, ustveri, AYAR.ETIKET_BOSLUK_MM, ETIKET_VARSAYILAN.BOSLUK_MM),
    dpi: ustSayi(baglam, ustveri, AYAR.ETIKET_DPI, ETIKET_VARSAYILAN.DPI),
    sutun: Math.max(1, ustSayi(baglam, ustveri, AYAR.ETIKET_SUTUN, ETIKET_VARSAYILAN.SUTUN)),
    isi: ustSayi(baglam, ustveri, AYAR.ETIKET_ISI, ETIKET_VARSAYILAN.ISI),
    hiz: ustSayi(baglam, ustveri, AYAR.ETIKET_HIZ, ETIKET_VARSAYILAN.HIZ),
  };
}

function etiketDiliniOku(baglam: Baglam, ustveri?: AyarUstverisi): EtiketDili {
  return ustMetin(baglam, ustveri, AYAR.ETIKET_DILI, 'TSPL') === 'ZPL' ? 'ZPL' : 'TSPL';
}

function etiketSecenekleriniOku(baglam: Baglam, ustveri?: AyarUstverisi): EtiketSecenekleri {
  return {
    rafGoster: ustBool(baglam, ustveri, AYAR.ETIKET_RAF_GOSTER, false),
    birimFiyatGoster: ustBool(baglam, ustveri, AYAR.ETIKET_BIRIM_FIYAT_GOSTER, true),
    /*
     * Türkçe yalnız TSPL'de basılır: TSPL işin başında `CODEPAGE 1254` bildirir
     * ve yazıcının gömülü fontu Türkçenin tamamını (I, i, İ, ı dahil) çizer.
     * ZPL emülasyonunda aynı harfler doğrulanmadığı için orada metin ASCII'ye
     * iner — boş kutu basmaktansa "Urun" basmak yeğdir.
     */
    turkce: etiketDiliniOku(baglam, ustveri) === 'TSPL',
  };
}

export interface EtiketKuyrukSatiri {
  urunId: string;
  adet: number;
}

export interface EtiketYazdirmaSonucu extends YazdirmaSonucu {
  basilanEtiket: number;
  atlanan: { urunId: string; sebep: string }[];
}

/**
 * Etiket kuyruğunu basar (§13.3).
 *
 * TEK TEK DEĞİL TOPLU: her satır için ayrı bağlantı açmak yerine bütün
 * etiketler tek gönderimde yazıcıya iner. 100 kalem etiketi basarken aradaki
 * fark saniyeler değil dakikalardır — ağ yazıcısında her etiket için TCP
 * bağlantısı kurmak baskıdan uzun sürer.
 *
 * Bir ürün basılamazsa (silinmiş, barkodu yok) kuyruk DURMAZ: o satır atlanır,
 * sebebi döner. Yüz ürünlük bir kuyruğun tek bir eksik ürün yüzünden hiç
 * basılmaması, kullanıcıyı hangi ürünün sorunlu olduğunu aramaya iter.
 */
export async function etiketKuyruguYazdir(baglam: Baglam, satirlar: EtiketKuyrukSatiri[]): Promise<EtiketYazdirmaSonucu> {
  const ayar = etiketYaziciAyariniOku(baglam);
  if (ayar.tip === 'YOK') {
    throw hatalar.dogrulama('Etiket yazıcısı tanımlı değil. Ayarlar → Etiket Yazıcısı bölümünden tanımlayın.');
  }

  const dil = etiketDiliniOku(baglam);
  const olcu = etiketOlcusunuOku(baglam);
  const secenek = etiketSecenekleriniOku(baglam);

  const parcalar: Buffer[] = [];
  const atlanan: { urunId: string; sebep: string }[] = [];
  let basilan = 0;

  for (const satir of satirlar) {
    const adet = Math.min(Math.max(1, Math.trunc(satir.adet)), 500);
    const urun = urunBul(baglam.vt, satir.urunId);
    if (!urun) {
      atlanan.push({ urunId: satir.urunId, sebep: 'Ürün bulunamadı' });
      continue;
    }
    const barkod = urununBarkodlari(baglam.vt, satir.urunId).find((b) => b.aktif_mi)?.barkod ?? '';
    const icerik: EtiketIcerigi = {
      ad: urun.ad,
      fiyat: urun.satis_fiyati,
      barkod,
      birimTipi: urun.birim_tipi,
      rafKonumu: urun.raf_konumu,
      adet,
    };
    parcalar.push(etiketBaytlari(dil, icerik, olcu, secenek));
    basilan += adet;
  }

  if (parcalar.length === 0) {
    return { basarili: false, hata: 'Basılacak etiket yok.', basilanEtiket: 0, atlanan };
  }

  const sonuc = await yaziciOlustur(ayar)
    .yazdir(Buffer.concat(parcalar))
    .catch((hata) => ({ basarili: false, hata: hata instanceof Error ? hata.message : String(hata) }));

  /*
   * BAŞARISIZLIĞIN SEBEBİ DE YAZILIR.
   *
   * Eskiden bu satır her koşulda "Etiket basıldı" diyor ve yalnız `basarili`
   * bayrağını taşıyordu: etiket çıkmadığında logda "basıldı" yazıyor, sebebi
   * (yazıcıya ulaşılamadı mı, zaman aşımı mı, hedef yanlış mı) hiçbir yere
   * kaydedilmiyordu. Hedef ve tip de taşınır — "hangi yazıcıya gitti" sorusu
   * ayarlara bakmadan cevaplanabilsin.
   */
  const ayrinti = { satir: parcalar.length, etiket: basilan, yazici_tip: ayar.tip, hedef: ayar.hedef, atlanan: atlanan.length };
  if (sonuc.basarili) baglam.kayit.bilgi('Etiket basıldı', ayrinti);
  else baglam.kayit.uyari('Etiket basılamadı', { ...ayrinti, hata: sonuc.hata ?? 'sebep bildirilmedi' });
  return { ...sonuc, basilanEtiket: sonuc.basarili ? basilan : 0, atlanan };
}

/** Tek ürünün etiketi — kuyruk mekanizmasının kısayolu. */
export async function etiketYazdir(baglam: Baglam, urunId: string, adet = 1): Promise<EtiketYazdirmaSonucu> {
  return etiketKuyruguYazdir(baglam, [{ urunId, adet }]);
}

/**
 * Etiket önizlemesi (§13.3).
 *
 * Yazıcıya gidecek yerleşimin AYNISINI döner — ekranda çizilen şey ile kağıda
 * basılan şey tek hesaptan çıkar. Ürün verilmezse örnek bir ürünle çizilir;
 * kullanıcı ayarı değiştirirken elinde ürün olmayabilir.
 */
export function etiketOnizlemesi(
  baglam: Baglam,
  secenekler: { urunId?: string; ayarlar?: AyarUstverisi } = {},
): EtiketYerlesimi & { dil: string } {
  const { urunId, ayarlar } = secenekler;
  const olcu = etiketOlcusunuOku(baglam, ayarlar);
  const dil = etiketDiliniOku(baglam, ayarlar);
  const urun = urunId ? urunBul(baglam.vt, urunId) : null;

  if (!urun) {
    return {
      ...etiketYerlesimi(
        {
          ad: 'Örnek Ürün Adı',
          fiyat: 4550,
          barkod: '8690000000017',
          birimTipi: 'ADET',
          rafKonumu: 'A-3',
          adet: 1,
        },
        olcu,
        etiketSecenekleriniOku(baglam, ayarlar),
      ),
      dil,
    };
  }

  const barkod = urununBarkodlari(baglam.vt, urun.id).find((b) => b.aktif_mi)?.barkod ?? '';
  return {
    ...etiketYerlesimi(
      {
        ad: urun.ad,
        fiyat: urun.satis_fiyati,
        barkod,
        birimTipi: urun.birim_tipi,
        rafKonumu: urun.raf_konumu,
        adet: 1,
      },
      olcu,
      etiketSecenekleriniOku(baglam, ayarlar),
    ),
    dil,
  };
}

/** Kalibrasyon etiketinin önizlemesi — aynı yerleşimden çizilir. */
export function kalibrasyonOnizlemesi(baglam: Baglam, ayarlar?: AyarUstverisi): EtiketYerlesimi {
  return kalibrasyonYerlesimi(etiketOlcusunuOku(baglam, ayarlar));
}

/**
 * Fiş önizlemesi (§13.2).
 *
 * Gerçek fiş baytları üretilir ve geri çözülür; ekranda görünen ile kağıda
 * basılan tek kaynaktan gelir. Satış yoksa test fişi kullanılır.
 */
export function fisOnizlemesi(
  baglam: Baglam,
  secenekler: { satisId?: string; ayarlar?: AyarUstverisi } = {},
): FisOnizlemesi & { satirGenisligi: number } {
  const { satisId, ayarlar } = secenekler;
  const ayar = yaziciAyariniOku(baglam, ayarlar);
  const detay = satisId ? satisDetayi(baglam.vt, satisId) : null;

  const baytlar = detay
    ? satisFisi(detay, isletmeBilgisiniOku(baglam, ayarlar), {
        satirGenisligi: ayar.satirGenisligi,
        kopyaMi: false,
        kasiyerAdi: detay.satis.kullanici_adi ?? null,
      })
    : testFisi(ayar.satirGenisligi);

  return { ...EscPosYazici.onizlemeYapisi(baytlar), satirGenisligi: ayar.satirGenisligi };
}

/**
 * Kalibrasyon etiketi: ölçünün doğru olup olmadığı gözle anlaşılsın diye
 * etiketin dört kenarına çerçeve çizer.
 */
export async function etiketKalibrasyonu(baglam: Baglam): Promise<YazdirmaSonucu> {
  const ayar = etiketYaziciAyariniOku(baglam);
  if (ayar.tip === 'YOK') throw hatalar.dogrulama('Etiket yazıcısı tanımlı değil.');
  const sonuc = await yaziciOlustur(ayar)
    .yazdir(kalibrasyonEtiketi(etiketDiliniOku(baglam), etiketOlcusunuOku(baglam)))
    .catch((hata) => ({ basarili: false, hata: hata instanceof Error ? hata.message : String(hata) }));
  // Kalibrasyon, etiket yolunun "çalışıyor mu" ölçütüdür; ürün etiketiyle
  // karşılaştırılabilmesi için o da aynı ayrıntıyla loglanır.
  const ayrinti = { yazici_tip: ayar.tip, hedef: ayar.hedef };
  if (sonuc.basarili) baglam.kayit.bilgi('Kalibrasyon etiketi basıldı', ayrinti);
  else baglam.kayit.uyari('Kalibrasyon etiketi basılamadı', { ...ayrinti, hata: sonuc.hata ?? 'sebep bildirilmedi' });
  return sonuc;
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
