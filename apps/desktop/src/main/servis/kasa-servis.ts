/**
 * Kasa / vardiya servisi — §10.8.
 *
 * Gün sonu (Z benzeri özet): beklenen nakit hareketlerden hesaplanır, sayılan
 * nakit ile karşılaştırılır ve kasa farkı kalıcı olarak kaydedilir.
 */

import { gunAnahtari, hatalar, HATA_KODU, simdi, uuid, type Kurus } from '@market/shared';
import {
  acikOturum,
  kasaHareketEkle,
  oturumAc,
  oturumHareketleri,
  oturumKapat,
  oturumOzeti,
  oturumBul,
  oturumVeresiyeSatislari,
  type KasaHareketiKaydi,
  type KasaOzeti,
} from '../depo/kasa.js';
import { denetimYaz, gunlukOzetEkle } from '../depo/ozet.js';
import { olayYaz } from '../depo/senkron.js';
import { ayarlariOku, kasaOturumuIste, yetkiIste, type Aktor, type Baglam } from './baglam.js';

export interface KasaAcilisSonucu {
  oturumId: string;
  acilisBakiye: Kurus;
}

export function kasaAc(baglam: Baglam, aktor: Aktor, acilisBakiye: Kurus): KasaAcilisSonucu {
  yetkiIste(aktor, 'kasa.ac');
  const { vt, cihazId } = baglam;
  const zaman = simdi();

  const mevcut = acikOturum(vt, cihazId);
  if (mevcut) {
    throw hatalar.isKurali(HATA_KODU.KASA_ZATEN_ACIK, 'Bu cihazda zaten açık bir kasa oturumu var.', {
      oturum_id: mevcut.id,
      kullanici: mevcut.kullanici_adi,
    });
  }
  if (acilisBakiye < 0) throw hatalar.dogrulama('Açılış bakiyesi negatif olamaz.');

  let oturumId = '';
  vt.islem(() => {
    oturumId = oturumAc(vt, aktor.kullaniciId, acilisBakiye, cihazId, zaman);
    olayYaz(
      vt,
      {
        id: uuid(),
        olay_tipi: 'KASA_OTURUM_ACILDI',
        entity: 'kasa_oturumu',
        entity_id: oturumId,
        veri: { id: oturumId, kullanici_id: aktor.kullaniciId, acilis_zamani: zaman, acilis_bakiye: acilisBakiye },
        olusturma_zamani: zaman,
      },
      cihazId,
      zaman,
    );
    denetimYaz(
      vt,
      {
        kullanici_id: aktor.kullaniciId,
        islem: 'KASA_AC',
        entity: 'kasa_oturumu',
        entity_id: oturumId,
        yeni_deger: { acilis_bakiye: acilisBakiye },
      },
      cihazId,
      zaman,
    );
  });

  aktor.kasaOturumId = oturumId;
  baglam.kayit.bilgi('Kasa açıldı', { oturum_id: oturumId, kullanici_id: aktor.kullaniciId, acilis_bakiye: acilisBakiye });
  return { oturumId, acilisBakiye };
}

export interface GunSonuSonucu {
  oturumId: string;
  ozet: KasaOzeti;
  sayilanNakit: Kurus;
  beklenenNakit: Kurus;
  kasaFarki: Kurus;
  /** Fark ayarlanan eşiği aşıyorsa true — yöneticiye bildirilir. */
  farkEsigiAsildi: boolean;
}

export function gunSonu(baglam: Baglam, aktor: Aktor, sayilanNakit: Kurus, notlar?: string): GunSonuSonucu {
  yetkiIste(aktor, 'kasa.kapat');
  const oturumId = kasaOturumuIste(aktor);
  const { vt, cihazId } = baglam;
  const zaman = simdi();
  const ayarlar = ayarlariOku(baglam);

  const oturum = oturumBul(vt, oturumId);
  if (!oturum) throw hatalar.bulunamadi('Kasa oturumu');
  if (oturum.durum === 'KAPALI') throw hatalar.dogrulama('Bu kasa oturumu zaten kapatılmış.');

  const ozet = oturumOzeti(vt, oturumId);
  const beklenen = ozet.beklenen_nakit;
  const fark = sayilanNakit - beklenen;

  vt.islem(() => {
    oturumKapat(vt, oturumId, sayilanNakit, beklenen, notlar ?? null, zaman);
    olayYaz(
      vt,
      {
        id: uuid(),
        olay_tipi: 'KASA_OTURUM_KAPANDI',
        entity: 'kasa_oturumu',
        entity_id: oturumId,
        veri: {
          id: oturumId,
          kullanici_id: aktor.kullaniciId,
          kapanis_zamani: zaman,
          acilis_bakiye: ozet.acilis_bakiye,
          sayilan_nakit: sayilanNakit,
          beklenen_nakit: beklenen,
          kasa_farki: fark,
          satis_nakit: ozet.satis_nakit,
          satis_kart: ozet.satis_kart,
          veresiye: ozet.veresiye,
          tahsilat: ozet.tahsilat,
          gider: ozet.gider,
          islem_sayisi: ozet.islem_sayisi,
        },
        olusturma_zamani: zaman,
      },
      cihazId,
      zaman,
    );
    denetimYaz(
      vt,
      {
        kullanici_id: aktor.kullaniciId,
        islem: 'GUN_SONU',
        entity: 'kasa_oturumu',
        entity_id: oturumId,
        yeni_deger: { sayilan: sayilanNakit, beklenen, fark },
      },
      cihazId,
      zaman,
    );
  });

  aktor.kasaOturumId = null;
  const esikAsildi = Math.abs(fark) > ayarlar.kasaFarkiEsigi;
  if (esikAsildi) {
    baglam.kayit.uyari('Kasa farkı eşiği aşıldı', { oturum_id: oturumId, fark, esik: ayarlar.kasaFarkiEsigi });
  }
  baglam.kayit.bilgi('Gün sonu yapıldı', { oturum_id: oturumId, sayilan: sayilanNakit, beklenen, fark });

  return { oturumId, ozet, sayilanNakit, beklenenNakit: beklenen, kasaFarki: fark, farkEsigiAsildi: esikAsildi };
}

export type KasaEkHareketTipi = 'GIDER' | 'GIRIS' | 'CIKIS';

/** Kasa gideri / para giriş-çıkışı (§10.8). */
export function kasaHareketi(baglam: Baglam, aktor: Aktor, tip: KasaEkHareketTipi, tutar: Kurus, aciklama: string): string {
  yetkiIste(aktor, tip === 'GIDER' ? 'kasa.gider' : 'kasa.giris_cikis');
  if (tutar <= 0) throw hatalar.dogrulama('Tutar sıfırdan büyük olmalıdır.');
  if (!aciklama.trim()) throw hatalar.dogrulama('Açıklama zorunludur.');

  const oturumId = kasaOturumuIste(aktor);
  const { vt, cihazId } = baglam;
  const zaman = simdi();
  // Gider ve çıkış kasadan para eksiltir.
  const isaretli = tip === 'GIRIS' ? tutar : -tutar;

  let hareketId = '';
  vt.islem(() => {
    hareketId = kasaHareketEkle(
      vt,
      { kasa_oturum_id: oturumId, tip, tutar: isaretli, aciklama, kullanici_id: aktor.kullaniciId },
      cihazId,
      zaman,
    );
    if (tip === 'GIDER') {
      gunlukOzetEkle(vt, gunAnahtari(zaman), cihazId, { gider: tutar, nakit: isaretli }, zaman);
    } else {
      gunlukOzetEkle(vt, gunAnahtari(zaman), cihazId, { nakit: isaretli }, zaman);
    }
    // KASA_HAREKETI olayı `kasaHareketEkle` içinde yayınlanır (§7.3).
    denetimYaz(
      vt,
      {
        kullanici_id: aktor.kullaniciId,
        islem: `KASA_${tip}`,
        entity: 'kasa_hareketi',
        entity_id: hareketId,
        yeni_deger: { tutar, aciklama },
      },
      cihazId,
      zaman,
    );
  });

  return hareketId;
}

export interface KasaDurumu {
  oturum: ReturnType<typeof acikOturum>;
  ozet: KasaOzeti | null;
  /** Kasa hareketleri + yalnız gösterim için eklenen veresiye satışlar (`SATIS_VERESIYE`). */
  hareketler: (Omit<KasaHareketiKaydi, 'tip'> & { tip: KasaHareketiKaydi['tip'] | 'SATIS_VERESIYE' })[];
  /** Açık oturum, isteği yapan kullanıcıya mı ait? Değilse o kullanıcı satış yapamaz. */
  bana_ait_mi: boolean;
  /** Oturumu açan kişinin adı — ekranda "X'in kasası" demek için. */
  sahip_adi: string | null;
}

/**
 * Cihazdaki acik kasa oturumunun durumu.
 *
 * `aktor` verilirse oturumun ONA AIT OLUP OLMADIGI da doner. Ekran bu bilgi
 * olmadan baskasinin actigi kasayi kendi kasasiymis gibi gosteriyordu; kasiyer
 * satis ya da gun sonu deneyince "acik kasa yok" hatasi aliyor, ekranda ise
 * acik bir kasa goruyordu. Karar arayuze birakilir, ama veri dogru gider.
 */
export function kasaDurumu(baglam: Baglam, aktor?: Aktor): KasaDurumu {
  const oturum = acikOturum(baglam.vt, baglam.cihazId);
  if (!oturum) return { oturum: null, ozet: null, hareketler: [], bana_ait_mi: true, sahip_adi: null };
  const sahip = baglam.vt.hazirla('SELECT ad FROM kullanicilar WHERE id = ?').tek<{ ad: string }>(oturum.kullanici_id);
  return {
    oturum,
    ozet: oturumOzeti(baglam.vt, oturum.id),
    hareketler: [
      ...oturumHareketleri(baglam.vt, oturum.id),
      ...oturumVeresiyeSatislari(baglam.vt, oturum.id).map((v) => ({ ...v, tip: 'SATIS_VERESIYE' as const })),
    ].sort((x, y) => (x.created_at < y.created_at ? -1 : x.created_at > y.created_at ? 1 : 0)),
    bana_ait_mi: aktor ? oturum.kullanici_id === aktor.kullaniciId : true,
    sahip_adi: sahip?.ad ?? null,
  };
}

/** Kapatılmış bir oturumun vardiya raporu (yeniden yazdırma / inceleme). */
export function vardiyaRaporu(
  baglam: Baglam,
  aktor: Aktor,
  oturumId: string,
): { oturum: ReturnType<typeof oturumBul>; ozet: KasaOzeti; hareketler: ReturnType<typeof oturumHareketleri> } {
  const oturum = oturumBul(baglam.vt, oturumId);
  if (!oturum) throw hatalar.bulunamadi('Kasa oturumu');
  if (oturum.kullanici_id !== aktor.kullaniciId) yetkiIste(aktor, 'kasa.tum_oturumlar');
  return { oturum, ozet: oturumOzeti(baglam.vt, oturumId), hareketler: oturumHareketleri(baglam.vt, oturumId) };
}
