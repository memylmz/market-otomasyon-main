/**
 * Panelden inen alış talimatı katalogda olmayan ürünü de açar.
 *
 * Panel belgeyi ÜRETMEZ, yalnız niyeti yazar; kasa onu kendi mal kabul
 * servisinden geçirir. Bu test o yolun uçtan uca çalıştığını ve talimatın
 * ikinci kez uygulanmadığını kilitler.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet, simdi, uuid } from '@market/shared';
import { barkodSahibi, urunBul } from '../src/main/depo/katalog.js';
import { stokOku } from '../src/main/depo/stok.js';
import { alisTalimatiniSakla, bekleyenAlisTalimatlariniIsle } from '../src/main/servis/alis-talimat-servis.js';
import { tedarikciEkle, testOrtamiKur, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

/** Panelin yazdığı talimatın kasadaki karşılığını kurar. */
function talimatYaz(tedarikciId: string): string {
  const id = uuid();
  ortam.uygulama.baglam.vt.islem(() =>
    alisTalimatiniSakla(ortam.uygulama.baglam.vt, {
      id,
      tip: 'OLUSTUR',
      fatura_id: null,
      veri: {
        tip: 'OLUSTUR',
        tedarikci_id: tedarikciId,
        fatura_no: 'PANEL-1',
        odenen_tutar: 0,
        odeme_tipi: 'HAVALE',
        kalemler: [
          {
            yeni_urun: { ad: 'Panelden Gelen Kola', barkod: '8690000000031', satis_fiyati: 2500 },
            miktar: adet(6),
            birim_fiyat: 1500,
            kdv_orani: 20,
          },
        ],
      },
      hedef_cihaz_id: ortam.uygulama.cihazId,
      created_at: simdi(),
    }),
  );
  return id;
}

describe('panelden inen yeni ürünlü alış talimatı', () => {
  it('ürün kartını ve faturayı kasada üretir', () => {
    const tedarikciId = tedarikciEkle(ortam, 'Panel Toptancısı');
    talimatYaz(tedarikciId);

    const sonuc = bekleyenAlisTalimatlariniIsle(ortam.uygulama.baglam, ortam.admin);
    expect(sonuc).toEqual({ uygulanan: 1, basarisiz: 0 });

    const urunId = barkodSahibi(ortam.uygulama.baglam.vt, '8690000000031');
    expect(urunId).not.toBeNull();
    expect(urunBul(ortam.uygulama.baglam.vt, urunId!)?.varsayilan_tedarikci_id).toBe(tedarikciId);
    expect(stokOku(ortam.uygulama.baglam.vt, urunId!)).toBe(adet(6));
  });

  it('ikinci kez işlenince tekrar uygulanmaz', () => {
    const tedarikciId = tedarikciEkle(ortam);
    talimatYaz(tedarikciId);

    bekleyenAlisTalimatlariniIsle(ortam.uygulama.baglam, ortam.admin);
    const ikinci = bekleyenAlisTalimatlariniIsle(ortam.uygulama.baglam, ortam.admin);
    expect(ikinci).toEqual({ uygulanan: 0, basarisiz: 0 });

    const faturalar = ortam.uygulama.baglam.vt.hazirla('SELECT COUNT(*) AS adet FROM alis_faturalari').tek<{ adet: number }>();
    expect(faturalar?.adet).toBe(1);
  });
});
