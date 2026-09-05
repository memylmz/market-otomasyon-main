/**
 * Uygulama kabuğu: sol menü + üst durum çubuğu (§10 giriş).
 *
 * Durum çubuğu her an şunları gösterir: aktif kullanıcı, açık kasa, senkron
 * rozeti (🟢/🟡/🔴) + son senkron, lisans uyarısı ve saat.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { goreliZaman, paraFormat, type Yetki } from '@market/shared';
import { cagir } from '../kopru';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { oturumDurumu } from '../durum/oturum';
import { sepetDurumu } from '../durum/sepet';
import { Rozet } from './temel';

interface MenuOgesi {
  yol: string;
  etiket: string;
  ikon: string;
  kisayol?: string;
  yetki?: Yetki;
}

const MENU: MenuOgesi[] = [
  // F1 satış ekranında MÜŞTERİ SEÇME kısayoludur; menüye bağlanmaz (§10.3).
  { yol: '/satis', etiket: 'Satış', ikon: '🛒', yetki: 'satis.yap' },
  { yol: '/iade', etiket: 'İade', ikon: '↩️', yetki: 'satis.iade' },
  { yol: '/urunler', etiket: 'Ürünler', ikon: '📦', yetki: 'urun.goruntule' },
  { yol: '/stok', etiket: 'Stok', ikon: '🏷️', yetki: 'stok.goruntule' },
  { yol: '/cari', etiket: 'Cari Hesap', ikon: '📒', yetki: 'cari.goruntule' },
  { yol: '/kasa', etiket: 'Kasa', ikon: '💰', yetki: 'kasa.ac' },
  { yol: '/raporlar', etiket: 'Raporlar', ikon: '📊', yetki: 'rapor.goruntule' },
  { yol: '/ayarlar', etiket: 'Ayarlar', ikon: '⚙️', yetki: 'ayar.yonet' },
];

export function Kabuk({ children }: { children: ReactNode }) {
  const sistem = oturumDurumu((s) => s.sistem);
  const yetkiler = oturumDurumu((s) => s.yetkiler);
  const tazele = oturumDurumu((s) => s.tazele);
  const cikis = oturumDurumu((s) => s.cikisYap);
  const gezin = useNavigate();
  const [saat, setSaat] = useState(() => new Date());
  const [senkronCalisiyor, setSenkronCalisiyor] = useState(false);

  useEffect(() => {
    const zamanlayici = setInterval(() => setSaat(new Date()), 30_000);
    return () => clearInterval(zamanlayici);
  }, []);

  const senkron = sistem?.senkron;
  const lisans = sistem?.lisans;
  const gorunurMenu = MENU.filter((m) => !m.yetki || yetkiler.has(m.yetki));

  /**
   * Çıkış koruması (§10.3).
   *
   * Dolu sepetle çıkmak, sonraki kullanıcının ekranında yabancı bir sepet
   * bırakır ve yanlış kişiye satış yapılmasına yol açar. Bu yüzden dolu
   * sepet varken çıkış ENGELLENİR; boşsa sepet durumu sıfırlanır ki devir
   * temiz olsun.
   */
  const cikisYapmayiDene = async () => {
    const s = sepetDurumu.getState();
    const dolular = [
      ...(s.satirlar.length > 0 ? [{ ad: s.sepetAdi, kalem: s.satirlar.length }] : []),
      ...s.bekleyenler.filter((b) => b.satirlar.length > 0).map((b) => ({ ad: b.ad, kalem: b.satirlar.length })),
    ];

    if (dolular.length > 0) {
      bildir.uyari(
        'Dolu sepetle çıkış yapılamaz',
        `${dolular.map((d) => `${d.ad}: ${d.kalem} kalem`).join(' · ')} — satışı tamamlayın ya da sepeti temizleyin.`,
      );
      return;
    }

    sepetDurumu.getState().tumunuSifirla();
    await cikis();
    gezin('/giris');
  };

  const senkronuCalistir = async () => {
    setSenkronCalisiyor(true);
    try {
      const sonuc = await cagir<{ basarili: boolean; gonderilen: number; cekilen: number; hata?: string }>('senkron.simdi');
      if (sonuc.basarili) {
        bildir.basari('Senkron tamamlandı', `${sonuc.gonderilen} kayıt gönderildi, ${sonuc.cekilen} kayıt alındı.`);
      } else {
        bildir.uyari('Senkron yapılamadı', sonuc.hata);
      }
      await tazele();
    } catch (hata) {
      hatayiBildir(hata, 'Senkron');
    } finally {
      setSenkronCalisiyor(false);
    }
  };

  return (
    <div className="flex h-full">
      <nav className="flex w-52 shrink-0 flex-col border-r border-cizgi bg-yuzey" aria-label="Ana menü">
        <div className="border-b border-cizgi px-4 py-3">
          <p className="text-sm font-semibold text-vurgu">Market Otomasyon</p>
          <p className="text-xs text-metin-4">v{sistem?.surum ?? '2.0.0'}</p>
        </div>

        <ul className="flex-1 overflow-y-auto py-2">
          {gorunurMenu.map((oge) => (
            <li key={oge.yol}>
              <NavLink
                to={oge.yol}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                    isActive
                      ? 'border-l-2 border-vurgu bg-yuzey-2 font-medium text-vurgu'
                      : 'border-l-2 border-transparent text-metin-2 hover:bg-yuzey-2'
                  }`
                }
              >
                <span aria-hidden="true">{oge.ikon}</span>
                <span className="flex-1">{oge.etiket}</span>
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="border-t border-cizgi p-3">
          <button type="button" className="tus-ikincil w-full text-sm" onClick={() => void cikisYapmayiDene()}>
            Çıkış Yap
          </button>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-cizgi bg-yuzey px-4 py-2 text-sm">
          <span className="font-medium">
            {sistem?.oturum?.ad ?? '—'}
            <span className="ml-1 text-xs text-metin-4">({sistem?.oturum?.rol ?? ''})</span>
          </span>

          <KasaGostergesi />

          <button
            type="button"
            onClick={senkronuCalistir}
            disabled={senkronCalisiyor || !yetkiler.has('senkron.tetikle')}
            title={senkron?.aciklama}
            className="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-yuzey-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span aria-hidden="true">{senkronCalisiyor ? '⏳' : (senkron?.rozet ?? '⚪')}</span>
            <span className="text-xs text-metin-3">
              {senkron?.bekleyenOlay ? `${senkron.bekleyenOlay} bekliyor` : 'Senkron'}
              {senkron?.sonSenkron ? ` · ${goreliZaman(senkron.sonSenkron)}` : ''}
            </span>
          </button>

          {lisans?.mesaj && (
            <span className="truncate" title={lisans.mesaj}>
              <Rozet tur={lisans.yonetimKisitli ? 'tehlike' : 'uyari'}>Lisans</Rozet>
            </span>
          )}

          <span className="ml-auto font-mono text-metin-3">
            {saat.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

function KasaGostergesi() {
  const kasaOturumId = oturumDurumu((s) => s.sistem?.oturum?.kasaOturumId);
  const [beklenen, setBeklenen] = useState<number | null>(null);

  useEffect(() => {
    if (!kasaOturumId) {
      setBeklenen(null);
      return;
    }
    let iptal = false;
    const yukle = async () => {
      try {
        const durum = await cagir<{ ozet: { beklenen_nakit: number } | null }>('kasa.durum');
        if (!iptal) setBeklenen(durum.ozet?.beklenen_nakit ?? null);
      } catch {
        /* durum çubuğu hatası akışı bozmamalı */
      }
    };
    void yukle();
    const zamanlayici = setInterval(yukle, 30_000);
    return () => {
      iptal = true;
      clearInterval(zamanlayici);
    };
  }, [kasaOturumId]);

  if (!kasaOturumId) return <Rozet tur="uyari">Kasa kapalı</Rozet>;
  return (
    <span className="flex items-center gap-2">
      <Rozet tur="basari">Kasa açık</Rozet>
      {beklenen !== null && <span className="font-mono text-xs text-metin-3">{paraFormat(beklenen)}</span>}
    </span>
  );
}
