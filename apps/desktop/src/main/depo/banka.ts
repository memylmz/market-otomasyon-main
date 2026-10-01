/**
 * Banka / POS defteri — nakit DIŞI paranın yürüyen bakiyesi.
 *
 * Kasa defteri fiziksel nakdi tutar. Kartla satış, kart/havale tahsilat ve
 * tedarikçiye kart/havale ödemeler kendi kayıtlarında zaten vardır; burada
 * İKİNCİ KEZ TUTULMAZ, okunurken türetilir (iki yerde tutulan para ayrışır).
 * Yalnız türetilemeyenler `banka_hareketleri` tablosundadır: açılış bakiyesi,
 * banka/POS kesintisi, kasa↔banka aktarımı ve düzeltme.
 *
 * Bakiye "OLMASI GEREKEN" tutardır: POS'tan çekilen para bankaya birkaç gün
 * sonra ve kesinti düşülerek geçer; program bankaya bağlı değildir.
 */

import { simdi, uuid, type BankaHareketTuru, type Kurus, type ZamanDamgasi } from '@market/shared';
import type { Vt } from '../db/surucu.js';

export type BankaDefterTuru = 'KART_SATIS' | 'KART_IADE' | 'KART_TAHSILAT' | 'KART_ODEME' | 'IPTAL' | BankaHareketTuru;

export interface BankaDefterSatiri {
  tarih: ZamanDamgasi;
  tur: BankaDefterTuru;
  aciklama: string;
  /** İşaretli: + bankaya giren, − çıkan. */
  tutar: Kurus;
  belge_id: string | null;
  belge_tipi: string | null;
  yuruyen_bakiye: Kurus;
}

export interface BankaDefteri {
  devir: Kurus;
  hareketler: BankaDefterSatiri[];
  bakiye: Kurus;
  ozet: {
    kart_satis: Kurus;
    kart_iade: Kurus;
    tahsilat: Kurus;
    odeme: Kurus;
    komisyon: Kurus;
    aktarim: Kurus;
    /** Dönemdeki net kart satışı × komisyon oranı — kesin değil, tahmin. */
    tahmini_komisyon: Kurus;
  };
}

/**
 * Bütün kaynakların birleşimi. Cari satırlarında yön cari tipinden gelir:
 * müşteride tutar eksi (borç düştü) → bankaya girer; tedarikçide tutar eksi
 * (borç kapandı) → bankadan çıkar. İptal satırları aynı kuralla tersine döner.
 * "Nakit miydi" kasa hareketinin varlığıyla anlaşılır (ALIS_ODEME'de kasa
 * hareketi faturaya bağlıdır).
 */
const KAYNAKLAR = `
  SELECT s.tarih, CASE WHEN s.iade_mi = 1 THEN 'KART_IADE' ELSE 'KART_SATIS' END AS tur,
         CASE WHEN s.iade_mi = 1 THEN 'Karta iade — ' ELSE 'Kart satış — ' END || s.fis_no AS aciklama,
         SUM(o.tutar) AS tutar, s.id AS belge_id, 'SATIS' AS belge_tipi
  FROM satislar s JOIN odemeler o ON o.satis_id = s.id AND o.odeme_tipi = 'KART'
  GROUP BY s.id

  UNION ALL

  -- İptal edilen satışın kartla geri ödenen kısmı. İptal nakit iade edildiyse
  -- bu satır yoktur: kart parası bankada kalır, nakit kasadan çıkar.
  SELECT k.created_at AS tarih, 'IPTAL' AS tur, 'Satış iptali (karta iade) — ' || s.fis_no AS aciklama,
         k.tutar, s.id AS belge_id, 'SATIS_IPTAL' AS belge_tipi
  FROM kasa_hareketleri k JOIN satislar s ON s.id = k.belge_id
  WHERE s.iptal_mi = 1 AND s.iade_mi = 0 AND k.tip = 'SATIS_KART' AND k.tutar < 0

  UNION ALL

  SELECT h.tarih,
         CASE
           WHEN h.hareket_tipi = 'TAHSILAT' THEN 'KART_TAHSILAT'
           WHEN h.hareket_tipi = 'ODEME' THEN 'KART_ODEME'
           ELSE 'IPTAL'
         END AS tur,
         c.ad_unvan || ' — ' || COALESCE(h.aciklama, '') AS aciklama,
         CASE WHEN c.tip = 'MUSTERI' THEN -h.tutar ELSE h.tutar END AS tutar,
         h.id AS belge_id, h.belge_tipi
  FROM cari_hareketler h JOIN cariler c ON c.id = h.cari_id
  WHERE (
      h.hareket_tipi IN ('TAHSILAT', 'ODEME')
      AND NOT EXISTS (SELECT 1 FROM kasa_hareketleri k WHERE k.belge_id = h.id)
      AND NOT (h.belge_tipi = 'ALIS_ODEME'
               AND EXISTS (SELECT 1 FROM kasa_hareketleri k WHERE k.belge_id = h.belge_id AND k.tip = 'ODEME'))
    ) OR (
      h.belge_tipi = 'TAHSILAT_IPTAL'
      AND NOT EXISTS (SELECT 1 FROM kasa_hareketleri k WHERE k.belge_id = h.id)
    ) OR (
      h.belge_tipi = 'ALIS_ODEME_IPTAL'
      AND NOT EXISTS (SELECT 1 FROM kasa_hareketleri k WHERE k.belge_id = h.belge_id AND k.tip = 'ODEME')
    )

  UNION ALL

  SELECT tarih, tur, aciklama, tutar, kasa_hareket_id AS belge_id, NULL AS belge_tipi
  FROM banka_hareketleri
`;

export function bankaDefteri(
  vt: Vt,
  secenek: { baslangic?: ZamanDamgasi; bitis?: ZamanDamgasi; komisyonOrani?: number } = {},
): BankaDefteri {
  const devir = secenek.baslangic
    ? (vt.hazirla(`SELECT COALESCE(SUM(tutar), 0) AS t FROM (${KAYNAKLAR}) WHERE tarih < ?`).tek<{ t: number }>(secenek.baslangic)
        ?.t ?? 0)
    : 0;

  const kosul: string[] = [];
  const parametre: unknown[] = [];
  if (secenek.baslangic) {
    kosul.push('tarih >= ?');
    parametre.push(secenek.baslangic);
  }
  if (secenek.bitis) {
    kosul.push('tarih < ?');
    parametre.push(secenek.bitis);
  }
  const satirlar = vt
    .hazirla(
      `SELECT tarih, tur, aciklama, tutar, belge_id, belge_tipi FROM (${KAYNAKLAR})
       ${kosul.length ? 'WHERE ' + kosul.join(' AND ') : ''}
       ORDER BY tarih LIMIT 2000`,
    )
    .tumu<Omit<BankaDefterSatiri, 'yuruyen_bakiye'>>(...parametre);

  let yuruyen = devir;
  const ozet = { kart_satis: 0, kart_iade: 0, tahsilat: 0, odeme: 0, komisyon: 0, aktarim: 0, tahmini_komisyon: 0 };
  const hareketler = satirlar.map((s) => {
    yuruyen += s.tutar;
    if (s.tur === 'KART_SATIS') ozet.kart_satis += s.tutar;
    else if (s.tur === 'KART_IADE') ozet.kart_iade += s.tutar;
    else if (s.tur === 'KART_TAHSILAT') ozet.tahsilat += s.tutar;
    else if (s.tur === 'KART_ODEME') ozet.odeme += s.tutar;
    else if (s.tur === 'KOMISYON') ozet.komisyon += s.tutar;
    else if (s.tur === 'BANKADAN_KASAYA' || s.tur === 'KASADAN_BANKAYA') ozet.aktarim += s.tutar;
    return { ...s, yuruyen_bakiye: yuruyen };
  });
  const oran = secenek.komisyonOrani ?? 0;
  ozet.tahmini_komisyon = Math.round(((ozet.kart_satis + ozet.kart_iade) * oran) / 100);

  return { devir, hareketler, bakiye: yuruyen, ozet };
}

export function bankaHareketiYaz(
  vt: Vt,
  hareket: {
    tur: BankaHareketTuru;
    tutar: Kurus;
    aciklama: string;
    kasa_hareket_id?: string | null;
    kullanici_id?: string | null;
  },
  cihazId: string,
  zaman = simdi(),
): string {
  const id = uuid();
  vt.hazirla(
    `INSERT INTO banka_hareketleri (id, tur, tutar, aciklama, kasa_hareket_id, kullanici_id, tarih, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).calistir(
    id,
    hareket.tur,
    hareket.tutar,
    hareket.aciklama,
    hareket.kasa_hareket_id ?? null,
    hareket.kullanici_id ?? null,
    zaman,
    cihazId,
  );
  return id;
}
