/**
 * Kullanıcı silme kararı (§12.1).
 *
 * Personel KASADAN YÖNETİLMEZ: tanımlama ve silme yalnız yönetim panelinde,
 * yalnız işletme sahibi tarafından yapılır. Buradaki tek iş, panelden inen
 * silme talimatını yerelde uygulamaktır — ve bu tek bir bayrak çevirmekten
 * ibaret değil: hangi kaydın gerçekten silinebileceğine karar vermek için
 * yedi tabloyu yoklamak gerekiyor.
 */

import { simdi } from '@market/shared';
import { kullaniciBul } from '../depo/kullanici.js';
import { denetimYaz } from '../depo/ozet.js';
import { type Baglam } from './baglam.js';

/**
 * `kullanicilar`'a yabancı anahtarla bağlı tablolar.
 *
 * Sürücü `PRAGMA foreign_keys = ON` ile çalıştığı için bunlardan birinde kaydı
 * olan kullanıcıyı SİLMEK zaten veritabanı tarafından reddedilirdi. Biz hatayı
 * beklemek yerine önce sayıyoruz: böylece kullanıcıya "34 satışı var" gibi
 * anlamlı bir gerekçe gösterebiliyoruz.
 */
const BAGLI_TABLOLAR = [
  'satislar',
  'stok_hareketleri',
  'kasa_oturumlari',
  'kasa_hareketleri',
  'cari_hareketler',
  'sayimlar',
  'alis_faturalari',
] as const;

export interface KullaniciSilmeSonucu {
  /** true → satır tamamen silindi. false → kaydı olduğu için pasife alındı. */
  silindi: boolean;
  /** Bağlı tablolarda bulunan toplam kayıt sayısı. */
  kayitSayisi: number;
  ad: string;
}

/** Kullanıcının bağlı tablolardaki toplam kayıt sayısı. */
export function kullaniciKayitSayisi(baglam: Baglam, kullaniciId: string): number {
  return BAGLI_TABLOLAR.reduce((toplam, tablo) => {
    const satir = baglam.vt
      .hazirla(`SELECT COUNT(*) AS adet FROM ${tablo} WHERE kullanici_id = ?`)
      .tek<{ adet: number }>(kullaniciId);
    return toplam + Number(satir?.adet ?? 0);
  }, 0);
}

/**
 * Buluttan gelen "silindi" bayrağını yerelde uygular (§7.2 pull).
 *
 * Yetki aranmaz: bunu bir kullanıcı değil, senkron motoru çağırır. Karar
 * yerelde yeniden verilir — merkezde kaydı olmayan kullanıcının bu kasada
 * satışı olabilir; o durumda satır silinmez, girişi kapatılır.
 */
export function kullaniciyiSenkrondanSil(baglam: Baglam, kullaniciId: string): KullaniciSilmeSonucu | null {
  const kullanici = kullaniciBul(baglam.vt, kullaniciId);
  if (!kullanici) return null;

  const { vt, cihazId } = baglam;
  const zaman = simdi();
  const kayitSayisi = kullaniciKayitSayisi(baglam, kullaniciId);
  const silinebilir = kayitSayisi === 0;

  vt.islem(() => {
    if (silinebilir) {
      vt.hazirla('DELETE FROM kullanicilar WHERE id = ?').calistir(kullaniciId);
    } else {
      vt.hazirla('UPDATE kullanicilar SET aktif_mi = 0, updated_at = ? WHERE id = ?').calistir(zaman, kullaniciId);
    }
    denetimYaz(
      vt,
      {
        kullanici_id: null,
        islem: silinebilir ? 'KULLANICI_SIL' : 'KULLANICI_PASIFLESTIR',
        entity: 'kullanici',
        entity_id: kullaniciId,
        eski_deger: { ad: kullanici.ad, kullanici_adi: kullanici.kullanici_adi, kaynak: 'senkron' },
        yeni_deger: { silindi: silinebilir, kayit_sayisi: kayitSayisi },
      },
      cihazId,
      zaman,
    );
  });

  return { silindi: silinebilir, kayitSayisi, ad: kullanici.ad };
}
