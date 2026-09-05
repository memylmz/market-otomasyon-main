/**
 * Kampanya (indirim kuralı) yönetimi — panelde tanımlanan kurallar senkronla
 * kasalara iner ve satış anında otomatik uygulanır (§11.8).
 */

'use client';

import { useMemo, useState } from 'react';
import { paraFormat, paraParse, tarihFormat, type Kurus } from '@market/shared';
import { BosDurum, HataKutusu, Kabuk, Modal, Rozet, Yukleniyor } from '@/bilesen/kabuk';
import { api, uclar } from '@/lib/api';
import { useVeri } from '@/lib/kanca';

type KampanyaTipi = 'YUZDE' | 'TUTAR' | 'SABIT_FIYAT';
type KampanyaKapsami = 'URUN' | 'KATEGORI' | 'TUM';

interface Kampanya {
  id: string;
  ad: string;
  tip: KampanyaTipi;
  kapsam: KampanyaKapsami;
  hedef_id: string | null;
  /** YUZDE → yüzde (0-100), diğer tiplerde kuruş. */
  deger: number;
  baslangic: string;
  bitis: string;
  oncelik: number;
  aktif_mi: number;
}

interface Kategori {
  id: string;
  ad: string;
  aktif_mi: number;
}

interface Urun {
  id: string;
  ad: string;
  satis_fiyati: Kurus;
}

const TIP_SECENEKLERI: { deger: KampanyaTipi; etiket: string }[] = [
  { deger: 'YUZDE', etiket: 'Yüzde indirim' },
  { deger: 'TUTAR', etiket: 'Tutar indirimi' },
  { deger: 'SABIT_FIYAT', etiket: 'Sabit fiyat' },
];

const KAPSAM_SECENEKLERI: { deger: KampanyaKapsami; etiket: string }[] = [
  { deger: 'TUM', etiket: 'Tüm ürünler' },
  { deger: 'KATEGORI', etiket: 'Bir kategori' },
  { deger: 'URUN', etiket: 'Tek ürün' },
];

/** YUZDE dışındaki tipler kuruş taşır; girdi ve gösterim buna göre ayrışır. */
function paraliTipMi(tip: KampanyaTipi): boolean {
  return tip !== 'YUZDE';
}

function degerMetni(tip: KampanyaTipi, deger: number): string {
  switch (tip) {
    case 'YUZDE':
      return `%${deger} indirim`;
    case 'TUTAR':
      return `${paraFormat(deger)} indirim`;
    case 'SABIT_FIYAT':
      return `Sabit ${paraFormat(deger)}`;
  }
}

interface Durum {
  tur: 'basari' | 'bilgi' | 'notr';
  etiket: string;
  /** Listede sıralama ağırlığı: yürürlükteki kampanya operatörün ilk baktığıdır. */
  sira: number;
}

/**
 * Durum yalnız `aktif_mi`'den okunamaz: aktif işaretli ama tarihi geçmiş bir
 * kampanya kasada uygulanmaz. Bayrak ile takvim birlikte değerlendirilir.
 */
function durumBul(k: Kampanya, simdiMs: number): Durum {
  if (!k.aktif_mi) return { tur: 'notr', etiket: 'Pasif', sira: 2 };
  const baslangicMs = Date.parse(k.baslangic);
  const bitisMs = Date.parse(k.bitis);
  if (bitisMs < simdiMs) return { tur: 'notr', etiket: 'Sona erdi', sira: 3 };
  if (baslangicMs > simdiMs) return { tur: 'bilgi', etiket: 'Planlandı', sira: 1 };
  return { tur: 'basari', etiket: 'Yürürlükte', sira: 0 };
}

/** `<input type="date">` yerel gün anahtarı üretir (YYYY-AA-GG). */
function gunAnahtari(t: Date): string {
  const ay = String(t.getMonth() + 1).padStart(2, '0');
  const gun = String(t.getDate()).padStart(2, '0');
  return `${t.getFullYear()}-${ay}-${gun}`;
}

/**
 * Gün alanları UTC'den değil yerel alanlardan kurulur: 00:00+03:00 saklanan bir
 * başlangıç, UTC'ye çevrildiğinde bir önceki güne düşer ve tarih kayardı.
 */
function isoyuGune(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : gunAnahtari(t);
}

/** Sunucu `bitis > baslangic` şartını arar; bitiş günü sonuna çekilerek tek günlük kampanya da geçerli olur. */
function gunuIsoyaCevir(gun: string, uc: 'baslangic' | 'bitis'): string {
  return new Date(`${gun}T${uc === 'bitis' ? '23:59:59' : '00:00:00'}`).toISOString();
}

function trKucuk(metin: string): string {
  return metin.toLocaleLowerCase('tr');
}

export default function KampanyalarSayfasi() {
  const [duzenlenen, setDuzenlenen] = useState<Kampanya | 'yeni' | null>(null);

  const kampanyalar = useVeri<{ data: Kampanya[] }>(uclar.kampanyalar);
  const kategoriler = useVeri<{ data: Kategori[] }>(uclar.kategoriler);
  const urunler = useVeri<{ data: Urun[] }>(`${uclar.urunler}?limit=200`);

  const kategoriListesi = useMemo(() => kategoriler.veri?.data ?? [], [kategoriler.veri]);
  const urunListesi = useMemo(() => urunler.veri?.data ?? [], [urunler.veri]);

  const kategoriAdlari = useMemo(() => new Map(kategoriListesi.map((k): [string, string] => [k.id, k.ad])), [kategoriListesi]);
  const urunAdlari = useMemo(() => new Map(urunListesi.map((u): [string, string] => [u.id, u.ad])), [urunListesi]);

  const satirlar = useMemo(() => {
    const simdiMs = Date.now();
    return (kampanyalar.veri?.data ?? [])
      .map((kampanya) => ({ kampanya, durum: durumBul(kampanya, simdiMs) }))
      .sort((a, b) => a.durum.sira - b.durum.sira || b.kampanya.oncelik - a.kampanya.oncelik);
  }, [kampanyalar.veri]);

  const kapsamMetni = (k: Kampanya): string => {
    if (k.kapsam === 'TUM') return 'Tüm ürünler';
    if (!k.hedef_id) return 'Hedef seçilmemiş';
    if (k.kapsam === 'KATEGORI') return kategoriAdlari.get(k.hedef_id) ?? 'Kategori bulunamadı';
    return urunAdlari.get(k.hedef_id) ?? 'Ürün (listede yok)';
  };

  return (
    <Kabuk baslik="Kampanyalar">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-metin-3">İndirim kuralları — kasa satış anında kendisi uygular.</p>
          <button type="button" className="tus-birincil ml-auto" onClick={() => setDuzenlenen('yeni')}>
            Yeni Kampanya
          </button>
        </div>

        {kampanyalar.yukleniyor ? (
          <Yukleniyor />
        ) : kampanyalar.hata ? (
          <HataKutusu mesaj={kampanyalar.hata} tekrarDene={kampanyalar.tazele} />
        ) : satirlar.length === 0 ? (
          <div className="kart">
            <BosDurum
              baslik="Henüz kampanya tanımlanmadı"
              aciklama="Yeni Kampanya ile bir indirim kuralı oluşturun; kural senkron sonrası kasalarda geçerli olur."
            />
          </div>
        ) : (
          <div className="kart">
            <div className="tablo-sarmal">
              <table className="tablo">
                <thead>
                  <tr>
                    <th>Kampanya</th>
                    <th>İndirim</th>
                    <th className="text-left">Kapsam</th>
                    <th>Tarih aralığı</th>
                    <th>Öncelik</th>
                    <th>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {satirlar.map(({ kampanya, durum }) => (
                    <tr key={kampanya.id} className="cursor-pointer" onClick={() => setDuzenlenen(kampanya)}>
                      <td>
                        <span className="block max-w-[200px] truncate font-medium">{kampanya.ad}</span>
                      </td>
                      <td className="whitespace-nowrap">{degerMetni(kampanya.tip, kampanya.deger)}</td>
                      <td className="text-left">
                        <span className="block max-w-[180px] truncate text-metin-2">{kapsamMetni(kampanya)}</span>
                      </td>
                      <td className="whitespace-nowrap text-metin-3">
                        {tarihFormat(kampanya.baslangic)} – {tarihFormat(kampanya.bitis)}
                      </td>
                      <td className="sayi text-metin-3">{kampanya.oncelik}</td>
                      <td>
                        <Rozet tur={durum.tur}>{durum.etiket}</Rozet>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-xs text-metin-4">
          Kampanyalar bir sonraki senkronda kasalara iner. Kasa, satış anında ürüne uyan geçerli kampanyalar arasından müşteri
          lehine en düşük fiyatı uygular; fiyatlar eşitse önceliği yüksek olan kampanya kazanır.
        </p>
      </div>

      {duzenlenen && (
        <KampanyaFormu
          kampanya={duzenlenen}
          kategoriler={kategoriListesi}
          urunler={urunListesi}
          onKapat={() => setDuzenlenen(null)}
          onKaydedildi={() => {
            setDuzenlenen(null);
            kampanyalar.tazele();
          }}
        />
      )}
    </Kabuk>
  );
}

function KampanyaFormu({
  kampanya,
  kategoriler,
  urunler,
  onKapat,
  onKaydedildi,
}: {
  kampanya: Kampanya | 'yeni';
  kategoriler: Kategori[];
  urunler: Urun[];
  onKapat: () => void;
  onKaydedildi: () => void;
}) {
  const mevcut = kampanya === 'yeni' ? null : kampanya;

  const [ad, setAd] = useState(mevcut?.ad ?? '');
  const [tip, setTip] = useState<KampanyaTipi>(mevcut?.tip ?? 'YUZDE');
  const [kapsam, setKapsam] = useState<KampanyaKapsami>(mevcut?.kapsam ?? 'TUM');
  const [hedefId, setHedefId] = useState<string | null>(mevcut?.hedef_id ?? null);
  const [deger, setDeger] = useState(() => {
    if (!mevcut) return '';
    return paraliTipMi(mevcut.tip) ? paraFormat(mevcut.deger, { simge: false }) : String(mevcut.deger);
  });
  const [baslangic, setBaslangic] = useState(() => (mevcut ? isoyuGune(mevcut.baslangic) : gunAnahtari(new Date())));
  const [bitis, setBitis] = useState(() =>
    mevcut ? isoyuGune(mevcut.bitis) : gunAnahtari(new Date(Date.now() + 7 * 86_400_000)),
  );
  const [oncelik, setOncelik] = useState(String(mevcut?.oncelik ?? 0));
  const [aktif, setAktif] = useState(mevcut ? Boolean(mevcut.aktif_mi) : true);
  const [urunArama, setUrunArama] = useState('');
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const seciliUrun = urunler.find((u) => u.id === hedefId);
  const suzulmusUrunler = useMemo(() => {
    const anahtar = trKucuk(urunArama.trim());
    const liste = anahtar ? urunler.filter((u) => trKucuk(u.ad).includes(anahtar)) : urunler;
    // Uzun listede DOM'u şişirmemek için ilk eşleşmeler yeterli; arama daraltmayı yapar.
    return liste.slice(0, 50);
  }, [urunler, urunArama]);

  const degerEtiketi =
    tip === 'YUZDE' ? 'İndirim yüzdesi (%)' : tip === 'TUTAR' ? 'İndirim tutarı (₺)' : 'Sabit satış fiyatı (₺)';

  /** Yüzde ile kuruş farklı birimlerdir; "10" sınırı geçerken sessizce anlam değiştirmesin. */
  const tipDegistir = (yeni: KampanyaTipi) => {
    if (paraliTipMi(yeni) !== paraliTipMi(tip)) setDeger('');
    setTip(yeni);
  };

  /** Kategori kimliği ürün kimliği yerine geçemez; kapsam değişince hedef düşer. */
  const kapsamDegistir = (yeni: KampanyaKapsami) => {
    if (yeni !== kapsam) setHedefId(null);
    setKapsam(yeni);
  };

  const kaydet = async () => {
    const adTemiz = ad.trim();
    if (!adTemiz) {
      setHata('Kampanya adı zorunludur.');
      return;
    }

    let degerSayisi: number;
    if (tip === 'YUZDE') {
      const ham = Number(deger.trim().replace(',', '.'));
      if (deger.trim() === '' || !Number.isFinite(ham) || ham <= 0 || ham > 100) {
        setHata('İndirim yüzdesi 0 ile 100 arasında olmalıdır.');
        return;
      }
      degerSayisi = ham;
    } else {
      const kurus = paraParse(deger);
      if (kurus === null || kurus < 0) {
        setHata('Geçerli bir tutar girin.');
        return;
      }
      degerSayisi = kurus;
    }

    if (kapsam !== 'TUM' && !hedefId) {
      setHata(kapsam === 'KATEGORI' ? 'Bir kategori seçin.' : 'Bir ürün seçin.');
      return;
    }
    if (!baslangic || !bitis) {
      setHata('Başlangıç ve bitiş tarihi zorunludur.');
      return;
    }

    const baslangicIso = gunuIsoyaCevir(baslangic, 'baslangic');
    const bitisIso = gunuIsoyaCevir(bitis, 'bitis');
    // Sunucu da bu şartı arıyor; burada kesmek kullanıcıya boş bir ağ turu beklettirmez.
    if (bitisIso <= baslangicIso) {
      setHata('Bitiş tarihi başlangıçtan sonra olmalıdır.');
      return;
    }

    const oncelikSayisi = Number.parseInt(oncelik, 10);
    if (!Number.isFinite(oncelikSayisi)) {
      setHata('Öncelik bir tam sayı olmalıdır.');
      return;
    }

    setGonderiliyor(true);
    setHata(null);
    try {
      await api<{ id: string }>(uclar.kampanyalar, {
        method: 'POST',
        body: JSON.stringify({
          ...(mevcut ? { id: mevcut.id } : {}),
          ad: adTemiz,
          tip,
          kapsam,
          hedef_id: kapsam === 'TUM' ? null : hedefId,
          deger: degerSayisi,
          baslangic: baslangicIso,
          bitis: bitisIso,
          oncelik: oncelikSayisi,
          aktif_mi: aktif,
        }),
      });
      onKaydedildi();
    } catch (h) {
      setHata(h instanceof Error ? h.message : 'Kampanya kaydedilemedi.');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Modal
      baslik={mevcut ? 'Kampanyayı Düzenle' : 'Yeni Kampanya'}
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil flex-1" onClick={onKapat} disabled={gonderiliyor}>
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
          <span className="etiket">Kampanya adı *</span>
          <input className="alan" value={ad} onChange={(e) => setAd(e.target.value)} maxLength={120} autoFocus />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="etiket">İndirim tipi</span>
            <select className="alan" value={tip} onChange={(e) => tipDegistir(e.target.value as KampanyaTipi)}>
              {TIP_SECENEKLERI.map((s) => (
                <option key={s.deger} value={s.deger}>
                  {s.etiket}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="etiket">{degerEtiketi} *</span>
            <input
              className="alan sayi"
              inputMode="decimal"
              value={deger}
              onChange={(e) => setDeger(e.target.value)}
              placeholder={tip === 'YUZDE' ? '10' : '19,90'}
            />
          </label>
        </div>

        <label className="block">
          <span className="etiket">Kapsam</span>
          <select className="alan" value={kapsam} onChange={(e) => kapsamDegistir(e.target.value as KampanyaKapsami)}>
            {KAPSAM_SECENEKLERI.map((s) => (
              <option key={s.deger} value={s.deger}>
                {s.etiket}
              </option>
            ))}
          </select>
        </label>

        {kapsam === 'KATEGORI' && (
          <label className="block">
            <span className="etiket">Kategori *</span>
            <select className="alan" value={hedefId ?? ''} onChange={(e) => setHedefId(e.target.value || null)}>
              <option value="">Kategori seçin…</option>
              {kategoriler.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.ad}
                </option>
              ))}
            </select>
            {kategoriler.length === 0 && <span className="mt-1 block text-xs text-metin-4">Kategori listesi boş.</span>}
          </label>
        )}

        {kapsam === 'URUN' && (
          <div className="block">
            <span className="etiket">Ürün *</span>
            <input className="alan" value={urunArama} onChange={(e) => setUrunArama(e.target.value)} placeholder="Ürün ara…" />
            {hedefId && !seciliUrun && (
              <span className="mt-1 block text-xs text-uyari">Seçili ürün bu listede değil; değiştirmek için arayıp seçin.</span>
            )}
            <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-cizgi">
              {suzulmusUrunler.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setHedefId(u.id)}
                    className={`flex w-full items-center justify-between gap-3 border-b border-cizgi-ince px-3 py-2 text-left text-sm ${
                      hedefId === u.id ? 'bg-vurgu-yumusak font-medium text-vurgu' : 'text-metin-2 hover:bg-yuzey-2'
                    }`}
                  >
                    <span className="truncate">{u.ad}</span>
                    <span className="sayi shrink-0 text-xs text-metin-3">{paraFormat(u.satis_fiyati, { simge: false })}</span>
                  </button>
                </li>
              ))}
              {suzulmusUrunler.length === 0 && <li className="px-3 py-3 text-sm text-metin-4">Eşleşen ürün yok.</li>}
            </ul>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="etiket">Başlangıç *</span>
            <input type="date" className="alan" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} />
          </label>
          <label className="block">
            <span className="etiket">Bitiş *</span>
            <input type="date" className="alan" value={bitis} onChange={(e) => setBitis(e.target.value)} />
            <span className="mt-1 block text-xs text-metin-4">Bitiş günü sonuna (23:59) kadar geçerlidir.</span>
          </label>
        </div>

        <label className="block">
          <span className="etiket">Öncelik</span>
          <input className="alan sayi" inputMode="numeric" value={oncelik} onChange={(e) => setOncelik(e.target.value)} />
          <span className="mt-1 block text-xs text-metin-4">
            Aynı ürüne birden çok kampanya uyarsa müşteri lehine en düşük fiyat geçerlidir; fiyatlar eşit çıkarsa önceliği yüksek
            olan uygulanır.
          </span>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={aktif} onChange={(e) => setAktif(e.target.checked)} />
          Kampanya aktif
        </label>

        {hata && (
          <p className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm text-tehlike">{hata}</p>
        )}
      </div>
    </Modal>
  );
}
