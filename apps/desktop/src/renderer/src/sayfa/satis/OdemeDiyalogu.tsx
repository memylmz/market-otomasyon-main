/**
 * Ödeme diyaloğu (§10.3) — Nakit / Kart (manuel) / Veresiye, tek ekranda.
 *
 * Tasarım kuralı: "Tek ödeme / Parçalı ödeme" diye MOD YOKTUR. Üç yöntem üç
 * satırdır; her satıra tutar yazılır. Kısayollar:
 *  - Yöntem adına basmak  → tüm tutarı o yönteme verir (tek ödemenin 1 tıkı).
 *  - "Kalanı" düğmesi     → kalan tutarı o satıra ekler (parçalı ödemenin 1 tıkı).
 * En kötü senaryo (nakit+kart+veresiye): iki tutar yaz + bir "Kalanı" = 3 hamle.
 *
 * ⚠️ POS entegrasyonu yoktur (§13): kart tutarı yalnız **işaretlenir**,
 * müşteriden tahsilat ayrı POS cihazından elle alınır. Diyalog bunu açıkça belirtir.
 */

import { useEffect, useMemo, useState } from 'react';
import { nakitOnerileri, odemeDogrula, paraFormat, type Kurus, type OdemeGirdisi } from '@market/shared';
import { Diyalog, Kisayol, ParaAlani, Rozet } from '../../bilesen/temel';

type OdemeTipi = 'NAKIT' | 'KART' | 'VERESIYE';

// Kısayol YOKTUR: tek tuşla satış F5/F4'e taşındı; bu pencere kart ve parçalı
// ödeme için fareyle kullanılır (§10.3).
const YONTEMLER: { tip: OdemeTipi; etiket: string }[] = [
  { tip: 'NAKIT', etiket: '💵 Nakit' },
  { tip: 'KART', etiket: '💳 Kart' },
  { tip: 'VERESIYE', etiket: '📒 Veresiye' },
];

export interface StokAsimiSatiri {
  ad: string;
  istenen: string;
  mevcut: string;
}

export interface OdemeDiyaloguOzellikleri {
  acik: boolean;
  genelToplam: Kurus;
  musteriId: string | null;
  musteriAdi: string | null;
  islemde: boolean;
  /**
   * Açılışta tüm tutarın verileceği yöntem. F5/F6/F7 ile açıldığında dolar;
   * F12 ile açıldığında `NAKIT` (en sık senaryo) kalır.
   */
  baslangicTipi?: OdemeTipi;
  /** Stoktan fazla satılan kalemler — engellemez, yalnız görünür uyarı üretir. */
  stokAsimi?: StokAsimiSatiri[];
  onKapat: () => void;
  /** Müşteri seçme diyaloğunu AÇAR; bu diyalog açık kalır (üstüne biner). */
  onMusteriSec: () => void;
  onTamamla: (
    odemeler: { tip: OdemeTipi; tutar: Kurus; alinan?: Kurus }[],
    onaylar: { limitAsimiOnaylandi?: boolean; negatifStokOnaylandi?: boolean },
  ) => void;
}

export function OdemeDiyalogu({
  acik,
  genelToplam,
  musteriId,
  musteriAdi,
  islemde,
  baslangicTipi = 'NAKIT',
  stokAsimi = [],
  onKapat,
  onMusteriSec,
  onTamamla,
}: OdemeDiyaloguOzellikleri) {
  const [tutarlar, setTutarlar] = useState<Record<OdemeTipi, Kurus>>({ NAKIT: 0, KART: 0, VERESIYE: 0 });
  const [alinanNakit, setAlinanNakit] = useState<Kurus>(0);

  // Açılışta tüm tutar seçilen yönteme verilir → Enter tek başına satışı bitirir.
  useEffect(() => {
    if (!acik) return;
    setTutarlar({ NAKIT: 0, KART: 0, VERESIYE: 0, [baslangicTipi]: genelToplam });
    setAlinanNakit(baslangicTipi === 'NAKIT' ? genelToplam : 0);
  }, [acik, genelToplam, baslangicTipi]);

  const toplamAtanan = tutarlar.NAKIT + tutarlar.KART + tutarlar.VERESIYE;
  const kalan = genelToplam - toplamAtanan;

  /** Tutar değiştiren tek kapı: nakit değişince "alınan" da onu izler. */
  const tutarAyarla = (tip: OdemeTipi, deger: Kurus) => {
    const yeni = Math.max(0, deger);
    setTutarlar((t) => ({ ...t, [tip]: yeni }));
    if (tip === 'NAKIT') setAlinanNakit(yeni);
  };

  const tumunuVer = (tip: OdemeTipi) => {
    setTutarlar({ NAKIT: 0, KART: 0, VERESIYE: 0, [tip]: genelToplam });
    setAlinanNakit(tip === 'NAKIT' ? genelToplam : 0);
  };

  const kalaniVer = (tip: OdemeTipi) => {
    if (kalan <= 0) return;
    tutarAyarla(tip, tutarlar[tip] + kalan);
  };

  const odemeler: OdemeGirdisi[] = useMemo(
    () =>
      YONTEMLER.filter((y) => tutarlar[y.tip] > 0).map((y) =>
        y.tip === 'NAKIT'
          ? { tip: 'NAKIT', tutar: tutarlar.NAKIT, alinan: Math.max(alinanNakit, tutarlar.NAKIT) }
          : { tip: y.tip, tutar: tutarlar[y.tip] },
      ),
    [tutarlar, alinanNakit],
  );

  const dogrulama = odemeDogrula(genelToplam, odemeler);
  const musteriEksik = tutarlar.VERESIYE > 0 && !musteriId;
  const gonderilebilir = dogrulama.gecerli && !musteriEksik && !islemde && genelToplam > 0;
  const paraUstu = Math.max(0, Math.max(alinanNakit, tutarlar.NAKIT) - tutarlar.NAKIT);

  const tamamla = () => {
    if (!gonderilebilir) return;
    onTamamla(
      odemeler.map((o) => ({ tip: o.tip as OdemeTipi, tutar: o.tutar, alinan: o.alinan })),
      { limitAsimiOnaylandi: true },
    );
  };

  return (
    <Diyalog
      acik={acik}
      baslik="Ödeme"
      aciklama={`Tahsil edilecek: ${paraFormat(genelToplam)}`}
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç <Kisayol>ESC</Kisayol>
          </button>
          <button type="button" className="tus-birincil px-8" onClick={tamamla} disabled={!gonderilebilir}>
            {islemde ? 'Kaydediliyor…' : 'Satışı Tamamla'} <Kisayol>Enter</Kisayol>
          </button>
        </>
      }
    >
      <div
        onKeyDown={(e) => {
          if (e.key === 'Enter' && gonderilebilir) {
            e.preventDefault();
            tamamla();
          }
        }}
      >
        <div className="mb-3 flex items-center justify-between gap-4 rounded-lg bg-yuzey-3 p-4">
          <div>
            <p className="text-sm text-metin-3">Genel Toplam</p>
            <p className="font-mono text-tutar text-vurgu">{paraFormat(genelToplam)}</p>
          </div>
          {/* Müşteri buradan seçilir; müşteri penceresi bu diyaloğun ÜSTÜNE açılır,
              ödeme ekranı kapanmaz (kullanıcı geri bildirimi). */}
          <div className="text-right">
            <p className="text-xs text-metin-3">Müşteri</p>
            <button type="button" className="tus-ikincil mt-1 px-3 py-1.5 text-sm" onClick={onMusteriSec}>
              <span className="max-w-[180px] truncate">{musteriAdi ?? 'Seçilmedi'}</span> <Kisayol>F1</Kisayol>
            </button>
          </div>
        </div>

        {/* Stok aşımı satışı engellemez; kasiyerin bilgisi olsun diye gösterilir. */}
        {stokAsimi.length > 0 && (
          <div className="mb-3 rounded-lg border border-uyari-cizgi bg-uyari-yumusak p-3 text-sm">
            <p className="font-medium text-uyari">Stokta görünenden fazla satılıyor</p>
            <ul className="mt-1 space-y-0.5 text-metin-2">
              {stokAsimi.map((s) => (
                <li key={s.ad}>
                  {s.ad}: <strong>{s.istenen}</strong> satılıyor, stokta <strong>{s.mevcut}</strong> görünüyor
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-metin-3">
              Satış engellenmez. Stok eksiye düşecek; sayım veya bekleyen mal kabulü kontrol edin.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {YONTEMLER.map((y, i) => (
            <div key={y.tip} className="flex items-center gap-2">
              <button
                type="button"
                title="Tüm tutarı bu yönteme ver"
                className={`${tutarlar[y.tip] > 0 ? 'tus-birincil' : 'tus-ikincil'} w-32 justify-start py-2.5`}
                onClick={() => tumunuVer(y.tip)}
              >
                {y.etiket}
              </button>
              <ParaAlani
                deger={tutarlar[y.tip]}
                onDegisim={(v) => tutarAyarla(y.tip, v)}
                sinif="py-2.5"
                etiket={`${y.etiket} tutarı`}
                otomatikOdak={i === 0}
              />
              <button
                type="button"
                className="tus-ikincil whitespace-nowrap px-3 py-2.5 text-sm"
                onClick={() => kalaniVer(y.tip)}
                disabled={kalan <= 0}
              >
                Kalanı
              </button>
            </div>
          ))}
        </div>

        <p className="mt-1 text-xs text-metin-4">
          İpucu: yöntem adına basmak tüm tutarı o yönteme verir; parçalı ödemede tutarları yazıp son yöntem için “Kalanı”na basın.
        </p>

        {/* Kalan / fazla göstergesi */}
        <div className="mt-3 flex items-baseline justify-between rounded bg-yuzey-3 px-4 py-2.5">
          <span className="text-metin-2">{kalan >= 0 ? 'Kalan' : 'Fazla girilen'}</span>
          <span className={`font-mono text-xl font-bold ${kalan === 0 ? 'text-vurgu' : 'text-uyari'}`}>
            {paraFormat(Math.abs(kalan))}
          </span>
        </div>

        {tutarlar.NAKIT > 0 && (
          <div className="mt-3 space-y-2 rounded border border-cizgi p-3">
            <div className="flex items-end gap-3">
              <label className="flex-1">
                <span className="etiket">Müşteriden alınan nakit</span>
                <ParaAlani deger={alinanNakit} onDegisim={(v) => setAlinanNakit(Math.max(0, v))} />
              </label>
              <div className="flex-1 text-right">
                <p className="text-xs text-metin-3">Para üstü</p>
                <p className="font-mono text-2xl font-bold text-uyari">{paraFormat(paraUstu)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {nakitOnerileri(tutarlar.NAKIT).map((oneri) => (
                <button key={oneri} type="button" className="tus-ikincil px-3 py-1 text-sm" onClick={() => setAlinanNakit(oneri)}>
                  {paraFormat(oneri, { simge: false })}
                </button>
              ))}
            </div>
          </div>
        )}

        {tutarlar.KART > 0 && (
          <div className="mt-3 rounded border border-bilgi-cizgi bg-bilgi-yumusak p-3 text-sm text-bilgi">
            Kart tutarı <strong>{paraFormat(tutarlar.KART)}</strong> manuel işaretlenir: POS cihazına elle girip tahsilatı
            tamamlayın; bu sistem banka POS'u ile konuşmaz.
          </div>
        )}

        {musteriEksik && (
          <div className="mt-3">
            <Rozet tur="tehlike">Veresiye için müşteri zorunludur — yukarıdan seçin (F1)</Rozet>
          </div>
        )}

        {!dogrulama.gecerli && dogrulama.hata === 'ODEME_FAZLA' && (
          <p className="mt-2 text-sm text-tehlike">Girilen tutarlar genel toplamı aşıyor; bir satırı azaltın.</p>
        )}
        {!dogrulama.gecerli && dogrulama.hata === 'ALINAN_YETERSIZ' && (
          <p className="mt-2 text-sm text-tehlike">Alınan nakit, nakit tutarından az olamaz.</p>
        )}
      </div>
    </Diyalog>
  );
}
