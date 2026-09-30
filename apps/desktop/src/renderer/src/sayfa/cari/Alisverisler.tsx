/** Müşterinin alışveriş geçmişi — cari ekstresinin yanında ikinci görünüm. */

import { useEffect, useState } from 'react';
import { paraFormat, tarihSaatFormat, type Kurus } from '@market/shared';
import { BosDurum, Rozet, Yukleniyor } from '../../bilesen/temel';
import { hatayiBildir } from '../../durum/bildirim';
import { cagir } from '../../kopru';

type Durum = 'tumu' | 'odenmis' | 'borc';

interface Alisveris {
  id: string;
  fis_no: string;
  tarih: string;
  genel_toplam: Kurus;
  iptal_mi: boolean;
  iade_mi: boolean;
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

/**
 * Ekstre yalnız BORCU gösterir; müşterinin nakit ya da kartla yaptığı
 * alışveriş orada hiç görünmez. Bu görünüm her alışverişi ödeme dökümüyle
 * listeler, satıra tıklayınca fiş açılır.
 */
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
  const [liste, setListe] = useState<Alisveris[] | null>(null);

  useEffect(() => {
    let iptal = false;
    setListe(null);
    cagir<Alisveris[]>('cari.alisverisler', { cariId, durum, from: from || undefined, to: to || undefined })
      .then((v) => !iptal && setListe(v))
      .catch((hata) => {
        hatayiBildir(hata, 'Alışverişler');
        if (!iptal) setListe([]);
      });
    return () => {
      iptal = true;
    };
  }, [cariId, durum, from, to]);

  // İptal edilen satış toplamlara girmez; iade tutarı zaten eksi gelir.
  const gecerli = (liste ?? []).filter((s) => !s.iptal_mi);
  const toplam = (anahtar: 'genel_toplam' | 'nakit' | 'kart' | 'veresiye') => gecerli.reduce((t, s) => t + s[anahtar], 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-cizgi-kuvvetli">
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
        {liste && (
          <span className="ml-auto text-xs text-metin-3">
            {gecerli.length} alışveriş · {paraFormat(toplam('genel_toplam'))}
          </span>
        )}
      </div>

      {liste && gecerli.length > 0 && (
        <div className="grid grid-cols-3 gap-2 text-sm">
          <Ozet etiket="Nakit" tutar={toplam('nakit')} />
          <Ozet etiket="Kart" tutar={toplam('kart')} />
          <Ozet etiket="Veresiye" tutar={toplam('veresiye')} uyari />
        </div>
      )}

      <div className="kart min-h-0 flex-1 overflow-auto">
        {liste === null ? (
          <Yukleniyor />
        ) : liste.length === 0 ? (
          <BosDurum
            baslik="Alışveriş yok"
            aciklama={durum === 'tumu' ? 'Bu müşteri adına kaydedilmiş satış bulunmuyor.' : 'Bu süzgece uyan alışveriş yok.'}
          />
        ) : (
          <table className="tablo">
            <thead className="sticky top-0 bg-yuzey">
              <tr>
                <th>Tarih</th>
                <th>Fiş</th>
                <th>Ödeme</th>
                <th className="text-right">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-yuzey-2" onClick={() => onFisAc(s.id)}>
                  <td className="text-metin-3">{tarihSaatFormat(s.tarih)}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{s.fis_no}</span>
                      {s.iptal_mi && <Rozet tur="tehlike">İptal</Rozet>}
                      {s.iade_mi && <Rozet tur="uyari">İade</Rozet>}
                      <span className="text-xs text-vurgu">fişi gör →</span>
                    </div>
                    {s.kullanici_adi && <div className="text-xs text-metin-4">Kasiyer: {s.kullanici_adi}</div>}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {s.nakit !== 0 && <Rozet tur="notr">Nakit {paraFormat(s.nakit, { simge: false })}</Rozet>}
                      {s.kart !== 0 && <Rozet tur="bilgi">Kart {paraFormat(s.kart, { simge: false })}</Rozet>}
                      {s.veresiye !== 0 && <Rozet tur="uyari">Veresiye {paraFormat(s.veresiye, { simge: false })}</Rozet>}
                    </div>
                  </td>
                  <td className={`text-right sayi font-semibold ${s.iptal_mi ? 'text-metin-4 line-through' : ''}`}>
                    {paraFormat(s.genel_toplam, { simge: false })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-metin-4">
        Süzgeç satışın ödeme şekline bakar. Sonradan yapılan tahsilatlar belirli bir fişe değil müşterinin genel bakiyesine düşer;
        güncel borç için Hesap Hareketleri&apos;ne bakın.
      </p>
    </div>
  );
}

function Ozet({ etiket, tutar, uyari }: { etiket: string; tutar: Kurus; uyari?: boolean }) {
  return (
    <div className="rounded border border-cizgi px-3 py-2">
      <div className="text-xs text-metin-4">{etiket}</div>
      <div className={`font-mono font-semibold ${uyari && tutar > 0 ? 'text-uyari' : ''}`}>{paraFormat(tutar)}</div>
    </div>
  );
}
