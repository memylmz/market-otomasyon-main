/**
 * Fiş ve ekstre DÜZENİ — işletmenin kâğıtta neyi, hangi büyüklükte görmek
 * istediği (Ayarlar → Fiş Düzeni).
 *
 * Tek bir JSON ayarında (`fis.duzen`) durur; okunamayan ya da eksik alan
 * varsayılana düşer — bozuk bir ayar fişi hiç basılamaz hâle getirmemeli.
 * Görsel fiş (HTML) de metin fişi (ESC/POS) de aynı düzeni okur.
 *
 * Yasal uyarı bu düzenle KAPATILAMAZ (§17.1); alt metin ve yasal uyarı
 * metni ayrı ayarlardır.
 */

export type FisYaziBoyutu = 'kucuk' | 'normal' | 'buyuk';

/**
 * Görsel fişin tasarımı.
 *  - klasik: yazarkasa fişi gibi — tek aralıklı yazı, kesikli çizgiler, TOPLAM
 *    çift çizgi arasında. Az mürekkep, her şey net siyah. (Varsayılan.)
 *  - modern: oransal yazı, gri ayrıntılar, TOPLAM siyah bant içinde.
 */
export type FisSablonu = 'klasik' | 'modern';

export interface FisDuzeni {
  sablon: FisSablonu;
  /** Görsel fişte yazıların büyüklüğü. Metin fişinde yazıcının fontu kullanılır. */
  yaziBoyutu: FisYaziBoyutu;
  adres: boolean;
  telefon: boolean;
  vergiNo: boolean;
  kasiyer: boolean;
  musteri: boolean;
  /** Ürün adının altındaki "2 ad × 72,50" satırı. Kapalıysa miktar adın yanına yazılır. */
  kalemDetayi: boolean;
  kdvDokumu: boolean;
  /** Fiş numarasının barkodu (iade için fişi okutmaya yarar). */
  fisBarkodu: boolean;
  /** İşletme bilgisinin altına basılan kısa metin ("Hoş geldiniz" gibi). Boşsa basılmaz. */
  ustMetin: string;
  /** Ekstrede en fazla kaç hareket (en yeniler) basılsın. */
  ekstreHareketSayisi: number;
  /** Ekstrede dönem özeti (dönem başı bakiye, toplam borç, toplam tahsilat). */
  ekstreOzet: boolean;
}

export const VARSAYILAN_FIS_DUZENI: FisDuzeni = {
  sablon: 'klasik',
  yaziBoyutu: 'normal',
  adres: true,
  telefon: true,
  vergiNo: true,
  kasiyer: true,
  musteri: true,
  kalemDetayi: true,
  kdvDokumu: true,
  fisBarkodu: true,
  ustMetin: '',
  ekstreHareketSayisi: 60,
  ekstreOzet: true,
};

export const EKSTRE_HAREKET_SECENEKLERI = [20, 40, 60, 100, 200] as const;

/** Görsel fişte yazı ölçeği. */
export const FIS_YAZI_OLCEGI: Record<FisYaziBoyutu, number> = { kucuk: 0.88, normal: 1, buyuk: 1.15 };

/** Ayardaki JSON'u düzene çevirir; bilinmeyen/bozuk alanlar varsayılana düşer. */
export function fisDuzeniCoz(ham: string | null | undefined): FisDuzeni {
  let veri: Record<string, unknown> = {};
  try {
    const cozulen: unknown = ham ? JSON.parse(ham) : {};
    if (cozulen && typeof cozulen === 'object' && !Array.isArray(cozulen)) veri = cozulen as Record<string, unknown>;
  } catch {
    veri = {};
  }
  const v = VARSAYILAN_FIS_DUZENI;
  const bool = (anahtar: keyof FisDuzeni) =>
    typeof veri[anahtar] === 'boolean' ? (veri[anahtar] as boolean) : (v[anahtar] as boolean);
  const boyut = veri.yaziBoyutu;
  const sablon = veri.sablon;
  const hareket = Number(veri.ekstreHareketSayisi);
  return {
    sablon: sablon === 'klasik' || sablon === 'modern' ? sablon : v.sablon,
    yaziBoyutu: boyut === 'kucuk' || boyut === 'normal' || boyut === 'buyuk' ? boyut : v.yaziBoyutu,
    adres: bool('adres'),
    telefon: bool('telefon'),
    vergiNo: bool('vergiNo'),
    kasiyer: bool('kasiyer'),
    musteri: bool('musteri'),
    kalemDetayi: bool('kalemDetayi'),
    kdvDokumu: bool('kdvDokumu'),
    fisBarkodu: bool('fisBarkodu'),
    ustMetin: typeof veri.ustMetin === 'string' ? veri.ustMetin.slice(0, 120) : v.ustMetin,
    ekstreHareketSayisi: Number.isFinite(hareket) && hareket >= 5 ? Math.min(Math.round(hareket), 500) : v.ekstreHareketSayisi,
    ekstreOzet: bool('ekstreOzet'),
  };
}
