/**
 * Müşterinin alışveriş geçmişi ve kasa ekranında veresiye satırları.
 *
 * Cari ekstresi yalnız BORCU gösterir: müşterinin nakit ya da kartla yaptığı
 * alışveriş deftere hiç düşmez. "Bu müşteri neler aldı" sorusu için satışlar
 * müşteriye göre, ödeme türü dökümüyle listelenir.
 *
 * Kasa hareketleri de yalnız kasadan geçen parayı tutar; veresiye satış kasaya
 * para sokmadığı için listede görünmüyordu. Ekranda gösterilir ama kasa
 * hareketi olarak YAZILMAZ — beklenen nakit ve gün sonu etkilenmemelidir.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet } from '@market/shared';
import { oturumOzeti } from '../src/main/depo/kasa.js';
import { kalemleriGetir, musteriAlisverisleri } from '../src/main/depo/satis.js';
import { kasaDurumu } from '../src/main/servis/kasa-servis.js';
import { iadeYap, satisIptal, satisKesinlestir } from '../src/main/servis/satis-servis.js';
import { musteriEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;
let urunId: string;
let musteriId: string;

beforeEach(async () => {
  ortam = await testOrtamiKur();
  urunId = urunEkle(ortam, { satisFiyati: 1000, stok: adet(100) });
  musteriId = musteriEkle(ortam, 'Barış Köse', 1_000_000);
});

afterEach(async () => {
  await ortam.temizle();
});

function sat(odemeler: { tip: 'NAKIT' | 'KART' | 'VERESIYE'; tutar: number }[], musteri: string | null = musteriId) {
  const toplam = odemeler.reduce((t, o) => t + o.tutar, 0);
  return satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
    kalemler: [{ urun_id: urunId, miktar: adet(toplam / 1000), birim_fiyat: 1000 }],
    odemeler,
    musteri_id: musteri ?? undefined,
  }).satisId;
}

describe('müşteri alışverişleri', () => {
  it('nakit, kart ve veresiye alışverişlerin hepsini ödeme dökümüyle listeler', () => {
    const nakit = sat([{ tip: 'NAKIT', tutar: 1000 }]);
    const kart = sat([{ tip: 'KART', tutar: 2000 }]);
    const karma = sat([
      { tip: 'NAKIT', tutar: 1000 },
      { tip: 'VERESIYE', tutar: 2000 },
    ]);
    sat([{ tip: 'NAKIT', tutar: 5000 }], null); // başka (müşterisiz) satış listeye girmez

    const liste = musteriAlisverisleri(ortam.uygulama.vt, musteriId);
    expect(liste.map((s) => s.id).sort()).toEqual([nakit, kart, karma].sort());

    const k = liste.find((s) => s.id === karma);
    expect(k).toMatchObject({ genel_toplam: 3000, nakit: 1000, kart: 0, veresiye: 2000 });
  });

  it('ödenmiş/borç süzgeci veresiye payına göre ayırır; iptal edilen satış süzgeçlere girmez', () => {
    const nakit = sat([{ tip: 'NAKIT', tutar: 1000 }]);
    const veresiye = sat([{ tip: 'VERESIYE', tutar: 3000 }]);
    const iptal = sat([{ tip: 'VERESIYE', tutar: 4000 }]);
    satisIptal(ortam.uygulama.baglam, ortam.admin, iptal, 'yanlış müşteri');

    const ids = (durum: 'tumu' | 'odenmis' | 'borc') =>
      musteriAlisverisleri(ortam.uygulama.vt, musteriId, { durum }).map((s) => s.id);

    expect(ids('odenmis')).toEqual([nakit]);
    expect(ids('borc')).toEqual([veresiye]);
    expect(ids('tumu')).toContain(iptal);
  });
});

describe('müşteri alışverişlerinde iade', () => {
  it('iade fişi yalnız "Tümü"nde görünür, ödenmiş/borç süzgeçlerine girmez', () => {
    const satisId = sat([{ tip: 'NAKIT', tutar: 2000 }]);
    const kalem = kalemleriGetir(ortam.uygulama.vt, satisId)[0]!;
    const iade = iadeYap(ortam.uygulama.baglam, ortam.admin, {
      kaynak_satis_id: satisId,
      kalemler: [{ satis_kalemi_id: kalem.id, miktar: adet(1) }],
      iade_yontemi: 'NAKIT',
      neden: 'test',
    });
    const ids = (durum: 'tumu' | 'odenmis' | 'borc') =>
      musteriAlisverisleri(ortam.uygulama.vt, musteriId, { durum }).map((s) => s.id);
    expect(ids('tumu')).toContain(iade.satisId);
    expect(ids('odenmis')).toEqual([satisId]);
    expect(ids('borc')).toEqual([]);
  });
});

describe('kasa ekranında veresiye', () => {
  it('veresiye satış hareket listesinde görünür, beklenen nakdi değiştirmez', () => {
    const oncekiNakit = oturumOzeti(ortam.uygulama.vt, ortam.admin.kasaOturumId as string).beklenen_nakit;
    const satisId = sat([
      { tip: 'NAKIT', tutar: 1000 },
      { tip: 'VERESIYE', tutar: 2000 },
    ]);

    const durum = kasaDurumu(ortam.uygulama.baglam, ortam.admin);
    const satir = durum.hareketler.find((h) => h.tip === 'SATIS_VERESIYE');
    expect(satir).toMatchObject({ tutar: 2000, belge_id: satisId });
    expect(satir?.aciklama).toContain('Barış Köse');
    expect(durum.ozet?.beklenen_nakit).toBe(oncekiNakit + 1000);
  });

  it('satıştan doğan kasa hareketi satışın müşterisini taşır; müşterisiz satışta boştur', () => {
    const musterili = sat([{ tip: 'KART', tutar: 1000 }]);
    const perakende = sat([{ tip: 'NAKIT', tutar: 1000 }], null);
    const hareketler = kasaDurumu(ortam.uygulama.baglam, ortam.admin).hareketler;
    expect(hareketler.find((h) => h.belge_id === musterili)?.musteri_adi).toBe('Barış Köse');
    expect(hareketler.find((h) => h.belge_id === perakende)?.musteri_adi ?? null).toBeNull();
  });

  it('iptal edilen veresiye satış listeden düşer', () => {
    const satisId = sat([{ tip: 'VERESIYE', tutar: 2000 }]);
    satisIptal(ortam.uygulama.baglam, ortam.admin, satisId, 'yanlış müşteri');
    const durum = kasaDurumu(ortam.uygulama.baglam, ortam.admin);
    expect(durum.hareketler.some((h) => h.tip === 'SATIS_VERESIYE')).toBe(false);
  });
});
