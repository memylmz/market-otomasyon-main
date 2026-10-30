/**
 * Testler için bellek içi sahte Pavo N86.
 *
 * `tools/pavo-mock` (Dart) gerçek protokolü HTTP üzerinden konuşur ama CI'da
 * Dart yok; bu sınıf aynı kuralları `PavoTasiyici` düzeyinde uygular:
 * StartSaleWithItems satışı ASKIYA alır, her ödeme ayrı AddPaymentAndFinalize,
 * askıdaki satış GetSaleResult ile bulunmaz (hata 1), kuruş eşitlikleri katı.
 */

import type { PavoYaniti } from '@market/shared';
import { PavoTasimaHatasi, type PavoGonderimi, type PavoTasiyici } from '../src/main/donanim/pavo-istemci.js';

type Kayit = Record<string, unknown> & {
  Id: number;
  SaleNumber: string;
  OrderNo: string;
  StatusId: number;
  IsSuspendedSale: boolean;
  TotalPrice: number;
  GrossPrice: number;
  RemainingPaymentAmount: number;
  AddedSaleItems: Record<string, unknown>[];
  AddedPayments: Record<string, unknown>[];
  FinancialDocuments: Record<string, unknown>[];
};

const k = (tl: unknown) => Math.round(Number(tl) * 100);

/** Özet şeması (GetReportSummaries / CreateReportWithSummaries): kırılım var, Z no yok. */
const SAHTE_OZET = {
  BatchId: 12001,
  BatchType: 'T',
  DifferenceIndicator: 'N',
  TotalPaymentCount: 3,
  TotalPaymentAmount: 123.45,
  TotalCancelledCount: '1',
  TotalCancelledAmount: -10,
  MinumumPaymentDate: '2026-10-29T08:30:00.000',
  MaximumPaymentDate: '2026-10-29T19:15:00.000',
  PaymentSummary: [
    { PaymentType: 'Nakit (TL)', PaymentCount: 2, PaymentSum: 83.45, CancelCount: 1, CancelSum: 10, PaymentTotal: 73.45 },
    { PaymentType: 'Kredi Kartı', PaymentCount: 1, PaymentSum: '40.00', CancelCount: 0, CancelSum: 0, PaymentTotal: 40 },
  ],
  VATSummary: [{ VATType: '%1', BaseAmount: 100, TaxAmount: 1 }],
  DocumentSummary: [{ DocumentType: 'Satış', DocumentCount: 3, DocumentAmount: 123.45 }],
  ProductSummary: [{ ProductName: 'Süt', Quantity: '2,5', TotalAmount: 60 }],
};
/** Arşiv satırı (ListReports): Z no ve tarih var, kırılım yok. */
const SAHTE_Z_SATIRI = {
  BatchId: 12001,
  BatchType: 'T',
  DifferenceIndicator: 'N',
  ZReportNo: '7',
  CreateDate: '2026-10-29T23:01:00',
  TotalPaymentAmount: 123.45,
};
const SAHTE_X_SATIRI = {
  BatchId: 11990,
  BatchType: 'X',
  DifferenceIndicator: 'Y',
  CreateDate: '2026-10-29T12:00:00',
  TotalPaymentAmount: 50,
};
/** Sorgu şeması (QueryReport): Türkçe biçimli metinler. */
const SAHTE_SORGU = {
  reportType: 'Kullanıcı Satış Raporu',
  batchId: '12002',
  dateTime: '29.10.2026 13:03',
  extras: [{ firstOperationDate: '29.10.2026 08:30', lastOperationDate: '29.10.2026 13:00', isDifferenceX: 'false' }],
  totals: [
    {
      cashTotal: '+1.234,50 TL',
      creditTotal: '+0,00 TL',
      isVisibleCashField: 'true',
      isVisibleCreditField: 'false',
      totalAmount: '+1.234,50 TL',
      vatsBaseTotal: '+1.222,28 TL',
      vatTaxAmountTotal: '+12,22 TL',
      paymentCountTotal: '4',
      paymentCancelledCountTotal: '0',
    },
  ],
  paymentTypes: [
    {
      paymentType: 'Nakit (TL)',
      paymentCount: '4',
      paymentSum: '1.234,50 TL',
      cancelCount: '0',
      cancelSum: '-0.0 TL',
      paymentTotal: '1.234,50',
    },
  ],
  vats: [{ vatType: '%1', vatPaymentSum: '12,22 ', paymentTotal: '1.222,28 ' }],
};
const tl = (kurus: number) => kurus / 100;

export class SahteCihaz implements PavoTasiyici {
  satislar: Kayit[] = [];
  istekler: { yol: string; g: PavoGonderimi }[] = [];
  /** Sıradaki kart ödemesi reddedilsin. */
  kartReddet = false;
  /** Sıradaki bu yoldaki istek İŞLENSİN ama cevap kaybolsun. */
  cevapKaybet: string | null = null;
  /** Cihaz kapalı: her istek bağlantı hatası. */
  kapali = false;
  /** Kart adımı bu kadar sürer (vazgeç denemesi için). */
  kartBeklemeMs = 0;
  /** Gün sonu isteği üst alanlarla gelirse 175 + "input key" ipucu döner. */
  raporAnahtariIste = false;
  /** Banka gün sonu başarısız olsun. */
  bankaBasarisiz = false;
  /** Rapor arşivi (ListReports) yerine dönecek satırlar; null → varsayılan sahte arşiv. */
  arsivRaporlari: Record<string, unknown>[] | null = null;
  private vazgec = false;
  private id = 1000;

  private tamam(veri?: unknown): PavoYaniti {
    return {
      hata: false,
      kod: null,
      kodMetni: null,
      mesaj: '',
      veri: (veri as Record<string, unknown>) ?? null,
      seriNo: 'PAVSAHTE01',
    };
  }

  private hata(kod: number | null, mesaj: string, kodMetni: string | null = null): PavoYaniti {
    return { hata: true, kod, kodMetni, mesaj, veri: null, seriNo: null };
  }

  private bul(q: Record<string, unknown>): Kayit | undefined {
    return [...this.satislar]
      .reverse()
      .find(
        (s) =>
          (q.SaleNumber && s.SaleNumber === q.SaleNumber) || (q.OrderNo && s.OrderNo === q.OrderNo) || (q.Id && s.Id === q.Id),
      );
  }

  async gonder(yol: string, g: PavoGonderimi): Promise<PavoYaniti> {
    this.istekler.push({ yol, g });
    if (this.kapali) throw new PavoTasimaHatasi("Pavo'ya ulaşılamadı (sahte).", false);
    if (this.raporAnahtariIste && yol === '/CreateReportWithSummaries' && !g.input) {
      return this.hata(175, 'Gönderilen input boş veya key hatalı. Bu servis için input key: Report');
    }
    const yanit = await this.isle(yol, (g.input ?? g.ust ?? {}) as Record<string, unknown>);
    if (this.cevapKaybet === yol) {
      this.cevapKaybet = null;
      throw new PavoTasimaHatasi('Cevap alınamadı (sahte) — işlem yapılmış olabilir.', true);
    }
    return yanit;
  }

  private async isle(yol: string, s: Record<string, unknown>): Promise<PavoYaniti> {
    switch (yol) {
      case '/Pairing':
      case '/Ping':
        return this.tamam();
      case '/PaymentMediators':
        return this.tamam({ PaymentMediators: [{ Id: 1 }, { Id: 2 }, { Id: 29 }] });
      case '/AbortCurrentPayment':
        this.vazgec = true;
        return this.tamam({ Response: 'İşlem iptal edildi.' });
      case '/StartSaleWithItems':
        return this.baslat(s);
      case '/QueryCustomerInfo':
        // GİB mükellef sorgusu: tek örnek şirket kaydı, gerisi "bulunamadı".
        if (s.Vkn === '1234567890') {
          return this.tamam({
            CustomerInfo: {
              CustomerType: 2,
              CompanyName: 'ÖRNEK GIDA A.Ş.',
              TaxNumber: '1234567890',
              TaxOfficeName: 'KADIKÖY',
              TaxOfficeCode: '034255',
              City: 'İSTANBUL',
              District: 'KADIKÖY',
              Address: 'Örnek Mah. No:1',
              EMail: '',
            },
          });
        }
        return this.hata(181, 'GİB sisteminde mükellef bulunamadı.');
      case '/AddPaymentAndFinalizeSale':
        return this.ode(s);
      case '/GetSaleResult': {
        const x = this.bul(s);
        if (!x || x.IsSuspendedSale) return this.hata(1, 'Satış bulunmamaktadır');
        return this.tamam(x);
      }
      case '/CheckPendingSale': {
        const x = this.bul(s);
        if (!x || !x.IsSuspendedSale) return this.hata(1, 'Askıda satış yok');
        return this.tamam(x);
      }
      case '/AbandonSuspendedSale': {
        const x = this.bul(s);
        if (!x || !x.IsSuspendedSale) return this.hata(1, 'Askıda satış bulunamadı');
        x.IsSuspendedSale = false;
        x.StatusId = 7;
        return this.tamam(x);
      }
      case '/ListPendingSaleWithDetail': {
        const askida = this.satislar.filter((x) => x.IsSuspendedSale);
        return askida.length ? this.tamam({ Sales: askida }) : this.hata(null, 'Askıda satış yok', 'NoPendingSales');
      }
      case '/CancelSale': {
        const x = this.bul(s);
        if (!x) return this.hata(1, 'Satış bulunmamaktadır');
        if (x.IsSuspendedSale) return this.hata(6, 'Satış statüsü tamamlanmış değil');
        if (x.StatusId === 13) return this.hata(3, 'Satış iptal edilebilir değil');
        x.StatusId = 13;
        return this.tamam(x);
      }
      case '/PartialReturn':
        return this.iade(s);
      case '/PerformBatchEod':
        return this.tamam({
          EodResult: [
            {
              MediatorId: 2,
              IsSucceeded: !this.bankaBasarisiz,
              ErrorMessage: this.bankaBasarisiz ? 'Banka cevap vermedi' : null,
            },
          ],
        });
      // Gerçek cihaz gibi: özet Z numarasını TAŞIMAZ, arşiv satırı taşır.
      case '/CreateReportWithSummaries':
        if (s.ReportType !== 'T') return this.hata(null, 'Geçersiz rapor tipi', 'InvalidReportType');
        return this.tamam({ Batches: [SAHTE_OZET] });
      case '/ListReports':
        // Aynı satırın iki kez gelmesi de sınanır.
        return this.tamam({ Reports: this.arsivRaporlari ?? [SAHTE_X_SATIRI, SAHTE_Z_SATIRI, SAHTE_Z_SATIRI] });
      case '/GetReportSummaries':
        return s.ReportId === 12001
          ? this.tamam({ Batches: [SAHTE_OZET] })
          : this.hata(null, 'Rapor bulunamadı', 'ReportNotFound');
      case '/PrintReport':
        return this.tamam();
      case '/QueryReport': {
        const d = s.ReportData as Record<string, unknown> | undefined;
        if (!d) return this.hata(175, 'Bu servis için input key: ReportData');
        if (d.ReportType === 'ZReportWithDateTime' && d.ReportDate === '2026-01-01') {
          return this.hata(null, 'O tarihte Z raporu yok.', 'ReportNotFound');
        }
        if (!['XReport', 'XDiffReport', 'ZReportWithDateTime', 'TeminalDateRangeSaleReport'].includes(String(d.ReportType))) {
          return this.hata(null, 'Geçersiz rapor tipi', 'InvalidReportType');
        }
        return this.tamam({ reportResult: 'Rapor başarılı', images: [], datas: [SAHTE_SORGU] });
      }
      default:
        return this.hata(404, `Bilinmeyen servis ${yol}`);
    }
  }

  private baslat(s: Record<string, unknown>): PavoYaniti {
    if (this.satislar.some((x) => x.IsSuspendedSale)) return this.hata(30, 'Askıda satış var');
    if (this.satislar.some((x) => x.OrderNo === s.OrderNo)) return this.hata(129, 'Mükerrer sipariş');
    const kalemler = (s.AddedSaleItems as Record<string, unknown>[]) ?? [];
    let brut = 0;
    let toplam = 0;
    for (const [i, kalem] of kalemler.entries()) {
      const hesap = Math.round(Number(kalem.ItemQuantity) * k(kalem.UnitPriceAmount));
      if (hesap !== k(kalem.GrossPriceAmount)) return this.hata(42, `Kalem ${i + 1}: miktar × birim ≠ brüt`);
      const pe = kalem.PriceEffect as { Type: number; Amount: number } | undefined;
      const beklenen = k(kalem.GrossPriceAmount) - (pe ? k(pe.Amount) : 0);
      if (beklenen !== k(kalem.TotalPriceAmount)) return this.hata(44, `Kalem ${i + 1}: toplam tutmuyor`);
      if (!['KDV0', 'KDV1', 'KDV10', 'KDV20'].includes(String(kalem.TaxGroupCode))) return this.hata(31, 'Vergi grubu');
      brut += k(kalem.GrossPriceAmount);
      toplam += k(kalem.TotalPriceAmount);
    }
    if (brut !== k(s.GrossPrice)) return this.hata(45, 'Brüt toplam tutmuyor');
    if (toplam !== k(s.TotalPrice)) return this.hata(44, 'Toplam tutmuyor');
    const id = ++this.id;
    const kayit: Kayit = {
      Id: id,
      SaleNumber: `SN${id}`,
      OrderNo: String(s.OrderNo),
      StatusId: 1,
      IsSuspendedSale: true,
      GrossPrice: tl(brut),
      TotalPrice: tl(toplam),
      RemainingPaymentAmount: tl(toplam),
      AddedSaleItems: kalemler.map((x, i) => ({ ...x, Id: id * 10 + i, VATRate: Number(String(x.TaxGroupCode).slice(3)) })),
      AddedPayments: [],
      FinancialDocuments: [],
      CustomerParty: s.CustomerParty,
    };
    this.satislar.push(kayit);
    return this.tamam(kayit);
  }

  private async ode(s: Record<string, unknown>): Promise<PavoYaniti> {
    const x = this.bul(s);
    if (!x) return this.hata(1, 'Satış bulunmamaktadır');
    if (!x.IsSuspendedSale) return this.hata(185, 'Geçersiz askıda satış');
    const odeme = (s.PaymentInformations as Record<string, unknown>[])[0]!;
    const araci = Number(odeme.Mediator);
    if (![1, 2, 29].includes(araci)) return this.hata(18, 'Ödeme aracısı bulunamadı');
    const tutar = k(odeme.Amount);
    if (tutar <= 0 || tutar > k(x.RemainingPaymentAmount)) return this.hata(66, 'Ödeme kalandan fazla');
    if (araci === 2) {
      this.vazgec = false;
      const bitis = Date.now() + this.kartBeklemeMs;
      while (Date.now() < bitis) {
        await new Promise((r) => setTimeout(r, 10));
        if (this.vazgec) break;
      }
      if (this.vazgec || this.kartReddet) {
        this.vazgec = false;
        this.kartReddet = false;
        x.AddedPayments.push({ PaymentMediatorId: 2, PaymentTypeId: 2, StatusId: 3, PaymentAmount: tl(tutar) });
        return this.hata(76, 'Kart reddedildi (sahte)');
      }
    }
    const verilen = odeme.GivenAmount !== undefined ? k(odeme.GivenAmount) : tutar;
    x.AddedPayments.push({
      PaymentMediatorId: araci,
      PaymentTypeId: araci === 1 ? 1 : araci === 2 ? 2 : 14,
      StatusId: 2,
      PaymentAmount: tl(tutar),
      ...(araci === 1 ? { CashPayment: { GivenAmount: tl(verilen), ChangeAmount: tl(verilen - tutar) } } : {}),
    });
    const kalan = k(x.RemainingPaymentAmount) - tutar;
    x.RemainingPaymentAmount = tl(kalan);
    if (kalan === 0) {
      x.IsSuspendedSale = false;
      x.StatusId = 6;
      x.FinancialDocuments.push({ InvoiceNo: `GIB${x.Id}`, DocumentNo: `ettn-${x.Id}` });
    }
    return this.tamam(x);
  }

  private iade(s: Record<string, unknown>): PavoYaniti {
    const orijinal = this.bul({ Id: s.RelatedSaleId });
    if (!orijinal || orijinal.IsSuspendedSale || orijinal.StatusId === 13) return this.hata(1, 'İade edilecek satış yok');
    let toplam = 0;
    for (const kalem of (s.AddedSaleItems as Record<string, unknown>[]) ?? []) {
      const o = orijinal.AddedSaleItems.find((x) => x.Id === kalem.RelatedSaleItemId);
      if (!o) return this.hata(1, `Kalem ${String(kalem.RelatedSaleItemId)} satışta yok`);
      const iadeEdilen = k(o.ReturnedAmount ?? 0) + k(kalem.ReturnAmount);
      if (iadeEdilen > k(o.TotalPriceAmount)) return this.hata(66, 'İade kalemi aşıyor');
      o.ReturnedAmount = tl(iadeEdilen);
      toplam += k(kalem.ReturnAmount);
    }
    const odenen = ((s.PaymentInformations as Record<string, unknown>[]) ?? []).reduce((t, o) => t + k(o.Amount), 0);
    if (odenen !== toplam) return this.hata(69, 'İade ödemesi toplamla tutmuyor');
    const id = ++this.id;
    const kayit: Kayit = {
      Id: id,
      SaleNumber: `IADE${id}`,
      OrderNo: String(s.OrderNo),
      StatusId: 6,
      IsSuspendedSale: false,
      GrossPrice: tl(toplam),
      TotalPrice: tl(toplam),
      RemainingPaymentAmount: 0,
      RelatedSaleId: s.RelatedSaleId,
      AddedSaleItems: (s.AddedSaleItems as Record<string, unknown>[]) ?? [],
      AddedPayments: [{ StatusId: 2, PaymentAmount: tl(toplam), PaymentTypeId: 1 }],
      FinancialDocuments: [{ InvoiceNo: `GIBIADE${id}` }],
    };
    this.satislar.push(kayit);
    return this.tamam(kayit);
  }
}
