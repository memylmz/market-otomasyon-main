/**
 * Toptancıdan gelen malın katalogda olmayan ürünleri: fatura hem ürün kartını
 * açar hem stoğu yazar. Belgeyle ürün aynı transaction'da doğmalıdır — yarım
 * yazılmış bir irsaliye, kullanıcının en pahalıya mal olan hâlidir.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet, type Yetki } from '@market/shared';
import { cariBul } from '../src/main/depo/cari.js';
import { barkodSahibi, urunBul } from '../src/main/depo/katalog.js';
import { stokOku } from '../src/main/depo/stok.js';
import type { Aktor } from '../src/main/servis/baglam.js';
import { malKabulOnayla } from '../src/main/servis/stok-servis.js';
import { tedarikciEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

describe('faturada yeni ürün', () => {
  it('ürün kartını açar, tedarikçisini yazar, stoğu ve borcu belgeye bağlar', () => {
    const tedarikciId = tedarikciEkle(ortam, 'Toptancı A');

    const sonuc = malKabulOnayla(ortam.uygulama.baglam, ortam.admin, {
      tedarikci_id: tedarikciId,
      fatura_no: 'TOP-1001',
      kalemler: [
        {
          yeni_urun: { ad: 'Toptan Kola 1L', barkod: '8690000000017', satis_fiyati: 2500, birim_tipi: 'ADET' },
          miktar: adet(12),
          birim_fiyat: 1500,
          kdv_orani: 20,
        },
      ],
    });

    // net 12 × 15,00 = 180,00; %20 KDV = 36,00 → 216,00 ₺
    expect(sonuc.genelToplam).toBe(21_600);
    expect(sonuc.kalemSayisi).toBe(1);

    const urunId = barkodSahibi(ortam.uygulama.baglam.vt, '8690000000017');
    expect(urunId).not.toBeNull();

    const urun = urunBul(ortam.uygulama.baglam.vt, urunId!);
    expect(urun?.ad).toBe('Toptan Kola 1L');
    expect(urun?.varsayilan_tedarikci_id).toBe(tedarikciId);
    expect(urun?.alis_fiyati).toBe(1500); // kalemin birim fiyatı
    expect(urun?.satis_fiyati).toBe(2500);

    // Stok faturanın GİRİŞ hareketidir ve belgeye bağlıdır.
    expect(stokOku(ortam.uygulama.baglam.vt, urunId!)).toBe(adet(12));
    const hareket = ortam.uygulama.baglam.vt
      .hazirla('SELECT hareket_tipi, miktar, belge_id FROM stok_hareketleri WHERE urun_id = ?')
      .tek<{ hareket_tipi: string; miktar: number; belge_id: string }>(urunId!);
    expect(hareket).toEqual({ hareket_tipi: 'GIRIS', miktar: adet(12), belge_id: sonuc.faturaId });

    // Tedarikçiye borç.
    expect(cariBul(ortam.uygulama.baglam.vt, tedarikciId)?.bakiye).toBe(21_600);

    // Senkron kuyruğu: ürün, barkod, stok ve cari olayları.
    const olaylar = ortam.uygulama.baglam.vt
      .hazirla('SELECT olay_tipi FROM sync_outbox')
      .tumu<{ olay_tipi: string }>()
      .map((o) => o.olay_tipi);
    expect(olaylar).toContain('URUN_KAYDEDILDI');
    expect(olaylar).toContain('BARKOD_KAYDEDILDI');
    expect(olaylar).toContain('STOK_HAREKETI');
    expect(olaylar).toContain('ALIS_FATURASI_ONAYLANDI');
  });

  it('mevcut ve yeni ürünü tek belgede birleştirir', () => {
    const tedarikciId = tedarikciEkle(ortam);
    const mevcutId = urunEkle(ortam, { ad: 'Bilinen Süt', stok: adet(5), alisFiyati: 900 });

    const sonuc = malKabulOnayla(ortam.uygulama.baglam, ortam.admin, {
      tedarikci_id: tedarikciId,
      kalemler: [
        { urun_id: mevcutId, miktar: adet(6), birim_fiyat: 1000, kdv_orani: 10 },
        { yeni_urun: { ad: 'Yeni Ayran', satis_fiyati: 1800 }, miktar: adet(4), birim_fiyat: 1200, kdv_orani: 10 },
      ],
    });

    expect(sonuc.kalemSayisi).toBe(2);
    expect(stokOku(ortam.uygulama.baglam.vt, mevcutId)).toBe(adet(11));

    const kalemSayisi = ortam.uygulama.baglam.vt
      .hazirla('SELECT COUNT(*) AS adet FROM alis_kalemleri WHERE alis_faturasi_id = ?')
      .tek<{ adet: number }>(sonuc.faturaId);
    expect(kalemSayisi?.adet).toBe(2);
  });

  it('barkod başka üründeyse HİÇBİR satırı yazmaz', () => {
    const tedarikciId = tedarikciEkle(ortam);
    urunEkle(ortam, { ad: 'Eski Kola', barkod: '8690000000017' });
    const oncekiUrunSayisi = ortam.uygulama.baglam.vt.hazirla('SELECT COUNT(*) AS adet FROM urunler').tek<{ adet: number }>()!
      .adet;

    expect(() =>
      malKabulOnayla(ortam.uygulama.baglam, ortam.admin, {
        tedarikci_id: tedarikciId,
        kalemler: [
          { yeni_urun: { ad: 'Sağlam Satır', satis_fiyati: 1000 }, miktar: adet(1), birim_fiyat: 500, kdv_orani: 20 },
          {
            yeni_urun: { ad: 'Çakışan Kola', barkod: '8690000000017', satis_fiyati: 2500 },
            miktar: adet(1),
            birim_fiyat: 1500,
            kdv_orani: 20,
          },
        ],
      }),
    ).toThrow(/2\. satır/);

    // Ne ürün, ne fatura, ne hareket: hiçbiri yazılmamalı.
    expect(ortam.uygulama.baglam.vt.hazirla('SELECT COUNT(*) AS adet FROM urunler').tek<{ adet: number }>()!.adet).toBe(
      oncekiUrunSayisi,
    );
    expect(ortam.uygulama.baglam.vt.hazirla('SELECT COUNT(*) AS adet FROM alis_faturalari').tek<{ adet: number }>()!.adet).toBe(
      0,
    );
  });

  it('ürün düzenleme yetkisi olmayan kullanıcıyı reddeder', () => {
    const tedarikciId = tedarikciEkle(ortam);
    // Kasiyerde ne stok.giris ne urun.duzenle var; yetki hatası beklenir.
    expect(() =>
      malKabulOnayla(ortam.uygulama.baglam, ortam.kasiyer, {
        tedarikci_id: tedarikciId,
        kalemler: [{ yeni_urun: { ad: 'Kaçak Ürün', satis_fiyati: 1000 }, miktar: adet(1), birim_fiyat: 500, kdv_orani: 20 }],
      }),
    ).toThrow();
  });

  /*
   * `stok.giris`i olup `urun.duzenle`si OLMAYAN bir aktör hazır rollerde yoktur
   * (stok.giris taşıyan MUDUR/ADMIN'de urun.duzenle de var). Yukarıdaki kasiyer
   * testi genel `stok.giris` kapısını (satır 268) sınıyor, ikinci kapıyı (satır
   * 279-280) hiç tetiklemiyor: kasiyer zaten ilk kapıda reddediliyor. İkinci
   * kapıyı gerçekten sınamak için yetkileri elle daraltılmış bir aktör kurulur.
   */
  it('stok.giris olan ama urun.duzenle olmayan aktör yeni ürün kalemini reddeder', () => {
    const tedarikciId = tedarikciEkle(ortam);
    const kisitliAktor: Aktor = { ...ortam.admin, yetkiler: new Set<Yetki>(['stok.giris']) };

    expect(() =>
      malKabulOnayla(ortam.uygulama.baglam, kisitliAktor, {
        tedarikci_id: tedarikciId,
        kalemler: [{ yeni_urun: { ad: 'Kaçak Ürün 2', satis_fiyati: 1000 }, miktar: adet(1), birim_fiyat: 500, kdv_orani: 20 }],
      }),
      // Mesaj, ikinci kapının kendi açıklamasını taşır — reddin stok.giris'ten
      // değil, urun.duzenle'den geldiğini kanıtlar.
    ).toThrow(/faturada yeni ürün açma/);
  });

  it('aynı kısıtlı aktörle MEVCUT ürüne bağlı kalem başarıyla geçer (kapı yalnız yeni ürünü engeller)', () => {
    const tedarikciId = tedarikciEkle(ortam);
    const mevcutId = urunEkle(ortam, { ad: 'Bilinen Yağ' });
    const kisitliAktor: Aktor = { ...ortam.admin, yetkiler: new Set<Yetki>(['stok.giris']) };

    const sonuc = malKabulOnayla(ortam.uygulama.baglam, kisitliAktor, {
      tedarikci_id: tedarikciId,
      kalemler: [{ urun_id: mevcutId, miktar: adet(3), birim_fiyat: 800, kdv_orani: 20 }],
    });

    expect(sonuc.kalemSayisi).toBe(1);
  });

  it('HAVALE ödemede cari kapanır ama kasa çekmecesine dokunulmaz', () => {
    const tedarikciId = tedarikciEkle(ortam);

    const sonuc = malKabulOnayla(ortam.uygulama.baglam, ortam.admin, {
      tedarikci_id: tedarikciId,
      odenen_tutar: 1200,
      odeme_tipi: 'HAVALE',
      kalemler: [{ yeni_urun: { ad: 'Havaleli Ürün', satis_fiyati: 2000 }, miktar: adet(1), birim_fiyat: 1000, kdv_orani: 20 }],
    });

    expect(sonuc.genelToplam).toBe(1200);
    expect(sonuc.kalanBorc).toBe(0);
    expect(cariBul(ortam.uygulama.baglam.vt, tedarikciId)?.bakiye).toBe(0);

    const kasaHareketi = ortam.uygulama.baglam.vt
      .hazirla('SELECT COUNT(*) AS adet FROM kasa_hareketleri WHERE belge_id = ?')
      .tek<{ adet: number }>(sonuc.faturaId);
    expect(kasaHareketi?.adet).toBe(0);
  });
});
