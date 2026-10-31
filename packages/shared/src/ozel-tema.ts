/**
 * Özel tema — açık ve koyuya ek, yöneticinin kendi seçtiği görünüm.
 *
 * Yönetici yalnız DÖRT ana renk seçer (zemin, kart, yazı, vurgu); arayüzün
 * kullandığı diğer tonlar (ikincil yüzeyler, çizgiler, soluk yazılar, vurgunun
 * yumuşak hâli) bu dördünden hesaplanır. Böylece birbirini tutmayan 20 renk
 * seçmek gerekmez, sonuç her zaman tutarlı olur. Uyarı / hata / bilgi renkleri
 * seçilen tabanın (açık ya da koyu) kendi renkleridir; anlamları değişmesin.
 *
 * Değişkenler Tailwind temasının kullandığı "R G B" kanal biçiminde üretilir
 * (bkz. packages/tema), belgeye satır içi stil olarak yazılır.
 */

export type TemaTabani = 'acik' | 'koyu';
export type YaziTipi = 'segoe' | 'bahnschrift' | 'calibri' | 'verdana' | 'tahoma' | 'arial';
export type KoseBicimi = 'keskin' | 'normal' | 'yuvarlak';

export interface OzelTema {
  taban: TemaTabani;
  /** Sayfa arka planı (#rrggbb). */
  zemin: string;
  /** Kart ve panel yüzeyi. */
  yuzey: string;
  /** Ana yazı rengi. */
  metin: string;
  /** Düğmeler, seçili satır, odak — markanın rengi. */
  vurgu: string;
  /** Yazı ölçeği, yüzde (85–140). Bütün arayüz orantılı büyür/küçülür. */
  yaziOlcegi: number;
  yaziTipi: YaziTipi;
  kose: KoseBicimi;
}

/** Windows'ta kurulu gelen yazı tipleri; kasa internetsiz de çalışmalı. */
export const YAZI_TIPLERI: Record<YaziTipi, { etiket: string; yigin: string }> = {
  segoe: { etiket: 'Segoe UI (varsayılan)', yigin: "'Segoe UI', system-ui, sans-serif" },
  bahnschrift: { etiket: 'Bahnschrift (dar, modern)', yigin: "Bahnschrift, 'Segoe UI', sans-serif" },
  calibri: { etiket: 'Calibri (yumuşak)', yigin: "Calibri, 'Segoe UI', sans-serif" },
  verdana: { etiket: 'Verdana (geniş, en okunaklı)', yigin: "Verdana, 'Segoe UI', sans-serif" },
  tahoma: { etiket: 'Tahoma (sıkışık)', yigin: "Tahoma, 'Segoe UI', sans-serif" },
  arial: { etiket: 'Arial (klasik)', yigin: "Arial, 'Segoe UI', sans-serif" },
};

/** Köşe yarıçapı çarpanı: tema eklentisi ve Tailwind `rounded-*` bununla ölçeklenir. */
export const KOSE_CARPANI: Record<KoseBicimi, number> = { keskin: 0.35, normal: 1, yuvarlak: 1.9 };

export const YAZI_OLCEGI_SINIRI = { en: 85, cok: 140 } as const;

export interface HazirTema {
  ad: string;
  tema: Pick<OzelTema, 'taban' | 'zemin' | 'yuzey' | 'metin' | 'vurgu'>;
}

/** Başlangıç noktaları; seçilen hazır palet sonra renk renk değiştirilebilir. */
export const HAZIR_TEMALAR: readonly HazirTema[] = [
  { ad: 'Okyanus', tema: { taban: 'acik', zemin: '#eef3f7', yuzey: '#ffffff', metin: '#10233a', vurgu: '#0e6ba8' } },
  { ad: 'Orman', tema: { taban: 'acik', zemin: '#eff4f0', yuzey: '#ffffff', metin: '#13241b', vurgu: '#2f6b4f' } },
  { ad: 'Bordo', tema: { taban: 'acik', zemin: '#f6f1f0', yuzey: '#ffffff', metin: '#2a1416', vurgu: '#8e1f2f' } },
  { ad: 'Lavanta', tema: { taban: 'acik', zemin: '#f3f2f9', yuzey: '#ffffff', metin: '#1e1b33', vurgu: '#5b4bc4' } },
  { ad: 'Gece Mavisi', tema: { taban: 'koyu', zemin: '#0b1220', yuzey: '#131c2e', metin: '#e6edf7', vurgu: '#7aa7ff' } },
  { ad: 'Grafit', tema: { taban: 'koyu', zemin: '#141414', yuzey: '#1f1f1f', metin: '#ececec', vurgu: '#e0a43a' } },
];

export const VARSAYILAN_OZEL_TEMA: OzelTema = {
  ...HAZIR_TEMALAR[0]!.tema,
  yaziOlcegi: 100,
  yaziTipi: 'segoe',
  kose: 'normal',
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Kayıtlı JSON'u okur; bozuk ya da eksik alan varsayılana düşer (arayüz asla kırılmaz). */
export function ozelTemaCoz(ham: string | null | undefined): OzelTema {
  let v: Record<string, unknown> = {};
  try {
    const p = ham ? (JSON.parse(ham) as unknown) : null;
    if (p && typeof p === 'object') v = p as Record<string, unknown>;
  } catch {
    /* bozuk kayıt → varsayılan */
  }
  const d = VARSAYILAN_OZEL_TEMA;
  const renk = (k: 'zemin' | 'yuzey' | 'metin' | 'vurgu') =>
    typeof v[k] === 'string' && HEX.test(v[k] as string) ? (v[k] as string).toLowerCase() : d[k];
  const olcek = Number(v.yaziOlcegi);
  return {
    taban: v.taban === 'koyu' ? 'koyu' : 'acik',
    zemin: renk('zemin'),
    yuzey: renk('yuzey'),
    metin: renk('metin'),
    vurgu: renk('vurgu'),
    yaziOlcegi: Number.isFinite(olcek)
      ? Math.min(YAZI_OLCEGI_SINIRI.cok, Math.max(YAZI_OLCEGI_SINIRI.en, Math.round(olcek)))
      : d.yaziOlcegi,
    yaziTipi: typeof v.yaziTipi === 'string' && v.yaziTipi in YAZI_TIPLERI ? (v.yaziTipi as YaziTipi) : d.yaziTipi,
    kose: typeof v.kose === 'string' && v.kose in KOSE_CARPANI ? (v.kose as KoseBicimi) : d.kose,
  };
}

type Rgb = [number, number, number];

function hexRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** a'dan b'ye t oranında karışım (t=0 → a, t=1 → b). */
function karistir(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as Rgb;
}

const kanal = (c: Rgb) => `${c[0]} ${c[1]} ${c[2]}`;

/** İki #rrggbb rengin karışımı (t=0 → a, t=1 → b), #rrggbb olarak. */
export function renkKaristir(hexA: string, hexB: string, t: number): string {
  return `#${karistir(hexRgb(hexA), hexRgb(hexB), t)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** WCAG göreli parlaklık. */
function parlaklik(c: Rgb): number {
  const [r, g, b] = c.map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** İki rengin WCAG kontrast oranı (1–21). Okunur metin için en az 4,5 önerilir. */
export function kontrastOrani(hexA: string, hexB: string): number {
  const a = parlaklik(hexRgb(hexA));
  const b = parlaklik(hexRgb(hexB));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Tema değişkenleri: dört renkten arayüzün bütün nötr ve vurgu tonları.
 * Uyarı/hata/bilgi değişkenleri ÜRETİLMEZ; tabanın kendi değerleri kalır.
 */
export function ozelTemaDegiskenleri(t: OzelTema): Record<string, string> {
  const Z = hexRgb(t.zemin);
  const Y = hexRgb(t.yuzey);
  const M = hexRgb(t.metin);
  const V = hexRgb(t.vurgu);
  const koyu = t.taban === 'koyu';
  const siyah: Rgb = [0, 0, 0];
  return {
    '--zemin': kanal(Z),
    '--yuzey': kanal(Y),
    '--yuzey-2': kanal(karistir(Y, M, koyu ? 0.09 : 0.045)),
    '--yuzey-3': kanal(koyu ? Z : Y),
    '--yuzey-4': kanal(karistir(Y, M, koyu ? 0.18 : 0.11)),
    '--cizgi': kanal(karistir(Y, M, koyu ? 0.16 : 0.12)),
    '--cizgi-kuvvetli': kanal(karistir(Y, M, koyu ? 0.26 : 0.22)),
    '--cizgi-ince': kanal(karistir(Y, M, koyu ? 0.07 : 0.05)),
    '--metin': kanal(M),
    '--metin-2': kanal(karistir(M, Z, 0.22)),
    '--metin-3': kanal(karistir(M, Z, 0.45)),
    '--metin-4': kanal(karistir(M, Z, 0.6)),
    '--vurgu': kanal(V),
    '--vurgu-koyu': kanal(karistir(V, siyah, 0.2)),
    '--vurgu-yumusak': kanal(karistir(Z, V, koyu ? 0.24 : 0.14)),
    // Vurgu zeminli düğmenin yazısı: açık vurguda koyu, koyu vurguda beyaz.
    '--vurgu-uzeri': parlaklik(V) > 0.42 ? kanal(karistir(M, siyah, koyu ? 0.75 : 0)) : '255 255 255',
    '--ortu': kanal(koyu ? karistir(Z, siyah, 0.6) : karistir(M, siyah, 0.3)),
    '--kose': String(KOSE_CARPANI[t.kose]),
  };
}
