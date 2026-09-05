/**
 * Electron ana süreç giriş noktası.
 *
 * Sorumlulukları: pencere yaşam döngüsü, uygulama bağlamının kurulması,
 * IPC kaydı, otomatik güncelleme ve temiz kapanış. İş kuralı içermez.
 */

import { join } from 'node:path';
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { hataNormalize } from '@market/shared';
import { ipcKaydet, olaylariBagla } from './ipc/index.js';
import { Uygulama } from './uygulama.js';

// Uygulama adı `app.getPath('userData')` yolunu belirler. Ayarlanmazsa paket adı
// (`@market/desktop`) kullanılır ve veri `AppData/Roaming/@market/desktop` gibi
// iç içe, kapsam ekli bir klasöre düşer. Adı burada sabitliyoruz ki geliştirme ve
// paketlenmiş sürüm aynı, temiz klasörü kullansın.
app.setName('Market Otomasyon');

/**
 * Tek örnek kilidi: iki kasa uygulaması aynı veritabanını açıp çakışmasın.
 *
 * `app.quit()` yeterli DEĞİLDİR: kapanış asenkrondur, bu arada `whenReady`
 * tetiklenir ve ikinci süreç veritabanını açıp göç kontrolü yapar. Aynı SQLite
 * dosyasına iki süreç dokunması istenmez. `app.exit(0)` süreci anında sonlandırır.
 */
const tekOrnekKilidi = app.requestSingleInstanceLock();
if (!tekOrnekKilidi) {
  app.exit(0);
}

let uygulama: Uygulama | null = null;
let anaPencere: BrowserWindow | null = null;
let ipcTemizle: (() => void) | null = null;
let olayTemizle: (() => void) | null = null;

const GELISTIRME = !app.isPackaged;

function pencereOlustur(): BrowserWindow {
  const pencere = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    title: 'Market Otomasyon',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Güvenlik: renderer'da Node yok, bağlam yalıtımı açık (§15.4).
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload'ın contextBridge kullanabilmesi için
      spellcheck: false,
    },
  });

  pencere.once('ready-to-show', () => pencere.show());

  // Dış bağlantılar uygulamanın içinde değil, işletim sisteminin varsayılan
  // uygulamasında açılır. Beyaz liste dar tutulur: `https` (WhatsApp bağlantısı),
  // `mailto` ve `sms` (cari ekstre bildirimi). `file:` gibi şemalar reddedilir —
  // aksi hâlde arayüzde oluşan bir bağlantı yerel dosya çalıştırabilirdi.
  const IZINLI_SEMALAR = ['https:', 'mailto:', 'sms:'];
  pencere.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (IZINLI_SEMALAR.includes(new URL(url).protocol)) void shell.openExternal(url);
    } catch {
      /* çözümlenemeyen adres açılmaz */
    }
    return { action: 'deny' };
  });
  pencere.webContents.on('will-navigate', (olay, url) => {
    const izinli = GELISTIRME && url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'http://localhost');
    if (!izinli) olay.preventDefault();
  });

  if (GELISTIRME && process.env.ELECTRON_RENDERER_URL) {
    void pencere.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void pencere.loadFile(join(__dirname, '../renderer/index.html'));
  }

  pencere.on('closed', () => {
    anaPencere = null;
  });

  return pencere;
}

async function baslat(): Promise<void> {
  try {
    uygulama = await Uygulama.olustur({
      veriKoku: app.getPath('userData'),
      konsolLogu: GELISTIRME,
    });
  } catch (hata) {
    const normal = hataNormalize(hata);
    dialog.showErrorBox(
      'Uygulama başlatılamadı',
      `${normal.message}\n\nVeritabanı bozulmuş olabilir. Ayarlar → Yedekten geri yükle adımını uygulayın ` +
        `veya destek ekibine başvurun.\n\nTeknik detay: ${normal.detay?.ic_mesaj ?? normal.kod}`,
    );
    app.quit();
    return;
  }

  ipcTemizle = ipcKaydet(uygulama, () => anaPencere);
  olayTemizle = olaylariBagla(uygulama, () => anaPencere);
  uygulama.otomatikYedeklemeyiBaslat();
  uygulama.bakimiBaslat();
  /*
   * Otomatik senkron ANA SÜREÇTE başlar, arayüzde değil.
   *
   * Zamanlayıcı sınıfı yazılmıştı ama HİÇ ÇAĞRILMIYORDU; senkronu yalnız giriş
   * yapmış kullanıcının ekranındaki zamanlayıcı tetikliyordu. Bunun sonucu
   * kilitlenen bir döngüydü: panelden PIN'i değiştirilen kullanıcı kasadan
   * giremiyor, kasa da yeni PIN'i çekemiyordu — çünkü çekmek için giriş
   * yapılmış olması gerekiyordu.
   *
   * Pull cihaz tokeniyle yetkilenir, kullanıcı oturumuyla değil; giriş
   * ekranında da çalışması hem doğru hem gereklidir.
   */
  uygulama.zamanlayiciyiBaslat();

  // Kasa ekranında menü çubuğu dikkat dağıtır; yalnız geliştirmede açık kalır.
  if (!GELISTIRME) Menu.setApplicationMenu(null);

  anaPencere = pencereOlustur();
}

if (tekOrnekKilidi) {
  app
    .whenReady()
    .then(baslat)
    .catch((hata) => {
      dialog.showErrorBox('Beklenmeyen hata', String(hata));
      app.quit();
    });
}

app.on('second-instance', () => {
  if (anaPencere) {
    if (anaPencere.isMinimized()) anaPencere.restore();
    anaPencere.focus();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) anaPencere = pencereOlustur();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Temiz kapanış: WAL checkpoint + bağlantı kapatma (§18.4).
let kapaniyor = false;
app.on('before-quit', (olay) => {
  if (kapaniyor || !uygulama) return;
  olay.preventDefault();
  kapaniyor = true;
  ipcTemizle?.();
  olayTemizle?.();
  uygulama
    .kapat()
    .catch(() => undefined)
    .finally(() => app.exit(0));
});

// Yakalanmamış hatalar uygulamayı sessizce düşürmesin; logla ve kullanıcıyı bilgilendir.
process.on('uncaughtException', (hata) => {
  uygulama?.kayit.hata('Yakalanmamış istisna', { mesaj: hata.message, yigin: hata.stack?.split('\n').slice(0, 5) });
  if (GELISTIRME) console.error(hata);
});
process.on('unhandledRejection', (sebep) => {
  uygulama?.kayit.hata('İşlenmemiş promise reddi', { sebep: sebep instanceof Error ? sebep.message : String(sebep) });
});
