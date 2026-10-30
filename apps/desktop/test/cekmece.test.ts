/**
 * Fişsiz nakit satışta çekmece: fiş basılmasa da para üstü için açılır;
 * kart satışında ve "çekmece aç" ayarı kapalıyken açılmaz.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AYAR, adet } from '@market/shared';
import { ayarYaz } from '../src/main/depo/ayar.js';
import { satisKesinlestir } from '../src/main/servis/satis-servis.js';
import { fissizSatistaCekmeceyiAc } from '../src/main/servis/yazdirma-servis.js';
import { testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;
let hedef: string;

beforeEach(async () => {
  ortam = await testOrtamiKur();
  hedef = join(ortam.kok, 'yazici.bin');
  ayarYaz(ortam.uygulama.vt, AYAR.YAZICI_TIPI, 'DOSYA');
  ayarYaz(ortam.uygulama.vt, AYAR.YAZICI_HEDEF, hedef);
});

afterEach(async () => {
  await ortam.temizle();
});

/** ESC p — çekmece darbesi. */
const cekmeceDarbesiVar = () => existsSync(hedef) && readFileSync(hedef).includes(Buffer.from([0x1b, 0x70]));

function sat(tip: 'NAKIT' | 'KART') {
  const urun = urunEkle(ortam, { satisFiyati: 1000, stok: adet(10) });
  return satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
    kalemler: [{ urun_id: urun, miktar: adet(1), birim_fiyat: 1000 }],
    odemeler: [tip === 'NAKIT' ? { tip, tutar: 1000, alinan: 2000 } : { tip, tutar: 1000 }],
  });
}

describe('fişsiz satışta çekmece', () => {
  it('nakit satışta fiş basılmasa da çekmece açılır', async () => {
    const { satisId } = sat('NAKIT');
    await fissizSatistaCekmeceyiAc(ortam.uygulama.baglam, satisId);
    expect(cekmeceDarbesiVar()).toBe(true);
  });

  it('kart satışında açılmaz', async () => {
    const { satisId } = sat('KART');
    await fissizSatistaCekmeceyiAc(ortam.uygulama.baglam, satisId);
    expect(cekmeceDarbesiVar()).toBe(false);
  });

  it('"çekmece aç" ayarı kapalıysa açılmaz', async () => {
    ayarYaz(ortam.uygulama.vt, AYAR.CEKMECE_ACIK, '0');
    rmSync(hedef, { force: true });
    const { satisId } = sat('NAKIT');
    await fissizSatistaCekmeceyiAc(ortam.uygulama.baglam, satisId);
    expect(cekmeceDarbesiVar()).toBe(false);
  });
});
