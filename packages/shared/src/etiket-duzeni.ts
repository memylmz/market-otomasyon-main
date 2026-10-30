/**
 * Raf etiketi DÜZENİ — ürün adı, fiyat ve barkodun yeri ve büyüklüğü
 * (Ayarlar → Donanım → Etiket Yazıcısı → Etiket düzeni).
 *
 * Tek JSON ayarında (`etiket.duzen`) durur; okunamayan alan varsayılana düşer.
 * Varsayılan, bu ayar yokken basılan etiketin AYNISIDIR (her şey sola yaslı,
 * ad 3 mm, fiyat 6 mm) — güncelleme sonrası raftaki etiketler değişmesin.
 */

export type EtiketHiza = 'sol' | 'orta' | 'sag';
export type EtiketBoyut = 'kucuk' | 'normal' | 'buyuk';

export interface EtiketDuzeni {
  adHiza: EtiketHiza;
  adBoyut: EtiketBoyut;
  /** Uzun ad ikinci satıra kaysın mı (kısaltmak yerine). */
  adIkiSatir: boolean;
  fiyatHiza: EtiketHiza;
  fiyatBoyut: EtiketBoyut;
  barkodGoster: boolean;
  barkodHiza: EtiketHiza;
  /** Etiketin kenarına çerçeve. */
  cerceve: boolean;
  /** Basım tarihi (küçük, en altta) — rafta hangi etiketin eski olduğu anlaşılsın. */
  tarihGoster: boolean;
}

export const VARSAYILAN_ETIKET_DUZENI: EtiketDuzeni = {
  adHiza: 'sol',
  adBoyut: 'normal',
  adIkiSatir: false,
  fiyatHiza: 'sol',
  fiyatBoyut: 'normal',
  barkodGoster: true,
  barkodHiza: 'sol',
  cerceve: false,
  tarihGoster: false,
};

/** Yazı yüksekliği (mm). */
export const ETIKET_AD_YUKSEKLIK: Record<EtiketBoyut, number> = { kucuk: 2.5, normal: 3, buyuk: 4 };
export const ETIKET_FIYAT_YUKSEKLIK: Record<EtiketBoyut, number> = { kucuk: 4, normal: 6, buyuk: 8 };

export function etiketDuzeniCoz(ham: string | null | undefined): EtiketDuzeni {
  let veri: Record<string, unknown> = {};
  try {
    const c: unknown = ham ? JSON.parse(ham) : {};
    if (c && typeof c === 'object' && !Array.isArray(c)) veri = c as Record<string, unknown>;
  } catch {
    veri = {};
  }
  const v = VARSAYILAN_ETIKET_DUZENI;
  const hiza = (k: keyof EtiketDuzeni): EtiketHiza => {
    const d = veri[k];
    return d === 'sol' || d === 'orta' || d === 'sag' ? d : (v[k] as EtiketHiza);
  };
  const boyut = (k: keyof EtiketDuzeni): EtiketBoyut => {
    const d = veri[k];
    return d === 'kucuk' || d === 'normal' || d === 'buyuk' ? d : (v[k] as EtiketBoyut);
  };
  const bool = (k: keyof EtiketDuzeni): boolean => (typeof veri[k] === 'boolean' ? (veri[k] as boolean) : (v[k] as boolean));
  return {
    adHiza: hiza('adHiza'),
    adBoyut: boyut('adBoyut'),
    adIkiSatir: bool('adIkiSatir'),
    fiyatHiza: hiza('fiyatHiza'),
    fiyatBoyut: boyut('fiyatBoyut'),
    barkodGoster: bool('barkodGoster'),
    barkodHiza: hiza('barkodHiza'),
    cerceve: bool('cerceve'),
    tarihGoster: bool('tarihGoster'),
  };
}
