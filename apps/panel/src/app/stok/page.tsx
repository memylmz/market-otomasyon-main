/**
 * Stok / envanter izleme (§11.5).
 *
 * İki sekme: "Durum" (rollup'tan: değer, kritik liste, sipariş önerisi) ve
 * "Hareketler" (ham hareket tablosu). Hareketler kasadaki Stok → Hareketler
 * sekmesinin karşılığıdır; "stok neden eksildi" sorusunun cevabı yalnız orada.
 */

'use client';

import { useState } from 'react';
import { bugun, gunEkle, miktarFormat, paraFormat, tarihSaatFormat, type Kurus } from '@market/shared';
import { AralikSecici, BosDurum, HataKutusu, Kabuk, Kutu, ParaKutusu, Yukleniyor } from '@/bilesen/kabuk';
import { uclar } from '@/lib/api';
import { useVeri } from '@/lib/kanca';

type Sekme = 'durum' | 'hareketler';

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
  const [sekme, setSekme] = useState<Sekme>('durum');
  const [bitis, setBitis] = useState(bugun());
  const [baslangic, setBaslangic] = useState(gunEkle(bugun(), -29));
  const [tip, setTip] = useState('');
  const [arama, setArama] = useState('');

  const durum = useVeri<StokRaporu>(sekme === 'durum' ? uclar.raporStok : null, [sekme]);
  const hareketler = useVeri<{ data: Hareket[]; has_more: boolean; uretim_zamani: string }>(
    sekme === 'hareketler' ? `${uclar.stokHareketler}?from=${baslangic}&to=${bitis}&limit=300${tip ? `&tip=${tip}` : ''}` : null,
    [sekme, baslangic, bitis, tip],
  );

  const aktif = sekme === 'durum' ? durum : hareketler;

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
            { anahtar: 'hareketler' as const, etiket: 'Hareketler' },
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
