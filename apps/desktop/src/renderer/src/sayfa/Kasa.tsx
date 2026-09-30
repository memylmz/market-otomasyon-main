/** Kasa / vardiya ekranı (§10.8) — açılış, hareketler, gün sonu. */

import { useCallback, useEffect, useState } from 'react';
import { paraFormat, tarihSaatFormat, type Kurus } from '@market/shared';
import { Alan, BosDurum, Diyalog, ParaAlani, Rozet, TutarSatiri, Yukleniyor } from '../bilesen/temel';
import { SatisFisiDiyalogu } from '../bilesen/SatisFisiDiyalogu';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { oturumDurumu, useYetki } from '../durum/oturum';
import { cagir } from '../kopru';

interface KasaOzeti {
  acilis_bakiye: Kurus;
  beklenen_nakit: Kurus;
  satis_nakit: Kurus;
  satis_kart: Kurus;
  veresiye: Kurus;
  tahsilat: Kurus;
  odeme: Kurus;
  gider: Kurus;
  giris: Kurus;
  cikis: Kurus;
  iade_nakit: Kurus;
  islem_sayisi: number;
}

/** Fişi olan hareket tipleri — yalnız bunlar tıklanabilir. */
const SATIS_TIPLERI = new Set(['SATIS_NAKIT', 'SATIS_KART', 'SATIS_VERESIYE', 'IADE_NAKIT']);

/**
 * Veresiye satır yalnız GÖSTERİM içindir: kasadan para geçmez, kasa hareketi
 * olarak yazılmaz ve beklenen nakde girmez. Tutarı nötr renkte gösterilir ki
 * kasaya giren parayla karıştırılmasın.
 */
const NAKIT_DISI_TIPLER = new Set(['SATIS_VERESIYE']);

interface KasaHareketi {
  id: string;
  tip: string;
  tutar: Kurus;
  aciklama: string | null;
  /** Hareketi doğuran belge — satışsa fişi açılabilir (§10.7). */
  belge_id: string | null;
  created_at: string;
  /** Satıştan doğan harekette satışın müşterisi. */
  musteri_adi?: string | null;
}

interface KasaDurumu {
  oturum: { id: string; kullanici_adi?: string; acilis_zamani: string; acilis_bakiye: Kurus } | null;
  ozet: KasaOzeti | null;
  hareketler: KasaHareketi[];
  /** Açık oturum bu kullanıcıya mı ait? Değilse satış ve gün sonu yapılamaz. */
  bana_ait_mi: boolean;
  sahip_adi: string | null;
}

const HAREKET_ETIKETI: Record<string, string> = {
  SATIS_NAKIT: 'Nakit satış',
  SATIS_KART: 'Kart satış',
  SATIS_VERESIYE: 'Veresiye satış',
  TAHSILAT: 'Tahsilat',
  ODEME: 'Tedarikçi ödemesi',
  GIDER: 'Gider',
  GIRIS: 'Kasaya giriş',
  CIKIS: 'Kasadan çıkış',
  IADE_NAKIT: 'Nakit iade',
  ACILIS: 'Açılış',
};

export function KasaSayfasi() {
  const [fisId, setFisId] = useState<string | null>(null);
  const [durum, setDurum] = useState<KasaDurumu | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [acilisAcik, setAcilisAcik] = useState(false);
  const [gunSonuAcik, setGunSonuAcik] = useState(false);
  const [hareketAcik, setHareketAcik] = useState(false);
  const tazeleOturum = oturumDurumu((s) => s.tazele);
  const giderYetkisi = useYetki('kasa.gider');

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      setDurum(await cagir<KasaDurumu>('kasa.durum'));
    } catch (hata) {
      hatayiBildir(hata, 'Kasa durumu');
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  if (yukleniyor && !durum) return <Yukleniyor />;

  const acik = Boolean(durum?.oturum);
  /*
   * Açık kasa BAŞKASININ olabilir (vardiya devri, aynı cihazda ikinci kullanıcı).
   * Bu durumda ekranda açık bir kasa görünürken satış ve gün sonu reddedilir.
   * Sebebi burada açıkça söylenmezse kullanıcı hatayı anlamsız bulur.
   */
  const baskasininKasasi = acik && durum?.bana_ait_mi === false;

  return (
    <div className="h-full overflow-y-auto p-4">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Kasa / Vardiya</h1>
          {durum?.oturum && (
            <p className="text-sm text-metin-3">
              {durum.oturum.kullanici_adi} · Açılış: {tarihSaatFormat(durum.oturum.acilis_zamani)}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {!acik ? (
            <button type="button" className="tus-birincil" onClick={() => setAcilisAcik(true)}>
              Kasa Aç
            </button>
          ) : (
            <>
              {/*
                Para üstü, bozuk para ya da yanlışlıkla kapanan çekmece için.
                Kayıt üretmez; yazıcıya çekmece açma darbesi gönderir.
              */}
              <button
                type="button"
                className="tus-ikincil"
                title="Kayıt oluşturmadan çekmeceyi açar"
                onClick={async () => {
                  try {
                    await cagir('kasa.cekmeceAc');
                  } catch (hata) {
                    hatayiBildir(hata, 'Çekmece');
                  }
                }}
              >
                Çekmeceyi Aç
              </button>
              {giderYetkisi && (
                <button type="button" className="tus-ikincil" onClick={() => setHareketAcik(true)} disabled={baskasininKasasi}>
                  Gider / Para Hareketi
                </button>
              )}
              <button
                type="button"
                className="tus-tehlike"
                onClick={() => setGunSonuAcik(true)}
                disabled={baskasininKasasi}
                title={baskasininKasasi ? 'Bu kasayı yalnız açan kullanıcı kapatabilir.' : undefined}
              >
                Gün Sonu (Kapanış)
              </button>
            </>
          )}
        </div>
      </header>

      {baskasininKasasi && (
        <div className="mb-4 rounded border border-uyari-cizgi bg-uyari-yumusak px-4 py-3 text-sm text-uyari">
          <strong>Bu kasa {durum?.sahip_adi ?? 'başka bir kullanıcı'} tarafından açıldı.</strong> Satış yapabilmek veya gün sonu
          alabilmek için o kullanıcının kasayı kapatması, ardından sizin kendi kasanızı açmanız gerekir.
        </div>
      )}

      {!acik ? (
        <BosDurum
          baslik="Kasa kapalı"
          aciklama="Satış yapabilmek için gün başında kasa açılışı yapmanız gerekir. Açılış bakiyesi, kasada bulunan nakit tutardır."
          eylem={
            <button type="button" className="tus-birincil mt-2" onClick={() => setAcilisAcik(true)}>
              Kasa Açılışı Yap
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="kart p-4 lg:col-span-1">
            <h2 className="mb-3 font-semibold">Kasa Özeti</h2>
            <div className="space-y-2">
              <TutarSatiri etiket="Açılış bakiyesi" tutar={durum?.ozet?.acilis_bakiye ?? 0} />
              <TutarSatiri etiket="Nakit satış" tutar={durum?.ozet?.satis_nakit ?? 0} />
              <TutarSatiri etiket="Kart satış" tutar={durum?.ozet?.satis_kart ?? 0} />
              <TutarSatiri etiket="Veresiye satış" tutar={durum?.ozet?.veresiye ?? 0} />
              <TutarSatiri etiket="Tahsilat" tutar={durum?.ozet?.tahsilat ?? 0} />
              <TutarSatiri etiket="Gider" tutar={durum?.ozet?.gider ?? 0} />
              <TutarSatiri etiket="Nakit iade" tutar={durum?.ozet?.iade_nakit ?? 0} />
              <div className="border-t border-cizgi pt-2">
                <TutarSatiri etiket="Beklenen nakit" tutar={durum?.ozet?.beklenen_nakit ?? 0} buyuk vurgu />
              </div>
              <p className="text-xs text-metin-4">
                Kart tutarları fiziksel kasadaki nakdi etkilemez; yalnız kırılımda gösterilir.
              </p>
              <p className="pt-2 text-sm text-metin-3">İşlem sayısı: {durum?.ozet?.islem_sayisi ?? 0}</p>
            </div>
          </section>

          <section className="kart overflow-hidden lg:col-span-2">
            <h2 className="border-b border-cizgi px-4 py-3 font-semibold">Kasa Hareketleri</h2>
            <div className="max-h-[60vh] overflow-y-auto">
              {(durum?.hareketler.length ?? 0) === 0 ? (
                <p className="p-6 text-center text-sm text-metin-4">Henüz hareket yok.</p>
              ) : (
                <table className="tablo">
                  <thead className="sticky top-0 bg-yuzey">
                    <tr>
                      <th>Saat</th>
                      <th>Tür</th>
                      <th>Açıklama</th>
                      <th className="text-right">Tutar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...(durum?.hareketler ?? [])].reverse().map((h) => {
                      // Satıştan doğan hareketin fişi açılabilir: müşteri
                      // itiraz ettiğinde kasiyerin "ne almıştı" sorusuna
                      // buradan cevap vermesi gerekir (§10.7).
                      const fisVar = SATIS_TIPLERI.has(h.tip) && Boolean(h.belge_id);
                      return (
                        <tr
                          key={h.id}
                          className={fisVar ? 'cursor-pointer hover:bg-yuzey-2' : ''}
                          onClick={() => fisVar && h.belge_id && setFisId(h.belge_id)}
                        >
                          <td className="text-metin-3">{tarihSaatFormat(h.created_at).slice(-5)}</td>
                          <td>{HAREKET_ETIKETI[h.tip] ?? h.tip}</td>
                          <td className="max-w-xs truncate text-metin-3">
                            {h.aciklama ?? '—'}
                            {fisVar && <span className="ml-2 whitespace-nowrap text-xs text-vurgu">fişi gör →</span>}
                            {/* Veresiye satırının açıklaması müşteriyi zaten söyler. */}
                            {fisVar && h.tip !== 'SATIS_VERESIYE' && (
                              <div className="text-xs text-metin-4">Müşteri: {h.musteri_adi ?? 'Perakende'}</div>
                            )}
                          </td>
                          <td
                            className={`text-right sayi ${
                              NAKIT_DISI_TIPLER.has(h.tip) ? 'text-uyari' : h.tutar < 0 ? 'text-tehlike' : 'text-vurgu'
                            }`}
                          >
                            {paraFormat(h.tutar, { simge: false, isaret: true })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      )}

      <AcilisDiyalogu
        acik={acilisAcik}
        onKapat={() => setAcilisAcik(false)}
        onTamam={async () => {
          setAcilisAcik(false);
          await tazeleOturum();
          await yukle();
        }}
      />

      <GunSonuDiyalogu
        acik={gunSonuAcik}
        ozet={durum?.ozet ?? null}
        onKapat={() => setGunSonuAcik(false)}
        onTamam={async () => {
          setGunSonuAcik(false);
          await tazeleOturum();
          await yukle();
        }}
      />

      <HareketDiyalogu
        acik={hareketAcik}
        onKapat={() => setHareketAcik(false)}
        onTamam={async () => {
          setHareketAcik(false);
          await yukle();
        }}
      />
      <SatisFisiDiyalogu satisId={fisId} onKapat={() => setFisId(null)} />
    </div>
  );
}

function AcilisDiyalogu({ acik, onKapat, onTamam }: { acik: boolean; onKapat: () => void; onTamam: () => void }) {
  const [bakiye, setBakiye] = useState<Kurus>(0);
  const [gonderiliyor, setGonderiliyor] = useState(false);

  useEffect(() => {
    if (acik) setBakiye(0);
  }, [acik]);

  const gonder = async () => {
    setGonderiliyor(true);
    try {
      await cagir('kasa.ac', { acilisBakiye: bakiye });
      bildir.basari('Kasa açıldı', `Açılış bakiyesi: ${paraFormat(bakiye)}`);
      onTamam();
    } catch (hata) {
      hatayiBildir(hata, 'Kasa açılışı');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Diyalog
      acik={acik}
      baslik="Kasa Açılışı"
      aciklama="Kasada şu an bulunan nakit tutarı girin."
      genislik="dar"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={gonder} disabled={gonderiliyor}>
            {gonderiliyor ? 'Açılıyor…' : 'Kasayı Aç'}
          </button>
        </>
      }
    >
      <Alan etiket="Açılış bakiyesi" ipucu="Para üstü için kasada bıraktığınız bozuk para tutarı.">
        <ParaAlani deger={bakiye} onDegisim={setBakiye} sinif="py-3 text-xl" otomatikOdak onEnter={gonder} />
      </Alan>
    </Diyalog>
  );
}

function GunSonuDiyalogu({
  acik,
  ozet,
  onKapat,
  onTamam,
}: {
  acik: boolean;
  ozet: KasaOzeti | null;
  onKapat: () => void;
  onTamam: () => void;
}) {
  const [sayilan, setSayilan] = useState<Kurus>(0);
  const [notlar, setNotlar] = useState('');
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [sonuc, setSonuc] = useState<{ kasaFarki: Kurus; beklenenNakit: Kurus } | null>(null);

  useEffect(() => {
    if (acik) {
      setSayilan(0);
      setNotlar('');
      setSonuc(null);
    }
  }, [acik]);

  const beklenen = ozet?.beklenen_nakit ?? 0;
  const fark = sayilan - beklenen;

  const gonder = async () => {
    setGonderiliyor(true);
    try {
      const veri = await cagir<{ kasaFarki: Kurus; beklenenNakit: Kurus; senkron: { basarili: boolean } | null }>(
        'kasa.gunSonu',
        {
          sayilanNakit: sayilan,
          notlar: notlar || undefined,
          yazdir: true,
        },
      );
      setSonuc(veri);
      bildir.basari(
        'Gün sonu tamamlandı',
        veri.kasaFarki === 0 ? 'Kasa farkı yok.' : `Kasa farkı: ${paraFormat(veri.kasaFarki)}`,
      );
      if (veri.senkron?.basarili) bildir.bilgi('Gün sonu senkronu tamamlandı');
      setTimeout(onTamam, 1200);
    } catch (hata) {
      hatayiBildir(hata, 'Gün sonu');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Diyalog
      acik={acik}
      baslik="Gün Sonu (Kasa Kapanışı)"
      aciklama="Kasadaki nakdi sayın ve tutarı girin. Fark otomatik hesaplanır."
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={gonder} disabled={gonderiliyor || Boolean(sonuc)}>
            {gonderiliyor ? 'Kapatılıyor…' : 'Kasayı Kapat'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded bg-yuzey-3 p-4">
          <TutarSatiri etiket="Beklenen nakit" tutar={beklenen} buyuk />
        </div>

        <Alan etiket="Sayılan nakit *">
          <ParaAlani deger={sayilan} onDegisim={setSayilan} sinif="py-3 text-xl" otomatikOdak />
        </Alan>

        <div
          className={`rounded p-4 ${fark === 0 ? 'bg-vurgu-yumusak' : Math.abs(fark) > 5000 ? 'bg-tehlike-yumusak' : 'bg-uyari-yumusak'}`}
        >
          <div className="flex items-baseline justify-between">
            <span className="font-medium">Kasa farkı</span>
            <span className="font-mono text-2xl font-bold">{paraFormat(fark, { isaret: true })}</span>
          </div>
          <p className="mt-1 text-xs text-metin-3">
            {fark === 0 ? 'Kasa tam.' : fark > 0 ? 'Kasada fazla var.' : 'Kasada eksik var.'}
          </p>
        </div>

        <Alan etiket="Not (isteğe bağlı)">
          <textarea className="alan" rows={2} value={notlar} onChange={(e) => setNotlar(e.target.value)} />
        </Alan>

        {sonuc && <Rozet tur="basari">Gün sonu kaydedildi, vardiya raporu yazdırılıyor.</Rozet>}
      </div>
    </Diyalog>
  );
}

function HareketDiyalogu({ acik, onKapat, onTamam }: { acik: boolean; onKapat: () => void; onTamam: () => void }) {
  const [tip, setTip] = useState<'GIDER' | 'GIRIS' | 'CIKIS'>('GIDER');
  const [tutar, setTutar] = useState<Kurus>(0);
  const [aciklama, setAciklama] = useState('');
  const [gonderiliyor, setGonderiliyor] = useState(false);

  useEffect(() => {
    if (acik) {
      setTutar(0);
      setAciklama('');
    }
  }, [acik]);

  const gonder = async () => {
    if (tutar <= 0 || !aciklama.trim()) return;
    setGonderiliyor(true);
    try {
      await cagir('kasa.hareket', { tip, tutar, aciklama: aciklama.trim() });
      bildir.basari('Kasa hareketi kaydedildi');
      onTamam();
    } catch (hata) {
      hatayiBildir(hata, 'Kasa hareketi');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Diyalog
      acik={acik}
      baslik="Kasa Hareketi"
      genislik="dar"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button
            type="button"
            className="tus-birincil"
            onClick={gonder}
            disabled={gonderiliyor || tutar <= 0 || !aciklama.trim()}
          >
            Kaydet
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Alan etiket="İşlem türü">
          <select className="alan" value={tip} onChange={(e) => setTip(e.target.value as typeof tip)} data-odak>
            <option value="GIDER">Gider (kasadan çıkar)</option>
            <option value="GIRIS">Kasaya para koyma</option>
            <option value="CIKIS">Kasadan para alma</option>
          </select>
        </Alan>
        <Alan etiket="Tutar *">
          <ParaAlani deger={tutar} onDegisim={setTutar} />
        </Alan>
        <Alan etiket="Açıklama *" ipucu="Denetim kaydına yazılır; boş bırakılamaz.">
          <input
            className="alan"
            value={aciklama}
            onChange={(e) => setAciklama(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && gonder()}
          />
        </Alan>
      </div>
    </Diyalog>
  );
}
