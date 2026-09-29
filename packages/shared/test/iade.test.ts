/**
 * İade şeklinin varsayılanı orijinal satışın ödemesinden gelir.
 *
 * Varsayılan "nakit" iken veresiye alınmış malın iadesinde kasiyer müşteriye
 * kasadan para verebiliyordu: müşteri hiç ödemediği malın parasını alır,
 * borcu da olduğu gibi kalırdı.
 */

import { describe, expect, it } from 'vitest';
import { varsayilanIadeYontemi } from '@market/shared';

describe('varsayilanIadeYontemi', () => {
  it('veresiye pay varsa cari hesaba döner', () => {
    expect(varsayilanIadeYontemi([{ odeme_tipi: 'VERESIYE', tutar: 1600 }])).toBe('VERESIYE');
    expect(
      varsayilanIadeYontemi([
        { odeme_tipi: 'NAKIT', tutar: 1000 },
        { odeme_tipi: 'VERESIYE', tutar: 600 },
      ]),
    ).toBe('VERESIYE');
  });

  it('yalnız kartla ödenmişse karta döner', () => {
    expect(varsayilanIadeYontemi([{ odeme_tipi: 'KART', tutar: 1600 }])).toBe('KART');
  });

  it('nakit ya da nakit+kart ödemede nakde döner', () => {
    expect(varsayilanIadeYontemi([{ odeme_tipi: 'NAKIT', tutar: 1600 }])).toBe('NAKIT');
    expect(
      varsayilanIadeYontemi([
        { odeme_tipi: 'NAKIT', tutar: 1000 },
        { odeme_tipi: 'KART', tutar: 600 },
      ]),
    ).toBe('NAKIT');
    expect(varsayilanIadeYontemi([])).toBe('NAKIT');
  });
});
