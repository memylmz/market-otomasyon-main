/**
 * Stok servisi — mal kabul, fire, sayım, düzeltme (§10.6).
 *
 * Her stok değişikliği bir hareket satırıdır; miktar hiçbir zaman doğrudan
 * yazılmaz. Mal kabul onayı ayrıca tedarikçiye cari borç oluşturur.
 */

import {
  gunAnahtari,
  hatalar,
  kdvAyir,
  simdi,
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
import { urunBul, urunKaydet } from '../depo/katalog.js';
import { denetimYaz, gunlukOzetEkle } from '../depo/ozet.js';
import { alisFaturasiEkle, alisKalemiEkle } from '../depo/satis.js';
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
  olayYaz(
    baglam.vt,
    {
      id: uuid(),
      olay_tipi: 'STOK_HAREKETI',
      entity: 'stok_hareketi',
      entity_id: hareketId,
      veri: { id: hareketId, urun_id: urunId, hareket_tipi: tip, miktar, kullanici_id: aktor.kullaniciId, created_at: zaman },
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

    for (const kalem of hesaplananlar) {
      const urun = urunBul(vt, kalem.urun_id);
      if (!urun) throw hatalar.bulunamadi('Ürün');

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
          kalemler: hesaplananlar.map((k) => ({ urun_id: k.urun_id, miktar: k.miktar, birim_fiyat: k.birim_fiyat })),
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
