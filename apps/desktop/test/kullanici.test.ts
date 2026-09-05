/**
 * Kullanıcı silme testleri (§12.1).
 *
 * Personel yalnız yönetim panelinden tanımlanır; kasa panelden inen silme
 * talimatını uygular. Kural: hiç kaydı olmayan kullanıcı gerçekten silinir,
 * kaydı olan pasife alınır. Kaydı olanı silmek geçmiş satışın "kim sattı"
 * bilgisini koparırdı; üstelik 7 tablo `kullanicilar`'a yabancı anahtarla bağlı.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet } from '@market/shared';
import { kullaniciBul, kullaniciKaydet } from '../src/main/depo/kullanici.js';
import { kullaniciyiSenkrondanSil } from '../src/main/servis/kullanici-servis.js';
import { satisKesinlestir } from '../src/main/servis/satis-servis.js';
import { testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

/** Hiçbir işlem yapmamış taze bir kullanıcı üretir. */
function bosKullaniciEkle(ad = 'Yanlış Açılmış', kullaniciAdi = 'yanlis'): string {
  return ortam.uygulama.baglam.vt.islem(() =>
    kullaniciKaydet(ortam.uygulama.baglam.vt, { ad, kullanici_adi: kullaniciAdi, rol: 'KASIYER' }, ortam.uygulama.cihazId),
  );
}

describe('buluttan gelen silme (§7.2 pull)', () => {
  it('mezar taşı: kaydı olmayan kullanıcı yerelde de silinir', () => {
    const id = bosKullaniciEkle('Merkezde Silindi', 'merkez');

    const sonuc = kullaniciyiSenkrondanSil(ortam.uygulama.baglam, id);

    expect(sonuc?.silindi).toBe(true);
    expect(kullaniciBul(ortam.uygulama.vt, id)).toBeNull();
  });

  it('karar yerelde verilir: bu kasada satışı olan kullanıcı silinmez, pasife alınır', () => {
    // Merkez "silinebilir" demiş olabilir; bu kasadaki geçmiş yine de korunur.
    const urunId = urunEkle(ortam, { ad: 'Su', satisFiyati: 1000, stok: adet(5) });
    satisKesinlestir(ortam.uygulama.baglam, ortam.kasiyer, {
      kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 1000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 1000, alinan: 1000 }],
    });

    const sonuc = kullaniciyiSenkrondanSil(ortam.uygulama.baglam, ortam.kasiyer.kullaniciId);

    expect(sonuc?.silindi).toBe(false);
    expect(kullaniciBul(ortam.uygulama.vt, ortam.kasiyer.kullaniciId)?.aktif_mi).toBe(false);
  });

  it('yerelde hiç olmayan kullanıcı için sessizce geçilir', () => {
    expect(kullaniciyiSenkrondanSil(ortam.uygulama.baglam, 'olmayan-id')).toBeNull();
  });
});
