/**
 * Satış servisi — sistemin en kritik iş kuralı (§10.3).
 *
 * DEĞİŞMEZ: Satış kesinleşince **tek transaction** içinde şunlar yazılır —
 *   satış başlığı + kalemler + ödemeler
 * + stok çıkış hareketleri
 * + kasa hareketleri
 * + (veresiye ise) cari borç hareketi
 * + günlük/ürün özet güncellemesi
 * + senkron outbox olayı
 * + denetim kaydı
 * Ya hepsi ya hiçbiri. Elektrik kesilse bile yarım satış kalmaz (§3.2, §20).
 *
 * İade modeli: iade bir satıştır; `iade_mi = 1` ve **tüm tutar/miktarlar negatiftir**.
 * Böylece ciro, kâr ve ödeme kırılımı toplamları doğrudan net değeri verir; stok
 * hareketi ise ters işaretle (mal geri geldiği için pozitif) yazılır.
 */

import {
  baskinOdemeTipi,
  fisNo as fisNoUret,
  gunAnahtari,
  hatalar,
  HATA_KODU,
  kampanyaFiyatiBul,
  miktarKampanyasiIskontosu,
  limitAsimi,
  odemeDogrula,
  sepetHesapla,
  seriHarfi,
  simdi,
  SINIRLAR,
  UygulamaHatasi,
  uuid,
  zIadeGirdi,
  zSatisGirdi,
  type IadeGirdi,
  type Kurus,
  type Miktar,
  type OdemeGirdisi,
  type SatirGirdi,
  type SatisGirdi,
  AYAR,
} from '@market/shared';
import type { Vt } from '../db/surucu.js';
import { ayarMetin } from '../depo/ayar.js';
import { cariBul, cariHareketEkle } from '../depo/cari.js';
import { etkinKampanyalar, urunleriBul, type UrunKaydi } from '../depo/katalog.js';
import { kasaHareketEkle } from '../depo/kasa.js';
import { denetimYaz, gunlukOzetEkle, urunOzetEkle } from '../depo/ozet.js';
import { sonrakiSayac } from '../depo/ortak.js';
import {
  kalemEkle,
  odemeEkle,
  satisDetayi,
  satisEkle,
  satisIptalEt as satisIptalIsaretle,
  kalemleriGetir,
  satisBul,
  odemeleriGetir,
  type SatisDetayi,
} from '../depo/satis.js';
import { olayYaz } from '../depo/senkron.js';
import { hareketEkle, stoklariOku } from '../depo/stok.js';
import { ayarlariOku, kasaOturumuIste, yetkiIste, yetkisiVarMi, type Aktor, type Baglam } from './baglam.js';

export interface SatisSonucu {
  satisId: string;
  fisNo: string;
  genelToplam: Kurus;
  paraUstu: Kurus;
  detay: SatisDetayi;
  /** Engelleyici olmayan uyarılar (negatif stok, limit aşımı onayı vb.). */
  uyarilar: string[];
}

/** Fiyat doğrulaması ve stok kontrolü için satır başına çözümlenmiş bilgi. */
interface CozulmusKalem {
  urun: UrunKaydi;
  /** Fişe yazılacak ad — muhtelif kalemde girdiden gelir, yoksa ürünün adı. */
  ad: string;
  miktar: Miktar;
  birimFiyat: Kurus;
  barkod: string | null;
  kampanyaId: string | null;
  iskontoYuzde?: number;
  iskontoTutar?: Kurus;
}

function urunleriCoz(baglam: Baglam, aktor: Aktor, girdi: SatisGirdi, zaman: string): CozulmusKalem[] {
  const urunIdler = girdi.kalemler.map((k) => k.urun_id);
  const urunler = urunleriBul(baglam.vt, urunIdler);
  // Muhtelif kaydının liste fiyatı yoktur (0): tutar her satışta girilir.
  const muhtelifId = ayarMetin(baglam.vt, AYAR.URUN_MUHTELIF_ID, '');
  const kampanyalar = etkinKampanyalar(baglam.vt, zaman).map((k) => ({
    id: k.id,
    tip: k.tip,
    kapsam: k.kapsam,
    hedefId: k.hedef_id,
    deger: k.deger,
    esikMiktar: k.esik_miktar ?? undefined,
    baslangic: k.baslangic,
    bitis: k.bitis,
    aktifMi: k.aktif_mi,
    oncelik: k.oncelik,
  }));

  return girdi.kalemler.map((kalem) => {
    const urun = urunler.get(kalem.urun_id);
    if (!urun) throw hatalar.bulunamadi('Ürün');
    if (!urun.aktif_mi) {
      throw new UygulamaHatasi(HATA_KODU.URUN_PASIF, `"${urun.ad}" pasif durumda, satışa kapalı.`, {
        detay: { urun_id: urun.id },
      });
    }

    // İstemciden gelen fiyata körü körüne güvenilmez: beklenen fiyat sunucu
    // tarafında yeniden hesaplanır; sapma varsa yetki aranır (§15.4).
    const { fiyat: beklenen, kampanyaId } = kampanyaFiyatiBul(
      urun.satis_fiyati,
      { urunId: urun.id, kategoriId: urun.kategori_id },
      kampanyalar,
      zaman,
    );

    // Muhtelif kaleminde fiyat sapması denetimi UYGULANMAZ: kartın fiyatı
    // tanım gereği 0'dır, denetim uygulansaydı `satis.fiyat_degistir` yetkisi
    // olmayan kasiyer muhtelif kalemi hiç satamazdı (§10.3).
    const muhtelifMi = muhtelifId !== '' && urun.id === muhtelifId;

    let birimFiyat = kalem.birim_fiyat;
    if (!muhtelifMi && birimFiyat !== beklenen) {
      if (!yetkisiVarMi(aktor, 'satis.fiyat_degistir')) {
        // Yetkisiz kullanıcı fiyatı değiştiremez; sessizce doğru fiyata çekilir.
        birimFiyat = beklenen;
      }
    }
    if (birimFiyat < 0) throw hatalar.dogrulama('Birim fiyat negatif olamaz.');

    if ((kalem.iskonto_yuzde || kalem.iskonto_tutar) && !yetkisiVarMi(aktor, 'satis.iskonto')) {
      throw new UygulamaHatasi(HATA_KODU.YETKI, 'İskonto uygulama yetkiniz yok.');
    }

    /*
     * MİKTAR KAMPANYASI (§10.8) — "3 al 2 öde", "3 kg üzeri 8,00/kg".
     *
     * Sunucuda YENİDEN hesaplanır; istemciden gelen iskontoya güvenilmez.
     * Satır iskontosu olarak yazılır, birim fiyata gömülmez: bölme kuruş
     * yuvarlamasını bozar ve müşteri fişte neyin bedava geldiğini göremez.
     *
     * ELLE VERİLEN İSKONTO ÖNCELİKLİDİR: kasiyer bilerek indirim yazdıysa
     * kampanya devreye girmez, iki indirim üst üste binmez.
     */
    const elleIskonto = Boolean(kalem.iskonto_yuzde) || Boolean(kalem.iskonto_tutar);
    const miktarKampanyasi = elleIskonto
      ? { iskonto: 0, kampanyaId: null }
      : miktarKampanyasiIskontosu(
          birimFiyat,
          kalem.miktar,
          urun.birim_tipi,
          { urunId: urun.id, kategoriId: urun.kategori_id },
          kampanyalar,
          zaman,
        );

    return {
      urun,
      ad: kalem.urun_adi?.trim() || urun.ad,
      miktar: kalem.miktar,
      birimFiyat,
      barkod: kalem.barkod ?? null,
      kampanyaId: miktarKampanyasi.kampanyaId ?? kampanyaId ?? kalem.kampanya_id ?? null,
      iskontoYuzde: kalem.iskonto_yuzde,
      iskontoTutar: elleIskonto ? kalem.iskonto_tutar : miktarKampanyasi.iskonto || undefined,
    };
  });
}

/**
 * Bu kasanın fiş serisi (§10.2).
 *
 * Öncelik MERKEZİN ATADIĞI seridedir: cihaz kimliğinden hash'lemek 26 harfe
 * sıkıştığı için iki kasanın aynı seriyi alması kaçınılmazdı (4 kasada %21,
 * 6 kasada %46) ve o an iki farklı satış aynı fiş numarasını taşıyordu —
 * müşteri fişiyle geldiğinde yanlış satış iade edilebiliyordu.
 *
 * Merkeze hiç bağlanmamış kasada eski türetme sürüyor: tek kasalı kurulumda
 * çakışacak ikinci bir cihaz zaten yoktur.
 */
function fisSerisi(vt: Vt, cihazId: string): string {
  return ayarMetin(vt, AYAR.CIHAZ_SERI, '') || seriHarfi(cihazId);
}

export function satisKesinlestir(baglam: Baglam, aktor: Aktor, hamGirdi: unknown): SatisSonucu {
  yetkiIste(aktor, 'satis.yap');
  const kasaOturumId = kasaOturumuIste(aktor);

  const ayrisim = zSatisGirdi.safeParse(hamGirdi);
  if (!ayrisim.success) {
    throw hatalar.dogrulama('Satış bilgileri geçerli değil.', { sorunlar: ayrisim.error.issues.map((i) => i.message) });
  }
  const girdi = ayrisim.data;
  if (girdi.kalemler.length > SINIRLAR.SEPET_AZAMI_SATIR) {
    throw hatalar.dogrulama(`Bir satışta en fazla ${SINIRLAR.SEPET_AZAMI_SATIR} kalem olabilir.`);
  }

  const { vt, cihazId } = baglam;
  const zaman = simdi();
  const ayarlar = ayarlariOku(baglam);
  const uyarilar: string[] = [];

  const kalemler = urunleriCoz(baglam, aktor, girdi, zaman);

  // --- Tutar hesabı (paylaşılan saf fonksiyonlar) ---
  const satirGirdileri: SatirGirdi[] = kalemler.map((k) => ({
    miktar: k.miktar,
    birimFiyat: k.birimFiyat,
    kdvOrani: k.urun.kdv_orani,
    iskontoYuzde: k.iskontoYuzde,
    iskontoTutar: k.iskontoTutar,
  }));
  // Genel tutara indirim uygulanmaz (§10.3): yalnız satır iskontosu vardır.
  const hesap = sepetHesapla(satirGirdileri);

  // --- Ödeme doğrulaması ---
  const odemeler: OdemeGirdisi[] = girdi.odemeler.map((o) => ({ tip: o.tip, tutar: o.tutar, alinan: o.alinan }));
  const odemeSonucu = odemeDogrula(hesap.genelToplam, odemeler);
  if (!odemeSonucu.gecerli) {
    const kod =
      odemeSonucu.hata === 'ODEME_EKSIK'
        ? HATA_KODU.ODEME_EKSIK
        : odemeSonucu.hata === 'ODEME_FAZLA'
          ? HATA_KODU.ODEME_FAZLA
          : HATA_KODU.DOGRULAMA;
    throw hatalar.isKurali(kod, undefined, { kalan: odemeSonucu.kalan, genel_toplam: hesap.genelToplam });
  }

  // --- Veresiye ve kredi limiti (§10.7) ---
  const veresiyeTutari = odemeler.filter((o) => o.tip === 'VERESIYE').reduce((t, o) => t + o.tutar, 0);
  if (veresiyeTutari > 0) {
    if (!girdi.musteri_id) throw hatalar.isKurali(HATA_KODU.VERESIYE_MUSTERI_GEREKLI);
    const musteri = cariBul(vt, girdi.musteri_id);
    if (!musteri || !musteri.aktif_mi) throw hatalar.bulunamadi('Müşteri');

    const asim = limitAsimi(musteri.bakiye, veresiyeTutari, musteri.kredi_limiti);
    if (asim.asiyor) {
      const engelle =
        ayarlar.krediLimitiDavranisi === 'ENGELLE' || (ayarlar.krediLimitiDavranisi === 'UYAR' && !girdi.limit_asimi_onaylandi);
      if (engelle && !yetkisiVarMi(aktor, 'cari.limit_asimi_onay')) {
        throw new UygulamaHatasi(HATA_KODU.KREDI_LIMITI_ASILDI, undefined, {
          detay: { limit: musteri.kredi_limiti, mevcut_bakiye: musteri.bakiye, asim: asim.asimTutari },
        });
      }
      uyarilar.push(`Kredi limiti ${(asim.asimTutari / 100).toFixed(2)} ₺ aşıldı.`);
    }
  }

  // --- Stok kontrolü ---
  const stoklar = stoklariOku(
    vt,
    kalemler.map((k) => k.urun.id),
  );
  for (const kalem of kalemler) {
    const mevcut = stoklar.get(kalem.urun.id) ?? 0;
    const sonrasi = mevcut - kalem.miktar;
    if (sonrasi < 0) {
      if (!ayarlar.negatifStokIzni && !girdi.negatif_stok_onaylandi) {
        throw new UygulamaHatasi(HATA_KODU.STOK_YETERSIZ, `"${kalem.urun.ad}" için stok yetersiz.`, {
          detay: { urun_id: kalem.urun.id, mevcut, istenen: kalem.miktar },
        });
      }
      uyarilar.push(`"${kalem.urun.ad}" stoğu eksiye düştü.`);
    }
  }

  // --- Yazma (tek transaction) ---
  const satisId = uuid();
  const gun = gunAnahtari(zaman);

  vt.islem(() => {
    const sira = sonrakiSayac(vt, 'fis');
    const fisNo = fisNoUret(fisSerisi(vt, cihazId), sira);

    satisEkle(
      vt,
      {
        id: satisId,
        fis_no: fisNo,
        tarih: zaman,
        kullanici_id: aktor.kullaniciId,
        kasa_oturum_id: kasaOturumId,
        ara_toplam: hesap.araToplam,
        iskonto_toplam: hesap.iskontoToplam,
        kdv_toplam: hesap.kdvToplam,
        genel_toplam: hesap.genelToplam,
        odeme_ozeti: baskinOdemeTipi(odemeler),
        musteri_id: girdi.musteri_id ?? null,
        notlar: girdi.notlar ?? null,
      },
      cihazId,
      zaman,
    );

    let brutKar = 0;
    hesap.satirlar.forEach((satir, i) => {
      const kalem = kalemler[i];
      if (!kalem) return;
      kalemEkle(
        vt,
        {
          satis_id: satisId,
          urun_id: kalem.urun.id,
          urun_adi: kalem.ad,
          barkod: kalem.barkod,
          miktar: kalem.miktar,
          birim_tipi: kalem.urun.birim_tipi,
          birim_fiyat: kalem.birimFiyat,
          birim_maliyet: kalem.urun.alis_fiyati,
          iskonto: satir.iskonto,
          kdv_orani: satir.kdvOrani,
          kdv_tutar: satir.kdvTutar,
          satir_toplam: satir.satirToplam,
          kampanya_id: kalem.kampanyaId,
          sira: i,
        },
        cihazId,
        zaman,
      );

      // Stok çıkışı — miktar negatif yazılır (append-only, §8.1).
      hareketEkle(
        vt,
        {
          urun_id: kalem.urun.id,
          hareket_tipi: 'SATIS',
          miktar: -kalem.miktar,
          birim_maliyet: kalem.urun.alis_fiyati,
          belge_id: satisId,
          belge_tipi: 'SATIS',
          kullanici_id: aktor.kullaniciId,
        },
        cihazId,
        zaman,
      );

      const maliyet = Math.round((kalem.miktar * kalem.urun.alis_fiyati) / 1000);
      const satirKar = satir.matrah - maliyet;
      brutKar += satirKar;
      urunOzetEkle(vt, kalem.urun.id, gun, cihazId, { adet: kalem.miktar, ciro: satir.satirToplam, kar: satirKar }, zaman);
    });

    let nakit = 0;
    let kart = 0;
    for (const odeme of odemeler) {
      const alinan = odeme.tip === 'NAKIT' ? (odeme.alinan ?? odeme.tutar) : odeme.tutar;
      const paraUstu = odeme.tip === 'NAKIT' ? alinan - odeme.tutar : 0;
      odemeEkle(
        vt,
        { satis_id: satisId, odeme_tipi: odeme.tip, tutar: odeme.tutar, alinan, para_ustu: paraUstu },
        cihazId,
        zaman,
      );

      if (odeme.tip === 'NAKIT') {
        nakit += odeme.tutar;
        kasaHareketEkle(
          vt,
          {
            kasa_oturum_id: kasaOturumId,
            tip: 'SATIS_NAKIT',
            tutar: odeme.tutar,
            belge_id: satisId,
            aciklama: `Satış ${fisNo}`,
            kullanici_id: aktor.kullaniciId,
          },
          cihazId,
          zaman,
        );
      } else if (odeme.tip === 'KART') {
        kart += odeme.tutar;
        // Kart tutarı fiziksel nakdi etkilemez ama gün sonu kırılımında görünür (§13 POS entegresi yok).
        kasaHareketEkle(
          vt,
          {
            kasa_oturum_id: kasaOturumId,
            tip: 'SATIS_KART',
            tutar: odeme.tutar,
            belge_id: satisId,
            aciklama: `Satış ${fisNo}`,
            kullanici_id: aktor.kullaniciId,
          },
          cihazId,
          zaman,
        );
      } else {
        cariHareketEkle(
          vt,
          {
            cari_id: girdi.musteri_id as string,
            hareket_tipi: 'BORC',
            tutar: odeme.tutar,
            aciklama: `Veresiye satış ${fisNo}`,
            belge_id: satisId,
            belge_tipi: 'SATIS',
            vade_tarihi: vadeTarihiHesapla(baglam, girdi.musteri_id as string, zaman),
            kullanici_id: aktor.kullaniciId,
          },
          cihazId,
          zaman,
        );
      }
    }

    gunlukOzetEkle(
      vt,
      gun,
      cihazId,
      {
        ciro: hesap.genelToplam,
        islem_sayisi: 1,
        nakit,
        kart,
        veresiye: veresiyeTutari,
        brut_kar: brutKar,
        kdv_toplam: hesap.kdvToplam,
      },
      zaman,
    );

    // Outbox — ana yazmalarla AYNI transaction (§7.1).
    olayYaz(
      vt,
      {
        id: uuid(),
        olay_tipi: 'SATIS_YAPILDI',
        entity: 'satis',
        entity_id: satisId,
        veri: {
          id: satisId,
          fis_no: fisNo,
          tarih: zaman,
          genel_toplam: hesap.genelToplam,
          ara_toplam: hesap.araToplam,
          iskonto_toplam: hesap.iskontoToplam,
          kdv_toplam: hesap.kdvToplam,
          odeme_ozeti: baskinOdemeTipi(odemeler),
          musteri_id: girdi.musteri_id ?? null,
          kullanici_id: aktor.kullaniciId,
          // Kullanıcı bulutta bulunmayabilir; fişte satışı yapan yine görünsün (§10.7).
          kasiyer_adi: aktor.ad,
          kasa_oturum_id: kasaOturumId,
          brut_kar: brutKar,
          kalemler: hesap.satirlar.map((satir, i) => ({
            urun_id: kalemler[i]?.urun.id,
            urun_adi: kalemler[i]?.ad,
            barkod: kalemler[i]?.barkod ?? null,
            miktar: kalemler[i]?.miktar,
            birim_fiyat: kalemler[i]?.birimFiyat,
            birim_maliyet: kalemler[i]?.urun.alis_fiyati,
            iskonto: satir.iskonto,
            kdv_orani: satir.kdvOrani,
            kdv_tutar: satir.kdvTutar,
            satir_toplam: satir.satirToplam,
          })),
          odemeler: odemeler.map((o) => ({ tip: o.tip, tutar: o.tutar })),
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
        islem: 'SATIS',
        entity: 'satis',
        entity_id: satisId,
        yeni_deger: { fis_no: fisNo, genel_toplam: hesap.genelToplam },
      },
      cihazId,
      zaman,
    );
  });

  const detay = satisDetayi(vt, satisId);
  if (!detay) throw new Error('Satış yazıldı ancak geri okunamadı');

  baglam.kayit.bilgi('Satış kesinleşti', {
    satis_id: satisId,
    fis_no: detay.satis.fis_no,
    genel_toplam: hesap.genelToplam,
    kalem_sayisi: kalemler.length,
  });

  return {
    satisId,
    fisNo: detay.satis.fis_no,
    genelToplam: hesap.genelToplam,
    paraUstu: odemeSonucu.paraUstu,
    detay,
    uyarilar,
  };
}

function vadeTarihiHesapla(baglam: Baglam, cariId: string, zaman: string): string | null {
  const cari = cariBul(baglam.vt, cariId);
  if (!cari || cari.vade_gun <= 0) return null;
  return new Date(Date.parse(zaman) + cari.vade_gun * 86400000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// İptal (§10.3)
// ---------------------------------------------------------------------------

export function satisIptal(baglam: Baglam, aktor: Aktor, satisId: string, neden: string): void {
  yetkiIste(aktor, 'satis.iptal');
  const { vt, cihazId } = baglam;
  const zaman = simdi();

  const satis = satisBul(vt, satisId);
  if (!satis) throw hatalar.bulunamadi('Satış');
  if (satis.iptal_mi) throw hatalar.isKurali(HATA_KODU.SATIS_ZATEN_IPTAL);
  if (!neden.trim()) throw hatalar.dogrulama('İptal nedeni zorunludur.');

  const kalemler = kalemleriGetir(vt, satisId);
  const odemeler = odemeleriGetir(vt, satisId);
  const gun = gunAnahtari(satis.tarih);

  vt.islem(() => {
    const etkilenen = satisIptalIsaretle(vt, satisId, neden, zaman);
    if (etkilenen === 0) throw hatalar.isKurali(HATA_KODU.SATIS_ZATEN_IPTAL);

    let brutKar = 0;
    for (const kalem of kalemler) {
      // Stok geri alınır (ters hareket) — orijinal hareket silinmez (append-only).
      hareketEkle(
        vt,
        {
          urun_id: kalem.urun_id,
          hareket_tipi: 'DUZELTME',
          miktar: kalem.miktar,
          birim_maliyet: kalem.birim_maliyet,
          belge_id: satisId,
          belge_tipi: 'SATIS_IPTAL',
          aciklama: `Satış iptali: ${neden}`,
          kullanici_id: aktor.kullaniciId,
        },
        cihazId,
        zaman,
      );
      const maliyet = Math.round((kalem.miktar * kalem.birim_maliyet) / 1000);
      const satirKar = kalem.satir_toplam - kalem.kdv_tutar - maliyet;
      brutKar += satirKar;
      urunOzetEkle(vt, kalem.urun_id, gun, cihazId, { adet: -kalem.miktar, ciro: -kalem.satir_toplam, kar: -satirKar }, zaman);
    }

    let nakit = 0;
    let kart = 0;
    let veresiye = 0;
    for (const odeme of odemeler) {
      if (odeme.odeme_tipi === 'NAKIT') {
        nakit += odeme.tutar;
        if (satis.kasa_oturum_id) {
          kasaHareketEkle(
            vt,
            {
              kasa_oturum_id: satis.kasa_oturum_id,
              tip: 'IADE_NAKIT',
              tutar: -odeme.tutar,
              belge_id: satisId,
              aciklama: `Satış iptali ${satis.fis_no}`,
              kullanici_id: aktor.kullaniciId,
            },
            cihazId,
            zaman,
          );
        }
      } else if (odeme.odeme_tipi === 'KART') {
        kart += odeme.tutar;
        if (satis.kasa_oturum_id) {
          kasaHareketEkle(
            vt,
            {
              kasa_oturum_id: satis.kasa_oturum_id,
              tip: 'SATIS_KART',
              tutar: -odeme.tutar,
              belge_id: satisId,
              aciklama: `Satış iptali ${satis.fis_no}`,
              kullanici_id: aktor.kullaniciId,
            },
            cihazId,
            zaman,
          );
        }
      } else if (satis.musteri_id) {
        veresiye += odeme.tutar;
        cariHareketEkle(
          vt,
          {
            cari_id: satis.musteri_id,
            hareket_tipi: 'DUZELTME',
            tutar: -odeme.tutar,
            aciklama: `Satış iptali ${satis.fis_no}`,
            belge_id: satisId,
            belge_tipi: 'SATIS_IPTAL',
            kullanici_id: aktor.kullaniciId,
          },
          cihazId,
          zaman,
        );
      }
    }

    gunlukOzetEkle(
      vt,
      gun,
      cihazId,
      {
        ciro: -satis.genel_toplam,
        iptal_toplam: satis.genel_toplam,
        islem_sayisi: -1,
        nakit: -nakit,
        kart: -kart,
        veresiye: -veresiye,
        brut_kar: -brutKar,
        kdv_toplam: -satis.kdv_toplam,
      },
      zaman,
    );

    olayYaz(
      vt,
      {
        id: uuid(),
        olay_tipi: 'SATIS_IPTAL_EDILDI',
        entity: 'satis',
        entity_id: satisId,
        veri: { id: satisId, fis_no: satis.fis_no, neden, iptal_zamani: zaman, kullanici_id: aktor.kullaniciId },
        olusturma_zamani: zaman,
      },
      cihazId,
      zaman,
    );

    denetimYaz(
      vt,
      {
        kullanici_id: aktor.kullaniciId,
        islem: 'SATIS_IPTAL',
        entity: 'satis',
        entity_id: satisId,
        eski_deger: { genel_toplam: satis.genel_toplam },
        yeni_deger: { neden },
      },
      cihazId,
      zaman,
    );
  });

  baglam.kayit.uyari('Satış iptal edildi', { satis_id: satisId, fis_no: satis.fis_no, neden, kullanici_id: aktor.kullaniciId });
}

// ---------------------------------------------------------------------------
// İade / değişim (§10.4)
// ---------------------------------------------------------------------------

export function iadeYap(baglam: Baglam, aktor: Aktor, hamGirdi: unknown): SatisSonucu {
  yetkiIste(aktor, 'satis.iade');
  const kasaOturumId = kasaOturumuIste(aktor);

  const ayrisim = zIadeGirdi.safeParse(hamGirdi);
  if (!ayrisim.success) {
    throw hatalar.dogrulama('İade bilgileri geçerli değil.', { sorunlar: ayrisim.error.issues.map((i) => i.message) });
  }
  const girdi: IadeGirdi = ayrisim.data;

  const { vt, cihazId } = baglam;
  const zaman = simdi();

  const kaynak = satisBul(vt, girdi.kaynak_satis_id);
  if (!kaynak) throw hatalar.bulunamadi('Orijinal satış');
  if (kaynak.iptal_mi) throw hatalar.isKurali(HATA_KODU.SATIS_ZATEN_IPTAL, 'İptal edilmiş satış iade edilemez.');
  if (kaynak.iade_mi) throw hatalar.dogrulama('İade fişi tekrar iade edilemez.');

  const kaynakKalemler = kalemleriGetir(vt, girdi.kaynak_satis_id);
  const kalemHaritasi = new Map(kaynakKalemler.map((k) => [k.id, k]));

  interface IadeSatiri {
    kaynak: (typeof kaynakKalemler)[number];
    miktar: Miktar;
    tutar: Kurus;
    kdv: Kurus;
    matrah: Kurus;
  }

  const iadeSatirlari: IadeSatiri[] = girdi.kalemler.map((istek) => {
    const kaynakKalem = kalemHaritasi.get(istek.satis_kalemi_id);
    if (!kaynakKalem) throw hatalar.bulunamadi('Satış kalemi');
    const dahaOnce = kaynakKalem.iade_edilen ?? 0;
    // `iade_edilen` negatif tutulur (iade kalemleri negatif miktarlıdır).
    const kalanIadeEdilebilir = kaynakKalem.miktar + dahaOnce;
    if (istek.miktar > kalanIadeEdilebilir) {
      throw new UygulamaHatasi(
        HATA_KODU.IADE_MIKTARI_ASILDI,
        `"${kaynakKalem.urun_adi}" için en fazla ${kalanIadeEdilebilir / 1000} birim iade edilebilir.`,
        {
          detay: { satilan: kaynakKalem.miktar, daha_once_iade: -dahaOnce, istenen: istek.miktar },
        },
      );
    }

    // Orantılı iade: satır toplamı ve KDV, iade edilen miktar oranında dağıtılır.
    const oran = istek.miktar / kaynakKalem.miktar;
    const tutar = Math.round(kaynakKalem.satir_toplam * oran);
    const kdv = Math.round(kaynakKalem.kdv_tutar * oran);
    return { kaynak: kaynakKalem, miktar: istek.miktar, tutar, kdv, matrah: tutar - kdv };
  });

  const toplamIade = iadeSatirlari.reduce((t, s) => t + s.tutar, 0);
  const toplamKdv = iadeSatirlari.reduce((t, s) => t + s.kdv, 0);
  if (toplamIade <= 0) throw hatalar.dogrulama('İade tutarı sıfır olamaz.');

  if (girdi.iade_yontemi === 'VERESIYE' && !kaynak.musteri_id) {
    throw hatalar.isKurali(HATA_KODU.VERESIYE_MUSTERI_GEREKLI, 'Cari alacağa iade için orijinal satışta müşteri olmalıdır.');
  }

  const satisId = uuid();
  const gun = gunAnahtari(zaman);

  vt.islem(() => {
    const sira = sonrakiSayac(vt, 'fis');
    const fisNo = fisNoUret(fisSerisi(vt, cihazId), sira);

    satisEkle(
      vt,
      {
        id: satisId,
        fis_no: fisNo,
        tarih: zaman,
        kullanici_id: aktor.kullaniciId,
        kasa_oturum_id: kasaOturumId,
        ara_toplam: -toplamIade,
        iskonto_toplam: 0,
        kdv_toplam: -toplamKdv,
        genel_toplam: -toplamIade,
        odeme_ozeti: girdi.iade_yontemi,
        musteri_id: kaynak.musteri_id,
        iade_mi: true,
        kaynak_satis_id: kaynak.id,
        notlar: girdi.neden,
      },
      cihazId,
      zaman,
    );

    let brutKar = 0;
    iadeSatirlari.forEach((satir, i) => {
      kalemEkle(
        vt,
        {
          satis_id: satisId,
          urun_id: satir.kaynak.urun_id,
          urun_adi: satir.kaynak.urun_adi,
          barkod: satir.kaynak.barkod,
          miktar: -satir.miktar,
          birim_tipi: satir.kaynak.birim_tipi,
          birim_fiyat: satir.kaynak.birim_fiyat,
          birim_maliyet: satir.kaynak.birim_maliyet,
          iskonto: 0,
          kdv_orani: satir.kaynak.kdv_orani,
          kdv_tutar: -satir.kdv,
          satir_toplam: -satir.tutar,
          kampanya_id: satir.kaynak.kampanya_id,
          sira: i,
        },
        cihazId,
        zaman,
      );

      // Mal geri geldi → stok girişi (pozitif).
      hareketEkle(
        vt,
        {
          urun_id: satir.kaynak.urun_id,
          hareket_tipi: 'IADE',
          miktar: satir.miktar,
          birim_maliyet: satir.kaynak.birim_maliyet,
          belge_id: satisId,
          belge_tipi: 'IADE',
          aciklama: girdi.neden,
          kullanici_id: aktor.kullaniciId,
        },
        cihazId,
        zaman,
      );

      const maliyet = Math.round((satir.miktar * satir.kaynak.birim_maliyet) / 1000);
      const satirKar = satir.matrah - maliyet;
      brutKar -= satirKar;
      urunOzetEkle(vt, satir.kaynak.urun_id, gun, cihazId, { adet: -satir.miktar, ciro: -satir.tutar, kar: -satirKar }, zaman);
    });

    odemeEkle(
      vt,
      { satis_id: satisId, odeme_tipi: girdi.iade_yontemi, tutar: -toplamIade, alinan: 0, para_ustu: 0 },
      cihazId,
      zaman,
    );

    const ozetDelta = { iade_toplam: toplamIade, brut_kar: brutKar, kdv_toplam: -toplamKdv, nakit: 0, kart: 0, veresiye: 0 };
    if (girdi.iade_yontemi === 'NAKIT') {
      ozetDelta.nakit = -toplamIade;
      kasaHareketEkle(
        vt,
        {
          kasa_oturum_id: kasaOturumId,
          tip: 'IADE_NAKIT',
          tutar: -toplamIade,
          belge_id: satisId,
          aciklama: `İade ${fisNo}`,
          kullanici_id: aktor.kullaniciId,
        },
        cihazId,
        zaman,
      );
    } else if (girdi.iade_yontemi === 'KART') {
      ozetDelta.kart = -toplamIade;
      kasaHareketEkle(
        vt,
        {
          kasa_oturum_id: kasaOturumId,
          tip: 'SATIS_KART',
          tutar: -toplamIade,
          belge_id: satisId,
          aciklama: `İade ${fisNo}`,
          kullanici_id: aktor.kullaniciId,
        },
        cihazId,
        zaman,
      );
    } else {
      ozetDelta.veresiye = -toplamIade;
      cariHareketEkle(
        vt,
        {
          cari_id: kaynak.musteri_id as string,
          hareket_tipi: 'IADE',
          tutar: -toplamIade,
          aciklama: `İade ${fisNo}: ${girdi.neden}`,
          belge_id: satisId,
          belge_tipi: 'IADE',
          kullanici_id: aktor.kullaniciId,
        },
        cihazId,
        zaman,
      );
    }

    gunlukOzetEkle(vt, gun, cihazId, ozetDelta, zaman);

    olayYaz(
      vt,
      {
        id: uuid(),
        olay_tipi: 'IADE_YAPILDI',
        entity: 'satis',
        entity_id: satisId,
        /*
         * İade olayı satış olayı kadar EKSİKSİZ gider. Eskiden yalnız kimlik,
         * miktar ve tutar gidiyordu: bulutta iade fişi müşterisiz (panel
         * Barış'ın iadesini Barış'a bağlayamıyordu), tarihsiz (çevrimdışı
         * yapılan iade senkron gününe yazılıyordu) ve ürün adları boş kalıyordu.
         */
        veri: {
          id: satisId,
          fis_no: fisNo,
          tarih: zaman,
          kaynak_satis_id: kaynak.id,
          musteri_id: kaynak.musteri_id,
          kasa_oturum_id: kasaOturumId,
          ara_toplam: -toplamIade,
          iskonto_toplam: 0,
          kdv_toplam: -toplamKdv,
          genel_toplam: -toplamIade,
          brut_kar: brutKar,
          iade_yontemi: girdi.iade_yontemi,
          neden: girdi.neden,
          kullanici_id: aktor.kullaniciId,
          kasiyer_adi: aktor.ad,
          kalemler: iadeSatirlari.map((s) => ({
            urun_id: s.kaynak.urun_id,
            urun_adi: s.kaynak.urun_adi,
            barkod: s.kaynak.barkod,
            miktar: -s.miktar,
            birim_fiyat: s.kaynak.birim_fiyat,
            birim_maliyet: s.kaynak.birim_maliyet,
            iskonto: 0,
            kdv_orani: s.kaynak.kdv_orani,
            kdv_tutar: -s.kdv,
            satir_toplam: -s.tutar,
          })),
          odemeler: [{ tip: girdi.iade_yontemi, tutar: -toplamIade }],
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
        islem: 'IADE',
        entity: 'satis',
        entity_id: satisId,
        yeni_deger: { kaynak: kaynak.fis_no, tutar: toplamIade, neden: girdi.neden },
      },
      cihazId,
      zaman,
    );
  });

  const detay = satisDetayi(vt, satisId);
  if (!detay) throw new Error('İade yazıldı ancak geri okunamadı');

  baglam.kayit.bilgi('İade yapıldı', { satis_id: satisId, kaynak: kaynak.fis_no, tutar: toplamIade });

  return { satisId, fisNo: detay.satis.fis_no, genelToplam: -toplamIade, paraUstu: 0, detay, uyarilar: [] };
}
