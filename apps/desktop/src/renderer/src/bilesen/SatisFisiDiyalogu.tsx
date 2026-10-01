/** Satış fişi görüntüleyici — Cari ve Kasa ekranları ortak kullanır. */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IADE_YONTEMI_ETIKETI, miktarFormat, paraFormat, tarihSaatFormat, type IadeYontemi, type Kurus } from '@market/shared';
import { BosDurum, Diyalog, Rozet, Yukleniyor } from './temel';
import { hatayiBildir } from '../durum/bildirim';
import { useYetki } from '../durum/oturum';
import { cagir } from '../kopru';

/**
 * Bir satışın fişi — kalemleriyle birlikte (§10.7).
 *
 * "Ne aldı?" sorusunun cevabı, tutarın kendisi kadar önemlidir: müşteri itiraz
 * ettiğinde kasiyerin Raporlar ekranına gidip fiş numarasıyla arama yapması
 * gerekiyordu. Veri zaten kayıtlı, burada yalnız gösteriliyor.
 *
 * ORTAK bileşendir: Cari ekstresinde borcun arkasındaki fiş, Kasa ekranında
 * nakit hareketinin arkasındaki fiş — ikisi de aynı şeyi gösterir, aynı
 * görünsün diye tek yerde durur.
 */
export function SatisFisiDiyalogu({ satisId, onKapat }: { satisId: string | null; onKapat: () => void }) {
  const [detay, setDetay] = useState<{
    satis: {
      fis_no: string;
      tarih: string;
      genel_toplam: Kurus;
      iptal_mi?: boolean;
      iade_mi?: boolean;
      kaynak_fis_no?: string | null;
      notlar?: string | null;
      musteri_adi?: string | null;
    };
    kalemler: {
      urun_adi: string;
      miktar: number;
      birim_tipi?: string;
      birim_fiyat: Kurus;
      satir_toplam: Kurus;
      /** Bu satıştan iade edilen miktar (eksi). */
      iade_edilen?: number;
    }[];
    odemeler: { odeme_tipi: string; tutar: Kurus }[];
    iadeler?: { fis_no: string; genel_toplam: Kurus }[];
  } | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const gezin = useNavigate();
  const iadeYetkisi = useYetki('satis.iade');
  const iptalYetkisi = useYetki('satis.iptal');
  const islemYetkisi = iadeYetkisi || iptalYetkisi;

  useEffect(() => {
    if (!satisId) {
      setDetay(null);
      return;
    }
    setYukleniyor(true);
    cagir<typeof detay>('satis.detay', { satisId })
      .then(setDetay)
      .catch((hata) => hatayiBildir(hata, 'Fiş detayı'))
      .finally(() => setYukleniyor(false));
  }, [satisId]);

  if (!satisId) return null;
  // Orijinal fiş değişmez; iade edilen miktar ve kalan satırın yanında gösterilir.
  const iadeVar = Boolean(detay && !detay.satis.iade_mi && detay.kalemler.some((k) => (k.iade_edilen ?? 0) !== 0));
  const iadeToplami = (detay?.iadeler ?? []).reduce((t, i) => t + i.genel_toplam, 0);

  return (
    <Diyalog
      acik
      baslik={detay ? `Fiş ${detay.satis.fis_no}` : 'Fiş'}
      aciklama={detay ? `${tarihSaatFormat(detay.satis.tarih)} · Müşteri: ${detay.satis.musteri_adi ?? 'Perakende'}` : undefined}
      onKapat={onKapat}
      altBilgi={
        <>
          {/*
            Bu pencere SALT OKUNURDUR. İptal ve iade tek yerden, Raporlar →
            Satışlar'dan yapılır; aynı satışa birden çok ekrandan işlem
            yapılabilmesi karışıklık üretir.
          */}
          {islemYetkisi && detay && !detay.satis.iptal_mi && !detay.satis.iade_mi && (
            <button type="button" className="tus-ikincil mr-auto" onClick={() => gezin('/raporlar', { state: { satisId } })}>
              İade / İptal İşlemleri →
            </button>
          )}
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Kapat
          </button>
        </>
      }
    >
      {yukleniyor ? (
        <Yukleniyor />
      ) : !detay ? (
        <BosDurum baslik="Fiş bulunamadı" aciklama="Satış kaydı silinmiş ya da henüz senkronlanmamış olabilir." />
      ) : (
        <>
          {detay.satis.iptal_mi && <Rozet tur="tehlike">Bu satış iptal edilmiş</Rozet>}
          {detay.satis.iade_mi && (
            <p className="rounded border border-uyari-cizgi bg-uyari-yumusak px-3 py-2 text-sm">
              <strong>İade fişi</strong> — iade edilen fiş: {detay.satis.kaynak_fis_no ?? '—'}
              {detay.satis.notlar && detay.satis.notlar !== 'Belirtilmedi' ? ` · Neden: ${detay.satis.notlar}` : ''}
            </p>
          )}
          <table className="tablo mt-2">
            <thead>
              <tr>
                <th>Ürün</th>
                <th className="text-right">{iadeVar ? 'Satılan' : 'Miktar'}</th>
                {iadeVar && (
                  <>
                    <th className="text-right">İade</th>
                    <th className="text-right">Kalan</th>
                  </>
                )}
                <th className="text-right">Birim</th>
                <th className="text-right">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {detay.kalemler.map((k, i) => (
                <tr key={i}>
                  <td>{k.urun_adi}</td>
                  <td className="sayi text-right">{miktarFormat(k.miktar, k.birim_tipi as never)}</td>
                  {iadeVar && (
                    <>
                      <td className="sayi text-uyari text-right">
                        {k.iade_edilen ? miktarFormat(-k.iade_edilen, k.birim_tipi as never) : '—'}
                      </td>
                      <td className="sayi font-medium text-right">
                        {miktarFormat(k.miktar + (k.iade_edilen ?? 0), k.birim_tipi as never)}
                      </td>
                    </>
                  )}
                  <td className="sayi text-metin-3 text-right">{paraFormat(k.birim_fiyat, { simge: false })}</td>
                  <td className="sayi font-semibold text-right">{paraFormat(k.satir_toplam, { simge: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex items-baseline justify-between rounded bg-yuzey-3 px-4 py-3">
            <span className="text-metin-2">Genel toplam</span>
            <span className="font-mono text-xl font-bold text-vurgu">{paraFormat(detay.satis.genel_toplam)}</span>
          </div>
          {iadeToplami !== 0 && (
            <div className="mt-2 space-y-1 rounded border border-uyari-cizgi px-4 py-2 text-sm">
              <div className="flex justify-between text-uyari">
                <span>İadeler ({(detay.iadeler ?? []).map((i) => i.fis_no).join(', ')})</span>
                <span className="font-mono">-{paraFormat(Math.abs(iadeToplami), { simge: false })}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Net tutar</span>
                <span className="font-mono">{paraFormat(detay.satis.genel_toplam + iadeToplami)}</span>
              </div>
            </div>
          )}

          <OdemeDokumu
            odemeler={detay.odemeler}
            musteriAdi={detay.satis.musteri_adi ?? null}
            iadeMi={detay.satis.iade_mi ?? false}
          />
        </>
      )}
    </Diyalog>
  );
}

const ODEME_ETIKETI: Record<string, string> = {
  NAKIT: 'Nakit',
  KART: 'Kart',
  VERESIYE: 'Veresiye',
};

/**
 * Fişin ödeme dökümü (§10.7).
 *
 * Tutarın NASIL ödendiği, ne alındığı kadar önemlidir: 1.150 TL'lik alışverişin
 * 500'ü nakit 650'si veresiye ise, müşteri "ben ödedim" dediğinde fişin bunu
 * söylemesi gerekir. Tek ödemeli satışta da gösterilir — "nakit mi kart mı"
 * sorusunun cevabı fişte yazmalıdır.
 */
export function OdemeDokumu({
  odemeler,
  musteriAdi,
  iadeMi = false,
}: {
  odemeler: { odeme_tipi: string; tutar: Kurus }[];
  musteriAdi: string | null;
  /** İadede para müşteriye döner: etiketler ve açıklama tersine çevrilir. */
  iadeMi?: boolean;
}) {
  if (odemeler.length === 0) return null;
  const veresiye = odemeler.find((o) => o.odeme_tipi === 'VERESIYE');

  return (
    <div className="mt-3 rounded border border-cizgi px-4 py-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-metin-4">Ödeme</div>
      <div className="space-y-1">
        {odemeler.map((o, i) => (
          <div key={i} className="flex items-baseline justify-between text-sm">
            <span className="text-metin-2">
              {iadeMi
                ? (IADE_YONTEMI_ETIKETI[o.odeme_tipi as IadeYontemi] ?? o.odeme_tipi)
                : (ODEME_ETIKETI[o.odeme_tipi] ?? o.odeme_tipi)}
            </span>
            <span className={`font-mono font-semibold ${o.odeme_tipi === 'VERESIYE' ? 'text-uyari' : ''}`}>
              {paraFormat(Math.abs(o.tutar), { simge: false })}
            </span>
          </div>
        ))}
      </div>
      {veresiye && (
        <p className="mt-2 border-t border-cizgi pt-2 text-xs text-metin-3">
          {paraFormat(Math.abs(veresiye.tutar))} <strong>{musteriAdi ?? 'müşteri'}</strong>{' '}
          {iadeMi ? 'hesabına alacak yazıldı (borcundan düşüldü).' : 'hesabına borç yazıldı.'}
        </p>
      )}
    </div>
  );
}
