import { describe, expect, it } from 'vitest';
import {
  faturaAlicisiAdi,
  faturaAlicisiDogrula,
  faturaAlicisiPartisi,
  kimlikTuru,
  mukellefBilgisiCoz,
  tcknGecerliMi,
  vknGecerliMi,
} from '../src/e-belge.js';

describe('kimlik numaraları', () => {
  it('TCKN algoritması', () => {
    expect(tcknGecerliMi('10000000146')).toBe(true);
    expect(tcknGecerliMi('10000000147')).toBe(false);
    expect(tcknGecerliMi('00000000146')).toBe(false);
    expect(tcknGecerliMi('1000000014')).toBe(false);
  });

  it('VKN algoritması', () => {
    expect(vknGecerliMi('1234567890')).toBe(true);
    expect(vknGecerliMi('1234567891')).toBe(false);
    expect(vknGecerliMi('123456789')).toBe(false);
  });

  it('tür boşluk/tire yok sayılarak bulunur', () => {
    expect(kimlikTuru('123 456 7890')).toBe('VKN');
    expect(kimlikTuru('100-000-001-46')).toBe('TCKN');
    expect(kimlikTuru('12345')).toBeNull();
  });
});

describe('alıcı', () => {
  const sahis = { kimlikNo: '10000000146', ad: 'Ahmet', soyad: 'Yılmaz', il: 'Muğla', ilce: 'Menteşe' };

  it('şahıs için CustomerType 1, ad/soyad; boş alanlar gönderilmez', () => {
    expect(faturaAlicisiPartisi({ ...sahis, eposta: '  ' })).toEqual({
      CustomerType: 1,
      TaxNumber: '10000000146',
      FirstName: 'Ahmet',
      FamilyName: 'Yılmaz',
      Country: 'Türkiye',
      City: 'Muğla',
      District: 'Menteşe',
    });
    expect(faturaAlicisiAdi(sahis)).toBe('Ahmet Yılmaz');
  });

  it('şirkette kod yoksa vergi dairesi adı gider', () => {
    const p = faturaAlicisiPartisi({
      kimlikNo: '1234567890',
      unvan: 'X A.Ş.',
      vergiDairesi: 'Kadıköy',
      il: 'İstanbul',
      ilce: 'Kadıköy',
    });
    expect(p).toMatchObject({ CustomerType: 2, CompanyName: 'X A.Ş.', TaxOfficeName: 'Kadıköy' });
    expect(p).not.toHaveProperty('TaxOfficeCode');
  });

  it('doğrulama eksikleri sırayla söyler', () => {
    expect(faturaAlicisiDogrula({ kimlikNo: '1234567891', il: 'a', ilce: 'b' })).toMatch(/geçersiz/);
    expect(faturaAlicisiDogrula({ kimlikNo: '1234567890', il: 'a', ilce: 'b' })).toMatch(/unvan/);
    expect(faturaAlicisiDogrula({ kimlikNo: '1234567890', unvan: 'X', il: 'a', ilce: 'b' })).toMatch(/Vergi dairesi/);
    expect(faturaAlicisiDogrula({ ...sahis, soyad: '' })).toMatch(/Ad ve soyad/);
    expect(faturaAlicisiDogrula({ ...sahis, eposta: 'yanlis' })).toMatch(/E-posta/);
    expect(faturaAlicisiDogrula(sahis)).toBeNull();
  });

  it('GİB cevabı forma çevrilir', () => {
    const a = mukellefBilgisiCoz(
      { CompanyName: 'ÖRNEK', TaxOfficeCode: '034255', City: 'İSTANBUL', District: 'KADIKÖY', EMail: '' },
      '1234567890',
    );
    expect(a).toMatchObject({ kimlikNo: '1234567890', unvan: 'ÖRNEK', vergiDairesiKodu: '034255', eposta: null });
  });
});
