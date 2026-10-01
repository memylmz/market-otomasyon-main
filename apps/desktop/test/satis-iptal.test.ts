/**
 * Satış iptalinde para iadesinin yolu (§10.4).
 *
 * Eskiden iptal yolu kendisi seçiyordu (nakit → kasadan, kart → karta) ve
 * kasa hareketini SATIŞIN vardiyasına yazıyordu: dünkü satış bugün iptal
 * edilince para bugünkü çekmeceden çıkıyor, kayıt kapanmış vardiyaya düşüyordu.
 * Artık yol seçilir (varsayılan orijinal), nakit iade o anki açık kasadan yazılır.
 * Veresiye kısmı her durumda borçtan silinir: satış hiç olmamış sayılır.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet } from '@market/shared';
import { bankaDefteri } from '../src/main/depo/banka.js';
import { bakiyeOku } from '../src/main/depo/cari.js';
import { oturumOzeti } from '../src/main/depo/kasa.js';
import { gunSonu, kasaAc } from '../src/main/servis/kasa-servis.js';
import { kalemleriGetir } from '../src/main/depo/satis.js';
import { iadeYap, satisIptal, satisKesinlestir } from '../src/main/servis/satis-servis.js';
import { musteriEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;
let urunId: string;

beforeEach(async () => {
  ortam = await testOrtamiKur();
  urunId = urunEkle(ortam, { satisFiyati: 100, stok: adet(1000) });
});

afterEach(async () => {
  await ortam.temizle();
});

function sat(odemeler: { tip: 'NAKIT' | 'KART' | 'VERESIYE'; tutar: number }[], musteri?: string) {
  const toplam = odemeler.reduce((t, o) => t + o.tutar, 0);
  return satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
    kalemler: [{ urun_id: urunId, miktar: adet(toplam / 100), birim_fiyat: 100 }],
    odemeler,
    musteri_id: musteri,
  }).satisId;
}

const ozet = () => oturumOzeti(ortam.uygulama.vt, ortam.admin.kasaOturumId as string);
const banka = () => bankaDefteri(ortam.uygulama.vt).bakiye;

describe('satış iptalinde para iadesi', () => {
  it('varsayılan: kart satışı karta iade edilir — kasa nakdi ve banka değişmez, kart kırılımı sıfırlanır', () => {
    const nakitOnce = ozet().beklenen_nakit;
    const id = sat([{ tip: 'KART', tutar: 670 }]);
    satisIptal(ortam.uygulama.baglam, ortam.admin, id, 'vazgeçti');
    expect(ozet().beklenen_nakit).toBe(nakitOnce);
    expect(ozet().satis_kart).toBe(0);
    expect(banka()).toBe(0);
  });

  it('kart satışı NAKİT iade edilirse para kasadan çıkar, kart parası bankada kalır', () => {
    const nakitOnce = ozet().beklenen_nakit;
    const id = sat([{ tip: 'KART', tutar: 670 }]);
    satisIptal(ortam.uygulama.baglam, ortam.admin, id, 'nakit istedi', 'NAKIT');
    expect(ozet().beklenen_nakit).toBe(nakitOnce - 670);
    expect(banka()).toBe(670);
  });

  it('nakit satış KARTA iade edilirse nakit kasada kalır, bankadan çıkar', () => {
    const nakitOnce = ozet().beklenen_nakit;
    const id = sat([{ tip: 'NAKIT', tutar: 200 }]);
    satisIptal(ortam.uygulama.baglam, ortam.admin, id, 'karta iade', 'KART');
    expect(ozet().beklenen_nakit).toBe(nakitOnce + 200);
    expect(banka()).toBe(-200);
  });

  it('varsayılan karma ödeme: nakit kısmı nakit, kart kısmı karta döner', () => {
    const nakitOnce = ozet().beklenen_nakit;
    const id = sat([
      { tip: 'NAKIT', tutar: 300 },
      { tip: 'KART', tutar: 200 },
    ]);
    satisIptal(ortam.uygulama.baglam, ortam.admin, id, 'vazgeçti');
    expect(ozet().beklenen_nakit).toBe(nakitOnce);
    expect(banka()).toBe(0);
  });

  it('veresiye kısmı seçilen yoldan bağımsız olarak borçtan silinir', () => {
    const musteri = musteriEkle(ortam, 'Barış', 1_000_000);
    const id = sat(
      [
        { tip: 'NAKIT', tutar: 100 },
        { tip: 'VERESIYE', tutar: 400 },
      ],
      musteri,
    );
    expect(bakiyeOku(ortam.uygulama.vt, musteri)).toBe(400);
    const nakitOnce = ozet().beklenen_nakit;
    satisIptal(ortam.uygulama.baglam, ortam.admin, id, 'yanlış', 'KART');
    expect(bakiyeOku(ortam.uygulama.vt, musteri)).toBe(0);
    expect(ozet().beklenen_nakit).toBe(nakitOnce); // nakit kısmı karta iade edildi
    expect(banka()).toBe(-100);
  });

  it('önceki vardiyanın satışı iptal edilince nakit iade BUGÜNKÜ açık kasadan yazılır', () => {
    const id = sat([{ tip: 'NAKIT', tutar: 200 }]);
    gunSonu(ortam.uygulama.baglam, ortam.admin, ozet().beklenen_nakit);
    ortam.admin.kasaOturumId = kasaAc(ortam.uygulama.baglam, ortam.admin, 1000).oturumId;

    satisIptal(ortam.uygulama.baglam, ortam.admin, id, 'ertesi gün iade');
    expect(ozet().beklenen_nakit).toBe(1000 - 200);
  });

  it('nakit iade için açık kasa yoksa iptal reddedilir; tamamen veresiye satış kasasız iptal edilebilir', () => {
    const nakitSatis = sat([{ tip: 'NAKIT', tutar: 200 }]);
    const musteri = musteriEkle(ortam, 'Barış', 1_000_000);
    const veresiyeSatis = sat([{ tip: 'VERESIYE', tutar: 300 }], musteri);
    gunSonu(ortam.uygulama.baglam, ortam.admin, ozet().beklenen_nakit);
    ortam.admin.kasaOturumId = null;

    expect(() => satisIptal(ortam.uygulama.baglam, ortam.admin, nakitSatis, 'x')).toThrow(/kasa/i);
    satisIptal(ortam.uygulama.baglam, ortam.admin, veresiyeSatis, 'yanlış müşteri');
    expect(bakiyeOku(ortam.uygulama.vt, musteri)).toBe(0);
  });

  it('iadesi yapılmış satış iptal edilemez — para ve stok ikinci kez dönmesin', () => {
    const id = sat([{ tip: 'KART', tutar: 500 }]);
    const kalem = kalemleriGetir(ortam.uygulama.vt, id)[0]!;
    iadeYap(ortam.uygulama.baglam, ortam.admin, {
      kaynak_satis_id: id,
      kalemler: [{ satis_kalemi_id: kalem.id, miktar: adet(1) }],
      iade_yontemi: 'KART',
      neden: 'bozuk',
    });
    expect(() => satisIptal(ortam.uygulama.baglam, ortam.admin, id, 'vazgeçti')).toThrow(/iade/i);
  });
});
