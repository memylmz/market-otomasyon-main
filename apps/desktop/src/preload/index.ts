/**
 * Preload — arayüz ile ana süreç arasındaki güvenli köprü.
 *
 * `contextIsolation: true` altında çalışır; renderer'a Node API'si SIZDIRILMAZ.
 * Yalnız iki yetenek açılır: beyaz listedeki kanalları çağırmak ve ana süreçten
 * gelen olayları dinlemek (§15.4).
 */

import { contextBridge, ipcRenderer } from 'electron';

const CAGRI_KANALI = 'market:cagir';
const OLAY_KANALI = 'market:olay';

export interface HataGovdesiDto {
  kod: string;
  mesaj: string;
  detay?: Record<string, unknown>;
  izleme_id?: string;
}

export interface CagriSonucuDto<T = unknown> {
  basarili: boolean;
  veri?: T;
  hata?: HataGovdesiDto;
}

export interface MarketKopru {
  /** Ana süreçteki bir kanalı çağırır. Hata durumunda `basarili: false` döner. */
  cagir<T = unknown>(kanal: string, girdi?: unknown): Promise<CagriSonucuDto<T>>;
  /** Ana süreçten gelen olayları dinler; abonelikten çıkmak için dönen fonksiyonu çağırın. */
  olayDinle(geriCagri: (olay: string, veri: unknown) => void): () => void;
  readonly platform: string;
}

const kopru: MarketKopru = {
  cagir: (kanal, girdi) => ipcRenderer.invoke(CAGRI_KANALI, kanal, girdi),
  olayDinle: (geriCagri) => {
    const dinleyici = (_olay: unknown, paket: { olay: string; veri: unknown }) => {
      geriCagri(paket.olay, paket.veri);
    };
    ipcRenderer.on(OLAY_KANALI, dinleyici);
    return () => ipcRenderer.removeListener(OLAY_KANALI, dinleyici);
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('market', kopru);
