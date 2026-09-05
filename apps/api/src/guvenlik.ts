/**
 * Sunucu tarafı parola ve token yardımcıları (§15.1).
 *
 * NOT: Masaüstündeki `guvenlik/parola.ts` ile aynı algoritma ve **aynı hash
 * biçimi** kullanılır (`scrypt$N$r$p$tuz$özet`), böylece panelde oluşturulan bir
 * kullanıcı senkronla kasaya inip orada da doğrulanabilir. Kod paylaşılan pakete
 * taşınmadı çünkü `@market/shared` tarayıcıda da yükleniyor ve `node:crypto`
 * bağımlılığı panel/renderer paketlerini kırardı.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const ALGORITMA = 'scrypt';
const N = 32768;
const R = 8;
const P = 1;
const OZET_UZUNLUGU = 32;
const AZAMI_BELLEK = 64 * 1024 * 1024;

export function parolaHashle(parola: string): string {
  const tuz = randomBytes(16);
  const ozet = scryptSync(parola.normalize('NFKC'), tuz, OZET_UZUNLUGU, { N, r: R, p: P, maxmem: AZAMI_BELLEK });
  return [ALGORITMA, N, R, P, tuz.toString('base64'), ozet.toString('base64')].join('$');
}

export function parolaDogrula(parola: string, saklanan: string | null | undefined): boolean {
  if (!saklanan) return false;
  const parcalar = saklanan.split('$');
  if (parcalar.length !== 6 || parcalar[0] !== ALGORITMA) return false;

  const n = Number(parcalar[1]);
  const r = Number(parcalar[2]);
  const p = Number(parcalar[3]);
  if (!Number.isInteger(n) || n < 1024 || n > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  try {
    const tuz = Buffer.from(parcalar[4] as string, 'base64');
    const beklenen = Buffer.from(parcalar[5] as string, 'base64');
    if (beklenen.length !== OZET_UZUNLUGU) return false;
    const hesaplanan = scryptSync(parola.normalize('NFKC'), tuz, OZET_UZUNLUGU, { N: n, r, p, maxmem: AZAMI_BELLEK });
    return timingSafeEqual(hesaplanan, beklenen);
  } catch {
    return false;
  }
}

/** Rastgele, URL güvenli token (cihaz ve refresh tokenları). */
export function tokenUret(bayt = 32): string {
  return randomBytes(bayt).toString('base64url');
}

/**
 * Token'ların veritabanında **hash'i** saklanır: veritabanı sızsa bile tokenlar
 * doğrudan kullanılamaz. Tokenlar yüksek entropili rastgele değerler olduğundan
 * SHA-256 yeterlidir (parolalarda olduğu gibi yavaş KDF gerekmez).
 */
export function tokenHashle(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
