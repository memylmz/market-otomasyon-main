/**
 * İade kuralları — kasa ve panel ORTAK kullanır (§10.4).
 */

export type IadeYontemi = 'NAKIT' | 'KART' | 'VERESIYE';

/**
 * İade şeklinin varsayılanı: para müşteriye GELDİĞİ yoldan döner.
 *
 * - Satışta veresiye pay varsa iade cari hesaba (borçtan düşülür). Müşteri
 *   ödemediği malın parasını kasadan almamalı.
 * - Yalnız kartla ödenmişse karta.
 * - Aksi hâlde nakit.
 *
 * Yalnız VARSAYILANDIR; kasiyer gerekçesiyle değiştirebilir.
 */
export function varsayilanIadeYontemi(odemeler: readonly { odeme_tipi: string; tutar: number }[]): IadeYontemi {
  const dolu = odemeler.filter((o) => o.tutar !== 0);
  if (dolu.some((o) => o.odeme_tipi === 'VERESIYE')) return 'VERESIYE';
  if (dolu.length > 0 && dolu.every((o) => o.odeme_tipi === 'KART')) return 'KART';
  return 'NAKIT';
}

/** İade fişinde ve ekranlarda ödeme satırının adı — satıştakinden farklıdır. */
export const IADE_YONTEMI_ETIKETI: Record<IadeYontemi, string> = {
  NAKIT: 'Nakit iade',
  KART: 'Karta iade',
  VERESIYE: 'Cari hesaba alacak',
};
