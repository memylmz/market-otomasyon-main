/**
 * POS işlem günlüğü — cihaza giden her istek ve sonucu (yalnız bu kasada).
 *
 * Satış/iade kaydından BAĞIMSIZ yazılır: çekim onaylanıp satış kaydedilemese,
 * ya da cihaz yanıt vermese de iz kalır. Gün sonu POS slibiyle karşılaştırma
 * ve "müşterinin kartından para çekildi mi?" sorusu buradan cevaplanır.
 */

import { simdi, uuid, type Kurus, type ZamanDamgasi } from '@market/shared';
import type { Vt } from '../db/surucu.js';

export type PosIslemTuru = 'SATIS' | 'IADE' | 'GERI_ALMA';
export type PosIslemDurumu = 'ONAY' | 'RED' | 'ZAMAN_ASIMI' | 'HATA';

export interface PosGunlukSatiri {
  id: string;
  zaman: ZamanDamgasi;
  tur: PosIslemTuru;
  tutar: Kurus;
  sonuc: PosIslemDurumu;
  onay_kodu: string | null;
  referans: string | null;
  kart: string | null;
  hata: string | null;
  orijinal_referans: string | null;
  belge_id: string | null;
  belge_tipi: string | null;
  kullanici_id: string | null;
  kullanici_adi?: string | null;
}

export function posGunlukYaz(
  vt: Vt,
  satir: Omit<PosGunlukSatiri, 'id' | 'zaman' | 'kullanici_adi'>,
  cihazId: string,
  zaman = simdi(),
): string {
  const id = uuid();
  vt.hazirla(
    `INSERT INTO pos_islemleri (id, zaman, tur, tutar, sonuc, onay_kodu, referans, kart, hata,
                                orijinal_referans, belge_id, belge_tipi, kullanici_id, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).calistir(
    id,
    zaman,
    satir.tur,
    satir.tutar,
    satir.sonuc,
    satir.onay_kodu,
    satir.referans,
    satir.kart,
    satir.hata,
    satir.orijinal_referans,
    satir.belge_id,
    satir.belge_tipi,
    satir.kullanici_id,
    cihazId,
  );
  return id;
}

/** Onaylanan çekim kaydedildikten sonra hangi belgeye ait olduğu işlenir. */
export function posGunlukBelgeBagla(vt: Vt, id: string, belgeId: string, belgeTipi: string): void {
  vt.hazirla('UPDATE pos_islemleri SET belge_id = ?, belge_tipi = ? WHERE id = ?').calistir(belgeId, belgeTipi, id);
}

export function posGunlukListele(vt: Vt, filtre: { baslangic?: string; bitis?: string; limit?: number } = {}): PosGunlukSatiri[] {
  return vt
    .hazirla(
      `SELECT p.id, p.zaman, p.tur, p.tutar, p.sonuc, p.onay_kodu, p.referans, p.kart, p.hata,
              p.orijinal_referans, p.belge_id, p.belge_tipi, p.kullanici_id, k.ad AS kullanici_adi
       FROM pos_islemleri p LEFT JOIN kullanicilar k ON k.id = p.kullanici_id
       WHERE (? IS NULL OR p.zaman >= ?) AND (? IS NULL OR p.zaman < ?)
       ORDER BY p.zaman DESC LIMIT ?`,
    )
    .tumu<PosGunlukSatiri>(
      filtre.baslangic ?? null,
      filtre.baslangic ?? null,
      filtre.bitis ?? null,
      filtre.bitis ?? null,
      filtre.limit ?? 200,
    );
}
