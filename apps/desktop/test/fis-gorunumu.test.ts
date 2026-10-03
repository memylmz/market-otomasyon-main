/**
 * Geçmiş fişin ekranda gösterimi — yazıcıdan çıkacak fişin aynısı olmalı.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet, AYAR } from '@market/shared';
import { ayarYaz } from '../src/main/depo/ayar.js';
import { satisKesinlestir } from '../src/main/servis/satis-servis.js';
import { satisFisiGorunumu } from '../src/main/servis/yazdirma-servis.js';
import { testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;
let satisId: string;
let fisNo: string;

beforeEach(async () => {
  ortam = await testOrtamiKur();
  ayarYaz(ortam.uygulama.vt, AYAR.ISLETME_ADI, 'Demo Market');
  const urun = urunEkle(ortam, { ad: 'Ekmek', satisFiyati: 1500, stok: adet(10) });
  const sonuc = satisKesinlestir(ortam.uygulama.baglam, ortam.admin, {
    kalemler: [{ urun_id: urun, miktar: adet(2), birim_fiyat: 1500 }],
    odemeler: [{ tip: 'KART', tutar: 3000, pos_onay_kodu: '123456', pos_kart: '**** 4242' }],
  });
  satisId = sonuc.satisId;
  fisNo = sonuc.fisNo;
});

afterEach(async () => {
  await ortam.temizle();
});

describe('fiş görünümü', () => {
  it('görsel fiş açıkken (varsayılan) yazıcıya giden HTML döner: işletme, kalem, toplam, KOPYA, POS', () => {
    const g = satisFisiGorunumu(ortam.uygulama.baglam, satisId);
    expect(g.tur).toBe('html');
    if (g.tur !== 'html') return;
    expect(g.enNokta).toBeGreaterThan(0);
    for (const parca of ['Demo Market', 'Ekmek', fisNo, 'KOPYA', 'TOPLAM', '30,00', '**** 4242', 'Onay 123456']) {
      expect(g.html).toContain(parca);
    }
  });

  it('görsel fiş kapalıyken metin fişi döner', () => {
    ayarYaz(ortam.uygulama.vt, AYAR.YAZICI_GORSEL_FIS, '0');
    const g = satisFisiGorunumu(ortam.uygulama.baglam, satisId);
    expect(g.tur).toBe('metin');
    if (g.tur !== 'metin') return;
    const metin = g.ogeler.map((o) => (o.tip === 'metin' ? o.metin : '')).join('\n');
    expect(metin).toContain('Ekmek');
    expect(metin).toContain('KOPYA');
  });

  it('olmayan satış için hata', () => {
    expect(() => satisFisiGorunumu(ortam.uygulama.baglam, 'yok')).toThrow();
  });
});
