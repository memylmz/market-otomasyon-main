/**
 * Yedek alma ve GERİ YÜKLEME (§18.2, §18.4).
 *
 * NEDEN VAR: yedek servisinin geri yükleme yolu hiç koşturulmamıştı; arayüzde
 * düğmesi olduğu için ilk denenme yeri felaket anı olacaktı. Test edilmemiş bir
 * geri yükleme yedek sayılmaz — bu dosya o yolu uçtan uca çalıştırır.
 *
 * Bellek içi veritabanıyla yapılamaz: geri yükleme DOSYA değiştirir, WAL yan
 * dosyalarını siler ve bağlantıyı kapatır. Bu yüzden gerçek disk kullanılır.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adet, AYAR, etkinYetkiler } from '@market/shared';
import { Uygulama } from '../src/main/uygulama.js';
import { stokOku } from '../src/main/depo/stok.js';
import { urunuKaydet } from '../src/main/servis/katalog-servis.js';
import { stokDuzeltme } from '../src/main/servis/stok-servis.js';
import { ayarYaz } from '../src/main/depo/ayar.js';
import { veritabaniAc } from '../src/main/db/surucu.js';
import { kanallariOlustur } from '../src/main/ipc/kanallar.js';
import {
  ikincilKlasorDurumu,
  ikincilKlasoruKaydet,
  otomatikYedekGerekliMi,
  veriyiSifirla,
  yedegiDogrula,
  yedekAl,
  yedekleriListele,
  yedektenGeriYukle,
} from '../src/main/servis/yedek-servis.js';
import type { Aktor } from '../src/main/servis/baglam.js';

let kok: string;
let uygulama: Uygulama;
let admin: Aktor;
let kasiyer: Aktor;

/** Diskteki veritabanıyla yeni bir Uygulama açar (geri yükleme sonrası şart). */
async function uygulamayiAc(): Promise<Uygulama> {
  return Uygulama.olustur({ veriKoku: kok, sessiz: true, zamanlayiciKapali: true });
}

beforeEach(async () => {
  kok = mkdtempSync(join(tmpdir(), 'market-yedek-'));
  uygulama = await uygulamayiAc();
  const adminId = uygulama.yoneticiOlustur({ ad: 'Patron', kullaniciAdi: 'patron', sifre: 'Sifre1234' });
  admin = {
    kullaniciId: adminId,
    ad: 'Patron',
    rol: 'ADMIN',
    yetkiler: etkinYetkiler({ rol: 'ADMIN' }),
    kasaOturumId: null,
  };
  kasiyer = { ...admin, rol: 'KASIYER', yetkiler: etkinYetkiler({ rol: 'KASIYER' }) };
});

afterEach(async () => {
  await uygulama?.kapat().catch(() => {});
  try {
    rmSync(kok, { recursive: true, force: true });
  } catch {
    /* işletim sistemi temizler */
  }
});

function urunEkle(ad: string, stok: number): string {
  return urunuKaydet(uygulama.baglam, admin, {
    ad,
    birim_tipi: 'ADET',
    satis_fiyati: 1000,
    alis_fiyati: 700,
    kdv_orani: 20,
    acilis_stogu: adet(stok),
  });
}

describe('yedek alma', () => {
  it('alınan yedek bütünlük kontrolünden geçer ve listelenir', async () => {
    urunEkle('Süt', 40);
    const bilgi = await yedekAl(uygulama.baglam, { etiket: 'test' });

    expect(existsSync(bilgi.yol)).toBe(true);
    expect(bilgi.boyut).toBeGreaterThan(0);

    const dogrulama = await yedegiDogrula(bilgi.yol);
    expect(dogrulama.saglam, dogrulama.detay).toBe(true);
    expect(dogrulama.semaSurumu).toBeGreaterThan(0);

    expect(yedekleriListele(uygulama.baglam).map((y) => y.dosya)).toContain(bilgi.dosya);
  });
});

describe('yedekten geri yükleme', () => {
  it('yedek sonrası yapılan değişikliği geri alır', async () => {
    const urunId = urunEkle('Kola', 100);
    expect(stokOku(uygulama.baglam.vt, urunId)).toBe(adet(100));

    const yedek = await yedekAl(uygulama.baglam, { etiket: 'once' });

    // Yedekten SONRA stok değiştirilir; geri yükleme bunu silmelidir.
    stokDuzeltme(uygulama.baglam, admin, urunId, adet(50), 'Sayım');
    expect(stokOku(uygulama.baglam.vt, urunId)).toBe(adet(50));

    const sonuc = await yedektenGeriYukle(uygulama.baglam, admin, yedek.yol);
    expect(sonuc.yenidenBaslatmaGerekli).toBe(true);

    // Geri yükleme bağlantıyı kapatır; dosyayı yeniden açıp bakarız.
    uygulama = await uygulamayiAc();
    expect(stokOku(uygulama.baglam.vt, urunId), 'stok yedekteki değere dönmeli').toBe(adet(100));
  });

  it('geri yüklemeden önceki veritabanını geri-alma dosyası olarak saklar', async () => {
    const urunId = urunEkle('Ekmek', 20);
    const yedek = await yedekAl(uygulama.baglam);
    stokDuzeltme(uygulama.baglam, admin, urunId, adet(5), 'Fire');

    const sonuc = await yedektenGeriYukle(uygulama.baglam, admin, yedek.yol);

    // Yanlış yedek seçilmiş olabilir; eski veri KAYBOLMAMALI.
    expect(existsSync(sonuc.oncekiYedek), 'geri-alma dosyası durmalı').toBe(true);
    const geriAlmaDogrulama = await yedegiDogrula(sonuc.oncekiYedek);
    expect(geriAlmaDogrulama.saglam, 'geri-alma dosyası da sağlam olmalı').toBe(true);

    uygulama = await uygulamayiAc();
  });

  it('WAL yan dosyaları geride bırakılmaz', async () => {
    urunEkle('Peynir', 10);
    const yedek = await yedekAl(uygulama.baglam);
    await yedektenGeriYukle(uygulama.baglam, admin, yedek.yol);

    // Eski WAL kalırsa yeni dosyanın üzerine uygulanır ve veritabanını bozar.
    const vtDosyasi = uygulama.yollar.vtDosyasi;
    expect(existsSync(vtDosyasi + '-wal'), 'eski -wal silinmeli').toBe(false);
    expect(existsSync(vtDosyasi + '-shm'), 'eski -shm silinmeli').toBe(false);

    uygulama = await uygulamayiAc();
  });

  it('bozuk yedeği reddeder ve mevcut veritabanına dokunmaz', async () => {
    const urunId = urunEkle('Yoğurt', 33);
    const bozuk = join(kok, 'bozuk.db');
    writeFileSync(bozuk, 'bu bir sqlite dosyası değil');

    await expect(yedektenGeriYukle(uygulama.baglam, admin, bozuk)).rejects.toThrow();

    // Bağlantı kapanmamış, veri yerinde olmalı.
    expect(stokOku(uygulama.baglam.vt, urunId)).toBe(adet(33));
    expect(
      readdirSync(join(kok, 'veri')).some((d) => d.includes('geri-alma')),
      'geri-alma üretilmemeli',
    ).toBe(false);
  });

  it('olmayan dosya için anlamlı hata verir', async () => {
    await expect(yedektenGeriYukle(uygulama.baglam, admin, join(kok, 'yok.db'))).rejects.toThrow();
  });

  it('yetkisiz kullanıcı geri yükleyemez', async () => {
    const yedek = await yedekAl(uygulama.baglam);
    await expect(yedektenGeriYukle(uygulama.baglam, kasiyer, yedek.yol)).rejects.toThrow();
  });
});

/**
 * İKİNCİL KLASÖR ve OTOMATİK YEDEK ZAMANLAMASI.
 *
 * NEDEN VAR: üç hata birlikte bulundu — ikincil klasör hiç temizlenmiyordu
 * (USB / OneDrive kotası dolar), otomatik yedek ayarları açılışta bir kez
 * okunuyordu (klasörü seçip kaydetmek yeniden başlatana kadar işlemiyordu) ve
 * sayaç her açılışta sıfırlanıyordu (6 saatten kısa açık kalan kasada hiç
 * otomatik yedek alınmıyordu).
 */
describe('ikincil yedek klasörü', () => {
  it('kopya yazılır, orada da son N yedek kalır; programın olmayan dosyalara dokunulmaz', async () => {
    const ikincil = join(kok, 'OneDrive', 'MarketYedek');
    mkdirSync(ikincil, { recursive: true });
    const eskiler = ['01', '02', '03', '04', '05'].map((g) => `market-2026-01-${g}T09-00-00-otomatik.db`);
    for (const ad of eskiler) writeFileSync(join(ikincil, ad), 'eski');
    const yabancilar = ['notlar.txt', 'market.db', 'goc-oncesi-1.db', 'market-fiyatlar.db'];
    for (const ad of yabancilar) writeFileSync(join(ikincil, ad), 'kullanıcının dosyası');

    const yedek = await yedekAl(uygulama.baglam, { ikincilKlasor: ikincil, saklananAdet: 3 });

    expect(yedek.ikincil).toEqual({ basarili: true });
    const kalan = readdirSync(ikincil);
    // En yeni 3: bugünkü yedek + 05 + 04 (sıra addaki zamandan).
    expect(kalan).toContain(yedek.dosya);
    expect(kalan).toContain(eskiler[4]);
    expect(kalan).toContain(eskiler[3]);
    expect(kalan).not.toContain(eskiler[0]);
    expect(kalan).not.toContain(eskiler[2]);
    for (const ad of yabancilar) expect(kalan, `${ad} silinmemeli`).toContain(ad);
  });

  it('kopyalanamazsa yedek yine geçerlidir ama sonuç başarısız döner', async () => {
    // Klasör yerine aynı adda bir DOSYA var — klasör oluşturulamaz.
    const engel = join(kok, 'engel');
    writeFileSync(engel, 'x');

    const yedek = await yedekAl(uygulama.baglam, { ikincilKlasor: engel });

    expect(yedek.ikincil?.basarili).toBe(false);
    expect(yedek.ikincil?.hata).toBeTruthy();
    expect((await yedegiDogrula(yedek.yol)).saglam).toBe(true);
  });
});

describe('ikincil klasörü kaydetme', () => {
  it('seçilen klasör hemen kaydedilir; ardından elle yedek oraya kopyalanır', async () => {
    const klasor = join(kok, 'OneDrive', 'MarketYedek');
    const durum = ikincilKlasoruKaydet(uygulama.baglam, admin, klasor);
    expect(durum).toMatchObject({ yol: klasor, erisilebilir: true, adet: 0 });

    // "Şimdi Yedek Al" kanalı KAYITLI ayarı okur — eskiden ayar kaydedilmediği için kopya alınmıyordu.
    uygulama.aktoruAyarla(admin);
    const yedek = await kanallariOlustur(uygulama)['yedek.al']({ etiket: 'elle' });
    expect(yedek.ikincil).toEqual({ basarili: true });
    expect(ikincilKlasorDurumu(uygulama.baglam.vt)).toMatchObject({ adet: 1, enYeni: yedek.dosya });
  });

  it('yazılamayan klasör kaydedilmez; boş verilirse ayar kaldırılır; kasiyer değiştiremez', () => {
    const engel = join(kok, 'dosya-klasor-degil');
    writeFileSync(engel, 'x');
    expect(() => ikincilKlasoruKaydet(uygulama.baglam, admin, join(engel, 'alt'))).toThrow(/yazılamıyor/);
    expect(ikincilKlasorDurumu(uygulama.baglam.vt).yol).toBeNull();

    ikincilKlasoruKaydet(uygulama.baglam, admin, join(kok, 'usb'));
    expect(ikincilKlasoruKaydet(uygulama.baglam, admin, null).yol).toBeNull();
    expect(() => ikincilKlasoruKaydet(uygulama.baglam, kasiyer, join(kok, 'usb'))).toThrow();
  });
});

describe('otomatik yedek zamanlaması', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sayaç son yedekten başlar', () => {
    const simdi = Date.parse('2026-10-29T12:00:00Z');
    expect(otomatikYedekGerekliMi(null, 6, simdi)).toBe(true);
    expect(otomatikYedekGerekliMi('2026-10-29T08:00:00Z', 6, simdi)).toBe(false);
    expect(otomatikYedekGerekliMi('2026-10-29T06:00:00Z', 6, simdi)).toBe(true);
    // Saat geri alınmış, son yedek "gelecekte" görünüyor → yedek alınır.
    expect(otomatikYedekGerekliMi('2026-10-30T08:00:00Z', 6, simdi)).toBe(true);
  });

  it('yedek yoksa alır, yeniyse almaz, süre dolunca yine alır; ikincil klasör yeniden başlatmadan işler', async () => {
    const ilk = await uygulama.otomatikYedekKontrolu();
    expect(ilk, 'hiç yedek yokken hemen alınmalı').not.toBeNull();
    expect(await uygulama.otomatikYedekKontrolu(), 'az önce alındı; tekrar alınmamalı').toBeNull();

    // Ayar program AÇIKKEN değişiyor.
    const ikincil = join(kok, 'usb');
    ayarYaz(uygulama.baglam.vt, AYAR.YEDEK_IKINCIL_KLASOR, ikincil);

    // 7 saat sonrası (dosya adındaki zaman da ilerlesin diye saat taklit edilir).
    const sonra = Date.now() + 7 * 3_600_000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(sonra);
    const ikinci = await uygulama.otomatikYedekKontrolu(null, sonra);

    expect(ikinci, '6 saat geçti; yedek alınmalı').not.toBeNull();
    expect(ikinci?.dosya).not.toBe(ilk?.dosya);
    expect(existsSync(join(ikincil, ikinci!.dosya)), 'yeni ayar yeniden başlatmadan uygulanmalı').toBe(true);
  });
});

/**
 * KURULUM EKRANINDAN GERİ YÜKLEME.
 *
 * NEDEN VAR: sıfırlamadan (ya da bilgisayar değişiminden) sonra program kurulum
 * sihirbazıyla açılıyordu ve sihirbazda geri yükleme yoktu. Sıfırlama sonrası
 * eski ekrandan "Geri Yükle"ye basmak da kapalı veritabanına çarpıp "Beklenmeyen
 * bir hata" veriyordu.
 */
describe('kurulum ekranından geri yükleme', () => {
  it('sıfırlamadan sonra sihirbazdan geri yüklenir; eski veri ve kurulum geri gelir', async () => {
    ayarYaz(uygulama.baglam.vt, AYAR.ISLETME_ADI, 'Test Market');
    ayarYaz(uygulama.baglam.vt, AYAR.KURULUM_TAMAMLANDI, '1');
    const urunId = urunEkle('Süt', 42);
    uygulama.aktoruAyarla(admin);

    await kanallariOlustur(uygulama)['veri.sifirla']({ onay: 'Test Market' });
    expect(uygulama.yenidenBaslatmaBekleniyor, 'sıfırlamadan sonra yeniden başlatma beklenmeli').toBe(true);

    // Program yeniden açıldı: boş veritabanı, kurulum ekranı.
    uygulama = await uygulamayiAc();
    expect(uygulama.kurulumGerekliMi()).toBe(true);
    const kanallar = kanallariOlustur(uygulama);
    const yedekler = await kanallar['kurulum.yedekler']();
    const sifirlamaOncesi = yedekler.find((y) => y.dosya.includes('sifirlama-oncesi'));
    expect(sifirlamaOncesi, 'sıfırlama öncesi yedek listede olmalı').toBeDefined();

    await kanallar['kurulum.geriYukle']({ yol: sifirlamaOncesi!.yol });
    expect(uygulama.yenidenBaslatmaBekleniyor).toBe(true);

    uygulama = await uygulamayiAc();
    expect(stokOku(uygulama.baglam.vt, urunId)).toBe(adet(42));
    expect(uygulama.kurulumGerekliMi(), 'yedekteki kurulum ve yönetici geri gelmeli').toBe(false);
  });

  it('kurulmuş kasada oturum açmadan geri yükleme yapılamaz', async () => {
    ayarYaz(uygulama.baglam.vt, AYAR.KURULUM_TAMAMLANDI, '1');
    const yedek = await yedekAl(uygulama.baglam);
    const kanallar = kanallariOlustur(uygulama);

    await expect(kanallar['kurulum.geriYukle']({ yol: yedek.yol })).rejects.toThrow(/tamamlanmış/);
    expect(() => kanallar['kurulum.yedekler']()).toThrow(/tamamlanmış/);
    expect(uygulama.yenidenBaslatmaBekleniyor).toBe(false);
  });

  it('programın daha yeni sürümüyle alınmış yedek reddedilir, mevcut veriye dokunulmaz', async () => {
    const urunId = urunEkle('Ekmek', 15);
    const yedek = await yedekAl(uygulama.baglam);
    const yeni = await veritabaniAc(yedek.yol);
    yeni.hazirla('INSERT INTO sema_gocleri (surum, ad, uygulanma) VALUES (?, ?, ?)').calistir(9999, 'gelecek', '2030-01-01');
    yeni.kapat();

    await expect(yedektenGeriYukle(uygulama.baglam, admin, yedek.yol)).rejects.toThrow(/daha yeni/);
    expect(stokOku(uygulama.baglam.vt, urunId), 'bağlantı açık, veri yerinde').toBe(adet(15));
  });
});

describe('şifreli yedek', () => {
  it('şifrelenir, çözülür ve aynı veriyi geri getirir', async () => {
    const anahtar = randomBytes(32);
    const urunId = urunEkle('Çikolata', 77);

    const yedek = await yedekAl(uygulama.baglam, { sifrelemeAnahtari: anahtar });
    expect(yedek.sifreli, 'yedek şifreli işaretlenmeli').toBe(true);
    expect(yedek.dosya.endsWith('.enc')).toBe(true);

    stokDuzeltme(uygulama.baglam, admin, urunId, adet(1), 'Fire');

    await yedektenGeriYukle(uygulama.baglam, admin, yedek.yol, anahtar);
    uygulama = await uygulamayiAc();
    expect(stokOku(uygulama.baglam.vt, urunId)).toBe(adet(77));
  });

  it('anahtar verilmezse şifreli yedek geri yüklenmez', async () => {
    const anahtar = randomBytes(32);
    const yedek = await yedekAl(uygulama.baglam, { sifrelemeAnahtari: anahtar });
    await expect(yedektenGeriYukle(uygulama.baglam, admin, yedek.yol)).rejects.toThrow(/anahtar/i);
  });
});

/**
 * TÜM VERİYİ SIFIRLAMA (§18.5).
 *
 * NEDEN VAR: sıfırlamanın belgelenmiş yolu "%APPDATA% klasörünü elle sil"di;
 * yanlış klasörü silmek ya da yedeksiz silmek kullanıcının elindeydi. Bu yol
 * artık uygulamanın içinde olduğu için üç güvencesi de test edilmeli: yazılı
 * onay, zorunlu yedek ve geri-alma dosyası.
 */
describe('tüm veriyi sıfırlama', () => {
  it('işletme adı birebir yazılmadan sıfırlamaz ve veriye dokunmaz', async () => {
    ayarYaz(uygulama.baglam.vt, AYAR.ISLETME_ADI, 'Test Market');
    const urunId = urunEkle('Süt', 42);

    await expect(veriyiSifirla(uygulama.baglam, admin, 'test')).rejects.toThrow(/eşleşmiyor/i);

    // Bağlantı kapanmamış, veri yerinde olmalı.
    expect(stokOku(uygulama.baglam.vt, urunId)).toBe(adet(42));
    expect(
      readdirSync(join(kok, 'veri')).some((d) => d.includes('sifirlama-oncesi')),
      'geri-alma dosyası üretilmemeli',
    ).toBe(false);
  });

  it('doğru onayla sıfırlar; zorunlu yedek alır ve eski veritabanını saklar', async () => {
    ayarYaz(uygulama.baglam.vt, AYAR.ISLETME_ADI, 'Test Market');
    ayarYaz(uygulama.baglam.vt, 'kurulum.tamamlandi', '1');
    urunEkle('Ekmek', 12);

    // Büyük/küçük harf farkı onayı bozmamalı; kasiyer klavyesi Caps Lock'ta olabilir.
    const sonuc = await veriyiSifirla(uygulama.baglam, admin, '  test market  ');
    expect(sonuc.yenidenBaslatmaGerekli).toBe(true);

    // Zorunlu yedek: sıfırlama geri alınabilir olmadan yapılmamalı.
    expect(sonuc.alinanYedek).toContain('sifirlama-oncesi');
    expect(existsSync(sonuc.geriAlmaYolu), 'eski veritabanı saklanmalı').toBe(true);
    expect((await yedegiDogrula(sonuc.geriAlmaYolu)).saglam, 'saklanan dosya sağlam olmalı').toBe(true);

    // Yeniden açılan uygulama boş: kurulum sihirbazı gelmeli.
    uygulama = await uygulamayiAc();
    expect(uygulama.kurulumGerekliMi(), 'sıfırlama sonrası kurulum istenmeli').toBe(true);
    expect(yedekleriListele(uygulama.baglam).some((y) => y.dosya === sonuc.alinanYedek)).toBe(true);
  });

  it('işletme adı boşsa işletme adı yerine SIFIRLA sözünü ister', async () => {
    // Kurulum yarım kalmış kasa: onay sözü olarak kullanılacak bir ad yok.
    ayarYaz(uygulama.baglam.vt, AYAR.ISLETME_ADI, '');

    await expect(veriyiSifirla(uygulama.baglam, admin, 'Market')).rejects.toThrow(/SIFIRLA/);

    const sonuc = await veriyiSifirla(uygulama.baglam, admin, 'sifirla');
    expect(sonuc.yenidenBaslatmaGerekli).toBe(true);

    uygulama = await uygulamayiAc();
  });

  it('WAL yan dosyaları geride bırakılmaz', async () => {
    ayarYaz(uygulama.baglam.vt, AYAR.ISLETME_ADI, 'Test Market');
    urunEkle('Peynir', 8);
    const sonuc = await veriyiSifirla(uygulama.baglam, admin, 'Test Market');

    // Eski WAL kalırsa yeni boş dosyanın üzerine uygulanır ve veritabanını bozar.
    const vtDosyasi = uygulama.yollar.vtDosyasi;
    expect(existsSync(vtDosyasi + '-wal'), 'eski -wal silinmeli').toBe(false);
    expect(existsSync(vtDosyasi + '-shm'), 'eski -shm silinmeli').toBe(false);
    expect(existsSync(sonuc.geriAlmaYolu)).toBe(true);

    uygulama = await uygulamayiAc();
  });

  it('kasiyer sıfırlayamaz — yetki ADMİNe aittir', async () => {
    const urunId = urunEkle('Yoğurt', 5);
    await expect(veriyiSifirla(uygulama.baglam, kasiyer, 'SIFIRLA')).rejects.toThrow();
    expect(stokOku(uygulama.baglam.vt, urunId)).toBe(adet(5));
  });
});
