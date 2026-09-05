/**
 * Kategori silme testleri (§10.5).
 *
 * Kullanıcı silmeyle aynı kural: kullanılmayan kategori gerçekten silinir,
 * ürünü olan pasife alınır. `urunler.kategori_id` kategorilere yabancı
 * anahtarla bağlı olduğu için dolu bir kategoriyi silmek veritabanı
 * tarafından zaten reddedilirdi; biz önce sayıp anlamlı gerekçe veriyoruz.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { kategoriSil } from '../src/main/servis/katalog-servis.js';
import { kategorileriListele } from '../src/main/depo/katalog.js';
import { testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';
import { cagirKategoriKaydet } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

// sadeceAktif=false: pasife alınan kategoriyi de görebilmek için.
const kategoriAdi = (id: string) => kategorileriListele(ortam.uygulama.vt, false).find((k) => k.id === id);

describe('kategori silme (§10.5)', () => {
  it('hiç ürünü olmayan kategori gerçekten silinir', () => {
    const id = cagirKategoriKaydet(ortam, 'Boş Kategori');
    expect(kategoriAdi(id)).toBeDefined();

    const sonuc = kategoriSil(ortam.uygulama.baglam, ortam.admin, id);

    expect(sonuc.silindi).toBe(true);
    expect(kategoriAdi(id)).toBeUndefined();
  });

  it('ürünü olan kategori silinmez, pasife alınır ve ürünler bozulmaz', () => {
    const kategoriId = cagirKategoriKaydet(ortam, 'Manav');
    const urunId = urunEkle(ortam, { ad: 'Domates' });
    ortam.uygulama.vt.hazirla('UPDATE urunler SET kategori_id = ? WHERE id = ?').calistir(kategoriId, urunId);

    const sonuc = kategoriSil(ortam.uygulama.baglam, ortam.admin, kategoriId);

    expect(sonuc.silindi).toBe(false);
    expect(sonuc.urunSayisi).toBe(1);
    expect(kategoriAdi(kategoriId)?.aktif_mi).toBe(false);

    // Ürün hâlâ o kategoriye bağlı — bağlantı koparılmadı.
    const urun = ortam.uygulama.vt.hazirla('SELECT kategori_id FROM urunler WHERE id = ?').tek<{ kategori_id: string }>(urunId);
    expect(urun?.kategori_id).toBe(kategoriId);
  });

  it('alt kategorisi olan kategori silinmez, pasife alınır', () => {
    const ustId = cagirKategoriKaydet(ortam, 'İçecek');
    const altId = cagirKategoriKaydet(ortam, 'Soğuk İçecek', ustId);

    const sonuc = kategoriSil(ortam.uygulama.baglam, ortam.admin, ustId);

    expect(sonuc.silindi).toBe(false);
    expect(kategoriAdi(ustId)?.aktif_mi).toBe(false);
    expect(kategoriAdi(altId)).toBeDefined();
  });

  it('yetkisiz kullanıcı silemez', () => {
    const id = cagirKategoriKaydet(ortam, 'Korumalı');
    expect(ortam.kasiyer.yetkiler.has('urun.duzenle')).toBe(false);
    expect(() => kategoriSil(ortam.uygulama.baglam, ortam.kasiyer, id)).toThrow();
    expect(kategoriAdi(id)).toBeDefined();
  });
});
