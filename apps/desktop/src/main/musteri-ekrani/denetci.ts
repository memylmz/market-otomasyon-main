/**
 * Müşteri ekranı denetçisinin IPC kanallarına açılan yüzü.
 *
 * Kanallar Electron'a bağımlı değildir (testlerde Electron'suz kurulur); pencere
 * yöneticisi bu arayüzle enjekte edilir. Testte ya da yönetici yokken kanallar
 * `KAPALI_DURUM` döndürür ve sepet görüntüsünü sessizce yutar.
 */

import type { MusteriEkraniDurumu, MusteriSepeti } from '@market/shared';

export interface MusteriEkraniDenetcisi {
  /** Kasadaki aktif sepetin müşteriye görünen hâli değişti. */
  sepetGuncelle(sepet: MusteriSepeti): void;
  durum(): MusteriEkraniDurumu;
}

export const KAPALI_DURUM: MusteriEkraniDurumu = {
  acik: false,
  secim: 'OTOMATIK',
  ekranlar: [],
  pencereAcik: false,
  hedefEkranId: null,
  mesaj: 'Müşteri ekranı bu ortamda kullanılamıyor.',
};
