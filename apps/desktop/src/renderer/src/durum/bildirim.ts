/** Bildirim (toast) yönetimi — kullanıcıya Türkçe, kısa geri bildirim (§20). */

import { create } from 'zustand';
import { uuid, UygulamaHatasi } from '@market/shared';

export type BildirimTuru = 'basari' | 'hata' | 'uyari' | 'bilgi';

export interface Bildirim {
  id: string;
  tur: BildirimTuru;
  mesaj: string;
  detay?: string;
  /** Destek için: hata izleme kimliği. */
  izlemeId?: string;
  kalici?: boolean;
}

interface BildirimDurumu {
  bildirimler: Bildirim[];
  ekle: (bildirim: Omit<Bildirim, 'id'>) => string;
  kaldir: (id: string) => void;
  temizle: () => void;
}

export const bildirimDurumu = create<BildirimDurumu>((set) => ({
  bildirimler: [],
  ekle: (bildirim) => {
    const id = uuid();
    set((s) => ({ bildirimler: [...s.bildirimler.slice(-4), { ...bildirim, id }] }));
    if (!bildirim.kalici) {
      const sure = bildirim.tur === 'hata' ? 8000 : 3500;
      setTimeout(() => set((s) => ({ bildirimler: s.bildirimler.filter((x) => x.id !== id) })), sure);
    }
    return id;
  },
  kaldir: (id) => set((s) => ({ bildirimler: s.bildirimler.filter((x) => x.id !== id) })),
  temizle: () => set({ bildirimler: [] }),
}));

export const bildir = {
  basari: (mesaj: string, detay?: string) => bildirimDurumu.getState().ekle({ tur: 'basari', mesaj, detay }),
  bilgi: (mesaj: string, detay?: string) => bildirimDurumu.getState().ekle({ tur: 'bilgi', mesaj, detay }),
  uyari: (mesaj: string, detay?: string) => bildirimDurumu.getState().ekle({ tur: 'uyari', mesaj, detay }),
  hata: (mesaj: string, detay?: string) => bildirimDurumu.getState().ekle({ tur: 'hata', mesaj, detay }),
};

/** Yakalanan bir hatayı kullanıcı diline çevirip gösterir. */
export function hatayiBildir(hata: unknown, onEk?: string): void {
  if (hata instanceof UygulamaHatasi) {
    bildirimDurumu.getState().ekle({
      tur: 'hata',
      mesaj: onEk ? `${onEk}: ${hata.message}` : hata.message,
      izlemeId: hata.izlemeId,
    });
    return;
  }
  const mesaj = hata instanceof Error ? hata.message : String(hata);
  bildirimDurumu.getState().ekle({ tur: 'hata', mesaj: onEk ? `${onEk}: ${mesaj}` : mesaj });
}
