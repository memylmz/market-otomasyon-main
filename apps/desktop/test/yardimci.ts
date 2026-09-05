/**
 * Entegrasyon testleri için ortak kurulum.
 * Gerçek SQLite (bellek içi) kullanılır — repository, transaction ve tetikleyici
 * davranışı gerçek motorda doğrulanır (§21.1).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adet, etkinYetkiler, miktarOlustur, type Kurus, type Miktar } from '@market/shared';
import { Uygulama } from '../src/main/uygulama.js';
import { kullaniciKaydet } from '../src/main/depo/kullanici.js';
import { kategoriKaydet } from '../src/main/depo/katalog.js';
import type { Aktor } from '../src/main/servis/baglam.js';
import { kasaAc } from '../src/main/servis/kasa-servis.js';
import { urunuKaydet } from '../src/main/servis/katalog-servis.js';
import { cariKaydet } from '../src/main/servis/cari-servis.js';

export interface TestOrtami {
  uygulama: Uygulama;
  admin: Aktor;
  kasiyer: Aktor;
  kok: string;
  temizle(): Promise<void>;
}

export async function testOrtamiKur(secenekler: { kasaAc?: boolean } = {}): Promise<TestOrtami> {
  const kok = mkdtempSync(join(tmpdir(), 'market-test-'));
  const uygulama = await Uygulama.olustur({
    veriKoku: kok,
    vtYolu: ':memory:',
    sessiz: true,
    zamanlayiciKapali: true,
  });

  const adminId = uygulama.yoneticiOlustur({ ad: 'Test Yönetici', kullaniciAdi: 'admin', sifre: 'Sifre1234', pin: '4271' });
  const admin: Aktor = {
    kullaniciId: adminId,
    ad: 'Test Yönetici',
    rol: 'ADMIN',
    yetkiler: etkinYetkiler({ rol: 'ADMIN' }),
    kasaOturumId: null,
  };

  const kasiyerId = uygulama.baglam.vt.islem(() =>
    kullaniciKaydet(uygulama.baglam.vt, { ad: 'Test Kasiyer', kullanici_adi: 'kasiyer', rol: 'KASIYER' }, uygulama.cihazId),
  );
  const kasiyer: Aktor = {
    kullaniciId: kasiyerId,
    ad: 'Test Kasiyer',
    rol: 'KASIYER',
    yetkiler: etkinYetkiler({ rol: 'KASIYER' }),
    kasaOturumId: null,
  };

  if (secenekler.kasaAc !== false) {
    const sonuc = kasaAc(uygulama.baglam, admin, 10_000); // 100,00 ₺ açılış
    admin.kasaOturumId = sonuc.oturumId;
    kasiyer.kasaOturumId = sonuc.oturumId;
  }

  return {
    uygulama,
    admin,
    kasiyer,
    kok,
    async temizle() {
      await uygulama.kapat();
      rmSync(kok, { recursive: true, force: true });
    },
  };
}

export interface UrunSecenekleri {
  ad?: string;
  barkod?: string;
  satisFiyati?: Kurus;
  alisFiyati?: Kurus;
  kdvOrani?: number;
  birimTipi?: 'ADET' | 'KG' | 'LT';
  stok?: Miktar;
  kritikStok?: Miktar;
}

export function urunEkle(ortam: TestOrtami, secenekler: UrunSecenekleri = {}): string {
  return urunuKaydet(ortam.uygulama.baglam, ortam.admin, {
    ad: secenekler.ad ?? 'Test Ürün',
    satis_fiyati: secenekler.satisFiyati ?? 1200,
    alis_fiyati: secenekler.alisFiyati ?? 700,
    kdv_orani: secenekler.kdvOrani ?? 20,
    birim_tipi: secenekler.birimTipi ?? 'ADET',
    kritik_stok: secenekler.kritikStok ?? 0,
    barkodlar: secenekler.barkod ? [{ barkod: secenekler.barkod }] : [],
    acilis_stogu: secenekler.stok ?? adet(100),
  });
}

export function musteriEkle(ortam: TestOrtami, ad = 'Test Müşteri', krediLimiti: Kurus = 0): string {
  return cariKaydet(ortam.uygulama.baglam, ortam.admin, {
    tip: 'MUSTERI',
    ad_unvan: ad,
    kredi_limiti: krediLimiti,
  });
}

export function tedarikciEkle(ortam: TestOrtami, ad = 'Test Tedarikçi'): string {
  return cariKaydet(ortam.uygulama.baglam, ortam.admin, { tip: 'TEDARIKCI', ad_unvan: ad });
}

export { adet, miktarOlustur };

/** Test için kategori oluşturur ve id'sini döndürür. */
export function cagirKategoriKaydet(ortam: TestOrtami, ad: string, ustKategoriId?: string): string {
  return ortam.uygulama.baglam.vt.islem(() =>
    kategoriKaydet(ortam.uygulama.baglam.vt, { ad, ust_kategori_id: ustKategoriId ?? null }, ortam.uygulama.cihazId),
  );
}
