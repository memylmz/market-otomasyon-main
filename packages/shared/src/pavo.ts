/**
 * Pavo N86 (yazarkasa POS, GMU / VUK 507) — protokolün çalışma zamanından
 * bağımsız kuralları.
 *
 * Kaynak: Cybele kasasının sahada doğrulanmış Pavo entegrasyonu (Dart) ve
 * `docs/pavo/` altındaki resmi doküman kopyası. Cihaz HTTP sunucusudur; bu
 * dosya isteği kurar ve cevabı TOLERANSLI çözer, çünkü gerçek cihaz dokümanla
 * birebir aynı alan adlarını kullanmıyor:
 *  - hata mesajı `Message` ya da `ErrorMessage` gelebilir,
 *  - `ErrorCode` sayı, sayısal metin ya da "NoPendingSales" gibi düz metin olabilir,
 *  - kalem listesi `AddedSaleItems` ya da `SaleItems` anahtarıyla gelir,
 *  - sorgu linki hem `SaleInquieryLink` hem sonu boşluklu anahtarla gelir.
 *
 * TUTAR DİSİPLİNİ: içeride her tutar kuruştur; cihaza giderken TL'ye çevrilir.
 * Cihaz `adet × birim = brüt` ve `Σ satır = toplam` eşitliklerini kuruşuna kadar
 * doğrular (hata 42/44/45). Brüt, cihazın kendi hesabıyla (çift duyarlıklı
 * çarpım + yuvarlama) birebir aynı yapılır; tutmayan kalem tek adet olarak gider.
 */

import { BIRIM_KISALTMA, MIKTAR_OLCEK, type Miktar } from './miktar.js';
import type { Kurus } from './para.js';
import type { BirimTipi } from './sabitler.js';

// ---------------------------------------------------------------------------
// Ayarlar ve sabitler
// ---------------------------------------------------------------------------

/** Pavo'ya özel ayarlar. Adres ve kart okuma süresi ortak POS ayarlarındadır (`pos.adres`, `pos.zaman_asimi_sn`). */
export const PAVO_AYAR = {
  /** '1' → HTTPS (port 4567), '0' → HTTP (port 4568). */
  HTTPS: 'pavo.https',
  /** Cihazın seri numarası — eşleştirme isteğinde de doğrulanıyor (hata 71). */
  SERI_NO: 'pavo.seri_no',
  /** Pavo'ya kayıtlı ticari uygulama adı; cihaz isteklerde doğruluyor ve belgeye yazıyor. */
  UYGULAMA_ADI: 'pavo.uygulama_adi',
  /** Bu kasanın kalıcı parmak izi. Değişirse cihaz yeniden eşleştirme ister. */
  PARMAK_IZI: 'pavo.parmak_izi',
  /** Cihaza gönderilen son sıra numarası (write-ahead). */
  SON_SIRA: 'pavo.son_sira',
  /** HTTPS'te ilk bağlantıda sabitlenen sertifika özeti (TOFU). */
  SERTIFIKA: 'pavo.sertifika',
  /** Son alınan gün sonu (Z) raporunun zamanı (ISO) — "Z alınmadı" uyarısı için. */
  SON_Z: 'pavo.son_z',
} as const;

/**
 * Ayarlar ekranından YAZILAMAYAN Pavo ayarları. Ekran tüm ayarları birlikte
 * kaydeder; sayfa açıldığında okunan bayat sıra numarası kaydedilseydi cihaz
 * sonraki her isteği "eski sıra" diye reddederdi (hata 73).
 */
export const PAVO_KORUNAN_AYARLAR: readonly string[] = [
  PAVO_AYAR.PARMAK_IZI,
  PAVO_AYAR.SON_SIRA,
  PAVO_AYAR.SERTIFIKA,
  PAVO_AYAR.SON_Z,
];

export const PAVO_VARSAYILAN_UYGULAMA_ADI = 'Market Otomasyon';

/** Ödeme aracıları (Pavo "Payment Mediator" tablosu). */
export const PAVO_ARACI = { NAKIT: 1, KART: 2, ACIK_HESAP: 29 } as const;

/** Ödeme tipleri (Pavo "Payment Type" tablosu) — cevaptaki ödemenin ne olduğu. */
export const PAVO_ODEME_TIPI = { NAKIT: 1, KREDI_KARTI: 2, BANKA_KARTI: 6, ACIK_HESAP: 14 } as const;

/** Kuruş → cihaza giden TL. */
export function pavoTl(kurus: Kurus): number {
  return kurus / 100;
}

/** Cihazdan gelen TL → kuruş. */
export function pavoKurus(deger: unknown): Kurus {
  return typeof deger === 'number' && Number.isFinite(deger) ? Math.round(deger * 100) : 0;
}

/**
 * KDV oranı → cihazın vergi grubu kodu.
 *
 * TUZAK: referans tablosundaki "KDV18" aslında %20'ye, "KDV8" %10'a karşılık
 * geliyor (2023 oran değişikliğinden kalma). Güncel kodlar kullanılır; tabloda
 * olmayan oran sessizce başka gruba yazılmaz, satış durdurulur.
 */
export function pavoVergiKodu(kdvOrani: number): string {
  if (kdvOrani === 0 || kdvOrani === 1 || kdvOrani === 10 || kdvOrani === 20) return `KDV${kdvOrani}`;
  throw new Error(`%${kdvOrani} KDV oranı Pavo vergi gruplarında yok (0, 1, 10, 20). Ürün kartındaki oranı düzeltin.`);
}

/** GİB birim kodu. */
export function pavoBirimKodu(birim: BirimTipi): string {
  return birim === 'KG' ? 'KGM' : birim === 'LT' ? 'LTR' : 'C62';
}

// ---------------------------------------------------------------------------
// İstek
// ---------------------------------------------------------------------------

export interface PavoKalemGirdisi {
  ad: string;
  miktar: Miktar;
  birimTipi: BirimTipi;
  birimFiyat: Kurus;
  /** Bizim kaydımızdaki satır brütü (miktar × birim fiyat, kuruşa yuvarlı). */
  brut: Kurus;
  /** Satır iskontosu (kampanya ya da elle). */
  iskonto: Kurus;
  kdvOrani: number;
  /** Cihaz saklayıp geri veriyor; kurtarmada kalemi ürüne bağlamak için. */
  urunId?: string | null;
  barkod?: string | null;
}

/**
 * Bir satırı cihazın kalem biçimine çevirir.
 *
 * Brüt cihazın kendi hesabıyla doğrulanır: cihaz `ItemQuantity × UnitPrice`yı
 * çift duyarlıklı sayıyla çarpıp yuvarlıyor; JS aynı IEEE aritmetiğini
 * kullandığı için sonucu burada birebir öngörebiliyoruz. Nadiren (çarpım tam
 * ,5'in altına düşünce) bizim tam sayı hesabımızla bir kuruş ayrışır; o zaman
 * kalem "1 adet × satır tutarı" olarak, miktar adına yazılarak gönderilir —
 * fiş yine doğru tutarı gösterir, satış reddedilmez.
 */
export function pavoKalemi(k: PavoKalemGirdisi): Record<string, unknown> {
  if (k.brut <= 0) throw new Error(`"${k.ad}" kaleminin tutarı sıfır; Pavo sıfır tutarlı kalem kabul etmiyor.`);
  if (k.iskonto >= k.brut) {
    throw new Error(`"${k.ad}" kalemi tamamen indirimli; Pavo bedelsiz kalemi ücretli sepette kabul etmiyor.`);
  }
  const miktar = k.miktar / MIKTAR_OLCEK;
  const cihazBrutu = Math.round(miktar * k.birimFiyat);
  const tutuyor = cihazBrutu === k.brut && miktar >= 0.01;
  const toplam = k.brut - Math.max(0, k.iskonto);

  return {
    Name: tutuyor
      ? k.ad
      : `${k.ad} ${miktar.toLocaleString('tr-TR', { maximumFractionDigits: 3 })} ${BIRIM_KISALTMA[k.birimTipi]}`,
    IsGeneric: false,
    UnitCode: tutuyor ? pavoBirimKodu(k.birimTipi) : 'C62',
    TaxGroupCode: pavoVergiKodu(k.kdvOrani),
    ItemQuantity: tutuyor ? miktar : 1,
    UnitPriceAmount: pavoTl(tutuyor ? k.birimFiyat : k.brut),
    GrossPriceAmount: pavoTl(k.brut),
    TotalPriceAmount: pavoTl(toplam),
    ...(k.iskonto > 0 ? { PriceEffect: { Type: 1, Amount: pavoTl(k.iskonto) } } : {}),
    ...(k.urunId ? { ReservedText: k.urunId } : {}),
    ...(k.barkod ? { Barcode: k.barkod } : {}),
  };
}

export interface PavoSatisIstegiGirdisi {
  uygulamaAdi: string;
  uygulamaSurumu: string;
  /** Bizim sipariş numaramız — cihaz mükerrer satışı bununla engeller (hata 129). */
  siparisNo: string;
  kalemler: PavoKalemGirdisi[];
  kartOkumaSn: number;
  /** Faturalı satışta alıcı (CustomerParty); yoksa nihai tüketici fişi. */
  musteri?: Record<string, unknown> | null;
}

/**
 * `StartSaleWithItems` gövdesi. Ödemeler GÖNDERİLMEZ: cihaz satışı başlatıp
 * askıya alır, tahsilat her ödeme için ayrı `AddPaymentAndFinalizeSale` ile
 * yapılır (Cybele'de cihazda doğrulandı).
 */
export function pavoSatisIstegi(g: PavoSatisIstegiGirdisi): { govde: Record<string, unknown>; brut: Kurus; toplam: Kurus } {
  if (g.kalemler.length === 0) throw new Error('Sepet boş.');
  const kalemler = g.kalemler.map(pavoKalemi);
  const brut = g.kalemler.reduce((t, k) => t + k.brut, 0);
  const toplam = g.kalemler.reduce((t, k) => t + k.brut - Math.max(0, k.iskonto), 0);
  return {
    brut,
    toplam,
    govde: {
      RefererApp: g.uygulamaAdi,
      RefererAppVersion: g.uygulamaSurumu,
      MainDocumentType: 1,
      OrderNo: g.siparisNo,
      GrossPrice: pavoTl(brut),
      TotalPrice: pavoTl(toplam),
      CurrencyCode: 'TRY',
      ExchangeRate: 1,
      AddedSaleItems: kalemler,
      ...(g.musteri ? { CustomerParty: g.musteri } : {}),
      CardReadTimeout: g.kartOkumaSn,
      // Kart menüsü ("Satış / Ön provizyon") atlanır, doğrudan kart okumaya geçilir.
      ShowCreditCardMenu: false,
      // Tutar kasada girildi; cihaz nakit tutarını ikinci kez sormasın.
      SkipAmountCash: true,
      // Cevap fiş basımından ÖNCE dönsün — kasa beklemesin.
      SendResponseBeforePrint: true,
      // Hataları kasa ekranı gösterir.
      IsSilentMode: true,
    },
  };
}

export type PavoOdemeTipi = 'NAKIT' | 'KART' | 'VERESIYE';

/** Tek ödeme talimatı. Veresiye cihazda "Açık Hesap" aracıyla geçer — belge yine kesilir. */
export function pavoOdemesi(o: { tip: PavoOdemeTipi; tutar: Kurus; alinan?: Kurus | null }): Record<string, unknown> {
  if (o.tutar <= 0) throw new Error('Ödeme tutarı sıfırdan büyük olmalı.');
  const araci = o.tip === 'NAKIT' ? PAVO_ARACI.NAKIT : o.tip === 'KART' ? PAVO_ARACI.KART : PAVO_ARACI.ACIK_HESAP;
  return {
    Mediator: araci,
    Amount: pavoTl(o.tutar),
    ...(o.tip === 'NAKIT' ? { GivenAmount: pavoTl(Math.max(o.tutar, o.alinan ?? o.tutar)) } : {}),
  };
}

/**
 * Ödemelerin cihaza gönderilme sırası: KART ÖNCE. Kart reddedilirse henüz hiçbir
 * şey tahsil edilmemiş olur ve satış temizce silinir; nakit önce alınsaydı
 * cihaz onu da iade etmek zorunda kalırdı.
 */
export function pavoOdemeSirasi<T extends { tip: PavoOdemeTipi }>(odemeler: readonly T[]): T[] {
  const sira: Record<PavoOdemeTipi, number> = { KART: 0, NAKIT: 1, VERESIYE: 2 };
  return [...odemeler].sort((a, b) => sira[a.tip] - sira[b.tip]);
}

// ---------------------------------------------------------------------------
// Cevap
// ---------------------------------------------------------------------------

export interface PavoYaniti {
  hata: boolean;
  kod: number | null;
  /** "NoPendingSales" gibi sayısal olmayan kodlar. */
  kodMetni: string | null;
  mesaj: string;
  veri: Record<string, unknown> | null;
  /** Cevap zarfındaki seri numarası (eşleştirmede okunur). */
  seriNo: string | null;
}

const nesneMi = (d: unknown): d is Record<string, unknown> => typeof d === 'object' && d !== null && !Array.isArray(d);

export function pavoYanitiCoz(j: unknown): PavoYaniti {
  const g = nesneMi(j) ? j : {};
  let kod: number | null = null;
  let kodMetni: string | null = null;
  const ham = g.ErrorCode;
  if (typeof ham === 'number') kod = ham;
  else if (typeof ham === 'string' && ham !== '') {
    const sayi = Number(ham);
    if (Number.isInteger(sayi)) kod = sayi;
    else kodMetni = ham;
  }
  const el = nesneMi(g.TransactionHandle) ? g.TransactionHandle : null;
  return {
    hata: g.HasError === true,
    kod,
    kodMetni,
    mesaj: String(g.Message ?? g.ErrorMessage ?? ''),
    veri: nesneMi(g.Data) ? g.Data : null,
    seriNo: el?.SerialNumber != null ? String(el.SerialNumber) : null,
  };
}

export interface PavoBelge {
  faturaNo: string;
  /** ETTN */
  belgeNo: string;
}

export interface PavoYapilanOdeme {
  araci: number;
  tip: number;
  durum: number;
  tutar: Kurus;
  paraUstu: Kurus;
}

export interface PavoSatilanKalem {
  /** Cihazın kalem kimliği — kısmi iadede `RelatedSaleItemId`. */
  id: number;
  ad: string;
  miktar: number;
  birimFiyat: Kurus;
  toplam: Kurus;
  kdvOrani: number;
  rezerv: string;
}

export interface PavoSatisi {
  /** Cihazın satış kimliği — kısmi iadede `RelatedSaleId`. */
  id: number;
  satisNo: string;
  siparisNo: string;
  durum: number;
  kalan: Kurus;
  brut: Kurus;
  toplam: Kurus;
  iptalIstendi: boolean;
  belgeler: PavoBelge[];
  odemeler: PavoYapilanOdeme[];
  kalemler: PavoSatilanKalem[];
  sorguLinki: string;
}

const sayi = (d: unknown): number => (typeof d === 'number' && Number.isFinite(d) ? d : 0);

export function pavoSatisiCoz(d: Record<string, unknown> | null | undefined): PavoSatisi {
  const v = d ?? {};
  const liste = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter(nesneMi) : []);
  return {
    id: sayi(v.Id),
    satisNo: v.SaleNumber != null ? String(v.SaleNumber) : '',
    siparisNo: v.OrderNo != null ? String(v.OrderNo) : '',
    durum: sayi(v.StatusId),
    kalan: pavoKurus(v.RemainingPaymentAmount),
    brut: pavoKurus(v.GrossPrice),
    toplam: pavoKurus(v.TotalPrice),
    iptalIstendi: v.CancelRequested === true,
    belgeler: liste(v.FinancialDocuments).map((b) => ({
      faturaNo: b.InvoiceNo != null ? String(b.InvoiceNo) : '',
      belgeNo: b.DocumentNo != null ? String(b.DocumentNo) : '',
    })),
    odemeler: liste(v.AddedPayments ?? v.Payments).map((o) => ({
      araci: sayi(o.PaymentMediatorId),
      tip: sayi(o.PaymentTypeId),
      durum: sayi(o.StatusId),
      tutar: pavoKurus(o.PaymentAmount),
      paraUstu: nesneMi(o.CashPayment) ? pavoKurus(o.CashPayment.ChangeAmount) : 0,
    })),
    kalemler: liste(v.AddedSaleItems ?? v.SaleItems).map((k) => ({
      id: sayi(k.Id),
      ad: String(k.Name ?? ''),
      miktar: typeof k.ItemQuantity === 'number' ? k.ItemQuantity : 1,
      birimFiyat: pavoKurus(k.UnitPriceAmount),
      toplam: pavoKurus(k.TotalPriceAmount ?? k.GrossPriceAmount),
      kdvOrani: Math.round(sayi(k.VATRate)),
      rezerv: String(k.ReservedText ?? ''),
    })),
    // Gerçek cihaz anahtarı hem yanlış yazıyor ("Inquiery") hem sonuna boşluk koyuyor.
    sorguLinki: String(v.SaleInquieryLink ?? v['SaleInquieryLink '] ?? ''),
  };
}

/** Durum tablosu: 11/13 iptal, 7 terk. */
export function pavoIptalMi(s: PavoSatisi): boolean {
  return s.durum === 11 || s.durum === 13;
}

export function pavoTerkMi(s: PavoSatisi): boolean {
  return s.durum === 7;
}

/** Cihazda gerçekten TAHSİL EDİLMİŞ ödemeler; reddedilen kart denemeleri listede kalıyor, elenir. */
export function pavoTahsilEdilenler(s: PavoSatisi): PavoYapilanOdeme[] {
  return s.odemeler.filter((o) => o.durum === 2 || o.durum === 10);
}

/**
 * Hâlâ tahsil edilmesi gereken tutar. `RemainingPaymentAmount`a tek başına
 * güvenilmez: sahada yarım tahsil edilmiş satış için cihaz bu alanı 0 döndürdü.
 */
export function pavoKalanTutar(s: PavoSatisi): Kurus {
  if (s.kalan > 0) return s.kalan;
  const odenen = pavoTahsilEdilenler(s).reduce((t, o) => t + o.tutar, 0);
  return Math.max(0, s.toplam - odenen);
}

/**
 * Satış kapandı mı — kayda geçirmeye yetecek kesinlikte mi?
 *
 * `IsSuspendedSale` bayrağına BAKILMAZ: cihaz ödeme alınıp belge kesildikten
 * sonra bile onu `true` bırakıyor. Ölçüt: iptal/terk değil, kalan sıfır ve ya
 * belge kesilmiş ya da başarılı bir ödeme var (belge asenkron gecikebiliyor).
 */
export function pavoKapandiMi(s: PavoSatisi): boolean {
  if (pavoIptalMi(s) || pavoTerkMi(s)) return false;
  if (pavoKalanTutar(s) > 0) return false;
  if (s.belgeler.length > 0) return true;
  if (s.toplam === 0) return true;
  return pavoTahsilEdilenler(s).length > 0;
}

export function pavoFaturaNo(s: PavoSatisi): string {
  return s.belgeler[0]?.faturaNo ?? '';
}

/** Cihazın verdiği para üstü (nakit ödemelerin toplamı). */
export function pavoParaUstu(s: PavoSatisi): Kurus {
  return pavoTahsilEdilenler(s).reduce((t, o) => t + o.paraUstu, 0);
}

export function pavoDurumEtiketi(durum: number): string {
  const etiketler: Record<number, string> = {
    0: '',
    1: 'Askıda',
    2: 'Ödeme bekliyor',
    3: 'Belge oluşturuluyor',
    4: 'Belge bekleniyor',
    5: 'Belge oluşturuldu',
    6: 'Tamamlandı',
    7: 'Terk edildi',
    8: 'Belge oluşturulamadı',
    9: 'İmzalanıyor',
    10: 'İmzalama başarısız',
    11: 'İptal edildi',
    12: 'Ödemeler iptal ediliyor',
    13: 'İptal edildi',
    14: 'Ödeme iptali başarısız',
    15: 'Belge iptal ediliyor',
    16: 'Belge iptali başarısız',
    17: 'Belge iptali bekleniyor',
    18: 'İmzalandı',
    19: 'ERP işlemlerinde',
    20: 'Belge onaylandı',
    21: 'Belge onaylanmadı',
    22: 'İnceleme bekleniyor',
    23: 'Tamamlanmamış satış',
  };
  return etiketler[durum] ?? `Durum ${durum}`;
}

// ---------------------------------------------------------------------------
// Hata metinleri
// ---------------------------------------------------------------------------

/** Kasiyerin anlayacağı Türkçe açıklamalar — markette gerçekten karşılaşılacak kodlar. */
const KOD_METNI: Record<number, string> = {
  20: 'Pavo meşgul — birkaç saniye bekleyip tekrar deneyin.',
  30: 'Pavo cihazında yarım kalmış bir satış var. Ayarlar → Donanım → Pavo → "Askıdaki satışlar"dan silin.',
  71: "Seri numarası cihazınkiyle uyuşmuyor. Ayarlar → Donanım → Pavo'daki seri numarasını cihazın arkasındaki numarayla düzeltip yeniden eşleştirin.",
  72: "Kasa saati Pavo'dan farklı. Windows saat ayarını kontrol edin.",
  73: "İşlem sıra numarası tutmadı ve otomatik düzeltme başarısız oldu — Pavo'yu yeniden eşleştirin.",
  74: "Pavo bu kasayı tanımıyor — Ayarlar → Donanım → Pavo'dan yeniden eşleştirin.",
  83: 'Pavo cihazında kullanıcı girişi yapılmamış. Cihazda oturum açın.',
  90: 'Pavo fiş basıyor — bitince tekrar deneyin.',
  129: "Bu satış Pavo'da zaten işlenmiş (mükerrer koruması).",
  130: "Satış Pavo'da hâlâ işleniyor — sonuç için bekleyin.",
  189: "Pavo'nun şarjı çok düşük. Şarj kablosunu takın.",
  194: 'Pavo henüz hazır değil — açılışını bekleyin.',
  199: 'Banka gün sonu istiyor. Ayarlar → Donanım → Pavo → "Banka gün sonu" alıp tekrar deneyin.',
  204: 'Pavo işlemi yaptı ama cevap ulaşmadı — sonuç sorgulanıyor.',
  218: "Pavo'nun ağ bağlantısı yok, satış başlatılamadı.",
};

const KOD_METNI_YAZI: Record<string, string> = {
  NoPendingSales: 'Askıda satış yok.',
  ReportError: "Raporlanacak satış bulunamadı — bu dönemde Pavo'dan geçmiş bir işlem yok.",
  ReportNotFound: 'Rapor bulunamadı.',
  InvalidDateRange: 'Tarih aralığı geçersiz — en fazla 31 gün sorgulanabilir.',
};

export function pavoHataMetni(y: { kod: number | null; kodMetni: string | null; mesaj: string }): string {
  if (y.kod !== null && KOD_METNI[y.kod]) return KOD_METNI[y.kod]!;
  if (y.kodMetni && KOD_METNI_YAZI[y.kodMetni]) return KOD_METNI_YAZI[y.kodMetni]!;
  if (y.kod !== null) return `Pavo hatası (${y.kod}): ${y.mesaj}`;
  return y.mesaj || 'Pavo bilinmeyen bir hata döndürdü.';
}
