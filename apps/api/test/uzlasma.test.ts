/**
 * Kasa ↔ bulut uzlaşma testi (§7.3).
 *
 * NEDEN VAR: Kasa bir satış yaptığında stok çıkışını ve cari borcu YEREL
 * tablolara yazar, ama bunlar için ayrı senkron olayı göndermez — kalemler ve
 * ödemeler `SATIS_YAPILDI` olayının içindedir. Bulut bu olaydan hangi özeti
 * türetmeyi unutursa iki taraf sessizce ayrışır: kasada 7 adet görünen ürün
 * panelde 20 kalır. Böyle bir hata hiçbir birim testine takılmaz, çünkü her iki
 * taraf da kendi içinde tutarlıdır.
 *
 * Bu test GERÇEK kasayı çalıştırır, GERÇEK outbox olaylarını GERÇEK push ucuna
 * gönderir ve sonra her özet tablosunu kasadaki gerçekle karşılaştırır. Yeni bir
 * özet tablosu eklendiğinde buraya bir iddia eklemek, o özetin senkron
 * boşluğuna düşmesini engeller.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { adet, miktarOlustur, simdi, uuid } from '@market/shared';

import { tokenHashle } from '../src/guvenlik.js';
import { sunucuOlustur } from '../src/sunucu.js';
import { vtOlustur, type MerkezVt } from '../src/vt/baglanti.js';
import { yapilandirmayiOku } from '../src/yapilandirma.js';

import { Uygulama } from '../../desktop/src/main/uygulama.js';
import { bekleyenOlaylar } from '../../desktop/src/main/depo/senkron.js';
import { senkronCalistir } from '../../desktop/src/main/senkron/motor.js';
import { bakiyeOku } from '../../desktop/src/main/depo/cari.js';
import { cariKaydet } from '../../desktop/src/main/servis/cari-servis.js';
import { stokOku } from '../../desktop/src/main/depo/stok.js';
import { urunuKaydet } from '../../desktop/src/main/servis/katalog-servis.js';
import { kasaAc, kasaHareketi } from '../../desktop/src/main/servis/kasa-servis.js';
import { tahsilatYap } from '../../desktop/src/main/servis/cari-servis.js';
import { satisKesinlestir, satisIptal, iadeYap } from '../../desktop/src/main/servis/satis-servis.js';
import { kalemleriGetir } from '../../desktop/src/main/depo/satis.js';
import { stokDuzeltme, malKabulOnayla } from '../../desktop/src/main/servis/stok-servis.js';
import { etkinYetkiler } from '@market/shared';
import type { Aktor } from '../../desktop/src/main/servis/baglam.js';

const ISLETME_ID = '44444444-4444-4444-8444-444444444444';
const CIHAZ_TOKEN = 'uzlasma-test-cihaz-tokeni-1234567890';
const CIHAZ_ID = 'kasa-uzlasma';

let bulut: FastifyInstance;
let bulutVt: MerkezVt;
let kasa: Uygulama;
let admin: Aktor;
let geciciKlasor: string;

beforeEach(async () => {
  geciciKlasor = mkdtempSync(join(tmpdir(), 'market-uzlasma-'));

  // --- Bulut ---
  bulutVt = vtOlustur('file:' + join(geciciKlasor, 'merkez.db').replace(/\\/g, '/'));
  bulut = await sunucuOlustur({
    yapilandirma: yapilandirmayiOku({
      NODE_ENV: 'test',
      JWT_SECRET: 'uzlasma-testi-icin-en-az-otuz-iki-karakterlik-anahtar',
      LOG_SEVIYESI: 'fatal',
    } as NodeJS.ProcessEnv),
    vt: bulutVt,
  });

  const zaman = simdi();
  await bulutVt.calistir('INSERT INTO isletmeler (id, ad, lisans_anahtari, aktif_mi, created_at) VALUES (?, ?, ?, 1, ?)', [
    ISLETME_ID,
    'Uzlaşma Marketi',
    'UZLASMA-LISANS',
    zaman,
  ]);
  await bulutVt.calistir(
    `INSERT INTO cihazlar (id, isletme_id, cihaz_id, cihaz_adi, token_hash, aktif_mi, created_at, updated_at)
     VALUES (?, ?, ?, 'Kasa 1', ?, 1, ?, ?)`,
    [uuid(), ISLETME_ID, CIHAZ_ID, tokenHashle(CIHAZ_TOKEN), zaman, zaman],
  );

  // --- Kasa ---
  kasa = await Uygulama.olustur({
    veriKoku: geciciKlasor,
    vtYolu: ':memory:',
    sessiz: true,
    zamanlayiciKapali: true,
  });
  const adminId = kasa.yoneticiOlustur({ ad: 'Patron', kullaniciAdi: 'patron', sifre: 'Sifre1234', pin: '4271' });
  admin = {
    kullaniciId: adminId,
    ad: 'Patron',
    rol: 'ADMIN',
    yetkiler: etkinYetkiler({ rol: 'ADMIN' }),
    kasaOturumId: null,
  };
  admin.kasaOturumId = kasaAc(kasa.baglam, admin, 10_000).oturumId;
});

afterEach(async () => {
  await kasa?.kapat();
  await bulut?.close();
  bulutVt?.kapat();
  try {
    rmSync(geciciKlasor, { recursive: true, force: true });
  } catch {
    /* işletim sistemi temizler */
  }
});

/**
 * Fastify `inject`'i `fetch` gibi gösteren köprü.
 *
 * Böylece testte GERÇEK senkron motorunu (`senkronCalistir`) çalıştırabiliyoruz:
 * push/pull sırası, sayfalama, olay işaretleme — hepsi üretimdeki kodun aynısı.
 * Elle kurulmuş bir gönderim döngüsü, tam da bu sıralamadan doğan hataları
 * kaçırırdı.
 */
const injectGetir: typeof fetch = (async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
  const url = new URL(String(girdi));
  const yanit = await bulut.inject({
    method: (secenekler?.method ?? 'GET') as 'GET' | 'POST',
    url: url.pathname + url.search,
    headers: (secenekler?.headers ?? {}) as Record<string, string>,
    payload: secenekler?.body ? String(secenekler.body) : undefined,
  });
  return {
    ok: yanit.statusCode >= 200 && yanit.statusCode < 300,
    status: yanit.statusCode,
    text: async () => yanit.body,
  } as Response;
}) as typeof fetch;

/** Gerçek senkron turu: push → pull → (üretilmişse) tekrar push. */
async function senkronla(): Promise<void> {
  const sonuc = await senkronCalistir(kasa.baglam, {
    temelUrl: 'http://test.local',
    cihazToken: CIHAZ_TOKEN,
    getir: injectGetir,
  });
  expect(sonuc.basarili, `senkron başarısız: ${sonuc.hata ?? ''}`).toBe(true);
  expect(sonuc.reddedilen, 'sunucu olay reddetti').toBe(0);
}

/** Buluttaki bir ürünün özet stoğu. */
async function bulutStok(urunId: string): Promise<number> {
  const satir = await bulutVt.tek<{ miktar: number }>('SELECT miktar FROM stok_ozet WHERE isletme_id = ? AND urun_id = ?', [
    ISLETME_ID,
    urunId,
  ]);
  return Number(satir?.miktar ?? 0);
}

/** Buluttaki bir carinin özet bakiyesi. */
async function bulutBakiye(cariId: string): Promise<number> {
  const satir = await bulutVt.tek<{ bakiye: number }>('SELECT bakiye FROM cari_ozet WHERE isletme_id = ? AND cari_id = ?', [
    ISLETME_ID,
    cariId,
  ]);
  return Number(satir?.bakiye ?? 0);
}

/** Buluttaki kasa hareketleri — vardiya dökümünün merkezdeki karşılığı. */
async function bulutKasaHareketleri(): Promise<{ adet: number; toplam: number }> {
  const satir = await bulutVt.tek<{ adet: number; toplam: number }>(
    'SELECT COUNT(*) AS adet, COALESCE(SUM(tutar), 0) AS toplam FROM kasa_hareketleri WHERE isletme_id = ?',
    [ISLETME_ID],
  );
  return { adet: Number(satir?.adet ?? 0), toplam: Number(satir?.toplam ?? 0) };
}

/** Kasadaki kasa hareketleri. */
function kasaKasaHareketleri(): { adet: number; toplam: number } {
  const satir = kasa.vt
    .hazirla('SELECT COUNT(*) AS adet, COALESCE(SUM(tutar), 0) AS toplam FROM kasa_hareketleri')
    .tek<{ adet: number; toplam: number }>();
  return { adet: Number(satir?.adet ?? 0), toplam: Number(satir?.toplam ?? 0) };
}

function urunEkle(ad: string, secenekler: { fiyat?: number; stok?: number; birim?: 'ADET' | 'KG' } = {}): string {
  return urunuKaydet(kasa.baglam, admin, {
    ad,
    birim_tipi: secenekler.birim ?? 'ADET',
    satis_fiyati: secenekler.fiyat ?? 10_000,
    alis_fiyati: 6000,
    kdv_orani: 20,
    acilis_stogu: secenekler.stok ?? adet(100),
  });
}

describe('kasa ↔ bulut uzlaşması', () => {
  it('nakit satış sonrası stok iki tarafta da aynıdır', async () => {
    const urunId = urunEkle('Süt', { stok: adet(50) });
    satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(3), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 30_000, alinan: 30_000 }],
    });

    await senkronla();

    expect(await bulutStok(urunId)).toBe(stokOku(kasa.vt, urunId));
    expect(await bulutStok(urunId)).toBe(adet(47));
  });

  it('veresiye satış sonrası cari bakiye iki tarafta da aynıdır', async () => {
    const urunId = urunEkle('Ekmek', { stok: adet(40) });
    const musteriId = cariKaydet(kasa.baglam, admin, { tip: 'MUSTERI', ad_unvan: 'Veresiyeci Ali', kredi_limiti: 0 });

    satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(2), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'VERESIYE', tutar: 20_000 }],
      musteri_id: musteriId,
      limit_asimi_onaylandi: true,
    });

    await senkronla();

    expect(await bulutBakiye(musteriId)).toBe(bakiyeOku(kasa.vt, musteriId));
    expect(await bulutBakiye(musteriId)).toBe(20_000);
  });

  it('KG ürünün kesirli miktarı bindebir olarak korunur', async () => {
    const urunId = urunEkle('Domates', { birim: 'KG', stok: miktarOlustur(20), fiyat: 4500 });
    satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: miktarOlustur(1.5), birim_fiyat: 4500 }],
      odemeler: [{ tip: 'NAKIT', tutar: 6750, alinan: 7000 }],
    });

    await senkronla();

    expect(await bulutStok(urunId)).toBe(stokOku(kasa.vt, urunId));
    expect(await bulutStok(urunId)).toBe(miktarOlustur(18.5));
  });

  it('stok düzeltmesi iki tarafta da aynı sonucu verir', async () => {
    const urunId = urunEkle('Peynir', { stok: adet(30) });
    stokDuzeltme(kasa.baglam, admin, urunId, adet(22), 'Sayım farkı');

    await senkronla();

    expect(await bulutStok(urunId)).toBe(stokOku(kasa.vt, urunId));
    expect(await bulutStok(urunId)).toBe(adet(22));
  });

  it('iptal edilen satış stoğu iki tarafta da geri verir', async () => {
    const urunId = urunEkle('Çay', { stok: adet(25) });
    const satis = satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(5), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 50_000, alinan: 50_000 }],
    });
    await senkronla();
    expect(await bulutStok(urunId)).toBe(adet(20));

    satisIptal(kasa.baglam, admin, satis.satisId, 'Müşteri vazgeçti');
    await senkronla();

    expect(await bulutStok(urunId)).toBe(stokOku(kasa.vt, urunId));
    expect(await bulutStok(urunId)).toBe(adet(25));
  });

  it('aynı olaylar iki kez gönderilse özetler değişmez', async () => {
    const urunId = urunEkle('Zeytin', { stok: adet(60) });
    const musteriId = cariKaydet(kasa.baglam, admin, { tip: 'MUSTERI', ad_unvan: 'Tekrarcı', kredi_limiti: 0 });
    satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(4), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'VERESIYE', tutar: 40_000 }],
      musteri_id: musteriId,
      limit_asimi_onaylandi: true,
    });

    // İlk gönderim.
    const olaylar = bekleyenOlaylar(kasa.vt, 500);
    await senkronla();
    const stokIlk = await bulutStok(urunId);
    const bakiyeIlk = await bulutBakiye(musteriId);

    // Aynı olayları yeniden gönder: ağ tekrarı / yeniden deneme senaryosu.
    await bulut.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: { 'x-device-token': CIHAZ_TOKEN },
      payload: {
        cihaz_id: CIHAZ_ID,
        sema_surumu: 2,
        protokol_surumu: 1,
        olaylar: olaylar.map((o) => ({
          uuid: o.id,
          tip: o.olay_tipi,
          entity: o.entity,
          entity_id: o.entity_id,
          olusturma_zamani: o.olusturma_zamani,
          veri: JSON.parse(o.veri) as Record<string, unknown>,
        })),
      },
    });

    expect(await bulutStok(urunId)).toBe(stokIlk);
    expect(await bulutBakiye(musteriId)).toBe(bakiyeIlk);
  });

  it('karışık bir günün sonunda TÜM ürün ve carilerde iki taraf uyuşur', async () => {
    // Gerçekçi bir gün: birden çok ürün, nakit + veresiye, düzeltme, iptal.
    const sut = urunEkle('Süt 1 L', { stok: adet(40) });
    const domates = urunEkle('Domates', { birim: 'KG', stok: miktarOlustur(30), fiyat: 4500 });
    const kola = urunEkle('Kola', { stok: adet(80), fiyat: 3500 });
    const ali = cariKaydet(kasa.baglam, admin, { tip: 'MUSTERI', ad_unvan: 'Ali', kredi_limiti: 0 });
    const ayse = cariKaydet(kasa.baglam, admin, { tip: 'MUSTERI', ad_unvan: 'Ayşe', kredi_limiti: 0 });

    satisKesinlestir(kasa.baglam, admin, {
      kalemler: [
        { urun_id: sut, miktar: adet(2), birim_fiyat: 10_000 },
        { urun_id: kola, miktar: adet(3), birim_fiyat: 3500 },
      ],
      odemeler: [{ tip: 'NAKIT', tutar: 30_500, alinan: 40_000 }],
    });

    satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: domates, miktar: miktarOlustur(2.25), birim_fiyat: 4500 }],
      odemeler: [{ tip: 'VERESIYE', tutar: 10_125 }],
      musteri_id: ali,
      limit_asimi_onaylandi: true,
    });

    const iptalEdilecek = satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: kola, miktar: adet(10), birim_fiyat: 3500 }],
      odemeler: [{ tip: 'VERESIYE', tutar: 35_000 }],
      musteri_id: ayse,
      limit_asimi_onaylandi: true,
    });
    satisIptal(kasa.baglam, admin, iptalEdilecek.satisId, 'Yanlış müşteri');

    stokDuzeltme(kasa.baglam, admin, sut, adet(35), 'Kırılma');

    await senkronla();

    // --- Uzlaşma: her ürün, her cari ---
    for (const urunId of [sut, domates, kola]) {
      expect(await bulutStok(urunId), `stok ayrıştı: ${urunId}`).toBe(stokOku(kasa.vt, urunId));
    }
    for (const cariId of [ali, ayse]) {
      expect(await bulutBakiye(cariId), `cari ayrıştı: ${cariId}`).toBe(bakiyeOku(kasa.vt, cariId));
    }

    // Satış sayısı da eşleşmeli (iptal edilen dahil, iptal bayrağıyla).
    const bulutSatis = await bulutVt.tek<{ adet: number }>('SELECT COUNT(*) AS adet FROM satislar WHERE isletme_id = ?', [
      ISLETME_ID,
    ]);
    const kasaSatis = kasa.vt.hazirla('SELECT COUNT(*) AS adet FROM satislar').tek<{ adet: number }>();
    expect(Number(bulutSatis?.adet)).toBe(Number(kasaSatis?.adet));
  });
});

describe('kasa hareketleri uzlaşması (§7.3)', () => {
  /**
   * `kasaHareketEkle` on yerden çağrılıyor; olayı çağırana bırakmak dokuz
   * yerde unutulmasına yol açmıştı. Artık hareketle olay ayrılmaz — bu test
   * ayrışırsa biri onları yine ayırmış demektir.
   */
  it('nakit satışın kasa hareketi merkeze de ulaşır', async () => {
    const urunId = urunEkle('Gazoz', { stok: adet(20) });
    satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(2), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 20_000, alinan: 20_000 }],
    });

    await senkronla();

    expect(await bulutKasaHareketleri()).toEqual(kasaKasaHareketleri());
  });

  it('açılış, satış, gider ve tahsilat birlikte uzlaşır', async () => {
    const urunId = urunEkle('Çikolata', { stok: adet(30) });
    const musteriId = cariKaydet(kasa.baglam, admin, { tip: 'MUSTERI', ad_unvan: 'Borçlu', kredi_limiti: 0 });

    satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 10_000, alinan: 10_000 }],
    });
    satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(3), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'VERESIYE', tutar: 30_000 }],
      musteri_id: musteriId,
      limit_asimi_onaylandi: true,
    });
    kasaHareketi(kasa.baglam, admin, 'GIDER', 5000, 'Poşet alımı');
    tahsilatYap(kasa.baglam, admin, { cari_id: musteriId, tutar: 12_000, odeme_tipi: 'NAKIT' });

    await senkronla();

    const bulut = await bulutKasaHareketleri();
    const yerel = kasaKasaHareketleri();
    expect(bulut.adet, 'hareket sayısı ayrıştı').toBe(yerel.adet);
    expect(bulut.toplam, 'hareket toplamı ayrıştı').toBe(yerel.toplam);
    // Veresiye satış kasaya nakit sokmaz; hareket sayısı buna göre olmalı.
    expect(yerel.adet).toBe(4); // açılış + nakit satış + gider + tahsilat
  });
});

describe('panelden gelen stok talimatı tek turda uzlaşır (§7.3)', () => {
  /**
   * Senkron turu push→pull sırasıyla çalışır. Pull, talimatı uygulayarak YENİ
   * bir stok hareketi üretir; yalnız baştaki push çalışsaydı o hareket bir
   * sonraki tura kalır ve panel bir tur boyunca eski değeri gösterirdi.
   * Kullanıcı da "olmadı" deyip tekrar girerdi. Bu test tek turda
   * uzlaşıldığını garanti eder.
   */
  it('talimat uygulanır ve aynı turda merkeze geri döner', async () => {
    const urunId = urunEkle('Gazoz', { stok: adet(20) });
    await senkronla();
    expect(await bulutStok(urunId)).toBe(adet(20));

    // Panel stok talimatı yazar (kasa henüz görmedi).
    // Talimat kasanın KENDİ kimliğine yazılır; uygulayıcı bununla eşleştirir.
    const zaman = simdi();
    const versiyonSatiri = await bulutVt.tek<{ deger: number }>(
      'UPDATE versiyon_sayaci SET sonraki = sonraki + 1 WHERE isletme_id = ? RETURNING sonraki - 1 AS deger',
      [ISLETME_ID],
    );
    await bulutVt.calistir(
      `INSERT INTO stok_duzeltmeleri (id, isletme_id, urun_id, tip, fark, hedef_miktar, neden, hedef_cihaz_id,
                                      created_at, updated_at, cihaz_id, versiyon)
       VALUES (?, ?, ?, 'DUZELTME', 0, 30000, 'Panelden', ?, ?, ?, 'panel', ?)`,
      [uuid(), ISLETME_ID, urunId, kasa.cihazId, zaman, zaman, Number(versiyonSatiri?.deger)],
    );

    // TEK senkron turu: talimat inip uygulanmalı VE hareketi geri gitmeli.
    await senkronla();

    expect(stokOku(kasa.vt, urunId), 'kasa uygulamadı').toBe(adet(30));
    expect(await bulutStok(urunId), 'merkez bir tur geride kaldı').toBe(adet(30));
  });
});

describe('stok talimatı hedef miktarla çalışır (§11.5)', () => {
  /** Talimat yazan yardımcı — panelin gönderdiği şeklin aynısı. */
  async function talimatYaz(urunId: string, hedefMiktar: number): Promise<void> {
    const zaman = simdi();
    const versiyon = await bulutVt.tek<{ deger: number }>(
      'UPDATE versiyon_sayaci SET sonraki = sonraki + 1 WHERE isletme_id = ? RETURNING sonraki - 1 AS deger',
      [ISLETME_ID],
    );
    await bulutVt.calistir(
      `INSERT INTO stok_duzeltmeleri (id, isletme_id, urun_id, tip, fark, hedef_miktar, neden, hedef_cihaz_id,
                                      created_at, updated_at, cihaz_id, versiyon)
       VALUES (?, ?, ?, 'DUZELTME', 0, ?, 'Panelden', ?, ?, ?, 'panel', ?)`,
      [uuid(), ISLETME_ID, urunId, hedefMiktar, kasa.cihazId, zaman, zaman, Number(versiyon?.deger)],
    );
  }

  it('stok, yazılan değere sabitlenir — panelin gördüğü rakam bayat olsa bile', async () => {
    // Kasada 30, panelde bayat 0 görünüyor diyelim. Kullanıcı 50 yazıyor.
    const urunId = urunEkle('Gazoz', { stok: adet(30) });
    await senkronla();

    await talimatYaz(urunId, adet(50));
    await senkronla();

    // Fark panelde hesaplansaydı 50−0 = +50 gider ve 30+50 = 80 olurdu.
    expect(stokOku(kasa.vt, urunId), 'yazılan değere sabitlenmedi').toBe(adet(50));
    expect(await bulutStok(urunId)).toBe(adet(50));
  });

  it('stoğu azaltmak da aynı şekilde çalışır', async () => {
    const urunId = urunEkle('Soda', { stok: adet(40) });
    await senkronla();

    await talimatYaz(urunId, adet(15));
    await senkronla();

    expect(stokOku(kasa.vt, urunId)).toBe(adet(15));
    expect(await bulutStok(urunId)).toBe(adet(15));
  });

  it('hedef zaten mevcut miktara eşitse hareket yazılmaz', async () => {
    const urunId = urunEkle('Ayran', { stok: adet(25) });
    await senkronla();
    const oncekiHareket = kasa.vt
      .hazirla('SELECT COUNT(*) AS adet FROM stok_hareketleri WHERE urun_id = ?')
      .tek<{ adet: number }>(urunId);

    await talimatYaz(urunId, adet(25));
    await senkronla();

    const sonrakiHareket = kasa.vt
      .hazirla('SELECT COUNT(*) AS adet FROM stok_hareketleri WHERE urun_id = ?')
      .tek<{ adet: number }>(urunId);
    expect(Number(sonrakiHareket?.adet)).toBe(Number(oncekiHareket?.adet));
    expect(stokOku(kasa.vt, urunId)).toBe(adet(25));
  });
});

describe('iade uzlaşması (§7.3)', () => {
  /**
   * İade kalemleri kasada NEGATİF miktarla yazılır (`miktar: -satir.miktar`).
   * Bu yüzden stok etkisi her durumda `-miktar`'dır: satışta pozitif miktar
   * stoğu düşürür, iadede negatif miktar geri ekler. İadeyi ayrıca özel
   * durum saymak işareti ters çevirir ve stok azalacağına artar.
   */
  it('nakit iade stoğu iki tarafta da geri ekler', async () => {
    const urunId = urunEkle('Bisküvi', { stok: adet(20) });
    const satis = satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(5), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 50_000, alinan: 50_000 }],
    });
    await senkronla();
    expect(await bulutStok(urunId)).toBe(adet(15));

    iadeYap(kasa.baglam, admin, {
      kaynak_satis_id: satis.satisId,
      kalemler: [{ satis_kalemi_id: kalemleriGetir(kasa.vt, satis.satisId)[0]!.id, miktar: adet(2) }],
      iade_yontemi: 'NAKIT',
      neden: 'Bozuk çıktı',
    });
    await senkronla();

    expect(stokOku(kasa.vt, urunId)).toBe(adet(17));
    expect(await bulutStok(urunId), 'iade stoğu bulutta ters işlendi').toBe(adet(17));
    expect(await bulutKasaHareketleri()).toEqual(kasaKasaHareketleri());
  });
});

describe('mal kabul uzlaşması (§7.3)', () => {
  it('peşin ödeme tedarikçi borcundan düşer — iki tarafta da', async () => {
    const urunId = urunEkle('Peynir', { stok: adet(10) });
    const tedarikciId = cariKaydet(kasa.baglam, admin, { tip: 'TEDARIKCI', ad_unvan: 'Süt A.Ş.', kredi_limiti: 0 });
    await senkronla();

    // 20 × 50,00 = 1000,00 + %20 KDV = 1200,00 · 400,00 peşin → 800,00 borç
    malKabulOnayla(kasa.baglam, admin, {
      tedarikci_id: tedarikciId,
      kalemler: [{ urun_id: urunId, miktar: adet(20), birim_fiyat: 5000, kdv_orani: 20 }],
      odenen_tutar: 40_000,
      odeme_tipi: 'NAKIT',
    });
    await senkronla();

    expect(await bulutStok(urunId)).toBe(stokOku(kasa.vt, urunId));
    expect(await bulutBakiye(tedarikciId), 'peşin ödeme merkeze gitmedi').toBe(bakiyeOku(kasa.vt, tedarikciId));
    expect(await bulutBakiye(tedarikciId)).toBe(80_000);
    expect(await bulutKasaHareketleri()).toEqual(kasaKasaHareketleri());
  });
});

describe('kullanıcı adı çakışması (§7.4)', () => {
  /**
   * CANLI KURULUMDA YAŞANDI: kurulum sihirbazı kasada bir sahip hesabı açar,
   * aynı kullanıcı adı panelde de açılır ve iki AYRI id aynı adı taşır.
   * `kullanici_adi` UNIQUE olduğu için pull o satırı yazamaz; tüm pull
   * transaction'ı geri alınır, imleç dahil. İmleç bir daha ilerlemez ve o
   * andan sonra buluttan HİÇBİR ŞEY inmez — ne ürün, ne fiyat, ne kategori.
   *
   * Bu test kilidin kendisini kurar: ayrışma değil, DONMA aranır.
   */
  it('panelde aynı adla açılan kullanıcı pull’u kilitlemez; kimlikler birleşir', async () => {
    const yerelId = admin.kullaniciId; // sihirbazın açtığı "patron"
    const bulutId = uuid();
    const zaman = simdi();

    await bulutVt.calistir('INSERT OR IGNORE INTO versiyon_sayaci (isletme_id, sonraki) VALUES (?, 1)', [ISLETME_ID]);
    const sayac = await bulutVt.tek<{ deger: number }>(
      'UPDATE versiyon_sayaci SET sonraki = sonraki + 1 WHERE isletme_id = ? RETURNING sonraki - 1 AS deger',
      [ISLETME_ID],
    );
    const bulutVersiyon = Number(sayac?.deger);
    await bulutVt.calistir(
      `INSERT INTO kullanicilar (id, isletme_id, ad, kullanici_adi, rol, aktif_mi, created_at, updated_at, versiyon, silindi_mi)
       VALUES (?, ?, 'Patron', 'patron', 'ADMIN', 1, ?, ?, ?, 0)`,
      [bulutId, ISLETME_ID, zaman, zaman, bulutVersiyon],
    );

    await senkronla();

    // 1) Aynı adla iki kayıt kalmamalı; kazanan bulut kimliği olmalı.
    const patronlar = kasa.vt.hazirla("SELECT id FROM kullanicilar WHERE kullanici_adi = 'patron'").tumu<{ id: string }>();
    expect(patronlar).toHaveLength(1);
    expect(patronlar[0]?.id).toBe(bulutId);

    // 2) GEÇMİŞ YENİDEN YAZILMAZ: değiştirilemez defterler eski kimlikte kalır.
    //    O hareketler gerçekten o kimlikle yapılmıştır; trigger da izin vermez.
    const defter = kasa.vt
      .hazirla('SELECT COUNT(*) AS n FROM stok_hareketleri WHERE kullanici_id = ?')
      .tek<{ n: number }>(bulutId);
    expect(Number(defter?.n), 'defter satırları taşınmamalı').toBe(0);

    // 2b) CANLI DURUM kişiyi İZLER: açık kasa oturumu yeni kimliğe geçmeli.
    //     Geçmezse ekranda açık kasa görünürken satış "açık kasa yok" der.
    const acikOturum = kasa.vt
      .hazirla("SELECT kullanici_id FROM kasa_oturumlari WHERE durum = 'ACIK'")
      .tek<{ kullanici_id: string }>();
    expect(acikOturum?.kullanici_id, 'açık kasa oturumu yeni kimliği izlemeli').toBe(bulutId);

    // 3) Eski kimlik tarihsel aktör olarak DURUR ama pasiftir ve adı çakışmaz.
    const eski = kasa.vt
      .hazirla('SELECT kullanici_adi, aktif_mi FROM kullanicilar WHERE id = ?')
      .tek<{ kullanici_adi: string; aktif_mi: number }>(yerelId);
    expect(eski, 'eski kimlik silinmemeli — defter ona bakıyor').toBeTruthy();
    expect(Number(eski?.aktif_mi)).toBe(0);
    expect(eski?.kullanici_adi).not.toBe('patron');

    // 4) ASIL REGRESYON: imleç ilerlemiş ve hata kalmamış olmalı.
    const durum = kasa.vt
      .hazirla('SELECT last_pull_version, son_hata FROM sync_state WHERE id = 1')
      .tek<{ last_pull_version: number; son_hata: string | null }>();
    expect(durum?.son_hata ?? null).toBeNull();
    expect(Number(durum?.last_pull_version)).toBeGreaterThanOrEqual(bulutVersiyon);
  });

  /**
   * Birleşme kimlik bilgisini yok etmemeli: panelde açılan hesapta yalnız PIN
   * verilmiş, şifre verilmemiş olabilir. Yereldeki çalışan şifre silinirse
   * kullanıcı kendi kasasında oturum açamaz hâle gelir.
   */
  it('bulutta şifre yoksa yereldeki şifre korunur', async () => {
    const yerelHash = kasa.vt
      .hazirla("SELECT sifre_hash FROM kullanicilar WHERE kullanici_adi = 'patron'")
      .tek<{ sifre_hash: string }>()?.sifre_hash;
    expect(yerelHash).toBeTruthy();

    const bulutId = uuid();
    const zaman = simdi();
    await bulutVt.calistir('INSERT OR IGNORE INTO versiyon_sayaci (isletme_id, sonraki) VALUES (?, 1)', [ISLETME_ID]);
    const sayac = await bulutVt.tek<{ deger: number }>(
      'UPDATE versiyon_sayaci SET sonraki = sonraki + 1 WHERE isletme_id = ? RETURNING sonraki - 1 AS deger',
      [ISLETME_ID],
    );
    // Buluttaki kayıtta şifre YOK — panelden yalnız PIN verilmiş senaryosu.
    await bulutVt.calistir(
      `INSERT INTO kullanicilar (id, isletme_id, ad, kullanici_adi, rol, aktif_mi, created_at, updated_at, versiyon, silindi_mi)
       VALUES (?, ?, 'Patron', 'patron', 'ADMIN', 1, ?, ?, ?, 0)`,
      [bulutId, ISLETME_ID, zaman, zaman, Number(sayac?.deger)],
    );

    await senkronla();

    const birlesmis = kasa.vt
      .hazirla('SELECT sifre_hash FROM kullanicilar WHERE id = ?')
      .tek<{ sifre_hash: string | null }>(bulutId);
    expect(birlesmis?.sifre_hash).toBe(yerelHash);
  });

  it('birleşme sonrası bulut da ikinci bir "patron" oluşturmaz', async () => {
    const bulutId = uuid();
    const zaman = simdi();
    await bulutVt.calistir('INSERT OR IGNORE INTO versiyon_sayaci (isletme_id, sonraki) VALUES (?, 1)', [ISLETME_ID]);
    const sayac = await bulutVt.tek<{ deger: number }>(
      'UPDATE versiyon_sayaci SET sonraki = sonraki + 1 WHERE isletme_id = ? RETURNING sonraki - 1 AS deger',
      [ISLETME_ID],
    );
    await bulutVt.calistir(
      `INSERT INTO kullanicilar (id, isletme_id, ad, kullanici_adi, rol, aktif_mi, created_at, updated_at, versiyon, silindi_mi)
       VALUES (?, ?, 'Patron', 'patron', 'ADMIN', 1, ?, ?, ?, 0)`,
      [bulutId, ISLETME_ID, zaman, zaman, Number(sayac?.deger)],
    );

    await senkronla();

    const bulutPatron = await bulutVt.tek<{ n: number }>(
      "SELECT COUNT(*) AS n FROM kullanicilar WHERE isletme_id = ? AND kullanici_adi = 'patron' AND silindi_mi = 0",
      [ISLETME_ID],
    );
    expect(Number(bulutPatron?.n)).toBe(1);
  });
});

describe('mağaza ayarı senkronu (§8.3)', () => {
  /**
   * Ayarlar hiçbir yönde akmıyordu: pull tanımı boştu, bulutta tablo yoktu ve
   * `AYAR_DEGISTI` olayı hem üretilmiyor hem de merkezde sessizce atılıyordu.
   * Panelden hiçbir mağaza ayarı değiştirilemiyordu.
   */
  async function bulutaAyarYaz(anahtar: string, deger: string): Promise<void> {
    const zaman = simdi();
    await bulutVt.calistir('INSERT OR IGNORE INTO versiyon_sayaci (isletme_id, sonraki) VALUES (?, 1)', [ISLETME_ID]);
    const sayac = await bulutVt.tek<{ deger: number }>(
      'UPDATE versiyon_sayaci SET sonraki = sonraki + 1 WHERE isletme_id = ? RETURNING sonraki - 1 AS deger',
      [ISLETME_ID],
    );
    await bulutVt.calistir(
      `INSERT INTO ayarlar (id, isletme_id, anahtar, deger, created_at, updated_at, versiyon, silindi_mi)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [uuid(), ISLETME_ID, anahtar, deger, zaman, zaman, Number(sayac?.deger)],
    );
  }

  const kasadakiAyar = (anahtar: string) =>
    kasa.vt.hazirla('SELECT deger FROM ayarlar WHERE anahtar = ?').tek<{ deger: string }>(anahtar)?.deger;

  it('merkezî ayar panelden kasaya iner', async () => {
    await bulutaAyarYaz('kdv.varsayilan', '10');
    await bulutaAyarYaz('isletme.ad', 'Yeni Market Adı');

    await senkronla();

    expect(kasadakiAyar('kdv.varsayilan')).toBe('10');
    expect(kasadakiAyar('isletme.ad')).toBe('Yeni Market Adı');
  });

  /**
   * Beyaz listenin asıl sebebi: cihaza özel bir ayar yayılırsa her kasa aynı
   * yazıcıya basmaya çalışır, aynı lisansı ya da aynı fiş serisini kullanır.
   */
  it('cihaza özel ayarlar İNMEZ', async () => {
    const oncekiCihazId = kasadakiAyar('cihaz.id');

    await bulutaAyarYaz('yazici.hedef', 'BASKA-YAZICI');
    await bulutaAyarYaz('cihaz.seri', 'Z');
    await bulutaAyarYaz('cihaz.id', 'kasa-sahte');
    await bulutaAyarYaz('lisans.anahtar', 'CALINMIS-LISANS');

    await senkronla();

    expect(kasadakiAyar('yazici.hedef'), 'yazıcı hedefi yayılmamalı').not.toBe('BASKA-YAZICI');
    expect(kasadakiAyar('cihaz.seri'), 'fiş serisi yayılmamalı').not.toBe('Z');
    expect(kasadakiAyar('cihaz.id'), 'cihaz kimliği değişmemeli').toBe(oncekiCihazId);
    expect(kasadakiAyar('lisans.anahtar'), 'lisans yayılmamalı').not.toBe('CALINMIS-LISANS');
  });

  it('bilinmeyen ayar anahtarı pull’u kilitlemez', async () => {
    await bulutaAyarYaz('gelecekte.eklenecek.ayar', 'x');
    await senkronla();
    const durum = kasa.vt.hazirla('SELECT son_hata FROM sync_state WHERE id = 1').tek<{ son_hata: string | null }>();
    expect(durum?.son_hata ?? null).toBeNull();
  });
});

describe('alış faturası belgesi (§11.8)', () => {
  /**
   * Stok ve tedarikçi borcu ayrı olaylardan zaten doğru işliyordu; merkeze
   * ulaşmayan tek şey BELGENİN KENDİSİYDİ. Panelden "bu tedarikçiye hangi
   * faturayla ne aldık" sorusu cevaplanamıyordu.
   */
  it('mal kabul faturası kalemleriyle birlikte merkeze ulaşır', async () => {
    const tedarikciId = cariKaydet(kasa.baglam, admin, { tip: 'TEDARIKCI', ad_unvan: 'Toptancı A' });
    const un = urunEkle('Un 5 kg', { stok: adet(0), fiyat: 12_000 });
    const yag = urunEkle('Ayçiçek Yağı', { stok: adet(0), fiyat: 20_000 });

    malKabulOnayla(kasa.baglam, admin, {
      tedarikci_id: tedarikciId,
      fatura_no: 'TOP-2026-118',
      odenen_tutar: 30_000,
      kalemler: [
        { urun_id: un, miktar: adet(10), birim_fiyat: 9_000, kdv_orani: 1 },
        { urun_id: yag, miktar: adet(6), birim_fiyat: 15_000, kdv_orani: 20 },
      ],
    });

    await senkronla();

    const fatura = await bulutVt.tek<{ id: string; fatura_no: string; genel_toplam: number; odenen_tutar: number }>(
      'SELECT id, fatura_no, genel_toplam, odenen_tutar FROM alis_faturalari WHERE isletme_id = ?',
      [ISLETME_ID],
    );
    expect(fatura, 'fatura merkeze ulaşmalı').toBeTruthy();
    expect(fatura?.fatura_no).toBe('TOP-2026-118');
    expect(Number(fatura?.odenen_tutar), 'peşin ödenen tutar da taşınmalı').toBe(30_000);

    const kalemler = await bulutVt.tumu<{ urun_id: string; miktar: number; birim_fiyat: number }>(
      'SELECT urun_id, miktar, birim_fiyat FROM alis_kalemleri WHERE isletme_id = ? AND fatura_id = ? ORDER BY id',
      [ISLETME_ID, fatura?.id],
    );
    expect(kalemler).toHaveLength(2);
    expect(kalemler.map((k) => Number(k.birim_fiyat)).sort((a, b) => a - b)).toEqual([9_000, 15_000]);
  });

  it('aynı fatura iki kez işlenirse kalemler çoğalmaz', async () => {
    const tedarikciId = cariKaydet(kasa.baglam, admin, { tip: 'TEDARIKCI', ad_unvan: 'Toptancı B' });
    const urunId = urunEkle('Makarna', { stok: adet(0) });
    malKabulOnayla(kasa.baglam, admin, {
      tedarikci_id: tedarikciId,
      kalemler: [{ urun_id: urunId, miktar: adet(5), birim_fiyat: 3_000, kdv_orani: 1 }],
    });

    await senkronla();
    await senkronla(); // ikinci tur: hiçbir şey çoğalmamalı

    const sayim = await bulutVt.tek<{ n: number }>('SELECT COUNT(*) AS n FROM alis_kalemleri WHERE isletme_id = ?', [ISLETME_ID]);
    expect(Number(sayim?.n)).toBe(1);
  });
});
