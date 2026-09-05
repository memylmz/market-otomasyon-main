/**
 * Terazi barkodu ile satış (§10.1).
 *
 * Şarküteri/manav terazisi ürünü tartıp kendi barkodunu basar ve bu barkod her
 * tartımda DEĞİŞİR: son haneler ağırlığı taşır. Tam eşleşme arandığı sürece bu
 * ürünler kasadan hiç geçemiyordu.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eanKontrolHanesi, miktarOlustur } from '@market/shared';
import { barkodOku, kisaKodOner } from '../src/main/servis/katalog-servis.js';
import { barkodEkle } from '../src/main/depo/katalog.js';
import { testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

/** Terazinin basacağı EAN-13'ü kurar: ön ek + ürün kodu + değer + kontrol. */
function teraziEtiketi(onek: string, urunKodu: string, deger: number): string {
  const govde = onek + urunKodu + String(deger).padStart(5, '0');
  return govde + String(eanKontrolHanesi(govde));
}

describe('terazi barkodu', () => {
  it('ağırlık taşıyan etiketten ürünü ve miktarı çözer', () => {
    // Operatör ürüne reyondan basılmış BİR etiketi tanıtır (750 g'lık olsun).
    const urunId = urunEkle(ortam, {
      ad: 'Kaşar Peyniri',
      birimTipi: 'KG',
      satisFiyati: 45_000,
      barkod: teraziEtiketi('28', '12345', 750),
      stok: miktarOlustur(20),
    });

    // Kasada BAŞKA bir tartım okutulur: 1,250 kg. Barkod farklı, ürün aynı.
    const sonuc = barkodOku(ortam.uygulama.baglam, teraziEtiketi('28', '12345', 1250));

    expect(sonuc.bulundu).toBe(true);
    expect(sonuc.urun?.id).toBe(urunId);
    expect(sonuc.miktar, '1250 g = 1,250 kg').toBe(miktarOlustur(1.25));
  });

  it('tutar taşıyan etiketten miktarı birim fiyattan geri hesaplar', () => {
    urunEkle(ortam, {
      ad: 'Zeytin',
      birimTipi: 'KG',
      satisFiyati: 20_000, // 200,00 ₺/kg
      barkod: teraziEtiketi('27', '00042', 5000),
      stok: miktarOlustur(50),
    });

    // Etikette 100,00 ₺ yazıyor → 200,00 ₺/kg fiyattan 0,5 kg.
    const sonuc = barkodOku(ortam.uygulama.baglam, teraziEtiketi('27', '00042', 10_000));
    expect(sonuc.bulundu).toBe(true);
    expect(sonuc.miktar).toBe(miktarOlustur(0.5));
  });

  it('kodu tanıtılmamış terazi etiketinde ne yapılacağını söyler', () => {
    const sonuc = barkodOku(ortam.uygulama.baglam, teraziEtiketi('28', '99999', 500));
    expect(sonuc.bulundu).toBe(false);
    expect(sonuc.uyari, 'kasiyer ne yapacağını bilmeli').toMatch(/tanıtın/i);
  });

  /**
   * Mağaza içi aralık teoride serbesttir: 28 ile başlayan GERÇEK bir ürün
   * barkodu varsa onun kaydı kazanmalı, terazi yorumu devreye girmemelidir.
   */
  it('tam eşleşen gerçek barkod terazi yorumundan önce gelir', () => {
    const tam = teraziEtiketi('28', '55555', 1000);
    const urunId = urunEkle(ortam, { ad: 'Normal Ürün', barkod: tam, stok: miktarOlustur(10) });

    const sonuc = barkodOku(ortam.uygulama.baglam, tam);
    expect(sonuc.urun?.id).toBe(urunId);
    expect(sonuc.miktar, 'tam eşleşmede miktar dayatılmamalı').toBeUndefined();
  });

  it('normal ürün barkodu terazi barkodu sanılmaz', () => {
    const urunId = urunEkle(ortam, { ad: 'Kola', barkod: '8690504010128', stok: miktarOlustur(10) });
    const sonuc = barkodOku(ortam.uygulama.baglam, '8690504010128');
    expect(sonuc.urun?.id).toBe(urunId);
    expect(sonuc.miktar).toBeUndefined();
  });
});

describe('kısa kod (PLU) ile satış', () => {
  /**
   * Ölçüm: satılan kalemlerin %70'i barkodsuz yoldan giriyor. Kısa kod bu yolu
   * "ad yaz, listeden seç" yerine "iki hane yaz, Enter" haline getirir.
   */
  it('kısa kod okutulunca ürün bulunur', () => {
    const urunId = urunEkle(ortam, { ad: 'Domates', birimTipi: 'KG', barkod: '24', stok: miktarOlustur(50) });
    const sonuc = barkodOku(ortam.uygulama.baglam, '24');
    expect(sonuc.bulundu).toBe(true);
    expect(sonuc.urun?.id).toBe(urunId);
  });

  it('kısa kod ile gerçek barkod aynı üründe birlikte yaşar', () => {
    const urunId = urunEkle(ortam, { ad: 'Kola', barkod: '8690504010128', stok: miktarOlustur(20) });
    // Aynı ürüne kısa kod da eklenir.
    barkodEkle(ortam.uygulama.baglam.vt, urunId, '31', null, ortam.uygulama.cihazId);

    expect(barkodOku(ortam.uygulama.baglam, '8690504010128').urun?.id).toBe(urunId);
    expect(barkodOku(ortam.uygulama.baglam, '31').urun?.id).toBe(urunId);
  });

  it('kısa kod önerisi 10dan başlar ve dolu olanı atlar', () => {
    expect(kisaKodOner(ortam.uygulama.baglam)).toBe('10');

    urunEkle(ortam, { ad: 'On', barkod: '10', stok: miktarOlustur(1) });
    urunEkle(ortam, { ad: 'OnBir', barkod: '11', stok: miktarOlustur(1) });
    expect(kisaKodOner(ortam.uygulama.baglam), 'dolu kodlar atlanmalı').toBe('12');
  });

  it('kısa kod uzun barkodu gölgelemez', () => {
    // "12345" kısa kod, "1234567890128" gerçek barkod — ikisi ayrı ürün.
    const kisa = urunEkle(ortam, { ad: 'Kısa Kodlu', barkod: '12345', stok: miktarOlustur(5) });
    const uzun = urunEkle(ortam, { ad: 'Barkodlu', barkod: '1234567890128', stok: miktarOlustur(5) });

    expect(barkodOku(ortam.uygulama.baglam, '12345').urun?.id).toBe(kisa);
    expect(barkodOku(ortam.uygulama.baglam, '1234567890128').urun?.id).toBe(uzun);
  });
});
