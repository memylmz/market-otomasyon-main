/**
 * Mal kabul + alış faturası — ÜÇ ADIM (§11.8).
 *
 *  1. Fatura   — tedarikçi, fatura no/tarih, ödeme ve "faturadaki fiyatlar KDV
 *                dahil mi hariç mi?" (fatura başına BİR KEZ sorulur).
 *  2. Ürünler  — barkod okut; bilinen ürün tek dokunuşla girer, yeni barkod
 *                sağdaki sade panelde açılır. Miktar, alış ve RAF FİYATI listeye
 *                doğrudan yazılır (Enter alt satıra geçer) — toptancı 30 ürünün
 *                fiyatını söylerken her satırı tek tek açmak gerekmez.
 *  3. Kontrol  — fatura toplamı tutuyor mu, eksik satır var mı, hangi ürünün
 *                alışı ve raf fiyatı değişiyor; ödenen tutar; kaydet.
 *
 * NEDEN: eskiden her şey tek ekrandaydı — fatura bilgileri kapalı bir satırın
 * içinde kalıyor, dokuz sütunlu tabloda yeni ürünün adı, kartı ve "bağla"
 * bağlantısı aynı hücreye sıkışıyor, yeni barkod okutulur okutulmaz kırmızı
 * hata çıkıyordu. Alış fiyatı yalnız "KDV hariç" isteniyor, faturası KDV dahil
 * yazan toptancıda kullanıcı elle bölmek zorunda kalıyordu.
 *
 * Hesap DEĞİŞMEDİ: satır→kalem çevrimi ve marj hesabı `topluGirisKalemleri`den
 * (@market/shared) geçer; kasa ve panel aynı satırdan aynı faturayı üretir.
 * Form YALNIZ Stok → Mal Kabul / Alış sekmesinden açılır.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  alisGosterimi,
  alisMatrahi,
  ayniKarOraniylaRafFiyati,
  barkodUyarisi,
  belgeTarihi,
  birimKarHesabi,
  carpanCoz,
  faturaToplamlari,
  gunAnahtari,
  KDV_ORANLARI,
  kisaKodMu,
  marjdanFiyat,
  paraFormat,
  paraParse,
  satiriKat,
  satirOzeti,
  topluGirisKalemleri,
  VARSAYILAN_KDV_ORANI,
  type AlisSatiri,
  type Kurus,
  type TopluGirisSatiri,
} from '@market/shared';
import { Alan, Diyalog, ParaAlani, Rozet } from '../../bilesen/temel';
import { UrunKartiDiyalogu, type UrunKartiTaslagi, type UrunSatiri } from '../../bilesen/UrunKartiDiyalogu';
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
type Adim = 1 | 2 | 3;

/**
 * Satır tipi ve satır kararları `alis-satir.ts` içinde, saf ve TEST EDİLMİŞ
 * hâlde durur; bu dosya yalnız çizim yapar.
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

const kdvSayisi = (s: Satir) => {
  const n = Number(String(s.kdv).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export function AlisFaturasiFormu({ acik, onKapat, onTamam }: { acik: boolean; onKapat: () => void; onTamam: () => void }) {
  const [adim, setAdim] = useState<Adim>(1);
  const [tedarikciler, setTedarikciler] = useState<Tedarikci[]>([]);
  const [tedarikciId, setTedarikciId] = useState('');
  const [faturaNo, setFaturaNo] = useState('');
  const [faturaTarihi, setFaturaTarihi] = useState(() => gunAnahtari());
  const [vadeTarihi, setVadeTarihi] = useState('');
  const [odemeDurumu, setOdemeDurumu] = useState<OdemeDurumu>('BORC');
  /**
   * `null` = kullanıcı tutara dokunmadı → "ödedim" iken genel toplamı TAKİP
   * eder. Yazdığı an sabitlenir; genel toplam değişse de üzerine yazılmaz —
   * kısmi ödeme budur.
   */
  const [odenenTutarElle, setOdenenTutarElle] = useState<Kurus | null>(null);
  /** Faturadaki birim fiyatlar KDV dahil mi? `null` = henüz seçilmedi (1. adımda zorunlu). */
  const [kdvDahil, setKdvDahil] = useState<boolean | null>(null);
  const [notlar, setNotlar] = useState('');
  const [kategoriler, setKategoriler] = useState<Kategori[]>([]);
  const [kategoriId, setKategoriId] = useState('');
  const [marjYuzde, setMarjYuzde] = useState('');
  const [satirlar, setSatirlar] = useState<Satir[]>([]);
  /** Sağ panelde açık satır. */
  const [secili, setSecili] = useState<number | null>(null);
  const [barkodGirdi, setBarkodGirdi] = useState('');
  const [aramaAcik, setAramaAcik] = useState(false);
  /** Hangi satır mevcut bir ürüne bağlanmayı bekliyor (null = yok). */
  const [baglanacak, setBaglanacak] = useState<number | null>(null);
  const [kart, setKart] = useState<{ sira: number; urun: UrunSatiri } | { sira: number; taslak: UrunKartiTaslagi } | null>(null);
  /** Toptancının kâğıdında yazan genel toplam — ekrandaki toplamla karşılaştırılır. */
  const [beyanToplam, setBeyanToplam] = useState('');
  /** Son silinen satır — geri alınabilir. */
  const [silinen, setSilinen] = useState<{ satir: Satir; sira: number } | null>(null);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const barkodAlani = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!acik) return;
    setAdim(1);
    setTedarikciId('');
    setFaturaNo('');
    setFaturaTarihi(gunAnahtari());
    setVadeTarihi('');
    setOdemeDurumu('BORC');
    setOdenenTutarElle(null);
    setKdvDahil(null);
    setNotlar('');
    setKategoriId('');
    setMarjYuzde('');
    setSatirlar([]);
    setSecili(null);
    setBarkodGirdi('');
    setAramaAcik(false);
    setBaglanacak(null);
    setBeyanToplam('');
    setSilinen(null);
    cagir<{ kayitlar: Tedarikci[] }>('cari.listele', { filtre: { tip: 'TEDARIKCI' }, limit: 200 })
      .then((v) => setTedarikciler(v.kayitlar))
      .catch(() => setTedarikciler([]));
    // kategori.listele DÜZ DİZİ döner — {kayitlar} sarmalı DEĞİL.
    cagir<Kategori[]>('kategori.listele')
      .then(setKategoriler)
      .catch(() => setKategoriler([]));
  }, [acik]);

  // 2. adıma geçince el okuyucuda olsun.
  useEffect(() => {
    if (adim === 2) requestAnimationFrame(() => barkodAlani.current?.focus());
  }, [adim]);

  const dahil = kdvDahil === true;

  const guncelle = (i: number, yama: Partial<Satir>) =>
    setSatirlar((liste) => liste.map((x, j) => (j === i ? { ...x, ...yama } : x)));

  /** Yeni ürün panelinde odak AD alanına; bilinen üründe barkod alanında kalır. */
  const adaOdaklan = () => requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-ad-alani]')?.focus());
  const barkodaDon = () => requestAnimationFrame(() => barkodAlani.current?.focus());

  /**
   * Listedeki hücreler arasında Enter: aynı sütunda ALT satıra geçer, son
   * satırdan sonra el okuyucuya döner. Toptancı fiyatları sırayla söyler;
   * kullanıcı "yaz, Enter, yaz, Enter" diye ilerler.
   */
  const hucreyeGit = (sutun: 'miktar' | 'alis' | 'raf' | 'skt', sira: number) => {
    if (sira >= satirlar.length) {
      barkodaDon();
      return;
    }
    setSecili(sira);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-hucre="${sutun}-${sira}"] input`)?.focus());
  };

  /**
   * KDV dahil/hariç seçimi satırlar girildikten SONRA değişirse yazılan
   * fiyatların anlamı değişirdi (150 "dahil" iken 150 "hariç" olurdu). Bu
   * yüzden her satırın KDV hariç değeri korunup yeni yazılışa çevrilir.
   */
  const kdvDahilDegistir = (yeni: boolean) => {
    if (kdvDahil !== null && kdvDahil !== yeni) {
      setSatirlar((liste) =>
        liste.map((s) => ({ ...s, alis: alisGosterimi(alisMatrahi(s.alis, kdvSayisi(s), kdvDahil), kdvSayisi(s), yeni) })),
      );
    }
    setKdvDahil(yeni);
  };

  /*
   * Yeni ürün satırını MEVCUT bir ürüne bağlar. Ürün katalogdadır ama elindeki
   * ambalajın barkodu kartına kayıtlı değildir; okutulan barkod satırda kalır
   * ve fatura kaydedilirken o ürüne eklenir — mükerrer ürün açılmaz.
   */
  const satiriUruneBagla = (sira: number, urun: SecilenUrun) => {
    setSatirlar((liste) =>
      liste.map((s, j) =>
        j === sira
          ? {
              ...s,
              ad: urun.ad,
              // Kullanıcı alış fiyatını girdiyse dokunma; girmediyse karttan doldur.
              alis: s.alis || alisGosterimi(urun.alis_fiyati, urun.kdv_orani, dahil),
              satis: urun.satis_fiyati,
              kdv: String(urun.kdv_orani),
              urun_id: urun.id,
              sktZorunlu: urun.skt_takibi === true,
              mevcutAlis: urun.alis_fiyati,
              mevcutSatis: urun.satis_fiyati,
            }
          : s,
      ),
    );
    setBaglanacak(null);
    setSecili(sira);
  };

  const satirEkleMevcut = (urun: SecilenUrun, adet = 1) => {
    const sonuc = satiriKat(
      satirlar,
      {
        barkod: urun.barkodlar[0] ?? '',
        ad: urun.ad,
        miktar: '1',
        // Geçen seferki alış, faturadaki yazılışla (dahil/hariç) ön doldurulur.
        alis: alisGosterimi(urun.alis_fiyati, urun.kdv_orani, dahil),
        satis: urun.satis_fiyati,
        kdv: String(urun.kdv_orani),
        skt: '',
        lot: '',
        urun_id: urun.id,
        sktZorunlu: urun.skt_takibi === true,
        mevcutAlis: urun.alis_fiyati,
        mevcutSatis: urun.satis_fiyati,
      },
      adet,
    );
    setSatirlar(sonuc.satirlar);
    setSecili(sonuc.vurgulanan);
  };

  /**
   * Barkod alanı 2. adımın merkezidir: bulunan ürün doğrudan listeye girer
   * (el okuyucuda kalır), bulunamayan barkod sağ panelde YENİ ÜRÜN açar, boş
   * Enter barkodsuz yeni ürün açar. `12*barkod` koli girişidir.
   */
  const barkodEnter = async (tus: KeyboardEvent<HTMLInputElement>) => {
    if (tus.key !== 'Enter') return;
    tus.preventDefault();
    const { carpan, barkod } = carpanCoz(barkodGirdi);
    setBarkodGirdi('');

    if (!barkod) {
      const sonuc = satiriKat(satirlar, bosSatir(), carpan);
      setSatirlar(sonuc.satirlar);
      setSecili(sonuc.vurgulanan);
      adaOdaklan();
      return;
    }

    try {
      const sonuc = await cagir<{ bulundu: boolean; urun?: SecilenUrun }>('urun.barkodOku', { barkod });
      if (sonuc.bulundu && sonuc.urun) {
        satirEkleMevcut(sonuc.urun, carpan);
        barkodaDon();
      } else {
        const kat = satiriKat(satirlar, bosSatir(barkod), carpan);
        setSatirlar(kat.satirlar);
        setSecili(kat.vurgulanan);
        if (kat.birlesti) barkodaDon();
        else adaOdaklan();
      }
    } catch (hata) {
      hatayiBildir(hata, 'Barkod');
      barkodaDon();
    }
  };

  /** Satırdaki ürünün kartını açar (mevcut üründe gerçek kart, yenide taslak). */
  const kartiAc = async (sira: number) => {
    const s = satirlar[sira];
    if (!s) return;
    if (s.urun_id) {
      try {
        const d = await cagir<{
          urun: Omit<UrunSatiri, 'barkodlar' | 'stok' | 'kategori_adi'>;
          barkodlar: { barkod: string }[];
          stok: number;
        }>('urun.detay', { urunId: s.urun_id });
        setKart({ sira, urun: { ...d.urun, stok: d.stok, kategori_adi: null, barkodlar: d.barkodlar.map((b) => b.barkod) } });
      } catch (hata) {
        hatayiBildir(hata, 'Ürün kartı');
      }
      return;
    }
    const ek = s.kart?.ek_barkodlar ?? [];
    setKart({
      sira,
      taslak: {
        ad: s.ad,
        barkodlar: [...(s.barkod.trim() ? [s.barkod.trim()] : []), ...ek.filter((b) => !kisaKodMu(b))],
        kisaKod: ek.find((b) => kisaKodMu(b)) ?? '',
        marka: s.kart?.marka ?? '',
        kategoriId: s.kart?.kategori_id ?? kategoriId,
        birimTipi: s.kart?.birim_tipi ?? 'ADET',
        // Kart KDV hariç alış bekler.
        alisFiyati: alisMatrahi(s.alis, kdvSayisi(s), dahil),
        satisFiyati: s.satis,
        kdvOrani: Number(s.kdv) || VARSAYILAN_KDV_ORANI,
        kritikStok: s.kart?.kritik_stok ?? '',
        rafKonumu: s.kart?.raf_konumu ?? '',
        sktTakibi: s.kart?.skt_takibi ?? false,
        notlar: s.kart?.notlar ?? '',
      },
    });
  };

  /** Taslak kartın değerleri satıra yazılır; ürün fatura kaydedilince açılır. */
  const taslagiUygula = (sira: number, t: UrunKartiTaslagi) => {
    guncelle(sira, {
      ad: t.ad,
      barkod: t.barkodlar[0] ?? '',
      alis: alisGosterimi(t.alisFiyati, t.kdvOrani, dahil),
      satis: t.satisFiyati,
      kdv: String(t.kdvOrani),
      sktZorunlu: t.sktTakibi,
      kart: {
        marka: t.marka,
        kategori_id: t.kategoriId || null,
        birim_tipi: t.birimTipi,
        kritik_stok: t.kritikStok,
        raf_konumu: t.rafKonumu,
        skt_takibi: t.sktTakibi,
        notlar: t.notlar,
        ek_barkodlar: [...t.barkodlar.slice(1), ...(t.kisaKod ? [t.kisaKod] : [])],
      },
    });
    setKart(null);
  };

  /** Mevcut ürünün kartı kaydedildi: ad, raf fiyatı, KDV ve SKT zorunluluğu tazelenir. */
  const kartKaydedildi = async (sira: number, urunId: string) => {
    setKart(null);
    try {
      const d = await cagir<{ urun: { ad: string; satis_fiyati: number; kdv_orani: number; skt_takibi: boolean } }>(
        'urun.detay',
        { urunId },
      );
      guncelle(sira, {
        ad: d.urun.ad,
        satis: d.urun.satis_fiyati,
        mevcutSatis: d.urun.satis_fiyati,
        kdv: String(d.urun.kdv_orani),
        sktZorunlu: d.urun.skt_takibi === true,
      });
    } catch (hata) {
      hatayiBildir(hata, 'Ürün kartı');
    }
  };

  const satirSil = (i: number) => {
    const hedef = satirlar[i];
    if (hedef) setSilinen({ satir: hedef, sira: i });
    setSatirlar((liste) => liste.filter((_, j) => j !== i));
    setSecili(null);
  };

  const silmeyiGeriAl = () => {
    if (!silinen) return;
    setSatirlar((liste) => {
      const kopya = [...liste];
      kopya.splice(Math.min(silinen.sira, kopya.length), 0, silinen.satir);
      return kopya;
    });
    setSecili(Math.min(silinen.sira, satirlar.length));
    setSilinen(null);
  };

  // Satır → TopluGirisSatiri. Alış burada KDV HARİÇE çevrilir (fatura KDV dahil
  // yazıyorsa); topluGirisKalemleri (kasa ve panelle ORTAK) metin bekler.
  const donusumSatirlari = useMemo<TopluGirisSatiri[]>(
    () =>
      satirlar.map((s) => {
        const alisHaric = alisMatrahi(s.alis, kdvSayisi(s), dahil);
        return {
          barkod: s.barkod,
          ad: s.ad,
          miktar: s.miktar,
          alis: s.alis === 0 ? '' : paraFormat(alisHaric, { simge: false }),
          satis: s.satis === 0 ? '' : paraFormat(s.satis, { simge: false }),
          kdv: s.kdv,
          skt: s.skt,
          lot: s.lot,
          urun_id: s.urun_id,
          kart: s.kart,
          ...(s.urun_id && s.mevcutSatis !== undefined ? { mevcut_satis: paraFormat(s.mevcutSatis, { simge: false }) } : {}),
        };
      }),
    [satirlar, dahil],
  );

  const marjSayi = useMemo(() => {
    const metin = marjYuzde.trim().replace(',', '.');
    if (!metin) return undefined;
    const sayi = Number(metin);
    return Number.isFinite(sayi) ? sayi : undefined;
  }, [marjYuzde]);

  const { kalemler, hatalar } = useMemo(() => {
    const sonuc = topluGirisKalemleri(donusumSatirlari, { marjYuzde: marjSayi });
    // Faturanın genel kategorisi yalnız kategorisi seçilmemiş YENİ ürünlere gider.
    const kategoriliKalemler = sonuc.kalemler.map((k) =>
      k.yeni_urun ? { ...k, yeni_urun: { ...k.yeni_urun, kategori_id: k.yeni_urun.kategori_id ?? (kategoriId || null) } } : k,
    );
    return { kalemler: kategoriliKalemler, hatalar: sonuc.hatalar };
  }, [donusumSatirlari, marjSayi, kategoriId]);

  const { araToplam, kdvToplam, genelToplam } = useMemo(() => faturaToplamlari(kalemler), [kalemler]);
  const ozetler = useMemo(() => donusumSatirlari.map((satir) => satirOzeti(satir, marjSayi)), [donusumSatirlari, marjSayi]);

  /** Satır numarası (1'den) → hata mesajı. */
  const satirHatasi = useMemo(() => new Map(hatalar.map((h) => [h.satir, h.mesaj])), [hatalar]);

  const beyanFarki = useMemo(() => {
    const beyan = paraParse(beyanToplam);
    if (beyan === null || satirlar.length === 0) return null;
    return { beyan, fark: genelToplam - beyan };
  }, [beyanToplam, genelToplam, satirlar.length]);

  const odenenTutar = odemeDurumu === 'BORC' ? 0 : (odenenTutarElle ?? genelToplam);
  const odenenTutarAsimi = odemeDurumu !== 'BORC' && odenenTutar > genelToplam;

  const sktEksikler = satirlar.map((s, i) => ({ s, i })).filter(({ s }) => s.sktZorunlu && !s.skt.trim());
  const yeniSatirSayisi = satirlar.filter((s) => !s.urun_id).length;

  /** Alışı ya da raf fiyatı değişen MEVCUT ürünler — 3. adımda listelenir. */
  const degisenler = satirlar
    .map((s, i) => {
      if (!s.urun_id) return null;
      const alisHaric = alisMatrahi(s.alis, kdvSayisi(s), dahil);
      const alisDegisti = s.mevcutAlis !== undefined && s.alis > 0 && alisHaric !== s.mevcutAlis;
      const rafDegisti = s.mevcutSatis !== undefined && s.satis > 0 && s.satis !== s.mevcutSatis;
      return alisDegisti || rafDegisti ? { s, i, alisHaric, alisDegisti, rafDegisti } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const zarardakiler = satirlar
    .map((s, i) => ({ s, i, marj: ozetler[i]?.marjYuzde ?? null }))
    .filter((x) => x.marj !== null && x.marj < 0);

  /** Barkodu şüpheli YENİ ürünler — kaydı engellemez, kasada okutulamayabilir. */
  const supheliBarkodlar = satirlar
    .map((s, i) => ({ s, i, uyari: !s.urun_id && s.barkod.trim() ? barkodUyarisi(s.barkod) : null }))
    .filter((x): x is { s: Satir; i: number; uyari: string } => x.uyari !== null);

  const faturaAdimiTamam = Boolean(tedarikciId) && kdvDahil !== null;
  const kaydedilebilir =
    faturaAdimiTamam &&
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
          tarih: belgeTarihi(faturaTarihi),
          vade_tarihi: odemeDurumu === 'BORC' ? vadeTarihi || undefined : undefined,
          notlar: notlar.trim() || undefined,
          odenen_tutar: odenenTutar,
          odeme_tipi: odemeDurumu === 'BORC' ? undefined : odemeDurumu,
          kalemler,
        },
      );
      const yeniUrunSayisi = kalemler.filter((k) => k.yeni_urun).length;
      const fiyatSayisi = kalemler.filter((k) => 'yeni_satis_fiyati' in k && k.yeni_satis_fiyati !== undefined).length;
      const ekler = [
        yeniUrunSayisi > 0 ? `${yeniUrunSayisi} yeni ürün açıldı` : '',
        fiyatSayisi > 0 ? `${fiyatSayisi} ürünün raf fiyatı güncellendi` : '',
        yeniUrunSayisi + fiyatSayisi > 0 ? 'etiketleri Ürünler → "Etiketi Basılacaklar"da' : '',
      ]
        .filter(Boolean)
        .map((e) => ` · ${e}`)
        .join('');
      bildir.basari(
        'Mal kabul kaydedildi',
        sonuc.odenen > 0
          ? `${sonuc.kalemSayisi} kalem · Toplam ${paraFormat(sonuc.genelToplam)} · Ödenen ${paraFormat(sonuc.odenen)} · Kalan borç ${paraFormat(sonuc.kalanBorc)}${ekler}`
          : `${sonuc.kalemSayisi} kalem · ${paraFormat(sonuc.genelToplam)} tedarikçi borcu kaydedildi${ekler}`,
      );
      onTamam();
    } catch (hata) {
      // Diyalog KAPATILMAZ: toptancının önünde girilen satırlar kaybolmamalı.
      hatayiBildir(hata, 'Mal kabul');
    } finally {
      setGonderiliyor(false);
    }
  };

  /** Yarım fatura sorulmadan kapanmasın (ESC ya da Vazgeç). */
  const kapatIstegi = () => {
    if (satirlar.length > 0 && !window.confirm('Girilen satırlar kaydedilmeden kapatılsın mı?')) return;
    onKapat();
  };

  /** Bir sorunu düzeltmek için 2. adıma, ilgili satıra götürür. */
  const satiraGit = (i: number) => {
    setAdim(2);
    setSecili(i);
  };

  /*
   * F2: 1. ve 2. adımda KONTROL adımına geçer, 3. adımda kaydeder. Eskiden F2
   * doğrudan kaydediyordu; kontrol adımı atlanmasın.
   */
  const f2Ref = useRef<() => void>(() => {});
  f2Ref.current = () => {
    if (adim === 3) void gonder();
    else if (faturaAdimiTamam && satirlar.length > 0) setAdim(3);
    else if (!faturaAdimiTamam) setAdim(1);
  };
  useEffect(() => {
    if (!acik) return;
    const dinleyici = (olay: globalThis.KeyboardEvent) => {
      if (olay.key !== 'F2') return;
      olay.preventDefault();
      f2Ref.current();
    };
    window.addEventListener('keydown', dinleyici);
    return () => window.removeEventListener('keydown', dinleyici);
  }, [acik]);

  const tedarikciAdi = tedarikciler.find((t) => t.id === tedarikciId)?.ad_unvan ?? '';
  const seciliSatir = secili !== null ? satirlar[secili] : undefined;

  return (
    <Diyalog
      acik={acik}
      baslik="Mal Kabul / Alış Faturası"
      genislik="tam"
      kaydirma={false}
      onKapat={kapatIstegi}
      altBilgi={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <AdimGostergesi
            adim={adim}
            git={(a) => {
              if (a === 1 || faturaAdimiTamam) setAdim(a);
            }}
            ikinciAcik={faturaAdimiTamam}
            ucuncuAcik={faturaAdimiTamam && satirlar.length > 0}
          />
          <div className="flex items-center gap-3">
            {adim > 1 && (
              <span className="text-sm text-metin-3">
                {satirlar.length} kalem · <span className="font-mono font-semibold text-metin">{paraFormat(genelToplam)}</span>
              </span>
            )}
            <button type="button" className="tus-ikincil" onClick={kapatIstegi}>
              Vazgeç
            </button>
            {adim > 1 && (
              <button type="button" className="tus-ikincil" onClick={() => setAdim((adim - 1) as Adim)}>
                ← Geri
              </button>
            )}
            {adim === 1 && (
              <button type="button" className="tus-birincil" disabled={!faturaAdimiTamam} onClick={() => setAdim(2)}>
                İleri: Ürünler →
              </button>
            )}
            {adim === 2 && (
              <button type="button" className="tus-birincil" disabled={satirlar.length === 0} onClick={() => setAdim(3)}>
                İleri: Kontrol → <span className="ml-1 text-xs opacity-75">F2</span>
              </button>
            )}
            {adim === 3 && (
              <button type="button" className="tus-birincil" onClick={() => void gonder()} disabled={!kaydedilebilir}>
                {gonderiliyor ? 'Kaydediliyor…' : 'Faturayı Kaydet'} <span className="ml-1 text-xs opacity-75">F2</span>
              </button>
            )}
          </div>
        </div>
      }
    >
      {adim === 1 && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto grid max-w-5xl gap-5 py-2 lg:grid-cols-2">
            <Bolum no={1} baslik="Kimden geldi?">
              <Alan etiket="Tedarikçi *">
                <select
                  className={`alan h-11 ${tedarikciId ? '' : 'border-uyari-cizgi'}`}
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
              </Alan>
              {tedarikciler.length === 0 && (
                <p className="text-xs text-uyari">Kayıtlı tedarikçi yok. Cari Hesap sayfasından tedarikçi ekleyin.</p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Alan etiket="Fatura / irsaliye no">
                  <input
                    className="alan"
                    value={faturaNo}
                    onChange={(e) => setFaturaNo(e.target.value)}
                    placeholder="isteğe bağlı"
                  />
                </Alan>
                <Alan etiket="Fatura tarihi">
                  <input type="date" className="alan" value={faturaTarihi} onChange={(e) => setFaturaTarihi(e.target.value)} />
                </Alan>
              </div>
            </Bolum>

            <Bolum no={2} baslik="Faturadaki birim fiyatlar nasıl yazıyor? *">
              <p className="-mt-1 text-sm text-metin-3">
                Faturaya bakın: ürün satırlarındaki fiyatın içinde KDV var mı? Siz faturada ne yazıyorsa onu girin, gerisini
                program hesaplar.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <SecimKarti
                  secili={kdvDahil === false}
                  onClick={() => kdvDahilDegistir(false)}
                  baslik="KDV hariç"
                  aciklama="KDV, faturanın altında ayrıca toplanıyor. Çoğu toptancı faturası böyledir."
                />
                <SecimKarti
                  secili={kdvDahil === true}
                  onClick={() => kdvDahilDegistir(true)}
                  baslik="KDV dahil"
                  aciklama="Satırdaki fiyat ödediğiniz fiyat; KDV içinde."
                />
              </div>
            </Bolum>

            <Bolum no={3} baslik="Ödeme">
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    { d: 'BORC', b: 'Borç kalsın', a: 'Tamamı tedarikçiye borç yazılır.' },
                    { d: 'NAKIT', b: 'Nakit ödedim', a: 'Kasadan düşülür (kasa açık olmalı).' },
                    { d: 'HAVALE', b: 'Kart / havale', a: 'Kasa etkilenmez, borç kapanır.' },
                  ] as const
                ).map((o) => (
                  <SecimKarti
                    key={o.d}
                    secili={odemeDurumu === o.d}
                    onClick={() => {
                      setOdemeDurumu(o.d);
                      setOdenenTutarElle(null);
                    }}
                    baslik={o.b}
                    aciklama={o.a}
                  />
                ))}
              </div>
              {odemeDurumu === 'BORC' ? (
                <Alan etiket="Vade tarihi" ipucu="Ne zaman ödenecek? İsteğe bağlı.">
                  <input type="date" className="alan" value={vadeTarihi} onChange={(e) => setVadeTarihi(e.target.value)} />
                </Alan>
              ) : (
                <p className="text-xs text-metin-3">Kısmi ödediyseniz tutarı son adımda (Kontrol) değiştirebilirsiniz.</p>
              )}
            </Bolum>

            <Bolum no={4} baslik="Yeni ürünler için (isteğe bağlı)">
              <p className="-mt-1 text-sm text-metin-3">Bu faturada katalogda olmayan ürün açılırsa kullanılır.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Alan etiket="Kategori">
                  <select className="alan" value={kategoriId} onChange={(e) => setKategoriId(e.target.value)}>
                    <option value="">Kategorisiz</option>
                    {kategoriler.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.ad}
                      </option>
                    ))}
                  </select>
                </Alan>
                <Alan etiket="Hedef kâr %" ipucu="Raf fiyatı yazılmazsa buradan önerilir.">
                  <input
                    className="alan sayi"
                    inputMode="decimal"
                    value={marjYuzde}
                    onChange={(e) => setMarjYuzde(e.target.value)}
                    placeholder="Örn. 25"
                  />
                </Alan>
              </div>
              <Alan etiket="Not">
                <input className="alan" value={notlar} onChange={(e) => setNotlar(e.target.value)} placeholder="isteğe bağlı" />
              </Alan>
            </Bolum>
          </div>
          {!faturaAdimiTamam && (
            <p className="pb-2 text-center text-sm text-uyari">
              Devam etmek için {!tedarikciId ? 'tedarikçiyi seçin' : ''}
              {!tedarikciId && kdvDahil === null ? ' ve ' : ''}
              {kdvDahil === null ? 'fiyatların KDV dahil mi hariç mi olduğunu seçin' : ''}.
            </p>
          )}
        </div>
      )}

      {adim === 2 && (
        <>
          <div className="shrink-0 border-b border-cizgi pb-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block min-w-[260px] flex-1">
                <span className="etiket">Barkod — okutun ya da yazıp Enter&apos;layın</span>
                <input
                  ref={barkodAlani}
                  className="alan h-12 text-lg"
                  value={barkodGirdi}
                  onChange={(e) => setBarkodGirdi(e.target.value)}
                  onKeyDown={(e) => void barkodEnter(e)}
                  placeholder="Barkod okutun…   koli: 12*barkod   ·   boş Enter: barkodsuz yeni ürün"
                />
              </label>
              <button type="button" className="tus-ikincil h-12" onClick={() => setAramaAcik((a) => !a)}>
                {aramaAcik ? 'Aramayı kapat' : 'İsimle ekle'}
              </button>
            </div>
            <p className="mt-2 text-xs text-metin-3">
              {tedarikciAdi} · Alış faturadaki gibi <b>{dahil ? 'KDV dahil' : 'KDV hariç'}</b> girilir ·{' '}
              <button type="button" className="text-vurgu hover:underline" onClick={() => setAdim(1)}>
                değiştir
              </button>{' '}
              · Miktar, alış ve raf fiyatını listeye doğrudan yazabilirsiniz; <b>Enter</b> alt satıra geçer.
            </p>
            {aramaAcik && (
              <div className="mt-2">
                <UrunSecici
                  onSec={(u) => {
                    satirEkleMevcut(u);
                    barkodaDon();
                  }}
                  placeholder="Barkodu olmayan mevcut ürünü adıyla arayın…"
                  otomatikOdak
                />
              </div>
            )}
            {baglanacak !== null && (
              <div className="mt-2 rounded-lg border border-bilgi bg-bilgi-yumusak p-2">
                <div className="mb-1 flex items-center justify-between text-xs text-metin-2">
                  <span>
                    Barkod <strong>{satirlar[baglanacak]?.barkod || '—'}</strong> hangi ürüne ait? Seçtiğiniz ürünün kartına bu
                    barkod eklenecek.
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

          <div className="mt-3 grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-h-0 overflow-y-auto rounded-lg border border-cizgi">
              {satirlar.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
                  <p className="text-base font-medium text-metin-2">Faturadaki ilk ürünü okutun</p>
                  <p className="text-sm text-metin-4">Barkodu olmayan ürün için &laquo;İsimle ekle&raquo; ya da boş Enter.</p>
                  <p className="text-xs text-metin-4">Koli: 12*8690000000000 → 12 adet</p>
                </div>
              ) : (
                <table className="tablo tablo-yapiskan">
                  <thead>
                    <tr>
                      <th className="w-8 text-right">#</th>
                      <th>Ürün</th>
                      <th className="w-24 text-right">Miktar</th>
                      <th className="w-28 text-right">Alış</th>
                      <th className="w-28 text-right">Raf fiyatı</th>
                      <th
                        className="w-36"
                        title="Son kullanma tarihi. SKT takibi açık üründe zorunlu, diğerlerinde isteğe bağlı."
                      >
                        SKT
                      </th>
                      <th className="w-16 text-right">Kâr</th>
                      <th className="w-28 text-right">Tutar</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {satirlar.map((s, i) => {
                      const ozet = ozetler[i] ?? null;
                      const eksik = satirHatasi.has(i + 1) || (s.sktZorunlu && !s.skt.trim());
                      const degisim = degisenler.find((d) => d.i === i);
                      // Yeni üründe raf fiyatı boşsa hedef kârdan önerilen fiyat silik gösterilir.
                      const oneri = s.satis === 0 && ozet?.satisFiyati ? ozet.satisFiyati : null;
                      const marj = ozet?.marjYuzde ?? null;
                      return (
                        <tr
                          key={i}
                          onClick={() => setSecili(i)}
                          className={`cursor-pointer align-top ${secili === i ? 'bg-vurgu-yumusak' : 'hover:bg-yuzey-2'}`}
                        >
                          <td className="pt-3 text-right font-mono text-xs text-metin-4">{i + 1}</td>
                          <td className="pt-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={`font-medium ${s.ad ? '' : 'italic text-metin-4'}`}>
                                {s.ad || 'adı yazılmadı'}
                              </span>
                              {!s.urun_id && <Rozet tur="bilgi">Yeni</Rozet>}
                              {supheliBarkodlar.some((x) => x.i === i) && <Rozet tur="uyari">Barkod şüpheli</Rozet>}
                              {/* Şu an düzenlenen satır "eksik" diye işaretlenmez; kullanıcı zaten onu dolduruyor. */}
                              {eksik && secili !== i && <Rozet tur="tehlike">Eksik</Rozet>}
                              {degisim?.alisDegisti && <Rozet tur="uyari">Alış değişti</Rozet>}
                              {(marj ?? 0) < 0 && <Rozet tur="tehlike">Zararına</Rozet>}
                            </div>
                            {s.barkod && <span className="font-mono text-[11px] text-metin-4">{s.barkod}</span>}
                          </td>
                          <td>
                            <span data-hucre={`miktar-${i}`}>
                              <input
                                className="alan sayi h-9 w-full px-2 text-right"
                                inputMode="decimal"
                                aria-label={`${s.ad || 'Satır'} miktar`}
                                value={s.miktar}
                                onFocus={(e) => e.currentTarget.select()}
                                onChange={(e) => guncelle(i, { miktar: e.target.value })}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    hucreyeGit('miktar', i + 1);
                                  }
                                }}
                              />
                            </span>
                          </td>
                          <td>
                            <span data-hucre={`alis-${i}`}>
                              <ParaAlani
                                deger={s.alis}
                                etiket={`${s.ad || 'Satır'} alış`}
                                sinif="h-9 w-full px-2 text-right"
                                onDegisim={(v) => guncelle(i, { alis: v })}
                                onEnter={() => hucreyeGit('alis', i + 1)}
                              />
                            </span>
                          </td>
                          <td>
                            <span data-hucre={`raf-${i}`}>
                              <ParaAlani
                                deger={s.satis}
                                etiket={`${s.ad || 'Satır'} raf fiyatı`}
                                placeholder={oneri ? paraFormat(oneri, { simge: false }) : '0,00'}
                                sinif={`h-9 w-full px-2 text-right ${degisim?.rafDegisti ? 'border-vurgu font-semibold' : ''}`}
                                onDegisim={(v) => guncelle(i, { satis: v })}
                                onEnter={() => hucreyeGit('raf', i + 1)}
                              />
                            </span>
                            {degisim?.rafDegisti && s.mevcutSatis !== undefined && (
                              <span className="block pr-1 text-right text-[11px] text-metin-3">
                                eski {paraFormat(s.mevcutSatis, { simge: false })}
                              </span>
                            )}
                          </td>
                          <td>
                            {/*
                              SKT her satırda girilebilir. Eskiden yalnız ürün kartında
                              "SKT takibi" işaretliyse görünüyordu; işaretsiz üründe
                              tarihi girmenin yolu yoktu.
                            */}
                            <span data-hucre={`skt-${i}`}>
                              <input
                                type="date"
                                className={`alan h-9 w-full px-2 ${s.sktZorunlu && !s.skt ? 'border-tehlike' : ''}`}
                                aria-label={`${s.ad || 'Satır'} son kullanma tarihi`}
                                value={s.skt}
                                onChange={(e) => guncelle(i, { skt: e.target.value })}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    hucreyeGit('skt', i + 1);
                                  }
                                }}
                              />
                            </span>
                          </td>
                          <td
                            className={`pt-3 text-right font-mono text-sm ${
                              marj === null
                                ? 'text-metin-4'
                                : marj < 0
                                  ? 'font-semibold text-tehlike'
                                  : marj < 10
                                    ? 'text-uyari'
                                    : 'text-vurgu'
                            }`}
                            title="Kâr oranı: (raf fiyatının KDV'siz hâli − alış) ÷ raf fiyatının KDV'siz hâli"
                          >
                            {marj === null ? '—' : `%${marj.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`}
                          </td>
                          <td className="pt-3 text-right font-mono font-medium">
                            {ozet ? paraFormat(ozet.brut, { simge: false }) : <span className="text-metin-4">—</span>}
                          </td>
                          <td className="pt-2.5">
                            <button
                              type="button"
                              className="text-tehlike"
                              onClick={(e) => {
                                e.stopPropagation();
                                satirSil(i);
                              }}
                              aria-label="Satırı sil"
                            >
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

            <div className="min-h-0 overflow-y-auto">
              {seciliSatir && secili !== null ? (
                <SatirPaneli
                  key={secili}
                  s={seciliSatir}
                  sira={secili}
                  dahil={dahil}
                  marj={marjSayi}
                  genelKategori={kategoriId}
                  kategoriler={kategoriler}
                  hata={satirHatasi.get(secili + 1) ?? null}
                  guncelle={(y) => guncelle(secili, y)}
                  kartiAc={() => void kartiAc(secili)}
                  bagla={() => setBaglanacak(secili)}
                  bitti={barkodaDon}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-cizgi p-6 text-center text-sm text-metin-3">
                  <p>Okutulan ürünün ayrıntısı burada açılır.</p>
                  <p className="mt-1 text-xs">Listede bir satıra tıklayarak da açabilirsiniz.</p>
                </div>
              )}
            </div>
          </div>

          {silinen && (
            <div className="mt-2 flex shrink-0 items-center justify-between rounded-lg border border-cizgi bg-yuzey-2 px-3 py-1.5 text-xs">
              <span className="text-metin-3">
                &laquo;{silinen.satir.ad || silinen.satir.barkod || 'Boş satır'}&raquo; silindi.
              </span>
              <button type="button" className="font-medium text-vurgu hover:underline" onClick={silmeyiGeriAl}>
                Geri al
              </button>
            </div>
          )}
        </>
      )}

      {adim === 3 && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto grid max-w-5xl gap-4 py-2">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kutu etiket="Kalem" deger={String(kalemler.length)} />
              <Kutu etiket="Yeni ürün" deger={String(yeniSatirSayisi)} />
              <Kutu etiket="Fiyatı değişen" deger={String(degisenler.length)} />
              <Kutu etiket="Genel toplam" deger={paraFormat(genelToplam)} vurgu />
            </div>

            <Bolum baslik="Fatura toplamı tutuyor mu?">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2">
                  <span className="text-sm text-metin-2">Faturanın altında yazan genel toplam</span>
                  <input
                    className="alan sayi w-40"
                    inputMode="decimal"
                    value={beyanToplam}
                    onChange={(e) => setBeyanToplam(e.target.value)}
                    placeholder="isteğe bağlı"
                  />
                </label>
                {beyanFarki !== null &&
                  (beyanFarki.fark === 0 ? (
                    <span className="rounded-lg bg-vurgu-yumusak px-3 py-1.5 text-sm font-medium text-vurgu">✓ Tutuyor</span>
                  ) : (
                    <span className="rounded-lg bg-uyari-yumusak px-3 py-1.5 text-sm font-medium text-uyari">
                      {paraFormat(Math.abs(beyanFarki.fark))} fark — ekrandaki toplam faturadakinden{' '}
                      {beyanFarki.fark > 0 ? 'FAZLA' : 'EKSİK'}
                    </span>
                  ))}
              </div>
              <p className="text-xs text-metin-3">
                Ara toplam {paraFormat(araToplam)} · KDV {paraFormat(kdvToplam)} · Genel toplam {paraFormat(genelToplam)}
              </p>
            </Bolum>

            {(hatalar.length > 0 || sktEksikler.length > 0) && (
              <Bolum baslik="Kaydetmeden önce düzeltilmeli" tehlike>
                <ul className="grid gap-1.5">
                  {hatalar.map((h) => (
                    <SorunSatiri
                      key={`h${h.satir}`}
                      metin={`${satirlar[h.satir - 1]?.ad || `Satır ${h.satir}`}: ${h.mesaj}`}
                      onDuzelt={() => satiraGit(h.satir - 1)}
                    />
                  ))}
                  {sktEksikler.map(({ s, i }) => (
                    <SorunSatiri key={`s${i}`} metin={`${s.ad}: son kullanma tarihi girilmedi`} onDuzelt={() => satiraGit(i)} />
                  ))}
                </ul>
              </Bolum>
            )}

            {supheliBarkodlar.length > 0 && (
              <Bolum baslik="Barkodu şüpheli ürünler">
                <ul className="grid gap-1.5">
                  {supheliBarkodlar.map(({ s, i, uyari }) => (
                    <SorunSatiri
                      key={i}
                      uyari
                      metin={`${s.ad || s.barkod} (${s.barkod}): ${uyari}`}
                      onDuzelt={() => satiraGit(i)}
                    />
                  ))}
                </ul>
              </Bolum>
            )}

            {zarardakiler.length > 0 && (
              <Bolum baslik="Zararına satılacak ürünler">
                <ul className="grid gap-1.5">
                  {zarardakiler.map(({ s, i, marj }) => (
                    <SorunSatiri
                      key={i}
                      uyari
                      metin={`${s.ad}: raf fiyatı alışın altında (%${(marj ?? 0).toFixed(1)})`}
                      onDuzelt={() => satiraGit(i)}
                    />
                  ))}
                </ul>
              </Bolum>
            )}

            {degisenler.length > 0 && (
              <Bolum baslik="Fiyatı değişen ürünler">
                <table className="tablo">
                  <thead>
                    <tr>
                      <th>Ürün</th>
                      <th className="text-right">Alış (KDV hariç)</th>
                      <th className="text-right">Raf fiyatı</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {degisenler.map(({ s, i, alisHaric, alisDegisti, rafDegisti }) => (
                      <tr key={i}>
                        <td className="font-medium">{s.ad}</td>
                        <td className="text-right font-mono text-sm">
                          {alisDegisti ? `${paraFormat(s.mevcutAlis ?? 0)} → ${paraFormat(alisHaric)}` : 'aynı'}
                        </td>
                        <td className="text-right font-mono text-sm">
                          {rafDegisti ? (
                            `${paraFormat(s.mevcutSatis ?? 0)} → ${paraFormat(s.satis)}`
                          ) : (
                            <span className="text-uyari">değişmiyor</span>
                          )}
                        </td>
                        <td className="text-right">
                          <button type="button" className="text-sm text-vurgu hover:underline" onClick={() => satiraGit(i)}>
                            Düzenle
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Bolum>
            )}

            <Bolum baslik="Ödeme">
              <p className="text-sm text-metin-2">
                {tedarikciAdi} ·{' '}
                {odemeDurumu === 'BORC'
                  ? 'Borç kalacak'
                  : odemeDurumu === 'NAKIT'
                    ? 'Nakit ödendi (kasadan)'
                    : 'Kart / havale ile ödendi'}{' '}
                ·{' '}
                <button type="button" className="text-vurgu hover:underline" onClick={() => setAdim(1)}>
                  değiştir
                </button>
              </p>
              {odemeDurumu !== 'BORC' && (
                <Alan etiket="Ödenen tutar" ipucu="Kısmi ödediyseniz azaltın; kalanı tedarikçi borcu olarak yazılır.">
                  <ParaAlani
                    deger={odenenTutar}
                    onDegisim={(v) => setOdenenTutarElle(v)}
                    sinif={`w-48 ${odenenTutarAsimi ? 'border-tehlike' : ''}`}
                  />
                  {odenenTutarAsimi && (
                    <span className="mt-1 block text-xs text-tehlike">Ödenen tutar genel toplamı aşamaz.</span>
                  )}
                </Alan>
              )}
              <p className="text-sm">
                Kalan borç:{' '}
                <span className="font-mono font-bold text-uyari">{paraFormat(Math.max(0, genelToplam - odenenTutar))}</span>
              </p>
            </Bolum>
          </div>
        </div>
      )}

      {kart && (
        <UrunKartiDiyalogu
          urun={'urun' in kart ? kart.urun : 'yeni'}
          kategoriler={kategoriler}
          onKapat={() => setKart(null)}
          // Stok bu faturadan gelir; karttan ayrıca girilirse ikinci kez sayılır.
          stokGizli
          onKaydedildi={() => 'urun' in kart && void kartKaydedildi(kart.sira, kart.urun.id)}
          taslak={'taslak' in kart ? { baslangic: kart.taslak, onUygula: (t) => taslagiUygula(kart.sira, t) } : undefined}
        />
      )}
    </Diyalog>
  );
}

// ---------------------------------------------------------------------------
// Sağ panel: seçili satırın ayrıntısı
// ---------------------------------------------------------------------------

function SatirPaneli({
  s,
  sira,
  dahil,
  marj,
  genelKategori,
  kategoriler,
  hata,
  guncelle,
  kartiAc,
  bagla,
  bitti,
}: {
  s: Satir;
  sira: number;
  dahil: boolean;
  marj: number | undefined;
  genelKategori: string;
  kategoriler: Kategori[];
  hata: string | null;
  guncelle: (y: Partial<Satir>) => void;
  kartiAc: () => void;
  bagla: () => void;
  /** Satır tamam: el okuyucuya dönsün. */
  bitti: () => void;
}) {
  const yeni = !s.urun_id;
  const kdv = kdvSayisi(s);
  const alisHaric = alisMatrahi(s.alis, kdv, dahil);
  const alisEtiketi = `Birim alış — faturadaki gibi (${dahil ? 'KDV dahil' : 'KDV hariç'})`;
  const enterIleBitir = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      bitti();
    }
  };

  // Raf fiyatı önerileri
  const marjOnerisi = marj !== undefined && marj < 100 && alisHaric > 0 ? marjdanFiyat(alisHaric, marj, kdv) : null;
  const alisDegisti = !yeni && s.mevcutAlis !== undefined && s.alis > 0 && alisHaric !== s.mevcutAlis;
  const ayniOranOnerisi =
    alisDegisti && s.mevcutAlis !== undefined && s.mevcutSatis !== undefined
      ? ayniKarOraniylaRafFiyati(s.mevcutAlis, s.mevcutSatis, alisHaric, kdv)
      : null;
  const rafFiyati = s.satis || (yeni ? (marjOnerisi ?? 0) : 0);
  const kar = alisHaric > 0 && rafFiyati > 0 ? birimKarHesabi(alisHaric, rafFiyati, kdv) : null;

  return (
    <div className="kart grid gap-3 p-4">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 font-mono text-xs text-metin-4">#{sira + 1}</span>
        <div className="min-w-0 flex-1">
          {yeni ? (
            <p className="flex items-center gap-2 font-semibold">
              Yeni ürün <Rozet tur="bilgi">Katalogda yok</Rozet>
            </p>
          ) : (
            <button
              type="button"
              className="text-left text-base font-semibold hover:text-vurgu hover:underline"
              onClick={kartiAc}
            >
              {s.ad}
            </button>
          )}
          {s.barkod && !yeni && <p className="font-mono text-xs text-metin-3">{s.barkod}</p>}
        </div>
      </div>

      {yeni && (
        <>
          <Alan etiket="Ürün adı *">
            <input
              data-ad-alani
              className="alan"
              value={s.ad}
              onChange={(e) => guncelle({ ad: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  document.querySelector<HTMLInputElement>('[data-panel-alis-kap] input')?.focus();
                }
              }}
              placeholder="Rafta görünecek ad"
            />
          </Alan>
          <div className="grid grid-cols-2 gap-2">
            <Alan etiket="Barkod">
              <input
                className="alan font-mono"
                value={s.barkod}
                onChange={(e) => guncelle({ barkod: e.target.value })}
                placeholder="barkodsuz"
              />
            </Alan>
            {s.barkod.trim() && barkodUyarisi(s.barkod) && (
              <p className="col-span-2 -mt-1 rounded bg-uyari-yumusak px-2 py-1 text-xs text-uyari">
                {barkodUyarisi(s.barkod)} Ürünü yeniden okutun ya da barkodu düzeltin.
              </p>
            )}
            <Alan etiket="Kategori">
              <select
                className="alan"
                value={s.kart?.kategori_id ?? genelKategori}
                onChange={(e) => guncelle({ kart: { ...s.kart, kategori_id: e.target.value || null } })}
              >
                <option value="">Kategorisiz</option>
                {kategoriler.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.ad}
                  </option>
                ))}
              </select>
            </Alan>
          </div>
          <div>
            <span className="etiket">Satış birimi</span>
            <Dugmeler
              secenekler={[
                { d: 'ADET', e: 'Adet' },
                { d: 'KG', e: 'Kilo' },
                { d: 'LT', e: 'Litre' },
              ]}
              secili={s.kart?.birim_tipi ?? 'ADET'}
              sec={(d) => guncelle({ kart: { ...s.kart, birim_tipi: d as 'ADET' | 'KG' | 'LT' } })}
            />
          </div>
          <div>
            <span className="etiket">KDV oranı</span>
            <Dugmeler
              secenekler={KDV_ORANLARI.map((o) => ({ d: String(o), e: `%${o}` }))}
              secili={s.kdv}
              sec={(d) => guncelle({ kdv: d })}
            />
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Alan etiket="Miktar">
          <input
            className="alan sayi"
            inputMode="decimal"
            value={s.miktar}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => guncelle({ miktar: e.target.value })}
            onKeyDown={yeni ? undefined : enterIleBitir}
          />
        </Alan>
        {!yeni && (
          <div className="text-sm">
            <span className="etiket">KDV</span>
            <p className="pt-2 text-metin-2">%{s.kdv} (ürün kartından)</p>
          </div>
        )}
      </div>

      <Alan etiket={alisEtiketi}>
        <div data-panel-alis-kap>
          <ParaAlani deger={s.alis} onDegisim={(v) => guncelle({ alis: v })} onEnter={yeni ? undefined : bitti} />
        </div>
      </Alan>
      {dahil && s.alis > 0 && <p className="-mt-2 text-xs text-metin-3">KDV hariç {paraFormat(alisHaric)} olarak kaydedilir.</p>}
      {!yeni && s.mevcutAlis !== undefined && (
        <p className={`-mt-2 text-xs ${alisDegisti ? 'font-medium text-uyari' : 'text-metin-3'}`}>
          Önceki alış (KDV hariç): {paraFormat(s.mevcutAlis)}
          {alisDegisti && ` → şimdi ${paraFormat(alisHaric)} (${alisHaric > s.mevcutAlis ? 'zam geldi' : 'ucuzladı'})`}
        </p>
      )}

      <Alan etiket="Raf fiyatı (KDV dahil, müşterinin ödediği)">
        <ParaAlani
          deger={s.satis}
          onDegisim={(v) => guncelle({ satis: v })}
          placeholder={yeni && marjOnerisi ? `öneri ${paraFormat(marjOnerisi, { simge: false })}` : '0,00'}
          onEnter={bitti}
        />
      </Alan>
      {!yeni && s.mevcutSatis !== undefined && (
        <p className="-mt-2 text-xs text-metin-3">
          Şimdiki raf fiyatı: {paraFormat(s.mevcutSatis)}
          {s.satis !== s.mevcutSatis && s.satis > 0 && <b className="text-vurgu"> → {paraFormat(s.satis)} olacak</b>}
        </p>
      )}
      {ayniOranOnerisi !== null && ayniOranOnerisi !== s.satis && (
        <button
          type="button"
          className="rounded-lg border border-uyari-cizgi bg-uyari-yumusak px-3 py-2 text-left text-sm text-metin"
          onClick={() => guncelle({ satis: ayniOranOnerisi })}
        >
          Alış değişti. Aynı kâr oranı için raf fiyatını <b>{paraFormat(ayniOranOnerisi)}</b> yap →
        </button>
      )}
      {yeni && marjOnerisi !== null && s.satis === 0 && (
        <p className="-mt-2 text-xs text-metin-3">
          Boş bırakılırsa %{marj} kârla {paraFormat(marjOnerisi)} olur.
        </p>
      )}

      {kar && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${kar.zarar ? 'bg-tehlike-yumusak font-semibold text-tehlike' : 'bg-yuzey-2 text-metin-2'}`}
        >
          {kar.zarar
            ? `Tanesinde ${paraFormat(-kar.kar)} ZARAR`
            : `Tanesinde ${paraFormat(kar.kar)} kâr (%${kar.marjYuzde.toLocaleString('tr-TR')})`}
          <span className="block text-xs font-normal text-metin-3">
            Raf {paraFormat(rafFiyati)} − KDV {paraFormat(kar.satisKdv)} = size kalan {paraFormat(kar.satisKdvHaric)} − alış{' '}
            {paraFormat(alisHaric)}
          </span>
        </p>
      )}

      {/* SKT ve lot her üründe girilebilir; SKT takibi açık üründe zorunlu. */}
      {
        <div className="grid grid-cols-2 gap-2">
          <Alan etiket={s.sktZorunlu ? 'Son kullanma tarihi *' : 'Son kullanma tarihi'}>
            <input
              type="date"
              className={`alan ${s.sktZorunlu && !s.skt ? 'border-tehlike' : ''}`}
              value={s.skt}
              onChange={(e) => guncelle({ skt: e.target.value })}
            />
          </Alan>
          <Alan etiket="Parti / lot">
            <input className="alan" value={s.lot} onChange={(e) => guncelle({ lot: e.target.value })} />
          </Alan>
        </div>
      }

      {/*
        Düzenlenen satırda hata KIRMIZI gösterilmez: yeni barkod okutulur okutulmaz
        "Ürün adı zorunludur" diye bağırmak, kullanıcı daha yazmaya başlamadan hata
        demekti. Ad boşken hiç söylenmez (alanın yıldızı yeter); diğer eksikler sakin
        bir ipucu olur. Asıl denetim Kontrol adımındadır.
      */}
      {hata && !(yeni && !s.ad.trim()) && <p className="text-xs text-uyari">Kaydetmek için: {hata}</p>}

      <div className="flex flex-wrap gap-2 border-t border-cizgi pt-3">
        {yeni ? (
          <>
            <button type="button" className="tus-ikincil text-sm" onClick={bagla}>
              Bu ürün zaten katalogda var
            </button>
            <button type="button" className="tus-ikincil text-sm" onClick={kartiAc}>
              {s.kart ? 'Diğer ayrıntılar ✓' : 'Diğer ayrıntılar (marka, raf, SKT…)'}
            </button>
          </>
        ) : (
          <button type="button" className="tus-ikincil text-sm" onClick={kartiAc}>
            Ürün kartını aç
          </button>
        )}
        <button type="button" className="tus-birincil ml-auto text-sm" onClick={bitti}>
          Tamam, sıradaki ürün
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Küçük parçalar
// ---------------------------------------------------------------------------

function AdimGostergesi({
  adim,
  git,
  ikinciAcik,
  ucuncuAcik,
}: {
  adim: Adim;
  git: (a: Adim) => void;
  ikinciAcik: boolean;
  ucuncuAcik: boolean;
}) {
  const adimlar: { no: Adim; ad: string; acik: boolean }[] = [
    { no: 1, ad: 'Fatura', acik: true },
    { no: 2, ad: 'Ürünler', acik: ikinciAcik },
    { no: 3, ad: 'Kontrol', acik: ucuncuAcik },
  ];
  return (
    <ol className="flex items-center gap-1 text-sm">
      {adimlar.map((a, i) => (
        <li key={a.no} className="flex items-center gap-1">
          {i > 0 && <span className="text-metin-4">—</span>}
          <button
            type="button"
            disabled={!a.acik}
            onClick={() => git(a.no)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 ${
              adim === a.no
                ? 'bg-vurgu font-semibold text-vurgu-uzeri'
                : a.acik
                  ? 'text-metin-2 hover:bg-yuzey-2'
                  : 'text-metin-4'
            }`}
          >
            <span className="font-mono">{a.no}</span> {a.ad}
          </button>
        </li>
      ))}
    </ol>
  );
}

function Bolum({ no, baslik, tehlike, children }: { no?: number; baslik: string; tehlike?: boolean; children: ReactNode }) {
  return (
    <section className={`kart grid content-start gap-3 p-5 ${tehlike ? 'border-2 border-tehlike-cizgi' : ''}`}>
      <h3 className="flex items-center gap-2 font-semibold">
        {no !== undefined && (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-yuzey-3 text-xs font-bold text-metin-2">
            {no}
          </span>
        )}
        {baslik}
      </h3>
      {children}
    </section>
  );
}

function SecimKarti({
  secili,
  onClick,
  baslik,
  aciklama,
}: {
  secili: boolean;
  onClick: () => void;
  baslik: string;
  aciklama: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={secili}
      onClick={onClick}
      className={`flex flex-col gap-1 rounded-xl border-2 p-3 text-left transition-colors ${
        secili ? 'border-vurgu bg-vurgu-yumusak' : 'border-cizgi hover:bg-yuzey-2'
      }`}
    >
      <span className="flex items-center gap-2 font-semibold">
        <span
          className={`h-4 w-4 shrink-0 rounded-full border-2 ${secili ? 'border-vurgu bg-vurgu' : 'border-cizgi-kuvvetli'}`}
          aria-hidden
        />
        {baslik}
      </span>
      <span className="text-xs text-metin-3">{aciklama}</span>
    </button>
  );
}

function Dugmeler({
  secenekler,
  secili,
  sec,
}: {
  secenekler: { d: string; e: string }[];
  secili: string;
  sec: (d: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {secenekler.map((o) => (
        <button
          key={o.d}
          type="button"
          onClick={() => sec(o.d)}
          className={`rounded-lg border px-3 py-1.5 text-sm ${
            secili === o.d ? 'border-vurgu bg-vurgu font-semibold text-vurgu-uzeri' : 'border-cizgi hover:bg-yuzey-2'
          }`}
        >
          {o.e}
        </button>
      ))}
    </div>
  );
}

function Kutu({ etiket, deger, vurgu }: { etiket: string; deger: string; vurgu?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${vurgu ? 'border-vurgu bg-vurgu-yumusak' : 'border-cizgi bg-yuzey'}`}>
      <div className="text-xs text-metin-3">{etiket}</div>
      <div className={`font-mono ${vurgu ? 'text-xl font-bold text-vurgu' : 'text-lg font-semibold'}`}>{deger}</div>
    </div>
  );
}

function SorunSatiri({ metin, onDuzelt, uyari }: { metin: string; onDuzelt: () => void; uyari?: boolean }) {
  return (
    <li
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
        uyari ? 'bg-uyari-yumusak text-metin' : 'bg-tehlike-yumusak text-tehlike'
      }`}
    >
      <span className="flex-1">{metin}</span>
      <button type="button" className="font-medium underline" onClick={onDuzelt}>
        Düzelt
      </button>
    </li>
  );
}
