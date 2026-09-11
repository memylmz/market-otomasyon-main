/**
 * CSV içe aktarma açılış stoğu yazıyordu ama olayını kuyruğa DÜŞMÜYORDU:
 * miktar yalnız kasada kalıyor, panel ilk günden farklı bir stok gösteriyordu.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet } from '@market/shared';
import { barkodSahibi } from '../src/main/depo/katalog.js';
import { stokOku } from '../src/main/depo/stok.js';
import { urunleriIceAktar } from '../src/main/servis/katalog-servis.js';
import { testOrtamiKur, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

describe('CSV içe aktarma', () => {
  it('açılış stoğunu yazar ve STOK_HAREKETI olayını kuyruğa düşer', () => {
    const csv = ['ad;satis_fiyati;alis_fiyati;acilis_stogu', 'İçe Aktarılan Kola;25,00;15,00;7'].join('\n');

    const sonuc = urunleriIceAktar(ortam.uygulama.baglam, ortam.admin, csv, true);
    expect(sonuc.eklenen).toBe(1);
    expect(sonuc.hatali).toBe(0);

    // Ürünü adından bulabilmek için genel arama yap
    const kaydedilmisUrunler = ortam.uygulama.baglam.vt
      .hazirla("SELECT id FROM urunler WHERE ad = ?")
      .tek<{ id: string }>('İçe Aktarılan Kola');
    const urunId = kaydedilmisUrunler?.id;
    expect(urunId).toBeTruthy();
    expect(stokOku(ortam.uygulama.baglam.vt, urunId!)).toBe(adet(7));

    const olaylar = ortam.uygulama.baglam.vt
      .hazirla('SELECT olay_tipi FROM sync_outbox')
      .tumu<{ olay_tipi: string }>()
      .map((o) => o.olay_tipi);
    expect(olaylar).toContain('STOK_HAREKETI');
  });
});
