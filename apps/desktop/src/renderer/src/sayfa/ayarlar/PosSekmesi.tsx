/**
 * Ayarlar → POS & Yazarkasa.
 *
 * Eskiden Donanım sekmesinin en altındaydı: yazıcı ve terazi ayarlarının
 * altında kayboluyordu, bağlantının çalışıp çalışmadığını görmek için ayrıca
 * "Test Et"e basmak gerekiyordu. Artık kendi sekmesinde:
 *  - solda kurulum, 1-2-3 adım (bağlantı → cihaz bilgisi → eşleştirme);
 *  - sağda CANLI durum (sekme açılınca ve her kayıttan sonra kendiliğinden
 *    denenir) ve bakım işlemleri.
 *
 * Test ve eşleştirme KAYITLI ayarla çalışır; kaydedilmemiş değişiklik varsa
 * bu açıkça söylenir ve eşleştirme kapanır — eski ekranda kullanıcı adresi
 * değiştirip kaydetmeden test ediyor, eski adresin sonucunu görüyordu.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AYAR, paraFormat, PAVO_AYAR, PAVO_VARSAYILAN_UYGULAMA_ADI, tarihSaatFormat } from '@market/shared';
import { Alan, Rozet } from '../../bilesen/temel';
import { hatayiBildir } from '../../durum/bildirim';
import { cagir } from '../../kopru';

type Ayarla = (anahtar: string, deger: string) => void;
type Mesaj = { tur: 'basari' | 'uyari' | 'tehlike'; metin: string };

/** Değişince bağlantının yeniden denenmesi gereken ayarlar. */
const POS_ANAHTARLARI = [
  AYAR.POS_TURU,
  AYAR.POS_ADRES,
  AYAR.POS_ZAMAN_ASIMI_SN,
  PAVO_AYAR.SERI_NO,
  PAVO_AYAR.UYGULAMA_ADI,
  PAVO_AYAR.HTTPS,
] as const;

const TURLER = [
  {
    deger: 'KAPALI',
    ikon: '✋',
    baslik: 'Kapalı',
    aciklama: 'Kartı POS cihazından elle çekersiniz; program yalnız kaydeder.',
  },
  {
    deger: 'PAVO',
    ikon: '🧾',
    baslik: 'Pavo N86',
    aciklama: 'Yazarkasa POS. Nakit, kart, veresiye — her satış cihazdan geçer, yasal fişi Pavo keser.',
  },
  {
    deger: 'SIMULATOR',
    ikon: '🧪',
    baslik: 'Test simülatörü',
    aciklama: 'Cihaz olmadan akışı denemek için. Kuruşu 13 ile biten tutar reddedilir, 14 ile biten yanıtsız kalır.',
  },
] as const;

type Durum =
  | { tur: 'kapali' }
  | { tur: 'kaydedilmedi' }
  | { tur: 'kontrol' }
  | { tur: 'bagli'; mesaj: string }
  | { tur: 'hata'; mesaj: string };

interface PavoBilgisi {
  adres: string;
  seriNo: string;
  acikKayit: number;
}

export function PosSekmesi({
  ayarlar,
  kayitli,
  ayarla,
}: {
  ayarlar: Record<string, string>;
  /** Veritabanındaki (kaydedilmiş) değerler — test ve eşleştirme bunlarla yapılır. */
  kayitli: Record<string, string>;
  ayarla: Ayarla;
}) {
  const tur = ayarlar[AYAR.POS_TURU] ?? 'KAPALI';
  const kayitliTur = kayitli[AYAR.POS_TURU] ?? 'KAPALI';
  const kirli = POS_ANAHTARLARI.some((a) => (ayarlar[a] ?? '') !== (kayitli[a] ?? ''));
  const [durum, setDurum] = useState<Durum>({ tur: 'kapali' });
  const [pavo, setPavo] = useState<PavoBilgisi | null>(null);
  /** Cihaz aynı anda tek iş yapar: test, eşleştirme ve bakım birbirini bekler. */
  const [mesgul, setMesgul] = useState<string | null>(null);

  const dene = useCallback(async () => {
    if (kayitliTur === 'KAPALI') {
      setDurum({ tur: 'kapali' });
      return;
    }
    setMesgul('test');
    setDurum({ tur: 'kontrol' });
    try {
      const s = await cagir<{ basarili: boolean; mesaj: string }>('pos.test');
      setDurum(s.basarili ? { tur: 'bagli', mesaj: s.mesaj } : { tur: 'hata', mesaj: s.mesaj });
    } catch (hata) {
      setDurum({ tur: 'hata', mesaj: hata instanceof Error ? hata.message : String(hata) });
    } finally {
      setMesgul(null);
    }
    if (kayitliTur === 'PAVO') {
      cagir<PavoBilgisi>('pavo.durum')
        .then(setPavo)
        .catch(() => setPavo(null));
    }
  }, [kayitliTur]);

  // Sekme açılınca ve her kayıttan sonra kendiliğinden denenir.
  const kayitliImza = POS_ANAHTARLARI.map((a) => kayitli[a] ?? '').join('|');
  useEffect(() => {
    void dene();
  }, [dene, kayitliImza]);

  const gorunenDurum: Durum = kirli ? { tur: 'kaydedilmedi' } : durum;
  const adres = (ayarlar[AYAR.POS_ADRES] ?? '').trim();
  const seriNo = (ayarlar[PAVO_AYAR.SERI_NO] ?? '').trim();

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
      <div className="grid gap-4">
        <section className="kart p-4">
          <h3 className="font-semibold">Kart ödemesi nasıl alınacak?</h3>
          <p className="mb-3 text-sm text-metin-3">Bu ayar yalnız bu kasaya aittir; diğer kasalara gitmez.</p>
          <div className="grid gap-2 md:grid-cols-3">
            {TURLER.map((t) => {
              const secili = tur === t.deger;
              return (
                <button
                  key={t.deger}
                  type="button"
                  role="radio"
                  aria-checked={secili}
                  onClick={() => ayarla(AYAR.POS_TURU, t.deger)}
                  className={`flex flex-col gap-1 rounded-xl border-2 p-3 text-left transition-colors ${
                    secili ? 'border-vurgu bg-vurgu-yumusak' : 'border-cizgi hover:bg-yuzey-2'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-xl" aria-hidden>
                      {t.ikon}
                    </span>
                    <span className="font-semibold">{t.baslik}</span>
                    <span
                      className={`ml-auto h-4 w-4 rounded-full border-2 ${secili ? 'border-vurgu bg-vurgu' : 'border-cizgi-kuvvetli'}`}
                      aria-hidden
                    />
                  </span>
                  <span className="text-xs text-metin-3">{t.aciklama}</span>
                </button>
              );
            })}
          </div>
        </section>

        {tur === 'PAVO' && (
          <>
            <Adim
              no={1}
              tamam={adres !== ''}
              baslik="Bağlantı"
              aciklama="Pavo ile bu bilgisayar aynı ağda (aynı modemde) olmalı. Adres, cihazın ağ ayarları ekranında yazar."
            >
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px]">
                <Alan etiket="Cihaz adresi (IP)" ipucu="Port yazılmazsa HTTP'de 4568, HTTPS'te 4567 kullanılır.">
                  <input
                    className="alan font-mono"
                    placeholder="192.168.1.50"
                    value={ayarlar[AYAR.POS_ADRES] ?? ''}
                    onChange={(e) => ayarla(AYAR.POS_ADRES, e.target.value.trim())}
                  />
                </Alan>
                <Alan etiket="Kart bekleme süresi" ipucu="Saniye. Müşterinin kartı okutup şifre girmesi için.">
                  <input
                    className="alan sayi"
                    inputMode="numeric"
                    value={ayarlar[AYAR.POS_ZAMAN_ASIMI_SN] ?? '90'}
                    onChange={(e) => ayarla(AYAR.POS_ZAMAN_ASIMI_SN, e.target.value.replace(/\D/g, ''))}
                  />
                </Alan>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={(ayarlar[PAVO_AYAR.HTTPS] ?? '0') === '1'}
                  onChange={(e) => ayarla(PAVO_AYAR.HTTPS, e.target.checked ? '1' : '0')}
                />
                Güvenli bağlantı (HTTPS) <span className="text-metin-3">— cihazda açıksa işaretleyin</span>
              </label>
            </Adim>

            <Adim
              no={2}
              tamam={seriNo !== ''}
              baslik="Cihaz bilgisi"
              aciklama="Eşleştirmede cihaz bu bilgileri doğrular; yanlışsa eşleşmez."
            >
              <div className="grid gap-3 md:grid-cols-2">
                <Alan etiket="Seri numarası" ipucu="Cihazın arkasında ve cihaz bilgisi ekranında yazar.">
                  <input
                    className="alan font-mono"
                    placeholder="PAV…"
                    value={ayarlar[PAVO_AYAR.SERI_NO] ?? ''}
                    onChange={(e) => ayarla(PAVO_AYAR.SERI_NO, e.target.value.trim())}
                  />
                </Alan>
                <Alan etiket="Uygulama adı" ipucu="Pavo'ya kayıtlı adla birebir aynı olmalı; boşsa varsayılan kullanılır.">
                  <input
                    className="alan"
                    placeholder={PAVO_VARSAYILAN_UYGULAMA_ADI}
                    value={ayarlar[PAVO_AYAR.UYGULAMA_ADI] ?? ''}
                    onChange={(e) => ayarla(PAVO_AYAR.UYGULAMA_ADI, e.target.value)}
                  />
                </Alan>
              </div>
            </Adim>

            <Adim
              no={3}
              tamam={gorunenDurum.tur === 'bagli'}
              baslik="Eşleştirme"
              aciklama="Yalnız ilk kurulumda ya da cihaz değişince yapılır. Düğmeye basınca Pavo'nun ekranında onay sorulur — cihazdan onaylayın."
            >
              <Eslestirme kirli={kirli} mesgul={mesgul} setMesgul={setMesgul} sonra={dene} />
            </Adim>
          </>
        )}

        {tur === 'SIMULATOR' && (
          <section className="kart grid gap-3 p-4">
            <h3 className="font-semibold">Simülatör</h3>
            <Alan etiket="Kart bekleme süresi (saniye)">
              <input
                className="alan sayi w-32"
                inputMode="numeric"
                value={ayarlar[AYAR.POS_ZAMAN_ASIMI_SN] ?? '90'}
                onChange={(e) => ayarla(AYAR.POS_ZAMAN_ASIMI_SN, e.target.value.replace(/\D/g, ''))}
              />
            </Alan>
          </section>
        )}

        <PosGunlugu />
      </div>

      <aside className="grid gap-4 xl:sticky xl:top-0">
        <DurumKarti
          durum={gorunenDurum}
          tur={kirli ? tur : kayitliTur}
          pavo={kayitliTur === 'PAVO' ? pavo : null}
          mesgul={mesgul}
          tekrarDene={() => void dene()}
        />
        {kayitliTur === 'PAVO' && !kirli && (
          <PavoBakim acikKayit={pavo?.acikKayit ?? 0} mesgul={mesgul} setMesgul={setMesgul} sonra={dene} />
        )}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parçalar
// ---------------------------------------------------------------------------

function Adim({
  no,
  tamam,
  baslik,
  aciklama,
  children,
}: {
  no: number;
  tamam: boolean;
  baslik: string;
  aciklama: string;
  children: ReactNode;
}) {
  return (
    <section className="kart flex gap-4 p-4">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          tamam ? 'bg-vurgu text-vurgu-uzeri' : 'bg-yuzey-3 text-metin-2'
        }`}
        aria-label={tamam ? `${no}. adım tamam` : `${no}. adım`}
      >
        {tamam ? '✓' : no}
      </span>
      <div className="grid min-w-0 flex-1 gap-3">
        <div>
          <h3 className="font-semibold">{baslik}</h3>
          <p className="text-sm text-metin-3">{aciklama}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

const DURUM_GORUNUMU: Record<Durum['tur'], { ikon: string; renk: string; baslik: string }> = {
  kapali: { ikon: '✋', renk: 'bg-yuzey-3 text-metin-2', baslik: 'POS kapalı' },
  kaydedilmedi: { ikon: '!', renk: 'bg-uyari-yumusak text-uyari', baslik: 'Değişiklikler kaydedilmedi' },
  kontrol: { ikon: '…', renk: 'bg-bilgi-yumusak text-bilgi', baslik: 'Bağlantı deneniyor' },
  bagli: { ikon: '✓', renk: 'bg-vurgu-yumusak text-vurgu', baslik: 'Bağlı' },
  hata: { ikon: '✕', renk: 'bg-tehlike-yumusak text-tehlike', baslik: 'Bağlanamıyor' },
};

function DurumKarti({
  durum,
  tur,
  pavo,
  mesgul,
  tekrarDene,
}: {
  durum: Durum;
  tur: string;
  pavo: PavoBilgisi | null;
  mesgul: string | null;
  tekrarDene: () => void;
}) {
  const g = DURUM_GORUNUMU[durum.tur];
  const cihazAdi = tur === 'PAVO' ? 'Pavo N86' : tur === 'SIMULATOR' ? 'Simülatör' : 'POS';
  return (
    <section className="kart grid gap-3 p-4" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl font-bold ${g.renk}`}>
          {g.ikon}
        </span>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-metin-3">{cihazAdi}</p>
          <p className="text-lg font-semibold leading-tight">{g.baslik}</p>
        </div>
      </div>

      {durum.tur === 'kapali' && (
        <p className="text-sm text-metin-2">Kart çekimi POS cihazından elle yapılır; satışta ödeme türünü seçmeniz yeterli.</p>
      )}
      {durum.tur === 'kaydedilmedi' && (
        <p className="text-sm text-metin-2">
          Bağlantı testi ve eşleştirme <b>kayıtlı</b> ayarla yapılır. Sağ üstteki <b>Kaydet</b>'e basın; durum kendiliğinden
          yenilenir.
        </p>
      )}
      {durum.tur === 'bagli' && <p className="text-sm text-metin-2">{durum.mesaj}</p>}
      {durum.tur === 'hata' && (
        <>
          <p className="rounded-lg bg-tehlike-yumusak px-3 py-2 text-sm text-tehlike">{durum.mesaj}</p>
          {tur === 'PAVO' && (
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-metin-2">
              <li>Pavo açık mı, ekranı uyku modunda mı?</li>
              <li>Bilgisayarla aynı ağda mı? Adres doğru mu?</li>
              <li>İlk kurulumsa 3. adımdaki eşleştirme yapıldı mı?</li>
            </ul>
          )}
        </>
      )}

      {pavo && (durum.tur === 'bagli' || durum.tur === 'hata') && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-yuzey-2 px-3 py-2 text-sm">
          <dt className="text-metin-3">Adres</dt>
          <dd className="font-mono">{pavo.adres || '—'}</dd>
          <dt className="text-metin-3">Seri no</dt>
          <dd className="font-mono">{pavo.seriNo || '—'}</dd>
          <dt className="text-metin-3">Yarım kalan satış</dt>
          <dd className={pavo.acikKayit > 0 ? 'font-semibold text-uyari' : ''}>{pavo.acikKayit}</dd>
        </dl>
      )}

      {durum.tur !== 'kapali' && durum.tur !== 'kaydedilmedi' && (
        <button type="button" className="tus-ikincil" onClick={tekrarDene} disabled={mesgul !== null}>
          {durum.tur === 'kontrol' ? 'Deneniyor…' : 'Bağlantıyı Tekrar Dene'}
        </button>
      )}
    </section>
  );
}

function Eslestirme({
  kirli,
  mesgul,
  setMesgul,
  sonra,
}: {
  kirli: boolean;
  mesgul: string | null;
  setMesgul: (m: string | null) => void;
  sonra: () => Promise<void>;
}) {
  const [mesaj, setMesaj] = useState<Mesaj | null>(null);
  const esles = async () => {
    setMesgul('esles');
    setMesaj(null);
    try {
      const s = await cagir<{ seriNo: string }>('pavo.esles');
      setMesaj({ tur: 'basari', metin: `Eşleştirildi (${s.seriNo}).` });
    } catch (hata) {
      setMesaj({ tur: 'tehlike', metin: hata instanceof Error ? hata.message : String(hata) });
    } finally {
      setMesgul(null);
    }
    await sonra();
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="tus-birincil"
        disabled={mesgul !== null || kirli}
        title={kirli ? 'Önce Kaydet' : undefined}
        onClick={() => void esles()}
      >
        {mesgul === 'esles' ? "Pavo'da onay bekleniyor…" : 'Eşleştir'}
      </button>
      {kirli && <span className="text-sm text-uyari">Önce değişiklikleri kaydedin.</span>}
      {mesaj && <Rozet tur={mesaj.tur}>{mesaj.metin}</Rozet>}
    </div>
  );
}

interface Askidaki {
  satisNo: string;
  toplam: number;
  kalan: number;
}

/** Pavo bakım işlemleri: yarım kalan satışlar, askıdaki satışlar, Yazarkasa sayfası. */
function PavoBakim({
  acikKayit,
  mesgul,
  setMesgul,
  sonra,
}: {
  acikKayit: number;
  mesgul: string | null;
  setMesgul: (m: string | null) => void;
  sonra: () => Promise<void>;
}) {
  const git = useNavigate();
  const [mesaj, setMesaj] = useState<Mesaj | null>(null);
  const [askidakiler, setAskidakiler] = useState<Askidaki[] | null>(null);

  const calistir = async (ad: string, is: () => Promise<Mesaj | void>) => {
    setMesgul(ad);
    setMesaj(null);
    try {
      const sonuc = await is();
      if (sonuc) setMesaj(sonuc);
    } catch (hata) {
      setMesaj({ tur: 'tehlike', metin: hata instanceof Error ? hata.message : String(hata) });
    } finally {
      setMesgul(null);
    }
  };

  const askidakileriGetir = () =>
    calistir('askida', async () => {
      const liste = await cagir<Askidaki[]>('pavo.askidakiler');
      setAskidakiler(liste);
      return liste.length === 0 ? { tur: 'basari', metin: "Pavo'da askıda satış yok." } : undefined;
    });

  const kurtar = () =>
    calistir('kurtar', async () => {
      const s = await cagir<{ olusturulan: string[]; silinen: string[]; kalan: { ozet: string }[] }>('pavo.kurtar');
      await sonra();
      if (s.kalan.length > 0) {
        return { tur: 'uyari', metin: `${s.kalan.length} satışın durumu hâlâ öğrenilemedi. Pavo açık ve bağlı mı?` };
      }
      const parcalar = [
        s.olusturulan.length ? `${s.olusturulan.length} satış kayda geçirildi (${s.olusturulan.join(', ')})` : '',
        s.silinen.length ? `${s.silinen.length} yarım satış Pavo'dan silindi — alınan nakit varsa müşteriye iade edin` : '',
      ].filter(Boolean);
      return { tur: 'basari', metin: parcalar.join('. ') || 'Yarım kalan satış yok.' };
    });

  return (
    <section className="kart grid gap-2 p-4">
      <h3 className="font-semibold">Bakım</h3>
      <BakimSatiri
        ikon="🩹"
        baslik="Yarım kalan satışları çöz"
        aciklama="Elektrik ya da bağlantı kesilince yarıda kalan satışları cihaza sorup tamamlar."
        rozet={acikKayit > 0 ? <Rozet tur="uyari">{acikKayit} bekliyor</Rozet> : undefined}
        mesgulMu={mesgul === 'kurtar'}
        devreDisi={mesgul !== null}
        onClick={() => void kurtar()}
      />
      <BakimSatiri
        ikon="⏸️"
        baslik="Askıdaki satışlar"
        aciklama="Pavo'da açık kalmış satışları listeler; gerekirse silinir."
        mesgulMu={mesgul === 'askida'}
        devreDisi={mesgul !== null}
        onClick={() => void askidakileriGetir()}
      />
      <BakimSatiri
        ikon="📊"
        baslik="Yazarkasa sayfası"
        aciklama="Gün sonu (Z), banka gün sonu, X raporu, aylık rapor."
        devreDisi={false}
        onClick={() => git('/yazarkasa')}
      />
      {mesaj && (
        <div className="whitespace-pre-line pt-1">
          <Rozet tur={mesaj.tur}>{mesaj.metin}</Rozet>
        </div>
      )}
      {askidakiler && askidakiler.length > 0 && (
        <ul className="divide-y divide-cizgi rounded-lg border border-cizgi text-sm">
          {askidakiler.map((a) => (
            <li key={a.satisNo} className="flex items-center gap-2 px-3 py-2">
              <span className="font-mono">{a.satisNo}</span>
              <span className="text-metin-3">
                {paraFormat(a.toplam)} · kalan {paraFormat(a.kalan)}
              </span>
              <button
                type="button"
                className="ml-auto text-tehlike hover:underline disabled:opacity-50"
                disabled={mesgul !== null}
                onClick={() =>
                  void calistir('sil', async () => {
                    const s = await cagir<{ silindi: boolean }>('pavo.askidakiniSil', { satisNo: a.satisNo });
                    await askidakileriGetir();
                    return s.silindi
                      ? { tur: 'basari', metin: `${a.satisNo} silindi — alınmış ödeme varsa Pavo iade etti.` }
                      : { tur: 'tehlike', metin: `${a.satisNo} silinemedi.` };
                  })
                }
              >
                Sil
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BakimSatiri({
  ikon,
  baslik,
  aciklama,
  rozet,
  mesgulMu,
  devreDisi,
  onClick,
}: {
  ikon: string;
  baslik: string;
  aciklama: string;
  rozet?: ReactNode;
  mesgulMu?: boolean;
  devreDisi: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={devreDisi}
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg border border-cizgi px-3 py-2.5 text-left transition-colors hover:bg-yuzey-2 disabled:opacity-60"
    >
      <span className="text-xl" aria-hidden>
        {ikon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 font-medium">
          {mesgulMu ? 'Çalışıyor…' : baslik}
          {rozet}
        </span>
        <span className="block text-xs text-metin-3">{aciklama}</span>
      </span>
      <span className="text-metin-3" aria-hidden>
        ›
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// POS günlüğü
// ---------------------------------------------------------------------------

interface PosGunlukSatiri {
  id: string;
  zaman: string;
  tur: 'SATIS' | 'IADE' | 'GERI_ALMA';
  tutar: number;
  sonuc: 'ONAY' | 'RED' | 'ZAMAN_ASIMI' | 'HATA';
  onay_kodu: string | null;
  kart: string | null;
  hata: string | null;
  belge_tipi: string | null;
  kullanici_adi?: string | null;
}

const POS_TUR_ADI: Record<PosGunlukSatiri['tur'], string> = { SATIS: 'Çekim', IADE: 'Karta iade', GERI_ALMA: 'Geri alma' };
const POS_SONUC: Record<PosGunlukSatiri['sonuc'], { ad: string; tur: 'basari' | 'uyari' | 'tehlike' }> = {
  ONAY: { ad: 'Onay', tur: 'basari' },
  RED: { ad: 'Red', tur: 'uyari' },
  ZAMAN_ASIMI: { ad: 'Yanıt yok', tur: 'tehlike' },
  HATA: { ad: 'Hata', tur: 'tehlike' },
};

/** Cihaza giden son işlemler — gün sonu slibiyle karşılaştırma ve "para çekildi mi?" sorusu için. */
function PosGunlugu() {
  const [satirlar, setSatirlar] = useState<PosGunlukSatiri[] | null>(null);
  const yukle = () => {
    cagir<PosGunlukSatiri[]>('pos.gunluk', { limit: 50 })
      .then(setSatirlar)
      .catch((hata: unknown) => hatayiBildir(hata, 'POS günlüğü'));
  };
  return (
    <section className="kart grid gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h3 className="font-semibold">Son POS işlemleri</h3>
          <p className="text-sm text-metin-3">
            Onaylanan, reddedilen ve yanıt alınamayan her işlem. &quot;Para çekildi mi?&quot; sorusu için buraya bakın.
          </p>
        </div>
        <button type="button" className="tus-ikincil" onClick={yukle}>
          {satirlar ? 'Yenile' : 'Göster'}
        </button>
      </div>
      {satirlar && (
        <div className="max-h-72 overflow-auto rounded-lg border border-cizgi">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-yuzey-2 text-left text-metin-3">
              <tr>
                <th className="px-2 py-1">Zaman</th>
                <th className="px-2 py-1">İşlem</th>
                <th className="px-2 py-1 text-right">Tutar</th>
                <th className="px-2 py-1">Sonuç</th>
                <th className="px-2 py-1">Onay / Kart</th>
                <th className="px-2 py-1">Kullanıcı</th>
              </tr>
            </thead>
            <tbody>
              {satirlar.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-3 text-center text-metin-3">
                    Henüz POS işlemi yok.
                  </td>
                </tr>
              )}
              {satirlar.map((s) => (
                <tr key={s.id} className="border-t border-cizgi align-top">
                  <td className="whitespace-nowrap px-2 py-1">{tarihSaatFormat(s.zaman)}</td>
                  <td className="px-2 py-1">{POS_TUR_ADI[s.tur] ?? s.tur}</td>
                  <td className="px-2 py-1 text-right font-mono">{paraFormat(s.tutar)}</td>
                  <td className="px-2 py-1">
                    <Rozet tur={POS_SONUC[s.sonuc]?.tur ?? 'notr'}>{POS_SONUC[s.sonuc]?.ad ?? s.sonuc}</Rozet>
                    {s.hata && <span className="block text-metin-3">{s.hata}</span>}
                  </td>
                  <td className="px-2 py-1 font-mono">{[s.onay_kodu, s.kart].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-2 py-1">{s.kullanici_adi ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
