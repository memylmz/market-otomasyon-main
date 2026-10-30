/**
 * Müşteri ekranı (çift ekranlı POS'un müşteriye dönük ikinci ekranı).
 *
 * Ekranın üç hâli vardır:
 *  - BEKLEME: kasada satış yokken. Karşılama (market adı, logo, "Hoş geldiniz")
 *    ve ayarlardan sıraya dizilen reklamlar/kampanyalar döner.
 *  - SEPET: ilk ürün okutulduğu anda reklam kesilir, sepet TAM EKRAN görünür.
 *  - TEŞEKKÜR: satış kesinleşince birkaç saniye ödenen tutar ve para üstü,
 *    sonra yine bekleme.
 *
 * Bu dosya çalışma zamanından bağımsızdır: ayarların biçimi (Zod şeması),
 * kampanyadan slayt metni üretimi ve ekranın durum makinesi burada yaşar; ana
 * süreç ve müşteri penceresi aynı kurallarla çalışır, birbirinden ayrışamaz.
 *
 * GİZLİLİK (KVKK): müşteri ekranına giden sepet görüntüsünde seçili cari
 * müşterinin adı, borcu ve satış notu YOKTUR — arkadaki kişi görür.
 */

import { z } from 'zod';
import { BIRIM_KISALTMA, MIKTAR_OLCEK, type Miktar } from './miktar.js';
import { paraFormat, yuzdeUygula, type Kurus } from './para.js';
import type { BirimTipi, KampanyaKapsami, KampanyaTipi } from './sabitler.js';

// ---------------------------------------------------------------------------
// Ayarlar
// ---------------------------------------------------------------------------

/**
 * Müşteri ekranı ayar anahtarları. Hepsi CİHAZA ÖZELDİR (merkezî ayar listesinde
 * yoktur, buluta gitmez): reklam dosyaları bu bilgisayarın diskinde durur ve
 * hangi monitörün müşteriye baktığı her kasada farklıdır.
 */
export const MUSTERI_EKRANI_AYAR = {
  /** '1' açık, '0' kapalı. */
  ACIK: 'musteri_ekrani.acik',
  /** `EKRAN_SECIMI` ya da Electron ekran kimliği (sayı, metin olarak). */
  EKRAN: 'musteri_ekrani.ekran',
  KARSILAMA_METNI: 'musteri_ekrani.karsilama_metni',
  KARSILAMA_ALT_METNI: 'musteri_ekrani.karsilama_alt_metni',
  /** Logo dosyasının medya adı; boşsa logo yok. */
  LOGO: 'musteri_ekrani.logo',
  TESEKKUR_METNI: 'musteri_ekrani.tesekkur_metni',
  TESEKKUR_SN: 'musteri_ekrani.tesekkur_sn',
  /** Yayın listesi — `musteriSlaytlariSemasi` biçiminde JSON. */
  SLAYTLAR: 'musteri_ekrani.slaytlar',
} as const;

/** Müşteri ekranı ayarı mı? Kayıttan sonra ekranın yenilenip yenilenmeyeceğine karar verir. */
export function musteriEkraniAyariMi(anahtar: string): boolean {
  return anahtar.startsWith('musteri_ekrani.');
}

/**
 * Ekran seçimi: OTOMATIK birincil olmayan ilk monitörü alır (çift ekranlı
 * POS'ta doğru olan budur). PENCERE gerçek ikinci ekran olmadan denemek için
 * birincil ekranda normal bir pencere açar.
 */
export const EKRAN_SECIMI = { OTOMATIK: 'OTOMATIK', PENCERE: 'PENCERE' } as const;

export const MUSTERI_EKRANI_VARSAYILAN = {
  KARSILAMA_METNI: 'Hoş geldiniz',
  KARSILAMA_ALT_METNI: '',
  TESEKKUR_METNI: 'Bizi tercih ettiğiniz için teşekkür ederiz',
  TESEKKUR_SN: 6,
  SLAYT_SN: 8,
} as const;

export const SLAYT_TIPI = ['KARSILAMA', 'KAMPANYALAR', 'URUN', 'DUYURU', 'GORSEL', 'VIDEO'] as const;
export type SlaytTipi = (typeof SLAYT_TIPI)[number];

/** Şablon renkleri. Müşteri ekranı bunları kendi paletine çevirir. */
export const SLAYT_TEMASI = ['YESIL', 'KIRMIZI', 'TURUNCU', 'MAVI', 'MOR', 'KOYU'] as const;
export type SlaytTemasi = (typeof SLAYT_TEMASI)[number];

export const SLAYT_TEMA_ETIKETI: Record<SlaytTemasi, string> = {
  YESIL: 'Yeşil',
  KIRMIZI: 'Kırmızı',
  TURUNCU: 'Turuncu',
  MAVI: 'Mavi',
  MOR: 'Mor',
  KOYU: 'Koyu',
};

export const SLAYT_TIP_ETIKETI: Record<SlaytTipi, string> = {
  KARSILAMA: 'Karşılama',
  KAMPANYALAR: 'Aktif kampanyalar (otomatik)',
  URUN: 'Ürün fiyatı',
  DUYURU: 'Duyuru',
  GORSEL: 'Görsel / GIF',
  VIDEO: 'Video',
};

/**
 * Medya dosyası adı. Adı ana süreç üretir (uuid + uzantı); şemada da aynı
 * kalıp istenir ki ayara elle yazılmış `../../x` gibi bir yol müşteri
 * penceresine dosya sunduramasın.
 */
export const MEDYA_ADI_KALIBI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp|mp4|webm)$/;

export function medyaAdiGecerliMi(ad: string): boolean {
  return MEDYA_ADI_KALIBI.test(ad);
}

export const MAKS_SLAYT = 40;
/** Otomatik kampanya slaytı üst sınırı — yayın listesi kampanyalara boğulmasın. */
export const MAKS_KAMPANYA_SLAYTI = 20;

const medyaAdi = z.string().regex(MEDYA_ADI_KALIBI, 'Geçersiz medya dosyası.');
const sureSn = z.number().int().min(3, 'Slayt süresi en az 3 saniye.').max(120, 'Slayt süresi en çok 120 saniye.');
const tema = z.enum(SLAYT_TEMASI);
const ortak = {
  id: z.string().min(1).max(64),
  aktif: z.boolean(),
};

export const musteriSlaytiSemasi = z.discriminatedUnion('tip', [
  z.object({ ...ortak, tip: z.literal('KARSILAMA'), sure_sn: sureSn }),
  /** Yer tutucu: oynatılırken o an geçerli her kampanya için bir slayt üretilir. */
  z.object({ ...ortak, tip: z.literal('KAMPANYALAR'), sure_sn: sureSn }),
  /** Ürün fiyat kartı. Fiyat kayıtta durmaz, her gösterimde katalogdan okunur. */
  z.object({
    ...ortak,
    tip: z.literal('URUN'),
    urun_id: z.string().min(1, 'Ürün fiyatı slaytı için ürün seçilmelidir.').max(64),
    baslik: z.string().trim().max(40),
    tema,
    sure_sn: sureSn,
  }),
  z.object({
    ...ortak,
    tip: z.literal('DUYURU'),
    baslik: z.string().trim().min(1, 'Duyuru başlığı boş olamaz.').max(60),
    metin: z.string().trim().max(200),
    tema,
    sure_sn: sureSn,
  }),
  z.object({ ...ortak, tip: z.literal('GORSEL'), dosya: medyaAdi, ad: z.string().max(120), sure_sn: sureSn }),
  /** Video sonuna kadar oynar; süre alanı yoktur. */
  z.object({ ...ortak, tip: z.literal('VIDEO'), dosya: medyaAdi, ad: z.string().max(120) }),
]);
export type MusteriSlayti = z.infer<typeof musteriSlaytiSemasi>;

export const musteriSlaytlariSemasi = z
  .array(musteriSlaytiSemasi)
  .max(MAKS_SLAYT, `En fazla ${MAKS_SLAYT} slayt eklenebilir.`)
  .refine((liste) => new Set(liste.map((s) => s.id)).size === liste.length, 'Slayt kimlikleri tekrarlanamaz.');

/** İlk kurulumdaki yayın listesi: karşılama ve (varsa) kampanyalar. */
export function varsayilanSlaytlar(): MusteriSlayti[] {
  const sure = MUSTERI_EKRANI_VARSAYILAN.SLAYT_SN;
  return [
    { id: 'karsilama', tip: 'KARSILAMA', aktif: true, sure_sn: sure },
    { id: 'kampanyalar', tip: 'KAMPANYALAR', aktif: true, sure_sn: sure },
  ];
}

/**
 * Ayardaki JSON'u okur. Boşsa varsayılan liste döner; bozuksa da varsayılan —
 * müşteri ekranı bozuk bir ayar yüzünden kararmamalı. (Kayıt sırasında şema
 * zaten denetlenir; bozuk değer ancak elle müdahaleyle oluşur.)
 */
export function slaytlariCoz(json: string | null | undefined): MusteriSlayti[] {
  if (!json || !json.trim()) return varsayilanSlaytlar();
  const sonuc = slaytlariDogrula(json);
  return sonuc.gecerli ? sonuc.slaytlar : varsayilanSlaytlar();
}

/** Ayar kaydında kullanılır: geçersizse okunur Türkçe mesaj döner. */
export function slaytlariDogrula(json: string): { gecerli: true; slaytlar: MusteriSlayti[] } | { gecerli: false; mesaj: string } {
  let ham: unknown;
  try {
    ham = JSON.parse(json);
  } catch {
    return { gecerli: false, mesaj: 'Müşteri ekranı yayın listesi okunamadı.' };
  }
  const sonuc = musteriSlaytlariSemasi.safeParse(ham);
  if (sonuc.success) return { gecerli: true, slaytlar: sonuc.data };
  const ilk = sonuc.error.issues[0];
  return { gecerli: false, mesaj: `Müşteri ekranı yayın listesi geçersiz: ${ilk?.message ?? 'bilinmeyen hata'}` };
}

/** Slaytların kullandığı medya dosyaları (logo hariç) — yetim dosya temizliği için. */
export function slaytMedyalari(slaytlar: readonly MusteriSlayti[]): string[] {
  return slaytlar.flatMap((s) => (s.tip === 'GORSEL' || s.tip === 'VIDEO' ? [s.dosya] : []));
}

// ---------------------------------------------------------------------------
// Müşteri penceresine giden görüntü
// ---------------------------------------------------------------------------

/** Fiyat kartı — hem otomatik kampanya hem "Ürün fiyatı" şablonu bunu üretir. */
export interface FiyatKarti {
  /** Üstteki küçük başlık ("Haftanın Fırsatı", kampanya adı); boş olabilir. */
  ust: string;
  /** Büyük yazı: ürün adı ya da kapsam ("Tüm Süt ürünlerinde"). */
  ad: string;
  /** Köşe rozeti ("%20 İNDİRİM", "3 AL 2 ÖDE"); yoksa null. */
  rozet: string | null;
  /** Gösterilecek fiyat ("24,90 ₺"); kategori/genel indirimde null. */
  fiyat: string | null;
  /** Üstü çizili eski fiyat; indirim yoksa null. */
  eskiFiyat: string | null;
  /** Fiyatın birimi ("/kg"); adet üründe null. */
  birim: string | null;
  /** Alt açıklama ("3 alana 1 bedava"). */
  alt: string | null;
  tema: SlaytTemasi;
}

export type EkranSlayti =
  | { anahtar: string; tip: 'KARSILAMA'; sureMs: number }
  | { anahtar: string; tip: 'FIYAT'; sureMs: number; kart: FiyatKarti }
  | { anahtar: string; tip: 'DUYURU'; sureMs: number; baslik: string; metin: string; tema: SlaytTemasi }
  | { anahtar: string; tip: 'GORSEL'; sureMs: number; url: string }
  /** `sureMs` burada üst sınırdır: video bitmezse/takılırsa yine geçilir. */
  | { anahtar: string; tip: 'VIDEO'; sureMs: number; url: string };

/** Video takılırsa (bozuk dosya, sürücü sorunu) en geç bu kadar sonra geçilir. */
export const VIDEO_UST_SINIR_MS = 5 * 60_000;

export interface MusteriEkraniYapilandirmasi {
  isletmeAdi: string;
  karsilamaMetni: string;
  karsilamaAltMetni: string;
  logoUrl: string | null;
  tesekkurMetni: string;
  tesekkurMs: number;
  /** Yalnız AKTİF ve gösterilebilir slaytlar, oynatma sırasıyla. */
  slaytlar: EkranSlayti[];
}

/** Sepetin müşteriye görünen satırı. Para kuruş, miktar bindebir. */
export interface MusteriSepetSatiri {
  anahtar: string;
  ad: string;
  miktar: Miktar;
  birimTipi: BirimTipi;
  birimFiyat: Kurus;
  /** Kampanya öncesi liste fiyatı (birim fiyattan yüksekse üstü çizili gösterilir). */
  listeFiyati: Kurus;
  /** Satırın ödenecek tutarı (iskonto düşülmüş). */
  tutar: Kurus;
  /** Satıra düşen iskonto (kampanya ya da elle). */
  iskonto: Kurus;
}

export interface MusteriSepeti {
  satirlar: MusteriSepetSatiri[];
  /** Büyük gösterilecek, en son okutulan/arttırılan satır. */
  sonAnahtar: string | null;
  genelToplam: Kurus;
  /** Müşterinin bu alışverişteki kazancı: liste fiyatıyla ödenenin farkı. */
  kazanc: Kurus;
}

export const musteriSepetiSemasi = z.object({
  satirlar: z
    .array(
      z.object({
        anahtar: z.string().max(64),
        ad: z.string().max(200),
        miktar: z.number().int(),
        birimTipi: z.enum(['ADET', 'KG', 'LT']),
        birimFiyat: z.number().int(),
        listeFiyati: z.number().int(),
        tutar: z.number().int(),
        iskonto: z.number().int(),
      }),
    )
    .max(1000),
  sonAnahtar: z.string().max(64).nullable(),
  genelToplam: z.number().int(),
  kazanc: z.number().int(),
});

/** Bilgisayara bağlı bir monitör (Ayarlar → Müşteri Ekranı'ndaki seçim listesi). */
export interface EkranBilgisi {
  /** Electron ekran kimliği, metin olarak (ayar değeri budur). */
  id: string;
  ad: string;
  genislik: number;
  yukseklik: number;
  birincil: boolean;
  /** Kasa uygulamasının ana penceresi bu ekranda mı? */
  kasaEkrani: boolean;
}

export interface MusteriEkraniDurumu {
  acik: boolean;
  /** Ayardaki seçim: OTOMATIK, PENCERE ya da ekran kimliği. */
  secim: string;
  ekranlar: EkranBilgisi[];
  pencereAcik: boolean;
  /** Müşteri penceresinin açık olduğu ekran; PENCERE kipinde ve kapalıyken null. */
  hedefEkranId: string | null;
  /** Kullanıcıya gösterilecek tek cümlelik durum. */
  mesaj: string;
}

/** Ana süreçten müşteri penceresine giden mesajlar. */
export type MusteriEkraniMesaji =
  | { tur: 'YAPILANDIRMA'; yapilandirma: MusteriEkraniYapilandirmasi }
  | { tur: 'SEPET'; sepet: MusteriSepeti }
  | { tur: 'TAMAMLANDI'; genelToplam: Kurus; paraUstu: Kurus };

export const BOS_MUSTERI_SEPETI: MusteriSepeti = { satirlar: [], sonAnahtar: null, genelToplam: 0, kazanc: 0 };

/**
 * Hangi satır büyük gösterilsin? Yeni eklenen ya da miktarı ARTAN satır.
 *
 * Kasiyerin seçili satırı kullanılmaz: kasiyer ok tuşlarıyla listede gezinince
 * müşterinin ekranı da oynardı. Değişiklik yoksa (fiyat/iskonto düzeltmesi,
 * silme) öncekini korur; o da silinmişse son satıra düşer.
 */
export function sonDegisenSatir(
  onceki: readonly Pick<MusteriSepetSatiri, 'anahtar' | 'miktar'>[],
  yeni: readonly Pick<MusteriSepetSatiri, 'anahtar' | 'miktar'>[],
  oncekiSon: string | null,
): string | null {
  if (yeni.length === 0) return null;
  const eski = new Map(onceki.map((s) => [s.anahtar, s.miktar]));
  // Sondan başa: aynı anda birden fazla değişiklik varsa en alttaki kazanır.
  for (let i = yeni.length - 1; i >= 0; i--) {
    const s = yeni[i]!;
    const o = eski.get(s.anahtar);
    if (o === undefined || s.miktar > o) return s.anahtar;
  }
  if (oncekiSon && yeni.some((s) => s.anahtar === oncekiSon)) return oncekiSon;
  return yeni[yeni.length - 1]!.anahtar;
}

/** Müşterinin kazancı: liste fiyatıyla ödenenin farkı (satır başına asla negatif değil). */
export function sepetKazanci(satirlar: readonly Pick<MusteriSepetSatiri, 'miktar' | 'listeFiyati' | 'tutar'>[]): Kurus {
  let toplam = 0;
  for (const s of satirlar) {
    const liste = Math.round((s.miktar * s.listeFiyati) / MIKTAR_OLCEK);
    toplam += Math.max(0, liste - s.tutar);
  }
  return toplam;
}

// ---------------------------------------------------------------------------
// Kampanya → fiyat kartı
// ---------------------------------------------------------------------------

export interface KampanyaSlaytGirdisi {
  ad: string;
  tip: KampanyaTipi;
  kapsam: KampanyaKapsami;
  deger: number;
  /** Bindebir (3 adet → 3000). */
  esikMiktar: number | null;
}

export type KampanyaSlaytHedefi =
  | { kapsam: 'URUN'; ad: string; listeFiyati: Kurus; birimTipi: BirimTipi }
  | { kapsam: 'KATEGORI'; ad: string }
  | { kapsam: 'TUM' };

const KAMPANYA_TEMASI: Record<KampanyaTipi, SlaytTemasi> = {
  YUZDE: 'KIRMIZI',
  TUTAR: 'KIRMIZI',
  SABIT_FIYAT: 'TURUNCU',
  N_AL_M_ODE: 'MOR',
  KADEMELI_FIYAT: 'MAVI',
};

function birimEki(birim: BirimTipi): string | null {
  return birim === 'ADET' ? null : `/${BIRIM_KISALTMA[birim]}`;
}

function miktarYazisi(bindebir: number): string {
  return (bindebir / MIKTAR_OLCEK).toLocaleString('tr-TR', { maximumFractionDigits: 3 });
}

function kapsamAdi(hedef: KampanyaSlaytHedefi, onEk: string): string {
  if (hedef.kapsam === 'URUN') return hedef.ad;
  if (hedef.kapsam === 'KATEGORI') return `${onEk} ${hedef.ad} ürünlerinde`;
  return `${onEk} ürünlerde`;
}

/**
 * Bir kampanyayı müşteri ekranı kartına çevirir. Anlamlı bir kart
 * çıkarılamıyorsa (fiyatı düşmeyen ürün, bozuk eşik) null döner ve slayt atlanır.
 *
 * Fiyat kartta saklanmaz, her seferinde katalogdan hesaplanır: elle yapılmış
 * bir afişte fiyat değişince eski fiyat ekranda kalırdı ve müşteri kasada
 * "ekranda 25 lira yazıyordu" derdi.
 */
export function kampanyaFiyatKarti(k: KampanyaSlaytGirdisi, hedef: KampanyaSlaytHedefi): FiyatKarti | null {
  const urun = hedef.kapsam === 'URUN' ? hedef : null;
  const kart = (alanlar: Partial<FiyatKarti> & Pick<FiyatKarti, 'ad' | 'rozet'>): FiyatKarti => ({
    ust: k.ad.trim() || 'Kampanya',
    tema: KAMPANYA_TEMASI[k.tip],
    fiyat: null,
    eskiFiyat: null,
    birim: null,
    alt: null,
    ...alanlar,
  });
  /** Ürün kapsamında indirimli fiyat ve üstü çizili liste fiyatı. */
  const urunFiyati = (yeni: Kurus): Partial<FiyatKarti> => {
    if (!urun) return {};
    const fiyat = Math.max(0, yeni);
    return {
      fiyat: paraFormat(fiyat),
      eskiFiyat: fiyat < urun.listeFiyati ? paraFormat(urun.listeFiyati) : null,
      birim: birimEki(urun.birimTipi),
    };
  };

  switch (k.tip) {
    case 'YUZDE': {
      if (k.deger <= 0) return null;
      const yeni = urun ? urun.listeFiyati - yuzdeUygula(urun.listeFiyati, k.deger) : 0;
      return kart({
        ad: kapsamAdi(hedef, 'Tüm'),
        rozet: `%${k.deger.toLocaleString('tr-TR')} İNDİRİM`,
        ...urunFiyati(yeni),
      });
    }
    case 'TUTAR': {
      const indirim = Math.round(k.deger);
      if (indirim <= 0) return null;
      return kart({
        ad: kapsamAdi(hedef, 'Tüm'),
        rozet: `${paraFormat(indirim)} İNDİRİM`,
        ...urunFiyati(urun ? urun.listeFiyati - indirim : 0),
      });
    }
    case 'SABIT_FIYAT': {
      const fiyat = Math.round(k.deger);
      if (fiyat <= 0) return null;
      if (urun) {
        if (fiyat >= urun.listeFiyati) return null;
        return kart({ ad: urun.ad, rozet: 'KAMPANYA', ...urunFiyati(fiyat) });
      }
      return kart({ ad: kapsamAdi(hedef, 'Tüm'), rozet: 'TEK FİYAT', fiyat: paraFormat(fiyat) });
    }
    case 'N_AL_M_ODE': {
      const alinan = Math.floor((k.esikMiktar ?? 0) / MIKTAR_OLCEK);
      const odenen = Math.floor(k.deger);
      if (alinan <= 0 || odenen < 0 || odenen >= alinan) return null;
      return kart({
        ad: kapsamAdi(hedef, 'Seçili'),
        rozet: `${alinan} AL ${odenen} ÖDE`,
        fiyat: urun ? paraFormat(urun.listeFiyati) : null,
        alt: `${alinan} alana ${alinan - odenen} bedava`,
      });
    }
    case 'KADEMELI_FIYAT': {
      const esik = k.esikMiktar ?? 0;
      const yeni = Math.round(k.deger);
      if (esik <= 0 || yeni <= 0) return null;
      if (urun && yeni >= urun.listeFiyati) return null;
      const birim = urun && urun.birimTipi !== 'ADET' ? BIRIM_KISALTMA[urun.birimTipi] : 'adet';
      return kart({
        ad: kapsamAdi(hedef, 'Seçili'),
        rozet: 'ÇOK AL AZ ÖDE',
        ...(urun ? urunFiyati(yeni) : { fiyat: paraFormat(yeni) }),
        alt: `${miktarYazisi(esik)} ${birim} ve üzeri alımda`,
      });
    }
    default:
      return null;
  }
}

/** "Ürün fiyatı" şablonundan kart: kampanyalı fiyat varsa eski fiyat üstü çizili. */
export function urunFiyatKarti(
  slayt: { baslik: string; tema: SlaytTemasi },
  urun: { ad: string; listeFiyati: Kurus; fiyat: Kurus; birimTipi: BirimTipi },
): FiyatKarti {
  const indirimli = urun.fiyat < urun.listeFiyati;
  return {
    ust: slayt.baslik.trim(),
    ad: urun.ad,
    rozet: indirimli ? 'İNDİRİMDE' : null,
    fiyat: paraFormat(urun.fiyat),
    eskiFiyat: indirimli ? paraFormat(urun.listeFiyati) : null,
    birim: birimEki(urun.birimTipi),
    alt: null,
    tema: slayt.tema,
  };
}

// ---------------------------------------------------------------------------
// Ekran durum makinesi
// ---------------------------------------------------------------------------

export type EkranModu = 'BEKLEME' | 'SEPET' | 'TESEKKUR';

export interface EkranDurumu {
  mod: EkranModu;
  sepet: MusteriSepeti | null;
  tesekkur: { genelToplam: Kurus; paraUstu: Kurus; bitis: number } | null;
}

export type EkranOlayi =
  | { tur: 'SEPET'; sepet: MusteriSepeti }
  | { tur: 'TAMAMLANDI'; genelToplam: Kurus; paraUstu: Kurus; zaman: number; sureMs: number }
  | { tur: 'SAAT'; zaman: number };

export const BASLANGIC_EKRAN_DURUMU: EkranDurumu = { mod: 'BEKLEME', sepet: null, tesekkur: null };

/**
 * Durum makinesi. Kurallar:
 *  - Dolu sepet her zaman SEPET'e geçirir — teşekkür ekranındayken sıradaki
 *    müşterinin ilk ürünü okutulursa teşekkür beklemeden kesilir.
 *  - Boş sepet teşekkürü KESMEZ: satış kesinleşince kasa sepeti hemen boşaltır;
 *    o boşaltma teşekkür ekranını silmemeli.
 *  - Teşekkür süresi dolunca bekleme. Satış iptal edilir / sepet boşaltılırsa
 *    (teşekkür yoksa) doğrudan bekleme.
 */
export function ekranDurumuIlerle(durum: EkranDurumu, olay: EkranOlayi): EkranDurumu {
  switch (olay.tur) {
    case 'SEPET':
      if (olay.sepet.satirlar.length > 0) return { mod: 'SEPET', sepet: olay.sepet, tesekkur: null };
      return durum.mod === 'TESEKKUR' ? durum : BASLANGIC_EKRAN_DURUMU;
    case 'TAMAMLANDI':
      return {
        mod: 'TESEKKUR',
        sepet: null,
        tesekkur: { genelToplam: olay.genelToplam, paraUstu: olay.paraUstu, bitis: olay.zaman + olay.sureMs },
      };
    case 'SAAT':
      return durum.tesekkur && olay.zaman >= durum.tesekkur.bitis ? BASLANGIC_EKRAN_DURUMU : durum;
  }
}

/**
 * Yayın listesi değişince (ayar kaydı, kampanya bitti) oynayan slayt
 * korunabiliyorsa korunur; yoksa baştan başlanır. Her güncellemede başa dönmek
 * dakikada bir yapılan yenilemede ilk slaytın hep tekrar etmesi demekti.
 */
export function slaytSirasiKoru(eskiAnahtar: string | null, yeni: readonly { anahtar: string }[]): number {
  if (!eskiAnahtar) return 0;
  const i = yeni.findIndex((s) => s.anahtar === eskiAnahtar);
  return i < 0 ? 0 : i;
}
