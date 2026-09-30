/**
 * Tedarikçi ödemesi, iptali ve kasa (§10.7, §11.8).
 *
 * Mal kabulde peşin NAKİT ödemenin kasa hareketi faturaya bağlıdır (belge_id =
 * fatura). Cari ekranından o ödeme iptal edilince kasa hareketi bulunamıyor,
 * para kasaya geri girmiyordu; ardından fatura da iptal edilirse ödeme İKİ KEZ
 * geri alınıyordu.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet } from '@market/shared';
import { bakiyeOku } from '../src/main/depo/cari.js';
import { oturumOzeti } from '../src/main/depo/kasa.js';
import { tahsilatIptal, tahsilatYap } from '../src/main/servis/cari-servis.js';
import { alisFaturasiIptal, malKabulOnayla } from '../src/main/servis/stok-servis.js';
import { tedarikciEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;
let tedarikciId: string;
let urunId: string;

beforeEach(async () => {
  ortam = await testOrtamiKur();
  tedarikciId = tedarikciEkle(ortam, 'Enis Yılmaz');
  urunId = urunEkle(ortam, { stok: adet(0) });
});

afterEach(async () => {
  await ortam.temizle();
});

const beklenenNakit = () => oturumOzeti(ortam.uygulama.vt, ortam.admin.kasaOturumId as string).beklenen_nakit;

/** 5.000 ₺'lik fatura, 2.500 ₺ peşin. */
function faturaGir(odemeTipi: 'NAKIT' | 'HAVALE') {
  return malKabulOnayla(ortam.uygulama.baglam, ortam.admin, {
    tedarikci_id: tedarikciId,
    odenen_tutar: 250_000,
    odeme_tipi: odemeTipi,
    kalemler: [{ urun_id: urunId, miktar: adet(100), birim_fiyat: 5000, kdv_orani: 0 }],
  }).faturaId;
}

function odemeHareketi(faturaId: string) {
  return ortam.uygulama.vt
    .hazirla("SELECT id FROM cari_hareketler WHERE belge_id = ? AND belge_tipi = 'ALIS_ODEME'")
    .tek<{ id: string }>(faturaId)!.id;
}

describe('mal kabul ödemesinin iptali', () => {
  it('nakit ödeme iptal edilince para kasaya geri girer', () => {
    const once = beklenenNakit();
    const faturaId = faturaGir('NAKIT');
    expect(beklenenNakit()).toBe(once - 250_000);

    tahsilatIptal(ortam.uygulama.baglam, ortam.admin, odemeHareketi(faturaId), 'ödenmedi');

    expect(beklenenNakit()).toBe(once);
    expect(bakiyeOku(ortam.uygulama.vt, tedarikciId)).toBe(500_000);
  });

  it('havale/kart ödemesinin iptali kasayı etkilemez', () => {
    const once = beklenenNakit();
    const faturaId = faturaGir('HAVALE');
    expect(beklenenNakit()).toBe(once);
    tahsilatIptal(ortam.uygulama.baglam, ortam.admin, odemeHareketi(faturaId), 'ödenmedi');
    expect(beklenenNakit()).toBe(once);
    expect(bakiyeOku(ortam.uygulama.vt, tedarikciId)).toBe(500_000);
  });

  it('ödemesi zaten iptal edilmiş fatura iptal edilince ödeme ikinci kez geri alınmaz', () => {
    const once = beklenenNakit();
    const faturaId = faturaGir('NAKIT');
    tahsilatIptal(ortam.uygulama.baglam, ortam.admin, odemeHareketi(faturaId), 'ödenmedi');
    alisFaturasiIptal(ortam.uygulama.baglam, ortam.admin, faturaId, 'yanlış fatura');

    expect(bakiyeOku(ortam.uygulama.vt, tedarikciId)).toBe(0);
    expect(beklenenNakit()).toBe(once);
  });

  it('ödemesi iptal edilmemiş fatura iptalinde ödeme ve kasa bir kez geri alınır', () => {
    const once = beklenenNakit();
    const faturaId = faturaGir('NAKIT');
    alisFaturasiIptal(ortam.uygulama.baglam, ortam.admin, faturaId, 'yanlış fatura');
    expect(bakiyeOku(ortam.uygulama.vt, tedarikciId)).toBe(0);
    expect(beklenenNakit()).toBe(once);
  });
});

describe('cari ekranından tedarikçi ödemesi', () => {
  it('nakit ödeme kasadan düşer, iptali kasaya geri koyar', () => {
    faturaGir('HAVALE'); // 2.500 ₺ borç kalır
    const once = beklenenNakit();
    const sonuc = tahsilatYap(ortam.uygulama.baglam, ortam.admin, {
      cari_id: tedarikciId,
      tutar: 100_000,
      odeme_tipi: 'NAKIT',
    });
    expect(beklenenNakit()).toBe(once - 100_000);
    expect(bakiyeOku(ortam.uygulama.vt, tedarikciId)).toBe(150_000);

    tahsilatIptal(ortam.uygulama.baglam, ortam.admin, sonuc.hareketId, 'yanlış tutar');
    expect(beklenenNakit()).toBe(once);
    expect(bakiyeOku(ortam.uygulama.vt, tedarikciId)).toBe(250_000);
  });

  it('kartla ödeme kasayı etkilemez', () => {
    faturaGir('HAVALE');
    const once = beklenenNakit();
    tahsilatYap(ortam.uygulama.baglam, ortam.admin, { cari_id: tedarikciId, tutar: 100_000, odeme_tipi: 'KART' });
    expect(beklenenNakit()).toBe(once);
  });
});

describe('mal kabulde nakit ödeme', () => {
  it('kasa açık değilken nakit ödeme reddedilir (kasadan düşülmeden kaybolmasın)', async () => {
    const kapali = await testOrtamiKur({ kasaAc: false });
    try {
      const t = tedarikciEkle(kapali);
      const u = urunEkle(kapali, { stok: adet(0) });
      expect(() =>
        malKabulOnayla(kapali.uygulama.baglam, kapali.admin, {
          tedarikci_id: t,
          odenen_tutar: 1000,
          odeme_tipi: 'NAKIT',
          kalemler: [{ urun_id: u, miktar: adet(1), birim_fiyat: 1000, kdv_orani: 0 }],
        }),
      ).toThrow(/kasa/i);
    } finally {
      await kapali.temizle();
    }
  });
});
