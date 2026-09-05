import { describe, expect, it } from 'vitest';
import {
  dagit,
  kdvAyir,
  kdvEkle,
  nakitOnerileri,
  paraDuz,
  paraFormat,
  paraParse,
  paraUstuBoz,
  tlToKurus,
  yuvarla,
  yuzdeUygula,
} from '@market/shared';

describe('yuvarla — sıfırdan uzağa yuvarlama', () => {
  it('yarımları sıfırdan uzağa yuvarlar', () => {
    expect(yuvarla(0.5)).toBe(1);
    expect(yuvarla(-0.5)).toBe(-1);
    expect(yuvarla(1.5)).toBe(2);
    expect(yuvarla(-1.5)).toBe(-2);
    expect(yuvarla(2.4)).toBe(2);
    expect(yuvarla(-2.4)).toBe(-2);
  });

  it('negatif sıfır üretmez', () => {
    expect(Object.is(yuvarla(-0.2), -0)).toBe(false);
    expect(yuvarla(-0.2)).toBe(0);
  });
});

describe('paraParse — kullanıcı girdisi', () => {
  it('TR biçimini (binlik nokta, ondalık virgül) çözer', () => {
    expect(paraParse('1.234,56')).toBe(123456);
    expect(paraParse('0,05')).toBe(5);
    expect(paraParse('137,50')).toBe(13750);
    expect(paraParse('1.000')).toBe(100000);
  });

  it('nokta ondalıklı biçimi çözer', () => {
    expect(paraParse('1234.56')).toBe(123456);
    expect(paraParse('1,234.56')).toBe(123456);
  });

  it('₺ işaretini ve boşlukları yok sayar', () => {
    expect(paraParse(' 25,00 ₺ ')).toBe(2500);
  });

  it('negatif tutarları destekler', () => {
    expect(paraParse('-12,30')).toBe(-1230);
  });

  it('kuruştan küçük hassasiyeti yuvarlar', () => {
    expect(paraParse('1,005')).toBe(101);
    expect(paraParse('1,004')).toBe(100);
  });

  it('geçersiz girdide null döner', () => {
    expect(paraParse('abc')).toBeNull();
    expect(paraParse('')).toBeNull();
    expect(paraParse(null)).toBeNull();
    expect(paraParse('12,3a')).toBeNull();
  });

  it('biçimlendirme ile gidiş-dönüş tutarlıdır', () => {
    for (const kurus of [0, 1, 99, 100, 12345, 999999, 100000000]) {
      expect(paraParse(paraFormat(kurus))).toBe(kurus);
      expect(paraParse(paraDuz(kurus))).toBe(kurus);
    }
  });
});

describe('paraFormat', () => {
  it('TR yerelinde biçimlendirir', () => {
    expect(paraFormat(123456)).toBe('1.234,56 ₺');
    expect(paraFormat(0)).toBe('0,00 ₺');
    expect(paraFormat(-500, { simge: false })).toBe('-5,00');
  });
});

describe('KDV ayırma — matrah + kdv === brüt değişmezi', () => {
  it('bilinen değerleri doğru hesaplar', () => {
    // 120,00 ₺ KDV dahil, %20 → matrah 100,00 / KDV 20,00
    expect(kdvAyir(12000, 20)).toMatchObject({ matrah: 10000, kdv: 2000 });
    // 110,00 ₺ KDV dahil, %10 → matrah 100,00 / KDV 10,00
    expect(kdvAyir(11000, 10)).toMatchObject({ matrah: 10000, kdv: 1000 });
    expect(kdvAyir(10100, 1)).toMatchObject({ matrah: 10000, kdv: 100 });
  });

  it('%0 oranında KDV üretmez', () => {
    expect(kdvAyir(5000, 0)).toMatchObject({ matrah: 5000, kdv: 0 });
  });

  it('her tutar ve oranda matrah + kdv === brüt', () => {
    for (const oran of [0, 1, 10, 20]) {
      for (let brut = 0; brut <= 5000; brut += 7) {
        const { matrah, kdv } = kdvAyir(brut, oran);
        expect(matrah + kdv).toBe(brut);
      }
    }
  });

  it('kdvEkle ile ayırma birbirini yaklaşık tersler', () => {
    const { brut } = kdvEkle(10000, 20);
    expect(brut).toBe(12000);
    expect(kdvAyir(brut, 20).matrah).toBe(10000);
  });
});

describe('yuzdeUygula', () => {
  it('sıfırdan uzağa yuvarlar', () => {
    expect(yuzdeUygula(1000, 18)).toBe(180);
    expect(yuzdeUygula(333, 50)).toBe(167); // 166,5 → 167
    expect(yuzdeUygula(-333, 50)).toBe(-167);
  });
});

describe('dagit — kuruş kaybı olmadan dağıtım', () => {
  it('toplamı tam olarak korur', () => {
    for (const toplam of [100, 101, 999, 1, 7, 12345]) {
      for (const agirliklar of [
        [1, 1, 1],
        [3, 1],
        [5, 5, 5, 5, 5, 5, 5],
        [10, 0, 3],
      ]) {
        const paylar = dagit(toplam, agirliklar);
        expect(paylar.reduce((a, b) => a + b, 0)).toBe(toplam);
        expect(paylar).toHaveLength(agirliklar.length);
      }
    }
  });

  it('negatif toplamı da tam dağıtır', () => {
    const paylar = dagit(-100, [1, 1, 1]);
    expect(paylar.reduce((a, b) => a + b, 0)).toBe(-100);
  });

  it('ağırlık yoksa eşit dağıtır', () => {
    expect(dagit(10, [0, 0, 0]).reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('boş listede boş döner', () => {
    expect(dagit(100, [])).toEqual([]);
  });

  it('ağırlıkla orantılıdır', () => {
    expect(dagit(1000, [3, 1])).toEqual([750, 250]);
  });
});

describe('para üstü yardımcıları', () => {
  it('en az sayıda birime böler', () => {
    const parcalar = paraUstuBoz(18775); // 187,75 ₺
    const toplam = parcalar.reduce((t, p) => t + p.birim * p.adet, 0);
    expect(toplam).toBe(18775);
  });

  it('nakit önerileri genel toplamı içerir ve artan sıralıdır', () => {
    const oneriler = nakitOnerileri(13750);
    expect(oneriler[0]).toBe(13750);
    expect([...oneriler].sort((a, b) => a - b)).toEqual(oneriler);
  });
});

describe('tlToKurus', () => {
  it('kayan nokta hatasına düşmez', () => {
    expect(tlToKurus(0.1 + 0.2)).toBe(30);
    expect(tlToKurus(19.99)).toBe(1999);
    expect(tlToKurus(1.005)).toBe(101);
  });
});
