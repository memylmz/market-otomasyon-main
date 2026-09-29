/**
 * Alış faturası detayı — cari ekstresinden "faturayı gör" ile açılır.
 *
 * Fatura tablosunda ödenen tutar tutulmaz; cari defterindeki ödeme
 * hareketlerinden türetilir. İptal edilen ödeme düşülmezse iptal edilmiş bir
 * faturada "ödenmiş" tutar görünmeye devam ederdi.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet } from '@market/shared';
import { alisFaturasiBul } from '../src/main/depo/satis.js';
import { alisFaturasiIptal, malKabulOnayla } from '../src/main/servis/stok-servis.js';
import { tedarikciEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

function faturaGir(odenen: number): string {
  const tedarikciId = tedarikciEkle(ortam);
  const urunId = urunEkle(ortam, { stok: adet(0) });
  return malKabulOnayla(ortam.uygulama.baglam, ortam.admin, {
    tedarikci_id: tedarikciId,
    fatura_no: 'F-1',
    odenen_tutar: odenen,
    odeme_tipi: 'KART',
    kalemler: [{ urun_id: urunId, miktar: adet(10), birim_fiyat: 1000, kdv_orani: 0 }],
  }).faturaId;
}

describe('alış faturası detayı', () => {
  it('peşin ödenen tutarı ve faturayı gireni getirir', () => {
    const faturaId = faturaGir(4000);
    const fatura = alisFaturasiBul(ortam.uygulama.baglam.vt, faturaId);

    expect(fatura?.genel_toplam).toBe(10_000);
    expect(fatura?.odenen).toBe(4000);
    expect(fatura?.kullanici_adi).toBe('Test Yönetici');
  });

  it('ödemesiz faturada ödenen sıfırdır', () => {
    const faturaId = faturaGir(0);
    expect(alisFaturasiBul(ortam.uygulama.baglam.vt, faturaId)?.odenen).toBe(0);
  });

  it('iptal edilen faturada ödeme de geri alınmış sayılır', () => {
    const faturaId = faturaGir(4000);
    alisFaturasiIptal(ortam.uygulama.baglam, ortam.admin, faturaId, 'yanlış girildi');

    const fatura = alisFaturasiBul(ortam.uygulama.baglam.vt, faturaId);
    expect(fatura?.durum).toBe('IPTAL');
    expect(fatura?.odenen).toBe(0);
  });
});
