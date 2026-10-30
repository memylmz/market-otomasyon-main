/**
 * FATURA DÜZENLEME SINIRI (VUK 232) — yıl yıl, AYARDAN.
 *
 * Tek seferlik satış bu tutara ULAŞIRSA yazarkasa fişi yetmez, fatura
 * (Pavo'nun e-Arşiv / e-Fatura'sı) zorunlu. Sınır her yıl Aralık sonunda
 * Resmi Gazete'deki VUK tebliğiyle değişir; koda gömülmez — `fatura.sinirlar`
 * ayarından okunur, yönetici Ayarlar → Satış Kuralları'ndan girer. Aşağıdaki
 * değerler yalnız ayar hiç girilmemişken kullanılan BAŞLANGIÇTIR (Cybele ile
 * aynı); kesin tutarı mali müşavir / Resmi Gazete'den doğrulayın.
 *
 * Yasal not: aynı alıcıya aynı gün yapılan satışların toplamı sınırı aşıyorsa
 * hepsi için fatura gerekir — satışı bölmek zorunluluğu kaldırmaz.
 */

import type { Kurus } from './para.js';

/** Yıl → sınır (kuruş, KDV dahil). */
export const VARSAYILAN_FATURA_SINIRLARI: Readonly<Record<number, Kurus>> = {
  2025: 990_000,
  2026: 1_200_000,
};

export type FaturaSinirlari = Record<number, Kurus>;

/** Ayardaki JSON'dan (`{"2026": 1200000}`); geçersiz satırlar atlanır, başlangıç değerleri altta durur. */
export function faturaSinirlariCoz(ham: string | null | undefined): FaturaSinirlari {
  const sonuc: FaturaSinirlari = { ...VARSAYILAN_FATURA_SINIRLARI };
  let veri: unknown = null;
  try {
    veri = ham ? JSON.parse(ham) : null;
  } catch {
    veri = null;
  }
  if (veri && typeof veri === 'object' && !Array.isArray(veri)) {
    for (const [anahtar, deger] of Object.entries(veri as Record<string, unknown>)) {
      const yil = Number(anahtar);
      if (!Number.isInteger(yil) || yil < 2000 || yil > 2100) continue;
      if (typeof deger === 'number' && Number.isFinite(deger) && deger > 0) sonuc[yil] = Math.round(deger);
    }
  }
  return sonuc;
}

/**
 * [tarih] için geçerli sınır. O yılın tutarı girilmemişse SON BİLİNEN yılınki
 * kullanılır ve `eksik: true` döner (yöneticiye uyarı).
 */
export function faturaSiniriIcin(
  sinirlar: FaturaSinirlari,
  tarih: Date = new Date(),
): { tutar: Kurus; yil: number; eksik: boolean } {
  const yil = tarih.getFullYear();
  const tam = sinirlar[yil];
  if (tam !== undefined) return { tutar: tam, yil, eksik: false };
  const yillar = Object.keys(sinirlar)
    .map(Number)
    .sort((a, b) => a - b);
  const onceki = yillar.filter((y) => y < yil);
  const secilen = onceki.length > 0 ? onceki[onceki.length - 1]! : (yillar[0] ?? 2026);
  return { tutar: sinirlar[secilen] ?? VARSAYILAN_FATURA_SINIRLARI[2026]!, yil: secilen, eksik: true };
}

/** Tutar sınıra ULAŞTI mı ("12.000 TL ve üzeri"). */
export function faturaZorunlu(tutar: Kurus, sinir: Kurus): boolean {
  return sinir > 0 && tutar >= sinir;
}
