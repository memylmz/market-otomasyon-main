/**
 * Lisanslama ve aktivasyon — §23.
 *
 * ZARİF BOZULMA (§23.3) — bu dosyanın en önemli kuralı:
 * Lisans doğrulanamazsa uygulama **aniden kilitlenmez.** Önce grace period boyunca
 * her şey normal çalışır; süre dolduğunda yalnız **yönetimsel** özellikler kısıtlanır.
 * Satış, tahsilat, gün sonu gibi kritik operasyon **her koşulda** çalışmaya devam eder.
 * Market işi asla durmamalıdır.
 */

import { AYAR, hatalar, simdi, uuid, type GunAnahtari } from '@market/shared';
import { bugun, gunFarki } from '@market/shared';
import { ayarMetin, ayarSayi, ayarSayiYaz, ayarYaz } from '../depo/ayar.js';
import { denetimYaz } from '../depo/ozet.js';
import { SenkronIstemcisi } from '../senkron/istemci.js';
import { yetkiIste, type Aktor, type Baglam } from './baglam.js';

const AYAR_CIHAZ_TOKEN = 'lisans.cihaz_token';
const AYAR_LISANS_BITIS = 'lisans.bitis';
const AYAR_GRACE_GUN = 'lisans.grace_gun';
const AYAR_SON_DOGRULAMA = 'lisans.son_dogrulama';
const AYAR_ISLETME_ID = 'lisans.isletme_id';

export const VARSAYILAN_GRACE_GUN = 14;

export type LisansSeviyesi = 'AKTIF' | 'GRACE' | 'KISITLI' | 'AKTIVE_EDILMEMIS';

export interface LisansDurumu {
  seviye: LisansSeviyesi;
  cihazTokenVar: boolean;
  lisansBitis: GunAnahtari | null;
  sonDogrulama: string | null;
  graceKalanGun: number;
  /** true → yalnız yönetimsel özellikler kapalı; satış her zaman açık. */
  yonetimKisitli: boolean;
  mesaj: string | null;
}

export function lisansDurumu(baglam: Baglam, referansGun: GunAnahtari = bugun()): LisansDurumu {
  const { vt } = baglam;
  const token = ayarMetin(vt, AYAR_CIHAZ_TOKEN, '');
  const bitis = ayarMetin(vt, AYAR_LISANS_BITIS, '');
  const graceGun = ayarSayi(vt, AYAR_GRACE_GUN, VARSAYILAN_GRACE_GUN);
  const sonDogrulama = ayarMetin(vt, AYAR_SON_DOGRULAMA, '');

  if (!token) {
    return {
      seviye: 'AKTIVE_EDILMEMIS',
      cihazTokenVar: false,
      lisansBitis: null,
      sonDogrulama: null,
      graceKalanGun: graceGun,
      // Aktive edilmemiş kurulum da satış yapabilir; yalnız bulut özellikleri kapalıdır.
      yonetimKisitli: false,
      mesaj: 'Cihaz henüz aktive edilmedi. Bulut senkronu ve panel kullanılamıyor.',
    };
  }

  // Süresiz lisans
  if (!bitis) {
    return {
      seviye: 'AKTIF',
      cihazTokenVar: true,
      lisansBitis: null,
      sonDogrulama: sonDogrulama || null,
      graceKalanGun: graceGun,
      yonetimKisitli: false,
      mesaj: null,
    };
  }

  const kalan = gunFarki(referansGun, bitis);
  if (kalan >= 0) {
    return {
      seviye: 'AKTIF',
      cihazTokenVar: true,
      lisansBitis: bitis,
      sonDogrulama: sonDogrulama || null,
      graceKalanGun: graceGun,
      yonetimKisitli: false,
      mesaj: kalan <= 7 ? `Lisansınızın bitmesine ${kalan} gün kaldı.` : null,
    };
  }

  const gecenGun = -kalan;
  if (gecenGun <= graceGun) {
    return {
      seviye: 'GRACE',
      cihazTokenVar: true,
      lisansBitis: bitis,
      sonDogrulama: sonDogrulama || null,
      graceKalanGun: graceGun - gecenGun,
      yonetimKisitli: false,
      mesaj: `Lisans süresi doldu. ${graceGun - gecenGun} gün içinde yenilenmezse yönetim özellikleri kısıtlanacak. Satış işlemleriniz etkilenmeyecek.`,
    };
  }

  return {
    seviye: 'KISITLI',
    cihazTokenVar: true,
    lisansBitis: bitis,
    sonDogrulama: sonDogrulama || null,
    graceKalanGun: 0,
    yonetimKisitli: true,
    mesaj:
      'Lisans süresi doldu. Satış ve tahsilat çalışmaya devam ediyor; raporlama ve yönetim özellikleri lisans yenilenene kadar kısıtlı.',
  };
}

/**
 * Yönetimsel bir özelliğin kullanılabilirliğini denetler.
 * **Satış akışında asla çağrılmaz** — kasa lisanstan bağımsızdır (§23.3).
 */
export function yonetimselOzellikIste(baglam: Baglam, ozellikAdi: string): void {
  const durum = lisansDurumu(baglam);
  if (!durum.yonetimKisitli) return;
  throw hatalar.isKurali(
    'LISANS_GECERSIZ',
    `${ozellikAdi} için geçerli bir lisans gerekiyor. Satış ve tahsilat işlemleriniz çalışmaya devam ediyor.`,
    {
      seviye: durum.seviye,
      lisans_bitis: durum.lisansBitis,
    },
  );
}

export interface AktivasyonSonucu {
  basarili: boolean;
  durum: LisansDurumu;
  hata?: string;
}

/** Çevrimiçi aktivasyon: lisans anahtarı → cihaz token (§23.2). */
export async function cihaziAktiveEt(
  baglam: Baglam,
  aktor: Aktor,
  girdi: { sunucuUrl: string; lisansAnahtari: string; cihazAdi: string },
  getir?: typeof fetch,
): Promise<AktivasyonSonucu> {
  yetkiIste(aktor, 'ayar.yonet');
  const { vt, cihazId } = baglam;

  const istemci = new SenkronIstemcisi({ temelUrl: girdi.sunucuUrl, getir });
  try {
    const yanit = await istemci.cihazAktivasyonu({
      lisans_anahtari: girdi.lisansAnahtari.trim(),
      cihaz_id: cihazId,
      cihaz_adi: girdi.cihazAdi,
      platform: `${process.platform} ${process.arch}`,
      uygulama_surumu: process.env.npm_package_version ?? '2.0.0',
    });

    const zaman = simdi();
    vt.islem(() => {
      ayarYaz(vt, AYAR_CIHAZ_TOKEN, yanit.cihaz_token, 'Senkron cihaz kimliği (gizli)', zaman);
      ayarYaz(vt, AYAR_ISLETME_ID, yanit.isletme_id, null, zaman);
      // Merkezin ayırdığı fiş serisi. Gelmezse (eski sunucu) yazılmaz ve
      // satış servisi cihaz kimliğinden türetmeye geri döner.
      if (yanit.seri) ayarYaz(vt, AYAR.CIHAZ_SERI, yanit.seri, 'Bu kasanın fiş serisi (değiştirmeyin)', zaman);
      ayarYaz(vt, AYAR_LISANS_BITIS, yanit.lisans_bitis ?? '', null, zaman);
      ayarSayiYaz(vt, AYAR_GRACE_GUN, yanit.grace_gun ?? VARSAYILAN_GRACE_GUN);
      ayarYaz(vt, AYAR_SON_DOGRULAMA, zaman, null, zaman);
      ayarYaz(vt, AYAR.SENKRON_URL, girdi.sunucuUrl, null, zaman);
      ayarYaz(vt, AYAR.LISANS_ANAHTARI, girdi.lisansAnahtari.trim(), null, zaman);
      denetimYaz(
        vt,
        {
          kullanici_id: aktor.kullaniciId,
          islem: 'CIHAZ_AKTIVASYON',
          entity: 'lisans',
          entity_id: cihazId,
          yeni_deger: { isletme_id: yanit.isletme_id, bitis: yanit.lisans_bitis },
        },
        cihazId,
        zaman,
      );
    });

    baglam.kayit.bilgi('Cihaz aktive edildi', { cihaz_id: cihazId, isletme_id: yanit.isletme_id, bitis: yanit.lisans_bitis });
    return { basarili: true, durum: lisansDurumu(baglam) };
  } catch (hata) {
    const mesaj = hata instanceof Error ? hata.message : String(hata);
    baglam.kayit.uyari('Cihaz aktivasyonu başarısız', { mesaj });
    return { basarili: false, durum: lisansDurumu(baglam), hata: mesaj };
  }
}

/**
 * Çevrimdışı yedek aktivasyon (§23.2).
 * İnternet yokken kurulumu tamamlamayı sağlar; ilk çevrimiçi senkronda
 * gerçek doğrulama yapılır. Bu yol yalnız grace period başlatır, kalıcı lisans vermez.
 */
export function cevrimdisiAktivasyon(baglam: Baglam, aktor: Aktor, kod: string): LisansDurumu {
  yetkiIste(aktor, 'ayar.yonet');
  if (kod.trim().length < 8) throw hatalar.dogrulama('Çevrimdışı aktivasyon kodu geçersiz.');

  const { vt, cihazId } = baglam;
  const zaman = simdi();
  // Grace süresi kadar geçerli, geçici bir yerel lisans.
  const bitis = new Date(Date.now() + VARSAYILAN_GRACE_GUN * 86400000).toISOString().slice(0, 10);

  vt.islem(() => {
    ayarYaz(vt, AYAR_CIHAZ_TOKEN, `cevrimdisi-${uuid()}`, 'Çevrimdışı geçici aktivasyon', zaman);
    ayarYaz(vt, AYAR_LISANS_BITIS, bitis, null, zaman);
    ayarSayiYaz(vt, AYAR_GRACE_GUN, VARSAYILAN_GRACE_GUN);
    ayarYaz(vt, AYAR.LISANS_ANAHTARI, kod.trim(), null, zaman);
    denetimYaz(
      vt,
      { kullanici_id: aktor.kullaniciId, islem: 'CEVRIMDISI_AKTIVASYON', entity: 'lisans', entity_id: cihazId },
      cihazId,
      zaman,
    );
  });

  baglam.kayit.uyari('Çevrimdışı aktivasyon kullanıldı', { cihaz_id: cihazId, gecici_bitis: bitis });
  return lisansDurumu(baglam);
}

export function cihazTokeniOku(baglam: Baglam): string | null {
  const token = ayarMetin(baglam.vt, AYAR_CIHAZ_TOKEN, '');
  return token || null;
}

/** Senkron sırasında sunucudan gelen lisans bilgisini tazeler. */
export function lisansiTazele(baglam: Baglam, bitis: string | null, graceGun: number): void {
  const zaman = simdi();
  baglam.vt.islem(() => {
    ayarYaz(baglam.vt, AYAR_LISANS_BITIS, bitis ?? '', null, zaman);
    ayarSayiYaz(baglam.vt, AYAR_GRACE_GUN, graceGun);
    ayarYaz(baglam.vt, AYAR_SON_DOGRULAMA, zaman, null, zaman);
  });
}
