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

import { code128Cizimi, paraFormat, type Kurus } from '@market/shared';

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
}

export interface EtiketSecenekleri {
  rafGoster: boolean;
  birimFiyatGoster: boolean;
}

export type YerlesimOgesi =
  | { tip: 'metin'; xMm: number; yMm: number; metin: string; yukseklikMm: number; kalin: boolean }
  | { tip: 'barkod'; xMm: number; yMm: number; veri: string; yukseklikMm: number; modulMm: number; genislikMm: number }
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

/**
 * Uzun ürün adını etikete sığdırır.
 *
 * Kesme YAZI GENİŞLİĞİNE göre yapılır, sabit karakter sayısına göre değil:
 * 30 mm'lik etikete 40 mm'likten daha az harf sığar.
 */
function adKisalt(ad: string, kullanilabilirMm: number, yukseklikMm: number): string {
  // Gömülü fontlarda ortalama karakter genişliği ≈ yüksekliğin %55'i.
  const karakterMm = yukseklikMm * 0.55;
  const sigar = Math.max(4, Math.floor(kullanilabilirMm / karakterMm));
  return ad.length <= sigar ? ad : ad.slice(0, sigar - 1) + '.';
}

/**
 * Türkçe karakterler ASCII'ye indirilir.
 *
 * Etiket yazıcılarının gömülü fontları tek bayt kod sayfalarıyla çalışır ve
 * Türkçe harfleri ya yanlış basar ya hiç basmaz. Doğru kod sayfasını bulmak
 * sahada yazıcıya göre deneme gerektirdiğinden, "Ç" yerine boş kutu basmaktansa
 * "C" basmak yeğdir.
 */
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
  let y = KENAR_MM;

  const adYukseklik = 3;
  ogeler.push({
    tip: 'metin',
    xMm: KENAR_MM,
    yMm: y,
    metin: asciyeIndir(adKisalt(icerik.ad, kullanilabilirMm, adYukseklik)),
    yukseklikMm: adYukseklik,
    kalin: true,
  });
  y += adYukseklik + 1;

  if (secenek.rafGoster && icerik.rafKonumu) {
    ogeler.push({
      tip: 'metin',
      xMm: KENAR_MM,
      yMm: y,
      metin: asciyeIndir(`Raf: ${icerik.rafKonumu}`),
      yukseklikMm: 2,
      kalin: false,
    });
    y += 3;
  }

  // Fiyat etiketin en büyük ve en okunur öğesidir; müşteri önce ona bakar.
  const fiyatYukseklik = 6;
  ogeler.push({
    tip: 'metin',
    xMm: KENAR_MM,
    yMm: y,
    metin: asciyeIndir(paraFormat(icerik.fiyat)),
    yukseklikMm: fiyatYukseklik,
    kalin: true,
  });
  y += fiyatYukseklik + 1;

  if (secenek.birimFiyatGoster && icerik.birimTipi !== 'ADET') {
    ogeler.push({
      tip: 'metin',
      xMm: KENAR_MM,
      yMm: y,
      metin: birimEtiketi(icerik.birimTipi),
      yukseklikMm: 2,
      kalin: false,
    });
    y += 3;
  }

  if (icerik.barkod) {
    const cizim = code128Cizimi(icerik.barkod);
    if (!cizim) {
      uyarilar.push('Barkod CODE128 ile kodlanamıyor; etikette barkod basılmayacak.');
    } else {
      const noktaMm = 25.4 / olcu.dpi;
      // Modül genişliği etikete SIĞACAK şekilde seçilir; en fazla 4 nokta.
      const sigacakNokta = Math.floor(kullanilabilirMm / noktaMm / cizim.toplamModul);
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
      const kalanMm = olcu.boyMm - y - KENAR_MM - 3; // 3 mm: altındaki okunur metin
      const yukseklikMm = Math.max(4, kalanMm);
      if (kalanMm < 6) uyarilar.push('Barkod yüksekliği 6 mm altında kalıyor; okuma güvenilirliği düşebilir.');

      ogeler.push({
        tip: 'barkod',
        xMm: KENAR_MM,
        yMm: y,
        veri: icerik.barkod,
        yukseklikMm,
        modulMm,
        genislikMm,
      });
      y += yukseklikMm + 3;
    }
  }

  if (y > olcu.boyMm) {
    uyarilar.push(
      `İçerik etiket boyunu aşıyor: ${y.toFixed(1)} mm yer istiyor, ${olcu.boyMm} mm var. ` +
        'Daha uzun etiket kullanın ya da raf kodu / birim fiyat satırlarını kapatın.',
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
    'CLS',
  ];

  for (const oge of yerlesim.ogeler) {
    const x = nokta(oge.xMm, olcu.dpi);
    const y = nokta(oge.yMm, olcu.dpi);
    if (oge.tip === 'metin') {
      const { font, carpan } = tsplFont(oge.yukseklikMm);
      satirlar.push(`TEXT ${x},${y},"${font}",0,${carpan},${carpan},"${oge.metin}"`);
    } else if (oge.tip === 'barkod') {
      const modulNokta = Math.max(1, Math.round(oge.modulMm / (25.4 / olcu.dpi)));
      satirlar.push(
        `BARCODE ${x},${y},"128",${nokta(oge.yukseklikMm, olcu.dpi)},1,0,${modulNokta},${modulNokta * 2},"${oge.veri}"`,
      );
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
      parcalar.push(`^FO${x},${y}^BY${modulNokta}^BCN,${nokta(oge.yukseklikMm, dpi)},Y,N,N^FD${oge.veri}^FS`);
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
