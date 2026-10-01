/**
 * Satış akışı entegrasyon testleri — §25 kabul kriterleri.
 * Gerçek SQLite üzerinde, transaction bütünlüğü ve outbox dahil.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet, bugun, miktarOlustur, paraParse } from '@market/shared';
import { bakiyeOku } from '../src/main/depo/cari.js';
import { oturumHareketleri, oturumOzeti } from '../src/main/depo/kasa.js';
import { gunlukOzetTek } from '../src/main/depo/ozet.js';
import { bekleyenOlaylar, bekleyenSayisi } from '../src/main/depo/senkron.js';
import { hareketleriListele, stokOku } from '../src/main/depo/stok.js';
import { kalemleriGetir, satisBul, satislariListele } from '../src/main/depo/satis.js';
import { muhtelifUrunu } from '../src/main/servis/katalog-servis.js';
import { iadeYap, satisIptal, satisKesinlestir } from '../src/main/servis/satis-servis.js';
import { musteriEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

describe('satış kesinleştirme (§25 Satış kabul kriteri)', () => {
  it('stokta 5 adet varken 3 adet satılınca stok 2 olur ve kasaya tutar girer', () => {
    const urunId = urunEkle(ortam, { stok: adet(5), satisFiyati: 1000 });
    expect(stokOku(ortam.uygulama.vt, urunId)).toBe(adet(5));

    const sonuc = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(3), birim_fiyat: 1000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 3000, alinan: 5000 }],
    });

    expect(stokOku(ortam.uygulama.vt, urunId)).toBe(adet(2));
    expect(sonuc.genelToplam).toBe(3000);
    expect(sonuc.paraUstu).toBe(2000);
    // Nakit satış: tür harfi N + kasa serisi + sıra (NA-000001).
    expect(sonuc.fisNo).toMatch(/^N[A-Z]+-\d{6}$/);

    const ozet = oturumOzeti(ortam.uygulama.vt, ortam.admin.kasaOturumId as string);
    expect(ozet.satis_nakit).toBe(3000);
    expect(ozet.beklenen_nakit).toBe(10_000 + 3000);
  });

  it('tüm yazmalar tek transaction: satış + stok + kasa + outbox + özet', () => {
    const urunId = urunEkle(ortam, { stok: adet(10), satisFiyati: 1200, alisFiyati: 700 });
    const oncekiOlay = bekleyenSayisi(ortam.uygulama.vt);

    const sonuc = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(2), birim_fiyat: 1200 }],
      odemeler: [{ tip: 'NAKIT', tutar: 2400, alinan: 2400 }],
    });

    // Satış + kalemler
    const kalemler = kalemleriGetir(ortam.uygulama.vt, sonuc.satisId);
    expect(kalemler).toHaveLength(1);
    expect(kalemler[0]?.satir_toplam).toBe(2400);
    // Maliyet satış anında dondurulur
    expect(kalemler[0]?.birim_maliyet).toBe(700);

    // Stok hareketi negatif
    const hareketler = hareketleriListele(ortam.uygulama.vt, { belgeId: sonuc.satisId });
    expect(hareketler).toHaveLength(1);
    expect(hareketler[0]?.miktar).toBe(-adet(2));
    expect(hareketler[0]?.hareket_tipi).toBe('SATIS');

    // Kasa hareketi
    const kasa = oturumHareketleri(ortam.uygulama.vt, ortam.admin.kasaOturumId as string);
    expect(kasa.some((h) => h.tip === 'SATIS_NAKIT' && h.tutar === 2400)).toBe(true);

    // Outbox olayı
    expect(bekleyenSayisi(ortam.uygulama.vt)).toBeGreaterThan(oncekiOlay);
    const olaylar = bekleyenOlaylar(ortam.uygulama.vt, 100);
    const satisOlayi = olaylar.find((o) => o.olay_tipi === 'SATIS_YAPILDI' && o.entity_id === sonuc.satisId);
    expect(satisOlayi).toBeDefined();
    const olayVerisi = JSON.parse(satisOlayi?.veri ?? '{}');
    expect(olayVerisi.genel_toplam).toBe(2400);
    expect(olayVerisi.kalemler).toHaveLength(1);

    // Günlük özet
    const ozet = gunlukOzetTek(ortam.uygulama.vt, bugun());
    expect(ozet?.ciro).toBe(2400);
    expect(ozet?.islem_sayisi).toBe(1);
    expect(ozet?.nakit).toBe(2400);
    // Brüt kâr = matrah (2000) - maliyet (1400) = 600
    expect(ozet?.brut_kar).toBe(600);
  });

  it('hata durumunda hiçbir şey yazılmaz (atomiklik)', () => {
    const urunId = urunEkle(ortam, { stok: adet(10), satisFiyati: 1000 });
    const oncekiStok = stokOku(ortam.uygulama.vt, urunId);
    const oncekiOlay = bekleyenSayisi(ortam.uygulama.vt);
    const oncekiSatis = satislariListele(ortam.uygulama.vt).toplam;

    // İkinci kalemin ürünü yok → satış tamamen geri alınmalı.
    // (Stok yetersizliği artık HATA DEĞİL, uyarıdır; atomiklik başka bir iş
    // kuralı ihlaliyle sınanır ki test gerçek davranışı ölçsün.)
    expect(() =>
      satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
        kalemler: [
          { urun_id: urunId, miktar: adet(2), birim_fiyat: 1000 },
          { urun_id: '00000000-0000-4000-8000-000000000000', miktar: adet(1), birim_fiyat: 500 },
        ],
        odemeler: [{ tip: 'NAKIT', tutar: 2500, alinan: 2500 }],
      }),
    ).toThrow(/bulunamadı/i);

    // İlk kalemin stoğu düşmemiş, olay yazılmamış, satış oluşmamış olmalı.
    expect(stokOku(ortam.uygulama.vt, urunId)).toBe(oncekiStok);
    expect(bekleyenSayisi(ortam.uygulama.vt)).toBe(oncekiOlay);
    expect(satislariListele(ortam.uygulama.vt).toplam).toBe(oncekiSatis);
  });

  it('stok yetersizken satış ENGELLENMEZ, uyarı üretir ve stok eksiye düşer', () => {
    // Kasa, stok kaydı gerçeğin gerisinde kaldı diye durmamalı: sayım hatası ya
    // da geç girilen mal kabul yüzünden müşteri bekletilemez (§20).
    const urunId = urunEkle(ortam, { stok: adet(1), satisFiyati: 1000 });

    const sonuc = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(5), birim_fiyat: 1000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 5000, alinan: 5000 }],
    });

    expect(sonuc.genelToplam).toBe(5000);
    expect(sonuc.uyarilar.some((u) => /eksi/i.test(u))).toBe(true);
    expect(stokOku(ortam.uygulama.vt, urunId)).toBe(-adet(4));
  });

  it('ayar kapalıysa stok yetersizliği yine engellenebilir', () => {
    // "İzin ver" varsayılandır ama ayar hâlâ anlamlı olmalı: kapatan işletmede
    // satış, yetkili onayı olmadan geçmemeli.
    ortam.uygulama.vt.hazirla("UPDATE ayarlar SET deger = '0' WHERE anahtar = 'stok.negatif_izin'").calistir();

    const urunId = urunEkle(ortam, { stok: adet(1), satisFiyati: 1000 });
    expect(() =>
      satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
        kalemler: [{ urun_id: urunId, miktar: adet(5), birim_fiyat: 1000 }],
        odemeler: [{ tip: 'NAKIT', tutar: 5000, alinan: 5000 }],
      }),
    ).toThrow(/stok/i);

    // Onay verildiğinde geçer.
    const sonuc = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(5), birim_fiyat: 1000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 5000, alinan: 5000 }],
      negatif_stok_onaylandi: true,
    });
    expect(sonuc.genelToplam).toBe(5000);
  });

  it('eksik ödemeyi reddeder', () => {
    const urunId = urunEkle(ortam, { satisFiyati: 1000 });
    expect(() =>
      satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
        kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 1000 }],
        odemeler: [{ tip: 'NAKIT', tutar: 500, alinan: 500 }],
      }),
    ).toThrow();
  });

  it('parçalı ödemeyi kasa kırılımına doğru yansıtır', () => {
    const urunId = urunEkle(ortam, { satisFiyati: 10_000 });
    satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 10_000 }],
      odemeler: [
        { tip: 'KART', tutar: 6000 },
        { tip: 'NAKIT', tutar: 4000, alinan: 5000 },
      ],
    });

    const ozet = oturumOzeti(ortam.uygulama.vt, ortam.admin.kasaOturumId as string);
    expect(ozet.satis_kart).toBe(6000);
    expect(ozet.satis_nakit).toBe(4000);
    // Kart tutarı fiziksel nakdi etkilemez
    expect(ozet.beklenen_nakit).toBe(10_000 + 4000);
  });

  it('kg ürününde ondalık miktarı doğru hesaplar', () => {
    const urunId = urunEkle(ortam, { birimTipi: 'KG', satisFiyati: 4890, kdvOrani: 1, stok: miktarOlustur(50) });
    const sonuc = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: miktarOlustur(1.25), birim_fiyat: 4890 }],
      odemeler: [{ tip: 'NAKIT', tutar: 6113, alinan: 10_000 }],
    });
    expect(sonuc.genelToplam).toBe(6113);
    expect(stokOku(ortam.uygulama.vt, urunId)).toBe(miktarOlustur(48.75));
  });

  it('KDV dağılımı toplamı genel toplama eşittir', () => {
    const a = urunEkle(ortam, { ad: 'KDV20', satisFiyati: 1799, kdvOrani: 20 });
    const b = urunEkle(ortam, { ad: 'KDV1', satisFiyati: 899, kdvOrani: 1 });
    const sonuc = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [
        { urun_id: a, miktar: adet(2), birim_fiyat: 1799 },
        { urun_id: b, miktar: adet(3), birim_fiyat: 899 },
      ],
      odemeler: [{ tip: 'NAKIT', tutar: 6295, alinan: 10_000 }],
    });

    const kalemler = kalemleriGetir(ortam.uygulama.vt, sonuc.satisId);
    const toplam = kalemler.reduce((t, k) => t + k.satir_toplam, 0);
    expect(toplam).toBe(sonuc.genelToplam);
    const satis = satisBul(ortam.uygulama.vt, sonuc.satisId);
    const matrahToplam = kalemler.reduce((t, k) => t + (k.satir_toplam - k.kdv_tutar), 0);
    expect(matrahToplam + (satis?.kdv_toplam ?? 0)).toBe(sonuc.genelToplam);
  });

  it('kasa oturumu açık değilse satış yapılamaz', async () => {
    const kapaliOrtam = await testOrtamiKur({ kasaAc: false });
    try {
      const urunId = urunEkle(kapaliOrtam, { satisFiyati: 1000 });
      expect(() =>
        satisKesinlestir(kapaliOrtam.uygulama.baglam, kapaliOrtam.admin, {
          kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 1000 }],
          odemeler: [{ tip: 'NAKIT', tutar: 1000, alinan: 1000 }],
        }),
      ).toThrow(/kasa/i);
    } finally {
      await kapaliOrtam.temizle();
    }
  });

  it('yetkisiz kullanıcı fiyat değiştiremez — fiyat sunucuda düzeltilir', () => {
    const urunId = urunEkle(ortam, { satisFiyati: 1000 });
    // Kasiyer 500 kuruş göndermeye çalışıyor; sistem gerçek fiyatı uygular.
    const sonuc = satisKesinlestir(ortam.uygulama.baglam, ortam.kasiyer, {
      kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 500 }],
      odemeler: [{ tip: 'NAKIT', tutar: 1000, alinan: 1000 }],
    });
    expect(sonuc.genelToplam).toBe(1000);
  });

  it('kasiyer iskonto uygulayamaz', () => {
    const urunId = urunEkle(ortam, { satisFiyati: 1000 });
    expect(() =>
      satisKesinlestir(ortam.uygulama.baglam, ortam.kasiyer, {
        kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 1000, iskonto_yuzde: 10 }],
        odemeler: [{ tip: 'NAKIT', tutar: 900, alinan: 900 }],
      }),
    ).toThrow(/yetki/i);
  });
});

describe('veresiye ve kredi limiti (§25 Cari kabul kriteri)', () => {
  it('veresiye satış cari borç oluşturur', () => {
    const urunId = urunEkle(ortam, { satisFiyati: 30_000 });
    const musteriId = musteriEkle(ortam, 'Ali Veresiye');

    satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 30_000 }],
      odemeler: [{ tip: 'VERESIYE', tutar: 30_000 }],
      musteri_id: musteriId,
    });

    expect(bakiyeOku(ortam.uygulama.vt, musteriId)).toBe(30_000);
    // Veresiye kasaya nakit sokmaz
    const ozet = oturumOzeti(ortam.uygulama.vt, ortam.admin.kasaOturumId as string);
    expect(ozet.satis_nakit).toBe(0);
    expect(ozet.veresiye).toBe(30_000);
  });

  it('müşteri seçilmeden veresiye satış yapılamaz', () => {
    const urunId = urunEkle(ortam, { satisFiyati: 1000 });
    expect(() =>
      satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
        kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 1000 }],
        odemeler: [{ tip: 'VERESIYE', tutar: 1000 }],
      }),
    ).toThrow(/müşteri/i);
  });

  it('limiti 500₺ olan 450₺ borçlu müşteriye 100₺ veresiye uyarı üretir', () => {
    const urunId = urunEkle(ortam, { satisFiyati: 45_000 });
    const musteriId = musteriEkle(ortam, 'Limitli Müşteri', 50_000);

    // Önce 450 ₺ borç
    satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 45_000 }],
      odemeler: [{ tip: 'VERESIYE', tutar: 45_000 }],
      musteri_id: musteriId,
    });
    expect(bakiyeOku(ortam.uygulama.vt, musteriId)).toBe(45_000);

    // 100 ₺ daha → limit aşımı. Admin'in onay yetkisi var, uyarı ile geçer.
    const urun2 = urunEkle(ortam, { ad: 'Küçük', satisFiyati: 10_000 });
    const sonuc = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urun2, miktar: adet(1), birim_fiyat: 10_000 }],
      odemeler: [{ tip: 'VERESIYE', tutar: 10_000 }],
      musteri_id: musteriId,
    });
    expect(sonuc.uyarilar.some((u) => u.includes('Kredi limiti'))).toBe(true);
    expect(bakiyeOku(ortam.uygulama.vt, musteriId)).toBe(55_000);
  });

  it('limit aşımını onay yetkisi olmayan kasiyer geçemez', () => {
    const urunId = urunEkle(ortam, { satisFiyati: 60_000 });
    const musteriId = musteriEkle(ortam, 'Limitli', 50_000);
    expect(() =>
      satisKesinlestir(ortam.uygulama.baglam, ortam.kasiyer, {
        kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 60_000 }],
        odemeler: [{ tip: 'VERESIYE', tutar: 60_000 }],
        musteri_id: musteriId,
      }),
    ).toThrow(/limit/i);
    expect(bakiyeOku(ortam.uygulama.vt, musteriId)).toBe(0);
  });
});

describe('iade (§10.4)', () => {
  it('kısmi iade stok, kasa ve özeti doğru etkiler', () => {
    const urunId = urunEkle(ortam, { stok: adet(10), satisFiyati: 1000, alisFiyati: 600 });
    const satis = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(4), birim_fiyat: 1000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 4000, alinan: 4000 }],
    });
    expect(stokOku(ortam.uygulama.vt, urunId)).toBe(adet(6));

    const kalem = kalemleriGetir(ortam.uygulama.vt, satis.satisId)[0];
    const iade = iadeYap(ortam.uygulama.baglam, ortam.admin, {
      kaynak_satis_id: satis.satisId,
      kalemler: [{ satis_kalemi_id: kalem?.id as string, miktar: adet(1) }],
      iade_yontemi: 'NAKIT',
      neden: 'Müşteri beğenmedi',
    });

    // Mal geri geldi
    expect(stokOku(ortam.uygulama.vt, urunId)).toBe(adet(7));
    // İade satışı negatif tutarlıdır
    expect(iade.genelToplam).toBe(-1000);

    const ozet = oturumOzeti(ortam.uygulama.vt, ortam.admin.kasaOturumId as string);
    expect(ozet.beklenen_nakit).toBe(10_000 + 4000 - 1000);

    const gunluk = gunlukOzetTek(ortam.uygulama.vt, bugun());
    expect(gunluk?.iade_toplam).toBe(1000);
    expect(gunluk?.nakit).toBe(3000);
  });

  it('satılandan fazla iade edilemez', () => {
    const urunId = urunEkle(ortam, { satisFiyati: 1000 });
    const satis = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(2), birim_fiyat: 1000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 2000, alinan: 2000 }],
    });
    const kalem = kalemleriGetir(ortam.uygulama.vt, satis.satisId)[0];
    expect(() =>
      iadeYap(ortam.uygulama.baglam, ortam.admin, {
        kaynak_satis_id: satis.satisId,
        kalemler: [{ satis_kalemi_id: kalem?.id as string, miktar: adet(3) }],
        iade_yontemi: 'NAKIT',
        neden: 'test',
      }),
    ).toThrow(/iade edilebilir|aşamaz/i);
  });

  it('iki kısmi iade toplamı satılan miktarı aşamaz', () => {
    const urunId = urunEkle(ortam, { satisFiyati: 1000 });
    const satis = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(3), birim_fiyat: 1000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 3000, alinan: 3000 }],
    });
    const kalem = kalemleriGetir(ortam.uygulama.vt, satis.satisId)[0];

    iadeYap(ortam.uygulama.baglam, ortam.admin, {
      kaynak_satis_id: satis.satisId,
      kalemler: [{ satis_kalemi_id: kalem?.id as string, miktar: adet(2) }],
      iade_yontemi: 'NAKIT',
      neden: 'ilk iade',
    });

    expect(() =>
      iadeYap(ortam.uygulama.baglam, ortam.admin, {
        kaynak_satis_id: satis.satisId,
        kalemler: [{ satis_kalemi_id: kalem?.id as string, miktar: adet(2) }],
        iade_yontemi: 'NAKIT',
        neden: 'ikinci iade',
      }),
    ).toThrow();
  });

  it('veresiye satışın iadesi cari borcu azaltır', () => {
    const urunId = urunEkle(ortam, { satisFiyati: 5000 });
    const musteriId = musteriEkle(ortam, 'İade Müşterisi');
    const satis = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(2), birim_fiyat: 5000 }],
      odemeler: [{ tip: 'VERESIYE', tutar: 10_000 }],
      musteri_id: musteriId,
    });
    expect(bakiyeOku(ortam.uygulama.vt, musteriId)).toBe(10_000);

    const kalem = kalemleriGetir(ortam.uygulama.vt, satis.satisId)[0];
    iadeYap(ortam.uygulama.baglam, ortam.admin, {
      kaynak_satis_id: satis.satisId,
      kalemler: [{ satis_kalemi_id: kalem?.id as string, miktar: adet(1) }],
      iade_yontemi: 'VERESIYE',
      neden: 'iade',
    });
    expect(bakiyeOku(ortam.uygulama.vt, musteriId)).toBe(5000);
  });
});

describe('satış iptali (§10.3)', () => {
  it('iptal stoğu, kasayı ve özeti geri alır', () => {
    const urunId = urunEkle(ortam, { stok: adet(10), satisFiyati: 2000, alisFiyati: 1000 });
    const satis = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(3), birim_fiyat: 2000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 6000, alinan: 6000 }],
    });
    expect(stokOku(ortam.uygulama.vt, urunId)).toBe(adet(7));

    satisIptal(ortam.uygulama.baglam, ortam.admin, satis.satisId, 'Yanlış ürün okutuldu');

    expect(stokOku(ortam.uygulama.vt, urunId)).toBe(adet(10));
    expect(satisBul(ortam.uygulama.vt, satis.satisId)?.iptal_mi).toBe(true);

    const ozet = oturumOzeti(ortam.uygulama.vt, ortam.admin.kasaOturumId as string);
    expect(ozet.beklenen_nakit).toBe(10_000);

    const gunluk = gunlukOzetTek(ortam.uygulama.vt, bugun());
    expect(gunluk?.ciro).toBe(0);
    expect(gunluk?.islem_sayisi).toBe(0);
    expect(gunluk?.iptal_toplam).toBe(6000);
  });

  it('aynı satış iki kez iptal edilemez', () => {
    const urunId = urunEkle(ortam, { satisFiyati: 1000 });
    const satis = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 1000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 1000, alinan: 1000 }],
    });
    satisIptal(ortam.uygulama.baglam, ortam.admin, satis.satisId, 'ilk iptal');
    expect(() => satisIptal(ortam.uygulama.baglam, ortam.admin, satis.satisId, 'ikinci')).toThrow();
  });

  it('kasiyer satış iptal edemez', () => {
    const urunId = urunEkle(ortam, { satisFiyati: 1000 });
    const satis = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 1000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 1000, alinan: 1000 }],
    });
    expect(() => satisIptal(ortam.uygulama.baglam, ortam.kasiyer, satis.satisId, 'deneme')).toThrow(/yetki/i);
  });
});

describe('append-only güvencesi (§15.3)', () => {
  it('stok hareketi güncellenemez ve silinemez', () => {
    const urunId = urunEkle(ortam, { stok: adet(5) });
    const hareket = hareketleriListele(ortam.uygulama.vt, { urunId })[0];
    expect(hareket).toBeDefined();

    expect(() =>
      ortam.uygulama.vt.hazirla('UPDATE stok_hareketleri SET miktar = 999 WHERE id = ?').calistir(hareket?.id as string),
    ).toThrow(/append-only/i);

    expect(() => ortam.uygulama.vt.hazirla('DELETE FROM stok_hareketleri WHERE id = ?').calistir(hareket?.id as string)).toThrow(
      /append-only/i,
    );
  });

  it('stok özeti hareket toplamıyla her zaman uyumludur', () => {
    const urunId = urunEkle(ortam, { stok: adet(20), satisFiyati: 500 });
    for (let i = 0; i < 5; i++) {
      satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
        kalemler: [{ urun_id: urunId, miktar: adet(2), birim_fiyat: 500 }],
        odemeler: [{ tip: 'NAKIT', tutar: 1000, alinan: 1000 }],
      });
    }
    const ozet = stokOku(ortam.uygulama.vt, urunId);
    const gercek = ortam.uygulama.vt
      .hazirla('SELECT COALESCE(SUM(miktar),0) AS toplam FROM stok_hareketleri WHERE urun_id = ?')
      .tek<{ toplam: number }>(urunId);
    expect(ozet).toBe(gercek?.toplam);
    expect(ozet).toBe(adet(10));
  });
});

describe('para doğruluğu', () => {
  it('kuruş girdisi ile satış toplamı bire bir tutar', () => {
    const fiyat = paraParse('19,99');
    expect(fiyat).toBe(1999);
    const urunId = urunEkle(ortam, { satisFiyati: fiyat as number });
    const sonuc = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(3), birim_fiyat: fiyat as number }],
      odemeler: [{ tip: 'NAKIT', tutar: 5997, alinan: 10_000 }],
    });
    expect(sonuc.genelToplam).toBe(5997);
    expect(sonuc.paraUstu).toBe(4003);
  });
});

describe('muhtelif kalem (§10.3)', () => {
  it('kalemde ad verilirse fişe o ad yazılır, ürün kartının adı değil', () => {
    const muhtelifId = urunEkle(ortam, { ad: 'Muhtelif', satisFiyati: 0, stok: adet(0) });

    const sonuc = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: muhtelifId, miktar: adet(1), birim_fiyat: 2500, urun_adi: 'Kalem Pil' }],
      odemeler: [{ tip: 'NAKIT', tutar: 2500, alinan: 2500 }],
    });

    const kalemler = kalemleriGetir(ortam.uygulama.vt, sonuc.satisId);
    expect(kalemler[0]?.urun_adi).toBe('Kalem Pil');
  });

  it('ad verilmezse ürün kartındaki ad kullanılmaya devam eder', () => {
    const urunId = urunEkle(ortam, { ad: 'Ayçiçek Yağı', satisFiyati: 5000 });

    const sonuc = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 5000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 5000, alinan: 5000 }],
    });

    const kalemler = kalemleriGetir(ortam.uygulama.vt, sonuc.satisId);
    expect(kalemler[0]?.urun_adi).toBe('Ayçiçek Yağı');
  });

  it('muhtelif ürünü bir kez oluşturulur; sonraki çağrılar aynı kaydı döner', () => {
    const ilk = muhtelifUrunu(ortam.uygulama.baglam);
    const ikinci = muhtelifUrunu(ortam.uygulama.baglam);

    expect(ikinci.id).toBe(ilk.id);
    expect(ilk.ad).toBe('Muhtelif');

    const muhtelifler = ortam.uygulama.vt
      .hazirla("SELECT COUNT(*) AS adet FROM urunler WHERE ad = 'Muhtelif'")
      .tek<{ adet: number }>();
    expect(muhtelifler?.adet).toBe(1);
  });

  it('kasiyer muhtelif kalem satabilir: ürün kaydı katalog yetkisi istemez', () => {
    // Kasiyerde `urun.duzenle` yoktur; muhtelif kaydı yine de oluşabilmelidir.
    expect(ortam.kasiyer.yetkiler.has('urun.duzenle')).toBe(false);

    const muhtelif = muhtelifUrunu(ortam.uygulama.baglam);
    const sonuc = satisKesinlestir(ortam.uygulama.baglam, ortam.kasiyer, {
      kalemler: [{ urun_id: muhtelif.id, miktar: adet(1), birim_fiyat: 1500, urun_adi: 'Poşet' }],
      odemeler: [{ tip: 'NAKIT', tutar: 1500, alinan: 1500 }],
    });

    const kalemler = kalemleriGetir(ortam.uygulama.vt, sonuc.satisId);
    expect(kalemler[0]?.urun_adi).toBe('Poşet');
    expect(kalemler[0]?.birim_fiyat).toBe(1500);
  });
});

/*
 * Satışı yapanın ADI olayla buluta gider (§10.7). Kasa kullanıcısı bulutta her
 * zaman bulunmaz; yalnız kimlik gönderilince panelde "Kasiyer: —" görünüyordu.
 */
describe('satış olayında kasiyer adı', () => {
  const olayVerisi = (tip: string, entityId: string) =>
    JSON.parse(
      bekleyenOlaylar(ortam.uygulama.vt, 500).find((o) => o.olay_tipi === tip && o.entity_id === entityId)?.veri ?? '{}',
    ) as { kasiyer_adi?: string };

  it('satış ve iade olayı oturumdaki kişinin adını taşır', () => {
    const urunId = urunEkle(ortam, { satisFiyati: 1000, stok: adet(5) });
    const satis = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
      kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 1000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 1000 }],
    });
    expect(olayVerisi('SATIS_YAPILDI', satis.satisId).kasiyer_adi).toBe('Test Yönetici');

    const kalem = kalemleriGetir(ortam.uygulama.vt, satis.satisId)[0];
    const iade = iadeYap(ortam.uygulama.baglam, ortam.admin, {
      kaynak_satis_id: satis.satisId,
      kalemler: [{ satis_kalemi_id: kalem?.id as string, miktar: adet(1) }],
      iade_yontemi: 'NAKIT',
      neden: 'Müşteri beğenmedi',
    });
    expect(olayVerisi('IADE_YAPILDI', iade.satisId).kasiyer_adi).toBe('Test Yönetici');
  });
});

describe('fiş numarası ödeme türünü taşır', () => {
  it('nakit/kart/veresiye/karma/iade ayrı harf ve kendi sırasıyla numaralanır', () => {
    const urun = urunEkle(ortam, { satisFiyati: 1000, stok: adet(100) });
    const musteri = musteriEkle(ortam, 'Barış', 1_000_000);
    const sat = (odemeler: { tip: 'NAKIT' | 'KART' | 'VERESIYE'; tutar: number }[]) =>
      satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
        kalemler: [{ urun_id: urun, miktar: adet(odemeler.reduce((t, o) => t + o.tutar, 0) / 1000), birim_fiyat: 1000 }],
        odemeler,
        musteri_id: musteri,
        limit_asimi_onaylandi: true,
      });
    const seri = (no: string) => no.slice(1, no.indexOf('-'));

    const nakit = sat([{ tip: 'NAKIT', tutar: 1000 }]);
    const kart1 = sat([{ tip: 'KART', tutar: 1000 }]);
    const kart2 = sat([{ tip: 'KART', tutar: 1000 }]);
    const veresiye = sat([{ tip: 'VERESIYE', tutar: 1000 }]);
    const karma = sat([
      { tip: 'NAKIT', tutar: 1000 },
      { tip: 'KART', tutar: 1000 },
    ]);
    const kalem = kalemleriGetir(ortam.uygulama.vt, nakit.satisId)[0]!;
    const iade = iadeYap(ortam.uygulama.baglam, ortam.admin, {
      kaynak_satis_id: nakit.satisId,
      kalemler: [{ satis_kalemi_id: kalem.id, miktar: adet(1) }],
      iade_yontemi: 'NAKIT',
      neden: 'test',
    });

    const s = seri(nakit.fisNo);
    expect(nakit.fisNo).toBe(`N${s}-000001`);
    expect(kart1.fisNo).toBe(`K${s}-000001`);
    expect(kart2.fisNo).toBe(`K${s}-000002`);
    expect(veresiye.fisNo).toBe(`V${s}-000001`);
    expect(karma.fisNo).toBe(`P${s}-000001`);
    expect(iade.fisNo).toBe(`I${s}-000001`);
  });
});
