/**
 * Müşteri ekranı preload'ı — kasanın preload'ından AYRIDIR ve çok daha dardır.
 *
 * Müşteri penceresi müşteriye dönüktür; hiçbir ana süreç kanalını (`market:cagir`)
 * çağıramaz. Yalnız iki şey yapabilir: hazır olduğunu söylemek ve ana süreçten
 * gelen görüntü mesajlarını dinlemek. Pencere sandbox'ta çalışır; bu dosya
 * `electron` dışında hiçbir modül içe aktarmamalıdır.
 */

import { contextBridge, ipcRenderer } from 'electron';

const MESAJ_KANALI = 'musteri:mesaj';
const HAZIR_KANALI = 'musteri:hazir';

export interface MusteriKopru {
  /** Ana süreçten gelen mesajları dinler; abonelikten çıkmak için dönen fonksiyonu çağırın. */
  dinle(geriCagri: (mesaj: unknown) => void): () => void;
  /** Pencere çizmeye hazır: ana süreç yapılandırmayı ve güncel sepeti gönderir. */
  hazir(): void;
}

const kopru: MusteriKopru = {
  dinle: (geriCagri) => {
    const dinleyici = (_olay: unknown, mesaj: unknown) => geriCagri(mesaj);
    ipcRenderer.on(MESAJ_KANALI, dinleyici);
    return () => ipcRenderer.removeListener(MESAJ_KANALI, dinleyici);
  },
  hazir: () => ipcRenderer.send(HAZIR_KANALI),
};

contextBridge.exposeInMainWorld('musteriEkrani', kopru);
