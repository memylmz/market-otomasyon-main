/**
 * Pavo mali raporları — cihazın cevabını kasanın anlayacağı tek şekle çevirir.
 *
 * Cihaz aynı raporu iki ayrı şemayla anlatıyor (Cybele'de sahada öğrenildi):
 *  - ÖZET şeması (PascalCase): `ListReports.Reports[]`,
 *    `GetReportSummaries.Batches[]`, `CreateReportWithSummaries.Batches[]`.
 *    Tutarlar sayı ya da metin gelebilir.
 *  - SORGU şeması (camelCase): `QueryReport.Data.datas[]`. Tutarlar Türkçe
 *    biçimli metin ("+1.234,50 TL"), tarihler "19.02.2026 13:03".
 *
 * Ayrıca `ListReports` satırı Z numarasını ve oluşturma tarihini taşır ama
 * kırılımı taşımaz; `GetReportSummaries` tam tersi. İkisi birleştirilmezse
 * mali kimliğin ta kendisi olan Z numarası kaybolur → `pavoRaporBirlestir`.
 */

import type { Kurus } from './para.js';

/**
 * Raporun kasadaki adı.
 *
 * GUN_SONU: cihazın "Terminal Satış Raporu" (`T`). SAHADA DOĞRULANDI (Cybele,
 * 31 Ağustos 2026): gün sonunu kapatan rapor bu; `ZReport` gün sonu almıyor.
 * DONEM: tarih aralıklı satış raporu (aylık rapor) — günü KAPATMAZ.
 */
export type PavoRaporTuru = 'X' | 'XFARK' | 'GUN_SONU' | 'DONEM';

export const PAVO_RAPOR_ADI: Record<PavoRaporTuru, string> = {
  X: 'X Raporu',
  XFARK: 'X Fark Raporu',
  GUN_SONU: 'Gün Sonu (Z) Raporu',
  DONEM: 'Dönem Satış Raporu',
};

export interface PavoOdemeSatiri {
  /** Cihazın kendi metni: "Nakit (TL)", "Kredi Kartı", "İade Bilgi Fişi - Nakit (TL)"… */
  ad: string;
  adet: number;
  tutar: Kurus;
  iptalAdedi: number;
  /** Her zaman pozitif büyüklük. */
  iptalTutari: Kurus;
  net: Kurus;
}

export interface PavoKdvSatiri {
  /** Cihazın metni ("%20", "KDV20", "20"…) olduğu gibi. */
  oran: string;
  matrah: Kurus;
  kdv: Kurus;
}

export interface PavoBelgeSatiri {
  ad: string;
  adet: number;
  tutar: Kurus;
}

export interface PavoUrunSatiri {
  ad: string;
  miktar: number;
  tutar: Kurus;
}

export interface PavoRaporu {
  /** Cihazın rapor kimliği (BatchId); nüsha bastırma ve özet bununla istenir. 0 = bilinmiyor. */
  raporId: number;
  tur: PavoRaporTuru | null;
  /** Cihazın kendi rapor adı — tür tanınmazsa ekranda bu gösterilir. */
  ad: string;
  /** Z numarası; yalnız gün sonu raporlarında dolu. */
  zNo: number | null;
  satisAdedi: number;
  satisTutari: Kurus;
  iptalAdedi: number;
  iptalTutari: Kurus;
  /** Yerel saat, "YYYY-MM-DDTHH:mm:ss" (saat dilimi eki yok). */
  ilkIslem: string | null;
  sonIslem: string | null;
  olusturma: string | null;
  odemeler: PavoOdemeSatiri[];
  kdvler: PavoKdvSatiri[];
  belgeler: PavoBelgeSatiri[];
  urunler: PavoUrunSatiri[];
  /**
   * Sorgu şemasının hazır toplamları. null = cihaz göndermedi (görünürlük
   * bayrağı kapalı) — "sıfır" ile "bilinmiyor" ayrı tutulur.
   */
  nakit: Kurus | null;
  kart: Kurus | null;
  kdvMatrahi: Kurus | null;
  kdvToplami: Kurus | null;
  genelToplam: Kurus | null;
}

// ---------------------------------------------------------------------------
// Alan çözücüler
// ---------------------------------------------------------------------------

/**
 * Cihazın tutarı → kuruş. Sayı (12.5), metin ("12.50"), Türkçe biçim
 * ("+1.234,50 TL", "-3,00 TL") ve ham ondalık ("-3.5 TL") gelebiliyor.
 * Son ayraçtan sonra tam 3 hane varsa o binlik ayracıdır: "3.192" → 3192 TL.
 */
export function pavoRaporTutari(d: unknown): Kurus {
  if (typeof d === 'number') return Number.isFinite(d) ? Math.round(d * 100) : 0;
  if (typeof d !== 'string') return 0;
  let s = d.replace(/[^0-9,.+-]/g, '');
  const eksi = s.startsWith('-');
  s = s.replace(/[+-]/g, '');
  if (s === '') return 0;
  const isaret = eksi ? -1 : 1;
  const sonAyrac = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (sonAyrac < 0) return isaret * (Number.parseInt(s, 10) || 0) * 100;
  const ondalik = s.length - sonAyrac - 1;
  const duz = ondalik === 3 ? s.replace(/[,.]/g, '') : `${s.slice(0, sonAyrac).replace(/[,.]/g, '')}.${s.slice(sonAyrac + 1)}`;
  const sayi = Number(duz);
  return Number.isFinite(sayi) ? isaret * Math.round(sayi * 100) : 0;
}

/** Sayaç alanı — cihaz bunları da bazen metin gönderiyor (`"paymentCount": "0"`). */
export function pavoRaporSayisi(d: unknown): number {
  if (typeof d === 'number') return Number.isFinite(d) ? Math.round(d) : 0;
  if (typeof d === 'string') {
    const n = Number.parseInt(d.trim(), 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** ISO 8601 (özet şeması) ya da "dd.MM.yyyy HH:mm" (sorgu şeması) → "YYYY-MM-DDTHH:mm:ss". */
export function pavoRaporTarihi(d: unknown): string | null {
  if (typeof d !== 'string' || d.trim() === '') return null;
  const s = d.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4] ?? '00'}:${iso[5] ?? '00'}:${iso[6] ?? '00'}`;
  const tr = /^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  if (tr) return `${tr[3]}-${tr[2]}-${tr[1]}T${tr[4] ?? '00'}:${tr[5] ?? '00'}:00`;
  return null;
}

const nesneMi = (d: unknown): d is Record<string, unknown> => typeof d === 'object' && d !== null && !Array.isArray(d);
const metin = (d: unknown): string => (d === null || d === undefined ? '' : String(d));

function satirlar<T>(ham: unknown, coz: (j: Record<string, unknown>) => T): T[] {
  return Array.isArray(ham) ? ham.filter(nesneMi).map(coz) : [];
}

/** Liste ya da tek nesne gelebilen alanların ilk nesnesi (`totals`, `extras`). */
function ilkNesne(d: unknown): Record<string, unknown> {
  if (nesneMi(d)) return d;
  if (Array.isArray(d)) return d.find(nesneMi) ?? {};
  return {};
}

function odemeSatiri(j: Record<string, unknown>): PavoOdemeSatiri {
  return {
    ad: metin(j.PaymentType ?? j.paymentType),
    adet: pavoRaporSayisi(j.PaymentCount ?? j.paymentCount),
    tutar: pavoRaporTutari(j.PaymentSum ?? j.paymentSum),
    iptalAdedi: pavoRaporSayisi(j.CancelCount ?? j.cancelCount),
    iptalTutari: Math.abs(pavoRaporTutari(j.CancelSum ?? j.cancelSum)),
    net: pavoRaporTutari(j.PaymentTotal ?? j.paymentTotal),
  };
}

/** Sorgu şemasında matrah ayrı alan değil: `vatPaymentSum` KDV, `paymentTotal` matrahtır. */
function kdvSatiri(j: Record<string, unknown>): PavoKdvSatiri {
  return {
    oran: metin(j.VATType ?? j.vatType),
    matrah: pavoRaporTutari(j.BaseAmount ?? j.paymentTotal),
    kdv: pavoRaporTutari(j.TaxAmount ?? j.vatPaymentSum),
  };
}

function belgeSatiri(j: Record<string, unknown>): PavoBelgeSatiri {
  return {
    ad: metin(j.DocumentType ?? j.documentType),
    adet: pavoRaporSayisi(j.DocumentCount ?? j.documentCount),
    tutar: pavoRaporTutari(j.DocumentAmount ?? j.documentAmount),
  };
}

function urunSatiri(j: Record<string, unknown>): PavoUrunSatiri {
  const m = j.Quantity ?? j.quantity;
  const miktar = typeof m === 'number' ? m : Number(metin(m).replace(',', '.'));
  return {
    ad: metin(j.ProductName ?? j.productName),
    miktar: Number.isFinite(miktar) ? miktar : 0,
    tutar: pavoRaporTutari(j.TotalAmount ?? j.totalAmount),
  };
}

/** Cihazın tür yazımından kasanın türü. Tanınmazsa null (ekranda cihazın adı görünür). */
function turBul(tip: string, fark: boolean): PavoRaporTuru | null {
  const t = tip.toLocaleLowerCase('tr');
  if (t === 'x' || t === 'xfark' || t.includes('kullanıcı satış')) return fark || t === 'xfark' ? 'XFARK' : 'X';
  if (t === 't' || t === 'z' || t.includes('gün sonu') || t.includes('terminal')) return 'GUN_SONU';
  return null;
}

function ozettenCoz(j: Record<string, unknown>): PavoRaporu {
  const fark = metin(j.DifferenceIndicator).toUpperCase() === 'Y';
  const tip = metin(j.BatchType);
  return {
    raporId: pavoRaporSayisi(j.BatchId),
    tur: turBul(tip, fark),
    ad: tip,
    zNo: j.ZReportNo === null || j.ZReportNo === undefined || j.ZReportNo === '' ? null : pavoRaporSayisi(j.ZReportNo),
    satisAdedi: pavoRaporSayisi(j.TotalPaymentCount),
    satisTutari: pavoRaporTutari(j.TotalPaymentAmount),
    iptalAdedi: pavoRaporSayisi(j.TotalCancelledCount),
    // Doküman pozitif diyor; cihazın dokümandan saptığı yerler bilindiği için normalize.
    iptalTutari: Math.abs(pavoRaporTutari(j.TotalCancelledAmount)),
    // Cihazın alan adı "Minumum" (dokümanda da böyle); doğru yazımı da kabul.
    ilkIslem: pavoRaporTarihi(j.MinumumPaymentDate ?? j.MinimumPaymentDate),
    sonIslem: pavoRaporTarihi(j.MaximumPaymentDate),
    olusturma: pavoRaporTarihi(j.CreateDate ?? j.CreatedDate),
    odemeler: satirlar(j.PaymentSummary, odemeSatiri),
    kdvler: satirlar(j.VATSummary, kdvSatiri),
    belgeler: satirlar(j.DocumentSummary, belgeSatiri),
    urunler: satirlar(j.ProductSummary, urunSatiri),
    nakit: null,
    kart: null,
    kdvMatrahi: null,
    kdvToplami: null,
    genelToplam: null,
  };
}

/** Görünürlük bayrağı kapalıysa o alan raporda YOK — 0 yazmak "sıfır" demek olurdu. */
function gorunurToplam(toplamlar: Record<string, unknown>, alan: string, bayrak: string): Kurus | null {
  if (metin(toplamlar[bayrak]) === 'false') return null;
  const d = toplamlar[alan];
  return d === null || d === undefined ? null : pavoRaporTutari(d);
}

function sorgudanCoz(j: Record<string, unknown>): PavoRaporu {
  const ekler = ilkNesne(j.extras);
  const toplamlar = ilkNesne(j.totals);
  const fark = metin(ekler.isDifferenceX) === 'true';
  const tip = metin(j.reportType);
  const odemeler = satirlar(j.paymentTypes, odemeSatiri);
  const varsa = (alan: string) =>
    toplamlar[alan] === undefined || toplamlar[alan] === null ? null : pavoRaporTutari(toplamlar[alan]);
  return {
    raporId: pavoRaporSayisi(j.batchId),
    tur: turBul(tip, fark),
    ad: tip,
    zNo: j.zReportNo === null || j.zReportNo === undefined || j.zReportNo === '' ? null : pavoRaporSayisi(j.zReportNo),
    satisAdedi: pavoRaporSayisi(toplamlar.paymentCountTotal),
    satisTutari: odemeler.reduce((t, o) => t + o.tutar, 0),
    iptalAdedi: pavoRaporSayisi(toplamlar.paymentCancelledCountTotal),
    iptalTutari: odemeler.reduce((t, o) => t + o.iptalTutari, 0),
    ilkIslem: pavoRaporTarihi(ekler.firstOperationDate),
    sonIslem: pavoRaporTarihi(ekler.lastOperationDate),
    olusturma: pavoRaporTarihi(j.dateTime),
    odemeler,
    kdvler: satirlar(j.vats, kdvSatiri),
    // Dokümandaki QueryReport cevabında belge/ürün kırılımı yok; gelirse diye
    // akla gelen adlar deneniyor. Tutmazsa liste boş kalır, tablo çizilmez.
    belgeler: satirlar(j.documentTypes ?? j.documents ?? j.documentSummary, belgeSatiri),
    urunler: satirlar(j.products ?? j.productTypes ?? j.productSummary, urunSatiri),
    nakit: gorunurToplam(toplamlar, 'cashTotal', 'isVisibleCashField'),
    kart: gorunurToplam(toplamlar, 'creditTotal', 'isVisibleCreditField'),
    kdvMatrahi: varsa('vatsBaseTotal'),
    kdvToplami: varsa('vatTaxAmountTotal'),
    genelToplam: varsa('totalAmount'),
  };
}

/** Hangi servisten geldiğine bakmadan cevaptaki raporları çıkarır. */
export function pavoRaporlariCoz(veri: Record<string, unknown> | null | undefined): PavoRaporu[] {
  if (!veri) return [];
  for (const anahtar of ['Reports', 'Batches']) {
    if (Array.isArray(veri[anahtar])) return (veri[anahtar] as unknown[]).filter(nesneMi).map(ozettenCoz);
  }
  if (Array.isArray(veri.datas)) return (veri.datas as unknown[]).filter(nesneMi).map(sorgudanCoz);
  return [];
}

/** `a`'nın EKSİK alanlarını `b` ile tamamlar (liste satırı + özet → tam rapor). */
export function pavoRaporBirlestir(a: PavoRaporu, b: PavoRaporu): PavoRaporu {
  const bos = <T>(x: T[], y: T[]) => (x.length > 0 ? x : y);
  return {
    raporId: a.raporId || b.raporId,
    tur: a.tur ?? b.tur,
    ad: a.ad || b.ad,
    zNo: a.zNo ?? b.zNo,
    satisAdedi: a.satisAdedi || b.satisAdedi,
    satisTutari: a.satisTutari || b.satisTutari,
    iptalAdedi: a.iptalAdedi || b.iptalAdedi,
    iptalTutari: a.iptalTutari || b.iptalTutari,
    ilkIslem: a.ilkIslem ?? b.ilkIslem,
    sonIslem: a.sonIslem ?? b.sonIslem,
    olusturma: a.olusturma ?? b.olusturma,
    odemeler: bos(a.odemeler, b.odemeler),
    kdvler: bos(a.kdvler, b.kdvler),
    belgeler: bos(a.belgeler, b.belgeler),
    urunler: bos(a.urunler, b.urunler),
    nakit: a.nakit ?? b.nakit,
    kart: a.kart ?? b.kart,
    kdvMatrahi: a.kdvMatrahi ?? b.kdvMatrahi,
    kdvToplami: a.kdvToplami ?? b.kdvToplami,
    genelToplam: a.genelToplam ?? b.genelToplam,
  };
}

/** Raporun net tutarı: cihaz söylediyse o, yoksa satış − iptal. */
export function pavoRaporNet(r: PavoRaporu): Kurus {
  return r.genelToplam ?? r.satisTutari - r.iptalTutari;
}

/** Ekrandaki başlık: kasanın adı, tanınmadıysa cihazın adı. */
export function pavoRaporBasligi(r: PavoRaporu): string {
  return r.tur ? PAVO_RAPOR_ADI[r.tur] : r.ad || 'Rapor';
}
