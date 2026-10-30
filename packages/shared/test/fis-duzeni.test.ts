import { describe, expect, it } from 'vitest';
import { ekstreBelgesi, satisBelgesi, type FisSatisVerisi } from '../src/fis-belge.js';
import { fisDuzeniCoz, VARSAYILAN_FIS_DUZENI } from '../src/fis-duzeni.js';
import { belgeHtml } from '../src/fis-html.js';

const isletme = { ad: 'Cadan Market', adres: 'Yeni Mah.', telefon: '0555', vergiNo: '123', altMetin: null };

function satis(odemeTipi = 'NAKIT'): FisSatisVerisi {
  return {
    satis: {
      fis_no: 'NA-000001',
      tarih: '2026-10-30T10:00:00.000Z',
      musteri_adi: 'Ahmet',
      ara_toplam: 6500,
      iskonto_toplam: 0,
      genel_toplam: 6500,
    },
    kalemler: [
      {
        urun_adi: 'Süt',
        miktar: 2000,
        birim_tipi: 'ADET',
        birim_fiyat: 3250,
        iskonto: 0,
        kdv_orani: 1,
        kdv_tutar: 64,
        satir_toplam: 6500,
      },
    ],
    odemeler: [{ odeme_tipi: odemeTipi, tutar: 6500, alinan: 6500, para_ustu: 0 }],
  };
}

describe('fisDuzeniCoz', () => {
  it('boş ya da bozuk ayar varsayılana düşer', () => {
    expect(fisDuzeniCoz(undefined)).toEqual(VARSAYILAN_FIS_DUZENI);
    expect(fisDuzeniCoz('{bozuk')).toEqual(VARSAYILAN_FIS_DUZENI);
    expect(fisDuzeniCoz('[1,2]')).toEqual(VARSAYILAN_FIS_DUZENI);
  });

  it('geçersiz alanlar tek tek varsayılana düşer, geçerliler korunur', () => {
    const d = fisDuzeniCoz(JSON.stringify({ yaziBoyutu: 'dev', adres: false, ekstreHareketSayisi: 2, ustMetin: 42 }));
    expect(d.yaziBoyutu).toBe('normal');
    expect(d.adres).toBe(false);
    expect(d.ekstreHareketSayisi).toBe(60);
    expect(d.ustMetin).toBe('');
  });
});

describe('düzen fişe uygulanır', () => {
  const kapali = {
    ...VARSAYILAN_FIS_DUZENI,
    adres: false,
    telefon: false,
    vergiNo: false,
    kasiyer: false,
    musteri: false,
    kdvDokumu: false,
    fisBarkodu: false,
    kalemDetayi: false,
    ustMetin: 'Hoş geldiniz',
    yaziBoyutu: 'buyuk' as const,
  };

  it('kapatılan alanlar fişten kalkar', () => {
    const b = satisBelgesi(satis(), isletme, { kasiyerAdi: 'Ayşe', yasalUyari: 'BİLGİ', duzen: kapali });
    expect(b.isletmeSatirlari).toEqual([]);
    expect(b.meta.map((m) => m.etiket)).toEqual(['FİŞ NO', 'TARİH']);
    expect(b.araSatirlar.some((s) => s.etiket.startsWith('KDV'))).toBe(false);
    expect(b.barkod).toBeNull();
    expect(b.ustMetin).toBe('Hoş geldiniz');
    expect(b.yaziOlcegi).toBeGreaterThan(1);
    const html = belgeHtml(b, 576);
    expect(html).toContain('Hoş geldiniz');
    // Ayrıntı satırı yok ama 2 adet olduğu adın yanında yazar.
    expect(html).not.toContain('class="detay');
    expect(html).toContain('× 2 ad');
    // Yasal uyarı kapatılamaz.
    expect(html).toContain('BİLGİ');
  });

  it('veresiye fişinde müşteri adı düzen kapatsa da basılır', () => {
    const b = satisBelgesi(satis('VERESIYE'), isletme, { yasalUyari: 'BİLGİ', duzen: kapali });
    expect(b.meta.some((m) => m.etiket === 'MÜŞTERİ')).toBe(true);
  });

  it('düzen verilmezse eski görünüm aynen kalır', () => {
    const b = satisBelgesi(satis(), isletme, { kasiyerAdi: 'Ayşe', yasalUyari: 'BİLGİ' });
    expect(b.isletmeSatirlari).toHaveLength(3);
    expect(b.barkod).toBe('NA000001');
    expect(belgeHtml(b, 576)).toContain('class="detay');
  });

  it('ekstre hareket sayısı ve dönem özeti düzene uyar', () => {
    const hareketler = Array.from({ length: 30 }, (_, i) => ({
      tarih: '2026-10-01T10:00:00.000Z',
      aciklama: `H${i}`,
      tutar: 100,
      yuruyen_bakiye: (i + 1) * 100,
    }));
    const e = ekstreBelgesi({ ad_unvan: 'Ahmet', bakiye: 3000 }, hareketler, isletme, {
      yasalUyari: 'BİLGİ',
      duzen: { ...VARSAYILAN_FIS_DUZENI, ekstreHareketSayisi: 20, ekstreOzet: false },
    });
    expect(e.hareketler).toHaveLength(20);
    expect(e.hareketler[0]?.aciklama).toBe('H10');
    expect(e.ozet).toEqual([]);
  });
});
