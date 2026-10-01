/**
 * POS servisi — satış ekranı ile iade/iptal akışının POS cihazına eriştiği tek yer.
 *
 * POS kapalıyken (varsayılan) program bugünkü gibi çalışır: kart çekimi
 * cihazdan elle yapılır, program yalnız kayıt tutar. Açıkken kart ödemesi ve
 * karta iade cihaza gönderilir; cihaz onaylamadan satış/iade kaydedilmez.
 */

import { AYAR, hatalar, type Kurus, type PosIslemSonucu } from '@market/shared';
import { ayarMetin, ayarSayi } from '../depo/ayar.js';
import { posSurucusuOlustur, type PosSurucusu } from '../donanim/pos.js';
import { yetkiIste, type Aktor, type Baglam } from './baglam.js';
import { cariBul } from '../depo/cari.js';
import { tahsilatIptal, tahsilatIptalPosIhtiyaci, tahsilatYap } from './cari-servis.js';

function surucu(baglam: Baglam): PosSurucusu | null {
  const tur = ayarMetin(baglam.vt, AYAR.POS_TURU, 'KAPALI');
  return posSurucusuOlustur(tur, {
    adres: ayarMetin(baglam.vt, AYAR.POS_ADRES, ''),
    gecikmeMs: ayarSayi(baglam.vt, 'pos.simulator_gecikme_ms', 1500),
  });
}

/** Zaman aşımı: cihaz yanıt vermezse işlem reddedilmiş sayılır (çekim yapılmadı varsayımı). */
async function zamanAsimiyla(baglam: Baglam, islem: Promise<PosIslemSonucu>): Promise<PosIslemSonucu> {
  const sn = ayarSayi(baglam.vt, AYAR.POS_ZAMAN_ASIMI_SN, 90);
  let zamanlayici: ReturnType<typeof setTimeout> | undefined;
  const asim = new Promise<PosIslemSonucu>((coz) => {
    zamanlayici = setTimeout(
      () => coz({ onaylandi: false, hata: `POS ${sn} saniye içinde yanıt vermedi. Cihazda işlem görünüyorsa iptal edin.` }),
      sn * 1000,
    );
  });
  try {
    return await Promise.race([islem, asim]);
  } finally {
    clearTimeout(zamanlayici);
  }
}

export function posDurumu(baglam: Baglam): { aktif: boolean; tur: string; ad: string | null } {
  const s = surucu(baglam);
  return { aktif: Boolean(s), tur: ayarMetin(baglam.vt, AYAR.POS_TURU, 'KAPALI'), ad: s?.ad ?? null };
}

export async function posOdemesi(baglam: Baglam, aktor: Aktor, tutar: Kurus, referans = ''): Promise<PosIslemSonucu> {
  yetkiIste(aktor, 'satis.yap');
  const s = surucu(baglam);
  if (!s) throw hatalar.dogrulama('POS entegrasyonu kapalı.');
  return zamanAsimiyla(baglam, s.satis(tutar, referans));
}

export async function posIadesi(
  baglam: Baglam,
  aktor: Aktor,
  tutar: Kurus,
  orijinalReferans: string | null,
): Promise<PosIslemSonucu> {
  // Hem satış iptali hem iade bu yoldan geçer; ikisinden birinin yetkisi yeter.
  if (!aktor.yetkiler.has('satis.iade') && !aktor.yetkiler.has('satis.iptal')) throw hatalar.yetki();
  const s = surucu(baglam);
  if (!s) throw hatalar.dogrulama('POS entegrasyonu kapalı.');
  return zamanAsimiyla(baglam, s.iade(tutar, orijinalReferans));
}

export async function posTesti(baglam: Baglam, aktor: Aktor): Promise<{ basarili: boolean; mesaj: string }> {
  yetkiIste(aktor, 'ayar.yonet');
  const s = surucu(baglam);
  if (!s) return { basarili: false, mesaj: 'POS türü "Kapalı" seçili.' };
  return s.test();
}

/**
 * Cari tahsilat — müşteriden KARTLA alınıyorsa ve POS açıksa önce cihazdan
 * çekilir; kayıt hata verirse çekim geri alınır. Tedarikçi ödemesi POS'a
 * gitmez (o para işletmenin kartından çıkar); POS kapalıyken doğrudan kaydedilir.
 */
export async function posIleTahsilat(
  baglam: Baglam,
  aktor: Aktor,
  girdi: { cari_id: string; tutar: Kurus; odeme_tipi: string; [anahtar: string]: unknown },
): Promise<ReturnType<typeof tahsilatYap>> {
  const musteri = cariBul(baglam.vt, girdi.cari_id)?.tip === 'MUSTERI';
  if (girdi.odeme_tipi !== 'KART' || !musteri || !posDurumu(baglam).aktif) return tahsilatYap(baglam, aktor, girdi);

  const cekim = await posOdemesi(baglam, aktor, girdi.tutar);
  if (!cekim.onaylandi) throw hatalar.dogrulama(`POS çekimi onaylanmadı: ${cekim.hata ?? 'reddedildi'}`);
  try {
    return tahsilatYap(baglam, aktor, girdi, cekim);
  } catch (hata) {
    // Para çekildi ama tahsilat yazılamadı: çekim geri alınır, kasiyer bilgilendirilir.
    const geri = await posIadesi(baglam, aktor, girdi.tutar, cekim.referans ?? null);
    if (!geri.onaylandi) {
      throw hatalar.dogrulama(
        `Tahsilat kaydedilemedi ve POS çekimi geri alınamadı — cihazdan iptal edin. (${hata instanceof Error ? hata.message : String(hata)})`,
      );
    }
    throw hata;
  }
}

/**
 * Tahsilat iptali — müşterinin tahsilatı "karta" iade ediliyorsa ve POS açıksa
 * önce cihazdan iade yapılır; cihaz onaylamazsa iptal yazılmaz.
 */
export async function posIleTahsilatIptal(
  baglam: Baglam,
  aktor: Aktor,
  hareketId: string,
  neden: string,
  paraYolu?: 'NAKIT' | 'KART',
): Promise<ReturnType<typeof tahsilatIptal>> {
  const ihtiyac = tahsilatIptalPosIhtiyaci(baglam.vt, hareketId, paraYolu);
  if (ihtiyac.gerekli && posDurumu(baglam).aktif) {
    const iade = await posIadesi(baglam, aktor, ihtiyac.tutar, ihtiyac.referans);
    if (!iade.onaylandi) throw hatalar.dogrulama(`POS iadesi yapılamadı: ${iade.hata ?? 'reddedildi'}`);
  }
  return tahsilatIptal(baglam, aktor, hareketId, neden, paraYolu);
}
