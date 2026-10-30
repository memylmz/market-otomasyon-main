/**
 * Yazarkasa (Pavo) — gün sonu ve mali raporlar tek yerde.
 *
 * Kasiyerin ve market sahibinin anlayacağı dille yazıldı: her düğmenin
 * altında ne yaptığı ve GÜNÜ KAPATIP KAPATMADIĞI yazar. Günü kapatan tek
 * işlem "Gün sonu"dur (geri alınamaz); diğer raporlar yalnız okur ve basar.
 *
 * Cihaz tek şeritten çalışır: aynı anda tek işlem — biri sürerken diğer
 * düğmeler kapalıdır.
 */

import { useEffect, useState, type ReactNode } from 'react';
import {
  ayBasi,
  bugun,
  gunEkle,
  miktarFormat,
  paraFormat,
  pavoRaporBasligi,
  pavoRaporBirlestir,
  pavoRaporNet,
  type Kurus,
  type PavoRaporu,
} from '@market/shared';
import { BosDurum, Diyalog, OnayDiyalogu, Rozet, Yukleniyor } from '../bilesen/temel';
import { bildir } from '../durum/bildirim';
import { useYetki } from '../durum/oturum';
import { cagir } from '../kopru';

type Mesaj = { tur: 'basari' | 'uyari' | 'tehlike'; metin: string };

/** Cihazın yerel saati "YYYY-MM-DDTHH:mm:ss" → "29.10.2026 13:03". Saat dilimi çevrilmez. */
function yerelTarihSaat(s: string | null): string {
  if (!s) return '—';
  return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)} ${s.slice(11, 16)}`;
}

function yerelTarih(gun: string): string {
  return `${gun.slice(8, 10)}.${gun.slice(5, 7)}.${gun.slice(0, 4)}`;
}

/** "2026-10" → o ayın ilk ve son günü; içinde bulunulan ay bugünde biter (cihaz ileri tarihi reddeder). */
function ayAraligi(ay: string): { baslangic: string; bitis: string } {
  const [yil, no] = ay.split('-').map(Number) as [number, number];
  const sonGun = new Date(yil, no, 0).getDate();
  const bitis = `${ay}-${String(sonGun).padStart(2, '0')}`;
  return { baslangic: `${ay}-01`, bitis: bitis > bugun() ? bugun() : bitis };
}

const AY_ADLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const ayAdi = (ay: string) => `${AY_ADLARI[Number(ay.slice(5, 7)) - 1]} ${ay.slice(0, 4)}`;

export function YazarkasaSayfasi() {
  const [pavoAcik, setPavoAcik] = useState<boolean | null>(null);
  const [mesgul, setMesgul] = useState<string | null>(null);
  const [mesaj, setMesaj] = useState<Mesaj | null>(null);
  const [acikRapor, setAcikRapor] = useState<PavoRaporu | null>(null);
  const [cihaz, setCihaz] = useState<CihazBilgisi | null>(null);
  const [baglanti, setBaglanti] = useState<{ basarili: boolean; mesaj: string } | null>(null);
  const gecmisYetkisi = useYetki('rapor.goruntule');

  const cihaziOku = () =>
    cagir<CihazBilgisi>('pavo.durum')
      .then(setCihaz)
      .catch(() => setCihaz(null));

  useEffect(() => {
    cagir<{ tur: string }>('pos.durum')
      .then((d) => {
        setPavoAcik(d.tur === 'PAVO');
        // Yalnız yerel kayıt okunur; sayfa açılınca cihaza istek GİTMEZ (bağlantı düğmeyle denenir).
        if (d.tur === 'PAVO') void cihaziOku();
      })
      .catch(() => setPavoAcik(false));
  }, []);

  /** Tek işlem kapısı: cihaz aynı anda tek iş yapar. */
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

  if (pavoAcik === null) return <Yukleniyor />;
  if (!pavoAcik) {
    return (
      <div className="p-4">
        <BosDurum
          baslik="Pavo kapalı"
          aciklama="Bu sayfa yazarkasa POS'u (Pavo) bağlıyken çalışır. Ayarlar → POS & Yazarkasa sekmesinden Pavo'yu seçin."
        />
      </div>
    );
  }

  const ortak = { mesgul, calistir, raporuAc: setAcikRapor };

  const baglantiyiDene = () =>
    void calistir('baglanti', async () => {
      const s = await cagir<{ basarili: boolean; mesaj: string }>('pos.test');
      setBaglanti(s);
      await cihaziOku();
    });

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 pb-8">
        <header className="flex flex-wrap items-end gap-4">
          <div className="mr-auto">
            <h1 className="text-2xl font-semibold">Yazarkasa</h1>
            <p className="text-sm text-metin-3">
              Pavo cihazının gün sonu ve mali raporları. Raporlar cihazın kâğıdına basılır, özeti burada da açılır.
            </p>
          </div>
          <CihazSeridi cihaz={cihaz} baglanti={baglanti} mesgul={mesgul} onDene={baglantiyiDene} />
        </header>

        {cihaz && cihaz.acikKayit > 0 && (
          <Uyari tur="uyari" onKapat={undefined}>
            {cihaz.acikKayit} satış yarım kalmış görünüyor. Gün sonundan önce Ayarlar → POS &amp; Yazarkasa → &quot;Yarım kalan
            satışları çöz&quot; ile tamamlayın.
          </Uyari>
        )}
        {mesaj && (
          <Uyari tur={mesaj.tur} onKapat={() => setMesaj(null)}>
            {mesaj.metin}
          </Uyari>
        )}

        <Bolum ikon="🌙" baslik="Her akşam" aciklama="Kasayı kapatırken, günde bir kez." sutun={2}>
          <GunSonuKarti {...ortak} />
          <BankaGunSonuKarti {...ortak} />
        </Bolum>

        <Bolum ikon="☀️" baslik="Gün içinde" aciklama="Günü kapatmaz; istediğiniz kadar alabilirsiniz." sutun={2}>
          <XRaporuKarti fark={false} {...ortak} />
          <XRaporuKarti fark {...ortak} />
        </Bolum>

        {gecmisYetkisi && (
          <Bolum ikon="🗂️" baslik="Geçmiş raporlar" aciklama="Hiçbiri günü kapatmaz; yalnız eski raporları getirir." sutun={3}>
            <AylikRaporKarti {...ortak} />
            <GecmisGunSonuKarti {...ortak} />
            <ArsivKarti {...ortak} />
          </Bolum>
        )}
      </div>

      <RaporDiyalogu rapor={acikRapor} onKapat={() => setAcikRapor(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Yerleşim parçaları
// ---------------------------------------------------------------------------

interface KartOzellikleri {
  mesgul: string | null;
  calistir: (ad: string, is: () => Promise<Mesaj | void>) => Promise<void>;
  raporuAc: (r: PavoRaporu) => void;
}

interface CihazBilgisi {
  adres: string;
  seriNo: string;
  acikKayit: number;
}

/** Sağ üstte cihaz kimliği ve (istenince denenen) bağlantı durumu. */
function CihazSeridi({
  cihaz,
  baglanti,
  mesgul,
  onDene,
}: {
  cihaz: CihazBilgisi | null;
  baglanti: { basarili: boolean; mesaj: string } | null;
  mesgul: string | null;
  onDene: () => void;
}) {
  const nokta = !baglanti ? 'bg-metin-4' : baglanti.basarili ? 'bg-vurgu' : 'bg-tehlike';
  return (
    <div className="kart flex items-center gap-3 px-4 py-2.5">
      <span className="text-2xl" aria-hidden>
        🧾
      </span>
      <div className="min-w-0 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          Pavo N86
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${nokta}`} aria-hidden />
          <span className="font-normal text-metin-3">
            {!baglanti ? 'denenmedi' : baglanti.basarili ? 'bağlı' : 'bağlanamadı'}
          </span>
        </p>
        <p className="font-mono text-xs text-metin-3">
          {cihaz?.seriNo || 'seri no yok'} · {cihaz?.adres || 'adres yok'}
        </p>
        {baglanti && !baglanti.basarili && <p className="max-w-xs text-xs text-tehlike">{baglanti.mesaj}</p>}
      </div>
      <button type="button" className="tus-ikincil px-3 py-1.5 text-sm" disabled={mesgul !== null} onClick={onDene}>
        {mesgul === 'baglanti' ? 'Deneniyor…' : 'Bağlantıyı Dene'}
      </button>
    </div>
  );
}

const UYARI_RENGI: Record<Mesaj['tur'], { kutu: string; ikon: string }> = {
  basari: { kutu: 'border-vurgu bg-vurgu-yumusak', ikon: '✓' },
  uyari: { kutu: 'border-uyari-cizgi bg-uyari-yumusak', ikon: '!' },
  tehlike: { kutu: 'border-tehlike-cizgi bg-tehlike-yumusak', ikon: '✕' },
};

/** İşlem sonucu: sayfanın üstünde, kapatılana kadar duran şerit. */
function Uyari({ tur, onKapat, children }: { tur: Mesaj['tur']; onKapat: (() => void) | undefined; children: ReactNode }) {
  const r = UYARI_RENGI[tur];
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${r.kutu}`} role="status">
      <span className="mt-0.5 font-bold" aria-hidden>
        {r.ikon}
      </span>
      <p className="flex-1 whitespace-pre-line text-sm text-metin">{children}</p>
      {onKapat && (
        <button type="button" className="text-metin-3 hover:text-metin" aria-label="Kapat" onClick={onKapat}>
          ✕
        </button>
      )}
    </div>
  );
}

function Bolum({
  ikon,
  baslik,
  aciklama,
  sutun,
  children,
}: {
  ikon: string;
  baslik: string;
  aciklama: string;
  sutun: 2 | 3;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-yuzey-3 text-xl" aria-hidden>
          {ikon}
        </span>
        <div>
          <h2 className="text-lg font-semibold leading-tight">{baslik}</h2>
          <p className="text-sm text-metin-3">{aciklama}</p>
        </div>
      </div>
      <div className={`grid gap-3 md:grid-cols-2 ${sutun === 3 ? 'xl:grid-cols-3' : ''}`}>{children}</div>
    </section>
  );
}

/** Günü kapatmayan kartların ortak rozeti — "basarsam gün kapanır mı?" korkusunu giderir. */
const KAPATMAZ = <Rozet tur="basari">Günü kapatmaz</Rozet>;

function Kart({
  baslik,
  ikon,
  rozet,
  tehlikeli,
  children,
}: {
  baslik: string;
  ikon: string;
  rozet?: ReactNode;
  /** Geri alınamaz işlem: kart kırmızı çerçeveyle ayrışır. */
  tehlikeli?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`kart flex flex-col gap-3 p-5 ${tehlikeli ? 'border-2 border-tehlike-cizgi' : ''}`}>
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none" aria-hidden>
          {ikon}
        </span>
        <h3 className="mr-auto text-base font-semibold">{baslik}</h3>
        {rozet}
      </div>
      {children}
    </div>
  );
}

function Aciklama({ children }: { children: ReactNode }) {
  return <p className="flex-1 text-sm text-metin-2">{children}</p>;
}

function BastirKutusu({ deger, degistir }: { deger: boolean; degistir: (d: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={deger} onChange={(e) => degistir(e.target.checked)} />
      Cihazdan kâğıda da bastır
    </label>
  );
}

// ---------------------------------------------------------------------------
// Kartlar
// ---------------------------------------------------------------------------

function GunSonuKarti({ mesgul, calistir, raporuAc }: KartOzellikleri) {
  const [bankaDa, setBankaDa] = useState(true);
  const [onay, setOnay] = useState(false);
  const al = () => {
    setOnay(false);
    void calistir('gunSonu', async () => {
      const s = await cagir<{ rapor: PavoRaporu | null; banka: { ayrintilar: string[] } | null }>('pavo.gunSonu', {
        bankaGunSonu: bankaDa,
      });
      const banka = s.banka ? 'Banka gün sonu alındı. ' : '';
      if (!s.rapor) {
        // Gün sonu ALINDI; yalnız özeti okunamadı. "Alınamadı" denmez — ikinci kez alınmasın.
        return { tur: 'uyari', metin: `${banka}Gün sonu alındı ve basıldı. Özeti okunamadı; arşivden bakabilirsiniz.` };
      }
      raporuAc(s.rapor);
      return {
        tur: 'basari',
        metin: `${banka}Gün sonu alındı${s.rapor.zNo !== null ? ` (Z No ${s.rapor.zNo})` : ''} — günün satışları kapatıldı.`,
      };
    });
  };
  return (
    <Kart baslik="Gün sonu (Z raporu)" ikon="🔒" rozet={<Rozet tur="tehlike">Geri alınamaz</Rozet>} tehlikeli>
      <Aciklama>
        Akşam kasayı kapatırken <b>günde bir kez</b> alınır. Günün satışlarını kapatır ve yasal Z raporunu basar; sonra o günün
        satışları değiştirilemez.
      </Aciklama>
      <ol className="grid gap-1.5 rounded-lg bg-yuzey-2 p-3 text-sm">
        {(bankaDa
          ? ['Banka gün sonu alınır (kart ödemeleri bankaya gider)', 'Cihaz Z raporunu basar', 'Raporun özeti ekranda açılır']
          : ['Cihaz Z raporunu basar', 'Raporun özeti ekranda açılır']
        ).map((adim, i) => (
          <li key={adim} className="flex items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-yuzey text-xs font-bold text-metin-2">
              {i + 1}
            </span>
            {adim}
          </li>
        ))}
      </ol>
      <p className="text-xs text-metin-3">
        Pavo'da &quot;Z raporu&quot; diye ayrı seçenek yok; cihaz bu raporu &quot;Terminal Satış Raporu&quot; adıyla basar.
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={bankaDa} onChange={(e) => setBankaDa(e.target.checked)} />
        <span>
          Önce banka gün sonunu da al <span className="text-metin-3">(önerilir)</span>
        </span>
      </label>
      <button type="button" className="tus-tehlike py-3 text-base" disabled={mesgul !== null} onClick={() => setOnay(true)}>
        {mesgul === 'gunSonu' ? 'Gün sonu alınıyor…' : 'Gün Sonunu Al'}
      </button>
      <OnayDiyalogu
        acik={onay}
        baslik="Gün sonu alınsın mı?"
        mesaj={`Bugünün satışları kapatılacak ve Z raporu basılacak. Bu işlem GERİ ALINAMAZ.${bankaDa ? ' Önce banka gün sonu alınacak.' : ''}`}
        onaylaMetni="Evet, gün sonunu al"
        tehlikeli
        onOnayla={al}
        onIptal={() => setOnay(false)}
      />
    </Kart>
  );
}

function BankaGunSonuKarti({ mesgul, calistir }: KartOzellikleri) {
  return (
    <Kart baslik="Banka gün sonu" ikon="🏦" rozet={KAPATMAZ}>
      <Aciklama>
        Gün içindeki kart ödemelerini bankaya gönderir; para hesabınıza bu işlemden sonra geçer. Gerekirse tekrar alınabilir.
        <span className="mt-2 block text-metin-3">
          Gün sonu kartındaki &quot;Önce banka gün sonunu da al&quot; işaretliyse ayrıca almanız gerekmez.
        </span>
      </Aciklama>
      <button
        type="button"
        className="tus-ikincil"
        disabled={mesgul !== null}
        onClick={() =>
          void calistir('banka', async () => {
            const s = await cagir<{ basarili: boolean; ayrintilar: string[] }>('pavo.bankaGunSonu');
            return { tur: s.basarili ? 'basari' : 'tehlike', metin: `Banka gün sonu: ${s.ayrintilar.join(' · ')}` };
          })
        }
      >
        {mesgul === 'banka' ? 'Bankaya gönderiliyor…' : 'Banka Gün Sonu Al'}
      </button>
    </Kart>
  );
}

function XRaporuKarti({ fark, mesgul, calistir, raporuAc }: KartOzellikleri & { fark: boolean }) {
  const ad = fark ? 'xFark' : 'x';
  return (
    <Kart baslik={fark ? 'X fark raporu' : 'X raporu'} ikon={fark ? '🔁' : '📄'} rozet={KAPATMAZ}>
      <Aciklama>
        {fark
          ? 'Son gün sonundan bu yana yapılan satışların özeti. Gün sonu almadan önce kontrol için kullanılır.'
          : 'Bugün şu ana kadar yapılan satışların özeti. Vardiya değişiminde ya da kasayı sayarken işe yarar.'}
      </Aciklama>
      <button
        type="button"
        className="tus-ikincil"
        disabled={mesgul !== null}
        onClick={() =>
          void calistir(ad, async () => {
            const r = await cagir<PavoRaporu | null>('pavo.xRaporu', { fark });
            if (!r) return { tur: 'uyari', metin: 'Rapor cihazda basıldı ama içeriği gelmedi.' };
            raporuAc(r);
          })
        }
      >
        {mesgul === ad ? 'Cihaz raporu basıyor…' : fark ? 'X Fark Raporu Al' : 'X Raporu Al'}
      </button>
    </Kart>
  );
}

function AylikRaporKarti({ mesgul, calistir, raporuAc }: KartOzellikleri) {
  const [ay, setAy] = useState(() => ayBasi().slice(0, 7));
  const [bastir, setBastir] = useState(false);
  // Cihaz en fazla 12 ay geriye izin veriyor.
  const enEski = gunEkle(bugun(), -365).slice(0, 7);
  return (
    <Kart baslik="Aylık rapor" ikon="📅">
      <Aciklama>
        Seçtiğiniz ayın satış özeti — <b>mali müşavirin istediği rapor</b>. İçinde bulunulan ay seçilirse bugüne kadar olan kısım
        gelir. En fazla 12 ay geriye.
      </Aciklama>
      <input
        type="month"
        className="alan"
        value={ay}
        min={enEski}
        max={bugun().slice(0, 7)}
        onChange={(e) => setAy(e.target.value)}
      />
      <BastirKutusu deger={bastir} degistir={setBastir} />
      <button
        type="button"
        className="tus-ikincil"
        disabled={mesgul !== null || !ay}
        onClick={() =>
          void calistir('aylik', async () => {
            const r = await cagir<PavoRaporu | null>('pavo.donemRaporu', { ...ayAraligi(ay), bastir });
            if (!r) return { tur: 'uyari', metin: `${ayAdi(ay)} için cihaz rapor döndürmedi.` };
            raporuAc(r);
          })
        }
      >
        {mesgul === 'aylik' ? 'Rapor hazırlanıyor…' : `${ay ? ayAdi(ay) : 'Ay'} Raporunu Getir`}
      </button>
    </Kart>
  );
}

function GecmisGunSonuKarti({ mesgul, calistir, raporuAc }: KartOzellikleri) {
  const [tarih, setTarih] = useState(() => gunEkle(bugun(), -1));
  const [bastir, setBastir] = useState(false);
  return (
    <Kart baslik="Geçmiş gün sonu" ikon="🔎">
      <Aciklama>
        Belirli bir günün Z raporunu yeniden getirir. Kaybolan bir Z fişinin yerine nüsha bastırmak için de kullanılır. Yeni rapor
        oluşturmaz.
      </Aciklama>
      <input type="date" className="alan" value={tarih} max={bugun()} onChange={(e) => setTarih(e.target.value)} />
      <BastirKutusu deger={bastir} degistir={setBastir} />
      <button
        type="button"
        className="tus-ikincil"
        disabled={mesgul !== null || !tarih}
        onClick={() =>
          void calistir('gecmisZ', async () => {
            const r = await cagir<PavoRaporu | null>('pavo.gecmisGunSonu', { tarih, bastir });
            if (!r) return { tur: 'uyari', metin: `${yerelTarih(tarih)} tarihinde gün sonu alınmamış.` };
            raporuAc(r);
          })
        }
      >
        {mesgul === 'gecmisZ' ? 'Getiriliyor…' : 'Gün Sonunu Getir'}
      </button>
    </Kart>
  );
}

function ArsivKarti({ mesgul, calistir, raporuAc }: KartOzellikleri) {
  const [liste, setListe] = useState<PavoRaporu[] | null>(null);
  // Cihaz en fazla 31 günlük aralık listeler.
  const aralik = { baslangic: gunEkle(bugun(), -30), bitis: bugun() };
  const ac = (satir: PavoRaporu) =>
    void calistir('ozet', async () => {
      const ozet = await cagir<PavoRaporu | null>('pavo.raporOzeti', { raporId: satir.raporId });
      // Liste satırı Z numarasını, özet kırılımı taşır — ikisi birleşir.
      raporuAc(ozet ? pavoRaporBirlestir(ozet, satir) : satir);
    });
  return (
    <Kart baslik="Rapor arşivi" ikon="🗄️">
      <Aciklama>
        Cihazın son 30 günde ürettiği raporlar. Birine tıklayınca ayrıntısı açılır; oradan nüshasını bastırabilirsiniz.
      </Aciklama>
      <button
        type="button"
        className="tus-ikincil"
        disabled={mesgul !== null}
        onClick={() =>
          void calistir('arsiv', async () => {
            const l = await cagir<PavoRaporu[]>('pavo.raporArsivi', aralik);
            setListe(l);
            if (l.length === 0) return { tur: 'uyari', metin: 'Son 30 günde cihazda rapor yok.' };
          })
        }
      >
        {mesgul === 'arsiv' ? 'Listeleniyor…' : liste ? 'Yenile' : 'Raporları Listele'}
      </button>
      {liste && liste.length > 0 && (
        <ul className="max-h-72 divide-y divide-cizgi overflow-auto rounded-lg border border-cizgi text-sm">
          {liste.map((r) => (
            <li key={r.raporId}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-yuzey-2 disabled:opacity-50"
                disabled={mesgul !== null}
                onClick={() => ac(r)}
              >
                <span className="w-32 text-metin-3">{yerelTarihSaat(r.olusturma)}</span>
                <span className="flex-1">
                  {pavoRaporBasligi(r)}
                  {r.zNo !== null && <span className="ml-1 text-metin-3">· Z No {r.zNo}</span>}
                </span>
                <span className="tabular-nums">{paraFormat(r.satisTutari)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Kart>
  );
}

// ---------------------------------------------------------------------------
// Rapor ayrıntısı
// ---------------------------------------------------------------------------

function RaporDiyalogu({ rapor, onKapat }: { rapor: PavoRaporu | null; onKapat: () => void }) {
  const [basiliyor, setBasiliyor] = useState(false);
  const nushaYetkisi = useYetki('rapor.goruntule');
  if (!rapor) return null;

  const nusha = async () => {
    setBasiliyor(true);
    try {
      await cagir('pavo.raporNushasi', { raporId: rapor.raporId });
      bildir.basari('Nüsha cihazda basıldı');
    } catch (hata) {
      bildir.hata('Nüsha basılamadı', hata instanceof Error ? hata.message : String(hata));
    } finally {
      setBasiliyor(false);
    }
  };

  // Cihazın hazır nakit/kart toplamı yoksa ödeme satırlarından bulunur.
  const odemeToplami = (anahtar: string) =>
    rapor.odemeler.filter((o) => o.ad.toLocaleLowerCase('tr').includes(anahtar)).reduce((t, o) => t + o.net, 0);
  const nakit = rapor.nakit ?? odemeToplami('nakit');
  const kart = rapor.kart ?? odemeToplami('kart');
  const kdv = rapor.kdvToplami ?? rapor.kdvler.reduce((t, k) => t + k.kdv, 0);

  return (
    <Diyalog
      acik
      baslik={pavoRaporBasligi(rapor)}
      aciklama={
        rapor.ilkIslem ? `${yerelTarihSaat(rapor.ilkIslem)} – ${yerelTarihSaat(rapor.sonIslem)} arası satışlar` : undefined
      }
      genislik="genis"
      onKapat={onKapat}
      altBilgi={
        <>
          {nushaYetkisi && rapor.raporId > 0 && (
            <button type="button" className="tus-ikincil" disabled={basiliyor} onClick={() => void nusha()}>
              {basiliyor ? 'Basılıyor…' : 'Nüshasını Bastır'}
            </button>
          )}
          <button type="button" className="tus-birincil" onClick={onKapat} data-odak>
            Kapat
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-2 text-sm">
          {rapor.zNo !== null && <Rozet tur="bilgi">Z No {rapor.zNo}</Rozet>}
          {rapor.olusturma && <span className="text-metin-3">Oluşturulma: {yerelTarihSaat(rapor.olusturma)}</span>}
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Kutu etiket="Net satış" deger={pavoRaporNet(rapor)} vurgu />
          <Kutu etiket={`Satış (${rapor.satisAdedi} işlem)`} deger={rapor.satisTutari} />
          <Kutu etiket={`İptal / iade (${rapor.iptalAdedi})`} deger={rapor.iptalTutari} />
          <Kutu etiket="Toplam KDV" deger={kdv} />
          <Kutu etiket="Nakit" deger={nakit} />
          <Kutu etiket="Kart" deger={kart} />
        </div>

        {rapor.odemeler.length > 0 && (
          <Tablo
            baslik="Ödeme türleri"
            basliklar={['Ödeme', 'Adet', 'Tutar', 'İptal', 'Net']}
            satirlar={rapor.odemeler.map((o) => [
              o.ad,
              String(o.adet),
              paraFormat(o.tutar),
              o.iptalAdedi ? `${o.iptalAdedi} · ${paraFormat(o.iptalTutari)}` : '—',
              paraFormat(o.net),
            ])}
          />
        )}
        {rapor.kdvler.length > 0 && (
          <Tablo
            baslik="KDV oranlarına göre"
            basliklar={['Oran', 'Matrah (KDV hariç)', 'KDV']}
            satirlar={rapor.kdvler.map((k) => [k.oran, paraFormat(k.matrah), paraFormat(k.kdv)])}
          />
        )}
        {rapor.belgeler.length > 0 && (
          <Tablo
            baslik="Belgeler"
            basliklar={['Belge', 'Adet', 'Tutar']}
            satirlar={rapor.belgeler.map((b) => [b.ad, String(b.adet), paraFormat(b.tutar)])}
          />
        )}
        {rapor.urunler.length > 0 && (
          <Tablo
            baslik="Ürünler"
            basliklar={['Ürün', 'Miktar', 'Tutar']}
            satirlar={rapor.urunler.map((u) => [u.ad, miktarFormat(Math.round(u.miktar * 1000)), paraFormat(u.tutar)])}
          />
        )}
      </div>
    </Diyalog>
  );
}

function Kutu({ etiket, deger, vurgu }: { etiket: string; deger: Kurus; vurgu?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${vurgu ? 'border-vurgu bg-vurgu-yumusak' : 'border-cizgi'}`}>
      <div className="text-xs text-metin-3">{etiket}</div>
      <div className={`tabular-nums ${vurgu ? 'text-xl font-bold text-vurgu' : 'text-base font-semibold'}`}>
        {paraFormat(deger)}
      </div>
    </div>
  );
}

function Tablo({ baslik, basliklar, satirlar }: { baslik: string; basliklar: string[]; satirlar: string[][] }) {
  return (
    <div>
      <h4 className="mb-1 text-sm font-medium">{baslik}</h4>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-cizgi text-left text-metin-3">
            {basliklar.map((b, i) => (
              <th key={b} className={`py-1 font-normal ${i > 0 ? 'text-right' : ''}`}>
                {b}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {satirlar.map((s, i) => (
            <tr key={i} className="border-b border-cizgi/50">
              {s.map((h, j) => (
                <td key={j} className={`py-1 ${j > 0 ? 'text-right tabular-nums' : ''}`}>
                  {h}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
