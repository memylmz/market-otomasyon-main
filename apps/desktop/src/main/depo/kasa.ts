/**
 * Kasa / vardiya repository'si — §10.8.
 *
 * Beklenen nakit, açılış bakiyesi + nakit etkili hareketlerin toplamıdır;
 * hiçbir yerde saklanmaz, her seferinde hareketlerden hesaplanır.
 */

import { KASA_NAKIT_ETKISI, simdi, uuid, type Kurus, type ZamanDamgasi } from '@market/shared';
import type { Vt } from '../db/surucu.js';
import { olayYaz } from './senkron.js';

export type KasaHareketTipiDb =
  'SATIS_NAKIT' | 'SATIS_KART' | 'TAHSILAT' | 'ODEME' | 'GIDER' | 'GIRIS' | 'CIKIS' | 'IADE_NAKIT' | 'ACILIS';

export interface KasaOturumuKaydi {
  id: string;
  kullanici_id: string;
  kullanici_adi?: string;
  acilis_zamani: ZamanDamgasi;
  acilis_bakiye: Kurus;
  kapanis_zamani: ZamanDamgasi | null;
  sayilan_nakit: Kurus | null;
  beklenen_nakit: Kurus | null;
  kasa_farki: Kurus | null;
  durum: 'ACIK' | 'KAPALI';
  notlar: string | null;
  cihaz_id: string | null;
}

const OTURUM_ALANLARI = `o.id, o.kullanici_id, o.acilis_zamani, o.acilis_bakiye, o.kapanis_zamani,
  o.sayilan_nakit, o.beklenen_nakit, o.kasa_farki, o.durum, o.notlar, o.cihaz_id`;

export function acikOturum(vt: Vt, cihazId: string): KasaOturumuKaydi | null {
  return (
    vt
      .hazirla(
        `SELECT ${OTURUM_ALANLARI}, k.ad AS kullanici_adi
         FROM kasa_oturumlari o LEFT JOIN kullanicilar k ON k.id = o.kullanici_id
         WHERE o.durum = 'ACIK' AND o.cihaz_id = ?
         ORDER BY o.acilis_zamani DESC LIMIT 1`,
      )
      .tek<KasaOturumuKaydi>(cihazId) ?? null
  );
}

export function oturumBul(vt: Vt, id: string): KasaOturumuKaydi | null {
  return (
    vt
      .hazirla(
        `SELECT ${OTURUM_ALANLARI}, k.ad AS kullanici_adi
         FROM kasa_oturumlari o LEFT JOIN kullanicilar k ON k.id = o.kullanici_id WHERE o.id = ?`,
      )
      .tek<KasaOturumuKaydi>(id) ?? null
  );
}

export function oturumAc(
  vt: Vt,
  kullaniciId: string,
  acilisBakiye: Kurus,
  cihazId: string,
  zaman: ZamanDamgasi = simdi(),
): string {
  const id = uuid();
  vt.hazirla(
    `INSERT INTO kasa_oturumlari (id, kullanici_id, acilis_zamani, acilis_bakiye, durum, created_at, updated_at, cihaz_id)
     VALUES (?, ?, ?, ?, 'ACIK', ?, ?, ?)`,
  ).calistir(id, kullaniciId, zaman, acilisBakiye, zaman, zaman, cihazId);

  if (acilisBakiye !== 0) {
    kasaHareketEkle(
      vt,
      { kasa_oturum_id: id, tip: 'ACILIS', tutar: acilisBakiye, aciklama: 'Kasa açılış bakiyesi', kullanici_id: kullaniciId },
      cihazId,
      zaman,
    );
  }
  return id;
}

export function oturumKapat(
  vt: Vt,
  oturumId: string,
  sayilanNakit: Kurus,
  beklenenNakit: Kurus,
  notlar: string | null,
  zaman: ZamanDamgasi = simdi(),
): void {
  vt.hazirla(
    `UPDATE kasa_oturumlari
     SET kapanis_zamani = ?, sayilan_nakit = ?, beklenen_nakit = ?, kasa_farki = ?,
         durum = 'KAPALI', notlar = ?, updated_at = ?
     WHERE id = ? AND durum = 'ACIK'`,
  ).calistir(zaman, sayilanNakit, beklenenNakit, sayilanNakit - beklenenNakit, notlar, zaman, oturumId);
}

export interface KasaHareketiYazma {
  kasa_oturum_id: string;
  tip: KasaHareketTipiDb;
  tutar: Kurus;
  aciklama?: string | null;
  belge_id?: string | null;
  kullanici_id?: string | null;
}

/**
 * Kasa hareketi yazar VE senkron olayını da kendisi yayınlar.
 *
 * Olayı çağırana bırakmak hataya davetiyeydi: bu fonksiyon dört serviste on
 * yerden çağrılıyor ve dokuzunda olay yayınlamak unutulmuştu — kasada 11
 * hareket varken merkezde 0 vardı, panelin vardiya dökümü boş kalıyordu.
 * Hareketle olayı burada ayrılmaz kılıyoruz: para hareketi yazıp senkronu
 * unutmak artık mümkün değil (§7.3).
 */
export function kasaHareketEkle(vt: Vt, hareket: KasaHareketiYazma, cihazId: string, zaman: ZamanDamgasi = simdi()): string {
  const id = uuid();
  vt.hazirla(
    `INSERT INTO kasa_hareketleri (id, kasa_oturum_id, tip, tutar, aciklama, belge_id, kullanici_id,
                                   created_at, updated_at, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).calistir(
    id,
    hareket.kasa_oturum_id,
    hareket.tip,
    hareket.tutar,
    hareket.aciklama ?? null,
    hareket.belge_id ?? null,
    hareket.kullanici_id ?? null,
    zaman,
    zaman,
    cihazId,
  );

  olayYaz(
    vt,
    {
      id: uuid(),
      olay_tipi: 'KASA_HAREKETI',
      entity: 'kasa_hareketi',
      entity_id: id,
      veri: {
        id,
        kasa_oturum_id: hareket.kasa_oturum_id,
        tip: hareket.tip,
        tutar: hareket.tutar,
        aciklama: hareket.aciklama ?? null,
        belge_id: hareket.belge_id ?? null,
        kullanici_id: hareket.kullanici_id ?? null,
        created_at: zaman,
      },
      olusturma_zamani: zaman,
    },
    cihazId,
    zaman,
  );

  return id;
}

export interface KasaHareketiKaydi {
  id: string;
  kasa_oturum_id: string;
  tip: KasaHareketTipiDb;
  tutar: Kurus;
  aciklama: string | null;
  belge_id: string | null;
  kullanici_id: string | null;
  created_at: ZamanDamgasi;
}

export function oturumHareketleri(vt: Vt, oturumId: string, limit = 1000): KasaHareketiKaydi[] {
  return vt
    .hazirla(
      `SELECT id, kasa_oturum_id, tip, tutar, aciklama, belge_id, kullanici_id, created_at
       FROM kasa_hareketleri WHERE kasa_oturum_id = ? ORDER BY created_at, rowid LIMIT ?`,
    )
    .tumu<KasaHareketiKaydi>(oturumId, limit);
}

export interface KasaOzeti {
  acilis_bakiye: Kurus;
  /** Yalnız fiziksel nakdi etkileyen hareketlerin toplamı (kart hariç). */
  nakit_hareket: Kurus;
  beklenen_nakit: Kurus;
  satis_nakit: Kurus;
  satis_kart: Kurus;
  veresiye: Kurus;
  tahsilat: Kurus;
  odeme: Kurus;
  gider: Kurus;
  giris: Kurus;
  cikis: Kurus;
  iade_nakit: Kurus;
  islem_sayisi: number;
}

/**
 * Bir kasa oturumunun özetini hareketlerden hesaplar (gün sonu / Z benzeri özet).
 * Beklenen nakit `ACILIS` hareketi dahil edilmeden, oturumun `acilis_bakiye`
 * alanı üzerine nakit hareketler eklenerek bulunur — çift sayım olmaz.
 */
export function oturumOzeti(vt: Vt, oturumId: string): KasaOzeti {
  const oturum = oturumBul(vt, oturumId);
  const acilis = oturum?.acilis_bakiye ?? 0;

  const satirlar = vt
    .hazirla(
      'SELECT tip, COALESCE(SUM(tutar), 0) AS toplam, COUNT(*) AS adet FROM kasa_hareketleri WHERE kasa_oturum_id = ? GROUP BY tip',
    )
    .tumu<{ tip: KasaHareketTipiDb; toplam: number; adet: number }>(oturumId);

  const topla = (tip: KasaHareketTipiDb) => satirlar.find((s) => s.tip === tip)?.toplam ?? 0;

  let nakitHareket = 0;
  for (const satir of satirlar) {
    // ACILIS hareketi acilis_bakiye ile aynı tutarı temsil eder; iki kez sayma.
    if (satir.tip === 'ACILIS') continue;
    if (KASA_NAKIT_ETKISI[satir.tip]) nakitHareket += satir.toplam;
  }

  // Veresiye kasadan geçmez ama gün sonu raporunda gösterilir.
  const veresiye =
    vt
      .hazirla(
        `SELECT COALESCE(SUM(o.tutar), 0) AS toplam
         FROM odemeler o JOIN satislar s ON s.id = o.satis_id
         WHERE s.kasa_oturum_id = ? AND o.odeme_tipi = 'VERESIYE' AND s.iptal_mi = 0`,
      )
      .tek<{ toplam: number }>(oturumId)?.toplam ?? 0;

  const islemSayisi =
    vt
      .hazirla('SELECT COUNT(*) AS adet FROM satislar WHERE kasa_oturum_id = ? AND iptal_mi = 0 AND iade_mi = 0')
      .tek<{ adet: number }>(oturumId)?.adet ?? 0;

  return {
    acilis_bakiye: acilis,
    nakit_hareket: nakitHareket,
    beklenen_nakit: acilis + nakitHareket,
    satis_nakit: topla('SATIS_NAKIT'),
    satis_kart: topla('SATIS_KART'),
    veresiye,
    tahsilat: topla('TAHSILAT'),
    odeme: topla('ODEME'),
    gider: topla('GIDER'),
    giris: topla('GIRIS'),
    cikis: topla('CIKIS'),
    iade_nakit: topla('IADE_NAKIT'),
    islem_sayisi: islemSayisi,
  };
}

export function oturumlariListele(
  vt: Vt,
  filtre: { kullaniciId?: string; baslangic?: ZamanDamgasi; bitis?: ZamanDamgasi } = {},
  limit = 100,
): KasaOturumuKaydi[] {
  const kosullar: string[] = [];
  const parametreler: unknown[] = [];
  if (filtre.kullaniciId) {
    kosullar.push('o.kullanici_id = ?');
    parametreler.push(filtre.kullaniciId);
  }
  if (filtre.baslangic) {
    kosullar.push('o.acilis_zamani >= ?');
    parametreler.push(filtre.baslangic);
  }
  if (filtre.bitis) {
    kosullar.push('o.acilis_zamani < ?');
    parametreler.push(filtre.bitis);
  }
  const nerede = kosullar.length ? 'WHERE ' + kosullar.join(' AND ') : '';
  return vt
    .hazirla(
      `SELECT ${OTURUM_ALANLARI}, k.ad AS kullanici_adi
       FROM kasa_oturumlari o LEFT JOIN kullanicilar k ON k.id = o.kullanici_id
       ${nerede} ORDER BY o.acilis_zamani DESC LIMIT ?`,
    )
    .tumu<KasaOturumuKaydi>(...parametreler, limit);
}

/** Kapatılmadan bırakılmış eski oturumlar — açılışta uyarı gösterilir (§19.3). */
export function unutulmusOturumlar(vt: Vt, cihazId: string, esikZaman: ZamanDamgasi): KasaOturumuKaydi[] {
  return vt
    .hazirla(
      `SELECT ${OTURUM_ALANLARI}, k.ad AS kullanici_adi
       FROM kasa_oturumlari o LEFT JOIN kullanicilar k ON k.id = o.kullanici_id
       WHERE o.durum = 'ACIK' AND o.cihaz_id = ? AND o.acilis_zamani < ?
       ORDER BY o.acilis_zamani`,
    )
    .tumu<KasaOturumuKaydi>(cihazId, esikZaman);
}
