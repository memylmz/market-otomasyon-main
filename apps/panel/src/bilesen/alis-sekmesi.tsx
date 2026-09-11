/**
 * Alış faturaları (§11.8) — tedarikçiden ne, hangi belgeyle, kaça alındı.
 *
 * FATURAYI PANEL İŞLEMEZ, KASA İŞLER. Fatura kaydedildiğinde stok artar ve
 * tedarikçiye cari borç doğar; iki defterin de tek yazıcısı kasadır. Panel
 * yalnız niyeti yazar (talimat), belgeyi ve hareketleri kasa kendi mal kabul
 * servisiyle üretir — panelden girilen fatura, kasadan girilenle birebir aynı
 * yoldan geçer: aynı doğrulama, aynı stok hareketi, aynı denetim kaydı.
 *
 * Yetki: yalnız ADMIN ve MÜDÜR. Kasadaki `stok.giris` yetkisiyle aynı kitle.
 *
 * NEDEN AYRI DOSYA: eskiden kendi sayfasıydı (`/alis`); artık kasadaki Stok
 * ekranındaki gibi Stok sayfasının bir sekmesi (madde 4 taşıması — bkz.
 * `app/stok/page.tsx`). Sayfaya özgü kabuk (`<Kabuk>`) kasıtlı olarak burada
 * YOK: o çağıran sayfanın işi, bu bileşen yalnız içeriği döner.
 */

'use client';

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import {
  bugun,
  gunEkle,
  kdvAyir,
  KDV_ORANLARI,
  miktarFormat,
  paraFormat,
  paraParse,
  tarihFormat,
  tarihSaatFormat,
  topluGirisKalemleri,
  VARSAYILAN_KDV_ORANI,
  type AlisKalemGirdisi,
  type Kurus,
  type TopluGirisSatiri,
} from '@market/shared';
import { AralikSecici, BosDurum, HataKutusu, Modal, ParaKutusu, Rozet, Yukleniyor } from '@/bilesen/kabuk';
import { api, uclar } from '@/lib/api';
import { useVeri } from '@/lib/kanca';

interface Fatura {
  id: string;
  fatura_no: string | null;
  tarih: string;
  ara_toplam: Kurus;
  kdv_toplam: Kurus;
  genel_toplam: Kurus;
  odenen_tutar: Kurus;
  durum: string;
  vade_tarihi: string | null;
  tedarikci_id: string;
  tedarikci_adi: string;
  kullanici_adi: string;
  kalem_sayisi: number;
}

interface Kalem {
  id: string;
  urun_id: string;
  urun_adi: string;
  birim_tipi: string;
  miktar: number;
  birim_fiyat: Kurus;
  kdv_orani: number;
  satir_toplam: Kurus;
  skt: string | null;
  lot_no: string | null;
}

interface Cari {
  id: string;
  ad_unvan: string;
  tip: string;
}

interface Urun {
  id: string;
  ad: string;
  birim_tipi: string;
  alis_fiyati: Kurus;
  satis_fiyati: Kurus;
  kdv_orani: number;
  /** DB'de 0/1; ürünün SKT takibi açıksa bu üründen eklenen satırda SKT zorunlu olur. */
  skt_takibi: number;
  /**
   * Yalnız `?barkod=` sorgusundan dönen satırlarda dolu gelir (bkz. Bölüm 1);
   * genel listede (`?limit=500`) yoktur, o yüzden opsiyoneldir.
   */
  barkod?: string;
}

const DURUM_ROZETI: Record<string, 'basari' | 'tehlike' | 'notr'> = {
  ONAYLANDI: 'basari',
  IPTAL: 'tehlike',
  TASLAK: 'notr',
};

export function AlisSekmesi() {
  const [bitis, setBitis] = useState(bugun());
  const [baslangic, setBaslangic] = useState(gunEkle(bugun(), -29));
  const [seciliId, setSeciliId] = useState<string | null>(null);
  const [yeniAcik, setYeniAcik] = useState(false);

  const liste = useVeri<{ data: Fatura[]; has_more: boolean; uretim_zamani: string }>(
    `${uclar.alisFaturalari}?from=${baslangic}&to=${bitis}&limit=200`,
    [baslangic, bitis],
  );

  const faturalar = liste.veri?.data ?? [];
  const gecerliler = faturalar.filter((f) => f.durum !== 'IPTAL');
  const toplam = gecerliler.reduce((t, f) => t + f.genel_toplam, 0);
  const kalanBorc = gecerliler.reduce((t, f) => t + (f.genel_toplam - f.odenen_tutar), 0);

  return (
    <>
      <div className="space-y-4">
        <section className="flex flex-wrap items-end gap-3">
          <AralikSecici
            baslangic={baslangic}
            bitis={bitis}
            onDegisim={(b, s) => {
              setBaslangic(b);
              setBitis(s);
            }}
          />
          <button type="button" className="tus-birincil" onClick={() => setYeniAcik(true)}>
            Yeni Alış Faturası
          </button>
        </section>

        {liste.yukleniyor && !liste.veri ? (
          <Yukleniyor />
        ) : liste.hata ? (
          <HataKutusu mesaj={liste.hata} tekrarDene={liste.tazele} />
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <ParaKutusu etiket="Dönem alışı" tutar={toplam} alt={`${gecerliler.length} fatura`} vurgulu />
              <ParaKutusu etiket="Ödenmemiş" tutar={kalanBorc} alt="Tedarikçilere kalan" />
              <ParaKutusu etiket="KDV toplamı" tutar={gecerliler.reduce((t, f) => t + f.kdv_toplam, 0)} alt="İndirilecek KDV" />
              <ParaKutusu
                etiket="İptal edilen"
                tutar={faturalar.filter((f) => f.durum === 'IPTAL').reduce((t, f) => t + f.genel_toplam, 0)}
                alt={`${faturalar.filter((f) => f.durum === 'IPTAL').length} fatura`}
              />
            </section>

            <section className="kart p-4">
              <h2 className="mb-3 font-semibold">Faturalar</h2>
              {faturalar.length === 0 ? (
                <BosDurum
                  baslik="Bu aralıkta fatura yok"
                  aciklama="Tarih aralığını genişletin ya da yeni bir alış faturası girin."
                />
              ) : (
                <div className="tablo-sarmal">
                  <table className="tablo">
                    <thead>
                      <tr>
                        <th className="text-left">Tarih</th>
                        <th>Fatura no</th>
                        <th className="text-left">Tedarikçi</th>
                        <th>Kalem</th>
                        <th>Ara toplam</th>
                        <th>KDV</th>
                        <th>Genel toplam</th>
                        <th>Kalan borç</th>
                        <th>Giren</th>
                        <th>Durum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {faturalar.map((f) => (
                        <tr key={f.id} className="cursor-pointer hover:bg-yuzey-2" onClick={() => setSeciliId(f.id)}>
                          <td className="whitespace-nowrap text-left">{tarihFormat(f.tarih)}</td>
                          <td>{f.fatura_no ?? '—'}</td>
                          <td className="text-left">{f.tedarikci_adi}</td>
                          <td className="sayi">{f.kalem_sayisi}</td>
                          <td className="sayi">{paraFormat(f.ara_toplam, { simge: false })}</td>
                          <td className="sayi text-metin-3">{paraFormat(f.kdv_toplam, { simge: false })}</td>
                          <td className="sayi font-semibold">{paraFormat(f.genel_toplam, { simge: false })}</td>
                          <td className={`sayi ${f.genel_toplam - f.odenen_tutar > 0 ? 'text-uyari' : 'text-metin-4'}`}>
                            {paraFormat(f.genel_toplam - f.odenen_tutar, { simge: false })}
                          </td>
                          <td className="text-xs text-metin-3">{f.kullanici_adi}</td>
                          <td>
                            <Rozet tur={DURUM_ROZETI[f.durum] ?? 'notr'}>{f.durum}</Rozet>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-xs text-metin-4">
                Satıra dokunarak kalemleri görebilir, faturayı düzenleyebilir ya da iptal edebilirsiniz. İptal edilen fatura
                listeden silinmez: &quot;mal hiç gelmedi&quot; ile &quot;fatura yanlıştı&quot; farklı şeylerdir, ikisi de kayıtta
                kalır.
              </p>
            </section>
          </>
        )}
      </div>

      {seciliId && (
        <FaturaDetayi
          faturaId={seciliId}
          onKapat={() => setSeciliId(null)}
          onDegisti={() => {
            liste.tazele();
          }}
        />
      )}

      {yeniAcik && (
        <YeniFaturaDiyalogu
          onKapat={() => setYeniAcik(false)}
          onGonderildi={() => {
            setYeniAcik(false);
            liste.tazele();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Fatura detayı — görüntüle, düzenle, iptal et
// ---------------------------------------------------------------------------

interface DetayVerisi {
  fatura: (Fatura & { notlar: string | null; iptal_neden: string | null; iptal_zamani: string | null }) | null;
  kalemler: Kalem[];
  bekleyen_talimatlar: { id: string; tip: string; created_at: string }[];
}

function FaturaDetayi({ faturaId, onKapat, onDegisti }: { faturaId: string; onKapat: () => void; onDegisti: () => void }) {
  const { veri, yukleniyor, hata, tazele } = useVeri<DetayVerisi>(`${uclar.alisFaturalari}/${faturaId}`);
  const [kip, setKip] = useState<'goruntule' | 'duzenle' | 'iptal'>('goruntule');

  const fatura = veri?.fatura ?? null;
  const bekleyen = veri?.bekleyen_talimatlar ?? [];
  const kilitli = bekleyen.length > 0 || fatura?.durum === 'IPTAL';

  const tamamlandi = () => {
    setKip('goruntule');
    tazele();
    onDegisti();
  };

  return (
    <Modal baslik={fatura ? `Fatura — ${fatura.tedarikci_adi}` : 'Alış faturası'} genis onKapat={onKapat}>
      {yukleniyor && !veri ? (
        <Yukleniyor />
      ) : hata ? (
        <HataKutusu mesaj={hata} tekrarDene={tazele} />
      ) : !fatura ? (
        <BosDurum baslik="Fatura bulunamadı" />
      ) : kip === 'duzenle' ? (
        <DuzenleFormu fatura={fatura} onVazgec={() => setKip('goruntule')} onTamam={tamamlandi} />
      ) : kip === 'iptal' ? (
        <IptalFormu fatura={fatura} onVazgec={() => setKip('goruntule')} onTamam={tamamlandi} />
      ) : (
        <div className="space-y-4">
          {bekleyen.length > 0 && (
            <div className="kart border-uyari-cizgi bg-uyari-yumusak p-3 text-sm">
              <p className="font-medium">Kasada uygulanmayı bekliyor</p>
              <p className="mt-1 text-xs text-metin-2">
                {bekleyen.map((t) => t.tip).join(', ')} — kasa bir sonraki senkronda uygular, kapalıysa açılışta işler.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
            <Bilgi etiket="Fatura no" deger={fatura.fatura_no ?? '—'} />
            <Bilgi etiket="Alış tarihi" deger={tarihSaatFormat(fatura.tarih)} />
            <Bilgi etiket="Vade" deger={fatura.vade_tarihi ? tarihFormat(fatura.vade_tarihi) : '—'} />
            <Bilgi etiket="Faturayı giren" deger={fatura.kullanici_adi} />
          </div>

          <div className="tablo-sarmal">
            <table className="tablo">
              <thead>
                <tr>
                  <th className="text-left">Ürün</th>
                  <th>Miktar</th>
                  <th>Birim fiyat</th>
                  <th>KDV</th>
                  <th>Satır toplamı</th>
                  <th>SKT / Lot</th>
                </tr>
              </thead>
              <tbody>
                {veri?.kalemler.map((k) => (
                  <tr key={k.id}>
                    <td className="text-left">{k.urun_adi}</td>
                    <td className="sayi">{miktarFormat(k.miktar)}</td>
                    <td className="sayi">{paraFormat(k.birim_fiyat, { simge: false })}</td>
                    <td className="sayi text-metin-3">%{k.kdv_orani}</td>
                    <td className="sayi font-semibold">{paraFormat(k.satir_toplam, { simge: false })}</td>
                    <td className="text-xs text-metin-4">{[k.skt, k.lot_no].filter(Boolean).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ParaKutusu etiket="Ara toplam" tutar={fatura.ara_toplam} alt="KDV hariç" />
            <ParaKutusu etiket="KDV" tutar={fatura.kdv_toplam} alt="Hesaplanan" />
            <ParaKutusu etiket="Genel toplam" tutar={fatura.genel_toplam} vurgulu />
            <ParaKutusu etiket="Kalan borç" tutar={fatura.genel_toplam - fatura.odenen_tutar} alt="Tedarikçiye" />
          </div>

          {fatura.notlar && <p className="whitespace-pre-line text-sm text-metin-3">{fatura.notlar}</p>}

          {fatura.durum === 'IPTAL' && (
            <div className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm">
              Bu fatura iptal edilmiştir{fatura.iptal_zamani ? ` (${tarihSaatFormat(fatura.iptal_zamani)})` : ''}.
              {fatura.iptal_neden ? ` Neden: ${fatura.iptal_neden}` : ''} Stok ve tedarikçi borcu ters kayıtla geri alındı.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" className="tus-ikincil" onClick={() => setKip('duzenle')} disabled={kilitli}>
              Belge Bilgilerini Düzenle
            </button>
            <button type="button" className="tus-tehlike" onClick={() => setKip('iptal')} disabled={kilitli}>
              Faturayı İptal Et
            </button>
          </div>

          {/*
            Miktar ve fiyat neden düzenlenemiyor: onaylı bir faturanın kalemini
            değiştirmek, çoktan yazılmış stok ve cari hareketlerini geçmişe
            dönük düzenlemek demektir; o defterler değiştirilemez. Yanlış
            girilmiş bir faturanın doğru düzeltmesi "iptal et, yeniden gir"dir.
          */}
          <p className="text-xs text-metin-4">
            Kalem, miktar ve fiyat buradan değiştirilemez: fatura onaylandığında stok ve tedarikçi borcu çoktan yazılmıştır ve o
            kayıtlar geriye dönük düzenlenemez. Yanlış girilmiş bir faturanın doğru düzeltmesi{' '}
            <strong>iptal edip yeniden girmektir</strong> — iptal, stoğu ve borcu ters kayıtla geri alır.
          </p>
        </div>
      )}
    </Modal>
  );
}

function Bilgi({ etiket, deger }: { etiket: string; deger: string }) {
  return (
    <div>
      <p className="text-xs text-metin-4">{etiket}</p>
      <p className="font-medium">{deger}</p>
    </div>
  );
}

function DuzenleFormu({
  fatura,
  onVazgec,
  onTamam,
}: {
  fatura: Fatura & { notlar: string | null };
  onVazgec: () => void;
  onTamam: () => void;
}) {
  const [form, setForm] = useState({
    fatura_no: fatura.fatura_no ?? '',
    vade_tarihi: fatura.vade_tarihi ?? '',
    notlar: fatura.notlar ?? '',
  });
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const gonder = async () => {
    setGonderiliyor(true);
    setHata(null);
    try {
      await api(uclar.alisTalimatlari, {
        method: 'POST',
        body: JSON.stringify({
          tip: 'GUNCELLE',
          fatura_id: fatura.id,
          fatura_no: form.fatura_no.trim() || null,
          vade_tarihi: form.vade_tarihi || null,
          notlar: form.notlar.trim() || null,
        }),
      });
      onTamam();
    } catch (h) {
      setHata(h instanceof Error ? h.message : 'Gönderilemedi.');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-metin-3">Belge bilgileri düzeltilir; kalemler ve tutarlar değişmez.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="etiket">Fatura no</span>
          <input className="alan" value={form.fatura_no} onChange={(e) => setForm({ ...form, fatura_no: e.target.value })} />
        </label>
        <label className="block">
          <span className="etiket">Vade tarihi</span>
          <input
            type="date"
            className="alan"
            value={form.vade_tarihi}
            onChange={(e) => setForm({ ...form, vade_tarihi: e.target.value })}
          />
        </label>
      </div>
      <label className="block">
        <span className="etiket">Notlar</span>
        <textarea className="alan" rows={3} value={form.notlar} onChange={(e) => setForm({ ...form, notlar: e.target.value })} />
      </label>

      {hata && <p className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm">{hata}</p>}

      <div className="flex gap-2">
        <button type="button" className="tus-ikincil flex-1" onClick={onVazgec}>
          Vazgeç
        </button>
        <button type="button" className="tus-birincil flex-1" onClick={() => void gonder()} disabled={gonderiliyor}>
          {gonderiliyor ? 'Gönderiliyor…' : 'Kasaya Gönder'}
        </button>
      </div>
    </div>
  );
}

function IptalFormu({ fatura, onVazgec, onTamam }: { fatura: Fatura; onVazgec: () => void; onTamam: () => void }) {
  const [neden, setNeden] = useState('');
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const gecerli = neden.trim().length >= 3 && !gonderiliyor;

  const gonder = async () => {
    if (!gecerli) return;
    setGonderiliyor(true);
    setHata(null);
    try {
      await api(uclar.alisTalimatlari, {
        method: 'POST',
        body: JSON.stringify({ tip: 'IPTAL', fatura_id: fatura.id, neden: neden.trim() }),
      });
      onTamam();
    } catch (h) {
      setHata(h instanceof Error ? h.message : 'Gönderilemedi.');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-uyari-cizgi bg-uyari-yumusak px-3 py-2 text-sm">
        <strong>{paraFormat(fatura.genel_toplam)}</strong> tutarındaki fatura iptal edilecek. Kayıt silinmez: stok girişi ve
        tedarikçi borcu <strong>ters kayıtla</strong> geri alınır, fatura listede &quot;İPTAL&quot; olarak kalır. Peşin ödeme
        yapılmışsa o da geri alınır.
      </div>
      <label className="block">
        <span className="etiket">İptal nedeni *</span>
        <input
          className="alan"
          value={neden}
          onChange={(e) => setNeden(e.target.value)}
          placeholder="Örn. fatura iki kez girilmiş"
          autoFocus
        />
        <span className="mt-1 block text-xs text-metin-4">En az 3 karakter. Denetim kaydında ve fatura notunda görünür.</span>
      </label>

      {hata && <p className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm">{hata}</p>}

      <div className="flex gap-2">
        <button type="button" className="tus-ikincil flex-1" onClick={onVazgec}>
          Vazgeç
        </button>
        <button type="button" className="tus-tehlike flex-1" onClick={() => void gonder()} disabled={!gecerli}>
          {gonderiliyor ? 'Gönderiliyor…' : 'Kasaya Gönder'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Yeni fatura
// ---------------------------------------------------------------------------

type OdemeDurumu = 'NAKIT' | 'HAVALE' | 'BORC';

interface SatirGirdisi {
  barkod: string;
  ad: string;
  miktar: string;
  /** KDV hariç birim alış fiyatı. */
  alis: Kurus;
  /** KDV dahil raf fiyatı; 0 = boş bırakılmış (marjdan hesaplanır). */
  satis: Kurus;
  kdv: string;
  skt: string;
  lot: string;
  /** Doluysa satır mevcut bir ürüne bağlıdır; ad/barkod salt okunur gösterilir. */
  urun_id?: string;
  /** Ürün kartında SKT takibi açıksa bu satırda SKT zorunludur. */
  sktZorunlu: boolean;
}

function bosSatir(barkod = ''): SatirGirdisi {
  return { barkod, ad: '', miktar: '1', alis: 0, satis: 0, kdv: String(VARSAYILAN_KDV_ORANI), skt: '', lot: '', sktZorunlu: false };
}

/**
 * Fatura toplamı kasadaki kuralla BİREBİR aynı hesaplanır (bkz.
 * `AlisFaturasiFormu.tsx` — `faturaToplamlari`): birim fiyat KDV hariçtir, KDV
 * satır bazında eklenir. Bu, satır→kalem çevriminin bir PARÇASI değildir (o
 * `topluGirisKalemleri`den gelir ve panelde tekrar yazılmaz); burada yalnız
 * dönen kalemler üzerinde gezinip ekranda gösterilecek toplamı üretir.
 */
function faturaToplamlari(kalemler: readonly AlisKalemGirdisi[]): { araToplam: Kurus; kdvToplam: Kurus; genelToplam: Kurus } {
  let araToplam = 0;
  let kdvToplam = 0;
  for (const kalem of kalemler) {
    const net = Math.round((kalem.miktar * kalem.birim_fiyat) / 1000);
    const { kdv } = kdvAyir(net + Math.round((net * kalem.kdv_orani) / 100), kalem.kdv_orani);
    araToplam += net;
    kdvToplam += kdv;
  }
  return { araToplam, kdvToplam, genelToplam: araToplam + kdvToplam };
}

/**
 * Para girişi — kasadaki `ParaAlani`nın panel karşılığı. Panelde ortak bir
 * para giriş bileşeni yoktu; barkodla dolan fiyatın kullanıcı satırı elle
 * düzenlerken sıçramaması için kasadaki UX BİREBİR tekrarlanır: alan
 * odaktayken ham TL metni düzenlenir, dışarıdan `deger` değişirse (ör. barkod
 * bulununca) yalnız DÜZENLENMİYORKEN senkronlanır.
 */
function ParaGirdi({
  deger,
  onDegisim,
  devreDisi,
  sinif = '',
  placeholder = '0,00',
}: {
  deger: Kurus;
  onDegisim: (kurus: Kurus) => void;
  devreDisi?: boolean;
  sinif?: string;
  placeholder?: string;
}) {
  const [metin, setMetin] = useState(() => (deger === 0 ? '' : paraFormat(deger, { simge: false })));
  const [duzenleniyor, setDuzenleniyor] = useState(false);

  useEffect(() => {
    if (!duzenleniyor) setMetin(deger === 0 ? '' : paraFormat(deger, { simge: false }));
  }, [deger, duzenleniyor]);

  return (
    <input
      type="text"
      inputMode="decimal"
      className={`alan sayi ${sinif}`}
      placeholder={placeholder}
      value={metin}
      disabled={devreDisi}
      onFocus={(e) => {
        setDuzenleniyor(true);
        e.currentTarget.select();
      }}
      onBlur={() => {
        setDuzenleniyor(false);
        setMetin(deger === 0 ? '' : paraFormat(deger, { simge: false }));
      }}
      onChange={(e) => {
        setMetin(e.target.value);
        onDegisim(paraParse(e.target.value) ?? 0);
      }}
    />
  );
}

function YeniFaturaDiyalogu({ onKapat, onGonderildi }: { onKapat: () => void; onGonderildi: () => void }) {
  const tedarikciler = useVeri<{ data: Cari[] }>(`${uclar.cariler}?tip=TEDARIKCI&limit=200`);
  const urunler = useVeri<{ data: Urun[] }>(`${uclar.urunler}?limit=500`);
  const kategoriler = useVeri<{ data: { id: string; ad: string }[] }>(uclar.kategoriler);

  const [tedarikciId, setTedarikciId] = useState('');
  const [faturaNo, setFaturaNo] = useState('');
  const [tarih, setTarih] = useState(bugun());
  const [vadeTarihi, setVadeTarihi] = useState('');
  const [odemeDurumu, setOdemeDurumu] = useState<OdemeDurumu>('BORC');
  /**
   * `null` = kullanıcı tutara hiç dokunmadı → "ödedim" iken genel toplamı
   * TAKİP EDER. Kullanıcı ParaGirdi'ye yazdığı an burada somut bir Kurus
   * değeri olarak sabitlenir ve genel toplam değişse de ÜZERİNE YAZILMAZ —
   * kısmi ödeme budur (bkz. AlisFaturasiFormu.tsx aynı kural).
   */
  const [odenenTutarElle, setOdenenTutarElle] = useState<Kurus | null>(null);
  const [notlar, setNotlar] = useState('');
  const [kategoriId, setKategoriId] = useState('');
  const [marjYuzde, setMarjYuzde] = useState('');
  const [satirlar, setSatirlar] = useState<SatirGirdisi[]>([]);
  const [barkodGirdi, setBarkodGirdi] = useState('');
  const [barkodAraniyor, setBarkodAraniyor] = useState(false);
  const [urunSecimi, setUrunSecimi] = useState('');
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const urunHaritasi = useMemo(() => new Map((urunler.veri?.data ?? []).map((u) => [u.id, u])), [urunler.veri]);

  const satirEkleMevcut = (urun: Urun, barkod = '') => {
    setSatirlar((s) => [
      ...s,
      {
        barkod: barkod || urun.barkod || '',
        ad: urun.ad,
        miktar: '1',
        alis: urun.alis_fiyati,
        satis: urun.satis_fiyati,
        kdv: String(urun.kdv_orani),
        skt: '',
        lot: '',
        urun_id: urun.id,
        sktZorunlu: Boolean(urun.skt_takibi),
      },
    ]);
  };

  /**
   * Barkod alanı akışın merkezidir (bkz. AlisFaturasiFormu.tsx): bulunan ürün
   * doğrudan satıra bağlanır, bulunamayan barkod "yeni ürün" satırı açar, boş
   * Enter ise barkodsuz yeni ürün satırı açar. Kasadan farkı: burası yerel bir
   * IPC değil HTTP çağrısıdır (Bölüm 1 — `GET /v1/urunler?barkod=`); art arda
   * Enter'a basılırsa aynı barkod iki kez sorgulanıp iki satır açılmasın diye
   * istek sürerken alan kilitlenir.
   */
  const barkodAra = async (tus: KeyboardEvent<HTMLInputElement>) => {
    if (tus.key !== 'Enter' || barkodAraniyor) return;
    tus.preventDefault();
    const deger = barkodGirdi.trim();
    setBarkodGirdi('');
    if (!deger) {
      setSatirlar((s) => [...s, bosSatir()]);
      return;
    }
    setBarkodAraniyor(true);
    setHata(null);
    try {
      const sonuc = await api<{ data: Urun[] }>(`${uclar.urunler}?barkod=${encodeURIComponent(deger)}`);
      const bulunan = sonuc.data[0];
      if (bulunan) {
        satirEkleMevcut(bulunan, bulunan.barkod ?? deger);
      } else {
        setSatirlar((s) => [...s, bosSatir(deger)]);
      }
    } catch (h) {
      setHata(h instanceof Error ? h.message : 'Barkod sorgulanamadı.');
    } finally {
      setBarkodAraniyor(false);
    }
  };

  const guncelle = (i: number, yama: Partial<SatirGirdisi>) =>
    setSatirlar((liste) => liste.map((x, j) => (j === i ? { ...x, ...yama } : x)));

  const satirSil = (i: number) => setSatirlar((liste) => liste.filter((_, j) => j !== i));

  // Satır → TopluGirisSatiri: ekranda Kurus tutulan alis/satis burada TR
  // biçimli metne çevrilir, çünkü topluGirisKalemleri (kasa ve panelle ORTAK)
  // metin bekler.
  const donusumSatirlari = useMemo<TopluGirisSatiri[]>(
    () =>
      satirlar.map((s) => ({
        barkod: s.barkod,
        ad: s.ad,
        miktar: s.miktar,
        alis: s.alis === 0 ? '' : paraFormat(s.alis, { simge: false }),
        satis: s.satis === 0 ? '' : paraFormat(s.satis, { simge: false }),
        kdv: s.kdv,
        skt: s.skt,
        lot: s.lot,
        urun_id: s.urun_id,
      })),
    [satirlar],
  );

  const marjSayi = useMemo(() => {
    const metin = marjYuzde.trim().replace(',', '.');
    if (!metin) return undefined;
    const sayi = Number(metin);
    return Number.isFinite(sayi) ? sayi : undefined;
  }, [marjYuzde]);

  // Satır→kalem çevrimi ve marj hesabı BURADA TEKRAR YAZILMAZ: kasa ve panel
  // aynı satırdan aynı faturayı üretmeli (bkz. AlisFaturasiFormu.tsx aynı yorum).
  const { kalemler, hatalar } = useMemo(() => {
    const sonuc = topluGirisKalemleri(donusumSatirlari, { marjYuzde: marjSayi });
    // Kategori yalnız YENİ ürünlere uygulanır; bu bir hesap değil, seçilmiş
    // veriyi iliştirmektir — topluGirisKalemleri'nin işini burada tekrarlamaz.
    const kategoriliKalemler = sonuc.kalemler.map((k) =>
      k.yeni_urun ? { ...k, yeni_urun: { ...k.yeni_urun, kategori_id: kategoriId || null } } : k,
    );
    return { kalemler: kategoriliKalemler, hatalar: sonuc.hatalar };
  }, [donusumSatirlari, marjSayi, kategoriId]);

  const { araToplam, kdvToplam, genelToplam } = useMemo(() => faturaToplamlari(kalemler), [kalemler]);

  // Borç kalsın → 0 ve alan kapalı. Ödedim (nakit/havale) → kullanıcı elle yazmadıysa
  // genel toplamı TAKİP eder; yazdıysa o değer kalır — tam ödeme de kısmi ödeme de
  // aynı alanla, ayrı bir "kısmi" seçeneği icat edilmeden (kasadakiyle birebir aynı kural).
  const odenenTutar = odemeDurumu === 'BORC' ? 0 : (odenenTutarElle ?? genelToplam);
  // Bulut zaten reddeder ("Ödenen tutar fatura toplamından fazla olamaz"); burada gönderilmeden ÖNCE gösterilir.
  const odenenTutarAsimi = odemeDurumu !== 'BORC' && odenenTutar > genelToplam;

  // SKT takibi açık ürünlerde tarih girilmeden gönderilemez — yalnız görsel uyarı değil, gerçek bir kapı.
  const sktEksikler = satirlar.filter((s) => s.sktZorunlu && !s.skt.trim());

  const gecerli =
    Boolean(tedarikciId) &&
    kalemler.length > 0 &&
    hatalar.length === 0 &&
    sktEksikler.length === 0 &&
    !odenenTutarAsimi &&
    !gonderiliyor;

  const gonder = async () => {
    if (!gecerli) return;
    setGonderiliyor(true);
    setHata(null);
    try {
      await api(uclar.alisTalimatlari, {
        method: 'POST',
        body: JSON.stringify({
          tip: 'OLUSTUR',
          tedarikci_id: tedarikciId,
          fatura_no: faturaNo.trim() || null,
          // Kasa zaman damgası bekler; seçilen gün gün başı olarak gönderilir.
          tarih: `${tarih}T00:00:00.000Z`,
          vade_tarihi: vadeTarihi || null,
          notlar: notlar.trim() || null,
          odenen_tutar: odenenTutar,
          odeme_tipi: odemeDurumu === 'BORC' ? undefined : odemeDurumu,
          kalemler,
        }),
      });
      onGonderildi();
    } catch (h) {
      // Diyalog burada KAPATILMAZ: toptancının önünde girilen satırlar kaybolmamalı.
      setHata(h instanceof Error ? h.message : 'Gönderilemedi.');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Modal
      baslik="Yeni Alış Faturası"
      genis
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil flex-1" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil flex-1" onClick={() => void gonder()} disabled={!gecerli}>
            {gonderiliyor ? 'Gönderiliyor…' : 'Kasaya Gönder'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="etiket">Tedarikçi *</span>
            <select className="alan" value={tedarikciId} onChange={(e) => setTedarikciId(e.target.value)}>
              <option value="">Seçin…</option>
              {(tedarikciler.veri?.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.ad_unvan}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="etiket">Fatura / irsaliye no</span>
            <input className="alan" value={faturaNo} onChange={(e) => setFaturaNo(e.target.value)} />
          </label>
          <label className="block">
            <span className="etiket">Fatura tarihi</span>
            <input type="date" className="alan" value={tarih} onChange={(e) => setTarih(e.target.value)} />
          </label>
          <label className="block">
            <span className="etiket">Vade tarihi</span>
            <input type="date" className="alan" value={vadeTarihi} onChange={(e) => setVadeTarihi(e.target.value)} />
          </label>
          <label className="block">
            <span className="etiket">Ödeme durumu</span>
            <select
              className="alan"
              value={odemeDurumu}
              onChange={(e) => {
                // Yöntem değişince tutar yeniden genel toplamdan başlar — önceki elle
                // yazılmış kısmi tutar farklı bir ödeme yöntemine sessizce taşınmasın.
                setOdemeDurumu(e.target.value as OdemeDurumu);
                setOdenenTutarElle(null);
              }}
            >
              <option value="BORC">Ödemedim — borç kalsın</option>
              <option value="NAKIT">Ödedim — nakit</option>
              <option value="HAVALE">Ödedim — havale/kart</option>
            </select>
          </label>
          <label className="block">
            <span className="etiket">Ödenen tutar</span>
            <ParaGirdi
              deger={odenenTutar}
              onDegisim={setOdenenTutarElle}
              devreDisi={odemeDurumu === 'BORC'}
              sinif={odenenTutarAsimi ? 'border-tehlike' : ''}
            />
            <span className="mt-1 block text-xs text-metin-4">
              {odemeDurumu === 'BORC'
                ? 'Borç kalsın seçiliyken tutar sıfırdır.'
                : 'Azaltıp toptancıya elden verilen kısmi tutarı girebilirsiniz; kalanı tedarikçi borcu olarak kaydedilir.'}
            </span>
            {odenenTutarAsimi && <span className="mt-1 block text-xs text-tehlike">Ödenen tutar genel toplamı aşamaz.</span>}
          </label>
          <label className="block">
            <span className="etiket">Kategori</span>
            <select className="alan" value={kategoriId} onChange={(e) => setKategoriId(e.target.value)}>
              <option value="">Kategorisiz</option>
              {(kategoriler.veri?.data ?? []).map((k) => (
                <option key={k.id} value={k.id}>
                  {k.ad}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-metin-4">Yalnız bu faturada açılacak yeni ürünlere uygulanır.</span>
          </label>
          <label className="block">
            <span className="etiket">Hedef kâr marjı %</span>
            <input
              className="alan sayi"
              value={marjYuzde}
              onChange={(e) => setMarjYuzde(e.target.value)}
              placeholder="Örn. 30"
            />
            <span className="mt-1 block text-xs text-metin-4">Yeni ürünlerde satış fiyatı boş bırakılırsa bu marjdan hesaplanır.</span>
          </label>
          <label className="block sm:col-span-2 lg:col-span-4">
            <span className="etiket">Notlar</span>
            <input className="alan" value={notlar} onChange={(e) => setNotlar(e.target.value)} />
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t border-cizgi pt-3">
          <label className="block min-w-[220px] flex-1">
            <span className="etiket">Barkod</span>
            <input
              className="alan"
              value={barkodGirdi}
              onChange={(e) => setBarkodGirdi(e.target.value)}
              onKeyDown={(e) => void barkodAra(e)}
              placeholder="Okutun ya da yazıp Enter'layın…"
              disabled={barkodAraniyor}
            />
          </label>
          <label className="block min-w-[220px] flex-1">
            <span className="etiket">Mevcut üründen ekle</span>
            <select
              className="alan"
              value={urunSecimi}
              onChange={(e) => {
                const urun = urunHaritasi.get(e.target.value);
                if (urun) satirEkleMevcut(urun);
                setUrunSecimi('');
              }}
            >
              <option value="">Barkodu olmayan ürünü adıyla seçin…</option>
              {(urunler.veri?.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.ad}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="tus-ikincil" onClick={() => setSatirlar((s) => [...s, bosSatir()])}>
            + Barkodsuz satır ekle
          </button>
        </div>

        {satirlar.length === 0 ? (
          <BosDurum
            baslik="Kalem yok"
            aciklama="Barkod okutarak, yazıp Enter'layarak ya da isimle seçerek kalem ekleyin."
          />
        ) : (
          <>
            {/* Dar ekran: kart listesi. Geniş ekranda aynı veri tablo olarak dizilir (aşağıda). */}
            <div className="space-y-3 lg:hidden">
              {satirlar.map((s, i) => {
                const yeniUrun = !s.urun_id;
                return (
                  <div key={i} className="kart space-y-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-1 items-center gap-2">
                        {yeniUrun ? (
                          <input
                            className="alan"
                            value={s.ad}
                            onChange={(e) => guncelle(i, { ad: e.target.value })}
                            placeholder="Ürün adı *"
                          />
                        ) : (
                          <span className="font-medium">{s.ad}</span>
                        )}
                        {yeniUrun && <Rozet tur="bilgi">Yeni</Rozet>}
                      </div>
                      <button type="button" className="text-tehlike" onClick={() => satirSil(i)} aria-label="Satırı sil">
                        ✕
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs">
                        <span className="etiket">Barkod</span>
                        {yeniUrun ? (
                          <input
                            className="alan"
                            value={s.barkod}
                            onChange={(e) => guncelle(i, { barkod: e.target.value })}
                            placeholder="Barkodsuz"
                          />
                        ) : (
                          <p className="alan bg-yuzey-2 text-metin-3">{s.barkod || '—'}</p>
                        )}
                      </label>
                      <label className="block text-xs">
                        <span className="etiket">Miktar</span>
                        <input
                          className="alan sayi"
                          inputMode="decimal"
                          value={s.miktar}
                          onChange={(e) => guncelle(i, { miktar: e.target.value })}
                        />
                      </label>
                      <label className="block text-xs">
                        <span className="etiket">Alış (KDV hariç)</span>
                        <ParaGirdi deger={s.alis} onDegisim={(v) => guncelle(i, { alis: v })} />
                      </label>
                      <label className="block text-xs">
                        <span className="etiket">Satış (KDV dahil)</span>
                        <ParaGirdi deger={s.satis} onDegisim={(v) => guncelle(i, { satis: v })} placeholder={yeniUrun ? 'marjdan' : '0,00'} />
                      </label>
                      <label className="block text-xs">
                        <span className="etiket">KDV %</span>
                        <select className="alan" value={s.kdv} onChange={(e) => guncelle(i, { kdv: e.target.value })}>
                          {KDV_ORANLARI.map((o) => (
                            <option key={o} value={o}>
                              %{o}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs">
                        <span className="etiket">Lot</span>
                        <input className="alan" value={s.lot} onChange={(e) => guncelle(i, { lot: e.target.value })} />
                      </label>
                      <label className="col-span-2 block text-xs">
                        <span className="etiket">SKT{s.sktZorunlu ? ' *' : ''}</span>
                        <input
                          type="date"
                          className={`alan ${s.sktZorunlu && !s.skt ? 'border-tehlike' : ''}`}
                          value={s.skt}
                          aria-label={`${s.ad || 'Satır ' + (i + 1)} son kullanma tarihi`}
                          onChange={(e) => guncelle(i, { skt: e.target.value })}
                        />
                        {s.sktZorunlu && !s.skt && <span className="mt-0.5 block text-[11px] text-tehlike">SKT zorunlu</span>}
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="tablo-sarmal hidden lg:block">
              <table className="tablo">
                <thead>
                  <tr>
                    <th className="w-32">Barkod</th>
                    <th>Ürün</th>
                    <th className="w-20">Miktar</th>
                    <th className="w-28">Alış (KDV hariç)</th>
                    <th className="w-28">Satış (KDV dahil)</th>
                    <th className="w-20">KDV</th>
                    <th className="w-32">SKT</th>
                    <th className="w-24">Lot</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {satirlar.map((s, i) => {
                    const yeniUrun = !s.urun_id;
                    return (
                      <tr key={i}>
                        <td>
                          {yeniUrun ? (
                            <input
                              className="alan py-1"
                              value={s.barkod}
                              onChange={(e) => guncelle(i, { barkod: e.target.value })}
                              placeholder="Barkodsuz"
                            />
                          ) : (
                            <span className="text-metin-3">{s.barkod || '—'}</span>
                          )}
                        </td>
                        <td>
                          {yeniUrun ? (
                            <div className="flex items-center gap-2">
                              <input
                                className="alan py-1"
                                value={s.ad}
                                onChange={(e) => guncelle(i, { ad: e.target.value })}
                                placeholder="Ürün adı *"
                              />
                              <Rozet tur="bilgi">Yeni</Rozet>
                            </div>
                          ) : (
                            <span className="font-medium">{s.ad}</span>
                          )}
                        </td>
                        <td>
                          <input
                            className="alan sayi py-1"
                            inputMode="decimal"
                            value={s.miktar}
                            onChange={(e) => guncelle(i, { miktar: e.target.value })}
                          />
                        </td>
                        <td>
                          <ParaGirdi deger={s.alis} onDegisim={(v) => guncelle(i, { alis: v })} />
                        </td>
                        <td>
                          <ParaGirdi deger={s.satis} onDegisim={(v) => guncelle(i, { satis: v })} placeholder={yeniUrun ? 'marjdan' : '0,00'} />
                        </td>
                        <td>
                          <select className="alan py-1" value={s.kdv} onChange={(e) => guncelle(i, { kdv: e.target.value })}>
                            {KDV_ORANLARI.map((o) => (
                              <option key={o} value={o}>
                                %{o}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="date"
                            className={`alan py-1 ${s.sktZorunlu && !s.skt ? 'border-tehlike' : ''}`}
                            value={s.skt}
                            aria-label={`${s.ad || 'Satır ' + (i + 1)} son kullanma tarihi`}
                            onChange={(e) => guncelle(i, { skt: e.target.value })}
                          />
                          {s.sktZorunlu && !s.skt && <span className="mt-0.5 block text-[11px] text-tehlike">SKT zorunlu</span>}
                        </td>
                        <td>
                          <input className="alan py-1" value={s.lot} onChange={(e) => guncelle(i, { lot: e.target.value })} />
                        </td>
                        <td>
                          <button type="button" className="text-tehlike" onClick={() => satirSil(i)} aria-label="Satırı sil">
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {hatalar.length > 0 && (
          <div className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm text-tehlike">
            <ul className="list-disc pl-4">
              {hatalar.map((h, i) => (
                <li key={i}>
                  Satır {h.satir}: {h.mesaj}
                </li>
              ))}
            </ul>
          </div>
        )}

        {satirlar.length > 0 && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <ParaKutusu etiket="Ara toplam" tutar={araToplam} alt="KDV hariç" />
            <ParaKutusu etiket="KDV" tutar={kdvToplam} alt="Hesaplanan" />
            <ParaKutusu etiket="Genel toplam" tutar={genelToplam} vurgulu />
            <ParaKutusu etiket="Ödenen" tutar={odenenTutar} />
            <ParaKutusu etiket="Kalan borç" tutar={Math.max(0, genelToplam - odenenTutar)} alt="Tedarikçiye" />
          </div>
        )}

        <p className="rounded-lg border border-cizgi bg-yuzey-2 px-3 py-2 text-xs text-metin-3">
          Fatura kasada oluşur: stok ve cari defterinin tek yazıcısı kasadır. Kaydedildiğinde{' '}
          <strong>ürünlerin stoğu otomatik artar</strong>, tedarikçiye borç yazılır; katalogda olmayan ürünler fatura ile{' '}
          <strong>aynı anda</strong> açılır. Talimat bir sonraki senkronda uygulanır; nakit peşin ödeme varsa açık kasa gerektiği
          için kasa kapalıysa açılışta işlenir.
        </p>

        {hata && <p className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm">{hata}</p>}
      </div>
    </Modal>
  );
}
