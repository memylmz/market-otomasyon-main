import { describe, expect, it } from 'vitest';
import { aramaNormalize, turkceSiralamaAnahtari } from '@market/shared';

describe('turkceSiralamaAnahtari — Türkçe alfabetik sıralama', () => {
  const sirala = (adlar: string[]) => [...adlar].sort((a, b) => (turkceSiralamaAnahtari(a) < turkceSiralamaAnahtari(b) ? -1 : 1));

  it('Türk alfabesi sırasını verir (ç, ğ, ı, i, ö, ş, ü doğru yerde)', () => {
    expect(sirala(['çay', 'cam', 'dere'])).toEqual(['cam', 'çay', 'dere']);
    expect(sirala(['ırmak', 'iğde', 'hurma', 'jilet'])).toEqual(['hurma', 'ırmak', 'iğde', 'jilet']);
    expect(sirala(['ödev', 'orman', 'para'])).toEqual(['orman', 'ödev', 'para']);
    expect(sirala(['ütü', 'uzay', 'vazo'])).toEqual(['uzay', 'ütü', 'vazo']);
    expect(sirala(['şeker', 'salca', 'tuz'])).toEqual(['salca', 'şeker', 'tuz']);
    expect(sirala(['gül', 'gaz', 'ğ-test', 'hal'])).toEqual(['gaz', 'gül', 'ğ-test', 'hal']);
  });

  it('büyük/küçük harfe duyarsızdır (İ→i, I→ı dahil)', () => {
    expect(turkceSiralamaAnahtari('ÇAY')).toBe(turkceSiralamaAnahtari('çay'));
    expect(turkceSiralamaAnahtari('İncir')).toBe(turkceSiralamaAnahtari('incir'));
    expect(turkceSiralamaAnahtari('IRMAK')).toBe(turkceSiralamaAnahtari('ırmak'));
    expect(sirala(['zeytin', 'Elma', 'ÇİLEK', 'armut'])).toEqual(['armut', 'ÇİLEK', 'Elma', 'zeytin']);
  });

  it('market rafı gibi karışık bir listeyi doğru sıralar', () => {
    expect(sirala(['Çilek', 'zencefil', 'armut', 'İncir', 'Şeker', 'ırmak', 'elma', 'Üzüm', 'iğde'])).toEqual([
      'armut',
      'Çilek',
      'elma',
      'ırmak',
      'iğde',
      'İncir',
      'Şeker',
      'Üzüm',
      'zencefil',
    ]);
  });

  it('rakamlar harflerden önce gelir, şapkalı harfler eşlenir', () => {
    expect(sirala(['elma', '3A Kola'])).toEqual(['3A Kola', 'elma']);
    expect(turkceSiralamaAnahtari('kâğıt')).toBe(turkceSiralamaAnahtari('kağıt'));
  });

  it('aramaNormalize ile çelişmez (ikisi de İ/ı ayrımını yönetir)', () => {
    expect(aramaNormalize('İÇECEK')).toBe('icecek');
    expect(turkceSiralamaAnahtari('İçecek')).toBe(turkceSiralamaAnahtari('içecek'));
  });
});
