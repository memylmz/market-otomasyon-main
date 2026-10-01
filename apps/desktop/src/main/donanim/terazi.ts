/**
 * Kasaya bağlı terazi sürücüleri — ortak sözleşme.
 *
 * Etiket basan barkodlu teraziler buraya girmez (terazi barkodu okunur). Bu
 * dosya kasaya kabloyla (RS-232 / USB-seri) ya da ağla bağlı, ağırlığı
 * bilgisayara gönderen teraziler içindir. Kg ürün sepete eklenirken tartım
 * penceresi teraziden canlı okur.
 *
 * Teraziler iki şekilde konuşur; ikisi de desteklenir:
 *  - Sürekli gönderen: terazi saniyede birkaç kez "ST,GS,+0001.234kg" gibi
 *    satır yollar. Komut boş bırakılır.
 *  - İstek-yanıt: kasa bir komut gönderir (çoğunda "W", ENQ = \x05 ya da
 *    "P"), terazi tek satırla yanıt verir. Komut ayarına yazılır.
 * Satır biçimleri markadan markaya değişir; `agirlikCoz` yaygın biçimlerin
 * hepsini okur (kg/g birimi, işaret, kararlı/sallanıyor bayrağı, aşırı yük).
 *
 * Sözleşme: hiçbir yöntem istisna FIRLATMAZ; sorun `basarili: false` + okunur
 * `hata` ile döner. Ağırlık gramdır (= KG ürünün miktar birimi).
 */

import { createConnection, type Socket } from 'node:net';
import type { TeraziOkumasi } from '@market/shared';

export interface TeraziSurucusu {
  readonly ad: string;
  /** Güncel ağırlık. Sürekli gönderen terazide kararlı değeri bekler (en fazla bekleme süresi kadar). */
  oku(): Promise<TeraziOkumasi>;
  test(): Promise<{ basarili: boolean; mesaj: string }>;
  kapat?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Ağırlık satırı çözümleme
// ---------------------------------------------------------------------------

/**
 * Teraziden gelen bir satırı ağırlığa çevirir; satırda ağırlık yoksa null.
 *
 * Sayı seçimi: birimi (kg/g) olan sayı; yoksa ondalıklı son sayı; yoksa son
 * sayı. Böylece "@ 01 1.234" gibi önünde durum kodu olan satırlar da okunur.
 * Birim yazmayan terazide ondalıklı değer kg, tam sayı gram kabul edilir.
 */
export function agirlikCoz(ham: string): TeraziOkumasi | null {
  // eslint-disable-next-line no-control-regex
  const metin = ham.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  if (!metin) return null;
  if (/\b(OL|OVER|OVERLOAD)\b|-OL-/i.test(metin)) return { basarili: false, hata: 'Terazi aşırı yüklü.', ham: metin };

  const sayilar = [...metin.matchAll(/([-+])?\s*(\d+(?:[.,]\d+)?)\s*(kg|g|lb)?(?![a-z])/gi)];
  if (sayilar.length === 0) return null;
  const secilen =
    sayilar.find((m) => m[3]) ?? [...sayilar].reverse().find((m) => /[.,]/.test(m[2] ?? '')) ?? sayilar[sayilar.length - 1]!;

  const birim = (secilen[3] ?? '').toLowerCase();
  if (birim === 'lb') return { basarili: false, hata: 'Terazi pound (lb) gönderiyor; terazide birimi kg yapın.', ham: metin };
  const sayi = Number.parseFloat((secilen[2] ?? '0').replace(',', '.'));
  const ondalikli = /[.,]/.test(secilen[2] ?? '');
  const isaret = secilen[1] === '-' ? -1 : 1;
  const gram = Math.round(isaret * (birim === 'g' ? sayi : birim === 'kg' || ondalikli ? sayi * 1000 : sayi));
  // Kararsız bayrakları: US (unstable), MO/M (motion), "?" — yoksa kararlı sayılır.
  const kararli = !/\b(US|MO|M)\b|\?/.test(metin);

  if (gram < 0) return { basarili: false, gram, kararli, hata: 'Ağırlık eksi — darayı kontrol edin.', ham: metin };
  if (gram === 0) return { basarili: false, gram, kararli, hata: 'Kefe boş.', ham: metin };
  return { basarili: true, gram, kararli, ham: metin };
}

/** Ayardaki komut metnini bayta çevirir: \r \n \t \xHH kaçışları. Boşsa null (sürekli gönderen terazi). */
export function komutCoz(metin: string): Buffer | null {
  if (!metin) return null;
  const cozulmus = metin
    .replace(/\\x([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
  return Buffer.from(cozulmus, 'latin1');
}

/** "8N1", "7E1" → seri çerçeve. Tanınmazsa 8N1. */
export function cerceveCoz(metin: string): { dataBits: 7 | 8; parity: 'none' | 'even' | 'odd'; stopBits: 1 | 2 } {
  const m = /^([78])([NEO])([12])$/i.exec(metin.trim());
  if (!m) return { dataBits: 8, parity: 'none', stopBits: 1 };
  const parite = m[2]!.toUpperCase();
  return {
    dataBits: m[1] === '7' ? 7 : 8,
    parity: parite === 'E' ? 'even' : parite === 'O' ? 'odd' : 'none',
    stopBits: m[3] === '2' ? 2 : 1,
  };
}

const hataMetni = (hata: unknown) => (hata instanceof Error ? hata.message : String(hata));

function testMesaji(o: TeraziOkumasi): { basarili: boolean; mesaj: string } {
  if (o.basarili) {
    return { basarili: true, mesaj: `Okundu: ${(o.gram! / 1000).toFixed(3)} kg${o.kararli ? '' : ' (sallanıyor)'}` };
  }
  // Boş kefe de bağlantının çalıştığını gösterir.
  if (o.gram === 0) return { basarili: true, mesaj: 'Bağlantı çalışıyor — kefe boş (0,000 kg).' };
  return { basarili: false, mesaj: o.hata ?? 'Okunamadı.' };
}

// ---------------------------------------------------------------------------
// Simülatör
// ---------------------------------------------------------------------------

/** Gerçek terazi olmadan akışı denemek için: her okumada sabit ve kararlı bir ağırlık. */
export class TeraziSimulatoru implements TeraziSurucusu {
  readonly ad = 'Test simülatörü';
  constructor(private readonly gram = 1250) {}

  async oku(): Promise<TeraziOkumasi> {
    return { basarili: true, gram: this.gram, kararli: true, ham: `ST,GS,+${(this.gram / 1000).toFixed(3)}kg` };
  }

  async test(): Promise<{ basarili: boolean; mesaj: string }> {
    return { basarili: true, mesaj: `Simülatör hazır — her okumada ${(this.gram / 1000).toFixed(3)} kg döner.` };
  }
}

// ---------------------------------------------------------------------------
// Akış (seri / ağ) terazisi
// ---------------------------------------------------------------------------

/** Açık bir bağlantı — seri port ya da TCP soketi. */
export interface TeraziBaglantisi {
  yaz(veri: Buffer): void;
  kapat(): Promise<void>;
}

/** Bağlantıyı açar; gelen veriyi `veri`ye, kopmayı `koptu`ya iletir. */
export type BaglantiAcici = (veri: (parca: Buffer) => void, koptu: () => void) => Promise<TeraziBaglantisi>;

/**
 * Bağlantı ilk okumada açılır ve açık tutulur (her okumada port açıp kapamak
 * yavaştır, bazı USB-seri çeviriciler bunu sevmez). Koparsa sonraki okumada
 * yeniden açılır.
 */
export class AkisTerazisi implements TeraziSurucusu {
  private baglanti: Promise<TeraziBaglantisi> | null = null;
  private tampon = '';
  private sonHam = '';
  private readonly dinleyiciler = new Set<(o: TeraziOkumasi) => void>();

  constructor(
    readonly ad: string,
    private readonly ac: BaglantiAcici,
    private readonly komut: Buffer | null,
    private readonly beklemeMs = 1500,
  ) {}

  private bagla(): Promise<TeraziBaglantisi> {
    if (!this.baglanti) {
      this.baglanti = this.ac(
        (parca) => this.veriGeldi(parca),
        () => {
          this.baglanti = null;
        },
      ).catch((hata: unknown) => {
        this.baglanti = null;
        throw hata;
      });
    }
    return this.baglanti;
  }

  private veriGeldi(parca: Buffer): void {
    this.tampon += parca.toString('latin1');
    // Satır sonu: CR, LF ya da ETX (0x03). Son parça yarım olabilir, tamponda kalır.
    // eslint-disable-next-line no-control-regex
    const satirlar = this.tampon.split(/[\r\n\x03]+/);
    this.tampon = (satirlar.pop() ?? '').slice(-512);
    for (const satir of satirlar) {
      if (!satir.trim()) continue;
      this.sonHam = satir;
      const okuma = agirlikCoz(satir);
      if (okuma) for (const d of [...this.dinleyiciler]) d(okuma);
    }
  }

  async oku(): Promise<TeraziOkumasi> {
    let baglanti: TeraziBaglantisi;
    try {
      baglanti = await this.bagla();
    } catch (hata) {
      return { basarili: false, hata: `Teraziye bağlanılamadı: ${hataMetni(hata)}` };
    }
    return new Promise((coz) => {
      let son: TeraziOkumasi | null = null;
      const bitir = (o: TeraziOkumasi) => {
        clearTimeout(zamanlayici);
        this.dinleyiciler.delete(dinleyici);
        coz(o);
      };
      // İstek-yanıtta ilk yanıt; sürekli gönderende kararlı değer ya da hata beklenir.
      const dinleyici = (o: TeraziOkumasi) => {
        son = o;
        if (this.komut || o.kararli || (!o.basarili && o.gram === undefined)) bitir(o);
      };
      const zamanlayici = setTimeout(
        () =>
          bitir(
            son ??
              (this.sonHam
                ? { basarili: false, hata: `Terazi verisi çözülemedi: "${this.sonHam.trim().slice(0, 40)}"`, ham: this.sonHam }
                : { basarili: false, hata: 'Teraziden veri gelmedi. Kablo, port, hız (baud) ve komut ayarını kontrol edin.' }),
          ),
        this.beklemeMs,
      );
      this.dinleyiciler.add(dinleyici);
      if (this.komut) {
        try {
          baglanti.yaz(this.komut);
        } catch (hata) {
          bitir({ basarili: false, hata: `Teraziye komut gönderilemedi: ${hataMetni(hata)}` });
        }
      }
    });
  }

  async test(): Promise<{ basarili: boolean; mesaj: string }> {
    return testMesaji(await this.oku());
  }

  async kapat(): Promise<void> {
    const b = this.baglanti;
    this.baglanti = null;
    if (!b) return;
    try {
      await (await b).kapat();
    } catch {
      /* zaten kapalı */
    }
  }
}

/** Seri port (COM) bağlantısı. `PortSinifi` testte SerialPortMock verilir. */
export function seriAcici(
  secenek: { yol: string; baud: number; cerceve: string },
  PortSinifi?: typeof import('serialport').SerialPort,
): BaglantiAcici {
  return async (veri, koptu) => {
    if (!secenek.yol) throw new Error('Port seçilmedi (ör. COM3).');
    const Sinif = PortSinifi ?? (await import('serialport')).SerialPort;
    const port = new Sinif({ path: secenek.yol, baudRate: secenek.baud, ...cerceveCoz(secenek.cerceve), autoOpen: false });
    await new Promise<void>((coz, red) =>
      port.open((h) => (h ? red(new Error(`${secenek.yol} açılamadı: ${h.message}`)) : coz())),
    );
    port.on('data', (parca: Buffer) => veri(parca));
    port.on('close', koptu);
    port.on('error', koptu);
    return {
      yaz: (b) => {
        port.write(b);
      },
      kapat: () => new Promise<void>((coz) => (port.isOpen ? port.close(() => coz()) : coz())),
    };
  };
}

/** Ağ (Ethernet) terazisi: "192.168.1.60:4001". */
export function agAcici(adres: string): BaglantiAcici {
  return (veri, koptu) =>
    new Promise((coz, red) => {
      const [host, portMetni] = adres.split(':');
      const port = Number(portMetni);
      if (!host || !Number.isInteger(port) || port <= 0) {
        red(new Error('Adres IP:port biçiminde olmalı (ör. 192.168.1.60:4001).'));
        return;
      }
      const soket: Socket = createConnection({ host, port });
      const zaman = setTimeout(() => {
        soket.destroy();
        red(new Error(`${adres} yanıt vermedi.`));
      }, 3000);
      soket.once('connect', () => {
        clearTimeout(zaman);
        soket.on('data', veri);
        soket.on('close', koptu);
        coz({
          yaz: (b) => {
            soket.write(b);
          },
          kapat: async () => {
            soket.destroy();
          },
        });
      });
      soket.once('error', (h) => {
        clearTimeout(zaman);
        koptu();
        red(h);
      });
    });
}

export interface TeraziSecenekleri {
  adres: string;
  baud: number;
  cerceve: string;
  komut: string;
  beklemeMs?: number;
}

/** Ayardaki türe göre sürücü; KAPALI ya da bilinmeyen türde null. */
export function teraziSurucusuOlustur(tur: string, s: TeraziSecenekleri): TeraziSurucusu | null {
  switch (tur) {
    case 'SIMULATOR':
      return new TeraziSimulatoru();
    case 'SERI':
      return new AkisTerazisi(
        `Seri terazi (${s.adres || 'port yok'})`,
        seriAcici({ yol: s.adres, baud: s.baud, cerceve: s.cerceve }),
        komutCoz(s.komut),
        s.beklemeMs,
      );
    case 'AG':
      return new AkisTerazisi(`Ağ terazisi (${s.adres || 'adres yok'})`, agAcici(s.adres), komutCoz(s.komut), s.beklemeMs);
    default:
      return null;
  }
}
