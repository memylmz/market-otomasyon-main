/**
 * Pull sırası testleri (§7.2).
 *
 * Kasada `PRAGMA foreign_keys = ON` çalışıyor ve `urunler.kategori_id`
 * `kategoriler`'e bağlı. Sunucu varlıkları PULL_VARLIKLARI sırasına göre
 * gönderdiği için bu dizinin sırası bir görsel tercih değil, DOĞRULUK
 * meselesidir: çocuk kayıt ebeveyninden önce inerse yabancı anahtar patlar,
 * tüm pull transaction'ı geri alınır ve imleç kalıcı olarak takılır.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { miktarOlustur, PULL_VARLIKLARI, simdi, uuid } from '@market/shared';
import { pullKaydiniUygula } from '../src/main/senkron/motor.js';
import { urunBul } from '../src/main/depo/katalog.js';
import { stokOku } from '../src/main/depo/stok.js';
import { testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

describe('PULL_VARLIKLARI sırası', () => {
  it('ebeveyn varlıklar çocuklarından önce gelir', () => {
    const sira = (varlik: string) => PULL_VARLIKLARI.indexOf(varlik as (typeof PULL_VARLIKLARI)[number]);

    // urunler.kategori_id → kategoriler.id
    expect(sira('kategoriler')).toBeLessThan(sira('urunler'));
    // barkodlar.urun_id → urunler.id
    expect(sira('urunler')).toBeLessThan(sira('barkodlar'));
    // stok_duzeltmeleri talimatı ürünü arar
    expect(sira('urunler')).toBeLessThan(sira('stok_duzeltmeleri'));
  });
});

describe('panelde açılan kategoriye atanan ürün (§7.2)', () => {
  it('sunucunun gönderdiği sırayla uygulanınca yabancı anahtar patlamaz', () => {
    const zaman = simdi();
    const kategoriId = uuid();
    const urunId = uuid();

    // Sunucu kayıtları varlık varlık gönderir; sırayı PULL_VARLIKLARI belirler.
    const kayitlar = [
      {
        varlik: 'urunler' as const,
        versiyon: 11,
        silindi_mi: false,
        veri: {
          id: urunId,
          ad: 'Elma',
          kategori_id: kategoriId,
          marka: null,
          birim_tipi: 'KG',
          alis_fiyati: 0,
          satis_fiyati: 10000,
          kdv_orani: 20,
          kritik_stok: 0,
          ideal_stok: 0,
          raf_konumu: null,
          aktif_mi: 1,
          varsayilan_tedarikci_id: null,
          skt_takibi: 0,
          notlar: null,
          created_at: zaman,
          updated_at: zaman,
          cihaz_id: 'panel',
        },
      },
      {
        varlik: 'kategoriler' as const,
        versiyon: 12,
        silindi_mi: false,
        veri: {
          id: kategoriId,
          ad: 'Soğuk İçecek',
          ust_kategori_id: null,
          sira: 0,
          aktif_mi: 1,
          created_at: zaman,
          updated_at: zaman,
          cihaz_id: 'panel',
        },
      },
    ];

    // Gerçek pull gibi: varlık sırasına göre grupla, sonra uygula.
    const sirali = [...kayitlar].sort(
      (a, b) =>
        PULL_VARLIKLARI.indexOf(a.varlik as (typeof PULL_VARLIKLARI)[number]) -
        PULL_VARLIKLARI.indexOf(b.varlik as (typeof PULL_VARLIKLARI)[number]),
    );

    expect(() => {
      ortam.uygulama.vt.islem(() => {
        for (const kayit of sirali) pullKaydiniUygula(ortam.uygulama.baglam, kayit);
      });
    }).not.toThrow();

    const urun = urunBul(ortam.uygulama.vt, urunId);
    expect(urun?.kategori_id).toBe(kategoriId);
  });
});

describe('panelden gelen stok talimatı (§11.5)', () => {
  /** Sunucudan inen bir stok talimatı kaydı üretir. */
  function talimat(over: Record<string, unknown> = {}) {
    return {
      varlik: 'stok_duzeltmeleri' as const,
      versiyon: 30,
      silindi_mi: false,
      veri: {
        id: uuid(),
        urun_id: '',
        tip: 'DUZELTME',
        fark: 5000,
        neden: 'Sayım farkı',
        hedef_cihaz_id: ortam.uygulama.cihazId,
        kullanici_id: null,
        created_at: simdi(),
        updated_at: simdi(),
        cihaz_id: 'panel',
        ...over,
      },
    };
  }

  it('hedef cihaz bu kasaysa fark kadar stok hareketi yazılır', () => {
    const urunId = urunEkle(ortam, { ad: 'Domates', stok: miktarOlustur(10) });
    const oncesi = stokOku(ortam.uygulama.vt, urunId);

    const kayit = talimat({ urun_id: urunId, fark: 5000 });
    ortam.uygulama.vt.islem(() => pullKaydiniUygula(ortam.uygulama.baglam, kayit));

    expect(stokOku(ortam.uygulama.vt, urunId)).toBe(oncesi + 5000);
  });

  it('aynı talimat ikinci kez inerse tekrar uygulanmaz', () => {
    const urunId = urunEkle(ortam, { ad: 'Salatalık', stok: miktarOlustur(10) });
    const kayit = talimat({ urun_id: urunId, fark: 3000 });

    ortam.uygulama.vt.islem(() => pullKaydiniUygula(ortam.uygulama.baglam, kayit));
    const birinciSonrasi = stokOku(ortam.uygulama.vt, urunId);

    ortam.uygulama.vt.islem(() => pullKaydiniUygula(ortam.uygulama.baglam, kayit));

    expect(stokOku(ortam.uygulama.vt, urunId)).toBe(birinciSonrasi);
  });

  it('başka bir kasaya yazılmış talimat bu kasada uygulanmaz', () => {
    const urunId = urunEkle(ortam, { ad: 'Biber', stok: miktarOlustur(10) });
    const oncesi = stokOku(ortam.uygulama.vt, urunId);

    const kayit = talimat({ urun_id: urunId, fark: 7000, hedef_cihaz_id: 'kasa-baska-cihaz' });
    ortam.uygulama.vt.islem(() => pullKaydiniUygula(ortam.uygulama.baglam, kayit));

    expect(stokOku(ortam.uygulama.vt, urunId)).toBe(oncesi);
  });

  it('bilinmeyen ürün için senkron patlamaz, kayıt atlanır', () => {
    const kayit = talimat({ urun_id: uuid(), fark: 1000 });
    expect(() => {
      ortam.uygulama.vt.islem(() => pullKaydiniUygula(ortam.uygulama.baglam, kayit));
    }).not.toThrow();
  });
});

describe('iptal edilmiş stok talimatı (§11.5)', () => {
  it('mezar taşı işaretli talimat uygulanmaz', () => {
    const urunId = urunEkle(ortam, { ad: 'Zeytinyağı', stok: miktarOlustur(10) });
    const oncesi = stokOku(ortam.uygulama.vt, urunId);

    // Panelde yerine yenisi yazıldığı için iptal edilmiş talimat.
    const kayit = {
      varlik: 'stok_duzeltmeleri' as const,
      versiyon: 40,
      silindi_mi: true,
      veri: {
        id: uuid(),
        urun_id: urunId,
        tip: 'DUZELTME',
        fark: 26_000,
        neden: 'Yerine yenisi yazıldı',
        hedef_cihaz_id: ortam.uygulama.cihazId,
        kullanici_id: null,
        created_at: simdi(),
        updated_at: simdi(),
        cihaz_id: 'panel',
      },
    };

    ortam.uygulama.vt.islem(() => pullKaydiniUygula(ortam.uygulama.baglam, kayit));

    expect(stokOku(ortam.uygulama.vt, urunId)).toBe(oncesi);
  });
});
