/**
 * Fiş kağıdı — kasanın yazdırdığı fişin AYNISI (§10.7).
 *
 * Fiş, kasanın görsel fişi basarken kullandığı kodla (`@market/shared` →
 * `satisBelgesi` + `belgeHtml`) üretilir; panelde ayrı bir fiş tasarımı
 * yoktur. Geçmiş fişe bakan kişi müşterinin elindeki kağıdı görür. Kasadaki
 * "tekrar yazdır" ile aynı olsun diye KOPYA damgalıdır.
 *
 * Kağıtta OLMAYAN bilgiler (iptal edildi mi, hangi fişin iadesi, bu fişten ne
 * kadar iade edildi) `FisDurumNotlari` ve `IadeDokumu` ile fişin üstünde ve
 * altında gösterilir.
 */

'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  belgeHtml,
  miktarFormat,
  paraFormat,
  satisBelgesi,
  VARSAYILAN_YASAL_UYARI,
  type FisIsletmeBilgisi,
  type FisSatisVerisi,
  type Kurus,
} from '@market/shared';
import { Rozet } from './kabuk';

/** API'nin fiş detayı (`GET /satislar/:id`) — fiş çizimi ve durum notları için gereken kısım. */
export interface FisKagidiVerisi {
  satis: {
    fis_no: string;
    tarih: string;
    genel_toplam: Kurus;
    ara_toplam?: Kurus;
    iskonto_toplam?: Kurus;
    iptal_mi?: number | boolean;
    iptal_neden?: string | null;
    iade_mi?: number | boolean;
    kaynak_fis_no?: string | null;
    notlar?: string | null;
    musteri_adi?: string | null;
    kullanici_adi?: string | null;
  } | null;
  kalemler: {
    urun_adi: string;
    miktar: number;
    birim_tipi?: string | null;
    birim_fiyat: Kurus;
    iskonto?: Kurus;
    kdv_orani?: number;
    kdv_tutar?: Kurus;
    satir_toplam: Kurus;
    iade_edilen?: number;
  }[];
  odemeler: {
    odeme_tipi: string;
    tutar: Kurus;
    alinan?: Kurus | null;
    para_ustu?: Kurus | null;
    pos_kart?: string | null;
    pos_onay_kodu?: string | null;
  }[];
  iadeler?: { fis_no: string; genel_toplam: Kurus }[];
  /** İşletme bilgisi ve yasal uyarı (merkezî ayarlar). Eski API sürümü göndermeyebilir. */
  fis?: { isletme: FisIsletmeBilgisi; yasalUyari: string };
}

/** 80 mm kağıdın nokta genişliği — kasa da bu genişlikte çizer. */
const KAGIT_NOKTA = 576;
/** Ekranda fişin genişliği (px). */
const EKRAN_ENI = 380;

function fisVerisi(veri: FisKagidiVerisi): FisSatisVerisi | null {
  const s = veri.satis;
  if (!s) return null;
  return {
    satis: {
      fis_no: s.fis_no,
      tarih: s.tarih,
      musteri_adi: s.musteri_adi ?? null,
      iade_mi: Boolean(Number(s.iade_mi ?? 0)),
      kaynak_fis_no: s.kaynak_fis_no ?? null,
      notlar: s.notlar ?? null,
      ara_toplam: Number(s.ara_toplam ?? s.genel_toplam),
      iskonto_toplam: Number(s.iskonto_toplam ?? 0),
      genel_toplam: Number(s.genel_toplam),
    },
    kalemler: veri.kalemler.map((k) => ({
      urun_adi: k.urun_adi,
      miktar: Number(k.miktar),
      birim_tipi: k.birim_tipi ?? 'ADET',
      birim_fiyat: Number(k.birim_fiyat),
      iskonto: Number(k.iskonto ?? 0),
      kdv_orani: Number(k.kdv_orani ?? 0),
      kdv_tutar: Number(k.kdv_tutar ?? 0),
      satir_toplam: Number(k.satir_toplam),
    })),
    odemeler: veri.odemeler.map((o) => ({
      odeme_tipi: o.odeme_tipi,
      tutar: Number(o.tutar),
      alinan: Number(o.alinan ?? o.tutar),
      para_ustu: Number(o.para_ustu ?? 0),
      pos_kart: o.pos_kart ?? null,
      pos_onay_kodu: o.pos_onay_kodu ?? null,
    })),
  };
}

export function FisKagidi({ veri }: { veri: FisKagidiVerisi }) {
  const html = useMemo(() => {
    const satis = fisVerisi(veri);
    if (!satis) return null;
    return belgeHtml(
      satisBelgesi(satis, veri.fis?.isletme ?? { ad: 'Market' }, {
        kopyaMi: true,
        kasiyerAdi: veri.satis?.kullanici_adi && veri.satis.kullanici_adi !== '—' ? veri.satis.kullanici_adi : null,
        yasalUyari: veri.fis?.yasalUyari ?? VARSAYILAN_YASAL_UYARI,
      }),
      KAGIT_NOKTA,
    );
  }, [veri]);

  const cerceve = useRef<HTMLIFrameElement>(null);
  const [yukseklik, setYukseklik] = useState(600);
  const olcek = EKRAN_ENI / KAGIT_NOKTA;

  const olc = () => {
    const govde = cerceve.current?.contentDocument?.body;
    if (govde) setYukseklik(govde.scrollHeight);
  };
  // srcDoc değişince yeniden ölçülür (onLoad bazı tarayıcılarda geç tetiklenir).
  useLayoutEffect(olc, [html]);

  if (!html) return null;
  return (
    <div className="flex justify-center overflow-auto rounded-lg bg-yuzey-2 p-4">
      <div className="shadow-md" style={{ width: KAGIT_NOKTA * olcek, height: yukseklik * olcek, background: '#fff' }}>
        <iframe
          ref={cerceve}
          title="Fiş"
          sandbox="allow-same-origin"
          srcDoc={html}
          onLoad={olc}
          scrolling="no"
          style={{
            width: KAGIT_NOKTA,
            height: yukseklik,
            border: 0,
            transform: `scale(${olcek})`,
            transformOrigin: 'top left',
            display: 'block',
          }}
        />
      </div>
    </div>
  );
}

/** Kağıtta yazmayan durumlar: iptal, iade fişi, bu fişten yapılan iadeler. */
export function FisDurumNotlari({ veri }: { veri: FisKagidiVerisi }) {
  const s = veri.satis;
  if (!s) return null;
  const iadeler = veri.iadeler ?? [];
  return (
    <>
      {Number(s.iptal_mi ?? 0) === 1 && (
        <p className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm">
          <Rozet tur="tehlike">İptal edildi</Rozet>
          {s.iptal_neden && <span className="ml-2">Neden: {s.iptal_neden}</span>}
        </p>
      )}
      {Number(s.iade_mi ?? 0) === 1 && (
        <p className="rounded-lg border border-uyari-cizgi bg-uyari-yumusak px-3 py-2 text-sm">
          <strong>İade fişi</strong> — iade edilen fiş: {s.kaynak_fis_no ?? '—'}
        </p>
      )}
      {iadeler.length > 0 && (
        <p className="rounded-lg border border-uyari-cizgi bg-uyari-yumusak px-3 py-2 text-sm">
          <strong>Bu satıştan iade yapıldı:</strong>{' '}
          {iadeler.map((i) => `${i.fis_no} (${paraFormat(Math.abs(Number(i.genel_toplam)), { simge: false })})`).join(', ')}
        </p>
      )}
    </>
  );
}

/**
 * Satır bazında iade: orijinal fiş DEĞİŞMEZ; fişin altında hangi üründen ne
 * kadar iade edildiği, kalanı ve iadeler düşülmüş net tutar (kasayla aynı).
 */
export function IadeDokumu({ veri }: { veri: FisKagidiVerisi }) {
  const s = veri.satis;
  if (!s || Number(s.iade_mi ?? 0) === 1) return null;
  const satirlar = veri.kalemler.filter((k) => Number(k.iade_edilen ?? 0) !== 0);
  if (satirlar.length === 0) return null;
  const iadeToplami = (veri.iadeler ?? []).reduce((t, i) => t + Number(i.genel_toplam), 0);
  const birim = (k: (typeof satirlar)[number]) => (k.birim_tipi ?? 'ADET') as never;

  return (
    <div className="rounded-lg border border-uyari-cizgi px-4 py-3 text-sm">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-metin-4">İade edilenler</div>
      <table className="w-full">
        <thead className="text-left text-xs text-metin-3">
          <tr>
            <th className="py-1 font-medium">Ürün</th>
            <th className="py-1 text-right font-medium">Satılan</th>
            <th className="py-1 text-right font-medium">İade</th>
            <th className="py-1 text-right font-medium">Kalan</th>
          </tr>
        </thead>
        <tbody>
          {satirlar.map((k, i) => (
            <tr key={i} className="border-t border-cizgi">
              <td className="py-1">{k.urun_adi}</td>
              <td className="py-1 text-right font-mono">{miktarFormat(Number(k.miktar), birim(k))}</td>
              <td className="py-1 text-right font-mono text-uyari">{miktarFormat(-Number(k.iade_edilen ?? 0), birim(k))}</td>
              <td className="py-1 text-right font-mono font-medium">
                {miktarFormat(Number(k.miktar) + Number(k.iade_edilen ?? 0), birim(k))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex justify-between border-t border-cizgi pt-2">
        <span className="text-metin-2">Fiş toplamı</span>
        <span className="font-mono">{paraFormat(Number(s.genel_toplam), { simge: false })}</span>
      </div>
      <div className="flex justify-between text-uyari">
        <span>İadeler</span>
        <span className="font-mono">-{paraFormat(Math.abs(iadeToplami), { simge: false })}</span>
      </div>
      <div className="flex justify-between font-semibold">
        <span>Net tutar</span>
        <span className="font-mono">{paraFormat(Number(s.genel_toplam) + iadeToplami)}</span>
      </div>
    </div>
  );
}
