/**
 * IPC kaydı — tüm arayüz çağrıları tek bir `market:cagir` kanalından geçer.
 *
 * Tasarım gerekçesi:
 *  - Preload yüzeyi minimum kalır (contextIsolation + sandbox güvenliği).
 *  - Her çağrı merkezî olarak loglanır ve hataları tek biçimde serileştirilir;
 *    kullanıcı Türkçe mesaj görür, teknik detay `izleme_id` ile logda kalır (§20).
 */

import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { hataSerilestir, izlemeId, type HataGovdesi } from '@market/shared';
import { kanallariOlustur, type KanalAdi } from './kanallar.js';
import type { Uygulama } from '../uygulama.js';

export const CAGRI_KANALI = 'market:cagir';
export const OLAY_KANALI = 'market:olay';

export interface CagriSonucu<T = unknown> {
  basarili: boolean;
  veri?: T;
  hata?: HataGovdesi;
}

/** Yavaş çağrıları görünür kılmak için eşik (§3.1 performans hedefleri). */
const YAVAS_ESIK_MS = 300;

/**
 * Doğası gereği yavaş olan kanallar için ayrı eşik.
 *
 * Parola/PIN doğrulaması scrypt kullanır ve **bilerek** yavaştır (kaba kuvvet
 * savunması, §15.1); yedekleme ve senkron da ağ/disk işidir. Bunları normal
 * eşikte uyarmak logu gürültüye boğar ve gerçek yavaşlamaları gizler.
 */
const OZEL_ESIK_MS: Record<string, number> = {
  'oturum.giris': 2000,
  'oturum.yetkiliOnayi': 2000,
  'kurulum.tamamla': 3000,
  'yedek.al': 30_000,
  'yedek.geriYukle': 60_000,
  'yedek.dogrula': 10_000,
  'senkron.simdi': 60_000,
  'senkron.mutabakat': 30_000,
  'senkron.aktivasyon': 30_000,
  'urun.iceAktar': 30_000,
  'ayar.yaziciTest': 10_000,
};

export function ipcKaydet(uygulama: Uygulama, pencereGetir?: () => BrowserWindow | null): () => void {
  const kanallar = kanallariOlustur(uygulama, pencereGetir);
  const kanalAdlari = new Set(Object.keys(kanallar));

  const isleyici = async (_olay: IpcMainInvokeEvent, kanal: string, girdi: unknown): Promise<CagriSonucu> => {
    const iz = izlemeId();
    if (!kanalAdlari.has(kanal)) {
      uygulama.kayit.uyari('Bilinmeyen IPC kanalı', { kanal, izleme_id: iz });
      return { basarili: false, hata: { kod: 'BULUNAMADI', mesaj: 'Bilinmeyen işlem.', izleme_id: iz } };
    }

    const baslangic = Date.now();
    try {
      const fonksiyon = kanallar[kanal as KanalAdi] as (girdi: unknown) => unknown;
      const veri = await fonksiyon(girdi);
      const sure = Date.now() - baslangic;
      const esik = OZEL_ESIK_MS[kanal] ?? YAVAS_ESIK_MS;
      if (sure > esik) {
        uygulama.kayit.uyari('Yavaş IPC çağrısı', { kanal, sure_ms: sure, esik_ms: esik, izleme_id: iz });
      }
      return { basarili: true, veri };
    } catch (hata) {
      const govde = hataSerilestir(hata, iz);
      // İş kuralı hataları beklenen durumlardır; yalnız sunucu hataları "hata" seviyesinde loglanır.
      const seviye = govde.kod === 'SUNUCU_HATASI' ? 'hata' : 'uyari';
      uygulama.kayit[seviye]('IPC çağrısı başarısız', {
        kanal,
        kod: govde.kod,
        mesaj: govde.mesaj,
        izleme_id: iz,
        sure_ms: Date.now() - baslangic,
      });
      return { basarili: false, hata: govde };
    }
  };

  ipcMain.handle(CAGRI_KANALI, isleyici);
  return () => ipcMain.removeHandler(CAGRI_KANALI);
}

/** Ana süreçten arayüze olay iletir (senkron durumu, yedek, kasa vb.). */
export function olaylariBagla(uygulama: Uygulama, pencereGetir: () => BrowserWindow | null): () => void {
  return uygulama.olayDinle((olay, veri) => {
    const pencere = pencereGetir();
    if (pencere && !pencere.isDestroyed()) {
      pencere.webContents.send(OLAY_KANALI, { olay, veri });
    }
  });
}
