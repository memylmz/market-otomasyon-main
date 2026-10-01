/**
 * Banka / POS defteri — nakit dışı paranın yürüyen bakiyesi.
 *
 * Kasa yalnız fiziksel nakdi tutar; kartla satış, kart/havale tahsilat ve
 * tedarikçiye kart/havale ödemeleri ayrı ayrı ekranlarda dağınık duruyordu.
 * Defter bunları mevcut kayıtlardan TÜRETİR; yalnız açılış, komisyon ve
 * kasa↔banka aktarımı elle girilir.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet } from '@market/shared';
import { bankaDefteri } from '../src/main/depo/banka.js';
import { oturumOzeti } from '../src/main/depo/kasa.js';
import { kalemleriGetir } from '../src/main/depo/satis.js';
import { bankaHareketiEkle } from '../src/main/servis/banka-servis.js';
import { tahsilatIptal, tahsilatYap } from '../src/main/servis/cari-servis.js';
import { iadeYap, satisIptal, satisKesinlestir } from '../src/main/servis/satis-servis.js';
import { malKabulOnayla } from '../src/main/servis/stok-servis.js';
import { musteriEkle, tedarikciEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;
let urunId: string;

beforeEach(async () => {
  ortam = await testOrtamiKur();
  urunId = urunEkle(ortam, { satisFiyati: 100, alisFiyati: 50, stok: adet(1000) });
});

afterEach(async () => {
  await ortam.temizle();
});

function sat(odemeler: { tip: 'NAKIT' | 'KART' | 'VERESIYE'; tutar: number }[], musteri?: string) {
  const toplam = odemeler.reduce((t, o) => t + o.tutar, 0);
  return satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
    kalemler: [{ urun_id: urunId, miktar: adet(toplam / 100), birim_fiyat: 100 }],
    odemeler,
    musteri_id: musteri,
  }).satisId;
}

const bakiye = () => bankaDefteri(ortam.uygulama.vt).bakiye;
const kasaNakit = () => oturumOzeti(ortam.uygulama.vt, ortam.admin.kasaOturumId as string).beklenen_nakit;

describe('banka / POS defteri', () => {
  it('kart satış girer, nakit satış girmez; karma satışta yalnız kart payı; iptal edilen satış hiç sayılmaz', () => {
    sat([{ tip: 'KART', tutar: 1000 }]);
    sat([{ tip: 'NAKIT', tutar: 500 }]);
    sat([
      { tip: 'KART', tutar: 300 },
      { tip: 'NAKIT', tutar: 200 },
    ]);
    const iptal = sat([{ tip: 'KART', tutar: 700 }]);
    satisIptal(ortam.uygulama.baglam, ortam.admin, iptal, 'yanlış');
    expect(bakiye()).toBe(1300);
  });

  it('karta iade bakiyeden düşer', () => {
    const satis = sat([{ tip: 'KART', tutar: 1000 }]);
    const kalem = kalemleriGetir(ortam.uygulama.vt, satis)[0]!;
    iadeYap(ortam.uygulama.baglam, ortam.admin, {
      kaynak_satis_id: satis,
      kalemler: [{ satis_kalemi_id: kalem.id, miktar: adet(4) }],
      iade_yontemi: 'KART',
      neden: 'test',
    });
    expect(bakiye()).toBe(600);
  });

  it('kartla tahsilat girer; tedarikçiye kart/havale ödeme çıkar; nakitler girmez', () => {
    const musteri = musteriEkle(ortam, 'Barış', 1_000_000);
    tahsilatYap(ortam.uygulama.baglam, ortam.admin, { cari_id: musteri, tutar: 250, odeme_tipi: 'KART', avans_kabul: true });
    tahsilatYap(ortam.uygulama.baglam, ortam.admin, { cari_id: musteri, tutar: 100, odeme_tipi: 'NAKIT', avans_kabul: true });

    const tedarikci = tedarikciEkle(ortam, 'Enis');
    const fatura = (odenen: number, tip: 'NAKIT' | 'HAVALE') =>
      malKabulOnayla(ortam.uygulama.baglam, ortam.admin, {
        tedarikci_id: tedarikci,
        odenen_tutar: odenen,
        odeme_tipi: tip,
        kalemler: [{ urun_id: urunId, miktar: adet(100), birim_fiyat: 50, kdv_orani: 0 }],
      });
    fatura(2000, 'HAVALE');
    fatura(500, 'NAKIT');
    tahsilatYap(ortam.uygulama.baglam, ortam.admin, { cari_id: tedarikci, tutar: 300, odeme_tipi: 'KART' });

    expect(bakiye()).toBe(250 - 2000 - 300);
  });

  it('"karta/hesaba" yoluyla iptal edilen ödeme geri girer; nakit yolla iptal bankayı etkilemez', () => {
    const tedarikci = tedarikciEkle(ortam, 'Enis');
    malKabulOnayla(ortam.uygulama.baglam, ortam.admin, {
      tedarikci_id: tedarikci,
      kalemler: [{ urun_id: urunId, miktar: adet(100), birim_fiyat: 50, kdv_orani: 0 }],
    });
    const kartOdeme = tahsilatYap(ortam.uygulama.baglam, ortam.admin, { cari_id: tedarikci, tutar: 300, odeme_tipi: 'KART' });
    const kartOdeme2 = tahsilatYap(ortam.uygulama.baglam, ortam.admin, { cari_id: tedarikci, tutar: 200, odeme_tipi: 'KART' });
    expect(bakiye()).toBe(-500);
    tahsilatIptal(ortam.uygulama.baglam, ortam.admin, kartOdeme.hareketId, 'hesaba iade', 'KART');
    expect(bakiye()).toBe(-200);
    // Kartla ödenmişti ama tedarikçi nakit geri verdi: para kasaya girer, banka değişmez.
    tahsilatIptal(ortam.uygulama.baglam, ortam.admin, kartOdeme2.hareketId, 'elden iade', 'NAKIT');
    expect(bakiye()).toBe(-200);
  });

  it('elle hareketler: açılış ve komisyon; bankadan kasaya çekim kasaya da girer', () => {
    const kasaOnce = kasaNakit();
    bankaHareketiEkle(ortam.uygulama.baglam, ortam.admin, { tur: 'ACILIS', tutar: 10_000, aciklama: 'Açılış' });
    bankaHareketiEkle(ortam.uygulama.baglam, ortam.admin, { tur: 'KOMISYON', tutar: 50, aciklama: 'Eylül POS kesintisi' });
    bankaHareketiEkle(ortam.uygulama.baglam, ortam.admin, { tur: 'BANKADAN_KASAYA', tutar: 1000, aciklama: 'ATM' });
    bankaHareketiEkle(ortam.uygulama.baglam, ortam.admin, { tur: 'KASADAN_BANKAYA', tutar: 300, aciklama: 'Yatırma' });
    expect(bakiye()).toBe(10_000 - 50 - 1000 + 300);
    expect(kasaNakit()).toBe(kasaOnce + 1000 - 300);
  });

  it('yürüyen bakiye ve tarih aralığı devri; özet tahmini komisyonu orana göre hesaplar', () => {
    sat([{ tip: 'KART', tutar: 10_000 }]);
    const defter = bankaDefteri(ortam.uygulama.vt, { komisyonOrani: 2 });
    expect(defter.hareketler.at(-1)?.yuruyen_bakiye).toBe(10_000);
    expect(defter.ozet.kart_satis).toBe(10_000);
    expect(defter.ozet.tahmini_komisyon).toBe(200);

    const yarin = new Date(Date.now() + 86_400_000).toISOString();
    const ileri = bankaDefteri(ortam.uygulama.vt, { baslangic: yarin });
    expect(ileri.devir).toBe(10_000);
    expect(ileri.hareketler).toHaveLength(0);
    expect(ileri.bakiye).toBe(10_000);
  });
});
