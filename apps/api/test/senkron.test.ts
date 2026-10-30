/**
 * Senkron protokolü entegrasyon/sözleşme testleri (§21.2).
 * Gerçek Fastify + gerçek libSQL (bellek içi) üzerinde koşar.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { bugun, SEMA_SURUMU, simdi, uuid, zPullYaniti, zPushYaniti, zSenkronDurumYaniti, UCLAR } from '@market/shared';
import { parolaHashle, tokenHashle } from '../src/guvenlik.js';
import { sunucuOlustur } from '../src/sunucu.js';
import { vtOlustur, type MerkezVt } from '../src/vt/baglanti.js';
import { yapilandirmayiOku } from '../src/yapilandirma.js';

let uygulama: FastifyInstance;
let vt: MerkezVt;
let geciciKlasor: string;

const ISLETME_ID = '11111111-1111-4111-8111-111111111111';
const CIHAZ_TOKEN = 'test-cihaz-tokeni-yeterince-uzun-1234567890';
const LISANS = 'TEST-LISANS-0001';

beforeEach(async () => {
  // `:memory:` kullanılmaz: libSQL'de transaction ayrı bir bağlantı açtığından
  // bellek içi veritabanı bağlantılar arasında paylaşılmaz ve tablolar "yok" görünür.
  geciciKlasor = mkdtempSync(join(tmpdir(), 'market-api-test-'));
  vt = vtOlustur('file:' + join(geciciKlasor, 'merkez.db').replace(/\\/g, '/'));
  const yapilandirma = yapilandirmayiOku({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-gizli-anahtar-en-az-otuz-iki-karakter-olmali',
    LOG_SEVIYESI: 'fatal',
  } as NodeJS.ProcessEnv);
  uygulama = await sunucuOlustur({ yapilandirma, vt });

  const zaman = simdi();
  await vt.calistir('INSERT INTO isletmeler (id, ad, lisans_anahtari, aktif_mi, created_at) VALUES (?, ?, ?, 1, ?)', [
    ISLETME_ID,
    'Test Market',
    LISANS,
    zaman,
  ]);
  await vt.calistir(
    `INSERT INTO cihazlar (id, isletme_id, cihaz_id, cihaz_adi, token_hash, aktif_mi, created_at, updated_at)
     VALUES (?, ?, 'kasa-01', 'Kasa 1', ?, 1, ?, ?)`,
    [uuid(), ISLETME_ID, tokenHashle(CIHAZ_TOKEN), zaman, zaman],
  );
  await vt.calistir(
    `INSERT INTO panel_kullanicilari (id, isletme_id, ad, kullanici_adi, sifre_hash, rol, aktif_mi, created_at, updated_at)
     VALUES (?, ?, 'Patron', 'patron', ?, 'ADMIN', 1, ?, ?)`,
    [uuid(), ISLETME_ID, parolaHashle('Sifre1234'), zaman, zaman],
  );
});

afterEach(async () => {
  await uygulama?.close();
  vt?.kapat();
  // Windows dosya tanıtıcıyı hemen bırakmayabilir; temizlik başarısız olursa
  // testi düşürmeye değmez — geçici klasörü işletim sistemi temizler.
  try {
    if (geciciKlasor) rmSync(geciciKlasor, { recursive: true, force: true });
  } catch {
    /* yok sayılır */
  }
});

function satisOlayi(id = uuid(), tutar = 12_000) {
  return {
    uuid: id,
    tip: 'SATIS_YAPILDI' as const,
    entity: 'satis',
    entity_id: id,
    olusturma_zamani: simdi(),
    veri: {
      id,
      fis_no: 'A-000001',
      tarih: simdi(),
      ara_toplam: tutar,
      iskonto_toplam: 0,
      kdv_toplam: 2000,
      genel_toplam: tutar,
      odeme_ozeti: 'NAKIT',
      brut_kar: 4000,
      kalemler: [
        {
          urun_id: '22222222-2222-4222-8222-222222222222',
          urun_adi: 'Süt',
          miktar: 2000,
          birim_fiyat: 6000,
          birim_maliyet: 4000,
          kdv_orani: 20,
          kdv_tutar: 2000,
          satir_toplam: tutar,
        },
      ],
      odemeler: [{ tip: 'NAKIT', tutar }],
    },
  };
}

function push(olaylar: unknown[], token = CIHAZ_TOKEN) {
  return uygulama.inject({
    method: 'POST',
    url: UCLAR.senkronPush,
    headers: { 'x-device-token': token },
    payload: { cihaz_id: 'kasa-01', sema_surumu: 1, protokol_surumu: 1, olaylar },
  });
}

describe('cihaz kimlik doğrulama (§15.3)', () => {
  it('token olmadan push reddedilir', async () => {
    const yanit = await uygulama.inject({
      method: 'POST',
      url: UCLAR.senkronPush,
      payload: { cihaz_id: 'kasa-01', olaylar: [] },
    });
    expect(yanit.statusCode).toBe(403);
    expect(yanit.json().hata.kod).toBe('CIHAZ_YETKISIZ');
  });

  it('geçersiz token reddedilir', async () => {
    const yanit = await push([], 'gecersiz-token-ama-yeterince-uzun-123456');
    expect(yanit.statusCode).toBe(403);
  });

  it('iptal edilmiş cihaz reddedilir (§23.4)', async () => {
    await vt.calistir('UPDATE cihazlar SET aktif_mi = 0 WHERE isletme_id = ?', [ISLETME_ID]);
    const yanit = await push([satisOlayi()]);
    expect(yanit.statusCode).toBe(403);
  });
});

describe('PUSH — idempotency (§7.1, §25)', () => {
  it('aynı olay iki kez gönderilirse tek kayıt oluşur', async () => {
    const olay = satisOlayi();

    const ilk = await push([olay]);
    expect(ilk.statusCode).toBe(200);
    const ilkGovde = zPushYaniti.parse(ilk.json());
    expect(ilkGovde.kabul_edilen).toEqual([olay.uuid]);
    expect(ilkGovde.yinelenen).toEqual([]);

    const ikinci = await push([olay]);
    const ikinciGovde = zPushYaniti.parse(ikinci.json());
    expect(ikinciGovde.kabul_edilen).toEqual([]);
    expect(ikinciGovde.yinelenen).toEqual([olay.uuid]);

    const sayim = await vt.tek<{ adet: number }>('SELECT COUNT(*) adet FROM satislar WHERE isletme_id = ?', [ISLETME_ID]);
    expect(Number(sayim?.adet)).toBe(1);

    // Rollup da iki kez artmamalı.
    const ozet = await vt.tek<{ ciro: number; islem: number }>(
      'SELECT ciro, islem_sayisi islem FROM gunluk_ozet WHERE isletme_id = ? AND tarih = ?',
      [ISLETME_ID, bugun()],
    );
    expect(Number(ozet?.ciro)).toBe(12_000);
    expect(Number(ozet?.islem)).toBe(1);
  });

  it('kısmi başarı: bozuk olay reddedilir, sağlam olaylar kabul edilir', async () => {
    const saglam = satisOlayi();
    const bozuk = {
      uuid: uuid(),
      tip: 'STOK_HAREKETI' as const,
      entity: 'stok_hareketi',
      entity_id: 'x',
      olusturma_zamani: simdi(),
      // Geçersiz olay tipi işleyicide hata üretir
      veri: {},
    };
    const bilinmeyen = { ...bozuk, uuid: uuid(), tip: 'SATIS_YAPILDI' as const, veri: { id: null } };

    const yanit = await push([saglam, bozuk, bilinmeyen]);
    expect(yanit.statusCode).toBe(200);
    const govde = zPushYaniti.parse(yanit.json());
    expect(govde.kabul_edilen).toContain(saglam.uuid);

    const sayim = await vt.tek<{ adet: number }>('SELECT COUNT(*) adet FROM satislar WHERE isletme_id = ?', [ISLETME_ID]);
    expect(Number(sayim?.adet)).toBeGreaterThanOrEqual(1);
  });

  it('rollup satış olayından doğru üretilir', async () => {
    await push([satisOlayi(uuid(), 10_000), satisOlayi(uuid(), 5_000)]);

    const ozet = await vt.tek<{ ciro: number; islem: number; nakit: number; kar: number }>(
      'SELECT ciro, islem_sayisi islem, nakit, brut_kar kar FROM gunluk_ozet WHERE isletme_id = ? AND tarih = ?',
      [ISLETME_ID, bugun()],
    );
    expect(Number(ozet?.ciro)).toBe(15_000);
    expect(Number(ozet?.islem)).toBe(2);
    expect(Number(ozet?.nakit)).toBe(15_000);
    expect(Number(ozet?.kar)).toBe(8_000);
  });

  it('stok hareketi merkezi stok özetini günceller', async () => {
    const urunId = '33333333-3333-4333-8333-333333333333';
    await push([
      {
        uuid: uuid(),
        tip: 'STOK_HAREKETI',
        entity: 'stok_hareketi',
        entity_id: uuid(),
        olusturma_zamani: simdi(),
        veri: { id: uuid(), urun_id: urunId, hareket_tipi: 'GIRIS', miktar: 50_000, created_at: simdi() },
      },
      {
        uuid: uuid(),
        tip: 'STOK_HAREKETI',
        entity: 'stok_hareketi',
        entity_id: uuid(),
        olusturma_zamani: simdi(),
        veri: { id: uuid(), urun_id: urunId, hareket_tipi: 'SATIS', miktar: -8_000, created_at: simdi() },
      },
    ]);

    const stok = await vt.tek<{ miktar: number }>('SELECT miktar FROM stok_ozet WHERE isletme_id = ? AND urun_id = ?', [
      ISLETME_ID,
      urunId,
    ]);
    expect(Number(stok?.miktar)).toBe(42_000);
  });

  it('cari hareketi merkezi bakiyeyi günceller', async () => {
    const cariId = '44444444-4444-4444-8444-444444444444';
    await push([
      {
        uuid: uuid(),
        tip: 'CARI_HAREKETI',
        entity: 'cari_hareketi',
        entity_id: uuid(),
        olusturma_zamani: simdi(),
        veri: { id: uuid(), cari_id: cariId, hareket_tipi: 'BORC', tutar: 30_000, tarih: simdi() },
      },
      {
        uuid: uuid(),
        tip: 'CARI_HAREKETI',
        entity: 'cari_hareketi',
        entity_id: uuid(),
        olusturma_zamani: simdi(),
        veri: { id: uuid(), cari_id: cariId, hareket_tipi: 'TAHSILAT', tutar: -12_000, tarih: simdi() },
      },
    ]);

    const bakiye = await vt.tek<{ bakiye: number }>('SELECT bakiye FROM cari_ozet WHERE isletme_id = ? AND cari_id = ?', [
      ISLETME_ID,
      cariId,
    ]);
    expect(Number(bakiye?.bakiye)).toBe(18_000);
  });

  it('şema sürümü sunucudan yeniyse senkron güvenli reddedilir (§22.4)', async () => {
    const yanit = await uygulama.inject({
      method: 'POST',
      url: UCLAR.senkronPush,
      headers: { 'x-device-token': CIHAZ_TOKEN },
      payload: { cihaz_id: 'kasa-01', sema_surumu: 999, protokol_surumu: 1, olaylar: [] },
    });
    expect(yanit.statusCode).toBe(422);
    expect(yanit.json().hata.kod).toBe('SEMA_UYUMSUZ');
  });
});

describe('PULL — delta çekme (§7.3)', () => {
  it('imleçli sayfalama: sınır tablonun ortasında dolsa da hiçbir kayıt atlanmaz', async () => {
    const giris = await uygulama.inject({
      method: 'POST',
      url: UCLAR.giris,
      payload: { kullanici_adi: 'patron', sifre: 'Sifre1234' },
    });
    const token = giris.json().access_token as string;
    // Her ürün ardından kısa kodunu (barkod) yazar: sürümler tablolar arasında iç içe geçer.
    for (let i = 0; i < 6; i++) {
      const yanit = await uygulama.inject({
        method: 'POST',
        url: UCLAR.urunler,
        headers: { authorization: `Bearer ${token}` },
        payload: { ad: `Ürün ${i}`, satis_fiyati: 100, kdv_orani: 20, kisa_kod: String(100 + i) },
      });
      expect(yanit.statusCode).toBe(200);
    }

    const since = 0;
    let imlec: string | null | undefined = `0:${since}`;
    const gelen: { varlik: string }[] = [];
    for (let sayfa = 0; sayfa < 20 && imlec; sayfa++) {
      const yanit = zPullYaniti.parse(
        (
          await uygulama.inject({
            method: 'GET',
            url: `${UCLAR.senkronPull}?since=${since}&limit=4&imlec=${imlec}`,
            headers: { 'x-device-token': CIHAZ_TOKEN },
          })
        ).json(),
      );
      gelen.push(...yanit.kayitlar);
      imlec = yanit.has_more ? yanit.imlec : null;
    }

    expect(gelen.filter((k) => k.varlik === 'urunler')).toHaveLength(6);
    expect(gelen.filter((k) => k.varlik === 'barkodlar')).toHaveLength(6);
    // Bağımlılık sırası korunur: hiçbir barkod ürünlerden önce inmez.
    const ilkBarkod = gelen.findIndex((k) => k.varlik === 'barkodlar');
    const sonUrun = gelen.map((k) => k.varlik).lastIndexOf('urunler');
    expect(ilkBarkod).toBeGreaterThan(sonUrun);
  });

  it('panelde kısa kod değişince eski kod kasaya mezar taşı olarak iner', async () => {
    const giris = await uygulama.inject({
      method: 'POST',
      url: UCLAR.giris,
      payload: { kullanici_adi: 'patron', sifre: 'Sifre1234' },
    });
    const token = giris.json().access_token as string;
    const urunKaydet = (kisaKod: string, id: string) =>
      uygulama.inject({
        method: 'POST',
        url: UCLAR.urunler,
        headers: { authorization: `Bearer ${token}` },
        payload: { id, ad: 'Simit', satis_fiyati: 1500, kdv_orani: 1, kisa_kod: kisaKod },
      });
    const pull = async (since: number) =>
      zPullYaniti.parse(
        (
          await uygulama.inject({
            method: 'GET',
            url: `${UCLAR.senkronPull}?since=${since}&limit=500&imlec=0:${since}`,
            headers: { 'x-device-token': CIHAZ_TOKEN },
          })
        ).json(),
      );

    const id = uuid();
    expect((await urunKaydet('111', id)).statusCode).toBe(200);
    const ilk = await pull(0);
    expect((await urunKaydet('222', id)).statusCode).toBe(200);

    const barkodlar = (await pull(ilk.sunucu_versiyonu)).kayitlar.filter((k) => k.varlik === 'barkodlar');
    expect(
      barkodlar
        .map((k) => ({ barkod: k.veri.barkod, silindi: k.silindi_mi }))
        .sort((a, b) => String(a.barkod).localeCompare(String(b.barkod))),
    ).toEqual([
      { barkod: '111', silindi: true },
      { barkod: '222', silindi: false },
    ]);

    // Eski koda geri dönülebilir (mezardan geri gelir) ve başka ürün aynı kodu alamaz.
    expect((await urunKaydet('111', id)).statusCode).toBe(200);
    expect((await urunKaydet('111', uuid())).statusCode).toBe(400);
  });

  it('panelden eklenen ürün kasaya delta olarak iner', async () => {
    const giris = await uygulama.inject({
      method: 'POST',
      url: UCLAR.giris,
      payload: { kullanici_adi: 'patron', sifre: 'Sifre1234' },
    });
    expect(giris.statusCode).toBe(200);
    const token = giris.json().access_token;

    const urunYanit = await uygulama.inject({
      method: 'POST',
      url: UCLAR.urunler,
      headers: { authorization: `Bearer ${token}` },
      payload: { ad: 'Panelden Eklenen Ürün', satis_fiyati: 2500, kdv_orani: 20 },
    });
    expect(urunYanit.statusCode).toBe(200);

    const pull = await uygulama.inject({
      method: 'GET',
      url: `${UCLAR.senkronPull}?since=0&limit=500`,
      headers: { 'x-device-token': CIHAZ_TOKEN },
    });
    expect(pull.statusCode).toBe(200);
    const govde = zPullYaniti.parse(pull.json());
    const urunler = govde.kayitlar.filter((k) => k.varlik === 'urunler');
    expect(urunler).toHaveLength(1);
    expect(urunler[0]?.veri.ad).toBe('Panelden Eklenen Ürün');
    expect(urunler[0]?.veri.aktif_mi).toBe(true);
    expect(govde.sunucu_versiyonu).toBeGreaterThan(0);
  });

  it('since damgasından sonra değişen kayıt yoksa boş döner', async () => {
    const ilk = await uygulama.inject({
      method: 'GET',
      url: `${UCLAR.senkronPull}?since=0&limit=500`,
      headers: { 'x-device-token': CIHAZ_TOKEN },
    });
    const versiyon = zPullYaniti.parse(ilk.json()).sunucu_versiyonu;

    const ikinci = await uygulama.inject({
      method: 'GET',
      url: `${UCLAR.senkronPull}?since=${versiyon}&limit=500`,
      headers: { 'x-device-token': CIHAZ_TOKEN },
    });
    expect(zPullYaniti.parse(ikinci.json()).kayitlar).toHaveLength(0);
  });
});

describe('kasadan gelen kullanıcı kaydı (§12.1)', () => {
  const kullaniciOlayi = (id: string, rol: string, pinHash: string, zaman: string) => ({
    uuid: uuid(),
    tip: 'KULLANICI_KAYDEDILDI' as const,
    entity: 'kullanici',
    entity_id: id,
    olusturma_zamani: zaman,
    veri: { id, ad: 'Ali', kullanici_adi: 'ali', rol, pin_hash: pinHash, created_at: zaman, updated_at: zaman },
  });

  it("yeni hesabı açar ama var olan kullanıcının rolünü ve PIN'ini ezemez", async () => {
    const id = uuid();
    await push([kullaniciOlayi(id, 'KASIYER', 'pin-1', simdi())]);
    const sonra = new Date(Date.now() + 60_000).toISOString();
    const yanit = await push([kullaniciOlayi(id, 'ADMIN', 'pin-2', sonra)]);
    expect(zPushYaniti.parse(yanit.json()).kabul_edilen).toHaveLength(1);

    const kullanici = await vt.tek<{ rol: string; pin_hash: string }>(
      'SELECT rol, pin_hash FROM kullanicilar WHERE isletme_id = ? AND id = ?',
      [ISLETME_ID, id],
    );
    expect(kullanici).toMatchObject({ rol: 'KASIYER', pin_hash: 'pin-1' });
  });
});

describe('LWW çakışma çözümü (§7.4)', () => {
  it('bulut kaydı daha yeniyse kasadan gelen eski veri uygulanmaz ve çakışma loglanır', async () => {
    const urunId = '55555555-5555-4555-8555-555555555555';
    const gelecek = new Date(Date.now() + 3600_000).toISOString();
    const gecmis = new Date(Date.now() - 3600_000).toISOString();

    // Önce bulutta yeni bir kayıt (panel tarafı gibi)
    await push([
      {
        uuid: uuid(),
        tip: 'URUN_KAYDEDILDI',
        entity: 'urun',
        entity_id: urunId,
        olusturma_zamani: simdi(),
        veri: { id: urunId, ad: 'Yeni İsim', satis_fiyati: 5000, updated_at: gelecek, created_at: gecmis },
      },
    ]);

    // Sonra kasadan ESKİ zaman damgalı bir güncelleme
    await push([
      {
        uuid: uuid(),
        tip: 'URUN_KAYDEDILDI',
        entity: 'urun',
        entity_id: urunId,
        olusturma_zamani: simdi(),
        veri: { id: urunId, ad: 'Eski İsim', satis_fiyati: 1000, updated_at: gecmis, created_at: gecmis },
      },
    ]);

    const urun = await vt.tek<{ ad: string; satis_fiyati: number }>(
      'SELECT ad, satis_fiyati FROM urunler WHERE isletme_id = ? AND id = ?',
      [ISLETME_ID, urunId],
    );
    expect(urun?.ad).toBe('Yeni İsim');
    expect(Number(urun?.satis_fiyati)).toBe(5000);

    const cakisma = await vt.tek<{ adet: number }>('SELECT COUNT(*) adet FROM sync_cakismalar WHERE isletme_id = ?', [
      ISLETME_ID,
    ]);
    expect(Number(cakisma?.adet)).toBe(1);
  });
});

describe('kasada açılan kampanya (§11.8)', () => {
  const kampanyaId = '66666666-6666-4666-8666-666666666666';
  const kampanyaOlayi = (ad: string, updated_at: string, aktif_mi = true) => ({
    uuid: uuid(),
    tip: 'KAMPANYA_KAYDEDILDI' as const,
    entity: 'kampanya',
    entity_id: kampanyaId,
    olusturma_zamani: simdi(),
    veri: {
      id: kampanyaId,
      ad,
      tip: 'N_AL_M_ODE',
      kapsam: 'TUM',
      hedef_id: null,
      deger: 2,
      esik_miktar: 3000,
      baslangic: '2026-01-01T00:00:00.000Z',
      bitis: '2026-12-31T23:59:59.000Z',
      oncelik: 1,
      aktif_mi,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at,
    },
  });

  it('buluta yazılır, sürüm alır ve diğer kasalara pull ile iner', async () => {
    const yanit = await push([kampanyaOlayi('3 al 2 öde', new Date().toISOString())]);
    expect(yanit.statusCode).toBe(200);

    const kayit = await vt.tek<{ ad: string; esik_miktar: number; aktif_mi: number; versiyon: number }>(
      'SELECT ad, esik_miktar, aktif_mi, versiyon FROM kampanyalar WHERE isletme_id = ? AND id = ?',
      [ISLETME_ID, kampanyaId],
    );
    expect(kayit).toMatchObject({ ad: '3 al 2 öde' });
    expect(Number(kayit?.esik_miktar)).toBe(3000);
    expect(Number(kayit?.aktif_mi)).toBe(1);
    expect(Number(kayit?.versiyon)).toBeGreaterThan(0);

    const pull = await uygulama.inject({
      method: 'GET',
      url: `${UCLAR.senkronPull}?since=0&limit=100`,
      headers: { 'x-device-token': CIHAZ_TOKEN },
    });
    expect(JSON.stringify(pull.json())).toContain(kampanyaId);
  });

  it('pasife alınan kampanya bulutta da pasif olur; eski tarihli kasa kaydı yenisini ezmez', async () => {
    await push([kampanyaOlayi('Yeni', new Date(Date.now() + 60_000).toISOString(), false)]);
    await push([kampanyaOlayi('Eski', new Date(Date.now() - 60_000).toISOString(), true)]);
    const kayit = await vt.tek<{ ad: string; aktif_mi: number }>(
      'SELECT ad, aktif_mi FROM kampanyalar WHERE isletme_id = ? AND id = ?',
      [ISLETME_ID, kampanyaId],
    );
    expect(kayit?.ad).toBe('Yeni');
    expect(Number(kayit?.aktif_mi)).toBe(0);
  });
});

describe('durum ve mutabakat (§18.4)', () => {
  it('sunucu kayıt sayılarını raporlar', async () => {
    await push([satisOlayi()]);
    const yanit = await uygulama.inject({
      method: 'GET',
      url: UCLAR.senkronDurum,
      headers: { 'x-device-token': CIHAZ_TOKEN },
    });
    const govde = zSenkronDurumYaniti.parse(yanit.json());
    expect(govde.sayimlar.satislar).toBe(1);
    expect(govde.son_push).not.toBeNull();
    // Sabite bağlanır: şema sürümü arttıkça test kendiliğinden güncel kalsın.
    expect(govde.sema_surumu).toBe(SEMA_SURUMU);
  });
});

describe('sağlık uçları (§19.3)', () => {
  it('health ve ready 200 döner', async () => {
    expect((await uygulama.inject({ method: 'GET', url: UCLAR.saglik })).statusCode).toBe(200);
    const hazir = await uygulama.inject({ method: 'GET', url: UCLAR.hazir });
    expect(hazir.statusCode).toBe(200);
    expect(hazir.json().db).toBe('iyi');
  });
});

describe('panel kimlik doğrulama (§15.1)', () => {
  it('yanlış şifre 401 döner', async () => {
    const yanit = await uygulama.inject({
      method: 'POST',
      url: UCLAR.giris,
      payload: { kullanici_adi: 'patron', sifre: 'yanlis' },
    });
    expect(yanit.statusCode).toBe(401);
  });

  it('JWT olmadan yönetim ucu 401 döner', async () => {
    const yanit = await uygulama.inject({ method: 'GET', url: UCLAR.urunler });
    expect(yanit.statusCode).toBe(401);
  });

  it('refresh token rotasyonu eski tokenı geçersiz kılar', async () => {
    const giris = await uygulama.inject({
      method: 'POST',
      url: UCLAR.giris,
      payload: { kullanici_adi: 'patron', sifre: 'Sifre1234' },
    });
    const refresh = giris.json().refresh_token;

    const ilk = await uygulama.inject({ method: 'POST', url: UCLAR.yenile, payload: { refresh_token: refresh } });
    expect(ilk.statusCode).toBe(200);

    const ikinci = await uygulama.inject({ method: 'POST', url: UCLAR.yenile, payload: { refresh_token: refresh } });
    expect(ikinci.statusCode).toBe(401);
  });
});

describe('kasa-panel uyumu — mal kabul ve tedarikçi hareketleri', () => {
  const TEDARIKCI_ID = '33333333-3333-4333-8333-333333333333';

  function tedarikciKaydiOlayi() {
    const zaman = simdi();
    return {
      uuid: uuid(),
      tip: 'CARI_KAYDEDILDI' as const,
      entity: 'cari',
      entity_id: TEDARIKCI_ID,
      olusturma_zamani: zaman,
      veri: { id: TEDARIKCI_ID, tip: 'TEDARIKCI', ad_unvan: 'Toptancı A.Ş.', created_at: zaman, updated_at: zaman },
    };
  }

  it('ALIS_FATURASI_ONAYLANDI tedarikçi borcunu merkezde oluşturur (kasa ayrı BORC olayı göndermez)', async () => {
    const faturaId = uuid();
    const alisOlayi = {
      uuid: uuid(),
      tip: 'ALIS_FATURASI_ONAYLANDI' as const,
      entity: 'alis_faturasi',
      entity_id: faturaId,
      olusturma_zamani: simdi(),
      veri: {
        id: faturaId,
        tedarikci_id: TEDARIKCI_ID,
        fatura_no: 'F-2026-17',
        tarih: simdi(),
        genel_toplam: 16_800,
        kalemler: [{ urun_id: '22222222-2222-4222-8222-222222222222', miktar: 2000, birim_fiyat: 700 }],
      },
    };

    const yanit = await push([tedarikciKaydiOlayi(), alisOlayi]);
    expect(yanit.statusCode).toBe(200);
    expect(zPushYaniti.parse(yanit.json()).kabul_edilen).toHaveLength(2);

    const bakiye = await vt.tek<{ bakiye: number }>('SELECT bakiye FROM cari_ozet WHERE isletme_id = ? AND cari_id = ?', [
      ISLETME_ID,
      TEDARIKCI_ID,
    ]);
    expect(Number(bakiye?.bakiye)).toBe(16_800);

    const hareket = await vt.tek<{ hareket_tipi: string; tutar: number; belge_id: string }>(
      'SELECT hareket_tipi, tutar, belge_id FROM cari_hareketler WHERE isletme_id = ? AND cari_id = ?',
      [ISLETME_ID, TEDARIKCI_ID],
    );
    expect(hareket?.hareket_tipi).toBe('BORC');
    expect(Number(hareket?.tutar)).toBe(16_800);
    expect(hareket?.belge_id).toBe(faturaId);

    // Aynı fatura ikinci kez gönderilirse borç ikilenmez.
    const tekrar = await push([alisOlayi]);
    expect(zPushYaniti.parse(tekrar.json()).yinelenen).toContain(alisOlayi.uuid);
    const sonBakiye = await vt.tek<{ bakiye: number }>('SELECT bakiye FROM cari_ozet WHERE isletme_id = ? AND cari_id = ?', [
      ISLETME_ID,
      TEDARIKCI_ID,
    ]);
    expect(Number(sonBakiye?.bakiye)).toBe(16_800);
  });

  it('tedarikçi iadesi (CARI_HAREKETI IADE) borcu azaltır, TEDARIKCI_IADE stok çıkışı stok özetini düşürür', async () => {
    const urunId = '22222222-2222-4222-8222-222222222222';
    const iadeBelgeId = uuid();
    const zaman = simdi();

    const stokIade = {
      uuid: uuid(),
      tip: 'STOK_HAREKETI' as const,
      entity: 'stok_hareketi',
      entity_id: uuid(),
      olusturma_zamani: zaman,
      veri: { id: uuid(), urun_id: urunId, hareket_tipi: 'TEDARIKCI_IADE', miktar: -2000, created_at: zaman },
    };
    const cariIade = {
      uuid: uuid(),
      tip: 'CARI_HAREKETI' as const,
      entity: 'cari_hareketi',
      entity_id: uuid(),
      olusturma_zamani: zaman,
      veri: {
        id: uuid(),
        cari_id: TEDARIKCI_ID,
        hareket_tipi: 'IADE',
        tutar: -16_800,
        belge_id: iadeBelgeId,
        tarih: zaman,
      },
    };

    const yanit = await push([tedarikciKaydiOlayi(), stokIade, cariIade]);
    expect(zPushYaniti.parse(yanit.json()).kabul_edilen).toHaveLength(3);

    const stok = await vt.tek<{ miktar: number }>('SELECT miktar FROM stok_ozet WHERE isletme_id = ? AND urun_id = ?', [
      ISLETME_ID,
      urunId,
    ]);
    expect(Number(stok?.miktar)).toBe(-2000);

    const bakiye = await vt.tek<{ bakiye: number }>('SELECT bakiye FROM cari_ozet WHERE isletme_id = ? AND cari_id = ?', [
      ISLETME_ID,
      TEDARIKCI_ID,
    ]);
    expect(Number(bakiye?.bakiye)).toBe(-16_800);

    // İade, günlük özetteki tahsilat alanına DOKUNMAZ (kasadaki kuralla aynı).
    const ozet = await vt.tek<{ tahsilat: number }>(
      'SELECT COALESCE(SUM(tahsilat),0) tahsilat FROM gunluk_ozet WHERE isletme_id = ?',
      [ISLETME_ID],
    );
    expect(Number(ozet?.tahsilat)).toBe(0);
  });

  it('kasa hareketindeki günlük özet etkisi aynen uygulanır; tahsilat ikinci kez türetilmez', async () => {
    const zaman = simdi();
    const oturumId = uuid();
    const kasaHareketi = (tip: string, tutar: number, etki: Record<string, number>) => ({
      uuid: uuid(),
      tip: 'KASA_HAREKETI' as const,
      entity: 'kasa_hareketi',
      entity_id: uuid(),
      olusturma_zamani: zaman,
      veri: { id: uuid(), kasa_oturum_id: oturumId, tip, tutar, created_at: zaman, gunluk_ozet: etki },
    });
    const cariId = uuid();
    const tahsilatCari = {
      uuid: uuid(),
      tip: 'CARI_HAREKETI' as const,
      entity: 'cari_hareketi',
      entity_id: uuid(),
      olusturma_zamani: zaman,
      veri: {
        id: uuid(),
        cari_id: cariId,
        hareket_tipi: 'TAHSILAT',
        tutar: -1500,
        odeme_tipi: 'NAKIT',
        gunluk_ozet_kasada: true,
        tarih: zaman,
      },
    };

    const yanit = await push([
      kasaHareketi('GIRIS', 5000, { nakit: 5000 }),
      kasaHareketi('ODEME', -3000, { nakit: -3000 }), // mal kabulde nakit ödeme
      kasaHareketi('GIDER', -700, { gider: 700, nakit: -700 }),
      tahsilatCari,
      kasaHareketi('TAHSILAT', 1500, { tahsilat: 1500, nakit: 1500 }),
    ]);
    expect(zPushYaniti.parse(yanit.json()).kabul_edilen).toHaveLength(5);

    const ozet = await vt.tek<{ nakit: number; tahsilat: number; gider: number }>(
      'SELECT SUM(nakit) nakit, SUM(tahsilat) tahsilat, SUM(gider) gider FROM gunluk_ozet WHERE isletme_id = ?',
      [ISLETME_ID],
    );
    expect({ nakit: Number(ozet?.nakit), tahsilat: Number(ozet?.tahsilat), gider: Number(ozet?.gider) }).toEqual({
      nakit: 5000 - 3000 - 700 + 1500,
      tahsilat: 1500,
      gider: 700,
    });
  });

  it('nakit tahsilat rollup işareti kasayla aynıdır: müşteri +, tedarikçi −, kart hariç', async () => {
    const MUSTERI_ID = '44444444-4444-4444-8444-444444444444';
    const zaman = simdi();
    const musteriKaydi = {
      uuid: uuid(),
      tip: 'CARI_KAYDEDILDI' as const,
      entity: 'cari',
      entity_id: MUSTERI_ID,
      olusturma_zamani: zaman,
      veri: { id: MUSTERI_ID, tip: 'MUSTERI', ad_unvan: 'Veresiye Müşterisi', created_at: zaman, updated_at: zaman },
    };
    const nakitTahsilat = {
      uuid: uuid(),
      tip: 'CARI_HAREKETI' as const,
      entity: 'cari_hareketi',
      entity_id: uuid(),
      olusturma_zamani: zaman,
      veri: { id: uuid(), cari_id: MUSTERI_ID, hareket_tipi: 'TAHSILAT', tutar: -5000, odeme_tipi: 'NAKIT', tarih: zaman },
    };
    const kartTahsilat = {
      uuid: uuid(),
      tip: 'CARI_HAREKETI' as const,
      entity: 'cari_hareketi',
      entity_id: uuid(),
      olusturma_zamani: zaman,
      veri: { id: uuid(), cari_id: MUSTERI_ID, hareket_tipi: 'TAHSILAT', tutar: -3000, odeme_tipi: 'KART', tarih: zaman },
    };
    const tedarikciOdeme = {
      uuid: uuid(),
      tip: 'CARI_HAREKETI' as const,
      entity: 'cari_hareketi',
      entity_id: uuid(),
      olusturma_zamani: zaman,
      veri: { id: uuid(), cari_id: TEDARIKCI_ID, hareket_tipi: 'ODEME', tutar: -2000, odeme_tipi: 'NAKIT', tarih: zaman },
    };

    const yanit = await push([musteriKaydi, tedarikciKaydiOlayi(), nakitTahsilat, kartTahsilat, tedarikciOdeme]);
    expect(zPushYaniti.parse(yanit.json()).kabul_edilen).toHaveLength(5);

    // +5000 (nakit tahsilat) − 2000 (tedarikçi ödemesi); kart tahsilatı rollup dışı.
    const ozet = await vt.tek<{ tahsilat: number; nakit: number }>(
      'SELECT COALESCE(SUM(tahsilat),0) tahsilat, COALESCE(SUM(nakit),0) nakit FROM gunluk_ozet WHERE isletme_id = ?',
      [ISLETME_ID],
    );
    expect(Number(ozet?.tahsilat)).toBe(3000);
    expect(Number(ozet?.nakit)).toBe(3000);

    // Bakiyeler: müşteri −8000 (iki tahsilat), tedarikçi −2000 (ödeme).
    const musteri = await vt.tek<{ bakiye: number }>('SELECT bakiye FROM cari_ozet WHERE isletme_id = ? AND cari_id = ?', [
      ISLETME_ID,
      MUSTERI_ID,
    ]);
    expect(Number(musteri?.bakiye)).toBe(-8000);
  });
});

describe('satışın stoğa etkisi (§7.3)', () => {
  /**
   * Satış olayı kalemleri taşır ve kasa stok çıkışı için AYRI bir olay
   * göndermez. Bulut stok özetini satış olayından düşmezse panel ile kasa
   * ayrışır: kasada 7 adet görünen ürün panelde 20 kalır.
   */
  async function stokOku(urunId: string): Promise<number> {
    const satir = await vt.tek<{ miktar: number }>('SELECT miktar FROM stok_ozet WHERE isletme_id = ? AND urun_id = ?', [
      ISLETME_ID,
      urunId,
    ]);
    return Number(satir?.miktar ?? 0);
  }

  const URUN = '22222222-2222-4222-8222-222222222222';

  it('satış stok özetinden düşer', async () => {
    await push([satisOlayi()]);
    // Fikstürde 2000 bindebir (2 adet) satılıyor.
    expect(await stokOku(URUN)).toBe(-2000);
  });

  it('aynı satış iki kez gelirse stok bir kez düşer', async () => {
    const olay = satisOlayi();
    await push([olay]);
    await push([olay]);
    expect(await stokOku(URUN)).toBe(-2000);
  });

  it('stok hareketi ve satış birlikte doğru toplanır', async () => {
    await push([
      {
        uuid: uuid(),
        tip: 'STOK_HAREKETI' as const,
        entity: 'stok_hareketi',
        entity_id: uuid(),
        olusturma_zamani: simdi(),
        veri: { id: uuid(), urun_id: URUN, hareket_tipi: 'ACILIS', miktar: 10_000, birim_maliyet: 4000 },
      },
    ]);
    await push([satisOlayi()]);
    expect(await stokOku(URUN)).toBe(8000);
  });
});

describe('satış iptalinin stoğa etkisi (§7.3)', () => {
  const URUN = '22222222-2222-4222-8222-222222222222';

  async function stok(): Promise<number> {
    const satir = await vt.tek<{ miktar: number }>('SELECT miktar FROM stok_ozet WHERE isletme_id = ? AND urun_id = ?', [
      ISLETME_ID,
      URUN,
    ]);
    return Number(satir?.miktar ?? 0);
  }

  function iptalOlayi(satisId: string) {
    return {
      uuid: uuid(),
      tip: 'SATIS_IPTAL_EDILDI' as const,
      entity: 'satis',
      entity_id: satisId,
      olusturma_zamani: simdi(),
      veri: { id: satisId, iptal_neden: 'Yanlış satış' },
    };
  }

  it('iptal edilen satışın stoğu geri döner', async () => {
    const satisId = uuid();
    await push([satisOlayi(satisId)]);
    expect(await stok()).toBe(-2000);

    await push([iptalOlayi(satisId)]);
    expect(await stok()).toBe(0);
  });

  it('aynı satış iki kez iptal edilse stok bir kez geri döner', async () => {
    const satisId = uuid();
    await push([satisOlayi(satisId)]);
    await push([iptalOlayi(satisId)]);
    await push([iptalOlayi(satisId)]);
    expect(await stok()).toBe(0);
  });
});

describe('veresiye satışın cariye etkisi (§7.3)', () => {
  /**
   * Kasa veresiye satışta cari borcu YERELDE yazar ama ayrı bir olay
   * göndermez; satış olayı `musteri_id` ve ödeme kırılımını zaten taşır.
   * Bulut bundan borç türetmezse panelin Cari ekranı boş görünür.
   */
  const MUSTERI = '33333333-3333-4333-8333-333333333333';

  async function bakiye(): Promise<number> {
    const satir = await vt.tek<{ bakiye: number }>('SELECT bakiye FROM cari_ozet WHERE isletme_id = ? AND cari_id = ?', [
      ISLETME_ID,
      MUSTERI,
    ]);
    return Number(satir?.bakiye ?? 0);
  }

  function veresiyeSatis(id = uuid(), tutar = 12_000) {
    const olay = satisOlayi(id, tutar);
    return {
      ...olay,
      veri: { ...olay.veri, musteri_id: MUSTERI, odeme_ozeti: 'VERESIYE', odemeler: [{ tip: 'VERESIYE', tutar }] },
    };
  }

  it('veresiye satış müşterinin borcunu artırır', async () => {
    await push([veresiyeSatis()]);
    expect(await bakiye()).toBe(12_000);
  });

  it('aynı satış iki kez gelirse borç bir kez yazılır', async () => {
    const olay = veresiyeSatis();
    await push([olay]);
    await push([olay]);
    expect(await bakiye()).toBe(12_000);
  });

  it('nakit satış cariye dokunmaz', async () => {
    await push([satisOlayi()]);
    expect(await bakiye()).toBe(0);
  });
});
