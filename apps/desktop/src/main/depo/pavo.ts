/**
 * Pavo kayıtları — niyet defteri ve satışların cihazdaki karşılığı (göç 18).
 * Yalnız bu kasaya aittir, buluta gitmez.
 */

import { simdi, type Kurus, type ZamanDamgasi } from '@market/shared';
import type { Vt } from '../db/surucu.js';

export type PavoDefterAsamasi = 'GONDERILIYOR' | 'ONAYLANDI' | 'BASARISIZ';

export interface PavoDefterKaydi {
  siparis_no: string;
  tutar: Kurus;
  ozet: string;
  /** Satış girdisi (JSON) — kurtarmada satış bundan oluşturulur. */
  girdi: string;
  kullanici_id: string | null;
  asama: PavoDefterAsamasi;
  satis_no: string | null;
  satis_id: string | null;
  hata: string | null;
  olusturma: ZamanDamgasi;
  cozulme: ZamanDamgasi | null;
}

export function defterYaz(
  vt: Vt,
  k: Pick<PavoDefterKaydi, 'siparis_no' | 'tutar' | 'ozet' | 'girdi' | 'kullanici_id'>,
  zaman = simdi(),
): void {
  vt.hazirla(
    `INSERT INTO pavo_defteri (siparis_no, tutar, ozet, girdi, kullanici_id, asama, olusturma)
     VALUES (?, ?, ?, ?, ?, 'GONDERILIYOR', ?)`,
  ).calistir(k.siparis_no, k.tutar, k.ozet, k.girdi, k.kullanici_id, zaman);
}

/** Satış numarası cihazdan öğrenilince işlenir — kurtarma onunla da arayabilsin. */
export function defterSatisNo(vt: Vt, siparisNo: string, satisNo: string): void {
  vt.hazirla('UPDATE pavo_defteri SET satis_no = ? WHERE siparis_no = ?').calistir(satisNo, siparisNo);
}

export function defterKapat(
  vt: Vt,
  siparisNo: string,
  asama: Exclude<PavoDefterAsamasi, 'GONDERILIYOR'>,
  ek: { satisId?: string | null; hata?: string | null } = {},
  zaman = simdi(),
): void {
  vt.hazirla(
    `UPDATE pavo_defteri SET asama = ?, satis_id = COALESCE(?, satis_id), hata = ?, cozulme = ?
     WHERE siparis_no = ?`,
  ).calistir(asama, ek.satisId ?? null, ek.hata ?? null, zaman, siparisNo);
}

/** Hata metni güncellenir ama kayıt AÇIK kalır (cihazdan sonuç öğrenilemedi). */
export function defterNotu(vt: Vt, siparisNo: string, hata: string): void {
  vt.hazirla('UPDATE pavo_defteri SET hata = ? WHERE siparis_no = ?').calistir(hata, siparisNo);
}

export function acikDefterKayitlari(vt: Vt): PavoDefterKaydi[] {
  return vt.hazirla(`SELECT * FROM pavo_defteri WHERE asama = 'GONDERILIYOR' ORDER BY olusturma`).tumu<PavoDefterKaydi>();
}

export function defterKaydi(vt: Vt, siparisNo: string): PavoDefterKaydi | null {
  return vt.hazirla('SELECT * FROM pavo_defteri WHERE siparis_no = ?').tek<PavoDefterKaydi>(siparisNo) ?? null;
}

export interface PavoKalemEslesmesi {
  satis_kalemi_id: string;
  pavo_kalem_id: number;
}

export interface PavoSatisKaydi {
  satis_id: string;
  siparis_no: string;
  pavo_id: number;
  satis_no: string;
  fatura_no: string | null;
  sorgu_linki: string | null;
  kalemler: PavoKalemEslesmesi[];
  created_at: ZamanDamgasi;
}

export function pavoSatisiYaz(vt: Vt, k: Omit<PavoSatisKaydi, 'created_at'>, zaman = simdi()): void {
  vt.hazirla(
    `INSERT INTO pavo_satislari (satis_id, siparis_no, pavo_id, satis_no, fatura_no, sorgu_linki, kalemler, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).calistir(k.satis_id, k.siparis_no, k.pavo_id, k.satis_no, k.fatura_no, k.sorgu_linki, JSON.stringify(k.kalemler), zaman);
}

export function pavoSatisiBul(vt: Vt, satisId: string): PavoSatisKaydi | null {
  const satir = vt
    .hazirla('SELECT * FROM pavo_satislari WHERE satis_id = ?')
    .tek<Omit<PavoSatisKaydi, 'kalemler'> & { kalemler: string }>(satisId);
  if (!satir) return null;
  let kalemler: PavoKalemEslesmesi[] = [];
  try {
    kalemler = JSON.parse(satir.kalemler) as PavoKalemEslesmesi[];
  } catch {
    /* bozuk eşleşme: kısmi iade yapılamaz, iptal yine yapılabilir */
  }
  return { ...satir, kalemler };
}
