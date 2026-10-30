/**
 * Ekran tuş takımı: dokunmatik kasada sayı alanına dokunulunca yanında açılan
 * büyük rakam tuşları.
 *
 * Tek bir bileşen TÜM sayı alanlarına hizmet eder; alanların kendisi değişmez.
 * Tuşlar yazıyı odaktaki alana tarayıcının kendi "yazma" komutuyla ekler, yani
 * alan klavyeden yazılmış gibi davranır (onChange, seçili metnin üstüne yazma,
 * Enter ile onay). Bu yüzden fiziksel klavye HER ZAMAN çalışmaya devam eder —
 * tuş takımı yalnız ek bir giriş yoludur.
 *
 * Ne zaman açılır (Ayarlar → Görünüm → Ekran tuş takımı, cihaza özel):
 *  - otomatik (varsayılan): alana PARMAKLA (ya da kalemle) dokunulduysa. Fareyle
 *    tıklanınca, Tab'la gelinince ya da klavyeden yazılmaya başlanınca açılmaz /
 *    çekilir. Aynı program dokunmatik kasada da evdeki dizüstünde de ayar
 *    değiştirmeden doğru davranır.
 *  - acik: sayı alanı her odaklandığında.
 *  - kapali: hiç.
 *
 * SATIŞ EKRANI: tuş takımı sepetin üstüne değil, sağdaki hızlı ürün
 * ızgarasının ALTINA yerleşir (`data-tus-takimi-yeri`). Barkod kutusu da
 * kapsanır (`data-tus-takimi="barkod"`): virgül yerine × (koli: 12×barkod) ve
 * harfle arama için ABC tuşu vardır.
 *
 * WINDOWS DOKUNMATİK KLAVYESİ: klavyesi takılı olmayan kasada parmakla bir
 * alana dokununca Windows kendi klavyesini de açar ve ekranın yarısını
 * kapatır. Sayı alanına parmakla dokunulduğunda alanın `inputmode`'u odak
 * gelmeden "none" yapılır (Windows klavyesi açılmaz), alan bırakılınca eski
 * hâline döner.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type TusTakimiModu = 'otomatik' | 'acik' | 'kapali';

/**
 * Sayı alanı sayılanlar. `sayi` sınıfı rakam girilen alanların ortak
 * görünümüdür; inputMode verilmemiş eski alanlar da böylece kapsanır.
 */
const SAYI_ALANI =
  'input[inputmode="decimal"], input[inputmode="numeric"], input[inputmode="tel"], input[type="number"], input.sayi, input[data-tus-takimi], input[data-eski-inputmode]';

function sayiAlaniMi(el: unknown): el is HTMLInputElement {
  return (
    el instanceof HTMLInputElement &&
    el.matches(SAYI_ALANI) &&
    el.type !== 'checkbox' &&
    el.type !== 'radio' &&
    !el.disabled &&
    !el.readOnly &&
    // ABC'ye basılıp harf klavyesine geçilmiş alan: bırakılana kadar sayı takımı açılmaz.
    el.dataset.tusTakimiAbc !== '1'
  );
}

/** Asıl inputmode (dokunuşta geçici olarak "none" yapılmış olabilir). */
function asilInputMode(alan: HTMLInputElement): string {
  return alan.dataset.eskiInputmode ?? alan.inputMode;
}

/** Windows dokunmatik klavyesi açılmasın: odak GELMEDEN inputmode "none". */
function sistemKlavyesiniSustur(alan: HTMLInputElement) {
  if (alan.dataset.eskiInputmode !== undefined) return;
  alan.dataset.eskiInputmode = alan.getAttribute('inputmode') ?? '';
  alan.setAttribute('inputmode', 'none');
}

function sistemKlavyesiniGeriVer(alan: Element | null) {
  if (!(alan instanceof HTMLInputElement) || alan.dataset.eskiInputmode === undefined) return;
  const eski = alan.dataset.eskiInputmode;
  delete alan.dataset.eskiInputmode;
  if (eski) alan.setAttribute('inputmode', eski);
  else alan.removeAttribute('inputmode');
}

const barkodMu = (alan: HTMLInputElement) => alan.dataset.tusTakimi === 'barkod';

function modOku(): TusTakimiModu {
  const m = document.documentElement.dataset.tusTakimi;
  return m === 'acik' || m === 'kapali' ? m : 'otomatik';
}

/** Ondalık virgül yalnız tam sayı İSTEMEYEN alanlarda gösterilir (PIN, telefon, adet hariç). */
function virgulluMu(alan: HTMLInputElement): boolean {
  const mod = asilInputMode(alan);
  return mod !== 'numeric' && mod !== 'tel' && !barkodMu(alan);
}

/** Değeri doğrudan yazar ve React'e "input" olayıyla haber verir (yedek yol). */
function degerYaz(alan: HTMLInputElement, deger: string, imlec: number) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(alan, deger);
  try {
    alan.setSelectionRange(imlec, imlec);
  } catch {
    /* type=number seçim desteklemez */
  }
  alan.dispatchEvent(new Event('input', { bubbles: true }));
}

function secim(alan: HTMLInputElement): [number, number] {
  const uzunluk = alan.value.length;
  try {
    return [alan.selectionStart ?? uzunluk, alan.selectionEnd ?? uzunluk];
  } catch {
    return [uzunluk, uzunluk];
  }
}

function metinEkle(alan: HTMLInputElement, metin: string) {
  alan.focus();
  // Tarayıcının yazma komutu geri alma (Ctrl+Z) geçmişini ve seçimi korur.
  if (document.execCommand('insertText', false, metin)) return;
  const [bas, son] = secim(alan);
  degerYaz(alan, alan.value.slice(0, bas) + metin + alan.value.slice(son), bas + metin.length);
}

function geriSil(alan: HTMLInputElement) {
  alan.focus();
  if (alan.value === '') return;
  if (document.execCommand('delete', false)) return;
  const [bas, son] = secim(alan);
  const yeniBas = bas === son ? Math.max(0, bas - 1) : bas;
  degerYaz(alan, alan.value.slice(0, yeniBas) + alan.value.slice(son), yeniBas);
}

function temizle(alan: HTMLInputElement) {
  alan.focus();
  if (alan.value === '') return;
  alan.select();
  if (document.execCommand('delete', false)) return;
  degerYaz(alan, '', 0);
}

/** Enter'a basılmış gibi: alanın kendi onay davranışı (sepete ekle, kaydet…) çalışır. */
function enterBas(alan: HTMLInputElement) {
  alan.focus();
  const olay = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true });
  const islenmedi = alan.dispatchEvent(olay);
  // Klavyedeki Enter formu da gönderir; aynısını yap.
  if (islenmedi && alan.isConnected && alan.form) alan.form.requestSubmit();
}

interface Konum {
  sol: number;
  ust: number;
}

const BOSLUK = 12;

/**
 * Tuş takımını alanın penceresinin (diyalog) YANINA koyar ki diyalogdaki
 * düğmeleri ve toplamı örtmesin. Yan tarafta yer yoksa alanın altına/üstüne.
 */
function konumHesapla(alan: HTMLInputElement, genislik: number, yukseklik: number): Konum {
  const g = window.innerWidth;
  const y = window.innerHeight;
  const a = alan.getBoundingClientRect();
  const diyalog = alan.closest('[role="dialog"]');

  /*
   * Diyalog dışındaki alan (satış ekranı: barkod, sepetteki miktar/fiyat):
   * sayfanın ayırdığı yere (hızlı ürün ızgarası) ALTTAN yerleşir — sepet ve
   * toplam görünür kalır.
   */
  const yer = diyalog ? null : document.querySelector<HTMLElement>('[data-tus-takimi-yeri]');
  const yerKutusu = yer?.getBoundingClientRect();
  if (yerKutusu && yerKutusu.width >= genislik && yerKutusu.height >= yukseklik) {
    return {
      sol: Math.round(yerKutusu.left + (yerKutusu.width - genislik) / 2),
      ust: Math.round(Math.min(yerKutusu.bottom, y) - yukseklik - BOSLUK),
    };
  }

  const cerceve = (diyalog ?? alan).getBoundingClientRect();
  const dikeyOrta = Math.min(Math.max(BOSLUK, a.top + a.height / 2 - yukseklik / 2), y - yukseklik - BOSLUK);

  if (g - cerceve.right >= genislik + BOSLUK * 2) return { sol: cerceve.right + BOSLUK, ust: dikeyOrta };
  if (cerceve.left >= genislik + BOSLUK * 2) return { sol: cerceve.left - genislik - BOSLUK, ust: dikeyOrta };

  const sol = Math.min(Math.max(BOSLUK, a.left), g - genislik - BOSLUK);
  const ust = a.bottom + BOSLUK + yukseklik <= y ? a.bottom + BOSLUK : Math.max(BOSLUK, a.top - yukseklik - BOSLUK);
  return { sol, ust };
}

export function EkranTusTakimi() {
  const [hedef, setHedef] = useState<HTMLInputElement | null>(null);
  const [konum, setKonum] = useState<Konum | null>(null);
  const kutu = useRef<HTMLDivElement>(null);
  /** Son etkileşim parmak/kalemle mi yapıldı (otomatik mod bunu sorar). */
  const dokunmatik = useRef(false);
  /** Son dokunulan öğe — barkod kutusu yalnız DOĞRUDAN dokunulunca açılır. */
  const sonDokunulan = useRef<EventTarget | null>(null);

  useEffect(() => {
    const isaretci = (e: PointerEvent) => {
      // Tuş takımının kendi tuşları modu değiştirmez.
      if (kutu.current?.contains(e.target as Node)) return;
      dokunmatik.current = e.pointerType === 'touch' || e.pointerType === 'pen';
      sonDokunulan.current = e.target;
      if (dokunmatik.current && sayiAlaniMi(e.target) && modOku() !== 'kapali') sistemKlavyesiniSustur(e.target);
      // Zaten odakta olan alana yeniden dokunuldu (ör. klavyeyle yazınca çekilmişti
      // ya da ✕ ile kapatılmıştı): odak olayı gelmez, tuş takımı burada açılır.
      const mod = modOku();
      if (
        sayiAlaniMi(e.target) &&
        e.target === document.activeElement &&
        (mod === 'acik' || (mod === 'otomatik' && dokunmatik.current))
      ) {
        setHedef(e.target);
      }
    };
    const tus = (e: KeyboardEvent) => {
      if (!e.isTrusted) return; // tuş takımının ürettiği Enter
      dokunmatik.current = false;
      // Fiziksel klavyeyle yazılmaya başlandı: otomatik modda tuş takımı çekilir.
      if (modOku() === 'otomatik' && e.key !== 'Shift') setHedef(null);
    };
    const odak = (e: FocusEvent) => {
      const mod = modOku();
      let goster = sayiAlaniMi(e.target) && (mod === 'acik' || (mod === 'otomatik' && dokunmatik.current));
      /*
       * Barkod kutusu satıştan sonra kendiliğinden odak alır. Orada açılsaydı
       * takım hızlı ürün ızgarasının altını hep kapatırdı; yalnız kutunun
       * kendisine dokunulunca açılır.
       */
      if (goster && barkodMu(e.target as HTMLInputElement) && sonDokunulan.current !== e.target) goster = false;
      setHedef(goster ? (e.target as HTMLInputElement) : null);
    };
    const odakKaybi = (e: FocusEvent) => {
      sistemKlavyesiniGeriVer(e.target as Element | null);
      if (e.target instanceof HTMLInputElement) delete e.target.dataset.tusTakimiAbc;
      // Bir sayı alanından diğerine geçişte kapanıp açılmasın diye bir tur beklenir.
      setTimeout(() => {
        if (!sayiAlaniMi(document.activeElement)) setHedef(null);
      }, 0);
    };
    window.addEventListener('pointerdown', isaretci, true);
    window.addEventListener('keydown', tus, true);
    window.addEventListener('focusin', odak);
    window.addEventListener('focusout', odakKaybi);
    return () => {
      window.removeEventListener('pointerdown', isaretci, true);
      window.removeEventListener('keydown', tus, true);
      window.removeEventListener('focusin', odak);
      window.removeEventListener('focusout', odakKaybi);
    };
  }, []);

  // Açıkken konumu izle: diyalog büyüyüp küçülebilir, alan kaldırılabilir.
  useLayoutEffect(() => {
    if (!hedef) {
      setKonum(null);
      return;
    }
    let kare = 0;
    const izle = () => {
      if (!hedef.isConnected) {
        setHedef(null);
        return;
      }
      const k = kutu.current;
      if (k) {
        const yeni = konumHesapla(hedef, k.offsetWidth, k.offsetHeight);
        setKonum((eski) => (eski && eski.sol === yeni.sol && eski.ust === yeni.ust ? eski : yeni));
      }
      kare = requestAnimationFrame(izle);
    };
    izle();
    return () => cancelAnimationFrame(kare);
  }, [hedef]);

  if (!hedef) return null;

  const virgul = virgulluMu(hedef);
  const barkod = barkodMu(hedef);

  /** Barkod kutusunda harfle arama: sayı takımı çekilir, Windows klavyesine izin verilir. */
  const harfKlavyesi = () => {
    hedef.dataset.tusTakimiAbc = '1';
    sistemKlavyesiniGeriVer(hedef);
    setHedef(null);
    // Odak yeniden gelince Windows dokunmatik klavyesi (ayarı açıksa) açılır.
    hedef.blur();
    setTimeout(() => {
      hedef.dataset.tusTakimiAbc = '1';
      hedef.focus();
    }, 50);
  };
  const tusSinifi =
    'flex h-14 items-center justify-center rounded-lg bg-yuzey-2 font-mono text-2xl font-semibold text-metin shadow-sm active:bg-yuzey-4';

  const rakam = (r: string) => (
    <button key={r} type="button" className={tusSinifi} onClick={() => metinEkle(hedef, r)}>
      {r}
    </button>
  );

  return createPortal(
    <div
      ref={kutu}
      role="group"
      aria-label="Ekran tuş takımı"
      data-ekran-tus-takimi
      // Tuşa basmak odağı alandan ALMAMALI: aksi hâlde yazılacak yer kaybolur.
      onMouseDown={(e) => e.preventDefault()}
      className="kart fixed z-[70] w-64 select-none p-2 shadow-2xl"
      style={konum ? { left: konum.sol, top: konum.ust } : { left: -9999, top: 0 }}
    >
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-xs text-metin-3">{barkod ? 'Barkod / kısa kod' : 'Tuş takımı'}</span>
        {barkod && (
          <button
            type="button"
            className="ml-auto mr-1 rounded bg-yuzey-2 px-2 py-0.5 text-sm font-medium text-metin-2 hover:bg-yuzey-4"
            title="Harfle ürün aramak için"
            onClick={harfKlavyesi}
          >
            ABC
          </button>
        )}
        <button
          type="button"
          className="rounded px-2 py-0.5 text-sm text-metin-3 hover:bg-yuzey-2"
          aria-label="Tuş takımını kapat"
          onClick={() => setHedef(null)}
        >
          ✕
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {rakam('7')}
        {rakam('8')}
        {rakam('9')}
        <button type="button" className={tusSinifi} aria-label="Sil" onClick={() => geriSil(hedef)}>
          ⌫
        </button>
        {rakam('4')}
        {rakam('5')}
        {rakam('6')}
        <button type="button" className={`${tusSinifi} text-base`} aria-label="Temizle" onClick={() => temizle(hedef)}>
          C
        </button>
        {rakam('1')}
        {rakam('2')}
        {rakam('3')}
        <button
          type="button"
          className="row-span-2 flex items-center justify-center rounded-lg bg-vurgu text-base font-semibold text-vurgu-uzeri shadow-sm active:brightness-90"
          onClick={() => {
            enterBas(hedef);
            // Barkod kutusunda takım açık kalır: arka arkaya kısa kod girilir.
            if (!barkod) setHedef(null);
          }}
        >
          Tamam
        </button>
        <button
          type="button"
          className={`${tusSinifi} ${virgul || barkod ? 'col-span-2' : 'col-span-3'}`}
          onClick={() => metinEkle(hedef, '0')}
        >
          0
        </button>
        {virgul && (
          <button type="button" className={tusSinifi} aria-label="Virgül" onClick={() => metinEkle(hedef, ',')}>
            ,
          </button>
        )}
        {barkod && (
          <button type="button" className={tusSinifi} aria-label="Çarpı (koli)" onClick={() => metinEkle(hedef, '*')}>
            ×
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
