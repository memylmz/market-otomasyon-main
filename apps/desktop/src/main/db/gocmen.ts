/**
 * Göç (migration) yürütücüsü — §8.6 / §22.4.
 *
 * Davranış:
 *  - Uygulanmış göçler `sema_gocleri` tablosunda tutulur.
 *  - Her göç **tek transaction** içinde uygulanır; ortasında hata olursa
 *    o göç tamamen geri alınır ve şema önceki sürümde kalır.
 *  - Veri içeren bir veritabanında göç uygulanmadan önce `yedekAl` geri çağrısı
 *    tetiklenir; başarısız göçten sonra kullanıcı sağlam yedeğe dönebilir.
 *  - Veritabanı koddan **yeni** sürümdeyse (eski uygulama, yeni DB) senkron ve
 *    açılış güvenli biçimde reddedilir — sessizce veri bozmaktansa durmak yeğdir.
 */

import { GOCLER, HEDEF_SEMA_SURUMU, type Goc } from './gocler.js';
import type { Vt } from './surucu.js';

export interface GocSonucu {
  oncekiSurum: number;
  yeniSurum: number;
  uygulananlar: { surum: number; ad: string }[];
  yedekAlindi: boolean;
}

export class SemaSurumHatasi extends Error {
  constructor(
    readonly vtSurumu: number,
    readonly kodSurumu: number,
  ) {
    super(
      `Veritabanı şeması (v${vtSurumu}) bu uygulama sürümünden (v${kodSurumu}) yeni. ` +
        'Lütfen uygulamayı güncelleyin; eski sürümle devam etmek veriyi bozabilir.',
    );
    this.name = 'SemaSurumHatasi';
  }
}

function gocTablosunuHazirla(vt: Vt): void {
  vt.ham(`
    CREATE TABLE IF NOT EXISTS sema_gocleri (
      surum      INTEGER PRIMARY KEY,
      ad         TEXT NOT NULL,
      uygulanma  TEXT NOT NULL
    );
  `);
}

export function mevcutSurum(vt: Vt): number {
  gocTablosunuHazirla(vt);
  const satir = vt.hazirla('SELECT MAX(surum) AS surum FROM sema_gocleri').tek<{ surum: number | null }>();
  return satir?.surum ?? 0;
}

/** Veritabanında kullanıcı verisi var mı? (İlk kurulumda yedek almaya gerek yok.) */
function veriVarMi(vt: Vt): boolean {
  const tablo = vt.hazirla("SELECT name FROM sqlite_master WHERE type='table' AND name='satislar'").tek<{ name: string }>();
  if (!tablo) return false;
  const satir = vt.hazirla('SELECT EXISTS(SELECT 1 FROM satislar LIMIT 1) AS v').tek<{ v: number }>();
  return (satir?.v ?? 0) === 1;
}

export interface GocSecenekleri {
  /** Kırıcı göç öncesi çağrılır; hata fırlatırsa göç iptal edilir. */
  yedekAl?: () => void;
  kayit?: (seviye: 'bilgi' | 'uyari' | 'hata', mesaj: string, veri?: Record<string, unknown>) => void;
  /** Testlerde belirli bir sürüme kadar göç etmek için. */
  hedefSurum?: number;
  gocler?: readonly Goc[];
}

export function gocleriUygula(vt: Vt, secenekler: GocSecenekleri = {}): GocSonucu {
  const gocler = [...(secenekler.gocler ?? GOCLER)].sort((a, b) => a.surum - b.surum);
  const hedef = secenekler.hedefSurum ?? gocler.reduce((m, g) => Math.max(m, g.surum), 0);
  const kayit = secenekler.kayit ?? (() => {});

  const onceki = mevcutSurum(vt);
  if (onceki > HEDEF_SEMA_SURUMU) throw new SemaSurumHatasi(onceki, HEDEF_SEMA_SURUMU);

  const bekleyen = gocler.filter((g) => g.surum > onceki && g.surum <= hedef);
  if (bekleyen.length === 0) {
    return { oncekiSurum: onceki, yeniSurum: onceki, uygulananlar: [], yedekAlindi: false };
  }

  let yedekAlindi = false;
  if (secenekler.yedekAl && veriVarMi(vt)) {
    kayit('bilgi', 'Göç öncesi otomatik yedek alınıyor', { onceki, hedef });
    secenekler.yedekAl();
    yedekAlindi = true;
  }

  const uygulananlar: { surum: number; ad: string }[] = [];
  for (const goc of bekleyen) {
    kayit('bilgi', `Şema göçü uygulanıyor: v${goc.surum} ${goc.ad}`);
    try {
      vt.islem(() => {
        vt.ham(goc.yukari);
        vt.hazirla('INSERT INTO sema_gocleri (surum, ad, uygulanma) VALUES (?, ?, ?)').calistir(
          goc.surum,
          goc.ad,
          new Date().toISOString(),
        );
      });
      uygulananlar.push({ surum: goc.surum, ad: goc.ad });
    } catch (hata) {
      kayit('hata', `Şema göçü başarısız: v${goc.surum} ${goc.ad}`, {
        mesaj: hata instanceof Error ? hata.message : String(hata),
      });
      throw hata;
    }
  }

  return { oncekiSurum: onceki, yeniSurum: mevcutSurum(vt), uygulananlar, yedekAlindi };
}

/** Yalnız geliştirme/test: son göçü geri alır. */
export function sonGocuGeriAl(vt: Vt, gocler: readonly Goc[] = GOCLER): number {
  const surum = mevcutSurum(vt);
  const goc = gocler.find((g) => g.surum === surum);
  if (!goc?.asagi) throw new Error(`v${surum} göçünün geri alma betiği yok`);
  vt.islem(() => {
    vt.ham(goc.asagi as string);
    vt.hazirla('DELETE FROM sema_gocleri WHERE surum = ?').calistir(surum);
  });
  return mevcutSurum(vt);
}
