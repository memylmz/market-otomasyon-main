/**
 * Alış girdisi sözleşmesi: bir kalem ya mevcut ürüne ya da faturada açılacak
 * yeni ürüne bağlıdır. Bu kural şemada durmak zorundadır — kasa ve bulut aynı
 * gövdeyi ayrı ayrı doğruluyor, ikisinin de aynı cevabı vermesi gerekir.
 */

import { describe, expect, it } from 'vitest';
import { adet, zAlisGirdi } from '@market/shared';

const TEDARIKCI = '33333333-3333-4333-8333-333333333333';
const URUN = '44444444-4444-4444-8444-444444444444';

function govde(kalem: Record<string, unknown>) {
  return { tedarikci_id: TEDARIKCI, kalemler: [{ miktar: adet(2), birim_fiyat: 700, kdv_orani: 20, ...kalem }] };
}

describe('zAlisGirdi kalemleri', () => {
  it('mevcut ürüne bağlı kalemi kabul eder (eski gövdeler bozulmaz)', () => {
    const sonuc = zAlisGirdi.safeParse(govde({ urun_id: URUN }));
    expect(sonuc.success).toBe(true);
  });

  it('yeni ürün tarif eden kalemi kabul eder', () => {
    const sonuc = zAlisGirdi.safeParse(
      govde({ yeni_urun: { ad: 'Toptan Kola 1L', barkod: '8690000000017', satis_fiyati: 2500 } }),
    );
    expect(sonuc.success).toBe(true);
    if (sonuc.success) {
      // Varsayılanlar uygulanır: birim ADET, ödeme NAKIT.
      expect(sonuc.data.kalemler[0]!.yeni_urun!.birim_tipi).toBe('ADET');
      expect(sonuc.data.odeme_tipi).toBe('NAKIT');
    }
  });

  it('ikisi birden verilirse reddeder', () => {
    const sonuc = zAlisGirdi.safeParse(govde({ urun_id: URUN, yeni_urun: { ad: 'Kola', satis_fiyati: 2500 } }));
    expect(sonuc.success).toBe(false);
  });

  it('ikisi de verilmezse reddeder', () => {
    expect(zAlisGirdi.safeParse(govde({})).success).toBe(false);
  });

  it('yeni üründe satış fiyatı zorunludur', () => {
    expect(zAlisGirdi.safeParse(govde({ yeni_urun: { ad: 'Kola' } })).success).toBe(false);
  });

  it('200 kalemi geçen belgeyi reddeder', () => {
    const kalemler = Array.from({ length: 201 }, () => ({
      urun_id: URUN,
      miktar: adet(1),
      birim_fiyat: 100,
      kdv_orani: 20,
    }));
    expect(zAlisGirdi.safeParse({ tedarikci_id: TEDARIKCI, kalemler }).success).toBe(false);
  });

  it('HAVALE ödeme tipini kabul eder', () => {
    const sonuc = zAlisGirdi.safeParse({ ...govde({ urun_id: URUN }), odenen_tutar: 1680, odeme_tipi: 'HAVALE' });
    expect(sonuc.success).toBe(true);
  });
});
