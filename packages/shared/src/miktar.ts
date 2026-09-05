/**
 * Miktar aritmetiği.
 *
 * Stok miktarı `SUM(stok_hareketleri.miktar)` ile hesaplandığından (§8.1 altın kural)
 * kayan nokta birikimli hatası kabul edilemez: 0.1 + 0.2 !== 0.3 olması, binlerce
 * hareket sonrası stoğu kaydırır. Bu yüzden miktar da **tam sayı** tutulur:
 * bindebir (mili-birim) hassasiyetinde. 1,250 kg → 1250.
 */

import { ONDALIKLI_BIRIMLER, YEREL, type BirimTipi } from './sabitler.js';

/** Bindebir hassasiyetinde tam sayı miktar. 1 adet = 1000, 0,750 kg = 750. */
export type Miktar = number;

/** Bir birimin mili karşılığı. */
export const MIKTAR_OLCEK = 1000;

/** Terazi yok (§13.3) — miktar elle girilir; 3 haneden fazla ondalık anlamsızdır. */
export const MIKTAR_ONDALIK_HANE = 3;

export function miktarMi(deger: unknown): deger is Miktar {
  return typeof deger === 'number' && Number.isSafeInteger(deger);
}

/** Ondalıklı sayıyı mili-birime çevirir: 1.25 → 1250. */
export function miktarOlustur(deger: number): Miktar {
  if (!Number.isFinite(deger)) throw new RangeError('Geçersiz miktar');
  const mili = deger * MIKTAR_OLCEK;
  return mili < 0 ? -Math.round(-mili) : Math.round(mili);
}

/** Mili-birimi ondalıklı sayıya çevirir. Sadece gösterim/dışa aktarma içindir. */
export function miktarToSayi(miktar: Miktar): number {
  return miktar / MIKTAR_OLCEK;
}

/** Bir birim = 1000 mili. Tam sayı adet için kısayol. */
export function adet(sayi: number): Miktar {
  return miktarOlustur(sayi);
}

const miktarBicimleyici = new Intl.NumberFormat(YEREL, {
  minimumFractionDigits: 0,
  maximumFractionDigits: MIKTAR_ONDALIK_HANE,
});

export const BIRIM_KISALTMA: Record<BirimTipi, string> = {
  ADET: 'ad',
  KG: 'kg',
  LT: 'lt',
};

/** "2" (adet) veya "1,250 kg" biçiminde gösterir. */
export function miktarFormat(miktar: Miktar, birim?: BirimTipi, birimGoster = true): string {
  const metin = miktarBicimleyici.format(miktarToSayi(miktar));
  if (!birim || !birimGoster) return metin;
  return `${metin} ${BIRIM_KISALTMA[birim]}`;
}

/** Kullanıcı girdisini mili-birime çevirir; TR virgüllü ve nokta ondalıklı girdi kabul eder. */
export function miktarParse(girdi: string | number | null | undefined): Miktar | null {
  if (girdi === null || girdi === undefined) return null;
  if (typeof girdi === 'number') return Number.isFinite(girdi) ? miktarOlustur(girdi) : null;

  const metin = girdi.trim().replace(/\s/g, '').replace(',', '.');
  if (metin === '' || !/^-?\d*\.?\d*$/.test(metin) || metin === '.' || metin === '-') return null;
  const sayi = Number(metin);
  if (!Number.isFinite(sayi)) return null;
  return miktarOlustur(sayi);
}

/** ADET birimli üründe ondalıklı miktar kabul edilmez. */
export function miktarGecerliMi(miktar: Miktar, birim: BirimTipi): boolean {
  if (!miktarMi(miktar)) return false;
  if (ONDALIKLI_BIRIMLER.includes(birim)) return true;
  return miktar % MIKTAR_OLCEK === 0;
}

/** ADET birimli üründe miktarı en yakın tam birime yuvarlar. */
export function miktarBirimeUyarla(miktar: Miktar, birim: BirimTipi): Miktar {
  if (ONDALIKLI_BIRIMLER.includes(birim)) return miktar;
  const birimSayisi = miktar / MIKTAR_OLCEK;
  const yuvarlanmis = birimSayisi < 0 ? -Math.round(-birimSayisi) : Math.round(birimSayisi);
  return yuvarlanmis * MIKTAR_OLCEK;
}
