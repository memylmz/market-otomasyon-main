/**
 * Kasada kampanya yönetimi (§11.8).
 *
 * Kampanya eskiden yalnız panelden yönetiliyordu; kasadaki eski kaydet olay
 * üretmediği için kampanya o kasada kalıyordu. Artık kasada kaydedilen
 * kampanya hem burada hemen geçerli olur hem de olayla buluta gider.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HATA_KODU } from '@market/shared';
import { etkinKampanyalar, kampanyaSunucudanUygula, kampanyalariListele } from '../src/main/depo/katalog.js';
import { bekleyenOlaylar } from '../src/main/depo/senkron.js';
import { kampanyaKaydet } from '../src/main/servis/katalog-servis.js';
import { testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

const gun = (fark: number) => new Date(Date.now() + fark * 86_400_000).toISOString();

function yuzdeKampanyasi(ek: Record<string, unknown> = {}) {
  return { ad: 'Hafta sonu %10', tip: 'YUZDE', kapsam: 'TUM', deger: 10, baslangic: gun(-1), bitis: gun(7), ...ek };
}

describe('kasada kampanya', () => {
  it('kaydedilen kampanya hemen etkin olur ve buluta olay olarak gider', () => {
    const { baglam, vt } = ortam.uygulama;
    const { id } = kampanyaKaydet(baglam, ortam.admin, yuzdeKampanyasi());

    expect(etkinKampanyalar(vt).map((k) => k.id)).toEqual([id]);
    const olay = bekleyenOlaylar(vt, 1000).find((o) => o.olay_tipi === 'KAMPANYA_KAYDEDILDI');
    expect(olay?.entity_id).toBe(id);
    const veri = JSON.parse(String(olay?.veri)) as Record<string, unknown>;
    // aktif_mi BOOLEAN gitmeli: bulut `=== false` ile karşılaştırıyor.
    expect(veri).toMatchObject({ id, ad: 'Hafta sonu %10', tip: 'YUZDE', deger: 10, aktif_mi: true });
  });

  it('düzenleme aynı kaydı günceller, oluşturma zamanı korunur; pasife alınan kampanya uygulanmaz', () => {
    const { baglam, vt } = ortam.uygulama;
    const { id } = kampanyaKaydet(baglam, ortam.admin, yuzdeKampanyasi());
    const ilk = vt.hazirla('SELECT created_at FROM kampanyalar WHERE id = ?').tek<{ created_at: string }>(id)!;

    kampanyaKaydet(baglam, ortam.admin, yuzdeKampanyasi({ id, ad: 'Bitti', aktif_mi: false }));

    expect(kampanyalariListele(vt)).toHaveLength(1);
    expect(kampanyalariListele(vt)[0]).toMatchObject({ ad: 'Bitti', aktif_mi: false });
    expect(vt.hazirla('SELECT created_at FROM kampanyalar WHERE id = ?').tek<{ created_at: string }>(id)!.created_at).toBe(
      ilk.created_at,
    );
    expect(etkinKampanyalar(vt)).toEqual([]);
  });

  it('3 al 2 öde ürün kapsamında eşikle kaydedilir', () => {
    const urunId = urunEkle(ortam, { ad: 'Çikolata', satisFiyati: 3000 });
    kampanyaKaydet(ortam.uygulama.baglam, ortam.admin, {
      ad: '3 al 2 öde',
      tip: 'N_AL_M_ODE',
      kapsam: 'URUN',
      hedef_id: urunId,
      deger: 2,
      esik_miktar: 3000,
      baslangic: gun(-1),
      bitis: gun(3),
    });
    expect(etkinKampanyalar(ortam.uygulama.vt)[0]).toMatchObject({ hedef_id: urunId, esik_miktar: 3000, deger: 2 });
  });

  it.each([
    ['bitiş başlangıçtan önce', { bitis: gun(-2) }, /Bitiş/],
    ['ürün kapsamında hedef yok', { kapsam: 'URUN' }, /ürün seçin/i],
    ['yüzde 100 üstü', { deger: 150 }, /yüzdesi/],
    ['3 al 3 öde', { tip: 'N_AL_M_ODE', deger: 3, esik_miktar: 3000 }, /Ödenen adet/],
  ])('geçersiz kampanya reddedilir: %s', (_ad, ek, mesaj) => {
    expect(() => kampanyaKaydet(ortam.uygulama.baglam, ortam.admin, yuzdeKampanyasi(ek))).toThrow(mesaj);
    expect(kampanyalariListele(ortam.uygulama.vt)).toEqual([]);
  });

  it('kasiyer kampanya kaydedemez', () => {
    expect(() => kampanyaKaydet(ortam.uygulama.baglam, ortam.kasiyer, yuzdeKampanyasi())).toThrow(
      expect.objectContaining({ kod: HATA_KODU.YETKI }),
    );
  });

  it('buluttan gelen ESKİ kayıt kasadaki daha yeni değişikliği ezmez', () => {
    const { baglam, vt } = ortam.uygulama;
    const { id } = kampanyaKaydet(baglam, ortam.admin, yuzdeKampanyasi({ ad: 'Kasadaki yeni' }));
    kampanyaSunucudanUygula(vt, { ...yuzdeKampanyasi({ ad: 'Buluttaki eski' }), id, updated_at: gun(-3) }, 5);
    expect(kampanyalariListele(vt)[0]?.ad).toBe('Kasadaki yeni');

    kampanyaSunucudanUygula(vt, { ...yuzdeKampanyasi({ ad: 'Panelden yeni' }), id, updated_at: gun(1) }, 6);
    expect(kampanyalariListele(vt)[0]?.ad).toBe('Panelden yeni');
  });
});
