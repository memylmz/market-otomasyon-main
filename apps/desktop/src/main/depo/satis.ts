/**
 * Satış repository'si — yazma tarafı yalnız `satis-servis` üzerinden, tek
 * transaction içinde kullanılır (§10.3 iş kuralı).
 */

import { fisNoSadelestir, simdi, uuid, type Kurus, type Miktar, type ZamanDamgasi } from '@market/shared';
import type { Vt } from '../db/surucu.js';
import { boolToSayi, limitOfset, sayiToBool, type SayfaSecenekleri } from './ortak.js';

export interface SatisKaydi {
  id: string;
  fis_no: string;
  tarih: ZamanDamgasi;
  kullanici_id: string | null;
  kullanici_adi?: string | null;
  kasa_oturum_id: string | null;
  ara_toplam: Kurus;
  iskonto_toplam: Kurus;
  kdv_toplam: Kurus;
  genel_toplam: Kurus;
  odeme_ozeti: 'NAKIT' | 'KART' | 'VERESIYE' | 'PARCALI';
  musteri_id: string | null;
  musteri_adi?: string | null;
  iptal_mi: boolean;
  iptal_neden: string | null;
  iptal_zamani: ZamanDamgasi | null;
  iade_mi: boolean;
  kaynak_satis_id: string | null;
  fis_yazdirildi: boolean;
  notlar: string | null;
  cihaz_id: string | null;
}

export interface SatisKalemiKaydi {
  id: string;
  satis_id: string;
  urun_id: string;
  urun_adi: string;
  barkod: string | null;
  miktar: Miktar;
  birim_tipi: string;
  birim_fiyat: Kurus;
  birim_maliyet: Kurus;
  iskonto: Kurus;
  kdv_orani: number;
  kdv_tutar: Kurus;
  satir_toplam: Kurus;
  kampanya_id: string | null;
  sira: number;
  /** Bu kalemden daha önce iade edilmiş toplam miktar (iade ekranı için). */
  iade_edilen?: Miktar;
}

export interface OdemeKaydi {
  id: string;
  satis_id: string;
  odeme_tipi: 'NAKIT' | 'KART' | 'VERESIYE';
  tutar: Kurus;
  alinan: Kurus;
  para_ustu: Kurus;
}

export interface SatisDetayi {
  satis: SatisKaydi;
  kalemler: SatisKalemiKaydi[];
  odemeler: OdemeKaydi[];
}

const SATIS_ALANLARI = `s.id, s.fis_no, s.tarih, s.kullanici_id, s.kasa_oturum_id, s.ara_toplam,
  s.iskonto_toplam, s.kdv_toplam, s.genel_toplam, s.odeme_ozeti, s.musteri_id, s.iptal_mi,
  s.iptal_neden, s.iptal_zamani, s.iade_mi, s.kaynak_satis_id, s.fis_yazdirildi, s.notlar, s.cihaz_id`;

type HamSatis = Omit<SatisKaydi, 'iptal_mi' | 'iade_mi' | 'fis_yazdirildi'> & {
  iptal_mi: number;
  iade_mi: number;
  fis_yazdirildi: number;
};

function satisCoz(satir: HamSatis): SatisKaydi {
  return {
    ...satir,
    iptal_mi: sayiToBool(satir.iptal_mi),
    iade_mi: sayiToBool(satir.iade_mi),
    fis_yazdirildi: sayiToBool(satir.fis_yazdirildi),
  };
}

// ---------------------------------------------------------------------------
// Yazma
// ---------------------------------------------------------------------------

export interface SatisYazma {
  id: string;
  fis_no: string;
  tarih: ZamanDamgasi;
  kullanici_id: string | null;
  kasa_oturum_id: string | null;
  ara_toplam: Kurus;
  iskonto_toplam: Kurus;
  kdv_toplam: Kurus;
  genel_toplam: Kurus;
  odeme_ozeti: 'NAKIT' | 'KART' | 'VERESIYE' | 'PARCALI';
  musteri_id: string | null;
  iade_mi?: boolean;
  kaynak_satis_id?: string | null;
  notlar?: string | null;
}

export function satisEkle(vt: Vt, satis: SatisYazma, cihazId: string, zaman = simdi()): void {
  vt.hazirla(
    `INSERT INTO satislar (id, fis_no, tarih, kullanici_id, kasa_oturum_id, ara_toplam, iskonto_toplam,
                           kdv_toplam, genel_toplam, odeme_ozeti, musteri_id, iade_mi, kaynak_satis_id,
                           notlar, created_at, updated_at, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).calistir(
    satis.id,
    satis.fis_no,
    satis.tarih,
    satis.kullanici_id,
    satis.kasa_oturum_id,
    satis.ara_toplam,
    satis.iskonto_toplam,
    satis.kdv_toplam,
    satis.genel_toplam,
    satis.odeme_ozeti,
    satis.musteri_id,
    boolToSayi(satis.iade_mi ?? false),
    satis.kaynak_satis_id ?? null,
    satis.notlar ?? null,
    zaman,
    zaman,
    cihazId,
  );
}

export function kalemEkle(
  vt: Vt,
  kalem: Omit<SatisKalemiKaydi, 'id' | 'iade_edilen'> & { id?: string },
  cihazId: string,
  zaman = simdi(),
): string {
  const id = kalem.id ?? uuid();
  vt.hazirla(
    `INSERT INTO satis_kalemleri (id, satis_id, urun_id, urun_adi, barkod, miktar, birim_tipi, birim_fiyat,
                                  birim_maliyet, iskonto, kdv_orani, kdv_tutar, satir_toplam, kampanya_id,
                                  sira, created_at, updated_at, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).calistir(
    id,
    kalem.satis_id,
    kalem.urun_id,
    kalem.urun_adi,
    kalem.barkod,
    kalem.miktar,
    kalem.birim_tipi,
    kalem.birim_fiyat,
    kalem.birim_maliyet,
    kalem.iskonto,
    kalem.kdv_orani,
    kalem.kdv_tutar,
    kalem.satir_toplam,
    kalem.kampanya_id,
    kalem.sira,
    zaman,
    zaman,
    cihazId,
  );
  return id;
}

export function odemeEkle(vt: Vt, odeme: Omit<OdemeKaydi, 'id'> & { id?: string }, cihazId: string, zaman = simdi()): string {
  const id = odeme.id ?? uuid();
  vt.hazirla(
    `INSERT INTO odemeler (id, satis_id, odeme_tipi, tutar, alinan, para_ustu, created_at, updated_at, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).calistir(id, odeme.satis_id, odeme.odeme_tipi, odeme.tutar, odeme.alinan, odeme.para_ustu, zaman, zaman, cihazId);
  return id;
}

export function satisIptalEt(vt: Vt, satisId: string, neden: string, zaman = simdi()): number {
  return vt
    .hazirla('UPDATE satislar SET iptal_mi = 1, iptal_neden = ?, iptal_zamani = ?, updated_at = ? WHERE id = ? AND iptal_mi = 0')
    .calistir(neden, zaman, zaman, satisId).changes;
}

export function fisYazdirildiIsaretle(vt: Vt, satisId: string, yazdirildi = true, zaman = simdi()): void {
  vt.hazirla('UPDATE satislar SET fis_yazdirildi = ?, updated_at = ? WHERE id = ?').calistir(
    boolToSayi(yazdirildi),
    zaman,
    satisId,
  );
}

// ---------------------------------------------------------------------------
// Okuma
// ---------------------------------------------------------------------------

export function satisBul(vt: Vt, id: string): SatisKaydi | null {
  const satir = vt
    .hazirla(
      `SELECT ${SATIS_ALANLARI}, k.ad AS kullanici_adi, c.ad_unvan AS musteri_adi
       FROM satislar s LEFT JOIN kullanicilar k ON k.id = s.kullanici_id
       LEFT JOIN cariler c ON c.id = s.musteri_id WHERE s.id = ?`,
    )
    .tek<HamSatis>(id);
  return satir ? satisCoz(satir) : null;
}

export function fisNoIleBul(vt: Vt, fisNo: string): SatisKaydi | null {
  const satir = vt
    .hazirla(
      `SELECT ${SATIS_ALANLARI}, k.ad AS kullanici_adi, c.ad_unvan AS musteri_adi
       FROM satislar s LEFT JOIN kullanicilar k ON k.id = s.kullanici_id
       LEFT JOIN cariler c ON c.id = s.musteri_id
       WHERE s.fis_no = ? ORDER BY s.tarih DESC LIMIT 1`,
    )
    .tek<HamSatis>(fisNo);
  return satir ? satisCoz(satir) : null;
}

export function kalemleriGetir(vt: Vt, satisId: string): SatisKalemiKaydi[] {
  return vt
    .hazirla(
      `SELECT k.id, k.satis_id, k.urun_id, k.urun_adi, k.barkod, k.miktar, k.birim_tipi, k.birim_fiyat,
              k.birim_maliyet, k.iskonto, k.kdv_orani, k.kdv_tutar, k.satir_toplam, k.kampanya_id, k.sira,
              COALESCE((
                SELECT SUM(ik.miktar) FROM satis_kalemleri ik
                JOIN satislar isa ON isa.id = ik.satis_id
                WHERE isa.kaynak_satis_id = k.satis_id AND isa.iptal_mi = 0 AND ik.urun_id = k.urun_id
              ), 0) AS iade_edilen
       FROM satis_kalemleri k WHERE k.satis_id = ? ORDER BY k.sira, k.rowid`,
    )
    .tumu<SatisKalemiKaydi>(satisId);
}

export function odemeleriGetir(vt: Vt, satisId: string): OdemeKaydi[] {
  return vt
    .hazirla('SELECT id, satis_id, odeme_tipi, tutar, alinan, para_ustu FROM odemeler WHERE satis_id = ? ORDER BY rowid')
    .tumu<OdemeKaydi>(satisId);
}

export function satisDetayi(vt: Vt, satisId: string): SatisDetayi | null {
  const satis = satisBul(vt, satisId);
  if (!satis) return null;
  return { satis, kalemler: kalemleriGetir(vt, satisId), odemeler: odemeleriGetir(vt, satisId) };
}

export interface SatisFiltresi {
  baslangic?: ZamanDamgasi;
  bitis?: ZamanDamgasi;
  kullaniciId?: string;
  musteriId?: string;
  kasaOturumId?: string;
  fisNo?: string;
  sadeceIptal?: boolean;
  sadeceIade?: boolean;
  iptalleriGizle?: boolean;
}

export function satislariListele(
  vt: Vt,
  filtre: SatisFiltresi = {},
  sayfa?: SayfaSecenekleri,
): { kayitlar: SatisKaydi[]; toplam: number } {
  const kosullar: string[] = [];
  const parametreler: unknown[] = [];
  if (filtre.baslangic) {
    kosullar.push('s.tarih >= ?');
    parametreler.push(filtre.baslangic);
  }
  if (filtre.bitis) {
    kosullar.push('s.tarih < ?');
    parametreler.push(filtre.bitis);
  }
  if (filtre.kullaniciId) {
    kosullar.push('s.kullanici_id = ?');
    parametreler.push(filtre.kullaniciId);
  }
  if (filtre.musteriId) {
    kosullar.push('s.musteri_id = ?');
    parametreler.push(filtre.musteriId);
  }
  if (filtre.kasaOturumId) {
    kosullar.push('s.kasa_oturum_id = ?');
    parametreler.push(filtre.kasaOturumId);
  }
  if (filtre.fisNo) {
    // Ayraçları yok sayarak eşleştir: okuyucu klavye düzeni yüzünden "A-000512"
    // yerine "A*000512" gönderebilir (bkz. fisNoSadelestir). Kullanıcının elle
    // yazdığı boşluk/tire farkları da böylece sorun çıkarmaz.
    kosullar.push(`REPLACE(REPLACE(REPLACE(UPPER(s.fis_no), '-', ''), '*', ''), ' ', '') LIKE ?`);
    parametreler.push(`%${fisNoSadelestir(filtre.fisNo)}%`);
  }
  if (filtre.sadeceIptal) kosullar.push('s.iptal_mi = 1');
  if (filtre.iptalleriGizle) kosullar.push('s.iptal_mi = 0');
  if (filtre.sadeceIade) kosullar.push('s.iade_mi = 1');

  const nerede = kosullar.length ? 'WHERE ' + kosullar.join(' AND ') : '';
  const { limit, ofset } = limitOfset(sayfa);

  const satirlar = vt
    .hazirla(
      `SELECT ${SATIS_ALANLARI}, k.ad AS kullanici_adi, c.ad_unvan AS musteri_adi
       FROM satislar s LEFT JOIN kullanicilar k ON k.id = s.kullanici_id
       LEFT JOIN cariler c ON c.id = s.musteri_id
       ${nerede} ORDER BY s.tarih DESC, s.rowid DESC LIMIT ? OFFSET ?`,
    )
    .tumu<HamSatis>(...parametreler, limit, ofset);

  const sayim = vt.hazirla(`SELECT COUNT(*) AS adet FROM satislar s ${nerede}`).tek<{ adet: number }>(...parametreler);
  return { kayitlar: satirlar.map(satisCoz), toplam: sayim?.adet ?? 0 };
}

/** Bir ürünün son satış fiyatı — hızlı fiyat sorgulama ve iade için. */
export function sonSatisFiyati(vt: Vt, urunId: string): Kurus | null {
  const satir = vt
    .hazirla('SELECT birim_fiyat FROM satis_kalemleri WHERE urun_id = ? ORDER BY rowid DESC LIMIT 1')
    .tek<{ birim_fiyat: number }>(urunId);
  return satir?.birim_fiyat ?? null;
}

// ---------------------------------------------------------------------------
// Askıya alınan satışlar (§10.3 Park/Hold)
// ---------------------------------------------------------------------------

export interface AskidakiKaydi {
  id: string;
  etiket: string;
  kullanici_id: string | null;
  veri: string;
  created_at: ZamanDamgasi;
}

export function askiyaAl(
  vt: Vt,
  etiket: string,
  veri: unknown,
  kullaniciId: string | null,
  cihazId: string,
  zaman = simdi(),
): string {
  const id = uuid();
  vt.hazirla(
    `INSERT INTO askidaki_satislar (id, etiket, kullanici_id, veri, created_at, updated_at, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).calistir(id, etiket, kullaniciId, JSON.stringify(veri), zaman, zaman, cihazId);
  return id;
}

/** Oturum anlık görüntüsünün sabit etiketi. */
export const SEPET_ETIKETI = '__oturum_sepetleri__';

/**
 * Açık sepetleri diske yazar (§10.3).
 *
 * Sepet sekmeleri yalnız BELLEKTE tutuluyordu: elektrik kesintisi ya da
 * çökmede kasiyerin bekleyen üç sepeti birden kayboluyordu. Eskiden bunu
 * karşılayan kalıcı "askıya alma" tablosu duruyordu ama artık kullanılmıyordu.
 *
 * Kullanıcı başına TEK satır tutulur: bu bir geçmiş kaydı değil, kurtarma
 * noktasıdır; her yazımda öncekinin yerini alır.
 */
export function sepetleriSakla(vt: Vt, kullaniciId: string, veri: unknown, cihazId: string, zaman = simdi()): void {
  vt.islem(() => {
    vt.hazirla('DELETE FROM askidaki_satislar WHERE etiket = ? AND kullanici_id = ?').calistir(SEPET_ETIKETI, kullaniciId);
    vt.hazirla(
      `INSERT INTO askidaki_satislar (id, etiket, kullanici_id, veri, created_at, updated_at, cihaz_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).calistir(uuid(), SEPET_ETIKETI, kullaniciId, JSON.stringify(veri), zaman, zaman, cihazId);
  });
}

/** Kurtarma noktasını okur; yoksa null. */
export function sepetleriOku(vt: Vt, kullaniciId: string): unknown {
  const satir = vt
    .hazirla('SELECT veri FROM askidaki_satislar WHERE etiket = ? AND kullanici_id = ? LIMIT 1')
    .tek<{ veri: string }>(SEPET_ETIKETI, kullaniciId);
  if (!satir) return null;
  try {
    return JSON.parse(satir.veri);
  } catch {
    return null;
  }
}

/** Kurtarma noktasını siler (satış tamamlandı ya da sepetler boşaldı). */
export function sepetleriUnut(vt: Vt, kullaniciId: string): void {
  vt.hazirla('DELETE FROM askidaki_satislar WHERE etiket = ? AND kullanici_id = ?').calistir(SEPET_ETIKETI, kullaniciId);
}

export function askidakileriListele(vt: Vt): AskidakiKaydi[] {
  return vt
    .hazirla('SELECT id, etiket, kullanici_id, veri, created_at FROM askidaki_satislar ORDER BY created_at DESC LIMIT 50')
    .tumu<AskidakiKaydi>();
}

export function askidakiSil(vt: Vt, id: string): void {
  vt.hazirla('DELETE FROM askidaki_satislar WHERE id = ?').calistir(id);
}

// ---------------------------------------------------------------------------
// Alış faturaları (mal kabul)
// ---------------------------------------------------------------------------

export interface AlisFaturasiKaydi {
  id: string;
  tedarikci_id: string;
  tedarikci_adi?: string;
  fatura_no: string | null;
  tarih: ZamanDamgasi;
  ara_toplam: Kurus;
  kdv_toplam: Kurus;
  genel_toplam: Kurus;
  durum: 'TASLAK' | 'ONAYLANDI' | 'IPTAL';
  vade_tarihi: string | null;
  notlar: string | null;
  kullanici_id: string | null;
}

export function alisFaturasiEkle(vt: Vt, fatura: AlisFaturasiKaydi, cihazId: string, zaman = simdi()): void {
  vt.hazirla(
    `INSERT INTO alis_faturalari (id, tedarikci_id, fatura_no, tarih, ara_toplam, kdv_toplam, genel_toplam,
                                  durum, vade_tarihi, notlar, kullanici_id, created_at, updated_at, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).calistir(
    fatura.id,
    fatura.tedarikci_id,
    fatura.fatura_no,
    fatura.tarih,
    fatura.ara_toplam,
    fatura.kdv_toplam,
    fatura.genel_toplam,
    fatura.durum,
    fatura.vade_tarihi,
    fatura.notlar,
    fatura.kullanici_id,
    zaman,
    zaman,
    cihazId,
  );
}

export function alisKalemiEkle(
  vt: Vt,
  kalem: {
    id?: string;
    alis_faturasi_id: string;
    urun_id: string;
    miktar: Miktar;
    birim_fiyat: Kurus;
    kdv_orani: number;
    satir_toplam: Kurus;
    skt: string | null;
    lot_no: string | null;
  },
  cihazId: string,
  zaman = simdi(),
): string {
  const id = kalem.id ?? uuid();
  vt.hazirla(
    `INSERT INTO alis_kalemleri (id, alis_faturasi_id, urun_id, miktar, birim_fiyat, kdv_orani, satir_toplam,
                                 skt, lot_no, created_at, updated_at, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).calistir(
    id,
    kalem.alis_faturasi_id,
    kalem.urun_id,
    kalem.miktar,
    kalem.birim_fiyat,
    kalem.kdv_orani,
    kalem.satir_toplam,
    kalem.skt,
    kalem.lot_no,
    zaman,
    zaman,
    cihazId,
  );
  return id;
}

export function alisFaturalariniListele(vt: Vt, tedarikciId?: string, limit = 100): AlisFaturasiKaydi[] {
  const nerede = tedarikciId ? 'WHERE f.tedarikci_id = ?' : '';
  const parametreler = tedarikciId ? [tedarikciId] : [];
  return vt
    .hazirla(
      `SELECT f.id, f.tedarikci_id, f.fatura_no, f.tarih, f.ara_toplam, f.kdv_toplam, f.genel_toplam,
              f.durum, f.vade_tarihi, f.notlar, f.kullanici_id, c.ad_unvan AS tedarikci_adi
       FROM alis_faturalari f JOIN cariler c ON c.id = f.tedarikci_id
       ${nerede} ORDER BY f.tarih DESC LIMIT ?`,
    )
    .tumu<AlisFaturasiKaydi>(...parametreler, limit);
}
