/**
 * Müşteri ekranı penceresi — çift ekranlı POS'un ikinci monitörü.
 *
 * Sorumlulukları:
 *  - Ayara ve bağlı monitörlere göre pencereyi açmak, doğru ekrana yerleştirmek,
 *    ekran çıkınca kapatıp takılınca yeniden açmak. Kablo çekilmesi kasayı
 *    hiçbir şekilde etkilemez.
 *  - Kasanın sepetini, satış sonucunu ve yayın listesini pencereye iletmek.
 *  - `musteri-medya://` şemasıyla logo/görsel/videoyu sunmak.
 *
 * ODAK: pencere `focusable: false` açılır. Barkod okuyucu klavye gibi yazar;
 * müşteri ekranı odağı alsaydı (açılırken ya da müşteri dokununca) okutulan
 * barkod kasaya değil boşluğa giderdi.
 */

import { createReadStream, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { BrowserWindow, ipcMain, powerSaveBlocker, protocol, screen, type Display } from 'electron';
import {
  BOS_MUSTERI_SEPETI,
  EKRAN_SECIMI,
  MUSTERI_EKRANI_AYAR,
  type EkranBilgisi,
  type MusteriEkraniDurumu,
  type MusteriEkraniMesaji,
  type MusteriSepeti,
} from '@market/shared';
import { ayarBool, ayarMetin } from '../depo/ayar.js';
import type { Uygulama } from '../uygulama.js';
import type { MusteriEkraniDenetcisi } from './denetci.js';
import { MEDYA_MIME, medyaYolu } from './medya.js';
import { MEDYA_SEMASI, musteriEkraniYapilandirmasi } from './yapilandirma.js';

export const MUSTERI_MESAJ_KANALI = 'musteri:mesaj';
export const MUSTERI_HAZIR_KANALI = 'musteri:hazir';

/** Kampanya başlangıç/bitiş saatleri ve fiyat değişiklikleri bu aralıkla ekrana yansır. */
const YENILEME_MS = 60_000;

/**
 * Medya şemasını ayrıcalıklı kaydeder. Electron bunu `app.whenReady`'den ÖNCE
 * ister; `stream` video oynatma, `standard` göreli adresler için gereklidir.
 */
export function medyaSemasiniKaydet(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDYA_SEMASI, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

type Hedef = { tur: 'EKRAN'; ekran: Display } | { tur: 'PENCERE' };

export class MusteriEkraniYoneticisi implements MusteriEkraniDenetcisi {
  private pencere: BrowserWindow | null = null;
  private pencereKipi: Hedef['tur'] | null = null;
  private sonSepet: MusteriSepeti = BOS_MUSTERI_SEPETI;
  private sonYapilandirma = '';
  private uykuEngeli: number | null = null;
  private zamanlayici: ReturnType<typeof setInterval> | null = null;
  private degerlendirmeZamani: ReturnType<typeof setTimeout> | null = null;
  private temizleyiciler: (() => void)[] = [];
  private durduruldu = false;

  constructor(
    private readonly uygulama: Uygulama,
    private readonly anaPencereGetir: () => BrowserWindow | null,
    private readonly gelistirme: boolean,
  ) {}

  baslat(): void {
    protocol.handle(MEDYA_SEMASI, (istek) => this.medyaSun(istek));
    this.temizleyiciler.push(() => protocol.unhandle(MEDYA_SEMASI));

    const hazir = (olay: Electron.IpcMainEvent) => {
      if (this.pencere && olay.sender === this.pencere.webContents) {
        this.yapilandirmaGonder(true);
        this.gonder({ tur: 'SEPET', sepet: this.sonSepet });
      }
    };
    ipcMain.on(MUSTERI_HAZIR_KANALI, hazir);
    this.temizleyiciler.push(() => ipcMain.removeListener(MUSTERI_HAZIR_KANALI, hazir));

    // Monitör takılıp çıkınca ya da çözünürlük değişince yeniden yerleş.
    const ekranDegisti = () => this.degerlendirmeyiZamanla();
    for (const olay of ['display-added', 'display-removed', 'display-metrics-changed'] as const) {
      screen.on(olay as 'display-added', ekranDegisti);
      this.temizleyiciler.push(() => screen.removeListener(olay as 'display-added', ekranDegisti));
    }

    this.temizleyiciler.push(
      this.uygulama.olayDinle((olay, veri) => {
        if (olay === 'satis:kesinlesti') {
          const v = veri as { genelToplam?: number; paraUstu?: number };
          this.sonSepet = BOS_MUSTERI_SEPETI;
          this.gonder({ tur: 'TAMAMLANDI', genelToplam: v.genelToplam ?? 0, paraUstu: v.paraUstu ?? 0 });
        } else if (olay === 'ayar:degisti') {
          this.degerlendir();
          this.yapilandirmaGonder();
        } else if (olay === 'senkron:tamamlandi') {
          this.yapilandirmaGonder();
        }
      }),
    );

    this.zamanlayici = setInterval(() => this.yapilandirmaGonder(), YENILEME_MS);
    this.degerlendir();
  }

  /** Uygulama kapanırken: pencere kapanır, tüm dinleyiciler bırakılır. */
  durdur(): void {
    this.durduruldu = true;
    if (this.zamanlayici) clearInterval(this.zamanlayici);
    if (this.degerlendirmeZamani) clearTimeout(this.degerlendirmeZamani);
    for (const temizle of this.temizleyiciler.splice(0)) {
      try {
        temizle();
      } catch {
        /* kapanışta önemsiz */
      }
    }
    this.kapat();
  }

  sepetGuncelle(sepet: MusteriSepeti): void {
    this.sonSepet = sepet;
    this.gonder({ tur: 'SEPET', sepet });
  }

  durum(): MusteriEkraniDurumu {
    const { acik, secim } = this.ayarlar();
    const ekranlar = this.ekranlar();
    const hedefEkranId =
      this.pencere && this.pencereKipi === 'EKRAN' ? String(screen.getDisplayMatching(this.pencere.getBounds()).id) : null;

    let mesaj: string;
    if (!acik) mesaj = 'Müşteri ekranı kapalı.';
    else if (this.pencere && this.pencereKipi === 'PENCERE') mesaj = 'Deneme penceresi açık (kasa ekranında).';
    else if (this.pencere) mesaj = `${ekranlar.find((e) => e.id === hedefEkranId)?.ad ?? 'İkinci ekran'} üzerinde açık.`;
    else if (ekranlar.length < 2)
      mesaj = 'İkinci ekran bulunamadı. Kabloyu ve Windows ekran ayarlarında "Genişlet" seçimini kontrol edin.';
    else mesaj = 'Seçilen ekran bağlı değil.';

    return { acik, secim, ekranlar, pencereAcik: Boolean(this.pencere), hedefEkranId, mesaj };
  }

  // -------------------------------------------------------------------------

  private ayarlar(): { acik: boolean; secim: string } {
    try {
      const { vt } = this.uygulama.baglam;
      return {
        // Varsayılan KAPALI: iki monitörlü ofis bilgisayarında kasa uygulaması
        // açılınca ikinci monitörün kendiliğinden müşteri ekranına dönmesi istenmez.
        acik: ayarBool(vt, MUSTERI_EKRANI_AYAR.ACIK, false),
        secim: ayarMetin(vt, MUSTERI_EKRANI_AYAR.EKRAN, EKRAN_SECIMI.OTOMATIK) || EKRAN_SECIMI.OTOMATIK,
      };
    } catch {
      // Veritabanı kapalı (sıfırlama/geri yükleme sonrası yeniden başlatma bekleniyor).
      return { acik: false, secim: EKRAN_SECIMI.OTOMATIK };
    }
  }

  /** Kasa penceresinin bulunduğu ekran; pencere yoksa birincil ekran. */
  private kasaEkrani(): Display {
    const ana = this.anaPencereGetir();
    return ana && !ana.isDestroyed() ? screen.getDisplayMatching(ana.getBounds()) : screen.getPrimaryDisplay();
  }

  private ekranlar(): EkranBilgisi[] {
    const birincil = screen.getPrimaryDisplay().id;
    const kasa = this.kasaEkrani().id;
    return screen.getAllDisplays().map((d, i) => ({
      id: String(d.id),
      ad: `Ekran ${i + 1}${d.label ? ` — ${d.label}` : ''}`,
      genislik: d.size.width,
      yukseklik: d.size.height,
      birincil: d.id === birincil,
      kasaEkrani: d.id === kasa,
    }));
  }

  /**
   * OTOMATIK: kasa penceresinin OLMADIĞI ilk ekran. Kimlik seçilmişse o ekran;
   * Windows yeniden takılan monitöre yeni kimlik verebildiği için seçilen ekran
   * bulunamazsa yine otomatik seçime düşülür.
   */
  private hedefBul(secim: string): Hedef | null {
    if (secim === EKRAN_SECIMI.PENCERE) return { tur: 'PENCERE' };
    const ekranlar = screen.getAllDisplays();
    if (secim !== EKRAN_SECIMI.OTOMATIK) {
      const secilen = ekranlar.find((d) => String(d.id) === secim);
      if (secilen) return { tur: 'EKRAN', ekran: secilen };
    }
    const kasa = this.kasaEkrani().id;
    const diger = ekranlar.find((d) => d.id !== kasa);
    return diger ? { tur: 'EKRAN', ekran: diger } : null;
  }

  private degerlendirmeyiZamanla(): void {
    // Windows ekran olaylarını art arda yağdırır; yerleşme bir kez yapılsın.
    if (this.degerlendirmeZamani) clearTimeout(this.degerlendirmeZamani);
    this.degerlendirmeZamani = setTimeout(() => this.degerlendir(), 500);
  }

  /** Ayarlara ve bağlı ekranlara göre pencereyi açar, taşır ya da kapatır. */
  degerlendir(): void {
    if (this.durduruldu) return;
    const { acik, secim } = this.ayarlar();
    const hedef = acik ? this.hedefBul(secim) : null;
    if (!hedef) {
      this.kapat();
      return;
    }
    // Kip değiştiyse (deneme penceresi ↔ gerçek ekran) pencere baştan kurulur:
    // odaklanabilirlik ve görev çubuğu oluşturulduktan sonra değiştirilemiyor.
    if (this.pencere && this.pencereKipi !== hedef.tur) this.kapat();
    if (!this.pencere) this.olustur(hedef);
    else if (hedef.tur === 'EKRAN') this.pencere.setBounds(hedef.ekran.bounds);
  }

  /** Kasa penceresi kapanınca da çağrılır: açık müşteri penceresi uygulamanın kapanmasını engellemesin. */
  kapat(): void {
    const p = this.pencere;
    this.pencere = null;
    this.pencereKipi = null;
    if (p && !p.isDestroyed()) p.destroy();
    this.uykuEngeliniBirak();
  }

  private olustur(hedef: Hedef): void {
    const deneme = hedef.tur === 'PENCERE';
    const sinirlar = deneme ? { width: 1024, height: 600 } : hedef.ekran.bounds;
    const p = new BrowserWindow({
      ...sinirlar,
      show: false,
      frame: deneme,
      resizable: deneme,
      focusable: deneme,
      skipTaskbar: !deneme,
      autoHideMenuBar: true,
      backgroundColor: '#0b1220',
      title: 'Müşteri Ekranı',
      webPreferences: {
        preload: join(__dirname, '../preload/musteri.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        // Reklam videosu kimse dokunmadan oynamalı; pencere hiç odak almaz.
        autoplayPolicy: 'no-user-gesture-required',
        // Odaksız pencerede zamanlayıcılar kısılmasın — slaytlar takılmasın.
        backgroundThrottling: false,
      },
    });
    p.setMenu(null);
    p.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    p.webContents.on('will-navigate', (olay) => olay.preventDefault());
    p.once('ready-to-show', () => {
      if (deneme) {
        p.show();
        return;
      }
      p.showInactive();
      /*
       * Sınırlar GÖRÜNDÜKTEN SONRA yeniden uygulanır. Gösterilmeden verilen tam
       * ekran sınırlarında Windows görev çubuğunu pencerenin üstünde bırakıyordu;
       * ancak Ayarlar'da Kaydet'e basılınca (aynı setBounds) çekiliyordu. Windows
       * yerleşimi biraz sonra bir kez daha düzeltebildiği için ikinci deneme var.
       */
      const yerles = () => {
        if (hedef.tur === 'EKRAN' && !p.isDestroyed() && this.pencere === p) {
          p.setBounds(screen.getDisplayMatching(hedef.ekran.bounds).bounds);
        }
      };
      yerles();
      setTimeout(yerles, 600);
    });
    p.on('closed', () => {
      if (this.pencere === p) {
        this.pencere = null;
        this.pencereKipi = null;
        this.uykuEngeliniBirak();
      }
    });
    // Müşteri penceresi çökerse kasayı etkilemeden yeniden açılır.
    p.webContents.on('render-process-gone', (_olay, ayrinti) => {
      this.uygulama.kayit.uyari('Müşteri ekranı süreci düştü', { neden: ayrinti.reason });
      this.kapat();
      setTimeout(() => this.degerlendir(), 2_000);
    });

    const adres = process.env.ELECTRON_RENDERER_URL;
    if (this.gelistirme && adres) void p.loadURL(`${adres}/musteri-ekrani.html`);
    else void p.loadFile(join(__dirname, '../renderer/musteri-ekrani.html'));

    this.pencere = p;
    this.pencereKipi = hedef.tur;
    this.sonYapilandirma = '';
    // Tabela gibi çalışan ekran Windows'un ekran zaman aşımıyla kararmasın.
    if (!deneme && this.uykuEngeli === null) this.uykuEngeli = powerSaveBlocker.start('prevent-display-sleep');
  }

  private uykuEngeliniBirak(): void {
    if (this.uykuEngeli !== null) {
      powerSaveBlocker.stop(this.uykuEngeli);
      this.uykuEngeli = null;
    }
  }

  private gonder(mesaj: MusteriEkraniMesaji): void {
    const p = this.pencere;
    if (p && !p.isDestroyed()) p.webContents.send(MUSTERI_MESAJ_KANALI, mesaj);
  }

  /** Yapılandırmayı üretir; değişmediyse göndermez (oynayan slayt bölünmesin). */
  private yapilandirmaGonder(zorla = false): void {
    if (!this.pencere) return;
    try {
      const yapilandirma = musteriEkraniYapilandirmasi(this.uygulama.baglam);
      const json = JSON.stringify(yapilandirma);
      if (!zorla && json === this.sonYapilandirma) return;
      this.sonYapilandirma = json;
      this.gonder({ tur: 'YAPILANDIRMA', yapilandirma });
    } catch (hata) {
      this.uygulama.kayit.uyari('Müşteri ekranı yapılandırması üretilemedi', {
        mesaj: hata instanceof Error ? hata.message : String(hata),
      });
    }
  }

  /**
   * `musteri-medya://dosya/<ad>` isteğini karşılar. Video oynatıcı dosyayı
   * parça parça (Range) ister; aralık desteği olmadan uzun videolar baştan
   * yüklenmeden oynamaz.
   */
  private medyaSun(istek: Request): Response {
    const bulunamadi = () => new Response(null, { status: 404 });
    let ad: string;
    try {
      const url = new URL(istek.url);
      if (url.host !== 'dosya') return bulunamadi();
      ad = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    } catch {
      return bulunamadi();
    }
    const yol = medyaYolu(this.uygulama.baglam.yollar, ad);
    if (!yol) return bulunamadi();

    const boyut = statSync(yol).size;
    const basliklar: Record<string, string> = {
      'Content-Type': MEDYA_MIME[extname(yol).slice(1)] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    };
    const akit = (bas: number, son: number) =>
      Readable.toWeb(createReadStream(yol, { start: bas, end: son })) as unknown as ReadableStream<Uint8Array>;

    const aralik = /^bytes=(\d*)-(\d*)$/.exec(istek.headers.get('range') ?? '');
    if (!aralik || (aralik[1] === '' && aralik[2] === '')) {
      return new Response(akit(0, Math.max(0, boyut - 1)), {
        status: 200,
        headers: { ...basliklar, 'Content-Length': String(boyut) },
      });
    }
    // "bytes=-500" son 500 bayt; "bytes=100-" 100'den sona.
    let bas = aralik[1] === '' ? Math.max(0, boyut - Number(aralik[2])) : Number(aralik[1]);
    let son = aralik[1] === '' || aralik[2] === '' ? boyut - 1 : Math.min(Number(aralik[2]), boyut - 1);
    if (bas > son || bas >= boyut) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${boyut}` } });
    }
    bas = Math.max(0, bas);
    son = Math.max(bas, son);
    return new Response(akit(bas, son), {
      status: 206,
      headers: { ...basliklar, 'Content-Length': String(son - bas + 1), 'Content-Range': `bytes ${bas}-${son}/${boyut}` },
    });
  }
}
