/**
 * Panel uçları — kasadaki ekranların bulut karşılığı (§11).
 *
 * Buradaki testler "panel kasayla aynı şeyi gösteriyor mu" sorusunu korur:
 * fiş dökümü, stok hareketi, cari ekstresi, saatlik/suistimal raporu ve
 * katalog yönetimi (Türkçe sıralama + alış/satış ayrımı).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { bugun, simdi, UCLAR, uuid } from '@market/shared';
import { parolaHashle, tokenHashle } from '../src/guvenlik.js';
import { sunucuOlustur } from '../src/sunucu.js';
import { semayiHazirla, vtOlustur, type MerkezVt } from '../src/vt/baglanti.js';
import { yapilandirmayiOku } from '../src/yapilandirma.js';

let uygulama: FastifyInstance;
let vt: MerkezVt;
let geciciKlasor: string;
let token: string;

const ISLETME_ID = '11111111-1111-4111-8111-111111111111';
const CIHAZ_TOKEN = 'test-cihaz-tokeni-yeterince-uzun-1234567890';

beforeEach(async () => {
  geciciKlasor = mkdtempSync(join(tmpdir(), 'market-panel-test-'));
  vt = vtOlustur('file:' + join(geciciKlasor, 'merkez.db').replace(/\\/g, '/'));
  uygulama = await sunucuOlustur({
    yapilandirma: yapilandirmayiOku({
      NODE_ENV: 'test',
      JWT_SECRET: 'test-gizli-anahtar-en-az-otuz-iki-karakter-olmali',
      LOG_SEVIYESI: 'fatal',
    } as NodeJS.ProcessEnv),
    vt,
  });

  const zaman = simdi();
  await vt.calistir('INSERT INTO isletmeler (id, ad, lisans_anahtari, aktif_mi, created_at) VALUES (?, ?, ?, 1, ?)', [
    ISLETME_ID,
    'Test Market',
    'TEST-LISANS-0002',
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

  const giris = await uygulama.inject({
    method: 'POST',
    url: UCLAR.giris,
    payload: { kullanici_adi: 'patron', sifre: 'Sifre1234' },
  });
  token = (giris.json() as { access_token: string }).access_token;
});

afterEach(async () => {
  await uygulama?.close();
  vt?.kapat();
  try {
    if (geciciKlasor) rmSync(geciciKlasor, { recursive: true, force: true });
  } catch {
    /* Windows dosya tanıtıcıyı geç bırakabilir; işletim sistemi temizler */
  }
});

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function panelGet(yol: string) {
  return uygulama.inject({ method: 'GET', url: yol, headers: { authorization: `Bearer ${token}` } });
}

function panelPost(yol: string, govde: unknown) {
  return uygulama.inject({ method: 'POST', url: yol, headers: { authorization: `Bearer ${token}` }, payload: govde });
}

function push(olaylar: unknown[]) {
  return uygulama.inject({
    method: 'POST',
    url: UCLAR.senkronPush,
    headers: { 'x-device-token': CIHAZ_TOKEN },
    payload: { cihaz_id: 'kasa-01', sema_surumu: 1, protokol_surumu: 1, olaylar },
  });
}

const URUN_ID = '22222222-2222-4222-8222-222222222222';

function satisOlayi(secenekler: { tutar?: number; saat?: string; iade?: boolean } = {}) {
  const id = uuid();
  const tutar = secenekler.tutar ?? 12_000;
  return {
    uuid: uuid(),
    tip: (secenekler.iade ? 'IADE_YAPILDI' : 'SATIS_YAPILDI') as 'SATIS_YAPILDI' | 'IADE_YAPILDI',
    entity: 'satis',
    entity_id: id,
    olusturma_zamani: simdi(),
    veri: {
      id,
      fis_no: 'A-000001',
      tarih: `${bugun()}T${secenekler.saat ?? '10'}:30:00.000Z`,
      ara_toplam: tutar,
      iskonto_toplam: 0,
      kdv_toplam: 2000,
      genel_toplam: tutar,
      odeme_ozeti: 'NAKIT',
      brut_kar: 4000,
      kalemler: [
        {
          urun_id: URUN_ID,
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

function urunEkle(ad: string, alis: number, satis: number) {
  return panelPost(UCLAR.urunler, { ad, alis_fiyati: alis, satis_fiyati: satis, kdv_orani: 20 });
}

// ---------------------------------------------------------------------------

describe('fiş listesi ve detayı (§11.3)', () => {
  it('fiş kalemleri ve ödemeleriyle birlikte döner', async () => {
    const olay = satisOlayi();
    await push([olay]);

    const liste = await panelGet(`${UCLAR.satislar}?from=${bugun()}&to=${bugun()}`);
    expect(liste.statusCode).toBe(200);
    const kayitlar = (liste.json() as { data: { id: string; fis_no: string }[] }).data;
    expect(kayitlar).toHaveLength(1);
    expect(kayitlar[0]?.fis_no).toBe('A-000001');

    const detay = await panelGet(`${UCLAR.satislar}/${olay.veri.id}`);
    const govde = detay.json() as {
      satis: { genel_toplam: number } | null;
      kalemler: { urun_adi: string }[];
      odemeler: { odeme_tipi: string; tutar: number }[];
    };
    expect(govde.satis?.genel_toplam).toBe(12_000);
    expect(govde.kalemler).toHaveLength(1);
    expect(govde.kalemler[0]?.urun_adi).toBe('Süt');
    expect(govde.odemeler[0]).toMatchObject({ odeme_tipi: 'NAKIT', tutar: 12_000 });
  });

  it('bulunamayan fiş 500 değil boş gövde döner (henüz senkronlanmamış olabilir)', async () => {
    const yanit = await panelGet(`${UCLAR.satislar}/${uuid()}`);
    expect(yanit.statusCode).toBe(200);
    expect((yanit.json() as { satis: unknown }).satis).toBeNull();
  });

  it('durum filtresi iptal fişini ayırır', async () => {
    const normal = satisOlayi();
    await push([normal]);
    await push([
      {
        uuid: uuid(),
        tip: 'SATIS_IPTAL_EDILDI',
        entity: 'satis',
        entity_id: normal.veri.id,
        olusturma_zamani: simdi(),
        veri: { id: normal.veri.id, neden: 'Müşteri vazgeçti' },
      },
    ]);

    const gecerli = await panelGet(`${UCLAR.satislar}?from=${bugun()}&to=${bugun()}&durum=gecerli`);
    expect((gecerli.json() as { data: unknown[] }).data).toHaveLength(0);

    const iptal = await panelGet(`${UCLAR.satislar}?from=${bugun()}&to=${bugun()}&durum=iptal`);
    const iptalKayitlari = (iptal.json() as { data: { iptal_neden: string }[] }).data;
    expect(iptalKayitlari).toHaveLength(1);
    expect(iptalKayitlari[0]?.iptal_neden).toBe('Müşteri vazgeçti');
  });
});

describe('stok hareketleri (§11.5)', () => {
  it('türe göre süzülür ve ortak 200 sınırının üstünde limit kabul eder', async () => {
    const zaman = simdi();
    await push([
      {
        uuid: uuid(),
        tip: 'STOK_HAREKETI',
        entity: 'stok_hareketi',
        entity_id: uuid(),
        olusturma_zamani: zaman,
        veri: { id: uuid(), urun_id: URUN_ID, hareket_tipi: 'GIRIS', miktar: 10_000, created_at: zaman },
      },
      {
        uuid: uuid(),
        tip: 'STOK_HAREKETI',
        entity: 'stok_hareketi',
        entity_id: uuid(),
        olusturma_zamani: zaman,
        veri: { id: uuid(), urun_id: URUN_ID, hareket_tipi: 'FIRE', miktar: -2000, created_at: zaman },
      },
    ]);

    // Hareket dökümü tanı ekranıdır; 200'de kesmek listeyi yanıltıcı kılardı.
    const tumu = await panelGet(`${UCLAR.stokHareketler}?from=${bugun()}&to=${bugun()}&limit=300`);
    expect(tumu.statusCode).toBe(200);
    expect((tumu.json() as { data: unknown[] }).data).toHaveLength(2);

    const fire = await panelGet(`${UCLAR.stokHareketler}?from=${bugun()}&to=${bugun()}&tip=FIRE`);
    const fireler = (fire.json() as { data: { hareket_tipi: string; miktar: number }[] }).data;
    expect(fireler).toHaveLength(1);
    expect(fireler[0]).toMatchObject({ hareket_tipi: 'FIRE', miktar: -2000 });
  });
});

describe('cari ekstresi (§11.6)', () => {
  it('yürüyen bakiyeyi doğru hesaplar ve en yeni hareketten başlar', async () => {
    const cariId = '55555555-5555-4555-8555-555555555555';
    const zaman = simdi();
    const hareket = (tip: string, tutar: number, tarih: string) => ({
      uuid: uuid(),
      tip: 'CARI_HAREKETI',
      entity: 'cari_hareketi',
      entity_id: uuid(),
      olusturma_zamani: zaman,
      veri: { id: uuid(), cari_id: cariId, hareket_tipi: tip, tutar, tarih },
    });

    await push([
      {
        uuid: uuid(),
        tip: 'CARI_KAYDEDILDI',
        entity: 'cari',
        entity_id: cariId,
        olusturma_zamani: zaman,
        veri: { id: cariId, tip: 'MUSTERI', ad_unvan: 'Veresiye Ali', created_at: zaman, updated_at: zaman },
      },
      hareket('BORC', 10_000, '2026-01-10T10:00:00.000Z'),
      hareket('BORC', 5_000, '2026-01-15T10:00:00.000Z'),
      hareket('TAHSILAT', -4_000, '2026-01-20T10:00:00.000Z'),
    ]);

    const yanit = await panelGet(`${UCLAR.cariler}/${cariId}/ekstre`);
    const govde = yanit.json() as {
      cari: { bakiye: number } | null;
      hareketler: { hareket_tipi: string; yuruyen_bakiye: number }[];
    };

    expect(govde.cari?.bakiye).toBe(11_000);
    // En yeni başta: tahsilat sonrası bakiye 11.000, ilk borçta 10.000.
    expect(govde.hareketler[0]).toMatchObject({ hareket_tipi: 'TAHSILAT', yuruyen_bakiye: 11_000 });
    expect(govde.hareketler[2]).toMatchObject({ hareket_tipi: 'BORC', yuruyen_bakiye: 10_000 });
  });
});

describe('saatlik ve suistimal raporları (§11.7)', () => {
  it('saatlik rapor 24 dilim döner ve satışın saatini bulur', async () => {
    await push([satisOlayi({ saat: '14' })]);

    const yanit = await panelGet(`${UCLAR.raporSaatlik}?from=${bugun()}&to=${bugun()}`);
    const dilimler = (yanit.json() as { data: { saat: number; ciro: number; islem: number }[] }).data;
    expect(dilimler).toHaveLength(24);
    expect(dilimler[14]).toMatchObject({ saat: 14, ciro: 12_000, islem: 1 });
    expect(dilimler[3]).toMatchObject({ saat: 3, ciro: 0, islem: 0 });
  });

  it('iade oranı ciroya bölünerek hesaplanır', async () => {
    await push([satisOlayi({ tutar: 20_000 })]);
    await push([satisOlayi({ tutar: 5_000, iade: true })]);

    const yanit = await panelGet(`${UCLAR.raporSuistimal}?from=${bugun()}&to=${bugun()}`);
    const govde = yanit.json() as { ciro: number; iadeTutari: number; iadeOrani: number; kasiyerBazli: unknown[] };

    expect(govde.ciro).toBe(20_000);
    expect(govde.iadeTutari).toBe(5_000);
    expect(govde.iadeOrani).toBe(25);
    expect(govde.kasiyerBazli.length).toBeGreaterThan(0);
  });
});

describe('katalog yönetimi — kasa ile aynı kurallar (§11.4)', () => {
  it('ürünler Türk alfabesine göre sıralanır', async () => {
    for (const ad of ['zeytin', 'Çilek', 'ırmak', 'incir', 'Ülker', 'armut']) await urunEkle(ad, 100, 200);

    const liste = await panelGet(`${UCLAR.urunler}?limit=50`);
    const adlar = (liste.json() as { data: { ad: string }[] }).data.map((u) => u.ad);
    expect(adlar).toEqual(['armut', 'Çilek', 'ırmak', 'incir', 'Ülker', 'zeytin']);
  });

  it('arama aksan ve harf boyutundan bağımsızdır', async () => {
    await urunEkle('Çilekli Süt', 900, 1250);
    await urunEkle('Ülker Çikolata', 1500, 2200);

    const arama = await panelGet(`${UCLAR.urunler}?q=cilekli`);
    expect((arama.json() as { data: { ad: string }[] }).data.map((u) => u.ad)).toEqual(['Çilekli Süt']);

    const buyuk = await panelGet(`${UCLAR.urunler}?q=ULKER`);
    expect((buyuk.json() as { data: { ad: string }[] }).data.map((u) => u.ad)).toEqual(['Ülker Çikolata']);
  });

  it('sayfalama ofseti toplam sayıyla birlikte döner', async () => {
    for (const ad of ['a-urun', 'b-urun', 'c-urun', 'd-urun']) await urunEkle(ad, 100, 200);

    const sayfa = await panelGet(`${UCLAR.urunler}?limit=2&ofset=2`);
    const govde = sayfa.json() as { data: { ad: string }[]; toplam: number; has_more: boolean };
    expect(govde.toplam).toBe(4);
    expect(govde.data.map((u) => u.ad)).toEqual(['c-urun', 'd-urun']);
    expect(govde.has_more).toBe(false);
  });

  it('toplu zam ALIS hedefinde satış fiyatına dokunmaz', async () => {
    await urunEkle('Maliyet Testi', 1000, 2000);

    const zam = await panelPost(`${UCLAR.urunler}/toplu-fiyat`, { yuzde: 10, hedef: 'ALIS' });
    expect((zam.json() as { etkilenen: number }).etkilenen).toBe(1);

    const liste = await panelGet(`${UCLAR.urunler}?q=Maliyet`);
    const urun = (liste.json() as { data: { alis_fiyati: number; satis_fiyati: number }[] }).data[0];
    expect(urun?.alis_fiyati).toBe(1100);
    expect(urun?.satis_fiyati).toBe(2000);
  });

  it('toplu zam SATIS hedefinde alış fiyatına dokunmaz', async () => {
    await urunEkle('Raf Testi', 1000, 2000);

    await panelPost(`${UCLAR.urunler}/toplu-fiyat`, { yuzde: 25, hedef: 'SATIS' });

    const liste = await panelGet(`${UCLAR.urunler}?q=Raf`);
    const urun = (liste.json() as { data: { alis_fiyati: number; satis_fiyati: number }[] }).data[0];
    expect(urun?.alis_fiyati).toBe(1000);
    expect(urun?.satis_fiyati).toBe(2500);
  });

  it('toplu zam kategori kapsamında yalnız o kategoriyi etkiler', async () => {
    const kategori = await panelPost(UCLAR.kategoriler, { ad: 'İçecek', sira: 1, aktif_mi: true });
    const kategoriId = (kategori.json() as { id: string }).id;

    await panelPost(UCLAR.urunler, { ad: 'Ayran', alis_fiyati: 600, satis_fiyati: 1000, kdv_orani: 20, kategori_id: kategoriId });
    await urunEkle('Sabun', 600, 1000);

    const zam = await panelPost(`${UCLAR.urunler}/toplu-fiyat`, { yuzde: 10, hedef: 'SATIS', kategori_id: kategoriId });
    expect((zam.json() as { etkilenen: number }).etkilenen).toBe(1);

    const liste = await panelGet(`${UCLAR.urunler}?limit=50`);
    const urunler = (liste.json() as { data: { ad: string; satis_fiyati: number }[] }).data;
    expect(urunler.find((u) => u.ad === 'Ayran')?.satis_fiyati).toBe(1100);
    expect(urunler.find((u) => u.ad === 'Sabun')?.satis_fiyati).toBe(1000);
  });
});

describe('barkodla ürün sorgusu (§11.8 madde 5-6 — panel toplu ürün girişi)', () => {
  /**
   * Panel bugün yalnız kısa kodu (≤5 haneli PLU) görüyor, gerçek barkodu
   * görmüyor. Elindeki kısmi `?limit=500` listesiyle eşleştirmeye kalkarsa
   * listede olmayan mevcut bir ürünü "yeni" sanıp mükerrer kart açabilir; bu
   * yüzden barkod eşleşmesi doğrudan bulutta, tam katalog üzerinde yapılır.
   */
  async function barkodTanimla(urunId: string, barkod: string, isletmeId = ISLETME_ID) {
    const zaman = simdi();
    await vt.calistir(
      `INSERT INTO barkodlar (id, isletme_id, urun_id, barkod, aktif_mi, created_at, updated_at, versiyon, silindi_mi)
       VALUES (?, ?, ?, ?, 1, ?, ?, 1, 0)`,
      [uuid(), isletmeId, urunId, barkod, zaman, zaman],
    );
  }

  it('eşleşen barkodun ürününü döner — kataloğun geri kalanı karışmaz', async () => {
    const olustur = await urunEkle('Kola 1L', 1000, 1500);
    const urunId = (olustur.json() as { id: string }).id;
    await barkodTanimla(urunId, '8690000000012');
    // Barkodsuz ve barkodu FARKLI iki ürün daha: filtre çalışmıyorsa (tüm liste
    // dönerse) bu satır sayısı 1'den fazla çıkar ve test bunu yakalar.
    const digerOlustur = await urunEkle('Ayran', 500, 800);
    await barkodTanimla((digerOlustur.json() as { id: string }).id, '8690000000043');

    const yanit = await panelGet(`${UCLAR.urunler}?barkod=8690000000012`);
    expect(yanit.statusCode).toBe(200);
    const veri = (yanit.json() as { data: { id: string; ad: string; alis_fiyati: number }[] }).data;
    expect(veri).toHaveLength(1);
    expect(veri[0]?.id).toBe(urunId);
    expect(veri[0]?.ad).toBe('Kola 1L');
    expect(veri[0]?.alis_fiyati).toBe(1000);
  });

  it('eşleşmeyen barkod boş liste döner — bu "yeni ürün" demektir, hata değil', async () => {
    // Katalogda ürün VAR ama aranan barkoda sahip değil: filtre çalışmıyorsa
    // (tüm liste dönerse) bu ürün yanlışlıkla "bulundu" sonucu üretir.
    await urunEkle('Kayıtlı Ürün', 100, 200);

    const yanit = await panelGet(`${UCLAR.urunler}?barkod=9999999999999`);
    expect(yanit.statusCode).toBe(200);
    expect((yanit.json() as { data: unknown[] }).data).toEqual([]);
  });

  it('başka işletmenin barkodu DÖNMEZ — işletme izolasyonu', async () => {
    // Kendi işletmemizde de ürün var: filtre işletme sınırını atlayıp tüm
    // listeyi dönerse bu ürün de listeye karışır ve test bunu yakalar.
    await urunEkle('Kendi Market Ürünü', 300, 500);

    const zaman = simdi();
    const digerIsletmeId = '99999999-9999-4999-8999-999999999999';
    const digerUrunId = uuid();
    await vt.calistir('INSERT INTO isletmeler (id, ad, lisans_anahtari, aktif_mi, created_at) VALUES (?, ?, ?, 1, ?)', [
      digerIsletmeId,
      'Başka Market',
      'TEST-LISANS-0099',
      zaman,
    ]);
    await vt.calistir(
      `INSERT INTO urunler (isletme_id, id, ad, birim_tipi, alis_fiyati, satis_fiyati, kdv_orani, kritik_stok,
                            ideal_stok, aktif_mi, skt_takibi, created_at, updated_at, cihaz_id, versiyon)
       VALUES (?, ?, 'Diğer Market Ürünü', 'ADET', 100, 200, 20, 0, 0, 1, 0, ?, ?, 'test', 1)`,
      [digerIsletmeId, digerUrunId, zaman, zaman],
    );
    await barkodTanimla(digerUrunId, '8690000000029', digerIsletmeId);

    const yanit = await panelGet(`${UCLAR.urunler}?barkod=8690000000029`);
    expect(yanit.statusCode).toBe(200);
    expect((yanit.json() as { data: unknown[] }).data).toEqual([]);
  });

  it('silinmiş barkod artık eşleşmez', async () => {
    const olustur = await urunEkle('Ayran', 500, 800);
    const urunId = (olustur.json() as { id: string }).id;
    const zaman = simdi();
    await vt.calistir(
      `INSERT INTO barkodlar (id, isletme_id, urun_id, barkod, aktif_mi, created_at, updated_at, versiyon, silindi_mi)
       VALUES (?, ?, ?, '8690000000036', 1, ?, ?, 1, 1)`,
      [uuid(), ISLETME_ID, urunId, zaman, zaman],
    );

    const yanit = await panelGet(`${UCLAR.urunler}?barkod=8690000000036`);
    expect((yanit.json() as { data: unknown[] }).data).toEqual([]);
  });

  it('diğer parametreler (arama, sayfalama) barkod verilmediğinde bugünkü gibi çalışmaya devam eder', async () => {
    for (const ad of ['a-urun', 'b-urun']) await urunEkle(ad, 100, 200);
    const yanit = await panelGet(`${UCLAR.urunler}?limit=1&ofset=1`);
    const govde = yanit.json() as { data: { ad: string }[]; toplam: number };
    expect(govde.toplam).toBe(2);
    expect(govde.data).toHaveLength(1);
  });
});

describe('gövdesiz istekler (§9.2)', () => {
  /**
   * Tarayıcı istemcileri gövdesiz DELETE'te bile sıklıkla
   * `content-type: application/json` gönderir. Fastify'ın varsayılan JSON
   * ayrıştırıcısı bunu "Body cannot be empty" diye reddeder ve kullanıcı
   * "Beklenmeyen bir hata oluştu" görür. Sunucu bu duruma dayanıklı olmalı.
   */
  it('content-type json olup gövde boşsa DELETE çalışır', async () => {
    const olustur = await panelPost(UCLAR.kullanicilar, {
      ad: 'Silinecek Personel',
      kullanici_adi: 'silinecek',
      rol: 'KASIYER',
      pin: '4271',
      aktif_mi: true,
      ek_yetkiler: [],
      kaldirilan_yetkiler: [],
    });
    const { id } = olustur.json() as { id: string };

    const yanit = await uygulama.inject({
      method: 'DELETE',
      url: `${UCLAR.kullanicilar}/${id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: '',
    });

    expect(yanit.statusCode).toBe(200);
    expect((yanit.json() as { silindi: boolean }).silindi).toBe(true);
  });

  it('gövdesi bozuk JSON ise yine 400 döner — boş gövde toleransı bunu gevşetmez', async () => {
    const yanit = await uygulama.inject({
      method: 'POST',
      url: UCLAR.kategoriler,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: '{bozuk',
    });

    expect(yanit.statusCode).toBeGreaterThanOrEqual(400);
    expect(yanit.statusCode).toBeLessThan(500);
  });
});

describe('stok talimatı tekrarı (§11.5)', () => {
  const CIHAZ = 'kasa-01';

  async function urunEkle() {
    const yanit = await panelPost(UCLAR.urunler, { ad: 'Tekrar Testi', satis_fiyati: 1000, birim_tipi: 'ADET' });
    return (yanit.json() as { id: string }).id;
  }

  async function talimatlar(urunId: string) {
    return vt.tumu<{ id: string; hedef_miktar: number; silindi_mi: number }>(
      'SELECT id, hedef_miktar, silindi_mi FROM stok_duzeltmeleri WHERE isletme_id = ? AND urun_id = ? ORDER BY versiyon',
      [ISLETME_ID, urunId],
    );
  }

  it('uygulanmamış talimatın yerine yenisi geçer — ikisi birden uygulanmaz', async () => {
    const urunId = await urunEkle();

    // Kasa senkron olmadığı için panelde stok eski görünür; kullanıcı tekrar dener.
    await panelPost(UCLAR.stokDuzeltmeleri, {
      urun_id: urunId,
      tip: 'DUZELTME',
      hedef_miktar: 26000,
      neden: 'İlk deneme',
      hedef_cihaz_id: CIHAZ,
    });
    await panelPost(UCLAR.stokDuzeltmeleri, {
      urun_id: urunId,
      tip: 'DUZELTME',
      hedef_miktar: 26000,
      neden: 'İkinci deneme',
      hedef_cihaz_id: CIHAZ,
    });

    const kayitlar = await talimatlar(urunId);
    expect(kayitlar).toHaveLength(2);
    // Eskisi iptal, yenisi geçerli: kasa yalnız birini uygular.
    expect(kayitlar[0]?.silindi_mi).toBe(1);
    expect(kayitlar[1]?.silindi_mi).toBe(0);
  });

  it('KASA UYGULADIYSA eski talimat iptal edilmez — geçmiş bozulmaz', async () => {
    const urunId = await urunEkle();

    const ilk = await panelPost(UCLAR.stokDuzeltmeleri, {
      urun_id: urunId,
      tip: 'DUZELTME',
      hedef_miktar: 26000,
      neden: 'Uygulanmış talimat',
      hedef_cihaz_id: CIHAZ,
    });
    const ilkId = (ilk.json() as { id: string }).id;

    // Kasa uyguladı: ürettiği hareketin id'si talimatın id'sidir ve geri geldi.
    await vt.calistir(
      `INSERT INTO stok_hareketleri (id, isletme_id, urun_id, hareket_tipi, miktar, birim_maliyet, created_at)
       VALUES (?, ?, ?, 'DUZELTME', 26000, 0, ?)`,
      [ilkId, ISLETME_ID, urunId, simdi()],
    );

    await panelPost(UCLAR.stokDuzeltmeleri, {
      urun_id: urunId,
      tip: 'DUZELTME',
      hedef_miktar: 5000,
      neden: 'Sonraki düzeltme',
      hedef_cihaz_id: CIHAZ,
    });

    const kayitlar = await talimatlar(urunId);
    expect(kayitlar).toHaveLength(2);
    expect(kayitlar[0]?.silindi_mi).toBe(0);
    expect(kayitlar[1]?.silindi_mi).toBe(0);
  });
});

describe('panel girişi — kasa yöneticisi (§9.2)', () => {
  /**
   * Sahip panelde ve kasada AYRI kullanıcı adı taşımak zorunda kalıyordu;
   * pratikte tek ürettiği şey karışıklıktı. Artık kasadaki ADMIN kendi
   * kimliğiyle panele de girebilir.
   */
  async function kasaKullanicisiEkle(
    kullaniciAdi: string,
    rol: 'ADMIN' | 'MUDUR' | 'KASIYER',
    sifre: string | null,
    ekstra: { aktif?: number; silindi?: number; pin?: string } = {},
  ): Promise<void> {
    const zaman = simdi();
    await vt.calistir(
      `INSERT INTO kullanicilar (id, isletme_id, ad, kullanici_adi, sifre_hash, pin_hash, rol,
                                 aktif_mi, created_at, updated_at, versiyon, silindi_mi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        uuid(),
        ISLETME_ID,
        kullaniciAdi,
        kullaniciAdi,
        sifre ? parolaHashle(sifre) : null,
        ekstra.pin ? parolaHashle(ekstra.pin) : null,
        rol,
        ekstra.aktif ?? 1,
        zaman,
        zaman,
        ekstra.silindi ?? 0,
      ],
    );
  }

  const girisDene = (kullanici_adi: string, sifre: string) =>
    uygulama.inject({ method: 'POST', url: UCLAR.giris, payload: { kullanici_adi, sifre } });

  it('kasadaki ADMIN kendi şifresiyle panele girebilir', async () => {
    await kasaKullanicisiEkle('memylmz', 'ADMIN', 'KasaSifre1234');
    const yanit = await girisDene('memylmz', 'KasaSifre1234');
    expect(yanit.statusCode).toBe(200);
    const govde = yanit.json() as { access_token: string; kullanici: { kullanici_adi: string; rol: string } };
    expect(govde.access_token).toBeTruthy();
    expect(govde.kullanici.kullanici_adi).toBe('memylmz');
    expect(govde.kullanici.rol).toBe('ADMIN');
  });

  it('kasadaki KASİYER panele giremez', async () => {
    await kasaKullanicisiEkle('kasiyer1', 'KASIYER', 'KasaSifre1234');
    const yanit = await girisDene('kasiyer1', 'KasaSifre1234');
    expect(yanit.statusCode).toBe(403);
    expect(yanit.json()).not.toHaveProperty('access_token');
  });

  /*
   * Şifresi DOĞRU ama rolü panele yetmeyen hesap "kullanıcı adı veya şifre
   * hatalı" alıyordu; kullanıcı bilgilerini yanlış sanıp tekrar tekrar
   * deniyordu. Doğru şifreyi bilen kişiye sebebi söylemek bir şey sızdırmaz.
   */
  it('doğru şifreli MÜDÜR panel yetkisi olmadığını açıkça öğrenir', async () => {
    await kasaKullanicisiEkle('mudur1', 'MUDUR', 'KasaSifre1234');
    const yanit = await girisDene('mudur1', 'KasaSifre1234');
    expect(yanit.statusCode).toBe(403);
    expect(JSON.stringify(yanit.json())).toMatch(/yalnız kasada/i);
  });

  it('yanlış şifreli MÜDÜR genel kimlik hatası alır — hesabın varlığı sızmaz', async () => {
    await kasaKullanicisiEkle('mudur2', 'MUDUR', 'KasaSifre1234');
    const yanit = await girisDene('mudur2', 'YanlisSifre999');
    expect(yanit.statusCode).toBe(401);
    expect(JSON.stringify(yanit.json())).not.toMatch(/yalnız kasada/i);
  });

  it('pasif MÜDÜR doğru şifreyle de genel kimlik hatası alır', async () => {
    await kasaKullanicisiEkle('mudur3', 'MUDUR', 'KasaSifre1234', { aktif: 0 });
    expect((await girisDene('mudur3', 'KasaSifre1234')).statusCode).toBe(401);
  });

  /**
   * 4 hanelik PIN, internete açık bir panel için kimlik bilgisi değildir;
   * kasada yeterli olmasının sebebi cihazın fiziksel korunmasıdır.
   */
  it('yalnız PINi olan ADMIN panele giremez', async () => {
    await kasaKullanicisiEkle('pinli', 'ADMIN', null, { pin: '4271' });
    expect((await girisDene('pinli', '4271')).statusCode).toBe(401);
  });

  it('pasifleştirilmiş veya silinmiş ADMIN panele giremez', async () => {
    await kasaKullanicisiEkle('pasif', 'ADMIN', 'KasaSifre1234', { aktif: 0 });
    await kasaKullanicisiEkle('silinmis', 'ADMIN', 'KasaSifre1234', { silindi: 1 });
    expect((await girisDene('pasif', 'KasaSifre1234')).statusCode).toBe(401);
    expect((await girisDene('silinmis', 'KasaSifre1234')).statusCode).toBe(401);
  });

  it('panel kullanıcısı önceliklidir; kasa kullanıcısı onu gölgeleyemez', async () => {
    // Aynı ada sahip bir kasa kullanıcısı, paneldeki hesabın şifresini ezmemeli.
    await kasaKullanicisiEkle('patron', 'ADMIN', 'BaskaSifre9999');
    expect((await girisDene('patron', 'Sifre1234')).statusCode).toBe(200);
    expect((await girisDene('patron', 'BaskaSifre9999')).statusCode).toBe(401);
  });
});

describe('panel yöneticisinin kasaya aynalanması (§12.1)', () => {
  /**
   * Yönetici hem panele hem kasaya girebilmelidir. Kasa ÇEVRİMDIŞI çalışır ve
   * girişi doğrulamak için buluta soramaz; kaydın `kullanicilar` tablosunda
   * BULUNMASI gerekir. Aynalama bu yüzden vardır.
   */
  const kasadakiler = () =>
    vt.tumu<{ kullanici_adi: string; rol: string; sifre_hash: string; versiyon: number }>(
      'SELECT kullanici_adi, rol, sifre_hash, versiyon FROM kullanicilar WHERE isletme_id = ? AND silindi_mi = 0',
      [ISLETME_ID],
    );

  it('panel ADMİNİ kasa kullanıcılarına aynalanır ve sürüm alır', async () => {
    await semayiHazirla(vt);

    const patron = (await kasadakiler()).find((k) => k.kullanici_adi === 'patron');
    expect(patron, 'panel yöneticisi kasaya inmeli').toBeTruthy();
    expect(patron?.rol).toBe('ADMIN');
    expect(patron?.sifre_hash).toBeTruthy();
    // Sürüm almazsa pull onu hiç görmez.
    expect(Number(patron?.versiyon)).toBeGreaterThan(0);
  });

  it('tekrar çalıştırmak kopya üretmez ve sürüm şişirmez', async () => {
    await semayiHazirla(vt);
    const once = await kasadakiler();
    await semayiHazirla(vt);
    const sonra = await kasadakiler();

    expect(sonra).toHaveLength(once.length);
    expect(sonra.map((k) => k.versiyon)).toEqual(once.map((k) => k.versiyon));
  });

  it('aynı kullanıcı adına sahip kasa kaydı EZİLMEZ', async () => {
    // Kasada zaten 'patron' varsa panel şifresi onun şifresini ezmemelidir.
    const zaman = simdi();
    const kasaHash = parolaHashle('KasaninKendiSifresi1');
    await vt.calistir(
      `INSERT INTO kullanicilar (id, isletme_id, ad, kullanici_adi, sifre_hash, rol, aktif_mi,
                                 created_at, updated_at, versiyon, silindi_mi)
       VALUES (?, ?, 'Kasadaki Patron', 'patron', ?, 'ADMIN', 1, ?, ?, 1, 0)`,
      [uuid(), ISLETME_ID, kasaHash, zaman, zaman],
    );

    await semayiHazirla(vt);

    const patronlar = (await kasadakiler()).filter((k) => k.kullanici_adi === 'patron');
    expect(patronlar, 'aynı adla ikinci kayıt açılmamalı').toHaveLength(1);
    expect(patronlar[0]?.sifre_hash).toBe(kasaHash);
  });
});

describe('fiş serisi dağıtımı (§10.2)', () => {
  /**
   * Seri eskiden cihaz kimliğinden hash'lenip 26 harfe indiriliyordu. Doğum
   * günü problemi gereği 4 kasada %21, 6 kasada %46 olasılıkla iki kasa AYNI
   * harfi alıyordu; o an iki farklı satış aynı fiş numarasını taşıyor ve
   * müşteri fişiyle geldiğinde yanlış satış iade edilebiliyordu.
   *
   * Merkez tek otorite olduğu için çakışma artık yapısal olarak imkânsız.
   */
  const aktive = (cihazId: string) =>
    uygulama.inject({
      method: 'POST',
      url: UCLAR.cihazAktivasyon,
      payload: { lisans_anahtari: 'TEST-LISANS-0002', cihaz_id: cihazId, cihaz_adi: cihazId },
    });

  it('her kasaya farklı seri verir', async () => {
    const seriler: string[] = [];
    for (const ad of ['kasa-a', 'kasa-b', 'kasa-c', 'kasa-d', 'kasa-e']) {
      const yanit = await aktive(ad);
      expect(yanit.statusCode).toBe(200);
      seriler.push((yanit.json() as { seri: string }).seri);
    }
    expect(seriler.every(Boolean), 'her aktivasyon seri döndürmeli').toBe(true);
    expect(new Set(seriler).size, `seriler çakıştı: ${seriler.join(', ')}`).toBe(seriler.length);
  });

  it('aynı kasa yeniden aktive edilince serisi DEĞİŞMEZ', async () => {
    const ilk = (await aktive('kasa-sabit')).json() as { seri: string };
    // Araya başka kasalar girse bile eski seri korunmalı; değişirse aynı kasa
    // iki farklı seride fiş basmış olur ve geçmiş fişler izlenemez hale gelir.
    await aktive('kasa-arada-1');
    await aktive('kasa-arada-2');
    const ikinci = (await aktive('kasa-sabit')).json() as { seri: string };
    expect(ikinci.seri).toBe(ilk.seri);
  });

  it('26 harf dolunca iki harfli seriye geçer', async () => {
    const zaman = simdi();
    // 26 harfin tamamı doluymuş gibi davran.
    for (const h of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      await vt.calistir(
        `INSERT INTO cihazlar (id, isletme_id, cihaz_id, cihaz_adi, token_hash, seri, aktif_mi, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'x', ?, 1, ?, ?)`,
        [uuid(), ISLETME_ID, `dolu-${h}`, `Dolu ${h}`, h, zaman, zaman],
      );
    }
    const yanit = await aktive('kasa-27');
    expect(yanit.statusCode).toBe(200);
    expect((yanit.json() as { seri: string }).seri).toBe('AA');
  });
});

describe('satışı yapan kasiyer (§10.7)', () => {
  /*
   * Kasa kullanıcıları buluta yalnız kurulum sihirbazında ya da panelden
   * açılınca girer. Kasa başka bir buluta bağlanınca (ya da kullanıcı eski bir
   * kurulumdan geldiyse) satıştaki kullanici_id bulutta karşılıksız kalıyor,
   * fişte "Kasiyer: —" görünüyordu. Kasa adı satışla birlikte gönderir.
   */
  it('bulutta karşılığı olmayan kullanıcının adı satışla gelen addan gösterilir', async () => {
    const olay = satisOlayi();
    Object.assign(olay.veri, { kullanici_id: uuid(), kasiyer_adi: 'Mehmet YILMAZ' });
    expect((await push([olay])).statusCode).toBe(200);

    const detay = (await panelGet(`${UCLAR.satislar}/${olay.veri.id}`)).json() as { satis: { kullanici_adi: string } };
    expect(detay.satis.kullanici_adi).toBe('Mehmet YILMAZ');

    const liste = (await panelGet(`${UCLAR.satislar}?from=${bugun()}&to=${bugun()}`)).json() as {
      data: { id: string; kullanici_adi: string }[];
    };
    expect(liste.data.find((s) => s.id === olay.veri.id)?.kullanici_adi).toBe('Mehmet YILMAZ');
  });

  it('ad bilgisi olmayan eski olayda da yanıt bozulmaz', async () => {
    const olay = satisOlayi();
    expect((await push([olay])).statusCode).toBe(200);
    const detay = (await panelGet(`${UCLAR.satislar}/${olay.veri.id}`)).json() as { satis: { kullanici_adi: string } };
    expect(detay.satis.kullanici_adi).toBe('—');
  });
});

describe('iade fişi — müşteri ve kaynak fiş (§10.4)', () => {
  it('iade müşteriye bağlı gelir; detay kaynak fişi, orijinal fiş de iadelerini söyler', async () => {
    const musteriId = uuid();
    const satis = satisOlayi({ tutar: 40_000 });
    Object.assign(satis.veri, { fis_no: 'A-000002', musteri_id: musteriId });
    const iadeId = uuid();
    const iade = {
      uuid: uuid(),
      tip: 'IADE_YAPILDI' as const,
      entity: 'satis',
      entity_id: iadeId,
      olusturma_zamani: simdi(),
      veri: {
        id: iadeId,
        fis_no: 'A-000005',
        tarih: `${bugun()}T11:00:00.000Z`,
        kaynak_satis_id: satis.veri.id,
        musteri_id: musteriId,
        genel_toplam: -20_000,
        kdv_toplam: 0,
        iade_yontemi: 'VERESIYE',
        kalemler: [{ urun_id: URUN_ID, urun_adi: 'Defter', miktar: -2000, birim_fiyat: 10_000, satir_toplam: -20_000 }],
        odemeler: [{ tip: 'VERESIYE', tutar: -20_000 }],
      },
    };
    expect((await push([satis, iade])).statusCode).toBe(200);

    const iadeDetay = (await panelGet(`${UCLAR.satislar}/${iadeId}`)).json() as {
      satis: { musteri_id: string; kaynak_fis_no: string; iade_mi: number };
      kalemler: { urun_adi: string }[];
      odemeler: { odeme_tipi: string; tutar: number }[];
    };
    expect(iadeDetay.satis).toMatchObject({ musteri_id: musteriId, kaynak_fis_no: 'A-000002', iade_mi: 1 });
    expect(iadeDetay.kalemler[0]?.urun_adi).toBe('Defter');
    expect(iadeDetay.odemeler).toEqual([expect.objectContaining({ odeme_tipi: 'VERESIYE', tutar: -20_000 })]);

    const orijinal = (await panelGet(`${UCLAR.satislar}/${satis.veri.id}`)).json() as {
      iadeler: { id: string; fis_no: string; genel_toplam: number }[];
    };
    expect(orijinal.iadeler).toEqual([expect.objectContaining({ id: iadeId, fis_no: 'A-000005', genel_toplam: -20_000 })]);
  });
});

/*
 * Kasa ile panelin cari defteri AYNI satırları göstermeli (§11.6, §11.8).
 */
describe('kasa ↔ panel cari uyumu', () => {
  const cariOlayi = (id: string, tip: 'MUSTERI' | 'TEDARIKCI', ad: string) => ({
    uuid: uuid(),
    tip: 'CARI_KAYDEDILDI' as const,
    entity: 'cari',
    entity_id: id,
    olusturma_zamani: simdi(),
    veri: { id, tip, ad_unvan: ad, created_at: simdi(), updated_at: simdi() },
  });
  const ekstre = async (cariId: string) =>
    (await panelGet(`${UCLAR.cariler}/${cariId}/ekstre`)).json() as {
      cari: { bakiye: number } | null;
      hareketler: { id: string; hareket_tipi: string; tutar: number; belge_id: string | null; belge_tipi: string | null }[];
    };

  function faturaOlayi(tedarikciId: string, ek: Record<string, unknown> = {}) {
    const id = uuid();
    return {
      id,
      olay: {
        uuid: uuid(),
        tip: 'ALIS_FATURASI_ONAYLANDI' as const,
        entity: 'alis_faturasi',
        entity_id: id,
        olusturma_zamani: simdi(),
        veri: {
          id,
          tedarikci_id: tedarikciId,
          tarih: simdi(),
          genel_toplam: 500_000,
          odenen_tutar: 250_000,
          kalemler: [{ urun_id: URUN_ID, miktar: 100_000, birim_fiyat: 5000, kdv_orani: 0, satir_toplam: 500_000 }],
          ...ek,
        },
      },
    };
  }

  it('kasadan gelen faturanın borç ve ödeme satırları belge türünü ve kasadaki kimliği taşır', async () => {
    const tedarikci = uuid();
    const borcId = uuid();
    const odemeId = uuid();
    const f = faturaOlayi(tedarikci, { borc_hareket_id: borcId, odeme_hareket_id: odemeId });
    await push([cariOlayi(tedarikci, 'TEDARIKCI', 'Enis'), f.olay]);

    const e = await ekstre(tedarikci);
    expect(e.hareketler).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: borcId, belge_id: f.id, belge_tipi: 'ALIS', tutar: 500_000 }),
        expect.objectContaining({ id: odemeId, belge_id: f.id, belge_tipi: 'ALIS_ODEME', tutar: -250_000 }),
      ]),
    );
    expect(e.cari?.bakiye).toBe(250_000);
  });

  it('eski kasadan (kimliksiz) gelen faturada da belge türü yazılır', async () => {
    const tedarikci = uuid();
    const f = faturaOlayi(tedarikci);
    await push([cariOlayi(tedarikci, 'TEDARIKCI', 'Enis'), f.olay]);
    const tipler = (await ekstre(tedarikci)).hareketler.map((h) => h.belge_tipi).sort();
    expect(tipler).toEqual(['ALIS', 'ALIS_ODEME']);
  });

  it('kasada iptal edilen fatura ödemesi panelde aynı satıra bağlanır', async () => {
    const tedarikci = uuid();
    const odemeId = uuid();
    const f = faturaOlayi(tedarikci, { borc_hareket_id: uuid(), odeme_hareket_id: odemeId });
    const iptalId = uuid();
    await push([
      cariOlayi(tedarikci, 'TEDARIKCI', 'Enis'),
      f.olay,
      {
        uuid: uuid(),
        tip: 'CARI_HAREKETI',
        entity: 'cari_hareketi',
        entity_id: iptalId,
        olusturma_zamani: simdi(),
        veri: {
          id: iptalId,
          cari_id: tedarikci,
          hareket_tipi: 'DUZELTME',
          tutar: 250_000,
          belge_id: odemeId,
          belge_tipi: 'TAHSILAT_IPTAL',
          tarih: simdi(),
        },
      },
    ]);
    const e = await ekstre(tedarikci);
    const iptal = e.hareketler.find((h) => h.belge_tipi === 'TAHSILAT_IPTAL');
    expect(e.hareketler.some((h) => h.id === iptal?.belge_id)).toBe(true);
    expect(e.cari?.bakiye).toBe(500_000);
  });

  it('veresiye iade müşterinin borcundan düşer', async () => {
    const musteri = uuid();
    const satis = satisOlayi({ tutar: 40_000 });
    Object.assign(satis.veri, { musteri_id: musteri, odemeler: [{ tip: 'VERESIYE', tutar: 40_000 }] });
    const iadeId = uuid();
    await push([
      cariOlayi(musteri, 'MUSTERI', 'Barış'),
      satis,
      {
        uuid: uuid(),
        tip: 'IADE_YAPILDI' as const,
        entity: 'satis',
        entity_id: iadeId,
        olusturma_zamani: simdi(),
        veri: {
          id: iadeId,
          fis_no: 'A-000009',
          tarih: simdi(),
          kaynak_satis_id: satis.veri.id,
          musteri_id: musteri,
          genel_toplam: -20_000,
          iade_yontemi: 'VERESIYE',
          kalemler: [{ urun_id: URUN_ID, miktar: -2000, satir_toplam: -20_000 }],
          odemeler: [{ tip: 'VERESIYE', tutar: -20_000 }],
        },
      },
    ]);
    const e = await ekstre(musteri);
    expect(e.cari?.bakiye).toBe(20_000);
    expect(e.hareketler.find((h) => h.belge_id === iadeId)).toMatchObject({ belge_tipi: 'IADE', tutar: -20_000 });
  });

  it('satış iptalinin cari satırı belge türünü taşır', async () => {
    const musteri = uuid();
    const satis = satisOlayi({ tutar: 40_000 });
    Object.assign(satis.veri, { musteri_id: musteri, odemeler: [{ tip: 'VERESIYE', tutar: 40_000 }] });
    await push([
      cariOlayi(musteri, 'MUSTERI', 'Barış'),
      satis,
      {
        uuid: uuid(),
        tip: 'SATIS_IPTAL_EDILDI' as const,
        entity: 'satis',
        entity_id: satis.veri.id,
        olusturma_zamani: simdi(),
        veri: { id: satis.veri.id, neden: 'yanlış' },
      },
    ]);
    const e = await ekstre(musteri);
    expect(e.cari?.bakiye).toBe(0);
    expect(e.hareketler.map((h) => h.belge_tipi).sort()).toEqual(['SATIS', 'SATIS_IPTAL']);
  });
});

describe('eski cari satırlarının belge türü onarımı', () => {
  it('belge türü boş kalmış fatura borç/ödeme ve satış iptali satırları şema hazırlığında onarılır', async () => {
    const tedarikci = uuid();
    const faturaId = uuid();
    const zaman = simdi();
    await vt.calistir(
      `INSERT INTO alis_faturalari (id, isletme_id, tedarikci_id, tarih, ara_toplam, kdv_toplam, genel_toplam,
                                    odenen_tutar, durum, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, 1000, 500, 'ONAYLANDI', ?, ?)`,
      [faturaId, ISLETME_ID, tedarikci, zaman, zaman, zaman],
    );
    for (const [id, tip, tutar] of [
      [`${faturaId}-borc`, 'BORC', 1000],
      [`${faturaId}-odeme`, 'ODEME', -500],
    ] as const) {
      await vt.calistir(
        `INSERT INTO cari_hareketler (id, isletme_id, cari_id, hareket_tipi, tutar, belge_id, tarih)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, ISLETME_ID, tedarikci, tip, tutar, faturaId, zaman],
      );
    }
    const satisId = uuid();
    await vt.calistir(
      `INSERT INTO cari_hareketler (id, isletme_id, cari_id, hareket_tipi, tutar, belge_id, tarih)
       VALUES (?, ?, ?, 'ALACAK', -100, ?, ?)`,
      [`${satisId}-veresiye-iptal`, ISLETME_ID, uuid(), satisId, zaman],
    );

    await semayiHazirla(vt);

    const tipler = await vt.tumu<{ id: string; belge_tipi: string | null }>(
      'SELECT id, belge_tipi FROM cari_hareketler WHERE isletme_id = ? ORDER BY id',
      [ISLETME_ID],
    );
    const harita = Object.fromEntries(tipler.map((t) => [t.id, t.belge_tipi]));
    expect(harita[`${faturaId}-borc`]).toBe('ALIS');
    expect(harita[`${faturaId}-odeme`]).toBe('ALIS_ODEME');
    expect(harita[`${satisId}-veresiye-iptal`]).toBe('SATIS_IPTAL');
  });
});

describe('panelden ödeme iptali — para yolu', () => {
  it('talimat seçilen para yolunu saklar ve kasaya iner', async () => {
    const tedarikci = uuid();
    const odemeId = uuid();
    const faturaId = uuid();
    await push([
      {
        uuid: uuid(),
        tip: 'CARI_KAYDEDILDI',
        entity: 'cari',
        entity_id: tedarikci,
        olusturma_zamani: simdi(),
        veri: { id: tedarikci, tip: 'TEDARIKCI', ad_unvan: 'Enis', created_at: simdi(), updated_at: simdi() },
      },
      {
        uuid: uuid(),
        tip: 'ALIS_FATURASI_ONAYLANDI',
        entity: 'alis_faturasi',
        entity_id: faturaId,
        olusturma_zamani: simdi(),
        veri: {
          id: faturaId,
          tedarikci_id: tedarikci,
          tarih: simdi(),
          genel_toplam: 1000,
          odenen_tutar: 1000,
          odeme_hareket_id: odemeId,
          kalemler: [],
        },
      },
    ]);

    const yanit = await panelPost(UCLAR.cariTalimatlari, {
      cari_id: tedarikci,
      tip: 'TAHSILAT_IPTAL',
      hedef_hareket_id: odemeId,
      neden: 'hesaba iade edildi',
      para_yolu: 'KART',
    });
    expect(yanit.statusCode).toBe(200);

    const pull = await uygulama.inject({
      method: 'GET',
      url: `${UCLAR.senkronPull}?since=0&limit=500`,
      headers: { 'x-device-token': CIHAZ_TOKEN },
    });
    const govde = JSON.stringify(pull.json());
    expect(govde).toContain('"para_yolu":"KART"');
  });
});
