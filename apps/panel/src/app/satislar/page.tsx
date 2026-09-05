/**
 * Satış raporları (§11.3) — günlük özet rollup'tan, fiş listesi ham tablodan.
 *
 * Fiş listesi. Dönemsel ciro özeti Raporlar → Ciro Özeti'ne taşındı: aynı
 * raporun iki menüde durması, işletme sahibinin aradığını bulamamasına yol
 * açıyordu (§11.2). Burası tek tek satış
 * kayıtları ve fiş içeriği. Fiş dökümü rollup'tan üretilemez; işletme sahibinin
 * "şu fişte ne vardı" sorusunun tek cevabı ham kalem tablosudur.
 */

'use client';

import { useState } from 'react';
import { bugun, gunEkle, miktarFormat, paraFormat, tarihFormat, tarihSaatFormat, type Kurus } from '@market/shared';
import { CiroTrendi } from '@/bilesen/grafik';
import { AralikSecici, BosDurum, HataKutusu, Kabuk, Kutu, Modal, ParaKutusu, Rozet, Yukleniyor } from '@/bilesen/kabuk';
import { uclar } from '@/lib/api';
import { useVeri } from '@/lib/kanca';

type Sekme = 'ozet' | 'fisler';

interface GunSatiri {
  tarih: string;
  ciro: Kurus;
  iade_toplam: Kurus;
  islem_sayisi: number;
  nakit: Kurus;
  kart: Kurus;
  veresiye: Kurus;
  brut_kar: Kurus;
  gider: Kurus;
  ortalama_sepet: Kurus;
}

interface GunlukRapor {
  from: string;
  to: string;
  data: GunSatiri[];
  toplam: { ciro: Kurus; iade: Kurus; islem: number; kar: Kurus; nakit: Kurus; kart: Kurus; veresiye: Kurus };
  uretim_zamani: string;
}

interface FisSatiri {
  id: string;
  fis_no: string;
  tarih: string;
  cihaz_id: string;
  genel_toplam: Kurus;
  brut_kar: Kurus;
  odeme_ozeti: string;
  iptal_mi: number;
  iptal_neden: string | null;
  iade_mi: number;
  kullanici_adi: string;
  musteri_adi: string | null;
}

const HAZIR_ARALIKLAR = [
  { etiket: 'Bugün', gun: 0 },
  { etiket: '7 gün', gun: 6 },
  { etiket: '30 gün', gun: 29 },
  { etiket: '90 gün', gun: 89 },
];

const DURUMLAR = [
  { deger: 'tumu', etiket: 'Tümü' },
  { deger: 'gecerli', etiket: 'Geçerli' },
  { deger: 'iade', etiket: 'İade' },
  { deger: 'iptal', etiket: 'İptal' },
] as const;

export default function SatislarSayfasi() {
  const [sekme, setSekme] = useState<Sekme>('fisler');
  const [bitis, setBitis] = useState(bugun());
  const [baslangic, setBaslangic] = useState(gunEkle(bugun(), -29));
  const [durum, setDurum] = useState<(typeof DURUMLAR)[number]['deger']>('tumu');
  const [seciliFis, setSeciliFis] = useState<string | null>(null);

  const ozet = useVeri<GunlukRapor>(sekme === 'ozet' ? `${uclar.raporGunluk}?from=${baslangic}&to=${bitis}` : null, [
    baslangic,
    bitis,
    sekme,
  ]);
  const fisler = useVeri<{ data: FisSatiri[]; has_more: boolean; uretim_zamani: string }>(
    sekme === 'fisler' ? `${uclar.satislar}?from=${baslangic}&to=${bitis}&durum=${durum}&limit=200` : null,
    [baslangic, bitis, durum, sekme],
  );

  const aktif = sekme === 'ozet' ? ozet : fisler;

  const csvIndir = () => {
    const satirlar: string[] = [];
    let ad = '';
    if (sekme === 'ozet' && ozet.veri) {
      ad = `satis-ozeti-${baslangic}_${bitis}`;
      satirlar.push('tarih;ciro;iade;islem;nakit;kart;veresiye;brut_kar;gider');
      for (const g of ozet.veri.data) {
        satirlar.push(
          [g.tarih, g.ciro, g.iade_toplam, g.islem_sayisi, g.nakit, g.kart, g.veresiye, g.brut_kar, g.gider].join(';'),
        );
      }
    } else if (sekme === 'fisler' && fisler.veri) {
      ad = `fis-listesi-${baslangic}_${bitis}`;
      satirlar.push('fis_no;tarih;kasiyer;musteri;odeme;tutar;durum');
      for (const f of fisler.veri.data) {
        satirlar.push(
          [
            f.fis_no,
            f.tarih,
            f.kullanici_adi,
            f.musteri_adi ?? '',
            f.odeme_ozeti,
            f.genel_toplam,
            f.iptal_mi ? 'IPTAL' : f.iade_mi ? 'IADE' : 'GECERLI',
          ].join(';'),
        );
      }
    }
    if (satirlar.length === 0) return;

    const bag = document.createElement('a');
    // BOM + noktalı virgül: Excel'in Türkçe yerelinde sütunlar doğru ayrışsın.
    bag.href = URL.createObjectURL(new Blob(['﻿' + satirlar.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    bag.download = `${ad}.csv`;
    bag.click();
    URL.revokeObjectURL(bag.href);
  };

  const netCiro = ozet.veri ? ozet.veri.toplam.ciro - ozet.veri.toplam.iade : 0;

  return (
    <Kabuk baslik="Satışlar" tazelik={aktif.veri?.uretim_zamani}>
      <div className="space-y-4">
        <nav className="flex gap-1 border-b border-cizgi">
          {[{ anahtar: 'fisler' as const, etiket: 'Fişler' }].map((s) => (
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

        <section className="kart space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            {HAZIR_ARALIKLAR.map((a) => (
              <button
                key={a.etiket}
                type="button"
                className="tus-ikincil px-3 py-1.5 text-sm"
                onClick={() => {
                  setBitis(bugun());
                  setBaslangic(gunEkle(bugun(), -a.gun));
                }}
              >
                {a.etiket}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <AralikSecici
              baslangic={baslangic}
              bitis={bitis}
              onDegisim={(b, s) => {
                setBaslangic(b);
                setBitis(s);
              }}
            />
            {sekme === 'fisler' && (
              <label className="text-sm">
                <span className="etiket">Durum</span>
                <select className="alan" value={durum} onChange={(e) => setDurum(e.target.value as typeof durum)}>
                  {DURUMLAR.map((d) => (
                    <option key={d.deger} value={d.deger}>
                      {d.etiket}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" className="tus-ikincil" onClick={csvIndir} disabled={!aktif.veri}>
              Excel / CSV
            </button>
          </div>
        </section>

        {aktif.yukleniyor ? (
          <Yukleniyor />
        ) : aktif.hata ? (
          <HataKutusu mesaj={aktif.hata} tekrarDene={aktif.tazele} />
        ) : sekme === 'ozet' ? (
          !ozet.veri ? null : (
            <>
              <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <ParaKutusu etiket="Net ciro" tutar={netCiro} alt={`İade: ${paraFormat(ozet.veri.toplam.iade)}`} vurgulu />
                <Kutu
                  etiket="İşlem"
                  deger={String(ozet.veri.toplam.islem)}
                  alt={
                    ozet.veri.toplam.islem > 0
                      ? `Ort. ${paraFormat(Math.round(ozet.veri.toplam.ciro / ozet.veri.toplam.islem))}`
                      : '—'
                  }
                />
                <ParaKutusu etiket="Brüt kâr" tutar={ozet.veri.toplam.kar} alt="KDV hariç" />
                <ParaKutusu etiket="Veresiye" tutar={ozet.veri.toplam.veresiye} alt="Dönem içinde" />
              </section>

              <section className="kart p-4">
                <h2 className="mb-3 font-semibold">Ciro Trendi</h2>
                <CiroTrendi veri={ozet.veri.data.map((g) => ({ tarih: g.tarih, ciro: g.ciro, islem_sayisi: g.islem_sayisi }))} />
              </section>

              <section className="kart p-4">
                <h2 className="mb-3 font-semibold">Günlük Döküm</h2>
                {ozet.veri.data.length === 0 ? (
                  <BosDurum baslik="Bu aralıkta veri yok" />
                ) : (
                  <div className="tablo-sarmal">
                    <table className="tablo">
                      <thead>
                        <tr>
                          <th className="text-left">Tarih</th>
                          <th>Ciro</th>
                          <th>İade</th>
                          <th>İşlem</th>
                          <th>Nakit</th>
                          <th>Kart</th>
                          <th>Veresiye</th>
                          <th>Kâr</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...ozet.veri.data].reverse().map((g) => (
                          <tr key={g.tarih}>
                            <td className="whitespace-nowrap text-left">{tarihFormat(g.tarih)}</td>
                            <td className="sayi">{paraFormat(g.ciro, { simge: false })}</td>
                            <td className="sayi text-uyari">{paraFormat(g.iade_toplam, { simge: false })}</td>
                            <td className="sayi">{g.islem_sayisi}</td>
                            <td className="sayi">{paraFormat(g.nakit, { simge: false })}</td>
                            <td className="sayi">{paraFormat(g.kart, { simge: false })}</td>
                            <td className="sayi">{paraFormat(g.veresiye, { simge: false })}</td>
                            <td className="sayi text-vurgu">{paraFormat(g.brut_kar, { simge: false })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )
        ) : !fisler.veri ? null : (
          <section className="kart p-4">
            <h2 className="mb-3 font-semibold">
              Fişler <span className="text-sm font-normal text-metin-4">({fisler.veri.data.length})</span>
            </h2>
            {fisler.veri.data.length === 0 ? (
              <BosDurum
                baslik="Bu aralıkta fiş yok"
                aciklama="Tarih aralığını genişletin ya da kasadan senkron yapıldığından emin olun."
              />
            ) : (
              <>
                <div className="tablo-sarmal">
                  <table className="tablo">
                    <thead>
                      <tr>
                        <th className="text-left">Fiş No</th>
                        <th>Tarih</th>
                        <th>Kasiyer</th>
                        <th>Ödeme</th>
                        <th>Tutar</th>
                        <th>Durum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fisler.veri.data.map((f) => (
                        <tr key={f.id} className="cursor-pointer" onClick={() => setSeciliFis(f.id)}>
                          <td className="text-left font-mono">{f.fis_no}</td>
                          <td className="whitespace-nowrap text-metin-3">{tarihSaatFormat(f.tarih)}</td>
                          <td>
                            {f.kullanici_adi}
                            {f.musteri_adi && <div className="text-xs text-metin-4">{f.musteri_adi}</div>}
                          </td>
                          <td className="text-metin-3">{f.odeme_ozeti}</td>
                          <td className="sayi font-semibold">{paraFormat(Math.abs(f.genel_toplam), { simge: false })}</td>
                          <td>
                            {f.iptal_mi ? (
                              <Rozet tur="tehlike">İptal</Rozet>
                            ) : f.iade_mi ? (
                              <Rozet tur="uyari">İade</Rozet>
                            ) : (
                              <Rozet tur="basari">Geçerli</Rozet>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-metin-4">
                  Fiş içeriğini görmek için satıra dokunun.
                  {fisler.veri.has_more && ' Liste 200 kayıtla sınırlıdır; daralatmak için tarih aralığını kısaltın.'}
                </p>
              </>
            )}
          </section>
        )}
      </div>

      {seciliFis && <FisDetayi satisId={seciliFis} onKapat={() => setSeciliFis(null)} />}
    </Kabuk>
  );
}

interface FisDetayVerisi {
  satis: (FisSatiri & { ara_toplam: Kurus; iskonto_toplam: Kurus; kdv_toplam: Kurus }) | null;
  kalemler: {
    id: string;
    urun_adi: string;
    barkod: string | null;
    miktar: number;
    birim_fiyat: Kurus;
    iskonto: Kurus;
    kdv_orani: number;
    kdv_tutar: Kurus;
    satir_toplam: Kurus;
  }[];
  odemeler: { id: string; odeme_tipi: string; tutar: Kurus }[];
}

/** Geçmiş fişin tam dökümü — kasadaki fiş detay diyaloğunun panel karşılığı. */
function FisDetayi({ satisId, onKapat }: { satisId: string; onKapat: () => void }) {
  const { veri, yukleniyor, hata, tazele } = useVeri<FisDetayVerisi>(`${uclar.satislar}/${satisId}`);

  // İade fişlerinde tutarlar negatiftir; okunurluk için mutlak değer gösterilir.
  const mutlak = (d: Kurus) => paraFormat(Math.abs(d), { simge: false });

  const kdvDilimleri = new Map<number, { matrah: Kurus; kdv: Kurus }>();
  for (const k of veri?.kalemler ?? []) {
    const mevcut = kdvDilimleri.get(k.kdv_orani) ?? { matrah: 0, kdv: 0 };
    mevcut.kdv += k.kdv_tutar;
    mevcut.matrah += k.satir_toplam - k.kdv_tutar;
    kdvDilimleri.set(k.kdv_orani, mevcut);
  }

  return (
    <Modal
      baslik={veri?.satis ? `Fiş ${veri.satis.fis_no}` : 'Fiş detayı'}
      genis
      onKapat={onKapat}
      altBilgi={
        <button type="button" className="tus-birincil ml-auto" onClick={onKapat}>
          Kapat
        </button>
      }
    >
      {yukleniyor ? (
        <Yukleniyor />
      ) : hata ? (
        <HataKutusu mesaj={hata} tekrarDene={tazele} />
      ) : !veri?.satis ? (
        <BosDurum
          baslik="Fiş bulunamadı"
          aciklama="Bu fiş henüz buluta senkronlanmamış olabilir. Kasadan senkron yapıldıktan sonra tekrar deneyin."
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="text-metin-3">Tarih:</span> {tarihSaatFormat(veri.satis.tarih)}
            </span>
            <span>
              <span className="text-metin-3">Kasiyer:</span> {veri.satis.kullanici_adi}
            </span>
            <span>
              <span className="text-metin-3">Müşteri:</span> {veri.satis.musteri_adi ?? 'Perakende'}
            </span>
            <span>
              <span className="text-metin-3">Kasa:</span> {veri.satis.cihaz_id}
            </span>
            {veri.satis.iptal_mi ? <Rozet tur="tehlike">İptal edildi</Rozet> : null}
            {veri.satis.iade_mi ? <Rozet tur="uyari">İade fişi</Rozet> : null}
          </div>

          {veri.satis.iptal_mi && veri.satis.iptal_neden && (
            <p className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm">
              <strong>İptal nedeni:</strong> {veri.satis.iptal_neden}
            </p>
          )}

          <div className="tablo-sarmal">
            <table className="tablo">
              <thead>
                <tr>
                  <th className="text-left">Ürün</th>
                  <th>Miktar</th>
                  <th>Birim fiyat</th>
                  <th>İskonto</th>
                  <th>KDV</th>
                  <th>Tutar</th>
                </tr>
              </thead>
              <tbody>
                {veri.kalemler.map((k) => (
                  <tr key={k.id}>
                    <td className="text-left">
                      <div className="font-medium">{k.urun_adi}</div>
                      {k.barkod && <div className="font-mono text-xs text-metin-4">{k.barkod}</div>}
                    </td>
                    <td className="sayi">{miktarFormat(Math.abs(k.miktar))}</td>
                    <td className="sayi">{mutlak(k.birim_fiyat)}</td>
                    <td className="sayi text-uyari">{k.iskonto !== 0 ? '-' + mutlak(k.iskonto) : '—'}</td>
                    <td className="sayi text-metin-3">%{k.kdv_orani}</td>
                    <td className="sayi font-semibold">{mutlak(k.satir_toplam)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-cizgi p-3">
              <h3 className="mb-2 text-sm font-semibold">KDV Kırılımı</h3>
              {[...kdvDilimleri.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([oran, d]) => (
                  <div key={oran} className="flex justify-between text-sm">
                    <span className="text-metin-3">
                      KDV %{oran} (matrah {mutlak(d.matrah)})
                    </span>
                    <span className="font-mono">{mutlak(d.kdv)}</span>
                  </div>
                ))}
              <div className="mt-2 flex justify-between border-t border-cizgi pt-2 text-sm">
                <span className="text-metin-3">Ara toplam</span>
                <span className="font-mono">{mutlak(veri.satis.ara_toplam)}</span>
              </div>
              {veri.satis.iskonto_toplam !== 0 && (
                <div className="flex justify-between text-sm text-uyari">
                  <span>İskonto</span>
                  <span className="font-mono">-{mutlak(veri.satis.iskonto_toplam)}</span>
                </div>
              )}
              <div className="mt-1 flex items-baseline justify-between border-t border-cizgi pt-2">
                <span className="font-semibold">GENEL TOPLAM</span>
                <span className="font-mono text-xl font-bold text-vurgu">{mutlak(veri.satis.genel_toplam)}</span>
              </div>
            </div>

            <div className="rounded-lg border border-cizgi p-3">
              <h3 className="mb-2 text-sm font-semibold">Ödemeler</h3>
              {veri.odemeler.length === 0 ? (
                <p className="text-sm text-metin-4">Ödeme kaydı yok.</p>
              ) : (
                veri.odemeler.map((o) => (
                  <div key={o.id} className="flex justify-between text-sm">
                    <span>{o.odeme_tipi}</span>
                    <span className="font-mono">{mutlak(o.tutar)}</span>
                  </div>
                ))
              )}
              <p className="mt-3 border-t border-cizgi pt-2 text-xs text-metin-4">
                Fiş yeniden yazdırma kasadan yapılır; panelde yazıcı bağlantısı yoktur.
              </p>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
