/**
 * Kayıtlı bir satışın fişi — yazıcıdan çıkacak fişin AYNISI.
 *
 * Fiş ana süreçte yazdırmayla aynı kodla üretilir (`satis.fisGorunumu`):
 * görsel fiş açıksa yazıcıya giden HTML'in kendisi, kapalıysa metin fişinin
 * geri çözülmüş hali. Ekranda ayrı bir fiş tasarımı yoktur; geçmiş fişe bakan
 * kişi müşterinin elindeki kağıdın aynısını görür. Tekrar yazdırmayla aynı
 * olsun diye KOPYA damgalıdır.
 */

import { useEffect, useRef, useState } from 'react';
import { hatayiBildir } from '../durum/bildirim';
import { cagir } from '../kopru';
import { FisOnizleme, type FisOnizlemeVerisi } from './Onizleme';
import { Yukleniyor } from './temel';

type Gorunum = { tur: 'html'; html: string; enNokta: number } | ({ tur: 'metin' } & FisOnizlemeVerisi);

/** Ekranda fişin genişliği (px). Kağıt 576 nokta (80 mm) basar; ekranda bu ölçek okunaklıdır. */
const EKRAN_ENI = 380;

export function FisGorunumu({ satisId }: { satisId: string }) {
  const [gorunum, setGorunum] = useState<Gorunum | null>(null);

  useEffect(() => {
    let iptal = false;
    setGorunum(null);
    cagir<Gorunum>('satis.fisGorunumu', { satisId })
      .then((g) => {
        if (iptal) return;
        // Kesme çizgisi yazıcı içindir; ekranda gösterilmez.
        setGorunum(g.tur === 'metin' ? { ...g, ogeler: g.ogeler.filter((o) => o.tip !== 'kesme') } : g);
      })
      .catch((hata) => !iptal && hatayiBildir(hata, 'Fiş'));
    return () => {
      iptal = true;
    };
  }, [satisId]);

  if (!gorunum) return <Yukleniyor />;
  if (gorunum.tur === 'metin') return <FisOnizleme veri={gorunum} />;
  return <HtmlFis html={gorunum.html} enNokta={gorunum.enNokta} />;
}

/**
 * Görsel fiş: yazıcıya giden HTML bir çerçevede çizilir. Betik çalıştırılmaz
 * (sandbox); yükseklik içerik kadar ayarlanır, kağıt ekrana sığacak ölçekte
 * gösterilir.
 */
function HtmlFis({ html, enNokta }: { html: string; enNokta: number }) {
  const cerceve = useRef<HTMLIFrameElement>(null);
  const [yukseklik, setYukseklik] = useState(400);
  const olcek = Math.min(1, EKRAN_ENI / enNokta);

  const olc = () => {
    const govde = cerceve.current?.contentDocument?.body;
    if (govde) setYukseklik(govde.scrollHeight);
  };

  return (
    <div className="flex justify-center overflow-auto rounded bg-yuzey-4/40 p-4">
      <div className="shadow-md" style={{ width: enNokta * olcek, height: yukseklik * olcek, background: '#fff' }}>
        <iframe
          ref={cerceve}
          title="Fiş"
          sandbox="allow-same-origin"
          srcDoc={html}
          onLoad={olc}
          scrolling="no"
          style={{
            width: enNokta,
            height: yukseklik,
            border: 0,
            transform: `scale(${olcek})`,
            transformOrigin: 'top left',
            display: 'block',
          }}
        />
      </div>
    </div>
  );
}
