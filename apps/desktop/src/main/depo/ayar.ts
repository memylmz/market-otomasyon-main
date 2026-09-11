/**
 * Ayar (key-value) repository'si — §10.11.
 *
 * Değerler her zaman metin olarak saklanır; tip dönüşümü okuma tarafında yapılır.
 * Ayar değişiklikleri denetim loguna düşer (servis katmanında).
 */

import { simdi, type ZamanDamgasi } from '@market/shared';
import type { Vt } from '../db/surucu.js';

export interface AyarKaydi {
  anahtar: string;
  deger: string;
  aciklama: string | null;
  updated_at: ZamanDamgasi;
}

export function ayarOku(vt: Vt, anahtar: string): string | null {
  const satir = vt.hazirla('SELECT deger FROM ayarlar WHERE anahtar = ?').tek<{ deger: string }>(anahtar);
  return satir?.deger ?? null;
}

export function ayarYaz(vt: Vt, anahtar: string, deger: string, aciklama?: string | null, zaman = simdi()): void {
  vt.hazirla(
    `INSERT INTO ayarlar (anahtar, deger, aciklama, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(anahtar) DO UPDATE SET
       deger = excluded.deger,
       aciklama = COALESCE(excluded.aciklama, ayarlar.aciklama),
       updated_at = excluded.updated_at`,
  ).calistir(anahtar, deger, aciklama ?? null, zaman);
}

export function tumAyarlar(vt: Vt): Record<string, string> {
  const satirlar = vt.hazirla('SELECT anahtar, deger FROM ayarlar').tumu<{ anahtar: string; deger: string }>();
  const sonuc: Record<string, string> = {};
  for (const s of satirlar) sonuc[s.anahtar] = s.deger;
  return sonuc;
}

export function ayarSil(vt: Vt, anahtar: string): void {
  vt.hazirla('DELETE FROM ayarlar WHERE anahtar = ?').calistir(anahtar);
}

// ---------------------------------------------------------------------------
// Tipli okuma yardımcıları
// ---------------------------------------------------------------------------

export function ayarSayi(vt: Vt, anahtar: string, varsayilan: number): number {
  const ham = ayarOku(vt, anahtar);
  /*
   * BOŞ DEĞER "SIFIR" DEĞİL, "AYARLANMAMIŞ" DEMEKTİR.
   *
   * `Number('')` sıfır verir ve `Number.isFinite(0)` doğrudur; bu yüzden
   * ayarlar ekranında bir alan silinip kaydedildiğinde varsayılan yerine SIFIR
   * okunuyordu. Fiş satır genişliğinde bunun sonucu ağırdır: 0 karakterlik
   * satırla ayırıcı hiç basılmaz, iki sütunlu satırlar bozulur — ve bu ancak
   * kağıda basınca fark edilir.
   */
  if (ham === null || ham.trim() === '') return varsayilan;
  const sayi = Number(ham.replace(',', '.'));
  return Number.isFinite(sayi) ? sayi : varsayilan;
}

export function ayarBool(vt: Vt, anahtar: string, varsayilan: boolean): boolean {
  const ham = ayarOku(vt, anahtar);
  if (ham === null) return varsayilan;
  return ham === '1' || ham.toLowerCase() === 'true' || ham.toLowerCase() === 'evet';
}

export function ayarMetin(vt: Vt, anahtar: string, varsayilan: string): string {
  return ayarOku(vt, anahtar) ?? varsayilan;
}

export function ayarBoolYaz(vt: Vt, anahtar: string, deger: boolean, aciklama?: string): void {
  ayarYaz(vt, anahtar, deger ? '1' : '0', aciklama);
}

export function ayarSayiYaz(vt: Vt, anahtar: string, deger: number, aciklama?: string): void {
  ayarYaz(vt, anahtar, String(deger), aciklama);
}

/** Toplu yazma — kurulum sihirbazı ve senkron pull için. */
export function ayarlariYaz(vt: Vt, degerler: Record<string, string>, zaman = simdi()): void {
  for (const [anahtar, deger] of Object.entries(degerler)) ayarYaz(vt, anahtar, deger, null, zaman);
}
