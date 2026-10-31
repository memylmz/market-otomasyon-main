/**
 * Kampanyalar — kasada indirim kuralı tanımlama/düzenleme (§11.8).
 *
 * Panelin Kampanyalar ekranının kasadaki karşılığı; kurallar ve form aynıdır.
 * Kaydedilen kampanya hemen bu kasada geçerli olur, senkronla buluta ve diğer
 * kasalara gider. Silme yoktur: "Kampanya aktif" işareti kaldırılır.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { paraFormat, paraParse, tarihFormat, type KampanyaKapsami, type KampanyaTipi, type Kurus } from '@market/shared';
import { Alan, BosDurum, Diyalog, Rozet, Yukleniyor } from '../bilesen/temel';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { onayla } from '../durum/onay';
import { useYetki } from '../durum/oturum';
import { cagir } from '../kopru';

interface Kampanya {
  id: string;
  ad: string;
  tip: KampanyaTipi;
  kapsam: KampanyaKapsami;
  hedef_id: string | null;
  /** YUZDE → yüzde (0-100) · N_AL_M_ODE → ödenen adet · diğerlerinde kuruş. */
  deger: number;
  /** Miktar kampanyalarının eşiği, bindebir (3 adet → 3000). */
  esik_miktar: number | null;
  baslangic: string;
  bitis: string;
  oncelik: number;
  aktif_mi: boolean;
}

interface Kategori {
  id: string;
  ad: string;
}

interface Urun {
  id: string;
  ad: string;
  satis_fiyati: Kurus;
  /** KDV hariç. */
  alis_fiyati: Kurus;
  kdv_orani: number;
  kategori_id: string | null;
}

const TIP_SECENEKLERI: { deger: KampanyaTipi; etiket: string }[] = [
  { deger: 'YUZDE', etiket: 'Yüzde indirim' },
  { deger: 'TUTAR', etiket: 'Tutar indirimi' },
  { deger: 'SABIT_FIYAT', etiket: 'Sabit fiyat' },
  { deger: 'N_AL_M_ODE', etiket: 'N al M öde (3 al 2 öde)' },
  { deger: 'KADEMELI_FIYAT', etiket: 'Kademeli fiyat (3 üzeri ucuz)' },
];

const KAPSAM_SECENEKLERI: { deger: KampanyaKapsami; etiket: string }[] = [
  { deger: 'TUM', etiket: 'Tüm ürünler' },
  { deger: 'KATEGORI', etiket: 'Bir kategori' },
  { deger: 'URUN', etiket: 'Tek ürün' },
];

function paraliTipMi(tip: KampanyaTipi): boolean {
  return tip !== 'YUZDE' && tip !== 'N_AL_M_ODE';
}

/** "3 al 2 öde"deki 3, "3 kg üzeri"ndeki 3. */
function esikIsteyenTip(tip: KampanyaTipi): boolean {
  return tip === 'N_AL_M_ODE' || tip === 'KADEMELI_FIYAT';
}

function degerMetni(tip: KampanyaTipi, deger: number, esikMiktar: number | null): string {
  const esik = (esikMiktar ?? 0) / 1000;
  switch (tip) {
    case 'YUZDE':
      return `%${deger} indirim`;
    case 'TUTAR':
      return `${paraFormat(deger)} indirim`;
    case 'SABIT_FIYAT':
      return `Sabit ${paraFormat(deger)}`;
    case 'N_AL_M_ODE':
      return `${esik} al ${deger} öde`;
    case 'KADEMELI_FIYAT':
      return `${esik} ve üzeri ${paraFormat(deger)}`;
  }
}

/** Aktif işaretli ama tarihi geçmiş kampanya kasada uygulanmaz; bayrak ile takvim birlikte okunur. */
function durumBul(k: Kampanya, simdiMs: number): { tur: 'basari' | 'bilgi' | 'notr'; etiket: string; sira: number } {
  if (!k.aktif_mi) return { tur: 'notr', etiket: 'Pasif', sira: 2 };
  if (Date.parse(k.bitis) < simdiMs) return { tur: 'notr', etiket: 'Sona erdi', sira: 3 };
  if (Date.parse(k.baslangic) > simdiMs) return { tur: 'bilgi', etiket: 'Planlandı', sira: 1 };
  return { tur: 'basari', etiket: 'Yürürlükte', sira: 0 };
}

function gunAnahtari(t: Date): string {
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/** Gün alanı yerel saatten kurulur; UTC'ye çevirmek 00:00+03:00'ı önceki güne kaydırırdı. */
function isoyuGune(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : gunAnahtari(t);
}

/** Bitiş günü sonuna çekilir ki tek günlük kampanya da geçerli olsun. */
function gunuIsoyaCevir(gun: string, uc: 'baslangic' | 'bitis'): string {
  return new Date(`${gun}T${uc === 'bitis' ? '23:59:59' : '00:00:00'}`).toISOString();
}

export function KampanyalarSayfasi() {
  const yonetebilir = useYetki('kampanya.yonet');
  const [kampanyalar, setKampanyalar] = useState<Kampanya[]>([]);
  const [kategoriler, setKategoriler] = useState<Kategori[]>([]);
  const [urunler, setUrunler] = useState<Urun[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [duzenlenen, setDuzenlenen] = useState<Kampanya | 'yeni' | null>(null);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      const [k, kat, u] = await Promise.all([
        cagir<Kampanya[]>('kampanya.listele'),
        cagir<Kategori[]>('kategori.listele'),
        cagir<{ kayitlar: Urun[] }>('urun.listele', { filtre: { sadeceAktif: true, siralama: 'ad' }, limit: 2000 }),
      ]);
      setKampanyalar(k);
      setKategoriler(kat);
      setUrunler(u.kayitlar);
    } catch (hata) {
      hatayiBildir(hata, 'Kampanyalar');
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  const kategoriAdlari = useMemo(() => new Map(kategoriler.map((k): [string, string] => [k.id, k.ad])), [kategoriler]);
  const urunAdlari = useMemo(() => new Map(urunler.map((u): [string, string] => [u.id, u.ad])), [urunler]);

  const satirlar = useMemo(() => {
    const simdiMs = Date.now();
    return kampanyalar
      .map((kampanya) => ({ kampanya, durum: durumBul(kampanya, simdiMs) }))
      .sort((a, b) => a.durum.sira - b.durum.sira || b.kampanya.oncelik - a.kampanya.oncelik);
  }, [kampanyalar]);

  const kapsamMetni = (k: Kampanya): string => {
    if (k.kapsam === 'TUM') return 'Tüm ürünler';
    if (!k.hedef_id) return 'Hedef seçilmemiş';
    if (k.kapsam === 'KATEGORI') return kategoriAdlari.get(k.hedef_id) ?? 'Kategori bulunamadı';
    return urunAdlari.get(k.hedef_id) ?? 'Ürün (listede yok)';
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <header className="flex items-center gap-2">
        <div>
          <h1 className="text-lg font-semibold">Kampanyalar</h1>
          <p className="text-sm text-metin-3">İndirim kuralları — satış ekranında kendiliğinden uygulanır.</p>
        </div>
        {yonetebilir && (
          <button type="button" className="tus-birincil ml-auto" onClick={() => setDuzenlenen('yeni')}>
            Yeni Kampanya
          </button>
        )}
      </header>

      <div className="kart min-h-0 flex-1 overflow-auto">
        {yukleniyor && kampanyalar.length === 0 ? (
          <Yukleniyor />
        ) : satirlar.length === 0 ? (
          <BosDurum
            baslik="Henüz kampanya yok"
            aciklama="Yeni Kampanya ile bir indirim kuralı oluşturun; bu kasada hemen, senkron sonrası diğer kasalarda geçerli olur."
          />
        ) : (
          <table className="tablo">
            <thead className="sticky top-0 bg-yuzey">
              <tr>
                <th>Kampanya</th>
                <th>İndirim</th>
                <th>Kapsam</th>
                <th>Tarih aralığı</th>
                <th className="text-right">Öncelik</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {satirlar.map(({ kampanya, durum }) => (
                <tr
                  key={kampanya.id}
                  className={yonetebilir ? 'cursor-pointer' : ''}
                  onClick={() => yonetebilir && setDuzenlenen(kampanya)}
                >
                  <td className="font-medium">{kampanya.ad}</td>
                  <td className="whitespace-nowrap">{degerMetni(kampanya.tip, kampanya.deger, kampanya.esik_miktar)}</td>
                  <td className="text-metin-2">{kapsamMetni(kampanya)}</td>
                  <td className="whitespace-nowrap text-metin-3">
                    {tarihFormat(kampanya.baslangic)} – {tarihFormat(kampanya.bitis)}
                  </td>
                  <td className="sayi text-right text-metin-3">{kampanya.oncelik}</td>
                  <td>
                    <Rozet tur={durum.tur}>{durum.etiket}</Rozet>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-metin-4">
        Aynı ürüne birden çok kampanya uyarsa müşteri lehine en düşük fiyat uygulanır; fiyatlar eşitse önceliği yüksek olan
        kazanır. Panelden yapılan değişiklikler de senkronla buraya iner.
      </p>

      {duzenlenen && (
        <KampanyaFormu
          kampanya={duzenlenen}
          kategoriler={kategoriler}
          urunler={urunler}
          onKapat={() => setDuzenlenen(null)}
          onKaydedildi={() => {
            setDuzenlenen(null);
            void yukle();
          }}
        />
      )}
    </div>
  );
}

function KampanyaFormu({
  kampanya,
  kategoriler,
  urunler,
  onKapat,
  onKaydedildi,
}: {
  kampanya: Kampanya | 'yeni';
  kategoriler: Kategori[];
  urunler: Urun[];
  onKapat: () => void;
  onKaydedildi: () => void;
}) {
  const mevcut = kampanya === 'yeni' ? null : kampanya;

  const [ad, setAd] = useState(mevcut?.ad ?? '');
  const [tip, setTip] = useState<KampanyaTipi>(mevcut?.tip ?? 'YUZDE');
  const [kapsam, setKapsam] = useState<KampanyaKapsami>(mevcut?.kapsam ?? 'TUM');
  const [hedefId, setHedefId] = useState<string | null>(mevcut?.hedef_id ?? null);
  const [deger, setDeger] = useState(() => {
    if (!mevcut) return '';
    return paraliTipMi(mevcut.tip) ? paraFormat(mevcut.deger, { simge: false }) : String(mevcut.deger);
  });
  const [baslangic, setBaslangic] = useState(() => (mevcut ? isoyuGune(mevcut.baslangic) : gunAnahtari(new Date())));
  const [bitis, setBitis] = useState(() =>
    mevcut ? isoyuGune(mevcut.bitis) : gunAnahtari(new Date(Date.now() + 7 * 86_400_000)),
  );
  const [esikAdet, setEsikAdet] = useState(() => (mevcut?.esik_miktar ? String(mevcut.esik_miktar / 1000) : ''));
  const [oncelik, setOncelik] = useState(String(mevcut?.oncelik ?? 0));
  const [aktif, setAktif] = useState(mevcut ? mevcut.aktif_mi : true);
  const [urunArama, setUrunArama] = useState('');
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const [secilen, setSecilen] = useState<Urun | null>(null);
  const seciliUrun = secilen ?? urunler.find((u) => u.id === hedefId) ?? null;
  /*
   * Arama ana süreçte yapılır: sayfaya yüklenen liste en fazla 500 ürün; büyük
   * katalogda aranan ürün o listede olmayabilir.
   */
  const [aramaSonucu, setAramaSonucu] = useState<Urun[] | null>(null);
  useEffect(() => {
    const anahtar = urunArama.trim();
    if (!anahtar) {
      setAramaSonucu(null);
      return;
    }
    let iptal = false;
    const zamanlayici = setTimeout(() => {
      cagir<{ kayitlar: Urun[] }>('urun.listele', { filtre: { arama: anahtar, sadeceAktif: true }, limit: 50 })
        .then((v) => !iptal && setAramaSonucu(v.kayitlar))
        .catch(() => !iptal && setAramaSonucu([]));
    }, 250);
    return () => {
      iptal = true;
      clearTimeout(zamanlayici);
    };
  }, [urunArama]);
  const suzulmusUrunler = aramaSonucu ?? urunler.slice(0, 50);

  const degerEtiketi =
    tip === 'YUZDE'
      ? 'İndirim yüzdesi (%)'
      : tip === 'TUTAR'
        ? 'İndirim tutarı (₺)'
        : tip === 'N_AL_M_ODE'
          ? 'Ödenen adet'
          : tip === 'KADEMELI_FIYAT'
            ? 'Eşik sonrası birim fiyat (₺)'
            : 'Sabit satış fiyatı (₺)';

  /** Yüzde ile kuruş farklı birimler; tip değişince değer sessizce anlam değiştirmesin. */
  const tipDegistir = (yeni: KampanyaTipi) => {
    if (paraliTipMi(yeni) !== paraliTipMi(tip)) setDeger('');
    if (!esikIsteyenTip(yeni)) setEsikAdet('');
    setTip(yeni);
  };

  const kapsamDegistir = (yeni: KampanyaKapsami) => {
    if (yeni !== kapsam) setHedefId(null);
    setKapsam(yeni);
  };

  const degerSayisi = (): number => {
    if (tip === 'N_AL_M_ODE') return Number.parseInt(deger.trim(), 10);
    if (tip === 'YUZDE') return Number(deger.trim().replace(',', '.'));
    return paraParse(deger) ?? Number.NaN;
  };
  const esikMiktar = (): number | null =>
    esikIsteyenTip(tip) ? Math.round(Number(esikAdet.trim().replace(',', '.')) * 1000) : null;

  /*
   * Bu kampanyayla ZARARINA satılacak ürünler; engellenmez, kaydetmeden önce
   * sorulur. Hesap ana süreçte TÜM katalog üzerinde yapılır (ekrana yüklenen
   * liste en fazla 500 ürün); yazarken her tuşta değil, kısa bir bekleyişle.
   */
  const [zarar, setZarar] = useState<{ adet: number; ornekler: { ad: string; zarar: Kurus }[] }>({ adet: 0, ornekler: [] });
  useEffect(() => {
    const d = degerSayisi();
    const esik = esikMiktar();
    if (deger.trim() === '' || !Number.isFinite(d) || (esik !== null && !(esik > 0)) || (kapsam !== 'TUM' && !hedefId)) {
      setZarar({ adet: 0, ornekler: [] });
      return;
    }
    let iptal = false;
    const zamanlayici = setTimeout(() => {
      cagir<{ adet: number; ornekler: { ad: string; zarar: Kurus }[] }>('kampanya.zararKontrol', {
        tip,
        deger: d,
        esik_miktar: esik,
        kapsam,
        hedef_id: kapsam === 'TUM' ? null : hedefId,
      })
        .then((z) => !iptal && setZarar(z))
        .catch(() => !iptal && setZarar({ adet: 0, ornekler: [] }));
    }, 300);
    return () => {
      iptal = true;
      clearTimeout(zamanlayici);
    };
    // degerSayisi/esikMiktar bu alanlardan türer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tip, deger, esikAdet, kapsam, hedefId]);

  const kaydet = async () => {
    if (!baslangic || !bitis) {
      setHata('Başlangıç ve bitiş tarihi zorunludur.');
      return;
    }
    const d = degerSayisi();
    if (deger.trim() === '' || !Number.isFinite(d)) {
      setHata(tip === 'N_AL_M_ODE' ? 'Ödenen adet girin.' : 'Geçerli bir değer girin.');
      return;
    }
    const oncelikSayisi = Number.parseInt(oncelik, 10);
    if (!Number.isFinite(oncelikSayisi)) {
      setHata('Öncelik bir tam sayı olmalıdır.');
      return;
    }
    if (
      zarar.adet > 0 &&
      !(await onayla(`Bu kampanyayla ${zarar.adet} ürün maliyetinin altında, ZARARINA satılacak. Yine de kaydedilsin mi?`, {
        baslik: 'Zararına satış',
        onaylaMetni: 'Yine de kaydet',
        tehlikeli: true,
      }))
    ) {
      return;
    }

    setGonderiliyor(true);
    setHata(null);
    try {
      // Kuralların asıl denetimi ana süreçte (zKampanyaGirdi); ilk sorun burada gösterilir.
      await cagir('kampanya.kaydet', {
        ...(mevcut ? { id: mevcut.id } : {}),
        ad: ad.trim(),
        tip,
        kapsam,
        hedef_id: kapsam === 'TUM' ? null : hedefId,
        deger: d,
        esik_miktar: esikMiktar(),
        baslangic: gunuIsoyaCevir(baslangic, 'baslangic'),
        bitis: gunuIsoyaCevir(bitis, 'bitis'),
        oncelik: oncelikSayisi,
        aktif_mi: aktif,
      });
      bildir.basari('Kampanya kaydedildi', 'Bu kasada hemen geçerli; senkronla diğer kasalara ve panele gider.');
      onKaydedildi();
    } catch (h) {
      setHata(h instanceof Error ? h.message : 'Kampanya kaydedilemedi.');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Diyalog
      acik
      baslik={mevcut ? 'Kampanyayı Düzenle' : 'Yeni Kampanya'}
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat} disabled={gonderiliyor}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={() => void kaydet()} disabled={gonderiliyor}>
            {gonderiliyor ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Alan etiket="Kampanya adı *">
          <input className="alan" value={ad} onChange={(e) => setAd(e.target.value)} maxLength={120} />
        </Alan>

        <div className="grid grid-cols-2 gap-3">
          <Alan etiket="İndirim tipi">
            <select className="alan" value={tip} onChange={(e) => tipDegistir(e.target.value as KampanyaTipi)}>
              {TIP_SECENEKLERI.map((s) => (
                <option key={s.deger} value={s.deger}>
                  {s.etiket}
                </option>
              ))}
            </select>
          </Alan>
          <Alan etiket={`${degerEtiketi} *`}>
            <input
              className="alan sayi"
              inputMode="decimal"
              value={deger}
              onChange={(e) => setDeger(e.target.value)}
              placeholder={tip === 'YUZDE' ? '10' : tip === 'N_AL_M_ODE' ? '2' : '19,90'}
            />
          </Alan>
        </div>

        {esikIsteyenTip(tip) && (
          <Alan
            etiket={tip === 'N_AL_M_ODE' ? 'Alınan adet *' : 'Eşik miktar *'}
            ipucu={
              tip === 'N_AL_M_ODE'
                ? '"3 al 2 öde" için 3 yazın. Yalnız adetli ürünlerde çalışır; 6 alan 2 bedava alır.'
                : 'Bu miktardan itibaren birim fiyat düşer; indirim tüm miktara uygulanır.'
            }
          >
            <input
              className="alan sayi"
              inputMode="decimal"
              value={esikAdet}
              onChange={(e) => setEsikAdet(e.target.value)}
              placeholder="3"
            />
          </Alan>
        )}

        <Alan etiket="Kapsam">
          <select className="alan" value={kapsam} onChange={(e) => kapsamDegistir(e.target.value as KampanyaKapsami)}>
            {KAPSAM_SECENEKLERI.map((s) => (
              <option key={s.deger} value={s.deger}>
                {s.etiket}
              </option>
            ))}
          </select>
        </Alan>

        {kapsam === 'KATEGORI' && (
          <Alan etiket="Kategori *">
            <select className="alan" value={hedefId ?? ''} onChange={(e) => setHedefId(e.target.value || null)}>
              <option value="">Kategori seçin…</option>
              {kategoriler.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.ad}
                </option>
              ))}
            </select>
          </Alan>
        )}

        {kapsam === 'URUN' && (
          // Liste düğmeleri içerdiği için <label> (Alan) değil: etiketin içindeki düğmeler geçersiz yapı.
          <div>
            <span className="etiket">{`Ürün *${seciliUrun ? ` — ${seciliUrun.ad}` : ''}`}</span>
            <input className="alan" value={urunArama} onChange={(e) => setUrunArama(e.target.value)} placeholder="Ürün ara…" />
            <ul className="mt-2 max-h-48 overflow-y-auto rounded border border-cizgi">
              {suzulmusUrunler.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setHedefId(u.id);
                      setSecilen(u);
                    }}
                    className={`flex w-full items-center justify-between gap-3 border-b border-cizgi px-3 py-2 text-left text-sm ${
                      hedefId === u.id ? 'bg-yuzey-4 font-medium text-vurgu' : 'text-metin-2 hover:bg-yuzey-2'
                    }`}
                  >
                    <span className="truncate">{u.ad}</span>
                    <span className="sayi shrink-0 text-xs text-metin-3">{paraFormat(u.satis_fiyati, { simge: false })}</span>
                  </button>
                </li>
              ))}
              {suzulmusUrunler.length === 0 && <li className="px-3 py-3 text-sm text-metin-4">Eşleşen ürün yok.</li>}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Alan etiket="Başlangıç *">
            <input type="date" className="alan" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} />
          </Alan>
          <Alan etiket="Bitiş *" ipucu="Bitiş günü sonuna (23:59) kadar geçerlidir.">
            <input type="date" className="alan" value={bitis} onChange={(e) => setBitis(e.target.value)} />
          </Alan>
        </div>

        <Alan etiket="Öncelik" ipucu="Fiyatlar eşit çıkarsa önceliği yüksek olan kampanya uygulanır.">
          <input className="alan sayi" inputMode="numeric" value={oncelik} onChange={(e) => setOncelik(e.target.value)} />
        </Alan>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={aktif} onChange={(e) => setAktif(e.target.checked)} />
          Kampanya aktif
        </label>

        {zarar.adet > 0 && (
          <div className="rounded border border-tehlike bg-tehlike-yumusak p-3 text-sm text-tehlike">
            <p className="font-semibold">⚠ Bu kampanyayla {zarar.adet} ürün maliyetinin altında, zararına satılır</p>
            <ul className="mt-2 space-y-0.5 text-xs">
              {zarar.ornekler.map((x) => (
                <li key={x.ad}>
                  {x.ad} — tanesinde {paraFormat(x.zarar)} zarar
                </li>
              ))}
              {zarar.adet > zarar.ornekler.length && <li>… ve {zarar.adet - zarar.ornekler.length} ürün daha</li>}
            </ul>
          </div>
        )}

        {hata && <p className="rounded border border-tehlike bg-tehlike-yumusak px-3 py-2 text-sm text-tehlike">{hata}</p>}
      </div>
    </Diyalog>
  );
}
