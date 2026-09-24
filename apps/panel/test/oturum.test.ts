/**
 * Panel oturumunun yaşam süresi (§15.5).
 *
 * NEDEN VAR: panel sürekli çıkış yapıyordu. İki ayrı sebebi vardı ve ikisi de
 * sessizdi — kullanıcı yalnız giriş ekranına düştüğünü görüyordu:
 *
 *  1) Token'lar HER ZAMAN `sessionStorage`'daydı. Panel telefona kurulan bir
 *     PWA; işletim sistemi sayfayı bellekten atınca oturum da gidiyordu ve
 *     30 günlük refresh token hiç işe yaramıyordu.
 *  2) Yenileme akışındaki HER hata oturumu siliyordu — ağ koptuğunda ya da
 *     sunucu 500 verdiğinde de. Telefon uykudan dönerken tam olarak bu oluyor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Tarayıcı deposunun testlik karşılığı. */
function sahteDepo(): Storage {
  const kutu = new Map<string, string>();
  return {
    get length() {
      return kutu.size;
    },
    clear: () => kutu.clear(),
    getItem: (k: string) => kutu.get(k) ?? null,
    key: (i: number) => Array.from(kutu.keys())[i] ?? null,
    removeItem: (k: string) => void kutu.delete(k),
    setItem: (k: string, v: string) => void kutu.set(k, v),
  } as Storage;
}

let yerel: Storage;
let sekmelik: Storage;

/** Modül durumu (tek uçuşlu yenileme sözü) testler arasında sızmasın. */
async function apiModulu() {
  return import('../src/lib/api.js');
}

beforeEach(() => {
  vi.resetModules();
  yerel = sahteDepo();
  sekmelik = sahteDepo();
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', yerel);
  vi.stubGlobal('sessionStorage', sekmelik);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Verilen yanıtları sırayla döndüren `fetch`. */
function fetchKuyrugu(...yanitlar: (() => Promise<unknown>)[]) {
  let sira = 0;
  const casus = vi.fn(async () => {
    const uretici = yanitlar[Math.min(sira, yanitlar.length - 1)]!;
    sira++;
    return uretici();
  });
  vi.stubGlobal('fetch', casus);
  return casus;
}

function yanit(durum: number, govde: unknown) {
  return async () => ({ ok: durum >= 200 && durum < 300, status: durum, text: async () => JSON.stringify(govde) });
}

const YETKISIZ = { hata: { kod: 'KIMLIK_DOGRULANAMADI', mesaj: 'Geçersiz oturum.' } };

describe('oturum nerede saklanır', () => {
  it('varsayılan olarak kalıcı depoda durur — sekme kapanınca kaybolmaz', async () => {
    const { girisYap, tokenlariOku } = await apiModulu();
    fetchKuyrugu(yanit(200, { access_token: 'a1', refresh_token: 'r1', kullanici: { id: 'u1' } }));

    await girisYap('patron', 'Sifre1234');

    expect(yerel.getItem('market.access'), 'kalıcı depoya yazılmalı').toBe('a1');
    expect(sekmelik.getItem('market.access'), 'sekmelik depoya yazılmamalı').toBeNull();
    expect(tokenlariOku().refresh).toBe('r1');
  });

  it('kullanıcı istemezse yalnız sekmede yaşar (ortak bilgisayar)', async () => {
    const { girisYap, kaliciOturumAyarla, tokenlariOku } = await apiModulu();
    fetchKuyrugu(yanit(200, { access_token: 'a1', refresh_token: 'r1', kullanici: { id: 'u1' } }));

    kaliciOturumAyarla(false);
    await girisYap('patron', 'Sifre1234');

    expect(sekmelik.getItem('market.access')).toBe('a1');
    expect(yerel.getItem('market.access'), 'kalıcı depoda iz bırakmamalı').toBeNull();
    expect(tokenlariOku().access).toBe('a1');
  });

  it('çıkışta iki depo da temizlenir', async () => {
    const { kaliciOturumAyarla, girisYap, oturumuTemizle, tokenlariOku } = await apiModulu();

    // Önce sekmelik, sonra kalıcı: tercih değişmiş bir kullanıcıyı taklit eder.
    fetchKuyrugu(yanit(200, { access_token: 'a1', refresh_token: 'r1', kullanici: { id: 'u1' } }));
    kaliciOturumAyarla(false);
    await girisYap('patron', 'Sifre1234');
    kaliciOturumAyarla(true);
    await girisYap('patron', 'Sifre1234');

    oturumuTemizle();

    // Eski depoda kalan token "çıkış yaptım" dedikten sonra geri dönerdi.
    expect(yerel.getItem('market.access')).toBeNull();
    expect(sekmelik.getItem('market.access')).toBeNull();
    expect(tokenlariOku().access).toBeNull();
  });
});

describe('yenileme başarısız olunca oturum', () => {
  async function oturumKur() {
    const modul = await apiModulu();
    fetchKuyrugu(yanit(200, { access_token: 'a1', refresh_token: 'r1', kullanici: { id: 'u1' } }));
    await modul.girisYap('patron', 'Sifre1234');
    return modul;
  }

  it('ağ hatasında SİLİNMEZ — elde geçerli refresh token varken atılmayız', async () => {
    const { api, tokenlariOku } = await oturumKur();

    fetchKuyrugu(
      yanit(401, YETKISIZ), // ilk istek: access token dolmuş
      yanit(200, { access_token: 'a2', refresh_token: 'r2', kullanici: { id: 'u1' } }), // yenileme tamam
      async () => {
        throw new TypeError('Failed to fetch'); // tekrar denenen istek: bağlantı koptu
      },
    );

    await expect(api('/v1/urunler')).rejects.toThrow('Failed to fetch');
    expect(tokenlariOku().refresh, 'oturum korunmalı').toBe('r2');
  });

  it('sunucu hatasında da SİLİNMEZ', async () => {
    const { api, tokenlariOku } = await oturumKur();

    fetchKuyrugu(
      yanit(401, YETKISIZ),
      yanit(200, { access_token: 'a2', refresh_token: 'r2', kullanici: { id: 'u1' } }),
      yanit(500, {}),
    );

    await expect(api('/v1/urunler')).rejects.toThrow(/Sunucu hatası/);
    expect(tokenlariOku().refresh).toBe('r2');
  });

  it('kimlik gerçekten reddedilince SİLİNİR', async () => {
    const { api, tokenlariOku } = await oturumKur();

    // Refresh token'ın da süresi dolmuş: bu gerçekten yeniden giriş gerektirir.
    fetchKuyrugu(yanit(401, YETKISIZ));

    await expect(api('/v1/urunler')).rejects.toThrow(/Oturumunuz sona erdi/);
    expect(tokenlariOku().access, 'oturum silinmeli').toBeNull();
    expect(tokenlariOku().refresh).toBeNull();
  });
});
