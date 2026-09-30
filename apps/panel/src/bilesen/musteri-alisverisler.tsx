/**
 * Müşterinin alışveriş geçmişi — kasadaki Cari → Alışverişler görünümünün
 * panel karşılığı. Ekstre yalnız BORCU gösterir; nakit ya da kartla yapılmış
 * alışveriş orada görünmez. Süzgeç kuralları kasayla aynıdır (merkezde).
 */

'use client';

import { useState } from 'react';
import { paraFormat, tarihSaatFormat, type Kurus } from '@market/shared';
import { BosDurum, HataKutusu, Rozet, Yukleniyor } from './kabuk';
import { uclar } from '@/lib/api';
import { useVeri } from '@/lib/kanca';

type Durum = 'tumu' | 'odenmis' | 'borc';

interface Alisveris {
  id: string;
  fis_no: string;
  tarih: string;
  genel_toplam: Kurus;
  iptal_mi: number;
  iade_mi: number;
  kullanici_adi: string | null;
  nakit: Kurus;
  kart: Kurus;
  veresiye: Kurus;
}

const SUZGECLER: { anahtar: Durum; etiket: string }[] = [
  { anahtar: 'tumu', etiket: 'Tümü' },
  { anahtar: 'odenmis', etiket: 'Ödenmiş' },
  { anahtar: 'borc', etiket: 'Borç (veresiye)' },
];

export function MusteriAlisverisleri({
  cariId,
  from,
  to,
  onFisAc,
}: {
  cariId: string;
  from: string;
  to: string;
  onFisAc: (satisId: string) => void;
}) {
  const [durum, setDurum] = useState<Durum>('tumu');
  const aralik = [from ? `from=${from}` : '', to ? `to=${to}` : ''].filter(Boolean).join('&');
  const { veri, yukleniyor, hata, tazele } = useVeri<{ data: Alisveris[] }>(
    `${uclar.cariler}/${cariId}/alisverisler?durum=${durum}${aralik ? `&${aralik}` : ''}`,
    [cariId, durum, from, to],
  );
  const liste = veri?.data ?? [];
  // İptal edilen satış toplamlara girmez; iade tutarı zaten eksi gelir.
  const gecerli = liste.filter((s) => !Number(s.iptal_mi));
  const toplam = (a: 'genel_toplam' | 'nakit' | 'kart' | 'veresiye') => gecerli.reduce((t, s) => t + Number(s[a]), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-cizgi">
          {SUZGECLER.map((s) => (
            <button
              key={s.anahtar}
              type="button"
              onClick={() => setDurum(s.anahtar)}
              className={`px-3 py-1.5 text-sm ${durum === s.anahtar ? 'bg-vurgu text-vurgu-uzeri' : 'text-metin-2'}`}
            >
              {s.etiket}
            </button>
          ))}
        </div>
        {veri && (
          <span className="ml-auto text-xs text-metin-3">
            {gecerli.length} alışveriş · {paraFormat(toplam('genel_toplam'))}
          </span>
        )}
      </div>

      {gecerli.length > 0 && (
        <div className="grid grid-cols-3 gap-2 text-sm">
          {(
            [
              ['Nakit', 'nakit'],
              ['Kart', 'kart'],
              ['Veresiye', 'veresiye'],
            ] as const
          ).map(([etiket, alan]) => (
            <div key={alan} className="rounded-lg border border-cizgi px-3 py-2">
              <div className="text-xs text-metin-4">{etiket}</div>
              <div className={`font-mono font-semibold ${alan === 'veresiye' && toplam(alan) > 0 ? 'text-uyari' : ''}`}>
                {paraFormat(toplam(alan))}
              </div>
            </div>
          ))}
        </div>
      )}

      {yukleniyor && !veri ? (
        <Yukleniyor />
      ) : hata ? (
        <HataKutusu mesaj={hata} tekrarDene={tazele} />
      ) : liste.length === 0 ? (
        <BosDurum
          baslik="Alışveriş yok"
          aciklama={durum === 'tumu' ? 'Bu müşteri adına satış yok.' : 'Bu süzgece uyan alışveriş yok.'}
        />
      ) : (
        <div className="tablo-sarmal">
          <table className="tablo">
            <thead>
              <tr>
                <th className="text-left">Tarih</th>
                <th className="text-left">Fiş</th>
                <th className="text-left">Ödeme</th>
                <th className="text-right">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-yuzey-2" onClick={() => onFisAc(s.id)}>
                  <td className="whitespace-nowrap text-left text-metin-3">{tarihSaatFormat(s.tarih)}</td>
                  <td className="text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{s.fis_no}</span>
                      {Number(s.iptal_mi) ? <Rozet tur="tehlike">İptal</Rozet> : null}
                      {Number(s.iade_mi) ? <Rozet tur="uyari">İade</Rozet> : null}
                      <span className="text-xs text-vurgu">fişi gör →</span>
                    </div>
                    {s.kullanici_adi && <div className="text-xs text-metin-4">Kasiyer: {s.kullanici_adi}</div>}
                  </td>
                  <td className="text-left">
                    <div className="flex flex-wrap gap-1">
                      {Number(s.nakit) !== 0 && <Rozet tur="notr">Nakit {paraFormat(s.nakit, { simge: false })}</Rozet>}
                      {Number(s.kart) !== 0 && <Rozet tur="bilgi">Kart {paraFormat(s.kart, { simge: false })}</Rozet>}
                      {Number(s.veresiye) !== 0 && <Rozet tur="uyari">Veresiye {paraFormat(s.veresiye, { simge: false })}</Rozet>}
                    </div>
                  </td>
                  <td className={`sayi text-right font-semibold ${Number(s.iptal_mi) ? 'text-metin-4 line-through' : ''}`}>
                    {paraFormat(s.genel_toplam, { simge: false })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-metin-4">
        Süzgeç satışın ödeme şekline bakar. Sonradan yapılan tahsilatlar fişe değil genel bakiyeye düşer; güncel borç için Hesap
        Hareketleri&apos;ne bakın.
      </p>
    </div>
  );
}
