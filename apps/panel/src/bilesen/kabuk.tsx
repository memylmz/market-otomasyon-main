/** Panel kabuğu: mobil-öncelikli alt gezinme + üst başlık + ortak bileşenler (§11). */

'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { goreliZaman, paraFormat, type Kurus } from '@market/shared';
import { cikisYap, kullaniciyiOku, type PanelKullanicisi } from '@/lib/api';

interface MenuOgesi {
  yol: string;
  etiket: string;
  ikon: string;
  /** Yalnız bu rollerde görünür; boşsa herkese açık. */
  roller?: string[];
}

const MENU: MenuOgesi[] = [
  /*
   * Etiketler kasadaki menüyle BİREBİR aynıdır (§11.1).
   *
   * Eskiden aynı ekran iki üründe farklı adlanıyordu — kasada "Ürünler",
   * panelde "Ürün"; kasada "Cari Hesap", panelde "Cari". Kullanıcı iki ürün
   * arasında geçerken aynı şeyin farklı ad taşıması, farklı şey sanılmasına
   * yol açar. Yalnız panele özgü olanlar (Özet, Kampanya, Personel) farklıdır.
   */
  { yol: '/', etiket: 'Özet', ikon: '📊' },
  { yol: '/satislar', etiket: 'Satış', ikon: '🧾' },
  { yol: '/urunler', etiket: 'Ürünler', ikon: '📦' },
  { yol: '/stok', etiket: 'Stok', ikon: '🏷️' },
  { yol: '/cari', etiket: 'Cari Hesap', ikon: '📒' },
  // Alış Faturaları menüden kaldırıldı — artık Stok sayfasının "Alış" sekmesi
  // (madde 4 taşıması, bkz. `app/stok/page.tsx`). Erişim kitlesi (ADMIN,
  // MUDUR) sekme görünürlüğünde aynen korunur.
  { yol: '/raporlar', etiket: 'Raporlar', ikon: '📊' },
  { yol: '/kampanyalar', etiket: 'Kampanya', ikon: '🎯' },
  { yol: '/kullanicilar', etiket: 'Personel', ikon: '👤', roller: ['ADMIN'] },
  { yol: '/ayarlar', etiket: 'Ayarlar', ikon: '⚙️' },
];

/** Mobil alt çubukta doğrudan görünenler; kalanı "Daha" sayfasına düşer. */
const MOBIL_BIRINCIL = ['/', '/satislar', '/urunler', '/cari'];

export function Kabuk({ children, baslik, tazelik }: { children: ReactNode; baslik: string; tazelik?: string | null }) {
  const yol = usePathname();
  const yonlendir = useRouter();
  const [kullanici, setKullanici] = useState<PanelKullanicisi | null>(null);
  const [dahaAcik, setDahaAcik] = useState(false);

  useEffect(() => {
    const k = kullaniciyiOku();
    if (!k) yonlendir.replace('/giris');
    else setKullanici(k);
  }, [yonlendir]);

  // Sayfa değişince "Daha" çekmecesi kapanır.
  useEffect(() => setDahaAcik(false), [yol]);

  if (!kullanici) return null;

  const gorunenMenu = MENU.filter((o) => !o.roller || o.roller.includes(kullanici.rol));
  const mobilMenu = gorunenMenu.filter((o) => MOBIL_BIRINCIL.includes(o.yol));
  const dahaMenu = gorunenMenu.filter((o) => !MOBIL_BIRINCIL.includes(o.yol));

  return (
    <div className="flex min-h-screen flex-col pb-16 lg:pb-0">
      <header className="sticky top-0 z-20 border-b border-cizgi bg-zemin/95 backdrop-blur">
        <div className="flex w-full items-center gap-3 px-4 py-3 lg:px-6">
          <h1 className="text-lg font-semibold">{baslik}</h1>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <TemaDugmesi />
            <span className="hidden text-metin-3 sm:inline">{kullanici.ad}</span>
            <button
              type="button"
              className="text-metin-3 hover:text-metin"
              onClick={async () => {
                await cikisYap();
                yonlendir.replace('/giris');
              }}
            >
              Çıkış
            </button>
          </div>
        </div>
        {/* Panel verisi senkron anına aittir; tazelik her sayfada gösterilir (§11). */}
        {tazelik && (
          <p className="border-t border-cizgi-ince bg-yuzey-2/60 px-4 py-1 text-center text-xs text-metin-3">
            Veriler son güncelleme: {goreliZaman(tazelik)}
          </p>
        )}
      </header>

      {/*
        Geniş ekranda yan menü.

        Gövde EKRANIN TAMAMINI kullanır. Eskiden 1152 pikselle sınırlıydı ve
        büyük bir monitörde sayfanın iki yanı boş kalırken tablolar sıkışıyordu;
        rapor ve ekstre tabloları asıl geniş ekranda okunaklı olmalı. Kasa
        uygulaması da pencerenin tamamını kullanır — iki ürün aynı sistemdir.
      */}
      <div className="flex w-full flex-1 gap-6 px-4 py-4 lg:px-6">
        <nav className="hidden w-44 shrink-0 lg:block" aria-label="Ana menü">
          <ul className="space-y-1">
            {gorunenMenu.map((oge) => (
              <li key={oge.yol}>
                <Link
                  href={oge.yol}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                    yol === oge.yol ? 'bg-vurgu-yumusak font-medium text-vurgu' : 'text-metin-2 hover:bg-yuzey-2'
                  }`}
                >
                  <span aria-hidden="true">{oge.ikon}</span>
                  {oge.etiket}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      {/* Mobilde alt gezinme çubuğu — başparmakla erişilebilir */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-cizgi bg-yuzey lg:hidden"
        aria-label="Alt menü"
      >
        {mobilMenu.map((oge) => (
          <Link
            key={oge.yol}
            href={oge.yol}
            className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${yol === oge.yol ? 'text-vurgu' : 'text-metin-3'}`}
          >
            <span aria-hidden="true" className="text-lg">
              {oge.ikon}
            </span>
            {oge.etiket}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setDahaAcik((a) => !a)}
          className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${
            dahaMenu.some((o) => o.yol === yol) ? 'text-vurgu' : 'text-metin-3'
          }`}
          aria-expanded={dahaAcik}
        >
          <span aria-hidden="true" className="text-lg">
            ☰
          </span>
          Daha
        </button>
      </nav>

      {/* "Daha" çekmecesi — alt çubuğa sığmayan sayfalar */}
      {dahaAcik && (
        <div className="fixed inset-0 z-30 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-ortu/50"
            aria-label="Menüyü kapat"
            onClick={() => setDahaAcik(false)}
          />
          <div className="absolute inset-x-0 bottom-16 border-t border-cizgi bg-yuzey p-2">
            <ul className="grid grid-cols-3 gap-2">
              {dahaMenu.map((oge) => (
                <li key={oge.yol}>
                  <Link
                    href={oge.yol}
                    className={`flex flex-col items-center gap-1 rounded-lg px-2 py-3 text-xs ${
                      yol === oge.yol ? 'bg-vurgu-yumusak text-vurgu' : 'bg-yuzey-2 text-metin-2'
                    }`}
                  >
                    <span aria-hidden="true" className="text-xl">
                      {oge.ikon}
                    </span>
                    {oge.etiket}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/** Açık/koyu tema anahtarı — kasadaki Ayarlar → Görünüm ile aynı işlev. */
function TemaDugmesi() {
  const [koyu, setKoyu] = useState(false);

  useEffect(() => {
    setKoyu(document.documentElement.getAttribute('data-tema') === 'koyu');
  }, []);

  const degistir = () => {
    const yeni = !koyu;
    setKoyu(yeni);
    if (yeni) document.documentElement.setAttribute('data-tema', 'koyu');
    else document.documentElement.removeAttribute('data-tema');
    try {
      localStorage.setItem('market.tema', yeni ? 'koyu' : 'acik');
    } catch {
      /* özel sekmede yazılamayabilir; tema yine de bu oturumda geçerli */
    }
  };

  return (
    <button
      type="button"
      onClick={degistir}
      className="rounded-lg border border-cizgi-kuvvetli px-2 py-1 text-metin-3 hover:bg-yuzey-2"
      aria-label={koyu ? 'Açık temaya geç' : 'Koyu temaya geç'}
      title={koyu ? 'Açık tema' : 'Koyu tema'}
    >
      {koyu ? '☀️' : '🌙'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Ortak görünüm bileşenleri
// ---------------------------------------------------------------------------

export function Kutu({
  etiket,
  deger,
  alt,
  vurgulu,
  uyari,
}: {
  etiket: string;
  deger: string;
  alt?: string;
  vurgulu?: boolean;
  uyari?: boolean;
}) {
  return (
    <div className="kart p-4">
      <p className="text-xs text-metin-3">{etiket}</p>
      <p className={`mt-1 font-mono text-xl font-bold sm:text-2xl ${uyari ? 'text-uyari' : vurgulu ? 'text-vurgu' : ''}`}>
        {deger}
      </p>
      {alt && <p className="mt-0.5 text-xs text-metin-4">{alt}</p>}
    </div>
  );
}

export function ParaKutusu({ etiket, tutar, alt, vurgulu }: { etiket: string; tutar: Kurus; alt?: string; vurgulu?: boolean }) {
  return <Kutu etiket={etiket} deger={paraFormat(tutar)} alt={alt} vurgulu={vurgulu} />;
}

export function Yukleniyor() {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-metin-3">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-cizgi-kuvvetli border-t-vurgu" aria-hidden="true" />
      Yükleniyor…
    </div>
  );
}

export function HataKutusu({ mesaj, tekrarDene }: { mesaj: string; tekrarDene?: () => void }) {
  return (
    <div className="kart border-tehlike-cizgi bg-tehlike-yumusak p-4 text-sm text-metin">
      <p>{mesaj}</p>
      {tekrarDene && (
        <button type="button" className="tus-ikincil mt-3" onClick={tekrarDene}>
          Tekrar Dene
        </button>
      )}
    </div>
  );
}

export function BosDurum({ baslik, aciklama }: { baslik: string; aciklama?: string }) {
  return (
    <div className="py-10 text-center">
      <p className="font-medium text-metin-2">{baslik}</p>
      {aciklama && <p className="mx-auto mt-1 max-w-md text-sm text-metin-4">{aciklama}</p>}
    </div>
  );
}

/** Renk körü dostu rozet: renge ek olarak ikon taşır (§3.9). */
export function Rozet({ tur, children }: { tur: 'basari' | 'uyari' | 'tehlike' | 'notr' | 'bilgi'; children: ReactNode }) {
  const sinif =
    tur === 'basari'
      ? 'bg-vurgu-yumusak text-vurgu border-vurgu'
      : tur === 'uyari'
        ? 'bg-uyari-yumusak text-uyari border-uyari-cizgi'
        : tur === 'tehlike'
          ? 'bg-tehlike-yumusak text-tehlike border-tehlike-cizgi'
          : tur === 'bilgi'
            ? 'bg-bilgi-yumusak text-bilgi border-bilgi-cizgi'
            : 'bg-yuzey-2 text-metin-2 border-cizgi-kuvvetli';
  const ikon = tur === 'basari' ? '✓' : tur === 'uyari' ? '!' : tur === 'tehlike' ? '✕' : tur === 'bilgi' ? 'i' : '·';
  return (
    <span className={`rozet ${sinif}`}>
      <span aria-hidden="true">{ikon}</span>
      {children}
    </span>
  );
}

/** Mobilde alttan açılan, geniş ekranda ortalanan diyalog. */
export function Modal({
  baslik,
  children,
  onKapat,
  genis,
  altBilgi,
}: {
  baslik: string;
  children: ReactNode;
  onKapat: () => void;
  genis?: boolean;
  altBilgi?: ReactNode;
}) {
  useEffect(() => {
    const dinleyici = (olay: KeyboardEvent) => {
      if (olay.key === 'Escape') onKapat();
    };
    window.addEventListener('keydown', dinleyici);
    return () => window.removeEventListener('keydown', dinleyici);
  }, [onKapat]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ortu/50 sm:items-center" role="dialog" aria-modal="true">
      <div
        className={`kart max-h-[92vh] w-full overflow-y-auto rounded-b-none sm:rounded-b-xl ${genis ? 'max-w-3xl' : 'max-w-lg'}`}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-cizgi bg-yuzey px-4 py-3">
          <h2 className="font-semibold">{baslik}</h2>
          <button type="button" onClick={onKapat} className="text-metin-3 hover:text-metin" aria-label="Kapat">
            ✕
          </button>
        </header>
        <div className="p-4">{children}</div>
        {altBilgi && <footer className="sticky bottom-0 flex gap-2 border-t border-cizgi bg-yuzey px-4 py-3">{altBilgi}</footer>}
      </div>
    </div>
  );
}

/** Tarih aralığı seçici — rapor sayfalarında ortak. */
export function AralikSecici({
  baslangic,
  bitis,
  onDegisim,
}: {
  baslangic: string;
  bitis: string;
  onDegisim: (baslangic: string, bitis: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-sm">
        <span className="etiket">Başlangıç</span>
        <input type="date" className="alan" value={baslangic} onChange={(e) => onDegisim(e.target.value, bitis)} />
      </label>
      <label className="text-sm">
        <span className="etiket">Bitiş</span>
        <input type="date" className="alan" value={bitis} onChange={(e) => onDegisim(baslangic, e.target.value)} />
      </label>
    </div>
  );
}
