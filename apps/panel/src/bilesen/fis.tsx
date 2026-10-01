/**
 * Satış fişinin içeriği — panelde birden çok yerden açılır (§10.7, §10.11).
 *
 * ORTAK bileşendir: Cari ekstresinde borcun arkasındaki fiş, Vardiya
 * Dökümünde nakit hareketinin arkasındaki fiş — ikisi de aynı şeyi gösterir.
 * Modal SARMALAYICISI burada YOKTUR: çağıran kendi bağlamına göre karar verir
 * (Cari ayrı pencere açar, Vardiya Dökümü aynı pencerede içerik değiştirir),
 * ama tablo tek yerde durur ki iki ekran ayrışmasın.
 */

'use client';

import Link from 'next/link';
import { IADE_YONTEMI_ETIKETI, miktarFormat, paraFormat, tarihSaatFormat, type IadeYontemi, type Kurus } from '@market/shared';
import { BosDurum, HataKutusu, Rozet, Yukleniyor } from './kabuk';
import { uclar } from '@/lib/api';
import { useVeri } from '@/lib/kanca';

export interface FisVerisi {
  satis: {
    fis_no: string;
    tarih: string;
    genel_toplam: Kurus;
    iptal_mi?: number;
    iade_mi?: number;
    kaynak_fis_no?: string | null;
    musteri_adi?: string | null;
  } | null;
  kalemler: { urun_adi: string; miktar: number; birim_fiyat: Kurus; satir_toplam: Kurus; iade_edilen?: number }[];
  odemeler: { odeme_tipi: string; tutar: Kurus }[];
  iadeler?: { fis_no: string; genel_toplam: Kurus }[];
}

const ODEME_ETIKETI: Record<string, string> = {
  NAKIT: 'Nakit',
  KART: 'Kart',
  VERESIYE: 'Veresiye',
};

/** Fişin başlığı — çağıran pencere başlığında kullanabilsin diye ayrı. */
export function fisBasligi(veri: FisVerisi | null): string {
  return veri?.satis ? `Fiş ${veri.satis.fis_no}` : 'Fiş';
}

export function useFis(satisId: string | null) {
  return useVeri<FisVerisi>(satisId ? `${uclar.satislar}/${satisId}` : null);
}

export function FisIcerigi({ satisId }: { satisId: string }) {
  const { veri, yukleniyor, hata } = useFis(satisId);

  if (yukleniyor) return <Yukleniyor />;
  if (hata) return <HataKutusu mesaj={hata} />;
  if (!veri?.satis) {
    return (
      <BosDurum
        baslik="Fiş bulunamadı"
        aciklama="Bu hareket bir satıştan doğmamış ya da fiş henüz merkeze senkronlanmamış olabilir."
      />
    );
  }

  // Orijinal fiş değişmez; iade edilen miktar ve kalan satırın yanında gösterilir (kasayla aynı).
  const iadeVar = veri.satis.iade_mi !== 1 && veri.kalemler.some((k) => Number(k.iade_edilen ?? 0) !== 0);
  const iadeToplami = (veri.iadeler ?? []).reduce((t, i) => t + Number(i.genel_toplam), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm text-metin-3">
          {tarihSaatFormat(veri.satis.tarih)} · Müşteri: {veri.satis.musteri_adi ?? 'Perakende'}
        </p>
        {veri.satis.iptal_mi === 1 && <Rozet tur="tehlike">İptal edilmiş</Rozet>}
        {veri.satis.iade_mi === 1 && <Rozet tur="uyari">İade fişi</Rozet>}
      </div>
      {veri.satis.iade_mi === 1 && (
        <p className="text-sm text-metin-2">
          İade edilen fiş: <strong>{veri.satis.kaynak_fis_no ?? '—'}</strong>
        </p>
      )}

      <div className="tablo-sarmal">
        <table className="tablo">
          <thead>
            <tr>
              <th className="text-left">Ürün</th>
              <th>{iadeVar ? 'Satılan' : 'Miktar'}</th>
              {iadeVar && (
                <>
                  <th>İade</th>
                  <th>Kalan</th>
                </>
              )}
              <th>Birim</th>
              <th>Tutar</th>
            </tr>
          </thead>
          <tbody>
            {veri.kalemler.map((k, i) => (
              <tr key={i}>
                <td className="text-left">{k.urun_adi}</td>
                <td className="sayi">{miktarFormat(k.miktar)}</td>
                {iadeVar && (
                  <>
                    <td className="sayi text-uyari">{Number(k.iade_edilen) ? miktarFormat(-Number(k.iade_edilen)) : '—'}</td>
                    <td className="sayi font-medium">{miktarFormat(k.miktar + Number(k.iade_edilen ?? 0))}</td>
                  </>
                )}
                <td className="sayi text-metin-3">{paraFormat(k.birim_fiyat, { simge: false })}</td>
                <td className="sayi font-semibold">{paraFormat(k.satir_toplam, { simge: false })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-baseline justify-between rounded-lg bg-yuzey-2 px-4 py-3">
        <span className="text-metin-2">Genel toplam</span>
        <span className="font-mono text-xl font-bold text-vurgu">{paraFormat(veri.satis.genel_toplam)}</span>
      </div>
      {iadeToplami !== 0 && (
        <div className="space-y-1 rounded-lg border border-uyari-cizgi px-4 py-2 text-sm">
          <div className="flex justify-between text-uyari">
            <span>İadeler ({(veri.iadeler ?? []).map((i) => i.fis_no).join(', ')})</span>
            <span className="font-mono">-{paraFormat(Math.abs(iadeToplami), { simge: false })}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Net tutar</span>
            <span className="font-mono">{paraFormat(veri.satis.genel_toplam + iadeToplami)}</span>
          </div>
        </div>
      )}

      {/*
        Ödeme dökümü kasadaki fişle AYNI bilgiyi verir: 1.150 TL'lik satışın
        500'ü nakit 650'si veresiye ise iki ekran da bunu aynı şekilde söyler.
      */}
      {veri.odemeler?.length > 0 && (
        <div className="rounded-lg border border-cizgi px-4 py-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-metin-4">Ödeme</div>
          <div className="space-y-1">
            {veri.odemeler.map((o, i) => (
              <div key={i} className="flex items-baseline justify-between text-sm">
                <span className="text-metin-2">
                  {veri.satis?.iade_mi === 1
                    ? (IADE_YONTEMI_ETIKETI[o.odeme_tipi as IadeYontemi] ?? o.odeme_tipi)
                    : (ODEME_ETIKETI[o.odeme_tipi] ?? o.odeme_tipi)}
                </span>
                <span className={`font-mono font-semibold ${o.odeme_tipi === 'VERESIYE' ? 'text-uyari' : ''}`}>
                  {paraFormat(o.tutar, { simge: false })}
                </span>
              </div>
            ))}
          </div>
          {veri.odemeler.some((o) => o.odeme_tipi === 'VERESIYE') && (
            <p className="mt-2 border-t border-cizgi pt-2 text-xs text-metin-3">
              {paraFormat(Math.abs(veri.odemeler.find((o) => o.odeme_tipi === 'VERESIYE')?.tutar ?? 0))}{' '}
              <strong>{veri.satis.musteri_adi ?? 'müşteri'}</strong>{' '}
              {veri.satis.iade_mi === 1 ? 'hesabına alacak yazıldı (borcundan düşüldü).' : 'hesabına borç yazıldı.'}
            </p>
          )}
        </div>
      )}

      {/*
        Bu içerik SALT OKUNURDUR. İade tek yerden, Satışlar sayfasından
        başlatılır; aynı satışa birden çok ekrandan işlem yapılabilmesi
        karışıklık üretir.
      */}
      {veri.satis.iptal_mi !== 1 && (
        <Link href={`/satislar?fis=${encodeURIComponent(satisId)}`} className="inline-block text-sm text-vurgu hover:underline">
          İade işlemleri için Satışlar&apos;da aç →
        </Link>
      )}
    </div>
  );
}
