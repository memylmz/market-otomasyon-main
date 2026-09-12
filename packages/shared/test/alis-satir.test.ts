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
