/**
 * Fiş ve rapor çıktısı düzeni (§10.3, §10.8).
 *
 * ⚠️ YASAL UYARI (§17.1): Bu fiş bir **satış özeti / adisyon**dur, mali belge
 * değildir. Nihai tüketiciye kesilecek yasal belge GİB onaylı ÖKC'den (yazarkasa)
 * düzenlenir. Bu uyarı fişin altına basılır ve ayarlardan kaldırılamaz.
 */

import { fisNoSadelestir, miktarFormat, paraFormat, tarihSaatFormat, type BirimTipi, type Kurus } from '@market/shared';
import type { KasaOzeti } from '../depo/kasa.js';
import type { OdemeKaydi, SatisDetayi } from '../depo/satis.js';
import { EscPosYazici } from './escpos.js';

export const YASAL_UYARI = 'Bu belge mali değeri olmayan satış özetidir.';

export interface IsletmeBilgisi {
  ad: string;
  adres?: string | null;
  telefon?: string | null;
  vergiNo?: string | null;
  altMetin?: string | null;
}

const ODEME_ETIKETI: Record<OdemeKaydi['odeme_tipi'], string> = {
  NAKIT: 'Nakit',
  KART: 'Kart',
  VERESIYE: 'Veresiye',
};

/** Satış fişi. */
export function satisFisi(
  detay: SatisDetayi,
  isletme: IsletmeBilgisi,
  secenekler: { satirGenisligi?: number; kopyaMi?: boolean; kasiyerAdi?: string | null } = {},
): Buffer {
  const genislik = secenekler.satirGenisligi ?? 48;
  const y = new EscPosYazici(genislik).baslat();
  const { satis, kalemler, odemeler } = detay;
  const iadeMi = satis.iade_mi;

  y.hizala('orta').boyut(2).kalin(true).satir(isletme.ad).kalin(false).boyut(1);
  if (isletme.adres) y.satir(isletme.adres);
  if (isletme.telefon) y.satir('Tel: ' + isletme.telefon);
  if (isletme.vergiNo) y.satir('VN: ' + isletme.vergiNo);

  y.ayirici('=');
  if (iadeMi) y.kalin(true).boyut(2).satir('İADE FİŞİ').boyut(1).kalin(false);
  if (secenekler.kopyaMi) y.satir('*** KOPYA ***');

  y.hizala('sol');
  y.ikiSutun('Fiş No: ' + satis.fis_no, tarihSaatFormat(satis.tarih));
  if (secenekler.kasiyerAdi) y.satir('Kasiyer: ' + secenekler.kasiyerAdi);
  if (satis.musteri_adi) y.satir('Müşteri: ' + satis.musteri_adi);
  y.ayirici();

  for (const kalem of kalemler) {
    const miktar = Math.abs(kalem.miktar);
    const tutar = Math.abs(kalem.satir_toplam);
    y.satir(kalem.urun_adi);
    const solTaraf = `  ${miktarFormat(miktar, kalem.birim_tipi as BirimTipi)} x ${paraFormat(kalem.birim_fiyat, { simge: false })}`;
    y.ikiSutun(solTaraf, paraFormat(tutar, { simge: false }));
    if (kalem.iskonto !== 0) {
      y.ikiSutun('  İskonto', '-' + paraFormat(Math.abs(kalem.iskonto), { simge: false }));
    }
  }

  y.ayirici();
  const mutlak = (deger: Kurus) => paraFormat(Math.abs(deger), { simge: false });
  if (satis.iskonto_toplam !== 0) {
    y.ikiSutun('Ara Toplam', mutlak(satis.ara_toplam));
    y.ikiSutun('İskonto', '-' + mutlak(satis.iskonto_toplam));
  }

  y.kalin(true)
    .boyut(2)
    .ikiSutun(iadeMi ? 'İADE' : 'TOPLAM', mutlak(satis.genel_toplam))
    .boyut(1)
    .kalin(false);

  // KDV kırılımı (§10.3) — oranlara göre gruplanır.
  const kdvDilimleri = new Map<number, { matrah: number; kdv: number }>();
  for (const kalem of kalemler) {
    const mevcut = kdvDilimleri.get(kalem.kdv_orani) ?? { matrah: 0, kdv: 0 };
    mevcut.kdv += Math.abs(kalem.kdv_tutar);
    mevcut.matrah += Math.abs(kalem.satir_toplam) - Math.abs(kalem.kdv_tutar);
    kdvDilimleri.set(kalem.kdv_orani, mevcut);
  }
  y.ayirici();
  for (const [oran, dilim] of [...kdvDilimleri.entries()].sort((a, b) => a[0] - b[0])) {
    y.ikiSutun(`KDV %${oran} (matrah ${paraFormat(dilim.matrah, { simge: false })})`, paraFormat(dilim.kdv, { simge: false }));
  }

  y.ayirici();
  for (const odeme of odemeler) {
    y.ikiSutun(ODEME_ETIKETI[odeme.odeme_tipi], mutlak(odeme.tutar));
    if (odeme.odeme_tipi === 'NAKIT' && odeme.para_ustu > 0) {
      y.ikiSutun('  Alınan', paraFormat(odeme.alinan, { simge: false }));
      y.ikiSutun('  Para Üstü', paraFormat(odeme.para_ustu, { simge: false }));
    }
  }

  y.ayirici('=');
  y.hizala('orta');
  if (isletme.altMetin) y.satir(isletme.altMetin);
  // Yasal uyarı kaldırılamaz (§17.1).
  y.satir(YASAL_UYARI);
  y.satir('Yasal fiş yazarkasadan alınmalıdır.');
  // Barkoda TİRE BASILMAZ. HID okuyucular karakter değil tuş kodu gönderir;
  // Türkçe Q klavyede ABD düzenindeki `-` tuşunun yerinde `*` olduğu için
  // "A-000512" fişi "A*000512" olarak okunur. Yalnız harf+rakam basıldığında
  // bu fark hiç oluşmaz. Arama tarafı da ayraçları yok sayar (fisNoSadelestir).
  y.bosluk(1).barkod(fisNoSadelestir(satis.fis_no), 'CODE128', 50);
  y.kes();
  return y.bitir();
}

/** Gün sonu / vardiya raporu (Z benzeri özet) — §10.8. */
export function gunSonuFisi(
  ozet: KasaOzeti,
  bilgi: {
    isletme: IsletmeBilgisi;
    kasiyerAdi: string;
    acilis: string;
    kapanis: string;
    sayilanNakit: Kurus;
    beklenenNakit: Kurus;
    kasaFarki: Kurus;
  },
  satirGenisligi = 48,
): Buffer {
  const y = new EscPosYazici(satirGenisligi).baslat();
  const p = (deger: Kurus) => paraFormat(deger, { simge: false });

  y.hizala('orta').boyut(2).kalin(true).satir('GÜN SONU RAPORU').kalin(false).boyut(1);
  y.satir(bilgi.isletme.ad).ayirici('=').hizala('sol');
  y.satir('Kasiyer: ' + bilgi.kasiyerAdi);
  y.satir('Açılış : ' + tarihSaatFormat(bilgi.acilis));
  y.satir('Kapanış: ' + tarihSaatFormat(bilgi.kapanis));
  y.ayirici();

  y.ikiSutun('Açılış bakiyesi', p(ozet.acilis_bakiye));
  y.ikiSutun('Nakit satış', p(ozet.satis_nakit));
  y.ikiSutun('Kart satış', p(ozet.satis_kart));
  y.ikiSutun('Veresiye satış', p(ozet.veresiye));
  y.ikiSutun('Tahsilat', p(ozet.tahsilat));
  y.ikiSutun('Tedarikçi ödemesi', p(ozet.odeme));
  y.ikiSutun('Gider', p(ozet.gider));
  y.ikiSutun('Kasaya giriş', p(ozet.giris));
  y.ikiSutun('Kasadan çıkış', p(ozet.cikis));
  y.ikiSutun('Nakit iade', p(ozet.iade_nakit));
  y.ayirici();
  y.ikiSutun('İşlem sayısı', String(ozet.islem_sayisi));
  y.ayirici();

  y.kalin(true);
  y.ikiSutun('Beklenen nakit', p(bilgi.beklenenNakit));
  y.ikiSutun('Sayılan nakit', p(bilgi.sayilanNakit));
  y.boyut(2).ikiSutun('KASA FARKI', p(bilgi.kasaFarki)).boyut(1);
  y.kalin(false);

  if (bilgi.kasaFarki !== 0) {
    y.satir(bilgi.kasaFarki > 0 ? '(Kasada fazla var)' : '(Kasada eksik var)');
  }

  y.ayirici('=').hizala('orta').satir(YASAL_UYARI).kes();
  return y.bitir();
}

/** Ürün etiketi (raf/barkod) — §10.5. */
/*
 * `urunEtiketi` KALDIRILDI (§13.3).
 *
 * Raf etiketini ESC/POS ile FİŞ yazıcısına basıyordu: 80 mm termal kağıda,
 * sonunda kağıt kesme komutuyla. Ortaya rafa yapıştırılamayan bir fiş
 * çıkıyordu. Etiket artık `donanim/etiket.ts` içinde TSPL/ZPL ile üretilir ve
 * ayrı tanımlanan etiket yazıcısına gider. Burada bırakılsaydı yanlışlıkla
 * yeniden kullanılabilirdi.
 */

/** Cari hesap ekstresi (§10.7 "ekstre yazdır"). */
export function cariEkstreFisi(
  cari: { ad_unvan: string; telefon?: string | null; bakiye: Kurus },
  hareketler: { tarih: string; aciklama: string | null; tutar: Kurus; yuruyen_bakiye: Kurus }[],
  isletme: IsletmeBilgisi,
  satirGenisligi = 48,
): Buffer {
  const y = new EscPosYazici(satirGenisligi).baslat();
  y.hizala('orta').kalin(true).satir(isletme.ad).kalin(false).satir('HESAP EKSTRESİ').ayirici('=').hizala('sol');
  y.satir('Cari: ' + cari.ad_unvan);
  if (cari.telefon) y.satir('Tel : ' + cari.telefon);
  y.ayirici();

  for (const hareket of hareketler.slice(-60)) {
    y.satir(tarihSaatFormat(hareket.tarih) + ' ' + (hareket.aciklama ?? '').slice(0, satirGenisligi - 18));
    y.ikiSutun(
      '   ' + paraFormat(hareket.tutar, { simge: false, isaret: true }),
      paraFormat(hareket.yuruyen_bakiye, { simge: false }),
    );
  }

  y.ayirici();
  y.kalin(true)
    .boyut(2)
    .ikiSutun('BAKİYE', paraFormat(cari.bakiye, { simge: false }))
    .boyut(1)
    .kalin(false);
  y.satir(cari.bakiye > 0 ? '(Borç)' : cari.bakiye < 0 ? '(Alacak)' : '(Kapalı)');
  y.ayirici('=').hizala('orta').satir(YASAL_UYARI).kes();
  return y.bitir();
}
