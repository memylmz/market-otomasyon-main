/**
 * Metin normalleştirme — Türkçe arama için.
 *
 * Kasiyerin "sut" yazıp "Süt"ü, "ic" yazıp "İçecek"i bulabilmesi gerekir.
 * JS'in varsayılan `toLowerCase()` işlemi Türkçe'ye uygun değildir
 * ('İ'.toLowerCase() birleşik noktalı bir 'i' üretir), bu yüzden harf eşlemesi
 * açıkça yapılır.
 */

const HARF_HARITASI: Readonly<Record<string, string>> = {
  ı: 'i',
  İ: 'i',
  I: 'i',
  ş: 's',
  Ş: 's',
  ğ: 'g',
  Ğ: 'g',
  ü: 'u',
  Ü: 'u',
  ö: 'o',
  Ö: 'o',
  ç: 'c',
  Ç: 'c',
  â: 'a',
  Â: 'a',
  î: 'i',
  Î: 'i',
  û: 'u',
  Û: 'u',
};

/**
 * Aramada kullanılacak sadeleştirilmiş biçim: aksansız, küçük harf,
 * fazla boşlukları temizlenmiş. Veritabanındaki `arama_metni` sütunu bu
 * fonksiyonla üretilir; sorgu terimi de aynı fonksiyondan geçirilir.
 */
export function aramaNormalize(metin: string): string {
  return metin
    .normalize('NFC')
    .replace(/[ıİIşŞğĞüÜöÖçÇâÂîÎûÛ]/g, (harf) => HARF_HARITASI[harf] ?? harf)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ürün/cari kaydı için aranabilir tüm alanları tek metinde birleştirir. */
export function aramaMetniOlustur(...parcalar: (string | null | undefined)[]): string {
  return aramaNormalize(parcalar.filter(Boolean).join(' '));
}

/**
 * Türkçe alfabetik sıralama anahtarı.
 *
 * SQLite'ın yerleşik sıralaması ikilidir (binary): büyük harfler küçüklerden,
 * "Z" harfi "ç"den önce gelir. Bu fonksiyon metni, **ikili karşılaştırıldığında
 * Türk alfabesi sırasını veren** bir anahtara çevirir; anahtar hem SQL'de
 * (`tr_sira()` fonksiyonu olarak kayıtlı) hem arayüzde kullanılabilir.
 *
 * Kurallar: büyük/küçük harf farkı yoktur; ç ğ ı i ö ş ü doğru yerdedir;
 * rakamlar harflerden önce gelir.
 */
const TURK_ALFABESI = 'abcçdefgğhıijklmnoöpqrsştuüvwxyz';
const SIRA_HARITASI: Readonly<Record<string, string>> = Object.fromEntries(
  [...TURK_ALFABESI].map((harf, i) => [harf, String.fromCharCode(65 + i)]),
);

export function turkceSiralamaAnahtari(metin: string): string {
  const kucuk = metin
    .normalize('NFC')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .replace(/[âÂ]/g, 'a')
    .replace(/[îÎ]/g, 'i')
    .replace(/[ûÛ]/g, 'u')
    .toLocaleLowerCase('tr-TR')
    .trim();
  let anahtar = '';
  for (const harf of kucuk) anahtar += SIRA_HARITASI[harf] ?? harf;
  return anahtar;
}

/** SQL LIKE kalıbındaki özel karakterleri kaçırır (ESCAPE '\' ile kullanılır). */
export function likeKacir(terim: string): string {
  return terim.replace(/[\\%_]/g, (k) => '\\' + k);
}

/** Uzun metni kırpar (log ve liste gösterimi için). */
export function kirp(metin: string, azami: number): string {
  return metin.length <= azami ? metin : metin.slice(0, Math.max(0, azami - 1)) + '…';
}
