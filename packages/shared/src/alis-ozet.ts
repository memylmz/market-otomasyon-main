/**
 * Alış faturası tutar hesabı — kasa ve panelde ORTAK.
 *
 * Bu hesap iki ekranda da birebir aynı olmak zorundadır: ekranda görünen
 * tutar, onaylanınca yazılan tutardan saparsa kullanıcı toptancının kâğıdıyla
 * karşılaştırdığında hangisine güveneceğini bilemez. Eskiden `faturaToplamlari`
 * kasa formunda ve panel sekmesinde AYNEN KOPYALANMIŞ hâlde duruyordu; biri
 * değişip diğeri kalırsa fark sessizce oluşurdu. Kural artık tek yerde.
 *
 * Kural (bkz. stok-servis.ts `malKabulOnayla`): birim fiyat KDV HARİÇTİR,
 * KDV satır bazında eklenir, yuvarlama satır düzeyinde yapılır.
 */

import { kdvAyir, paraParse, yuvarla, type Kurus } from './para.js';
import { miktarParse } from './miktar.js';
import { satirSatisFiyati, type AlisKalemGirdisi, type TopluGirisSatiri } from './toplu-urun.js';

export interface KalemTutari {
  /** KDV hariç satır tutarı. */
  net: Kurus;
  /** Satırın KDV tutarı. */
  kdv: Kurus;
  /** KDV dahil satır tutarı. */
  brut: Kurus;
}

/**
 * Tek bir fatura kaleminin tutarı.
 *
 * Miktar bindebirdir (1 adet = 1000), bu yüzden bine bölünür. Bölme sonucu
 * satır düzeyinde yuvarlanır — önce toplayıp sonra yuvarlamak, elli kalemlik
 * faturada genel toplamı kuruşlarca kaydırırdı.
 */
export function kalemTutari(kalem: Pick<AlisKalemGirdisi, 'miktar' | 'birim_fiyat' | 'kdv_orani'>): KalemTutari {
  const net = yuvarla((kalem.miktar * kalem.birim_fiyat) / 1000);
  const { kdv } = kdvAyir(net + yuvarla((net * kalem.kdv_orani) / 100), kalem.kdv_orani);
  return { net, kdv, brut: net + kdv };
}

export interface FaturaToplamlari {
  araToplam: Kurus;
  kdvToplam: Kurus;
  genelToplam: Kurus;
}

export function faturaToplamlari(kalemler: readonly AlisKalemGirdisi[]): FaturaToplamlari {
  let araToplam = 0;
  let kdvToplam = 0;
  for (const kalem of kalemler) {
    const { net, kdv } = kalemTutari(kalem);
    araToplam += net;
    kdvToplam += kdv;
  }
  return { araToplam, kdvToplam, genelToplam: araToplam + kdvToplam };
}

export interface SatirOzeti extends KalemTutari {
  /** Raf fiyatı (KDV dahil) — elle yazılan ya da marjdan hesaplanan; ikisi de yoksa null. */
  satisFiyati: Kurus | null;
  /**
   * Satırın brüt kâr marjı yüzdesi. `marjdanFiyat`ın TERSİDİR: o fonksiyon
   * matrahı `alış / (1 - marj/100)` yaptığı için marj, satışın KDV'siz hâline
   * göre hesaplanır. Alış sıfırsa ya da satış bilinmiyorsa null.
   */
  marjYuzde: number | null;
}

/**
 * Ekrandaki TEK satırın parasal özeti — satır tutarını ve kâr marjını
 * kullanıcıya yazarken kullanılır.
 *
 * Neden var: kullanıcı toptancının kâğıdındaki satırla ekrandakini ancak satır
 * tutarını görürse karşılaştırabilir; marjı görmezse alışın altına satış
 * yazdığını ancak raf etiketini bastıktan sonra fark eder.
 *
 * Satır eksik/okunamaz olduğunda null döner — hata mesajı üretmek bu
 * fonksiyonun işi değildir, o `topluGirisKalemleri`ye aittir.
 */
export function satirOzeti(satir: TopluGirisSatiri, marjYuzde: number | null | undefined): SatirOzeti | null {
  const miktar = miktarParse(satir.miktar);
  const alis = paraParse(satir.alis);
  const kdvSayi = Number(String(satir.kdv).trim().replace(',', '.'));
  if (miktar === null || miktar <= 0 || alis === null) return null;
  if (!Number.isFinite(kdvSayi) || kdvSayi < 0 || kdvSayi > 100) return null;

  const tutar = kalemTutari({ miktar, birim_fiyat: alis, kdv_orani: kdvSayi });
  const satisFiyati = satirSatisFiyati(satir, marjYuzde);

  let marj: number | null = null;
  if (satisFiyati !== null) {
    const { matrah } = kdvAyir(satisFiyati, kdvSayi);
    // Matrah sıfır/negatifse oran tanımsızdır (bedava ya da hatalı satır).
    if (matrah > 0) marj = ((matrah - alis) / matrah) * 100;
  }

  return { ...tutar, satisFiyati, marjYuzde: marj };
}
