/**
 * Pavo rapor ayrıştırıcısı. Cihaz tutarları sayı, düz metin ya da Türkçe
 * biçimli metin olarak gönderiyor; biri yanlış okunursa raporda 100 kat
 * hatalı tutar görünür.
 */

import { describe, expect, it } from 'vitest';
import { pavoRaporBirlestir, pavoRaporlariCoz, pavoRaporNet, pavoRaporTarihi, pavoRaporTutari } from '../src/pavo-rapor.js';

describe('pavoRaporTutari', () => {
  it.each([
    [12.5, 1250],
    ['12.50', 1250],
    ['+1.234,50 TL', 123450],
    ['-3,00 TL', -300],
    ['-3.5 TL', -350],
    ['3.192', 319200],
    ['1.234.567,89', 123456789],
    ['250', 25000],
    ['', 0],
    [null, 0],
    ['TL', 0],
  ])('%s → %s kuruş', (girdi, beklenen) => {
    expect(pavoRaporTutari(girdi)).toBe(beklenen);
  });
});

describe('pavoRaporTarihi', () => {
  it('iki biçimi de yerel ISO yapar', () => {
    expect(pavoRaporTarihi('2026-10-29T08:30:12.123456')).toBe('2026-10-29T08:30:12');
    expect(pavoRaporTarihi('29.10.2026 13:03')).toBe('2026-10-29T13:03:00');
    expect(pavoRaporTarihi('29.10.2026')).toBe('2026-10-29T00:00:00');
    expect(pavoRaporTarihi('dün')).toBeNull();
    expect(pavoRaporTarihi(undefined)).toBeNull();
  });
});

describe('pavoRaporlariCoz', () => {
  it('tür cihazın yazımından bulunur; tanınmayan türün adı korunur', () => {
    const r = pavoRaporlariCoz({
      Reports: [
        { BatchId: 1, BatchType: 'X', DifferenceIndicator: 'N' },
        { BatchId: 2, BatchType: 'X', DifferenceIndicator: 'Y' },
        { BatchId: 3, BatchType: 'T', ZReportNo: 4 },
        { BatchId: 4, BatchType: 'Q' },
      ],
    });
    expect(r.map((x) => [x.tur, x.ad, x.zNo])).toEqual([
      ['X', 'X', null],
      ['XFARK', 'X', null],
      ['GUN_SONU', 'T', 4],
      [null, 'Q', null],
    ]);
  });

  it('boş ya da tanınmayan veri boş liste', () => {
    expect(pavoRaporlariCoz(null)).toEqual([]);
    expect(pavoRaporlariCoz({ baska: [] })).toEqual([]);
  });

  it('birleştirme eksikleri tamamlar, dolu alanı ezmez; net tutar', () => {
    const [ozet] = pavoRaporlariCoz({ Batches: [{ BatchId: 9, TotalPaymentAmount: 100, TotalCancelledAmount: 15 }] });
    const [satir] = pavoRaporlariCoz({ Reports: [{ BatchId: 9, BatchType: 'T', ZReportNo: '12', TotalPaymentAmount: 1 }] });
    const tam = pavoRaporBirlestir(ozet!, satir!);
    expect(tam).toMatchObject({ raporId: 9, tur: 'GUN_SONU', zNo: 12, satisTutari: 10000, iptalTutari: 1500 });
    expect(pavoRaporNet(tam)).toBe(8500);
  });
});
