/** Ürün / stok kartları (§10.5) — liste, kart düzenleme, toplu fiyat, içe/dışa aktarma. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { miktarFormat, miktarParse, paraFormat, type Kurus } from '@market/shared';
import { Alan, BosDurum, Diyalog, Rozet, Yukleniyor } from '../bilesen/temel';
import { EtiketOnizleme, type EtiketOnizlemeVerisi } from '../bilesen/Onizleme';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { useYetki } from '../durum/oturum';
import { cagir } from '../kopru';
import { UrunKartiDiyalogu, type UrunSatiri } from '../bilesen/UrunKartiDiyalogu';
import { AlisFaturasiFormu } from './stok/AlisFaturasiFormu';

interface Kategori {
  id: string;
  ad: string;
}

export function UrunlerSayfasi() {
  const [kayitlar, setKayitlar] = useState<UrunSatiri[]>([]);
  const [toplam, setToplam] = useState(0);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [arama, setArama] = useState('');
  const [kategoriId, setKategoriId] = useState('');
  const [sadeceKritik, setSadeceKritik] = useState(false);
  const [pasifleriGoster, setPasifleriGoster] = useState(false);
  const [kategoriler, setKategoriler] = useState<Kategori[]>([]);
  const [duzenlenen, setDuzenlenen] = useState<UrunSatiri | 'yeni' | null>(null);
  const [stokDuzeltilen, setStokDuzeltilen] = useState<UrunSatiri | null>(null);
  const [topluAcik, setTopluAcik] = useState(false);
  const [iceAktarAcik, setIceAktarAcik] = useState(false);
  const [kategoriAcik, setKategoriAcik] = useState(false);
  const [topluGirisAcik, setTopluGirisAcik] = useState(false);
  const [siralama, setSiralama] = useState<'ad' | 'stok' | 'fiyat' | 'guncelleme'>('ad');
  const [sayfa, setSayfa] = useState(0);
  const [secililer, setSecililer] = useState<Set<string>>(new Set());
  /** Etiket kuyruğu — basılana kadar durur (§13.3). */
  const [kuyruk, setKuyruk] = useState<EtiketSatiri[]>([]);
  const [kuyrukAcik, setKuyrukAcik] = useState(false);

  const SAYFA_BOYU = 50;

  const duzenleyebilir = useYetki('urun.duzenle');
  const topluYetki = useYetki('urun.toplu_islem');
  const stokDuzeltebilir = useYetki('stok.duzeltme');
  const girisYetkisi = useYetki('stok.giris');
  // Toplu giriş formu fatura kesiyor VE ürün kartı açıyor; ikisinin yetkisi de gerekir.
  const topluGirisYetkisi = duzenleyebilir && girisYetkisi;

  const kategorileriYukle = useCallback(async () => {
    try {
      setKategoriler(await cagir<Kategori[]>('kategori.listele'));
    } catch {
      setKategoriler([]);
    }
  }, []);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      const veri = await cagir<{ kayitlar: UrunSatiri[]; toplam: number }>('urun.listele', {
        filtre: {
          arama: arama || undefined,
          kategoriId: kategoriId || undefined,
          sadeceKritikStok: sadeceKritik,
          sadecePasif: pasifleriGoster,
          siralama,
        },
        limit: SAYFA_BOYU,
        ofset: sayfa * SAYFA_BOYU,
      });
      setKayitlar(veri.kayitlar);
      setToplam(veri.toplam);
    } catch (hata) {
      hatayiBildir(hata, 'Ürün listesi');
    } finally {
      setYukleniyor(false);
    }
  }, [arama, kategoriId, sadeceKritik, pasifleriGoster, siralama, sayfa]);

  useEffect(() => {
    const zamanlayici = setTimeout(() => void yukle(), 200);
    return () => clearTimeout(zamanlayici);
  }, [yukle]);

  // Filtre/sıralama değişince ilk sayfaya dön — aksi hâlde 7. sayfada boş liste görünür.
  useEffect(() => {
    setSayfa(0);
  }, [arama, kategoriId, sadeceKritik, pasifleriGoster, siralama]);

  const sayfaSayisi = Math.max(1, Math.ceil(toplam / SAYFA_BOYU));
  const secimDegistir = (id: string) =>
    setSecililer((mevcut) => {
      const yeni = new Set(mevcut);
      if (yeni.has(id)) yeni.delete(id);
      else yeni.add(id);
      return yeni;
    });

  useEffect(() => {
    void kategorileriYukle();
  }, [kategorileriYukle]);

  const disaAktar = async () => {
    try {
      const { icerik } = await cagir<{ icerik: string }>('urun.disaAktar');
      const bag = document.createElement('a');
      bag.href = URL.createObjectURL(new Blob([icerik], { type: 'text/csv;charset=utf-8' }));
      bag.download = `urunler-${new Date().toISOString().slice(0, 10)}.csv`;
      bag.click();
      URL.revokeObjectURL(bag.href);
      bildir.basari('Katalog dışa aktarıldı');
    } catch (hata) {
      hatayiBildir(hata, 'Dışa aktarma');
    }
  };

  return (
    <div className="flex h-full flex-col p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">
          Ürünler <span className="text-sm text-metin-4">({toplam})</span>
        </h1>
        {duzenleyebilir && (
          <button type="button" className="tus-ikincil" onClick={() => setKategoriAcik(true)}>
            Kategoriler
          </button>
        )}
        {topluYetki && (
          <>
            <button type="button" className="tus-ikincil" onClick={() => setTopluAcik(true)}>
              Toplu Fiyat
            </button>
            <button type="button" className="tus-ikincil" onClick={() => setIceAktarAcik(true)}>
              İçe Aktar
            </button>
            <button type="button" className="tus-ikincil" onClick={disaAktar}>
              Dışa Aktar
            </button>
          </>
        )}
        {topluGirisYetkisi && (
          <button type="button" className="tus-ikincil" onClick={() => setTopluGirisAcik(true)}>
            Tedarikçiden Toplu Ürün
          </button>
        )}
        {duzenleyebilir && (
          <button type="button" className="tus-birincil" onClick={() => setDuzenlenen('yeni')}>
            Yeni Ürün
          </button>
        )}
      </header>

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          className="alan max-w-xs"
          placeholder="Ürün adı, marka veya barkod…"
          value={arama}
          onChange={(e) => setArama(e.target.value)}
        />
        <select className="alan max-w-[200px]" value={kategoriId} onChange={(e) => setKategoriId(e.target.value)}>
          <option value="">Tüm kategoriler</option>
          {kategoriler.map((k) => (
            <option key={k.id} value={k.id}>
              {k.ad}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sadeceKritik} onChange={(e) => setSadeceKritik(e.target.checked)} />
          Kritik stok
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pasifleriGoster} onChange={(e) => setPasifleriGoster(e.target.checked)} />
          Pasif ürünler
        </label>
        <select
          className="alan ml-auto max-w-[190px]"
          value={siralama}
          onChange={(e) => setSiralama(e.target.value as typeof siralama)}
          aria-label="Sıralama"
        >
          <option value="ad">Sıralama: A → Z</option>
          <option value="stok">Sıralama: Stoğu az olan</option>
          <option value="fiyat">Sıralama: Pahalıdan ucuza</option>
          <option value="guncelleme">Sıralama: Son güncellenen</option>
        </select>
      </div>

      {/* Seçim çubuğu yalnız seçim varken görünür — boşken yer kaplamasın. */}
      {secililer.size > 0 && topluYetki && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-vurgu bg-vurgu-yumusak px-3 py-2 text-sm">
          <span className="font-medium">{secililer.size} ürün seçildi</span>
          <button type="button" className="tus-birincil px-3 py-1 text-sm" onClick={() => setTopluAcik(true)}>
            Seçili Ürünlere Zam / İndirim
          </button>
          <button
            type="button"
            className="tus-ikincil px-3 py-1 text-sm"
            onClick={() => {
              const eklenecek = kayitlar
                .filter((u) => secililer.has(u.id))
                .map((u) => ({ urunId: u.id, ad: u.ad, adet: 1, barkodsuz: u.barkodlar.length === 0 }));
              setKuyruk((o) => kuyrugaEkle(o, eklenecek));
              setKuyrukAcik(true);
              setSecililer(new Set());
            }}
          >
            Etiket Kuyruğuna Ekle
          </button>
          <button type="button" className="text-metin-3 hover:underline" onClick={() => setSecililer(new Set())}>
            Seçimi temizle
          </button>
        </div>
      )}

      <div className="kart min-h-0 flex-1 overflow-auto">
        {yukleniyor && kayitlar.length === 0 ? (
          <Yukleniyor />
        ) : kayitlar.length === 0 ? (
          <BosDurum baslik="Ürün bulunamadı" aciklama="Filtreleri değiştirin ya da yeni ürün ekleyin." />
        ) : (
          <table className="tablo">
            <thead className="sticky top-0 bg-yuzey">
              <tr>
                {topluYetki && (
                  <th className="w-10 text-center">
                    <input
                      type="checkbox"
                      aria-label="Sayfadaki tüm ürünleri seç"
                      checked={kayitlar.length > 0 && kayitlar.every((u) => secililer.has(u.id))}
                      onChange={(e) => {
                        setSecililer((mevcut) => {
                          const yeni = new Set(mevcut);
                          for (const u of kayitlar) {
                            if (e.target.checked) yeni.add(u.id);
                            else yeni.delete(u.id);
                          }
                          return yeni;
                        });
                      }}
                    />
                  </th>
                )}
                <th className="text-left">Ürün</th>
                <th className="text-left">Kategori</th>
                <th>Stok</th>
                <th>Alış</th>
                <th>Satış</th>
                <th>KDV</th>
                <th className="text-center">Durum</th>
              </tr>
            </thead>
            <tbody>
              {kayitlar.map((u) => {
                const kritik = u.kritik_stok > 0 && u.stok <= u.kritik_stok;
                return (
                  <tr
                    key={u.id}
                    onClick={() => duzenleyebilir && setDuzenlenen(u)}
                    className={`${duzenleyebilir ? 'cursor-pointer' : ''} ${secililer.has(u.id) ? 'bg-vurgu-yumusak' : ''}`}
                  >
                    {topluYetki && (
                      <td className="text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`${u.ad} seç`}
                          checked={secililer.has(u.id)}
                          onChange={() => secimDegistir(u.id)}
                        />
                      </td>
                    )}
                    <td className="text-left">
                      <div className="font-medium">{u.ad}</div>
                      <div className="text-xs text-metin-4">{[u.marka, u.barkodlar[0]].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="text-left text-metin-3">{u.kategori_adi ?? '—'}</td>
                    {/* Stok hücresi düzeltme kapısıdır: sayının kendisine basmak
                        en doğal yer, ayrı bir sütun eklemeye gerek yok. */}
                    <td className={`sayi ${u.stok < 0 ? 'text-tehlike' : kritik ? 'text-uyari' : ''}`}>
                      {stokDuzeltebilir ? (
                        <button
                          type="button"
                          className="underline decoration-dotted underline-offset-2 hover:text-vurgu"
                          title="Stoğu düzelt"
                          onClick={(e) => {
                            e.stopPropagation();
                            setStokDuzeltilen(u);
                          }}
                        >
                          {miktarFormat(u.stok, u.birim_tipi)}
                        </button>
                      ) : (
                        miktarFormat(u.stok, u.birim_tipi)
                      )}
                    </td>
                    <td className="sayi text-metin-3">{paraFormat(u.alis_fiyati, { simge: false })}</td>
                    <td className="sayi font-semibold">{paraFormat(u.satis_fiyati, { simge: false })}</td>
                    <td className="sayi text-metin-3">%{u.kdv_orani}</td>
                    <td className="text-center">
                      {!u.aktif_mi ? (
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
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-metin-4">
        <span>Düzenlemek için ürüne tıklayın.</span>

        {toplam > SAYFA_BOYU && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-metin-3">
              {sayfa * SAYFA_BOYU + 1}–{Math.min((sayfa + 1) * SAYFA_BOYU, toplam)} / {toplam}
            </span>
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

      <UrunKartiDiyalogu
        urun={duzenlenen}
        kategoriler={kategoriler}
        onKapat={() => setDuzenlenen(null)}
        onKaydedildi={() => {
          setDuzenlenen(null);
          void yukle();
        }}
      />

      <StokDuzeltDiyalogu
        urun={stokDuzeltilen}
        onKapat={() => setStokDuzeltilen(null)}
        onDuzeltildi={() => {
          setStokDuzeltilen(null);
          void yukle();
        }}
      />

      <KategoriDiyalogu
        acik={kategoriAcik}
        kategoriler={kategoriler}
        onKapat={() => setKategoriAcik(false)}
        onDegisti={() => {
          void kategorileriYukle();
          void yukle();
        }}
      />

      <TopluFiyatDiyalogu
        acik={topluAcik}
        kategoriler={kategoriler}
        seciliIdler={[...secililer]}
        onKapat={() => setTopluAcik(false)}
        onUygulandi={(degisenler) => {
          setTopluAcik(false);
          setSecililer(new Set());
          void yukle();
          /*
           * Zam sonrası etiket teklifi.
           *
           * Rafta eski fiyat kalması müşteriyle tartışma sebebidir ve fiyat
           * değiştiren kişi o anda kasadadır — etiketi basmanın doğru anı
           * burasıdır. Sonradan "hangi ürünlere zam yapmıştım" diye aramak
           * pratikte yapılmıyor.
           */
          if (degisenler.length > 0) {
            setKuyruk((o) =>
              kuyrugaEkle(
                o,
                degisenler.map((u) => ({ urunId: u.id, ad: u.ad, adet: 1 })),
              ),
            );
            setKuyrukAcik(true);
          }
        }}
      />

      <EtiketKuyruguDiyalogu acik={kuyrukAcik} kuyruk={kuyruk} onDegisim={setKuyruk} onKapat={() => setKuyrukAcik(false)} />

      <IceAktarDiyalogu
        acik={iceAktarAcik}
        onKapat={() => setIceAktarAcik(false)}
        onTamam={() => {
          setIceAktarAcik(false);
          void yukle();
        }}
      />

      <AlisFaturasiFormu
        acik={topluGirisAcik}
        onKapat={() => setTopluGirisAcik(false)}
        onTamam={() => {
          setTopluGirisAcik(false);
          void yukle();
        }}
      />
    </div>
  );
}

/**
 * Kategori yönetimi.
 *
 * Kategori silinmez, **pasifleştirilir**: silinseydi o kategoriye bağlı geçmiş
 * ürünlerin bağlantısı kopar ve eski raporlar bozulurdu (§8.5).
 */
function KategoriDiyalogu({
  acik,
  kategoriler,
  onKapat,
  onDegisti,
}: {
  acik: boolean;
  kategoriler: Kategori[];
  onKapat: () => void;
  onDegisti: () => void;
}) {
  const [yeniAd, setYeniAd] = useState('');
  const [duzenlenenId, setDuzenlenenId] = useState<string | null>(null);
  const [duzenlenenAd, setDuzenlenenAd] = useState('');
  const [calisiyor, setCalisiyor] = useState(false);

  useEffect(() => {
    if (acik) {
      setYeniAd('');
      setDuzenlenenId(null);
    }
  }, [acik]);

  const kaydet = async (girdi: { id?: string; ad: string; aktif_mi?: boolean }) => {
    if (!girdi.ad.trim()) return;
    setCalisiyor(true);
    try {
      await cagir('kategori.kaydet', { id: girdi.id, ad: girdi.ad.trim(), aktif_mi: girdi.aktif_mi ?? true });
      bildir.basari(girdi.id ? 'Kategori güncellendi' : 'Kategori eklendi');
      setYeniAd('');
      setDuzenlenenId(null);
      onDegisti();
    } catch (hata) {
      hatayiBildir(hata, 'Kategori');
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
    try {
      const sonuc = await cagir<{ silindi: boolean; urunSayisi: number; altKategoriSayisi: number; ad: string }>('kategori.sil', {
        kategoriId: k.id,
      });
      if (sonuc.silindi) {
        bildir.basari(`${sonuc.ad} silindi`);
      } else {
        const parcalar = [
          sonuc.urunSayisi > 0 ? `${sonuc.urunSayisi} ürün` : null,
          sonuc.altKategoriSayisi > 0 ? `${sonuc.altKategoriSayisi} alt kategori` : null,
        ].filter(Boolean);
        bildir.uyari(
          `${sonuc.ad} silinemedi — listeden gizlendi`,
          `İçinde ${parcalar.join(' ve ')} var. Ürünlerin kategorisi bozulmasın diye kategori pasife alındı.`,
        );
      }
      onDegisti();
    } catch (hata) {
      hatayiBildir(hata, 'Kategori silme');
    } finally {
      setCalisiyor(false);
    }
  };

  return (
    <Diyalog
      acik={acik}
      baslik="Kategoriler"
      aciklama="Ürünleri gruplamak için kullanılır. Kategori adı fişte görünmez; raporlarda ve hızlı ürün ekranında filtre olarak çalışır."
      onKapat={onKapat}
      altBilgi={
        <button type="button" className="tus-ikincil" onClick={onKapat}>
          Kapat
        </button>
      }
    >
      <div className="mb-4 flex gap-2">
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
          data-odak
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

      {kategoriler.length === 0 ? (
        <p className="py-6 text-center text-sm text-metin-4">Henüz kategori yok. Yukarıdan ekleyebilirsiniz.</p>
      ) : (
        <ul className="divide-y divide-cizgi-ince rounded border border-cizgi">
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
                        void kaydet({ id: k.id, ad: duzenlenenAd });
                      }
                      if (e.key === 'Escape') setDuzenlenenId(null);
                    }}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="tus-birincil px-3 py-1 text-sm"
                    onClick={() => kaydet({ id: k.id, ad: duzenlenenAd })}
                  >
                    Kaydet
                  </button>
                  <button type="button" className="tus-ikincil px-3 py-1 text-sm" onClick={() => setDuzenlenenId(null)}>
                    Vazgeç
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
                    Yeniden adlandır
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
    </Diyalog>
  );
}

function TopluFiyatDiyalogu({
  acik,
  onKapat,
  onUygulandi,
  kategoriler,
  seciliIdler,
}: {
  acik: boolean;
  onKapat: () => void;
  onUygulandi: (etiketAdaylari: { id: string; ad: string }[]) => void;
  kategoriler: Kategori[];
  /** Listeden işaretlenmiş ürünler; doluysa kapsam otomatik "seçililer" olur. */
  seciliIdler: string[];
}) {
  const [tip, setTip] = useState<'YUZDE_ZAM' | 'YUZDE_INDIRIM' | 'MARJ_UYGULA' | 'KDV_DEGISTIR'>('YUZDE_ZAM');
  const [hedef, setHedef] = useState<'SATIS' | 'ALIS'>('SATIS');
  const [deger, setDeger] = useState('10');
  const [kapsam, setKapsam] = useState<'secili' | 'kategori' | 'tumu'>('tumu');
  const [kategoriId, setKategoriId] = useState('');
  const [onizleme, setOnizleme] = useState<{ etkilenen: number; ornekler: { ad: string; eski: Kurus; yeni: Kurus }[] } | null>(
    null,
  );
  const [calisiyor, setCalisiyor] = useState(false);

  // Hedef seçimi yalnız yüzde zam/indirimde anlamlıdır (marj ve KDV satışa özeldir).
  const hedefSecilebilir = tip === 'YUZDE_ZAM' || tip === 'YUZDE_INDIRIM';

  // Diyalog seçim varken açıldıysa doğrudan "seçili ürünler" kapsamıyla gelsin.
  useEffect(() => {
    if (acik) {
      setKapsam(seciliIdler.length > 0 ? 'secili' : 'tumu');
      setHedef('SATIS');
      setOnizleme(null);
    }
  }, [acik, seciliIdler.length]);

  const calistir = async (uygula: boolean) => {
    setCalisiyor(true);
    try {
      const islem = {
        tip,
        deger: Number(deger.replace(',', '.')),
        hedef: hedefSecilebilir ? hedef : 'SATIS',
        filtre: {
          sadeceAktif: true,
          ...(kapsam === 'kategori' && kategoriId ? { kategoriId } : {}),
        },
        ...(kapsam === 'secili' ? { urunIdler: seciliIdler } : {}),
      };
      const sonuc = await cagir<{
        etkilenen: number;
        ornekler: { ad: string; eski: Kurus; yeni: Kurus }[];
        etiketAdaylari: { id: string; ad: string }[];
      }>('urun.topluFiyat', { islem, uygula });
      if (uygula) {
        bildir.basari(`${sonuc.etkilenen} ürünün fiyatı güncellendi`);
        onUygulandi(sonuc.etiketAdaylari ?? []);
      } else {
        setOnizleme(sonuc);
      }
    } catch (hata) {
      hatayiBildir(hata, 'Toplu fiyat');
    } finally {
      setCalisiyor(false);
    }
  };

  // Uygulamak için önizleme ZORUNLU DEĞİL; yalnız kapsam/değer geçerli olmalı.
  const gecerli =
    Number.isFinite(Number(deger.replace(',', '.'))) &&
    deger.trim() !== '' &&
    !(kapsam === 'secili' && seciliIdler.length === 0) &&
    !(kapsam === 'kategori' && !kategoriId);

  return (
    <Diyalog
      acik={acik}
      baslik="Toplu Fiyat İşlemi"
      aciklama="İsterseniz Önizle ile sonucu önce görebilirsiniz; doğrudan Uygula da çalışır."
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-ikincil" onClick={() => calistir(false)} disabled={calisiyor || !gecerli}>
            Önizle
          </button>
          <button type="button" className="tus-birincil" onClick={() => calistir(true)} disabled={calisiyor || !gecerli}>
            Uygula
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Alan etiket="Hangi ürünlere?" ipucu="Zam çoğu zaman tüm katalog için değil, belirli bir grup için yapılır.">
          <div className="grid grid-cols-3 gap-2">
            {[
              { deger: 'secili' as const, etiket: 'Seçili ürünler', alt: `${seciliIdler.length} ürün` },
              { deger: 'kategori' as const, etiket: 'Kategori', alt: 'tek kategori' },
              { deger: 'tumu' as const, etiket: 'Tüm ürünler', alt: 'aktif olanlar' },
            ].map((s) => (
              <button
                key={s.deger}
                type="button"
                disabled={s.deger === 'secili' && seciliIdler.length === 0}
                className={`${kapsam === s.deger ? 'tus-birincil' : 'tus-ikincil'} flex-col py-2`}
                onClick={() => {
                  setKapsam(s.deger);
                  setOnizleme(null);
                }}
              >
                <span className="text-sm">{s.etiket}</span>
                <span className="text-xs opacity-70">{s.alt}</span>
              </button>
            ))}
          </div>
        </Alan>

        {kapsam === 'kategori' && (
          <Alan etiket="Kategori">
            <select
              className="alan"
              value={kategoriId}
              onChange={(e) => {
                setKategoriId(e.target.value);
                setOnizleme(null);
              }}
            >
              <option value="">Kategori seçin…</option>
              {kategoriler.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.ad}
                </option>
              ))}
            </select>
          </Alan>
        )}

        {kapsam === 'secili' && seciliIdler.length === 0 && (
          <p className="rounded border border-uyari-cizgi bg-uyari-yumusak p-2 text-sm text-metin-2">
            Önce listeden ürün işaretleyin.
          </p>
        )}

        <Alan etiket="İşlem">
          <select
            className="alan"
            value={tip}
            onChange={(e) => {
              setTip(e.target.value as typeof tip);
              setOnizleme(null);
            }}
            data-odak
          >
            <option value="YUZDE_ZAM">Yüzde zam</option>
            <option value="YUZDE_INDIRIM">Yüzde indirim</option>
            <option value="MARJ_UYGULA">Hedef kâr marjı uygula</option>
            <option value="KDV_DEGISTIR">KDV oranını değiştir</option>
          </select>
        </Alan>

        {hedefSecilebilir && (
          <Alan
            etiket="Hangi fiyata?"
            ipucu={
              hedef === 'ALIS'
                ? 'Yalnız alış (maliyet) fiyatı değişir; raf/satış fiyatına dokunulmaz.'
                : 'Yalnız satış (raf) fiyatı değişir; maliyet kaydına dokunulmaz.'
            }
          >
            <div className="grid grid-cols-2 gap-2">
              {[
                { deger: 'SATIS' as const, etiket: 'Satış fiyatı', alt: 'raf fiyatı' },
                { deger: 'ALIS' as const, etiket: 'Alış fiyatı', alt: 'maliyet' },
              ].map((s) => (
                <button
                  key={s.deger}
                  type="button"
                  className={`${hedef === s.deger ? 'tus-birincil' : 'tus-ikincil'} flex-col py-2`}
                  onClick={() => {
                    setHedef(s.deger);
                    setOnizleme(null);
                  }}
                >
                  <span className="text-sm">{s.etiket}</span>
                  <span className="text-xs opacity-70">{s.alt}</span>
                </button>
              ))}
            </div>
          </Alan>
        )}

        <Alan etiket={tip === 'KDV_DEGISTIR' ? 'Yeni KDV oranı (%)' : 'Değer (%)'}>
          <input
            className="alan sayi"
            value={deger}
            onChange={(e) => {
              setDeger(e.target.value);
              setOnizleme(null);
            }}
          />
        </Alan>

        {onizleme && (
          <div className="rounded border border-cizgi bg-yuzey-3 p-3">
            <p className="mb-2 text-sm font-medium">{onizleme.etkilenen} ürün etkilenecek. Örnekler:</p>
            <ul className="space-y-1 text-sm">
              {onizleme.ornekler.map((o, i) => (
                <li key={i} className="flex justify-between">
                  <span className="truncate">{o.ad}</span>
                  <span className="font-mono">
                    <span className="text-metin-4 line-through">{paraFormat(o.eski, { simge: false })}</span>
                    {' → '}
                    <span className="text-vurgu">{paraFormat(o.yeni, { simge: false })}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Diyalog>
  );
}

function IceAktarDiyalogu({ acik, onKapat, onTamam }: { acik: boolean; onKapat: () => void; onTamam: () => void }) {
  const [icerik, setIcerik] = useState('');
  const [rapor, setRapor] = useState<{
    toplam: number;
    eklenen: number;
    guncellenen: number;
    hatali: number;
    satirlar: { satir: number; durum: string; mesaj?: string; ad?: string }[];
  } | null>(null);
  const [calisiyor, setCalisiyor] = useState(false);

  const calistir = async (uygula: boolean) => {
    if (!icerik.trim()) return;
    setCalisiyor(true);
    try {
      const sonuc = await cagir<typeof rapor>('urun.iceAktar', { icerik, uygula });
      setRapor(sonuc);
      if (uygula) {
        bildir.basari(
          'İçe aktarma tamamlandı',
          `${sonuc?.eklenen} eklendi, ${sonuc?.guncellenen} güncellendi, ${sonuc?.hatali} hatalı.`,
        );
        onTamam();
      }
    } catch (hata) {
      hatayiBildir(hata, 'İçe aktarma');
    } finally {
      setCalisiyor(false);
    }
  };

  return (
    <Diyalog
      acik={acik}
      baslik="Ürün Kataloğu İçe Aktarma"
      aciklama="CSV dosyası; sütunlar: ad;barkod;kategori;marka;birim_tipi;alis_fiyati;satis_fiyati;kdv_orani;kritik_stok;acilis_stogu;raf_konumu"
      genislik="genis"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Kapat
          </button>
          <button type="button" className="tus-ikincil" onClick={() => calistir(false)} disabled={calisiyor || !icerik.trim()}>
            Doğrula
          </button>
          <button type="button" className="tus-birincil" onClick={() => calistir(true)} disabled={calisiyor || !rapor}>
            İçe Aktar
          </button>
        </>
      }
    >
      <input
        type="file"
        accept=".csv,text/csv"
        className="mb-3 block w-full text-sm"
        onChange={async (e) => {
          const dosya = e.target.files?.[0];
          if (!dosya) return;
          setIcerik(await dosya.text());
          setRapor(null);
        }}
      />
      <textarea
        className="alan font-mono text-xs"
        rows={6}
        placeholder="Ya da CSV içeriğini buraya yapıştırın…"
        value={icerik}
        onChange={(e) => {
          setIcerik(e.target.value);
          setRapor(null);
        }}
      />

      {rapor && (
        <div className="mt-3 rounded border border-cizgi bg-yuzey-3 p-3">
          <p className="text-sm">
            Toplam {rapor.toplam} satır · <span className="text-vurgu">{rapor.eklenen} yeni</span> ·{' '}
            <span className="text-bilgi">{rapor.guncellenen} güncelleme</span> ·{' '}
            <span className={rapor.hatali > 0 ? 'text-tehlike' : ''}>{rapor.hatali} hatalı</span>
          </p>
          {rapor.hatali > 0 && (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-tehlike">
              {rapor.satirlar
                .filter((s) => s.durum === 'hata')
                .map((s) => (
                  <li key={s.satir}>
                    Satır {s.satir}: {s.mesaj}
                  </li>
                ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-metin-4">Hatalı satırlar atlanır, sağlam satırlar aktarılır.</p>
        </div>
      )}
    </Diyalog>
  );
}

/**
 * Stok düzeltme (§10.6).
 *
 * Stok append-only'dur: buraya yazılan sayı mevcut stoğu EZMEZ, servis aradaki
 * farkı `DUZELTME` hareketi olarak yazar. Sebep zorunludur — "stok neden
 * değişti" sorusunun cevabı hareket geçmişinde kalsın diye.
 */
function StokDuzeltDiyalogu({
  urun,
  onKapat,
  onDuzeltildi,
}: {
  urun: UrunSatiri | null;
  onKapat: () => void;
  onDuzeltildi: () => void;
}) {
  const [metin, setMetin] = useState('');
  const [neden, setNeden] = useState('');
  const [calisiyor, setCalisiyor] = useState(false);
  const alan = useRef<HTMLInputElement>(null);

  /*
   * Seçim, değer YERLEŞTİKTEN SONRA yapılır (§10.5).
   *
   * `autoFocus` alan boşken tetikleniyor, hemen ardından bu efekt mevcut stoğu
   * yazıyor ve React değeri değiştirdiği için seçim kayboluyordu. Sonuç:
   * kullanıcı yeni miktarı yazmak için önce eskisini silmek zorunda kalıyordu.
   *
   * Gecikme Diyalog'un kendi odak zamanlayıcısından (10 ms) uzundur.
   */
  useEffect(() => {
    if (!urun) return;
    setMetin(String(urun.stok / 1000));
    setNeden('');
    const zamanlayici = setTimeout(() => {
      alan.current?.focus();
      alan.current?.select();
    }, 20);
    return () => clearTimeout(zamanlayici);
  }, [urun]);

  if (!urun) return null;

  const birim = urun.birim_tipi === 'ADET' ? 'adet' : urun.birim_tipi.toLowerCase();
  const yeniMiktar = miktarParse(metin);
  const fark = yeniMiktar === null ? 0 : yeniMiktar - urun.stok;
  const gecerli = yeniMiktar !== null && fark !== 0 && neden.trim().length > 0;

  const uygula = async () => {
    if (!gecerli || yeniMiktar === null) return;
    setCalisiyor(true);
    try {
      await cagir('stok.duzeltme', { urunId: urun.id, yeniMiktar, neden: neden.trim() });
      bildir.basari(
        `${urun.ad} stoğu güncellendi`,
        `${miktarFormat(urun.stok, urun.birim_tipi)} → ${miktarFormat(yeniMiktar, urun.birim_tipi)}`,
      );
      onDuzeltildi();
    } catch (hata) {
      hatayiBildir(hata, 'Stok düzeltme');
    } finally {
      setCalisiyor(false);
    }
  };

  return (
    <Diyalog
      acik
      baslik="Stok Düzelt"
      aciklama={urun.ad}
      genislik="dar"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={() => void uygula()} disabled={!gecerli || calisiyor}>
            {calisiyor ? 'Kaydediliyor…' : 'Düzelt'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Alan etiket={`Yeni miktar (${birim})`} ipucu={`Şu anki: ${miktarFormat(urun.stok, urun.birim_tipi)} ${birim}`}>
          <div className="flex items-center gap-2">
            <input
              ref={alan}
              className="alan sayi py-3 text-2xl"
              inputMode="decimal"
              value={metin}
              onChange={(e) => setMetin(e.target.value)}
              // Alan mevcut stokla dolu gelir; seçili gelmezse önce silmek gerekir.
              onFocus={(e) => e.currentTarget.select()}
              data-odak
              autoFocus
            />
            <span className="shrink-0 text-sm font-medium text-metin-2">{birim}</span>
          </div>
        </Alan>

        {fark !== 0 && (
          <div className="flex items-baseline justify-between rounded bg-yuzey-3 px-4 py-3">
            <span className="text-metin-2">Yazılacak hareket</span>
            <span className={`font-mono text-xl font-bold ${fark > 0 ? 'text-basari' : 'text-uyari'}`}>
              {fark > 0 ? '+' : ''}
              {miktarFormat(fark, urun.birim_tipi)} {birim}
            </span>
          </div>
        )}

        <Alan etiket="Sebep" ipucu="Zorunlu — hareket geçmişinde görünür.">
          <input
            className="alan"
            placeholder="Sayım farkı, kırılma, geç girilen mal kabul…"
            value={neden}
            onChange={(e) => setNeden(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && gecerli) void uygula();
            }}
          />
        </Alan>
      </div>
    </Diyalog>
  );
}

// ---------------------------------------------------------------------------
// Etiket kuyruğu (§13.3)
// ---------------------------------------------------------------------------

export interface EtiketSatiri {
  urunId: string;
  ad: string;
  adet: number;
  /** Barkodu yoksa etikette barkod alanı boş kalır; kullanıcı uyarılır. */
  barkodsuz?: boolean;
}

/**
 * Kuyruğa ekler; aynı ürün ikinci kez eklenirse adedi ARTAR, satır çoğalmaz.
 *
 * Kullanıcı hem listeden seçip ekliyor hem zam sonrası teklifi kabul ediyor;
 * aynı ürün iki farklı yoldan gelebiliyor. İki ayrı satır görmek "hangisi
 * doğru?" sorusunu doğurur, tek satırda toplam adet görmek doğal olanıdır.
 */
export function kuyrugaEkle(mevcut: EtiketSatiri[], yeniler: EtiketSatiri[]): EtiketSatiri[] {
  const harita = new Map(mevcut.map((s) => [s.urunId, { ...s }]));
  for (const yeni of yeniler) {
    const varOlan = harita.get(yeni.urunId);
    if (varOlan) varOlan.adet = Math.min(500, varOlan.adet + yeni.adet);
    else harita.set(yeni.urunId, { ...yeni });
  }
  return [...harita.values()];
}

/**
 * Etiket kuyruğu — ürünleri biriktir, adetlerini ayarla, tek seferde bas.
 *
 * Basit tutulmuştur: bir liste, satır başına bir adet kutusu, bir düğme.
 */
function EtiketKuyruguDiyalogu({
  acik,
  kuyruk,
  onDegisim,
  onKapat,
}: {
  acik: boolean;
  kuyruk: EtiketSatiri[];
  onDegisim: (yeni: EtiketSatiri[]) => void;
  onKapat: () => void;
}) {
  const [basiliyor, setBasiliyor] = useState(false);
  const [yaziciVar, setYaziciVar] = useState<boolean | null>(null);
  /** Önizlenen ürün — kuyruktaki satıra tıklanınca değişir. */
  const [onizleme, setOnizleme] = useState<EtiketOnizlemeVerisi | null>(null);
  const [onizlenenId, setOnizlenenId] = useState<string | null>(null);

  useEffect(() => {
    if (!acik) return;
    void cagir<{ yazici: { tip: string } }>('etiket.ayar')
      .then((a) => setYaziciVar(a.yazici.tip !== 'YOK'))
      .catch(() => setYaziciVar(null));
  }, [acik]);

  const toplam = kuyruk.reduce((t, s) => t + s.adet, 0);

  /*
   * Kuyruktaki İLK ürün açılışta önizlenir.
   *
   * Kullanıcı basmadan önce "bu nasıl duracak" sorusunun cevabını görmeli;
   * ayrıca ürün adının etikete sığmadığı ya da barkodun taştığı burada
   * anlaşılır — yüz etiket bastıktan sonra değil.
   */
  useEffect(() => {
    if (!acik || kuyruk.length === 0) {
      setOnizleme(null);
      setOnizlenenId(null);
      return;
    }
    const hedef = kuyruk.some((s) => s.urunId === onizlenenId) ? onizlenenId : (kuyruk[0]?.urunId ?? null);
    if (!hedef) return;
    setOnizlenenId(hedef);
    void cagir<EtiketOnizlemeVerisi>('etiket.onizleme', { urunId: hedef })
      .then(setOnizleme)
      .catch(() => setOnizleme(null));
  }, [acik, kuyruk, onizlenenId]);

  const bas = async () => {
    if (kuyruk.length === 0 || basiliyor) return;
    setBasiliyor(true);
    try {
      const sonuc = await cagir<{ basarili: boolean; hata?: string; basilanEtiket: number; atlanan: { urunId: string }[] }>(
        'etiket.yazdir',
        { satirlar: kuyruk.map((s) => ({ urunId: s.urunId, adet: s.adet })) },
      );
      if (sonuc.basarili) {
        bildir.basari(`${sonuc.basilanEtiket} etiket yazıcıya gönderildi`);
        // Basılan kuyruk temizlenir; aynı etiketlerin ikinci kez basılması
        // kağıt israfıdır ve kullanıcı bunu ancak yazıcıdan fark eder.
        onDegisim([]);
        onKapat();
      } else {
        bildir.uyari('Etiket basılamadı', sonuc.hata);
      }
      if (sonuc.atlanan?.length) bildir.uyari(`${sonuc.atlanan.length} ürün atlandı`);
    } catch (hata) {
      hatayiBildir(hata, 'Etiket yazdırma');
    } finally {
      setBasiliyor(false);
    }
  };

  return (
    <Diyalog
      acik={acik}
      baslik="Etiket Kuyruğu"
      aciklama={kuyruk.length > 0 ? `${kuyruk.length} ürün · toplam ${toplam} etiket` : undefined}
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={() => onDegisim([])} disabled={kuyruk.length === 0}>
            Kuyruğu Boşalt
          </button>
          <button type="button" className="tus-birincil" onClick={() => void bas()} disabled={kuyruk.length === 0 || basiliyor}>
            {basiliyor ? 'Gönderiliyor…' : `Hepsini Bas (${toplam})`}
          </button>
        </>
      }
    >
      {yaziciVar === false && (
        <p className="mb-3 rounded border border-uyari-cizgi bg-uyari-yumusak px-3 py-2 text-sm">
          Etiket yazıcısı tanımlı değil. <strong>Ayarlar → Donanım → Etiket Yazıcısı</strong> bölümünden tanımlayın.
        </p>
      )}

      {kuyruk.length === 0 ? (
        <BosDurum
          baslik="Kuyruk boş"
          aciklama="Listeden ürün seçip 'Etiket Kuyruğuna Ekle' deyin ya da ürün kartındaki etiket düğmesini kullanın."
        />
      ) : (
        <table className="tablo">
          <thead>
            <tr>
              <th>Ürün</th>
              <th className="text-right">Adet</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {kuyruk.map((satir) => (
              <tr
                key={satir.urunId}
                className={`cursor-pointer ${onizlenenId === satir.urunId ? 'bg-vurgu-yumusak' : ''}`}
                onClick={() => setOnizlenenId(satir.urunId)}
              >
                <td>
                  {satir.ad}
                  {/*
                    Barkodsuz ürünün etiketi ad ve fiyattan ibaret kalır; kasada
                    okutulamaz. İç barkod üretmek tam burada, etiketi basmadan
                    hemen önce anlamlı — sonradan "hangileri barkodsuzdu" diye
                    aramak pratikte yapılmıyor.
                  */}
                  {satir.barkodsuz && (
                    <span className="ml-2 inline-flex items-center gap-1">
                      <Rozet tur="uyari">barkodsuz</Rozet>
                      <button
                        type="button"
                        className="text-xs text-vurgu hover:underline"
                        onClick={async () => {
                          try {
                            await cagir('urun.icBarkod', { urunId: satir.urunId });
                            onDegisim(kuyruk.map((s) => (s.urunId === satir.urunId ? { ...s, barkodsuz: false } : s)));
                            bildir.basari('İç barkod üretildi');
                          } catch (hata) {
                            hatayiBildir(hata, 'İç barkod');
                          }
                        }}
                      >
                        iç barkod üret
                      </button>
                    </span>
                  )}
                </td>
                <td className="text-right">
                  <input
                    className="alan sayi w-24"
                    inputMode="numeric"
                    value={satir.adet}
                    onChange={(e) => {
                      const adet = Math.max(1, Math.min(500, Number(e.target.value) || 1));
                      onDegisim(kuyruk.map((s) => (s.urunId === satir.urunId ? { ...s, adet } : s)));
                    }}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="text-xs text-tehlike hover:underline"
                    onClick={() => onDegisim(kuyruk.filter((s) => s.urunId !== satir.urunId))}
                  >
                    çıkar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {onizleme && (
        <div className="mt-3 border-t border-cizgi pt-3">
          <p className="mb-1 text-xs text-metin-3">Etikette böyle duracak — başka bir ürünü görmek için satırına dokunun</p>
          <EtiketOnizleme veri={onizleme} />
        </div>
      )}
    </Diyalog>
  );
}
