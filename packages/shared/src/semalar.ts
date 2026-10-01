/**
 * Zod şemaları — alan adları veritabanı sütunlarıyla birebir aynıdır (snake_case),
 * böylece satır → nesne dönüşümünde eşleme hatası oluşmaz. Blueprint §7.3'teki
 * JSON örnekleri de snake_case olduğundan API sözleşmesi ile de birebir uyumludur.
 *
 * Aynı şema üç yerde de kullanılır (masaüstü, API, panel) — tek gerçeklik (§5.4).
 */

import { z } from 'zod';
import {
  ALIS_FATURA_DURUMU,
  BIRIM_TIPI,
  CARI_HAREKET_TIPI,
  CARI_TIPI,
  FIRE_NEDENI,
  KAMPANYA_KAPSAMI,
  KAMPANYA_TIPI,
  KASA_HAREKET_TIPI,
  KASA_OTURUM_DURUMU,
  KDV_ORANLARI,
  ODEME_TIPI,
  ROL,
  SAYIM_DURUMU,
  STOK_HAREKET_TIPI,
} from './sabitler.js';
import { YETKILER } from './yetki.js';

// ---------------------------------------------------------------------------
// Temel yapı taşları
// ---------------------------------------------------------------------------

export const zUuid = z.string().uuid({ message: 'Geçersiz kimlik' });
export const zZaman = z.string().datetime({ offset: true, message: 'Geçersiz zaman damgası' });
export const zGun = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Geçersiz tarih (YYYY-AA-GG)');
/** Kuruş — tam sayı, negatif olabilir (iade/düzeltme). */
export const zKurus = z.number().int({ message: 'Tutar kuruş cinsinden tam sayı olmalıdır' });
export const zKurusPozitif = zKurus.nonnegative('Tutar negatif olamaz');
/** Miktar — bindebir hassasiyetinde tam sayı. */
export const zMiktar = z.number().int({ message: 'Miktar bindebir tam sayı olmalıdır' });
export const zKdvOrani = z
  .number()
  .refine((v) => (KDV_ORANLARI as readonly number[]).includes(v) || (v >= 0 && v <= 100), 'Geçersiz KDV oranı');
export const zYuzde = z.number().min(0).max(100);
export const zMetin = (azami: number) => z.string().trim().max(azami);
/*
 * Alt sınır 2'dir, 4 değil: barkodsuz ürünlere verilen KISA KOD (PLU) tipik
 * olarak iki hanedir (10-99). Manavda ezberlenen iki haneli kod, kasiyerin
 * ürün adı yazıp listeden seçmesini tamamen ortadan kaldırır — ölçümde
 * satılan kalemlerin %70'i bu barkodsuz yoldan geçiyordu (§10.1).
 *
 * Tek hane bilinçli olarak dışarıda: kazara tek tuşa basıp Enter'lamak
 * fazla kolaydır ve yanlış ürün sepete girer.
 */
export const zBarkod = z
  .string()
  .trim()
  .min(2, 'Barkod en az 2 karakter olmalıdır')
  .max(48)
  .regex(/^[0-9A-Za-z._-]+$/, 'Barkod yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir');

/** Tüm tablolarda ortak senkron/denetim alanları (§8). */
export const zOrtakAlanlar = z.object({
  id: zUuid,
  created_at: zZaman,
  updated_at: zZaman,
  cihaz_id: z.string().max(64).nullable().default(null),
});

// ---------------------------------------------------------------------------
// Katalog
// ---------------------------------------------------------------------------

export const zKategori = zOrtakAlanlar.extend({
  ad: zMetin(120).min(1, 'Kategori adı zorunludur'),
  ust_kategori_id: zUuid.nullable().default(null),
  sira: z.number().int().default(0),
  aktif_mi: z.boolean().default(true),
});
export type Kategori = z.infer<typeof zKategori>;

export const zUrun = zOrtakAlanlar.extend({
  ad: zMetin(200).min(1, 'Ürün adı zorunludur'),
  kategori_id: zUuid.nullable().default(null),
  marka: zMetin(120).nullable().default(null),
  birim_tipi: z.enum(BIRIM_TIPI).default('ADET'),
  /** KDV **hariç** birim maliyet. */
  alis_fiyati: zKurusPozitif.default(0),
  /** KDV **dahil** raf/satış fiyatı. */
  satis_fiyati: zKurusPozitif.default(0),
  kdv_orani: zKdvOrani.default(20),
  kritik_stok: zMiktar.default(0),
  ideal_stok: zMiktar.default(0),
  raf_konumu: zMetin(60).nullable().default(null),
  aktif_mi: z.boolean().default(true),
  varsayilan_tedarikci_id: zUuid.nullable().default(null),
  skt_takibi: z.boolean().default(false),
  notlar: zMetin(1000).nullable().default(null),
});
export type Urun = z.infer<typeof zUrun>;

// NOT: Alanların çoğu `.default(...)` taşıdığından girdide zaten opsiyoneldir.
// Ayrıca `.partial()` çağırmak varsayılanları devre dışı bırakır (ZodOptional,
// ZodDefault'u sarmalayıp atlar) — bu yüzden bilinçli olarak kullanılmıyor.
export const zUrunGirdi = zUrun.omit({ id: true, created_at: true, updated_at: true, cihaz_id: true }).extend({
  /** Ürünle birlikte kaydedilecek barkodlar. */
  barkodlar: z.array(z.object({ barkod: zBarkod, ambalaj_aciklamasi: zMetin(60).nullable().optional() })).default([]),
  /** Yeni üründe açılış stoğu (opsiyonel). */
  acilis_stogu: zMiktar.optional(),
});
export type UrunGirdi = z.infer<typeof zUrunGirdi>;

export const zBarkodKaydi = zOrtakAlanlar.extend({
  urun_id: zUuid,
  barkod: zBarkod,
  ambalaj_aciklamasi: zMetin(60).nullable().default(null),
  aktif_mi: z.boolean().default(true),
});
export type BarkodKaydi = z.infer<typeof zBarkodKaydi>;

// ---------------------------------------------------------------------------
// Stok
// ---------------------------------------------------------------------------

export const zStokHareketi = zOrtakAlanlar.extend({
  urun_id: zUuid,
  hareket_tipi: z.enum(STOK_HAREKET_TIPI),
  /** İşaretli miktar: satış/fire negatif, giriş/iade pozitif (§8.1). */
  miktar: zMiktar,
  /** KDV hariç birim maliyet — kâr hesabı bu alandan gelir. */
  birim_maliyet: zKurus.default(0),
  belge_id: zUuid.nullable().default(null),
  belge_tipi: zMetin(32).nullable().default(null),
  skt: zGun.nullable().default(null),
  lot_no: zMetin(60).nullable().default(null),
  neden_kodu: z.enum(FIRE_NEDENI).nullable().default(null),
  aciklama: zMetin(400).nullable().default(null),
  kullanici_id: zUuid.nullable().default(null),
});
export type StokHareketi = z.infer<typeof zStokHareketi>;

export const zStokGirisiGirdi = z.object({
  urun_id: zUuid,
  miktar: zMiktar.positive('Miktar sıfırdan büyük olmalıdır'),
  birim_maliyet: zKurusPozitif.default(0),
  skt: zGun.nullable().optional(),
  lot_no: zMetin(60).nullable().optional(),
  aciklama: zMetin(400).nullable().optional(),
});
export type StokGirisiGirdi = z.infer<typeof zStokGirisiGirdi>;

export const zFireGirdi = z.object({
  urun_id: zUuid,
  miktar: zMiktar.positive('Miktar sıfırdan büyük olmalıdır'),
  neden_kodu: z.enum(FIRE_NEDENI),
  aciklama: zMetin(400).nullable().optional(),
});
export type FireGirdi = z.infer<typeof zFireGirdi>;

export const zSayim = zOrtakAlanlar.extend({
  ad: zMetin(120),
  durum: z.enum(SAYIM_DURUMU).default('ACIK'),
  baslangic: zZaman,
  bitis: zZaman.nullable().default(null),
  kullanici_id: zUuid.nullable().default(null),
  notlar: zMetin(500).nullable().default(null),
});
export type Sayim = z.infer<typeof zSayim>;

export const zSayimSatiri = zOrtakAlanlar.extend({
  sayim_id: zUuid,
  urun_id: zUuid,
  sistem_miktari: zMiktar,
  sayilan_miktar: zMiktar,
  fark: zMiktar,
});
export type SayimSatiri = z.infer<typeof zSayimSatiri>;

// ---------------------------------------------------------------------------
// Satış
// ---------------------------------------------------------------------------

export const zSatisKalemi = zOrtakAlanlar.extend({
  satis_id: zUuid,
  urun_id: zUuid,
  /** Satış anındaki ürün adı — ürün sonradan değişse bile fiş/rapor bozulmaz. */
  urun_adi: zMetin(200),
  barkod: z.string().max(48).nullable().default(null),
  miktar: zMiktar,
  birim_tipi: z.enum(BIRIM_TIPI).default('ADET'),
  birim_fiyat: zKurus,
  /** Satış anındaki KDV hariç birim maliyet (kâr raporu için dondurulur). */
  birim_maliyet: zKurus.default(0),
  iskonto: zKurus.default(0),
  kdv_orani: zKdvOrani,
  kdv_tutar: zKurus.default(0),
  satir_toplam: zKurus,
  kampanya_id: zUuid.nullable().default(null),
  sira: z.number().int().default(0),
});
export type SatisKalemi = z.infer<typeof zSatisKalemi>;

export const zOdeme = zOrtakAlanlar.extend({
  satis_id: zUuid,
  odeme_tipi: z.enum(ODEME_TIPI),
  tutar: zKurus,
  alinan: zKurus.default(0),
  para_ustu: zKurus.default(0),
});
export type Odeme = z.infer<typeof zOdeme>;

export const zSatis = zOrtakAlanlar.extend({
  fis_no: zMetin(32),
  tarih: zZaman,
  kullanici_id: zUuid.nullable().default(null),
  kasa_oturum_id: zUuid.nullable().default(null),
  ara_toplam: zKurus,
  iskonto_toplam: zKurus.default(0),
  kdv_toplam: zKurus.default(0),
  genel_toplam: zKurus,
  /** Baskın ödeme tipi ya da PARCALI. */
  odeme_ozeti: z.string().max(16),
  musteri_id: zUuid.nullable().default(null),
  iptal_mi: z.boolean().default(false),
  iptal_neden: zMetin(300).nullable().default(null),
  iptal_zamani: zZaman.nullable().default(null),
  iade_mi: z.boolean().default(false),
  /** İade ise kaynak satış. */
  kaynak_satis_id: zUuid.nullable().default(null),
  fis_yazdirildi: z.boolean().default(false),
  notlar: zMetin(500).nullable().default(null),
});
export type Satis = z.infer<typeof zSatis>;

/** Satış ekranından gelen kesinleştirme girdisi. */
export const zSatisGirdi = z.object({
  kalemler: z
    .array(
      z.object({
        urun_id: zUuid,
        /**
         * Fişte görünecek ad. Yalnız "muhtelif" kaleminde kullanılır: tek bir
         * Muhtelif ürün kaydına yazılan satırların fişte ve raporda ayırt
         * edilebilmesi için (§10.3). Verilmezse ürün kartındaki ad kullanılır.
         */
        urun_adi: zMetin(120).optional(),
        barkod: z.string().max(48).nullable().optional(),
        miktar: zMiktar.refine((v) => v !== 0, 'Miktar sıfır olamaz'),
        birim_fiyat: zKurus,
        iskonto_yuzde: zYuzde.optional(),
        iskonto_tutar: zKurus.optional(),
        kampanya_id: zUuid.nullable().optional(),
      }),
    )
    .min(1, 'Sepet boş olamaz'),
  odemeler: z
    .array(
      z.object({
        tip: z.enum(ODEME_TIPI),
        tutar: zKurus,
        alinan: zKurus.optional(),
        /** POS entegrasyonunda kart çekiminin onay kodu, işlem referansı ve maskeli kartı. */
        pos_onay_kodu: zMetin(40).nullable().optional(),
        pos_referans: zMetin(80).nullable().optional(),
        pos_kart: zMetin(40).nullable().optional(),
      }),
    )
    .min(1, 'En az bir ödeme satırı gereklidir'),
  musteri_id: zUuid.nullable().optional(),
  notlar: zMetin(500).nullable().optional(),
  /** Kredi limiti aşımını yetkili onayladıysa. */
  limit_asimi_onaylandi: z.boolean().optional(),
  /** Negatif stoğa düşülmesini yetkili onayladıysa. */
  negatif_stok_onaylandi: z.boolean().optional(),
});
export type SatisGirdi = z.infer<typeof zSatisGirdi>;

export const zIadeGirdi = z.object({
  kaynak_satis_id: zUuid,
  kalemler: z
    .array(
      z.object({
        satis_kalemi_id: zUuid,
        miktar: zMiktar.positive('İade miktarı sıfırdan büyük olmalıdır'),
      }),
    )
    .min(1, 'En az bir kalem seçilmelidir'),
  /** İade bedelinin nasıl geri verildiği. */
  iade_yontemi: z.enum(ODEME_TIPI),
  /**
   * Cari hesaba iadede müşteri — yalnız orijinal satış MÜŞTERİSİZ ise
   * kullanılır (perakende alışverişin iadesi borçtan düşülebilsin). Satışın
   * müşterisi varsa iade yalnız ona yazılır.
   */
  musteri_id: zUuid.optional(),
  neden: zMetin(300),
});
export type IadeGirdi = z.infer<typeof zIadeGirdi>;

export const zAskidakiSatis = zOrtakAlanlar.extend({
  etiket: zMetin(60),
  kullanici_id: zUuid.nullable().default(null),
  /** Sepet anlık görüntüsü (JSON). */
  veri: z.string(),
});
export type AskidakiSatis = z.infer<typeof zAskidakiSatis>;

// ---------------------------------------------------------------------------
// Cari
// ---------------------------------------------------------------------------

export const zCari = zOrtakAlanlar.extend({
  tip: z.enum(CARI_TIPI),
  ad_unvan: zMetin(200).min(1, 'Ad / unvan zorunludur'),
  telefon: zMetin(32).nullable().default(null),
  eposta: zMetin(120).nullable().default(null),
  adres: zMetin(500).nullable().default(null),
  vergi_dairesi: zMetin(120).nullable().default(null),
  vergi_no: zMetin(32).nullable().default(null),
  kredi_limiti: zKurusPozitif.default(0),
  vade_gun: z.number().int().min(0).max(365).default(0),
  notlar: zMetin(1000).nullable().default(null),
  aktif_mi: z.boolean().default(true),
  /** KVKK anonimleştirme uygulandıysa (§16.2). */
  anonimlestirildi_mi: z.boolean().default(false),
  /** SMS/WhatsApp/e-posta gönderimi için açık rıza kaydı (§16.1). */
  iletisim_rizasi: z.boolean().default(false),
  iletisim_rizasi_zamani: zZaman.nullable().default(null),
});
export type Cari = z.infer<typeof zCari>;

export const zCariHareketi = zOrtakAlanlar.extend({
  cari_id: zUuid,
  hareket_tipi: z.enum(CARI_HAREKET_TIPI),
  /** İşaretli tutar: borç +, tahsilat/ödeme − (§8.1). */
  tutar: zKurus,
  aciklama: zMetin(400).nullable().default(null),
  belge_id: zUuid.nullable().default(null),
  belge_tipi: zMetin(32).nullable().default(null),
  tarih: zZaman,
  vade_tarihi: zGun.nullable().default(null),
  kullanici_id: zUuid.nullable().default(null),
});
export type CariHareketi = z.infer<typeof zCariHareketi>;

export const zTahsilatGirdi = z.object({
  cari_id: zUuid,
  tutar: zKurus.positive('Tutar sıfırdan büyük olmalıdır'),
  odeme_tipi: z.enum(['NAKIT', 'KART'] as const),
  aciklama: zMetin(400).nullable().optional(),
  /**
   * Borçtan FAZLA tahsilat/ödeme yapılacağının bilinçli onayı (§10.7).
   *
   * Varsayılan davranış para üstüdür: müşteri 100 uzatır, borcu 87'yse 87
   * tahsil edilir ve 13 geri verilir. Fazlasının hesapta ALACAK olarak
   * kalması ancak bu bayrakla mümkündür; aksi hâlde yuvarlak para veren her
   * müşteri farkında olmadan hesabı alacaklıya düşürürdü.
   */
  avans_kabul: z.boolean().optional().default(false),
});
export type TahsilatGirdi = z.infer<typeof zTahsilatGirdi>;

// ---------------------------------------------------------------------------
// Kasa / vardiya
// ---------------------------------------------------------------------------

export const zKasaOturumu = zOrtakAlanlar.extend({
  kullanici_id: zUuid,
  acilis_zamani: zZaman,
  acilis_bakiye: zKurus.default(0),
  kapanis_zamani: zZaman.nullable().default(null),
  sayilan_nakit: zKurus.nullable().default(null),
  beklenen_nakit: zKurus.nullable().default(null),
  kasa_farki: zKurus.nullable().default(null),
  durum: z.enum(KASA_OTURUM_DURUMU).default('ACIK'),
  notlar: zMetin(500).nullable().default(null),
});
export type KasaOturumu = z.infer<typeof zKasaOturumu>;

export const zKasaHareketi = zOrtakAlanlar.extend({
  kasa_oturum_id: zUuid,
  tip: z.enum(KASA_HAREKET_TIPI),
  tutar: zKurus,
  aciklama: zMetin(400).nullable().default(null),
  belge_id: zUuid.nullable().default(null),
  kullanici_id: zUuid.nullable().default(null),
});
export type KasaHareketi = z.infer<typeof zKasaHareketi>;

// ---------------------------------------------------------------------------
// Alış (mal kabul)
// ---------------------------------------------------------------------------

export const zAlisFaturasi = zOrtakAlanlar.extend({
  tedarikci_id: zUuid,
  fatura_no: zMetin(60).nullable().default(null),
  tarih: zZaman,
  ara_toplam: zKurus.default(0),
  kdv_toplam: zKurus.default(0),
  genel_toplam: zKurus.default(0),
  durum: z.enum(ALIS_FATURA_DURUMU).default('TASLAK'),
  vade_tarihi: zGun.nullable().default(null),
  notlar: zMetin(500).nullable().default(null),
  kullanici_id: zUuid.nullable().default(null),
});
export type AlisFaturasi = z.infer<typeof zAlisFaturasi>;

export const zAlisKalemi = zOrtakAlanlar.extend({
  alis_faturasi_id: zUuid,
  urun_id: zUuid,
  miktar: zMiktar,
  /** KDV hariç birim alış fiyatı. */
  birim_fiyat: zKurus,
  kdv_orani: zKdvOrani,
  satir_toplam: zKurus,
  skt: zGun.nullable().default(null),
  lot_no: zMetin(60).nullable().default(null),
});
export type AlisKalemi = z.infer<typeof zAlisKalemi>;

/**
 * Faturada açılacak YENİ ürün (§11.8).
 *
 * Toptancıdan gelen malın çoğu katalogda yoktur. Kalem ya mevcut bir ürüne
 * (`urun_id`) ya da burada tarif edilen yeni ürüne bağlanır; ürünü de belgeyi
 * de KASA üretir, böylece ikisi tek transaction'da doğar.
 */
export const zYeniUrunKalemi = z.object({
  ad: zMetin(200).min(1, 'Ürün adı zorunludur'),
  barkod: zBarkod.nullable().optional(),
  marka: zMetin(120).nullable().optional(),
  birim_tipi: z.enum(BIRIM_TIPI).default('ADET'),
  kategori_id: zUuid.nullable().default(null),
  /** KDV **dahil** raf fiyatı. Alış fiyatı kalemin `birim_fiyat` alanından gelir. */
  satis_fiyati: zKurusPozitif,
  kritik_stok: zMiktar.optional(),
  /*
   * Mal kabul satırından ürün kartı formu açılınca girilebilen ayrıntılar.
   * Hepsi opsiyoneldir: eski kasa/panel sürümleri göndermez, ürün yine açılır.
   */
  raf_konumu: zMetin(60).nullable().optional(),
  skt_takibi: z.boolean().optional(),
  notlar: zMetin(500).nullable().optional(),
  /** Ana barkoda EK barkodlar (farklı ambalaj, kısa kod/PLU). */
  ek_barkodlar: z.array(zBarkod).max(10).optional(),
});
export type YeniUrunKalemi = z.infer<typeof zYeniUrunKalemi>;

export const zAlisGirdi = z.object({
  tedarikci_id: zUuid,
  fatura_no: zMetin(60).nullable().optional(),
  tarih: zZaman.optional(),
  vade_tarihi: zGun.nullable().optional(),
  notlar: zMetin(500).nullable().optional(),
  /**
   * Mal kabulde yapılan peşin ödeme (kuruş). 0 = tamamı borç.
   * Kısmi ödeme desteklenir: kalan tutar tedarikçi cari borcu olarak kalır.
   */
  odenen_tutar: zKurusPozitif.default(0),
  /** Peşin ödeme NAKIT ise kasadan da düşülür; KART/HAVALE yalnız cariyi kapatır. */
  odeme_tipi: z.enum(['NAKIT', 'KART', 'HAVALE'] as const).default('NAKIT'),
  kalemler: z
    .array(
      z
        .object({
          urun_id: zUuid.optional(),
          yeni_urun: zYeniUrunKalemi.optional(),
          miktar: zMiktar.positive('Miktar sıfırdan büyük olmalıdır'),
          birim_fiyat: zKurusPozitif,
          kdv_orani: zKdvOrani,
          skt: zGun.nullable().optional(),
          lot_no: zMetin(60).nullable().optional(),
          /** Doluysa MEVCUT ürünün satış fiyatı da güncellenir. */
          yeni_satis_fiyati: zKurusPozitif.optional(),
          /*
           * MEVCUT ürüne bu faturada kaydedilecek barkod.
           *
           * Sahadaki en sık karışıklık: ürün katalogda vardır ama elindeki
           * ambalajın barkodu kartına kayıtlı değildir. Okutulunca "bulunamadı"
           * der, kullanıcı da mükerrer ürün açar. Bu alan, kalemi mevcut ürüne
           * bağlarken okutulan barkodu o ürüne eklemeyi sağlar — aynı barkod
           * bir daha sorulmaz. Barkod başka bir üründeyse mal kabul reddeder.
           */
          barkod_ekle: zBarkod.optional(),
        })
        .refine((k) => Boolean(k.urun_id) !== Boolean(k.yeni_urun), {
          message: 'Kalem ya mevcut bir ürüne ya da yeni bir ürüne bağlı olmalıdır',
        })
        /*
         * Yeni üründe `yeni_satis_fiyati` KABUL EDİLMEZ.
         *
         * Yeni ürünün raf fiyatı zaten `yeni_urun.satis_fiyati`dır. İkisi
         * birlikte gönderilirse mal kabul döngüsü, az önce açtığı ürünün
         * fiyatını OLAY YAZMADAN eziyordu: kasada yeni fiyat, bulutta eski
         * fiyat kalıyor ve iki taraf sessizce ayrışıyordu.
         */
        .refine((k) => !(k.yeni_urun && k.yeni_satis_fiyati !== undefined), {
          message: 'Yeni üründe satış fiyatı `yeni_urun.satis_fiyati` ile verilir; `yeni_satis_fiyati` kullanılamaz',
        })
        .refine((k) => !(k.yeni_urun && k.barkod_ekle !== undefined), {
          message: 'Yeni üründe barkod `yeni_urun.barkod` ile verilir; `barkod_ekle` yalnız mevcut ürün içindir',
        }),
    )
    .min(1, 'En az bir kalem gereklidir')
    // Tek transaction'da yazılıyor: kazara yapıştırılan devasa liste kasayı kilitlemesin.
    .max(200, 'Tek belgede en fazla 200 kalem girilebilir'),
});
export type AlisGirdi = z.infer<typeof zAlisGirdi>;

/**
 * Tedarikçiye mal iadesi: bozuk/yanlış gelen mal geri gönderilir.
 * Stok düşer; karşılığı ya tedarikçi cari borcundan düşülür ya da
 * tedarikçinin o an ödediği nakit olarak kasaya girer.
 */
export const zTedarikciIadeGirdi = z.object({
  tedarikci_id: zUuid,
  /** CARIDEN_DUS: borçtan düşülür (varsayılan). NAKIT: tedarikçi parayı iade etti, kasaya girer. */
  odeme_sekli: z.enum(['CARIDEN_DUS', 'NAKIT'] as const).default('CARIDEN_DUS'),
  neden: zMetin(400).nullable().optional(),
  notlar: zMetin(500).nullable().optional(),
  kalemler: z
    .array(
      z.object({
        urun_id: zUuid,
        miktar: zMiktar.positive('Miktar sıfırdan büyük olmalıdır'),
        /** KDV hariç birim fiyat — alış faturasındaki değerle aynı düzlemde. */
        birim_fiyat: zKurusPozitif,
        kdv_orani: zKdvOrani,
      }),
    )
    .min(1, 'En az bir kalem gereklidir'),
});
export type TedarikciIadeGirdi = z.infer<typeof zTedarikciIadeGirdi>;

// ---------------------------------------------------------------------------
// Kullanıcı / kampanya / ayar
// ---------------------------------------------------------------------------

export const zKullanici = zOrtakAlanlar.extend({
  ad: zMetin(120).min(1, 'Ad zorunludur'),
  kullanici_adi: z
    .string()
    .trim()
    .min(3, 'Kullanıcı adı en az 3 karakter olmalıdır')
    .max(60)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Kullanıcı adı yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir'),
  pin_hash: z.string().nullable().default(null),
  sifre_hash: z.string().nullable().default(null),
  rol: z.enum(ROL).default('KASIYER'),
  ek_yetkiler: z.array(z.enum(YETKILER)).default([]),
  kaldirilan_yetkiler: z.array(z.enum(YETKILER)).default([]),
  aktif_mi: z.boolean().default(true),
  son_giris: zZaman.nullable().default(null),
  hatali_giris: z.number().int().default(0),
  kilit_bitis: zZaman.nullable().default(null),
});
export type Kullanici = z.infer<typeof zKullanici>;

/** Şifre/PIN hash'i asla arayüze ya da loga çıkmaz (§15.1). */
export const zKullaniciGuvenli = zKullanici.omit({ pin_hash: true, sifre_hash: true });
export type KullaniciGuvenli = z.infer<typeof zKullaniciGuvenli>;

export const zKampanya = zOrtakAlanlar.extend({
  ad: zMetin(120).min(1),
  tip: z.enum(KAMPANYA_TIPI),
  kapsam: z.enum(KAMPANYA_KAPSAMI),
  hedef_id: zUuid.nullable().default(null),
  deger: z.number(),
  baslangic: zZaman,
  bitis: zZaman,
  oncelik: z.number().int().default(0),
  aktif_mi: z.boolean().default(true),
});
export type Kampanya = z.infer<typeof zKampanya>;

export const zAyar = z.object({
  anahtar: z.string().min(1).max(120),
  deger: z.string(),
  aciklama: z.string().max(300).nullable().default(null),
  updated_at: zZaman,
});
export type Ayar = z.infer<typeof zAyar>;

// ---------------------------------------------------------------------------
// Özet / rollup (§8.2)
// ---------------------------------------------------------------------------

export const zGunlukOzet = z.object({
  tarih: zGun,
  cihaz_id: z.string().max(64),
  ciro: zKurus,
  iade_toplam: zKurus,
  iptal_toplam: zKurus,
  islem_sayisi: z.number().int(),
  nakit: zKurus,
  kart: zKurus,
  veresiye: zKurus,
  tahsilat: zKurus,
  gider: zKurus,
  brut_kar: zKurus,
  kdv_toplam: zKurus,
  updated_at: zZaman,
});
export type GunlukOzet = z.infer<typeof zGunlukOzet>;

export const zUrunSatisOzet = z.object({
  urun_id: zUuid,
  donem: zGun,
  cihaz_id: z.string().max(64),
  adet: zMiktar,
  ciro: zKurus,
  kar: zKurus,
  updated_at: zZaman,
});
export type UrunSatisOzet = z.infer<typeof zUrunSatisOzet>;

// ---------------------------------------------------------------------------
// Denetim (§8.3)
// ---------------------------------------------------------------------------

export const zDenetimKaydi = z.object({
  id: zUuid,
  kullanici_id: zUuid.nullable(),
  islem: z.string().max(80),
  entity: z.string().max(60),
  entity_id: z.string().max(64).nullable(),
  eski_deger: z.string().nullable(),
  yeni_deger: z.string().nullable(),
  zaman: zZaman,
  cihaz_id: z.string().max(64).nullable(),
  ip: z.string().max(64).nullable().default(null),
});
export type DenetimKaydi = z.infer<typeof zDenetimKaydi>;
