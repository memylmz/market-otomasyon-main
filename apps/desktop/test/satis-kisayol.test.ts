/**
 * Tek tuşla satışın fiş kararı (§10.3).
 *
 * F5 fişsiz, F4 fişli satar; ödeme penceresi ise eskisi gibi `yazici.otomatik_fis`
 * ayarına uyar. Karar IPC katmanında verildiği için testi de orada yapıyoruz.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet, AYAR } from '@market/shared';
import { ayarYaz } from '../src/main/depo/ayar.js';
import { kanallariOlustur } from '../src/main/ipc/kanallar.js';
import { testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;
let kanallar: ReturnType<typeof kanallariOlustur>;

beforeEach(async () => {
  ortam = await testOrtamiKur();
  ortam.uygulama.aktoruAyarla(ortam.admin);
  kanallar = kanallariOlustur(ortam.uygulama);
});

afterEach(async () => {
  await ortam.temizle();
});

/** Tek kalemlik nakit satış girdisi üretir. */
function satisGirdisi(urunId: string, ek: Record<string, unknown> = {}) {
  return {
    kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 1000 }],
    odemeler: [{ tip: 'NAKIT', tutar: 1000, alinan: 1000 }],
    ...ek,
  };
}

describe('fiş yazdırma kararı', () => {
  it('fis_yazdir=false ayarı ezer: otomatik fiş açıkken bile basılmaz', async () => {
    ayarYaz(ortam.uygulama.vt, AYAR.OTOMATIK_FIS, '1');
    const urunId = urunEkle(ortam, { satisFiyati: 1000, stok: adet(5) });

    const sonuc = (await kanallar['satis.kesinlestir'](satisGirdisi(urunId, { fis_yazdir: false }))) as {
      yazdirmaBaslatildi: boolean;
    };

    expect(sonuc.yazdirmaBaslatildi).toBe(false);
  });

  it('fis_yazdir=true ayarı ezer: otomatik fiş kapalıyken bile basılır', async () => {
    ayarYaz(ortam.uygulama.vt, AYAR.OTOMATIK_FIS, '0');
    const urunId = urunEkle(ortam, { satisFiyati: 1000, stok: adet(5) });

    const sonuc = (await kanallar['satis.kesinlestir'](satisGirdisi(urunId, { fis_yazdir: true }))) as {
      yazdirmaBaslatildi: boolean;
    };

    expect(sonuc.yazdirmaBaslatildi).toBe(true);
  });

  it('fis_yazdir verilmezse ayar karar verir — ödeme penceresinin davranışı değişmez', async () => {
    ayarYaz(ortam.uygulama.vt, AYAR.OTOMATIK_FIS, '0');
    const urunId = urunEkle(ortam, { satisFiyati: 1000, stok: adet(5) });

    const sonuc = (await kanallar['satis.kesinlestir'](satisGirdisi(urunId))) as { yazdirmaBaslatildi: boolean };

    expect(sonuc.yazdirmaBaslatildi).toBe(false);
  });

  it('fis_yazdir satış kaydına sızmaz — kalem ve tutarlar bozulmaz', async () => {
    const urunId = urunEkle(ortam, { satisFiyati: 1000, stok: adet(5) });

    const sonuc = (await kanallar['satis.kesinlestir'](satisGirdisi(urunId, { fis_yazdir: true }))) as {
      genelToplam: number;
      satisId: string;
    };

    expect(sonuc.genelToplam).toBe(1000);
    expect(sonuc.satisId).toBeTruthy();
  });
});
