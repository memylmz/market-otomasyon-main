/**
 * Satış sepeti durumu.
 *
 * Tutar hesabı paylaşılan `sepetHesapla` ile **arayüzde anlık** yapılır
 * (barkod → satır ≤100 ms hedefi, §3.1). Kesinleştirmede ana süreç aynı saf
 * fonksiyonla yeniden hesaplar; arayüzün sayısına güvenilmez (§15.4).
 */

import { create } from 'zustand';
import {
  adet,
  kampanyaFiyatiBul,
  miktarBirimeUyarla,
  miktarKampanyasiIskontosu,
  sepetHesapla,
  simdi,
  uuid,
  type BirimTipi,
  type KampanyaTanimi,
  type Kurus,
  type Miktar,
  type SepetHesap,
  type SatirGirdi,
} from '@market/shared';

export interface SepetSatiri {
  anahtar: string;
  urunId: string;
  ad: string;
  barkod: string | null;
  /** Kategori kapsamlı kampanyalar için (§10.8). */
  kategoriId?: string | null;
  birimTipi: BirimTipi;
  miktar: Miktar;
  birimFiyat: Kurus;
  /** Kampanya öncesi liste fiyatı — arayüzde üstü çizili gösterilir. */
  listeFiyati: Kurus;
  kdvOrani: number;
  iskontoYuzde?: number;
  iskontoTutar?: Kurus;
  kampanyaId: string | null;
  stok: Miktar;
  /**
   * Muhtelif kalemde kasiyerin yazdığı serbest ad. Doluysa fişe ve rapora bu
   * yazılır; tüm muhtelif satırlar tek bir ürün kaydına bağlandığı için ayırt
   * edici tek bilgi budur (§10.3).
   */
  ozelAd?: string;
}

export interface EklenecekUrun {
  urunId: string;
  ad: string;
  barkod: string | null;
  /** Kategori kapsamlı kampanyaların eşleşmesi için taşınır (§10.8). */
  kategoriId?: string | null;
  birimTipi: BirimTipi;
  birimFiyat: Kurus;
  listeFiyati: Kurus;
  kdvOrani: number;
  kampanyaId: string | null;
  stok: Miktar;
  ozelAd?: string;
}

/**
 * Bekleyen (aktif olmayan) bir sepetin tam anlık görüntüsü.
 * Eski "askıya alma" diyaloğunun yerini görünür sepet sekmeleri aldı:
 * kasiyer "+ Sepet" ile yeni sepet açar, sekmeler arasında kayıpsız geçer.
 */
export interface BekleyenSepet {
  ad: string;
  satirlar: SepetSatiri[];
  seciliAnahtar: string | null;
  musteriId: string | null;
  musteriAdi: string | null;
  notlar: string;
}

/** Sepetlerin diske yazılabilir hâli. Fonksiyon içermez. */
export interface SepetAnlik {
  satirlar: SepetSatiri[];
  seciliAnahtar: string | null;
  musteriId: string | null;
  musteriAdi: string | null;
  notlar: string;
  sepetAdi: string;
  bekleyenler: BekleyenSepet[];
  sonSepetNo: number;
}

interface SepetDurumu {
  satirlar: SepetSatiri[];
  seciliAnahtar: string | null;
  musteriId: string | null;
  musteriAdi: string | null;
  notlar: string;

  /** Aktif sepetin görünen adı ("Sepet 1"). */
  sepetAdi: string;
  /** Aktif olmayan sepetler. */
  bekleyenler: BekleyenSepet[];
  /** Bugüne kadar verilmiş en büyük sepet numarası (adlandırma için). */
  sonSepetNo: number;

  ekle: (urun: EklenecekUrun, miktar?: Miktar) => string;
  miktarAyarla: (anahtar: string, miktar: Miktar) => void;
  miktarArtir: (anahtar: string, delta: Miktar) => void;
  fiyatAyarla: (anahtar: string, fiyat: Kurus) => void;
  satirIskontosu: (anahtar: string, yuzde?: number, tutar?: Kurus) => void;
  sil: (anahtar: string) => void;
  sec: (anahtar: string | null) => void;
  seciliyiKaydir: (yon: 1 | -1) => void;
  musteriSec: (id: string | null, ad: string | null) => void;
  notAyarla: (not: string) => void;
  temizle: () => void;
  /** Tüm sepetleri atar (çıkışta vardiya devri). */
  tumunuSifirla: () => void;
  hesap: () => SepetHesap;
  bosMu: () => boolean;

  /** Yeni boş sepet açar; mevcut sepet bekleyenlere alınır. */
  sepetEkle: () => void;
  /** Bekleyen bir sepeti aktifleştirir; aktif olan bekleyenlere geçer. */
  sepetSec: (ad: string) => void;
  /** Sepeti kapatır (içeriği atılır). Aktif kapanırsa sıradaki bekleyen açılır. */
  sepetKapat: (ad: string) => void;
  /** Ödeme tamamlanınca: aktif sepet kapanır, varsa bekleyen sepete geçilir. */
  satisSonrasi: () => void;

  /** Etkin kampanyalar — miktar bazlı indirim satırda anlık hesaplanır (§10.8). */
  kampanyalar: KampanyaTanimi[];
  kampanyalariAyarla: (liste: KampanyaTanimi[]) => void;

  /** Diske yazılacak kurtarma anlık görüntüsü (§10.3). */
  anlikGoruntu: () => SepetAnlik;
  /** Kurtarma noktasından geri yükler. Yalnız her şey boşken çağrılmalıdır. */
  geriYukle: (anlik: SepetAnlik) => void;
}

/**
 * Satır girdileri — miktar kampanyası burada uygulanır (§10.8).
 *
 * Kampanya indirimi SATIR İSKONTOSUDUR, birim fiyat değil: "3 al 2 öde"de
 * indirim miktara bağlı ve kademelidir; birim fiyata gömmek kuruş
 * yuvarlamasını bozar ve müşteri fişte neyin bedava geldiğini göremez.
 *
 * ELLE VERİLEN İSKONTO ÖNCELİKLİ: kasiyer bilerek indirim yazdıysa kampanya
 * devreye girmez. Sunucu aynı kuralı bağımsız olarak tekrar uygular.
 */
function satirGirdileri(satirlar: SepetSatiri[], kampanyalar: KampanyaTanimi[] = []): SatirGirdi[] {
  const zaman = simdi();
  return satirlar.map((s) => {
    const elle = Boolean(s.iskontoYuzde) || Boolean(s.iskontoTutar);
    const kampanya =
      elle || kampanyalar.length === 0
        ? 0
        : miktarKampanyasiIskontosu(
            s.birimFiyat,
            s.miktar,
            s.birimTipi,
            { urunId: s.urunId, kategoriId: s.kategoriId ?? null },
            kampanyalar,
            zaman,
          ).iskonto;

    return {
      miktar: s.miktar,
      birimFiyat: s.birimFiyat,
      kdvOrani: s.kdvOrani,
      iskontoYuzde: s.iskontoYuzde,
      iskontoTutar: elle ? s.iskontoTutar : kampanya || undefined,
    };
  });
}

/** Aktif sepetin alanlarını bekleyen paket biçiminde toplar. */
function aktifPaket(s: SepetDurumu): BekleyenSepet {
  return {
    ad: s.sepetAdi,
    satirlar: s.satirlar,
    seciliAnahtar: s.seciliAnahtar,
    musteriId: s.musteriId,
    musteriAdi: s.musteriAdi,
    notlar: s.notlar,
  };
}

/** Bekleyen paketi aktif sepet alanlarına açar. */
function paketiAc(p: BekleyenSepet) {
  return {
    sepetAdi: p.ad,
    satirlar: p.satirlar,
    seciliAnahtar: p.seciliAnahtar,
    musteriId: p.musteriId,
    musteriAdi: p.musteriAdi,
    notlar: p.notlar,
  };
}

const BOS_SEPET = {
  satirlar: [] as SepetSatiri[],
  seciliAnahtar: null,
  musteriId: null,
  musteriAdi: null,
  notlar: '',
};

export const sepetDurumu = create<SepetDurumu>((set, get) => ({
  satirlar: [],
  seciliAnahtar: null,
  musteriId: null,
  musteriAdi: null,
  notlar: '',
  sepetAdi: 'Sepet 1',
  bekleyenler: [],
  sonSepetNo: 1,

  ekle: (urun, miktar) => {
    const eklenecek = miktarBirimeUyarla(miktar ?? adet(1), urun.birimTipi);
    let anahtar = '';

    set((s) => {
      // Aynı ürün + aynı fiyat zaten sepetteyse miktarı artır (barkod tekrar okutma).
      const mevcut = s.satirlar.find(
        (x) =>
          x.urunId === urun.urunId &&
          x.birimFiyat === urun.birimFiyat &&
          // Muhtelif satırlarda ad da eşleşmeli: "Pil 25₺" ile "Gazete 25₺"
          // aynı ürün kaydına bağlı olsa da tek satırda toplanmamalı.
          x.ozelAd === urun.ozelAd &&
          !x.iskontoYuzde &&
          !x.iskontoTutar,
      );
      if (mevcut) {
        anahtar = mevcut.anahtar;
        return {
          satirlar: s.satirlar.map((x) => (x.anahtar === mevcut.anahtar ? { ...x, miktar: x.miktar + eklenecek } : x)),
          seciliAnahtar: mevcut.anahtar,
        };
      }
      anahtar = uuid();
      const yeni: SepetSatiri = {
        anahtar,
        urunId: urun.urunId,
        ad: urun.ad,
        barkod: urun.barkod,
        kategoriId: urun.kategoriId ?? null,
        birimTipi: urun.birimTipi,
        miktar: eklenecek,
        birimFiyat: urun.birimFiyat,
        listeFiyati: urun.listeFiyati,
        kdvOrani: urun.kdvOrani,
        kampanyaId: urun.kampanyaId,
        stok: urun.stok,
        ozelAd: urun.ozelAd,
      };
      return { satirlar: [...s.satirlar, yeni], seciliAnahtar: anahtar };
    });

    return anahtar;
  },

  miktarAyarla: (anahtar, miktar) =>
    set((s) => ({
      satirlar: s.satirlar.flatMap((x) => {
        if (x.anahtar !== anahtar) return [x];
        const yeni = miktarBirimeUyarla(miktar, x.birimTipi);
        // Miktar sıfıra düşerse satır silinir.
        return yeni <= 0 ? [] : [{ ...x, miktar: yeni }];
      }),
    })),

  miktarArtir: (anahtar, delta) => {
    const satir = get().satirlar.find((x) => x.anahtar === anahtar);
    if (satir) get().miktarAyarla(anahtar, satir.miktar + delta);
  },

  fiyatAyarla: (anahtar, fiyat) =>
    set((s) => ({ satirlar: s.satirlar.map((x) => (x.anahtar === anahtar ? { ...x, birimFiyat: Math.max(0, fiyat) } : x)) })),

  satirIskontosu: (anahtar, yuzde, tutar) =>
    set((s) => ({
      satirlar: s.satirlar.map((x) => (x.anahtar === anahtar ? { ...x, iskontoYuzde: yuzde, iskontoTutar: tutar } : x)),
    })),

  sil: (anahtar) =>
    set((s) => {
      const kalan = s.satirlar.filter((x) => x.anahtar !== anahtar);
      const secili = s.seciliAnahtar === anahtar ? (kalan[kalan.length - 1]?.anahtar ?? null) : s.seciliAnahtar;
      return { satirlar: kalan, seciliAnahtar: secili };
    }),

  sec: (anahtar) => set({ seciliAnahtar: anahtar }),

  seciliyiKaydir: (yon) =>
    set((s) => {
      if (s.satirlar.length === 0) return {};
      const mevcut = s.satirlar.findIndex((x) => x.anahtar === s.seciliAnahtar);
      const yeni =
        mevcut < 0 ? (yon === 1 ? 0 : s.satirlar.length - 1) : Math.min(Math.max(mevcut + yon, 0), s.satirlar.length - 1);
      return { seciliAnahtar: s.satirlar[yeni]?.anahtar ?? null };
    }),

  musteriSec: (id, ad) => set({ musteriId: id, musteriAdi: ad }),

  anlikGoruntu: () => {
    const d = get();
    return {
      satirlar: d.satirlar,
      seciliAnahtar: d.seciliAnahtar,
      musteriId: d.musteriId,
      musteriAdi: d.musteriAdi,
      notlar: d.notlar,
      sepetAdi: d.sepetAdi,
      bekleyenler: d.bekleyenler,
      sonSepetNo: d.sonSepetNo,
    };
  },

  geriYukle: (anlik) =>
    set({
      satirlar: anlik.satirlar ?? [],
      seciliAnahtar: anlik.seciliAnahtar ?? null,
      musteriId: anlik.musteriId ?? null,
      musteriAdi: anlik.musteriAdi ?? null,
      notlar: anlik.notlar ?? '',
      sepetAdi: anlik.sepetAdi ?? 'Sepet 1',
      bekleyenler: anlik.bekleyenler ?? [],
      sonSepetNo: anlik.sonSepetNo ?? 1,
    }),

  notAyarla: (not) => set({ notlar: not }),

  // Aktif sepeti boşaltır (içerik atılır); sepet sekmesi açık kalır.
  temizle: () => set({ ...BOS_SEPET }),

  sepetEkle: () =>
    set((s) => {
      const yeniNo = s.sonSepetNo + 1;
      return {
        bekleyenler: [...s.bekleyenler, aktifPaket(s)],
        sonSepetNo: yeniNo,
        ...BOS_SEPET,
        sepetAdi: `Sepet ${yeniNo}`,
      };
    }),

  sepetSec: (ad) =>
    set((s) => {
      if (ad === s.sepetAdi) return {};
      const hedef = s.bekleyenler.find((b) => b.ad === ad);
      if (!hedef) return {};
      // Aktif sepet, hedefin bulunduğu konuma yazılır: sekme sırası oynamaz.
      const bekleyenler = s.bekleyenler.map((b) => (b.ad === ad ? aktifPaket(s) : b));
      return { bekleyenler, ...paketiAc(hedef) };
    }),

  sepetKapat: (ad) =>
    set((s) => {
      if (ad !== s.sepetAdi) {
        const bekleyenler = s.bekleyenler.filter((b) => b.ad !== ad);
        // Tek sepet kaldıysa ve boşsa numarayı başa sar.
        if (bekleyenler.length === 0 && s.satirlar.length === 0) {
          return { bekleyenler, sonSepetNo: 1, sepetAdi: 'Sepet 1' };
        }
        return { bekleyenler };
      }
      // Aktif sepet kapanıyor: sıradaki bekleyen açılır, yoksa temiz "Sepet 1".
      const [ilk, ...kalan] = s.bekleyenler;
      if (ilk) return { bekleyenler: kalan, ...paketiAc(ilk) };
      return { bekleyenler: [], sonSepetNo: 1, ...BOS_SEPET, sepetAdi: 'Sepet 1' };
    }),

  /**
   * Tüm sepetleri atar ve baştan başlatır (§10.3 vardiya devri).
   *
   * Çıkışta çağrılır: sonraki kullanıcı öncekinin sepetlerini devralmasın.
   * `temizle` yalnız AKTİF sepeti boşaltır, bekleyenlere dokunmaz — bu ondan
   * farklı olarak hepsini siler.
   */
  tumunuSifirla: () => set({ bekleyenler: [], sonSepetNo: 1, ...BOS_SEPET, sepetAdi: 'Sepet 1' }),

  satisSonrasi: () => get().sepetKapat(get().sepetAdi),

  // Genel tutara indirim UYGULANMAZ (§10.3): yalnız satır iskontosu vardır.
  // `sepetHesapla` hâlâ sepet iskontosunu destekler, buradan beslenmez.
  kampanyalar: [],
  kampanyalariAyarla: (liste) => set({ kampanyalar: liste }),

  hesap: () => sepetHesapla(satirGirdileri(get().satirlar, get().kampanyalar)),

  bosMu: () => get().satirlar.length === 0,
}));

/**
 * Liste fiyatına etkin BİRİM FİYAT kampanyasını uygular (§10.8).
 *
 * Sepete ekleyen HER yol bunu kullanmalıdır. Daha önce yalnız barkod okutma
 * yolu kampanyayı uyguluyordu; hızlı ürün kareleri ve arama diyaloğu ham liste
 * fiyatını gönderiyordu. Sonuç sessiz bir hataydı: kampanya tanımlı olduğu
 * hâlde indirim uygulanmıyor, üstelik fiyat değiştirme yetkisi olan kullanıcıda
 * sunucu bunu "bilerek fiyat değiştirdi" sayıp kabul ediyordu.
 *
 * Miktar bazlı kampanyalar burada DEĞİL, satır iskontosu olarak uygulanır.
 */
export function kampanyaliFiyat(urun: { id: string; kategori_id?: string | null; satis_fiyati: Kurus }): {
  fiyat: Kurus;
  kampanyaId: string | null;
} {
  const kampanyalar = sepetDurumu.getState().kampanyalar;
  if (kampanyalar.length === 0) return { fiyat: urun.satis_fiyati, kampanyaId: null };
  return kampanyaFiyatiBul(urun.satis_fiyati, { urunId: urun.id, kategoriId: urun.kategori_id ?? null }, kampanyalar, simdi());
}

/** Sepeti ana sürecin beklediği satış girdisine çevirir. */
export function satisGirdisiOlustur(
  odemeler: { tip: 'NAKIT' | 'KART' | 'VERESIYE'; tutar: Kurus; alinan?: Kurus }[],
  ekler: { limitAsimiOnaylandi?: boolean; negatifStokOnaylandi?: boolean } = {},
): Record<string, unknown> {
  const s = sepetDurumu.getState();
  return {
    kalemler: s.satirlar.map((x) => ({
      urun_id: x.urunId,
      barkod: x.barkod,
      miktar: x.miktar,
      birim_fiyat: x.birimFiyat,
      urun_adi: x.ozelAd,
      iskonto_yuzde: x.iskontoYuzde,
      iskonto_tutar: x.iskontoTutar,
      kampanya_id: x.kampanyaId,
    })),
    odemeler: odemeler.map((o) => ({ tip: o.tip, tutar: o.tutar, alinan: o.alinan })),
    musteri_id: s.musteriId,
    notlar: s.notlar || undefined,
    limit_asimi_onaylandi: ekler.limitAsimiOnaylandi,
    negatif_stok_onaylandi: ekler.negatifStokOnaylandi,
  };
}
