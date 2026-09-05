/**
 * Özet/rollup ve denetim repository'si — §8.2, §8.3.
 *
 * Rollup tabloları satışla **aynı transaction** içinde güncellenir. Böylece
 * panel ve yerel raporlar ham `satislar` tablosunu taramaz; okuma maliyeti
 * 100–1000 kat düşer (§6.5 kural 3) ve rapor üretimi ≤3 sn hedefini tutar (§3.1).
 */

import { simdi, uuid, type GunAnahtari, type Kurus, type Miktar, type ZamanDamgasi } from '@market/shared';
import type { Vt } from '../db/surucu.js';

// ---------------------------------------------------------------------------
// Günlük özet
// ---------------------------------------------------------------------------

export interface GunlukOzetKaydi {
  tarih: GunAnahtari;
  cihaz_id: string;
  ciro: Kurus;
  iade_toplam: Kurus;
  iptal_toplam: Kurus;
  islem_sayisi: number;
  nakit: Kurus;
  kart: Kurus;
  veresiye: Kurus;
  tahsilat: Kurus;
  gider: Kurus;
  brut_kar: Kurus;
  kdv_toplam: Kurus;
  updated_at: ZamanDamgasi;
}

export type GunlukOzetDeltasi = Partial<Omit<GunlukOzetKaydi, 'tarih' | 'cihaz_id' | 'updated_at'>>;

/**
 * Günlük özete artımlı ekleme yapar. Tüm alanlar toplanır; mevcut satır yoksa
 * oluşturulur. Aynı transaction içinde çağrılmalıdır.
 */
export function gunlukOzetEkle(
  vt: Vt,
  tarih: GunAnahtari,
  cihazId: string,
  delta: GunlukOzetDeltasi,
  zaman: ZamanDamgasi = simdi(),
): void {
  vt.hazirla(
    `INSERT INTO gunluk_ozet (tarih, cihaz_id, ciro, iade_toplam, iptal_toplam, islem_sayisi,
                              nakit, kart, veresiye, tahsilat, gider, brut_kar, kdv_toplam, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tarih, cihaz_id) DO UPDATE SET
       ciro         = gunluk_ozet.ciro         + excluded.ciro,
       iade_toplam  = gunluk_ozet.iade_toplam  + excluded.iade_toplam,
       iptal_toplam = gunluk_ozet.iptal_toplam + excluded.iptal_toplam,
       islem_sayisi = gunluk_ozet.islem_sayisi + excluded.islem_sayisi,
       nakit        = gunluk_ozet.nakit        + excluded.nakit,
       kart         = gunluk_ozet.kart         + excluded.kart,
       veresiye     = gunluk_ozet.veresiye     + excluded.veresiye,
       tahsilat     = gunluk_ozet.tahsilat     + excluded.tahsilat,
       gider        = gunluk_ozet.gider        + excluded.gider,
       brut_kar     = gunluk_ozet.brut_kar     + excluded.brut_kar,
       kdv_toplam   = gunluk_ozet.kdv_toplam   + excluded.kdv_toplam,
       updated_at   = excluded.updated_at`,
  ).calistir(
    tarih,
    cihazId,
    delta.ciro ?? 0,
    delta.iade_toplam ?? 0,
    delta.iptal_toplam ?? 0,
    delta.islem_sayisi ?? 0,
    delta.nakit ?? 0,
    delta.kart ?? 0,
    delta.veresiye ?? 0,
    delta.tahsilat ?? 0,
    delta.gider ?? 0,
    delta.brut_kar ?? 0,
    delta.kdv_toplam ?? 0,
    zaman,
  );
}

export function gunlukOzetAralik(vt: Vt, baslangic: GunAnahtari, bitis: GunAnahtari): GunlukOzetKaydi[] {
  return vt
    .hazirla(
      `SELECT tarih, cihaz_id, SUM(ciro) AS ciro, SUM(iade_toplam) AS iade_toplam,
              SUM(iptal_toplam) AS iptal_toplam, SUM(islem_sayisi) AS islem_sayisi,
              SUM(nakit) AS nakit, SUM(kart) AS kart, SUM(veresiye) AS veresiye,
              SUM(tahsilat) AS tahsilat, SUM(gider) AS gider, SUM(brut_kar) AS brut_kar,
              SUM(kdv_toplam) AS kdv_toplam, MAX(updated_at) AS updated_at
       FROM gunluk_ozet WHERE tarih >= ? AND tarih <= ?
       GROUP BY tarih ORDER BY tarih`,
    )
    .tumu<GunlukOzetKaydi>(baslangic, bitis);
}

export function gunlukOzetTek(vt: Vt, tarih: GunAnahtari): GunlukOzetKaydi | null {
  return gunlukOzetAralik(vt, tarih, tarih)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Ürün satış özeti
// ---------------------------------------------------------------------------

export function urunOzetEkle(
  vt: Vt,
  urunId: string,
  donem: GunAnahtari,
  cihazId: string,
  delta: { adet: Miktar; ciro: Kurus; kar: Kurus },
  zaman: ZamanDamgasi = simdi(),
): void {
  vt.hazirla(
    `INSERT INTO urun_satis_ozet (urun_id, donem, cihaz_id, adet, ciro, kar, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(urun_id, donem, cihaz_id) DO UPDATE SET
       adet = urun_satis_ozet.adet + excluded.adet,
       ciro = urun_satis_ozet.ciro + excluded.ciro,
       kar  = urun_satis_ozet.kar  + excluded.kar,
       updated_at = excluded.updated_at`,
  ).calistir(urunId, donem, cihazId, delta.adet, delta.ciro, delta.kar, zaman);
}

export interface UrunOzetSatiri {
  urun_id: string;
  urun_adi: string;
  adet: Miktar;
  ciro: Kurus;
  kar: Kurus;
  birim_tipi: string;
}

export function enCokSatanlar(
  vt: Vt,
  baslangic: GunAnahtari,
  bitis: GunAnahtari,
  limit = 20,
  karaGore = false,
): UrunOzetSatiri[] {
  return vt
    .hazirla(
      `SELECT o.urun_id, u.ad AS urun_adi, u.birim_tipi,
              SUM(o.adet) AS adet, SUM(o.ciro) AS ciro, SUM(o.kar) AS kar
       FROM urun_satis_ozet o JOIN urunler u ON u.id = o.urun_id
       WHERE o.donem >= ? AND o.donem <= ?
       GROUP BY o.urun_id
       ORDER BY ${karaGore ? 'kar' : 'ciro'} DESC
       LIMIT ?`,
    )
    .tumu<UrunOzetSatiri>(baslangic, bitis, limit);
}

/** Ölü stok: verilen dönemde hiç satılmamış ama stoğu olan ürünler (§11.4). */
export function oluStok(
  vt: Vt,
  baslangic: GunAnahtari,
  bitis: GunAnahtari,
  limit = 100,
): {
  urun_id: string;
  ad: string;
  stok: Miktar;
  alis_fiyati: Kurus;
  bagli_sermaye: Kurus;
}[] {
  return vt
    .hazirla(
      `SELECT u.id AS urun_id, u.ad, so.miktar AS stok, u.alis_fiyati,
              CAST(so.miktar * u.alis_fiyati / 1000.0 AS INTEGER) AS bagli_sermaye
       FROM urunler u
       JOIN stok_ozet so ON so.urun_id = u.id
       WHERE u.aktif_mi = 1 AND so.miktar > 0
         AND NOT EXISTS (
           SELECT 1 FROM urun_satis_ozet o
           WHERE o.urun_id = u.id AND o.donem >= ? AND o.donem <= ? AND o.adet > 0
         )
       ORDER BY bagli_sermaye DESC
       LIMIT ?`,
    )
    .tumu<{ urun_id: string; ad: string; stok: number; alis_fiyati: number; bagli_sermaye: number }>(baslangic, bitis, limit);
}

/**
 * Rollup tablolarını ham verilerden yeniden inşa eder (mutabakat / onarım).
 * Kâr, satış anında dondurulan `birim_maliyet` üzerinden hesaplanır.
 */
export function ozetleriYenidenHesapla(vt: Vt, zaman: ZamanDamgasi = simdi()): { gun: number; urun: number } {
  return vt.islem(() => {
    vt.ham('DELETE FROM gunluk_ozet');
    vt.ham('DELETE FROM urun_satis_ozet');

    // Yerel gün anahtarı: UTC damgasına Europe/Istanbul ofseti (+3 saat) eklenir.
    // SQLite'ta zaman dilimi veritabanı yoktur; TR 2016'dan beri sabit UTC+3 kullanır.
    const yerelGun = `date(s.tarih, '+3 hours')`;

    const gun = vt
      .hazirla(
        `INSERT INTO gunluk_ozet (tarih, cihaz_id, ciro, iade_toplam, iptal_toplam, islem_sayisi,
                                  nakit, kart, veresiye, tahsilat, gider, brut_kar, kdv_toplam, updated_at)
         SELECT ${yerelGun} AS tarih,
                COALESCE(s.cihaz_id, '') AS cihaz_id,
                SUM(CASE WHEN s.iptal_mi = 0 AND s.iade_mi = 0 THEN s.genel_toplam ELSE 0 END),
                SUM(CASE WHEN s.iptal_mi = 0 AND s.iade_mi = 1 THEN -s.genel_toplam ELSE 0 END),
                SUM(CASE WHEN s.iptal_mi = 1 THEN s.genel_toplam ELSE 0 END),
                SUM(CASE WHEN s.iptal_mi = 0 AND s.iade_mi = 0 THEN 1 ELSE 0 END),
                COALESCE((SELECT SUM(o.tutar) FROM odemeler o WHERE o.satis_id = s.id AND o.odeme_tipi = 'NAKIT' AND s.iptal_mi = 0), 0),
                COALESCE((SELECT SUM(o.tutar) FROM odemeler o WHERE o.satis_id = s.id AND o.odeme_tipi = 'KART' AND s.iptal_mi = 0), 0),
                COALESCE((SELECT SUM(o.tutar) FROM odemeler o WHERE o.satis_id = s.id AND o.odeme_tipi = 'VERESIYE' AND s.iptal_mi = 0), 0),
                0, 0,
                COALESCE((SELECT SUM(k.satir_toplam - k.kdv_tutar - CAST(k.miktar * k.birim_maliyet / 1000.0 AS INTEGER))
                          FROM satis_kalemleri k WHERE k.satis_id = s.id AND s.iptal_mi = 0), 0),
                SUM(CASE WHEN s.iptal_mi = 0 THEN s.kdv_toplam ELSE 0 END),
                ?
         FROM satislar s
         GROUP BY tarih, cihaz_id`,
      )
      .calistir(zaman).changes;

    const urun = vt
      .hazirla(
        `INSERT INTO urun_satis_ozet (urun_id, donem, cihaz_id, adet, ciro, kar, updated_at)
         SELECT k.urun_id,
                ${yerelGun} AS donem,
                COALESCE(s.cihaz_id, '') AS cihaz_id,
                SUM(k.miktar),
                SUM(k.satir_toplam),
                SUM(k.satir_toplam - k.kdv_tutar - CAST(k.miktar * k.birim_maliyet / 1000.0 AS INTEGER)),
                ?
         FROM satis_kalemleri k
         JOIN satislar s ON s.id = k.satis_id
         WHERE s.iptal_mi = 0
         GROUP BY k.urun_id, donem, cihaz_id`,
      )
      .calistir(zaman).changes;

    return { gun, urun };
  });
}

// ---------------------------------------------------------------------------
// Denetim logu (§8.3, §15.1)
// ---------------------------------------------------------------------------

export interface DenetimYazma {
  kullanici_id: string | null;
  islem: string;
  entity: string;
  entity_id?: string | null;
  eski_deger?: unknown;
  yeni_deger?: unknown;
}

/**
 * Denetim logunu yaşa göre budar (§17.5).
 *
 * Denetim logu MALİ KAYIT DEĞİLDİR: satışlar, stok ve cari hareketleri kendi
 * tablolarında durur ve buradan silinen hiçbir şey onları etkilemez. Burada
 * biriken şey "kim ne zaman hangi ekranı açtı, hangi kaydı değiştirdi"
 * izidir; sınırsız tutulursa yıllar içinde veritabanının en büyük tablosu
 * haline gelir ve yedek boyutunu gereksiz şişirir.
 */
export function denetimBuda(vt: Vt, oncekiZaman: ZamanDamgasi): number {
  return vt.hazirla('DELETE FROM denetim_log WHERE zaman < ?').calistir(oncekiZaman).changes;
}

export function denetimYaz(vt: Vt, kayit: DenetimYazma, cihazId: string, zaman: ZamanDamgasi = simdi()): string {
  const id = uuid();
  vt.hazirla(
    `INSERT INTO denetim_log (id, kullanici_id, islem, entity, entity_id, eski_deger, yeni_deger, zaman, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).calistir(
    id,
    kayit.kullanici_id,
    kayit.islem,
    kayit.entity,
    kayit.entity_id ?? null,
    kayit.eski_deger === undefined ? null : JSON.stringify(kayit.eski_deger),
    kayit.yeni_deger === undefined ? null : JSON.stringify(kayit.yeni_deger),
    zaman,
    cihazId,
  );
  return id;
}

export interface DenetimSatiri {
  id: string;
  kullanici_id: string | null;
  kullanici_adi: string | null;
  islem: string;
  entity: string;
  entity_id: string | null;
  eski_deger: string | null;
  yeni_deger: string | null;
  zaman: ZamanDamgasi;
  cihaz_id: string | null;
}

export function denetimListele(
  vt: Vt,
  filtre: { kullaniciId?: string; entity?: string; entityId?: string; baslangic?: ZamanDamgasi; bitis?: ZamanDamgasi } = {},
  limit = 200,
): DenetimSatiri[] {
  const kosullar: string[] = [];
  const parametreler: unknown[] = [];
  if (filtre.kullaniciId) {
    kosullar.push('d.kullanici_id = ?');
    parametreler.push(filtre.kullaniciId);
  }
  if (filtre.entity) {
    kosullar.push('d.entity = ?');
    parametreler.push(filtre.entity);
  }
  if (filtre.entityId) {
    kosullar.push('d.entity_id = ?');
    parametreler.push(filtre.entityId);
  }
  if (filtre.baslangic) {
    kosullar.push('d.zaman >= ?');
    parametreler.push(filtre.baslangic);
  }
  if (filtre.bitis) {
    kosullar.push('d.zaman < ?');
    parametreler.push(filtre.bitis);
  }
  const nerede = kosullar.length ? 'WHERE ' + kosullar.join(' AND ') : '';
  return vt
    .hazirla(
      `SELECT d.id, d.kullanici_id, k.ad AS kullanici_adi, d.islem, d.entity, d.entity_id,
              d.eski_deger, d.yeni_deger, d.zaman, d.cihaz_id
       FROM denetim_log d LEFT JOIN kullanicilar k ON k.id = d.kullanici_id
       ${nerede} ORDER BY d.zaman DESC LIMIT ?`,
    )
    .tumu<DenetimSatiri>(...parametreler, limit);
}
