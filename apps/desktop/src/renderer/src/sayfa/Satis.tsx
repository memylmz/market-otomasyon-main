/**
 * Satış ekranı (§10.3) — sistemin en kritik ekranı.
 *
 * Tasarım kuralları:
 *  - İmleç **her zaman** barkod alanındadır; okut → satır sepete düşer.
 *  - Tüm akış fareye dokunmadan tamamlanabilir; kısayollar altta görünür.
 *  - Tutarlar arayüzde anında hesaplanır (paylaşılan saf fonksiyon), kesinleştirmede
 *    ana süreç yeniden hesaplar — arayüzün sayısına güvenilmez.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  adet,
  barkodNormalize,
  carpanAyikla,
  miktarFormat,
  miktarOlustur,
  paraFormat,
  type BirimTipi,
  type KampanyaTanimi,
  type Kurus,
  type Miktar,
} from '@market/shared';
import { BosDurum, Kisayol, MiktarAlani, ParaAlani, Rozet, TutarSatiri } from '../bilesen/temel';
import { HizliUrunIzgarasi } from '../bilesen/HizliUrunIzgarasi';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { oturumDurumu, useYetki } from '../durum/oturum';
import { satisGirdisiOlustur, sepetDurumu, type EklenecekUrun, type SepetAnlik } from '../durum/sepet';
import { useBarkodOdakYakalayici, useBarkodTekrarKorumasi, useKisayol } from '../kanca/useKisayol';
import { cagir } from '../kopru';
import { OdemeDiyalogu } from './satis/OdemeDiyalogu';
import { BorcluSecTahsilat } from './satis/BorcluSecTahsilat';
import { UrunAramaDiyalogu } from './satis/UrunAramaDiyalogu';
import { MusteriSecDiyalogu } from './satis/MusteriSecDiyalogu';
import { IskontoDiyalogu } from './satis/IskontoDiyalogu';
import { TartimDiyalogu } from './satis/TartimDiyalogu';

interface BarkodSonucu {
  bulundu: boolean;
  /** Terazi barkodundan çözülen miktar; doluysa tartım sorulmaz. */
  miktar?: Miktar;
  urun?: {
    id: string;
    ad: string;
    kategori_id?: string | null;
    birim_tipi: BirimTipi;
    satis_fiyati: Kurus;
    kdv_orani: number;
    stok: Miktar;
    aktif_mi: boolean;
    barkodlar: string[];
  };
  fiyat?: Kurus;
  kampanyaId?: string | null;
  uyari?: string;
}

/** `urun.ara` kanalından dönen satır (canlı öneri listesi için). */
interface OneriUrun {
  id: string;
  ad: string;
  marka: string | null;
  birim_tipi: BirimTipi;
  satis_fiyati: Kurus;
  kdv_orani: number;
  stok: Miktar;
  aktif_mi: boolean;
  barkodlar: string[];
}

/**
 * +/− düğmelerinin ve ok tuşlarının adım büyüklüğü (§10.3).
 *
 * ADET üründe 1 doğru adımdır. KG/LT'de 1 birim adım işe yaramaz: 350 gramlık
 * peynirde "+1 kg" düzeltme değil, yeni bir hatadır. Tartılan üründe pratik
 * düzeltme 100 gramlık adımlardır.
 */
function miktarAdimi(birim: BirimTipi): Miktar {
  return birim === 'ADET' ? adet(1) : miktarOlustur(0.1);
}

export function SatisSayfasi() {
  const sepet = sepetDurumu();
  const hesap = sepet.hesap();
  const kasaAcik = oturumDurumu((s) => Boolean(s.sistem?.oturum?.kasaOturumId));
  const tazele = oturumDurumu((s) => s.tazele);
  const iadeYetkisiVar = useYetki('satis.iade');
  const gezin = useNavigate();

  const barkodAlani = useRef<HTMLInputElement>(null);
  const [barkodMetni, setBarkodMetni] = useState('');
  const [adetOneki, setAdetOneki] = useState<number | null>(null);
  const [islemde, setIslemde] = useState(false);

  const [odemeAcik, setOdemeAcik] = useState(false);
  /*
   * Ödeme penceresinin ön seçili yöntemi. Müşteri seçiliyse VERESİYE gelir:
   * F1 ile müşteri seçmiş kasiyerin niyeti hemen her zaman veresiyedir ve
   * pencere Enter'la kapandığı için tek tuş kalır. Seçili değilse nakit.
   */
  const odemeBaslangicTipi = sepet.musteriId ? ('VERESIYE' as const) : ('NAKIT' as const);
  /** F5/F4 nakit yolunda açılan tek alanlı "Alınan" kutusu. null → kapalı. */
  /** F4 ile açıldıysa satış sonunda fiş basılır; F5 ile açıldıysa basılmaz. */
  const [fisYazdirilacak, setFisYazdirilacak] = useState(false);
  const [aramaAcik, setAramaAcik] = useState(false);
  const [tahsilatAcik, setTahsilatAcik] = useState(false);
  /** Barkod kutusuna isim yazılıp bulunamadığında arama diyaloğuna aktarılan terim. */
  const [aramaTerimi, setAramaTerimi] = useState('');
  const [musteriAcik, setMusteriAcik] = useState(false);

  /*
   * Etkin kampanyalar bir kez çekilir (§10.8).
   *
   * Miktar bazlı indirim her miktar değişiminde yeniden hesaplanır; bunu her
   * seferinde IPC'ye sormak sıcak yolu yavaşlatırdı. Liste bellekte durur,
   * hesap arayüzde yapılır. Satışta sunucu bağımsız olarak tekrar hesaplar.
   */
  useEffect(() => {
    void cagir<KampanyaTanimi[]>('kampanya.etkin')
      .then((liste) => sepetDurumu.getState().kampanyalariAyarla(liste))
      .catch(() => {
        /* kampanya çekilemezse satış normal fiyattan sürer */
      });
  }, []);

  /*
   * SEPET KURTARMA (§10.3).
   *
   * Sepet sekmeleri yalnız bellekteydi: elektrik kesintisinde ya da çökmede
   * kasiyerin bekleyen sepetleri birden kayboluyordu — market kasasında bu,
   * müşteri sırasının baştan okutulması demek. Değişiklikler gecikmeli olarak
   * diske yazılır, açılışta geri yüklenir.
   *
   * Gecikme bilinçli: her tuş vuruşunda diske yazmak sıcak yolu yavaşlatır.
   */
  useEffect(() => {
    let iptal = false;
    void (async () => {
      try {
        const { veri } = await cagir<{ veri: SepetAnlik | null }>('satis.sepetleriOku');
        if (iptal || !veri) return;
        const d = sepetDurumu.getState();
        // Yalnız hiçbir şey yokken geri yükle; kasiyer bu arada ürün okuttuysa onu ezme.
        if (d.satirlar.length === 0 && d.bekleyenler.length === 0) d.geriYukle(veri);
      } catch {
        /* kurtarma isteğe bağlıdır; başarısızlığı satışı engellemez */
      }
    })();
    return () => {
      iptal = true;
    };
  }, []);

  useEffect(() => {
    let zamanlayici: ReturnType<typeof setTimeout> | null = null;
    const yaz = () => {
      if (zamanlayici) clearTimeout(zamanlayici);
      zamanlayici = setTimeout(() => {
        const d = sepetDurumu.getState();
        const bosMu = d.satirlar.length === 0 && d.bekleyenler.length === 0;
        void cagir(bosMu ? 'satis.sepetleriUnut' : 'satis.sepetleriKaydet', bosMu ? {} : { veri: d.anlikGoruntu() }).catch(
          () => {},
        );
      }, 1200);
    };
    const birak = sepetDurumu.subscribe(yaz);
    return () => {
      if (zamanlayici) clearTimeout(zamanlayici);
      birak();
    };
  }, []);
  const [iskontoAcik, setIskontoAcik] = useState(false);
  const [fiyatSorgu, setFiyatSorgu] = useState<{ ad: string; fiyat: Kurus; stok: Miktar; birim: BirimTipi } | null>(null);
  const [fiyatSorguModu, setFiyatSorguModu] = useState(false);
  /** KG/LT ürün için miktar (tartım) diyaloğunda bekleyen ürün. */
  const [tartilan, setTartilan] = useState<EklenecekUrun | null>(null);
  /** Barkod kutusuna isim yazılırken beliren canlı öneriler. */
  const [oneriler, setOneriler] = useState<OneriUrun[]>([]);
  const [oneriIndeks, setOneriIndeks] = useState(0);

  const tekrarKorumasi = useBarkodTekrarKorumasi(120);
  const diyalogAcik = odemeAcik || aramaAcik || musteriAcik || iskontoAcik || tartilan !== null || tahsilatAcik;
  const oneriAcik = oneriler.length > 0 && !diyalogAcik;

  const odaklan = useCallback(() => {
    if (!diyalogAcik) barkodAlani.current?.focus();
  }, [diyalogAcik]);

  // Yalnız ekrana ilk girişte ve diyalog kapanınca odaklan.
  // ESKİDEN her sepet değişiminde ve her blur'da geri odaklanılıyordu; bu, odağı
  // tuzağa çevirip miktar/fiyat alanlarını ve +/- kısayollarını kullanılamaz
  // kılıyordu. Odak artık serbest; okutma yapılırsa aşağıdaki yakalayıcı devreye girer.
  useEffect(() => {
    if (!diyalogAcik) odaklan();
  }, [diyalogAcik, odaklan]);

  // Barkod alanı odakta değilken okutma yapılırsa otomatik odaklan ve karakteri aktar.
  useBarkodOdakYakalayici({
    aktif: !diyalogAcik,
    odakla: () => barkodAlani.current?.focus(),
    onKarakter: (karakter) => setBarkodMetni((mevcut) => mevcut + karakter),
  });

  // -------------------------------------------------------------------------
  // Ürün ekleme
  // -------------------------------------------------------------------------

  const urunuEkle = useCallback((urun: EklenecekUrun, miktar?: Miktar) => {
    if (urun.stok <= 0) {
      bildir.uyari(`"${urun.ad}" stokta görünmüyor`, 'Satış yapılabilir ancak stok eksiye düşecek.');
    }
    sepetDurumu.getState().ekle(urun, miktar);
  }, []);

  /**
   * Sepete giden TEK kapı: KG/LT ürünlerde miktar verilmemişse önce tartım
   * diyaloğu açılır (bağlı terazi açıksa ağırlık canlı okunur; değilse kasiyer kg'ı ya da tutarı girer).
   */
  const sepeteAl = useCallback(
    (urun: EklenecekUrun, miktar?: Miktar) => {
      if (miktar === undefined && urun.birimTipi !== 'ADET') {
        setTartilan(urun);
        return;
      }
      urunuEkle(urun, miktar);
    },
    [urunuEkle],
  );

  // Barkod kutusuna harf içeren bir şey yazıldığında canlı öneri getirilir:
  // "Ara" düğmesine basmadan, aynı kutudan isimle ekleme yapılabilir.
  useEffect(() => {
    const terim = barkodMetni.trim();
    if (diyalogAcik || terim.length < 2 || /^[\d\s]*$/.test(terim)) {
      setOneriler([]);
      return;
    }
    let iptal = false;
    const zamanlayici = setTimeout(async () => {
      try {
        const veri = await cagir<OneriUrun[]>('urun.ara', { terim, limit: 8 });
        if (!iptal) {
          setOneriler(veri.filter((u) => u.aktif_mi));
          setOneriIndeks(0);
        }
      } catch {
        if (!iptal) setOneriler([]);
      }
    }, 160);
    return () => {
      iptal = true;
      clearTimeout(zamanlayici);
    };
  }, [barkodMetni, diyalogAcik]);

  const oneriyiEkle = useCallback(
    (urun: OneriUrun) => {
      const miktar = adetOneki ? adet(adetOneki) : undefined;
      setAdetOneki(null);
      setBarkodMetni('');
      setOneriler([]);
      sepeteAl(
        {
          urunId: urun.id,
          ad: urun.ad,
          barkod: urun.barkodlar[0] ?? null,
          birimTipi: urun.birim_tipi,
          birimFiyat: urun.satis_fiyati,
          listeFiyati: urun.satis_fiyati,
          kdvOrani: urun.kdv_orani,
          kampanyaId: null,
          stok: urun.stok,
        },
        miktar,
      );
      // Fareyle seçildiğinde imleç listede kalıyordu; her ekleme yolu sonunda
      // barkod kutusuna dönmeli ki sonraki ürün doğrudan okutulabilsin.
      odaklan();
    },
    [adetOneki, sepeteAl, odaklan],
  );

  const barkodIsle = useCallback(
    /**
     * `carpan` VERİLDİĞİNDE duruma bakılmaz. Sebep: "3*barkod" akışında çarpan
     * ile barkod aynı hamlede gelir; çarpanı önce `setAdetOneki` ile duruma
     * yazıp hemen burayı çağırmak, React güncellemesi asenkron olduğu için eski
     * (çarpansız) değeri okuturdu ve 3 yerine 1 adet eklenirdi.
     */
    async (hamBarkod: string, carpan?: number) => {
      const barkod = barkodNormalize(hamBarkod);
      if (!barkod) return;
      if (!tekrarKorumasi(barkod)) return;

      try {
        const sonuc = await cagir<BarkodSonucu>('urun.barkodOku', { barkod });
        if (!sonuc.bulundu || !sonuc.urun) {
          // Barkod eşleşmedi. Girilen metin barkoda benzemiyorsa (harf içeriyor ya
          // da kısaysa) kullanıcı büyük ihtimalle ÜRÜN ADI yazmıştır — arama
          // penceresini o terimle açarız. Böylece barkodsuz ürünler de aynı
          // kutudan sepete eklenebilir, ayrı bir adım gerekmez.
          const barkodaBenziyor = /^\d{8,}$/.test(barkod);
          if (!barkodaBenziyor) {
            setAramaTerimi(hamBarkod.trim());
            setAramaAcik(true);
            return;
          }
          bildir.uyari('Ürün bulunamadı', `"${barkod}" barkodu kayıtlı değil. F3 ile isimden arayabilirsiniz.`);
          return;
        }
        if (sonuc.uyari) {
          bildir.uyari(sonuc.uyari);
          return;
        }

        const urun = sonuc.urun;
        const fiyat = sonuc.fiyat ?? urun.satis_fiyati;

        if (fiyatSorguModu) {
          setFiyatSorgu({ ad: urun.ad, fiyat, stok: urun.stok, birim: urun.birim_tipi });
          return;
        }

        /*
         * Terazi barkodundan gelen miktar her şeyin ÖNÜNDEDİR: tartım fiilen
         * yapılmış ve etikete basılmıştır. Kasiyere tekrar sormak hem yavaşlatır
         * hem de elle yanlış girme ihtimali doğurur.
         */
        const etkinCarpan = carpan ?? adetOneki;
        const miktar = sonuc.miktar ?? (etkinCarpan ? miktarOlustur(etkinCarpan) : undefined);
        setAdetOneki(null);
        sepeteAl(
          {
            urunId: urun.id,
            ad: urun.ad,
            barkod,
            kategoriId: urun.kategori_id ?? null,
            birimTipi: urun.birim_tipi,
            birimFiyat: fiyat,
            listeFiyati: urun.satis_fiyati,
            kdvOrani: urun.kdv_orani,
            kampanyaId: sonuc.kampanyaId ?? null,
            stok: urun.stok,
          },
          miktar,
        );
      } catch (hata) {
        hatayiBildir(hata, 'Barkod okuma');
      }
    },
    [adetOneki, fiyatSorguModu, tekrarKorumasi, sepeteAl],
  );

  const barkodGonder = () => {
    const metin = barkodMetni.trim();
    setBarkodMetni('');
    setOneriler([]);
    if (!metin) return;

    // "3 x barkod" / "3*barkod" (§10.3 adet girişi). Çarpan duruma YAZILMAZ,
    // doğrudan değer olarak geçer — durum yarışı olmasın diye.
    const { carpan, kalan } = carpanAyikla(metin);
    if (carpan) {
      setAdetOneki(carpan);
      // Çarpanın arkasında ürün yoksa ("3*") burada BEKLENİR: kasiyer ürünü
      // sonra seçer — barkod okutarak, öneri listesinden ya da hızlı ürün
      // karesine basarak. Üçü de `adetOneki`'ni okur.
      if (kalan) void barkodIsle(kalan, carpan);
      return;
    }
    // Yalnız sayı + Enter → sonraki okutmanın adedi
    if (/^\d{1,3}$/.test(metin) && sepet.satirlar.length >= 0 && metin.length <= 3 && Number(metin) > 0 && Number(metin) < 1000) {
      setAdetOneki(Number(metin));
      return;
    }
    void barkodIsle(metin);
  };

  // -------------------------------------------------------------------------
  // Satış kesinleştirme
  // -------------------------------------------------------------------------

  // `useCallback`: `hizliSatis` buna bağımlı; her render'da yeniden üretilmesi
  // kısayolların bağımlılık dizisini boşuna değiştiriyordu. `tazele` (zustand)
  // ve `odaklan` (kendisi useCallback) kararlı olduğu için bağımlılık listesi
  // eksiksiz — bayat kapanış riski yok.
  const satisiTamamla = useCallback(
    async (
      odemeler: {
        tip: 'NAKIT' | 'KART' | 'VERESIYE';
        tutar: Kurus;
        alinan?: Kurus;
        pos_onay_kodu?: string | null;
        pos_referans?: string | null;
        pos_kart?: string | null;
      }[],
      onaylar: { limitAsimiOnaylandi?: boolean; negatifStokOnaylandi?: boolean },
      /** true → fiş bas, false → basma, undefined → ayar karar versin. */
      fisYazdir?: boolean,
    ) => {
      setIslemde(true);
      /*
       * POS açıksa kart tutarı ana süreçte ÖNCE cihaza gönderilir; onay gelmeden
       * satış kaydedilmez, kayıt hata verirse çekim geri alınır (pos-servis).
       * Burada yalnız kasiyere "kart bekleniyor" bilgisi verilir.
       */
      const kartTutari = odemeler.filter((o) => o.tip === 'KART').reduce((t, o) => t + o.tutar, 0);
      if (kartTutari > 0) {
        try {
          const pos = await cagir<{ aktif: boolean }>('pos.durum');
          if (pos.aktif) bildir.bilgi('POS cihazında kart bekleniyor', `${paraFormat(kartTutari)} — müşteri kartını okutsun.`);
        } catch {
          /* bilgi mesajı; satış akışını durdurmaz */
        }
      }
      try {
        // Stok aşımı satışı ENGELLEMEZ (§20): stok kaydı sayım hatası veya geç
        // girilen mal kabul yüzünden gerçeğin gerisinde olabilir; müşteri bunun
        // için bekletilmez. Kasiyer uyarıyı ödeme ekranında görmüş olur, kayıt
        // `uyarilar` ile döner ve eksiye düşen ürün stok raporunda listelenir.
        const girdi = { ...satisGirdisiOlustur(odemeler, { ...onaylar, negatifStokOnaylandi: true }), fis_yazdir: fisYazdir };
        const sonuc = await cagir<{
          satisId: string;
          fisNo: string;
          genelToplam: Kurus;
          paraUstu: Kurus;
          uyarilar: string[];
        }>('satis.kesinlestir', girdi);

        // Ödenen sepet kapanır; bekleyen sepet varsa otomatik ona geçilir.
        sepetDurumu.getState().satisSonrasi();
        setOdemeAcik(false);

        const paraUstuMetni = sonuc.paraUstu > 0 ? ` · Para üstü: ${paraFormat(sonuc.paraUstu)}` : '';
        bildir.basari(`Satış tamamlandı — ${sonuc.fisNo}`, `${paraFormat(sonuc.genelToplam)}${paraUstuMetni}`);

        for (const uyari of sonuc.uyarilar) bildir.uyari(uyari);
        // Yazdırma arka planda sürüyor; sonucu 'fis:yazdirma' olayıyla gelir (App.tsx).
        void tazele();
      } catch (hata) {
        hatayiBildir(hata, 'Satış');
      } finally {
        setIslemde(false);
        odaklan();
      }
    },
    [tazele, odaklan],
  );

  /**
   * Tek tuşla satış (§10.3).
   *
   * Müşteri seçiliyse tutarın tamamı VERESİYE olarak o müşterinin borç
   * defterine yazılır ve hiçbir şey sorulmaz — kasiyerin "veresiye mi?" diye
   * ikinci kez karar vermesi gerekmez, kararı zaten F1 ile vermiştir.
   * Müşteri yoksa nakit satıştır ve yalnız "alınan" sorulur; para üstü hesabı
   * kaybolmasın diye. `fisYazdir` F4 ile true, F5 ile false gelir.
   */
  /**
   * F5/F4 → ödeme penceresi (§10.3).
   *
   * Ön kontroller burada yapılır ki kasiyer boş sepetle ya da kapalı kasayla
   * pencereyi açıp orada hata almasın; hatayı bir adım önce görmek daha iyidir.
   */
  const odemeyiAc = useCallback(
    (fisYazdir: boolean) => {
      if (sepet.satirlar.length === 0) {
        bildir.uyari('Sepet boş');
        return;
      }
      if (!kasaAcik) {
        bildir.uyari('Kasa açık değil', 'Satış için önce Kasa ekranından açılış yapın.');
        return;
      }
      if (hesap.genelToplam <= 0) {
        bildir.uyari('Tutar sıfır');
        return;
      }
      setFisYazdirilacak(fisYazdir);
      setOdemeAcik(true);
    },
    [sepet.satirlar.length, kasaAcik, hesap.genelToplam],
  );

  /**
   * Seçili satırın düzenlenebilir alanları arasında gezinir (§10.3).
   *
   * Sıra DOM sırasıdır: miktar → birim fiyat → iskonto. Uçlarda başa/sona
   * sarar, böylece kasiyer kaç kez bastığını saymak zorunda kalmaz.
   * Hiçbiri odakta değilse ilk alana gider.
   */
  const satirAlaniGez = useCallback((yon: 1 | -1) => {
    const anahtar = sepetDurumu.getState().seciliAnahtar;
    if (!anahtar) return;
    const kapsayicilar = Array.from(document.querySelectorAll<HTMLElement>(`[data-sepet-alan="${anahtar}"]`));
    const alanlar = kapsayicilar
      .map((k) => (k instanceof HTMLButtonElement ? k : k.querySelector<HTMLElement>('input, button')))
      .filter((a): a is HTMLElement => a !== null);
    if (alanlar.length === 0) return;

    const suan = alanlar.findIndex((a) => a === document.activeElement);
    const sonraki = suan < 0 ? 0 : (suan + yon + alanlar.length) % alanlar.length;
    alanlar[sonraki]?.focus();
  }, []);

  // -------------------------------------------------------------------------
  // Kısayollar (§10.3)
  // -------------------------------------------------------------------------

  const secili = sepet.satirlar.find((s) => s.anahtar === sepet.seciliAnahtar) ?? null;

  useKisayol(
    [
      // F2 tahsilat: borcunu ödemeye gelen müşteri, kasiyerin en sık
      // karşılaştığı satış-dışı iştir (§10.7). Ürün arama F3'e taşındı.
      { tus: 'F2', calistir: () => setTahsilatAcik(true), aktif: !diyalogAcik },
      { tus: 'F3', calistir: () => setAramaAcik(true), aktif: !diyalogAcik },
      // F1 müşteri seçer; seçili müşteri ödeme penceresini VERESİYE ön seçili açar.
      { tus: 'F1', calistir: () => setMusteriAcik(true), aktif: !diyalogAcik },
      // Ödeme diyaloğu açıkken de müşteri seçtirir (veresiye akışı).
      { tus: 'F1', calistir: () => setMusteriAcik(true), aktif: odemeAcik && !musteriAcik },
      // Tek tuşla satış: F5 fişsiz, F4 fişli. Müşteri seçiliyse veresiye,
      // seçili değilse nakit (alınan tutar küçük bir kutuda sorulur).
      /*
       * F5 ve F4 ÖDEME PENCERESİNİ açar (§10.3).
       *
       * Eskiden F5 doğrudan satışı bitiriyordu: müşteri seçiliyse veresiye,
       * değilse nakit. Bu, kartla ödeyen müşteri için kasiyeri fareye
       * uzanmaya zorluyordu — markette kart en az nakit kadar sık. Ödeme
       * penceresi zaten Enter'la tek tuşta kapanıyor, dolayısıyla nakit yolu
       * da yavaşlamıyor: F5 → Enter iki tuş.
       *
       * Aradaki tek fark fiş: F4 fiş basar, F5 basmaz.
       */
      { tus: 'F5', calistir: () => odemeyiAc(false), aktif: !diyalogAcik },
      { tus: 'F4', calistir: () => odemeyiAc(true), aktif: !diyalogAcik },
      {
        tus: 'F8',
        calistir: () => {
          if (secili) {
            sepetDurumu.getState().sil(secili.anahtar);
            bildir.bilgi(`"${secili.ad}" sepetten çıkarıldı`);
          }
        },
        aktif: !diyalogAcik,
      },
      { tus: 'F10', calistir: () => sepetDurumu.getState().sepetEkle(), aktif: !diyalogAcik },
      { tus: 'F9', calistir: () => setFiyatSorguModu((v) => !v), aktif: !diyalogAcik },
      {
        tus: 'Escape',
        calistir: () => {
          if (oneriler.length > 0) setOneriler([]);
          else if (fiyatSorgu) setFiyatSorgu(null);
          else if (fiyatSorguModu) setFiyatSorguModu(false);
          else if (adetOneki) setAdetOneki(null);
          else if (sepet.satirlar.length > 0) {
            if (window.confirm('Sepetteki tüm satırlar silinsin mi?')) sepetDurumu.getState().temizle();
          }
          odaklan();
        },
        aktif: !diyalogAcik,
      },
      { tus: 'ArrowUp', calistir: () => sepetDurumu.getState().seciliyiKaydir(-1), aktif: !diyalogAcik, alanIcindeDe: true },
      { tus: 'ArrowDown', calistir: () => sepetDurumu.getState().seciliyiKaydir(1), aktif: !diyalogAcik, alanIcindeDe: true },
      // Miktar kısayolları barkod alanı odaktayken de çalışır, AMA yalnız alan
      // boşken: yarım yazılmış bir barkodun içine karakter girmesini engellemeden
      // adet değiştirilebilsin. Shift yok sayılır — `+` çoğu düzende Shift ister.
      // Ok tuşları da kabul edilir; numaratörsüz klavyelerde en güvenilir yol odur.
      {
        tus: '+',
        alanIcindeDe: true,
        shiftYokSay: true,
        calistir: () => secili && sepetDurumu.getState().miktarArtir(secili.anahtar, miktarAdimi(secili.birimTipi)),
        aktif: !diyalogAcik && barkodMetni === '' && Boolean(secili),
      },
      {
        tus: '-',
        alanIcindeDe: true,
        shiftYokSay: true,
        calistir: () => secili && sepetDurumu.getState().miktarArtir(secili.anahtar, -miktarAdimi(secili.birimTipi)),
        aktif: !diyalogAcik && barkodMetni === '' && Boolean(secili),
      },
      /*
       * SAĞ/SOL ok = satır içinde ALAN DEĞİŞTİRİR, miktarı değiştirmez.
       *
       * Eskiden oklar miktarı artırıp azaltıyordu; miktar artık satırda
       * doğrudan yazıldığı için bu hem gereksiz hem tehlikeliydi (alan
       * içindeyken imleci kaydırmak yerine sessizce miktarı bozuyordu).
       * Miktar değiştirme + ve − tuşlarında kaldı.
       */
      {
        tus: 'arrowright',
        alanIcindeDe: true,
        calistir: () => satirAlaniGez(1),
        aktif: !diyalogAcik && barkodMetni === '' && Boolean(secili),
      },
      {
        tus: 'arrowleft',
        alanIcindeDe: true,
        calistir: () => satirAlaniGez(-1),
        aktif: !diyalogAcik && barkodMetni === '' && Boolean(secili),
      },
    ],
    [
      diyalogAcik,
      secili,
      sepet.satirlar.length,
      kasaAcik,
      fiyatSorgu,
      fiyatSorguModu,
      adetOneki,
      odaklan,
      satirAlaniGez,
      barkodMetni,
      oneriler.length,
      odemeyiAc,
      tahsilatAcik,
    ],
  );

  // -------------------------------------------------------------------------
  // Sepet sekmeleri
  // -------------------------------------------------------------------------

  const sepetNumarasi = (ad: string) => Number(ad.replace(/\D+/g, '')) || 0;
  const tumSepetler = [
    {
      ad: sepet.sepetAdi,
      kalem: sepet.satirlar.length,
      toplam: hesap.genelToplam,
      musteri: sepet.musteriAdi,
      aktif: true,
    },
    ...sepet.bekleyenler.map((b) => ({
      ad: b.ad,
      kalem: b.satirlar.length,
      // Bekleyen sepette yaklaşık toplam yeterli (iskonto ödemede yeniden hesaplanır).
      toplam: b.satirlar.reduce((t, s) => t + Math.round((s.miktar * s.birimFiyat) / 1000), 0),
      musteri: b.musteriAdi,
      aktif: false,
    })),
  ].sort((a, b) => sepetNumarasi(a.ad) - sepetNumarasi(b.ad));

  const sepetiKapat = (ad: string, kalemSayisi: number) => {
    if (kalemSayisi > 0 && !window.confirm(`${ad} içindeki ${kalemSayisi} kalem silinsin mi?`)) return;
    sepetDurumu.getState().sepetKapat(ad);
    odaklan();
  };

  // -------------------------------------------------------------------------
  // Görünüm
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      {!kasaAcik && (
        <div className="border-b border-uyari-cizgi bg-uyari-yumusak px-4 py-2 text-sm text-uyari">
          Kasa açık değil. Satış yapabilmek için <strong>Kasa</strong> ekranından açılış yapın.
        </div>
      )}

      {/* Sepet sekmeleri — birden çok müşteriyle aynı anda ilgilenmek için.
          (Eski "askıya alma" diyaloğunun yerini aldı: bekleyen satış artık görünür.)
          Üstte yatay şerit: sepet sayısı azdır ve dikey sütun ekranın en değerli
          yerini, satış listesinin genişliğini yiyordu. */}
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-cizgi bg-yuzey px-4 py-2">
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-metin-4">Sepetler</span>
        {tumSepetler.map((s) => (
          <div key={s.ad} className="group relative shrink-0">
            <button
              type="button"
              onClick={() => sepetDurumu.getState().sepetSec(s.ad)}
              className={`flex items-baseline gap-2 rounded-full border py-1.5 pl-3.5 transition-colors ${
                tumSepetler.length > 1 ? 'pr-8' : 'pr-3.5'
              } ${
                s.aktif
                  ? 'border-vurgu bg-vurgu-yumusak text-vurgu shadow-sm'
                  : 'border-cizgi bg-yuzey-2 text-metin-2 hover:bg-yuzey-4'
              }`}
            >
              <span className="text-sm font-semibold">{s.ad}</span>
              <span className="text-xs text-metin-3">
                {s.kalem === 0 ? 'boş' : `${s.kalem} kalem · ${paraFormat(s.toplam, { simge: false })}`}
              </span>
              {s.musteri && <span className="max-w-[10rem] truncate text-xs text-bilgi">· {s.musteri}</span>}
            </button>
            {tumSepetler.length > 1 && (
              <button
                type="button"
                aria-label={`${s.ad} sepetini kapat`}
                className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-metin-4 opacity-0 transition-opacity hover:bg-tehlike-yumusak hover:text-tehlike group-hover:opacity-100"
                onClick={() => sepetiKapat(s.ad, s.kalem)}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="shrink-0 rounded-full border border-dashed border-cizgi-kuvvetli px-3.5 py-1.5 text-sm text-metin-3 transition-colors hover:border-vurgu hover:text-vurgu"
          onClick={() => sepetDurumu.getState().sepetEkle()}
        >
          + Sepet <Kisayol>F10</Kisayol>
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Sol: barkod girişi + sepet */}
        <section className="flex min-w-0 flex-1 flex-col p-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="relative flex-1">
              <input
                ref={barkodAlani}
                type="text"
                className="alan py-3 text-lg"
                placeholder={fiyatSorguModu ? 'FİYAT SORGULAMA — barkod okutun' : 'Barkod okutun ya da ürün adı yazın…'}
                value={barkodMetni}
                onChange={(e) => setBarkodMetni(e.target.value)}
                onKeyDown={(e) => {
                  // Öneri listesi açıkken ok tuşları/Enter/ESC listeyi yönetir;
                  // stopPropagation ile satırdaki genel kısayollara karışmaz.
                  if (oneriAcik) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      e.stopPropagation();
                      setOneriIndeks((i) => Math.min(i + 1, oneriler.length - 1));
                      return;
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      e.stopPropagation();
                      setOneriIndeks((i) => Math.max(i - 1, 0));
                      return;
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      setOneriler([]);
                      return;
                    }
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      const secilen = oneriler[oneriIndeks];
                      if (secilen) oneriyiEkle(secilen);
                      return;
                    }
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    barkodGonder();
                  }
                }}
                aria-label="Barkod girişi"
                autoComplete="off"
                spellCheck={false}
              />
              {adetOneki && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded bg-vurgu px-2 py-1 text-sm font-bold text-vurgu-uzeri">
                  {adetOneki} ×
                </span>
              )}

              {oneriAcik && (
                <ul
                  className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-md border border-cizgi-kuvvetli bg-yuzey shadow-xl"
                  role="listbox"
                  aria-label="Ürün önerileri"
                >
                  {oneriler.map((u, i) => (
                    <li key={u.id} role="option" aria-selected={i === oneriIndeks}>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                          i === oneriIndeks ? 'bg-vurgu-yumusak' : 'hover:bg-yuzey-2'
                        }`}
                        onMouseEnter={() => setOneriIndeks(i)}
                        onClick={() => oneriyiEkle(u)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{u.ad}</span>
                          <span className="block truncate text-xs text-metin-4">
                            {[u.marka, u.barkodlar[0] ?? 'barkodsuz'].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <span className={`whitespace-nowrap text-xs ${u.stok <= 0 ? 'text-tehlike' : 'text-metin-3'}`}>
                          {miktarFormat(u.stok, u.birim_tipi)}
                        </span>
                        <span className="whitespace-nowrap font-mono font-semibold">{paraFormat(u.satis_fiyati)}</span>
                      </button>
                    </li>
                  ))}
                  <li className="border-t border-cizgi-ince px-3 py-1.5 text-center text-[11px] text-metin-4">
                    <Kisayol>↑↓</Kisayol> seç · <Kisayol>Enter</Kisayol> sepete ekle · <Kisayol>F3</Kisayol> detaylı arama
                  </li>
                </ul>
              )}
            </div>
            <button type="button" className="tus-ikincil" onClick={() => setAramaAcik(true)}>
              Ara <Kisayol>F3</Kisayol>
            </button>
            {/* İade artık kenar menüsünde değil: buradan Iade sayfasına gidilir (madde 3 taşıması). */}
            {iadeYetkisiVar && (
              <button type="button" className="tus-ikincil" onClick={() => gezin('/iade')}>
                İade
              </button>
            )}
          </div>

          {/*
            Seçili müşteri, barkod alanının hemen altında durur.
            Veresiye yazılacak kişi kasiyerin bakış hattında olmalıdır: yanlış
            hesaba borç yazmak, satış bittikten sonra düzeltilmesi en zahmetli
            hatalardan biridir.
          */}
          {sepet.musteriId && (
            <div className="mb-3 flex items-center justify-between rounded border border-bilgi-cizgi bg-bilgi-yumusak px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-xs text-metin-3">Seçili müşteri — veresiye bu hesaba yazılır</p>
                <p className="truncate text-lg font-semibold text-bilgi">{sepet.musteriAdi}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" className="tus-ikincil" onClick={() => setMusteriAcik(true)}>
                  Değiştir <Kisayol>F1</Kisayol>
                </button>
                <button
                  type="button"
                  className="tus-ikincil"
                  onClick={() => sepetDurumu.getState().musteriSec(null, null)}
                  title="Müşteri seçimini kaldır"
                >
                  Kaldır
                </button>
              </div>
            </div>
          )}

          {fiyatSorguModu && (
            <div className="mb-3 rounded border border-bilgi-cizgi bg-bilgi-yumusak px-3 py-2 text-sm text-bilgi">
              Fiyat sorgulama modu açık — okutulan ürün sepete eklenmez. Kapatmak için <Kisayol>F9</Kisayol>.
            </div>
          )}

          {fiyatSorgu && (
            <div className="mb-3 flex items-center justify-between rounded border border-bilgi-cizgi bg-bilgi-yumusak px-4 py-3">
              <div>
                <p className="font-medium">{fiyatSorgu.ad}</p>
                <p className="text-xs text-metin-3">Stok: {miktarFormat(fiyatSorgu.stok, fiyatSorgu.birim)}</p>
              </div>
              <p className="font-mono text-2xl font-bold text-vurgu">{paraFormat(fiyatSorgu.fiyat)}</p>
            </div>
          )}

          <div className="kart min-h-0 flex-1 overflow-auto">
            {sepet.satirlar.length === 0 ? (
              <BosDurum baslik="Sepet boş" aciklama="Barkod okutarak ya da F3 ile ürün arayarak satışa başlayın." />
            ) : (
              <table className="tablo">
                <thead className="sticky top-0 bg-yuzey">
                  <tr>
                    <th className="w-10 text-center">#</th>
                    <th className="text-left">Ürün</th>
                    <th className="w-40 text-center">Miktar</th>
                    <th className="w-28 text-center">Birim Fiyat</th>
                    <th className="w-24 text-center">İskonto</th>
                    <th className="w-32 text-center">Tutar</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {sepet.satirlar.map((satir, i) => {
                    const satirHesap = hesap.satirlar[i];
                    const seciliMi = satir.anahtar === sepet.seciliAnahtar;
                    return (
                      <tr
                        key={satir.anahtar}
                        onClick={() => sepetDurumu.getState().sec(satir.anahtar)}
                        className={`cursor-pointer ${seciliMi ? 'bg-yuzey-4/60 outline outline-1 outline-vurgu' : ''}`}
                      >
                        <td className="text-center text-metin-4">{i + 1}</td>
                        <td className="text-left">
                          <div className="font-medium">{satir.ad}</div>
                          <div className="text-xs text-metin-4">
                            {satir.barkod}
                            {satir.kampanyaId && <span className="ml-2 text-vurgu">Kampanyalı</span>}
                            {satir.miktar > satir.stok && (
                              <span className="ml-2 text-uyari">stok {miktarFormat(satir.stok, satir.birimTipi)}</span>
                            )}
                          </div>
                        </td>
                        {/* Miktar: dokunmatik ve fare için görünür +/- düğmeleri.
                            Klavyede aynı işi +/- ve ← → yapar (satır seçiliyken). */}
                        {/*
                          Miktar SATIRDA doğrudan düzenlenir.
                          Eskiden salt okunur bir yazıydı; KG ürünün miktarını
                          değiştirmek için satırı seçip aşağıdaki panele inmek
                          ya da satırı silip yeniden okutmak gerekiyordu.
                          Şarküteri/manavda miktar düzeltmek istisna değil,
                          normal akıştır.
                        */}
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              className="h-7 w-7 shrink-0 rounded border border-cizgi-kuvvetli bg-yuzey-2 text-lg leading-none hover:bg-yuzey-4"
                              aria-label={`${satir.ad} miktarını azalt`}
                              onClick={() => sepetDurumu.getState().miktarArtir(satir.anahtar, -miktarAdimi(satir.birimTipi))}
                            >
                              −
                            </button>
                            <span data-sepet-alan={satir.anahtar}>
                              <MiktarAlani
                                deger={satir.miktar}
                                birim={satir.birimTipi}
                                sinif="w-24 py-1 text-center"
                                onDegisim={(m) => sepetDurumu.getState().miktarAyarla(satir.anahtar, m)}
                                // Odaklanan alan hangi satırdaysa SEÇİLİ SATIR odur.
                                onOdak={() => sepetDurumu.getState().sec(satir.anahtar)}
                                // Enter: düzenleme bitti, imleç barkod kutusuna dönsün.
                                onEnter={odaklan}
                              />
                            </span>
                            <button
                              type="button"
                              className="h-7 w-7 shrink-0 rounded border border-cizgi-kuvvetli bg-yuzey-2 text-lg leading-none hover:bg-yuzey-4"
                              aria-label={`${satir.ad} miktarını artır`}
                              onClick={() => sepetDurumu.getState().miktarArtir(satir.anahtar, miktarAdimi(satir.birimTipi))}
                            >
                              +
                            </button>
                          </div>
                        </td>
                        {/* Birim fiyat da satırda düzenlenir: açık ürün ve pazarlıkta
                            fiyat düzeltmek istisna değil, normal akıştır. */}
                        <td onClick={(e) => e.stopPropagation()}>
                          {satir.kampanyaId && satir.listeFiyati !== satir.birimFiyat && (
                            <div className="text-center text-xs text-metin-4 line-through">
                              {paraFormat(satir.listeFiyati, { simge: false })}
                            </div>
                          )}
                          <span data-sepet-alan={satir.anahtar}>
                            <ParaAlani
                              deger={satir.birimFiyat}
                              sinif="w-full py-1 text-center"
                              onDegisim={(f) => sepetDurumu.getState().fiyatAyarla(satir.anahtar, f)}
                              onOdak={() => sepetDurumu.getState().sec(satir.anahtar)}
                              onEnter={odaklan}
                            />
                          </span>
                        </td>
                        <td className="text-center">
                          {/* İskonto hücresi tıklanabilir: rakamın kendisi düğmedir. */}
                          <button
                            type="button"
                            data-sepet-alan={satir.anahtar}
                            className={`w-full rounded px-1 py-1 text-sm hover:bg-yuzey-4 ${
                              satirHesap && satirHesap.iskonto > 0 ? 'font-semibold text-uyari' : 'text-metin-4'
                            }`}
                            title="İskonto uygula (Enter ile aç)"
                            onFocus={() => sepetDurumu.getState().sec(satir.anahtar)}
                            onClick={(e) => {
                              e.stopPropagation();
                              sepetDurumu.getState().sec(satir.anahtar);
                              setIskontoAcik(true);
                            }}
                          >
                            {satirHesap && satirHesap.iskonto > 0 ? '-' + paraFormat(satirHesap.iskonto, { simge: false }) : '—'}
                          </button>
                        </td>
                        <td className="sayi font-semibold">{paraFormat(satirHesap?.satirToplam ?? 0, { simge: false })}</td>
                        <td className="text-center">
                          <button
                            type="button"
                            className="rounded px-1.5 py-1 text-tehlike hover:bg-tehlike-yumusak"
                            aria-label={`${satir.ad} satırını sil`}
                            title="Satırı sil (F8)"
                            onClick={(e) => {
                              e.stopPropagation();
                              sepetDurumu.getState().sil(satir.anahtar);
                              odaklan();
                            }}
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

          {/*
            "Seçili satır" paneli KALDIRILDI (§10.3).

            Miktar, birim fiyat, iskonto ve silme artık satırın kendi üstünde.
            Aynı işi iki yerde yapmak hem ekranın dikey alanını yiyordu hem de
            kasiyeri "önce satırı seç, sonra aşağı in" adımına zorluyordu.
          */}
          {/* Toplamlar + ödeme (§10.9): eskiden sağ sütundu. Sağ taraf hızlı
              ürün ızgarasına ayrıldığı için sepetin hemen altına indi — kasiyer
              tutarı ve eklediği kalemi aynı sütunda, göz hizasında görür. */}
          <div className="mt-3 border-t border-cizgi pt-3">
            <div className="flex items-start gap-4">
              <div className="w-48 shrink-0 space-y-1">
                <TutarSatiri etiket="Ara toplam" tutar={hesap.araToplam} />
                {hesap.iskontoToplam > 0 && <TutarSatiri etiket="İskonto" tutar={-hesap.iskontoToplam} />}
                {hesap.kdvDagilimi.map((dilim) => (
                  <div key={dilim.oran} className="flex justify-between text-xs text-metin-4">
                    <span>KDV %{dilim.oran}</span>
                    <span className="sayi">{paraFormat(dilim.kdv, { simge: false })}</span>
                  </div>
                ))}
              </div>

              <div className="min-w-0 flex-1 text-right">
                <p className="text-sm text-metin-3">GENEL TOPLAM</p>
                <p className="font-mono text-tutar leading-none text-vurgu">{paraFormat(hesap.genelToplam)}</p>
                <p className="mt-1 text-xs text-metin-4">
                  {sepet.satirlar.length} kalem ·{' '}
                  {miktarFormat(
                    sepet.satirlar.reduce((t, s) => t + s.miktar, 0),
                    undefined,
                    false,
                  )}{' '}
                  adet
                </p>
                {sepet.musteriId && (
                  <div className="mt-1 flex justify-end">
                    <Rozet tur="bilgi">Veresiye: {sepet.musteriAdi}</Rozet>
                  </div>
                )}
              </div>
            </div>

            {/* Müşteri (F1) ve Yeni Sepet (F10) düğmeleri KALDIRILDI: ikisi de
                kısayolla erişiliyor ve ödeme satırında yer kaplıyordu. Seçili
                müşteri bilgisi yukarıdaki toplam bloğunda görünmeye devam ediyor. */}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="tus-ikincil text-sm"
                onClick={() => sepetDurumu.getState().temizle()}
                disabled={sepet.satirlar.length === 0}
              >
                Temizle <Kisayol>ESC</Kisayol>
              </button>
              <button
                type="button"
                className="tus-birincil shrink-0 px-8 py-3 text-lg"
                disabled={sepet.satirlar.length === 0 || islemde || !kasaAcik}
                onClick={() => setOdemeAcik(true)}
              >
                ÖDEME
              </button>
            </div>
          </div>
        </section>

        {/* Sağ: hızlı ürün ızgarası — barkodsuz ürünler için kare kutucuklar. */}
        {/* Ekledikten sonra imleç BARKOD kutusuna döner: kasiyerin bir sonraki
            hamlesi neredeyse her zaman yeni bir ürün okutmaktır. Miktara
            odaklanmak, ardından gelen barkodun miktar alanına yazılmasına
            yol açıyordu (§10.3). */}
        <HizliUrunIzgarasi adetOneki={adetOneki} onCarpanTuketildi={() => setAdetOneki(null)} onSepeteEklendi={odaklan} />
      </div>

      {/*
        Kısayol çubuğu F TUŞU SIRASIYLA dizilir (F1 → F10); tuşların görevi
        değişmez, yalnız okuma sırası. Karışık sırada kasiyer aradığı tuşu
        çubukta tarıyordu. Gezinme tuşları ayraçtan sonra gelir.
      */}
      <footer className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-cizgi bg-yuzey-3/80 px-4 py-2.5 text-sm text-metin-3">
        <span>
          <Kisayol>F1</Kisayol> müşteri
        </span>
        <span>
          <Kisayol>F2</Kisayol> tahsilat
        </span>
        <span>
          <Kisayol>F3</Kisayol> ara
        </span>
        <span className="font-medium text-metin-2">
          <Kisayol>F4</Kisayol> ödeme + fiş
        </span>
        <span className="font-medium text-metin-2">
          <Kisayol>F5</Kisayol> ödeme
        </span>
        <span>
          <Kisayol>F8</Kisayol> satır sil
        </span>
        <span>
          <Kisayol>F9</Kisayol> fiyat sor
        </span>
        <span>
          <Kisayol>F10</Kisayol> yeni sepet
        </span>
        <span aria-hidden="true" className="text-cizgi-kuvvetli">
          |
        </span>
        <span>
          <Kisayol>Enter</Kisayol> ekle
        </span>
        <span>
          <Kisayol>←→</Kisayol> alan
        </span>
        <span>
          <Kisayol>↑↓</Kisayol> satır seç
        </span>
        <span>
          <Kisayol>+/−</Kisayol> adet
        </span>
        <span>
          <Kisayol>ESC</Kisayol> iptal
        </span>
      </footer>

      <OdemeDiyalogu
        acik={odemeAcik}
        genelToplam={hesap.genelToplam}
        musteriId={sepet.musteriId}
        musteriAdi={sepet.musteriAdi}
        islemde={islemde}
        stokAsimi={sepet.satirlar
          .filter((s) => s.miktar > s.stok)
          .map((s) => ({
            ad: s.ad,
            istenen: miktarFormat(s.miktar, s.birimTipi),
            mevcut: miktarFormat(s.stok, s.birimTipi),
          }))}
        onKapat={() => {
          setOdemeAcik(false);
          odaklan();
        }}
        // Müşteri penceresi ödeme diyaloğunun ÜSTÜNE açılır; ödeme kapanmaz,
        // seçim bitince kasiyer kaldığı yerden devam eder.
        baslangicTipi={odemeBaslangicTipi}
        onMusteriSec={() => setMusteriAcik(true)}
        onTamamla={(odemeler, onaylar) => satisiTamamla(odemeler, onaylar, fisYazdirilacak)}
      />

      <BorcluSecTahsilat
        acik={tahsilatAcik}
        onKapat={() => {
          setTahsilatAcik(false);
          odaklan();
        }}
      />

      <UrunAramaDiyalogu
        acik={aramaAcik}
        baslangicTerimi={aramaTerimi}
        onKapat={() => {
          setAramaAcik(false);
          setAramaTerimi('');
          odaklan();
        }}
        onSec={(urun, miktar) => {
          setAramaAcik(false);
          setAramaTerimi('');
          // KG/LT üründe miktar girilmediyse sepeteAl tartım diyaloğunu açar.
          sepeteAl(urun, miktar);
          odaklan();
        }}
      />

      <MusteriSecDiyalogu
        acik={musteriAcik}
        onKapat={() => {
          setMusteriAcik(false);
          odaklan();
        }}
        onSec={(id, ad) => {
          sepetDurumu.getState().musteriSec(id, ad);
          setMusteriAcik(false);
          odaklan();
        }}
      />

      <IskontoDiyalogu
        acik={iskontoAcik}
        satir={secili}
        onKapat={() => {
          setIskontoAcik(false);
          odaklan();
        }}
      />

      <TartimDiyalogu
        urun={tartilan}
        onKapat={() => {
          setTartilan(null);
          odaklan();
        }}
        onEkle={(miktar) => {
          if (tartilan) urunuEkle(tartilan, miktar);
          setTartilan(null);
          odaklan();
        }}
      />
    </div>
  );
}
