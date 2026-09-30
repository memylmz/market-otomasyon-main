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

export type ParaYolu = 'NAKIT' | 'KART';

/**
 * Tahsilat / tedarikçi ödemesi iptalinde "para nasıl geri döndü" seçenekleri
 * (kasa ve panel aynı metni gösterir). Yön harekete göre değişir: müşteriye
 * geri ödeme kasadan ÇIKAR, tedarikçinin iadesi kasaya GİRER.
 */
export function iptalParaYollari(hareketTipi: string): Record<ParaYolu, { baslik: string; alt: string }> {
  const odeme = hareketTipi === 'ODEME';
  return {
    NAKIT: odeme
      ? { baslik: 'Tedarikçi nakit iade etti', alt: 'Tutar kasaya girer (açık kasa gerekir).' }
      : { baslik: 'Müşteriye nakit geri verildi', alt: 'Tutar kasadan çıkar (açık kasa gerekir).' },
    KART: odeme
      ? { baslik: 'Karta / hesaba iade edildi', alt: 'Kasa etkilenmez; yalnız tedarikçi borcu geri yüklenir.' }
      : { baslik: 'Karta iade edildi', alt: 'Kasa etkilenmez; yalnız müşteri borcu geri yüklenir.' },
  };
}
