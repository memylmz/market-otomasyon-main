/**
 * Fiş önizlemesinin doğruluğu (§13.2).
 *
 * NEDEN VAR: önizleme, yazıcıya giden BAYT AKIŞINDAN geri çözülür. Çözücü
 * bozulursa ekranda düzgün duran fiş kağıtta bambaşka oturur ve bu ancak
 * baskıdan sonra anlaşılır. Eskiden çözücü biçimlendirmeyi tümden atıyordu:
 * kalın yazı, çift punto ve hizalama yok sayılıyordu.
 */

import { describe, expect, it } from 'vitest';
import { EscPosYazici } from '../src/main/donanim/escpos.js';

const yapi = (kur: (y: EscPosYazici) => EscPosYazici) => EscPosYazici.onizlemeYapisi(kur(new EscPosYazici(48)).bitir());

describe('fiş önizleme çözücüsü', () => {
  it('hizalamayı korur', () => {
    const { ogeler } = yapi((y) => y.baslat().hizala('orta').satir('BAŞLIK').hizala('sol').satir('gövde'));
    const metinler = ogeler.filter((o) => o.tip === 'metin');
    expect(metinler[0]).toMatchObject({ metin: 'BAŞLIK', hiza: 'orta' });
    expect(metinler[1]).toMatchObject({ metin: 'gövde', hiza: 'sol' });
  });

  it('kalın yazıyı korur', () => {
    const { ogeler } = yapi((y) => y.baslat().kalin(true).satir('TOPLAM').kalin(false).satir('normal'));
    const metinler = ogeler.filter((o) => o.tip === 'metin');
    expect(metinler[0]).toMatchObject({ metin: 'TOPLAM', kalin: true });
    expect(metinler[1]).toMatchObject({ metin: 'normal', kalin: false });
  });

  it('punto büyütmesini korur', () => {
    const { ogeler } = yapi((y) => y.baslat().boyut(2).satir('125,00').boyut(1).satir('küçük'));
    const metinler = ogeler.filter((o) => o.tip === 'metin');
    expect(metinler[0]).toMatchObject({ metin: '125,00', boyut: 2 });
    expect(metinler[1]).toMatchObject({ boyut: 1 });
  });

  /** Türkçe harfler CP857 ile kodlanır; geri çözüm aynı harfi vermeli. */
  it('Türkçe karakterleri doğru geri çözer', () => {
    const { ogeler } = yapi((y) => y.baslat().satir('Çğıİöşü ürünü'));
    expect(ogeler.filter((o) => o.tip === 'metin')[0]).toMatchObject({ metin: 'Çğıİöşü ürünü' });
  });

  /** Barkod ayrı bir öğedir; metin olarak çözülürse ekranda çöp görünür. */
  it('barkodu ayrı öğe olarak çözer ve kod kümesi önekini atar', () => {
    const { ogeler } = yapi((y) => y.baslat().barkod('8690000000017'));
    const barkod = ogeler.find((o) => o.tip === 'barkod');
    expect(barkod).toMatchObject({ tip: 'barkod', veri: '8690000000017' });
  });

  it('kesme noktasını işaretler', () => {
    const { ogeler } = yapi((y) => y.baslat().satir('fiş').kes());
    expect(ogeler.some((o) => o.tip === 'kesme')).toBe(true);
  });

  /** Çekmece komutu kağıda hiçbir şey basmaz; önizlemede görünmemeli. */
  it('çekmece komutu önizlemede iz bırakmaz', () => {
    const { ogeler } = yapi((y) => y.baslat().cekmeceAc().satir('tek satır'));
    expect(ogeler.filter((o) => o.tip === 'metin').map((o) => (o.tip === 'metin' ? o.metin : ''))).toEqual(['tek satır']);
  });

  it('iki sütunlu satır tam genişlikte kalır', () => {
    const { ogeler } = yapi((y) => y.baslat().ikiSutun('Ekmek', '12,50 TL'));
    const satir = ogeler.filter((o) => o.tip === 'metin')[0];
    expect(satir?.tip === 'metin' && satir.metin.length).toBe(48);
  });
});
