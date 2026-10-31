/** Oturum, sistem durumu ve yetki bilgisi (global). */

import { create } from 'zustand';
import { ozelTemaCoz, ozelTemaDegiskenleri, VARSAYILAN_KDV_ORANI, YAZI_TIPLERI, type Rol, type Yetki } from '@market/shared';
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
  /** Açık veritabanının işletme adı. */
  isletmeAdi?: string;
  /** Proje klasöründen çalışan deneme kopyası (kurulu program değil). */
  gelistirme?: boolean;
  /** Ayarlar → "Satış sonrası fişi otomatik yazdır". */
  otomatikFis?: boolean;
  /** Bu yılın fatura düzenleme sınırı (VUK 232); `eksik` = bu yılınki girilmedi. */
  faturaSiniri?: { tutar: number; yil: number; eksik: boolean };
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
  const yazi = String((ayarlar as { yaziBoyutu?: unknown } | undefined)?.yaziBoyutu ?? 'normal');
  temayiUygula(tema, String((ayarlar as { ozelTema?: unknown } | undefined)?.ozelTema ?? ''), yazi);

  // Ekran tuş takımı bu değeri her odaklanmada okur (bkz. EkranTusTakimi).
  const tus = String((ayarlar as { tusTakimi?: unknown } | undefined)?.tusTakimi ?? 'otomatik');
  kok.dataset.tusTakimi = tus === 'acik' || tus === 'kapali' ? tus : 'otomatik';
}

/** Özel temanın belgeye satır içi yazdığı değişkenler (tema değişince silinir). */
let ozelDegiskenler: string[] = [];

/**
 * Temayı belgeye uygular. Ayarlar ekranı da kaydetmeden önizlemek için çağırır.
 *
 * Açık/koyu: `data-tema` ve yazı kademesi (`data-yazi`). Özel: seçilen
 * tabanın üstüne dört renkten türetilen değişkenler, yazı ölçeği, yazı tipi
 * ve köşe çarpanı satır içi stil olarak yazılır.
 */
export function temayiUygula(tema: string, ozelTemaJson: string, yaziBoyutu: string): void {
  const kok = document.documentElement;
  for (const ad of ozelDegiskenler) kok.style.removeProperty(ad);
  ozelDegiskenler = [];
  kok.style.removeProperty('font-size');
  kok.style.removeProperty('font-family');

  if (tema === 'ozel') {
    const t = ozelTemaCoz(ozelTemaJson);
    if (t.taban === 'koyu') kok.dataset.tema = 'koyu';
    else delete kok.dataset.tema;
    for (const [ad, deger] of Object.entries(ozelTemaDegiskenleri(t))) {
      kok.style.setProperty(ad, deger);
      ozelDegiskenler.push(ad);
    }
    delete kok.dataset.yazi;
    kok.style.fontSize = `${(16 * t.yaziOlcegi) / 100}px`;
    kok.style.fontFamily = YAZI_TIPLERI[t.yaziTipi].yigin;
    return;
  }

  if (tema === 'koyu') kok.dataset.tema = 'koyu';
  else delete kok.dataset.tema;
  if (yaziBoyutu === 'buyuk' || yaziBoyutu === 'cok-buyuk') kok.dataset.yazi = yaziBoyutu;
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
/**
 * Ayarlar → "Yeni üründe varsayılan KDV". Mal kabulün boş satırı ve yeni ürün
 * kartı bununla açılır; ayar okunamazsa yasal genel oran (%20).
 */
export function varsayilanKdv(): number {
  const n = Number((oturumDurumu.getState().sistem?.ayarlar as { varsayilanKdv?: unknown } | undefined)?.varsayilanKdv);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : VARSAYILAN_KDV_ORANI;
}

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
