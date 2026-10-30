import { describe, expect, it } from 'vitest';
import { ean13Cizimi, ean8Cizimi, etiketBarkodCizimi } from '../src/barkod-cizim.js';

describe('EAN çizimi (raf etiketi)', () => {
  it('EAN-13: 95 modül, korumalarla başlar ve biter', () => {
    const c = ean13Cizimi('8691234567906')!;
    expect(c.toplamModul).toBe(95);
    expect(c.desenler.slice(0, 3)).toEqual([1, 1, 1]);
    expect(c.desenler.reduce((t, d) => t + d, 0)).toBe(95);
  });

  it('kontrol hanesi tutmayan EAN çizilmez; etikette CODE128-B kalır', () => {
    expect(ean13Cizimi('8691234567905')).toBeNull();
    expect(etiketBarkodCizimi('8691234567905')?.tur).toBe('CODE128');
    expect(etiketBarkodCizimi('8691234567906')?.tur).toBe('EAN13');
  });

  it('EAN-8: 67 modül', () => {
    expect(ean8Cizimi('96385074')?.toplamModul).toBe(67);
    expect(etiketBarkodCizimi('96385074')?.tur).toBe('EAN8');
  });
});
