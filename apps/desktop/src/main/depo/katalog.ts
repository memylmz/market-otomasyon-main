/**
 * Katalog repository'si: kategoriler, ürünler, barkodlar.
 *
 * Performans notu (§3.1): barkod okutma → satır sepete düşme ≤ 100 ms hedefi
 * `barkodlaBul` sorgusuna bağlıdır. Sorgu, `ux_barkodlar_barkod` benzersiz
 * indeksi üzerinden tek geçişte ürünü, fiyatını ve güncel stoğunu getirir.
 */

import { aramaMetniOlustur, aramaNormalize, likeKacir, simdi, uuid, type Miktar, type ZamanDamgasi } from '@market/shared';
import type { Vt } from '../db/surucu.js';
import { boolToSayi, limitOfset, sayiToBool, yerTutucular, type HamSatir, type SayfaSecenekleri } from './ortak.js';

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export interface KategoriKaydi {
  id: string;
  ad: string;
  ust_kategori_id: string | null;
  sira: number;
  aktif_mi: boolean;
  created_at: ZamanDamgasi;
  updated_at: ZamanDamgasi;
  cihaz_id: string | null;
  sunucu_versiyonu: number;
}

export interface UrunKaydi {
  id: string;
  ad: string;
  kategori_id: string | null;
  marka: string | null;
  birim_tipi: 'ADET' | 'KG' | 'LT';
  alis_fiyati: number;
  satis_fiyati: number;
  kdv_orani: number;
  kritik_stok: Miktar;
  ideal_stok: Miktar;
  raf_konumu: string | null;
  aktif_mi: boolean;
  varsayilan_tedarikci_id: string | null;
  skt_takibi: boolean;
  notlar: string | null;
  created_at: ZamanDamgasi;
  updated_at: ZamanDamgasi;
  cihaz_id: string | null;
  sunucu_versiyonu: number;
}

/** Ürün + türetilmiş alanlar (liste ve satış ekranı için). */
export interface UrunGorunumu extends UrunKaydi {
  stok: Miktar;
  kategori_adi: string | null;
  barkodlar: string[];
}

export interface BarkodKaydiSatiri {
  id: string;
  urun_id: string;
  barkod: string;
  ambalaj_aciklamasi: string | null;
  aktif_mi: boolean;
  created_at: ZamanDamgasi;
  updated_at: ZamanDamgasi;
  cihaz_id: string | null;
  sunucu_versiyonu: number;
}

export interface UrunFiltresi {
  arama?: string;
  kategoriId?: string | null;
  sadeceAktif?: boolean;
  sadeceKritikStok?: boolean;
  sadecePasif?: boolean;
  tedarikciId?: string | null;
  siralama?: 'ad' | 'stok' | 'fiyat' | 'guncelleme';
}

// ---------------------------------------------------------------------------
// Satır → nesne dönüşümü
// ---------------------------------------------------------------------------

type HamUrun = Omit<UrunKaydi, 'aktif_mi' | 'skt_takibi'> & { aktif_mi: number; skt_takibi: number };

function urunCoz(satir: HamUrun): UrunKaydi {
  return { ...satir, aktif_mi: sayiToBool(satir.aktif_mi), skt_takibi: sayiToBool(satir.skt_takibi) };
}

const URUN_ALANLARI = `id, ad, kategori_id, marka, birim_tipi, alis_fiyati, satis_fiyati, kdv_orani,
  kritik_stok, ideal_stok, raf_konumu, aktif_mi, varsayilan_tedarikci_id, skt_takibi, notlar,
  created_at, updated_at, cihaz_id, sunucu_versiyonu`;

/**
 * Türkçe alfabetik sıralama ifadesi: ç/ğ/ı/ö/ş/ü doğru sırada, büyük/küçük harf
 * duyarsız. `tr_sira` sürücü açılışında kaydedilir; kaydedilememişse (eski
 * node:sqlite) en yakın yedek olan NOCASE kullanılır — o da en azından
 * büyük/küçük harfi eşitler.
 */
function adSiralamasi(vt: Vt, sutun: string): string {
  return vt.fonksiyonVarMi('tr_sira') ? `tr_sira(${sutun})` : `${sutun} COLLATE NOCASE`;
}

// ---------------------------------------------------------------------------
// Kategori
// ---------------------------------------------------------------------------

export function kategorileriListele(vt: Vt, sadeceAktif = true): KategoriKaydi[] {
  const satirlar = vt
    .hazirla(
      `SELECT id, ad, ust_kategori_id, sira, aktif_mi, created_at, updated_at, cihaz_id, sunucu_versiyonu
       FROM kategoriler ${sadeceAktif ? 'WHERE aktif_mi = 1' : ''} ORDER BY sira, ${adSiralamasi(vt, 'ad')}`,
    )
    .tumu<HamSatir<KategoriKaydi, 'aktif_mi'>>();
  return satirlar.map((s) => ({ ...s, aktif_mi: sayiToBool(s.aktif_mi) }));
}

export function kategoriBul(vt: Vt, id: string): KategoriKaydi | null {
  const satir = vt
    .hazirla(
      `SELECT id, ad, ust_kategori_id, sira, aktif_mi, created_at, updated_at, cihaz_id, sunucu_versiyonu
       FROM kategoriler WHERE id = ?`,
    )
    .tek<HamSatir<KategoriKaydi, 'aktif_mi'>>(id);
  return satir ? { ...satir, aktif_mi: sayiToBool(satir.aktif_mi) } : null;
}

export interface KategoriYazma {
  id?: string;
  ad: string;
  ust_kategori_id?: string | null;
  sira?: number;
  aktif_mi?: boolean;
}

export function kategoriKaydet(vt: Vt, girdi: KategoriYazma, cihazId: string, zaman = simdi()): string {
  const id = girdi.id ?? uuid();
  vt.hazirla(
    `INSERT INTO kategoriler (id, ad, ust_kategori_id, sira, aktif_mi, created_at, updated_at, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       ad = excluded.ad, ust_kategori_id = excluded.ust_kategori_id, sira = excluded.sira,
       aktif_mi = excluded.aktif_mi, updated_at = excluded.updated_at, cihaz_id = excluded.cihaz_id`,
  ).calistir(
    id,
    girdi.ad.trim(),
    girdi.ust_kategori_id ?? null,
    girdi.sira ?? 0,
    boolToSayi(girdi.aktif_mi ?? true),
    zaman,
    zaman,
    cihazId,
  );
  return id;
}

// ---------------------------------------------------------------------------
// Ürün
// ---------------------------------------------------------------------------

export function urunBul(vt: Vt, id: string): UrunKaydi | null {
  const satir = vt.hazirla(`SELECT ${URUN_ALANLARI} FROM urunler WHERE id = ?`).tek<HamUrun>(id);
  return satir ? urunCoz(satir) : null;
}

export function urunleriBul(vt: Vt, idler: readonly string[]): Map<string, UrunKaydi> {
  const harita = new Map<string, UrunKaydi>();
  if (idler.length === 0) return harita;
  const satirlar = vt
    .hazirla(`SELECT ${URUN_ALANLARI} FROM urunler WHERE id IN (${yerTutucular(idler.length)})`)
    .tumu<HamUrun>(...idler);
  for (const satir of satirlar) harita.set(satir.id, urunCoz(satir));
  return harita;
}

/**
 * Barkoddan ürün çözümü — satış ekranının sıcak yolu.
 * Pasif barkod ya da pasif ürün de döner; satışa uygunluk kararı servis katmanında
 * verilir (kullanıcıya "ürün pasif" demek, "bulunamadı" demekten daha yararlıdır).
 */
/**
 * Terazi barkodunun ÜRÜN ÖNEKİYLE eşleşen ürünü bulur (§10.1).
 *
 * Terazi barkodunun son 6 hanesi her tartımda değişir (ağırlık/tutar + kontrol
 * hanesi), bu yüzden tam eşleşme aranamaz. Eşleşme ilk 7 hane üzerindendir:
 * ön ek + terazideki ürün kodu. Operatör ürüne o reyondan basılmış herhangi bir
 * etiketi bir kez tanıttığında sonraki tüm tartımlar bulunur.
 */
export function tartiliUrunOnekiIleBul(vt: Vt, urunOneki: string): (UrunGorunumu & { barkod_aktif: boolean }) | null {
  const satir = vt
    .hazirla(
      `SELECT u.id, u.ad, u.kategori_id, u.marka, u.birim_tipi, u.alis_fiyati, u.satis_fiyati, u.kdv_orani,
              u.kritik_stok, u.ideal_stok, u.raf_konumu, u.aktif_mi, u.varsayilan_tedarikci_id, u.skt_takibi,
              u.notlar, u.created_at, u.updated_at, u.cihaz_id, u.sunucu_versiyonu,
              COALESCE(so.miktar, 0) AS stok,
              k.ad AS kategori_adi,
              b.aktif_mi AS barkod_aktif,
              b.barkod AS eslesen_barkod
       FROM barkodlar b
       JOIN urunler u ON u.id = b.urun_id
       LEFT JOIN stok_ozet so ON so.urun_id = u.id
       LEFT JOIN kategoriler k ON k.id = u.kategori_id
       WHERE LENGTH(b.barkod) = 13 AND SUBSTR(b.barkod, 1, 7) = ?
       ORDER BY b.aktif_mi DESC
       LIMIT 1`,
    )
    .tek<HamUrun & { stok: number; kategori_adi: string | null; barkod_aktif: number; eslesen_barkod: string }>(urunOneki);

  if (!satir) return null;
  return {
    ...urunCoz(satir),
    stok: satir.stok,
    kategori_adi: satir.kategori_adi,
    barkodlar: [satir.eslesen_barkod],
    barkod_aktif: sayiToBool(satir.barkod_aktif),
  };
}

export function barkodlaBul(vt: Vt, barkod: string): (UrunGorunumu & { barkod_aktif: boolean }) | null {
  const satir = vt
    .hazirla(
      `SELECT u.id, u.ad, u.kategori_id, u.marka, u.birim_tipi, u.alis_fiyati, u.satis_fiyati, u.kdv_orani,
              u.kritik_stok, u.ideal_stok, u.raf_konumu, u.aktif_mi, u.varsayilan_tedarikci_id, u.skt_takibi,
              u.notlar, u.created_at, u.updated_at, u.cihaz_id, u.sunucu_versiyonu,
              COALESCE(so.miktar, 0) AS stok,
              k.ad AS kategori_adi,
              b.aktif_mi AS barkod_aktif,
              b.barkod AS eslesen_barkod
       FROM barkodlar b
       JOIN urunler u ON u.id = b.urun_id
       LEFT JOIN stok_ozet so ON so.urun_id = u.id
       LEFT JOIN kategoriler k ON k.id = u.kategori_id
       WHERE b.barkod = ?`,
    )
    .tek<HamUrun & { stok: number; kategori_adi: string | null; barkod_aktif: number; eslesen_barkod: string }>(barkod);

  if (!satir) return null;
  return {
    ...urunCoz(satir),
    stok: satir.stok,
    kategori_adi: satir.kategori_adi,
    barkodlar: [satir.eslesen_barkod],
    barkod_aktif: sayiToBool(satir.barkod_aktif),
  };
}

/**
 * İsim/marka/barkod araması (F2). Türkçe karakter duyarsızdır: `arama_metni`
 * sütunu `aramaNormalize` ile üretildiği için "sut" → "Süt"ü bulur.
 * Önce baştan eşleşenler, sonra içinde geçenler sıralanır.
 */
export function urunAra(vt: Vt, terim: string, limit = 30): UrunGorunumu[] {
  const normal = aramaNormalize(terim);
  if (normal === '') return [];
  const kacisli = likeKacir(normal);
  const satirlar = vt
    .hazirla(
      `SELECT ${URUN_ALANLARI.split(',')
        .map((a) => 'u.' + a.trim())
        .join(', ')},
              COALESCE(so.miktar, 0) AS stok, k.ad AS kategori_adi
       FROM urunler u
       LEFT JOIN stok_ozet so ON so.urun_id = u.id
       LEFT JOIN kategoriler k ON k.id = u.kategori_id
       WHERE u.arama_metni LIKE ? ESCAPE '\\'
          OR u.id IN (SELECT urun_id FROM barkodlar WHERE barkod LIKE ? ESCAPE '\\')
       ORDER BY u.aktif_mi DESC,
                CASE WHEN u.arama_metni LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,
                ${adSiralamasi(vt, 'u.ad')}
       LIMIT ?`,
    )
    .tumu<HamUrun & { stok: number; kategori_adi: string | null }>(
      `%${kacisli}%`,
      `${likeKacir(terim.trim())}%`,
      `${kacisli}%`,
      limit,
    );
  return satirlar.map((s) => ({ ...urunCoz(s), stok: s.stok, kategori_adi: s.kategori_adi, barkodlar: [] }));
}

export function urunleriListele(
  vt: Vt,
  filtre: UrunFiltresi = {},
  sayfa?: SayfaSecenekleri,
): { kayitlar: UrunGorunumu[]; toplam: number } {
  const kosullar: string[] = [];
  const parametreler: unknown[] = [];

  if (filtre.sadecePasif) {
    kosullar.push('u.aktif_mi = 0');
  } else if (filtre.sadeceAktif !== false) {
    kosullar.push('u.aktif_mi = 1');
  }
  if (filtre.kategoriId) {
    kosullar.push('u.kategori_id = ?');
    parametreler.push(filtre.kategoriId);
  }
  if (filtre.tedarikciId) {
    kosullar.push('u.varsayilan_tedarikci_id = ?');
    parametreler.push(filtre.tedarikciId);
  }
  if (filtre.arama && filtre.arama.trim() !== '') {
    kosullar.push(
      `(u.arama_metni LIKE ? ESCAPE '\\' OR u.id IN (SELECT urun_id FROM barkodlar WHERE barkod LIKE ? ESCAPE '\\'))`,
    );
    parametreler.push(`%${likeKacir(aramaNormalize(filtre.arama))}%`, `${likeKacir(filtre.arama.trim())}%`);
  }
  if (filtre.sadeceKritikStok) {
    kosullar.push('u.kritik_stok > 0 AND COALESCE(so.miktar, 0) <= u.kritik_stok');
  }

  const nerede = kosullar.length ? 'WHERE ' + kosullar.join(' AND ') : '';
  const adaGore = adSiralamasi(vt, 'u.ad');
  const siralama =
    filtre.siralama === 'stok'
      ? `COALESCE(so.miktar, 0) ASC, ${adaGore}`
      : filtre.siralama === 'fiyat'
        ? `u.satis_fiyati DESC, ${adaGore}`
        : filtre.siralama === 'guncelleme'
          ? 'u.updated_at DESC'
          : adaGore;

  const { limit, ofset } = limitOfset(sayfa);
  const satirlar = vt
    .hazirla(
      `SELECT ${URUN_ALANLARI.split(',')
        .map((a) => 'u.' + a.trim())
        .join(', ')},
              COALESCE(so.miktar, 0) AS stok, k.ad AS kategori_adi
       FROM urunler u
       LEFT JOIN stok_ozet so ON so.urun_id = u.id
       LEFT JOIN kategoriler k ON k.id = u.kategori_id
       ${nerede}
       ORDER BY ${siralama}
       LIMIT ? OFFSET ?`,
    )
    .tumu<HamUrun & { stok: number; kategori_adi: string | null }>(...parametreler, limit, ofset);

  const sayim = vt
    .hazirla(`SELECT COUNT(*) AS adet FROM urunler u LEFT JOIN stok_ozet so ON so.urun_id = u.id ${nerede}`)
    .tek<{ adet: number }>(...parametreler);

  return {
    kayitlar: satirlar.map((s) => ({ ...urunCoz(s), stok: s.stok, kategori_adi: s.kategori_adi, barkodlar: [] })),
    toplam: sayim?.adet ?? 0,
  };
}

export interface UrunYazma {
  id?: string;
  ad: string;
  kategori_id?: string | null;
  marka?: string | null;
  birim_tipi?: 'ADET' | 'KG' | 'LT';
  alis_fiyati?: number;
  satis_fiyati: number;
  kdv_orani?: number;
  kritik_stok?: Miktar;
  ideal_stok?: Miktar;
  raf_konumu?: string | null;
  aktif_mi?: boolean;
  varsayilan_tedarikci_id?: string | null;
  skt_takibi?: boolean;
  notlar?: string | null;
}

export function urunKaydet(vt: Vt, girdi: UrunYazma, cihazId: string, zaman = simdi()): string {
  const id = girdi.id ?? uuid();
  const arama = aramaMetniOlustur(girdi.ad, girdi.marka, girdi.raf_konumu);
  vt.hazirla(
    `INSERT INTO urunler (id, ad, arama_metni, kategori_id, marka, birim_tipi, alis_fiyati, satis_fiyati,
                          kdv_orani, kritik_stok, ideal_stok, raf_konumu, aktif_mi, varsayilan_tedarikci_id,
                          skt_takibi, notlar, created_at, updated_at, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       ad = excluded.ad, arama_metni = excluded.arama_metni, kategori_id = excluded.kategori_id,
       marka = excluded.marka, birim_tipi = excluded.birim_tipi, alis_fiyati = excluded.alis_fiyati,
       satis_fiyati = excluded.satis_fiyati, kdv_orani = excluded.kdv_orani, kritik_stok = excluded.kritik_stok,
       ideal_stok = excluded.ideal_stok, raf_konumu = excluded.raf_konumu, aktif_mi = excluded.aktif_mi,
       varsayilan_tedarikci_id = excluded.varsayilan_tedarikci_id, skt_takibi = excluded.skt_takibi,
       notlar = excluded.notlar, updated_at = excluded.updated_at, cihaz_id = excluded.cihaz_id`,
  ).calistir(
    id,
    girdi.ad.trim(),
    arama,
    girdi.kategori_id ?? null,
    girdi.marka ?? null,
    girdi.birim_tipi ?? 'ADET',
    girdi.alis_fiyati ?? 0,
    girdi.satis_fiyati,
    girdi.kdv_orani ?? 20,
    girdi.kritik_stok ?? 0,
    girdi.ideal_stok ?? 0,
    girdi.raf_konumu ?? null,
    boolToSayi(girdi.aktif_mi ?? true),
    girdi.varsayilan_tedarikci_id ?? null,
    boolToSayi(girdi.skt_takibi ?? false),
    girdi.notlar ?? null,
    zaman,
    zaman,
    cihazId,
  );
  return id;
}

/** Fiziksel silme yoktur; pasifleştirme yapılır (§8.5). */
export function urunPasiflestir(vt: Vt, id: string, pasif: boolean, cihazId: string, zaman = simdi()): void {
  vt.hazirla('UPDATE urunler SET aktif_mi = ?, updated_at = ?, cihaz_id = ? WHERE id = ?').calistir(
    boolToSayi(!pasif),
    zaman,
    cihazId,
    id,
  );
}

/** Toplu fiyat güncelleme (§10.5 "%'yle zam"). Etkilenen satır sayısını döner. */
export function topluFiyatGuncelle(
  vt: Vt,
  urunIdler: readonly string[],
  yeniFiyatlar: ReadonlyMap<string, number>,
  cihazId: string,
  zaman = simdi(),
): number {
  const ifade = vt.hazirla('UPDATE urunler SET satis_fiyati = ?, updated_at = ?, cihaz_id = ? WHERE id = ?');
  let etkilenen = 0;
  for (const id of urunIdler) {
    const fiyat = yeniFiyatlar.get(id);
    if (fiyat === undefined) continue;
    etkilenen += ifade.calistir(fiyat, zaman, cihazId, id).changes;
  }
  return etkilenen;
}

// ---------------------------------------------------------------------------
// Barkod
// ---------------------------------------------------------------------------

export function urununBarkodlari(vt: Vt, urunId: string): BarkodKaydiSatiri[] {
  return vt
    .hazirla(
      `SELECT id, urun_id, barkod, ambalaj_aciklamasi, aktif_mi, created_at, updated_at, cihaz_id, sunucu_versiyonu
       FROM barkodlar WHERE urun_id = ? ORDER BY created_at`,
    )
    .tumu<HamSatir<BarkodKaydiSatiri, 'aktif_mi'>>(urunId)
    .map((s) => ({ ...s, aktif_mi: sayiToBool(s.aktif_mi) }));
}

/** Barkodun sahibi olan ürünün id'sini döner (benzersizlik kontrolü için). */
export function barkodSahibi(vt: Vt, barkod: string): string | null {
  const satir = vt.hazirla('SELECT urun_id FROM barkodlar WHERE barkod = ?').tek<{ urun_id: string }>(barkod);
  return satir?.urun_id ?? null;
}

export function barkodEkle(
  vt: Vt,
  urunId: string,
  barkod: string,
  ambalaj: string | null,
  cihazId: string,
  zaman = simdi(),
): string {
  const id = uuid();
  vt.hazirla(
    `INSERT INTO barkodlar (id, urun_id, barkod, ambalaj_aciklamasi, aktif_mi, created_at, updated_at, cihaz_id)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(barkod) DO UPDATE SET
       urun_id = excluded.urun_id, ambalaj_aciklamasi = excluded.ambalaj_aciklamasi,
       aktif_mi = 1, updated_at = excluded.updated_at, cihaz_id = excluded.cihaz_id`,
  ).calistir(id, urunId, barkod, ambalaj, zaman, zaman, cihazId);
  // Çakışma durumunda mevcut satır güncellenir; gerçek satır kimliğini geri okuyalım.
  const satir = vt.hazirla('SELECT id FROM barkodlar WHERE barkod = ?').tek<{ id: string }>(barkod);
  return satir?.id ?? id;
}

export function barkodKaldir(vt: Vt, barkod: string, cihazId: string, zaman = simdi()): void {
  vt.hazirla('UPDATE barkodlar SET aktif_mi = 0, updated_at = ?, cihaz_id = ? WHERE barkod = ?').calistir(zaman, cihazId, barkod);
}

/** Ürün listesine barkodları toplu yükler (N+1 sorgu önlenir — §6.5). */
export function barkodlariDoldur(vt: Vt, urunler: UrunGorunumu[]): void {
  if (urunler.length === 0) return;
  const idler = urunler.map((u) => u.id);
  const satirlar = vt
    .hazirla(`SELECT urun_id, barkod FROM barkodlar WHERE aktif_mi = 1 AND urun_id IN (${yerTutucular(idler.length)})`)
    .tumu<{ urun_id: string; barkod: string }>(...idler);
  const harita = new Map<string, string[]>();
  for (const s of satirlar) {
    const liste = harita.get(s.urun_id) ?? [];
    liste.push(s.barkod);
    harita.set(s.urun_id, liste);
  }
  for (const urun of urunler) urun.barkodlar = harita.get(urun.id) ?? [];
}

// ---------------------------------------------------------------------------
// Kampanya
// ---------------------------------------------------------------------------

export interface KampanyaKaydi {
  id: string;
  ad: string;
  tip: 'YUZDE' | 'TUTAR' | 'SABIT_FIYAT';
  kapsam: 'URUN' | 'KATEGORI' | 'TUM';
  hedef_id: string | null;
  deger: number;
  baslangic: ZamanDamgasi;
  bitis: ZamanDamgasi;
  oncelik: number;
  aktif_mi: boolean;
}

export function etkinKampanyalar(vt: Vt, zaman: ZamanDamgasi = simdi()): KampanyaKaydi[] {
  return vt
    .hazirla(
      `SELECT id, ad, tip, kapsam, hedef_id, deger, baslangic, bitis, oncelik, aktif_mi
       FROM kampanyalar
       WHERE aktif_mi = 1 AND baslangic <= ? AND bitis >= ?
       ORDER BY oncelik DESC`,
    )
    .tumu<HamSatir<KampanyaKaydi, 'aktif_mi'>>(zaman, zaman)
    .map((s) => ({ ...s, aktif_mi: sayiToBool(s.aktif_mi) }));
}

export function kampanyalariListele(vt: Vt): KampanyaKaydi[] {
  return vt
    .hazirla(
      `SELECT id, ad, tip, kapsam, hedef_id, deger, baslangic, bitis, oncelik, aktif_mi
       FROM kampanyalar ORDER BY baslangic DESC`,
    )
    .tumu<HamSatir<KampanyaKaydi, 'aktif_mi'>>()
    .map((s) => ({ ...s, aktif_mi: sayiToBool(s.aktif_mi) }));
}

export function kampanyaKaydet(
  vt: Vt,
  kampanya: Omit<KampanyaKaydi, 'id'> & { id?: string },
  cihazId: string,
  zaman = simdi(),
): string {
  const id = kampanya.id ?? uuid();
  vt.hazirla(
    `INSERT INTO kampanyalar (id, ad, tip, kapsam, hedef_id, deger, baslangic, bitis, oncelik, aktif_mi,
                              created_at, updated_at, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       ad = excluded.ad, tip = excluded.tip, kapsam = excluded.kapsam, hedef_id = excluded.hedef_id,
       deger = excluded.deger, baslangic = excluded.baslangic, bitis = excluded.bitis,
       oncelik = excluded.oncelik, aktif_mi = excluded.aktif_mi, updated_at = excluded.updated_at`,
  ).calistir(
    id,
    kampanya.ad,
    kampanya.tip,
    kampanya.kapsam,
    kampanya.hedef_id,
    kampanya.deger,
    kampanya.baslangic,
    kampanya.bitis,
    kampanya.oncelik,
    boolToSayi(kampanya.aktif_mi),
    zaman,
    zaman,
    cihazId,
  );
  return id;
}

// ---------------------------------------------------------------------------
// Bulut → yerel uygulama (pull) yardımcıları — §7.2
// ---------------------------------------------------------------------------

/** Sunucudan gelen ürün kaydını yerelde LWW ile uygular. */
export function urunSunucudanUygula(vt: Vt, veri: Record<string, unknown>, versiyon: number): 'uygulandi' | 'atlandi' {
  const id = String(veri.id ?? '');
  if (!id) return 'atlandi';
  const mevcut = vt
    .hazirla('SELECT updated_at, sunucu_versiyonu FROM urunler WHERE id = ?')
    .tek<{ updated_at: string; sunucu_versiyonu: number }>(id);
  const gelenZaman = String(veri.updated_at ?? '');

  // Yerel kayıt daha yeniyse sunucu verisi uygulanmaz; çakışma servis katmanında loglanır.
  if (mevcut && mevcut.updated_at > gelenZaman) return 'atlandi';

  const ad = String(veri.ad ?? '');
  vt.hazirla(
    `INSERT INTO urunler (id, ad, arama_metni, kategori_id, marka, birim_tipi, alis_fiyati, satis_fiyati,
                          kdv_orani, kritik_stok, ideal_stok, raf_konumu, aktif_mi, varsayilan_tedarikci_id,
                          skt_takibi, notlar, created_at, updated_at, cihaz_id, sunucu_versiyonu)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       ad = excluded.ad, arama_metni = excluded.arama_metni, kategori_id = excluded.kategori_id,
       marka = excluded.marka, birim_tipi = excluded.birim_tipi, alis_fiyati = excluded.alis_fiyati,
       satis_fiyati = excluded.satis_fiyati, kdv_orani = excluded.kdv_orani, kritik_stok = excluded.kritik_stok,
       ideal_stok = excluded.ideal_stok, raf_konumu = excluded.raf_konumu, aktif_mi = excluded.aktif_mi,
       varsayilan_tedarikci_id = excluded.varsayilan_tedarikci_id, skt_takibi = excluded.skt_takibi,
       notlar = excluded.notlar, updated_at = excluded.updated_at, sunucu_versiyonu = excluded.sunucu_versiyonu`,
  ).calistir(
    id,
    ad,
    aramaMetniOlustur(ad, veri.marka as string | null, veri.raf_konumu as string | null),
    (veri.kategori_id as string | null) ?? null,
    (veri.marka as string | null) ?? null,
    (veri.birim_tipi as string) ?? 'ADET',
    Number(veri.alis_fiyati ?? 0),
    Number(veri.satis_fiyati ?? 0),
    Number(veri.kdv_orani ?? 20),
    Number(veri.kritik_stok ?? 0),
    Number(veri.ideal_stok ?? 0),
    (veri.raf_konumu as string | null) ?? null,
    boolToSayi(veri.aktif_mi !== false && veri.aktif_mi !== 0),
    (veri.varsayilan_tedarikci_id as string | null) ?? null,
    boolToSayi(veri.skt_takibi === true || veri.skt_takibi === 1),
    (veri.notlar as string | null) ?? null,
    String(veri.created_at ?? gelenZaman),
    gelenZaman,
    (veri.cihaz_id as string | null) ?? null,
    versiyon,
  );
  return 'uygulandi';
}

export function kampanyaSunucudanUygula(vt: Vt, veri: Record<string, unknown>, versiyon: number): void {
  const id = String(veri.id ?? '');
  if (!id) return;
  vt.hazirla(
    `INSERT INTO kampanyalar (id, ad, tip, kapsam, hedef_id, deger, baslangic, bitis, oncelik, aktif_mi,
                              created_at, updated_at, cihaz_id, sunucu_versiyonu)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       ad = excluded.ad, tip = excluded.tip, kapsam = excluded.kapsam, hedef_id = excluded.hedef_id,
       deger = excluded.deger, baslangic = excluded.baslangic, bitis = excluded.bitis,
       oncelik = excluded.oncelik, aktif_mi = excluded.aktif_mi, updated_at = excluded.updated_at,
       sunucu_versiyonu = excluded.sunucu_versiyonu`,
  ).calistir(
    id,
    String(veri.ad ?? ''),
    String(veri.tip ?? 'YUZDE'),
    String(veri.kapsam ?? 'URUN'),
    (veri.hedef_id as string | null) ?? null,
    Number(veri.deger ?? 0),
    String(veri.baslangic ?? simdi()),
    String(veri.bitis ?? simdi()),
    Number(veri.oncelik ?? 0),
    boolToSayi(veri.aktif_mi !== false && veri.aktif_mi !== 0),
    String(veri.created_at ?? simdi()),
    String(veri.updated_at ?? simdi()),
    (veri.cihaz_id as string | null) ?? null,
    versiyon,
  );
}

export function barkodSunucudanUygula(vt: Vt, veri: Record<string, unknown>, versiyon: number): void {
  const id = String(veri.id ?? '');
  const barkod = String(veri.barkod ?? '');
  const urunId = String(veri.urun_id ?? '');
  if (!id || !barkod || !urunId) return;
  // Ürün henüz yerelde yoksa barkodu uygulamayı ertele (FK ihlali olmasın).
  const urunVar = vt.hazirla('SELECT 1 AS v FROM urunler WHERE id = ?').tek<{ v: number }>(urunId);
  if (!urunVar) return;
  vt.hazirla(
    `INSERT INTO barkodlar (id, urun_id, barkod, ambalaj_aciklamasi, aktif_mi, created_at, updated_at, cihaz_id, sunucu_versiyonu)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(barkod) DO UPDATE SET
       urun_id = excluded.urun_id, ambalaj_aciklamasi = excluded.ambalaj_aciklamasi,
       aktif_mi = excluded.aktif_mi, updated_at = excluded.updated_at, sunucu_versiyonu = excluded.sunucu_versiyonu`,
  ).calistir(
    id,
    urunId,
    barkod,
    (veri.ambalaj_aciklamasi as string | null) ?? null,
    boolToSayi(veri.aktif_mi !== false && veri.aktif_mi !== 0),
    String(veri.created_at ?? simdi()),
    String(veri.updated_at ?? simdi()),
    (veri.cihaz_id as string | null) ?? null,
    versiyon,
  );
}

export function kategoriSunucudanUygula(vt: Vt, veri: Record<string, unknown>, versiyon: number): void {
  const id = String(veri.id ?? '');
  if (!id) return;
  vt.hazirla(
    `INSERT INTO kategoriler (id, ad, ust_kategori_id, sira, aktif_mi, created_at, updated_at, cihaz_id, sunucu_versiyonu)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       ad = excluded.ad, ust_kategori_id = excluded.ust_kategori_id, sira = excluded.sira,
       aktif_mi = excluded.aktif_mi, updated_at = excluded.updated_at, sunucu_versiyonu = excluded.sunucu_versiyonu`,
  ).calistir(
    id,
    String(veri.ad ?? ''),
    (veri.ust_kategori_id as string | null) ?? null,
    Number(veri.sira ?? 0),
    boolToSayi(veri.aktif_mi !== false && veri.aktif_mi !== 0),
    String(veri.created_at ?? simdi()),
    String(veri.updated_at ?? simdi()),
    (veri.cihaz_id as string | null) ?? null,
    versiyon,
  );
}
