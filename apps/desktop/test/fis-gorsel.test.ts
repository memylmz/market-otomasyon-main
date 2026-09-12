/**
 * Fişin görüntü olarak basılması (§13.2).
 *
 * NEDEN VAR: Türkçe harfler artık yazıcının kod sayfasına değil, bizim
 * çizdiğimiz piksellere bağlı. Bu dosya çizim boru hattının saf uçlarını
 * kilitler: HTML üretimi, 1-bit'e indirme, ESC/POS raster komutu ve çizim
 * başarısız olduğunda metin fişine geri düşme.
 */

import { describe, expect, it } from 'vitest';
import {
  fisHtml,
  fisiGorselleStir,
  kagitNoktaGenisligi,
  kuyrukKomutlari,
  rasterKomutu,
  siyahBeyazaIndir,
} from '../src/main/donanim/fis-gorsel.js';
import { EscPosYazici } from '../src/main/donanim/escpos.js';

const ESC = 0x1b;
const GS = 0x1d;

describe('kağıt genişliği', () => {
  it('80 mm kağıt 576, 58 mm kağıt 384 nokta basar', () => {
    expect(kagitNoktaGenisligi(48)).toBe(576);
    expect(kagitNoktaGenisligi(32)).toBe(384);
  });
});

describe('fiş HTML’i', () => {
  const onizleme = {
    ogeler: [
      { tip: 'metin' as const, metin: 'Çiğ Köfte İzmir', hiza: 'orta' as const, kalin: true, altCizgi: false, boyut: 2 as const },
      { tip: 'metin' as const, metin: 'Ürün <b>', hiza: 'sol' as const, kalin: false, altCizgi: false, boyut: 1 as const },
      { tip: 'barkod' as const, veri: '8690000000012', hiza: 'orta' as const },
      { tip: 'bosluk' as const, satir: 2 },
      { tip: 'kesme' as const },
    ],
  };

  it('Türkçe harfleri OLDUĞU GİBİ taşır — kod sayfası devreye girmez', () => {
    const html = fisHtml(onizleme, 576, 48);
    expect(html).toContain('Çiğ Köfte İzmir');
  });

  it('kağıt genişliğini gövdeye yazar', () => {
    expect(fisHtml(onizleme, 576, 48)).toContain('width:576px');
  });

  it('ürün adındaki HTML işaretlerini kaçırır', () => {
    const html = fisHtml(onizleme, 576, 48);
    expect(html, '<b> etiket olarak yorumlanmamalı').toContain('Ürün &lt;b&gt;');
    expect(html).not.toContain('Ürün <b>');
  });

  it('barkodu çubuk olarak çizer, metin olarak değil', () => {
    const html = fisHtml(onizleme, 576, 48);
    expect(html).toContain('class="barkod');
    expect(html, 'çubuklar genişlikli öğeler olarak çizilir').toMatch(/<i style="width:\d+px/);
  });

  /**
   * GERÇEK HATAYI KİLİTLER: `ikiSutun()` satırı 48 karaktere doldurur, çift
   * puntoda kağıda 24 karakter sığar. Satır olduğu gibi çizilince sağdaki
   * tutar kağıt dışında kalıyor ve fişte TOPLAM'ın rakamı hiç görünmüyordu.
   */
  it('çift puntolu iki sütunlu satırda tutar kaybolmaz', () => {
    const toplam = {
      ogeler: [
        {
          tip: 'metin' as const,
          metin: 'TOPLAM' + ' '.repeat(36) + '511,15',
          hiza: 'sol' as const,
          kalin: true,
          altCizgi: false,
          boyut: 2 as const,
        },
      ],
    };
    const html = fisHtml(toplam, 576, 48);
    expect(html, 'sol ve sağ uçlara yaslanan yerleşim').toContain('class="s k b2 ikili"');
    expect(html).toContain('<span>TOPLAM</span>');
    expect(html, 'tutar çizime girmeli').toContain('<span>511,15</span>');
  });

  it('normal puntolu satır boşlukla hizalı kalır — bölünmez', () => {
    const satir = {
      ogeler: [
        {
          tip: 'metin' as const,
          metin: 'Ekmek' + ' '.repeat(37) + '12,50',
          hiza: 'sol' as const,
          kalin: false,
          altCizgi: false,
          boyut: 1 as const,
        },
      ],
    };
    // CSS'te `.ikili` kuralı her zaman bulunur; öğenin kendisi bölünmemeli.
    expect(fisHtml(satir, 576, 48), 'tek punto satır zaten sığar').not.toContain('<span>12,50</span>');
  });

  it('kesme komutu çizime girmez — kağıt komutudur', () => {
    expect(fisHtml({ ogeler: [{ tip: 'kesme' }] }, 576, 48)).not.toContain('kesme');
  });

  it('dar kağıtta punto küçülür — satır sağdan taşmasın', () => {
    const genis = fisHtml(onizleme, 576, 48);
    const dar = fisHtml(onizleme, 384, 32);
    const punto = (html: string) => Number(/font-size:([\d.]+)px/.exec(html)?.[1]);
    expect(punto(dar)).toBeCloseTo(punto(genis), 1);
  });
});

describe('1-bit’e indirme', () => {
  it('koyu pikseli siyah bit yapar, açık pikseli bırakır', () => {
    // 8×1 piksel: ilk piksel siyah, kalanlar beyaz (BGRA).
    const bgra = new Uint8Array(8 * 4).fill(255);
    bgra[0] = 0;
    bgra[1] = 0;
    bgra[2] = 0;
    const bitler = siyahBeyazaIndir(bgra, 8, 1);
    expect(bitler.length).toBe(1);
    expect(bitler[0], 'en soldaki piksel en anlamlı bit').toBe(0x80);
  });

  it('satır başına bayt sayısı sekize yuvarlanır', () => {
    const bgra = new Uint8Array(9 * 2 * 4).fill(255);
    expect(siyahBeyazaIndir(bgra, 9, 2).length, '9 nokta → 2 bayt, 2 satır').toBe(4);
  });
});

describe('ESC/POS raster komutu', () => {
  it('GS v 0 başlığını ve ölçüleri yazar', () => {
    const bitler = new Uint8Array(72 * 10);
    const komut = rasterKomutu(bitler, 576, 10);
    expect([...komut.subarray(0, 4)]).toEqual([GS, 0x76, 0x30, 0x00]);
    expect(komut[4], 'satır başına bayt = 576/8 = 72').toBe(72);
    expect(komut[6], 'yükseklik 10 satır').toBe(10);
  });

  it('uzun fişi şeritlere böler — yazıcı ara belleği taşmasın', () => {
    const boy = 300;
    const komut = rasterKomutu(new Uint8Array(72 * boy), 576, boy, 128);
    let basliklar = 0;
    for (let i = 0; i < komut.length - 2; i++) {
      if (komut[i] === GS && komut[i + 1] === 0x76 && komut[i + 2] === 0x30) basliklar++;
    }
    expect(basliklar, '300 satır 128’lik şeritlerde 3 komut eder').toBe(3);
  });
});

describe('kağıt komutları görüntüden sonra korunur', () => {
  it('kesme ve çekmece komutlarını taşır', () => {
    const baytlar = new EscPosYazici(48).baslat().satir('deneme').cekmeceAc(2).kes().bitir();
    const kuyruk = kuyrukKomutlari(baytlar);
    expect([...kuyruk]).toContain(0x70); // ESC p — çekmece
    expect([...kuyruk]).toContain(0x56); // GS V — kesme
  });

  it('kesme yoksa uydurmaz', () => {
    const baytlar = new EscPosYazici(48).baslat().satir('deneme').bitir();
    expect(kuyrukKomutlari(baytlar).length).toBe(0);
  });
});

describe('metin fişine geri düşme', () => {
  const baytlar = new EscPosYazici(48).baslat().satir('Çiğ Köfte').kes().bitir();

  it('çizim başarısız olursa özgün baytlar döner — kasa durmaz', async () => {
    const sonuc = await fisiGorselleStir(baytlar, 48, async () => {
      throw new Error('çizici yok');
    });
    expect(sonuc.gorsel).toBe(false);
    expect(sonuc.baytlar).toEqual(baytlar);
    expect(sonuc.hata).toContain('çizici yok');
  });

  it('çizim başarılıysa raster komutu üretir', async () => {
    const sonuc = await fisiGorselleStir(baytlar, 48, async (_html, en) => ({
      bgra: new Uint8Array(en * 4 * 4).fill(0),
      en,
      boy: 4,
    }));
    expect(sonuc.gorsel).toBe(true);
    const c = sonuc.baytlar;
    expect([...c.subarray(0, 2)], 'yazıcı önce sıfırlanır').toEqual([ESC, 0x40]);
    let rasterVar = false;
    for (let i = 0; i < c.length - 2; i++) if (c[i] === GS && c[i + 1] === 0x76 && c[i + 2] === 0x30) rasterVar = true;
    expect(rasterVar).toBe(true);
  });
});
