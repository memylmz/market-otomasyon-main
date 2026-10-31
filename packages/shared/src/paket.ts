/**
 * Paket seçenekleri — bir ürünün hem tek hem paket hâlinde satılması
 * (12'li kibrit, 6'lı su, 4'lü tuvalet kâğıdı).
 *
 * STOK HER ZAMAN TEK ADET ÜZERİNDENDİR. Paket yalnız satışta bir kısayoldur:
 * "12'li paket" satılınca stoktan 12 adet düşer; paket açılıp tek satılınca
 * hiçbir şey yapmaya gerek kalmaz.
 *
 * SATIŞ SATIRINDA MİKTAR PAKET CİNSİNDENDİR (1 paket = 1000 bindebir) ve
 * `paket_carpani` paketin içindeki tek adet sayısıdır. Neden adet değil: mali
 * cihaza (Pavo) giden satır "1 × 20,00" olmalıdır; "12 × 1,67 = 20,04" mali
 * belgede tutmaz. Stok hareketi, maliyet ve satılan adet `tekAdet` ile
 * çarpana göre hesaplanır.
 */

import { z } from 'zod';
import { kampanyaFiyatiBul, type KampanyaHedefi, type KampanyaTanimi } from './hesap.js';
import type { Kurus } from './para.js';
import { zKurusPozitif, zMetin, zUuid } from './semalar.js';

/** Paketin içindeki adet üst sınırı (koli içi 9999'dan büyük olmaz). */
export const PAKET_AZAMI_CARPAN = 9999;

export interface UrunPaketi {
  id: string;
  urun_id: string;
  /** "12'li paket", "Koli". */
  ad: string;
  /** İçindeki tek adet sayısı (≥ 2). */
  carpan: number;
  /** Paketin KDV dahil satış fiyatı; boşsa çarpan × tek fiyat. */
  fiyat: Kurus | null;
  /** Paketin kendi barkodu; okutulunca soru sorulmadan paket eklenir. */
  barkod: string | null;
  aktif_mi: boolean;
}

/** Ürün kartından gelen paket listesi (tamamı gönderilir; listede olmayan pasifleşir). */
export const zUrunPaketiGirdisi = z.object({
  id: zUuid.optional(),
  ad: zMetin(40).min(1, 'Paket adı boş olamaz'),
  carpan: z
    .number()
    .int('İçindeki adet tam sayı olmalıdır')
    .min(2, 'Paketin içinde en az 2 adet olmalıdır')
    .max(PAKET_AZAMI_CARPAN, `Paketin içinde en fazla ${PAKET_AZAMI_CARPAN} adet olabilir`),
  fiyat: zKurusPozitif.nullable().default(null),
  barkod: z.string().trim().max(48).nullable().default(null),
});
export type UrunPaketiGirdisi = z.infer<typeof zUrunPaketiGirdisi>;

export const zUrunPaketleriKaydet = z.object({
  urun_id: zUuid,
  paketler: z.array(zUrunPaketiGirdisi).max(10, 'Bir ürüne en fazla 10 paket tanımlanabilir'),
});

/** Paketin satış fiyatı: girilmişse o, yoksa çarpan × tek fiyat. */
export function paketFiyati(paket: Pick<UrunPaketi, 'carpan' | 'fiyat'>, tekFiyat: Kurus): Kurus {
  return paket.fiyat ?? paket.carpan * tekFiyat;
}

/** Fişe ve rapora yazılan satır adı: "Kibrit (12'li paket)". */
export function paketliAd(urunAdi: string, paketAdi: string): string {
  return `${urunAdi} (${paketAdi})`;
}

/** Satırın stoktaki karşılığı (tek adet, bindebir): paket satırında miktar × çarpan. */
export function tekAdet(miktar: number, paketCarpani: number | null | undefined): number {
  return paketCarpani && paketCarpani > 1 ? miktar * paketCarpani : miktar;
}

/**
 * Paketin kampanyalı fiyatı. Pakete YALNIZ YÜZDE kampanyaları uygulanır
 * ("tüm ürünlerde %10"): paket fiyatı zaten özel bir fiyattır; tek ürün için
 * yazılmış sabit fiyat, tutar ya da "3 al 2 öde" pakete anlamlı uygulanamaz
 * (sabit fiyat 12'li paketi tek ürün fiyatına düşürürdü).
 */
export function paketKampanyaFiyati(
  paketTemelFiyat: Kurus,
  hedef: KampanyaHedefi,
  kampanyalar: readonly KampanyaTanimi[],
  zaman: string,
): { fiyat: Kurus; kampanyaId: string | null } {
  return kampanyaFiyatiBul(
    paketTemelFiyat,
    hedef,
    kampanyalar.filter((k) => k.tip === 'YUZDE'),
    zaman,
  );
}
