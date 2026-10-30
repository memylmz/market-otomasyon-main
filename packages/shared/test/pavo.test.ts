import { describe, expect, it } from 'vitest';
import {
  PAVO_ARACI,
  pavoBirimKodu,
  pavoDurumEtiketi,
  pavoFaturaNo,
  pavoHataMetni,
  pavoIptalMi,
  pavoKalanTutar,
  pavoKalemi,
  pavoKapandiMi,
  pavoKurus,
  pavoOdemeSirasi,
  pavoOdemesi,
  pavoParaUstu,
  pavoSatisIstegi,
  pavoSatisiCoz,
  pavoTahsilEdilenler,
  pavoTerkMi,
  pavoTl,
  pavoVergiKodu,
  pavoYanitiCoz,
  type PavoKalemGirdisi,
} from '@market/shared';

const kalem = (alanlar: Partial<PavoKalemGirdisi> = {}): PavoKalemGirdisi => ({
  ad: 'Süt 1 L',
  miktar: 2000,
  birimTipi: 'ADET',
  birimFiyat: 3250,
  brut: 6500,
  iskonto: 0,
  kdvOrani: 1,
  urunId: 'u1',
  ...alanlar,
});

describe('çeviriler', () => {
  it('kuruş ↔ TL', () => {
    expect(pavoTl(12345)).toBe(123.45);
    expect(pavoKurus(123.45)).toBe(12345);
    expect(pavoKurus(0.1 + 0.2)).toBe(30);
    expect(pavoKurus('12')).toBe(0);
    expect(pavoKurus(Number.NaN)).toBe(0);
  });

  it('vergi grubu: güncel kodlar; tabloda olmayan oran satışı durdurur', () => {
    expect([0, 1, 10, 20].map(pavoVergiKodu)).toEqual(['KDV0', 'KDV1', 'KDV10', 'KDV20']);
    expect(() => pavoVergiKodu(18)).toThrow(/Pavo vergi gruplarında yok/);
    expect(() => pavoVergiKodu(8)).toThrow();
  });

  it('GİB birim kodları', () => {
    expect(pavoBirimKodu('ADET')).toBe('C62');
    expect(pavoBirimKodu('KG')).toBe('KGM');
    expect(pavoBirimKodu('LT')).toBe('LTR');
  });
});

describe('kalem', () => {
  it('adet ürün: miktar × birim = brüt', () => {
    expect(pavoKalemi(kalem())).toEqual({
      Name: 'Süt 1 L',
      IsGeneric: false,
      UnitCode: 'C62',
      TaxGroupCode: 'KDV1',
      ItemQuantity: 2,
      UnitPriceAmount: 32.5,
      GrossPriceAmount: 65,
      TotalPriceAmount: 65,
      ReservedText: 'u1',
    });
  });

  it('kampanya iskontosu satır indirimi olarak gider; toplam brütten düşer', () => {
    const k = pavoKalemi(kalem({ miktar: 3000, birimFiyat: 1000, brut: 3000, iskonto: 1000, barkod: '869' }));
    expect(k).toMatchObject({ ItemQuantity: 3, GrossPriceAmount: 30, TotalPriceAmount: 20, Barcode: '869' });
    expect(k.PriceEffect).toEqual({ Type: 1, Amount: 10 });
  });

  it('kilo ürün: cihazın çarpımıyla tutan brüt aynen gider', () => {
    // 2,35 kg × 19,90 = 46,765 → 46,77 (cihaz da aynı sonucu bulur)
    const k = pavoKalemi(kalem({ ad: 'Domates', miktar: 2350, birimTipi: 'KG', birimFiyat: 1990, brut: 4677, kdvOrani: 1 }));
    expect(k).toMatchObject({
      Name: 'Domates',
      UnitCode: 'KGM',
      ItemQuantity: 2.35,
      UnitPriceAmount: 19.9,
      GrossPriceAmount: 46.77,
    });
  });

  it('cihazın çarpımı bizimkinden bir kuruş ayrışırsa kalem tek adet olarak gider, satış reddedilmez', () => {
    // 1,005 kg × 10,00: tam sayıyla 1005 kuruş; bizim kaydımız 1006 diyorsa ayrışır.
    const k = pavoKalemi(kalem({ ad: 'Peynir', miktar: 1005, birimTipi: 'KG', birimFiyat: 1000, brut: 1006 }));
    expect(k).toMatchObject({
      Name: 'Peynir 1,005 kg',
      UnitCode: 'C62',
      ItemQuantity: 1,
      UnitPriceAmount: 10.06,
      GrossPriceAmount: 10.06,
    });
  });

  it("0,01'in altındaki miktar da tek adet olarak gider", () => {
    expect(pavoKalemi(kalem({ miktar: 5, birimTipi: 'KG', birimFiyat: 100000, brut: 500 }))).toMatchObject({ ItemQuantity: 1 });
  });

  it('sıfır tutarlı ve tamamen indirimli kalem reddedilir', () => {
    expect(() => pavoKalemi(kalem({ brut: 0 }))).toThrow(/sıfır/);
    expect(() => pavoKalemi(kalem({ iskonto: 6500 }))).toThrow(/tamamen indirimli/);
  });

  it('ürün kimliği ve barkod yoksa alan hiç gönderilmez', () => {
    const k = pavoKalemi(kalem({ urunId: null, barkod: null }));
    expect(k).not.toHaveProperty('ReservedText');
    expect(k).not.toHaveProperty('Barcode');
  });
});

describe('satış isteği', () => {
  it('brüt ve toplam satırların toplamı; ödeme gönderilmez', () => {
    const { govde, brut, toplam } = pavoSatisIstegi({
      uygulamaAdi: 'Market Otomasyon',
      uygulamaSurumu: '2.1.0',
      siparisNo: 'S-1',
      kartOkumaSn: 60,
      kalemler: [kalem(), kalem({ ad: 'Ayran', miktar: 3000, birimFiyat: 1000, brut: 3000, iskonto: 1000, kdvOrani: 10 })],
    });
    expect(brut).toBe(9500);
    expect(toplam).toBe(8500);
    expect(govde).toMatchObject({
      RefererApp: 'Market Otomasyon',
      OrderNo: 'S-1',
      GrossPrice: 95,
      TotalPrice: 85,
      CurrencyCode: 'TRY',
      CardReadTimeout: 60,
      ShowCreditCardMenu: false,
      SkipAmountCash: true,
      SendResponseBeforePrint: true,
    });
    expect(govde).not.toHaveProperty('PaymentInformations');
    expect(govde).not.toHaveProperty('CustomerParty');
    expect((govde.AddedSaleItems as unknown[]).length).toBe(2);
  });

  it('faturalı satışta alıcı gider; boş sepet reddedilir', () => {
    const { govde } = pavoSatisIstegi({
      uygulamaAdi: 'M',
      uygulamaSurumu: '1',
      siparisNo: 'S-2',
      kartOkumaSn: 60,
      kalemler: [kalem()],
      musteri: { Vkn: '1234567890' },
    });
    expect(govde.CustomerParty).toEqual({ Vkn: '1234567890' });
    expect(() =>
      pavoSatisIstegi({ uygulamaAdi: 'M', uygulamaSurumu: '1', siparisNo: 'x', kartOkumaSn: 1, kalemler: [] }),
    ).toThrow(/boş/);
  });
});

describe('ödeme', () => {
  it('nakitte verilen para gider (para üstünü cihaz hesaplar); verilen tutardan az olamaz', () => {
    expect(pavoOdemesi({ tip: 'NAKIT', tutar: 8500, alinan: 10000 })).toEqual({ Mediator: 1, Amount: 85, GivenAmount: 100 });
    expect(pavoOdemesi({ tip: 'NAKIT', tutar: 8500 })).toEqual({ Mediator: 1, Amount: 85, GivenAmount: 85 });
    expect(pavoOdemesi({ tip: 'NAKIT', tutar: 8500, alinan: 5000 })).toMatchObject({ GivenAmount: 85 });
  });

  it('kart ve veresiye (Açık Hesap)', () => {
    expect(pavoOdemesi({ tip: 'KART', tutar: 100 })).toEqual({ Mediator: PAVO_ARACI.KART, Amount: 1 });
    expect(pavoOdemesi({ tip: 'VERESIYE', tutar: 100 })).toEqual({ Mediator: PAVO_ARACI.ACIK_HESAP, Amount: 1 });
    expect(() => pavoOdemesi({ tip: 'KART', tutar: 0 })).toThrow();
  });

  it('kart önce gider — reddedilirse henüz hiçbir şey tahsil edilmemiş olur', () => {
    const sira = pavoOdemeSirasi([{ tip: 'VERESIYE' as const }, { tip: 'NAKIT' as const }, { tip: 'KART' as const }]);
    expect(sira.map((o) => o.tip)).toEqual(['KART', 'NAKIT', 'VERESIYE']);
  });
});

describe('cevap zarfı', () => {
  it('sayısal, sayısal metin ve düz metin hata kodları', () => {
    expect(pavoYanitiCoz({ HasError: true, ErrorCode: 30, Message: 'x' })).toMatchObject({
      hata: true,
      kod: 30,
      kodMetni: null,
      mesaj: 'x',
    });
    expect(pavoYanitiCoz({ HasError: true, ErrorCode: '73', ErrorMessage: 'sıra' })).toMatchObject({ kod: 73, mesaj: 'sıra' });
    expect(pavoYanitiCoz({ HasError: true, ErrorCode: 'NoPendingSales' })).toMatchObject({
      kod: null,
      kodMetni: 'NoPendingSales',
    });
    expect(pavoYanitiCoz({ HasError: false, ErrorCode: '' })).toMatchObject({
      hata: false,
      kod: null,
      kodMetni: null,
      mesaj: '',
    });
  });

  it('veri ve seri numarası; bozuk cevap çökmez', () => {
    const y = pavoYanitiCoz({ HasError: false, Data: { Id: 5 }, TransactionHandle: { SerialNumber: 'PAV1' } });
    expect(y.veri).toEqual({ Id: 5 });
    expect(y.seriNo).toBe('PAV1');
    expect(pavoYanitiCoz('bozuk')).toMatchObject({ hata: false, veri: null, seriNo: null });
    expect(pavoYanitiCoz({ Data: [1, 2] }).veri).toBeNull();
  });
});

describe('satış sonucu', () => {
  const satis = (alanlar: Record<string, unknown> = {}) =>
    pavoSatisiCoz({
      Id: 1001,
      SaleNumber: 'SN1',
      OrderNo: 'S-1',
      StatusId: 6,
      RemainingPaymentAmount: 0,
      GrossPrice: 95,
      TotalPrice: 85,
      FinancialDocuments: [{ InvoiceNo: 'GIB2026000000101', DocumentNo: 'ettn-1' }],
      AddedPayments: [
        { PaymentMediatorId: 1, PaymentTypeId: 1, StatusId: 2, PaymentAmount: 85, CashPayment: { ChangeAmount: 15 } },
      ],
      AddedSaleItems: [
        { Id: 10010, Name: 'Süt', ItemQuantity: 2, UnitPriceAmount: 32.5, TotalPriceAmount: 65, VATRate: 1, ReservedText: 'u1' },
      ],
      'SaleInquieryLink ': 'https://sorgu',
      ...alanlar,
    });

  it('alanları çözer (boşluklu link anahtarı dahil)', () => {
    const s = satis();
    expect(s).toMatchObject({
      id: 1001,
      satisNo: 'SN1',
      siparisNo: 'S-1',
      durum: 6,
      brut: 9500,
      toplam: 8500,
      sorguLinki: 'https://sorgu',
    });
    expect(s.kalemler).toEqual([{ id: 10010, ad: 'Süt', miktar: 2, birimFiyat: 3250, toplam: 6500, kdvOrani: 1, rezerv: 'u1' }]);
    expect(pavoFaturaNo(s)).toBe('GIB2026000000101');
    expect(pavoParaUstu(s)).toBe(1500);
    expect(pavoKapandiMi(s)).toBe(true);
    expect(pavoDurumEtiketi(s.durum)).toBe('Tamamlandı');
  });

  it('kalem listesi SaleItems, ödemeler Payments anahtarıyla da gelebilir; eksik alanlar sıfır', () => {
    const s = pavoSatisiCoz({ SaleItems: [{ Name: 'X' }], Payments: [{ StatusId: 2, PaymentAmount: 1 }] });
    expect(s.kalemler[0]).toMatchObject({ ad: 'X', miktar: 1, id: 0 });
    expect(s.odemeler[0]).toMatchObject({ tutar: 100, paraUstu: 0 });
    expect(pavoSatisiCoz(null)).toMatchObject({ id: 0, satisNo: '', belgeler: [], sorguLinki: '' });
  });

  it('reddedilen kart denemesi tahsilat sayılmaz', () => {
    const s = satis({
      FinancialDocuments: [],
      AddedPayments: [{ PaymentTypeId: 2, StatusId: 3, PaymentAmount: 85 }],
    });
    expect(pavoTahsilEdilenler(s)).toEqual([]);
    expect(pavoKalanTutar(s)).toBe(8500);
    expect(pavoKapandiMi(s)).toBe(false);
  });

  it('cihaz yarım satışta kalanı 0 dese de toplamdan tahsil edilen düşülür', () => {
    const s = satis({ StatusId: 23, FinancialDocuments: [], AddedPayments: [{ StatusId: 2, PaymentAmount: 30 }] });
    expect(pavoKalanTutar(s)).toBe(5500);
    expect(pavoKapandiMi(s)).toBe(false);
  });

  it('belge henüz gelmese de başarılı ödeme varsa kapanmıştır; bedelsiz satış ödemesiz kapanır', () => {
    expect(pavoKapandiMi(satis({ FinancialDocuments: [] }))).toBe(true);
    expect(pavoKapandiMi(satis({ TotalPrice: 0, FinancialDocuments: [], AddedPayments: [] }))).toBe(true);
    expect(pavoKapandiMi(satis({ FinancialDocuments: [], AddedPayments: [] }))).toBe(false);
  });

  it('iptal ve terk edilmiş satış kapanmış sayılmaz', () => {
    expect(pavoIptalMi(satis({ StatusId: 11 }))).toBe(true);
    expect(pavoIptalMi(satis({ StatusId: 13 }))).toBe(true);
    expect(pavoTerkMi(satis({ StatusId: 7 }))).toBe(true);
    expect(pavoKapandiMi(satis({ StatusId: 11 }))).toBe(false);
    expect(pavoKapandiMi(satis({ StatusId: 7 }))).toBe(false);
  });

  it('kalan alanı doluysa o kullanılır', () => {
    expect(pavoKalanTutar(satis({ RemainingPaymentAmount: 12.5 }))).toBe(1250);
  });

  it('durum etiketleri', () => {
    expect(pavoDurumEtiketi(1)).toBe('Askıda');
    expect(pavoDurumEtiketi(0)).toBe('');
    expect(pavoDurumEtiketi(99)).toBe('Durum 99');
  });
});

describe('hata metni', () => {
  it('bilinen kod, bilinen metin kodu, bilinmeyen kod, kodsuz', () => {
    expect(pavoHataMetni({ kod: 30, kodMetni: null, mesaj: '' })).toMatch(/yarım kalmış/);
    expect(pavoHataMetni({ kod: null, kodMetni: 'NoPendingSales', mesaj: '' })).toBe('Askıda satış yok.');
    expect(pavoHataMetni({ kod: 999, kodMetni: null, mesaj: 'garip' })).toBe('Pavo hatası (999): garip');
    expect(pavoHataMetni({ kod: null, kodMetni: 'Bilinmeyen', mesaj: 'ham mesaj' })).toBe('ham mesaj');
    expect(pavoHataMetni({ kod: null, kodMetni: null, mesaj: '' })).toMatch(/bilinmeyen/);
  });
});
