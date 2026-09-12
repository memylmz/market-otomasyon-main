/**
 * Fiş İÇERİĞİ — karakterizasyon testi.
 *
 * NEDEN VAR: fişin nasıl göründüğünü kilitleyen hiçbir test yoktu; yalnız
 * önizleme ÇÖZÜCÜSÜ test ediliyordu. Fiş üretimi yeniden yapılandırılırken
 * (yapılandırılmış belge modeline geçiş) hangi satırın kaybolduğunu ancak
 * kağıda basınca görürdük.
 *
 * Bu dosya bugünkü çıktıyı olduğu gibi kaydeder: refactor sonrası metin fişi
 * SATIR SATIR aynı kalmalı. Görünüm değişikliği GÖRÜNTÜ fişinde yapılacak;
 * metin yolu geri düşüş olarak dokunulmadan durmalı.
 */

import { describe, expect, it } from 'vitest';
import { EscPosYazici } from '../src/main/donanim/escpos.js';
import { satisFisi, YASAL_UYARI } from '../src/main/donanim/fis.js';

const isletme = {
  ad: 'ŞAHİN GIDA',
  adres: 'Çiğli Şubesi',
  telefon: '0232 000 00 00',
  vergiNo: '1234567890',
  altMetin: 'Bizi tercih ettiğiniz için teşekkürler',
};

const detay = {
  satis: {
    id: 's1',
    fis_no: 'A-000042',
    tarih: '2026-09-12T19:05:00.000Z',
    ara_toplam: 51_115,
    iskonto_toplam: 0,
    kdv_toplam: 8_519,
    genel_toplam: 51_115,
    musteri_adi: null,
    iade_mi: false,
    kullanici_adi: 'Mehmet Y.',
  },
  kalemler: [
    {
      urun_adi: 'Çiğ Köfte',
      miktar: 2000,
      birim_tipi: 'ADET',
      birim_fiyat: 7_250,
      satir_toplam: 14_500,
      kdv_orani: 20,
      kdv_tutar: 2_417,
      iskonto: 0,
    },
    {
      urun_adi: 'Kırmızı Mercimek',
      miktar: 1250,
      birim_tipi: 'KG',
      birim_fiyat: 5_120,
      satir_toplam: 6_400,
      kdv_orani: 20,
      kdv_tutar: 1_067,
      iskonto: 0,
    },
  ],
  odemeler: [{ odeme_tipi: 'NAKIT', tutar: 51_115, alinan: 60_000, para_ustu: 8_885 }],
} as never;

/** Fişin okunabilir satırları — bayt akışı çözülerek elde edilir. */
function satirlar(): string[] {
  return EscPosYazici.onizlemeYapisi(satisFisi(detay, isletme, { satirGenisligi: 48, kasiyerAdi: 'Mehmet Y.' }))
    .ogeler.filter((o) => o.tip === 'metin')
    .map((o) => o.metin.trimEnd());
}

describe('satış fişi içeriği', () => {
  it('işletme başlığını ve iletişim bilgilerini yazar', () => {
    const s = satirlar();
    expect(s).toContain('ŞAHİN GIDA');
    expect(s).toContain('Çiğli Şubesi');
    expect(s).toContain('Tel: 0232 000 00 00');
    expect(s).toContain('VN: 1234567890');
  });

  it('fiş numarasını, kasiyeri ve kalemleri yazar', () => {
    const s = satirlar().join('\n');
    expect(s).toContain('A-000042');
    expect(s).toContain('Kasiyer: Mehmet Y.');
    expect(s, 'ürün adı kendi satırında').toContain('Çiğ Köfte');
    expect(s, 'kilogramlı ürün miktarı ve birim fiyatıyla').toContain('1,25 kg x 51,20');
    expect(s, 'adetli ürün de aynı biçimde').toContain('2 ad x 72,50');
  });

  it('toplam, KDV kırılımı ve ödemeyi yazar', () => {
    const s = satirlar().join('\n');
    expect(s).toMatch(/TOPLAM\s+511,15/);
    expect(s, 'KDV oranı ve matrahı ayrı ayrı').toMatch(/KDV %20 \(matrah/);
    expect(s).toMatch(/Nakit\s+511,15/);
    expect(s).toMatch(/Para Üstü\s+88,85/);
  });

  it('alt metni ve yasal uyarıyı yazar', () => {
    const s = satirlar();
    expect(s).toContain('Bizi tercih ettiğiniz için teşekkürler');
    expect(s, 'yasal uyarı kaldırılamaz').toContain(YASAL_UYARI);
    expect(s).toContain('Yasal fiş yazarkasadan alınmalıdır.');
  });

  it('iade fişinde İADE başlığı görünür', () => {
    const iade = { ...detay, satis: { ...(detay as never as { satis: object }).satis, iade_mi: true } } as never;
    const s = EscPosYazici.onizlemeYapisi(satisFisi(iade, isletme, { satirGenisligi: 48 }))
      .ogeler.filter((o) => o.tip === 'metin')
      .map((o) => o.metin.trim());
    expect(s).toContain('İADE FİŞİ');
  });

  it('kopya fişinde KOPYA damgası görünür', () => {
    const s = EscPosYazici.onizlemeYapisi(satisFisi(detay, isletme, { satirGenisligi: 48, kopyaMi: true }))
      .ogeler.filter((o) => o.tip === 'metin')
      .map((o) => o.metin.trim());
    expect(s).toContain('*** KOPYA ***');
  });
});
