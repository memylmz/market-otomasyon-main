/**
 * Pavo N86 yazarkasa POS'u — satış, red, kayıp cevap, kurtarma, iptal, iade.
 *
 * NEDEN VAR: Pavo açıkken yasal fişi cihaz keser ve para hakkındaki tek doğru
 * kaynak cihazın cevabıdır. Buradaki her senaryo "müşteriden para alındı ama
 * kayıt yok" ya da "kayıt var ama para alınmadı" sonucunu engeller. Kurallar
 * Cybele kasasında sahada doğrulanmış olanlardır (bir satış = bir ödeme akışı,
 * askıya alma yok, kör tekrar yok).
 */

import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet, AYAR, bugun, gunEkle, PAVO_AYAR, type PavoRaporu, type PavoYaniti } from '@market/shared';
import { ayarOku, ayarYaz } from '../src/main/depo/ayar.js';
import { acikDefterKayitlari, defterYaz, pavoSatisiBul } from '../src/main/depo/pavo.js';
import { satisDetayi, satislariListele } from '../src/main/depo/satis.js';
import { PavoIstemci, PavoTasimaHatasi, adresCoz, yerelIso } from '../src/main/donanim/pavo-istemci.js';
import { kanallariOlustur } from '../src/main/ipc/kanallar.js';
import { defteriCoz, pavoBeklemeCarpani, pavoOdemedenVazgec, pavoTasiyiciDegistir } from '../src/main/servis/pavo-servis.js';
import { SahteCihaz } from './pavo-sahte-cihaz.js';
import { musteriEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;
let cihaz: SahteCihaz;
let kanallar: ReturnType<typeof kanallariOlustur>;

beforeEach(async () => {
  ortam = await testOrtamiKur();
  ortam.uygulama.aktoruAyarla(ortam.admin);
  ayarYaz(ortam.uygulama.vt, AYAR.POS_TURU, 'PAVO');
  cihaz = new SahteCihaz();
  pavoTasiyiciDegistir(cihaz);
  pavoBeklemeCarpani(0);
  kanallar = kanallariOlustur(ortam.uygulama);
});

afterEach(async () => {
  pavoTasiyiciDegistir(undefined);
  pavoBeklemeCarpani(1);
  await ortam.temizle();
});

type Sonuc = { satisId: string; fisNo: string; genelToplam: number; paraUstu: number };
const sat = (girdi: Record<string, unknown>) => kanallar['satis.kesinlestir']({ ...girdi, fis_yazdir: false }) as Promise<Sonuc>;
const satisSayisi = () => satislariListele(ortam.uygulama.vt, {}, {}).toplam;

function sepet(urunId: string, miktar = adet(1), fiyat = 1000) {
  return { kalemler: [{ urun_id: urunId, miktar, birim_fiyat: fiyat }] };
}

describe('satış', () => {
  it('nakit satış cihazdan geçer, kaydedilir ve cihazdaki karşılığı saklanır', async () => {
    const sut = urunEkle(ortam, { ad: 'Süt', satisFiyati: 3250, kdvOrani: 1 });
    const sonuc = await sat({ ...sepet(sut, adet(2), 3250), odemeler: [{ tip: 'NAKIT', tutar: 6500, alinan: 10000 }] });

    expect(sonuc.genelToplam).toBe(6500);
    expect(sonuc.paraUstu).toBe(3500);
    expect(cihaz.satislar).toHaveLength(1);
    expect(cihaz.satislar[0]).toMatchObject({ StatusId: 6, IsSuspendedSale: false });

    const kayit = pavoSatisiBul(ortam.uygulama.vt, sonuc.satisId)!;
    expect(kayit).toMatchObject({ satis_no: cihaz.satislar[0]!.SaleNumber, fatura_no: `GIB${cihaz.satislar[0]!.Id}` });
    expect(kayit.kalemler).toHaveLength(1);
    expect(acikDefterKayitlari(ortam.uygulama.vt)).toEqual([]);

    // Ödeme nakit aracısıyla, verilen parayla gitti (para üstünü cihaz da hesaplar).
    const odeme = cihaz.istekler.find((i) => i.yol === '/AddPaymentAndFinalizeSale')!;
    expect((odeme.g.input as { PaymentInformations: unknown[] }).PaymentInformations).toEqual([
      { Mediator: 1, Amount: 65, GivenAmount: 100 },
    ]);
  });

  it('parçalı ödemede KART ÖNCE gider; kart ödemesine Pavo satış numarası yazılır', async () => {
    const u = urunEkle(ortam, { satisFiyati: 5000 });
    const sonuc = await sat({
      ...sepet(u, adet(1), 5000),
      odemeler: [
        { tip: 'NAKIT', tutar: 2000, alinan: 2000 },
        { tip: 'KART', tutar: 3000 },
      ],
    });
    const araclar = cihaz.istekler
      .filter((i) => i.yol === '/AddPaymentAndFinalizeSale')
      .map((i) => (i.g.input as { PaymentInformations: { Mediator: number }[] }).PaymentInformations[0]!.Mediator);
    expect(araclar).toEqual([2, 1]);
    const kart = satisDetayi(ortam.uygulama.vt, sonuc.satisId)!.odemeler.find((o) => o.odeme_tipi === 'KART')!;
    expect(kart.pos_referans).toBe(cihaz.satislar[0]!.SaleNumber);
  });

  it('veresiye cihazda Açık Hesap olarak geçer — belge yine kesilir', async () => {
    const u = urunEkle(ortam, { satisFiyati: 1500 });
    const musteri = musteriEkle(ortam, 'Ahmet', 100_000);
    await sat({ ...sepet(u, adet(1), 1500), musteri_id: musteri, odemeler: [{ tip: 'VERESIYE', tutar: 1500 }] });
    const odeme = cihaz.istekler.find((i) => i.yol === '/AddPaymentAndFinalizeSale')!;
    expect((odeme.g.input as { PaymentInformations: { Mediator: number }[] }).PaymentInformations[0]!.Mediator).toBe(29);
    expect(cihaz.satislar[0]!.FinancialDocuments).toHaveLength(1);
  });

  it('kampanya iskontosu ve kilo ürün cihazın kuruş eşitliklerinden geçer', async () => {
    const domates = urunEkle(ortam, { ad: 'Domates', satisFiyati: 1990, birimTipi: 'KG' });
    const ayran = urunEkle(ortam, { ad: 'Ayran', satisFiyati: 1000, kdvOrani: 10 });
    const sonuc = await sat({
      kalemler: [
        { urun_id: domates, miktar: 2350, birim_fiyat: 1990 },
        { urun_id: ayran, miktar: adet(3), birim_fiyat: 1000, iskonto_tutar: 1000 },
      ],
      odemeler: [{ tip: 'NAKIT', tutar: 6677, alinan: 6677 }],
    });
    expect(sonuc.genelToplam).toBe(6677);
    const kalemler = cihaz.satislar[0]!.AddedSaleItems;
    expect(kalemler[0]).toMatchObject({ UnitCode: 'KGM', ItemQuantity: 2.35, GrossPriceAmount: 46.77 });
    expect(kalemler[1]).toMatchObject({ TotalPriceAmount: 20, PriceEffect: { Type: 1, Amount: 10 } });
  });

  it('tabloda olmayan KDV oranı cihaza hiçbir şey gitmeden durdurulur', async () => {
    const u = urunEkle(ortam, { satisFiyati: 1000, kdvOrani: 18 });
    await expect(sat({ ...sepet(u), odemeler: [{ tip: 'NAKIT', tutar: 1000 }] })).rejects.toThrow(/Pavo vergi gruplarında yok/);
    expect(cihaz.istekler.filter((i) => i.yol === '/StartSaleWithItems')).toHaveLength(0);
    expect(satisSayisi()).toBe(0);
  });

  it('kasa doğrulaması (ör. kredi limiti) cihaza bir şey gitmeden yakalanır', async () => {
    const u = urunEkle(ortam, { satisFiyati: 50_000 });
    const musteri = musteriEkle(ortam, 'Limitli', 1000);
    // Yönetici limit aşımını onaylayabilir; kasiyer onaylayamaz.
    ortam.uygulama.aktoruAyarla(ortam.kasiyer);
    await expect(
      sat({ ...sepet(u, adet(1), 50_000), musteri_id: musteri, odemeler: [{ tip: 'VERESIYE', tutar: 50_000 }] }),
    ).rejects.toThrow();
    expect(cihaz.istekler).toHaveLength(0);
  });
});

describe('red ve vazgeç — satış ya tamamen ödenir ya cihazdan silinir', () => {
  it('kart reddedilirse satış cihazdan da silinir, kayıt yazılmaz, askıda satış kalmaz', async () => {
    const u = urunEkle(ortam, { satisFiyati: 2000 });
    cihaz.kartReddet = true;
    await expect(sat({ ...sepet(u, adet(1), 2000), odemeler: [{ tip: 'KART', tutar: 2000 }] })).rejects.toThrow(
      /Satış Pavo'dan silindi; müşteriden para alınmadı/,
    );
    expect(satisSayisi()).toBe(0);
    expect(cihaz.satislar[0]).toMatchObject({ StatusId: 7, IsSuspendedSale: false });
    expect(acikDefterKayitlari(ortam.uygulama.vt)).toEqual([]);

    // Askıda satış kalmadığı için sıradaki satış açılabilir (hata 30 yok).
    await sat({ ...sepet(u, adet(1), 2000), odemeler: [{ tip: 'KART', tutar: 2000 }] });
    expect(satisSayisi()).toBe(1);
  });

  it('nakit + kart: kart reddinde alınan nakit de iade edilir (satış silinir)', async () => {
    const u = urunEkle(ortam, { satisFiyati: 3000 });
    cihaz.kartReddet = true;
    await expect(
      sat({
        ...sepet(u, adet(1), 3000),
        odemeler: [
          { tip: 'NAKIT', tutar: 1000 },
          { tip: 'KART', tutar: 2000 },
        ],
      }),
    ).rejects.toThrow();
    // Kart önce gittiği için nakit hiç alınmadı.
    expect(cihaz.satislar[0]!.AddedPayments.filter((o) => o.StatusId === 2)).toEqual([]);
    expect(cihaz.satislar[0]!.StatusId).toBe(7);
  });

  it('kasiyer kart beklerken vazgeçerse satış silinir ve "vazgeçildi" denir', async () => {
    const u = urunEkle(ortam, { satisFiyati: 2500 });
    cihaz.kartBeklemeMs = 2_000;
    const satis = sat({ ...sepet(u, adet(1), 2500), odemeler: [{ tip: 'KART', tutar: 2500 }] });
    await new Promise((r) => setTimeout(r, 100));
    expect(await pavoOdemedenVazgec(ortam.uygulama.baglam)).toEqual({ gonderildi: true });
    await expect(satis).rejects.toThrow(/Ödemeden vazgeçildi/);
    // Vazgeç sırayı atlayarak gitti.
    expect(cihaz.istekler.find((i) => i.yol === '/AbortCurrentPayment')!.g.siraAtla).toBe(true);
    expect(cihaz.satislar[0]!.StatusId).toBe(7);
    expect(satisSayisi()).toBe(0);
  });

  it('süren satış yokken vazgeç bir şey göndermez', async () => {
    expect(await pavoOdemedenVazgec(ortam.uygulama.baglam)).toEqual({ gonderildi: false });
  });
});

describe('kayıp cevap — kör tekrar yok, önce cihaza sorulur', () => {
  it('ödeme cevabı kaybolsa da cihaz tahsil ettiyse satış BİR KEZ kaydedilir', async () => {
    const u = urunEkle(ortam, { satisFiyati: 4000 });
    cihaz.cevapKaybet = '/AddPaymentAndFinalizeSale';
    const sonuc = await sat({ ...sepet(u, adet(1), 4000), odemeler: [{ tip: 'KART', tutar: 4000 }] });
    expect(sonuc.genelToplam).toBe(4000);
    expect(cihaz.istekler.filter((i) => i.yol === '/AddPaymentAndFinalizeSale')).toHaveLength(1);
    expect(satisSayisi()).toBe(1);
  });

  it('satış başlatma cevabı kaybolsa da cihaz satışı açtıysa aynı satışla devam edilir', async () => {
    const u = urunEkle(ortam, { satisFiyati: 1000 });
    cihaz.cevapKaybet = '/StartSaleWithItems';
    await sat({ ...sepet(u), odemeler: [{ tip: 'NAKIT', tutar: 1000 }] });
    expect(cihaz.satislar).toHaveLength(1);
    expect(satisSayisi()).toBe(1);
  });
});

describe('kurtarma — parası alınmış satış kaybolmaz', () => {
  function yarimSatis(u: string, odendi: boolean) {
    // Program cihaza satışı gönderdi ve öldü: defter açık, kayıt yok.
    const siparis = 'S-KAZA-1';
    const girdi = { ...sepet(u, adet(1), 1200), odemeler: [{ tip: 'NAKIT', tutar: 1200, alinan: 1200 }] };
    defterYaz(ortam.uygulama.vt, {
      siparis_no: siparis,
      tutar: 1200,
      ozet: 'Test — NAKIT',
      girdi: JSON.stringify(girdi),
      kullanici_id: null,
    });
    cihaz.satislar.push({
      Id: 1,
      SaleNumber: 'SN-KAZA',
      OrderNo: siparis,
      StatusId: odendi ? 6 : 1,
      IsSuspendedSale: !odendi,
      GrossPrice: 12,
      TotalPrice: 12,
      RemainingPaymentAmount: odendi ? 0 : 12,
      AddedSaleItems: [{ Id: 10, Name: 'Test', TotalPriceAmount: 12 }],
      AddedPayments: odendi ? [{ StatusId: 2, PaymentAmount: 12, PaymentTypeId: 1 }] : [],
      FinancialDocuments: odendi ? [{ InvoiceNo: 'GIB-KAZA' }] : [],
    });
  }

  it('cihazda tamamlanmış satış defterdeki girdiden oluşturulur', async () => {
    const u = urunEkle(ortam, { satisFiyati: 1200 });
    yarimSatis(u, true);
    const sonuc = await defteriCoz(ortam.uygulama.baglam, ortam.admin);
    expect(sonuc.olusturulan).toHaveLength(1);
    expect(sonuc.kalan).toEqual([]);
    expect(satisSayisi()).toBe(1);
  });

  it('askıda kalmış (yarım) satış cihazdan silinir — askı yok', async () => {
    const u = urunEkle(ortam, { satisFiyati: 1200 });
    yarimSatis(u, false);
    const sonuc = await defteriCoz(ortam.uygulama.baglam, ortam.admin);
    expect(sonuc.silinen).toHaveLength(1);
    expect(cihaz.satislar[0]!.StatusId).toBe(7);
    expect(satisSayisi()).toBe(0);
  });

  it('cihaza hiç ulaşmamış satışın kaydı kapatılır', async () => {
    defterYaz(ortam.uygulama.vt, { siparis_no: 'S-YOK', tutar: 1, ozet: 'x', girdi: '{}', kullanici_id: null });
    expect((await defteriCoz(ortam.uygulama.baglam, ortam.admin)).kalan).toEqual([]);
  });

  it('akıbet öğrenilemezse (cihaz kapalı) kayıt açık kalır ve YENİ SATIŞ AÇILMAZ', async () => {
    const u = urunEkle(ortam, { satisFiyati: 1200 });
    yarimSatis(u, true);
    cihaz.kapali = true;
    await expect(sat({ ...sepet(u, adet(1), 1200), odemeler: [{ tip: 'NAKIT', tutar: 1200 }] })).rejects.toThrow(
      /durumu belirsiz/,
    );
    expect(acikDefterKayitlari(ortam.uygulama.vt)).toHaveLength(1);

    // Cihaz geri gelince sıradaki satıştan önce kendiliğinden çözülür.
    cihaz.kapali = false;
    await sat({ ...sepet(u, adet(1), 1200), odemeler: [{ tip: 'NAKIT', tutar: 1200 }] });
    expect(satisSayisi()).toBe(2);
  });
});

describe('iptal ve iade', () => {
  it('satış iptali cihazda iptal edilir (ödendiği gibi iade), sonra kaydedilir', async () => {
    const u = urunEkle(ortam, { satisFiyati: 2000 });
    const sonuc = await sat({ ...sepet(u, adet(1), 2000), odemeler: [{ tip: 'KART', tutar: 2000 }] });
    await kanallar['satis.iptal']({ satisId: sonuc.satisId, neden: 'Müşteri vazgeçti', paraYolu: 'NAKIT' });
    expect(cihaz.satislar[0]!.StatusId).toBe(13);
    expect(satisDetayi(ortam.uygulama.vt, sonuc.satisId)!.satis.iptal_mi).toBe(true);
  });

  it('kısmi iade cihaza orijinal kalem kimliğiyle gider', async () => {
    const a = urunEkle(ortam, { ad: 'A', satisFiyati: 1000 });
    const b = urunEkle(ortam, { ad: 'B', satisFiyati: 3000 });
    const sonuc = await sat({
      kalemler: [
        { urun_id: a, miktar: adet(2), birim_fiyat: 1000 },
        { urun_id: b, miktar: adet(1), birim_fiyat: 3000 },
      ],
      odemeler: [{ tip: 'NAKIT', tutar: 5000 }],
    });
    const kalemB = satisDetayi(ortam.uygulama.vt, sonuc.satisId)!.kalemler.find((k) => k.urun_adi === 'B')!;
    await kanallar['satis.iade']({
      kaynak_satis_id: sonuc.satisId,
      kalemler: [{ satis_kalemi_id: kalemB.id, miktar: adet(1) }],
      iade_yontemi: 'NAKIT',
      neden: 'Bozuk',
    });
    const istek = cihaz.istekler.find((i) => i.yol === '/PartialReturn')!.g.input as {
      RelatedSaleId: number;
      AddedSaleItems: { RelatedSaleItemId: number; ReturnAmount: number }[];
      PaymentInformations: { Mediator: number; Amount: number }[];
    };
    const orijinal = cihaz.satislar[0]!;
    expect(istek.RelatedSaleId).toBe(orijinal.Id);
    expect(istek.AddedSaleItems).toEqual([
      expect.objectContaining({ RelatedSaleItemId: orijinal.AddedSaleItems[1]!.Id, ReturnAmount: 30 }),
    ]);
    expect(istek.PaymentInformations).toEqual([{ Mediator: 1, Amount: 30, GivenAmount: 30 }]);
    expect(satisSayisi()).toBe(2);
  });

  it("Pavo öncesi satışın karta iadesi Pavo'dan yapılamaz, nakit yapılır", async () => {
    ayarYaz(ortam.uygulama.vt, AYAR.POS_TURU, 'KAPALI');
    const u = urunEkle(ortam, { satisFiyati: 1000 });
    const sonuc = await sat({ ...sepet(u), odemeler: [{ tip: 'KART', tutar: 1000 }] });
    ayarYaz(ortam.uygulama.vt, AYAR.POS_TURU, 'PAVO');
    const kalem = satisDetayi(ortam.uygulama.vt, sonuc.satisId)!.kalemler[0]!;
    const iade = (yontem: string) =>
      kanallar['satis.iade']({
        kaynak_satis_id: sonuc.satisId,
        kalemler: [{ satis_kalemi_id: kalem.id, miktar: adet(1) }],
        iade_yontemi: yontem,
        neden: 'x',
      });
    await expect(iade('KART')).rejects.toThrow(/Pavo'dan geçmemiş/);
    await iade('NAKIT');
    expect(cihaz.istekler).toHaveLength(0);
  });
});

describe('bakım', () => {
  it('askıdakiler: boş liste hata değildir; listedeki satış silinebilir', async () => {
    expect(await kanallar['pavo.askidakiler']()).toEqual([]);
    cihaz.satislar.push({
      Id: 9,
      SaleNumber: 'SN9',
      OrderNo: 'O9',
      StatusId: 1,
      IsSuspendedSale: true,
      GrossPrice: 5,
      TotalPrice: 5,
      RemainingPaymentAmount: 5,
      AddedSaleItems: [],
      AddedPayments: [],
      FinancialDocuments: [],
    });
    expect(await kanallar['pavo.askidakiler']()).toEqual([
      { satisNo: 'SN9', siparisNo: 'O9', toplam: 500, kalan: 500, durum: 1 },
    ]);
    expect(await kanallar['pavo.askidakiniSil']({ satisNo: 'SN9' })).toEqual({ silindi: true });
  });

  it('banka gün sonu', async () => {
    expect(await kanallar['pavo.bankaGunSonu']()).toEqual({ basarili: true, ayrintilar: ['Araç 2: başarılı'] });
  });

  it("eşleştirme seri numarası ister, başarıda sırayı 1'e çeker", async () => {
    await expect(kanallar['pavo.esles']()).rejects.toThrow(/seri numarasını/);
    ayarYaz(ortam.uygulama.vt, PAVO_AYAR.SERI_NO, 'PAVSAHTE01');
    ayarYaz(ortam.uygulama.vt, PAVO_AYAR.SON_SIRA, '57');
    expect(await kanallar['pavo.esles']()).toEqual({ seriNo: 'PAVSAHTE01' });
    expect(ayarOku(ortam.uygulama.vt, PAVO_AYAR.SON_SIRA)).toBe('1');
  });

  it('bağlantı testi ve POS durumu', async () => {
    expect(await kanallar['pos.test']()).toEqual({ basarili: true, mesaj: 'Pavo bağlı ve eşleşmiş.' });
    expect(kanallar['pos.durum']()).toMatchObject({ aktif: true, tur: 'PAVO' });
    cihaz.kapali = true;
    expect(await kanallar['pos.test']()).toMatchObject({ basarili: false });
  });

  it('ayarlar ekranı sıra numarasını ve parmak izini EZEMEZ (bayat kopya cihazın sırasını bozardı)', () => {
    ayarYaz(ortam.uygulama.vt, PAVO_AYAR.SON_SIRA, '42');
    kanallar['ayar.yaz']({
      degerler: { [PAVO_AYAR.SON_SIRA]: '3', [PAVO_AYAR.PARMAK_IZI]: 'baska', [PAVO_AYAR.SERI_NO]: 'YENI' },
    });
    expect(ayarOku(ortam.uygulama.vt, PAVO_AYAR.SON_SIRA)).toBe('42');
    expect(ayarOku(ortam.uygulama.vt, PAVO_AYAR.PARMAK_IZI)).toBeNull();
    expect(ayarOku(ortam.uygulama.vt, PAVO_AYAR.SERI_NO)).toBe('YENI');
  });

  it('Pavo açıkken kartla cari tahsilat açıkça reddedilir', async () => {
    const musteri = musteriEkle(ortam, 'Borçlu');
    await expect(kanallar['cari.tahsilat']({ cari_id: musteri, tutar: 1000, odeme_tipi: 'KART' })).rejects.toThrow(
      /henüz desteklenmiyor/,
    );
  });
});

// ---------------------------------------------------------------------------
// HTTP istemcisi (gerçek soket)
// ---------------------------------------------------------------------------

describe('mali raporlar', () => {
  type Rapor = PavoRaporu;
  const istekGovdesi = (yol: string) => cihaz.istekler.filter((i) => i.yol === yol).map((i) => i.g.ust ?? i.g.input);

  it('gün sonu T raporuyla alınır; Z numarası arşiv satırından tamamlanır', async () => {
    const { rapor, banka } = (await kanallar['pavo.gunSonu']({})) as { rapor: Rapor; banka: unknown };
    expect(banka).toBeNull();
    // ZReport DEĞİL: sahada gün sonunu kapatan T.
    expect(istekGovdesi('/CreateReportWithSummaries')).toEqual([{ ReportType: 'T' }]);
    expect(cihaz.istekler.some((i) => i.yol === '/PerformBatchEod')).toBe(false);
    expect(rapor).toMatchObject({
      raporId: 12001,
      tur: 'GUN_SONU',
      zNo: 7,
      satisAdedi: 3,
      satisTutari: 12345,
      iptalAdedi: 1,
      iptalTutari: 1000,
      olusturma: '2026-10-29T23:01:00',
      ilkIslem: '2026-10-29T08:30:00',
    });
    expect(rapor.odemeler).toEqual([
      { ad: 'Nakit (TL)', adet: 2, tutar: 8345, iptalAdedi: 1, iptalTutari: 1000, net: 7345 },
      { ad: 'Kredi Kartı', adet: 1, tutar: 4000, iptalAdedi: 0, iptalTutari: 0, net: 4000 },
    ]);
    expect(rapor.urunler).toEqual([{ ad: 'Süt', miktar: 2.5, tutar: 6000 }]);
  });

  it('istenirse önce banka gün sonu alınır; banka başarısızsa Z ALINMAZ', async () => {
    const { banka } = (await kanallar['pavo.gunSonu']({ bankaGunSonu: true })) as { banka: unknown };
    expect(banka).toEqual({ basarili: true, ayrintilar: ['Araç 2: başarılı'] });
    expect(cihaz.istekler.map((i) => i.yol).filter((y) => y !== '/ListReports')).toEqual([
      '/PerformBatchEod',
      '/CreateReportWithSummaries',
    ]);

    cihaz.istekler = [];
    cihaz.bankaBasarisiz = true;
    await expect(kanallar['pavo.gunSonu']({ bankaGunSonu: true })).rejects.toThrow(/ALINMADI[\s\S]*Banka cevap vermedi/);
    expect(cihaz.istekler.some((i) => i.yol === '/CreateReportWithSummaries')).toBe(false);
  });

  it('kasiyer kasayı kapatan kişidir: X ve gün sonu alır; geçmiş raporlar müdürün', async () => {
    ortam.uygulama.aktoruAyarla(ortam.kasiyer);
    await kanallar['pavo.xRaporu']({});
    await kanallar['pavo.gunSonu']({});
    cihaz.istekler = [];
    await expect(kanallar['pavo.donemRaporu']({ baslangic: bugun(), bitis: bugun() })).rejects.toThrow();
    await expect(kanallar['pavo.raporArsivi']({ baslangic: bugun(), bitis: bugun() })).rejects.toThrow();
    await expect(kanallar['pavo.raporNushasi']({ raporId: 12001 })).rejects.toThrow();
    expect(cihaz.istekler).toEqual([]);
  });

  it('cihaz 175 ile başka girdi anahtarı isterse ipucuyla bir kez daha denenir', async () => {
    cihaz.raporAnahtariIste = true;
    const { rapor } = (await kanallar['pavo.gunSonu']({})) as { rapor: Rapor };
    expect(rapor.raporId).toBe(12001);
    const denemeler = cihaz.istekler.filter((i) => i.yol === '/CreateReportWithSummaries');
    expect(denemeler.map((d) => [d.g.inputKey ?? null, d.g.input ?? d.g.ust])).toEqual([
      [null, { ReportType: 'T' }],
      ['Report', { ReportType: 'T' }],
    ]);
  });

  it('X raporu: günü kapatmaz, Türkçe biçimli tutarlar doğru okunur, görünmeyen alan "bilinmiyor" kalır', async () => {
    const r = (await kanallar['pavo.xRaporu']({})) as Rapor;
    expect(istekGovdesi('/QueryReport')).toEqual([{ ReportData: { ReportType: 'XReport', PrintReport: true } }]);
    expect(cihaz.istekler.some((i) => i.yol === '/CreateReportWithSummaries')).toBe(false);
    expect(r).toMatchObject({
      tur: 'X',
      raporId: 12002,
      nakit: 123450,
      kart: null,
      genelToplam: 123450,
      kdvMatrahi: 122228,
      kdvToplami: 1222,
      satisAdedi: 4,
      satisTutari: 123450,
      iptalTutari: 0,
      olusturma: '2026-10-29T13:03:00',
    });
    expect(r.kdvler).toEqual([{ oran: '%1', matrah: 122228, kdv: 1222 }]);

    await kanallar['pavo.xRaporu']({ fark: true });
    expect(istekGovdesi('/QueryReport')[1]).toEqual({ ReportData: { ReportType: 'XDiffReport', PrintReport: true } });
  });

  it('dönem raporu: tarih aralığıyla sorulur, 12 aydan eski ve ileri tarih reddedilir', async () => {
    const bugunk = bugun();
    const r = (await kanallar['pavo.donemRaporu']({ baslangic: gunEkle(bugunk, -20), bitis: bugunk, bastir: true })) as Rapor;
    expect(r.tur).toBe('DONEM');
    expect(istekGovdesi('/QueryReport')).toEqual([
      {
        ReportData: {
          ReportType: 'TeminalDateRangeSaleReport',
          StartDate: gunEkle(bugunk, -20),
          EndDate: bugunk,
          PrintReport: true,
        },
      },
    ]);
    await expect(kanallar['pavo.donemRaporu']({ baslangic: gunEkle(bugunk, -400), bitis: bugunk })).rejects.toThrow(/12 ay/);
    await expect(kanallar['pavo.donemRaporu']({ baslangic: bugunk, bitis: gunEkle(bugunk, 1) })).rejects.toThrow(/ileri/);
    await expect(kanallar['pavo.donemRaporu']({ baslangic: bugunk, bitis: gunEkle(bugunk, -1) })).rejects.toThrow(/önce/);
    expect(cihaz.istekler).toHaveLength(1);
  });

  it('geçmiş gün sonu: o gün rapor yoksa null döner (hata değil)', async () => {
    const r = (await kanallar['pavo.gecmisGunSonu']({ tarih: '2026-03-02' })) as Rapor;
    expect(r.tur).toBe('GUN_SONU');
    expect(istekGovdesi('/QueryReport')).toEqual([
      { ReportData: { ReportType: 'ZReportWithDateTime', ReportDate: '2026-03-02', PrintReport: false } },
    ]);
    expect(await kanallar['pavo.gecmisGunSonu']({ tarih: '2026-01-01' })).toBeNull();
    await expect(kanallar['pavo.gecmisGunSonu']({ tarih: '02.03.2026' })).rejects.toThrow(/geçerli/);
  });

  it('arşiv: tekrar eden satır teklenir, en yeni üstte; 31 günden geniş aralık reddedilir', async () => {
    const bugunk = bugun();
    const liste = (await kanallar['pavo.raporArsivi']({ baslangic: gunEkle(bugunk, -7), bitis: bugunk })) as Rapor[];
    expect(liste.map((r) => [r.raporId, r.tur, r.zNo])).toEqual([
      [12001, 'GUN_SONU', 7],
      [11990, 'XFARK', null],
    ]);
    await expect(kanallar['pavo.raporArsivi']({ baslangic: gunEkle(bugunk, -40), bitis: bugunk })).rejects.toThrow(/31/);
  });

  it('rapor özeti ve nüsha; olmayan rapor null', async () => {
    const r = (await kanallar['pavo.raporOzeti']({ raporId: 12001 })) as Rapor;
    expect(r).toMatchObject({ raporId: 12001, zNo: null, satisTutari: 12345 });
    expect(await kanallar['pavo.raporOzeti']({ raporId: 5 })).toBeNull();
    expect(await kanallar['pavo.raporNushasi']({ raporId: 12001 })).toEqual({ basildi: true });
    expect(istekGovdesi('/PrintReport')).toEqual([{ ReportId: 12001 }]);
    await expect(kanallar['pavo.raporNushasi']({ raporId: 0 })).rejects.toThrow(/Geçersiz/);
  });
});

describe('istemci', () => {
  let sunucu: Server;
  let port = 0;
  let cevaplar: ((govde: Record<string, unknown>) => unknown)[] = [];
  let gelenler: Record<string, unknown>[] = [];
  const sira = { deger: 10, sertifika: '' };

  beforeEach(async () => {
    cevaplar = [];
    gelenler = [];
    sira.deger = 10;
    sunucu = createServer((istek, cevap) => {
      let veri = '';
      istek.on('data', (p) => (veri += p));
      istek.on('end', () => {
        const govde = JSON.parse(veri) as Record<string, unknown>;
        gelenler.push(govde);
        const uret = cevaplar.shift();
        const sonuc = uret ? uret(govde) : { HasError: false, Data: {} };
        if (sonuc === 'ASILI') return; // hiç cevap verme
        cevap.setHeader('Content-Type', 'application/json');
        cevap.end(typeof sonuc === 'string' ? sonuc : JSON.stringify(sonuc));
      });
    });
    await new Promise<void>((r) => sunucu.listen(0, '127.0.0.1', () => r()));
    port = (sunucu.address() as { port: number }).port;
  });

  afterEach(async () => {
    sunucu.closeAllConnections();
    await new Promise((r) => sunucu.close(r));
  });

  const istemci = (adres = `127.0.0.1:${port}`) =>
    new PavoIstemci(() => ({ adres, https: false, seriNo: 'PAV1', parmakIzi: 'pi', sertifika: '' }), {
      sonSira: () => sira.deger,
      sonSiraYaz: (n) => (sira.deger = n),
      sertifikaYaz: (o) => (sira.sertifika = o),
    });

  it('sıra numarası istekten ÖNCE yazılır; kimlik alanları gövdede', async () => {
    const y = await istemci().gonder('/GetSaleResult', { input: { OrderNo: 'X' }, zamanAsimiMs: 2_000 });
    expect(y.hata).toBe(false);
    expect(sira.deger).toBe(11);
    expect(gelenler[0]).toMatchObject({
      TransactionHandle: { SerialNumber: 'PAV1', Fingerprint: 'pi', TransactionSequence: 11 },
      Sale: { OrderNo: 'X' },
    });
  });

  it("hata 73'te +1 ile tekrar dener (doküman algoritması)", async () => {
    cevaplar = [() => ({ HasError: true, ErrorCode: 73 }), () => ({ HasError: false, Data: { ok: 1 } })];
    const y = await istemci().gonder('/X', { zamanAsimiMs: 2_000 });
    expect(y.veri).toEqual({ ok: 1 });
    expect(gelenler.map((g) => (g.TransactionHandle as { TransactionSequence: number }).TransactionSequence)).toEqual([11, 12]);
  });

  it('Ping sıra tüketmez; Pairing hep 1 ile gider', async () => {
    await istemci().gonder('/Ping', { zamanAsimiMs: 2_000, muaf: true });
    await istemci().gonder('/Pairing', { zamanAsimiMs: 2_000, muaf: true, sabitSira: 1 });
    expect(sira.deger).toBe(10);
    expect((gelenler[1]!.TransactionHandle as { TransactionSequence: number }).TransactionSequence).toBe(1);
  });

  it('üst seviye alanlar kimlik alanlarını ezemez', async () => {
    await istemci().gonder('/R', { ust: { ReportType: 'T', TransactionHandle: 'ezme' }, zamanAsimiMs: 2_000 });
    expect(gelenler[0]).toMatchObject({ ReportType: 'T', TransactionHandle: { SerialNumber: 'PAV1' } });
  });

  it('bağlanılamazsa "işlenmemiş"; gönderildikten sonra zaman aşımında "işlenmiş olabilir"', async () => {
    const kapali = istemci('127.0.0.1:1');
    await expect(kapali.gonder('/X', { zamanAsimiMs: 2_000 })).rejects.toMatchObject({ islenmisOlabilir: false });

    cevaplar = [() => 'ASILI'];
    const hata = await istemci()
      .gonder('/X', { zamanAsimiMs: 300 })
      .catch((h: unknown) => h);
    expect(hata).toBeInstanceOf(PavoTasimaHatasi);
    expect((hata as PavoTasimaHatasi).islenmisOlabilir).toBe(true);
  });

  it('JSON olmayan cevap "işlenmiş olabilir" sayılır; adres girilmemişse hiç gönderilmez', async () => {
    cevaplar = [() => 'merhaba'];
    await expect(istemci().gonder('/X', { zamanAsimiMs: 2_000 })).rejects.toMatchObject({ islenmisOlabilir: true });
    await expect(istemci('  ').gonder('/X', { zamanAsimiMs: 2_000 })).rejects.toMatchObject({ islenmisOlabilir: false });
  });

  it('istekler tek şeritten sırayla gider; vazgeç sırayı atlar', async () => {
    const sirali: string[] = [];
    const i = istemci();
    const p1 = i.gonder('/A', { zamanAsimiMs: 2_000 }).then(() => sirali.push('A'));
    const p2 = i.gonder('/B', { zamanAsimiMs: 2_000 }).then(() => sirali.push('B'));
    await Promise.all([p1, p2]);
    expect(sirali).toEqual(['A', 'B']);
    expect(gelenler.map((g) => (g.TransactionHandle as { TransactionSequence: number }).TransactionSequence)).toEqual([11, 12]);
  });

  it('adres çözümleme ve yerel tarih biçimi', () => {
    expect(adresCoz('192.168.1.5', false)).toEqual({ host: '192.168.1.5', port: 4568 });
    expect(adresCoz('192.168.1.5', true)).toEqual({ host: '192.168.1.5', port: 4567 });
    expect(adresCoz('http://10.0.0.2:9000/', false)).toEqual({ host: '10.0.0.2', port: 9000 });
    expect(yerelIso(new Date(2026, 9, 29, 8, 5, 3, 7))).toBe('2026-10-29T08:05:03.007');
  });

  it('cevap zarfı çözülür', async () => {
    cevaplar = [() => ({ HasError: true, ErrorCode: '30', Message: 'askıda' })];
    const y: PavoYaniti = await istemci().gonder('/X', { zamanAsimiMs: 2_000 });
    expect(y).toMatchObject({ hata: true, kod: 30, mesaj: 'askıda' });
  });
});

describe('faturalı satış (e-Arşiv / e-Fatura)', () => {
  const sirket = {
    kimlikNo: '1234567890',
    unvan: 'ÖRNEK GIDA A.Ş.',
    vergiDairesi: 'KADIKÖY',
    vergiDairesiKodu: '034255',
    il: 'İSTANBUL',
    ilce: 'KADIKÖY',
    adres: 'Örnek Mah. No:1',
    eposta: '',
  };

  it('vergi no ile GİB kaydı getirilir; geçersiz numara cihaza gitmez', async () => {
    const bilgi = await kanallar['pavo.mukellefSorgula']({ kimlikNo: '1234567890' });
    expect(bilgi).toMatchObject({ kimlikNo: '1234567890', unvan: 'ÖRNEK GIDA A.Ş.', vergiDairesiKodu: '034255', il: 'İSTANBUL' });
    await expect(kanallar['pavo.mukellefSorgula']({ kimlikNo: '1234567891' })).rejects.toThrow(/geçersiz/);
  });

  it('alıcı cihaza CustomerParty olarak gider; belge numarası döner', async () => {
    const u = urunEkle(ortam, { satisFiyati: 10000 });
    const sonuc = (await sat({
      ...sepet(u, adet(1), 10000),
      odemeler: [{ tip: 'NAKIT', tutar: 10000, alinan: 10000 }],
      fatura: sirket,
    })) as Sonuc & { eBelge?: { no: string } | null };

    const istek = cihaz.istekler.find((i) => i.yol === '/StartSaleWithItems')!;
    expect((istek.g.input as { CustomerParty: unknown }).CustomerParty).toEqual({
      CustomerType: 2,
      TaxNumber: '1234567890',
      CompanyName: 'ÖRNEK GIDA A.Ş.',
      TaxOfficeCode: '034255',
      Country: 'Türkiye',
      City: 'İSTANBUL',
      District: 'KADIKÖY',
      Address: 'Örnek Mah. No:1',
    });
    expect(sonuc.eBelge?.no).toBe(`GIB${cihaz.satislar[0]!.Id}`);
    // E-posta yazılmadıysa bildirim istenmez.
    expect((istek.g.input as Record<string, unknown>).SendEMailNotification).toBeUndefined();
  });

  it('e-posta yazıldıysa belge alıcıya e-postayla gönderilir', async () => {
    const u = urunEkle(ortam, { satisFiyati: 1000 });
    await sat({
      ...sepet(u),
      odemeler: [{ tip: 'NAKIT', tutar: 1000, alinan: 1000 }],
      fatura: { ...sirket, eposta: 'muhasebe@ornek.com' },
    });
    const istek = cihaz.istekler.find((i) => i.yol === '/StartSaleWithItems')!;
    expect(istek.g.input).toMatchObject({ SendEMailNotification: true, NotificationEMail: 'muhasebe@ornek.com' });
  });

  it('eksik alıcı bilgisi cihaza hiçbir şey gitmeden durdurulur', async () => {
    const u = urunEkle(ortam, { satisFiyati: 1000 });
    await expect(
      sat({ ...sepet(u), odemeler: [{ tip: 'NAKIT', tutar: 1000, alinan: 1000 }], fatura: { ...sirket, ilce: '' } }),
    ).rejects.toThrow(/İl ve ilçe/);
    expect(cihaz.istekler.some((i) => i.yol === '/StartSaleWithItems')).toBe(false);
  });

  it('fatura bilgisi olmayan satış nihai tüketici fişidir', async () => {
    const u = urunEkle(ortam, { satisFiyati: 1000 });
    const sonuc = (await sat({ ...sepet(u), odemeler: [{ tip: 'NAKIT', tutar: 1000, alinan: 1000 }] })) as Sonuc & {
      eBelge?: unknown;
    };
    const istek = cihaz.istekler.find((i) => i.yol === '/StartSaleWithItems')!;
    expect((istek.g.input as Record<string, unknown>).CustomerParty).toBeUndefined();
    expect(sonuc.eBelge).toBeNull();
  });

  it('fatura sınırına ulaşan satış faturasız kesilmez; faturayla geçer', async () => {
    ayarYaz(ortam.uygulama.vt, AYAR.FATURA_SINIRLARI, JSON.stringify({ [new Date().getFullYear()]: 50_000 }));
    const u = urunEkle(ortam, { satisFiyati: 50_000, stok: adet(10) });
    await expect(
      sat({ ...sepet(u, adet(1), 50_000), odemeler: [{ tip: 'NAKIT', tutar: 50_000, alinan: 50_000 }] }),
    ).rejects.toThrow(/fatura düzenleme sınırı/);
    expect(cihaz.istekler.some((i) => i.yol === '/StartSaleWithItems')).toBe(false);

    const sonuc = (await sat({
      ...sepet(u, adet(1), 50_000),
      odemeler: [{ tip: 'NAKIT', tutar: 50_000, alinan: 50_000 }],
      fatura: sirket,
    })) as Sonuc & { eBelge?: { no: string } | null };
    expect(sonuc.eBelge?.no).toBeTruthy();
  });

  it('Pavo yokken faturalı satış fişe dönmez, reddedilir', async () => {
    ayarYaz(ortam.uygulama.vt, AYAR.POS_TURU, 'KAPALI');
    const u = urunEkle(ortam, { satisFiyati: 1000 });
    await expect(sat({ ...sepet(u), odemeler: [{ tip: 'NAKIT', tutar: 1000, alinan: 1000 }], fatura: sirket })).rejects.toThrow(
      /Pavo tanımlı olmalı/,
    );
  });
});
