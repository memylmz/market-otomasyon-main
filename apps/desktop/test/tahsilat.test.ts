/**
 * Borçtan fazla tahsilat kuralı (§10.7).
 *
 * NEDEN VAR: kural eskiden yalnız ARAYÜZDEYDİ ve iki ekran çelişiyordu —
 * satış ekranı fazla tutarı engelliyor, Cari ekranı yalnız uyarıp kabul
 * ediyordu; servis ise hiçbir sınır tanımıyordu. Kararın tek sahibi artık
 * servistir; bu dosya o kararı kilitler.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet } from '@market/shared';
import { bakiyeOku } from '../src/main/depo/cari.js';
import { tahsilatIptal, tahsilatYap } from '../src/main/servis/cari-servis.js';
import { bekleyenOlaylar } from '../src/main/depo/senkron.js';
import { satisKesinlestir } from '../src/main/servis/satis-servis.js';
import { malKabulOnayla } from '../src/main/servis/stok-servis.js';
import { musteriEkle, tedarikciEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

/** Müşteriye `tutar` kadar veresiye borç yazar. */
function borclandir(musteriId: string, tutar: number): void {
  const urunId = urunEkle(ortam, { ad: 'Veresiye Ürünü', satisFiyati: tutar, stok: adet(100) });
  satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
    kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: tutar }],
    odemeler: [{ tip: 'VERESIYE', tutar }],
    musteri_id: musteriId,
    limit_asimi_onaylandi: true,
  });
}

const tahsil = (cariId: string, tutar: number, avans = false) =>
  tahsilatYap(ortam.uygulama.baglam, ortam.admin, {
    cari_id: cariId,
    tutar,
    odeme_tipi: 'NAKIT',
    avans_kabul: avans,
  });

describe('müşteri tahsilatı', () => {
  it('borç kadar tahsilat borcu kapatır', () => {
    const musteriId = musteriEkle(ortam, 'Ali');
    borclandir(musteriId, 8_700);

    tahsil(musteriId, 8_700);
    expect(bakiyeOku(ortam.uygulama.baglam.vt, musteriId)).toBe(0);
  });

  it('borçtan az tahsilat kalan borcu bırakır', () => {
    const musteriId = musteriEkle(ortam, 'Ali');
    borclandir(musteriId, 8_700);

    tahsil(musteriId, 5_000);
    expect(bakiyeOku(ortam.uygulama.baglam.vt, musteriId)).toBe(3_700);
  });

  /**
   * ASIL KURAL: yuvarlak para veren müşteri farkında olmadan hesabı alacaklıya
   * düşürmemelidir. Arayüz borç kadarını gönderir, farkı para üstü verir.
   */
  it('borçtan fazla tahsilat ONAYSIZ reddedilir', () => {
    const musteriId = musteriEkle(ortam, 'Ali');
    borclandir(musteriId, 8_700);

    expect(() => tahsil(musteriId, 10_000)).toThrow(/borçtan fazla/i);
    expect(bakiyeOku(ortam.uygulama.baglam.vt, musteriId), 'reddedilen tahsilat bakiyeyi bozmamalı').toBe(8_700);
  });

  it('avans onayıyla fazla tahsilat kabul edilir ve hesap alacaklı olur', () => {
    const musteriId = musteriEkle(ortam, 'Ali');
    borclandir(musteriId, 8_700);

    tahsil(musteriId, 10_000, true);
    // 87,00 borç − 100,00 tahsilat = 13,00 alacak (eksi bakiye).
    expect(bakiyeOku(ortam.uygulama.baglam.vt, musteriId)).toBe(-1_300);
  });

  it('borcu olmayan müşteriden onaysız para alınamaz', () => {
    const musteriId = musteriEkle(ortam, 'Borçsuz');
    expect(() => tahsil(musteriId, 5_000)).toThrow(/borç yok/i);
  });

  it('borcu olmayan müşteriden avans onayıyla para alınabilir', () => {
    const musteriId = musteriEkle(ortam, 'Avansçı');
    tahsil(musteriId, 5_000, true);
    expect(bakiyeOku(ortam.uygulama.baglam.vt, musteriId)).toBe(-5_000);
  });

  it('nakit tahsilatta kasaya tahsil edilen tutar girer', () => {
    const musteriId = musteriEkle(ortam, 'Ali');
    borclandir(musteriId, 8_700);
    tahsil(musteriId, 8_700);

    const hareket = ortam.uygulama.baglam.vt
      .hazirla("SELECT tutar FROM kasa_hareketleri WHERE tip = 'TAHSILAT' ORDER BY rowid DESC LIMIT 1")
      .tek<{ tutar: number }>();
    expect(Number(hareket?.tutar)).toBe(8_700);
  });
});

describe('tedarikçi ödemesi', () => {
  /** Aynı servis, aynı kural: iki taraf da farklı davranmasın. */
  function tedarikciBorcuOlustur(tutar: number): string {
    const tedarikciId = tedarikciEkle(ortam, 'Toptancı');
    const urunId = urunEkle(ortam, { ad: 'Alınan Ürün', alisFiyati: tutar, kdvOrani: 0, stok: adet(0) });
    malKabulOnayla(ortam.uygulama.baglam, ortam.admin, {
      tedarikci_id: tedarikciId,
      kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: tutar, kdv_orani: 0 }],
    });
    return tedarikciId;
  }

  it('borçtan fazla ödeme onaysız reddedilir', () => {
    const tedarikciId = tedarikciBorcuOlustur(50_000);
    expect(bakiyeOku(ortam.uygulama.baglam.vt, tedarikciId)).toBe(50_000);
    expect(() => tahsil(tedarikciId, 60_000)).toThrow(/borçtan fazla/i);
  });

  it('avans onayıyla fazla ödeme kabul edilir', () => {
    const tedarikciId = tedarikciBorcuOlustur(50_000);
    tahsil(tedarikciId, 60_000, true);
    expect(bakiyeOku(ortam.uygulama.baglam.vt, tedarikciId)).toBe(-10_000);
  });

  it('nakit ödemede kasadan çıkan tutar eksi işaretlidir', () => {
    const tedarikciId = tedarikciBorcuOlustur(50_000);
    tahsil(tedarikciId, 50_000);
    const hareket = ortam.uygulama.baglam.vt
      .hazirla("SELECT tutar FROM kasa_hareketleri WHERE tip = 'ODEME' ORDER BY rowid DESC LIMIT 1")
      .tek<{ tutar: number }>();
    expect(Number(hareket?.tutar)).toBe(-50_000);
  });
});

describe('tahsilat iptali (§10.7)', () => {
  /**
   * Yanlış tutar girilebilir; düzeltilebilmesi gerekir. Ama `cari_hareketler`
   * DEĞİŞTİRİLEMEZ bir defterdir (trigger korur) — borç, sonradan düzenlenen
   * bir sayı değil, hareketlerin toplamıdır. Düzeltme bu yüzden silme değil,
   * ters kayıttır.
   */
  function borcluMusteri(borc: number): string {
    const musteriId = musteriEkle(ortam, 'Ali');
    borclandir(musteriId, borc);
    return musteriId;
  }

  const sonHareketId = (cariId: string) =>
    ortam.uygulama.baglam.vt
      .hazirla(
        "SELECT id FROM cari_hareketler WHERE cari_id = ? AND hareket_tipi IN ('TAHSILAT','ODEME') ORDER BY rowid DESC LIMIT 1",
      )
      .tek<{ id: string }>(cariId)!.id;

  it('iptal borcu geri yükler', () => {
    const musteriId = borcluMusteri(10_000);
    tahsil(musteriId, 10_000);
    expect(bakiyeOku(ortam.uygulama.baglam.vt, musteriId)).toBe(0);

    tahsilatIptal(ortam.uygulama.baglam, ortam.admin, sonHareketId(musteriId), 'Tutar yanlış girildi');
    expect(bakiyeOku(ortam.uygulama.baglam.vt, musteriId), 'borç geri gelmeli').toBe(10_000);
  });

  /** Defter silinmez: hem yanlış tahsilat hem düzeltmesi ekstrede durur. */
  it('orijinal hareket SİLİNMEZ, ters kayıt eklenir', () => {
    const musteriId = borcluMusteri(10_000);
    tahsil(musteriId, 4_000);
    const hareketId = sonHareketId(musteriId);
    tahsilatIptal(ortam.uygulama.baglam, ortam.admin, hareketId, 'Yanlış müşteri');

    const orijinal = ortam.uygulama.baglam.vt
      .hazirla('SELECT tutar FROM cari_hareketler WHERE id = ?')
      .tek<{ tutar: number }>(hareketId);
    expect(orijinal, 'orijinal hareket yerinde durmalı').toBeTruthy();

    const ters = ortam.uygulama.baglam.vt
      .hazirla("SELECT tutar, belge_tipi FROM cari_hareketler WHERE belge_id = ? AND belge_tipi = 'TAHSILAT_IPTAL'")
      .tek<{ tutar: number; belge_tipi: string }>(hareketId);
    expect(Number(ters?.tutar), 'ters kayıt aynı tutarı zıt yönde taşımalı').toBe(-Number(orijinal?.tutar));
  });

  it('nakit tahsilat iptalinde para kasadan geri çıkar', () => {
    const musteriId = borcluMusteri(10_000);
    tahsil(musteriId, 10_000);
    const hareketId = sonHareketId(musteriId);
    tahsilatIptal(ortam.uygulama.baglam, ortam.admin, hareketId, 'Tutar yanlış');

    const toplam = ortam.uygulama.baglam.vt
      .hazirla("SELECT COALESCE(SUM(tutar),0) AS t FROM kasa_hareketleri WHERE tip = 'TAHSILAT'")
      .tek<{ t: number }>();
    expect(Number(toplam?.t), 'giren ve çıkan birbirini götürmeli').toBe(0);
  });

  it('aynı tahsilat iki kez iptal edilemez', () => {
    const musteriId = borcluMusteri(10_000);
    tahsil(musteriId, 10_000);
    const hareketId = sonHareketId(musteriId);
    tahsilatIptal(ortam.uygulama.baglam, ortam.admin, hareketId, 'Birinci');

    expect(() => tahsilatIptal(ortam.uygulama.baglam, ortam.admin, hareketId, 'İkinci')).toThrow(/zaten iptal/i);
    expect(bakiyeOku(ortam.uygulama.baglam.vt, musteriId), 'bakiye iki kat düzelmemeli').toBe(10_000);
  });

  it('neden zorunludur', () => {
    const musteriId = borcluMusteri(10_000);
    tahsil(musteriId, 5_000);
    expect(() => tahsilatIptal(ortam.uygulama.baglam, ortam.admin, sonHareketId(musteriId), '  ')).toThrow();
  });

  it('tahsilat olmayan hareket iptal edilemez', () => {
    const musteriId = borcluMusteri(10_000);
    const borcId = ortam.uygulama.baglam.vt
      .hazirla("SELECT id FROM cari_hareketler WHERE cari_id = ? AND hareket_tipi = 'BORC' LIMIT 1")
      .tek<{ id: string }>(musteriId)!.id;
    expect(() => tahsilatIptal(ortam.uygulama.baglam, ortam.admin, borcId, 'Deneme')).toThrow();
  });

  it('senkron olayı üretir', () => {
    const musteriId = borcluMusteri(10_000);
    tahsil(musteriId, 10_000);
    const oncekiSayi = bekleyenOlaylar(ortam.uygulama.baglam.vt).length;
    tahsilatIptal(ortam.uygulama.baglam, ortam.admin, sonHareketId(musteriId), 'Yanlış');
    expect(bekleyenOlaylar(ortam.uygulama.baglam.vt).length).toBeGreaterThan(oncekiSayi);
  });
});
