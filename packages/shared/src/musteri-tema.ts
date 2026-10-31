/**
 * Müşteri ekranı teması — karşılama, sepet ve teşekkür ekranının genel görünümü.
 *
 * Hazır temalardan biri seçilir ya da "Özel" ile zemin, yazı ve vurgu
 * renkleri verilir; diğer tonlar (soluk yazı, ince çizgi, seçili satır,
 * vurgunun çerçevesi) bu üçünden hesaplanır. Duyuru ve fiyat kartı
 * slaytlarının kendi renk seçimi ayrıdır ve değişmez.
 *
 * Ana süreç bu değişkenleri yapılandırmayla birlikte gönderir; müşteri
 * penceresi ve Ayarlar'daki önizleme aynı değerleri kullanır.
 */

import { renkKaristir } from './ozel-tema.js';

export const MUSTERI_TEMA_ADLARI = ['SAMPANYA', 'GECE', 'ORMAN', 'BORDO', 'INCI', 'OZEL'] as const;
export type MusteriTemaAdi = (typeof MUSTERI_TEMA_ADLARI)[number];
export type MusteriYaziTipi = 'MODERN' | 'KLASIK' | 'DAR';

export interface MusteriTemasi {
  ad: MusteriTemaAdi;
  zemin: string;
  metin: string;
  vurgu: string;
  yaziTipi: MusteriYaziTipi;
}

export const MUSTERI_HAZIR_TEMALARI: Record<
  Exclude<MusteriTemaAdi, 'OZEL'>,
  { etiket: string; aciklama: string; zemin: string; metin: string; vurgu: string }
> = {
  SAMPANYA: {
    etiket: 'Şampanya',
    aciklama: 'Mürekkep siyahı, altın vurgu',
    zemin: '#0c0d10',
    metin: '#f3efe7',
    vurgu: '#d6b97c',
  },
  GECE: { etiket: 'Gece Mavisi', aciklama: 'Lacivert, buz mavisi', zemin: '#0a1020', metin: '#e8eef8', vurgu: '#9db8e8' },
  ORMAN: { etiket: 'Orman', aciklama: 'Koyu yeşil, adaçayı', zemin: '#0b1411', metin: '#eef3ee', vurgu: '#b5cfa6' },
  BORDO: { etiket: 'Bordo', aciklama: 'Şarap, gül altını', zemin: '#160a0c', metin: '#f5ece9', vurgu: '#e2b39f' },
  INCI: { etiket: 'İnci', aciklama: 'Açık zemin, koyu yazı', zemin: '#f6f5f1', metin: '#1b1d22', vurgu: '#8a6a2e' },
};

/** Yazı tipleri Windows'ta kurulu gelir; müşteri ekranı internetsiz çalışır. */
export const MUSTERI_YAZI_TIPLERI: Record<MusteriYaziTipi, { etiket: string; yigin: string }> = {
  MODERN: { etiket: 'Modern (Segoe UI)', yigin: "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif" },
  KLASIK: { etiket: 'Klasik (Georgia)', yigin: "Georgia, Cambria, 'Times New Roman', serif" },
  DAR: { etiket: 'Dar (Bahnschrift)', yigin: "Bahnschrift, 'Segoe UI', sans-serif" },
};

export const VARSAYILAN_MUSTERI_TEMASI: MusteriTemasi = {
  ad: 'SAMPANYA',
  ...pick(MUSTERI_HAZIR_TEMALARI.SAMPANYA),
  yaziTipi: 'MODERN',
};

function pick(t: { zemin: string; metin: string; vurgu: string }) {
  return { zemin: t.zemin, metin: t.metin, vurgu: t.vurgu };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Kayıtlı JSON'u okur; bozuk ya da eksik alan varsayılana düşer. Hazır temada renkler hazır temanınkidir. */
export function musteriTemasiCoz(ham: string | null | undefined): MusteriTemasi {
  let v: Record<string, unknown> = {};
  try {
    const p = ham ? (JSON.parse(ham) as unknown) : null;
    if (p && typeof p === 'object') v = p as Record<string, unknown>;
  } catch {
    /* bozuk kayıt → varsayılan */
  }
  const ad = (MUSTERI_TEMA_ADLARI as readonly string[]).includes(String(v.ad)) ? (v.ad as MusteriTemaAdi) : 'SAMPANYA';
  const yaziTipi =
    typeof v.yaziTipi === 'string' && v.yaziTipi in MUSTERI_YAZI_TIPLERI ? (v.yaziTipi as MusteriYaziTipi) : 'MODERN';
  if (ad !== 'OZEL') return { ad, ...pick(MUSTERI_HAZIR_TEMALARI[ad]), yaziTipi };
  const d = VARSAYILAN_MUSTERI_TEMASI;
  const renk = (k: 'zemin' | 'metin' | 'vurgu') =>
    typeof v[k] === 'string' && HEX.test(v[k] as string) ? (v[k] as string).toLowerCase() : d[k];
  return { ad, zemin: renk('zemin'), metin: renk('metin'), vurgu: renk('vurgu'), yaziTipi };
}

/** Müşteri ekranının CSS değişkenleri (bkz. musteri.css). */
export function musteriTemaDegiskenleri(t: MusteriTemasi): Record<string, string> {
  return {
    '--m-zemin': t.zemin,
    '--m-ust': renkKaristir(t.zemin, t.metin, 0.035),
    '--m-isik': renkKaristir(t.zemin, t.vurgu, 0.1),
    '--m-cizgi': renkKaristir(t.zemin, t.metin, 0.1),
    '--m-satir': renkKaristir(t.zemin, t.metin, 0.04),
    '--m-metin': t.metin,
    '--m-metin-2': renkKaristir(t.metin, t.zemin, 0.3),
    '--m-metin-3': renkKaristir(t.metin, t.zemin, 0.55),
    '--m-altin': t.vurgu,
    '--m-altin-cizgi': renkKaristir(t.zemin, t.vurgu, 0.42),
    '--m-altin-zemin': renkKaristir(t.zemin, t.vurgu, 0.07),
    '--m-yazi': MUSTERI_YAZI_TIPLERI[t.yaziTipi].yigin,
  };
}
