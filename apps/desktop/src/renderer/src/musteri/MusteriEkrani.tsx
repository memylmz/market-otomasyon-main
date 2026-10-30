/**
 * Müşteri ekranı görünümleri: bekleme (yayın listesi), sepet ve teşekkür.
 *
 * Aynı bileşenler iki yerde çizilir: müşteri penceresinde tam ekran ve
 * Ayarlar → Müşteri Ekranı'ndaki önizleme kutusunda. Bu yüzden boyutlar
 * pencereye değil kapsayıcıya göre verilir (`cqmin`, bkz. musteri.css).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  miktarFormat,
  paraFormat,
  slaytSirasiKoru,
  type EkranDurumu,
  type EkranSlayti,
  type FiyatKarti,
  type MusteriEkraniYapilandirmasi,
  type MusteriSepeti,
  type SlaytTemasi,
} from '@market/shared';
import './musteri.css';

/** Yazı boyutu: kapsayıcının kısa kenarının yüzdesi. */
const y = (yuzde: number): CSSProperties => ({ fontSize: `${yuzde}cqmin`, lineHeight: 1.12 });

/** Şablon renkleri — Tailwind sınıfları tam yazılır ki derlemeye girsin. */
export const TEMA_ZEMINI: Record<SlaytTemasi, string> = {
  YESIL: 'bg-gradient-to-br from-emerald-600 via-emerald-800 to-emerald-950',
  KIRMIZI: 'bg-gradient-to-br from-red-600 via-red-700 to-rose-950',
  TURUNCU: 'bg-gradient-to-br from-orange-500 via-orange-600 to-amber-900',
  MAVI: 'bg-gradient-to-br from-sky-600 via-blue-700 to-blue-950',
  MOR: 'bg-gradient-to-br from-violet-600 via-purple-700 to-purple-950',
  KOYU: 'bg-gradient-to-br from-slate-700 via-slate-800 to-slate-950',
};

const KARSILAMA_ZEMINI = 'bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-950';

// ---------------------------------------------------------------------------
// Kök
// ---------------------------------------------------------------------------

export function MusteriEkraniGorunumu({
  yapilandirma,
  durum,
}: {
  yapilandirma: MusteriEkraniYapilandirmasi;
  durum: EkranDurumu;
}) {
  return (
    <div className="musteri-kok bg-slate-950">
      {durum.mod === 'SEPET' && durum.sepet ? (
        <SepetGorunumu sepet={durum.sepet} yapilandirma={yapilandirma} />
      ) : durum.mod === 'TESEKKUR' && durum.tesekkur ? (
        <TesekkurGorunumu
          genelToplam={durum.tesekkur.genelToplam}
          paraUstu={durum.tesekkur.paraUstu}
          yapilandirma={yapilandirma}
        />
      ) : (
        <Yayin yapilandirma={yapilandirma} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bekleme: yayın listesi
// ---------------------------------------------------------------------------

const YEDEK_KARSILAMA: EkranSlayti = { anahtar: '__karsilama', tip: 'KARSILAMA', sureMs: 60_000 };

/**
 * Slaytları sırayla oynatır. Hiç slayt yoksa karşılama sabit durur.
 *
 * Oynayan slayt SIRA NUMARASIYLA değil ANAHTARIYLA tutulur: yayın listesi
 * dakikada bir yeniden geliyor (fiyat/kampanya değişimi); numarayla tutulsaydı
 * araya giren ya da çıkan bir kampanya oynayan slaytı kaydırırdı.
 */
export function Yayin({ yapilandirma }: { yapilandirma: MusteriEkraniYapilandirmasi }) {
  const slaytlar = useMemo(
    () => (yapilandirma.slaytlar.length > 0 ? yapilandirma.slaytlar : [YEDEK_KARSILAMA]),
    [yapilandirma.slaytlar],
  );
  const [anahtar, setAnahtar] = useState<string | null>(null);
  const sira = slaytSirasiKoru(anahtar, slaytlar);
  const slayt = slaytlar[sira]!;
  const tek = slaytlar.length === 1;

  const ileri = useCallback(() => {
    setAnahtar(slaytlar[(sira + 1) % slaytlar.length]!.anahtar);
  }, [slaytlar, sira]);

  useEffect(() => {
    if (tek && slayt.tip !== 'VIDEO') return;
    // Videoda süre bir ÜST SINIRDIR: normalde video bitince `onEnded` geçer.
    const zamanlayici = setTimeout(ileri, slayt.sureMs);
    return () => clearTimeout(zamanlayici);
  }, [slayt, tek, ileri]);

  return (
    <div key={slayt.anahtar} className="musteri-giris absolute inset-0">
      <SlaytGorunumu slayt={slayt} yapilandirma={yapilandirma} onBitti={tek ? undefined : ileri} tekrarla={tek} />
    </div>
  );
}

export function SlaytGorunumu({
  slayt,
  yapilandirma,
  onBitti,
  tekrarla,
}: {
  slayt: EkranSlayti;
  yapilandirma: MusteriEkraniYapilandirmasi;
  /** Video bittiğinde ya da medya açılamadığında: sıradakine geç. */
  onBitti?: () => void;
  /** Listede tek video varsa döngüde oynar. */
  tekrarla?: boolean;
}) {
  switch (slayt.tip) {
    case 'KARSILAMA':
      return <KarsilamaGorunumu yapilandirma={yapilandirma} />;
    case 'FIYAT':
      return <FiyatKartiGorunumu kart={slayt.kart} isletmeAdi={yapilandirma.isletmeAdi} />;
    case 'DUYURU':
      return (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center gap-[4cqmin] p-[8cqmin] text-center ${TEMA_ZEMINI[slayt.tema]}`}
        >
          <h1 className="musteri-tasma font-extrabold tracking-tight" style={y(11)}>
            {slayt.baslik}
          </h1>
          {slayt.metin && (
            <p className="max-w-[85%] font-medium opacity-90" style={y(5.5)}>
              {slayt.metin}
            </p>
          )}
          <Imza ad={yapilandirma.isletmeAdi} />
        </div>
      );
    case 'GORSEL':
      return (
        <div className="absolute inset-0 bg-black">
          <img src={slayt.url} alt="" className="h-full w-full object-contain" draggable={false} onError={onBitti} />
        </div>
      );
    case 'VIDEO':
      return (
        <div className="absolute inset-0 bg-black">
          <video
            src={slayt.url}
            className="h-full w-full object-contain"
            autoPlay
            muted
            playsInline
            loop={tekrarla}
            onEnded={onBitti}
            onError={onBitti}
          />
        </div>
      );
  }
}

function KarsilamaGorunumu({ yapilandirma }: { yapilandirma: MusteriEkraniYapilandirmasi }) {
  const { logoUrl, isletmeAdi, karsilamaMetni, karsilamaAltMetni } = yapilandirma;
  return (
    // Saat ayrı bir satırda: uzun alt yazı ortadaki bloğu büyütse de saatin üstüne binmez.
    <div className={`absolute inset-0 flex flex-col p-[6cqmin] pb-[4cqmin] text-center ${KARSILAMA_ZEMINI}`}>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[3cqmin]">
        {logoUrl && (
          <img src={logoUrl} alt="" className="max-h-[32cqh] max-w-[60cqw] object-contain drop-shadow-2xl" draggable={false} />
        )}
        {isletmeAdi && (
          <h1 className="musteri-tasma font-extrabold tracking-tight" style={y(logoUrl ? 9 : 12)}>
            {isletmeAdi}
          </h1>
        )}
        {karsilamaMetni && (
          <p className="font-light text-emerald-300" style={y(7)}>
            {karsilamaMetni}
          </p>
        )}
        {karsilamaAltMetni && (
          <p className="max-w-[80%] text-white/80" style={y(4)}>
            {karsilamaAltMetni}
          </p>
        )}
      </div>
      <div className="self-end tabular-nums text-white/60" style={y(3.6)}>
        <Saat />
      </div>
    </div>
  );
}

function Saat() {
  const [simdi, setSimdi] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setSimdi(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span>
      {simdi.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' })} ·{' '}
      {simdi.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
}

function Imza({ ad }: { ad: string }) {
  if (!ad) return null;
  return (
    <div
      className="absolute bottom-[4cqmin] left-0 right-0 text-center font-semibold uppercase tracking-[0.3em] text-white/60"
      style={y(3)}
    >
      {ad}
    </div>
  );
}

export function FiyatKartiGorunumu({ kart, isletmeAdi }: { kart: FiyatKarti; isletmeAdi: string }) {
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center p-[7cqmin] text-center ${TEMA_ZEMINI[kart.tema]}`}
    >
      {kart.ust && (
        <div
          className="absolute left-[5cqmin] top-[5cqmin] rounded-full bg-white/15 px-[3cqmin] py-[1.2cqmin] font-bold uppercase tracking-wider"
          style={y(3.6)}
        >
          {kart.ust}
        </div>
      )}
      {kart.rozet && (
        <div
          className="absolute right-[4cqmin] top-[6cqmin] rotate-6 rounded-[2cqmin] bg-yellow-300 px-[3.5cqmin] py-[1.8cqmin] font-black text-slate-900 shadow-2xl"
          style={y(5.5)}
        >
          {kart.rozet}
        </div>
      )}
      <h1 className="musteri-tasma max-w-[85%] font-extrabold tracking-tight" style={y(kart.fiyat ? 8.5 : 10)}>
        {kart.ad}
      </h1>
      {kart.eskiFiyat && (
        <div className="mt-[2.5cqmin] font-semibold tabular-nums text-white/70 line-through decoration-[0.5cqmin]" style={y(6)}>
          {kart.eskiFiyat}
        </div>
      )}
      {kart.fiyat && (
        <div className="mt-[1cqmin] flex items-baseline gap-[1.5cqmin] font-black tabular-nums drop-shadow-lg" style={y(17)}>
          {kart.fiyat}
          {kart.birim && (
            <span className="font-bold text-white/80" style={y(6)}>
              {kart.birim}
            </span>
          )}
        </div>
      )}
      {kart.alt && (
        <p className="mt-[2.5cqmin] font-semibold text-white/90" style={y(5)}>
          {kart.alt}
        </p>
      )}
      <Imza ad={isletmeAdi} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sepet
// ---------------------------------------------------------------------------

function Ust({ yapilandirma, sag }: { yapilandirma: MusteriEkraniYapilandirmasi; sag?: ReactNode }) {
  return (
    <header className="flex items-center gap-[2cqmin] border-b border-white/10 px-[4cqmin] py-[2cqmin]">
      {yapilandirma.logoUrl && (
        <img src={yapilandirma.logoUrl} alt="" className="h-[6cqmin] w-auto object-contain" draggable={false} />
      )}
      <span className="font-bold" style={y(3.6)}>
        {yapilandirma.isletmeAdi}
      </span>
      <span className="ml-auto text-white/60" style={y(3)}>
        {sag}
      </span>
    </header>
  );
}

export function SepetGorunumu({ sepet, yapilandirma }: { sepet: MusteriSepeti; yapilandirma: MusteriEkraniYapilandirmasi }) {
  const son = sepet.satirlar.find((s) => s.anahtar === sepet.sonAnahtar) ?? sepet.satirlar[sepet.satirlar.length - 1];
  const liste = useRef<HTMLDivElement>(null);

  // Büyük gösterilen satır listede de görünür kalsın.
  useEffect(() => {
    const satir = liste.current?.querySelector<HTMLElement>('[data-son="1"]');
    satir?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [sepet]);

  const kalem = sepet.satirlar.length;
  return (
    <div className="absolute inset-0 flex flex-col bg-slate-950">
      <Ust yapilandirma={yapilandirma} sag={`${kalem} kalem`} />
      <div className="flex min-h-0 flex-1">
        {/* Son okutulan ürün */}
        <section className="flex w-[56%] flex-col justify-center gap-[2cqmin] border-r border-white/10 bg-gradient-to-br from-slate-900 to-slate-950 p-[5cqmin]">
          {son && (
            <div key={`${son.anahtar}:${son.miktar}`} className="musteri-giris">
              <h2 className="musteri-tasma font-bold" style={y(7)}>
                {son.ad}
              </h2>
              <div className="mt-[2cqmin] flex flex-wrap items-baseline gap-x-[2cqmin] tabular-nums text-white/75" style={y(4.4)}>
                <span>
                  {miktarFormat(son.miktar, son.birimTipi)} × {paraFormat(son.birimFiyat)}
                </span>
                {son.listeFiyati > son.birimFiyat && (
                  <span className="text-white/45 line-through" style={y(3.6)}>
                    {paraFormat(son.listeFiyati)}
                  </span>
                )}
              </div>
              <div className="mt-[3cqmin] font-black tabular-nums text-emerald-300" style={y(11)}>
                {paraFormat(son.tutar)}
              </div>
              {son.iskonto > 0 && (
                <div
                  className="mt-[2cqmin] inline-block rounded-[1.5cqmin] bg-yellow-300 px-[2.5cqmin] py-[1cqmin] font-bold text-slate-900"
                  style={y(3.8)}
                >
                  İndirim {paraFormat(-son.iskonto)}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Liste ve toplam */}
        <section className="flex w-[44%] min-w-0 flex-col">
          <div ref={liste} className="musteri-liste min-h-0 flex-1 overflow-y-auto">
            {sepet.satirlar.map((s) => {
              const sonMu = s.anahtar === son?.anahtar;
              return (
                <div
                  key={sonMu ? `${s.anahtar}:${s.miktar}` : s.anahtar}
                  data-son={sonMu ? '1' : undefined}
                  className={`flex items-baseline gap-[1.5cqmin] border-b border-white/5 px-[3cqmin] py-[1.6cqmin] ${sonMu ? 'musteri-vurgu bg-white/5' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold" style={y(3.3)}>
                      {s.ad}
                    </div>
                    <div className="tabular-nums text-white/55" style={y(2.6)}>
                      {miktarFormat(s.miktar, s.birimTipi)} × {paraFormat(s.birimFiyat)}
                      {s.iskonto > 0 && <span className="ml-[1cqmin] text-yellow-300">İnd. {paraFormat(-s.iskonto)}</span>}
                    </div>
                  </div>
                  <div className="font-bold tabular-nums" style={y(3.4)}>
                    {paraFormat(s.tutar)}
                  </div>
                </div>
              );
            })}
          </div>
          <footer className="border-t-[0.5cqmin] border-emerald-500 bg-emerald-950/60 px-[3cqmin] py-[2.5cqmin]">
            {sepet.kazanc > 0 && (
              <div className="mb-[1cqmin] font-semibold text-yellow-300" style={y(3.2)}>
                Bu alışverişte kazancınız: {paraFormat(sepet.kazanc)}
              </div>
            )}
            <div className="font-semibold uppercase tracking-wider text-white/70" style={y(3.2)}>
              Toplam
            </div>
            {/* Genişliğe göre küçülür: 4:3 ekranda dar sütunda tutar iki satıra kırılmasın. */}
            <div
              className="whitespace-nowrap text-right font-black tabular-nums"
              style={{ fontSize: 'min(9.5cqmin, 5.8cqw)', lineHeight: 1.05 }}
            >
              {paraFormat(sepet.genelToplam)}
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Teşekkür
// ---------------------------------------------------------------------------

export function TesekkurGorunumu({
  genelToplam,
  paraUstu,
  yapilandirma,
}: {
  genelToplam: number;
  paraUstu: number;
  yapilandirma: MusteriEkraniYapilandirmasi;
}) {
  return (
    <div className="musteri-giris absolute inset-0 flex flex-col items-center justify-center gap-[2.5cqmin] bg-gradient-to-br from-emerald-600 via-emerald-800 to-emerald-950 p-[6cqmin] text-center">
      <svg
        viewBox="0 0 24 24"
        className="h-[16cqmin] w-[16cqmin]"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        aria-hidden
      >
        <circle cx="12" cy="12" r="10" className="opacity-40" />
        <path d="M7 12.5l3.2 3.2L17 9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h1 className="font-extrabold" style={y(11)}>
        Teşekkürler
      </h1>
      <div className="tabular-nums text-white/85" style={y(4.6)}>
        Ödenen: <span className="font-bold">{paraFormat(genelToplam)}</span>
      </div>
      {paraUstu > 0 && (
        <div className="mt-[1cqmin] rounded-[2cqmin] bg-yellow-300 px-[5cqmin] py-[2cqmin] text-slate-900">
          <div className="font-semibold uppercase tracking-wider" style={y(3.4)}>
            Para üstü
          </div>
          <div className="font-black tabular-nums" style={y(10)}>
            {paraFormat(paraUstu)}
          </div>
        </div>
      )}
      {yapilandirma.tesekkurMetni && (
        <p className="mt-[1cqmin] max-w-[80%] text-white/85" style={y(4)}>
          {yapilandirma.tesekkurMetni}
        </p>
      )}
      <Imza ad={yapilandirma.isletmeAdi} />
    </div>
  );
}
