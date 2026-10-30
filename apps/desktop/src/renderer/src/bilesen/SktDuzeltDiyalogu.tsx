/**
 * Bir partinin son kullanma tarihini / lot numarasını düzeltir.
 *
 * Mal kabulde yanlış girilen tarih (ör. 01.11 yerine 01.12) SKT uyarılarını
 * yanıltır. Düzeltme partinin TÜM hareketlerine uygulanır; miktar ve maliyet
 * değişmez. Alış faturasından da SKT Takibi listesinden de açılır.
 */

import { useEffect, useState } from 'react';
import { Alan, Diyalog } from './temel';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { cagir } from '../kopru';

export interface SktPartisi {
  urun_id: string;
  ad: string;
  skt: string | null;
  lot_no: string | null;
}

export function SktDuzeltDiyalogu({
  parti,
  onKapat,
  onDuzeltildi,
}: {
  parti: SktPartisi | null;
  onKapat: () => void;
  onDuzeltildi: () => void;
}) {
  const [skt, setSkt] = useState('');
  const [lot, setLot] = useState('');
  const [calisiyor, setCalisiyor] = useState(false);

  useEffect(() => {
    setSkt(parti?.skt ?? '');
    setLot(parti?.lot_no ?? '');
  }, [parti]);

  if (!parti) return null;
  const degisti = (skt || null) !== parti.skt || (lot.trim() || null) !== (parti.lot_no || null);

  const kaydet = async () => {
    setCalisiyor(true);
    try {
      await cagir('stok.sktDuzelt', {
        urun_id: parti.urun_id,
        eski_skt: parti.skt,
        eski_lot: parti.lot_no,
        yeni_skt: skt || null,
        yeni_lot: lot.trim() || null,
      });
      bildir.basari('SKT düzeltildi', `${parti.ad}: ${skt ? skt.split('-').reverse().join('.') : 'tarihsiz'}`);
      onDuzeltildi();
    } catch (hata) {
      hatayiBildir(hata, 'SKT düzeltme');
    } finally {
      setCalisiyor(false);
    }
  };

  return (
    <Diyalog
      acik
      baslik="SKT / Lot Düzelt"
      aciklama={`${parti.ad} — bu partinin bütün kayıtları düzelir; miktar ve maliyet değişmez.`}
      genislik="dar"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={() => void kaydet()} disabled={!degisti || calisiyor}>
            {calisiyor ? 'Kaydediliyor…' : 'Düzelt'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-metin-3">
          Şu an:{' '}
          <span className="font-medium text-metin">{parti.skt ? parti.skt.split('-').reverse().join('.') : 'tarih yok'}</span>
          {parti.lot_no ? ` · lot ${parti.lot_no}` : ''}
        </p>
        <Alan etiket="Doğru son kullanma tarihi" ipucu="Boş bırakılırsa partinin tarihi silinir.">
          <input type="date" className="alan" value={skt} onChange={(e) => setSkt(e.target.value)} />
        </Alan>
        <Alan etiket="Parti / lot">
          <input className="alan" value={lot} onChange={(e) => setLot(e.target.value)} maxLength={60} />
        </Alan>
      </div>
    </Diyalog>
  );
}
