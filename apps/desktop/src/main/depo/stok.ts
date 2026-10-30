/**
 * Stok repository'si.
 *
 * ALTIN KURAL (§7.4): `stok_ozet.miktar` asla elle yazılmaz. Yalnız
 * `stok_hareketleri`'ne kayıt eklenir; özet tabloyu veritabanı tetikleyicisi
 * günceller. `stogYenidenHesapla` her an gerçeği yeniden üretebilir.
 */

import { bugun, gunEkle, simdi, uuid, type GunAnahtari, type Kurus, type Miktar, type ZamanDamgasi } from '@market/shared';
import type { Vt } from '../db/surucu.js';
import { yerTutucular } from './ortak.js';

export type StokHareketTipiDb = 'SATIS' | 'GIRIS' | 'IADE' | 'FIRE' | 'SAYIM' | 'DUZELTME' | 'ACILIS' | 'TEDARIKCI_IADE';

export interface StokHareketiYazma {
  /** Verilirse kimlik dışarıdan sabitlenir (idempotans için — §11.5). */
  id?: string;
  urun_id: string;
  hareket_tipi: StokHareketTipiDb;
  /** İşaretli miktar (bindebir). Çıkışlarda negatif verilmelidir. */
  miktar: Miktar;
  birim_maliyet?: Kurus;
  belge_id?: string | null;
  belge_tipi?: string | null;
  skt?: GunAnahtari | null;
  lot_no?: string | null;
  neden_kodu?: string | null;
  aciklama?: string | null;
  kullanici_id?: string | null;
}

export interface StokHareketiKaydi extends Required<Omit<StokHareketiYazma, 'birim_maliyet'>> {
  id: string;
  birim_maliyet: Kurus;
  created_at: ZamanDamgasi;
  cihaz_id: string | null;
  urun_adi?: string;
}

export function hareketEkle(vt: Vt, hareket: StokHareketiYazma, cihazId: string, zaman: ZamanDamgasi = simdi()): string {
  // Kimlik dışarıdan verilebilir: panelden inen stok talimatında hareketin
  // id'si talimatın id'si yapılır, böylece aynı talimat ikinci kez inse bile
  // birincil anahtar çakışır ve mükerrer hareket oluşmaz (§11.5).
  const id = hareket.id ?? uuid();
  vt.hazirla(
    `INSERT INTO stok_hareketleri
       (id, urun_id, hareket_tipi, miktar, birim_maliyet, belge_id, belge_tipi, skt, lot_no,
        neden_kodu, aciklama, kullanici_id, created_at, updated_at, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).calistir(
    id,
    hareket.urun_id,
    hareket.hareket_tipi,
    hareket.miktar,
    hareket.birim_maliyet ?? 0,
    hareket.belge_id ?? null,
    hareket.belge_tipi ?? null,
    hareket.skt ?? null,
    hareket.lot_no ?? null,
    hareket.neden_kodu ?? null,
    hareket.aciklama ?? null,
    hareket.kullanici_id ?? null,
    zaman,
    zaman,
    cihazId,
  );
  if (maliyetiEtkilerMi(hareket)) ortalamaMaliyetiGuncelle(vt, hareket.urun_id, zaman);
  return id;
}

// ---------------------------------------------------------------------------
// Ağırlıklı ortalama maliyet (TMS 2 ¶27)
// ---------------------------------------------------------------------------

/** Maliyetli giriş: alış, elle giriş ya da açılış — miktarı ve maliyeti pozitif. */
function maliyetliGirisMi(h: { hareket_tipi: string; miktar: number; birim_maliyet?: number | null }): boolean {
  return (h.hareket_tipi === 'GIRIS' || h.hareket_tipi === 'ACILIS') && h.miktar > 0 && (h.birim_maliyet ?? 0) > 0;
}

function maliyetiEtkilerMi(h: StokHareketiYazma): boolean {
  return maliyetliGirisMi(h) || h.belge_tipi === 'ALIS_IPTAL';
}

/**
 * Ürünün ağırlıklı ortalama maliyetini HAREKETLERDEN baştan hesaplar.
 *
 * Her maliyetli girişte: yeni ortalama = (eldeki × eski ort. + gelen × alış) /
 * (eldeki + gelen). Çıkışlar (satış, fire, iade…) ortalamayı değiştirmez,
 * yalnız eldeki miktarı azaltır. Eldeki miktar eksiye düşmüşse sıfır sayılır:
 * kaydı olmayan malın maliyeti ortalamayı çekmemeli.
 *
 * İPTAL EDİLEN ALIŞ FATURASI hiç girmemiş sayılır (iptalin kendi anlamı da
 * budur): hem giriş hem iptal satırları atlanır. "Ters hesapla geri al"
 * yapılmaz — arada satış olduysa ters formül saçma sonuç verir (5 × 100 +
 * 10 × 110, 4 satış, 10'un iptali → 73,33 gibi).
 *
 * Hareket defteri değiştirilemez olduğundan sonuç her zaman yeniden
 * üretilebilir; `urun_maliyet` yalnız önbellektir. Maliyetli giriş yoksa
 * `null` döner (ürün son alış fiyatıyla maliyetlenir).
 */
export function ortalamaMaliyetHesapla(vt: Vt, urunId: string): Kurus | null {
  const hareketler = vt
    .hazirla(
      `SELECT hareket_tipi, miktar, birim_maliyet, belge_id, belge_tipi
       FROM stok_hareketleri WHERE urun_id = ? ORDER BY created_at, rowid`,
    )
    .tumu<{ hareket_tipi: string; miktar: number; birim_maliyet: number; belge_id: string | null; belge_tipi: string | null }>(
      urunId,
    );
  const iptalEdilenler = new Set(hareketler.filter((h) => h.belge_tipi === 'ALIS_IPTAL').map((h) => h.belge_id));

  let eldeki = 0;
  let ortalama: number | null = null;
  for (const h of hareketler) {
    if (h.belge_id && iptalEdilenler.has(h.belge_id) && (h.belge_tipi === 'ALIS' || h.belge_tipi === 'ALIS_IPTAL')) {
      continue;
    }
    if (maliyetliGirisMi(h)) {
      const onceki = Math.max(eldeki, 0);
      ortalama =
        ortalama === null || onceki === 0
          ? h.birim_maliyet
          : (onceki * ortalama + h.miktar * h.birim_maliyet) / (onceki + h.miktar);
    }
    eldeki += h.miktar;
  }
  return ortalama === null ? null : Math.round(ortalama);
}

/** Önbelleği tazeler. `hareketEkle` maliyeti etkileyen her harekette kendisi çağırır. */
export function ortalamaMaliyetiGuncelle(vt: Vt, urunId: string, zaman: ZamanDamgasi = simdi()): Kurus | null {
  const ortalama = ortalamaMaliyetHesapla(vt, urunId);
  if (ortalama === null) {
    vt.hazirla('DELETE FROM urun_maliyet WHERE urun_id = ?').calistir(urunId);
  } else {
    vt.hazirla(
      `INSERT INTO urun_maliyet (urun_id, ortalama_maliyet, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (urun_id) DO UPDATE SET ortalama_maliyet = excluded.ortalama_maliyet, updated_at = excluded.updated_at`,
    ).calistir(urunId, ortalama, zaman);
  }
  return ortalama;
}

/** Tek ürünün maliyeti: ağırlıklı ortalama, yoksa son alış. */
export function birimMaliyet(vt: Vt, urun: { id: string; alis_fiyati: Kurus }): Kurus {
  return maliyetleriOku(vt, [urun.id]).get(urun.id) ?? urun.alis_fiyati;
}

/** Ortalama maliyetler; satırı olmayan ürün haritada YOKTUR (çağıran son alışa düşer). */
export function maliyetleriOku(vt: Vt, urunIdler: readonly string[]): Map<string, Kurus> {
  const tekil = [...new Set(urunIdler)];
  if (tekil.length === 0) return new Map();
  const satirlar = vt
    .hazirla(`SELECT urun_id, ortalama_maliyet FROM urun_maliyet WHERE urun_id IN (${yerTutucular(tekil.length)})`)
    .tumu<{ urun_id: string; ortalama_maliyet: number }>(...tekil);
  return new Map(satirlar.map((x) => [x.urun_id, x.ortalama_maliyet]));
}

export function stokOku(vt: Vt, urunId: string): Miktar {
  const satir = vt.hazirla('SELECT miktar FROM stok_ozet WHERE urun_id = ?').tek<{ miktar: number }>(urunId);
  return satir?.miktar ?? 0;
}

export function stoklariOku(vt: Vt, urunIdler: readonly string[]): Map<string, Miktar> {
  const harita = new Map<string, Miktar>();
  if (urunIdler.length === 0) return harita;
  const satirlar = vt
    .hazirla(`SELECT urun_id, miktar FROM stok_ozet WHERE urun_id IN (${yerTutucular(urunIdler.length)})`)
    .tumu<{ urun_id: string; miktar: number }>(...urunIdler);
  for (const s of satirlar) harita.set(s.urun_id, s.miktar);
  for (const id of urunIdler) if (!harita.has(id)) harita.set(id, 0);
  return harita;
}

export function hareketleriListele(
  vt: Vt,
  filtre: { urunId?: string; belgeId?: string; baslangic?: ZamanDamgasi; bitis?: ZamanDamgasi; tip?: StokHareketTipiDb },
  limit = 200,
): StokHareketiKaydi[] {
  const kosullar: string[] = [];
  const parametreler: unknown[] = [];
  if (filtre.urunId) {
    kosullar.push('h.urun_id = ?');
    parametreler.push(filtre.urunId);
  }
  if (filtre.belgeId) {
    kosullar.push('h.belge_id = ?');
    parametreler.push(filtre.belgeId);
  }
  if (filtre.tip) {
    kosullar.push('h.hareket_tipi = ?');
    parametreler.push(filtre.tip);
  }
  if (filtre.baslangic) {
    kosullar.push('h.created_at >= ?');
    parametreler.push(filtre.baslangic);
  }
  if (filtre.bitis) {
    kosullar.push('h.created_at < ?');
    parametreler.push(filtre.bitis);
  }
  const nerede = kosullar.length ? 'WHERE ' + kosullar.join(' AND ') : '';
  return vt
    .hazirla(
      `SELECT h.id, h.urun_id, h.hareket_tipi, h.miktar, h.birim_maliyet, h.belge_id, h.belge_tipi,
              h.skt, h.lot_no, h.neden_kodu, h.aciklama, h.kullanici_id, h.created_at, h.cihaz_id,
              u.ad AS urun_adi
       FROM stok_hareketleri h
       JOIN urunler u ON u.id = h.urun_id
       ${nerede}
       ORDER BY h.created_at DESC, h.rowid DESC
       LIMIT ?`,
    )
    .tumu<StokHareketiKaydi>(...parametreler, limit);
}

export interface KritikStokSatiri {
  urun_id: string;
  ad: string;
  stok: Miktar;
  kritik_stok: Miktar;
  ideal_stok: Miktar;
  birim_tipi: string;
  /** İdeal stoğa çıkmak için önerilen sipariş miktarı (§10.6). */
  onerilen_siparis: Miktar;
  tedarikci_id: string | null;
}

export function kritikStoktakiler(vt: Vt, limit = 200): KritikStokSatiri[] {
  return vt
    .hazirla(
      `SELECT u.id AS urun_id, u.ad, COALESCE(so.miktar, 0) AS stok, u.kritik_stok, u.ideal_stok,
              u.birim_tipi, u.varsayilan_tedarikci_id AS tedarikci_id,
              MAX(0, u.ideal_stok - COALESCE(so.miktar, 0)) AS onerilen_siparis
       FROM urunler u
       LEFT JOIN stok_ozet so ON so.urun_id = u.id
       WHERE u.aktif_mi = 1 AND u.kritik_stok > 0 AND COALESCE(so.miktar, 0) <= u.kritik_stok
         AND u.id NOT IN (SELECT deger FROM ayarlar WHERE anahtar = 'urun.muhtelif_id')
       ORDER BY (COALESCE(so.miktar, 0) - u.kritik_stok), u.ad
       LIMIT ?`,
    )
    .tumu<KritikStokSatiri>(limit);
}

export function kritikStokSayisi(vt: Vt): number {
  const satir = vt
    .hazirla(
      `SELECT COUNT(*) AS adet FROM urunler u
       LEFT JOIN stok_ozet so ON so.urun_id = u.id
       WHERE u.aktif_mi = 1 AND u.kritik_stok > 0 AND COALESCE(so.miktar, 0) <= u.kritik_stok
         AND u.id NOT IN (SELECT deger FROM ayarlar WHERE anahtar = 'urun.muhtelif_id')`,
    )
    .tek<{ adet: number }>();
  return satir?.adet ?? 0;
}

export function negatifStoktakiler(vt: Vt, limit = 200): { urun_id: string; ad: string; stok: Miktar }[] {
  return vt
    .hazirla(
      `SELECT u.id AS urun_id, u.ad, so.miktar AS stok
       FROM stok_ozet so JOIN urunler u ON u.id = so.urun_id
       WHERE so.miktar < 0 AND u.id NOT IN (SELECT deger FROM ayarlar WHERE anahtar = 'urun.muhtelif_id') ORDER BY so.miktar LIMIT ?`,
    )
    .tumu<{ urun_id: string; ad: string; stok: number }>(limit);
}

export interface SktSatiri {
  urun_id: string;
  ad: string;
  skt: GunAnahtari;
  lot_no: string | null;
  kalan_miktar: Miktar;
  kalan_gun: number;
}

/**
 * SKT takibi (§10.6) — FEFO: önce son kullanma tarihi en yakın olan satılır.
 *
 * Satış hangi partiden çıktığını yazmaz (kasiyer okuturken lot seçemez).
 * Eskiden lotun kalanı yalnız lot satırlarının toplamıydı; satışlar hiç
 * düşmediği için satılıp biten parti "30 adet, yarın bozuluyor" diye
 * listede kalıyordu.
 *
 * Artık eldeki GERÇEK stok, tarihi EN UZAK partiden geriye doğru dağıtılır:
 * rafta kalan, en son bozulacak olanlardır. Örnek: A partisi (yakın tarih)
 * 10, B partisi (uzak) 10 girdi, 12 satıldı → eldeki 8'in hepsi B'den; A
 * listeden düşer. Fire gibi partisi bilinen çıkışlar o partiden zaten
 * düşülür; geri kalan her çıkış FEFO varsayımıyla dağıtılır.
 */
export interface SktUyarisi {
  urun_id: string;
  ad: string;
  /** Elde kalan en yakın tarihli partinin SKT'si. */
  skt: string;
  kalan_gun: number;
  kalan_miktar: Miktar;
}

/**
 * Ürün başına EN YAKIN tarihli kalan parti — satış ekranı ve durum çubuğu
 * uyarısı için. Uyarıdır, satış engellenmez: parti dağılımı bir tahmindir
 * (satışta hangi partinin satıldığı bilinmez, en eskisinden gittiği varsayılır).
 */
export function sktUyarilari(vt: Vt, gunSayisi = 7, bugunAnahtari: GunAnahtari = bugun()): SktUyarisi[] {
  const enYakin = new Map<string, SktUyarisi>();
  for (const s of sktYaklasanlar(vt, gunSayisi, bugunAnahtari)) {
    const mevcut = enYakin.get(s.urun_id);
    if (!mevcut || s.skt < mevcut.skt) {
      enYakin.set(s.urun_id, { urun_id: s.urun_id, ad: s.ad, skt: s.skt, kalan_gun: s.kalan_gun, kalan_miktar: s.kalan_miktar });
    }
  }
  return [...enYakin.values()].sort((a, b) => a.kalan_gun - b.kalan_gun);
}

export function sktYaklasanlar(vt: Vt, gunSayisi = 30, bugunAnahtari: GunAnahtari = bugun()): SktSatiri[] {
  const sinir = gunEkle(bugunAnahtari, gunSayisi);
  // Sınıra giren partisi olan ürünlerin TÜM partileri gerekir: dağıtım uzak tarihten başlar.
  const partiler = vt
    .hazirla(
      `SELECT h.urun_id, u.ad, h.skt, h.lot_no, SUM(h.miktar) AS net, COALESCE(so.miktar, 0) AS stok
       FROM stok_hareketleri h
       JOIN urunler u ON u.id = h.urun_id
       LEFT JOIN stok_ozet so ON so.urun_id = h.urun_id
       WHERE h.skt IS NOT NULL
         AND h.urun_id IN (SELECT urun_id FROM stok_hareketleri WHERE skt IS NOT NULL AND skt <= ?)
       GROUP BY h.urun_id, h.skt, h.lot_no
       HAVING SUM(h.miktar) > 0`,
    )
    .tumu<{ urun_id: string; ad: string; skt: string; lot_no: string | null; net: number; stok: number }>(sinir);

  const urunBazinda = new Map<string, typeof partiler>();
  for (const p of partiler) {
    const liste = urunBazinda.get(p.urun_id) ?? [];
    liste.push(p);
    urunBazinda.set(p.urun_id, liste);
  }

  const sonuc: SktSatiri[] = [];
  for (const liste of urunBazinda.values()) {
    // Uzak tarihten yakına: kalan stok önce en geç bozulacak partiye yazılır.
    liste.sort((x, y) => (x.skt === y.skt ? 0 : x.skt < y.skt ? 1 : -1));
    let dagitilacak = Math.max(liste[0]?.stok ?? 0, 0);
    for (const p of liste) {
      const kalan = Math.min(p.net, dagitilacak);
      dagitilacak -= kalan;
      if (kalan <= 0 || p.skt > sinir) continue;
      sonuc.push({
        urun_id: p.urun_id,
        ad: p.ad,
        skt: p.skt,
        lot_no: p.lot_no,
        kalan_miktar: kalan,
        kalan_gun: Math.round((Date.parse(p.skt + 'T00:00:00Z') - Date.parse(bugunAnahtari + 'T00:00:00Z')) / 86400000),
      });
    }
  }
  return sonuc.sort((x, y) => (x.skt === y.skt ? x.ad.localeCompare(y.ad, 'tr') : x.skt < y.skt ? -1 : 1));
}

/**
 * Stok değeri: maliyet ve satış fiyatı üzerinden toplam envanter değeri.
 * Maliyet ağırlıklı ortalamadır (yoksa son alış) — kâr raporuyla aynı temel.
 */
export function stokDegeri(vt: Vt): { maliyet: Kurus; satis: Kurus; kalem: number; toplamMiktar: Miktar } {
  const satir = vt
    .hazirla(
      // Bölme, toplamdan SONRA ve ondalıklı yapılır: SQLite'ta iki tam sayının
      // bölümü tam sayıdır; satır satır bölmek her kalemde kuruş kaybettirirdi.
      `SELECT
         COALESCE(SUM(so.miktar * COALESCE(m.ortalama_maliyet, u.alis_fiyati)), 0) / 1000.0 AS maliyet,
         COALESCE(SUM(so.miktar * u.satis_fiyati), 0) / 1000.0 AS satis,
         COUNT(*) AS kalem,
         COALESCE(SUM(so.miktar), 0) AS toplam_miktar
       FROM stok_ozet so JOIN urunler u ON u.id = so.urun_id
       LEFT JOIN urun_maliyet m ON m.urun_id = so.urun_id
       WHERE so.miktar > 0 AND u.aktif_mi = 1`,
    )
    .tek<{ maliyet: number; satis: number; kalem: number; toplam_miktar: number }>();
  return {
    maliyet: Math.round(satir?.maliyet ?? 0),
    satis: Math.round(satir?.satis ?? 0),
    kalem: satir?.kalem ?? 0,
    toplamMiktar: satir?.toplam_miktar ?? 0,
  };
}

/**
 * Özet tabloyu hareketlerden yeniden inşa eder.
 * Bakım/mutabakat aracıdır (§18.4); tetikleyici bir sebeple atlanmışsa gerçeği geri getirir.
 */
export function stogYenidenHesapla(vt: Vt, zaman: ZamanDamgasi = simdi()): number {
  return vt.islem(() => {
    vt.ham('DELETE FROM stok_ozet');
    const sonuc = vt
      .hazirla(
        `INSERT INTO stok_ozet (urun_id, miktar, updated_at)
         SELECT urun_id, SUM(miktar), ? FROM stok_hareketleri GROUP BY urun_id`,
      )
      .calistir(zaman);
    return sonuc.changes;
  });
}

/** Özet ile hareket toplamı arasında sapma var mı? (mutabakat raporu) */
export function stokMutabakati(vt: Vt): { urun_id: string; ozet: Miktar; gercek: Miktar }[] {
  return vt
    .hazirla(
      // FULL OUTER JOIN yalnız SQLite 3.39+ ile gelir; taşınabilirlik için
      // iki tarafın ürün kimlikleri UNION ile toplanıp LEFT JOIN yapılır.
      `WITH urun_kumesi AS (
         SELECT urun_id FROM stok_ozet
         UNION
         SELECT urun_id FROM stok_hareketleri
       ),
       gercek AS (
         SELECT urun_id, SUM(miktar) AS toplam FROM stok_hareketleri GROUP BY urun_id
       )
       SELECT k.urun_id,
              COALESCE(o.miktar, 0) AS ozet,
              COALESCE(g.toplam, 0) AS gercek
       FROM urun_kumesi k
       LEFT JOIN stok_ozet o ON o.urun_id = k.urun_id
       LEFT JOIN gercek g    ON g.urun_id = k.urun_id
       WHERE COALESCE(o.miktar, 0) <> COALESCE(g.toplam, 0)`,
    )
    .tumu<{ urun_id: string; ozet: number; gercek: number }>();
}

// ---------------------------------------------------------------------------
// Sayım (envanter)
// ---------------------------------------------------------------------------

export interface SayimKaydi {
  id: string;
  ad: string;
  durum: 'ACIK' | 'TAMAMLANDI' | 'IPTAL';
  baslangic: ZamanDamgasi;
  bitis: ZamanDamgasi | null;
  kullanici_id: string | null;
  notlar: string | null;
}

export function sayimAc(vt: Vt, ad: string, kullaniciId: string | null, cihazId: string, zaman = simdi()): string {
  const id = uuid();
  vt.hazirla(
    `INSERT INTO sayimlar (id, ad, durum, baslangic, kullanici_id, created_at, updated_at, cihaz_id)
     VALUES (?, ?, 'ACIK', ?, ?, ?, ?, ?)`,
  ).calistir(id, ad, zaman, kullaniciId, zaman, zaman, cihazId);
  return id;
}

export function acikSayim(vt: Vt): SayimKaydi | null {
  return (
    vt
      .hazirla(
        `SELECT id, ad, durum, baslangic, bitis, kullanici_id, notlar FROM sayimlar
         WHERE durum = 'ACIK' ORDER BY baslangic DESC LIMIT 1`,
      )
      .tek<SayimKaydi>() ?? null
  );
}

export function sayimSatiriKaydet(
  vt: Vt,
  sayimId: string,
  urunId: string,
  sayilanMiktar: Miktar,
  cihazId: string,
  zaman = simdi(),
): void {
  const sistem = stokOku(vt, urunId);
  vt.hazirla(
    `INSERT INTO sayim_satirlari (id, sayim_id, urun_id, sistem_miktari, sayilan_miktar, fark, created_at, updated_at, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(sayim_id, urun_id) DO UPDATE SET
       sistem_miktari = excluded.sistem_miktari,
       sayilan_miktar = excluded.sayilan_miktar,
       fark = excluded.fark,
       updated_at = excluded.updated_at`,
  ).calistir(uuid(), sayimId, urunId, sistem, sayilanMiktar, sayilanMiktar - sistem, zaman, zaman, cihazId);
}

export interface SayimFarkSatiri {
  urun_id: string;
  ad: string;
  birim_tipi: string;
  sistem_miktari: Miktar;
  sayilan_miktar: Miktar;
  fark: Miktar;
  alis_fiyati: Kurus;
}

export function sayimFarklari(vt: Vt, sayimId: string): SayimFarkSatiri[] {
  return vt
    .hazirla(
      `SELECT s.urun_id, u.ad, u.birim_tipi, s.sistem_miktari, s.sayilan_miktar, s.fark,
              COALESCE(m.ortalama_maliyet, u.alis_fiyati) AS alis_fiyati
       FROM sayim_satirlari s JOIN urunler u ON u.id = s.urun_id
       LEFT JOIN urun_maliyet m ON m.urun_id = s.urun_id
       WHERE s.sayim_id = ? ORDER BY ABS(s.fark) DESC, u.ad`,
    )
    .tumu<SayimFarkSatiri>(sayimId);
}

export function sayimDurumuGuncelle(vt: Vt, sayimId: string, durum: 'TAMAMLANDI' | 'IPTAL', zaman = simdi()): void {
  vt.hazirla('UPDATE sayimlar SET durum = ?, bitis = ?, updated_at = ? WHERE id = ?').calistir(durum, zaman, zaman, sayimId);
}
