/** Satış fişi görüntüleyici — Cari ve Kasa ekranları ortak kullanır. */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { miktarFormat, paraFormat, tarihSaatFormat, type Kurus } from '@market/shared';
import { FisGorunumu } from './FisGorunumu';
import { BosDurum, Diyalog, Rozet, Yukleniyor } from './temel';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { useYetki } from '../durum/oturum';
import { cagir } from '../kopru';

/** Fiş penceresinin, kağıtta OLMAYAN bilgiler için ihtiyaç duyduğu satış verisi. */
export interface FisDurumVerisi {
  satis: {
    fis_no: string;
    tarih: string;
    genel_toplam: Kurus;
    iptal_mi?: boolean;
    iade_mi?: boolean;
    iptal_neden?: string | null;
    kaynak_fis_no?: string | null;
    notlar?: string | null;
    musteri_adi?: string | null;
  };
  kalemler: {
    urun_adi: string;
    miktar: number;
    birim_tipi?: string;
    /** Bu satıştan iade edilen miktar (eksi). */
    iade_edilen?: number;
  }[];
  iadeler?: { fis_no: string; genel_toplam: Kurus }[];
}

/**
 * Bir satışın fişi (§10.7) — müşterinin elindeki kağıdın aynısı.
 *
 * Fişin kendisi `FisGorunumu` ile yazıcı çıktısından çizilir. Kağıtta
 * olmayan ama sonradan önem kazanan bilgiler (iptal edildi mi, hangi fişin
 * iadesi, bu fişten ne kadar iade edildi) fişin üstünde ve altında durur.
 *
 * ORTAK bileşendir: Cari ekstresinde borcun arkasındaki fiş, Kasa ekranında
 * nakit hareketinin arkasındaki fiş — ikisi de aynı şeyi gösterir.
 */
export function SatisFisiDiyalogu({ satisId, onKapat }: { satisId: string | null; onKapat: () => void }) {
  const [detay, setDetay] = useState<FisDurumVerisi | null>(null);
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
    cagir<FisDurumVerisi>('satis.detay', { satisId })
      .then(setDetay)
      .catch((hata) => hatayiBildir(hata, 'Fiş detayı'))
      .finally(() => setYukleniyor(false));
  }, [satisId]);

  if (!satisId) return null;

  return (
    <Diyalog
      acik
      baslik={detay ? `Fiş — ${detay.satis.fis_no}` : 'Fiş'}
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
          <FisiTekrarYazdir satisId={satisId} devreDisi={!detay} />
          <button type="button" className="tus-birincil" onClick={onKapat}>
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
        <div className="space-y-3">
          <FisDurumNotlari detay={detay} />
          <FisGorunumu satisId={satisId} />
          <IadeDokumu detay={detay} />
        </div>
      )}
    </Diyalog>
  );
}

/** Kopya fişi yazıcıya gönderir (fiş penceresinin ortak düğmesi). */
export function FisiTekrarYazdir({ satisId, devreDisi = false }: { satisId: string; devreDisi?: boolean }) {
  const [calisiyor, setCalisiyor] = useState(false);
  return (
    <button
      type="button"
      className="tus-ikincil"
      disabled={devreDisi || calisiyor}
      onClick={async () => {
        setCalisiyor(true);
        try {
          const sonuc = await cagir<{ basarili: boolean; hata?: string }>('satis.fisYazdir', { satisId, kopya: true });
          if (sonuc.basarili) bildir.basari('Fiş kopyası yazdırıldı');
          else bildir.uyari('Yazdırılamadı', sonuc.hata);
        } catch (hata) {
          hatayiBildir(hata, 'Fiş yazdırma');
        } finally {
          setCalisiyor(false);
        }
      }}
    >
      {calisiyor ? 'Yazdırılıyor…' : 'Tekrar Yazdır'}
    </button>
  );
}

/** Kağıtta yazmayan durumlar: iptal, iade fişi, bu fişten yapılan iadeler. */
export function FisDurumNotlari({ detay }: { detay: FisDurumVerisi }) {
  const iadeler = detay.iadeler ?? [];
  return (
    <>
      {detay.satis.iptal_mi && (
        <p className="rounded border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm">
          <Rozet tur="tehlike">İptal edildi</Rozet>
          {detay.satis.iptal_neden && <span className="ml-2">Neden: {detay.satis.iptal_neden}</span>}
        </p>
      )}
      {detay.satis.iade_mi && (
        <p className="rounded border border-uyari-cizgi bg-uyari-yumusak px-3 py-2 text-sm">
          <strong>İade fişi</strong> — iade edilen fiş: {detay.satis.kaynak_fis_no ?? '—'}
          {detay.satis.notlar && detay.satis.notlar !== 'Belirtilmedi' ? ` · Neden: ${detay.satis.notlar}` : ''}
        </p>
      )}
      {iadeler.length > 0 && (
        <p className="rounded border border-uyari-cizgi bg-uyari-yumusak px-3 py-2 text-sm">
          <strong>Bu satıştan iade yapıldı:</strong>{' '}
          {iadeler.map((i) => `${i.fis_no} (${paraFormat(Math.abs(i.genel_toplam), { simge: false })})`).join(', ')}
        </p>
      )}
    </>
  );
}

/**
 * Satır bazında iade: orijinal fiş DEĞİŞMEZ; fişin altında hangi üründen ne
 * kadar iade edildiği, kalanı ve iadeler düşülmüş net tutar gösterilir.
 */
export function IadeDokumu({ detay }: { detay: FisDurumVerisi }) {
  if (detay.satis.iade_mi) return null;
  const satirlar = detay.kalemler.filter((k) => (k.iade_edilen ?? 0) !== 0);
  if (satirlar.length === 0) return null;
  const iadeToplami = (detay.iadeler ?? []).reduce((t, i) => t + i.genel_toplam, 0);

  return (
    <div className="rounded border border-uyari-cizgi px-4 py-3 text-sm">
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
              <td className="sayi py-1 text-right">{miktarFormat(k.miktar, k.birim_tipi as never)}</td>
              <td className="sayi py-1 text-right text-uyari">{miktarFormat(-(k.iade_edilen ?? 0), k.birim_tipi as never)}</td>
              <td className="sayi py-1 text-right font-medium">
                {miktarFormat(k.miktar + (k.iade_edilen ?? 0), k.birim_tipi as never)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex justify-between border-t border-cizgi pt-2">
        <span className="text-metin-2">Fiş toplamı</span>
        <span className="font-mono">{paraFormat(detay.satis.genel_toplam, { simge: false })}</span>
      </div>
      <div className="flex justify-between text-uyari">
        <span>İadeler</span>
        <span className="font-mono">-{paraFormat(Math.abs(iadeToplami), { simge: false })}</span>
      </div>
      <div className="flex justify-between font-semibold">
        <span>Net tutar</span>
        <span className="font-mono">{paraFormat(detay.satis.genel_toplam + iadeToplami)}</span>
      </div>
    </div>
  );
}
