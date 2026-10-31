/**
 * HTML → piksel çizici (Electron adaptörü).
 *
 * Fişi görüntü olarak basmak için harfleri birinin ÇİZMESİ gerekir. Bu iş
 * Chromium'a verilir: sistem fontlarıyla Türkçeyi kusursuz dizer, ayrı bir
 * font dosyası ya da yerel (native) bağımlılık gerektirmez — Electron zaten
 * uygulamanın içinde.
 *
 * BU DOSYA BİLEREK İNCE: karar ve hesap `fis-gorsel.ts` içinde, saf ve test
 * edilebilir hâlde durur; burada yalnız Electron'a dokunan yapıştırma kod var.
 * Deponun `etiket.ts` (saf) ↔ `yazici.ts` (donanım) ayrımının aynısı.
 */

import { BrowserWindow } from 'electron';
import type { GorselCizici } from './fis-gorsel.js';

/**
 * Gizli pencere AÇIK TUTULUR.
 *
 * Her fiş için yeni pencere açmak ~300 ms ekler; satış sonrası fiş basımı
 * kasanın en sıcak yollarından biridir. Pencere bir kez kurulur, sonraki
 * fişler onu yeniden kullanır.
 */
let pencere: BrowserWindow | null = null;

function pencereAl(enNokta: number): BrowserWindow {
  if (pencere && !pencere.isDestroyed()) {
    pencere.setSize(enNokta, 200);
    return pencere;
  }
  pencere = new BrowserWindow({
    width: enNokta,
    height: 200,
    show: false,
    frame: false,
    // Hiç görünmeyen çizim penceresi kasa penceresinin klavye odağını asla almamalı.
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      // Ekrana çizilmeden bellekte çizim: pencere kullanıcıya hiç görünmez.
      offscreen: true,
      // Fiş içeriği kendi HTML'imiz; dışarıdan betik yüklemez.
      javascript: true,
      images: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  return pencere;
}

/*
 * ÇİZİMLER SIRAYLA. Tek pencere vardır; ikinci bir yükleme öncekini iptal
 * eder (ERR_ABORTED) ve o fiş düz metne düşerdi. Arka arkaya iki satışın
 * fişi, yeniden yazdırma ya da fişle aynı anda etiket basmak bunu
 * tetikliyordu. Her iş bir öncekinin bitmesini bekler.
 */
let sira: Promise<unknown> = Promise.resolve();
function sirayla<T>(is: () => Promise<T>): Promise<T> {
  const sonuc = sira.then(is, is);
  sira = sonuc.catch(() => undefined);
  return sonuc;
}

/**
 * Program açılırken çizim penceresini hazırlar: ilk fişte Chromium'un yeni bir
 * çizim süreci başlatması yavaş kasada saniyeler sürüyordu. Sıradan geçer:
 * ilk fişle çakışırsa onu iptal etmez.
 */
export function gorselCiziciyiIsit(): void {
  void sirayla(() => pencereAl(576).loadURL('data:text/html;charset=utf-8,')).catch(() => undefined);
}

/** Çizim penceresini kapatır (uygulama kapanışında). */
export function gorselCiziciyiKapat(): void {
  if (pencere && !pencere.isDestroyed()) pencere.destroy();
  pencere = null;
}

export const electronCizici: GorselCizici = (html, enNokta) => sirayla(() => ciz(html, enNokta));

async function ciz(html: string, enNokta: number): ReturnType<GorselCizici> {
  const w = pencereAl(enNokta);

  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  /*
   * Yükseklik İÇERİKTEN ölçülür. Fişin kaç satır süreceği baştan bilinemez:
   * kalem sayısı, uzun ürün adları ve kampanya satırları boyu değiştirir.
   * Pencere içeriğe göre büyütülmezse `capturePage` yalnız görünen kısmı
   * yakalar ve fişin altı kağıda hiç basılmaz.
   */
  const boy = Math.max(1, Math.ceil(Number(await w.webContents.executeJavaScript('document.body.scrollHeight'))));
  w.setSize(enNokta, boy);

  // Yeniden boyutlandırma sonrası bir kare beklenir; aksi hâlde eski, kısa
  // görüntü yakalanır.
  await new Promise((coz) => setTimeout(coz, 60));

  const ham = await w.webContents.capturePage();

  /*
   * EKRAN ÖLÇEĞİNE KARŞI KORUMA.
   *
   * Retina ekranda Chromium her şeyi 2× yakalar: 576 noktalık fiş 1152 piksel
   * gelir ve kağıda iki kat geniş basılıp yarısı kesilir. Ölçek makineye göre
   * değiştiği için (POS bilgisayarlarında 1×, Mac'te 2×, bazı Windows'larda
   * 1,5×) sabit bir sayıyla düzeltilemez; görüntü her koşulda hedef genişliğe
   * indirilir. 2×'ten indirmek ayrıca yazıyı yumuşatır — termal kafada daha
   * düzgün harf verir.
   */
  const resim = ham.getSize().width === enNokta ? ham : ham.resize({ width: enNokta, quality: 'best' });
  const olcu = resim.getSize();
  const bgra = new Uint8Array(resim.toBitmap());

  return { bgra, en: olcu.width, boy: olcu.height };
}
