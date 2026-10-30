/**
 * Yazıcı ve çekmece adaptörleri (§4.2 donanım soyutlaması, §13.2).
 *
 * KRİTİK İLKE (§20): Satış **yazıcıya bağımlı değildir.** Yazıcı kapalıysa,
 * kağıdı bittiyse ya da ağda yoksa satış yine kesinleşir; fiş "yazdırılamadı"
 * olarak işaretlenir ve sonradan tekrar yazdırılabilir.
 */

import { execFile } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { EscPosYazici } from './escpos.js';

export type YaziciTipiDb = 'YOK' | 'USB' | 'AG' | 'OTOMATIK' | 'DOSYA' | 'WINDOWS_PAYLASIM';

export interface YaziciAyari {
  tip: YaziciTipiDb;
  /** AG için "host:port", DOSYA/WINDOWS_PAYLASIM için dosya yolu ya da UNC. */
  hedef: string;
  /**
   * USB modunda seçilen yazıcının adı.
   *
   * RAW ESC/POS göndermek doğrudan bir bayt kanalı ister. Önce hızlı yol
   * denenir: yazıcı paylaşıma açıksa `\\localhost\<ad>`. Paylaşım kapalıysa
   * baytlar Windows yazdırma kuyruğuna (winspool, RAW) bırakılır — paylaşım
   * gerekmez, yalnız bir iki saniye daha yavaştır.
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
      soket.on('timeout', () =>
        bitir({
          basarili: false,
          hata: `Yazıcı yanıt vermiyor (${host}:${port}). Yazıcı açık mı ve IP doğru mu kontrol edin.`,
        }),
      );
      soket.on('error', (hata) => bitir({ basarili: false, hata: agHatasiniAcikla(hata, host, port) }));
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
// Windows yazdırma kuyruğu (winspool RAW) — paylaşım gerektirmez
// ---------------------------------------------------------------------------

/*
 * Kuyruğa RAW yazmanın Node'da yerel modülsüz yolu: Windows'la gelen
 * PowerShell, winspool.drv'yi doğrudan çağırır. Betik geçici klasöre bir kez
 * yazılır; yazıcı adı ve bayt dosyası ortam değişkeniyle geçer (tırnak/kaçış
 * derdi yok).
 */
const KUYRUK_BETIGI = String.raw`$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class MoHamYazici {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool OpenPrinter(string ad, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] public static extern int StartDocPrinter(IntPtr h, int seviye, DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int yazilan);
  public static string Yaz(string ad, byte[] veri) {
    IntPtr h;
    if (!OpenPrinter(ad, out h, IntPtr.Zero)) return "OPEN " + Marshal.GetLastWin32Error();
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = "AKYSOFTMARKETV1"; di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) return "DOC " + Marshal.GetLastWin32Error();
      try {
        StartPagePrinter(h);
        int yazilan;
        bool tamam = WritePrinter(h, veri, veri.Length, out yazilan);
        EndPagePrinter(h);
        if (!tamam || yazilan != veri.Length) return "WRITE " + Marshal.GetLastWin32Error();
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
    return "";
  }
}
"@
$sonuc = [MoHamYazici]::Yaz($env:MO_YAZICI, [IO.File]::ReadAllBytes($env:MO_DOSYA))
if ($sonuc) { [Console]::Error.Write($sonuc); exit 2 }
`;

function kuyrukBetigiYolu(): string {
  const yol = join(tmpdir(), 'market-otomasyon-ham-yazdir-v1.ps1');
  if (!existsSync(yol)) writeFileSync(yol, KUYRUK_BETIGI, 'utf8');
  return yol;
}

class KuyrukYazicisi implements Yazici {
  readonly tip = 'USB' as const;

  constructor(
    private readonly yaziciAdi: string,
    private readonly satirGenisligi: number,
  ) {}

  async yazdir(baytlar: Buffer): Promise<YazdirmaSonucu> {
    if (process.platform !== 'win32') return { basarili: false, hata: 'Yazdırma kuyruğu yalnız Windows’ta kullanılabilir.' };
    const dosya = join(tmpdir(), `mo-fis-${process.pid}-${Date.now()}.bin`);
    writeFileSync(dosya, baytlar);
    return new Promise((cozumle) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', kuyrukBetigiYolu()],
        { env: { ...process.env, MO_YAZICI: this.yaziciAdi, MO_DOSYA: dosya }, timeout: 30_000, windowsHide: true },
        (hata, _cikti, hataCiktisi) => {
          rmSync(dosya, { force: true });
          if (!hata) return cozumle({ basarili: true });
          const kod = String(hataCiktisi ?? '').trim();
          if (kod.startsWith('OPEN 1801')) {
            return cozumle({
              basarili: false,
              hata: `Windows'ta "${this.yaziciAdi}" adlı yazıcı bulunamadı. Ayarlardan yazıcıyı yeniden seçin.`,
            });
          }
          cozumle({
            basarili: false,
            hata: `"${this.yaziciAdi}" yazıcısına gönderilemedi (${kod || hata.message}). Yazıcı açık ve kablosu takılı mı?`,
          });
        },
      );
    });
  }

  async cekmeceyiAc(): Promise<YazdirmaSonucu> {
    return this.yazdir(new EscPosYazici(this.satirGenisligi).cekmeceAc().bitir());
  }

  async test(): Promise<YazdirmaSonucu> {
    return this.yazdir(testFisi(this.satirGenisligi));
  }
}

/**
 * USB (Windows'a kurulu) yazıcı: önce paylaşım yolu, olmazsa yazdırma kuyruğu.
 *
 * Eskiden yalnız `\\localhost\<ad>` deneniyordu; yazıcı paylaşıma açık
 * değilse ("UNKNOWN: unknown error, open '\\localhost\POS-80C\'") fiş hiç
 * çıkmıyordu ve kullanıcı Windows'ta paylaşım ayarı yapmak zorundaydı.
 * Paylaşım bir kez başarısız olunca o yazıcı için doğrudan kuyruğa gidilir:
 * her fişte önce başarısız yolu beklemek gereksiz.
 */
const paylasimiOlmayanlar = new Set<string>();

class UsbYazicisi implements Yazici {
  readonly tip = 'USB' as const;
  private readonly paylasim: DosyaYazicisi;
  private readonly kuyruk: KuyrukYazicisi | null;

  constructor(private readonly ayar: YaziciAyari) {
    const ad = (ayar.usbAdi ?? '').trim();
    this.paylasim = new DosyaYazicisi({ ...ayar, tip: 'WINDOWS_PAYLASIM', hedef: usbHedefi(ad) });
    // UNC ya da aygıt yolu verilmişse kuyruk yolu yok: o zaten bir dosya hedefidir.
    const yalnizAd = Boolean(ad) && !ad.startsWith('\\\\') && !/^[A-Za-z]{3}\d?:?$/.test(ad);
    this.kuyruk = yalnizAd && process.platform === 'win32' ? new KuyrukYazicisi(ad, ayar.satirGenisligi) : null;
  }

  private async dene(baytlar: Buffer): Promise<YazdirmaSonucu> {
    const ad = (this.ayar.usbAdi ?? '').trim();
    if (this.kuyruk && paylasimiOlmayanlar.has(ad)) return this.kuyruk.yazdir(baytlar);
    const sonuc = await this.paylasim.yazdir(baytlar);
    if (sonuc.basarili || !this.kuyruk) return sonuc;
    paylasimiOlmayanlar.add(ad);
    return this.kuyruk.yazdir(baytlar);
  }

  yazdir(baytlar: Buffer): Promise<YazdirmaSonucu> {
    return this.dene(baytlar);
  }

  cekmeceyiAc(): Promise<YazdirmaSonucu> {
    return this.dene(new EscPosYazici(this.ayar.satirGenisligi).cekmeceAc().bitir());
  }

  test(): Promise<YazdirmaSonucu> {
    return this.dene(testFisi(this.ayar.satirGenisligi));
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

/** Adres yerel ağa mı ait? macOS izni yalnız yerel ağı kısıtlar. */
function yerelAgMi(host: string): boolean {
  return /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host);
}

/**
 * Ağ hatasını kullanıcının ne yapacağını bilebileceği bir cümleye çevirir (§20).
 *
 * `EHOSTUNREACH` özel bir durumdur ve tanısı zordur: macOS 15'ten beri
 * uygulamaların YEREL AĞA erişimi ayrı bir izne bağlıdır ve izin verilmemişse
 * bağlantı tam olarak bu kodla düşer. Yazıcıya `ping` atılabiliyor, terminalden
 * bağlanılabiliyor ama uygulama bağlanamıyor — kullanıcı da haklı olarak
 * "ağda sorun yok, program bozuk" diye düşünüyor. Yönlendiriciye erişim izinden
 * MUAF olduğu için sorun daha da kafa karıştırıcı görünür.
 */
function agHatasiniAcikla(hata: NodeJS.ErrnoException, host: string, port: number): string {
  const adres = `${host}:${port}`;
  switch (hata.code) {
    case 'EHOSTUNREACH':
      return yerelAgMi(host)
        ? `Yazıcıya ulaşılamıyor (${adres}). macOS'ta uygulamanın yerel ağ izni kapalı olabilir: ` +
            'Sistem Ayarları → Gizlilik ve Güvenlik → Yerel Ağ listesinden uygulamayı açın. ' +
            'Ağ kablosu ve IP doğruysa sebep genelde budur.'
        : `Yazıcıya ulaşılamıyor (${adres}).`;
    case 'ECONNREFUSED':
      return `${adres} adresinde bir cihaz var ama bağlantıyı reddetti. Yazıcının RAW/JetDirect portu genelde 9100'dür; port numarasını kontrol edin.`;
    case 'ENETUNREACH':
      return `${adres} adresine giden bir yol yok. Yazıcı bu bilgisayarla aynı ağda mı?`;
    case 'ETIMEDOUT':
      return `${adres} yanıt vermedi. Yazıcı kapalı olabilir ya da IP yanlış olabilir.`;
    default:
      return `Yazıcıya bağlanılamadı (${adres}): ${hata.message}`;
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
  const usb = () => new UsbYazicisi(ayar);

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
    .satir('AKYSOFTMARKETV1')
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
