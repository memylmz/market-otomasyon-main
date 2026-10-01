/**
 * POS cihazı sürücüleri — ortak sözleşme.
 *
 * Kasa kart çekimini POS cihazına bu arayüz üzerinden yaptırır. Yeni bir cihaz
 * (ör. yazarkasa POS) desteklenecekse yalnız `PosSurucusu`nu uygulayan bir
 * sınıf yazılır ve `posSurucusuOlustur` içine eklenir; satış, iade ve iptal
 * akışı değişmez. Ayrıntılar: docs/pos-entegrasyonu.md.
 *
 * Sözleşme kuralları:
 *  - Hiçbir yöntem istisna FIRLATMAZ; reddedilen ya da başarısız işlem
 *    `onaylandi: false` + okunur `hata` ile döner. Satış ekranı bu metni
 *    kasiyere gösterir.
 *  - Tutarlar kuruştur (KDV dahil, müşterinin ödeyeceği tutar).
 *  - `referans` cihazın/bankanın işlem kimliğidir; iade ve iptalde orijinal
 *    işlemi bulmak için saklanır.
 */

import { randomInt } from 'node:crypto';
import type { Kurus, PosIslemSonucu } from '@market/shared';

export interface PosSurucusu {
  readonly ad: string;
  /** Kart çekimi. `referans` satışın kasa tarafındaki kimliğidir (log/eşleştirme için). */
  satis(tutar: Kurus, referans: string): Promise<PosIslemSonucu>;
  /** Karta iade. `orijinalReferans` iade edilen çekimin cihaz referansıdır (varsa). */
  iade(tutar: Kurus, orijinalReferans: string | null): Promise<PosIslemSonucu>;
  /** Bağlantı testi — Ayarlar → Donanım → POS → "Bağlantıyı Test Et". */
  test(): Promise<{ basarili: boolean; mesaj: string }>;
  /**
   * İsteğe bağlı: az önce onaylanan çekimi GERİ ALIR (void / aynı gün iptal).
   * Satış kaydedilemediğinde kullanılır; müşterinin ekstresinde iade olarak
   * görünmez. Cihaz desteklemiyorsa yazılmaz, yerine `iade` kullanılır.
   */
  geriAl?(tutar: Kurus, referans: string | null): Promise<PosIslemSonucu>;
  /**
   * İsteğe bağlı: süre aşımında cihazda bekleyen işlemi durdurur (kart
   * okutulmadan önce iptal). Hata fırlatmaz; sonuç beklenmez.
   */
  bekleyeniIptal?(): Promise<void>;
  /** İsteğe bağlı: bağlantıyı kapatır (ayar değişince eski sürücü bırakılır). */
  kapat?(): Promise<void>;
}

/**
 * Test simülatörü: gerçek cihaz olmadan bütün akışı denemek için.
 * Kuruşu `SIMULATOR_RED_SONEKI` ile biten tutarı reddeder (ör. 10,13 ₺) ki
 * "kart reddedildi" yolu da denenebilsin.
 */
export const SIMULATOR_RED_SONEKI = 13;
/** Kuruşu bununla biten tutarda simülatör hiç yanıt vermez — zaman aşımı yolunu denemek için. */
export const SIMULATOR_YANITSIZ_SONEKI = 14;

export class PosSimulatoru implements PosSurucusu {
  readonly ad = 'Test simülatörü';

  /** Cihazda bekleyen (yanıtsız) işlemi bitirmek için — `bekleyeniIptal` çağırır. */
  private bekleyen: (() => void) | null = null;

  constructor(private readonly gecikmeMs = 1500) {}

  private bekle(): Promise<void> {
    return new Promise((coz) => setTimeout(coz, this.gecikmeMs));
  }

  private yanitsiz(): Promise<PosIslemSonucu> {
    return new Promise((coz) => {
      this.bekleyen = () => coz({ onaylandi: false, hata: 'İşlem iptal edildi.' });
    });
  }

  private onay(): PosIslemSonucu {
    return {
      onaylandi: true,
      onay_kodu: String(randomInt(0, 1_000_000)).padStart(6, '0'),
      referans: `SIM-${Date.now()}-${randomInt(1000, 9999)}`,
      kart_maske: `**** ${String(randomInt(0, 10_000)).padStart(4, '0')}`,
    };
  }

  async satis(tutar: Kurus, _referans = ''): Promise<PosIslemSonucu> {
    await this.bekle();
    if (tutar <= 0) return { onaylandi: false, hata: 'Geçersiz tutar.' };
    if (tutar % 100 === SIMULATOR_RED_SONEKI) return { onaylandi: false, hata: 'Kart reddedildi (simülatör: yetersiz bakiye).' };
    if (tutar % 100 === SIMULATOR_YANITSIZ_SONEKI) return this.yanitsiz();
    return this.onay();
  }

  async geriAl(tutar: Kurus, _referans: string | null = null): Promise<PosIslemSonucu> {
    await this.bekle();
    if (tutar <= 0) return { onaylandi: false, hata: 'Geçersiz tutar.' };
    return this.onay();
  }

  async bekleyeniIptal(): Promise<void> {
    this.bekleyen?.();
    this.bekleyen = null;
  }

  async iade(tutar: Kurus, _orijinalReferans: string | null = null): Promise<PosIslemSonucu> {
    await this.bekle();
    if (tutar <= 0) return { onaylandi: false, hata: 'Geçersiz tutar.' };
    return this.onay();
  }

  async test(): Promise<{ basarili: boolean; mesaj: string }> {
    return {
      basarili: true,
      mesaj: `Simülatör hazır. Kuruşu ${SIMULATOR_RED_SONEKI} ile biten tutar reddedilir, ${SIMULATOR_YANITSIZ_SONEKI} ile biten yanıtsız kalır.`,
    };
  }
}

/** Ayardaki türe göre sürücü; KAPALI ya da bilinmeyen türde null (POS kullanılmaz). */
export function posSurucusuOlustur(tur: string, secenek: { adres?: string; gecikmeMs?: number } = {}): PosSurucusu | null {
  switch (tur) {
    case 'SIMULATOR':
      return new PosSimulatoru(secenek.gecikmeMs);
    // Gerçek cihaz sürücüleri buraya eklenir, ör.:
    // case 'OKC_ORNEK': return new OrnekOkcSurucusu(secenek.adres);
    default:
      return null;
  }
}
