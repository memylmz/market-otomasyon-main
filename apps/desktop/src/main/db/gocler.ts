/**
 * Şema göçleri (§8.6).
 *
 * Kurallar:
 *  - Her göç numaralıdır ve **tek transaction** içinde uygulanır.
 *  - Göç betikleri koda gömülüdür (ayrı .sql dosyası değil): paketlenmiş
 *    uygulamada dosya yolu sorunu yaşanmaz.
 *  - Kırıcı göç öncesi otomatik yedek alınır (bkz. `gocleriUygula`).
 *
 * Tasarım kararları:
 *  - Parasal alanlar INTEGER (kuruş), miktarlar INTEGER (bindebir) — §8.5.
 *  - Hareket tabloları append-only; miktar/bakiye asla üzerine yazılmaz.
 *  - `stok_ozet` / `cari_ozet` yalnız **performans önbelleğidir**; kaynak doğruluk
 *    hareket tablolarıdır ve tetikleyicilerle (trigger) güncellenir, böylece
 *    ham SQL ile yazılsa bile tutarlı kalır. Her an yeniden hesaplanabilir.
 */

export interface Goc {
  surum: number;
  ad: string;
  yukari: string;
  asagi?: string;
}

const ILK_SEMA = /* sql */ `
-- ===========================================================================
-- Ayarlar ve altyapı
-- ===========================================================================
CREATE TABLE ayarlar (
  anahtar    TEXT PRIMARY KEY,
  deger      TEXT NOT NULL,
  aciklama   TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE belge_sayaclari (
  ad      TEXT PRIMARY KEY,
  sonraki INTEGER NOT NULL DEFAULT 1
);

-- ===========================================================================
-- Kullanıcılar ve yetki
-- ===========================================================================
CREATE TABLE kullanicilar (
  id                  TEXT PRIMARY KEY,
  ad                  TEXT NOT NULL,
  kullanici_adi       TEXT NOT NULL UNIQUE,
  pin_hash            TEXT,
  sifre_hash          TEXT,
  rol                 TEXT NOT NULL CHECK (rol IN ('ADMIN','MUDUR','KASIYER')),
  ek_yetkiler         TEXT NOT NULL DEFAULT '[]',
  kaldirilan_yetkiler TEXT NOT NULL DEFAULT '[]',
  aktif_mi            INTEGER NOT NULL DEFAULT 1 CHECK (aktif_mi IN (0,1)),
  son_giris           TEXT,
  hatali_giris        INTEGER NOT NULL DEFAULT 0,
  kilit_bitis         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  cihaz_id            TEXT,
  sunucu_versiyonu    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_kullanicilar_aktif ON kullanicilar(aktif_mi);

-- ===========================================================================
-- Katalog
-- ===========================================================================
CREATE TABLE kategoriler (
  id               TEXT PRIMARY KEY,
  ad               TEXT NOT NULL,
  ust_kategori_id  TEXT REFERENCES kategoriler(id),
  sira             INTEGER NOT NULL DEFAULT 0,
  aktif_mi         INTEGER NOT NULL DEFAULT 1 CHECK (aktif_mi IN (0,1)),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  cihaz_id         TEXT,
  sunucu_versiyonu INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_kategoriler_ust ON kategoriler(ust_kategori_id);

CREATE TABLE urunler (
  id                      TEXT PRIMARY KEY,
  ad                      TEXT NOT NULL,
  -- Türkçe karakterleri sadeleştirilmiş, küçük harfe indirilmiş arama alanı.
  -- Kasiyer "sut" yazarken "Süt"ü bulabilsin diye repository katmanında üretilir.
  arama_metni             TEXT NOT NULL DEFAULT '',
  kategori_id             TEXT REFERENCES kategoriler(id),
  marka                   TEXT,
  birim_tipi              TEXT NOT NULL DEFAULT 'ADET' CHECK (birim_tipi IN ('ADET','KG','LT')),
  alis_fiyati             INTEGER NOT NULL DEFAULT 0,   -- kuruş, KDV HARİÇ
  satis_fiyati            INTEGER NOT NULL DEFAULT 0,   -- kuruş, KDV DAHİL
  kdv_orani               REAL    NOT NULL DEFAULT 20,
  kritik_stok             INTEGER NOT NULL DEFAULT 0,   -- bindebir
  ideal_stok              INTEGER NOT NULL DEFAULT 0,
  raf_konumu              TEXT,
  aktif_mi                INTEGER NOT NULL DEFAULT 1 CHECK (aktif_mi IN (0,1)),
  varsayilan_tedarikci_id TEXT,
  skt_takibi              INTEGER NOT NULL DEFAULT 0 CHECK (skt_takibi IN (0,1)),
  notlar                  TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  cihaz_id                TEXT,
  sunucu_versiyonu        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_urunler_ad ON urunler(ad);
CREATE INDEX ix_urunler_arama ON urunler(arama_metni);
CREATE INDEX ix_urunler_kategori ON urunler(kategori_id);
CREATE INDEX ix_urunler_aktif ON urunler(aktif_mi, ad);

CREATE TABLE barkodlar (
  id                  TEXT PRIMARY KEY,
  urun_id             TEXT NOT NULL REFERENCES urunler(id),
  barkod              TEXT NOT NULL,
  ambalaj_aciklamasi  TEXT,
  aktif_mi            INTEGER NOT NULL DEFAULT 1 CHECK (aktif_mi IN (0,1)),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  cihaz_id            TEXT,
  sunucu_versiyonu    INTEGER NOT NULL DEFAULT 0
);
-- Satış anındaki en kritik arama; benzersizlik iş kuralıdır (§8.4).
CREATE UNIQUE INDEX ux_barkodlar_barkod ON barkodlar(barkod);
CREATE INDEX ix_barkodlar_urun ON barkodlar(urun_id);

-- ===========================================================================
-- Stok — append-only hareketler + türetilmiş özet
-- ===========================================================================
CREATE TABLE stok_hareketleri (
  id            TEXT PRIMARY KEY,
  urun_id       TEXT NOT NULL REFERENCES urunler(id),
  hareket_tipi  TEXT NOT NULL CHECK (hareket_tipi IN
                  ('SATIS','GIRIS','IADE','FIRE','SAYIM','DUZELTME','ACILIS','TEDARIKCI_IADE')),
  miktar        INTEGER NOT NULL,          -- işaretli, bindebir
  birim_maliyet INTEGER NOT NULL DEFAULT 0,
  belge_id      TEXT,
  belge_tipi    TEXT,
  skt           TEXT,
  lot_no        TEXT,
  neden_kodu    TEXT,
  aciklama      TEXT,
  kullanici_id  TEXT REFERENCES kullanicilar(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  cihaz_id      TEXT
);
CREATE INDEX ix_stok_hareket_urun ON stok_hareketleri(urun_id);
CREATE INDEX ix_stok_hareket_tarih ON stok_hareketleri(created_at);
CREATE INDEX ix_stok_hareket_belge ON stok_hareketleri(belge_id);
CREATE INDEX ix_stok_hareket_skt ON stok_hareketleri(skt) WHERE skt IS NOT NULL;

CREATE TABLE stok_ozet (
  urun_id    TEXT PRIMARY KEY REFERENCES urunler(id),
  miktar     INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Hareket eklendikçe özet otomatik güncellenir. Hareketler asla güncellenmez ya da
-- silinmez (append-only), bu yüzden yalnız INSERT tetikleyicisi yeterlidir.
CREATE TRIGGER trg_stok_ozet_ekle AFTER INSERT ON stok_hareketleri
BEGIN
  INSERT INTO stok_ozet (urun_id, miktar, updated_at)
  VALUES (NEW.urun_id, NEW.miktar, NEW.created_at)
  ON CONFLICT(urun_id) DO UPDATE SET
    miktar     = stok_ozet.miktar + excluded.miktar,
    updated_at = excluded.updated_at;
END;

-- Append-only güvencesini veritabanı seviyesinde uygula: elle UPDATE/DELETE
-- denemesi özet tabloyu bozacağı için reddedilir (§15.3 Tampering).
CREATE TRIGGER trg_stok_hareket_degistirilemez BEFORE UPDATE ON stok_hareketleri
BEGIN
  SELECT RAISE(ABORT, 'stok_hareketleri append-only bir tablodur; güncellenemez');
END;
CREATE TRIGGER trg_stok_hareket_silinemez BEFORE DELETE ON stok_hareketleri
BEGIN
  SELECT RAISE(ABORT, 'stok_hareketleri append-only bir tablodur; silinemez');
END;

-- ===========================================================================
-- Cari (veresiye defteri)
-- ===========================================================================
CREATE TABLE cariler (
  id                     TEXT PRIMARY KEY,
  tip                    TEXT NOT NULL CHECK (tip IN ('MUSTERI','TEDARIKCI')),
  ad_unvan               TEXT NOT NULL,
  arama_metni            TEXT NOT NULL DEFAULT '',
  telefon                TEXT,
  eposta                 TEXT,
  adres                  TEXT,
  vergi_dairesi          TEXT,
  vergi_no               TEXT,
  kredi_limiti           INTEGER NOT NULL DEFAULT 0,
  vade_gun               INTEGER NOT NULL DEFAULT 0,
  notlar                 TEXT,
  aktif_mi               INTEGER NOT NULL DEFAULT 1 CHECK (aktif_mi IN (0,1)),
  anonimlestirildi_mi    INTEGER NOT NULL DEFAULT 0 CHECK (anonimlestirildi_mi IN (0,1)),
  iletisim_rizasi        INTEGER NOT NULL DEFAULT 0 CHECK (iletisim_rizasi IN (0,1)),
  iletisim_rizasi_zamani TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  cihaz_id               TEXT,
  sunucu_versiyonu       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_cariler_tip ON cariler(tip, aktif_mi);
CREATE INDEX ix_cariler_arama ON cariler(arama_metni);
CREATE INDEX ix_cariler_telefon ON cariler(telefon);

CREATE TABLE cari_hareketler (
  id            TEXT PRIMARY KEY,
  cari_id       TEXT NOT NULL REFERENCES cariler(id),
  hareket_tipi  TEXT NOT NULL CHECK (hareket_tipi IN
                  ('BORC','ALACAK','TAHSILAT','ODEME','IADE','DUZELTME','ACILIS')),
  tutar         INTEGER NOT NULL,          -- işaretli kuruş
  aciklama      TEXT,
  belge_id      TEXT,
  belge_tipi    TEXT,
  tarih         TEXT NOT NULL,
  vade_tarihi   TEXT,
  kullanici_id  TEXT REFERENCES kullanicilar(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  cihaz_id      TEXT
);
CREATE INDEX ix_cari_hareket_cari ON cari_hareketler(cari_id, tarih);
CREATE INDEX ix_cari_hareket_tarih ON cari_hareketler(tarih);
CREATE INDEX ix_cari_hareket_belge ON cari_hareketler(belge_id);

CREATE TABLE cari_ozet (
  cari_id      TEXT PRIMARY KEY REFERENCES cariler(id),
  bakiye       INTEGER NOT NULL DEFAULT 0,
  son_hareket  TEXT,
  updated_at   TEXT NOT NULL
);

CREATE TRIGGER trg_cari_ozet_ekle AFTER INSERT ON cari_hareketler
BEGIN
  INSERT INTO cari_ozet (cari_id, bakiye, son_hareket, updated_at)
  VALUES (NEW.cari_id, NEW.tutar, NEW.tarih, NEW.created_at)
  ON CONFLICT(cari_id) DO UPDATE SET
    bakiye      = cari_ozet.bakiye + excluded.bakiye,
    son_hareket = MAX(COALESCE(cari_ozet.son_hareket, ''), excluded.son_hareket),
    updated_at  = excluded.updated_at;
END;

CREATE TRIGGER trg_cari_hareket_degistirilemez BEFORE UPDATE ON cari_hareketler
BEGIN
  SELECT RAISE(ABORT, 'cari_hareketler append-only bir tablodur; güncellenemez');
END;
CREATE TRIGGER trg_cari_hareket_silinemez BEFORE DELETE ON cari_hareketler
BEGIN
  SELECT RAISE(ABORT, 'cari_hareketler append-only bir tablodur; silinemez');
END;

-- ===========================================================================
-- Kasa / vardiya
-- ===========================================================================
CREATE TABLE kasa_oturumlari (
  id             TEXT PRIMARY KEY,
  kullanici_id   TEXT NOT NULL REFERENCES kullanicilar(id),
  acilis_zamani  TEXT NOT NULL,
  acilis_bakiye  INTEGER NOT NULL DEFAULT 0,
  kapanis_zamani TEXT,
  sayilan_nakit  INTEGER,
  beklenen_nakit INTEGER,
  kasa_farki     INTEGER,
  durum          TEXT NOT NULL DEFAULT 'ACIK' CHECK (durum IN ('ACIK','KAPALI')),
  notlar         TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  cihaz_id       TEXT
);
CREATE INDEX ix_kasa_oturum_durum ON kasa_oturumlari(durum, acilis_zamani);
CREATE INDEX ix_kasa_oturum_kullanici ON kasa_oturumlari(kullanici_id);

CREATE TABLE kasa_hareketleri (
  id              TEXT PRIMARY KEY,
  kasa_oturum_id  TEXT NOT NULL REFERENCES kasa_oturumlari(id),
  tip             TEXT NOT NULL CHECK (tip IN
                    ('SATIS_NAKIT','SATIS_KART','TAHSILAT','ODEME','GIDER','GIRIS','CIKIS','IADE_NAKIT','ACILIS')),
  tutar           INTEGER NOT NULL,
  aciklama        TEXT,
  belge_id        TEXT,
  kullanici_id    TEXT REFERENCES kullanicilar(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  cihaz_id        TEXT
);
CREATE INDEX ix_kasa_hareket_oturum ON kasa_hareketleri(kasa_oturum_id);
CREATE INDEX ix_kasa_hareket_tarih ON kasa_hareketleri(created_at);

-- ===========================================================================
-- Satış
-- ===========================================================================
CREATE TABLE satislar (
  id               TEXT PRIMARY KEY,
  fis_no           TEXT NOT NULL,
  tarih            TEXT NOT NULL,
  kullanici_id     TEXT REFERENCES kullanicilar(id),
  kasa_oturum_id   TEXT REFERENCES kasa_oturumlari(id),
  ara_toplam       INTEGER NOT NULL,
  iskonto_toplam   INTEGER NOT NULL DEFAULT 0,
  kdv_toplam       INTEGER NOT NULL DEFAULT 0,
  genel_toplam     INTEGER NOT NULL,
  odeme_ozeti      TEXT NOT NULL CHECK (odeme_ozeti IN ('NAKIT','KART','VERESIYE','PARCALI')),
  musteri_id       TEXT REFERENCES cariler(id),
  iptal_mi         INTEGER NOT NULL DEFAULT 0 CHECK (iptal_mi IN (0,1)),
  iptal_neden      TEXT,
  iptal_zamani     TEXT,
  iade_mi          INTEGER NOT NULL DEFAULT 0 CHECK (iade_mi IN (0,1)),
  kaynak_satis_id  TEXT REFERENCES satislar(id),
  fis_yazdirildi   INTEGER NOT NULL DEFAULT 0 CHECK (fis_yazdirildi IN (0,1)),
  notlar           TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  cihaz_id         TEXT
);
CREATE UNIQUE INDEX ux_satislar_fis ON satislar(fis_no, cihaz_id);
CREATE INDEX ix_satislar_tarih ON satislar(tarih);
CREATE INDEX ix_satislar_musteri ON satislar(musteri_id);
CREATE INDEX ix_satislar_oturum ON satislar(kasa_oturum_id);
CREATE INDEX ix_satislar_kaynak ON satislar(kaynak_satis_id);

CREATE TABLE satis_kalemleri (
  id            TEXT PRIMARY KEY,
  satis_id      TEXT NOT NULL REFERENCES satislar(id),
  urun_id       TEXT NOT NULL REFERENCES urunler(id),
  urun_adi      TEXT NOT NULL,
  barkod        TEXT,
  miktar        INTEGER NOT NULL,
  birim_tipi    TEXT NOT NULL DEFAULT 'ADET',
  birim_fiyat   INTEGER NOT NULL,
  birim_maliyet INTEGER NOT NULL DEFAULT 0,
  iskonto       INTEGER NOT NULL DEFAULT 0,
  kdv_orani     REAL    NOT NULL,
  kdv_tutar     INTEGER NOT NULL DEFAULT 0,
  satir_toplam  INTEGER NOT NULL,
  kampanya_id   TEXT,
  sira          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  cihaz_id      TEXT
);
CREATE INDEX ix_satis_kalem_satis ON satis_kalemleri(satis_id);
CREATE INDEX ix_satis_kalem_urun ON satis_kalemleri(urun_id);

CREATE TABLE odemeler (
  id          TEXT PRIMARY KEY,
  satis_id    TEXT NOT NULL REFERENCES satislar(id),
  odeme_tipi  TEXT NOT NULL CHECK (odeme_tipi IN ('NAKIT','KART','VERESIYE')),
  tutar       INTEGER NOT NULL,
  alinan      INTEGER NOT NULL DEFAULT 0,
  para_ustu   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  cihaz_id    TEXT
);
CREATE INDEX ix_odemeler_satis ON odemeler(satis_id);

CREATE TABLE askidaki_satislar (
  id           TEXT PRIMARY KEY,
  etiket       TEXT NOT NULL,
  kullanici_id TEXT REFERENCES kullanicilar(id),
  veri         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  cihaz_id     TEXT
);

-- ===========================================================================
-- Alış (mal kabul)
-- ===========================================================================
CREATE TABLE alis_faturalari (
  id            TEXT PRIMARY KEY,
  tedarikci_id  TEXT NOT NULL REFERENCES cariler(id),
  fatura_no     TEXT,
  tarih         TEXT NOT NULL,
  ara_toplam    INTEGER NOT NULL DEFAULT 0,
  kdv_toplam    INTEGER NOT NULL DEFAULT 0,
  genel_toplam  INTEGER NOT NULL DEFAULT 0,
  durum         TEXT NOT NULL DEFAULT 'TASLAK' CHECK (durum IN ('TASLAK','ONAYLANDI','IPTAL')),
  vade_tarihi   TEXT,
  notlar        TEXT,
  kullanici_id  TEXT REFERENCES kullanicilar(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  cihaz_id      TEXT
);
CREATE INDEX ix_alis_tedarikci ON alis_faturalari(tedarikci_id, tarih);

CREATE TABLE alis_kalemleri (
  id                TEXT PRIMARY KEY,
  alis_faturasi_id  TEXT NOT NULL REFERENCES alis_faturalari(id),
  urun_id           TEXT NOT NULL REFERENCES urunler(id),
  miktar            INTEGER NOT NULL,
  birim_fiyat       INTEGER NOT NULL,
  kdv_orani         REAL NOT NULL,
  satir_toplam      INTEGER NOT NULL,
  skt               TEXT,
  lot_no            TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  cihaz_id          TEXT
);
CREATE INDEX ix_alis_kalem_fatura ON alis_kalemleri(alis_faturasi_id);

-- ===========================================================================
-- Kampanya
-- ===========================================================================
CREATE TABLE kampanyalar (
  id               TEXT PRIMARY KEY,
  ad               TEXT NOT NULL,
  tip              TEXT NOT NULL CHECK (tip IN ('YUZDE','TUTAR','SABIT_FIYAT')),
  kapsam           TEXT NOT NULL CHECK (kapsam IN ('URUN','KATEGORI','TUM')),
  hedef_id         TEXT,
  deger            REAL NOT NULL,
  baslangic        TEXT NOT NULL,
  bitis            TEXT NOT NULL,
  oncelik          INTEGER NOT NULL DEFAULT 0,
  aktif_mi         INTEGER NOT NULL DEFAULT 1 CHECK (aktif_mi IN (0,1)),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  cihaz_id         TEXT,
  sunucu_versiyonu INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_kampanya_aktif ON kampanyalar(aktif_mi, baslangic, bitis);

-- ===========================================================================
-- Sayım (envanter)
-- ===========================================================================
CREATE TABLE sayimlar (
  id           TEXT PRIMARY KEY,
  ad           TEXT NOT NULL,
  durum        TEXT NOT NULL DEFAULT 'ACIK' CHECK (durum IN ('ACIK','TAMAMLANDI','IPTAL')),
  baslangic    TEXT NOT NULL,
  bitis        TEXT,
  kullanici_id TEXT REFERENCES kullanicilar(id),
  notlar       TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  cihaz_id     TEXT
);

CREATE TABLE sayim_satirlari (
  id             TEXT PRIMARY KEY,
  sayim_id       TEXT NOT NULL REFERENCES sayimlar(id),
  urun_id        TEXT NOT NULL REFERENCES urunler(id),
  sistem_miktari INTEGER NOT NULL DEFAULT 0,
  sayilan_miktar INTEGER NOT NULL DEFAULT 0,
  fark           INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  cihaz_id       TEXT
);
CREATE UNIQUE INDEX ux_sayim_satir ON sayim_satirlari(sayim_id, urun_id);

-- ===========================================================================
-- Senkron ve denetim (§8.3)
-- ===========================================================================
CREATE TABLE sync_outbox (
  id               TEXT PRIMARY KEY,          -- olayın idempotency uuid'si
  olay_tipi        TEXT NOT NULL,
  entity           TEXT NOT NULL,
  entity_id        TEXT NOT NULL,
  veri             TEXT NOT NULL,             -- JSON
  olusturma_zamani TEXT NOT NULL,
  gonderildi_mi    INTEGER NOT NULL DEFAULT 0 CHECK (gonderildi_mi IN (0,1)),
  synced_at        TEXT,
  deneme_sayisi    INTEGER NOT NULL DEFAULT 0,
  son_hata         TEXT,
  cihaz_id         TEXT
);
-- Bekleyen olayları çekmek en sık sorgudur (§8.4).
CREATE INDEX ix_outbox_bekleyen ON sync_outbox(gonderildi_mi, olusturma_zamani);

CREATE TABLE sync_state (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  last_pull_version  INTEGER NOT NULL DEFAULT 0,
  last_sync_at       TEXT,
  last_push_at       TEXT,
  last_pull_at       TEXT,
  son_hata           TEXT,
  cihaz_id           TEXT
);

CREATE TABLE sync_cakismalar (
  id            TEXT PRIMARY KEY,
  entity        TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  kaynak_a      TEXT,
  kaynak_b      TEXT,
  cozum         TEXT NOT NULL,
  cozum_zamani  TEXT NOT NULL,
  detay         TEXT
);
CREATE INDEX ix_cakisma_zaman ON sync_cakismalar(cozum_zamani);

CREATE TABLE denetim_log (
  id           TEXT PRIMARY KEY,
  kullanici_id TEXT,
  islem        TEXT NOT NULL,
  entity       TEXT NOT NULL,
  entity_id    TEXT,
  eski_deger   TEXT,
  yeni_deger   TEXT,
  zaman        TEXT NOT NULL,
  cihaz_id     TEXT,
  ip           TEXT
);
CREATE INDEX ix_denetim_zaman ON denetim_log(zaman);
CREATE INDEX ix_denetim_kullanici ON denetim_log(kullanici_id, zaman);
CREATE INDEX ix_denetim_entity ON denetim_log(entity, entity_id);

-- ===========================================================================
-- Özet / rollup tabloları (§8.2) — panel ve yerel raporlar bunları okur
-- ===========================================================================
CREATE TABLE gunluk_ozet (
  tarih         TEXT NOT NULL,
  cihaz_id      TEXT NOT NULL DEFAULT '',
  ciro          INTEGER NOT NULL DEFAULT 0,
  iade_toplam   INTEGER NOT NULL DEFAULT 0,
  iptal_toplam  INTEGER NOT NULL DEFAULT 0,
  islem_sayisi  INTEGER NOT NULL DEFAULT 0,
  nakit         INTEGER NOT NULL DEFAULT 0,
  kart          INTEGER NOT NULL DEFAULT 0,
  veresiye      INTEGER NOT NULL DEFAULT 0,
  tahsilat      INTEGER NOT NULL DEFAULT 0,
  gider         INTEGER NOT NULL DEFAULT 0,
  brut_kar      INTEGER NOT NULL DEFAULT 0,
  kdv_toplam    INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (tarih, cihaz_id)
);

CREATE TABLE urun_satis_ozet (
  urun_id    TEXT NOT NULL REFERENCES urunler(id),
  donem      TEXT NOT NULL,          -- gün anahtarı (YYYY-AA-GG)
  cihaz_id   TEXT NOT NULL DEFAULT '',
  adet       INTEGER NOT NULL DEFAULT 0,
  ciro       INTEGER NOT NULL DEFAULT 0,
  kar        INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (urun_id, donem, cihaz_id)
);
CREATE INDEX ix_urun_ozet_donem ON urun_satis_ozet(donem);
`;

export const GOCLER: readonly Goc[] = [
  {
    surum: 1,
    ad: 'ilk_sema',
    yukari: ILK_SEMA,
    // İlk şemanın geri alması tüm veriyi siler; yalnız geliştirme ortamında anlamlıdır.
    asagi: `
      DROP TABLE IF EXISTS urun_satis_ozet;
      DROP TABLE IF EXISTS gunluk_ozet;
      DROP TABLE IF EXISTS denetim_log;
      DROP TABLE IF EXISTS sync_cakismalar;
      DROP TABLE IF EXISTS sync_state;
      DROP TABLE IF EXISTS sync_outbox;
      DROP TABLE IF EXISTS sayim_satirlari;
      DROP TABLE IF EXISTS sayimlar;
      DROP TABLE IF EXISTS kampanyalar;
      DROP TABLE IF EXISTS alis_kalemleri;
      DROP TABLE IF EXISTS alis_faturalari;
      DROP TABLE IF EXISTS askidaki_satislar;
      DROP TABLE IF EXISTS odemeler;
      DROP TABLE IF EXISTS satis_kalemleri;
      DROP TABLE IF EXISTS satislar;
      DROP TABLE IF EXISTS kasa_hareketleri;
      DROP TABLE IF EXISTS kasa_oturumlari;
      DROP TABLE IF EXISTS cari_ozet;
      DROP TABLE IF EXISTS cari_hareketler;
      DROP TABLE IF EXISTS cariler;
      DROP TABLE IF EXISTS stok_ozet;
      DROP TABLE IF EXISTS stok_hareketleri;
      DROP TABLE IF EXISTS barkodlar;
      DROP TABLE IF EXISTS urunler;
      DROP TABLE IF EXISTS kategoriler;
      DROP TABLE IF EXISTS kullanicilar;
      DROP TABLE IF EXISTS belge_sayaclari;
      DROP TABLE IF EXISTS ayarlar;
    `,
  },
  {
    surum: 2,
    ad: 'negatif_stok_varsayilani',
    /*
     * Kötü varsayılanın düzeltilmesi.
     *
     * v1'de `stok.negatif_izin` varsayılanı '0' idi ve stok yetersizken satış
     * tamamen engelleniyordu. Sahada bu yanlış: stok kaydı sayım hatası veya geç
     * girilen mal kabul yüzünden gerçeğin gerisinde kalabilir ve kasa bu yüzden
     * durmamalıdır (§20 "kritik akış çevresel hataya bağlı değildir").
     *
     * Yalnız değer HÂLÂ eski varsayılandaysa değiştirilir; kullanıcı bilinçli
     * olarak engellemeyi seçtiyse (değeri elle '0' yaptıysa bile ayırt edemeyiz,
     * ancak bu ayar arayüzde yeni açıldığı için pratikte dokunulmamıştır) tercih
     * Ayarlar → Satış Kuralları'ndan tekrar kapatılabilir.
     */
    yukari: `
      UPDATE ayarlar
      SET deger = '1',
          aciklama = 'Stok yetersizken satışa izin ver (uyarı yine gösterilir)'
      WHERE anahtar = 'stok.negatif_izin' AND deger = '0';
    `,
    asagi: `
      UPDATE ayarlar SET deger = '0' WHERE anahtar = 'stok.negatif_izin';
    `,
  },
  {
    surum: 3,
    ad: 'yonetici_kullanicilarini_buluta_gonder',
    /*
     * Mevcut kurulumlardaki yönetici hesaplarını merkeze taşır.
     *
     * NEDEN: kullanıcılar bugüne dek yalnız BULUTTAN KASAYA akıyordu. Kurulum
     * sihirbazının açtığı sahip hesabı merkeze hiç ulaşmadığı için panelde
     * görünmüyor, aynı kullanıcı adı panelde ikinci kez açılınca da kasadaki
     * `kullanici_adi` UNIQUE kısıtı senkronu kilitliyordu. Yeni kurulumlarda
     * olayı sihirbaz üretir; ZATEN KURULMUŞ kasalar için tek çare bu göçtür.
     *
     * Yalnız şifresi olan aktif ADMIN'ler gönderilir: paneldeki oturum şifreyle
     * açılır, PIN kabul edilmez.
     *
     * Yeni kurulumda bu tablo göç anında boştur; hiçbir satır üretilmez.
     */
    yukari: `
      INSERT INTO sync_outbox (id, olay_tipi, entity, entity_id, veri, olusturma_zamani, gonderildi_mi, cihaz_id)
      SELECT
        lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
          substr(lower(hex(randomblob(2))), 2) || '-' ||
          substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
          lower(hex(randomblob(6))),
        'KULLANICI_KAYDEDILDI', 'kullanici', k.id,
        json_object(
          'id', k.id,
          'ad', k.ad,
          'kullanici_adi', k.kullanici_adi,
          'rol', k.rol,
          'sifre_hash', k.sifre_hash,
          'pin_hash', k.pin_hash,
          'ek_yetkiler', json(k.ek_yetkiler),
          'kaldirilan_yetkiler', json(k.kaldirilan_yetkiler),
          'aktif_mi', json('true'),
          'created_at', k.created_at,
          'updated_at', k.updated_at
        ),
        k.updated_at, 0,
        COALESCE((SELECT deger FROM ayarlar WHERE anahtar = 'cihaz.id'), k.cihaz_id)
      FROM kullanicilar k
      WHERE k.rol = 'ADMIN' AND k.aktif_mi = 1
        AND k.sifre_hash IS NOT NULL AND k.sifre_hash <> '';
    `,
    asagi: `
      DELETE FROM sync_outbox WHERE olay_tipi = 'KULLANICI_KAYDEDILDI';
    `,
  },
  {
    surum: 4,
    ad: 'miktar_bazli_kampanyalar',
    /*
     * Miktar bazlı kampanyalar (§10.8): "3 al 2 öde", "3 kg üzeri 8,00/kg".
     *
     * İki değişiklik gerekiyor: `esik_miktar` sütunu (kampanyanın eşiği,
     * bindebir cinsinden) ve `tip` sütunundaki CHECK kısıtının genişlemesi.
     *
     * SQLite'ta CHECK kısıtı ALTER ile değiştirilemez; tablo yeniden kurulur.
     * Veri kopyalanır, eski tablo düşürülür, yenisi adını alır.
     */
    yukari: `
      CREATE TABLE kampanyalar_yeni (
        id               TEXT PRIMARY KEY,
        ad               TEXT NOT NULL,
        tip              TEXT NOT NULL CHECK (tip IN ('YUZDE','TUTAR','SABIT_FIYAT','N_AL_M_ODE','KADEMELI_FIYAT')),
        kapsam           TEXT NOT NULL CHECK (kapsam IN ('URUN','KATEGORI','TUM')),
        hedef_id         TEXT,
        deger            REAL NOT NULL,
        esik_miktar      INTEGER,
        baslangic        TEXT NOT NULL,
        bitis            TEXT NOT NULL,
        oncelik          INTEGER NOT NULL DEFAULT 0,
        aktif_mi         INTEGER NOT NULL DEFAULT 1 CHECK (aktif_mi IN (0,1)),
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        cihaz_id         TEXT,
        sunucu_versiyonu INTEGER NOT NULL DEFAULT 0
      );

      INSERT INTO kampanyalar_yeni
        (id, ad, tip, kapsam, hedef_id, deger, esik_miktar, baslangic, bitis, oncelik, aktif_mi,
         created_at, updated_at, cihaz_id, sunucu_versiyonu)
      SELECT id, ad, tip, kapsam, hedef_id, deger, NULL, baslangic, bitis, oncelik, aktif_mi,
             created_at, updated_at, cihaz_id, sunucu_versiyonu
        FROM kampanyalar;

      DROP TABLE kampanyalar;
      ALTER TABLE kampanyalar_yeni RENAME TO kampanyalar;
    `,
    asagi: `
      DELETE FROM kampanyalar WHERE tip IN ('N_AL_M_ODE','KADEMELI_FIYAT');
    `,
  },
  {
    surum: 5,
    ad: 'iade_talimatlari',
    /*
     * Panelden gelen kısmi iade talimatları (§10.4).
     *
     * Talimat pull'da YEREL OLARAK SAKLANIR, hemen uygulanmaz. Sebebi: iade
     * bir kasa oturumu gerektirir (iade fişi bir vardiyaya aittir ve nakit
     * iadede para çekmeceden çıkar). Senkron kasa kapalıyken de çalıştığı için
     * talimat o an uygulanamayabilir; pull imleci geçtiğinde kayıt bir daha
     * gelmeyeceğinden burada tutulur ve kasa açıldığında işlenir.
     */
    yukari: `
      CREATE TABLE IF NOT EXISTS iade_talimatlari (
        id             TEXT PRIMARY KEY,
        satis_id       TEXT NOT NULL,
        kalemler       TEXT NOT NULL,
        iade_yontemi   TEXT NOT NULL,
        neden          TEXT NOT NULL,
        hedef_cihaz_id TEXT NOT NULL,
        kullanici_id   TEXT,
        uygulandi_mi   INTEGER NOT NULL DEFAULT 0,
        sonuc_satis_id TEXT,
        hata           TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_iade_talimat_bekleyen ON iade_talimatlari(uygulandi_mi);
    `,
    asagi: `DROP TABLE IF EXISTS iade_talimatlari;`,
  },
  {
    surum: 6,
    ad: 'cari_talimatlari',
    /*
     * Panelden gelen cari talimatları (§10.7): açılış bakiyesi, bakiye
     * düzeltmesi, tahsilat iptali.
     *
     * İade talimatlarındaki desenin aynısı ve aynı sebeple: `cari_hareketler`
     * değiştirilemez bir defterdir, tek yazıcısı kasadır. Talimat pull'da
     * yerelde saklanır çünkü nakit tahsilatın iptali bir KASA OTURUMU ister
     * (para çekmeceden geri çıkar) ve senkron kasa kapalıyken de çalışır;
     * pull imleci geçtiğinde kayıt bir daha gelmeyeceğinden burada beklet.
     */
    yukari: `
      CREATE TABLE IF NOT EXISTS cari_talimatlari (
        id               TEXT PRIMARY KEY,
        cari_id          TEXT NOT NULL,
        tip              TEXT NOT NULL,
        tutar            INTEGER NOT NULL DEFAULT 0,
        hedef_hareket_id TEXT,
        neden            TEXT NOT NULL,
        hedef_cihaz_id   TEXT NOT NULL,
        kullanici_id     TEXT,
        uygulandi_mi     INTEGER NOT NULL DEFAULT 0,
        sonuc_hareket_id TEXT,
        hata             TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_cari_talimat_bekleyen ON cari_talimatlari(uygulandi_mi);
    `,
    asagi: `DROP TABLE IF EXISTS cari_talimatlari;`,
  },
  {
    surum: 7,
    ad: 'alis_talimatlari',
    /*
     * Panelden gelen alış faturası talimatları (§11.8): oluştur, iptal, güncelle.
     *
     * Fatura kaydedildiğinde stok ARTAR ve tedarikçiye cari BORÇ doğar; iki
     * defterin de tek yazıcısı kasadır. Panel yalnız niyeti bildirir, belgeyi ve
     * hareketleri kasa kendi mal kabul servisiyle üretir.
     *
     * `veri` alanı talimatın gövdesini JSON olarak taşır: OLUSTUR'da mal kabul
     * girdisi, IPTAL'de neden, GUNCELLE'de değişen alanlar. Talimat tipleri
     * farklı şekiller taşıdığı için her biri ayrı sütun olmaz.
     */
    yukari: `
      CREATE TABLE IF NOT EXISTS alis_talimatlari (
        id             TEXT PRIMARY KEY,
        tip            TEXT NOT NULL,
        fatura_id      TEXT,
        veri           TEXT NOT NULL,
        hedef_cihaz_id TEXT NOT NULL,
        kullanici_id   TEXT,
        uygulandi_mi   INTEGER NOT NULL DEFAULT 0,
        sonuc_fatura_id TEXT,
        hata           TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_alis_talimat_bekleyen ON alis_talimatlari(uygulandi_mi);
    `,
    asagi: `DROP TABLE IF EXISTS alis_talimatlari;`,
  },
  {
    surum: 8,
    ad: 'fiyat_guncelleme_zamani',
    /*
     * Satış fiyatının EN SON NE ZAMAN değiştiği (§13.3).
     *
     * "Fiyatı değişen ürünlerin etiketlerini bas" için gerekiyor. `updated_at`
     * bu iş için yetmez: ürünün adı ya da raf kodu değişince o da güncellenir
     * ve etiket kuyruğu fiyatı hiç değişmemiş yüzlerce ürünle dolar. Rafta
     * yanlış fiyat kalmasın diye basılan etiket, doğru ürünleri hedeflemeli.
     *
     * Alan `urunKaydet` içinde SQL tarafında dolar: fiyat gerçekten değiştiyse
     * yazılır. Çağıranın hatırlaması gereken bir şey yok.
     */
    yukari: `
      ALTER TABLE urunler ADD COLUMN fiyat_guncelleme TEXT;
      UPDATE urunler SET fiyat_guncelleme = updated_at WHERE fiyat_guncelleme IS NULL;
    `,
    asagi: ``,
  },
  {
    surum: 9,
    ad: 'talimat_sonuc_bildirimi',
    /*
     * Talimatın SONUCU buluta bildirildi mi (§11.8).
     *
     * Talimat akışı tek yönlüydü: kasa uyguluyor, sonucu yalnız kendi yerel
     * kaydına yazıyordu. Bulut hiç öğrenmediği için talimat satırı orada
     * sonsuza kadar "bekliyor" kalıyor, panel de o faturanın düzenle/iptal
     * düğmelerini bir daha AÇMIYORDU.
     *
     * Bu sütun iki işi birden görür: bundan sonra yazılan bildirimleri işaretler
     * ve ZATEN UYGULANMIŞ eski talimatları `0` bırakarak telafi bildirimine
     * aday gösterir (bkz. `bildirilmemisSonuclariGonder`). Varsayılanın 0 olması
     * kasten: eski satırların hepsi bir kez geriye dönük bildirilmelidir.
     */
    yukari: `ALTER TABLE alis_talimatlari ADD COLUMN sonuc_bildirildi_mi INTEGER NOT NULL DEFAULT 0;`,
    asagi: ``,
  },
  {
    surum: 10,
    ad: 'cari_talimat_para_yolu',
    /*
     * Panelden verilen tahsilat/ödeme iptalinde paranın geri dönüş yolu
     * (NAKIT | KART). Boşsa kasa orijinal yolu kullanır — eski talimatlar
     * eskisi gibi davranır.
     */
    yukari: `ALTER TABLE cari_talimatlari ADD COLUMN para_yolu TEXT;`,
    asagi: ``,
  },
  {
    surum: 11,
    ad: 'banka_hareketleri',
    /*
     * Banka/POS defterine ELLE girilen hareketler (açılış, komisyon,
     * kasa↔banka aktarımı, düzeltme). Kart satışı ve kart/havale tahsilat ve
     * ödemeleri burada TUTULMAZ, kendi kayıtlarından türetilir — iki yerde
     * tutulan para ayrışır. `tutar` işaretlidir (+ bankaya giren).
     */
    yukari: `
      CREATE TABLE IF NOT EXISTS banka_hareketleri (
        id              TEXT PRIMARY KEY,
        tur             TEXT NOT NULL CHECK (tur IN ('ACILIS','KOMISYON','BANKADAN_KASAYA','KASADAN_BANKAYA','DUZELTME')),
        tutar           INTEGER NOT NULL,
        aciklama        TEXT NOT NULL,
        kasa_hareket_id TEXT,
        kullanici_id    TEXT,
        tarih           TEXT NOT NULL,
        cihaz_id        TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_banka_tarih ON banka_hareketleri(tarih);
    `,
    asagi: `DROP TABLE IF EXISTS banka_hareketleri;`,
  },
  {
    surum: 12,
    ad: 'iade_talimat_musteri',
    /*
     * Panelden verilen iadede, perakende satışın iadesi borcundan düşülecek
     * müşteri. Boşsa satışın kendi müşterisi kullanılır (eski davranış).
     */
    yukari: `ALTER TABLE iade_talimatlari ADD COLUMN musteri_id TEXT;`,
    asagi: ``,
  },
  {
    surum: 13,
    ad: 'odeme_pos_bilgisi',
    /*
     * POS entegrasyonu: kart çekiminin onay kodu, cihaz referansı (iade/iptalde
     * orijinal işlemi gösterir) ve maskeli kart. POS kapalıyken boş kalır.
     */
    yukari: `
      ALTER TABLE odemeler ADD COLUMN pos_onay_kodu TEXT;
      ALTER TABLE odemeler ADD COLUMN pos_referans TEXT;
      ALTER TABLE odemeler ADD COLUMN pos_kart TEXT;
    `,
    asagi: ``,
  },
  {
    surum: 14,
    ad: 'cari_hareket_pos_bilgisi',
    /*
     * Müşteriden kartla tahsilatın POS bilgisi. İptalde "karta iade" seçilirse
     * orijinal çekimin cihaz referansı buradan bulunur. Defter append-only;
     * sütun eklemek mevcut satırları değiştirmez.
     */
    yukari: `
      ALTER TABLE cari_hareketler ADD COLUMN pos_onay_kodu TEXT;
      ALTER TABLE cari_hareketler ADD COLUMN pos_referans TEXT;
      ALTER TABLE cari_hareketler ADD COLUMN pos_kart TEXT;
    `,
    asagi: ``,
  },
  {
    surum: 15,
    ad: 'pos_islemleri',
    /*
     * POS işlem günlüğü — cihaza giden HER istek ve sonucu (onay, red, zaman
     * aşımı, hata). Gün sonunda POS slibiyle karşılaştırma ve "para çekildi mi?"
     * sorusu için. Yalnız bu kasada tutulur; buluta gitmez.
     */
    yukari: `
      CREATE TABLE pos_islemleri (
        id            TEXT PRIMARY KEY,
        zaman         TEXT NOT NULL,
        tur           TEXT NOT NULL,
        tutar         INTEGER NOT NULL,
        sonuc         TEXT NOT NULL,
        onay_kodu     TEXT,
        referans      TEXT,
        kart          TEXT,
        hata          TEXT,
        orijinal_referans TEXT,
        belge_id      TEXT,
        belge_tipi    TEXT,
        kullanici_id  TEXT,
        cihaz_id      TEXT
      );
      CREATE INDEX ix_pos_islemleri_zaman ON pos_islemleri (zaman);
    `,
    asagi: `DROP TABLE IF EXISTS pos_islemleri;`,
  },
];

/** Kod tabanının beklediği en yüksek şema sürümü. */
export const HEDEF_SEMA_SURUMU = GOCLER.reduce((enYuksek, g) => Math.max(enYuksek, g.surum), 0);
