/**
 * Kimlik doğrulama korumaları (§9.1, §15.1).
 *
 *  - `panelKorumasi`: JWT taşıyan panel kullanıcıları.
 *  - `cihazKorumasi`: `X-Device-Token` taşıyan kasa cihazları. Token'ın **hash'i**
 *    veritabanında saklanır; düz token hiçbir yerde tutulmaz.
 */

import { CIHAZ_TOKEN_BASLIGI, HATA_KODU, UygulamaHatasi } from '@market/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { tokenHashle } from '../guvenlik.js';

export async function panelKorumasi(istek: FastifyRequest, _yanit: FastifyReply): Promise<void> {
  try {
    const veri = await istek.jwtVerify<{ sub: string; isletme_id: string; rol: string; kullanici_adi: string }>();
    istek.kullanici = { id: veri.sub, isletmeId: veri.isletme_id, rol: veri.rol, kullaniciAdi: veri.kullanici_adi };
  } catch {
    throw new UygulamaHatasi(HATA_KODU.KIMLIK, 'Oturum geçersiz veya süresi dolmuş. Lütfen tekrar giriş yapın.');
  }
}

export async function cihazKorumasi(istek: FastifyRequest, _yanit: FastifyReply): Promise<void> {
  const token = istek.headers[CIHAZ_TOKEN_BASLIGI];
  if (typeof token !== 'string' || token.length < 16) {
    throw new UygulamaHatasi(HATA_KODU.CIHAZ_YETKISIZ, 'Cihaz kimliği eksik. Kasayı Ayarlar → Senkron ekranından aktive edin.');
  }

  const satir = await istek.server.vt.tek<{
    id: string;
    isletme_id: string;
    cihaz_id: string;
    cihaz_adi: string;
    aktif_mi: number;
  }>(
    `SELECT c.id, c.isletme_id, c.cihaz_id, c.cihaz_adi, c.aktif_mi
     FROM cihazlar c JOIN isletmeler i ON i.id = c.isletme_id
     WHERE c.token_hash = ? AND i.aktif_mi = 1`,
    [tokenHashle(token)],
  );

  if (!satir || Number(satir.aktif_mi) !== 1) {
    // İptal edilmiş cihaz token'ı da buraya düşer (§23.4 anti-abuse).
    throw new UygulamaHatasi(HATA_KODU.CIHAZ_YETKISIZ, 'Bu cihazın senkron yetkisi yok veya iptal edilmiş.');
  }

  istek.cihaz = {
    id: String(satir.id),
    isletmeId: String(satir.isletme_id),
    cihazId: String(satir.cihaz_id),
    cihazAdi: String(satir.cihaz_adi),
  };
}

/** Rol denetimi — sunucu tarafında zorunludur (§15.4). */
export function rolIste(...roller: string[]) {
  return async (istek: FastifyRequest): Promise<void> => {
    if (!istek.kullanici) throw new UygulamaHatasi(HATA_KODU.KIMLIK);
    if (!roller.includes(istek.kullanici.rol)) {
      throw new UygulamaHatasi(HATA_KODU.YETKI, 'Bu işlem için yetkiniz yok.');
    }
  };
}

/** İstek bağlamından işletme kimliği — panel ya da cihaz olabilir. */
export function isletmeIdAl(istek: FastifyRequest): string {
  const id = istek.kullanici?.isletmeId ?? istek.cihaz?.isletmeId;
  if (!id) throw new UygulamaHatasi(HATA_KODU.KIMLIK);
  return id;
}
