/**
 * Ortam yapılandırması.
 *
 * Üretimde JWT gizli anahtarı zorunludur; eksikse sunucu **açılmaz** — varsayılan
 * bir anahtarla çalışmak sessiz bir güvenlik açığıdır (§15.2).
 */

import { z } from 'zod';

const zYapilandirma = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * 3000 DEĞİL: Node dünyasının en kalabalık portudur (Next.js, CRA, Express
   * şablonlarının hepsi oraya kurulur). Aynı makinede başka bir proje 3000'i
   * tutuyorsa — özellikle IPv6'da (`::1`) dinliyorsa — `localhost` çözümlemesi
   * sessizce yanlış uygulamaya gider ve panel "Failed to fetch" der. Çakışması
   * çok daha düşük bir port varsayılan yapıldı.
   */
  PORT: z.coerce.number().int().positive().default(3010),
  HOST: z.string().default('0.0.0.0'),

  /**
   * Veritabanı bağlantısı:
   *  - Turso:  libsql://<db>-<org>.turso.io  (+ DB_AUTH_TOKEN)
   *  - Yerel:  file:./veri/merkez.db
   */
  DB_URL: z.string().default('file:./veri/merkez.db'),
  DB_AUTH_TOKEN: z.string().optional(),

  /**
   * Boş dize TANIMSIZ sayılır: `.env.example` kopyalanınca `JWT_SECRET=`
   * boş kalıyor ve zod'un `min(32)` kontrolü sunucuyu hiç açtırmıyordu.
   * Boşluk, "verilmemiş" ile aynı anlama gelmeli — geliştirmede rastgele
   * anahtara düşer, üretimde aşağıdaki kontrol yine durdurur.
   */
  JWT_SECRET: z
    .string()
    .transform((v) => (v.trim() === '' ? undefined : v))
    .pipe(z.string().min(32).optional())
    .optional(),
  ACCESS_TOKEN_OMRU: z.string().default('15m'),
  REFRESH_TOKEN_OMRU: z.string().default('30d'),

  /** Panelin çalıştığı köken(ler); virgülle ayrılır. */
  CORS_KOKENLER: z.string().default('http://localhost:3100'),

  HIZ_LIMITI_DAKIKA: z.coerce.number().int().positive().default(300),
  LOG_SEVIYESI: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Yeni cihaz aktivasyonlarında verilecek grace süresi (§23.3). */
  LISANS_GRACE_GUN: z.coerce.number().int().nonnegative().default(14),
});

export type Yapilandirma = z.infer<typeof zYapilandirma> & {
  jwtGizli: string;
  corsKokenleri: string[];
  uretimMi: boolean;
};

export function yapilandirmayiOku(ortam: NodeJS.ProcessEnv = process.env): Yapilandirma {
  const ayrisim = zYapilandirma.safeParse(ortam);
  if (!ayrisim.success) {
    const sorunlar = ayrisim.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Ortam değişkenleri geçersiz:\n  ${sorunlar}`);
  }
  const veri = ayrisim.data;
  const uretimMi = veri.NODE_ENV === 'production';

  if (uretimMi && !veri.JWT_SECRET) {
    throw new Error(
      'JWT_SECRET tanımlı değil. Üretimde rastgele bir anahtarla çalışmak, sunucu her yeniden başladığında ' +
        'tüm oturumları geçersiz kılar ve öngörülebilir anahtar riski taşır. En az 32 karakterlik bir değer verin.',
    );
  }

  return {
    ...veri,
    // Geliştirmede anahtar verilmezse süreç ömrü boyunca geçerli rastgele bir anahtar üretilir.
    jwtGizli: veri.JWT_SECRET ?? crypto.randomUUID() + crypto.randomUUID(),
    corsKokenleri: veri.CORS_KOKENLER.split(',')
      .map((k) => k.trim())
      .filter(Boolean),
    uretimMi,
  };
}
