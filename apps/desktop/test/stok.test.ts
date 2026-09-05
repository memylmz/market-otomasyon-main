/**
 * Stok akışları: tedarikçiye iade ve Türkçe alfabetik ürün sıralaması.
 * Gerçek SQLite üzerinde çalışır (tetikleyiciler + tr_sira fonksiyonu dahil).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet } from '@market/shared';
import { cariBul } from '../src/main/depo/cari.js';
import { urunleriListele } from '../src/main/depo/katalog.js';
import { stokOku } from '../src/main/depo/stok.js';
import { stokDuzeltme, tedarikciIade } from '../src/main/servis/stok-servis.js';
import { musteriEkle, tedarikciEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

describe('tedarikçiye iade', () => {
  it('stok düşer, tutar tedarikçi borcundan düşülür ve olaylar kuyruğa yazılır', () => {
    const tedarikciId = tedarikciEkle(ortam);
    // alisFiyati 700 kuruş (KDV hariç), %20 KDV.
    const urunId = urunEkle(ortam, { ad: 'Hasarlı Kola', alisFiyati: 700, kdvOrani: 20, stok: adet(100) });

    const sonuc = tedarikciIade(ortam.uygulama.baglam, ortam.admin, {
      tedarikci_id: tedarikciId,
      neden: 'hasarlı geldi',
      kalemler: [{ urun_id: urunId, miktar: adet(2), birim_fiyat: 700, kdv_orani: 20 }],
    });

    // net 2 × 7,00 = 14,00; %20 KDV = 2,80 → 16,80 ₺
    expect(sonuc.genelToplam).toBe(1680);
    expect(sonuc.kalemSayisi).toBe(1);
    expect(sonuc.odemeSekli).toBe('CARIDEN_DUS');

    // Stok 100 → 98
    expect(stokOku(ortam.uygulama.baglam.vt, urunId)).toBe(adet(98));

    // Cari: borç yokken iade → bakiye eksiye düşer (tedarikçi bize borçlu görünür).
    expect(cariBul(ortam.uygulama.baglam.vt, tedarikciId)?.bakiye).toBe(-1680);

    // Hareket TEDARIKCI_IADE tipiyle, çıkış (negatif) olarak yazıldı.
    const hareket = ortam.uygulama.baglam.vt
      .hazirla(`SELECT hareket_tipi, miktar FROM stok_hareketleri WHERE belge_id = ?`)
      .tek<{ hareket_tipi: string; miktar: number }>(sonuc.iadeId);
    expect(hareket).toEqual({ hareket_tipi: 'TEDARIKCI_IADE', miktar: -adet(2) });

    // Senkron kuyruğu: stok + cari olayı.
    const olaylar = ortam.uygulama.baglam.vt
      .hazirla(`SELECT olay_tipi FROM sync_outbox ORDER BY olusturma_zamani, rowid`)
      .tumu<{ olay_tipi: string }>()
      .map((o) => o.olay_tipi);
    expect(olaylar).toContain('STOK_HAREKETI');
    expect(olaylar).toContain('CARI_HAREKETI');
  });

  it('nakit iadede tutar kasaya giriş yazılır, cari değişmez', () => {
    const tedarikciId = tedarikciEkle(ortam);
    const urunId = urunEkle(ortam, { alisFiyati: 1000, kdvOrani: 10, stok: adet(50) });

    const sonuc = tedarikciIade(ortam.uygulama.baglam, ortam.admin, {
      tedarikci_id: tedarikciId,
      odeme_sekli: 'NAKIT',
      kalemler: [{ urun_id: urunId, miktar: adet(3), birim_fiyat: 1000, kdv_orani: 10 }],
    });

    // net 3 × 10,00 = 30,00; %10 KDV = 3,00 → 33,00 ₺
    expect(sonuc.genelToplam).toBe(3300);

    const kasa = ortam.uygulama.baglam.vt
      .hazirla(`SELECT tip, tutar FROM kasa_hareketleri WHERE belge_id = ?`)
      .tek<{ tip: string; tutar: number }>(sonuc.iadeId);
    expect(kasa).toEqual({ tip: 'GIRIS', tutar: 3300 });

    expect(cariBul(ortam.uygulama.baglam.vt, tedarikciId)?.bakiye).toBe(0);
    expect(stokOku(ortam.uygulama.baglam.vt, urunId)).toBe(adet(47));
  });

  it('tedarikçi olmayan cari reddedilir ve hiçbir kayıt atılmaz', () => {
    const musteriId = musteriEkle(ortam);
    const urunId = urunEkle(ortam, { stok: adet(10) });

    expect(() =>
      tedarikciIade(ortam.uygulama.baglam, ortam.admin, {
        tedarikci_id: musteriId,
        kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 500, kdv_orani: 20 }],
      }),
    ).toThrowError(/tedarikçi değil/i);

    expect(stokOku(ortam.uygulama.baglam.vt, urunId)).toBe(adet(10));
  });
});

describe('Türkçe alfabetik ürün sıralaması (tr_sira)', () => {
  it('urunleriListele adları Türk alfabesine göre, harf boyutundan bağımsız sıralar', () => {
    const adlar = ['Çilek', 'zencefil', 'armut', 'İncir', 'Şeker', 'ırmak', 'elma', 'Üzüm', 'iğde'];
    for (const ad of adlar) urunEkle(ortam, { ad });

    const { kayitlar } = urunleriListele(ortam.uygulama.baglam.vt, { siralama: 'ad' });
    expect(kayitlar.map((k) => k.ad)).toEqual(['armut', 'Çilek', 'elma', 'ırmak', 'iğde', 'İncir', 'Şeker', 'Üzüm', 'zencefil']);
  });
});

describe('ürün kartından stok girişi (§10.5)', () => {
  /**
   * Kullanıcı "yeni ürün eklerken stok giremiyorum" dedi. Alan aslında vardı
   * ama adı "Açılış stoğu" idi ve "Kritik stok" ile "İdeal stok"un ARDINDA,
   * en sonda duruyordu; üç stok alanı arasında gerçekten stok gireni bulmak
   * mümkün olmuyordu. Panelde bu alan çoktan "Stok miktarı" olmuştu.
   *
   * Buradaki testler arayüzün dayandığı iki servis yolunu kilitler.
   */
  it('yeni üründe açılış stoğu doğrudan stok olur', () => {
    const urunId = urunEkle(ortam, { ad: 'Yeni Ürün', stok: adet(42) });
    expect(stokOku(ortam.uygulama.baglam.vt, urunId)).toBe(adet(42));
  });

  it('açılış stoğu ACILIS hareketi olarak kayda geçer', () => {
    const urunId = urunEkle(ortam, { ad: 'Kayıtlı', stok: adet(15) });
    const hareket = ortam.uygulama.baglam.vt
      .hazirla("SELECT hareket_tipi, miktar FROM stok_hareketleri WHERE urun_id = ? AND hareket_tipi = 'ACILIS'")
      .tek<{ hareket_tipi: string; miktar: number }>(urunId);
    expect(hareket?.hareket_tipi).toBe('ACILIS');
    expect(Number(hareket?.miktar)).toBe(adet(15));
  });

  /**
   * Mevcut üründe yazılan sayı bir HEDEFTİR: fark servis tarafında güncel
   * stoğa göre hesaplanır. Farkı arayüzde hesaplamak "50 yazdım, 80 oldu"
   * hatasını doğuruyordu (§11.5).
   */
  it('mevcut üründe yazılan değer yeni stok olur', () => {
    const urunId = urunEkle(ortam, { ad: 'Düzeltilecek', stok: adet(100) });
    stokDuzeltme(ortam.uygulama.baglam, ortam.admin, urunId, adet(50), 'Ürün kartından stok düzeltmesi');
    expect(stokOku(ortam.uygulama.baglam.vt, urunId), 'yazılan sayı ne ise o olmalı').toBe(adet(50));
  });

  it('stok artırma yönünde de aynı şekilde çalışır', () => {
    const urunId = urunEkle(ortam, { ad: 'Artan', stok: adet(10) });
    stokDuzeltme(ortam.uygulama.baglam, ortam.admin, urunId, adet(75), 'Ürün kartından stok düzeltmesi');
    expect(stokOku(ortam.uygulama.baglam.vt, urunId)).toBe(adet(75));
  });

  it('açılış stoğu verilmezse stok sıfırdır', () => {
    const urunId = urunEkle(ortam, { ad: 'Stoksuz', stok: adet(0) });
    expect(stokOku(ortam.uygulama.baglam.vt, urunId)).toBe(0);
  });
});
