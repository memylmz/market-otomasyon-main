/**
 * İade ekranının detaylı fiş araması.
 *
 * Pavo varken müşterinin elindeki kâğıt Pavo'nun fişidir; kasanın fiş no'su ve
 * barkodu üzerinde yoktur. Fiş; Pavo'nun belge/fatura numarasıyla, tarih +
 * tutarla, içindeki ürünle ya da ödeme şekliyle bulunabilmelidir.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet } from '@market/shared';
import { pavoSatisiYaz } from '../src/main/depo/pavo.js';
import { satisAra } from '../src/main/depo/satis.js';
import { satisKesinlestir } from '../src/main/servis/satis-servis.js';
import { musteriEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;
let cikolataSatisi: string;
let suSatisi: string;
let veresiyeSatisi: string;

beforeEach(async () => {
  ortam = await testOrtamiKur();
  const { baglam } = ortam.uygulama;
  const cikolata = urunEkle(ortam, { ad: 'ETİ ÇİKOLATA', barkod: '8690526085714', satisFiyati: 1450 });
  const su = urunEkle(ortam, { ad: 'Su 1,5 L', satisFiyati: 1000 });
  const ayse = musteriEkle(ortam, 'Ayşe Yılmaz');

  cikolataSatisi = satisKesinlestir(baglam, ortam.admin, {
    kalemler: [{ urun_id: cikolata, miktar: adet(10), birim_fiyat: 1450 }],
    odemeler: [{ tip: 'KART', tutar: 14_500 }],
  }).satisId;
  suSatisi = satisKesinlestir(baglam, ortam.admin, {
    kalemler: [{ urun_id: su, miktar: adet(2), birim_fiyat: 1000 }],
    odemeler: [{ tip: 'NAKIT', tutar: 2000 }],
  }).satisId;
  veresiyeSatisi = satisKesinlestir(baglam, ortam.admin, {
    kalemler: [{ urun_id: su, miktar: adet(1), birim_fiyat: 1000 }],
    musteri_id: ayse,
    odemeler: [{ tip: 'VERESIYE', tutar: 1000 }],
  }).satisId;

  // Kart satışı Pavo'dan geçmiş: cihazın belge ve fatura numaraları saklanmış.
  pavoSatisiYaz(ortam.uygulama.vt, {
    satis_id: cikolataSatisi,
    siparis_no: 'sip-1',
    pavo_id: 1001,
    satis_no: 'HKVNCiEgBw',
    fatura_no: 'GIB2026000000105',
    belge_no: '0042',
    sorgu_linki: null,
    kalemler: [],
  });
});

afterEach(async () => {
  await ortam.temizle();
});

const idler = (k: Parameters<typeof satisAra>[1]) => satisAra(ortam.uygulama.vt, k).map((s) => s.id);

describe('detaylı fiş arama', () => {
  it('Pavo fişindeki belge numarasıyla, fatura numarasıyla ve satış numarasıyla bulunur', () => {
    expect(idler({ metin: '0042' })).toEqual([cikolataSatisi]);
    expect(idler({ metin: 'gib2026000000105' })).toEqual([cikolataSatisi]);
    expect(idler({ metin: 'hkvnciegbw' })).toEqual([cikolataSatisi]);
    const satir = satisAra(ortam.uygulama.vt, { metin: '0042' })[0];
    expect(satir).toMatchObject({ pavo_belge_no: '0042', pavo_fatura_no: 'GIB2026000000105', kalem_sayisi: 1 });
  });

  it('gün + tutar ile bulunur', () => {
    const bas = new Date();
    bas.setHours(0, 0, 0, 0);
    const gun = { baslangic: bas.toISOString(), bitis: new Date(bas.getTime() + 86_400_000).toISOString() };
    expect(idler({ ...gun, tutar: 14_500 })).toEqual([cikolataSatisi]);
    expect(idler({ ...gun, tutar: 2000 })).toEqual([suSatisi]);
    // Dünün aralığında bugünkü fişler çıkmaz.
    expect(
      idler({ baslangic: new Date(bas.getTime() - 86_400_000).toISOString(), bitis: bas.toISOString(), tutar: 14_500 }),
    ).toEqual([]);
  });

  it('fişteki ürünün adıyla (Türkçe harf duyarsız) ya da barkoduyla bulunur', () => {
    expect(idler({ urun: 'çikolata' })).toEqual([cikolataSatisi]);
    expect(idler({ urun: 'CIKOLATA' })).toEqual([cikolataSatisi]);
    expect(idler({ urun: '8690526085714' })).toEqual([cikolataSatisi]);
    expect(idler({ urun: 'su 1,5' }).sort()).toEqual([suSatisi, veresiyeSatisi].sort());
  });

  it('ödeme şekli ve müşteri adı süzer; kriterler birlikte uygulanır', () => {
    expect(idler({ odemeTipi: 'VERESIYE' })).toEqual([veresiyeSatisi]);
    expect(idler({ metin: 'Ayşe' })).toEqual([veresiyeSatisi]);
    expect(idler({ urun: 'su', odemeTipi: 'NAKIT' })).toEqual([suSatisi]);
    expect(idler({ urun: 'su', tutar: 14_500 })).toEqual([]);
  });

  it('LIKE özel karakterleri joker sayılmaz', () => {
    expect(idler({ metin: '%' })).toEqual([]);
    expect(idler({ urun: '_' })).toEqual([]);
  });
});
