/**
 * Dosya sistemi yolları.
 *
 * Electron'a bağımlı değildir; kök dizin dışarıdan verilir. Böylece testler
 * geçici bir klasörde aynı yapıyı kurabilir.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface Yollar {
  /** Tüm uygulama verisinin kökü (Electron'da `userData`). */
  kok: string;
  /** Yerel SQLite veritabanı dosyası. */
  vtDosyasi: string;
  yedekKlasoru: string;
  logKlasoru: string;
  disaAktarimKlasoru: string;
  geciciKlasor: string;
  /** Müşteri ekranının logo, görsel ve video dosyaları (cihaza özel, buluta gitmez). */
  medyaKlasoru: string;
}

export function yollariOlustur(kok: string): Yollar {
  return {
    kok,
    vtDosyasi: join(kok, 'veri', 'market.db'),
    yedekKlasoru: join(kok, 'yedekler'),
    logKlasoru: join(kok, 'loglar'),
    disaAktarimKlasoru: join(kok, 'disa-aktarim'),
    geciciKlasor: join(kok, 'gecici'),
    medyaKlasoru: join(kok, 'musteri-ekrani'),
  };
}

/** Gerekli klasörleri oluşturur (varsa dokunmaz). */
export function klasorleriHazirla(yollar: Yollar): void {
  for (const klasor of [
    join(yollar.kok, 'veri'),
    yollar.yedekKlasoru,
    yollar.logKlasoru,
    yollar.disaAktarimKlasoru,
    yollar.geciciKlasor,
    yollar.medyaKlasoru,
  ]) {
    mkdirSync(klasor, { recursive: true });
  }
}
