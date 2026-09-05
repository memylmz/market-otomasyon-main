/**
 * Klavye kısayolları (§3.3 klavye-öncelikli akış).
 *
 * Kurallar:
 *  - Kısayollar sabittir ve ekranda görünür (satış ekranında alt çubuk).
 *  - Bir metin alanına yazarken F-tuşları çalışır, ama harf kısayolları çalışmaz.
 *  - Diyalog açıkken alttaki ekranın kısayolları devre dışı kalır.
 */

import { useEffect, useRef } from 'react';

export interface KisayolTanimi {
  /** 'F2', 'F12', 'Escape', 'Enter', 'ctrl+p' gibi. Birden çok alternatif için dizi. */
  tus: string | string[];
  calistir: (olay: KeyboardEvent) => void;
  /** Metin alanındayken de çalışsın mı? F-tuşları için varsayılan true. */
  alanIcindeDe?: boolean;
  aktif?: boolean;
  /** Tarayıcı varsayılanını engelle (F5 yenileme gibi). */
  engelle?: boolean;
  /**
   * Shift durumunu yok say.
   *
   * `+` gibi karakterler çoğu klavye düzeninde Shift ile üretilir (Türkçe Q'da
   * `+` = Shift+`4`'ün yanındaki tuş). Shift'i katı karşılaştırmak bu kısayolları
   * sessizce çalışmaz hâle getirir — noktalama kısayollarında bunu açın.
   */
  shiftYokSay?: boolean;
}

function tekTusEslesiyorMu(olay: KeyboardEvent, tanim: string, shiftYokSay: boolean): boolean {
  const parcalar = tanim.toLowerCase().split('+').filter(Boolean);
  // 'ctrl+plus' gibi tanımlarda son parça tuş adıdır; yalnız '+' tanımında
  // split boş parça üretmesin diye filtrelendi.
  const tus = tanim === '+' ? '+' : (parcalar[parcalar.length - 1] ?? '');
  const ctrl = parcalar.includes('ctrl');
  const shift = parcalar.includes('shift');
  const alt = parcalar.includes('alt');

  if (olay.ctrlKey !== ctrl || olay.altKey !== alt) return false;
  if (!shiftYokSay && olay.shiftKey !== shift) return false;
  return olay.key.toLowerCase() === tus;
}

function tusEslesiyorMu(olay: KeyboardEvent, tanim: string | string[], shiftYokSay = false): boolean {
  const adaylar = Array.isArray(tanim) ? tanim : [tanim];
  return adaylar.some((aday) => tekTusEslesiyorMu(olay, aday, shiftYokSay));
}

function metinAlanindaMi(hedef: EventTarget | null): boolean {
  if (!(hedef instanceof HTMLElement)) return false;
  const etiket = hedef.tagName;
  return etiket === 'INPUT' || etiket === 'TEXTAREA' || etiket === 'SELECT' || hedef.isContentEditable;
}

export function useKisayol(kisayollar: KisayolTanimi[], bagimlilik: unknown[] = []): void {
  const referans = useRef(kisayollar);
  referans.current = kisayollar;

  useEffect(() => {
    const dinleyici = (olay: KeyboardEvent) => {
      for (const kisayol of referans.current) {
        if (kisayol.aktif === false) continue;
        if (!tusEslesiyorMu(olay, kisayol.tus, kisayol.shiftYokSay)) continue;

        const ilkTus = Array.isArray(kisayol.tus) ? (kisayol.tus[0] ?? '') : kisayol.tus;
        const fTusu = /^f\d{1,2}$/i.test(ilkTus.split('+').pop() ?? '');
        const alanIcinde = metinAlanindaMi(olay.target);
        const izinli = kisayol.alanIcindeDe ?? fTusu;
        if (alanIcinde && !izinli) continue;

        if (kisayol.engelle !== false) olay.preventDefault();
        kisayol.calistir(olay);
        return;
      }
    };

    window.addEventListener('keydown', dinleyici);
    return () => window.removeEventListener('keydown', dinleyici);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, bagimlilik);
}

/**
 * Barkod okuyucu desteği: HID okuyucular tuşları çok hızlı gönderir ve `Enter`
 * ile bitirir. Aynı barkodun kısa sürede iki kez okunmasını yok sayar (§20 debounce).
 */
export function useBarkodTekrarKorumasi(esikMs = 120): (barkod: string) => boolean {
  const sonuncu = useRef<{ barkod: string; zaman: number } | null>(null);

  return (barkod: string) => {
    const simdi = Date.now();
    const onceki = sonuncu.current;
    if (onceki && onceki.barkod === barkod && simdi - onceki.zaman < esikMs) return false;
    sonuncu.current = { barkod, zaman: simdi };
    return true;
  };
}

/**
 * Barkod alanı odakta değilken okutmayı yakalar.
 *
 * SORUN: Kasiyer bir düğmeye ya da tabloya tıkladıktan sonra barkod okutunca
 * tuşlar hiçbir yere gitmez; önce barkod kutusuna tıklaması gerekir. Bu, her
 * müşteride kaybedilen saniyeler demektir.
 *
 * ÇÖZÜM: Sayfada bir yazı alanında değilken basılabilir bir karakter gelirse,
 * karakteri yutup barkod alanına odaklanır ve karakteri oraya aktarır. Kullanıcı
 * hiçbir şey fark etmez; yazmaya devam eder.
 *
 * Sadece okuyucuya özel değildir — elle yazmaya başlayan kullanıcı da aynı
 * kolaylığı görür. Tarayıcı kısayolları (Ctrl/Alt/Meta) ve F-tuşları dokunulmaz.
 */
export function useBarkodOdakYakalayici(secenekler: {
  aktif: boolean;
  onKarakter: (karakter: string) => void;
  odakla: () => void;
}): void {
  const referans = useRef(secenekler);
  referans.current = secenekler;

  useEffect(() => {
    const dinleyici = (olay: KeyboardEvent) => {
      const { aktif, onKarakter, odakla } = referans.current;
      if (!aktif) return;
      if (olay.ctrlKey || olay.altKey || olay.metaKey) return;
      // Yalnız tek karakterlik basılabilir tuşlar; Enter/F2/Ok tuşları kısayollara ait.
      if (olay.key.length !== 1) return;
      if (metinAlanindaMi(olay.target)) return;

      olay.preventDefault();
      odakla();
      onKarakter(olay.key);
    };

    window.addEventListener('keydown', dinleyici);
    return () => window.removeEventListener('keydown', dinleyici);
  }, []);
}
