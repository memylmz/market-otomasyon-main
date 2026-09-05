/** Stok yönetimi (§10.6): mal kabul, fire, sayım, hareket geçmişi, kritik stok, SKT. */

import { useCallback, useEffect, useState } from 'react';
import { miktarFormat, miktarParse, paraFormat, tarihSaatFormat, type Kurus, type Miktar } from '@market/shared';
import { Alan, BosDurum, Diyalog, ParaAlani, Rozet, Yukleniyor } from '../bilesen/temel';
import { UrunSecici, type SecilenUrun } from '../bilesen/UrunSecici';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { useYetki } from '../durum/oturum';
import { cagir } from '../kopru';

type Sekme = 'ozet' | 'kritik' | 'skt' | 'hareketler' | 'sayim';

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

      <MalKabulDiyalogu
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

interface KabulSatiri {
  urunId: string;
  ad: string;
  miktar: string;
  birimFiyat: Kurus;
  kdvOrani: number;
  skt: string;
  lot: string;
  /** Ürün kartında SKT takibi açıksa bu kalemde tarih zorunludur. */
  sktZorunlu: boolean;
}

function MalKabulDiyalogu({ acik, onKapat, onTamam }: { acik: boolean; onKapat: () => void; onTamam: () => void }) {
  const [tedarikciler, setTedarikciler] = useState<{ id: string; ad_unvan: string }[]>([]);
  const [tedarikciId, setTedarikciId] = useState('');
  const [faturaNo, setFaturaNo] = useState('');
  const [satirlar, setSatirlar] = useState<KabulSatiri[]>([]);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [odenen, setOdenen] = useState<Kurus>(0);
  const [odemeTipi, setOdemeTipi] = useState<'NAKIT' | 'KART'>('NAKIT');

  useEffect(() => {
    if (!acik) return;
    setSatirlar([]);
    setFaturaNo('');
    setOdenen(0);
    setOdemeTipi('NAKIT');
    cagir<{ kayitlar: { id: string; ad_unvan: string }[] }>('cari.listele', { filtre: { tip: 'TEDARIKCI' }, limit: 100 })
      .then((v) => setTedarikciler(v.kayitlar))
      .catch(() => setTedarikciler([]));
  }, [acik]);

  const kalemEkle = (urun: SecilenUrun) => {
    setSatirlar((s) => [
      ...s,
      {
        urunId: urun.id,
        ad: urun.ad,
        miktar: '1',
        birimFiyat: urun.alis_fiyati,
        kdvOrani: urun.kdv_orani,
        skt: '',
        lot: '',
        sktZorunlu: urun.skt_takibi === true,
      },
    ]);
  };

  // SKT takibi açık ürünlerde tarih girilmeden onay verilmez (ürün kartındaki söz).
  const sktEksikler = satirlar.filter((s) => s.sktZorunlu && !s.skt);

  // Fatura toplamı: birim fiyatlar KDV hariçtir, KDV satır bazında eklenir.
  const faturaToplami = satirlar.reduce((toplam, s) => {
    const miktar = miktarParse(s.miktar) ?? 0;
    const net = Math.round((miktar * s.birimFiyat) / 1000);
    return toplam + net + Math.round((net * s.kdvOrani) / 100);
  }, 0);

  const gonder = async () => {
    if (!tedarikciId || satirlar.length === 0) return;
    if (odenen > faturaToplami) {
      bildir.uyari('Ödenen tutar fatura toplamından fazla olamaz');
      return;
    }
    if (sktEksikler.length > 0) {
      bildir.uyari(
        'Son kullanma tarihi eksik',
        `${sktEksikler.map((s) => s.ad).join(', ')} için SKT takibi açık; tarih girmeden onaylayamazsınız.`,
      );
      return;
    }
    setGonderiliyor(true);
    try {
      const sonuc = await cagir<{ genelToplam: Kurus; odenen: Kurus; kalanBorc: Kurus }>('stok.malKabul', {
        tedarikci_id: tedarikciId,
        fatura_no: faturaNo.trim() || undefined,
        odenen_tutar: odenen,
        odeme_tipi: odemeTipi,
        kalemler: satirlar.map((s) => ({
          urun_id: s.urunId,
          miktar: miktarParse(s.miktar) ?? 0,
          birim_fiyat: s.birimFiyat,
          kdv_orani: s.kdvOrani,
          skt: s.skt || undefined,
          lot_no: s.lot || undefined,
        })),
      });
      bildir.basari(
        'Mal kabul onaylandı',
        sonuc.odenen > 0
          ? `Toplam ${paraFormat(sonuc.genelToplam)} · Ödenen ${paraFormat(sonuc.odenen)} · Kalan borç ${paraFormat(sonuc.kalanBorc)}`
          : `Tedarikçiye ${paraFormat(sonuc.genelToplam)} borç kaydedildi.`,
      );
      onTamam();
    } catch (hata) {
      hatayiBildir(hata, 'Mal kabul');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Diyalog
      acik={acik}
      baslik="Mal Kabul (Alış)"
      aciklama="Onaylandığında stok artar ve tedarikçiye cari borç oluşur."
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
            disabled={gonderiliyor || !tedarikciId || satirlar.length === 0 || sktEksikler.length > 0}
          >
            Onayla
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
        <Alan etiket="Fatura no">
          <input className="alan" value={faturaNo} onChange={(e) => setFaturaNo(e.target.value)} />
        </Alan>
      </div>

      <div className="mb-3">
        <UrunSecici onSec={kalemEkle} placeholder="Barkod okutun veya ürün adı yazarak kalem ekleyin…" />
      </div>

      {satirlar.length === 0 ? (
        <p className="py-6 text-center text-sm text-metin-4">Barkod okutarak ya da isim yazarak kalem ekleyin.</p>
      ) : (
        <table className="tablo">
          <thead>
            <tr>
              <th>Ürün</th>
              <th className="w-24">Miktar</th>
              <th className="w-32">Alış (KDV hariç)</th>
              <th className="w-32">SKT</th>
              <th className="w-28">Lot</th>
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
                <td>
                  <input
                    type="date"
                    className={`alan py-1 ${s.sktZorunlu && !s.skt ? 'border-tehlike' : ''}`}
                    value={s.skt}
                    aria-label={`${s.ad} son kullanma tarihi`}
                    onChange={(e) => setSatirlar((liste) => liste.map((x, j) => (j === i ? { ...x, skt: e.target.value } : x)))}
                  />
                  {s.sktZorunlu && !s.skt && <span className="mt-0.5 block text-[11px] text-tehlike">SKT zorunlu</span>}
                </td>
                <td>
                  <input
                    className="alan py-1"
                    value={s.lot}
                    onChange={(e) => setSatirlar((liste) => liste.map((x, j) => (j === i ? { ...x, lot: e.target.value } : x)))}
                  />
                </td>
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
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-metin-3">Fatura toplamı (KDV dahil)</span>
              <span className="font-mono font-semibold">{paraFormat(faturaToplami)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-metin-3">Ödenen</span>
              <span className="font-mono text-vurgu">{paraFormat(odenen)}</span>
            </div>
            <div className="flex justify-between border-t border-cizgi-ince pt-1">
              <span className="font-medium">Kalan borç</span>
              <span className="font-mono font-bold text-uyari">{paraFormat(Math.max(0, faturaToplami - odenen))}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Alan etiket="Şimdi ödenen tutar" ipucu="Boş bırakılırsa tamamı tedarikçi borcu olarak kaydedilir.">
              <ParaAlani deger={odenen} onDegisim={setOdenen} />
            </Alan>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="tus-ikincil px-3 py-1 text-sm" onClick={() => setOdenen(faturaToplami)}>
                Tamamı ödendi
              </button>
              <button
                type="button"
                className="tus-ikincil px-3 py-1 text-sm"
                onClick={() => setOdenen(Math.round(faturaToplami / 2))}
              >
                Yarısı
              </button>
              <button type="button" className="tus-ikincil px-3 py-1 text-sm" onClick={() => setOdenen(0)}>
                Tamamı borç
              </button>
            </div>
            {odenen > 0 && (
              <Alan etiket="Ödeme şekli" ipucu="Nakit seçilirse kasadan da düşülür; kasa açık olmalıdır.">
                <select className="alan" value={odemeTipi} onChange={(e) => setOdemeTipi(e.target.value as 'NAKIT' | 'KART')}>
                  <option value="NAKIT">Nakit (kasadan)</option>
                  <option value="KART">Kart / havale (kasayı etkilemez)</option>
                </select>
              </Alan>
            )}
          </div>
        </div>
      )}
    </Diyalog>
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
