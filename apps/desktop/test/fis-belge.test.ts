/**
 * Fiş belgesi ve premium çizici (§13.2).
 *
 * Belge, fişin yazdırmadan önceki yapılandırılmış hâlidir: ürün adı, miktar,
 * birim fiyat ve tutar AYRI alanlar olarak durur. Bu testler o ayrımın
 * korunduğunu ve çizicinin belgedeki her bilgiyi kağıda taşıdığını kilitler —
 * kaybolan bir alan ancak müşterinin elindeki fişte görülürdü.
 */

import { describe, expect, it } from 'vitest';
import { ekstreBelgesi, gunSonuBelgesi, kdvKirilimi, satisBelgesi } from '../src/main/donanim/fis-belge.js';
import { belgeHtml, ekstreHtml, gunSonuHtml } from '../src/main/donanim/fis-html.js';

const isletme = {
  ad: 'ŞAHİN GIDA',
  adres: 'Çiğli Şubesi',
  telefon: '0232 000 00 00',
  vergiNo: '1234567890',
  altMetin: 'Teşekkürler',
};

const detay = {
  satis: {
    fis_no: 'A-000042',
    tarih: '2026-09-12T19:05:00.000Z',
    ara_toplam: 42_596,
    iskonto_toplam: 0,
    kdv_toplam: 8_519,
    genel_toplam: 51_115,
    musteri_adi: null,
    iade_mi: false,
  },
  kalemler: [
    { urun_adi: 'Çiğ Köfte', miktar: 2000, birim_tipi: 'ADET', birim_fiyat: 7_250, satir_toplam: 14_500, kdv_orani: 20, kdv_tutar: 2_417, iskonto: 0 },
    { urun_adi: 'Kırmızı Mercimek', miktar: 1250, birim_tipi: 'KG', birim_fiyat: 5_120, satir_toplam: 6_400, kdv_orani: 10, kdv_tutar: 582, iskonto: 250 },
  ],
  odemeler: [{ odeme_tipi: 'NAKIT', tutar: 51_115, alinan: 60_000, para_ustu: 8_885 }],
} as never;

const belge = () => satisBelgesi(detay, isletme, { kasiyerAdi: 'Mehmet Y.', yasalUyari: 'BİLGİ FİŞİDİR' });

describe('fiş belgesi', () => {
  it('kalem alanlarını AYRI AYRI taşır — tek dizgede erimez', () => {
    const k = belge().kalemler[0]!;
    expect(k.ad).toBe('Çiğ Köfte');
    expect(k.miktarMetni).toBe('2 ad');
    expect(k.birimFiyatMetni).toBe('72,50');
    expect(k.tutarMetni).toBe('145,00');
  });

  it('kilogramlı ürünün miktarını birimiyle yazar', () => {
    expect(belge().kalemler[1]!.miktarMetni).toBe('1,25 kg');
  });

  it('kalem iskontosunu taşır', () => {
    expect(belge().kalemler[1]!.iskontoMetni).toBe('-2,50');
    expect(belge().kalemler[0]!.iskontoMetni, 'iskontosuz kalemde null').toBeNull();
  });

  it('işletme satırlarında boş alanları atlar', () => {
    const b = satisBelgesi(detay, { ad: 'X' }, { yasalUyari: 'u' });
    expect(b.isletmeSatirlari).toEqual([]);
  });

  it('iade fişinde başlık ve toplam etiketi değişir', () => {
    const ham = detay as unknown as { satis: Record<string, unknown> };
    const iade = { ...ham, satis: { ...ham.satis, iade_mi: true } } as never;
    const b = satisBelgesi(iade, isletme, { yasalUyari: 'u' });
    expect(b.baslik).toBe('İADE FİŞİ');
    expect(b.toplam.etiket).toBe('İADE');
  });

  it('barkodda tire ve boşluk bırakmaz', () => {
    // HID okuyucular tuş kodu gönderir; Türkçe Q klavyede `-` yerine `*` okunur.
    expect(belge().barkod).toBe('A000042');
  });

  it('KDV kırılımını orana göre gruplar ve sıralar', () => {
    const dilimler = kdvKirilimi((detay as unknown as { kalemler: never[] }).kalemler);
    expect(dilimler.map((d) => d.oran)).toEqual([10, 20]);
  });
});

describe('premium çizici', () => {
  const html = () => belgeHtml(belge(), 576);

  it('her kalemin adını, miktarını ve tutarını kağıda taşır', () => {
    const h = html();
    expect(h).toContain('Çiğ Köfte');
    expect(h).toContain('2 ad × 72,50');
    expect(h).toContain('145,00');
  });

  it('toplamı ters bantta gösterir', () => {
    expect(html(), 'siyah zemin en güçlü vurgu').toContain('class="toplam"');
  });

  it('yasal uyarıyı ve alt metni basar', () => {
    const h = html();
    expect(h).toContain('BİLGİ FİŞİDİR');
    expect(h).toContain('Teşekkürler');
  });

  it('ürün adındaki HTML işaretlerini kaçırır', () => {
    const ham = detay as unknown as { kalemler: Record<string, unknown>[] };
    const tehlikeli = { ...ham, kalemler: [{ ...ham.kalemler[0], urun_adi: 'Süt <b>2L</b>' }] } as never;
    const h = belgeHtml(satisBelgesi(tehlikeli, isletme, { yasalUyari: 'u' }), 576);
    expect(h).toContain('Süt &lt;b&gt;2L&lt;/b&gt;');
  });

  it('dar kağıtta ölçüler küçülür', () => {
    const punto = (h: string) => Number(/font-size:(\d+)px;line-height:1.35/.exec(h)?.[1]);
    expect(punto(belgeHtml(belge(), 384))).toBeLessThan(punto(belgeHtml(belge(), 576)));
  });

  it('barkodu çubuk olarak çizer', () => {
    expect(html()).toMatch(/<i style="width:\d+px/);
  });

  /**
   * GERÇEK REGRESYONU KİLİTLER: ortak stil ayrı bir fonksiyona çıkarılırken
   * `.kalem` kuralları silinmişti. Yerleşim çöktü — tutar alt satıra düştü,
   * ürün adı kalınlığını yitirdi — ama içerik testleri geçmeye devam etti,
   * çünkü METİN hâlâ oradaydı. Kağıda basılana kadar görünmezdi.
   */
  it('kalem yerleşim kuralları çizimde bulunur', () => {
    const h = html();
    expect(h, 'ad solda, tutar sağda').toContain('.kalem{display:flex');
    expect(h, 'tutar kendi satırına düşmemeli').toContain('.kalem .tutar');
    expect(h, 'kalemler arası ayırıcı').toContain('.liste .kalem + .kalem');
  });

  it('ayırıcı çizgi SİYAH — açık ton 1-bit dönüşümde kağıtta kaybolur', () => {
    expect(html()).toMatch(/\.liste \.kalem \+ \.kalem\{border-top:1px dotted #000/);
  });
});


// ---------------------------------------------------------------------------
// Cari hesap ekstresi
// ---------------------------------------------------------------------------

const hareketler = [
  { tarih: '2026-08-03T09:12:00Z', aciklama: 'Satış (A-000188)', tutar: 45_000, yuruyen_bakiye: 45_000 },
  { tarih: '2026-08-20T11:05:00Z', aciklama: 'Nakit tahsilat', tutar: -50_000, yuruyen_bakiye: -5_000 },
  { tarih: '2026-09-02T15:22:00Z', aciklama: 'Satış (A-000377)', tutar: 50_000, yuruyen_bakiye: 45_000 },
] as never[];

const ekstre = (bakiye: number) =>
  ekstreBelgesi({ ad_unvan: 'Ayşe Yılmaz', telefon: '0532 000 00 00', bakiye } as never, hareketler, isletme, {
    yasalUyari: 'BİLGİ FİŞİDİR',
    baslangic: '2026-08-01',
    bitis: '2026-09-12',
  });

describe('cari ekstresi', () => {
  it('dönem başı bakiyeyi ilk hareketten geri hesaplar', () => {
    // İlk hareket +450,00 ve sonrası 450,00 → dönem başı 0,00 olmalı.
    expect(ekstre(45_000).ozet[0]).toEqual({ etiket: 'Dönem başı bakiye', deger: '0,00' });
  });

  it('borç ve tahsilat toplamlarını ayırır', () => {
    const o = ekstre(45_000).ozet;
    expect(o[1], 'iki satış toplamı').toEqual({ etiket: 'Toplam borç', deger: '950,00' });
    expect(o[2], 'tek tahsilat').toEqual({ etiket: 'Toplam tahsilat', deger: '500,00' });
  });

  it('hareketin borç mu alacak mı olduğunu işaretler', () => {
    const h = ekstre(45_000).hareketler;
    expect(h[0]!.borcMu).toBe(true);
    expect(h[1]!.borcMu, 'tahsilat alacaktır').toBe(false);
    expect(h[1]!.tutarMetni, 'tutar işaretsiz taşınır, işareti çizici koyar').toBe('500,00');
  });

  /**
   * "DAHA AÇIKLAYICI OLSUN" istendi: bakiyenin işareti kime borçlu olunduğunu
   * söylemez. Cümle bunu düz Türkçe yazar.
   */
  it('bakiyenin ne anlama geldiğini cümleyle yazar', () => {
    expect(ekstre(45_000).bakiyeAciklamasi).toBe('Ayşe Yılmaz işletmeye 450,00 TL borçludur.');
    expect(ekstre(-45_000).bakiyeAciklamasi).toBe('İşletme Ayşe Yılmaz kişisine 450,00 TL borçludur.');
    expect(ekstre(0).bakiyeAciklamasi).toContain('kapalı');
  });

  it('çizim her hareketi, özeti ve açıklamayı taşır', () => {
    const h = ekstreHtml(ekstre(45_000), 576);
    expect(h).toContain('Satış (A-000188)');
    expect(h, 'borç artı işaretiyle').toContain('+450,00');
    expect(h, 'tahsilat eksi işaretiyle').toContain('-500,00');
    expect(h).toContain('Dönem başı bakiye');
    expect(h).toContain('işletmeye 450,00 TL borçludur');
  });

  it('hareket yerleşim kuralları ve ayırıcı çizimde bulunur', () => {
    const h = ekstreHtml(ekstre(45_000), 576);
    expect(h).toContain('.hareket{display:flex');
    expect(h, 'hareketler arası ayırıcı').toMatch(/\.liste \.hareket \+ \.hareket\{border-top:1px dotted #000/);
  });

  it('uzun ekstrede son 60 hareket basılır — kağıt metrelerce akmasın', () => {
    const cok = Array.from({ length: 80 }, (_, i) => ({
      tarih: '2026-08-03T09:12:00Z',
      aciklama: 'Hareket ' + i,
      tutar: 1_000,
      yuruyen_bakiye: 1_000 * (i + 1),
    })) as never[];
    const b = ekstreBelgesi({ ad_unvan: 'X', bakiye: 80_000 } as never, cok, isletme, { yasalUyari: 'u' });
    expect(b.hareketler).toHaveLength(60);
    expect(b.hareketler[59]!.aciklama).toBe('Hareket 79');
  });
});


// ---------------------------------------------------------------------------
// Gün sonu raporu
// ---------------------------------------------------------------------------

const ozet = {
  acilis_bakiye: 50_000,
  satis_nakit: 384_250,
  satis_kart: 512_000,
  veresiye: 87_500,
  tahsilat: 45_000,
  odeme: 120_000,
  gider: 18_750,
  giris: 0,
  cikis: 50_000,
  iade_nakit: 12_500,
  islem_sayisi: 87,
} as never;

const gunSonu = (fark: number) =>
  gunSonuBelgesi(
    ozet,
    {
      isletme,
      kasiyerAdi: 'Mehmet Yılmaz',
      acilis: '2026-09-13T05:30:00Z',
      kapanis: '2026-09-13T18:45:00Z',
      sayilanNakit: 296_750,
      beklenenNakit: 298_000,
      kasaFarki: fark,
    } as never,
    'BİLGİ FİŞİDİR',
  );

describe('gün sonu raporu', () => {
  it('satış ve kasa hareketlerini AYRI gruplara ayırır', () => {
    const g = gunSonu(-1_250).gruplar;
    expect(g.map((x) => x.baslik)).toEqual(['SATIŞLAR', 'KASA HAREKETLERİ']);
  });

  /** Eski raporda satış toplamı YOKTU; kasiyer üç kalemi kafadan topluyordu. */
  it('satış grubunun toplamını hesaplar', () => {
    // 3.842,50 + 5.120,00 + 875,00 = 9.837,50
    expect(gunSonu(0).gruplar[0]!.toplam).toEqual({ etiket: 'Toplam satış', deger: '9.837,50' });
  });

  it('kasa hareketleri grubunda toplam yoktur — anlamlı değil', () => {
    expect(gunSonu(0).gruplar[1]!.toplam, 'giriş ve çıkış aynı kefeye konamaz').toBeNull();
  });

  it('kasa farkını düz cümleyle açıklar', () => {
    expect(gunSonu(-1_250).farkAciklamasi).toBe('Kasada 12,50 TL EKSİK var.');
    expect(gunSonu(1_250).farkAciklamasi).toBe('Kasada 12,50 TL FAZLA var.');
    expect(gunSonu(0).farkAciklamasi).toContain('tam tutuyor');
  });

  it('fark tutarı işaretsiz taşınır — yönü cümle söyler', () => {
    expect(gunSonu(-1_250).fark.deger).toBe('12,50');
  });

  it('çizim grupları, işlem sayısını ve mutabakatı taşır', () => {
    const h = gunSonuHtml(gunSonu(-1_250), 576);
    expect(h).toContain('SATIŞLAR');
    expect(h).toContain('KASA HAREKETLERİ');
    expect(h).toContain('Toplam satış');
    expect(h).toContain('İşlem sayısı');
    expect(h).toContain('Beklenen nakit');
    expect(h).toContain('EKSİK var');
  });

  it('gruplar arasında ayırıcı çizgi bulunur', () => {
    expect(gunSonuHtml(gunSonu(0), 576)).toMatch(/\.grup \+ \.grup\{border-top:1px dotted #000/);
  });
});
