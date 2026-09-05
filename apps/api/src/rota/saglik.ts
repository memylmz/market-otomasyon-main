/**
 * Sağlık ve sürüm uçları (§9.2, §19.3).
 *
 *  - `/health`  : liveness — süreç ayakta mı? (kimlik istemez)
 *  - `/ready`   : readiness — veritabanı erişilebilir mi? Yük dengeleyici bunu kullanır.
 *  - `/version` : sürüm ve şema bilgisi — istemci uyum kontrolü.
 */

import { SEMA_SURUMU, SENKRON_PROTOKOL_SURUMU, simdi, UCLAR, URUN_SURUMU } from '@market/shared';
import type { FastifyInstance } from 'fastify';

export async function saglikRotalari(uygulama: FastifyInstance): Promise<void> {
  const baslangic = Date.now();

  uygulama.get(UCLAR.saglik, { config: { rateLimit: false } }, async () => ({
    durum: 'iyi' as const,
    surum: URUN_SURUMU,
    sema_surumu: SEMA_SURUMU,
    zaman: simdi(),
    calisma_suresi_sn: Math.round((Date.now() - baslangic) / 1000),
  }));

  uygulama.get(UCLAR.hazir, { config: { rateLimit: false } }, async (_istek, yanit) => {
    try {
      await uygulama.vt.tek('SELECT 1 AS v');
      return { durum: 'iyi' as const, db: 'iyi' as const, surum: URUN_SURUMU, sema_surumu: SEMA_SURUMU, zaman: simdi() };
    } catch (hata) {
      uygulama.log.error({ hata: hata instanceof Error ? hata.message : String(hata) }, 'Hazırlık kontrolü başarısız');
      // 503: yük dengeleyici bu örneğe trafik göndermeyi durdurur.
      void yanit.status(503);
      return { durum: 'bozuk' as const, db: 'bozuk' as const, surum: URUN_SURUMU, sema_surumu: SEMA_SURUMU, zaman: simdi() };
    }
  });

  uygulama.get(UCLAR.surum, { config: { rateLimit: false } }, async () => ({
    surum: URUN_SURUMU,
    sema_surumu: SEMA_SURUMU,
    protokol_surumu: SENKRON_PROTOKOL_SURUMU,
    zaman: simdi(),
  }));
}
