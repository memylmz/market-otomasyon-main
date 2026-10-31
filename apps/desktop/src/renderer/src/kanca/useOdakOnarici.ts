/**
 * Klavye odağı güvenlik ağı.
 *
 * SORUN: Windows'ta kasa penceresi önde ve etkin görünürken klavye odağı
 * sayfada olmayabiliyor (sistem penceresi kapandıktan, başka programdan
 * dönüldükten sonra). Kasiyer kutuya tıklar, imleç gelmez, yazı yazılmaz,
 * barkod okutulamaz — ancak programı simge durumuna küçültüp açınca düzelir.
 *
 * ÇÖZÜM: Yazı kutusuna tıklandığında sayfanın odağı yoksa ana süreçten
 * pencereyi yeniden etkinleştirmesi istenir, sonra tıklanan kutuya odaklanılır.
 * Normal kullanımda (odak sayfadayken) hiçbir şey yapmaz.
 */

import { useEffect } from 'react';
import { cagirGuvenli } from '../kopru';

function yaziAlaniMi(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export function useOdakOnarici(): void {
  useEffect(() => {
    let onariliyor = false;
    const onar = async (hedef: HTMLElement | null) => {
      if (onariliyor) return;
      onariliyor = true;
      try {
        await cagirGuvenli('pencere.odakOnar');
        if (hedef?.isConnected) hedef.focus();
      } finally {
        onariliyor = false;
      }
    };

    const isaretci = (olay: PointerEvent) => {
      const hedef = yaziAlaniMi(olay.target) ? olay.target : null;
      // Tıklamanın kendisi odağı vermiş olabilir; bir tur sonra bakılır.
      setTimeout(() => {
        // Belge odaksız ya da tıklanan kutu odağı alamadı ve odak hiçbir yerde değil:
        // klavye kopuk. (Kutu odağı bilerek başka yere, ör. açılan diyaloğa, verdiyse dokunulmaz.)
        const odakYok = document.activeElement === null || document.activeElement === document.body;
        const kutuOdaksiz = hedef !== null && hedef.isConnected && !hedef.matches(':disabled') && odakYok;
        if (!document.hasFocus() || kutuOdaksiz) void onar(hedef);
      }, 60);
    };
    window.addEventListener('pointerdown', isaretci, true);
    return () => window.removeEventListener('pointerdown', isaretci, true);
  }, []);
}
