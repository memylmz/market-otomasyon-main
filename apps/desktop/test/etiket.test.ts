/**
 * Etiket (barkod) yazıcısı komut üretimi (§13.3).
 *
 * NEDEN VAR: etiket yazıcısı fiş yazıcısından FARKLI bir dil konuşur ve
 * fiziksel ölçü bilir. Ölçü/DPI hesabı sessizce bozulursa çıktı ya etikete
 * sığmaz ya yarım basar; ne derleyici ne de kullanıcı bunu koddan anlar,
 * ancak kağıda basıldığında görülür. Bu dosya hesabı koda kilitler.
 */

import { describe, expect, it } from 'vitest';
import { etiketBaytlari, etiketYerlesimi, kalibrasyonEtiketi, type EtiketOlcusu } from '../src/main/donanim/etiket.js';
import { code128Cizimi } from '@market/shared';

const olcu: EtiketOlcusu = { enMm: 40, boyMm: 30, boslukMm: 2, dpi: 203, sutun: 1, isi: 8, hiz: 4 };
const secenek = { rafGoster: true, birimFiyatGoster: true };
const urun = { ad: 'Elma', fiyat: 4550, barkod: '8690000000017', birimTipi: 'KG', rafKonumu: 'A-3', adet: 1 };

describe('TSPL etiketi', () => {
  const metin = () => etiketBaytlari('TSPL', urun, olcu, secenek).toString('latin1');

  it('ölçüyü milimetre olarak bildirir', () => {
    expect(metin()).toContain('SIZE 40 mm,30 mm');
    expect(metin()).toContain('GAP 2 mm,0 mm');
  });

  it('barkodu ve fiyatı içerir', () => {
    const c = metin();
    expect(c).toContain('8690000000017');
    expect(c, 'fiyat etiketin en görünür öğesidir').toContain('45,50');
  });

  it('adet kadar kopya bastırır', () => {
    const c = etiketBaytlari('TSPL', { ...urun, adet: 25 }, olcu, secenek).toString('latin1');
    expect(c).toContain('PRINT 25,1');
  });

  /**
   * Gömülü fontlar Türkçe harfleri ya yanlış basar ya hiç basmaz; ASCII'ye
   * indirmek boş kutu basmaktan yeğdir.
   */
  it('Türkçe karakterleri ASCII karşılığına indirir', () => {
    const c = etiketBaytlari('TSPL', { ...urun, ad: 'Çilek Şurubu' }, olcu, secenek).toString('latin1');
    expect(c).toContain('Cilek Surubu');
    expect(c).not.toContain('Ç');
  });

  it('raf kodu kapalıyken yazılmaz', () => {
    const c = etiketBaytlari('TSPL', urun, olcu, { rafGoster: false, birimFiyatGoster: true }).toString('latin1');
    expect(c).not.toContain('Raf:');
  });
});

/**
 * Türkçe destekli TSPL — sahada Gainscha 4B-2074C üzerinde doğrulandı.
 *
 * NEDEN BAYT DÜZEYİNDE SINANIYOR: "ğ" harfi kaynakta U+011F'tir ama yazıcıya
 * CP1254'ün tek baytlık 0xF0'ı gitmek zorundadır. Metin karşılaştırması bu
 * farkı göremez; yanlış bayt giderse etiket sessizce bozuk harf basar.
 */
describe('TSPL etiketi — Türkçe kod sayfası', () => {
  const trSecenek = { rafGoster: true, birimFiyatGoster: true, turkce: true };
  const bayt = (ad: string) => etiketBaytlari('TSPL', { ...urun, ad }, olcu, trSecenek);

  it('kod sayfasını her işte bildirir', () => {
    expect(bayt('Elma').toString('latin1')).toContain('CODEPAGE 1254');
  });

  it('Latin-1 dışı Türkçe harfleri CP1254 baytına çevirir', () => {
    const baytlar = [...bayt('Çiğ Köfte Şiş')];
    // ğ → 0xF0, ş → 0xFE: Latin-1'de karşılığı olmayan harfler.
    expect(baytlar).toContain(0xf0);
    expect(baytlar).toContain(0xfe);
    // Ç, ö zaten Latin-1 ile aynı kod noktasında.
    expect(baytlar).toContain(0xc7);
    expect(baytlar).toContain(0xf6);
  });

  it('noktalı ve noktasız i ailesini ayırır', () => {
    const baytlar = [...bayt('İki Kırmızı')];
    expect(baytlar, 'İ büyük noktalı = 0xDD').toContain(0xdd);
    expect(baytlar, 'ı küçük noktasız = 0xFD').toContain(0xfd);
    expect(baytlar, 'i küçük noktalı ASCII kalır = 0x69').toContain(0x69);
  });

  it('CP1254 içinde olmayan ₺ simgesini TL olarak yazar', () => {
    expect(bayt('Elma').toString('latin1')).toContain('TL');
  });

  it('önizleme ile baskı aynı metni taşır — Türkçe ASCII’ye indirilmez', () => {
    const yerlesim = etiketYerlesimi({ ...urun, ad: 'Çiğ Köfte' }, olcu, trSecenek);
    const adOgesi = yerlesim.ogeler.find((o) => o.tip === 'metin' && o.metin.includes('Köfte'));
    expect(adOgesi, 'yerleşimdeki ad Türkçe kalmalı ki önizleme kağıtla aynı olsun').toBeDefined();
  });
});

describe('ZPL etiketi', () => {
  /**
   * ZPL milimetre değil NOKTA ister. 203 dpi'da 40 mm = 320 nokta.
   * DPI hesabı bozulursa her şey yarı boyutta ya da iki katı basar.
   */
  it('milimetreyi DPI ile noktaya çevirir', () => {
    const c = etiketBaytlari('ZPL', urun, olcu, secenek).toString('latin1');
    expect(c).toContain('^PW320');
    expect(c).toContain('^LL240');
  });

  it('300 dpi yazıcıda nokta sayısı büyür', () => {
    const c = etiketBaytlari('ZPL', urun, { ...olcu, dpi: 300 }, secenek).toString('latin1');
    expect(c).toContain('^PW472');
  });

  it('adet kadar kopya bastırır', () => {
    const c = etiketBaytlari('ZPL', { ...urun, adet: 7 }, olcu, secenek).toString('latin1');
    expect(c).toContain('^PQ7');
  });

  it('ZPL bloğu açılıp kapanır', () => {
    const c = etiketBaytlari('ZPL', urun, olcu, secenek).toString('latin1');
    expect(c.startsWith('^XA')).toBe(true);
    expect(c.trimEnd().endsWith('^XZ')).toBe(true);
  });
});

describe('kalibrasyon etiketi', () => {
  /** Çerçeve olmadan kullanıcı hangi mm değerini oynatacağını bilemez. */
  it('TSPL çerçeve çizer ve ölçüyü yazar', () => {
    const c = kalibrasyonEtiketi('TSPL', olcu).toString('latin1');
    expect(c).toContain('BOX 0,0,319,239');
    expect(c).toContain('40x30mm 203dpi');
  });

  it('ZPL çerçeve çizer', () => {
    const c = kalibrasyonEtiketi('ZPL', olcu).toString('latin1');
    expect(c).toContain('^GB319,239');
  });
});

describe('uzun ürün adı', () => {
  /** Taşan ad etiketi okunmaz hale getirir; kesme yazı genişliğine göredir. */
  it('dar etikette daha çok kısalır', () => {
    const uzun = 'Çok Uzun Bir Ürün Adı Buraya Sığmaz Kesinlikle';
    const dar = etiketBaytlari('TSPL', { ...urun, ad: uzun }, { ...olcu, enMm: 30 }, secenek).toString('latin1');
    const genis = etiketBaytlari('TSPL', { ...urun, ad: uzun }, { ...olcu, enMm: 60 }, secenek).toString('latin1');
    const uzunluk = (c: string) => (c.match(/"([^"]*Uzun[^"]*)"/)?.[1] ?? '').length;
    expect(uzunluk(dar)).toBeLessThan(uzunluk(genis));
  });
});

describe('yerleşim — önizleme ile baskı aynı kaynaktan', () => {
  /**
   * Önizleme ve yazıcı komutları TEK yerleşimden üretilir. Ayrı hesaplansaydı
   * ekranda düzgün duran etiket kağıtta başka türlü otururdu.
   */
  it('yerleşimdeki her öğe TSPL çıktısında da yer alır', () => {
    const yerlesim = etiketYerlesimi(urun, olcu, secenek);
    const c = etiketBaytlari('TSPL', urun, olcu, secenek).toString('latin1');
    for (const oge of yerlesim.ogeler) {
      if (oge.tip === 'metin') expect(c, `"${oge.metin}" komutlarda yok`).toContain(oge.metin);
      if (oge.tip === 'barkod') expect(c).toContain(oge.veri);
    }
  });

  /**
   * CODE128 genişliği VERİYE bağlıdır: 13 hane = 178 modül. Modül genişliği
   * sabit 2 nokta bırakılsaydı 203 dpi'da 44,5 mm ederdi ve 40 mm'lik etiketten
   * TAŞARDI — kağıda basılana kadar da fark edilmezdi.
   */
  it('barkod modül genişliği etikete sığacak şekilde hesaplanır', () => {
    const yerlesim = etiketYerlesimi(urun, olcu, secenek);
    const barkod = yerlesim.ogeler.find((o) => o.tip === 'barkod');
    expect(barkod, 'barkod öğesi olmalı').toBeDefined();
    if (barkod?.tip !== 'barkod') return;

    const kullanilabilir = olcu.enMm - 4;
    expect(barkod.genislikMm, 'barkod etikete sığmalı').toBeLessThanOrEqual(kullanilabilir);
    expect(code128Cizimi(urun.barkod)?.toplamModul).toBe(178);
  });

  it('dar etikette barkod daha ince modüllerle çizilir', () => {
    const genis = etiketYerlesimi(urun, { ...olcu, enMm: 80 }, secenek).ogeler.find((o) => o.tip === 'barkod');
    const dar = etiketYerlesimi(urun, { ...olcu, enMm: 40 }, secenek).ogeler.find((o) => o.tip === 'barkod');
    if (genis?.tip !== 'barkod' || dar?.tip !== 'barkod') throw new Error('barkod bulunamadı');
    expect(dar.modulMm).toBeLessThan(genis.modulMm);
  });

  /** Sığmayan içerik SESSİZ kalmamalı; önizlemenin asıl işi bunu göstermektir. */
  it('içerik etiket boyunu aşarsa uyarır', () => {
    const kucuk = etiketYerlesimi(urun, { ...olcu, boyMm: 12 }, secenek);
    expect(kucuk.uyarilar.length, 'küçük etikette uyarı beklenir').toBeGreaterThan(0);
  });

  it('yeterli etikette uyarı üretilmez', () => {
    expect(etiketYerlesimi(urun, { ...olcu, enMm: 60, boyMm: 40 }, secenek).uyarilar).toEqual([]);
  });
});
