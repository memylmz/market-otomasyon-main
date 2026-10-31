/**
 * "Tekli mi, paket mi?" — paketi tanımlı ürün okutulunca (ya da seçilince)
 * açılan küçük pencere. Satış ekranı ve mal kabul aynı pencereyi kullanır.
 *
 * Klavye: 1 → tekli, 2… → paketler, Enter → tekli (odak tekli düğmesinde),
 * Esc → vazgeç. Barkod okuyucu tuşları çok hızlı gönderir: pencere açıkken
 * okutulan bir barkodun rakamları SEÇİM sayılmasın diye rakam tuşu ancak
 * arkasından kısa sürede başka tuş gelmezse seçer.
 */

import { useEffect, useRef } from 'react';
import { paraFormat, type Kurus } from '@market/shared';
import { Diyalog } from './temel';

export interface PaketSecenegiGorunumu {
  id: string;
  ad: string;
  carpan: number;
  /** Satışta paketin (kampanyalı) fiyatı; mal kabulde gösterilmez. */
  satisFiyati?: Kurus;
}

/** Okuyucunun art arda tuşları arasındaki süre bundan kısadır; elle basış daha uzundur. */
const OKUYUCU_ARALIGI_MS = 60;

export function PaketSecimDiyalogu({
  acik,
  urunAdi,
  tekFiyat,
  paketler,
  onSec,
  onKapat,
}: {
  acik: boolean;
  urunAdi: string;
  /** Satışta tek ürünün fiyatı; mal kabulde verilmez. */
  tekFiyat?: Kurus;
  paketler: PaketSecenegiGorunumu[];
  /** null → tekli. */
  onSec: (paket: PaketSecenegiGorunumu | null) => void;
  onKapat: () => void;
}) {
  const tekliTusu = useRef<HTMLButtonElement>(null);
  const referans = useRef({ paketler, onSec });
  referans.current = { paketler, onSec };

  useEffect(() => {
    if (!acik) return;
    const z = setTimeout(() => tekliTusu.current?.focus(), 20);
    let bekleyen: ReturnType<typeof setTimeout> | null = null;
    const tus = (e: KeyboardEvent) => {
      // Okuyucunun bir sonraki tuşu geldi: önceki rakam seçim değildi.
      if (bekleyen) {
        clearTimeout(bekleyen);
        bekleyen = null;
        return;
      }
      if (!/^[1-9]$/.test(e.key) || e.ctrlKey || e.altKey) return;
      const sira = Number(e.key) - 1;
      const { paketler: liste, onSec: sec } = referans.current;
      if (sira > liste.length) return;
      e.preventDefault();
      bekleyen = setTimeout(() => {
        bekleyen = null;
        sec(sira === 0 ? null : (liste[sira - 1] ?? null));
      }, OKUYUCU_ARALIGI_MS);
    };
    window.addEventListener('keydown', tus, true);
    return () => {
      clearTimeout(z);
      if (bekleyen) clearTimeout(bekleyen);
      window.removeEventListener('keydown', tus, true);
    };
  }, [acik]);

  const secenek = (
    no: number,
    baslik: string,
    alt: string,
    fiyat: Kurus | undefined,
    sec: () => void,
    ref?: typeof tekliTusu,
  ) => (
    <button
      ref={ref}
      type="button"
      onClick={sec}
      className="flex w-full items-center gap-3 rounded-lg border border-cizgi bg-yuzey-2 px-4 py-3 text-left hover:border-vurgu focus:border-vurgu focus:outline-none focus:ring-2 focus:ring-vurgu/40"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-yuzey-4 font-mono text-lg font-bold">
        {no}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold">{baslik}</span>
        <span className="block text-sm text-metin-3">{alt}</span>
      </span>
      {fiyat !== undefined && <span className="font-mono text-xl font-bold text-vurgu">{paraFormat(fiyat)}</span>}
    </button>
  );

  return (
    <Diyalog acik={acik} baslik={urunAdi} aciklama="Tekli mi, paket mi? Enter: tekli" genislik="dar" onKapat={onKapat}>
      <div className="space-y-2">
        {secenek(1, 'Tekli', '1 adet', tekFiyat, () => onSec(null), tekliTusu)}
        {paketler.map((p, i) => (
          <div key={p.id}>{secenek(i + 2, p.ad, `${p.carpan} adet`, p.satisFiyati, () => onSec(p))}</div>
        ))}
      </div>
    </Diyalog>
  );
}
