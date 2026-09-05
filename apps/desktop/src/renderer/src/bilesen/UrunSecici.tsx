/**
 * Barkod VEYA isimle ürün seçici.
 *
 * Mal kabul ve tedarikçi iadesi gibi kalem ekleme akışlarında kullanılır:
 *  - Barkod okutulunca (rakam + Enter) ürün doğrudan eklenir.
 *  - Harf yazılınca canlı öneri listesi açılır; ↑↓ + Enter ya da tıklama ile seçilir.
 * Seçimden sonra alan temizlenir ve odak korunur — art arda kalem girişi kesintisizdir.
 */

import { useEffect, useRef, useState } from 'react';
import { miktarFormat, paraFormat, type BirimTipi, type Kurus, type Miktar } from '@market/shared';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { cagir } from '../kopru';

export interface SecilenUrun {
  id: string;
  ad: string;
  birim_tipi: BirimTipi;
  alis_fiyati: Kurus;
  satis_fiyati: Kurus;
  kdv_orani: number;
  stok: Miktar;
  aktif_mi: boolean;
  skt_takibi?: boolean;
  barkodlar: string[];
}

export function UrunSecici({
  onSec,
  placeholder = 'Barkod okutun veya ürün adı yazın…',
  otomatikOdak,
}: {
  onSec: (urun: SecilenUrun) => void;
  placeholder?: string;
  otomatikOdak?: boolean;
}) {
  const [metin, setMetin] = useState('');
  const [oneriler, setOneriler] = useState<SecilenUrun[]>([]);
  const [indeks, setIndeks] = useState(0);
  const alan = useRef<HTMLInputElement>(null);

  // Harf içeren girdide canlı arama; salt rakam barkoddur, öneri açılmaz.
  useEffect(() => {
    const terim = metin.trim();
    if (terim.length < 2 || /^[\d\s]*$/.test(terim)) {
      setOneriler([]);
      return;
    }
    let iptal = false;
    const zamanlayici = setTimeout(async () => {
      try {
        const veri = await cagir<SecilenUrun[]>('urun.ara', { terim, limit: 8 });
        if (!iptal) {
          setOneriler(veri.filter((u) => u.aktif_mi));
          setIndeks(0);
        }
      } catch {
        if (!iptal) setOneriler([]);
      }
    }, 160);
    return () => {
      iptal = true;
      clearTimeout(zamanlayici);
    };
  }, [metin]);

  const sec = (urun: SecilenUrun) => {
    setMetin('');
    setOneriler([]);
    onSec(urun);
    alan.current?.focus();
  };

  const barkodlaBul = async () => {
    const deger = metin.trim();
    setMetin('');
    setOneriler([]);
    if (!deger) return;
    try {
      const sonuc = await cagir<{ bulundu: boolean; urun?: SecilenUrun }>('urun.barkodOku', { barkod: deger });
      if (sonuc.bulundu && sonuc.urun) sec(sonuc.urun);
      else bildir.uyari('Ürün bulunamadı', 'Barkod kayıtlı değil; isimle aramayı deneyin.');
    } catch (hata) {
      hatayiBildir(hata, 'Barkod');
    }
  };

  return (
    <div className="relative">
      <input
        ref={alan}
        type="text"
        className="alan"
        placeholder={placeholder}
        value={metin}
        data-odak={otomatikOdak ? true : undefined}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setMetin(e.target.value)}
        onKeyDown={(e) => {
          if (oneriler.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              e.stopPropagation();
              setIndeks((i) => Math.min(i + 1, oneriler.length - 1));
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              e.stopPropagation();
              setIndeks((i) => Math.max(i - 1, 0));
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setOneriler([]);
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              const secilen = oneriler[indeks];
              if (secilen) sec(secilen);
              return;
            }
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            void barkodlaBul();
          }
        }}
      />

      {oneriler.length > 0 && (
        <ul
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-cizgi-kuvvetli bg-yuzey shadow-xl"
          role="listbox"
          aria-label="Ürün önerileri"
        >
          {oneriler.map((u, i) => (
            <li key={u.id} role="option" aria-selected={i === indeks}>
              <button
                type="button"
                className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                  i === indeks ? 'bg-vurgu-yumusak' : 'hover:bg-yuzey-2'
                }`}
                onMouseEnter={() => setIndeks(i)}
                onClick={() => sec(u)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{u.ad}</span>
                  <span className="block truncate text-xs text-metin-4">
                    {u.barkodlar[0] ?? 'barkodsuz'} · stok {miktarFormat(u.stok, u.birim_tipi)}
                  </span>
                </span>
                <span className="whitespace-nowrap font-mono text-sm text-metin-3">
                  alış {paraFormat(u.alis_fiyati, { simge: false })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
