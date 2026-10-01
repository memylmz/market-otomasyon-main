/**
 * Rapor sekmeleri — panelin bütün raporları TEK sayfada (§11.2).
 *
 * NEDEN AYRI DOSYA: bu görünümler daha önce üç ayrı sayfaya dağılmıştı — ciro
 * özeti Satış sayfasında, kasa geçmişi ve denetim logu Yönetim sayfasındaydı.
 * İşletme sahibi "Rapor" sekmesini açtığında kasadakinin yarısını görüyordu ve
 * aradığı raporun hangi menüde olduğunu tahmin etmek zorunda kalıyordu.
 *
 * Sayfa bileşenleri Next.js yönlendirmesine bağlıdır; ortak görünümler burada
 * durur ki Rapor sayfası hepsini tek yerden dizebilsin.
 */

'use client';

import { useState } from 'react';
import { bugun, gunEkle, paraFormat, tarihFormat, tarihSaatFormat, type Kurus } from '@market/shared';
import { AralikSecici, BosDurum, HataKutusu, Kutu, Modal, ParaKutusu, Rozet, Yukleniyor } from './kabuk';
import { CiroTrendi } from './grafik';
import { FisIcerigi, fisBasligi, useFis } from './fis';
import { uclar } from '@/lib/api';
import { useVeri } from '@/lib/kanca';

// ---------------------------------------------------------------------------
// Kasa geçmişi
// ---------------------------------------------------------------------------

interface KasaOturumu {
  id: string;
  cihaz_id: string;
  acilis_zamani: string;
  kapanis_zamani: string | null;
  acilis_bakiye: Kurus;
  sayilan_nakit: Kurus | null;
  beklenen_nakit: Kurus | null;
  kasa_farki: Kurus | null;
  satis_nakit: Kurus;
  satis_kart: Kurus;
  veresiye: Kurus;
  gider: Kurus;
  islem_sayisi: number;
  durum: string;
}

export function KasaSekmesi() {
  const [bitis, setBitis] = useState(bugun());
  const [baslangic, setBaslangic] = useState(gunEkle(bugun(), -29));
  const [dokumId, setDokumId] = useState<string | null>(null);
  const { veri, yukleniyor, hata, tazele } = useVeri<{ data: KasaOturumu[] }>(
    `${uclar.raporKasa}?from=${baslangic}&to=${bitis}`,
    [baslangic, bitis],
  );

  const oturumlar = veri?.data ?? [];
  // Kasa farkı toplamı: tek tek küçük farklar toplamda anlamlı bir sızıntı olabilir.
  const toplamFark = oturumlar.reduce((t, o) => t + (o.kasa_farki ?? 0), 0);
  const farkliOturum = oturumlar.filter((o) => (o.kasa_farki ?? 0) !== 0).length;

  return (
    <div className="space-y-4">
      <section className="kart p-4">
        <AralikSecici
          baslangic={baslangic}
          bitis={bitis}
          onDegisim={(b, s) => {
            setBaslangic(b);
            setBitis(s);
          }}
        />
      </section>

      {yukleniyor ? (
        <Yukleniyor />
      ) : hata ? (
        <HataKutusu mesaj={hata} tekrarDene={tazele} />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Kutu etiket="Vardiya" deger={String(oturumlar.length)} alt="Dönem içinde" />
            <Kutu etiket="Farklı kapanış" deger={String(farkliOturum)} alt="Sayım tutmayan" uyari={farkliOturum > 0} />
            <Kutu
              etiket="Toplam fark"
              deger={paraFormat(toplamFark, { isaret: true })}
              alt={toplamFark === 0 ? 'Tam' : toplamFark < 0 ? 'Eksik' : 'Fazla'}
              uyari={toplamFark !== 0}
            />
          </section>

          <section className="kart p-4">
            <h2 className="mb-3 font-semibold">Gün Sonu Geçmişi</h2>
            {oturumlar.length === 0 ? (
              <BosDurum baslik="Kasa oturumu yok" aciklama="Bu aralıkta açılmış vardiya kaydı bulunmuyor." />
            ) : (
              <div className="tablo-sarmal">
                <table className="tablo">
                  <thead>
                    <tr>
                      <th className="text-left">Açılış</th>
                      <th>Kasa</th>
                      <th>Nakit satış</th>
                      <th>Beklenen</th>
                      <th>Sayılan</th>
                      <th>Fark</th>
                      <th>Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {oturumlar.map((o) => (
                      <tr
                        key={o.id}
                        className="cursor-pointer hover:bg-yuzey-2"
                        onClick={() => setDokumId(o.id)}
                        title="Vardiya dökümünü aç"
                      >
                        <td className="whitespace-nowrap text-left text-metin-3">
                          {tarihSaatFormat(o.acilis_zamani)}
                          <span className="ml-2 whitespace-nowrap text-xs text-vurgu">dökümü gör →</span>
                        </td>
                        <td className="text-xs text-metin-4">{o.cihaz_id}</td>
                        <td className="sayi">{paraFormat(o.satis_nakit, { simge: false })}</td>
                        <td className="sayi">
                          {o.beklenen_nakit !== null ? paraFormat(o.beklenen_nakit, { simge: false }) : '—'}
                        </td>
                        <td className="sayi">{o.sayilan_nakit !== null ? paraFormat(o.sayilan_nakit, { simge: false }) : '—'}</td>
                        <td className={`sayi ${(o.kasa_farki ?? 0) !== 0 ? 'text-tehlike' : 'text-vurgu'}`}>
                          {o.kasa_farki !== null ? paraFormat(o.kasa_farki, { simge: false, isaret: true }) : '—'}
                        </td>
                        <td>{o.durum === 'ACIK' ? <Rozet tur="uyari">Açık</Rozet> : <Rozet tur="notr">Kapalı</Rozet>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-metin-4">
              Fark = sayılan nakit − beklenen nakit. Eksi fark kasada para eksik, artı fark fazla demektir. Kart tahsilatı
              fiziksel kasayı etkilemez.
            </p>
          </section>

          <VardiyaDokumuDiyalogu oturumId={dokumId} onKapat={() => setDokumId(null)} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Denetim logu
// ---------------------------------------------------------------------------

interface DenetimSatiri {
  id: string;
  kullanici_id: string | null;
  islem: string;
  entity: string;
  entity_id: string | null;
  yeni_deger: string | null;
  zaman: string;
  cihaz_id: string | null;
}

export function DenetimSekmesi({ yoneticiMi }: { yoneticiMi: boolean }) {
  const [detay, setDetay] = useState<DenetimSatiri | null>(null);
  const [filtre, setFiltre] = useState('');
  const { veri, yukleniyor, hata, tazele } = useVeri<{ data: DenetimSatiri[] }>(yoneticiMi ? `${uclar.denetim}?limit=200` : null);

  if (!yoneticiMi) {
    return (
      <div className="kart border-bilgi-cizgi bg-bilgi-yumusak p-4 text-sm text-metin">
        Denetim kayıtları yalnız yöneticilere açıktır.
      </div>
    );
  }
  if (yukleniyor) return <Yukleniyor />;
  if (hata) return <HataKutusu mesaj={hata} tekrarDene={tazele} />;

  const kayitlar = (veri?.data ?? []).filter((d) =>
    filtre ? `${d.islem} ${d.entity}`.toLocaleLowerCase('tr').includes(filtre.toLocaleLowerCase('tr')) : true,
  );

  return (
    <div className="space-y-4">
      <input
        className="alan max-w-xs"
        placeholder="İşlem ya da kayıt türünde ara…"
        value={filtre}
        onChange={(e) => setFiltre(e.target.value)}
      />

      <section className="kart p-4">
        <h2 className="mb-1 font-semibold">Denetim Kayıtları</h2>
        <p className="mb-3 text-xs text-metin-4">Kim, ne zaman, neyi değiştirdi. Kayıtlar silinemez.</p>

        {kayitlar.length === 0 ? (
          <BosDurum baslik="Kayıt yok" />
        ) : (
          <ul className="divide-y divide-cizgi-ince">
            {kayitlar.map((d) => (
              <li key={d.id}>
                <button type="button" className="w-full py-2 text-left hover:bg-yuzey-2" onClick={() => setDetay(d)}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{d.islem}</span>
                    <span className="shrink-0 text-xs text-metin-4">{tarihSaatFormat(d.zaman)}</span>
                  </div>
                  <p className="text-xs text-metin-4">
                    {d.entity}
                    {d.cihaz_id ? ` · ${d.cihaz_id}` : ''}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detay && (
        <Modal
          baslik={detay.islem}
          onKapat={() => setDetay(null)}
          altBilgi={
            <button type="button" className="tus-birincil ml-auto" onClick={() => setDetay(null)}>
              Kapat
            </button>
          }
        >
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>
                <span className="text-metin-3">Zaman:</span> {tarihSaatFormat(detay.zaman)}
              </span>
              <span>
                <span className="text-metin-3">Kayıt:</span> {detay.entity}
              </span>
              <span>
                <span className="text-metin-3">Kaynak:</span> {detay.cihaz_id ?? '—'}
              </span>
            </div>
            <div>
              <p className="etiket">Değişiklik ayrıntısı</p>
              <pre className="max-h-80 overflow-auto rounded-lg border border-cizgi bg-yuzey-2 p-3 text-xs">
                {bicimlendir(detay.yeni_deger)}
              </pre>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Denetim detayı JSON metindir; okunur biçimde göster, bozuksa ham hâlini bırak. */
function bicimlendir(ham: string | null): string {
  if (!ham) return '(ayrıntı yok)';
  try {
    return JSON.stringify(JSON.parse(ham), null, 2);
  } catch {
    return ham;
  }
}

/**
 * Bir vardiyanın para hareketleri (§10.11) — kasadaki Vardiya Dökümü
 * ekranının karşılığı. İki uygulamada aynı bilgi aynı kolonlarla görünsün.
 */
const KASA_HAREKET_ETIKETI: Record<string, string> = {
  ACILIS: 'Açılış',
  SATIS_NAKIT: 'Nakit satış',
  SATIS_KART: 'Kart satış',
  TAHSILAT: 'Tahsilat',
  ODEME: 'Ödeme',
  GIDER: 'Gider',
  GIRIS: 'Kasaya giriş',
  CIKIS: 'Kasadan çıkış',
  IADE_NAKIT: 'Nakit iade',
};

/** Fişi olan kasa hareketi tipleri — yalnız bunlar tıklanabilir. */
const FISLI_TIPLER = new Set(['SATIS_NAKIT', 'SATIS_KART', 'IADE_NAKIT']);

export function VardiyaDokumuDiyalogu({ oturumId, onKapat }: { oturumId: string | null; onKapat: () => void }) {
  const { veri, yukleniyor, hata } = useVeri<{
    oturum: KasaOturumu | null;
    hareketler: {
      id: string;
      tip: string;
      tutar: Kurus;
      aciklama: string | null;
      belge_id: string | null;
      created_at: string;
      musteri_adi?: string | null;
    }[];
  }>(oturumId ? `${uclar.raporKasa}/${oturumId}` : null);
  const [fisId, setFisId] = useState<string | null>(null);
  const { veri: fis } = useFis(fisId);

  if (!oturumId) return null;

  /**
   * Fiş AYNI pencerede açılır, üstüne ikinci bir pencere yığılmaz: panel
   * mobil önceliklidir ve iç içe modal telefonda kullanışsızdır; ayrıca
   * ESC/× iki pencereyi birden kapatırdı. Geri tuşu bir kat yukarı çıkarır.
   */
  if (fisId) {
    return (
      <Modal
        baslik={fisBasligi(fis ?? null)}
        onKapat={() => setFisId(null)}
        altBilgi={
          <button type="button" className="tus-ikincil" onClick={() => setFisId(null)}>
            ← Vardiya dökümüne dön
          </button>
        }
      >
        <FisIcerigi satisId={fisId} />
      </Modal>
    );
  }

  return (
    <Modal baslik="Vardiya Dökümü" onKapat={onKapat}>
      {yukleniyor ? (
        <Yukleniyor />
      ) : hata ? (
        <HataKutusu mesaj={hata} />
      ) : !veri?.hareketler.length ? (
        <BosDurum baslik="Hareket yok" aciklama="Bu vardiyada para hareketi kaydı bulunmuyor ya da kasa henüz senkron olmamış." />
      ) : (
        <div className="space-y-3">
          {veri.oturum && (
            <p className="text-sm text-metin-3">
              {tarihSaatFormat(veri.oturum.acilis_zamani)}
              {veri.oturum.kapanis_zamani ? ` — ${tarihSaatFormat(veri.oturum.kapanis_zamani)}` : ' — açık'}
            </p>
          )}
          <div className="tablo-sarmal">
            <table className="tablo">
              <thead>
                <tr>
                  <th className="text-left">Saat</th>
                  <th>Tür</th>
                  <th className="text-left">Açıklama</th>
                  <th>Tutar</th>
                </tr>
              </thead>
              <tbody>
                {veri.hareketler.map((h) => {
                  const fisVar = FISLI_TIPLER.has(h.tip) && Boolean(h.belge_id);
                  return (
                    <tr
                      key={h.id}
                      className={fisVar ? 'cursor-pointer hover:bg-yuzey-2' : ''}
                      onClick={() => fisVar && h.belge_id && setFisId(h.belge_id)}
                    >
                      <td className="whitespace-nowrap text-left text-metin-3">{tarihSaatFormat(h.created_at).slice(-5)}</td>
                      <td>
                        {h.aciklama?.startsWith('Satış iptali')
                          ? h.tip === 'IADE_NAKIT'
                            ? 'İptal — nakit iade'
                            : 'İptal — karta iade'
                          : (KASA_HAREKET_ETIKETI[h.tip] ?? h.tip)}
                      </td>
                      <td className="text-left text-metin-3">
                        {h.aciklama ?? '—'}
                        {fisVar && <span className="ml-2 whitespace-nowrap text-xs text-vurgu">fişi gör →</span>}
                        {fisVar && <div className="text-xs text-metin-4">Müşteri: {h.musteri_adi ?? 'Perakende'}</div>}
                      </td>
                      <td className={`sayi ${h.tutar < 0 ? 'text-tehlike' : 'text-vurgu'}`}>
                        {paraFormat(h.tutar, { simge: false, isaret: true })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
// ---------------------------------------------------------------------------
// Ciro özeti
// ---------------------------------------------------------------------------

interface GunSatiri {
  tarih: string;
  ciro: Kurus;
  iade_toplam: Kurus;
  islem_sayisi: number;
  nakit: Kurus;
  kart: Kurus;
  veresiye: Kurus;
  brut_kar: Kurus;
}

interface GunlukRapor {
  from: string;
  to: string;
  data: GunSatiri[];
  toplam: {
    ciro: Kurus;
    iade: Kurus;
    islem: number;
    kar: Kurus;
    nakit: Kurus;
    kart: Kurus;
    veresiye: Kurus;
    gider: Kurus;
    kdv: Kurus;
  };
  uretim_zamani: string;
}

/**
 * Dönemsel ciro özeti — panelin en çok bakılan raporu.
 *
 * Daha önce Satış sayfasının bir sekmesindeydi; işletme sahibi "Rapor"a
 * bakınca bulamıyordu. Satış sayfası artık yalnız fişleri listeler.
 */
export function CiroOzetiSekmesi() {
  const [bitis, setBitis] = useState(bugun());
  const [baslangic, setBaslangic] = useState(gunEkle(bugun(), -29));
  const { veri, hata } = useVeri<GunlukRapor>(`${uclar.raporGunluk}?from=${baslangic}&to=${bitis}`, [baslangic, bitis]);

  const netCiro = veri ? veri.toplam.ciro - veri.toplam.iade : 0;

  return (
    <div className="space-y-4">
      <AralikSecici
        baslangic={baslangic}
        bitis={bitis}
        onDegisim={(b, s) => {
          setBaslangic(b);
          setBitis(s);
        }}
      />

      {hata ? (
        <HataKutusu mesaj={hata} />
      ) : !veri ? (
        <Yukleniyor />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ParaKutusu etiket="Net ciro" tutar={netCiro} alt={`İade: ${paraFormat(veri.toplam.iade)}`} vurgulu />
            <Kutu
              etiket="İşlem"
              deger={String(veri.toplam.islem)}
              alt={veri.toplam.islem > 0 ? `Ort. ${paraFormat(Math.round(veri.toplam.ciro / veri.toplam.islem))}` : '—'}
            />
            <ParaKutusu
              etiket="Brüt kâr"
              tutar={veri.toplam.kar}
              alt={netCiro > 0 ? `Marj %${Math.round((veri.toplam.kar / netCiro) * 1000) / 10}` : 'KDV hariç'}
            />
            <ParaKutusu etiket="Veresiye" tutar={veri.toplam.veresiye} alt="Dönem içinde" />
          </section>

          {/* Kasadaki Ciro Özeti'nde olan ama panelde eksik olan üç rakam. */}
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ParaKutusu etiket="Nakit" tutar={veri.toplam.nakit} alt="Kasaya giren" />
            <ParaKutusu etiket="Kart" tutar={veri.toplam.kart} alt="POS" />
            <ParaKutusu etiket="Gider" tutar={veri.toplam.gider} alt="Kasadan çıkan" />
            <ParaKutusu etiket="KDV toplamı" tutar={veri.toplam.kdv} alt="Hesaplanan" />
          </section>

          <section className="kart p-4">
            <h2 className="mb-3 font-semibold">Ciro Trendi</h2>
            <CiroTrendi veri={veri.data.map((g) => ({ tarih: g.tarih, ciro: g.ciro, islem_sayisi: g.islem_sayisi }))} />
          </section>

          <section className="kart p-4">
            <h2 className="mb-3 font-semibold">Günlük Döküm</h2>
            {veri.data.length === 0 ? (
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
                    {[...veri.data].reverse().map((g) => (
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
      )}
    </div>
  );
}
