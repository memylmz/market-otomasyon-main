/**
 * Faturalı satış (e-Arşiv / e-Fatura) — Pavo üzerinden.
 *
 * Müşteri fatura isteyince kasiyer vergi no (VKN, 10 hane — şirket) ya da TC
 * kimlik no (TCKN, 11 hane — şahıs) girer; Pavo GİB'den unvan ve adresi
 * getirir (`QueryCustomerInfo`). Satış cihaza alıcı bilgisiyle (`CustomerParty`)
 * gönderilir ve belgeyi CİHAZ keser: alıcı e-Fatura mükellefiyse e-Fatura,
 * değilse e-Arşiv. Hangisinin kesileceğine program değil GİB kaydı karar verir.
 *
 * Alıcı bilgisi olmayan satış her zaman nihai tüketici fişidir (bugünkü akış).
 */

export interface FaturaAlicisi {
  /** VKN (10 hane) ya da TCKN (11 hane). */
  kimlikNo: string;
  /** Şahıs (TCKN) için ad/soyad; şirket (VKN) için unvan. */
  ad?: string | null;
  soyad?: string | null;
  unvan?: string | null;
  vergiDairesi?: string | null;
  /** GİB vergi dairesi kodu — şirkette zorunlu; yanlışsa cihaz satışı reddeder. */
  vergiDairesiKodu?: string | null;
  il: string;
  ilce: string;
  adres?: string | null;
  eposta?: string | null;
  telefon?: string | null;
}

/** TC kimlik numarası algoritması (11 hane, ilk hane 0 olamaz, iki kontrol hanesi). */
export function tcknGecerliMi(no: string): boolean {
  if (!/^[1-9]\d{10}$/.test(no)) return false;
  const d = [...no].map(Number);
  const tek = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const cift = d[1]! + d[3]! + d[5]! + d[7]!;
  const onuncu = (((tek * 7 - cift) % 10) + 10) % 10;
  if (onuncu !== d[9]) return false;
  return d.slice(0, 10).reduce((t, x) => t + x, 0) % 10 === d[10];
}

/** Vergi kimlik numarası algoritması (10 hane, son hane kontrol hanesi). */
export function vknGecerliMi(no: string): boolean {
  if (!/^\d{10}$/.test(no)) return false;
  const d = [...no].map(Number);
  let toplam = 0;
  for (let i = 0; i < 9; i++) {
    const t = (d[i]! + 9 - i) % 10;
    let v = (t * 2 ** (9 - i)) % 9;
    if (t !== 0 && v === 0) v = 9;
    toplam += v;
  }
  return (10 - (toplam % 10)) % 10 === d[9];
}

export type KimlikTuru = 'VKN' | 'TCKN';

/** Girilen numaranın türü; geçersizse null. Boşluk ve tireler yok sayılır. */
export function kimlikTuru(ham: string): KimlikTuru | null {
  const no = ham.replace(/[\s-]/g, '');
  if (no.length === 10) return vknGecerliMi(no) ? 'VKN' : null;
  if (no.length === 11) return tcknGecerliMi(no) ? 'TCKN' : null;
  return null;
}

/** Faturada görünecek alıcı adı. */
export function faturaAlicisiAdi(a: FaturaAlicisi): string {
  const sahis = [a.ad, a.soyad].filter((x) => x?.trim()).join(' ');
  return (a.unvan?.trim() || sahis || a.kimlikNo).trim();
}

/**
 * Eksik/yanlış alan için kasiyere gösterilecek cümle; sorun yoksa null.
 * Cihaza gitmeden yakalanır: GİB reddi ancak satış başladıktan sonra gelir.
 */
export function faturaAlicisiDogrula(a: FaturaAlicisi): string | null {
  const no = a.kimlikNo.replace(/[\s-]/g, '');
  const tur = kimlikTuru(no);
  if (!tur) {
    return no.length === 10 || no.length === 11
      ? 'Vergi no / TC kimlik no geçersiz (kontrol hanesi tutmuyor). Numarayı kontrol edin.'
      : 'Vergi no 10, TC kimlik no 11 hanedir.';
  }
  if (tur === 'VKN') {
    if (!a.unvan?.trim()) return 'Şirket unvanı yazılmalı.';
    if (!a.vergiDairesiKodu?.trim() && !a.vergiDairesi?.trim()) return 'Vergi dairesi yazılmalı.';
  } else if (!a.ad?.trim() || !a.soyad?.trim()) {
    return 'Ad ve soyad yazılmalı.';
  }
  if (!a.il.trim() || !a.ilce.trim()) return 'İl ve ilçe yazılmalı.';
  if (a.eposta?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.eposta.trim())) return 'E-posta adresi geçersiz.';
  return null;
}

/** Pavo `CustomerParty` gövdesi (Pavo 507 dokümanı, modeller/customerparty). */
export function faturaAlicisiPartisi(a: FaturaAlicisi): Record<string, unknown> {
  const no = a.kimlikNo.replace(/[\s-]/g, '');
  const sirket = kimlikTuru(no) === 'VKN';
  const bos = (x: string | null | undefined) => (x?.trim() ? x.trim() : undefined);
  const govde: Record<string, unknown> = {
    CustomerType: sirket ? 2 : 1,
    TaxNumber: no,
    Country: 'Türkiye',
    City: a.il.trim(),
    District: a.ilce.trim(),
    Address: bos(a.adres),
    EMail: bos(a.eposta),
    Phone: bos(a.telefon),
  };
  if (sirket) {
    govde.CompanyName = a.unvan?.trim();
    // Kod varsa kod gider (cihaz doğrular); yoksa ad (doğrulanmaz).
    if (bos(a.vergiDairesiKodu)) govde.TaxOfficeCode = bos(a.vergiDairesiKodu);
    else govde.TaxOfficeName = bos(a.vergiDairesi);
  } else {
    govde.FirstName = a.ad?.trim();
    govde.FamilyName = a.soyad?.trim();
    if (bos(a.vergiDairesiKodu)) govde.TaxOfficeCode = bos(a.vergiDairesiKodu);
    else if (bos(a.vergiDairesi)) govde.TaxOfficeName = bos(a.vergiDairesi);
  }
  for (const k of Object.keys(govde)) if (govde[k] === undefined) delete govde[k];
  return govde;
}

/** Pavo `QueryCustomerInfo` cevabındaki `CustomerInfo` → form alanları. */
export function mukellefBilgisiCoz(bilgi: Record<string, unknown>, kimlikNo: string): FaturaAlicisi {
  const m = (k: string) => (typeof bilgi[k] === 'string' ? (bilgi[k] as string).trim() : '');
  return {
    kimlikNo: m('TaxNumber') || kimlikNo,
    ad: m('FirstName') || null,
    soyad: m('FamilyName') || null,
    unvan: m('CompanyName') || null,
    vergiDairesi: m('TaxOfficeName') || null,
    vergiDairesiKodu: m('TaxOfficeCode') || null,
    il: m('City'),
    ilce: m('District'),
    adres: m('Address') || null,
    eposta: m('EMail') || null,
    telefon: m('Phone') || null,
  };
}
