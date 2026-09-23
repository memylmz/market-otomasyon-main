/**
 * Panelden inen talimatların ATOMİKLİĞİ (§10.4, §10.7, §11.8).
 *
 * NEDEN VAR: talimat uygulanıyor, ardından AYRI bir yazmayla "uygulandı" diye
 * işaretleniyordu. Arada elektrik kesilirse işlem yapılmış ama talimat
 * "bekliyor" kalıyor ve bir sonraki senkronda TEKRAR uygulanıyordu. Deneyle
 * ölçüldü: alış faturasında stok 10→20 adet, tedarikçi borcu 120→240 TL,
 * fatura sayısı 1→2. Aşağıdaki lastik kaldırılırsa hata geri döner.
 *
 * NASIL SINANIYOR: "işaret yazılamadı" durumu bir SQLite tetikleyicisiyle
 * zorlanır. Uygulama ile işaret aynı işlemdeyse, işaret düştüğünde İŞLEMİN
 * KENDİSİ de geri alınmalıdır — stok artmamalı, borç doğmamalı, fatura
 * oluşmamalıdır.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet, simdi, uuid } from '@market/shared';
import { cariBul } from '../src/main/depo/cari.js';
import { stokOku } from '../src/main/depo/stok.js';
import { alisTalimatiniSakla, bekleyenAlisTalimatlariniIsle } from '../src/main/servis/alis-talimat-servis.js';
import { tedarikciEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

/** Panelin yazdığı alış talimatının kasadaki karşılığını kurar. */
function talimatYaz(tedarikciId: string, urunId: string): string {
  const vt = ortam.uygulama.baglam.vt;
  const id = uuid();
  vt.islem(() =>
    alisTalimatiniSakla(vt, {
      id,
      tip: 'OLUSTUR',
      fatura_id: null,
      veri: {
        tip: 'OLUSTUR',
        tedarikci_id: tedarikciId,
        odenen_tutar: 0,
        odeme_tipi: 'HAVALE',
        kalemler: [{ urun_id: urunId, miktar: adet(10), birim_fiyat: 1000, kdv_orani: 20 }],
      },
      hedef_cihaz_id: ortam.uygulama.cihazId,
      created_at: simdi(),
    }),
  );
  return id;
}

describe('alış talimatı atomikliği', () => {
  it('işaret yazılamazsa fatura da stok da borç da OLUŞMAZ', () => {
    const vt = ortam.uygulama.baglam.vt;
    const tedarikciId = tedarikciEkle(ortam, 'Toptancı');
    const urunId = urunEkle(ortam, { ad: 'Kola', stok: adet(0), alisFiyati: 1000 });
    talimatYaz(tedarikciId, urunId);

    // "uygulandı" işaretinin diske yazılamadığı anı zorla.
    vt.hazirla(
      `CREATE TRIGGER test_isaret_engeli BEFORE UPDATE ON alis_talimatlari
       WHEN NEW.uygulandi_mi = 1
       BEGIN SELECT RAISE(ABORT, 'test: isaret yazilamadi'); END`,
    ).calistir();

    const sonuc = bekleyenAlisTalimatlariniIsle(ortam.uygulama.baglam, ortam.admin);

    expect(sonuc, 'talimat başarısız sayılmalı').toEqual({ uygulanan: 0, basarisiz: 1 });
    expect(stokOku(vt, urunId), 'stok artmamalı').toBe(0);
    expect(cariBul(vt, tedarikciId)?.bakiye, 'tedarikçiye borç doğmamalı').toBe(0);
    expect(
      vt.hazirla('SELECT COUNT(*) AS adet FROM alis_faturalari').tek<{ adet: number }>()!.adet,
      'fatura oluşmamalı',
    ).toBe(0);
  });

  it('normal akışta tam olarak bir kez uygulanır', () => {
    const vt = ortam.uygulama.baglam.vt;
    const tedarikciId = tedarikciEkle(ortam);
    const urunId = urunEkle(ortam, { ad: 'Kola', stok: adet(0), alisFiyati: 1000 });
    talimatYaz(tedarikciId, urunId);

    expect(bekleyenAlisTalimatlariniIsle(ortam.uygulama.baglam, ortam.admin)).toEqual({ uygulanan: 1, basarisiz: 0 });
    // İkinci tur: işaret yerinde olduğu için talimat yeniden alınmaz.
    expect(bekleyenAlisTalimatlariniIsle(ortam.uygulama.baglam, ortam.admin)).toEqual({ uygulanan: 0, basarisiz: 0 });

    expect(stokOku(vt, urunId)).toBe(adet(10));
    expect(vt.hazirla('SELECT COUNT(*) AS adet FROM alis_faturalari').tek<{ adet: number }>()!.adet).toBe(1);
  });
});
