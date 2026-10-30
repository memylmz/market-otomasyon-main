/**
 * Uygulama kabuğu: sol menü + üst durum çubuğu (§10 giriş).
 *
 * Durum çubuğu her an şunları gösterir: aktif kullanıcı, açık kasa, senkron
 * rozeti (🟢/🟡/🔴) + son senkron, lisans uyarısı ve saat.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { goreliZaman, paraFormat, URUN_SURUMU, type Yetki } from '@market/shared';
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
  /** Yalnız POS türü Pavo iken görünür. */
  pavo?: true;
}

const MENU: MenuOgesi[] = [
  // F1 satış ekranında MÜŞTERİ SEÇME kısayoludur; menüye bağlanmaz (§10.3).
  { yol: '/satis', etiket: 'Satış', ikon: '🛒', yetki: 'satis.yap' },
  // İade menüden kaldırıldı — artık Satış ekranının üst barında düğme (bkz. Satis.tsx).
  { yol: '/urunler', etiket: 'Ürünler', ikon: '📦', yetki: 'urun.goruntule' },
  { yol: '/stok', etiket: 'Stok', ikon: '🏷️', yetki: 'stok.goruntule' },
  { yol: '/kampanyalar', etiket: 'Kampanyalar', ikon: '🎯', yetki: 'kampanya.yonet' },
  { yol: '/cari', etiket: 'Cari Hesap', ikon: '📒', yetki: 'cari.goruntule' },
  { yol: '/kasa', etiket: 'Kasa', ikon: '💰', yetki: 'kasa.ac' },
  // Gün sonu ve mali raporlar; kasayı kapatan kişi (kasiyer) de girer.
  { yol: '/yazarkasa', etiket: 'Yazarkasa', ikon: '🧾', yetki: 'kasa.kapat', pavo: true },
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
  // Sol menü daraltılabilir (yalnız simgeler): satış ekranında sepete yer açar. Tercih bu bilgisayarda hatırlanır.
  const [menuDar, setMenuDar] = useState(() => {
    try {
      return localStorage.getItem('kabuk.menuDar') === '1';
    } catch {
      return false;
    }
  });
  const menuyuDegistir = () =>
    setMenuDar((d) => {
      try {
        localStorage.setItem('kabuk.menuDar', d ? '0' : '1');
      } catch {
        /* tercih kaydedilemezse yalnız bu oturumda geçerli */
      }
      return !d;
    });
  const konum = useLocation();
  const [pavoAcik, setPavoAcik] = useState(false);

  // POS türü Ayarlar'dan değişebilir; sayfa değiştikçe tazelenir (tek IPC, ucuz).
  useEffect(() => {
    let iptal = false;
    cagir<{ tur: string }>('pos.durum')
      .then((d) => !iptal && setPavoAcik(d.tur === 'PAVO'))
      .catch(() => !iptal && setPavoAcik(false));
    return () => {
      iptal = true;
    };
  }, [konum.pathname]);

  useEffect(() => {
    const zamanlayici = setInterval(() => setSaat(new Date()), 30_000);
    return () => clearInterval(zamanlayici);
  }, []);

  const senkron = sistem?.senkron;
  const lisans = sistem?.lisans;
  const gorunurMenu = MENU.filter((m) => (!m.yetki || yetkiler.has(m.yetki)) && (!m.pavo || pavoAcik));

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
    /*
     * Diskteki sepet kurtarma noktası da ÇIKIŞTAN ÖNCE silinir. Satış ekranı
     * kaydı 1,2 sn gecikmeyle yazıyor; sepet boşaltılıp hemen çıkış yapılınca
     * bekleyen "sil" işi ekranla birlikte iptal oluyor, geri girişte eski ürün
     * "kurtarılan sepet" diye geri geliyordu. Çıkıştan sonra yapılamaz
     * (oturum kapanınca kanal yetki ister).
     */
    await cagir('satis.sepetleriUnut').catch(() => {});
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
      <nav className={`flex ${menuDar ? 'w-14' : 'w-52'} shrink-0 flex-col border-r border-cizgi bg-yuzey`} aria-label="Ana menü">
        <div className={`border-b border-cizgi px-4 py-3 ${menuDar ? 'hidden' : ''}`}>
          <p className="text-sm font-semibold text-vurgu">AKYSOFTMARKETV1</p>
          {sistem?.isletmeAdi && (
            <p className="truncate text-xs font-medium text-metin-2" title={sistem.isletmeAdi}>
              {sistem.isletmeAdi}
            </p>
          )}
          <p className="text-xs text-metin-4">v{sistem?.surum ?? URUN_SURUMU}</p>
          {sistem?.gelistirme && (
            <p
              className="mt-1 rounded bg-tehlike-yumusak px-1.5 py-0.5 text-[11px] font-semibold text-tehlike"
              title="Proje klasöründen çalışan deneme kopyası. Verisi kurulu programdan tamamen ayrıdır."
            >
              DEMO — kurulu program değil
            </p>
          )}
        </div>

        <ul className="flex-1 overflow-y-auto py-2">
          {gorunurMenu.map((oge) => (
            <li key={oge.yol}>
              <NavLink
                to={oge.yol}
                title={oge.etiket}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                    isActive
                      ? 'border-l-2 border-vurgu bg-yuzey-2 font-medium text-vurgu'
                      : 'border-l-2 border-transparent text-metin-2 hover:bg-yuzey-2'
                  }`
                }
              >
                <span aria-hidden="true">{oge.ikon}</span>
                {!menuDar && <span className="flex-1">{oge.etiket}</span>}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="border-t border-cizgi p-3">
          <button type="button" className="tus-ikincil w-full text-sm" title="Çıkış Yap" onClick={() => void cikisYapmayiDene()}>
            {menuDar ? '⏻' : 'Çıkış Yap'}
          </button>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-4 border-b border-cizgi bg-yuzey px-4 py-2 text-sm">
          <button
            type="button"
            onClick={menuyuDegistir}
            className="rounded px-2 py-1 text-base hover:bg-yuzey-2"
            title={menuDar ? 'Menüyü aç' : 'Menüyü daralt'}
            aria-label={menuDar ? 'Menüyü aç' : 'Menüyü daralt'}
          >
            ☰
          </button>
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

          <UyariRozetleri />

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

/**
 * Durum çubuğundaki uyarılar: alınmamış gün sonu (Z) ve tarihi geçen/yaklaşan
 * ürünler. Sekmeye bakmayan da görsün diye burada. Tıklanınca ilgili ekran
 * açılır; hiçbir işlemi engellemez. Sayfa değiştikçe ve 15 dakikada bir tazelenir.
 */
function UyariRozetleri() {
  const git = useNavigate();
  const konum = useLocation();
  const [z, setZ] = useState<{ pavo: boolean; oncekiEksikGunler: string[] } | null>(null);
  const [skt, setSkt] = useState<{ gecmis: number; yaklasan: number }>({ gecmis: 0, yaklasan: 0 });
  const [tik, setTik] = useState(0);

  useEffect(() => {
    const zamanlayici = setInterval(() => setTik((t) => t + 1), 15 * 60_000);
    return () => clearInterval(zamanlayici);
  }, []);

  useEffect(() => {
    let iptal = false;
    cagir<{ pavo: boolean; oncekiEksikGunler: string[] }>('pavo.zDurumu')
      .then((d) => !iptal && setZ(d))
      .catch(() => !iptal && setZ(null));
    cagir<{ kalan_gun: number }[]>('stok.sktUyarilari', { gun: 7 })
      .then(
        (liste) =>
          !iptal &&
          setSkt({ gecmis: liste.filter((s) => s.kalan_gun < 0).length, yaklasan: liste.filter((s) => s.kalan_gun >= 0).length }),
      )
      .catch(() => {
        /* durum çubuğu hatası akışı bozmamalı */
      });
    return () => {
      iptal = true;
    };
  }, [konum.pathname, tik]);

  const eksikZ = z?.pavo ? z.oncekiEksikGunler : [];
  return (
    <>
      {eksikZ.length > 0 && (
        <button
          type="button"
          onClick={() => git('/yazarkasa')}
          title="Pavo'dan satış yapılan bu günlerin gün sonu (Z) raporu alınmamış. Z yasal olarak her gün alınmalı."
          className="rounded bg-tehlike px-2 py-1 text-xs font-semibold text-white hover:opacity-90"
        >
          ⚠ Z alınmadı: {eksikZ.map((g) => g.split('-').reverse().slice(0, 2).join('.')).join(', ')}
        </button>
      )}
      {(skt.gecmis > 0 || skt.yaklasan > 0) && (
        <button
          type="button"
          onClick={() => git('/stok', { state: { sekme: 'skt' } })}
          title="Stok → SKT Takibi. Tarihler mal kabulde girilen partilerden tahmin edilir."
          className={`rounded px-2 py-1 text-xs font-semibold ${
            skt.gecmis > 0 ? 'bg-tehlike-yumusak text-tehlike' : 'bg-uyari-yumusak text-uyari'
          } hover:opacity-90`}
        >
          ⏳ SKT: {skt.gecmis > 0 ? `${skt.gecmis} geçmiş` : ''}
          {skt.gecmis > 0 && skt.yaklasan > 0 ? ' · ' : ''}
          {skt.yaklasan > 0 ? `${skt.yaklasan} yaklaşıyor` : ''}
        </button>
      )}
    </>
  );
}

function KasaGostergesi() {
  const kasaOturumId = oturumDurumu((s) => s.sistem?.oturum?.kasaOturumId);
  const git = useNavigate();
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

  /*
   * "Kasa kapalı" tek tıkla kasa açılışına götürür: menüden Kasa'ya gidip
   * "Kasa Aç"ı aramak, satışa başlamak isteyen kasiyeri bekletiyordu.
   */
  if (!kasaOturumId)
    return (
      <button
        type="button"
        className="rounded-full transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-vurgu"
        onClick={() => git('/kasa?ac=1')}
        title="Kasayı açmak için tıklayın"
      >
        <Rozet tur="uyari">Kasa kapalı — aç</Rozet>
      </button>
    );
  return (
    <span className="flex items-center gap-2">
      <Rozet tur="basari">Kasa açık</Rozet>
      {beklenen !== null && <span className="font-mono text-xs text-metin-3">{paraFormat(beklenen)}</span>}
    </span>
  );
}
