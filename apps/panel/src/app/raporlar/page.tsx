/**
 * Panel raporları (§11.7) — kasadaki Raporlar ekranının Ürün Performansı,
 * Saatlik Yoğunluk ve İade/İptal sekmelerinin yönetici karşılığı. Rakamlar
 * rollup özet tablolarından okunur: maliyet aralık uzunluğundan bağımsızdır,
 * 90 günlük sorgu da mobil bağlantıda anında döner.
 */

'use client';

import { useState } from 'react';
import { bugun, gunEkle, miktarFormat, paraDuz, paraFormat, tarihSaatFormat, type Kurus } from '@market/shared';
import { AralikSecici, BosDurum, HataKutusu, Kabuk, Kutu, ParaKutusu, Rozet, Yukleniyor } from '@/bilesen/kabuk';
import { CiroOzetiSekmesi, DenetimSekmesi, KasaSekmesi } from '@/bilesen/rapor-sekmeleri';
import { kullaniciyiOku, uclar } from '@/lib/api';
import { useVeri } from '@/lib/kanca';

type Sekme = 'ozet' | 'urun' | 'saatlik' | 'suistimal' | 'kasa' | 'banka' | 'denetim';

/** Her rapor yanıtı hangi aralığa ait olduğunu kendisi söyler. */
interface Aralikli {
  from: string;
  to: string;
  uretim_zamani: string;
}

interface EnCokSatan {
  urun_id: string;
  /** Silinmiş ürün LEFT JOIN ile boş dönebilir. */
  urun_adi: string | null;
  adet: number;
  ciro: Kurus;
  kar: Kurus;
}

interface OluStok {
  urun_id: string;
  ad: string;
  stok: number;
  alis_fiyati: Kurus;
  bagli_sermaye: Kurus;
}

interface UrunRaporu extends Aralikli {
  en_cok_satan: EnCokSatan[];
  /** Kârlılık sırası — kasadaki Ürün Performansı'nda vardı, panelde eksikti. */
  en_karli: EnCokSatan[];
  olu_stok: OluStok[];
}

interface SaatDilimi {
  saat: number;
  ciro: Kurus;
  islem: number;
}

interface SaatlikRapor extends Aralikli {
  data: SaatDilimi[];
}

interface KasiyerSatiri {
  kullanici_id: string;
  kullanici_adi: string;
  satis: number;
  iade: number;
  iptal: number;
  iade_tutari: Kurus;
  iptal_tutari: Kurus;
}

interface BankaRaporu extends Aralikli {
  devir: Kurus;
  bakiye: Kurus;
  komisyon_orani: number;
  ozet: {
    kart_satis: Kurus;
    kart_iade: Kurus;
    tahsilat: Kurus;
    odeme: Kurus;
    komisyon: Kurus;
    aktarim: Kurus;
    tahmini_komisyon: Kurus;
  };
  hareketler: { tarih: string; tur: string; aciklama: string; tutar: Kurus; yuruyen_bakiye: Kurus }[];
}

interface SuistimalRaporu extends Aralikli {
  ciro: Kurus;
  iadeTutari: Kurus;
  iptalTutari: Kurus;
  iadeOrani: number;
  iptalOrani: number;
  kasiyerBazli: KasiyerSatiri[];
}

/** Ekrandaki veri, ait olduğu sekme ile birlikte taşınır — şekil karışması imkânsız olsun. */
type AktifVeri =
  | { sekme: 'urun'; icerik: UrunRaporu }
  | { sekme: 'saatlik'; icerik: SaatlikRapor }
  | { sekme: 'banka'; icerik: BankaRaporu }
  | { sekme: 'suistimal'; icerik: SuistimalRaporu };

/*
 * Sekme adları ve SIRASI kasadaki Raporlar ekranıyla birebir aynıdır (§11.2).
 * Aynı raporun iki üründe farklı adla ve farklı yerde durması, işletme
 * sahibinin aradığını bulamamasına yol açıyordu.
 */
const SEKMELER: { anahtar: Sekme; etiket: string }[] = [
  { anahtar: 'ozet', etiket: 'Ciro Özeti' },
  { anahtar: 'urun', etiket: 'Ürün Performansı' },
  { anahtar: 'saatlik', etiket: 'Saatlik Yoğunluk' },
  { anahtar: 'kasa', etiket: 'Kasa Geçmişi' },
  { anahtar: 'banka', etiket: 'Banka / POS' },
  { anahtar: 'suistimal', etiket: 'İade / İptal' },
  { anahtar: 'denetim', etiket: 'Denetim Logu' },
];

/** Kendi tarih aralığını taşıyan sekmeler; üstteki ortak çubuk onlarda gizlenir. */
const KENDI_ARALIGI = new Set<Sekme>(['ozet', 'kasa', 'denetim']);

const HAZIR_ARALIKLAR = [
  { etiket: 'Bugün', gun: 0 },
  { etiket: '7 gün', gun: 6 },
  { etiket: '30 gün', gun: 29 },
  { etiket: '90 gün', gun: 89 },
];

/** İade/iptal oranı bu yüzdeyi aşınca kutu uyarı rengine döner. */
const ORAN_ESIGI = 5;

/** Beklenmedik yanıt şekli çökme değil boş liste üretmeli. */
function dizi<T>(deger: T[] | null | undefined): T[] {
  return Array.isArray(deger) ? deger : [];
}

/**
 * Yanıtın taşıdığı aralık ekrandakiyle uyuşmuyorsa veri eskidir: sekme
 * kapalıyken tarih değiştirilmiş olabilir, o veri çizilmemelidir.
 */
function aralikUyar<T extends Aralikli>(veri: T | null, baslangic: string, bitis: string): T | null {
  if (!veri) return null;
  // Alanlar beklenmedik şekilde yoksa veriyi elemek kalıcı "yükleniyor" üretir.
  if (typeof veri.from !== 'string' || typeof veri.to !== 'string') return veri;
  return veri.from === baslangic && veri.to === bitis ? veri : null;
}

/** Excel TR `;` ile ayırır; alanda ayraç, tırnak veya satır sonu varsa tırnaklanır. */
function hucre(deger: string | number): string {
  const metin = String(deger);
  return /[";\r\n]/.test(metin) ? `"${metin.replace(/"/g, '""')}"` : metin;
}

/** Excel TR ondalık ayracı virgüldür; `2.5` tarih sanılır. */
function yuzdeCsv(oran: number): string {
  return String(oran).replace('.', ',');
}

/** BOM olmadan Excel dosyayı ANSI sanar ve Türkçe karakterleri bozar. */
function dosyaIndir(dosyaAdi: string, satirlar: string[]): void {
  const bag = document.createElement('a');
  bag.href = URL.createObjectURL(new Blob(['﻿' + satirlar.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  bag.download = dosyaAdi;
  bag.click();
  URL.revokeObjectURL(bag.href);
}

function saatEtiketi(saat: number): string {
  return `${String(saat).padStart(2, '0')}:00`;
}

export default function RaporlarSayfasi() {
  const [sekme, setSekme] = useState<Sekme>('urun');
  const [bitis, setBitis] = useState(bugun());
  const [baslangic, setBaslangic] = useState(gunEkle(bugun(), -29));

  const aralik = `from=${baslangic}&to=${bitis}`;
  // Kapalı sekmenin yolu null: görünmeyen rapor için istek atılmaz.
  const urun = useVeri<UrunRaporu>(sekme === 'urun' ? `${uclar.raporUrun}?${aralik}&limit=50` : null, [sekme, baslangic, bitis]);
  const saatlik = useVeri<SaatlikRapor>(sekme === 'saatlik' ? `${uclar.raporSaatlik}?${aralik}` : null, [
    sekme,
    baslangic,
    bitis,
  ]);
  const suistimal = useVeri<SuistimalRaporu>(sekme === 'suistimal' ? `${uclar.raporSuistimal}?${aralik}` : null, [
    sekme,
    baslangic,
    bitis,
  ]);

  const banka = useVeri<BankaRaporu>(sekme === 'banka' ? `${uclar.raporBanka}?${aralik}` : null, [sekme, baslangic, bitis]);

  const aktif = sekme === 'urun' ? urun : sekme === 'saatlik' ? saatlik : sekme === 'banka' ? banka : suistimal;

  /*
   * Veri, AİT OLDUĞU SEKME ile birlikte tutulur ve yalnız aktif sekmeye aitse
   * çizilir. Sekme değiştiğinde yeni istek başlayana kadar bir render boyunca
   * önceki sekmenin verisi elde kalır; etiket kontrolü olmasa yeni görünüm o
   * veriyle çizilir ve şekil uyuşmazlığı sayfayı beyaz ekrana düşürür —
   * masaüstünde tam olarak bu yaşandı. Eşleşme yoksa `Yukleniyor` gösterilir.
   */
  const urunVerisi = aralikUyar(urun.veri, baslangic, bitis);
  const saatlikVerisi = aralikUyar(saatlik.veri, baslangic, bitis);
  const suistimalVerisi = aralikUyar(suistimal.veri, baslangic, bitis);
  const bankaVerisi = aralikUyar(banka.veri, baslangic, bitis);

  const veri: AktifVeri | null =
    sekme === 'urun' && urunVerisi
      ? { sekme: 'urun', icerik: urunVerisi }
      : sekme === 'saatlik' && saatlikVerisi
        ? { sekme: 'saatlik', icerik: saatlikVerisi }
        : sekme === 'banka' && bankaVerisi
          ? { sekme: 'banka', icerik: bankaVerisi }
          : sekme === 'suistimal' && suistimalVerisi
            ? { sekme: 'suistimal', icerik: suistimalVerisi }
            : null;

  const disaAktar = () => {
    if (!veri) return;
    const satirlar: string[] = [];

    if (veri.sekme === 'urun') {
      satirlar.push('En Çok Satanlar', 'urun;adet;ciro;kar');
      for (const u of dizi(veri.icerik.en_cok_satan)) {
        satirlar.push([hucre(u.urun_adi ?? 'Silinmiş ürün'), miktarFormat(u.adet), paraDuz(u.ciro), paraDuz(u.kar)].join(';'));
      }
      satirlar.push('', 'Ölü Stok', 'urun;stok;bagli_sermaye');
      for (const u of dizi(veri.icerik.olu_stok)) {
        satirlar.push([hucre(u.ad), miktarFormat(u.stok), paraDuz(u.bagli_sermaye)].join(';'));
      }
    } else if (veri.sekme === 'banka') {
      satirlar.push('tarih;tur;aciklama;tutar;bakiye');
      for (const h of dizi(veri.icerik.hareketler)) {
        satirlar.push(
          [h.tarih, BANKA_TUR_ETIKETI[h.tur] ?? h.tur, hucre(h.aciklama), paraDuz(h.tutar), paraDuz(h.yuruyen_bakiye)].join(';'),
        );
      }
    } else if (veri.sekme === 'saatlik') {
      satirlar.push('saat;ciro;islem');
      for (const s of dizi(veri.icerik.data)) {
        satirlar.push([saatEtiketi(s.saat), paraDuz(s.ciro), s.islem].join(';'));
      }
    } else {
      const o = veri.icerik;
      satirlar.push(
        'olcut;deger',
        `Dönem cirosu;${paraDuz(o.ciro)}`,
        `İade tutarı;${paraDuz(o.iadeTutari)}`,
        `İptal tutarı;${paraDuz(o.iptalTutari)}`,
        `İade oranı (%);${yuzdeCsv(o.iadeOrani)}`,
        `İptal oranı (%);${yuzdeCsv(o.iptalOrani)}`,
        '',
        'kasiyer;satis;iade;iptal;iade_tutari;iptal_tutari',
      );
      for (const k of dizi(o.kasiyerBazli)) {
        satirlar.push(
          [hucre(k.kullanici_adi), k.satis, k.iade, k.iptal, paraDuz(k.iade_tutari), paraDuz(k.iptal_tutari)].join(';'),
        );
      }
    }

    dosyaIndir(`rapor-${veri.sekme}-${baslangic}_${bitis}.csv`, satirlar);
  };

  return (
    <Kabuk baslik="Raporlar" tazelik={veri?.icerik.uretim_zamani}>
      <div className="space-y-4">
        {/*
          Sekme çubuğu EN ÜSTTE durur: tarih çubuğu yalnız bazı sekmelerde
          göründüğü için üstündeyken sekme değiştikçe çubuğu aşağı yukarı
          itiyordu. Satışlar menüde kendi sayfasında olduğu için burada yok.
        */}
        <nav className="grid grid-cols-3 gap-1 border-b border-cizgi sm:flex" aria-label="Rapor türü">
          {SEKMELER.map((s) => (
            <button
              key={s.anahtar}
              type="button"
              onClick={() => setSekme(s.anahtar)}
              aria-current={sekme === s.anahtar ? 'page' : undefined}
              className={`px-2 py-2 text-xs leading-tight sm:px-3 sm:text-sm ${
                sekme === s.anahtar ? 'border-b-2 border-vurgu font-medium text-vurgu' : 'text-metin-3 hover:text-metin'
              }`}
            >
              {s.etiket}
            </button>
          ))}
        </nav>

        {/* Ortak tarih çubuğu yalnız aralık alan sekmelerde; diğerleri kendi seçicisini taşır. */}
        {!KENDI_ARALIGI.has(sekme) && (
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
                onDegisim={(bas, bit) => {
                  setBaslangic(bas);
                  setBitis(bit);
                }}
              />
              <button type="button" className="tus-ikincil" onClick={disaAktar} disabled={!veri}>
                Excel / CSV
              </button>
            </div>
          </section>
        )}

        {sekme === 'ozet' ? (
          <CiroOzetiSekmesi />
        ) : sekme === 'kasa' ? (
          <KasaSekmesi />
        ) : sekme === 'denetim' ? (
          <DenetimSekmesi yoneticiMi={kullaniciyiOku()?.rol === 'ADMIN'} />
        ) : aktif.hata ? (
          <HataKutusu mesaj={aktif.hata} tekrarDene={aktif.tazele} />
        ) : veri === null ? (
          <Yukleniyor />
        ) : veri.sekme === 'urun' ? (
          <UrunGorunumu veri={veri.icerik} />
        ) : veri.sekme === 'saatlik' ? (
          <SaatlikGorunum veri={veri.icerik} />
        ) : veri.sekme === 'banka' ? (
          <BankaGorunumu veri={veri.icerik} />
        ) : (
          <SuistimalGorunumu veri={veri.icerik} />
        )}
      </div>
    </Kabuk>
  );
}

// ---------------------------------------------------------------------------
// Ürün Performansı
// ---------------------------------------------------------------------------

function UrunGorunumu({ veri }: { veri: UrunRaporu }) {
  const enCok = dizi(veri.en_cok_satan);
  const enKarli = dizi(veri.en_karli);
  const olu = dizi(veri.olu_stok);

  const listeCiro = enCok.reduce((t, u) => t + u.ciro, 0);
  const listeKar = enCok.reduce((t, u) => t + u.kar, 0);
  const bagliSermaye = olu.reduce((t, u) => t + u.bagli_sermaye, 0);
  const marj = listeCiro > 0 ? Math.round((listeKar / listeCiro) * 1000) / 10 : 0;

  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ParaKutusu etiket="Listelenen ciro" tutar={listeCiro} alt={`${enCok.length} ürün`} vurgulu />
        <ParaKutusu etiket="Brüt kâr" tutar={listeKar} alt={`Marj %${marj}`} />
        <Kutu etiket="Ölü stok kalemi" deger={String(olu.length)} alt="Dönemde hiç satılmadı" uyari={olu.length > 0} />
        <ParaKutusu etiket="Bağlı sermaye" tutar={bagliSermaye} alt="Ölü stokta duran" />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="kart p-4">
          <h2 className="mb-3 font-semibold">En Çok Satanlar</h2>
          {enCok.length === 0 ? (
            <BosDurum baslik="Bu aralıkta satış yok" aciklama="Tarih aralığını genişletmeyi deneyin." />
          ) : (
            <div className="tablo-sarmal">
              <table className="tablo">
                <thead>
                  <tr>
                    <th>Ürün</th>
                    <th>Adet</th>
                    <th>Ciro</th>
                    <th>Kâr</th>
                  </tr>
                </thead>
                <tbody>
                  {enCok.map((u) => (
                    <tr key={u.urun_id}>
                      <td>{u.urun_adi ?? <span className="text-metin-4">Silinmiş ürün</span>}</td>
                      <td className="sayi">{miktarFormat(u.adet)}</td>
                      <td className="sayi">{paraFormat(u.ciro, { simge: false })}</td>
                      <td className="sayi text-vurgu">{paraFormat(u.kar, { simge: false })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/*
          EN KÂRLI ayrı bir listedir: çok satan ürün her zaman kazandıran ürün
          değildir. İşletme sahibinin asıl baktığı sıralama budur.
        */}
        <section className="kart p-4">
          <h2 className="mb-1 font-semibold">En Kârlılar</h2>
          <p className="mb-3 text-xs text-metin-4">Brüt kâra göre sıralı; ciroya göre değil.</p>
          {enKarli.length === 0 ? (
            <BosDurum baslik="Bu aralıkta satış yok" />
          ) : (
            <div className="tablo-sarmal">
              <table className="tablo">
                <thead>
                  <tr>
                    <th>Ürün</th>
                    <th>Adet</th>
                    <th>Kâr</th>
                    <th>Marj</th>
                  </tr>
                </thead>
                <tbody>
                  {enKarli.map((u) => (
                    <tr key={u.urun_id}>
                      <td>{u.urun_adi ?? <span className="text-metin-4">Silinmiş ürün</span>}</td>
                      <td className="sayi">{miktarFormat(u.adet)}</td>
                      <td className="sayi text-vurgu">{paraFormat(u.kar, { simge: false })}</td>
                      <td className="sayi text-metin-3">{u.ciro > 0 ? `%${Math.round((u.kar / u.ciro) * 1000) / 10}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="kart p-4">
          <h2 className="mb-1 font-semibold">Ölü Stok</h2>
          <p className="mb-3 text-xs text-metin-4">Seçili dönemde hiç satılmayan, stoğu olan ürünler.</p>
          {olu.length === 0 ? (
            <BosDurum baslik="Ölü stok yok" aciklama="Stoktaki her ürün bu dönemde en az bir kez satıldı." />
          ) : (
            <div className="tablo-sarmal">
              <table className="tablo">
                <thead>
                  <tr>
                    <th>Ürün</th>
                    <th>Stok</th>
                    <th>Bağlı sermaye</th>
                  </tr>
                </thead>
                <tbody>
                  {olu.map((u) => (
                    <tr key={u.urun_id}>
                      <td>{u.ad}</td>
                      <td className="sayi">{miktarFormat(u.stok)}</td>
                      <td className="sayi text-uyari">{paraFormat(u.bagli_sermaye, { simge: false })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Saatlik Yoğunluk
// ---------------------------------------------------------------------------

function SaatlikGorunum({ veri }: { veri: SaatlikRapor }) {
  const saatler = dizi(veri.data);
  const dolu = saatler.filter((s) => s.ciro > 0 || s.islem > 0);

  const toplamCiro = saatler.reduce((t, s) => t + s.ciro, 0);
  const toplamIslem = saatler.reduce((t, s) => t + s.islem, 0);

  if (dolu.length === 0) {
    return (
      <section className="kart p-4">
        <BosDurum baslik="Bu aralıkta satış yok" aciklama="Personel planlaması için daha geniş bir aralık seçin." />
      </section>
    );
  }

  const zirve = dolu.reduce((en, s) => (s.ciro > en.ciro ? s : en));
  // Payda asla sıfır olamaz: `dolu` boş değilse en az bir saatte ciro vardır.
  const enYuksek = Math.max(1, zirve.ciro);

  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kutu etiket="En yoğun saat" deger={saatEtiketi(zirve.saat)} alt={paraFormat(zirve.ciro)} vurgulu />
        <ParaKutusu etiket="Toplam ciro" tutar={toplamCiro} alt={`${dolu.length} saat dilimi`} />
        <Kutu etiket="İşlem" deger={String(toplamIslem)} alt="Dönem toplamı" />
        <ParaKutusu
          etiket="Ortalama sepet"
          tutar={toplamIslem > 0 ? Math.round(toplamCiro / toplamIslem) : 0}
          alt="İşlem başına"
        />
      </section>

      <section className="kart p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Saatlik Yoğunluk</h2>
          <Rozet tur="bilgi">En yoğun {saatEtiketi(zirve.saat)}</Rozet>
        </div>

        <div className="space-y-1">
          {dolu.map((s) => (
            <div
              key={s.saat}
              className={`flex items-center gap-2 rounded px-1.5 py-1 ${s.saat === zirve.saat ? 'bg-vurgu-yumusak' : ''}`}
            >
              <span className="w-11 shrink-0 font-mono text-xs text-metin-3">{saatEtiketi(s.saat)}</span>
              <div className="h-5 min-w-0 flex-1 overflow-hidden rounded bg-yuzey-2">
                <div className="h-full rounded bg-vurgu" style={{ width: `${(s.ciro / enYuksek) * 100}%` }} />
              </div>
              <span className="w-20 shrink-0 text-right font-mono text-xs sm:w-24">{paraFormat(s.ciro, { simge: false })}</span>
              <span className="w-10 shrink-0 text-right text-xs text-metin-4 sm:w-16">
                {s.islem}
                <span className="hidden sm:inline"> işlem</span>
              </span>
            </div>
          ))}
        </div>

        <p className="mt-3 text-xs text-metin-4">Satışı olmayan saatler listelenmez. Barlar en yoğun saate orantılıdır.</p>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// İade / İptal
// ---------------------------------------------------------------------------

function SuistimalGorunumu({ veri }: { veri: SuistimalRaporu }) {
  const kasiyerler = dizi(veri.kasiyerBazli);

  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kutu
          etiket="İade oranı"
          deger={`%${veri.iadeOrani}`}
          alt={paraFormat(veri.iadeTutari)}
          uyari={veri.iadeOrani >= ORAN_ESIGI}
        />
        <Kutu
          etiket="İptal oranı"
          deger={`%${veri.iptalOrani}`}
          alt={paraFormat(veri.iptalTutari)}
          uyari={veri.iptalOrani >= ORAN_ESIGI}
        />
        <ParaKutusu etiket="Dönem cirosu" tutar={veri.ciro} alt="Oranların paydası" vurgulu />
        <Kutu etiket="Kasiyer" deger={String(kasiyerler.length)} alt="Dönemde işlem yapan" />
      </section>

      <section className="kart p-4">
        <h2 className="mb-3 font-semibold">Kasiyer Bazlı Döküm</h2>
        {kasiyerler.length === 0 ? (
          <BosDurum baslik="Bu aralıkta işlem yok" />
        ) : (
          <div className="tablo-sarmal">
            <table className="tablo">
              <thead>
                <tr>
                  <th>Kasiyer</th>
                  <th>Satış</th>
                  <th>İade</th>
                  <th>İptal</th>
                  <th>İade tutarı</th>
                  <th>İptal tutarı</th>
                </tr>
              </thead>
              <tbody>
                {kasiyerler.map((k) => (
                  <tr key={k.kullanici_id}>
                    <td>{k.kullanici_adi}</td>
                    <td className="sayi">{k.satis}</td>
                    <td className="sayi text-uyari">{k.iade}</td>
                    <td className="sayi text-tehlike">{k.iptal}</td>
                    <td className="sayi text-uyari">{paraFormat(k.iade_tutari, { simge: false })}</td>
                    <td className="sayi text-tehlike">{paraFormat(k.iptal_tutari, { simge: false })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 rounded-lg border border-bilgi-cizgi bg-bilgi-yumusak px-3 py-2 text-xs text-metin-2">
          Yüksek iade/iptal oranı bir suistimal göstergesi <strong>olabilir</strong>, tek başına kanıt değildir. Yanlış okutulan
          barkod, vazgeçen müşteri veya bozuk ürün de bu sayıları yükseltir. Şüphelenilen kayıtları fiş detaylarıyla birlikte
          değerlendirin.
        </p>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Banka / POS
// ---------------------------------------------------------------------------

const BANKA_TUR_ETIKETI: Record<string, string> = {
  KART_SATIS: 'Kart satış',
  KART_IADE: 'Karta iade',
  KART_TAHSILAT: 'Kart/havale tahsilat',
  KART_ODEME: 'Kart/havale ödeme',
  IPTAL: 'İptal (karta/hesaba)',
  ACILIS: 'Açılış bakiyesi',
  KOMISYON: 'Banka/POS kesintisi',
  BANKADAN_KASAYA: 'Bankadan kasaya',
  KASADAN_BANKAYA: 'Kasadan bankaya',
  DUZELTME: 'Düzeltme',
};

/** Kasadaki Banka / POS sekmesinin panel karşılığı; hareket ekleme kasadan yapılır. */
function BankaGorunumu({ veri }: { veri: BankaRaporu }) {
  const hareketler = dizi(veri.hareketler);
  const netKart = veri.ozet.kart_satis + veri.ozet.kart_iade;
  return (
    <>
      <p className="rounded-lg border border-uyari-cizgi bg-uyari-yumusak px-3 py-2 text-sm text-metin-2">
        <strong>Bu bakiye tahminidir.</strong> POS&apos;tan çekilen tutar bankaya genellikle birkaç gün sonra ve banka kesintisi
        düşülerek geçer; program bankanıza bağlı değildir. Ay sonunda banka ekstresiyle karşılaştırın; gerçek kesinti ve farklar
        kasadan (Raporlar → Banka / POS → Hareket Ekle) girilir.
      </p>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ParaKutusu etiket="Banka / POS bakiyesi" tutar={veri.bakiye} alt="Olması gereken" vurgulu />
        <ParaKutusu etiket="Net kart satışı" tutar={netKart} alt={`İade: ${paraFormat(-veri.ozet.kart_iade)}`} />
        <ParaKutusu etiket="Kart/havale tahsilat" tutar={veri.ozet.tahsilat} />
        <ParaKutusu etiket="Kart/havale ödeme" tutar={-veri.ozet.odeme} alt="Tedarikçilere" />
      </section>

      <section className="kart p-4 text-sm">
        Tahmini kesinti (%{veri.komisyon_orani.toLocaleString('tr-TR')} × net kart satışı):{' '}
        <strong className="font-mono">{paraFormat(veri.ozet.tahmini_komisyon)}</strong>
        <span className="ml-3 text-metin-3">
          Girilen gerçek kesinti: <strong className="font-mono">{paraFormat(-veri.ozet.komisyon)}</strong>
        </span>
        <p className="mt-1 text-xs text-metin-4">Oran kasadaki Banka / POS sekmesinden ayarlanır.</p>
      </section>

      <section className="kart p-4">
        {hareketler.length === 0 && veri.devir === 0 ? (
          <BosDurum baslik="Bu aralıkta kart/havale hareketi yok" />
        ) : (
          <div className="tablo-sarmal">
            <table className="tablo">
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Tür</th>
                  <th className="text-left">Açıklama</th>
                  <th className="text-right">Tutar</th>
                  <th className="text-right">Bakiye</th>
                </tr>
              </thead>
              <tbody>
                {veri.devir !== 0 && (
                  <tr>
                    <td className="text-metin-3">—</td>
                    <td colSpan={3} className="text-left text-metin-3">
                      Önceki dönemden devir
                    </td>
                    <td className="sayi text-right font-semibold">{paraFormat(veri.devir, { simge: false })}</td>
                  </tr>
                )}
                {[...hareketler].reverse().map((h, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap text-metin-3">{tarihSaatFormat(h.tarih)}</td>
                    <td>{BANKA_TUR_ETIKETI[h.tur] ?? h.tur}</td>
                    <td className="text-left text-metin-3">{h.aciklama}</td>
                    <td className={`sayi text-right ${h.tutar < 0 ? 'text-tehlike' : 'text-vurgu'}`}>
                      {paraFormat(h.tutar, { simge: false, isaret: true })}
                    </td>
                    <td className="sayi text-right font-semibold">{paraFormat(h.yuruyen_bakiye, { simge: false })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
