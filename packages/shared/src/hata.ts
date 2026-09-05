/**
 * Ortak hata tipi ve serileştirme.
 *
 * İlke (§20): Kullanıcıya **Türkçe, anlaşılır** mesaj; teknik detay `izleme_id`
 * ile logda kalır. API yanıtı RFC 7807 tarzıdır (§9.1):
 * `{ "hata": { "kod", "mesaj", "detay", "izleme_id" } }`
 */

import { HATA_KODU, HATA_MESAJLARI, type HataKodu } from './sabitler.js';

export interface HataGovdesi {
  kod: string;
  mesaj: string;
  detay?: Record<string, unknown>;
  izleme_id?: string;
}

export interface HataYaniti {
  hata: HataGovdesi;
}

export class UygulamaHatasi extends Error {
  readonly kod: string;
  readonly httpDurum: number;
  readonly detay?: Record<string, unknown>;
  izlemeId?: string;

  constructor(
    kod: HataKodu | string,
    mesaj?: string,
    secenekler?: { httpDurum?: number; detay?: Record<string, unknown>; izlemeId?: string; cause?: unknown },
  ) {
    super(mesaj ?? HATA_MESAJLARI[kod] ?? 'Beklenmeyen bir hata oluştu.');
    this.name = 'UygulamaHatasi';
    this.kod = kod;
    this.httpDurum = secenekler?.httpDurum ?? varsayilanDurum(kod);
    this.detay = secenekler?.detay;
    this.izlemeId = secenekler?.izlemeId;
    if (secenekler?.cause !== undefined) (this as { cause?: unknown }).cause = secenekler.cause;
  }

  govde(): HataGovdesi {
    const g: HataGovdesi = { kod: this.kod, mesaj: this.message };
    if (this.detay) g.detay = this.detay;
    if (this.izlemeId) g.izleme_id = this.izlemeId;
    return g;
  }

  yanit(): HataYaniti {
    return { hata: this.govde() };
  }
}

function varsayilanDurum(kod: string): number {
  switch (kod) {
    case HATA_KODU.DOGRULAMA:
      return 400;
    case HATA_KODU.KIMLIK:
    case HATA_KODU.LISANS_GECERSIZ:
      return 401;
    case HATA_KODU.YETKI:
    case HATA_KODU.CIHAZ_YETKISIZ:
      return 403;
    case HATA_KODU.BULUNAMADI:
      return 404;
    case HATA_KODU.CAKISMA:
    case HATA_KODU.BARKOD_KULLANIMDA:
      return 409;
    case HATA_KODU.HIZ_LIMITI:
      return 429;
    case HATA_KODU.SUNUCU:
      return 500;
    default:
      // İş kuralı ihlalleri (stok yetersiz, limit aşımı, ...) → 422
      return 422;
  }
}

export function hataMi(deger: unknown): deger is UygulamaHatasi {
  return deger instanceof UygulamaHatasi;
}

/** Bilinmeyen bir throw değerini UygulamaHatasi'na normalize eder. */
export function hataNormalize(deger: unknown, izlemeId?: string): UygulamaHatasi {
  if (hataMi(deger)) {
    if (izlemeId && !deger.izlemeId) deger.izlemeId = izlemeId;
    return deger;
  }
  const mesaj = deger instanceof Error ? deger.message : String(deger);
  return new UygulamaHatasi(HATA_KODU.SUNUCU, undefined, {
    detay: { ic_mesaj: mesaj },
    izlemeId,
    cause: deger,
  });
}

/** Süreç sınırlarını (IPC / HTTP) geçebilecek düz nesneye çevirir. */
export function hataSerilestir(hata: unknown, izlemeId?: string): HataGovdesi {
  return hataNormalize(hata, izlemeId).govde();
}

/** Karşı taraftan gelen düz hata gövdesini tekrar Error'a çevirir. */
export function hataCanlandir(govde: HataGovdesi): UygulamaHatasi {
  const secenekler: { detay?: Record<string, unknown>; izlemeId?: string } = {};
  if (govde.detay) secenekler.detay = govde.detay;
  if (govde.izleme_id) secenekler.izlemeId = govde.izleme_id;
  return new UygulamaHatasi(govde.kod, govde.mesaj, secenekler);
}

// Sık kullanılan kısayollar
export const hatalar = {
  dogrulama: (mesaj?: string, detay?: Record<string, unknown>) =>
    new UygulamaHatasi(HATA_KODU.DOGRULAMA, mesaj, detay ? { detay } : undefined),
  yetki: (mesaj?: string) => new UygulamaHatasi(HATA_KODU.YETKI, mesaj),
  kimlik: (mesaj?: string) => new UygulamaHatasi(HATA_KODU.KIMLIK, mesaj),
  bulunamadi: (ne: string) => new UygulamaHatasi(HATA_KODU.BULUNAMADI, `${ne} bulunamadı.`),
  isKurali: (kod: HataKodu, mesaj?: string, detay?: Record<string, unknown>) =>
    new UygulamaHatasi(kod, mesaj, detay ? { detay } : undefined),
};
