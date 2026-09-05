/** Dashboard (§11.2) — tüm veriler rollup tablolarından tek çağrıda gelir. */

'use client';

import { miktarFormat, paraFormat, type Kurus } from '@market/shared';
import { CiroTrendi, OdemeKirilimi, type TrendNoktasi } from '@/bilesen/grafik';
import { HataKutusu, Kabuk, Kutu, ParaKutusu, Yukleniyor } from '@/bilesen/kabuk';
import { uclar } from '@/lib/api';
import { useVeri } from '@/lib/kanca';

interface DashboardOzeti {
  tarih: string;
  bugun: {
    ciro: Kurus;
    islem_sayisi: number;
    ortalama_sepet: Kurus;
    brut_kar: Kurus;
    nakit: Kurus;
    kart: Kurus;
    veresiye: Kurus;
  };
  degisim_yuzde: number;
  trend: TrendNoktasi[];
  en_cok_satan: { urun_id: string; urun_adi: string; adet: number; ciro: Kurus; kar: Kurus }[];
  kritik_stok_sayisi: number;
  toplam_musteri_alacagi: Kurus;
  toplam_tedarikci_borcu: Kurus;
  senkron: { son_senkron: string | null; aktif_cihaz_sayisi: number };
  uretim_zamani: string;
}

export default function DashboardSayfasi() {
  const { veri, yukleniyor, hata, tazele } = useVeri<DashboardOzeti>(uclar.dashboard);

  return (
    <Kabuk baslik="Genel Bakış" tazelik={veri?.senkron.son_senkron ?? veri?.uretim_zamani}>
      {yukleniyor ? (
        <Yukleniyor />
      ) : hata ? (
        <HataKutusu mesaj={hata} tekrarDene={tazele} />
      ) : !veri ? null : (
        <div className="space-y-4">
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ParaKutusu etiket="Bugünkü ciro" tutar={veri.bugun.ciro} alt={`Düne göre %${veri.degisim_yuzde}`} vurgulu />
            <Kutu
              etiket="İşlem sayısı"
              deger={String(veri.bugun.islem_sayisi)}
              alt={`Ort. sepet ${paraFormat(veri.bugun.ortalama_sepet)}`}
            />
            <ParaKutusu etiket="Brüt kâr" tutar={veri.bugun.brut_kar} alt="KDV hariç" />
            <Kutu
              etiket="Kritik stok"
              deger={String(veri.kritik_stok_sayisi)}
              alt={veri.kritik_stok_sayisi > 0 ? 'Sipariş gerekebilir' : 'Sorun yok'}
              uyari={veri.kritik_stok_sayisi > 0}
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <div className="kart p-4 lg:col-span-2">
              <h2 className="mb-3 font-semibold">Son 7 Gün Ciro</h2>
              <CiroTrendi veri={veri.trend} />
            </div>
            <div className="kart p-4">
              <h2 className="mb-3 font-semibold">Bugün Ödeme Kırılımı</h2>
              <OdemeKirilimi nakit={veri.bugun.nakit} kart={veri.bugun.kart} veresiye={veri.bugun.veresiye} />
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <ParaKutusu etiket="Müşteri alacağı" tutar={veri.toplam_musteri_alacagi} alt="Toplam veresiye" />
            <ParaKutusu etiket="Tedarikçi borcu" tutar={veri.toplam_tedarikci_borcu} alt="Ödenecek" />
            <Kutu
              etiket="Bağlı cihaz"
              deger={String(veri.senkron.aktif_cihaz_sayisi)}
              alt={veri.senkron.son_senkron ? 'Son senkron alındı' : 'Henüz senkron yok'}
            />
          </section>

          <section className="kart p-4">
            <h2 className="mb-3 font-semibold">En Çok Satanlar (7 gün)</h2>
            {veri.en_cok_satan.length === 0 ? (
              <p className="py-6 text-center text-sm text-metin-4">Bu dönemde satış verisi yok.</p>
            ) : (
              <div className="tablo-sarmal">
                <table className="tablo">
                  <thead>
                    <tr>
                      <th className="text-left">Ürün</th>
                      <th>Adet</th>
                      <th>Ciro</th>
                      <th>Kâr</th>
                    </tr>
                  </thead>
                  <tbody>
                    {veri.en_cok_satan.map((u) => (
                      <tr key={u.urun_id}>
                        <td className="max-w-[180px] truncate">{u.urun_adi}</td>
                        <td className="sayi">{miktarFormat(u.adet)}</td>
                        <td className="sayi">{paraFormat(u.ciro, { simge: false })}</td>
                        <td className="sayi text-vurgu">{paraFormat(u.kar, { simge: false })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </Kabuk>
  );
}
