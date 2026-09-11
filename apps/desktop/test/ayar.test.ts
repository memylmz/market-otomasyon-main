/**
 * Ayar okuma yardımcıları (§13.2).
 *
 * NEDEN VAR: boş bırakılan sayısal bir ayar `Number('')` yüzünden SIFIR
 * okunuyordu, varsayılan yerine. Fiş satır genişliğinde bunun sonucu ağırdır:
 * 0 karakterlik satırla ayırıcı hiç basılmaz ve sütunlar bozulur — hata ancak
 * kağıda basılınca görülür, hiçbir birim testine takılmaz.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ayarSayi, ayarBool, ayarYaz } from '../src/main/depo/ayar.js';
import { testOrtamiKur, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

describe('ayarSayi', () => {
  it('boş değer varsayılana düşer, sıfıra değil', () => {
    ayarYaz(ortam.uygulama.vt, 'test.genislik', '');
    expect(ayarSayi(ortam.uygulama.vt, 'test.genislik', 48)).toBe(48);
  });

  it('yalnız boşluk içeren değer de varsayılana düşer', () => {
    ayarYaz(ortam.uygulama.vt, 'test.genislik', '   ');
    expect(ayarSayi(ortam.uygulama.vt, 'test.genislik', 48)).toBe(48);
  });

  it('gerçek sıfır yazıldıysa sıfır okunur', () => {
    ayarYaz(ortam.uygulama.vt, 'test.sifir', '0');
    expect(ayarSayi(ortam.uygulama.vt, 'test.sifir', 48)).toBe(0);
  });

  it('geçerli sayıyı okur', () => {
    ayarYaz(ortam.uygulama.vt, 'test.genislik', '32');
    expect(ayarSayi(ortam.uygulama.vt, 'test.genislik', 48)).toBe(32);
  });

  /** Türkçe klavyede ondalık ayracı virgüldür; "2,5" yazan kullanıcı haklıdır. */
  it('virgüllü ondalığı kabul eder', () => {
    ayarYaz(ortam.uygulama.vt, 'test.mm', '2,5');
    expect(ayarSayi(ortam.uygulama.vt, 'test.mm', 2)).toBe(2.5);
  });

  it('sayı olmayan değer varsayılana düşer', () => {
    ayarYaz(ortam.uygulama.vt, 'test.bozuk', 'abc');
    expect(ayarSayi(ortam.uygulama.vt, 'test.bozuk', 48)).toBe(48);
  });
});

describe('ayarBool', () => {
  it('yazılmamış anahtar varsayılanı verir', () => {
    expect(ayarBool(ortam.uygulama.vt, 'test.yok', true)).toBe(true);
    expect(ayarBool(ortam.uygulama.vt, 'test.yok', false)).toBe(false);
  });

  it('1 açık, 0 kapalı demektir', () => {
    ayarYaz(ortam.uygulama.vt, 'test.acik', '1');
    ayarYaz(ortam.uygulama.vt, 'test.kapali', '0');
    expect(ayarBool(ortam.uygulama.vt, 'test.acik', false)).toBe(true);
    expect(ayarBool(ortam.uygulama.vt, 'test.kapali', true)).toBe(false);
  });
});
