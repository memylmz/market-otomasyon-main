/** İade / değişim ekranı (§10.4) — fiş no ile orijinal satışı bul, tam/kısmi iade et. */

import { useRef, useState } from 'react';
import { miktarFormat, miktarParse, paraFormat, tarihSaatFormat, type Kurus, type Miktar } from '@market/shared';
import { Alan, BosDurum, Diyalog } from '../bilesen/temel';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { useBarkodOdakYakalayici } from '../kanca/useKisayol';
import { cagir } from '../kopru';

interface Kalem {
  id: string;
  urun_adi: string;
  miktar: Miktar;
  birim_tipi: string;
  birim_fiyat: Kurus;
  satir_toplam: Kurus;
  iade_edilen?: Miktar;
}

interface SatisDetay {
  satis: {
    id: string;
    fis_no: string;
    tarih: string;
    genel_toplam: Kurus;
    iptal_mi: boolean;
    iade_mi: boolean;
    musteri_adi?: string | null;
  };
  kalemler: Kalem[];
}

export function IadeSayfasi() {
  const [fisNo, setFisNo] = useState('');
  const [detay, setDetay] = useState<SatisDetay | null>(null);
  const [secimler, setSecimler] = useState<Record<string, string>>({});
  const [yontem, setYontem] = useState<'NAKIT' | 'KART' | 'VERESIYE'>('NAKIT');
  const [neden, setNeden] = useState('');
  const [calisiyor, setCalisiyor] = useState(false);
  const [onayAcik, setOnayAcik] = useState(false);
  const fisAlani = useRef<HTMLInputElement>(null);

  // Fiş barkodu okutulduğunda alan odakta olmasa da yakalanır.
  useBarkodOdakYakalayici({
    aktif: true,
    odakla: () => fisAlani.current?.focus(),
    onKarakter: (karakter) => setFisNo((mevcut) => mevcut + karakter),
  });

  const bul = async () => {
    if (!fisNo.trim()) return;
    try {
      const liste = await cagir<{ kayitlar: { id: string }[] }>('satis.listele', { filtre: { fisNo: fisNo.trim() }, limit: 1 });
      const ilk = liste.kayitlar[0];
      if (!ilk) {
        bildir.uyari('Satış bulunamadı', 'Fiş numarasını kontrol edin.');
        setDetay(null);
        return;
      }
      const d = await cagir<SatisDetay>('satis.detay', { satisId: ilk.id });
      setDetay(d);
      setSecimler({});
      if (d.satis.iptal_mi) bildir.uyari('Bu satış iptal edilmiş, iade edilemez.');
      if (d.satis.iade_mi) bildir.uyari('Bu bir iade fişidir, tekrar iade edilemez.');
    } catch (hata) {
      hatayiBildir(hata, 'Satış arama');
    }
  };

  const secilenKalemler = () =>
    Object.entries(secimler)
      .map(([id, metin]) => ({ satis_kalemi_id: id, miktar: miktarParse(metin) ?? 0 }))
      .filter((k) => k.miktar > 0);

  const onayIste = () => {
    if (!detay) return;
    if (secilenKalemler().length === 0) {
      bildir.uyari('İade edilecek kalem seçilmedi');
      return;
    }
    // İade geri alınamaz bir işlemdir: stok, kasa ve cari aynı anda etkilenir.
    // Yıkıcı işlemlerde onay istenir (§3.3 hata affı).
    setOnayAcik(true);
  };

  const iadeEt = async () => {
    if (!detay) return;
    const kalemler = secilenKalemler();
    if (kalemler.length === 0) return;

    setOnayAcik(false);
    setCalisiyor(true);
    try {
      const sonuc = await cagir<{ fisNo: string; genelToplam: Kurus }>('satis.iade', {
        kaynak_satis_id: detay.satis.id,
        kalemler,
        iade_yontemi: yontem,
        // Neden opsiyoneldir; boş bırakılırsa denetim kaydında ayırt edilebilir
        // sabit bir metin yazılır (alan hiç boş kalmasın).
        neden: neden.trim() || 'Belirtilmedi',
      });
      bildir.basari(`İade tamamlandı — ${sonuc.fisNo}`, paraFormat(Math.abs(sonuc.genelToplam)));
      setDetay(null);
      setSecimler({});
      setNeden('');
      setFisNo('');
    } catch (hata) {
      hatayiBildir(hata, 'İade');
    } finally {
      setCalisiyor(false);
    }
  };

  const toplamIade = detay
    ? detay.kalemler.reduce((t, k) => {
        const m = miktarParse(secimler[k.id] ?? '') ?? 0;
        return t + (k.miktar > 0 ? Math.round(k.satir_toplam * (m / k.miktar)) : 0);
      }, 0)
    : 0;

  const iadeEdilebilir = detay && !detay.satis.iptal_mi && !detay.satis.iade_mi;

  return (
    <div className="flex h-full flex-col p-4">
      <h1 className="mb-3 text-xl font-semibold">İade / Değişim</h1>

      <div className="mb-4 flex max-w-md gap-2">
        <input
          ref={fisAlani}
          className="alan"
          placeholder="Fiş barkodunu okutun veya numarayı yazın (örn. A-000512)"
          value={fisNo}
          onChange={(e) => setFisNo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && bul()}
          autoFocus
        />
        <button type="button" className="tus-birincil" onClick={bul}>
          Bul
        </button>
      </div>

      {!detay ? (
        <BosDurum
          baslik="Satış seçilmedi"
          aciklama="İade için önce orijinal satışı fiş numarasıyla bulun. Değişim = iade + yeni satış olarak yapılır."
        />
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          <section className="kart min-w-0 flex-1 overflow-auto">
            <header className="border-b border-cizgi px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono font-semibold">{detay.satis.fis_no}</p>
                  <p className="text-sm text-metin-3">
                    {tarihSaatFormat(detay.satis.tarih)}
                    {detay.satis.musteri_adi ? ` · ${detay.satis.musteri_adi}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-lg font-bold">{paraFormat(detay.satis.genel_toplam)}</p>
                </div>
              </div>
            </header>

            {/* İade edilemeyecek fişler küçük bir rozetle geçiştirilmemeli:
                kasiyer neden hiçbir kalemi seçemediğini anında anlamalı. */}
            {(detay.satis.iade_mi || detay.satis.iptal_mi) && (
              <div
                className={`m-4 flex items-start gap-3 rounded-lg border p-4 ${
                  detay.satis.iptal_mi ? 'border-tehlike-cizgi bg-tehlike-yumusak' : 'border-uyari-cizgi bg-uyari-yumusak'
                }`}
                role="alert"
              >
                <span aria-hidden="true" className="text-2xl">
                  {detay.satis.iptal_mi ? '✕' : '↩'}
                </span>
                <div>
                  <p className={`text-base font-semibold ${detay.satis.iptal_mi ? 'text-tehlike' : 'text-uyari'}`}>
                    {detay.satis.iptal_mi ? 'Bu satış iptal edilmiş' : 'Bu bir İADE FİŞİ'}
                  </p>
                  <p className="mt-0.5 text-sm text-metin-2">
                    {detay.satis.iptal_mi
                      ? 'İptal edilmiş bir satış iade edilemez.'
                      : 'İade fişi tekrar iade edilemez. İade etmek istediğiniz asıl satış fişinin numarasını okutun.'}
                  </p>
                </div>
              </div>
            )}

            <table className="tablo">
              <thead>
                <tr>
                  <th>Ürün</th>
                  <th className="text-center">Satılan</th>
                  <th className="text-center">İade edilmiş</th>
                  <th className="text-center">Birim fiyat</th>
                  <th className="w-32 text-center">İade miktarı</th>
                </tr>
              </thead>
              <tbody>
                {detay.kalemler.map((k) => {
                  const dahaOnce = -(k.iade_edilen ?? 0);
                  const kalan = k.miktar - dahaOnce;
                  return (
                    <tr key={k.id}>
                      <td className="font-medium">{k.urun_adi}</td>
                      <td className="text-center font-mono tabular-nums">{miktarFormat(k.miktar)}</td>
                      <td className="text-center font-mono tabular-nums text-uyari">
                        {dahaOnce > 0 ? miktarFormat(dahaOnce) : '—'}
                      </td>
                      <td className="text-center font-mono tabular-nums">{paraFormat(k.birim_fiyat, { simge: false })}</td>
                      <td>
                        <div className="flex justify-center gap-1">
                          <input
                            className="alan sayi py-1"
                            value={secimler[k.id] ?? ''}
                            placeholder="0"
                            disabled={!iadeEdilebilir || kalan <= 0}
                            onChange={(e) => setSecimler((s) => ({ ...s, [k.id]: e.target.value }))}
                          />
                          <button
                            type="button"
                            className="tus-ikincil px-2 py-1 text-xs"
                            disabled={!iadeEdilebilir || kalan <= 0}
                            onClick={() => setSecimler((s) => ({ ...s, [k.id]: String(kalan / 1000) }))}
                          >
                            Tümü
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <aside className="w-72 shrink-0">
            <div className="kart space-y-3 p-4">
              <div>
                <p className="text-sm text-metin-3">İade tutarı</p>
                <p className="font-mono text-3xl font-bold text-uyari">{paraFormat(toplamIade)}</p>
              </div>

              <Alan etiket="İade şekli" ipucu="Karttan iade manuel yapılır; sistem yalnız kayıt tutar.">
                <select
                  className="alan"
                  value={yontem}
                  onChange={(e) => setYontem(e.target.value as typeof yontem)}
                  disabled={!iadeEdilebilir}
                >
                  <option value="NAKIT">Nakit iade (kasadan)</option>
                  <option value="KART">Karta iade (manuel)</option>
                  <option value="VERESIYE">Cari alacağa işle</option>
                </select>
              </Alan>

              <Alan etiket="İade nedeni" ipucu="İsteğe bağlı. Girilirse fişe ve denetim kaydına yazılır.">
                <textarea
                  className="alan"
                  rows={3}
                  value={neden}
                  onChange={(e) => setNeden(e.target.value)}
                  disabled={!iadeEdilebilir}
                  placeholder="Örn. müşteri beğenmedi, ambalaj hasarlı…"
                />
              </Alan>

              <button
                type="button"
                className="tus-tehlike w-full"
                onClick={onayIste}
                disabled={!iadeEdilebilir || calisiyor || toplamIade <= 0}
              >
                {calisiyor ? 'İşleniyor…' : 'İadeyi Onayla'}
              </button>

              <p className="text-xs text-metin-4">
                İade onaylandığında: mal stoğa girer, kasa/cari ters kayıtla düzeltilir ve işlem denetim loguna yazılır.
              </p>
            </div>
          </aside>
        </div>
      )}

      <Diyalog
        acik={onayAcik}
        baslik="İadeyi onaylıyor musunuz?"
        aciklama="Bu işlem geri alınamaz."
        genislik="dar"
        onKapat={() => setOnayAcik(false)}
        altBilgi={
          <>
            <button type="button" className="tus-ikincil" onClick={() => setOnayAcik(false)}>
              Vazgeç
            </button>
            <button type="button" className="tus-tehlike" onClick={iadeEt} disabled={calisiyor} data-odak>
              Evet, İade Et
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="rounded-lg bg-yuzey-3 p-4 text-center">
            <p className="text-metin-3">İade tutarı</p>
            <p className="font-mono text-3xl font-bold text-uyari">{paraFormat(toplamIade)}</p>
          </div>

          <ul className="space-y-1">
            <li className="flex items-center gap-2 border-b border-cizgi pb-1 text-xs font-medium text-metin-3">
              <span className="flex-1">Ürün</span>
              <span className="w-24 text-center">Miktar</span>
            </li>
            {detay?.kalemler
              .filter((k) => (miktarParse(secimler[k.id] ?? '') ?? 0) > 0)
              .map((k) => (
                <li key={k.id} className="flex items-center gap-2 border-b border-cizgi-ince pb-1">
                  <span className="flex-1">{k.urun_adi}</span>
                  <span className="w-24 text-center font-mono tabular-nums">
                    {miktarFormat(miktarParse(secimler[k.id] ?? '') ?? 0)}
                  </span>
                </li>
              ))}
          </ul>

          <p className="text-metin-2">
            İade şekli:{' '}
            <strong>
              {yontem === 'NAKIT'
                ? 'Nakit (kasadan çıkacak)'
                : yontem === 'KART'
                  ? 'Karta iade (manuel)'
                  : 'Cari alacağa işlenecek'}
            </strong>
          </p>

          <p className="text-xs text-metin-3">
            Mal stoğa geri girer, kasa ve cari ters kayıtla düzeltilir, işlem denetim loguna yazılır.
          </p>
        </div>
      </Diyalog>
    </div>
  );
}
