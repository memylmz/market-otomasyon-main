/**
 * Alış faturası satır/toplam hesabı.
 *
 * Buradaki sayılar kasa ekranında kullanıcıya gösterilen sayılardır; mal kabul
 * onaylanınca yazılan tutarla birebir tutmak zorundadırlar.
 */
import { describe, expect, it } from 'vitest';
import { faturaSatiriAyir, faturaToplamlari, kalemTutari, satirOzeti, type TopluGirisSatiri } from '../src/index.js';

function satir(yama: Partial<TopluGirisSatiri> = {}): TopluGirisSatiri {
  return { barkod: '', ad: 'Test', miktar: '1', alis: '10,00', satis: '', kdv: '20', ...yama };
}

describe('kalemTutari', () => {
  it('miktarı bindebirden çözer ve KDV ekler', () => {
    // 12 adet × 24,50 TL = 294,00 net; %20 KDV = 58,80
    const t = kalemTutari({ miktar: 12_000, birim_fiyat: 2450, kdv_orani: 20 });
    expect(t.net).toBe(29_400);
    expect(t.kdv).toBe(5_880);
    expect(t.brut).toBe(35_280);
  });

  it('kesirli miktarı (kilogram) yuvarlar', () => {
    // 1,5 kg × 33,33 TL = 49,995 → 50,00
    expect(kalemTutari({ miktar: 1_500, birim_fiyat: 3333, kdv_orani: 0 }).net).toBe(5_000);
  });

  it('KDV sıfırsa brüt nete eşittir', () => {
    const t = kalemTutari({ miktar: 3_000, birim_fiyat: 1000, kdv_orani: 0 });
    expect(t.kdv).toBe(0);
    expect(t.brut).toBe(t.net);
  });
});

describe('faturaToplamlari', () => {
  it('satır düzeyinde yuvarlar, sonra toplar', () => {
    const toplam = faturaToplamlari([
      { urun_id: 'u1', miktar: 1_000, birim_fiyat: 333, kdv_orani: 20 },
      { urun_id: 'u2', miktar: 1_000, birim_fiyat: 333, kdv_orani: 20 },
    ]);
    expect(toplam.araToplam).toBe(666);
    // Her satır ayrı yuvarlanır: 333 → 66,6 → 67 kuruş KDV, iki satır 134.
    expect(toplam.kdvToplam).toBe(134);
    expect(toplam.genelToplam).toBe(800);
  });

  it('boş fatura sıfırdır', () => {
    expect(faturaToplamlari([])).toEqual({ araToplam: 0, kdvToplam: 0, genelToplam: 0 });
  });
});

describe('satirOzeti', () => {
  it('satır tutarını ve elle yazılan satıştan marjı verir', () => {
    // Alış 10,00 net; satış 18,00 KDV dahil → matrah 15,00 → marj %33,33
    const o = satirOzeti(satir({ miktar: '2', satis: '18,00' }), null);
    expect(o).not.toBeNull();
    expect(o!.net).toBe(2_000);
    expect(o!.brut).toBe(2_400);
    expect(o!.marjYuzde).toBeCloseTo(33.33, 1);
  });

  it('satış boşsa marjdan hesaplanan fiyatı kullanır ve marjı geri verir', () => {
    // marjdanFiyat'ın tersi: %30 marjla üretilen fiyattan yine %30 çıkmalı.
    const o = satirOzeti(satir({ satis: '' }), 30);
    expect(o!.satisFiyati).toBeGreaterThan(0);
    expect(o!.marjYuzde).toBeCloseTo(30, 1);
  });

  it('alış satışın üstündeyse marj negatiftir (zararına satış)', () => {
    const o = satirOzeti(satir({ alis: '20,00', satis: '12,00' }), null);
    expect(o!.marjYuzde).toBeLessThan(0);
  });

  it('satış da marj da yoksa tutar verilir, marj null kalır', () => {
    const o = satirOzeti(satir({ satis: '' }), null);
    expect(o!.net).toBe(1_000);
    expect(o!.satisFiyati).toBeNull();
    expect(o!.marjYuzde).toBeNull();
  });

  it('miktar ya da alış okunamazsa null döner', () => {
    expect(satirOzeti(satir({ miktar: '0' }), null)).toBeNull();
    expect(satirOzeti(satir({ miktar: 'abc' }), null)).toBeNull();
    expect(satirOzeti(satir({ alis: '' }), null)).toBeNull();
  });

  it('geçersiz KDV oranı null döner', () => {
    expect(satirOzeti(satir({ kdv: '120' }), null)).toBeNull();
  });
});

describe('faturadaki satır tutarı (kuruş farkı)', () => {
  it('KDV dahil faturada genel toplam faturadaki satıra kuruşu kuruşuna eşittir', () => {
    // 6 × 55,45 (KDV dahil, %1) = 332,70. Birim KDV hariçe çevrilip yuvarlanınca 332,69 çıkıyordu.
    const { net, kdv } = faturaSatiriAyir(33270, 1, true);
    const birimHaric = Math.round(5545 / 1.01);
    const t = kalemTutari({ miktar: 6000, birim_fiyat: birimHaric, kdv_orani: 1, satir_net: net, satir_kdv: kdv });
    expect(t.brut).toBe(33270);
    // Eski hesap (satır tutarı verilmeden) bir kuruş sapıyordu.
    expect(kalemTutari({ miktar: 6000, birim_fiyat: birimHaric, kdv_orani: 1 }).brut).not.toBe(33270);
  });

  it('%10 KDV dahil, 332,70 → 332,70 (eskiden 332,71)', () => {
    const { net, kdv } = faturaSatiriAyir(33270, 10, true);
    const t = kalemTutari({ miktar: 6000, birim_fiyat: Math.round(5545 / 1.1), kdv_orani: 10, satir_net: net, satir_kdv: kdv });
    expect(t.brut).toBe(33270);
  });

  it('KDV hariç faturada yazılan satır tutarı esas alınır (1000 / 3)', () => {
    const t = kalemTutari({ miktar: 3000, birim_fiyat: 33333, kdv_orani: 20, satir_net: 100000 });
    expect(t.net).toBe(100000);
  });

  it('birim fiyatla açıklanamayan satır tutarı yok sayılır', () => {
    const t = kalemTutari({ miktar: 6000, birim_fiyat: 5545, kdv_orani: 20, satir_net: 50000 });
    expect(t.net).toBe(33270);
  });

  it('satirOzeti de satır tutarını kullanır', () => {
    const { net, kdv } = faturaSatiriAyir(33270, 1, true);
    const o = satirOzeti(satir({ miktar: '6', alis: '54,90', kdv: '1', satir_net: net, satir_kdv: kdv }), null);
    expect(o?.brut).toBe(33270);
  });
});
