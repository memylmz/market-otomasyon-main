/** Satır iskontosu (F4) — yetki gerektirir; ana süreç de ayrıca denetler (§15.4). */

import { useEffect, useState } from 'react';
import { paraFormat, satirHesapla, type Kurus } from '@market/shared';
import { Diyalog, ParaAlani } from '../../bilesen/temel';
import { bildir } from '../../durum/bildirim';
import { useYetki } from '../../durum/oturum';
import { sepetDurumu, type SepetSatiri } from '../../durum/sepet';

export function IskontoDiyalogu({ acik, satir, onKapat }: { acik: boolean; satir: SepetSatiri | null; onKapat: () => void }) {
  const yetkili = useYetki('satis.iskonto');
  const [yuzde, setYuzde] = useState('');
  const [tutar, setTutar] = useState<Kurus>(0);

  useEffect(() => {
    if (acik && satir) {
      setYuzde(satir.iskontoYuzde ? String(satir.iskontoYuzde) : '');
      setTutar(satir.iskontoTutar ?? 0);
    }
  }, [acik, satir]);

  if (!satir) return null;

  const yuzdeSayi = Number(yuzde.replace(',', '.'));
  const gecerliYuzde =
    yuzde === '' ? undefined : Number.isFinite(yuzdeSayi) && yuzdeSayi >= 0 && yuzdeSayi <= 100 ? yuzdeSayi : undefined;

  const onizleme = satirHesapla({
    miktar: satir.miktar,
    birimFiyat: satir.birimFiyat,
    kdvOrani: satir.kdvOrani,
    iskontoYuzde: gecerliYuzde,
    iskontoTutar: tutar || undefined,
  });

  const uygula = () => {
    if (!yetkili) {
      bildir.hata('İskonto uygulama yetkiniz yok');
      return;
    }
    sepetDurumu.getState().satirIskontosu(satir.anahtar, gecerliYuzde, tutar || undefined);
    onKapat();
  };

  return (
    <Diyalog
      acik={acik}
      baslik="Satır İskontosu"
      aciklama={satir.ad}
      genislik="dar"
      onKapat={onKapat}
      altBilgi={
        <>
          <button
            type="button"
            className="tus-ikincil mr-auto"
            onClick={() => {
              sepetDurumu.getState().satirIskontosu(satir.anahtar, undefined, undefined);
              onKapat();
            }}
          >
            İskontoyu Kaldır
          </button>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={uygula} disabled={!yetkili}>
            Uygula
          </button>
        </>
      }
    >
      {!yetkili && (
        <p className="mb-3 rounded border border-tehlike-cizgi bg-tehlike-yumusak p-2 text-sm text-tehlike">
          Bu işlem için yetkiniz yok. Yetkili bir kullanıcıdan onay isteyin.
        </p>
      )}

      <div className="space-y-3">
        <label className="block">
          <span className="etiket">Yüzde iskonto (%)</span>
          <input
            type="text"
            inputMode="decimal"
            className="alan sayi"
            value={yuzde}
            onChange={(e) => setYuzde(e.target.value)}
            placeholder="0"
            data-odak
          />
        </label>

        <label className="block">
          <span className="etiket">Tutar iskontosu</span>
          <ParaAlani deger={tutar} onDegisim={setTutar} onEnter={uygula} />
        </label>

        <div className="space-y-1 rounded bg-yuzey-3 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-metin-3">Brüt</span>
            <span className="sayi">{paraFormat(onizleme.brut, { simge: false })}</span>
          </div>
          <div className="flex justify-between text-uyari">
            <span>İskonto</span>
            <span className="sayi">-{paraFormat(onizleme.iskonto, { simge: false })}</span>
          </div>
          <div className="flex justify-between border-t border-cizgi pt-1 font-semibold">
            <span>Satır toplamı</span>
            <span className="sayi text-vurgu">{paraFormat(onizleme.satirToplam)}</span>
          </div>
        </div>
      </div>
    </Diyalog>
  );
}
