/**
 * Ürün kartı → "Paket seçenekleri": ürünün paket hâlinde de satılması
 * (12'li kibrit, 6'lı su). Stok TEK adet üzerinden kalır; paket satılınca
 * içindeki adet kadar düşer.
 *
 * Bu pencere yalnız listeyi düzenler; kayıt ürün kartının "Kaydet"iyle yapılır.
 */

import { useEffect, useState } from 'react';
import { paraFormat, PAKET_AZAMI_CARPAN, type Kurus } from '@market/shared';
import { Alan, Diyalog, ParaAlani } from './temel';

export interface PaketTaslagi {
  /** Kayıtlı paket; yeni satırda yok. */
  id?: string;
  ad: string;
  carpan: string;
  /** 0 = boş: çarpan × tek fiyat. */
  fiyat: Kurus;
  barkod: string;
}

/**
 * "12'li", "6'lı", "4'lü", "10'lu" — sayının okunuşunun son hecesine göre.
 * Kasiyer adı kendisi yazabilir; bu yalnız öneridir.
 */
export function paketAdiOner(carpan: number): string {
  const birler = ['', 'li', 'li', 'lü', 'lü', 'li', 'lı', 'li', 'li', 'lu'];
  const onlar = ['', 'lu', 'li', 'lu', 'lı', 'li', 'lı', 'li', 'li', 'lı'];
  let ek = 'li';
  if (carpan % 10 !== 0) ek = birler[carpan % 10] ?? 'li';
  else if (carpan % 100 !== 0) ek = onlar[(carpan % 100) / 10] ?? 'li';
  else if (carpan % 1000 !== 0) ek = 'lü';
  return `${carpan}'${ek} paket`;
}

/** Ürün kartı kaydedilmeden önce: satır geçerli mi? (null = geçerli) */
export function paketHatasi(p: PaketTaslagi): string | null {
  const carpan = Number(p.carpan);
  if (!Number.isInteger(carpan) || carpan < 2) return 'Paketin içinde en az 2 adet olmalı.';
  if (carpan > PAKET_AZAMI_CARPAN) return `Paketin içinde en fazla ${PAKET_AZAMI_CARPAN} adet olabilir.`;
  if (!p.ad.trim()) return 'Paket adı boş olamaz.';
  return null;
}

export function PaketSecenekleriDiyalogu({
  acik,
  urunAdi,
  tekFiyat,
  paketler,
  onUygula,
  onKapat,
}: {
  acik: boolean;
  urunAdi: string;
  tekFiyat: Kurus;
  paketler: PaketTaslagi[];
  onUygula: (liste: PaketTaslagi[]) => void;
  onKapat: () => void;
}) {
  const [liste, setListe] = useState<PaketTaslagi[]>(paketler);
  useEffect(() => {
    if (acik) setListe(paketler.length > 0 ? paketler : [{ ad: '', carpan: '', fiyat: 0, barkod: '' }]);
  }, [acik, paketler]);

  const guncelle = (i: number, yama: Partial<PaketTaslagi>) =>
    setListe((l) =>
      l.map((p, j) => {
        if (j !== i) return p;
        const yeni = { ...p, ...yama };
        // Adı kullanıcı yazmadıysa (ya da öneriyse) içindeki adede göre önerilir.
        if ('carpan' in yama && (!p.ad.trim() || p.ad === paketAdiOner(Number(p.carpan)))) {
          const n = Number(yama.carpan);
          yeni.ad = Number.isInteger(n) && n >= 2 ? paketAdiOner(n) : '';
        }
        return yeni;
      }),
    );

  const dolu = liste.filter((p) => p.carpan.trim() || p.ad.trim() || p.barkod.trim() || p.fiyat > 0);
  const hata = dolu.map(paketHatasi).find(Boolean) ?? null;

  return (
    <Diyalog
      acik={acik}
      baslik="Paket seçenekleri"
      aciklama={`${urunAdi} — paket olarak satılınca stoktan içindeki adet kadar düşer.`}
      genislik="genis"
      onKapat={onKapat}
      altBilgi={
        <>
          {hata && <span className="mr-auto text-sm text-tehlike">{hata}</span>}
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" disabled={hata !== null} onClick={() => onUygula(dolu)}>
            Tamam
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {liste.map((p, i) => {
          const carpan = Number(p.carpan);
          const otomatik = Number.isInteger(carpan) && carpan >= 2 ? carpan * tekFiyat : null;
          return (
            <div key={p.id ?? `yeni-${i}`} className="grid grid-cols-[6rem_1fr_9rem_1fr_auto] items-end gap-2">
              <Alan etiket="İçindeki adet">
                <input
                  className="alan sayi"
                  inputMode="numeric"
                  placeholder="12"
                  value={p.carpan}
                  data-odak={i === 0 ? true : undefined}
                  onChange={(e) => guncelle(i, { carpan: e.target.value.replace(/\D/g, '') })}
                />
              </Alan>
              <Alan etiket="Paket adı (fişte görünür)">
                <input
                  className="alan"
                  placeholder="12'li paket"
                  value={p.ad}
                  maxLength={40}
                  onChange={(e) => guncelle(i, { ad: e.target.value })}
                />
              </Alan>
              <Alan etiket="Paket fiyatı">
                <ParaAlani
                  deger={p.fiyat}
                  placeholder={otomatik !== null ? paraFormat(otomatik, { simge: false }) : '0,00'}
                  onDegisim={(v) => guncelle(i, { fiyat: v })}
                />
              </Alan>
              <Alan etiket="Paketin barkodu (varsa)">
                <input
                  className="alan font-mono"
                  placeholder="okutun ya da boş bırakın"
                  value={p.barkod}
                  onChange={(e) => guncelle(i, { barkod: e.target.value.trim() })}
                  onKeyDown={(e) => {
                    // Okuyucu Enter gönderir; pencere kapanmasın, alan dolsun.
                    if (e.key === 'Enter') e.preventDefault();
                  }}
                />
              </Alan>
              <button
                type="button"
                className="mb-2 px-2 text-tehlike"
                aria-label="Paketi kaldır"
                onClick={() => setListe((l) => l.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="tus-ikincil text-sm"
          onClick={() => setListe((l) => [...l, { ad: '', carpan: '', fiyat: 0, barkod: '' }])}
        >
          + Paket ekle
        </button>
        <ul className="list-inside list-disc text-xs text-metin-3">
          <li>Fiyatı boş bırakırsanız paket, içindeki adet × tek fiyattan satılır.</li>
          <li>Paketin üzerinde ayrı barkod varsa yazın: kasada okutulunca soru sorulmadan paket eklenir.</li>
          <li>Ürünün kendi barkodu okutulunca kasada “tekli mi, paket mi?” diye sorulur (Enter: tekli).</li>
        </ul>
      </div>
    </Diyalog>
  );
}
