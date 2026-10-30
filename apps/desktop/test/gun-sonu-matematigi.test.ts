/**
 * Bir günün tamamı kuruşu kuruşuna (Pavo açık).
 *
 * NEDEN VAR: satış, iptal, müşteri iadesi (nakit/kart/veresiye), tahsilat,
 * gider, mal kabul ve tedarikçi iadesi aynı günde karışınca kasa, günlük
 * özet, ürün özeti, stok, ortalama maliyet ve cari bakiyeleri birbirini
 * tutmalı. Beklenen değerler testten bağımsız, elle hesaplanmıştır; her
 * satırın yanında hesabı yazıyor.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet, AYAR, bugun } from '@market/shared';
import { ayarYaz } from '../src/main/depo/ayar.js';
import { bakiyeOku } from '../src/main/depo/cari.js';
import { oturumOzeti } from '../src/main/depo/kasa.js';
import { gunlukOzetTek } from '../src/main/depo/ozet.js';
import { satisDetayi } from '../src/main/depo/satis.js';
import { ortalamaMaliyetHesapla, stokOku, stokMutabakati } from '../src/main/depo/stok.js';
import { kanallariOlustur } from '../src/main/ipc/kanallar.js';
import { tahsilatYap } from '../src/main/servis/cari-servis.js';
import { gunSonu, kasaHareketi } from '../src/main/servis/kasa-servis.js';
import { pavoBeklemeCarpani, pavoTasiyiciDegistir } from '../src/main/servis/pavo-servis.js';
import { bugunOzeti } from '../src/main/servis/rapor-servis.js';
import { malKabulOnayla, tedarikciIade } from '../src/main/servis/stok-servis.js';
import { SahteCihaz } from './pavo-sahte-cihaz.js';
import { musteriEkle, tedarikciEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;
let cihaz: SahteCihaz;
let kanallar: ReturnType<typeof kanallariOlustur>;

beforeEach(async () => {
  ortam = await testOrtamiKur(); // kasa 100,00 ₺ ile açık
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

type Sonuc = { satisId: string };
const sat = (girdi: Record<string, unknown>) => kanallar['satis.kesinlestir']({ ...girdi, fis_yazdir: false }) as Promise<Sonuc>;

describe('gün sonu matematiği', () => {
  it('satış + iptal + iadeler + tahsilat + gider + tedarikçi hareketleri kuruşu kuruşuna tutar', async () => {
    const { baglam, vt } = ortam.uygulama;
    const a = ortam.admin;
    // Su: 10 ₺, alış 6 ₺, KDV %0 → adet başı kâr 4 ₺.
    const su = urunEkle(ortam, { ad: 'Su', satisFiyati: 1000, alisFiyati: 600, kdvOrani: 0, stok: adet(50) });
    // Deterjan: 120 ₺ KDV %20 dahil → matrah 100, KDV 20, alış 70 → kâr 30 ₺.
    const det = urunEkle(ortam, { ad: 'Deterjan', satisFiyati: 12000, alisFiyati: 7000, kdvOrani: 20, stok: adet(20) });
    const ayse = musteriEkle(ortam, 'Ayşe', 100_000);
    const tedarikci = tedarikciEkle(ortam, 'Toptancı');
    const kalem = (satisId: string, urunId: string) => satisDetayi(vt, satisId)!.kalemler.find((k) => k.urun_id === urunId)!;
    const iade = (satisId: string, urunId: string, miktar: number, yontem: string) =>
      kanallar['satis.iade']({
        kaynak_satis_id: satisId,
        kalemler: [{ satis_kalemi_id: kalem(satisId, urunId).id, miktar }],
        iade_yontemi: yontem,
        neden: 'Test',
      });

    // --- Satışlar ---
    const s1 = await sat({
      kalemler: [{ urun_id: su, miktar: adet(3), birim_fiyat: 1000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 3000 }],
    });
    const s2 = await sat({
      kalemler: [{ urun_id: det, miktar: adet(2), birim_fiyat: 12000 }],
      odemeler: [{ tip: 'KART', tutar: 24000 }],
    });
    const s3 = await sat({
      kalemler: [
        { urun_id: det, miktar: adet(1), birim_fiyat: 12000 },
        { urun_id: su, miktar: adet(2), birim_fiyat: 1000 },
      ],
      odemeler: [
        { tip: 'KART', tutar: 5000 },
        { tip: 'NAKIT', tutar: 9000 },
      ],
    });
    const s4 = await sat({
      kalemler: [{ urun_id: det, miktar: adet(1), birim_fiyat: 12000 }],
      musteri_id: ayse,
      odemeler: [{ tip: 'VERESIYE', tutar: 12000 }],
    });
    const s5 = await sat({
      kalemler: [{ urun_id: su, miktar: adet(4), birim_fiyat: 1000 }],
      odemeler: [{ tip: 'NAKIT', tutar: 4000 }],
    });
    await sat({
      kalemler: [{ urun_id: su, miktar: adet(2), birim_fiyat: 1000 }],
      musteri_id: ayse,
      odemeler: [{ tip: 'VERESIYE', tutar: 2000 }],
    });

    // --- İptal ve iadeler (hepsi Pavo'dan) ---
    await kanallar['satis.iptal']({ satisId: s5.satisId, neden: 'Yanlış ürün' }); // nakit 40 ₺ geri
    await iade(s2.satisId, det, adet(1), 'KART'); // 120 ₺ karta
    await iade(s3.satisId, det, adet(1), 'NAKIT'); // 120 ₺ kasadan (kartla ödenmiş kısım olsa da)
    await iade(s4.satisId, det, adet(1), 'VERESIYE'); // Ayşe'nin borcundan 120 ₺
    await iade(s1.satisId, su, adet(1), 'NAKIT'); // 10 ₺ kasadan

    expect(cihaz.istekler.filter((i) => i.yol === '/PartialReturn')).toHaveLength(4);

    // --- Kasa hareketleri ---
    tahsilatYap(baglam, a, { cari_id: ayse, tutar: 1500, odeme_tipi: 'NAKIT' });
    kasaHareketi(baglam, a, 'GIDER', 700, 'çay');

    // --- Tedarikçi: 10 su × 8 ₺ = 80 ₺, 30 ₺ nakit ödendi; sonra 2 su borçtan, 1 su nakit iade ---
    malKabulOnayla(baglam, a, {
      tedarikci_id: tedarikci,
      odenen_tutar: 3000,
      odeme_tipi: 'NAKIT',
      kalemler: [{ urun_id: su, miktar: adet(10), birim_fiyat: 800, kdv_orani: 0 }],
    });
    tedarikciIade(baglam, a, {
      tedarikci_id: tedarikci,
      odeme_sekli: 'CARIDEN_DUS',
      kalemler: [{ urun_id: su, miktar: adet(2), birim_fiyat: 800, kdv_orani: 0 }],
    });
    tedarikciIade(baglam, a, {
      tedarikci_id: tedarikci,
      odeme_sekli: 'NAKIT',
      kalemler: [{ urun_id: su, miktar: adet(1), birim_fiyat: 800, kdv_orani: 0 }],
    });

    // ===== KASA =====
    const kasa = oturumOzeti(vt, a.kasaOturumId!);
    expect(kasa.satis_nakit).toBe(3000 + 9000 + 4000); // S1 + S3 nakit kısmı + S5
    expect(kasa.iade_nakit).toBe(-(4000 + 12000 + 1000)); // S5 iptali + S3 iadesi + S1 iadesi
    expect(kasa.satis_kart).toBe(24000 + 5000 - 12000); // S2 + S3 kart kısmı − karta iade
    expect(kasa.veresiye).toBe(12000 + 2000 - 12000); // veresiye iadesi düşülmüş, net
    expect(kasa.tahsilat).toBe(1500);
    // 100 + 160 − 170 + 15 − 7 − 30 (mal kabul) + 8 (tedarikçi nakit iadesi) = 76 ₺
    expect(kasa.beklenen_nakit).toBe(7600);

    // ===== GÜNLÜK ÖZET / RAPOR =====
    const gun = gunlukOzetTek(vt, bugun())!;
    expect(gun.ciro).toBe(59000 - 4000); // 6 satış − iptal
    expect(gun.iptal_toplam).toBe(4000);
    expect(gun.iade_toplam).toBe(12000 * 3 + 1000);
    expect(gun.islem_sayisi).toBe(5);
    expect(gun.kart).toBe(17000);
    expect(gun.veresiye).toBe(2000); // 120 + 20 − 120
    expect(gun.tahsilat).toBe(1500);
    expect(gun.gider).toBe(700);
    expect(gun.nakit).toBe(7600 - 10000); // kasadaki nakit değişimiyle aynı
    // Elde kalan satış: 6 su (2 S1 + 2 S3 + 2 S6) + 1 deterjan (S2)
    expect(gun.brut_kar).toBe(6 * 400 + 3000);
    expect(gun.kdv_toplam).toBe(2000);

    const rapor = bugunOzeti(baglam, a);
    expect(rapor.netCiro).toBe(6 * 1000 + 12000);

    const urunOzeti = (urunId: string) =>
      vt
        .hazirla('SELECT SUM(adet) adet, SUM(ciro) ciro, SUM(kar) kar FROM urun_satis_ozet WHERE urun_id = ?')
        .tek<{ adet: number; ciro: number; kar: number }>(urunId);
    expect(urunOzeti(su)).toEqual({ adet: adet(6), ciro: 6000, kar: 2400 });
    expect(urunOzeti(det)).toEqual({ adet: adet(1), ciro: 12000, kar: 3000 });

    // ===== STOK ve MALİYET =====
    // Su: 50 − 3 − 2 − 4 + 4 + 1 − 2 + 10 − 2 − 1 = 51; deterjan: 20 − 4 + 3 = 19
    expect(stokOku(vt, su)).toBe(adet(51));
    expect(stokOku(vt, det)).toBe(adet(19));
    expect(stokMutabakati(vt)).toEqual([]);
    // Mal kabulde eldeki 44 su × 6 ₺ + 10 × 8 ₺ → 6,37 ₺; çıkışlar ortalamayı değiştirmez.
    expect(ortalamaMaliyetHesapla(vt, su)).toBe(Math.round((44 * 600 + 10 * 800) / 54));

    // ===== CARİLER =====
    expect(bakiyeOku(vt, ayse)).toBe(12000 + 2000 - 12000 - 1500); // 5 ₺ borçlu
    expect(bakiyeOku(vt, tedarikci)).toBe(8000 - 3000 - 1600); // 34 ₺ borcumuz

    // ===== GÜN SONU =====
    const z = gunSonu(baglam, a, 7600);
    expect(z.beklenenNakit).toBe(7600);
    expect(z.kasaFarki).toBe(0);
  });
});
