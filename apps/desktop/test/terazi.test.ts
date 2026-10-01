/**
 * Kasaya bağlı terazi entegrasyonu.
 *
 * Gerçek terazi takılmadan önce: yaygın satır biçimleri, sürekli gönderen ve
 * istek-yanıtlı teraziler, seri port (sahte port) ve ağ (gerçek TCP sunucusu)
 * bağlantıları, kopma ve yeniden bağlanma, aç/kapa ayarı.
 */

import { createServer, type Server, type Socket } from 'node:net';
import { SerialPortMock } from 'serialport';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ayarYaz } from '../src/main/depo/ayar.js';
import {
  agAcici,
  agirlikCoz,
  AkisTerazisi,
  cerceveCoz,
  komutCoz,
  seriAcici,
  teraziSurucusuOlustur,
  type BaglantiAcici,
} from '../src/main/donanim/terazi.js';
import { teraziDurumu, teraziOku, teraziTesti } from '../src/main/servis/terazi-servis.js';
import { testOrtamiKur, type TestOrtami } from './yardimci.js';

describe('ağırlık satırı çözümleme', () => {
  it.each([
    ['ST,GS,+0001.234kg', 1234, true],
    ['US,GS,+0001.234kg', 1234, false],
    ['ST,NT,  0.500 kg', 500, true],
    ['\x02  1.250\x03', 1250, true],
    ['W 2,750 kg', 2750, true],
    ['  850 g', 850, true],
    ['1234', 1234, true],
    ['@ 01 1.234', 1234, true],
    ['S S     0.355 kg', 355, true],
    ['S D     0.355 kg', 355, true],
    ['M  0.410kg', 410, false],
    ['? 0.410kg', 410, false],
  ])('%j → %i gram (kararlı: %s)', (satir, gram, kararli) => {
    expect(agirlikCoz(satir)).toMatchObject({ basarili: true, gram, kararli });
  });

  it('boş kefe, eksi ağırlık, aşırı yük ve pound okunur hataya döner', () => {
    expect(agirlikCoz('ST,GS,+0000.000kg')).toMatchObject({ basarili: false, gram: 0, hata: 'Kefe boş.' });
    expect(agirlikCoz('ST,GS,-0000.120kg')).toMatchObject({ basarili: false, hata: expect.stringContaining('dara') });
    expect(agirlikCoz('ST,GS,  OL  kg')).toMatchObject({ basarili: false, hata: expect.stringContaining('aşırı') });
    expect(agirlikCoz('1.500 lb')).toMatchObject({ basarili: false, hata: expect.stringContaining('lb') });
  });

  it('ağırlık içermeyen satır yok sayılır', () => {
    expect(agirlikCoz('')).toBeNull();
    expect(agirlikCoz('\r\n')).toBeNull();
    expect(agirlikCoz('READY')).toBeNull();
  });

  it('komut kaçışları ve seri çerçeve', () => {
    expect(komutCoz('')).toBeNull();
    expect(komutCoz('W\\r\\n')).toEqual(Buffer.from('W\r\n', 'latin1'));
    expect(komutCoz('\\x05')).toEqual(Buffer.from([0x05]));
    expect(cerceveCoz('7E1')).toEqual({ dataBits: 7, parity: 'even', stopBits: 1 });
    expect(cerceveCoz('8N2')).toEqual({ dataBits: 8, parity: 'none', stopBits: 2 });
    expect(cerceveCoz('saçma')).toEqual({ dataBits: 8, parity: 'none', stopBits: 1 });
  });
});

// ---------------------------------------------------------------------------

/** Elle sürülen bağlantı: testte teraziyi biz konuşturuz. */
function sahteBaglanti() {
  const durum = {
    acilis: 0,
    yazilan: [] as string[],
    gonder: (_: string) => {},
    kopar: () => {},
    yanitla: null as ((komut: string) => string) | null,
  };
  const acici: BaglantiAcici = async (veri, koptu) => {
    durum.acilis += 1;
    durum.gonder = (metin) => veri(Buffer.from(metin, 'latin1'));
    durum.kopar = koptu;
    return {
      yaz: (b) => {
        const komut = b.toString('latin1');
        durum.yazilan.push(komut);
        const yanit = durum.yanitla?.(komut);
        if (yanit) setTimeout(() => durum.gonder(yanit), 5);
      },
      kapat: async () => {},
    };
  };
  return { durum, acici };
}

describe('akış terazisi', () => {
  it('sürekli gönderen terazi: sallanırken beklenir, ilk kararlı değer döner', async () => {
    const { durum, acici } = sahteBaglanti();
    const terazi = new AkisTerazisi('t', acici, null, 500);
    const okuma = terazi.oku();
    await new Promise((c) => setTimeout(c, 5));
    durum.gonder('US,GS,+0001.100kg\r\nUS,GS,+0001.2');
    durum.gonder('30kg\r\nST,GS,+0001.240kg\r\n');
    expect(await okuma).toMatchObject({ basarili: true, gram: 1240, kararli: true });
  });

  it('kefe hiç durmazsa süre sonunda son (sallanan) değer döner — arayüz bunu satışa almaz', async () => {
    const { durum, acici } = sahteBaglanti();
    const terazi = new AkisTerazisi('t', acici, null, 60);
    const okuma = terazi.oku();
    await new Promise((c) => setTimeout(c, 5));
    durum.gonder('US,GS,+0000.900kg\r\n');
    expect(await okuma).toMatchObject({ basarili: true, gram: 900, kararli: false });
  });

  it('istek-yanıtlı terazi: komut gönderilir, ilk yanıt döner', async () => {
    const { durum, acici } = sahteBaglanti();
    durum.yanitla = (k) => (k === '\x05' ? '  0.750 kg\r' : '');
    const terazi = new AkisTerazisi('t', acici, komutCoz('\\x05'), 500);
    expect(await terazi.oku()).toMatchObject({ basarili: true, gram: 750 });
    expect(durum.yazilan).toEqual(['\x05']);
  });

  it('veri gelmezse ya da çözülemezse okunur hata döner', async () => {
    const { durum, acici } = sahteBaglanti();
    const terazi = new AkisTerazisi('t', acici, null, 40);
    expect(await terazi.oku()).toMatchObject({ basarili: false, hata: expect.stringContaining('veri gelmedi') });
    const okuma = terazi.oku();
    await new Promise((c) => setTimeout(c, 5));
    durum.gonder('READY\r\n');
    expect(await okuma).toMatchObject({ basarili: false, hata: expect.stringContaining('çözülemedi') });
  });

  it('bağlantı açık tutulur; koparsa sonraki okumada yeniden açılır', async () => {
    const { durum, acici } = sahteBaglanti();
    durum.yanitla = () => '1.000kg\r';
    const terazi = new AkisTerazisi('t', acici, komutCoz('W'), 300);
    await terazi.oku();
    await terazi.oku();
    expect(durum.acilis).toBe(1);
    durum.kopar();
    await terazi.oku();
    expect(durum.acilis).toBe(2);
  });

  it('bağlantı açılamazsa istisna değil okunur hata döner', async () => {
    const terazi = new AkisTerazisi('t', () => Promise.reject(new Error('COM9 bulunamadı')), null, 50);
    expect(await terazi.oku()).toMatchObject({ basarili: false, hata: expect.stringContaining('COM9 bulunamadı') });
    expect((await terazi.test()).basarili).toBe(false);
  });
});

describe('seri port terazisi (sahte port)', () => {
  beforeEach(() => {
    // serialport'un kendi sahte bağlayıcısı (ayrı kurulan @serialport/binding-mock kopyası değil).
    SerialPortMock.binding.reset();
    SerialPortMock.binding.createPort('/dev/TERAZI', { echo: false, record: true });
  });

  it('komutu porta yazar, porttan gelen satırı okur; seçilen hız ve çerçeve ile açılır', async () => {
    let acilan: SerialPortMock | null = null;
    class KayitliPort extends SerialPortMock {
      constructor(secenek: ConstructorParameters<typeof SerialPortMock>[0]) {
        super(secenek);
        acilan = this; // eslint-disable-line @typescript-eslint/no-this-alias
      }
    }
    const acici = seriAcici({ yol: '/dev/TERAZI', baud: 4800, cerceve: '7E1' }, KayitliPort as never);
    const terazi = new AkisTerazisi('seri', acici, komutCoz('W'), 1000);
    const okuma = terazi.oku();
    await new Promise((c) => setTimeout(c, 50));
    const port = acilan as unknown as SerialPortMock;
    expect(port.baudRate).toBe(4800);
    expect(port.port?.openOptions).toMatchObject({ dataBits: 7, parity: 'even', stopBits: 1 });
    expect(port.port?.recording.toString('latin1')).toBe('W');
    port.port?.emitData(Buffer.from('ST,GS,+0001.500kg\r\n', 'latin1'));
    expect(await okuma).toMatchObject({ basarili: true, gram: 1500, kararli: true });
    await terazi.kapat();
  });

  it('olmayan port okunur hata verir', async () => {
    const terazi = new AkisTerazisi(
      'seri',
      seriAcici({ yol: '/dev/YOK', baud: 9600, cerceve: '8N1' }, SerialPortMock as never),
      null,
      100,
    );
    expect(await terazi.oku()).toMatchObject({ basarili: false, hata: expect.stringContaining('/dev/YOK') });
  });

  it('port seçilmemişse anlaşılır hata', async () => {
    const terazi = new AkisTerazisi('seri', seriAcici({ yol: '', baud: 9600, cerceve: '8N1' }), null, 100);
    expect(await terazi.oku()).toMatchObject({ basarili: false, hata: expect.stringContaining('Port seçilmedi') });
  });
});

describe('ağ terazisi (gerçek TCP)', () => {
  let sunucu: Server;
  let adres: string;
  let istemciler: Socket[];

  beforeEach(async () => {
    istemciler = [];
    sunucu = createServer((s) => {
      istemciler.push(s);
      s.on('data', (d) => {
        if (d.toString('latin1') === 'W\r\n') s.write('ST,GS,+0002.345kg\r\n');
      });
    });
    await new Promise<void>((c) => sunucu.listen(0, '127.0.0.1', c));
    const a = sunucu.address() as { port: number };
    adres = `127.0.0.1:${a.port}`;
  });

  afterEach(async () => {
    for (const s of istemciler) s.destroy();
    await new Promise((c) => sunucu.close(c));
  });

  it('komut gönderir, ağırlığı okur', async () => {
    const terazi = new AkisTerazisi('ağ', agAcici(adres), komutCoz('W\\r\\n'), 1000);
    expect(await terazi.oku()).toMatchObject({ basarili: true, gram: 2345, kararli: true });
    await terazi.kapat();
  });

  it('sürekli gönderen ağ terazisi', async () => {
    const terazi = new AkisTerazisi('ağ', agAcici(adres), null, 1000);
    const okuma = terazi.oku();
    await new Promise((c) => setTimeout(c, 50));
    for (const s of istemciler) s.write('ST,GS,+0000.660kg\r\n');
    expect(await okuma).toMatchObject({ basarili: true, gram: 660 });
    await terazi.kapat();
  });

  it('hatalı adres ve kapalı port okunur hata verir', async () => {
    expect(await new AkisTerazisi('ağ', agAcici('sadece-ip'), null, 100).oku()).toMatchObject({
      basarili: false,
      hata: expect.stringContaining('IP:port'),
    });
    await new Promise((c) => sunucu.close(c));
    sunucu = createServer();
    await new Promise<void>((c) => sunucu.listen(0, '127.0.0.1', c));
    const bosPort = (sunucu.address() as { port: number }).port;
    await new Promise((c) => sunucu.close(c));
    sunucu = createServer();
    await new Promise<void>((c) => sunucu.listen(0, '127.0.0.1', c));
    expect(await new AkisTerazisi('ağ', agAcici(`127.0.0.1:${bosPort}`), null, 100).oku()).toMatchObject({
      basarili: false,
      hata: expect.stringContaining('bağlanılamadı'),
    });
  });
});

// ---------------------------------------------------------------------------

describe('terazi servisi — aç/kapa', () => {
  let ortam: TestOrtami;
  beforeEach(async () => {
    ortam = await testOrtamiKur();
  });
  afterEach(async () => {
    await ortam.temizle();
  });

  it('varsayılan kapalı: okuma istenemez, test "Kapalı" der', async () => {
    expect(teraziDurumu(ortam.uygulama.baglam)).toMatchObject({ aktif: false, tur: 'KAPALI' });
    await expect(teraziOku(ortam.uygulama.baglam, ortam.admin)).rejects.toThrow(/kapalı/);
    expect((await teraziTesti(ortam.uygulama.baglam, ortam.admin)).basarili).toBe(false);
  });

  it('simülatör açılınca okunur, kapatılınca yine kapalıdır', async () => {
    ayarYaz(ortam.uygulama.vt, 'terazi.turu', 'SIMULATOR');
    expect(teraziDurumu(ortam.uygulama.baglam).aktif).toBe(true);
    expect(await teraziOku(ortam.uygulama.baglam, ortam.admin)).toMatchObject({ basarili: true, gram: 1250, kararli: true });
    ayarYaz(ortam.uygulama.vt, 'terazi.turu', 'KAPALI');
    expect(teraziDurumu(ortam.uygulama.baglam).aktif).toBe(false);
  });

  it('bilinmeyen tür kapalı sayılır; seri/ağ türleri sürücü üretir', () => {
    const s = { adres: 'COM3', baud: 9600, cerceve: '8N1', komut: '' };
    expect(teraziSurucusuOlustur('BILINMEYEN', s)).toBeNull();
    expect(teraziSurucusuOlustur('SERI', s)?.ad).toContain('COM3');
    expect(teraziSurucusuOlustur('AG', { ...s, adres: '10.0.0.5:4001' })?.ad).toContain('10.0.0.5');
  });

  it('satış yetkisi olmayan teraziyi okuyamaz', async () => {
    ayarYaz(ortam.uygulama.vt, 'terazi.turu', 'SIMULATOR');
    await expect(teraziOku(ortam.uygulama.baglam, { ...ortam.admin, yetkiler: new Set() })).rejects.toThrow();
  });
});
