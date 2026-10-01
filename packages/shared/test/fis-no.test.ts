/**
 * Fiş numarası ödeme türünü taşır: NA-000001 (nakit), KA- (kart), VA-
 * (veresiye), PA- (karma), IA- (iade). Kasa serisi (A, B…) korunur — iki
 * kasanın aynı numarayı üretmemesinin güvencesi odur.
 */

import { describe, expect, it } from 'vitest';
import { fisNo, fisNoSadelestir, fisTurHarfi } from '@market/shared';

describe('fiş numarası', () => {
  it('ödeme türüne göre harf alır', () => {
    expect(fisTurHarfi([{ tip: 'NAKIT', tutar: 100 }])).toBe('N');
    expect(fisTurHarfi([{ tip: 'KART', tutar: 100 }])).toBe('K');
    expect(fisTurHarfi([{ tip: 'VERESIYE', tutar: 100 }])).toBe('V');
    expect(
      fisTurHarfi([
        { tip: 'NAKIT', tutar: 50 },
        { tip: 'KART', tutar: 50 },
      ]),
    ).toBe('P');
    expect(fisTurHarfi([{ tip: 'NAKIT', tutar: 100 }], true)).toBe('I');
  });

  it('tür harfi + kasa serisi + sıra biçimindedir; sadeleştirme ayraçsız arar', () => {
    expect(fisNo('A', 12, 'N')).toBe('NA-000012');
    expect(fisNo('B', 3, 'K')).toBe('KB-000003');
    // Tür verilmezse eski biçim (geriye dönük uyum).
    expect(fisNo('A', 7)).toBe('A-000007');
    expect(fisNoSadelestir('NA*000012')).toBe('NA000012');
  });
});
