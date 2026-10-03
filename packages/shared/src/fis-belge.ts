/**
 * Fiş BELGESİ — yazdırmadan önceki yapılandırılmış model (§13.2).
 *
 * NEDEN VAR: fiş uzun süre doğrudan ESC/POS baytı olarak üretildi; ürün adı,
 * miktar, birim fiyat ve tutar tek bir dizgede boşlukla hizalanıp eriyordu.
 * Fiş görüntü olarak basılmaya başlayınca bu bir engele dönüştü: sütunlu bir
 * yerleşim, hizalı rakamlar ya da ürün adının altında gri bir ayrıntı satırı
 * çizebilmek için bu alanların AYRI AYRI durması gerekir. Metinden geri
 * çıkarım yapmak (boşluk sayarak sütun bulmak) kırılgandır — uzun bir ürün
 * adı ya da eksi tutar düzeni bozar.
 *
 * Belge, çizicilerden bağımsızdır: sayılar burada METNE çevrilir (para ve
 * miktar biçimlendirmesi tek yerde kalsın diye), yerleşim kararı çiziciye
 * bırakılır.
 */

import { IADE_YONTEMI_ETIKETI, type IadeYontemi } from './iade.js';
import { miktarFormat } from './miktar.js';
import { paraFormat, type Kurus } from './para.js';
import type { BirimTipi } from './sabitler.js';
import { tarihFormat, tarihSaatFormat } from './tarih.js';

/** Fişin altındaki yasal uyarının varsayılanı — ayar boşsa bu basılır (§17.1). */
export const VARSAYILAN_YASAL_UYARI = 'BİLGİ FİŞİDİR - MALİ DEĞERİ YOKTUR';

/** Fişin başındaki işletme bilgisi. */
export interface FisIsletmeBilgisi {
  ad: string;
  adres?: string | null;
  telefon?: string | null;
  vergiNo?: string | null;
  altMetin?: string | null;
}

/**
 * Fişin çizilmesi için gereken satış verisi. Kasanın yerel kaydı da bulutun
 * satış detayı da bu şekle uyar; kasa ve panel AYNI fişi gösterir.
 */
export interface FisSatisVerisi {
  satis: {
    fis_no: string;
    tarih: string;
    musteri_adi?: string | null;
    iade_mi?: boolean | number | null;
    kaynak_fis_no?: string | null;
    notlar?: string | null;
    ara_toplam: number;
    iskonto_toplam: number;
    genel_toplam: number;
  };
  kalemler: {
    urun_adi: string;
    miktar: number;
    birim_tipi: string;
    birim_fiyat: number;
    iskonto: number;
    kdv_orani: number;
    kdv_tutar: number;
    satir_toplam: number;
  }[];
  odemeler: {
    odeme_tipi: string;
    tutar: number;
    alinan: number;
    para_ustu: number;
    pos_kart?: string | null;
    pos_onay_kodu?: string | null;
  }[];
}

export interface FisKalemi {
  ad: string;
  /** "2 ad" ya da "1,25 kg" — miktar ve birim birlikte. */
  miktarMetni: string;
  birimFiyatMetni: string;
  tutarMetni: string;
  /** Kaleme uygulanan iskonto; yoksa null. */
  iskontoMetni: string | null;
}

export interface FisSatiri {
  etiket: string;
  deger: string;
}

export interface FisBelgesi {
  isletmeAdi: string;
  /** Adres, telefon, vergi no — sırayla, boş olanlar atılmış. */
  isletmeSatirlari: string[];
  /** "İADE FİŞİ" gibi bir üst başlık; normal satışta null. */
  baslik: string | null;
  /** "KOPYA" damgası; yoksa null. */
  damga: string | null;
  meta: FisSatiri[];
  kalemler: FisKalemi[];
  /** Toplamdan ÖNCE gelen satırlar: ara toplam, iskonto, KDV kırılımı. */
  araSatirlar: FisSatiri[];
  toplam: FisSatiri;
  odemeler: FisSatiri[];
  altMetin: string | null;
  yasalUyari: string;
  yasalAlt: string | null;
  barkod: string | null;
}

const ODEME_ETIKETI: Record<string, string> = { NAKIT: 'Nakit', KART: 'Kart', VERESIYE: 'Veresiye' };

/** Mutlak değerin para biçimi — iade fişinde tutarlar eksi tutulur, kağıda artı basılır. */
function tutar(kurus: number): string {
  return paraFormat(Math.abs(kurus), { simge: false });
}

/**
 * KDV'yi oranlara göre gruplar (§10.3).
 *
 * Hem metin hem görüntü fişi aynı kırılımı göstermek zorunda; hesap burada tek
 * yerde durur.
 */
export function kdvKirilimi(kalemler: FisSatisVerisi['kalemler']): { oran: number; matrah: number; kdv: number }[] {
  const dilimler = new Map<number, { matrah: number; kdv: number }>();
  for (const kalem of kalemler) {
    const mevcut = dilimler.get(kalem.kdv_orani) ?? { matrah: 0, kdv: 0 };
    mevcut.kdv += Math.abs(kalem.kdv_tutar);
    mevcut.matrah += Math.abs(kalem.satir_toplam) - Math.abs(kalem.kdv_tutar);
    dilimler.set(kalem.kdv_orani, mevcut);
  }
  return [...dilimler.entries()].sort((a, b) => a[0] - b[0]).map(([oran, d]) => ({ oran, ...d }));
}

export function satisBelgesi(
  detay: FisSatisVerisi,
  isletme: FisIsletmeBilgisi,
  secenekler: { kopyaMi?: boolean; kasiyerAdi?: string | null; yasalUyari: string },
): FisBelgesi {
  const { satis, kalemler, odemeler } = detay;
  const iadeMi = satis.iade_mi;

  const meta: FisSatiri[] = [
    { etiket: 'FİŞ NO', deger: satis.fis_no },
    { etiket: 'TARİH', deger: tarihSaatFormat(satis.tarih) },
  ];
  if (secenekler.kasiyerAdi) meta.push({ etiket: 'KASİYER', deger: secenekler.kasiyerAdi });
  if (satis.musteri_adi) meta.push({ etiket: 'MÜŞTERİ', deger: satis.musteri_adi });
  // İade fişi kendi başına okunabilmeli: hangi alışverişin iadesi, neden.
  if (iadeMi && satis.kaynak_fis_no) meta.push({ etiket: 'İADE EDİLEN FİŞ', deger: satis.kaynak_fis_no });
  if (iadeMi && satis.notlar && satis.notlar !== 'Belirtilmedi') meta.push({ etiket: 'NEDEN', deger: satis.notlar });

  const araSatirlar: FisSatiri[] = [];
  if (satis.iskonto_toplam > 0) {
    araSatirlar.push({ etiket: 'Ara toplam', deger: tutar(satis.ara_toplam) });
    araSatirlar.push({ etiket: 'İskonto', deger: '-' + tutar(satis.iskonto_toplam) });
  }
  for (const dilim of kdvKirilimi(kalemler)) {
    araSatirlar.push({
      etiket: `KDV %${dilim.oran} (matrah ${paraFormat(dilim.matrah, { simge: false })})`,
      deger: tutar(dilim.kdv),
    });
  }

  const odemeSatirlari: FisSatiri[] = [];
  for (const odeme of odemeler) {
    // İadede para müşteriye DÖNER: "Veresiye" değil "Cari hesaba alacak" yazmalı.
    const etiket = iadeMi
      ? (IADE_YONTEMI_ETIKETI[odeme.odeme_tipi as IadeYontemi] ?? odeme.odeme_tipi)
      : (ODEME_ETIKETI[odeme.odeme_tipi] ?? odeme.odeme_tipi);
    odemeSatirlari.push({ etiket, deger: tutar(odeme.tutar) });
    // POS çekiminin kanıtı fişte durur: müşteri itirazında hangi kart, hangi onay.
    if (odeme.pos_kart || odeme.pos_onay_kodu) {
      odemeSatirlari.push({
        etiket: `  ${[odeme.pos_kart, odeme.pos_onay_kodu ? `Onay ${odeme.pos_onay_kodu}` : null].filter(Boolean).join(' · ')}`,
        deger: '',
      });
    }
    if (odeme.odeme_tipi === 'NAKIT' && odeme.para_ustu > 0) {
      odemeSatirlari.push({ etiket: 'Alınan', deger: tutar(odeme.alinan) });
      odemeSatirlari.push({ etiket: 'Para üstü', deger: tutar(odeme.para_ustu) });
    }
  }

  return {
    isletmeAdi: isletme.ad,
    isletmeSatirlari: [
      isletme.adres,
      isletme.telefon ? 'Tel ' + isletme.telefon : null,
      isletme.vergiNo ? 'VN ' + isletme.vergiNo : null,
    ].filter((s): s is string => Boolean(s)),
    baslik: iadeMi ? 'İADE FİŞİ' : null,
    damga: secenekler.kopyaMi ? 'KOPYA' : null,
    meta,
    kalemler: kalemler.map((kalem) => ({
      ad: kalem.urun_adi,
      miktarMetni: miktarFormat(Math.abs(kalem.miktar), kalem.birim_tipi as BirimTipi),
      birimFiyatMetni: paraFormat(kalem.birim_fiyat, { simge: false }),
      tutarMetni: tutar(kalem.satir_toplam),
      iskontoMetni: kalem.iskonto > 0 ? '-' + tutar(kalem.iskonto) : null,
    })),
    araSatirlar,
    toplam: { etiket: iadeMi ? 'İADE' : 'TOPLAM', deger: tutar(satis.genel_toplam) },
    odemeler: odemeSatirlari,
    altMetin: isletme.altMetin ?? null,
    yasalUyari: secenekler.yasalUyari,
    yasalAlt: 'Yasal fiş yazarkasadan alınmalıdır',
    // Barkoda TİRE BASILMAZ: HID okuyucular tuş kodu gönderir, Türkçe Q
    // klavyede `-` yerine `*` okunur.
    barkod: satis.fis_no.replace(/[^0-9A-Za-z]/g, ''),
  };
}

// ---------------------------------------------------------------------------
// Cari hesap ekstresi
// ---------------------------------------------------------------------------

export interface EkstreHareketi {
  tarihMetni: string;
  aciklama: string;
  tutarMetni: string;
  /** Borç mu (artı) alacak mı (eksi) — çizici renk/işaret kararını buna göre verir. */
  borcMu: boolean;
  bakiyeMetni: string;
}

export interface EkstreBelgesi {
  isletmeAdi: string;
  baslik: string;
  meta: FisSatiri[];
  hareketler: EkstreHareketi[];
  /** Dönem özeti: açılış, toplam borç, toplam tahsilat. */
  ozet: FisSatiri[];
  bakiye: FisSatiri;
  /** Bakiyenin NE ANLAMA GELDİĞİ — düz Türkçe cümle. */
  bakiyeAciklamasi: string;
  yasalUyari: string;
}

/**
 * Ekstre belgesi (§10.7).
 *
 * "DAHA AÇIKLAYICI" OLMASI İSTENDİ: eski ekstre bakiyenin altına yalnız
 * "(Borç)" yazıyordu. Bir cari bakiyenin işareti kime borçlu olunduğunu
 * söylemez — müşteri de işletme sahibi de her seferinde düşünmek zorunda
 * kalıyordu. Artık düz cümleyle yazılır ve dönem özeti (açılış bakiyesi,
 * toplam borç, toplam tahsilat) eklenir; rakamın nereden geldiği görünür.
 */
export function ekstreBelgesi(
  cari: { ad_unvan: string; telefon?: string | null; bakiye: Kurus },
  hareketler: { tarih: string; aciklama: string | null; tutar: Kurus; yuruyen_bakiye: Kurus }[],
  isletme: FisIsletmeBilgisi,
  secenekler: { yasalUyari: string; baslangic?: string | null; bitis?: string | null },
): EkstreBelgesi {
  // Ekstre uzunsa son 60 hareket basılır; kağıt metrelerce akmasın.
  const gosterilen = hareketler.slice(-60);

  const meta: FisSatiri[] = [{ etiket: 'CARİ', deger: cari.ad_unvan }];
  if (cari.telefon) meta.push({ etiket: 'TELEFON', deger: cari.telefon });
  if (secenekler.baslangic || secenekler.bitis) {
    const bas = secenekler.baslangic ? tarihFormat(secenekler.baslangic) : '…';
    const bit = secenekler.bitis ? tarihFormat(secenekler.bitis) : '…';
    meta.push({ etiket: 'DÖNEM', deger: `${bas} - ${bit}` });
  }
  meta.push({ etiket: 'DÜZENLEME', deger: tarihSaatFormat(new Date().toISOString()) });

  /*
   * Açılış bakiyesi hareketlerden GERİ HESAPLANIR: ilk hareketin yürüyen
   * bakiyesinden kendi tutarı düşülür. Ayrı bir sorgu açmak yerine elimizdeki
   * veriden çıkarmak, ekstrenin her zaman kendi içinde tutarlı olmasını
   * sağlar — gösterilen satırların toplamı gösterilen bakiyeyi verir.
   */
  const ilk = gosterilen[0];
  const acilis = ilk ? ilk.yuruyen_bakiye - ilk.tutar : cari.bakiye;
  const toplamBorc = gosterilen.filter((h) => h.tutar > 0).reduce((t, h) => t + h.tutar, 0);
  const toplamAlacak = gosterilen.filter((h) => h.tutar < 0).reduce((t, h) => t + Math.abs(h.tutar), 0);

  const bakiyeAciklamasi =
    cari.bakiye > 0
      ? `${cari.ad_unvan} işletmeye ${paraFormat(cari.bakiye, { simge: false })} TL borçludur.`
      : cari.bakiye < 0
        ? `İşletme ${cari.ad_unvan} kişisine ${paraFormat(Math.abs(cari.bakiye), { simge: false })} TL borçludur.`
        : 'Hesap kapalıdır; karşılıklı borç bulunmamaktadır.';

  return {
    isletmeAdi: isletme.ad,
    baslik: 'HESAP EKSTRESİ',
    meta,
    hareketler: gosterilen.map((h) => ({
      tarihMetni: tarihFormat(h.tarih),
      aciklama: h.aciklama ?? '-',
      tutarMetni: paraFormat(Math.abs(h.tutar), { simge: false }),
      borcMu: h.tutar >= 0,
      bakiyeMetni: paraFormat(h.yuruyen_bakiye, { simge: false }),
    })),
    ozet: [
      { etiket: 'Dönem başı bakiye', deger: paraFormat(acilis, { simge: false }) },
      { etiket: 'Toplam borç', deger: paraFormat(toplamBorc, { simge: false }) },
      { etiket: 'Toplam tahsilat', deger: paraFormat(toplamAlacak, { simge: false }) },
    ],
    bakiye: { etiket: 'BAKİYE', deger: paraFormat(Math.abs(cari.bakiye), { simge: false }) },
    bakiyeAciklamasi,
    yasalUyari: secenekler.yasalUyari,
  };
}

// ---------------------------------------------------------------------------
// Gün sonu raporu
// ---------------------------------------------------------------------------

export interface GunSonuGrubu {
  baslik: string;
  satirlar: FisSatiri[];
  /** Grubun kendi toplamı; anlamlı olmayan grupta null. */
  toplam: FisSatiri | null;
}

export interface GunSonuBelgesi {
  isletmeAdi: string;
  baslik: string;
  meta: FisSatiri[];
  gruplar: GunSonuGrubu[];
  islemSayisi: FisSatiri;
  /** Nakit mutabakatı: beklenen ve sayılan. */
  sayim: FisSatiri[];
  fark: FisSatiri;
  /** Farkın NE ANLAMA GELDİĞİ — düz Türkçe cümle. */
  farkAciklamasi: string;
  yasalUyari: string;
}

/**
 * Gün sonu raporu belgesi (§10.8).
 *
 * GRUPLANDIRILDI: eski rapor on kalemi düz bir liste hâlinde sıralıyordu —
 * satış kalemleriyle kasa hareketleri aynı blokta, aralarında ayrım yok.
 * Kasiyerin "bugün ne sattım" ile "kasaya ne girdi çıktı" sorularını ayırması
 * için satır satır okuması gerekiyordu. Artık iki grup var ve satış grubunun
 * kendi toplamı yazılıyor; bu toplam eski raporda hiç yoktu, kafadan
 * toplanıyordu.
 */
export function gunSonuBelgesi(
  ozet: {
    acilis_bakiye: Kurus;
    satis_nakit: Kurus;
    satis_kart: Kurus;
    veresiye: Kurus;
    tahsilat: Kurus;
    odeme: Kurus;
    gider: Kurus;
    giris: Kurus;
    cikis: Kurus;
    iade_nakit: Kurus;
    islem_sayisi: number;
  },
  bilgi: {
    isletme: FisIsletmeBilgisi;
    kasiyerAdi: string;
    acilis: string;
    kapanis: string;
    sayilanNakit: Kurus;
    beklenenNakit: Kurus;
    kasaFarki: Kurus;
  },
  yasalUyari: string,
): GunSonuBelgesi {
  const p = (deger: Kurus) => paraFormat(deger, { simge: false });
  const satisToplami = ozet.satis_nakit + ozet.satis_kart + ozet.veresiye;

  const farkAciklamasi =
    bilgi.kasaFarki > 0
      ? `Kasada ${p(bilgi.kasaFarki)} TL FAZLA var.`
      : bilgi.kasaFarki < 0
        ? `Kasada ${p(Math.abs(bilgi.kasaFarki))} TL EKSİK var.`
        : 'Kasa tam tutuyor; fark yok.';

  return {
    isletmeAdi: bilgi.isletme.ad,
    baslik: 'GÜN SONU RAPORU',
    meta: [
      { etiket: 'KASİYER', deger: bilgi.kasiyerAdi },
      { etiket: 'AÇILIŞ', deger: tarihSaatFormat(bilgi.acilis) },
      { etiket: 'KAPANIŞ', deger: tarihSaatFormat(bilgi.kapanis) },
    ],
    gruplar: [
      {
        baslik: 'SATIŞLAR',
        satirlar: [
          { etiket: 'Nakit satış', deger: p(ozet.satis_nakit) },
          { etiket: 'Kart satış', deger: p(ozet.satis_kart) },
          { etiket: 'Veresiye satış', deger: p(ozet.veresiye) },
        ],
        toplam: { etiket: 'Toplam satış', deger: p(satisToplami) },
      },
      {
        baslik: 'KASA HAREKETLERİ',
        satirlar: [
          { etiket: 'Açılış bakiyesi', deger: p(ozet.acilis_bakiye) },
          { etiket: 'Tahsilat', deger: p(ozet.tahsilat) },
          { etiket: 'Tedarikçi ödemesi', deger: p(ozet.odeme) },
          { etiket: 'Gider', deger: p(ozet.gider) },
          { etiket: 'Kasaya giriş', deger: p(ozet.giris) },
          { etiket: 'Kasadan çıkış', deger: p(ozet.cikis) },
          { etiket: 'Nakit iade', deger: p(ozet.iade_nakit) },
        ],
        toplam: null,
      },
    ],
    islemSayisi: { etiket: 'İşlem sayısı', deger: String(ozet.islem_sayisi) },
    sayim: [
      { etiket: 'Beklenen nakit', deger: p(bilgi.beklenenNakit) },
      { etiket: 'Sayılan nakit', deger: p(bilgi.sayilanNakit) },
    ],
    fark: { etiket: 'KASA FARKI', deger: p(Math.abs(bilgi.kasaFarki)) },
    farkAciklamasi,
    yasalUyari,
  };
}
