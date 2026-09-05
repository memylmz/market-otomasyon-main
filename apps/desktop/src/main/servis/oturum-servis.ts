/**
 * Kimlik doğrulama ve oturum yönetimi — §10.2, §15.1, §15.4.
 *
 *  - Doğrulama **tamamen çevrimdışı** yapılır; kullanıcı kayıtları senkronla iner.
 *  - Ardışık hatalı girişte hesap geçici kilitlenir (brute-force savunması).
 *  - Kullanıcı sayımı ne olursa olsun yanıt süresi benzer tutulur (kullanıcı adı
 *    numaralandırmasını zorlaştırmak için var olmayan kullanıcıda da hash hesaplanır).
 */

import { etkinYetkiler, hatalar, HATA_KODU, simdi, SINIRLAR, UygulamaHatasi, type Yetki } from '@market/shared';
import { parolaDogrula, parolaHashle, yenilenmeli } from '../guvenlik/parola.js';
import {
  girisBasarili,
  girisBasarisiz,
  gorunume,
  kilitliMi,
  kullaniciAdiIleBul,
  kullaniciBul,
  pinliKullanicilar,
  sifreGuncelle,
  type KullaniciGorunumu,
} from '../depo/kullanici.js';
import { acikOturum } from '../depo/kasa.js';
import { denetimYaz } from '../depo/ozet.js';
import type { Aktor, Baglam } from './baglam.js';

/** Var olmayan kullanıcıda da aynı maliyeti harcamak için kullanılan sahte hash. */
const SAHTE_HASH = parolaHashle('zaman-sabitleme-icin-sahte-parola');

export interface GirisSonucu {
  aktor: Aktor;
  kullanici: KullaniciGorunumu;
  kasaOturumId: string | null;
}

function aktoreCevir(kullanici: KullaniciGorunumu, kasaOturumId: string | null): Aktor {
  return {
    kullaniciId: kullanici.id,
    ad: kullanici.ad,
    rol: kullanici.rol,
    yetkiler: etkinYetkiler({
      rol: kullanici.rol,
      ekYetkiler: kullanici.ek_yetkiler,
      kaldirilanYetkiler: kullanici.kaldirilan_yetkiler,
    }),
    kasaOturumId,
  };
}

export type GirisYontemi = 'SIFRE' | 'PIN';

export function girisYap(baglam: Baglam, kullaniciAdi: string, parola: string, yontem: GirisYontemi = 'SIFRE'): GirisSonucu {
  const { vt, cihazId } = baglam;
  const zaman = simdi();
  const kullanici = kullaniciAdiIleBul(vt, kullaniciAdi);

  if (!kullanici || !kullanici.aktif_mi) {
    // Zaman sızıntısını azaltmak için var olmayan kullanıcıda da hash hesapla.
    parolaDogrula(parola, SAHTE_HASH);
    baglam.kayit.uyari('Başarısız giriş denemesi', { kullanici_adi: kullaniciAdi, sebep: 'bulunamadi' });
    throw hatalar.kimlik();
  }

  if (kilitliMi(kullanici, zaman)) {
    baglam.kayit.uyari('Kilitli hesaba giriş denemesi', { kullanici_id: kullanici.id });
    throw new UygulamaHatasi(HATA_KODU.HESAP_KILITLI, undefined, {
      detay: { kilit_bitis: kullanici.kilit_bitis },
    });
  }

  const hash = yontem === 'PIN' ? kullanici.pin_hash : kullanici.sifre_hash;
  if (!parolaDogrula(parola, hash ?? SAHTE_HASH)) {
    const sonuc = girisBasarisiz(vt, kullanici.id, SINIRLAR.HATALI_GIRIS_SINIRI, SINIRLAR.HESAP_KILIT_SN, zaman);
    baglam.kayit.uyari('Başarısız giriş denemesi', {
      kullanici_id: kullanici.id,
      yontem,
      kalan_hak: sonuc.kalanHak,
      kilitlendi: sonuc.kilitlendi,
    });
    if (sonuc.kilitlendi) {
      throw new UygulamaHatasi(HATA_KODU.HESAP_KILITLI, undefined, {
        detay: { saniye: SINIRLAR.HESAP_KILIT_SN },
      });
    }
    throw new UygulamaHatasi(HATA_KODU.KIMLIK, undefined, { detay: { kalan_hak: sonuc.kalanHak } });
  }

  // Parametreleri güçlenmiş bir hash varsa sessizce yenile.
  if (hash && yenilenmeli(hash)) {
    const yeni = parolaHashle(parola);
    sifreGuncelle(vt, kullanici.id, yontem === 'SIFRE' ? yeni : null, yontem === 'PIN' ? yeni : null, zaman);
  }

  girisBasarili(vt, kullanici.id, zaman);
  const oturum = acikOturum(vt, cihazId);
  const kasaOturumId = oturum && oturum.kullanici_id === kullanici.id ? oturum.id : null;

  denetimYaz(
    vt,
    { kullanici_id: kullanici.id, islem: 'GIRIS', entity: 'kullanici', entity_id: kullanici.id, yeni_deger: { yontem } },
    cihazId,
    zaman,
  );
  baglam.kayit.bilgi('Giriş yapıldı', { kullanici_id: kullanici.id, rol: kullanici.rol, yontem });

  const gorunum = gorunume(kullanici);
  return { aktor: aktoreCevir(gorunum, kasaOturumId), kullanici: gorunum, kasaOturumId };
}

export function cikisYap(baglam: Baglam, aktor: Aktor): void {
  denetimYaz(
    baglam.vt,
    { kullanici_id: aktor.kullaniciId, islem: 'CIKIS', entity: 'kullanici', entity_id: aktor.kullaniciId },
    baglam.cihazId,
  );
  baglam.kayit.bilgi('Çıkış yapıldı', { kullanici_id: aktor.kullaniciId });
}

/**
 * Yetkili onayı (§10.1): kritik bir işlem için başka bir kullanıcının PIN'i
 * istenir. Onaylayanın ilgili yetkiye sahip olması şarttır.
 */
export function yetkiliOnayi(baglam: Baglam, kullaniciAdi: string, pin: string, gerekenYetki: Yetki): Aktor {
  const sonuc = girisYap(baglam, kullaniciAdi, pin, 'PIN');
  if (!sonuc.aktor.yetkiler.has(gerekenYetki)) {
    throw new UygulamaHatasi(HATA_KODU.YETKI, 'Onaylayan kullanıcının bu işlem için yetkisi yok.', {
      detay: { gereken_yetki: gerekenYetki },
    });
  }
  denetimYaz(
    baglam.vt,
    { kullanici_id: sonuc.aktor.kullaniciId, islem: 'YETKILI_ONAYI', entity: 'yetki', entity_id: gerekenYetki },
    baglam.cihazId,
  );
  return sonuc.aktor;
}

/** Aktörü veritabanından tazeler (yetkiler senkronla değişmiş olabilir). */
export function aktoruTazele(baglam: Baglam, kullaniciId: string, kasaOturumId: string | null): Aktor | null {
  const kullanici = kullaniciBul(baglam.vt, kullaniciId);
  if (!kullanici || !kullanici.aktif_mi) return null;
  return aktoreCevir(gorunume(kullanici), kasaOturumId);
}

/** Giriş ekranında gösterilecek hızlı kullanıcı listesi (vardiya değişimi). */
export function hizliKullanicilar(baglam: Baglam): KullaniciGorunumu[] {
  return pinliKullanicilar(baglam.vt);
}
