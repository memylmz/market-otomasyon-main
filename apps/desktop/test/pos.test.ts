/**
 * POS entegrasyonu altyapısı.
 *
 * Gerçek cihaz sürücüsü cihaz seçilince eklenecek; buradaki testler ortak
 * sözleşmeyi, test simülatörünü ve satış/iade akışına bağlanışı kilitler.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet } from '@market/shared';
import { ayarYaz } from '../src/main/depo/ayar.js';
import { kalemleriGetir, satisDetayi } from '../src/main/depo/satis.js';
import { satisBelgesi } from '../src/main/donanim/fis-belge.js';
import { PosSimulatoru, SIMULATOR_RED_SONEKI } from '../src/main/donanim/pos.js';
import { posDurumu, posIadesi, posOdemesi } from '../src/main/servis/pos-servis.js';
import { iadeTutariHesapla, iadeYap, kartPosReferansi, satisKesinlestir } from '../src/main/servis/satis-servis.js';
import { testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

describe('POS simülatörü', () => {
  it('onaylar: onay kodu, referans ve maskeli kart döner', async () => {
    const s = await new PosSimulatoru(0).satis(12_345, 'satis-1');
    expect(s.onaylandi).toBe(true);
    expect(s.onay_kodu).toMatch(/^\d{6}$/);
    expect(s.referans).toBeTruthy();
    expect(s.kart_maske).toMatch(/\*{4} \d{4}/);
  });

  it(`kuruşu ${SIMULATOR_RED_SONEKI} ile biten tutarı reddeder (test için)`, async () => {
    const s = await new PosSimulatoru(0).satis(10_000 + SIMULATOR_RED_SONEKI, 'satis-2');
    expect(s.onaylandi).toBe(false);
    expect(s.hata).toBeTruthy();
  });
});

describe('POS servisi', () => {
  it('POS kapalıyken pasif görünür ve ödeme istenemez', async () => {
    expect(posDurumu(ortam.uygulama.baglam).aktif).toBe(false);
    await expect(posOdemesi(ortam.uygulama.baglam, ortam.admin, 1000)).rejects.toThrow(/POS/);
  });

  it('simülatör seçilince ödeme ve iade alınır', async () => {
    ayarYaz(ortam.uygulama.vt, 'pos.turu', 'SIMULATOR');
    ayarYaz(ortam.uygulama.vt, 'pos.simulator_gecikme_ms', '0');
    expect(posDurumu(ortam.uygulama.baglam)).toMatchObject({ aktif: true, tur: 'SIMULATOR' });
    const odeme = await posOdemesi(ortam.uygulama.baglam, ortam.admin, 2500);
    expect(odeme.onaylandi).toBe(true);
    const iade = await posIadesi(ortam.uygulama.baglam, ortam.admin, 2500, odeme.referans ?? null);
    expect(iade.onaylandi).toBe(true);
  });
});

describe('POS bilgisi satışla saklanır ve fişe basılır', () => {
  it('kart ödemesinin onay kodu, kartı ve referansı kaydedilir', () => {
    const urun = urunEkle(ortam, { satisFiyati: 1000, stok: adet(10) });
    const id = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urun, miktar: adet(1), birim_fiyat: 1000 }],
      odemeler: [{ tip: 'KART', tutar: 1000, pos_onay_kodu: '123456', pos_referans: 'REF-1', pos_kart: '**** 4242' }],
    }).satisId;

    const detay = satisDetayi(ortam.uygulama.vt, id)!;
    expect(detay.odemeler[0]).toMatchObject({ pos_onay_kodu: '123456', pos_referans: 'REF-1', pos_kart: '**** 4242' });

    const belge = satisBelgesi(detay, { ad: 'Market' }, { yasalUyari: 'u' });
    expect(belge.odemeler).toEqual(
      expect.arrayContaining([expect.objectContaining({ etiket: expect.stringContaining('**** 4242') })]),
    );
    expect(JSON.stringify(belge.odemeler)).toContain('123456');
  });
});

describe('karta iade POS ile', () => {
  it('iade tutarı önceden hesaplanır, orijinal çekimin referansı bulunur, POS bilgisi iade fişine yazılır', () => {
    const urun = urunEkle(ortam, { satisFiyati: 1000, stok: adet(10) });
    const satisId = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urun, miktar: adet(4), birim_fiyat: 1000 }],
      odemeler: [{ tip: 'KART', tutar: 4000, pos_onay_kodu: '111111', pos_referans: 'REF-SATIS', pos_kart: '**** 1111' }],
    }).satisId;
    const kalem = kalemleriGetir(ortam.uygulama.vt, satisId)[0]!;
    const istek = [{ satis_kalemi_id: kalem.id, miktar: adet(1) }];

    expect(iadeTutariHesapla(ortam.uygulama.vt, satisId, istek)).toBe(1000);
    expect(kartPosReferansi(ortam.uygulama.vt, satisId)).toBe('REF-SATIS');

    const iade = iadeYap(
      ortam.uygulama.baglam,
      ortam.admin,
      { kaynak_satis_id: satisId, kalemler: istek, iade_yontemi: 'KART', neden: 'test' },
      { onay_kodu: '222222', referans: 'REF-IADE', kart_maske: '**** 1111' },
    );
    expect(iade.genelToplam).toBe(-1000);
    expect(satisDetayi(ortam.uygulama.vt, iade.satisId)!.odemeler[0]).toMatchObject({
      pos_onay_kodu: '222222',
      pos_referans: 'REF-IADE',
    });
  });
});
