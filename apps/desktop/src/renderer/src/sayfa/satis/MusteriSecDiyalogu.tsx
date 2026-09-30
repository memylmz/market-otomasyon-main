/** Müşteri seçimi (F6) — veresiye satış için (§10.3, §10.7). */

import { useEffect, useRef, useState } from 'react';
import { paraFormat, paraParse, type Kurus } from '@market/shared';
import { Alan, Diyalog, Kisayol, Rozet, Yukleniyor } from '../../bilesen/temel';
import { bildir, hatayiBildir } from '../../durum/bildirim';
import { cagir } from '../../kopru';

interface CariSatiri {
  id: string;
  ad_unvan: string;
  telefon: string | null;
  bakiye: Kurus;
  kredi_limiti: Kurus;
  aktif_mi: boolean;
}

export function MusteriSecDiyalogu({
  acik,
  onKapat,
  onSec,
}: {
  acik: boolean;
  onKapat: () => void;
  onSec: (id: string | null, ad: string | null) => void;
}) {
  const [terim, setTerim] = useState('');
  const [sonuclar, setSonuclar] = useState<CariSatiri[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [secili, setSecili] = useState(0);
  const alan = useRef<HTMLInputElement>(null);
  const [yeniAcik, setYeniAcik] = useState(false);

  useEffect(() => {
    if (acik) {
      setTerim('');
      setSecili(0);
      setTimeout(() => alan.current?.focus(), 20);
    }
  }, [acik]);

  useEffect(() => {
    if (!acik) return;
    let iptal = false;
    setYukleniyor(true);
    const zamanlayici = setTimeout(async () => {
      try {
        const veri = await cagir<{ kayitlar: CariSatiri[] }>('cari.listele', {
          filtre: { tip: 'MUSTERI', arama: terim || undefined },
          limit: 40,
        });
        if (!iptal) {
          setSonuclar(veri.kayitlar);
          setSecili(0);
        }
      } catch (hata) {
        if (!iptal) hatayiBildir(hata, 'Müşteri arama');
      } finally {
        if (!iptal) setYukleniyor(false);
      }
    }, 180);
    return () => {
      iptal = true;
      clearTimeout(zamanlayici);
    };
  }, [terim, acik]);

  const onayla = () => {
    const cari = sonuclar[secili];
    if (cari) onSec(cari.id, cari.ad_unvan);
  };

  return (
    <Diyalog
      acik={acik}
      baslik="Müşteri Seç"
      aciklama="Veresiye satış ve cari takip için müşteri seçin."
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil mr-auto" onClick={() => onSec(null, null)}>
            Müşteriyi Kaldır
          </button>
          {/* Yeni müşteri buradan açılır: kasiyerin satışı bırakıp Cari Hesap
              ekranına gitmesi, sepeti bekleyen müşterinin önünde yarıda
              bırakması demekti (§10.7). */}
          <button type="button" className="tus-ikincil" onClick={() => setYeniAcik(true)}>
            + Yeni Müşteri
          </button>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={onayla} disabled={sonuclar.length === 0}>
            Seç <Kisayol>Enter</Kisayol>
          </button>
        </>
      }
    >
      <input
        ref={alan}
        type="text"
        className="alan"
        placeholder="Ad, unvan veya telefon…"
        value={terim}
        onChange={(e) => setTerim(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSecili((s) => Math.min(s + 1, sonuclar.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSecili((s) => Math.max(s - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            onayla();
          }
        }}
      />

      <div className="mt-3 max-h-80 overflow-y-auto">
        {yukleniyor && sonuclar.length === 0 ? (
          <Yukleniyor />
        ) : sonuclar.length === 0 ? (
          <p className="py-8 text-center text-sm text-metin-4">
            Müşteri bulunamadı. Aşağıdaki “+ Yeni Müşteri” ile hemen ekleyebilirsiniz.
          </p>
        ) : (
          <table className="tablo">
            <thead>
              <tr>
                <th>Müşteri</th>
                <th className="text-right">Bakiye</th>
                <th className="text-right">Limit</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {sonuclar.map((cari, i) => {
                const limitDoldu = cari.kredi_limiti > 0 && cari.bakiye >= cari.kredi_limiti;
                return (
                  <tr
                    key={cari.id}
                    onClick={() => setSecili(i)}
                    onDoubleClick={onayla}
                    className={`cursor-pointer ${i === secili ? 'bg-yuzey-4/70 outline outline-1 outline-vurgu' : ''}`}
                  >
                    <td>
                      <div className="font-medium">{cari.ad_unvan}</div>
                      {cari.telefon && <div className="text-xs text-metin-4">{cari.telefon}</div>}
                    </td>
                    <td className={`text-right sayi ${cari.bakiye > 0 ? 'text-uyari' : ''}`}>
                      {paraFormat(cari.bakiye, { simge: false })}
                    </td>
                    <td className="sayi text-metin-3 text-right">
                      {cari.kredi_limiti > 0 ? paraFormat(cari.kredi_limiti, { simge: false }) : 'Sınırsız'}
                    </td>
                    <td>{limitDoldu ? <Rozet tur="tehlike">Limit doldu</Rozet> : <Rozet tur="basari">Uygun</Rozet>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <YeniMusteriDiyalogu
        acik={yeniAcik}
        baslangicAdi={terim.trim()}
        onKapat={() => setYeniAcik(false)}
        onEklendi={(id, ad) => {
          setYeniAcik(false);
          // Eklenen müşteri doğrudan seçilir: kasiyer ikinci kez aramak zorunda
          // kalmasın, zaten onun için ekledi.
          onSec(id, ad);
        }}
      />
    </Diyalog>
  );
}

/** Satış ekranından hızlı müşteri açma — yalnız ad ve telefon (§10.7). */
function YeniMusteriDiyalogu({
  acik,
  baslangicAdi,
  onKapat,
  onEklendi,
}: {
  acik: boolean;
  baslangicAdi: string;
  onKapat: () => void;
  onEklendi: (id: string, ad: string) => void;
}) {
  const [ad, setAd] = useState('');
  const [telefon, setTelefon] = useState('');
  const [krediLimiti, setKrediLimiti] = useState('');
  const [calisiyor, setCalisiyor] = useState(false);

  useEffect(() => {
    if (acik) {
      // Aranan terim büyük ihtimalle müşterinin adıdır; tekrar yazdırmayalım.
      setAd(baslangicAdi);
      setTelefon('');
      setKrediLimiti('');
    }
  }, [acik, baslangicAdi]);

  if (!acik) return null;

  const gecerli = ad.trim().length > 0;

  const kaydet = async () => {
    if (!gecerli) return;
    setCalisiyor(true);
    try {
      const sonuc = await cagir<{ id: string }>('cari.kaydet', {
        tip: 'MUSTERI',
        ad_unvan: ad.trim(),
        telefon: telefon.trim() || null,
        kredi_limiti: paraParse(krediLimiti) ?? 0,
      });
      bildir.basari(`${ad.trim()} eklendi`);
      onEklendi(sonuc.id, ad.trim());
    } catch (hata) {
      hatayiBildir(hata, 'Müşteri ekleme');
    } finally {
      setCalisiyor(false);
    }
  };

  return (
    <Diyalog
      acik
      baslik="Yeni Müşteri"
      aciklama="Veresiye satış için gereken en az bilgi. Ayrıntıyı Cari Hesap ekranından tamamlayabilirsiniz."
      genislik="dar"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={() => void kaydet()} disabled={!gecerli || calisiyor}>
            {calisiyor ? 'Ekleniyor…' : 'Ekle ve Seç'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Alan etiket="Ad soyad *">
          <input
            className="alan py-3 text-lg"
            value={ad}
            onChange={(e) => setAd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && gecerli) void kaydet();
            }}
            data-odak
            autoFocus
          />
        </Alan>
        <Alan etiket="Telefon">
          <input
            className="alan"
            inputMode="tel"
            placeholder="0555 000 00 00"
            value={telefon}
            onChange={(e) => setTelefon(e.target.value)}
          />
        </Alan>
        <Alan etiket="Kredi limiti" ipucu="Boş bırakılırsa limitsiz sayılmaz — limit 0 olur, aşımda uyarı çıkar.">
          <input
            className="alan sayi"
            inputMode="decimal"
            placeholder="0,00"
            value={krediLimiti}
            onChange={(e) => setKrediLimiti(e.target.value)}
          />
        </Alan>
      </div>
    </Diyalog>
  );
}
