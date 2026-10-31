/**
 * Özel tema düzenleyicisi (Ayarlar → Görünüm → Özel).
 *
 * Dört ana renk, yazı ölçeği, yazı tipi ve köşe biçimi. Her değişiklik anında
 * bütün uygulamaya uygulanır (önizleme ekranın kendisidir); Kaydet'e basılınca
 * kalıcı olur. Yazı ile zemin arasındaki kontrast okunurluk eşiğinin altına
 * düşerse uyarılır, engellenmez.
 */

import {
  HAZIR_TEMALAR,
  KOSE_CARPANI,
  kontrastOrani,
  VARSAYILAN_OZEL_TEMA,
  YAZI_OLCEGI_SINIRI,
  YAZI_TIPLERI,
  type KoseBicimi,
  type OzelTema,
  type YaziTipi,
} from '@market/shared';
import { Alan, Rozet } from '../../bilesen/temel';

const RENKLER: { alan: 'zemin' | 'yuzey' | 'metin' | 'vurgu'; etiket: string; ipucu: string }[] = [
  { alan: 'zemin', etiket: 'Arka plan', ipucu: 'Sayfanın zemini' },
  { alan: 'yuzey', etiket: 'Kart / panel', ipucu: 'Tablolar, pencereler' },
  { alan: 'metin', etiket: 'Yazı', ipucu: 'Ana yazı rengi' },
  { alan: 'vurgu', etiket: 'Vurgu', ipucu: 'Düğmeler, seçili satır' },
];

const KOSE_ETIKETI: Record<KoseBicimi, string> = { keskin: 'Keskin', normal: 'Normal', yuvarlak: 'Yuvarlak' };

export function OzelTemaDuzenleyici({ deger, onDegis }: { deger: OzelTema; onDegis: (t: OzelTema) => void }) {
  const degistir = (alanlar: Partial<OzelTema>) => onDegis({ ...deger, ...alanlar });
  const yaziKontrasti = kontrastOrani(deger.metin, deger.yuzey);
  const zeminKontrasti = kontrastOrani(deger.metin, deger.zemin);
  const vurguKontrasti = kontrastOrani(deger.vurgu, deger.yuzey);
  const zayif = Math.min(yaziKontrasti, zeminKontrasti) < 4.5;

  return (
    <div className="grid gap-4 rounded-lg border border-cizgi bg-yuzey-2 p-4">
      <Alan etiket="Hazır paletler" ipucu="Bir paletle başlayıp renkleri tek tek değiştirebilirsiniz.">
        <div className="flex flex-wrap gap-2">
          {HAZIR_TEMALAR.map((h) => {
            const secili = (['taban', 'zemin', 'yuzey', 'metin', 'vurgu'] as const).every((k) => h.tema[k] === deger[k]);
            return (
              <button
                key={h.ad}
                type="button"
                onClick={() => degistir(h.tema)}
                className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm ${
                  secili ? 'border-vurgu ring-2 ring-vurgu/40' : 'border-cizgi hover:border-cizgi-kuvvetli'
                }`}
                title={`${h.ad} (${h.tema.taban === 'koyu' ? 'koyu' : 'açık'})`}
              >
                <span className="flex overflow-hidden rounded border border-cizgi">
                  {[h.tema.zemin, h.tema.yuzey, h.tema.metin, h.tema.vurgu].map((r) => (
                    <span key={r} className="h-5 w-3" style={{ background: r }} />
                  ))}
                </span>
                {h.ad}
              </button>
            );
          })}
        </div>
      </Alan>

      <Alan etiket="Taban" ipucu="Uyarı, hata ve bilgi renkleri tabandan gelir; koyu taban loş ortam içindir.">
        <div className="flex gap-2">
          {(['acik', 'koyu'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`${deger.taban === t ? 'tus-birincil' : 'tus-ikincil'} flex-1`}
              onClick={() => degistir({ taban: t })}
            >
              {t === 'acik' ? 'Açık taban' : 'Koyu taban'}
            </button>
          ))}
        </div>
      </Alan>

      <div className="grid grid-cols-2 gap-3">
        {RENKLER.map((r) => (
          <label key={r.alan} className="flex items-center gap-3 rounded-md border border-cizgi bg-yuzey p-2.5">
            <input
              id={`ozel-tema-${r.alan}`}
              type="color"
              className="h-10 w-12 cursor-pointer rounded border border-cizgi bg-transparent p-0.5"
              value={deger[r.alan]}
              onChange={(e) => degistir({ [r.alan]: e.target.value })}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{r.etiket}</span>
              <span className="block font-mono text-xs text-metin-3">
                {deger[r.alan]} · {r.ipucu}
              </span>
            </span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-metin-3">Okunurluk:</span>
        <Rozet tur={yaziKontrasti >= 4.5 ? 'basari' : 'tehlike'}>Yazı / kart {yaziKontrasti.toFixed(1)}</Rozet>
        <Rozet tur={zeminKontrasti >= 4.5 ? 'basari' : 'tehlike'}>Yazı / zemin {zeminKontrasti.toFixed(1)}</Rozet>
        <Rozet tur={vurguKontrasti >= 3 ? 'basari' : 'uyari'}>Vurgu / kart {vurguKontrasti.toFixed(1)}</Rozet>
      </div>
      {zayif && (
        <p className="rounded-md border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm text-tehlike">
          Yazı arka plana çok yakın: gün boyu bakılan ekranda okumak yorar. En az 4,5 önerilir; yazıyı koyulaştırın ya da zemini
          açın.
        </p>
      )}

      <Alan
        etiket={`Yazı boyutu: %${deger.yaziOlcegi}`}
        ipucu="Bütün arayüz orantılı büyür. Dokunmatik ekranda %110–120 rahattır."
      >
        <input
          id="ozel-tema-yazi-olcegi"
          type="range"
          min={YAZI_OLCEGI_SINIRI.en}
          max={YAZI_OLCEGI_SINIRI.cok}
          step={5}
          value={deger.yaziOlcegi}
          onChange={(e) => degistir({ yaziOlcegi: Number(e.target.value) })}
          className="w-full accent-[rgb(var(--vurgu))]"
        />
      </Alan>

      <div className="grid grid-cols-2 gap-3">
        <Alan etiket="Yazı tipi">
          <select
            id="ozel-tema-yazi-tipi"
            className="alan"
            value={deger.yaziTipi}
            onChange={(e) => degistir({ yaziTipi: e.target.value as YaziTipi })}
          >
            {(Object.keys(YAZI_TIPLERI) as YaziTipi[]).map((k) => (
              <option key={k} value={k} style={{ fontFamily: YAZI_TIPLERI[k].yigin }}>
                {YAZI_TIPLERI[k].etiket}
              </option>
            ))}
          </select>
        </Alan>
        <Alan etiket="Köşeler">
          <div className="flex gap-1.5">
            {(Object.keys(KOSE_CARPANI) as KoseBicimi[]).map((k) => (
              <button
                key={k}
                type="button"
                className={`${deger.kose === k ? 'tus-birincil' : 'tus-ikincil'} flex-1 px-2`}
                onClick={() => degistir({ kose: k })}
              >
                {KOSE_ETIKETI[k]}
              </button>
            ))}
          </div>
        </Alan>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-cizgi pt-3">
        <p className="text-xs text-metin-3">Değişiklikler ekranda hemen görünür; kalıcı olması için Kaydet'e basın.</p>
        <button type="button" className="tus-ikincil text-sm" onClick={() => onDegis(VARSAYILAN_OZEL_TEMA)}>
          Varsayılana dön
        </button>
      </div>
    </div>
  );
}
