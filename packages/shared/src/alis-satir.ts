/**
 * Alış faturası satır mantığı — arayüzden AYRI tutulur (§11.8).
 *
 * NEDEN AYRI DOSYA: arayüz katmanında otomatik test yok (vitest yalnız ana
 * süreci ve API'yi kapsıyor). Mal kabul, toptancının karşısında kırk kalem
 * girilen bir iştir; buradaki bir hata sessizce yanlış faturaya dönüşür ve
 * ancak stok sayımında fark edilir. Bu yüzden karar veren her parça saf
 * fonksiyona çıkarıldı ve testle kilitlendi; `.tsx` yalnız çizim yapar.
 */

/** Faturaya giren bir satır. Tutarlar kuruş, miktar kullanıcı metni olarak durur. */
export interface AlisSatiri {
  barkod: string;
  ad: string;
  miktar: string;
  /** KDV hariç birim alış fiyatı. */
  alis: number;
  /** KDV dahil raf fiyatı; 0 = boş bırakılmış (marjdan hesaplanır). */
  satis: number;
  kdv: string;
  skt: string;
  lot: string;
  /** Doluysa satır mevcut bir ürüne bağlıdır. */
  urun_id?: string;
  /** Ürün kartında SKT takibi açıksa bu satırda SKT zorunludur. */
  sktZorunlu: boolean;
}

/**
 * Barkod alanına yazılan çarpanı çözer: `12*8690...` → 12 adet.
 *
 * Kasadaki satış ekranının çarpan alışkanlığının aynısı. Koli gelince kasiyer
 * "12*" yazıp okutur; miktar hücresine fareyle gitmek gerekmez. Yıldızdan
 * önce sayı yoksa ya da sayı geçersizse çarpan 1'dir — kullanıcı yanlış
 * yazdıysa satır yine de girsin, kaybolmasın.
 */
export function carpanCoz(girdi: string): { carpan: number; barkod: string } {
  const eslesme = /^(\d+)\s*[*x]\s*(.*)$/i.exec(girdi.trim());
  if (!eslesme) return { carpan: 1, barkod: girdi.trim() };
  const sayi = Number(eslesme[1]);
  const carpan = Number.isFinite(sayi) && sayi > 0 ? Math.min(sayi, 9999) : 1;
  return { carpan, barkod: (eslesme[2] ?? '').trim() };
}

/** İki satır AYNI ürün mü — mevcut üründe kimlik, yeni üründe barkod belirler. */
function ayniUrun(a: AlisSatiri, b: AlisSatiri): boolean {
  if (a.urun_id && b.urun_id) return a.urun_id === b.urun_id;
  if (a.urun_id || b.urun_id) return false;
  // Barkodsuz yeni satırlar asla birleştirilmez: ikisi de "henüz adı yazılmamış
  // ürün"dür ve farklı şeyler olabilir.
  return Boolean(a.barkod) && a.barkod === b.barkod;
}

export interface BirlestirmeSonucu {
  satirlar: AlisSatiri[];
  /** Miktarı artan ya da yeni eklenen satırın sırası — arayüz onu vurgular. */
  vurgulanan: number;
  /** Mevcut bir satırın miktarı mı arttı, yoksa yeni satır mı açıldı? */
  birlesti: boolean;
}

/**
 * Yeni okutulan satırı listeye katar.
 *
 * AYNI BARKOD İKİNCİ KEZ OKUTULUNCA MİKTAR ARTAR, ikinci satır açılmaz.
 * Eskiden her okutma yeni satır ekliyordu: bir koliden on iki kez okutan
 * kullanıcı faturada aynı ürünü on iki kez görüyordu. Bu, sessizce yanlış
 * belge üretir — stok doğru artar ama fatura okunamaz hâle gelir ve tedarikçi
 * mutabakatında sorun çıkar. Her kasa uygulaması bu birleştirmeyi yapar.
 *
 * YENİ SATIR EN ÜSTE eklenir: kırk kalemlik girişte en alta eklenen satır
 * ekranın dışında kalır ve kullanıcı ne okuttuğunu göremez.
 */
export function satiriKat(mevcut: readonly AlisSatiri[], yeni: AlisSatiri, adet = 1): BirlestirmeSonucu {
  const sira = mevcut.findIndex((s) => ayniUrun(s, yeni));
  if (sira >= 0) {
    const eski = mevcut[sira]!;
    const oncekiMiktar = Number(String(eski.miktar).replace(',', '.'));
    const taban = Number.isFinite(oncekiMiktar) ? oncekiMiktar : 0;
    const yeniMiktar = taban + adet;
    const satirlar = mevcut.map((s, i) =>
      i === sira ? { ...s, miktar: String(Number(yeniMiktar.toFixed(3))).replace('.', ',') } : s,
    );
    return { satirlar, vurgulanan: sira, birlesti: true };
  }
  return { satirlar: [{ ...yeni, miktar: String(adet) }, ...mevcut], vurgulanan: 0, birlesti: false };
}

/**
 * SKT ve lot sütunları yalnız GEREKTİĞİNDE gösterilir.
 *
 * Dokuz sütun yan yana dizilince ürün adı ile fiyatlar sıkışıyordu; oysa son
 * kullanma tarihi yalnız kartında SKT takibi açık üründe anlamlı. Bir satır
 * bile istiyorsa sütunlar açılır — o satırın tarihi girilmeden fatura
 * kaydedilemediği için alan gizli kalamaz.
 */
export function sktSutunuGerekli(satirlar: readonly AlisSatiri[]): boolean {
  return satirlar.some((s) => s.sktZorunlu || s.skt.trim() !== '' || s.lot.trim() !== '');
}
