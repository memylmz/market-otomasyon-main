/**
 * Kullanıcı repository'si.
 *
 * Şifre/PIN hash'leri yalnız bu katmandan çıkar ve **asla** arayüze gönderilmez;
 * dışa açılan tip `KullaniciGorunumu`'dur (§15.1).
 */

import { simdi, uuid, type Rol, type Yetki, type ZamanDamgasi } from '@market/shared';
import type { Vt } from '../db/surucu.js';
import { boolToSayi, jsonCoz, sayiToBool } from './ortak.js';

export interface KullaniciGorunumu {
  id: string;
  ad: string;
  kullanici_adi: string;
  rol: Rol;
  ek_yetkiler: Yetki[];
  kaldirilan_yetkiler: Yetki[];
  aktif_mi: boolean;
  son_giris: ZamanDamgasi | null;
  hatali_giris: number;
  kilit_bitis: ZamanDamgasi | null;
  pin_tanimli: boolean;
  created_at: ZamanDamgasi;
  updated_at: ZamanDamgasi;
}

/** Yalnız kimlik doğrulama sırasında kullanılan, hash içeren iç tip. */
export interface KullaniciGizli extends KullaniciGorumumSiz {
  pin_hash: string | null;
  sifre_hash: string | null;
}
type KullaniciGorumumSiz = Omit<KullaniciGorunumu, 'pin_tanimli'>;

type HamKullanici = {
  id: string;
  ad: string;
  kullanici_adi: string;
  pin_hash: string | null;
  sifre_hash: string | null;
  rol: Rol;
  ek_yetkiler: string;
  kaldirilan_yetkiler: string;
  aktif_mi: number;
  son_giris: string | null;
  hatali_giris: number;
  kilit_bitis: string | null;
  created_at: string;
  updated_at: string;
};

const ALANLAR = `id, ad, kullanici_adi, pin_hash, sifre_hash, rol, ek_yetkiler, kaldirilan_yetkiler,
  aktif_mi, son_giris, hatali_giris, kilit_bitis, created_at, updated_at`;

function coz(satir: HamKullanici): KullaniciGizli {
  return {
    id: satir.id,
    ad: satir.ad,
    kullanici_adi: satir.kullanici_adi,
    pin_hash: satir.pin_hash,
    sifre_hash: satir.sifre_hash,
    rol: satir.rol,
    ek_yetkiler: jsonCoz<Yetki[]>(satir.ek_yetkiler, []),
    kaldirilan_yetkiler: jsonCoz<Yetki[]>(satir.kaldirilan_yetkiler, []),
    aktif_mi: sayiToBool(satir.aktif_mi),
    son_giris: satir.son_giris,
    hatali_giris: satir.hatali_giris,
    kilit_bitis: satir.kilit_bitis,
    created_at: satir.created_at,
    updated_at: satir.updated_at,
  };
}

/** Hash alanlarını atarak arayüze güvenli tip üretir. */
export function gorunume(kullanici: KullaniciGizli): KullaniciGorunumu {
  // Parola ve PIN hash'leri KASITLI olarak ayıklanır; arayüze asla çıkmaz.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pin_hash, sifre_hash, ...geri } = kullanici;
  return { ...geri, pin_tanimli: Boolean(pin_hash) };
}

export function kullaniciAdiIleBul(vt: Vt, kullaniciAdi: string): KullaniciGizli | null {
  const satir = vt
    .hazirla(`SELECT ${ALANLAR} FROM kullanicilar WHERE kullanici_adi = ? COLLATE NOCASE`)
    .tek<HamKullanici>(kullaniciAdi.trim());
  return satir ? coz(satir) : null;
}

export function kullaniciBul(vt: Vt, id: string): KullaniciGizli | null {
  const satir = vt.hazirla(`SELECT ${ALANLAR} FROM kullanicilar WHERE id = ?`).tek<HamKullanici>(id);
  return satir ? coz(satir) : null;
}

export function kullanicilariListele(vt: Vt, sadeceAktif = false): KullaniciGorunumu[] {
  const satirlar = vt
    .hazirla(`SELECT ${ALANLAR} FROM kullanicilar ${sadeceAktif ? 'WHERE aktif_mi = 1' : ''} ORDER BY ad`)
    .tumu<HamKullanici>();
  return satirlar.map((s) => gorunume(coz(s)));
}

/** PIN'i tanımlı aktif kullanıcılar — hızlı vardiya değişimi ekranı için. */
export function pinliKullanicilar(vt: Vt): KullaniciGorunumu[] {
  const satirlar = vt
    .hazirla(`SELECT ${ALANLAR} FROM kullanicilar WHERE aktif_mi = 1 AND pin_hash IS NOT NULL ORDER BY ad`)
    .tumu<HamKullanici>();
  return satirlar.map((s) => gorunume(coz(s)));
}

export interface KullaniciYazma {
  id?: string;
  ad: string;
  kullanici_adi: string;
  rol: Rol;
  pin_hash?: string | null;
  sifre_hash?: string | null;
  ek_yetkiler?: Yetki[];
  kaldirilan_yetkiler?: Yetki[];
  aktif_mi?: boolean;
}

export function kullaniciKaydet(vt: Vt, girdi: KullaniciYazma, cihazId: string, zaman = simdi()): string {
  const id = girdi.id ?? uuid();
  const mevcut = girdi.id ? kullaniciBul(vt, girdi.id) : null;
  // Hash alanı verilmediyse mevcut değeri korunur (düzenlemede şifre sıfırlanmasın).
  const pinHash = girdi.pin_hash !== undefined ? girdi.pin_hash : (mevcut?.pin_hash ?? null);
  const sifreHash = girdi.sifre_hash !== undefined ? girdi.sifre_hash : (mevcut?.sifre_hash ?? null);

  vt.hazirla(
    `INSERT INTO kullanicilar (id, ad, kullanici_adi, pin_hash, sifre_hash, rol, ek_yetkiler,
                               kaldirilan_yetkiler, aktif_mi, created_at, updated_at, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       ad = excluded.ad, kullanici_adi = excluded.kullanici_adi, pin_hash = excluded.pin_hash,
       sifre_hash = excluded.sifre_hash, rol = excluded.rol, ek_yetkiler = excluded.ek_yetkiler,
       kaldirilan_yetkiler = excluded.kaldirilan_yetkiler, aktif_mi = excluded.aktif_mi,
       updated_at = excluded.updated_at, cihaz_id = excluded.cihaz_id`,
  ).calistir(
    id,
    girdi.ad.trim(),
    girdi.kullanici_adi.trim(),
    pinHash,
    sifreHash,
    girdi.rol,
    JSON.stringify(girdi.ek_yetkiler ?? mevcut?.ek_yetkiler ?? []),
    JSON.stringify(girdi.kaldirilan_yetkiler ?? mevcut?.kaldirilan_yetkiler ?? []),
    boolToSayi(girdi.aktif_mi ?? mevcut?.aktif_mi ?? true),
    mevcut?.created_at ?? zaman,
    zaman,
    cihazId,
  );
  return id;
}

export function girisBasarili(vt: Vt, id: string, zaman = simdi()): void {
  vt.hazirla('UPDATE kullanicilar SET son_giris = ?, hatali_giris = 0, kilit_bitis = NULL, updated_at = ? WHERE id = ?').calistir(
    zaman,
    zaman,
    id,
  );
}

/** Hatalı giriş sayacını artırır; sınıra ulaşınca hesabı geçici kilitler (§15.4). */
export function girisBasarisiz(
  vt: Vt,
  id: string,
  sinir: number,
  kilitSaniye: number,
  zaman = simdi(),
): { kilitlendi: boolean; kalanHak: number } {
  const kullanici = kullaniciBul(vt, id);
  const yeniSayac = (kullanici?.hatali_giris ?? 0) + 1;
  const kilitlendi = yeniSayac >= sinir;
  const kilitBitis = kilitlendi ? new Date(Date.parse(zaman) + kilitSaniye * 1000).toISOString() : null;
  vt.hazirla('UPDATE kullanicilar SET hatali_giris = ?, kilit_bitis = ?, updated_at = ? WHERE id = ?').calistir(
    kilitlendi ? 0 : yeniSayac,
    kilitBitis,
    zaman,
    id,
  );
  return { kilitlendi, kalanHak: Math.max(0, sinir - yeniSayac) };
}

export function kilitliMi(kullanici: KullaniciGizli, zaman = simdi()): boolean {
  return Boolean(kullanici.kilit_bitis && kullanici.kilit_bitis > zaman);
}

export function sifreGuncelle(vt: Vt, id: string, sifreHash: string | null, pinHash: string | null, zaman = simdi()): void {
  const parcalar: string[] = [];
  const parametreler: unknown[] = [];
  if (sifreHash !== null) {
    parcalar.push('sifre_hash = ?');
    parametreler.push(sifreHash);
  }
  if (pinHash !== null) {
    parcalar.push('pin_hash = ?');
    parametreler.push(pinHash);
  }
  if (parcalar.length === 0) return;
  parcalar.push('updated_at = ?');
  parametreler.push(zaman, id);
  vt.hazirla(`UPDATE kullanicilar SET ${parcalar.join(', ')} WHERE id = ?`).calistir(...parametreler);
}

export function adminSayisi(vt: Vt): number {
  const satir = vt
    .hazirla("SELECT COUNT(*) AS adet FROM kullanicilar WHERE rol = 'ADMIN' AND aktif_mi = 1")
    .tek<{ adet: number }>();
  return satir?.adet ?? 0;
}

/**
 * Yerel kimligi buluttaki kimlige DEVREDER.
 *
 * Gecmis YENIDEN YAZILMAZ: `stok_hareketleri` ve `cari_hareketler` degistirilemez
 * defterlerdir (trigger ile korunur) ve zaten dogruyu soylerler - o hareketler
 * gercekten o kimlikle yapilmistir. Bu yuzden eski satir SILINMEZ, tarihsel
 * aktor olarak kalir; yalnizca pasiflestirilir ve kullanici adi serbest birakilir
 * ki bulut kaydi ayni adi alabilsin.
 *
 * Ileriye donuk etkinlik bulut kimligine yazilir; acik oturumun aktoru
 * `Uygulama.kimlikBirlesmeleriniUygula` ile tazelenir.
 */
function kimligiDevret(vt: Vt, eskiId: string, yeniId: string, zaman: ZamanDamgasi): void {
  /*
   * CANLI DURUM kisiyi izler, GECMIS yerinde kalir.
   *
   * Acik kasa oturumu ve askidaki satislar "su an devam eden is"tir; bunlar
   * eski kimlikte kalirsa kasiyer kendi actigi kasayla satis yapamaz: ekran
   * acik kasayi gosterirken satis "acik kasa yok" der. Kapanmis oturumlar ve
   * defter satirlari ise gecmistir, oldugu gibi birakilir.
   */
  vt.hazirla("UPDATE kasa_oturumlari SET kullanici_id = ? WHERE kullanici_id = ? AND durum = 'ACIK'").calistir(yeniId, eskiId);
  vt.hazirla('UPDATE askidaki_satislar SET kullanici_id = ? WHERE kullanici_id = ?').calistir(yeniId, eskiId);
  vt.hazirla('UPDATE kullanicilar SET aktif_mi = 0, updated_at = ? WHERE id = ?').calistir(zaman, eskiId);
}

/**
 * Buluttan inen kullaniciyi uygular; kullanici adi cakismasini birlestirerek cozer (§7.4).
 *
 * NEDEN BIRLESTIRME: kurulum sihirbazi kasada bir sahip kullanicisi acar, bu
 * kullanici buluta gidemez. Ayni kullanici adi panelde de acilirsa iki AYRI id
 * ayni adi tasir. `kullanici_adi` UNIQUE oldugu icin pull o satiri yazamaz,
 * TUM pull transaction'i geri alinir ve imlec KALICI olarak takilir - o andan
 * sonra buluttan hicbir sey inmez (ne urun, ne fiyat, ne kategori).
 *
 * Cozumde bulut kazanir; kullanicilar yalniz panelden yonetilir. Yerel kaydin
 * gecmisi SILINMEZ, referanslari bulut kimligine tasinir; boylece satislar,
 * kasa oturumlari ve denetim kayitlari ayni kisiye bagli kalir.
 */
export function kullaniciSunucudanUygula(
  vt: Vt,
  veri: Record<string, unknown>,
  versiyon: number,
): { birlesenYerelId: string | null } {
  const id = String(veri.id ?? '');
  if (!id) return { birlesenYerelId: null };
  const mevcut = vt.hazirla('SELECT updated_at FROM kullanicilar WHERE id = ?').tek<{ updated_at: string }>(id);
  const gelenZaman = String(veri.updated_at ?? '');
  if (mevcut && mevcut.updated_at > gelenZaman) return { birlesenYerelId: null };

  const kullaniciAdi = String(veri.kullanici_adi ?? '');
  const adSahibi = vt
    .hazirla('SELECT id FROM kullanicilar WHERE kullanici_adi = ? AND id <> ?')
    .tek<{ id: string }>(kullaniciAdi, id);

  /*
   * Birlesmede KIMLIK BILGISI KAYBEDILMEZ.
   *
   * Bulut kaydinda sifre ya da PIN bulunmayabilir (panelden yalniz PIN
   * verilmis olabilir). Yerel kayittaki calisan kimlik bilgisi korunmazsa
   * kullanici kendi kasasinda oturum acamaz hale gelir. Bulutta olan varsa o
   * kazanir; yoksa yereldeki devralinir.
   */
  const eskiKimlik = adSahibi
    ? vt
        .hazirla('SELECT pin_hash, sifre_hash FROM kullanicilar WHERE id = ?')
        .tek<{ pin_hash: string | null; sifre_hash: string | null }>(adSahibi.id)
    : undefined;

  // Ad ONCE serbest birakilir: UNIQUE kisit yuzunden asagidaki INSERT aksi
  // halde patlar ve butun partiyi geri alir.
  if (adSahibi) {
    vt.hazirla('UPDATE kullanicilar SET kullanici_adi = ? WHERE id = ?').calistir(
      `${kullaniciAdi}~birlesen~${adSahibi.id.slice(0, 8)}`,
      adSahibi.id,
    );
  }

  vt.hazirla(
    `INSERT INTO kullanicilar (id, ad, kullanici_adi, pin_hash, sifre_hash, rol, ek_yetkiler,
                               kaldirilan_yetkiler, aktif_mi, created_at, updated_at, cihaz_id, sunucu_versiyonu)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       ad = excluded.ad, kullanici_adi = excluded.kullanici_adi,
       pin_hash = COALESCE(excluded.pin_hash, kullanicilar.pin_hash),
       sifre_hash = COALESCE(excluded.sifre_hash, kullanicilar.sifre_hash),
       rol = excluded.rol, ek_yetkiler = excluded.ek_yetkiler,
       kaldirilan_yetkiler = excluded.kaldirilan_yetkiler, aktif_mi = excluded.aktif_mi,
       updated_at = excluded.updated_at, sunucu_versiyonu = excluded.sunucu_versiyonu`,
  ).calistir(
    id,
    String(veri.ad ?? ''),
    String(veri.kullanici_adi ?? ''),
    (veri.pin_hash as string | null) ?? eskiKimlik?.pin_hash ?? null,
    (veri.sifre_hash as string | null) ?? eskiKimlik?.sifre_hash ?? null,
    String(veri.rol ?? 'KASIYER'),
    JSON.stringify(veri.ek_yetkiler ?? []),
    JSON.stringify(veri.kaldirilan_yetkiler ?? []),
    boolToSayi(veri.aktif_mi !== false && veri.aktif_mi !== 0),
    String(veri.created_at ?? gelenZaman),
    gelenZaman,
    (veri.cihaz_id as string | null) ?? null,
    versiyon,
  );

  if (adSahibi) kimligiDevret(vt, adSahibi.id, id, gelenZaman);
  return { birlesenYerelId: adSahibi?.id ?? null };
}
