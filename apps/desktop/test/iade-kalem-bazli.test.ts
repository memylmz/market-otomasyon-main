/**
 * İade edilen miktar KALEM bazındadır (§10.4).
 *
 * Aynı ürün fişte birden fazla satırda olabilir: farklı adlı muhtelif
 * kalemler ("Pil", "Gazete") ya da iskontolu ve iskontosuz iki satır. Eskiden
 * "bu satırdan ne kadar iade edildi" ürün kimliğiyle bulunuyordu; bir satırın
 * iadesi ötekinden de düşülüyor, öteki satır iade edilemez hâle geliyordu.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet, HATA_KODU, uuid } from '@market/shared';
import { bekleyenOlaylar } from '../src/main/depo/senkron.js';
import { kalemleriGetir } from '../src/main/depo/satis.js';
import { iadeYap, satisKesinlestir } from '../src/main/servis/satis-servis.js';
import { bekleyenIadeleriIsle, iadeTalimatiniSakla } from '../src/main/servis/iade-talimat-servis.js';
import { testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;
let satisId: string;

beforeEach(async () => {
  ortam = await testOrtamiKur();
  const urunId = urunEkle(ortam, { ad: 'Muhtelif', satisFiyati: 2500, stok: adet(10) });
  // Aynı ürün iki ayrı satırda: A 1 adet, B 2 adet.
  satisId = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
    kalemler: [
      { urun_id: urunId, urun_adi: 'Pil', miktar: adet(1), birim_fiyat: 2500 },
      { urun_id: urunId, urun_adi: 'Gazete', miktar: adet(2), birim_fiyat: 2500 },
    ],
    odemeler: [{ tip: 'NAKIT', tutar: 7500 }],
  }).satisId;
});

afterEach(async () => {
  await ortam.temizle();
});

function iade(kalemId: string, miktar: number) {
  return iadeYap(ortam.uygulama.baglam, ortam.admin, {
    kaynak_satis_id: satisId,
    kalemler: [{ satis_kalemi_id: kalemId, miktar }],
    iade_yontemi: 'NAKIT',
    neden: 'Müşteri vazgeçti',
  });
}

describe('kalem bazlı iade', () => {
  it('bir satırın iadesi aynı ürünün öteki satırından düşülmez', () => {
    const [pil, gazete] = kalemleriGetir(ortam.uygulama.vt, satisId);
    iade(gazete!.id, adet(2));

    const sonra = kalemleriGetir(ortam.uygulama.vt, satisId);
    expect(sonra.find((k) => k.id === pil!.id)?.iade_edilen).toBe(0);
    expect(sonra.find((k) => k.id === gazete!.id)?.iade_edilen).toBe(-adet(2));

    // Pil hâlâ iade edilebilir; eskiden "en fazla -1 birim" hatası veriyordu.
    expect(() => iade(pil!.id, adet(1))).not.toThrow();
  });

  it('bir satırdan satılandan fazlası yine iade edilemez', () => {
    const [, gazete] = kalemleriGetir(ortam.uygulama.vt, satisId);
    iade(gazete!.id, adet(2));
    expect(() => iade(gazete!.id, adet(1))).toThrow(expect.objectContaining({ kod: HATA_KODU.IADE_MIKTARI_ASILDI }));
  });

  it('iade olayı kaynak kalemi buluta taşır', () => {
    const [, gazete] = kalemleriGetir(ortam.uygulama.vt, satisId);
    iade(gazete!.id, adet(1));
    const olay = bekleyenOlaylar(ortam.uygulama.vt).find((o) => o.olay_tipi === 'IADE_YAPILDI');
    const veri = JSON.parse(String(olay?.veri)) as {
      kalemler: { id: string; kaynak_kalem_id: string; kaynak_kalem_sira: number }[];
    };
    expect(veri.kalemler[0]).toMatchObject({ kaynak_kalem_id: gazete!.id, kaynak_kalem_sira: gazete!.sira });
    expect(veri.kalemler[0]?.id).toBeTruthy();
  });
});

describe('panel iade talimatının sonucu', () => {
  it('uygulanan talimat buluta TALIMAT_SONUCLANDI ile bildirilir', () => {
    const [pil] = kalemleriGetir(ortam.uygulama.vt, satisId);
    const talimatId = uuid();
    iadeTalimatiniSakla(ortam.uygulama.vt, {
      id: talimatId,
      satis_id: satisId,
      kalemler: [{ satis_kalemi_id: pil!.id, miktar: adet(1) }],
      iade_yontemi: 'NAKIT',
      neden: 'Panelden iade',
      hedef_cihaz_id: ortam.uygulama.cihazId,
    });

    expect(bekleyenIadeleriIsle(ortam.uygulama.baglam, ortam.admin).uygulanan).toBe(1);

    const olay = bekleyenOlaylar(ortam.uygulama.vt).find((o) => o.olay_tipi === 'TALIMAT_SONUCLANDI');
    expect(JSON.parse(String(olay?.veri))).toMatchObject({
      varlik: 'iade_talimatlari',
      talimat_id: talimatId,
      uygulandi_mi: true,
    });
  });
});

describe('parça parça iadede kuruş kayması', () => {
  it('satırın tamamı tek tek iade edilince dönen toplam satış tutarına eşittir', () => {
    const urunId = urunEkle(ortam, { ad: 'Kalem', satisFiyati: 1000, stok: adet(5) });
    // 2 × 10,00 − 0,01 iskonto = 19,99 ₺: yarısı 9,995 → her parça ayrı yuvarlanınca 20,00 dönüyordu.
    const satis = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(2), birim_fiyat: 1000, iskonto_tutar: 1 }],
      odemeler: [{ tip: 'NAKIT', tutar: 1999 }],
    }).satisId;
    const kalemId = kalemleriGetir(ortam.uygulama.vt, satis)[0]!.id;
    const birer = () =>
      iadeYap(ortam.uygulama.baglam, ortam.admin, {
        kaynak_satis_id: satis,
        kalemler: [{ satis_kalemi_id: kalemId, miktar: adet(1) }],
        iade_yontemi: 'NAKIT',
        neden: 'Müşteri vazgeçti',
      });

    const toplam = -birer().genelToplam - birer().genelToplam;
    expect(toplam).toBe(1999);
  });
});
