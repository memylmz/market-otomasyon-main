/**
 * API sözleşmesi (§9) — istemci ve sunucu **aynı** şemayı kullanır.
 * CI'da sözleşme testi bu dosyaya dayanır (§9.3, §21.1).
 *
 * Tüm uçlar `/v1` önekiyle sürümlüdür; kırıcı değişiklik `/v2` ile yayınlanır.
 */

import { z } from 'zod';
import { OLAY_TIPI, PULL_VARLIKLARI, ROL, SEMA_SURUMU, SENKRON_PROTOKOL_SURUMU, SINIRLAR } from './sabitler.js';
import { zGun, zKurus, zMiktar, zUuid, zZaman } from './semalar.js';

export const API_ONEKI = '/v1';

// ---------------------------------------------------------------------------
// Kimlik ve cihaz (§9.2)
// ---------------------------------------------------------------------------

export const zGirisIstegi = z.object({
  kullanici_adi: z.string().trim().min(1).max(120),
  sifre: z.string().min(1).max(200),
});
export type GirisIstegi = z.infer<typeof zGirisIstegi>;

export const zTokenYaniti = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  /** Access token'ın saniye cinsinden ömrü. */
  expires_in: z.number().int().positive(),
  kullanici: z.object({
    id: zUuid,
    ad: z.string(),
    kullanici_adi: z.string(),
    rol: z.enum(ROL),
    yetkiler: z.array(z.string()),
  }),
});
export type TokenYaniti = z.infer<typeof zTokenYaniti>;

export const zYenilemeIstegi = z.object({ refresh_token: z.string().min(1) });
export type YenilemeIstegi = z.infer<typeof zYenilemeIstegi>;

export const zCihazAktivasyonIstegi = z.object({
  lisans_anahtari: z.string().trim().min(8).max(120),
  cihaz_id: z.string().trim().min(1).max(64),
  cihaz_adi: z.string().trim().min(1).max(120),
  /** İşletim sistemi / sürüm bilgisi — destek ve anti-abuse için (§23.4). */
  platform: z.string().max(120).optional(),
  uygulama_surumu: z.string().max(40).optional(),
});
export type CihazAktivasyonIstegi = z.infer<typeof zCihazAktivasyonIstegi>;

export const zCihazAktivasyonYaniti = z.object({
  cihaz_token: z.string(),
  isletme_id: zUuid,
  /** Lisans bitiş tarihi; null = süresiz. */
  lisans_bitis: zGun.nullable(),
  /** Lisans doğrulanamazsa uygulamanın kısıtlanmadan çalışacağı gün sayısı (§23.3). */
  grace_gun: z.number().int().nonnegative(),
  /**
   * Bu kasaya merkezce ayrılmış fiş serisi ("A", "B", … "AA").
   * Cihaz kimliğinden türetilmez; iki kasanın aynı seriyi alması böylece
   * yapısal olarak imkânsızdır (§10.2). Eski sunucular göndermez → opsiyonel.
   */
  seri: z.string().min(1).max(4).optional(),
  sunucu_zamani: zZaman,
});
export type CihazAktivasyonYaniti = z.infer<typeof zCihazAktivasyonYaniti>;

// ---------------------------------------------------------------------------
// Senkron — PUSH (§7.3)
// ---------------------------------------------------------------------------

export const zSenkronOlayi = z.object({
  /** İdempotency anahtarı — aynı uuid iki kez gelirse ikincisi yok sayılır (§7.1). */
  uuid: zUuid,
  tip: z.enum(OLAY_TIPI),
  entity: z.string().min(1).max(60),
  entity_id: z.string().min(1).max(64),
  olusturma_zamani: zZaman,
  /** Olayın gövdesi — tipe göre değişir; sunucu tipe özel doğrular. */
  veri: z.record(z.unknown()),
});
export type SenkronOlayi = z.infer<typeof zSenkronOlayi>;

export const zPushIstegi = z.object({
  cihaz_id: z.string().min(1).max(64),
  sema_surumu: z.number().int().default(SEMA_SURUMU),
  protokol_surumu: z.number().int().default(SENKRON_PROTOKOL_SURUMU),
  olaylar: z.array(zSenkronOlayi).max(SINIRLAR.PUSH_BATCH_AZAMI, 'Tek istekte çok fazla olay gönderildi'),
});
export type PushIstegi = z.infer<typeof zPushIstegi>;

export const zReddedilenOlay = z.object({
  uuid: zUuid,
  kod: z.string(),
  mesaj: z.string(),
  /** true ise istemci bu olayı tekrar denememelidir (kalıcı hata). */
  kalici: z.boolean().default(true),
});
export type ReddedilenOlay = z.infer<typeof zReddedilenOlay>;

export const zPushYaniti = z.object({
  kabul_edilen: z.array(zUuid),
  /** Daha önce işlenmiş olduğu için atlananlar — istemci bunları da arşivler. */
  yinelenen: z.array(zUuid).default([]),
  reddedilen: z.array(zReddedilenOlay).default([]),
  sunucu_versiyonu: z.number().int().nonnegative(),
  sunucu_zamani: zZaman,
});
export type PushYaniti = z.infer<typeof zPushYaniti>;

// ---------------------------------------------------------------------------
// Senkron — PULL (§7.3)
// ---------------------------------------------------------------------------

export const zPullIstegi = z.object({
  since: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(SINIRLAR.PULL_LIMIT).default(SINIRLAR.PULL_LIMIT),
  sema_surumu: z.coerce.number().int().optional(),
});
export type PullIstegi = z.infer<typeof zPullIstegi>;

export const zPullKaydi = z.object({
  varlik: z.enum(PULL_VARLIKLARI),
  /** Sunucudaki monoton artan sürüm numarası. */
  versiyon: z.number().int().nonnegative(),
  /** true → kayıt silinmiş/pasifleştirilmiş sayılır. */
  silindi_mi: z.boolean().default(false),
  veri: z.record(z.unknown()),
});
export type PullKaydi = z.infer<typeof zPullKaydi>;

export const zPullYaniti = z.object({
  kayitlar: z.array(zPullKaydi),
  sunucu_versiyonu: z.number().int().nonnegative(),
  has_more: z.boolean(),
  /**
   * Bu kasaya merkezce ayrılmış fiş serisi (§10.2).
   *
   * Aktivasyon yanıtında da gelir; burada TEKRAR gönderilir çünkü aktivasyondan
   * ÖNCE kurulmuş kasalar yeniden aktive olmadan seriyi alamazdı. Her pull'da
   * taşınması, serinin merkezle aynı kalmasını da garanti eder.
   */
  seri: z.string().min(1).max(4).optional(),
  sunucu_zamani: zZaman,
});
export type PullYaniti = z.infer<typeof zPullYaniti>;

export const zSenkronDurumYaniti = z.object({
  cihaz_id: z.string(),
  son_push: zZaman.nullable(),
  son_pull: zZaman.nullable(),
  sunucu_versiyonu: z.number().int(),
  sema_surumu: z.number().int(),
  protokol_surumu: z.number().int(),
  /** Sunucudaki toplam kayıt sayıları — mutabakat raporu için (§18.4). */
  sayimlar: z.record(z.number().int()).default({}),
  sunucu_zamani: zZaman,
});
export type SenkronDurumYaniti = z.infer<typeof zSenkronDurumYaniti>;

// ---------------------------------------------------------------------------
// Sayfalama (§9.1)
// ---------------------------------------------------------------------------

export const zSayfaIstegi = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().max(200).optional(),
  q: z.string().max(200).optional(),
});
export type SayfaIstegi = z.infer<typeof zSayfaIstegi>;

export function zSayfaYaniti<T extends z.ZodTypeAny>(oge: T) {
  return z.object({
    data: z.array(oge),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
    toplam: z.number().int().optional(),
  });
}

export interface SayfaYaniti<T> {
  data: T[];
  next_cursor: string | null;
  has_more: boolean;
  toplam?: number;
}

// ---------------------------------------------------------------------------
// Raporlar / dashboard (§9.2, §11.2)
// ---------------------------------------------------------------------------

export const zTarihAraligi = z.object({
  from: zGun,
  to: zGun,
});
export type TarihAraligi = z.infer<typeof zTarihAraligi>;

export const zGunlukRaporSatiri = z.object({
  tarih: zGun,
  ciro: zKurus,
  iade_toplam: zKurus,
  islem_sayisi: z.number().int(),
  nakit: zKurus,
  kart: zKurus,
  veresiye: zKurus,
  brut_kar: zKurus,
  ortalama_sepet: zKurus,
});
export type GunlukRaporSatiri = z.infer<typeof zGunlukRaporSatiri>;

export const zUrunRaporSatiri = z.object({
  urun_id: zUuid,
  urun_adi: z.string(),
  adet: zMiktar,
  ciro: zKurus,
  kar: zKurus,
});
export type UrunRaporSatiri = z.infer<typeof zUrunRaporSatiri>;

export const zCariRaporSatiri = z.object({
  cari_id: zUuid,
  ad_unvan: z.string(),
  tip: z.string(),
  bakiye: zKurus,
  son_hareket: zZaman.nullable(),
  yaslandirma: z.array(z.object({ dilim: z.string(), tutar: zKurus })),
});
export type CariRaporSatiri = z.infer<typeof zCariRaporSatiri>;

export const zDashboardOzeti = z.object({
  tarih: zGun,
  bugun: z.object({
    ciro: zKurus,
    islem_sayisi: z.number().int(),
    ortalama_sepet: zKurus,
    brut_kar: zKurus,
    nakit: zKurus,
    kart: zKurus,
    veresiye: zKurus,
  }),
  /** Bir önceki güne göre yüzde değişim. */
  degisim_yuzde: z.number(),
  trend: z.array(z.object({ tarih: zGun, ciro: zKurus, islem_sayisi: z.number().int() })),
  en_cok_satan: z.array(zUrunRaporSatiri),
  kritik_stok_sayisi: z.number().int(),
  toplam_musteri_alacagi: zKurus,
  toplam_tedarikci_borcu: zKurus,
  senkron: z.object({
    son_senkron: zZaman.nullable(),
    bekleyen_cihaz_sayisi: z.number().int(),
    aktif_cihaz_sayisi: z.number().int(),
  }),
  /** Panel verisinin tazeliği — her sayfada gösterilir (§11). */
  uretim_zamani: zZaman,
});
export type DashboardOzeti = z.infer<typeof zDashboardOzeti>;

// ---------------------------------------------------------------------------
// Sağlık (§9.2)
// ---------------------------------------------------------------------------

export const zSaglikYaniti = z.object({
  durum: z.enum(['iyi', 'bozuk']),
  surum: z.string(),
  sema_surumu: z.number().int(),
  zaman: zZaman,
  db: z.enum(['iyi', 'bozuk']).optional(),
  calisma_suresi_sn: z.number().optional(),
});
export type SaglikYaniti = z.infer<typeof zSaglikYaniti>;

// ---------------------------------------------------------------------------
// Uç nokta yolları — istemci ve sunucu bu sabitleri kullanır (yazım hatası olmaz)
// ---------------------------------------------------------------------------

export const UCLAR = {
  giris: `${API_ONEKI}/auth/login`,
  yenile: `${API_ONEKI}/auth/refresh`,
  cikis: `${API_ONEKI}/auth/logout`,
  cihazAktivasyon: `${API_ONEKI}/devices/activate`,
  cihazlar: `${API_ONEKI}/devices`,
  senkronPush: `${API_ONEKI}/sync/push`,
  senkronPull: `${API_ONEKI}/sync/pull`,
  senkronDurum: `${API_ONEKI}/sync/status`,
  senkronCakismalar: `${API_ONEKI}/sync/conflicts`,
  urunler: `${API_ONEKI}/urunler`,
  kategoriler: `${API_ONEKI}/kategoriler`,
  kampanyalar: `${API_ONEKI}/kampanyalar`,
  kullanicilar: `${API_ONEKI}/kullanicilar`,
  cariler: `${API_ONEKI}/cariler`,
  stok: `${API_ONEKI}/stok`,
  satislar: `${API_ONEKI}/satislar`,
  stokHareketler: `${API_ONEKI}/stok/hareketler`,
  stokDuzeltmeleri: `${API_ONEKI}/stok/duzeltmeler`,
  /** Panelden verilen kısmi iade talimatları (§10.4). */
  iadeTalimatlari: `${API_ONEKI}/iade-talimatlari`,
  /** Panelden verilen cari talimatları — açılış, düzeltme, tahsilat iptali (§10.7). */
  cariTalimatlari: `${API_ONEKI}/cari-talimatlari`,
  /** Mağaza geneli ayarlar — kasalara senkronlanır (§8.3). */
  ayarlar: `${API_ONEKI}/ayarlar`,
  /** Alış faturaları — tedarikçiden ne, hangi belgeyle alındı (§11.8). */
  alisFaturalari: `${API_ONEKI}/alis-faturalari`,
  /** Panelden verilen alış faturası talimatları — belgeyi kasa üretir (§11.8). */
  alisTalimatlari: `${API_ONEKI}/alis-talimatlari`,
  raporGunluk: `${API_ONEKI}/raporlar/gunluk`,
  raporUrun: `${API_ONEKI}/raporlar/urun`,
  raporCari: `${API_ONEKI}/raporlar/cari`,
  raporKasa: `${API_ONEKI}/raporlar/kasa`,
  /** Bir vardiyanın para hareketleri dökümü (§10.11). */
  vardiyaDokumu: `${API_ONEKI}/raporlar/kasa`,
  raporStok: `${API_ONEKI}/raporlar/stok`,
  /** Saatlik yoğunluk — kasadaki `rapor.saatlik` ile aynı şekil. */
  raporSaatlik: `${API_ONEKI}/raporlar/saatlik`,
  /** İade / iptal (suistimal) analizi — kasadaki `rapor.suistimal` ile aynı şekil. */
  raporSuistimal: `${API_ONEKI}/raporlar/suistimal`,
  denetim: `${API_ONEKI}/denetim`,
  dashboard: `${API_ONEKI}/dashboard/ozet`,
  saglik: `${API_ONEKI}/health`,
  hazir: `${API_ONEKI}/ready`,
  surum: `${API_ONEKI}/version`,
} as const;

/** Senkron uçlarında zorunlu cihaz kimliği başlığı (§9.1). */
export const CIHAZ_TOKEN_BASLIGI = 'x-device-token';
export const IDEMPOTENCY_BASLIGI = 'idempotency-key';
export const IZLEME_BASLIGI = 'x-izleme-id';
