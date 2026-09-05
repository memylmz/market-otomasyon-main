/** Veri çekme kancası — basit, bağımlılıksız (§11 dashboard cache mantığı). */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { UygulamaHatasi } from '@market/shared';
import { api } from './api';

export interface VeriDurumu<T> {
  veri: T | null;
  yukleniyor: boolean;
  hata: string | null;
  tazele: () => void;
}

export function useVeri<T>(yol: string | null, bagimliliklar: unknown[] = []): VeriDurumu<T> {
  const [veri, setVeri] = useState<T | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [sayac, setSayac] = useState(0);

  const tazele = useCallback(() => setSayac((s) => s + 1), []);

  useEffect(() => {
    if (!yol) {
      setYukleniyor(false);
      return;
    }
    let iptal = false;
    setYukleniyor(true);
    setHata(null);

    api<T>(yol)
      .then((sonuc) => {
        if (!iptal) setVeri(sonuc);
      })
      .catch((h: unknown) => {
        if (iptal) return;
        setHata(h instanceof UygulamaHatasi ? h.message : h instanceof Error ? h.message : 'Veri alınamadı.');
      })
      .finally(() => {
        if (!iptal) setYukleniyor(false);
      });

    return () => {
      iptal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yol, sayac, ...bagimliliklar]);

  return { veri, yukleniyor, hata, tazele };
}
