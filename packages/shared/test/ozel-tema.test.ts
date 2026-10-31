/**
 * Özel tema: kayıt okuma (bozuk/eksik alan varsayılana düşer), dört renkten
 * türetilen değişkenler ve okunurluk (kontrast) hesabı.
 */

import { describe, expect, it } from 'vitest';
import {
  HAZIR_TEMALAR,
  kontrastOrani,
  ozelTemaCoz,
  ozelTemaDegiskenleri,
  VARSAYILAN_OZEL_TEMA,
  YAZI_OLCEGI_SINIRI,
} from '../src/index.js';

describe('ozelTemaCoz', () => {
  it('boş ya da bozuk kayıt varsayılanı verir', () => {
    expect(ozelTemaCoz('')).toEqual(VARSAYILAN_OZEL_TEMA);
    expect(ozelTemaCoz('{bozuk')).toEqual(VARSAYILAN_OZEL_TEMA);
    expect(ozelTemaCoz(null)).toEqual(VARSAYILAN_OZEL_TEMA);
  });

  it('geçersiz alanlar tek tek varsayılana düşer, geçerliler korunur', () => {
    const t = ozelTemaCoz(
      JSON.stringify({ taban: 'koyu', zemin: 'kirmizi', vurgu: '#AA00FF', yaziOlcegi: 500, yaziTipi: 'comic', kose: 'yuvarlak' }),
    );
    expect(t).toMatchObject({
      taban: 'koyu',
      zemin: VARSAYILAN_OZEL_TEMA.zemin,
      vurgu: '#aa00ff',
      yaziOlcegi: YAZI_OLCEGI_SINIRI.cok,
      yaziTipi: VARSAYILAN_OZEL_TEMA.yaziTipi,
      kose: 'yuvarlak',
    });
  });
});

describe('ozelTemaDegiskenleri', () => {
  it('ana renkleri "R G B" kanal biçiminde yazar, ara tonlar arada kalır', () => {
    const d = ozelTemaDegiskenleri({ ...VARSAYILAN_OZEL_TEMA, zemin: '#ffffff', yuzey: '#ffffff', metin: '#000000' });
    expect(d['--zemin']).toBe('255 255 255');
    expect(d['--metin']).toBe('0 0 0');
    const gri = Number(d['--metin-3']!.split(' ')[0]);
    expect(gri).toBeGreaterThan(0);
    expect(gri).toBeLessThan(255);
    // Uyarı/hata renkleri tabandan gelir; özel tema bunları ezmez.
    expect(d['--tehlike']).toBeUndefined();
  });

  it('açık vurgunun üstündeki yazı koyu, koyu vurgununki beyazdır', () => {
    const acikVurgu = ozelTemaDegiskenleri({ ...VARSAYILAN_OZEL_TEMA, vurgu: '#ffe082' });
    const koyuVurgu = ozelTemaDegiskenleri({ ...VARSAYILAN_OZEL_TEMA, vurgu: '#0e3a5c' });
    expect(acikVurgu['--vurgu-uzeri']).not.toBe('255 255 255');
    expect(koyuVurgu['--vurgu-uzeri']).toBe('255 255 255');
  });

  it('köşe çarpanını taşır', () => {
    expect(ozelTemaDegiskenleri({ ...VARSAYILAN_OZEL_TEMA, kose: 'keskin' })['--kose']).toBe('0.35');
  });
});

describe('kontrast', () => {
  it('siyah/beyaz 21, aynı renk 1', () => {
    expect(kontrastOrani('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(kontrastOrani('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('hazır paletlerin hepsi okunur (yazı/kart ve yazı/zemin en az 4,5)', () => {
    for (const h of HAZIR_TEMALAR) {
      expect(kontrastOrani(h.tema.metin, h.tema.yuzey), h.ad).toBeGreaterThanOrEqual(4.5);
      expect(kontrastOrani(h.tema.metin, h.tema.zemin), h.ad).toBeGreaterThanOrEqual(4.5);
    }
  });
});
