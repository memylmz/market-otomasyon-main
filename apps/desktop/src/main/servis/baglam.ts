/**
 * Uygulama bağlamı — servislerin ihtiyaç duyduğu her şeyi tek nesnede toplar.
 *
 * Servisler Electron'a, dosya sistemine ya da global duruma doğrudan erişmez;
 * hepsi buradan gelir. Böylece iş kuralı testleri bellekteki bir veritabanı ve
 * sessiz bir kayıtçı ile koşabilir (§4.2, §21.1).
 */

import { etkinYetkiler, hatalar, HATA_KODU, SINIRLAR, UygulamaHatasi, type Rol, type Yetki } from '@market/shared';
import type { Vt } from '../db/surucu.js';
import type { Kayitci } from '../altyapi/kayit.js';
import type { Yollar } from '../altyapi/yollar.js';
import { ayarBool, ayarMetin, ayarSayi } from '../depo/ayar.js';
import { AYAR, LIMIT_DAVRANISI, type LimitDavranisi } from '@market/shared';

export interface Baglam {
  vt: Vt;
  cihazId: string;
  kayit: Kayitci;
  yollar: Yollar;
}

/** Oturum açmış kullanıcının işlem sırasında taşıdığı kimlik ve yetkiler. */
export interface Aktor {
  kullaniciId: string;
  ad: string;
  rol: Rol;
  yetkiler: Set<Yetki>;
  /** Etkin kasa oturumu; satış için zorunludur. */
  kasaOturumId: string | null;
}

/** Sistem tarafından yapılan (kullanıcısız) işlemler için sahte aktör. */
export const SISTEM_AKTORU: Aktor = {
  kullaniciId: 'sistem',
  ad: 'Sistem',
  rol: 'ADMIN',
  yetkiler: etkinYetkiler({ rol: 'ADMIN' }),
  kasaOturumId: null,
};

/**
 * Yetki kontrolü. Sunucu/ana süreç tarafında **her zaman** çağrılır; arayüzdeki
 * gizleme yalnız kullanıcı deneyimi içindir (§15.4).
 */
export function yetkiIste(aktor: Aktor, yetki: Yetki, islem?: string): void {
  if (aktor.yetkiler.has(yetki)) return;
  throw new UygulamaHatasi(HATA_KODU.YETKI, `Bu işlem için yetkiniz yok${islem ? `: ${islem}` : ''}.`, {
    detay: { gereken_yetki: yetki, rol: aktor.rol },
  });
}

export function yetkisiVarMi(aktor: Aktor, yetki: Yetki): boolean {
  return aktor.yetkiler.has(yetki);
}

/** Satış/tahsilat gibi kasa gerektiren işlemlerde açık oturum zorunludur (§10.8). */
export function kasaOturumuIste(aktor: Aktor): string {
  if (!aktor.kasaOturumId) throw hatalar.isKurali(HATA_KODU.KASA_ACIK_DEGIL);
  return aktor.kasaOturumId;
}

// ---------------------------------------------------------------------------
// Sık kullanılan ayarların tipli okuyucusu
// ---------------------------------------------------------------------------

export interface CalismaAyarlari {
  isletmeAdi: string;
  varsayilanKdv: number;
  negatifStokIzni: boolean;
  barkodDebounceMs: number;
  icBarkodOneki: string;
  krediLimitiDavranisi: LimitDavranisi;
  kasaFarkiEsigi: number;
  otomatikFis: boolean;
  cekmeceAc: boolean;
  oturumZamanAsimiDk: number;
  senkronUrl: string;
  senkronModu: string;
  senkronAralikDk: number;
  /** Arayüz teması: 'acik' (varsayılan) veya 'koyu'. */
  tema: string;
  yaziBoyutu: string;
}

export function ayarlariOku(baglam: Baglam): CalismaAyarlari {
  const { vt } = baglam;
  const limitHam = ayarMetin(vt, AYAR.KREDI_LIMITI_DAVRANISI, 'UYAR');
  const limitDavranisi = (LIMIT_DAVRANISI as readonly string[]).includes(limitHam) ? (limitHam as LimitDavranisi) : 'UYAR';

  return {
    isletmeAdi: ayarMetin(vt, AYAR.ISLETME_ADI, 'Market'),
    varsayilanKdv: ayarSayi(vt, AYAR.VARSAYILAN_KDV, 20),
    negatifStokIzni: ayarBool(vt, AYAR.NEGATIF_STOK_IZNI, false),
    barkodDebounceMs: ayarSayi(vt, AYAR.BARKOD_DEBOUNCE_MS, SINIRLAR.BARKOD_DEBOUNCE_MS),
    icBarkodOneki: ayarMetin(vt, AYAR.IC_BARKOD_ONEKI, '29'),
    krediLimitiDavranisi: limitDavranisi,
    kasaFarkiEsigi: ayarSayi(vt, AYAR.KASA_FARKI_ESIGI, 5000),
    otomatikFis: ayarBool(vt, AYAR.OTOMATIK_FIS, true),
    cekmeceAc: ayarBool(vt, AYAR.CEKMECE_ACIK, true),
    oturumZamanAsimiDk: ayarSayi(vt, AYAR.OTURUM_ZAMAN_ASIMI_DK, 15),
    senkronUrl: ayarMetin(vt, AYAR.SENKRON_URL, ''),
    senkronModu: ayarMetin(vt, AYAR.SENKRON_MOD, 'MANUEL'),
    senkronAralikDk: ayarSayi(vt, AYAR.SENKRON_ARALIK_DK, 15),
    tema: ayarMetin(vt, AYAR.TEMA, 'acik'),
    yaziBoyutu: ayarMetin(vt, AYAR.YAZI_BOYUTU, 'normal'),
  };
}
