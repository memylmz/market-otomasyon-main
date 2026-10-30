/**
 * Ayarlar → Satış Kuralları: YILLIK FATURA DÜZENLEME SINIRI (VUK 232).
 *
 * Her yıl Aralık sonunda Resmi Gazete'de yeni tutar çıkar; yönetici buraya
 * girer — kod değişmez. Tek satış bu tutara ulaşırsa ödeme ekranı uyarır ve
 * Pavo tanımlıysa fatura bilgisi girilmeden satışı tamamlatmaz.
 */

import { useState } from 'react';
import { AYAR, faturaSinirlariCoz, faturaSiniriIcin, paraFormat, paraParse, type FaturaSinirlari } from '@market/shared';
import { ParaAlani } from '../../bilesen/temel';

export function FaturaSinirlariBolumu({
  ayarlar,
  ayarla,
}: {
  ayarlar: Record<string, string>;
  ayarla: (a: string, d: string) => void;
}) {
  const sinirlar = faturaSinirlariCoz(ayarlar[AYAR.FATURA_SINIRLARI]);
  const simdi = faturaSiniriIcin(sinirlar);
  const buYil = new Date().getFullYear();
  const yillar = Object.keys(sinirlar)
    .map(Number)
    .sort((a, b) => b - a);
  const [yeniYil, setYeniYil] = useState(String(buYil + (sinirlar[buYil] ? 1 : 0)));
  const [yeniTutar, setYeniTutar] = useState(0);

  const yaz = (yeni: FaturaSinirlari) => ayarla(AYAR.FATURA_SINIRLARI, JSON.stringify(yeni));

  return (
    <section className="grid gap-2 rounded-lg border border-cizgi p-4">
      <h3 className="font-semibold">Fatura düzenleme sınırı (yıllık, VUK 232)</h3>
      <p className="text-sm text-metin-3">
        Tek satış bu tutara ulaşırsa yazarkasa fişi yetmez, <b>fatura zorunludur</b>; ödeme ekranı uyarır. Yeni yılın tutarı her
        yıl Aralık sonunda <b>Resmi Gazete</b>&apos;deki Vergi Usul Kanunu genel tebliğiyle açıklanır — buraya girin. Kesin tutarı
        mali müşavirinize doğrulatın.
      </p>
      {simdi.eksik && (
        <p className="rounded border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm text-tehlike">
          {buYil} yılının sınırı <b>girilmedi</b> — şimdilik {simdi.yil} sınırı ({paraFormat(simdi.tutar)}) kullanılıyor. Resmi
          Gazete&apos;deki yeni tutarı ekleyin.
        </p>
      )}
      <table className="tablo max-w-md">
        <thead>
          <tr>
            <th>Yıl</th>
            <th className="text-right">Sınır (KDV dahil)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {yillar.map((y) => (
            <tr key={y} className={y === buYil ? 'font-semibold' : ''}>
              <td>
                {y}
                {y === simdi.yil && !simdi.eksik && <span className="ml-2 text-xs text-vurgu">geçerli</span>}
              </td>
              <td className="w-44">
                <ParaAlani deger={sinirlar[y] ?? 0} sinif="text-right" onDegisim={(v) => v > 0 && yaz({ ...sinirlar, [y]: v })} />
              </td>
              <td className="text-right">
                <button
                  type="button"
                  className="text-sm text-tehlike hover:underline disabled:opacity-40"
                  disabled={yillar.length <= 1}
                  onClick={() => {
                    const yeni = { ...sinirlar };
                    delete yeni[y];
                    yaz(yeni);
                  }}
                >
                  Sil
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="etiket">Yıl</span>
          <input className="alan sayi w-24" inputMode="numeric" value={yeniYil} onChange={(e) => setYeniYil(e.target.value)} />
        </label>
        <label>
          <span className="etiket">Tutar (TL)</span>
          <ParaAlani deger={yeniTutar} onDegisim={setYeniTutar} sinif="w-40" />
        </label>
        <button
          type="button"
          className="tus-ikincil"
          disabled={!/^20\d\d$/.test(yeniYil) || yeniTutar <= 0}
          onClick={() => {
            yaz({ ...sinirlar, [Number(yeniYil)]: yeniTutar });
            setYeniTutar(0);
          }}
        >
          Yıl ekle
        </button>
      </div>
      <p className="text-xs text-metin-4">
        Değişiklik Kaydet&apos;e basınca geçerli olur. Ör. {paraFormat(paraParse('12000') ?? 0)} yazmak için &quot;12000&quot;
        girin.
      </p>
    </section>
  );
}
