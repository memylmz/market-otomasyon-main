/**
 * Sepet sırası: en son okutulan EN ÜSTTE (kasa ve müşteri ekranı); fiş ise
 * okutma sırasıyla (ilk okutulan üstte) basılır.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { adet, type Kurus } from '@market/shared';
import { satisGirdisiOlustur, sepetDurumu, type EklenecekUrun } from '../src/renderer/src/durum/sepet.js';

const urun = (ad: string, fiyat: Kurus = 1000): EklenecekUrun => ({
  urunId: `${ad}-id`,
  ad,
  barkod: null,
  birimTipi: 'ADET',
  birimFiyat: fiyat,
  listeFiyati: fiyat,
  kdvOrani: 20,
  kampanyaId: null,
  stok: adet(100),
});

beforeEach(() => {
  sepetDurumu.getState().tumunuSifirla();
});

const adlar = () => sepetDurumu.getState().satirlar.map((s) => s.ad);

describe('sepet sırası', () => {
  it('yeni ürün en üste eklenir ve seçilir', () => {
    const s = sepetDurumu.getState();
    s.ekle(urun('Süt'));
    s.ekle(urun('Ekmek'));
    const anahtar = s.ekle(urun('Ayran'));
    expect(adlar()).toEqual(['Ayran', 'Ekmek', 'Süt']);
    expect(sepetDurumu.getState().seciliAnahtar).toBe(anahtar);
  });

  it('tekrar okutulan ürün miktarı artarak en üste çıkar', () => {
    const s = sepetDurumu.getState();
    s.ekle(urun('Süt'));
    s.ekle(urun('Ekmek'));
    s.ekle(urun('Süt'));
    expect(adlar()).toEqual(['Süt', 'Ekmek']);
    expect(sepetDurumu.getState().satirlar[0]?.miktar).toBe(adet(2));
  });

  it('seçili satır silinince en üstteki satır seçilir', () => {
    const s = sepetDurumu.getState();
    s.ekle(urun('Süt'));
    s.ekle(urun('Ekmek'));
    const ayran = s.ekle(urun('Ayran'));
    s.sil(ayran);
    expect(sepetDurumu.getState().seciliAnahtar).toBe(sepetDurumu.getState().satirlar[0]?.anahtar);
    expect(adlar()).toEqual(['Ekmek', 'Süt']);
  });

  it('fiş okutma sırasıyla gider: ilk okutulan ilk kalem', () => {
    const s = sepetDurumu.getState();
    s.ekle(urun('Süt'));
    s.ekle(urun('Ekmek'));
    s.ekle(urun('Ayran'));
    const girdi = satisGirdisiOlustur([{ tip: 'NAKIT', tutar: 3000 }]) as { kalemler: { urun_id: string }[] };
    expect(girdi.kalemler.map((k) => k.urun_id)).toEqual(['Süt-id', 'Ekmek-id', 'Ayran-id']);
  });
});
