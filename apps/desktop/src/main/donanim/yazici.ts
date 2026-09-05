/**
 * Yazıcı ve çekmece adaptörleri (§4.2 donanım soyutlaması, §13.2).
 *
 * KRİTİK İLKE (§20): Satış **yazıcıya bağımlı değildir.** Yazıcı kapalıysa,
 * kağıdı bittiyse ya da ağda yoksa satış yine kesinleşir; fiş "yazdırılamadı"
 * olarak işaretlenir ve sonradan tekrar yazdırılabilir.
 */

import { createWriteStream, mkdirSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname } from 'node:path';
import { EscPosYazici } from './escpos.js';

export type YaziciTipiDb = 'YOK' | 'USB' | 'AG' | 'OTOMATIK' | 'DOSYA' | 'WINDOWS_PAYLASIM';

export interface YaziciAyari {
  tip: YaziciTipiDb;
  /** AG için "host:port", DOSYA/WINDOWS_PAYLASIM için dosya yolu ya da UNC. */
  hedef: string;
  /**
   * USB modunda seçilen yazıcının adı.
   *
   * RAW ESC/POS göndermek doğrudan bir bayt kanalı ister; Windows'ta bu,
   * yazıcının paylaşıma açılıp `\\localhost\<ad>` üzerinden yazılmasıyla
   * olur. Sürücü üzerinden isimle RAW basmak yerel modül gerektirir.
   */
  usbAdi?: string;
  satirGenisligi: number;
  cekmeceAc: boolean;
  zamanAsimiMs?: number;
}

export interface YazdirmaSonucu {
  basarili: boolean;
  hata?: string;
  /** Yazıcı yoksa üretilen metin önizlemesi (ekranda gösterilir). */
  onizleme?: string;
}

export interface Yazici {
  readonly tip: YaziciTipiDb;
  yazdir(baytlar: Buffer): Promise<YazdirmaSonucu>;
  cekmeceyiAc(): Promise<YazdirmaSonucu>;
  test(): Promise<YazdirmaSonucu>;
}

// ---------------------------------------------------------------------------
// Ağ yazıcısı (TCP 9100 — RAW / JetDirect)
// ---------------------------------------------------------------------------

class AgYazicisi implements Yazici {
  readonly tip = 'AG' as const;

  constructor(private readonly ayar: YaziciAyari) {}

  private hedefCoz(): { host: string; port: number } {
    const [host = '', portMetni] = this.ayar.hedef.split(':');
    const port = Number(portMetni ?? 9100);
    return { host: host.trim(), port: Number.isFinite(port) && port > 0 ? port : 9100 };
  }

  async yazdir(baytlar: Buffer): Promise<YazdirmaSonucu> {
    const { host, port } = this.hedefCoz();
    if (!host) return { basarili: false, hata: 'Yazıcı adresi tanımlı değil.' };

    return new Promise((cozumle) => {
      const soket = connect({ host, port });
      const zamanAsimi = this.ayar.zamanAsimiMs ?? 5000;
      let tamamlandi = false;

      const bitir = (sonuc: YazdirmaSonucu) => {
        if (tamamlandi) return;
        tamamlandi = true;
        soket.destroy();
        cozumle(sonuc);
      };

      soket.setTimeout(zamanAsimi);
      soket.on('timeout', () => bitir({ basarili: false, hata: `Yazıcı yanıt vermiyor (${host}:${port}).` }));
      soket.on('error', (hata) => bitir({ basarili: false, hata: `Yazıcıya bağlanılamadı: ${hata.message}` }));
      soket.on('connect', () => {
        soket.write(baytlar, (hata) => {
          if (hata) bitir({ basarili: false, hata: `Yazdırma hatası: ${hata.message}` });
          else soket.end(() => bitir({ basarili: true }));
        });
      });
    });
  }

  async cekmeceyiAc(): Promise<YazdirmaSonucu> {
    return this.yazdir(new EscPosYazici(this.ayar.satirGenisligi).cekmeceAc().bitir());
  }

  async test(): Promise<YazdirmaSonucu> {
    return this.yazdir(testFisi(this.ayar.satirGenisligi));
  }
}

// ---------------------------------------------------------------------------
// Dosya / paylaşılan yazıcı (COM portu, LPT, UNC yolu)
// ---------------------------------------------------------------------------

class DosyaYazicisi implements Yazici {
  readonly tip: YaziciTipiDb;

  constructor(private readonly ayar: YaziciAyari) {
    this.tip = ayar.tip === 'WINDOWS_PAYLASIM' ? 'WINDOWS_PAYLASIM' : 'DOSYA';
  }

  async yazdir(baytlar: Buffer): Promise<YazdirmaSonucu> {
    const hedef = this.ayar.hedef.trim();
    if (!hedef) return { basarili: false, hata: 'Yazıcı hedefi tanımlı değil.' };

    return new Promise((cozumle) => {
      try {
        // UNC ve aygıt yolları (COM1, \\PC\yazici) için klasör oluşturma denenmez.
        if (!hedef.startsWith('\\\\') && !/^[A-Za-z]{3}\d?:?$/.test(hedef)) {
          try {
            mkdirSync(dirname(hedef), { recursive: true });
          } catch {
            /* aygıt yolu olabilir */
          }
        }
        const akis = createWriteStream(hedef, { flags: 'a' });
        akis.on('error', (hata) => cozumle({ basarili: false, hata: `Yazıcıya yazılamadı: ${hata.message}` }));
        akis.write(baytlar, (hata) => {
          if (hata) cozumle({ basarili: false, hata: `Yazdırma hatası: ${hata.message}` });
          else akis.end(() => cozumle({ basarili: true }));
        });
      } catch (hata) {
        cozumle({ basarili: false, hata: hata instanceof Error ? hata.message : String(hata) });
      }
    });
  }

  async cekmeceyiAc(): Promise<YazdirmaSonucu> {
    return this.yazdir(new EscPosYazici(this.ayar.satirGenisligi).cekmeceAc().bitir());
  }

  async test(): Promise<YazdirmaSonucu> {
    return this.yazdir(testFisi(this.ayar.satirGenisligi));
  }
}

// ---------------------------------------------------------------------------
// Yazıcı yok — önizleme modu
// ---------------------------------------------------------------------------

class SanalYazici implements Yazici {
  readonly tip = 'YOK' as const;

  constructor(private readonly satirGenisligi: number) {}

  async yazdir(baytlar: Buffer): Promise<YazdirmaSonucu> {
    return { basarili: true, onizleme: EscPosYazici.onizleme(baytlar) };
  }

  async cekmeceyiAc(): Promise<YazdirmaSonucu> {
    return { basarili: true };
  }

  async test(): Promise<YazdirmaSonucu> {
    return this.yazdir(testFisi(this.satirGenisligi));
  }
}

/**
 * Birden çok yazıcıyı SIRAYLA dener; ilk başaran kazanır (§13.2).
 *
 * "Otomatik" modun karşılığı. Kasiyer yazıcı arızalandığında ayarlara girip
 * tip değiştirmek zorunda kalmasın diye vardır: USB kablosu çıkmışsa ağdaki
 * yazıcı devreye girer, kimse fark etmez.
 *
 * Hepsi başarısızsa SON hatayı döndürür — "hiçbiri çalışmadı" demek yerine
 * kullanıcıya somut sebebi göstermek gerekir.
 */
class SirasiylaYazici implements Yazici {
  readonly tip = 'OTOMATIK' as const;

  constructor(private readonly adaylar: Yazici[]) {}

  private async dene(is: (y: Yazici) => Promise<YazdirmaSonucu>): Promise<YazdirmaSonucu> {
    if (this.adaylar.length === 0) return { basarili: false, hata: 'Yazıcı tanımlı değil.' };
    let son: YazdirmaSonucu = { basarili: false, hata: 'Yazıcı tanımlı değil.' };
    for (const aday of this.adaylar) {
      son = await is(aday);
      if (son.basarili) return son;
    }
    return son;
  }

  yazdir(baytlar: Buffer): Promise<YazdirmaSonucu> {
    return this.dene((y) => y.yazdir(baytlar));
  }

  cekmeceyiAc(): Promise<YazdirmaSonucu> {
    return this.dene((y) => y.cekmeceyiAc());
  }

  test(): Promise<YazdirmaSonucu> {
    return this.dene((y) => y.test());
  }
}

/**
 * Seçilen Windows yazıcısını RAW yazılabilir bir yola çevirir.
 *
 * Zaten UNC ya da aygıt yolu verilmişse olduğu gibi kullanılır; yalnız yazıcı
 * ADI verilmişse yerel paylaşım yoluna dönüştürülür.
 */
function usbHedefi(usbAdi: string): string {
  const ad = usbAdi.trim();
  if (!ad) return '';
  if (ad.startsWith('\\\\') || /^[A-Za-z]{3}\d?:?$/.test(ad)) return ad;
  return `\\\\localhost\\${ad}`;
}

export function yaziciOlustur(ayar: YaziciAyari): Yazici {
  const usb = () => new DosyaYazicisi({ ...ayar, tip: 'WINDOWS_PAYLASIM', hedef: usbHedefi(ayar.usbAdi ?? '') });

  switch (ayar.tip) {
    case 'AG':
      return new AgYazicisi(ayar);
    case 'USB':
      return usb();
    case 'OTOMATIK':
      // SIRA ÖNEMLİ: kasadaki yazıcı USB'dir, ağ yedektir. Ters sırada her
      // fişte önce ağ zaman aşımı beklenir ve satış yavaşlar.
      return new SirasiylaYazici([usb(), new AgYazicisi(ayar)]);
    case 'DOSYA':
    case 'WINDOWS_PAYLASIM':
      return new DosyaYazicisi(ayar);
    default:
      return new SanalYazici(ayar.satirGenisligi);
  }
}

export function testFisi(satirGenisligi = 48): Buffer {
  return new EscPosYazici(satirGenisligi)
    .baslat()
    .hizala('orta')
    .boyut(2)
    .satir('TEST FİŞİ')
    .boyut(1)
    .satir('Market Otomasyon')
    .ayirici()
    .hizala('sol')
    .satir('Türkçe karakter testi:')
    .satir('ç Ç ğ Ğ ı İ ö Ö ş Ş ü Ü')
    .ikiSutun('Örnek ürün', '12,50 TL')
    .ikiSutun('TOPLAM', '12,50 TL')
    .ayirici()
    .hizala('orta')
    .satir('Yazıcı çalışıyor.')
    .satir(new Date().toLocaleString('tr-TR'))
    .kes()
    .bitir();
}
