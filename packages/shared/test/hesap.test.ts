import { describe, expect, it } from 'vitest';
import {
  adet,
  baskinOdemeTipi,
  beklenenNakit,
  cariBakiyeTopla,
  kampanyaFiyatiBul,
  karHesapla,
  kasaFarki,
  limitAsimi,
  lwwKazanan,
  marjHesapla,
  marjdanFiyat,
  miktarOlustur,
  odemeDogrula,
  satirHesapla,
  sepetHesapla,
  stokTopla,
  yaslandir,
  type KampanyaTanimi,
  type SatirGirdi,
} from '@market/shared';

describe('satirHesapla', () => {
  it('adet × birim fiyat ile brütü bulur', () => {
    const s = satirHesapla({ miktar: adet(3), birimFiyat: 1250, kdvOrani: 20 });
    expect(s.brut).toBe(3750);
    expect(s.satirToplam).toBe(3750);
    expect(s.matrah + s.kdvTutar).toBe(s.satirToplam);
  });

  it('kg/lt ürünlerde ondalık miktarı doğru çarpar', () => {
    // 1,250 kg × 48,90 ₺ = 61,125 ₺ → 61,13 ₺
    const s = satirHesapla({ miktar: miktarOlustur(1.25), birimFiyat: 4890, kdvOrani: 1 });
    expect(s.brut).toBe(6113);
  });

  it('yüzde iskontoyu uygular', () => {
    const s = satirHesapla({ miktar: adet(1), birimFiyat: 10000, kdvOrani: 20, iskontoYuzde: 10 });
    expect(s.iskonto).toBe(1000);
    expect(s.satirToplam).toBe(9000);
    expect(s.matrah + s.kdvTutar).toBe(9000);
  });

  it('iskonto satırı negatife düşüremez', () => {
    const s = satirHesapla({ miktar: adet(1), birimFiyat: 1000, kdvOrani: 20, iskontoTutar: 5000 });
    expect(s.iskonto).toBe(1000);
    expect(s.satirToplam).toBe(0);
  });

  it('negatif iskonto (zam) kabul etmez', () => {
    const s = satirHesapla({ miktar: adet(1), birimFiyat: 1000, kdvOrani: 20, iskontoTutar: -500 });
    expect(s.iskonto).toBe(0);
    expect(s.satirToplam).toBe(1000);
  });
});

describe('sepetHesapla — KDV dağılımı toplamı === genel toplam (§21.2)', () => {
  const sepet: SatirGirdi[] = [
    { miktar: adet(2), birimFiyat: 1799, kdvOrani: 20 },
    { miktar: miktarOlustur(0.735), birimFiyat: 8990, kdvOrani: 1 },
    { miktar: adet(1), birimFiyat: 4525, kdvOrani: 10, iskontoYuzde: 5 },
    { miktar: adet(3), birimFiyat: 333, kdvOrani: 20 },
  ];

  it('değişmezi korur', () => {
    const h = sepetHesapla(sepet);
    const matrahToplam = h.kdvDagilimi.reduce((t, d) => t + d.matrah, 0);
    const kdvToplam = h.kdvDagilimi.reduce((t, d) => t + d.kdv, 0);
    expect(matrahToplam + kdvToplam).toBe(h.genelToplam);
    expect(kdvToplam).toBe(h.kdvToplam);
  });

  it('ara toplam − iskonto = genel toplam', () => {
    const h = sepetHesapla(sepet, { yuzde: 7 });
    expect(h.araToplam - h.iskontoToplam).toBe(h.genelToplam);
  });

  it('sepet geneli iskontoyu kuruş kaybı olmadan dağıtır', () => {
    const iskontosuz = sepetHesapla(sepet);
    const iskontolu = sepetHesapla(sepet, { tutar: 1337 });
    expect(iskontosuz.genelToplam - iskontolu.genelToplam).toBe(1337);
    const matrahToplam = iskontolu.kdvDagilimi.reduce((t, d) => t + d.matrah + d.kdv, 0);
    expect(matrahToplam).toBe(iskontolu.genelToplam);
  });

  it('sepet iskontosu genel toplamı negatife düşüremez', () => {
    const h = sepetHesapla(sepet, { tutar: 99_999_999 });
    expect(h.genelToplam).toBe(0);
    expect(h.satirlar.every((s) => s.satirToplam >= 0)).toBe(true);
  });

  it('KDV kırılımını orana göre gruplar ve sıralar', () => {
    const h = sepetHesapla(sepet);
    expect(h.kdvDagilimi.map((d) => d.oran)).toEqual([1, 10, 20]);
  });

  it('boş sepette sıfır döner', () => {
    const h = sepetHesapla([]);
    expect(h.genelToplam).toBe(0);
    expect(h.kdvDagilimi).toEqual([]);
  });

  it('rastgele sepetlerde değişmez her zaman korunur', () => {
    let tohum = 42;
    const rastgele = (max: number) => {
      tohum = (tohum * 1103515245 + 12345) % 2147483648;
      return tohum % max;
    };
    for (let deneme = 0; deneme < 300; deneme++) {
      const satirlar: SatirGirdi[] = [];
      const satirSayisi = 1 + rastgele(8);
      for (let i = 0; i < satirSayisi; i++) {
        satirlar.push({
          miktar: 1 + rastgele(9000),
          birimFiyat: 1 + rastgele(50000),
          kdvOrani: [0, 1, 10, 20][rastgele(4)] ?? 20,
          iskontoYuzde: rastgele(3) === 0 ? rastgele(30) : undefined,
        });
      }
      const h = sepetHesapla(satirlar, { tutar: rastgele(500) });
      const toplam = h.kdvDagilimi.reduce((t, d) => t + d.matrah + d.kdv, 0);
      expect(toplam).toBe(h.genelToplam);
      expect(h.araToplam - h.iskontoToplam).toBe(h.genelToplam);
    }
  });
});

describe('odemeDogrula', () => {
  it('tam nakit ödemede para üstünü hesaplar', () => {
    const s = odemeDogrula(13750, [{ tip: 'NAKIT', tutar: 13750, alinan: 20000 }]);
    expect(s.gecerli).toBe(true);
    expect(s.paraUstu).toBe(6250);
  });

  it('parçalı ödemeyi kabul eder', () => {
    const s = odemeDogrula(10000, [
      { tip: 'KART', tutar: 6000 },
      { tip: 'NAKIT', tutar: 4000, alinan: 5000 },
    ]);
    expect(s.gecerli).toBe(true);
    expect(s.paraUstu).toBe(1000);
  });

  it('eksik ödemeyi reddeder', () => {
    const s = odemeDogrula(10000, [{ tip: 'NAKIT', tutar: 9000, alinan: 9000 }]);
    expect(s.gecerli).toBe(false);
    expect(s.hata).toBe('ODEME_EKSIK');
    expect(s.kalan).toBe(1000);
  });

  it('fazla mahsubu reddeder', () => {
    const s = odemeDogrula(10000, [{ tip: 'KART', tutar: 11000 }]);
    expect(s.gecerli).toBe(false);
    expect(s.hata).toBe('ODEME_FAZLA');
  });

  it('alınan tutar mahsuptan azsa reddeder', () => {
    const s = odemeDogrula(10000, [{ tip: 'NAKIT', tutar: 10000, alinan: 5000 }]);
    expect(s.gecerli).toBe(false);
    expect(s.hata).toBe('ALINAN_YETERSIZ');
  });

  it('negatif tutarı reddeder', () => {
    expect(odemeDogrula(1000, [{ tip: 'NAKIT', tutar: -1000 }]).hata).toBe('NEGATIF_TUTAR');
  });

  it('baskın ödeme tipini bulur', () => {
    expect(baskinOdemeTipi([{ tip: 'NAKIT', tutar: 100 }])).toBe('NAKIT');
    expect(
      baskinOdemeTipi([
        { tip: 'NAKIT', tutar: 50 },
        { tip: 'KART', tutar: 50 },
      ]),
    ).toBe('PARCALI');
  });
});

describe('kampanya', () => {
  const zaman = '2026-07-31T10:00:00.000Z';
  const temel: KampanyaTanimi = {
    id: 'k1',
    tip: 'YUZDE',
    kapsam: 'URUN',
    hedefId: 'u1',
    deger: 10,
    baslangic: '2026-07-01T00:00:00.000Z',
    bitis: '2026-08-31T23:59:59.000Z',
    aktifMi: true,
  };

  it('ürün kampanyasını uygular', () => {
    const s = kampanyaFiyatiBul(10000, { urunId: 'u1', kategoriId: 'kat1' }, [temel], zaman);
    expect(s.fiyat).toBe(9000);
    expect(s.kampanyaId).toBe('k1');
  });

  it('kapsam dışı ürüne uygulamaz', () => {
    const s = kampanyaFiyatiBul(10000, { urunId: 'u2', kategoriId: 'kat1' }, [temel], zaman);
    expect(s.fiyat).toBe(10000);
    expect(s.kampanyaId).toBeNull();
  });

  it('tarih aralığı dışında uygulamaz', () => {
    const s = kampanyaFiyatiBul(10000, { urunId: 'u1', kategoriId: null }, [temel], '2026-09-05T00:00:00.000Z');
    expect(s.fiyat).toBe(10000);
  });

  it('pasif kampanyayı yok sayar', () => {
    const s = kampanyaFiyatiBul(10000, { urunId: 'u1', kategoriId: null }, [{ ...temel, aktifMi: false }], zaman);
    expect(s.fiyat).toBe(10000);
  });

  it('birden fazla kampanyada müşteri lehine en düşüğü seçer', () => {
    const kategori: KampanyaTanimi = { ...temel, id: 'k2', kapsam: 'KATEGORI', hedefId: 'kat1', tip: 'TUTAR', deger: 2500 };
    const s = kampanyaFiyatiBul(10000, { urunId: 'u1', kategoriId: 'kat1' }, [temel, kategori], zaman);
    expect(s.fiyat).toBe(7500);
    expect(s.kampanyaId).toBe('k2');
  });

  it('sabit fiyat kampanyasını uygular ve negatife düşmez', () => {
    const sabit: KampanyaTanimi = { ...temel, tip: 'SABIT_FIYAT', deger: 7999 };
    expect(kampanyaFiyatiBul(10000, { urunId: 'u1', kategoriId: null }, [sabit], zaman).fiyat).toBe(7999);
    const asiri: KampanyaTanimi = { ...temel, tip: 'TUTAR', deger: 99999 };
    expect(kampanyaFiyatiBul(10000, { urunId: 'u1', kategoriId: null }, [asiri], zaman).fiyat).toBe(0);
  });
});

describe('kâr ve marj', () => {
  it('KDV hariç brüt kârı hesaplar', () => {
    // 2 adet × 12,00 ₺ (KDV %20 dahil) → matrah 20,00 ₺; maliyet 2 × 7,00 = 14,00 ₺
    const k = karHesapla(2000, 700, adet(2));
    expect(k.maliyet).toBe(1400);
    expect(k.brutKar).toBe(600);
    expect(k.marjYuzde).toBe(30);
  });

  it('marj ve fiyat dönüşümü tutarlıdır', () => {
    const fiyat = marjdanFiyat(1000, 40, 20);
    expect(marjHesapla(1000, fiyat, 20)).toBeCloseTo(40, 1);
  });

  it('%100 marj hata verir', () => {
    expect(() => marjdanFiyat(1000, 100, 20)).toThrow();
  });
});

describe('stok ve cari değişmezleri', () => {
  it('stok hareketlerin toplamıdır', () => {
    expect(stokTopla([{ miktar: adet(10) }, { miktar: -adet(3) }, { miktar: -adet(2) }])).toBe(adet(5));
  });

  it('ondalık miktarlarda birikimli hata oluşmaz', () => {
    const hareketler = Array.from({ length: 1000 }, () => ({ miktar: miktarOlustur(0.1) }));
    expect(stokTopla(hareketler)).toBe(miktarOlustur(100));
  });

  it('cari bakiye hareketlerin toplamıdır', () => {
    expect(cariBakiyeTopla([{ tutar: 30000 }, { tutar: -12000 }])).toBe(18000);
  });
});

describe('kredi limiti (§25 kabul kriteri)', () => {
  it('limiti 500₺ olan 450₺ borçlu müşteriye 100₺ veresiye limit aşımıdır', () => {
    const s = limitAsimi(45000, 10000, 50000);
    expect(s.asiyor).toBe(true);
    expect(s.yeniBakiye).toBe(55000);
    expect(s.asimTutari).toBe(5000);
  });

  it('limit 0 ise sınırsızdır', () => {
    expect(limitAsimi(100000, 50000, 0).asiyor).toBe(false);
  });

  it('limit içindeyse aşım yoktur', () => {
    expect(limitAsimi(10000, 10000, 50000).asiyor).toBe(false);
  });
});

describe('kasa (§25 gün sonu kabul kriteri)', () => {
  it('1.000₺ nakit satış + 200₺ tahsilat − 50₺ gider, açılış 100₺ → beklenen 1.250₺', () => {
    const beklenen = beklenenNakit(10000, [{ tutar: 100000 }, { tutar: 20000 }, { tutar: -5000 }]);
    expect(beklenen).toBe(125000);
    expect(kasaFarki(125000, beklenen)).toBe(0);
  });

  it('sayım eksikse kasa farkı negatiftir', () => {
    expect(kasaFarki(124000, 125000)).toBe(-1000);
  });
});

describe('yaşlandırma', () => {
  it('borçları vade dilimlerine ayırır', () => {
    const d = yaslandir([
      { tutar: 10000, gun: 5 },
      { tutar: 20000, gun: 45 },
      { tutar: 30000, gun: 75 },
      { tutar: 40000, gun: 200 },
    ]);
    expect(d.map((x) => x.tutar)).toEqual([10000, 20000, 30000, 40000]);
  });
});

describe('LWW çakışma çözümü (§7.4)', () => {
  it('yeni updated_at kazanır', () => {
    const a = { updated_at: '2026-07-31T10:00:00.000Z', cihaz_id: 'kasa-01' };
    const b = { updated_at: '2026-07-31T11:00:00.000Z', cihaz_id: 'panel' };
    expect(lwwKazanan(a, b).kazanan).toBe(b);
    expect(lwwKazanan(b, a).kazanan).toBe(b);
  });

  it('eşit zamanda deterministik ve simetriktir', () => {
    const a = { updated_at: '2026-07-31T10:00:00.000Z', cihaz_id: 'kasa-01' };
    const b = { updated_at: '2026-07-31T10:00:00.000Z', cihaz_id: 'kasa-02' };
    expect(lwwKazanan(a, b).kazanan.cihaz_id).toBe('kasa-02');
    expect(lwwKazanan(b, a).kazanan.cihaz_id).toBe('kasa-02');
  });

  it('tamamen aynı kayıtta çakışma bildirmez', () => {
    const a = { updated_at: '2026-07-31T10:00:00.000Z', cihaz_id: 'kasa-01' };
    expect(lwwKazanan(a, { ...a }).cakisma).toBe(false);
  });
});
