/**
 * Yazdırma servisi (§13.2, §20).
 *
 * KRİTİK: Yazdırma **asla** satışı bloke etmez. Fiş basılamazsa satış kesinleşmiş
 * sayılır ve `fis_yazdirildi = 0` kalır; kullanıcı sonradan tekrar yazdırabilir.
 */

import {
  AYAR,
  ETIKET_VARSAYILAN,
  etiketDuzeniCoz,
  tarihFormat,
  FIS_YAZI_OLCEGI,
  fisDuzeniCoz,
  type EtiketDili,
  type FisDuzeni,
  type Kurus,
} from '@market/shared';
import { ayarBool, ayarMetin, ayarSayi } from '../depo/ayar.js';
import { cariBul, ekstre } from '../depo/cari.js';
import { oturumBul, oturumOzeti } from '../depo/kasa.js';
import { etiketBekleyenleriSil, urunBul, urununBarkodlari } from '../depo/katalog.js';
import { fisYazdirildiIsaretle, satisDetayi, type SatisDetayi } from '../depo/satis.js';
import { cariEkstreFisi, gunSonuFisi, satisFisi, YASAL_UYARI, type IsletmeBilgisi } from '../donanim/fis.js';
import {
  etiketBaytlari,
  etiketGorselKomutu,
  etiketSvgSayfasi,
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

/** Fiş/ekstre düzeni (Ayarlar → Fiş Düzeni). Önizlemede kaydedilmemiş değer kullanılır. */
export function fisDuzeniniOku(baglam: Baglam, ustveri?: AyarUstverisi): FisDuzeni {
  return fisDuzeniCoz(ustMetin(baglam, ustveri, AYAR.FIS_DUZENI, ''));
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
  const duzen = fisDuzeniniOku(baglam);

  const baytlar = satisFisi(detay, isletme, {
    satirGenisligi: ayar.satirGenisligi,
    kopyaMi: secenekler.kopyaMi ?? false,
    kasiyerAdi: detay.satis.kullanici_adi ?? null,
    duzen,
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
          duzen,
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
    gunSonuHtml(
      {
        ...gunSonuBelgesi(ozetVerisi, bilgiVerisi, yasalUyariyiOku(baglam)),
        sablon: fisDuzeniniOku(baglam).sablon,
        yaziOlcegi: FIS_YAZI_OLCEGI[fisDuzeniniOku(baglam).yaziBoyutu],
      },
      kagitNoktaGenisligi(ayar.satirGenisligi),
    ),
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
  const duzen = fisDuzeniniOku(baglam);
  const baytlar = cariEkstreFisi(
    { ad_unvan: cari.ad_unvan, telefon: cari.telefon, bakiye: cari.bakiye },
    hareketler,
    isletme,
    ayar.satirGenisligi,
    duzen,
  );
  return fisiBas(
    baglam,
    yaziciOlustur(ayar),
    baytlar,
    ayar.satirGenisligi,
    ekstreHtml(
      ekstreBelgesi({ ad_unvan: cari.ad_unvan, telefon: cari.telefon, bakiye: cari.bakiye }, hareketler, isletme, {
        yasalUyari: yasalUyariyiOku(baglam),
        baslangic,
        bitis,
        duzen,
      }),
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

function etiketGorselMi(baglam: Baglam, ustveri?: AyarUstverisi): boolean {
  return ustBool(baglam, ustveri, AYAR.ETIKET_GORSEL, true);
}

/**
 * Bir etiketin yazıcı baytları — ayar açıksa GÖRÜNTÜ olarak (§13.3).
 *
 * Yazıcının gömülü fontları Türkçe harfleri her modelde doğru çizemiyor ve
 * barkodu kendi kodlamasıyla basıyordu; kâğıt önizlemeden farklı çıkıyordu.
 * Görüntüde etiketi önizlemeyle aynı çizim üretir. Çizilemezse metin etiketine
 * düşülür — etiket hiç çıkmamaktansa eski hâliyle çıksın.
 */
async function etiketBaytlariUret(
  baglam: Baglam,
  dil: EtiketDili,
  icerik: EtiketIcerigi,
  olcu: EtiketOlcusu,
  secenek: EtiketSecenekleri,
  gorsel: boolean,
): Promise<Buffer> {
  if (!gorsel) return etiketBaytlari(dil, icerik, olcu, secenek);
  try {
    const yerlesim = etiketYerlesimi(icerik, olcu, secenek);
    const { html, enNokta } = etiketSvgSayfasi(yerlesim, olcu.dpi);
    const { bgra, en, boy } = await electronCizici(html, enNokta);
    if (en <= 0 || boy <= 0) throw new Error('Görüntü ölçüsü sıfır.');
    return etiketGorselKomutu(dil, siyahBeyazaIndir(bgra, en, boy), en, boy, olcu, icerik.adet);
  } catch (hata) {
    baglam.kayit.uyari('Etiket görüntüye çevrilemedi, metin olarak basılıyor', {
      hata: hata instanceof Error ? hata.message : String(hata),
    });
    return etiketBaytlari(dil, icerik, olcu, secenek);
  }
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
    // Görüntü olarak basılınca harfleri yazıcı değil program çizer: Türkçe her dilde tam.
    turkce: etiketGorselMi(baglam, ustveri) || etiketDiliniOku(baglam, ustveri) === 'TSPL',
    dil: etiketDiliniOku(baglam, ustveri),
    duzen: etiketDuzeniCoz(ustMetin(baglam, ustveri, AYAR.ETIKET_DUZENI, '')),
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

  const gorsel = etiketGorselMi(baglam);
  const parcalar: Buffer[] = [];
  const atlanan: { urunId: string; sebep: string }[] = [];
  const basilanUrunler: string[] = [];
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
      tarih: tarihFormat(new Date()),
    };
    parcalar.push(await etiketBaytlariUret(baglam, dil, icerik, olcu, secenek, gorsel));
    basilanUrunler.push(urun.id);
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
  if (sonuc.basarili) {
    baglam.kayit.bilgi('Etiket basıldı', ayrinti);
    // Etiketi basılan ürün "etiket basılacaklar" listesinden düşer.
    etiketBekleyenleriSil(baglam.vt, basilanUrunler);
  } else baglam.kayit.uyari('Etiket basılamadı', { ...ayrinti, hata: sonuc.hata ?? 'sebep bildirilmedi' });
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
          barkod: '8691234567906',
          birimTipi: 'ADET',
          rafKonumu: 'A-3',
          adet: 1,
          tarih: tarihFormat(new Date()),
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
        tarih: tarihFormat(new Date()),
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
  secenekler: { satisId?: string; ayarlar?: AyarUstverisi; kopyaMi?: boolean } = {},
): FisOnizlemesi & { satirGenisligi: number } {
  const { satisId, ayarlar, kopyaMi = false } = secenekler;
  const ayar = yaziciAyariniOku(baglam, ayarlar);
  const detay = satisId ? satisDetayi(baglam.vt, satisId) : null;

  const baytlar = detay
    ? satisFisi(detay, isletmeBilgisiniOku(baglam, ayarlar), {
        satirGenisligi: ayar.satirGenisligi,
        kopyaMi,
        kasiyerAdi: detay.satis.kullanici_adi ?? null,
        duzen: fisDuzeniniOku(baglam, ayarlar),
      })
    : testFisi(ayar.satirGenisligi);

  return { ...EscPosYazici.onizlemeYapisi(baytlar), satirGenisligi: ayar.satirGenisligi };
}

/**
 * Kayıtlı satışın fişi ekranda — yazıcıdan çıkacak fişin AYNISI.
 *
 * Görsel fiş açıksa (varsayılan) yazıcıya giden HTML'in kendisi, kapalıysa
 * metin fişinin geri çözülmüş hali döner. Ekranda ayrı bir fiş tasarımı
 * yoktur; geçmiş fişe bakan müşterinin elindeki kağıdı görür. Tekrar
 * yazdırmayla aynı olsun diye KOPYA damgalıdır.
 */
export function satisFisiGorunumu(
  baglam: Baglam,
  satisId: string,
): { tur: 'html'; html: string; enNokta: number } | ({ tur: 'metin' } & FisOnizlemesi & { satirGenisligi: number }) {
  const detay = satisDetayi(baglam.vt, satisId);
  if (!detay) throw hatalar.bulunamadi('Satış');
  if (!ustBool(baglam, undefined, AYAR.YAZICI_GORSEL_FIS, true)) {
    return { tur: 'metin', ...fisOnizlemesi(baglam, { satisId, kopyaMi: true }) };
  }
  const ayar = yaziciAyariniOku(baglam);
  const enNokta = kagitNoktaGenisligi(ayar.satirGenisligi);
  const html = belgeHtml(
    satisBelgesi(detay, isletmeBilgisiniOku(baglam), {
      kopyaMi: true,
      kasiyerAdi: detay.satis.kullanici_adi ?? null,
      yasalUyari: yasalUyariyiOku(baglam),
      duzen: fisDuzeniniOku(baglam),
    }),
    enNokta,
  );
  return { tur: 'html', html, enNokta };
}

/** Fiş Düzeni sekmesinin önizlemesi: yazıcıdan ÇIKACAK belgenin aynısı (görsel ya da metin). */
export type BelgeOnizlemesi =
  | { tur: 'html'; html: string; enNokta: number; ornek: boolean }
  | ({ tur: 'metin'; ornek: boolean } & FisOnizlemesi & { satirGenisligi: number });

/**
 * Satış fişi ya da ekstre önizlemesi — KAYDEDİLMEMİŞ ayarlarla.
 *
 * Gerçek veri kullanılır (son satış / en çok hareketi olan cari); kayıt
 * yoksa uydurma bir örnekle çizilir (`ornek: true`). Eskiden Donanım
 * sekmesinde yalnız düz metin bir test fişi görünüyordu: varsayılan olarak
 * basılan görsel fiş ve ekstre hiç önizlenemiyordu.
 */
export function belgeOnizlemesi(
  baglam: Baglam,
  secenekler: { tur: 'satis' | 'ekstre'; ayarlar?: AyarUstverisi },
): BelgeOnizlemesi {
  const { ayarlar } = secenekler;
  const ayar = yaziciAyariniOku(baglam, ayarlar);
  const isletme = isletmeBilgisiniOku(baglam, ayarlar);
  const duzen = fisDuzeniniOku(baglam, ayarlar);
  const yasalUyari = ustMetin(baglam, ayarlar, AYAR.FIS_YASAL_UYARI, YASAL_UYARI).trim() || YASAL_UYARI;
  const gorsel = ustBool(baglam, ayarlar, AYAR.YAZICI_GORSEL_FIS, true);
  const enNokta = kagitNoktaGenisligi(ayar.satirGenisligi);
  const metin = (baytlar: Buffer, ornek: boolean): BelgeOnizlemesi => ({
    tur: 'metin',
    ornek,
    ...EscPosYazici.onizlemeYapisi(baytlar),
    satirGenisligi: ayar.satirGenisligi,
  });

  if (secenekler.tur === 'satis') {
    const sonId = baglam.vt
      .hazirla('SELECT id FROM satislar WHERE iptal_mi = 0 AND iade_mi = 0 ORDER BY tarih DESC LIMIT 1')
      .tek<{ id: string }>()?.id;
    const gercek = sonId ? satisDetayi(baglam.vt, sonId) : null;
    const detay = gercek ?? ornekSatisDetayi();
    const kasiyerAdi = detay.satis.kullanici_adi ?? null;
    if (!gorsel) return metin(satisFisi(detay, isletme, { satirGenisligi: ayar.satirGenisligi, kasiyerAdi, duzen }), !gercek);
    const html = belgeHtml(satisBelgesi(detay, isletme, { kasiyerAdi, yasalUyari, duzen }), enNokta);
    return { tur: 'html', html, enNokta, ornek: !gercek };
  }

  const cariId = baglam.vt
    .hazirla('SELECT cari_id FROM cari_hareketler GROUP BY cari_id ORDER BY COUNT(*) DESC LIMIT 1')
    .tek<{ cari_id: string }>()?.cari_id;
  const cari = cariId ? cariBul(baglam.vt, cariId) : null;
  const ornek = !cari;
  const cariBilgi = cari
    ? { ad_unvan: cari.ad_unvan, telefon: cari.telefon, bakiye: cari.bakiye }
    : { ad_unvan: 'Örnek Müşteri', telefon: '0555 000 00 00', bakiye: 15_000 };
  const hareketler = cari ? ekstre(baglam.vt, cari.id) : ornekEkstreHareketleri();
  if (!gorsel) return metin(cariEkstreFisi(cariBilgi, hareketler, isletme, ayar.satirGenisligi, duzen), ornek);
  const html = ekstreHtml(ekstreBelgesi(cariBilgi, hareketler, isletme, { yasalUyari, duzen }), enNokta);
  return { tur: 'html', html, enNokta, ornek };
}

/** Kayıtlı satış yokken önizleme için uydurma bir satış. */
function ornekSatisDetayi(): SatisDetayi {
  const simdi = new Date().toISOString();
  const kalem = (urun_adi: string, miktar: number, birim_tipi: string, birim_fiyat: number, kdv_orani: number) => {
    const satir_toplam = Math.round((miktar * birim_fiyat) / 1000);
    return {
      urun_adi,
      miktar,
      birim_tipi,
      birim_fiyat,
      iskonto: 0,
      kdv_orani,
      kdv_tutar: Math.round(satir_toplam - satir_toplam / (1 + kdv_orani / 100)),
      satir_toplam,
    };
  };
  const kalemler = [
    kalem('Tam Yağlı Süt 1 L', 2000, 'ADET', 3_250, 1),
    kalem('Domates', 1_250, 'KG', 2_990, 1),
    kalem('Çay 1 kg', 1000, 'ADET', 21_500, 20),
  ];
  const toplam = kalemler.reduce((t, k) => t + k.satir_toplam, 0);
  return {
    satis: {
      fis_no: 'NA-000123',
      tarih: simdi,
      musteri_adi: null,
      iade_mi: false,
      kaynak_fis_no: null,
      notlar: null,
      ara_toplam: toplam,
      iskonto_toplam: 0,
      genel_toplam: toplam,
      kullanici_adi: 'Kasiyer',
    },
    kalemler,
    odemeler: [
      { odeme_tipi: 'NAKIT', tutar: toplam, alinan: 30_000, para_ustu: 30_000 - toplam, pos_kart: null, pos_onay_kodu: null },
    ],
  } as unknown as SatisDetayi;
}

function ornekEkstreHareketleri() {
  const gun = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  return [
    { tarih: gun(12), aciklama: 'Satış NA-000101', tutar: 8_500, yuruyen_bakiye: 8_500 },
    { tarih: gun(7), aciklama: 'Satış VA-000014', tutar: 12_500, yuruyen_bakiye: 21_000 },
    { tarih: gun(3), aciklama: 'Tahsilat (nakit)', tutar: -10_000, yuruyen_bakiye: 11_000 },
    { tarih: gun(1), aciklama: 'Satış VA-000019', tutar: 4_000, yuruyen_bakiye: 15_000 },
  ];
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

/**
 * Fiş BASILMADAN biten nakit satışta çekmeceyi açar.
 *
 * Çekmece fiş yazıcısına bağlıdır ve eskiden yalnız fiş basıldıktan sonra
 * açılıyordu: fişsiz nakit satışta (F5 ya da "fiş yok") kasiyer para üstü
 * için Kasa sayfasına gidip çekmeceyi elle açmak zorunda kalıyordu.
 */
export async function fissizSatistaCekmeceyiAc(baglam: Baglam, satisId: string): Promise<void> {
  const ayar = yaziciAyariniOku(baglam);
  if (!ayar.cekmeceAc || ayar.tip === 'YOK') return;
  const detay = satisDetayi(baglam.vt, satisId);
  if (!detay?.odemeler.some((o) => o.odeme_tipi === 'NAKIT')) return;
  const sonuc = await yaziciOlustur(ayar)
    .cekmeceyiAc()
    .catch((hata) => ({ basarili: false, hata: hata instanceof Error ? hata.message : String(hata) }));
  if (!sonuc.basarili) baglam.kayit.uyari('Çekmece açılamadı', { satis_id: satisId, hata: sonuc.hata });
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
