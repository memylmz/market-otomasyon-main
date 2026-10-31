/** Yeniden kullanılan temel arayüz bileşenleri. */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { miktarFormat, miktarParse, paraFormat, paraParse, type BirimTipi, type Kurus, type Miktar } from '@market/shared';
import { bildirimDurumu, type BildirimTuru } from '../durum/bildirim';
import { onayDurumu } from '../durum/onay';

// ---------------------------------------------------------------------------
// Diyalog
// ---------------------------------------------------------------------------

export interface DiyalogOzellikleri {
  acik: boolean;
  baslik: string;
  aciklama?: string;
  /**
   * `tam`: neredeyse tüm ekranı kaplar. Mal kabul gibi ONLARCA SATIRIN yan
   * yana girildiği formlar için; dar bir diyalogda sütunlar sıkışıyor ve
   * kullanıcı sürekli kaydırmak zorunda kalıyor.
   */
  genislik?: 'dar' | 'orta' | 'genis' | 'tam';
  /**
   * `false`: gövde KENDİ kaydırmasını yapmaz, kalan yüksekliği olduğu gibi
   * çocuğa verir. Mal kabul gibi formlarda üst şerit ve toplamlar sabit
   * kalmalı, yalnız ORTADAKİ tablo kaymalıdır; gövdenin tamamı kayarsa
   * barkod alanı ve toplam ekranın dışına çıkıyordu.
   */
  kaydirma?: boolean;
  onKapat: () => void;
  children: ReactNode;
  altBilgi?: ReactNode;
}

/**
 * Açık diyalogların yığını: iç içe diyaloglarda (ör. ödeme üstünde müşteri seçimi)
 * ESC yalnız EN ÜSTTEKİNİ kapatmalıdır. Her Diyalog açılırken kimliğini buraya
 * ekler; ESC geldiğinde sadece yığının tepesindeki kendini kapatır.
 */
const diyalogYigini: symbol[] = [];

export function Diyalog({
  acik,
  baslik,
  aciklama,
  genislik = 'orta',
  kaydirma = true,
  onKapat,
  children,
  altBilgi,
}: DiyalogOzellikleri) {
  const kutu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!acik) return;
    // Açılışta ilk odaklanabilir öğeye odaklan (klavye akışı kesilmesin).
    const zamanlayici = setTimeout(() => {
      // Başlıktaki ✕ atlanır: ilk odak onda kalırsa tutar alanına yazılan rakam alanı seçmeden eski değerin önüne eklenir.
      const hedef = kutu.current?.querySelector<HTMLElement>(
        '[data-odak], input, select, textarea, button:not([data-diyalog-kapat])',
      );
      hedef?.focus();
    }, 10);
    return () => clearTimeout(zamanlayici);
  }, [acik]);

  useEffect(() => {
    if (!acik) return;
    const kimlik = Symbol('diyalog');
    diyalogYigini.push(kimlik);
    const dinleyici = (olay: KeyboardEvent) => {
      if (olay.key !== 'Escape') return;
      if (diyalogYigini[diyalogYigini.length - 1] !== kimlik) return; // üstte başka diyalog var
      olay.preventDefault();
      olay.stopPropagation();
      onKapat();
    };
    // Yakalama aşamasında dinle: alttaki ekranın ESC kısayolu tetiklenmesin.
    window.addEventListener('keydown', dinleyici, true);
    return () => {
      const sira = diyalogYigini.indexOf(kimlik);
      if (sira >= 0) diyalogYigini.splice(sira, 1);
      window.removeEventListener('keydown', dinleyici, true);
    };
  }, [acik, onKapat]);

  if (!acik) return null;

  const genislikSinifi =
    genislik === 'dar' ? 'max-w-md' : genislik === 'genis' ? 'max-w-5xl' : genislik === 'tam' ? 'max-w-[96vw]' : 'max-w-2xl';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ortu/50 p-4" role="presentation">
      <div
        ref={kutu}
        role="dialog"
        aria-modal="true"
        aria-label={baslik}
        className={`kart flex w-full flex-col ${genislikSinifi} ${genislik === 'tam' ? 'h-[94vh] max-h-[94vh]' : 'max-h-[90vh]'} overflow-hidden shadow-2xl`}
      >
        {/*
          Her diyaloğun sağ üstünde ✕ var. Eskiden kapatmak yalnız alttaki
          düğmelerle ya da ESC ile oluyordu; alt düğmesinde "Kapat" olmayan bir
          pencerede (etiket kuyruğu) dokunmatik kasada çıkış yolu kalmıyordu.
        */}
        <header className="flex shrink-0 items-start gap-3 border-b border-cizgi px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{baslik}</h2>
            {aciklama && <p className="mt-1 text-sm text-metin-3">{aciklama}</p>}
          </div>
          <button
            type="button"
            className="-mr-2 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl text-metin-3 hover:bg-yuzey-2 hover:text-metin"
            onClick={onKapat}
            aria-label="Kapat"
            title="Kapat (Esc)"
            tabIndex={-1}
            data-diyalog-kapat
          >
            ✕
          </button>
        </header>
        <div
          className={`min-h-0 flex-1 px-5 py-4 ${kaydirma ? 'overflow-y-auto' : 'flex flex-col overflow-hidden'} ${
            genislik === 'tam' ? '' : 'max-h-[65vh]'
          }`}
        >
          {children}
        </div>
        {altBilgi && <footer className="flex shrink-0 justify-end gap-2 border-t border-cizgi px-5 py-3">{altBilgi}</footer>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onay diyaloğu — yıkıcı işlemler için (§3.3 hata affı)
// ---------------------------------------------------------------------------

export function OnayDiyalogu({
  acik,
  baslik,
  mesaj,
  onaylaMetni = 'Onayla',
  tehlikeli = false,
  onOnayla,
  onIptal,
}: {
  acik: boolean;
  baslik: string;
  mesaj: string;
  onaylaMetni?: string;
  tehlikeli?: boolean;
  onOnayla: () => void;
  onIptal: () => void;
}) {
  const onayTusu = useRef<HTMLButtonElement>(null);
  // Diyalog belge sırasındaki ilk düğmeye (Vazgeç) odaklanır; onay sorusunda
  // Enter onaylamalı (kasiyerin alışkanlığı: ESC → Enter sepeti temizler).
  useEffect(() => {
    if (!acik) return;
    const z = setTimeout(() => onayTusu.current?.focus(), 20);
    return () => clearTimeout(z);
  }, [acik]);

  return (
    <Diyalog
      acik={acik}
      baslik={baslik}
      onKapat={onIptal}
      genislik="dar"
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onIptal}>
            Vazgeç
          </button>
          <button
            ref={onayTusu}
            type="button"
            className={tehlikeli ? 'tus-tehlike' : 'tus-birincil'}
            onClick={onOnayla}
            data-odak
          >
            {onaylaMetni}
          </button>
        </>
      }
    >
      <p className="whitespace-pre-line text-metin-2">{mesaj}</p>
    </Diyalog>
  );
}

/**
 * `onayla()` sorularını gösterir (uygulamada bir kez, App içinde).
 * Kapanınca odak soru açılmadan önceki alana döner — satış ekranında barkod kutusu.
 */
export function OnayKatmani() {
  const bekleyen = onayDurumu((s) => s.bekleyen);
  const yanitla = onayDurumu((s) => s.yanitla);
  const oncekiOdak = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!bekleyen) return;
    oncekiOdak.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const alan = oncekiOdak.current;
      oncekiOdak.current = null;
      // Diyalog DOM'dan çıktıktan sonra; sayfa kendisi başka yere odaklandıysa dokunulmaz.
      setTimeout(() => {
        if (alan?.isConnected && (document.activeElement === document.body || document.activeElement === null)) alan.focus();
      }, 0);
    };
  }, [bekleyen]);

  return (
    <OnayDiyalogu
      acik={bekleyen !== null}
      baslik={bekleyen?.baslik ?? 'Onay'}
      mesaj={bekleyen?.mesaj ?? ''}
      onaylaMetni={bekleyen?.onaylaMetni}
      tehlikeli={bekleyen?.tehlikeli}
      onOnayla={() => yanitla(true)}
      onIptal={() => yanitla(false)}
    />
  );
}

// ---------------------------------------------------------------------------
// Para ve miktar girişi
// ---------------------------------------------------------------------------

export function ParaAlani({
  deger,
  onDegisim,
  otomatikOdak,
  placeholder = '0,00',
  sinif = '',
  onEnter,
  onOdak,
  devreDisi,
  etiket,
}: {
  deger: Kurus;
  onDegisim: (kurus: Kurus) => void;
  otomatikOdak?: boolean;
  placeholder?: string;
  sinif?: string;
  onEnter?: () => void;
  /** Odaklanınca çağrılır — sepet satırında "bu satırı seç" için. */
  onOdak?: () => void;
  devreDisi?: boolean;
  etiket?: string;
}) {
  const [metin, setMetin] = useState(() => (deger === 0 ? '' : paraFormat(deger, { simge: false })));
  const [duzenleniyor, setDuzenleniyor] = useState(false);

  // Dışarıdan değer değişirse (ör. hızlı tutar butonu) alanı senkronla.
  useEffect(() => {
    if (!duzenleniyor) setMetin(deger === 0 ? '' : paraFormat(deger, { simge: false }));
  }, [deger, duzenleniyor]);

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={etiket}
      className={`alan sayi ${sinif}`}
      placeholder={placeholder}
      value={metin}
      autoFocus={otomatikOdak}
      disabled={devreDisi}
      onFocus={(e) => {
        setDuzenleniyor(true);
        e.currentTarget.select();
        onOdak?.();
      }}
      onBlur={() => {
        setDuzenleniyor(false);
        setMetin(deger === 0 ? '' : paraFormat(deger, { simge: false }));
      }}
      onChange={(e) => {
        setMetin(e.target.value);
        onDegisim(paraParse(e.target.value) ?? 0);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

export function MiktarAlani({
  deger,
  birim,
  onDegisim,
  onEnter,
  onOdak,
  otomatikOdak,
  sinif = '',
}: {
  deger: Miktar;
  birim: BirimTipi;
  onDegisim: (miktar: Miktar) => void;
  onEnter?: () => void;
  /** Odaklanınca çağrılır — sepet satırında "bu satırı seç" için. */
  onOdak?: () => void;
  otomatikOdak?: boolean;
  sinif?: string;
}) {
  const [metin, setMetin] = useState(() => miktarFormat(deger, birim, false));
  const [duzenleniyor, setDuzenleniyor] = useState(false);

  useEffect(() => {
    if (!duzenleniyor) setMetin(miktarFormat(deger, birim, false));
  }, [deger, birim, duzenleniyor]);

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label="Miktar"
      className={`alan sayi ${sinif}`}
      value={metin}
      autoFocus={otomatikOdak}
      onFocus={(e) => {
        setDuzenleniyor(true);
        e.currentTarget.select();
        onOdak?.();
      }}
      onBlur={() => {
        setDuzenleniyor(false);
        setMetin(miktarFormat(deger, birim, false));
      }}
      onChange={(e) => {
        setMetin(e.target.value);
        const cozulen = miktarParse(e.target.value);
        /*
         * Yalnız POZİTİF ara değerler anında uygulanır.
         *
         * "0,5" yazarken ilk tuş "0"dır; 0'ı hemen uygulamak satırı sepetten
         * sildiriyordu (kullanıcı hatası bildirimi). "0", "0," gibi ara durumlar
         * beklenir; alan terk edilirse (blur) görünen değer gerçek miktara döner.
         * Satır silme yalnız Sil düğmesi/kısayoluyla yapılır.
         */
        if (cozulen !== null && cozulen > 0) onDegisim(cozulen);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Durum göstergeleri
// ---------------------------------------------------------------------------

/**
 * Renk körü dostu rozet: renge ek olarak ikon ve metin taşır (§3.9).
 */
export function Rozet({ tur, children }: { tur: 'basari' | 'uyari' | 'tehlike' | 'notr' | 'bilgi'; children: ReactNode }) {
  const sinif =
    tur === 'basari'
      ? 'bg-vurgu-yumusak text-vurgu border-vurgu'
      : tur === 'uyari'
        ? 'bg-uyari-yumusak text-uyari border-uyari-cizgi'
        : tur === 'tehlike'
          ? 'bg-tehlike-yumusak text-tehlike border-tehlike-cizgi'
          : tur === 'bilgi'
            ? 'bg-bilgi-yumusak text-bilgi border-bilgi-cizgi'
            : 'bg-yuzey-2 text-metin-2 border-cizgi-kuvvetli';
  const ikon = tur === 'basari' ? '✓' : tur === 'uyari' ? '!' : tur === 'tehlike' ? '✕' : tur === 'bilgi' ? 'i' : '·';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${sinif}`}>
      <span aria-hidden="true">{ikon}</span>
      {children}
    </span>
  );
}

export function BosDurum({ baslik, aciklama, eylem }: { baslik: string; aciklama?: string; eylem?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <p className="text-lg font-medium text-metin-2">{baslik}</p>
      {aciklama && <p className="max-w-md text-sm text-metin-4">{aciklama}</p>}
      {eylem}
    </div>
  );
}

export function Yukleniyor({ metin = 'Yükleniyor…' }: { metin?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-metin-3">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-cizgi-kuvvetli border-t-vurgu" aria-hidden="true" />
      {metin}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bildirim katmanı
// ---------------------------------------------------------------------------

const BILDIRIM_STILI: Record<BildirimTuru, string> = {
  basari: 'border-vurgu bg-vurgu-yumusak text-metin',
  hata: 'border-tehlike-cizgi bg-tehlike-yumusak text-metin',
  uyari: 'border-uyari-cizgi bg-uyari-yumusak text-metin',
  bilgi: 'border-bilgi-cizgi bg-bilgi-yumusak text-metin',
};

const BILDIRIM_IKONU: Record<BildirimTuru, string> = { basari: '✓', hata: '✕', uyari: '!', bilgi: 'i' };

export function BildirimKatmani() {
  const bildirimler = bildirimDurumu((s) => s.bildirimler);
  const kaldir = bildirimDurumu((s) => s.kaldir);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-96 flex-col gap-2" aria-live="polite">
      {bildirimler.map((b) => (
        <div key={b.id} className={`pointer-events-auto rounded-lg border p-3 shadow-xl ${BILDIRIM_STILI[b.tur]}`}>
          <div className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-0.5 font-bold">
              {BILDIRIM_IKONU[b.tur]}
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium">{b.mesaj}</p>
              {b.detay && <p className="mt-1 text-xs text-metin-2">{b.detay}</p>}
              {b.izlemeId && <p className="mt-1 font-mono text-[10px] text-metin-4">İzleme: {b.izlemeId}</p>}
            </div>
            <button
              type="button"
              className="text-metin-3 hover:text-metin"
              onClick={() => kaldir(b.id)}
              aria-label="Bildirimi kapat"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Küçük yardımcılar
// ---------------------------------------------------------------------------

export function Kisayol({ children }: { children: ReactNode }) {
  return <kbd className="kisayol">{children}</kbd>;
}

export function Alan({ etiket, children, ipucu }: { etiket: string; children: ReactNode; ipucu?: string }) {
  return (
    <label className="block">
      <span className="etiket">{etiket}</span>
      {children}
      {ipucu && <span className="mt-1 block text-xs text-metin-4">{ipucu}</span>}
    </label>
  );
}

export function TutarSatiri({ etiket, tutar, buyuk, vurgu }: { etiket: string; tutar: Kurus; buyuk?: boolean; vurgu?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between ${buyuk ? 'text-tutar' : 'text-sm'}`}>
      <span className={buyuk ? 'text-base font-medium text-metin-2' : 'text-metin-3'}>{etiket}</span>
      <span className={`sayi ${vurgu ? 'text-vurgu' : ''}`}>{paraFormat(tutar)}</span>
    </div>
  );
}
