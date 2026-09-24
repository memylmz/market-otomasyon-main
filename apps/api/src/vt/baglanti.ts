/**
 * Merkezi veritabanı — libSQL istemcisi.
 *
 * Aynı istemci hem **Turso** (libsql://) hem de **yerel dosya** (file:) ile çalışır;
 * bu, blueprint'teki "önce Turso Free, sonra istenirse kendi sunucuma taşı" (§6.4)
 * kararını kod değişikliği olmadan mümkün kılar.
 *
 * Maliyet kuralları (§6.5): toplu yazma tek transaction'da, pull yalnız delta,
 * panel okumaları rollup tablolarından.
 */

import { createClient, type Client, type InValue } from '@libsql/client';
import { SEMA_SURUMU } from '@market/shared';

/**
 * Parametreler `unknown[]` olarak kabul edilir; tip dönüşümü tek noktada
 * `normalize()` içinde yapılır (boolean → 0/1, Date → ISO, undefined → null).
 * Çağrı yerlerinde `as InValue` sarmalayıcıları gerekmez.
 */
export interface Islem {
  calistir(sql: string, parametreler?: readonly unknown[]): Promise<{ rowsAffected: number }>;
  tumu<T = Record<string, unknown>>(sql: string, parametreler?: readonly unknown[]): Promise<T[]>;
  tek<T = Record<string, unknown>>(sql: string, parametreler?: readonly unknown[]): Promise<T | null>;
}

export interface MerkezVt extends Islem {
  ic: Client;
  /** Birden çok ifadeyi tek transaction'da çalıştırır (§6.5 toplu yazma). */
  islem<T>(govde: (islem: Islem) => Promise<T>): Promise<T>;
  kapat(): void;
}

function normalize(parametreler: readonly unknown[] = []): InValue[] {
  return parametreler.map((d) => {
    if (d === undefined || d === null) return null;
    if (typeof d === 'boolean') return d ? 1 : 0;
    if (d instanceof Date) return d.toISOString();
    return d as InValue;
  });
}

export function vtOlustur(url: string, authToken?: string): MerkezVt {
  const ic = createClient({ url, ...(authToken ? { authToken } : {}) });

  const sar = (kaynak: { execute: Client['execute'] }): Islem => ({
    async calistir(sql, parametreler) {
      const sonuc = await kaynak.execute({ sql, args: normalize(parametreler) });
      return { rowsAffected: sonuc.rowsAffected };
    },
    async tumu<T>(sql: string, parametreler?: readonly unknown[]) {
      const sonuc = await kaynak.execute({ sql, args: normalize(parametreler) });
      return sonuc.rows as unknown as T[];
    },
    async tek<T>(sql: string, parametreler?: readonly unknown[]) {
      const sonuc = await kaynak.execute({ sql, args: normalize(parametreler) });
      return (sonuc.rows[0] as unknown as T) ?? null;
    },
  });

  const temel = sar(ic);

  return {
    ic,
    calistir: temel.calistir,
    tumu: temel.tumu,
    tek: temel.tek,
    async islem(govde) {
      const islem = await ic.transaction('write');
      try {
        const sonuc = await govde(sar(islem as unknown as { execute: Client['execute'] }));
        await islem.commit();
        return sonuc;
      } catch (hata) {
        await islem.rollback().catch(() => undefined);
        throw hata;
      }
    },
    kapat() {
      ic.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Şema
// ---------------------------------------------------------------------------

/**
 * Merkezi şema. Yerel şemayla büyük ölçüde aynıdır; fark senkron alanlarındadır:
 * her yönetimsel kayıt monoton artan bir `versiyon` taşır — pull bu alandan
 * yalnız değişeni çeker (§6.5 kural 2).
 */
const SEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS isletmeler (
  id TEXT PRIMARY KEY, ad TEXT NOT NULL, lisans_anahtari TEXT NOT NULL UNIQUE,
  lisans_bitis TEXT, aktif_mi INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cihazlar (
  id TEXT PRIMARY KEY, isletme_id TEXT NOT NULL REFERENCES isletmeler(id),
  cihaz_id TEXT NOT NULL, cihaz_adi TEXT NOT NULL, token_hash TEXT NOT NULL,
  platform TEXT, uygulama_surumu TEXT, sema_surumu INTEGER NOT NULL DEFAULT ${SEMA_SURUMU},
  son_push TEXT, son_pull TEXT, aktif_mi INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cihaz ON cihazlar(isletme_id, cihaz_id);
CREATE INDEX IF NOT EXISTS ix_cihaz_token ON cihazlar(token_hash);

CREATE TABLE IF NOT EXISTS panel_kullanicilari (
  id TEXT PRIMARY KEY, isletme_id TEXT NOT NULL REFERENCES isletmeler(id),
  ad TEXT NOT NULL, kullanici_adi TEXT NOT NULL UNIQUE, sifre_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'ADMIN', aktif_mi INTEGER NOT NULL DEFAULT 1,
  son_giris TEXT, hatali_giris INTEGER NOT NULL DEFAULT 0, kilit_bitis TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokenlar (
  id TEXT PRIMARY KEY, kullanici_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  bitis TEXT NOT NULL, iptal_mi INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_refresh_kullanici ON refresh_tokenlar(kullanici_id);

-- İdempotency defteri: aynı olay uuid'si ikinci kez gelirse işlenmez (§7.1).
CREATE TABLE IF NOT EXISTS islenen_olaylar (
  uuid TEXT PRIMARY KEY, isletme_id TEXT NOT NULL, cihaz_id TEXT NOT NULL,
  olay_tipi TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
  olusturma_zamani TEXT NOT NULL, islenme_zamani TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_olay_isletme ON islenen_olaylar(isletme_id, islenme_zamani);

-- Sunucu sürüm sayacı: pull'un "since" karşılaştırdığı monoton sayı.
CREATE TABLE IF NOT EXISTS versiyon_sayaci (
  isletme_id TEXT PRIMARY KEY, sonraki INTEGER NOT NULL DEFAULT 1
);

-- Yönetimsel (çift yönlü) veri — panelden düzenlenir, kasaya iner.
CREATE TABLE IF NOT EXISTS urunler (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, ad TEXT NOT NULL, kategori_id TEXT,
  marka TEXT, birim_tipi TEXT NOT NULL DEFAULT 'ADET', alis_fiyati INTEGER NOT NULL DEFAULT 0,
  satis_fiyati INTEGER NOT NULL DEFAULT 0, kdv_orani REAL NOT NULL DEFAULT 20,
  kritik_stok INTEGER NOT NULL DEFAULT 0, ideal_stok INTEGER NOT NULL DEFAULT 0,
  raf_konumu TEXT, aktif_mi INTEGER NOT NULL DEFAULT 1, varsayilan_tedarikci_id TEXT,
  skt_takibi INTEGER NOT NULL DEFAULT 0, notlar TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cihaz_id TEXT,
  versiyon INTEGER NOT NULL, silindi_mi INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (isletme_id, id)
);
CREATE INDEX IF NOT EXISTS ix_urun_versiyon ON urunler(isletme_id, versiyon);

-- Panelden girilen stok talimatları (§11.5).
-- Buradaki kayıt bir stok HAREKETİ değil, kasanın kendi hareketini üretmesi
-- için bir talimattır: "hareketlerin tek üreticisi kasadır" kuralı korunur.
-- Fark alanı işaretli ve görelidir (mutlak hedef DEĞİL): panelde görülen değerle
-- kasadaki değer senkron gecikmesi yüzünden ayrışabilir, göreli fark aradaki
-- satışları yutmaz.
-- hedef_cihaz_id zorunludur: bulutta stok özeti cihaz boyutu taşımadığı için
-- talimatı iki kasa uygularsa çift sayılırdı.
CREATE TABLE IF NOT EXISTS stok_duzeltmeleri (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, urun_id TEXT NOT NULL,
  tip TEXT NOT NULL DEFAULT 'DUZELTME', fark INTEGER NOT NULL, hedef_miktar INTEGER, neden TEXT NOT NULL,
  hedef_cihaz_id TEXT NOT NULL, kullanici_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cihaz_id TEXT,
  versiyon INTEGER NOT NULL, silindi_mi INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (isletme_id, id)
);
CREATE INDEX IF NOT EXISTS ix_stok_duzeltme_versiyon ON stok_duzeltmeleri(isletme_id, versiyon);

-- Magaza geneli ayarlar (§8.3). Anahtar birincil anahtarin parcasidir: ayni
-- ayar iki kez yazilamaz, guncelleme her zaman yerinde olur.
CREATE TABLE IF NOT EXISTS ayarlar (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, anahtar TEXT NOT NULL,
  deger TEXT NOT NULL, aciklama TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cihaz_id TEXT,
  versiyon INTEGER NOT NULL, silindi_mi INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (isletme_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ayar_anahtar ON ayarlar(isletme_id, anahtar);
CREATE INDEX IF NOT EXISTS ix_ayar_versiyon ON ayarlar(isletme_id, versiyon);

-- Alis faturasi BELGESI (§11.8). Stok ve tedarikci borcu ayri olaylardan
-- zaten dogru isliyordu; eksik olan belgenin kendisiydi: panelden "bu
-- tedarikciye hangi faturayla ne aldik" sorusu cevaplanamiyordu.
CREATE TABLE IF NOT EXISTS alis_faturalari (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, tedarikci_id TEXT NOT NULL,
  fatura_no TEXT, tarih TEXT NOT NULL,
  genel_toplam INTEGER NOT NULL, odenen_tutar INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cihaz_id TEXT,
  PRIMARY KEY (isletme_id, id)
);
CREATE INDEX IF NOT EXISTS ix_alis_tedarikci ON alis_faturalari(isletme_id, tedarikci_id, tarih);

CREATE TABLE IF NOT EXISTS alis_kalemleri (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, fatura_id TEXT NOT NULL,
  urun_id TEXT NOT NULL, miktar INTEGER NOT NULL, birim_fiyat INTEGER NOT NULL,
  PRIMARY KEY (isletme_id, id)
);
CREATE INDEX IF NOT EXISTS ix_alis_kalem_fatura ON alis_kalemleri(isletme_id, fatura_id);

-- Panelden verilen KISMI IADE talimati (§10.4).
--
-- Panel iadeyi kendisi ISLEMEZ: stok ve cari hareketlerinin tek ureticisi
-- kasadir. Bulut yalniz "su satistan su kalemleri su miktarda iade et" diye
-- yazar; kasa pull'da okur, kendi iade servisini calistirir ve hareketleri
-- uretir. Stok duzeltmelerinde kurulan desenin aynisidir.
CREATE TABLE IF NOT EXISTS iade_talimatlari (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, satis_id TEXT NOT NULL,
  kalemler TEXT NOT NULL, iade_yontemi TEXT NOT NULL, neden TEXT NOT NULL,
  hedef_cihaz_id TEXT NOT NULL, kullanici_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cihaz_id TEXT,
  versiyon INTEGER NOT NULL, silindi_mi INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (isletme_id, id)
);
CREATE INDEX IF NOT EXISTS ix_iade_talimat_versiyon ON iade_talimatlari(isletme_id, versiyon);

-- Panelden verilen CARI talimati (§10.7): acilis bakiyesi, bakiye duzeltmesi,
-- tahsilat iptali.
--
-- Ucu de cari_hareketler'e yeni satir yazar; o defterin tek yazicisi kasadir.
-- Bulut hareketi kendi uretirse kasa ondan habersiz kalir ve ayni borc iki
-- yerde farkli gorunur. Iade talimatlarindaki desenin aynisi.
--
-- DUZELTME satirinda tutar FARK degil, olmasi istenen HEDEF BAKIYEDIR: farki kasa
-- kendi guncel bakiyesine gore hesaplar. Panelin gordugu bakiye senkron
-- beklerken bayatlayabilir; fark burada hesaplanirsa yanlis tabana oturur.
CREATE TABLE IF NOT EXISTS cari_talimatlari (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, cari_id TEXT NOT NULL,
  tip TEXT NOT NULL, tutar INTEGER NOT NULL DEFAULT 0, hedef_hareket_id TEXT,
  neden TEXT NOT NULL, hedef_cihaz_id TEXT NOT NULL, kullanici_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cihaz_id TEXT,
  versiyon INTEGER NOT NULL, silindi_mi INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (isletme_id, id)
);
CREATE INDEX IF NOT EXISTS ix_cari_talimat_versiyon ON cari_talimatlari(isletme_id, versiyon);

-- Panelden verilen ALIS FATURASI talimati (§11.8): olustur, iptal, guncelle.
--
-- Fatura kaydedildiginde stok ARTAR ve tedarikciye cari BORC dogar; iki
-- defterin de tek yazicisi kasadir. Panel yalniz niyeti yazar, belgeyi ve
-- hareketleri kasa kendi mal kabul servisiyle uretir -- yani panelden girilen
-- fatura, kasadan girilenle birebir ayni yoldan gecer.
CREATE TABLE IF NOT EXISTS alis_talimatlari (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, tip TEXT NOT NULL,
  fatura_id TEXT, veri TEXT NOT NULL, hedef_cihaz_id TEXT NOT NULL, kullanici_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cihaz_id TEXT,
  versiyon INTEGER NOT NULL, silindi_mi INTEGER NOT NULL DEFAULT 0,
  -- Kasadaki sonuc: uygulandi mi, hangi belgeyi uretti, olmadiysa neden.
  uygulandi_mi INTEGER NOT NULL DEFAULT 0, sonuc_fatura_id TEXT, hata TEXT, sonuc_zamani TEXT,
  PRIMARY KEY (isletme_id, id)
);
CREATE INDEX IF NOT EXISTS ix_alis_talimat_versiyon ON alis_talimatlari(isletme_id, versiyon);
CREATE INDEX IF NOT EXISTS ix_cari_talimat_cari ON cari_talimatlari(isletme_id, cari_id, silindi_mi);

CREATE TABLE IF NOT EXISTS barkodlar (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, urun_id TEXT NOT NULL, barkod TEXT NOT NULL,
  ambalaj_aciklamasi TEXT, aktif_mi INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cihaz_id TEXT,
  versiyon INTEGER NOT NULL, silindi_mi INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (isletme_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_barkod ON barkodlar(isletme_id, barkod);
CREATE INDEX IF NOT EXISTS ix_barkod_versiyon ON barkodlar(isletme_id, versiyon);

CREATE TABLE IF NOT EXISTS kategoriler (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, ad TEXT NOT NULL, ust_kategori_id TEXT,
  sira INTEGER NOT NULL DEFAULT 0, aktif_mi INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cihaz_id TEXT,
  versiyon INTEGER NOT NULL, silindi_mi INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (isletme_id, id)
);
CREATE INDEX IF NOT EXISTS ix_kategori_versiyon ON kategoriler(isletme_id, versiyon);

CREATE TABLE IF NOT EXISTS kampanyalar (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, ad TEXT NOT NULL, tip TEXT NOT NULL,
  kapsam TEXT NOT NULL, hedef_id TEXT, deger REAL NOT NULL, baslangic TEXT NOT NULL,
  bitis TEXT NOT NULL, oncelik INTEGER NOT NULL DEFAULT 0, aktif_mi INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cihaz_id TEXT,
  versiyon INTEGER NOT NULL, silindi_mi INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (isletme_id, id)
);
CREATE INDEX IF NOT EXISTS ix_kampanya_versiyon ON kampanyalar(isletme_id, versiyon);

CREATE TABLE IF NOT EXISTS kullanicilar (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, ad TEXT NOT NULL, kullanici_adi TEXT NOT NULL,
  pin_hash TEXT, sifre_hash TEXT, rol TEXT NOT NULL DEFAULT 'KASIYER',
  ek_yetkiler TEXT NOT NULL DEFAULT '[]', kaldirilan_yetkiler TEXT NOT NULL DEFAULT '[]',
  aktif_mi INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cihaz_id TEXT,
  versiyon INTEGER NOT NULL, silindi_mi INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (isletme_id, id)
);
CREATE INDEX IF NOT EXISTS ix_kullanici_versiyon ON kullanicilar(isletme_id, versiyon);

CREATE TABLE IF NOT EXISTS cariler (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, tip TEXT NOT NULL, ad_unvan TEXT NOT NULL,
  telefon TEXT, eposta TEXT, adres TEXT, vergi_dairesi TEXT, vergi_no TEXT,
  kredi_limiti INTEGER NOT NULL DEFAULT 0, vade_gun INTEGER NOT NULL DEFAULT 0, notlar TEXT,
  aktif_mi INTEGER NOT NULL DEFAULT 1, anonimlestirildi_mi INTEGER NOT NULL DEFAULT 0,
  iletisim_rizasi INTEGER NOT NULL DEFAULT 0, iletisim_rizasi_zamani TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cihaz_id TEXT,
  versiyon INTEGER NOT NULL, silindi_mi INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (isletme_id, id)
);
CREATE INDEX IF NOT EXISTS ix_cari_versiyon ON cariler(isletme_id, versiyon);

-- Yerelden gelen hareket verisi (append-only, yalnız kasa üretir).
CREATE TABLE IF NOT EXISTS satislar (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, cihaz_id TEXT NOT NULL, fis_no TEXT NOT NULL,
  tarih TEXT NOT NULL, kullanici_id TEXT, kasa_oturum_id TEXT,
  ara_toplam INTEGER NOT NULL, iskonto_toplam INTEGER NOT NULL DEFAULT 0,
  kdv_toplam INTEGER NOT NULL DEFAULT 0, genel_toplam INTEGER NOT NULL,
  odeme_ozeti TEXT NOT NULL, musteri_id TEXT, brut_kar INTEGER NOT NULL DEFAULT 0,
  iptal_mi INTEGER NOT NULL DEFAULT 0, iptal_neden TEXT, iade_mi INTEGER NOT NULL DEFAULT 0,
  kaynak_satis_id TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY (isletme_id, id)
);
CREATE INDEX IF NOT EXISTS ix_satis_tarih ON satislar(isletme_id, tarih);

CREATE TABLE IF NOT EXISTS satis_kalemleri (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, satis_id TEXT NOT NULL, urun_id TEXT NOT NULL,
  urun_adi TEXT NOT NULL, barkod TEXT, miktar INTEGER NOT NULL, birim_fiyat INTEGER NOT NULL,
  birim_maliyet INTEGER NOT NULL DEFAULT 0, iskonto INTEGER NOT NULL DEFAULT 0,
  kdv_orani REAL NOT NULL, kdv_tutar INTEGER NOT NULL DEFAULT 0, satir_toplam INTEGER NOT NULL,
  PRIMARY KEY (isletme_id, id)
);
CREATE INDEX IF NOT EXISTS ix_kalem_satis ON satis_kalemleri(isletme_id, satis_id);
CREATE INDEX IF NOT EXISTS ix_kalem_urun ON satis_kalemleri(isletme_id, urun_id);

CREATE TABLE IF NOT EXISTS odemeler (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, satis_id TEXT NOT NULL,
  odeme_tipi TEXT NOT NULL, tutar INTEGER NOT NULL,
  PRIMARY KEY (isletme_id, id)
);

CREATE TABLE IF NOT EXISTS stok_hareketleri (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, urun_id TEXT NOT NULL, hareket_tipi TEXT NOT NULL,
  miktar INTEGER NOT NULL, birim_maliyet INTEGER NOT NULL DEFAULT 0, belge_id TEXT,
  kullanici_id TEXT, cihaz_id TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY (isletme_id, id)
);
CREATE INDEX IF NOT EXISTS ix_stok_urun ON stok_hareketleri(isletme_id, urun_id);

CREATE TABLE IF NOT EXISTS cari_hareketler (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, cari_id TEXT NOT NULL, hareket_tipi TEXT NOT NULL,
  tutar INTEGER NOT NULL, aciklama TEXT, belge_id TEXT, tarih TEXT NOT NULL,
  vade_tarihi TEXT, kullanici_id TEXT, cihaz_id TEXT,
  PRIMARY KEY (isletme_id, id)
);
CREATE INDEX IF NOT EXISTS ix_carihar_cari ON cari_hareketler(isletme_id, cari_id, tarih);

CREATE TABLE IF NOT EXISTS kasa_oturumlari (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, cihaz_id TEXT NOT NULL, kullanici_id TEXT,
  acilis_zamani TEXT NOT NULL, acilis_bakiye INTEGER NOT NULL DEFAULT 0, kapanis_zamani TEXT,
  sayilan_nakit INTEGER, beklenen_nakit INTEGER, kasa_farki INTEGER,
  satis_nakit INTEGER DEFAULT 0, satis_kart INTEGER DEFAULT 0, veresiye INTEGER DEFAULT 0,
  gider INTEGER DEFAULT 0, islem_sayisi INTEGER DEFAULT 0, durum TEXT NOT NULL DEFAULT 'ACIK',
  PRIMARY KEY (isletme_id, id)
);

CREATE TABLE IF NOT EXISTS kasa_hareketleri (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, kasa_oturum_id TEXT NOT NULL, tip TEXT NOT NULL,
  tutar INTEGER NOT NULL, aciklama TEXT, belge_id TEXT, cihaz_id TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY (isletme_id, id)
);

CREATE TABLE IF NOT EXISTS denetim_log (
  id TEXT NOT NULL, isletme_id TEXT NOT NULL, kullanici_id TEXT, islem TEXT NOT NULL,
  entity TEXT NOT NULL, entity_id TEXT, eski_deger TEXT, yeni_deger TEXT,
  zaman TEXT NOT NULL, cihaz_id TEXT, ip TEXT,
  PRIMARY KEY (isletme_id, id)
);
CREATE INDEX IF NOT EXISTS ix_denetim_zaman ON denetim_log(isletme_id, zaman);

-- Rollup tabloları: panelin okuduğu tek yer (§6.5 kural 3, §8.2).
CREATE TABLE IF NOT EXISTS gunluk_ozet (
  isletme_id TEXT NOT NULL, tarih TEXT NOT NULL, cihaz_id TEXT NOT NULL DEFAULT '',
  ciro INTEGER NOT NULL DEFAULT 0, iade_toplam INTEGER NOT NULL DEFAULT 0,
  iptal_toplam INTEGER NOT NULL DEFAULT 0, islem_sayisi INTEGER NOT NULL DEFAULT 0,
  nakit INTEGER NOT NULL DEFAULT 0, kart INTEGER NOT NULL DEFAULT 0,
  veresiye INTEGER NOT NULL DEFAULT 0, tahsilat INTEGER NOT NULL DEFAULT 0,
  gider INTEGER NOT NULL DEFAULT 0, brut_kar INTEGER NOT NULL DEFAULT 0,
  kdv_toplam INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
  PRIMARY KEY (isletme_id, tarih, cihaz_id)
);

CREATE TABLE IF NOT EXISTS urun_satis_ozet (
  isletme_id TEXT NOT NULL, urun_id TEXT NOT NULL, donem TEXT NOT NULL,
  cihaz_id TEXT NOT NULL DEFAULT '', adet INTEGER NOT NULL DEFAULT 0,
  ciro INTEGER NOT NULL DEFAULT 0, kar INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
  PRIMARY KEY (isletme_id, urun_id, donem, cihaz_id)
);
CREATE INDEX IF NOT EXISTS ix_urunozet_donem ON urun_satis_ozet(isletme_id, donem);

CREATE TABLE IF NOT EXISTS stok_ozet (
  isletme_id TEXT NOT NULL, urun_id TEXT NOT NULL, miktar INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL, PRIMARY KEY (isletme_id, urun_id)
);

CREATE TABLE IF NOT EXISTS cari_ozet (
  isletme_id TEXT NOT NULL, cari_id TEXT NOT NULL, bakiye INTEGER NOT NULL DEFAULT 0,
  son_hareket TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (isletme_id, cari_id)
);

CREATE TABLE IF NOT EXISTS sync_cakismalar (
  id TEXT PRIMARY KEY, isletme_id TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
  kaynak_a TEXT, kaynak_b TEXT, cozum TEXT NOT NULL, cozum_zamani TEXT NOT NULL, detay TEXT
);
CREATE INDEX IF NOT EXISTS ix_cakisma ON sync_cakismalar(isletme_id, cozum_zamani);
`;

/**
 * Şema ifadelerini ayırır.
 *
 * Yorum satırları önce **temizlenir**, sonra `;` ile bölünür. Aksi hâlde bir
 * yorumun ardından gelen `CREATE TABLE` ifadesi "yorumla başlıyor" sanılıp
 * atlanır ve tablo hiç oluşturulmaz.
 */
export function sqlIfadeleriniAyir(sql: string): string[] {
  const yorumsuz = sql
    .split('\n')
    .filter((satir) => !satir.trimStart().startsWith('--'))
    .join('\n');
  return yorumsuz
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Var olan tabloya sütun ekler; zaten varsa sessizce geçer.
 *
 * Şema `CREATE TABLE IF NOT EXISTS` ile kuruluyor, yani yeni bir sütun MEVCUT
 * veritabanlarına asla inmez. Ayrı bir göç altyapısı kurmak yerine, eklenen
 * sütunları burada tek tek ve idempotent biçimde uyguluyoruz — kurulum her
 * açılışta çalıştığı için sürüm defteri tutmaya gerek kalmıyor.
 */
async function sutunEkle(vt: MerkezVt, tablo: string, tanim: string): Promise<void> {
  try {
    await vt.calistir(`ALTER TABLE ${tablo} ADD COLUMN ${tanim}`);
  } catch (hata) {
    const mesaj = hata instanceof Error ? hata.message.toLowerCase() : '';
    // "duplicate column name" = sütun zaten var; başka hata gerçekten hatadır.
    if (!mesaj.includes('duplicate column')) throw hata;
  }
}

export async function semayiHazirla(vt: MerkezVt): Promise<void> {
  // libSQL tek çağrıda çok ifade kabul etmediğinden ifadeler ayrı ayrı çalıştırılır.
  for (const ifade of sqlIfadeleriniAyir(SEMA)) {
    await vt.calistir(ifade);
  }

  // Şema kurulduktan SONRA eklenen sütunlar (§8).
  await sutunEkle(vt, 'stok_duzeltmeleri', 'hedef_miktar INTEGER');
  // Kasa kullanicilari da panele girebildigi icin kaba kuvvet korumasi bu
  // tabloda da gerekir; sayaclar buluta ozeldir, kasaya senkronlanmaz.
  await sutunEkle(vt, 'kullanicilar', 'hatali_giris INTEGER NOT NULL DEFAULT 0');
  await sutunEkle(vt, 'kullanicilar', 'kilit_bitis TEXT');
  // Fis serisi cihaz kimliginden TURETILMEZ, merkezden DAGITILIR (§10.2).
  await sutunEkle(vt, 'cihazlar', 'seri TEXT');
  // Miktar bazlı kampanyaların eşiği, bindebir (§10.8).
  await sutunEkle(vt, 'kampanyalar', 'esik_miktar INTEGER');
  /*
   * SKT ve lot bilgisi yalnız kasada duruyordu; panel son kullanma takibi
   * yapamıyordu (§11.5). Alanlar merkeze de taşınır.
   */
  /*
   * Talimatın kasadaki SONUCU. Bulut talimatı yazıyor ama ne olduğunu hiç
   * öğrenmiyordu: satır sonsuza kadar "bekliyor" kalıyor, panel de o faturayı
   * kalıcı olarak kilitliyordu (düzenle/iptal düğmeleri bir daha açılmıyordu).
   * Kasa artık `TALIMAT_SONUCLANDI` olayıyla bu sütunları dolduruyor.
   */
  await sutunEkle(vt, 'alis_talimatlari', 'uygulandi_mi INTEGER NOT NULL DEFAULT 0');
  await sutunEkle(vt, 'alis_talimatlari', 'sonuc_fatura_id TEXT');
  await sutunEkle(vt, 'alis_talimatlari', 'hata TEXT');
  await sutunEkle(vt, 'alis_talimatlari', 'sonuc_zamani TEXT');

  await sutunEkle(vt, 'stok_hareketleri', 'skt TEXT');
  await sutunEkle(vt, 'stok_hareketleri', 'lot_no TEXT');
  await sutunEkle(vt, 'stok_hareketleri', 'belge_tipi TEXT');
  await sutunEkle(vt, 'stok_hareketleri', 'neden_kodu TEXT');
  await sutunEkle(vt, 'stok_hareketleri', 'aciklama TEXT');

  /*
   * `belge_tipi` cari defterinde de gerekiyor: bir tahsilatın ZATEN İPTAL
   * EDİLMİŞ olduğu, ona bağlı `TAHSILAT_IPTAL` ters kaydından anlaşılır.
   * Sütun bulutta yokken panel bunu göremiyor, iptal edilmiş bir tahsilatı
   * ikinci kez iptal etmeyi teklif ediyordu.
   */
  await sutunEkle(vt, 'cari_hareketler', 'belge_tipi TEXT');

  /*
   * ALIŞ FATURASI — belgenin tamamı merkeze taşınır (§11.8).
   *
   * Eskiden yalnız tedarikçi, tarih ve genel toplam geliyordu. Panelden
   * bakan kişi faturanın KDV'sini, durumunu ve kimin girdiğini göremiyordu;
   * fatura iptal edilse bile merkezde geçerli görünüyordu.
   */
  await sutunEkle(vt, 'alis_faturalari', 'ara_toplam INTEGER NOT NULL DEFAULT 0');
  await sutunEkle(vt, 'alis_faturalari', 'kdv_toplam INTEGER NOT NULL DEFAULT 0');
  await sutunEkle(vt, 'alis_faturalari', "durum TEXT NOT NULL DEFAULT 'ONAYLANDI'");
  await sutunEkle(vt, 'alis_faturalari', 'vade_tarihi TEXT');
  await sutunEkle(vt, 'alis_faturalari', 'notlar TEXT');
  await sutunEkle(vt, 'alis_faturalari', 'kullanici_id TEXT');
  await sutunEkle(vt, 'alis_faturalari', 'iptal_neden TEXT');
  await sutunEkle(vt, 'alis_faturalari', 'iptal_zamani TEXT');
  await sutunEkle(vt, 'alis_kalemleri', 'kdv_orani REAL NOT NULL DEFAULT 0');
  await sutunEkle(vt, 'alis_kalemleri', 'satir_toplam INTEGER NOT NULL DEFAULT 0');
  await sutunEkle(vt, 'alis_kalemleri', 'skt TEXT');
  await sutunEkle(vt, 'alis_kalemleri', 'lot_no TEXT');

  await panelYoneticileriniAynala(vt);
}

/**
 * Panel yoneticilerini kasa kullanicilarina aynalar (§12.1).
 *
 * NEDEN: yonetici hem panele hem kasaya girebilmelidir. Kasa CEVRIMDISI
 * calisir; girisi dogrulamak icin buluta soramaz, kaydin `kullanicilar`
 * tablosunda BULUNMASI gerekir. Bu yuzden panel yoneticisi oraya kopyalanir ve
 * surum numarasi alarak kasalara iner.
 *
 * Yalniz ADMIN aynalanir ve yalniz kullanici adi bos ise: ayni adi tasiyan bir
 * kasa kullanicisi varsa ona DOKUNULMAZ, aksi halde birinin sifresi otekini
 * ezerdi. Idempotenttir; her acilista guvenle calisir.
 */
async function panelYoneticileriniAynala(vt: MerkezVt): Promise<void> {
  const adaylar = await vt.tumu<{
    id: string;
    isletme_id: string;
    ad: string;
    kullanici_adi: string;
    sifre_hash: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT p.id, p.isletme_id, p.ad, p.kullanici_adi, p.sifre_hash, p.created_at, p.updated_at
       FROM panel_kullanicilari p
      WHERE p.rol = 'ADMIN' AND p.aktif_mi = 1
        AND NOT EXISTS (
          SELECT 1 FROM kullanicilar k
           WHERE k.isletme_id = p.isletme_id AND k.kullanici_adi = p.kullanici_adi AND k.silindi_mi = 0
        )`,
  );

  for (const aday of adaylar) {
    const versiyon = await sonrakiVersiyon(vt, String(aday.isletme_id));
    await vt.calistir(
      `INSERT INTO kullanicilar (id, isletme_id, ad, kullanici_adi, sifre_hash, pin_hash, rol,
                                 ek_yetkiler, kaldirilan_yetkiler, aktif_mi,
                                 created_at, updated_at, cihaz_id, versiyon, silindi_mi)
       VALUES (?, ?, ?, ?, ?, NULL, 'ADMIN', '[]', '[]', 1, ?, ?, NULL, ?, 0)
       ON CONFLICT(isletme_id, id) DO NOTHING`,
      [aday.id, aday.isletme_id, aday.ad, aday.kullanici_adi, aday.sifre_hash, aday.created_at, aday.updated_at, versiyon],
    );
  }
}

/** İşletme için bir sonraki sürüm numarasını atomik olarak alır. */
export async function sonrakiVersiyon(islem: Islem, isletmeId: string): Promise<number> {
  await islem.calistir('INSERT OR IGNORE INTO versiyon_sayaci (isletme_id, sonraki) VALUES (?, 1)', [isletmeId]);
  const satir = await islem.tek<{ deger: number }>(
    'UPDATE versiyon_sayaci SET sonraki = sonraki + 1 WHERE isletme_id = ? RETURNING sonraki - 1 AS deger',
    [isletmeId],
  );
  if (!satir) throw new Error('Sürüm numarası üretilemedi');
  return Number(satir.deger);
}

export async function mevcutVersiyon(vt: MerkezVt, isletmeId: string): Promise<number> {
  const satir = await vt.tek<{ sonraki: number }>('SELECT sonraki FROM versiyon_sayaci WHERE isletme_id = ?', [isletmeId]);
  return satir ? Number(satir.sonraki) - 1 : 0;
}
