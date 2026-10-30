/**
 * Mal kabulde yanlış girilen SKT / lot düzeltmesi.
 *
 * Parti (ürün + SKT + lot) bütünüyle düzelir; miktar ve maliyet değişmez,
 * stok hareketlerinin kilidi diğer alanlar için yerinde kalır.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet, bugun, gunEkle } from '@market/shared';
import { bekleyenOlaylar } from '../src/main/depo/senkron.js';
import { sktYaklasanlar, stokOku } from '../src/main/depo/stok.js';
import { fireCikisi, malKabulOnayla, sktDuzelt } from '../src/main/servis/stok-servis.js';
import { tedarikciEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;
let sut: string;
const yanlis = gunEkle(bugun(), 2); // kasiyer 2 gün sonrasını yazdı
const dogru = gunEkle(bugun(), 32); // aslında bir ay sonrası

beforeEach(async () => {
  ortam = await testOrtamiKur();
  sut = urunEkle(ortam, { ad: 'Süt', stok: adet(0) });
  malKabulOnayla(ortam.uygulama.baglam, ortam.admin, {
    tedarikci_id: tedarikciEkle(ortam),
    kalemler: [{ urun_id: sut, miktar: adet(10), birim_fiyat: 500, kdv_orani: 1, skt: yanlis, lot_no: 'L1' }],
  });
});

afterEach(async () => {
  await ortam.temizle();
});

describe('SKT düzeltme', () => {
  it('partinin tarihi düzelir, miktar değişmez, buluta olay gider', () => {
    const { baglam, vt } = ortam.uygulama;
    expect(sktYaklasanlar(vt, 30).map((s) => s.skt)).toEqual([yanlis]);

    const sonuc = sktDuzelt(baglam, ortam.admin, {
      urun_id: sut,
      eski_skt: yanlis,
      eski_lot: 'L1',
      yeni_skt: dogru,
      yeni_lot: 'L1',
    });
    expect(sonuc).toEqual({ hareket: 1, kalem: 1 });
    expect(sktYaklasanlar(vt, 30)).toEqual([]);
    expect(sktYaklasanlar(vt, 40).map((s) => s.skt)).toEqual([dogru]);
    expect(stokOku(vt, sut)).toBe(adet(10));
    expect(vt.hazirla('SELECT skt FROM alis_kalemleri WHERE urun_id = ?').tek<{ skt: string }>(sut)?.skt).toBe(dogru);
    const olay = bekleyenOlaylar(vt, 1000).find((o) => o.olay_tipi === 'SKT_DUZELTILDI');
    expect(JSON.parse(String(olay?.veri))).toMatchObject({ urun_id: sut, eski_skt: yanlis, yeni_skt: dogru });
  });

  it('fire sonrası düzeltmede kalan miktar doğru partide görünür', () => {
    const { baglam, vt } = ortam.uygulama;
    fireCikisi(baglam, ortam.admin, { urun_id: sut, miktar: adet(3), neden_kodu: 'SKT_GECTI' });
    sktDuzelt(baglam, ortam.admin, { urun_id: sut, eski_skt: yanlis, eski_lot: 'L1', yeni_skt: dogru, yeni_lot: 'L1' });
    const partiler = sktYaklasanlar(vt, 40);
    expect(partiler).toHaveLength(1);
    expect(partiler[0]).toMatchObject({ skt: dogru, kalan_miktar: adet(7) });
  });

  it('bulunmayan parti ve değişikliksiz istek reddedilir', () => {
    const { baglam } = ortam.uygulama;
    expect(() =>
      sktDuzelt(baglam, ortam.admin, { urun_id: sut, eski_skt: '2020-01-01', eski_lot: null, yeni_skt: dogru, yeni_lot: null }),
    ).toThrow();
    expect(() =>
      sktDuzelt(baglam, ortam.admin, { urun_id: sut, eski_skt: yanlis, eski_lot: 'L1', yeni_skt: yanlis, yeni_lot: 'L1' }),
    ).toThrow(/Değişiklik yok/);
  });

  it('stok hareketinin miktarı ve maliyeti hâlâ değiştirilemez', () => {
    const { vt } = ortam.uygulama;
    expect(() => vt.hazirla('UPDATE stok_hareketleri SET miktar = 1').calistir()).toThrow(/append-only/);
    expect(() => vt.hazirla('UPDATE stok_hareketleri SET birim_maliyet = 1').calistir()).toThrow(/append-only/);
    expect(() => vt.hazirla('DELETE FROM stok_hareketleri').calistir()).toThrow(/append-only/);
  });
});
