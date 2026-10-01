/**
 * POS senaryoları — gerçek cihaza geçmeden önce akışın her dalı.
 *
 * Sahte cihaz (`SahteCihaz`) gerçek bir sürücünün yapabileceği her şeyi yapar:
 * onaylar, reddeder, hiç yanıt vermez, süre aşımından SONRA onaylar, istisna
 * fırlatır. Kural her senaryoda aynı: müşterinin kartından para çekildiyse ya
 * kayıt vardır ya çekim geri alınmıştır ya da kasiyer açıkça uyarılmıştır.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet, type Kurus, type PosIslemSonucu } from '@market/shared';
import { ayarYaz } from '../src/main/depo/ayar.js';
import { bakiyeOku } from '../src/main/depo/cari.js';
import { posGunlukListele } from '../src/main/depo/pos-gunluk.js';
import { kalemleriGetir, satisBul, satisDetayi } from '../src/main/depo/satis.js';
import type { PosSurucusu } from '../src/main/donanim/pos.js';
import { posSurucusuOlustur } from '../src/main/donanim/pos.js';
import type { Aktor } from '../src/main/servis/baglam.js';
import {
  posIleIade,
  posIleSatis,
  posIleSatisIptal,
  posIleTahsilat,
  posIleTahsilatIptal,
  posOdemesi,
  posSurucusuDegistir,
  posTesti,
  posUyariDinleyicisi,
  type PosUyarisi,
} from '../src/main/servis/pos-servis.js';
import { musteriEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

type Davranis = 'ONAY' | 'RED' | 'YANITSIZ' | 'GEC_ONAY' | 'ISTISNA';

/** Gerçek sürücünün yapabileceği her davranışı taklit eden cihaz. */
class SahteCihaz implements PosSurucusu {
  readonly ad = 'Sahte cihaz';
  satisDavranisi: Davranis = 'ONAY';
  iadeDavranisi: Davranis = 'ONAY';
  geriAlDavranisi: Davranis = 'ONAY';
  /** Çekim onaylanırken çalışır — "cihaz beklerken durum değişti" senaryosu için. */
  cekimSirasinda: (() => void) | null = null;
  readonly cagrilar: { islem: 'satis' | 'iade' | 'geriAl'; tutar: Kurus; referans: string | null }[] = [];
  private sayac = 0;
  private bekleyen: (() => void) | null = null;

  private onay(): PosIslemSonucu {
    this.sayac += 1;
    return { onaylandi: true, onay_kodu: String(100000 + this.sayac), referans: `REF-${this.sayac}`, kart_maske: '**** 4242' };
  }

  private async yanit(davranis: Davranis): Promise<PosIslemSonucu> {
    switch (davranis) {
      case 'ONAY':
        return this.onay();
      case 'RED':
        return { onaylandi: false, hata: 'Yetersiz bakiye' };
      case 'ISTISNA':
        throw new Error('seri port kapandı');
      case 'YANITSIZ':
        return new Promise((coz) => {
          this.bekleyen = () => coz({ onaylandi: false, hata: 'iptal edildi' });
        });
      case 'GEC_ONAY':
        await new Promise((coz) => setTimeout(coz, 150));
        return this.onay();
    }
  }

  async satis(tutar: Kurus): Promise<PosIslemSonucu> {
    this.cagrilar.push({ islem: 'satis', tutar, referans: null });
    const sonuc = await this.yanit(this.satisDavranisi);
    if (sonuc.onaylandi) this.cekimSirasinda?.();
    return sonuc;
  }

  async iade(tutar: Kurus, orijinalReferans: string | null): Promise<PosIslemSonucu> {
    this.cagrilar.push({ islem: 'iade', tutar, referans: orijinalReferans });
    return this.yanit(this.iadeDavranisi);
  }

  async geriAl(tutar: Kurus, referans: string | null): Promise<PosIslemSonucu> {
    this.cagrilar.push({ islem: 'geriAl', tutar, referans });
    return this.yanit(this.geriAlDavranisi);
  }

  async bekleyeniIptal(): Promise<void> {
    this.bekleyen?.();
    this.bekleyen = null;
  }

  async test(): Promise<{ basarili: boolean; mesaj: string }> {
    return { basarili: true, mesaj: 'hazır' };
  }
}

let ortam: TestOrtami;
let cihaz: SahteCihaz;
let uyarilar: PosUyarisi[];
let urunId: string;

const b = () => ortam.uygulama.baglam;
const vt = () => ortam.uygulama.vt;
const gunluk = () => posGunlukListele(vt()).reverse(); // eskiden yeniye
const satisSayisi = () => vt().hazirla('SELECT COUNT(*) AS n FROM satislar').tek<{ n: number }>()!.n;
const stok = () =>
  vt().hazirla('SELECT COALESCE(SUM(miktar), 0) AS m FROM stok_hareketleri WHERE urun_id = ?').tek<{ m: number }>(urunId)!.m;
const bekle = (ms: number) => new Promise((coz) => setTimeout(coz, ms));

function satisGirdisi(odemeler: { tip: 'NAKIT' | 'KART' | 'VERESIYE'; tutar: Kurus }[], adetSayisi = 1, musteriId?: string) {
  return {
    kalemler: [{ urun_id: urunId, miktar: adet(adetSayisi), birim_fiyat: 1000 }],
    odemeler,
    musteri_id: musteriId,
  };
}

async function kartlaSat(adetSayisi = 1): Promise<string> {
  return (await posIleSatis(b(), ortam.admin, satisGirdisi([{ tip: 'KART', tutar: adetSayisi * 1000 }], adetSayisi))).satisId;
}

beforeEach(async () => {
  ortam = await testOrtamiKur();
  cihaz = new SahteCihaz();
  posSurucusuDegistir(cihaz);
  uyarilar = [];
  posUyariDinleyicisi((u) => uyarilar.push(u));
  urunId = urunEkle(ortam, { satisFiyati: 1000, stok: adet(100) });
});

afterEach(async () => {
  posSurucusuDegistir(undefined);
  posUyariDinleyicisi(null);
  await ortam.temizle();
});

// ---------------------------------------------------------------------------

describe('satış: müşteri kartla öderse tutar POS’a gider', () => {
  it('kart satışı: cihaz onaylar, onay kodu/referans/kart satışa yazılır, günlükte belgeye bağlanır', async () => {
    const sonuc = await posIleSatis(b(), ortam.admin, satisGirdisi([{ tip: 'KART', tutar: 2000 }], 2));
    expect(cihaz.cagrilar).toEqual([{ islem: 'satis', tutar: 2000, referans: null }]);
    expect(sonuc.pos).toMatchObject({ onaylandi: true, referans: 'REF-1' });
    expect(satisDetayi(vt(), sonuc.satisId)!.odemeler[0]).toMatchObject({
      pos_onay_kodu: '100001',
      pos_referans: 'REF-1',
      pos_kart: '**** 4242',
    });
    expect(gunluk()).toEqual([
      expect.objectContaining({ tur: 'SATIS', tutar: 2000, sonuc: 'ONAY', belge_id: sonuc.satisId, belge_tipi: 'SATIS' }),
    ]);
  });

  it('nakit + kart: yalnız kart kısmı cihaza gider', async () => {
    await posIleSatis(
      b(),
      ortam.admin,
      satisGirdisi(
        [
          { tip: 'NAKIT', tutar: 1500 },
          { tip: 'KART', tutar: 1500 },
        ],
        3,
      ),
    );
    expect(cihaz.cagrilar).toEqual([{ islem: 'satis', tutar: 1500, referans: null }]);
  });

  it('nakit ve veresiye satış cihaza gitmez', async () => {
    const musteri = musteriEkle(ortam, 'Barış', 1_000_000);
    await posIleSatis(b(), ortam.admin, satisGirdisi([{ tip: 'NAKIT', tutar: 1000 }]));
    await posIleSatis(b(), ortam.admin, satisGirdisi([{ tip: 'VERESIYE', tutar: 1000 }], 1, musteri));
    expect(cihaz.cagrilar).toEqual([]);
    expect(satisSayisi()).toBe(2);
  });

  it('POS kapalıyken kart satışı eskisi gibi doğrudan kaydedilir', async () => {
    posSurucusuDegistir(null);
    const sonuc = await posIleSatis(b(), ortam.admin, satisGirdisi([{ tip: 'KART', tutar: 1000 }]));
    expect(sonuc.pos).toBeNull();
    expect(satisDetayi(vt(), sonuc.satisId)!.odemeler[0]!.pos_referans).toBeNull();
    expect(gunluk()).toEqual([]);
  });

  it('kart reddedilirse satış kaydedilmez, stok düşmez; red günlüğe yazılır', async () => {
    cihaz.satisDavranisi = 'RED';
    const stokOnce = stok();
    await expect(posIleSatis(b(), ortam.admin, satisGirdisi([{ tip: 'KART', tutar: 1000 }]))).rejects.toThrow(
      /onaylanmadı.*Yetersiz bakiye/,
    );
    expect(satisSayisi()).toBe(0);
    expect(stok()).toBe(stokOnce);
    expect(gunluk()).toEqual([expect.objectContaining({ tur: 'SATIS', sonuc: 'RED', hata: 'Yetersiz bakiye' })]);
  });

  it('satış zaten kaydedilemeyecekse (kasa kapalı) karttan para HİÇ çekilmez', async () => {
    ortam.admin.kasaOturumId = null;
    await expect(posIleSatis(b(), ortam.admin, satisGirdisi([{ tip: 'KART', tutar: 1000 }]))).rejects.toThrow();
    expect(cihaz.cagrilar).toEqual([]);
  });

  it('ödeme toplamı tutmuyorsa karttan para çekilmez', async () => {
    await expect(posIleSatis(b(), ortam.admin, satisGirdisi([{ tip: 'KART', tutar: 500 }]))).rejects.toThrow();
    expect(cihaz.cagrilar).toEqual([]);
  });

  it('çekimden sonra kayıt başarısız olursa çekim geri alınır — iade yetkisi olmayan kasiyer için de', async () => {
    const yalnizSatis: Aktor = { ...ortam.admin, yetkiler: new Set(['satis.yap']) };
    // Cihaz beklerken vardiya kapanmış gibi: kuru deneme geçti, gerçek kayıt düşer.
    cihaz.cekimSirasinda = () => {
      yalnizSatis.kasaOturumId = null;
    };
    await expect(posIleSatis(b(), yalnizSatis, satisGirdisi([{ tip: 'KART', tutar: 1000 }]))).rejects.toThrow(
      /geri alındı, müşteriden para alınmadı/,
    );
    expect(cihaz.cagrilar.map((c) => c.islem)).toEqual(['satis', 'geriAl']);
    expect(cihaz.cagrilar[1]).toMatchObject({ tutar: 1000, referans: 'REF-1' });
    expect(satisSayisi()).toBe(0);
    expect(gunluk().map((g) => `${g.tur}:${g.sonuc}`)).toEqual(['SATIS:ONAY', 'GERI_ALMA:ONAY']);
  });

  it('geri alma da başarısız olursa kasiyere "cihazdan iptal edin" denir', async () => {
    cihaz.geriAlDavranisi = 'RED';
    cihaz.cekimSirasinda = () => {
      ortam.admin.kasaOturumId = null;
    };
    await expect(posIleSatis(b(), ortam.admin, satisGirdisi([{ tip: 'KART', tutar: 1000 }]))).rejects.toThrow(
      /POS cihazından iptal edin/,
    );
  });

  it('cihaz geri almayı (void) desteklemiyorsa iade ile geri alınır', async () => {
    const geriAlsiz: PosSurucusu = {
      ad: 'geriAl yok',
      satis: (t) => cihaz.satis(t),
      iade: (t, r) => cihaz.iade(t, r),
      test: () => cihaz.test(),
    };
    posSurucusuDegistir(geriAlsiz);
    cihaz.cekimSirasinda = () => {
      ortam.admin.kasaOturumId = null;
    };
    await expect(posIleSatis(b(), ortam.admin, satisGirdisi([{ tip: 'KART', tutar: 1000 }]))).rejects.toThrow(/geri alındı/);
    expect(cihaz.cagrilar.map((c) => c.islem)).toEqual(['satis', 'iade']);
  });

  it('sürücü istisna fırlatırsa satış kaydedilmez, kasiyer okunur hata görür, günlükte HATA', async () => {
    cihaz.satisDavranisi = 'ISTISNA';
    await expect(posIleSatis(b(), ortam.admin, satisGirdisi([{ tip: 'KART', tutar: 1000 }]))).rejects.toThrow(
      /sürücü hatası: seri port kapandı/,
    );
    expect(satisSayisi()).toBe(0);
    expect(gunluk()[0]).toMatchObject({ sonuc: 'HATA' });
  });

  it('cihaz yanıt vermezse süre sonunda satış kaydedilmez, bekleyen işlem iptal edilir', async () => {
    ayarYaz(vt(), 'pos.zaman_asimi_sn', '0.05');
    cihaz.satisDavranisi = 'YANITSIZ';
    await expect(posIleSatis(b(), ortam.admin, satisGirdisi([{ tip: 'KART', tutar: 1000 }]))).rejects.toThrow(/yanıt vermedi/);
    expect(satisSayisi()).toBe(0);
    expect(gunluk()[0]).toMatchObject({ sonuc: 'ZAMAN_ASIMI' });
    await bekle(20);
    expect(uyarilar).toEqual([]); // iptal edilen işlem için uyarı yok
  });

  it('süre aşımından SONRA gelen onay otomatik geri alınır ve kasiyer uyarılır', async () => {
    ayarYaz(vt(), 'pos.zaman_asimi_sn', '0.05');
    cihaz.satisDavranisi = 'GEC_ONAY';
    await expect(posIleSatis(b(), ortam.admin, satisGirdisi([{ tip: 'KART', tutar: 1000 }]))).rejects.toThrow(/yanıt vermedi/);
    await bekle(300);
    expect(cihaz.cagrilar.map((c) => c.islem)).toEqual(['satis', 'geriAl']);
    expect(uyarilar).toEqual([expect.objectContaining({ tur: 'uyari', baslik: expect.stringContaining('geri alındı') })]);
    expect(gunluk().map((g) => `${g.tur}:${g.sonuc}`)).toEqual(['SATIS:ZAMAN_ASIMI', 'SATIS:ONAY', 'GERI_ALMA:ONAY']);
    expect(satisSayisi()).toBe(0);
  });

  it('cihaz meşgulken ikinci işlem reddedilir (çift tıklama iki kez çekmez)', async () => {
    cihaz.satisDavranisi = 'GEC_ONAY';
    const ilk = posIleSatis(b(), ortam.admin, satisGirdisi([{ tip: 'KART', tutar: 1000 }]));
    await expect(posIleSatis(b(), ortam.admin, satisGirdisi([{ tip: 'KART', tutar: 1000 }]))).rejects.toThrow(
      /önceki işlemi bitirmedi/,
    );
    await ilk;
    expect(cihaz.cagrilar.filter((c) => c.islem === 'satis')).toHaveLength(1);
    expect(satisSayisi()).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('iade: kartla alınan ürünün parası karta POS’tan döner', () => {
  it('kısmi iade karta: tutar orijinal çekimin referansıyla cihaza gider, iade fişine onay yazılır', async () => {
    const satisId = await kartlaSat(3);
    const kalem = kalemleriGetir(vt(), satisId)[0]!;
    const iade = await posIleIade(b(), ortam.admin, {
      kaynak_satis_id: satisId,
      kalemler: [{ satis_kalemi_id: kalem.id, miktar: adet(1) }],
      iade_yontemi: 'KART',
      neden: 'bozuk çıktı',
    });
    expect(cihaz.cagrilar[1]).toEqual({ islem: 'iade', tutar: 1000, referans: 'REF-1' });
    expect(satisDetayi(vt(), iade.satisId)!.odemeler[0]).toMatchObject({ odeme_tipi: 'KART', pos_referans: 'REF-2' });
    expect(gunluk()[1]).toMatchObject({ tur: 'IADE', sonuc: 'ONAY', orijinal_referans: 'REF-1', belge_id: iade.satisId });
  });

  it('art arda iadeler: toplamı kartla ödeneni aşamaz', async () => {
    const satisId = await kartlaSat(2);
    const kalem = kalemleriGetir(vt(), satisId)[0]!;
    const iadeEt = () =>
      posIleIade(b(), ortam.admin, {
        kaynak_satis_id: satisId,
        kalemler: [{ satis_kalemi_id: kalem.id, miktar: adet(1) }],
        iade_yontemi: 'KART',
        neden: 'iade',
      });
    await iadeEt();
    await iadeEt();
    expect(cihaz.cagrilar.filter((c) => c.islem === 'iade')).toHaveLength(2);
    await expect(iadeEt()).rejects.toThrow(); // iade edilecek ürün kalmadı
    expect(cihaz.cagrilar.filter((c) => c.islem === 'iade')).toHaveLength(2);
  });

  it('karma ödemede karta iade, kartla ödenen kısmı aşarsa cihaza gidilmeden reddedilir', async () => {
    const { satisId } = await posIleSatis(
      b(),
      ortam.admin,
      satisGirdisi(
        [
          { tip: 'NAKIT', tutar: 3000 },
          { tip: 'KART', tutar: 1000 },
        ],
        4,
      ),
    );
    const kalem = kalemleriGetir(vt(), satisId)[0]!;
    await expect(
      posIleIade(b(), ortam.admin, {
        kaynak_satis_id: satisId,
        kalemler: [{ satis_kalemi_id: kalem.id, miktar: adet(2) }],
        iade_yontemi: 'KART',
        neden: 'iade',
      }),
    ).rejects.toThrow(/en fazla 10,00/);
    expect(cihaz.cagrilar.filter((c) => c.islem === 'iade')).toHaveLength(0);
  });

  it('nakit ödenmiş satış POS açıkken karta iade edilemez', async () => {
    const { satisId } = await posIleSatis(b(), ortam.admin, satisGirdisi([{ tip: 'NAKIT', tutar: 1000 }]));
    const kalem = kalemleriGetir(vt(), satisId)[0]!;
    await expect(
      posIleIade(b(), ortam.admin, {
        kaynak_satis_id: satisId,
        kalemler: [{ satis_kalemi_id: kalem.id, miktar: adet(1) }],
        iade_yontemi: 'KART',
        neden: 'iade',
      }),
    ).rejects.toThrow(/kartla ödenmemiş/);
    expect(cihaz.cagrilar).toEqual([]);
  });

  it('cihaz iadeyi reddederse iade kaydedilmez, stok geri girmez', async () => {
    const satisId = await kartlaSat(1);
    const kalem = kalemleriGetir(vt(), satisId)[0]!;
    cihaz.iadeDavranisi = 'RED';
    const stokOnce = stok();
    await expect(
      posIleIade(b(), ortam.admin, {
        kaynak_satis_id: satisId,
        kalemler: [{ satis_kalemi_id: kalem.id, miktar: adet(1) }],
        iade_yontemi: 'KART',
        neden: 'iade',
      }),
    ).rejects.toThrow(/iade yapılamadı/);
    expect(stok()).toBe(stokOnce);
    expect(satisSayisi()).toBe(1);
  });

  it('kartla alınan ürün NAKİT iade edilirse POS’a gidilmez', async () => {
    const satisId = await kartlaSat(1);
    const kalem = kalemleriGetir(vt(), satisId)[0]!;
    await posIleIade(b(), ortam.admin, {
      kaynak_satis_id: satisId,
      kalemler: [{ satis_kalemi_id: kalem.id, miktar: adet(1) }],
      iade_yontemi: 'NAKIT',
      neden: 'nakit istedi',
    });
    expect(cihaz.cagrilar.map((c) => c.islem)).toEqual(['satis']);
  });

  it('iade yetkisi yoksa cihaza gidilmez', async () => {
    const satisId = await kartlaSat(1);
    const kalem = kalemleriGetir(vt(), satisId)[0]!;
    const yetkisiz: Aktor = { ...ortam.admin, yetkiler: new Set(['satis.yap']) };
    await expect(
      posIleIade(b(), yetkisiz, {
        kaynak_satis_id: satisId,
        kalemler: [{ satis_kalemi_id: kalem.id, miktar: adet(1) }],
        iade_yontemi: 'KART',
        neden: 'iade',
      }),
    ).rejects.toThrow();
    expect(cihaz.cagrilar.map((c) => c.islem)).toEqual(['satis']);
  });
});

// ---------------------------------------------------------------------------

describe('satış iptali POS ile', () => {
  it('kart satışı iptal: tamamı orijinal referansla karta iade edilir', async () => {
    const satisId = await kartlaSat(2);
    await posIleSatisIptal(b(), ortam.admin, satisId, 'müşteri vazgeçti');
    expect(cihaz.cagrilar[1]).toEqual({ islem: 'iade', tutar: 2000, referans: 'REF-1' });
    expect(satisBul(vt(), satisId)!.iptal_mi).toBeTruthy();
    expect(gunluk()[1]).toMatchObject({ tur: 'IADE', belge_id: satisId, belge_tipi: 'SATIS_IPTAL' });
  });

  it('karma satış "ödendiği gibi" iptal: yalnız kart kısmı cihaza gider', async () => {
    const { satisId } = await posIleSatis(
      b(),
      ortam.admin,
      satisGirdisi(
        [
          { tip: 'NAKIT', tutar: 1000 },
          { tip: 'KART', tutar: 2000 },
        ],
        3,
      ),
    );
    await posIleSatisIptal(b(), ortam.admin, satisId, 'vazgeçti');
    expect(cihaz.cagrilar[1]).toMatchObject({ islem: 'iade', tutar: 2000 });
  });

  it('karma satışın tamamı karta iade istenirse reddedilir (kartla ödenen aşılır)', async () => {
    const { satisId } = await posIleSatis(
      b(),
      ortam.admin,
      satisGirdisi(
        [
          { tip: 'NAKIT', tutar: 1000 },
          { tip: 'KART', tutar: 2000 },
        ],
        3,
      ),
    );
    await expect(posIleSatisIptal(b(), ortam.admin, satisId, 'vazgeçti', 'KART')).rejects.toThrow(/en fazla 20,00/);
    expect(satisBul(vt(), satisId)!.iptal_mi).toBeFalsy();
  });

  it('kart satışı nakit iade ile iptal edilirse POS’a gidilmez', async () => {
    const satisId = await kartlaSat(1);
    await posIleSatisIptal(b(), ortam.admin, satisId, 'nakit istedi', 'NAKIT');
    expect(cihaz.cagrilar.map((c) => c.islem)).toEqual(['satis']);
  });

  it('cihaz reddederse iptal yazılmaz', async () => {
    const satisId = await kartlaSat(1);
    cihaz.iadeDavranisi = 'RED';
    await expect(posIleSatisIptal(b(), ortam.admin, satisId, 'vazgeçti')).rejects.toThrow(/iade yapılamadı/);
    expect(satisBul(vt(), satisId)!.iptal_mi).toBeFalsy();
  });

  it('iptal zaten geçersizse (neden boş, önceden iade var) karta para gönderilmez', async () => {
    const satisId = await kartlaSat(2);
    await expect(posIleSatisIptal(b(), ortam.admin, satisId, '  ')).rejects.toThrow();
    const kalem = kalemleriGetir(vt(), satisId)[0]!;
    await posIleIade(b(), ortam.admin, {
      kaynak_satis_id: satisId,
      kalemler: [{ satis_kalemi_id: kalem.id, miktar: adet(1) }],
      iade_yontemi: 'KART',
      neden: 'bozuk',
    });
    await expect(posIleSatisIptal(b(), ortam.admin, satisId, 'vazgeçti')).rejects.toThrow(/iade yapılmış/);
    expect(cihaz.cagrilar.map((c) => c.islem)).toEqual(['satis', 'iade']);
  });
});

// ---------------------------------------------------------------------------

describe('cari tahsilat POS ile', () => {
  it('borçtan fazla tahsilat (avans onayı yok) karttan çekilmeden reddedilir', async () => {
    const musteri = musteriEkle(ortam, 'Barış', 1_000_000);
    await expect(posIleTahsilat(b(), ortam.admin, { cari_id: musteri, tutar: 5000, odeme_tipi: 'KART' })).rejects.toThrow(/borç/);
    expect(cihaz.cagrilar).toEqual([]);
  });

  it('nakit alınmış tahsilat POS açıkken karta iade edilemez', async () => {
    const musteri = musteriEkle(ortam, 'Barış', 1_000_000);
    const { hareketId } = await posIleTahsilat(b(), ortam.admin, {
      cari_id: musteri,
      tutar: 5000,
      odeme_tipi: 'NAKIT',
      avans_kabul: true,
    });
    await expect(posIleTahsilatIptal(b(), ortam.admin, hareketId, 'yanlış', 'KART')).rejects.toThrow(/kartla ödenmemiş/);
    expect(cihaz.cagrilar).toEqual([]);
  });

  it('cihaz iadeyi reddederse tahsilat iptali yazılmaz', async () => {
    const musteri = musteriEkle(ortam, 'Barış', 1_000_000);
    const { hareketId } = await posIleTahsilat(b(), ortam.admin, {
      cari_id: musteri,
      tutar: 5000,
      odeme_tipi: 'KART',
      avans_kabul: true,
    });
    cihaz.iadeDavranisi = 'RED';
    await expect(posIleTahsilatIptal(b(), ortam.admin, hareketId, 'yanlış')).rejects.toThrow(/iade yapılamadı/);
    expect(bakiyeOku(vt(), musteri)).toBe(-5000);
  });

  it('kart tahsilatı kaydedilemezse çekim geri alınır', async () => {
    const musteri = musteriEkle(ortam, 'Barış', 1_000_000);
    const aktor: Aktor = { ...ortam.admin, yetkiler: new Set(ortam.admin.yetkiler) };
    // Cihaz beklerken yetki geri alınmış gibi: kuru deneme geçti, gerçek kayıt düşer.
    cihaz.cekimSirasinda = () => aktor.yetkiler.delete('cari.tahsilat');
    await expect(
      posIleTahsilat(b(), aktor, { cari_id: musteri, tutar: 5000, odeme_tipi: 'KART', avans_kabul: true }),
    ).rejects.toThrow(/geri alındı/);
    expect(cihaz.cagrilar.map((c) => c.islem)).toEqual(['satis', 'geriAl']);
    expect(bakiyeOku(vt(), musteri)).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('sözleşme ve ayar', () => {
  it('bilinmeyen POS türü kapalı sayılır', () => {
    expect(posSurucusuOlustur('BILINMEYEN_MARKA')).toBeNull();
    expect(posSurucusuOlustur('KAPALI')).toBeNull();
  });

  it('sıfır ya da kesirli tutar cihaza gönderilmez', async () => {
    await expect(posOdemesi(b(), ortam.admin, 0)).rejects.toThrow(/geçersiz/);
    await expect(posOdemesi(b(), ortam.admin, 10.5)).rejects.toThrow(/geçersiz/);
    expect(cihaz.cagrilar).toEqual([]);
  });

  it('bağlantı testi sürücü hatasında çökmez', async () => {
    posSurucusuDegistir({
      ...cihaz,
      ad: 'x',
      satis: cihaz.satis,
      iade: cihaz.iade,
      test: () => Promise.reject(new Error('port yok')),
    });
    expect(await posTesti(b(), ortam.admin)).toEqual({ basarili: false, mesaj: expect.stringContaining('port yok') });
  });
});
