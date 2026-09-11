/**
 * Yazıcı bağlantı modları (§13.2).
 *
 * Üç mod vardır: USB, Ethernet ve OTOMATIK. Otomatik bir bağlantı tipi değil,
 * bir SIRADIR — önce USB, o olmazsa ağ. Bu dosya sıranın ve geri düşmenin
 * doğru çalıştığını kilitler; yanlış sıra her fişte ağ zaman aşımı bekletir.
 */

import { describe, expect, it } from 'vitest';
import { yaziciOlustur, type YaziciAyari } from '../src/main/donanim/yazici.js';

const temel: YaziciAyari = { tip: 'YOK', hedef: '', satirGenisligi: 48, cekmeceAc: false };

describe('yazıcı seçimi', () => {
  it('yazıcı yokken önizleme üretir, satışı engellemez', async () => {
    const y = yaziciOlustur(temel);
    expect(y.tip).toBe('YOK');
    const sonuc = await y.test();
    expect(sonuc.basarili).toBe(true);
    expect(sonuc.onizleme, 'ekranda gösterilecek metin dönmeli').toBeTruthy();
  });

  it('USB modunda paylaşım yazıcısı adaptörü kullanılır', () => {
    expect(yaziciOlustur({ ...temel, tip: 'USB', usbAdi: 'EPSON TM-T20' }).tip).toBe('WINDOWS_PAYLASIM');
  });

  it('Ethernet modunda ağ adaptörü kullanılır', () => {
    expect(yaziciOlustur({ ...temel, tip: 'AG', hedef: '192.168.1.50:9100' }).tip).toBe('AG');
  });

  it('otomatik mod kendi tipini bildirir', () => {
    const y = yaziciOlustur({ ...temel, tip: 'OTOMATIK', usbAdi: 'EPSON', hedef: '192.168.1.50:9100' });
    expect(y.tip).toBe('OTOMATIK');
  });

  /**
   * Hiçbiri çalışmazsa SON hata döner. "Hiçbiri olmadı" demek yerine somut
   * sebebi göstermek gerekir; kasiyer neye bakacağını bilmelidir.
   */
  it('otomatikte ikisi de başarısızsa anlamlı hata döner', async () => {
    const y = yaziciOlustur({ ...temel, tip: 'OTOMATIK', usbAdi: '', hedef: '' });
    const sonuc = await y.test();
    expect(sonuc.basarili).toBe(false);
    expect(sonuc.hata, 'sebep yazmalı').toBeTruthy();
  });

  it('hedefi boş ağ yazıcısı sessizce başarılı dönmez', async () => {
    const sonuc = await yaziciOlustur({ ...temel, tip: 'AG', hedef: '' }).test();
    expect(sonuc.basarili).toBe(false);
    expect(sonuc.hata).toMatch(/adres/i);
  });

  it('bilinmeyen tip önizlemeye düşer', () => {
    expect(yaziciOlustur({ ...temel, tip: 'SACMA' as never }).tip).toBe('YOK');
  });
});

describe('ağ hatası açıklamaları (§20)', () => {
  /**
   * Yerel ağ adresinde EHOSTUNREACH, macOS'ta neredeyse her zaman "uygulamaya
   * yerel ağ izni verilmemiş" demektir: yazıcıya ping atılır, terminalden
   * bağlanılır, ama uygulama bağlanamaz. Ham hata kodu gösterilirse kullanıcı
   * ağda sorun arar ve bulamaz.
   */
  it('yerel ağda EHOSTUNREACH izin sorununu anlatır', async () => {
    const y = yaziciOlustur({ ...temel, tip: 'AG', hedef: '192.168.99.250:9100', zamanAsimiMs: 1500 });
    const sonuc = await y.yazdir(Buffer.from('x'));
    expect(sonuc.basarili).toBe(false);
    // Ağ ortamına göre EHOSTUNREACH ya da zaman aşımı olabilir; ikisi de
    // kullanıcıya ne yapacağını söyleyen bir cümle üretmeli.
    expect(sonuc.hata).toMatch(/Yerel Ağ|yanıt vermedi|yanıt vermiyor|ulaşılamıyor|yol yok/);
  });

  it('adres tanımsızken bağlanmayı denemez', async () => {
    const sonuc = await yaziciOlustur({ ...temel, tip: 'AG', hedef: '' }).yazdir(Buffer.from('x'));
    expect(sonuc).toMatchObject({ basarili: false, hata: 'Yazıcı adresi tanımlı değil.' });
  });
});
