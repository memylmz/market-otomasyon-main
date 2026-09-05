/**
 * Ana süreç köprüsü — tipli istemci.
 *
 * Preload yalnız genel bir `cagir(kanal, girdi)` sunar; buradaki sarmalayıcı
 * çağrı sonuçlarını çözer ve hata durumunda `UygulamaHatasi` fırlatır, böylece
 * bileşenlerde `try/catch` doğal biçimde kullanılabilir.
 */

import { hataCanlandir, UygulamaHatasi, type HataGovdesi } from '@market/shared';

export interface CagriSonucu<T = unknown> {
  basarili: boolean;
  veri?: T;
  hata?: HataGovdesi;
}

interface MarketKopru {
  cagir<T = unknown>(kanal: string, girdi?: unknown): Promise<CagriSonucu<T>>;
  olayDinle(geriCagri: (olay: string, veri: unknown) => void): () => void;
  readonly platform: string;
}

declare global {
  interface Window {
    market?: MarketKopru;
  }
}

function kopruAl(): MarketKopru {
  const kopru = window.market;
  if (!kopru) {
    throw new UygulamaHatasi('SUNUCU_HATASI', 'Uygulama köprüsü yüklenemedi. Lütfen uygulamayı yeniden başlatın.');
  }
  return kopru;
}

/** Kanalı çağırır; hata varsa fırlatır. */
export async function cagir<T = unknown>(kanal: string, girdi?: unknown): Promise<T> {
  const sonuc = await kopruAl().cagir<T>(kanal, girdi);
  if (!sonuc.basarili) {
    throw hataCanlandir(sonuc.hata ?? { kod: 'SUNUCU_HATASI', mesaj: 'Bilinmeyen hata.' });
  }
  return sonuc.veri as T;
}

/** Hata fırlatmadan sonuç döner — isteğe bağlı işlemlerde kullanışlıdır. */
export async function cagirGuvenli<T = unknown>(kanal: string, girdi?: unknown): Promise<{ veri?: T; hata?: UygulamaHatasi }> {
  try {
    return { veri: await cagir<T>(kanal, girdi) };
  } catch (hata) {
    return { hata: hata instanceof UygulamaHatasi ? hata : new UygulamaHatasi('SUNUCU_HATASI', String(hata)) };
  }
}

export function olayDinle(geriCagri: (olay: string, veri: unknown) => void): () => void {
  try {
    return kopruAl().olayDinle(geriCagri);
  } catch {
    return () => {};
  }
}

export const platform = (): string => {
  try {
    return kopruAl().platform;
  } catch {
    return 'bilinmiyor';
  }
};
