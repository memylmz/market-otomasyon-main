/**
 * Uygulama yönlendirmesi ve oturum kapısı.
 *
 * Akış: kurulum gerekli mi → giriş yapılmış mı → kabuk + sayfalar.
 * Oturum zaman aşımında ekran kilitlenir (§15.5).
 */

import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { BildirimKatmani, OnayKatmani, Yukleniyor } from './bilesen/temel';
import { EkranTusTakimi } from './bilesen/EkranTusTakimi';
import { HataSiniri } from './bilesen/HataSiniri';
import { Kabuk } from './bilesen/Kabuk';
import { bildir } from './durum/bildirim';
import { oturumDurumu } from './durum/oturum';
import { useMusteriEkraniYayini } from './kanca/useMusteriEkraniYayini';
import { useOdakOnarici } from './kanca/useOdakOnarici';
import { olayDinle } from './kopru';
import { AyarlarSayfasi } from './sayfa/Ayarlar';
import { CariSayfasi } from './sayfa/Cari';
import { GirisSayfasi } from './sayfa/Giris';
import { IadeSayfasi } from './sayfa/Iade';
import { KasaSayfasi } from './sayfa/Kasa';
import { KurulumSayfasi } from './sayfa/Kurulum';
import { RaporlarSayfasi } from './sayfa/Raporlar';
import { SatisSayfasi } from './sayfa/Satis';
import { StokSayfasi } from './sayfa/Stok';
import { KampanyalarSayfasi } from './sayfa/Kampanyalar';
import { UrunlerSayfasi } from './sayfa/Urunler';
import { YazarkasaSayfasi } from './sayfa/Yazarkasa';

export function App() {
  const yukleniyor = oturumDurumu((s) => s.yukleniyor);
  const sistem = oturumDurumu((s) => s.sistem);
  const tazele = oturumDurumu((s) => s.tazele);
  const [baslatmaHatasi, setBaslatmaHatasi] = useState<string | null>(null);
  /** Sıfırlama / geri yükleme sonrası: veritabanı kapalı, program kendini yeniden açıyor. */
  const [yenidenBasliyor, setYenidenBasliyor] = useState<string | null>(null);
  // Müşteri ekranı sepeti her sayfada görür (bkz. kanca).
  useMusteriEkraniYayini();
  useOdakOnarici();

  useEffect(() => {
    tazele().catch((hata) => setBaslatmaHatasi(hata instanceof Error ? hata.message : String(hata)));
  }, [tazele]);

  // Ana süreçten gelen olaylar (senkron, yedek, kasa) durum çubuğunu tazeler.
  useEffect(() => {
    return olayDinle((olay, veri) => {
      if (olay === 'senkron:tamamlandi') {
        const sonuc = veri as { basarili: boolean; gonderilen: number; hata?: string };
        if (sonuc.basarili && sonuc.gonderilen > 0) {
          bildir.bilgi('Senkron tamamlandı', `${sonuc.gonderilen} kayıt buluta gönderildi.`);
        }
        void tazele();
      } else if (olay === 'pos:uyari') {
        // Arka planda olan POS olayı (süre aşımından sonra gelen onay vb.).
        const uyari = veri as { tur: 'uyari' | 'hata'; baslik: string; mesaj: string };
        if (uyari.tur === 'hata') bildir.hata(uyari.baslik, uyari.mesaj);
        else bildir.uyari(uyari.baslik, uyari.mesaj);
      } else if (olay === 'fis:yazdirma') {
        // Başarılı yazdırma sessizdir — çıkan kağıdın kendisi zaten geri bildirimdir.
        // Yalnız başarısızlık bildirilir, çünkü kasiyerin fişi elle tekrar
        // yazdırması gerekir (satış yine de geçerlidir, §20).
        const sonuc = veri as { fisNo: string; basarili: boolean; hata: string | null };
        if (!sonuc.basarili) {
          bildir.uyari(
            `Fiş yazdırılamadı — ${sonuc.fisNo}`,
            `${sonuc.hata ?? ''} Satış kaydedildi. Raporlar → Satışlar ekranından fişi tekrar yazdırabilirsiniz.`,
          );
        }
      } else if (olay === 'yedek:alindi') {
        void tazele();
      } else if (olay === 'kasa:acildi' || olay === 'kasa:kapandi') {
        void tazele();
      } else if (olay === 'uygulama:yenidenBaslatiliyor') {
        setYenidenBasliyor((veri as { neden?: string } | undefined)?.neden ?? 'yeniden-baslatma');
      }
    });
  }, [tazele]);

  if (yenidenBasliyor) return <YenidenBaslatiliyor neden={yenidenBasliyor} />;

  if (baslatmaHatasi) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="kart max-w-lg p-6 text-center">
          <h1 className="mb-2 text-lg font-semibold text-tehlike">Uygulama başlatılamadı</h1>
          <p className="text-sm text-metin-3">{baslatmaHatasi}</p>
          <button type="button" className="tus-birincil mt-4" onClick={() => window.location.reload()}>
            Yeniden Dene
          </button>
        </div>
      </div>
    );
  }

  if (yukleniyor) return <Yukleniyor metin="Uygulama hazırlanıyor…" />;

  return (
    <>
      <Routes>
        {sistem?.kurulumGerekli ? (
          <>
            <Route path="/kurulum" element={<KurulumSayfasi />} />
            <Route path="*" element={<Navigate to="/kurulum" replace />} />
          </>
        ) : !sistem?.oturum ? (
          <>
            <Route path="/giris" element={<GirisSayfasi />} />
            <Route path="*" element={<Navigate to="/giris" replace />} />
          </>
        ) : (
          <Route
            path="*"
            element={
              <OturumKapisi>
                <Kabuk>
                  <SayfaHataSiniri>
                    <Routes>
                      <Route path="/satis" element={<SatisSayfasi />} />
                      <Route path="/iade" element={<IadeSayfasi />} />
                      <Route path="/urunler" element={<UrunlerSayfasi />} />
                      <Route path="/stok" element={<StokSayfasi />} />
                      <Route path="/kampanyalar" element={<KampanyalarSayfasi />} />
                      <Route path="/cari" element={<CariSayfasi />} />
                      <Route path="/kasa" element={<KasaSayfasi />} />
                      <Route path="/yazarkasa" element={<YazarkasaSayfasi />} />
                      <Route path="/raporlar" element={<RaporlarSayfasi />} />
                      <Route path="/ayarlar" element={<AyarlarSayfasi />} />
                      <Route path="*" element={<Navigate to="/satis" replace />} />
                    </Routes>
                  </SayfaHataSiniri>
                </Kabuk>
              </OturumKapisi>
            }
          />
        )}
      </Routes>
      <BildirimKatmani />
      <OnayKatmani />
      <EkranTusTakimi />
    </>
  );
}

/**
 * Sayfa geçişinde hata sınırını sıfırlar: bir ekran çökmüşse başka ekrana
 * gidip dönmek temiz bir deneme başlatır (key = yol).
 */
function SayfaHataSiniri({ children }: { children: React.ReactNode }) {
  const konum = useLocation();
  return <HataSiniri key={konum.pathname}>{children}</HataSiniri>;
}

/**
 * Oturum zaman aşımı (§15.5): belirlenen süre boyunca hiç etkileşim olmazsa
 * kullanıcı otomatik çıkarılır. Satış ekranındaki aktif sepet korunur.
 */
function OturumKapisi({ children }: { children: React.ReactNode }) {
  const sistem = oturumDurumu((s) => s.sistem);
  const cikisYap = oturumDurumu((s) => s.cikisYap);
  const gezin = useNavigate();
  const konum = useLocation();

  const zamanAsimiDk = Number((sistem?.ayarlar as { oturumZamanAsimiDk?: number } | undefined)?.oturumZamanAsimiDk ?? 15);

  useEffect(() => {
    if (zamanAsimiDk <= 0) return;
    let zamanlayici: ReturnType<typeof setTimeout>;

    const sifirla = () => {
      clearTimeout(zamanlayici);
      zamanlayici = setTimeout(() => {
        void cikisYap().then(() => {
          bildir.uyari('Oturum zaman aşımına uğradı', 'Güvenlik için çıkış yapıldı.');
          gezin('/giris');
        });
      }, zamanAsimiDk * 60_000);
    };

    const olaylar: (keyof WindowEventMap)[] = ['keydown', 'mousedown', 'wheel', 'touchstart'];
    for (const olay of olaylar) window.addEventListener(olay, sifirla, { passive: true });
    sifirla();

    return () => {
      clearTimeout(zamanlayici);
      for (const olay of olaylar) window.removeEventListener(olay, sifirla);
    };
  }, [zamanAsimiDk, cikisYap, gezin, konum.pathname]);

  return <>{children}</>;
}

/**
 * Sıfırlama ya da geri yüklemeden sonra tam ekran bekleme. Arkada eski oturum
 * görünmesin: veritabanı kapalıdır, basılan her düğme hata verirdi.
 */
function YenidenBaslatiliyor({ neden }: { neden: string }) {
  const [gecikti, setGecikti] = useState(false);
  useEffect(() => {
    const z = setTimeout(() => setGecikti(true), 12_000);
    return () => clearTimeout(z);
  }, []);
  const baslik =
    neden === 'geri-yukleme' ? 'Yedek geri yüklendi' : neden === 'sifirlama' ? 'Tüm veri sıfırlandı' : 'Program yeniden başlıyor';
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="kart max-w-md p-8 text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-yuzey-3 border-t-vurgu" aria-hidden />
        <h1 className="text-xl font-semibold">{baslik}</h1>
        <p className="mt-2 text-sm text-metin-3">Program kendini yeniden başlatıyor, birkaç saniye sürer.</p>
        {gecikti && (
          <p className="mt-4 rounded-lg bg-uyari-yumusak px-3 py-2 text-sm text-uyari">
            Program kendiliğinden açılmadıysa kapatıp yeniden açın. Veriniz kaydedildi.
          </p>
        )}
      </div>
    </div>
  );
}
