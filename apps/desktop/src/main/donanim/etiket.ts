/**
 * Etiket (barkod) yazıcısı — TSPL, ZPL ve önizleme (§13.3).
 *
 * FİŞ YAZICISINDAN NEDEN AYRI: fiş yazıcısı ESC/POS konuşur ve "satır satır ak,
 * sonunda kes" mantığıyla çalışır. Etiket yazıcısı fiziksel ölçü bilir — kaç mm
 * eninde etiket, hangi KOORDİNATA ne yazılacak. ESC/POS'u etiket yazıcısına
 * yollamak genelde hiçbir şey basmaz ya da çöp basar.
 *
 * TEK YERLEŞİM, ÜÇ TÜKETİCİ: konumlar bir kez `etiketYerlesimi` içinde
 * milimetre cinsinden hesaplanır; TSPL, ZPL ve ekrandaki önizleme aynı listeyi
 * okur. Üçü ayrı ayrı hesaplasaydı önizleme ile kağıt kaçınılmaz olarak
 * ayrışırdı — ve kullanıcı farkı ancak yüz etiket bastıktan sonra görürdü.
 */

import {
  etiketBarkodCizimi,
  ETIKET_AD_YUKSEKLIK,
  ETIKET_FIYAT_YUKSEKLIK,
  paraFormat,
  VARSAYILAN_ETIKET_DUZENI,
  type EtiketBarkodTuru,
  type EtiketDuzeni,
  type EtiketHiza,
  type Kurus,
} from '@market/shared';

export interface EtiketOlcusu {
  enMm: number;
  boyMm: number;
  boslukMm: number;
  dpi: number;
  sutun: number;
  isi: number;
  hiz: number;
}

export interface EtiketIcerigi {
  ad: string;
  fiyat: Kurus;
  barkod: string;
  birimTipi: string;
  rafKonumu?: string | null;
  adet: number;
  /** Basım tarihi ("30.10.2026") — düzende "tarih" açıksa basılır. */
  tarih?: string;
}

export interface EtiketSecenekleri {
  rafGoster: boolean;
  birimFiyatGoster: boolean;
  /**
   * Yazıcı Türkçe harfleri basabiliyor mu (TSPL + CODEPAGE 1254).
   *
   * Dili bilen servis katmanı doldurur. Yerleşim bunu bilmek ZORUNDA: ekrandaki
   * önizleme ile kağıda basılan aynı metni göstermeli — biri "Ürün", öbürü
   * "Urun" yazarsa kullanıcı farkı ancak etiketi rafa astıktan sonra görür.
   */
  turkce?: boolean;
  /** Yazıcının dili — yazı genişliği (ortalama/sağa yaslama) fonta göre hesaplanır. */
  dil?: 'TSPL' | 'ZPL';
  /** Ad/fiyat/barkod hizası ve boyutu; verilmezse eski (sola yaslı) görünüm. */
  duzen?: EtiketDuzeni;
}

export type YerlesimOgesi =
  | {
      tip: 'metin';
      xMm: number;
      yMm: number;
      metin: string;
      yukseklikMm: number;
      kalin: boolean;
      /** Yazıcının fontuyla basılınca kaplayacağı genişlik — önizleme metni bu genişlikte çizer. */
      genislikMm?: number;
    }
  | {
      tip: 'barkod';
      xMm: number;
      yMm: number;
      veri: string;
      yukseklikMm: number;
      modulMm: number;
      genislikMm: number;
      /** EAN-13 / EAN-8 / CODE128 — önizleme ve yazıcı aynı türü kullanır. */
      tur?: EtiketBarkodTuru;
    }
  | { tip: 'cerceve'; xMm: number; yMm: number; enMm: number; boyMm: number; kalinlikMm: number };

export interface EtiketYerlesimi {
  enMm: number;
  boyMm: number;
  ogeler: YerlesimOgesi[];
  /**
   * Kullanıcıya gösterilecek uyarılar — önizlemenin asıl işi bunları
   * kağıda basmadan ÖNCE göstermektir.
   */
  uyarilar: string[];
}

/** Kenar boşluğu — etiket kenarına dayanan yazı kesilir. */
const KENAR_MM = 2;

/** Milimetreyi yazıcının nokta birimine çevirir (ZPL ve TSPL nokta ister). */
function nokta(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / 25.4);
}

/** TSPL gömülü fontlarının hücre eni / boyu (203 dpi'de 8×12, 12×20, 16×24, 24×32, 32×48 nokta). */
const TSPL_FONT_ORANI: Record<string, number> = { '1': 8 / 12, '2': 12 / 20, '3': 16 / 24, '4': 24 / 32, '5': 32 / 48 };
const TSPL_FONT_MM: Record<string, number> = { '1': 1.5, '2': 2.5, '3': 3, '4': 4, '5': 6 };

/**
 * Metnin YAZICIDA kaplayacağı genişlik (mm).
 *
 * Ortalama ve sağa yaslama bu hesaba dayanır: TSPL fontları sabit genişliklidir,
 * genişlik seçilen font ve çarpandan kesin bulunur. ZPL'nin ^A0 fontuna
 * yüksekliğin %60'ı kadar genişlik verilir (aşağıda `zpl`), hesap da onu kullanır.
 */
function metinGenisligiMm(metin: string, yukseklikMm: number, dil: 'TSPL' | 'ZPL'): number {
  if (dil === 'ZPL') return metin.length * yukseklikMm * 0.6;
  const { font, carpan } = tsplFont(yukseklikMm);
  // Yazıcıya giden metin ölçülür: ₺ kâğıda "TL" olarak basılır (iki harf).
  const basilan = cp1254eTasi(metin);
  return basilan.length * (TSPL_FONT_MM[font] ?? yukseklikMm) * carpan * (TSPL_FONT_ORANI[font] ?? 0.6);
}

/**
 * Uzun ürün adını etikete sığdırır.
 *
 * Kesme YAZI GENİŞLİĞİNE göre yapılır, sabit karakter sayısına göre değil:
 * 30 mm'lik etikete 40 mm'likten daha az harf sığar.
 */
function adKisalt(ad: string, kullanilabilirMm: number, yukseklikMm: number, dil: 'TSPL' | 'ZPL'): string {
  const karakterMm = metinGenisligiMm('M', yukseklikMm, dil);
  const sigar = Math.max(4, Math.floor(kullanilabilirMm / karakterMm));
  return ad.length <= sigar ? ad : ad.slice(0, sigar - 1) + '.';
}

/** Adı en fazla iki satıra böler (kelime sınırından); ikinci satır gerekirse kısaltılır. */
function adSatirlari(ad: string, kullanilabilirMm: number, yukseklikMm: number, dil: 'TSPL' | 'ZPL'): string[] {
  const sigar = Math.max(4, Math.floor(kullanilabilirMm / metinGenisligiMm('M', yukseklikMm, dil)));
  if (ad.length <= sigar) return [ad];
  const kelimeler = ad.split(/\s+/);
  let ilk = '';
  while (kelimeler.length > 0 && (ilk ? ilk.length + 1 : 0) + kelimeler[0]!.length <= sigar) {
    ilk = ilk ? `${ilk} ${kelimeler.shift()}` : kelimeler.shift()!;
  }
  // Tek kelime bile sığmıyorsa harften bölünür.
  if (!ilk) return [ad.slice(0, sigar), adKisalt(ad.slice(sigar), kullanilabilirMm, yukseklikMm, dil)];
  return [ilk, adKisalt(kelimeler.join(' '), kullanilabilirMm, yukseklikMm, dil)].filter(Boolean);
}

/** Hizaya göre x (mm); etiket kenarına dayanmaz. */
function hizaliX(hiza: EtiketHiza, genislikMm: number, enMm: number): number {
  if (hiza === 'orta') return Math.max(KENAR_MM, (enMm - genislikMm) / 2);
  if (hiza === 'sag') return Math.max(KENAR_MM, enMm - KENAR_MM - genislikMm);
  return KENAR_MM;
}

/**
 * Türkçe karakterler ASCII'ye indirilir.
 *
 * Etiket yazıcılarının gömülü fontları tek bayt kod sayfalarıyla çalışır ve
 * Türkçe harfleri ya yanlış basar ya hiç basmaz. Doğru kod sayfasını bulmak
 * sahada yazıcıya göre deneme gerektirdiğinden, "Ç" yerine boş kutu basmaktansa
 * "C" basmak yeğdir.
 */
/**
 * Türkçe harfleri CP1254'e (Windows Türkçe / Latin-5) taşır.
 *
 * Yalnız Latin-1'de KARŞILIĞI OLMAYAN altı harf çevrilir; ç ö ü Ç Ö Ü zaten
 * Latin-1'de aynı kod noktasında durur ve `latin1` kodlaması onları olduğu
 * gibi geçirir. Buradaki kod noktaları tek baytlık olduğu için `etiketBaytlari`
 * içindeki latin1 kodlaması doğru CP1254 baytını üretir.
 *
 * ₺ simgesi CP1254'te yoktur; "TL" yazmak boş kutu basmaktan iyidir.
 *
 * SAHADA DOĞRULANDI: Gainscha 4B-2074C üzerinde CODEPAGE 1254 ile Türkçenin
 * tamamı (I, i, İ, ı dahil) doğru basıldı; CP857 aynı yazıcıda i ailesini
 * bozuyordu.
 */
function cp1254eTasi(metin: string): string {
  const harita: Record<string, string> = {
    ğ: '\u00f0',
    Ğ: '\u00d0',
    ı: '\u00fd',
    İ: '\u00dd',
    ş: '\u00fe',
    Ş: '\u00de',
    '₺': 'TL',
  };
  return metin.replace(/[ğĞıİşŞ₺]/g, (h) => harita[h] ?? h);
}

function asciyeIndir(metin: string): string {
  const harita: Record<string, string> = {
    ç: 'c',
    Ç: 'C',
    ğ: 'g',
    Ğ: 'G',
    ı: 'i',
    İ: 'I',
    ö: 'o',
    Ö: 'O',
    ş: 's',
    Ş: 'S',
    ü: 'u',
    Ü: 'U',
    '₺': 'TL',
  };
  return metin.replace(/[çÇğĞıİöÖşŞüÜ₺]/g, (h) => harita[h] ?? h);
}

function birimEtiketi(birimTipi: string): string {
  return birimTipi === 'ADET' ? 'adet fiyati' : `${birimTipi.toLowerCase()} fiyati`;
}

/**
 * Etiketin yerleşimini milimetre cinsinden hesaplar — TEK KAYNAK.
 *
 * BARKOD GENİŞLİĞİ VERİYE BAĞLIDIR: CODE128'de karakter başına 11 modül düşer,
 * yani 13 haneli bir barkod 178 modül yer kaplar. Modül genişliği sabit
 * bırakılsaydı (yaygın varsayılan 2 nokta = 0,25 mm) bu barkod 44,5 mm eder ve
 * 40 mm'lik etiketten TAŞARDI — kağıda basılana kadar da fark edilmezdi.
 * Bu yüzden modül genişliği etikete göre hesaplanır ve okunabilirlik sınırının
 * altına düşerse uyarı üretilir.
 */
export function etiketYerlesimi(icerik: EtiketIcerigi, olcu: EtiketOlcusu, secenek: EtiketSecenekleri): EtiketYerlesimi {
  const ogeler: YerlesimOgesi[] = [];
  const uyarilar: string[] = [];
  const kullanilabilirMm = olcu.enMm - KENAR_MM * 2;
  const duzen = secenek.duzen ?? VARSAYILAN_ETIKET_DUZENI;
  const dil = secenek.dil ?? 'TSPL';
  let y = KENAR_MM;

  // Yazıcı Türkçe basabiliyorsa metin olduğu gibi kalır; basamıyorsa ASCII'ye iner.
  const yaz = (metin: string): string => (secenek.turkce ? metin : asciyeIndir(metin));
  /**
   * Metni ekler; etiketin enine SIĞMAZSA yazıyı küçültür (en fazla 2 mm'ye kadar)
   * ve uyarır. Büyük fiyat dar etikette kenardan taşıp kesik basılıyordu.
   * Döner: kullanılan yazı yüksekliği (sonraki satırın yeri buna göre).
   */
  const metinEkle = (metin: string, istenenMm: number, kalin: boolean, hiza: EtiketHiza, ad = ''): number => {
    let yukseklikMm = istenenMm;
    let genislikMm = metinGenisligiMm(metin, yukseklikMm, dil);
    while (genislikMm > kullanilabilirMm && yukseklikMm > 2) {
      yukseklikMm = Math.max(2, Math.round(yukseklikMm * 0.85 * 10) / 10);
      genislikMm = metinGenisligiMm(metin, yukseklikMm, dil);
    }
    if (ad && yukseklikMm < istenenMm) {
      uyarilar.push(
        `${ad} seçilen boyutta etikete sığmadı; küçültülerek basılacak. Boyutu küçültün ya da daha geniş etiket kullanın.`,
      );
    }
    ogeler.push({ tip: 'metin', xMm: hizaliX(hiza, genislikMm, olcu.enMm), yMm: y, metin, yukseklikMm, kalin, genislikMm });
    return yukseklikMm;
  };

  if (duzen.cerceve) {
    ogeler.push({ tip: 'cerceve', xMm: 0.5, yMm: 0.5, enMm: olcu.enMm - 1, boyMm: olcu.boyMm - 1, kalinlikMm: 0.3 });
  }

  const adYukseklik = ETIKET_AD_YUKSEKLIK[duzen.adBoyut];
  const adlar = duzen.adIkiSatir
    ? adSatirlari(yaz(icerik.ad), kullanilabilirMm, adYukseklik, dil)
    : [adKisalt(yaz(icerik.ad), kullanilabilirMm, adYukseklik, dil)];
  for (const satir of adlar) {
    y += metinEkle(satir, adYukseklik, true, duzen.adHiza) + 0.6;
  }
  y += 0.4;

  if (secenek.rafGoster && icerik.rafKonumu) {
    metinEkle(yaz(`Raf: ${icerik.rafKonumu}`), 2, false, duzen.adHiza);
    y += 3;
  }

  // Fiyat etiketin en büyük ve en okunur öğesidir; müşteri önce ona bakar.
  const fiyatYukseklik = ETIKET_FIYAT_YUKSEKLIK[duzen.fiyatBoyut];
  y += metinEkle(yaz(paraFormat(icerik.fiyat)), fiyatYukseklik, true, duzen.fiyatHiza, 'Fiyat') + 1;

  if (secenek.birimFiyatGoster && icerik.birimTipi !== 'ADET') {
    metinEkle(birimEtiketi(icerik.birimTipi), 2, false, duzen.fiyatHiza);
    y += 3;
  }

  // Tarih en alta yazılır; barkod onun yerini bırakır.
  const tarihPayi = duzen.tarihGoster && icerik.tarih ? 2.5 : 0;

  if (duzen.barkodGoster && icerik.barkod) {
    const cizim = etiketBarkodCizimi(icerik.barkod);
    if (!cizim) {
      uyarilar.push('Barkod kodlanamıyor (geçersiz karakter); etikette barkod basılmayacak.');
    } else {
      const noktaMm = 25.4 / olcu.dpi;
      // Modül genişliği etikete SIĞACAK şekilde seçilir; en fazla 4 nokta.
      // EAN'ın iki yanına sessiz bölge payı bırakılır: kenara dayanan EAN'ı okuyucular zor okur.
      const sessizModul = cizim.tur === 'CODE128' ? 0 : 8;
      const sigacakNokta = Math.floor(kullanilabilirMm / noktaMm / (cizim.toplamModul + sessizModul));
      const modulNokta = Math.max(1, Math.min(4, sigacakNokta));
      const modulMm = modulNokta * noktaMm;
      const genislikMm = cizim.toplamModul * modulMm;

      if (sigacakNokta < 1) {
        uyarilar.push(
          `Barkod (${icerik.barkod.length} hane) bu etikete sığmıyor: ${genislikMm.toFixed(1)} mm yer istiyor, ` +
            `${kullanilabilirMm.toFixed(1)} mm var. Daha geniş etiket kullanın ya da daha kısa bir barkod verin.`,
        );
      } else if (modulNokta < 2) {
        uyarilar.push('Barkod çok dar basılacak; bazı okuyucular okumakta zorlanabilir.');
      }

      // Barkod, kalan yüksekliği alır; okunabilmesi için en az 6 mm gerekir.
      const kalanMm = olcu.boyMm - y - KENAR_MM - 3 - tarihPayi; // 3 mm: altındaki okunur metin
      const yukseklikMm = Math.max(4, kalanMm);
      if (kalanMm < 6) uyarilar.push('Barkod yüksekliği 6 mm altında kalıyor; okuma güvenilirliği düşebilir.');

      ogeler.push({
        tip: 'barkod',
        xMm: hizaliX(duzen.barkodHiza, genislikMm, olcu.enMm),
        yMm: y,
        veri: icerik.barkod,
        yukseklikMm,
        modulMm,
        genislikMm,
        tur: cizim.tur,
      });
      y += yukseklikMm + 3;
    }
  }

  if (tarihPayi > 0 && icerik.tarih) {
    y = Math.max(y, olcu.boyMm - KENAR_MM - 2);
    metinEkle(icerik.tarih, 1.8, false, 'sag');
    y += 2;
  }

  if (y > olcu.boyMm) {
    uyarilar.push(
      `İçerik etiket boyunu aşıyor: ${y.toFixed(1)} mm yer istiyor, ${olcu.boyMm} mm var. ` +
        'Daha uzun etiket kullanın ya da yazıları küçültün / raf kodu, birim fiyat, ikinci ad satırını kapatın.',
    );
  }

  return { enMm: olcu.enMm, boyMm: olcu.boyMm, ogeler, uyarilar };
}

// ---------------------------------------------------------------------------
// TSPL — TSC, Argox, Godex, Xprinter
// ---------------------------------------------------------------------------

/**
 * İstenen mm yüksekliğine en yakın gömülü fontu ve çarpanını bulur.
 * TSPL fontları sabit boyutludur; ara boyutlar çarpanla elde edilir.
 */
function tsplFont(yukseklikMm: number): { font: string; carpan: number } {
  const adaylar: { font: string; mm: number }[] = [
    { font: '1', mm: 1.5 },
    { font: '2', mm: 2.5 },
    { font: '3', mm: 3 },
    { font: '4', mm: 4 },
    { font: '5', mm: 6 },
  ];
  let enIyi = adaylar[0]!;
  let enIyiCarpan = 1;
  let enIyiFark = Infinity;
  for (const aday of adaylar) {
    for (const carpan of [1, 2, 3]) {
      const fark = Math.abs(aday.mm * carpan - yukseklikMm);
      if (fark < enIyiFark) {
        enIyiFark = fark;
        enIyi = aday;
        enIyiCarpan = carpan;
      }
    }
  }
  return { font: enIyi.font, carpan: enIyiCarpan };
}

function tspl(yerlesim: EtiketYerlesimi, olcu: EtiketOlcusu, adet: number): string {
  const satirlar: string[] = [
    `SIZE ${olcu.enMm} mm,${olcu.boyMm} mm`,
    `GAP ${olcu.boslukMm} mm,0 mm`,
    `DENSITY ${Math.min(15, Math.max(0, olcu.isi))}`,
    `SPEED ${Math.min(12, Math.max(1, olcu.hiz))}`,
    'DIRECTION 1',
    /*
     * Kod sayfası HER İŞTE yeniden bildirilir; yazıcı bir önceki işten kalan
     * ayarı taşıyabilir ve etiket sessizce yanlış harflerle çıkar.
     */
    'CODEPAGE 1254',
    'CLS',
  ];

  for (const oge of yerlesim.ogeler) {
    const x = nokta(oge.xMm, olcu.dpi);
    const y = nokta(oge.yMm, olcu.dpi);
    if (oge.tip === 'metin') {
      const { font, carpan } = tsplFont(oge.yukseklikMm);
      satirlar.push(`TEXT ${x},${y},"${font}",0,${carpan},${carpan},"${cp1254eTasi(oge.metin)}"`);
    } else if (oge.tip === 'barkod') {
      const modulNokta = Math.max(1, Math.round(oge.modulMm / (25.4 / olcu.dpi)));
      const h = nokta(oge.yukseklikMm, olcu.dpi);
      /*
       * EAN'da kontrol hanesini yazıcı hesaplar (12/7 hane gider). CODE128'de
       * "128M" + "!104" B kümesini ZORLAR: "128" otomatik kipte yazıcı rakamları
       * C kümesine sıkıştırıp önizlemeden dar basıyordu.
       */
      if (oge.tur === 'EAN13')
        satirlar.push(`BARCODE ${x},${y},"EAN13",${h},1,0,${modulNokta},${modulNokta},"${oge.veri.slice(0, 12)}"`);
      else if (oge.tur === 'EAN8')
        satirlar.push(`BARCODE ${x},${y},"EAN8",${h},1,0,${modulNokta},${modulNokta},"${oge.veri.slice(0, 7)}"`);
      else satirlar.push(`BARCODE ${x},${y},"128M",${h},1,0,${modulNokta},${modulNokta * 2},"!104${oge.veri}"`);
    } else {
      satirlar.push(
        `BOX ${x},${y},${nokta(oge.xMm + oge.enMm, olcu.dpi) - 1},${nokta(oge.yMm + oge.boyMm, olcu.dpi) - 1},` +
          `${Math.max(1, nokta(oge.kalinlikMm, olcu.dpi))}`,
      );
    }
  }

  satirlar.push(`PRINT ${Math.max(1, adet)},1`);
  return satirlar.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// ZPL — Zebra
// ---------------------------------------------------------------------------

function zpl(yerlesim: EtiketYerlesimi, olcu: EtiketOlcusu, adet: number): string {
  const { dpi } = olcu;
  const parcalar: string[] = [
    '^XA',
    `^PW${nokta(olcu.enMm, dpi)}`,
    `^LL${nokta(olcu.boyMm, dpi)}`,
    `^MD${Math.min(30, Math.max(0, olcu.isi * 2))}`,
    `^PR${Math.min(12, Math.max(1, olcu.hiz))}`,
    '^LH0,0',
  ];

  for (const oge of yerlesim.ogeler) {
    const x = nokta(oge.xMm, dpi);
    const y = nokta(oge.yMm, dpi);
    if (oge.tip === 'metin') {
      const h = nokta(oge.yukseklikMm, dpi);
      parcalar.push(`^FO${x},${y}^A0N,${h},${Math.round(h * 0.6)}^FD${oge.metin}^FS`);
    } else if (oge.tip === 'barkod') {
      const modulNokta = Math.max(1, Math.round(oge.modulMm / (25.4 / dpi)));
      const h = nokta(oge.yukseklikMm, dpi);
      if (oge.tur === 'EAN13') parcalar.push(`^FO${x},${y}^BY${modulNokta}^BEN,${h},Y,N^FD${oge.veri.slice(0, 12)}^FS`);
      else if (oge.tur === 'EAN8') parcalar.push(`^FO${x},${y}^BY${modulNokta}^B8N,${h},Y,N^FD${oge.veri.slice(0, 7)}^FS`);
      // ">:" B kümesiyle başlatır — önizlemeyle aynı genişlik.
      else parcalar.push(`^FO${x},${y}^BY${modulNokta}^BCN,${h},Y,N,N^FD>:${oge.veri}^FS`);
    } else {
      parcalar.push(
        `^FO${x},${y}^GB${nokta(oge.enMm, dpi) - 1},${nokta(oge.boyMm, dpi) - 1},${Math.max(1, nokta(oge.kalinlikMm, dpi))}^FS`,
      );
    }
  }

  parcalar.push(`^PQ${Math.max(1, adet)}`, '^XZ');
  return parcalar.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Dışa açılan
// ---------------------------------------------------------------------------

export function etiketBaytlari(
  dil: 'TSPL' | 'ZPL',
  icerik: EtiketIcerigi,
  olcu: EtiketOlcusu,
  secenek: EtiketSecenekleri,
): Buffer {
  const yerlesim = etiketYerlesimi(icerik, olcu, secenek);
  const metin = dil === 'ZPL' ? zpl(yerlesim, olcu, icerik.adet) : tspl(yerlesim, olcu, icerik.adet);
  // Etiket yazıcıları tek baytlık kod sayfası bekler; içerik ASCII'ye indirildi.
  return Buffer.from(metin, 'latin1');
}

// ---------------------------------------------------------------------------
// Görüntü olarak basma — Türkçe harfler ve barkod önizlemedeki gibi
// ---------------------------------------------------------------------------

function xmlKacir(metin: string): string {
  return metin.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Yerleşimi, etiketin nokta ölçüsünde bir SVG sayfasına çizer.
 *
 * Önizlemeyle AYNI çizim: metin yazıcı fontunun genişliğine sığdırılır
 * (`textLength`), barkod çubukları tam nokta genişliğinde çizilir
 * (`crispEdges`) — kesirli genişlik okuyucuyu şaşırtır.
 */
export function etiketSvgSayfasi(yerlesim: EtiketYerlesimi, dpi: number): { html: string; enNokta: number; boyNokta: number } {
  const enNokta = nokta(yerlesim.enMm, dpi);
  const boyNokta = nokta(yerlesim.boyMm, dpi);
  const parcalar: string[] = [];
  for (const oge of yerlesim.ogeler) {
    if (oge.tip === 'cerceve') {
      const k = oge.kalinlikMm;
      parcalar.push(
        `<rect x="${oge.xMm + k / 2}" y="${oge.yMm + k / 2}" width="${oge.enMm - k}" height="${oge.boyMm - k}" fill="none" stroke="#000" stroke-width="${k}"/>`,
      );
    } else if (oge.tip === 'metin') {
      const uzunluk = oge.genislikMm ? ` textLength="${oge.genislikMm}" lengthAdjust="spacingAndGlyphs"` : '';
      parcalar.push(
        `<text x="${oge.xMm}" y="${oge.yMm + oge.yukseklikMm * 0.82}" font-size="${oge.yukseklikMm}" font-weight="${oge.kalin ? 700 : 400}"${uzunluk}>${xmlKacir(oge.metin)}</text>`,
      );
    } else {
      const cizim = etiketBarkodCizimi(oge.veri);
      if (!cizim) continue;
      let x = oge.xMm;
      cizim.desenler.forEach((modul, sira) => {
        const en = modul * oge.modulMm;
        if (sira % 2 === 0)
          parcalar.push(`<rect x="${x}" y="${oge.yMm}" width="${en}" height="${oge.yukseklikMm}" fill="#000"/>`);
        x += en;
      });
      parcalar.push(
        `<text x="${oge.xMm + oge.genislikMm / 2}" y="${oge.yMm + oge.yukseklikMm + 2.2}" font-size="2.2" text-anchor="middle">${xmlKacir(oge.veri)}</text>`,
      );
    }
  }
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{background:#fff}` +
    `svg{display:block}text{font-family:Arial,Helvetica,"Liberation Sans",sans-serif;fill:#000}</style></head><body>` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${enNokta}" height="${boyNokta}" viewBox="0 0 ${yerlesim.enMm} ${yerlesim.boyMm}" shape-rendering="crispEdges">` +
    parcalar.join('') +
    `</svg></body></html>`;
  return { html, enNokta, boyNokta };
}

/**
 * 1-bit görüntüyü (satır başına paketli, 1 = siyah) yazıcı komutuna çevirir.
 *
 * TSPL `BITMAP`'te 0 biti BASILAN noktadır — bitler ters çevrilir. ZPL `^GFA`
 * 1'i basar, olduğu gibi gider.
 */
export function etiketGorselKomutu(
  dil: 'TSPL' | 'ZPL',
  bitler: Uint8Array,
  enNokta: number,
  boy: number,
  olcu: EtiketOlcusu,
  adet: number,
): Buffer {
  const satirBayti = Math.ceil(enNokta / 8);
  if (dil === 'ZPL') {
    const hex = Buffer.from(bitler).toString('hex').toUpperCase();
    const govde = [
      '^XA',
      `^PW${nokta(olcu.enMm, olcu.dpi)}`,
      `^LL${nokta(olcu.boyMm, olcu.dpi)}`,
      `^MD${Math.min(30, Math.max(0, olcu.isi * 2))}`,
      `^PR${Math.min(12, Math.max(1, olcu.hiz))}`,
      '^LH0,0',
      `^FO0,0^GFA,${bitler.length},${bitler.length},${satirBayti},${hex}^FS`,
      `^PQ${Math.max(1, adet)}`,
      '^XZ',
    ].join('\n');
    return Buffer.from(govde + '\n', 'latin1');
  }
  const ters = Buffer.from(bitler.map((b) => ~b & 0xff));
  const bas = [
    `SIZE ${olcu.enMm} mm,${olcu.boyMm} mm`,
    `GAP ${olcu.boslukMm} mm,0 mm`,
    `DENSITY ${Math.min(15, Math.max(0, olcu.isi))}`,
    `SPEED ${Math.min(12, Math.max(1, olcu.hiz))}`,
    'DIRECTION 1',
    'CLS',
    `BITMAP 0,0,${satirBayti},${boy},0,`,
  ].join('\r\n');
  return Buffer.concat([Buffer.from(bas, 'latin1'), ters, Buffer.from(`\r\nPRINT ${Math.max(1, adet)},1\r\n`, 'latin1')]);
}

/**
 * Kalibrasyon etiketi — ölçü doğru mu, gözle anlaşılsın diye.
 *
 * Etiketin dört kenarına çerçeve çizer. Çerçeve etikete tam oturuyorsa ayar
 * doğrudur; taşıyor ya da içeride kalıyorsa mm değerleri düzeltilir. Barkod
 * yazıcılarında ölçü tutturmak deneme yanılma işidir.
 */
export function kalibrasyonYerlesimi(olcu: EtiketOlcusu): EtiketYerlesimi {
  return {
    enMm: olcu.enMm,
    boyMm: olcu.boyMm,
    uyarilar: [],
    ogeler: [
      { tip: 'cerceve', xMm: 0, yMm: 0, enMm: olcu.enMm, boyMm: olcu.boyMm, kalinlikMm: 0.4 },
      { tip: 'metin', xMm: 3, yMm: 3, metin: 'KALIBRASYON', yukseklikMm: 3, kalin: true },
      { tip: 'metin', xMm: 3, yMm: 8, metin: `${olcu.enMm}x${olcu.boyMm}mm ${olcu.dpi}dpi`, yukseklikMm: 2.5, kalin: false },
      { tip: 'metin', xMm: 3, yMm: 12, metin: 'Cerceve etikete otursun', yukseklikMm: 2.5, kalin: false },
    ],
  };
}

export function kalibrasyonEtiketi(dil: 'TSPL' | 'ZPL', olcu: EtiketOlcusu): Buffer {
  const yerlesim = kalibrasyonYerlesimi(olcu);
  const metin = dil === 'ZPL' ? zpl(yerlesim, olcu, 1) : tspl(yerlesim, olcu, 1);
  return Buffer.from(metin, 'latin1');
}
