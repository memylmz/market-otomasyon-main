/**
 * Müşteri ekranı teması: hazır tema renkleri, özel renkler, bozuk kayıt.
 */

import { describe, expect, it } from 'vitest';
import {
  kontrastOrani,
  MUSTERI_HAZIR_TEMALARI,
  musteriTemaDegiskenleri,
  musteriTemasiCoz,
  VARSAYILAN_MUSTERI_TEMASI,
} from '../src/index.js';

describe('musteriTemasiCoz', () => {
  it('boş ya da bozuk kayıt Şampanya temasını verir', () => {
    expect(musteriTemasiCoz('')).toEqual(VARSAYILAN_MUSTERI_TEMASI);
    expect(musteriTemasiCoz('{bozuk')).toEqual(VARSAYILAN_MUSTERI_TEMASI);
  });

  it('hazır temada kayıttaki renkler yok sayılır, temanın renkleri kullanılır', () => {
    const t = musteriTemasiCoz(JSON.stringify({ ad: 'INCI', zemin: '#000000', yaziTipi: 'KLASIK' }));
    expect(t).toMatchObject({ ad: 'INCI', zemin: MUSTERI_HAZIR_TEMALARI.INCI.zemin, yaziTipi: 'KLASIK' });
  });

  it('özel temada geçerli renkler korunur, geçersizler varsayılana düşer', () => {
    const t = musteriTemasiCoz(JSON.stringify({ ad: 'OZEL', zemin: '#112233', metin: 'beyaz', vurgu: '#AABBCC' }));
    expect(t).toMatchObject({ ad: 'OZEL', zemin: '#112233', metin: VARSAYILAN_MUSTERI_TEMASI.metin, vurgu: '#aabbcc' });
  });
});

describe('musteriTemaDegiskenleri', () => {
  it('ana renkleri ve yazı tipini yazar, ara tonlar zemin ile yazı arasında kalır', () => {
    const d = musteriTemaDegiskenleri({ ad: 'OZEL', zemin: '#000000', metin: '#ffffff', vurgu: '#ff0000', yaziTipi: 'DAR' });
    expect(d['--m-zemin']).toBe('#000000');
    expect(d['--m-altin']).toBe('#ff0000');
    expect(d['--m-metin-2']).toBe('#b3b3b3');
    expect(d['--m-yazi']).toContain('Bahnschrift');
  });

  it('hazır temaların hepsinde yazı zeminde okunur (en az 7) ve fiyat seçilir (en az 4,5)', () => {
    for (const [ad, t] of Object.entries(MUSTERI_HAZIR_TEMALARI)) {
      expect(kontrastOrani(t.metin, t.zemin), ad).toBeGreaterThanOrEqual(7);
      expect(kontrastOrani(t.vurgu, t.zemin), ad).toBeGreaterThanOrEqual(4.5);
    }
  });
});
