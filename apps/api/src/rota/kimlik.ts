/** Kimlik ve cihaz aktivasyon rotaları (§9.2, §23.2). */

import {
  hatalar,
  HATA_KODU,
  simdi,
  SINIRLAR,
  UCLAR,
  UygulamaHatasi,
  uuid,
  zCihazAktivasyonIstegi,
  zGirisIstegi,
  zYenilemeIstegi,
  type Rol,
} from '@market/shared';
import { ROL_YETKILERI } from '@market/shared';
import type { FastifyInstance } from 'fastify';
import { parolaDogrula, parolaHashle, tokenHashle, tokenUret } from '../guvenlik.js';
import { panelKorumasi, rolIste } from './koruma.js';

interface PanelKullanicisi {
  id: string;
  isletme_id: string;
  ad: string;
  kullanici_adi: string;
  sifre_hash: string;
  rol: Rol;
  aktif_mi: number;
  hatali_giris: number;
  kilit_bitis: string | null;
}

const SAHTE_HASH = parolaHashle('zaman-sabitleme-icin-sahte-parola');

/** Kaydın hangi tablodan geldiği — hatalı giriş sayacı doğru tabloya yazılsın diye. */
type Kaynak = 'panel' | 'kasa';
type GirisKullanicisi = PanelKullanicisi & { kaynak: Kaynak };

/**
 * Panele girebilecek kullanıcıyı iki tablodan da arar (§9.2).
 *
 * NEDEN İKİ TABLO: panel kullanıcıları (`panel_kullanicilari`) ile kasa
 * kullanıcıları (`kullanicilar`) ayrı tutulur. İşletme sahibinin panelde ve
 * kasada AYRI kullanıcı adı taşıması pratikte yalnız karışıklık üretiyordu;
 * artık kasadaki ADMIN kendi kimliğiyle panele de girebilir.
 *
 * İKİ SINIR: yalnız ADMIN rolü ve yalnız ŞİFRE. Kasadaki PIN burada kabul
 * EDİLMEZ — 4 hanelik bir PIN internete açık bir panel için kimlik bilgisi
 * değildir; kasada işe yaramasının sebebi cihazın fiziksel olarak korunmasıdır.
 */
async function girisKullanicisiniBul(
  uygulama: FastifyInstance,
  alan: 'kullanici_adi' | 'id',
  deger: string,
): Promise<GirisKullanicisi | null> {
  const panel = await uygulama.vt.tek<PanelKullanicisi>(`SELECT * FROM panel_kullanicilari WHERE ${alan} = ?`, [deger]);
  if (panel) return { ...panel, kaynak: 'panel' };

  const kasa = await uygulama.vt.tek<PanelKullanicisi>(
    `SELECT id, isletme_id, ad, kullanici_adi, sifre_hash, rol, aktif_mi,
            COALESCE(hatali_giris, 0) AS hatali_giris, kilit_bitis
       FROM kullanicilar
      WHERE ${alan} = ? AND rol = 'ADMIN' AND silindi_mi = 0
        AND sifre_hash IS NOT NULL AND sifre_hash <> ''`,
    [deger],
  );
  return kasa ? { ...kasa, kaynak: 'kasa' } : null;
}

/**
 * Bir isletmede kullanilmamis ilk fis serisini dondurur (§10.2).
 *
 * NEDEN MERKEZDEN: seri eskiden cihaz kimliginden hash'lenip 26 harfe
 * indiriliyordu. Dogum gunu problemi geregi 4 kasada %21, 6 kasada %46
 * olasilikla iki kasa AYNI harfi aliyordu; o an iki farkli satis ayni fis
 * numarasini tasiyor ve musteri fisiyle geldiginde yanlis satis iade
 * edilebiliyordu. Merkez tek otorite oldugu icin cakisma YAPISAL OLARAK
 * imkansiz hale gelir.
 *
 * 26 harf dolarsa AA, AB ... diye devam eder; sinir yoktur.
 */
export async function sonrakiSeri(uygulama: FastifyInstance, isletmeId: string): Promise<string> {
  const satirlar = await uygulama.vt.tumu<{ seri: string }>(
    'SELECT seri FROM cihazlar WHERE isletme_id = ? AND seri IS NOT NULL',
    [isletmeId],
  );
  const alinmis = new Set(satirlar.map((r) => String(r.seri)));

  const harfler = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const h of harfler) if (!alinmis.has(h)) return h;
  for (const a of harfler) for (const b of harfler) if (!alinmis.has(a + b)) return a + b;
  throw new Error('Fiş serisi tükendi');
}

export async function kimlikRotalari(uygulama: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------- giriş
  uygulama.post(UCLAR.giris, async (istek) => {
    const girdi = zGirisIstegi.parse(istek.body);
    const zaman = simdi();

    const kullanici = await girisKullanicisiniBul(uygulama, 'kullanici_adi', girdi.kullanici_adi.trim());

    if (!kullanici || Number(kullanici.aktif_mi) !== 1) {
      // Kullanıcı numaralandırmasını zorlaştırmak için burada da hash hesaplanır.
      parolaDogrula(girdi.sifre, SAHTE_HASH);
      istek.log.warn({ kullanici_adi: girdi.kullanici_adi, ip: istek.ip }, 'Başarısız panel girişi');
      throw hatalar.kimlik();
    }

    if (kullanici.kilit_bitis && String(kullanici.kilit_bitis) > zaman) {
      throw new UygulamaHatasi(HATA_KODU.HESAP_KILITLI);
    }

    if (!parolaDogrula(girdi.sifre, kullanici.sifre_hash)) {
      const yeniSayac = Number(kullanici.hatali_giris) + 1;
      const kilitlendi = yeniSayac >= SINIRLAR.HATALI_GIRIS_SINIRI;
      const kilitBitis = kilitlendi ? new Date(Date.now() + SINIRLAR.HESAP_KILIT_SN * 1000).toISOString() : null;
      // `kullanicilar`'da `updated_at`'e DOKUNULMAZ: o alan senkron LWW
      // karşılaştırmasında kullanılır, başarısız bir giriş denemesi kasadaki
      // kaydı eskimiş göstermemelidir.
      await (kullanici.kaynak === 'panel'
        ? uygulama.vt.calistir('UPDATE panel_kullanicilari SET hatali_giris = ?, kilit_bitis = ?, updated_at = ? WHERE id = ?', [
            kilitlendi ? 0 : yeniSayac,
            kilitBitis,
            zaman,
            kullanici.id,
          ])
        : uygulama.vt.calistir('UPDATE kullanicilar SET hatali_giris = ?, kilit_bitis = ? WHERE id = ?', [
            kilitlendi ? 0 : yeniSayac,
            kilitBitis,
            kullanici.id,
          ]));
      istek.log.warn({ kullanici_id: kullanici.id, ip: istek.ip, kilitlendi }, 'Hatalı panel şifresi');
      throw kilitlendi ? new UygulamaHatasi(HATA_KODU.HESAP_KILITLI) : hatalar.kimlik();
    }

    await (kullanici.kaynak === 'panel'
      ? uygulama.vt.calistir(
          'UPDATE panel_kullanicilari SET son_giris = ?, hatali_giris = 0, kilit_bitis = NULL, updated_at = ? WHERE id = ?',
          [zaman, zaman, kullanici.id],
        )
      : uygulama.vt.calistir('UPDATE kullanicilar SET hatali_giris = 0, kilit_bitis = NULL WHERE id = ?', [kullanici.id]));

    return tokenlariUret(uygulama, kullanici);
  });

  // ------------------------------------------------------------ yenileme
  uygulama.post(UCLAR.yenile, async (istek) => {
    const girdi = zYenilemeIstegi.parse(istek.body);
    const hash = tokenHashle(girdi.refresh_token);
    const zaman = simdi();

    const kayit = await uygulama.vt.tek<{ id: string; kullanici_id: string; bitis: string; iptal_mi: number }>(
      'SELECT id, kullanici_id, bitis, iptal_mi FROM refresh_tokenlar WHERE token_hash = ?',
      [hash],
    );

    if (!kayit || Number(kayit.iptal_mi) === 1 || String(kayit.bitis) < zaman) {
      throw new UygulamaHatasi(HATA_KODU.KIMLIK, 'Oturum süresi doldu. Lütfen tekrar giriş yapın.');
    }

    const kullanici = await girisKullanicisiniBul(uygulama, 'id', String(kayit.kullanici_id));
    if (!kullanici || Number(kullanici.aktif_mi) !== 1) throw hatalar.kimlik();

    // Refresh rotasyonu (§15.1): kullanılan token iptal edilir, yenisi verilir.
    await uygulama.vt.calistir('UPDATE refresh_tokenlar SET iptal_mi = 1 WHERE id = ?', [kayit.id]);
    return tokenlariUret(uygulama, kullanici);
  });

  // --------------------------------------------------------------- çıkış
  uygulama.post(UCLAR.cikis, { preHandler: panelKorumasi }, async (istek) => {
    await uygulama.vt.calistir('UPDATE refresh_tokenlar SET iptal_mi = 1 WHERE kullanici_id = ?', [istek.kullanici?.id]);
    return { basarili: true };
  });

  // --------------------------------------------------- cihaz aktivasyonu
  uygulama.post(UCLAR.cihazAktivasyon, async (istek) => {
    const girdi = zCihazAktivasyonIstegi.parse(istek.body);
    const zaman = simdi();

    const isletme = await uygulama.vt.tek<{ id: string; lisans_bitis: string | null; aktif_mi: number }>(
      'SELECT id, lisans_bitis, aktif_mi FROM isletmeler WHERE lisans_anahtari = ?',
      [girdi.lisans_anahtari.trim()],
    );

    if (!isletme || Number(isletme.aktif_mi) !== 1) {
      istek.log.warn({ ip: istek.ip, cihaz_id: girdi.cihaz_id }, 'Geçersiz lisans anahtarıyla aktivasyon denemesi');
      throw new UygulamaHatasi(HATA_KODU.LISANS_GECERSIZ, 'Lisans anahtarı geçersiz veya hesap pasif.');
    }

    const token = tokenUret(32);
    const isletmeId = String(isletme.id);

    // Yeniden aktivasyonda mevcut seri KORUNUR: seri degisirse ayni kasa iki
    // farkli seride fis basmis olur ve gecmis fisler izlenemez hale gelir.
    const mevcut = await uygulama.vt.tek<{ seri: string | null }>(
      'SELECT seri FROM cihazlar WHERE isletme_id = ? AND cihaz_id = ?',
      [isletmeId, girdi.cihaz_id],
    );
    const seri = mevcut?.seri ? String(mevcut.seri) : await sonrakiSeri(uygulama, isletmeId);

    await uygulama.vt.calistir(
      `INSERT INTO cihazlar (id, isletme_id, cihaz_id, cihaz_adi, token_hash, platform, uygulama_surumu,
                             seri, aktif_mi, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(isletme_id, cihaz_id) DO UPDATE SET
         cihaz_adi = excluded.cihaz_adi, token_hash = excluded.token_hash,
         platform = excluded.platform, uygulama_surumu = excluded.uygulama_surumu,
         seri = excluded.seri, aktif_mi = 1, updated_at = excluded.updated_at`,
      [
        uuid(),
        isletmeId,
        girdi.cihaz_id,
        girdi.cihaz_adi,
        tokenHashle(token),
        girdi.platform ?? null,
        girdi.uygulama_surumu ?? null,
        seri,
        zaman,
        zaman,
      ],
    );

    istek.log.info({ isletme_id: isletmeId, cihaz_id: girdi.cihaz_id }, 'Cihaz aktive edildi');

    return {
      cihaz_token: token,
      isletme_id: isletmeId,
      seri,
      lisans_bitis: isletme.lisans_bitis ?? null,
      grace_gun: uygulama.yapilandirma.LISANS_GRACE_GUN,
      sunucu_zamani: zaman,
    };
  });

  // ------------------------------------------------------ cihaz yönetimi
  uygulama.get(UCLAR.cihazlar, { preHandler: panelKorumasi }, async (istek) => {
    const cihazlar = await uygulama.vt.tumu(
      `SELECT id, cihaz_id, cihaz_adi, platform, uygulama_surumu, son_push, son_pull, aktif_mi, created_at
       FROM cihazlar WHERE isletme_id = ? ORDER BY cihaz_adi`,
      [istek.kullanici?.isletmeId],
    );
    return { data: cihazlar };
  });

  /** Cihaz token'ını iptal eder (§23.4) — çalınan/kayıp kasa senaryosu. */
  uygulama.post<{ Params: { id: string } }>(
    `${UCLAR.cihazlar}/:id/iptal`,
    { preHandler: [panelKorumasi, rolIste('ADMIN')] },
    async (istek) => {
      const sonuc = await uygulama.vt.calistir(
        'UPDATE cihazlar SET aktif_mi = 0, updated_at = ? WHERE id = ? AND isletme_id = ?',
        [simdi(), istek.params.id, istek.kullanici?.isletmeId],
      );
      if (sonuc.rowsAffected === 0) throw hatalar.bulunamadi('Cihaz');
      istek.log.warn({ cihaz: istek.params.id, kullanici: istek.kullanici?.id }, 'Cihaz token iptal edildi');
      return { basarili: true };
    },
  );
}

async function tokenlariUret(uygulama: FastifyInstance, kullanici: PanelKullanicisi) {
  const zaman = simdi();
  const accessToken = uygulama.jwt.sign(
    { sub: kullanici.id, isletme_id: kullanici.isletme_id, rol: kullanici.rol, kullanici_adi: kullanici.kullanici_adi },
    { expiresIn: uygulama.yapilandirma.ACCESS_TOKEN_OMRU },
  );

  const refreshToken = tokenUret(48);
  const gunler = Number((uygulama.yapilandirma.REFRESH_TOKEN_OMRU.match(/^(\d+)d$/) ?? [])[1] ?? 30);
  await uygulama.vt.calistir(
    'INSERT INTO refresh_tokenlar (id, kullanici_id, token_hash, bitis, created_at) VALUES (?, ?, ?, ?, ?)',
    [uuid(), kullanici.id, tokenHashle(refreshToken), new Date(Date.now() + gunler * 86400000).toISOString(), zaman],
  );

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 15 * 60,
    kullanici: {
      id: String(kullanici.id),
      ad: String(kullanici.ad),
      kullanici_adi: String(kullanici.kullanici_adi),
      rol: kullanici.rol,
      yetkiler: [...(ROL_YETKILERI[kullanici.rol] ?? [])],
    },
  };
}
