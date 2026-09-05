/**
 * Tahsilat / tedarikçi ödemesi — TEK diyalog (§10.7).
 *
 * ORTAK bileşendir. Daha önce iki ayrı kopya vardı ve ÇELİŞİYORLARDI: satış
 * ekranındaki kopya borçtan fazla tutarı sert biçimde engelliyor, Cari
 * ekranındaki kopya yalnız uyarıp kabul ediyordu. Aynı işin iki yerde
 * yazılması, er geç iki farklı davranış demektir; bu yüzden tek yerde durur.
 *
 * DAVRANIŞ — para üstü esaslıdır, satıştaki nakit ödemenin aynısı:
 * kasiyer MÜŞTERİDEN ALDIĞI tutarı girer, borç kadarı tahsil edilir, farkı
 * para üstü olarak geri verir. "Borcum 87, al 100" günlük hayatta en sık
 * karşılaşılan durumdur ve kasiyerin kafadan çıkarma yapmasını gerektirmez.
 *
 * Fazlanın hesapta ALACAK olarak kalması bilinçli bir karardır: ancak
 * "avans olarak bırak" işaretlenirse olur. Aksi hâlde yuvarlak para veren her
 * müşteri farkında olmadan hesabı alacaklıya düşürürdü.
 *
 * Kuralın kendisi burada DEĞİL, `cari.tahsilat` servisindedir; bu ekran onu
 * yalnız görünür kılar.
 */

import { useEffect, useState } from 'react';
import { paraFormat, type Kurus } from '@market/shared';
import { Alan, Diyalog, Kisayol, ParaAlani } from './temel';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { cagir } from '../kopru';

export interface TahsilatCarisi {
  id: string;
  ad_unvan: string;
  tip: 'MUSTERI' | 'TEDARIKCI';
  bakiye: Kurus;
}

export function TahsilatDiyalogu({
  acik,
  cari,
  onKapat,
  onTamam,
}: {
  acik: boolean;
  cari: TahsilatCarisi;
  onKapat: () => void;
  onTamam: () => void;
}) {
  const musteriMi = cari.tip === 'MUSTERI';
  const borc = Math.max(0, cari.bakiye);

  const [alinan, setAlinan] = useState<Kurus>(0);
  const [odemeTipi, setOdemeTipi] = useState<'NAKIT' | 'KART'>('NAKIT');
  const [aciklama, setAciklama] = useState('');
  const [avansMi, setAvansMi] = useState(false);
  const [calisiyor, setCalisiyor] = useState(false);

  useEffect(() => {
    if (!acik) return;
    // En sık senaryo "borcun tamamını kapatıyorum" — alan onunla dolu gelir.
    setAlinan(borc);
    setAciklama('');
    setAvansMi(false);
    setCalisiyor(false);
  }, [acik, borc]);

  if (!acik) return null;

  const fazlaVar = alinan > borc;
  const tahsilEdilen = avansMi ? alinan : Math.min(alinan, borc);
  const paraUstu = avansMi ? 0 : Math.max(0, alinan - borc);
  const kalanBorc = borc - Math.min(tahsilEdilen, borc);
  const alacak = avansMi ? Math.max(0, tahsilEdilen - borc) : 0;
  const gecerli = tahsilEdilen > 0 && !calisiyor;

  const kaydet = async () => {
    if (!gecerli) return;
    setCalisiyor(true);
    try {
      await cagir('cari.tahsilat', {
        cari_id: cari.id,
        tutar: tahsilEdilen,
        odeme_tipi: odemeTipi,
        aciklama: aciklama.trim() || undefined,
        avans_kabul: avansMi,
      });
      bildir.basari(
        `${cari.ad_unvan} — ${paraFormat(tahsilEdilen)} ${musteriMi ? 'tahsil edildi' : 'ödendi'}`,
        alacak > 0
          ? `${paraFormat(alacak)} avans olarak hesapta kaldı.`
          : paraUstu > 0
            ? `Para üstü: ${paraFormat(paraUstu)} · Borç kapandı.`
            : kalanBorc > 0
              ? `Kalan borç: ${paraFormat(kalanBorc)}`
              : 'Borcu kapandı.',
      );
      onTamam();
    } catch (hata) {
      // Nakit tahsilat açık kasa ister; servis bunu zaten reddeder, mesajı taşıyoruz.
      hatayiBildir(hata, musteriMi ? 'Tahsilat' : 'Tedarikçi ödemesi');
    } finally {
      setCalisiyor(false);
    }
  };

  return (
    <Diyalog
      acik
      baslik={musteriMi ? `Tahsilat — ${cari.ad_unvan}` : `Tedarikçi Ödemesi — ${cari.ad_unvan}`}
      aciklama={borc > 0 ? `Güncel borç: ${paraFormat(borc)}` : 'Bu hesapta borç görünmüyor.'}
      genislik="dar"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç <Kisayol>ESC</Kisayol>
          </button>
          <button type="button" className="tus-birincil px-8" onClick={() => void kaydet()} disabled={!gecerli}>
            {calisiyor ? 'Kaydediliyor…' : musteriMi ? 'Tahsil Et' : 'Öde'} <Kisayol>Enter</Kisayol>
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Alan etiket={musteriMi ? 'Alınan tutar' : 'Ödenen tutar'}>
          <ParaAlani deger={alinan} onDegisim={setAlinan} sinif="py-3 text-2xl" otomatikOdak onEnter={() => void kaydet()} />
        </Alan>

        <div className="flex gap-2">
          {(['NAKIT', 'KART'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`${odemeTipi === t ? 'tus-birincil' : 'tus-ikincil'} flex-1 py-2.5`}
              onClick={() => setOdemeTipi(t)}
            >
              {t === 'NAKIT' ? '💵 Nakit' : '💳 Kart'}
            </button>
          ))}
        </div>

        {/* Hesap dökümü: kasiyer kafadan çıkarma yapmasın. */}
        <div className="rounded bg-yuzey-3 px-4 py-3">
          <Satir etiket={musteriMi ? 'Tahsil edilen' : 'Ödenen'} tutar={tahsilEdilen} kalin />
          {paraUstu > 0 && (
            <Satir
              etiket={musteriMi ? 'Para üstü' : 'İade edilecek'}
              tutar={paraUstu}
              sinif="text-vurgu"
              ipucu="Müşteriye geri verilir; hesaba yazılmaz."
            />
          )}
          {alacak > 0 && <Satir etiket="Avans (alacak)" tutar={alacak} sinif="text-bilgi" ipucu="Hesapta alacak olarak kalır." />}
          <div className="mt-1 border-t border-cizgi pt-1">
            <Satir etiket="Kalan borç" tutar={kalanBorc} kalin sinif={kalanBorc > 0 ? 'text-uyari' : 'text-basari'} />
          </div>
        </div>

        {fazlaVar && (
          <label className="flex items-start gap-2 rounded border border-bilgi-cizgi bg-bilgi-yumusak px-3 py-2 text-sm">
            <input type="checkbox" className="mt-1" checked={avansMi} onChange={(e) => setAvansMi(e.target.checked)} />
            <span>
              Fazlasını <strong>avans olarak bırak</strong>
              <span className="block text-xs text-metin-3">
                İşaretlenmezse {paraFormat(alinan - borc)} para üstü olarak geri verilir. İşaretlenirse hesapta alacak olarak
                kalır ve sonraki alışverişten düşülür.
              </span>
            </span>
          </label>
        )}

        <Alan etiket="Açıklama">
          <input className="alan" value={aciklama} onChange={(e) => setAciklama(e.target.value)} />
        </Alan>

        {odemeTipi === 'NAKIT' && (
          <p className="text-xs text-metin-4">
            Nakit {musteriMi ? 'tahsilat kasaya girer' : 'ödeme kasadan çıkar'}; kasa açık olmalıdır.
          </p>
        )}
      </div>
    </Diyalog>
  );
}

function Satir({
  etiket,
  tutar,
  kalin,
  sinif,
  ipucu,
}: {
  etiket: string;
  tutar: Kurus;
  kalin?: boolean;
  sinif?: string;
  ipucu?: string;
}) {
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span className={`text-sm ${kalin ? 'text-metin-2' : 'text-metin-3'}`}>
        {etiket}
        {ipucu && <span className="ml-1 text-xs text-metin-4">· {ipucu}</span>}
      </span>
      <span className={`font-mono ${kalin ? 'text-lg font-bold' : 'text-sm font-semibold'} ${sinif ?? ''}`}>
        {paraFormat(tutar, { simge: false })}
      </span>
    </div>
  );
}
