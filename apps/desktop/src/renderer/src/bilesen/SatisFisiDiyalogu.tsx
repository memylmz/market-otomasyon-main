/** Satış fişi görüntüleyici — Cari ve Kasa ekranları ortak kullanır. */

import { useEffect, useState } from 'react';
import { miktarFormat, paraFormat, tarihSaatFormat, type Kurus } from '@market/shared';
import { BosDurum, Diyalog, Rozet, Yukleniyor } from './temel';
import { hatayiBildir } from '../durum/bildirim';
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
    satis: { fis_no: string; tarih: string; genel_toplam: Kurus; iptal_mi?: boolean; musteri_adi?: string | null };
    kalemler: { urun_adi: string; miktar: number; birim_tipi?: string; birim_fiyat: Kurus; satir_toplam: Kurus }[];
    odemeler: { odeme_tipi: string; tutar: Kurus }[];
  } | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

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

  return (
    <Diyalog
      acik
      baslik={detay ? `Fiş ${detay.satis.fis_no}` : 'Fiş'}
      aciklama={detay ? tarihSaatFormat(detay.satis.tarih) : undefined}
      onKapat={onKapat}
      altBilgi={
        <button type="button" className="tus-ikincil" onClick={onKapat}>
          Kapat
        </button>
      }
    >
      {yukleniyor ? (
        <Yukleniyor />
      ) : !detay ? (
        <BosDurum baslik="Fiş bulunamadı" aciklama="Satış kaydı silinmiş ya da henüz senkronlanmamış olabilir." />
      ) : (
        <>
          {detay.satis.iptal_mi && <Rozet tur="tehlike">Bu satış iptal edilmiş</Rozet>}
          <table className="tablo mt-2">
            <thead>
              <tr>
                <th>Ürün</th>
                <th className="text-right">Miktar</th>
                <th className="text-right">Birim</th>
                <th className="text-right">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {detay.kalemler.map((k, i) => (
                <tr key={i}>
                  <td>{k.urun_adi}</td>
                  <td className="sayi">{miktarFormat(k.miktar, k.birim_tipi as never)}</td>
                  <td className="sayi text-metin-3">{paraFormat(k.birim_fiyat, { simge: false })}</td>
                  <td className="sayi font-semibold">{paraFormat(k.satir_toplam, { simge: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex items-baseline justify-between rounded bg-yuzey-3 px-4 py-3">
            <span className="text-metin-2">Genel toplam</span>
            <span className="font-mono text-xl font-bold text-vurgu">{paraFormat(detay.satis.genel_toplam)}</span>
          </div>

          <OdemeDokumu odemeler={detay.odemeler} musteriAdi={detay.satis.musteri_adi ?? null} />
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
}: {
  odemeler: { odeme_tipi: string; tutar: Kurus }[];
  musteriAdi: string | null;
}) {
  if (odemeler.length === 0) return null;
  const veresiye = odemeler.find((o) => o.odeme_tipi === 'VERESIYE');

  return (
    <div className="mt-3 rounded border border-cizgi px-4 py-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-metin-4">Ödeme</div>
      <div className="space-y-1">
        {odemeler.map((o, i) => (
          <div key={i} className="flex items-baseline justify-between text-sm">
            <span className="text-metin-2">{ODEME_ETIKETI[o.odeme_tipi] ?? o.odeme_tipi}</span>
            <span className={`font-mono font-semibold ${o.odeme_tipi === 'VERESIYE' ? 'text-uyari' : ''}`}>
              {paraFormat(o.tutar, { simge: false })}
            </span>
          </div>
        ))}
      </div>
      {veresiye && (
        <p className="mt-2 border-t border-cizgi pt-2 text-xs text-metin-3">
          {paraFormat(veresiye.tutar)} <strong>{musteriAdi ?? 'müşteri'}</strong> hesabına borç yazıldı.
        </p>
      )}
    </div>
  );
}
