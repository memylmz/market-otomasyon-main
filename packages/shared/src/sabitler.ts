/**
 * Sistem genelinde kullanılan sabitler, numaralandırmalar ve hata kodları.
 *
 * Bu dosya masaüstü, API ve panel tarafından ortak kullanılır; bir değer burada
 * değişince üç uygulamada da değişir (tek gerçeklik ilkesi — Blueprint §5.4).
 */

/** Şema sürümü — yerel ve bulut şemasının uyumunu senkron protokolünde raporlar (§8.5). */
export const SEMA_SURUMU = 2;

/** Senkron protokolü sürümü — kırıcı değişiklikte artar (§22.4). */
export const SENKRON_PROTOKOL_SURUMU = 1;

/** Uygulama ürün sürümü (SemVer). */
export const URUN_SURUMU = '2.0.0';

// ---------------------------------------------------------------------------
// Numaralandırmalar
// ---------------------------------------------------------------------------

export const BIRIM_TIPI = ['ADET', 'KG', 'LT'] as const;
export type BirimTipi = (typeof BIRIM_TIPI)[number];

/** KG/LT ürünlerde miktar ondalıklı girilebilir; ADET'te tam sayı zorunludur. */
export const ONDALIKLI_BIRIMLER: readonly BirimTipi[] = ['KG', 'LT'];

export const STOK_HAREKET_TIPI = [
  'SATIS', // satış çıkışı (negatif)
  'GIRIS', // mal kabul / alış (pozitif)
  'IADE', // müşteri iadesi (pozitif)
  'FIRE', // fire/zaiat/numune (negatif)
  'SAYIM', // sayım düzeltmesi (+/-)
  'DUZELTME', // manuel düzeltme (+/-)
  'ACILIS', // açılış stoğu (pozitif)
  'TEDARIKCI_IADE', // tedarikçiye iade (negatif)
] as const;
export type StokHareketTipi = (typeof STOK_HAREKET_TIPI)[number];

/** Stok hareketinin işaret yönü. `null` = serbest (+/- olabilir). */
export const STOK_HAREKET_YONU: Record<StokHareketTipi, -1 | 1 | null> = {
  SATIS: -1,
  GIRIS: 1,
  IADE: 1,
  FIRE: -1,
  SAYIM: null,
  DUZELTME: null,
  ACILIS: 1,
  TEDARIKCI_IADE: -1,
};

export const FIRE_NEDENI = ['FIRE', 'ZAIAT', 'NUMUNE', 'PERSONEL', 'SKT_GECTI', 'KIRIK_HASARLI'] as const;
export type FireNedeni = (typeof FIRE_NEDENI)[number];

export const ODEME_TIPI = ['NAKIT', 'KART', 'VERESIYE'] as const;
export type OdemeTipi = (typeof ODEME_TIPI)[number];

export const CARI_TIPI = ['MUSTERI', 'TEDARIKCI'] as const;
export type CariTipi = (typeof CARI_TIPI)[number];

export const CARI_HAREKET_TIPI = [
  'BORC', // müşteri veresiye aldı / tedarikçiden mal alındı (+)
  'ALACAK', // (-)
  'TAHSILAT', // müşteriden nakit alındı (-)
  'ODEME', // tedarikçiye ödeme yapıldı (-)
  'IADE', // satış iadesi (-)
  'DUZELTME', // manuel düzeltme (+/-)
  'ACILIS', // açılış bakiyesi (+/-)
] as const;
export type CariHareketTipi = (typeof CARI_HAREKET_TIPI)[number];

export const KASA_HAREKET_TIPI = [
  'SATIS_NAKIT',
  'SATIS_KART',
  'TAHSILAT',
  'ODEME',
  'GIDER',
  'GIRIS', // kasaya para koyma
  'CIKIS', // kasadan para alma
  'IADE_NAKIT',
  'ACILIS',
] as const;
export type KasaHareketTipi = (typeof KASA_HAREKET_TIPI)[number];

/** Kasa hareketinin fiziksel nakit akışını etkileyip etkilemediği (kart nakit değildir). */
export const KASA_NAKIT_ETKISI: Record<KasaHareketTipi, boolean> = {
  SATIS_NAKIT: true,
  SATIS_KART: false,
  TAHSILAT: true,
  ODEME: true,
  GIDER: true,
  GIRIS: true,
  CIKIS: true,
  IADE_NAKIT: true,
  ACILIS: true,
};

export const KASA_OTURUM_DURUMU = ['ACIK', 'KAPALI'] as const;
export type KasaOturumDurumu = (typeof KASA_OTURUM_DURUMU)[number];

/**
 * Kampanya tipleri (§10.8).
 *
 * İlk üçü BİRİM FİYATI değiştirir; son ikisi MİKTARA bağlıdır ve satır
 * iskontosu olarak uygulanır. Ayrım önemli: miktar kampanyasını birim fiyata
 * gömmek kuruş yuvarlamasını bozar (3 al 2 öde → 6,666… birim fiyat) ve fişte
 * müşterinin neyin bedava geldiğini görmesini engeller.
 */
export const KAMPANYA_TIPI = [
  'YUZDE',
  'TUTAR',
  'SABIT_FIYAT',
  /** "3 al 2 öde" — esik_miktar = alınan, deger = ödenen. Yalnız ADET. */
  'N_AL_M_ODE',
  /** "3 kg üzeri 8,00/kg" — esik_miktar = eşik, deger = yeni birim fiyat. */
  'KADEMELI_FIYAT',
] as const;
export type KampanyaTipi = (typeof KAMPANYA_TIPI)[number];

export const KAMPANYA_KAPSAMI = ['URUN', 'KATEGORI', 'TUM'] as const;
export type KampanyaKapsami = (typeof KAMPANYA_KAPSAMI)[number];

export const ROL = ['ADMIN', 'MUDUR', 'KASIYER'] as const;
export type Rol = (typeof ROL)[number];

export const ROL_ETIKETI: Record<Rol, string> = {
  ADMIN: 'Patron / Yönetici',
  MUDUR: 'Müdür',
  KASIYER: 'Kasiyer',
};

export const ALIS_FATURA_DURUMU = ['TASLAK', 'ONAYLANDI', 'IPTAL'] as const;
export type AlisFaturaDurumu = (typeof ALIS_FATURA_DURUMU)[number];

export const SAYIM_DURUMU = ['ACIK', 'TAMAMLANDI', 'IPTAL'] as const;
export type SayimDurumu = (typeof SAYIM_DURUMU)[number];

// ---------------------------------------------------------------------------
// KDV (§17.2) — oranlar ayardan değiştirilebilir, mevzuat değişebilir.
// ---------------------------------------------------------------------------

/** Temmuz 2023'ten beri geçerli oranlar. Kesin sınıflandırma mali müşavire aittir. */
export const KDV_ORANLARI = [0, 1, 10, 20] as const;
export type KdvOrani = (typeof KDV_ORANLARI)[number];
export const VARSAYILAN_KDV_ORANI = 20;

// ---------------------------------------------------------------------------
// Senkron olay tipleri (§7.1)
// ---------------------------------------------------------------------------

export const OLAY_TIPI = [
  'SATIS_YAPILDI',
  'SATIS_IPTAL_EDILDI',
  'IADE_YAPILDI',
  'STOK_HAREKETI',
  'KASA_OTURUM_ACILDI',
  'KASA_OTURUM_KAPANDI',
  'KASA_HAREKETI',
  'CARI_HAREKETI',
  'CARI_KAYDEDILDI',
  'KULLANICI_KAYDEDILDI',
  'URUN_KAYDEDILDI',
  'BARKOD_KAYDEDILDI',
  'KATEGORI_KAYDEDILDI',
  'ALIS_FATURASI_ONAYLANDI',
  /** Onaylı fatura iptal edildi — stok ve tedarikçi borcu ters kayıtla geri alınır (§11.8). */
  'ALIS_FATURASI_IPTAL',
  /** Faturanın belge bilgileri (fatura no, vade, not) düzeltildi; mali etkisi yoktur. */
  'ALIS_FATURASI_GUNCELLENDI',
  /*
   * Panelden inen bir TALİMATIN kasada ne olduğu — uygulandı mı, hangi belgeyi
   * üretti, olmadıysa neden.
   *
   * Talimat akışı tek yönlüydü: panel niyeti yazıyor, kasa uyguluyor ve orada
   * bitiyordu. Bulut sonucu HİÇ öğrenmediği için talimat satırı sonsuza kadar
   * "bekliyor" kalıyor, panel de o faturayı kalıcı olarak kilitliyordu. Bu olay
   * döngüyü kapatır.
   */
  'TALIMAT_SONUCLANDI',
  'AYAR_DEGISTI',
  'DENETIM_KAYDI',
  'GUNLUK_OZET',
  /** Banka/POS defterine elle girilen hareket: açılış, komisyon, kasa↔banka aktarımı, düzeltme. */
  'BANKA_HAREKETI',
] as const;
export type OlayTipi = (typeof OLAY_TIPI)[number];

/**
 * Merkezden yönetilen, kasalar arasında ORTAK olması gereken ayarlar (§8.3).
 *
 * BEYAZ LİSTEDİR, kara liste değil. Sebebi: ayar anahtarları zamanla eklenir ve
 * kara listede unutulan bir anahtar sessizce senkronlanır. Cihaza özel bir ayar
 * (yazıcı hedefi, cihaz kimliği, fiş serisi, lisans anahtarı) yanlışlıkla
 * yayılırsa her kasa aynı yazıcıya basmaya çalışır ya da lisans çakışır.
 *
 * Buraya ancak "tüm mağazada aynı olmalı" diyebildiğimiz anahtar girer.
 */
export const MERKEZI_AYARLAR = [
  'isletme.ad',
  'isletme.adres',
  'isletme.telefon',
  'isletme.vergi_no',
  'kdv.varsayilan',
  'fis.alt_metin',
  'fis.yasal_uyari',
  'stok.negatif_izin',
  'stok.kritik_uyari',
  'cari.limit_davranisi',
  'kasa.fark_esigi',
  'guvenlik.oturum_zaman_asimi_dk',
  'barkod.ic_onek',
  'bakim.olay_saklama_gun',
  'bakim.denetim_saklama_gun',
  // Banka/POS raporundaki tahmini kesinti; panel de aynı oranı göstersin diye merkezî.
  'pos.komisyon_orani',
] as const;

/**
 * Banka/POS defterine ELLE girilen hareketler. Kart satışı, kart/havale
 * tahsilat ve ödemeler kayıtlardan türetilir; bunlar türetilemeyenlerdir.
 */
/**
 * POS cihaz türleri. KAPALI: kart çekimi POS'tan elle yapılır, program yalnız
 * kayıt tutar (bugünkü davranış). SIMULATOR: gerçek cihaz olmadan akışı denemek
 * için. Gerçek cihaz sürücüleri (ör. yazarkasa POS) buraya eklenir.
 */
export const POS_TURU = ['KAPALI', 'SIMULATOR'] as const;
export type PosTuru = (typeof POS_TURU)[number];

/** POS işleminin sonucu — her sürücü bu şekli döndürür. */
export interface PosIslemSonucu {
  onaylandi: boolean;
  onay_kodu?: string | null;
  /** Cihazın/bankanın işlem referansı; iade ve iptalde orijinal işlemi gösterir. */
  referans?: string | null;
  /** Maskeli kart numarası, ör. "**** 4242". */
  kart_maske?: string | null;
  /** Reddedildiyse ya da hata olduysa okunur açıklama. */
  hata?: string | null;
  /**
   * Cihaz süre içinde yanıt vermedi. Çekim yapılıp yapılmadığı BİLİNMEZ:
   * kasiyer cihaz ekranını / slibini kontrol etmelidir.
   */
  zaman_asimi?: boolean;
}

/**
 * Kasaya bağlı terazi türleri (etiket basan barkodlu teraziler ayar istemez).
 * SERI: RS-232 / USB-seri (COM) bağlantı; AG: Ethernet terazi (IP:port).
 */
export const TERAZI_TURU = ['KAPALI', 'SIMULATOR', 'SERI', 'AG'] as const;
export type TeraziTuru = (typeof TERAZI_TURU)[number];

/** Teraziden bir okuma. Ağırlık gram cinsindendir (= KG ürünün miktar birimi). */
export interface TeraziOkumasi {
  basarili: boolean;
  gram?: number;
  /** Kefe durdu mu — sallanırken okunan değer satışa alınmaz. */
  kararli?: boolean;
  hata?: string | null;
  /** Cihazdan gelen ham metin (ayar/test ekranında gösterilir). */
  ham?: string | null;
}

export const BANKA_HAREKET_TURU = ['ACILIS', 'KOMISYON', 'BANKADAN_KASAYA', 'KASADAN_BANKAYA', 'DUZELTME'] as const;
export type BankaHareketTuru = (typeof BANKA_HAREKET_TURU)[number];

export type MerkeziAyar = (typeof MERKEZI_AYARLAR)[number];

/** Bu anahtar merkezden yönetiliyor mu? */
export function merkeziAyarMi(anahtar: string): boolean {
  return (MERKEZI_AYARLAR as readonly string[]).includes(anahtar);
}

/** Bulut → yerel yönünde çekilen (pull) yönetimsel varlıklar (§7.2). */
export const PULL_VARLIKLARI = [
  /**
   * SIRA ÖNEMLİDİR — görsel tercih değil, doğruluk şartıdır.
   *
   * Sunucu kayıtları bu dizinin sırasına göre gönderir, kasa da hepsini TEK
   * transaction'da uygular ve `PRAGMA foreign_keys = ON` ile çalışır. Çocuk
   * kayıt ebeveyninden önce inerse yabancı anahtar patlar, tüm parti geri
   * alınır ve pull imleci KALICI olarak takılır — o noktadan sonra buluttan
   * hiçbir şey inmez.
   *
   * Bağımlılıklar: urunler.kategori_id → kategoriler,
   * barkodlar.urun_id → urunler, stok_duzeltmeleri.urun_id → urunler.
   */
  'kategoriler',
  'urunler',
  'barkodlar',
  'kampanyalar',
  'kullanicilar',
  'cariler',
  'ayarlar',
  /**
   * Panelden girilen stok talimatları (§11.5). Dikkat: inen şey stok
   * HAREKETİ değil, kasanın kendi hareketini üretmesi için bir talimattır —
   * "hareketlerin tek üreticisi kasadır" kuralı korunur.
   */
  'stok_duzeltmeleri',
  /** Panelden yazılan iade talimatları; hareketi kasa üretir (§10.4). */
  'iade_talimatlari',
  /**
   * Panelden yazılan cari talimatları — açılış bakiyesi, bakiye düzeltmesi ve
   * tahsilat iptali (§10.7). Aynı gerekçe: `cari_hareketler` bir defterdir ve
   * tek yazıcısı kasadır; panel yalnız niyeti bildirir.
   *
   * `cariler`den SONRA gelmek zorundadır — talimat bir cariye bağlıdır ve
   * pull'da yabancı anahtar açıkken sıra bozulursa parti tümden geri alınır.
   */
  'cari_talimatlari',
  /**
   * Panelden yazılan alış faturası talimatları (§11.8). `urunler` ve
   * `cariler`den SONRA gelmek zorundadır: talimat hem ürüne hem tedarikçiye
   * bağlıdır ve pull'da yabancı anahtar açıkken sıra bozulursa parti tümden
   * geri alınır.
   */
  'alis_talimatlari',
] as const;
export type PullVarligi = (typeof PULL_VARLIKLARI)[number];

export const SENKRON_DURUMU = ['GUNCEL', 'BEKLIYOR', 'HATA', 'KAPALI'] as const;
export type SenkronDurumu = (typeof SENKRON_DURUMU)[number];

// ---------------------------------------------------------------------------
// Hata kodları (§9.1) — kullanıcıya Türkçe mesaj, loga izleme_id gider (§20).
// ---------------------------------------------------------------------------

export const HATA_KODU = {
  DOGRULAMA: 'DOGRULAMA_HATASI',
  KIMLIK: 'KIMLIK_DOGRULANAMADI',
  YETKI: 'YETKI_YOK',
  BULUNAMADI: 'BULUNAMADI',
  CAKISMA: 'CAKISMA',
  HIZ_LIMITI: 'HIZ_LIMITI',
  SUNUCU: 'SUNUCU_HATASI',

  STOK_YETERSIZ: 'STOK_YETERSIZ',
  URUN_PASIF: 'URUN_PASIF',
  BARKOD_KULLANIMDA: 'BARKOD_KULLANIMDA',
  KREDI_LIMITI_ASILDI: 'KREDI_LIMITI_ASILDI',
  KASA_ACIK_DEGIL: 'KASA_ACIK_DEGIL',
  KASA_ZATEN_ACIK: 'KASA_ZATEN_ACIK',
  SEPET_BOS: 'SEPET_BOS',
  ODEME_EKSIK: 'ODEME_EKSIK',
  ODEME_FAZLA: 'ODEME_FAZLA',
  VERESIYE_MUSTERI_GEREKLI: 'VERESIYE_MUSTERI_GEREKLI',
  SATIS_ZATEN_IPTAL: 'SATIS_ZATEN_IPTAL',
  IADE_MIKTARI_ASILDI: 'IADE_MIKTARI_ASILDI',
  SEMA_UYUMSUZ: 'SEMA_UYUMSUZ',
  CIHAZ_YETKISIZ: 'CIHAZ_YETKISIZ',
  LISANS_GECERSIZ: 'LISANS_GECERSIZ',
  HESAP_KILITLI: 'HESAP_KILITLI',
} as const;
export type HataKodu = (typeof HATA_KODU)[keyof typeof HATA_KODU];

/** Kullanıcıya gösterilecek varsayılan Türkçe mesajlar. */
export const HATA_MESAJLARI: Record<string, string> = {
  [HATA_KODU.DOGRULAMA]: 'Girilen bilgiler geçerli değil.',
  [HATA_KODU.KIMLIK]: 'Kullanıcı adı veya şifre hatalı.',
  [HATA_KODU.YETKI]: 'Bu işlem için yetkiniz yok.',
  [HATA_KODU.BULUNAMADI]: 'Kayıt bulunamadı.',
  [HATA_KODU.CAKISMA]: 'Kayıt başka bir yerde değiştirilmiş.',
  [HATA_KODU.HIZ_LIMITI]: 'Çok fazla istek gönderildi, lütfen biraz bekleyin.',
  [HATA_KODU.SUNUCU]: 'Beklenmeyen bir hata oluştu.',
  [HATA_KODU.STOK_YETERSIZ]: 'Stok yetersiz.',
  [HATA_KODU.URUN_PASIF]: 'Ürün pasif durumda, satışa kapalı.',
  [HATA_KODU.BARKOD_KULLANIMDA]: 'Bu barkod başka bir üründe kayıtlı.',
  [HATA_KODU.KREDI_LIMITI_ASILDI]: 'Müşterinin kredi limiti aşılıyor.',
  [HATA_KODU.KASA_ACIK_DEGIL]: 'Açık bir kasa oturumu yok. Önce kasa açılışı yapın.',
  [HATA_KODU.KASA_ZATEN_ACIK]: 'Bu kullanıcının zaten açık bir kasa oturumu var.',
  [HATA_KODU.SEPET_BOS]: 'Sepet boş.',
  [HATA_KODU.ODEME_EKSIK]: 'Ödeme tutarı genel toplamdan az.',
  [HATA_KODU.ODEME_FAZLA]: 'Nakit dışı ödeme tutarı genel toplamı aşamaz.',
  [HATA_KODU.VERESIYE_MUSTERI_GEREKLI]: 'Veresiye satış için müşteri seçilmelidir.',
  [HATA_KODU.SATIS_ZATEN_IPTAL]: 'Bu satış zaten iptal edilmiş.',
  [HATA_KODU.IADE_MIKTARI_ASILDI]: 'İade miktarı satılan miktarı aşamaz.',
  [HATA_KODU.SEMA_UYUMSUZ]: 'Sunucu ve kasa sürümleri uyumsuz. Lütfen uygulamayı güncelleyin.',
  [HATA_KODU.CIHAZ_YETKISIZ]: 'Bu cihaz senkron için yetkili değil.',
  [HATA_KODU.LISANS_GECERSIZ]: 'Lisans doğrulanamadı.',
  [HATA_KODU.HESAP_KILITLI]: 'Çok fazla hatalı giriş. Hesap geçici olarak kilitlendi.',
};

// ---------------------------------------------------------------------------
// Ayar anahtarları (key-value `ayarlar` tablosu)
// ---------------------------------------------------------------------------

export const AYAR = {
  SEMA_SURUMU: 'schema_version',
  /** POS komisyon oranı (yüzde, örn. "1,8") — Banka/POS raporunda tahmini kesinti. */
  POS_KOMISYON_ORANI: 'pos.komisyon_orani',
  /** POS cihaz türü (POS_TURU) — cihaza özel ayar, merkeze gitmez. */
  POS_TURU: 'pos.turu',
  /** Cihaz bağlantı adresi: ağ POS'unda "192.168.1.50:5000", seri bağlantıda "COM3". */
  POS_ADRES: 'pos.adres',
  /** Cihazdan yanıt beklenecek en uzun süre (saniye). */
  POS_ZAMAN_ASIMI_SN: 'pos.zaman_asimi_sn',
  /** Kasaya bağlı terazi (TERAZI_TURU) — cihaza özel ayar, merkeze gitmez. */
  TERAZI_TURU: 'terazi.turu',
  /** Seri bağlantıda "COM3", ağ terazisinde "192.168.1.60:4001". */
  TERAZI_ADRES: 'terazi.adres',
  /** Seri hız (baud), ör. 9600. */
  TERAZI_BAUD: 'terazi.baud',
  /** Seri çerçeve: "8N1", "7E1", "7O1"… (veri biti, parite, dur biti). */
  TERAZI_CERCEVE: 'terazi.cerceve',
  /**
   * Ağırlık isteme komutu. Boşsa terazi sürekli gönderiyor kabul edilir.
   * Kaçış dizileri: \r \n \x05 (ör. "W\r\n" ya da ENQ için "\x05").
   */
  TERAZI_KOMUT: 'terazi.komut',
  ISLETME_ADI: 'isletme.ad',
  ISLETME_ADRES: 'isletme.adres',
  ISLETME_TELEFON: 'isletme.telefon',
  ISLETME_VERGI_NO: 'isletme.vergi_no',
  FIS_ALT_METIN: 'fis.alt_metin',
  /**
   * Fişin altındaki yasal uyarı (§17.1).
   *
   * Metni işletme belirler ama KALDIRILAMAZ: boş bırakılırsa varsayılan ifade
   * basılır. Mali değeri olmayan bir belgenin bunu söylememesi hem müşteriyi
   * yanıltır hem işletmeyi zor durumda bırakır.
   */
  FIS_YASAL_UYARI: 'fis.yasal_uyari',
  VARSAYILAN_KDV: 'kdv.varsayilan',
  NEGATIF_STOK_IZNI: 'stok.negatif_izin',
  KRITIK_STOK_UYARI: 'stok.kritik_uyari',
  BARKOD_DEBOUNCE_MS: 'barkod.debounce_ms',
  IC_BARKOD_ONEKI: 'barkod.ic_onek',
  /** Terazi barkodunda AĞIRLIK taşıyan ön ekler, virgülle ayrılır (§10.1). */
  TARTI_AGIRLIK_ONEK: 'barkod.tarti_agirlik_onek',
  /** Terazi barkodunda TUTAR taşıyan ön ekler, virgülle ayrılır (§10.1). */
  TARTI_TUTAR_ONEK: 'barkod.tarti_tutar_onek',
  YAZICI_TIPI: 'yazici.tip',
  /** USB modunda seçilen Windows yazıcısının adı (§13.2). */
  YAZICI_USB_ADI: 'yazici.usb_adi',
  YAZICI_HEDEF: 'yazici.hedef',
  YAZICI_GENISLIK: 'yazici.genislik',
  CEKMECE_ACIK: 'yazici.cekmece_ac',
  OTOMATIK_FIS: 'yazici.otomatik_fis',
  /**
   * Fiş, metin yerine GÖRÜNTÜ olarak basılsın mı (§13.2).
   *
   * Açıkken harfleri uygulama çizer ve yazıcının kod sayfası hiç devreye
   * girmez; Türkçe her yazıcıda doğru çıkar. Kapalıyken eski metin yolu
   * kullanılır — yazıcının kendi fontu, dolayısıyla kendi kod sayfası sorunu.
   */
  YAZICI_GORSEL_FIS: 'yazici.gorsel_fis',

  /*
   * ETİKET (BARKOD) YAZICISI — fiş yazıcısından AYRI bir cihazdır (§13.3).
   *
   * Fiş yazıcısı ESC/POS konuşur ve "satır satır ak, sonunda kes" mantığıyla
   * çalışır. Etiket yazıcısı ise TSPL ya da ZPL konuşur ve fiziksel ölçü bilir:
   * kaç mm eninde etiket, aralarında kaç mm boşluk, hangi koordinata ne yazılacak.
   * Bu yüzden ayrı bir yazıcı tanımı ve ayrı ölçü ayarları gerekir.
   *
   * Fiş yazıcısında olduğu gibi bu anahtarlar CİHAZA ÖZELDİR ve senkrona
   * girmez (MERKEZI_AYARLAR listesinde yoktur): her kasanın kendi yazıcısı olur.
   */
  ETIKET_YAZICI_TIPI: 'etiket.yazici_tip',
  ETIKET_YAZICI_HEDEF: 'etiket.yazici_hedef',
  ETIKET_YAZICI_USB_ADI: 'etiket.yazici_usb_adi',
  /** TSPL (TSC/Argox/Xprinter/Godex) ya da ZPL (Zebra). */
  ETIKET_DILI: 'etiket.dil',
  /** Etiket eni (mm). */
  ETIKET_EN_MM: 'etiket.en_mm',
  /** Etiket boyu (mm). */
  ETIKET_BOY_MM: 'etiket.boy_mm',
  /** İki etiket arasındaki boşluk (mm) — rulodaki kesim aralığı. */
  ETIKET_BOSLUK_MM: 'etiket.bosluk_mm',
  /** Yazıcı çözünürlüğü: 203 dpi = 8 nokta/mm, 300 dpi = 12 nokta/mm. */
  ETIKET_DPI: 'etiket.dpi',
  /** Rulodaki yan yana etiket sayısı (1, 2, 3…). */
  ETIKET_SUTUN: 'etiket.sutun',
  /** Isı / koyuluk (0-15). Ucuz etiketlerde düşük değer soluk basar. */
  ETIKET_ISI: 'etiket.isi',
  /** Baskı hızı (inç/sn). */
  ETIKET_HIZ: 'etiket.hiz',
  /** Etikette raf kodu gösterilsin mi. */
  ETIKET_RAF_GOSTER: 'etiket.raf_goster',
  /** Kilo/litre ürünlerde birim fiyat satırı gösterilsin mi. */
  ETIKET_BIRIM_FIYAT_GOSTER: 'etiket.birim_fiyat_goster',
  SENKRON_URL: 'senkron.url',
  SENKRON_MOD: 'senkron.mod',
  SENKRON_ARALIK_DK: 'senkron.aralik_dk',
  SENKRON_GUN_SONU: 'senkron.gun_sonu',
  CIHAZ_ID: 'cihaz.id',
  /** Merkezce atanan fiş serisi. Boşsa cihaz kimliğinden türetilir (§10.2). */
  CIHAZ_SERI: 'cihaz.seri',
  CIHAZ_ADI: 'cihaz.ad',
  LISANS_ANAHTARI: 'lisans.anahtar',
  YEDEK_KLASOR: 'yedek.klasor',
  YEDEK_IKINCIL_KLASOR: 'yedek.ikincil_klasor',
  YEDEK_SAKLANAN_ADET: 'yedek.saklanan_adet',
  /** Gönderilmiş senkron olaylarının diskte tutulacağı gün sayısı (§18.4). */
  OLAY_SAKLAMA_GUN: 'bakim.olay_saklama_gun',
  /** Denetim logu saklama süresi, gün (§17.5). Mali kayıtları etkilemez. */
  DENETIM_SAKLAMA_GUN: 'bakim.denetim_saklama_gun',
  YEDEK_SIKLIK_SAAT: 'yedek.siklik_saat',
  KURULUM_TAMAMLANDI: 'kurulum.tamamlandi',
  URUN_MUHTELIF_ID: 'urun.muhtelif_id',
  TEMA: 'gorunum.tema',
  YAZI_BOYUTU: 'gorunum.yazi_boyutu',
  OTURUM_ZAMAN_ASIMI_DK: 'guvenlik.oturum_zaman_asimi_dk',
  KREDI_LIMITI_DAVRANISI: 'cari.limit_davranisi',
  KASA_FARKI_ESIGI: 'kasa.fark_esigi',
  DEMO_MODU: 'demo.aktif',
} as const;

export const SENKRON_MODU = ['MANUEL', 'GUN_SONU', 'FIRSATCI'] as const;
export type SenkronModu = (typeof SENKRON_MODU)[number];

export const LIMIT_DAVRANISI = ['UYAR', 'ENGELLE', 'IZIN_VER'] as const;
export type LimitDavranisi = (typeof LIMIT_DAVRANISI)[number];

/**
 * Fiş yazıcısının bağlantı yolu (§13.2).
 *
 * `OTOMATIK` bir bağlantı tipi değil, bir SIRADIR: önce USB denenir, o yoksa
 * ağ. Tek kasada USB, yedekli kurulumda ikisi birden bulunan işletmeler için;
 * kasiyerin yazıcı arızasında ayar değiştirmesi gerekmez.
 *
 * `DOSYA` ve `WINDOWS_PAYLASIM` eski kurulumlar için durur; yeni kurulumda
 * USB seçimi bunların yerini alır.
 */
export const YAZICI_TIPI = ['YOK', 'USB', 'AG', 'OTOMATIK', 'DOSYA', 'WINDOWS_PAYLASIM'] as const;
export type YaziciTipi = (typeof YAZICI_TIPI)[number];

/**
 * Etiket yazıcısı komut dili (§13.3).
 *
 * TSPL: TSC, Argox, Godex, Xprinter (XP-365B/370B) — uygun fiyatlı segmentin
 * neredeyse tamamı. ZPL: Zebra. İkisi de desteklenir çünkü yazıcı satın
 * alınmadan hangisinin geleceği bilinmiyordu; ayardan seçilir.
 */
export const ETIKET_DILI = ['TSPL', 'ZPL'] as const;
export type EtiketDili = (typeof ETIKET_DILI)[number];

/** Etiket ölçüsü varsayılanları — kullanıcı rulosuna göre ayarlardan değiştirir. */
export const ETIKET_VARSAYILAN = {
  EN_MM: 40,
  BOY_MM: 30,
  BOSLUK_MM: 2,
  DPI: 203,
  SUTUN: 1,
  ISI: 8,
  HIZ: 4,
} as const;

// ---------------------------------------------------------------------------
// Operasyonel sınırlar
// ---------------------------------------------------------------------------

export const SINIRLAR = {
  /** Bir senkron push isteğinde gönderilecek azami olay sayısı (§6.5 toplu yazma). */
  PUSH_BATCH: 500,
  /** Bir pull isteğinde çekilecek azami kayıt sayısı. */
  PULL_LIMIT: 500,
  /** Sunucunun kabul edeceği azami olay sayısı — DoS koruması (§15.3). */
  PUSH_BATCH_AZAMI: 1000,
  /** Üstel geri çekilmede azami bekleme (ms) — §7.6. */
  BACKOFF_AZAMI_MS: 5 * 60 * 1000,
  /** Ardışık hatalı giriş sonrası kilit (§15.4). */
  HATALI_GIRIS_SINIRI: 5,
  HESAP_KILIT_SN: 60,
  /** Aynı barkodun tekrar okunmasını yok sayma eşiği (§20 debounce). */
  BARKOD_DEBOUNCE_MS: 120,
  /** Bir satışta izin verilen azami kalem sayısı. */
  SEPET_AZAMI_SATIR: 500,
  /** Senkron yapılmadığında kırmızı uyarıya geçilecek gün sayısı (§7.6). */
  SENKRON_KRITIK_GUN: 3,
} as const;

export const PARA_BIRIMI = '₺';
export const YEREL = 'tr-TR';
export const ZAMAN_DILIMI = 'Europe/Istanbul';
