/**
 * Satış ekranının sağ sütunu: hızlı ürün ızgarası (§10.9).
 *
 * Barkodsuz sık satılan ürünler (manav, fırın, açık ürün) için dokunmatik kare
 * buton ızgarası. Eskiden ayrı bir sayfaydı; kasiyerin sepetle ızgara arasında
 * gidip gelmemesi için satış ekranının içine alındı.
 *
 * Arama kutusu YOKTUR: soldaki barkod alanına ürün adı yazmak zaten arama
 * yapıyor, ikinci bir arama alanı dar sütunda yer harcardı.
 *
 * KG/LT ürünlerde miktar elle sorulur (terazi entegrasyonu yoktur — §13.3).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  adet,
  miktarFormat,
  kisaKodBul,
  miktarOlustur,
  miktarParse,
  paraFormat,
  paraParse,
  type BirimTipi,
  type Kurus,
  type Miktar,
} from '@market/shared';
import { Alan, BosDurum, Diyalog, Yukleniyor } from './temel';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { kampanyaliFiyat, sepetDurumu } from '../durum/sepet';
import { cagir } from '../kopru';

interface Urun {
  id: string;
  ad: string;
  birim_tipi: BirimTipi;
  satis_fiyati: Kurus;
  kdv_orani: number;
  stok: Miktar;
  kategori_id: string | null;
  kategori_adi: string | null;
  barkodlar: string[];
}

/**
 * Kutucuk renkleri KATEGORİYE göredir, ürüne göre değil.
 *
 * Renk burada dekorasyon değil hafıza yardımıdır: kasiyer aynı kategorinin hep
 * aynı renkte olduğunu öğrenir ve ürünü okumadan bulur. Ürün başına dönen bir
 * palet ise tam tersini yapar — liste her filtrelendiğinde renkler kayar.
 *
 * Tonlar koyu (700/800) seçildi: parlak renkler saatlerce bakılan bir ekranda
 * yorar ve hepsi aynı anda "dikkat" diye bağırdığı için hiçbiri öne çıkmaz.
 */
const KATEGORI_RENKLERI = [
  'bg-emerald-800 hover:bg-emerald-700',
  'bg-sky-800 hover:bg-sky-700',
  'bg-amber-800 hover:bg-amber-700',
  'bg-violet-800 hover:bg-violet-700',
  'bg-rose-800 hover:bg-rose-700',
  'bg-teal-800 hover:bg-teal-700',
  'bg-indigo-800 hover:bg-indigo-700',
  'bg-orange-800 hover:bg-orange-700',
];

/** Kategorisiz ürünler nötr kalır; renk "kategorisi var" demektir. */
const KATEGORISIZ_RENK = 'bg-slate-700 hover:bg-slate-600';

/**
 * Kategori kimliğinden kararlı bir renk üretir.
 *
 * Sıra numarası KULLANILMAZ: filtre değiştiğinde ya da yeni ürün eklendiğinde
 * indeksler kayar ve aynı kategori başka renge geçerdi. Kimlikten türetilen
 * renk, katalog değişse de sabit kalır.
 */
function kategoriRengi(kategoriId: string | null): string {
  if (!kategoriId) return KATEGORISIZ_RENK;
  let toplam = 0;
  for (let i = 0; i < kategoriId.length; i++) toplam = (toplam * 31 + kategoriId.charCodeAt(i)) % 100_000;
  return KATEGORI_RENKLERI[toplam % KATEGORI_RENKLERI.length] as string;
}

export function HizliUrunIzgarasi({
  adetOneki,
  onCarpanTuketildi,
  onSepeteEklendi,
}: {
  /** Satış ekranında girilen "3×" çarpanı; kutucuğa basınca bu adet eklenir. */
  adetOneki: number | null;
  onCarpanTuketildi: () => void;
  /** Sepete eklendi — satış ekranı imleci barkod kutusuna geri alsın (§10.3). */
  onSepeteEklendi: () => void;
}) {
  const [urunler, setUrunler] = useState<Urun[]>([]);
  const [kategoriler, setKategoriler] = useState<{ id: string; ad: string }[]>([]);
  const [kategoriId, setKategoriId] = useState('');
  const [yukleniyor, setYukleniyor] = useState(true);
  const [miktarSorulan, setMiktarSorulan] = useState<Urun | null>(null);
  const [muhtelifAcik, setMuhtelifAcik] = useState(false);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      const veri = await cagir<{ kayitlar: Urun[] }>('urun.listele', {
        filtre: { kategoriId: kategoriId || undefined, sadeceAktif: true, siralama: 'ad' },
        limit: 60,
      });
      setUrunler(veri.kayitlar);
    } finally {
      setYukleniyor(false);
    }
  }, [kategoriId]);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  useEffect(() => {
    cagir<{ id: string; ad: string }[]>('kategori.listele')
      .then(setKategoriler)
      .catch(() => setKategoriler([]));
  }, []);

  const ekle = (urun: Urun, miktar: Miktar) => {
    onCarpanTuketildi();
    onSepeteEklendi();
    // Kampanya ORTAK yardımcıdan gelir; her giriş yolu aynı fiyatı üretsin.
    const { fiyat, kampanyaId } = kampanyaliFiyat(urun);
    sepetDurumu.getState().ekle(
      {
        urunId: urun.id,
        kategoriId: urun.kategori_id ?? null,
        ad: urun.ad,
        barkod: urun.barkodlar[0] ?? null,
        birimTipi: urun.birim_tipi,
        birimFiyat: fiyat,
        listeFiyati: urun.satis_fiyati,
        kdvOrani: urun.kdv_orani,
        kampanyaId,
        stok: urun.stok,
      },
      miktar,
    );
    bildir.basari(`${urun.ad} sepete eklendi`, `${miktarFormat(miktar, urun.birim_tipi)} · ${paraFormat(urun.satis_fiyati)}`);
  };

  const tikla = (urun: Urun) => {
    // Çarpan girilmişse miktar zaten belirlidir: KG/LT üründe de pencere
    // açmaya gerek yok, "3*" + kutucuk doğrudan 3 kg ekler (§10.3).
    if (adetOneki) {
      ekle(urun, miktarOlustur(adetOneki));
      return;
    }
    // Çarpan yoksa KG/LT'de miktar elle sorulur (terazi entegrasyonu yoktur).
    if (urun.birim_tipi !== 'ADET') setMiktarSorulan(urun);
    else ekle(urun, adet(1));
  };

  return (
    <aside className="flex w-[38rem] shrink-0 flex-col border-l border-cizgi bg-yuzey" aria-label="Hızlı ürünler">
      <div className="flex gap-1.5 overflow-x-auto border-b border-cizgi px-3 py-2.5">
        <button
          type="button"
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            kategoriId === '' ? 'bg-vurgu text-vurgu-uzeri' : 'bg-yuzey-2 text-metin-2 hover:bg-yuzey-4'
          }`}
          onClick={() => setKategoriId('')}
        >
          Tümü
        </button>
        {kategoriler.map((k) => (
          <button
            key={k.id}
            type="button"
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              kategoriId === k.id ? 'bg-vurgu text-vurgu-uzeri' : 'bg-yuzey-2 text-metin-2 hover:bg-yuzey-4'
            }`}
            onClick={() => setKategoriId(k.id)}
          >
            {k.ad}
          </button>
        ))}
      </div>

      <div className="border-b border-cizgi px-3 pb-3 pt-1">
        <button
          type="button"
          onClick={() => setMuhtelifAcik(true)}
          className="flex w-full items-center justify-between rounded-xl bg-slate-700 px-4 py-3 text-left shadow-sm transition-colors hover:bg-slate-600"
        >
          <span className="text-sm font-semibold text-white">MUHTELİF</span>
          <span className="text-[11px] text-white/70">barkodsuz · tutar gir</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2">
        {yukleniyor ? (
          <Yukleniyor />
        ) : urunler.length === 0 ? (
          <BosDurum baslik="Ürün yok" aciklama="Bu kategoride aktif ürün bulunmuyor." />
        ) : (
          <div className="grid grid-cols-4 gap-2.5">
            {urunler.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => tikla(u)}
                title={`${u.ad} · ${paraFormat(u.satis_fiyati)}`}
                className={`flex aspect-square flex-col justify-between rounded-xl p-3 text-left shadow-sm transition-all hover:shadow-md hover:brightness-110 ${kategoriRengi(u.kategori_id)}`}
              >
                <span className="flex items-start justify-between gap-1.5">
                  <span className="line-clamp-3 text-sm font-semibold leading-tight text-white">{u.ad}</span>
                  {/*
                    Kısa kod karede DURUR ki kasiyer zamanla ezberlesin ve
                    kareye tıklamak yerine kodu yazsın — el fareye hiç gitmez.
                  */}
                  {kisaKodBul(u.barkodlar) && (
                    <span className="shrink-0 rounded bg-black/25 px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">
                      {kisaKodBul(u.barkodlar)}
                    </span>
                  )}
                </span>
                <span>
                  {/*
                    Karede KAMPANYALI fiyat yazar. Liste fiyatı yazsaydı kasiyer
                    müşteriye yanlış fiyat söyler, kasada başka tutar çıkardı.
                  */}
                  <span className="block font-mono text-base font-bold text-white">
                    {paraFormat(kampanyaliFiyat(u).fiyat, { simge: false })}
                  </span>
                  {kampanyaliFiyat(u).kampanyaId && (
                    <span className="block font-mono text-[11px] leading-tight text-white/60 line-through">
                      {paraFormat(u.satis_fiyati, { simge: false })}
                    </span>
                  )}
                  <span className="block text-[11px] leading-tight text-white/75">
                    {u.birim_tipi === 'ADET' ? 'adet' : u.birim_tipi.toLowerCase()}
                    {u.stok <= 0 ? ' · stok yok' : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <MiktarDiyalogu
        urun={miktarSorulan}
        baslangicMiktar={adetOneki}
        onKapat={() => setMiktarSorulan(null)}
        onOnayla={(miktar) => {
          if (miktarSorulan) ekle(miktarSorulan, miktar);
          setMiktarSorulan(null);
        }}
      />

      <MuhtelifDiyalogu
        acik={muhtelifAcik}
        adetOneki={adetOneki}
        onKapat={() => setMuhtelifAcik(false)}
        onEklendi={() => {
          onCarpanTuketildi();
          onSepeteEklendi();
          setMuhtelifAcik(false);
        }}
      />
    </aside>
  );
}

function MiktarDiyalogu({
  urun,
  baslangicMiktar,
  onKapat,
  onOnayla,
}: {
  urun: Urun | null;
  /** Satış ekranındaki "3×" çarpanı — varsa miktar alanı bununla açılır. */
  baslangicMiktar: number | null;
  onKapat: () => void;
  onOnayla: (miktar: Miktar) => void;
}) {
  const [metin, setMetin] = useState('1');
  const [tutarMetni, setTutarMetni] = useState('');
  const alan = useRef<HTMLInputElement>(null);

  /*
   * Seçim, değer SIFIRLANDIKTAN SONRA yapılır.
   *
   * `autoFocus` alanı odaklayıp içeriği seçiyordu, ama hemen ardından bu efekt
   * değeri "1"e çekiyor ve React değeri değiştirince seçim kayboluyordu. İlk
   * açılışta fark edilmiyordu (değer zaten "1"di, değişiklik olmuyordu);
   * ikinci üründen itibaren kasiyerin yazdığı rakam 1'in yanına ekleniyordu.
   *
   * Gecikme Diyalog'un kendi odak zamanlayıcısından (10 ms) uzun tutulur;
   * aksi hâlde o odaklanma seçimi tekrar bozar.
   */
  useEffect(() => {
    if (!urun) return;
    setMetin(String(baslangicMiktar ?? 1));
    setTutarMetni('');
    const zamanlayici = setTimeout(() => {
      alan.current?.focus();
      alan.current?.select();
    }, 20);
    return () => clearTimeout(zamanlayici);
  }, [urun, baslangicMiktar]);

  if (!urun) return null;

  const miktar = miktarParse(metin) ?? 0;
  const tutar = Math.round((miktar * urun.satis_fiyati) / 1000);

  // "Tutardan miktara" hesabı (§13.3): müşteri "20 liralık ver" dediğinde.
  const tutardanMiktar = () => {
    const kurus = Math.round(Number(tutarMetni.replace(',', '.')) * 100);
    if (!Number.isFinite(kurus) || kurus <= 0 || urun.satis_fiyati <= 0) return;
    setMetin(String(Math.round((kurus / urun.satis_fiyati) * 1000) / 1000));
  };

  return (
    <Diyalog
      acik
      baslik={urun.ad}
      aciklama={`Birim fiyat: ${paraFormat(urun.satis_fiyati)} / ${urun.birim_tipi.toLowerCase()}`}
      genislik="dar"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={() => onOnayla(miktar)} disabled={miktar <= 0}>
            Sepete Ekle
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Alan etiket={`Miktar (${urun.birim_tipi.toLowerCase()})`}>
          <input
            ref={alan}
            className="alan sayi py-3 text-2xl"
            value={metin}
            onChange={(e) => setMetin(e.target.value)}
            /*
             * Odaklanınca içerik SEÇİLİR. Alan varsayılan miktarla dolu gelir
             * (çoğu satış 1 birimdir), ama farklı bir miktar girecek kasiyerin
             * önce onu silmesi gerekiyordu — tartılan üründe bu neredeyse her
             * seferinde oluyor. Seçili gelince üstüne yazmak yeterli.
             */
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && miktar > 0) onOnayla(miktar);
            }}
            data-odak
            autoFocus
          />
        </Alan>

        <div className="flex flex-wrap gap-2">
          {[0.25, 0.5, 1, 1.5, 2, 3, 5].map((d) => (
            <button key={d} type="button" className="tus-ikincil px-3 py-1 text-sm" onClick={() => setMetin(String(d))}>
              {d.toString().replace('.', ',')}
            </button>
          ))}
        </div>

        <Alan etiket="Tutardan miktara" ipucu='Müşteri "20 liralık ver" dediğinde tutarı yazıp hesaplatın.'>
          <div className="flex gap-2">
            <input
              className="alan sayi"
              placeholder="20,00"
              value={tutarMetni}
              onChange={(e) => setTutarMetni(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  tutardanMiktar();
                }
              }}
            />
            <button type="button" className="tus-ikincil" onClick={tutardanMiktar}>
              Hesapla
            </button>
          </div>
        </Alan>

        <div className="flex items-baseline justify-between rounded bg-yuzey-3 px-4 py-3">
          <span className="text-metin-2">Satır tutarı</span>
          <span className="font-mono text-2xl font-bold text-vurgu">{paraFormat(tutar)}</span>
        </div>
      </div>
    </Diyalog>
  );
}

/**
 * Muhtelif kalem: kataloğa girmeye değmeyen tek seferlik satış (poşet, gazete,
 * pil). Tutar ve serbest bir ad alınır; satır tek bir "Muhtelif" ürün kaydına
 * bağlanır ama fişte kasiyerin yazdığı ad görünür (§10.3).
 */
function MuhtelifDiyalogu({
  acik,
  adetOneki,
  onKapat,
  onEklendi,
}: {
  acik: boolean;
  adetOneki: number | null;
  onKapat: () => void;
  onEklendi: () => void;
}) {
  const [tutarMetni, setTutarMetni] = useState('');
  const [ad, setAd] = useState('');
  const [gonderiliyor, setGonderiliyor] = useState(false);

  useEffect(() => {
    if (acik) {
      setTutarMetni('');
      setAd('');
    }
  }, [acik]);

  if (!acik) return null;

  const tutar = paraParse(tutarMetni) ?? 0;

  const ekle = async () => {
    if (tutar <= 0) return;
    setGonderiliyor(true);
    try {
      // Muhtelif ürün kaydı ilk kullanımda ana süreçte oluşturulur.
      const muhtelif = await cagir<{ id: string; ad: string; kdvOrani: number }>('urun.muhtelif');
      const gorunenAd = ad.trim() || 'Muhtelif';
      sepetDurumu.getState().ekle(
        {
          urunId: muhtelif.id,
          ad: gorunenAd,
          barkod: null,
          birimTipi: 'ADET',
          birimFiyat: tutar,
          listeFiyati: tutar,
          kdvOrani: muhtelif.kdvOrani,
          kampanyaId: null,
          // Stok takibi yoktur; negatif stok uyarısı çıkmasın diye yüksek tutulur.
          stok: adet(9999),
          ozelAd: gorunenAd,
        },
        adet(adetOneki ?? 1),
      );
      bildir.basari(`${gorunenAd} sepete eklendi`, paraFormat(tutar));
      onEklendi();
    } catch (hata) {
      hatayiBildir(hata, 'Muhtelif kalem');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Diyalog
      acik
      baslik="Muhtelif Kalem"
      aciklama="Barkodsuz, kataloğa girmeyen tek seferlik satış."
      genislik="dar"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={() => void ekle()} disabled={tutar <= 0 || gonderiliyor}>
            Sepete Ekle
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Alan etiket="Tutar">
          <input
            className="alan sayi py-3 text-2xl"
            placeholder="25,00"
            value={tutarMetni}
            onChange={(e) => setTutarMetni(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tutar > 0) void ekle();
            }}
            data-odak
            autoFocus
          />
        </Alan>

        <Alan etiket="Açıklama" ipucu="Fişte ve raporda bu ad görünür. Boş bırakılırsa 'Muhtelif' yazar.">
          <input
            className="alan"
            placeholder="Poşet, gazete, pil…"
            value={ad}
            onChange={(e) => setAd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tutar > 0) void ekle();
            }}
          />
        </Alan>

        {adetOneki && (
          <p className="text-xs text-metin-3">
            Çarpan etkin: <strong>{adetOneki} adet</strong> eklenecek.
          </p>
        )}
      </div>
    </Diyalog>
  );
}
