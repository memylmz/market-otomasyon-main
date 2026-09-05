/**
 * Ürün / katalog yönetimi (§11.4) — panelden yapılan değişiklik senkronla kasaya iner.
 *
 * Kasadaki Ürünler ekranıyla aynı alanları sunar: eksik alanla kaydetmek,
 * kasada girilmiş kritik stok / SKT takibi gibi bilgileri sessizce sıfırlar.
 */

'use client';

import { useEffect, useState } from 'react';
import { KDV_ORANLARI, miktarFormat, paraFormat, paraParse, type Kurus } from '@market/shared';
import { BosDurum, HataKutusu, Kabuk, Modal, Rozet, Yukleniyor } from '@/bilesen/kabuk';
import { api, uclar } from '@/lib/api';
import { useVeri } from '@/lib/kanca';

const SAYFA_BOYU = 50;

/** Kasadaki listeyle aynı birim kısaltmaları. */
function birimKisa(birimTipi: string): string {
  if (birimTipi === 'KG') return 'kg';
  if (birimTipi === 'LT') return 'lt';
  return 'ad';
}

/** Miktarlar veritabanında bindebir tam sayıdır; "1,5" → 1500. */
function miktarKurusHesapla(metin: string): number {
  const sayi = Number(String(metin).replace(',', '.'));
  return Number.isFinite(sayi) ? Math.round(sayi * 1000) : 0;
}

interface Urun {
  id: string;
  ad: string;
  kategori_id: string | null;
  kategori_adi: string | null;
  marka: string | null;
  birim_tipi: string;
  alis_fiyati: Kurus;
  satis_fiyati: Kurus;
  kdv_orani: number;
  notlar: string | null;
  kritik_stok: number;
  ideal_stok: number;
  raf_konumu: string | null;
  skt_takibi: number;
  stok: number;
  aktif_mi: number;
}

interface Kategori {
  id: string;
  ad: string;
  sira: number;
  aktif_mi: number;
}

export default function UrunlerSayfasi() {
  const [arama, setArama] = useState('');
  const [kategoriId, setKategoriId] = useState('');
  const [siralama, setSiralama] = useState<'ad' | 'stok' | 'fiyat' | 'guncelleme'>('ad');
  const [sadeceKritik, setSadeceKritik] = useState(false);
  const [sayfa, setSayfa] = useState(0);
  const [duzenlenen, setDuzenlenen] = useState<Urun | 'yeni' | null>(null);
  const [topluAcik, setTopluAcik] = useState(false);
  const [kategoriAcik, setKategoriAcik] = useState(false);

  const sorgu = new URLSearchParams({
    limit: String(SAYFA_BOYU),
    ofset: String(sayfa * SAYFA_BOYU),
    siralama,
    ...(arama ? { q: arama } : {}),
    ...(kategoriId ? { kategori_id: kategoriId } : {}),
    ...(sadeceKritik ? { sadece_kritik: '1' } : {}),
  });

  const { veri, yukleniyor, hata, tazele } = useVeri<{ data: Urun[]; toplam: number; has_more: boolean }>(
    `${uclar.urunler}?${sorgu.toString()}`,
    [arama, kategoriId, siralama, sadeceKritik, sayfa],
  );
  const kategoriler = useVeri<{ data: Kategori[] }>(uclar.kategoriler);

  // Filtre değişince ilk sayfaya dön; aksi hâlde 7. sayfada boş liste görünür.
  const filtreDegistir = (islem: () => void) => {
    islem();
    setSayfa(0);
  };

  const toplam = veri?.toplam ?? 0;
  const sayfaSayisi = Math.max(1, Math.ceil(toplam / SAYFA_BOYU));

  return (
    <Kabuk baslik="Ürünler">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <input
            className="alan max-w-xs flex-1"
            placeholder="Ürün adı veya marka…"
            value={arama}
            onChange={(e) => filtreDegistir(() => setArama(e.target.value))}
          />
          <button type="button" className="tus-ikincil" onClick={() => setKategoriAcik(true)}>
            Kategoriler
          </button>
          <button type="button" className="tus-ikincil" onClick={() => setTopluAcik(true)}>
            Toplu Fiyat
          </button>
          <button type="button" className="tus-birincil" onClick={() => setDuzenlenen('yeni')}>
            Yeni Ürün
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className="alan max-w-[200px]"
            value={kategoriId}
            onChange={(e) => filtreDegistir(() => setKategoriId(e.target.value))}
            aria-label="Kategori filtresi"
          >
            <option value="">Tüm kategoriler</option>
            {(kategoriler.veri?.data ?? []).map((k) => (
              <option key={k.id} value={k.id}>
                {k.ad}
              </option>
            ))}
          </select>
          <select
            className="alan max-w-[200px]"
            value={siralama}
            onChange={(e) => filtreDegistir(() => setSiralama(e.target.value as typeof siralama))}
            aria-label="Sıralama"
          >
            <option value="ad">Sıralama: A → Z</option>
            <option value="stok">Sıralama: Stoğu az olan</option>
            <option value="fiyat">Sıralama: Pahalıdan ucuza</option>
            <option value="guncelleme">Sıralama: Son güncellenen</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-metin-2">
            <input
              type="checkbox"
              checked={sadeceKritik}
              onChange={(e) => filtreDegistir(() => setSadeceKritik(e.target.checked))}
            />
            Kritik stok
          </label>
          <span className="ml-auto text-sm text-metin-3">{toplam} ürün</span>
        </div>

        {yukleniyor ? (
          <Yukleniyor />
        ) : hata ? (
          <HataKutusu mesaj={hata} tekrarDene={tazele} />
        ) : (
          <div className="kart">
            {(veri?.data.length ?? 0) === 0 ? (
              <BosDurum baslik="Ürün bulunamadı" aciklama="Filtreleri değiştirin ya da yeni ürün ekleyin." />
            ) : (
              <div className="tablo-sarmal">
                <table className="tablo">
                  <thead>
                    <tr>
                      <th className="text-left">Ürün</th>
                      <th className="text-left">Kategori</th>
                      <th>Stok</th>
                      <th>Alış</th>
                      <th>Satış</th>
                      <th>KDV</th>
                      <th>Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(veri?.data ?? []).map((u) => {
                      const kritik = u.kritik_stok > 0 && u.stok <= u.kritik_stok;
                      return (
                        <tr key={u.id} onClick={() => setDuzenlenen(u)} className="cursor-pointer">
                          <td className="text-left">
                            <div className="max-w-[200px] truncate font-medium">{u.ad}</div>
                            <div className="text-xs text-metin-4">{u.marka ?? '—'}</div>
                          </td>
                          <td className="text-left text-metin-3">{u.kategori_adi ?? '—'}</td>
                          {/* Birim kasadaki listeyle aynı biçimde yazılır: "35 kg"
                              ile "35" farklı şeyler okunur, iki ekran ayrışmasın. */}
                          <td className={`sayi ${u.stok < 0 ? 'text-tehlike' : kritik ? 'text-uyari' : ''}`}>
                            {miktarFormat(u.stok)} <span className="text-xs text-metin-4">{birimKisa(u.birim_tipi)}</span>
                          </td>
                          <td className="sayi text-metin-3">{paraFormat(u.alis_fiyati, { simge: false })}</td>
                          <td className="sayi font-semibold">{paraFormat(u.satis_fiyati, { simge: false })}</td>
                          <td className="sayi text-metin-3">%{u.kdv_orani}</td>
                          <td>
                            {u.aktif_mi !== 1 ? (
                              <Rozet tur="notr">Pasif</Rozet>
                            ) : kritik ? (
                              <Rozet tur="uyari">Kritik</Rozet>
                            ) : (
                              <Rozet tur="basari">Aktif</Rozet>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 text-xs text-metin-4">
          <span>Düzenlemek için ürüne dokunun.</span>
          {toplam > SAYFA_BOYU && (
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                className="tus-ikincil px-2 py-1 text-xs"
                disabled={sayfa === 0}
                onClick={() => setSayfa((s) => Math.max(0, s - 1))}
              >
                ‹ Önceki
              </button>
              <span className="text-metin-3">
                Sayfa {sayfa + 1} / {sayfaSayisi}
              </span>
              <button
                type="button"
                className="tus-ikincil px-2 py-1 text-xs"
                disabled={sayfa + 1 >= sayfaSayisi}
                onClick={() => setSayfa((s) => s + 1)}
              >
                Sonraki ›
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-metin-4">
          Panelden yapılan değişiklikler bir sonraki senkronda kasaya iner. Kasa aynı ürünü daha sonra değiştirmişse son
          değişiklik geçerli olur ve çakışma kaydı tutulur.
        </p>
      </div>

      {duzenlenen && (
        <UrunFormu
          urun={duzenlenen}
          kategoriler={kategoriler.veri?.data ?? []}
          onKapat={() => setDuzenlenen(null)}
          onKaydedildi={() => {
            setDuzenlenen(null);
            tazele();
          }}
        />
      )}

      {kategoriAcik && (
        <KategoriFormu
          kategoriler={kategoriler.veri?.data ?? []}
          onKapat={() => setKategoriAcik(false)}
          onDegisti={() => {
            kategoriler.tazele();
            tazele();
          }}
        />
      )}

      {topluAcik && (
        <TopluZamFormu
          kategoriler={kategoriler.veri?.data ?? []}
          onKapat={() => setTopluAcik(false)}
          onUygulandi={() => {
            setTopluAcik(false);
            tazele();
          }}
        />
      )}
    </Kabuk>
  );
}

// ---------------------------------------------------------------------------
// Ürün kartı
// ---------------------------------------------------------------------------

function UrunFormu({
  urun,
  kategoriler,
  onKapat,
  onKaydedildi,
}: {
  urun: Urun | 'yeni';
  kategoriler: Kategori[];
  onKapat: () => void;
  onKaydedildi: () => void;
}) {
  const yeniMi = urun === 'yeni';
  const mevcut = yeniMi ? null : urun;

  const [form, setForm] = useState({
    ad: mevcut?.ad ?? '',
    marka: mevcut?.marka ?? '',
    kategoriId: mevcut?.kategori_id ?? '',
    birimTipi: mevcut?.birim_tipi ?? 'ADET',
    alis: mevcut ? paraFormat(mevcut.alis_fiyati, { simge: false }) : '',
    satis: mevcut ? paraFormat(mevcut.satis_fiyati, { simge: false }) : '',
    kdv: mevcut?.kdv_orani ?? 20,
    kritikStok: mevcut?.kritik_stok ? String(mevcut.kritik_stok / 1000) : '',
    idealStok: mevcut?.ideal_stok ? String(mevcut.ideal_stok / 1000) : '',
    rafKonumu: mevcut?.raf_konumu ?? '',
    sktTakibi: mevcut?.skt_takibi === 1,
    aktif: mevcut ? mevcut.aktif_mi === 1 : true,
    // Stok miktarı. Yeni üründe "açılış stoğu", mevcutta "yeni sayım" anlamına
    // gelir; ikisi de kasaya TALİMAT olarak iner, hareketi kasa üretir (§11.5).
    stok: mevcut ? String(mevcut.stok / 1000) : '',
    notlar: mevcut?.notlar ?? '',
  });
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [kasalar, setKasalar] = useState<{ id: string; cihaz_adi: string }[]>([]);
  const [hedefKasa, setHedefKasa] = useState('');

  // Stok talimatı tek bir kasaya yazılır: bulutta stok özeti cihaz boyutu
  // taşımadığı için iki kasa uygularsa çift sayılırdı.
  // Bekleyen talimat varsa kullanıcıya söylenir: aksi hâlde rakamın değişmediğini
  // görüp "olmadı" der ve tekrar girer. Tekrarlar artık birikmiyor (sonuncusu
  // öncekinin yerine geçiyor) ama belirsizliği yaşatmanın da anlamı yok.
  const [bekleyenTalimat, setBekleyenTalimat] = useState(0);
  useEffect(() => {
    if (yeniMi || !mevcut) return;
    api<{ data: { urun_id: string }[] }>(uclar.stokDuzeltmeleri)
      .then((v) => setBekleyenTalimat((v.data ?? []).filter((d) => d.urun_id === mevcut.id).length))
      .catch(() => setBekleyenTalimat(0));
  }, [yeniMi, mevcut]);

  useEffect(() => {
    api<{ data: { id: string; cihaz_adi: string }[] }>(uclar.cihazlar)
      .then((v) => {
        setKasalar(v.data ?? []);
        if ((v.data ?? []).length === 1) setHedefKasa(v.data[0]!.id);
      })
      .catch(() => setKasalar([]));
  }, []);

  const birimEtiketi = form.birimTipi === 'ADET' ? 'adet' : form.birimTipi.toLowerCase();
  const mevcutStok = mevcut?.stok ?? 0;
  const hedefStok = miktarKurusHesapla(form.stok);
  const stokFarki = hedefStok - mevcutStok;

  const miktarKurus = miktarKurusHesapla;

  const kaydet = async () => {
    const satisKurus = paraParse(form.satis);
    if (!form.ad.trim() || satisKurus === null) {
      setHata('Ürün adı ve satış fiyatı zorunludur.');
      return;
    }
    setGonderiliyor(true);
    setHata(null);
    try {
      const kayit = await api<{ id: string }>(uclar.urunler, {
        method: 'POST',
        body: JSON.stringify({
          id: mevcut?.id,
          ad: form.ad.trim(),
          marka: form.marka.trim() || null,
          kategori_id: form.kategoriId || null,
          birim_tipi: form.birimTipi,
          alis_fiyati: paraParse(form.alis) ?? 0,
          satis_fiyati: satisKurus,
          kdv_orani: form.kdv,
          kritik_stok: miktarKurus(form.kritikStok),
          ideal_stok: miktarKurus(form.idealStok),
          raf_konumu: form.rafKonumu.trim() || null,
          skt_takibi: form.sktTakibi,
          notlar: form.notlar.trim() || null,
          aktif_mi: form.aktif,
        }),
      });
      // Stok, ürün kaydının bir alanı DEĞİLDİR: kasaya ayrı bir talimat olarak
      // iner ve hareketi kasa üretir. Fark sıfırsa talimat yazılmaz.
      if (stokFarki !== 0) {
        if (!hedefKasa) {
          // Kasa yoksa stok yazılacak yer de yoktur; kullanıcıya doğru adımı söyle.
          setHata(
            kasalar.length === 0
              ? 'Stok girebilmek için önce bir kasa aktive edilmiş olmalı (Kasa → Ayarlar → Senkron).'
              : 'Stok girmek için hedef kasa seçin.',
          );
          setGonderiliyor(false);
          return;
        }
        await api(uclar.stokDuzeltmeleri, {
          method: 'POST',
          body: JSON.stringify({
            urun_id: kayit.id,
            tip: yeniMi ? 'ACILIS' : 'DUZELTME',
            // Farkı BURADA hesaplamıyoruz: buradaki rakam senkron beklerken
            // bayatlayabiliyor ve fark yanlış tabana oturuyordu ("50 yazdım,
            // 80 oldu"). Hedefi gönderiyoruz, farkı kasa kendi güncel stoğuna
            // göre hesaplıyor — sonuç her zaman yazdığın sayı olur (§11.5).
            hedef_miktar: hedefStok,
            neden: yeniMi ? 'Açılış stoğu (panel)' : 'Panelden stok düzeltmesi',
            hedef_cihaz_id: hedefKasa,
          }),
        });
      }
      onKaydedildi();
    } catch (h) {
      setHata(h instanceof Error ? h.message : 'Kaydedilemedi.');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Modal
      baslik={yeniMi ? 'Yeni Ürün' : 'Ürün Düzenle'}
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil flex-1" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil flex-1" onClick={kaydet} disabled={gonderiliyor}>
            {gonderiliyor ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="etiket">Ürün adı *</span>
          <input className="alan" value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} autoFocus />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="etiket">Marka</span>
            <input className="alan" value={form.marka} onChange={(e) => setForm({ ...form, marka: e.target.value })} />
          </label>
          <label className="block">
            <span className="etiket">Kategori</span>
            <select className="alan" value={form.kategoriId} onChange={(e) => setForm({ ...form, kategoriId: e.target.value })}>
              <option value="">Kategorisiz</option>
              {kategoriler.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.ad}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="etiket">Birim tipi</span>
          <select className="alan" value={form.birimTipi} onChange={(e) => setForm({ ...form, birimTipi: e.target.value })}>
            <option value="ADET">Adet</option>
            <option value="KG">Kilogram</option>
            <option value="LT">Litre</option>
          </select>
          <span className="mt-1 block text-xs text-metin-4">
            KG/LT seçilirse kasada miktar elle girilir (terazi entegrasyonu yoktur).
          </span>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="etiket">Alış (KDV hariç)</span>
            <input
              className="alan sayi"
              inputMode="decimal"
              value={form.alis}
              onChange={(e) => setForm({ ...form, alis: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="etiket">Satış (KDV dahil) *</span>
            <input
              className="alan sayi"
              inputMode="decimal"
              value={form.satis}
              onChange={(e) => setForm({ ...form, satis: e.target.value })}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="etiket">KDV oranı</span>
            <select className="alan" value={form.kdv} onChange={(e) => setForm({ ...form, kdv: Number(e.target.value) })}>
              {KDV_ORANLARI.map((o) => (
                <option key={o} value={o}>
                  %{o}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="etiket">Raf konumu</span>
            <input className="alan" value={form.rafKonumu} onChange={(e) => setForm({ ...form, rafKonumu: e.target.value })} />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="etiket">Kritik stok</span>
            <input
              className="alan sayi"
              inputMode="decimal"
              value={form.kritikStok}
              onChange={(e) => setForm({ ...form, kritikStok: e.target.value })}
            />
            <span className="mt-1 block text-xs text-metin-4">Bu seviyenin altında uyarı verilir.</span>
          </label>
          <label className="block">
            <span className="etiket">Stok miktarı</span>
            <div className="flex items-center gap-2">
              <input
                className="alan sayi"
                inputMode="decimal"
                placeholder="0"
                value={form.stok}
                onChange={(e) => setForm({ ...form, stok: e.target.value })}
              />
              <span className="shrink-0 text-sm font-medium text-metin-2">{birimEtiketi}</span>
            </div>
            <span className="mt-1 block text-xs text-metin-4">
              {yeniMi
                ? 'Gelen miktarı yazın. Kasaya senkronla iner.'
                : `Şu anki: ${miktarFormat(mevcutStok)} ${birimEtiketi}. Yeni sayımı yazın.`}
            </span>
            {bekleyenTalimat > 0 && (
              <span className="mt-1 block text-xs text-uyari">
                Bu üründe kasada uygulanmayı bekleyen bir stok girişi var. Yeni değer onun yerine geçer; rakam kasa senkron olunca
                güncellenir.
              </span>
            )}
          </label>
        </div>

        {/* Birden çok kasa varsa hangisine işleneceği sorulur. Tek kasada
            sorulmaz: seçenek olmayan bir soru kasiyere yük olur. Stok tek bir
            kasaya yazılmalıdır, yoksa bulutta çift sayılır (§11.5). */}
        {stokFarki !== 0 && kasalar.length > 1 && (
          <label className="block">
            <span className="etiket">Hangi kasaya?</span>
            <select className="alan" value={hedefKasa} onChange={(e) => setHedefKasa(e.target.value)}>
              <option value="">Seçin…</option>
              {kasalar.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.cihaz_adi}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="etiket">Notlar</span>
          <textarea
            className="alan min-h-[72px]"
            placeholder="Tedarikçi, ambalaj, özel uyarı…"
            value={form.notlar}
            onChange={(e) => setForm({ ...form, notlar: e.target.value })}
          />
          <span className="mt-1 block text-xs text-metin-4">Kasadaki ürün kartında da görünür.</span>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.sktTakibi} onChange={(e) => setForm({ ...form, sktTakibi: e.target.checked })} />
          Son kullanma tarihi takibi yapılsın
        </label>
        {form.sktTakibi && (
          <p className="rounded-lg border border-bilgi-cizgi bg-bilgi-yumusak p-3 text-xs text-metin-2">
            Kasada mal kabul sırasında bu ürün için SKT girilmeden fatura onaylanamaz; tarihi yaklaşan partiler stok ekranında
            listelenir.
          </p>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.aktif} onChange={(e) => setForm({ ...form, aktif: e.target.checked })} />
          Ürün satışa açık
        </label>

        {hata && <p className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm text-metin">{hata}</p>}

        <p className="text-xs text-metin-4">
          Barkod ekleme/kaldırma kasadan yapılır: barkod okuyucu orada olduğu için yanlış yazım riski en aza iner.
        </p>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Kategori yönetimi
// ---------------------------------------------------------------------------

/** Kategori silinmez, pasifleştirilir: silinseydi geçmiş raporların bağı kopardı. */
function KategoriFormu({
  kategoriler,
  onKapat,
  onDegisti,
}: {
  kategoriler: Kategori[];
  onKapat: () => void;
  onDegisti: () => void;
}) {
  const [yeniAd, setYeniAd] = useState('');
  const [duzenlenenId, setDuzenlenenId] = useState<string | null>(null);
  const [duzenlenenAd, setDuzenlenenAd] = useState('');
  const [calisiyor, setCalisiyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const kaydet = async (girdi: { id?: string; ad: string; sira?: number; aktif_mi?: boolean }) => {
    if (!girdi.ad.trim()) return;
    setCalisiyor(true);
    setHata(null);
    try {
      await api(uclar.kategoriler, {
        method: 'POST',
        body: JSON.stringify({
          id: girdi.id,
          ad: girdi.ad.trim(),
          sira: girdi.sira ?? 0,
          aktif_mi: girdi.aktif_mi ?? true,
        }),
      });
      setYeniAd('');
      setDuzenlenenId(null);
      onDegisti();
    } catch (h) {
      setHata(h instanceof Error ? h.message : 'Kaydedilemedi.');
    } finally {
      setCalisiyor(false);
    }
  };

  const sil = async (k: Kategori) => {
    const onay = window.confirm(
      `"${k.ad}" kategorisi silinsin mi?\n\nİçinde ürün ya da alt kategori varsa silinemez — bunun yerine listeden gizlenir.`,
    );
    if (!onay) return;
    setCalisiyor(true);
    setHata(null);
    try {
      const sonuc = await api<{ silindi: boolean; urunSayisi: number; altKategoriSayisi: number; ad: string }>(
        `${uclar.kategoriler}/${k.id}`,
        { method: 'DELETE' },
      );
      if (!sonuc.silindi) {
        const parcalar = [
          sonuc.urunSayisi > 0 ? `${sonuc.urunSayisi} ürün` : null,
          sonuc.altKategoriSayisi > 0 ? `${sonuc.altKategoriSayisi} alt kategori` : null,
        ].filter(Boolean);
        window.alert(`${sonuc.ad} silinemedi: içinde ${parcalar.join(' ve ')} var. Listeden gizlendi.`);
      }
      onDegisti();
    } catch (h) {
      setHata(h instanceof Error ? h.message : 'Silinemedi.');
    } finally {
      setCalisiyor(false);
    }
  };

  return (
    <Modal
      baslik="Kategoriler"
      onKapat={onKapat}
      altBilgi={
        <button type="button" className="tus-ikincil ml-auto" onClick={onKapat}>
          Kapat
        </button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-metin-3">
          Ürünleri gruplamak için kullanılır. Kategori adı fişte görünmez; raporlarda ve toplu zamda filtre olarak çalışır.
        </p>

        <div className="flex gap-2">
          <input
            className="alan flex-1"
            placeholder="Yeni kategori adı…"
            value={yeniAd}
            onChange={(e) => setYeniAd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void kaydet({ ad: yeniAd });
              }
            }}
          />
          <button
            type="button"
            className="tus-birincil"
            onClick={() => kaydet({ ad: yeniAd })}
            disabled={calisiyor || !yeniAd.trim()}
          >
            Ekle
          </button>
        </div>

        {hata && <p className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm text-metin">{hata}</p>}

        {kategoriler.length === 0 ? (
          <BosDurum baslik="Henüz kategori yok" aciklama="Yukarıdan ekleyebilirsiniz." />
        ) : (
          <ul className="divide-y divide-cizgi-ince rounded-lg border border-cizgi">
            {kategoriler.map((k) => (
              <li key={k.id} className="flex items-center gap-2 px-3 py-2">
                {duzenlenenId === k.id ? (
                  <>
                    <input
                      className="alan flex-1 py-1"
                      value={duzenlenenAd}
                      onChange={(e) => setDuzenlenenAd(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void kaydet({ id: k.id, ad: duzenlenenAd, sira: k.sira });
                        }
                        if (e.key === 'Escape') setDuzenlenenId(null);
                      }}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="tus-birincil px-3 py-1 text-sm"
                      onClick={() => kaydet({ id: k.id, ad: duzenlenenAd, sira: k.sira })}
                    >
                      Kaydet
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1">{k.ad}</span>
                    <button
                      type="button"
                      className="text-sm text-vurgu hover:underline"
                      onClick={() => {
                        setDuzenlenenId(k.id);
                        setDuzenlenenAd(k.ad);
                      }}
                    >
                      Adlandır
                    </button>
                    <button type="button" className="text-sm text-tehlike hover:underline" onClick={() => void sil(k)}>
                      Sil
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Toplu fiyat
// ---------------------------------------------------------------------------

function TopluZamFormu({
  kategoriler,
  onKapat,
  onUygulandi,
}: {
  kategoriler: Kategori[];
  onKapat: () => void;
  onUygulandi: () => void;
}) {
  const [yuzde, setYuzde] = useState('10');
  const [hedef, setHedef] = useState<'SATIS' | 'ALIS'>('SATIS');
  const [kapsam, setKapsam] = useState<'tumu' | 'kategori'>('tumu');
  const [kategoriId, setKategoriId] = useState('');
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [sonuc, setSonuc] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  const uygula = async () => {
    const deger = Number(yuzde.replace(',', '.'));
    if (!Number.isFinite(deger)) {
      setHata('Geçerli bir yüzde girin.');
      return;
    }
    if (kapsam === 'kategori' && !kategoriId) {
      setHata('Kategori seçin.');
      return;
    }
    const hedefAdi = hedef === 'ALIS' ? 'ALIŞ (maliyet)' : 'SATIŞ';
    const kapsamAdi =
      kapsam === 'kategori' ? `"${kategoriler.find((k) => k.id === kategoriId)?.ad}" kategorisindeki` : 'tüm aktif';
    if (!window.confirm(`${kapsamAdi} ürünlerin ${hedefAdi} fiyatına %${deger} uygulanacak. Onaylıyor musunuz?`)) return;

    setGonderiliyor(true);
    setHata(null);
    try {
      const yanit = await api<{ etkilenen: number }>(`${uclar.urunler}/toplu-fiyat`, {
        method: 'POST',
        body: JSON.stringify({
          yuzde: deger,
          hedef,
          ...(kapsam === 'kategori' ? { kategori_id: kategoriId } : {}),
        }),
      });
      setSonuc(`${yanit.etkilenen} ürün güncellendi.`);
      setTimeout(onUygulandi, 900);
    } catch (h) {
      setHata(h instanceof Error ? h.message : 'Uygulanamadı.');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Modal
      baslik="Toplu Fiyat Değişikliği"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil flex-1" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil flex-1" onClick={uygula} disabled={gonderiliyor}>
            {gonderiliyor ? 'Uygulanıyor…' : 'Uygula'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <span className="etiket">Hangi ürünlere?</span>
          <div className="grid grid-cols-2 gap-2">
            {[
              { deger: 'tumu' as const, etiket: 'Tüm ürünler', alt: 'aktif olanlar' },
              { deger: 'kategori' as const, etiket: 'Kategori', alt: 'tek kategori' },
            ].map((s) => (
              <button
                key={s.deger}
                type="button"
                className={`${kapsam === s.deger ? 'tus-birincil' : 'tus-ikincil'} flex-col py-2`}
                onClick={() => setKapsam(s.deger)}
              >
                <span className="text-sm">{s.etiket}</span>
                <span className="text-xs opacity-70">{s.alt}</span>
              </button>
            ))}
          </div>
        </div>

        {kapsam === 'kategori' && (
          <label className="block">
            <span className="etiket">Kategori</span>
            <select className="alan" value={kategoriId} onChange={(e) => setKategoriId(e.target.value)}>
              <option value="">Kategori seçin…</option>
              {kategoriler.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.ad}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* Kasadaki toplu fiyat işlemiyle aynı ayrım: satış ve alış ayrı ayrı. */}
        <div>
          <span className="etiket">Hangi fiyata?</span>
          <div className="grid grid-cols-2 gap-2">
            {[
              { deger: 'SATIS' as const, etiket: 'Satış fiyatı', alt: 'raf fiyatı' },
              { deger: 'ALIS' as const, etiket: 'Alış fiyatı', alt: 'maliyet' },
            ].map((s) => (
              <button
                key={s.deger}
                type="button"
                className={`${hedef === s.deger ? 'tus-birincil' : 'tus-ikincil'} flex-col py-2`}
                onClick={() => setHedef(s.deger)}
              >
                <span className="text-sm">{s.etiket}</span>
                <span className="text-xs opacity-70">{s.alt}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="etiket">Yüzde değişim</span>
          <input className="alan sayi" inputMode="decimal" value={yuzde} onChange={(e) => setYuzde(e.target.value)} />
          <span className="mt-1 block text-xs text-metin-4">Zam için pozitif, indirim için negatif değer girin.</span>
        </label>

        {hedef === 'SATIS' ? (
          <p className="rounded-lg border border-uyari-cizgi bg-uyari-yumusak p-3 text-xs text-metin-2">
            Raf etiketleri ile kasa fiyatının tutarlı olması tüketici mevzuatı gereğidir. Toplu zam sonrası etiketleri
            güncellemeyi unutmayın.
          </p>
        ) : (
          <p className="rounded-lg border border-cizgi bg-yuzey-2 p-3 text-xs text-metin-2">
            Yalnız alış (maliyet) fiyatları değişir; raf/satış fiyatına dokunulmaz. Kâr marjı raporları yeni maliyete göre
            hesaplanır.
          </p>
        )}

        {sonuc && <p className="rounded-lg border border-vurgu bg-vurgu-yumusak px-3 py-2 text-sm text-vurgu">{sonuc}</p>}
        {hata && <p className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm text-metin">{hata}</p>}
      </div>
    </Modal>
  );
}
