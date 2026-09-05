/** Panel grafikleri — Recharts, mobil-öncelikli responsive, tema duyarlı. */

'use client';

import { useEffect, useState } from 'react';
import { paraFormat, tarihFormat, type Kurus } from '@market/shared';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/**
 * Recharts renkleri SVG özniteliği olarak verilir; Tailwind sınıfı geçmez.
 * Bu yüzden tema değişkenleri çalışma anında okunur ve `data-tema` değişince
 * yeniden okunur — aksi hâlde açık temada koyu tema renkleri kalırdı.
 */
function useTemaRenkleri() {
  const [renkler, setRenkler] = useState({
    cizgi: '#e2e8f0',
    metin: '#64748b',
    yuzey: '#ffffff',
    vurgu: '#047857',
    uyari: '#b45309',
    tehlike: '#b91c1c',
    bilgi: '#0369a1',
  });

  useEffect(() => {
    const oku = () => {
      const stil = getComputedStyle(document.documentElement);
      const kanal = (ad: string, yedek: string) => {
        const deger = stil.getPropertyValue(ad).trim();
        return deger ? `rgb(${deger})` : yedek;
      };
      setRenkler({
        cizgi: kanal('--cizgi', '#e2e8f0'),
        metin: kanal('--metin-3', '#64748b'),
        yuzey: kanal('--yuzey', '#ffffff'),
        vurgu: kanal('--vurgu', '#047857'),
        uyari: kanal('--uyari', '#b45309'),
        tehlike: kanal('--tehlike', '#b91c1c'),
        bilgi: kanal('--bilgi', '#0369a1'),
      });
    };
    oku();
    const gozlemci = new MutationObserver(oku);
    gozlemci.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });
    return () => gozlemci.disconnect();
  }, []);

  return renkler;
}

export interface TrendNoktasi {
  tarih: string;
  ciro: Kurus;
  islem_sayisi: number;
}

export function CiroTrendi({ veri }: { veri: TrendNoktasi[] }) {
  const renk = useTemaRenkleri();

  if (veri.length === 0) {
    return <p className="py-10 text-center text-sm text-metin-4">Bu aralıkta satış verisi yok.</p>;
  }

  const grafikVerisi = veri.map((n) => ({
    // Mobilde eksen dar; yalnız gün.ay gösterilir.
    etiket: tarihFormat(n.tarih).slice(0, 5),
    ciro: n.ciro / 100,
    islem: n.islem_sayisi,
  }));

  const ipucuStili = { background: renk.yuzey, border: `1px solid ${renk.cizgi}`, borderRadius: 8, fontSize: 12 };

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={grafikVerisi} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={renk.cizgi} vertical={false} />
          <XAxis dataKey="etiket" stroke={renk.metin} fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke={renk.metin} fontSize={11} tickLine={false} axisLine={false} width={56} />
          <Tooltip
            contentStyle={ipucuStili}
            cursor={{ fill: renk.cizgi, opacity: 0.35 }}
            formatter={(deger: number, ad: string) =>
              ad === 'ciro' ? [paraFormat(Math.round(deger * 100)), 'Ciro'] : [String(deger), 'İşlem']
            }
          />
          <Bar dataKey="ciro" fill={renk.vurgu} radius={[4, 4, 0, 0]} name="ciro" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OdemeKirilimi({ nakit, kart, veresiye }: { nakit: Kurus; kart: Kurus; veresiye: Kurus }) {
  const renk = useTemaRenkleri();
  const veri = [
    { ad: 'Nakit', deger: Math.max(0, nakit), renk: renk.vurgu },
    { ad: 'Kart', deger: Math.max(0, kart), renk: renk.bilgi },
    { ad: 'Veresiye', deger: Math.max(0, veresiye), renk: renk.uyari },
  ].filter((d) => d.deger > 0);

  if (veri.length === 0) {
    return <p className="py-10 text-center text-sm text-metin-4">Ödeme verisi yok.</p>;
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={veri} dataKey="deger" nameKey="ad" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
            {veri.map((d) => (
              <Cell key={d.ad} fill={d.renk} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: renk.yuzey, border: `1px solid ${renk.cizgi}`, borderRadius: 8, fontSize: 12 }}
            formatter={(deger: number, ad: string) => [paraFormat(deger), ad]}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: renk.metin }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function YaslandirmaGrafigi({ dilimler }: { dilimler: { dilim: string; tutar: Kurus }[] }) {
  const renk = useTemaRenkleri();
  const veri = dilimler.map((d) => ({ ad: d.dilim, tutar: d.tutar / 100 }));
  // Yaşlandırmada renk anlam taşır: yaşlandıkça riskli (yeşil → sarı → kırmızı).
  const dilimRenkleri = [renk.vurgu, renk.uyari, renk.uyari, renk.tehlike];

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={veri} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={renk.cizgi} vertical={false} />
          <XAxis dataKey="ad" stroke={renk.metin} fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke={renk.metin} fontSize={11} tickLine={false} axisLine={false} width={56} />
          <Tooltip
            contentStyle={{ background: renk.yuzey, border: `1px solid ${renk.cizgi}`, borderRadius: 8, fontSize: 12 }}
            cursor={{ fill: renk.cizgi, opacity: 0.35 }}
            formatter={(deger: number) => [paraFormat(Math.round(deger * 100)), 'Tutar']}
          />
          <Bar dataKey="tutar" radius={[4, 4, 0, 0]}>
            {veri.map((d, i) => (
              <Cell key={d.ad} fill={dilimRenkleri[i] ?? renk.metin} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
