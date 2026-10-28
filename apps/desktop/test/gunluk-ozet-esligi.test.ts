/**
 * Kasa ↔ merkez günlük özet eşliği (§7.3).
 *
 * Satış/iade/iptal dışındaki nakit hareketlerinin günlük özete etkisi kasada
 * belirlenir ve KASA_HAREKETI olayıyla AYNEN buluta gider. Eskiden merkez
 * özeti kendi kuralıyla kuruyordu: para giriş/çıkışı, mal kabulde nakit ödeme,
 * tedarikçinin nakit iadesi, alış iptali ve tahsilat iptali kasada nakde
 * yazılıyor, merkezde yazılmıyordu.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet, bugun } from '@market/shared';
import { gunlukOzetTek } from '../src/main/depo/ozet.js';
import { bekleyenOlaylar } from '../src/main/depo/senkron.js';
import { kasaHareketi } from '../src/main/servis/kasa-servis.js';
import { tahsilatIptal, tahsilatYap } from '../src/main/servis/cari-servis.js';
import { alisFaturasiIptal, malKabulOnayla, tedarikciIade } from '../src/main/servis/stok-servis.js';
import { musteriEkle, tedarikciEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

describe('günlük özet eşliği', () => {
  it('olaylarla giden özet etkilerinin toplamı kasanın günlük özetine eşittir', () => {
    const { baglam, vt } = ortam.uygulama;
    const a = ortam.admin;
    const urunId = urunEkle(ortam, { ad: 'Un', satisFiyati: 5000, stok: adet(10) });
    const tedarikciId = tedarikciEkle(ortam);
    const musteriId = musteriEkle(ortam, 'Ayşe');

    kasaHareketi(baglam, a, 'GIRIS', 5000, 'bozuk para');
    kasaHareketi(baglam, a, 'CIKIS', 2000, 'bankaya');
    kasaHareketi(baglam, a, 'GIDER', 700, 'çay');

    const faturaId = malKabulOnayla(baglam, a, {
      tedarikci_id: tedarikciId,
      odenen_tutar: 3000,
      odeme_tipi: 'NAKIT',
      kalemler: [{ urun_id: urunId, miktar: adet(2), birim_fiyat: 2000, kdv_orani: 0 }],
    }).faturaId;
    tedarikciIade(baglam, a, {
      tedarikci_id: tedarikciId,
      odeme_sekli: 'NAKIT',
      kalemler: [{ urun_id: urunId, miktar: adet(1), birim_fiyat: 1000, kdv_orani: 0 }],
    });
    alisFaturasiIptal(baglam, a, faturaId, 'yanlış fatura');

    tahsilatYap(baglam, a, { cari_id: musteriId, tutar: 1500, odeme_tipi: 'NAKIT', avans_kabul: true });
    const tahsilatId = vt
      .hazirla("SELECT id FROM cari_hareketler WHERE cari_id = ? AND hareket_tipi = 'TAHSILAT'")
      .tek<{ id: string }>(musteriId)!.id;
    tahsilatIptal(baglam, a, tahsilatId, 'yanlış tutar');

    // Merkezin uygulayacağı: KASA_HAREKETI olaylarındaki etkiler.
    const merkez = { nakit: 0, tahsilat: 0, gider: 0 };
    for (const olay of bekleyenOlaylar(vt, 1000)) {
      if (olay.olay_tipi !== 'KASA_HAREKETI') continue;
      const etki = (JSON.parse(String(olay.veri)) as { gunluk_ozet?: Partial<typeof merkez> }).gunluk_ozet;
      if (!etki) continue;
      merkez.nakit += etki.nakit ?? 0;
      merkez.tahsilat += etki.tahsilat ?? 0;
      merkez.gider += etki.gider ?? 0;
    }

    const kasa = gunlukOzetTek(vt, bugun())!;
    expect(merkez).toEqual({ nakit: kasa.nakit, tahsilat: kasa.tahsilat, gider: kasa.gider });
    // Somut rakam: +50 −20 −7 −30 +10 +30 (+15 −15) = 33,00 ₺
    expect(kasa.nakit).toBe(5000 - 2000 - 700 - 3000 + 1000 + 3000);
    expect(kasa.gider).toBe(700);
    expect(kasa.tahsilat).toBe(0);

    // Tahsilatın cari olayı özeti merkezde tekrar türetmesin diye işaretlidir.
    const cariOlay = bekleyenOlaylar(vt, 1000).find(
      (o) => o.olay_tipi === 'CARI_HAREKETI' && String(o.veri).includes('"hareket_tipi":"TAHSILAT"'),
    );
    expect(JSON.parse(String(cariOlay?.veri))).toMatchObject({ gunluk_ozet_kasada: true });
  });
});
