/**
 * IPC kanal tanımları — arayüzün ana sürece açılan tek kapısı.
 *
 * Güvenlik ilkesi (§15.4): Her kanal ana süreçte yetki denetimi yapar; arayüzdeki
 * gizleme yalnız kullanıcı deneyimi içindir. Renderer'a Node erişimi verilmez,
 * yalnız bu beyaz listedeki kanallar çağrılabilir.
 */

import {
  bugun,
  gunBasi,
  gunEkle,
  gunSonu as gunSonuDamgasi,
  hatalar,
  merkeziAyarMi,
  simdi,
  uuid,
  type GunAnahtari,
  type Kurus,
  type Miktar,
  type Yetki,
} from '@market/shared';
import { ayarMetin, ayarYaz, elleYazilabilirMi, tumAyarlar } from '../depo/ayar.js';
import { carileriListele, cariBul, ekstre } from '../depo/cari.js';
import {
  etkinKampanyalar,
  fiyatiDegisenler,
  kampanyalariListele,
  kampanyaKaydet,
  kategoriBul,
  kategorileriListele,
  kategoriKaydet,
} from '../depo/katalog.js';
import { denetimListele, denetimYaz } from '../depo/ozet.js';
import {
  askidakileriListele,
  askidakiSil,
  askiyaAl,
  sepetleriOku,
  sepetleriSakla,
  sepetleriUnut,
  satisDetayi,
  satislariListele,
  alisFaturasiBul,
  alisFaturalariniListele,
  alisKalemleriniGetir,
  musteriAlisverisleri,
} from '../depo/satis.js';
import { cakismalariListele, kaliciHataliOlaylar, olayYaz } from '../depo/senkron.js';
import { acikSayim, hareketleriListele, sayimFarklari } from '../depo/stok.js';
import { pinGucunuDenetle, sifreGucunuDenetle } from '../guvenlik/parola.js';
import { mutabakatYap, senkronCalistir, senkronDurumu } from '../senkron/motor.js';
import { bekleyenAlisTalimatlariniIsle } from '../servis/alis-talimat-servis.js';
import { bekleyenCariTalimatlariniIsle } from '../servis/cari-talimat-servis.js';
import { bekleyenIadeleriIsle } from '../servis/iade-talimat-servis.js';
import { ayarlariOku } from '../servis/baglam.js';
import {
  acilisBakiyesi,
  bakiyeDuzelt,
  cariKaydet,
  kvkkAnonimlestir,
  kvkkDisaAktar,
  tahsilatIptal,
  tahsilatYap,
} from '../servis/cari-servis.js';
import { gunSonu, kasaAc, kasaDurumu, kasaHareketi, vardiyaRaporu } from '../servis/kasa-servis.js';
import {
  barkodOku,
  barkoduKaldir,
  icBarkodOlustur,
  kisaKodOner,
  topluFiyatIslemi,
  urunArama,
  urunDetayi,
  urunleriDisaAktar,
  urunleriIceAktar,
  urunListesi,
  urunuKaydet,
  urunuPasiflestir,
  muhtelifUrunu,
  kategoriSil,
} from '../servis/katalog-servis.js';
import { cihaziAktiveEt, cevrimdisiAktivasyon, cihazTokeniOku, lisansDurumu } from '../servis/lisans-servis.js';
import { cikisYap, girisYap, hizliKullanicilar, yetkiliOnayi } from '../servis/oturum-servis.js';
import {
  bugunOzeti,
  cariRaporu,
  gunlukRapor,
  kasaGecmisi,
  panoOzeti,
  saatlikDagilim,
  stokDevirHizi,
  stokRaporu,
  suistimalRaporu,
  urunRaporu,
} from '../servis/rapor-servis.js';
import { iadeYap, satisIptal, satisKesinlestir } from '../servis/satis-servis.js';
import {
  fireCikisi,
  alisFaturasiGuncelle,
  alisFaturasiIptal,
  malKabulOnayla,
  sayimBaslat,
  sayimIptal,
  sayimSatiriGir,
  sayimTamamla,
  stokDuzeltme,
  stokGirisi,
  tedarikciIade,
} from '../servis/stok-servis.js';
import {
  cariEkstresiYazdir,
  cekmeceyiAc,
  etiketKalibrasyonu,
  etiketOnizlemesi,
  fisOnizlemesi,
  kalibrasyonOnizlemesi,
  etiketKuyruguYazdir,
  etiketOlcusunuOku,
  etiketYaziciAyariniOku,
  etiketYazdir,
  gunSonuFisiYazdir,
  satisFisiYazdir,
  yazdirilamayanFisler,
  yaziciTesti,
} from '../servis/yazdirma-servis.js';
import { yedekAl, yedegiDogrula, yedekleriListele, yedektenGeriYukle } from '../servis/yedek-servis.js';
import type { Uygulama } from '../uygulama.js';

export type KanalIsleyici = (girdi: never) => unknown | Promise<unknown>;

/** Tarih aralığı girdisini normalize eder (varsayılan: bugün). */
function araligiCoz(girdi: { from?: GunAnahtari; to?: GunAnahtari } | undefined): { from: GunAnahtari; to: GunAnahtari } {
  const to = girdi?.to ?? bugun();
  const from = girdi?.from ?? to;
  if (from > to) throw hatalar.dogrulama('Başlangıç tarihi bitiş tarihinden sonra olamaz.');
  return { from, to };
}

export function kanallariOlustur(uygulama: Uygulama, pencereGetir?: () => import('electron').BrowserWindow | null) {
  const b = () => uygulama.baglam;
  const a = () => uygulama.aktoruIste();

  /**
   * Fişi arka planda yazdırır ve sonucu olayla bildirir.
   *
   * NEDEN BEKLENMİYOR: Satış zaten veritabanına kesinleşmiş olarak yazıldı.
   * Yanıtı yazıcıya bağlamak, ağ yazıcısı yavaş ya da kapalıysa kasiyeri
   * saniyelerce ekran başında bekletir — ölçümlerde tek bir iadenin 3,3 sn
   * sürmesinin sebebi buydu. Kasa hiçbir çevresel aygıta bağımlı olmamalı (§20).
   */
  function fisiArkaPlandaYazdir(satisId: string, fisNo: string, zorla?: boolean): void {
    // `zorla` verilmezse ayar karar verir (bugünkü davranış — ödeme penceresi
    // böyle çalışır). F4 true, F5 false gönderir: kasiyer tek tuşla fişli ya da
    // fişsiz satış yapabilsin diye (§10.3).
    const yazdirilsin = zorla ?? ayarlariOku(b()).otomatikFis;
    if (!yazdirilsin) return;

    void satisFisiYazdir(b(), satisId)
      .then((sonuc) => {
        uygulama.olayYayinla('fis:yazdirma', {
          satisId,
          fisNo,
          basarili: sonuc.basarili,
          hata: sonuc.hata ?? null,
          onizleme: sonuc.onizleme ?? null,
        });
      })
      .catch((hata: unknown) => {
        uygulama.olayYayinla('fis:yazdirma', {
          satisId,
          fisNo,
          basarili: false,
          hata: hata instanceof Error ? hata.message : String(hata),
          onizleme: null,
        });
      });
  }

  return {
    // ---------------------------------------------------------------- sistem
    'sistem.durum': () => {
      const ayarlar = ayarlariOku(b());
      const senkronAcik = Boolean(ayarlar.senkronUrl);
      return {
        cihazId: uygulama.cihazId,
        surum: '2.0.0',
        kurulumGerekli: uygulama.kurulumGerekliMi(),
        oturum: uygulama.aktor
          ? {
              kullaniciId: uygulama.aktor.kullaniciId,
              ad: uygulama.aktor.ad,
              rol: uygulama.aktor.rol,
              yetkiler: [...uygulama.aktor.yetkiler],
              kasaOturumId: uygulama.aktor.kasaOturumId,
            }
          : null,
        senkron: senkronDurumu(b(), senkronAcik),
        lisans: lisansDurumu(b()),
        ayarlar,
      };
    },

    'kurulum.tamamla': (girdi: {
      isletmeAdi: string;
      adres?: string;
      telefon?: string;
      vergiNo?: string;
      varsayilanKdv?: number;
      yonetici: { ad: string; kullaniciAdi: string; sifre: string; pin?: string };
    }) => {
      if (!uygulama.kurulumGerekliMi()) throw hatalar.dogrulama('Kurulum zaten tamamlanmış.');
      const sifreKontrol = sifreGucunuDenetle(girdi.yonetici.sifre);
      if (!sifreKontrol.gecerli) throw hatalar.dogrulama(sifreKontrol.sorunlar.join(' '));
      if (girdi.yonetici.pin) {
        const pinKontrol = pinGucunuDenetle(girdi.yonetici.pin);
        if (!pinKontrol.gecerli) throw hatalar.dogrulama(pinKontrol.sorunlar.join(' '));
      }

      const kullaniciId = uygulama.yoneticiOlustur(girdi.yonetici);
      const { vt } = b();
      vt.islem(() => {
        ayarYaz(vt, 'isletme.ad', girdi.isletmeAdi);
        if (girdi.adres) ayarYaz(vt, 'isletme.adres', girdi.adres);
        if (girdi.telefon) ayarYaz(vt, 'isletme.telefon', girdi.telefon);
        if (girdi.vergiNo) ayarYaz(vt, 'isletme.vergi_no', girdi.vergiNo);
        if (girdi.varsayilanKdv !== undefined) ayarYaz(vt, 'kdv.varsayilan', String(girdi.varsayilanKdv));
        ayarYaz(vt, 'kurulum.tamamlandi', '1');
      });
      uygulama.kayit.bilgi('Kurulum tamamlandı', { isletme: girdi.isletmeAdi, kullanici_id: kullaniciId });
      return { kullaniciId };
    },

    // ---------------------------------------------------------------- oturum
    'oturum.giris': (girdi: { kullaniciAdi: string; parola: string; yontem?: 'SIFRE' | 'PIN' }) => {
      const sonuc = girisYap(b(), girdi.kullaniciAdi, girdi.parola, girdi.yontem ?? 'SIFRE');
      uygulama.aktoruAyarla(sonuc.aktor);
      return {
        kullanici: sonuc.kullanici,
        yetkiler: [...sonuc.aktor.yetkiler],
        kasaOturumId: sonuc.kasaOturumId,
      };
    },

    'oturum.cikis': () => {
      const aktor = uygulama.aktor;
      if (aktor) cikisYap(b(), aktor);
      uygulama.aktoruAyarla(null);
      return { basarili: true };
    },

    'oturum.hizliKullanicilar': () => hizliKullanicilar(b()),

    'oturum.yetkiliOnayi': (girdi: { kullaniciAdi: string; pin: string; yetki: Yetki }) => {
      // Onay geçici bir aktör üretir; oturumu DEĞİŞTİRMEZ.
      const onaylayan = yetkiliOnayi(b(), girdi.kullaniciAdi, girdi.pin, girdi.yetki);
      return { onaylandi: true, kullaniciId: onaylayan.kullaniciId, ad: onaylayan.ad };
    },

    // ------------------------------------------------------------------ ürün
    'urun.barkodOku': (girdi: { barkod: string }) => barkodOku(b(), girdi.barkod),
    'urun.ara': (girdi: { terim: string; limit?: number }) => urunArama(b(), girdi.terim, girdi.limit),
    'urun.listele': (girdi: { filtre?: Parameters<typeof urunListesi>[1]; limit?: number; ofset?: number }) =>
      urunListesi(b(), girdi?.filtre ?? {}, { limit: girdi?.limit, ofset: girdi?.ofset }),
    'urun.detay': (girdi: { urunId: string }) => urunDetayi(b(), girdi.urunId),
    // Muhtelif kalem satış yetkisiyle kullanılır; katalog düzenleme yetkisi istemez.
    'urun.muhtelif': () => muhtelifUrunu(b()),
    'urun.kaydet': (girdi: Record<string, unknown>) => ({ id: urunuKaydet(b(), a(), girdi) }),
    'urun.pasiflestir': (girdi: { urunId: string; pasif: boolean }) => {
      urunuPasiflestir(b(), a(), girdi.urunId, girdi.pasif);
      return { basarili: true };
    },
    'urun.barkodKaldir': (girdi: { barkod: string }) => {
      barkoduKaldir(b(), a(), girdi.barkod);
      return { basarili: true };
    },
    'urun.icBarkod': (girdi: { urunId: string }) => ({ barkod: icBarkodOlustur(b(), a(), girdi.urunId) }),
    // Barkodsuz ürünler için 2-4 haneli kısa kod (PLU) — kasiyer yazıp Enter'lar.
    'urun.kisaKodOner': () => ({ kod: kisaKodOner(b()) }),
    'urun.topluFiyat': (girdi: { islem: Parameters<typeof topluFiyatIslemi>[2]; uygula: boolean }) =>
      topluFiyatIslemi(b(), a(), girdi.islem, girdi.uygula),
    'urun.iceAktar': (girdi: { icerik: string; uygula: boolean }) => urunleriIceAktar(b(), a(), girdi.icerik, girdi.uygula),
    'urun.disaAktar': () => ({ icerik: urunleriDisaAktar(b()) }),
    'urun.etiketYazdir': (girdi: { urunId: string; adet?: number }) => etiketYazdir(b(), girdi.urunId, girdi.adet ?? 1),

    // ---------------------------------------------------------- etiket (§13.3)
    /** Etiket kuyruğunu tek gönderimde basar. */
    'etiket.yazdir': (girdi: { satirlar: { urunId: string; adet: number }[] }) => etiketKuyruguYazdir(b(), girdi.satirlar),
    /** Ölçü doğru mu — çerçeveli tek etiket basar. */
    'etiket.kalibrasyon': () => etiketKalibrasyonu(b()),
    /** Arayüzün yazıcı tanımlı mı diye bakabilmesi için. */
    'etiket.ayar': () => ({ yazici: etiketYaziciAyariniOku(b()), olcu: etiketOlcusunuOku(b()) }),
    /**
     * Etiket önizlemesi — yazıcıya gidecek YERLEŞİMİN aynısı.
     * Ekranda çizilen ile kağıda basılan tek hesaptan çıkar.
     */
    'etiket.onizleme': (girdi?: { urunId?: string; ayarlar?: Record<string, string> }) => etiketOnizlemesi(b(), girdi ?? {}),
    'etiket.kalibrasyonOnizleme': (girdi?: { ayarlar?: Record<string, string> }) => kalibrasyonOnizlemesi(b(), girdi?.ayarlar),
    /** Fiş önizlemesi — gerçek fiş baytları üretilip geri çözülür. */
    'ayar.fisOnizleme': (girdi?: { satisId?: string; ayarlar?: Record<string, string> }) => fisOnizlemesi(b(), girdi ?? {}),
    /**
     * Fiyatı değişen ürünler — kuyruğu doldurmak için.
     * Rafta yanlış fiyat kalmasın diye en çok kullanılacak yol budur.
     */
    'etiket.fiyatiDegisenler': (girdi?: { gun?: number }) =>
      fiyatiDegisenler(b().vt, gunBasi(gunEkle(bugun(), -(girdi?.gun ?? 7)))),
    /** Alış faturasındaki ürünler ve miktarları — kuyruğa hazır. */
    'etiket.faturadanDoldur': (girdi: { faturaId: string }) =>
      alisKalemleriniGetir(b().vt, girdi.faturaId).map((k) => ({
        urunId: k.urun_id,
        ad: k.urun_adi,
        // Miktar bindebir ölçekte tutulur; etiket ADET olarak basılır.
        adet: Math.max(1, Math.round(k.miktar / 1000)),
      })),

    'kategori.listele': (girdi?: { tumu?: boolean }) => kategorileriListele(b().vt, !girdi?.tumu),
    // Kullanılmayan kategori gerçekten silinir, ürünü olan pasife alınır (§10.5).
    'kategori.sil': (girdi: { kategoriId: string }) => kategoriSil(b(), a(), girdi.kategoriId),
    'kategori.kaydet': (girdi: {
      id?: string;
      ad: string;
      ust_kategori_id?: string | null;
      sira?: number;
      aktif_mi?: boolean;
    }) => {
      const aktor = a();
      if (!aktor.yetkiler.has('urun.duzenle')) throw hatalar.yetki();
      if (!girdi.ad?.trim()) throw hatalar.dogrulama('Kategori adı zorunludur.');

      const { vt } = b();
      const zaman = simdi();
      const id = vt.islem(() => {
        const kayitId = kategoriKaydet(vt, girdi, uygulama.cihazId, zaman);
        const kayit = kategoriBul(vt, kayitId);
        // Kategori çift yönlü senkronlanan bir varlıktır; outbox olayı yazılmazsa
        // panelde hiç görünmez ve diğer kasalara inmez.
        olayYaz(
          vt,
          {
            id: uuid(),
            olay_tipi: 'KATEGORI_KAYDEDILDI',
            entity: 'kategori',
            entity_id: kayitId,
            veri: kayit ?? { id: kayitId },
            olusturma_zamani: zaman,
          },
          uygulama.cihazId,
          zaman,
        );
        denetimYaz(
          vt,
          {
            kullanici_id: aktor.kullaniciId,
            islem: girdi.id ? 'KATEGORI_GUNCELLE' : 'KATEGORI_EKLE',
            entity: 'kategori',
            entity_id: kayitId,
            yeni_deger: { ad: girdi.ad },
          },
          uygulama.cihazId,
          zaman,
        );
        return kayitId;
      });
      return { id };
    },

    // ----------------------------------------------------------------- satış
    'satis.kesinlestir': (girdi: Record<string, unknown>) => {
      // `fis_yazdir` satışın bir alanı değildir; yalnız yazdırma kararını ezer.
      const { fis_yazdir: fisYazdir, ...satisGirdisi } = girdi as { fis_yazdir?: boolean };
      const sonuc = satisKesinlestir(b(), a(), satisGirdisi);
      uygulama.olayYayinla('satis:kesinlesti', { satisId: sonuc.satisId, fisNo: sonuc.fisNo });
      // Yazdırma BEKLENMEZ — sonucu olayla gelir (§20: kasa yazıcıya bağımlı değildir).
      fisiArkaPlandaYazdir(sonuc.satisId, sonuc.fisNo, fisYazdir);
      return { ...sonuc, yazdirmaBaslatildi: fisYazdir ?? ayarlariOku(b()).otomatikFis };
    },

    'satis.iptal': (girdi: { satisId: string; neden: string }) => {
      satisIptal(b(), a(), girdi.satisId, girdi.neden);
      return { basarili: true };
    },

    'satis.iade': (girdi: Record<string, unknown>) => {
      const sonuc = iadeYap(b(), a(), girdi);
      // Satışla aynı kural: iade kaydı kesin, fiş arka planda basılır.
      fisiArkaPlandaYazdir(sonuc.satisId, sonuc.fisNo);
      return { ...sonuc, yazdirmaBaslatildi: ayarlariOku(b()).otomatikFis };
    },

    'satis.listele': (girdi: { filtre?: Parameters<typeof satislariListele>[1]; limit?: number; ofset?: number }) =>
      satislariListele(b().vt, girdi?.filtre ?? {}, { limit: girdi?.limit, ofset: girdi?.ofset }),
    'satis.detay': (girdi: { satisId: string }) => satisDetayi(b().vt, girdi.satisId),
    'satis.fisYazdir': (girdi: { satisId: string; kopya?: boolean }) =>
      satisFisiYazdir(b(), girdi.satisId, { kopyaMi: girdi.kopya }),
    'satis.yazdirilamayanlar': () => yazdirilamayanFisler(b()),

    'satis.askiyaAl': (girdi: { etiket: string; veri: unknown }) => {
      const aktor = a();
      if (!aktor.yetkiler.has('satis.askiya_al')) throw hatalar.yetki();
      return { id: b().vt.islem(() => askiyaAl(b().vt, girdi.etiket, girdi.veri, aktor.kullaniciId, uygulama.cihazId)) };
    },
    'satis.askidakiler': () => askidakileriListele(b().vt),

    /*
     * Sepet kurtarma noktası (§10.3). Sepet sekmeleri yalnız bellekteydi;
     * çökmede ya da elektrik kesintisinde bekleyen sepetler kayboluyordu.
     */
    'satis.sepetleriKaydet': (girdi: { veri: unknown }) => {
      const aktor = a();
      sepetleriSakla(b().vt, aktor.kullaniciId, girdi.veri, uygulama.cihazId);
      return { basarili: true };
    },
    'satis.sepetleriOku': () => ({ veri: sepetleriOku(b().vt, a().kullaniciId) }),
    'satis.sepetleriUnut': () => {
      sepetleriUnut(b().vt, a().kullaniciId);
      return { basarili: true };
    },
    'satis.askidanSil': (girdi: { id: string }) => {
      b().vt.islem(() => askidakiSil(b().vt, girdi.id));
      return { basarili: true };
    },

    // ------------------------------------------------------------------ stok
    'stok.giris': (girdi: Record<string, unknown>) => ({ hareketId: stokGirisi(b(), a(), girdi) }),
    'stok.fire': (girdi: Record<string, unknown>) => ({ hareketId: fireCikisi(b(), a(), girdi) }),
    'stok.duzeltme': (girdi: { urunId: string; yeniMiktar: Miktar; neden: string }) => ({
      hareketId: stokDuzeltme(b(), a(), girdi.urunId, girdi.yeniMiktar, girdi.neden),
    }),
    'stok.hareketler': (girdi: {
      urunId?: string;
      belgeId?: string;
      tip?: Parameters<typeof hareketleriListele>[1]['tip'];
      from?: GunAnahtari;
      to?: GunAnahtari;
      limit?: number;
    }) =>
      hareketleriListele(
        b().vt,
        {
          urunId: girdi?.urunId,
          belgeId: girdi?.belgeId,
          tip: girdi?.tip,
          baslangic: girdi?.from ? gunBasi(girdi.from) : undefined,
          bitis: girdi?.to ? gunSonuDamgasi(girdi.to) : undefined,
        },
        girdi?.limit ?? 200,
      ),
    'stok.malKabul': (girdi: Record<string, unknown>) => malKabulOnayla(b(), a(), girdi),
    'stok.tedarikciIade': (girdi: Record<string, unknown>) => tedarikciIade(b(), a(), girdi),
    'stok.alisFaturalari': (girdi?: { tedarikciId?: string }) => alisFaturalariniListele(b().vt, girdi?.tedarikciId),
    'stok.alisFaturasi': (girdi: { faturaId: string }) => ({
      fatura: alisFaturasiBul(b().vt, girdi.faturaId),
      kalemler: alisKalemleriniGetir(b().vt, girdi.faturaId),
    }),
    'stok.alisFaturasiIptal': (girdi: { faturaId: string; neden: string }) =>
      alisFaturasiIptal(b(), a(), girdi.faturaId, girdi.neden),
    'stok.alisFaturasiGuncelle': (girdi: {
      faturaId: string;
      fatura_no?: string | null;
      vade_tarihi?: string | null;
      notlar?: string | null;
    }) => {
      alisFaturasiGuncelle(b(), a(), girdi.faturaId, girdi);
      return { basarili: true };
    },
    'stok.rapor': (girdi?: { sktGun?: number }) => stokRaporu(b(), a(), girdi?.sktGun ?? 30),

    'sayim.acik': () => acikSayim(b().vt),
    'sayim.baslat': (girdi: { ad: string }) => ({ id: sayimBaslat(b(), a(), girdi.ad) }),
    'sayim.satir': (girdi: { sayimId: string; urunId: string; sayilan: Miktar }) => {
      sayimSatiriGir(b(), a(), girdi.sayimId, girdi.urunId, girdi.sayilan);
      return { basarili: true };
    },
    'sayim.farklar': (girdi: { sayimId: string }) => sayimFarklari(b().vt, girdi.sayimId),
    'sayim.tamamla': (girdi: { sayimId: string }) => sayimTamamla(b(), a(), girdi.sayimId),
    'sayim.iptal': (girdi: { sayimId: string }) => {
      sayimIptal(b(), a(), girdi.sayimId);
      return { basarili: true };
    },

    // ------------------------------------------------------------------ cari
    'cari.listele': (girdi?: { filtre?: Parameters<typeof carileriListele>[1]; limit?: number; ofset?: number }) => {
      a();
      return carileriListele(b().vt, girdi?.filtre ?? {}, { limit: girdi?.limit, ofset: girdi?.ofset });
    },
    'cari.detay': (girdi: { cariId: string }) => {
      a();
      const cari = cariBul(b().vt, girdi.cariId);
      if (!cari) throw hatalar.bulunamadi('Cari hesap');
      return cari;
    },
    'cari.kaydet': (girdi: Parameters<typeof cariKaydet>[2]) => ({ id: cariKaydet(b(), a(), girdi) }),
    'cari.tahsilat': (girdi: Record<string, unknown>) => tahsilatYap(b(), a(), girdi),
    // Yanlış girilen tahsilat SİLİNMEZ, ters kayıtla geri alınır (§10.7).
    'cari.tahsilatIptal': (girdi: { hareketId: string; neden: string }) => tahsilatIptal(b(), a(), girdi.hareketId, girdi.neden),
    'cari.acilisBakiyesi': (girdi: { cariId: string; tutar: Kurus }) => ({
      hareketId: acilisBakiyesi(b(), a(), girdi.cariId, girdi.tutar),
    }),
    'cari.bakiyeDuzelt': (girdi: { cariId: string; fark: Kurus; neden: string }) => ({
      hareketId: bakiyeDuzelt(b(), a(), girdi.cariId, girdi.fark, girdi.neden),
    }),
    'cari.ekstre': (girdi: { cariId: string; from?: GunAnahtari; to?: GunAnahtari }) => {
      a();
      const baslangic = girdi.from ? gunBasi(girdi.from) : undefined;
      const bitis = girdi.to ? gunSonuDamgasi(girdi.to) : undefined;
      return ekstre(b().vt, girdi.cariId, baslangic, bitis);
    },
    /** Müşterinin nakit/kart/veresiye bütün alışverişleri — ekstre yalnız borcu gösterir. */
    'cari.alisverisler': (girdi: {
      cariId: string;
      durum?: 'tumu' | 'odenmis' | 'borc';
      from?: GunAnahtari;
      to?: GunAnahtari;
    }) => {
      a();
      return musteriAlisverisleri(b().vt, girdi.cariId, {
        durum: girdi.durum,
        baslangic: girdi.from ? gunBasi(girdi.from) : undefined,
        bitis: girdi.to ? gunSonuDamgasi(girdi.to) : undefined,
      });
    },
    'cari.ekstreYazdir': (girdi: { cariId: string; from?: GunAnahtari; to?: GunAnahtari }) =>
      cariEkstresiYazdir(
        b(),
        girdi.cariId,
        girdi.from ? gunBasi(girdi.from) : undefined,
        girdi.to ? gunSonuDamgasi(girdi.to) : undefined,
      ),
    'cari.rapor': () => cariRaporu(b(), a()),
    'cari.kvkkAnonimlestir': (girdi: { cariId: string; gerekce: string }) => {
      kvkkAnonimlestir(b(), a(), girdi.cariId, girdi.gerekce);
      return { basarili: true };
    },
    'cari.kvkkDisaAktar': (girdi: { cariId: string }) => kvkkDisaAktar(b(), a(), girdi.cariId),

    // ------------------------------------------------------------------ kasa
    'kasa.durum': () => kasaDurumu(b(), uygulama.aktor ?? undefined),
    'kasa.ac': (girdi: { acilisBakiye: Kurus }) => {
      const sonuc = kasaAc(b(), a(), girdi.acilisBakiye);
      uygulama.olayYayinla('kasa:acildi', sonuc);

      /*
       * Kasa kapalıyken inen iade talimatları burada uygulanır. Aktörün kasa
       * oturumu yeni oluştuğu için tazelenmiş bir aktörle çağrılır.
       */
      const yeniAktor = { ...a(), kasaOturumId: sonuc.oturumId };
      const iade = bekleyenIadeleriIsle(b(), yeniAktor);
      if (iade.uygulanan > 0) uygulama.olayYayinla('iade:uygulandi', iade);

      // Nakit tahsilat iptali de açık çekmece ister; aynı anda işlenir (§10.7).
      const cariTalimat = bekleyenCariTalimatlariniIsle(b(), yeniAktor);
      if (cariTalimat.uygulanan > 0) uygulama.olayYayinla('cari:talimatUygulandi', cariTalimat);

      // Nakit ödemeli alış faturası da açık çekmece ister (§11.8).
      const alisTalimat = bekleyenAlisTalimatlariniIsle(b(), yeniAktor);
      if (alisTalimat.uygulanan > 0) uygulama.olayYayinla('alis:talimatUygulandi', alisTalimat);

      return sonuc;
    },
    'kasa.gunSonu': async (girdi: { sayilanNakit: Kurus; notlar?: string; yazdir?: boolean }) => {
      const aktor = a();
      const oturumId = aktor.kasaOturumId;
      const sonuc = gunSonu(b(), aktor, girdi.sayilanNakit, girdi.notlar);
      uygulama.olayYayinla('kasa:kapandi', sonuc);

      let yazdirma = null;
      if (girdi.yazdir !== false && oturumId) {
        yazdirma = await gunSonuFisiYazdir(b(), aktor, oturumId).catch(() => null);
      }

      // Gün sonunda otomatik senkron denemesi (§7.5) — başarısız olsa da gün sonu geçerlidir.
      const senkronAyari = uygulama.senkronSecenekleri();
      let senkron = null;
      if (senkronAyari && ayarMetin(b().vt, 'senkron.gun_sonu', '1') === '1') {
        senkron = await senkronCalistir(b(), senkronAyari).catch(() => null);
        if (senkron) uygulama.kimlikBirlesmeleriniUygula(senkron);
      }
      return { ...sonuc, yazdirma, senkron };
    },
    /** Bekleyen panel iadeleri — kasa açılınca elle de tetiklenebilir (§10.4). */
    'satis.bekleyenIadeler': () => bekleyenIadeleriIsle(b(), a()),
    /** Bekleyen panel cari talimatları — açılış, düzeltme, tahsilat iptali (§10.7). */
    'cari.bekleyenTalimatlar': () => bekleyenCariTalimatlariniIsle(b(), a()),
    /** Bekleyen panel alış talimatları — fatura oluştur / iptal / güncelle (§11.8). */
    'stok.bekleyenAlisTalimatlari': () => bekleyenAlisTalimatlariniIsle(b(), a()),

    'kasa.hareket': (girdi: { tip: 'GIDER' | 'GIRIS' | 'CIKIS'; tutar: Kurus; aciklama: string }) => ({
      hareketId: kasaHareketi(b(), a(), girdi.tip, girdi.tutar, girdi.aciklama),
    }),
    'kasa.gecmis': (girdi?: { from?: GunAnahtari; to?: GunAnahtari }) => kasaGecmisi(b(), a(), girdi?.from, girdi?.to),
    'kasa.vardiyaRaporu': (girdi: { oturumId: string }) => vardiyaRaporu(b(), a(), girdi.oturumId),
    'kasa.cekmeceAc': () => cekmeceyiAc(b(), a()),

    // --------------------------------------------------------------- raporlar
    'rapor.pano': () => panoOzeti(b(), a()),
    'rapor.bugun': () => bugunOzeti(b(), a()),
    'rapor.gunluk': (girdi?: { from?: GunAnahtari; to?: GunAnahtari }) => {
      const { from, to } = araligiCoz(girdi);
      return gunlukRapor(b(), a(), from, to);
    },
    'rapor.urun': (girdi?: { from?: GunAnahtari; to?: GunAnahtari; limit?: number }) => {
      const { from, to } = araligiCoz(girdi);
      return urunRaporu(b(), a(), from, to, girdi?.limit ?? 20);
    },
    'rapor.saatlik': (girdi?: { from?: GunAnahtari; to?: GunAnahtari }) => {
      const { from, to } = araligiCoz(girdi);
      return saatlikDagilim(b(), a(), from, to);
    },
    'rapor.suistimal': (girdi?: { from?: GunAnahtari; to?: GunAnahtari }) => {
      const { from, to } = araligiCoz(girdi ?? { from: gunEkle(bugun(), -30) });
      return suistimalRaporu(b(), a(), from, to);
    },
    'rapor.stokDevir': (girdi?: { from?: GunAnahtari; to?: GunAnahtari }) => {
      const { from, to } = araligiCoz(girdi ?? { from: gunEkle(bugun(), -30) });
      return stokDevirHizi(b(), a(), from, to);
    },

    // Kullanıcı yönetimi KASADA YOKTUR (§12.1): personel yalnız yönetim
    // panelinden, yalnız işletme sahibi tarafından tanımlanır ve senkronla
    // buraya iner. Kasada ilk yöneticiyi yalnız kurulum sihirbazı oluşturur.

    'denetim.listele': (girdi?: { kullaniciId?: string; entity?: string; limit?: number }) => {
      const aktor = a();
      if (!aktor.yetkiler.has('denetim.goruntule')) throw hatalar.yetki();
      return denetimListele(b().vt, { kullaniciId: girdi?.kullaniciId, entity: girdi?.entity }, girdi?.limit ?? 200);
    },

    // --------------------------------------------------------------- kampanya
    /*
     * Etkin kampanyalar — satış ekranı miktar indirimini ANLIK hesaplasın diye.
     * Her tuş vuruşunda IPC'ye gitmek sıcak yolu yavaşlatırdı; liste bir kez
     * çekilir, hesap arayüzde yapılır. Sunucu satışta bağımsız olarak tekrar
     * hesaplar, arayüze güvenilmez (§15.4).
     */
    'kampanya.etkin': () =>
      etkinKampanyalar(b().vt).map((k) => ({
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
      })),
    'kampanya.listele': () => kampanyalariListele(b().vt),
    'kampanya.kaydet': (girdi: Parameters<typeof kampanyaKaydet>[1]) => {
      const aktor = a();
      if (!aktor.yetkiler.has('kampanya.yonet')) throw hatalar.yetki();
      return { id: b().vt.islem(() => kampanyaKaydet(b().vt, girdi, uygulama.cihazId)) };
    },

    // ------------------------------------------------------------------ ayar
    'ayar.tumu': () => {
      a();
      return tumAyarlar(b().vt);
    },
    'ayar.yaz': (girdi: { degerler: Record<string, string> }) => {
      const aktor = a();
      if (!aktor.yetkiler.has('ayar.yonet')) throw hatalar.yetki();
      const { vt } = b();
      const cihazId = uygulama.cihazId;
      const zaman = simdi();
      vt.islem(() => {
        for (const [anahtar, deger] of Object.entries(girdi.degerler)) {
          // Cihaz kimliği, fiş serisi ve lisans bilgileri buradan değiştirilemez —
          // ekrandaki bayat kopya aktivasyonun yeni token'ını ezerdi.
          if (!elleYazilabilirMi(anahtar)) continue;
          ayarYaz(vt, anahtar, deger);

          /*
           * Merkezî ayar değiştiyse olay yazılır ve buluta gider (§8.3).
           * Bu olay daha önce HİÇ ÜRETİLMİYORDU: bulutta işleyicisi vardı ama
           * kimse göndermiyordu, dolayısıyla mağaza ayarları iki taraf arasında
           * hiçbir yönde akmıyordu. Cihaza özel ayarlar (yazıcı, yedek, tema)
           * bilerek dışarıda bırakılır.
           */
          if (merkeziAyarMi(anahtar)) {
            olayYaz(
              vt,
              {
                id: uuid(),
                olay_tipi: 'AYAR_DEGISTI',
                entity: 'ayar',
                entity_id: anahtar,
                veri: { anahtar, deger, updated_at: zaman },
                olusturma_zamani: zaman,
              },
              cihazId,
              zaman,
            );
          }
        }
      });
      return { basarili: true };
    },
    /*
     * İşletim sistemine kurulu yazıcıları listeler (§13.2).
     *
     * Kullanıcı UNC yolunu ezberlemek zorunda kalmasın diye var: listeden
     * seçer, ayar kalıcı olur. Electron bu listeyi ancak bir pencere
     * bağlamından verebildiği için pencere getirici enjekte edilir.
     */
    'ayar.yazicilariListele': async () => {
      const pencere = pencereGetir?.();
      if (!pencere) return { yazicilar: [] as { ad: string; aciklama: string; varsayilan: boolean }[] };
      const liste = await pencere.webContents.getPrintersAsync();
      return {
        yazicilar: liste.map((y) => ({
          ad: y.name,
          aciklama: y.displayName || y.description || '',
          varsayilan: y.isDefault === true,
        })),
      };
    },
    'ayar.yaziciTest': () => yaziciTesti(b()),

    // ---------------------------------------------------------------- senkron
    'senkron.durum': () => senkronDurumu(b(), Boolean(ayarlariOku(b()).senkronUrl)),
    'senkron.simdi': async () => {
      const aktor = a();
      if (!aktor.yetkiler.has('senkron.tetikle')) throw hatalar.yetki();
      const secenekler = uygulama.senkronSecenekleri();
      if (!secenekler) throw hatalar.dogrulama('Senkron sunucusu ayarlanmamış.');
      const sonuc = await senkronCalistir(b(), secenekler);
      uygulama.kimlikBirlesmeleriniUygula(sonuc);

      /*
       * Panelden gelen iade talimatları senkrondan HEMEN SONRA işlenir.
       * Talimat pull'da yerele yazılır ama uygulanması kasa oturumu ister;
       * burada aktör ve açık kasa hazır olduğu için doğru yer burasıdır.
       */
      const iadeSonucu = bekleyenIadeleriIsle(b(), aktor);
      if (iadeSonucu.uygulanan > 0) {
        uygulama.olayYayinla('iade:uygulandi', iadeSonucu);
      }

      const cariSonucu = bekleyenCariTalimatlariniIsle(b(), aktor);
      if (cariSonucu.uygulanan > 0) {
        uygulama.olayYayinla('cari:talimatUygulandi', cariSonucu);
      }

      const alisSonucu = bekleyenAlisTalimatlariniIsle(b(), aktor);
      if (alisSonucu.uygulanan > 0) {
        uygulama.olayYayinla('alis:talimatUygulandi', alisSonucu);
      }

      uygulama.olayYayinla('senkron:tamamlandi', sonuc);
      return { ...sonuc, iade: iadeSonucu, cariTalimat: cariSonucu };
    },
    'senkron.mutabakat': async () => {
      const secenekler = uygulama.senkronSecenekleri();
      if (!secenekler) throw hatalar.dogrulama('Senkron sunucusu ayarlanmamış.');
      return mutabakatYap(b(), secenekler);
    },
    'senkron.cakismalar': () => cakismalariListele(b().vt),
    'senkron.hataliOlaylar': () => kaliciHataliOlaylar(b().vt),
    'senkron.aktivasyon': (girdi: { sunucuUrl: string; lisansAnahtari: string; cihazAdi: string }) =>
      cihaziAktiveEt(b(), a(), girdi),
    'senkron.cevrimdisiAktivasyon': (girdi: { kod: string }) => cevrimdisiAktivasyon(b(), a(), girdi.kod),
    'senkron.cihazToken': () => ({ tanimli: Boolean(cihazTokeniOku(b())) }),

    // ----------------------------------------------------------------- yedek
    'yedek.al': async (girdi?: { etiket?: string }) => {
      const aktor = a();
      if (!aktor.yetkiler.has('yedek.al')) throw hatalar.yetki();
      return yedekAl(b(), {
        etiket: girdi?.etiket ?? 'elle',
        ikincilKlasor: ayarMetin(b().vt, 'yedek.ikincil_klasor', '') || null,
        saklananAdet: Number(ayarMetin(b().vt, 'yedek.saklanan_adet', '10')) || 10,
      });
    },
    'yedek.listele': () => {
      a();
      return yedekleriListele(b());
    },
    'yedek.dogrula': (girdi: { yol: string }) => yedegiDogrula(girdi.yol),
    'yedek.geriYukle': async (girdi: { yol: string }) => {
      const sonuc = await yedektenGeriYukle(b(), a(), girdi.yol);
      uygulama.olayYayinla('yedek:geriYuklendi', sonuc);
      return sonuc;
    },
  };
}

export type Kanallar = ReturnType<typeof kanallariOlustur>;
export type KanalAdi = keyof Kanallar;
