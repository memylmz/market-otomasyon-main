/** Stok yönetimi (§10.6): mal kabul, fire, sayım, hareket geçmişi, kritik stok, SKT. */

import { useCallback, useEffect, useState } from 'react';
import { miktarFormat, miktarParse, paraFormat, tarihSaatFormat, type Kurus, type Miktar } from '@market/shared';
import { Alan, BosDurum, Diyalog, ParaAlani, Rozet, Yukleniyor } from '../bilesen/temel';
import { UrunSecici, type SecilenUrun } from '../bilesen/UrunSecici';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { useYetki } from '../durum/oturum';
import { cagir } from '../kopru';
import { AlisFaturasiFormu } from './stok/AlisFaturasiFormu';

type Sekme = 'ozet' | 'kritik' | 'skt' | 'hareketler' | 'sayim' | 'alis';

interface StokRaporu {
  deger: { maliyet: Kurus; satis: Kurus; kalem: number; toplamMiktar: Miktar };
  kritikSayisi: number;
  kritikler: {
    urun_id: string;
    ad: string;
    stok: Miktar;
    kritik_stok: Miktar;
    ideal_stok: Miktar;
    birim_tipi: string;
    onerilen_siparis: Miktar;
  }[];
  negatifler: { urun_id: string; ad: string; stok: Miktar }[];
  sktYaklasanlar: { urun_id: string; ad: string; skt: string; lot_no: string | null; kalan_miktar: Miktar; kalan_gun: number }[];
}

interface Hareket {
  id: string;
  urun_adi?: string;
  hareket_tipi: string;
  miktar: Miktar;
  aciklama: string | null;
  created_at: string;
  birim_maliyet?: Kurus;
}

export function StokSayfasi() {
  const [sekme, setSekme] = useState<Sekme>('ozet');
  const [rapor, setRapor] = useState<StokRaporu | null>(null);
  const [hareketler, setHareketler] = useState<Hareket[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [malKabulAcik, setMalKabulAcik] = useState(false);
  const [fireAcik, setFireAcik] = useState(false);
  const [tedarikciIadeAcik, setTedarikciIadeAcik] = useState(false);
  const [hareketFiltre, setHareketFiltre] = useState<{ tip: string; from: string; to: string; arama: string }>({
    tip: '',
    from: '',
    to: '',
    arama: '',
  });

  const girisYetkisi = useYetki('stok.giris');
  const fireYetkisi = useYetki('stok.fire');

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      const [r, h] = await Promise.all([
        cagir<StokRaporu>('stok.rapor'),
        cagir<Hareket[]>('stok.hareketler', {
          limit: 300,
          tip: hareketFiltre.tip || undefined,
          from: hareketFiltre.from || undefined,
          to: hareketFiltre.to || undefined,
        }),
      ]);
      setRapor(r);
      setHareketler(h);
    } catch (hata) {
      hatayiBildir(hata, 'Stok raporu');
    } finally {
      setYukleniyor(false);
    }
  }, [hareketFiltre.tip, hareketFiltre.from, hareketFiltre.to]);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  if (yukleniyor && !rapor) return <Yukleniyor />;

  const sekmeler: { anahtar: Sekme; etiket: string; sayi?: number }[] = [
    { anahtar: 'ozet', etiket: 'Özet' },
    { anahtar: 'kritik', etiket: 'Kritik Stok', sayi: rapor?.kritikSayisi },
    { anahtar: 'skt', etiket: 'SKT Takibi', sayi: rapor?.sktYaklasanlar.length },
    { anahtar: 'hareketler', etiket: 'Hareketler' },
    { anahtar: 'alis', etiket: 'Alış Faturaları' },
    { anahtar: 'sayim', etiket: 'Sayım' },
  ];

  return (
    <div className="flex h-full flex-col p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Stok Yönetimi</h1>
        {girisYetkisi && (
          <button type="button" className="tus-birincil" onClick={() => setMalKabulAcik(true)}>
            Mal Kabul
          </button>
        )}
        {girisYetkisi && (
          <button type="button" className="tus-ikincil" onClick={() => setTedarikciIadeAcik(true)}>
            Tedarikçiye İade
          </button>
        )}
        {fireYetkisi && (
          <button type="button" className="tus-ikincil" onClick={() => setFireAcik(true)}>
            Fire / Zaiat
          </button>
        )}
      </header>

      <nav className="mb-3 flex gap-1 border-b border-cizgi">
        {sekmeler.map((s) => (
          <button
            key={s.anahtar}
            type="button"
            onClick={() => setSekme(s.anahtar)}
            className={`px-4 py-2 text-sm transition-colors ${
              sekme === s.anahtar ? 'border-b-2 border-vurgu font-medium text-vurgu' : 'text-metin-3 hover:text-metin'
            }`}
          >
            {s.etiket}
            {s.sayi ? <span className="ml-1 rounded-full bg-uyari-yumusak px-1.5 text-xs text-uyari">{s.sayi}</span> : null}
          </button>
        ))}
      </nav>

      <div className="kart min-h-0 flex-1 overflow-auto">
        {sekme === 'ozet' && rapor && (
          <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kutu baslik="Stok maliyeti" deger={paraFormat(rapor.deger.maliyet)} aciklama="Alış fiyatlarıyla" />
            <Kutu baslik="Stok satış değeri" deger={paraFormat(rapor.deger.satis)} aciklama="Raf fiyatlarıyla" />
            <Kutu baslik="Stoklu ürün" deger={String(rapor.deger.kalem)} aciklama="Aktif ürün kalemi" />
            <Kutu
              baslik="Kritik stok"
              deger={String(rapor.kritikSayisi)}
              aciklama={
                rapor.negatifler.length > 0 ? `${rapor.negatifler.length} üründe eksi stok` : 'Sipariş önerisi için sekmeye bakın'
              }
              uyari={rapor.kritikSayisi > 0}
            />

            {rapor.negatifler.length > 0 && (
              <div className="sm:col-span-2 lg:col-span-4">
                <h3 className="mb-2 font-medium text-tehlike">Eksi stoktaki ürünler</h3>
                <table className="tablo">
                  <thead>
                    <tr>
                      <th>Ürün</th>
                      <th className="text-right">Stok</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rapor.negatifler.map((n) => (
                      <tr key={n.urun_id}>
                        <td>{n.ad}</td>
                        <td className="sayi text-tehlike">{miktarFormat(n.stok)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {sekme === 'kritik' && (
          <table className="tablo">
            <thead className="sticky top-0 bg-yuzey">
              <tr>
                <th>Ürün</th>
                <th className="text-right">Mevcut</th>
                <th className="text-right">Kritik</th>
                <th className="text-right">İdeal</th>
                <th className="text-right">Sipariş önerisi</th>
              </tr>
            </thead>
            <tbody>
              {(rapor?.kritikler ?? []).map((k) => (
                <tr key={k.urun_id}>
                  <td className="font-medium">{k.ad}</td>
                  <td className="sayi text-uyari">{miktarFormat(k.stok)}</td>
                  <td className="sayi text-metin-3">{miktarFormat(k.kritik_stok)}</td>
                  <td className="sayi text-metin-3">{miktarFormat(k.ideal_stok)}</td>
                  <td className="sayi font-semibold text-vurgu">{miktarFormat(k.onerilen_siparis)}</td>
                </tr>
              ))}
              {(rapor?.kritikler.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={5}>
                    <BosDurum baslik="Kritik stokta ürün yok" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {sekme === 'skt' && (
          <table className="tablo">
            <thead className="sticky top-0 bg-yuzey">
              <tr>
                <th>Ürün</th>
                <th>Lot</th>
                <th>SKT</th>
                <th className="text-right">Kalan miktar</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {(rapor?.sktYaklasanlar ?? []).map((s, i) => (
                <tr key={`${s.urun_id}-${s.skt}-${i}`}>
                  <td className="font-medium">{s.ad}</td>
                  <td className="text-metin-3">{s.lot_no ?? '—'}</td>
                  <td>{s.skt}</td>
                  <td className="sayi">{miktarFormat(s.kalan_miktar)}</td>
                  <td>
                    {s.kalan_gun < 0 ? (
                      <Rozet tur="tehlike">{-s.kalan_gun} gün geçti</Rozet>
                    ) : (
                      <Rozet tur="uyari">{s.kalan_gun} gün kaldı</Rozet>
                    )}
                  </td>
                </tr>
              ))}
              {(rapor?.sktYaklasanlar.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={5}>
                    <BosDurum baslik="Yaklaşan SKT yok" aciklama="Mal kabulde SKT girilen lotlar burada izlenir." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {sekme === 'alis' && <AlisFaturalariSekmesi onDegisti={() => void yukle()} />}

        {sekme === 'sayim' && <SayimSekmesi onDegisti={() => void yukle()} />}

        {sekme === 'hareketler' && (
          <>
            <div className="sticky top-0 z-10 mb-2 flex flex-wrap gap-2 border-b border-cizgi bg-yuzey p-3">
              <select
                className="alan max-w-[190px]"
                value={hareketFiltre.tip}
                onChange={(e) => setHareketFiltre((f) => ({ ...f, tip: e.target.value }))}
                aria-label="İşlem türü"
              >
                <option value="">Tüm işlem türleri</option>
                <option value="SATIS">Satış</option>
                <option value="GIRIS">Mal kabul / giriş</option>
                <option value="IADE">Müşteri iadesi</option>
                <option value="FIRE">Fire / zaiat</option>
                <option value="SAYIM">Sayım düzeltmesi</option>
                <option value="DUZELTME">Manuel düzeltme</option>
                <option value="ACILIS">Açılış stoğu</option>
                <option value="TEDARIKCI_IADE">Tedarikçiye iade</option>
              </select>
              <label className="flex items-center gap-1 text-sm">
                <span className="text-metin-3">Başlangıç</span>
                <input
                  type="date"
                  className="alan"
                  value={hareketFiltre.from}
                  onChange={(e) => setHareketFiltre((f) => ({ ...f, from: e.target.value }))}
                />
              </label>
              <label className="flex items-center gap-1 text-sm">
                <span className="text-metin-3">Bitiş</span>
                <input
                  type="date"
                  className="alan"
                  value={hareketFiltre.to}
                  onChange={(e) => setHareketFiltre((f) => ({ ...f, to: e.target.value }))}
                />
              </label>
              <input
                className="alan max-w-[220px]"
                placeholder="Ürün adında ara…"
                value={hareketFiltre.arama}
                onChange={(e) => setHareketFiltre((f) => ({ ...f, arama: e.target.value }))}
              />
              {(hareketFiltre.tip || hareketFiltre.from || hareketFiltre.to || hareketFiltre.arama) && (
                <button
                  type="button"
                  className="tus-ikincil px-3 py-1 text-sm"
                  onClick={() => setHareketFiltre({ tip: '', from: '', to: '', arama: '' })}
                >
                  Filtreleri temizle
                </button>
              )}
            </div>

            <table className="tablo">
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th className="text-left">Ürün</th>
                  <th className="text-center">Tür</th>
                  <th className="text-center">Miktar</th>
                  <th className="text-center">Birim maliyet</th>
                  <th className="text-left">Açıklama</th>
                </tr>
              </thead>
              <tbody>
                {/* Ürün adı filtresi istemcide uygulanır: sunucu zaten tarih ve
                    türe göre daralttı, kalan liste küçük ve anında süzülüyor. */}
                {hareketler
                  .filter((h) =>
                    hareketFiltre.arama
                      ? (h.urun_adi ?? '').toLocaleLowerCase('tr').includes(hareketFiltre.arama.toLocaleLowerCase('tr'))
                      : true,
                  )
                  .map((h) => (
                    <tr key={h.id}>
                      <td className="whitespace-nowrap text-metin-3">{tarihSaatFormat(h.created_at)}</td>
                      <td className="text-left font-medium">{h.urun_adi}</td>
                      <td className="text-center">{h.hareket_tipi}</td>
                      <td className={`sayi ${h.miktar < 0 ? 'text-tehlike' : 'text-vurgu'}`}>{miktarFormat(h.miktar)}</td>
                      <td className="sayi text-metin-3">
                        {h.birim_maliyet ? paraFormat(h.birim_maliyet, { simge: false }) : '—'}
                      </td>
                      <td className="max-w-xs truncate text-left text-metin-3">{h.aciklama ?? '—'}</td>
                    </tr>
                  ))}
                {hareketler.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <BosDurum baslik="Hareket bulunamadı" aciklama="Filtreleri değiştirmeyi deneyin." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>

      <AlisFaturasiFormu
        acik={malKabulAcik}
        onKapat={() => setMalKabulAcik(false)}
        onTamam={() => {
          setMalKabulAcik(false);
          void yukle();
        }}
      />
      <FireDiyalogu
        acik={fireAcik}
        onKapat={() => setFireAcik(false)}
        onTamam={() => {
          setFireAcik(false);
          void yukle();
        }}
      />
      <TedarikciIadeDiyalogu
        acik={tedarikciIadeAcik}
        onKapat={() => setTedarikciIadeAcik(false)}
        onTamam={() => {
          setTedarikciIadeAcik(false);
          void yukle();
        }}
      />
    </div>
  );
}

function Kutu({ baslik, deger, aciklama, uyari }: { baslik: string; deger: string; aciklama?: string; uyari?: boolean }) {
  return (
    <div className="rounded-lg border border-cizgi bg-yuzey-3 p-4">
      <p className="text-xs text-metin-3">{baslik}</p>
      <p className={`mt-1 font-mono text-2xl font-bold ${uyari ? 'text-uyari' : 'text-metin'}`}>{deger}</p>
      {aciklama && <p className="mt-1 text-xs text-metin-4">{aciklama}</p>}
    </div>
  );
}

interface IadeSatiri {
  urunId: string;
  ad: string;
  miktar: string;
  /** KDV hariç birim fiyat — alış faturasıyla aynı düzlem. */
  birimFiyat: Kurus;
  kdvOrani: number;
}

/**
 * Tedarikçiye mal iadesi: bozuk/yanlış gelen ürünler geri gönderilir.
 * Stok düşer; tutar tedarikçi borcundan düşülür ya da nakit olarak kasaya girer.
 */
function TedarikciIadeDiyalogu({ acik, onKapat, onTamam }: { acik: boolean; onKapat: () => void; onTamam: () => void }) {
  const [tedarikciler, setTedarikciler] = useState<{ id: string; ad_unvan: string }[]>([]);
  const [tedarikciId, setTedarikciId] = useState('');
  const [satirlar, setSatirlar] = useState<IadeSatiri[]>([]);
  const [neden, setNeden] = useState('');
  const [odemeSekli, setOdemeSekli] = useState<'CARIDEN_DUS' | 'NAKIT'>('CARIDEN_DUS');
  const [gonderiliyor, setGonderiliyor] = useState(false);

  useEffect(() => {
    if (!acik) return;
    setSatirlar([]);
    setNeden('');
    setOdemeSekli('CARIDEN_DUS');
    cagir<{ kayitlar: { id: string; ad_unvan: string }[] }>('cari.listele', { filtre: { tip: 'TEDARIKCI' }, limit: 100 })
      .then((v) => setTedarikciler(v.kayitlar))
      .catch(() => setTedarikciler([]));
  }, [acik]);

  const kalemEkle = (urun: SecilenUrun) => {
    setSatirlar((s) => [
      ...s,
      { urunId: urun.id, ad: urun.ad, miktar: '1', birimFiyat: urun.alis_fiyati, kdvOrani: urun.kdv_orani },
    ]);
  };

  // Mal kabulle aynı hesap: birim fiyat KDV hariç, KDV satır bazında eklenir.
  const genelToplam = satirlar.reduce((toplam, s) => {
    const miktar = miktarParse(s.miktar) ?? 0;
    const net = Math.round((miktar * s.birimFiyat) / 1000);
    return toplam + net + Math.round((net * s.kdvOrani) / 100);
  }, 0);

  const gonder = async () => {
    if (!tedarikciId || satirlar.length === 0) return;
    setGonderiliyor(true);
    try {
      const sonuc = await cagir<{ genelToplam: Kurus; kalemSayisi: number }>('stok.tedarikciIade', {
        tedarikci_id: tedarikciId,
        odeme_sekli: odemeSekli,
        neden: neden.trim() || undefined,
        kalemler: satirlar.map((s) => ({
          urun_id: s.urunId,
          miktar: miktarParse(s.miktar) ?? 0,
          birim_fiyat: s.birimFiyat,
          kdv_orani: s.kdvOrani,
        })),
      });
      bildir.basari(
        'Tedarikçi iadesi kaydedildi',
        odemeSekli === 'NAKIT'
          ? `${paraFormat(sonuc.genelToplam)} kasaya giriş yapıldı.`
          : `${paraFormat(sonuc.genelToplam)} tedarikçi borcundan düşüldü.`,
      );
      onTamam();
    } catch (hata) {
      hatayiBildir(hata, 'Tedarikçi iadesi');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Diyalog
      acik={acik}
      baslik="Tedarikçiye İade"
      aciklama="Onaylandığında stok düşer; tutar tedarikçi borcundan düşülür ya da nakit alındıysa kasaya girer."
      genislik="genis"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button
            type="button"
            className="tus-birincil"
            onClick={gonder}
            disabled={gonderiliyor || !tedarikciId || satirlar.length === 0 || genelToplam <= 0}
          >
            İadeyi Onayla
          </button>
        </>
      }
    >
      <div className="mb-3 grid gap-3 md:grid-cols-2">
        <Alan etiket="Tedarikçi *">
          <select className="alan" value={tedarikciId} onChange={(e) => setTedarikciId(e.target.value)} data-odak>
            <option value="">Seçiniz…</option>
            {tedarikciler.map((t) => (
              <option key={t.id} value={t.id}>
                {t.ad_unvan}
              </option>
            ))}
          </select>
        </Alan>
        <Alan etiket="İade nedeni" ipucu="İsteğe bağlı; hareket kayıtlarında görünür.">
          <input
            className="alan"
            value={neden}
            onChange={(e) => setNeden(e.target.value)}
            placeholder="Örn. hasarlı geldi, yanlış ürün…"
          />
        </Alan>
      </div>

      <div className="mb-3">
        <UrunSecici onSec={kalemEkle} placeholder="Barkod okutun veya ürün adı yazarak iade kalemi ekleyin…" />
      </div>

      {satirlar.length === 0 ? (
        <p className="py-6 text-center text-sm text-metin-4">
          Barkod okutarak ya da isim yazarak iade edilecek ürünleri ekleyin.
        </p>
      ) : (
        <table className="tablo">
          <thead>
            <tr>
              <th>Ürün</th>
              <th className="w-24">Miktar</th>
              <th className="w-36">Birim fiyat (KDV hariç)</th>
              <th className="w-16">KDV</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {satirlar.map((s, i) => (
              <tr key={i}>
                <td className="font-medium">{s.ad}</td>
                <td>
                  <input
                    className="alan sayi py-1"
                    value={s.miktar}
                    onChange={(e) =>
                      setSatirlar((liste) => liste.map((x, j) => (j === i ? { ...x, miktar: e.target.value } : x)))
                    }
                  />
                </td>
                <td>
                  <ParaAlani
                    deger={s.birimFiyat}
                    onDegisim={(v) => setSatirlar((liste) => liste.map((x, j) => (j === i ? { ...x, birimFiyat: v } : x)))}
                  />
                </td>
                <td className="sayi text-metin-3">%{s.kdvOrani}</td>
                <td>
                  <button
                    type="button"
                    className="text-tehlike"
                    onClick={() => setSatirlar((liste) => liste.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {satirlar.length > 0 && (
        <div className="mt-4 grid gap-3 border-t border-cizgi pt-3 md:grid-cols-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-metin-3">İade toplamı (KDV dahil)</span>
            <span className="font-mono text-lg font-bold text-uyari">{paraFormat(genelToplam)}</span>
          </div>
          <Alan etiket="Karşılığı" ipucu="Nakit seçilirse kasa açık olmalıdır; tutar kasaya giriş yazılır.">
            <select className="alan" value={odemeSekli} onChange={(e) => setOdemeSekli(e.target.value as typeof odemeSekli)}>
              <option value="CARIDEN_DUS">Tedarikçi borcundan düşülsün</option>
              <option value="NAKIT">Tedarikçi nakit iade etti (kasaya girer)</option>
            </select>
          </Alan>
        </div>
      )}
    </Diyalog>
  );
}

function FireDiyalogu({ acik, onKapat, onTamam }: { acik: boolean; onKapat: () => void; onTamam: () => void }) {
  const [barkod, setBarkod] = useState('');
  const [urun, setUrun] = useState<{ id: string; ad: string } | null>(null);
  const [miktar, setMiktar] = useState('1');
  const [neden, setNeden] = useState<'FIRE' | 'ZAIAT' | 'NUMUNE' | 'PERSONEL' | 'SKT_GECTI' | 'KIRIK_HASARLI'>('FIRE');
  const [aciklama, setAciklama] = useState('');

  useEffect(() => {
    if (acik) {
      setUrun(null);
      setBarkod('');
      setMiktar('1');
      setAciklama('');
    }
  }, [acik]);

  const ara = async () => {
    try {
      const sonuc = await cagir<{ bulundu: boolean; urun?: { id: string; ad: string } }>('urun.barkodOku', {
        barkod: barkod.trim(),
      });
      if (sonuc.bulundu && sonuc.urun) setUrun({ id: sonuc.urun.id, ad: sonuc.urun.ad });
      else bildir.uyari('Ürün bulunamadı');
    } catch (hata) {
      hatayiBildir(hata);
    }
  };

  const gonder = async () => {
    if (!urun) return;
    try {
      await cagir('stok.fire', {
        urun_id: urun.id,
        miktar: miktarParse(miktar) ?? 0,
        neden_kodu: neden,
        aciklama: aciklama || undefined,
      });
      bildir.basari('Fire çıkışı kaydedildi');
      onTamam();
    } catch (hata) {
      hatayiBildir(hata, 'Fire');
    }
  };

  return (
    <Diyalog
      acik={acik}
      baslik="Fire / Zaiat Çıkışı"
      aciklama="Neden kodu zorunludur; kayıt denetim loguna düşer."
      genislik="dar"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-tehlike" onClick={gonder} disabled={!urun}>
            Çıkışı Kaydet
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Alan etiket="Barkod">
          <div className="flex gap-2">
            <input
              className="alan"
              value={barkod}
              onChange={(e) => setBarkod(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ara()}
              data-odak
            />
            <button type="button" className="tus-ikincil" onClick={ara}>
              Bul
            </button>
          </div>
        </Alan>
        {urun && <p className="rounded bg-yuzey-3 px-3 py-2 font-medium">{urun.ad}</p>}
        <Alan etiket="Miktar">
          <input className="alan sayi" value={miktar} onChange={(e) => setMiktar(e.target.value)} />
        </Alan>
        <Alan etiket="Neden kodu">
          <select className="alan" value={neden} onChange={(e) => setNeden(e.target.value as typeof neden)}>
            <option value="FIRE">Fire</option>
            <option value="ZAIAT">Zaiat</option>
            <option value="NUMUNE">Numune</option>
            <option value="PERSONEL">Personel kullanımı</option>
            <option value="SKT_GECTI">SKT geçti</option>
            <option value="KIRIK_HASARLI">Kırık / hasarlı</option>
          </select>
        </Alan>
        <Alan etiket="Açıklama">
          <input className="alan" value={aciklama} onChange={(e) => setAciklama(e.target.value)} />
        </Alan>
      </div>
    </Diyalog>
  );
}

// ---------------------------------------------------------------------------
// Sayım (§10.6)
// ---------------------------------------------------------------------------

interface SayimKaydi {
  id: string;
  ad: string;
  durum: string;
  baslangic: string;
}

interface SayimFarki {
  urun_id: string;
  ad: string;
  birim_tipi: string;
  sistem_miktari: Miktar;
  sayilan_miktar: Miktar;
  fark: Miktar;
  alis_fiyati: Kurus;
}

/**
 * Dönemsel stok sayımı.
 *
 * Sayım AÇIK kaldığı sürece stok DEĞİŞMEZ: girilen sayılar yalnız kaydedilir,
 * fark listesi büyür. Stok ancak "Tamamla" dendiğinde tek seferde düzeltilir.
 * Bunun sebebi sayımın saatler sürmesi ve arada satış devam etmesidir — her
 * satırda stoğu anında düzeltmek, sayılmamış ürünlerin sayımını bozardı.
 *
 * Sayım iptal edilirse hiçbir stok hareketi üretilmez; girilen sayımlar
 * kayıtta kalır ama uygulanmaz.
 */
function SayimSekmesi({ onDegisti }: { onDegisti: () => void }) {
  const yetki = useYetki('stok.sayim');
  const [sayim, setSayim] = useState<SayimKaydi | null>(null);
  const [farklar, setFarklar] = useState<SayimFarki[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [ad, setAd] = useState('');
  const [secilen, setSecilen] = useState<SecilenUrun | null>(null);
  const [sayilanMetin, setSayilanMetin] = useState('');
  const [calisiyor, setCalisiyor] = useState(false);

  const tazele = useCallback(async () => {
    setYukleniyor(true);
    try {
      const acik = await cagir<SayimKaydi | null>('sayim.acik');
      setSayim(acik);
      setFarklar(acik ? await cagir<SayimFarki[]>('sayim.farklar', { sayimId: acik.id }) : []);
    } catch (hata) {
      hatayiBildir(hata, 'Sayım');
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    void tazele();
  }, [tazele]);

  const baslat = async () => {
    if (!ad.trim()) return;
    setCalisiyor(true);
    try {
      await cagir('sayim.baslat', { ad: ad.trim() });
      setAd('');
      bildir.basari('Sayım başlatıldı', 'Ürünleri okutup sayılan miktarı girin.');
      await tazele();
    } catch (hata) {
      hatayiBildir(hata, 'Sayım başlatma');
    } finally {
      setCalisiyor(false);
    }
  };

  const satirGir = async () => {
    if (!sayim || !secilen) return;
    const miktar = miktarParse(sayilanMetin);
    if (miktar === null || miktar < 0) {
      bildir.uyari('Geçersiz miktar', 'Sayılan miktarı sayı olarak girin.');
      return;
    }
    try {
      await cagir('sayim.satir', { sayimId: sayim.id, urunId: secilen.id, sayilan: miktar });
      setSecilen(null);
      setSayilanMetin('');
      await tazele();
    } catch (hata) {
      hatayiBildir(hata, 'Sayım satırı');
    }
  };

  const tamamla = async () => {
    if (!sayim) return;
    const sapan = farklar.filter((f) => f.fark !== 0).length;
    if (
      !window.confirm(
        `${farklar.length} ürün sayıldı, ${sapan} tanesinde fark var.\n\n` +
          'Tamamlandığında farklar stok düzeltmesine dönüşecek ve GERİ ALINAMAZ. Onaylıyor musunuz?',
      )
    )
      return;
    setCalisiyor(true);
    try {
      const sonuc = await cagir<{ duzeltilenKalem: number; toplamFarkMaliyeti: Kurus }>('sayim.tamamla', {
        sayimId: sayim.id,
      });
      bildir.basari(
        `Sayım tamamlandı — ${sonuc.duzeltilenKalem} kalem düzeltildi`,
        `Fark maliyeti: ${paraFormat(sonuc.toplamFarkMaliyeti)}`,
      );
      await tazele();
      onDegisti();
    } catch (hata) {
      hatayiBildir(hata, 'Sayım tamamlama');
    } finally {
      setCalisiyor(false);
    }
  };

  const iptalEt = async () => {
    if (!sayim) return;
    if (!window.confirm('Sayım iptal edilecek. Girilen sayımlar uygulanmayacak. Onaylıyor musunuz?')) return;
    try {
      await cagir('sayim.iptal', { sayimId: sayim.id });
      bildir.uyari('Sayım iptal edildi', 'Stokta değişiklik yapılmadı.');
      await tazele();
    } catch (hata) {
      hatayiBildir(hata, 'Sayım iptali');
    }
  };

  if (yukleniyor && !sayim) return <Yukleniyor />;

  if (!yetki) {
    return <BosDurum baslik="Yetkiniz yok" aciklama="Sayım yapabilmek için stok sayım yetkisi gerekir." />;
  }

  // --- açık sayım yoksa ---
  if (!sayim) {
    return (
      <div className="p-4">
        <div className="kart max-w-lg p-4">
          <h2 className="text-base font-semibold">Yeni sayım başlat</h2>
          <p className="mb-3 mt-1 text-sm text-metin-3">
            Sayım açıkken stok değişmez; girilen sayılar birikir. Stok yalnız <strong>Tamamla</strong> dendiğinde, tek seferde
            düzeltilir. Böylece sayım sürerken yapılan satışlar sayımı bozmaz.
          </p>
          <Alan etiket="Sayım adı" ipucu="Örn. “Eylül ayı genel sayım” ya da “Şarküteri reyonu”">
            <input
              className="alan"
              value={ad}
              onChange={(e) => setAd(e.target.value)}
              placeholder="Eylül ayı genel sayım"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ad.trim()) {
                  e.preventDefault();
                  void baslat();
                }
              }}
            />
          </Alan>
          <button type="button" className="tus-birincil mt-3" onClick={() => void baslat()} disabled={!ad.trim() || calisiyor}>
            {calisiyor ? 'Başlatılıyor…' : 'Sayımı Başlat'}
          </button>
        </div>
      </div>
    );
  }

  // --- açık sayım var ---
  const sapanlar = farklar.filter((f) => f.fark !== 0);
  const farkMaliyeti = sapanlar.reduce((t, f) => t + Math.round((f.fark / 1000) * f.alis_fiyati), 0);

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      <div className="kart mb-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">{sayim.ad}</h2>
              <Rozet tur="uyari">Sayım açık</Rozet>
            </div>
            <p className="mt-0.5 text-sm text-metin-3">Başlangıç: {tarihSaatFormat(sayim.baslangic)}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="tus-ikincil" onClick={() => void iptalEt()}>
              Sayımı İptal Et
            </button>
            <button
              type="button"
              className="tus-birincil"
              onClick={() => void tamamla()}
              disabled={farklar.length === 0 || calisiyor}
            >
              {calisiyor ? 'Uygulanıyor…' : 'Tamamla ve Stoğu Düzelt'}
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded bg-yuzey-3 px-3 py-2">
            <div className="text-xs text-metin-4">Sayılan ürün</div>
            <div className="font-mono text-lg font-semibold">{farklar.length}</div>
          </div>
          <div className="rounded bg-yuzey-3 px-3 py-2">
            <div className="text-xs text-metin-4">Farklı çıkan</div>
            <div className={`font-mono text-lg font-semibold ${sapanlar.length > 0 ? 'text-uyari' : ''}`}>{sapanlar.length}</div>
          </div>
          <div className="rounded bg-yuzey-3 px-3 py-2">
            <div className="text-xs text-metin-4">Fark maliyeti</div>
            <div className={`font-mono text-lg font-semibold ${farkMaliyeti < 0 ? 'text-tehlike' : 'text-basari'}`}>
              {paraFormat(farkMaliyeti, { simge: false, isaret: true })}
            </div>
          </div>
        </div>
      </div>

      <div className="kart mb-3 p-4">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto] md:items-end">
          <Alan etiket="Ürün">
            {secilen ? (
              <div className="flex items-center justify-between rounded border border-cizgi px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{secilen.ad}</div>
                  <div className="text-xs text-metin-4">Sistemde: {miktarFormat(secilen.stok, secilen.birim_tipi as never)}</div>
                </div>
                <button type="button" className="text-xs text-vurgu hover:underline" onClick={() => setSecilen(null)}>
                  Değiştir
                </button>
              </div>
            ) : (
              <UrunSecici onSec={setSecilen} placeholder="Barkod okutun veya ürün adı yazın…" otomatikOdak />
            )}
          </Alan>
          <Alan etiket="Sayılan miktar">
            <input
              className="alan sayi"
              inputMode="decimal"
              value={sayilanMetin}
              onChange={(e) => setSayilanMetin(e.target.value)}
              disabled={!secilen}
              placeholder="0"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void satirGir();
                }
              }}
            />
          </Alan>
          <button
            type="button"
            className="tus-birincil"
            onClick={() => void satirGir()}
            disabled={!secilen || sayilanMetin.trim() === ''}
          >
            Kaydet
          </button>
        </div>
        <p className="mt-2 text-xs text-metin-4">
          Aynı ürünü tekrar okutursanız son girdiğiniz sayı geçerli olur — yanlış saydığınızda baştan başlamanız gerekmez.
        </p>
      </div>

      <div className="kart min-h-0 flex-1 overflow-auto">
        {farklar.length === 0 ? (
          <BosDurum baslik="Henüz ürün sayılmadı" aciklama="Yukarıdan ürün okutup sayılan miktarı girin." />
        ) : (
          <table className="tablo">
            <thead className="sticky top-0 bg-yuzey">
              <tr>
                <th>Ürün</th>
                <th className="text-right">Sistemde</th>
                <th className="text-right">Sayılan</th>
                <th className="text-right">Fark</th>
                <th className="text-right">Fark maliyeti</th>
              </tr>
            </thead>
            <tbody>
              {farklar.map((f) => {
                const maliyet = Math.round((f.fark / 1000) * f.alis_fiyati);
                return (
                  <tr key={f.urun_id}>
                    <td className="font-medium">{f.ad}</td>
                    <td className="sayi text-metin-3">{miktarFormat(f.sistem_miktari, f.birim_tipi as never)}</td>
                    <td className="sayi">{miktarFormat(f.sayilan_miktar, f.birim_tipi as never)}</td>
                    <td
                      className={`sayi font-semibold ${f.fark === 0 ? 'text-metin-4' : f.fark < 0 ? 'text-tehlike' : 'text-basari'}`}
                    >
                      {f.fark === 0 ? '—' : miktarFormat(f.fark, f.birim_tipi as never, true)}
                    </td>
                    <td className={`sayi ${maliyet === 0 ? 'text-metin-4' : maliyet < 0 ? 'text-tehlike' : 'text-basari'}`}>
                      {maliyet === 0 ? '—' : paraFormat(maliyet, { simge: false, isaret: true })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alış faturaları (§11.8)
// ---------------------------------------------------------------------------

interface AlisFaturasi {
  id: string;
  tedarikci_id: string;
  tedarikci_adi?: string;
  fatura_no: string | null;
  tarih: string;
  ara_toplam: Kurus;
  kdv_toplam: Kurus;
  genel_toplam: Kurus;
  durum: 'TASLAK' | 'ONAYLANDI' | 'IPTAL';
  vade_tarihi: string | null;
  notlar: string | null;
}

interface AlisKalemi {
  id: string;
  urun_adi: string;
  miktar: Miktar;
  birim_fiyat: Kurus;
  kdv_orani: number;
  satir_toplam: Kurus;
  skt: string | null;
  lot_no: string | null;
}

/**
 * Girilmiş alış faturaları — panelle AYNI liste, aynı işlemler.
 *
 * Fatura kasada da iptal edilebilmelidir: mal kabulü yapan kişi hatayı fark
 * ettiğinde panele geçmek zorunda kalmamalı, hem de kasa çevrimdışıyken de
 * çalışmalıdır.
 */
function AlisFaturalariSekmesi({ onDegisti }: { onDegisti: () => void }) {
  const [faturalar, setFaturalar] = useState<AlisFaturasi[]>([]);
  const [secili, setSecili] = useState<AlisFaturasi | null>(null);
  const [kalemler, setKalemler] = useState<AlisKalemi[]>([]);
  const [iptalAcik, setIptalAcik] = useState(false);
  const [neden, setNeden] = useState('');
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yeniFaturaAcik, setYeniFaturaAcik] = useState(false);
  const girisYetkisi = useYetki('stok.giris');

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      setFaturalar(await cagir<AlisFaturasi[]>('stok.alisFaturalari'));
    } catch (hata) {
      hatayiBildir(hata, 'Alış faturaları');
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  const detayAc = async (fatura: AlisFaturasi) => {
    setSecili(fatura);
    try {
      const veri = await cagir<{ kalemler: AlisKalemi[] }>('stok.alisFaturasi', { faturaId: fatura.id });
      setKalemler(veri.kalemler);
    } catch (hata) {
      hatayiBildir(hata, 'Fatura detayı');
    }
  };

  /** Faturadaki ürünlerin etiketlerini, faturadaki adetlerle basar. */
  const faturaEtiketleriniBas = async () => {
    if (!secili) return;
    try {
      const satirlar = await cagir<{ urunId: string; ad: string; adet: number }[]>('etiket.faturadanDoldur', {
        faturaId: secili.id,
      });
      if (satirlar.length === 0) {
        bildir.uyari('Faturada etiketlenecek ürün yok');
        return;
      }
      const toplam = satirlar.reduce((t, s) => t + s.adet, 0);
      if (!window.confirm(`${satirlar.length} üründen toplam ${toplam} etiket basılacak. Devam edilsin mi?`)) return;

      const sonuc = await cagir<{ basarili: boolean; hata?: string; basilanEtiket: number }>('etiket.yazdir', {
        satirlar: satirlar.map((s) => ({ urunId: s.urunId, adet: s.adet })),
      });
      if (sonuc.basarili) bildir.basari(`${sonuc.basilanEtiket} etiket yazıcıya gönderildi`);
      else bildir.uyari('Etiket basılamadı', sonuc.hata);
    } catch (hata) {
      hatayiBildir(hata, 'Etiket yazdırma');
    }
  };

  const iptalEt = async () => {
    if (!secili || neden.trim().length < 3) return;
    try {
      await cagir('stok.alisFaturasiIptal', { faturaId: secili.id, neden: neden.trim() });
      bildir.basari('Fatura iptal edildi', 'Stok ve tedarikçi borcu geri alındı');
      setIptalAcik(false);
      setSecili(null);
      setNeden('');
      await yukle();
      onDegisti();
    } catch (hata) {
      hatayiBildir(hata, 'Fatura iptali');
    }
  };

  if (yukleniyor && faturalar.length === 0) return <Yukleniyor />;

  return (
    <div className="p-3">
      {/* Kasada da fatura girilebilmeli: mal kabulü yapan kişi panele geçmek zorunda kalmamalı. */}
      {girisYetkisi && (
        <div className="mb-3 flex justify-end">
          <button type="button" className="tus-birincil" onClick={() => setYeniFaturaAcik(true)}>
            Yeni Alış Faturası
          </button>
        </div>
      )}

      {faturalar.length === 0 ? (
        <BosDurum baslik="Alış faturası yok" aciklama="Mal Kabul ile girilen faturalar burada listelenir." />
      ) : (
        <table className="tablo">
          <thead>
            <tr>
              <th>Tarih</th>
              <th>Fatura no</th>
              <th>Tedarikçi</th>
              <th className="text-right">Ara toplam</th>
              <th className="text-right">KDV</th>
              <th className="text-right">Genel toplam</th>
              <th>Durum</th>
            </tr>
          </thead>
          <tbody>
            {faturalar.map((f) => (
              <tr key={f.id} className="cursor-pointer hover:bg-yuzey-2" onClick={() => void detayAc(f)}>
                <td className="text-metin-3">{tarihSaatFormat(f.tarih)}</td>
                <td>{f.fatura_no ?? '—'}</td>
                <td>{f.tedarikci_adi ?? '—'}</td>
                <td className="sayi">{paraFormat(f.ara_toplam, { simge: false })}</td>
                <td className="sayi text-metin-3">{paraFormat(f.kdv_toplam, { simge: false })}</td>
                <td className="sayi font-semibold">{paraFormat(f.genel_toplam, { simge: false })}</td>
                <td>
                  <Rozet tur={f.durum === 'IPTAL' ? 'tehlike' : f.durum === 'ONAYLANDI' ? 'basari' : 'notr'}>{f.durum}</Rozet>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <AlisFaturasiFormu
        acik={yeniFaturaAcik}
        onKapat={() => setYeniFaturaAcik(false)}
        onTamam={() => {
          setYeniFaturaAcik(false);
          void yukle();
          onDegisti();
        }}
      />

      <Diyalog
        acik={Boolean(secili) && !iptalAcik}
        baslik={secili ? `Fatura — ${secili.tedarikci_adi ?? ''}` : ''}
        aciklama={secili ? `${secili.fatura_no ?? 'Numarasız'} · ${tarihSaatFormat(secili.tarih)}` : ''}
        onKapat={() => setSecili(null)}
        altBilgi={
          <>
            <button type="button" className="tus-ikincil" onClick={() => setSecili(null)}>
              Kapat
            </button>
            {/*
              Mal kabul sonrası etiket basmanın doğru anı budur: ürünler daha
              elde, adetler faturadan geliyor. Sonradan "hangi üründen kaç tane
              gelmişti" diye aramak pratikte yapılmıyor.
            */}
            {secili?.durum !== 'IPTAL' && (
              <button type="button" className="tus-ikincil" onClick={() => void faturaEtiketleriniBas()}>
                Etiketlerini Bas
              </button>
            )}
            {girisYetkisi && secili?.durum !== 'IPTAL' && (
              <button type="button" className="tus-tehlike" onClick={() => setIptalAcik(true)}>
                Faturayı İptal Et
              </button>
            )}
          </>
        }
      >
        <table className="tablo">
          <thead>
            <tr>
              <th>Ürün</th>
              <th className="text-right">Miktar</th>
              <th className="text-right">Birim fiyat</th>
              <th className="text-right">KDV</th>
              <th className="text-right">Satır toplamı</th>
            </tr>
          </thead>
          <tbody>
            {kalemler.map((k) => (
              <tr key={k.id}>
                <td>{k.urun_adi}</td>
                <td className="sayi">{miktarFormat(k.miktar)}</td>
                <td className="sayi">{paraFormat(k.birim_fiyat, { simge: false })}</td>
                <td className="sayi text-metin-3">%{k.kdv_orani}</td>
                <td className="sayi font-semibold">{paraFormat(k.satir_toplam, { simge: false })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {secili?.notlar && <p className="mt-3 whitespace-pre-line text-xs text-metin-4">{secili.notlar}</p>}
      </Diyalog>

      <Diyalog
        acik={iptalAcik}
        baslik="Faturayı İptal Et"
        aciklama={secili ? paraFormat(secili.genel_toplam) : ''}
        genislik="dar"
        onKapat={() => setIptalAcik(false)}
        altBilgi={
          <>
            <button type="button" className="tus-ikincil" onClick={() => setIptalAcik(false)}>
              Vazgeç
            </button>
            <button type="button" className="tus-tehlike" onClick={() => void iptalEt()} disabled={neden.trim().length < 3}>
              İptal Et
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded border border-uyari-cizgi bg-uyari-yumusak px-3 py-2 text-sm">
            Kayıt silinmez: stok girişi ve tedarikçi borcu <strong>ters kayıtla</strong> geri alınır, fatura listede
            &quot;İPTAL&quot; olarak kalır. Peşin ödeme yapılmışsa o da geri alınır.
          </div>
          <Alan etiket="İptal nedeni *" ipucu="En az 3 karakter. Denetim kaydında görünür.">
            <input
              className="alan"
              value={neden}
              onChange={(e) => setNeden(e.target.value)}
              placeholder="Örn. fatura iki kez girilmiş"
              data-odak
              autoFocus
            />
          </Alan>
        </div>
      </Diyalog>
    </div>
  );
}
