/**
 * Ağırlıklı ortalama maliyet, FEFO ile SKT kalanı ve "etiket basılacaklar".
 *
 * Kullanıcı örneği: 10 ürün 100'den alındı, 5'i satıldı, 10 tane daha 110'dan
 * geldi. Raftaki 15 ürünün maliyeti 110 değil (5×100 + 10×110)/15 = 106,67'dir.
 */

import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AYAR, adet, bugun, gunEkle } from '@market/shared';
import { ayarYaz } from '../src/main/depo/ayar.js';
import { etiketBekleyenler, etiketBekleyenleriSil } from '../src/main/depo/katalog.js';
import { kalemleriGetir } from '../src/main/depo/satis.js';
import { maliyetleriOku, ortalamaMaliyetHesapla, sktYaklasanlar, stokDegeri } from '../src/main/depo/stok.js';
import { urunuKaydet } from '../src/main/servis/katalog-servis.js';
import { satisKesinlestir } from '../src/main/servis/satis-servis.js';
import { alisFaturasiIptal, fireCikisi, malKabulOnayla } from '../src/main/servis/stok-servis.js';
import { etiketKuyruguYazdir } from '../src/main/servis/yazdirma-servis.js';
import { tedarikciEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

const vt = () => ortam.uygulama.baglam.vt;

function sat(urunId: string, miktar: number, fiyat: number) {
  return satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
    kalemler: [{ urun_id: urunId, miktar, birim_fiyat: fiyat }],
    odemeler: [{ tip: 'NAKIT', tutar: (miktar / 1000) * fiyat, alinan: (miktar / 1000) * fiyat }],
  });
}

function malAl(urunId: string, miktar: number, birimFiyat: number, ek: Record<string, unknown> = {}) {
  return malKabulOnayla(ortam.uygulama.baglam, ortam.admin, {
    tedarikci_id: tedarikciEkle(ortam),
    kalemler: [{ urun_id: urunId, miktar, birim_fiyat: birimFiyat, kdv_orani: 20, ...ek }],
  });
}

describe('ağırlıklı ortalama maliyet', () => {
  it('100’den kalan 5 + 110’dan gelen 10 → maliyet 106,67; satış bu maliyetle yazılır', () => {
    const urunId = urunEkle(ortam, { stok: adet(10), alisFiyati: 10_000, satisFiyati: 20_000 });
    sat(urunId, adet(5), 20_000);

    malAl(urunId, adet(10), 11_000);

    expect(ortalamaMaliyetHesapla(vt(), urunId)).toBe(10_667);
    expect(maliyetleriOku(vt(), [urunId]).get(urunId)).toBe(10_667);
    // Son alış ayrı durur: fiyat belirlemek için o kullanılır.
    expect(vt().hazirla('SELECT alis_fiyati FROM urunler WHERE id = ?').tek<{ alis_fiyati: number }>(urunId)?.alis_fiyati).toBe(
      11_000,
    );

    const satis = sat(urunId, adet(1), 20_000);
    expect(kalemleriGetir(vt(), satis.satisId)[0]?.birim_maliyet).toBe(10_667);

    // Stok değeri de aynı temelden: 14 × 106,67
    expect(stokDegeri(vt()).maliyet).toBe(14 * 10_667);
  });

  it('stok eksiye düşmüşse eksik mal ortalamayı çekmez: yeni alış fiyatı geçerli olur', () => {
    const urunId = urunEkle(ortam, { stok: adet(2), alisFiyati: 10_000 });
    sat(urunId, adet(5), 15_000); // stok −3
    malAl(urunId, adet(10), 12_000);
    expect(ortalamaMaliyetHesapla(vt(), urunId)).toBe(12_000);
  });

  it('iptal edilen alış faturası hiç girmemiş sayılır', () => {
    const urunId = urunEkle(ortam, { stok: adet(10), alisFiyati: 10_000 });
    sat(urunId, adet(5), 20_000);
    const { faturaId } = malAl(urunId, adet(10), 11_000);
    sat(urunId, adet(4), 20_000);
    expect(maliyetleriOku(vt(), [urunId]).get(urunId)).toBe(10_667);

    alisFaturasiIptal(ortam.uygulama.baglam, ortam.admin, faturaId, 'yanlış fatura');
    // Ters formül 73,33 gibi saçma bir sonuç verirdi; doğrusu ilk maliyet.
    expect(maliyetleriOku(vt(), [urunId]).get(urunId)).toBe(10_000);
  });

  it('maliyetli girişi olmayan ürün haritada yoktur (son alışa düşülür)', () => {
    const urunId = urunEkle(ortam, { stok: 0, alisFiyati: 700 });
    expect(maliyetleriOku(vt(), [urunId]).has(urunId)).toBe(false);
    const satis = sat(urunId, adet(1), 1200);
    expect(kalemleriGetir(vt(), satis.satisId)[0]?.birim_maliyet).toBe(700);
  });
});

describe('SKT kalanı — FEFO', () => {
  it('satış önce tarihi yakın partiden düşer; biten parti listeden çıkar', () => {
    const urunId = urunEkle(ortam, { stok: 0, alisFiyati: 1000 });
    const yakin = gunEkle(bugun(), 5);
    const uzak = gunEkle(bugun(), 20);
    malAl(urunId, adet(10), 1000, { skt: yakin, lot_no: 'A' });
    malAl(urunId, adet(10), 1000, { skt: uzak, lot_no: 'B' });

    expect(sktYaklasanlar(vt(), 30).map((s) => [s.lot_no, s.kalan_miktar])).toEqual([
      ['A', adet(10)],
      ['B', adet(10)],
    ]);

    sat(urunId, adet(12), 1500);
    // Eldeki 8'in hepsi B'de; A bitti.
    expect(sktYaklasanlar(vt(), 30).map((s) => [s.lot_no, s.kalan_miktar])).toEqual([['B', adet(8)]]);
    // Yalnız 10 gün içindekilere bakılırsa liste boş: yakın parti satıldı.
    expect(sktYaklasanlar(vt(), 10)).toEqual([]);
  });

  it('kısmen satılan yakın parti kalan miktarıyla görünür', () => {
    const urunId = urunEkle(ortam, { stok: 0, alisFiyati: 1000 });
    malAl(urunId, adet(10), 1000, { skt: gunEkle(bugun(), 3), lot_no: 'A' });
    malAl(urunId, adet(10), 1000, { skt: gunEkle(bugun(), 40), lot_no: 'B' });
    sat(urunId, adet(4), 1500);
    fireCikisi(ortam.uygulama.baglam, ortam.admin, { urun_id: urunId, miktar: adet(1), neden_kodu: 'KIRIK_HASARLI' });

    const liste = sktYaklasanlar(vt(), 7);
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({ lot_no: 'A', kalan_miktar: adet(5), kalan_gun: 3 });
  });
});

describe('etiket basılacaklar', () => {
  const liste = () => etiketBekleyenler(vt()).map((e) => ({ ad: e.ad, eski: e.eski_fiyat, yeni: e.yeni_fiyat }));

  it('yeni ürün listeye düşer; fiyat değişince ilk fiyat korunur, eski fiyata dönünce düşer', () => {
    const urunId = urunEkle(ortam, { ad: 'Çay', satisFiyati: 2000 });
    expect(liste()).toEqual([{ ad: 'Çay', eski: null, yeni: 2000 }]);
    etiketBekleyenleriSil(vt(), [urunId]);
    expect(liste()).toEqual([]);

    const guncelle = (fiyat: number) =>
      urunuKaydet(ortam.uygulama.baglam, ortam.admin, { id: urunId, ad: 'Çay', satis_fiyati: fiyat, alis_fiyati: 700 });
    guncelle(2200);
    guncelle(2300);
    expect(liste()).toEqual([{ ad: 'Çay', eski: 2000, yeni: 2300 }]);
    guncelle(2000);
    expect(liste()).toEqual([]);

    // Adı değişmek fiyat değişimi değildir.
    urunuKaydet(ortam.uygulama.baglam, ortam.admin, { id: urunId, ad: 'Çay 1 kg', satis_fiyati: 2000, alis_fiyati: 700 });
    expect(liste()).toEqual([]);
  });

  it('mal kabulde raf fiyatı değişen ürün listeye düşer', () => {
    const urunId = urunEkle(ortam, { ad: 'Süt', satisFiyati: 3000, alisFiyati: 2000 });
    etiketBekleyenleriSil(vt(), [urunId]);
    malAl(urunId, adet(10), 2200, { yeni_satis_fiyati: 3300 });
    expect(liste()).toEqual([{ ad: 'Süt', eski: 3000, yeni: 3300 }]);
  });

  it('etiketi basılan ürün listeden düşer, basılamazsa kalır', async () => {
    const a = urunEkle(ortam, { ad: 'A', satisFiyati: 1000 });
    urunEkle(ortam, { ad: 'B', satisFiyati: 1000 });
    ayarYaz(vt(), AYAR.ETIKET_YAZICI_TIPI, 'DOSYA');
    ayarYaz(vt(), AYAR.ETIKET_YAZICI_HEDEF, join(ortam.kok, 'etiket.bin'));

    const sonuc = await etiketKuyruguYazdir(ortam.uygulama.baglam, [{ urunId: a, adet: 2 }]);
    expect(sonuc.basarili).toBe(true);
    expect(liste().map((x) => x.ad)).toEqual(['B']);

    // Hedef bir KLASÖR: dosya olarak açılamaz, yazdırma başarısız olur; liste değişmez.
    ayarYaz(vt(), AYAR.ETIKET_YAZICI_HEDEF, ortam.kok);
    const bId = etiketBekleyenler(vt())[0]!.urun_id;
    const basarisiz = await etiketKuyruguYazdir(ortam.uygulama.baglam, [{ urunId: bId, adet: 1 }]);
    expect(basarisiz.basarili).toBe(false);
    expect(liste().map((x) => x.ad)).toEqual(['B']);
  });
});
