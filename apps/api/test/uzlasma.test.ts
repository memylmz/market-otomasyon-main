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
import { bekleyenIadeleriIsle } from '../../desktop/src/main/servis/iade-talimat-servis.js';
import { bekleyenCariTalimatlariniIsle } from '../../desktop/src/main/servis/cari-talimat-servis.js';
import { bekleyenAlisTalimatlariniIsle } from '../../desktop/src/main/servis/alis-talimat-servis.js';
import { alisFaturasiIptal } from '../../desktop/src/main/servis/stok-servis.js';
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

describe('miktar bazlı kampanya satışta (§10.8)', () => {
  /**
   * Kampanya indirimi SATIR İSKONTOSU olarak yazılır, birim fiyata gömülmez:
   * "3 al 2 öde"de indirim miktara bağlı ve kademelidir, birim fiyata gömmek
   * 6,666… gibi bölünemez bir sayı üretip kuruşu bozardı.
   *
   * İndirim SUNUCUDA yeniden hesaplanır; istemciden gelene güvenilmez.
   */
  function kampanyaEkle(urunId: string, tip: string, esikMiktar: number, deger: number): void {
    const zaman = simdi();
    kasa.vt
      .hazirla(
        `INSERT INTO kampanyalar (id, ad, tip, kapsam, hedef_id, deger, esik_miktar, baslangic, bitis,
                                  oncelik, aktif_mi, created_at, updated_at, cihaz_id)
         VALUES (?, ?, ?, 'URUN', ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`,
      )
      .calistir(
        uuid(),
        '3 al 2 öde',
        tip,
        urunId,
        deger,
        esikMiktar,
        '2020-01-01T00:00:00.000Z',
        '2099-12-31T23:59:59.999Z',
        zaman,
        zaman,
        CIHAZ_ID,
      );
  }

  it('3 al 2 öde: satır iskontosu yazılır ve toplam doğru olur', () => {
    const urunId = urunEkle('Ayran', { stok: adet(50), fiyat: 10_000 });
    kampanyaEkle(urunId, 'N_AL_M_ODE', 3000, 2);

    const satis = satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(3), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 20_000, alinan: 20_000 }],
    });

    // 3 × 100,00 = 300,00 → 1 bedava → 200,00
    expect(satis.genelToplam).toBe(20_000);

    const kalem = kalemleriGetir(kasa.vt, satis.satisId)[0];
    expect(Number(kalem?.birim_fiyat), 'birim fiyat BOZULMAMALI').toBe(10_000);
    expect(Number(kalem?.iskonto), 'indirim satır iskontosu olarak yazılmalı').toBe(10_000);
  });

  it('kademeli fiyat: eşiği geçince tüm miktara uygulanır', () => {
    const urunId = urunEkle('Domates', { birim: 'KG', stok: miktarOlustur(100), fiyat: 10_000 });
    kampanyaEkle(urunId, 'KADEMELI_FIYAT', 3000, 8_000);

    const satis = satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: miktarOlustur(5), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 40_000, alinan: 40_000 }],
    });

    // 5 kg × 80,00 = 400,00 (liste 500,00, indirim 100,00)
    expect(satis.genelToplam).toBe(40_000);
  });

  it('eşiğin altında indirim uygulanmaz', () => {
    const urunId = urunEkle('Kola', { stok: adet(50), fiyat: 10_000 });
    kampanyaEkle(urunId, 'N_AL_M_ODE', 3000, 2);

    const satis = satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(2), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 20_000, alinan: 20_000 }],
    });
    expect(satis.genelToplam).toBe(20_000);
  });

  it('kampanyalı satış merkeze doğru tutarla ulaşır', async () => {
    const urunId = urunEkle('Su', { stok: adet(50), fiyat: 10_000 });
    kampanyaEkle(urunId, 'N_AL_M_ODE', 3000, 2);
    satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(6), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 40_000, alinan: 40_000 }],
    });

    await senkronla();

    const bulut = await bulutVt.tek<{ genel_toplam: number }>(
      'SELECT genel_toplam FROM satislar WHERE isletme_id = ? ORDER BY tarih DESC LIMIT 1',
      [ISLETME_ID],
    );
    expect(Number(bulut?.genel_toplam), '6 adette 2 bedava → 400,00').toBe(40_000);
    expect(await bulutStok(urunId), 'stok 6 adet düşmeli').toBe(stokOku(kasa.vt, urunId));
  });
});

describe('panelden kısmi iade talimatı (§10.4)', () => {
  /**
   * Panel iadeyi KENDİSİ işlemez: stok ve cari hareketlerinin tek üreticisi
   * kasadır. Bulut talimat yazar, kasa kendi iade servisiyle uygular — yani
   * panelden yapılan iade, kasadan yapılanla birebir aynı yoldan geçer.
   */
  async function talimatYaz(satisId: string, kalemId: string, miktar: number, yontem = 'NAKIT'): Promise<void> {
    const zaman = simdi();
    await bulutVt.calistir('INSERT OR IGNORE INTO versiyon_sayaci (isletme_id, sonraki) VALUES (?, 1)', [ISLETME_ID]);
    const sayac = await bulutVt.tek<{ deger: number }>(
      'UPDATE versiyon_sayaci SET sonraki = sonraki + 1 WHERE isletme_id = ? RETURNING sonraki - 1 AS deger',
      [ISLETME_ID],
    );
    await bulutVt.calistir(
      `INSERT INTO iade_talimatlari (id, isletme_id, satis_id, kalemler, iade_yontemi, neden,
                                     hedef_cihaz_id, created_at, updated_at, versiyon, silindi_mi)
       VALUES (?, ?, ?, ?, ?, 'Panelden kısmi iade', ?, ?, ?, ?, 0)`,
      [
        uuid(),
        ISLETME_ID,
        satisId,
        JSON.stringify([{ satis_kalemi_id: kalemId, miktar }]),
        yontem,
        // Talimat BU kasaya yazılır; hedef kasanın kendi kimliğidir.
        kasa.cihazId,
        zaman,
        zaman,
        Number(sayac?.deger),
      ],
    );
  }

  it('tek kalem iade edilir: stok artar, satışın tamamı iptal olmaz', async () => {
    const urunId = urunEkle('Süt', { stok: adet(20), fiyat: 10_000 });
    const digerId = urunEkle('Ekmek', { stok: adet(20), fiyat: 5_000 });
    const satis = satisKesinlestir(kasa.baglam, admin, {
      kalemler: [
        { urun_id: urunId, miktar: adet(3), birim_fiyat: 10_000 },
        { urun_id: digerId, miktar: adet(2), birim_fiyat: 5_000 },
      ],
      odemeler: [{ tip: 'NAKIT', tutar: 40_000, alinan: 40_000 }],
    });
    expect(stokOku(kasa.vt, urunId)).toBe(adet(17));

    const kalemler = kalemleriGetir(kasa.vt, satis.satisId);
    const sutKalemi = kalemler.find((k) => k.urun_id === urunId)!;
    await talimatYaz(satis.satisId, sutKalemi.id, adet(1));

    await senkronla();
    const sonuc = bekleyenIadeleriIsle(kasa.baglam, admin);

    expect(sonuc.uygulanan, 'talimat uygulanmalı').toBe(1);
    expect(stokOku(kasa.vt, urunId), '1 adet stoğa dönmeli').toBe(adet(18));
    expect(stokOku(kasa.vt, digerId), 'diğer kalem etkilenmemeli').toBe(adet(18));
  });

  /** Veresiye satışta iade müşterinin BORCUNDAN düşülmelidir. */
  it('veresiye satışta iade borçtan düşer', async () => {
    const musteriId = cariKaydet(kasa.baglam, admin, { tip: 'MUSTERI', ad_unvan: 'Borçlu', kredi_limiti: 0 });
    const urunId = urunEkle('Peynir', { stok: adet(20), fiyat: 10_000 });
    const satis = satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(3), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'VERESIYE', tutar: 30_000 }],
      musteri_id: musteriId,
      limit_asimi_onaylandi: true,
    });
    expect(bakiyeOku(kasa.vt, musteriId)).toBe(30_000);

    const kalemId = kalemleriGetir(kasa.vt, satis.satisId)[0]!.id;
    await talimatYaz(satis.satisId, kalemId, adet(1), 'VERESIYE');

    await senkronla();
    bekleyenIadeleriIsle(kasa.baglam, admin);

    expect(bakiyeOku(kasa.vt, musteriId), '100,00 borçtan düşmeli').toBe(20_000);
  });

  /** Talimat iki kez işlenirse iade iki kez uygulanır; bu asla olmamalı. */
  it('aynı talimat iki kez uygulanmaz', async () => {
    const urunId = urunEkle('Kola', { stok: adet(20), fiyat: 10_000 });
    const satis = satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(5), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 50_000, alinan: 50_000 }],
    });
    const kalemId = kalemleriGetir(kasa.vt, satis.satisId)[0]!.id;
    await talimatYaz(satis.satisId, kalemId, adet(2));

    await senkronla();
    bekleyenIadeleriIsle(kasa.baglam, admin);
    const ilkStok = stokOku(kasa.vt, urunId);

    // İkinci çağrı hiçbir şey yapmamalı.
    const ikinci = bekleyenIadeleriIsle(kasa.baglam, admin);
    expect(ikinci.uygulanan).toBe(0);
    expect(stokOku(kasa.vt, urunId)).toBe(ilkStok);
  });

  /** Kasa oturumu yoksa talimat BEKLER; sessizce kaybolmaz. */
  it('kasa kapalıyken talimat bekler', async () => {
    const urunId = urunEkle('Su', { stok: adet(20), fiyat: 10_000 });
    const satis = satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(2), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 20_000, alinan: 20_000 }],
    });
    const kalemId = kalemleriGetir(kasa.vt, satis.satisId)[0]!.id;
    await talimatYaz(satis.satisId, kalemId, adet(1));
    await senkronla();

    const kasasiz = { ...admin, kasaOturumId: null };
    expect(bekleyenIadeleriIsle(kasa.baglam, kasasiz).uygulanan).toBe(0);

    const bekleyen = kasa.vt.hazirla('SELECT COUNT(*) AS n FROM iade_talimatlari WHERE uygulandi_mi = 0').tek<{ n: number }>();
    expect(Number(bekleyen?.n), 'talimat beklemede kalmalı').toBe(1);

    // Kasa açıkken uygulanır.
    expect(bekleyenIadeleriIsle(kasa.baglam, admin).uygulanan).toBe(1);
  });
});

describe('panelden cari talimatı (§10.7)', () => {
  /**
   * Açılış bakiyesi, bakiye düzeltmesi ve tahsilat iptali panelden verilir ama
   * KASADA işlenir: `cari_hareketler` değiştirilemez bir defterdir ve tek
   * yazıcısı kasadır. Bulut yalnız niyeti yazar.
   */
  async function talimatYaz(
    cariId: string,
    tip: 'ACILIS' | 'DUZELTME' | 'TAHSILAT_IPTAL',
    alanlar: { tutar?: number; hedefHareketId?: string; neden?: string } = {},
  ): Promise<void> {
    const zaman = simdi();
    await bulutVt.calistir('INSERT OR IGNORE INTO versiyon_sayaci (isletme_id, sonraki) VALUES (?, 1)', [ISLETME_ID]);
    const sayac = await bulutVt.tek<{ deger: number }>(
      'UPDATE versiyon_sayaci SET sonraki = sonraki + 1 WHERE isletme_id = ? RETURNING sonraki - 1 AS deger',
      [ISLETME_ID],
    );
    await bulutVt.calistir(
      `INSERT INTO cari_talimatlari (id, isletme_id, cari_id, tip, tutar, hedef_hareket_id, neden,
                                     hedef_cihaz_id, created_at, updated_at, versiyon, silindi_mi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        uuid(),
        ISLETME_ID,
        cariId,
        tip,
        alanlar.tutar ?? 0,
        alanlar.hedefHareketId ?? null,
        alanlar.neden ?? 'Panelden düzeltme',
        kasa.cihazId,
        zaman,
        zaman,
        Number(sayac?.deger),
      ],
    );
  }

  it('açılış bakiyesi kasada yazılır', async () => {
    const cariId = cariKaydet(kasa.baglam, admin, { tip: 'MUSTERI', ad_unvan: 'Devirli', kredi_limiti: 0 });
    await talimatYaz(cariId, 'ACILIS', { tutar: 25_000, neden: 'Devir bakiyesi' });

    await senkronla();
    expect(bekleyenCariTalimatlariniIsle(kasa.baglam, admin).uygulanan).toBe(1);
    expect(bakiyeOku(kasa.vt, cariId), 'açılış bakiyesi işlenmeli').toBe(25_000);
  });

  /**
   * `tutar` FARK değil HEDEF bakiyedir: farkı kasa kendi güncel bakiyesine
   * göre hesaplar. Panel farkı kendi hesaplasaydı, talimat beklerken düşen bir
   * tahsilat tabanı kaydırır ve sonuç kullanıcının yazdığı rakam olmazdı.
   */
  it('bakiye düzeltmesi hedefe göre hesaplanır, panelin gördüğü bakiyeye göre değil', async () => {
    const cariId = cariKaydet(kasa.baglam, admin, { tip: 'MUSTERI', ad_unvan: 'Kaymış', kredi_limiti: 0 });
    const urunId = urunEkle('Çay', { stok: adet(50), fiyat: 10_000 });
    satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(10), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'VERESIYE', tutar: 100_000 }],
      musteri_id: cariId,
      limit_asimi_onaylandi: true,
    });
    expect(bakiyeOku(kasa.vt, cariId)).toBe(100_000);

    // Panel 1.000,00 görürken 800,00 olmalı diyor.
    await talimatYaz(cariId, 'DUZELTME', { tutar: 80_000, neden: 'Fiş iki kez işlenmiş' });
    await senkronla();

    // Talimat beklerken kasadan tahsilat yapılıyor: taban kayıyor.
    tahsilatYap(kasa.baglam, admin, { cari_id: cariId, tutar: 30_000, odeme_tipi: 'NAKIT' });
    expect(bakiyeOku(kasa.vt, cariId)).toBe(70_000);

    expect(bekleyenCariTalimatlariniIsle(kasa.baglam, admin).uygulanan).toBe(1);
    expect(bakiyeOku(kasa.vt, cariId), 'sonuç, panelin yazdığı hedef olmalı').toBe(80_000);
  });

  /** Tahsilat SİLİNMEZ; aynı tutar ters kayıtla geri alınır. */
  it('tahsilat iptali ters kayıt yazar, borcu geri yükler', async () => {
    const cariId = cariKaydet(kasa.baglam, admin, { tip: 'MUSTERI', ad_unvan: 'Yanlış Tahsilat', kredi_limiti: 0 });
    const urunId = urunEkle('Şeker', { stok: adet(50), fiyat: 10_000 });
    satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(5), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'VERESIYE', tutar: 50_000 }],
      musteri_id: cariId,
      limit_asimi_onaylandi: true,
    });
    const tahsilat = tahsilatYap(kasa.baglam, admin, { cari_id: cariId, tutar: 20_000, odeme_tipi: 'NAKIT' });
    expect(bakiyeOku(kasa.vt, cariId)).toBe(30_000);

    await talimatYaz(cariId, 'TAHSILAT_IPTAL', { hedefHareketId: tahsilat.hareketId, neden: 'Tutar yanlış girildi' });
    await senkronla();
    expect(bekleyenCariTalimatlariniIsle(kasa.baglam, admin).uygulanan).toBe(1);

    expect(bakiyeOku(kasa.vt, cariId), 'borç geri yüklenmeli').toBe(50_000);
    const kalanKayit = kasa.vt
      .hazirla('SELECT COUNT(*) AS n FROM cari_hareketler WHERE id = ?')
      .tek<{ n: number }>(tahsilat.hareketId);
    expect(Number(kalanKayit?.n), 'orijinal tahsilat silinmemeli').toBe(1);
  });

  /** Talimat iki kez işlenirse bakiye iki kat düzelir; bu asla olmamalı. */
  it('aynı talimat iki kez uygulanmaz', async () => {
    const cariId = cariKaydet(kasa.baglam, admin, { tip: 'MUSTERI', ad_unvan: 'Tekrar', kredi_limiti: 0 });
    await talimatYaz(cariId, 'ACILIS', { tutar: 15_000 });
    await senkronla();

    bekleyenCariTalimatlariniIsle(kasa.baglam, admin);
    const ilk = bakiyeOku(kasa.vt, cariId);
    expect(bekleyenCariTalimatlariniIsle(kasa.baglam, admin).uygulanan).toBe(0);
    expect(bakiyeOku(kasa.vt, cariId)).toBe(ilk);
  });

  /**
   * Nakit tahsilatın iptali açık kasa ister — para çekmeceden geri çıkar.
   * Kasa kapalıyken talimat BEKLER ve HATA YAZMAZ: bu bir arıza değil, henüz
   * sırası gelmemiş bir iştir.
   */
  it('kasa kapalıyken nakit tahsilat iptali bekler, hata yazmaz', async () => {
    const cariId = cariKaydet(kasa.baglam, admin, { tip: 'MUSTERI', ad_unvan: 'Bekleyen', kredi_limiti: 0 });
    const urunId = urunEkle('Un', { stok: adet(50), fiyat: 10_000 });
    satisKesinlestir(kasa.baglam, admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(4), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'VERESIYE', tutar: 40_000 }],
      musteri_id: cariId,
      limit_asimi_onaylandi: true,
    });
    const tahsilat = tahsilatYap(kasa.baglam, admin, { cari_id: cariId, tutar: 10_000, odeme_tipi: 'NAKIT' });

    await talimatYaz(cariId, 'TAHSILAT_IPTAL', { hedefHareketId: tahsilat.hareketId, neden: 'Kasa kapalıyken' });
    await senkronla();

    const kasasiz = { ...admin, kasaOturumId: null };
    expect(bekleyenCariTalimatlariniIsle(kasa.baglam, kasasiz).uygulanan).toBe(0);

    const bekleyen = kasa.vt
      .hazirla('SELECT uygulandi_mi, hata FROM cari_talimatlari')
      .tek<{ uygulandi_mi: number; hata: string | null }>();
    expect(Number(bekleyen?.uygulandi_mi), 'talimat beklemede kalmalı').toBe(0);
    expect(bekleyen?.hata, 'erteleme hata olarak kaydedilmemeli').toBeNull();

    // Kasa açıkken uygulanır.
    expect(bekleyenCariTalimatlariniIsle(kasa.baglam, admin).uygulanan).toBe(1);
    expect(bakiyeOku(kasa.vt, cariId)).toBe(40_000);
  });
});

describe('alış faturası (§11.8)', () => {
  /**
   * Fatura kaydedildiğinde stok ARTAR ve tedarikçiye cari BORÇ doğar; iki
   * defterin de tek yazıcısı kasadır. Panel talimat yazar, belgeyi kasa üretir.
   */
  async function talimatYaz(tip: string, govde: Record<string, unknown>, faturaId?: string): Promise<void> {
    const zaman = simdi();
    await bulutVt.calistir('INSERT OR IGNORE INTO versiyon_sayaci (isletme_id, sonraki) VALUES (?, 1)', [ISLETME_ID]);
    const sayac = await bulutVt.tek<{ deger: number }>(
      'UPDATE versiyon_sayaci SET sonraki = sonraki + 1 WHERE isletme_id = ? RETURNING sonraki - 1 AS deger',
      [ISLETME_ID],
    );
    await bulutVt.calistir(
      `INSERT INTO alis_talimatlari (id, isletme_id, tip, fatura_id, veri, hedef_cihaz_id,
                                     created_at, updated_at, versiyon, silindi_mi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [uuid(), ISLETME_ID, tip, faturaId ?? null, JSON.stringify(govde), kasa.cihazId, zaman, zaman, Number(sayac?.deger)],
    );
  }

  it('panelden girilen fatura kasada işlenir: stok artar, tedarikçiye borç yazılır', async () => {
    const tedarikciId = cariKaydet(kasa.baglam, admin, { tip: 'TEDARIKCI', ad_unvan: 'X Toptancısı', kredi_limiti: 0 });
    const kalem = urunEkle('Kalem', { stok: adet(0), fiyat: 1_500 });
    const defter = urunEkle('Defter', { stok: adet(0), fiyat: 4_000 });

    await talimatYaz('OLUSTUR', {
      tip: 'OLUSTUR',
      tedarikci_id: tedarikciId,
      fatura_no: 'A-1001',
      kalemler: [
        { urun_id: kalem, miktar: adet(100), birim_fiyat: 1_000, kdv_orani: 20 },
        { urun_id: defter, miktar: adet(50), birim_fiyat: 3_000, kdv_orani: 20 },
      ],
    });

    await senkronla();
    expect(bekleyenAlisTalimatlariniIsle(kasa.baglam, admin).uygulanan).toBe(1);

    expect(stokOku(kasa.vt, kalem), '100 adet kalem stoğa girmeli').toBe(adet(100));
    expect(stokOku(kasa.vt, defter), '50 adet defter stoğa girmeli').toBe(adet(50));

    // 100 × 10,00 + 50 × 30,00 = 2.500,00 net; %20 KDV ile 3.000,00
    expect(bakiyeOku(kasa.vt, tedarikciId), 'tedarikçiye KDV dahil borç yazılmalı').toBe(300_000);
  });

  it('fatura iptali stoğu ve borcu ters kayıtla geri alır, belgeyi silmez', async () => {
    const tedarikciId = cariKaydet(kasa.baglam, admin, { tip: 'TEDARIKCI', ad_unvan: 'Y Toptancısı', kredi_limiti: 0 });
    const silgi = urunEkle('Silgi', { stok: adet(5), fiyat: 1_000 });

    const sonuc = malKabulOnayla(kasa.baglam, admin, {
      tedarikci_id: tedarikciId,
      fatura_no: 'B-2002',
      kalemler: [{ urun_id: silgi, miktar: adet(20), birim_fiyat: 500, kdv_orani: 20 }],
    });
    expect(stokOku(kasa.vt, silgi)).toBe(adet(25));
    expect(bakiyeOku(kasa.vt, tedarikciId)).toBe(12_000);

    alisFaturasiIptal(kasa.baglam, admin, sonuc.faturaId, 'Fatura iki kez girilmiş');

    expect(stokOku(kasa.vt, silgi), 'stok girişten önceki hâline dönmeli').toBe(adet(5));
    expect(bakiyeOku(kasa.vt, tedarikciId), 'tedarikçi borcu sıfırlanmalı').toBe(0);

    const fatura = kasa.vt.hazirla('SELECT durum FROM alis_faturalari WHERE id = ?').tek<{ durum: string }>(sonuc.faturaId);
    expect(fatura?.durum, 'belge silinmemeli, IPTAL olmalı').toBe('IPTAL');
  });

  it('aynı fatura iki kez iptal edilemez', () => {
    const tedarikciId = cariKaydet(kasa.baglam, admin, { tip: 'TEDARIKCI', ad_unvan: 'Z Toptancısı', kredi_limiti: 0 });
    const urun = urunEkle('Kağıt', { stok: adet(0), fiyat: 1_000 });
    const sonuc = malKabulOnayla(kasa.baglam, admin, {
      tedarikci_id: tedarikciId,
      kalemler: [{ urun_id: urun, miktar: adet(10), birim_fiyat: 500, kdv_orani: 20 }],
    });

    alisFaturasiIptal(kasa.baglam, admin, sonuc.faturaId, 'Yanlış giriş');
    expect(() => alisFaturasiIptal(kasa.baglam, admin, sonuc.faturaId, 'Tekrar')).toThrow();
    expect(bakiyeOku(kasa.vt, tedarikciId), 'borç iki kat geri alınmamalı').toBe(0);
  });

  /** Fatura ve KDV kırılımı merkeze ULAŞMALI: panel bunları gösterir. */
  it('fatura KDV kırılımıyla birlikte merkeze ulaşır', async () => {
    const tedarikciId = cariKaydet(kasa.baglam, admin, { tip: 'TEDARIKCI', ad_unvan: 'W Toptancısı', kredi_limiti: 0 });
    const urun = urunEkle('Zımba', { stok: adet(0), fiyat: 5_000 });
    const sonuc = malKabulOnayla(kasa.baglam, admin, {
      tedarikci_id: tedarikciId,
      fatura_no: 'C-3003',
      kalemler: [{ urun_id: urun, miktar: adet(4), birim_fiyat: 2_500, kdv_orani: 20 }],
    });

    await senkronla();

    const bulutFatura = await bulutVt.tek<{ ara_toplam: number; kdv_toplam: number; durum: string; fatura_no: string }>(
      'SELECT ara_toplam, kdv_toplam, durum, fatura_no FROM alis_faturalari WHERE isletme_id = ? AND id = ?',
      [ISLETME_ID, sonuc.faturaId],
    );
    expect(Number(bulutFatura?.ara_toplam), 'KDV hariç toplam merkezde olmalı').toBe(10_000);
    expect(Number(bulutFatura?.kdv_toplam), 'KDV toplamı merkezde olmalı').toBe(2_000);
    expect(bulutFatura?.fatura_no).toBe('C-3003');

    const bulutKalem = await bulutVt.tek<{ kdv_orani: number; satir_toplam: number }>(
      'SELECT kdv_orani, satir_toplam FROM alis_kalemleri WHERE isletme_id = ? AND fatura_id = ?',
      [ISLETME_ID, sonuc.faturaId],
    );
    expect(Number(bulutKalem?.kdv_orani), 'kalem KDV oranı merkeze gitmeli').toBe(20);
    expect(Number(bulutKalem?.satir_toplam)).toBe(12_000);
  });
});
