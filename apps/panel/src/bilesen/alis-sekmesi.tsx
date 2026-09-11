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

import { useMemo, useState } from 'react';
import { bugun, gunEkle, miktarFormat, paraFormat, paraParse, tarihFormat, tarihSaatFormat, type Kurus } from '@market/shared';
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
  kdv_orani: number;
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

interface SatirGirdisi {
  urun_id: string;
  miktar: string;
  birim_fiyat: string;
  kdv_orani: string;
}

const BOS_SATIR: SatirGirdisi = { urun_id: '', miktar: '1', birim_fiyat: '', kdv_orani: '20' };

function YeniFaturaDiyalogu({ onKapat, onGonderildi }: { onKapat: () => void; onGonderildi: () => void }) {
  const tedarikciler = useVeri<{ data: Cari[] }>(`${uclar.cariler}?tip=TEDARIKCI&limit=200`);
  const urunler = useVeri<{ data: Urun[] }>(`${uclar.urunler}?limit=500`);

  const [form, setForm] = useState({
    tedarikci_id: '',
    fatura_no: '',
    tarih: bugun(),
    vade_tarihi: '',
    notlar: '',
    odenen: '',
    odeme_tipi: 'NAKIT' as 'NAKIT' | 'KART',
  });
  const [satirlar, setSatirlar] = useState<SatirGirdisi[]>([{ ...BOS_SATIR }]);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const urunHaritasi = useMemo(() => new Map((urunler.veri?.data ?? []).map((u) => [u.id, u])), [urunler.veri]);

  /*
   * Tutarlar KASADAKİ kuralla hesaplanır: birim fiyat KDV HARİÇtir (fatura
   * netleri). Ekranda gösterilen rakam ile kasanın yazacağı rakam aynı olmalı,
   * yoksa kullanıcı gönderdiğinden başka bir toplam görür.
   */
  const hesap = useMemo(() => {
    let ara = 0;
    let kdv = 0;
    for (const s of satirlar) {
      const miktar = Number(String(s.miktar).replace(',', '.'));
      const fiyat = paraParse(s.birim_fiyat);
      const oran = Number(s.kdv_orani);
      if (!s.urun_id || !Number.isFinite(miktar) || miktar <= 0 || fiyat === null) continue;
      const net = Math.round(miktar * fiyat);
      ara += net;
      kdv += Math.round((net * (Number.isFinite(oran) ? oran : 0)) / 100);
    }
    return { ara, kdv, genel: ara + kdv };
  }, [satirlar]);

  const gecerliSatirlar = satirlar.filter((s) => s.urun_id && paraParse(s.birim_fiyat) !== null);
  const gecerli = Boolean(form.tedarikci_id) && gecerliSatirlar.length > 0 && !gonderiliyor;

  const gonder = async () => {
    if (!gecerli) return;
    setGonderiliyor(true);
    setHata(null);
    try {
      await api(uclar.alisTalimatlari, {
        method: 'POST',
        body: JSON.stringify({
          tip: 'OLUSTUR',
          tedarikci_id: form.tedarikci_id,
          fatura_no: form.fatura_no.trim() || null,
          // Kasa zaman damgası bekler; seçilen gün gün başı olarak gönderilir.
          tarih: `${form.tarih}T00:00:00.000Z`,
          vade_tarihi: form.vade_tarihi || null,
          notlar: form.notlar.trim() || null,
          odenen_tutar: paraParse(form.odenen) ?? 0,
          odeme_tipi: form.odeme_tipi,
          kalemler: gecerliSatirlar.map((s) => ({
            urun_id: s.urun_id,
            // Miktar bindebir ölçekte taşınır (paylaşılan miktar sözleşmesi).
            miktar: Math.round(Number(String(s.miktar).replace(',', '.')) * 1000),
            birim_fiyat: paraParse(s.birim_fiyat) ?? 0,
            kdv_orani: Number(s.kdv_orani) || 0,
          })),
        }),
      });
      onGonderildi();
    } catch (h) {
      setHata(h instanceof Error ? h.message : 'Gönderilemedi.');
    } finally {
      setGonderiliyor(false);
    }
  };

  const satirGuncelle = (i: number, alan: keyof SatirGirdisi, deger: string) => {
    setSatirlar((onceki) => {
      const kopya = [...onceki];
      const satir = { ...kopya[i]!, [alan]: deger };
      // Ürün seçilince alış fiyatı ve KDV oranı karttan doldurulur; kullanıcı
      // her satırda aynı iki rakamı elle yazmak zorunda kalmasın.
      if (alan === 'urun_id') {
        const urun = urunHaritasi.get(deger);
        if (urun) {
          satir.birim_fiyat = urun.alis_fiyati ? paraFormat(urun.alis_fiyati, { simge: false }) : satir.birim_fiyat;
          satir.kdv_orani = String(urun.kdv_orani);
        }
      }
      kopya[i] = satir;
      return kopya;
    });
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
            <select
              className="alan"
              value={form.tedarikci_id}
              onChange={(e) => setForm({ ...form, tedarikci_id: e.target.value })}
            >
              <option value="">Seçin…</option>
              {(tedarikciler.veri?.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.ad_unvan}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="etiket">Fatura no</span>
            <input className="alan" value={form.fatura_no} onChange={(e) => setForm({ ...form, fatura_no: e.target.value })} />
          </label>
          <label className="block">
            <span className="etiket">Alış tarihi *</span>
            <input
              type="date"
              className="alan"
              value={form.tarih}
              onChange={(e) => setForm({ ...form, tarih: e.target.value })}
            />
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

        <div className="tablo-sarmal">
          <table className="tablo">
            <thead>
              <tr>
                <th className="text-left">Ürün</th>
                <th>Miktar</th>
                <th>Birim fiyat (KDV hariç)</th>
                <th>KDV %</th>
                <th>Satır toplamı</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {satirlar.map((s, i) => {
                const miktar = Number(String(s.miktar).replace(',', '.'));
                const fiyat = paraParse(s.birim_fiyat) ?? 0;
                const net = Number.isFinite(miktar) ? Math.round(miktar * fiyat) : 0;
                const satirToplam = net + Math.round((net * (Number(s.kdv_orani) || 0)) / 100);
                return (
                  <tr key={i}>
                    <td className="text-left">
                      <select className="alan" value={s.urun_id} onChange={(e) => satirGuncelle(i, 'urun_id', e.target.value)}>
                        <option value="">Ürün seçin…</option>
                        {(urunler.veri?.data ?? []).map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.ad}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="alan sayi"
                        inputMode="decimal"
                        value={s.miktar}
                        onChange={(e) => satirGuncelle(i, 'miktar', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="alan sayi"
                        inputMode="decimal"
                        value={s.birim_fiyat}
                        onChange={(e) => satirGuncelle(i, 'birim_fiyat', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="alan sayi"
                        inputMode="numeric"
                        value={s.kdv_orani}
                        onChange={(e) => satirGuncelle(i, 'kdv_orani', e.target.value)}
                      />
                    </td>
                    <td className="sayi font-semibold">{paraFormat(satirToplam, { simge: false })}</td>
                    <td>
                      {satirlar.length > 1 && (
                        <button
                          type="button"
                          className="text-xs text-tehlike hover:underline"
                          onClick={() => setSatirlar((o) => o.filter((_, j) => j !== i))}
                        >
                          sil
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button type="button" className="tus-ikincil" onClick={() => setSatirlar((o) => [...o, { ...BOS_SATIR }])}>
          + Satır Ekle
        </button>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="etiket">Peşin ödenen (₺)</span>
            <input
              className="alan sayi"
              inputMode="decimal"
              value={form.odenen}
              onChange={(e) => setForm({ ...form, odenen: e.target.value })}
              placeholder="0,00"
            />
            <span className="mt-1 block text-xs text-metin-4">Boş = tamamı tedarikçi borcu</span>
          </label>
          <label className="block">
            <span className="etiket">Ödeme tipi</span>
            <select
              className="alan"
              value={form.odeme_tipi}
              onChange={(e) => setForm({ ...form, odeme_tipi: e.target.value as 'NAKIT' | 'KART' })}
            >
              <option value="NAKIT">Nakit</option>
              <option value="KART">Kart</option>
            </select>
          </label>
          <label className="block">
            <span className="etiket">Notlar</span>
            <input className="alan" value={form.notlar} onChange={(e) => setForm({ ...form, notlar: e.target.value })} />
          </label>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <ParaKutusu etiket="Ara toplam" tutar={hesap.ara} alt="KDV hariç" />
          <ParaKutusu etiket="KDV" tutar={hesap.kdv} alt="Hesaplanan" />
          <ParaKutusu etiket="Genel toplam" tutar={hesap.genel} vurgulu />
        </div>

        <p className="rounded-lg border border-cizgi bg-yuzey-2 px-3 py-2 text-xs text-metin-3">
          Fatura kasada oluşur: stok ve cari defterinin tek yazıcısı kasadır. Kaydedildiğinde{' '}
          <strong>ürünlerin stoğu otomatik artar</strong>, tedarikçiye borç yazılır ve ürünlerin alış fiyatı güncellenir. Talimat
          bir sonraki senkronda uygulanır; nakit peşin ödeme varsa açık kasa gerektiği için kasa kapalıysa açılışta işlenir.
          {form.odeme_tipi === 'NAKIT' && (paraParse(form.odenen) ?? 0) > 0 && ' Nakit ödeme kasadan düşülecektir.'}
        </p>

        {hata && <p className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm">{hata}</p>}
      </div>
    </Modal>
  );
}
