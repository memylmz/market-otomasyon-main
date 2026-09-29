/**
 * Toplu giriş satırlarının kaleme çevrilmesi. Buradaki hata doğrudan yanlış
 * fatura demektir: 2,5 kg "2500 bindebir", 15,00 ₺ "1500 kuruş" olmak zorunda.
 */

import { describe, expect, it } from 'vitest';
import { topluGirisKalemleri, type TopluGirisSatiri } from '@market/shared';

function satir(ek: Partial<TopluGirisSatiri> = {}): TopluGirisSatiri {
  return { barkod: '', ad: 'Kola 1L', miktar: '12', alis: '15,00', satis: '25,00', kdv: '20', ...ek };
}

describe('topluGirisKalemleri', () => {
  it('metin satırını kuruş ve bindebir kaleme çevirir', () => {
    const { kalemler, hatalar } = topluGirisKalemleri([satir({ barkod: '8690000000017' })]);
    expect(hatalar).toEqual([]);
    expect(kalemler).toEqual([
      {
        yeni_urun: { ad: 'Kola 1L', barkod: '8690000000017', satis_fiyati: 2500, birim_tipi: 'ADET', kategori_id: null },
        miktar: 12_000,
        birim_fiyat: 1500,
        kdv_orani: 20,
      },
    ]);
  });

  it('satış fiyatı boşsa kâr marjından hesaplar', () => {
    const { kalemler } = topluGirisKalemleri([satir({ satis: '' })], { marjYuzde: 40 });
    // 1500 / (1 - 0,40) = 2500 matrah; %20 KDV → 3000
    expect(kalemler[0]!.yeni_urun!.satis_fiyati).toBe(3000);
  });

  it('elle yazılan satış fiyatı marjı ezer', () => {
    const { kalemler } = topluGirisKalemleri([satir({ satis: '27,50' })], { marjYuzde: 40 });
    expect(kalemler[0]!.yeni_urun!.satis_fiyati).toBe(2750);
  });

  it('mevcut ürün satırını urun_id ile bağlar, yeni_urun üretmez', () => {
    const { kalemler } = topluGirisKalemleri([satir({ urun_id: '44444444-4444-4444-8444-444444444444' })]);
    expect(kalemler[0]!.urun_id).toBe('44444444-4444-4444-8444-444444444444');
    expect(kalemler[0]!.yeni_urun).toBeUndefined();
  });

  it('ondalıklı miktarı bindebire çevirir', () => {
    const { kalemler } = topluGirisKalemleri([satir({ miktar: '2,5' })]);
    expect(kalemler[0]!.miktar).toBe(2500);
  });

  it('eksik ad, sıfır miktar ve okunamayan fiyatı satır numarasıyla bildirir', () => {
    const { kalemler, hatalar } = topluGirisKalemleri([
      satir({ ad: '  ' }),
      satir({ miktar: '0' }),
      satir({ alis: 'abc' }),
      satir({ satis: '' }),
    ]);
    expect(kalemler).toEqual([]);
    expect(hatalar.map((h) => h.satir)).toEqual([1, 2, 3, 4]);
    expect(hatalar[0]!.mesaj).toContain('Ürün adı');
    expect(hatalar[3]!.mesaj).toContain('Satış fiyatı');
  });

  it('tamamen boş satırı yok sayar (kullanıcı fazladan satır açmış olabilir)', () => {
    const { kalemler, hatalar } = topluGirisKalemleri([
      { barkod: '', ad: '', miktar: '', alis: '', satis: '', kdv: '20' },
      satir(),
    ]);
    expect(hatalar).toEqual([]);
    expect(kalemler).toHaveLength(1);
  });

  it('sadece satış fiyatı dolu olan satırı hata verir', () => {
    const { kalemler, hatalar } = topluGirisKalemleri([
      { barkod: '', ad: '', miktar: '', alis: '', satis: '25,00', kdv: '20' },
    ]);
    expect(kalemler).toEqual([]);
    expect(hatalar).toHaveLength(1);
    expect(hatalar[0]!.mesaj).toContain('Ürün adı');
  });

  it('KDV boşsa hata verir', () => {
    const { kalemler, hatalar } = topluGirisKalemleri([satir({ kdv: '' })]);
    expect(kalemler).toEqual([]);
    expect(hatalar).toHaveLength(1);
    expect(hatalar[0]!.satir).toBe(1);
    expect(hatalar[0]!.mesaj).toContain('KDV');
  });

  it('KDV okunamazsa hata verir', () => {
    const { kalemler, hatalar } = topluGirisKalemleri([satir({ kdv: 'abc' })]);
    expect(kalemler).toEqual([]);
    expect(hatalar).toHaveLength(1);
    expect(hatalar[0]!.mesaj).toContain('KDV');
  });

  it('KDV 0-100 aralığı dışındaysa hata verir', () => {
    const { kalemler, hatalar } = topluGirisKalemleri([satir({ kdv: '120' })]);
    expect(kalemler).toEqual([]);
    expect(hatalar).toHaveLength(1);
    expect(hatalar[0]!.mesaj).toContain('KDV');
  });

  it('marj %100 ve üzerindeyken satış fiyatı boşsa hata verir', () => {
    const { kalemler, hatalar } = topluGirisKalemleri([satir({ satis: '' })], { marjYuzde: 100 });
    expect(kalemler).toEqual([]);
    expect(hatalar).toHaveLength(1);
    expect(hatalar[0]!.mesaj).toContain('Satış fiyatı');
  });

  it('SKT ve lot doluysa kaleme taşınır', () => {
    const { kalemler, hatalar } = topluGirisKalemleri([satir({ skt: '2026-12-31', lot: 'LOT-42' })]);
    expect(hatalar).toEqual([]);
    expect(kalemler[0]!.skt).toBe('2026-12-31');
    expect(kalemler[0]!.lot_no).toBe('LOT-42');
  });

  it('SKT ve lot boş bırakılırsa kalemde bu alanlar hiç bulunmaz', () => {
    const { kalemler } = topluGirisKalemleri([satir({ skt: '', lot: '' })]);
    expect(kalemler[0]).not.toHaveProperty('skt');
    expect(kalemler[0]).not.toHaveProperty('lot_no');
  });

  it('mevcut ürün satırında da SKT/lot kaleme taşınır (yalnız yeni ürüne özgü değildir)', () => {
    const { kalemler } = topluGirisKalemleri([
      satir({ urun_id: '44444444-4444-4444-8444-444444444444', skt: '2027-01-15', lot: 'L-9' }),
    ]);
    expect(kalemler[0]!.urun_id).toBe('44444444-4444-4444-8444-444444444444');
    expect(kalemler[0]!.skt).toBe('2027-01-15');
    expect(kalemler[0]!.lot_no).toBe('L-9');
  });
});

/*
 * Mal kabulde yeni ürün satırı ürün kartı formuyla ayrıntılandırılabilir
 * (marka, kategori, birim, raf, SKT takibi, ek barkod/kısa kod...). Bu
 * bilgiler satırda taşınır ve fatura kaydedilince ürünle birlikte yazılır.
 */
describe('yeni ürün kartı ayrıntıları', () => {
  it('satırdaki kart bilgileri yeni ürün kalemine taşınır', () => {
    const { kalemler, hatalar } = topluGirisKalemleri([
      {
        barkod: '8690000000017',
        ad: 'Defter A4',
        miktar: '10',
        alis: '50,00',
        satis: '100,00',
        kdv: '10',
        kart: {
          marka: 'Kırtasiye Co',
          kategori_id: '33333333-3333-4333-8333-333333333333',
          birim_tipi: 'ADET',
          kritik_stok: '5',
          raf_konumu: 'B-02',
          skt_takibi: true,
          notlar: 'Çizgili',
          ek_barkodlar: ['24'],
        },
      },
    ]);
    expect(hatalar).toEqual([]);
    expect(kalemler[0]?.yeni_urun).toMatchObject({
      ad: 'Defter A4',
      barkod: '8690000000017',
      satis_fiyati: 10_000,
      marka: 'Kırtasiye Co',
      kategori_id: '33333333-3333-4333-8333-333333333333',
      birim_tipi: 'ADET',
      kritik_stok: 5000,
      raf_konumu: 'B-02',
      skt_takibi: true,
      notlar: 'Çizgili',
      ek_barkodlar: ['24'],
    });
  });

  it('kart bilgisi yoksa eski davranış sürer', () => {
    const { kalemler } = topluGirisKalemleri([{ barkod: '', ad: 'Kalem', miktar: '1', alis: '5', satis: '10', kdv: '20' }]);
    expect(kalemler[0]?.yeni_urun).toEqual({ ad: 'Kalem', satis_fiyati: 1000, birim_tipi: 'ADET', kategori_id: null });
  });
});
