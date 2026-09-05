/**
 * Rapor servisi (§11.2, §14).
 *
 * NEDEN VAR: `rapor-servis` 304 satırdı ve hiç testi yoktu. Rapor rakamları
 * yanlış olduğunda kimse hata mesajı görmez — sadece yanlış karar verilir.
 * Burada bilinen bir gün kurulur ve her rakam ELDE hesaplananla karşılaştırılır.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet, bugun } from '@market/shared';
import { bugunOzeti, gunlukRapor, panoOzeti, stokRaporu, suistimalRaporu, urunRaporu } from '../src/main/servis/rapor-servis.js';
import { satisKesinlestir, satisIptal, iadeYap } from '../src/main/servis/satis-servis.js';
import { musteriEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

describe('günlük rapor', () => {
  it('ciro, işlem ve ödeme kırılımını doğru toplar', () => {
    const urunId = urunEkle(ortam, { ad: 'Süt', satisFiyati: 10_000, alisFiyati: 7_000, stok: adet(100) });
    const musteriId = musteriEkle(ortam, 'Borçlu Ali');

    // 2 nakit satış + 1 veresiye
    satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(2), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 20_000, alinan: 20_000 }],
    });
    satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'KART', tutar: 10_000 }],
    });
    satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(3), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'VERESIYE', tutar: 30_000 }],
      musteri_id: musteriId,
      limit_asimi_onaylandi: true,
    });

    const rapor = gunlukRapor(ortam.uygulama.baglam, ortam.admin, bugun(), bugun());

    expect(rapor.ozet.ciro).toBe(60_000);
    expect(rapor.ozet.islemSayisi).toBe(3);
    expect(rapor.ozet.nakit).toBe(20_000);
    expect(rapor.ozet.kart).toBe(10_000);
    expect(rapor.ozet.veresiye).toBe(30_000);
    /*
     * Brüt kâr KDV'DEN ARINDIRILMIŞ hesaplanır — Türkiye perakendesinde satış
     * fiyatı KDV DAHİL, alış fiyatı KDV HARİÇ girilir. 100,00 satışın net
     * hasılatı 100,00 / 1,20 = 83,33; maliyet 70,00 → birim kâr 13,33.
     * 6 adet × 13,33 = 80,00. KDV'yi ayırmasaydı 180,00 çıkardı ve kârlılık
     * gerçeğin iki katı görünürdü.
     */
    expect(rapor.ozet.brutKar).toBe(8_000);
    // Ortalama sepet = 600,00 / 3 = 200,00
    expect(rapor.gunler[0]?.ortalama_sepet).toBe(20_000);
  });

  it('iptal edilen satış ciroyu düşürür', () => {
    const urunId = urunEkle(ortam, { ad: 'Kola', satisFiyati: 10_000, alisFiyati: 6_000, stok: adet(50) });
    satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 10_000, alinan: 10_000 }],
    });
    const iptalEdilecek = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(2), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 20_000, alinan: 20_000 }],
    });

    const oncesi = bugunOzeti(ortam.uygulama.baglam, ortam.admin);
    expect(oncesi.ciro).toBe(30_000);

    satisIptal(ortam.uygulama.baglam, ortam.admin, iptalEdilecek.satisId, 'Yanlış ürün');

    const sonrasi = bugunOzeti(ortam.uygulama.baglam, ortam.admin);
    expect(sonrasi.ciro, 'iptal edilen tutar ciroda kalmamalı').toBe(10_000);
  });

  it('satış yokken sıfırlarla döner, çökmez', () => {
    const rapor = gunlukRapor(ortam.uygulama.baglam, ortam.admin, bugun(), bugun());
    expect(rapor.ozet.ciro).toBe(0);
    expect(rapor.ozet.islemSayisi).toBe(0);
    expect(rapor.ozet.karMarji).toBe(0);
  });
});

describe('ürün ve stok raporu', () => {
  it('en çok satanı doğru sıralar', () => {
    const cok = urunEkle(ortam, { ad: 'Çok Satan', satisFiyati: 5_000, alisFiyati: 3_000, stok: adet(100) });
    const az = urunEkle(ortam, { ad: 'Az Satan', satisFiyati: 5_000, alisFiyati: 3_000, stok: adet(100) });

    satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [
        { urun_id: cok, miktar: adet(10), birim_fiyat: 5_000 },
        { urun_id: az, miktar: adet(1), birim_fiyat: 5_000 },
      ],
      odemeler: [{ tip: 'NAKIT', tutar: 55_000, alinan: 55_000 }],
    });

    const rapor = urunRaporu(ortam.uygulama.baglam, ortam.admin, bugun(), bugun());
    expect(rapor.enCokSatan[0]?.urun_id).toBe(cok);
  });

  it('kritik stoğu olan ürünü işaretler', () => {
    urunEkle(ortam, { ad: 'Azalan', stok: adet(2), kritikStok: adet(10) });
    const rapor = stokRaporu(ortam.uygulama.baglam, ortam.admin);
    expect(rapor.kritikSayisi).toBeGreaterThan(0);
    expect(rapor.kritikler.some((k) => k.ad === 'Azalan')).toBe(true);
  });
});

describe('suistimal göstergesi', () => {
  /** İade ve iptal oranı yüksekse kasiyer suistimali olabilir (§14). */
  it('iade ve iptal oranlarını hesaplar', () => {
    const urunId = urunEkle(ortam, { ad: 'Test', satisFiyati: 10_000, alisFiyati: 6_000, stok: adet(100) });

    for (let i = 0; i < 3; i++) {
      satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
        kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 10_000 }],
        odemeler: [{ tip: 'NAKIT', tutar: 10_000, alinan: 10_000 }],
      });
    }
    const iptalEdilecek = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 10_000, alinan: 10_000 }],
    });
    satisIptal(ortam.uygulama.baglam, ortam.admin, iptalEdilecek.satisId, 'Deneme');

    const rapor = suistimalRaporu(ortam.uygulama.baglam, ortam.admin, bugun(), bugun());
    expect(rapor.iptalTutari).toBe(10_000);
    expect(rapor.iptalOrani).toBeGreaterThan(0);
    expect(rapor.kasiyerBazli.length).toBeGreaterThan(0);
  });

  it('iade satışı iade tutarına yazılır', () => {
    const urunId = urunEkle(ortam, { ad: 'İade Ürünü', satisFiyati: 10_000, alisFiyati: 6_000, stok: adet(100) });
    const satis = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(2), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 20_000, alinan: 20_000 }],
    });
    const kalemler = ortam.uygulama.baglam.vt
      .hazirla('SELECT id FROM satis_kalemleri WHERE satis_id = ?')
      .tumu<{ id: string }>(satis.satisId);

    iadeYap(ortam.uygulama.baglam, ortam.admin, {
      kaynak_satis_id: satis.satisId,
      kalemler: [{ satis_kalemi_id: kalemler[0]!.id, miktar: adet(1) }],
      iade_yontemi: 'NAKIT',
      neden: 'Müşteri beğenmedi',
    });

    const rapor = suistimalRaporu(ortam.uygulama.baglam, ortam.admin, bugun(), bugun());
    expect(rapor.iadeTutari).toBeGreaterThan(0);
  });
});

describe('pano özeti', () => {
  it('ana ekran rakamlarını tek çağrıda döner', () => {
    const urunId = urunEkle(ortam, { ad: 'Pano Ürünü', satisFiyati: 10_000, alisFiyati: 6_000, stok: adet(10) });
    satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 10_000, alinan: 10_000 }],
    });

    const pano = panoOzeti(ortam.uygulama.baglam, ortam.admin);
    expect(pano).toBeTruthy();
    expect(JSON.stringify(pano)).toContain('10000');
  });
});
