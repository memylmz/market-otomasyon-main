/**
 * Görünür uyarılar: alınmamış gün sonu (Z), tarihi geçen/yaklaşan ürün ve
 * zararına kampanya. Hiçbiri işlemi engellemez; yalnız haber verir.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet, AYAR, gunEkle, bugun, PAVO_AYAR } from '@market/shared';
import { ayarMetin, ayarYaz } from '../src/main/depo/ayar.js';
import { sktUyarilari } from '../src/main/depo/stok.js';
import { kanallariOlustur } from '../src/main/ipc/kanallar.js';
import { kampanyaZararKontrol } from '../src/main/servis/katalog-servis.js';
import { pavoBeklemeCarpani, pavoTasiyiciDegistir, pavoZDurumu } from '../src/main/servis/pavo-servis.js';
import { malKabulOnayla } from '../src/main/servis/stok-servis.js';
import { SahteCihaz } from './pavo-sahte-cihaz.js';
import { tedarikciEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
  ortam.uygulama.aktoruAyarla(ortam.admin);
});

afterEach(async () => {
  pavoTasiyiciDegistir(undefined);
  pavoBeklemeCarpani(1);
  await ortam.temizle();
});

/** Cihazın yerel saat biçimi ("YYYY-AA-GGTSS:dd:ss"). */
function yerel(t: Date): string {
  const iki = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${iki(t.getMonth() + 1)}-${iki(t.getDate())}T${iki(t.getHours())}:${iki(t.getMinutes())}:${iki(t.getSeconds())}`;
}

describe('gün sonu (Z) hatırlatması', () => {
  let cihaz: SahteCihaz;
  let kanallar: ReturnType<typeof kanallariOlustur>;

  beforeEach(() => {
    ayarYaz(ortam.uygulama.vt, AYAR.POS_TURU, 'PAVO');
    cihaz = new SahteCihaz();
    // Arşivde yalnız eski bir Z var: bugünkü satışlar Z'siz.
    cihaz.arsivRaporlari = [{ BatchId: 1, BatchType: 'T', ZReportNo: '6', CreateDate: '2020-01-01T23:00:00' }];
    pavoTasiyiciDegistir(cihaz);
    pavoBeklemeCarpani(0);
    kanallar = kanallariOlustur(ortam.uygulama);
  });

  const sat = async () => {
    const u = urunEkle(ortam, { satisFiyati: 1000 });
    await kanallar['satis.kesinlestir']({
      kalemler: [{ urun_id: u, miktar: adet(1), birim_fiyat: 1000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 1000 }],
      fis_yazdir: false,
    });
  };

  it('Pavo satışı yoksa uyarı yok', async () => {
    expect(await pavoZDurumu(ortam.uygulama.baglam)).toMatchObject({ pavo: true, bugunEksik: false, oncekiEksikGunler: [] });
  });

  it('bugün Pavo satışı var, Z alınmadı → bugün eksik', async () => {
    await sat();
    expect(await pavoZDurumu(ortam.uygulama.baglam)).toMatchObject({ bugunEksik: true, oncekiEksikGunler: [] });
  });

  it('programdan Z alınınca uyarı kalkar ve zamanı saklanır', async () => {
    await sat();
    await kanallar['pavo.gunSonu']({});
    expect(ayarMetin(ortam.uygulama.vt, PAVO_AYAR.SON_Z, '')).not.toBe('');
    expect(await pavoZDurumu(ortam.uygulama.baglam)).toMatchObject({ bugunEksik: false, oncekiEksikGunler: [] });
  });

  it('Z cihazın kendi tuşlarıyla alındıysa arşivden anlaşılır', async () => {
    await sat();
    cihaz.arsivRaporlari = [{ BatchId: 2, BatchType: 'T', ZReportNo: '7', CreateDate: yerel(new Date(Date.now() + 60_000)) }];
    expect(await pavoZDurumu(ortam.uygulama.baglam)).toMatchObject({ bugunEksik: false });
    expect(ayarMetin(ortam.uygulama.vt, PAVO_AYAR.SON_Z, '')).not.toBe('');
  });

  it("dünkü satışın Z'si alınmadıysa önceki gün olarak bildirilir", async () => {
    await sat();
    const dun = new Date(Date.now() - 86_400_000).toISOString();
    ortam.uygulama.vt.hazirla('UPDATE satislar SET tarih = ?').calistir(dun);
    const d = await pavoZDurumu(ortam.uygulama.baglam);
    expect(d.bugunEksik).toBe(false);
    expect(d.oncekiEksikGunler).toEqual([gunEkle(bugun(), -1)]);
  });

  it('Pavo kapalıyken uyarı yok', async () => {
    await sat();
    ayarYaz(ortam.uygulama.vt, AYAR.POS_TURU, 'KAPALI');
    expect((await pavoZDurumu(ortam.uygulama.baglam)).pavo).toBe(false);
  });

  it('Ayarlar ekranı son Z zamanını ezemez (korunan ayar)', async () => {
    await sat();
    await kanallar['pavo.gunSonu']({});
    const once = ayarMetin(ortam.uygulama.vt, PAVO_AYAR.SON_Z, '');
    await kanallar['ayar.yaz']({ degerler: { [PAVO_AYAR.SON_Z]: '' } });
    expect(ayarMetin(ortam.uygulama.vt, PAVO_AYAR.SON_Z, '')).toBe(once);
  });
});

describe('SKT uyarıları', () => {
  it('ürün başına en yakın kalan partiyi verir; geçmiş olan eksi gün taşır', () => {
    const { baglam, vt } = ortam.uygulama;
    const sut = urunEkle(ortam, { ad: 'Süt', stok: adet(0) });
    const peynir = urunEkle(ortam, { ad: 'Peynir', stok: adet(0) });
    const tedarikci = tedarikciEkle(ortam);
    malKabulOnayla(baglam, ortam.admin, {
      tedarikci_id: tedarikci,
      kalemler: [
        { urun_id: sut, miktar: adet(5), birim_fiyat: 500, kdv_orani: 1, skt: gunEkle(bugun(), -2) },
        { urun_id: sut, miktar: adet(5), birim_fiyat: 500, kdv_orani: 1, skt: gunEkle(bugun(), 20) },
        { urun_id: peynir, miktar: adet(3), birim_fiyat: 900, kdv_orani: 1, skt: gunEkle(bugun(), 2) },
      ],
    });
    const uyarilar = sktUyarilari(vt, 7);
    expect(uyarilar.map((u) => [u.ad, u.kalan_gun])).toEqual([
      ['Süt', -2],
      ['Peynir', 2],
    ]);
  });
});

describe('kampanya zarar kontrolü', () => {
  it('ekrana yüklenen listeyle sınırlı değil: tüm katalogdaki zarardaki ürünleri sayar', () => {
    // 600 ürün: alış 8 ₺ (KDV hariç), satış 10 ₺ KDV %0 → %25 indirimle 7,50 ₺, hepsi zararda.
    for (let i = 0; i < 600; i++) urunEkle(ortam, { ad: `Ürün ${i}`, satisFiyati: 1000, alisFiyati: 800, kdvOrani: 0, stok: 0 });
    const z = kampanyaZararKontrol(ortam.uygulama.baglam, ortam.admin, { tip: 'YUZDE', deger: 25, kapsam: 'TUM' });
    expect(z.adet).toBe(600);
    expect(z.ornekler).toHaveLength(5);
    expect(z.ornekler[0]?.zarar).toBe(50);
    // %10 indirim: 9,00 ₺ > 8,00 ₺ → zarar yok.
    expect(kampanyaZararKontrol(ortam.uygulama.baglam, ortam.admin, { tip: 'YUZDE', deger: 10, kapsam: 'TUM' }).adet).toBe(0);
  });
});
