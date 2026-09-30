/**
 * Müşteriye bağlı satışın iadesi — uçtan uca (§10.4).
 *
 * Senaryo: Barış Köse 4 defteri (400 ₺) veresiye alır, 2'sini iade eder.
 * İade Barış'a bağlı kalmalı, borcundan düşmeli, fiş hangi satışın iadesi
 * olduğunu söylemeli ve buluta eksiksiz gitmeli (panel de Barış'ı görsün).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet } from '@market/shared';
import { bakiyeOku } from '../src/main/depo/cari.js';
import { bekleyenOlaylar } from '../src/main/depo/senkron.js';
import { kalemleriGetir, satisDetayi } from '../src/main/depo/satis.js';
import { satisBelgesi } from '../src/main/donanim/fis-belge.js';
import { iadeYap, satisKesinlestir } from '../src/main/servis/satis-servis.js';
import { musteriEkle, tedarikciEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;
let musteriId: string;
let satisId: string;

beforeEach(async () => {
  ortam = await testOrtamiKur();
  musteriId = musteriEkle(ortam, 'Barış Köse', 1_000_000);
  const urunId = urunEkle(ortam, { ad: 'Defter', satisFiyati: 10_000, alisFiyati: 5000, stok: adet(10) });
  satisId = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
    kalemler: [{ urun_id: urunId, miktar: adet(4), birim_fiyat: 10_000 }],
    odemeler: [{ tip: 'VERESIYE', tutar: 40_000 }],
    musteri_id: musteriId,
  }).satisId;
});

afterEach(async () => {
  await ortam.temizle();
});

function ikiDefterIade(yontem: 'NAKIT' | 'VERESIYE' = 'VERESIYE') {
  const kalem = kalemleriGetir(ortam.uygulama.vt, satisId)[0]!;
  return iadeYap(ortam.uygulama.baglam, ortam.admin, {
    kaynak_satis_id: satisId,
    kalemler: [{ satis_kalemi_id: kalem.id, miktar: adet(2) }],
    iade_yontemi: yontem,
    neden: 'Yanlışlıkla alındı',
  });
}

describe('müşteriye bağlı iade', () => {
  it('iade fişi müşteriye bağlıdır ve cari alacakta borçtan düşer', () => {
    expect(bakiyeOku(ortam.uygulama.vt, musteriId)).toBe(40_000);
    const iade = ikiDefterIade();
    expect(iade.detay.satis.musteri_id).toBe(musteriId);
    expect(iade.detay.satis.musteri_adi).toBe('Barış Köse');
    expect(bakiyeOku(ortam.uygulama.vt, musteriId)).toBe(20_000);
  });

  it('iade fişi hangi satışın iadesi olduğunu, orijinal fiş de iadelerini bilir', () => {
    const iade = ikiDefterIade();
    const kaynakFisNo = satisDetayi(ortam.uygulama.vt, satisId)!.satis.fis_no;
    expect(satisDetayi(ortam.uygulama.vt, iade.satisId)!.satis.kaynak_fis_no).toBe(kaynakFisNo);

    const orijinal = satisDetayi(ortam.uygulama.vt, satisId)!;
    expect(orijinal.iadeler).toEqual([expect.objectContaining({ id: iade.satisId, fis_no: iade.fisNo, genel_toplam: -20_000 })]);
  });

  it('basılan iade fişi kaynak fişi, nedeni, müşteriyi ve cari alacağı yazar', () => {
    const iade = ikiDefterIade();
    const detay = satisDetayi(ortam.uygulama.vt, iade.satisId)!;
    const kaynakFisNo = satisDetayi(ortam.uygulama.vt, satisId)!.satis.fis_no;
    const belge = satisBelgesi(detay, { ad: 'Market' }, { yasalUyari: 'u' });

    expect(belge.baslik).toBe('İADE FİŞİ');
    expect(belge.meta).toEqual(
      expect.arrayContaining([
        { etiket: 'MÜŞTERİ', deger: 'Barış Köse' },
        { etiket: 'İADE EDİLEN FİŞ', deger: kaynakFisNo },
        { etiket: 'NEDEN', deger: 'Yanlışlıkla alındı' },
      ]),
    );
    expect(belge.odemeler).toEqual([{ etiket: 'Cari hesaba alacak', deger: '200,00' }]);
  });

  it('buluta giden iade olayı müşteri, tarih ve kalem ayrıntılarını taşır', () => {
    const iade = ikiDefterIade();
    const olay = bekleyenOlaylar(ortam.uygulama.vt, 500).find(
      (o) => o.olay_tipi === 'IADE_YAPILDI' && o.entity_id === iade.satisId,
    );
    const veri = JSON.parse(olay?.veri ?? '{}');
    expect(veri).toMatchObject({
      musteri_id: musteriId,
      tarih: iade.detay.satis.tarih,
      kasa_oturum_id: ortam.admin.kasaOturumId,
      genel_toplam: -20_000,
    });
    expect(veri.kalemler[0]).toMatchObject({
      urun_adi: 'Defter',
      miktar: -adet(2),
      birim_fiyat: 10_000,
      satir_toplam: -20_000,
      birim_maliyet: 5000,
    });
    expect(veri.kalemler[0]).toHaveProperty('kdv_tutar');
    expect(veri).toHaveProperty('kdv_toplam');
    expect(veri).toHaveProperty('brut_kar');
  });
});

/*
 * Perakende (müşterisiz) yapılmış satışın iadesi de müşterinin borcundan
 * düşülebilmeli: Barış bazen müşteri seçilmeden alışveriş yapar, iade ederken
 * "borcumdan düşün" der. Satışın zaten bir müşterisi varsa başkasına yazılamaz.
 */
describe('iadede müşteri seçimi', () => {
  function perakendeSat(): { satisId: string; kalemId: string } {
    const urunId = urunEkle(ortam, { ad: 'Silgi', satisFiyati: 1000, stok: adet(10) });
    const id = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(2), birim_fiyat: 1000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 2000 }],
    }).satisId;
    return { satisId: id, kalemId: kalemleriGetir(ortam.uygulama.vt, id)[0]!.id };
  }

  it('müşterisiz satışın iadesi seçilen müşterinin borcundan düşülür', () => {
    const { satisId: pSatis, kalemId } = perakendeSat();
    const once = bakiyeOku(ortam.uygulama.vt, musteriId);
    const iade = iadeYap(ortam.uygulama.baglam, ortam.admin, {
      kaynak_satis_id: pSatis,
      kalemler: [{ satis_kalemi_id: kalemId, miktar: adet(1) }],
      iade_yontemi: 'VERESIYE',
      musteri_id: musteriId,
      neden: 'borcundan düş',
    });
    expect(bakiyeOku(ortam.uygulama.vt, musteriId)).toBe(once - 1000);
    expect(iade.detay.satis.musteri_adi).toBe('Barış Köse');
  });

  it('müşteri seçilmeden müşterisiz satış cari hesaba iade edilemez', () => {
    const { satisId: pSatis, kalemId } = perakendeSat();
    expect(() =>
      iadeYap(ortam.uygulama.baglam, ortam.admin, {
        kaynak_satis_id: pSatis,
        kalemler: [{ satis_kalemi_id: kalemId, miktar: adet(1) }],
        iade_yontemi: 'VERESIYE',
        neden: 'x',
      }),
    ).toThrow(/müşteri/i);
  });

  it('satışın müşterisi varken iade başka müşteriye yazılamaz', () => {
    const baskasi = musteriEkle(ortam, 'Başka Müşteri', 1_000_000);
    const kalem = kalemleriGetir(ortam.uygulama.vt, satisId)[0]!;
    expect(() =>
      iadeYap(ortam.uygulama.baglam, ortam.admin, {
        kaynak_satis_id: satisId,
        kalemler: [{ satis_kalemi_id: kalem.id, miktar: adet(1) }],
        iade_yontemi: 'VERESIYE',
        musteri_id: baskasi,
        neden: 'x',
      }),
    ).toThrow(/Barış Köse/);
  });

  it('tedarikçi hesabına iade yazılamaz', () => {
    const { satisId: pSatis, kalemId } = perakendeSat();
    const tedarikci = tedarikciEkle(ortam, 'Toptancı');
    expect(() =>
      iadeYap(ortam.uygulama.baglam, ortam.admin, {
        kaynak_satis_id: pSatis,
        kalemler: [{ satis_kalemi_id: kalemId, miktar: adet(1) }],
        iade_yontemi: 'VERESIYE',
        musteri_id: tedarikci,
        neden: 'x',
      }),
    ).toThrow(/müşteri/i);
  });
});
