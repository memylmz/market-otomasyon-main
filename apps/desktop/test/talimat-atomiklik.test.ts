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
import {
  alisTalimatiniSakla,
  bekleyenAlisTalimatlariniIsle,
  bildirilmemisSonuclariGonder,
} from '../src/main/servis/alis-talimat-servis.js';
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

/**
 * Talimatın SONUCU buluta geri dönmeli (§11.8).
 *
 * NEDEN VAR: akış tek yönlüydü — panel niyeti yazıyor, kasa uyguluyor ve orada
 * bitiyordu. Bulut sonucu hiç öğrenmediği için talimat satırı sonsuza kadar
 * "bekliyor" kalıyor, panel de o faturanın düzenle/iptal düğmelerini bir daha
 * açmıyordu. Outbox'a `TALIMAT_SONUCLANDI` düşmezse o kilit geri gelir.
 */
describe('alış talimatı sonucunun bildirilmesi', () => {
  /** Outbox'taki sonuç olaylarını çözülmüş gövdeleriyle verir. */
  function sonucOlaylari(): { entity_id: string; veri: Record<string, unknown> }[] {
    return ortam.uygulama.baglam.vt
      .hazirla("SELECT entity_id, veri FROM sync_outbox WHERE olay_tipi = 'TALIMAT_SONUCLANDI' ORDER BY rowid")
      .tumu<{ entity_id: string; veri: string }>()
      .map((satir) => ({ entity_id: satir.entity_id, veri: JSON.parse(satir.veri) as Record<string, unknown> }));
  }

  it('uygulandığında sonucu ve ürettiği faturayı bildirir', () => {
    const vt = ortam.uygulama.baglam.vt;
    const tedarikciId = tedarikciEkle(ortam);
    const urunId = urunEkle(ortam, { ad: 'Kola', stok: adet(0), alisFiyati: 1000 });
    const talimatId = talimatYaz(tedarikciId, urunId);

    expect(bekleyenAlisTalimatlariniIsle(ortam.uygulama.baglam, ortam.admin)).toEqual({ uygulanan: 1, basarisiz: 0 });

    const olaylar = sonucOlaylari();
    expect(olaylar, 'tek bir sonuç olayı yazılmalı').toHaveLength(1);
    expect(olaylar[0]!.entity_id).toBe(talimatId);
    expect(olaylar[0]!.veri.uygulandi_mi, 'başarı bildirilmeli').toBe(true);
    expect(olaylar[0]!.veri.hata).toBeNull();
    expect(olaylar[0]!.veri.varlik).toBe('alis_talimatlari');

    // Bildirilen fatura kimliği gerçekten yazılan faturayı göstermeli; yanlış
    // kimlik bildirilirse bulut talimatı asla kapatamaz.
    const faturaId = vt.hazirla('SELECT id FROM alis_faturalari').tek<{ id: string }>()!.id;
    expect(olaylar[0]!.veri.sonuc_fatura_id).toBe(faturaId);
  });

  it('uygulanamadığında hatayı bildirir ve olay tek kalır', () => {
    const tedarikciId = tedarikciEkle(ortam);
    // Var olmayan ürün: mal kabul reddeder.
    const talimatId = talimatYaz(tedarikciId, uuid());

    expect(bekleyenAlisTalimatlariniIsle(ortam.uygulama.baglam, ortam.admin)).toEqual({ uygulanan: 0, basarisiz: 1 });

    const olaylar = sonucOlaylari();
    expect(olaylar).toHaveLength(1);
    expect(olaylar[0]!.entity_id).toBe(talimatId);
    expect(olaylar[0]!.veri.uygulandi_mi, 'başarısızlık bildirilmeli').toBe(false);
    expect(olaylar[0]!.veri.hata, 'sebep yazılmalı').toBeTruthy();
    expect(olaylar[0]!.veri.sonuc_fatura_id).toBeNull();
  });

  it('işaret yazılamazsa sonuç da bildirilmez — yarım bildirim olmaz', () => {
    const vt = ortam.uygulama.baglam.vt;
    const tedarikciId = tedarikciEkle(ortam);
    const urunId = urunEkle(ortam, { ad: 'Kola', stok: adet(0), alisFiyati: 1000 });
    talimatYaz(tedarikciId, urunId);

    vt.hazirla(
      `CREATE TRIGGER test_isaret_engeli BEFORE UPDATE ON alis_talimatlari
       WHEN NEW.uygulandi_mi = 1
       BEGIN SELECT RAISE(ABORT, 'test: isaret yazilamadi'); END`,
    ).calistir();

    expect(bekleyenAlisTalimatlariniIsle(ortam.uygulama.baglam, ortam.admin)).toEqual({ uygulanan: 0, basarisiz: 1 });

    // Başarı olayı geri alınmalı; geriye YALNIZ hata bildirimi kalmalı. Aksi
    // halde bulut "uygulandı" sanıp talimatı kapatır, kasa ise yeniden dener.
    const olaylar = sonucOlaylari();
    expect(olaylar).toHaveLength(1);
    expect(olaylar[0]!.veri.uygulandi_mi).toBe(false);
  });
});

/**
 * Sonuç bildirimi olmadan uygulanmış ESKİ talimatların telafisi (§11.8).
 *
 * NEDEN VAR: bildirim sonradan eklendi. O ana kadar uygulanmış talimatlar
 * bulutta sonsuza kadar "bekliyor" kaldı; panel o faturaların düzenle/iptal
 * düğmelerini bir daha açmadı. Kilit ancak kasanın geriye dönük bildirimiyle
 * açılır — hangi talimatın uygulandığını yalnız kasa bilir.
 */
describe('bildirilmemiş sonuçların telafisi', () => {
  /** Bildirim mekanizmasından ÖNCEKİ durumu kurar: uygulanmış ama bildirilmemiş. */
  function eskiUygulanmisTalimat(faturaId: string | null): string {
    const vt = ortam.uygulama.baglam.vt;
    const id = uuid();
    vt.islem(() => {
      alisTalimatiniSakla(vt, {
        id,
        tip: 'GUNCELLE',
        fatura_id: faturaId,
        veri: { tip: 'GUNCELLE', fatura_no: 'ESKI-1' },
        hedef_cihaz_id: ortam.uygulama.cihazId,
        created_at: simdi(),
      });
      vt.hazirla(
        'UPDATE alis_talimatlari SET uygulandi_mi = 1, sonuc_fatura_id = ?, sonuc_bildirildi_mi = 0 WHERE id = ?',
      ).calistir(faturaId, id);
    });
    return id;
  }

  function sonucOlaylari(): { entity_id: string; veri: Record<string, unknown> }[] {
    return ortam.uygulama.baglam.vt
      .hazirla("SELECT entity_id, veri FROM sync_outbox WHERE olay_tipi = 'TALIMAT_SONUCLANDI' ORDER BY rowid")
      .tumu<{ entity_id: string; veri: string }>()
      .map((satir) => ({ entity_id: satir.entity_id, veri: JSON.parse(satir.veri) as Record<string, unknown> }));
  }

  it('uygulanmış ama bildirilmemiş talimatı geriye dönük bildirir', () => {
    const faturaId = uuid();
    const talimatId = eskiUygulanmisTalimat(faturaId);

    expect(bildirilmemisSonuclariGonder(ortam.uygulama.baglam)).toBe(1);

    const olaylar = sonucOlaylari();
    expect(olaylar).toHaveLength(1);
    expect(olaylar[0]!.entity_id).toBe(talimatId);
    expect(olaylar[0]!.veri.uygulandi_mi).toBe(true);
    // Fatura kimliği taşınmalı; bulut talimatı doğru belgeye bağlayabilsin.
    expect(olaylar[0]!.veri.sonuc_fatura_id).toBe(faturaId);
  });

  it('ikinci çağrıda tekrar bildirmez', () => {
    eskiUygulanmisTalimat(uuid());

    expect(bildirilmemisSonuclariGonder(ortam.uygulama.baglam)).toBe(1);
    // İşaret konduğu için sorgu artık boş döner; yoksa her açılışta kuyruk şişerdi.
    expect(bildirilmemisSonuclariGonder(ortam.uygulama.baglam)).toBe(0);
    expect(sonucOlaylari()).toHaveLength(1);
  });

  it('henüz uygulanmamış talimatı bildirmez', () => {
    const tedarikciId = tedarikciEkle(ortam);
    const urunId = urunEkle(ortam, { ad: 'Kola', stok: adet(0), alisFiyati: 1000 });
    talimatYaz(tedarikciId, urunId);

    // Bekleyen talimatın sonucu HENÜZ YOK; "uygulandı" bildirmek bulutta
    // hiç yapılmamış bir işi kapatmak olurdu.
    expect(bildirilmemisSonuclariGonder(ortam.uygulama.baglam)).toBe(0);
    expect(sonucOlaylari()).toHaveLength(0);
  });

  it('normal akışta uygulanan talimat telafiye kalmaz', () => {
    const tedarikciId = tedarikciEkle(ortam);
    const urunId = urunEkle(ortam, { ad: 'Kola', stok: adet(0), alisFiyati: 1000 });
    talimatYaz(tedarikciId, urunId);
    bekleyenAlisTalimatlariniIsle(ortam.uygulama.baglam, ortam.admin);

    // Bildirim uygulama anında yazıldığı için telafiye iş düşmemeli; düşseydi
    // aynı sonuç iki kez bildirilirdi.
    expect(bildirilmemisSonuclariGonder(ortam.uygulama.baglam)).toBe(0);
    expect(sonucOlaylari()).toHaveLength(1);
  });
});
