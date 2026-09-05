/**
 * Zaman yönetimi.
 *
 * KURAL (§7.7): Tüm zaman damgaları **UTC** saklanır (ISO 8601, "Z" ekli),
 * kullanıcıya **Europe/Istanbul** yerelinde gösterilir. Gün sonu / günlük özet
 * gibi işlemlerde "gün" kavramı her zaman yerel takvim gününe göre belirlenir.
 */

import { YEREL, ZAMAN_DILIMI } from './sabitler.js';

/** UTC ISO 8601 zaman damgası, milisaniye hassasiyetinde: "2026-07-31T17:14:05.123Z" */
export type ZamanDamgasi = string;

/** Yerel takvim günü anahtarı: "2026-07-31" */
export type GunAnahtari = string;

export function simdi(): ZamanDamgasi {
  return new Date().toISOString();
}

export function zamanDamgasiMi(deger: unknown): deger is ZamanDamgasi {
  return typeof deger === 'string' && !Number.isNaN(Date.parse(deger));
}

/** Girdiyi normalize edilmiş UTC ISO damgasına çevirir. */
export function utcNormalize(deger: string | number | Date): ZamanDamgasi {
  const t = deger instanceof Date ? deger : new Date(deger);
  if (Number.isNaN(t.getTime())) throw new RangeError('Geçersiz tarih: ' + String(deger));
  return t.toISOString();
}

const gunBicimleyici = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZAMAN_DILIMI,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** UTC damgasından yerel (Europe/Istanbul) takvim gününü verir: "2026-07-31". */
export function gunAnahtari(zaman: ZamanDamgasi | Date = simdi()): GunAnahtari {
  const t = zaman instanceof Date ? zaman : new Date(zaman);
  // en-CA yereli YYYY-MM-DD üretir; yaz saati/ofset değişimlerini Intl çözer.
  return gunBicimleyici.format(t);
}

/** Verilen yerel günün, o zaman dilimindeki UTC ofsetini dakika olarak döner (TR: +180). */
function ofsetDakika(t: Date): number {
  const parcalar = new Intl.DateTimeFormat('en-US', {
    timeZone: ZAMAN_DILIMI,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(t);

  const al = (tip: string) => Number(parcalar.find((p) => p.type === tip)?.value ?? '0');
  const yerelUtcMs = Date.UTC(al('year'), al('month') - 1, al('day'), al('hour') % 24, al('minute'), al('second'));
  return Math.round((yerelUtcMs - t.getTime()) / 60000);
}

/**
 * Yerel takvim gününün başlangıcını UTC damgası olarak verir.
 * "2026-07-31" → "2026-07-30T21:00:00.000Z" (TR = UTC+3)
 */
export function gunBasi(gun: GunAnahtari): ZamanDamgasi {
  const [yil, ay, gunNo] = gun.split('-').map(Number);
  if (!yil || !ay || !gunNo) throw new RangeError('Geçersiz gün: ' + gun);
  const yaklasik = new Date(Date.UTC(yil, ay - 1, gunNo, 0, 0, 0));
  // İki adımda düzelt: ofset gün sınırında değişebilir (DST geçişi).
  const ilkOfset = ofsetDakika(yaklasik);
  const aday = new Date(yaklasik.getTime() - ilkOfset * 60000);
  const ikinciOfset = ofsetDakika(aday);
  return new Date(yaklasik.getTime() - ikinciOfset * 60000).toISOString();
}

/** Yerel takvim gününün bitişi (dahil değil): ertesi günün başlangıcı. */
export function gunSonu(gun: GunAnahtari): ZamanDamgasi {
  return gunBasi(gunEkle(gun, 1));
}

/** Gün anahtarına gün ekler/çıkarır: ("2026-07-31", 1) → "2026-08-01" */
export function gunEkle(gun: GunAnahtari, adet: number): GunAnahtari {
  const [yil, ay, gunNo] = gun.split('-').map(Number);
  if (!yil || !ay || !gunNo) throw new RangeError('Geçersiz gün: ' + gun);
  const t = new Date(Date.UTC(yil, ay - 1, gunNo + adet));
  return t.toISOString().slice(0, 10);
}

/** İki gün arasındaki fark (gün sayısı). */
export function gunFarki(baslangic: GunAnahtari, bitis: GunAnahtari): number {
  const a = Date.parse(baslangic + 'T00:00:00Z');
  const b = Date.parse(bitis + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

/** Kapsayıcı gün aralığı üretir. */
export function gunAraligi(baslangic: GunAnahtari, bitis: GunAnahtari): GunAnahtari[] {
  const sonuc: GunAnahtari[] = [];
  const adet = gunFarki(baslangic, bitis);
  for (let i = 0; i <= adet; i++) sonuc.push(gunEkle(baslangic, i));
  return sonuc;
}

const tarihSaatBicimleyici = new Intl.DateTimeFormat(YEREL, {
  timeZone: ZAMAN_DILIMI,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const tarihBicimleyici = new Intl.DateTimeFormat(YEREL, {
  timeZone: ZAMAN_DILIMI,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const saatBicimleyici = new Intl.DateTimeFormat(YEREL, {
  timeZone: ZAMAN_DILIMI,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** "31.07.2026 20:14" */
export function tarihSaatFormat(zaman: ZamanDamgasi | Date): string {
  return tarihSaatBicimleyici.format(zaman instanceof Date ? zaman : new Date(zaman));
}

/** "31.07.2026" */
export function tarihFormat(zaman: ZamanDamgasi | Date | GunAnahtari): string {
  const t = typeof zaman === 'string' && zaman.length === 10 ? new Date(zaman + 'T12:00:00Z') : zaman;
  return tarihBicimleyici.format(t instanceof Date ? t : new Date(t));
}

/** "20:14:05" */
export function saatFormat(zaman: ZamanDamgasi | Date): string {
  return saatFormat0(zaman instanceof Date ? zaman : new Date(zaman));
}
function saatFormat0(t: Date): string {
  return saatBicimleyici.format(t);
}

/** Yerel saat dilimindeki saat (0-23) — saatlik yoğunluk raporu için. */
export function yerelSaat(zaman: ZamanDamgasi | Date): number {
  const t = zaman instanceof Date ? zaman : new Date(zaman);
  const parca = new Intl.DateTimeFormat('en-US', { timeZone: ZAMAN_DILIMI, hour: '2-digit', hour12: false }).format(t);
  return Number(parca) % 24;
}

/** "3 dakika önce", "2 saat önce", "5 gün önce" — senkron rozeti için (§10.1). */
export function goreliZaman(zaman: ZamanDamgasi | Date | null | undefined, referans: Date = new Date()): string {
  if (!zaman) return 'hiç';
  const t = zaman instanceof Date ? zaman : new Date(zaman);
  const saniye = Math.round((referans.getTime() - t.getTime()) / 1000);
  if (saniye < 0) return 'az sonra';
  if (saniye < 10) return 'az önce';
  if (saniye < 60) return `${saniye} saniye önce`;
  const dakika = Math.floor(saniye / 60);
  if (dakika < 60) return `${dakika} dakika önce`;
  const saat = Math.floor(dakika / 60);
  if (saat < 24) return `${saat} saat önce`;
  const gun = Math.floor(saat / 24);
  if (gun < 30) return `${gun} gün önce`;
  const ay = Math.floor(gun / 30);
  if (ay < 12) return `${ay} ay önce`;
  return `${Math.floor(ay / 12)} yıl önce`;
}

/** Bugünün yerel gün anahtarı. */
export function bugun(): GunAnahtari {
  return gunAnahtari();
}

/** Ayın ilk günü: "2026-07-31" → "2026-07-01" */
export function ayBasi(gun: GunAnahtari = bugun()): GunAnahtari {
  return gun.slice(0, 8) + '01';
}

/** SKT gibi tarihlerin kaç gün kaldığını verir (negatif = geçmiş). */
export function kalanGun(hedef: GunAnahtari, referans: GunAnahtari = bugun()): number {
  return gunFarki(referans, hedef);
}
