/** Alış faturası görüntüleyici — Cari ve Stok ekranları ortak kullanır. */

import { useEffect, useState } from 'react';
import { miktarFormat, paraFormat, tarihFormat, tarihSaatFormat, type Kurus, type Miktar } from '@market/shared';
import { BosDurum, Diyalog, Rozet, TutarSatiri, Yukleniyor } from './temel';
import { hatayiBildir } from '../durum/bildirim';
import { cagir } from '../kopru';

export interface AlisFaturasiDetayi {
  id: string;
  tedarikci_adi?: string;
  fatura_no: string | null;
  tarih: string;
  ara_toplam: Kurus;
  kdv_toplam: Kurus;
  genel_toplam: Kurus;
  durum: 'TASLAK' | 'ONAYLANDI' | 'IPTAL';
  vade_tarihi: string | null;
  notlar: string | null;
  kullanici_adi?: string | null;
  odenen?: Kurus;
}

export interface AlisFaturasiKalemi {
  id: string;
  urun_adi: string;
  birim_tipi?: string;
  miktar: Miktar;
  birim_fiyat: Kurus;
  kdv_orani: number;
  satir_toplam: Kurus;
  skt: string | null;
  lot_no: string | null;
}

/**
 * Faturanın içeriği: belge bilgisi, kalemler, toplamlar ve ödeme durumu.
 *
 * Tedarikçi "şu faturada ne vardı?" diye sorduğunda cevap tek ekranda olmalı;
 * cari ekstresindeki tek satırlık "Mal alımı" tutarı bunu söylemez.
 */
export function AlisFaturasiIcerigi({ fatura, kalemler }: { fatura: AlisFaturasiDetayi; kalemler: AlisFaturasiKalemi[] }) {
  const iptal = fatura.durum === 'IPTAL';
  const odenen = fatura.odenen ?? null;

  return (
    <div className="space-y-3">
      {iptal && <Rozet tur="tehlike">Bu fatura iptal edilmiş — stok ve tedarikçi borcu ters kayıtla geri alındı</Rozet>}

      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Bilgi etiket="Fatura no" deger={fatura.fatura_no ?? 'Numarasız'} />
        <Bilgi etiket="Alış tarihi" deger={tarihSaatFormat(fatura.tarih)} />
        <Bilgi etiket="Vade" deger={fatura.vade_tarihi ? tarihFormat(fatura.vade_tarihi) : '—'} />
        <Bilgi etiket="Faturayı giren" deger={fatura.kullanici_adi ?? '—'} />
      </div>

      <table className="tablo">
        <thead>
          <tr>
            <th>Ürün</th>
            <th className="text-right">Miktar</th>
            <th className="text-right">Birim fiyat</th>
            <th className="text-right">KDV</th>
            <th className="text-right">Satır toplamı</th>
            <th>SKT / Lot</th>
          </tr>
        </thead>
        <tbody>
          {kalemler.map((k) => (
            <tr key={k.id}>
              <td>{k.urun_adi}</td>
              <td className="sayi">{miktarFormat(k.miktar, k.birim_tipi as never)}</td>
              <td className="sayi">{paraFormat(k.birim_fiyat, { simge: false })}</td>
              <td className="sayi text-metin-3">%{k.kdv_orani}</td>
              <td className="sayi font-semibold">{paraFormat(k.satir_toplam, { simge: false })}</td>
              <td className="text-xs text-metin-4">{[k.skt, k.lot_no].filter(Boolean).join(' · ') || '—'}</td>
            </tr>
          ))}
          {kalemler.length === 0 && (
            <tr>
              <td colSpan={6}>
                <BosDurum baslik="Kalem yok" />
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="space-y-1 rounded bg-yuzey-3 px-4 py-3">
        <TutarSatiri etiket="Ara toplam (KDV hariç)" tutar={fatura.ara_toplam} />
        <TutarSatiri etiket="KDV" tutar={fatura.kdv_toplam} />
        <TutarSatiri etiket="Genel toplam" tutar={fatura.genel_toplam} buyuk vurgu />
      </div>

      {odenen !== null && !iptal && (
        <div className="space-y-1 rounded border border-cizgi px-4 py-3">
          <TutarSatiri etiket="Faturayla ödenen" tutar={odenen} />
          <TutarSatiri etiket="Kalan borç" tutar={fatura.genel_toplam - odenen} />
          <p className="pt-1 text-xs text-metin-4">
            Sonradan cari ekranından yapılan ödemeler faturaya değil, tedarikçinin genel bakiyesine yazılır.
          </p>
        </div>
      )}

      {fatura.notlar && <p className="whitespace-pre-line text-xs text-metin-4">{fatura.notlar}</p>}
    </div>
  );
}

function Bilgi({ etiket, deger }: { etiket: string; deger: string }) {
  return (
    <div>
      <p className="text-xs text-metin-4">{etiket}</p>
      <p className="font-medium">{deger}</p>
    </div>
  );
}

/** Kimliği verilen faturayı kendisi yükleyip gösterir — cari ekstresinden açılır. */
export function AlisFaturasiDiyalogu({ faturaId, onKapat }: { faturaId: string | null; onKapat: () => void }) {
  const [detay, setDetay] = useState<{ fatura: AlisFaturasiDetayi | null; kalemler: AlisFaturasiKalemi[] } | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

  useEffect(() => {
    if (!faturaId) {
      setDetay(null);
      return;
    }
    setYukleniyor(true);
    cagir<typeof detay>('stok.alisFaturasi', { faturaId })
      .then(setDetay)
      .catch((hata) => hatayiBildir(hata, 'Fatura detayı'))
      .finally(() => setYukleniyor(false));
  }, [faturaId]);

  if (!faturaId) return null;
  const fatura = detay?.fatura ?? null;

  return (
    <Diyalog
      acik
      baslik={fatura ? `Alış faturası — ${fatura.tedarikci_adi ?? ''}` : 'Alış faturası'}
      aciklama={fatura ? `${fatura.fatura_no ?? 'Numarasız'} · ${tarihSaatFormat(fatura.tarih)}` : undefined}
      genislik="genis"
      onKapat={onKapat}
      altBilgi={
        <button type="button" className="tus-ikincil" onClick={onKapat}>
          Kapat
        </button>
      }
    >
      {yukleniyor ? (
        <Yukleniyor />
      ) : !fatura ? (
        <BosDurum baslik="Fatura bulunamadı" aciklama="Fatura silinmiş ya da henüz bu kasaya senkronlanmamış olabilir." />
      ) : (
        <AlisFaturasiIcerigi fatura={fatura} kalemler={detay?.kalemler ?? []} />
      )}
    </Diyalog>
  );
}
