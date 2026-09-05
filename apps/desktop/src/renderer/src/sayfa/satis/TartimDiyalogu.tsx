/**
 * Tartılı (KG/LT) ürün için miktar girişi.
 *
 * Terazi entegrasyonu bilinçli olarak kapsam dışıdır (blueprint); kasiyer
 * teraziden okuduğu değeri buraya girer. İki pratik yol sunulur:
 *  1. Miktar girmek (0,5 = yarım kilo) — hızlı düğmelerle tek dokunuş.
 *  2. Tutar girmek (müşteri "10 liralık ver" dediğinde) — miktar hesaplanır.
 */

import { useEffect, useRef, useState } from 'react';
import { miktarFormat, miktarParse, paraFormat, paraParse, type Miktar } from '@market/shared';
import { Diyalog, Kisayol } from '../../bilesen/temel';
import type { EklenecekUrun } from '../../durum/sepet';

const HIZLI_MIKTARLAR = [0.25, 0.5, 1, 1.5, 2] as const;

export function TartimDiyalogu({
  urun,
  onKapat,
  onEkle,
}: {
  urun: EklenecekUrun | null;
  onKapat: () => void;
  onEkle: (miktar: Miktar) => void;
}) {
  const [miktarMetni, setMiktarMetni] = useState('');
  const [tutarMetni, setTutarMetni] = useState('');
  /** Son hangi alan düzenlendiyse hesap ona göre yapılır. */
  const [kaynak, setKaynak] = useState<'miktar' | 'tutar'>('miktar');
  const miktarAlani = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (urun) {
      setMiktarMetni('');
      setTutarMetni('');
      setKaynak('miktar');
      setTimeout(() => miktarAlani.current?.focus(), 20);
    }
  }, [urun]);

  if (!urun) return null;

  const birimEtiketi = urun.birimTipi === 'LT' ? 'litre' : 'kg';
  const tutarKurus = paraParse(tutarMetni) ?? 0;
  const miktar: Miktar =
    kaynak === 'miktar'
      ? (miktarParse(miktarMetni) ?? 0)
      : urun.birimFiyat > 0
        ? Math.round((tutarKurus * 1000) / urun.birimFiyat)
        : 0;
  const satirTutari = Math.round((miktar * urun.birimFiyat) / 1000);

  const onayla = () => {
    if (miktar <= 0) return;
    onEkle(miktar);
  };

  const enterIleOnayla = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onayla();
    }
  };

  return (
    <Diyalog
      acik
      baslik={urun.ad}
      aciklama={`Birim fiyat: ${paraFormat(urun.birimFiyat)} / ${birimEtiketi}`}
      genislik="dar"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç <Kisayol>ESC</Kisayol>
          </button>
          <button type="button" className="tus-birincil" onClick={onayla} disabled={miktar <= 0}>
            Sepete Ekle <Kisayol>Enter</Kisayol>
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <span className="etiket">Miktar ({birimEtiketi})</span>
          <input
            ref={miktarAlani}
            type="text"
            inputMode="decimal"
            className="alan sayi py-3 text-xl"
            placeholder={`örn. 0,5 = 500 g`}
            value={kaynak === 'miktar' ? miktarMetni : miktar > 0 ? miktarFormat(miktar, undefined, false) : ''}
            onChange={(e) => {
              setKaynak('miktar');
              setMiktarMetni(e.target.value);
            }}
            onKeyDown={enterIleOnayla}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {HIZLI_MIKTARLAR.map((h) => (
              <button
                key={h}
                type="button"
                className="tus-ikincil px-3 py-1.5 text-sm"
                onClick={() => {
                  setKaynak('miktar');
                  setMiktarMetni(String(h).replace('.', ','));
                  miktarAlani.current?.focus();
                }}
              >
                {String(h).replace('.', ',')} {birimEtiketi}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="etiket">ya da tutara göre (₺)</span>
          <input
            type="text"
            inputMode="decimal"
            className="alan sayi"
            placeholder='örn. 50 — "50 liralık ver"'
            value={tutarMetni}
            onChange={(e) => {
              setKaynak('tutar');
              setTutarMetni(e.target.value);
            }}
            onKeyDown={enterIleOnayla}
          />
        </div>

        <div className="rounded-lg bg-yuzey-3 p-3 text-center">
          <p className="text-sm text-metin-3">{miktar > 0 ? `${miktarFormat(miktar, urun.birimTipi)}` : 'Miktar girilmedi'}</p>
          <p className="font-mono text-2xl font-bold text-vurgu">{paraFormat(satirTutari)}</p>
        </div>
      </div>
    </Diyalog>
  );
}
