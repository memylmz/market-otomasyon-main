/**
 * Yazıcı önizlemeleri — kağıtta nasıl duracaksa ekranda da öyle (§13.2, §13.3).
 *
 * TEK KAYNAK İLKESİ: çizilen şey, yazıcıya giden verinin ta kendisidir. Fiş
 * için gerçek ESC/POS baytları üretilip geri çözülür; etiket için TSPL/ZPL
 * komutlarını üreten yerleşimin aynısı kullanılır. Ayrı bir "önizleme üreteci"
 * yazılsaydı ikisi zamanla ayrışır ve önizleme yalan söylemeye başlardı.
 *
 * ÖLÇEK GERÇEKTİR: etiket milimetre cinsinden çizilir, fiş ise kağıdın
 * karakter genişliğine göre. 40 mm'lik etikete sığmayan barkod ekranda da
 * taşar — zaten görülmesi gereken budur.
 */

import { code128Cizimi } from '@market/shared';

// ---------------------------------------------------------------------------
// Fiş önizlemesi
// ---------------------------------------------------------------------------

export type FisOgesi =
  | { tip: 'metin'; metin: string; hiza: 'sol' | 'orta' | 'sag'; kalin: boolean; altCizgi: boolean; boyut: 1 | 2 | 3 }
  | { tip: 'barkod'; veri: string; hiza: 'sol' | 'orta' | 'sag' }
  | { tip: 'bosluk'; satir: number }
  | { tip: 'kesme' };

export interface FisOnizlemeVerisi {
  ogeler: FisOgesi[];
  satirGenisligi: number;
}

/**
 * Fiş kağıdı.
 *
 * Genişlik KARAKTERLE ölçülür, pikselle değil: termal yazıcı sabit genişlikli
 * bir fontla basar ve 48 karakterlik satır 80 mm kağıdı tam doldurur. Ekranda
 * da aynı ölçüyü kullanmak, "bu satır taşar mı" sorusunu doğru yanıtlar.
 */
export function FisOnizleme({ veri }: { veri: FisOnizlemeVerisi }) {
  const { satirGenisligi } = veri;
  // 1ch = bir karakter genişliği; kağıt eni tam olarak satır genişliği kadardır.
  const kagitEni = `${satirGenisligi}ch`;

  return (
    <div className="flex justify-center overflow-auto rounded bg-yuzey-4/40 p-4">
      <div
        className="shadow-md"
        style={{
          width: kagitEni,
          background: '#fffdf7',
          color: '#1a1a1a',
          padding: '10px 0',
          fontFamily: "'Consolas', 'Menlo', monospace",
          fontSize: '12px',
          lineHeight: 1.35,
        }}
      >
        {veri.ogeler.map((oge, i) => (
          <FisSatiri key={i} oge={oge} satirGenisligi={satirGenisligi} />
        ))}
      </div>
    </div>
  );
}

function FisSatiri({ oge, satirGenisligi }: { oge: FisOgesi; satirGenisligi: number }) {
  if (oge.tip === 'bosluk') {
    return <div style={{ height: `${oge.satir * 1.35}em` }} />;
  }

  if (oge.tip === 'kesme') {
    // Kesme çizgisi kağıtta yoktur; nerede kesileceğini göstermek için çizilir.
    return (
      <div style={{ margin: '6px 0', borderTop: '1px dashed #b0b0b0', textAlign: 'center', fontSize: '9px', color: '#909090' }}>
        ✂ kesme
      </div>
    );
  }

  if (oge.tip === 'barkod') {
    return (
      <div style={{ textAlign: hizaCss(oge.hiza), padding: '4px 0' }}>
        <BarkodCizimi veri={oge.veri} yukseklikPx={40} modulPx={1.6} />
      </div>
    );
  }

  return (
    <div
      style={{
        textAlign: hizaCss(oge.hiza),
        fontWeight: oge.kalin ? 700 : 400,
        textDecoration: oge.altCizgi ? 'underline' : 'none',
        // Çift/üç punto yazıcıda karakteri hem eninde hem boyunda büyütür.
        fontSize: `${oge.boyut * 12}px`,
        lineHeight: 1.3,
        whiteSpace: 'pre',
        // Büyütülmüş yazı kağıda sığmayabilir; ekranda da taşsın ki görülsün.
        overflow: 'visible',
      }}
    >
      {oge.metin || ' '}
      {/* Satır genişliğini aşan metin yazıcıda alt satıra düşer; uyaralım. */}
      {oge.boyut === 1 && oge.metin.length > satirGenisligi && (
        <span style={{ color: '#b45309', fontSize: '9px' }}> ← taşıyor</span>
      )}
    </div>
  );
}

function hizaCss(hiza: 'sol' | 'orta' | 'sag'): 'left' | 'center' | 'right' {
  return hiza === 'orta' ? 'center' : hiza === 'sag' ? 'right' : 'left';
}

// ---------------------------------------------------------------------------
// Barkod çizimi — gerçek CODE128 modülleri
// ---------------------------------------------------------------------------

/**
 * Barkodu TEMSİLİ değil GERÇEK modül genişlikleriyle çizer.
 *
 * CODE128'in genişliği veriye bağlıdır (karakter başına 11 modül). Temsili bir
 * çizgili dikdörtgen çizilseydi "bu barkod etikete sığıyor mu" sorusu ekranda
 * yanıtsız kalır, kullanıcı ancak kağıda basınca görürdü.
 */
function BarkodCizimi({ veri, yukseklikPx, modulPx }: { veri: string; yukseklikPx: number; modulPx: number }) {
  const cizim = code128Cizimi(veri);
  if (!cizim) return <span style={{ color: '#b45309', fontSize: '10px' }}>[{veri}] kodlanamadı</span>;

  const genislik = cizim.toplamModul * modulPx;
  let x = 0;
  const cubuklar: { x: number; en: number }[] = [];
  cizim.desenler.forEach((modul, sira) => {
    const en = modul * modulPx;
    // Çift sıradakiler ÇUBUK, tekler boşluktur (desen çubukla başlar).
    if (sira % 2 === 0) cubuklar.push({ x, en });
    x += en;
  });

  return (
    <svg width={genislik} height={yukseklikPx + 12} style={{ display: 'inline-block' }} aria-label={`Barkod ${veri}`}>
      {cubuklar.map((c, i) => (
        <rect key={i} x={c.x} y={0} width={c.en} height={yukseklikPx} fill="#111" />
      ))}
      <text
        x={genislik / 2}
        y={yukseklikPx + 10}
        textAnchor="middle"
        fontSize="9"
        fontFamily="Consolas, Menlo, monospace"
        fill="#111"
      >
        {veri}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Etiket önizlemesi
// ---------------------------------------------------------------------------

export type YerlesimOgesi =
  | { tip: 'metin'; xMm: number; yMm: number; metin: string; yukseklikMm: number; kalin: boolean }
  | { tip: 'barkod'; xMm: number; yMm: number; veri: string; yukseklikMm: number; modulMm: number; genislikMm: number }
  | { tip: 'cerceve'; xMm: number; yMm: number; enMm: number; boyMm: number; kalinlikMm: number };

export interface EtiketOnizlemeVerisi {
  enMm: number;
  boyMm: number;
  ogeler: YerlesimOgesi[];
  uyarilar: string[];
  dil?: string;
}

/**
 * Etiketi GERÇEK ölçüsünde çizer.
 *
 * SVG'nin görüş kutusu milimetre cinsindendir; ekrandaki her şey kağıttaki
 * yerinde durur. Etiket sınırının dışına taşan bir öğe ekranda da taşar ve
 * kırmızı çerçeveyle işaretlenir — kullanıcı yüz etiket bastıktan sonra değil,
 * basmadan önce görür.
 */
export function EtiketOnizleme({ veri, olcek = 4 }: { veri: EtiketOnizlemeVerisi; olcek?: number }) {
  const { enMm, boyMm } = veri;

  return (
    <div className="space-y-2">
      <div className="flex justify-center overflow-auto rounded bg-yuzey-4/40 p-4">
        <svg
          width={enMm * olcek}
          height={boyMm * olcek}
          viewBox={`0 0 ${enMm} ${boyMm}`}
          style={{ background: '#fffdf7', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}
          aria-label="Etiket önizlemesi"
        >
          {/* Etiketin kendi sınırı — kesim çizgisi. */}
          <rect x={0} y={0} width={enMm} height={boyMm} fill="none" stroke="#c8c8c8" strokeWidth={0.15} strokeDasharray="1 1" />

          {veri.ogeler.map((oge, i) => (
            <EtiketOgesi key={i} oge={oge} enMm={enMm} boyMm={boyMm} />
          ))}
        </svg>
      </div>

      <p className="text-center text-xs text-metin-4">
        {enMm} × {boyMm} mm{veri.dil ? ` · ${veri.dil}` : ''} · gerçek ölçüsünde
      </p>

      {veri.uyarilar.length > 0 && (
        <ul className="space-y-1 rounded border border-uyari-cizgi bg-uyari-yumusak px-3 py-2 text-xs">
          {veri.uyarilar.map((u, i) => (
            <li key={i}>{u}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EtiketOgesi({ oge, enMm, boyMm }: { oge: YerlesimOgesi; enMm: number; boyMm: number }) {
  if (oge.tip === 'cerceve') {
    return (
      <rect
        x={oge.xMm + oge.kalinlikMm / 2}
        y={oge.yMm + oge.kalinlikMm / 2}
        width={oge.enMm - oge.kalinlikMm}
        height={oge.boyMm - oge.kalinlikMm}
        fill="none"
        stroke="#111"
        strokeWidth={oge.kalinlikMm}
      />
    );
  }

  if (oge.tip === 'metin') {
    // Taşma kontrolü: gömülü fontta karakter genişliği ≈ yüksekliğin %55'i.
    const genislikMm = oge.metin.length * oge.yukseklikMm * 0.55;
    const tasiyor = oge.xMm + genislikMm > enMm || oge.yMm + oge.yukseklikMm > boyMm;
    return (
      <>
        {tasiyor && (
          <rect
            x={oge.xMm}
            y={oge.yMm}
            width={Math.min(genislikMm, enMm - oge.xMm)}
            height={oge.yukseklikMm}
            fill="none"
            stroke="#b91c1c"
            strokeWidth={0.2}
          />
        )}
        <text
          x={oge.xMm}
          y={oge.yMm + oge.yukseklikMm * 0.82}
          fontSize={oge.yukseklikMm}
          fontWeight={oge.kalin ? 700 : 400}
          fontFamily="Arial, Helvetica, sans-serif"
          fill="#111"
        >
          {oge.metin}
        </text>
      </>
    );
  }

  const cizim = code128Cizimi(oge.veri);
  if (!cizim) return null;

  const tasiyor = oge.xMm + oge.genislikMm > enMm;
  let x = oge.xMm;
  const cubuklar: { x: number; en: number }[] = [];
  cizim.desenler.forEach((modul, sira) => {
    const en = modul * oge.modulMm;
    if (sira % 2 === 0) cubuklar.push({ x, en });
    x += en;
  });

  return (
    <>
      {cubuklar.map((c, i) => (
        <rect key={i} x={c.x} y={oge.yMm} width={c.en} height={oge.yukseklikMm} fill="#111" />
      ))}
      <text
        x={oge.xMm + oge.genislikMm / 2}
        y={oge.yMm + oge.yukseklikMm + 2.2}
        textAnchor="middle"
        fontSize={2.2}
        fontFamily="Arial, Helvetica, sans-serif"
        fill="#111"
      >
        {oge.veri}
      </text>
      {tasiyor && (
        <rect
          x={oge.xMm}
          y={oge.yMm}
          width={Math.min(oge.genislikMm, enMm - oge.xMm)}
          height={oge.yukseklikMm}
          fill="none"
          stroke="#b91c1c"
          strokeWidth={0.2}
        />
      )}
    </>
  );
}
