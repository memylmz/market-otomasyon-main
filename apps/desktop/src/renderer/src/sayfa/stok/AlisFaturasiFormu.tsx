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
  kdvAyir,
  paraFormat,
  topluGirisKalemleri,
  KDV_ORANLARI,
  VARSAYILAN_KDV_ORANI,
  carpanCoz,
  satiriKat,
  sktSutunuGerekli,
  type AlisSatiri,
  type AlisKalemGirdisi,
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

/**
 * Fatura toplamı kasadaki kuralla BİREBİR aynı hesaplanır (bkz. stok-servis.ts
 * `malKabulOnayla`): birim fiyat KDV hariçtir, KDV satır bazında eklenir.
 * Aksi halde ekranda görünen tutar, onaylanınca yazılan tutardan sapabilir.
 */
function faturaToplamlari(kalemler: readonly AlisKalemGirdisi[]): {
  araToplam: Kurus;
  kdvToplam: Kurus;
  genelToplam: Kurus;
} {
  let araToplam = 0;
  let kdvToplam = 0;
  for (const kalem of kalemler) {
    const net = Math.round((kalem.miktar * kalem.birim_fiyat) / 1000);
    const { kdv } = kdvAyir(net + Math.round((net * kalem.kdv_orani) / 100), kalem.kdv_orani);
    araToplam += net;
    kdvToplam += kdv;
  }
  return { araToplam, kdvToplam, genelToplam: araToplam + kdvToplam };
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
          bildir.bilgi('Ürün bulunamadı', 'Yeni ürün satırı eklendi; adını ve satış fiyatını girin.');
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

  return (
    <Diyalog
      acik={acik}
      baslik="Mal Kabul / Alış Faturası"
      aciklama="Onaylandığında stok artar, tedarikçiye cari borç oluşur; katalogda olmayan ürünler fatura ile aynı anda açılır."
      genislik="genis"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={() => void gonder()} disabled={!kaydedilebilir}>
            {gonderiliyor ? 'Kaydediliyor…' : 'Faturayı Kaydet'}
          </button>
        </>
      }
    >
      <div className="mb-3 grid gap-3 md:grid-cols-3">
        <Alan etiket="Tedarikçi *">
          <select className="alan" value={tedarikciId} onChange={(e) => setTedarikciId(e.target.value)} data-odak>
            <option value="">Seçiniz…</option>
            {tedarikciler.map((t) => (
              <option key={t.id} value={t.id}>
                {t.ad_unvan}
              </option>
            ))}
          </select>
        </Alan>
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
          {odenenTutarAsimi && <span className="mt-1 block text-xs text-tehlike">Ödenen tutar genel toplamı aşamaz.</span>}
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
          <input className="alan sayi" value={marjYuzde} onChange={(e) => setMarjYuzde(e.target.value)} placeholder="Örn. 30" />
        </Alan>
        <Alan etiket="Notlar">
          <input className="alan" value={notlar} onChange={(e) => setNotlar(e.target.value)} />
        </Alan>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2 border-t border-cizgi pt-3">
        <div className="min-w-[240px] flex-1">
          <Alan etiket="Barkod" ipucu="Okutun ya da yazıp Enter'layın. Koli için çarpan: 12*barkod. Boş Enter, barkodsuz yeni ürün satırı açar.">
            <input
              ref={barkodAlani}
              className="alan"
              value={barkodGirdi}
              onChange={(e) => setBarkodGirdi(e.target.value)}
              onKeyDown={(e) => void barkodEnter(e)}
              placeholder="Barkod okutun veya yazın…"
            />
          </Alan>
        </div>
        <button type="button" className="tus-ikincil" onClick={() => setAramaAcik((a) => !a)}>
          {aramaAcik ? 'Aramayı kapat' : 'Mevcut üründen ekle'}
        </button>
        {/* Canlı sayaç: kırk kalemlik girişte toplam ekranın altında kalıyor,
            kullanıcı nerede olduğunu görmek için aşağı kaydırmak zorundaydı. */}
        <div className="ml-auto text-right text-sm leading-tight">
          <div className="text-metin-3">
            {satirlar.length} satır
            {yeniSatirSayisi > 0 && <span className="text-vurgu"> · {yeniSatirSayisi} yeni ürün</span>}
          </div>
          <div className="font-mono text-base font-bold">{paraFormat(genelToplam)}</div>
        </div>
      </div>

      {aramaAcik && (
        <div className="mb-3">
          <UrunSecici onSec={satirEkleMevcut} placeholder="Barkodu olmayan mevcut ürünü adıyla arayın…" otomatikOdak />
        </div>
      )}

      {satirlar.length === 0 ? (
        <p className="py-6 text-center text-sm text-metin-4">
          Barkod okutarak, yazıp Enter&apos;layarak ya da isimle arayarak kalem ekleyin.
        </p>
      ) : (
        <table className="tablo">
          <thead>
            <tr>
              <th className="w-32">Barkod</th>
              <th>Ürün</th>
              <th className="w-20">Miktar</th>
              <th className="w-28">Alış (KDV hariç)</th>
              <th className="w-28">Satış (KDV dahil)</th>
              <th className="w-20">KDV</th>
              {sktGerekli && <th className="w-32">SKT</th>}
              {sktGerekli && <th className="w-24">Lot</th>}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {satirlar.map((s, i) => {
              const yeniUrun = !s.urun_id;
              return (
                <tr key={i} className={vurgulu === i ? 'bg-vurgu-yumusak' : ''}>
                  <td>
                    {yeniUrun ? (
                      <input
                        className="alan py-1"
                        value={s.barkod}
                        onChange={(e) => guncelle(i, { barkod: e.target.value })}
                        placeholder="Barkodsuz"
                      />
                    ) : (
                      <span className="text-metin-3">{s.barkod || '—'}</span>
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
                      </div>
                    ) : (
                      <span className="font-medium">{s.ad}</span>
                    )}
                  </td>
                  <td>
                    <input className="alan sayi py-1" value={s.miktar} onChange={(e) => guncelle(i, { miktar: e.target.value })} />
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
                        {s.sktZorunlu && !s.skt && <span className="mt-0.5 block text-[11px] text-tehlike">SKT zorunlu</span>}
                      </td>
                      <td>
                        <input className="alan py-1" value={s.lot} onChange={(e) => guncelle(i, { lot: e.target.value })} />
                      </td>
                    </>
                  )}
                  <td>
                    <button type="button" className="text-tehlike" onClick={() => setSatirlar((liste) => liste.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {hatalar.length > 0 && (
        <div className="mt-3 rounded border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm text-tehlike">
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
        <div className="mt-4 space-y-1 border-t border-cizgi pt-3 text-sm">
          <div className="flex justify-between">
            <span className="text-metin-3">Ara toplam (KDV hariç)</span>
            <span className="font-mono">{paraFormat(araToplam, { simge: false })}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-metin-3">KDV</span>
            <span className="font-mono">{paraFormat(kdvToplam, { simge: false })}</span>
          </div>
          <div className="flex justify-between border-t border-cizgi-ince pt-1">
            <span className="font-medium">Genel toplam</span>
            <span className="font-mono text-base font-bold">{paraFormat(genelToplam)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-metin-3">Ödenen</span>
            <span className="font-mono text-vurgu">{paraFormat(odenenTutar)}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium">Kalan borç</span>
            <span className="font-mono font-bold text-uyari">{paraFormat(Math.max(0, genelToplam - odenenTutar))}</span>
          </div>
        </div>
      )}
    </Diyalog>
  );
}
