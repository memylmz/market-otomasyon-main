/**
 * Paket seçenekleri: fiyat, ad, stok karşılığı ve kampanya kuralı.
 */
import { describe, expect, it } from 'vitest';
import { paketFiyati, paketKampanyaFiyati, paketliAd, tekAdet, zUrunPaketiGirdisi } from '../src/index.js';

const kampanya = (tip: 'YUZDE' | 'SABIT_FIYAT' | 'N_AL_M_ODE', deger: number) => ({
  id: tip,
  tip,
  kapsam: 'TUM' as const,
  hedefId: null,
  deger,
  esikMiktar: tip === 'N_AL_M_ODE' ? 3000 : undefined,
  baslangic: '2000-01-01T00:00:00.000Z',
  bitis: '2999-01-01T00:00:00.000Z',
  aktifMi: true,
});

describe('paket', () => {
  it('fiyat girilmemişse çarpan × tek fiyat', () => {
    expect(paketFiyati({ carpan: 12, fiyat: null }, 200)).toBe(2400);
    expect(paketFiyati({ carpan: 12, fiyat: 2000 }, 200)).toBe(2000);
  });

  it('stok karşılığı: paket satırında miktar × çarpan, tekte aynı', () => {
    expect(tekAdet(2000, 12)).toBe(24000);
    expect(tekAdet(3000, null)).toBe(3000);
    expect(tekAdet(-1000, 12)).toBe(-12000);
  });

  it('fişteki ad', () => {
    expect(paketliAd('Kibrit', "12'li paket")).toBe("Kibrit (12'li paket)");
  });

  it('pakete yalnız yüzde kampanyası uygulanır', () => {
    const hedef = { urunId: 'u', kategoriId: null };
    const z = '2026-01-01T00:00:00.000Z';
    expect(paketKampanyaFiyati(2000, hedef, [kampanya('YUZDE', 10)], z)).toEqual({ fiyat: 1800, kampanyaId: 'YUZDE' });
    // Tek ürüne yazılmış sabit fiyat 12'li paketi 1,50'ye düşürmemeli.
    expect(paketKampanyaFiyati(2000, hedef, [kampanya('SABIT_FIYAT', 150)], z)).toEqual({ fiyat: 2000, kampanyaId: null });
    expect(paketKampanyaFiyati(2000, hedef, [kampanya('N_AL_M_ODE', 2)], z)).toEqual({ fiyat: 2000, kampanyaId: null });
  });

  it('girdi doğrulaması: en az 2 adet, ad zorunlu', () => {
    expect(zUrunPaketiGirdisi.safeParse({ ad: "12'li", carpan: 12 }).success).toBe(true);
    expect(zUrunPaketiGirdisi.safeParse({ ad: "12'li", carpan: 1 }).success).toBe(false);
    expect(zUrunPaketiGirdisi.safeParse({ ad: '', carpan: 12 }).success).toBe(false);
  });
});
