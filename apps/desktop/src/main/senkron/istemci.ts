/**
 * Senkron HTTP istemcisi (§9).
 *
 *  - Tüm trafik TLS üzerinden; sertifika doğrulaması Node varsayılanıyla zorunlu (§15.2).
 *  - Her istek `X-Device-Token` taşır; senkron uçları cihaz kimliği olmadan reddedilir.
 *  - Yanıtlar paylaşılan Zod şemalarıyla doğrulanır — sunucu beklenmedik bir gövde
 *    döndürürse yerel veriye uygulanmadan hata verilir (§9.3 sözleşme).
 */

import {
  CIHAZ_TOKEN_BASLIGI,
  hataCanlandir,
  HATA_KODU,
  izlemeId,
  IZLEME_BASLIGI,
  SEMA_SURUMU,
  SENKRON_PROTOKOL_SURUMU,
  UygulamaHatasi,
  UCLAR,
  zCihazAktivasyonYaniti,
  zPullYaniti,
  zPushYaniti,
  zSenkronDurumYaniti,
  type CihazAktivasyonIstegi,
  type CihazAktivasyonYaniti,
  type PullYaniti,
  type PushIstegi,
  type PushYaniti,
  type SenkronDurumYaniti,
} from '@market/shared';

export interface IstemciSecenekleri {
  temelUrl: string;
  cihazToken?: string | null;
  erisimToken?: string | null;
  zamanAsimiMs?: number;
  /** Testlerde sahte fetch enjekte etmek için. */
  getir?: typeof fetch;
}

/** Yeniden denenebilir hatalar (ağ / 5xx / 429) kalıcı hatalardan ayrılır (§7.6). */
export class AgHatasi extends Error {
  constructor(
    mesaj: string,
    readonly yenidenDenenebilir: boolean,
    readonly durum?: number,
  ) {
    super(mesaj);
    this.name = 'AgHatasi';
  }
}

export class SenkronIstemcisi {
  private readonly getir: typeof fetch;

  constructor(private readonly secenekler: IstemciSecenekleri) {
    this.getir = secenekler.getir ?? globalThis.fetch;
    if (typeof this.getir !== 'function') throw new Error('Bu ortamda fetch bulunamadı');
  }

  private url(yol: string): string {
    return this.secenekler.temelUrl.replace(/\/+$/, '') + yol;
  }

  private async istek<T>(
    yol: string,
    secenekler: { yontem?: string; govde?: unknown; sema?: { parse(v: unknown): T } },
  ): Promise<T> {
    const iz = izlemeId();
    // `content-type` yalnız gövde varken gönderilir: gövdesiz istekte JSON
    // vaat etmek sunucuda gövde ayrıştırıcısını tetikler ve istek reddedilir.
    const basliklar: Record<string, string> = {
      ...(secenekler.govde !== undefined ? { 'content-type': 'application/json' } : {}),
      accept: 'application/json',
      [IZLEME_BASLIGI]: iz,
    };
    if (this.secenekler.cihazToken) basliklar[CIHAZ_TOKEN_BASLIGI] = this.secenekler.cihazToken;
    if (this.secenekler.erisimToken) basliklar.authorization = `Bearer ${this.secenekler.erisimToken}`;

    const kontrolcu = new AbortController();
    const zamanAsimi = setTimeout(() => kontrolcu.abort(), this.secenekler.zamanAsimiMs ?? 30_000);

    let yanit: Response;
    try {
      yanit = await this.getir(this.url(yol), {
        method: secenekler.yontem ?? 'GET',
        headers: basliklar,
        body: secenekler.govde === undefined ? undefined : JSON.stringify(secenekler.govde),
        signal: kontrolcu.signal,
      });
    } catch (hata) {
      // Ağ hatası / zaman aşımı → yeniden denenebilir.
      const mesaj = hata instanceof Error && hata.name === 'AbortError' ? 'Sunucu zaman aşımına uğradı' : 'Sunucuya ulaşılamadı';
      throw new AgHatasi(mesaj, true);
    } finally {
      clearTimeout(zamanAsimi);
    }

    const metin = await yanit.text();
    let govde: unknown = null;
    if (metin) {
      try {
        govde = JSON.parse(metin);
      } catch {
        govde = null;
      }
    }

    if (!yanit.ok) {
      const hataGovdesi = (govde as { hata?: { kod: string; mesaj: string } } | null)?.hata;
      if (hataGovdesi) {
        const canli = hataCanlandir({ ...hataGovdesi, izleme_id: iz });
        // 5xx ve 429 yeniden denenebilir; 4xx (409 hariç) kalıcıdır.
        if (yanit.status >= 500 || yanit.status === 429) throw new AgHatasi(canli.message, true, yanit.status);
        throw canli;
      }
      const yenidenDenenebilir = yanit.status >= 500 || yanit.status === 429;
      throw new AgHatasi(`Sunucu hatası (${yanit.status})`, yenidenDenenebilir, yanit.status);
    }

    if (!secenekler.sema) return govde as T;
    try {
      return secenekler.sema.parse(govde);
    } catch (hata) {
      throw new UygulamaHatasi(HATA_KODU.SUNUCU, 'Sunucu yanıtı beklenen biçimde değil.', {
        detay: { yol, ic_mesaj: hata instanceof Error ? hata.message : String(hata) },
        izlemeId: iz,
      });
    }
  }

  async push(istek: Omit<PushIstegi, 'sema_surumu' | 'protokol_surumu'>): Promise<PushYaniti> {
    return this.istek(UCLAR.senkronPush, {
      yontem: 'POST',
      govde: { ...istek, sema_surumu: SEMA_SURUMU, protokol_surumu: SENKRON_PROTOKOL_SURUMU },
      sema: zPushYaniti,
    });
  }

  async pull(since: number, limit: number): Promise<PullYaniti> {
    const sorgu = `?since=${encodeURIComponent(String(since))}&limit=${encodeURIComponent(String(limit))}&sema_surumu=${SEMA_SURUMU}`;
    return this.istek(UCLAR.senkronPull + sorgu, { sema: zPullYaniti });
  }

  async durum(): Promise<SenkronDurumYaniti> {
    return this.istek(UCLAR.senkronDurum, { sema: zSenkronDurumYaniti });
  }

  async cihazAktivasyonu(istek: CihazAktivasyonIstegi): Promise<CihazAktivasyonYaniti> {
    return this.istek(UCLAR.cihazAktivasyon, { yontem: 'POST', govde: istek, sema: zCihazAktivasyonYaniti });
  }

  async saglik(): Promise<boolean> {
    try {
      await this.istek(UCLAR.saglik, {});
      return true;
    } catch {
      return false;
    }
  }
}

/** Üstel geri çekilme (§7.6): 1s, 2s, 4s ... azami 5 dk. */
export function backoffSuresi(denemeSayisi: number, azamiMs = 5 * 60 * 1000): number {
  const taban = Math.min(1000 * 2 ** Math.max(0, denemeSayisi - 1), azamiMs);
  // Gürültü (jitter): birden fazla kasa aynı anda saldırmasın.
  return Math.round(taban * (0.75 + Math.random() * 0.5));
}
