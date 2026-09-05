/**
 * Şifre ve PIN saklama (§15.1).
 *
 * Blueprint argon2id/bcrypt öneriyor; burada **scrypt** kullanılıyor. Gerekçe:
 * scrypt de bellek-zor (memory-hard) bir KDF'dir, Node'un çekirdeğinde yer alır
 * ve yerel derleme/ek bağımlılık gerektirmez — kasa PC'sinde kurulum kırılganlığını
 * ve tedarik zinciri yüzeyini azaltır. Parametreler OWASP'ın scrypt önerisiyle
 * uyumludur (N=2^15, r=8, p=1).
 *
 * Biçim: `scrypt$N$r$p$<tuz-base64>$<özet-base64>`
 * Sürüm/parametre kaydedildiği için ileride maliyet artırılabilir; eski hash'ler
 * doğrulanmaya devam eder ve `yenilenmeli()` ile kademeli yükseltilir.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const ALGORITMA = 'scrypt';
const N = 32768;
const R = 8;
const P = 1;
const OZET_UZUNLUGU = 32;
const TUZ_UZUNLUGU = 16;
// scrypt bellek gereksinimi ≈ 128 * N * r = 32 MB; Node'un varsayılan sınırı 32 MB'tır.
const AZAMI_BELLEK = 64 * 1024 * 1024;

export const PIN_ASGARI_UZUNLUK = 4;
export const SIFRE_ASGARI_UZUNLUK = 8;

function turet(parola: string, tuz: Buffer, n: number, r: number, p: number): Buffer {
  return scryptSync(parola.normalize('NFKC'), tuz, OZET_UZUNLUGU, { N: n, r, p, maxmem: AZAMI_BELLEK });
}

export function parolaHashle(parola: string): string {
  if (typeof parola !== 'string' || parola.length === 0) throw new Error('Parola boş olamaz');
  const tuz = randomBytes(TUZ_UZUNLUGU);
  const ozet = turet(parola, tuz, N, R, P);
  return [ALGORITMA, N, R, P, tuz.toString('base64'), ozet.toString('base64')].join('$');
}

/**
 * Sabit zamanlı doğrulama. Hash biçimi bozuksa `false` döner (istisna fırlatmaz),
 * böylece bozuk bir kayıt giriş ekranını çökertmez.
 */
export function parolaDogrula(parola: string, saklanan: string | null | undefined): boolean {
  if (!saklanan || typeof parola !== 'string') return false;
  const parcalar = saklanan.split('$');
  if (parcalar.length !== 6 || parcalar[0] !== ALGORITMA) return false;

  const n = Number(parcalar[1]);
  const r = Number(parcalar[2]);
  const p = Number(parcalar[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Saklanan parametrelere sınır koy: bozuk/kötü niyetli bir kayıt belleği tüketmesin.
  if (n < 1024 || n > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  let tuz: Buffer;
  let beklenen: Buffer;
  try {
    tuz = Buffer.from(parcalar[4] as string, 'base64');
    beklenen = Buffer.from(parcalar[5] as string, 'base64');
  } catch {
    return false;
  }
  if (tuz.length === 0 || beklenen.length !== OZET_UZUNLUGU) return false;

  let hesaplanan: Buffer;
  try {
    hesaplanan = turet(parola, tuz, n, r, p);
  } catch {
    return false;
  }
  return timingSafeEqual(hesaplanan, beklenen);
}

/** Hash daha zayıf parametrelerle üretilmişse true — girişte sessizce yenilenir. */
export function yenilenmeli(saklanan: string | null | undefined): boolean {
  if (!saklanan) return false;
  const parcalar = saklanan.split('$');
  if (parcalar.length !== 6 || parcalar[0] !== ALGORITMA) return true;
  return Number(parcalar[1]) < N || Number(parcalar[2]) < R;
}

export interface ParolaGucu {
  gecerli: boolean;
  sorunlar: string[];
}

export function sifreGucunuDenetle(sifre: string): ParolaGucu {
  const sorunlar: string[] = [];
  if (sifre.length < SIFRE_ASGARI_UZUNLUK) sorunlar.push(`Şifre en az ${SIFRE_ASGARI_UZUNLUK} karakter olmalıdır.`);
  if (!/[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(sifre)) sorunlar.push('Şifre en az bir harf içermelidir.');
  if (!/\d/.test(sifre)) sorunlar.push('Şifre en az bir rakam içermelidir.');
  if (/^(.)\1+$/.test(sifre)) sorunlar.push('Şifre tek bir karakterin tekrarı olamaz.');
  return { gecerli: sorunlar.length === 0, sorunlar };
}

const ZAYIF_PINLER = new Set([
  '0000',
  '1111',
  '2222',
  '3333',
  '4444',
  '5555',
  '6666',
  '7777',
  '8888',
  '9999',
  '1234',
  '4321',
  '1212',
  '2580',
  '0123',
  '123456',
  '654321',
  '111111',
  '000000',
]);

export function pinGucunuDenetle(pin: string): ParolaGucu {
  const sorunlar: string[] = [];
  if (!/^\d+$/.test(pin)) sorunlar.push('PIN yalnızca rakamlardan oluşmalıdır.');
  if (pin.length < PIN_ASGARI_UZUNLUK) sorunlar.push(`PIN en az ${PIN_ASGARI_UZUNLUK} haneli olmalıdır.`);
  if (pin.length > 8) sorunlar.push('PIN en fazla 8 haneli olabilir.');
  if (ZAYIF_PINLER.has(pin)) sorunlar.push('Bu PIN çok kolay tahmin edilir, farklı bir PIN seçin.');
  return { gecerli: sorunlar.length === 0, sorunlar };
}

/** Kriptografik olarak güvenli rastgele token (cihaz/oturum anahtarları için). */
export function tokenUret(bayt = 32): string {
  return randomBytes(bayt).toString('base64url');
}
