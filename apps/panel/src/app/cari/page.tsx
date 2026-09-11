/**
 * Cari hesaplar — kasadaki Cari ekranının panel karşılığı (§10.7, §11.6).
 *
 * İKİ EKRAN AYNI SİSTEMDİR. Aynı hesapları, aynı yaşlandırma dilimleriyle,
 * aynı işlemlerle gösterirler; farkları yalnız donanıma dokunan yerlerdedir.
 *
 * Panelden yapılan açılış bakiyesi, bakiye düzeltmesi ve tahsilat iptali
 * bulutta HEMEN işlenmez, kasaya TALİMAT olarak yazılır: `cari_hareketler`
 * değiştirilemez bir defterdir ve tek yazıcısı kasadır. Böylece panelden
 * yapılan düzeltme, kasadan yapılanla birebir aynı yoldan geçer — aynı
 * doğrulama, aynı denetim kaydı, aynı ters kayıt mantığı.
 *
 * Tahsilatın KENDİSİ burada yoktur ve olmamalıdır: para fiziksel olarak
 * kasada alınır, aynı anda kasa hareketi doğar.
 */

'use client';

import { useState } from 'react';
import { goreliZaman, paraFormat, paraParse, tarihSaatFormat, type Kurus } from '@market/shared';
import { YaslandirmaGrafigi } from '@/bilesen/grafik';
import { BosDurum, HataKutusu, Kabuk, Modal, ParaKutusu, Rozet, Yukleniyor } from '@/bilesen/kabuk';
import { FisIcerigi, fisBasligi, useFis } from '@/bilesen/fis';
import { api, kullaniciyiOku, uclar } from '@/lib/api';
import { useVeri } from '@/lib/kanca';

interface Cari {
  id: string;
  tip: string;
  ad_unvan: string;
  telefon: string | null;
  eposta: string | null;
  adres: string | null;
  vergi_dairesi: string | null;
  vergi_no: string | null;
  notlar: string | null;
  kredi_limiti: Kurus;
  vade_gun: number;
  aktif_mi: number;
  iletisim_rizasi: number;
  anonimlestirildi_mi?: number;
  bakiye: Kurus;
  son_hareket: string | null;
}

interface YaslandirmaSatiri {
  cari_id: string;
  ad_unvan: string;
  bakiye: Kurus;
  yaslandirma: { dilim: string; tutar: Kurus }[];
}

/** Kasayla AYNI dilimler — iki ekran aynı borcu farklı yaşlandırmasın (§11.6). */
const DILIMLER = ['0-30', '31-60', '61-90', '90+'];

export default function CariSayfasi() {
  const [tip, setTip] = useState<'MUSTERI' | 'TEDARIKCI'>('MUSTERI');
  const [arama, setArama] = useState('');
  /**
   * Seçim KİMLİKLE tutulur, kaydın kopyasıyla değil: düzeltme sonrası liste
   * tazelendiğinde sağdaki başlık kendiliğinden güncellenir. Kopya tutulsaydı
   * bakiye eski kalır, ekran kendiyle çelişirdi.
   */
  const [seciliId, setSeciliId] = useState<string | null>(null);
  const [kartAcik, setKartAcik] = useState<Cari | 'yeni' | null>(null);

  const kullanici = typeof window === 'undefined' ? null : kullaniciyiOku();
  const yoneticiMi = kullanici?.rol === 'ADMIN' || kullanici?.rol === 'MUDUR';
  const sahipMi = kullanici?.rol === 'ADMIN';

  const liste = useVeri<{
    data: Cari[];
    toplamlar: { musteriAlacagi: Kurus; tedarikciBorcu: Kurus };
    has_more: boolean;
  }>(`${uclar.cariler}?tip=${tip}&limit=200`, [tip]);
  const yaslandirma = useVeri<{ data: YaslandirmaSatiri[]; uretim_zamani: string }>(`${uclar.raporCari}?tip=${tip}`, [tip]);

  const kayitlar = (liste.veri?.data ?? []).filter((c) =>
    arama ? c.ad_unvan.toLocaleLowerCase('tr').includes(arama.toLocaleLowerCase('tr')) : true,
  );
  const secili = kayitlar.find((c) => c.id === seciliId) ?? null;

  const genelYaslandirma = DILIMLER.map((dilim) => ({
    dilim,
    tutar: (yaslandirma.veri?.data ?? []).reduce((t, c) => t + (c.yaslandirma.find((y) => y.dilim === dilim)?.tutar ?? 0), 0),
  }));
  const vadesiGecen = genelYaslandirma.slice(1).reduce((t, y) => t + y.tutar, 0);

  // Yaşlandırma satırını cari id'siyle eşle: liste ve rapor ayrı uçlardan gelir.
  const yaslandirmaHaritasi = new Map((yaslandirma.veri?.data ?? []).map((y) => [y.cari_id, y.yaslandirma] as const));
  const vadesiGecenler = new Set(
    (yaslandirma.veri?.data ?? []).filter((y) => y.yaslandirma.slice(1).some((d) => d.tutar > 0)).map((y) => y.cari_id),
  );

  const tumunuTazele = () => {
    liste.tazele();
    yaslandirma.tazele();
  };

  return (
    <Kabuk baslik="Cari Hesap" tazelik={yaslandirma.veri?.uretim_zamani}>
      <div className="space-y-4">
        {/* Tip sekmeleri solda, "Yeni" düğmesi aynı satırın sağ ucunda — kasadaki
            üst satırla birebir aynı yerleşim (Cari.tsx <header>, ml-auto). Kasada
            tek satırlık genişlik sorun değildir (masaüstü); panelde dar ekranda
            taşmasın diye flex-wrap eklendi — mobil-öncelik kısıtı (§brief). */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-cizgi-kuvvetli">
            {(['MUSTERI', 'TEDARIKCI'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTip(t);
                  setSeciliId(null);
                }}
                className={`rounded-lg px-3 py-2 text-sm ${
                  tip === t ? 'bg-vurgu font-medium text-vurgu-uzeri' : 'text-metin-2'
                }`}
              >
                {t === 'MUSTERI' ? 'Müşteri Alacakları' : 'Tedarikçi Borçları'}
              </button>
            ))}
          </div>
          {yoneticiMi && (
            <button type="button" className="tus-birincil ml-auto" onClick={() => setKartAcik('yeni')}>
              Yeni {tip === 'MUSTERI' ? 'Müşteri' : 'Tedarikçi'}
            </button>
          )}
        </div>

        {liste.yukleniyor && !liste.veri ? (
          <Yukleniyor />
        ) : liste.hata ? (
          <HataKutusu mesaj={liste.hata} tekrarDene={liste.tazele} />
        ) : (
          <>
            {/* Kasadaki üç kutunun aynısı; toplamlar sunucudan gelir, ekrandaki
                listeden hesaplanmaz — arama yapınca toplam değişmemelidir.
                Vurgu kasadaki gibi yalnız "Vadesi geçen" kutusunda ve yalnız
                tutar sıfırdan büyükken (Cari.tsx: vurgula=vadesiGecenToplam>0 koşulu). */}
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <ParaKutusu etiket="Müşteri alacağı" tutar={liste.veri?.toplamlar.musteriAlacagi ?? 0} />
              <ParaKutusu etiket="Tedarikçi borcu" tutar={liste.veri?.toplamlar.tedarikciBorcu ?? 0} />
              <ParaKutusu
                etiket="Vadesi geçen (30+ gün)"
                tutar={vadesiGecen}
                alt={vadesiGecen > 0 ? 'Takip gerekebilir' : 'Temiz'}
                vurgulu={vadesiGecen > 0}
              />
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Mobilde tek sütun: hesap seçilince liste yerini ekstreye bırakır. */}
              <section className={`space-y-3 ${secili ? 'hidden lg:block' : ''}`}>
                {/* Arama kasadaki gibi tek başına bir satır (Cari.tsx placeholder'ıyla aynı). */}
                <input
                  className="alan"
                  placeholder="Ad, unvan, telefon…"
                  value={arama}
                  onChange={(e) => setArama(e.target.value)}
                />

                {/* "Hesap Dökümü" başlığı kaldırıldı: kasada liste doğrudan kartın içinde,
                    başlıksız durur. */}
                <div className="kart p-4">
                  {kayitlar.length === 0 ? (
                    <BosDurum
                      baslik="Kayıt yok"
                      aciklama={arama ? 'Arama sonucuna uyan hesap bulunamadı.' : 'Bu türde hesap kaydı bulunmuyor.'}
                    />
                  ) : (
                    // Kasada kart'ın kendisi kaydırma alanıdır (flex-1 min-h-0 overflow-auto),
                    // bu yüzden sticky thead anlamlıdır. Panel sayfa düzeyinde kaydığı için
                    // aynısı Kabuk'un kendi sticky üst çubuğunun arkasında kalırdı; liste bu
                    // yüzden kendi sınırlı kaydırma alanına alınıyor.
                    <div className="tablo-sarmal max-h-[65vh] overflow-y-auto">
                      <table className="tablo">
                        <thead className="sticky top-0 bg-yuzey">
                          <tr>
                            <th className="text-left">Ad / Unvan</th>
                            <th>Bakiye</th>
                            <th>Son hareket</th>
                          </tr>
                        </thead>
                        <tbody>
                          {kayitlar.map((c) => (
                            <tr
                              key={c.id}
                              onClick={() => setSeciliId(c.id)}
                              className={`cursor-pointer ${seciliId === c.id ? 'bg-vurgu-yumusak' : 'hover:bg-yuzey-2'}`}
                            >
                              <td className="text-left">
                                <div className="flex items-center gap-1.5 font-medium">
                                  {vadesiGecenler.has(c.id) && (
                                    <span className="text-tehlike" title="Vadesi geçmiş borcu var">
                                      ●
                                    </span>
                                  )}
                                  <span className="max-w-[180px] truncate">{c.ad_unvan}</span>
                                </div>
                                {c.telefon && <div className="text-xs text-metin-4">{c.telefon}</div>}
                              </td>
                              <td
                                className={`sayi font-semibold ${
                                  c.bakiye > 0 ? 'text-uyari' : c.bakiye < 0 ? 'text-vurgu' : 'text-metin-3'
                                }`}
                              >
                                {paraFormat(c.bakiye, { simge: false })}
                              </td>
                              {/* Son hareket kasadaki gibi tarih-saat; göreli zaman değil (Cari.tsx: tarihSaatFormat). */}
                              <td className="text-xs text-metin-4">{c.son_hareket ? tarihSaatFormat(c.son_hareket) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-metin-4">
                    Ekstre için satıra dokunun. Yaşlandırma, tahsilatların en eski borçtan mahsup edilmesiyle (FIFO) hesaplanır.
                    {liste.veri?.has_more && ' Liste 200 kayıtla sınırlıdır; aramayı daraltın.'}
                  </p>
                </div>
              </section>

              <section className={secili ? '' : 'hidden lg:block'}>
                {!secili ? (
                  <div className="kart flex h-full items-center justify-center p-8">
                    <BosDurum baslik="Hesap seçin" aciklama="Soldaki listeden bir cari seçince ekstresi burada görünür." />
                  </div>
                ) : (
                  <HesapPaneli
                    cari={secili}
                    yaslandirma={yaslandirmaHaritasi.get(secili.id)}
                    yoneticiMi={yoneticiMi}
                    sahipMi={sahipMi}
                    onGeri={() => setSeciliId(null)}
                    onDuzenle={() => setKartAcik(secili)}
                    onDegisti={tumunuTazele}
                  />
                )}
              </section>
            </div>

            {/* Genel yaşlandırma kartı kasada yoktur (oradaki karşılığı listedeki kırmızı
                noktadır); panele özgü bu bilgi silinmiyor, yalnız kasadaki üst yarının
                sırasını bozmamak için liste + ekstre ızgarasının ALTINA iniyor. */}
            {vadesiGecen > 0 && (
              <section className="kart p-4">
                <h2 className="mb-3 font-semibold">Yaşlandırma</h2>
                <YaslandirmaGrafigi dilimler={genelYaslandirma} />
              </section>
            )}

            <p className="text-xs text-metin-4">
              Tahsilat ve ödeme kayıtları kasadan girilir — para fiziksel olarak orada alınır ve aynı anda kasa hareketi oluşur.
              Kişisel verilerin işlenmesi KVKK kapsamındadır; iletişim için açık rıza gerekir.
            </p>
          </>
        )}
      </div>

      {kartAcik && (
        <CariFormu
          cari={kartAcik}
          tip={tip}
          onKapat={() => setKartAcik(null)}
          onKaydedildi={(id) => {
            setKartAcik(null);
            if (id) setSeciliId(id);
            tumunuTazele();
          }}
        />
      )}
    </Kabuk>
  );
}

// ---------------------------------------------------------------------------
// Seçili hesap — ekstre ve işlemler
// ---------------------------------------------------------------------------

interface BekleyenTalimat {
  id: string;
  tip: string;
  tutar: Kurus;
  hedef_hareket_id: string | null;
  neden: string;
  created_at: string;
}

interface EkstreHareketi {
  id: string;
  hareket_tipi: string;
  tutar: Kurus;
  aciklama: string | null;
  tarih: string;
  vade_tarihi: string | null;
  belge_id: string | null;
  belge_tipi: string | null;
  yuruyen_bakiye: Kurus;
}

interface EkstreVerisi {
  cari: Cari | null;
  hareketler: EkstreHareketi[];
  bekleyen_talimatlar: BekleyenTalimat[];
}

const HAREKET_ETIKETI: Record<string, string> = {
  BORC: 'Borç',
  ALACAK: 'Alacak',
  TAHSILAT: 'Tahsilat',
  ODEME: 'Ödeme',
  IADE: 'İade',
  DUZELTME: 'Düzeltme',
  ACILIS: 'Açılış bakiyesi',
};

const TALIMAT_ETIKETI: Record<string, string> = {
  ACILIS: 'Açılış bakiyesi',
  DUZELTME: 'Bakiye düzeltmesi',
  TAHSILAT_IPTAL: 'Tahsilat iptali',
};

function HesapPaneli({
  cari,
  yaslandirma,
  yoneticiMi,
  sahipMi,
  onGeri,
  onDuzenle,
  onDegisti,
}: {
  cari: Cari;
  yaslandirma?: { dilim: string; tutar: Kurus }[];
  yoneticiMi: boolean;
  sahipMi: boolean;
  onGeri: () => void;
  onDuzenle: () => void;
  onDegisti: () => void;
}) {
  const [bas, setBas] = useState('');
  const [bit, setBit] = useState('');
  const [fisId, setFisId] = useState<string | null>(null);
  const [bakiyeKipi, setBakiyeKipi] = useState<'acilis' | 'duzeltme' | null>(null);
  const [iptalEdilecek, setIptalEdilecek] = useState<EkstreHareketi | null>(null);

  const aralik = [bas ? `from=${bas}` : '', bit ? `to=${bit}` : ''].filter(Boolean).join('&');
  const ekstre = useVeri<EkstreVerisi>(`${uclar.cariler}/${cari.id}/ekstre${aralik ? `?${aralik}` : ''}`, [cari.id, bas, bit]);

  const hareketler = ekstre.veri?.hareketler ?? [];
  const bekleyenler = ekstre.veri?.bekleyen_talimatlar ?? [];

  /** Ters kaydı yazılmış tahsilatlar — tekrar iptal edilemesinler. */
  const iptalEdilenler = new Set(
    hareketler.filter((h) => h.belge_tipi === 'TAHSILAT_IPTAL' && h.belge_id).map((h) => h.belge_id as string),
  );
  // Kasaya gitmiş ama henüz uygulanmamış iptaller de düğmeyi kapatmalı.
  const bekleyenIptaller = new Set(
    bekleyenler.filter((t) => t.tip === 'TAHSILAT_IPTAL' && t.hedef_hareket_id).map((t) => t.hedef_hareket_id as string),
  );

  const tazele = () => {
    ekstre.tazele();
    onDegisti();
  };

  const csvIndir = () => {
    const satirlar = ['tarih;islem;aciklama;tutar;yuruyen_bakiye'];
    // CSV eskiden yeniye yazılır: muhasebe ekstresi bu sırayla okunur.
    for (const h of [...hareketler].reverse()) {
      satirlar.push(
        [
          tarihSaatFormat(h.tarih),
          HAREKET_ETIKETI[h.hareket_tipi] ?? h.hareket_tipi,
          h.aciklama ?? '',
          h.tutar,
          h.yuruyen_bakiye,
        ].join(';'),
      );
    }
    dosyaIndir(`ekstre-${cari.ad_unvan}.csv`, '﻿' + satirlar.join('\r\n'), 'text/csv;charset=utf-8');
  };

  const kvkkIndir = async () => {
    const veri = await api<unknown>(`${uclar.cariler}/${cari.id}/kvkk`);
    dosyaIndir(`cari-${cari.id}.json`, JSON.stringify(veri, null, 2), 'application/json');
  };

  return (
    <div className="space-y-3">
      <div className="kart p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button type="button" className="mb-1 text-xs text-vurgu hover:underline lg:hidden" onClick={onGeri}>
              ← Listeye dön
            </button>
            <h2 className="truncate text-lg font-semibold">{cari.ad_unvan}</h2>
            <p className="text-sm text-metin-3">{[cari.telefon, cari.vergi_no].filter(Boolean).join(' · ') || '—'}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-metin-3">Bakiye</p>
            <p className={`sayi text-2xl font-bold ${cari.bakiye > 0 ? 'text-uyari' : 'text-vurgu'}`}>
              {paraFormat(cari.bakiye)}
            </p>
            <p className="text-xs text-metin-4">
              {cari.kredi_limiti > 0 ? `Limit: ${paraFormat(cari.kredi_limiti)}` : 'Limitsiz'}
              {cari.vade_gun > 0 && ` · Vade: ${cari.vade_gun} gün`}
            </p>
          </div>
        </div>

        {yaslandirma && cari.bakiye > 0 && (
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {DILIMLER.map((dilim, i) => {
              const tutar = yaslandirma.find((y) => y.dilim === dilim)?.tutar ?? 0;
              // 61 günü geçmiş borç tahsilat riskidir; gözle ayrılsın (§11.6).
              const riskli = i >= 2 && tutar > 0;
              return (
                <div key={dilim} className={`rounded px-2 py-1.5 text-center ${riskli ? 'bg-tehlike-yumusak' : 'bg-yuzey-2'}`}>
                  <div className="text-[10px] uppercase tracking-wide text-metin-4">{dilim} gün</div>
                  <div className={`sayi text-sm font-semibold ${riskli ? 'text-tehlike' : 'text-metin-2'}`}>
                    {paraFormat(tutar, { simge: false })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {yoneticiMi && (
            <>
              <button type="button" className="tus-ikincil" onClick={onDuzenle}>
                Kartı Düzenle
              </button>
              {/*
                Açılış bakiyesi yalnız hiç hareketi olmayan hesaba açılır:
                hareket görmüş bir hesaba "açılış" yazmak defteri bozar,
                oradaki doğru araç bakiye düzeltmesidir. Kasadaki Cari ekranı
                da tam olarak böyle davranır.
              */}
              {hareketler.length === 0 && !bas && !bit && (
                <button type="button" className="tus-ikincil" onClick={() => setBakiyeKipi('acilis')}>
                  Açılış Bakiyesi
                </button>
              )}
              <button type="button" className="tus-ikincil" onClick={() => setBakiyeKipi('duzeltme')}>
                Bakiye Düzelt
              </button>
            </>
          )}
          <button type="button" className="tus-ikincil" onClick={csvIndir} disabled={hareketler.length === 0}>
            Excel / CSV
          </button>
          {sahipMi && (
            <button type="button" className="tus-ikincil" onClick={() => void kvkkIndir()}>
              KVKK Dışa Aktar
            </button>
          )}
          {cari.iletisim_rizasi === 1 ? <Rozet tur="basari">İletişim rızası var</Rozet> : <Rozet tur="notr">Rıza yok</Rozet>}
        </div>
      </div>

      {bekleyenler.length > 0 && (
        <div className="kart border-uyari-cizgi bg-uyari-yumusak p-3 text-sm">
          <p className="font-medium">Kasada uygulanmayı bekliyor</p>
          <ul className="mt-1 space-y-0.5 text-xs text-metin-2">
            {bekleyenler.map((t) => (
              <li key={t.id}>
                {TALIMAT_ETIKETI[t.tip] ?? t.tip}
                {t.tip !== 'TAHSILAT_IPTAL' && ` · ${paraFormat(t.tutar)}`} — {goreliZaman(t.created_at)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-metin-3">
            Düzeltmeyi kasa yapar: hareketi üreten tek yer orasıdır. Kasa bir sonraki senkronda uygular; kapalıysa açılışta işler.
          </p>
        </div>
      )}

      <div className="kart p-4">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="etiket">Başlangıç</span>
            <input type="date" className="alan" value={bas} onChange={(e) => setBas(e.target.value)} />
          </label>
          <label className="block">
            <span className="etiket">Bitiş</span>
            <input type="date" className="alan" value={bit} onChange={(e) => setBit(e.target.value)} />
          </label>
          {(bas || bit) && (
            <button
              type="button"
              className="tus-ikincil"
              onClick={() => {
                setBas('');
                setBit('');
              }}
            >
              Tümü
            </button>
          )}
        </div>

        {ekstre.yukleniyor && !ekstre.veri ? (
          <Yukleniyor />
        ) : ekstre.hata ? (
          <HataKutusu mesaj={ekstre.hata} tekrarDene={ekstre.tazele} />
        ) : hareketler.length === 0 ? (
          <BosDurum baslik="Hareket yok" aciklama="Seçili aralıkta işlem kaydı bulunmuyor." />
        ) : (
          <div className="tablo-sarmal">
            <table className="tablo">
              <thead>
                <tr>
                  <th className="text-left">Tarih</th>
                  <th>İşlem</th>
                  <th>Tutar</th>
                  <th>Yürüyen bakiye</th>
                </tr>
              </thead>
              <tbody>
                {hareketler.map((h) => {
                  // Borcun neyden doğduğu, borcun kendisi kadar önemlidir:
                  // satışa bağlı hareketten fişin kalemlerine inilebilir (§10.7).
                  const satisaBagli = Boolean(h.belge_id) && h.belge_tipi !== 'TAHSILAT_IPTAL';
                  /*
                   * Yanlış girilen tahsilat düzeltilebilmeli. Defter
                   * değiştirilemez olduğu için düzeltme SİLME değil ters
                   * kayıttır; buradaki düğme kasaya o talimatı yazar.
                   */
                  const iptalEdilebilir =
                    (h.hareket_tipi === 'TAHSILAT' || h.hareket_tipi === 'ODEME') &&
                    !iptalEdilenler.has(h.id) &&
                    !bekleyenIptaller.has(h.id);
                  return (
                    <tr
                      key={h.id}
                      className={satisaBagli ? 'cursor-pointer hover:bg-yuzey-2' : ''}
                      onClick={() => satisaBagli && h.belge_id && setFisId(h.belge_id)}
                    >
                      <td className="whitespace-nowrap text-left text-metin-3">{tarihSaatFormat(h.tarih)}</td>
                      <td>
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{HAREKET_ETIKETI[h.hareket_tipi] ?? h.hareket_tipi}</span>
                          {satisaBagli && <span className="text-xs text-vurgu">fişi gör →</span>}
                          {iptalEdilenler.has(h.id) && <Rozet tur="notr">İptal edildi</Rozet>}
                          {bekleyenIptaller.has(h.id) && <Rozet tur="uyari">İptal bekliyor</Rozet>}
                          {iptalEdilebilir && yoneticiMi && (
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
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-2 text-xs text-metin-4">
          Artı tutar borcu artırır, eksi tutar azaltır. Ekstre en yeni hareketten başlar; CSV dosyası eskiden yeniye sıralıdır.
        </p>
      </div>

      {bakiyeKipi && (
        <BakiyeDiyalogu
          kip={bakiyeKipi}
          cari={cari}
          onKapat={() => setBakiyeKipi(null)}
          onTamam={() => {
            setBakiyeKipi(null);
            tazele();
          }}
        />
      )}

      {iptalEdilecek && (
        <TahsilatIptalDiyalogu
          cari={cari}
          hareket={iptalEdilecek}
          onKapat={() => setIptalEdilecek(null)}
          onTamam={() => {
            setIptalEdilecek(null);
            tazele();
          }}
        />
      )}

      <FisDiyalogu satisId={fisId} onKapat={() => setFisId(null)} />
    </div>
  );
}

/** Tarayıcıda dosya indirir — CSV ve KVKK dışa aktarımı ortak kullanır. */
function dosyaIndir(ad: string, icerik: string, tur: string): void {
  const bag = document.createElement('a');
  bag.href = URL.createObjectURL(new Blob([icerik], { type: tur }));
  bag.download = ad;
  bag.click();
  URL.revokeObjectURL(bag.href);
}

/**
 * Borcun arkasındaki fiş — tablo `bilesen/fis` içinde, iki ekran ortak kullanır.
 */
function FisDiyalogu({ satisId, onKapat }: { satisId: string | null; onKapat: () => void }) {
  const { veri } = useFis(satisId);
  if (!satisId) return null;
  return (
    <Modal baslik={fisBasligi(veri ?? null)} onKapat={onKapat}>
      <FisIcerigi satisId={satisId} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Açılış bakiyesi / bakiye düzeltmesi
// ---------------------------------------------------------------------------

/**
 * Kasadaki `BakiyeDiyalogu`nun aynısı: ikisi de aynı defteri düzelten
 * işlemlerdir, farkları hareketin tipi ve nedenin zorunluluğudur.
 *
 * Düzeltmede kullanıcı FARKI değil, olması gereken bakiyeyi bilir. Hedefi
 * gönderiyoruz; farkı kasa kendi güncel bakiyesine göre hesaplıyor. Panelin
 * gördüğü rakam senkron beklerken bayatlayabildiği için fark burada
 * hesaplansaydı yanlış tabana oturur, sonuç kullanıcının yazdığı sayı olmazdı.
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
  const [tutar, setTutar] = useState(acilisMi ? '' : paraFormat(cari.bakiye, { simge: false }));
  const [neden, setNeden] = useState('');
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const hedef = paraParse(tutar);
  const fark = hedef === null ? 0 : hedef - cari.bakiye;
  const gecerli = acilisMi ? hedef !== null && hedef !== 0 : hedef !== null && fark !== 0 && neden.trim().length >= 3;

  const gonder = async () => {
    if (!gecerli || gonderiliyor) return;
    setGonderiliyor(true);
    setHata(null);
    try {
      await api(uclar.cariTalimatlari, {
        method: 'POST',
        body: JSON.stringify({
          cari_id: cari.id,
          tip: acilisMi ? 'ACILIS' : 'DUZELTME',
          tutar: hedef,
          neden: acilisMi ? neden.trim() || 'Açılış bakiyesi' : neden.trim(),
        }),
      });
      onTamam();
    } catch (h) {
      setHata(h instanceof Error ? h.message : 'Kaydedilemedi.');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Modal
      baslik={acilisMi ? 'Açılış Bakiyesi' : 'Bakiye Düzeltme'}
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil flex-1" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil flex-1" onClick={() => void gonder()} disabled={!gecerli || gonderiliyor}>
            {gonderiliyor ? 'Gönderiliyor…' : 'Kasaya Gönder'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-metin-3">
          {acilisMi
            ? `${cari.ad_unvan} — devir borcu buraya girilir, tek seferliktir.`
            : `${cari.ad_unvan} — panelde görünen bakiye ${paraFormat(cari.bakiye)}`}
        </p>

        <label className="block">
          <span className="etiket">{acilisMi ? 'Devir bakiyesi (₺) *' : 'Olması gereken bakiye (₺) *'}</span>
          <input
            className="alan sayi text-lg"
            inputMode="decimal"
            value={tutar}
            onChange={(e) => setTutar(e.target.value)}
            autoFocus
          />
          <span className="mt-1 block text-xs text-metin-4">
            Müşterinin bize olan borcu artı, bizim ona borcumuz eksi girilir.
          </span>
        </label>

        {!acilisMi && (
          <div className="flex items-baseline justify-between rounded-lg bg-yuzey-2 px-4 py-2">
            <span className="text-sm text-metin-2">Yazılacak düzeltme</span>
            <span className={`sayi text-lg font-bold ${fark > 0 ? 'text-uyari' : fark < 0 ? 'text-vurgu' : 'text-metin-4'}`}>
              {paraFormat(fark, { isaret: true })}
            </span>
          </div>
        )}

        <label className="block">
          <span className="etiket">{acilisMi ? 'Açıklama' : 'Düzeltme nedeni *'}</span>
          <input
            className="alan"
            value={neden}
            onChange={(e) => setNeden(e.target.value)}
            placeholder={acilisMi ? 'Örn. devir bakiyesi' : 'Örn. 12.08 tarihli fiş iki kez işlenmiş'}
          />
          <span className="mt-1 block text-xs text-metin-4">Denetim izi için kayda geçer; ekstrede görünür.</span>
        </label>

        <p className="rounded-lg border border-cizgi bg-yuzey-2 px-3 py-2 text-xs text-metin-3">
          Kayıt kasada oluşur: cari defterinin tek yazıcısı kasadır. Talimat bir sonraki senkronda uygulanır, kasa kapalıysa
          açılışta işlenir. Farkı kasa kendi güncel bakiyesine göre hesaplar.
        </p>

        {hata && <p className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm text-metin">{hata}</p>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Tahsilat iptali
// ---------------------------------------------------------------------------

/**
 * Kayıt SİLİNMEZ: aynı tutar ters yönde yazılır. Ekstrede hem yanlış tahsilat
 * hem düzeltmesi görünür — müşteri "ben ödemiştim" dediğinde ikisi de oradadır.
 * Neden zorunludur; sonradan "bu niye iptal olmuş" sorusunun cevabı kayıtta durur.
 */
function TahsilatIptalDiyalogu({
  cari,
  hareket,
  onKapat,
  onTamam,
}: {
  cari: Cari;
  hareket: EkstreHareketi;
  onKapat: () => void;
  onTamam: () => void;
}) {
  const [neden, setNeden] = useState('');
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const gecerli = neden.trim().length >= 3 && !gonderiliyor;

  const gonder = async () => {
    if (!gecerli) return;
    setGonderiliyor(true);
    setHata(null);
    try {
      await api(uclar.cariTalimatlari, {
        method: 'POST',
        body: JSON.stringify({
          cari_id: cari.id,
          tip: 'TAHSILAT_IPTAL',
          hedef_hareket_id: hareket.id,
          neden: neden.trim(),
        }),
      });
      onTamam();
    } catch (h) {
      setHata(h instanceof Error ? h.message : 'Gönderilemedi.');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Modal
      baslik="Tahsilatı İptal Et"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil flex-1" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-tehlike flex-1" onClick={() => void gonder()} disabled={!gecerli}>
            {gonderiliyor ? 'Gönderiliyor…' : 'Kasaya Gönder'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-metin-3">
          {tarihSaatFormat(hareket.tarih)} · {paraFormat(Math.abs(hareket.tutar))}
        </p>

        <div className="rounded-lg border border-uyari-cizgi bg-uyari-yumusak px-3 py-2 text-sm">
          Kayıt silinmez; aynı tutar <strong>ters kayıt</strong> olarak yazılır. Borç geri yüklenir.
          {hareket.hareket_tipi === 'TAHSILAT' && ' Nakit alındıysa kasadan geri çıkar — bu yüzden açık kasa gerekir.'}
        </div>

        <label className="block">
          <span className="etiket">İptal nedeni *</span>
          <input
            className="alan"
            value={neden}
            onChange={(e) => setNeden(e.target.value)}
            placeholder="Örn. tutar yanlış girildi"
            autoFocus
          />
          <span className="mt-1 block text-xs text-metin-4">En az 3 karakter. Ekstrede ve denetim kaydında görünür.</span>
        </label>

        {hata && <p className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm text-metin">{hata}</p>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Cari kartı
// ---------------------------------------------------------------------------

function CariFormu({
  cari,
  tip,
  onKapat,
  onKaydedildi,
}: {
  cari: Cari | 'yeni';
  tip: 'MUSTERI' | 'TEDARIKCI';
  onKapat: () => void;
  onKaydedildi: (id?: string) => void;
}) {
  const yeniMi = cari === 'yeni';
  const mevcut = yeniMi ? null : cari;

  /*
   * Form MEVCUT değerlerle dolar.
   *
   * Eskiden adres, vergi no, notlar ve KVKK rızası forma hiç gelmiyordu; bir
   * cariyi düzenleyip kaydetmek kasadan girilmiş bu alanları sessizce
   * siliyordu — açık rıza kaydı dahil. Kaydeden kişi neyi kaybettiğini
   * göremiyordu bile.
   */
  const [form, setForm] = useState({
    adUnvan: mevcut?.ad_unvan ?? '',
    telefon: mevcut?.telefon ?? '',
    eposta: mevcut?.eposta ?? '',
    adres: mevcut?.adres ?? '',
    vergiDairesi: mevcut?.vergi_dairesi ?? '',
    vergiNo: mevcut?.vergi_no ?? '',
    notlar: mevcut?.notlar ?? '',
    krediLimiti: mevcut?.kredi_limiti ? paraFormat(mevcut.kredi_limiti, { simge: false }) : '',
    vadeGun: String(mevcut?.vade_gun ?? 0),
    aktif: mevcut ? mevcut.aktif_mi === 1 : true,
    rizaVar: mevcut ? mevcut.iletisim_rizasi === 1 : false,
  });
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const kaydet = async () => {
    if (!form.adUnvan.trim()) {
      setHata('Ad / unvan zorunludur.');
      return;
    }
    setGonderiliyor(true);
    setHata(null);
    try {
      const sonuc = await api<{ id: string }>(uclar.cariler, {
        method: 'POST',
        body: JSON.stringify({
          id: mevcut?.id,
          tip: mevcut?.tip ?? tip,
          ad_unvan: form.adUnvan.trim(),
          telefon: form.telefon.trim() || null,
          eposta: form.eposta.trim() || null,
          adres: form.adres.trim() || null,
          vergi_dairesi: form.vergiDairesi.trim() || null,
          vergi_no: form.vergiNo.trim() || null,
          notlar: form.notlar.trim() || null,
          kredi_limiti: paraParse(form.krediLimiti) ?? 0,
          vade_gun: Number(form.vadeGun) || 0,
          aktif_mi: form.aktif,
          iletisim_rizasi: form.rizaVar,
        }),
      });
      onKaydedildi(sonuc?.id);
    } catch (h) {
      setHata(h instanceof Error ? h.message : 'Kaydedilemedi.');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Modal
      baslik={yeniMi ? `Yeni ${tip === 'MUSTERI' ? 'Müşteri' : 'Tedarikçi'}` : 'Cari Kartı'}
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil flex-1" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil flex-1" onClick={() => void kaydet()} disabled={gonderiliyor}>
            {gonderiliyor ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="etiket">Ad / Unvan *</span>
          <input
            className="alan"
            value={form.adUnvan}
            onChange={(e) => setForm({ ...form, adUnvan: e.target.value })}
            autoFocus
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="etiket">Telefon</span>
            <input
              className="alan"
              inputMode="tel"
              value={form.telefon}
              onChange={(e) => setForm({ ...form, telefon: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="etiket">E-posta</span>
            <input
              className="alan"
              inputMode="email"
              value={form.eposta}
              onChange={(e) => setForm({ ...form, eposta: e.target.value })}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="etiket">Vergi dairesi</span>
            <input
              className="alan"
              value={form.vergiDairesi}
              onChange={(e) => setForm({ ...form, vergiDairesi: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="etiket">Vergi no</span>
            <input className="alan" value={form.vergiNo} onChange={(e) => setForm({ ...form, vergiNo: e.target.value })} />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="etiket">Kredi limiti (₺)</span>
            <input
              className="alan sayi"
              inputMode="decimal"
              value={form.krediLimiti}
              onChange={(e) => setForm({ ...form, krediLimiti: e.target.value })}
            />
            <span className="mt-1 block text-xs text-metin-4">Boş / 0 = sınırsız</span>
          </label>
          <label className="block">
            <span className="etiket">Vade (gün)</span>
            <input
              className="alan sayi"
              inputMode="numeric"
              value={form.vadeGun}
              onChange={(e) => setForm({ ...form, vadeGun: e.target.value })}
            />
          </label>
        </div>

        <label className="block">
          <span className="etiket">Adres</span>
          <textarea className="alan" rows={2} value={form.adres} onChange={(e) => setForm({ ...form, adres: e.target.value })} />
        </label>

        <label className="block">
          <span className="etiket">Notlar</span>
          <textarea
            className="alan"
            rows={2}
            value={form.notlar}
            onChange={(e) => setForm({ ...form, notlar: e.target.value })}
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.aktif} onChange={(e) => setForm({ ...form, aktif: e.target.checked })} />
          Hesap aktif
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={form.rizaVar}
            onChange={(e) => setForm({ ...form, rizaVar: e.target.checked })}
          />
          <span>
            SMS / WhatsApp / e-posta gönderimi için <strong>açık rıza</strong> alındı.
            <span className="mt-0.5 block text-xs text-metin-4">KVKK gereği rıza olmadan ticari ileti gönderilemez (§16.1).</span>
          </span>
        </label>

        {hata && <p className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm text-metin">{hata}</p>}
      </div>
    </Modal>
  );
}
