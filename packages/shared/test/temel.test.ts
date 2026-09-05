import { describe, expect, it } from 'vitest';
import {
  adet,
  ayBasi,
  barkodNormalize,
  BIRIM_KISALTMA,
  eanGecerliMi,
  eanKontrolHanesi,
  etkinYetkiler,
  fisNo,
  goreliZaman,
  gunAnahtari,
  gunAraligi,
  gunBasi,
  gunEkle,
  gunFarki,
  gunSonu,
  hataCanlandir,
  hataNormalize,
  hataSerilestir,
  icBarkodUret,
  kisaKodBul,
  kisaKodMu,
  kalanGun,
  miktarBirimeUyarla,
  miktarFormat,
  miktarGecerliMi,
  miktarOlustur,
  tartiliBarkodCoz,
  miktarParse,
  miktarToSayi,
  seriHarfi,
  tarihFormat,
  tarihSaatFormat,
  UygulamaHatasi,
  uuid,
  uuidMi,
  yerelSaat,
  yetkisiVar,
  zSatisGirdi,
  zUrunGirdi,
  YETKILER,
  carpanAyikla,
} from '@market/shared';

describe('miktar — bindebir tam sayı aritmetiği', () => {
  it('ondalıklı girdiyi mili-birime çevirir', () => {
    expect(miktarOlustur(1.25)).toBe(1250);
    expect(miktarOlustur(1)).toBe(1000);
    expect(miktarOlustur(0.001)).toBe(1);
  });

  it('kayan nokta hatasına düşmez', () => {
    expect(miktarOlustur(0.1) + miktarOlustur(0.2)).toBe(miktarOlustur(0.3));
  });

  it('TR ve nokta ondalıklı girdiyi çözer', () => {
    expect(miktarParse('1,5')).toBe(1500);
    expect(miktarParse('1.5')).toBe(1500);
    expect(miktarParse('  2 ')).toBe(2000);
    expect(miktarParse('abc')).toBeNull();
    expect(miktarParse('')).toBeNull();
  });

  it('gösterimde birim kısaltmasını ekler', () => {
    expect(miktarFormat(1250, 'KG')).toBe('1,25 kg');
    expect(miktarFormat(3000, 'ADET')).toBe('3 ad');
    expect(miktarFormat(3000, 'ADET', false)).toBe('3');
    expect(BIRIM_KISALTMA.LT).toBe('lt');
  });

  it('ADET biriminde ondalık miktar geçersizdir', () => {
    expect(miktarGecerliMi(1500, 'ADET')).toBe(false);
    expect(miktarGecerliMi(2000, 'ADET')).toBe(true);
    expect(miktarGecerliMi(1500, 'KG')).toBe(true);
  });

  it('ADET biriminde miktarı tam birime yuvarlar', () => {
    expect(miktarBirimeUyarla(1500, 'ADET')).toBe(2000);
    expect(miktarBirimeUyarla(1400, 'ADET')).toBe(1000);
    expect(miktarBirimeUyarla(1400, 'KG')).toBe(1400);
  });

  it('sayıya geri çevirir', () => {
    expect(miktarToSayi(1250)).toBe(1.25);
  });
});

describe('tarih — UTC saklama / TR gösterim (§7.7)', () => {
  it('yerel gün anahtarını UTC damgasından üretir', () => {
    // 2026-07-31T21:30Z → TR saatiyle 1 Ağustos 00:30
    expect(gunAnahtari('2026-07-31T21:30:00.000Z')).toBe('2026-08-01');
    expect(gunAnahtari('2026-07-31T20:00:00.000Z')).toBe('2026-07-31');
  });

  it('gün başı/sonu TR gününü kapsar', () => {
    const bas = gunBasi('2026-07-31');
    const son = gunSonu('2026-07-31');
    expect(gunAnahtari(bas)).toBe('2026-07-31');
    expect(new Date(son).getTime() - new Date(bas).getTime()).toBe(86400000);
    // Gün başlangıcının bir milisaniye öncesi bir önceki güne aittir
    expect(gunAnahtari(new Date(new Date(bas).getTime() - 1).toISOString())).toBe('2026-07-30');
  });

  it('gün aritmetiği ay/yıl sınırını geçer', () => {
    expect(gunEkle('2026-07-31', 1)).toBe('2026-08-01');
    expect(gunEkle('2026-01-01', -1)).toBe('2025-12-31');
    expect(gunFarki('2026-07-01', '2026-07-31')).toBe(30);
    expect(gunAraligi('2026-07-29', '2026-07-31')).toEqual(['2026-07-29', '2026-07-30', '2026-07-31']);
    expect(ayBasi('2026-07-31')).toBe('2026-07-01');
    expect(kalanGun('2026-08-05', '2026-07-31')).toBe(5);
  });

  it('TR biçiminde gösterir', () => {
    expect(tarihFormat('2026-07-31')).toBe('31.07.2026');
    expect(tarihSaatFormat('2026-07-31T17:14:00.000Z')).toBe('31.07.2026 20:14');
    expect(yerelSaat('2026-07-31T17:14:00.000Z')).toBe(20);
  });

  it('göreli zamanı Türkçe verir', () => {
    const ref = new Date('2026-07-31T12:00:00.000Z');
    expect(goreliZaman('2026-07-31T11:58:00.000Z', ref)).toBe('2 dakika önce');
    expect(goreliZaman('2026-07-31T09:00:00.000Z', ref)).toBe('3 saat önce');
    expect(goreliZaman('2026-07-29T12:00:00.000Z', ref)).toBe('2 gün önce');
    expect(goreliZaman(null)).toBe('hiç');
  });
});

describe('kimlik ve barkod', () => {
  it('geçerli UUID üretir', () => {
    const u = uuid();
    expect(uuidMi(u)).toBe(true);
    expect(uuidMi('abc')).toBe(false);
    expect(uuid()).not.toBe(u);
  });

  it('fiş numarasını biçimlendirir', () => {
    expect(fisNo('A', 512)).toBe('A-000512');
    expect(seriHarfi('kasa-01')).toMatch(/^[A-Z]$/);
    expect(seriHarfi('kasa-01')).toBe(seriHarfi('kasa-01'));
  });

  it('EAN-13 kontrol hanesini doğru hesaplar', () => {
    // Bilinen örnek: 4006381333931
    expect(eanKontrolHanesi('400638133393')).toBe(1);
    expect(eanGecerliMi('4006381333931')).toBe(true);
    expect(eanGecerliMi('4006381333932')).toBe(false);
    expect(eanGecerliMi('123')).toBe(false);
  });

  it('iç barkodu geçerli EAN-13 olarak üretir', () => {
    const b = icBarkodUret(1);
    expect(b).toHaveLength(13);
    expect(b.startsWith('29')).toBe(true);
    expect(eanGecerliMi(b)).toBe(true);
    expect(icBarkodUret(2)).not.toBe(b);
    expect(() => icBarkodUret(1, '99')).toThrow();
  });

  it('UPC-A girdisini EAN-13e tamamlar', () => {
    expect(barkodNormalize('012345678905')).toBe('0012345678905');
    expect(barkodNormalize('  8690000000001\r\n')).toBe('8690000000001');
  });
});

describe('yetki matrisi (§10.12)', () => {
  it('kasiyer satış yapabilir, ürün fiyatı değiştiremez', () => {
    const kasiyer = { rol: 'KASIYER' as const };
    expect(yetkisiVar(kasiyer, 'satis.yap')).toBe(true);
    expect(yetkisiVar(kasiyer, 'urun.fiyat_degistir')).toBe(false);
    expect(yetkisiVar(kasiyer, 'ayar.yonet')).toBe(false);
  });

  it('admin tüm yetkilere sahiptir', () => {
    // Tek tek ad saymak yerine değişmezin kendisi doğrulanır: yetki listesine
    // ekleme/çıkarma yapıldığında bu test çürümez.
    expect(YETKILER.filter((y) => !yetkisiVar({ rol: 'ADMIN' }, y))).toEqual([]);
  });

  it('müdür ayarları yönetemez ama stok girebilir', () => {
    expect(yetkisiVar({ rol: 'MUDUR' }, 'stok.giris')).toBe(true);
    expect(yetkisiVar({ rol: 'MUDUR' }, 'ayar.yonet')).toBe(false);
  });

  it('kullanıcı bazlı ek/kaldırılan yetkiler rolü ezer', () => {
    const kume = etkinYetkiler({ rol: 'KASIYER', ekYetkiler: ['satis.iade'], kaldirilanYetkiler: ['satis.satir_sil'] });
    expect(kume.has('satis.iade')).toBe(true);
    expect(kume.has('satis.satir_sil')).toBe(false);
  });
});

describe('hata yönetimi', () => {
  it('iş kuralı hatası 422 döner', () => {
    const h = new UygulamaHatasi('STOK_YETERSIZ');
    expect(h.httpDurum).toBe(422);
    expect(h.message).toBe('Stok yetersiz.');
  });

  it('kimlik/yetki hataları doğru HTTP kodunu alır', () => {
    expect(new UygulamaHatasi('KIMLIK_DOGRULANAMADI').httpDurum).toBe(401);
    expect(new UygulamaHatasi('YETKI_YOK').httpDurum).toBe(403);
    expect(new UygulamaHatasi('BULUNAMADI').httpDurum).toBe(404);
    expect(new UygulamaHatasi('CAKISMA').httpDurum).toBe(409);
    expect(new UygulamaHatasi('HIZ_LIMITI').httpDurum).toBe(429);
  });

  it('bilinmeyen hatayı sunucu hatasına normalize eder', () => {
    const h = hataNormalize(new Error('patladı'), 'iz_1');
    expect(h.kod).toBe('SUNUCU_HATASI');
    expect(h.izlemeId).toBe('iz_1');
    // Ham teknik mesaj kullanıcıya değil detaya gider
    expect(h.message).not.toContain('patladı');
    expect(h.detay?.ic_mesaj).toBe('patladı');
  });

  it('süreç sınırında serileştirilip geri canlandırılabilir', () => {
    const govde = hataSerilestir(new UygulamaHatasi('KREDI_LIMITI_ASILDI', undefined, { detay: { asim: 5000 } }), 'iz_2');
    const geri = hataCanlandir(govde);
    expect(geri.kod).toBe('KREDI_LIMITI_ASILDI');
    expect(geri.detay).toEqual({ asim: 5000 });
    expect(geri.izlemeId).toBe('iz_2');
  });
});

describe('şema doğrulaması', () => {
  it('boş sepetli satışı reddeder', () => {
    const s = zSatisGirdi.safeParse({ kalemler: [], odemeler: [{ tip: 'NAKIT', tutar: 0 }] });
    expect(s.success).toBe(false);
  });

  it('geçerli satış girdisini kabul eder', () => {
    const s = zSatisGirdi.safeParse({
      kalemler: [{ urun_id: uuid(), miktar: 1000, birim_fiyat: 1250 }],
      odemeler: [{ tip: 'NAKIT', tutar: 1250, alinan: 2000 }],
    });
    expect(s.success).toBe(true);
  });

  it('ondalıklı kuruş kabul etmez', () => {
    const s = zSatisGirdi.safeParse({
      kalemler: [{ urun_id: uuid(), miktar: 1000, birim_fiyat: 12.5 }],
      odemeler: [{ tip: 'NAKIT', tutar: 13 }],
    });
    expect(s.success).toBe(false);
  });

  it('ürün girdisinde varsayılanları uygular', () => {
    const s = zUrunGirdi.parse({ ad: 'Ekmek', satis_fiyati: 1000 });
    expect(s.birim_tipi).toBe('ADET');
    expect(s.kdv_orani).toBe(20);
    expect(s.aktif_mi).toBe(true);
    expect(s.barkodlar).toEqual([]);
  });

  it('adsız ürünü reddeder', () => {
    expect(zUrunGirdi.safeParse({ ad: '', satis_fiyati: 1000 }).success).toBe(false);
  });
});

describe('adet çarpanı ayrıştırma (§10.3)', () => {
  it('yıldız ve x biçimlerini tanır', () => {
    expect(carpanAyikla('3*8690000000001')).toEqual({ carpan: 3, kalan: '8690000000001' });
    expect(carpanAyikla('3x8690000000001')).toEqual({ carpan: 3, kalan: '8690000000001' });
    expect(carpanAyikla('3 X 8690000000001')).toEqual({ carpan: 3, kalan: '8690000000001' });
  });

  it('ürün adıyla da çalışır — barkodsuz ürün aranabilsin', () => {
    expect(carpanAyikla('2*domates')).toEqual({ carpan: 2, kalan: 'domates' });
  });

  it('çarpan yoksa metni olduğu gibi bırakır', () => {
    expect(carpanAyikla('8690000000001')).toEqual({ carpan: null, kalan: '8690000000001' });
    expect(carpanAyikla('domates')).toEqual({ carpan: null, kalan: 'domates' });
  });

  it('çıplak çarpan da geçerlidir — ürün sonra seçilir', () => {
    // "3*" yazıp Enter'lamak çarpanı kurar; kasiyer ürünü barkod okutarak ya da
    // hızlı ürün karesine basarak seçer.
    expect(carpanAyikla('3*')).toEqual({ carpan: 3, kalan: '' });
    expect(carpanAyikla('5x')).toEqual({ carpan: 5, kalan: '' });
    expect(carpanAyikla('2 * ')).toEqual({ carpan: 2, kalan: '' });
  });

  it('anlamsız çarpanı yok sayar', () => {
    // Sıfır adet eklemek istenmez.
    expect(carpanAyikla('0*8690')).toEqual({ carpan: null, kalan: '0*8690' });
    expect(carpanAyikla('0*')).toEqual({ carpan: null, kalan: '0*' });
  });

  it('barkodun içindeki x ile karışmaz', () => {
    // Çarpan yalnız BAŞTA ve rakamla gelir; ortadaki x barkodun parçasıdır.
    expect(carpanAyikla('ABC*123')).toEqual({ carpan: null, kalan: 'ABC*123' });
  });
});

describe('terazi barkodu (§10.1)', () => {
  /**
   * Terazi barkodu bir ürün kimliği DEĞİLDİR: her tartımda değişir, çünkü
   * içinde o tartımın ağırlığı ya da tutarı gömülüdür. Doğrudan aranırsa asla
   * bulunamaz ve reyonu olan markette o ürünler kasadan geçemez.
   */
  it('ağırlık taşıyan barkodu çözer', () => {
    // 28 + 12345 (ürün) + 01250 (1250 g) + kontrol hanesi
    const govde = '28' + '12345' + '01250';
    const barkod = govde + String(eanKontrolHanesi(govde));
    const sonuc = tartiliBarkodCoz(barkod);
    expect(sonuc).toEqual({ urunOneki: '2812345', tip: 'AGIRLIK', deger: 1250 });
  });

  it('tutar taşıyan barkodu çözer', () => {
    // 27 + 00042 (ürün) + 03750 (37,50 TL)
    const govde = '27' + '00042' + '03750';
    const barkod = govde + String(eanKontrolHanesi(govde));
    expect(tartiliBarkodCoz(barkod)).toEqual({ urunOneki: '2700042', tip: 'TUTAR', deger: 3750 });
  });

  it('ön ekler ayardan gelir', () => {
    const govde = '21' + '11111' + '00500';
    const barkod = govde + String(eanKontrolHanesi(govde));
    expect(tartiliBarkodCoz(barkod), 'varsayılan ön eklerde 21 yok').toBeNull();
    expect(tartiliBarkodCoz(barkod, { agirlikOnekleri: ['21'] })?.tip).toBe('AGIRLIK');
  });

  it('normal ürün barkodunu terazi barkodu sanmaz', () => {
    expect(tartiliBarkodCoz('8690504010128')).toBeNull();
    expect(tartiliBarkodCoz('1234567890')).toBeNull();
    expect(tartiliBarkodCoz('')).toBeNull();
  });

  /** Kontrol hanesi tutmuyorsa okuma hatalıdır; yanlış ağırlıkla satmaktansa çözmemek doğrudur. */
  it('kontrol hanesi hatalı barkodu reddeder', () => {
    const govde = '28' + '12345' + '01250';
    const dogru = eanKontrolHanesi(govde);
    const yanlis = (dogru + 1) % 10;
    expect(tartiliBarkodCoz(govde + String(yanlis))).toBeNull();
  });

  it('sıfır ağırlık kabul edilmez', () => {
    const govde = '28' + '12345' + '00000';
    expect(tartiliBarkodCoz(govde + String(eanKontrolHanesi(govde)))).toBeNull();
  });
});

describe('kısa kod / PLU (§10.1)', () => {
  /**
   * Markette ürünlerin çoğunun barkodu yoktur (manav, şarküteri, ekmek) ve
   * kasiyerin ad yazıp listeden seçmesi sıradaki müşteriyi bekletir. Kısa kod
   * ayrı bir alan değil, KISA BİR BARKODTUR — satış yolu hiç değişmez.
   */
  it('2-5 haneli sayıyı kısa kod sayar', () => {
    for (const kod of ['10', '24', '999', '1234', '99999']) expect(kisaKodMu(kod)).toBe(true);
  });

  /** Gerçek barkodlar en az 8 hanedir (EAN-8); karışma olmamalı. */
  it('gerçek barkodu kısa kod saymaz', () => {
    for (const barkod of ['8690504010128', '12345678', '2900000000032']) expect(kisaKodMu(barkod)).toBe(false);
  });

  it('harf içeren kodu kabul etmez', () => {
    expect(kisaKodMu('A24')).toBe(false);
    expect(kisaKodMu('')).toBe(false);
    expect(kisaKodMu(' 24 ')).toBe(true); // boşluk kırpılır
  });

  it('listedeki ilk kısa kodu bulur', () => {
    expect(kisaKodBul(['8690504010128', '24'])).toBe('24');
    expect(kisaKodBul(['8690504010128'])).toBeNull();
    expect(kisaKodBul([])).toBeNull();
  });

  /** Normalize kısa kodu bozmamalı: 12 haneye sıfır ekler, kısa koda dokunmaz. */
  it('normalize kısa kodu değiştirmez', () => {
    expect(barkodNormalize('24')).toBe('24');
    expect(barkodNormalize(' 1234 ')).toBe('1234');
  });
});

describe('birime göre miktar adımı (§10.3)', () => {
  /**
   * Sepetteki +/− adımı birime bağlıdır. KG'de 1 birimlik adım düzeltme değil
   * yeni bir hatadır: 350 gramlık peynire "+1 kg" eklemek kimsenin istediği
   * şey değildir. Bu testler adımın hangi birimde ne yapması gerektiğini
   * dayandığı kurala bağlar.
   */
  it('KG üründe 100 gramlık adım korunur', () => {
    expect(miktarBirimeUyarla(miktarOlustur(0.1), 'KG')).toBe(100);
    expect(miktarBirimeUyarla(miktarOlustur(0.35), 'KG')).toBe(350);
  });

  /** ADET'te 0,1'lik adım sıfıra yuvarlanır — bu yüzden adım birime duyarlı olmalı. */
  it('ADET üründe ondalık adım sıfıra yuvarlanır', () => {
    expect(miktarBirimeUyarla(miktarOlustur(0.1), 'ADET')).toBe(0);
    expect(miktarBirimeUyarla(adet(1), 'ADET')).toBe(1000);
  });

  it('KG üründe ondalık miktar bozulmadan durur', () => {
    for (const kg of [0.25, 1.5, 2.75, 12.345]) {
      expect(miktarBirimeUyarla(miktarOlustur(kg), 'KG')).toBe(Math.round(kg * 1000));
    }
  });
});
