/**
 * Müşteri ekranı medya dosyaları — logo, görsel/GIF ve video.
 *
 * Dosyalar `userData/musteri-ekrani/` altında `uuid.uzanti` adıyla durur; adı
 * kullanıcı değil bu modül verir. Müşteri penceresi dosyaları yalnız bu
 * klasörden ve yalnız bu kalıptaki adlarla alabilir (bkz. `medyaYolu`), yani
 * ayara elle yazılmış bir yol veritabanını ya da başka bir dosyayı sunduramaz.
 *
 * Tür, dosya adının uzantısına göre DEĞİL içeriğin ilk baytlarına göre
 * belirlenir: adı `.png` olup içi başka bir şey olan dosya reddedilir.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hatalar, medyaAdiGecerliMi, uuid } from '@market/shared';
import type { Yollar } from '../altyapi/yollar.js';

export type MedyaTuru = 'GORSEL' | 'VIDEO';

const MB = 1024 * 1024;

/** Video sınırı IPC'den tek parça geçtiği için tutuludur; 30 sn'lik 1080p reklam ~15 MB. */
export const MEDYA_SINIRI_BAYT: Record<MedyaTuru, number> = { GORSEL: 15 * MB, VIDEO: 60 * MB };

export const MEDYA_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

function ascii(veri: Uint8Array, bas: number, uzunluk: number): string {
  return String.fromCharCode(...veri.subarray(bas, bas + uzunluk));
}

/** İçeriğe bakarak türü bulur; desteklenmeyen biçimde null. */
export function medyaTuruBul(veri: Uint8Array): { tur: MedyaTuru; uzanti: string } | null {
  if (veri.length < 12) return null;
  if (veri[0] === 0x89 && ascii(veri, 1, 3) === 'PNG') return { tur: 'GORSEL', uzanti: 'png' };
  if (veri[0] === 0xff && veri[1] === 0xd8 && veri[2] === 0xff) return { tur: 'GORSEL', uzanti: 'jpg' };
  if (ascii(veri, 0, 6) === 'GIF87a' || ascii(veri, 0, 6) === 'GIF89a') return { tur: 'GORSEL', uzanti: 'gif' };
  if (ascii(veri, 0, 4) === 'RIFF' && ascii(veri, 8, 4) === 'WEBP') return { tur: 'GORSEL', uzanti: 'webp' };
  if (ascii(veri, 4, 4) === 'ftyp') return { tur: 'VIDEO', uzanti: 'mp4' };
  // EBML başlığı Matroska ailesinin ortak başlığıdır; yalnız "webm" türü kabul edilir.
  if (veri[0] === 0x1a && veri[1] === 0x45 && veri[2] === 0xdf && veri[3] === 0xa3) {
    return ascii(veri, 0, Math.min(veri.length, 64)).includes('webm') ? { tur: 'VIDEO', uzanti: 'webm' } : null;
  }
  return null;
}

/**
 * Yüklenen dosyayı denetleyip kaydeder ve medya adını döndürür.
 * `beklenen` verilirse (logo yalnız görsel olabilir) başka tür reddedilir.
 */
export function medyaKaydet(
  yollar: Yollar,
  veri: Uint8Array,
  beklenen?: MedyaTuru,
): { dosya: string; tur: MedyaTuru; boyut: number } {
  const bulunan = medyaTuruBul(veri);
  if (!bulunan) {
    throw hatalar.dogrulama(
      'Bu dosya biçimi desteklenmiyor. Görsel için PNG, JPG, GIF ya da WEBP; video için MP4 ya da WEBM seçin.',
    );
  }
  if (beklenen && bulunan.tur !== beklenen) {
    throw hatalar.dogrulama(
      beklenen === 'GORSEL' ? 'Burada yalnız görsel kullanılabilir.' : 'Burada yalnız video kullanılabilir.',
    );
  }
  const sinir = MEDYA_SINIRI_BAYT[bulunan.tur];
  if (veri.length > sinir) {
    throw hatalar.dogrulama(
      `Dosya çok büyük (${(veri.length / MB).toFixed(1)} MB). ${bulunan.tur === 'VIDEO' ? 'Video' : 'Görsel'} en fazla ${sinir / MB} MB olabilir.`,
    );
  }

  // Klasör kurulumda açılır; kullanıcı elle silmiş olabilir.
  mkdirSync(yollar.medyaKlasoru, { recursive: true });
  const dosya = `${uuid()}.${bulunan.uzanti}`;
  const hedef = join(yollar.medyaKlasoru, dosya);
  // Önce geçici adla yazılır: yarım kalan yazma müşteri ekranına bozuk dosya vermesin.
  const gecici = `${hedef}.yaziliyor`;
  writeFileSync(gecici, veri);
  renameSync(gecici, hedef);
  return { dosya, tur: bulunan.tur, boyut: veri.length };
}

/** Medya adını diskteki yola çevirir. Ad kalıba uymuyorsa ya da dosya yoksa null. */
export function medyaYolu(yollar: Yollar, ad: string): string | null {
  if (!medyaAdiGecerliMi(ad)) return null;
  const yol = join(yollar.medyaKlasoru, ad);
  try {
    return statSync(yol).isFile() ? yol : null;
  } catch {
    return null;
  }
}

/**
 * Hiçbir ayarın kullanmadığı medya dosyalarını siler (ayar kaydından sonra).
 * Yüklenip kaydedilmeden vazgeçilen dosyalar böyle temizlenir. Silinemeyen
 * dosya (Windows'ta o an oynayan video kilitli olabilir) sonraki kayıtta denenir.
 */
export function yetimMedyalariTemizle(yollar: Yollar, kullanilanlar: Iterable<string>): number {
  if (!existsSync(yollar.medyaKlasoru)) return 0;
  const kullanilan = new Set(kullanilanlar);
  let silinen = 0;
  for (const ad of readdirSync(yollar.medyaKlasoru)) {
    const yetimYazma = ad.endsWith('.yaziliyor');
    if (!yetimYazma && (!medyaAdiGecerliMi(ad) || kullanilan.has(ad))) continue;
    try {
      rmSync(join(yollar.medyaKlasoru, ad), { force: true });
      silinen++;
    } catch {
      /* kilitli — sonraki temizlikte */
    }
  }
  return silinen;
}
