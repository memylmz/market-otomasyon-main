/** Cari hesap / veresiye defteri (§10.7, §11.6). */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { paraFormat, tarihSaatFormat, type Kurus } from '@market/shared';
import { Alan, BosDurum, Diyalog, ParaAlani, Rozet, Yukleniyor } from '../bilesen/temel';
import { SatisFisiDiyalogu } from '../bilesen/SatisFisiDiyalogu';
import { TahsilatDiyalogu } from '../bilesen/TahsilatDiyalogu';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { oturumDurumu, useYetki } from '../durum/oturum';
import { cagir } from '../kopru';
import { EkstreGonderDiyalogu } from './cari/EkstreGonderDiyalogu';

interface Cari {
  id: string;
  tip: 'MUSTERI' | 'TEDARIKCI';
  ad_unvan: string;
  telefon: string | null;
  eposta: string | null;
  adres: string | null;
  vergi_no: string | null;
  kredi_limiti: Kurus;
  vade_gun: number;
  notlar: string | null;
  aktif_mi: boolean;
  bakiye: Kurus;
  son_hareket: string | null;
  iletisim_rizasi: boolean;
}

interface EkstreSatiri {
  id: string;
  tarih: string;
  hareket_tipi: string;
  tutar: Kurus;
  aciklama: string | null;
  /** Hareketi doğuran belge — SATIS ise kalemleri açılabilir. */
  belge_id: string | null;
  belge_tipi: string | null;
  yuruyen_bakiye: Kurus;
}

interface YaslandirmaSatiri {
  cari_id: string;
  ad_unvan: string;
  bakiye: Kurus;
  dilim_0_30: Kurus;
  dilim_31_60: Kurus;
  dilim_61_90: Kurus;
  dilim_90_ustu: Kurus;
}

interface CariRaporu {
  toplamlar: { musteriAlacagi: Kurus; tedarikciBorcu: Kurus };
  musteriYaslandirma: YaslandirmaSatiri[];
  tedarikciYaslandirma: YaslandirmaSatiri[];
  vadesiGecenler: { cari_id: string; ad_unvan: string; tutar: Kurus; vade_tarihi: string }[];
}

/** Panelle AYNI dilimler — iki ekran aynı borcu farklı yaşlandırmasın (§11.6). */
const DILIMLER = [
  { anahtar: 'dilim_0_30', etiket: '0-30' },
  { anahtar: 'dilim_31_60', etiket: '31-60' },
  { anahtar: 'dilim_61_90', etiket: '61-90' },
  { anahtar: 'dilim_90_ustu', etiket: '90+' },
] as const;

export function CariSayfasi() {
  const [tip, setTip] = useState<'MUSTERI' | 'TEDARIKCI'>('MUSTERI');
  const [arama, setArama] = useState('');
  const [kayitlar, setKayitlar] = useState<Cari[]>([]);
  /**
   * Seçim KİMLİKLE tutulur, kaydın kopyasıyla değil.
   * Tahsilat ya da kart düzenlemesi sonrası liste tazelendiğinde sağdaki
   * başlık kendiliğinden güncellenir; kopya tutulsaydı bakiye eski kalırdı.
   */
  const [seciliId, setSeciliId] = useState<string | null>(null);
  const [ekstre, setEkstre] = useState<EkstreSatiri[]>([]);
  const [ekstreBas, setEkstreBas] = useState('');
  const [ekstreBit, setEkstreBit] = useState('');
  const [rapor, setRapor] = useState<CariRaporu | null>(null);
  const [satisDetayi, setSatisDetayi] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kartAcik, setKartAcik] = useState<Cari | 'yeni' | null>(null);
  const [tahsilatAcik, setTahsilatAcik] = useState(false);
  const [gonderAcik, setGonderAcik] = useState(false);
  const [duzeltmeAcik, setDuzeltmeAcik] = useState<'acilis' | 'duzeltme' | null>(null);
  const [iptalEdilecek, setIptalEdilecek] = useState<EkstreSatiri | null>(null);
  const isletmeAdi = oturumDurumu((s) =>
    String((s.sistem?.ayarlar as { isletmeAdi?: string } | undefined)?.isletmeAdi ?? 'Market'),
  );

  const duzenleyebilir = useYetki('cari.duzenle');
  const tahsilatYetkisi = useYetki('cari.tahsilat');
  const kvkkYetkisi = useYetki('cari.kvkk_islem');

  const secili = useMemo(() => kayitlar.find((c) => c.id === seciliId) ?? null, [kayitlar, seciliId]);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      const veri = await cagir<{ kayitlar: Cari[] }>('cari.listele', { filtre: { tip, arama: arama || undefined }, limit: 200 });
      setKayitlar(veri.kayitlar);
    } catch (hata) {
      hatayiBildir(hata, 'Cari listesi');
    } finally {
      setYukleniyor(false);
    }
  }, [tip, arama]);

  const raporYukle = useCallback(async () => {
    try {
      setRapor(await cagir<CariRaporu>('cari.rapor'));
    } catch (hata) {
      hatayiBildir(hata, 'Cari özeti');
    }
  }, []);

  useEffect(() => {
    const z = setTimeout(() => void yukle(), 200);
    return () => clearTimeout(z);
  }, [yukle]);

  useEffect(() => {
    void raporYukle();
  }, [raporYukle]);

  const ekstreYukle = useCallback(
    async (cariId: string) => {
      try {
        setEkstre(
          await cagir<EkstreSatiri[]>('cari.ekstre', {
            cariId,
            from: ekstreBas || undefined,
            to: ekstreBit || undefined,
          }),
        );
      } catch (hata) {
        hatayiBildir(hata, 'Ekstre');
      }
    },
    [ekstreBas, ekstreBit],
  );

  // Seçim ya da tarih aralığı değiştiğinde ekstre tek yerden tazelenir.
  useEffect(() => {
    if (!seciliId) {
      setEkstre([]);
      return;
    }
    void ekstreYukle(seciliId);
  }, [seciliId, ekstreYukle]);

  /** Liste + ekstre + özet birlikte tazelenir; üçü ayrı düşerse ekran kendiyle çelişir. */
  const tumunuTazele = useCallback(async () => {
    await Promise.all([yukle(), raporYukle(), seciliId ? ekstreYukle(seciliId) : Promise.resolve()]);
  }, [yukle, raporYukle, ekstreYukle, seciliId]);

  const yaslandirmaHaritasi = useMemo(() => {
    const kaynak = tip === 'MUSTERI' ? rapor?.musteriYaslandirma : rapor?.tedarikciYaslandirma;
    return new Map((kaynak ?? []).map((y) => [y.cari_id, y]));
  }, [rapor, tip]);

  const vadesiGecenToplam = useMemo(() => (rapor?.vadesiGecenler ?? []).reduce((t, v) => t + v.tutar, 0), [rapor]);
  const vadesiGecenler = useMemo(() => new Set((rapor?.vadesiGecenler ?? []).map((v) => v.cari_id)), [rapor]);

  /** Ters kaydı yazılmış hareketler — tekrar iptal edilemesinler. */
  const iptalEdilenler = useMemo(
    () => new Set(ekstre.filter((h) => h.belge_tipi === 'TAHSILAT_IPTAL' && h.belge_id).map((h) => h.belge_id as string)),
    [ekstre],
  );

  const seciliYaslandirma = secili ? yaslandirmaHaritasi.get(secili.id) : undefined;

  return (
    <div className="flex h-full gap-4 p-4">
      <section className="flex w-1/2 min-w-0 flex-col">
        <header className="mb-3 flex items-center gap-2">
          <div className="flex rounded border border-cizgi-kuvvetli">
            {(['MUSTERI', 'TEDARIKCI'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTip(t);
                  setSeciliId(null);
                }}
                className={`px-3 py-1.5 text-sm ${tip === t ? 'bg-vurgu text-vurgu-uzeri' : 'text-metin-2'}`}
              >
                {t === 'MUSTERI' ? 'Müşteriler' : 'Tedarikçiler'}
              </button>
            ))}
          </div>
          {duzenleyebilir && (
            <button type="button" className="tus-birincil ml-auto" onClick={() => setKartAcik('yeni')}>
              Yeni
            </button>
          )}
        </header>

        <div className="mb-3 grid grid-cols-3 gap-2">
          <OzetKutusu etiket="Müşteri alacağı" tutar={rapor?.toplamlar.musteriAlacagi ?? 0} />
          <OzetKutusu etiket="Tedarikçi borcu" tutar={rapor?.toplamlar.tedarikciBorcu ?? 0} />
          <OzetKutusu etiket="Vadesi geçen (30+ gün)" tutar={vadesiGecenToplam} vurgula={vadesiGecenToplam > 0} />
        </div>

        <input className="alan mb-3" placeholder="Ad, unvan, telefon…" value={arama} onChange={(e) => setArama(e.target.value)} />

        <div className="kart min-h-0 flex-1 overflow-auto">
          {yukleniyor && kayitlar.length === 0 ? (
            <Yukleniyor />
          ) : kayitlar.length === 0 ? (
            <BosDurum baslik="Kayıt bulunamadı" />
          ) : (
            <table className="tablo">
              <thead className="sticky top-0 bg-yuzey">
                <tr>
                  <th>Ad / Unvan</th>
                  <th className="text-right">Bakiye</th>
                  <th>Son hareket</th>
                </tr>
              </thead>
              <tbody>
                {kayitlar.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSeciliId(c.id)}
                    onDoubleClick={() => duzenleyebilir && setKartAcik(c)}
                    className={`cursor-pointer ${seciliId === c.id ? 'bg-yuzey-4/60 outline outline-1 outline-vurgu' : ''}`}
                  >
                    <td>
                      <div className="flex items-center gap-1.5 font-medium">
                        {vadesiGecenler.has(c.id) && (
                          <span className="text-tehlike" title="Vadesi geçmiş borcu var">
                            ●
                          </span>
                        )}
                        {c.ad_unvan}
                      </div>
                      {c.telefon && <div className="text-xs text-metin-4">{c.telefon}</div>}
                    </td>
                    <td className={`sayi ${c.bakiye > 0 ? 'text-uyari' : c.bakiye < 0 ? 'text-vurgu' : 'text-metin-3'}`}>
                      {paraFormat(c.bakiye, { simge: false })}
                    </td>
                    <td className="text-xs text-metin-4">{c.son_hareket ? tarihSaatFormat(c.son_hareket) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="flex w-1/2 min-w-0 flex-col">
        {!secili ? (
          <div className="kart flex h-full items-center justify-center">
            <BosDurum baslik="Hesap seçin" aciklama="Soldaki listeden bir cari seçince ekstresi burada görünür." />
          </div>
        ) : (
          <>
            <header className="kart mb-3 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{secili.ad_unvan}</h2>
                  <p className="text-sm text-metin-3">{[secili.telefon, secili.vergi_no].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-metin-3">Bakiye</p>
                  <p className={`font-mono text-2xl font-bold ${secili.bakiye > 0 ? 'text-uyari' : 'text-vurgu'}`}>
                    {paraFormat(secili.bakiye)}
                  </p>
                  <p className="text-xs text-metin-4">
                    {secili.kredi_limiti > 0 ? `Limit: ${paraFormat(secili.kredi_limiti)}` : 'Limitsiz'}
                    {secili.vade_gun > 0 && ` · Vade: ${secili.vade_gun} gün`}
                  </p>
                </div>
              </div>

              {seciliYaslandirma && secili.bakiye > 0 && (
                <div className="mt-3 grid grid-cols-4 gap-1.5">
                  {DILIMLER.map((d, i) => {
                    const tutar = seciliYaslandirma[d.anahtar];
                    // 61 günü geçmiş borç tahsilat riskidir; gözle ayrılsın (§11.6).
                    const riskli = i >= 2 && tutar > 0;
                    return (
                      <div
                        key={d.anahtar}
                        className={`rounded px-2 py-1.5 text-center ${riskli ? 'bg-tehlike-yumusak' : 'bg-yuzey-3'}`}
                      >
                        <div className="text-[10px] uppercase tracking-wide text-metin-4">{d.etiket} gün</div>
                        <div className={`font-mono text-sm font-semibold ${riskli ? 'text-tehlike' : 'text-metin-2'}`}>
                          {paraFormat(tutar, { simge: false })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {tahsilatYetkisi && (
                  <button type="button" className="tus-birincil" onClick={() => setTahsilatAcik(true)}>
                    {secili.tip === 'MUSTERI' ? 'Tahsilat Yap' : 'Ödeme Yap'}
                  </button>
                )}
                {duzenleyebilir && (
                  <>
                    <button type="button" className="tus-ikincil" onClick={() => setKartAcik(secili)}>
                      Kartı Düzenle
                    </button>
                    {/*
                      Açılış bakiyesi yalnız hiç hareketi olmayan hesaba açılır:
                      hareket görmüş bir hesaba "açılış" yazmak defteri bozar,
                      oradaki doğru araç bakiye düzeltmesidir.
                    */}
                    {ekstre.length === 0 && (
                      <button type="button" className="tus-ikincil" onClick={() => setDuzeltmeAcik('acilis')}>
                        Açılış Bakiyesi
                      </button>
                    )}
                    <button type="button" className="tus-ikincil" onClick={() => setDuzeltmeAcik('duzeltme')}>
                      Bakiye Düzelt
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="tus-ikincil"
                  onClick={async () => {
                    const sonuc = await cagir<{ basarili: boolean; hata?: string }>('cari.ekstreYazdir', {
                      cariId: secili.id,
                      from: ekstreBas || undefined,
                      to: ekstreBit || undefined,
                    });
                    if (sonuc.basarili) bildir.basari('Ekstre yazdırıldı');
                    else bildir.uyari('Ekstre yazdırılamadı', sonuc.hata);
                  }}
                >
                  Ekstre Yazdır
                </button>
                <button
                  type="button"
                  className="tus-ikincil"
                  onClick={() => setGonderAcik(true)}
                  title={
                    secili.iletisim_rizasi
                      ? 'WhatsApp, SMS veya e-posta ile bakiye bildirimi gönder'
                      : 'İletişim rızası alınmamış — KVKK gereği gönderilemez'
                  }
                >
                  Ekstre Gönder
                  {!secili.iletisim_rizasi && <span className="ml-1 text-tehlike">•</span>}
                </button>
                {kvkkYetkisi && (
                  <button
                    type="button"
                    className="tus-ikincil"
                    onClick={async () => {
                      const veri = await cagir('cari.kvkkDisaAktar', { cariId: secili.id });
                      const bag = document.createElement('a');
                      bag.href = URL.createObjectURL(new Blob([JSON.stringify(veri, null, 2)], { type: 'application/json' }));
                      bag.download = `cari-${secili.id}.json`;
                      bag.click();
                      URL.revokeObjectURL(bag.href);
                      bildir.basari('KVKK veri dışa aktarımı hazır');
                    }}
                  >
                    KVKK Dışa Aktar
                  </button>
                )}
              </div>
            </header>

            <div className="mb-3 flex items-end gap-2">
              <Alan etiket="Başlangıç">
                <input type="date" className="alan" value={ekstreBas} onChange={(e) => setEkstreBas(e.target.value)} />
              </Alan>
              <Alan etiket="Bitiş">
                <input type="date" className="alan" value={ekstreBit} onChange={(e) => setEkstreBit(e.target.value)} />
              </Alan>
              {(ekstreBas || ekstreBit) && (
                <button
                  type="button"
                  className="tus-ikincil mb-0.5"
                  onClick={() => {
                    setEkstreBas('');
                    setEkstreBit('');
                  }}
                >
                  Tümü
                </button>
              )}
            </div>

            <div className="kart min-h-0 flex-1 overflow-auto">
              <table className="tablo">
                <thead className="sticky top-0 bg-yuzey">
                  <tr>
                    <th>Tarih</th>
                    <th>İşlem</th>
                    <th className="text-right">Tutar</th>
                    <th className="text-right">Yürüyen bakiye</th>
                  </tr>
                </thead>
                <tbody>
                  {ekstre.map((h) => {
                    // Borcun neyden doğduğu, borcun kendisi kadar önemlidir:
                    // satışa bağlı hareketten fişin kalemlerine inilebilir (§10.7).
                    const satisaBagli = h.belge_tipi === 'SATIS' && Boolean(h.belge_id);
                    /*
                     * Yanlış girilen tahsilat düzeltilebilmeli. Defter
                     * değiştirilemez olduğu için düzeltme SİLME değil ters
                     * kayıttır; buradaki düğme onu başlatır.
                     */
                    const iptalEdilebilir =
                      (h.hareket_tipi === 'TAHSILAT' || h.hareket_tipi === 'ODEME') && !iptalEdilenler.has(h.id);
                    return (
                      <tr
                        key={h.id}
                        className={satisaBagli ? 'cursor-pointer hover:bg-yuzey-2' : ''}
                        onClick={() => satisaBagli && h.belge_id && setSatisDetayi(h.belge_id)}
                      >
                        <td className="text-metin-3">{tarihSaatFormat(h.tarih)}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <span>{h.hareket_tipi}</span>
                            {satisaBagli && <span className="text-xs text-vurgu">fişi gör →</span>}
                            {iptalEdilenler.has(h.id) && <Rozet tur="notr">İptal edildi</Rozet>}
                            {iptalEdilebilir && tahsilatYetkisi && (
                              <button
                                type="button"
                                className="text-xs text-tehlike hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setIptalEdilecek(h);
                                }}
                              >
                                iptal et
                              </button>
                            )}
                          </div>
                          {h.aciklama && <div className="text-xs text-metin-4">{h.aciklama}</div>}
                        </td>
                        <td className={`sayi ${h.tutar > 0 ? 'text-uyari' : 'text-vurgu'}`}>
                          {paraFormat(h.tutar, { simge: false, isaret: true })}
                        </td>
                        <td className="sayi font-semibold">{paraFormat(h.yuruyen_bakiye, { simge: false })}</td>
                      </tr>
                    );
                  })}
                  {ekstre.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        <BosDurum baslik="Hareket yok" />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <CariKartDiyalogu
        cari={kartAcik}
        tip={tip}
        onKapat={() => setKartAcik(null)}
        onKaydedildi={(id) => {
          setKartAcik(null);
          if (id) setSeciliId(id);
          void tumunuTazele();
        }}
      />

      {secili && duzeltmeAcik && (
        <BakiyeDiyalogu
          kip={duzeltmeAcik}
          cari={secili}
          onKapat={() => setDuzeltmeAcik(null)}
          onTamam={async () => {
            setDuzeltmeAcik(null);
            await tumunuTazele();
          }}
        />
      )}

      {secili && (
        <EkstreGonderDiyalogu acik={gonderAcik} cari={secili} isletmeAdi={isletmeAdi} onKapat={() => setGonderAcik(false)} />
      )}

      {secili && (
        <TahsilatDiyalogu
          acik={tahsilatAcik}
          cari={secili}
          onKapat={() => setTahsilatAcik(false)}
          onTamam={async () => {
            setTahsilatAcik(false);
            await tumunuTazele();
          }}
        />
      )}
      <TahsilatIptalDiyalogu
        hareket={iptalEdilecek}
        onKapat={() => setIptalEdilecek(null)}
        onTamam={async () => {
          setIptalEdilecek(null);
          await tumunuTazele();
        }}
      />

      <SatisFisiDiyalogu satisId={satisDetayi} onKapat={() => setSatisDetayi(null)} />
    </div>
  );
}

function OzetKutusu({ etiket, tutar, vurgula = false }: { etiket: string; tutar: Kurus; vurgula?: boolean }) {
  return (
    <div className={`kart px-3 py-2 ${vurgula ? 'border-tehlike-cizgi' : ''}`}>
      <div className="truncate text-[11px] text-metin-4" title={etiket}>
        {etiket}
      </div>
      <div className={`font-mono text-base font-bold ${vurgula ? 'text-tehlike' : 'text-metin'}`}>
        {paraFormat(tutar, { simge: false })}
      </div>
    </div>
  );
}

/**
 * Açılış bakiyesi ve bakiye düzeltmesi — ikisi de aynı defteri düzelten
 * işlemlerdir, farkları hareketin tipi ve nedenin zorunluluğudur.
 */
function BakiyeDiyalogu({
  kip,
  cari,
  onKapat,
  onTamam,
}: {
  kip: 'acilis' | 'duzeltme';
  cari: Cari;
  onKapat: () => void;
  onTamam: () => void;
}) {
  const acilisMi = kip === 'acilis';
  const [tutar, setTutar] = useState<Kurus>(0);
  const [hedef, setHedef] = useState<Kurus>(cari.bakiye);
  const [neden, setNeden] = useState('');
  const [calisiyor, setCalisiyor] = useState(false);

  // Düzeltmede kasiyer farkı değil, olması gereken bakiyeyi bilir; farkı biz buluruz.
  const fark = hedef - cari.bakiye;
  const gecerli = acilisMi ? tutar !== 0 : fark !== 0 && neden.trim().length > 0;

  const gonder = async () => {
    if (!gecerli || calisiyor) return;
    setCalisiyor(true);
    try {
      if (acilisMi) {
        await cagir('cari.acilisBakiyesi', { cariId: cari.id, tutar });
        bildir.basari('Açılış bakiyesi kaydedildi', paraFormat(tutar));
      } else {
        await cagir('cari.bakiyeDuzelt', { cariId: cari.id, fark, neden: neden.trim() });
        bildir.basari('Bakiye düzeltildi', `Yeni bakiye: ${paraFormat(hedef)}`);
      }
      onTamam();
    } catch (hata) {
      hatayiBildir(hata, acilisMi ? 'Açılış bakiyesi' : 'Bakiye düzeltme');
    } finally {
      setCalisiyor(false);
    }
  };

  return (
    <Diyalog
      acik
      baslik={acilisMi ? 'Açılış Bakiyesi' : 'Bakiye Düzeltme'}
      aciklama={
        acilisMi
          ? `${cari.ad_unvan} — devir borcu buraya girilir, tek seferliktir.`
          : `${cari.ad_unvan} — mevcut bakiye ${paraFormat(cari.bakiye)}`
      }
      genislik="dar"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={gonder} disabled={!gecerli || calisiyor}>
            {calisiyor ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {acilisMi ? (
          <Alan etiket="Devir bakiyesi *" ipucu="Müşterinin bize olan borcu artı, bizim ona borcumuz eksi girilir.">
            <ParaAlani deger={tutar} onDegisim={setTutar} sinif="py-3 text-xl" otomatikOdak onEnter={gonder} />
          </Alan>
        ) : (
          <>
            <Alan etiket="Olması gereken bakiye *">
              <ParaAlani deger={hedef} onDegisim={setHedef} sinif="py-3 text-xl" otomatikOdak />
            </Alan>
            <div className="flex items-baseline justify-between rounded bg-yuzey-3 px-4 py-2">
              <span className="text-sm text-metin-2">Yazılacak düzeltme</span>
              <span
                className={`font-mono text-lg font-bold ${fark > 0 ? 'text-uyari' : fark < 0 ? 'text-vurgu' : 'text-metin-4'}`}
              >
                {paraFormat(fark, { isaret: true })}
              </span>
            </div>
            <Alan etiket="Düzeltme nedeni *" ipucu="Denetim izi için zorunludur; ekstrede görünür.">
              <input
                className="alan"
                value={neden}
                onChange={(e) => setNeden(e.target.value)}
                placeholder="Örn. 12.08 tarihli fiş iki kez işlenmiş"
              />
            </Alan>
          </>
        )}
      </div>
    </Diyalog>
  );
}

function CariKartDiyalogu({
  cari,
  tip,
  onKapat,
  onKaydedildi,
}: {
  cari: Cari | 'yeni' | null;
  tip: 'MUSTERI' | 'TEDARIKCI';
  onKapat: () => void;
  onKaydedildi: (id?: string) => void;
}) {
  const yeniMi = cari === 'yeni';
  const mevcut = yeniMi ? null : cari;
  const [form, setForm] = useState({
    ad: '',
    telefon: '',
    eposta: '',
    adres: '',
    vergiNo: '',
    limit: 0 as Kurus,
    vadeGun: 0,
    notlar: '',
    riza: false,
  });

  useEffect(() => {
    if (!cari) return;
    setForm(
      mevcut
        ? {
            ad: mevcut.ad_unvan,
            telefon: mevcut.telefon ?? '',
            eposta: mevcut.eposta ?? '',
            adres: mevcut.adres ?? '',
            vergiNo: mevcut.vergi_no ?? '',
            limit: mevcut.kredi_limiti,
            vadeGun: mevcut.vade_gun,
            notlar: mevcut.notlar ?? '',
            riza: mevcut.iletisim_rizasi,
          }
        : { ad: '', telefon: '', eposta: '', adres: '', vergiNo: '', limit: 0, vadeGun: 0, notlar: '', riza: false },
    );
  }, [cari, mevcut]);

  if (!cari) return null;

  const kaydet = async () => {
    if (!form.ad.trim()) return;
    try {
      const sonuc = await cagir<{ id: string }>('cari.kaydet', {
        id: mevcut?.id,
        tip: mevcut?.tip ?? tip,
        ad_unvan: form.ad.trim(),
        telefon: form.telefon.trim() || null,
        eposta: form.eposta.trim() || null,
        adres: form.adres.trim() || null,
        vergi_no: form.vergiNo.trim() || null,
        kredi_limiti: form.limit,
        vade_gun: form.vadeGun,
        notlar: form.notlar.trim() || null,
        iletisim_rizasi: form.riza,
      });
      bildir.basari(yeniMi ? 'Cari eklendi' : 'Cari güncellendi');
      onKaydedildi(sonuc?.id);
    } catch (hata) {
      hatayiBildir(hata, 'Cari kaydı');
    }
  };

  return (
    <Diyalog
      acik
      baslik={yeniMi ? 'Yeni Cari Hesap' : 'Cari Kartı'}
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={kaydet}>
            Kaydet
          </button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Alan etiket="Ad / Unvan *">
            <input className="alan" value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} data-odak />
          </Alan>
        </div>
        <Alan etiket="Telefon">
          <input className="alan" value={form.telefon} onChange={(e) => setForm({ ...form, telefon: e.target.value })} />
        </Alan>
        <Alan etiket="E-posta">
          <input className="alan" value={form.eposta} onChange={(e) => setForm({ ...form, eposta: e.target.value })} />
        </Alan>
        <Alan etiket="Vergi no">
          <input className="alan" value={form.vergiNo} onChange={(e) => setForm({ ...form, vergiNo: e.target.value })} />
        </Alan>
        <Alan etiket="Vade (gün)">
          <input
            className="alan sayi"
            value={form.vadeGun}
            onChange={(e) => setForm({ ...form, vadeGun: Number(e.target.value) || 0 })}
          />
        </Alan>
        <Alan etiket="Kredi limiti" ipucu="0 = sınırsız">
          <ParaAlani deger={form.limit} onDegisim={(v) => setForm({ ...form, limit: v })} />
        </Alan>
        <div className="md:col-span-2">
          <Alan etiket="Adres">
            <textarea
              className="alan"
              rows={2}
              value={form.adres}
              onChange={(e) => setForm({ ...form, adres: e.target.value })}
            />
          </Alan>
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
        <label className="flex items-start gap-2 text-sm md:col-span-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={form.riza}
            onChange={(e) => setForm({ ...form, riza: e.target.checked })}
          />
          <span>
            SMS / WhatsApp / e-posta gönderimi için <strong>açık rıza</strong> alındı.
            <span className="block text-xs text-metin-4">KVKK gereği rıza olmadan ticari ileti gönderilemez (§16.1).</span>
          </span>
        </label>
      </div>
    </Diyalog>
  );
}

/**
 * Tahsilat iptali (§10.7).
 *
 * Kayıt SİLİNMEZ: aynı tutar ters yönde yazılır. Ekstrede hem yanlış tahsilat
 * hem düzeltmesi görünür — müşteri "ben ödemiştim" dediğinde ikisi de oradadır.
 * Neden zorunludur; sonradan "bu niye iptal olmuş" sorusunun cevabı kayıtta durur.
 */
function TahsilatIptalDiyalogu({
  hareket,
  onKapat,
  onTamam,
}: {
  hareket: EkstreSatiri | null;
  onKapat: () => void;
  onTamam: () => void;
}) {
  const [neden, setNeden] = useState('');
  const [calisiyor, setCalisiyor] = useState(false);

  useEffect(() => {
    if (hareket) setNeden('');
  }, [hareket]);

  if (!hareket) return null;

  const tutar = Math.abs(hareket.tutar);
  const gecerli = neden.trim().length >= 3 && !calisiyor;

  const iptalEt = async () => {
    if (!gecerli) return;
    setCalisiyor(true);
    try {
      const sonuc = await cagir<{ yeniBakiye: Kurus }>('cari.tahsilatIptal', {
        hareketId: hareket.id,
        neden: neden.trim(),
      });
      bildir.basari('Tahsilat iptal edildi', `Yeni bakiye: ${paraFormat(sonuc.yeniBakiye)}`);
      onTamam();
    } catch (hata) {
      hatayiBildir(hata, 'Tahsilat iptali');
    } finally {
      setCalisiyor(false);
    }
  };

  return (
    <Diyalog
      acik
      baslik="Tahsilatı İptal Et"
      aciklama={`${tarihSaatFormat(hareket.tarih)} · ${paraFormat(tutar)}`}
      genislik="dar"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-tehlike" onClick={() => void iptalEt()} disabled={!gecerli}>
            {calisiyor ? 'İptal ediliyor…' : 'İptal Et'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded border border-uyari-cizgi bg-uyari-yumusak px-3 py-2 text-sm">
          Kayıt silinmez; aynı tutar <strong>ters kayıt</strong> olarak yazılır. Borç geri yüklenir.
          {hareket.hareket_tipi === 'TAHSILAT' ? ' Nakit alındıysa kasadan geri çıkar.' : ''}
        </div>
        <Alan etiket="İptal nedeni *" ipucu="En az 3 karakter. Ekstrede ve denetim kaydında görünür.">
          <input
            className="alan"
            value={neden}
            onChange={(e) => setNeden(e.target.value)}
            placeholder="Örn. tutar yanlış girildi"
            data-odak
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && gecerli) {
                e.preventDefault();
                void iptalEt();
              }
            }}
          />
        </Alan>
      </div>
    </Diyalog>
  );
}
