/** Oturum, sistem durumu ve yetki bilgisi (global). */

import { create } from 'zustand';
import type { Rol, Yetki } from '@market/shared';
import { cagir } from '../kopru';

export interface SenkronRozeti {
  durum: string;
  rozet: string;
  aciklama: string;
  bekleyenOlay: number;
  sonSenkron: string | null;
  sonSenkronGoreli: string;
}

export interface LisansBilgisi {
  seviye: string;
  yonetimKisitli: boolean;
  mesaj: string | null;
  lisansBitis: string | null;
  graceKalanGun: number;
}

export interface SistemDurumu {
  cihazId: string;
  surum: string;
  kurulumGerekli: boolean;
  oturum: { kullaniciId: string; ad: string; rol: Rol; yetkiler: Yetki[]; kasaOturumId: string | null } | null;
  senkron: SenkronRozeti;
  lisans: LisansBilgisi;
  ayarlar: Record<string, unknown>;
}

interface OturumDurumu {
  yukleniyor: boolean;
  sistem: SistemDurumu | null;
  yetkiler: Set<Yetki>;
  tazele: () => Promise<void>;
  girisYap: (kullaniciAdi: string, parola: string, yontem?: 'SIFRE' | 'PIN') => Promise<void>;
  cikisYap: () => Promise<void>;
}

/**
 * Görünüm ayarlarını belgeye uygular.
 *
 * Varsayılan **açık** temadır; koyu tema yalnız kullanıcı seçerse açılır.
 * Ayar okunamadığında da açık temada kalınır — bilinmeyen değer koyu temaya
 * düşmemeli, aksi hâlde ilk açılışta ekran bir an kararır.
 */
export function gorunumuUygula(ayarlar: Record<string, unknown> | undefined): void {
  const kok = document.documentElement;
  const tema = String((ayarlar as { tema?: unknown } | undefined)?.tema ?? 'acik');
  if (tema === 'koyu') kok.dataset.tema = 'koyu';
  else delete kok.dataset.tema;

  const yazi = String((ayarlar as { yaziBoyutu?: unknown } | undefined)?.yaziBoyutu ?? 'normal');
  if (yazi === 'buyuk' || yazi === 'cok-buyuk') kok.dataset.yazi = yazi;
  else delete kok.dataset.yazi;
}

export const oturumDurumu = create<OturumDurumu>((set, get) => ({
  yukleniyor: true,
  sistem: null,
  yetkiler: new Set<Yetki>(),

  tazele: async () => {
    const sistem = await cagir<SistemDurumu>('sistem.durum');
    gorunumuUygula(sistem.ayarlar);
    set({
      sistem,
      yetkiler: new Set(sistem.oturum?.yetkiler ?? []),
      yukleniyor: false,
    });
  },

  girisYap: async (kullaniciAdi, parola, yontem = 'SIFRE') => {
    await cagir('oturum.giris', { kullaniciAdi, parola, yontem });
    await get().tazele();
  },

  cikisYap: async () => {
    await cagir('oturum.cikis');
    await get().tazele();
  },
}));

/** Bileşenlerde yetki kontrolü. Arayüz gizlemesi UX içindir; asıl denetim ana süreçtedir. */
export function yetkisiVar(yetki: Yetki): boolean {
  return oturumDurumu.getState().yetkiler.has(yetki);
}

export function useYetki(yetki: Yetki): boolean {
  return oturumDurumu((s) => s.yetkiler.has(yetki));
}

export function useOturumAcik(): boolean {
  return oturumDurumu((s) => Boolean(s.sistem?.oturum));
}

export function useKasaAcik(): boolean {
  return oturumDurumu((s) => Boolean(s.sistem?.oturum?.kasaOturumId));
}
