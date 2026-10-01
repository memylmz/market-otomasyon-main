/**
 * POS entegrasyonu açık mı — kart/iade metinleri buna göre değişir
 * ("cihaza gönderilir" ↔ "elle yapın"). Hata olursa kapalı sayılır.
 */

import { useEffect, useState } from 'react';
import { cagir } from '../kopru';

export function usePosAktif(etkin = true): boolean {
  const [aktif, setAktif] = useState(false);
  useEffect(() => {
    if (!etkin) return;
    let iptal = false;
    cagir<{ aktif: boolean }>('pos.durum')
      .then((d) => !iptal && setAktif(d.aktif))
      .catch(() => !iptal && setAktif(false));
    return () => {
      iptal = true;
    };
  }, [etkin]);
  return aktif;
}
