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

import { useEffect, useState } from 'react';
import {
  bugun,
  gunEkle,
  miktarFormat,
  paraFormat,
  tarihFormat,
  tarihSaatFormat,
  varsayilanIadeYontemi,
  type IadeYontemi,
  type Kurus,
} from '@market/shared';
import { CiroTrendi } from '@/bilesen/grafik';
import { FisDurumNotlari, FisKagidi, IadeDokumu, type FisKagidiVerisi } from '@/bilesen/fis-kagidi';
import { AralikSecici, BosDurum, HataKutusu, Kabuk, Kutu, Modal, ParaKutusu, Rozet, Yukleniyor } from '@/bilesen/kabuk';
import { api, uclar } from '@/lib/api';
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

  // Cari ve Kasa Geçmişi'ndeki salt okunur fişten "Satışlar'da aç" ile gelinirse
  // o fişin detayı (iade düğmesiyle) açık başlar. Fiş tarih aralığı dışında
  // olsa da açılır: detay kimlikle okunur.
  useEffect(() => {
    const fis = new URLSearchParams(window.location.search).get('fis');
    if (fis) setSeciliFis(fis);
  }, []);

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

interface FisKalemi {
  id: string;
  urun_adi: string;
  barkod: string | null;
  birim_tipi?: string | null;
  miktar: number;
  birim_fiyat: Kurus;
  iskonto: Kurus;
  kdv_orani: number;
  kdv_tutar: Kurus;
  satir_toplam: Kurus;
  /** Bu satıştan iade edilen miktar (eksi). */
  iade_edilen?: number;
}

interface FisDetayVerisi {
  satis:
    | (FisSatiri & {
        ara_toplam: Kurus;
        iskonto_toplam: Kurus;
        kdv_toplam: Kurus;
        musteri_id: string | null;
        kaynak_fis_no: string | null;
      })
    | null;
  kalemler: FisKalemi[];
  odemeler: {
    id: string;
    odeme_tipi: string;
    tutar: Kurus;
    alinan?: Kurus;
    para_ustu?: Kurus;
    pos_kart?: string | null;
    pos_onay_kodu?: string | null;
  }[];
  /** Bu satıştan yapılmış iadeler. */
  iadeler?: { id: string; fis_no: string; tarih: string; genel_toplam: Kurus }[];
  /** Fiş başlığı/altı için işletme bilgisi ve yasal uyarı. */
  fis?: FisKagidiVerisi['fis'];
}

/** Geçmiş fişin tam dökümü — kasadaki fiş detay diyaloğunun panel karşılığı. */
function FisDetayi({ satisId, onKapat }: { satisId: string; onKapat: () => void }) {
  const { veri, yukleniyor, hata, tazele } = useVeri<FisDetayVerisi>(`${uclar.satislar}/${satisId}`);
  const [iadeAcik, setIadeAcik] = useState(false);

  return (
    <Modal
      baslik={veri?.satis ? `Fiş — ${veri.satis.fis_no}` : 'Fiş detayı'}
      onKapat={onKapat}
      altBilgi={
        <>
          {/*
            Kısmi iade: satışın TAMAMI değil, seçilen kalemler iade edilir.
            Panel iadeyi kendisi işlemez; kasaya talimat yazar (§10.4).
          */}
          {veri?.satis && !veri.satis.iptal_mi && !veri.satis.iade_mi && (
            <button type="button" className="tus-ikincil" onClick={() => setIadeAcik(true)}>
              Kısmi İade
            </button>
          )}
          <button type="button" className="tus-birincil ml-auto" onClick={onKapat}>
            Kapat
          </button>
        </>
      }
    >
      {iadeAcik && veri?.satis && (
        <KismiIadeDiyalogu
          satisId={satisId}
          fisNo={veri.satis.fis_no}
          kalemler={veri.kalemler}
          odemeler={veri.odemeler}
          musteriAdi={veri.satis.musteri_id ? (veri.satis.musteri_adi ?? 'Müşteri') : null}
          oncekiIadeler={veri.iadeler ?? []}
          onKapat={() => setIadeAcik(false)}
          onTamam={() => {
            setIadeAcik(false);
            tazele();
          }}
        />
      )}
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
        <div className="space-y-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="text-metin-3">Kasa:</span> {veri.satis.cihaz_id}
            </span>
            <span className="text-metin-4">Fiş yeniden yazdırma kasadan yapılır.</span>
          </div>
          <FisDurumNotlari veri={veri} />
          {/* Fişin kendisi: kasanın yazdırdığı kağıdın aynısı. */}
          <FisKagidi veri={veri} />
          <IadeDokumu veri={veri} />
        </div>
      )}
    </Modal>
  );
}

/**
 * Kısmi iade — panelden verilen TALİMAT (§10.4).
 *
 * Panel iadeyi kendisi İŞLEMEZ. Stok ve cari hareketlerinin tek üreticisi
 * kasadır; bulut kendi başına hareket üretirse kasa ondan habersiz kalır ve iki
 * taraf ayrışır. Bu yüzden burada yalnız talimat yazılır: kasa onu senkronda
 * alır, kendi iade servisiyle uygular, iade fişini basar, stoğu artırır ve
 * veresiyeyse müşterinin borcundan düşer.
 *
 * Sonucu: iade ANINDA olmaz. Kasa bir sonraki senkronda (ya da kasa açılışında)
 * uygular. Bu, ekranda açıkça söylenir.
 */
function KismiIadeDiyalogu({
  satisId,
  fisNo,
  kalemler,
  odemeler,
  musteriAdi,
  oncekiIadeler,
  onKapat,
  onTamam,
}: {
  satisId: string;
  fisNo: string;
  kalemler: FisKalemi[];
  odemeler: { odeme_tipi: string; tutar: Kurus }[];
  /** Satış bir müşteriye bağlıysa adı; değilse null (cari hesaba iade yapılamaz). */
  musteriAdi: string | null;
  oncekiIadeler: { fis_no: string; genel_toplam: Kurus }[];
  onKapat: () => void;
  onTamam: () => void;
}) {
  const [miktarlar, setMiktarlar] = useState<Record<string, string>>({});
  // Kasadaki iade ekranıyla aynı kural: para müşteriye geldiği yoldan döner.
  const onerilen = varsayilanIadeYontemi(odemeler);
  const [yontem, setYontem] = useState<IadeYontemi>(onerilen);
  const veresiyeUyarisi = onerilen === 'VERESIYE' && yontem !== 'VERESIYE';
  /*
   * Perakende (müşterisiz) satışın iadesi de borçtan düşülebilir — kasadaki iade
   * ekranının aynısı: müşteri burada seçilir, talimatla kasaya iner.
   */
  const perakende = !musteriAdi;
  const [secilenMusteri, setSecilenMusteri] = useState('');
  const musteriler = useVeri<{ data: { id: string; ad_unvan: string; bakiye: Kurus }[] }>(
    perakende && yontem === 'VERESIYE' ? `${uclar.cariler}?tip=MUSTERI&limit=200` : null,
    [perakende, yontem],
  );
  const [neden, setNeden] = useState('');
  const [kasalar, setKasalar] = useState<{ id: string; cihaz_adi: string }[]>([]);
  const [hedefKasa, setHedefKasa] = useState('');
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  useEffect(() => {
    void api<{ data: { id: string; cihaz_adi: string; aktif_mi: number }[] }>(uclar.cihazlar)
      .then((v) => {
        const aktif = v.data.filter((c) => c.aktif_mi === 1);
        setKasalar(aktif);
        if (aktif[0]) setHedefKasa(aktif[0].id);
      })
      .catch(() => setKasalar([]));
  }, []);

  const secilenler = kalemler
    .map((k) => ({ k, miktar: Math.round((Number(miktarlar[k.id]?.replace(',', '.')) || 0) * 1000) }))
    .filter((x) => x.miktar > 0);

  const toplam = secilenler.reduce(
    (t, x) => t + Math.round((x.miktar / Math.abs(x.k.miktar || 1)) * Math.abs(x.k.satir_toplam)),
    0,
  );

  const gonder = async () => {
    setHata(null);
    if (secilenler.length === 0) {
      setHata('En az bir kalem için miktar girin.');
      return;
    }
    for (const x of secilenler) {
      if (x.miktar > Math.abs(x.k.miktar)) {
        setHata(`"${x.k.urun_adi}" için satılandan fazla iade edilemez.`);
        return;
      }
    }
    if (neden.trim().length < 3) {
      setHata('İade nedeni en az 3 karakter olmalıdır.');
      return;
    }
    if (!hedefKasa) {
      setHata('İadeyi uygulayacak kasayı seçin.');
      return;
    }
    if (yontem === 'VERESIYE' && perakende && !secilenMusteri) {
      setHata('Borçtan düşmek için müşteri seçin; satış perakende yapılmış.');
      return;
    }

    setGonderiliyor(true);
    try {
      await api(uclar.iadeTalimatlari, {
        method: 'POST',
        body: JSON.stringify({
          satis_id: satisId,
          kalemler: secilenler.map((x) => ({ satis_kalemi_id: x.k.id, miktar: x.miktar })),
          iade_yontemi: yontem,
          neden: neden.trim(),
          hedef_cihaz_id: hedefKasa,
          musteri_id: yontem === 'VERESIYE' && perakende ? secilenMusteri : undefined,
        }),
      });
      onTamam();
    } catch (h) {
      setHata(h instanceof Error ? h.message : 'Talimat yazılamadı.');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Modal
      baslik={`Kısmi İade — ${fisNo}`}
      genis
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={() => void gonder()} disabled={gonderiliyor}>
            {gonderiliyor ? 'Gönderiliyor…' : 'İade Talimatı Gönder'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded border border-bilgi-cizgi bg-bilgi-yumusak px-3 py-2 text-sm">
          İade <strong>kasada</strong> uygulanır: iade fişi kasadan basılır, stok artar, veresiye satışta müşterinin borcundan
          düşülür. Talimat bir sonraki senkronda (kasa kapalıysa açılışında) işlenir.
        </p>
        {musteriAdi && (
          <p className="text-sm">
            Müşteri: <strong>{musteriAdi}</strong> — iade fişi bu müşteriye bağlanır.
          </p>
        )}
        {oncekiIadeler.length > 0 && (
          <p className="text-xs text-uyari">
            Bu satıştan daha önce iade yapıldı:{' '}
            {oncekiIadeler.map((i) => `${i.fis_no} (${paraFormat(Math.abs(i.genel_toplam), { simge: false })})`).join(', ')}.
            Satılandan fazlası kasada reddedilir.
          </p>
        )}

        <div className="tablo-sarmal">
          <table className="tablo">
            <thead>
              <tr>
                <th className="text-left">Ürün</th>
                <th>Satılan</th>
                <th>Tutar</th>
                <th>İade miktarı</th>
              </tr>
            </thead>
            <tbody>
              {kalemler.map((k) => (
                <tr key={k.id}>
                  <td className="text-left">{k.urun_adi}</td>
                  <td className="sayi text-metin-3">{miktarFormat(Math.abs(k.miktar), k.birim_tipi as never)}</td>
                  <td className="sayi text-metin-3">{paraFormat(Math.abs(k.satir_toplam), { simge: false })}</td>
                  <td>
                    <input
                      className="alan sayi w-24"
                      inputMode="decimal"
                      placeholder="0"
                      value={miktarlar[k.id] ?? ''}
                      onChange={(e) => setMiktarlar({ ...miktarlar, [k.id]: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="etiket">İade şekli</span>
            <select className="alan" value={yontem} onChange={(e) => setYontem(e.target.value as typeof yontem)}>
              <option value="NAKIT">Nakit (kasadan çıkar){onerilen === 'NAKIT' ? ' — önerilen' : ''}</option>
              <option value="KART">Kart{onerilen === 'KART' ? ' — önerilen' : ''}</option>
              <option value="VERESIYE">
                {musteriAdi
                  ? `${musteriAdi} hesabına (borçtan düşülür)${onerilen === 'VERESIYE' ? ' — önerilen' : ''}`
                  : 'Müşterinin borcundan düş (müşteri seçin)'}
              </option>
            </select>
            {yontem === 'VERESIYE' && perakende && (
              <select
                className="alan mt-2"
                value={secilenMusteri}
                onChange={(e) => setSecilenMusteri(e.target.value)}
                aria-label="Borcundan düşülecek müşteri"
              >
                <option value="">Müşteri seçin…</option>
                {(musteriler.veri?.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.ad_unvan} — borç {paraFormat(m.bakiye, { simge: false })}
                  </option>
                ))}
              </select>
            )}
            {veresiyeUyarisi && (
              <span className="mt-1 block text-xs text-uyari">
                Satış veresiye yapılmıştı: nakit/kartla iadede müşteriye para verilir, borcu düşmez.
              </span>
            )}
          </label>
          <label className="block">
            <span className="etiket">İadeyi uygulayacak kasa</span>
            <select className="alan" value={hedefKasa} onChange={(e) => setHedefKasa(e.target.value)}>
              {kasalar.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.cihaz_adi}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="etiket">İade nedeni *</span>
          <input className="alan" value={neden} onChange={(e) => setNeden(e.target.value)} placeholder="Örn. ürün bozuk çıktı" />
        </label>

        <div className="flex items-baseline justify-between rounded bg-yuzey-2 px-4 py-3">
          <span className="text-metin-2">İade edilecek tutar (yaklaşık)</span>
          <span className="font-mono text-xl font-bold text-uyari">{paraFormat(toplam)}</span>
        </div>
        <p className="text-xs text-metin-4">Kesin tutarı kasa hesaplar; iskonto ve kampanya oranları orada yeniden uygulanır.</p>

        {hata && <HataKutusu mesaj={hata} />}
      </div>
    </Modal>
  );
}
