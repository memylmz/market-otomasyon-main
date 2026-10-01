/**
 * Ürün formu (§11.4) — panelde Ürünler sayfası ve alış faturası ortak kullanır.
 *
 * Alış faturasında satırdaki ürüne tıklanınca AYNI form açılır: kullanıcı
 * ürünü iki farklı formda iki farklı alan setiyle tanımlamasın diye tek yerde
 * durur (kasadaki UrunKartiDiyalogu ile aynı ilke).
 */

'use client';

import { useEffect, useState } from 'react';
import { KDV_ORANLARI, miktarFormat, paraFormat, paraParse, type Kurus } from '@market/shared';
import { Modal } from './kabuk';
import { api, uclar } from '@/lib/api';

export interface Urun {
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
  /** Kısa kod (PLU) — barkodsuz üründe kasiyerin yazdığı numara. */
  kisa_kod?: string | null;
  stok: number;
  aktif_mi: number;
}

export interface Kategori {
  id: string;
  ad: string;
  sira: number;
  aktif_mi: number;
}

/** Miktarlar veritabanında bindebir tam sayıdır; "1,5" → 1500. */
function miktarKurusHesapla(metin: string): number {
  const sayi = Number(String(metin).replace(',', '.'));
  return Number.isFinite(sayi) ? Math.round(sayi * 1000) : 0;
}

export function UrunFormu({
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
    kisaKod: mevcut?.kisa_kod ?? '',
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
          kisa_kod: form.kisaKod.trim(),
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

        {/*
          Kısa kod (PLU) panelden yönetilir çünkü ELLE yazılır, okutulmaz.
          Barkod ekleme kasada kalır: okuyucu orada olduğu için yanlış yazım
          riski en aza iner.
        */}
        <label className="block">
          <span className="etiket">Kısa kod (PLU)</span>
          <input
            className="alan sayi w-32"
            inputMode="numeric"
            placeholder="örn. 24"
            value={form.kisaKod}
            onChange={(e) => setForm({ ...form, kisaKod: e.target.value.replace(/\D/g, '').slice(0, 5) })}
          />
          <span className="mt-1 block text-xs text-metin-4">
            Barkodsuz ürünlerde kasiyer bu kodu yazıp Enter'lar; aramaya gerek kalmaz. 2-5 rakam, boş bırakılırsa kaldırılır.
          </span>
        </label>

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
