/**
 * Repository katmanı ortak yardımcıları.
 *
 * Veritabanı satırları ile alan adları birebir aynıdır; yalnız tip dönüşümü
 * yapılır (SQLite'ta boolean yoktur → 0/1, JSON yoktur → TEXT).
 */

import { simdi, type ZamanDamgasi } from '@market/shared';
import type { Vt } from '../db/surucu.js';

/**
 * Ham satır tipi: SQLite'ta boolean olmadığı için, domain tipindeki `boolean`
 * alanları `number` (0/1) ile değiştirir.
 *
 * `T & { alan: number }` yazmak işe yaramaz — TypeScript bunu `never`'a indirger,
 * çünkü `boolean` ile `number` kesişimi boştur. Bu yüzden alan önce `Omit` ile
 * çıkarılır, sonra sayı olarak eklenir.
 */
export type HamSatir<T, K extends keyof T> = Omit<T, K> & Record<K, number>;

export function sayiToBool(deger: unknown): boolean {
  return deger === 1 || deger === true || deger === '1';
}

export function boolToSayi(deger: boolean | undefined | null): 0 | 1 {
  return deger ? 1 : 0;
}

export function jsonCoz<T>(ham: unknown, varsayilan: T): T {
  if (typeof ham !== 'string' || ham === '') return varsayilan;
  try {
    return JSON.parse(ham) as T;
  } catch {
    return varsayilan;
  }
}

export interface ZamanAlanlari {
  created_at: ZamanDamgasi;
  updated_at: ZamanDamgasi;
  cihaz_id: string | null;
}

export function zamanAlanlari(cihazId: string, zaman: ZamanDamgasi = simdi()): ZamanAlanlari {
  return { created_at: zaman, updated_at: zaman, cihaz_id: cihazId };
}

/** Keyset sayfalama girdisi. */
export interface SayfaSecenekleri {
  limit?: number;
  ofset?: number;
}

export function limitOfset(secenekler?: SayfaSecenekleri): { limit: number; ofset: number } {
  const limit = Math.min(Math.max(secenekler?.limit ?? 50, 1), 500);
  const ofset = Math.max(secenekler?.ofset ?? 0, 0);
  return { limit, ofset };
}

/**
 * Belge numarası üretir (fiş no, fatura no...). Aynı transaction içinde
 * çağrıldığında yarış koşulu oluşmaz; `UPDATE ... RETURNING` tek atomik adımdır.
 */
export function sonrakiSayac(vt: Vt, ad: string): number {
  vt.hazirla('INSERT OR IGNORE INTO belge_sayaclari (ad, sonraki) VALUES (?, 1)').calistir(ad);
  const satir = vt
    .hazirla('UPDATE belge_sayaclari SET sonraki = sonraki + 1 WHERE ad = ? RETURNING sonraki - 1 AS deger')
    .tek<{ deger: number }>(ad);
  if (!satir) throw new Error(`Sayaç üretilemedi: ${ad}`);
  return satir.deger;
}

/** `IN (?, ?, ?)` yer tutucuları üretir. */
export function yerTutucular(adet: number): string {
  return new Array(adet).fill('?').join(', ');
}

/** SQLite'ın 999 değişken sınırına takılmamak için listeyi parçalara böler. */
export function parcala<T>(liste: readonly T[], parcaBoyu = 400): T[][] {
  const sonuc: T[][] = [];
  for (let i = 0; i < liste.length; i += parcaBoyu) sonuc.push(liste.slice(i, i + parcaBoyu));
  return sonuc;
}
