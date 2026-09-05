/**
 * Dosya şifreleme — yedeklerin durağan halde korunması (§15.5, §18.2).
 *
 * AES-256-GCM: gizlilik + bütünlük birlikte sağlanır. Kurcalanan bir yedek
 * çözme sırasında doğrulama hatası verir, sessizce bozuk veri üretmez.
 *
 * Dosya biçimi:
 *   "MOYED1" (6 bayt sihirli imza) | IV (12 bayt) | GCM etiketi (16 bayt) | şifreli veri
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export const SIFRELI_UZANTI = '.enc';

const IMZA = Buffer.from('MOYED1', 'ascii');
const IV_UZUNLUK = 12;
const ETIKET_UZUNLUK = 16;
const ANAHTAR_UZUNLUK = 32;

/** Parola + tuzdan 256 bitlik anahtar türetir. */
export function anahtarTuret(parola: string, tuz: Buffer): Buffer {
  return scryptSync(parola.normalize('NFKC'), tuz, ANAHTAR_UZUNLUK, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export function rastgeleAnahtar(): Buffer {
  return randomBytes(ANAHTAR_UZUNLUK);
}

export function anahtarGecerliMi(anahtar: Buffer): boolean {
  return Buffer.isBuffer(anahtar) && anahtar.length === ANAHTAR_UZUNLUK;
}

export function sifrele(veri: Buffer, anahtar: Buffer): Buffer {
  if (!anahtarGecerliMi(anahtar)) throw new Error('Şifreleme anahtarı 32 bayt olmalıdır');
  const iv = randomBytes(IV_UZUNLUK);
  const sifreleyici = createCipheriv('aes-256-gcm', anahtar, iv);
  const sifreli = Buffer.concat([sifreleyici.update(veri), sifreleyici.final()]);
  return Buffer.concat([IMZA, iv, sifreleyici.getAuthTag(), sifreli]);
}

export function sifreCoz(paket: Buffer, anahtar: Buffer): Buffer {
  if (!anahtarGecerliMi(anahtar)) throw new Error('Şifreleme anahtarı 32 bayt olmalıdır');
  if (paket.length < IMZA.length + IV_UZUNLUK + ETIKET_UZUNLUK) throw new Error('Şifreli dosya bozuk (çok kısa)');
  if (!paket.subarray(0, IMZA.length).equals(IMZA)) throw new Error('Dosya bu uygulamanın şifreli yedeği değil');

  const iv = paket.subarray(IMZA.length, IMZA.length + IV_UZUNLUK);
  const etiket = paket.subarray(IMZA.length + IV_UZUNLUK, IMZA.length + IV_UZUNLUK + ETIKET_UZUNLUK);
  const govde = paket.subarray(IMZA.length + IV_UZUNLUK + ETIKET_UZUNLUK);

  const cozucu = createDecipheriv('aes-256-gcm', anahtar, iv);
  cozucu.setAuthTag(etiket);
  try {
    return Buffer.concat([cozucu.update(govde), cozucu.final()]);
  } catch {
    // GCM doğrulaması başarısız: yanlış anahtar ya da dosya kurcalanmış.
    throw new Error('Yedek çözülemedi: anahtar yanlış veya dosya bozulmuş.');
  }
}

export function dosyaSifrele(kaynak: string, hedef: string, anahtar: Buffer): void {
  writeFileSync(hedef, sifrele(readFileSync(kaynak), anahtar));
}

export function dosyaSifreCoz(kaynak: string, hedef: string, anahtar: Buffer): void {
  writeFileSync(hedef, sifreCoz(readFileSync(kaynak), anahtar));
}
