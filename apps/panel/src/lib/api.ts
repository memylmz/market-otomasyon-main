/**
 * API istemcisi (panel tarafı).
 *
 * Token'lar `sessionStorage`'da tutulur: sekme kapanınca oturum düşer, ortak
 * kullanılan bir bilgisayarda kalıcı iz bırakmaz (§15.5). Access token süresi
 * dolduğunda refresh ile bir kez otomatik yenilenir.
 */

'use client';

import { hataCanlandir, UCLAR, UygulamaHatasi } from '@market/shared';

// Yedek adreste "localhost" yerine 127.0.0.1: Windows'ta localhost önce IPv6'ya
// (::1) çözülür ve o adreste başka bir proje dinliyorsa istek sessizce oraya gider.
const TABAN = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3010';
const ACCESS_ANAHTARI = 'market.access';
const REFRESH_ANAHTARI = 'market.refresh';
const KULLANICI_ANAHTARI = 'market.kullanici';

export interface PanelKullanicisi {
  id: string;
  ad: string;
  kullanici_adi: string;
  rol: string;
  yetkiler: string[];
}

export function tokenlariOku(): { access: string | null; refresh: string | null } {
  if (typeof window === 'undefined') return { access: null, refresh: null };
  return {
    access: sessionStorage.getItem(ACCESS_ANAHTARI),
    refresh: sessionStorage.getItem(REFRESH_ANAHTARI),
  };
}

export function kullaniciyiOku(): PanelKullanicisi | null {
  if (typeof window === 'undefined') return null;
  const ham = sessionStorage.getItem(KULLANICI_ANAHTARI);
  if (!ham) return null;
  try {
    return JSON.parse(ham) as PanelKullanicisi;
  } catch {
    return null;
  }
}

function oturumuYaz(access: string, refresh: string, kullanici: PanelKullanicisi): void {
  sessionStorage.setItem(ACCESS_ANAHTARI, access);
  sessionStorage.setItem(REFRESH_ANAHTARI, refresh);
  sessionStorage.setItem(KULLANICI_ANAHTARI, JSON.stringify(kullanici));
}

export function oturumuTemizle(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(ACCESS_ANAHTARI);
  sessionStorage.removeItem(REFRESH_ANAHTARI);
  sessionStorage.removeItem(KULLANICI_ANAHTARI);
}

async function hamIstek<T>(yol: string, secenekler: RequestInit = {}, token?: string | null): Promise<T> {
  // `content-type` YALNIZ gövde varken gönderilir. Gövdesiz bir DELETE'te
  // "application/json" demek sunucuya olmayan bir gövde vaat etmektir; Fastify
  // bunu "Body cannot be empty when content-type is set" diye 500'le reddeder
  // ve kullanıcı "Beklenmeyen bir hata oluştu" görür.
  const govdeVar = secenekler.body !== undefined && secenekler.body !== null;
  const yanit = await fetch(TABAN + yol, {
    ...secenekler,
    headers: {
      ...(govdeVar ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(secenekler.headers ?? {}),
    },
    cache: 'no-store',
  });

  const metin = await yanit.text();
  const govde = metin ? (JSON.parse(metin) as unknown) : null;

  if (!yanit.ok) {
    const hata = (govde as { hata?: { kod: string; mesaj: string } } | null)?.hata;
    throw hata
      ? hataCanlandir(hata)
      : new UygulamaHatasi('SUNUCU_HATASI', `Sunucu hatası (${yanit.status}). Lütfen daha sonra tekrar deneyin.`);
  }
  return govde as T;
}

/**
 * Süren tek yenileme isteği.
 *
 * Sunucu refresh token'ı KULLANIMDA DÖNDÜRÜR (rotasyon): aynı token ikinci kez
 * gönderilirse reddedilir. Bir sayfada birden çok istek aynı anda 401 alırsa
 * (dashboard + kabuk gibi) her biri ayrı ayrı yenilemeye kalkar; ilki başarılı
 * olur, ikincisi artık geçersiz token'la 401 alır ve oturumu SİLER — kullanıcı
 * sebepsiz yere giriş ekranına atılır. Bu yüzden yenileme tek uçuşludur:
 * eşzamanlı çağrılar aynı sözü bekler.
 */
let yenilemeSozu: Promise<string> | null = null;

async function tokenYenile(refresh: string): Promise<string> {
  yenilemeSozu ??= (async () => {
    try {
      const yeni = await hamIstek<{ access_token: string; refresh_token: string; kullanici: PanelKullanicisi }>(UCLAR.yenile, {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refresh }),
      });
      oturumuYaz(yeni.access_token, yeni.refresh_token, yeni.kullanici);
      return yeni.access_token;
    } finally {
      // Sonuç ne olursa olsun bırak: sonraki 401 yeni token'la tekrar denesin.
      yenilemeSozu = null;
    }
  })();
  return yenilemeSozu;
}

/** Yetkili istek. 401 alınca refresh ile bir kez yeniden dener. */
export async function api<T>(yol: string, secenekler: RequestInit = {}): Promise<T> {
  const { access, refresh } = tokenlariOku();

  try {
    return await hamIstek<T>(yol, secenekler, access);
  } catch (hata) {
    const yenilenebilir = hata instanceof UygulamaHatasi && hata.kod === 'KIMLIK_DOGRULANAMADI' && refresh;
    if (!yenilenebilir) throw hata;

    try {
      const yeniAccess = await tokenYenile(refresh);
      return await hamIstek<T>(yol, secenekler, yeniAccess);
    } catch {
      oturumuTemizle();
      throw new UygulamaHatasi('KIMLIK_DOGRULANAMADI', 'Oturumunuz sona erdi. Lütfen tekrar giriş yapın.');
    }
  }
}

export async function girisYap(kullaniciAdi: string, sifre: string): Promise<PanelKullanicisi> {
  const yanit = await hamIstek<{ access_token: string; refresh_token: string; kullanici: PanelKullanicisi }>(UCLAR.giris, {
    method: 'POST',
    body: JSON.stringify({ kullanici_adi: kullaniciAdi, sifre }),
  });
  oturumuYaz(yanit.access_token, yanit.refresh_token, yanit.kullanici);
  return yanit.kullanici;
}

export async function cikisYap(): Promise<void> {
  try {
    await api(UCLAR.cikis, { method: 'POST' });
  } catch {
    /* sunucuya ulaşılamasa da yerel oturum temizlenir */
  }
  oturumuTemizle();
}

export const uclar = UCLAR;
