/**
 * Yedekleme ve felaket kurtarma — §18.
 *
 * Yaklaşım:
 *  - Yedek `VACUUM INTO` ile alınır. Bu, WAL dosyası dahil **tutarlı ve sıkışık**
 *    bir kopya üretir; dosyayı kopyalamak gibi yarım işlem yakalama riski yoktur.
 *  - Alındıktan hemen sonra `PRAGMA integrity_check` ile doğrulanır (§18.4);
 *    doğrulanmamış bir dosya yedek sayılmaz.
 *  - İsteğe bağlı AES-256-GCM şifreleme (§15.5) — anahtar dışarıdan verilir.
 *  - Son N sürüm saklanır, eskileri temizlenir; ikincil klasöre (USB/ağ/OneDrive)
 *    kopyalanır ve ORADA da son N sürüm tutulur.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { butunlukKontrolu, veritabaniAc, type Vt } from '../db/surucu.js';
import { HEDEF_SEMA_SURUMU } from '../db/gocler.js';
import { mevcutSurum } from '../db/gocmen.js';
import { ayarMetin, ayarYaz } from '../depo/ayar.js';
import { denetimYaz } from '../depo/ozet.js';
import { dosyaSifreCoz, dosyaSifrele, SIFRELI_UZANTI } from '../guvenlik/sifreleme.js';
import { yetkiIste, type Aktor, type Baglam } from './baglam.js';
import { aramaNormalize, AYAR, hatalar, simdi } from '@market/shared';

export interface YedekBilgisi {
  dosya: string;
  yol: string;
  boyut: number;
  zaman: string;
  sifreli: boolean;
  /**
   * İkincil klasöre kopya sonucu (klasör tanımlı değilse yok). Kopya
   * başarısızsa yedek yine geçerlidir; ama kullanıcı "ikinci kopyam var"
   * sanmasın diye sonuç ekrana taşınır — eskiden yalnız loga yazılıyordu.
   */
  ikincil?: { basarili: boolean; hata?: string };
}

/** Yedek ayarları. HER KULLANIMDA veritabanından okunur; değişiklik yeniden başlatma beklemez. */
export interface YedekAyarlari {
  ikincilKlasor: string | null;
  saklananAdet: number;
  siklikSaat: number;
}

export function yedekAyarlariniOku(vt: Vt): YedekAyarlari {
  const tamSayi = (anahtar: string, varsayilan: number): number => {
    const n = Number(ayarMetin(vt, anahtar, String(varsayilan)));
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : varsayilan;
  };
  return {
    ikincilKlasor: ayarMetin(vt, AYAR.YEDEK_IKINCIL_KLASOR, '').trim() || null,
    saklananAdet: tamSayi(AYAR.YEDEK_SAKLANAN_ADET, 10),
    siklikSaat: tamSayi(AYAR.YEDEK_SIKLIK_SAAT, 6),
  };
}

/**
 * Otomatik yedek zamanı geldi mi? Sayaç "programın açılışından" değil SON
 * YEDEKTEN başlar: program her gün 6 saatten kısa açık kalsa da yedek alınır.
 * Son yedek ileri tarihli görünüyorsa (saat geri alınmış) yedek alınır.
 */
export function otomatikYedekGerekliMi(
  sonYedekZamani: string | null | undefined,
  siklikSaat: number,
  simdiMs = Date.now(),
): boolean {
  if (!sonYedekZamani) return true;
  const gecen = simdiMs - Date.parse(sonYedekZamani);
  if (!Number.isFinite(gecen)) return true;
  return gecen < 0 || gecen >= siklikSaat * 3_600_000;
}

export interface YedekSecenekleri {
  /** Verilirse yedek bu anahtarla şifrelenir. */
  sifrelemeAnahtari?: Buffer | null;
  /** Ek konum (USB / ağ klasörü) — §18.2 ikinci kopya. */
  ikincilKlasor?: string | null;
  saklananAdet?: number;
  etiket?: string;
}

function damga(zaman = new Date()): string {
  return zaman.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Yedek alır ve bütünlüğünü doğrular. Doğrulama başarısızsa dosya silinir ve
 * hata fırlatılır — bozuk bir dosyanın "yedek" sanılması en tehlikeli durumdur.
 */
export async function yedekAl(baglam: Baglam, secenekler: YedekSecenekleri = {}): Promise<YedekBilgisi> {
  const { vt, yollar, kayit } = baglam;
  mkdirSync(yollar.yedekKlasoru, { recursive: true });

  const etiket = secenekler.etiket ? `-${secenekler.etiket.replace(/[^\w-]/g, '')}` : '';
  const dosyaAdi = `market-${damga()}${etiket}.db`;
  const gecici = join(yollar.yedekKlasoru, dosyaAdi);

  // VACUUM INTO transaction dışında çalışmalıdır.
  if (vt.islemIcindeMi()) throw new Error('Yedek transaction içinde alınamaz');
  vt.hazirla('VACUUM INTO ?').calistir(gecici);

  // Doğrulama: yedeği aç, integrity_check koştur, şema sürümünü oku.
  const dogrulama = await yedegiDogrula(gecici);
  if (!dogrulama.saglam) {
    rmSync(gecici, { force: true });
    throw new Error(`Yedek doğrulaması başarısız: ${dogrulama.detay}`);
  }

  let sonYol = gecici;
  let sifreli = false;
  if (secenekler.sifrelemeAnahtari) {
    sonYol = gecici + SIFRELI_UZANTI;
    dosyaSifrele(gecici, sonYol, secenekler.sifrelemeAnahtari);
    rmSync(gecici, { force: true });
    sifreli = true;
  }

  const saklanan = secenekler.saklananAdet ?? 10;

  // İkincil konum (USB / ağ / OneDrive) — başarısız olursa yedek yine geçerlidir.
  let ikincil: YedekBilgisi['ikincil'];
  if (secenekler.ikincilKlasor) {
    try {
      mkdirSync(secenekler.ikincilKlasor, { recursive: true });
      copyFileSync(sonYol, join(secenekler.ikincilKlasor, basename(sonYol)));
      ikincil = { basarili: true };
    } catch (hata) {
      const mesaj = hata instanceof Error ? hata.message : String(hata);
      ikincil = { basarili: false, hata: mesaj };
      kayit.uyari('İkincil yedek konumuna kopyalanamadı', { klasor: secenekler.ikincilKlasor, mesaj });
    }
    if (ikincil.basarili) {
      try {
        ikincilKlasoruTemizle(secenekler.ikincilKlasor, saklanan);
      } catch (hata) {
        kayit.uyari('İkincil yedek klasörü temizlenemedi', {
          klasor: secenekler.ikincilKlasor,
          mesaj: hata instanceof Error ? hata.message : String(hata),
        });
      }
    }
  }

  eskiYedekleriTemizle(baglam, saklanan);

  const durum = statSync(sonYol);
  kayit.bilgi('Yedek alındı', { dosya: basename(sonYol), boyut: durum.size, sifreli, sema_surumu: dogrulama.semaSurumu });

  return { dosya: basename(sonYol), yol: sonYol, boyut: durum.size, zaman: simdi(), sifreli, ...(ikincil ? { ikincil } : {}) };
}

const YEDEK_ADI = /^market-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/;

/** Klasördeki PROGRAMIN yedek dosyaları, en yenisi başta (sıra addaki zamandan). */
function programinYedekleri(klasor: string): string[] {
  return readdirSync(klasor)
    .filter((d) => YEDEK_ADI.test(d) && (d.endsWith('.db') || d.endsWith('.db' + SIFRELI_UZANTI)))
    .sort()
    .reverse();
}

export interface IkincilKlasorDurumu {
  yol: string | null;
  /** Klasör var ve yazılabiliyor mu (null = klasör tanımlı değil). */
  erisilebilir: boolean | null;
  hata?: string;
  /** Klasördeki yedek sayısı ve en yenisi. */
  adet: number;
  enYeni: string | null;
}

/** Klasöre gerçekten yazılabiliyor mu — küçük bir deneme dosyası yazılıp silinir. */
function yazilabilirMi(klasor: string): { tamam: true } | { tamam: false; hata: string } {
  try {
    mkdirSync(klasor, { recursive: true });
    const deneme = join(klasor, `.market-yazma-denemesi-${process.pid}`);
    writeFileSync(deneme, 'x');
    rmSync(deneme, { force: true });
    return { tamam: true };
  } catch (hata) {
    return { tamam: false, hata: hata instanceof Error ? hata.message : String(hata) };
  }
}

/** Ayarlar ekranındaki kart için: ikincil klasör tanımlı mı, erişilebilir mi, içinde kaç yedek var. */
export function ikincilKlasorDurumu(vt: Vt): IkincilKlasorDurumu {
  const yol = yedekAyarlariniOku(vt).ikincilKlasor;
  if (!yol) return { yol: null, erisilebilir: null, adet: 0, enYeni: null };
  if (!existsSync(yol))
    return { yol, erisilebilir: false, hata: 'Klasör bulunamadı (USB çıkarılmış olabilir).', adet: 0, enYeni: null };
  try {
    const yedekler = programinYedekleri(yol);
    return { yol, erisilebilir: true, adet: yedekler.length, enYeni: yedekler[0] ?? null };
  } catch (hata) {
    return { yol, erisilebilir: false, hata: hata instanceof Error ? hata.message : String(hata), adet: 0, enYeni: null };
  }
}

/**
 * İkincil klasörü HEMEN kaydeder (Kaydet düğmesi beklenmez).
 *
 * Eskiden klasör seçilince yalnız ekrandaki kutuya yazılıyor, ayar sayfanın
 * Kaydet düğmesine basılınca kaydediliyordu. "Şimdi Yedek Al" kayıtlı ayara
 * baktığı için kopya hiç alınmıyor, kullanıcı da klasörü kutuda görüp
 * kaydedildi sanıyordu. Kaydetmeden önce klasöre yazılabildiği denenir.
 */
export function ikincilKlasoruKaydet(baglam: Baglam, aktor: Aktor, yol: string | null): IkincilKlasorDurumu {
  yetkiIste(aktor, 'ayar.yonet');
  const temiz = yol?.trim() || '';
  if (temiz) {
    const deneme = yazilabilirMi(temiz);
    if (!deneme.tamam) throw hatalar.dogrulama(`Bu klasöre yazılamıyor: ${deneme.hata}`);
  }
  ayarYaz(baglam.vt, AYAR.YEDEK_IKINCIL_KLASOR, temiz);
  return ikincilKlasorDurumu(baglam.vt);
}

/**
 * İkincil klasörde yalnız son N yedeği bırakır.
 *
 * Eskiden ana klasör temizlenirken ikincil klasöre hiç dokunulmuyordu: günde
 * dört yedekle yılda ~1.500 dosya birikir, USB ya da OneDrive kotası dolardı.
 *
 * Bu klasör kullanıcının kendi klasörü olabilir (ör. OneDrive'ın kökü), o
 * yüzden YALNIZ programın ürettiği adlara dokunulur: `market-<zaman>….db`
 * (ve şifreliyse `.db.enc`). Sıra dosya adındaki zamandan alınır — bulut
 * eşitlemesi dosyaların değişiklik tarihini bozabilir, ad bozulmaz.
 */
export function ikincilKlasoruTemizle(klasor: string, saklanan: number): number {
  if (!existsSync(klasor)) return 0;
  const yedekler = programinYedekleri(klasor);
  const silinecekler = yedekler.slice(Math.max(1, saklanan));
  for (const dosya of silinecekler) {
    try {
      rmSync(join(klasor, dosya), { force: true });
    } catch {
      /* silinemeyen dosya kritik değil; bir sonraki yedekte yeniden denenir */
    }
  }
  return silinecekler.length;
}

export async function yedegiDogrula(yol: string): Promise<{ saglam: boolean; detay: string; semaSurumu: number }> {
  let vt: Vt | null = null;
  try {
    vt = await veritabaniAc(yol, { saltOkunur: true });
    const sonuc = butunlukKontrolu(vt);
    const surum = mevcutSurum(vt);
    return { saglam: sonuc.saglam, detay: sonuc.detay, semaSurumu: surum };
  } catch (hata) {
    return { saglam: false, detay: hata instanceof Error ? hata.message : String(hata), semaSurumu: 0 };
  } finally {
    vt?.kapat();
  }
}

export function yedekleriListele(baglam: Baglam): YedekBilgisi[] {
  const klasor = baglam.yollar.yedekKlasoru;
  if (!existsSync(klasor)) return [];
  return readdirSync(klasor)
    .filter((d) => d.endsWith('.db') || d.endsWith('.db' + SIFRELI_UZANTI))
    .map((d) => {
      const yol = join(klasor, d);
      const durum = statSync(yol);
      return { dosya: d, yol, boyut: durum.size, zaman: durum.mtime.toISOString(), sifreli: d.endsWith(SIFRELI_UZANTI) };
    })
    .sort((a, b) => b.zaman.localeCompare(a.zaman));
}

export function eskiYedekleriTemizle(baglam: Baglam, saklanan: number): number {
  const yedekler = yedekleriListele(baglam);
  const silinecekler = yedekler.slice(Math.max(1, saklanan));
  for (const yedek of silinecekler) {
    try {
      rmSync(yedek.yol, { force: true });
    } catch {
      /* silinemeyen dosya kritik değil */
    }
  }
  return silinecekler.length;
}

export interface GeriYuklemeSonucu {
  geriYuklenenDosya: string;
  oncekiYedek: string;
  yenidenBaslatmaGerekli: true;
}

/**
 * Yedekten geri yükleme (§18.3).
 *
 * Güvenlik ağı: mevcut veritabanı silinmez, `.geri-alma` uzantısıyla saklanır.
 * Yanlış yedek seçilirse veri geri getirilebilir. İşlem sonrası uygulama
 * yeniden başlatılmalıdır (açık bağlantılar eski dosyayı işaret eder).
 */
export async function yedektenGeriYukle(
  baglam: Baglam,
  aktor: Aktor,
  yedekYolu: string,
  sifrelemeAnahtari?: Buffer | null,
): Promise<GeriYuklemeSonucu> {
  yetkiIste(aktor, 'yedek.geri_yukle');
  const { vt, yollar, kayit } = baglam;

  if (!existsSync(yedekYolu)) throw hatalar.bulunamadi('Yedek dosyası');

  // Şifreliyse önce çöz.
  let kaynak = yedekYolu;
  let geciciCozulmus: string | null = null;
  if (yedekYolu.endsWith(SIFRELI_UZANTI)) {
    if (!sifrelemeAnahtari) throw hatalar.dogrulama('Bu yedek şifreli; çözme anahtarı gerekli.');
    mkdirSync(yollar.geciciKlasor, { recursive: true });
    geciciCozulmus = join(yollar.geciciKlasor, `geri-yukleme-${damga()}.db`);
    dosyaSifreCoz(yedekYolu, geciciCozulmus, sifrelemeAnahtari);
    kaynak = geciciCozulmus;
  }

  const dogrulama = await yedegiDogrula(kaynak);
  if (!dogrulama.saglam) {
    if (geciciCozulmus) rmSync(geciciCozulmus, { force: true });
    throw hatalar.dogrulama(`Seçilen yedek bozuk, geri yüklenemez: ${dogrulama.detay}`);
  }
  // Programın daha yeni bir sürümüyle alınmış yedek bu sürümde açılamaz;
  // dosya değiştirildikten sonra anlaşılırsa program hiç açılmazdı.
  if (dogrulama.semaSurumu > HEDEF_SEMA_SURUMU) {
    if (geciciCozulmus) rmSync(geciciCozulmus, { force: true });
    throw hatalar.dogrulama(
      'Bu yedek programın daha yeni bir sürümüyle alınmış. Önce programı güncelleyin, sonra geri yükleyin.',
    );
  }

  denetimYaz(
    vt,
    {
      kullanici_id: aktor.kullaniciId,
      islem: 'YEDEK_GERI_YUKLE',
      entity: 'sistem',
      yeni_deger: { yedek: basename(yedekYolu), sema_surumu: dogrulama.semaSurumu },
    },
    baglam.cihazId,
  );

  // Mevcut bağlantıyı kapatmadan dosya değiştirilemez.
  vt.kapat();

  const geriAlmaYolu = `${yollar.vtDosyasi}.geri-alma-${damga()}`;
  if (existsSync(yollar.vtDosyasi)) renameSync(yollar.vtDosyasi, geriAlmaYolu);
  // WAL ve SHM yan dosyaları eski veritabanına aittir; kalırlarsa yeni dosyayı bozarlar.
  for (const ek of ['-wal', '-shm']) {
    const yanDosya = yollar.vtDosyasi + ek;
    if (existsSync(yanDosya)) rmSync(yanDosya, { force: true });
  }
  copyFileSync(kaynak, yollar.vtDosyasi);
  if (geciciCozulmus) rmSync(geciciCozulmus, { force: true });

  kayit.uyari('Yedekten geri yükleme yapıldı', { yedek: basename(yedekYolu), geri_alma: basename(geriAlmaYolu) });
  return { geriYuklenenDosya: basename(yedekYolu), oncekiYedek: geriAlmaYolu, yenidenBaslatmaGerekli: true };
}

export interface SifirlamaSonucu {
  alinanYedek: string;
  geriAlmaYolu: string;
  yenidenBaslatmaGerekli: true;
}

/**
 * Tüm yerel veriyi sıfırlar: işletme, kullanıcılar, katalog, hareketler (§18.5).
 *
 * Neden satır silerek değil dosya düzeyinde: şema append-only'dir ve hareket
 * tablolarındaki tetikleyiciler `DELETE` denemesini reddeder. Tutarlı tek yol
 * veritabanı dosyasını devreden çıkarıp şemayı sıfırdan kurdurmaktır.
 *
 * Güvenlik ağı geri yüklemeyle aynıdır: önce zorunlu yedek alınır, ardından
 * mevcut dosya silinmez, `.sifirlama-oncesi` uzantısıyla saklanır. Yanlışlıkla
 * çalıştırılsa bile veri geri getirilebilir.
 */
export async function veriyiSifirla(baglam: Baglam, aktor: Aktor, onay: string): Promise<SifirlamaSonucu> {
  yetkiIste(aktor, 'veri.sifirla');
  const { vt, yollar, kayit } = baglam;

  /*
   * Yazılı onay: işletme adı birebir yazılmalı. Tek tuşla sıfırlanabilen bir
   * ekran, kasada yanlışlıkla tıklanmaya en açık yerdir. Kurulum yarım kaldıysa
   * işletme adı boştur; o durumda sabit söz istenir.
   */
  const isletmeAdi = ayarMetin(vt, AYAR.ISLETME_ADI, '').trim();
  const beklenen = isletmeAdi || 'SIFIRLA';
  /*
   * Karşılaştırma `aramaNormalize` ile yapılır. Türkçe'de "I" küçülünce noktasız
   * "ı" olur: `'SIFIRLA'.toLowerCase()` → "sıfırla". Düz karşılaştırmada kullanıcı
   * "sifirla" yazdığında eşleşmezdi; aynı tuzak "Yılmaz Market" gibi adlarda da var.
   * Büyük/küçük ve aksan farkını yutmak burada istenen davranıştır: aranan şey tuş
   * tuş doğruluk değil, kullanıcının bilinçli onayı.
   */
  if (aramaNormalize(onay) !== aramaNormalize(beklenen)) {
    throw hatalar.dogrulama(`Onay metni eşleşmiyor. Sıfırlamak için "${beklenen}" yazmalısınız.`);
  }

  // Zorunlu yedek: sıfırlama geri alınabilir olmadan yapılmaz.
  const ayar = yedekAyarlariniOku(vt);
  const yedek = await yedekAl(baglam, {
    etiket: 'sifirlama-oncesi',
    ikincilKlasor: ayar.ikincilKlasor,
    saklananAdet: ayar.saklananAdet,
  });

  // Denetim kaydı bağlantı kapanmadan yazılmalı; sonrasında bu veritabanı gider.
  denetimYaz(
    vt,
    {
      kullanici_id: aktor.kullaniciId,
      islem: 'VERI_SIFIRLA',
      entity: 'sistem',
      yeni_deger: { isletme: isletmeAdi, sema_surumu: mevcutSurum(vt), yedek: yedek.dosya },
    },
    baglam.cihazId,
  );

  // Mevcut bağlantıyı kapatmadan dosya değiştirilemez.
  vt.kapat();

  const geriAlmaYolu = `${yollar.vtDosyasi}.sifirlama-oncesi-${damga()}`;
  if (existsSync(yollar.vtDosyasi)) renameSync(yollar.vtDosyasi, geriAlmaYolu);
  // WAL ve SHM yan dosyaları eski veritabanına aittir; kalırlarsa yeni dosyayı bozarlar.
  for (const ek of ['-wal', '-shm']) {
    const yanDosya = yollar.vtDosyasi + ek;
    if (existsSync(yanDosya)) rmSync(yanDosya, { force: true });
  }

  kayit.uyari('Tüm veri sıfırlandı', { isletme: isletmeAdi, yedek: yedek.dosya, geri_alma: basename(geriAlmaYolu) });
  return { alinanYedek: yedek.dosya, geriAlmaYolu, yenidenBaslatmaGerekli: true };
}

/** Disk doluluk uyarısı (§20 "disk dolu" senaryosu). */
export function diskDurumu(baglam: Baglam): { vtBoyut: number; yedekBoyut: number; uyari: string | null } {
  const vtBoyut = existsSync(baglam.yollar.vtDosyasi) ? statSync(baglam.yollar.vtDosyasi).size : 0;
  const yedekBoyut = yedekleriListele(baglam).reduce((t, y) => t + y.boyut, 0);
  return { vtBoyut, yedekBoyut, uyari: null };
}
