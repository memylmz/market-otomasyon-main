/**
 * Manuel stok düzeltmesi (§10.6).
 *
 * Stok append-only'dur: düzeltme mevcut stoğu EZMEZ, aradaki farkı `DUZELTME`
 * hareketi olarak yazar. Böylece "stok neden değişti" sorusunun cevabı
 * hareket geçmişinde kalır.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { miktarOlustur } from '@market/shared';
import { stokDuzeltme } from '../src/main/servis/stok-servis.js';
import { hareketleriListele, stokOku } from '../src/main/depo/stok.js';
import { testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

describe('stok düzeltme', () => {
  it('stoğu hedeflenen miktara çeker', () => {
    const urunId = urunEkle(ortam, { stok: miktarOlustur(10) });

    stokDuzeltme(ortam.uygulama.baglam, ortam.admin, urunId, miktarOlustur(7), 'Sayım farkı');

    expect(stokOku(ortam.uygulama.vt, urunId)).toBe(miktarOlustur(7));
  });

  it('farkı DUZELTME hareketi olarak yazar — mevcut stok ezilmez', () => {
    const urunId = urunEkle(ortam, { stok: miktarOlustur(10) });

    stokDuzeltme(ortam.uygulama.baglam, ortam.admin, urunId, miktarOlustur(14), 'Geç girilen mal kabul');

    const hareketler = hareketleriListele(ortam.uygulama.vt, { urunId });
    const duzeltme = hareketler.find((h) => h.hareket_tipi === 'DUZELTME');
    expect(duzeltme?.miktar).toBe(miktarOlustur(4));
    // Açılış hareketi duruyor: geçmiş silinmedi.
    expect(hareketler.some((h) => h.hareket_tipi === 'ACILIS')).toBe(true);
  });

  it('fark sıfırsa hareket yazılmaz', () => {
    const urunId = urunEkle(ortam, { stok: miktarOlustur(10) });
    const oncekiAdet = hareketleriListele(ortam.uygulama.vt, { urunId }).length;

    stokDuzeltme(ortam.uygulama.baglam, ortam.admin, urunId, miktarOlustur(10), 'Değişiklik yok');

    expect(hareketleriListele(ortam.uygulama.vt, { urunId })).toHaveLength(oncekiAdet);
  });

  it('sebep zorunludur', () => {
    const urunId = urunEkle(ortam, { stok: miktarOlustur(10) });
    expect(() => stokDuzeltme(ortam.uygulama.baglam, ortam.admin, urunId, miktarOlustur(5), '   ')).toThrow();
  });

  it('yetkisiz kullanıcı düzeltemez', () => {
    const urunId = urunEkle(ortam, { stok: miktarOlustur(10) });
    expect(ortam.kasiyer.yetkiler.has('stok.duzeltme')).toBe(false);
    expect(() => stokDuzeltme(ortam.uygulama.baglam, ortam.kasiyer, urunId, miktarOlustur(5), 'Deneme')).toThrow();
    expect(stokOku(ortam.uygulama.vt, urunId)).toBe(miktarOlustur(10));
  });
});
