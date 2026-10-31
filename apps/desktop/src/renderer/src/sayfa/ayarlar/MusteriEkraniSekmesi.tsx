/**
 * Ayarlar → Müşteri Ekranı.
 *
 * Solda ayarlar, sağda CANLI önizleme: önizleme müşteri penceresinin ta
 * kendisi olan bileşenlerle çizilir, yani burada görünen müşteride görünür.
 * Değişiklikler diğer ayarlar gibi üstteki "Kaydet" ile uygulanır; yüklenen
 * görsel/video dosyası kaydedilmeden kullanılmazsa sonraki kayıtta silinir.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  EKRAN_SECIMI,
  kontrastOrani,
  MUSTERI_HAZIR_TEMALARI,
  MUSTERI_YAZI_TIPLERI,
  musteriTemasiCoz,
  type MusteriTemaAdi,
  type MusteriTemasi,
  type MusteriYaziTipi,
  MAKS_SLAYT,
  MUSTERI_EKRANI_AYAR,
  MUSTERI_EKRANI_VARSAYILAN,
  SLAYT_TEMA_ETIKETI,
  SLAYT_TEMASI,
  SLAYT_TIP_ETIKETI,
  slaytlariDogrula,
  uuid,
  varsayilanSlaytlar,
  type EkranDurumu,
  type MusteriEkraniDurumu,
  type MusteriEkraniYapilandirmasi,
  type MusteriSepeti,
  type MusteriSlayti,
  type SlaytTemasi,
  type SlaytTipi,
} from '@market/shared';
import { Alan, Rozet } from '../../bilesen/temel';
import { UrunSecici } from '../../bilesen/UrunSecici';
import { hatayiBildir } from '../../durum/bildirim';
import { cagir, cagirGuvenli } from '../../kopru';
import { musteriKokStili, MusteriEkraniGorunumu, SlaytGorunumu, TEMA_STILI, Yayin } from '../../musteri/MusteriEkrani';

type Ayarla = (anahtar: string, deger: string) => void;
type Onizleme = { tur: 'YAYIN' } | { tur: 'SLAYT'; id: string } | { tur: 'SEPET' } | { tur: 'TESEKKUR' };

const A = MUSTERI_EKRANI_AYAR;

/**
 * Düzenleme sırasında liste geçici olarak geçersiz olabilir (başlığı henüz
 * yazılmamış duyuru). Şemayla okunsaydı liste o an varsayılana düşer ve
 * kullanıcının yaptığı her şey ekrandan silinirdi; burada gevşek okunur,
 * doğrulama ayrı gösterilir ve kayıtta ana süreç kesin denetler.
 */
function listeyiOku(json: string | undefined): MusteriSlayti[] {
  if (!json || !json.trim()) return varsayilanSlaytlar();
  try {
    const ham: unknown = JSON.parse(json);
    return Array.isArray(ham) ? (ham as MusteriSlayti[]) : varsayilanSlaytlar();
  } catch {
    return varsayilanSlaytlar();
  }
}

export function MusteriEkraniSekmesi({ ayarlar, ayarla }: { ayarlar: Record<string, string>; ayarla: Ayarla }) {
  const slaytlar = useMemo(() => listeyiOku(ayarlar[A.SLAYTLAR]), [ayarlar]);
  const listeYaz = (liste: MusteriSlayti[]) => ayarla(A.SLAYTLAR, JSON.stringify(liste));
  const dogrulama = useMemo(() => slaytlariDogrula(JSON.stringify(slaytlar)), [slaytlar]);

  const [onizleme, setOnizleme] = useState<Onizleme>({ tur: 'YAYIN' });
  const yapilandirma = useOnizlemeYapilandirmasi(ayarlar);

  const guncelle = (id: string, alanlar: Partial<MusteriSlayti>) =>
    listeYaz(slaytlar.map((s) => (s.id === id ? ({ ...s, ...alanlar } as MusteriSlayti) : s)));
  const tasi = (i: number, yon: -1 | 1) => {
    const j = i + yon;
    if (j < 0 || j >= slaytlar.length) return;
    const yeni = [...slaytlar];
    [yeni[i], yeni[j]] = [yeni[j]!, yeni[i]!];
    listeYaz(yeni);
  };
  const sil = (id: string) => {
    listeYaz(slaytlar.filter((s) => s.id !== id));
    if (onizleme.tur === 'SLAYT' && onizleme.id === id) setOnizleme({ tur: 'YAYIN' });
  };
  const ekle = (slayt: MusteriSlayti) => {
    listeYaz([...slaytlar, slayt]);
    setOnizleme({ tur: 'SLAYT', id: slayt.id });
  };

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <div className="grid gap-5 xl:max-w-2xl xl:flex-1">
        <EkranBolumu ayarlar={ayarlar} ayarla={ayarla} />

        <TemaBolumu ayarlar={ayarlar} ayarla={ayarla} onOnizle={() => setOnizleme({ tur: 'SEPET' })} />

        <Bolum baslik="Karşılama ekranı" aciklama="Kasada müşteri yokken görünür. Market adı İşletme sekmesinden gelir.">
          <Alan etiket="Karşılama yazısı">
            <input
              className="alan"
              maxLength={60}
              placeholder={MUSTERI_EKRANI_VARSAYILAN.KARSILAMA_METNI}
              value={ayarlar[A.KARSILAMA_METNI] ?? MUSTERI_EKRANI_VARSAYILAN.KARSILAMA_METNI}
              onChange={(e) => ayarla(A.KARSILAMA_METNI, e.target.value)}
            />
          </Alan>
          <Alan etiket="Alt yazı" ipucu="İsteğe bağlı. Örn. çalışma saatleri ya da telefonla sipariş numarası.">
            <input
              className="alan"
              maxLength={120}
              placeholder="Her gün 07:00 – 23:00 açığız"
              value={ayarlar[A.KARSILAMA_ALT_METNI] ?? ''}
              onChange={(e) => ayarla(A.KARSILAMA_ALT_METNI, e.target.value)}
            />
          </Alan>
          <LogoAlani
            logo={ayarlar[A.LOGO] ?? ''}
            logoUrl={yapilandirma?.logoUrl ?? null}
            onDegis={(dosya) => {
              ayarla(A.LOGO, dosya);
              setOnizleme({ tur: 'SLAYT', id: slaytlar.find((s) => s.tip === 'KARSILAMA')?.id ?? '' });
            }}
          />
        </Bolum>

        <Bolum baslik="Teşekkür ekranı" aciklama="Satış bitince ödenen tutar ve para üstüyle birlikte birkaç saniye görünür.">
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <Alan etiket="Teşekkür yazısı">
              <input
                className="alan"
                maxLength={120}
                value={ayarlar[A.TESEKKUR_METNI] ?? MUSTERI_EKRANI_VARSAYILAN.TESEKKUR_METNI}
                onChange={(e) => ayarla(A.TESEKKUR_METNI, e.target.value)}
                onFocus={() => setOnizleme({ tur: 'TESEKKUR' })}
              />
            </Alan>
            <Alan etiket="Süre (saniye)">
              <input
                className="alan sayi"
                type="number"
                min={2}
                max={30}
                value={ayarlar[A.TESEKKUR_SN] ?? String(MUSTERI_EKRANI_VARSAYILAN.TESEKKUR_SN)}
                onChange={(e) => ayarla(A.TESEKKUR_SN, e.target.value)}
                onFocus={() => setOnizleme({ tur: 'TESEKKUR' })}
              />
            </Alan>
          </div>
        </Bolum>

        <Bolum
          baslik="Bekleme ekranı yayın listesi"
          aciklama="Müşteri yokken yukarıdan aşağıya sırayla döner. İlk ürün okutulunca kesilir, satış bitince kaldığı yerden devam eder."
        >
          <SlaytEkleCubugu slaytlar={slaytlar} onEkle={ekle} />

          {!dogrulama.gecerli && (
            <p className="rounded border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm text-tehlike">
              Kaydetmeden önce düzeltin: {dogrulama.mesaj.replace('Müşteri ekranı yayın listesi geçersiz: ', '')}
            </p>
          )}

          {slaytlar.length === 0 ? (
            <p className="rounded border border-dashed border-cizgi px-3 py-6 text-center text-sm text-metin-3">
              Liste boş. Müşteri yokken yalnız karşılama ekranı görünür.
            </p>
          ) : (
            <ol className="grid gap-2">
              {slaytlar.map((s, i) => (
                <SlaytSatiri
                  key={s.id}
                  slayt={s}
                  sira={i}
                  toplam={slaytlar.length}
                  secili={onizleme.tur === 'SLAYT' && onizleme.id === s.id}
                  yapilandirma={yapilandirma}
                  onSec={() => setOnizleme({ tur: 'SLAYT', id: s.id })}
                  onGuncelle={(alanlar) => guncelle(s.id, alanlar)}
                  onTasi={(yon) => tasi(i, yon)}
                  onSil={() => sil(s.id)}
                />
              ))}
            </ol>
          )}
        </Bolum>
      </div>

      <OnizlemePaneli onizleme={onizleme} setOnizleme={setOnizleme} yapilandirma={yapilandirma} />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Müşteri ekranının genel görünümü: hazır temalardan biri ya da özel renkler.
 * Duyuru ve fiyat kartı slaytlarının kendi renk seçimi ayrıdır.
 */
function TemaBolumu({ ayarlar, ayarla, onOnizle }: { ayarlar: Record<string, string>; ayarla: Ayarla; onOnizle: () => void }) {
  const tema = musteriTemasiCoz(ayarlar[A.TEMA]);
  const yaz = (t: MusteriTemasi) => {
    ayarla(A.TEMA, JSON.stringify(t));
    onOnizle();
  };
  const yaziKontrasti = kontrastOrani(tema.metin, tema.zemin);
  const vurguKontrasti = kontrastOrani(tema.vurgu, tema.zemin);

  const ornek = (ad: MusteriTemaAdi, renk: { zemin: string; metin: string; vurgu: string }, etiket: string, aciklama: string) => {
    const secili = tema.ad === ad;
    return (
      <button
        key={ad}
        type="button"
        onClick={() =>
          // Hazır temaya geçerken renkleri de yazılır: sonra "Özel"e geçilince buradan devam edilir.
          yaz({ ...tema, ad, zemin: renk.zemin, metin: renk.metin, vurgu: renk.vurgu })
        }
        className={`overflow-hidden rounded-lg border text-left ${secili ? 'border-vurgu ring-2 ring-vurgu/40' : 'border-cizgi hover:border-cizgi-kuvvetli'}`}
      >
        <div className="flex h-16 flex-col justify-end px-3 pb-2" style={{ background: renk.zemin, color: renk.metin }}>
          <span className="text-[10px] uppercase tracking-[0.2em]" style={{ opacity: 0.55 }}>
            Toplam
          </span>
          <span className="text-lg font-semibold tabular-nums" style={{ color: renk.vurgu }}>
            107,10 ₺
          </span>
        </div>
        <div className="bg-yuzey px-3 py-1.5">
          <span className="block text-sm font-medium">{etiket}</span>
          <span className="block text-xs text-metin-3">{aciklama}</span>
        </div>
      </button>
    );
  };

  return (
    <Bolum
      baslik="Görünüm"
      aciklama="Karşılama, sepet ve teşekkür ekranının renkleri. Duyuru ve fiyat kartlarının rengi her slaytta ayrıca seçilir."
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {(Object.keys(MUSTERI_HAZIR_TEMALARI) as Exclude<MusteriTemaAdi, 'OZEL'>[]).map((ad) => {
          const h = MUSTERI_HAZIR_TEMALARI[ad];
          return ornek(ad, h, h.etiket, h.aciklama);
        })}
        {ornek('OZEL', tema.ad === 'OZEL' ? tema : MUSTERI_HAZIR_TEMALARI.SAMPANYA, 'Özel', 'Kendi renkleriniz')}
      </div>

      {tema.ad === 'OZEL' && (
        <div className="grid gap-3 rounded-lg border border-cizgi bg-yuzey-2 p-3">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['zemin', 'Zemin'],
                ['metin', 'Yazı'],
                ['vurgu', 'Vurgu (fiyat)'],
              ] as const
            ).map(([alan, etiket]) => (
              <label key={alan} className="flex items-center gap-2 rounded-md border border-cizgi bg-yuzey p-2">
                <input
                  id={`musteri-tema-${alan}`}
                  type="color"
                  className="h-9 w-10 cursor-pointer rounded border border-cizgi bg-transparent p-0.5"
                  value={tema[alan]}
                  onChange={(e) => yaz({ ...tema, [alan]: e.target.value })}
                />
                <span className="min-w-0">
                  <span className="block text-sm">{etiket}</span>
                  <span className="block font-mono text-[11px] text-metin-3">{tema[alan]}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-metin-3">Okunurluk:</span>
            <Rozet tur={yaziKontrasti >= 4.5 ? 'basari' : 'tehlike'}>Yazı / zemin {yaziKontrasti.toFixed(1)}</Rozet>
            <Rozet tur={vurguKontrasti >= 3 ? 'basari' : 'uyari'}>Fiyat / zemin {vurguKontrasti.toFixed(1)}</Rozet>
          </div>
          {yaziKontrasti < 4.5 && (
            <p className="text-xs text-tehlike">
              Yazı zemine çok yakın; müşteri uzaktan okuyamaz. Yazıyı açın ya da zemini koyulaştırın.
            </p>
          )}
        </div>
      )}

      <Alan etiket="Yazı tipi">
        <select
          id="musteri-tema-yazi-tipi"
          className="alan"
          value={tema.yaziTipi}
          onChange={(e) => yaz({ ...tema, yaziTipi: e.target.value as MusteriYaziTipi })}
        >
          {(Object.keys(MUSTERI_YAZI_TIPLERI) as MusteriYaziTipi[]).map((k) => (
            <option key={k} value={k}>
              {MUSTERI_YAZI_TIPLERI[k].etiket}
            </option>
          ))}
        </select>
      </Alan>
    </Bolum>
  );
}

function Bolum({ baslik, aciklama, children }: { baslik: string; aciklama?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <div>
        <h2 className="font-semibold">{baslik}</h2>
        {aciklama && <p className="text-xs text-metin-3">{aciklama}</p>}
      </div>
      {children}
    </section>
  );
}

/** Kaydedilmemiş ayarlarla yayın listesini ana süreçte üretir (fiyatlar ve kampanyalar gerçek). */
function useOnizlemeYapilandirmasi(ayarlar: Record<string, string>): MusteriEkraniYapilandirmasi | null {
  const [yapilandirma, setYapilandirma] = useState<MusteriEkraniYapilandirmasi | null>(null);
  const musteriAyarlari = useMemo(
    () =>
      JSON.stringify(
        Object.fromEntries(Object.entries(ayarlar).filter(([k]) => k.startsWith('musteri_ekrani.') || k === 'isletme.ad')),
      ),
    [ayarlar],
  );
  useEffect(() => {
    let iptal = false;
    const t = setTimeout(() => {
      void cagirGuvenli<MusteriEkraniYapilandirmasi>('musteri_ekrani.onizle', { ayarlar: JSON.parse(musteriAyarlari) }).then(
        (sonuc) => {
          if (!iptal && sonuc.veri) setYapilandirma(sonuc.veri);
        },
      );
    }, 250);
    return () => {
      iptal = true;
      clearTimeout(t);
    };
  }, [musteriAyarlari]);
  return yapilandirma;
}

/**
 * Müşteri ekranı AÇ / KAPAT — büyük durum kartı, düğmeler HEMEN uygulanır.
 *
 * Eskiden tek yol küçük bir "Müşteri ekranını kullan" kutusunu işaretleyip
 * Kaydet'e basmaktı; kutu gözden kaçıyor, ayar açıkken ikinci monitör takılı
 * değilse ekran hiç açılmıyor ve neden açılmadığı anlaşılmıyordu. Artık kart ne
 * olduğunu söyler; ikinci ekran yoksa kasa ekranında pencere olarak açılabilir.
 */
function EkranBolumu({ ayarlar, ayarla }: { ayarlar: Record<string, string>; ayarla: Ayarla }) {
  const [durum, setDurum] = useState<MusteriEkraniDurumu | null>(null);
  const [mesgul, setMesgul] = useState(false);
  useEffect(() => {
    const yenile = () => void cagirGuvenli<MusteriEkraniDurumu>('musteri_ekrani.durum').then((s) => s.veri && setDurum(s.veri));
    yenile();
    // Kablo takılıp çıkarıldıktan sonra durum kendiliğinden yenilensin.
    const t = setInterval(yenile, 3_000);
    return () => clearInterval(t);
  }, []);

  const secim = ayarlar[A.EKRAN] || EKRAN_SECIMI.OTOMATIK;
  const ekranlar = durum?.ekranlar ?? [];
  const ikinciEkranVar = ekranlar.length >= 2;
  const bilinmeyenSecim =
    secim !== EKRAN_SECIMI.OTOMATIK && secim !== EKRAN_SECIMI.PENCERE && !ekranlar.some((e) => e.id === secim);

  /** Hemen uygular; sayfadaki ayar kopyası da güncellenir ki sonraki Kaydet geri almasın. */
  const uygula = async (acik: boolean, ekran?: string) => {
    setMesgul(true);
    try {
      const yeni = await cagir<MusteriEkraniDurumu>('musteri_ekrani.ayarla', { acik, ekran });
      ayarla(A.ACIK, acik ? '1' : '0');
      if (ekran) ayarla(A.EKRAN, ekran);
      setDurum(yeni);
    } catch (hata) {
      hatayiBildir(hata, 'Müşteri ekranı');
    } finally {
      setMesgul(false);
    }
  };

  const acikMi = durum?.acik ?? (ayarlar[A.ACIK] ?? '0') === '1';
  const pencereAcik = durum?.pencereAcik ?? false;
  const denemeKipi = secim === EKRAN_SECIMI.PENCERE;
  const gorunum = pencereAcik
    ? { ikon: '🖥️', renk: 'bg-vurgu-yumusak text-vurgu', baslik: denemeKipi ? 'Açık — kasa ekranında pencere' : 'Açık' }
    : acikMi
      ? { ikon: '⏳', renk: 'bg-uyari-yumusak text-uyari', baslik: 'Açık ama görünmüyor' }
      : { ikon: '⏻', renk: 'bg-yuzey-3 text-metin-2', baslik: 'Kapalı' };

  return (
    <Bolum baslik="Müşteri ekranı" aciklama="Müşteriye bakan monitör. Bu karttaki düğmeler hemen uygulanır, Kaydet gerekmez.">
      <div className="kart grid gap-3 p-4">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-2xl ${gorunum.renk}`}
            aria-hidden
          >
            {gorunum.ikon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold leading-tight">{gorunum.baslik}</p>
            {durum && <p className="text-sm text-metin-3">{durum.mesaj}</p>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {!acikMi && (
            <button
              type="button"
              className="tus-birincil"
              disabled={mesgul}
              // İkinci ekran yoksa doğrudan deneme penceresi: "Aç"a basıp hiçbir şey görmemek kafa karıştırır.
              onClick={() => void uygula(true, ikinciEkranVar ? undefined : EKRAN_SECIMI.PENCERE)}
            >
              Müşteri Ekranını Aç
            </button>
          )}
          {acikMi && (
            <button type="button" className="tus-ikincil" disabled={mesgul} onClick={() => void uygula(false)}>
              Kapat
            </button>
          )}
          {!ikinciEkranVar && !(acikMi && denemeKipi) && (
            <button
              type="button"
              className="tus-ikincil"
              disabled={mesgul}
              onClick={() => void uygula(true, EKRAN_SECIMI.PENCERE)}
            >
              Kasa ekranında pencere olarak aç
            </button>
          )}
          {ikinciEkranVar && acikMi && denemeKipi && (
            <button
              type="button"
              className="tus-ikincil"
              disabled={mesgul}
              onClick={() => void uygula(true, EKRAN_SECIMI.OTOMATIK)}
            >
              İkinci ekrana taşı
            </button>
          )}
        </div>

        {!ikinciEkranVar && (
          <p className="rounded-lg bg-bilgi-yumusak px-3 py-2 text-xs text-metin-2">
            Şu an bu bilgisayara <b>tek ekran</b> bağlı. Gerçek müşteri ekranı için ikinci monitörü takın ve Windows&apos;ta
            <b> Ayarlar → Sistem → Ekran → &quot;Bu ekranları genişlet&quot;</b> seçin; program onu kendisi bulur. O zamana kadar
            &quot;pencere olarak aç&quot; ile kasa ekranında deneyebilirsiniz.
          </p>
        )}
      </div>

      {ikinciEkranVar && (
        <Alan etiket="Hangi monitörde?">
          <select className="alan" value={secim} disabled={mesgul} onChange={(e) => void uygula(acikMi, e.target.value)}>
            <option value={EKRAN_SECIMI.OTOMATIK}>Otomatik — kasa programının açık olmadığı ekran (önerilen)</option>
            {ekranlar.map((e) => (
              <option key={e.id} value={e.id}>
                {e.ad} · {e.genislik}×{e.yukseklik}
                {e.kasaEkrani ? ' · kasa programı burada' : ''}
              </option>
            ))}
            {bilinmeyenSecim && <option value={secim}>Daha önce seçilen ekran (şu an bağlı değil)</option>}
            <option value={EKRAN_SECIMI.PENCERE}>Kasa ekranında pencere (deneme)</option>
          </select>
        </Alan>
      )}
    </Bolum>
  );
}

// ---------------------------------------------------------------------------
// Dosya yükleme
// ---------------------------------------------------------------------------

const GORSEL_KABUL = 'image/png,image/jpeg,image/gif,image/webp';
const VIDEO_KABUL = 'video/mp4,video/webm';

async function dosyaYukle(dosya: File, tur: 'GORSEL' | 'VIDEO'): Promise<string> {
  const veri = new Uint8Array(await dosya.arrayBuffer());
  const sonuc = await cagir<{ dosya: string }>('musteri_ekrani.medyaYukle', { veri, tur });
  return sonuc.dosya;
}

/** Görünmez dosya seçiciyi bir düğmeyle açar. */
function DosyaDugmesi({
  tur,
  etiket,
  sinif = 'tus-ikincil',
  onYuklendi,
}: {
  tur: 'GORSEL' | 'VIDEO';
  etiket: string;
  sinif?: string;
  onYuklendi: (dosya: string, ad: string) => void;
}) {
  const girdi = useRef<HTMLInputElement>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  return (
    <>
      <button type="button" className={sinif} disabled={yukleniyor} onClick={() => girdi.current?.click()}>
        {yukleniyor ? 'Yükleniyor…' : etiket}
      </button>
      <input
        ref={girdi}
        type="file"
        hidden
        accept={tur === 'GORSEL' ? GORSEL_KABUL : VIDEO_KABUL}
        onChange={async (e) => {
          const dosya = e.target.files?.[0];
          e.target.value = '';
          if (!dosya) return;
          setYukleniyor(true);
          try {
            onYuklendi(await dosyaYukle(dosya, tur), dosya.name);
          } catch (hata) {
            hatayiBildir(hata, 'Dosya yükleme');
          } finally {
            setYukleniyor(false);
          }
        }}
      />
    </>
  );
}

function LogoAlani({ logo, logoUrl, onDegis }: { logo: string; logoUrl: string | null; onDegis: (dosya: string) => void }) {
  return (
    <Alan etiket="Logo" ipucu="PNG (şeffaf zeminli) en iyi sonucu verir. Karşılama ve sepet ekranında görünür.">
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-28 items-center justify-center rounded border border-cizgi bg-slate-900">
          {logo && logoUrl ? (
            <img src={logoUrl} alt="" className="max-h-14 max-w-24 object-contain" />
          ) : (
            <span className="text-xs text-slate-400">{logo ? 'Kaydedince görünür' : 'Logo yok'}</span>
          )}
        </div>
        <DosyaDugmesi tur="GORSEL" etiket={logo ? 'Değiştir' : 'Logo seç'} onYuklendi={(dosya) => onDegis(dosya)} />
        {logo && (
          <button type="button" className="tus-ikincil" onClick={() => onDegis('')}>
            Kaldır
          </button>
        )}
      </div>
    </Alan>
  );
}

// ---------------------------------------------------------------------------
// Yayın listesi
// ---------------------------------------------------------------------------

function SlaytEkleCubugu({ slaytlar, onEkle }: { slaytlar: MusteriSlayti[]; onEkle: (s: MusteriSlayti) => void }) {
  const dolu = slaytlar.length >= MAKS_SLAYT;
  const sure = MUSTERI_EKRANI_VARSAYILAN.SLAYT_SN;
  const varMi = (tip: SlaytTipi) => slaytlar.some((s) => s.tip === tip);
  if (dolu) return <p className="text-sm text-metin-3">Liste dolu (en fazla {MAKS_SLAYT} slayt).</p>;
  return (
    <div className="flex flex-wrap gap-2">
      <DosyaDugmesi
        tur="GORSEL"
        etiket="+ Görsel / GIF"
        onYuklendi={(dosya, ad) => onEkle({ id: uuid(), tip: 'GORSEL', aktif: true, dosya, ad, sure_sn: sure })}
      />
      <DosyaDugmesi
        tur="VIDEO"
        etiket="+ Video"
        onYuklendi={(dosya, ad) => onEkle({ id: uuid(), tip: 'VIDEO', aktif: true, dosya, ad })}
      />
      <button
        type="button"
        className="tus-ikincil"
        onClick={() => onEkle({ id: uuid(), tip: 'DUYURU', aktif: true, baslik: '', metin: '', tema: 'TURUNCU', sure_sn: sure })}
      >
        + Duyuru
      </button>
      <button
        type="button"
        className="tus-ikincil"
        onClick={() =>
          onEkle({
            id: uuid(),
            tip: 'URUN',
            aktif: true,
            urun_id: '',
            baslik: 'Haftanın Fırsatı',
            tema: 'KIRMIZI',
            sure_sn: sure,
          })
        }
      >
        + Ürün fiyatı
      </button>
      {!varMi('KAMPANYALAR') && (
        <button
          type="button"
          className="tus-ikincil"
          onClick={() => onEkle({ id: uuid(), tip: 'KAMPANYALAR', aktif: true, sure_sn: sure })}
        >
          + Aktif kampanyalar
        </button>
      )}
      {!varMi('KARSILAMA') && (
        <button
          type="button"
          className="tus-ikincil"
          onClick={() => onEkle({ id: uuid(), tip: 'KARSILAMA', aktif: true, sure_sn: sure })}
        >
          + Karşılama
        </button>
      )}
    </div>
  );
}

function SlaytSatiri({
  slayt,
  sira,
  toplam,
  secili,
  yapilandirma,
  onSec,
  onGuncelle,
  onTasi,
  onSil,
}: {
  slayt: MusteriSlayti;
  sira: number;
  toplam: number;
  secili: boolean;
  yapilandirma: MusteriEkraniYapilandirmasi | null;
  onSec: () => void;
  onGuncelle: (alanlar: Partial<MusteriSlayti>) => void;
  onTasi: (yon: -1 | 1) => void;
  onSil: () => void;
}) {
  const uretilen = yapilandirma?.slaytlar.filter((u) => u.anahtar === slayt.id || u.anahtar.startsWith(`${slayt.id}:`)) ?? [];

  return (
    <li
      className={`rounded border p-3 ${secili ? 'border-vurgu bg-vurgu-yumusak/40' : 'border-cizgi'} ${slayt.aktif ? '' : 'opacity-60'}`}
      onClick={onSec}
    >
      <div className="flex items-center gap-2">
        <span className="w-6 text-right text-xs tabular-nums text-metin-3">{sira + 1}.</span>
        <div className="flex flex-col">
          <button
            type="button"
            className="px-1 text-xs leading-none text-metin-3 hover:text-metin disabled:opacity-30"
            disabled={sira === 0}
            onClick={() => onTasi(-1)}
            title="Yukarı taşı"
          >
            ▲
          </button>
          <button
            type="button"
            className="px-1 text-xs leading-none text-metin-3 hover:text-metin disabled:opacity-30"
            disabled={sira === toplam - 1}
            onClick={() => onTasi(1)}
            title="Aşağı taşı"
          >
            ▼
          </button>
        </div>
        <input type="checkbox" title="Yayında" checked={slayt.aktif} onChange={(e) => onGuncelle({ aktif: e.target.checked })} />
        <Rozet tur="bilgi">{SLAYT_TIP_ETIKETI[slayt.tip]}</Rozet>
        <span className="min-w-0 flex-1 truncate text-sm">{ozet(slayt, uretilen.length, yapilandirma)}</span>
        {slayt.tip !== 'VIDEO' && (
          <label
            className="flex items-center gap-1 text-xs text-metin-3"
            title={slayt.tip === 'KAMPANYALAR' ? 'Her kampanya için' : undefined}
          >
            <input
              className="alan sayi w-16 py-1"
              type="number"
              min={3}
              max={120}
              value={slayt.sure_sn}
              onChange={(e) => onGuncelle({ sure_sn: Math.round(Number(e.target.value) || 0) })}
            />
            sn
          </label>
        )}
        <button
          type="button"
          className="px-2 text-sm text-tehlike hover:underline"
          onClick={(e) => {
            // Satırın tıklaması silinen slaytı önizlemeye seçmesin.
            e.stopPropagation();
            onSil();
          }}
        >
          Sil
        </button>
      </div>

      {secili && <SlaytDuzenleyici slayt={slayt} onGuncelle={onGuncelle} uretilenSayisi={uretilen.length} />}
    </li>
  );
}

function ozet(slayt: MusteriSlayti, uretilen: number, yapilandirma: MusteriEkraniYapilandirmasi | null): string {
  switch (slayt.tip) {
    case 'KARSILAMA':
      return 'Logo, market adı ve karşılama yazısı';
    case 'KAMPANYALAR':
      if (!yapilandirma) return 'Panelde tanımlı geçerli kampanyalar';
      return uretilen > 0 ? `Şu an ${uretilen} kampanya gösteriliyor` : 'Şu an geçerli kampanya yok — atlanır';
    case 'URUN': {
      if (!slayt.urun_id) return 'Ürün seçilmedi';
      const kart = yapilandirma?.slaytlar.find((u) => u.anahtar === slayt.id);
      if (kart?.tip === 'FIYAT') return `${kart.kart.ad} · ${kart.kart.fiyat ?? ''}`;
      return yapilandirma ? 'Ürün bulunamadı ya da pasif — gösterilmez' : '…';
    }
    case 'DUYURU':
      return slayt.baslik || 'Başlık yazılmadı';
    case 'GORSEL':
    case 'VIDEO':
      return slayt.ad || 'Dosya';
  }
}

function TemaSecici({ deger, onDegis }: { deger: SlaytTemasi; onDegis: (t: SlaytTemasi) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SLAYT_TEMASI.map((t) => (
        <button
          key={t}
          type="button"
          title={SLAYT_TEMA_ETIKETI[t]}
          onClick={() => onDegis(t)}
          className={`h-7 w-10 rounded ${deger === t ? 'ring-2 ring-vurgu ring-offset-2 ring-offset-yuzey' : ''}`}
          style={{ background: TEMA_STILI[t].zemin }}
        />
      ))}
    </div>
  );
}

function SlaytDuzenleyici({
  slayt,
  onGuncelle,
  uretilenSayisi,
}: {
  slayt: MusteriSlayti;
  onGuncelle: (alanlar: Partial<MusteriSlayti>) => void;
  uretilenSayisi: number;
}) {
  // Satıra tıklama önizlemeyi seçer; düzenleyicinin içindeki tıklamalar yukarı taşmasın.
  const icerik = (() => {
    switch (slayt.tip) {
      case 'DUYURU':
        return (
          <>
            <Alan etiket="Başlık">
              <input
                className="alan"
                maxLength={60}
                placeholder="Taze ekmek çıktı!"
                value={slayt.baslik}
                onChange={(e) => onGuncelle({ baslik: e.target.value })}
              />
            </Alan>
            <Alan etiket="Metin" ipucu="İsteğe bağlı, en fazla 200 karakter.">
              <textarea
                className="alan"
                rows={2}
                maxLength={200}
                value={slayt.metin}
                onChange={(e) => onGuncelle({ metin: e.target.value })}
              />
            </Alan>
            <Alan etiket="Renk">
              <TemaSecici deger={slayt.tema} onDegis={(tema) => onGuncelle({ tema })} />
            </Alan>
          </>
        );
      case 'URUN':
        return (
          <>
            <Alan
              etiket="Ürün"
              ipucu="Fiyat her zaman katalogdan okunur; ürünün fiyatı ya da kampanyası değişince ekran kendiliğinden güncellenir."
            >
              <UrunSecici placeholder="Barkod okutun veya ürün adı yazın…" onSec={(u) => onGuncelle({ urun_id: u.id })} />
            </Alan>
            <Alan etiket="Üst başlık" ipucu="Boş bırakılabilir.">
              <input
                className="alan"
                maxLength={40}
                value={slayt.baslik}
                onChange={(e) => onGuncelle({ baslik: e.target.value })}
              />
            </Alan>
            <Alan etiket="Renk">
              <TemaSecici deger={slayt.tema} onDegis={(tema) => onGuncelle({ tema })} />
            </Alan>
          </>
        );
      case 'KAMPANYALAR':
        return (
          <p className="text-sm text-metin-2">
            Panelden tanımlanan ve şu an geçerli olan her kampanya için ayrı bir slayt otomatik üretilir; süre her kampanya
            içindir. Kampanya bitince ya da fiyat değişince ekran kendiliğinden güncellenir.
            {uretilenSayisi === 0 && ' Şu an geçerli kampanya olmadığı için bu satır atlanıyor.'}
          </p>
        );
      case 'KARSILAMA':
        return <p className="text-sm text-metin-2">Yazılar ve logo yukarıdaki "Karşılama ekranı" bölümünden ayarlanır.</p>;
      case 'GORSEL':
        return (
          <p className="text-sm text-metin-2">
            Görsel ekrana sığdırılır, kesilmez. En iyi sonuç için ekranla aynı oranda (genelde 16:9) hazırlayın. GIF kendiliğinden
            oynar.
          </p>
        );
      case 'VIDEO':
        return <p className="text-sm text-metin-2">Video sesiz ve sonuna kadar oynar, sonra sıradaki slayta geçilir.</p>;
    }
  })();
  return (
    <div className="mt-3 grid gap-3 border-t border-cizgi pt-3" onClick={(e) => e.stopPropagation()}>
      {icerik}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Önizleme
// ---------------------------------------------------------------------------

const ORNEK_SEPET: MusteriSepeti = {
  satirlar: [
    {
      anahtar: 'o1',
      ad: 'Süt 1 L',
      miktar: 2000,
      birimTipi: 'ADET',
      birimFiyat: 3250,
      listeFiyati: 3250,
      tutar: 6500,
      iskonto: 0,
    },
    { anahtar: 'o2', ad: 'Domates', miktar: 1250, birimTipi: 'KG', birimFiyat: 3990, listeFiyati: 3990, tutar: 4988, iskonto: 0 },
    {
      anahtar: 'o3',
      ad: 'Ayran 1 L',
      miktar: 3000,
      birimTipi: 'ADET',
      birimFiyat: 3000,
      listeFiyati: 3000,
      tutar: 6000,
      iskonto: 3000,
    },
  ],
  sonAnahtar: 'o3',
  genelToplam: 17488,
  kazanc: 3000,
};

function OnizlemePaneli({
  onizleme,
  setOnizleme,
  yapilandirma,
}: {
  onizleme: Onizleme;
  setOnizleme: (o: Onizleme) => void;
  yapilandirma: MusteriEkraniYapilandirmasi | null;
}) {
  const sekme = (tur: 'YAYIN' | 'SEPET' | 'TESEKKUR', etiket: string) => (
    <button
      type="button"
      onClick={() => setOnizleme({ tur })}
      className={`rounded px-2 py-1 text-xs ${onizleme.tur === tur ? 'bg-vurgu text-vurgu-uzeri' : 'text-metin-3 hover:text-metin'}`}
    >
      {etiket}
    </button>
  );

  let govde: ReactNode = null;
  if (yapilandirma) {
    if (onizleme.tur === 'YAYIN') {
      // Ölçü kabı (musteri-kok) şart: yazılar kutuya göre boyutlanır, yoksa pencereye göre büyür.
      govde = (
        <div className="musteri-kok" style={musteriKokStili(yapilandirma)}>
          <Yayin yapilandirma={yapilandirma} />
        </div>
      );
    } else if (onizleme.tur === 'SEPET' || onizleme.tur === 'TESEKKUR') {
      const durum: EkranDurumu =
        onizleme.tur === 'SEPET'
          ? { mod: 'SEPET', sepet: ORNEK_SEPET, tesekkur: null }
          : { mod: 'TESEKKUR', sepet: null, tesekkur: { genelToplam: 17488, paraUstu: 2512, bitis: Number.MAX_SAFE_INTEGER } };
      govde = <MusteriEkraniGorunumu yapilandirma={yapilandirma} durum={durum} />;
    } else {
      const id = onizleme.id;
      const slayt = yapilandirma.slaytlar.find((u) => u.anahtar === id || u.anahtar.startsWith(`${id}:`));
      govde = slayt ? (
        <div className="musteri-kok" style={musteriKokStili(yapilandirma)}>
          <SlaytGorunumu key={slayt.anahtar} slayt={slayt} yapilandirma={yapilandirma} tekrarla />
        </div>
      ) : (
        <div className="flex h-full items-center justify-center bg-slate-900 p-6 text-center text-sm text-slate-300">
          Bu slayt şu an gösterilemiyor (yayında değil, eksik bilgi ya da geçerli kampanya yok).
        </div>
      );
    }
  }

  return (
    <aside className="xl:sticky xl:top-0 xl:w-[30rem]">
      <div className="mb-2 flex items-center gap-1">
        <h2 className="mr-auto font-semibold">Önizleme</h2>
        {sekme('YAYIN', 'Bekleme')}
        {sekme('SEPET', 'Sepet örneği')}
        {sekme('TESEKKUR', 'Teşekkür')}
      </div>
      <div className="aspect-video w-full overflow-hidden rounded-lg border border-cizgi bg-slate-950 shadow-inner">{govde}</div>
      <p className="mt-2 text-xs text-metin-3">
        {onizleme.tur === 'SLAYT'
          ? 'Seçili slayt. Tüm akışı görmek için "Bekleme"ye tıklayın.'
          : 'Müşterinin göreceği ekran (kaydedilmemiş değişikliklerle).'}
      </p>
    </aside>
  );
}
