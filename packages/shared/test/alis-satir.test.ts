/**
 * Alış faturası satır mantığı (§11.8).
 *
 * Mal kabul, toptancının karşısında kırk kalem girilen bir iştir; buradaki
 * hata sessizce yanlış faturaya dönüşür ve ancak stok sayımında fark edilir.
 * Arayüz katmanında otomatik test olmadığı için karar veren her parça bu
 * dosyada kilitlenir.
 */

import { describe, expect, it } from 'vitest';
import { carpanCoz, satiriKat, sktSutunuGerekli, type AlisSatiri } from '../src/alis-satir.js';
import { alisGosterimi, alisMatrahi, ayniKarOraniylaRafFiyati, satirTutari, tutardanBirimFiyat } from '../src/alis-satir.js';
import { barkodUyarisi } from '../src/id.js';

const satir = (ek: Partial<AlisSatiri> = {}): AlisSatiri => ({
  barkod: '8690000000012',
  ad: 'Kola 1L',
  miktar: '1',
  alis: 1500,
  satis: 2500,
  kdv: '20',
  skt: '',
  lot: '',
  sktZorunlu: false,
  ...ek,
});

describe('çarpan çözümü', () => {
  it('12*barkod okutmasını 12 adede çevirir', () => {
    expect(carpanCoz('12*8690000000012')).toEqual({ carpan: 12, barkod: '8690000000012' });
  });

  it('x harfini de ayraç kabul eder', () => {
    expect(carpanCoz('6x8690000000012').carpan).toBe(6);
  });

  it('çarpansız barkodu olduğu gibi bırakır', () => {
    expect(carpanCoz('8690000000012')).toEqual({ carpan: 1, barkod: '8690000000012' });
  });

  it('sıfır ya da geçersiz çarpanda satır kaybolmaz, 1 adet girer', () => {
    expect(carpanCoz('0*8690').carpan).toBe(1);
  });

  it('boşlukları yok sayar', () => {
    expect(carpanCoz(' 3 * 8690 ')).toEqual({ carpan: 3, barkod: '8690' });
  });
});

describe('satır katma', () => {
  /**
   * ASIL HATA BUYDU: her okutma yeni satır ekliyordu. Bir koliden on iki kez
   * okutan kullanıcı faturada aynı ürünü on iki kez görüyordu.
   */
  it('aynı ürün tekrar okutulunca miktarı artırır, satır açmaz', () => {
    const mevcut = [satir({ urun_id: 'u1', miktar: '2' })];
    const sonuc = satiriKat(mevcut, satir({ urun_id: 'u1' }), 3);
    expect(sonuc.satirlar).toHaveLength(1);
    expect(sonuc.satirlar[0]!.miktar).toBe('5');
    expect(sonuc.birlesti).toBe(true);
    expect(sonuc.vurgulanan).toBe(0);
  });

  it('ondalıklı miktarı korur (kilogramlı ürün)', () => {
    const mevcut = [satir({ urun_id: 'u1', miktar: '1,25' })];
    expect(satiriKat(mevcut, satir({ urun_id: 'u1' }), 2).satirlar[0]!.miktar).toBe('3,25');
  });

  it('farklı ürünü yeni satır olarak EN ÜSTE ekler', () => {
    const mevcut = [satir({ urun_id: 'u1', ad: 'Eski' })];
    const sonuc = satiriKat(mevcut, satir({ urun_id: 'u2', ad: 'Yeni' }), 1);
    expect(sonuc.satirlar[0]!.ad, 'okutulan satır görünür olmalı').toBe('Yeni');
    expect(sonuc.satirlar).toHaveLength(2);
    expect(sonuc.birlesti).toBe(false);
  });

  it('yeni ürünleri barkodla birleştirir', () => {
    const mevcut = [satir({ barkod: '111', urun_id: undefined, miktar: '1' })];
    const sonuc = satiriKat(mevcut, satir({ barkod: '111', urun_id: undefined }), 1);
    expect(sonuc.satirlar).toHaveLength(1);
    expect(sonuc.satirlar[0]!.miktar).toBe('2');
  });

  it('barkodsuz yeni satırları ASLA birleştirmez', () => {
    // İkisi de "henüz adı yazılmamış ürün"dür; farklı şeyler olabilir.
    const mevcut = [satir({ barkod: '', urun_id: undefined })];
    const sonuc = satiriKat(mevcut, satir({ barkod: '', urun_id: undefined }), 1);
    expect(sonuc.satirlar).toHaveLength(2);
  });

  it('mevcut ürünle yeni ürünü karıştırmaz', () => {
    const mevcut = [satir({ urun_id: 'u1', barkod: '111' })];
    const sonuc = satiriKat(mevcut, satir({ urun_id: undefined, barkod: '111' }), 1);
    expect(sonuc.satirlar, 'biri kartlı biri kartsız — aynı satır değil').toHaveLength(2);
  });

  it('çarpanla okutulan ilk satır o miktarla girer', () => {
    expect(satiriKat([], satir(), 12).satirlar[0]!.miktar).toBe('12');
  });
});

describe('SKT sütunu', () => {
  it('SKT takipli ürün varsa gösterilir', () => {
    expect(sktSutunuGerekli([satir({ sktZorunlu: true })])).toBe(true);
  });

  it('kullanıcı elle tarih ya da lot girdiyse gösterilir', () => {
    expect(sktSutunuGerekli([satir({ skt: '2027-01-01' })])).toBe(true);
    expect(sktSutunuGerekli([satir({ lot: 'L-42' })])).toBe(true);
  });

  it('hiçbiri yoksa gizlenir — ürün adına ve fiyatlara yer açar', () => {
    expect(sktSutunuGerekli([satir(), satir()])).toBe(false);
  });
});

describe('KDV dahil fatura ve raf fiyatı önerisi', () => {
  it('KDV dahil yazılan alış KDV hariçe çevrilir; hariç yazılan olduğu gibi kalır', () => {
    expect(alisMatrahi(15_000, 20, true)).toBe(12_500);
    expect(alisMatrahi(12_500, 20, false)).toBe(12_500);
    expect(alisGosterimi(12_500, 20, true)).toBe(15_000);
    expect(alisGosterimi(12_500, 20, false)).toBe(12_500);
  });

  it('alış değişince aynı kâr oranıyla raf fiyatı önerilir', () => {
    // 125 → 200 (KDV %20); alış 150 olunca 240.
    expect(ayniKarOraniylaRafFiyati(12_500, 20_000, 15_000, 20)).toBe(24_000);
    expect(ayniKarOraniylaRafFiyati(0, 20_000, 15_000, 20)).toBeNull();
    expect(ayniKarOraniylaRafFiyati(12_500, 0, 15_000, 20)).toBeNull();
  });
});

describe('barkodUyarisi', () => {
  it('doğru EAN-13/EAN-8, 12 haneli UPC, 14 haneli GTIN ve kısa kodlar uyarı vermez', () => {
    expect(barkodUyarisi('8691234567906')).toBeNull();
    expect(barkodUyarisi('96385074')).toBeNull();
    expect(barkodUyarisi('123456')).toBeNull();
    expect(barkodUyarisi('24')).toBeNull();
    expect(barkodUyarisi('18691234567903')).toBeNull();
    expect(barkodUyarisi('ABC-12')).toBeNull();
  });

  it('kontrol hanesi tutmayan ya da fiyat karışmış barkodu yakalar', () => {
    expect(barkodUyarisi('8691234567905')).toMatch(/kontrol hanesi/);
    expect(barkodUyarisi('110152388694740')).toMatch(/15 haneli/);
    expect(barkodUyarisi('123456789')).toMatch(/9 haneli/);
  });
});

describe('satır tutarı ↔ birim fiyat', () => {
  it('satır tutarı miktar × birim fiyattır', () => {
    expect(satirTutari('6', 5545)).toBe(33270);
    expect(satirTutari('2,5', 1000)).toBe(2500);
    expect(satirTutari('', 1000)).toBe(0);
  });

  it('çuval örneği: 1.000 TL / 25 paket = 40 TL', () => {
    expect(tutardanBirimFiyat('25', 100000)).toBe(4000);
  });

  it('iskontolu satır: 332,70 / 6 = 55,45 ve geri 332,70', () => {
    const birim = tutardanBirimFiyat('6', 33270)!;
    expect(birim).toBe(5545);
    expect(satirTutari('6', birim)).toBe(33270);
  });

  it('bölünmeyen tutar kuruşa yuvarlanır, fark en fazla miktar × yarım kuruş', () => {
    expect(tutardanBirimFiyat('3', 100000)).toBe(33333);
    expect(satirTutari('3', 33333)).toBe(99999);
  });

  it('miktar yoksa birim fiyat hesaplanmaz', () => {
    expect(tutardanBirimFiyat('', 5000)).toBeNull();
    expect(tutardanBirimFiyat('0', 5000)).toBeNull();
  });
});
