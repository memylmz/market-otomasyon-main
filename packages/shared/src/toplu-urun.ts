/**
 * Tedarikçiden toplu ürün girişi: arayüz satırlarının fatura kalemine çevrimi.
 *
 * Kasa ve panel aynı tabloyu doldurur. Kural tek yerde durmak zorundadır:
 * aynı satırdan iki ekran farklı fatura üretirse raf etiketi ile panel
 * ayrışır ve hangisinin doğru olduğu belirsizleşir (§11.8).
 */

import { marjdanFiyat } from './hesap.js';
import { barkodNormalize } from './id.js';
import { miktarParse } from './miktar.js';
import { paraParse } from './para.js';
import type { AlisGirdi } from './semalar.js';

export type AlisKalemGirdisi = AlisGirdi['kalemler'][number];

/** Arayüzdeki ham satır — bütün alanlar kullanıcının yazdığı metindir. */
export interface TopluGirisSatiri {
  barkod: string;
  ad: string;
  miktar: string;
  /** KDV hariç birim alış fiyatı. */
  alis: string;
  /** KDV dahil raf fiyatı. Boşsa marjdan hesaplanır. */
  satis: string;
  kdv: string;
  /** Gün, `YYYY-AA-GG`. Boşsa kaleme hiç konmaz (mevcut ve yeni ürün satırında ortak alan). */
  skt?: string;
  lot?: string;
  /** Doluysa satır mevcut bir ürüne bağlıdır; ad/barkod yalnız gösterim içindir. */
  urun_id?: string;
  /** Yeni ürün satırında ürün kartı formundan girilen ayrıntılar. */
  kart?: YeniUrunKarti;
}

/**
 * Yeni ürün satırının kart ayrıntıları — ürün kartı formundan gelir.
 * Yalnız yeni ürün satırında anlamlıdır; mevcut üründe kart zaten vardır.
 */
export interface YeniUrunKarti {
  marka?: string | null;
  kategori_id?: string | null;
  birim_tipi?: 'ADET' | 'KG' | 'LT';
  /** Kullanıcının yazdığı metin (`5`, `2,5`); boşsa konmaz. */
  kritik_stok?: string;
  raf_konumu?: string | null;
  skt_takibi?: boolean;
  notlar?: string | null;
  ek_barkodlar?: string[];
}

/** Kart ayrıntılarından yalnız DOLU olanlar — boş alan şemaya hiç konmaz. */
function kartAlanlari(kart: YeniUrunKarti | undefined): Record<string, unknown> {
  if (!kart) return {};
  const kritik = kart.kritik_stok?.trim() ? miktarParse(kart.kritik_stok) : null;
  const ekBarkodlar = (kart.ek_barkodlar ?? []).map((b) => barkodNormalize(b)).filter(Boolean);
  return {
    ...(kart.marka?.trim() ? { marka: kart.marka.trim() } : {}),
    ...(kart.kategori_id ? { kategori_id: kart.kategori_id } : {}),
    ...(kart.birim_tipi ? { birim_tipi: kart.birim_tipi } : {}),
    ...(kritik !== null && kritik > 0 ? { kritik_stok: kritik } : {}),
    ...(kart.raf_konumu?.trim() ? { raf_konumu: kart.raf_konumu.trim() } : {}),
    ...(kart.skt_takibi ? { skt_takibi: true } : {}),
    ...(kart.notlar?.trim() ? { notlar: kart.notlar.trim() } : {}),
    ...(ekBarkodlar.length ? { ek_barkodlar: ekBarkodlar } : {}),
  };
}

export interface TopluGirisSonucu {
  kalemler: AlisKalemGirdisi[];
  hatalar: { satir: number; mesaj: string }[];
}

function bosMu(satir: TopluGirisSatiri): boolean {
  return !satir.urun_id && !satir.ad.trim() && !satir.barkod.trim() && !satir.alis.trim() && !satir.miktar.trim() && !satir.satis.trim();
}

/** Satırın raf fiyatı: elle yazılmışsa o, yoksa marjdan hesaplanan. */
export function satirSatisFiyati(satir: TopluGirisSatiri, marjYuzde: number | null | undefined): number | null {
  const elle = paraParse(satir.satis);
  if (elle !== null) return elle;
  const alis = paraParse(satir.alis);
  const kdv = Number(String(satir.kdv).replace(',', '.'));
  if (alis === null || !Number.isFinite(kdv) || kdv < 0 || kdv > 100) return null;
  if (marjYuzde === null || marjYuzde === undefined || !Number.isFinite(marjYuzde) || marjYuzde >= 100) return null;
  return marjdanFiyat(alis, marjYuzde, kdv);
}

export function topluGirisKalemleri(
  satirlar: readonly TopluGirisSatiri[],
  secenekler: { marjYuzde?: number | null } = {},
): TopluGirisSonucu {
  const kalemler: AlisKalemGirdisi[] = [];
  const hatalar: { satir: number; mesaj: string }[] = [];

  satirlar.forEach((satir, sira) => {
    const satirNo = sira + 1;
    // Kullanıcı fazladan satır açmış olabilir; boş satır hata değildir.
    if (bosMu(satir)) return;

    const ad = satir.ad.trim();
    if (!satir.urun_id && !ad) {
      hatalar.push({ satir: satirNo, mesaj: 'Ürün adı zorunludur.' });
      return;
    }

    const miktar = miktarParse(satir.miktar);
    if (miktar === null || miktar <= 0) {
      hatalar.push({ satir: satirNo, mesaj: 'Miktar sıfırdan büyük olmalıdır.' });
      return;
    }

    const alis = paraParse(satir.alis);
    if (alis === null) {
      hatalar.push({ satir: satirNo, mesaj: 'Alış fiyatı okunamadı.' });
      return;
    }

    const kdvMetin = String(satir.kdv).trim().replace(',', '.');
    if (!kdvMetin) {
      hatalar.push({ satir: satirNo, mesaj: 'KDV oranı zorunludur.' });
      return;
    }
    const kdvSayi = Number(kdvMetin);
    if (!Number.isFinite(kdvSayi) || kdvSayi < 0 || kdvSayi > 100) {
      hatalar.push({ satir: satirNo, mesaj: 'KDV oranı 0-100 aralığında olmalıdır.' });
      return;
    }
    const kdvOrani = kdvSayi;

    // SKT/lot mevcut VE yeni ürün satırında ortaktır; doluysa taşınır, boşsa şemadaki opsiyonel alan hiç konmaz.
    const skt = satir.skt?.trim();
    const lot = satir.lot?.trim();
    const sktLotAlanlari = { ...(skt ? { skt } : {}), ...(lot ? { lot_no: lot } : {}) };

    if (satir.urun_id) {
      /*
       * Satırdaki barkod kaleme TAŞINIR (`barkod_ekle`).
       *
       * Kullanıcı katalogda bulunmayan bir barkodu okutup satırı mevcut ürüne
       * bağladığında o barkodun ürüne kaydedilmesini istiyoruz; yoksa aynı
       * barkod her mal kabulde yeniden "bulunamadı" der ve mükerrer ürün
       * açılmasına davetiye çıkar. Barkod zaten o ürüne aitse mal kabul
       * tarafında atlanır — zararsızdır.
       */
      const mevcutBarkod = satir.barkod.trim() ? barkodNormalize(satir.barkod) : '';
      kalemler.push({
        urun_id: satir.urun_id,
        miktar,
        birim_fiyat: alis,
        kdv_orani: kdvOrani,
        ...(mevcutBarkod ? { barkod_ekle: mevcutBarkod } : {}),
        ...sktLotAlanlari,
      });
      return;
    }

    const satis = satirSatisFiyati(satir, secenekler.marjYuzde);
    if (satis === null) {
      hatalar.push({ satir: satirNo, mesaj: 'Satış fiyatı yazılmalı ya da kâr marjı girilmelidir.' });
      return;
    }

    const barkod = satir.barkod.trim() ? barkodNormalize(satir.barkod) : null;
    kalemler.push({
      yeni_urun: {
        ad,
        ...(barkod ? { barkod } : {}),
        satis_fiyati: satis,
        birim_tipi: 'ADET',
        kategori_id: null,
        ...kartAlanlari(satir.kart),
      },
      miktar,
      birim_fiyat: alis,
      kdv_orani: kdvOrani,
      ...sktLotAlanlari,
    });
  });

  return { kalemler, hatalar };
}
