/**
 * Terazi servisi — tartım penceresinin kasaya bağlı teraziden okuduğu yer.
 *
 * Terazi türü "Kapalı" iken (varsayılan) kg ürünün miktarı elle girilir.
 * Açıkken tartım penceresi teraziyi canlı okur; kasiyer yine elle girebilir.
 */

import { AYAR, hatalar, type TeraziOkumasi } from '@market/shared';
import { ayarMetin, ayarSayi } from '../depo/ayar.js';
import { teraziSurucusuOlustur, type TeraziSurucusu } from '../donanim/terazi.js';
import { yetkiIste, type Aktor, type Baglam } from './baglam.js';

let onbellek: { anahtar: string; surucu: TeraziSurucusu | null } | null = null;

/** Sürücü ayarlar değişene kadar saklanır; bağlantı açık kalır. Ayar değişince eskisi kapatılır. */
function surucu(baglam: Baglam): TeraziSurucusu | null {
  const tur = ayarMetin(baglam.vt, AYAR.TERAZI_TURU, 'KAPALI');
  const secenek = {
    adres: ayarMetin(baglam.vt, AYAR.TERAZI_ADRES, ''),
    baud: ayarSayi(baglam.vt, AYAR.TERAZI_BAUD, 9600),
    cerceve: ayarMetin(baglam.vt, AYAR.TERAZI_CERCEVE, '8N1'),
    komut: ayarMetin(baglam.vt, AYAR.TERAZI_KOMUT, ''),
  };
  const anahtar = JSON.stringify([tur, secenek]);
  if (onbellek?.anahtar !== anahtar) {
    void onbellek?.surucu?.kapat?.().catch(() => undefined);
    onbellek = { anahtar, surucu: teraziSurucusuOlustur(tur, secenek) };
  }
  return onbellek.surucu;
}

export function teraziDurumu(baglam: Baglam): { aktif: boolean; tur: string; ad: string | null } {
  const s = surucu(baglam);
  return { aktif: Boolean(s), tur: ayarMetin(baglam.vt, AYAR.TERAZI_TURU, 'KAPALI'), ad: s?.ad ?? null };
}

export async function teraziOku(baglam: Baglam, aktor: Aktor): Promise<TeraziOkumasi> {
  yetkiIste(aktor, 'satis.yap');
  const s = surucu(baglam);
  if (!s) throw hatalar.dogrulama('Terazi bağlantısı kapalı.');
  try {
    return await s.oku();
  } catch (hata) {
    return { basarili: false, hata: `Terazi sürücü hatası: ${hata instanceof Error ? hata.message : String(hata)}` };
  }
}

export async function teraziTesti(baglam: Baglam, aktor: Aktor): Promise<{ basarili: boolean; mesaj: string }> {
  yetkiIste(aktor, 'ayar.yonet');
  const s = surucu(baglam);
  if (!s) return { basarili: false, mesaj: 'Terazi türü "Kapalı" seçili.' };
  try {
    return await s.test();
  } catch (hata) {
    return { basarili: false, mesaj: `Terazi sürücü hatası: ${hata instanceof Error ? hata.message : String(hata)}` };
  }
}

/** Bilgisayardaki seri portlar (COM listesi) — ayar ekranında seçmek için. */
export async function seriPortlar(aktor: Aktor): Promise<{ yol: string; aciklama: string }[]> {
  yetkiIste(aktor, 'ayar.yonet');
  try {
    const { SerialPort } = await import('serialport');
    const liste = await SerialPort.list();
    return liste.map((p) => ({ yol: p.path, aciklama: [p.manufacturer, p.friendlyName].filter(Boolean).join(' · ') }));
  } catch {
    return [];
  }
}
