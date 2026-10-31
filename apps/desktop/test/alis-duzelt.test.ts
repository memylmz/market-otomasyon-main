/**
 * Alış faturasını DÜZENLEME: eskisi ters kayıtla iptal, yeni hâli kayıt —
 * tek işlemde. Stok, tedarikçi borcu ve kasa yeni hâle göre tutmalı; bir şey
 * ters giderse hiçbir şey değişmemeli.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet } from '@market/shared';
import { cariBul } from '../src/main/depo/cari.js';
import { alisFaturasiBul } from '../src/main/depo/satis.js';
import { bekleyenOlaylar } from '../src/main/depo/senkron.js';
import { stokOku } from '../src/main/depo/stok.js';
import { alisFaturasiDuzelt, alisFaturasiIptal, malKabulOnayla } from '../src/main/servis/stok-servis.js';
import { tedarikciEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;
let tedarikci: string;
let urun: string;

beforeEach(async () => {
  ortam = await testOrtamiKur();
  tedarikci = tedarikciEkle(ortam);
  urun = urunEkle(ortam, { stok: adet(100) });
});

afterEach(async () => {
  await ortam.temizle();
});

const fatura = (miktar: number, birim: number, ek: Record<string, unknown> = {}) => ({
  tedarikci_id: tedarikci,
  fatura_no: 'F-1',
  kdv_dahil: true,
  kalemler: [{ urun_id: urun, miktar: adet(miktar), birim_fiyat: birim, kdv_orani: 0 }],
  ...ek,
});
const vt = () => ortam.uygulama.baglam.vt;
const borc = () => cariBul(vt(), tedarikci)?.bakiye ?? 0;
const kasaNakdi = () =>
  vt()
    .hazirla('SELECT COALESCE(SUM(tutar), 0) AS t FROM kasa_hareketleri WHERE kasa_oturum_id = ?')
    .tek<{ t: number }>(ortam.admin.kasaOturumId)?.t ?? 0;

describe('alış faturası düzenleme', () => {
  it('miktar ve fiyat değişir: stok ve borç yeni hâle göre, eski fatura iptal, yenisi bağlı', () => {
    const eski = malKabulOnayla(ortam.uygulama.baglam, ortam.admin, fatura(10, 1000));
    expect(stokOku(vt(), urun)).toBe(adet(110));
    const borcOnce = borc();

    const yeni = alisFaturasiDuzelt(ortam.uygulama.baglam, ortam.admin, eski.faturaId, fatura(12, 1100));

    expect(stokOku(vt(), urun)).toBe(adet(112));
    expect(borc() - borcOnce).toBe(yeni.genelToplam - eski.genelToplam);
    expect(alisFaturasiBul(vt(), eski.faturaId)?.durum).toBe('IPTAL');
    const yeniKayit = alisFaturasiBul(vt(), yeni.faturaId);
    expect(yeniKayit).toMatchObject({ durum: 'ONAYLANDI', duzeltilen_fatura_id: eski.faturaId, kdv_dahil: true });

    // Buluta giden: mevcut iptal + onay olayları (sunucu değişmeden çalışır).
    const tipler = bekleyenOlaylar(vt(), 500).map((o) => o.olay_tipi);
    expect(tipler).toContain('ALIS_FATURASI_IPTAL');
    expect(tipler.filter((t) => t === 'ALIS_FATURASI_ONAYLANDI')).toHaveLength(2);
  });

  it('yeni hâl geçersizse HİÇBİR ŞEY değişmez (eski fatura iptal edilmez)', () => {
    const eski = malKabulOnayla(ortam.uygulama.baglam, ortam.admin, fatura(10, 1000));
    const borcOnce = borc();
    expect(() =>
      alisFaturasiDuzelt(ortam.uygulama.baglam, ortam.admin, eski.faturaId, { ...fatura(1, 1000), kalemler: [] }),
    ).toThrow();
    expect(alisFaturasiBul(vt(), eski.faturaId)?.durum).toBe('ONAYLANDI');
    expect(stokOku(vt(), urun)).toBe(adet(110));
    expect(borc()).toBe(borcOnce);
  });

  it('nakit ödenmiş fatura: kasa yalnız fark kadar değişir', () => {
    const eski = malKabulOnayla(
      ortam.uygulama.baglam,
      ortam.admin,
      fatura(10, 1000, { odenen_tutar: 10_000, odeme_tipi: 'NAKIT' }),
    );
    const kasaOnce = kasaNakdi();
    const detay = alisFaturasiBul(vt(), eski.faturaId);
    expect(detay).toMatchObject({ nakit_odendi: true, odenen: 10_000 });

    alisFaturasiDuzelt(
      ortam.uygulama.baglam,
      ortam.admin,
      eski.faturaId,
      fatura(10, 1200, { odenen_tutar: 12_000, odeme_tipi: 'NAKIT' }),
    );
    // Eski 100 TL kasaya geri girer, yeni 120 TL çıkar: net -20 TL.
    expect(kasaNakdi() - kasaOnce).toBe(-2000);
    expect(borc()).toBe(0);
  });

  it('iptal edilmiş fatura düzenlenemez', () => {
    const eski = malKabulOnayla(ortam.uygulama.baglam, ortam.admin, fatura(10, 1000));
    alisFaturasiIptal(ortam.uygulama.baglam, ortam.admin, eski.faturaId, 'deneme');
    expect(() => alisFaturasiDuzelt(ortam.uygulama.baglam, ortam.admin, eski.faturaId, fatura(5, 1000))).toThrow(/İptal edilmiş/);
  });

  it('kdv_dahil verilmeyen (eski) faturada bilgi boş kalır', () => {
    const { faturaId } = malKabulOnayla(ortam.uygulama.baglam, ortam.admin, { ...fatura(1, 1000), kdv_dahil: undefined });
    expect(alisFaturasiBul(vt(), faturaId)?.kdv_dahil).toBeNull();
  });
});
