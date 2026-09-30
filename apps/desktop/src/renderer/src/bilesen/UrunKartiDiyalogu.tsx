/**
 * Ürün kartı formu (§10.5) — Ürünler ekranı ve mal kabul ortak kullanır.
 *
 * Mal kabulde satırdaki ürüne tıklanınca AYNI form açılır: kullanıcı ürünü
 * iki farklı formda iki farklı alan setiyle tanımlamasın diye tek yerde durur.
 */

import { useEffect, useState } from 'react';
import { KDV_ORANLARI, kisaKodBul, kisaKodMu, miktarParse, type BirimTipi, type Kurus, type Miktar } from '@market/shared';
import { Alan, Diyalog, ParaAlani } from './temel';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { useYetki } from '../durum/oturum';
import { cagir } from '../kopru';

export interface UrunSatiri {
  id: string;
  ad: string;
  marka: string | null;
  birim_tipi: BirimTipi;
  alis_fiyati: Kurus;
  satis_fiyati: Kurus;
  kdv_orani: number;
  kritik_stok: Miktar;
  ideal_stok: Miktar;
  raf_konumu: string | null;
  aktif_mi: boolean;
  stok: Miktar;
  kategori_adi: string | null;
  kategori_id: string | null;
  barkodlar: string[];
  notlar: string | null;
  skt_takibi: boolean;
}

interface Kategori {
  id: string;
  ad: string;
}

/**
 * Henüz kaydedilmemiş ürünün form değerleri — mal kabul satırında taşınır.
 * Ürün fatura kaydedilince, belgeyle aynı transaction'da açılır; formdan
 * doğrudan kataloğa yazılsaydı vazgeçilen faturadan sahipsiz ürün kalırdı.
 */
export interface UrunKartiTaslagi {
  ad: string;
  /** Kısa kod HARİÇ barkodlar; ilki satırın barkodu olur. */
  barkodlar: string[];
  kisaKod: string;
  marka: string;
  kategoriId: string;
  birimTipi: BirimTipi;
  alisFiyati: Kurus;
  satisFiyati: Kurus;
  kdvOrani: number;
  kritikStok: string;
  rafKonumu: string;
  sktTakibi: boolean;
  notlar: string;
}

export function UrunKartiDiyalogu({
  urun,
  kategoriler,
  onKapat,
  onKaydedildi,
  taslak,
  stokGizli = false,
}: {
  urun: UrunSatiri | 'yeni' | null;
  kategoriler: Kategori[];
  onKapat: () => void;
  onKaydedildi: () => void;
  /**
   * Verilirse form KATALOĞA YAZMAZ: "Uygula" değerleri çağırana döndürür.
   * `baslangic` çağıranda sabit tutulmalıdır (state); her çizimde yeni nesne
   * gelirse form kullanıcının yazdıklarını sıfırlar.
   */
  taslak?: { baslangic: UrunKartiTaslagi; onUygula: (deger: UrunKartiTaslagi) => void };
  /**
   * Stok alanı gizlenir. Mal kabulden açılan kartta stok FATURADAN gelir;
   * karttan da girilirse maliyetsiz bir düzeltme hareketi olarak ikinci kez
   * sayılırdı.
   */
  stokGizli?: boolean;
}) {
  const yeniMi = urun === 'yeni';
  const taslakBaslangic = taslak?.baslangic;
  const mevcut = yeniMi ? null : urun;
  /*
   * Mevcut üründe stok değiştirmek DÜZELTME hareketi üretir ve ayrı bir yetki
   * ister. Yetkisi yoksa alan salt okunur gelir; kaydettikten sonra hata
   * almaktansa baştan görmek daha iyidir.
   */
  const stokDegistirebilir = useYetki('stok.duzeltme');
  const stokKilitli = !yeniMi && !stokDegistirebilir;
  const [form, setForm] = useState({
    ad: '',
    marka: '',
    kategoriId: '',
    birimTipi: 'ADET' as BirimTipi,
    alisFiyati: 0 as Kurus,
    satisFiyati: 0 as Kurus,
    kdvOrani: 20,
    kritikStok: '',
    rafKonumu: '',
    barkod: '',
    /** Yeni üründe açılış stoğu, mevcutta hedef stok. */
    stok: '',
    sktTakibi: false,
    notlar: '',
  });
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [barkodlar, setBarkodlar] = useState<string[]>([]);
  /*
   * Etiket adedi kendi diyaloğundan sorulur, `window.prompt` ile DEĞİL.
   *
   * Electron `prompt()`'u desteklemez: çağrı "prompt() is not supported."
   * diye istisna fırlatır. Eskiden adet bununla soruluyordu ve istisna
   * try bloğunun dışında kaldığı için düğme sessizce ölüyordu — ne etiket
   * çıkıyor ne ekranda bir şey görünüyordu.
   */
  const [etiketAdediAcik, setEtiketAdediAcik] = useState(false);
  const [etiketAdedi, setEtiketAdedi] = useState('1');
  const [etiketBasiliyor, setEtiketBasiliyor] = useState(false);
  /** Kısa kod ayrı tutulur; kaydederken barkod listesine katılır. */
  const [kisaKod, setKisaKod] = useState('');

  useEffect(() => {
    if (!urun) return;
    if (mevcut) {
      setForm({
        ad: mevcut.ad,
        marka: mevcut.marka ?? '',
        kategoriId: mevcut.kategori_id ?? '',
        birimTipi: mevcut.birim_tipi,
        alisFiyati: mevcut.alis_fiyati,
        satisFiyati: mevcut.satis_fiyati,
        kdvOrani: mevcut.kdv_orani,
        kritikStok: mevcut.kritik_stok ? String(mevcut.kritik_stok / 1000) : '',
        rafKonumu: mevcut.raf_konumu ?? '',
        barkod: '',
        stok: String(mevcut.stok / 1000),
        sktTakibi: mevcut.skt_takibi,
        notlar: mevcut.notlar ?? '',
      });
      // Kısa kod listeden AYRILIR: kendi alanında düzenlenir, kaydederken geri katılır.
      setBarkodlar(mevcut.barkodlar.filter((b) => !kisaKodMu(b)));
      setKisaKod(kisaKodBul(mevcut.barkodlar) ?? '');
    } else if (taslakBaslangic) {
      const t = taslakBaslangic;
      setForm({
        ad: t.ad,
        marka: t.marka,
        kategoriId: t.kategoriId,
        birimTipi: t.birimTipi,
        alisFiyati: t.alisFiyati,
        satisFiyati: t.satisFiyati,
        kdvOrani: t.kdvOrani,
        kritikStok: t.kritikStok,
        rafKonumu: t.rafKonumu,
        barkod: '',
        stok: '',
        sktTakibi: t.sktTakibi,
        notlar: t.notlar,
      });
      setBarkodlar(t.barkodlar);
      setKisaKod(t.kisaKod);
    } else {
      setForm({
        ad: '',
        marka: '',
        kategoriId: '',
        birimTipi: 'ADET',
        alisFiyati: 0,
        satisFiyati: 0,
        kdvOrani: 20,
        kritikStok: '',
        rafKonumu: '',
        barkod: '',
        stok: '',
        sktTakibi: false,
        notlar: '',
      });
      setBarkodlar([]);
      setKisaKod('');
    }
  }, [urun, mevcut, taslakBaslangic]);

  if (!urun) return null;

  const kaydet = async () => {
    if (!form.ad.trim()) {
      bildir.uyari('Ürün adı zorunludur');
      return;
    }
    if (taslak) {
      // Okutulup Enter'lanmamış barkod da kaybolmasın.
      const sonBarkod = form.barkod.trim();
      taslak.onUygula({
        ad: form.ad.trim(),
        barkodlar: sonBarkod && !barkodlar.includes(sonBarkod) ? [...barkodlar, sonBarkod] : barkodlar,
        kisaKod: kisaKod.trim(),
        marka: form.marka,
        kategoriId: form.kategoriId,
        birimTipi: form.birimTipi,
        alisFiyati: form.alisFiyati,
        satisFiyati: form.satisFiyati,
        kdvOrani: form.kdvOrani,
        kritikStok: form.kritikStok,
        rafKonumu: form.rafKonumu,
        sktTakibi: form.sktTakibi,
        notlar: form.notlar,
      });
      return;
    }
    setGonderiliyor(true);
    try {
      /*
       * Kısa kod listeye burada katılır: depoda ayrı bir alan değil, kısa bir
       * barkod satırıdır. Böylece okutma, arama ve satış yolu hiç değişmez.
       */
      const yeniBarkodlar = [
        ...barkodlar,
        ...(form.barkod.trim() ? [form.barkod.trim()] : []),
        ...(kisaKod.trim() ? [kisaKod.trim()] : []),
      ];
      await cagir('urun.kaydet', {
        id: mevcut?.id,
        ad: form.ad.trim(),
        marka: form.marka.trim() || null,
        kategori_id: form.kategoriId || null,
        birim_tipi: form.birimTipi,
        alis_fiyati: form.alisFiyati,
        satis_fiyati: form.satisFiyati,
        kdv_orani: form.kdvOrani,
        kritik_stok: miktarParse(form.kritikStok) ?? 0,
        // İdeal stok artık formda yok; mevcut değeri korunur (sipariş önerisi kullanır).
        ideal_stok: mevcut?.ideal_stok ?? 0,
        raf_konumu: form.rafKonumu.trim() || null,
        skt_takibi: form.sktTakibi,
        notlar: form.notlar.trim() || null,
        barkodlar: yeniBarkodlar.map((b) => ({ barkod: b })),
        acilis_stogu: yeniMi ? (miktarParse(form.stok) ?? undefined) : undefined,
      });

      /*
       * MEVCUT üründe stok değiştiyse düzeltme hareketi yazılır.
       *
       * Ürün kartı stoğu doğrudan YAZAMAZ: stok hareketlerden türer ve
       * append-only defterdir. Kasiyerin yazdığı sayı bir HEDEFTİR; farkı
       * servis kendi güncel stoğuna göre hesaplar, böylece sonuç her zaman
       * yazdığın sayı olur.
       */
      if (!yeniMi && mevcut && stokDegistirebilir) {
        const hedef = miktarParse(form.stok);
        if (hedef !== null && hedef !== mevcut.stok) {
          await cagir('stok.duzeltme', {
            urunId: mevcut.id,
            yeniMiktar: hedef,
            neden: 'Ürün kartından stok düzeltmesi',
          });
        }
      }

      bildir.basari(yeniMi ? 'Ürün eklendi' : 'Ürün güncellendi');
      onKaydedildi();
    } catch (hata) {
      hatayiBildir(hata, 'Ürün kaydı');
    } finally {
      setGonderiliyor(false);
    }
  };

  const etiketiYazdir = async () => {
    if (!mevcut) return;
    const adet = Math.max(1, Math.min(100, Number(etiketAdedi.replace(',', '.')) || 1));
    setEtiketBasiliyor(true);
    try {
      const sonuc = await cagir<{ basarili: boolean; hata?: string }>('urun.etiketYazdir', { urunId: mevcut.id, adet });
      if (sonuc.basarili) {
        bildir.basari(`${adet} etiket yazdırıldı`);
        setEtiketAdediAcik(false);
      } else {
        // Diyalog AÇIK kalır: yazıcı sorunu düzeltilip tekrar denenebilsin.
        bildir.uyari('Etiket yazdırılamadı', sonuc.hata);
      }
    } catch (hata) {
      hatayiBildir(hata, 'Etiket yazdırma');
    } finally {
      setEtiketBasiliyor(false);
    }
  };

  const icBarkodUret = async () => {
    if (!mevcut) return;
    try {
      const { barkod } = await cagir<{ barkod: string }>('urun.icBarkod', { urunId: mevcut.id });
      setBarkodlar((b) => [...b, barkod]);
      bildir.basari('İç barkod üretildi', barkod);
    } catch (hata) {
      hatayiBildir(hata, 'İç barkod');
    }
  };

  return (
    <Diyalog
      acik
      baslik={yeniMi ? 'Yeni Ürün' : 'Ürün Kartı'}
      aciklama={taslak ? 'Ürün, alış faturası kaydedilince bu bilgilerle açılır.' : undefined}
      genislik="genis"
      onKapat={onKapat}
      altBilgi={
        <>
          {mevcut && (
            <button
              type="button"
              className="tus-ikincil mr-auto"
              onClick={async () => {
                try {
                  await cagir('urun.pasiflestir', { urunId: mevcut.id, pasif: mevcut.aktif_mi });
                  bildir.basari(mevcut.aktif_mi ? 'Ürün pasifleştirildi' : 'Ürün aktifleştirildi');
                  onKaydedildi();
                } catch (hata) {
                  hatayiBildir(hata);
                }
              }}
            >
              {mevcut.aktif_mi ? 'Pasifleştir' : 'Aktifleştir'}
            </button>
          )}
          {mevcut && (
            <button
              type="button"
              className="tus-ikincil"
              title="Ürünün raf etiketini yazdırır (ad, fiyat, barkod)"
              onClick={() => {
                setEtiketAdedi('1');
                setEtiketAdediAcik(true);
              }}
            >
              Etiket Yazdır
            </button>
          )}
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={kaydet} disabled={gonderiliyor}>
            {taslak ? 'Uygula' : 'Kaydet'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        {/* Barkod en üstte: yeni ürün girerken ilk yapılan iş ürünü okutmaktır. */}
        <div className="md:col-span-2">
          <span className="etiket">Barkod{yeniMi ? '' : 'lar'}</span>
          {barkodlar.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-2">
              {barkodlar.map((b) => (
                <li key={b} className="flex items-center gap-2 rounded border border-cizgi-kuvvetli bg-yuzey-2 px-2 py-1 text-sm">
                  <span className="font-mono">{b}</span>
                  <button
                    type="button"
                    className="text-tehlike"
                    onClick={async () => {
                      // Kaydedilmemiş üründe barkod henüz yalnız bu listededir.
                      if (!mevcut) {
                        setBarkodlar((liste) => liste.filter((x) => x !== b));
                        return;
                      }
                      try {
                        await cagir('urun.barkodKaldir', { barkod: b });
                        setBarkodlar((liste) => liste.filter((x) => x !== b));
                      } catch (hata) {
                        hatayiBildir(hata);
                      }
                    }}
                    aria-label={`${b} barkodunu kaldır`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              className="alan flex-1 font-mono"
              placeholder="Barkodu okutun veya yazıp Enter'a basın…"
              value={form.barkod}
              onChange={(e) => setForm({ ...form, barkod: e.target.value })}
              data-odak={yeniMi ? true : undefined}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && form.barkod.trim()) {
                  e.preventDefault();
                  setBarkodlar((b) => [...b, form.barkod.trim()]);
                  setForm({ ...form, barkod: '' });
                }
              }}
            />
            {mevcut && (
              <button type="button" className="tus-ikincil" onClick={icBarkodUret}>
                İç Barkod Üret
              </button>
            )}
          </div>
          <span className="mt-1 block text-xs text-metin-4">
            Bir ürünün birden çok barkodu olabilir (farklı ambalaj). Barkodu olmayan ürün için
            {mevcut ? ' "İç Barkod Üret" ile' : ' kaydettikten sonra'} mağaza içi barkod oluşturabilirsiniz.
          </span>
        </div>

        {/*
          KISA KOD (§10.1) — barkodsuz ürünler için asıl hız kazancı.
          Manav, şarküteri, ekmek gibi ürünlerde kasiyer ad yazıp listeden
          seçmek zorunda kalıyor; sıradaki müşteriyi bekleten en pahalı adım bu.
          Kısa kod ayrı bir alan değil, KISA BİR BARKODTUR: satış tarafında
          hiçbir şey değişmez, kasiyer kodu yazıp Enter'lar.
        */}
        <div className="md:col-span-2">
          <span className="etiket">Kısa kod (PLU)</span>
          <div className="flex gap-2">
            <input
              className="alan sayi w-32 font-mono"
              inputMode="numeric"
              placeholder="örn. 24"
              value={kisaKod}
              onChange={(e) => setKisaKod(e.target.value.replace(/\D/g, '').slice(0, 5))}
            />
            <button
              type="button"
              className="tus-ikincil"
              onClick={async () => {
                try {
                  const { kod } = await cagir<{ kod: string }>('urun.kisaKodOner');
                  setKisaKod(kod);
                } catch (hata) {
                  hatayiBildir(hata, 'Kısa kod');
                }
              }}
            >
              Sıradaki Boş Kodu Ver
            </button>
          </div>
          <span className="mt-1 block text-xs text-metin-4">
            Kasiyer satış ekranında bu kodu yazıp <strong>Enter</strong>'a basınca ürün sepete girer — aramaya gerek kalmaz. Hızlı
            ürün karesinde de görünür. 2-5 hane; boş bırakılırsa kod atanmaz.
          </span>
        </div>

        <Alan etiket="Ürün adı *">
          <input
            className="alan"
            value={form.ad}
            onChange={(e) => setForm({ ...form, ad: e.target.value })}
            data-odak={yeniMi ? undefined : true}
          />
        </Alan>
        <Alan etiket="Marka">
          <input className="alan" value={form.marka} onChange={(e) => setForm({ ...form, marka: e.target.value })} />
        </Alan>
        <Alan etiket="Kategori">
          <select className="alan" value={form.kategoriId} onChange={(e) => setForm({ ...form, kategoriId: e.target.value })}>
            <option value="">Kategorisiz</option>
            {kategoriler.map((k) => (
              <option key={k.id} value={k.id}>
                {k.ad}
              </option>
            ))}
          </select>
        </Alan>
        <Alan etiket="Birim tipi" ipucu="KG/LT seçilirse satışta miktar elle girilir (terazi entegrasyonu yoktur).">
          <select
            className="alan"
            value={form.birimTipi}
            onChange={(e) => setForm({ ...form, birimTipi: e.target.value as BirimTipi })}
          >
            <option value="ADET">Adet</option>
            <option value="KG">Kilogram</option>
            <option value="LT">Litre</option>
          </select>
        </Alan>

        <Alan etiket="Alış fiyatı (KDV hariç)" ipucu="Kâr hesabı bu tutara göre yapılır.">
          <ParaAlani deger={form.alisFiyati} onDegisim={(v) => setForm({ ...form, alisFiyati: v })} />
        </Alan>
        <Alan etiket="Satış fiyatı (KDV dahil) *" ipucu="Raf etiketiyle aynı olmalıdır.">
          <ParaAlani deger={form.satisFiyati} onDegisim={(v) => setForm({ ...form, satisFiyati: v })} />
        </Alan>

        <Alan etiket="KDV oranı">
          <select className="alan" value={form.kdvOrani} onChange={(e) => setForm({ ...form, kdvOrani: Number(e.target.value) })}>
            {KDV_ORANLARI.map((o) => (
              <option key={o} value={o}>
                %{o}
              </option>
            ))}
          </select>
        </Alan>
        <Alan etiket="Raf konumu">
          <input className="alan" value={form.rafKonumu} onChange={(e) => setForm({ ...form, rafKonumu: e.target.value })} />
        </Alan>

        <Alan etiket="Kritik stok" ipucu="Bu seviyenin altına düşünce uyarı verilir.">
          <input
            className="alan sayi"
            value={form.kritikStok}
            onChange={(e) => setForm({ ...form, kritikStok: e.target.value })}
          />
        </Alan>
        {/*
          STOK MİKTARI (§10.5) — paneldeki alanın kasa karşılığı, aynı ad ve
          aynı anlamla. Eskiden burada "İdeal stok" ve yalnız yeni üründe
          görünen "Açılış stoğu" vardı; kullanıcı üç stok alanı arasında
          gerçekten stok GİREN alanı bulamıyordu. Artık tek alan var:
          yeni üründe açılış stoğu, mevcut üründe sayım düzeltmesi.
        */}
        {/* Taslakta stok faturadan gelir; ayrı bir açılış stoğu çift sayım olurdu. */}
        {!taslak && !stokGizli && (
          <Alan
            etiket="Stok miktarı"
            ipucu={
              stokKilitli
                ? 'Stok düzeltme yetkiniz yok; değiştirmek için yöneticinize başvurun.'
                : yeniMi
                  ? 'Gelen miktarı yazın; açılış hareketi olarak kaydedilir.'
                  : 'Yazdığınız değer yeni stok olur; fark düzeltme hareketi olarak kaydedilir.'
            }
          >
            <div className="flex items-center gap-2">
              <input
                className="alan sayi"
                inputMode="decimal"
                placeholder="0"
                value={form.stok}
                disabled={stokKilitli}
                onChange={(e) => setForm({ ...form, stok: e.target.value })}
              />
              <span className="shrink-0 text-sm font-medium text-metin-2">
                {form.birimTipi === 'ADET' ? 'adet' : form.birimTipi.toLowerCase()}
              </span>
            </div>
          </Alan>
        )}

        <div className="md:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.sktTakibi} onChange={(e) => setForm({ ...form, sktTakibi: e.target.checked })} />
            Son kullanma tarihi takibi yapılsın
          </label>

          {/* İşaretlemenin ne yaptığı görünür olmalı; aksi hâlde kutu "hiçbir şey
              yapmıyor" gibi görünür. */}
          {form.sktTakibi ? (
            <div className="mt-2 rounded border border-bilgi-cizgi bg-bilgi-yumusak p-3 text-xs text-metin-2">
              <p className="font-medium">Bu ürün için SKT takibi açık:</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                <li>
                  <strong>Mal kabulde</strong> son kullanma tarihi zorunlu olur; girilmeden fatura onaylanamaz.
                </li>
                <li>
                  Lot bazında kalan miktar izlenir; <strong>Stok → SKT Takibi</strong> sekmesinde tarihi yaklaşan partiler
                  listelenir.
                </li>
                <li>Tarihi geçen partiler kırmızı görünür, fire çıkışında “SKT geçti” nedeni seçilebilir.</li>
              </ul>
            </div>
          ) : (
            <p className="mt-2 text-xs text-metin-4">
              Süt, et, şarküteri gibi tarihli ürünlerde açın. Kapalıyken mal kabulde SKT sorulmaz.
            </p>
          )}
        </div>

        <div className="md:col-span-2">
          <Alan etiket="Notlar">
            <textarea
              className="alan"
              rows={2}
              value={form.notlar}
              onChange={(e) => setForm({ ...form, notlar: e.target.value })}
            />
          </Alan>
        </div>
      </div>

      {/* Etiket adedi — Electron `prompt()` desteklemediği için kendi diyaloğumuz. */}
      <Diyalog
        acik={etiketAdediAcik}
        baslik="Etiket Yazdır"
        aciklama={mevcut ? `${mevcut.ad} için raf etiketi basılacak.` : undefined}
        genislik="dar"
        onKapat={() => setEtiketAdediAcik(false)}
        altBilgi={
          <>
            <button type="button" className="tus-ikincil" onClick={() => setEtiketAdediAcik(false)}>
              Vazgeç
            </button>
            <button type="button" className="tus-birincil" onClick={() => void etiketiYazdir()} disabled={etiketBasiliyor}>
              {etiketBasiliyor ? 'Yazdırılıyor…' : 'Yazdır'}
            </button>
          </>
        }
      >
        <Alan etiket="Kaç adet?" ipucu="En fazla 100 adet.">
          <input
            className="alan sayi"
            type="number"
            min={1}
            max={100}
            value={etiketAdedi}
            data-odak
            onChange={(e) => setEtiketAdedi(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !etiketBasiliyor) {
                e.preventDefault();
                void etiketiYazdir();
              }
            }}
          />
        </Alan>
      </Diyalog>
    </Diyalog>
  );
}
