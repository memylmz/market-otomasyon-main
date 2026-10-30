import { describe, expect, it } from 'vitest';
import { faturaSinirlariCoz, faturaSiniriIcin, faturaZorunlu, VARSAYILAN_FATURA_SINIRLARI } from '../src/fatura-siniri.js';

describe('fatura düzenleme sınırı (VUK 232)', () => {
  it('ayar yoksa başlangıç değerleri, bozuk satırlar atlanır', () => {
    expect(faturaSinirlariCoz(undefined)).toEqual(VARSAYILAN_FATURA_SINIRLARI);
    expect(faturaSinirlariCoz('{bozuk')).toEqual(VARSAYILAN_FATURA_SINIRLARI);
    expect(faturaSinirlariCoz(JSON.stringify({ 2027: 1_500_000, 1990: 5, abc: 3, 2028: -1 }))).toEqual({
      ...VARSAYILAN_FATURA_SINIRLARI,
      2027: 1_500_000,
    });
  });

  it('yılın sınırı; girilmemiş yılda son bilinen yıl + eksik uyarısı', () => {
    const s = faturaSinirlariCoz(JSON.stringify({ 2026: 1_200_000 }));
    expect(faturaSiniriIcin(s, new Date(2026, 5, 1))).toEqual({ tutar: 1_200_000, yil: 2026, eksik: false });
    expect(faturaSiniriIcin(s, new Date(2027, 0, 2))).toEqual({ tutar: 1_200_000, yil: 2026, eksik: true });
    expect(faturaSiniriIcin(s, new Date(2025, 3, 1))).toEqual({ tutar: 990_000, yil: 2025, eksik: false });
  });

  it('sınıra ULAŞAN tutar zorunlu ("ve üzeri")', () => {
    expect(faturaZorunlu(1_200_000, 1_200_000)).toBe(true);
    expect(faturaZorunlu(1_199_999, 1_200_000)).toBe(false);
    expect(faturaZorunlu(5_000_000, 0)).toBe(false);
  });
});
