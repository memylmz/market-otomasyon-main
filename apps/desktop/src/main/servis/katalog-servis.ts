/**
 * Katalog servisi — ürün kartı, barkod, toplu fiyat, içe/dışa aktarma (§10.5, §12.2).
 */

import {
  barkodNormalize,
  eanGecerliMi,
  hatalar,
  HATA_KODU,
  icBarkodUret,
  kampanyaFiyatiBul,
  kdvAyir,
  marjdanFiyat,
  paraParse,
  miktarParse,
  simdi,
  tartiliBarkodCoz,
  UygulamaHatasi,
  uuid,
  yuzdeUygula,
  zUrunGirdi,
  AYAR,
  type Miktar,
  VARSAYILAN_KDV_ORANI,
  type Kurus,
} from '@market/shared';
import {
  barkodEkle,
  barkodKaldir,
  tartiliUrunOnekiIleBul,
  barkodSahibi,
  barkodlariDoldur,
  etkinKampanyalar,
  kategorileriListele,
  kategoriKaydet,
  urunAra,
  urunBul,
  urunleriBul,
  urunKaydet,
  urunPasiflestir,
  urunleriListele,
  urununBarkodlari,
  barkodlaBul as barkodlaBulDepo,
  type UrunFiltresi,
  type UrunGorunumu,
} from '../depo/katalog.js';
import { ayarMetin, ayarYaz } from '../depo/ayar.js';
import { stokOlayiYaz } from './stok-servis.js';
import { sonrakiSayac } from '../depo/ortak.js';
import { denetimYaz } from '../depo/ozet.js';
import { olayYaz } from '../depo/senkron.js';
import { hareketEkle, stokOku } from '../depo/stok.js';
import { ayarlariOku, yetkiIste, type Aktor, type Baglam } from './baglam.js';

// ---------------------------------------------------------------------------
// Okuma (satış ekranı için hızlı yollar)
// ---------------------------------------------------------------------------

export interface BarkodSonucu {
  bulundu: boolean;
  urun?: UrunGorunumu;
  /** Kampanya uygulanmış güncel satış fiyatı. */
  fiyat?: Kurus;
  kampanyaId?: string | null;
  uyari?: string;
  /**
   * Terazi barkodundan çıkan miktar. Doluysa satış ekranı miktarı SORMAZ;
   * tartım zaten yapılmıştır, kasiyere tekrar sormak hem yavaşlatır hem
   * yanlış girme ihtimali doğurur.
   */
  miktar?: Miktar;
}

/** Barkod okutuldu — satış ekranının çağırdığı sıcak yol (§3.1 ≤100 ms). */
/**
 * Kullanılmamış en küçük kısa kodu önerir (§10.1).
 *
 * Kod dağıtımını operatöre bırakmak pratikte "hangi numarayı vermiştim"
 * sorununa dönüşür ve kimse kod atamaz. 10'dan başlar (tek hane kazara
 * okutmaya çok açıktır), 99'dan sonra üç haneye geçer.
 */
export function kisaKodOner(baglam: Baglam): string {
  const alinmis = new Set(
    baglam.vt
      .hazirla("SELECT barkod FROM barkodlar WHERE LENGTH(barkod) <= 5 AND barkod GLOB '[0-9]*'")
      .tumu<{ barkod: string }>()
      .map((r) => r.barkod),
  );
  for (let n = 10; n <= 99999; n++) {
    const aday = String(n);
    if (!alinmis.has(aday)) return aday;
  }
  throw hatalar.dogrulama('Boş kısa kod kalmadı.');
}

export function barkodOku(baglam: Baglam, hamBarkod: string): BarkodSonucu {
  const barkod = barkodNormalize(hamBarkod);
  if (!barkod) return { bulundu: false };

  const kayit = barkodlaBulDepo(baglam.vt, barkod) ?? undefined;
  if (!kayit) return teraziBarkoduDene(baglam, barkod);

  if (!kayit.aktif_mi) {
    return { bulundu: true, urun: kayit, uyari: `"${kayit.ad}" pasif durumda, satışa kapalı.` };
  }
  if (!kayit.barkod_aktif) {
    return { bulundu: true, urun: kayit, uyari: 'Bu barkod kaldırılmış.' };
  }

  const zaman = simdi();
  const kampanyalar = etkinKampanyalar(baglam.vt, zaman);
  const { fiyat, kampanyaId } = kampanyaFiyati(kayit, kampanyalar, zaman);
  return { bulundu: true, urun: kayit, fiyat, kampanyaId };
}

/**
 * Tam eşleşme bulunamadığında terazi barkodu olarak dener (§10.1).
 *
 * Bu yol yalnız TAM EŞLEŞME BAŞARISIZ olduğunda çalışır: gerçek bir ürün
 * barkodu 27/28 ile başlıyorsa (mağaza içi aralık teoride serbesttir) onun
 * kaydı kazanır, terazi yorumu devreye girmez.
 */
function teraziBarkoduDene(baglam: Baglam, barkod: string): BarkodSonucu {
  const cozum = tartiliBarkodCoz(barkod, {
    agirlikOnekleri: onekListesi(baglam, AYAR.TARTI_AGIRLIK_ONEK, '28'),
    tutarOnekleri: onekListesi(baglam, AYAR.TARTI_TUTAR_ONEK, '27'),
  });
  if (!cozum) return { bulundu: false };

  const urun = tartiliUrunOnekiIleBul(baglam.vt, cozum.urunOneki);
  if (!urun) {
    return {
      bulundu: false,
      uyari: `Terazi barkodu okundu (ürün kodu ${cozum.urunOneki.slice(2)}) ama bu koda bağlı ürün yok. Ürün kartına bu etiketi bir kez tanıtın.`,
    };
  }

  const zaman = simdi();
  const kampanyalar = etkinKampanyalar(baglam.vt, zaman);
  const { fiyat, kampanyaId } = kampanyaFiyati(urun, kampanyalar, zaman);

  if (cozum.tip === 'AGIRLIK') {
    // Gram doğrudan bindebir'dir: 1 g = 0,001 kg.
    return { bulundu: true, urun, fiyat, kampanyaId, miktar: cozum.deger as Miktar };
  }

  // TUTAR: barkoddaki tutar ile birim fiyattan miktar geri hesaplanır.
  if (fiyat <= 0) {
    return { bulundu: true, urun, fiyat, kampanyaId, uyari: 'Ürünün birim fiyatı tanımsız; miktar hesaplanamadı.' };
  }
  const miktar = Math.round((cozum.deger / fiyat) * 1000);
  return { bulundu: true, urun, fiyat, kampanyaId, miktar: miktar as Miktar };
}

/** Virgülle ayrılmış ön ek ayarını listeye çevirir. */
function onekListesi(baglam: Baglam, anahtar: string, varsayilan: string): string[] {
  return (ayarMetin(baglam.vt, anahtar, varsayilan) || varsayilan)
    .split(',')
    .map((p) => p.trim())
    .filter((p) => /^\d{2}$/.test(p));
}

function kampanyaFiyati(
  urun: UrunGorunumu,
  kampanyalar: ReturnType<typeof etkinKampanyalar>,
  zaman: string,
): { fiyat: Kurus; kampanyaId: string | null } {
  // Paylaşılan saf fonksiyonu kullanabilmek için kampanya kayıtlarını dönüştür.
  return kampanyaFiyatiBul(
    urun.satis_fiyati,
    { urunId: urun.id, kategoriId: urun.kategori_id },
    kampanyalar.map((k) => ({
      id: k.id,
      tip: k.tip,
      kapsam: k.kapsam,
      hedefId: k.hedef_id,
      deger: k.deger,
      baslangic: k.baslangic,
      bitis: k.bitis,
      aktifMi: k.aktif_mi,
      oncelik: k.oncelik,
    })),
    zaman,
  );
}

export function urunArama(baglam: Baglam, terim: string, limit = 30): UrunGorunumu[] {
  const sonuclar = urunAra(baglam.vt, terim, limit);
  barkodlariDoldur(baglam.vt, sonuclar);
  return sonuclar;
}

export function urunListesi(baglam: Baglam, filtre: UrunFiltresi, sayfa?: { limit?: number; ofset?: number }) {
  const sonuc = urunleriListele(baglam.vt, filtre, sayfa);
  barkodlariDoldur(baglam.vt, sonuc.kayitlar);
  return sonuc;
}

export function urunDetayi(baglam: Baglam, urunId: string) {
  const urun = urunBul(baglam.vt, urunId);
  if (!urun) throw hatalar.bulunamadi('Ürün');
  return { urun, barkodlar: urununBarkodlari(baglam.vt, urunId), stok: stokOku(baglam.vt, urunId) };
}

// ---------------------------------------------------------------------------
// Yazma
// ---------------------------------------------------------------------------

export function urunuKaydet(baglam: Baglam, aktor: Aktor, hamGirdi: unknown): string {
  const ayrisim = zUrunGirdi.safeParse(hamGirdi);
  if (!ayrisim.success) {
    throw hatalar.dogrulama('Ürün bilgileri geçerli değil.', { sorunlar: ayrisim.error.issues.map((i) => i.message) });
  }
  const girdi = ayrisim.data;
  const urunId = (hamGirdi as { id?: string }).id;

  yetkiIste(aktor, 'urun.duzenle');
  const { vt, cihazId } = baglam;
  const zaman = simdi();
  const oncesi = urunId ? urunBul(vt, urunId) : null;

  if (oncesi && oncesi.satis_fiyati !== girdi.satis_fiyati) {
    yetkiIste(aktor, 'urun.fiyat_degistir', 'satış fiyatı değişikliği');
  }

  let id = '';
  vt.islem(() => {
    id = urunKaydet(vt, { ...girdi, id: urunId }, cihazId, zaman);

    for (const barkodGirdi of girdi.barkodlar) {
      const barkod = barkodNormalize(barkodGirdi.barkod);
      const sahip = barkodSahibi(vt, barkod);
      if (sahip && sahip !== id) {
        const sahipUrun = urunBul(vt, sahip);
        throw new UygulamaHatasi(
          HATA_KODU.BARKOD_KULLANIMDA,
          `"${barkod}" barkodu "${sahipUrun?.ad ?? sahip}" ürününde kayıtlı.`,
          {
            detay: { barkod, mevcut_urun_id: sahip },
          },
        );
      }
      const barkodId = barkodEkle(vt, id, barkod, barkodGirdi.ambalaj_aciklamasi ?? null, cihazId, zaman);
      olayYaz(
        vt,
        {
          id: uuid(),
          olay_tipi: 'BARKOD_KAYDEDILDI',
          entity: 'barkod',
          entity_id: barkodId,
          veri: {
            id: barkodId,
            urun_id: id,
            barkod,
            ambalaj_aciklamasi: barkodGirdi.ambalaj_aciklamasi ?? null,
            aktif_mi: true,
            created_at: zaman,
            updated_at: zaman,
          },
          olusturma_zamani: zaman,
        },
        cihazId,
        zaman,
      );
    }

    // Açılış stoğu yalnız yeni üründe ve bir kez uygulanır.
    if (!oncesi && girdi.acilis_stogu && girdi.acilis_stogu > 0) {
      const acilisHareketId = hareketEkle(
        vt,
        {
          urun_id: id,
          hareket_tipi: 'ACILIS',
          miktar: girdi.acilis_stogu,
          birim_maliyet: girdi.alis_fiyati ?? 0,
          belge_tipi: 'ACILIS',
          aciklama: 'Açılış stoğu',
          kullanici_id: aktor.kullaniciId,
        },
        cihazId,
        zaman,
      );
      // Olay ŞART: hareket yalnız yerelde kalırsa merkezdeki stok özeti açılış
      // miktarını hiç görmez ve panel ile kasa ilk günden ayrışır (§7.3).
      stokOlayiYaz(baglam, acilisHareketId, id, 'ACILIS', girdi.acilis_stogu, aktor, zaman);
    }

    const kayit = urunBul(vt, id);
    olayYaz(
      vt,
      { id: uuid(), olay_tipi: 'URUN_KAYDEDILDI', entity: 'urun', entity_id: id, veri: kayit ?? { id }, olusturma_zamani: zaman },
      cihazId,
      zaman,
    );
    denetimYaz(
      vt,
      {
        kullanici_id: aktor.kullaniciId,
        islem: oncesi ? 'URUN_GUNCELLE' : 'URUN_EKLE',
        entity: 'urun',
        entity_id: id,
        eski_deger: oncesi ? { ad: oncesi.ad, satis_fiyati: oncesi.satis_fiyati, alis_fiyati: oncesi.alis_fiyati } : undefined,
        yeni_deger: { ad: girdi.ad, satis_fiyati: girdi.satis_fiyati, alis_fiyati: girdi.alis_fiyati },
      },
      cihazId,
      zaman,
    );
  });

  return id;
}

export function urunuPasiflestir(baglam: Baglam, aktor: Aktor, urunId: string, pasif: boolean): void {
  yetkiIste(aktor, 'urun.pasiflestir');
  const { vt, cihazId } = baglam;
  const zaman = simdi();
  vt.islem(() => {
    urunPasiflestir(vt, urunId, pasif, cihazId, zaman);
    const kayit = urunBul(vt, urunId);
    olayYaz(
      vt,
      {
        id: uuid(),
        olay_tipi: 'URUN_KAYDEDILDI',
        entity: 'urun',
        entity_id: urunId,
        veri: kayit ?? { id: urunId },
        olusturma_zamani: zaman,
      },
      cihazId,
      zaman,
    );
    denetimYaz(
      vt,
      {
        kullanici_id: aktor.kullaniciId,
        islem: pasif ? 'URUN_PASIFLESTIR' : 'URUN_AKTIFLESTIR',
        entity: 'urun',
        entity_id: urunId,
      },
      cihazId,
      zaman,
    );
  });
}

export function barkoduKaldir(baglam: Baglam, aktor: Aktor, barkod: string): void {
  yetkiIste(aktor, 'urun.duzenle');
  const { vt, cihazId } = baglam;
  const zaman = simdi();
  vt.islem(() => {
    barkodKaldir(vt, barkod, cihazId, zaman);
    denetimYaz(
      vt,
      { kullanici_id: aktor.kullaniciId, islem: 'BARKOD_KALDIR', entity: 'barkod', entity_id: barkod },
      cihazId,
      zaman,
    );
  });
}

/** Barkodsuz ürün için mağaza içi EAN-13 üretir ve kaydeder (§10.5, §13.1). */
export function icBarkodOlustur(baglam: Baglam, aktor: Aktor, urunId: string): string {
  yetkiIste(aktor, 'urun.duzenle');
  const { vt, cihazId } = baglam;
  const ayarlar = ayarlariOku(baglam);
  const zaman = simdi();

  let barkod = '';
  vt.islem(() => {
    // Çakışma ihtimaline karşı boş bir numara bulunana kadar sayaç ilerletilir.
    for (let deneme = 0; deneme < 50; deneme++) {
      const aday = icBarkodUret(sonrakiSayac(vt, 'ic_barkod'), ayarlar.icBarkodOneki);
      if (!barkodSahibi(vt, aday)) {
        barkod = aday;
        break;
      }
    }
    if (!barkod) throw new Error('Boş iç barkod numarası bulunamadı');

    const barkodId = barkodEkle(vt, urunId, barkod, 'İç barkod', cihazId, zaman);
    olayYaz(
      vt,
      {
        id: uuid(),
        olay_tipi: 'BARKOD_KAYDEDILDI',
        entity: 'barkod',
        entity_id: barkodId,
        veri: {
          id: barkodId,
          urun_id: urunId,
          barkod,
          ambalaj_aciklamasi: 'İç barkod',
          aktif_mi: true,
          created_at: zaman,
          updated_at: zaman,
        },
        olusturma_zamani: zaman,
      },
      cihazId,
      zaman,
    );
  });
  return barkod;
}

// ---------------------------------------------------------------------------
// Toplu işlemler (§10.5)
// ---------------------------------------------------------------------------

export type TopluIslemTipi = 'YUZDE_ZAM' | 'YUZDE_INDIRIM' | 'KDV_DEGISTIR' | 'MARJ_UYGULA';

export interface TopluIslemGirdisi {
  tip: TopluIslemTipi;
  deger: number;
  filtre: UrunFiltresi;
  /**
   * Yüzde zam/indirimin uygulanacağı fiyat. Varsayılan SATIS.
   * ALIS: yalnız alış (maliyet) fiyatı değişir, satış fiyatına dokunulmaz —
   * tedarikçi toptan zam yaptığında maliyetler güncellenir, raf fiyatı ayrı
   * bir kararla değiştirilir. MARJ_UYGULA ve KDV_DEGISTIR için yok sayılır.
   */
  hedef?: 'SATIS' | 'ALIS';
  /**
   * Verilirse yalnız bu ürünlere uygulanır ve `filtre` yok sayılır.
   * Kullanıcının listeden tek tek işaretlediği ürünlere zam yapmasını sağlar —
   * "sadece şu üç ürüne zam" en sık istenen senaryodur ve filtreyle ifade edilemez.
   */
  urunIdler?: string[];
  /** Fiyatları en yakın kuruşa değil, .90 / .95 gibi psikolojik uca yuvarla. */
  yuvarlamaKurus?: number;
}

export interface TopluIslemSonucu {
  etkilenen: number;
  ornekler: { ad: string; eski: Kurus; yeni: Kurus }[];
  /**
   * SATIŞ fiyatı gerçekten değişen ürünler — raf etiketi basmak için (§13.3).
   *
   * Yalnız satış fiyatı değişenler girer: alış fiyatına ya da KDV oranına
   * dokunmak rafta yazan rakamı değiştirmez, o ürünlerin etiketini yeniden
   * basmak boşa kağıt harcar.
   */
  etiketAdaylari: { id: string; ad: string }[];
}

export function topluFiyatIslemi(baglam: Baglam, aktor: Aktor, girdi: TopluIslemGirdisi, uygula: boolean): TopluIslemSonucu {
  yetkiIste(aktor, 'urun.toplu_islem');
  const { vt, cihazId } = baglam;
  const zaman = simdi();

  // Seçili ürünler verildiyse filtre yok sayılır; kullanıcının işaretlediği
  // liste her zaman kesin ifadedir.
  const kayitlar =
    girdi.urunIdler && girdi.urunIdler.length > 0
      ? [...urunleriBul(vt, girdi.urunIdler).values()].map((u) => ({ ...u, stok: 0, kategori_adi: null, barkodlar: [] }))
      : urunleriListele(vt, girdi.filtre, { limit: 500, ofset: 0 }).kayitlar;

  const ornekler: { ad: string; eski: Kurus; yeni: Kurus }[] = [];
  const etiketAdaylari: { id: string; ad: string }[] = [];
  let etkilenen = 0;

  // Yüzde zam/indirim maliyete (alış) de uygulanabilir; diğer işlemler satışa özeldir.
  const alisaUygula = girdi.hedef === 'ALIS' && (girdi.tip === 'YUZDE_ZAM' || girdi.tip === 'YUZDE_INDIRIM');

  const islem = () => {
    for (const urun of kayitlar) {
      let yeniFiyat = urun.satis_fiyati;
      let yeniAlis = urun.alis_fiyati;
      let yeniKdv = urun.kdv_orani;

      switch (girdi.tip) {
        case 'YUZDE_ZAM':
          if (alisaUygula) yeniAlis = urun.alis_fiyati + yuzdeUygula(urun.alis_fiyati, girdi.deger);
          else yeniFiyat = urun.satis_fiyati + yuzdeUygula(urun.satis_fiyati, girdi.deger);
          break;
        case 'YUZDE_INDIRIM':
          if (alisaUygula) yeniAlis = urun.alis_fiyati - yuzdeUygula(urun.alis_fiyati, girdi.deger);
          else yeniFiyat = urun.satis_fiyati - yuzdeUygula(urun.satis_fiyati, girdi.deger);
          break;
        case 'MARJ_UYGULA':
          if (urun.alis_fiyati <= 0) continue;
          yeniFiyat = marjdanFiyat(urun.alis_fiyati, girdi.deger, urun.kdv_orani);
          break;
        case 'KDV_DEGISTIR': {
          // KDV oranı değişince KDV hariç matrah korunur, brüt fiyat yeniden kurulur.
          const { matrah } = kdvAyir(urun.satis_fiyati, urun.kdv_orani);
          yeniKdv = girdi.deger;
          yeniFiyat = matrah + yuzdeUygula(matrah, girdi.deger);
          break;
        }
      }

      // Psikolojik uç yuvarlaması raf (satış) fiyatına özgüdür; maliyete uygulanmaz.
      if (!alisaUygula && girdi.yuvarlamaKurus && girdi.yuvarlamaKurus > 0) {
        const taban = Math.floor(yeniFiyat / 100) * 100;
        const aday = taban + girdi.yuvarlamaKurus;
        yeniFiyat = aday >= yeniFiyat ? aday : aday + 100;
      }
      yeniFiyat = Math.max(0, yeniFiyat);
      yeniAlis = Math.max(0, yeniAlis);
      if (yeniFiyat === urun.satis_fiyati && yeniAlis === urun.alis_fiyati && yeniKdv === urun.kdv_orani) continue;

      etkilenen++;
      if (yeniFiyat !== urun.satis_fiyati && etiketAdaylari.length < 500) {
        etiketAdaylari.push({ id: urun.id, ad: urun.ad });
      }
      if (ornekler.length < 10) {
        ornekler.push(
          alisaUygula
            ? { ad: urun.ad, eski: urun.alis_fiyati, yeni: yeniAlis }
            : { ad: urun.ad, eski: urun.satis_fiyati, yeni: yeniFiyat },
        );
      }

      if (uygula) {
        urunKaydet(
          vt,
          {
            id: urun.id,
            ad: urun.ad,
            kategori_id: urun.kategori_id,
            marka: urun.marka,
            birim_tipi: urun.birim_tipi,
            alis_fiyati: yeniAlis,
            satis_fiyati: yeniFiyat,
            kdv_orani: yeniKdv,
            kritik_stok: urun.kritik_stok,
            ideal_stok: urun.ideal_stok,
            raf_konumu: urun.raf_konumu,
            aktif_mi: urun.aktif_mi,
            varsayilan_tedarikci_id: urun.varsayilan_tedarikci_id,
            skt_takibi: urun.skt_takibi,
            notlar: urun.notlar,
          },
          cihazId,
          zaman,
        );
        const kayit = urunBul(vt, urun.id);
        olayYaz(
          vt,
          {
            id: uuid(),
            olay_tipi: 'URUN_KAYDEDILDI',
            entity: 'urun',
            entity_id: urun.id,
            veri: kayit ?? { id: urun.id },
            olusturma_zamani: zaman,
          },
          cihazId,
          zaman,
        );
      }
    }
  };

  if (uygula) {
    vt.islem(() => {
      islem();
      denetimYaz(
        vt,
        {
          kullanici_id: aktor.kullaniciId,
          islem: 'TOPLU_FIYAT',
          entity: 'urun',
          yeni_deger: { tip: girdi.tip, deger: girdi.deger, hedef: girdi.hedef ?? 'SATIS', etkilenen },
        },
        cihazId,
        zaman,
      );
    });
    baglam.kayit.bilgi('Toplu fiyat işlemi uygulandı', { tip: girdi.tip, deger: girdi.deger, etkilenen });
  } else {
    islem(); // yalnız önizleme; hiçbir şey yazılmaz
  }

  return { etkilenen, ornekler, etiketAdaylari };
}

// ---------------------------------------------------------------------------
// CSV içe / dışa aktarma (§12.2)
// ---------------------------------------------------------------------------

export const ICE_AKTARIM_BASLIKLARI = [
  'ad',
  'barkod',
  'kategori',
  'marka',
  'birim_tipi',
  'alis_fiyati',
  'satis_fiyati',
  'kdv_orani',
  'kritik_stok',
  'acilis_stogu',
  'raf_konumu',
] as const;

export interface IceAktarimSatirSonucu {
  satir: number;
  durum: 'eklendi' | 'guncellendi' | 'hata';
  mesaj?: string;
  ad?: string;
}

export interface IceAktarimSonucu {
  toplam: number;
  eklenen: number;
  guncellenen: number;
  hatali: number;
  satirlar: IceAktarimSatirSonucu[];
}

/** Basit ama doğru CSV çözümleyici: tırnak içi ayraç ve çift tırnak kaçışını destekler. */
export function csvCoz(icerik: string): string[][] {
  const satirlar: string[][] = [];
  let hucre = '';
  let satir: string[] = [];
  let tirnakIcinde = false;

  const metin = icerik.replace(/^﻿/, ''); // BOM
  const ayrac = metin.split('\n')[0]?.includes(';') ? ';' : ',';

  for (let i = 0; i < metin.length; i++) {
    const karakter = metin[i];
    if (tirnakIcinde) {
      if (karakter === '"') {
        if (metin[i + 1] === '"') {
          hucre += '"';
          i++;
        } else {
          tirnakIcinde = false;
        }
      } else {
        hucre += karakter;
      }
      continue;
    }
    if (karakter === '"') {
      tirnakIcinde = true;
    } else if (karakter === ayrac) {
      satir.push(hucre);
      hucre = '';
    } else if (karakter === '\n') {
      satir.push(hucre.replace(/\r$/, ''));
      satirlar.push(satir);
      satir = [];
      hucre = '';
    } else {
      hucre += karakter;
    }
  }
  if (hucre !== '' || satir.length > 0) {
    satir.push(hucre.replace(/\r$/, ''));
    satirlar.push(satir);
  }
  return satirlar.filter((s) => s.some((h) => h.trim() !== ''));
}

/**
 * Ürün kataloğunu CSV'den içe aktarır (§12.2).
 * `uygula=false` ile önce doğrulama raporu üretilir; hatalı satırlar işaretlenir
 * ve kullanıcı onaylamadan hiçbir şey yazılmaz.
 */
export function urunleriIceAktar(baglam: Baglam, aktor: Aktor, icerik: string, uygula: boolean): IceAktarimSonucu {
  yetkiIste(aktor, 'urun.toplu_islem');
  const { vt, cihazId } = baglam;
  const zaman = simdi();
  const ayarlar = ayarlariOku(baglam);

  const tablo = csvCoz(icerik);
  if (tablo.length < 2) throw hatalar.dogrulama('Dosyada başlık satırı ve en az bir veri satırı olmalıdır.');

  const basliklar = (tablo[0] ?? []).map((b) => b.trim().toLowerCase());
  const sutun = (ad: string) => basliklar.indexOf(ad);
  if (sutun('ad') < 0) throw hatalar.dogrulama('CSV dosyasında "ad" sütunu zorunludur.');

  const kategoriler = new Map(kategorileriListele(vt, false).map((k) => [k.ad.toLocaleLowerCase('tr'), k.id]));
  const sonuc: IceAktarimSonucu = { toplam: tablo.length - 1, eklenen: 0, guncellenen: 0, hatali: 0, satirlar: [] };

  const isle = () => {
    for (let i = 1; i < tablo.length; i++) {
      const satir = tablo[i] ?? [];
      const al = (ad: string): string => {
        const idx = sutun(ad);
        return idx >= 0 ? (satir[idx] ?? '').trim() : '';
      };

      try {
        const ad = al('ad');
        if (!ad) throw new Error('Ürün adı boş olamaz');

        const satisFiyati = paraParse(al('satis_fiyati'));
        if (satisFiyati === null) throw new Error('Satış fiyatı okunamadı');
        const alisFiyati = paraParse(al('alis_fiyati')) ?? 0;
        const kdvHam = al('kdv_orani');
        const kdvOrani = kdvHam ? Number(kdvHam.replace(',', '.')) : ayarlar.varsayilanKdv;
        if (!Number.isFinite(kdvOrani) || kdvOrani < 0 || kdvOrani > 100) throw new Error('KDV oranı geçersiz');

        const barkodHam = al('barkod');
        const barkod = barkodHam ? barkodNormalize(barkodHam) : '';
        if (barkod && barkod.length >= 8 && /^\d+$/.test(barkod) && !eanGecerliMi(barkod) && barkod.length === 13) {
          // Kontrol hanesi tutmayan 13 haneli barkod büyük ihtimalle yazım hatasıdır.
          throw new Error(`Barkod kontrol hanesi tutmuyor: ${barkod}`);
        }

        const birimHam = al('birim_tipi').toUpperCase();
        const birimTipi = birimHam === 'KG' || birimHam === 'LT' ? (birimHam as 'KG' | 'LT') : 'ADET';

        const kategoriAdi = al('kategori');
        let kategoriId: string | null = null;
        if (kategoriAdi) {
          const anahtar = kategoriAdi.toLocaleLowerCase('tr');
          kategoriId = kategoriler.get(anahtar) ?? null;
          if (!kategoriId && uygula) {
            kategoriId = kategoriKaydet(vt, { ad: kategoriAdi }, cihazId, zaman);
            kategoriler.set(anahtar, kategoriId);
          }
        }

        // Barkod varsa mevcut ürünü güncelle, yoksa yeni ekle.
        const mevcutUrunId = barkod ? barkodSahibi(vt, barkod) : null;
        const acilisStogu = miktarParse(al('acilis_stogu')) ?? 0;

        if (uygula) {
          const urunId = urunKaydet(
            vt,
            {
              id: mevcutUrunId ?? undefined,
              ad,
              kategori_id: kategoriId,
              marka: al('marka') || null,
              birim_tipi: birimTipi,
              alis_fiyati: alisFiyati,
              satis_fiyati: satisFiyati,
              kdv_orani: kdvOrani,
              kritik_stok: miktarParse(al('kritik_stok')) ?? 0,
              raf_konumu: al('raf_konumu') || null,
            },
            cihazId,
            zaman,
          );
          if (barkod) barkodEkle(vt, urunId, barkod, null, cihazId, zaman);
          if (!mevcutUrunId && acilisStogu > 0) {
            const acilisHareketId = hareketEkle(
              vt,
              {
                urun_id: urunId,
                hareket_tipi: 'ACILIS',
                miktar: acilisStogu,
                birim_maliyet: alisFiyati,
                belge_tipi: 'ICE_AKTARIM',
                aciklama: 'CSV açılış stoğu',
                kullanici_id: aktor.kullaniciId,
              },
              cihazId,
              zaman,
            );
            // Olay ŞART: hareket yalnız yerelde kalırsa merkezdeki stok özeti
            // açılış miktarını hiç görmez ve panel ile kasa ilk günden ayrışır.
            stokOlayiYaz(baglam, acilisHareketId, urunId, 'ACILIS', acilisStogu, aktor, zaman);
          }
          const kayit = urunBul(vt, urunId);
          olayYaz(
            vt,
            {
              id: uuid(),
              olay_tipi: 'URUN_KAYDEDILDI',
              entity: 'urun',
              entity_id: urunId,
              veri: kayit ?? { id: urunId },
              olusturma_zamani: zaman,
            },
            cihazId,
            zaman,
          );
        }

        if (mevcutUrunId) sonuc.guncellenen++;
        else sonuc.eklenen++;
        sonuc.satirlar.push({ satir: i + 1, durum: mevcutUrunId ? 'guncellendi' : 'eklendi', ad });
      } catch (hata) {
        sonuc.hatali++;
        sonuc.satirlar.push({ satir: i + 1, durum: 'hata', mesaj: hata instanceof Error ? hata.message : String(hata) });
      }
    }
  };

  if (uygula) {
    // Hepsi-veya-hiçbiri değil: hatalı satırlar atlanır, sağlamlar yazılır (§12.2 kısmi içe aktarma).
    vt.islem(() => {
      isle();
      denetimYaz(
        vt,
        {
          kullanici_id: aktor.kullaniciId,
          islem: 'URUN_ICE_AKTARIM',
          entity: 'urun',
          yeni_deger: { eklenen: sonuc.eklenen, guncellenen: sonuc.guncellenen, hatali: sonuc.hatali },
        },
        cihazId,
        zaman,
      );
    });
  } else {
    isle();
  }

  return sonuc;
}

/** Katalog dışa aktarımı — aynı şablonla geri içe aktarılabilir. */
export function urunleriDisaAktar(baglam: Baglam): string {
  const { kayitlar } = urunleriListele(baglam.vt, { sadeceAktif: false }, { limit: 500, ofset: 0 });
  barkodlariDoldur(baglam.vt, kayitlar);

  const kacir = (deger: unknown): string => {
    const metin = String(deger ?? '');
    return /[";\n]/.test(metin) ? `"${metin.replace(/"/g, '""')}"` : metin;
  };

  const satirlar = [ICE_AKTARIM_BASLIKLARI.join(';')];
  for (const urun of kayitlar) {
    satirlar.push(
      [
        kacir(urun.ad),
        kacir(urun.barkodlar[0] ?? ''),
        kacir(urun.kategori_adi ?? ''),
        kacir(urun.marka ?? ''),
        urun.birim_tipi,
        (urun.alis_fiyati / 100).toFixed(2).replace('.', ','),
        (urun.satis_fiyati / 100).toFixed(2).replace('.', ','),
        String(urun.kdv_orani),
        String(urun.kritik_stok / 1000),
        String(urun.stok / 1000),
        kacir(urun.raf_konumu ?? ''),
      ].join(';'),
    );
  }
  return '﻿' + satirlar.join('\r\n');
}

// ---------------------------------------------------------------------------
// Muhtelif kalem (§10.3)
// ---------------------------------------------------------------------------

/**
 * "Muhtelif" ürününü döndürür; ilk çağrıda oluşturur.
 *
 * Barkodsuz, kataloğa girmeye değmeyen tek seferlik satışlar (poşet, gazete,
 * pil) için tek bir ürün kaydı tutulur. `satis_kalemleri.urun_id` NOT NULL
 * olduğu için satırın bir ürüne yaslanması ZORUNLUDUR; kalemin gerçek adı
 * `urun_adi` alanında satır bazında saklanır, o yüzden fişte ve raporda
 * "Muhtelif" değil kasiyerin yazdığı ad görünür.
 *
 * Yetki aranmaz: bu bir katalog düzenlemesi değil, kasiyerin satış yapabilmesi
 * için gereken tek seferlik altyapı kaydıdır. Kasiyerde `urun.duzenle` yetkisi
 * olmadığı için `urunuKaydet` üzerinden gidilemez.
 */
export function muhtelifUrunu(baglam: Baglam): { id: string; ad: string; kdvOrani: number } {
  const { vt, cihazId } = baglam;

  const kayitliId = ayarMetin(vt, AYAR.URUN_MUHTELIF_ID, '');
  if (kayitliId) {
    const mevcut = urunBul(vt, kayitliId);
    if (mevcut) return { id: mevcut.id, ad: mevcut.ad, kdvOrani: mevcut.kdv_orani };
    // Ayar duruyor ama ürün silinmiş: aşağıda yeniden oluşturulur.
  }

  const kdvOrani = Number(ayarMetin(vt, AYAR.VARSAYILAN_KDV, String(VARSAYILAN_KDV_ORANI))) || VARSAYILAN_KDV_ORANI;
  const zaman = simdi();

  return vt.islem(() => {
    const id = urunKaydet(
      vt,
      {
        ad: 'Muhtelif',
        kategori_id: null,
        marka: null,
        birim_tipi: 'ADET',
        alis_fiyati: 0,
        satis_fiyati: 0,
        kdv_orani: kdvOrani,
        kritik_stok: 0,
        ideal_stok: 0,
        raf_konumu: null,
        aktif_mi: true,
        varsayilan_tedarikci_id: null,
        skt_takibi: false,
        notlar: 'Barkodsuz tek seferlik satışlar için sistem kaydı. Silmeyin.',
      },
      cihazId,
      zaman,
    );

    ayarYaz(vt, AYAR.URUN_MUHTELIF_ID, id, 'Muhtelif kaleminin bağlandığı ürün kaydı', zaman);

    const kayit = urunBul(vt, id);
    olayYaz(
      vt,
      { id: uuid(), olay_tipi: 'URUN_KAYDEDILDI', entity: 'urun', entity_id: id, veri: kayit ?? { id }, olusturma_zamani: zaman },
      cihazId,
      zaman,
    );

    return { id, ad: 'Muhtelif', kdvOrani };
  });
}

// ---------------------------------------------------------------------------
// Kategori silme (§10.5)
// ---------------------------------------------------------------------------

export interface KategoriSilmeSonucu {
  /** true → satır tamamen silindi. false → kullanımda olduğu için pasife alındı. */
  silindi: boolean;
  urunSayisi: number;
  altKategoriSayisi: number;
  ad: string;
}

/**
 * Kategoriyi siler; kullanımdaysa silmek yerine pasife alır.
 *
 * `urunler.kategori_id` ve `kategoriler.ust_kategori_id` bu tabloya yabancı
 * anahtarla bağlıdır; sürücü `PRAGMA foreign_keys = ON` ile çalıştığı için dolu
 * bir kategoriyi silmek zaten veritabanınca reddedilirdi. Önce sayıyoruz ki
 * kullanıcıya "3 ürünü var" gibi anlamlı bir gerekçe gösterebilelim — ve
 * ürünlerin kategorisi sessizce boşaltılmasın.
 */
export function kategoriSil(baglam: Baglam, aktor: Aktor, kategoriId: string): KategoriSilmeSonucu {
  yetkiIste(aktor, 'urun.duzenle');

  const { vt, cihazId } = baglam;
  const kategori = vt.hazirla('SELECT id, ad FROM kategoriler WHERE id = ?').tek<{ id: string; ad: string }>(kategoriId);
  if (!kategori) throw hatalar.bulunamadi('Kategori');

  const urunSayisi = Number(
    vt.hazirla('SELECT COUNT(*) AS adet FROM urunler WHERE kategori_id = ?').tek<{ adet: number }>(kategoriId)?.adet ?? 0,
  );
  const altKategoriSayisi = Number(
    vt.hazirla('SELECT COUNT(*) AS adet FROM kategoriler WHERE ust_kategori_id = ?').tek<{ adet: number }>(kategoriId)?.adet ?? 0,
  );
  const silinebilir = urunSayisi === 0 && altKategoriSayisi === 0;
  const zaman = simdi();

  vt.islem(() => {
    if (silinebilir) {
      vt.hazirla('DELETE FROM kategoriler WHERE id = ?').calistir(kategoriId);
    } else {
      vt.hazirla('UPDATE kategoriler SET aktif_mi = 0, updated_at = ? WHERE id = ?').calistir(zaman, kategoriId);
    }

    olayYaz(
      vt,
      {
        id: uuid(),
        olay_tipi: 'KATEGORI_KAYDEDILDI',
        entity: 'kategori',
        entity_id: kategoriId,
        // aktif_mi BOOLEAN gönderilir: bulut tarafı `veri.aktif_mi === false`
        // diye katı karşılaştırma yapıyor; sayı 0 göndermek kategoriyi orada
        // AKTİF yazdırır ve silme bir sonraki pull'da geri dirilirdi.
        veri: { id: kategoriId, ad: kategori.ad, aktif_mi: false, silindi_mi: silinebilir, updated_at: zaman },
        olusturma_zamani: zaman,
      },
      cihazId,
      zaman,
    );

    denetimYaz(
      vt,
      {
        kullanici_id: aktor.kullaniciId,
        islem: silinebilir ? 'KATEGORI_SIL' : 'KATEGORI_PASIFLESTIR',
        entity: 'kategori',
        entity_id: kategoriId,
        eski_deger: { ad: kategori.ad },
        yeni_deger: { silindi: silinebilir, urun_sayisi: urunSayisi, alt_kategori_sayisi: altKategoriSayisi },
      },
      cihazId,
      zaman,
    );
  });

  return { silindi: silinebilir, urunSayisi, altKategoriSayisi, ad: kategori.ad };
}

/**
 * Buluttan gelen "kategori silindi" bayrağını yerelde uygular (§7.2 pull).
 * Yetki aranmaz: çağıran senkron motorudur. Karar yerelde verilir, çünkü bu
 * kasadaki ürün bağlantıları merkezdekinden farklı olabilir.
 */
export function kategoriyiSenkrondanSil(baglam: Baglam, kategoriId: string): void {
  const { vt, cihazId } = baglam;
  const kategori = vt.hazirla('SELECT id FROM kategoriler WHERE id = ?').tek<{ id: string }>(kategoriId);
  if (!kategori) return;

  const kullanimda =
    Number(
      vt.hazirla('SELECT COUNT(*) AS adet FROM urunler WHERE kategori_id = ?').tek<{ adet: number }>(kategoriId)?.adet ?? 0,
    ) +
    Number(
      vt.hazirla('SELECT COUNT(*) AS adet FROM kategoriler WHERE ust_kategori_id = ?').tek<{ adet: number }>(kategoriId)?.adet ??
        0,
    );

  const zaman = simdi();
  vt.islem(() => {
    if (kullanimda === 0) {
      vt.hazirla('DELETE FROM kategoriler WHERE id = ?').calistir(kategoriId);
    } else {
      vt.hazirla('UPDATE kategoriler SET aktif_mi = 0, updated_at = ? WHERE id = ?').calistir(zaman, kategoriId);
    }
  });
  void cihazId;
}
