/**
 * Ayarlar → Donanım → Etiket Yazıcısı → ETİKET DÜZENİ.
 *
 * Ürün adı, fiyat ve barkodun hizası ve büyüklüğü; çerçeve ve basım tarihi.
 * Sağdaki etiket önizlemesi kaydetmeden canlı değişir (yerleşim yazıcıyla
 * aynı koddan çizilir).
 */

import type { ReactNode } from 'react';
import { AYAR, etiketDuzeniCoz, type EtiketBoyut, type EtiketDuzeni, type EtiketHiza } from '@market/shared';

const HIZALAR: [EtiketHiza, string][] = [
  ['sol', 'Sola'],
  ['orta', 'Ortaya'],
  ['sag', 'Sağa'],
];
const BOYUTLAR: [EtiketBoyut, string][] = [
  ['kucuk', 'Küçük'],
  ['normal', 'Normal'],
  ['buyuk', 'Büyük'],
];

export function EtiketDuzeniAyarlari({
  ayarlar,
  ayarla,
}: {
  ayarlar: Record<string, string>;
  ayarla: (a: string, d: string) => void;
}) {
  const duzen = etiketDuzeniCoz(ayarlar[AYAR.ETIKET_DUZENI]);
  const degistir = (yama: Partial<EtiketDuzeni>) => ayarla(AYAR.ETIKET_DUZENI, JSON.stringify({ ...duzen, ...yama }));

  return (
    <div className="grid gap-3 rounded border border-cizgi bg-yuzey p-3">
      <div>
        <h4 className="font-semibold">Etiket düzeni</h4>
        <p className="text-xs text-metin-3">Sağdaki önizleme hemen değişir; etikete Kaydet&apos;ten sonra yansır.</p>
      </div>

      <Satir etiket="Ürün adı">
        <Secim secenekler={HIZALAR} deger={duzen.adHiza} sec={(adHiza) => degistir({ adHiza })} />
        <Secim secenekler={BOYUTLAR} deger={duzen.adBoyut} sec={(adBoyut) => degistir({ adBoyut })} />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={duzen.adIkiSatir} onChange={(e) => degistir({ adIkiSatir: e.target.checked })} />
          Uzun ad iki satıra
        </label>
      </Satir>

      <Satir etiket="Fiyat">
        <Secim secenekler={HIZALAR} deger={duzen.fiyatHiza} sec={(fiyatHiza) => degistir({ fiyatHiza })} />
        <Secim secenekler={BOYUTLAR} deger={duzen.fiyatBoyut} sec={(fiyatBoyut) => degistir({ fiyatBoyut })} />
      </Satir>

      <Satir etiket="Barkod">
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={duzen.barkodGoster} onChange={(e) => degistir({ barkodGoster: e.target.checked })} />
          Barkod bas
        </label>
        {duzen.barkodGoster && (
          <Secim secenekler={HIZALAR} deger={duzen.barkodHiza} sec={(barkodHiza) => degistir({ barkodHiza })} />
        )}
      </Satir>

      <Satir etiket="Diğer">
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={duzen.cerceve} onChange={(e) => degistir({ cerceve: e.target.checked })} />
          Çerçeve
        </label>
        <label className="flex items-center gap-1.5 text-sm" title="Rafta hangi etiketin eski olduğu anlaşılsın">
          <input type="checkbox" checked={duzen.tarihGoster} onChange={(e) => degistir({ tarihGoster: e.target.checked })} />
          Basım tarihi
        </label>
      </Satir>

      <button
        type="button"
        className="justify-self-start text-xs text-metin-3 hover:underline"
        onClick={() => ayarla(AYAR.ETIKET_DUZENI, '')}
      >
        Varsayılana dön
      </button>
    </div>
  );
}

function Satir({ etiket, children }: { etiket: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="w-20 shrink-0 text-sm font-medium text-metin-2">{etiket}</span>
      {children}
    </div>
  );
}

function Secim<T extends string>({ secenekler, deger, sec }: { secenekler: [T, string][]; deger: T; sec: (d: T) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-cizgi" role="group">
      {secenekler.map(([d, e]) => (
        <button
          key={d}
          type="button"
          aria-pressed={deger === d}
          onClick={() => sec(d)}
          className={`px-3 py-1.5 text-sm ${deger === d ? 'bg-vurgu text-vurgu-uzeri' : 'bg-yuzey hover:bg-yuzey-2'}`}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
