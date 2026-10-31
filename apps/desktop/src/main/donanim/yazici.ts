/**
 * Yazıcı ve çekmece adaptörleri (§4.2 donanım soyutlaması, §13.2).
 *
 * KRİTİK İLKE (§20): Satış **yazıcıya bağımlı değildir.** Yazıcı kapalıysa,
 * kağıdı bittiyse ya da ağda yoksa satış yine kesinleşir; fiş "yazdırılamadı"
 * olarak işaretlenir ve sonradan tekrar yazdırılabilir.
 */

import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
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
const HAM_YAZICI_TIPI = String.raw`$kaynak = @"
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
<# Derlenmiş tip geçici klasörde DLL olarak saklanır: C# derlemesi (csc + virüs
   taraması) yavaş kasada saniyeler sürer; DLL'i yüklemek ~0,1 sn. Dosya bozuk
   ya da kilitliyse bellekte derlenir. Kaynak değişirse adındaki sürüm artar. #>
$dll = Join-Path ([IO.Path]::GetTempPath()) 'market-otomasyon-ham-yazici-v1.dll'
if (-not (Test-Path $dll)) { try { Add-Type -TypeDefinition $kaynak -OutputAssembly $dll } catch { } }
try { Add-Type -Path $dll } catch { Add-Type -TypeDefinition $kaynak }
`;

const KUYRUK_BETIGI = String.raw`$ErrorActionPreference = 'Stop'
${HAM_YAZICI_TIPI}
$sonuc = [MoHamYazici]::Yaz($env:MO_YAZICI, [IO.File]::ReadAllBytes($env:MO_DOSYA))
if ($sonuc) { [Console]::Error.Write($sonuc); exit 2 }
`;

/*
 * SUNUCU KİPİ — fiş başına PowerShell açılmaz.
 *
 * Tek seferlik betikte her fiş PowerShell'i başlatıp C# tipini YENİDEN
 * derliyordu: güçlü bilgisayarda ~1 sn, kasa bilgisayarında 2-3 sn. Çekmece
 * de ayrı bir iş olunca fiş ve çekmece 5-6 sn gecikiyordu. Süreç bir kez
 * açılır, tip bir kez derlenir; her iş tek satırdır:
 *   <yazıcı adı (UTF-8, base64)> TAB <baytlar (base64)>
 * Yanıt: "OK" ya da "ERR <kod>".
 */
const SUNUCU_BETIGI = String.raw`$ErrorActionPreference = 'Stop'
${HAM_YAZICI_TIPI}
[Console]::Out.WriteLine('HAZIR'); [Console]::Out.Flush()
while ($true) {
  $satir = [Console]::In.ReadLine()
  if ($satir -eq $null) { break }
  if ($satir -eq '') { continue }
  try {
    $p = $satir.Split([char]9)
    $ad = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[0]))
    $sonuc = [MoHamYazici]::Yaz($ad, [Convert]::FromBase64String($p[1]))
  } catch { $sonuc = 'HATA ' + ($_.Exception.Message -replace '\s+', ' ') }
  if ($sonuc) { [Console]::Out.WriteLine('ERR ' + $sonuc) } else { [Console]::Out.WriteLine('OK') }
  [Console]::Out.Flush()
}
`;

function betikYolu(ad: string, icerik: string): string {
  const yol = join(tmpdir(), ad);
  if (!existsSync(yol)) writeFileSync(yol, icerik, 'utf8');
  return yol;
}

const kuyrukBetigiYolu = () => betikYolu('market-otomasyon-ham-yazdir-v2.ps1', KUYRUK_BETIGI);

/**
 * İş sürece GÖNDERİLDİKTEN sonra yanıt gelmedi: fiş basılmış olabilir.
 * Bu durumda yedek yoldan tekrar basılmaz — fiş iki kez çıkmasın.
 */
class GonderildiHatasi extends Error {}

/** Hazır bekleyen tek PowerShell süreci; işler sırayla gönderilir. */
class YaziciSunucusu {
  private surec: ChildProcessWithoutNullStreams | null = null;
  private hazir: Promise<void> | null = null;
  private tampon = '';
  private bekleyen: ((satir: string) => void) | null = null;
  private sira: Promise<unknown> = Promise.resolve();

  /** Süreci açar ve tipi derletir (ilk fişi beklemeden, program açılırken çağrılabilir). */
  isit(): Promise<void> {
    if (this.hazir) return this.hazir;
    const hazir = new Promise<void>((coz, reddet) => {
      const surec = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          betikYolu('market-otomasyon-ham-yazdir-sunucu-v2.ps1', SUNUCU_BETIGI),
        ],
        { windowsHide: true },
      );
      this.surec = surec;
      this.tampon = '';
      let basladi = false;
      const zaman = setTimeout(() => {
        reddet(new Error('Yazdırma süreci başlamadı.'));
        this.kapat();
      }, 20_000);
      surec.stdout.setEncoding('utf8');
      surec.stdout.on('data', (parca: string) => {
        this.tampon += parca;
        let i: number;
        while ((i = this.tampon.indexOf('\n')) >= 0) {
          const satir = this.tampon.slice(0, i).trim();
          this.tampon = this.tampon.slice(i + 1);
          if (!basladi) {
            if (satir === 'HAZIR') {
              basladi = true;
              clearTimeout(zaman);
              coz();
            }
            continue;
          }
          const b = this.bekleyen;
          this.bekleyen = null;
          b?.(satir);
        }
      });
      surec.stderr.resume();
      // Süreç kapandıktan sonra yazmak EPIPE verir; dinlenmezse ana süreç çöker.
      surec.stdin.on('error', () => {
        if (this.surec === surec) this.kapat();
      });
      surec.on('error', (hata) => {
        clearTimeout(zaman);
        if (this.surec === surec) this.kapat();
        reddet(hata);
      });
      surec.on('exit', () => {
        clearTimeout(zaman);
        if (this.surec === surec) this.kapat();
        reddet(new Error('Yazdırma süreci kapandı.'));
      });
    });
    this.hazir = hazir;
    // Başlamazsa bir sonraki iş yeniden dener.
    hazir.catch(() => {
      if (this.hazir === hazir) this.hazir = null;
    });
    return hazir;
  }

  /** Yanıt "" (başarılı) ya da hata kodu; süreç kullanılamıyorsa hata fırlatır. */
  yaz(yaziciAdi: string, baytlar: Buffer): Promise<string> {
    const is = this.sira.then(async () => {
      await this.isit();
      const surec = this.surec;
      // Henüz hiçbir şey gönderilmedi: düz hata → yedek yol güvenle denenir.
      if (!surec || surec.exitCode !== null || surec.stdin.destroyed) throw new Error('Yazdırma süreci yok.');
      const satir = await new Promise<string>((coz, reddet) => {
        // Her işin dinleyicisi iş bitince kaldırılır (yüzlerce fişte birikmesin).
        const bitir = () => {
          clearTimeout(zaman);
          surec.off('exit', kapandi);
          this.bekleyen = null;
        };
        const kapandi = () => {
          bitir();
          reddet(new GonderildiHatasi('Yazdırma süreci iş sırasında kapandı.'));
        };
        const zaman = setTimeout(() => {
          bitir();
          this.kapat();
          reddet(new GonderildiHatasi('Yazdırma süreci yanıt vermedi.'));
        }, 20_000);
        this.bekleyen = (yanit) => {
          bitir();
          coz(yanit);
        };
        surec.once('exit', kapandi);
        surec.stdin.write(`${Buffer.from(yaziciAdi, 'utf8').toString('base64')}\t${baytlar.toString('base64')}\n`);
      });
      return satir === 'OK' ? '' : satir.replace(/^ERR\s*/, '');
    });
    this.sira = is.catch(() => undefined);
    return is;
  }

  kapat(): void {
    const s = this.surec;
    this.surec = null;
    this.hazir = null;
    this.bekleyen = null;
    if (s && s.exitCode === null) s.kill();
  }
}

const yaziciSunucusu = new YaziciSunucusu();

/** Program açılışında: ilk fiş tip derlemesini beklemesin. Windows dışında bir şey yapmaz. */
export function yazdirmaKuyrugunuIsit(): void {
  if (process.platform === 'win32') yaziciSunucusu.isit().catch(() => undefined);
}

/** Uygulama kapanırken. */
export function yazdirmaKuyrugunuKapat(): void {
  yaziciSunucusu.kapat();
}

class KuyrukYazicisi implements Yazici {
  readonly tip = 'USB' as const;

  constructor(
    private readonly yaziciAdi: string,
    private readonly satirGenisligi: number,
  ) {}

  async yazdir(baytlar: Buffer): Promise<YazdirmaSonucu> {
    return (await this.gonder(baytlar)).sonuc;
  }

  /** `acilamadi`: yazıcı hiç açılamadı (OPEN), yani hiçbir bayt gitmedi. */
  async gonder(baytlar: Buffer): Promise<{ sonuc: YazdirmaSonucu; acilamadi: boolean }> {
    if (process.platform !== 'win32') {
      return { sonuc: { basarili: false, hata: 'Yazdırma kuyruğu yalnız Windows’ta kullanılabilir.' }, acilamadi: true };
    }
    let kod: string;
    try {
      kod = await yaziciSunucusu.yaz(this.yaziciAdi, baytlar);
    } catch (hata) {
      if (hata instanceof GonderildiHatasi) {
        // Fiş basılmış olabilir: tekrar gönderilmez, kasiyer gerekirse elle yeniden yazdırır.
        return {
          sonuc: { basarili: false, hata: `"${this.yaziciAdi}" yazıcısından yanıt alınamadı (${hata.message}).` },
          acilamadi: false,
        };
      }
      // Hazır süreç hiç başlamadı, iş gönderilmedi: eski, yavaş ama bağımsız yol.
      return this.tekSeferlik(baytlar);
    }
    return { sonuc: kod ? this.hataSonucu(kod) : { basarili: true }, acilamadi: kod.startsWith('OPEN') };
  }

  private hataSonucu(kod: string): YazdirmaSonucu {
    if (kod.startsWith('OPEN 1801')) {
      return {
        basarili: false,
        hata: `Windows'ta "${this.yaziciAdi}" adlı yazıcı bulunamadı. Ayarlardan yazıcıyı yeniden seçin.`,
      };
    }
    return { basarili: false, hata: `"${this.yaziciAdi}" yazıcısına gönderilemedi (${kod}). Yazıcı açık ve kablosu takılı mı?` };
  }

  private tekSeferlik(baytlar: Buffer): Promise<{ sonuc: YazdirmaSonucu; acilamadi: boolean }> {
    const dosya = join(tmpdir(), `mo-fis-${process.pid}-${Date.now()}.bin`);
    writeFileSync(dosya, baytlar);
    return new Promise((cozumle) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', kuyrukBetigiYolu()],
        { env: { ...process.env, MO_YAZICI: this.yaziciAdi, MO_DOSYA: dosya }, timeout: 30_000, windowsHide: true },
        (hata, _cikti, hataCiktisi) => {
          rmSync(dosya, { force: true });
          if (!hata) return cozumle({ sonuc: { basarili: true }, acilamadi: false });
          const kod = String(hataCiktisi ?? '').trim();
          cozumle({ sonuc: this.hataSonucu(kod || hata.message), acilamadi: kod.startsWith('OPEN') });
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
 * USB (Windows'a kurulu) yazıcı: önce yazdırma kuyruğu, olmazsa paylaşım yolu.
 *
 * Kuyruk paylaşım gerektirmez ve hazır bekleyen süreçle milisaniyeler sürer.
 * Eskiden önce `\\localhost\<ad>` deneniyordu; paylaşımı kapalı yazıcıda bu
 * deneme her oturumun ilk fişini bekletiyordu. Paylaşım artık yalnız kuyruk
 * yazıcıyı AÇAMADIĞINDA denenir — veri gönderildikten sonra hata olduysa
 * ikinci yoldan tekrar basılmaz (fiş iki kez çıkmasın).
 */

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
    if (!this.kuyruk) return this.paylasim.yazdir(baytlar);
    const { sonuc, acilamadi } = await this.kuyruk.gonder(baytlar);
    // Yalnız yazıcı hiç açılamadıysa: baytlar gitmedi, ikinci yol güvenli.
    if (sonuc.basarili || !acilamadi) return sonuc;
    const yedek = await this.paylasim.yazdir(baytlar);
    return yedek.basarili ? yedek : sonuc;
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
