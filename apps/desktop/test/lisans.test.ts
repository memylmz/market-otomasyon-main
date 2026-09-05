/**
 * Lisans seviyeleri (§23.3).
 *
 * NEDEN VAR: `lisans-servis` 229 satırdı ve hiç testi yoktu. Buradaki bir hata
 * doğrudan "market sabah kasayı açamıyor"a çıkar; kritik akış çevresel bir
 * duruma bağlı kalmamalıdır. Tasarım gereği lisans ANİDEN kilitlemez: önce
 * grace period boyunca uyarılır.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bugun, gunEkle } from '@market/shared';
import { ayarYaz } from '../src/main/depo/ayar.js';
import { lisansDurumu } from '../src/main/servis/lisans-servis.js';
import { testOrtamiKur, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur({ kasaAc: false });
});

afterEach(async () => {
  await ortam.temizle();
});

function ayar(anahtar: string, deger: string): void {
  ortam.uygulama.baglam.vt.islem(() => ayarYaz(ortam.uygulama.baglam.vt, anahtar, deger));
}

describe('lisans durumu', () => {
  it('hiç aktive edilmemişse AKTIVE_EDILMEMIS', () => {
    expect(lisansDurumu(ortam.uygulama.baglam).seviye).toBe('AKTIVE_EDILMEMIS');
  });

  /** Süresiz lisans: bitiş tarihi yoksa kısıt da yoktur. */
  it('token var, bitiş yoksa AKTIF', () => {
    ayar('lisans.cihaz_token', 'token-123');
    expect(lisansDurumu(ortam.uygulama.baglam).seviye).toBe('AKTIF');
  });

  it('bitiş ileri tarihliyse AKTIF ve kalan gün doğru', () => {
    ayar('lisans.cihaz_token', 'token-123');
    ayar('lisans.bitis', gunEkle(bugun(), 30));
    const durum = lisansDurumu(ortam.uygulama.baglam);
    expect(durum.seviye).toBe('AKTIF');
    expect(durum.lisansBitis).toBe(gunEkle(bugun(), 30));
    expect(durum.yonetimKisitli, 'aktif lisansta kısıt olmamalı').toBe(false);
  });

  /**
   * Süre dolduğunda kasa ANINDA durmaz: grace period boyunca çalışır. Market
   * sabahı ödeme gecikmesi yüzünden kepenk kapatamaz.
   */
  it('süre dolmuş ama grace içindeyse GRACE', () => {
    ayar('lisans.cihaz_token', 'token-123');
    ayar('lisans.bitis', gunEkle(bugun(), -3));
    ayar('lisans.grace_gun', '14');
    const durum = lisansDurumu(ortam.uygulama.baglam);
    expect(durum.seviye).toBe('GRACE');
    expect(durum.graceKalanGun).toBeGreaterThan(0);
    expect(durum.yonetimKisitli, 'grace süresinde de kısıt yok').toBe(false);
  });

  it('grace da dolduysa KISITLI', () => {
    ayar('lisans.cihaz_token', 'token-123');
    ayar('lisans.bitis', gunEkle(bugun(), -30));
    ayar('lisans.grace_gun', '14');
    const durum = lisansDurumu(ortam.uygulama.baglam);
    expect(durum.seviye).toBe('KISITLI');
    // Kısıt YÖNETİMSELDİR: satış her zaman açık kalır (§20).
    expect(durum.yonetimKisitli).toBe(true);
  });

  it('bitiş tam bugünse hâlâ AKTIF — son gün tam gün sayılır', () => {
    ayar('lisans.cihaz_token', 'token-123');
    ayar('lisans.bitis', bugun());
    expect(lisansDurumu(ortam.uygulama.baglam).seviye).toBe('AKTIF');
  });
});
