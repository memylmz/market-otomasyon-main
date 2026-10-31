/**
 * Uygulama içi onay sorusu — `window.confirm` yerine.
 *
 * NEDEN: Electron'da (Windows) tarayıcının kendi onay kutusu kapandıktan sonra
 * pencere etkin görünür ama klavye odağı sayfaya geri dönmez: kutulara
 * tıklansa da yazı yazılmaz, barkod okutulamaz. Kasada bu, satışın durması
 * demektir. Soru artık sayfanın içinde, kendi diyaloğumuzla sorulur.
 *
 * Kullanım: `if (!(await onayla('Sepet silinsin mi?'))) return;`
 */

import { create } from 'zustand';

export interface OnaySecenekleri {
  baslik?: string;
  onaylaMetni?: string;
  tehlikeli?: boolean;
}

interface BekleyenOnay extends OnaySecenekleri {
  mesaj: string;
  coz: (sonuc: boolean) => void;
}

interface OnayDurumu {
  bekleyen: BekleyenOnay | null;
  yanitla: (sonuc: boolean) => void;
}

export const onayDurumu = create<OnayDurumu>((set, get) => ({
  bekleyen: null,
  yanitla: (sonuc) => {
    const b = get().bekleyen;
    if (!b) return;
    set({ bekleyen: null });
    b.coz(sonuc);
  },
}));

export function onayla(mesaj: string, secenekler: OnaySecenekleri = {}): Promise<boolean> {
  // Yanıtlanmamış eski soru varsa "hayır" sayılır; iki soru üst üste binmez.
  onayDurumu.getState().yanitla(false);
  return new Promise((coz) => onayDurumu.setState({ bekleyen: { ...secenekler, mesaj, coz } }));
}

/** Onay sorusu açıkken alttaki ekranın kısayolları ve barkod yakalayıcısı susar. */
export const onayAcikMi = () => onayDurumu.getState().bekleyen !== null;
