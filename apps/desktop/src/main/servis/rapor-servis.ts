/**
 * Yerel raporlar — §10.10, §14.
 *
 * Performans: Ciro/kâr/ürün raporları **özet tablolardan** üretilir (§6.5 kural 3),
 * ham `satislar` taranmaz. Yalnız saatlik dağılım gibi kırılım gerektiren raporlar
 * satış tablosuna iner ve tarih indeksini kullanır.
 */

import {
  bugun,
  gunAnahtari,
  gunBasi,
  gunEkle,
  gunSonu,
  yerelSaat,
  type GunAnahtari,
  type Kurus,
  type Miktar,
} from '@market/shared';
import { toplamBakiyeler, yaslandirma, vadesiGecenler } from '../depo/cari.js';
import { oturumlariListele } from '../depo/kasa.js';
import { enCokSatanlar, gunlukOzetAralik, oluStok, type GunlukOzetKaydi } from '../depo/ozet.js';
import { kritikStoktakiler, kritikStokSayisi, negatifStoktakiler, sktYaklasanlar, stokDegeri } from '../depo/stok.js';
import { yetkiIste, type Aktor, type Baglam } from './baglam.js';

export interface CiroOzeti {
  ciro: Kurus;
  iade: Kurus;
  netCiro: Kurus;
  islemSayisi: number;
  ortalamaSepet: Kurus;
  brutKar: Kurus;
  karMarji: number;
  nakit: Kurus;
  kart: Kurus;
  veresiye: Kurus;
  tahsilat: Kurus;
  gider: Kurus;
  kdvToplam: Kurus;
}

function ozetleriTopla(satirlar: GunlukOzetKaydi[]): CiroOzeti {
  const topla = (secici: (s: GunlukOzetKaydi) => number) => satirlar.reduce((t, s) => t + secici(s), 0);
  const ciro = topla((s) => s.ciro);
  const iade = topla((s) => s.iade_toplam);
  const islemSayisi = topla((s) => s.islem_sayisi);
  const netCiro = ciro - iade;
  const brutKar = topla((s) => s.brut_kar);
  return {
    ciro,
    iade,
    netCiro,
    islemSayisi,
    ortalamaSepet: islemSayisi > 0 ? Math.round(ciro / islemSayisi) : 0,
    brutKar,
    karMarji: netCiro > 0 ? Math.round((brutKar / netCiro) * 10000) / 100 : 0,
    nakit: topla((s) => s.nakit),
    kart: topla((s) => s.kart),
    veresiye: topla((s) => s.veresiye),
    tahsilat: topla((s) => s.tahsilat),
    gider: topla((s) => s.gider),
    kdvToplam: topla((s) => s.kdv_toplam),
  };
}

export interface GunlukRapor {
  baslangic: GunAnahtari;
  bitis: GunAnahtari;
  ozet: CiroOzeti;
  gunler: (GunlukOzetKaydi & { ortalama_sepet: Kurus })[];
  /** Bir önceki eşit uzunluktaki döneme göre yüzde değişim. */
  degisimYuzde: number;
}

export function gunlukRapor(baglam: Baglam, aktor: Aktor, baslangic: GunAnahtari, bitis: GunAnahtari): GunlukRapor {
  yetkiIste(aktor, 'rapor.goruntule');
  const satirlar = gunlukOzetAralik(baglam.vt, baslangic, bitis);
  const ozet = ozetleriTopla(satirlar);

  // Karşılaştırma dönemi: aynı uzunlukta, hemen öncesi.
  const gunSayisi = Math.max(1, Math.round((Date.parse(bitis) - Date.parse(baslangic)) / 86400000) + 1);
  const oncekiBitis = gunEkle(baslangic, -1);
  const oncekiBaslangic = gunEkle(oncekiBitis, -(gunSayisi - 1));
  const onceki = ozetleriTopla(gunlukOzetAralik(baglam.vt, oncekiBaslangic, oncekiBitis));
  const degisimYuzde = onceki.netCiro > 0 ? Math.round(((ozet.netCiro - onceki.netCiro) / onceki.netCiro) * 10000) / 100 : 0;

  return {
    baslangic,
    bitis,
    ozet,
    gunler: satirlar.map((s) => ({ ...s, ortalama_sepet: s.islem_sayisi > 0 ? Math.round(s.ciro / s.islem_sayisi) : 0 })),
    degisimYuzde,
  };
}

export function bugunOzeti(baglam: Baglam, aktor: Aktor): CiroOzeti {
  yetkiIste(aktor, 'rapor.goruntule');
  return ozetleriTopla(gunlukOzetAralik(baglam.vt, bugun(), bugun()));
}

export interface UrunRaporu {
  enCokSatan: ReturnType<typeof enCokSatanlar>;
  enKarli: ReturnType<typeof enCokSatanlar>;
  oluStok: ReturnType<typeof oluStok>;
}

export function urunRaporu(baglam: Baglam, aktor: Aktor, baslangic: GunAnahtari, bitis: GunAnahtari, limit = 20): UrunRaporu {
  yetkiIste(aktor, 'rapor.goruntule');
  const karGorebilir = aktor.yetkiler.has('rapor.kar_gor');
  const enCokSatan = enCokSatanlar(baglam.vt, baslangic, bitis, limit, false);
  const enKarli = karGorebilir ? enCokSatanlar(baglam.vt, baslangic, bitis, limit, true) : [];
  return {
    // Kâr görme yetkisi yoksa kâr sütunu sıfırlanır (§10.12 yetki matrisi).
    enCokSatan: karGorebilir ? enCokSatan : enCokSatan.map((s) => ({ ...s, kar: 0 })),
    enKarli,
    oluStok: oluStok(baglam.vt, baslangic, bitis, limit),
  };
}

export interface SaatlikDilim {
  saat: number;
  ciro: Kurus;
  islem: number;
}

/** Saatlik yoğunluk (§14) — personel planlaması için. */
export function saatlikDagilim(baglam: Baglam, aktor: Aktor, baslangic: GunAnahtari, bitis: GunAnahtari): SaatlikDilim[] {
  yetkiIste(aktor, 'rapor.goruntule');
  const satirlar = baglam.vt
    .hazirla(
      `SELECT tarih, genel_toplam FROM satislar
       WHERE tarih >= ? AND tarih < ? AND iptal_mi = 0 AND iade_mi = 0`,
    )
    .tumu<{ tarih: string; genel_toplam: number }>(gunBasi(baslangic), gunSonu(bitis));

  const dilimler: SaatlikDilim[] = Array.from({ length: 24 }, (_, saat) => ({ saat, ciro: 0, islem: 0 }));
  for (const satir of satirlar) {
    const dilim = dilimler[yerelSaat(satir.tarih)];
    if (!dilim) continue;
    dilim.ciro += satir.genel_toplam;
    dilim.islem += 1;
  }
  return dilimler;
}

export interface StokRaporu {
  deger: ReturnType<typeof stokDegeri>;
  kritikSayisi: number;
  kritikler: ReturnType<typeof kritikStoktakiler>;
  negatifler: ReturnType<typeof negatifStoktakiler>;
  sktYaklasanlar: ReturnType<typeof sktYaklasanlar>;
}

export function stokRaporu(baglam: Baglam, aktor: Aktor, sktGunSayisi = 30): StokRaporu {
  yetkiIste(aktor, 'stok.goruntule');
  return {
    deger: stokDegeri(baglam.vt),
    kritikSayisi: kritikStokSayisi(baglam.vt),
    kritikler: kritikStoktakiler(baglam.vt),
    negatifler: negatifStoktakiler(baglam.vt),
    sktYaklasanlar: sktYaklasanlar(baglam.vt, sktGunSayisi),
  };
}

export interface CariRaporu {
  toplamlar: ReturnType<typeof toplamBakiyeler>;
  musteriYaslandirma: ReturnType<typeof yaslandirma>;
  tedarikciYaslandirma: ReturnType<typeof yaslandirma>;
  vadesiGecenler: ReturnType<typeof vadesiGecenler>;
}

export function cariRaporu(baglam: Baglam, aktor: Aktor): CariRaporu {
  yetkiIste(aktor, 'cari.goruntule');
  return {
    toplamlar: toplamBakiyeler(baglam.vt),
    musteriYaslandirma: yaslandirma(baglam.vt, 'MUSTERI'),
    tedarikciYaslandirma: yaslandirma(baglam.vt, 'TEDARIKCI'),
    vadesiGecenler: vadesiGecenler(baglam.vt),
  };
}

export interface KasaGecmisSatiri {
  id: string;
  kullanici_adi?: string;
  acilis_zamani: string;
  kapanis_zamani: string | null;
  acilis_bakiye: Kurus;
  sayilan_nakit: Kurus | null;
  beklenen_nakit: Kurus | null;
  kasa_farki: Kurus | null;
  durum: string;
}

export function kasaGecmisi(baglam: Baglam, aktor: Aktor, baslangic?: GunAnahtari, bitis?: GunAnahtari): KasaGecmisSatiri[] {
  yetkiIste(aktor, 'rapor.goruntule');
  const filtre: { baslangic?: string; bitis?: string; kullaniciId?: string } = {};
  if (baslangic) filtre.baslangic = gunBasi(baslangic);
  if (bitis) filtre.bitis = gunSonu(bitis);
  if (!aktor.yetkiler.has('kasa.tum_oturumlar')) filtre.kullaniciId = aktor.kullaniciId;
  return oturumlariListele(baglam.vt, filtre);
}

export interface SuistimalGostergesi {
  iadeOrani: number;
  iptalOrani: number;
  iadeTutari: Kurus;
  iptalTutari: Kurus;
  kasiyerBazli: { kullanici_id: string | null; kullanici_adi: string | null; iptal: number; iade: number; satis: number }[];
}

/** İade / iptal oranı — suistimal tespiti (§14). */
export function suistimalRaporu(baglam: Baglam, aktor: Aktor, baslangic: GunAnahtari, bitis: GunAnahtari): SuistimalGostergesi {
  yetkiIste(aktor, 'rapor.goruntule');
  const bas = gunBasi(baslangic);
  const bit = gunSonu(bitis);

  const genel = baglam.vt
    .hazirla(
      `SELECT
         SUM(CASE WHEN iptal_mi = 0 AND iade_mi = 0 THEN 1 ELSE 0 END) AS satis,
         SUM(CASE WHEN iade_mi = 1 THEN 1 ELSE 0 END) AS iade,
         SUM(CASE WHEN iptal_mi = 1 THEN 1 ELSE 0 END) AS iptal,
         COALESCE(SUM(CASE WHEN iade_mi = 1 THEN -genel_toplam ELSE 0 END), 0) AS iade_tutari,
         COALESCE(SUM(CASE WHEN iptal_mi = 1 THEN genel_toplam ELSE 0 END), 0) AS iptal_tutari
       FROM satislar WHERE tarih >= ? AND tarih < ?`,
    )
    .tek<{ satis: number; iade: number; iptal: number; iade_tutari: number; iptal_tutari: number }>(bas, bit);

  const kasiyerBazli = baglam.vt
    .hazirla(
      `SELECT s.kullanici_id, k.ad AS kullanici_adi,
              SUM(CASE WHEN s.iptal_mi = 1 THEN 1 ELSE 0 END) AS iptal,
              SUM(CASE WHEN s.iade_mi = 1 THEN 1 ELSE 0 END) AS iade,
              SUM(CASE WHEN s.iptal_mi = 0 AND s.iade_mi = 0 THEN 1 ELSE 0 END) AS satis
       FROM satislar s LEFT JOIN kullanicilar k ON k.id = s.kullanici_id
       WHERE s.tarih >= ? AND s.tarih < ?
       GROUP BY s.kullanici_id ORDER BY iptal + iade DESC`,
    )
    .tumu<{ kullanici_id: string | null; kullanici_adi: string | null; iptal: number; iade: number; satis: number }>(bas, bit);

  const satisSayisi = genel?.satis ?? 0;
  const bolen = Math.max(1, satisSayisi);
  return {
    iadeOrani: Math.round(((genel?.iade ?? 0) / bolen) * 10000) / 100,
    iptalOrani: Math.round(((genel?.iptal ?? 0) / bolen) * 10000) / 100,
    iadeTutari: genel?.iade_tutari ?? 0,
    iptalTutari: genel?.iptal_tutari ?? 0,
    kasiyerBazli,
  };
}

export interface StokDevirHizi {
  urun_id: string;
  ad: string;
  satilan: Miktar;
  ortalamaStok: Miktar;
  devirHizi: number;
}

/** Stok devir hızı (§14): dönemdeki satış / mevcut stok. */
export function stokDevirHizi(
  baglam: Baglam,
  aktor: Aktor,
  baslangic: GunAnahtari,
  bitis: GunAnahtari,
  limit = 50,
): StokDevirHizi[] {
  yetkiIste(aktor, 'rapor.goruntule');
  return baglam.vt
    .hazirla(
      `SELECT o.urun_id, u.ad, SUM(o.adet) AS satilan, COALESCE(so.miktar, 0) AS ortalama_stok
       FROM urun_satis_ozet o
       JOIN urunler u ON u.id = o.urun_id
       LEFT JOIN stok_ozet so ON so.urun_id = o.urun_id
       WHERE o.donem >= ? AND o.donem <= ?
       GROUP BY o.urun_id
       HAVING SUM(o.adet) > 0
       ORDER BY satilan DESC LIMIT ?`,
    )
    .tumu<{ urun_id: string; ad: string; satilan: number; ortalama_stok: number }>(baslangic, bitis, limit)
    .map((s) => ({
      urun_id: s.urun_id,
      ad: s.ad,
      satilan: s.satilan,
      ortalamaStok: s.ortalama_stok,
      devirHizi: s.ortalama_stok > 0 ? Math.round((s.satilan / s.ortalama_stok) * 100) / 100 : 0,
    }));
}

/** Dashboard için tek çağrıda toplanmış özet (§11.2 karşılığı, yerel). */
export function panoOzeti(baglam: Baglam, aktor: Aktor) {
  yetkiIste(aktor, 'rapor.goruntule');
  const bugunAnahtari = bugun();
  const sonYediGun = gunEkle(bugunAnahtari, -6);
  return {
    bugun: ozetleriTopla(gunlukOzetAralik(baglam.vt, bugunAnahtari, bugunAnahtari)),
    trend: gunlukOzetAralik(baglam.vt, sonYediGun, bugunAnahtari),
    enCokSatan: enCokSatanlar(baglam.vt, bugunAnahtari, bugunAnahtari, 5),
    kritikStokSayisi: kritikStokSayisi(baglam.vt),
    cariToplamlari: toplamBakiyeler(baglam.vt),
    stokDegeri: stokDegeri(baglam.vt),
    tarih: gunAnahtari(),
  };
}
