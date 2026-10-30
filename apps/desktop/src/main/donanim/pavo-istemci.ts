/**
 * Pavo N86 REST istemcisi — alt katman. Cybele kasasındaki sahada doğrulanmış
 * istemcinin (pavo_client.dart) birebir karşılığı.
 *
 * Görevleri:
 *  - Sıra numarası (TransactionSequence) WRITE-AHEAD: yeni numara istek
 *    gitmeden ÖNCE diske yazılır; çökme sonrası aynı numara asla tekrar
 *    kullanılmaz.
 *  - Tek şerit: cihaz aynı anda TEK istek işler (hata 20). İstekler sıraya
 *    dizilir ki kendi kendimize 20 almayalım. Yalnız "ödemeden vazgeç" ve acil
 *    terk sırayı atlar — kesmeye çalıştığı isteğin arkasında beklemesi anlamsız.
 *  - Hata 73'te dokümandaki otomatik düzeltme (+1 yapıp tekrar dene).
 *  - HTTPS'te kendinden imzalı sertifika için TOFU: ilk başarılı bağlantının
 *    sertifika özeti saklanır, sonra yalnız o kabul edilir.
 *  - Taşıma hatalarını "işlenmiş olabilir / olamaz" diye ayırmak. Üst katman
 *    "işlenmiş olabilir"de kör tekrar YAPMAZ, önce cihaza sorar.
 */

import { createHash } from 'node:crypto';
import { request as httpIstegi, type ClientRequest, type IncomingMessage } from 'node:http';
import { request as httpsIstegi } from 'node:https';
import type { TLSSocket } from 'node:tls';
import { pavoYanitiCoz, type PavoYaniti } from '@market/shared';

/** Bağlantı kurulamadı ya da cevap alınamadı. */
export class PavoTasimaHatasi extends Error {
  constructor(
    message: string,
    /** true → istek cihaza ULAŞMIŞ olabilir; sonuç cihaza sorulmadan tekrar denenmez. */
    readonly islenmisOlabilir: boolean,
  ) {
    super(message);
    this.name = 'PavoTasimaHatasi';
  }
}

export interface PavoBaglanti {
  /** "192.168.1.50" ya da "192.168.1.50:4568". Port yoksa HTTPS'te 4567, HTTP'de 4568. */
  adres: string;
  https: boolean;
  seriNo: string;
  parmakIzi: string;
  /** Sabitlenmiş sertifika özeti (SHA-256, hex); boşsa ilk bağlantıda sabitlenir. */
  sertifika: string;
}

/** Sıra numarasını ve sertifika özetini kalıcı tutan depo (kasada ayarlar tablosu). */
export interface PavoKalicilik {
  sonSira(): number;
  sonSiraYaz(sira: number): void;
  sertifikaYaz(ozet: string): void;
}

export interface PavoGonderimi {
  /** Gövdede `inputKey` altına konur (`Sale`, `DeviceInfo`…). */
  input?: Record<string, unknown>;
  inputKey?: string;
  /** Gövdenin en üst seviyesine konan alanlar (rapor servisleri böyle bekliyor). */
  ust?: Record<string, unknown>;
  zamanAsimiMs: number;
  /** Ping / Pairing: sıra numarası tüketmez, cihaz parmak izini doğrulamaz. */
  muaf?: boolean;
  /** Pairing her zaman 1 ile gider. */
  sabitSira?: number;
  /** Sırayı atla — süren ödemeyi kesmek için. */
  siraAtla?: boolean;
}

/** Üst katmanın konuştuğu yüz; testlerde sahte cihaz bunun yerine takılır. */
export interface PavoTasiyici {
  gonder(yol: string, g: PavoGonderimi): Promise<PavoYaniti>;
}

/** Dart'ın yerel `toIso8601String()` biçimi: saat dilimi eki YOK, cihaz kendi saatiyle karşılaştırır. */
export function yerelIso(t = new Date()): string {
  const iki = (n: number, u = 2) => String(n).padStart(u, '0');
  return (
    `${t.getFullYear()}-${iki(t.getMonth() + 1)}-${iki(t.getDate())}` +
    `T${iki(t.getHours())}:${iki(t.getMinutes())}:${iki(t.getSeconds())}.${iki(t.getMilliseconds(), 3)}`
  );
}

export function adresCoz(adres: string, https: boolean): { host: string; port: number } {
  const temiz = adres
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const eslesme = /^(.+):(\d+)$/.exec(temiz);
  if (eslesme) return { host: eslesme[1]!, port: Number(eslesme[2]) };
  return { host: temiz, port: https ? 4567 : 4568 };
}

const REDDEDILDI = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'EADDRNOTAVAIL']);

export class PavoIstemci implements PavoTasiyici {
  /** Tek şerit: her istek bir öncekinin bitmesini bekler. */
  private zincir: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly baglanti: () => PavoBaglanti,
    private readonly kalicilik: PavoKalicilik,
  ) {}

  gonder(yol: string, g: PavoGonderimi): Promise<PavoYaniti> {
    if (g.siraAtla) return this.simdiGonder(yol, g);
    const sonuc = this.zincir.then(() => this.simdiGonder(yol, g));
    this.zincir = sonuc.catch(() => undefined);
    return sonuc;
  }

  private async simdiGonder(yol: string, g: PavoGonderimi): Promise<PavoYaniti> {
    const b = this.baglanti();
    if (!b.adres.trim()) throw new PavoTasimaHatasi('Pavo cihaz adresi girilmemiş (Ayarlar → POS & Yazarkasa).', false);

    for (let deneme = 1; ; deneme++) {
      let sira: number;
      if (g.sabitSira !== undefined) sira = g.sabitSira;
      else {
        sira = this.kalicilik.sonSira() + 1;
        // Write-ahead: numara istekten ÖNCE kalıcı olur.
        if (!g.muaf) this.kalicilik.sonSiraYaz(sira);
      }

      const govde: Record<string, unknown> = {
        // Üst alanlar EN BAŞTA: kimlik alanlarını hiçbir koşulda ezemezler.
        ...g.ust,
        TransactionHandle: {
          // Gerçek cihaz seri numarasını eşleştirmede de doğruluyor (hata 71).
          SerialNumber: b.seriNo,
          Fingerprint: b.parmakIzi,
          TransactionSequence: sira,
          TransactionDate: yerelIso(),
        },
        ...(g.input ? { [g.inputKey ?? 'Sale']: g.input } : {}),
      };

      const yanit = await this.gonderHttp(b, yol, govde, g.zamanAsimiMs);
      // Hata 73: doküman algoritması — sayacı 1 artırıp tekrar gönder. Cihaz
      // reddettiği isteğin numarasını da kaydettiği için +1 çalışır.
      if (!g.muaf && g.sabitSira === undefined && yanit.hata && yanit.kod === 73 && deneme < 3) continue;
      return yanit;
    }
  }

  private gonderHttp(b: PavoBaglanti, yol: string, govde: unknown, zamanAsimiMs: number): Promise<PavoYaniti> {
    const { host, port } = adresCoz(b.adres, b.https);
    const veri = Buffer.from(JSON.stringify(govde), 'utf8');

    return new Promise<PavoYaniti>((coz, reddet) => {
      let gonderildi = false;
      let bitti = false;
      let gorulenSertifika: string | null = null;
      const bitir = (f: () => void) => {
        if (bitti) return;
        bitti = true;
        clearTimeout(zamanlayici);
        f();
      };

      const secenekler = {
        host,
        port,
        path: yol,
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': veri.length },
      };
      const cevapIsle = (cevap: IncomingMessage) => {
        const parcalar: Buffer[] = [];
        cevap.on('data', (p: Buffer) => parcalar.push(p));
        cevap.on('error', () => bitir(() => reddet(new PavoTasimaHatasi('Bağlantı koptu — işlem yapılmış olabilir.', true))));
        cevap.on('end', () =>
          bitir(() => {
            let json: unknown;
            try {
              json = JSON.parse(Buffer.concat(parcalar).toString('utf8'));
            } catch {
              reddet(new PavoTasimaHatasi("Pavo'dan beklenmeyen cevap biçimi geldi.", true));
              return;
            }
            if (b.https && !b.sertifika && gorulenSertifika) this.kalicilik.sertifikaYaz(gorulenSertifika);
            coz(pavoYanitiCoz(json));
          }),
        );
      };

      const istek: ClientRequest = b.https
        ? // Cihaz kendinden imzalı sertifika kullanıyor; doğrulama aşağıda TOFU ile yapılır.
          httpsIstegi({ ...secenekler, rejectUnauthorized: false }, cevapIsle)
        : httpIstegi(secenekler, cevapIsle);

      if (b.https) {
        istek.on('socket', (soket) => {
          soket.once('secureConnect', () => {
            const ham = (soket as TLSSocket).getPeerCertificate()?.raw;
            gorulenSertifika = ham ? createHash('sha256').update(ham).digest('hex') : null;
            if (b.sertifika && gorulenSertifika !== b.sertifika) {
              istek.destroy(new Error('SERTIFIKA'));
            }
          });
        });
      }

      istek.on('error', (hata: NodeJS.ErrnoException) =>
        bitir(() => {
          if (hata.message === 'SERTIFIKA') {
            reddet(
              new PavoTasimaHatasi(
                "Pavo'nun sertifikası değişmiş — başka bir cihaza bağlanılıyor olabilir. Yeniden eşleştirin.",
                false,
              ),
            );
          } else if (!gonderildi || (hata.code && REDDEDILDI.has(hata.code))) {
            reddet(new PavoTasimaHatasi(`Pavo'ya ulaşılamadı (${host}:${port}).`, false));
          } else {
            reddet(new PavoTasimaHatasi('Bağlantı koptu — işlem yapılmış olabilir.', true));
          }
        }),
      );

      const zamanlayici = setTimeout(
        () =>
          bitir(() => {
            istek.destroy();
            // İstek gövdesi gittiyse cihaz işliyor olabilir — kör tekrar YASAK.
            reddet(
              new PavoTasimaHatasi(
                gonderildi
                  ? "Pavo'dan cevap alınamadı (zaman aşımı) — işlem yapılmış olabilir."
                  : "Pavo'ya bağlanılamadı (zaman aşımı).",
                gonderildi,
              ),
            );
          }),
        zamanAsimiMs,
      );

      istek.on('finish', () => {
        gonderildi = true;
      });
      istek.end(veri);
    });
  }
}
