/**
 * Uygulama durumu ve bağımlılık bağlama (composition root).
 *
 * Electron'a bağımlı değildir; testler bu sınıfı geçici bir klasörle kurup
 * tüm iş akışını uçtan uca koşturabilir (§21.1 entegrasyon testleri).
 */

import { randomUUID } from 'node:crypto';
import { AYAR, SEMA_SURUMU, simdi, VARSAYILAN_KDV_ORANI, type Rol } from '@market/shared';
import { gocleriUygula, mevcutSurum } from './db/gocmen.js';
import { veritabaniAc, type Vt } from './db/surucu.js';
import { kayitciOlustur, sessizKayitci, type Kayitci } from './altyapi/kayit.js';
import { klasorleriHazirla, yollariOlustur, type Yollar } from './altyapi/yollar.js';
import { ayarBool, ayarMetin, ayarYaz } from './depo/ayar.js';
import { eskiOlaylariTemizle, olayYaz } from './depo/senkron.js';
import { denetimBuda } from './depo/ozet.js';
import { adminSayisi, kullaniciKaydet } from './depo/kullanici.js';
import { parolaHashle } from './guvenlik/parola.js';
import { SenkronZamanlayicisi, type SenkronSonucu } from './senkron/motor.js';
import { ayarlariOku, SISTEM_AKTORU, type Aktor, type Baglam } from './servis/baglam.js';
import { bekleyenAlisTalimatlariniIsle, bildirilmemisSonuclariGonder } from './servis/alis-talimat-servis.js';
import { bekleyenCariTalimatlariniIsle } from './servis/cari-talimat-servis.js';
import { bekleyenIadeleriIsle } from './servis/iade-talimat-servis.js';
import { cihazTokeniOku } from './servis/lisans-servis.js';
import { yedekAl } from './servis/yedek-servis.js';

export interface UygulamaSecenekleri {
  /** Veri kök dizini (Electron'da `app.getPath('userData')`). */
  veriKoku: string;
  /** Testlerde `:memory:` verilebilir. */
  vtYolu?: string;
  konsolLogu?: boolean;
  sessiz?: boolean;
  /** Senkron zamanlayıcısını başlatma (testler). */
  zamanlayiciKapali?: boolean;
}

export class Uygulama {
  readonly baglam: Baglam;
  readonly yollar: Yollar;
  private _aktor: Aktor | null = null;
  private _zamanlayici: SenkronZamanlayicisi | null = null;
  private _sonSenkronSonucu: SenkronSonucu | null = null;
  private readonly dinleyiciler = new Set<(olay: string, veri: unknown) => void>();

  private constructor(vt: Vt, yollar: Yollar, kayit: Kayitci, cihazId: string) {
    this.yollar = yollar;
    this.baglam = { vt, cihazId, kayit, yollar };
  }

  static async olustur(secenekler: UygulamaSecenekleri): Promise<Uygulama> {
    const yollar = yollariOlustur(secenekler.veriKoku);
    const bellekMi = secenekler.vtYolu === ':memory:';
    if (!bellekMi) klasorleriHazirla(yollar);

    const kayit = secenekler.sessiz
      ? sessizKayitci()
      : kayitciOlustur({
          klasor: bellekMi ? undefined : yollar.logKlasoru,
          dosyaAdi: 'kasa.log',
          konsol: secenekler.konsolLogu ?? true,
          seviye: 'bilgi',
          taban: { uygulama: 'kasa' },
        });

    const vtYolu = secenekler.vtYolu ?? yollar.vtDosyasi;
    const vt = await veritabaniAc(vtYolu);

    // Göç öncesi otomatik yedek (§22.4) — veri varsa ve dosya tabanlıysa.
    const gecici = new Uygulama(vt, yollar, kayit, 'gecici');
    gocleriUygula(vt, {
      kayit: (seviye, mesaj, veri) => kayit[seviye](mesaj, veri),
      yedekAl: bellekMi
        ? undefined
        : () => {
            // Senkron bağlamda çalışması gerektiği için VACUUM INTO doğrudan çağrılır.
            try {
              const hedef = `${yollar.yedekKlasoru}/goc-oncesi-${Date.now()}.db`;
              vt.hazirla('VACUUM INTO ?').calistir(hedef);
              kayit.bilgi('Göç öncesi yedek alındı', { hedef });
            } catch (hata) {
              kayit.hata('Göç öncesi yedek alınamadı', { mesaj: hata instanceof Error ? hata.message : String(hata) });
              throw hata;
            }
          },
    });
    void gecici;

    const cihazId = cihazKimliginiCoz(vt);
    const uygulama = new Uygulama(vt, yollar, kayit.alt({ cihaz_id: cihazId }), cihazId);
    uygulama.varsayilanlariHazirla();

    /*
     * Sonuç bildirimi sonradan eklendi; o ana kadar uygulanmış talimatlar
     * bulutta sonsuza kadar "bekliyor" kaldı ve panel o faturaların
     * düzenle/iptal düğmelerini bir daha açmadı. Tek seferlik telafi burada
     * çalışır: hangi talimatın uygulandığını yalnız kasa bilir. Aktör
     * gerektirmez — yerelde zaten kesinleşmiş bir olguyu kuyruğa yazar.
     */
    try {
      bildirilmemisSonuclariGonder(uygulama.baglam);
    } catch (hata) {
      // Telafi açılışı düşürmemeli; eksik bildirim bir sonraki açılışta yeniden denenir.
      kayit.uyari('Bildirilmemiş talimat sonuçları gönderilemedi', {
        mesaj: hata instanceof Error ? hata.message : String(hata),
      });
    }

    kayit.bilgi('Uygulama başlatıldı', {
      surucu: vt.surucuAdi,
      sema_surumu: mevcutSurum(vt),
      beklenen_sema: SEMA_SURUMU,
      cihaz_id: cihazId,
      vt_yolu: bellekMi ? ':memory:' : vtYolu,
    });

    if (!secenekler.zamanlayiciKapali) uygulama.zamanlayiciyiBaslat();
    return uygulama;
  }

  /** İlk açılışta olması gereken ayarları yazar (yoksa). */
  private varsayilanlariHazirla(): void {
    const { vt } = this.baglam;
    const zaman = simdi();
    const varsayilanlar: [string, string, string][] = [
      [AYAR.SEMA_SURUMU, String(SEMA_SURUMU), 'Yerel şema sürümü'],
      [AYAR.ISLETME_ADI, 'Market', 'Fişte görünen işletme adı'],
      [AYAR.VARSAYILAN_KDV, String(VARSAYILAN_KDV_ORANI), 'Yeni üründe varsayılan KDV oranı'],
      // Varsayılan İZİN VER: kasa, stok kaydı gerçeği yansıtmadığı için durmamalı.
      // Sayım hatası ya da geç girilen mal kabul yüzünden müşteri bekletilmez;
      // eksiye düşen ürünler Stok → Özet ekranında raporlanır.
      [AYAR.NEGATIF_STOK_IZNI, '1', 'Stok yetersizken satışa izin ver (uyarı yine gösterilir)'],
      [AYAR.BARKOD_DEBOUNCE_MS, '120', 'Aynı barkodun tekrar okunmasını yok sayma süresi'],
      [AYAR.IC_BARKOD_ONEKI, '29', 'Mağaza içi barkod öneki (20-29)'],
      [AYAR.YAZICI_TIPI, 'YOK', 'Fiş yazıcısı tipi'],
      [AYAR.YAZICI_GENISLIK, '48', 'Fiş satır genişliği (karakter)'],
      [AYAR.CEKMECE_ACIK, '1', 'Nakit ödemede çekmeceyi aç'],
      [AYAR.OTOMATIK_FIS, '1', 'Satış sonrası fişi otomatik yazdır'],
      [AYAR.SENKRON_MOD, 'MANUEL', 'Senkron tetikleme modu'],
      [AYAR.SENKRON_ARALIK_DK, '15', 'Fırsatçı senkron aralığı (dakika)'],
      [AYAR.SENKRON_GUN_SONU, '1', 'Gün sonunda otomatik senkron dene'],
      [AYAR.KREDI_LIMITI_DAVRANISI, 'UYAR', 'Kredi limiti aşımında davranış'],
      [AYAR.KASA_FARKI_ESIGI, '5000', 'Uyarı verilecek kasa farkı (kuruş)'],
      [AYAR.OTURUM_ZAMAN_ASIMI_DK, '15', 'Ekran kilidi zaman aşımı (dakika)'],
      [AYAR.YEDEK_SAKLANAN_ADET, '10', 'Saklanacak yedek sayısı'],
      [AYAR.YEDEK_SIKLIK_SAAT, '6', 'Otomatik yedek sıklığı (saat)'],
      [AYAR.TEMA, 'acik', 'Arayüz teması: acik (varsayılan) veya koyu'],
      [AYAR.YAZI_BOYUTU, 'normal', 'Arayüz yazı boyutu'],
      [AYAR.KURULUM_TAMAMLANDI, '0', 'Kurulum sihirbazı tamamlandı mı'],
    ];

    this.baglam.vt.islem(() => {
      for (const [anahtar, deger, aciklama] of varsayilanlar) {
        if (ayarMetin(vt, anahtar, '\u0000') === '\u0000') ayarYaz(vt, anahtar, deger, aciklama, zaman);
      }
    });
  }

  get vt(): Vt {
    return this.baglam.vt;
  }

  get cihazId(): string {
    return this.baglam.cihazId;
  }

  get kayit(): Kayitci {
    return this.baglam.kayit;
  }

  get aktor(): Aktor | null {
    return this._aktor;
  }

  aktoruAyarla(aktor: Aktor | null): void {
    this._aktor = aktor;
  }

  /** Oturum açılmış kullanıcıyı ister; yoksa hata verir. */
  aktoruIste(): Aktor {
    if (!this._aktor) {
      const hata = new Error('Oturum açılmamış.');
      hata.name = 'OturumYok';
      throw hata;
    }
    return this._aktor;
  }

  /**
   * Senkronda kullanıcı kimlikleri birleştiyse açık oturumun aktörünü tazeler.
   *
   * Pull, yerelde açılmış bir kullanıcıyı buluttaki aynı adlı kayıtla
   * birleştirebilir; eski satır silinir. O sırada o kullanıcı oturum açmışsa
   * bellekteki aktör artık OLMAYAN bir id taşır ve ilk satışta yabancı anahtar
   * hatası alınır. Kimlik aynı kişiye ait olduğu için oturum düşürülmez,
   * yalnız id yenisine çevrilir; kasa oturumu ve yetkiler aynen sürer.
   */
  kimlikBirlesmeleriniUygula(sonuc: SenkronSonucu): void {
    const birlesmeler = sonuc.birlesenKullanicilar;
    if (!birlesmeler?.length || !this._aktor) return;
    const eslesme = birlesmeler.find((b) => b.eskiId === this._aktor?.kullaniciId);
    if (!eslesme) return;
    this._aktor = { ...this._aktor, kullaniciId: eslesme.yeniId };
    this.kayit.bilgi('Oturum kimliği bulut kaydıyla birleştirildi', {
      eski_id: eslesme.eskiId,
      yeni_id: eslesme.yeniId,
    });
  }

  /** Sistem işlemleri (kurulum, arka plan görevleri) için. */
  get sistemAktoru(): Aktor {
    return SISTEM_AKTORU;
  }

  get sonSenkronSonucu(): SenkronSonucu | null {
    return this._sonSenkronSonucu;
  }

  get zamanlayici(): SenkronZamanlayicisi | null {
    return this._zamanlayici;
  }

  // -------------------------------------------------------------------------
  // Olay yayını (arayüze bildirim)
  // -------------------------------------------------------------------------

  olayDinle(dinleyici: (olay: string, veri: unknown) => void): () => void {
    this.dinleyiciler.add(dinleyici);
    return () => this.dinleyiciler.delete(dinleyici);
  }

  olayYayinla(olay: string, veri: unknown): void {
    for (const dinleyici of this.dinleyiciler) {
      try {
        dinleyici(olay, veri);
      } catch {
        /* bir dinleyicinin hatası diğerlerini etkilemesin */
      }
    }
  }

  // -------------------------------------------------------------------------
  // Senkron
  // -------------------------------------------------------------------------

  senkronSecenekleri(): { temelUrl: string; cihazToken: string | null; aralikDk: number; aktif: boolean } | null {
    const ayarlar = ayarlariOku(this.baglam);
    if (!ayarlar.senkronUrl) return null;
    return {
      temelUrl: ayarlar.senkronUrl,
      cihazToken: cihazTokeniOku(this.baglam),
      aralikDk: ayarlar.senkronAralikDk,
      aktif: ayarlar.senkronModu === 'FIRSATCI',
    };
  }

  zamanlayiciyiBaslat(): void {
    if (this._zamanlayici) return;
    this._zamanlayici = new SenkronZamanlayicisi(
      this.baglam,
      () => this.senkronSecenekleri(),
      (sonuc) => {
        this._sonSenkronSonucu = sonuc;
        this.kimlikBirlesmeleriniUygula(sonuc);
        this.bekleyenTalimatlariUygula();
        this.olayYayinla('senkron:tamamlandi', sonuc);
      },
    );
    this._zamanlayici.baslat();
  }

  /**
   * Panelden inen talimatları OTOMATİK senkrondan sonra da uygular (§10.4, §10.7).
   *
   * Talimatlar yalnız elle senkronda ve kasa açılışında işleniyordu; arka plan
   * senkronu onları indirip bırakıyordu. Sonucu şuydu: panelden yapılan iade ya
   * da bakiye düzeltmesi indiği hâlde kasada saatlerce görünmüyor, kullanıcı
   * "olmadı" deyip ikinci kez deniyordu.
   *
   * Oturum açılmamışsa yapılacak bir şey yok: talimatlar bir aktörün yetkisiyle
   * uygulanır ve giriş ekranında aktör yoktur — talimat beklemeye devam eder.
   */
  private bekleyenTalimatlariUygula(): void {
    const aktor = this._aktor;
    if (!aktor) return;
    try {
      const iade = bekleyenIadeleriIsle(this.baglam, aktor);
      if (iade.uygulanan > 0) this.olayYayinla('iade:uygulandi', iade);
      const cari = bekleyenCariTalimatlariniIsle(this.baglam, aktor);
      if (cari.uygulanan > 0) this.olayYayinla('cari:talimatUygulandi', cari);
      const alis = bekleyenAlisTalimatlariniIsle(this.baglam, aktor);
      if (alis.uygulanan > 0) this.olayYayinla('alis:talimatUygulandi', alis);
    } catch (hata) {
      // Talimat uygulaması senkronu düşürmemeli; hatası kendi kaydında durur.
      this.baglam.kayit.uyari('Bekleyen talimatlar işlenemedi', {
        mesaj: hata instanceof Error ? hata.message : String(hata),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Bakım (§18.4)
  // -------------------------------------------------------------------------

  private bakimZamanlayicisi: ReturnType<typeof setInterval> | null = null;

  /**
   * Diskte biriken geçici kayıtları budar.
   *
   * Gönderilmiş senkron olayları ve eski denetim satırları sınırsız birikiyordu;
   * `eskiOlaylariTemizle` yazılmış ama HİÇ ÇAĞRILMAMIŞTI. Günde birkaç yüz satış
   * yapan bir kasada bu tablolar yıl içinde veritabanının en büyük parçası olur,
   * yedek boyutunu ve açılış süresini birlikte büyütür.
   *
   * Silinen hiçbir şey mali kayıt değildir: satış, stok ve cari hareketleri
   * kendi tablolarında durur ve buraya dokunulmaz.
   */
  bakimYap(): { olay: number; denetim: number } {
    const { vt } = this.baglam;
    const olayGun = Number(ayarMetin(vt, AYAR.OLAY_SAKLAMA_GUN, '30')) || 30;
    const denetimGun = Number(ayarMetin(vt, AYAR.DENETIM_SAKLAMA_GUN, '365')) || 365;

    const sinir = (gun: number) => new Date(Date.now() - gun * 86400000).toISOString();
    const sonuc = vt.islem(() => ({
      olay: eskiOlaylariTemizle(vt, sinir(olayGun)),
      denetim: denetimBuda(vt, sinir(denetimGun)),
    }));

    if (sonuc.olay > 0 || sonuc.denetim > 0) {
      this.kayit.bilgi('Bakım tamamlandı', { silinen_olay: sonuc.olay, silinen_denetim: sonuc.denetim });
    }
    return sonuc;
  }

  bakimiBaslat(): void {
    if (this.bakimZamanlayicisi) return;
    // Açılışta bir kez: uzun süre kapalı kalmış kasa da temizlensin.
    try {
      this.bakimYap();
    } catch (hata) {
      this.kayit.hata('Açılış bakımı başarısız', { mesaj: hata instanceof Error ? hata.message : String(hata) });
    }
    this.bakimZamanlayicisi = setInterval(() => {
      try {
        this.bakimYap();
      } catch (hata) {
        this.kayit.hata('Bakım başarısız', { mesaj: hata instanceof Error ? hata.message : String(hata) });
      }
    }, 24 * 3600_000);
    this.bakimZamanlayicisi.unref?.();
  }

  // -------------------------------------------------------------------------
  // Otomatik yedek (§18.2)
  // -------------------------------------------------------------------------

  private yedekZamanlayicisi: ReturnType<typeof setInterval> | null = null;

  otomatikYedeklemeyiBaslat(sifrelemeAnahtari?: Buffer | null): void {
    if (this.yedekZamanlayicisi) return;
    const saat = Number(ayarMetin(this.baglam.vt, AYAR.YEDEK_SIKLIK_SAAT, '6')) || 6;
    const saklanan = Number(ayarMetin(this.baglam.vt, AYAR.YEDEK_SAKLANAN_ADET, '10')) || 10;
    const ikincil = ayarMetin(this.baglam.vt, AYAR.YEDEK_IKINCIL_KLASOR, '') || null;

    this.yedekZamanlayicisi = setInterval(
      () => {
        void yedekAl(this.baglam, { sifrelemeAnahtari, ikincilKlasor: ikincil, saklananAdet: saklanan, etiket: 'otomatik' })
          .then((bilgi) => this.olayYayinla('yedek:alindi', bilgi))
          .catch((hata) =>
            this.kayit.hata('Otomatik yedek başarısız', { mesaj: hata instanceof Error ? hata.message : String(hata) }),
          );
      },
      Math.max(1, saat) * 3600_000,
    );
    this.yedekZamanlayicisi.unref?.();
  }

  async kapat(): Promise<void> {
    this._zamanlayici?.durdur();
    if (this.yedekZamanlayicisi) clearInterval(this.yedekZamanlayicisi);
    if (this.bakimZamanlayicisi) clearInterval(this.bakimZamanlayicisi);
    this.baglam.kayit.bilgi('Uygulama kapatılıyor');
    try {
      // WAL dosyasını ana veritabanına yaz — temiz kapanış (§18.4).
      this.baglam.vt.ham('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* bellek veritabanında WAL yoktur */
    }
    this.baglam.vt.kapat();
  }

  /** Hiç yönetici yoksa ilk kurulum gerekir (§12.1). */
  kurulumGerekliMi(): boolean {
    return adminSayisi(this.baglam.vt) === 0 || !ayarBool(this.baglam.vt, AYAR.KURULUM_TAMAMLANDI, false);
  }

  /**
   * Kurulum sihirbazının yönetici hesabını oluşturur.
   *
   * Bu, kasanın kullanıcı AÇTIĞI tek yerdir — kullanıcı yönetimi yalnız
   * paneldedir (§12.1). Yine de olay YAZILIR ve buluta gönderilir: aksi hâlde
   * bu sahip hesabı panelde hiç görünmez, aynı kullanıcı adı orada ikinci kez
   * açılır ve pull `kullanici_adi` UNIQUE kısıtına takılıp senkronu kilitler.
   */
  yoneticiOlustur(girdi: { ad: string; kullaniciAdi: string; sifre: string; pin?: string }): string {
    const { vt, cihazId } = this.baglam;
    const zaman = simdi();
    return vt.islem(() => {
      const sifreHash = parolaHashle(girdi.sifre);
      const pinHash = girdi.pin ? parolaHashle(girdi.pin) : null;
      const id = kullaniciKaydet(
        vt,
        {
          ad: girdi.ad,
          kullanici_adi: girdi.kullaniciAdi,
          rol: 'ADMIN' as Rol,
          sifre_hash: sifreHash,
          pin_hash: pinHash,
          aktif_mi: true,
        },
        cihazId,
        zaman,
      );
      olayYaz(
        vt,
        {
          id: randomUUID(),
          olay_tipi: 'KULLANICI_KAYDEDILDI',
          entity: 'kullanici',
          entity_id: id,
          veri: {
            id,
            ad: girdi.ad,
            kullanici_adi: girdi.kullaniciAdi,
            rol: 'ADMIN',
            sifre_hash: sifreHash,
            pin_hash: pinHash,
            ek_yetkiler: [],
            kaldirilan_yetkiler: [],
            aktif_mi: true,
            created_at: zaman,
            updated_at: zaman,
          },
          olusturma_zamani: zaman,
        },
        cihazId,
        zaman,
      );
      return id;
    });
  }
}

/** Cihaz kimliği kalıcıdır; senkronda ve fiş serisinde kullanılır (§4.4). */
function cihazKimliginiCoz(vt: Vt): string {
  const mevcut = ayarMetin(vt, AYAR.CIHAZ_ID, '');
  if (mevcut) return mevcut;
  const yeni = `kasa-${randomUUID().slice(0, 8)}`;
  ayarYaz(vt, AYAR.CIHAZ_ID, yeni, 'Bu kasanın benzersiz kimliği (değiştirmeyin)');
  return yeni;
}
