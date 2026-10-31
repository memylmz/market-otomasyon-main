/**
 * Ödeme diyaloğu (§10.3) — Nakit / Kart (manuel) / Veresiye, tek ekranda.
 *
 * Tasarım kuralı: "Tek ödeme / Parçalı ödeme" diye MOD YOKTUR. Üç yöntem üç
 * satırdır; her satıra tutar yazılır. Kısayollar:
 *  - Yöntem adına basmak  → tüm tutarı o yönteme verir (tek ödemenin 1 tıkı).
 *  - "Kalanı" düğmesi     → kalan tutarı o satıra ekler (parçalı ödemenin 1 tıkı).
 * En kötü senaryo (nakit+kart+veresiye): iki tutar yaz + bir "Kalanı" = 3 hamle.
 *
 * POS entegrasyonu kapalıyken kart tutarı yalnız **işaretlenir**, tahsilat
 * POS cihazından elle alınır; açıkken Tamamla'ya basınca tutar cihaza gider.
 * Diyalog hangisinin geçerli olduğunu açıkça belirtir.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  faturaAlicisiAdi,
  nakitOnerileri,
  odemeDogrula,
  paraFormat,
  type FaturaAlicisi,
  type Kurus,
  type OdemeGirdisi,
} from '@market/shared';
import { Diyalog, Kisayol, ParaAlani, Rozet } from '../../bilesen/temel';
import { usePosAktif } from '../../kanca/usePosAktif';

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
  /** Bu satışın fişi basılacak mı? (Dokunmatikte kasiyer buradan değiştirir.) */
  fisYazdir: boolean;
  onFisDegis: (yazdir: boolean) => void;
  onKapat: () => void;
  /** Müşteri seçme diyaloğunu AÇAR; bu diyalog açık kalır (üstüne biner). */
  onMusteriSec: () => void;
  /** Faturalı satış (e-Arşiv / e-Fatura) alıcısı; null = nihai tüketici fişi. */
  fatura?: FaturaAlicisi | null;
  /** Faturayı cihaz keser — yalnız Pavo tanımlıyken. */
  faturaKullanilabilir?: boolean;
  onFaturaSec?: () => void;
  onFaturaKaldir?: () => void;
  /** Fatura düzenleme sınırı (VUK 232); tutar buna ulaşırsa fatura zorunlu. */
  faturaSiniri?: { tutar: Kurus; yil: number } | null;
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
  fisYazdir,
  onFisDegis,
  onKapat,
  onMusteriSec,
  fatura = null,
  faturaKullanilabilir = false,
  onFaturaSec,
  onFaturaKaldir,
  faturaSiniri = null,
  onTamamla,
}: OdemeDiyaloguOzellikleri) {
  const [tutarlar, setTutarlar] = useState<Record<OdemeTipi, Kurus>>({ NAKIT: 0, KART: 0, VERESIYE: 0 });
  const [alinanNakit, setAlinanNakit] = useState<Kurus>(0);
  /**
   * "Alınan" kutusuna yazılmaya başlandığında nakit satırında duran tutar.
   * Müşteri bundan AZ verirse nakit satırı verilen tutara iner; kutu
   * düzeltilip tekrar büyütülürse bu tutara kadar geri çıkar.
   */
  const [nakitHedef, setNakitHedef] = useState<Kurus | null>(null);
  /**
   * KALANI EMEN satır: başka bir satıra tutar yazılınca bu satır kendiliğinden
   * "toplam − diğerleri" olur. Açılışta ön seçili yöntemdir; kullanıcı bu
   * satırın kendisine yazarsa elle sayılır (null). Örnek: müşteri seçili,
   * pencere 100 TL veresiye açıldı → nakit 40 yazılır → veresiye 60 olur.
   */
  const [dengeleyen, setDengeleyen] = useState<OdemeTipi | null>(null);
  const posAktif = usePosAktif(acik);

  /*
   * Açılışta tüm tutar seçilen yönteme verilir → Enter tek başına satışı bitirir.
   *
   * YALNIZ AÇILIŞTA. Başlangıç yöntemi müşteri seçilince NAKİT'ten VERESİYE'ye
   * döner; eskiden bu da sıfırlamayı tetikliyordu: "50 nakit verdi, kalanı
   * borç" diye nakit yazılıp F1 ile müşteri seçilince yazılan nakit siliniyor,
   * tutarın tamamı veresiyeye geçiyordu — parçalı ödeme yapılamıyordu.
   */
  const yontemAlanlari = useRef<HTMLDivElement>(null);
  const kokRef = useRef<HTMLDivElement>(null);
  const baslangicRef = useRef(baslangicTipi);
  baslangicRef.current = baslangicTipi;
  useEffect(() => {
    if (!acik) return;
    const tip = baslangicRef.current;
    setTutarlar({ NAKIT: 0, KART: 0, VERESIYE: 0, [tip]: genelToplam });
    setAlinanNakit(tip === 'NAKIT' ? genelToplam : 0);
    setDengeleyen(tip);
    setNakitHedef(null);
    /*
     * Ön seçili yöntemin tutarı SEÇİLİ gelsin: kasiyer "50" yazınca tutar 50
     * olsun. Alan, tutar dolmadan önce odaklandığı için seçim boş metinde
     * kalıyor, yazılan rakam eski tutarın ÖNÜNE ekleniyordu (50 → "50126,00",
     * "fazla girilen") — parçalı ödeme bu yüzden yapılamıyordu.
     */
    const zamanlayici = setTimeout(() => {
      /*
       * Nakit satışta imleç MÜŞTERİDEN ALINAN NAKİT kutusundadır: kasiyer
       * verilen parayı yazar ("200"), para üstünü görür, Enter'la bitirir.
       * Verilen tutar toplamdan azsa nakit o tutara iner, kalan görünür.
       */
      const alan =
        (tip === 'NAKIT' ? kokRef.current?.querySelector<HTMLInputElement>('[data-alinan-nakit] input') : null) ??
        yontemAlanlari.current?.querySelector<HTMLInputElement>(`[data-yontem="${tip}"] input`);
      alan?.focus();
      alan?.select();
    }, 40);
    return () => clearTimeout(zamanlayici);
  }, [acik, genelToplam]);

  /*
   * Pencere açıkken müşteri SEÇİLİRSE ödenmemiş kalan veresiyeye yazılır:
   * kasiyer müşteriyi tam da "kalanını sonra ödeyecek" dediği için seçer.
   */
  const oncekiMusteri = useRef(musteriId);
  useEffect(() => {
    const yeniSecildi = acik && musteriId && musteriId !== oncekiMusteri.current;
    oncekiMusteri.current = musteriId;
    if (!yeniSecildi) return;
    setTutarlar((t) => {
      const kalanTutar = genelToplam - (t.NAKIT + t.KART + t.VERESIYE);
      return kalanTutar > 0 ? { ...t, VERESIYE: t.VERESIYE + kalanTutar } : t;
    });
    setDengeleyen('VERESIYE');
  }, [acik, musteriId, genelToplam]);

  const toplamAtanan = tutarlar.NAKIT + tutarlar.KART + tutarlar.VERESIYE;
  const kalan = genelToplam - toplamAtanan;

  /** Tutar değiştiren tek kapı: nakit değişince "alınan" da onu izler; kalanı emen satır dengelenir. */
  const tutarAyarla = (tip: OdemeTipi, deger: Kurus) => {
    const yeniTutarlar = { ...tutarlar, [tip]: Math.max(0, deger) };
    if (dengeleyen === tip) {
      setDengeleyen(null);
    } else if (dengeleyen) {
      const digerleri = YONTEMLER.filter((y) => y.tip !== dengeleyen).reduce((t, y) => t + yeniTutarlar[y.tip], 0);
      yeniTutarlar[dengeleyen] = Math.max(0, genelToplam - digerleri);
    }
    setTutarlar(yeniTutarlar);
    if (tip === 'NAKIT' || dengeleyen === 'NAKIT') setAlinanNakit(yeniTutarlar.NAKIT);
    if (tip === 'NAKIT' || dengeleyen === 'NAKIT') setNakitHedef(null);
  };

  /*
   * MÜŞTERİDEN ALINAN NAKİT.
   *
   * Fazlası para üstüdür. AZI ise eskiden yok sayılıyordu: 126 TL'lik satışta
   * "alınan"a 100 yazılınca satış yine 126 TL nakit kaydediliyor, kasa 26 TL
   * eksik çıkıyordu. Artık nakit satırı verilen tutara iner; kalan görünür ve
   * borca yazılır ya da karta verilir. Kalanı emen satır (ör. veresiye) varsa
   * farkı o üstlenir.
   */
  const alinanDegisti = (deger: Kurus) => {
    const alinan = Math.max(0, deger);
    const hedef = nakitHedef ?? tutarlar.NAKIT;
    if (nakitHedef === null) setNakitHedef(hedef);
    setAlinanNakit(alinan);

    const yeniNakit = alinan > 0 && alinan < hedef ? alinan : hedef;
    if (yeniNakit === tutarlar.NAKIT) return;
    const yeniTutarlar = { ...tutarlar, NAKIT: yeniNakit };
    if (dengeleyen && dengeleyen !== 'NAKIT') {
      const digerleri = YONTEMLER.filter((y) => y.tip !== dengeleyen).reduce((t, y) => t + yeniTutarlar[y.tip], 0);
      yeniTutarlar[dengeleyen] = Math.max(0, genelToplam - digerleri);
    } else if (dengeleyen === 'NAKIT') {
      setDengeleyen(null);
    }
    setTutarlar(yeniTutarlar);
  };

  const tumunuVer = (tip: OdemeTipi) => {
    setTutarlar({ NAKIT: 0, KART: 0, VERESIYE: 0, [tip]: genelToplam });
    setAlinanNakit(tip === 'NAKIT' ? genelToplam : 0);
    setDengeleyen(tip);
    setNakitHedef(null);
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
  /*
   * FATURA SINIRI: satış sınıra ulaştıysa fiş yetmez. Pavo varsa alıcı
   * girilmeden satış tamamlanmaz (kasa da reddeder); yoksa kasiyer faturayı
   * başka yoldan keseceğini onaylar.
   */
  const faturaGerekli = Boolean(faturaSiniri && genelToplam >= faturaSiniri.tutar && !fatura);
  const [faturaDisaridaOnay, setFaturaDisaridaOnay] = useState(false);
  useEffect(() => {
    if (acik) setFaturaDisaridaOnay(false);
  }, [acik]);
  const faturaEngeli = faturaGerekli && (faturaKullanilabilir || !faturaDisaridaOnay);
  const musteriEksik = tutarlar.VERESIYE > 0 && !musteriId;
  const gonderilebilir = dogrulama.gecerli && !musteriEksik && !islemde && genelToplam > 0 && !faturaEngeli;
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
          {/*
            Fiş kararı GÖRÜNÜR ve dokunulabilir: eskiden yalnız F4/F5 tuşuyla
            seçiliyordu, dokunmatik kasada ÖDEME düğmesiyle fiş hiç çıkmıyordu.
          */}
          <button
            type="button"
            className={`${fisYazdir ? 'tus-birincil' : 'tus-ikincil'} mr-auto`}
            onClick={() => onFisDegis(!fisYazdir)}
            aria-pressed={fisYazdir}
            title="Bu satışın fişi basılsın mı?"
          >
            🧾 {fisYazdir ? 'Fiş yazdırılacak' : 'Fiş yok'}
          </button>
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
        ref={kokRef}
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

        {/*
          Müşteriden alınan nakit EN ÜSTTE: kasiyerin her nakit satışta
          dokunduğu alan. Eskiden yöntem satırlarının altında kalıyor, küçük
          ekranda aşağı kaydırmadan görünmüyordu.
        */}
        {tutarlar.NAKIT > 0 && (
          <div className="mb-3 space-y-2 rounded-lg border border-cizgi p-3">
            <div className="flex items-end gap-3">
              <label className="flex-1" data-alinan-nakit>
                <span className="etiket">Müşteriden alınan nakit</span>
                <ParaAlani
                  deger={alinanNakit}
                  onDegisim={alinanDegisti}
                  etiket="Müşteriden alınan nakit"
                  sinif="py-3 text-2xl font-semibold"
                />
              </label>
              <div className="flex-1 text-right">
                <p className="text-xs text-metin-3">Para üstü</p>
                <p className="font-mono text-3xl font-bold text-uyari">{paraFormat(paraUstu)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {nakitOnerileri(nakitHedef ?? tutarlar.NAKIT).map((oneri) => (
                <button
                  key={oneri}
                  type="button"
                  className="tus-ikincil px-4 py-2 text-base"
                  onClick={() => alinanDegisti(oneri)}
                >
                  {paraFormat(oneri, { simge: false })}
                </button>
              ))}
            </div>
            {nakitHedef !== null && tutarlar.NAKIT < nakitHedef && (
              <p className="text-sm text-uyari">
                Müşteri {paraFormat(tutarlar.NAKIT)} verdi; {paraFormat(nakitHedef - tutarlar.NAKIT)} eksik. Eksiği aşağıdaki sarı
                düğmeyle borca yazın ya da “Kart” satırında “Kalanı”na basın.
              </p>
            )}
          </div>
        )}

        {faturaGerekli && faturaSiniri && (
          <div className="mb-3 rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak p-3 text-sm">
            <p className="font-semibold text-tehlike">Fatura zorunlu</p>
            <p className="mt-0.5 text-metin-2">
              Bu satış {paraFormat(genelToplam)} — {faturaSiniri.yil} fatura düzenleme sınırı {paraFormat(faturaSiniri.tutar)}{' '}
              (VUK 232, Resmi Gazete). Bu tutarda yazarkasa fişi yetmez; müşteri adına fatura kesilmelidir. Satışı bölmek
              zorunluluğu kaldırmaz.
            </p>
            {faturaKullanilabilir ? (
              <button type="button" className="tus-birincil mt-2 py-2 text-sm" onClick={onFaturaSec}>
                📄 Fatura bilgisi gir
              </button>
            ) : (
              <label className="mt-2 flex items-start gap-2 text-metin-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={faturaDisaridaOnay}
                  onChange={(e) => setFaturaDisaridaOnay(e.target.checked)}
                />
                Pavo tanımlı değil. Faturayı başka yoldan (e-Arşiv portalı / muhasebe) keseceğim.
              </label>
            )}
          </div>
        )}

        {/* Faturalı satış: alıcı seçiliyse belgeyi cihaz e-Arşiv / e-Fatura olarak keser. */}
        {fatura ? (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-bilgi-cizgi bg-bilgi-yumusak px-3 py-2 text-sm">
            <span aria-hidden="true">📄</span>
            <span className="min-w-0 flex-1 truncate">
              <b>Faturalı satış:</b> {faturaAlicisiAdi(fatura)}{' '}
              <span className="font-mono text-xs text-metin-3">({fatura.kimlikNo})</span>
            </span>
            <button type="button" className="text-vurgu hover:underline" onClick={onFaturaSec}>
              Değiştir
            </button>
            <button
              type="button"
              className="px-1 text-metin-3 hover:text-tehlike"
              onClick={onFaturaKaldir}
              aria-label="Faturayı kaldır"
            >
              ✕
            </button>
          </div>
        ) : faturaKullanilabilir ? (
          <button
            type="button"
            className="tus-ikincil mb-3 w-full justify-start py-2 text-sm"
            onClick={onFaturaSec}
            title="Müşteri fatura istiyorsa: vergi no / TC kimlik no ile e-Arşiv ya da e-Fatura"
          >
            📄 Fatura iste (e-Arşiv / e-Fatura)
          </button>
        ) : null}

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

        <div className="space-y-2" ref={yontemAlanlari}>
          {YONTEMLER.map((y) => (
            <div key={y.tip} className="flex items-center gap-2" data-yontem={y.tip}>
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
          Parçalı ödeme: verilen nakit ya da kart tutarını yazın, kalanı için ilgili satırın “Kalanı”na basın. Yöntem adına basmak
          tüm tutarı o yönteme verir.
        </p>

        {/* "Yarısını şimdi, yarısını sonra": kalanı tek tıkla müşterinin borcuna. */}
        {kalan > 0 && (
          <button
            type="button"
            className="mt-2 flex w-full items-center justify-between rounded-lg border border-uyari-cizgi bg-uyari-yumusak px-4 py-2.5 text-left text-sm hover:brightness-95"
            onClick={() => (musteriId ? kalaniVer('VERESIYE') : onMusteriSec())}
          >
            <span>
              📒 Kalan <b>{paraFormat(kalan)}</b> müşterinin borcuna yazılsın (sonra ödeyecek)
            </span>
            <span className="text-xs text-metin-3">{musteriId ? musteriAdi : 'müşteri seç → F1'}</span>
          </button>
        )}

        {/* Kalan / fazla göstergesi */}
        <div className="mt-3 flex items-baseline justify-between rounded bg-yuzey-3 px-4 py-2.5">
          <span className="text-metin-2">{kalan >= 0 ? 'Kalan' : 'Fazla girilen'}</span>
          <span className={`font-mono text-xl font-bold ${kalan === 0 ? 'text-vurgu' : 'text-uyari'}`}>
            {paraFormat(Math.abs(kalan))}
          </span>
        </div>

        {tutarlar.KART > 0 && (
          <div className="mt-3 rounded border border-bilgi-cizgi bg-bilgi-yumusak p-3 text-sm text-bilgi">
            {posAktif ? (
              <>
                Kart tutarı <strong>{paraFormat(tutarlar.KART)}</strong> Tamamla'ya basınca POS cihazına gönderilir; müşteri
                kartını cihaza okutsun. Cihaz onaylamadan satış kaydedilmez.
              </>
            ) : (
              <>
                Kart tutarı <strong>{paraFormat(tutarlar.KART)}</strong> manuel işaretlenir: POS cihazına elle girip tahsilatı
                tamamlayın (POS entegrasyonu kapalı).
              </>
            )}
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
