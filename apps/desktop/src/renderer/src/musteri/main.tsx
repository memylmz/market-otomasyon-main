/**
 * Müşteri penceresinin girişi.
 *
 * Ana süreçten üç tür mesaj gelir (yapılandırma, sepet, satış tamamlandı);
 * ekranın hangi hâlde olduğuna paylaşılan durum makinesi karar verir.
 * Pencere hiçbir ana süreç kanalını çağıramaz — yalnız dinler.
 */

import { StrictMode, useEffect, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BASLANGIC_EKRAN_DURUMU,
  ekranDurumuIlerle,
  type MusteriEkraniMesaji,
  type MusteriEkraniYapilandirmasi,
} from '@market/shared';
import { MusteriEkraniGorunumu } from './MusteriEkrani';
import '../stil.css';

interface MusteriKopru {
  dinle(geriCagri: (mesaj: unknown) => void): () => void;
  hazir(): void;
}

declare global {
  interface Window {
    musteriEkrani?: MusteriKopru;
  }
}

function MusteriPenceresi() {
  const [yapilandirma, setYapilandirma] = useState<MusteriEkraniYapilandirmasi | null>(null);
  const [durum, ilerle] = useReducer(ekranDurumuIlerle, BASLANGIC_EKRAN_DURUMU);
  const tesekkurMs = useRef(6_000);

  useEffect(() => {
    const kopru = window.musteriEkrani;
    if (!kopru) return;
    const birak = kopru.dinle((ham) => {
      const mesaj = ham as MusteriEkraniMesaji;
      if (mesaj.tur === 'YAPILANDIRMA') {
        tesekkurMs.current = mesaj.yapilandirma.tesekkurMs;
        setYapilandirma(mesaj.yapilandirma);
      } else if (mesaj.tur === 'SEPET') {
        ilerle({ tur: 'SEPET', sepet: mesaj.sepet });
      } else if (mesaj.tur === 'TAMAMLANDI') {
        ilerle({
          tur: 'TAMAMLANDI',
          genelToplam: mesaj.genelToplam,
          paraUstu: mesaj.paraUstu,
          zaman: Date.now(),
          sureMs: tesekkurMs.current,
        });
      }
    });
    kopru.hazir();
    return birak;
  }, []);

  useEffect(() => {
    const t = setInterval(() => ilerle({ tur: 'SAAT', zaman: Date.now() }), 500);
    return () => clearInterval(t);
  }, []);

  if (!yapilandirma) return <div className="h-full bg-slate-950" />;
  return <MusteriEkraniGorunumu yapilandirma={yapilandirma} durum={durum} />;
}

document.documentElement.classList.add('musteri-pencere');
const kok = document.getElementById('kok');
if (!kok) throw new Error('Kök öğe bulunamadı');

createRoot(kok).render(
  <StrictMode>
    <MusteriPenceresi />
  </StrictMode>,
);
