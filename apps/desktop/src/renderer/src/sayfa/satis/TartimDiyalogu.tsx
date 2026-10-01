/**
 * Tartılı (KG/LT) ürün için miktar girişi.
 *
 * Kasaya bağlı terazi açıksa (Ayarlar → Donanım → Terazi) kg ürünlerde ağırlık
 * teraziden CANLI okunur: kefe durunca Enter ile sepete eklenir; sallanırken
 * eklenmez. Terazi kapalıysa ya da kasiyer yazmaya başlarsa elle giriş geçerlidir:
 *  1. Miktar girmek (0,5 = yarım kilo) — hızlı düğmelerle tek dokunuş.
 *  2. Tutar girmek (müşteri "10 liralık ver" dediğinde) — miktar hesaplanır.
 */

import { useEffect, useRef, useState } from 'react';
import { miktarFormat, miktarParse, paraFormat, paraParse, type Miktar, type TeraziOkumasi } from '@market/shared';
import { Diyalog, Kisayol, Rozet } from '../../bilesen/temel';
import type { EklenecekUrun } from '../../durum/sepet';
import { cagir } from '../../kopru';

/** Teraziyi okuma aralığı (ms) — okuma kendisi de kararlı değeri bekleyebilir. */
const OKUMA_ARALIGI_MS = 300;

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
  const [kaynak, setKaynak] = useState<'terazi' | 'miktar' | 'tutar'>('miktar');
  const [teraziAktif, setTeraziAktif] = useState(false);
  const [okuma, setOkuma] = useState<TeraziOkumasi | null>(null);
  const miktarAlani = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (urun) {
      setMiktarMetni('');
      setTutarMetni('');
      setKaynak('miktar');
      setOkuma(null);
      setTeraziAktif(false);
      setTimeout(() => miktarAlani.current?.focus(), 20);
    }
  }, [urun]);

  // Terazi açıksa (yalnız kg ürün) pencere açık kaldıkça sırayla okunur.
  useEffect(() => {
    if (!urun || urun.birimTipi !== 'KG') return;
    let calisiyor = true;
    void (async () => {
      try {
        const durum = await cagir<{ aktif: boolean }>('terazi.durum');
        if (!durum.aktif || !calisiyor) return;
        setTeraziAktif(true);
        setKaynak((k) => (k === 'miktar' ? 'terazi' : k));
        while (calisiyor) {
          try {
            const o = await cagir<TeraziOkumasi>('terazi.oku');
            if (calisiyor) setOkuma(o);
          } catch (hata) {
            if (calisiyor) setOkuma({ basarili: false, hata: hata instanceof Error ? hata.message : String(hata) });
          }
          await new Promise((coz) => setTimeout(coz, OKUMA_ARALIGI_MS));
        }
      } catch {
        /* terazi yoksa elle giriş */
      }
    })();
    return () => {
      calisiyor = false;
    };
  }, [urun]);

  if (!urun) return null;

  const birimEtiketi = urun.birimTipi === 'LT' ? 'litre' : 'kg';
  const tutarKurus = paraParse(tutarMetni) ?? 0;
  // Teraziden yalnız kararlı (kefe durmuş) ağırlık alınır.
  const teraziMiktari: Miktar = okuma?.basarili && okuma.kararli ? (okuma.gram ?? 0) : 0;
  const miktar: Miktar =
    kaynak === 'terazi'
      ? teraziMiktari
      : kaynak === 'miktar'
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
        {teraziAktif && (
          <button
            type="button"
            onClick={() => {
              setKaynak('terazi');
              setMiktarMetni('');
              setTutarMetni('');
              miktarAlani.current?.focus();
            }}
            className={`w-full rounded-lg border p-3 text-left ${
              kaynak === 'terazi' ? 'border-vurgu bg-vurgu-yumusak' : 'border-cizgi hover:bg-yuzey-2'
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="etiket mb-0">Teraziden</span>
              {!okuma ? (
                <Rozet tur="notr">Okunuyor…</Rozet>
              ) : okuma.basarili ? (
                okuma.kararli ? (
                  <Rozet tur="basari">Kararlı</Rozet>
                ) : (
                  <Rozet tur="uyari">Sallanıyor…</Rozet>
                )
              ) : (
                <Rozet tur={okuma.gram === 0 ? 'notr' : 'tehlike'}>{okuma.hata ?? 'Okunamadı'}</Rozet>
              )}
            </span>
            <span className="block font-mono text-3xl font-bold">
              {okuma?.gram !== undefined ? `${(okuma.gram / 1000).toFixed(3).replace('.', ',')} kg` : '—'}
            </span>
            {kaynak !== 'terazi' && (
              <span className="block text-xs text-metin-3">Elle giriş kullanılıyor — teraziye dönmek için tıklayın.</span>
            )}
          </button>
        )}

        <div>
          <span className="etiket">{teraziAktif ? `ya da elle miktar (${birimEtiketi})` : `Miktar (${birimEtiketi})`}</span>
          <input
            ref={miktarAlani}
            type="text"
            inputMode="decimal"
            className="alan sayi py-3 text-xl"
            placeholder={teraziAktif ? 'Teraziden okunuyor — elle yazmak için yazın' : 'örn. 0,5 = 500 g'}
            value={
              kaynak === 'miktar' ? miktarMetni : kaynak === 'tutar' && miktar > 0 ? miktarFormat(miktar, undefined, false) : ''
            }
            onChange={(e) => {
              // Alan boşaltılınca terazi açıksa tekrar teraziye dönülür.
              setKaynak(e.target.value === '' && teraziAktif ? 'terazi' : 'miktar');
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
          <p className="text-sm text-metin-3">
            {miktar > 0
              ? `${miktarFormat(miktar, urun.birimTipi)}`
              : kaynak === 'terazi'
                ? 'Ürünü teraziye koyun; kefe durunca Enter'
                : 'Miktar girilmedi'}
          </p>
          <p className="font-mono text-2xl font-bold text-vurgu">{paraFormat(satirTutari)}</p>
        </div>
      </div>
    </Diyalog>
  );
}
