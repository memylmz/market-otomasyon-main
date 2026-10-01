/** Yerel raporlar (§10.10, §14) — özet tablolardan üretilir, hızlıdır. */

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  bugun,
  gunBasi,
  gunEkle,
  gunSonu,
  IADE_YONTEMI_ETIKETI,
  miktarFormat,
  paraFormat,
  tarihSaatFormat,
  type GunAnahtari,
  type IadeYontemi,
  type Kurus,
} from '@market/shared';
import { Alan, BosDurum, Diyalog, ParaAlani, Rozet, Yukleniyor } from '../bilesen/temel';
import { SatisFisiDiyalogu } from '../bilesen/SatisFisiDiyalogu';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { useYetki } from '../durum/oturum';
import { cagir } from '../kopru';

type Sekme = 'ozet' | 'urun' | 'saatlik' | 'kasa' | 'satislar' | 'banka' | 'suistimal' | 'denetim';

interface CiroOzeti {
  ciro: Kurus;
  iade: Kurus;
  netCiro: Kurus;
  islemSayisi: number;
  ortalamaSepet: Kurus;
  brutKar: Kurus;
  karMarji: number;
  nakit: Kurus;
  kart: Kurus;
  veresiye: Kurus;
  gider: Kurus;
  kdvToplam: Kurus;
}

const KANAL: Record<Sekme, string> = {
  ozet: 'rapor.gunluk',
  urun: 'rapor.urun',
  saatlik: 'rapor.saatlik',
  kasa: 'kasa.gecmis',
  satislar: 'satis.listele',
  banka: 'rapor.banka',
  suistimal: 'rapor.suistimal',
  denetim: 'denetim.listele',
};

/** Her görünüm kendi veri şeklini bekler; dizi bekleyenlere asla nesne sızmasın. */
function dizi(deger: unknown): Record<string, unknown>[] {
  return Array.isArray(deger) ? (deger as Record<string, unknown>[]) : [];
}

export function RaporlarSayfasi() {
  /*
   * Cari ve Kasa ekranlarındaki fiş penceresi salt okunurdur; iptal ve iade
   * yalnız buradan (Satışlar) yapılır. Oradan "İade / İptal" ile gelinirse
   * Satışlar sekmesi o fişin detayı açık olarak başlar.
   */
  const konum = useLocation();
  const yonlendirilenSatis = (konum.state as { satisId?: string } | null)?.satisId ?? null;
  const [acikSatis, setAcikSatis] = useState<string | null>(yonlendirilenSatis);
  const [sekme, setSekme] = useState<Sekme>(yonlendirilenSatis ? 'satislar' : 'ozet');
  // Sayfa zaten açıkken (Kasa Geçmişi'ndeki fişten) gelinirse bileşen yeniden
  // kurulmaz; başlangıç değeri işlemez, yönlendirme burada yakalanır.
  useEffect(() => {
    if (!yonlendirilenSatis) return;
    setSekme('satislar');
    setAcikSatis(yonlendirilenSatis);
  }, [konum.key, yonlendirilenSatis]);
  const [baslangic, setBaslangic] = useState<GunAnahtari>(gunEkle(bugun(), -6));
  const [bitis, setBitis] = useState<GunAnahtari>(bugun());
  /*
   * Veri, AİT OLDUĞU SEKME ile birlikte saklanır.
   *
   * ESKİDEN yalnız veri saklanıyordu: sekme değişir değişmez yeni sekmenin
   * bileşeni bir önceki sekmenin (farklı şekildeki) verisiyle render ediliyor,
   * `veri.map is not a function` benzeri bir hata tüm uygulamayı beyaz ekrana
   * düşürüyordu. Eşleşme kontrolü bunu kökten engeller: veri sekmeye ait
   * değilse içerik yerine yükleniyor göstergesi çizilir.
   */
  const [veri, setVeri] = useState<{ sekme: Sekme; icerik: unknown } | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const karGorebilir = useYetki('rapor.kar_gor');
  const denetimYetkisi = useYetki('denetim.goruntule');

  // Satış iptali sonrası listenin tazelenmesi için sayaç; artınca useEffect yeniden koşar.
  const [tazelik, setTazelik] = useState(0);

  useEffect(() => {
    // İptal bayrağı: hızlı sekme geçişinde geciken eski yanıt yenisini ezmesin.
    let iptal = false;
    setYukleniyor(true);
    const girdi =
      sekme === 'satislar'
        ? // Gün sınırı YEREL gündür: UTC gece yarısı (TR 03:00) 00:00-03:00 arasındaki satışları önceki güne atıyordu.
          { filtre: { baslangic: gunBasi(baslangic), bitis: gunSonu(bitis) }, limit: 200 }
        : sekme === 'denetim'
          ? { limit: 200 }
          : { from: baslangic, to: bitis };
    cagir<unknown>(KANAL[sekme], girdi)
      .then((sonuc) => {
        if (!iptal) setVeri({ sekme, icerik: sonuc });
      })
      .catch((hata) => {
        if (!iptal) {
          hatayiBildir(hata, 'Rapor');
          setVeri(null);
        }
      })
      .finally(() => {
        if (!iptal) setYukleniyor(false);
      });
    return () => {
      iptal = true;
    };
  }, [sekme, baslangic, bitis, tazelik]);

  /** Yalnız aktif sekmeye ait veri; değilse null → yükleniyor gösterilir. */
  const icerik = veri && veri.sekme === sekme ? veri.icerik : null;

  const csvIndir = () => {
    if (!icerik) return;
    const satirlar: string[] = [];
    if (sekme === 'ozet') {
      const gunler = dizi((icerik as Record<string, unknown>).gunler) as Record<string, number | string>[];
      satirlar.push('tarih;ciro;iade;islem;nakit;kart;veresiye;brut_kar');
      for (const g of gunler) {
        satirlar.push([g.tarih, g.ciro, g.iade_toplam, g.islem_sayisi, g.nakit, g.kart, g.veresiye, g.brut_kar].join(';'));
      }
    } else if (sekme === 'urun') {
      /*
       * Ürün raporu da SÜTUNLU çıkar.
       *
       * Eskiden özet dışındaki her sekme ham JSON olarak dışa aktarılıyordu:
       * dosya .csv uzantılıydı ama Excel'de tek hücrede bir metin yığını
       * olarak açılıyordu — yani dışa aktarma pratikte çalışmıyordu.
       */
      const k = icerik as Record<string, unknown>;
      satirlar.push('liste;urun;adet;ciro;kar');
      for (const u of dizi(k.enCokSatan) as Record<string, number | string>[]) {
        satirlar.push(['En çok satan', u.urun_adi, u.adet, u.ciro, u.kar].join(';'));
      }
      for (const u of dizi(k.enKarli) as Record<string, number | string>[]) {
        satirlar.push(['En kârlı', u.urun_adi, u.adet, u.ciro, u.kar].join(';'));
      }
      for (const u of dizi(k.oluStok) as Record<string, number | string>[]) {
        satirlar.push(['Ölü stok', u.ad, u.stok, '', u.bagli_sermaye].join(';'));
      }
    } else if (sekme === 'saatlik') {
      satirlar.push('saat;ciro;islem');
      for (const d of icerik as { saat: number; ciro: number; islem: number }[]) {
        satirlar.push([`${String(d.saat).padStart(2, '0')}:00`, d.ciro, d.islem].join(';'));
      }
    } else {
      satirlar.push(JSON.stringify(icerik));
    }
    const bag = document.createElement('a');
    bag.href = URL.createObjectURL(new Blob(['﻿' + satirlar.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    bag.download = `rapor-${sekme}-${baslangic}_${bitis}.csv`;
    bag.click();
    URL.revokeObjectURL(bag.href);
    bildir.basari('Rapor dışa aktarıldı');
  };

  const sekmeler: { anahtar: Sekme; etiket: string }[] = [
    { anahtar: 'ozet', etiket: 'Ciro Özeti' },
    { anahtar: 'urun', etiket: 'Ürün Performansı' },
    { anahtar: 'saatlik', etiket: 'Saatlik Yoğunluk' },
    { anahtar: 'satislar', etiket: 'Satışlar' },
    { anahtar: 'kasa', etiket: 'Kasa Geçmişi' },
    { anahtar: 'banka', etiket: 'Banka / POS' },
    { anahtar: 'suistimal', etiket: 'İade / İptal' },
    ...(denetimYetkisi ? [{ anahtar: 'denetim' as Sekme, etiket: 'Denetim Logu' }] : []),
  ];

  return (
    <div className="flex h-full flex-col p-4">
      <header className="mb-3 flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-xl font-semibold">Raporlar</h1>
        <label className="text-sm">
          <span className="etiket">Başlangıç</span>
          <input type="date" className="alan" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="etiket">Bitiş</span>
          <input type="date" className="alan" value={bitis} onChange={(e) => setBitis(e.target.value)} />
        </label>
        <div className="flex gap-1">
          {[
            { etiket: 'Bugün', bas: bugun(), bit: bugun() },
            { etiket: '7 gün', bas: gunEkle(bugun(), -6), bit: bugun() },
            { etiket: '30 gün', bas: gunEkle(bugun(), -29), bit: bugun() },
          ].map((h) => (
            <button
              key={h.etiket}
              type="button"
              className="tus-ikincil px-2 py-1 text-xs"
              onClick={() => {
                setBaslangic(h.bas);
                setBitis(h.bit);
              }}
            >
              {h.etiket}
            </button>
          ))}
        </div>
        <button type="button" className="tus-ikincil" onClick={csvIndir} disabled={!icerik}>
          Excel/CSV
        </button>
      </header>

      <nav className="mb-3 flex flex-wrap gap-1 border-b border-cizgi">
        {sekmeler.map((s) => (
          <button
            key={s.anahtar}
            type="button"
            onClick={() => setSekme(s.anahtar)}
            className={`px-3 py-2 text-sm ${sekme === s.anahtar ? 'border-b-2 border-vurgu font-medium text-vurgu' : 'text-metin-3 hover:text-metin'}`}
          >
            {s.etiket}
          </button>
        ))}
      </nav>

      <div className="kart min-h-0 flex-1 overflow-auto p-4">
        {icerik === null ? (
          yukleniyor ? (
            <Yukleniyor />
          ) : (
            <BosDurum baslik="Veri yok" />
          )
        ) : sekme === 'ozet' ? (
          <CiroOzetiGorunumu veri={icerik as Record<string, unknown>} karGorebilir={karGorebilir} />
        ) : sekme === 'urun' ? (
          <UrunRaporuGorunumu veri={icerik as Record<string, unknown>} karGorebilir={karGorebilir} />
        ) : sekme === 'saatlik' ? (
          <SaatlikGorunum veri={dizi(icerik) as unknown as { saat: number; ciro: Kurus; islem: number }[]} />
        ) : sekme === 'satislar' ? (
          <SatislarGorunumu veri={icerik as Record<string, unknown>} onDegisti={() => setTazelik((t) => t + 1)} />
        ) : sekme === 'kasa' ? (
          <KasaGecmisiGorunumu veri={dizi(icerik)} />
        ) : sekme === 'banka' ? (
          <BankaGorunumu veri={icerik as BankaVerisi} onDegisti={() => setTazelik((t) => t + 1)} />
        ) : sekme === 'suistimal' ? (
          <SuistimalGorunumu veri={icerik as Record<string, unknown>} />
        ) : (
          <DenetimGorunumu veri={dizi(icerik)} />
        )}
      </div>

      <SatisDetayDiyalogu satisId={acikSatis} onKapat={() => setAcikSatis(null)} onDegisti={() => setTazelik((t) => t + 1)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Banka / POS
// ---------------------------------------------------------------------------

interface BankaVerisi {
  devir: Kurus;
  bakiye: Kurus;
  komisyon_orani: number;
  ozet: {
    kart_satis: Kurus;
    kart_iade: Kurus;
    tahsilat: Kurus;
    odeme: Kurus;
    komisyon: Kurus;
    aktarim: Kurus;
    tahmini_komisyon: Kurus;
  };
  hareketler: { tarih: string; tur: string; aciklama: string; tutar: Kurus; belge_id: string | null; yuruyen_bakiye: Kurus }[];
}

const BANKA_TUR_ETIKETI: Record<string, string> = {
  KART_SATIS: 'Kart satış',
  KART_IADE: 'Karta iade',
  KART_TAHSILAT: 'Kart/havale tahsilat',
  KART_ODEME: 'Kart/havale ödeme',
  IPTAL: 'İptal (karta/hesaba)',
  ACILIS: 'Açılış bakiyesi',
  KOMISYON: 'Banka/POS kesintisi',
  BANKADAN_KASAYA: 'Bankadan kasaya',
  KASADAN_BANKAYA: 'Kasadan bankaya',
  DUZELTME: 'Düzeltme',
};

/**
 * Nakit dışı paranın defteri. Kart satışı, kart/havale tahsilat ve ödemeler
 * kayıtlardan türetilir; açılış, kesinti ve kasa↔banka aktarımı elle girilir.
 */
function BankaGorunumu({ veri, onDegisti }: { veri: BankaVerisi; onDegisti: () => void }) {
  const [ekleAcik, setEkleAcik] = useState(false);
  const [oranAcik, setOranAcik] = useState(false);
  const hareketYetkisi = useYetki('kasa.giris_cikis');
  const ayarYetkisi = useYetki('ayar.yonet');
  const netKart = veri.ozet.kart_satis + veri.ozet.kart_iade;

  return (
    <div className="space-y-4">
      {/* Sınır açıkça söylenir: rakam bankadaki gerçek bakiye DEĞİL, olması gerekendir. */}
      <div className="rounded border border-uyari-cizgi bg-uyari-yumusak px-3 py-2 text-sm text-metin-2">
        <strong>Bu bakiye tahminidir.</strong> POS'tan çekilen tutar bankaya genellikle birkaç gün sonra ve banka kesintisi
        düşülerek geçer; program bankanıza bağlı değildir. Ay sonunda banka ekstresiyle karşılaştırın, gerçek kesintiyi
        &laquo;Banka/POS kesintisi&raquo;, kalan farkı &laquo;Düzeltme&raquo; olarak girin.
      </div>

      <KutuIzgara
        ogeler={[
          { etiket: 'Banka / POS bakiyesi', deger: paraFormat(veri.bakiye), alt: 'Olması gereken', vurgu: true },
          { etiket: 'Net kart satışı', deger: paraFormat(netKart), alt: `İade: ${paraFormat(-veri.ozet.kart_iade)}` },
          { etiket: 'Kart/havale tahsilat', deger: paraFormat(veri.ozet.tahsilat) },
          { etiket: 'Kart/havale ödeme', deger: paraFormat(-veri.ozet.odeme), alt: 'Tedarikçilere' },
        ]}
      />

      <div className="flex flex-wrap items-center gap-3 rounded border border-cizgi px-3 py-2 text-sm">
        <span>
          Tahmini kesinti (%{veri.komisyon_orani.toLocaleString('tr-TR')} × net kart satışı):{' '}
          <strong className="font-mono">{paraFormat(veri.ozet.tahmini_komisyon)}</strong>
        </span>
        <span className="text-metin-3">
          Girilen gerçek kesinti: <strong className="font-mono">{paraFormat(-veri.ozet.komisyon)}</strong>
        </span>
        {ayarYetkisi && (
          <button type="button" className="text-xs text-vurgu hover:underline" onClick={() => setOranAcik(true)}>
            oranı değiştir
          </button>
        )}
        {hareketYetkisi && (
          <button type="button" className="tus-birincil ml-auto" onClick={() => setEkleAcik(true)}>
            Hareket Ekle
          </button>
        )}
      </div>

      <table className="tablo">
        <thead>
          <tr>
            <th>Tarih</th>
            <th>Tür</th>
            <th>Açıklama</th>
            <th className="text-right">Tutar</th>
            <th className="text-right">Bakiye</th>
          </tr>
        </thead>
        <tbody>
          {veri.devir !== 0 && (
            <tr>
              <td className="text-metin-3">—</td>
              <td colSpan={3} className="text-left text-metin-3">
                Önceki dönemden devir
              </td>
              <td className="sayi text-right font-semibold">{paraFormat(veri.devir, { simge: false })}</td>
            </tr>
          )}
          {[...veri.hareketler].reverse().map((h, i) => (
            <tr key={`${h.belge_id ?? ''}-${i}`}>
              <td className="text-metin-3">{tarihSaatFormat(h.tarih)}</td>
              <td>{BANKA_TUR_ETIKETI[h.tur] ?? h.tur}</td>
              <td className="max-w-sm truncate text-left text-metin-3">{h.aciklama}</td>
              <td className={`sayi text-right ${h.tutar < 0 ? 'text-tehlike' : 'text-vurgu'}`}>
                {paraFormat(h.tutar, { simge: false, isaret: true })}
              </td>
              <td className="sayi text-right font-semibold">{paraFormat(h.yuruyen_bakiye, { simge: false })}</td>
            </tr>
          ))}
          {veri.hareketler.length === 0 && (
            <tr>
              <td colSpan={5} className="py-8 text-center text-sm text-metin-4">
                Bu aralıkta kart/havale hareketi yok.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <BankaHareketiDiyalogu
        acik={ekleAcik}
        onKapat={() => setEkleAcik(false)}
        onTamam={() => {
          setEkleAcik(false);
          onDegisti();
        }}
      />
      <KomisyonOraniDiyalogu
        acik={oranAcik}
        mevcut={veri.komisyon_orani}
        onKapat={() => setOranAcik(false)}
        onTamam={() => {
          setOranAcik(false);
          onDegisti();
        }}
      />
    </div>
  );
}

const ELLE_TURLER: { deger: string; etiket: string; ipucu: string }[] = [
  { deger: 'ACILIS', etiket: 'Açılış bakiyesi', ipucu: "Programa geçerken bankada/POS'ta bekleyen tutar." },
  { deger: 'KOMISYON', etiket: 'Banka/POS kesintisi', ipucu: 'Banka ekstresindeki gerçek komisyon/kesinti; bakiyeden düşer.' },
  {
    deger: 'BANKADAN_KASAYA',
    etiket: 'Bankadan kasaya (nakit çekme)',
    ipucu: 'Bankadan düşer, kasaya girer (açık kasa gerekir).',
  },
  { deger: 'KASADAN_BANKAYA', etiket: 'Kasadan bankaya (yatırma)', ipucu: 'Kasadan çıkar, bankaya girer (açık kasa gerekir).' },
  { deger: 'DUZELTME', etiket: 'Düzeltme', ipucu: 'Ekstreyle kalan fark; yönünü seçin.' },
];

function BankaHareketiDiyalogu({ acik, onKapat, onTamam }: { acik: boolean; onKapat: () => void; onTamam: () => void }) {
  const [tur, setTur] = useState('KOMISYON');
  const [tutar, setTutar] = useState<Kurus>(0);
  const [aciklama, setAciklama] = useState('');
  const [yon, setYon] = useState<'GIRIS' | 'CIKIS'>('CIKIS');
  const [calisiyor, setCalisiyor] = useState(false);

  useEffect(() => {
    if (!acik) return;
    setTur('KOMISYON');
    setTutar(0);
    setAciklama('');
    setYon('CIKIS');
  }, [acik]);

  const gecerli = tutar > 0 && aciklama.trim().length > 0 && !calisiyor;
  const kaydet = async () => {
    if (!gecerli) return;
    setCalisiyor(true);
    try {
      await cagir('banka.hareketEkle', { tur, tutar, aciklama: aciklama.trim(), yon });
      bildir.basari('Banka hareketi eklendi');
      onTamam();
    } catch (hata) {
      hatayiBildir(hata, 'Banka hareketi');
    } finally {
      setCalisiyor(false);
    }
  };

  return (
    <Diyalog
      acik={acik}
      baslik="Banka / POS Hareketi"
      genislik="dar"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={() => void kaydet()} disabled={!gecerli}>
            Kaydet
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Alan etiket="Tür" ipucu={ELLE_TURLER.find((t) => t.deger === tur)?.ipucu}>
          <select className="alan" value={tur} onChange={(e) => setTur(e.target.value)}>
            {ELLE_TURLER.map((t) => (
              <option key={t.deger} value={t.deger}>
                {t.etiket}
              </option>
            ))}
          </select>
        </Alan>
        {tur === 'DUZELTME' && (
          <Alan etiket="Yön">
            <select className="alan" value={yon} onChange={(e) => setYon(e.target.value as 'GIRIS' | 'CIKIS')}>
              <option value="GIRIS">Bakiyeyi artır</option>
              <option value="CIKIS">Bakiyeyi azalt</option>
            </select>
          </Alan>
        )}
        <Alan etiket="Tutar">
          <ParaAlani deger={tutar} onDegisim={setTutar} />
        </Alan>
        <Alan etiket="Açıklama *">
          <input
            className="alan"
            value={aciklama}
            onChange={(e) => setAciklama(e.target.value)}
            placeholder="Örn. Eylül POS kesintisi"
          />
        </Alan>
      </div>
    </Diyalog>
  );
}

/** POS komisyon oranı — merkezî ayar; panel de aynı oranla tahmin eder. */
function KomisyonOraniDiyalogu({
  acik,
  mevcut,
  onKapat,
  onTamam,
}: {
  acik: boolean;
  mevcut: number;
  onKapat: () => void;
  onTamam: () => void;
}) {
  const [oran, setOran] = useState('');
  useEffect(() => {
    if (acik) setOran(mevcut ? String(mevcut).replace('.', ',') : '');
  }, [acik, mevcut]);
  const sayi = Number(oran.replace(',', '.'));
  const gecerli = oran.trim() !== '' && Number.isFinite(sayi) && sayi >= 0 && sayi < 20;

  const kaydet = async () => {
    try {
      await cagir('ayar.yaz', { degerler: { 'pos.komisyon_orani': oran.trim() } });
      bildir.basari('Komisyon oranı kaydedildi');
      onTamam();
    } catch (hata) {
      hatayiBildir(hata, 'Komisyon oranı');
    }
  };

  return (
    <Diyalog
      acik={acik}
      baslik="POS Komisyon Oranı"
      aciklama="Bankanızla anlaştığınız ortalama oran. Kart türü ve taksite göre gerçek kesinti farklı olabilir."
      genislik="dar"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={() => void kaydet()} disabled={!gecerli}>
            Kaydet
          </button>
        </>
      }
    >
      <Alan etiket="Oran (%)" ipucu="Örn. 1,8">
        <input className="alan sayi" inputMode="decimal" value={oran} onChange={(e) => setOran(e.target.value)} />
      </Alan>
    </Diyalog>
  );
}

function KutuIzgara({ ogeler }: { ogeler: { etiket: string; deger: string; alt?: string; vurgu?: boolean }[] }) {
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {ogeler.map((o) => (
        <div key={o.etiket} className="rounded-lg border border-cizgi bg-yuzey-3 p-3">
          <p className="text-xs text-metin-3">{o.etiket}</p>
          <p className={`mt-1 font-mono text-xl font-bold ${o.vurgu ? 'text-vurgu' : ''}`}>{o.deger}</p>
          {o.alt && <p className="mt-0.5 text-xs text-metin-4">{o.alt}</p>}
        </div>
      ))}
    </div>
  );
}

function CiroOzetiGorunumu({ veri, karGorebilir }: { veri: Record<string, unknown>; karGorebilir: boolean }) {
  const ozet = veri.ozet as CiroOzeti | undefined;
  const gunler = (Array.isArray(veri.gunler) ? veri.gunler : []) as Record<string, number | string>[];
  const degisim = veri.degisimYuzde as number;

  // Beklenmedik yanıt şekli çökme değil boş durum üretmeli.
  if (!ozet) return <BosDurum baslik="Veri yok" />;

  return (
    <>
      <KutuIzgara
        ogeler={[
          { etiket: 'Net ciro', deger: paraFormat(ozet.netCiro), alt: `Önceki döneme göre %${degisim}`, vurgu: true },
          { etiket: 'İşlem sayısı', deger: String(ozet.islemSayisi), alt: `Ort. sepet ${paraFormat(ozet.ortalamaSepet)}` },
          ...(karGorebilir ? [{ etiket: 'Brüt kâr', deger: paraFormat(ozet.brutKar), alt: `Marj %${ozet.karMarji}` }] : []),
          { etiket: 'İade', deger: paraFormat(ozet.iade), alt: `KDV ${paraFormat(ozet.kdvToplam)}` },
        ]}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          { e: 'Nakit', d: ozet.nakit },
          { e: 'Kart', d: ozet.kart },
          { e: 'Veresiye', d: ozet.veresiye },
        ].map((o) => (
          <div key={o.e} className="rounded border border-cizgi p-3">
            <p className="text-xs text-metin-3">{o.e}</p>
            <p className="font-mono text-lg">{paraFormat(o.d)}</p>
          </div>
        ))}
      </div>

      {/*
        Günlük dökümde ÖDEME KIRILIMI da vardır.

        Üstteki üç kutu dönemin tamamını verir; "dün nakit ne kadardı" sorusunun
        cevabı yoktu. Veri günlük özette zaten duruyordu, yalnız gösterilmiyordu.
      */}
      <table className="tablo">
        <thead>
          <tr>
            <th>Tarih</th>
            <th className="text-right">Ciro</th>
            <th className="text-right">İade</th>
            <th className="text-right">İşlem</th>
            <th className="text-right">Ort. sepet</th>
            <th className="text-right">Nakit</th>
            <th className="text-right">Kart</th>
            <th className="text-right">Veresiye</th>
            {karGorebilir && <th className="text-right">Kâr</th>}
          </tr>
        </thead>
        <tbody>
          {gunler.map((g) => (
            <tr key={String(g.tarih)}>
              <td>{String(g.tarih)}</td>
              <td className="sayi text-right">{paraFormat(Number(g.ciro), { simge: false })}</td>
              <td className="sayi text-uyari text-right">{paraFormat(Number(g.iade_toplam), { simge: false })}</td>
              <td className="sayi text-right">{String(g.islem_sayisi)}</td>
              <td className="sayi text-right">{paraFormat(Number(g.ortalama_sepet), { simge: false })}</td>
              <td className="sayi text-right">{paraFormat(Number(g.nakit), { simge: false })}</td>
              <td className="sayi text-right">{paraFormat(Number(g.kart), { simge: false })}</td>
              <td className="sayi text-right">{paraFormat(Number(g.veresiye), { simge: false })}</td>
              {karGorebilir && <td className="sayi text-vurgu text-right">{paraFormat(Number(g.brut_kar), { simge: false })}</td>}
            </tr>
          ))}
          {gunler.length === 0 && (
            <tr>
              <td colSpan={karGorebilir ? 9 : 8} className="text-center text-metin-4">
                Bu aralıkta veri yok.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

function UrunRaporuGorunumu({ veri, karGorebilir }: { veri: Record<string, unknown>; karGorebilir: boolean }) {
  const enCok = (veri.enCokSatan ?? []) as Record<string, number | string>[];
  const enKarli = (veri.enKarli ?? []) as Record<string, number | string>[];
  const olu = (veri.oluStok ?? []) as Record<string, number | string>[];

  const listeCiro = enCok.reduce((t, u) => t + Number(u.ciro), 0);
  const listeKar = enCok.reduce((t, u) => t + Number(u.kar), 0);
  const bagliSermaye = olu.reduce((t, u) => t + Number(u.bagli_sermaye), 0);
  const marj = listeCiro > 0 ? Math.round((listeKar / listeCiro) * 1000) / 10 : 0;

  return (
    <>
      <KutuIzgara
        ogeler={[
          { etiket: 'Listelenen ciro', deger: paraFormat(listeCiro), alt: `${enCok.length} ürün`, vurgu: true },
          ...(karGorebilir ? [{ etiket: 'Brüt kâr', deger: paraFormat(listeKar), alt: `Marj %${marj}` }] : []),
          { etiket: 'Ölü stok kalemi', deger: String(olu.length), alt: 'Dönemde hiç satılmadı' },
          { etiket: 'Bağlı sermaye', deger: paraFormat(bagliSermaye), alt: 'Ölü stokta duran' },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 font-semibold">En Çok Satanlar</h3>
          <table className="tablo">
            <thead>
              <tr>
                <th>Ürün</th>
                <th className="text-right">Adet</th>
                <th className="text-right">Ciro</th>
                {karGorebilir && <th className="text-right">Kâr</th>}
              </tr>
            </thead>
            <tbody>
              {enCok.map((u) => (
                <tr key={String(u.urun_id)}>
                  <td>{String(u.urun_adi)}</td>
                  <td className="sayi text-right">{miktarFormat(Number(u.adet))}</td>
                  <td className="sayi text-right">{paraFormat(Number(u.ciro), { simge: false })}</td>
                  {karGorebilir && <td className="sayi text-vurgu text-right">{paraFormat(Number(u.kar), { simge: false })}</td>}
                </tr>
              ))}
              {enCok.length === 0 && (
                <tr>
                  <td colSpan={karGorebilir ? 4 : 3} className="text-center text-metin-4">
                    Bu aralıkta satış yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/*
          EN KÂRLI ayrı bir listedir: çok satan ürün her zaman kazandıran ürün
          değildir. İşletme sahibinin asıl baktığı sıralama budur.

          Bu liste servis tarafından ZATEN hesaplanıyordu (`urunRaporu.enKarli`)
          ama ekranda hiç gösterilmiyordu — panelde vardı, kasada yoktu.
        */}
        {karGorebilir && (
          <div>
            <h3 className="mb-2 font-semibold">
              En Kârlılar <span className="text-xs font-normal text-metin-4">(brüt kâra göre, ciroya göre değil)</span>
            </h3>
            <table className="tablo">
              <thead>
                <tr>
                  <th>Ürün</th>
                  <th className="text-right">Adet</th>
                  <th className="text-right">Kâr</th>
                  <th className="text-right">Marj</th>
                </tr>
              </thead>
              <tbody>
                {enKarli.map((u) => (
                  <tr key={String(u.urun_id)}>
                    <td>{String(u.urun_adi)}</td>
                    <td className="sayi text-right">{miktarFormat(Number(u.adet))}</td>
                    <td className="sayi text-vurgu text-right">{paraFormat(Number(u.kar), { simge: false })}</td>
                    <td className="sayi text-metin-3 text-right">
                      {Number(u.ciro) > 0 ? `%${Math.round((Number(u.kar) / Number(u.ciro)) * 1000) / 10}` : '—'}
                    </td>
                  </tr>
                ))}
                {enKarli.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center text-metin-4">
                      Bu aralıkta satış yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <h3 className="mb-2 font-semibold">
            Ölü Stok <span className="text-xs font-normal text-metin-4">(dönemde hiç satılmayan)</span>
          </h3>
          <table className="tablo">
            <thead>
              <tr>
                <th>Ürün</th>
                <th className="text-right">Stok</th>
                <th className="text-right">Bağlı sermaye</th>
              </tr>
            </thead>
            <tbody>
              {olu.map((u) => (
                <tr key={String(u.urun_id)}>
                  <td>{String(u.ad)}</td>
                  <td className="sayi text-right">{miktarFormat(Number(u.stok))}</td>
                  <td className="sayi text-uyari text-right">{paraFormat(Number(u.bagli_sermaye), { simge: false })}</td>
                </tr>
              ))}
              {olu.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-center text-metin-4">
                    Ölü stok yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function SaatlikGorunum({ veri }: { veri: { saat: number; ciro: Kurus; islem: number }[] }) {
  const enYuksek = Math.max(1, ...veri.map((d) => d.ciro));
  return (
    <div>
      <h3 className="mb-3 font-semibold">Saatlik Yoğunluk</h3>
      <div className="space-y-1">
        {veri
          .filter((d) => d.islem > 0 || d.ciro > 0)
          .map((d) => (
            <div key={d.saat} className="flex items-center gap-2">
              <span className="w-12 font-mono text-xs text-metin-3">{String(d.saat).padStart(2, '0')}:00</span>
              <div className="h-5 flex-1 overflow-hidden rounded bg-yuzey-2">
                <div className="h-full bg-vurgu" style={{ width: `${(d.ciro / enYuksek) * 100}%` }} />
              </div>
              <span className="w-28 text-right font-mono text-xs">{paraFormat(d.ciro, { simge: false })}</span>
              <span className="w-16 text-right text-xs text-metin-4">{d.islem} işlem</span>
            </div>
          ))}
      </div>
      {veri.every((d) => d.islem === 0) && <BosDurum baslik="Bu aralıkta satış yok" />}
    </div>
  );
}

function SatislarGorunumu({ veri, onDegisti }: { veri: Record<string, unknown>; onDegisti: () => void }) {
  const kayitlar = (veri.kayitlar ?? []) as Record<string, unknown>[];
  const [seciliId, setSeciliId] = useState<string | null>(null);

  return (
    <>
      <table className="tablo">
        <thead>
          <tr>
            <th>Fiş No</th>
            <th>Tarih</th>
            <th>Kasiyer</th>
            <th>Müşteri</th>
            <th>Ödeme</th>
            <th className="text-right">Tutar</th>
            <th>Durum</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {kayitlar.map((s) => (
            <tr key={String(s.id)} className="cursor-pointer" onClick={() => setSeciliId(String(s.id))}>
              <td className="font-mono">{String(s.fis_no)}</td>
              <td className="text-metin-3">{tarihSaatFormat(String(s.tarih))}</td>
              <td>{String(s.kullanici_adi ?? '—')}</td>
              {/* Müşterisiz satış perakendedir; boş bırakmak "bilgi yok" gibi okunuyordu. */}
              <td className={s.musteri_adi ? '' : 'text-metin-4'}>{String(s.musteri_adi ?? 'Perakende')}</td>
              <td>{String(s.odeme_ozeti)}</td>
              <td className="sayi text-right">{paraFormat(Number(s.genel_toplam), { simge: false })}</td>
              <td>
                {s.iptal_mi ? (
                  <Rozet tur="tehlike">İptal</Rozet>
                ) : s.iade_mi ? (
                  <Rozet tur="uyari">İade</Rozet>
                ) : (
                  <Rozet tur="basari">Geçerli</Rozet>
                )}
                {!s.fis_yazdirildi && !s.iptal_mi && (
                  <span className="ml-1">
                    <Rozet tur="notr">Fiş basılmadı</Rozet>
                  </span>
                )}
              </td>
              <td>
                <button
                  type="button"
                  className="text-xs text-vurgu hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSeciliId(String(s.id));
                  }}
                >
                  Detay
                </button>
              </td>
            </tr>
          ))}
          {kayitlar.length === 0 && (
            <tr>
              <td colSpan={8} className="py-8 text-center text-sm text-metin-4">
                Bu aralıkta satış yok.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-metin-4">Fiş içeriğini görmek için satıra tıklayın.</p>

      <SatisDetayDiyalogu satisId={seciliId} onKapat={() => setSeciliId(null)} onDegisti={onDegisti} />
    </>
  );
}

interface SatisDetayVerisi {
  satis: {
    id: string;
    fis_no: string;
    tarih: string;
    kullanici_adi?: string | null;
    musteri_adi?: string | null;
    ara_toplam: Kurus;
    iskonto_toplam: Kurus;
    kdv_toplam: Kurus;
    genel_toplam: Kurus;
    odeme_ozeti: string;
    iptal_mi: boolean;
    iptal_neden: string | null;
    iade_mi: boolean;
    fis_yazdirildi: boolean;
    notlar: string | null;
    kaynak_satis_id?: string | null;
    kaynak_fis_no?: string | null;
  };
  /** Bu satıştan yapılmış iadeler. */
  iadeler?: { id: string; fis_no: string; tarih: string; genel_toplam: Kurus }[];
  kalemler: {
    id: string;
    urun_adi: string;
    barkod: string | null;
    miktar: number;
    birim_tipi: string;
    birim_fiyat: Kurus;
    iskonto: Kurus;
    kdv_orani: number;
    kdv_tutar: Kurus;
    satir_toplam: Kurus;
    /** Bu satıştan yapılan iadelerde bu üründen geri alınan miktar (eksi). */
    iade_edilen?: number;
  }[];
  odemeler: { id: string; odeme_tipi: string; tutar: Kurus; alinan: Kurus; para_ustu: Kurus }[];
}

/** Geçmiş fişin tam dökümü: kalemler, KDV kırılımı, ödemeler ve tekrar yazdırma. */
function SatisDetayDiyalogu({
  satisId,
  onKapat,
  onDegisti,
}: {
  satisId: string | null;
  onKapat: () => void;
  /** İptal sonrası çağıran listeyi tazelesin. */
  onDegisti?: () => void;
}) {
  const [iptalAcik, setIptalAcik] = useState(false);
  const iptalYetkisi = useYetki('satis.iptal');
  const iadeYetkisi = useYetki('satis.iade');
  const gezin = useNavigate();
  const [detay, setDetay] = useState<SatisDetayVerisi | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

  useEffect(() => {
    if (!satisId) {
      setDetay(null);
      return;
    }
    let iptal = false;
    setYukleniyor(true);
    cagir<SatisDetayVerisi>('satis.detay', { satisId })
      .then((d) => {
        if (!iptal) setDetay(d);
      })
      .catch((h) => {
        if (!iptal) hatayiBildir(h, 'Fiş detayı');
      })
      .finally(() => {
        if (!iptal) setYukleniyor(false);
      });
    return () => {
      iptal = true;
    };
  }, [satisId]);

  if (!satisId) return null;

  // KDV kırılımını kalemlerden orana göre grupla (fişteki gösterimin aynısı).
  const kdvDilimleri = new Map<number, { matrah: Kurus; kdv: Kurus }>();
  for (const k of detay?.kalemler ?? []) {
    const mevcut = kdvDilimleri.get(k.kdv_orani) ?? { matrah: 0, kdv: 0 };
    mevcut.kdv += k.kdv_tutar;
    mevcut.matrah += k.satir_toplam - k.kdv_tutar;
    kdvDilimleri.set(k.kdv_orani, mevcut);
  }

  const mutlak = (d: Kurus) => paraFormat(Math.abs(d), { simge: false });
  /*
   * Satır bazında iade: orijinal fiş DEĞİŞMEZ, yanında ne kadarının iade
   * edildiği ve kalanı gösterilir; altta iadeler düşülmüş net tutar.
   */
  const iadeVar = Boolean(detay && !detay.satis.iade_mi && detay.kalemler.some((k) => (k.iade_edilen ?? 0) !== 0));
  const iadeToplami = (detay?.iadeler ?? []).reduce((t, i) => t + i.genel_toplam, 0);

  return (
    <Diyalog
      acik
      baslik={detay ? `Fiş ${detay.satis.fis_no}` : 'Fiş detayı'}
      aciklama={detay ? tarihSaatFormat(detay.satis.tarih) : undefined}
      genislik="genis"
      onKapat={onKapat}
      altBilgi={
        <>
          <button
            type="button"
            className="tus-ikincil mr-auto"
            disabled={!detay}
            onClick={async () => {
              const sonuc = await cagir<{ basarili: boolean; hata?: string }>('satis.fisYazdir', { satisId, kopya: true });
              if (sonuc.basarili) bildir.basari('Fiş kopyası yazdırıldı');
              else bildir.uyari('Yazdırılamadı', sonuc.hata);
            }}
          >
            Fişi Tekrar Yazdır
          </button>
          {/* İade kendi ekranında yapılır (kalem ve miktar seçimi, yöntem); fiş numarası hazır gider. */}
          {iadeYetkisi && detay && !detay.satis.iptal_mi && !detay.satis.iade_mi && (
            <button
              type="button"
              className="tus-ikincil"
              onClick={() => gezin('/iade', { state: { fisNo: detay.satis.fis_no } })}
            >
              İade Et
            </button>
          )}
          {iptalYetkisi && detay && !detay.satis.iptal_mi && !detay.satis.iade_mi && (
            <button type="button" className="tus-tehlike" onClick={() => setIptalAcik(true)}>
              Satışı İptal Et
            </button>
          )}
          <button type="button" className="tus-birincil" onClick={onKapat}>
            Kapat
          </button>
        </>
      }
    >
      {yukleniyor || !detay ? (
        <Yukleniyor />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="text-metin-3">Kasiyer:</span> {detay.satis.kullanici_adi ?? '—'}
            </span>
            <span>
              <span className="text-metin-3">Müşteri:</span> {detay.satis.musteri_adi ?? 'Perakende'}
            </span>
            <span>
              <span className="text-metin-3">Ödeme:</span> {detay.satis.odeme_ozeti}
            </span>
            {detay.satis.iptal_mi && <Rozet tur="tehlike">İptal edildi</Rozet>}
            {detay.satis.iade_mi && <Rozet tur="uyari">İade fişi</Rozet>}
            {!detay.satis.fis_yazdirildi && !detay.satis.iptal_mi && <Rozet tur="notr">Fiş basılmadı</Rozet>}
          </div>

          {/* İade ile orijinal satış birbirine bağlı görünür: hangisinin iadesi, neden. */}
          {detay.satis.iade_mi && (
            <p className="rounded border border-uyari-cizgi bg-uyari-yumusak px-3 py-2 text-sm">
              <strong>İade edilen fiş:</strong> {detay.satis.kaynak_fis_no ?? '—'}
              {detay.satis.notlar && detay.satis.notlar !== 'Belirtilmedi' && (
                <>
                  {' · '}
                  <strong>Neden:</strong> {detay.satis.notlar}
                </>
              )}
            </p>
          )}
          {(detay.iadeler ?? []).length > 0 && (
            <p className="rounded border border-uyari-cizgi bg-uyari-yumusak px-3 py-2 text-sm">
              <strong>Bu satıştan iade yapıldı:</strong>{' '}
              {detay.iadeler!.map((i) => `${i.fis_no} (${paraFormat(Math.abs(i.genel_toplam), { simge: false })})`).join(', ')}
            </p>
          )}

          {detay.satis.iptal_mi && detay.satis.iptal_neden && (
            <p className="rounded border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm">
              <strong>İptal nedeni:</strong> {detay.satis.iptal_neden}
            </p>
          )}

          <table className="tablo">
            <thead>
              <tr>
                <th>Ürün</th>
                <th className="text-right">{iadeVar ? 'Satılan' : 'Miktar'}</th>
                {iadeVar && (
                  <>
                    <th className="text-right">İade</th>
                    <th className="text-right">Kalan</th>
                  </>
                )}
                <th className="text-right">Birim fiyat</th>
                <th className="text-right">İskonto</th>
                <th className="text-right">KDV</th>
                <th className="text-right">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {detay.kalemler.map((k) => (
                <tr key={k.id}>
                  <td>
                    <div className="font-medium">{k.urun_adi}</div>
                    {k.barkod && <div className="font-mono text-xs text-metin-4">{k.barkod}</div>}
                  </td>
                  <td className="sayi text-right">{miktarFormat(Math.abs(k.miktar), k.birim_tipi as never)}</td>
                  {iadeVar && (
                    <>
                      <td className="sayi text-uyari text-right">
                        {k.iade_edilen ? miktarFormat(-k.iade_edilen, k.birim_tipi as never) : '—'}
                      </td>
                      <td className="sayi font-medium text-right">
                        {miktarFormat(k.miktar + (k.iade_edilen ?? 0), k.birim_tipi as never)}
                      </td>
                    </>
                  )}
                  <td className="sayi text-right">{mutlak(k.birim_fiyat)}</td>
                  <td className="sayi text-uyari text-right">{k.iskonto !== 0 ? '-' + mutlak(k.iskonto) : '—'}</td>
                  <td className="sayi text-metin-3 text-right">%{k.kdv_orani}</td>
                  <td className="sayi font-semibold text-right">{mutlak(k.satir_toplam)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded border border-cizgi p-3">
              <h3 className="mb-2 text-sm font-semibold">KDV Kırılımı</h3>
              {[...kdvDilimleri.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([oran, d]) => (
                  <div key={oran} className="flex justify-between text-sm">
                    <span className="text-metin-3">
                      KDV %{oran} (matrah {mutlak(d.matrah)})
                    </span>
                    <span className="sayi">{mutlak(d.kdv)}</span>
                  </div>
                ))}
              <div className="mt-2 flex justify-between border-t border-cizgi pt-2 text-sm">
                <span className="text-metin-3">Ara toplam</span>
                <span className="sayi">{mutlak(detay.satis.ara_toplam)}</span>
              </div>
              {detay.satis.iskonto_toplam !== 0 && (
                <div className="flex justify-between text-sm text-uyari">
                  <span>İskonto</span>
                  <span className="sayi">-{mutlak(detay.satis.iskonto_toplam)}</span>
                </div>
              )}
              <div className="mt-1 flex items-baseline justify-between border-t border-cizgi pt-2">
                <span className="font-semibold">GENEL TOPLAM</span>
                <span className="sayi text-xl font-bold text-vurgu">{mutlak(detay.satis.genel_toplam)}</span>
              </div>
              {iadeToplami !== 0 && (
                <>
                  <div className="mt-1 flex justify-between text-sm text-uyari">
                    <span>İadeler ({detay.iadeler!.map((i) => i.fis_no).join(', ')})</span>
                    <span className="sayi">-{mutlak(iadeToplami)}</span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between border-t border-cizgi pt-2">
                    <span className="font-semibold">NET TUTAR</span>
                    <span className="sayi text-lg font-bold">{mutlak(detay.satis.genel_toplam + iadeToplami)}</span>
                  </div>
                </>
              )}
            </div>

            <div className="rounded border border-cizgi p-3">
              <h3 className="mb-2 text-sm font-semibold">Ödemeler</h3>
              {detay.odemeler.map((o) => (
                <div key={o.id} className="mb-1 text-sm">
                  <div className="flex justify-between">
                    <span>
                      {detay.satis.iade_mi ? (IADE_YONTEMI_ETIKETI[o.odeme_tipi as IadeYontemi] ?? o.odeme_tipi) : o.odeme_tipi}
                    </span>
                    <span className="sayi">{mutlak(o.tutar)}</span>
                  </div>
                  {o.para_ustu > 0 && (
                    <div className="flex justify-between text-xs text-metin-3">
                      <span>Alınan {mutlak(o.alinan)} · Para üstü</span>
                      <span className="sayi">{mutlak(o.para_ustu)}</span>
                    </div>
                  )}
                </div>
              ))}
              {detay.satis.notlar && (
                <p className="mt-3 border-t border-cizgi pt-2 text-xs text-metin-3">
                  <strong>Not:</strong> {detay.satis.notlar}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      {detay && (
        <SatisIptalDiyalogu
          acik={iptalAcik}
          fisNo={detay.satis.fis_no}
          satisId={satisId}
          odemeler={detay.odemeler}
          onKapat={() => setIptalAcik(false)}
          onTamam={() => {
            setIptalAcik(false);
            onDegisti?.();
            onKapat();
          }}
        />
      )}
    </Diyalog>
  );
}

/** Fişi olan kasa hareketi tipleri. */
const KASA_SATIS_TIPLERI = new Set(['SATIS_NAKIT', 'SATIS_KART', 'IADE_NAKIT']);

const KASA_HAREKET_ETIKETI: Record<string, string> = {
  ACILIS: 'Açılış',
  SATIS_NAKIT: 'Nakit satış',
  SATIS_KART: 'Kart satış',
  TAHSILAT: 'Tahsilat',
  ODEME: 'Ödeme',
  GIDER: 'Gider',
  GIRIS: 'Kasaya giriş',
  CIKIS: 'Kasadan çıkış',
  IADE_NAKIT: 'Nakit iade',
};

function KasaGecmisiGorunumu({ veri }: { veri: Record<string, unknown>[] }) {
  // Özet satırı "kasada ne oldu" sorusunu cevaplamaz; vardiyanın içine
  // inilebilmesi gerekir (§10.11). `kasa.vardiyaRaporu` bunu zaten döndürüyor.
  const [oturumId, setOturumId] = useState<string | null>(null);

  return (
    <>
      <table className="tablo">
        <thead>
          <tr>
            <th>Kasiyer</th>
            <th>Açılış</th>
            <th>Kapanış</th>
            <th className="text-right">Beklenen</th>
            <th className="text-right">Sayılan</th>
            <th className="text-right">Fark</th>
          </tr>
        </thead>
        <tbody>
          {veri.map((o) => (
            <tr
              key={String(o.id)}
              className="cursor-pointer hover:bg-yuzey-2"
              onClick={() => setOturumId(String(o.id))}
              title="Vardiya dökümünü aç"
            >
              <td>
                {String(o.kullanici_adi ?? '—')}
                <span className="ml-2 text-xs text-vurgu">dökümü gör →</span>
              </td>
              <td className="text-metin-3">{tarihSaatFormat(String(o.acilis_zamani))}</td>
              <td className="text-metin-3">
                {o.kapanis_zamani ? tarihSaatFormat(String(o.kapanis_zamani)) : <Rozet tur="uyari">Açık</Rozet>}
              </td>
              <td className="sayi text-right">
                {o.beklenen_nakit !== null ? paraFormat(Number(o.beklenen_nakit), { simge: false }) : '—'}
              </td>
              <td className="sayi text-right">
                {o.sayilan_nakit !== null ? paraFormat(Number(o.sayilan_nakit), { simge: false }) : '—'}
              </td>
              <td className={`text-right sayi ${Number(o.kasa_farki ?? 0) !== 0 ? 'text-tehlike' : 'text-vurgu'}`}>
                {o.kasa_farki !== null ? paraFormat(Number(o.kasa_farki), { simge: false, isaret: true }) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <VardiyaDokumuDiyalogu oturumId={oturumId} onKapat={() => setOturumId(null)} />
    </>
  );
}

/**
 * Bir vardiyanın tüm para hareketleri (§10.11).
 *
 * Kasa Geçmişi yalnız özet gösteriyordu: "beklenen 3.880, sayılan 3.880" —
 * ama müşteri itiraz ettiğinde ya da fark çıktığında cevabı gereken soru
 * "içinde ne oldu"dur. Satıştan doğan satırlardan fişin kalemlerine inilir.
 */
function VardiyaDokumuDiyalogu({ oturumId, onKapat }: { oturumId: string | null; onKapat: () => void }) {
  const [veri, setVeri] = useState<{
    oturum: Record<string, unknown> | null;
    ozet: Record<string, unknown>;
    hareketler: {
      id: string;
      tip: string;
      tutar: number;
      aciklama: string | null;
      belge_id: string | null;
      created_at: string;
      musteri_adi?: string | null;
    }[];
  } | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [fisId, setFisId] = useState<string | null>(null);

  useEffect(() => {
    if (!oturumId) {
      setVeri(null);
      return;
    }
    setYukleniyor(true);
    cagir<typeof veri>('kasa.vardiyaRaporu', { oturumId })
      .then(setVeri)
      .catch((hata) => hatayiBildir(hata, 'Vardiya dökümü'))
      .finally(() => setYukleniyor(false));
  }, [oturumId]);

  if (!oturumId) return null;

  const oturum = veri?.oturum;

  return (
    <Diyalog
      acik
      baslik="Vardiya Dökümü"
      aciklama={
        oturum
          ? `${String(oturum.kullanici_adi ?? '')} · ${tarihSaatFormat(String(oturum.acilis_zamani))}${
              oturum.kapanis_zamani ? ` — ${tarihSaatFormat(String(oturum.kapanis_zamani))}` : ' — açık'
            }`
          : undefined
      }
      onKapat={onKapat}
      altBilgi={
        <button type="button" className="tus-ikincil" onClick={onKapat}>
          Kapat
        </button>
      }
    >
      {yukleniyor ? (
        <Yukleniyor />
      ) : !veri ? (
        <BosDurum baslik="Döküm alınamadı" />
      ) : veri.hareketler.length === 0 ? (
        <BosDurum baslik="Bu vardiyada hareket yok" />
      ) : (
        <table className="tablo">
          <thead>
            <tr>
              <th>Saat</th>
              <th>Tür</th>
              <th>Açıklama</th>
              <th className="text-right">Tutar</th>
            </tr>
          </thead>
          <tbody>
            {veri.hareketler.map((h) => {
              const fisVar = KASA_SATIS_TIPLERI.has(h.tip) && Boolean(h.belge_id);
              return (
                <tr
                  key={h.id}
                  className={fisVar ? 'cursor-pointer hover:bg-yuzey-2' : ''}
                  onClick={() => fisVar && h.belge_id && setFisId(h.belge_id)}
                >
                  <td className="text-metin-3">{tarihSaatFormat(h.created_at).slice(-5)}</td>
                  <td>
                    {h.aciklama?.startsWith('Satış iptali')
                      ? h.tip === 'IADE_NAKIT'
                        ? 'İptal — nakit iade'
                        : 'İptal — karta iade'
                      : (KASA_HAREKET_ETIKETI[h.tip] ?? h.tip)}
                  </td>
                  <td className="text-metin-3">
                    {h.aciklama ?? '—'}
                    {fisVar && <span className="ml-2 whitespace-nowrap text-xs text-vurgu">fişi gör →</span>}
                    {fisVar && <div className="text-xs text-metin-4">Müşteri: {h.musteri_adi ?? 'Perakende'}</div>}
                  </td>
                  <td className={`text-right sayi ${h.tutar < 0 ? 'text-tehlike' : 'text-vurgu'}`}>
                    {paraFormat(h.tutar, { simge: false, isaret: true })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <SatisFisiDiyalogu satisId={fisId} onKapat={() => setFisId(null)} />
    </Diyalog>
  );
}

function SuistimalGorunumu({ veri }: { veri: Record<string, unknown> }) {
  const kasiyer = (veri.kasiyerBazli ?? []) as Record<string, unknown>[];
  return (
    <>
      <KutuIzgara
        ogeler={[
          { etiket: 'İade oranı', deger: `%${veri.iadeOrani}`, alt: paraFormat(Number(veri.iadeTutari)) },
          { etiket: 'İptal oranı', deger: `%${veri.iptalOrani}`, alt: paraFormat(Number(veri.iptalTutari)) },
        ]}
      />
      <h3 className="mb-2 font-semibold">Kasiyer Bazlı</h3>
      <table className="tablo">
        <thead>
          <tr>
            <th>Kasiyer</th>
            <th className="text-right">Satış</th>
            <th className="text-right">İade</th>
            <th className="text-right">İptal</th>
          </tr>
        </thead>
        <tbody>
          {kasiyer.map((k, i) => (
            <tr key={i}>
              <td>{String(k.kullanici_adi ?? '—')}</td>
              <td className="sayi text-right">{String(k.satis)}</td>
              <td className="sayi text-uyari text-right">{String(k.iade)}</td>
              <td className="sayi text-tehlike text-right">{String(k.iptal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function DenetimGorunumu({ veri }: { veri: Record<string, unknown>[] }) {
  return (
    <table className="tablo">
      <thead>
        <tr>
          <th>Zaman</th>
          <th>Kullanıcı</th>
          <th>İşlem</th>
          <th>Kayıt</th>
          <th>Detay</th>
        </tr>
      </thead>
      <tbody>
        {veri.map((d) => (
          <tr key={String(d.id)}>
            <td className="text-metin-3">{tarihSaatFormat(String(d.zaman))}</td>
            <td>{String(d.kullanici_adi ?? '—')}</td>
            <td className="font-medium">{String(d.islem)}</td>
            <td className="text-metin-3">{String(d.entity)}</td>
            <td className="max-w-md truncate font-mono text-xs text-metin-4">{String(d.yeni_deger ?? '')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Satış iptali (§10.5).
 *
 * İptal SİLMEZ: satış iptal işaretlenir, stok ters hareketle geri alınır,
 * veresiyeyse borç düşülür ve gün özeti düzeltilir. Bu yüzden neden ZORUNLUDUR
 * — sonradan "bu fiş neden iptal olmuş" sorusunun cevabı kayıtta durmalıdır.
 *
 * Arka uç bu akışı baştan beri destekliyordu; eksik olan tek şey buraya giden
 * düğmeydi. Kasiyerin tek çıkışı iade yapmaktı, o da olmamış bir iade kaydı
 * üretip suistimal raporundaki iade oranını bozuyordu.
 */
function SatisIptalDiyalogu({
  acik,
  satisId,
  fisNo,
  odemeler,
  onKapat,
  onTamam,
}: {
  acik: boolean;
  satisId: string | null;
  fisNo: string;
  odemeler: { odeme_tipi: string; tutar: Kurus }[];
  onKapat: () => void;
  onTamam: () => void;
}) {
  const [neden, setNeden] = useState('');
  const [calisiyor, setCalisiyor] = useState(false);
  /** Ödenmiş kısmın geri dönüş yolu; ORIJINAL = ödendiği gibi (yalnız karma ödemede anlamlı). */
  const [yol, setYol] = useState<'ORIJINAL' | 'NAKIT' | 'KART'>('ORIJINAL');

  const toplam = (tip: string) => odemeler.filter((o) => o.odeme_tipi === tip).reduce((t, o) => t + o.tutar, 0);
  const nakit = toplam('NAKIT');
  const kart = toplam('KART');
  const veresiye = toplam('VERESIYE');
  const odenen = nakit + kart;
  const karma = nakit > 0 && kart > 0;

  useEffect(() => {
    if (!acik) return;
    setNeden('');
    // Varsayılan: para ödendiği yoldan döner.
    setYol(karma ? 'ORIJINAL' : kart > 0 ? 'KART' : 'NAKIT');
  }, [acik, karma, kart]);

  if (!acik || !satisId) return null;

  const gecerli = neden.trim().length >= 3 && !calisiyor;

  const iptalEt = async () => {
    if (!gecerli) return;
    setCalisiyor(true);
    try {
      await cagir('satis.iptal', { satisId, neden: neden.trim(), paraYolu: yol === 'ORIJINAL' ? undefined : yol });
      bildir.basari(
        `Fiş ${fisNo} iptal edildi`,
        'Stok geri alındı; para seçilen yoldan iade edildi, varsa veresiye borcu silindi.',
      );
      onTamam();
    } catch (hata) {
      hatayiBildir(hata, 'Satış iptali');
    } finally {
      setCalisiyor(false);
    }
  };

  return (
    <Diyalog
      acik
      baslik={`Satışı İptal Et — ${fisNo}`}
      aciklama="İptal geri alınamaz. Satış silinmez, iptal edilmiş olarak işaretlenir."
      genislik="dar"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-tehlike" onClick={() => void iptalEt()} disabled={!gecerli}>
            {calisiyor ? 'İptal ediliyor…' : 'İptal Et'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded border border-uyari-cizgi bg-uyari-yumusak px-3 py-2 text-sm">
          İptal edildiğinde: satılan ürünler <strong>stoğa geri döner</strong>, gün sonu cirosu düzeltilir.
          {veresiye > 0 && (
            <>
              {' '}
              Veresiye kısmı (<strong>{paraFormat(veresiye)}</strong>) müşterinin borcundan silinir.
            </>
          )}
        </div>
        {odenen > 0 && (
          <div className="space-y-2" role="radiogroup" aria-label="Para nasıl iade edildi">
            <span className="etiket">{paraFormat(odenen)} müşteriye nasıl iade edildi?</span>
            {[
              ...(karma
                ? [
                    {
                      deger: 'ORIJINAL' as const,
                      baslik: 'Ödendiği gibi',
                      alt: `${paraFormat(nakit)} nakit (kasadan), ${paraFormat(kart)} karta (POS'tan)`,
                    },
                  ]
                : []),
              { deger: 'NAKIT' as const, baslik: '💵 Nakit (kasadan)', alt: 'Tutar şu anki açık kasadan çıkar.' },
              { deger: 'KART' as const, baslik: '💳 Karta (POS iadesi)', alt: 'POS cihazından iade yapın; kasa nakdi değişmez.' },
            ].map((s) => {
              const orijinal = karma ? s.deger === 'ORIJINAL' : (kart > 0 ? 'KART' : 'NAKIT') === s.deger;
              return (
                <button
                  key={s.deger}
                  type="button"
                  role="radio"
                  aria-checked={yol === s.deger}
                  onClick={() => setYol(s.deger)}
                  className={`w-full rounded border px-3 py-2 text-left text-sm ${
                    yol === s.deger ? 'border-vurgu bg-vurgu-yumusak' : 'border-cizgi hover:bg-yuzey-2'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2 font-medium">
                    {s.baslik}
                    {orijinal && <span className="text-xs font-normal text-metin-3">ödendiği yol</span>}
                  </span>
                  <span className="block text-xs text-metin-3">{s.alt}</span>
                </button>
              );
            })}
          </div>
        )}
        <Alan etiket="İptal nedeni *" ipucu="En az 3 karakter. Denetim kaydında ve fiş detayında görünür.">
          <input
            className="alan"
            value={neden}
            onChange={(e) => setNeden(e.target.value)}
            placeholder="Örn. yanlış ürün okutuldu, müşteri vazgeçti"
            data-odak
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && gecerli) {
                e.preventDefault();
                void iptalEt();
              }
            }}
          />
        </Alan>
      </div>
    </Diyalog>
  );
}
