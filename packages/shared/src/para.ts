/**
 * Para aritmetiği.
 *
 * ALTIN KURAL (Blueprint §8.5): Parada kayan nokta (float) KULLANILMAZ.
 * Tüm parasal değerler **tam sayı kuruş** olarak saklanır ve hesaplanır.
 * 137,50 ₺ → 13750 kuruş.
 */

import { PARA_BIRIMI, YEREL } from './sabitler.js';

/** Tam sayı kuruş. 1 ₺ = 100 kuruş. */
export type Kurus = number;

/** JS'in güvenli tam sayı aralığında kalabilmek için üst sınır (~90 trilyon ₺). */
const AZAMI_KURUS = Number.MAX_SAFE_INTEGER;

export function kurusMu(deger: unknown): deger is Kurus {
  return typeof deger === 'number' && Number.isInteger(deger) && Math.abs(deger) <= AZAMI_KURUS;
}

/**
 * Sıfırdan uzağa yuvarlama (half away from zero).
 * Muhasebede beklenen davranış budur: 0,5 → 1 ve -0,5 → -1.
 * (JS'in `Math.round(-0.5)` sonucu -0'dır; bu yüzden elle uygulanır.)
 */
export function yuvarla(deger: number): number {
  if (!Number.isFinite(deger)) throw new RangeError('Yuvarlanamayan sayı: ' + String(deger));
  const sonuc = deger < 0 ? -Math.round(-deger) : Math.round(deger);
  // -0 üretmemek önemlidir: tutarlar karşılaştırılırken ve JSON'a yazılırken
  // -0 sürprizi çıkmasın (Object.is(-0, 0) === false).
  return sonuc === 0 ? 0 : sonuc;
}

/**
 * TL cinsinden ondalıklı sayıyı kuruşa çevirir. Sadece dış dünyadan (CSV, JSON,
 * eski sistem) veri alırken kullanılır; iç hesaplarda hep kuruş dolaşır.
 *
 * Doğrudan `tl * 100` yapılmaz: ikili kayan noktada 1.005 * 100 = 100.4999...
 * çıkar ve 1,00 ₺'ye yuvarlanır. Bunun yerine sayının **en kısa gidiş-dönüş metin
 * gösterimi** üzerinden ondalık çözümleme yapılır; 1.005 → "1.005" → 101 kuruş.
 */
export function tlToKurus(tl: number): Kurus {
  if (!Number.isFinite(tl)) throw new RangeError('Geçersiz tutar');
  const metin = String(tl);
  // Üstel gösterimde (1e-7, 1e21) metin yolu işe yaramaz; doğrudan çarpıma düş.
  if (metin.includes('e') || metin.includes('E')) return yuvarla(tl * 100);

  const eksi = metin.startsWith('-');
  const mutlak = eksi ? metin.slice(1) : metin;
  const [tam = '0', ondalik = ''] = mutlak.split('.');
  const dolu = (ondalik + '000').slice(0, 3); // yüzde biri kuruş hassasiyeti
  const kurus = Number(tam) * 100 + yuvarla(Number(dolu) / 10);
  return eksi ? -kurus : kurus;
}

/** Kuruşu TL cinsinden ondalıklı sayıya çevirir. Sadece gösterim/dışa aktarma içindir. */
export function kurusToTl(kurus: Kurus): number {
  return kurus / 100;
}

/**
 * Kullanıcı girdisini kuruşa çevirir. Hem TR ("1.234,56") hem de nokta ondalıklı
 * ("1234.56") biçimi kabul eder; boşluk ve ₺ işaretini yok sayar.
 * Geçersiz girdide `null` döner (hata fırlatmaz — form doğrulaması çağıranın işi).
 */
export function paraParse(girdi: string | number | null | undefined): Kurus | null {
  if (girdi === null || girdi === undefined) return null;
  if (typeof girdi === 'number') return Number.isFinite(girdi) ? tlToKurus(girdi) : null;

  let metin = girdi.trim().replace(/[₺\s ]/g, '');
  if (metin === '') return null;

  const eksi = metin.startsWith('-');
  if (eksi || metin.startsWith('+')) metin = metin.slice(1);

  const sonVirgul = metin.lastIndexOf(',');
  const sonNokta = metin.lastIndexOf('.');

  // Ayraç belirleme kuralları (TR öncelikli):
  //  1) İkisi de varsa SONDA gelen ondalık ayracıdır — hem TR "1.234,56" hem de
  //     yabancı "1,234.56" biçimi doğru çözülür.
  //  2) Yalnız virgül varsa: TR'de virgül daima ondalık ayracıdır ("1,005" = 1,005 ₺).
  //  3) Yalnız nokta varsa: tam bir binlik gruplaması ise ("1.000", "12.345.678")
  //     binlik ayracıdır; aksi halde ondalık ayracıdır ("1234.56", "0.005").
  let ondalikAyraci = '';
  if (sonVirgul >= 0 && sonNokta >= 0) {
    ondalikAyraci = sonVirgul > sonNokta ? ',' : '.';
  } else if (sonVirgul >= 0) {
    ondalikAyraci = ',';
  } else if (sonNokta >= 0) {
    ondalikAyraci = /^[1-9]\d{0,2}(\.\d{3})+$/.test(metin) ? '' : '.';
  }

  let tamKisim: string;
  let ondalikKisim = '';
  if (ondalikAyraci === '') {
    tamKisim = metin.replace(/[.,]/g, '');
  } else {
    const ayracIndex = ondalikAyraci === ',' ? sonVirgul : sonNokta;
    tamKisim = metin.slice(0, ayracIndex).replace(/[.,]/g, '');
    ondalikKisim = metin.slice(ayracIndex + 1);
  }

  if (!/^\d*$/.test(tamKisim) || !/^\d*$/.test(ondalikKisim)) return null;
  if (tamKisim === '' && ondalikKisim === '') return null;

  // Kuruş hassasiyetinden fazlasını yuvarlayarak kırp
  const tam = tamKisim === '' ? 0 : Number(tamKisim);
  const ondalikNormal = (ondalikKisim + '000').slice(0, 3);
  const kurusVeBinde = Number(ondalikNormal); // 0..999, son hane binde
  const kurus = tam * 100 + yuvarla(kurusVeBinde / 10);

  if (!Number.isSafeInteger(kurus)) return null;
  return eksi ? -kurus : kurus;
}

const paraBicimleyici = new Intl.NumberFormat(YEREL, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "1.234,56 ₺" biçiminde gösterir. */
export function paraFormat(kurus: Kurus, secenekler?: { simge?: boolean; isaret?: boolean }): string {
  const simge = secenekler?.simge ?? true;
  const metin = paraBicimleyici.format(kurusToTl(kurus));
  const isaretli = secenekler?.isaret && kurus > 0 ? '+' + metin : metin;
  return simge ? `${isaretli} ${PARA_BIRIMI}` : isaretli;
}

/** Simgesiz, gruplandırmasız ham gösterim — dışa aktarma (CSV) için. */
export function paraDuz(kurus: Kurus): string {
  const eksi = kurus < 0;
  const mutlak = Math.abs(kurus);
  const metin = `${Math.floor(mutlak / 100)},${String(mutlak % 100).padStart(2, '0')}`;
  return eksi ? '-' + metin : metin;
}

/** Yüzde uygular: 1000 kuruşun %18'i → 180. Yuvarlama sıfırdan uzağa. */
export function yuzdeUygula(tutar: Kurus, yuzde: number): Kurus {
  if (!Number.isFinite(yuzde)) throw new RangeError('Geçersiz yüzde');
  return yuvarla((tutar * yuzde) / 100);
}

/** Tutardan yüzde düşer: 1000 kuruştan %10 indirim → 900. */
export function yuzdeDus(tutar: Kurus, yuzde: number): Kurus {
  return tutar - yuzdeUygula(tutar, yuzde);
}

export interface KdvParcasi {
  /** KDV hariç tutar (matrah). */
  matrah: Kurus;
  /** KDV tutarı. */
  kdv: Kurus;
  /** KDV dahil tutar. */
  brut: Kurus;
  oran: number;
}

/**
 * KDV **dahil** bir tutarın içindeki KDV'yi ayırır.
 * Türkiye perakendesinde raf/satış fiyatı KDV dahildir (§17.2).
 *
 * kdv = brut × oran / (100 + oran), matrah = brut − kdv
 * Bu sıra sayesinde `matrah + kdv === brut` her zaman kuruşu kuruşuna tutar.
 */
export function kdvAyir(brut: Kurus, oran: number): KdvParcasi {
  if (oran < 0) throw new RangeError('KDV oranı negatif olamaz');
  const kdv = oran === 0 ? 0 : yuvarla((brut * oran) / (100 + oran));
  return { matrah: brut - kdv, kdv, brut, oran };
}

/** KDV **hariç** tutara KDV ekler. */
export function kdvEkle(matrah: Kurus, oran: number): KdvParcasi {
  const kdv = yuzdeUygula(matrah, oran);
  return { matrah, kdv, brut: matrah + kdv, oran };
}

/**
 * Bir toplamı verilen ağırlıklara göre **kuruş kaybı olmadan** dağıtır
 * (en büyük kalan / largest remainder yöntemi).
 *
 * Sepet geneli iskontosunu satırlara yayarken kullanılır; `sum(sonuç) === toplam`
 * garantisi KDV dağılımının genel toplamla tutmasını sağlar (§21.2).
 */
export function dagit(toplam: Kurus, agirliklar: readonly number[]): Kurus[] {
  const n = agirliklar.length;
  if (n === 0) return [];
  const agirlikToplami = agirliklar.reduce((a, b) => a + b, 0);

  if (agirlikToplami <= 0) {
    // Ağırlık yoksa eşit dağıt
    const taban = Math.trunc(toplam / n);
    const sonuc = new Array<number>(n).fill(taban);
    let kalan = toplam - taban * n;
    const adim = kalan < 0 ? -1 : 1;
    for (let i = 0; kalan !== 0; i = (i + 1) % n) {
      sonuc[i] = (sonuc[i] ?? 0) + adim;
      kalan -= adim;
    }
    return sonuc;
  }

  const tam: number[] = [];
  const kalanlar: { index: number; kalan: number }[] = [];
  let dagitilan = 0;

  for (let i = 0; i < n; i++) {
    const kesin = (toplam * (agirliklar[i] ?? 0)) / agirlikToplami;
    const asagi = Math.trunc(kesin);
    tam.push(asagi);
    kalanlar.push({ index: i, kalan: Math.abs(kesin - asagi) });
    dagitilan += asagi;
  }

  let fark = toplam - dagitilan;
  const adim = fark < 0 ? -1 : 1;
  kalanlar.sort((a, b) => b.kalan - a.kalan || a.index - b.index);
  for (let i = 0; fark !== 0; i++) {
    const hedef = kalanlar[i % n];
    if (!hedef) break;
    tam[hedef.index] = (tam[hedef.index] ?? 0) + adim;
    fark -= adim;
  }
  return tam;
}

/** Türkiye tedavüldeki banknot/madeni para birimleri (kuruş). */
export const NAKIT_BIRIMLERI: readonly Kurus[] = [20000_0, 10000_0, 5000_0, 2000_0, 1000_0, 500_0, 200_0, 100_0, 50, 25] as const;

/** Para üstünü en az sayıda banknot/bozukluk olacak şekilde ayrıştırır (kasiyer yardımı). */
export function paraUstuBoz(tutar: Kurus): { birim: Kurus; adet: number }[] {
  const sonuc: { birim: Kurus; adet: number }[] = [];
  let kalan = Math.max(0, tutar);
  for (const birim of NAKIT_BIRIMLERI) {
    if (kalan < birim) continue;
    const adet = Math.floor(kalan / birim);
    kalan -= adet * birim;
    sonuc.push({ birim, adet });
  }
  return sonuc;
}

/** Nakit ödemede müşterinin verebileceği makul tutar önerileri (hızlı butonlar). */
export function nakitOnerileri(genelToplam: Kurus): Kurus[] {
  if (genelToplam <= 0) return [];
  const oneriler = new Set<Kurus>([genelToplam]);
  for (const adim of [500_0, 1000_0, 2000_0, 5000_0, 10000_0]) {
    const yukari = Math.ceil(genelToplam / adim) * adim;
    if (yukari !== genelToplam) oneriler.add(yukari);
  }
  return [...oneriler].sort((a, b) => a - b).slice(0, 5);
}
