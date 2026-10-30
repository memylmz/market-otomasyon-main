/**
 * Ayarlar → Fiş Düzeni: satış fişinde ve cari ekstresinde neyin, hangi
 * büyüklükte basılacağı — sağda CANLI önizlemeyle.
 *
 * Önizleme yazıcıya gidecek belgenin aynısıdır (görsel fiş açıksa HTML,
 * kapalıysa metin) ve gerçek veriyle çizilir: son satış, en çok hareketi
 * olan cari. Kayıt yoksa örnek veri kullanılır. Değerler KAYDEDİLMEDEN
 * gönderilir; baskı yalnız Kaydet'ten sonra değişir.
 */

import { useEffect, useState, type ReactNode } from 'react';
import {
  AYAR,
  EKSTRE_HAREKET_SECENEKLERI,
  fisDuzeniCoz,
  type FisDuzeni,
  type FisSablonu,
  type FisYaziBoyutu,
} from '@market/shared';
import { HtmlFis } from '../../bilesen/FisGorunumu';
import { FisOnizleme, type FisOnizlemeVerisi } from '../../bilesen/Onizleme';
import { Alan, Rozet } from '../../bilesen/temel';
import { cagir } from '../../kopru';

type Onizleme =
  { tur: 'html'; html: string; enNokta: number; ornek: boolean } | ({ tur: 'metin'; ornek: boolean } & FisOnizlemeVerisi);

export function FisDuzeniSekmesi({
  ayarlar,
  ayarla,
}: {
  ayarlar: Record<string, string>;
  ayarla: (a: string, d: string) => void;
}) {
  const duzen = fisDuzeniCoz(ayarlar[AYAR.FIS_DUZENI]);
  const degistir = (yama: Partial<FisDuzeni>) => ayarla(AYAR.FIS_DUZENI, JSON.stringify({ ...duzen, ...yama }));
  const [belge, setBelge] = useState<'satis' | 'ekstre'>('satis');
  const [onizleme, setOnizleme] = useState<Onizleme | null>(null);
  const gorsel = (ayarlar[AYAR.YAZICI_GORSEL_FIS] ?? '1') === '1';

  useEffect(() => {
    // Kısa gecikme: yazarken her tuşta ana sürece gidilmesin.
    const zamanlayici = setTimeout(() => {
      cagir<Onizleme>('ayar.belgeOnizleme', { tur: belge, ayarlar })
        .then((o) => setOnizleme(o.tur === 'metin' ? { ...o, ogeler: o.ogeler.filter((x) => x.tip !== 'kesme') } : o))
        .catch(() => setOnizleme(null));
    }, 250);
    return () => clearTimeout(zamanlayici);
  }, [ayarlar, belge]);

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <div className="grid gap-4 xl:max-w-2xl xl:flex-1">
        <Bolum baslik="Tasarım">
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ['klasik', 'Klasik', 'Yazarkasa fişi gibi: düz yazı, kesikli çizgiler, toplam çift çizgi arasında. Az mürekkep.'],
                ['modern', 'Modern', 'Kalın başlık, gri ayrıntılar, toplam siyah bant içinde.'],
              ] as [FisSablonu, string, string][]
            ).map(([d, e, a]) => (
              <button
                key={d}
                type="button"
                onClick={() => degistir({ sablon: d })}
                className={`rounded-lg border px-3 py-2 text-left ${
                  duzen.sablon === d ? 'border-vurgu bg-vurgu-yumusak' : 'border-cizgi hover:bg-yuzey-2'
                }`}
              >
                <span className="block font-medium">{e}</span>
                <span className="block text-xs text-metin-3">{a}</span>
              </button>
            ))}
          </div>
        </Bolum>

        <Bolum baslik="Yazı boyutu">
          <div className="flex gap-2">
            {(
              [
                ['kucuk', 'Küçük', 'Kâğıt tasarrufu'],
                ['normal', 'Normal', 'Önerilen'],
                ['buyuk', 'Büyük', 'Kolay okunur'],
              ] as [FisYaziBoyutu, string, string][]
            ).map(([d, e, a]) => (
              <button
                key={d}
                type="button"
                onClick={() => degistir({ yaziBoyutu: d })}
                className={`flex-1 rounded-lg border px-3 py-2 text-left ${
                  duzen.yaziBoyutu === d ? 'border-vurgu bg-vurgu-yumusak' : 'border-cizgi hover:bg-yuzey-2'
                }`}
              >
                <span className="block font-medium">{e}</span>
                <span className="block text-xs text-metin-3">{a}</span>
              </button>
            ))}
          </div>
          {!gorsel && (
            <p className="text-xs text-uyari">
              &quot;Fişi görüntü olarak bas&quot; kapalı (Donanım sekmesi): metin fişinde yazı boyutunu yazıcının kendi fontu
              belirler.
            </p>
          )}
        </Bolum>

        <Bolum baslik="Satış fişinde görünsün">
          <div className="grid gap-1.5 sm:grid-cols-2">
            <Kutu deger={duzen.adres} degis={(v) => degistir({ adres: v })} etiket="İşletme adresi" />
            <Kutu deger={duzen.telefon} degis={(v) => degistir({ telefon: v })} etiket="İşletme telefonu" />
            <Kutu deger={duzen.vergiNo} degis={(v) => degistir({ vergiNo: v })} etiket="Vergi numarası" />
            <Kutu deger={duzen.kasiyer} degis={(v) => degistir({ kasiyer: v })} etiket="Kasiyer adı" />
            <Kutu
              deger={duzen.musteri}
              degis={(v) => degistir({ musteri: v })}
              etiket="Müşteri adı"
              ipucu="Veresiye ve iade fişinde her zaman basılır."
            />
            <Kutu
              deger={duzen.kalemDetayi}
              degis={(v) => degistir({ kalemDetayi: v })}
              etiket="Ürün altında miktar × fiyat"
              ipucu="Kapalıysa ürün tek satır; miktar adın yanında."
            />
            <Kutu deger={duzen.kdvDokumu} degis={(v) => degistir({ kdvDokumu: v })} etiket="KDV dökümü" />
            <Kutu
              deger={duzen.fisBarkodu}
              degis={(v) => degistir({ fisBarkodu: v })}
              etiket="Fiş numarası barkodu"
              ipucu="İadede fişi okutmaya yarar."
            />
          </div>
        </Bolum>

        <Bolum baslik="Fiş metinleri">
          <Alan
            etiket="Üst metin"
            ipucu="İşletme bilgisinin altında. Örn. “Hoş geldiniz” ya da kampanya duyurusu. Boşsa basılmaz."
          >
            <input
              className="alan"
              maxLength={120}
              value={duzen.ustMetin}
              onChange={(e) => degistir({ ustMetin: e.target.value })}
              placeholder="isteğe bağlı"
            />
          </Alan>
          <Alan etiket="Alt metin" ipucu="Fişin altında. Boşsa basılmaz.">
            <input
              className="alan"
              value={ayarlar[AYAR.FIS_ALT_METIN] ?? ''}
              onChange={(e) => ayarla(AYAR.FIS_ALT_METIN, e.target.value)}
              placeholder="Bizi tercih ettiğiniz için teşekkürler."
            />
          </Alan>
          <Alan etiket="Yasal uyarı" ipucu="Kaldırılamaz; boş bırakılırsa varsayılan ifade basılır.">
            <input
              className="alan"
              value={ayarlar[AYAR.FIS_YASAL_UYARI] ?? ''}
              onChange={(e) => ayarla(AYAR.FIS_YASAL_UYARI, e.target.value)}
              placeholder="BİLGİ FİŞİDİR - MALİ DEĞERİ YOKTUR"
            />
          </Alan>
        </Bolum>

        <Bolum baslik="Cari ekstresi">
          <Alan etiket="En fazla kaç hareket basılsın" ipucu="En yeni hareketler basılır; kâğıt metrelerce akmasın.">
            <select
              className="alan w-40"
              value={duzen.ekstreHareketSayisi}
              onChange={(e) => degistir({ ekstreHareketSayisi: Number(e.target.value) })}
            >
              {EKSTRE_HAREKET_SECENEKLERI.map((n) => (
                <option key={n} value={n}>
                  Son {n}
                </option>
              ))}
            </select>
          </Alan>
          <Kutu
            deger={duzen.ekstreOzet}
            degis={(v) => degistir({ ekstreOzet: v })}
            etiket="Dönem özeti"
            ipucu="Dönem başı bakiye, toplam borç, toplam tahsilat."
          />
        </Bolum>

        <p className="text-xs text-metin-3">
          Değişiklikler sağdaki önizlemede hemen görünür; fişe <b>Kaydet</b>&apos;ten sonra yansır. Kâğıt genişliği ve görsel fiş
          ayarı <b>Donanım</b> sekmesindedir.
        </p>
      </div>

      <aside className="xl:sticky xl:top-4 xl:w-[450px] xl:shrink-0">
        <section className="kart p-3">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="mr-auto text-sm font-semibold">Önizleme</h3>
            {(
              [
                ['satis', 'Satış fişi'],
                ['ekstre', 'Ekstre'],
              ] as const
            ).map(([d, e]) => (
              <button
                key={d}
                type="button"
                onClick={() => setBelge(d)}
                className={`rounded-full px-3 py-1 text-sm ${belge === d ? 'bg-vurgu text-white' : 'bg-yuzey-2 text-metin-2 hover:bg-yuzey-3'}`}
              >
                {e}
              </button>
            ))}
          </div>
          <p className="mb-2 text-xs text-metin-4">
            {onizleme?.ornek
              ? 'Kayıt olmadığı için örnek veriyle çizildi.'
              : belge === 'satis'
                ? 'Son satışınızla — kâğıtta böyle çıkar.'
                : 'En çok hareketi olan cariyle — kâğıtta böyle çıkar.'}{' '}
            {onizleme && <Rozet tur="bilgi">{onizleme.tur === 'html' ? 'Görsel fiş' : 'Metin fiş'}</Rozet>}
          </p>
          {!onizleme ? (
            <p className="text-xs text-metin-4">Hazırlanıyor…</p>
          ) : onizleme.tur === 'html' ? (
            <HtmlFis html={onizleme.html} enNokta={onizleme.enNokta} />
          ) : (
            <FisOnizleme veri={onizleme} />
          )}
        </section>
      </aside>
    </div>
  );
}

function Bolum({ baslik, children }: { baslik: string; children: ReactNode }) {
  return (
    <section className="grid gap-2 rounded-lg border border-cizgi p-4">
      <h3 className="font-semibold">{baslik}</h3>
      {children}
    </section>
  );
}

function Kutu({ deger, degis, etiket, ipucu }: { deger: boolean; degis: (v: boolean) => void; etiket: string; ipucu?: string }) {
  return (
    <label className="flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-yuzey-2">
      <input type="checkbox" className="mt-0.5" checked={deger} onChange={(e) => degis(e.target.checked)} />
      <span>
        {etiket}
        {ipucu && <span className="block text-xs text-metin-4">{ipucu}</span>}
      </span>
    </label>
  );
}
