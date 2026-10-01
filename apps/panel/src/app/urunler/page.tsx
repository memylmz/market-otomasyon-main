/**
 * Ürün / katalog yönetimi (§11.4) — panelden yapılan değişiklik senkronla kasaya iner.
 *
 * Kasadaki Ürünler ekranıyla aynı alanları sunar: eksik alanla kaydetmek,
 * kasada girilmiş kritik stok / SKT takibi gibi bilgileri sessizce sıfırlar.
 */

'use client';

import { useState } from 'react';
import { miktarFormat, paraFormat } from '@market/shared';
import { BosDurum, HataKutusu, Kabuk, Modal, Rozet, Yukleniyor } from '@/bilesen/kabuk';
import { api, uclar } from '@/lib/api';
import { useVeri } from '@/lib/kanca';
import { UrunFormu, type Kategori, type Urun } from '@/bilesen/urun-formu';

const SAYFA_BOYU = 50;

/** Kasadaki listeyle aynı birim kısaltmaları. */
function birimKisa(birimTipi: string): string {
  if (birimTipi === 'KG') return 'kg';
  if (birimTipi === 'LT') return 'lt';
  return 'ad';
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
