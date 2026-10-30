/**
 * Faturalı satış: alıcı bilgisi (e-Arşiv / e-Fatura).
 *
 * Kasiyer vergi no ya da TC kimlik no yazıp "GİB'den Getir"e basar; Pavo
 * unvanı, vergi dairesini ve adresi doldurur. Bulunamazsa elle yazılır.
 * Hangi belgenin (e-Fatura mı e-Arşiv mi) kesileceğine cihaz GİB kaydına
 * bakarak karar verir.
 */

import { useEffect, useState } from 'react';
import { faturaAlicisiDogrula, kimlikTuru, type FaturaAlicisi } from '@market/shared';
import { Alan, Diyalog } from '../../bilesen/temel';
import { bildir, hatayiBildir } from '../../durum/bildirim';
import { cagir } from '../../kopru';

const BOS: FaturaAlicisi = {
  kimlikNo: '',
  ad: '',
  soyad: '',
  unvan: '',
  vergiDairesi: '',
  vergiDairesiKodu: '',
  il: '',
  ilce: '',
  adres: '',
  eposta: '',
  telefon: '',
};

export function FaturaBilgisiDiyalogu({
  acik,
  baslangic,
  onKapat,
  onKaydet,
}: {
  acik: boolean;
  baslangic: FaturaAlicisi | null;
  onKapat: () => void;
  onKaydet: (alici: FaturaAlicisi) => void;
}) {
  const [a, setA] = useState<FaturaAlicisi>(BOS);
  const [sorguluyor, setSorguluyor] = useState(false);

  useEffect(() => {
    if (acik) setA(baslangic ?? BOS);
  }, [acik, baslangic]);

  const tur = kimlikTuru(a.kimlikNo);
  const sorun = faturaAlicisiDogrula(a);
  const alan = (k: keyof FaturaAlicisi) => ({
    value: (a[k] as string | null | undefined) ?? '',
    onChange: (e: { target: { value: string } }) => setA((o) => ({ ...o, [k]: e.target.value })),
  });

  const sorgula = async () => {
    if (!tur) {
      bildir.uyari('Numara geçersiz', 'Vergi no 10, TC kimlik no 11 hanedir.');
      return;
    }
    setSorguluyor(true);
    try {
      const bilgi = await cagir<FaturaAlicisi>('pavo.mukellefSorgula', { kimlikNo: a.kimlikNo });
      // GİB'de boş gelen alan (ör. e-posta) kasiyerin yazdığını silmesin.
      setA((o) => {
        const yeni = { ...o };
        for (const [k, v] of Object.entries(bilgi) as [keyof FaturaAlicisi, string | null][]) {
          if (v) (yeni as Record<string, unknown>)[k] = v;
        }
        return yeni;
      });
      bildir.basari('GİB kaydı bulundu', bilgi.unvan || [bilgi.ad, bilgi.soyad].filter(Boolean).join(' '));
    } catch (hata) {
      hatayiBildir(hata, 'GİB sorgusu');
    } finally {
      setSorguluyor(false);
    }
  };

  return (
    <Diyalog
      acik={acik}
      baslik="Faturalı Satış"
      aciklama="e-Arşiv / e-Fatura — belgeyi Pavo keser; alıcı e-Fatura mükellefiyse e-Fatura, değilse e-Arşiv."
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" disabled={Boolean(sorun)} onClick={() => onKaydet(a)}>
            Faturayı Bu Bilgilerle Kes
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="flex items-end gap-2">
          <Alan etiket="Vergi no (şirket) ya da TC kimlik no (şahıs)">
            <input
              className="alan sayi font-mono text-lg"
              inputMode="numeric"
              maxLength={11}
              {...alan('kimlikNo')}
              onChange={(e) => setA((o) => ({ ...o, kimlikNo: e.target.value.replace(/\D/g, '') }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void sorgula();
                }
              }}
              placeholder="10 ya da 11 hane"
              data-odak
            />
          </Alan>
          <button
            type="button"
            className="tus-birincil h-11 shrink-0"
            disabled={!tur || sorguluyor}
            onClick={() => void sorgula()}
          >
            {sorguluyor ? 'Sorgulanıyor…' : "GİB'den Getir"}
          </button>
        </div>
        <p className="-mt-1 text-xs text-metin-3">
          {tur === 'VKN'
            ? 'Şirket (vergi no)'
            : tur === 'TCKN'
              ? 'Şahıs (TC kimlik no)'
              : a.kimlikNo.length >= 10
                ? 'Numara geçersiz — kontrol hanesi tutmuyor.'
                : 'Numarayı yazıp GİB’den getirin; bulunamazsa aşağıyı elle doldurun.'}
        </p>

        {tur === 'VKN' ? (
          <Alan etiket="Şirket unvanı *">
            <input className="alan" {...alan('unvan')} />
          </Alan>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Alan etiket="Ad *">
              <input className="alan" {...alan('ad')} />
            </Alan>
            <Alan etiket="Soyad *">
              <input className="alan" {...alan('soyad')} />
            </Alan>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Alan etiket={tur === 'VKN' ? 'Vergi dairesi *' : 'Vergi dairesi'}>
            <input
              className="alan"
              {...alan('vergiDairesi')}
              // Ad elle değişirse GİB kodu artık ona ait değildir.
              onChange={(e) => setA((o) => ({ ...o, vergiDairesi: e.target.value, vergiDairesiKodu: '' }))}
            />
          </Alan>
          <Alan etiket="Vergi dairesi kodu" ipucu="GİB'den gelir; yanlış kod satışı durdurur.">
            <input className="alan font-mono" {...alan('vergiDairesiKodu')} />
          </Alan>
          <Alan etiket="İl *">
            <input className="alan" {...alan('il')} />
          </Alan>
          <Alan etiket="İlçe *">
            <input className="alan" {...alan('ilce')} />
          </Alan>
        </div>
        <Alan etiket="Adres">
          <input className="alan" {...alan('adres')} />
        </Alan>
        <div className="grid grid-cols-2 gap-2">
          <Alan etiket="E-posta" ipucu="e-Arşiv faturası bu adrese de gider.">
            <input className="alan" type="email" {...alan('eposta')} />
          </Alan>
          <Alan etiket="Telefon">
            <input className="alan" inputMode="tel" {...alan('telefon')} />
          </Alan>
        </div>
        {sorun && a.kimlikNo.length > 0 && <p className="text-sm text-uyari">Eksik: {sorun}</p>}
      </div>
    </Diyalog>
  );
}
