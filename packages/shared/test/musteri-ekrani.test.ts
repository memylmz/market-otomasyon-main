import { describe, expect, it } from 'vitest';
import {
  BASLANGIC_EKRAN_DURUMU,
  BOS_MUSTERI_SEPETI,
  ekranDurumuIlerle,
  kampanyaFiyatKarti,
  MAKS_SLAYT,
  medyaAdiGecerliMi,
  musteriEkraniAyariMi,
  musteriSepetiSemasi,
  sepetKazanci,
  slaytlariCoz,
  slaytlariDogrula,
  slaytMedyalari,
  slaytSirasiKoru,
  sonDegisenSatir,
  urunFiyatKarti,
  varsayilanSlaytlar,
  type EkranDurumu,
  type KampanyaSlaytGirdisi,
  type KampanyaSlaytHedefi,
  type MusteriSepeti,
  type MusteriSlayti,
} from '@market/shared';

const GORSEL = '0b5a7c1e-3f2d-4e8a-9c6b-1a2b3c4d5e6f.png';
const VIDEO = '1c6b8d2f-4a3e-4f9b-8d7c-2b3c4d5e6f70.mp4';

describe('yayın listesi ayarı', () => {
  it('boş ya da hiç girilmemişse karşılama + kampanyalar', () => {
    for (const deger of [undefined, null, '', '   ']) {
      expect(slaytlariCoz(deger).map((s) => s.tip)).toEqual(['KARSILAMA', 'KAMPANYALAR']);
    }
  });

  it('bozuk JSON ya da şemaya uymayan liste ekranı karartmaz, varsayılana düşer', () => {
    expect(slaytlariCoz('{bozuk')).toEqual(varsayilanSlaytlar());
    expect(slaytlariCoz(JSON.stringify([{ id: 'x', tip: 'UYDURMA', aktif: true }]))).toEqual(varsayilanSlaytlar());
  });

  it('geçerli listeyi sırasıyla okur', () => {
    const liste: MusteriSlayti[] = [
      { id: 'v', tip: 'VIDEO', aktif: true, dosya: VIDEO, ad: 'reklam.mp4' },
      { id: 'd', tip: 'DUYURU', aktif: false, baslik: 'Taze ekmek', metin: 'Her sabah 07:00', tema: 'TURUNCU', sure_sn: 10 },
      { id: 'k', tip: 'KARSILAMA', aktif: true, sure_sn: 8 },
    ];
    expect(slaytlariCoz(JSON.stringify(liste))).toEqual(liste);
  });

  it('kayıtta okunur Türkçe hata verir', () => {
    expect(slaytlariDogrula('[')).toEqual({ gecerli: false, mesaj: 'Müşteri ekranı yayın listesi okunamadı.' });

    const bosDuyuru = slaytlariDogrula(
      JSON.stringify([{ id: 'd', tip: 'DUYURU', aktif: true, baslik: '  ', metin: '', tema: 'MAVI', sure_sn: 8 }]),
    );
    expect(bosDuyuru).toEqual({ gecerli: false, mesaj: expect.stringContaining('Duyuru başlığı boş olamaz') });

    const kisaSure = slaytlariDogrula(JSON.stringify([{ id: 'k', tip: 'KARSILAMA', aktif: true, sure_sn: 1 }]));
    expect(kisaSure).toEqual({ gecerli: false, mesaj: expect.stringContaining('en az 3 saniye') });

    const urunsuz = slaytlariDogrula(
      JSON.stringify([{ id: 'u', tip: 'URUN', aktif: true, urun_id: '', baslik: '', tema: 'YESIL', sure_sn: 8 }]),
    );
    expect(urunsuz).toEqual({ gecerli: false, mesaj: expect.stringContaining('ürün seçilmelidir') });
  });

  it('aynı kimlik iki kez kullanılamaz', () => {
    const sonuc = slaytlariDogrula(
      JSON.stringify([
        { id: 'a', tip: 'KARSILAMA', aktif: true, sure_sn: 8 },
        { id: 'a', tip: 'KAMPANYALAR', aktif: true, sure_sn: 8 },
      ]),
    );
    expect(sonuc).toEqual({ gecerli: false, mesaj: expect.stringContaining('tekrarlanamaz') });
  });

  it(`en fazla ${MAKS_SLAYT} slayt`, () => {
    const cok = Array.from({ length: MAKS_SLAYT + 1 }, (_, i) => ({ id: `s${i}`, tip: 'KARSILAMA', aktif: true, sure_sn: 8 }));
    expect(slaytlariDogrula(JSON.stringify(cok)).gecerli).toBe(false);
  });

  it('medya adı yol içeremez — yalnız ana sürecin ürettiği uuid adı', () => {
    expect(medyaAdiGecerliMi(GORSEL)).toBe(true);
    expect(medyaAdiGecerliMi(VIDEO)).toBe(true);
    for (const kotu of ['../market.db', '..\\..\\x.png', 'reklam.png', `${GORSEL}/../a.png`, GORSEL.replace('.png', '.exe')]) {
      expect(medyaAdiGecerliMi(kotu)).toBe(false);
    }
    const sonuc = slaytlariDogrula(
      JSON.stringify([{ id: 'g', tip: 'GORSEL', aktif: true, dosya: '../market.db', ad: '', sure_sn: 8 }]),
    );
    expect(sonuc).toEqual({ gecerli: false, mesaj: expect.stringContaining('Geçersiz medya dosyası') });
  });

  it('kullanılan medya dosyalarını listeler (logo hariç)', () => {
    expect(
      slaytMedyalari([
        { id: 'g', tip: 'GORSEL', aktif: false, dosya: GORSEL, ad: '', sure_sn: 8 },
        { id: 'k', tip: 'KARSILAMA', aktif: true, sure_sn: 8 },
        { id: 'v', tip: 'VIDEO', aktif: true, dosya: VIDEO, ad: '' },
      ]),
    ).toEqual([GORSEL, VIDEO]);
  });

  it('müşteri ekranı ayarlarını ayırt eder', () => {
    expect(musteriEkraniAyariMi('musteri_ekrani.slaytlar')).toBe(true);
    expect(musteriEkraniAyariMi('isletme.ad')).toBe(false);
  });
});

describe('büyük gösterilecek satır', () => {
  const s = (anahtar: string, miktar: number) => ({ anahtar, miktar });

  it('boş sepette yok', () => {
    expect(sonDegisenSatir([s('a', 1000)], [], 'a')).toBeNull();
  });

  it('yeni eklenen satır (en üste eklenir)', () => {
    expect(sonDegisenSatir([s('a', 1000)], [s('b', 1000), s('a', 1000)], 'a')).toBe('b');
  });

  it('aynı barkod tekrar okutulunca miktarı artan satır — listenin ortasında olsa da', () => {
    expect(sonDegisenSatir([s('a', 1000), s('b', 1000)], [s('a', 2000), s('b', 1000)], 'b')).toBe('a');
  });

  it('miktar azalınca ya da fiyat düzeltilince büyük satır yerinde kalır', () => {
    expect(sonDegisenSatir([s('a', 2000), s('b', 1000)], [s('a', 1000), s('b', 1000)], 'a')).toBe('a');
  });

  it('büyük gösterilen satır silinirse en üstteki (en yeni) satıra düşer', () => {
    expect(sonDegisenSatir([s('c', 1000), s('b', 1000), s('a', 1000)], [s('b', 1000), s('a', 1000)], 'c')).toBe('b');
    expect(sonDegisenSatir([s('a', 1000)], [s('a', 1000)], null)).toBe('a');
  });
});

describe('müşterinin kazancı', () => {
  it('liste fiyatıyla ödenenin farkı; fiyatı elle artırılan satır kazancı eksiye çekmez', () => {
    expect(
      sepetKazanci([
        { miktar: 3000, listeFiyati: 1000, tutar: 2000 }, // 3 al 2 öde → 10,00
        { miktar: 1500, listeFiyati: 4000, tutar: 5400 }, // 1,5 kg × 40 = 60 → 6,00
        { miktar: 1000, listeFiyati: 1000, tutar: 1500 }, // pahalıya satılmış — sayılmaz
      ]),
    ).toBe(1600);
    expect(sepetKazanci([])).toBe(0);
  });

  it('ana sürece giden sepet şeması', () => {
    const sepet: MusteriSepeti = {
      satirlar: [
        {
          anahtar: 'a',
          ad: 'Süt',
          miktar: 1000,
          birimTipi: 'ADET',
          birimFiyat: 3000,
          listeFiyati: 3000,
          tutar: 3000,
          iskonto: 0,
        },
      ],
      sonAnahtar: 'a',
      genelToplam: 3000,
      kazanc: 0,
    };
    expect(musteriSepetiSemasi.parse(sepet)).toEqual(sepet);
    expect(musteriSepetiSemasi.safeParse({ ...sepet, genelToplam: 12.5 }).success).toBe(false);
  });
});

describe('kampanyadan fiyat kartı', () => {
  const urun: KampanyaSlaytHedefi = { kapsam: 'URUN', ad: 'Ayran 1 L', listeFiyati: 3000, birimTipi: 'ADET' };
  const kg: KampanyaSlaytHedefi = { kapsam: 'URUN', ad: 'Domates', listeFiyati: 4000, birimTipi: 'KG' };
  const kategori: KampanyaSlaytHedefi = { kapsam: 'KATEGORI', ad: 'Süt' };
  const tum: KampanyaSlaytHedefi = { kapsam: 'TUM' };
  const k = (alanlar: Partial<KampanyaSlaytGirdisi>): KampanyaSlaytGirdisi => ({
    ad: 'Hafta Sonu',
    tip: 'YUZDE',
    kapsam: 'URUN',
    deger: 20,
    esikMiktar: null,
    ...alanlar,
  });

  it('yüzde indirim: ürün kartında eski fiyat üstü çizili, yeni fiyat hesaplı', () => {
    expect(kampanyaFiyatKarti(k({}), urun)).toEqual({
      ust: 'Hafta Sonu',
      ad: 'Ayran 1 L',
      rozet: '%20 İNDİRİM',
      fiyat: '24,00 ₺',
      eskiFiyat: '30,00 ₺',
      birim: null,
      alt: null,
      tema: 'KIRMIZI',
    });
  });

  it('yüzde indirim kategoride ve tüm mağazada fiyatsız', () => {
    expect(kampanyaFiyatKarti(k({ kapsam: 'KATEGORI', deger: 12.5 }), kategori)).toMatchObject({
      ad: 'Tüm Süt ürünlerinde',
      rozet: '%12,5 İNDİRİM',
      fiyat: null,
      eskiFiyat: null,
    });
    expect(kampanyaFiyatKarti(k({ kapsam: 'TUM', deger: 10 }), tum)).toMatchObject({ ad: 'Tüm ürünlerde', fiyat: null });
  });

  it('kampanya adı boşsa üst başlık "Kampanya"', () => {
    expect(kampanyaFiyatKarti(k({ ad: '  ' }), urun)?.ust).toBe('Kampanya');
  });

  it('tutar indirimi; kilo üründe birim eki', () => {
    expect(kampanyaFiyatKarti(k({ tip: 'TUTAR', deger: 500 }), kg)).toMatchObject({
      rozet: '5,00 ₺ İNDİRİM',
      fiyat: '35,00 ₺',
      eskiFiyat: '40,00 ₺',
      birim: '/kg',
    });
    // Fiyatın altına inen indirim sıfırda durur.
    expect(kampanyaFiyatKarti(k({ tip: 'TUTAR', deger: 5000 }), urun)).toMatchObject({ fiyat: '0,00 ₺' });
    expect(kampanyaFiyatKarti(k({ tip: 'TUTAR', deger: 500, kapsam: 'TUM' }), tum)).toMatchObject({ fiyat: null });
  });

  it('sabit fiyat: ürün ve kategori', () => {
    expect(kampanyaFiyatKarti(k({ tip: 'SABIT_FIYAT', deger: 2490 }), urun)).toMatchObject({
      rozet: 'KAMPANYA',
      fiyat: '24,90 ₺',
      eskiFiyat: '30,00 ₺',
      tema: 'TURUNCU',
    });
    expect(kampanyaFiyatKarti(k({ tip: 'SABIT_FIYAT', deger: 990, kapsam: 'KATEGORI' }), kategori)).toMatchObject({
      ad: 'Tüm Süt ürünlerinde',
      rozet: 'TEK FİYAT',
      fiyat: '9,90 ₺',
      eskiFiyat: null,
    });
  });

  it('3 al 2 öde', () => {
    expect(kampanyaFiyatKarti(k({ tip: 'N_AL_M_ODE', deger: 2, esikMiktar: 3000 }), urun)).toMatchObject({
      rozet: '3 AL 2 ÖDE',
      fiyat: '30,00 ₺',
      alt: '3 alana 1 bedava',
      tema: 'MOR',
    });
    expect(kampanyaFiyatKarti(k({ tip: 'N_AL_M_ODE', deger: 3, esikMiktar: 5000, kapsam: 'KATEGORI' }), kategori)).toMatchObject({
      ad: 'Seçili Süt ürünlerinde',
      fiyat: null,
      alt: '5 alana 2 bedava',
    });
  });

  it('kademeli fiyat', () => {
    expect(kampanyaFiyatKarti(k({ tip: 'KADEMELI_FIYAT', deger: 3200, esikMiktar: 2500 }), kg)).toMatchObject({
      rozet: 'ÇOK AL AZ ÖDE',
      fiyat: '32,00 ₺',
      eskiFiyat: '40,00 ₺',
      birim: '/kg',
      alt: '2,5 kg ve üzeri alımda',
    });
    expect(kampanyaFiyatKarti(k({ tip: 'KADEMELI_FIYAT', deger: 2500, esikMiktar: 3000 }), urun)).toMatchObject({
      alt: '3 adet ve üzeri alımda',
    });
    expect(kampanyaFiyatKarti(k({ tip: 'KADEMELI_FIYAT', deger: 900, esikMiktar: 6000, kapsam: 'TUM' }), tum)).toMatchObject({
      ad: 'Seçili ürünlerde',
      fiyat: '9,00 ₺',
      eskiFiyat: null,
      alt: '6 adet ve üzeri alımda',
    });
  });

  it('anlamsız kampanyadan kart çıkmaz', () => {
    const anlamsiz: KampanyaSlaytGirdisi[] = [
      k({ deger: 0 }),
      k({ tip: 'TUTAR', deger: 0 }),
      k({ tip: 'SABIT_FIYAT', deger: 0 }),
      k({ tip: 'SABIT_FIYAT', deger: 3500 }), // liste fiyatından pahalı
      k({ tip: 'N_AL_M_ODE', deger: 3, esikMiktar: 3000 }), // 3 al 3 öde
      k({ tip: 'N_AL_M_ODE', deger: 2, esikMiktar: null }),
      k({ tip: 'KADEMELI_FIYAT', deger: 3000, esikMiktar: 3000 }), // fiyat düşmüyor
      k({ tip: 'KADEMELI_FIYAT', deger: 2000, esikMiktar: 0 }),
      k({ tip: 'UYDURMA' as never }),
    ];
    for (const kampanya of anlamsiz) expect(kampanyaFiyatKarti(kampanya, urun)).toBeNull();
  });
});

describe('ürün fiyatı şablonu', () => {
  it('kampanyasız ürün: rozetsiz, tek fiyat', () => {
    expect(
      urunFiyatKarti(
        { baslik: ' Haftanın Ürünü ', tema: 'YESIL' },
        { ad: 'Peynir', listeFiyati: 18000, fiyat: 18000, birimTipi: 'KG' },
      ),
    ).toEqual({
      ust: 'Haftanın Ürünü',
      ad: 'Peynir',
      rozet: null,
      fiyat: '180,00 ₺',
      eskiFiyat: null,
      birim: '/kg',
      alt: null,
      tema: 'YESIL',
    });
  });

  it('kampanyadaki ürün: eski fiyat üstü çizili, İNDİRİMDE rozeti', () => {
    expect(
      urunFiyatKarti({ baslik: '', tema: 'MAVI' }, { ad: 'Çay', listeFiyati: 15000, fiyat: 12900, birimTipi: 'ADET' }),
    ).toMatchObject({ rozet: 'İNDİRİMDE', fiyat: '129,00 ₺', eskiFiyat: '150,00 ₺', birim: null });
  });
});

describe('ekran durum makinesi', () => {
  const dolu: MusteriSepeti = {
    satirlar: [
      { anahtar: 'a', ad: 'Süt', miktar: 1000, birimTipi: 'ADET', birimFiyat: 3000, listeFiyati: 3000, tutar: 3000, iskonto: 0 },
    ],
    sonAnahtar: 'a',
    genelToplam: 3000,
    kazanc: 0,
  };
  const ilerle = (d: EkranDurumu, ...olaylar: Parameters<typeof ekranDurumuIlerle>[1][]) => olaylar.reduce(ekranDurumuIlerle, d);

  it('ürün okutulunca reklam kesilir, sepet görünür', () => {
    expect(ilerle(BASLANGIC_EKRAN_DURUMU, { tur: 'SEPET', sepet: dolu })).toEqual({ mod: 'SEPET', sepet: dolu, tesekkur: null });
  });

  it('satış iptal edilip sepet boşalırsa doğrudan bekleme', () => {
    const d = ilerle(BASLANGIC_EKRAN_DURUMU, { tur: 'SEPET', sepet: dolu }, { tur: 'SEPET', sepet: BOS_MUSTERI_SEPETI });
    expect(d).toEqual(BASLANGIC_EKRAN_DURUMU);
  });

  it('satış bitince teşekkür; kasanın sepeti boşaltması teşekkürü kesmez; süre dolunca bekleme', () => {
    let d = ilerle(
      BASLANGIC_EKRAN_DURUMU,
      { tur: 'SEPET', sepet: dolu },
      { tur: 'TAMAMLANDI', genelToplam: 3000, paraUstu: 2000, zaman: 1_000, sureMs: 6_000 },
      { tur: 'SEPET', sepet: BOS_MUSTERI_SEPETI },
    );
    expect(d).toEqual({ mod: 'TESEKKUR', sepet: null, tesekkur: { genelToplam: 3000, paraUstu: 2000, bitis: 7_000 } });

    d = ilerle(d, { tur: 'SAAT', zaman: 6_999 });
    expect(d.mod).toBe('TESEKKUR');
    d = ilerle(d, { tur: 'SAAT', zaman: 7_000 });
    expect(d).toEqual(BASLANGIC_EKRAN_DURUMU);
  });

  it('teşekkür sürerken sıradaki müşterinin ilk ürünü teşekkürü keser', () => {
    const d = ilerle(
      BASLANGIC_EKRAN_DURUMU,
      { tur: 'TAMAMLANDI', genelToplam: 3000, paraUstu: 0, zaman: 0, sureMs: 6_000 },
      { tur: 'SEPET', sepet: dolu },
    );
    expect(d.mod).toBe('SEPET');
    expect(d.tesekkur).toBeNull();
  });

  it('saat tiki beklemede ve sepette hiçbir şeyi değiştirmez', () => {
    expect(ilerle(BASLANGIC_EKRAN_DURUMU, { tur: 'SAAT', zaman: 99 })).toBe(BASLANGIC_EKRAN_DURUMU);
    const sepette = ilerle(BASLANGIC_EKRAN_DURUMU, { tur: 'SEPET', sepet: dolu });
    expect(ilerle(sepette, { tur: 'SAAT', zaman: 99 })).toBe(sepette);
  });
});

describe('yayın listesi güncellenince oynayan slayt', () => {
  const liste = [{ anahtar: 'a' }, { anahtar: 'b' }, { anahtar: 'c' }];

  it('hâlâ listedeyse yerinde kalır, değilse başa döner', () => {
    expect(slaytSirasiKoru('b', liste)).toBe(1);
    expect(slaytSirasiKoru('x', liste)).toBe(0);
    expect(slaytSirasiKoru(null, liste)).toBe(0);
  });
});
