/**
 * Müşteri ekranı — ana süreç tarafı.
 *
 * NEDEN VAR: müşteri ekranı kasanın önünde, müşterinin gözü önündedir.
 * Yanlış fiyat ("ekranda 25 yazıyordu"), bitmiş kampanya, silinmiş ürün ya da
 * dosya adı üzerinden diskteki başka bir dosyaya erişim burada yakalanmalı;
 * ekranın kendisi Electron gerektirdiği için kurallar onun dışında sınanır.
 */

import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AYAR, MUSTERI_EKRANI_AYAR, type MusteriSepeti, type MusteriSlayti } from '@market/shared';
import { ayarOku, ayarYaz } from '../src/main/depo/ayar.js';
import { kampanyaSunucudanUygula } from '../src/main/depo/katalog.js';
import { kanallariOlustur } from '../src/main/ipc/kanallar.js';
import { KAPALI_DURUM, type MusteriEkraniDenetcisi } from '../src/main/musteri-ekrani/denetci.js';
import { medyaKaydet, medyaTuruBul, medyaYolu, yetimMedyalariTemizle } from '../src/main/musteri-ekrani/medya.js';
import { medyaUrl, musteriEkraniYapilandirmasi } from '../src/main/musteri-ekrani/yapilandirma.js';
import { urunuPasiflestir } from '../src/main/servis/katalog-servis.js';
import { cagirKategoriKaydet, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
  ortam.uygulama.aktoruAyarla(ortam.admin);
});

afterEach(async () => {
  await ortam.temizle();
});

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const GIF = new TextEncoder().encode('GIF89a\u0001\u0000\u0001\u0000\u0000\u0000');
const WEBP = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ');
const MP4 = Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const WEBM = Uint8Array.from([
  0x1a,
  0x45,
  0xdf,
  0xa3,
  0x9f,
  0x42,
  0x86,
  0x81,
  0x01,
  0x42,
  0x82,
  0x84,
  ...new TextEncoder().encode('webm'),
]);
const MKV = Uint8Array.from([
  0x1a,
  0x45,
  0xdf,
  0xa3,
  0x9f,
  0x42,
  0x86,
  0x81,
  0x01,
  0x42,
  0x82,
  0x88,
  ...new TextEncoder().encode('matroska'),
]);

const kampanya = (veri: Record<string, unknown>) =>
  kampanyaSunucudanUygula(
    ortam.uygulama.vt,
    {
      id: `k-${Math.random().toString(36).slice(2)}`,
      ad: 'Hafta Sonu',
      tip: 'YUZDE',
      kapsam: 'URUN',
      deger: 20,
      baslangic: '2000-01-01T00:00:00.000Z',
      bitis: '2999-01-01T00:00:00.000Z',
      oncelik: 0,
      ...veri,
    },
    1,
  );

const slaytlariYaz = (liste: MusteriSlayti[]) => ayarYaz(ortam.uygulama.vt, MUSTERI_EKRANI_AYAR.SLAYTLAR, JSON.stringify(liste));
const yapilandirma = () => musteriEkraniYapilandirmasi(ortam.uygulama.baglam);

describe('medya dosyaları', () => {
  it('türü uzantıdan değil içerikten bulur', () => {
    expect(medyaTuruBul(PNG)).toEqual({ tur: 'GORSEL', uzanti: 'png' });
    expect(medyaTuruBul(JPG)).toEqual({ tur: 'GORSEL', uzanti: 'jpg' });
    expect(medyaTuruBul(GIF)).toEqual({ tur: 'GORSEL', uzanti: 'gif' });
    expect(medyaTuruBul(WEBP)).toEqual({ tur: 'GORSEL', uzanti: 'webp' });
    expect(medyaTuruBul(MP4)).toEqual({ tur: 'VIDEO', uzanti: 'mp4' });
    expect(medyaTuruBul(WEBM)).toEqual({ tur: 'VIDEO', uzanti: 'webm' });
    // Matroska oynatılamayabilir; yalnız webm kabul edilir.
    expect(medyaTuruBul(MKV)).toBeNull();
    expect(medyaTuruBul(new TextEncoder().encode('MZ\u0090\u0000 bir program dosyası'))).toBeNull();
    expect(medyaTuruBul(Uint8Array.from([0x89, 0x50]))).toBeNull();
  });

  it('kaydeder, adı kendisi verir ve yalnız o klasörden geri verir', () => {
    const { dosya, tur } = medyaKaydet(ortam.uygulama.baglam.yollar, PNG);
    expect(tur).toBe('GORSEL');
    expect(dosya).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(medyaYolu(ortam.uygulama.baglam.yollar, dosya)).toBe(join(ortam.uygulama.baglam.yollar.medyaKlasoru, dosya));
    // Yarım yazma dosyası kalmaz.
    expect(readdirSync(ortam.uygulama.baglam.yollar.medyaKlasoru).filter((a) => a.endsWith('.yaziliyor'))).toEqual([]);
  });

  it('yol içeren ya da kalıba uymayan ad diskteki başka dosyayı vermez', () => {
    const yollar = ortam.uygulama.baglam.yollar;
    writeFileSync(join(yollar.kok, 'gizli.txt'), 'x');
    for (const ad of ['../gizli.txt', '..\\gizli.txt', 'gizli.txt', '00000000-0000-0000-0000-000000000000.png']) {
      expect(medyaYolu(yollar, ad)).toBeNull();
    }
  });

  it('desteklenmeyen biçimi, yanlış türü ve büyük dosyayı reddeder', () => {
    const yollar = ortam.uygulama.baglam.yollar;
    expect(() => medyaKaydet(yollar, new TextEncoder().encode('düz metin dosyası, resim değil'))).toThrow(/desteklenmiyor/);
    expect(() => medyaKaydet(yollar, MP4, 'GORSEL')).toThrow(/yalnız görsel/);
    expect(() => medyaKaydet(yollar, PNG, 'VIDEO')).toThrow(/yalnız video/);
    const buyuk = new Uint8Array(16 * 1024 * 1024);
    buyuk.set(PNG);
    expect(() => medyaKaydet(yollar, buyuk)).toThrow(/çok büyük/);
  });

  it('kullanılmayan dosyaları siler, kullanılanlara ve yabancı dosyalara dokunmaz', () => {
    const yollar = ortam.uygulama.baglam.yollar;
    const kalan = medyaKaydet(yollar, PNG).dosya;
    const yetim = medyaKaydet(yollar, JPG).dosya;
    writeFileSync(join(yollar.medyaKlasoru, 'beni-oku.txt'), 'kullanıcının dosyası');
    writeFileSync(join(yollar.medyaKlasoru, `${yetim}.yaziliyor`), 'yarım');

    expect(yetimMedyalariTemizle(yollar, [kalan])).toBe(2);
    expect(readdirSync(yollar.medyaKlasoru).sort()).toEqual(['beni-oku.txt', kalan].sort());
  });
});

describe('yayın listesi üretimi', () => {
  it('hiç ayar yokken karşılama; kampanya yoksa kampanya satırı atlanır', () => {
    ayarYaz(ortam.uygulama.vt, AYAR.ISLETME_ADI, 'Yılmaz Market');
    const y = yapilandirma();
    expect(y.isletmeAdi).toBe('Yılmaz Market');
    expect(y.karsilamaMetni).toBe('Hoş geldiniz');
    expect(y.logoUrl).toBeNull();
    expect(y.tesekkurMs).toBe(6000);
    expect(y.slaytlar.map((s) => s.tip)).toEqual(['KARSILAMA']);
  });

  it('geçerli kampanyalar fiyatıyla slayt olur; bitmiş, başlamamış ve pasif olanlar olmaz', () => {
    const ayran = urunEkle(ortam, { ad: 'Ayran 1 L', satisFiyati: 3000 });
    const pasif = urunEkle(ortam, { ad: 'Kaldırılan', satisFiyati: 1000 });
    urunuPasiflestir(ortam.uygulama.baglam, ortam.admin, pasif, true);
    const sut = cagirKategoriKaydet(ortam, 'Süt');

    kampanya({ hedef_id: ayran, ad: 'Hafta Sonu' });
    kampanya({ kapsam: 'KATEGORI', hedef_id: sut, tip: 'N_AL_M_ODE', deger: 2, esik_miktar: 3000, ad: '' });
    kampanya({ hedef_id: ayran, bitis: '2001-01-01T00:00:00.000Z', ad: 'Bitmiş' });
    kampanya({ hedef_id: ayran, baslangic: '2998-01-01T00:00:00.000Z', ad: 'Başlamamış' });
    kampanya({ hedef_id: ayran, aktif_mi: false, ad: 'Kapatılmış' });
    kampanya({ hedef_id: pasif, ad: 'Pasif ürün' });

    const fiyatlar = yapilandirma().slaytlar.filter((s) => s.tip === 'FIYAT');
    expect(fiyatlar.map((s) => (s.tip === 'FIYAT' ? [s.kart.ust, s.kart.ad, s.kart.rozet, s.kart.fiyat] : []))).toEqual(
      expect.arrayContaining([
        ['Hafta Sonu', 'Ayran 1 L', '%20 İNDİRİM', '24,00 ₺'],
        ['Kampanya', 'Seçili Süt ürünlerinde', '3 AL 2 ÖDE', null],
      ]),
    );
    expect(fiyatlar).toHaveLength(2);
    expect(fiyatlar.every((s) => s.anahtar.startsWith('kampanyalar:'))).toBe(true);
  });

  it('ürün fiyatı slaytı fiyatı her seferinde katalogdan okur — kampanya varsa eski fiyat üstü çizili', () => {
    const peynir = urunEkle(ortam, { ad: 'Beyaz Peynir', satisFiyati: 18000, birimTipi: 'KG' });
    slaytlariYaz([{ id: 'p', tip: 'URUN', aktif: true, urun_id: peynir, baslik: 'Haftanın Ürünü', tema: 'YESIL', sure_sn: 8 }]);

    let [slayt] = yapilandirma().slaytlar;
    expect(slayt).toMatchObject({ tip: 'FIYAT', kart: { ad: 'Beyaz Peynir', fiyat: '180,00 ₺', eskiFiyat: null, birim: '/kg' } });

    kampanya({ hedef_id: peynir, tip: 'SABIT_FIYAT', deger: 15990 });
    [slayt] = yapilandirma().slaytlar;
    expect(slayt).toMatchObject({ kart: { fiyat: '159,90 ₺', eskiFiyat: '180,00 ₺', rozet: 'İNDİRİMDE' } });

    // Ürün pasife alınınca eski fiyat ekranda kalmaz.
    urunuPasiflestir(ortam.uygulama.baglam, ortam.admin, peynir, true);
    expect(yapilandirma().slaytlar).toEqual([]);
  });

  it('pasif slaytlar ve dosyası silinmiş görseller atlanır; sıra korunur', () => {
    const yollar = ortam.uygulama.baglam.yollar;
    const gorsel = medyaKaydet(yollar, PNG).dosya;
    const video = medyaKaydet(yollar, MP4).dosya;
    slaytlariYaz([
      { id: 'v', tip: 'VIDEO', aktif: true, dosya: video, ad: 'reklam.mp4' },
      { id: 'yok', tip: 'GORSEL', aktif: true, dosya: '11111111-2222-4333-8444-555555555555.png', ad: 'silinmiş', sure_sn: 5 },
      { id: 'd', tip: 'DUYURU', aktif: false, baslik: 'Kapalı', metin: '', tema: 'MAVI', sure_sn: 5 },
      { id: 'g', tip: 'GORSEL', aktif: true, dosya: gorsel, ad: 'afiş', sure_sn: 12 },
      { id: 'k', tip: 'KARSILAMA', aktif: true, sure_sn: 4 },
    ]);

    expect(yapilandirma().slaytlar).toEqual([
      { anahtar: 'v', tip: 'VIDEO', sureMs: 300_000, url: medyaUrl(video) },
      { anahtar: 'g', tip: 'GORSEL', sureMs: 12_000, url: medyaUrl(gorsel) },
      { anahtar: 'k', tip: 'KARSILAMA', sureMs: 4_000 },
    ]);
  });

  it('önizleme kaydedilmemiş ayarlarla üretilir, veritabanına dokunmaz', () => {
    const y = musteriEkraniYapilandirmasi(ortam.uygulama.baglam, {
      ayarlar: {
        [MUSTERI_EKRANI_AYAR.KARSILAMA_METNI]: 'Merhaba',
        [MUSTERI_EKRANI_AYAR.TESEKKUR_SN]: '99',
        [MUSTERI_EKRANI_AYAR.SLAYTLAR]: JSON.stringify([
          { id: 'd', tip: 'DUYURU', aktif: true, baslik: 'Taze ekmek', metin: '', tema: 'TURUNCU', sure_sn: 6 },
        ]),
      },
    });
    expect(y.karsilamaMetni).toBe('Merhaba');
    expect(y.tesekkurMs).toBe(30_000); // üst sınıra kırpılır
    expect(y.slaytlar).toEqual([
      { anahtar: 'd', tip: 'DUYURU', sureMs: 6_000, baslik: 'Taze ekmek', metin: '', tema: 'TURUNCU' },
    ]);
    expect(ayarOku(ortam.uygulama.vt, MUSTERI_EKRANI_AYAR.KARSILAMA_METNI)).toBeNull();
  });

  it('logo yalnız dosyası varsa gösterilir', () => {
    const logo = medyaKaydet(ortam.uygulama.baglam.yollar, PNG).dosya;
    ayarYaz(ortam.uygulama.vt, MUSTERI_EKRANI_AYAR.LOGO, logo);
    expect(yapilandirma().logoUrl).toBe(`musteri-medya://dosya/${logo}`);
    ayarYaz(ortam.uygulama.vt, MUSTERI_EKRANI_AYAR.LOGO, '11111111-2222-4333-8444-555555555555.png');
    expect(yapilandirma().logoUrl).toBeNull();
  });
});

describe('kanallar', () => {
  it('bozuk yayın listesi ve yol içeren logo kaydedilmez', () => {
    const kanallar = kanallariOlustur(ortam.uygulama);
    expect(() =>
      kanallar['ayar.yaz']({
        degerler: {
          [MUSTERI_EKRANI_AYAR.SLAYTLAR]: JSON.stringify([
            { id: 'd', tip: 'DUYURU', aktif: true, baslik: '', metin: '', tema: 'MAVI', sure_sn: 8 },
          ]),
        },
      }),
    ).toThrow(/Duyuru başlığı boş olamaz/);
    expect(() => kanallar['ayar.yaz']({ degerler: { [MUSTERI_EKRANI_AYAR.LOGO]: '../veri/market.db' } })).toThrow(
      /logosu geçersiz/,
    );
    expect(ayarOku(ortam.uygulama.vt, MUSTERI_EKRANI_AYAR.SLAYTLAR)).toBeNull();
  });

  it('kayıt yetim dosyaları temizler ve müşteri ekranına "ayar değişti" der', () => {
    const kanallar = kanallariOlustur(ortam.uygulama);
    const yollar = ortam.uygulama.baglam.yollar;
    const olaylar: string[] = [];
    ortam.uygulama.olayDinle((olay) => olaylar.push(olay));

    const kullanilan = kanallar['musteri_ekrani.medyaYukle']({ veri: PNG, tur: 'GORSEL' }).dosya;
    const logo = kanallar['musteri_ekrani.medyaYukle']({ veri: JPG, tur: 'GORSEL' }).dosya;
    const vazgecilen = kanallar['musteri_ekrani.medyaYukle']({ veri: MP4, tur: 'VIDEO' }).dosya;

    kanallar['ayar.yaz']({
      degerler: {
        [MUSTERI_EKRANI_AYAR.LOGO]: logo,
        [MUSTERI_EKRANI_AYAR.SLAYTLAR]: JSON.stringify([
          { id: 'g', tip: 'GORSEL', aktif: true, dosya: kullanilan, ad: 'afiş', sure_sn: 8 },
        ]),
      },
    });

    expect(existsSync(join(yollar.medyaKlasoru, kullanilan))).toBe(true);
    expect(existsSync(join(yollar.medyaKlasoru, logo))).toBe(true);
    expect(existsSync(join(yollar.medyaKlasoru, vazgecilen))).toBe(false);
    expect(olaylar).toContain('ayar:degisti');
  });

  it('Aç/Kapat hemen yazar ve pencere yöneticisine "ayar değişti" der; kasiyer yapamaz', () => {
    const kanallar = kanallariOlustur(ortam.uygulama);
    const olaylar: unknown[] = [];
    ortam.uygulama.olayDinle((olay, veri) => olay === 'ayar:degisti' && olaylar.push(veri));
    const vt = ortam.uygulama.baglam.vt;

    kanallar['musteri_ekrani.ayarla']({ acik: true, ekran: 'PENCERE' });
    expect(ayarOku(vt, MUSTERI_EKRANI_AYAR.ACIK)).toBe('1');
    expect(ayarOku(vt, MUSTERI_EKRANI_AYAR.EKRAN)).toBe('PENCERE');

    kanallar['musteri_ekrani.ayarla']({ acik: false });
    expect(ayarOku(vt, MUSTERI_EKRANI_AYAR.ACIK)).toBe('0');
    expect(ayarOku(vt, MUSTERI_EKRANI_AYAR.EKRAN), 'ekran seçimi korunur').toBe('PENCERE');
    expect(olaylar).toHaveLength(2);

    ortam.uygulama.aktoruAyarla(ortam.kasiyer);
    expect(() => kanallariOlustur(ortam.uygulama)['musteri_ekrani.ayarla']({ acik: true })).toThrow();
  });

  it('medya yükleme ayar yetkisi ister', () => {
    ortam.uygulama.aktoruAyarla(ortam.kasiyer);
    const kanallar = kanallariOlustur(ortam.uygulama);
    expect(() => kanallar['musteri_ekrani.medyaYukle']({ veri: PNG })).toThrow();
  });

  it('sepet görüntüsü denetçiye aynen gider; geçersiz sepet reddedilir; denetçi yoksa kapalı durum', () => {
    const gelen: MusteriSepeti[] = [];
    const denetci: MusteriEkraniDenetcisi = { sepetGuncelle: (s) => gelen.push(s), durum: () => KAPALI_DURUM };
    const kanallar = kanallariOlustur(ortam.uygulama, undefined, denetci);

    const sepet: MusteriSepeti = {
      satirlar: [
        {
          anahtar: 'a',
          ad: 'Süt',
          miktar: 1000,
          birimTipi: 'ADET',
          birimFiyat: 3000,
          listeFiyati: 3000,
          tutar: 3000,
          iskonto: 0,
        },
      ],
      sonAnahtar: 'a',
      genelToplam: 3000,
      kazanc: 0,
    };
    kanallar['musteri_ekrani.sepet'](sepet);
    expect(gelen).toEqual([sepet]);
    expect(() => kanallar['musteri_ekrani.sepet']({ satirlar: 'yok' })).toThrow();

    expect(kanallariOlustur(ortam.uygulama)['musteri_ekrani.durum']()).toEqual(KAPALI_DURUM);
  });

  it('satış kesinleşince olay ödenen tutarı ve para üstünü taşır (teşekkür ekranı)', async () => {
    const kanallar = kanallariOlustur(ortam.uygulama);
    const urunId = urunEkle(ortam, { satisFiyati: 1250 });
    let veri: unknown;
    ortam.uygulama.olayDinle((olay, v) => {
      if (olay === 'satis:kesinlesti') veri = v;
    });

    await kanallar['satis.kesinlestir']({
      kalemler: [{ urun_id: urunId, miktar: 1000, birim_fiyat: 1250 }],
      odemeler: [{ tip: 'NAKIT', tutar: 1250, alinan: 2000 }],
      fis_yazdir: false,
    });
    expect(veri).toMatchObject({ genelToplam: 1250, paraUstu: 750 });
  });
});
