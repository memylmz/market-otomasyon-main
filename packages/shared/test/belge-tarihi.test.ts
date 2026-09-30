/**
 * Belge tarihi — formdaki "fatura tarihi" gününün zaman damgasına çevrimi.
 *
 * Eskiden `${gun}T00:00:00.000Z` gönderiliyordu: UTC gece yarısı TR'de 03:00'tür.
 * Bugünün faturası 03:00'te girilmiş görünüyor, gerçek saat kayboluyordu.
 */

import { describe, expect, it } from 'vitest';
import { belgeTarihi, gunAnahtari, gunBasi } from '@market/shared';

describe('belgeTarihi', () => {
  it('bugünün belgesi işlem anını taşır', () => {
    const an = '2026-09-30T08:24:22.223Z';
    expect(belgeTarihi(gunAnahtari(an), an)).toBe(an);
  });

  it('geçmiş günün belgesi o yerel günün başına yazılır, UTC gece yarısına değil', () => {
    const an = '2026-09-30T08:24:22.223Z';
    expect(belgeTarihi('2026-09-25', an)).toBe(gunBasi('2026-09-25'));
    expect(gunAnahtari(belgeTarihi('2026-09-25', an))).toBe('2026-09-25');
  });
});
