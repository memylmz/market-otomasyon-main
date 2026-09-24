/**
 * API istemcisi (panel tarafı).
 *
 * OTURUM NEREDE DURUR: kullanıcı seçer (§15.5).
 *
 * Varsayılan `localStorage`'dır — oturum sekme kapanınca da, telefon uygulamayı
 * bellekten atınca da yaşar. Önceden HER ZAMAN `sessionStorage` kullanılıyordu:
 * ortak bilgisayarda iz bırakmama gerekçesi doğruydu ama bedeli ağırdı. Panel
 * telefona kurulan bir PWA; işletim sistemi sayfayı sık sık bellekten atar ve
 * kullanıcı her dönüşünde giriş ekranıyla karşılaşıyordu. Üstelik 30 günlük
 * refresh token da sekmeyle birlikte öldüğü için hiç işe yaramıyordu.
 *
 * Ortak bilgisayarda giriş ekranındaki "Bu cihazda oturumum açık kalsın"
 * kapatılırsa eski davranışa dönülür: oturum yalnız o sekmede yaşar.
 *
 * Access token süresi dolduğunda refresh ile bir kez otomatik yenilenir.
 */

'use client';

import { hataCanlandir, UCLAR, UygulamaHatasi } from '@market/shared';

// Yedek adreste "localhost" yerine 127.0.0.1: Windows'ta localhost önce IPv6'ya
// (::1) çözülür ve o adreste başka bir proje dinliyorsa istek sessizce oraya gider.
const TABAN = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3010';
const ACCESS_ANAHTARI = 'market.access';
const REFRESH_ANAHTARI = 'market.refresh';
const KULLANICI_ANAHTARI = 'market.kullanici';
/** Oturumun kalıcı mı (localStorage) yoksa sekmelik mi (sessionStorage) tutulacağını işaretler. */
const KALICI_ANAHTARI = 'market.kalici';

/*
 * Oturumun yaşadığı depo.
 *
 * Gizli pencerede ya da depolama kapalıyken erişim İSTİSNA ATAR; panelin
 * tamamen açılmaması yerine oturumsuz çalışması yeğdir, bu yüzden her erişim
 * korumalıdır.
 */
function depo(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    // Anahtar yoksa KALICI: yeni varsayılan bu. Yalnız açıkça '0' yazılmışsa sekmelik.
    return localStorage.getItem(KALICI_ANAHTARI) === '0' ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}

function oku(anahtar: string): string | null {
  try {
    return depo()?.getItem(anahtar) ?? null;
  } catch {
    return null;
  }
}

export interface PanelKullanicisi {
  id: string;
  ad: string;
  kullanici_adi: string;
  rol: string;
  yetkiler: string[];
}

export function tokenlariOku(): { access: string | null; refresh: string | null } {
  return { access: oku(ACCESS_ANAHTARI), refresh: oku(REFRESH_ANAHTARI) };
}

export function kullaniciyiOku(): PanelKullanicisi | null {
  const ham = oku(KULLANICI_ANAHTARI);
  if (!ham) return null;
  try {
    return JSON.parse(ham) as PanelKullanicisi;
  } catch {
    return null;
  }
}

function oturumuYaz(access: string, refresh: string, kullanici: PanelKullanicisi): void {
  const hedef = depo();
  if (!hedef) return;
  try {
    hedef.setItem(ACCESS_ANAHTARI, access);
    hedef.setItem(REFRESH_ANAHTARI, refresh);
    hedef.setItem(KULLANICI_ANAHTARI, JSON.stringify(kullanici));
  } catch {
    // Depo dolu ya da kapalı: oturum bu sayfa ömrü kadar yaşar, panel yine çalışır.
  }
}

export function oturumuTemizle(): void {
  if (typeof window === 'undefined') return;
  // İKİ depodan da silinir: kullanıcı tercihini değiştirmiş olabilir, eski
  // depoda kalan token "çıkış yaptım" dedikten sonra geri dönerdi.
  for (const hedef of [() => localStorage, () => sessionStorage]) {
    try {
      const d = hedef();
      d.removeItem(ACCESS_ANAHTARI);
      d.removeItem(REFRESH_ANAHTARI);
      d.removeItem(KULLANICI_ANAHTARI);
    } catch {
      /* depo kapalı olabilir */
    }
  }
}

/**
 * Oturumun bu cihazda kalıcı tutulup tutulmayacağını belirler.
 *
 * Giriş YAPILMADAN ÖNCE çağrılır: `oturumuYaz` hangi depoya yazacağını buradan
 * öğrenir.
 */
export function kaliciOturumAyarla(kalici: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KALICI_ANAHTARI, kalici ? '1' : '0');
  } catch {
    /* depo kapalıysa sessionStorage'a düşer */
  }
}

export function kaliciOturumMu(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return localStorage.getItem(KALICI_ANAHTARI) !== '0';
  } catch {
    // Depo kapalıysa kalıcı oturum zaten mümkün değil; kutu işaretsiz görünmeli.
    return false;
  }
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
    } catch (ikinciHata) {
      /*
       * OTURUM YALNIZ KİMLİK GERÇEKTEN REDDEDİLDİYSE SİLİNİR.
       *
       * Eskiden buradaki her hata oturumu siliyordu: ağ koptuysa, sunucu 500
       * verdiyse ya da yenilenen token'la yapılan istek alakasız bir sebeple
       * düştüyse kullanıcı giriş ekranına atılıyordu. Telefonda panel uykudan
       * döndüğünde access token çoktan dolmuş oluyor, yenileme isteği bağlantı
       * daha toparlanmadan gidiyor ve elde 30 günlük geçerli bir refresh token
       * varken oturum çöpe gidiyordu.
       *
       * Şimdi yalnız sunucu "bu kimlik geçersiz" derse silinir; diğer her hata
       * olduğu gibi yukarı verilir, ekran "tekrar dene" gösterir.
       */
      const kimlikReddedildi = ikinciHata instanceof UygulamaHatasi && ikinciHata.kod === 'KIMLIK_DOGRULANAMADI';
      if (!kimlikReddedildi) throw ikinciHata;
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
