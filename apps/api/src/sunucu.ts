/**
 * Fastify sunucusu — eklentiler, hata biçimi ve rota kaydı (§9).
 *
 * Blueprint NestJS öneriyor; burada **doğrudan Fastify** kullanıldı. Gerekçe:
 * uygulama zaten paylaşılan Zod şemalarıyla doğrulama yapıyor, DI konteynerine
 * ihtiyaç duymuyor ve daha az soyutlama = daha az bakım yükü. NestJS'in kendisi de
 * altta Fastify'ı kullanır; sözleşme ve davranış aynıdır.
 */

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import hizLimiti from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { hataNormalize, izlemeId, IZLEME_BASLIGI, UygulamaHatasi } from '@market/shared';
import { kimlikRotalari } from './rota/kimlik.js';
import { raporRotalari } from './rota/rapor.js';
import { saglikRotalari } from './rota/saglik.js';
import { senkronRotalari } from './rota/senkron.js';
import { veriRotalari } from './rota/veri.js';
import { yonetimRotalari } from './rota/yonetim.js';
import { semayiHazirla, vtOlustur, type MerkezVt } from './vt/baglanti.js';
import type { Yapilandirma } from './yapilandirma.js';

declare module 'fastify' {
  interface FastifyInstance {
    vt: MerkezVt;
    yapilandirma: Yapilandirma;
  }
  interface FastifyRequest {
    izlemeId: string;
    /** JWT ile gelen panel kullanıcısı. */
    kullanici?: { id: string; isletmeId: string; rol: string; kullaniciAdi: string };
    /** Cihaz token ile gelen kasa. */
    cihaz?: { id: string; isletmeId: string; cihazId: string; cihazAdi: string };
  }
}

export interface SunucuSecenekleri {
  yapilandirma: Yapilandirma;
  /** Testlerde hazır bir veritabanı enjekte etmek için. */
  vt?: MerkezVt;
}

export async function sunucuOlustur({ yapilandirma, vt }: SunucuSecenekleri): Promise<FastifyInstance> {
  const uygulama = Fastify({
    logger: {
      level: yapilandirma.LOG_SEVIYESI,
      // Yapılandırılmış log (§19.1): her istek izleme kimliğiyle uçtan uca izlenir.
      redact: ['req.headers.authorization', 'req.headers["x-device-token"]', 'req.body.sifre', 'req.body.parola'],
    },
    trustProxy: true,
    bodyLimit: 8 * 1024 * 1024,
    genReqId: () => izlemeId('req'),
  });

  const veritabani = vt ?? vtOlustur(yapilandirma.DB_URL, yapilandirma.DB_AUTH_TOKEN);
  await semayiHazirla(veritabani);

  uygulama.decorate('vt', veritabani);
  uygulama.decorate('yapilandirma', yapilandirma);

  await uygulama.register(helmet, { contentSecurityPolicy: false });
  await uygulama.register(cors, {
    origin: yapilandirma.corsKokenleri.length > 0 ? yapilandirma.corsKokenleri : false,
    credentials: true,
  });
  await uygulama.register(jwt, { secret: yapilandirma.jwtGizli });
  await uygulama.register(hizLimiti, {
    max: yapilandirma.HIZ_LIMITI_DAKIKA,
    timeWindow: '1 minute',
    // Hız limiti cihaz/IP bazında; 429 + Retry-After döner (§9.1, §15.3).
    keyGenerator: (istek) => (istek.headers['x-device-token'] as string) ?? istek.ip,
    errorResponseBuilder: (_istek, baglam) => ({
      hata: {
        kod: 'HIZ_LIMITI',
        mesaj: `Çok fazla istek gönderildi. ${Math.ceil(baglam.ttl / 1000)} saniye sonra tekrar deneyin.`,
      },
    }),
  });

  uygulama.addHook('onRequest', async (istek) => {
    const gelen = istek.headers[IZLEME_BASLIGI];
    istek.izlemeId = typeof gelen === 'string' && gelen.length <= 64 ? gelen : String(istek.id);
  });

  uygulama.addHook('onSend', async (istek, yanit) => {
    void yanit.header(IZLEME_BASLIGI, istek.izlemeId);
  });

  // Tek biçimli hata gövdesi (§9.1). İç detay asla istemciye sızmaz.
  /**
   * Gövdesiz istek toleransı.
   *
   * Tarayıcı istemcileri gövdesiz bir DELETE'te bile sıklıkla
   * `content-type: application/json` gönderir. Fastify'ın varsayılan
   * ayrıştırıcısı bunu "Body cannot be empty when content-type is set" diye
   * reddeder ve istemciye 500 döner — kullanıcı "Beklenmeyen bir hata oluştu"
   * görür. Boş gövdeyi geçerli sayıyoruz; BOZUK gövde hâlâ doğrulama hatasıdır.
   */
  uygulama.addContentTypeParser('application/json', { parseAs: 'string' }, (_istek, govde, bitir) => {
    const metin = typeof govde === 'string' ? govde.trim() : '';
    if (metin === '') {
      bitir(null, undefined);
      return;
    }
    try {
      bitir(null, JSON.parse(metin));
    } catch {
      const hata = new UygulamaHatasi('DOGRULAMA_HATASI', 'Gönderilen veri geçerli JSON değil.') as unknown as FastifyError;
      hata.statusCode = 400;
      bitir(hata, undefined);
    }
  });

  uygulama.setErrorHandler((hata: FastifyError, istek: FastifyRequest, yanit: FastifyReply) => {
    // Zod hataları da doğrulama hatasıdır; kullanıcıya alan bazlı mesaj verilir.
    if (hata.validation || hata.name === 'ZodError') {
      const sorunlar = hata.validation
        ? hata.validation.map((v: { message?: string }) => v.message ?? 'Geçersiz değer')
        : ((hata as unknown as { issues?: { path: (string | number)[]; message: string }[] }).issues ?? []).map(
            (i) => `${i.path.join('.')}: ${i.message}`,
          );
      void yanit.status(400).send({
        hata: {
          kod: 'DOGRULAMA_HATASI',
          mesaj: 'Gönderilen veri geçerli değil.',
          detay: { sorunlar },
          izleme_id: istek.izlemeId,
        },
      });
      return;
    }

    const normal = hata instanceof UygulamaHatasi ? hata : hataNormalize(hata, istek.izlemeId);
    const durum = normal.httpDurum;
    if (durum >= 500) {
      istek.log.error({ hata: hata.message, yigin: hata.stack, izleme_id: istek.izlemeId }, 'Sunucu hatası');
    } else {
      istek.log.warn({ kod: normal.kod, mesaj: normal.message, izleme_id: istek.izlemeId }, 'İstek reddedildi');
    }
    void yanit.status(durum).send({ hata: { ...normal.govde(), izleme_id: istek.izlemeId } });
  });

  uygulama.setNotFoundHandler((istek, yanit) => {
    void yanit.status(404).send({ hata: { kod: 'BULUNAMADI', mesaj: 'Uç nokta bulunamadı.', izleme_id: istek.izlemeId } });
  });

  await uygulama.register(saglikRotalari);
  await uygulama.register(kimlikRotalari);
  await uygulama.register(senkronRotalari);
  await uygulama.register(yonetimRotalari);
  await uygulama.register(raporRotalari);
  await uygulama.register(veriRotalari);

  uygulama.addHook('onClose', async () => {
    if (!vt) veritabani.kapat();
  });

  return uygulama;
}
