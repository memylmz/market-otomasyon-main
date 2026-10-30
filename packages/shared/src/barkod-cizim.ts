/**
 * CODE128 çizim desenleri — YALNIZ ÖNİZLEME İÇİN (§13.2, §13.3).
 *
 * Gerçek baskıda barkodu yazıcı kendisi üretir; buradaki kod ona hiç
 * karışmaz. Amaç ekrandaki önizlemenin kağıttakiyle aynı yeri kaplaması:
 * CODE128'in genişliği VERİYE BAĞLIDIR (karakter başına 11 modül), yani
 * 8 haneli bir barkod ile 13 haneli barkod aynı yere sığmaz. Önizlemede
 * temsili bir dikdörtgen çizilseydi "sığıyor mu" sorusu yanıtsız kalır,
 * kullanıcı ancak kağıda basınca görürdü.
 */

/**
 * CODE128 desen tablosu: her değer 6 öğenin (çubuk/boşluk) modül genişliği.
 * Son öğe (106) bitiş desenidir ve 7 öğelidir.
 */
const DESENLER = [
  '212222',
  '222122',
  '222221',
  '121223',
  '121322',
  '131222',
  '122213',
  '122312',
  '132212',
  '221213',
  '221312',
  '231212',
  '112232',
  '122132',
  '122231',
  '113222',
  '123122',
  '123221',
  '223211',
  '221132',
  '221231',
  '213212',
  '223112',
  '312131',
  '311222',
  '321122',
  '321221',
  '312212',
  '322112',
  '322211',
  '212123',
  '212321',
  '232121',
  '111323',
  '131123',
  '131321',
  '112313',
  '132113',
  '132311',
  '211313',
  '231113',
  '231311',
  '112133',
  '112331',
  '132131',
  '113123',
  '113321',
  '133121',
  '313121',
  '211331',
  '231131',
  '213113',
  '213311',
  '213131',
  '311123',
  '311321',
  '331121',
  '312113',
  '312311',
  '332111',
  '314111',
  '221411',
  '431111',
  '111224',
  '111422',
  '121124',
  '121421',
  '141122',
  '141221',
  '112214',
  '112412',
  '122114',
  '122411',
  '142112',
  '142211',
  '241211',
  '221114',
  '413111',
  '241112',
  '134111',
  '111242',
  '121142',
  '121241',
  '114212',
  '124112',
  '124211',
  '411212',
  '421112',
  '421211',
  '212141',
  '214121',
  '412121',
  '111143',
  '111341',
  '131141',
  '114113',
  '114311',
  '411113',
  '411311',
  '113141',
  '114131',
  '311141',
  '411131',
  '211412',
  '211214',
  '211232',
  '2331112',
] as const;

const BASLANGIC_B = 104;
const BITIS = 106;

export interface BarkodCizimi {
  /** Çubuk ve boşlukların sırayla modül genişlikleri. İlk öğe ÇUBUKTUR. */
  desenler: number[];
  /** Toplam modül sayısı — genişliği hesaplamak için. */
  toplamModul: number;
  /** Okunabilir metin (HRI) — yazıcı da altına bunu basar. */
  metin: string;
}

/**
 * CODE128-B kodlaması.
 *
 * Yalnız B kümesi kullanılır: yazdırma katmanı da (`escpos.ts`) `{B` öneki ile
 * B kümesine geçer. Önizlemenin baskıyla aynı genişlikte çıkması için ikisinin
 * aynı kümeyi kullanması gerekir.
 */
export function code128Cizimi(veri: string): BarkodCizimi | null {
  // B kümesi ASCII 32-126 taşır; dışındaki karakter varsa çizim yapılmaz.
  if (!veri || [...veri].some((k) => k.charCodeAt(0) < 32 || k.charCodeAt(0) > 126)) return null;

  const degerler = [...veri].map((k) => k.charCodeAt(0) - 32);
  let toplam = BASLANGIC_B;
  degerler.forEach((deger, sira) => {
    toplam += deger * (sira + 1);
  });
  const kontrol = toplam % 103;

  const kodlar = [BASLANGIC_B, ...degerler, kontrol, BITIS];
  const desenler: number[] = [];
  for (const kod of kodlar) {
    const desen = DESENLER[kod];
    if (!desen) return null;
    for (const basamak of desen) desenler.push(Number(basamak));
  }

  return { desenler, toplamModul: desenler.reduce((t, d) => t + d, 0), metin: veri };
}

// ---------------------------------------------------------------------------
// EAN-13 / EAN-8 — raf etiketi
// ---------------------------------------------------------------------------

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
/** Soldaki 6 hanenin L/G düzeni ilk haneye göre seçilir (ilk hane böyle kodlanır). */
const EAN13_PARITE = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function eanKontrolTutuyorMu(veri: string): boolean {
  const govde = [...veri.slice(0, -1)].reverse().map(Number);
  const toplam = govde.reduce((t, d, i) => t + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (toplam % 10)) % 10 === Number(veri.slice(-1));
}

/** "1011..." bit dizisini çubuk/boşluk modül genişliklerine çevirir (ilk öğe çubuk). */
function bitlerdenDesen(bitler: string): number[] {
  const desen: number[] = [];
  let sayac = 1;
  for (let i = 1; i <= bitler.length; i++) {
    if (bitler[i] === bitler[i - 1]) sayac++;
    else {
      desen.push(sayac);
      sayac = 1;
    }
  }
  return desen;
}

/** EAN-13 çizimi (95 modül); geçersiz veride null. */
export function ean13Cizimi(veri: string): BarkodCizimi | null {
  if (!/^\d{13}$/.test(veri) || !eanKontrolTutuyorMu(veri)) return null;
  const d = [...veri].map(Number);
  const parite = EAN13_PARITE[d[0]!]!;
  let bitler = '101';
  for (let i = 1; i <= 6; i++) {
    const l = EAN_L[d[i]!]!;
    bitler += parite[i - 1] === 'L' ? l : [...EAN_R[d[i]!]!].reverse().join('');
  }
  bitler += '01010';
  for (let i = 7; i <= 12; i++) bitler += EAN_R[d[i]!]!;
  bitler += '101';
  return { desenler: bitlerdenDesen(bitler), toplamModul: bitler.length, metin: veri };
}

/** EAN-8 çizimi (67 modül); geçersiz veride null. */
export function ean8Cizimi(veri: string): BarkodCizimi | null {
  if (!/^\d{8}$/.test(veri) || !eanKontrolTutuyorMu(veri)) return null;
  const d = [...veri].map(Number);
  let bitler = '101';
  for (let i = 0; i < 4; i++) bitler += EAN_L[d[i]!]!;
  bitler += '01010';
  for (let i = 4; i < 8; i++) bitler += EAN_R[d[i]!]!;
  bitler += '101';
  return { desenler: bitlerdenDesen(bitler), toplamModul: bitler.length, metin: veri };
}

export type EtiketBarkodTuru = 'EAN13' | 'EAN8' | 'CODE128';

/**
 * Raf etiketinde barkodun türü ve çizimi — önizleme ve yazıcı AYNI seçimi yapar.
 *
 * Market ürününün barkodu çoğunlukla EAN-13'tür; etikete de EAN-13 olarak
 * basılır (95 modül, sabit genişlik). Eskiden her barkod CODE128 basılıyordu:
 * önizleme B kümesiyle 178 modül hesaplarken yazıcı rakamları C kümesine
 * sıkıştırıp ~112 modül basıyor, kâğıttaki barkod önizlemenin üçte ikisi
 * kadar çıkıyordu. EAN olmayan kod CODE128-B kalır (yazıcıya da B kümesi
 * zorlanır).
 */
export function etiketBarkodCizimi(veri: string): (BarkodCizimi & { tur: EtiketBarkodTuru }) | null {
  const ean13 = ean13Cizimi(veri);
  if (ean13) return { ...ean13, tur: 'EAN13' };
  const ean8 = ean8Cizimi(veri);
  if (ean8) return { ...ean8, tur: 'EAN8' };
  const c = code128Cizimi(veri);
  return c ? { ...c, tur: 'CODE128' } : null;
}
