/**
 * Satış/sepet iş kuralı hesaplamaları — saf fonksiyonlar.
 *
 * Bu modül veritabanı, donanım ve UI'dan tamamen bağımsızdır (§4.2), böylece
 * birim testleri gerçek donanım olmadan koşar (§21.1).
 *
 * Fiyat kabulü: `birimFiyat` ve `satisFiyati` alanları **KDV DAHİL**'dir
 * (Türkiye perakendesinde raf fiyatı KDV dahildir, §17.2/§17.3).
 * `alisFiyati` (maliyet) ise **KDV HARİÇ**'tir — brüt kâr KDV hariç hesaplanır (§14).
 */

import { MIKTAR_OLCEK, type Miktar } from './miktar.js';
import { dagit, kdvAyir, yuvarla, yuzdeUygula, type Kurus } from './para.js';
import type { BirimTipi, KampanyaKapsami, KampanyaTipi, OdemeTipi } from './sabitler.js';

// ---------------------------------------------------------------------------
// Satır hesabı
// ---------------------------------------------------------------------------

export interface SatirGirdi {
  miktar: Miktar;
  /** KDV dahil birim fiyat (kuruş). */
  birimFiyat: Kurus;
  kdvOrani: number;
  /** Satır bazlı yüzde iskonto (0-100). */
  iskontoYuzde?: number;
  /** Satır bazlı sabit tutar iskonto (kuruş); yüzdeden sonra uygulanır. */
  iskontoTutar?: Kurus;
}

export interface SatirHesap {
  /** miktar × birimFiyat (KDV dahil, iskontosuz). */
  brut: Kurus;
  /** Satır iskontosu + sepet geneli iskontodan bu satıra düşen pay. */
  iskonto: Kurus;
  /** brut − iskonto (KDV dahil). Fişe basılan satır tutarı. */
  satirToplam: Kurus;
  /** KDV hariç tutar. */
  matrah: Kurus;
  kdvTutar: Kurus;
  kdvOrani: number;
}

/** Bir satırın brüt tutarı: miktar (mili) × birim fiyat, kuruşa yuvarlanır. */
export function satirBrut(miktar: Miktar, birimFiyat: Kurus): Kurus {
  return yuvarla((miktar * birimFiyat) / MIKTAR_OLCEK);
}

export function satirHesapla(girdi: SatirGirdi): SatirHesap {
  const brut = satirBrut(girdi.miktar, girdi.birimFiyat);
  const yuzdeIskonto = girdi.iskontoYuzde ? yuzdeUygula(brut, girdi.iskontoYuzde) : 0;
  const ham = yuzdeIskonto + (girdi.iskontoTutar ?? 0);
  // İskonto satırı negatife düşüremez ve negatif olamaz.
  const iskonto = Math.min(Math.max(ham, 0), Math.max(brut, 0));
  const satirToplam = brut - iskonto;
  const { matrah, kdv } = kdvAyir(satirToplam, girdi.kdvOrani);
  return { brut, iskonto, satirToplam, matrah, kdvTutar: kdv, kdvOrani: girdi.kdvOrani };
}

// ---------------------------------------------------------------------------
// Sepet hesabı
// ---------------------------------------------------------------------------

export interface KdvDilimi {
  oran: number;
  matrah: Kurus;
  kdv: Kurus;
  brut: Kurus;
}

export interface SepetHesap {
  satirlar: SatirHesap[];
  /** Satırların iskontosuz brüt toplamı. */
  araToplam: Kurus;
  /** Satır + sepet geneli iskonto toplamı. */
  iskontoToplam: Kurus;
  kdvToplam: Kurus;
  /** Tahsil edilecek tutar (KDV dahil). */
  genelToplam: Kurus;
  /** Fişte gösterilen KDV kırılımı (§10.3). */
  kdvDagilimi: KdvDilimi[];
}

export interface SepetIskontosu {
  yuzde?: number;
  tutar?: Kurus;
}

/**
 * Sepetin tamamını hesaplar. Sepet geneli iskonto, satırlara **kuruş kaybı olmadan**
 * (largest remainder) dağıtılır; böylece `Σ(matrah) + Σ(kdv) === genelToplam`
 * değişmezi her zaman korunur (§21.2 para doğruluğu).
 */
export function sepetHesapla(girdiler: readonly SatirGirdi[], sepetIskontosu?: SepetIskontosu): SepetHesap {
  const ilkGecis = girdiler.map(satirHesapla);
  const araToplam = ilkGecis.reduce((t, s) => t + s.brut, 0);
  const satirIskontoToplami = ilkGecis.reduce((t, s) => t + s.iskonto, 0);
  const iskontoSonrasi = araToplam - satirIskontoToplami;

  // Sepet geneli iskonto
  let genelIskonto = 0;
  if (sepetIskontosu) {
    const yuzdeKismi = sepetIskontosu.yuzde ? yuzdeUygula(iskontoSonrasi, sepetIskontosu.yuzde) : 0;
    genelIskonto = Math.min(Math.max(yuzdeKismi + (sepetIskontosu.tutar ?? 0), 0), Math.max(iskontoSonrasi, 0));
  }

  const paylar =
    genelIskonto > 0
      ? dagit(
          genelIskonto,
          ilkGecis.map((s) => s.satirToplam),
        )
      : ilkGecis.map(() => 0);

  const satirlar: SatirHesap[] = ilkGecis.map((s, i) => {
    const pay = paylar[i] ?? 0;
    if (pay === 0) return s;
    const satirToplam = s.satirToplam - pay;
    const { matrah, kdv } = kdvAyir(satirToplam, s.kdvOrani);
    return { ...s, iskonto: s.iskonto + pay, satirToplam, matrah, kdvTutar: kdv };
  });

  const genelToplam = satirlar.reduce((t, s) => t + s.satirToplam, 0);
  const kdvToplam = satirlar.reduce((t, s) => t + s.kdvTutar, 0);
  const iskontoToplam = araToplam - genelToplam;

  // KDV oranına göre kırılım
  const dilimHaritasi = new Map<number, KdvDilimi>();
  for (const s of satirlar) {
    const mevcut = dilimHaritasi.get(s.kdvOrani) ?? { oran: s.kdvOrani, matrah: 0, kdv: 0, brut: 0 };
    mevcut.matrah += s.matrah;
    mevcut.kdv += s.kdvTutar;
    mevcut.brut += s.satirToplam;
    dilimHaritasi.set(s.kdvOrani, mevcut);
  }
  const kdvDagilimi = [...dilimHaritasi.values()].sort((a, b) => a.oran - b.oran);

  return { satirlar, araToplam, iskontoToplam, kdvToplam, genelToplam, kdvDagilimi };
}

// ---------------------------------------------------------------------------
// Ödeme
// ---------------------------------------------------------------------------

export interface OdemeGirdisi {
  tip: OdemeTipi;
  /** Satışa mahsup edilen tutar. */
  tutar: Kurus;
  /** Yalnız NAKIT'te: müşterinin verdiği tutar. Boşsa `tutar` kabul edilir. */
  alinan?: Kurus;
}

export interface OdemeSonucu {
  gecerli: boolean;
  odenenToplam: Kurus;
  /** genelToplam − ödenen. Pozitifse eksik ödeme var. */
  kalan: Kurus;
  paraUstu: Kurus;
  hata?: 'ODEME_EKSIK' | 'ODEME_FAZLA' | 'ALINAN_YETERSIZ' | 'NEGATIF_TUTAR';
}

/**
 * Ödeme satırlarını doğrular ve para üstünü hesaplar.
 *
 * Kural: mahsup edilen tutarların toplamı genel toplama **eşit** olmalıdır.
 * Nakitte müşterinin verdiği (`alinan`) daha fazla olabilir; fark para üstüdür.
 */
export function odemeDogrula(genelToplam: Kurus, odemeler: readonly OdemeGirdisi[]): OdemeSonucu {
  let odenenToplam = 0;
  let paraUstu = 0;

  for (const o of odemeler) {
    if (o.tutar < 0 || (o.alinan !== undefined && o.alinan < 0)) {
      return { gecerli: false, odenenToplam: 0, kalan: genelToplam, paraUstu: 0, hata: 'NEGATIF_TUTAR' };
    }
    odenenToplam += o.tutar;
    if (o.tip === 'NAKIT') {
      const alinan = o.alinan ?? o.tutar;
      if (alinan < o.tutar) {
        return { gecerli: false, odenenToplam, kalan: genelToplam - odenenToplam, paraUstu: 0, hata: 'ALINAN_YETERSIZ' };
      }
      paraUstu += alinan - o.tutar;
    }
  }

  const kalan = genelToplam - odenenToplam;
  if (kalan > 0) return { gecerli: false, odenenToplam, kalan, paraUstu, hata: 'ODEME_EKSIK' };
  if (kalan < 0) return { gecerli: false, odenenToplam, kalan, paraUstu, hata: 'ODEME_FAZLA' };
  return { gecerli: true, odenenToplam, kalan: 0, paraUstu };
}

/** Satışın baskın ödeme tipi — rapor kırılımı ve fiş üzerinde gösterim için. */
export function baskinOdemeTipi(odemeler: readonly OdemeGirdisi[]): OdemeTipi | 'PARCALI' {
  const tipler = new Set(odemeler.map((o) => o.tip));
  if (tipler.size === 0) return 'NAKIT';
  if (tipler.size > 1) return 'PARCALI';
  return [...tipler][0] as OdemeTipi;
}

// ---------------------------------------------------------------------------
// Kampanya (§10.3, §11.8)
// ---------------------------------------------------------------------------

export interface KampanyaTanimi {
  id: string;
  tip: KampanyaTipi;
  kapsam: KampanyaKapsami;
  hedefId: string | null;
  /**
   * YUZDE → indirim yüzdesi · TUTAR → indirim kuruşu · SABIT_FIYAT → yeni birim fiyat
   * N_AL_M_ODE → ödenen adet · KADEMELI_FIYAT → eşik sonrası birim fiyat
   */
  deger: number;
  /**
   * Miktar kampanyalarının eşiği, BİNDEBİR cinsinden (3 adet → 3000).
   * Miktar birimiyle aynı ölçekte tutulur ki KG kampanyası da yazılabilsin.
   */
  esikMiktar?: number;
  baslangic: string;
  bitis: string;
  aktifMi: boolean;
  oncelik?: number;
}

export interface KampanyaHedefi {
  urunId: string;
  kategoriId: string | null;
}

export function kampanyaGecerliMi(k: KampanyaTanimi, zaman: string): boolean {
  return k.aktifMi && k.baslangic <= zaman && zaman <= k.bitis;
}

export function kampanyaUrunuKapsiyorMu(k: KampanyaTanimi, hedef: KampanyaHedefi): boolean {
  switch (k.kapsam) {
    case 'TUM':
      return true;
    case 'URUN':
      return k.hedefId === hedef.urunId;
    case 'KATEGORI':
      return k.hedefId !== null && k.hedefId === hedef.kategoriId;
    default:
      return false;
  }
}

/**
 * Ürüne uygulanacak kampanya fiyatını bulur.
 * Birden fazla kampanya uyuyorsa **müşteri lehine en düşük fiyat** kazanır;
 * eşitlikte `oncelik` yüksek olan seçilir.
 */
export function kampanyaFiyatiBul(
  temelFiyat: Kurus,
  hedef: KampanyaHedefi,
  kampanyalar: readonly KampanyaTanimi[],
  zaman: string,
): { fiyat: Kurus; kampanyaId: string | null } {
  let enIyiFiyat = temelFiyat;
  let enIyiId: string | null = null;
  let enIyiOncelik = -Infinity;

  for (const k of kampanyalar) {
    if (!kampanyaGecerliMi(k, zaman) || !kampanyaUrunuKapsiyorMu(k, hedef)) continue;
    // Miktar kampanyaları burada DEĞİL, satır iskontosu olarak uygulanır.
    if (miktarKampanyasiMi(k.tip)) continue;

    let aday: Kurus;
    switch (k.tip) {
      case 'YUZDE':
        aday = temelFiyat - yuzdeUygula(temelFiyat, k.deger);
        break;
      case 'TUTAR':
        aday = temelFiyat - Math.round(k.deger);
        break;
      case 'SABIT_FIYAT':
        aday = Math.round(k.deger);
        break;
      default:
        continue;
    }
    aday = Math.max(0, aday);
    const oncelik = k.oncelik ?? 0;
    if (aday < enIyiFiyat || (aday === enIyiFiyat && enIyiId !== null && oncelik > enIyiOncelik)) {
      enIyiFiyat = aday;
      enIyiId = k.id;
      enIyiOncelik = oncelik;
    }
  }

  return { fiyat: enIyiFiyat, kampanyaId: enIyiId };
}

/**
 * Miktara bağlı kampanyanın SATIR İSKONTOSUNU hesaplar (§10.8).
 *
 * NEDEN İSKONTO, BİRİM FİYAT DEĞİL: "3 al 2 öde"de indirim miktara bağlıdır ve
 * kademelidir (3'te 1, 6'da 2 bedava). Bunu birim fiyata gömmek 6,666… gibi
 * bölünemez bir sayı üretir, kuruş yuvarlaması satır toplamını tutturmaz ve
 * fişte müşteri neyin bedava geldiğini göremez. İskonto olarak yazınca hem
 * kuruş tam olur hem fişte "3 al 2 öde −10,00" satırı görünür.
 *
 * En ÇOK indirim veren kampanya kazanır; eşitlikte önceliği yüksek olan.
 */
export function miktarKampanyasiIskontosu(
  birimFiyat: Kurus,
  miktar: Miktar,
  birimTipi: BirimTipi,
  hedef: KampanyaHedefi,
  kampanyalar: readonly KampanyaTanimi[],
  zaman: string,
): { iskonto: Kurus; kampanyaId: string | null } {
  let enIyi = 0;
  let enIyiId: string | null = null;
  let enIyiOncelik = -Infinity;

  for (const k of kampanyalar) {
    if (!kampanyaGecerliMi(k, zaman) || !kampanyaUrunuKapsiyorMu(k, hedef)) continue;
    const esik = k.esikMiktar ?? 0;
    if (esik <= 0) continue;

    let aday = 0;
    switch (k.tip) {
      case 'N_AL_M_ODE': {
        /*
         * Yalnız ADET üründe: "3 kg al 2 kg öde" markette kullanılan bir ifade
         * değildir ve yarım kilo bedava vermek anlamsızdır.
         */
        if (birimTipi !== 'ADET') continue;
        const alinan = Math.floor(esik / MIKTAR_OLCEK);
        const odenen = Math.floor(k.deger);
        if (alinan <= 0 || odenen < 0 || odenen >= alinan) continue;

        const adet = Math.floor(miktar / MIKTAR_OLCEK);
        const bedava = Math.floor(adet / alinan) * (alinan - odenen);
        aday = bedava * birimFiyat;
        break;
      }
      case 'KADEMELI_FIYAT': {
        const yeniFiyat = Math.round(k.deger);
        if (miktar < esik || yeniFiyat < 0 || yeniFiyat >= birimFiyat) continue;
        // İndirim TÜM miktara uygulanır; eşiği geçen müşteri hepsini ucuz alır.
        aday = yuvarla((miktar * (birimFiyat - yeniFiyat)) / MIKTAR_OLCEK);
        break;
      }
      default:
        continue;
    }

    if (aday <= 0) continue;
    const oncelik = k.oncelik ?? 0;
    if (aday > enIyi || (aday === enIyi && oncelik > enIyiOncelik)) {
      enIyi = aday;
      enIyiId = k.id;
      enIyiOncelik = oncelik;
    }
  }

  return { iskonto: enIyi, kampanyaId: enIyiId };
}

/** Bu kampanya miktara mı bağlı? Birim fiyat motoruyla karışmasın diye. */
export function miktarKampanyasiMi(tip: KampanyaTipi): boolean {
  return tip === 'N_AL_M_ODE' || tip === 'KADEMELI_FIYAT';
}

// ---------------------------------------------------------------------------
// Kâr / marj (§14)
// ---------------------------------------------------------------------------

export interface KarHesabi {
  /** KDV hariç satış tutarı. */
  matrah: Kurus;
  /** KDV hariç maliyet. */
  maliyet: Kurus;
  brutKar: Kurus;
  /** Yüzde marj (matraha göre). Matrah 0 ise 0. */
  marjYuzde: number;
}

export function karHesapla(matrah: Kurus, birimMaliyet: Kurus, miktar: Miktar): KarHesabi {
  const maliyet = yuvarla((miktar * birimMaliyet) / MIKTAR_OLCEK);
  const brutKar = matrah - maliyet;
  const marjYuzde = matrah === 0 ? 0 : Math.round((brutKar / matrah) * 10000) / 100;
  return { matrah, maliyet, brutKar, marjYuzde };
}

/** Satış fiyatından (KDV dahil) hedeflenen kâr marjını verir. */
export function marjHesapla(alisFiyatiNet: Kurus, satisFiyatiBrut: Kurus, kdvOrani: number): number {
  const { matrah } = kdvAyir(satisFiyatiBrut, kdvOrani);
  if (matrah <= 0) return 0;
  return Math.round(((matrah - alisFiyatiNet) / matrah) * 10000) / 100;
}

/** Hedef marja göre KDV dahil satış fiyatı önerir (toplu fiyatlama için). */
export function marjdanFiyat(alisFiyatiNet: Kurus, hedefMarjYuzde: number, kdvOrani: number): Kurus {
  const bolen = 1 - hedefMarjYuzde / 100;
  if (bolen <= 0) throw new RangeError('Marj %100 veya üzeri olamaz');
  const matrah = yuvarla(alisFiyatiNet / bolen);
  return matrah + yuzdeUygula(matrah, kdvOrani);
}

// ---------------------------------------------------------------------------
// Stok / cari değişmezleri
// ---------------------------------------------------------------------------

/**
 * Stok miktarı hareketlerin toplamıdır — asla üzerine yazılmaz (§7.4 altın kural).
 * Bu fonksiyon o kuralın tek referans uygulamasıdır; testler buna dayanır.
 */
export function stokTopla(hareketler: readonly { miktar: Miktar }[]): Miktar {
  return hareketler.reduce((t, h) => t + h.miktar, 0);
}

/** Cari bakiye hareketlerin toplamıdır. Pozitif = bizden alacaklı olduğumuz (müşteri borcu). */
export function cariBakiyeTopla(hareketler: readonly { tutar: Kurus }[]): Kurus {
  return hareketler.reduce((t, h) => t + h.tutar, 0);
}

/** Kredi limiti kontrolü (§10.7). `limit === 0` → limitsiz. */
export function limitAsimi(
  mevcutBakiye: Kurus,
  eklenecek: Kurus,
  krediLimiti: Kurus,
): { asiyor: boolean; yeniBakiye: Kurus; asimTutari: Kurus } {
  const yeniBakiye = mevcutBakiye + eklenecek;
  if (krediLimiti <= 0) return { asiyor: false, yeniBakiye, asimTutari: 0 };
  const asimTutari = yeniBakiye - krediLimiti;
  return { asiyor: asimTutari > 0, yeniBakiye, asimTutari: Math.max(0, asimTutari) };
}

/** Beklenen kasa nakdi = açılış + nakit etkili hareketlerin toplamı (§10.8). */
export function beklenenNakit(acilisBakiye: Kurus, nakitHareketler: readonly { tutar: Kurus }[]): Kurus {
  return acilisBakiye + nakitHareketler.reduce((t, h) => t + h.tutar, 0);
}

/** Kasa farkı = sayılan − beklenen. Negatif = kasa açığı. */
export function kasaFarki(sayilanNakit: Kurus, beklenen: Kurus): Kurus {
  return sayilanNakit - beklenen;
}

// ---------------------------------------------------------------------------
// Cari yaşlandırma (§11.6)
// ---------------------------------------------------------------------------

export const YASLANDIRMA_DILIMLERI = [0, 30, 60, 90] as const;

export interface YaslandirmaSatiri {
  dilim: string;
  tutar: Kurus;
}

export function yaslandir(hareketler: readonly { tutar: Kurus; gun: number }[]): YaslandirmaSatiri[] {
  const dilimler: YaslandirmaSatiri[] = [
    { dilim: '0-30', tutar: 0 },
    { dilim: '31-60', tutar: 0 },
    { dilim: '61-90', tutar: 0 },
    { dilim: '90+', tutar: 0 },
  ];
  for (const h of hareketler) {
    const i = h.gun <= 30 ? 0 : h.gun <= 60 ? 1 : h.gun <= 90 ? 2 : 3;
    const hedef = dilimler[i];
    if (hedef) hedef.tutar += h.tutar;
  }
  return dilimler;
}

// ---------------------------------------------------------------------------
// Çakışma çözümü (§7.4)
// ---------------------------------------------------------------------------

/**
 * Last-Write-Wins karşılaştırması. Eşit `updated_at` durumunda `cihaz_id`
 * sözlük sırası ile deterministik olarak çözülür (aynı girdi → aynı sonuç,
 * her iki tarafta da).
 */
export function lwwKazanan<T extends { updated_at: string; cihaz_id?: string | null }>(
  a: T,
  b: T,
): { kazanan: T; kaybeden: T; cakisma: boolean } {
  if (a.updated_at > b.updated_at) return { kazanan: a, kaybeden: b, cakisma: true };
  if (a.updated_at < b.updated_at) return { kazanan: b, kaybeden: a, cakisma: true };
  const ac = a.cihaz_id ?? '';
  const bc = b.cihaz_id ?? '';
  if (ac === bc) return { kazanan: a, kaybeden: b, cakisma: false };
  return ac > bc ? { kazanan: a, kaybeden: b, cakisma: true } : { kazanan: b, kaybeden: a, cakisma: true };
}
