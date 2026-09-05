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

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet, etkinYetkiler } from '@market/shared';
import { Uygulama } from '../src/main/uygulama.js';
import { stokOku } from '../src/main/depo/stok.js';
import { urunuKaydet } from '../src/main/servis/katalog-servis.js';
import { stokDuzeltme } from '../src/main/servis/stok-servis.js';
import { yedekAl, yedegiDogrula, yedekleriListele, yedektenGeriYukle } from '../src/main/servis/yedek-servis.js';
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
