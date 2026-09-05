/**
 * Rol / yetki matrisi (§10.12, §15.1).
 *
 * İlke: **en az yetki.** Yetki kararı her zaman sunucu/ana süreç tarafında
 * doğrulanır; arayüzdeki kontrol yalnızca kullanıcı deneyimi içindir (§15.4).
 */

import type { Rol } from './sabitler.js';

export const YETKILER = [
  // Satış
  'satis.yap',
  'satis.satir_sil',
  'satis.iskonto',
  'satis.fiyat_degistir',
  'satis.iptal',
  'satis.iade',
  'satis.askiya_al',
  // Ürün / katalog
  'urun.goruntule',
  'urun.duzenle',
  'urun.fiyat_degistir',
  'urun.toplu_islem',
  'urun.pasiflestir',
  // Stok
  'stok.goruntule',
  'stok.giris',
  'stok.fire',
  'stok.sayim',
  'stok.duzeltme',
  // Cari
  'cari.goruntule',
  'cari.duzenle',
  'cari.tahsilat',
  'cari.limit_asimi_onay',
  'cari.kvkk_islem',
  // Kasa
  'kasa.ac',
  'kasa.kapat',
  'kasa.gider',
  'kasa.giris_cikis',
  'kasa.tum_oturumlar',
  // Raporlar
  'rapor.goruntule',
  'rapor.kar_gor',
  'rapor.disa_aktar',
  // Yönetim
  'ayar.yonet',
  'kampanya.yonet',
  'senkron.tetikle',
  'yedek.al',
  'yedek.geri_yukle',
  'denetim.goruntule',
] as const;

export type Yetki = (typeof YETKILER)[number];

export const YETKI_ETIKETLERI: Record<Yetki, string> = {
  'satis.yap': 'Satış yapma',
  'satis.satir_sil': 'Sepetten satır silme',
  'satis.iskonto': 'İskonto uygulama',
  'satis.fiyat_degistir': 'Satışta fiyat değiştirme',
  'satis.iptal': 'Satış iptali',
  'satis.iade': 'İade / değişim',
  'satis.askiya_al': 'Satışı askıya alma',
  'urun.goruntule': 'Ürünleri görüntüleme',
  'urun.duzenle': 'Ürün ekleme / düzenleme',
  'urun.fiyat_degistir': 'Ürün fiyatı değiştirme',
  'urun.toplu_islem': 'Toplu fiyat / içe aktarma',
  'urun.pasiflestir': 'Ürün pasifleştirme',
  'stok.goruntule': 'Stok görüntüleme',
  'stok.giris': 'Mal kabul (stok girişi)',
  'stok.fire': 'Fire / zaiat çıkışı',
  'stok.sayim': 'Sayım yapma',
  'stok.duzeltme': 'Stok düzeltme',
  'cari.goruntule': 'Cari hesapları görüntüleme',
  'cari.duzenle': 'Cari kart ekleme / düzenleme',
  'cari.tahsilat': 'Tahsilat / ödeme girişi',
  'cari.limit_asimi_onay': 'Kredi limiti aşımını onaylama',
  'cari.kvkk_islem': 'KVKK anonimleştirme / dışa aktarma',
  'kasa.ac': 'Kasa açma',
  'kasa.kapat': 'Kasa kapatma (gün sonu)',
  'kasa.gider': 'Kasadan gider girişi',
  'kasa.giris_cikis': 'Kasaya para giriş / çıkış',
  'kasa.tum_oturumlar': 'Tüm kasa oturumlarını görme',
  'rapor.goruntule': 'Raporları görüntüleme',
  'rapor.kar_gor': 'Kâr / maliyet görme',
  'rapor.disa_aktar': 'Rapor dışa aktarma',
  'ayar.yonet': 'Ayarları değiştirme',
  'kampanya.yonet': 'Kampanya yönetimi',
  'senkron.tetikle': 'Senkronu elle başlatma',
  'yedek.al': 'Yedek alma',
  'yedek.geri_yukle': 'Yedekten geri yükleme',
  'denetim.goruntule': 'Denetim loglarını görüntüleme',
};

const KASIYER_YETKILERI: Yetki[] = [
  'satis.yap',
  'satis.satir_sil',
  'satis.askiya_al',
  'urun.goruntule',
  'stok.goruntule',
  'cari.goruntule',
  'cari.tahsilat',
  'kasa.ac',
  'kasa.kapat',
];

const MUDUR_YETKILERI: Yetki[] = [
  ...KASIYER_YETKILERI,
  'satis.iskonto',
  'satis.fiyat_degistir',
  'satis.iptal',
  'satis.iade',
  'urun.duzenle',
  'urun.fiyat_degistir',
  'urun.toplu_islem',
  'urun.pasiflestir',
  'stok.giris',
  'stok.fire',
  'stok.sayim',
  'stok.duzeltme',
  'cari.duzenle',
  'cari.limit_asimi_onay',
  'kasa.gider',
  'kasa.giris_cikis',
  'kasa.tum_oturumlar',
  'rapor.goruntule',
  'rapor.kar_gor',
  'rapor.disa_aktar',
  'kampanya.yonet',
  'senkron.tetikle',
  'yedek.al',
];

/** Rol → varsayılan yetkiler. Kullanıcı bazında `yetkiler` JSON alanı ile genişletilir/daraltılır. */
export const ROL_YETKILERI: Record<Rol, readonly Yetki[]> = {
  ADMIN: YETKILER,
  MUDUR: MUDUR_YETKILERI,
  KASIYER: KASIYER_YETKILERI,
};

/** Yıkıcı ya da mali etkisi olan, yetkili PIN onayı istenebilecek işlemler (§10.1). */
export const PIN_ONAYI_GEREKENLER: readonly Yetki[] = [
  'satis.iptal',
  'satis.iade',
  'satis.iskonto',
  'satis.fiyat_degistir',
  'stok.duzeltme',
  'urun.fiyat_degistir',
  'cari.limit_asimi_onay',
  'kasa.giris_cikis',
  'yedek.geri_yukle',
];

export interface YetkiSahibi {
  rol: Rol;
  /** Rol varsayılanını ezen kullanıcı bazlı ayarlar. */
  ekYetkiler?: readonly Yetki[] | null;
  kaldirilanYetkiler?: readonly Yetki[] | null;
}

/** Bir kullanıcının etkin yetki kümesini hesaplar. */
export function etkinYetkiler(sahip: YetkiSahibi): Set<Yetki> {
  const kume = new Set<Yetki>(ROL_YETKILERI[sahip.rol] ?? []);
  for (const y of sahip.ekYetkiler ?? []) kume.add(y);
  for (const y of sahip.kaldirilanYetkiler ?? []) kume.delete(y);
  return kume;
}

export function yetkisiVar(sahip: YetkiSahibi, yetki: Yetki): boolean {
  return etkinYetkiler(sahip).has(yetki);
}

export function yetkiGecerliMi(deger: string): deger is Yetki {
  return (YETKILER as readonly string[]).includes(deger);
}
