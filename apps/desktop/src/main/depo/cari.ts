/**
 * Cari (veresiye defteri) repository'si — §10.7.
 *
 * ALTIN KURAL: `cari_ozet.bakiye` elle yazılmaz; yalnız `cari_hareketler`'e
 * kayıt eklenir, özet tetikleyici ile güncellenir.
 *
 * İşaret kuralı: **pozitif = bizim alacağımız.**
 *  - Müşteri veresiye alırsa  → BORC   (+)
 *  - Müşteriden tahsilat      → TAHSILAT (−)
 *  - Tedarikçiden mal alırsak → BORC   (+) ama tip TEDARIKCI olduğu için
 *    gösterimde "bizim borcumuz" olarak yorumlanır.
 */

import { aramaMetniOlustur, aramaNormalize, likeKacir, simdi, uuid, type Kurus, type ZamanDamgasi } from '@market/shared';
import type { Vt } from '../db/surucu.js';
import { boolToSayi, limitOfset, sayiToBool, yerTutucular, type SayfaSecenekleri } from './ortak.js';

export type CariTipiDb = 'MUSTERI' | 'TEDARIKCI';
export type CariHareketTipiDb = 'BORC' | 'ALACAK' | 'TAHSILAT' | 'ODEME' | 'IADE' | 'DUZELTME' | 'ACILIS';

export interface CariKaydi {
  id: string;
  tip: CariTipiDb;
  ad_unvan: string;
  telefon: string | null;
  eposta: string | null;
  adres: string | null;
  vergi_dairesi: string | null;
  vergi_no: string | null;
  kredi_limiti: Kurus;
  vade_gun: number;
  notlar: string | null;
  aktif_mi: boolean;
  anonimlestirildi_mi: boolean;
  iletisim_rizasi: boolean;
  iletisim_rizasi_zamani: ZamanDamgasi | null;
  created_at: ZamanDamgasi;
  updated_at: ZamanDamgasi;
  cihaz_id: string | null;
  sunucu_versiyonu: number;
}

export interface CariGorunumu extends CariKaydi {
  bakiye: Kurus;
  son_hareket: ZamanDamgasi | null;
}

const CARI_ALANLARI = `id, tip, ad_unvan, telefon, eposta, adres, vergi_dairesi, vergi_no, kredi_limiti,
  vade_gun, notlar, aktif_mi, anonimlestirildi_mi, iletisim_rizasi, iletisim_rizasi_zamani,
  created_at, updated_at, cihaz_id, sunucu_versiyonu`;

type HamCari = Omit<CariKaydi, 'aktif_mi' | 'anonimlestirildi_mi' | 'iletisim_rizasi'> & {
  aktif_mi: number;
  anonimlestirildi_mi: number;
  iletisim_rizasi: number;
};

function cariCoz(satir: HamCari): CariKaydi {
  return {
    ...satir,
    aktif_mi: sayiToBool(satir.aktif_mi),
    anonimlestirildi_mi: sayiToBool(satir.anonimlestirildi_mi),
    iletisim_rizasi: sayiToBool(satir.iletisim_rizasi),
  };
}

export function cariBul(vt: Vt, id: string): CariGorunumu | null {
  const satir = vt
    .hazirla(
      `SELECT ${CARI_ALANLARI.split(',')
        .map((a) => 'c.' + a.trim())
        .join(', ')},
              COALESCE(o.bakiye, 0) AS bakiye, o.son_hareket
       FROM cariler c LEFT JOIN cari_ozet o ON o.cari_id = c.id WHERE c.id = ?`,
    )
    .tek<HamCari & { bakiye: number; son_hareket: string | null }>(id);
  return satir ? { ...cariCoz(satir), bakiye: satir.bakiye, son_hareket: satir.son_hareket } : null;
}

export function carileriListele(
  vt: Vt,
  filtre: { tip?: CariTipiDb; arama?: string; sadeceBakiyeli?: boolean; sadeceAktif?: boolean } = {},
  sayfa?: SayfaSecenekleri,
): { kayitlar: CariGorunumu[]; toplam: number } {
  const kosullar: string[] = [];
  const parametreler: unknown[] = [];
  if (filtre.tip) {
    kosullar.push('c.tip = ?');
    parametreler.push(filtre.tip);
  }
  if (filtre.sadeceAktif !== false) kosullar.push('c.aktif_mi = 1');
  if (filtre.arama && filtre.arama.trim() !== '') {
    kosullar.push(`(c.arama_metni LIKE ? ESCAPE '\\' OR c.telefon LIKE ?)`);
    parametreler.push(`%${likeKacir(aramaNormalize(filtre.arama))}%`, `%${filtre.arama.trim()}%`);
  }
  if (filtre.sadeceBakiyeli) kosullar.push('COALESCE(o.bakiye, 0) <> 0');

  const nerede = kosullar.length ? 'WHERE ' + kosullar.join(' AND ') : '';
  const { limit, ofset } = limitOfset(sayfa);

  const satirlar = vt
    .hazirla(
      `SELECT ${CARI_ALANLARI.split(',')
        .map((a) => 'c.' + a.trim())
        .join(', ')},
              COALESCE(o.bakiye, 0) AS bakiye, o.son_hareket
       FROM cariler c LEFT JOIN cari_ozet o ON o.cari_id = c.id
       ${nerede}
       ORDER BY ABS(COALESCE(o.bakiye, 0)) DESC, c.ad_unvan
       LIMIT ? OFFSET ?`,
    )
    .tumu<HamCari & { bakiye: number; son_hareket: string | null }>(...parametreler, limit, ofset);

  const sayim = vt
    .hazirla(`SELECT COUNT(*) AS adet FROM cariler c LEFT JOIN cari_ozet o ON o.cari_id = c.id ${nerede}`)
    .tek<{ adet: number }>(...parametreler);

  return {
    kayitlar: satirlar.map((s) => ({ ...cariCoz(s), bakiye: s.bakiye, son_hareket: s.son_hareket })),
    toplam: sayim?.adet ?? 0,
  };
}

export function cariAra(vt: Vt, terim: string, tip?: CariTipiDb, limit = 20): CariGorunumu[] {
  return carileriListele(vt, { arama: terim, tip }, { limit }).kayitlar;
}

export interface CariYazma {
  id?: string;
  tip: CariTipiDb;
  ad_unvan: string;
  telefon?: string | null;
  eposta?: string | null;
  adres?: string | null;
  vergi_dairesi?: string | null;
  vergi_no?: string | null;
  kredi_limiti?: Kurus;
  vade_gun?: number;
  notlar?: string | null;
  aktif_mi?: boolean;
  iletisim_rizasi?: boolean;
}

export function cariKaydet(vt: Vt, girdi: CariYazma, cihazId: string, zaman = simdi()): string {
  const id = girdi.id ?? uuid();
  const riza = girdi.iletisim_rizasi ?? false;
  vt.hazirla(
    `INSERT INTO cariler (id, tip, ad_unvan, arama_metni, telefon, eposta, adres, vergi_dairesi, vergi_no,
                          kredi_limiti, vade_gun, notlar, aktif_mi, iletisim_rizasi, iletisim_rizasi_zamani,
                          created_at, updated_at, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       tip = excluded.tip, ad_unvan = excluded.ad_unvan, arama_metni = excluded.arama_metni,
       telefon = excluded.telefon, eposta = excluded.eposta, adres = excluded.adres,
       vergi_dairesi = excluded.vergi_dairesi, vergi_no = excluded.vergi_no,
       kredi_limiti = excluded.kredi_limiti, vade_gun = excluded.vade_gun, notlar = excluded.notlar,
       aktif_mi = excluded.aktif_mi, iletisim_rizasi = excluded.iletisim_rizasi,
       iletisim_rizasi_zamani = excluded.iletisim_rizasi_zamani,
       updated_at = excluded.updated_at, cihaz_id = excluded.cihaz_id`,
  ).calistir(
    id,
    girdi.tip,
    girdi.ad_unvan.trim(),
    aramaMetniOlustur(girdi.ad_unvan, girdi.telefon, girdi.vergi_no),
    girdi.telefon ?? null,
    girdi.eposta ?? null,
    girdi.adres ?? null,
    girdi.vergi_dairesi ?? null,
    girdi.vergi_no ?? null,
    girdi.kredi_limiti ?? 0,
    girdi.vade_gun ?? 0,
    girdi.notlar ?? null,
    boolToSayi(girdi.aktif_mi ?? true),
    boolToSayi(riza),
    riza ? zaman : null,
    zaman,
    zaman,
    cihazId,
  );
  return id;
}

// ---------------------------------------------------------------------------
// Hareketler
// ---------------------------------------------------------------------------

export interface CariHareketiYazma {
  cari_id: string;
  hareket_tipi: CariHareketTipiDb;
  /** İşaretli kuruş. */
  tutar: Kurus;
  aciklama?: string | null;
  belge_id?: string | null;
  belge_tipi?: string | null;
  vade_tarihi?: string | null;
  kullanici_id?: string | null;
  tarih?: ZamanDamgasi;
  /** Kartla tahsilatta POS onay kodu, cihaz referansı ve maskeli kart. */
  pos_onay_kodu?: string | null;
  pos_referans?: string | null;
  pos_kart?: string | null;
}

export function cariHareketEkle(vt: Vt, hareket: CariHareketiYazma, cihazId: string, zaman = simdi()): string {
  const id = uuid();
  vt.hazirla(
    `INSERT INTO cari_hareketler (id, cari_id, hareket_tipi, tutar, aciklama, belge_id, belge_tipi,
                                  tarih, vade_tarihi, kullanici_id, created_at, updated_at, cihaz_id,
                                  pos_onay_kodu, pos_referans, pos_kart)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).calistir(
    id,
    hareket.cari_id,
    hareket.hareket_tipi,
    hareket.tutar,
    hareket.aciklama ?? null,
    hareket.belge_id ?? null,
    hareket.belge_tipi ?? null,
    hareket.tarih ?? zaman,
    hareket.vade_tarihi ?? null,
    hareket.kullanici_id ?? null,
    zaman,
    zaman,
    cihazId,
    hareket.pos_onay_kodu ?? null,
    hareket.pos_referans ?? null,
    hareket.pos_kart ?? null,
  );
  return id;
}

export function bakiyeOku(vt: Vt, cariId: string): Kurus {
  const satir = vt.hazirla('SELECT bakiye FROM cari_ozet WHERE cari_id = ?').tek<{ bakiye: number }>(cariId);
  return satir?.bakiye ?? 0;
}

export function bakiyeleriOku(vt: Vt, cariIdler: readonly string[]): Map<string, Kurus> {
  const harita = new Map<string, Kurus>();
  if (cariIdler.length === 0) return harita;
  const satirlar = vt
    .hazirla(`SELECT cari_id, bakiye FROM cari_ozet WHERE cari_id IN (${yerTutucular(cariIdler.length)})`)
    .tumu<{ cari_id: string; bakiye: number }>(...cariIdler);
  for (const s of satirlar) harita.set(s.cari_id, s.bakiye);
  for (const id of cariIdler) if (!harita.has(id)) harita.set(id, 0);
  return harita;
}

export interface EkstreSatiri {
  id: string;
  tarih: ZamanDamgasi;
  hareket_tipi: CariHareketTipiDb;
  tutar: Kurus;
  aciklama: string | null;
  belge_id: string | null;
  belge_tipi: string | null;
  vade_tarihi: string | null;
  /** Tahsilat/ödeme nakit (kasadan) mı yapıldı; diğer hareketlerde null. İptal penceresi varsayılanı buradan alır. */
  nakit_mi: boolean | null;
  /** Yürüyen bakiye — hareketler eskiden yeniye toplanarak hesaplanır. */
  yuruyen_bakiye: Kurus;
}

/** Hesap ekstresi (§10.7). Yürüyen bakiye kronolojik sırayla hesaplanır. */
export function ekstre(vt: Vt, cariId: string, baslangic?: ZamanDamgasi, bitis?: ZamanDamgasi, limit = 500): EkstreSatiri[] {
  const kosullar = ['cari_id = ?'];
  const parametreler: unknown[] = [cariId];
  if (baslangic) {
    kosullar.push('tarih >= ?');
    parametreler.push(baslangic);
  }
  if (bitis) {
    kosullar.push('tarih < ?');
    parametreler.push(bitis);
  }

  // Aralıktan önceki bakiye (devir) — yürüyen bakiyenin başlangıç noktası.
  let devir = 0;
  if (baslangic) {
    const satir = vt
      .hazirla('SELECT COALESCE(SUM(tutar), 0) AS toplam FROM cari_hareketler WHERE cari_id = ? AND tarih < ?')
      .tek<{ toplam: number }>(cariId, baslangic);
    devir = satir?.toplam ?? 0;
  }

  const satirlar = vt
    .hazirla(
      /*
       * Nakit mi: kasa hareketi tahsilat/ödemenin kendisine, mal kabul
       * ödemesinde (ALIS_ODEME) ise faturaya bağlıdır.
       */
      `SELECT id, tarih, hareket_tipi, tutar, aciklama, belge_id, belge_tipi, vade_tarihi,
              CASE WHEN hareket_tipi IN ('TAHSILAT', 'ODEME') THEN
                EXISTS (SELECT 1 FROM kasa_hareketleri k WHERE k.belge_id = cari_hareketler.id)
                OR (belge_tipi = 'ALIS_ODEME' AND EXISTS (
                  SELECT 1 FROM kasa_hareketleri k WHERE k.belge_id = cari_hareketler.belge_id AND k.tip = 'ODEME'))
              END AS nakit_mi
       FROM cari_hareketler WHERE ${kosullar.join(' AND ')}
       ORDER BY tarih, rowid LIMIT ?`,
    )
    .tumu<Omit<EkstreSatiri, 'yuruyen_bakiye' | 'nakit_mi'> & { nakit_mi: number | null }>(...parametreler, limit);

  let yuruyen = devir;
  return satirlar.map((s) => {
    yuruyen += s.tutar;
    return { ...s, nakit_mi: s.nakit_mi === null ? null : Boolean(s.nakit_mi), yuruyen_bakiye: yuruyen };
  });
}

/** Toplam müşteri alacağı / tedarikçi borcu (dashboard ve raporlar). */
export function toplamBakiyeler(vt: Vt): { musteriAlacagi: Kurus; tedarikciBorcu: Kurus } {
  const satir = vt
    .hazirla(
      `SELECT
         COALESCE(SUM(CASE WHEN c.tip = 'MUSTERI'   AND o.bakiye > 0 THEN o.bakiye ELSE 0 END), 0) AS musteri,
         COALESCE(SUM(CASE WHEN c.tip = 'TEDARIKCI' AND o.bakiye > 0 THEN o.bakiye ELSE 0 END), 0) AS tedarikci
       FROM cari_ozet o JOIN cariler c ON c.id = o.cari_id
       WHERE c.aktif_mi = 1`,
    )
    .tek<{ musteri: number; tedarikci: number }>();
  return { musteriAlacagi: satir?.musteri ?? 0, tedarikciBorcu: satir?.tedarikci ?? 0 };
}

export interface YaslandirmaSatiri {
  cari_id: string;
  ad_unvan: string;
  tip: CariTipiDb;
  telefon: string | null;
  bakiye: Kurus;
  dilim_0_30: Kurus;
  dilim_31_60: Kurus;
  dilim_61_90: Kurus;
  dilim_90_ustu: Kurus;
}

/**
 * Yaşlandırma raporu (§11.6). Borç hareketlerinin yaşına göre dilimlenir;
 * tahsilatlar en eski borçtan başlayarak mahsup edilir (FIFO).
 */
export function yaslandirma(vt: Vt, tip: CariTipiDb, referansZaman: ZamanDamgasi = simdi()): YaslandirmaSatiri[] {
  const cariler = vt
    .hazirla(
      `SELECT c.id, c.ad_unvan, c.tip, c.telefon, COALESCE(o.bakiye, 0) AS bakiye
       FROM cariler c JOIN cari_ozet o ON o.cari_id = c.id
       WHERE c.tip = ? AND c.aktif_mi = 1 AND o.bakiye > 0
       ORDER BY o.bakiye DESC`,
    )
    .tumu<{ id: string; ad_unvan: string; tip: CariTipiDb; telefon: string | null; bakiye: number }>(tip);

  if (cariler.length === 0) return [];

  const hareketIfadesi = vt.hazirla('SELECT tutar, tarih FROM cari_hareketler WHERE cari_id = ? ORDER BY tarih, rowid');
  const referans = Date.parse(referansZaman);

  return cariler.map((cari) => {
    const hareketler = hareketIfadesi.tumu<{ tutar: number; tarih: string }>(cari.id);
    // Açık borç kalemleri kuyruğu; alacak/tahsilat en eskiden mahsup edilir (FIFO).
    const acikBorclar: { tutar: number; tarih: string }[] = [];
    for (const h of hareketler) {
      if (h.tutar > 0) {
        acikBorclar.push({ tutar: h.tutar, tarih: h.tarih });
        continue;
      }
      let mahsup = -h.tutar;
      while (mahsup > 0 && acikBorclar.length > 0) {
        const ilk = acikBorclar[0];
        if (!ilk) break;
        const dusulen = Math.min(ilk.tutar, mahsup);
        ilk.tutar -= dusulen;
        mahsup -= dusulen;
        if (ilk.tutar === 0) acikBorclar.shift();
      }
    }

    const dilimler = [0, 0, 0, 0];
    for (const borc of acikBorclar) {
      const gun = Math.floor((referans - Date.parse(borc.tarih)) / 86400000);
      const i = gun <= 30 ? 0 : gun <= 60 ? 1 : gun <= 90 ? 2 : 3;
      dilimler[i] = (dilimler[i] ?? 0) + borc.tutar;
    }

    return {
      cari_id: cari.id,
      ad_unvan: cari.ad_unvan,
      tip: cari.tip,
      telefon: cari.telefon,
      bakiye: cari.bakiye,
      dilim_0_30: dilimler[0] ?? 0,
      dilim_31_60: dilimler[1] ?? 0,
      dilim_61_90: dilimler[2] ?? 0,
      dilim_90_ustu: dilimler[3] ?? 0,
    };
  });
}

/** Vadesi geçmiş bakiyeler (§11.6 uyarıları). */
export function vadesiGecenler(
  vt: Vt,
  referansZaman: ZamanDamgasi = simdi(),
): { cari_id: string; ad_unvan: string; telefon: string | null; tutar: Kurus; vade_tarihi: string }[] {
  const gun = referansZaman.slice(0, 10);
  return vt
    .hazirla(
      `SELECT h.cari_id, c.ad_unvan, c.telefon, SUM(h.tutar) AS tutar, MIN(h.vade_tarihi) AS vade_tarihi
       FROM cari_hareketler h JOIN cariler c ON c.id = h.cari_id
       WHERE h.vade_tarihi IS NOT NULL AND h.vade_tarihi < ? AND h.tutar > 0 AND c.aktif_mi = 1
       GROUP BY h.cari_id
       HAVING SUM(h.tutar) > 0
       ORDER BY vade_tarihi`,
    )
    .tumu<{ cari_id: string; ad_unvan: string; telefon: string | null; tutar: number; vade_tarihi: string }>(gun);
}

// ---------------------------------------------------------------------------
// KVKK (§16.2)
// ---------------------------------------------------------------------------

/**
 * Veri sahibinin talebi üzerine kişisel alanları maskeler.
 * **Mali kayıt bütünlüğü korunur**: hareketler ve tutarlar aynen kalır, yalnız
 * kimliklendirici alanlar silinir (§16.2, §17.5 saklama yükümlülüğü).
 */
export function cariAnonimlestir(vt: Vt, cariId: string, cihazId: string, zaman = simdi()): void {
  vt.hazirla(
    `UPDATE cariler SET
       ad_unvan = 'Anonimleştirilmiş kayıt ' || substr(id, 1, 8),
       arama_metni = '',
       telefon = NULL, eposta = NULL, adres = NULL, vergi_dairesi = NULL, vergi_no = NULL,
       notlar = NULL, iletisim_rizasi = 0, iletisim_rizasi_zamani = NULL,
       anonimlestirildi_mi = 1, aktif_mi = 0,
       updated_at = ?, cihaz_id = ?
     WHERE id = ?`,
  ).calistir(zaman, cihazId, cariId);
}

/** Veri taşınabilirliği: cariye ait tüm kişisel veri + hareketler (§16.2). */
export function cariVerisiniDisaAktar(vt: Vt, cariId: string): { cari: CariGorunumu | null; hareketler: EkstreSatiri[] } {
  return { cari: cariBul(vt, cariId), hareketler: ekstre(vt, cariId, undefined, undefined, 10000) };
}

// ---------------------------------------------------------------------------
// Senkron (pull) uygulaması
// ---------------------------------------------------------------------------

export function cariSunucudanUygula(vt: Vt, veri: Record<string, unknown>, versiyon: number): void {
  const id = String(veri.id ?? '');
  if (!id) return;
  const mevcut = vt.hazirla('SELECT updated_at FROM cariler WHERE id = ?').tek<{ updated_at: string }>(id);
  const gelenZaman = String(veri.updated_at ?? '');
  if (mevcut && mevcut.updated_at > gelenZaman) return;

  const ad = String(veri.ad_unvan ?? '');
  vt.hazirla(
    `INSERT INTO cariler (id, tip, ad_unvan, arama_metni, telefon, eposta, adres, vergi_dairesi, vergi_no,
                          kredi_limiti, vade_gun, notlar, aktif_mi, anonimlestirildi_mi, iletisim_rizasi,
                          iletisim_rizasi_zamani, created_at, updated_at, cihaz_id, sunucu_versiyonu)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       tip = excluded.tip, ad_unvan = excluded.ad_unvan, arama_metni = excluded.arama_metni,
       telefon = excluded.telefon, eposta = excluded.eposta, adres = excluded.adres,
       vergi_dairesi = excluded.vergi_dairesi, vergi_no = excluded.vergi_no,
       kredi_limiti = excluded.kredi_limiti, vade_gun = excluded.vade_gun, notlar = excluded.notlar,
       aktif_mi = excluded.aktif_mi, anonimlestirildi_mi = excluded.anonimlestirildi_mi,
       iletisim_rizasi = excluded.iletisim_rizasi, iletisim_rizasi_zamani = excluded.iletisim_rizasi_zamani,
       updated_at = excluded.updated_at, sunucu_versiyonu = excluded.sunucu_versiyonu`,
  ).calistir(
    id,
    String(veri.tip ?? 'MUSTERI'),
    ad,
    aramaMetniOlustur(ad, veri.telefon as string | null, veri.vergi_no as string | null),
    (veri.telefon as string | null) ?? null,
    (veri.eposta as string | null) ?? null,
    (veri.adres as string | null) ?? null,
    (veri.vergi_dairesi as string | null) ?? null,
    (veri.vergi_no as string | null) ?? null,
    Number(veri.kredi_limiti ?? 0),
    Number(veri.vade_gun ?? 0),
    (veri.notlar as string | null) ?? null,
    boolToSayi(veri.aktif_mi !== false && veri.aktif_mi !== 0),
    boolToSayi(veri.anonimlestirildi_mi === true || veri.anonimlestirildi_mi === 1),
    boolToSayi(veri.iletisim_rizasi === true || veri.iletisim_rizasi === 1),
    (veri.iletisim_rizasi_zamani as string | null) ?? null,
    String(veri.created_at ?? gelenZaman),
    gelenZaman,
    (veri.cihaz_id as string | null) ?? null,
    versiyon,
  );
}
