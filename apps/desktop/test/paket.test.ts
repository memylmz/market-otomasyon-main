/**
 * Paket seçenekleri (12'li kibrit): tanım, barkodla bulma, satış, iptal, iade.
 *
 * Değişmez: stok TEK adet üzerinden tutulur. Paket satırında miktar paket
 * sayısıdır; stoktan, maliyetten ve satılan adetten içindeki adet kadar düşer.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet, HATA_KODU } from '@market/shared';
import { bekleyenOlaylar } from '../src/main/depo/senkron.js';
import { kalemleriGetir } from '../src/main/depo/satis.js';
import { stokOku } from '../src/main/depo/stok.js';
import { barkodOku, urunPaketleriniKaydet, urunPaketSecenekleri } from '../src/main/servis/katalog-servis.js';
import { iadeYap, satisIptal, satisKesinlestir } from '../src/main/servis/satis-servis.js';
import { testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;
let kibrit: string;

beforeEach(async () => {
  ortam = await testOrtamiKur();
  // Tek kibrit 2,00 TL, alış 1,20 TL; stok 100 adet.
  kibrit = urunEkle(ortam, {
    ad: 'Kibrit',
    satisFiyati: 200,
    alisFiyati: 120,
    kdvOrani: 20,
    barkod: '8690000000017',
    stok: adet(100),
  });
});

afterEach(async () => {
  await ortam.temizle();
});

const paketTanimla = (ek: Record<string, unknown> = {}) =>
  urunPaketleriniKaydet(ortam.uygulama.baglam, ortam.admin, {
    urun_id: kibrit,
    paketler: [{ ad: "12'li paket", carpan: 12, fiyat: 2000, barkod: '8690000000024', ...ek }],
  });

function paketSat(paketId: string, paketSayisi = 1, fiyat = 2000) {
  return satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
    kalemler: [{ urun_id: kibrit, miktar: adet(paketSayisi), birim_fiyat: fiyat, paket_id: paketId }],
    odemeler: [{ tip: 'NAKIT', tutar: fiyat * paketSayisi }],
  });
}

describe('paket tanımı ve barkod', () => {
  it('ürünün kendi barkodu okutulunca paketler fiyatlarıyla gelir, paket seçilmez', () => {
    const [paket] = paketTanimla();
    const sonuc = barkodOku(ortam.uygulama.baglam, '8690000000017');
    expect(sonuc.fiyat).toBe(200);
    expect(sonuc.paketler?.map((p) => [p.id, p.carpan, p.satisFiyati])).toEqual([[paket!.id, 12, 2000]]);
    expect(sonuc.paketId).toBeUndefined();
  });

  it('paketin kendi barkodu okutulunca doğrudan o paket seçilir', () => {
    const [paket] = paketTanimla();
    const sonuc = barkodOku(ortam.uygulama.baglam, '8690000000024');
    expect(sonuc.bulundu).toBe(true);
    expect(sonuc.urun?.id).toBe(kibrit);
    expect(sonuc.paketId).toBe(paket!.id);
  });

  it('fiyatı boş paket çarpan × tek fiyatla satılır', () => {
    paketTanimla({ fiyat: null });
    expect(urunPaketSecenekleri(ortam.uygulama.baglam, kibrit)[0]?.satisFiyati).toBe(2400);
  });

  it('paket barkodu ürün barkodu olamaz, başka ürünün barkodu da paket barkodu olamaz', () => {
    expect(() => paketTanimla({ barkod: '8690000000017' })).toThrow(/kayıtlı/);
    urunEkle(ortam, { ad: 'Çakmak', barkod: '8690000000031' });
    expect(() => paketTanimla({ barkod: '8690000000031' })).toThrow(/Çakmak/);
  });

  it('listede olmayan paket pasifleşir; bulut olayı yazılır', () => {
    paketTanimla();
    urunPaketleriniKaydet(ortam.uygulama.baglam, ortam.admin, { urun_id: kibrit, paketler: [] });
    expect(urunPaketSecenekleri(ortam.uygulama.baglam, kibrit)).toEqual([]);
    expect(barkodOku(ortam.uygulama.baglam, '8690000000024').bulundu).toBe(false);
    const olaylar = bekleyenOlaylar(ortam.uygulama.baglam.vt, 500).filter((o) => o.olay_tipi === 'URUN_PAKETI_KAYDEDILDI');
    expect(olaylar).toHaveLength(2);
  });

  it('kilo ile satılan üründe paket tanımlanamaz', () => {
    const peynir = urunEkle(ortam, { ad: 'Peynir', birimTipi: 'KG' });
    expect(() =>
      urunPaketleriniKaydet(ortam.uygulama.baglam, ortam.admin, { urun_id: peynir, paketler: [{ ad: 'Kalıp', carpan: 2 }] }),
    ).toThrow(/adetle/);
  });
});

describe('paketli satış', () => {
  it('1 paket: satır 1 × 20,00; stoktan 12 düşer; maliyet ve satılan adet 12 tek üzerinden', () => {
    const [paket] = paketTanimla();
    const { satisId, genelToplam } = paketSat(paket!.id);
    expect(genelToplam).toBe(2000);
    expect(stokOku(ortam.uygulama.baglam.vt, kibrit)).toBe(adet(88));

    const [kalem] = kalemleriGetir(ortam.uygulama.baglam.vt, satisId);
    expect(kalem).toMatchObject({
      urun_adi: "Kibrit (12'li paket)",
      miktar: adet(1),
      birim_fiyat: 2000,
      birim_maliyet: 12 * 120,
      paket_carpani: 12,
      paket_adi: "12'li paket",
      satir_toplam: 2000,
    });

    const ozet = ortam.uygulama.baglam.vt
      .hazirla('SELECT adet FROM urun_satis_ozet WHERE urun_id = ?')
      .tek<{ adet: number }>(kibrit);
    expect(ozet?.adet).toBe(adet(12));

    const olay = bekleyenOlaylar(ortam.uygulama.baglam.vt, 500).find((o) => o.olay_tipi === 'SATIS_YAPILDI');
    const veri = JSON.parse(String(olay?.veri)) as { kalemler: { paket_carpani: number; miktar: number }[] };
    expect(veri.kalemler[0]).toMatchObject({ paket_carpani: 12, miktar: adet(1) });
  });

  it('istemci yanlış paket fiyatı gönderse de paketin fiyatıyla satılır (yetkisiz kasiyer)', () => {
    const [paket] = paketTanimla();
    const { genelToplam } = satisKesinlestir(ortam.uygulama.baglam, ortam.kasiyer, {
      kalemler: [{ urun_id: kibrit, miktar: adet(1), birim_fiyat: 200, paket_id: paket!.id }],
      odemeler: [{ tip: 'NAKIT', tutar: 2000 }],
    });
    expect(genelToplam).toBe(2000);
  });

  it('yarım paket satılamaz; başka ürünün paketi kullanılamaz', () => {
    const [paket] = paketTanimla();
    expect(() =>
      satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
        kalemler: [{ urun_id: kibrit, miktar: 500, birim_fiyat: 2000, paket_id: paket!.id }],
        odemeler: [{ tip: 'NAKIT', tutar: 1000 }],
      }),
    ).toThrow(/tam paket/);
    const cakmak = urunEkle(ortam, { ad: 'Çakmak', satisFiyati: 1000 });
    expect(() =>
      satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
        kalemler: [{ urun_id: cakmak, miktar: adet(1), birim_fiyat: 2000, paket_id: paket!.id }],
        odemeler: [{ tip: 'NAKIT', tutar: 2000 }],
      }),
    ).toThrow(/paket artık tanımlı değil/);
  });

  it('aynı fişte tekli ve paket birlikte', () => {
    const [paket] = paketTanimla();
    const { genelToplam } = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [
        { urun_id: kibrit, miktar: adet(3), birim_fiyat: 200 },
        { urun_id: kibrit, miktar: adet(2), birim_fiyat: 2000, paket_id: paket!.id },
      ],
      odemeler: [{ tip: 'NAKIT', tutar: 600 + 4000 }],
    });
    expect(genelToplam).toBe(4600);
    expect(stokOku(ortam.uygulama.baglam.vt, kibrit)).toBe(adet(100 - 3 - 24));
  });

  it('iptal 12 adedi geri koyar', () => {
    const [paket] = paketTanimla();
    const { satisId } = paketSat(paket!.id);
    satisIptal(ortam.uygulama.baglam, ortam.admin, satisId, 'deneme');
    expect(stokOku(ortam.uygulama.baglam.vt, kibrit)).toBe(adet(100));
    const ozet = ortam.uygulama.baglam.vt
      .hazirla('SELECT adet FROM urun_satis_ozet WHERE urun_id = ?')
      .tek<{ adet: number }>(kibrit);
    expect(ozet?.adet).toBe(0);
  });

  it('iade: tam paket iade edilir, 12 adet stoğa döner; yarım paket iade edilemez', () => {
    const [paket] = paketTanimla();
    const { satisId } = paketSat(paket!.id, 2);
    const [kalem] = kalemleriGetir(ortam.uygulama.baglam.vt, satisId);
    expect(() =>
      iadeYap(ortam.uygulama.baglam, ortam.admin, {
        kaynak_satis_id: satisId,
        kalemler: [{ satis_kalemi_id: kalem!.id, miktar: 500 }],
        iade_yontemi: 'NAKIT',
        neden: 'deneme',
      }),
    ).toThrow(/tam paket/);
    const iade = iadeYap(ortam.uygulama.baglam, ortam.admin, {
      kaynak_satis_id: satisId,
      kalemler: [{ satis_kalemi_id: kalem!.id, miktar: adet(1) }],
      iade_yontemi: 'NAKIT',
      neden: 'deneme',
    });
    expect(iade.genelToplam).toBe(-2000);
    expect(stokOku(ortam.uygulama.baglam.vt, kibrit)).toBe(adet(100 - 24 + 12));
    const [iadeKalemi] = kalemleriGetir(ortam.uygulama.baglam.vt, iade.satisId);
    expect(iadeKalemi).toMatchObject({ miktar: -adet(1), paket_carpani: 12 });
  });

  it('pakete yalnız yüzde kampanyası uygulanır', async () => {
    const { kampanyaKaydet } = await import('../src/main/servis/katalog-servis.js');
    const simdi = Date.now();
    kampanyaKaydet(ortam.uygulama.baglam, ortam.admin, {
      ad: 'Tümünde %10',
      tip: 'YUZDE',
      kapsam: 'TUM',
      deger: 10,
      baslangic: new Date(simdi - 60_000).toISOString(),
      bitis: new Date(simdi + 3_600_000).toISOString(),
    });
    expect(urunPaketSecenekleri(ortam.uygulama.baglam, (paketTanimla(), kibrit))[0]?.satisFiyati).toBe(1800);
  });

  it('paketsiz ürünün satışı değişmedi (çarpan yok)', () => {
    const { satisId } = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: kibrit, miktar: adet(2), birim_fiyat: 200 }],
      odemeler: [{ tip: 'NAKIT', tutar: 400 }],
    });
    expect(kalemleriGetir(ortam.uygulama.baglam.vt, satisId)[0]).toMatchObject({ paket_carpani: null, birim_maliyet: 120 });
    expect(stokOku(ortam.uygulama.baglam.vt, kibrit)).toBe(adet(98));
  });
});

describe('hata kodu', () => {
  it('çakışan barkod BARKOD_KULLANIMDA döner', () => {
    try {
      paketTanimla({ barkod: '8690000000017' });
      expect.unreachable();
    } catch (hata) {
      expect((hata as { kod?: string }).kod).toBe(HATA_KODU.BARKOD_KULLANIMDA);
    }
  });
});
