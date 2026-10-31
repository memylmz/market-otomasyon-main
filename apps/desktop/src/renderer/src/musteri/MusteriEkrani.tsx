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

/**
 * Slayt temaları: adları (Yeşil, Kırmızı…) kayıtlı ayarlarla uyumlu kalır,
 * görünümleri sakinleşir. Doygun geçişler yerine koyu, kısık bir zemin ve o
 * zemine uyan yumuşak bir vurgu (fiyat, etiket). Işık sol üstten hafifçe vurur.
 */
export const TEMA_STILI: Record<SlaytTemasi, { zemin: string; vurgu: string }> = {
  YESIL: { zemin: zemin('#1f3d33', '#0f1f1a', '#09120f'), vurgu: '#bcd5c4' },
  KIRMIZI: { zemin: zemin('#41201f', '#210f10', '#130809'), vurgu: '#e4bba9' },
  TURUNCU: { zemin: zemin('#3f2d18', '#22180c', '#140e07'), vurgu: '#e5c38d' },
  MAVI: { zemin: zemin('#1d2d48', '#101a2c', '#0a101b'), vurgu: '#bccbe6' },
  MOR: { zemin: zemin('#302243', '#1b1428', '#100c18'), vurgu: '#cdbde4' },
  KOYU: { zemin: zemin('#25272d', '#15171b', '#0c0d10'), vurgu: '#d6b97c' },
};

function zemin(isik: string, orta: string, koyu: string): string {
  return `radial-gradient(110% 85% at 15% 0%, ${isik} 0%, ${orta} 55%, ${koyu} 100%)`;
}

// ---------------------------------------------------------------------------
// Kök
// ---------------------------------------------------------------------------

/** Seçilen müşteri temasının değişkenleri; kök (`musteri-kok`) öğeye yazılır. */
export function musteriKokStili(yapilandirma: MusteriEkraniYapilandirmasi): CSSProperties {
  return (yapilandirma.gorunum ?? {}) as CSSProperties;
}

export function MusteriEkraniGorunumu({
  yapilandirma,
  durum,
}: {
  yapilandirma: MusteriEkraniYapilandirmasi;
  durum: EkranDurumu;
}) {
  return (
    <div className="musteri-kok" style={musteriKokStili(yapilandirma)}>
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
          className="m-slayt absolute inset-0 flex flex-col items-center justify-center gap-[3.5cqmin] p-[9cqmin] text-center"
          style={{ background: TEMA_STILI[slayt.tema].zemin }}
        >
          <span className="m-kalem" style={{ color: TEMA_STILI[slayt.tema].vurgu }} />
          <h1 className="musteri-tasma font-light tracking-tight" style={y(10)}>
            {slayt.baslik}
          </h1>
          {slayt.metin && (
            <p className="m-metin-2 max-w-[78%] font-normal" style={{ ...y(4.8), lineHeight: 1.35 }}>
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
    <div className="m-zemin absolute inset-0 flex flex-col p-[6cqmin] pb-[4.5cqmin] text-center">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[3cqmin]">
        {logoUrl && <img src={logoUrl} alt="" className="max-h-[30cqh] max-w-[55cqw] object-contain" draggable={false} />}
        {isletmeAdi && (
          <h1 className="musteri-tasma font-light tracking-[0.01em]" style={y(logoUrl ? 8.5 : 11)}>
            {isletmeAdi}
          </h1>
        )}
        {karsilamaMetni && (
          <>
            <span className="m-kalem m-altin" />
            <p className="m-altin font-normal" style={y(5.6)}>
              {karsilamaMetni}
            </p>
          </>
        )}
        {karsilamaAltMetni && (
          <p className="m-metin-2 max-w-[72%]" style={{ ...y(3.6), lineHeight: 1.4 }}>
            {karsilamaAltMetni}
          </p>
        )}
      </div>
      <div className="m-cizgi m-metin-3 flex justify-end border-t pt-[2cqmin] tabular-nums" style={y(3)}>
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
    <div className="m-etiket absolute bottom-[4.5cqmin] left-0 right-0 text-center" style={y(2.4)}>
      {ad}
    </div>
  );
}

export function FiyatKartiGorunumu({ kart, isletmeAdi }: { kart: FiyatKarti; isletmeAdi: string }) {
  return (
    <div
      className="m-slayt absolute inset-0 flex flex-col items-center justify-center p-[8cqmin] text-center"
      style={{ background: TEMA_STILI[kart.tema].zemin }}
    >
      {kart.ust && (
        <div
          className="m-etiket absolute left-[5.5cqmin] top-[5.5cqmin]"
          style={{ ...y(2.6), color: TEMA_STILI[kart.tema].vurgu }}
        >
          {kart.ust}
        </div>
      )}
      {kart.rozet && (
        <div
          className="m-hap absolute right-[5cqmin] top-[4.6cqmin] px-[2.6cqmin] py-[0.9cqmin]"
          style={{ ...y(3), color: TEMA_STILI[kart.tema].vurgu }}
        >
          {kart.rozet}
        </div>
      )}
      <h1 className="musteri-tasma max-w-[82%] font-light tracking-tight" style={y(kart.fiyat ? 7.6 : 9.5)}>
        {kart.ad}
      </h1>
      {kart.eskiFiyat && (
        <div className="m-metin-3 mt-[2.5cqmin] font-normal tabular-nums line-through decoration-[0.25cqmin]" style={y(4.6)}>
          {kart.eskiFiyat}
        </div>
      )}
      {kart.fiyat && (
        <div
          className="mt-[0.5cqmin] flex items-baseline gap-[1.2cqmin] font-semibold tabular-nums tracking-tight"
          style={{ ...y(15), color: TEMA_STILI[kart.tema].vurgu }}
        >
          {kart.fiyat}
          {kart.birim && (
            <span className="m-metin-2 font-light" style={y(4.6)}>
              {kart.birim}
            </span>
          )}
        </div>
      )}
      {kart.alt && (
        <p className="m-metin-2 mt-[2.5cqmin] font-normal" style={y(4.2)}>
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
    <header className="m-cizgi flex items-center gap-[2cqmin] border-b px-[4.5cqmin] py-[2.2cqmin]">
      {yapilandirma.logoUrl && (
        <img src={yapilandirma.logoUrl} alt="" className="h-[5.5cqmin] w-auto object-contain" draggable={false} />
      )}
      <span className="font-normal tracking-[0.02em]" style={y(3.3)}>
        {yapilandirma.isletmeAdi}
      </span>
      <span className="m-etiket ml-auto" style={y(2.3)}>
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
    <div className="m-zemin absolute inset-0 flex flex-col">
      <Ust yapilandirma={yapilandirma} sag={`${kalem} kalem`} />
      <div className="flex min-h-0 flex-1">
        {/* Son okutulan ürün */}
        <section className="m-cizgi flex w-[56%] flex-col justify-center gap-[2cqmin] border-r p-[5.5cqmin]">
          {son && (
            <div key={`${son.anahtar}:${son.miktar}`} className="musteri-giris">
              <div className="m-etiket" style={y(2.4)}>
                Son ürün
              </div>
              <h2 className="musteri-tasma mt-[1.6cqmin] font-light tracking-tight" style={y(6.6)}>
                {son.ad}
              </h2>
              <div className="m-metin-2 mt-[2cqmin] flex flex-wrap items-baseline gap-x-[2cqmin] tabular-nums" style={y(3.8)}>
                <span>
                  {miktarFormat(son.miktar, son.birimTipi)} × {paraFormat(son.birimFiyat)}
                </span>
                {son.listeFiyati > son.birimFiyat && (
                  <span className="m-metin-3 line-through" style={y(3.2)}>
                    {paraFormat(son.listeFiyati)}
                  </span>
                )}
              </div>
              <div className="m-altin mt-[3cqmin] font-semibold tabular-nums tracking-tight" style={y(10)}>
                {paraFormat(son.tutar)}
              </div>
              {son.iskonto > 0 && (
                <div className="m-hap m-altin mt-[2.2cqmin] px-[2.4cqmin] py-[0.8cqmin]" style={y(2.8)}>
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
                  className={`m-cizgi flex items-baseline gap-[1.5cqmin] border-b px-[3.2cqmin] py-[1.7cqmin] ${sonMu ? 'musteri-vurgu' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-normal" style={y(3.1)}>
                      {s.ad}
                    </div>
                    <div className="m-metin-3 tabular-nums" style={y(2.4)}>
                      {miktarFormat(s.miktar, s.birimTipi)} × {paraFormat(s.birimFiyat)}
                      {s.iskonto > 0 && <span className="m-altin ml-[1.2cqmin]">İndirim {paraFormat(-s.iskonto)}</span>}
                    </div>
                  </div>
                  <div className="font-semibold tabular-nums" style={y(3.2)}>
                    {paraFormat(s.tutar)}
                  </div>
                </div>
              );
            })}
          </div>
          <footer
            className="border-t px-[3.2cqmin] py-[2.8cqmin]"
            style={{ borderColor: 'var(--m-altin-cizgi)', background: 'var(--m-satir)' }}
          >
            {sepet.kazanc > 0 && (
              <div className="m-altin mb-[1.2cqmin] font-normal" style={y(2.8)}>
                Bu alışverişte kazancınız {paraFormat(sepet.kazanc)}
              </div>
            )}
            <div className="m-etiket" style={y(2.4)}>
              Toplam
            </div>
            {/* Genişliğe göre küçülür: 4:3 ekranda dar sütunda tutar iki satıra kırılmasın. */}
            <div
              className="mt-[0.6cqmin] whitespace-nowrap text-right font-semibold tabular-nums tracking-tight"
              style={{ fontSize: 'min(9cqmin, 5.6cqw)', lineHeight: 1.05 }}
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
    <div className="m-zemin musteri-giris absolute inset-0 flex flex-col items-center justify-center gap-[2.6cqmin] p-[7cqmin] text-center">
      <svg
        viewBox="0 0 24 24"
        className="m-altin h-[13cqmin] w-[13cqmin]"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.1}
        aria-hidden
      >
        <circle cx="12" cy="12" r="10.5" className="opacity-50" />
        <path d="M7.5 12.4l3 3L16.6 9.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h1 className="font-light tracking-tight" style={y(10)}>
        Teşekkür ederiz
      </h1>
      <div className="m-metin-2 tabular-nums" style={y(3.8)}>
        Ödenen <span className="font-semibold text-[var(--m-metin)]">{paraFormat(genelToplam)}</span>
      </div>
      {paraUstu > 0 && (
        <div
          className="mt-[1.5cqmin] rounded-[1.6cqmin] border px-[6cqmin] py-[2.2cqmin]"
          style={{ borderColor: 'var(--m-altin-cizgi)', background: 'var(--m-altin-zemin)' }}
        >
          <div className="m-etiket" style={y(2.4)}>
            Para üstü
          </div>
          <div className="m-altin mt-[0.6cqmin] font-semibold tabular-nums tracking-tight" style={y(9)}>
            {paraFormat(paraUstu)}
          </div>
        </div>
      )}
      {yapilandirma.tesekkurMetni && (
        <p className="m-metin-2 mt-[1cqmin] max-w-[72%]" style={{ ...y(3.4), lineHeight: 1.4 }}>
          {yapilandirma.tesekkurMetni}
        </p>
      )}
      <Imza ad={yapilandirma.isletmeAdi} />
    </div>
  );
}
