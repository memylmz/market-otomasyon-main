/**
 * Yedekleme ve felaket kurtarma — §18.
 *
 * Yaklaşım:
 *  - Yedek `VACUUM INTO` ile alınır. Bu, WAL dosyası dahil **tutarlı ve sıkışık**
 *    bir kopya üretir; dosyayı kopyalamak gibi yarım işlem yakalama riski yoktur.
 *  - Alındıktan hemen sonra `PRAGMA integrity_check` ile doğrulanır (§18.4);
 *    doğrulanmamış bir dosya yedek sayılmaz.
 *  - İsteğe bağlı AES-256-GCM şifreleme (§15.5) — anahtar dışarıdan verilir.
 *  - Son N sürüm saklanır, eskileri temizlenir; ikincil klasöre (USB/ağ) kopyalanır.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { butunlukKontrolu, veritabaniAc, type Vt } from '../db/surucu.js';
import { mevcutSurum } from '../db/gocmen.js';
import { denetimYaz } from '../depo/ozet.js';
import { dosyaSifreCoz, dosyaSifrele, SIFRELI_UZANTI } from '../guvenlik/sifreleme.js';
import { yetkiIste, type Aktor, type Baglam } from './baglam.js';
import { hatalar, simdi } from '@market/shared';

export interface YedekBilgisi {
  dosya: string;
  yol: string;
  boyut: number;
  zaman: string;
  sifreli: boolean;
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

  // İkincil konum (USB / ağ) — başarısız olursa yedek yine geçerlidir, sadece uyarılır.
  if (secenekler.ikincilKlasor) {
    try {
      mkdirSync(secenekler.ikincilKlasor, { recursive: true });
      copyFileSync(sonYol, join(secenekler.ikincilKlasor, basename(sonYol)));
    } catch (hata) {
      kayit.uyari('İkincil yedek konumuna kopyalanamadı', {
        klasor: secenekler.ikincilKlasor,
        mesaj: hata instanceof Error ? hata.message : String(hata),
      });
    }
  }

  eskiYedekleriTemizle(baglam, secenekler.saklananAdet ?? 10);

  const durum = statSync(sonYol);
  kayit.bilgi('Yedek alındı', { dosya: basename(sonYol), boyut: durum.size, sifreli, sema_surumu: dogrulama.semaSurumu });

  return { dosya: basename(sonYol), yol: sonYol, boyut: durum.size, zaman: simdi(), sifreli };
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

/** Disk doluluk uyarısı (§20 "disk dolu" senaryosu). */
export function diskDurumu(baglam: Baglam): { vtBoyut: number; yedekBoyut: number; uyari: string | null } {
  const vtBoyut = existsSync(baglam.yollar.vtDosyasi) ? statSync(baglam.yollar.vtDosyasi).size : 0;
  const yedekBoyut = yedekleriListele(baglam).reduce((t, y) => t + y.boyut, 0);
  return { vtBoyut, yedekBoyut, uyari: null };
}
