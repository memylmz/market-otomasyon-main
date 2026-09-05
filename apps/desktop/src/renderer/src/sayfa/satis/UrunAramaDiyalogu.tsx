/** Ürün arama (F2) — barkodsuz satış ve isimden arama (§10.3). */

import { useEffect, useMemo, useRef, useState } from 'react';
import { adet, miktarFormat, miktarParse, paraFormat, type BirimTipi, type Kurus, type Miktar } from '@market/shared';
import { Diyalog, Kisayol, Yukleniyor } from '../../bilesen/temel';
import { hatayiBildir } from '../../durum/bildirim';
import type { EklenecekUrun } from '../../durum/sepet';
import { cagir } from '../../kopru';

interface UrunSatiri {
  id: string;
  ad: string;
  marka: string | null;
  birim_tipi: BirimTipi;
  satis_fiyati: Kurus;
  kdv_orani: number;
  stok: Miktar;
  aktif_mi: boolean;
  barkodlar: string[];
  kategori_adi: string | null;
}

export function UrunAramaDiyalogu({
  acik,
  onKapat,
  onSec,
  baslangicTerimi = '',
}: {
  acik: boolean;
  onKapat: () => void;
  onSec: (urun: EklenecekUrun, miktar?: Miktar) => void;
  /** Barkod kutusundan aktarılan terim; diyalog bununla açılır. */
  baslangicTerimi?: string;
}) {
  const [terim, setTerim] = useState('');
  const [sonuclar, setSonuclar] = useState<UrunSatiri[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [secili, setSecili] = useState(0);
  const [miktarMetni, setMiktarMetni] = useState('1');
  const aramaAlani = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (acik) {
      setTerim(baslangicTerimi);
      setSonuclar([]);
      setSecili(0);
      setMiktarMetni('1');
      setTimeout(() => {
        aramaAlani.current?.focus();
        // Aktarılan terim seçili gelsin: kullanıcı yazmaya devam ederse üzerine yazar.
        if (baslangicTerimi) aramaAlani.current?.select();
      }, 20);
    }
  }, [acik, baslangicTerimi]);

  // Yazarken arama — 180 ms geciktirme ile gereksiz sorgu önlenir.
  useEffect(() => {
    if (!acik) return;
    if (terim.trim().length < 2) {
      setSonuclar([]);
      return;
    }
    let iptal = false;
    setYukleniyor(true);
    const zamanlayici = setTimeout(async () => {
      try {
        const veri = await cagir<UrunSatiri[]>('urun.ara', { terim, limit: 40 });
        if (!iptal) {
          setSonuclar(veri);
          setSecili(0);
        }
      } catch (hata) {
        if (!iptal) hatayiBildir(hata, 'Arama');
      } finally {
        if (!iptal) setYukleniyor(false);
      }
    }, 180);
    return () => {
      iptal = true;
      clearTimeout(zamanlayici);
    };
  }, [terim, acik]);

  const seciliUrun = sonuclar[secili];
  const miktar = useMemo(() => miktarParse(miktarMetni) ?? adet(1), [miktarMetni]);

  const secimiOnayla = () => {
    if (!seciliUrun) return;
    if (!seciliUrun.aktif_mi) return;
    // KG/LT üründe miktar alanına dokunulmadıysa miktar GÖNDERİLMEZ:
    // satış ekranı tartım diyaloğunu açar (1 kg varsaymak tehlikelidir).
    const miktarDokunulmadi = miktarMetni.trim() === '1';
    onSec(
      {
        urunId: seciliUrun.id,
        ad: seciliUrun.ad,
        barkod: seciliUrun.barkodlar[0] ?? null,
        birimTipi: seciliUrun.birim_tipi,
        birimFiyat: seciliUrun.satis_fiyati,
        listeFiyati: seciliUrun.satis_fiyati,
        kdvOrani: seciliUrun.kdv_orani,
        kampanyaId: null,
        stok: seciliUrun.stok,
      },
      seciliUrun.birim_tipi !== 'ADET' && miktarDokunulmadi ? undefined : miktar > 0 ? miktar : adet(1),
    );
  };

  return (
    <Diyalog
      acik={acik}
      baslik="Ürün Ara"
      aciklama="İsim, marka veya barkodun bir kısmını yazın. Türkçe karakter farkı gözetilmez."
      genislik="genis"
      onKapat={onKapat}
      altBilgi={
        <>
          <span className="mr-auto text-xs text-metin-4">
            <Kisayol>↑↓</Kisayol> seç · <Kisayol>Enter</Kisayol> ekle · <Kisayol>ESC</Kisayol> kapat
          </span>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Kapat
          </button>
          <button type="button" className="tus-birincil" onClick={secimiOnayla} disabled={!seciliUrun || !seciliUrun.aktif_mi}>
            Sepete Ekle
          </button>
        </>
      }
    >
      <div className="flex gap-3">
        <input
          ref={aramaAlani}
          type="text"
          className="alan flex-1"
          placeholder="Ürün adı, marka veya barkod…"
          value={terim}
          onChange={(e) => setTerim(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSecili((s) => Math.min(s + 1, sonuclar.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSecili((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              secimiOnayla();
            }
          }}
        />
        <label className="w-28">
          <input
            type="text"
            className="alan sayi"
            value={miktarMetni}
            onChange={(e) => setMiktarMetni(e.target.value)}
            aria-label="Miktar"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                secimiOnayla();
              }
            }}
          />
        </label>
      </div>

      <div className="mt-3 max-h-96 overflow-y-auto">
        {yukleniyor && sonuclar.length === 0 ? (
          <Yukleniyor metin="Aranıyor…" />
        ) : sonuclar.length === 0 ? (
          <p className="py-8 text-center text-sm text-metin-4">
            {terim.trim().length < 2 ? 'En az 2 karakter yazın.' : 'Sonuç bulunamadı.'}
          </p>
        ) : (
          <table className="tablo">
            <thead>
              <tr>
                <th>Ürün</th>
                <th>Kategori</th>
                <th className="text-right">Stok</th>
                <th className="text-right">Fiyat</th>
              </tr>
            </thead>
            <tbody>
              {sonuclar.map((urun, i) => (
                <tr
                  key={urun.id}
                  onClick={() => setSecili(i)}
                  onDoubleClick={secimiOnayla}
                  className={`cursor-pointer ${i === secili ? 'bg-yuzey-4/70 outline outline-1 outline-vurgu' : ''} ${
                    urun.aktif_mi ? '' : 'opacity-50'
                  }`}
                >
                  <td>
                    <div className="font-medium">
                      {urun.ad}
                      {!urun.aktif_mi && <span className="ml-2 text-xs text-tehlike">(pasif)</span>}
                    </div>
                    <div className="text-xs text-metin-4">{[urun.marka, urun.barkodlar[0]].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="text-metin-3">{urun.kategori_adi ?? '—'}</td>
                  <td className={`sayi ${urun.stok <= 0 ? 'text-tehlike' : ''}`}>{miktarFormat(urun.stok, urun.birim_tipi)}</td>
                  <td className="sayi font-semibold">{paraFormat(urun.satis_fiyati, { simge: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Diyalog>
  );
}
