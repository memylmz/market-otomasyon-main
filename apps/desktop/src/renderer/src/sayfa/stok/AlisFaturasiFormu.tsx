/**
 * Mal kabul + alış faturası — tek form (§11.8).
 *
 * Toptancıdan gelen malın çoğu katalogda yoktur: barkod okutulup ürün
 * bulunamazsa satır "yeni ürün" olur, kaydedince ürün kartı fatura ile AYNI
 * transaction'da açılır (bkz. stok-servis.ts `malKabulOnayla`). Mal Kabul
 * artık ayrı bir diyalog DEĞİLDİR — bu form hem Stok ekranındaki "Mal Kabul"
 * düğmesinden, hem Alış sekmesinden, hem Ürünler ekranından açılır; hepsi
 * aynı `stok.malKabul` çağrısını yapar. Satır→kalem çevrimi ve marj hesabı
 * `topluGirisKalemleri`den (@market/shared) geçer — aynı satırdan iki ekran
 * farklı fatura üretmesin diye hesap burada TEKRAR YAZILMAZ.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  gunAnahtari,
  paraFormat,
  topluGirisKalemleri,
  faturaToplamlari,
  satirOzeti,
  paraParse,
  KDV_ORANLARI,
  VARSAYILAN_KDV_ORANI,
  carpanCoz,
  satiriKat,
  sktSutunuGerekli,
  type AlisSatiri,
  type Kurus,
  type TopluGirisSatiri,
} from '@market/shared';
import { Alan, Diyalog, ParaAlani, Rozet } from '../../bilesen/temel';
import { UrunSecici, type SecilenUrun } from '../../bilesen/UrunSecici';
import { bildir, hatayiBildir } from '../../durum/bildirim';
import { cagir } from '../../kopru';

interface Tedarikci {
  id: string;
  ad_unvan: string;
}

interface Kategori {
  id: string;
  ad: string;
}

type OdemeDurumu = 'NAKIT' | 'HAVALE' | 'BORC';

/**
 * Satır tipi ve satır kararları `alis-satir.ts` içinde, saf ve TEST EDİLMİŞ
 * hâlde durur; bu dosya yalnız çizim yapar. Arayüz katmanında otomatik test
 * olmadığı için mantığın burada kalması, mal kabuldeki bir hatanın ancak
 * stok sayımında fark edilmesi demekti.
 */
type Satir = AlisSatiri;

function bosSatir(barkod = ''): Satir {
  return {
    barkod,
    ad: '',
    miktar: '1',
    alis: 0,
    satis: 0,
    kdv: String(VARSAYILAN_KDV_ORANI),
    skt: '',
    lot: '',
    sktZorunlu: false,
  };
}

export function AlisFaturasiFormu({ acik, onKapat, onTamam }: { acik: boolean; onKapat: () => void; onTamam: () => void }) {
  const [tedarikciler, setTedarikciler] = useState<Tedarikci[]>([]);
  const [tedarikciId, setTedarikciId] = useState('');
  const [faturaNo, setFaturaNo] = useState('');
  const [faturaTarihi, setFaturaTarihi] = useState(() => gunAnahtari());
  const [vadeTarihi, setVadeTarihi] = useState('');
  const [odemeDurumu, setOdemeDurumu] = useState<OdemeDurumu>('BORC');
  /**
   * `null` = kullanıcı tutara hiç dokunmadı → "ödedim" iken genel toplamı
   * TAKİP EDER (satır eklenip silinince otomatik güncellenir). Kullanıcı
   * ParaAlani'ye yazdığı an burada somut bir Kurus değeri olarak sabitlenir
   * ve artık genel toplam değişse de ÜZERİNE YAZILMAZ — kısmi ödeme budur.
   */
  const [odenenTutarElle, setOdenenTutarElle] = useState<Kurus | null>(null);
  const [notlar, setNotlar] = useState('');
  const [kategoriler, setKategoriler] = useState<Kategori[]>([]);
  const [kategoriId, setKategoriId] = useState('');
  const [marjYuzde, setMarjYuzde] = useState('');
  const [satirlar, setSatirlar] = useState<Satir[]>([]);
  const [barkodGirdi, setBarkodGirdi] = useState('');
  const [aramaAcik, setAramaAcik] = useState(false);
  /** Hangi satır mevcut bir ürüne bağlanmayı bekliyor (null = yok). */
  const [baglanacak, setBaglanacak] = useState<number | null>(null);
  /**
   * Toptancının kâğıdında yazan genel toplam. Girilirse ekrandaki toplamla
   * karşılaştırılır. Alış faturası girmenin ASIL işi budur: rakamlar tutuyor
   * mu? Eskiden kullanıcı bunu ancak kaydedip ekstreye bakınca anlıyordu.
   */
  const [beyanToplam, setBeyanToplam] = useState('');
  /** Fatura üst bilgileri katlanır bölümde; varsayılan kapalı (iş barkod alanında başlar). */
  const [detayAcik, setDetayAcik] = useState(false);
  /** Son silinen satır — yanlışlıkla silinen kalem kırk satırlık faturada yeniden okutulamıyordu. */
  const [silinen, setSilinen] = useState<{ satir: Satir; sira: number } | null>(null);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  /** Son okutulan/birleşen satır — kısa süre vurgulanır ki kullanıcı ne olduğunu görsün. */
  const [vurgulu, setVurgulu] = useState<number | null>(null);
  const vurguZamanlayici = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barkodAlani = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!acik) return;
    setTedarikciId('');
    setFaturaNo('');
    setFaturaTarihi(gunAnahtari());
    setVadeTarihi('');
    setOdemeDurumu('BORC');
    setOdenenTutarElle(null);
    setNotlar('');
    setKategoriId('');
    setMarjYuzde('');
    setSatirlar([]);
    setBarkodGirdi('');
    setAramaAcik(false);
    setBeyanToplam('');
    setDetayAcik(false);
    setSilinen(null);
    cagir<{ kayitlar: Tedarikci[] }>('cari.listele', { filtre: { tip: 'TEDARIKCI' }, limit: 200 })
      .then((v) => setTedarikciler(v.kayitlar))
      .catch(() => setTedarikciler([]));
    // kategori.listele DÜZ DİZİ döner — cari.listele/urun.listele'nin aksine {kayitlar} sarmalı DEĞİL.
    cagir<Kategori[]>('kategori.listele')
      .then(setKategoriler)
      .catch(() => setKategoriler([]));
  }, [acik]);

  const vurgula = (sira: number) => {
    setVurgulu(sira);
    if (vurguZamanlayici.current) clearTimeout(vurguZamanlayici.current);
    vurguZamanlayici.current = setTimeout(() => setVurgulu(null), 1200);
  };

  useEffect(() => () => void (vurguZamanlayici.current && clearTimeout(vurguZamanlayici.current)), []);

  /*
   * Yeni ürün satırında odak AD ALANINA gider, barkod alanına değil.
   *
   * Satır "adını ve satış fiyatını girin" diyordu ama imleç orada değildi;
   * her yeni üründe fareye uzanmak gerekiyordu. Toptancıda yirmi yeni ürün
   * varsa yirmi fare hareketi demekti. Yeni satır listenin BAŞINA eklendiği
   * için ilk `[data-ad-alani]` odaklanacak olandır.
   */
  const adaOdaklan = () => {
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-ad-alani]')?.focus());
  };

  /*
   * Yeni ürün satırını MEVCUT bir ürüne bağlar.
   *
   * Sahadaki en sık karışıklık: ürün katalogda vardır ama elindeki ambalajın
   * barkodu kartına kayıtlı değildir; okutulunca "bulunamadı" der ve kullanıcı
   * mükerrer ürün açar. Burada satır mevcut ürüne bağlanır ve OKUTULAN BARKOD
   * satırda kalır — fatura kaydedilirken o ürüne eklenir, bir daha sorulmaz.
   */
  const satiriUruneBagla = (sira: number, urun: SecilenUrun) => {
    setSatirlar((liste) =>
      liste.map((s, j) =>
        j === sira
          ? {
              ...s,
              ad: urun.ad,
              // Kullanıcı alış fiyatını girdiyse ona dokunma; girmediyse karttan doldur.
              alis: s.alis || urun.alis_fiyati,
              satis: urun.satis_fiyati,
              kdv: String(urun.kdv_orani),
              urun_id: urun.id,
              sktZorunlu: urun.skt_takibi === true,
            }
          : s,
      ),
    );
    setBaglanacak(null);
    vurgula(sira);
  };

  const satirEkleMevcut = (urun: SecilenUrun, adet = 1) => {
    const sonuc = satiriKat(
      satirlar,
      {
        barkod: urun.barkodlar[0] ?? '',
        ad: urun.ad,
        miktar: '1',
        alis: urun.alis_fiyati,
        satis: urun.satis_fiyati,
        kdv: String(urun.kdv_orani),
        skt: '',
        lot: '',
        urun_id: urun.id,
        sktZorunlu: urun.skt_takibi === true,
      },
      adet,
    );
    setSatirlar(sonuc.satirlar);
    vurgula(sonuc.vurgulanan);
  };

  /**
   * Barkod alanı akışın merkezidir: eli okuyucuda olan kasiyer/patron için
   * bulunan ürün doğrudan satıra bağlanır, bulunamayan barkod "yeni ürün"
   * satırı açar, boş Enter ise barkodsuz yeni ürün satırı açar (§brief 5-6).
   */
  const barkodEnter = async (tus: KeyboardEvent<HTMLInputElement>) => {
    if (tus.key !== 'Enter') return;
    tus.preventDefault();
    // "12*8690..." → koli girişini tek harekete indirir (kasadaki çarpan alışkanlığı).
    const { carpan, barkod } = carpanCoz(barkodGirdi);
    setBarkodGirdi('');

    if (!barkod) {
      const sonuc = satiriKat(satirlar, bosSatir(), carpan);
      setSatirlar(sonuc.satirlar);
      vurgula(sonuc.vurgulanan);
      adaOdaklan();
      return;
    }

    try {
      const sonuc = await cagir<{ bulundu: boolean; urun?: SecilenUrun }>('urun.barkodOku', { barkod });
      if (sonuc.bulundu && sonuc.urun) {
        satirEkleMevcut(sonuc.urun, carpan);
        // Kartlı ürün tamam: el okuyucuda kalsın, sıradaki okutulsun.
        barkodAlani.current?.focus();
      } else {
        const kat = satiriKat(satirlar, bosSatir(barkod), carpan);
        setSatirlar(kat.satirlar);
        vurgula(kat.vurgulanan);
        if (!kat.birlesti) {
          bildir.uyari(
            `"${barkod}" katalogda yok`,
            'YENİ ÜRÜN olarak açılacak. Ürün zaten varsa bu barkod ona kayıtlı değil demektir — ürün kartından ekleyebilirsiniz.',
          );
          adaOdaklan();
        } else {
          barkodAlani.current?.focus();
        }
      }
    } catch (hata) {
      hatayiBildir(hata, 'Barkod');
      barkodAlani.current?.focus();
    }
  };

  const guncelle = (i: number, yama: Partial<Satir>) =>
    setSatirlar((liste) => liste.map((x, j) => (j === i ? { ...x, ...yama } : x)));

  /*
   * Silinen satır GERİ ALINABİLİR tutulur. Kırk kalemlik faturada yanlış ✕
   * tıklamasının bedeli, koliyi bulup barkodu yeniden okutmaktı.
   */
  const satirSil = (i: number) => {
    const hedef = satirlar[i];
    if (hedef) setSilinen({ satir: hedef, sira: i });
    setSatirlar((liste) => liste.filter((_, j) => j !== i));
  };

  const silmeyiGeriAl = () => {
    if (!silinen) return;
    setSatirlar((liste) => {
      const kopya = [...liste];
      kopya.splice(Math.min(silinen.sira, kopya.length), 0, silinen.satir);
      return kopya;
    });
    vurgula(Math.min(silinen.sira, satirlar.length));
    setSilinen(null);
  };

  // Satır → TopluGirisSatiri: ekranda Kurus tutulan alis/satis burada TR biçimli
  // metne çevrilir, çünkü topluGirisKalemleri (kasa ve panelle ORTAK) metin bekler.
  const donusumSatirlari = useMemo<TopluGirisSatiri[]>(
    () =>
      satirlar.map((s) => ({
        barkod: s.barkod,
        ad: s.ad,
        miktar: s.miktar,
        alis: s.alis === 0 ? '' : paraFormat(s.alis, { simge: false }),
        satis: s.satis === 0 ? '' : paraFormat(s.satis, { simge: false }),
        kdv: s.kdv,
        skt: s.skt,
        lot: s.lot,
        urun_id: s.urun_id,
      })),
    [satirlar],
  );

  const marjSayi = useMemo(() => {
    const metin = marjYuzde.trim().replace(',', '.');
    if (!metin) return undefined;
    const sayi = Number(metin);
    return Number.isFinite(sayi) ? sayi : undefined;
  }, [marjYuzde]);

  const { kalemler, hatalar } = useMemo(() => {
    const sonuc = topluGirisKalemleri(donusumSatirlari, { marjYuzde: marjSayi });
    // Kategori yalnız YENİ ürünlere uygulanır. Bu bir hesap değil, seçilmiş
    // veriyi iliştirmektir — topluGirisKalemleri'nin işini burada tekrarlamaz.
    const kategoriliKalemler = sonuc.kalemler.map((k) =>
      k.yeni_urun ? { ...k, yeni_urun: { ...k.yeni_urun, kategori_id: kategoriId || null } } : k,
    );
    return { kalemler: kategoriliKalemler, hatalar: sonuc.hatalar };
  }, [donusumSatirlari, marjSayi, kategoriId]);

  const { araToplam, kdvToplam, genelToplam } = useMemo(() => faturaToplamlari(kalemler), [kalemler]);

  /*
   * Satır başına tutar ve kâr marjı.
   *
   * Tutar olmadan toptancının kâğıdıyla satır satır karşılaştırma yapılamıyor,
   * marj olmadan da alışın altına satış yazıldığı ancak raf etiketi basıldıktan
   * sonra fark ediliyordu. Hesap `satirOzeti` (ortak) ile yapılır — ekranda
   * görünen tutarla kaydedilen tutarın ayrışma ihtimali kalmasın.
   */
  const ozetler = useMemo(
    () => donusumSatirlari.map((satir) => satirOzeti(satir, marjSayi)),
    [donusumSatirlari, marjSayi],
  );

  /** Hangi satır numaraları hatalı — satırı kırmızı işaretlemek için. */
  const hataliSatirlar = useMemo(() => new Set(hatalar.map((h) => h.satir)), [hatalar]);

  /*
   * Toptancının kâğıdındaki toplam ile ekrandaki toplamın farkı.
   * `null` = kullanıcı beyan girmedi (kontrol kapalı).
   */
  const beyanFarki = useMemo(() => {
    const beyan = paraParse(beyanToplam);
    if (beyan === null || satirlar.length === 0) return null;
    return { beyan, fark: genelToplam - beyan };
  }, [beyanToplam, genelToplam, satirlar.length]);

  // Borç kalsın → 0 ve alan kapalı. Ödedim (nakit/havale) → kullanıcı elle yazmadıysa genel toplamı TAKİP eder;
  // yazdıysa o değer kalır — tam ödeme de kısmi ödeme de aynı alanla, ayrı bir "kısmi" seçeneği icat edilmeden.
  const odenenTutar = odemeDurumu === 'BORC' ? 0 : (odenenTutarElle ?? genelToplam);
  // Servis zaten reddeder ("Ödenen tutar fatura toplamından fazla olamaz"); burada kaydetmeden ÖNCE gösterilir.
  const odenenTutarAsimi = odemeDurumu !== 'BORC' && odenenTutar > genelToplam;

  // SKT takibi açık ürünlerde tarih girilmeden onay verilmez (ürün kartındaki söz; mevcut Mal Kabul davranışı korunur).
  const sktEksikler = satirlar.filter((s) => s.sktZorunlu && !s.skt.trim());
  /*
   * SKT ve lot sütunları yalnız GEREKTİĞİNDE açılır.
   *
   * Dokuz sütun yan yana dizilince ürün adı ve fiyatlar sıkışıyordu; oysa son
   * kullanma tarihi yalnız kartında SKT takibi açık üründe anlamlı.
   */
  const sktGerekli = sktSutunuGerekli(satirlar);
  /** Kaç satır yeni ürün açacak — sayaçta gösterilir. */
  const yeniSatirSayisi = satirlar.filter((s) => !s.urun_id).length;

  const kaydedilebilir =
    Boolean(tedarikciId) &&
    kalemler.length > 0 &&
    hatalar.length === 0 &&
    sktEksikler.length === 0 &&
    !odenenTutarAsimi &&
    !gonderiliyor;

  const gonder = async () => {
    if (!kaydedilebilir) return;
    setGonderiliyor(true);
    try {
      const sonuc = await cagir<{ faturaId: string; genelToplam: Kurus; kalemSayisi: number; odenen: Kurus; kalanBorc: Kurus }>(
        'stok.malKabul',
        {
          tedarikci_id: tedarikciId,
          fatura_no: faturaNo.trim() || undefined,
          tarih: `${faturaTarihi}T00:00:00.000Z`,
          vade_tarihi: vadeTarihi || undefined,
          notlar: notlar.trim() || undefined,
          odenen_tutar: odenenTutar,
          odeme_tipi: odemeDurumu === 'BORC' ? undefined : odemeDurumu,
          kalemler,
        },
      );
      const yeniUrunSayisi = kalemler.filter((k) => k.yeni_urun).length;
      const yeniUrunEki = yeniUrunSayisi > 0 ? ` · ${yeniUrunSayisi} yeni ürün açıldı` : '';
      bildir.basari(
        'Mal kabul kaydedildi',
        sonuc.odenen > 0
          ? `${sonuc.kalemSayisi} kalem · Toplam ${paraFormat(sonuc.genelToplam)} · Ödenen ${paraFormat(sonuc.odenen)} · Kalan borç ${paraFormat(sonuc.kalanBorc)}${yeniUrunEki}`
          : `${sonuc.kalemSayisi} kalem · ${paraFormat(sonuc.genelToplam)} tedarikçi borcu kaydedildi${yeniUrunEki}`,
      );
      onTamam();
    } catch (hata) {
      // Diyalog burada KAPATILMAZ: toptancının önünde girilen satırlar kaybolmamalı.
      hatayiBildir(hata, 'Mal kabul');
    } finally {
      setGonderiliyor(false);
    }
  };

  /*
   * F2 = kaydet. Toptancı karşısında iş klavye ve okuyucuyla yürüyor; kaydet
   * düğmesi için fareye uzanmak akışı kesiyordu. `gonder` kendi içinde
   * `kaydedilebilir` kontrolü yapar, yarım fatura kazara yazılmaz.
   *
   * Dinleyici SABİT kalsın diye en güncel `gonder` bir ref'te taşınır; bağımlılığa
   * konsaydı her tuş vuruşunda pencere dinleyicisi sökülüp yeniden takılırdı.
   */
  const gonderRef = useRef(gonder);
  gonderRef.current = gonder;
  useEffect(() => {
    if (!acik) return;
    const dinleyici = (olay: globalThis.KeyboardEvent) => {
      if (olay.key !== 'F2') return;
      olay.preventDefault();
      void gonderRef.current();
    };
    window.addEventListener('keydown', dinleyici);
    return () => window.removeEventListener('keydown', dinleyici);
  }, [acik]);

  /** Katlanır bölüm kapalıyken üst bilgilerin tek satırlık özeti. */
  const detayOzeti = [
    faturaNo.trim() ? `Fatura ${faturaNo.trim()}` : 'Fatura no yok',
    faturaTarihi.split('-').reverse().join('.'),
    odemeDurumu === 'BORC' ? 'Borç kalacak' : odemeDurumu === 'NAKIT' ? 'Nakit ödendi' : 'Havale/kart',
    marjYuzde.trim() ? `Marj %${marjYuzde.trim()}` : 'Marj girilmedi',
    kategoriId ? (kategoriler.find((k) => k.id === kategoriId)?.ad ?? 'Kategori') : 'Kategorisiz',
  ].join(' · ');

  return (
    <Diyalog
      acik={acik}
      baslik="Mal Kabul / Alış Faturası"
      genislik="tam"
      /* Gövde kendi kaymaz: üst şerit ve toplamlar sabit kalır, yalnız tablo kayar. */
      kaydirma={false}
      onKapat={onKapat}
      altBilgi={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          {/*
            Toplamlar alt şeride TAŞINDI. Eskiden tablonun altındaydı; kırk
            kalemlik faturada kullanıcı toplamı görmek için aşağı kaydırmak,
            satır eklemek için yukarı dönmek zorundaydı.
          */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <span className="text-metin-3">
              Ara toplam <span className="font-mono text-metin">{paraFormat(araToplam, { simge: false })}</span>
            </span>
            <span className="text-metin-3">
              KDV <span className="font-mono text-metin">{paraFormat(kdvToplam, { simge: false })}</span>
            </span>
            <span className="font-medium">
              Genel toplam <span className="font-mono text-lg font-bold">{paraFormat(genelToplam)}</span>
            </span>
            {odenenTutar > 0 && (
              <span className="text-metin-3">
                Ödenen <span className="font-mono text-vurgu">{paraFormat(odenenTutar)}</span>
              </span>
            )}
            <span className="text-metin-3">
              Kalan borç{' '}
              <span className="font-mono font-bold text-uyari">{paraFormat(Math.max(0, genelToplam - odenenTutar))}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="tus-ikincil" onClick={onKapat}>
              Vazgeç
            </button>
            <button type="button" className="tus-birincil" onClick={() => void gonder()} disabled={!kaydedilebilir}>
              {gonderiliyor ? 'Kaydediliyor…' : 'Faturayı Kaydet (F2)'}
            </button>
          </div>
        </div>
      }
    >
      {/*
        ÜST ŞERİT — formun tamamında sürekli kullanılan iki alan: tedarikçi ve
        barkod. Eskiden dokuz alanlık bir ızgara ekranın üçte birini kaplıyor,
        günde yüz kez kullanılan barkod alanı "Notlar" ile aynı görsel ağırlıkta
        aralarında kayboluyordu.
      */}
      <div className="shrink-0 border-b border-cizgi pb-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block w-56 shrink-0">
            <span className="etiket">Tedarikçi *</span>
            <select
              className={`alan ${tedarikciId ? '' : 'border-uyari-cizgi'}`}
              value={tedarikciId}
              onChange={(e) => setTedarikciId(e.target.value)}
              data-odak
            >
              <option value="">Seçiniz…</option>
              {tedarikciler.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.ad_unvan}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-[260px] flex-1">
            <span className="etiket">Barkod — okutun ya da yazıp Enter&apos;layın</span>
            <input
              ref={barkodAlani}
              className="alan h-11 text-lg"
              value={barkodGirdi}
              onChange={(e) => setBarkodGirdi(e.target.value)}
              onKeyDown={(e) => void barkodEnter(e)}
              placeholder="Barkod okutun…  (koli: 12*barkod · boş Enter: barkodsuz yeni ürün)"
            />
          </label>
          <button type="button" className="tus-ikincil h-11" onClick={() => setAramaAcik((a) => !a)}>
            {aramaAcik ? 'Aramayı kapat' : 'İsimle ekle'}
          </button>
          <div className="ml-auto text-right leading-tight">
            <div className="text-xs text-metin-3">
              {satirlar.length} satır
              {yeniSatirSayisi > 0 && <span className="text-bilgi"> · {yeniSatirSayisi} yeni ürün</span>}
            </div>
            <div className="font-mono text-xl font-bold">{paraFormat(genelToplam)}</div>
          </div>
        </div>

        {/*
          Fatura üst bilgileri katlanır. Bunlar fatura başına BİR KEZ girilir;
          sürekli açık durmaları ekranın asıl işi olan kalem listesinden yer
          çalıyordu. Kapalıyken de ne seçildiği özet satırında okunur.
        */}
        <details
          className="mt-2 rounded border border-cizgi bg-yuzey-2"
          open={detayAcik}
          onToggle={(e) => setDetayAcik((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer select-none px-3 py-1.5 text-xs text-metin-3">
            Fatura bilgileri — <span className="text-metin-2">{detayOzeti}</span>
          </summary>
          <div className="grid gap-3 border-t border-cizgi px-3 py-3 md:grid-cols-3 xl:grid-cols-4">
            <Alan etiket="Fatura / irsaliye no">
              <input className="alan" value={faturaNo} onChange={(e) => setFaturaNo(e.target.value)} />
            </Alan>
            <Alan etiket="Fatura tarihi">
              <input type="date" className="alan" value={faturaTarihi} onChange={(e) => setFaturaTarihi(e.target.value)} />
            </Alan>
            <Alan etiket="Vade tarihi" ipucu="Borç kalacaksa anlamlıdır.">
              <input type="date" className="alan" value={vadeTarihi} onChange={(e) => setVadeTarihi(e.target.value)} />
            </Alan>
            <Alan etiket="Ödeme durumu" ipucu="Nakit seçilirse kasadan da düşülür; kasa açık olmalıdır.">
              <select
                className="alan"
                value={odemeDurumu}
                onChange={(e) => {
                  // Yöntem değişince tutar yeniden genel toplamdan başlar — önceki elle yazılmış kısmi tutar
                  // farklı bir ödeme yöntemine sessizce taşınmasın.
                  setOdemeDurumu(e.target.value as OdemeDurumu);
                  setOdenenTutarElle(null);
                }}
              >
                <option value="BORC">Ödemedim — borç kalsın</option>
                <option value="NAKIT">Ödedim — nakit</option>
                <option value="HAVALE">Ödedim — havale/kart</option>
              </select>
            </Alan>
            <Alan
              etiket="Ödenen tutar"
              ipucu={
                odemeDurumu === 'BORC'
                  ? 'Borç kalsın seçiliyken tutar sıfırdır.'
                  : 'Azaltıp toptancıya elden verilen kısmi tutarı girebilirsiniz; kalanı tedarikçi borcu olarak kaydedilir.'
              }
            >
              <ParaAlani
                deger={odenenTutar}
                onDegisim={(v) => setOdenenTutarElle(v)}
                devreDisi={odemeDurumu === 'BORC'}
                sinif={odenenTutarAsimi ? 'border-tehlike' : ''}
              />
              {odenenTutarAsimi && (
                <span className="mt-1 block text-xs text-tehlike">Ödenen tutar genel toplamı aşamaz.</span>
              )}
            </Alan>
            <Alan etiket="Kategori" ipucu="Yalnız bu faturada açılacak yeni ürünlere uygulanır.">
              <select className="alan" value={kategoriId} onChange={(e) => setKategoriId(e.target.value)}>
                <option value="">Kategorisiz</option>
                {kategoriler.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.ad}
                  </option>
                ))}
              </select>
            </Alan>
            <Alan etiket="Hedef kâr marjı %" ipucu="Yeni ürünlerde satış fiyatı boş bırakılırsa bu marjdan hesaplanır.">
              <input
                className="alan sayi"
                value={marjYuzde}
                onChange={(e) => setMarjYuzde(e.target.value)}
                placeholder="Örn. 30"
              />
            </Alan>
            <Alan etiket="Notlar">
              <input className="alan" value={notlar} onChange={(e) => setNotlar(e.target.value)} />
            </Alan>
          </div>
        </details>

        {aramaAcik && (
          <div className="mt-2">
            <UrunSecici onSec={satirEkleMevcut} placeholder="Barkodu olmayan mevcut ürünü adıyla arayın…" otomatikOdak />
          </div>
        )}

        {baglanacak !== null && (
          <div className="mt-2 rounded border border-bilgi bg-bilgi-yumusak p-2">
            <div className="mb-1 flex items-center justify-between text-xs text-metin-2">
              <span>
                Barkod <strong>{satirlar[baglanacak]?.barkod || '—'}</strong> hangi ürüne ait? Seçtiğiniz ürünün kartına
                bu barkod eklenecek.
              </span>
              <button type="button" className="text-xs text-metin-3 hover:underline" onClick={() => setBaglanacak(null)}>
                Vazgeç
              </button>
            </div>
            <UrunSecici
              onSec={(urun) => satiriUruneBagla(baglanacak, urun)}
              placeholder="Barkodun ait olduğu ürünü arayın…"
              otomatikOdak
            />
          </div>
        )}
      </div>

      {/*
        KALEM LİSTESİ — kalan yüksekliğin tamamını alır ve YALNIZ BURASI kayar.
        Başlık satırı yapışkandır: kırkıncı satırda hangi sütunun ne olduğu
        görünmeye devam eder.
      */}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded border border-cizgi">
        {satirlar.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
            <p className="text-sm font-medium text-metin-2">Henüz kalem yok</p>
            <p className="text-sm text-metin-4">
              Barkodu okutun, yazıp Enter&apos;layın ya da &laquo;İsimle ekle&raquo; ile arayın.
            </p>
            <p className="text-xs text-metin-4">Koli girişi için çarpan kullanın: 12*8690000000000</p>
          </div>
        ) : (
          <table className="tablo tablo-yapiskan">
            <thead>
              <tr>
                <th className="w-10 text-right">#</th>
                <th className="w-32">Barkod</th>
                <th>Ürün</th>
                <th className="w-20">Miktar</th>
                <th className="w-28">Alış (KDV hariç)</th>
                <th className="w-28">Satış (KDV dahil)</th>
                <th className="w-16 text-right">Marj</th>
                <th className="w-20">KDV</th>
                {sktGerekli && (
                  <>
                    <th className="w-36">SKT</th>
                    <th className="w-24">Lot</th>
                  </>
                )}
                <th className="w-28 text-right">Tutar</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {satirlar.map((s, i) => {
                const yeniUrun = !s.urun_id;
                const ozet = ozetler[i] ?? null;
                const marj = ozet?.marjYuzde ?? null;
                const hatali = hataliSatirlar.has(i + 1);
                return (
                  <tr
                    key={i}
                    /*
                     * Yeni ürün satırı KALICI olarak işaretli durur (sol mavi şerit +
                     * rozet); vurgu ise yalnız son okutulanı birkaç saniye belli eder.
                     * Hatalı satır kırmızı şeritle işaretlenir — hata listesi altta
                     * "Satır 7" diyordu ama satırlar numarasızdı, kullanıcı sayıyordu.
                     */
                    className={`${vurgulu === i ? 'bg-vurgu-yumusak' : ''} ${
                      hatali ? 'border-l-2 border-tehlike' : yeniUrun ? 'border-l-2 border-bilgi' : ''
                    }`}
                  >
                    <td className="text-right font-mono text-xs text-metin-4">{i + 1}</td>
                    <td>
                      {yeniUrun ? (
                        <input
                          className="alan py-1"
                          value={s.barkod}
                          onChange={(e) => guncelle(i, { barkod: e.target.value })}
                          placeholder="Barkodsuz"
                        />
                      ) : (
                        <span className="font-mono text-xs text-metin-3">{s.barkod || '—'}</span>
                      )}
                    </td>
                    <td>
                      {yeniUrun ? (
                        <div className="flex items-center gap-2">
                          <input
                            data-ad-alani
                            className="alan py-1"
                            value={s.ad}
                            onChange={(e) => guncelle(i, { ad: e.target.value })}
                            onKeyDown={(e) => {
                              // Ad yazıldı: el okuyucuya dönsün, sıradaki ürün okutulsun.
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                barkodAlani.current?.focus();
                              }
                            }}
                            placeholder="Ürün adı *"
                          />
                          <Rozet tur="bilgi">Yeni</Rozet>
                          {/*
                            Katalogda olan ama barkodu kartına yazılmamış ürünler için kaçış yolu.
                            Bağlanınca okutulan barkod satırda kalır ve fatura kaydedilirken
                            o ürünün kartına eklenir — aynı ürün ikinci kez açılmaz.
                          */}
                          <button
                            type="button"
                            className="whitespace-nowrap text-xs text-bilgi hover:underline"
                            onClick={() => setBaglanacak(i)}
                            title="Bu satırı katalogdaki mevcut bir ürüne bağla"
                          >
                            bağla
                          </button>
                        </div>
                      ) : (
                        <span className="font-medium">{s.ad}</span>
                      )}
                    </td>
                    <td>
                      <input
                        className="alan sayi py-1"
                        value={s.miktar}
                        // Odakta tamamı seçilir: koli sayısını değiştirmek için
                        // önce eski değeri silmek gerekmesin.
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => guncelle(i, { miktar: e.target.value })}
                      />
                    </td>
                    <td>
                      <ParaAlani deger={s.alis} onDegisim={(v) => guncelle(i, { alis: v })} />
                    </td>
                    <td>
                      <ParaAlani
                        deger={s.satis}
                        onDegisim={(v) => guncelle(i, { satis: v })}
                        placeholder={yeniUrun ? 'marjdan' : '0,00'}
                      />
                    </td>
                    <td className="text-right">
                      {/*
                        Marj yüzdesi. Negatifse ZARARINA satış demektir; bunu raf
                        etiketi basıldıktan sonra fark etmek pahalıya patlıyordu.
                      */}
                      {marj === null ? (
                        <span className="text-xs text-metin-4">—</span>
                      ) : (
                        <span
                          className={`font-mono text-xs ${
                            marj < 0 ? 'font-bold text-tehlike' : marj < 5 ? 'text-uyari' : 'text-metin-3'
                          }`}
                        >
                          %{marj.toFixed(1)}
                        </span>
                      )}
                    </td>
                    <td>
                      <select className="alan py-1" value={s.kdv} onChange={(e) => guncelle(i, { kdv: e.target.value })}>
                        {KDV_ORANLARI.map((o) => (
                          <option key={o} value={o}>
                            %{o}
                          </option>
                        ))}
                      </select>
                    </td>
                    {sktGerekli && (
                      <>
                        <td>
                          <input
                            type="date"
                            className={`alan py-1 ${s.sktZorunlu && !s.skt ? 'border-tehlike' : ''}`}
                            value={s.skt}
                            aria-label={`${s.ad || 'Satır ' + (i + 1)} son kullanma tarihi`}
                            onChange={(e) => guncelle(i, { skt: e.target.value })}
                          />
                          {s.sktZorunlu && !s.skt && (
                            <span className="mt-0.5 block text-[11px] text-tehlike">SKT zorunlu</span>
                          )}
                        </td>
                        <td>
                          <input className="alan py-1" value={s.lot} onChange={(e) => guncelle(i, { lot: e.target.value })} />
                        </td>
                      </>
                    )}
                    <td className="text-right">
                      {/*
                        Satır tutarı (KDV dahil). Toptancının kâğıdıyla satır satır
                        karşılaştırmanın tek yolu budur; yoksa kullanıcı kafadan
                        çarpıyordu.
                      */}
                      {ozet ? (
                        <span className="font-mono text-sm font-medium">{paraFormat(ozet.brut, { simge: false })}</span>
                      ) : (
                        <span className="text-xs text-metin-4">—</span>
                      )}
                    </td>
                    <td>
                      <button type="button" className="text-tehlike" onClick={() => satirSil(i)} aria-label="Satırı sil">
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Uyarılar ve fatura toplamı denetimi — tablonun altında, alt şeridin üstünde sabit. */}
      <div className="shrink-0 space-y-2 pt-2">
        {silinen && (
          <div className="flex items-center justify-between rounded border border-cizgi bg-yuzey-2 px-3 py-1.5 text-xs">
            <span className="text-metin-3">
              &laquo;{silinen.satir.ad || silinen.satir.barkod || 'Boş satır'}&raquo; silindi.
            </span>
            <button type="button" className="font-medium text-vurgu hover:underline" onClick={silmeyiGeriAl}>
              Geri al
            </button>
          </div>
        )}

        {hatalar.length > 0 && (
          <div className="rounded border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm text-tehlike">
            <ul className="list-disc pl-4">
              {hatalar.map((h, i) => (
                <li key={i}>
                  Satır {h.satir}: {h.mesaj}
                </li>
              ))}
            </ul>
          </div>
        )}

        {satirlar.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="whitespace-nowrap text-metin-3">Faturada yazan toplam</span>
              <input
                className="alan sayi w-32 py-1"
                value={beyanToplam}
                onChange={(e) => setBeyanToplam(e.target.value)}
                placeholder="isteğe bağlı"
                title="Toptancının kâğıdındaki genel toplamı yazın; ekrandaki toplamla karşılaştırılsın."
              />
            </label>
            {/*
              Alış faturası girmenin asıl işi: rakamlar tutuyor mu? Fark varsa
              KAYDETMEDEN ÖNCE görünür. Kaydetmeyi engellemez — bazen toptancının
              kâğıdı yanlıştır ve kullanıcı bilerek devam eder.
            */}
            {beyanFarki !== null &&
              (beyanFarki.fark === 0 ? (
                <span className="rounded bg-vurgu-yumusak px-2 py-1 text-xs font-medium text-vurgu">
                  ✓ Fatura toplamı tutuyor
                </span>
              ) : (
                <span className="rounded bg-uyari-yumusak px-2 py-1 text-xs font-medium text-uyari">
                  Fark {paraFormat(Math.abs(beyanFarki.fark))} — ekrandaki toplam faturadakinden{' '}
                  {beyanFarki.fark > 0 ? 'FAZLA' : 'EKSİK'}
                </span>
              ))}
          </div>
        )}
      </div>
    </Diyalog>
  );
}
