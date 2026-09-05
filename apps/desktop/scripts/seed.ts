/**
 * Demo veri üreteci (§12.3).
 *
 * Gerçek bir marketin bir haftalık hareketini taklit eder: katalog, açılış stoğu,
 * cariler, satışlar, tahsilatlar. Böylece raporlar ve panel boş görünmez.
 *
 * Kullanım:
 *   npm run seed -w @market/desktop                 # varsayılan veri klasörüne
 *   npm run seed -w @market/desktop -- --kok ./demo # belirli bir klasöre
 *
 * ⚠️ Demo veri gerçek veriyle karıştırılmamalıdır. Ayrı bir klasöre üretin.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { adet, etkinYetkiler, miktarOlustur, type Kurus } from '@market/shared';
import { kasaAc, gunSonu } from '../src/main/servis/kasa-servis.js';
import { cariKaydet, tahsilatYap } from '../src/main/servis/cari-servis.js';
import { urunuKaydet } from '../src/main/servis/katalog-servis.js';
import { satisKesinlestir } from '../src/main/servis/satis-servis.js';
import { malKabulOnayla } from '../src/main/servis/stok-servis.js';
import type { Aktor } from '../src/main/servis/baglam.js';
import { Uygulama } from '../src/main/uygulama.js';

function argOku(ad: string, varsayilan: string): string {
  const i = process.argv.indexOf(`--${ad}`);
  return i >= 0 ? (process.argv[i + 1] ?? varsayilan) : varsayilan;
}

interface UrunTanimi {
  ad: string;
  barkod: string;
  kategori: string;
  alis: Kurus;
  satis: Kurus;
  kdv: number;
  birim: 'ADET' | 'KG' | 'LT';
  stok: number;
}

const KATALOG: UrunTanimi[] = [
  {
    ad: 'Tam Yağlı Süt 1 L',
    barkod: '8690000000017',
    kategori: 'Süt Ürünleri',
    alis: 1850,
    satis: 2490,
    kdv: 1,
    birim: 'ADET',
    stok: 40,
  },
  {
    ad: 'Beyaz Peynir 500 g',
    barkod: '8690000000024',
    kategori: 'Süt Ürünleri',
    alis: 8900,
    satis: 12500,
    kdv: 1,
    birim: 'ADET',
    stok: 18,
  },
  {
    ad: "Yumurta 10'lu",
    barkod: '8690000000031',
    kategori: 'Süt Ürünleri',
    alis: 5500,
    satis: 7250,
    kdv: 1,
    birim: 'ADET',
    stok: 30,
  },
  { ad: 'Ekmek', barkod: '8690000000048', kategori: 'Fırın', alis: 700, satis: 1000, kdv: 1, birim: 'ADET', stok: 60 },
  {
    ad: 'Ayçiçek Yağı 1 L',
    barkod: '8690000000055',
    kategori: 'Temel Gıda',
    alis: 6400,
    satis: 8990,
    kdv: 10,
    birim: 'ADET',
    stok: 25,
  },
  {
    ad: 'Toz Şeker 1 kg',
    barkod: '8690000000062',
    kategori: 'Temel Gıda',
    alis: 3200,
    satis: 4490,
    kdv: 1,
    birim: 'ADET',
    stok: 35,
  },
  {
    ad: 'Pirinç 1 kg',
    barkod: '8690000000079',
    kategori: 'Temel Gıda',
    alis: 5800,
    satis: 7990,
    kdv: 1,
    birim: 'ADET',
    stok: 22,
  },
  { ad: 'Çay 1 kg', barkod: '8690000000086', kategori: 'İçecek', alis: 14500, satis: 19900, kdv: 10, birim: 'ADET', stok: 15 },
  { ad: 'Kola 1 L', barkod: '8690000000093', kategori: 'İçecek', alis: 2800, satis: 3990, kdv: 10, birim: 'ADET', stok: 48 },
  {
    ad: 'Deterjan 3 kg',
    barkod: '8690000000109',
    kategori: 'Temizlik',
    alis: 12000,
    satis: 16900,
    kdv: 20,
    birim: 'ADET',
    stok: 12,
  },
  {
    ad: 'Bulaşık Deterjanı',
    barkod: '8690000000116',
    kategori: 'Temizlik',
    alis: 3900,
    satis: 5500,
    kdv: 20,
    birim: 'ADET',
    stok: 20,
  },
  { ad: 'Domates', barkod: '', kategori: 'Manav', alis: 1200, satis: 1990, kdv: 1, birim: 'KG', stok: 25 },
  { ad: 'Salatalık', barkod: '', kategori: 'Manav', alis: 1000, satis: 1750, kdv: 1, birim: 'KG', stok: 18 },
  { ad: 'Elma', barkod: '', kategori: 'Manav', alis: 1800, satis: 2790, kdv: 1, birim: 'KG', stok: 30 },
  { ad: 'Patates', barkod: '', kategori: 'Manav', alis: 900, satis: 1490, kdv: 1, birim: 'KG', stok: 45 },
  { ad: 'Bisküvi', barkod: '8690000000123', kategori: 'Atıştırmalık', alis: 1100, satis: 1690, kdv: 10, birim: 'ADET', stok: 3 },
  { ad: 'Çikolata', barkod: '8690000000130', kategori: 'Atıştırmalık', alis: 2400, satis: 3490, kdv: 10, birim: 'ADET', stok: 2 },
];

/** Deterministik sözde-rastgele: her çalıştırmada aynı demo veri üretilir. */
function rastgeleUretici(tohum: number) {
  let durum = tohum;
  return (azami: number) => {
    durum = (durum * 1103515245 + 12345) % 2147483648;
    return durum % azami;
  };
}

async function calistir(): Promise<void> {
  const kok = argOku('kok', join(homedir(), '.market-otomasyon-demo'));
  console.log(`Demo veri klasörü: ${kok}`);

  const uygulama = await Uygulama.olustur({ veriKoku: kok, konsolLogu: false, sessiz: true, zamanlayiciKapali: true });

  if (!uygulama.kurulumGerekliMi()) {
    console.log('Bu klasörde zaten kurulu bir veritabanı var. Farklı bir --kok verin.');
    await uygulama.kapat();
    return;
  }

  const adminId = uygulama.yoneticiOlustur({ ad: 'Demo Yönetici', kullaniciAdi: 'admin', sifre: 'Demo1234', pin: '4271' });
  const admin: Aktor = {
    kullaniciId: adminId,
    ad: 'Demo Yönetici',
    rol: 'ADMIN',
    yetkiler: etkinYetkiler({ rol: 'ADMIN' }),
    kasaOturumId: null,
  };

  const baglam = uygulama.baglam;

  // ── Katalog ───────────────────────────────────────────────────────────────
  const urunIdler: string[] = [];
  for (const u of KATALOG) {
    const id = urunuKaydet(baglam, admin, {
      ad: u.ad,
      satis_fiyati: u.satis,
      alis_fiyati: u.alis,
      kdv_orani: u.kdv,
      birim_tipi: u.birim,
      kritik_stok: u.birim === 'ADET' ? adet(5) : miktarOlustur(5),
      ideal_stok: u.birim === 'ADET' ? adet(30) : miktarOlustur(30),
      barkodlar: u.barkod ? [{ barkod: u.barkod }] : [],
      acilis_stogu: u.birim === 'ADET' ? adet(u.stok) : miktarOlustur(u.stok),
    });
    urunIdler.push(id);
  }
  console.log(`✓ ${KATALOG.length} ürün eklendi`);

  // ── Cariler ───────────────────────────────────────────────────────────────
  const musteriler = ['Ahmet Yılmaz', 'Ayşe Demir', 'Mehmet Kaya', 'Fatma Şahin'].map((ad, i) =>
    cariKaydet(baglam, admin, {
      tip: 'MUSTERI',
      ad_unvan: ad,
      telefon: `0555 000 00 0${i + 1}`,
      kredi_limiti: 50_000,
      vade_gun: 30,
    }),
  );
  const tedarikci = cariKaydet(baglam, admin, {
    tip: 'TEDARIKCI',
    ad_unvan: 'Toptan Gıda Ltd.',
    telefon: '0212 000 00 00',
    vade_gun: 45,
  });
  console.log(`✓ ${musteriler.length} müşteri + 1 tedarikçi eklendi`);

  // ── Mal kabul ─────────────────────────────────────────────────────────────
  malKabulOnayla(baglam, admin, {
    tedarikci_id: tedarikci,
    fatura_no: 'TGL-2026-0451',
    kalemler: urunIdler.slice(0, 5).map((id, i) => ({
      urun_id: id,
      miktar: adet(20 + i * 5),
      birim_fiyat: KATALOG[i]?.alis ?? 1000,
      kdv_orani: KATALOG[i]?.kdv ?? 20,
    })),
  });
  console.log('✓ Mal kabul faturası işlendi');

  // ── Satışlar ──────────────────────────────────────────────────────────────
  const rastgele = rastgeleUretici(20260731);
  const acilis = kasaAc(baglam, admin, 20_000);
  admin.kasaOturumId = acilis.oturumId;

  let satisSayisi = 0;
  for (let i = 0; i < 60; i++) {
    const kalemSayisi = 1 + rastgele(4);
    const kalemler: { urun_id: string; miktar: number; birim_fiyat: number }[] = [];
    const kullanilan = new Set<number>();

    for (let k = 0; k < kalemSayisi; k++) {
      const index = rastgele(KATALOG.length);
      if (kullanilan.has(index)) continue;
      kullanilan.add(index);
      const tanim = KATALOG[index];
      const urunId = urunIdler[index];
      if (!tanim || !urunId) continue;
      const miktar = tanim.birim === 'ADET' ? adet(1 + rastgele(3)) : miktarOlustur((250 + rastgele(1500)) / 1000);
      kalemler.push({ urun_id: urunId, miktar, birim_fiyat: tanim.satis });
    }
    if (kalemler.length === 0) continue;

    const toplam = kalemler.reduce((t, k) => {
      const tanim = KATALOG[urunIdler.indexOf(k.urun_id)];
      return t + Math.round((k.miktar * (tanim?.satis ?? 0)) / 1000);
    }, 0);

    const odemeSecimi = rastgele(10);
    try {
      if (odemeSecimi < 6) {
        satisKesinlestir(baglam, admin, {
          kalemler,
          odemeler: [{ tip: 'NAKIT', tutar: toplam, alinan: Math.ceil(toplam / 5000) * 5000 }],
        });
      } else if (odemeSecimi < 9) {
        satisKesinlestir(baglam, admin, { kalemler, odemeler: [{ tip: 'KART', tutar: toplam }] });
      } else {
        const musteri = musteriler[rastgele(musteriler.length)];
        satisKesinlestir(baglam, admin, {
          kalemler,
          odemeler: [{ tip: 'VERESIYE', tutar: toplam }],
          musteri_id: musteri,
          limit_asimi_onaylandi: true,
        });
      }
      satisSayisi++;
    } catch {
      // Stok yetersizliği gibi durumlarda o satışı atla — demo verisi bozulmasın.
    }
  }
  console.log(`✓ ${satisSayisi} satış oluşturuldu`);

  // ── Tahsilat ──────────────────────────────────────────────────────────────
  for (const musteri of musteriler.slice(0, 2)) {
    try {
      tahsilatYap(baglam, admin, { cari_id: musteri, tutar: 5_000, odeme_tipi: 'NAKIT', aciklama: 'Kısmi tahsilat' });
    } catch {
      /* bakiyesi yoksa atla */
    }
  }

  // ── Gün sonu ──────────────────────────────────────────────────────────────
  const kasaDurumuSonuc = gunSonu(baglam, admin, 0, 'Demo gün sonu');
  console.log(`✓ Gün sonu: beklenen ${(kasaDurumuSonuc.beklenenNakit / 100).toFixed(2)} ₺`);

  await uygulama.kapat();

  console.log('─'.repeat(60));
  console.log('Demo veri hazır.');
  console.log(`  Klasör  : ${kok}`);
  console.log('  Kullanıcı: admin');
  console.log('  Şifre    : Demo1234   (PIN: 4271)');
  console.log('─'.repeat(60));
}

calistir().catch((hata) => {
  console.error('Demo veri üretilemedi:', hata instanceof Error ? hata.message : hata);
  process.exit(1);
});
