/**
 * Giriş, hesap kilidi ve kasa oturumu eşleşmesi (§9.1, §12.1).
 *
 * NEDEN VAR: `oturum-servis` 148 satırdı ve HİÇ testi yoktu. Sahada "kasa açık
 * görünüyor ama satış 'açık kasa yok' diyor" hatası tam olarak buradaki
 * eşleşme koşulundan çıktı — testi olsaydı canlıda değil burada görünürdü.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SINIRLAR } from '@market/shared';
import { girisYap, cikisYap, yetkiliOnayi, aktoruTazele } from '../src/main/servis/oturum-servis.js';
import { kullaniciKaydet } from '../src/main/depo/kullanici.js';
import { parolaHashle } from '../src/main/guvenlik/parola.js';
import { kasaAc } from '../src/main/servis/kasa-servis.js';
import { testOrtamiKur, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur({ kasaAc: false });
});

afterEach(async () => {
  await ortam.temizle();
});

/** Testte kullanıcı açar; helper şifre/PIN vermediği için burada veriyoruz. */
function kullaniciAc(kullaniciAdi: string, sifre: string, rol: 'ADMIN' | 'MUDUR' | 'KASIYER' = 'KASIYER', pin?: string) {
  const { vt } = ortam.uygulama.baglam;
  return vt.islem(() =>
    kullaniciKaydet(
      vt,
      {
        ad: kullaniciAdi,
        kullanici_adi: kullaniciAdi,
        rol,
        sifre_hash: parolaHashle(sifre),
        pin_hash: pin ? parolaHashle(pin) : null,
      },
      ortam.uygulama.cihazId,
    ),
  );
}

describe('giriş', () => {
  it('doğru şifreyle giriş yapar ve yetkileri yükler', () => {
    kullaniciAc('ayse', 'Sifre1234', 'MUDUR');
    const sonuc = girisYap(ortam.uygulama.baglam, 'ayse', 'Sifre1234');
    expect(sonuc.kullanici.kullanici_adi).toBe('ayse');
    expect(sonuc.aktor.rol).toBe('MUDUR');
    expect(sonuc.aktor.yetkiler.size).toBeGreaterThan(0);
  });

  it('yanlış şifreyi reddeder', () => {
    kullaniciAc('ayse', 'Sifre1234');
    expect(() => girisYap(ortam.uygulama.baglam, 'ayse', 'YanlisSifre')).toThrow();
  });

  it('olmayan kullanıcıyı reddeder', () => {
    expect(() => girisYap(ortam.uygulama.baglam, 'yok', 'Sifre1234')).toThrow();
  });

  it('pasif kullanıcı giriş yapamaz', () => {
    const id = kullaniciAc('eski', 'Sifre1234');
    ortam.uygulama.baglam.vt.hazirla('UPDATE kullanicilar SET aktif_mi = 0 WHERE id = ?').calistir(id);
    expect(() => girisYap(ortam.uygulama.baglam, 'eski', 'Sifre1234')).toThrow();
  });

  it('PIN ile giriş ayrı bir yöntemdir; şifre PIN yerine geçmez', () => {
    kullaniciAc('hizli', 'Sifre1234', 'KASIYER', '4271');
    expect(girisYap(ortam.uygulama.baglam, 'hizli', '4271', 'PIN').kullanici.kullanici_adi).toBe('hizli');
    expect(() => girisYap(ortam.uygulama.baglam, 'hizli', 'Sifre1234', 'PIN')).toThrow();
  });
});

describe('hesap kilidi', () => {
  /**
   * Kaba kuvvet koruması: kasa fiziksel olarak erişilebilir bir cihazdır,
   * sınırsız PIN denemesi 4 haneyi dakikalar içinde kırar.
   */
  it('art arda hatalı denemeden sonra hesabı kilitler', () => {
    kullaniciAc('kilitli', 'Sifre1234');
    for (let i = 0; i < SINIRLAR.HATALI_GIRIS_SINIRI; i++) {
      expect(() => girisYap(ortam.uygulama.baglam, 'kilitli', 'Yanlis' + i)).toThrow();
    }
    // Kilitliyken DOĞRU şifre bile geçmemeli.
    expect(() => girisYap(ortam.uygulama.baglam, 'kilitli', 'Sifre1234')).toThrow();
  });

  it('başarılı giriş hatalı deneme sayacını sıfırlar', () => {
    kullaniciAc('sayac', 'Sifre1234');
    expect(() => girisYap(ortam.uygulama.baglam, 'sayac', 'Yanlis')).toThrow();
    girisYap(ortam.uygulama.baglam, 'sayac', 'Sifre1234');

    const satir = ortam.uygulama.baglam.vt
      .hazirla("SELECT hatali_giris FROM kullanicilar WHERE kullanici_adi = 'sayac'")
      .tek<{ hatali_giris: number }>();
    expect(Number(satir?.hatali_giris)).toBe(0);
  });
});

describe('kasa oturumu eşleşmesi', () => {
  /**
   * Bu, sahada karşılaşılan hatanın tam senaryosu: cihazda açık bir kasa var
   * ama BAŞKASINA ait. O kullanıcı satış yapamamalı, ama ekranda da açık kasa
   * görmemelidir — aksi hâlde "kasa açık ama satış yok diyor" çelişkisi doğar.
   */
  it('kendi açtığı kasa oturumunu devralır', () => {
    kullaniciAc('kasiyer1', 'Sifre1234');
    const ilk = girisYap(ortam.uygulama.baglam, 'kasiyer1', 'Sifre1234');
    const oturum = kasaAc(ortam.uygulama.baglam, ilk.aktor, 10_000);

    const ikinci = girisYap(ortam.uygulama.baglam, 'kasiyer1', 'Sifre1234');
    expect(ikinci.kasaOturumId, 'kendi kasası devralınmalı').toBe(oturum.oturumId);
  });

  it('başkasının açık kasasını devralmaz', () => {
    kullaniciAc('kasiyer1', 'Sifre1234');
    kullaniciAc('kasiyer2', 'Sifre1234');

    const birinci = girisYap(ortam.uygulama.baglam, 'kasiyer1', 'Sifre1234');
    kasaAc(ortam.uygulama.baglam, birinci.aktor, 10_000);

    const ikinci = girisYap(ortam.uygulama.baglam, 'kasiyer2', 'Sifre1234');
    expect(ikinci.kasaOturumId, 'başkasının kasası devralınmamalı').toBeNull();
  });
});

describe('yetkili onayı', () => {
  /**
   * Kasiyerin yetkisi yetmediğinde müdür PIN'iyle o TEK işlemi onaylar.
   * Oturum DEĞİŞMEZ: onay geçici bir aktör üretir.
   */
  it('yetkisi olan müdürün PINi geçici aktör üretir', () => {
    kullaniciAc('mudur', 'Sifre1234', 'MUDUR', '9911');
    const onaylayan = yetkiliOnayi(ortam.uygulama.baglam, 'mudur', '9911', 'satis.iptal');
    expect(onaylayan.rol).toBe('MUDUR');
    expect(onaylayan.yetkiler.has('satis.iptal')).toBe(true);
  });

  it('gereken yetkisi olmayan kişi onaylayamaz', () => {
    kullaniciAc('yetkisiz', 'Sifre1234', 'KASIYER', '1234');
    expect(() => yetkiliOnayi(ortam.uygulama.baglam, 'yetkisiz', '1234', 'satis.iptal')).toThrow();
  });

  it('yanlış PIN onaylamaz', () => {
    kullaniciAc('mudur', 'Sifre1234', 'MUDUR', '9911');
    expect(() => yetkiliOnayi(ortam.uygulama.baglam, 'mudur', '0000', 'satis.iptal')).toThrow();
  });
});

describe('aktör tazeleme ve çıkış', () => {
  it('silinmiş kullanıcı için tazeleme null döner', () => {
    expect(aktoruTazele(ortam.uygulama.baglam, 'olmayan-id', null)).toBeNull();
  });

  it('çıkış denetim kaydı bırakır', () => {
    kullaniciAc('cikan', 'Sifre1234');
    const sonuc = girisYap(ortam.uygulama.baglam, 'cikan', 'Sifre1234');
    cikisYap(ortam.uygulama.baglam, sonuc.aktor);

    const kayit = ortam.uygulama.baglam.vt
      .hazirla("SELECT COUNT(*) AS n FROM denetim_log WHERE islem = 'CIKIS' AND kullanici_id = ?")
      .tek<{ n: number }>(sonuc.aktor.kullaniciId);
    expect(Number(kayit?.n)).toBeGreaterThan(0);
  });
});
