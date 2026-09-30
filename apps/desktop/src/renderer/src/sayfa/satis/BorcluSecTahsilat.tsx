/**
 * Satış ekranından veresiye tahsilatı (F2) — §10.7.
 *
 * ADI NEDEN BU: bu dosya bir tahsilat diyaloğu DEĞİL, borçlu müşteriyi seçtiren
 * bir ön adımdır; tahsilatın kendisini ortak `bilesen/TahsilatDiyalogu`ya
 * devreder. İkisi de `TahsilatDiyalogu` adını taşıdığı sürece "tahsilat
 * ekranını düzelt" diyen biri yanlış dosyayı açıyordu.
 *
 * Kasiyerin en sık yaptığı işlerden biri, borcunu ödemeye gelen müşteriyi
 * karşılamaktır; bunun için satışı bırakıp Cari Hesap ekranına gitmesi
 * gerekiyordu. Buradaki akış iki adım: borcu olan müşteriyi seç, tutarı gir.
 *
 * İş kuralı burada TEKRARLANMAZ: borç düşürme, kasa hareketi ve yetki kontrolü
 * `cari.tahsilat` servisindedir. Bu dosya yalnız o servise giden yolu kısaltır.
 */

import { useEffect, useRef, useState } from 'react';
import { paraFormat, type Kurus } from '@market/shared';
import { Diyalog, Kisayol, Yukleniyor } from '../../bilesen/temel';
import { TahsilatDiyalogu } from '../../bilesen/TahsilatDiyalogu';
import { hatayiBildir } from '../../durum/bildirim';
import { cagir } from '../../kopru';

interface BorcluSatiri {
  id: string;
  ad_unvan: string;
  telefon: string | null;
  bakiye: Kurus;
}

export function BorcluSecTahsilat({ acik, onKapat }: { acik: boolean; onKapat: () => void }) {
  const [terim, setTerim] = useState('');
  const [borclular, setBorclular] = useState<BorcluSatiri[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [secili, setSecili] = useState(0);
  const [odenecek, setOdenecek] = useState<BorcluSatiri | null>(null);
  const alan = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (acik) {
      setTerim('');
      setSecili(0);
      setOdenecek(null);
      setTimeout(() => alan.current?.focus(), 20);
    }
  }, [acik]);

  useEffect(() => {
    if (!acik || odenecek) return;
    let iptal = false;
    setYukleniyor(true);
    const zamanlayici = setTimeout(async () => {
      try {
        // `sadeceBakiyeli` tam da bu ekranın istediği süzgeç: tahsilat yapılacak
        // kişi tanımı gereği borcu olandır, borçsuzları listelemek gürültüdür.
        const veri = await cagir<{ kayitlar: BorcluSatiri[] }>('cari.listele', {
          filtre: { tip: 'MUSTERI', arama: terim.trim() || undefined, sadeceBakiyeli: true },
          limit: 40,
        });
        if (!iptal) {
          setBorclular(veri.kayitlar.filter((c) => c.bakiye > 0).sort((a, b) => b.bakiye - a.bakiye));
          setSecili(0);
        }
      } catch (hata) {
        if (!iptal) hatayiBildir(hata, 'Borçlu müşteriler');
      } finally {
        if (!iptal) setYukleniyor(false);
      }
    }, 160);
    return () => {
      iptal = true;
      clearTimeout(zamanlayici);
    };
  }, [acik, terim, odenecek]);

  if (!acik) return null;

  // --- 2. adım: tutar girişi (ortak bileşen; Cari ekranı da aynısını kullanır) ---
  if (odenecek) {
    return (
      <TahsilatDiyalogu
        acik
        cari={{ id: odenecek.id, ad_unvan: odenecek.ad_unvan, tip: 'MUSTERI', bakiye: odenecek.bakiye }}
        onKapat={() => setOdenecek(null)}
        onTamam={onKapat}
      />
    );
  }

  // --- 1. adım: borçlu seçimi ---
  return (
    <Diyalog
      acik
      baslik="Tahsilat"
      aciklama="Borcunu ödeyen müşteriyi seçin."
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç <Kisayol>ESC</Kisayol>
          </button>
          <button
            type="button"
            className="tus-birincil"
            onClick={() => borclular[secili] && setOdenecek(borclular[secili])}
            disabled={borclular.length === 0}
          >
            Devam <Kisayol>Enter</Kisayol>
          </button>
        </>
      }
    >
      <input
        ref={alan}
        className="alan py-3 text-lg"
        placeholder="Müşteri adı ya da telefon…"
        value={terim}
        onChange={(e) => setTerim(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSecili((s) => Math.min(s + 1, borclular.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSecili((s) => Math.max(s - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (borclular[secili]) setOdenecek(borclular[secili]);
          }
        }}
      />

      <div className="mt-3 max-h-80 overflow-y-auto">
        {yukleniyor && borclular.length === 0 ? (
          <Yukleniyor />
        ) : borclular.length === 0 ? (
          <p className="py-8 text-center text-sm text-metin-4">
            {terim ? 'Bu aramaya uyan borçlu müşteri yok.' : 'Borcu olan müşteri yok.'}
          </p>
        ) : (
          <table className="tablo">
            <thead>
              <tr>
                <th>Müşteri</th>
                <th className="text-right">Borç</th>
              </tr>
            </thead>
            <tbody>
              {borclular.map((c, i) => (
                <tr
                  key={c.id}
                  className={`cursor-pointer ${i === secili ? 'bg-vurgu-yumusak' : ''}`}
                  onMouseEnter={() => setSecili(i)}
                  onClick={() => setOdenecek(c)}
                >
                  <td>
                    <div className="font-medium">{c.ad_unvan}</div>
                    {c.telefon && <div className="text-xs text-metin-4">{c.telefon}</div>}
                  </td>
                  <td className="sayi font-semibold text-uyari text-right">{paraFormat(c.bakiye, { simge: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Diyalog>
  );
}
