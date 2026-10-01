/**
 * POS servisi — kart çekimi ve karta iadenin cihaza gittiği TEK yer.
 *
 * POS kapalıyken (varsayılan) program bugünkü gibi çalışır: kart çekimi
 * cihazdan elle yapılır, program yalnız kayıt tutar. Açıkken:
 *
 *  - Satış, cari tahsilat: önce kayıt "kuru" denenir (limit, kasa, yetki…
 *    hataları müşterinin kartından para çekilmeden yakalanır), sonra cihazdan
 *    çekilir, sonra kaydedilir. Kayıt yine de hata verirse çekim GERİ ALINIR.
 *  - Satış iadesi, satış iptali, tahsilat iptali: "karta" seçildiyse önce
 *    cihazdan iade yapılır; cihaz onaylamazsa kayıt yazılmaz. Karta iade,
 *    kartla ödenen tutarı aşamaz (banka POS'u kabul etmez).
 *  - Aynı anda tek işlem: cihaz meşgulken ikinci istek reddedilir.
 *  - Her istek ve sonucu `pos_islemleri` günlüğüne yazılır.
 *  - Cihaz süresinde yanıt vermezse işlem reddedilmiş sayılır; sonradan onay
 *    gelirse günlüğe işlenir, satış çekimiyse otomatik geri alınır ve kasiyer
 *    uyarılır.
 */

import { AYAR, hatalar, paraFormat, type Kurus, type PosIslemSonucu } from '@market/shared';
import type { Vt } from '../db/surucu.js';
import { ayarMetin, ayarSayi } from '../depo/ayar.js';
import { cariBul } from '../depo/cari.js';
import {
  posGunlukBelgeBagla,
  posGunlukListele,
  posGunlukYaz,
  type PosGunlukSatiri,
  type PosIslemDurumu,
  type PosIslemTuru,
} from '../depo/pos-gunluk.js';
import { odemeleriGetir } from '../depo/satis.js';
import { posSurucusuOlustur, type PosSurucusu } from '../donanim/pos.js';
import { yetkiIste, type Aktor, type Baglam } from './baglam.js';
import { tahsilatIptal, tahsilatIptalPosIhtiyaci, tahsilatYap } from './cari-servis.js';
import {
  iadeTutariHesapla,
  iadeYap,
  iptalIadeTutarlari,
  kartIadeEdilebilir,
  kartPosReferansi,
  satisIptal,
  satisKesinlestir,
  type SatisSonucu,
} from './satis-servis.js';

// ---------------------------------------------------------------------------
// Sürücü, kilit, uyarı
// ---------------------------------------------------------------------------

/** Sürücü ayarlar değişene kadar saklanır: gerçek cihazda bağlantı her işlemde yeniden kurulmasın. */
let onbellek: { anahtar: string; surucu: PosSurucusu | null } | null = null;
/** Testler için ayardan bağımsız sürücü; undefined → ayardaki tür kullanılır. */
let disaridanSurucu: PosSurucusu | null | undefined;

/** Testlerde sahte cihaz takmak için (red, süre aşımı, sürücü hatası senaryoları). */
export function posSurucusuDegistir(s: PosSurucusu | null | undefined): void {
  disaridanSurucu = s;
}

function surucu(baglam: Baglam): PosSurucusu | null {
  if (disaridanSurucu !== undefined) return disaridanSurucu;
  const tur = ayarMetin(baglam.vt, AYAR.POS_TURU, 'KAPALI');
  const adres = ayarMetin(baglam.vt, AYAR.POS_ADRES, '');
  const gecikmeMs = ayarSayi(baglam.vt, 'pos.simulator_gecikme_ms', 1500);
  const anahtar = `${tur}|${adres}|${gecikmeMs}`;
  if (onbellek?.anahtar !== anahtar) {
    void onbellek?.surucu?.kapat?.().catch(() => undefined);
    onbellek = { anahtar, surucu: posSurucusuOlustur(tur, { adres, gecikmeMs }) };
  }
  return onbellek.surucu;
}

/** Cihaz tek; aynı anda iki işlem gönderilmez (çift tıklama, iki pencere). */
let mesgul = false;

export interface PosUyarisi {
  tur: 'uyari' | 'hata';
  baslik: string;
  mesaj: string;
}
let uyariDinleyicisi: ((uyari: PosUyarisi) => void) | null = null;

/** Arka planda olan (geç gelen onay gibi) POS olaylarını arayüze iletmek için. */
export function posUyariDinleyicisi(dinleyici: ((uyari: PosUyarisi) => void) | null): void {
  uyariDinleyicisi = dinleyici;
}

const hataMetni = (hata: unknown) => (hata instanceof Error ? hata.message : String(hata));

type IcSonuc = PosIslemSonucu & { surucuHatasi?: boolean };

/** Sözleşmeye rağmen istisna fırlatan ya da boş dönen sürücüye karşı. */
async function guvenli(cagri: () => Promise<PosIslemSonucu>): Promise<IcSonuc> {
  try {
    const sonuc = await cagri();
    return sonuc ?? { onaylandi: false, hata: 'POS boş yanıt döndü.', surucuHatasi: true };
  } catch (hata) {
    return { onaylandi: false, hata: `POS sürücü hatası: ${hataMetni(hata)}`, surucuHatasi: true };
  }
}

/** Cihaz yanıt vermezse işlem reddedilmiş sayılır; çekimin olup olmadığı bilinmez. */
async function zamanAsimiyla(baglam: Baglam, islem: Promise<IcSonuc>): Promise<IcSonuc> {
  const sn = ayarSayi(baglam.vt, AYAR.POS_ZAMAN_ASIMI_SN, 90);
  let zamanlayici: ReturnType<typeof setTimeout> | undefined;
  const asim = new Promise<IcSonuc>((coz) => {
    zamanlayici = setTimeout(
      () =>
        coz({
          onaylandi: false,
          zaman_asimi: true,
          hata: `POS ${sn} saniye içinde yanıt vermedi. Cihaz ekranını kontrol edin; işlem görünüyorsa cihazdan iptal edin.`,
        }),
      sn * 1000,
    );
  });
  try {
    return await Promise.race([islem, asim]);
  } finally {
    clearTimeout(zamanlayici);
  }
}

interface CihazIslemi {
  tur: PosIslemTuru;
  tutar: Kurus;
  /** Karta iade / geri almada orijinal çekimin cihaz referansı. */
  orijinalReferans?: string | null;
  belgeTipi: string;
  belgeId?: string | null;
}

type CihazSonucu = PosIslemSonucu & { gunlukId: string | null };

function durumu(sonuc: IcSonuc): PosIslemDurumu {
  if (sonuc.onaylandi) return 'ONAY';
  if (sonuc.zaman_asimi) return 'ZAMAN_ASIMI';
  return sonuc.surucuHatasi ? 'HATA' : 'RED';
}

function gunlugeYaz(baglam: Baglam, aktor: Aktor, islem: CihazIslemi, sonuc: IcSonuc, ekHata?: string): string | null {
  // Günlük yazılamazsa (disk vb.) ödeme akışı durmaz.
  try {
    return posGunlukYaz(
      baglam.vt,
      {
        tur: islem.tur,
        tutar: islem.tutar,
        sonuc: durumu(sonuc),
        onay_kodu: sonuc.onay_kodu ?? null,
        referans: sonuc.referans ?? null,
        kart: sonuc.kart_maske ?? null,
        hata: ekHata ?? sonuc.hata ?? null,
        orijinal_referans: islem.orijinalReferans ?? null,
        belge_id: islem.belgeId ?? null,
        belge_tipi: islem.belgeTipi,
        kullanici_id: aktor.kullaniciId,
      },
      baglam.cihazId,
    );
  } catch {
    return null;
  }
}

function belgeBagla(baglam: Baglam, gunlukId: string | null, belgeId: string, belgeTipi: string): void {
  if (!gunlukId) return;
  try {
    posGunlukBelgeBagla(baglam.vt, gunlukId, belgeId, belgeTipi);
  } catch {
    /* günlük yardımcıdır */
  }
}

/**
 * Cihaza tek bir istek. Yetki kontrolü YAPMAZ — çağıran akış yapar (satış
 * yapan kasiyerin iade yetkisi olmasa da kendi çekimini geri alabilmeli).
 */
async function cihazIslemi(baglam: Baglam, aktor: Aktor, islem: CihazIslemi): Promise<CihazSonucu> {
  const s = surucu(baglam);
  if (!s) throw hatalar.dogrulama('POS entegrasyonu kapalı.');
  if (!Number.isInteger(islem.tutar) || islem.tutar <= 0) throw hatalar.dogrulama('POS tutarı geçersiz.');
  if (mesgul) throw hatalar.dogrulama('POS cihazı önceki işlemi bitirmedi; birkaç saniye sonra tekrar deneyin.');

  mesgul = true;
  const orijinal = islem.orijinalReferans ?? null;
  const cagri = guvenli(() => {
    if (islem.tur === 'SATIS') return s.satis(islem.tutar, islem.belgeTipi);
    if (islem.tur === 'GERI_ALMA' && s.geriAl) return s.geriAl(islem.tutar, orijinal);
    return s.iade(islem.tutar, orijinal);
  });
  let sonuc: IcSonuc;
  try {
    sonuc = await zamanAsimiyla(baglam, cagri);
  } finally {
    mesgul = false;
  }
  if (sonuc.zaman_asimi) {
    void s.bekleyeniIptal?.().catch(() => undefined);
    gecYanitiIzle(baglam, aktor, islem, cagri);
  }
  const gunlukId = gunlugeYaz(baglam, aktor, islem, sonuc);
  const { surucuHatasi: _, ...temiz } = sonuc;
  return { ...temiz, gunlukId };
}

/**
 * Süre aşımından SONRA cihaz onay verirse: kayıt yapılmamıştır ama para
 * hareket etmiştir. Günlüğe işlenir; satış çekimi otomatik geri alınır,
 * iade ise kasiyere bildirilir (iade geri alınamaz).
 */
function gecYanitiIzle(baglam: Baglam, aktor: Aktor, islem: CihazIslemi, cagri: Promise<IcSonuc>): void {
  void cagri
    .then(async (gec) => {
      if (!gec.onaylandi) return;
      gunlugeYaz(baglam, aktor, islem, gec, 'Zaman aşımından SONRA onay geldi; kayıt yapılmadı.');
      const tutar = paraFormat(islem.tutar);
      if (islem.tur === 'SATIS') {
        const geri = await cihazIslemi(baglam, aktor, {
          tur: 'GERI_ALMA',
          tutar: islem.tutar,
          orijinalReferans: gec.referans ?? null,
          belgeTipi: islem.belgeTipi,
        }).catch((hata: unknown) => ({ onaylandi: false, hata: hataMetni(hata) }));
        uyariDinleyicisi?.(
          geri.onaylandi
            ? {
                tur: 'uyari',
                baslik: 'Geç gelen POS onayı geri alındı',
                mesaj: `${tutar} çekim kaydedilmemişti; otomatik iptal edildi.`,
              }
            : {
                tur: 'hata',
                baslik: 'POS çekimi kayıtsız kaldı',
                mesaj: `${tutar} süre aşımından sonra onaylandı ve geri alınamadı. Cihazdan iptal edin (onay ${gec.onay_kodu ?? '—'}).`,
              },
        );
      } else if (islem.tur === 'IADE') {
        uyariDinleyicisi?.({
          tur: 'hata',
          baslik: 'Karta iade kayıtsız kaldı',
          mesaj: `${tutar} karta iade süre aşımından sonra onaylandı ama kayıt yazılmadı. Tekrar iade YAPMAYIN; işlemi POS kapalıyken kaydedin ya da yöneticiye bildirin.`,
        });
      }
    })
    .catch(() => undefined);
}

function onaylanmadi(baslik: string, sonuc: PosIslemSonucu): never {
  if (sonuc.zaman_asimi) throw hatalar.dogrulama(`${baslik}: ${sonuc.hata ?? 'POS yanıt vermedi.'} Kayıt yapılmadı.`);
  throw hatalar.dogrulama(`${baslik}: ${sonuc.hata ?? 'POS işlemi reddetti.'}`);
}

/**
 * Kaydı yazmadan dener: aynı doğrulamalar çalışır, sonra her şey geri alınır.
 * Böylece "kartından para çekildi ama satış kaydedilemedi" durumu çok azalır.
 */
function kuruDene(vt: Vt, govde: () => unknown): void {
  const kuru = Symbol('kuru');
  try {
    vt.islem(() => {
      govde();
      throw kuru;
    });
  } catch (hata) {
    if (hata !== kuru) throw hata;
  }
}

/** Kayıt yazılamadıysa çekimi geri alır ve durumu anlatan hatayı fırlatır. */
async function cekimiGeriAl(
  baglam: Baglam,
  aktor: Aktor,
  tutar: Kurus,
  cekim: CihazSonucu,
  ne: string,
  hata: unknown,
): Promise<never> {
  const geri = await cihazIslemi(baglam, aktor, {
    tur: 'GERI_ALMA',
    tutar,
    orijinalReferans: cekim.referans ?? null,
    belgeTipi: ne,
  }).catch((h: unknown) => ({ onaylandi: false, hata: hataMetni(h) }) as PosIslemSonucu);
  if (!geri.onaylandi) {
    throw hatalar.dogrulama(
      `${ne} kaydedilemedi ve kart çekimi geri alınamadı — ${paraFormat(tutar)} tutarındaki çekimi POS cihazından iptal edin. (${hataMetni(hata)})`,
    );
  }
  throw hatalar.dogrulama(`${ne} kaydedilemedi; kart çekimi geri alındı, müşteriden para alınmadı. (${hataMetni(hata)})`);
}

/** Karta iade yapıldı ama kayıt yazılamadı — iade geri alınamaz, kasiyere net bilgi verilir. */
function kayitsizIade(tutar: Kurus, iade: PosIslemSonucu, hata: unknown): never {
  const mesaj = `Karta ${paraFormat(tutar)} iade edildi (onay ${iade.onay_kodu ?? '—'}) ama kayıt yazılamadı: ${hataMetni(hata)}. Para müşteriye döndü; aynı iadeyi tekrar POS'tan YAPMAYIN, yöneticiye bildirin.`;
  uyariDinleyicisi?.({ tur: 'hata', baslik: 'Karta iade kayıtsız kaldı', mesaj });
  throw hatalar.dogrulama(mesaj);
}

function kartIadeSiniri(tutar: Kurus, kalan: Kurus, ipucu: string): void {
  if (tutar <= kalan) return;
  throw hatalar.dogrulama(
    kalan <= 0
      ? `Bu tutar kartla ödenmemiş; POS ile karta iade yapılamaz. ${ipucu}`
      : `Karta en fazla ${paraFormat(kalan)} iade edilebilir (kartla ödenen kısım). ${ipucu}`,
  );
}

// ---------------------------------------------------------------------------
// Durum, test, günlük
// ---------------------------------------------------------------------------

export function posDurumu(baglam: Baglam): { aktif: boolean; tur: string; ad: string | null } {
  const s = surucu(baglam);
  return { aktif: Boolean(s), tur: ayarMetin(baglam.vt, AYAR.POS_TURU, 'KAPALI'), ad: s?.ad ?? null };
}

/** Elle kart çekimi (test ve servis amaçlı). Satış akışı `posIleSatis` kullanır. */
export async function posOdemesi(baglam: Baglam, aktor: Aktor, tutar: Kurus): Promise<PosIslemSonucu> {
  yetkiIste(aktor, 'satis.yap');
  const { gunlukId: _, ...sonuc } = await cihazIslemi(baglam, aktor, { tur: 'SATIS', tutar, belgeTipi: 'ELLE' });
  return sonuc;
}

/** Elle karta iade (test ve servis amaçlı). İade/iptal akışları kendi yolunu kullanır. */
export async function posIadesi(
  baglam: Baglam,
  aktor: Aktor,
  tutar: Kurus,
  orijinalReferans: string | null,
): Promise<PosIslemSonucu> {
  if (!aktor.yetkiler.has('satis.iade') && !aktor.yetkiler.has('satis.iptal')) throw hatalar.yetki();
  const { gunlukId: _, ...sonuc } = await cihazIslemi(baglam, aktor, {
    tur: 'IADE',
    tutar,
    orijinalReferans,
    belgeTipi: 'ELLE',
  });
  return sonuc;
}

export async function posTesti(baglam: Baglam, aktor: Aktor): Promise<{ basarili: boolean; mesaj: string }> {
  yetkiIste(aktor, 'ayar.yonet');
  const s = surucu(baglam);
  if (!s) return { basarili: false, mesaj: 'POS türü "Kapalı" seçili.' };
  try {
    return await s.test();
  } catch (hata) {
    return { basarili: false, mesaj: `POS sürücü hatası: ${hataMetni(hata)}` };
  }
}

export function posGunlugu(
  baglam: Baglam,
  aktor: Aktor,
  filtre: { baslangic?: string; bitis?: string; limit?: number } = {},
): PosGunlukSatiri[] {
  yetkiIste(aktor, 'rapor.goruntule');
  return posGunlukListele(baglam.vt, filtre);
}

// ---------------------------------------------------------------------------
// Akışlar
// ---------------------------------------------------------------------------

/**
 * Satış — kart tutarı varsa ve POS açıksa önce kuru deneme, sonra cihazdan
 * çekim, sonra kayıt. Onay bilgisi ilk kart ödemesine işlenir (kayıt, fiş).
 */
export async function posIleSatis(
  baglam: Baglam,
  aktor: Aktor,
  hamGirdi: unknown,
): Promise<SatisSonucu & { pos: PosIslemSonucu | null }> {
  const girdi = (hamGirdi ?? {}) as { odemeler?: { tip?: unknown; tutar?: unknown }[] };
  const odemeler = Array.isArray(girdi.odemeler) ? girdi.odemeler : [];
  const kartTutari = odemeler
    .filter((o) => o.tip === 'KART')
    .reduce((t, o) => t + (typeof o.tutar === 'number' ? o.tutar : 0), 0);
  if (kartTutari <= 0 || !posDurumu(baglam).aktif) return { ...satisKesinlestir(baglam, aktor, hamGirdi), pos: null };

  kuruDene(baglam.vt, () => satisKesinlestir(baglam, aktor, hamGirdi));
  const cekim = await cihazIslemi(baglam, aktor, { tur: 'SATIS', tutar: kartTutari, belgeTipi: 'SATIS' });
  if (!cekim.onaylandi) onaylanmadi('Kart çekimi onaylanmadı', cekim);

  const ilkKart = odemeler.findIndex((o) => o.tip === 'KART');
  const posluGirdi = {
    ...girdi,
    odemeler: odemeler.map((o, i) =>
      i === ilkKart
        ? {
            ...o,
            pos_onay_kodu: cekim.onay_kodu ?? null,
            pos_referans: cekim.referans ?? null,
            pos_kart: cekim.kart_maske ?? null,
          }
        : o,
    ),
  };
  try {
    const sonuc = satisKesinlestir(baglam, aktor, posluGirdi);
    belgeBagla(baglam, cekim.gunlukId, sonuc.satisId, 'SATIS');
    const { gunlukId: _, ...pos } = cekim;
    return { ...sonuc, pos };
  } catch (hata) {
    return cekimiGeriAl(baglam, aktor, kartTutari, cekim, 'Satış', hata);
  }
}

/** Satış iadesi — "karta" seçildiyse ve POS açıksa önce cihazdan iade. */
export async function posIleIade(baglam: Baglam, aktor: Aktor, hamGirdi: unknown): Promise<SatisSonucu> {
  const girdi = (hamGirdi ?? {}) as {
    kaynak_satis_id?: string;
    iade_yontemi?: string;
    kalemler?: { satis_kalemi_id: string; miktar: number }[];
  };
  if (girdi.iade_yontemi !== 'KART' || !girdi.kaynak_satis_id || !posDurumu(baglam).aktif) {
    return iadeYap(baglam, aktor, hamGirdi);
  }

  kuruDene(baglam.vt, () => iadeYap(baglam, aktor, hamGirdi));
  const tutar = iadeTutariHesapla(baglam.vt, girdi.kaynak_satis_id, girdi.kalemler ?? []);
  kartIadeSiniri(tutar, kartIadeEdilebilir(baglam.vt, girdi.kaynak_satis_id), 'İade yöntemi olarak nakit seçin.');
  const iade = await cihazIslemi(baglam, aktor, {
    tur: 'IADE',
    tutar,
    orijinalReferans: kartPosReferansi(baglam.vt, girdi.kaynak_satis_id),
    belgeTipi: 'IADE',
  });
  if (!iade.onaylandi) onaylanmadi('Karta iade yapılamadı', iade);
  try {
    const sonuc = iadeYap(baglam, aktor, hamGirdi, iade);
    belgeBagla(baglam, iade.gunlukId, sonuc.satisId, 'IADE');
    return sonuc;
  } catch (hata) {
    return kayitsizIade(tutar, iade, hata);
  }
}

/** Satış iptali — kart iadesi gerekiyorsa ve POS açıksa önce cihazdan iade. */
export async function posIleSatisIptal(
  baglam: Baglam,
  aktor: Aktor,
  satisId: string,
  neden: string,
  paraYolu?: 'NAKIT' | 'KART',
): Promise<void> {
  const { kartIade } = iptalIadeTutarlari(odemeleriGetir(baglam.vt, satisId), paraYolu);
  if (kartIade <= 0 || !posDurumu(baglam).aktif) {
    satisIptal(baglam, aktor, satisId, neden, paraYolu);
    return;
  }

  kuruDene(baglam.vt, () => satisIptal(baglam, aktor, satisId, neden, paraYolu));
  kartIadeSiniri(kartIade, kartIadeEdilebilir(baglam.vt, satisId), 'Para yolu olarak "ödendiği gibi" ya da nakit seçin.');
  const iade = await cihazIslemi(baglam, aktor, {
    tur: 'IADE',
    tutar: kartIade,
    orijinalReferans: kartPosReferansi(baglam.vt, satisId),
    belgeTipi: 'SATIS_IPTAL',
    belgeId: satisId,
  });
  if (!iade.onaylandi) onaylanmadi('Karta iade yapılamadı', iade);
  try {
    satisIptal(baglam, aktor, satisId, neden, paraYolu, iade);
  } catch (hata) {
    kayitsizIade(kartIade, iade, hata);
  }
}

/**
 * Cari tahsilat — müşteriden KARTLA alınıyorsa ve POS açıksa önce cihazdan
 * çekilir. Tedarikçi ödemesi POS'a gitmez (o para işletmenin kartından çıkar).
 */
export async function posIleTahsilat(
  baglam: Baglam,
  aktor: Aktor,
  girdi: { cari_id: string; tutar: Kurus; odeme_tipi: string; [anahtar: string]: unknown },
): Promise<ReturnType<typeof tahsilatYap>> {
  const musteri = cariBul(baglam.vt, girdi.cari_id)?.tip === 'MUSTERI';
  if (girdi.odeme_tipi !== 'KART' || !musteri || !posDurumu(baglam).aktif) return tahsilatYap(baglam, aktor, girdi);

  kuruDene(baglam.vt, () => tahsilatYap(baglam, aktor, girdi));
  const cekim = await cihazIslemi(baglam, aktor, { tur: 'SATIS', tutar: girdi.tutar, belgeTipi: 'TAHSILAT' });
  if (!cekim.onaylandi) onaylanmadi('Kart çekimi onaylanmadı', cekim);
  try {
    const sonuc = tahsilatYap(baglam, aktor, girdi, cekim);
    belgeBagla(baglam, cekim.gunlukId, sonuc.hareketId, 'TAHSILAT');
    return sonuc;
  } catch (hata) {
    return cekimiGeriAl(baglam, aktor, girdi.tutar, cekim, 'Tahsilat', hata);
  }
}

/** Tahsilat iptali — "karta" iade ediliyorsa ve POS açıksa önce cihazdan iade. */
export async function posIleTahsilatIptal(
  baglam: Baglam,
  aktor: Aktor,
  hareketId: string,
  neden: string,
  paraYolu?: 'NAKIT' | 'KART',
): Promise<ReturnType<typeof tahsilatIptal>> {
  const ihtiyac = tahsilatIptalPosIhtiyaci(baglam.vt, hareketId, paraYolu);
  if (!ihtiyac.gerekli || !posDurumu(baglam).aktif) return tahsilatIptal(baglam, aktor, hareketId, neden, paraYolu);

  kuruDene(baglam.vt, () => tahsilatIptal(baglam, aktor, hareketId, neden, paraYolu));
  kartIadeSiniri(ihtiyac.tutar, ihtiyac.kartlaAlindi ? ihtiyac.tutar : 0, 'Para yolu olarak nakit seçin.');
  const iade = await cihazIslemi(baglam, aktor, {
    tur: 'IADE',
    tutar: ihtiyac.tutar,
    orijinalReferans: ihtiyac.referans,
    belgeTipi: 'TAHSILAT_IPTAL',
    belgeId: hareketId,
  });
  if (!iade.onaylandi) onaylanmadi('Karta iade yapılamadı', iade);
  try {
    return tahsilatIptal(baglam, aktor, hareketId, neden, paraYolu);
  } catch (hata) {
    return kayitsizIade(ihtiyac.tutar, iade, hata);
  }
}
