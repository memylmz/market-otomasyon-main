/**
 * Fiş BELGESİ — yazdırmadan önceki yapılandırılmış model (§13.2).
 *
 * NEDEN VAR: fiş uzun süre doğrudan ESC/POS baytı olarak üretildi; ürün adı,
 * miktar, birim fiyat ve tutar tek bir dizgede boşlukla hizalanıp eriyordu.
 * Fiş görüntü olarak basılmaya başlayınca bu bir engele dönüştü: sütunlu bir
 * yerleşim, hizalı rakamlar ya da ürün adının altında gri bir ayrıntı satırı
 * çizebilmek için bu alanların AYRI AYRI durması gerekir. Metinden geri
 * çıkarım yapmak (boşluk sayarak sütun bulmak) kırılgandır — uzun bir ürün
 * adı ya da eksi tutar düzeni bozar.
 *
 * Belge, çizicilerden bağımsızdır: sayılar burada METNE çevrilir (para ve
 * miktar biçimlendirmesi tek yerde kalsın diye), yerleşim kararı çiziciye
 * bırakılır.
 */

import { miktarFormat, paraFormat, tarihSaatFormat, type BirimTipi } from '@market/shared';
import type { SatisDetayi } from '../depo/satis.js';
import type { IsletmeBilgisi } from './fis.js';

export interface FisKalemi {
  ad: string;
  /** "2 ad" ya da "1,25 kg" — miktar ve birim birlikte. */
  miktarMetni: string;
  birimFiyatMetni: string;
  tutarMetni: string;
  /** Kaleme uygulanan iskonto; yoksa null. */
  iskontoMetni: string | null;
}

export interface FisSatiri {
  etiket: string;
  deger: string;
}

export interface FisBelgesi {
  isletmeAdi: string;
  /** Adres, telefon, vergi no — sırayla, boş olanlar atılmış. */
  isletmeSatirlari: string[];
  /** "İADE FİŞİ" gibi bir üst başlık; normal satışta null. */
  baslik: string | null;
  /** "KOPYA" damgası; yoksa null. */
  damga: string | null;
  meta: FisSatiri[];
  kalemler: FisKalemi[];
  /** Toplamdan ÖNCE gelen satırlar: ara toplam, iskonto, KDV kırılımı. */
  araSatirlar: FisSatiri[];
  toplam: FisSatiri;
  odemeler: FisSatiri[];
  altMetin: string | null;
  yasalUyari: string;
  yasalAlt: string | null;
  barkod: string | null;
}

const ODEME_ETIKETI: Record<string, string> = { NAKIT: 'Nakit', KART: 'Kart', VERESIYE: 'Veresiye' };

/** Mutlak değerin para biçimi — iade fişinde tutarlar eksi tutulur, kağıda artı basılır. */
function tutar(kurus: number): string {
  return paraFormat(Math.abs(kurus), { simge: false });
}

/**
 * KDV'yi oranlara göre gruplar (§10.3).
 *
 * Hem metin hem görüntü fişi aynı kırılımı göstermek zorunda; hesap burada tek
 * yerde durur.
 */
export function kdvKirilimi(kalemler: SatisDetayi['kalemler']): { oran: number; matrah: number; kdv: number }[] {
  const dilimler = new Map<number, { matrah: number; kdv: number }>();
  for (const kalem of kalemler) {
    const mevcut = dilimler.get(kalem.kdv_orani) ?? { matrah: 0, kdv: 0 };
    mevcut.kdv += Math.abs(kalem.kdv_tutar);
    mevcut.matrah += Math.abs(kalem.satir_toplam) - Math.abs(kalem.kdv_tutar);
    dilimler.set(kalem.kdv_orani, mevcut);
  }
  return [...dilimler.entries()].sort((a, b) => a[0] - b[0]).map(([oran, d]) => ({ oran, ...d }));
}

export function satisBelgesi(
  detay: SatisDetayi,
  isletme: IsletmeBilgisi,
  secenekler: { kopyaMi?: boolean; kasiyerAdi?: string | null; yasalUyari: string },
): FisBelgesi {
  const { satis, kalemler, odemeler } = detay;
  const iadeMi = satis.iade_mi;

  const meta: FisSatiri[] = [
    { etiket: 'FİŞ NO', deger: satis.fis_no },
    { etiket: 'TARİH', deger: tarihSaatFormat(satis.tarih) },
  ];
  if (secenekler.kasiyerAdi) meta.push({ etiket: 'KASİYER', deger: secenekler.kasiyerAdi });
  if (satis.musteri_adi) meta.push({ etiket: 'MÜŞTERİ', deger: satis.musteri_adi });

  const araSatirlar: FisSatiri[] = [];
  if (satis.iskonto_toplam > 0) {
    araSatirlar.push({ etiket: 'Ara toplam', deger: tutar(satis.ara_toplam) });
    araSatirlar.push({ etiket: 'İskonto', deger: '-' + tutar(satis.iskonto_toplam) });
  }
  for (const dilim of kdvKirilimi(kalemler)) {
    araSatirlar.push({ etiket: `KDV %${dilim.oran} (matrah ${paraFormat(dilim.matrah, { simge: false })})`, deger: tutar(dilim.kdv) });
  }

  const odemeSatirlari: FisSatiri[] = [];
  for (const odeme of odemeler) {
    odemeSatirlari.push({ etiket: ODEME_ETIKETI[odeme.odeme_tipi] ?? odeme.odeme_tipi, deger: tutar(odeme.tutar) });
    if (odeme.odeme_tipi === 'NAKIT' && odeme.para_ustu > 0) {
      odemeSatirlari.push({ etiket: 'Alınan', deger: tutar(odeme.alinan) });
      odemeSatirlari.push({ etiket: 'Para üstü', deger: tutar(odeme.para_ustu) });
    }
  }

  return {
    isletmeAdi: isletme.ad,
    isletmeSatirlari: [isletme.adres, isletme.telefon ? 'Tel ' + isletme.telefon : null, isletme.vergiNo ? 'VN ' + isletme.vergiNo : null].filter(
      (s): s is string => Boolean(s),
    ),
    baslik: iadeMi ? 'İADE FİŞİ' : null,
    damga: secenekler.kopyaMi ? 'KOPYA' : null,
    meta,
    kalemler: kalemler.map((kalem) => ({
      ad: kalem.urun_adi,
      miktarMetni: miktarFormat(Math.abs(kalem.miktar), kalem.birim_tipi as BirimTipi),
      birimFiyatMetni: paraFormat(kalem.birim_fiyat, { simge: false }),
      tutarMetni: tutar(kalem.satir_toplam),
      iskontoMetni: kalem.iskonto > 0 ? '-' + tutar(kalem.iskonto) : null,
    })),
    araSatirlar,
    toplam: { etiket: iadeMi ? 'İADE' : 'TOPLAM', deger: tutar(satis.genel_toplam) },
    odemeler: odemeSatirlari,
    altMetin: isletme.altMetin ?? null,
    yasalUyari: secenekler.yasalUyari,
    yasalAlt: 'Yasal fiş yazarkasadan alınmalıdır',
    // Barkoda TİRE BASILMAZ: HID okuyucular tuş kodu gönderir, Türkçe Q
    // klavyede `-` yerine `*` okunur.
    barkod: satis.fis_no.replace(/[^0-9A-Za-z]/g, ''),
  };
}
