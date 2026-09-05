/**
 * Senkron motoru — §7.
 *
 * Bir senkron oturumu = önce PUSH, sonra PULL, sonunda `last_sync_at` güncellenir.
 *
 * Dayanıklılık kuralları:
 *  - Kısmi başarı: yalnız sunucunun **kabul ettiği** uuid'ler arşivlenir; kalanı
 *    bir sonraki turda tekrar denenir (§7.6).
 *  - İdempotency: her olayın uuid'si vardır; kopuk bağlantı sonrası tekrar
 *    gönderim çift kayıt üretmez (§7.1).
 *  - Kasa asla beklemez: senkron tamamen arka plandadır, hata satışı etkilemez (§3.2).
 */

import {
  AYAR,
  goreliZaman,
  merkeziAyarMi,
  simdi,
  SINIRLAR,
  UygulamaHatasi,
  uuid,
  type OlayTipi,
  type PullKaydi,
  type SenkronDurumu,
} from '@market/shared';
import { cariSunucudanUygula } from '../depo/cari.js';
import { barkodSunucudanUygula, kampanyaSunucudanUygula, kategoriSunucudanUygula, urunSunucudanUygula } from '../depo/katalog.js';
import { kullaniciSunucudanUygula } from '../depo/kullanici.js';
import { kullaniciyiSenkrondanSil } from '../servis/kullanici-servis.js';
import { urunBul } from '../depo/katalog.js';
import { hareketEkle, stokOku } from '../depo/stok.js';
import { stokOlayiYaz } from '../servis/stok-servis.js';
import { kategoriyiSenkrondanSil } from '../servis/katalog-servis.js';
import { SISTEM_AKTORU } from '../servis/baglam.js';
import { ayarMetin, ayarYaz } from '../depo/ayar.js';
import {
  bekleyenOlaylar,
  bekleyenSayisi,
  cakismaKaydet,
  durumOku,
  durumYaz,
  olayHatasiKaydet,
  olaylariIsaretle,
  yerelSayimlar,
} from '../depo/senkron.js';
import type { Baglam } from '../servis/baglam.js';
import { AgHatasi, SenkronIstemcisi } from './istemci.js';

export interface SenkronSonucu {
  basarili: boolean;
  gonderilen: number;
  yinelenen: number;
  reddedilen: number;
  cekilen: number;
  cakisma: number;
  sureMs: number;
  hata?: string;
  /**
   * Pull sirasinda kullanici adi cakismasi yuzunden birlestirilen kimlikler.
   * Acik oturumun aktoru bunlardan biriyse cagiran kimligini tazelemelidir;
   * aksi halde aktor silinmis bir id'yi tasir ve sonraki yazma FK'den doner.
   */
  birlesenKullanicilar?: { eskiId: string; yeniId: string }[];
}

export interface SenkronDurumBilgisi {
  durum: SenkronDurumu;
  bekleyenOlay: number;
  sonSenkron: string | null;
  sonSenkronGoreli: string;
  sonHata: string | null;
  rozet: '🟢' | '🟡' | '🔴' | '⚪';
  aciklama: string;
}

/** Kullanıcıya gösterilen senkron rozeti (§7.6, §10.1). */
export function senkronDurumu(baglam: Baglam, senkronAcikMi: boolean): SenkronDurumBilgisi {
  const durum = durumOku(baglam.vt);
  const bekleyen = bekleyenSayisi(baglam.vt);
  const goreli = goreliZaman(durum.last_sync_at);

  if (!senkronAcikMi) {
    return {
      durum: 'KAPALI',
      bekleyenOlay: bekleyen,
      sonSenkron: durum.last_sync_at,
      sonSenkronGoreli: goreli,
      sonHata: durum.son_hata,
      rozet: '⚪',
      aciklama: 'Senkron kapalı — veriler yalnız bu bilgisayarda tutuluyor.',
    };
  }

  const gecenGun = durum.last_sync_at ? (Date.now() - Date.parse(durum.last_sync_at)) / 86400000 : Infinity;
  if (gecenGun >= SINIRLAR.SENKRON_KRITIK_GUN) {
    return {
      durum: 'HATA',
      bekleyenOlay: bekleyen,
      sonSenkron: durum.last_sync_at,
      sonSenkronGoreli: goreli,
      sonHata: durum.son_hata,
      rozet: '🔴',
      aciklama: durum.last_sync_at
        ? `${Math.floor(gecenGun)} gündür senkron yapılmadı. İnternet bağlantısını kontrol edin.`
        : 'Henüz hiç senkron yapılmadı.',
    };
  }
  if (bekleyen > 0) {
    return {
      durum: 'BEKLIYOR',
      bekleyenOlay: bekleyen,
      sonSenkron: durum.last_sync_at,
      sonSenkronGoreli: goreli,
      sonHata: durum.son_hata,
      rozet: '🟡',
      aciklama: `${bekleyen} değişiklik gönderilmeyi bekliyor. Son senkron: ${goreli}.`,
    };
  }
  return {
    durum: 'GUNCEL',
    bekleyenOlay: 0,
    sonSenkron: durum.last_sync_at,
    sonSenkronGoreli: goreli,
    sonHata: null,
    rozet: '🟢',
    aciklama: `Her şey güncel. Son senkron: ${goreli}.`,
  };
}

/** Sunucudan gelen bir kaydı ilgili tabloya uygular ve çakışmayı loglar. */
export function pullKaydiniUygula(
  baglam: Baglam,
  kayit: PullKaydi,
): { uygulandi: boolean; cakisma: boolean; birlesme?: { eskiId: string; yeniId: string } } {
  const { vt, cihazId } = baglam;
  const veri = kayit.veri as Record<string, unknown>;

  switch (kayit.varlik) {
    case 'urunler': {
      const sonuc = urunSunucudanUygula(vt, veri, kayit.versiyon);
      if (sonuc === 'atlandi') {
        // Yerel kayıt daha yeni → LWW'de yerel kazandı; çakışma kaydı tutulur (§7.4).
        cakismaKaydet(vt, {
          id: uuid(),
          entity: 'urunler',
          entity_id: String(veri.id ?? ''),
          kaynak_a: 'yerel',
          kaynak_b: 'bulut',
          cozum: 'YEREL_KAZANDI',
          cozum_zamani: simdi(),
          detay: JSON.stringify({ sunucu_updated_at: veri.updated_at, sunucu_versiyonu: kayit.versiyon }),
        });
        return { uygulandi: false, cakisma: true };
      }
      return { uygulandi: true, cakisma: false };
    }
    case 'barkodlar':
      barkodSunucudanUygula(vt, veri, kayit.versiyon);
      return { uygulandi: true, cakisma: false };
    case 'kategoriler': {
      // Mezar taşı: bulutta silinen kategori. Karar yerelde yeniden verilir —
      // bu kasada o kategoriye bağlı ürün varsa satır silinemez, gizlenir.
      if (kayit.silindi_mi) {
        const id = String(veri.id ?? '');
        if (id) kategoriyiSenkrondanSil(baglam, id);
        return { uygulandi: true, cakisma: false };
      }
      kategoriSunucudanUygula(vt, veri, kayit.versiyon);
      return { uygulandi: true, cakisma: false };
    }
    case 'kampanyalar':
      kampanyaSunucudanUygula(vt, veri, kayit.versiyon);
      return { uygulandi: true, cakisma: false };
    case 'kullanicilar': {
      // Mezar taşı (§12.1): bulutta silinen kullanıcı. Karar YERELDE yeniden
      // verilir — bu kasada satış/kasa kaydı varsa satır silinemez, yalnız
      // girişi kapatılır. Buluttaki kayıtlar bu kasanınkilerden farklı olabilir,
      // o yüzden merkezin "silinebilir" kararı doğrudan uygulanmaz.
      if (kayit.silindi_mi) {
        const id = String(veri.id ?? '');
        if (!id) return { uygulandi: false, cakisma: false };
        kullaniciyiSenkrondanSil(baglam, id);
        return { uygulandi: true, cakisma: false };
      }
      const { birlesenYerelId } = kullaniciSunucudanUygula(vt, veri, kayit.versiyon);
      if (birlesenYerelId) {
        const yeniId = String(veri.id ?? '');
        cakismaKaydet(vt, {
          id: uuid(),
          entity: 'kullanicilar',
          entity_id: yeniId,
          kaynak_a: 'yerel',
          kaynak_b: 'bulut',
          cozum: 'BULUT_KAZANDI',
          cozum_zamani: simdi(),
          detay: JSON.stringify({ neden: 'kullanici_adi cakismasi', birlesen_yerel_id: birlesenYerelId }),
        });
        return { uygulandi: true, cakisma: true, birlesme: { eskiId: birlesenYerelId, yeniId } };
      }
      return { uygulandi: true, cakisma: false };
    }
    case 'cariler':
      cariSunucudanUygula(vt, veri, kayit.versiyon);
      return { uygulandi: true, cakisma: false };
    case 'ayarlar': {
      const anahtar = String(veri.anahtar ?? '');
      /*
       * BEYAZ LİSTE (§8.3). Önceden kara liste vardı ("cihaz.", "yazici.",
       * "yedek." ile başlamayan her şeyi uygula"); listede unutulan yeni bir
       * cihaz ayarı sessizce yayılır ve her kasa aynı yazıcıya basmaya
       * çalışırdı. Artık yalnız "tüm mağazada aynı olmalı" denen anahtarlar iner.
       */
      if (merkeziAyarMi(anahtar)) {
        ayarYaz(vt, anahtar, String(veri.deger ?? ''), (veri.aciklama as string | null) ?? null);
        return { uygulandi: true, cakisma: false };
      }
      return { uygulandi: false, cakisma: false };
    }
    case 'stok_duzeltmeleri':
      // İptal edilmiş talimat uygulanmaz: panelde aynı ürüne yeni bir stok
      // girilince eskisi mezar taşıyla iptal edilir. Buna bakmazsak iki
      // talimat da uygulanır ve stok istenenin iki katına çıkar (§11.5).
      if (kayit.silindi_mi) return { uygulandi: false, cakisma: false };
      return stokTalimatiniUygula(baglam, veri);
    default:
      baglam.kayit.uyari('Bilinmeyen pull varlığı, atlandı', { varlik: kayit.varlik, cihaz_id: cihazId });
      return { uygulandi: false, cakisma: false };
  }
}

/**
 * Panelden inen stok talimatını uygular (§11.5).
 *
 * İnen şey bir stok HAREKETİ değil, talimattır: hareketi kasa üretir, böylece
 * "hareketlerin tek üreticisi kasadır" kuralı korunur.
 *
 * Çift uygulamaya karşı iki katman: (1) yalnız hedef cihaz uygular, (2) üretilen
 * hareketin id'si talimatın id'sidir — aynı kayıt tekrar inse birincil anahtar
 * çakışır. Kontrolü hata yakalayarak değil önceden sorgulayarak yapıyoruz;
 * transaction içinde yakalanan bir kısıt hatası partiyi bozabilirdi.
 */
function stokTalimatiniUygula(baglam: Baglam, veri: Record<string, unknown>): { uygulandi: boolean; cakisma: boolean } {
  const { vt, cihazId } = baglam;
  const id = String(veri.id ?? '');
  if (!id) return { uygulandi: false, cakisma: false };

  // Hedef başka kasaysa atla: bulutta stok özeti cihaz boyutu taşımadığı için
  // iki kasa uygularsa çift sayılırdı.
  if (String(veri.hedef_cihaz_id ?? '') !== cihazId) return { uygulandi: false, cakisma: false };

  const mevcut = vt.hazirla('SELECT id FROM stok_hareketleri WHERE id = ?').tek<{ id: string }>(id);
  if (mevcut) return { uygulandi: false, cakisma: false };

  const urunId = String(veri.urun_id ?? '');
  const urun = urunId ? urunBul(vt, urunId) : null;
  if (!urun) {
    baglam.kayit.uyari('Stok talimatındaki ürün bulunamadı, atlandı', { talimat_id: id, urun_id: urunId });
    return { uygulandi: false, cakisma: false };
  }

  /**
   * Fark BURADA, kasanın kendi güncel stoğuna göre hesaplanır.
   *
   * Panel `hedef_miktar` gönderir çünkü orada gördüğü rakam senkron beklerken
   * bayatlayabiliyor; farkı panelde hesaplamak yanlış tabana oturur ve sonuç
   * kullanıcının yazdığı sayı olmazdı ("50 yazdım, 80 oldu"). Kasanın kendi
   * "Stok Düzelt" ekranı da tam olarak böyle çalışır — iki uygulamada aynı
   * işlem aynı anlama gelsin (§11.5).
   *
   * `fark` alanı eski talimatlar için korunuyor: hedef yoksa fark uygulanır.
   */
  const hedef = veri.hedef_miktar;
  const fark = hedef === null || hedef === undefined ? Number(veri.fark ?? 0) : Number(hedef) - stokOku(vt, urunId);

  if (!Number.isFinite(fark) || fark === 0) return { uygulandi: false, cakisma: false };

  const tip = String(veri.tip ?? 'DUZELTME') === 'ACILIS' ? 'ACILIS' : 'DUZELTME';
  const zaman = simdi();

  const hareketId = hareketEkle(
    vt,
    {
      id,
      urun_id: urunId,
      hareket_tipi: tip,
      miktar: fark,
      birim_maliyet: urun.alis_fiyati,
      belge_tipi: tip,
      aciklama: String(veri.neden ?? 'Panelden stok düzeltmesi'),
      kullanici_id: null,
    },
    cihazId,
    zaman,
  );
  stokOlayiYaz(baglam, hareketId, urunId, tip, fark, SISTEM_AKTORU, zaman);

  return { uygulandi: true, cakisma: false };
}

export interface SenkronSecenekleri {
  temelUrl: string;
  cihazToken?: string | null;
  erisimToken?: string | null;
  /** Yalnız gönder (gün sonu hızlı senkronu için). */
  sadecePush?: boolean;
  getir?: typeof fetch;
}

/**
 * Tam bir senkron turu çalıştırır. Hata fırlatmaz; sonucu döner.
 * Çağıran (zamanlayıcı ya da kullanıcı) sonuca göre bilgilendirilir.
 */
export async function senkronCalistir(baglam: Baglam, secenekler: SenkronSecenekleri): Promise<SenkronSonucu> {
  const baslangic = Date.now();
  const { vt, cihazId, kayit } = baglam;
  const sonuc: SenkronSonucu = { basarili: false, gonderilen: 0, yinelenen: 0, reddedilen: 0, cekilen: 0, cakisma: 0, sureMs: 0 };

  if (!secenekler.temelUrl) {
    sonuc.hata = 'Senkron sunucusu ayarlanmamış.';
    sonuc.sureMs = Date.now() - baslangic;
    return sonuc;
  }

  const istemci = new SenkronIstemcisi({
    temelUrl: secenekler.temelUrl,
    cihazToken: secenekler.cihazToken ?? null,
    erisimToken: secenekler.erisimToken ?? null,
    getir: secenekler.getir,
  });

  /**
   * Bekleyen olayları parti parti gönderir.
   *
   * İKİ KEZ çağrılır: pull'dan önce ve sonra. Sebebi, pull'un olay ÜRETEBİLMESİ:
   * panelden inen bir stok talimatı uygulandığında kasa yeni bir stok hareketi
   * yazar. Yalnız baştaki push çalışsaydı o hareket bir sonraki tura kalırdı ve
   * panelden yapılan bir stok değişikliğinin panelde görünmesi İKİ tur sürerdi
   * — kullanıcı da "olmadı" deyip tekrar girerdi (§7.3).
   */
  const bekleyenleriGonder = async (): Promise<void> => {
    for (let tur = 0; tur < 200; tur++) {
      const olaylar = bekleyenOlaylar(vt, SINIRLAR.PUSH_BATCH);
      if (olaylar.length === 0) break;

      const yanit = await istemci.push({
        cihaz_id: cihazId,
        olaylar: olaylar.map((o) => ({
          uuid: o.id,
          tip: o.olay_tipi as OlayTipi,
          entity: o.entity,
          entity_id: o.entity_id,
          olusturma_zamani: o.olusturma_zamani,
          veri: JSON.parse(o.veri) as Record<string, unknown>,
        })),
      });

      const zaman = simdi();
      vt.islem(() => {
        // Kabul edilenler + sunucunun "zaten işlenmiş" dediği yinelenenler arşivlenir.
        olaylariIsaretle(vt, [...yanit.kabul_edilen, ...yanit.yinelenen], zaman);
        for (const red of yanit.reddedilen) {
          olayHatasiKaydet(vt, red.uuid, `${red.kod}: ${red.mesaj}`, red.kalici, zaman);
        }
      });

      sonuc.gonderilen += yanit.kabul_edilen.length;
      sonuc.yinelenen += yanit.yinelenen.length;
      sonuc.reddedilen += yanit.reddedilen.length;

      if (yanit.reddedilen.length > 0) {
        kayit.uyari('Senkronda reddedilen olaylar var', {
          adet: yanit.reddedilen.length,
          ornek: yanit.reddedilen.slice(0, 3).map((r) => ({ kod: r.kod, mesaj: r.mesaj })),
        });
      }

      // Hiçbir ilerleme olmadıysa sonsuz döngüye girmemek için dur.
      if (yanit.kabul_edilen.length + yanit.yinelenen.length + yanit.reddedilen.length === 0) break;
      durumYaz(vt, { last_push_at: simdi(), cihaz_id: cihazId });
    }
  };

  try {
    // ---------------- PUSH ----------------
    await bekleyenleriGonder();

    // ---------------- PULL ----------------
    if (!secenekler.sadecePush) {
      let versiyon = durumOku(vt).last_pull_version;
      for (let sayfa = 0; sayfa < 200; sayfa++) {
        const yanit = await istemci.pull(versiyon, SINIRLAR.PULL_LIMIT);

        /*
         * Fiş serisi merkezden gelir (§10.2). Aktivasyonda da gelir ama
         * aktivasyondan ÖNCE kurulmuş kasalar onu alamamıştı; her pull'da
         * taşındığı için mevcut kurulumlar kendiliğinden düzelir.
         *
         * Yalnız DEĞİŞTİYSE yazılır: her turda ayar yazmak gereksiz olay üretir.
         */
        if (yanit.seri && ayarMetin(vt, AYAR.CIHAZ_SERI, '') !== yanit.seri) {
          ayarYaz(vt, AYAR.CIHAZ_SERI, yanit.seri, 'Bu kasanın fiş serisi (merkezden atanır)');
          baglam.kayit.bilgi('Fiş serisi merkezden alındı', { seri: yanit.seri });
        }

        if (yanit.kayitlar.length === 0) {
          versiyon = Math.max(versiyon, yanit.sunucu_versiyonu);
          break;
        }

        vt.islem(() => {
          for (const kayitSatiri of yanit.kayitlar) {
            const uygulama = pullKaydiniUygula(baglam, kayitSatiri);
            if (uygulama.uygulandi) sonuc.cekilen++;
            if (uygulama.cakisma) sonuc.cakisma++;
            if (uygulama.birlesme) (sonuc.birlesenKullanicilar ??= []).push(uygulama.birlesme);
            versiyon = Math.max(versiyon, kayitSatiri.versiyon);
          }
          durumYaz(vt, { last_pull_version: versiyon, last_pull_at: simdi() });
        });

        if (!yanit.has_more) {
          versiyon = Math.max(versiyon, yanit.sunucu_versiyonu);
          durumYaz(vt, { last_pull_version: versiyon });
          break;
        }
      }

      // Pull uygulanırken olay üretildiyse aynı turda gönder; yoksa merkez bir
      // tur boyunca eski değeri gösterir.
      if (bekleyenSayisi(vt) > 0) await bekleyenleriGonder();
    }

    const bitis = simdi();
    durumYaz(vt, { last_sync_at: bitis, son_hata: null, cihaz_id: cihazId });
    sonuc.basarili = true;
    sonuc.sureMs = Date.now() - baslangic;

    kayit.bilgi('Senkron tamamlandı', {
      gonderilen: sonuc.gonderilen,
      yinelenen: sonuc.yinelenen,
      reddedilen: sonuc.reddedilen,
      cekilen: sonuc.cekilen,
      cakisma: sonuc.cakisma,
      sure_ms: sonuc.sureMs,
    });
    return sonuc;
  } catch (hata) {
    const mesaj =
      hata instanceof AgHatasi || hata instanceof UygulamaHatasi
        ? hata.message
        : hata instanceof Error
          ? hata.message
          : String(hata);
    sonuc.hata = mesaj;
    sonuc.sureMs = Date.now() - baslangic;
    durumYaz(vt, { son_hata: mesaj.slice(0, 500) });
    kayit.uyari('Senkron başarısız', { mesaj, sure_ms: sonuc.sureMs });
    return sonuc;
  }
}

export interface MutabakatRaporu {
  yerel: Record<string, number>;
  sunucu: Record<string, number>;
  farklar: { tablo: string; yerel: number; sunucu: number; fark: number }[];
  bekleyenOlay: number;
  uyumlu: boolean;
}

/** Yerel-bulut kayıt sayısı mutabakatı (§18.4). */
export async function mutabakatYap(baglam: Baglam, secenekler: SenkronSecenekleri): Promise<MutabakatRaporu> {
  const istemci = new SenkronIstemcisi({
    temelUrl: secenekler.temelUrl,
    cihazToken: secenekler.cihazToken ?? null,
    erisimToken: secenekler.erisimToken ?? null,
    getir: secenekler.getir,
  });

  const yerel = yerelSayimlar(baglam.vt);
  const durum = await istemci.durum();
  const sunucu = durum.sayimlar ?? {};

  const farklar = Object.keys(yerel)
    .map((tablo) => ({
      tablo,
      yerel: yerel[tablo] ?? 0,
      sunucu: sunucu[tablo] ?? 0,
      fark: (yerel[tablo] ?? 0) - (sunucu[tablo] ?? 0),
    }))
    .filter((f) => f.fark !== 0);

  const bekleyen = bekleyenSayisi(baglam.vt);
  return { yerel, sunucu, farklar, bekleyenOlay: bekleyen, uyumlu: farklar.length === 0 && bekleyen === 0 };
}

// ---------------------------------------------------------------------------
// Zamanlayıcı (§7.5)
// ---------------------------------------------------------------------------

export class SenkronZamanlayicisi {
  private zamanlayici: ReturnType<typeof setTimeout> | null = null;
  private calisiyor = false;
  private ardisikHata = 0;
  private durduruldu = false;

  constructor(
    private readonly baglam: Baglam,
    private readonly secenekleriGetir: () => (SenkronSecenekleri & { aralikDk: number; aktif: boolean }) | null,
    private readonly bildirim?: (sonuc: SenkronSonucu) => void,
  ) {}

  baslat(): void {
    this.durduruldu = false;
    this.planla(5_000);
  }

  durdur(): void {
    this.durduruldu = true;
    if (this.zamanlayici) clearTimeout(this.zamanlayici);
    this.zamanlayici = null;
  }

  private planla(gecikmeMs: number): void {
    if (this.durduruldu) return;
    if (this.zamanlayici) clearTimeout(this.zamanlayici);
    this.zamanlayici = setTimeout(() => void this.tur(), gecikmeMs);
    // Zamanlayıcı uygulamanın kapanmasını engellemesin.
    this.zamanlayici.unref?.();
  }

  /** Kullanıcı ya da gün sonu tarafından elle tetikleme. */
  async simdiCalistir(): Promise<SenkronSonucu> {
    return this.tur(true);
  }

  private async tur(elle = false): Promise<SenkronSonucu> {
    if (this.calisiyor) {
      return {
        basarili: false,
        gonderilen: 0,
        yinelenen: 0,
        reddedilen: 0,
        cekilen: 0,
        cakisma: 0,
        sureMs: 0,
        hata: 'Senkron zaten çalışıyor.',
      };
    }
    const secenekler = this.secenekleriGetir();
    if (!secenekler || (!secenekler.aktif && !elle)) {
      this.planla(60_000);
      return {
        basarili: false,
        gonderilen: 0,
        yinelenen: 0,
        reddedilen: 0,
        cekilen: 0,
        cakisma: 0,
        sureMs: 0,
        hata: 'Senkron kapalı.',
      };
    }

    this.calisiyor = true;
    try {
      const sonuc = await senkronCalistir(this.baglam, secenekler);
      this.ardisikHata = sonuc.basarili ? 0 : this.ardisikHata + 1;
      this.bildirim?.(sonuc);

      const normalAralik = Math.max(1, secenekler.aralikDk) * 60_000;
      // Hata varsa üstel geri çekilme; yoksa normal aralık (§7.6).
      const gecikme = sonuc.basarili
        ? normalAralik
        : Math.min(SINIRLAR.BACKOFF_AZAMI_MS, 1000 * 2 ** Math.min(this.ardisikHata, 9));
      this.planla(gecikme);
      return sonuc;
    } finally {
      this.calisiyor = false;
    }
  }
}
