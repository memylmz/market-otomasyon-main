/**
 * Kasadaki aktif sepeti müşteri ekranına aynalar.
 *
 * Uygulama kökünde bir kez çalışır (yalnız Satış sayfasında değil): kasiyer
 * satış ortasında başka ekrana geçse de müşteri sepetini görmeye devam eder.
 * Sekmeler arasında boş sepete geçilince müşteri ekranı beklemeye döner.
 *
 * Yalnız müşterinin görmesi gereken alanlar gider: cari müşteri adı ve satış
 * notu GİTMEZ (KVKK — arkadaki kişi görür).
 */

import { useEffect } from 'react';
import { sepetKazanci, sonDegisenSatir, type MusteriSepeti, type MusteriSepetSatiri } from '@market/shared';
import { sepetDurumu } from '../durum/sepet';
import { cagirGuvenli } from '../kopru';

/** Hızlı ardışık okutmalarda tek mesaj gitsin. */
const BIRIKTIRME_MS = 40;

export function musteriSepetiOlustur(oncekiSatirlar: MusteriSepetSatiri[], oncekiSon: string | null): MusteriSepeti {
  const s = sepetDurumu.getState();
  const hesap = s.hesap();
  const satirlar: MusteriSepetSatiri[] = s.satirlar.map((x, i) => ({
    anahtar: x.anahtar,
    ad: x.ozelAd || x.ad,
    miktar: x.miktar,
    birimTipi: x.birimTipi,
    birimFiyat: x.birimFiyat,
    listeFiyati: x.listeFiyati,
    tutar: hesap.satirlar[i]?.satirToplam ?? 0,
    iskonto: hesap.satirlar[i]?.iskonto ?? 0,
  }));
  return {
    satirlar,
    sonAnahtar: sonDegisenSatir(oncekiSatirlar, satirlar, oncekiSon),
    genelToplam: hesap.genelToplam,
    kazanc: sepetKazanci(satirlar),
  };
}

export function useMusteriEkraniYayini(): void {
  useEffect(() => {
    let onceki: MusteriSepeti | null = null;
    let sonGiden = '';
    let zamanlayici: ReturnType<typeof setTimeout> | null = null;

    const yayinla = () => {
      zamanlayici = null;
      const sepet = musteriSepetiOlustur(onceki?.satirlar ?? [], onceki?.sonAnahtar ?? null);
      onceki = sepet;
      // Görünen hiçbir şey değişmediyse gönderilmez (kampanya listesi yenilenmesi vb.).
      const json = JSON.stringify(sepet);
      if (json === sonGiden) return;
      sonGiden = json;
      void cagirGuvenli('musteri_ekrani.sepet', sepet);
    };
    const zamanla = () => {
      if (zamanlayici === null) zamanlayici = setTimeout(yayinla, BIRIKTIRME_MS);
    };

    yayinla();
    const birak = sepetDurumu.subscribe(zamanla);
    return () => {
      birak();
      if (zamanlayici !== null) clearTimeout(zamanlayici);
    };
  }, []);
}
