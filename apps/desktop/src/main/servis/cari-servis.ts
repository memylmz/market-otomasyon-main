/**
 * Cari servisi — tahsilat, ödeme, kart yönetimi, KVKK işlemleri (§10.7, §16.2).
 */

import { hatalar, paraFormat, simdi, uuid, zTahsilatGirdi, type Kurus } from '@market/shared';
import {
  bakiyeOku,
  cariAnonimlestir,
  cariBul,
  cariHareketEkle,
  cariKaydet as cariKaydetDepo,
  cariVerisiniDisaAktar,
  type CariYazma,
} from '../depo/cari.js';
import { kasaHareketEkle } from '../depo/kasa.js';
import { denetimYaz, gunlukOzetEkle } from '../depo/ozet.js';
import { olayYaz } from '../depo/senkron.js';
import { gunAnahtari } from '@market/shared';
import { kasaOturumuIste, yetkiIste, type Aktor, type Baglam } from './baglam.js';

export interface TahsilatSonucu {
  hareketId: string;
  yeniBakiye: Kurus;
}

/**
 * Müşteriden tahsilat / tedarikçiye ödeme.
 * Nakit ise kasaya da yansır — tek transaction (§10.7 "kasa entegre").
 */
/**
 * Yanlış girilen tahsilatı / tedarikçi ödemesini geri alır (§10.7).
 *
 * SİLMEZ, TERS KAYIT YAZAR. `cari_hareketler` değiştirilemez bir defterdir
 * (trigger ile korunur) ve öyle olmalıdır: müşterinin borcu, sonradan
 * düzenlenebilen bir sayı değil, hareketlerin toplamıdır. Bu yüzden düzeltme
 * "kaydı bul ve değiştir" değil, "aynı tutarı ters yönde yaz"dır — ekstrede
 * hem yanlış tahsilat hem düzeltmesi görünür, ikisi de izlenebilir kalır.
 *
 * Nakit tahsilat kasayı da etkilediği için ters kasa hareketi de yazılır:
 * para fiziksel olarak geri verilir. Orijinalin nakit olup olmadığı, ona bağlı
 * bir kasa hareketi bulunup bulunmadığından anlaşılır.
 */
export function tahsilatIptal(baglam: Baglam, aktor: Aktor, hareketId: string, neden: string): { yeniBakiye: Kurus } {
  yetkiIste(aktor, 'cari.tahsilat');
  if (!neden.trim()) throw hatalar.dogrulama('İptal nedeni zorunludur.');

  const { vt, cihazId } = baglam;
  const zaman = simdi();

  const orijinal = vt
    .hazirla('SELECT id, cari_id, hareket_tipi, tutar, belge_tipi FROM cari_hareketler WHERE id = ?')
    .tek<{ id: string; cari_id: string; hareket_tipi: string; tutar: number; belge_tipi: string | null }>(hareketId);
  if (!orijinal) throw hatalar.bulunamadi('Cari hareketi');
  if (orijinal.hareket_tipi !== 'TAHSILAT' && orijinal.hareket_tipi !== 'ODEME') {
    throw hatalar.dogrulama('Yalnız tahsilat ve tedarikçi ödemesi iptal edilebilir.');
  }

  // Aynı hareket iki kez iptal edilirse bakiye iki kat düzelir.
  const oncekiIptal = vt
    .hazirla("SELECT id FROM cari_hareketler WHERE belge_id = ? AND belge_tipi = 'TAHSILAT_IPTAL'")
    .tek<{ id: string }>(hareketId);
  if (oncekiIptal) throw hatalar.isKurali('CAKISMA', 'Bu tahsilat zaten iptal edilmiş.');

  const cari = cariBul(vt, orijinal.cari_id);
  if (!cari) throw hatalar.bulunamadi('Cari hesap');

  // Orijinale bağlı kasa hareketi varsa tahsilat NAKİTTİ; para geri çıkmalı.
  const kasaHareketi = vt
    .hazirla('SELECT tip, tutar FROM kasa_hareketleri WHERE belge_id = ?')
    .tek<{ tip: string; tutar: number }>(hareketId);

  vt.islem(() => {
    const tersId = cariHareketEkle(
      vt,
      {
        cari_id: orijinal.cari_id,
        hareket_tipi: 'DUZELTME',
        tutar: -orijinal.tutar,
        aciklama: `Tahsilat iptali: ${neden.trim()}`,
        belge_id: hareketId,
        belge_tipi: 'TAHSILAT_IPTAL',
        kullanici_id: aktor.kullaniciId,
      },
      cihazId,
      zaman,
    );

    if (kasaHareketi) {
      const kasaOturumId = kasaOturumuIste(aktor);
      kasaHareketEkle(
        vt,
        {
          kasa_oturum_id: kasaOturumId,
          tip: kasaHareketi.tip as 'TAHSILAT' | 'ODEME',
          tutar: -kasaHareketi.tutar,
          aciklama: `${cari.ad_unvan} — tahsilat iptali`,
          belge_id: tersId,
          kullanici_id: aktor.kullaniciId,
        },
        cihazId,
        zaman,
      );
      gunlukOzetEkle(vt, gunAnahtari(zaman), cihazId, { tahsilat: -kasaHareketi.tutar, nakit: -kasaHareketi.tutar }, zaman);
    }

    olayYaz(
      vt,
      {
        id: uuid(),
        olay_tipi: 'CARI_HAREKETI',
        entity: 'cari_hareketi',
        entity_id: tersId,
        veri: {
          id: tersId,
          cari_id: orijinal.cari_id,
          hareket_tipi: 'DUZELTME',
          tutar: -orijinal.tutar,
          belge_id: hareketId,
          belge_tipi: 'TAHSILAT_IPTAL',
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
        islem: 'TAHSILAT_IPTAL',
        entity: 'cari_hareketi',
        entity_id: hareketId,
        eski_deger: { tutar: orijinal.tutar, hareket_tipi: orijinal.hareket_tipi },
        yeni_deger: { neden: neden.trim(), ters_hareket: tersId, nakit_iade: Boolean(kasaHareketi) },
      },
      cihazId,
      zaman,
    );
  });

  return { yeniBakiye: bakiyeOku(vt, orijinal.cari_id) };
}

export function tahsilatYap(baglam: Baglam, aktor: Aktor, hamGirdi: unknown): TahsilatSonucu {
  yetkiIste(aktor, 'cari.tahsilat');
  const ayrisim = zTahsilatGirdi.safeParse(hamGirdi);
  if (!ayrisim.success) throw hatalar.dogrulama('Tahsilat bilgileri geçerli değil.');
  const girdi = ayrisim.data;

  const { vt, cihazId } = baglam;
  const zaman = simdi();
  const cari = cariBul(vt, girdi.cari_id);
  if (!cari) throw hatalar.bulunamadi('Cari hesap');

  /*
   * BORÇTAN FAZLA TAHSİLAT KURALI (§10.7) — burada, serviste durur.
   *
   * Eskiden kural yalnız arayüzdeydi ve İKİ EKRAN ÇELİŞİYORDU: satış ekranı
   * fazla tutarı sert biçimde engelliyor, Cari ekranı yalnız uyarıp kabul
   * ediyordu; servis ise hiçbir sınır tanımıyordu. Kararın tek sahibi servistir,
   * böylece hangi ekrandan gelinirse gelinsin sonuç aynı olur.
   *
   * Varsayılan davranış PARA ÜSTÜDÜR: arayüz borç kadarını gönderir, farkı
   * müşteriye geri verir. Fazlanın hesapta alacak olarak kalması bilinçli bir
   * karardır ve `avans_kabul` ile açıkça istenmelidir.
   */
  if (girdi.tutar > cari.bakiye && !girdi.avans_kabul) {
    const kalan = Math.max(0, cari.bakiye);
    throw hatalar.dogrulama(
      kalan > 0
        ? `Tutar borçtan fazla. Güncel borç ${paraFormat(kalan)}; fazlasını avans olarak bırakmak için onay gerekir.`
        : `${cari.ad_unvan} hesabında borç yok. Peşin para almak için avans onayı gerekir.`,
    );
  }

  const musteriMi = cari.tip === 'MUSTERI';
  // Müşteriden tahsilat borcu azaltır (−); tedarikçiye ödeme de borcumuzu azaltır (−).
  const hareketTipi = musteriMi ? 'TAHSILAT' : 'ODEME';
  const kasaTipi = musteriMi ? 'TAHSILAT' : 'ODEME';
  // Kasaya giren/çıkan: tahsilatta para girer (+), tedarikçi ödemesinde çıkar (−).
  const kasaTutari = musteriMi ? girdi.tutar : -girdi.tutar;

  let hareketId = '';
  vt.islem(() => {
    hareketId = cariHareketEkle(
      vt,
      {
        cari_id: girdi.cari_id,
        hareket_tipi: hareketTipi,
        tutar: -girdi.tutar,
        aciklama: girdi.aciklama ?? (musteriMi ? 'Tahsilat' : 'Tedarikçi ödemesi'),
        belge_tipi: hareketTipi,
        kullanici_id: aktor.kullaniciId,
      },
      cihazId,
      zaman,
    );

    if (girdi.odeme_tipi === 'NAKIT') {
      const kasaOturumId = kasaOturumuIste(aktor);
      kasaHareketEkle(
        vt,
        {
          kasa_oturum_id: kasaOturumId,
          tip: kasaTipi,
          tutar: kasaTutari,
          aciklama: `${cari.ad_unvan} — ${hareketTipi}`,
          belge_id: hareketId,
          kullanici_id: aktor.kullaniciId,
        },
        cihazId,
        zaman,
      );
      gunlukOzetEkle(vt, gunAnahtari(zaman), cihazId, { tahsilat: kasaTutari, nakit: kasaTutari }, zaman);
    }

    olayYaz(
      vt,
      {
        id: uuid(),
        olay_tipi: 'CARI_HAREKETI',
        entity: 'cari_hareketi',
        entity_id: hareketId,
        veri: {
          id: hareketId,
          cari_id: girdi.cari_id,
          hareket_tipi: hareketTipi,
          tutar: -girdi.tutar,
          odeme_tipi: girdi.odeme_tipi,
          tarih: zaman,
          kullanici_id: aktor.kullaniciId,
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
        islem: hareketTipi,
        entity: 'cari',
        entity_id: girdi.cari_id,
        yeni_deger: { tutar: girdi.tutar, odeme_tipi: girdi.odeme_tipi },
      },
      cihazId,
      zaman,
    );
  });

  const guncel = cariBul(vt, girdi.cari_id);
  baglam.kayit.bilgi('Cari tahsilat/ödeme', { cari_id: girdi.cari_id, tutar: girdi.tutar, tip: hareketTipi });
  return { hareketId, yeniBakiye: guncel?.bakiye ?? 0 };
}

export function cariKaydet(baglam: Baglam, aktor: Aktor, girdi: CariYazma): string {
  yetkiIste(aktor, 'cari.duzenle');
  if (!girdi.ad_unvan?.trim()) throw hatalar.dogrulama('Ad / unvan zorunludur.');

  const { vt, cihazId } = baglam;
  const zaman = simdi();
  const oncesi = girdi.id ? cariBul(vt, girdi.id) : null;

  let id = '';
  vt.islem(() => {
    id = cariKaydetDepo(vt, girdi, cihazId, zaman);
    const kayit = cariBul(vt, id);
    olayYaz(
      vt,
      {
        id: uuid(),
        olay_tipi: 'CARI_KAYDEDILDI',
        entity: 'cari',
        entity_id: id,
        veri: kayit ? { ...kayit, bakiye: undefined, son_hareket: undefined } : { id },
        olusturma_zamani: zaman,
      },
      cihazId,
      zaman,
    );
    denetimYaz(
      vt,
      {
        kullanici_id: aktor.kullaniciId,
        islem: oncesi ? 'CARI_GUNCELLE' : 'CARI_EKLE',
        entity: 'cari',
        entity_id: id,
        eski_deger: oncesi ? { ad_unvan: oncesi.ad_unvan, kredi_limiti: oncesi.kredi_limiti } : undefined,
        yeni_deger: { ad_unvan: girdi.ad_unvan, kredi_limiti: girdi.kredi_limiti },
      },
      cihazId,
      zaman,
    );
  });
  return id;
}

/** Açılış bakiyesi girişi (veri aktarımı / ilk kurulum). */
export function acilisBakiyesi(baglam: Baglam, aktor: Aktor, cariId: string, tutar: Kurus, aciklama = 'Açılış bakiyesi'): string {
  yetkiIste(aktor, 'cari.duzenle');
  const { vt, cihazId } = baglam;
  const zaman = simdi();
  let hareketId = '';
  vt.islem(() => {
    hareketId = cariHareketEkle(
      vt,
      { cari_id: cariId, hareket_tipi: 'ACILIS', tutar, aciklama, belge_tipi: 'ACILIS', kullanici_id: aktor.kullaniciId },
      cihazId,
      zaman,
    );
    olayYaz(
      vt,
      {
        id: uuid(),
        olay_tipi: 'CARI_HAREKETI',
        entity: 'cari_hareketi',
        entity_id: hareketId,
        veri: { id: hareketId, cari_id: cariId, hareket_tipi: 'ACILIS', tutar, tarih: zaman },
        olusturma_zamani: zaman,
      },
      cihazId,
      zaman,
    );
  });
  return hareketId;
}

/** Cari bakiye düzeltmesi — yetkili işlemi, nedeni zorunlu. */
export function bakiyeDuzelt(baglam: Baglam, aktor: Aktor, cariId: string, fark: Kurus, neden: string): string {
  yetkiIste(aktor, 'cari.duzenle');
  if (!neden.trim()) throw hatalar.dogrulama('Düzeltme nedeni zorunludur.');
  const { vt, cihazId } = baglam;
  const zaman = simdi();
  let hareketId = '';
  vt.islem(() => {
    hareketId = cariHareketEkle(
      vt,
      {
        cari_id: cariId,
        hareket_tipi: 'DUZELTME',
        tutar: fark,
        aciklama: neden,
        belge_tipi: 'DUZELTME',
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
        entity_id: hareketId,
        veri: { id: hareketId, cari_id: cariId, hareket_tipi: 'DUZELTME', tutar: fark, aciklama: neden, tarih: zaman },
        olusturma_zamani: zaman,
      },
      cihazId,
      zaman,
    );
    denetimYaz(
      vt,
      { kullanici_id: aktor.kullaniciId, islem: 'CARI_DUZELTME', entity: 'cari', entity_id: cariId, yeni_deger: { fark, neden } },
      cihazId,
      zaman,
    );
  });
  return hareketId;
}

// ---------------------------------------------------------------------------
// KVKK (§16.2)
// ---------------------------------------------------------------------------

/**
 * Veri sahibinin silme talebi. Mali kayıt bütünlüğü korunarak yalnız kişisel
 * alanlar maskelenir; hareketler ve tutarlar VUK saklama süresince kalır (§17.5).
 */
export function kvkkAnonimlestir(baglam: Baglam, aktor: Aktor, cariId: string, gerekce: string): void {
  yetkiIste(aktor, 'cari.kvkk_islem');
  const { vt, cihazId } = baglam;
  const zaman = simdi();
  const cari = cariBul(vt, cariId);
  if (!cari) throw hatalar.bulunamadi('Cari hesap');

  vt.islem(() => {
    cariAnonimlestir(vt, cariId, cihazId, zaman);
    olayYaz(
      vt,
      {
        id: uuid(),
        olay_tipi: 'CARI_KAYDEDILDI',
        entity: 'cari',
        entity_id: cariId,
        veri: { id: cariId, anonimlestirildi_mi: true, updated_at: zaman },
        olusturma_zamani: zaman,
      },
      cihazId,
      zaman,
    );
    denetimYaz(
      vt,
      {
        kullanici_id: aktor.kullaniciId,
        islem: 'KVKK_ANONIMLESTIRME',
        entity: 'cari',
        entity_id: cariId,
        yeni_deger: { gerekce },
      },
      cihazId,
      zaman,
    );
  });

  baglam.kayit.bilgi('KVKK anonimleştirme uygulandı', { cari_id: cariId, kullanici_id: aktor.kullaniciId });
}

/** Veri taşınabilirliği talebi — kişisel veri + hareket dökümü. */
export function kvkkDisaAktar(baglam: Baglam, aktor: Aktor, cariId: string): ReturnType<typeof cariVerisiniDisaAktar> {
  yetkiIste(aktor, 'cari.kvkk_islem');
  denetimYaz(
    baglam.vt,
    { kullanici_id: aktor.kullaniciId, islem: 'KVKK_DISA_AKTARIM', entity: 'cari', entity_id: cariId },
    baglam.cihazId,
  );
  return cariVerisiniDisaAktar(baglam.vt, cariId);
}
