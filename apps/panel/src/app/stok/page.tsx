/**
 * Stok / envanter izleme (§11.5).
 *
 * İki sekme: "Durum" (rollup'tan: değer, kritik liste, sipariş önerisi) ve
 * "Hareketler" (ham hareket tablosu). Hareketler kasadaki Stok → Hareketler
 * sekmesinin karşılığıdır; "stok neden eksildi" sorusunun cevabı yalnız orada.
 */

'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { bugun, gunEkle, miktarFormat, paraFormat, tarihFormat, tarihSaatFormat, type Kurus } from '@market/shared';
import { AralikSecici, BosDurum, HataKutusu, Kabuk, Kutu, ParaKutusu, Yukleniyor } from '@/bilesen/kabuk';
import { AlisSekmesi } from '@/bilesen/alis-sekmesi';
import { kullaniciyiOku, uclar } from '@/lib/api';
import { useVeri } from '@/lib/kanca';

/*
 * Sekmeler kasadaki Stok ekranıyla eşleşir (§11.5). Kasada ayrıca "Sayım"
 * sekmesi vardır; sayım fiziksel bir işlemdir ve yalnız kasada yapılır.
 *
 * "alis" madde 4 taşımasıyla eklendi: eskiden ayrı bir sayfaydı (/alis),
 * artık kasadaki Stok ekranındaki gibi burada bir sekme (bkz. alis-sekmesi.tsx).
 */
type Sekme = 'durum' | 'kritik' | 'skt' | 'hareketler' | 'alis';

interface StokRaporu {
  deger: { maliyet: Kurus; satis: Kurus; kalem: number };
  kritikler: {
    urun_id: string;
    ad: string;
    stok: number;
    kritik_stok: number;
    ideal_stok: number;
    birim_tipi: string;
    onerilen_siparis: number;
  }[];
  /** Eksiye düşmüş stoklar — sayım hatasının ya da atlanmış mal kabulün işareti. */
  negatifler: { urun_id: string; ad: string; stok: number; birim_tipi: string }[];
  /** Son kullanma tarihi yaklaşan lotlar. */
  skt_yaklasanlar: {
    urun_id: string;
    ad: string;
    skt: string;
    lot_no: string | null;
    kalan_miktar: number;
    kalan_gun: number;
    birim_tipi: string;
  }[];
  uretim_zamani: string;
}

interface Hareket {
  id: string;
  urun_id: string;
  urun_adi: string;
  birim_tipi: string | null;
  hareket_tipi: string;
  miktar: number;
  birim_maliyet: Kurus;
  cihaz_id: string | null;
  created_at: string;
}

/** Hareket tipi kodları kasadakiyle aynı; panelde okunur Türkçeye çevrilir. */
const HAREKET_ETIKETI: Record<string, string> = {
  SATIS: 'Satış',
  GIRIS: 'Mal kabul / giriş',
  IADE: 'Müşteri iadesi',
  FIRE: 'Fire / zaiat',
  SAYIM: 'Sayım düzeltmesi',
  DUZELTME: 'Manuel düzeltme',
  ACILIS: 'Açılış stoğu',
  TEDARIKCI_IADE: 'Tedarikçiye iade',
};

export default function StokSayfasi() {
  // useSearchParams açılış sekmesini (?sekme=alis) okumak için gerekir; Next.js
  // bunu bir Suspense sınırı içinde ister, aksi hâlde derleme hata verir.
  return (
    <Suspense fallback={<Kabuk baslik="Stok"><Yukleniyor /></Kabuk>}>
      <StokIcerigi />
    </Suspense>
  );
}

function StokIcerigi() {
  const searchParams = useSearchParams();
  // "/alis" sayfasından yönlendirilen ?sekme=alis burada okunur (madde 4 taşıması).
  const [sekme, setSekme] = useState<Sekme>(() => (searchParams.get('sekme') === 'alis' ? 'alis' : 'durum'));
  const [bitis, setBitis] = useState(bugun());
  const [baslangic, setBaslangic] = useState(gunEkle(bugun(), -29));
  const [tip, setTip] = useState('');
  const [arama, setArama] = useState('');
  // Alış sekmesi kasadaki `stok.giris` yetkisiyle aynı kitle: yalnız ADMIN ve
  // MÜDÜR — eskiden menüdeki `roller: ['ADMIN', 'MUDUR']` koşulunun aynısı.
  const rol = kullaniciyiOku()?.rol;
  const alisGorunur = rol === 'ADMIN' || rol === 'MUDUR';

  // Durum, Kritik ve SKT aynı uçtan beslenir; tek istek üçünü de doldurur.
  const raporSekmesi = sekme === 'durum' || sekme === 'kritik' || sekme === 'skt';
  const durum = useVeri<StokRaporu>(raporSekmesi ? uclar.raporStok : null, [raporSekmesi]);
  const hareketler = useVeri<{ data: Hareket[]; has_more: boolean; uretim_zamani: string }>(
    sekme === 'hareketler' ? `${uclar.stokHareketler}?from=${baslangic}&to=${bitis}&limit=300${tip ? `&tip=${tip}` : ''}` : null,
    [sekme, baslangic, bitis, tip],
  );

  const aktif = raporSekmesi ? durum : hareketler;

  const siparisListesiIndir = () => {
    if (!durum.veri) return;
    const satirlar = ['urun;mevcut_stok;kritik;ideal;onerilen_siparis'];
    for (const k of durum.veri.kritikler) {
      satirlar.push([k.ad, k.stok / 1000, k.kritik_stok / 1000, k.ideal_stok / 1000, k.onerilen_siparis / 1000].join(';'));
    }
    const bag = document.createElement('a');
    bag.href = URL.createObjectURL(new Blob(['﻿' + satirlar.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    bag.download = `siparis-listesi-${bugun()}.csv`;
    bag.click();
    URL.revokeObjectURL(bag.href);
  };

  // Ürün adı süzmesi istemcide: sunucu zaten tarih ve türe göre daralttı.
  const suzulmusHareketler = (hareketler.veri?.data ?? []).filter((h) =>
    arama ? h.urun_adi.toLocaleLowerCase('tr').includes(arama.toLocaleLowerCase('tr')) : true,
  );

  return (
    <Kabuk baslik="Stok" tazelik={aktif.veri?.uretim_zamani}>
      <div className="space-y-4">
        <nav className="flex gap-1 border-b border-cizgi">
          {[
            { anahtar: 'durum' as const, etiket: 'Durum' },
            { anahtar: 'kritik' as const, etiket: 'Kritik Stok' },
            { anahtar: 'skt' as const, etiket: 'SKT Takibi' },
            { anahtar: 'hareketler' as const, etiket: 'Hareketler' },
            // Kasadaki Stok ekranında olduğu gibi etiket "Alış" (madde 4 taşıması).
            ...(alisGorunur ? [{ anahtar: 'alis' as const, etiket: 'Alış' }] : []),
          ].map((s) => (
            <button
              key={s.anahtar}
              type="button"
              onClick={() => setSekme(s.anahtar)}
              className={`px-4 py-2 text-sm ${
                sekme === s.anahtar ? 'border-b-2 border-vurgu font-medium text-vurgu' : 'text-metin-3 hover:text-metin'
              }`}
            >
              {s.etiket}
            </button>
          ))}
        </nav>

        {aktif.yukleniyor ? (
          <Yukleniyor />
        ) : aktif.hata ? (
          <HataKutusu mesaj={aktif.hata} tekrarDene={aktif.tazele} />
        ) : sekme === 'durum' ? (
          !durum.veri ? null : (
            <>
              <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <ParaKutusu etiket="Stok maliyeti" tutar={durum.veri.deger.maliyet} alt="Alış fiyatlarıyla" />
                <ParaKutusu etiket="Stok satış değeri" tutar={durum.veri.deger.satis} alt="Raf fiyatlarıyla" vurgulu />
                <Kutu etiket="Stoklu ürün" deger={String(durum.veri.deger.kalem)} alt="Aktif kalem" />
                <Kutu
                  etiket="Kritik stok"
                  deger={String(durum.veri.kritikler.length)}
                  alt={durum.veri.kritikler.length > 0 ? 'Sipariş gerekli' : 'Sorun yok'}
                  uyari={durum.veri.kritikler.length > 0}
                />
              </section>

              <section className="kart p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-semibold">Kritik Stok &amp; Sipariş Önerisi</h2>
                  {durum.veri.kritikler.length > 0 && (
                    <button type="button" className="tus-ikincil px-3 py-1.5 text-sm" onClick={siparisListesiIndir}>
                      Sipariş listesi
                    </button>
                  )}
                </div>

                {durum.veri.kritikler.length === 0 ? (
                  <BosDurum baslik="Kritik seviyenin altında ürün yok" />
                ) : (
                  <div className="tablo-sarmal">
                    <table className="tablo">
                      <thead>
                        <tr>
                          <th className="text-left">Ürün</th>
                          <th>Mevcut</th>
                          <th>Kritik</th>
                          <th>İdeal</th>
                          <th>Sipariş önerisi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {durum.veri.kritikler.map((k) => (
                          <tr key={k.urun_id}>
                            <td className="max-w-[200px] truncate text-left font-medium">{k.ad}</td>
                            <td className={`sayi ${k.stok < 0 ? 'text-tehlike' : 'text-uyari'}`}>{miktarFormat(k.stok)}</td>
                            <td className="sayi text-metin-3">{miktarFormat(k.kritik_stok)}</td>
                            <td className="sayi text-metin-3">{miktarFormat(k.ideal_stok)}</td>
                            <td className="sayi font-semibold text-vurgu">{miktarFormat(k.onerilen_siparis)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <p className="text-xs text-metin-4">
                Stok miktarları kasadan gelen hareketlerin toplamıdır; son senkrondan sonraki satışlar burada henüz görünmez. Mal
                kabul, fire ve sayım işlemleri kasadan yapılır.
              </p>
            </>
          )
        ) : sekme === 'kritik' ? (
          !durum.veri ? null : (
            <>
              {/* Negatif stok kasadaki ekranda da ayrı gösterilir: sayım hatasının
                  ya da atlanmış mal kabulün ilk işaretidir. */}
              {durum.veri.negatifler.length > 0 && (
                <section className="kart border-tehlike-cizgi p-4">
                  <h2 className="mb-1 font-semibold text-tehlike">Negatif Stok</h2>
                  <p className="mb-3 text-xs text-metin-4">
                    Stoğu eksiye düşmüş ürünler. Genellikle sayım hatası ya da girilmemiş mal kabul demektir.
                  </p>
                  <div className="tablo-sarmal">
                    <table className="tablo">
                      <thead>
                        <tr>
                          <th className="text-left">Ürün</th>
                          <th>Stok</th>
                        </tr>
                      </thead>
                      <tbody>
                        {durum.veri.negatifler.map((n) => (
                          <tr key={n.urun_id}>
                            <td className="text-left">{n.ad}</td>
                            <td className="sayi text-tehlike">{miktarFormat(n.stok, n.birim_tipi as never)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <section className="kart p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="font-semibold">Kritik Stok &amp; Sipariş Önerisi</h2>
                  {durum.veri.kritikler.length > 0 && (
                    <button type="button" className="tus-ikincil px-3 py-1.5 text-sm" onClick={siparisListesiIndir}>
                      Sipariş listesi (CSV)
                    </button>
                  )}
                </div>
                {durum.veri.kritikler.length === 0 ? (
                  <BosDurum baslik="Kritik stokta ürün yok" aciklama="Her ürün kritik seviyenin üzerinde." />
                ) : (
                  <div className="tablo-sarmal">
                    <table className="tablo">
                      <thead>
                        <tr>
                          <th className="text-left">Ürün</th>
                          <th>Mevcut</th>
                          <th>Kritik</th>
                          <th>Önerilen sipariş</th>
                        </tr>
                      </thead>
                      <tbody>
                        {durum.veri.kritikler.map((k) => (
                          <tr key={k.urun_id}>
                            <td className="text-left">{k.ad}</td>
                            <td className="sayi text-uyari">{miktarFormat(k.stok, k.birim_tipi as never)}</td>
                            <td className="sayi text-metin-3">{miktarFormat(k.kritik_stok, k.birim_tipi as never)}</td>
                            <td className="sayi font-semibold text-vurgu">
                              {miktarFormat(k.onerilen_siparis, k.birim_tipi as never)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )
        ) : sekme === 'skt' ? (
          !durum.veri ? null : (
            <section className="kart p-4">
              <h2 className="mb-1 font-semibold">Son Kullanma Tarihi Yaklaşanlar</h2>
              <p className="mb-3 text-xs text-metin-4">
                Önümüzdeki 30 gün içinde tarihi dolacak lotlar. Kalan miktar, o lota ait giriş ve çıkışların toplamıdır.
              </p>
              {durum.veri.skt_yaklasanlar.length === 0 ? (
                <BosDurum
                  baslik="Yaklaşan SKT yok"
                  aciklama="Tarihi yaklaşan lot bulunmuyor. SKT takibi yalnız 'SKT takibi' açık ürünlerde tutulur."
                />
              ) : (
                <div className="tablo-sarmal">
                  <table className="tablo">
                    <thead>
                      <tr>
                        <th className="text-left">Ürün</th>
                        <th>Lot</th>
                        <th>SKT</th>
                        <th>Kalan gün</th>
                        <th>Kalan miktar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {durum.veri.skt_yaklasanlar.map((r) => (
                        <tr key={`${r.urun_id}-${r.skt}-${r.lot_no ?? ''}`}>
                          <td className="text-left">{r.ad}</td>
                          <td className="font-mono text-xs text-metin-4">{r.lot_no ?? '—'}</td>
                          <td className="whitespace-nowrap">{tarihFormat(r.skt)}</td>
                          <td className={`sayi font-semibold ${r.kalan_gun <= 7 ? 'text-tehlike' : 'text-uyari'}`}>
                            {r.kalan_gun}
                          </td>
                          <td className="sayi">{miktarFormat(r.kalan_miktar, r.birim_tipi as never)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )
        ) : sekme === 'alis' ? (
          <AlisSekmesi />
        ) : (
          <>
            <section className="kart space-y-3 p-4">
              <div className="flex flex-wrap items-end gap-3">
                <AralikSecici
                  baslangic={baslangic}
                  bitis={bitis}
                  onDegisim={(b, s) => {
                    setBaslangic(b);
                    setBitis(s);
                  }}
                />
                <label className="text-sm">
                  <span className="etiket">İşlem türü</span>
                  <select className="alan" value={tip} onChange={(e) => setTip(e.target.value)}>
                    <option value="">Tüm işlem türleri</option>
                    {Object.entries(HAREKET_ETIKETI).map(([kod, etiket]) => (
                      <option key={kod} value={kod}>
                        {etiket}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="etiket">Ürün</span>
                  <input
                    className="alan"
                    placeholder="Ürün adında ara…"
                    value={arama}
                    onChange={(e) => setArama(e.target.value)}
                  />
                </label>
              </div>
            </section>

            <section className="kart p-4">
              <h2 className="mb-3 font-semibold">
                Hareketler <span className="text-sm font-normal text-metin-4">({suzulmusHareketler.length})</span>
              </h2>
              {suzulmusHareketler.length === 0 ? (
                <BosDurum baslik="Hareket bulunamadı" aciklama="Tarih aralığını genişletin ya da filtreyi temizleyin." />
              ) : (
                <div className="tablo-sarmal">
                  <table className="tablo">
                    <thead>
                      <tr>
                        <th className="text-left">Ürün</th>
                        <th>Tarih</th>
                        <th>Tür</th>
                        <th>Miktar</th>
                        <th>Birim maliyet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suzulmusHareketler.map((h) => (
                        <tr key={h.id}>
                          <td className="max-w-[200px] truncate text-left font-medium">{h.urun_adi}</td>
                          <td className="whitespace-nowrap text-metin-3">{tarihSaatFormat(h.created_at)}</td>
                          <td className="text-metin-2">{HAREKET_ETIKETI[h.hareket_tipi] ?? h.hareket_tipi}</td>
                          <td className={`sayi ${h.miktar < 0 ? 'text-tehlike' : 'text-vurgu'}`}>{miktarFormat(h.miktar)}</td>
                          <td className="sayi text-metin-3">
                            {h.birim_maliyet ? paraFormat(h.birim_maliyet, { simge: false }) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {hareketler.veri?.has_more && (
                <p className="mt-2 text-xs text-metin-4">
                  Liste 300 kayıtla sınırlıdır; daha eskisi için tarih aralığını daraltın.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </Kabuk>
  );
}
