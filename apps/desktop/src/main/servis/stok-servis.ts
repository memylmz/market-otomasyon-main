/**
 * Stok servisi — mal kabul, fire, sayım, düzeltme (§10.6).
 *
 * Her stok değişikliği bir hareket satırıdır; miktar hiçbir zaman doğrudan
 * yazılmaz. Mal kabul onayı ayrıca tedarikçiye cari borç oluşturur.
 */

import {
  barkodNormalize,
  gunAnahtari,
  hatalar,
  HATA_KODU,
  kdvAyir,
  simdi,
  UygulamaHatasi,
  uuid,
  zAlisGirdi,
  zFireGirdi,
  zStokGirisiGirdi,
  zTedarikciIadeGirdi,
  type AlisGirdi,
  type Kurus,
  type Miktar,
  type TedarikciIadeGirdi,
} from '@market/shared';
import { cariBul, cariHareketEkle } from '../depo/cari.js';
import { kasaHareketEkle } from '../depo/kasa.js';
import { barkodEkle, barkodSahibi, urunBul, urunKaydet } from '../depo/katalog.js';
import { denetimYaz, gunlukOzetEkle } from '../depo/ozet.js';
import { alisFaturasiBul, alisFaturasiEkle, alisKalemiEkle, alisKalemleriniGetir } from '../depo/satis.js';
import { olayYaz } from '../depo/senkron.js';
import {
  acikSayim,
  hareketEkle,
  sayimAc,
  sayimDurumuGuncelle,
  sayimFarklari,
  sayimSatiriKaydet,
  stokOku,
  type StokHareketTipiDb,
} from '../depo/stok.js';
import { kasaOturumuIste, yetkiIste, type Aktor, type Baglam } from './baglam.js';

/** Basit stok girişi (fatura olmadan). */
export function stokGirisi(baglam: Baglam, aktor: Aktor, hamGirdi: unknown): string {
  yetkiIste(aktor, 'stok.giris');
  const ayrisim = zStokGirisiGirdi.safeParse(hamGirdi);
  if (!ayrisim.success) throw hatalar.dogrulama('Stok girişi bilgileri geçerli değil.');
  const girdi = ayrisim.data;

  const { vt, cihazId } = baglam;
  const zaman = simdi();
  const urun = urunBul(vt, girdi.urun_id);
  if (!urun) throw hatalar.bulunamadi('Ürün');

  let hareketId = '';
  vt.islem(() => {
    hareketId = hareketEkle(
      vt,
      {
        urun_id: girdi.urun_id,
        hareket_tipi: 'GIRIS',
        miktar: girdi.miktar,
        birim_maliyet: girdi.birim_maliyet,
        skt: girdi.skt ?? null,
        lot_no: girdi.lot_no ?? null,
        aciklama: girdi.aciklama ?? null,
        belge_tipi: 'STOK_GIRIS',
        kullanici_id: aktor.kullaniciId,
      },
      cihazId,
      zaman,
    );
    stokOlayiYaz(baglam, hareketId, girdi.urun_id, 'GIRIS', girdi.miktar, aktor, zaman);
    denetimYaz(
      vt,
      {
        kullanici_id: aktor.kullaniciId,
        islem: 'STOK_GIRIS',
        entity: 'urun',
        entity_id: girdi.urun_id,
        yeni_deger: { miktar: girdi.miktar },
      },
      cihazId,
      zaman,
    );
  });

  baglam.kayit.bilgi('Stok girişi', { urun_id: girdi.urun_id, miktar: girdi.miktar });
  return hareketId;
}

/** Fire / zaiat çıkışı — neden kodu zorunludur (§10.6). */
export function fireCikisi(baglam: Baglam, aktor: Aktor, hamGirdi: unknown): string {
  yetkiIste(aktor, 'stok.fire');
  const ayrisim = zFireGirdi.safeParse(hamGirdi);
  if (!ayrisim.success) throw hatalar.dogrulama('Fire bilgileri geçerli değil.');
  const girdi = ayrisim.data;

  const { vt, cihazId } = baglam;
  const zaman = simdi();
  const urun = urunBul(vt, girdi.urun_id);
  if (!urun) throw hatalar.bulunamadi('Ürün');

  let hareketId = '';
  vt.islem(() => {
    hareketId = hareketEkle(
      vt,
      {
        urun_id: girdi.urun_id,
        hareket_tipi: 'FIRE',
        miktar: -girdi.miktar,
        birim_maliyet: urun.alis_fiyati,
        neden_kodu: girdi.neden_kodu,
        aciklama: girdi.aciklama ?? null,
        belge_tipi: 'FIRE',
        kullanici_id: aktor.kullaniciId,
      },
      cihazId,
      zaman,
    );
    stokOlayiYaz(baglam, hareketId, girdi.urun_id, 'FIRE', -girdi.miktar, aktor, zaman);
    denetimYaz(
      vt,
      {
        kullanici_id: aktor.kullaniciId,
        islem: 'FIRE',
        entity: 'urun',
        entity_id: girdi.urun_id,
        yeni_deger: { miktar: girdi.miktar, neden: girdi.neden_kodu },
      },
      cihazId,
      zaman,
    );
  });

  baglam.kayit.uyari('Fire çıkışı', { urun_id: girdi.urun_id, miktar: girdi.miktar, neden: girdi.neden_kodu });
  return hareketId;
}

/** Manuel stok düzeltmesi — yetkili işlemidir, nedeni loglanır. */
export function stokDuzeltme(baglam: Baglam, aktor: Aktor, urunId: string, yeniMiktar: Miktar, neden: string): string {
  yetkiIste(aktor, 'stok.duzeltme');
  if (!neden.trim()) throw hatalar.dogrulama('Düzeltme nedeni zorunludur.');

  const { vt, cihazId } = baglam;
  const zaman = simdi();
  const urun = urunBul(vt, urunId);
  if (!urun) throw hatalar.bulunamadi('Ürün');

  const mevcut = stokOku(vt, urunId);
  const fark = yeniMiktar - mevcut;
  if (fark === 0) return '';

  let hareketId = '';
  vt.islem(() => {
    hareketId = hareketEkle(
      vt,
      {
        urun_id: urunId,
        hareket_tipi: 'DUZELTME',
        miktar: fark,
        birim_maliyet: urun.alis_fiyati,
        aciklama: neden,
        belge_tipi: 'DUZELTME',
        kullanici_id: aktor.kullaniciId,
      },
      cihazId,
      zaman,
    );
    stokOlayiYaz(baglam, hareketId, urunId, 'DUZELTME', fark, aktor, zaman);
    denetimYaz(
      vt,
      {
        kullanici_id: aktor.kullaniciId,
        islem: 'STOK_DUZELTME',
        entity: 'urun',
        entity_id: urunId,
        eski_deger: { miktar: mevcut },
        yeni_deger: { miktar: yeniMiktar, neden },
      },
      cihazId,
      zaman,
    );
  });
  return hareketId;
}

/** Stok hareketini senkron outbox'ına yazar. Senkron motoru da kullanır (§11.5). */
export function stokOlayiYaz(
  baglam: Baglam,
  hareketId: string,
  urunId: string,
  tip: StokHareketTipiDb,
  miktar: Miktar,
  aktor: Aktor,
  zaman: string,
): void {
  /*
   * SKT, lot ve açıklama olay yüküne DB'DEN okunarak katılır (§11.5).
   *
   * Bu alanlar yalnız kasada duruyordu; merkez onları hiç görmediği için panel
   * SKT takibi yapamıyordu. Çağıranlardan parametre olarak istemek yerine az
   * önce yazılan satırdan okunur: yedi çağrı yerinin hepsini değiştirmek
   * gerekmez ve ileride yeni bir çağrı eklendiğinde alanları taşımayı
   * unutmak imkânsız hale gelir.
   */
  const ek = baglam.vt
    .hazirla('SELECT skt, lot_no, belge_tipi, belge_id, neden_kodu, aciklama, birim_maliyet FROM stok_hareketleri WHERE id = ?')
    .tek<{
      skt: string | null;
      lot_no: string | null;
      belge_tipi: string | null;
      belge_id: string | null;
      neden_kodu: string | null;
      aciklama: string | null;
      birim_maliyet: number | null;
    }>(hareketId);

  olayYaz(
    baglam.vt,
    {
      id: uuid(),
      olay_tipi: 'STOK_HAREKETI',
      entity: 'stok_hareketi',
      entity_id: hareketId,
      veri: {
        id: hareketId,
        urun_id: urunId,
        hareket_tipi: tip,
        miktar,
        kullanici_id: aktor.kullaniciId,
        created_at: zaman,
        skt: ek?.skt ?? null,
        lot_no: ek?.lot_no ?? null,
        belge_tipi: ek?.belge_tipi ?? null,
        belge_id: ek?.belge_id ?? null,
        neden_kodu: ek?.neden_kodu ?? null,
        aciklama: ek?.aciklama ?? null,
        birim_maliyet: ek?.birim_maliyet ?? null,
      },
      olusturma_zamani: zaman,
    },
    baglam.cihazId,
    zaman,
  );
}

// ---------------------------------------------------------------------------
// Mal kabul (alış faturası) — §10.6
// ---------------------------------------------------------------------------

export interface MalKabulSonucu {
  faturaId: string;
  genelToplam: Kurus;
  kalemSayisi: number;
  /** Peşin ödenen tutar. */
  odenen: Kurus;
  /** Tedarikçi cari borcunda kalan tutar. */
  kalanBorc: Kurus;
}

/**
 * Mal kabulü onaylar: stok artar, tedarikçiye cari borç doğar, ürünlerin alış
 * fiyatı (ve istenirse satış fiyatı) güncellenir — hepsi tek transaction.
 */
export function malKabulOnayla(baglam: Baglam, aktor: Aktor, hamGirdi: unknown): MalKabulSonucu {
  yetkiIste(aktor, 'stok.giris');
  const ayrisim = zAlisGirdi.safeParse(hamGirdi);
  if (!ayrisim.success) {
    throw hatalar.dogrulama('Mal kabul bilgileri geçerli değil.', { sorunlar: ayrisim.error.issues.map((i) => i.message) });
  }
  const girdi: AlisGirdi = ayrisim.data;

  /*
   * Faturada yeni ürün açmak katalog yazmaktır: stok yetkisi tek başına
   * yetmez. Kapı burada, HİÇBİR yazma yapılmadan önce kapanır.
   */
  const yeniUrunVar = girdi.kalemler.some((k) => k.yeni_urun);
  if (yeniUrunVar) yetkiIste(aktor, 'urun.duzenle', 'faturada yeni ürün açma');

  const { vt, cihazId } = baglam;
  const zaman = girdi.tarih ?? simdi();
  const kayitZamani = simdi();

  const tedarikci = cariBul(vt, girdi.tedarikci_id);
  if (!tedarikci) throw hatalar.bulunamadi('Tedarikçi');
  if (tedarikci.tip !== 'TEDARIKCI') throw hatalar.dogrulama('Seçilen cari bir tedarikçi değil.');

  // Tutarlar: birim_fiyat KDV HARİÇ kabul edilir (fatura netleri).
  let araToplam = 0;
  let kdvToplam = 0;
  const hesaplananlar = girdi.kalemler.map((kalem) => {
    const net = Math.round((kalem.miktar * kalem.birim_fiyat) / 1000);
    const { kdv } = kdvAyir(net + Math.round((net * kalem.kdv_orani) / 100), kalem.kdv_orani);
    araToplam += net;
    kdvToplam += kdv;
    return { ...kalem, net, kdv };
  });
  const genelToplam = araToplam + kdvToplam;
  // Ödeme fatura tutarını aşamaz; fazlası sessizce avansa dönüşmemeli.
  const odenen = Math.min(Math.max(girdi.odenen_tutar ?? 0, 0), genelToplam);
  if ((girdi.odenen_tutar ?? 0) > genelToplam) {
    throw hatalar.dogrulama('Ödenen tutar fatura toplamından fazla olamaz.');
  }

  const faturaId = uuid();

  vt.islem(() => {
    alisFaturasiEkle(
      vt,
      {
        id: faturaId,
        tedarikci_id: girdi.tedarikci_id,
        fatura_no: girdi.fatura_no ?? null,
        tarih: zaman,
        ara_toplam: araToplam,
        kdv_toplam: kdvToplam,
        genel_toplam: genelToplam,
        durum: 'ONAYLANDI',
        vade_tarihi: girdi.vade_tarihi ?? null,
        notlar: girdi.notlar ?? null,
        kullanici_id: aktor.kullaniciId,
      },
      cihazId,
      kayitZamani,
    );

    /*
     * Yeni ürünler kalemlerden ÖNCE yaratılır: kartı olmayan bir ürüne ne
     * fatura kalemi ne stok hareketi bağlanabilir. Aynı transaction içinde
     * oldukları için barkodu çakışan tek bir satır bile belgenin tamamını
     * geri alır — toptancının karşısında yarım yazılmış fatura, kullanıcının
     * en pahalıya mal olan hâlidir.
     */
    const cozulmusKalemler = hesaplananlar.map((kalem, sira) => {
      if (kalem.urun_id) return { ...kalem, urun_id: kalem.urun_id, yeniAcildi: false };

      const yeni = kalem.yeni_urun!;
      const barkod = yeni.barkod ? barkodNormalize(yeni.barkod) : null;
      if (barkod) {
        const sahip = barkodSahibi(vt, barkod);
        if (sahip) {
          const sahipUrun = urunBul(vt, sahip);
          throw new UygulamaHatasi(
            HATA_KODU.BARKOD_KULLANIMDA,
            `${sira + 1}. satır: "${barkod}" barkodu "${sahipUrun?.ad ?? sahip}" ürününde kayıtlı.`,
            { detay: { barkod, mevcut_urun_id: sahip, satir: sira + 1 } },
          );
        }
      }

      const yeniUrunId = urunKaydet(
        vt,
        {
          ad: yeni.ad,
          kategori_id: yeni.kategori_id ?? null,
          marka: yeni.marka ?? null,
          birim_tipi: yeni.birim_tipi,
          // Maliyet faturanın kendisinden gelir; ikinci bir yerde tutulmaz.
          alis_fiyati: kalem.birim_fiyat,
          satis_fiyati: yeni.satis_fiyati,
          kdv_orani: kalem.kdv_orani,
          kritik_stok: yeni.kritik_stok ?? 0,
          varsayilan_tedarikci_id: girdi.tedarikci_id,
        },
        cihazId,
        kayitZamani,
      );

      if (barkod) {
        const barkodId = barkodEkle(vt, yeniUrunId, barkod, null, cihazId, kayitZamani);
        olayYaz(
          vt,
          {
            id: uuid(),
            olay_tipi: 'BARKOD_KAYDEDILDI',
            entity: 'barkod',
            entity_id: barkodId,
            veri: {
              id: barkodId,
              urun_id: yeniUrunId,
              barkod,
              ambalaj_aciklamasi: null,
              aktif_mi: true,
              created_at: kayitZamani,
              updated_at: kayitZamani,
            },
            olusturma_zamani: kayitZamani,
          },
          cihazId,
          kayitZamani,
        );
      }

      const kayit = urunBul(vt, yeniUrunId);
      olayYaz(
        vt,
        {
          id: uuid(),
          olay_tipi: 'URUN_KAYDEDILDI',
          entity: 'urun',
          entity_id: yeniUrunId,
          veri: kayit ?? { id: yeniUrunId },
          olusturma_zamani: kayitZamani,
        },
        cihazId,
        kayitZamani,
      );

      return { ...kalem, urun_id: yeniUrunId, yeniAcildi: true };
    });

    for (const kalem of cozulmusKalemler) {
      const urun = urunBul(vt, kalem.urun_id);
      if (!urun) throw hatalar.bulunamadi('Ürün');

      /*
       * OKUTULAN BARKODU MEVCUT ÜRÜNE KAYDET (§11.8).
       *
       * Sahadaki en sık karışıklık: ürün katalogda vardır ama elindeki
       * ambalajın barkodu kartına kayıtlı değildir. Okutulunca "bulunamadı"
       * der; kullanıcı da mükerrer ürün açar. Kalemi mevcut ürüne bağlarken
       * barkod da eklenirse aynı barkod BİR DAHA sorulmaz.
       *
       * Barkod başka bir ürüne aitse fatura tümden reddedilir: sessizce sahip
       * değiştirmek, satışta yanlış ürünün okunmasına yol açardı.
       */
      if (!kalem.yeniAcildi && kalem.barkod_ekle) {
        const eklenecek = barkodNormalize(kalem.barkod_ekle);
        const sahip = eklenecek ? barkodSahibi(vt, eklenecek) : null;
        if (sahip && sahip !== urun.id) {
          const sahipUrun = urunBul(vt, sahip);
          throw new UygulamaHatasi(
            HATA_KODU.BARKOD_KULLANIMDA,
            `"${eklenecek}" barkodu "${sahipUrun?.ad ?? sahip}" ürününde kayıtlı; "${urun.ad}" ürününe eklenemez.`,
            { detay: { barkod: eklenecek, mevcut_urun_id: sahip, hedef_urun_id: urun.id } },
          );
        }
        if (eklenecek && !sahip) {
          const barkodId = barkodEkle(vt, urun.id, eklenecek, null, cihazId, kayitZamani);
          olayYaz(
            vt,
            {
              id: uuid(),
              olay_tipi: 'BARKOD_KAYDEDILDI',
              entity: 'barkod',
              entity_id: barkodId,
              veri: {
                id: barkodId,
                urun_id: urun.id,
                barkod: eklenecek,
                ambalaj_aciklamasi: null,
                aktif_mi: true,
                created_at: kayitZamani,
                updated_at: kayitZamani,
              },
              olusturma_zamani: kayitZamani,
            },
            cihazId,
            kayitZamani,
          );
        }
      }

      alisKalemiEkle(
        vt,
        {
          alis_faturasi_id: faturaId,
          urun_id: kalem.urun_id,
          miktar: kalem.miktar,
          birim_fiyat: kalem.birim_fiyat,
          kdv_orani: kalem.kdv_orani,
          satir_toplam: kalem.net + kalem.kdv,
          skt: kalem.skt ?? null,
          lot_no: kalem.lot_no ?? null,
        },
        cihazId,
        kayitZamani,
      );

      const hareketId = hareketEkle(
        vt,
        {
          urun_id: kalem.urun_id,
          hareket_tipi: 'GIRIS',
          miktar: kalem.miktar,
          birim_maliyet: kalem.birim_fiyat,
          belge_id: faturaId,
          belge_tipi: 'ALIS',
          skt: kalem.skt ?? null,
          lot_no: kalem.lot_no ?? null,
          kullanici_id: aktor.kullaniciId,
        },
        cihazId,
        kayitZamani,
      );
      stokOlayiYaz(baglam, hareketId, kalem.urun_id, 'GIRIS', kalem.miktar, aktor, kayitZamani);

      /*
       * FİYAT GÜNCELLEMESİ YALNIZ MEVCUT ÜRÜNDE.
       *
       * Bu faturada açılan ürünün alış ve satış fiyatı zaten doğru değerlerle
       * yazıldı ve olayı kuyruğa düştü; burada tekrar yazmak boşuna bir UPDATE
       * üretiyordu. Dahası `yeni_satis_fiyati` ile birlikte gelirse az önce
       * açılan ürünün fiyatını OLAY YAZMADAN eziyordu — kasa ile bulut
       * ayrışıyordu. (Şema artık o kombinasyonu da reddediyor.)
       */
      if (kalem.yeniAcildi) continue;

      // Alış fiyatı her zaman güncellenir; satış fiyatı yalnız istenirse.
      urunKaydet(
        vt,
        {
          id: urun.id,
          ad: urun.ad,
          kategori_id: urun.kategori_id,
          marka: urun.marka,
          birim_tipi: urun.birim_tipi,
          alis_fiyati: kalem.birim_fiyat,
          satis_fiyati: kalem.yeni_satis_fiyati ?? urun.satis_fiyati,
          kdv_orani: urun.kdv_orani,
          kritik_stok: urun.kritik_stok,
          ideal_stok: urun.ideal_stok,
          raf_konumu: urun.raf_konumu,
          aktif_mi: urun.aktif_mi,
          varsayilan_tedarikci_id: urun.varsayilan_tedarikci_id ?? girdi.tedarikci_id,
          skt_takibi: urun.skt_takibi,
          notlar: urun.notlar,
        },
        cihazId,
        kayitZamani,
      );
    }

    // Tedarikçiye borç — faturanın tamamı önce borç olarak yazılır.
    cariHareketEkle(
      vt,
      {
        cari_id: girdi.tedarikci_id,
        hareket_tipi: 'BORC',
        tutar: genelToplam,
        aciklama: `Mal alımı${girdi.fatura_no ? ` (Fatura ${girdi.fatura_no})` : ''}`,
        belge_id: faturaId,
        belge_tipi: 'ALIS',
        tarih: zaman,
        vade_tarihi: girdi.vade_tarihi ?? null,
        kullanici_id: aktor.kullaniciId,
      },
      cihazId,
      kayitZamani,
    );

    /*
     * Peşin / kısmi ödeme.
     *
     * Borç ve ödeme AYRI hareketler olarak yazılır, tek bir "net" satır olarak
     * değil: cari ekstresinde faturanın tamamı ve karşılığında yapılan ödeme
     * ayrı ayrı görünmelidir (mutabakat ve denetim için). Kalan tutar bakiyede
     * kendiliğinden borç olarak durur.
     */
    if (odenen > 0) {
      cariHareketEkle(
        vt,
        {
          cari_id: girdi.tedarikci_id,
          hareket_tipi: 'ODEME',
          tutar: -odenen,
          aciklama: `Mal alımı ödemesi (${girdi.odeme_tipi})${girdi.fatura_no ? ` — Fatura ${girdi.fatura_no}` : ''}`,
          belge_id: faturaId,
          belge_tipi: 'ALIS_ODEME',
          tarih: zaman,
          kullanici_id: aktor.kullaniciId,
        },
        cihazId,
        kayitZamani,
      );

      // Nakit ödeme kasadan çıkar; kart ödemesi fiziksel kasayı etkilemez.
      if (girdi.odeme_tipi === 'NAKIT' && aktor.kasaOturumId) {
        kasaHareketEkle(
          vt,
          {
            kasa_oturum_id: aktor.kasaOturumId,
            tip: 'ODEME',
            tutar: -odenen,
            aciklama: `Mal alımı ödemesi${girdi.fatura_no ? ` (Fatura ${girdi.fatura_no})` : ''}`,
            belge_id: faturaId,
            kullanici_id: aktor.kullaniciId,
          },
          cihazId,
          kayitZamani,
        );
        gunlukOzetEkle(vt, gunAnahtari(kayitZamani), cihazId, { nakit: -odenen }, kayitZamani);
      }
    }

    olayYaz(
      vt,
      {
        id: uuid(),
        olay_tipi: 'ALIS_FATURASI_ONAYLANDI',
        entity: 'alis_faturasi',
        entity_id: faturaId,
        veri: {
          id: faturaId,
          tedarikci_id: girdi.tedarikci_id,
          fatura_no: girdi.fatura_no ?? null,
          tarih: zaman,
          genel_toplam: genelToplam,
          /**
           * Peşin/kısmi ödeme olay yükünde TAŞINIR.
           *
           * Eskiden taşınmıyordu ve merkez faturanın tamamını borç yazıyordu:
           * kasada 800,00 borcu görünen tedarikçi panelde 1.200,00 görünüyordu.
           * Tedarikçi borcu paneldeki en kritik rakamlardan biri (§11.8).
           */
          odenen_tutar: girdi.odenen_tutar ?? 0,
          /*
           * Belgenin TAMAMI taşınır: KDV kırılımı, vade, not, durum ve faturayı
           * kimin girdiği. Eskiden yalnız tedarikçi, tarih ve genel toplam
           * gidiyordu; panelden bakan kişi faturanın KDV'sini göremiyor,
           * "bunu kim girdi" sorusunu cevaplayamıyordu (§11.8).
           */
          ara_toplam: araToplam,
          kdv_toplam: kdvToplam,
          durum: 'ONAYLANDI',
          vade_tarihi: girdi.vade_tarihi ?? null,
          notlar: girdi.notlar ?? null,
          kullanici_id: aktor.kullaniciId,
          kalemler: cozulmusKalemler.map((k) => ({
            urun_id: k.urun_id,
            miktar: k.miktar,
            birim_fiyat: k.birim_fiyat,
            kdv_orani: k.kdv_orani,
            satir_toplam: k.net + k.kdv,
            skt: k.skt ?? null,
            lot_no: k.lot_no ?? null,
          })),
        },
        olusturma_zamani: kayitZamani,
      },
      cihazId,
      kayitZamani,
    );

    denetimYaz(
      vt,
      {
        kullanici_id: aktor.kullaniciId,
        islem: 'MAL_KABUL',
        entity: 'alis_faturasi',
        entity_id: faturaId,
        yeni_deger: { genel_toplam: genelToplam, kalem: girdi.kalemler.length },
      },
      cihazId,
      kayitZamani,
    );
  });

  baglam.kayit.bilgi('Mal kabul onaylandı', {
    fatura_id: faturaId,
    genel_toplam: genelToplam,
    odenen,
    kalan_borc: genelToplam - odenen,
    kalem: girdi.kalemler.length,
  });
  return { faturaId, genelToplam, kalemSayisi: girdi.kalemler.length, odenen, kalanBorc: genelToplam - odenen };
}

// ---------------------------------------------------------------------------
// Tedarikçiye iade — mal kabulün tersi
// ---------------------------------------------------------------------------

export interface TedarikciIadeSonucu {
  iadeId: string;
  genelToplam: Kurus;
  kalemSayisi: number;
  odemeSekli: TedarikciIadeGirdi['odeme_sekli'];
}

/**
 * Bozuk / yanlış gelen malın tedarikçiye geri gönderilmesi.
 *
 * Tek transaction'da: stok düşer (TEDARIKCI_IADE çıkış hareketi), karşılığı ya
 * tedarikçi cari borcundan düşülür (İADE hareketi, varsayılan) ya da tedarikçi
 * nakit iade ettiyse kasaya giriş yazılır. Mal kabuldeki gibi birim fiyatlar
 * KDV hariç alınır, KDV satır bazında eklenir.
 */
export function tedarikciIade(baglam: Baglam, aktor: Aktor, hamGirdi: unknown): TedarikciIadeSonucu {
  yetkiIste(aktor, 'stok.giris');
  const ayrisim = zTedarikciIadeGirdi.safeParse(hamGirdi);
  if (!ayrisim.success) {
    throw hatalar.dogrulama('Tedarikçi iadesi bilgileri geçerli değil.', {
      sorunlar: ayrisim.error.issues.map((i) => i.message),
    });
  }
  const girdi: TedarikciIadeGirdi = ayrisim.data;

  const { vt, cihazId } = baglam;
  const zaman = simdi();

  const tedarikci = cariBul(vt, girdi.tedarikci_id);
  if (!tedarikci) throw hatalar.bulunamadi('Tedarikçi');
  if (tedarikci.tip !== 'TEDARIKCI') throw hatalar.dogrulama('Seçilen cari bir tedarikçi değil.');

  // Nakit iadede kasa oturumu transaction BAŞLAMADAN kontrol edilir.
  const kasaOturumId = girdi.odeme_sekli === 'NAKIT' ? kasaOturumuIste(aktor) : null;

  let genelToplam = 0;
  const hesaplananlar = girdi.kalemler.map((kalem) => {
    const net = Math.round((kalem.miktar * kalem.birim_fiyat) / 1000);
    const { kdv } = kdvAyir(net + Math.round((net * kalem.kdv_orani) / 100), kalem.kdv_orani);
    genelToplam += net + kdv;
    return { ...kalem, net, kdv };
  });

  const iadeId = uuid();
  const nedenMetni = girdi.neden?.trim() || 'Tedarikçiye iade';

  vt.islem(() => {
    for (const kalem of hesaplananlar) {
      const urun = urunBul(vt, kalem.urun_id);
      if (!urun) throw hatalar.bulunamadi('Ürün');

      const hareketId = hareketEkle(
        vt,
        {
          urun_id: kalem.urun_id,
          hareket_tipi: 'TEDARIKCI_IADE',
          miktar: -kalem.miktar,
          birim_maliyet: kalem.birim_fiyat,
          belge_id: iadeId,
          belge_tipi: 'TEDARIKCI_IADE',
          aciklama: `${nedenMetni} — ${tedarikci.ad_unvan}`,
          kullanici_id: aktor.kullaniciId,
        },
        cihazId,
        zaman,
      );
      stokOlayiYaz(baglam, hareketId, kalem.urun_id, 'TEDARIKCI_IADE', -kalem.miktar, aktor, zaman);
    }

    if (girdi.odeme_sekli === 'NAKIT') {
      // Tedarikçi malın bedelini nakit iade etti: kasaya girer, cari değişmez.
      kasaHareketEkle(
        vt,
        {
          kasa_oturum_id: kasaOturumId as string,
          tip: 'GIRIS',
          tutar: genelToplam,
          aciklama: `Tedarikçi iadesi (nakit) — ${tedarikci.ad_unvan}`,
          belge_id: iadeId,
          kullanici_id: aktor.kullaniciId,
        },
        cihazId,
        zaman,
      );
      gunlukOzetEkle(vt, gunAnahtari(zaman), cihazId, { nakit: genelToplam }, zaman);
    } else {
      // Varsayılan: tedarikçiye olan borç azalır. Borç yoksa bakiye eksiye düşer
      // (tedarikçi bize borçlanır) — ekstrede açıkça görünür.
      const cariHareketId = cariHareketEkle(
        vt,
        {
          cari_id: girdi.tedarikci_id,
          hareket_tipi: 'IADE',
          tutar: -genelToplam,
          aciklama: `Mal iadesi — ${nedenMetni}`,
          belge_id: iadeId,
          belge_tipi: 'TEDARIKCI_IADE',
          tarih: zaman,
          kullanici_id: aktor.kullaniciId,
        },
        cihazId,
        zaman,
      );
      olayYaz(
        vt,
        {
          id: uuid(),
          olay_tipi: 'CARI_HAREKETI',
          entity: 'cari_hareketi',
          entity_id: cariHareketId,
          veri: {
            id: cariHareketId,
            cari_id: girdi.tedarikci_id,
            hareket_tipi: 'IADE',
            tutar: -genelToplam,
            aciklama: `Mal iadesi — ${nedenMetni}`,
            belge_id: iadeId,
            tarih: zaman,
            kullanici_id: aktor.kullaniciId,
          },
          olusturma_zamani: zaman,
        },
        cihazId,
        zaman,
      );
    }

    denetimYaz(
      vt,
      {
        kullanici_id: aktor.kullaniciId,
        islem: 'TEDARIKCI_IADE',
        entity: 'cari',
        entity_id: girdi.tedarikci_id,
        yeni_deger: { tutar: genelToplam, kalem: girdi.kalemler.length, odeme_sekli: girdi.odeme_sekli, neden: nedenMetni },
      },
      cihazId,
      zaman,
    );
  });

  baglam.kayit.bilgi('Tedarikçiye iade kaydedildi', {
    iade_id: iadeId,
    tedarikci_id: girdi.tedarikci_id,
    genel_toplam: genelToplam,
    odeme_sekli: girdi.odeme_sekli,
    kalem: girdi.kalemler.length,
  });
  return { iadeId, genelToplam, kalemSayisi: girdi.kalemler.length, odemeSekli: girdi.odeme_sekli };
}

// ---------------------------------------------------------------------------
// Sayım (envanter) — §10.6
// ---------------------------------------------------------------------------

export function sayimBaslat(baglam: Baglam, aktor: Aktor, ad: string): string {
  yetkiIste(aktor, 'stok.sayim');
  const mevcut = acikSayim(baglam.vt);
  if (mevcut) throw hatalar.dogrulama('Zaten açık bir sayım var. Önce onu tamamlayın veya iptal edin.');
  return sayimAc(baglam.vt, ad || `Sayım ${gunAnahtari()}`, aktor.kullaniciId, baglam.cihazId);
}

export function sayimSatiriGir(baglam: Baglam, aktor: Aktor, sayimId: string, urunId: string, sayilanMiktar: Miktar): void {
  yetkiIste(aktor, 'stok.sayim');
  sayimSatiriKaydet(baglam.vt, sayimId, urunId, sayilanMiktar, baglam.cihazId);
}

export interface SayimSonucu {
  duzeltilenKalem: number;
  toplamFarkMaliyeti: Kurus;
}

/** Sayımı onaylar: farklar SAYIM tipinde düzeltme hareketine dönüşür. */
export function sayimTamamla(baglam: Baglam, aktor: Aktor, sayimId: string): SayimSonucu {
  yetkiIste(aktor, 'stok.sayim');
  const { vt, cihazId } = baglam;
  const zaman = simdi();
  const farklar = sayimFarklari(vt, sayimId).filter((f) => f.fark !== 0);

  let toplamFarkMaliyeti = 0;
  vt.islem(() => {
    for (const fark of farklar) {
      const hareketId = hareketEkle(
        vt,
        {
          urun_id: fark.urun_id,
          hareket_tipi: 'SAYIM',
          miktar: fark.fark,
          birim_maliyet: fark.alis_fiyati,
          belge_id: sayimId,
          belge_tipi: 'SAYIM',
          aciklama: `Sayım farkı (sistem ${fark.sistem_miktari / 1000}, sayılan ${fark.sayilan_miktar / 1000})`,
          kullanici_id: aktor.kullaniciId,
        },
        cihazId,
        zaman,
      );
      stokOlayiYaz(baglam, hareketId, fark.urun_id, 'SAYIM', fark.fark, aktor, zaman);
      toplamFarkMaliyeti += Math.round((fark.fark * fark.alis_fiyati) / 1000);
    }
    sayimDurumuGuncelle(vt, sayimId, 'TAMAMLANDI', zaman);
    denetimYaz(
      vt,
      {
        kullanici_id: aktor.kullaniciId,
        islem: 'SAYIM_TAMAMLANDI',
        entity: 'sayim',
        entity_id: sayimId,
        yeni_deger: { kalem: farklar.length, fark_maliyeti: toplamFarkMaliyeti },
      },
      cihazId,
      zaman,
    );
  });

  baglam.kayit.bilgi('Sayım tamamlandı', { sayim_id: sayimId, duzeltilen: farklar.length, fark_maliyeti: toplamFarkMaliyeti });
  return { duzeltilenKalem: farklar.length, toplamFarkMaliyeti };
}

export function sayimIptal(baglam: Baglam, aktor: Aktor, sayimId: string): void {
  yetkiIste(aktor, 'stok.sayim');
  sayimDurumuGuncelle(baglam.vt, sayimId, 'IPTAL');
}

// ---------------------------------------------------------------------------
// Alış faturası iptali ve düzenlenmesi (§11.8)
// ---------------------------------------------------------------------------

/**
 * Onaylı bir alış faturasını iptal eder.
 *
 * SİLMEZ, TERS KAYIT YAZAR. Fatura onaylandığında üç yerde iz bırakmıştır:
 * stok arttı, tedarikçiye borç doğdu, peşin ödendiyse kasadan para çıktı.
 * İptal bunların hepsini TERSİNE ÇEVİRİR ama hiçbirini geri silmez —
 * `stok_hareketleri` ve `cari_hareketler` değiştirilemez defterlerdir. Faturanın
 * kendisi de listede kalır, yalnız durumu IPTAL olur: "bu mal hiç gelmedi" ile
 * "bu fatura yanlıştı, düzeltildi" farklı şeylerdir ve ikisi de görünmelidir.
 *
 * Stok girişi satılmış olabilir; iptal stoğu eksiye düşürebilir. Bu bilinçli
 * olarak ENGELLENMEZ: fatura gerçekten yanlışsa kayıt düzeltilmelidir, eksi
 * stok ise Stok → Negatifler ekranında zaten raporlanır.
 */
export function alisFaturasiIptal(
  baglam: Baglam,
  aktor: Aktor,
  faturaId: string,
  neden: string,
): { faturaId: string; geriAlinanTutar: Kurus } {
  yetkiIste(aktor, 'stok.giris');
  if (!neden.trim()) throw hatalar.dogrulama('İptal nedeni zorunludur.');

  const { vt, cihazId } = baglam;
  const zaman = simdi();

  const fatura = alisFaturasiBul(vt, faturaId);
  if (!fatura) throw hatalar.bulunamadi('Alış faturası');
  if (fatura.durum === 'IPTAL') throw hatalar.isKurali('CAKISMA', 'Bu fatura zaten iptal edilmiş.');

  const kalemler = alisKalemleriniGetir(vt, faturaId);

  // Peşin ödeme yapılmışsa cari ekstresinde ayrı bir ODEME satırı vardır;
  // iptalde o da geri alınmalıdır, yoksa tedarikçi alacaklı görünür.
  const odeme = vt
    .hazirla("SELECT id, tutar FROM cari_hareketler WHERE belge_id = ? AND belge_tipi = 'ALIS_ODEME'")
    .tek<{ id: string; tutar: number }>(faturaId);
  const kasaHareketi = vt
    .hazirla('SELECT tip, tutar FROM kasa_hareketleri WHERE belge_id = ?')
    .tek<{ tip: string; tutar: number }>(faturaId);

  vt.islem(() => {
    for (const kalem of kalemler) {
      const hareketId = hareketEkle(
        vt,
        {
          urun_id: kalem.urun_id,
          /*
           * Tip DUZELTME'dir, TEDARIKCI_IADE değil: mal geri gönderilmiyor,
           * hiç girmemiş sayılıyor. İkisi ayrı iş olaylarıdır ve raporlarda
           * karışmamalıdır — biri gerçek bir iade, diğeri bir kayıt düzeltmesi.
           */
          hareket_tipi: 'DUZELTME',
          miktar: -kalem.miktar,
          birim_maliyet: kalem.birim_fiyat,
          belge_id: faturaId,
          belge_tipi: 'ALIS_IPTAL',
          neden_kodu: 'ALIS_IPTAL',
          aciklama: neden.trim(),
          kullanici_id: aktor.kullaniciId,
        },
        cihazId,
        zaman,
      );
      stokOlayiYaz(baglam, hareketId, kalem.urun_id, 'DUZELTME', -kalem.miktar, aktor, zaman);
    }

    // Borcun tersi
    cariHareketEkle(
      vt,
      {
        cari_id: fatura.tedarikci_id,
        hareket_tipi: 'DUZELTME',
        tutar: -fatura.genel_toplam,
        aciklama: `Alış faturası iptali${fatura.fatura_no ? ` (Fatura ${fatura.fatura_no})` : ''}: ${neden.trim()}`,
        belge_id: faturaId,
        belge_tipi: 'ALIS_IPTAL',
        kullanici_id: aktor.kullaniciId,
      },
      cihazId,
      zaman,
    );

    // Ödemenin tersi — para geri gelir, borç kapatması geri alınır.
    if (odeme) {
      cariHareketEkle(
        vt,
        {
          cari_id: fatura.tedarikci_id,
          hareket_tipi: 'DUZELTME',
          tutar: -odeme.tutar,
          aciklama: `Alış ödemesi iptali${fatura.fatura_no ? ` (Fatura ${fatura.fatura_no})` : ''}`,
          belge_id: faturaId,
          belge_tipi: 'ALIS_ODEME_IPTAL',
          kullanici_id: aktor.kullaniciId,
        },
        cihazId,
        zaman,
      );

      // Nakit ödenmişse para fiziksel olarak kasaya geri girer.
      if (kasaHareketi) {
        const kasaOturumId = kasaOturumuIste(aktor);
        kasaHareketEkle(
          vt,
          {
            kasa_oturum_id: kasaOturumId,
            tip: 'GIRIS',
            tutar: -kasaHareketi.tutar,
            aciklama: `Alış faturası iptali${fatura.fatura_no ? ` (Fatura ${fatura.fatura_no})` : ''}`,
            belge_id: faturaId,
            kullanici_id: aktor.kullaniciId,
          },
          cihazId,
          zaman,
        );
        gunlukOzetEkle(vt, gunAnahtari(zaman), cihazId, { nakit: -kasaHareketi.tutar }, zaman);
      }
    }

    vt.hazirla(
      `UPDATE alis_faturalari SET durum = 'IPTAL', notlar = COALESCE(notlar || char(10), '') || ?,
                                  updated_at = ? WHERE id = ?`,
    ).calistir(`İPTAL (${zaman}): ${neden.trim()}`, zaman, faturaId);

    olayYaz(
      vt,
      {
        id: uuid(),
        olay_tipi: 'ALIS_FATURASI_IPTAL',
        entity: 'alis_faturasi',
        entity_id: faturaId,
        veri: {
          id: faturaId,
          tedarikci_id: fatura.tedarikci_id,
          genel_toplam: fatura.genel_toplam,
          odenen_tutar: odeme ? -odeme.tutar : 0,
          neden: neden.trim(),
          kullanici_id: aktor.kullaniciId,
          tarih: zaman,
        },
        olusturma_zamani: zaman,
      },
      cihazId,
      zaman,
    );

    denetimYaz(
      vt,
      {
        kullanici_id: aktor.kullaniciId,
        islem: 'ALIS_FATURASI_IPTAL',
        entity: 'alis_faturasi',
        entity_id: faturaId,
        eski_deger: { genel_toplam: fatura.genel_toplam, durum: fatura.durum, kalem: kalemler.length },
        yeni_deger: { durum: 'IPTAL', neden: neden.trim() },
      },
      cihazId,
      zaman,
    );
  });

  baglam.kayit.bilgi('Alış faturası iptal edildi', { fatura_id: faturaId, tutar: fatura.genel_toplam });
  return { faturaId, geriAlinanTutar: fatura.genel_toplam };
}

/**
 * Faturanın BELGE BİLGİLERİNİ düzeltir: fatura numarası, vade, not.
 *
 * Kalemler ve tutarlar buradan DEĞİŞTİRİLEMEZ, bilinçli olarak. Onaylı bir
 * faturanın miktarını değiştirmek, çoktan yazılmış stok ve cari hareketlerini
 * geçmişe dönük düzenlemek demektir; o defterler değiştirilemez. Yanlış girilen
 * bir faturanın doğru düzeltmesi "iptal et, yeniden gir"dir — arayüz de bu iki
 * adımı birlikte sunar. Burada düzeltilen alanların hiçbirinin mali etkisi yok.
 */
export function alisFaturasiGuncelle(
  baglam: Baglam,
  aktor: Aktor,
  faturaId: string,
  alanlar: { fatura_no?: string | null; vade_tarihi?: string | null; notlar?: string | null },
): void {
  yetkiIste(aktor, 'stok.giris');
  const { vt, cihazId } = baglam;
  const zaman = simdi();

  const fatura = alisFaturasiBul(vt, faturaId);
  if (!fatura) throw hatalar.bulunamadi('Alış faturası');
  if (fatura.durum === 'IPTAL') throw hatalar.dogrulama('İptal edilmiş fatura düzenlenemez.');

  const yeni = {
    fatura_no: alanlar.fatura_no === undefined ? fatura.fatura_no : alanlar.fatura_no?.trim() || null,
    vade_tarihi: alanlar.vade_tarihi === undefined ? fatura.vade_tarihi : alanlar.vade_tarihi || null,
    notlar: alanlar.notlar === undefined ? fatura.notlar : alanlar.notlar?.trim() || null,
  };

  vt.islem(() => {
    vt.hazirla('UPDATE alis_faturalari SET fatura_no = ?, vade_tarihi = ?, notlar = ?, updated_at = ? WHERE id = ?').calistir(
      yeni.fatura_no,
      yeni.vade_tarihi,
      yeni.notlar,
      zaman,
      faturaId,
    );

    olayYaz(
      vt,
      {
        id: uuid(),
        olay_tipi: 'ALIS_FATURASI_GUNCELLENDI',
        entity: 'alis_faturasi',
        entity_id: faturaId,
        veri: { id: faturaId, ...yeni, kullanici_id: aktor.kullaniciId, updated_at: zaman },
        olusturma_zamani: zaman,
      },
      cihazId,
      zaman,
    );

    denetimYaz(
      vt,
      {
        kullanici_id: aktor.kullaniciId,
        islem: 'ALIS_FATURASI_GUNCELLE',
        entity: 'alis_faturasi',
        entity_id: faturaId,
        eski_deger: { fatura_no: fatura.fatura_no, vade_tarihi: fatura.vade_tarihi, notlar: fatura.notlar },
        yeni_deger: yeni,
      },
      cihazId,
      zaman,
    );
  });
}
