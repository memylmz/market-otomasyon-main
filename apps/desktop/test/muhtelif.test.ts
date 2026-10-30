/**
 * Muhtelif kalem.
 *
 * Satış satırı bir ürüne bağlı olmak zorunda olduğu için barkodsuz tek
 * seferlik kalemler "Muhtelif" sistem kaydına yaslanır. Bu kayıt ürün DEĞİLDİR:
 * Ürünler listesinde, aramada, hızlı ızgarada ve stok uyarılarında görünmemeli.
 * Sepette her muhtelif ekleme ayrı satırdır; aynı tutarlı iki kalem
 * birleşip "adet 2" olmamalı.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet } from '@market/shared';
import { urunAra, urunleriListele } from '../src/main/depo/katalog.js';
import { kritikStoktakiler, negatifStoktakiler } from '../src/main/depo/stok.js';
import { muhtelifUrunu } from '../src/main/servis/katalog-servis.js';
import { satisKesinlestir } from '../src/main/servis/satis-servis.js';
import { sepetDurumu } from '../src/renderer/src/durum/sepet.js';
import { testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
  sepetDurumu.getState().tumunuSifirla();
});

afterEach(async () => {
  await ortam.temizle();
});

describe('muhtelif sistem kaydı', () => {
  it('ürün listesinde, aramada ve stok uyarılarında görünmez; satış yine yapılır', () => {
    const { baglam, vt } = ortam.uygulama;
    urunEkle(ortam, { ad: 'Süt' });
    const muhtelif = muhtelifUrunu(baglam);

    // İki muhtelif kalemli satış: muhtelifin stoğu eksiye düşer.
    satisKesinlestir(baglam, ortam.admin, {
      kalemler: [
        { urun_id: muhtelif.id, urun_adi: 'Poşet', miktar: adet(1), birim_fiyat: 100 },
        { urun_id: muhtelif.id, urun_adi: 'Gazete', miktar: adet(1), birim_fiyat: 1500 },
      ],
      odemeler: [{ tip: 'NAKIT', tutar: 1600 }],
    });

    expect(urunleriListele(vt, {}).kayitlar.map((u) => u.ad)).toEqual(['Süt']);
    expect(urunleriListele(vt, { arama: 'muhtelif' }).kayitlar).toEqual([]);
    expect(urunAra(vt, 'muhtelif')).toEqual([]);
    expect(negatifStoktakiler(vt).map((u) => u.ad)).not.toContain('Muhtelif');
    expect(kritikStoktakiler(vt).map((u) => u.ad)).not.toContain('Muhtelif');
  });
});

describe('sepette muhtelif', () => {
  const muhtelifKalemi = (ad: string, tutar: number) => ({
    urunId: 'muhtelif-id',
    ad,
    barkod: null,
    birimTipi: 'ADET' as const,
    birimFiyat: tutar,
    listeFiyati: tutar,
    kdvOrani: 20,
    kampanyaId: null,
    stok: adet(9999),
    ozelAd: ad,
  });

  it('aynı tutarlı, adsız iki muhtelif ayrı satır olur (birleşmez)', () => {
    const sepet = sepetDurumu.getState();
    sepet.ekle(muhtelifKalemi('Muhtelif', 1000), adet(1));
    sepet.ekle(muhtelifKalemi('Muhtelif', 1000), adet(1));
    sepet.ekle(muhtelifKalemi('Pil', 2500), adet(1));
    const satirlar = sepetDurumu.getState().satirlar;
    expect(satirlar).toHaveLength(3);
    expect(satirlar.map((s) => s.miktar)).toEqual([adet(1), adet(1), adet(1)]);
  });

  it('normal ürün yine birleşir (barkodu iki kez okutmak = adet 2)', () => {
    const sepet = sepetDurumu.getState();
    const sut = { ...muhtelifKalemi('Süt', 3000), urunId: 'sut-id', ozelAd: undefined };
    sepet.ekle(sut, adet(1));
    sepet.ekle(sut, adet(1));
    expect(sepetDurumu.getState().satirlar).toHaveLength(1);
    expect(sepetDurumu.getState().satirlar[0]?.miktar).toBe(adet(2));
  });
});
