/** İlk kurulum sihirbazı (§12.1). */

import { useEffect, useState } from 'react';
import { KDV_ORANLARI, tarihSaatFormat } from '@market/shared';
import { Alan, Kisayol } from '../bilesen/temel';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { oturumDurumu } from '../durum/oturum';
import { cagir } from '../kopru';

type Adim = 'isletme' | 'yonetici' | 'ozet';

export function KurulumSayfasi() {
  /**
   * İlk ekran: yeni kurulum mu, yedekten geri yükleme mi? Bilgisayar değişince
   * ya da veri sıfırlanınca program bu ekranla açılır; eskiden geri yüklemek
   * için önce sahte bir işletme açmak gerekiyordu.
   */
  const [mod, setMod] = useState<'secim' | 'yeni' | 'geri'>('secim');
  if (mod === 'secim') return <BaslangicSecimi onSec={setMod} />;
  if (mod === 'geri') return <KurulumdanGeriYukle onGeri={() => setMod('secim')} />;
  return <YeniKurulum onGeri={() => setMod('secim')} />;
}

function YeniKurulum({ onGeri }: { onGeri: () => void }) {
  const tazele = oturumDurumu((s) => s.tazele);
  const [adim, setAdim] = useState<Adim>('isletme');
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const [isletme, setIsletme] = useState({ ad: '', adres: '', telefon: '', vergiNo: '', varsayilanKdv: 20 });
  const [yonetici, setYonetici] = useState({ ad: '', kullaniciAdi: '', sifre: '', sifreTekrar: '', pin: '' });

  const isletmeGecerli = isletme.ad.trim().length >= 2;
  const yoneticiGecerli =
    yonetici.ad.trim().length >= 2 &&
    yonetici.kullaniciAdi.trim().length >= 3 &&
    yonetici.sifre.length >= 8 &&
    yonetici.sifre === yonetici.sifreTekrar &&
    (yonetici.pin === '' || /^\d{4,8}$/.test(yonetici.pin));

  const tamamla = async () => {
    setGonderiliyor(true);
    try {
      await cagir('kurulum.tamamla', {
        isletmeAdi: isletme.ad.trim(),
        adres: isletme.adres.trim() || undefined,
        telefon: isletme.telefon.trim() || undefined,
        vergiNo: isletme.vergiNo.trim() || undefined,
        varsayilanKdv: isletme.varsayilanKdv,
        yonetici: {
          ad: yonetici.ad.trim(),
          kullaniciAdi: yonetici.kullaniciAdi.trim(),
          sifre: yonetici.sifre,
          pin: yonetici.pin || undefined,
        },
      });
      bildir.basari('Kurulum tamamlandı', 'Şimdi oluşturduğunuz hesapla giriş yapabilirsiniz.');
      await tazele();
    } catch (hata) {
      hatayiBildir(hata, 'Kurulum');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-gradient-to-br from-zemin to-zemin p-6">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-vurgu">Kuruluma Hoş Geldiniz</h1>
          <p className="mt-1 text-sm text-metin-3">Birkaç adımda sisteminizi hazırlayalım.</p>
          <button type="button" className="mt-2 text-sm text-metin-3 underline hover:text-metin" onClick={onGeri}>
            ← Başa dön
          </button>
        </div>

        <ol className="mb-4 flex justify-center gap-2 text-xs">
          {(['isletme', 'yonetici', 'ozet'] as Adim[]).map((a, i) => (
            <li
              key={a}
              className={`rounded-full px-3 py-1 ${adim === a ? 'bg-vurgu text-vurgu-uzeri' : 'bg-yuzey-2 text-metin-3'}`}
            >
              {i + 1}. {a === 'isletme' ? 'İşletme' : a === 'yonetici' ? 'Yönetici' : 'Özet'}
            </li>
          ))}
        </ol>

        <div className="kart space-y-4 p-6">
          {adim === 'isletme' && (
            <>
              <Alan etiket="İşletme adı *" ipucu="Fişin üstünde bu isim yazar.">
                <input
                  className="alan"
                  value={isletme.ad}
                  onChange={(e) => setIsletme({ ...isletme, ad: e.target.value })}
                  autoFocus
                />
              </Alan>
              <Alan etiket="Adres">
                <input
                  className="alan"
                  value={isletme.adres}
                  onChange={(e) => setIsletme({ ...isletme, adres: e.target.value })}
                />
              </Alan>
              <div className="grid grid-cols-2 gap-3">
                <Alan etiket="Telefon">
                  <input
                    className="alan"
                    value={isletme.telefon}
                    onChange={(e) => setIsletme({ ...isletme, telefon: e.target.value })}
                  />
                </Alan>
                <Alan etiket="Vergi no">
                  <input
                    className="alan"
                    value={isletme.vergiNo}
                    onChange={(e) => setIsletme({ ...isletme, vergiNo: e.target.value })}
                  />
                </Alan>
              </div>
              <Alan
                etiket="Varsayılan KDV oranı"
                ipucu="Ürün bazında ayrıca değiştirilebilir. Kesin sınıflandırma için mali müşavirinize danışın."
              >
                <select
                  className="alan"
                  value={isletme.varsayilanKdv}
                  onChange={(e) => setIsletme({ ...isletme, varsayilanKdv: Number(e.target.value) })}
                >
                  {KDV_ORANLARI.map((oran) => (
                    <option key={oran} value={oran}>
                      %{oran}
                    </option>
                  ))}
                </select>
              </Alan>
              <button
                type="button"
                className="tus-birincil w-full"
                disabled={!isletmeGecerli}
                onClick={() => setAdim('yonetici')}
              >
                Devam
              </button>
            </>
          )}

          {adim === 'yonetici' && (
            <>
              <Alan etiket="Ad soyad *">
                <input
                  className="alan"
                  value={yonetici.ad}
                  onChange={(e) => setYonetici({ ...yonetici, ad: e.target.value })}
                  autoFocus
                />
              </Alan>
              <Alan etiket="Kullanıcı adı *" ipucu="En az 3 karakter; harf, rakam, nokta ve tire kullanılabilir.">
                <input
                  className="alan"
                  value={yonetici.kullaniciAdi}
                  onChange={(e) => setYonetici({ ...yonetici, kullaniciAdi: e.target.value })}
                  spellCheck={false}
                />
              </Alan>
              <Alan etiket="Şifre *" ipucu="En az 8 karakter, en az bir harf ve bir rakam içermeli.">
                <input
                  type="password"
                  className="alan"
                  value={yonetici.sifre}
                  onChange={(e) => setYonetici({ ...yonetici, sifre: e.target.value })}
                />
              </Alan>
              <Alan etiket="Şifre tekrar *">
                <input
                  type="password"
                  className="alan"
                  value={yonetici.sifreTekrar}
                  onChange={(e) => setYonetici({ ...yonetici, sifreTekrar: e.target.value })}
                />
              </Alan>
              {yonetici.sifreTekrar && yonetici.sifre !== yonetici.sifreTekrar && (
                <p className="text-sm text-tehlike">Şifreler eşleşmiyor.</p>
              )}
              <Alan etiket="Hızlı giriş PIN'i (isteğe bağlı)" ipucu="4-8 hane. Vardiya değişiminde hızlı giriş için kullanılır.">
                <input
                  type="password"
                  inputMode="numeric"
                  className="alan"
                  value={yonetici.pin}
                  onChange={(e) => setYonetici({ ...yonetici, pin: e.target.value.replace(/\D/g, '').slice(0, 8) })}
                />
              </Alan>
              <div className="flex gap-2">
                <button type="button" className="tus-ikincil flex-1" onClick={() => setAdim('isletme')}>
                  Geri
                </button>
                <button type="button" className="tus-birincil flex-1" disabled={!yoneticiGecerli} onClick={() => setAdim('ozet')}>
                  Devam
                </button>
              </div>
            </>
          )}

          {adim === 'ozet' && (
            <>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-metin-3">İşletme</dt>
                  <dd className="font-medium">{isletme.ad}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-metin-3">Varsayılan KDV</dt>
                  <dd>%{isletme.varsayilanKdv}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-metin-3">Yönetici</dt>
                  <dd className="font-medium">
                    {yonetici.ad} ({yonetici.kullaniciAdi})
                  </dd>
                </div>
              </dl>

              <div className="rounded border border-bilgi-cizgi bg-bilgi-yumusak p-3 text-xs text-bilgi">
                <p className="font-medium">Kurulumdan sonra yapılabilecekler:</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  <li>Ayarlar → Yazıcı: fiş yazıcısı tanımlama ve test fişi</li>
                  <li>Ürünler → İçe aktar: CSV/Excel ile katalog yükleme</li>
                  <li>Ayarlar → Senkron: bulut hesabı bağlama ve cihaz aktivasyonu</li>
                  <li>Kasa → Açılış: günün ilk kasa açılışı</li>
                </ul>
              </div>

              <p className="text-xs text-metin-4">
                ⚠️ Yasal uyarı: Bu yazılım bir operasyon/stok otomasyonudur. Nihai tüketiciye kesilecek yasal satış belgesi GİB
                onaylı ÖKC (yazarkasa) cihazından düzenlenmelidir.
              </p>

              <div className="flex gap-2">
                <button type="button" className="tus-ikincil flex-1" onClick={() => setAdim('yonetici')}>
                  Geri
                </button>
                <button type="button" className="tus-birincil flex-1" disabled={gonderiliyor} onClick={tamamla}>
                  {gonderiliyor ? 'Kaydediliyor…' : 'Kurulumu Tamamla'} <Kisayol>Enter</Kisayol>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BaslangicSecimi({ onSec }: { onSec: (m: 'yeni' | 'geri') => void }) {
  const secenekler = [
    {
      mod: 'yeni' as const,
      ikon: '🏪',
      baslik: 'Yeni market kur',
      aciklama: 'İlk kez kuruyorsanız. İşletme bilgilerini ve yönetici hesabını oluşturursunuz.',
    },
    {
      mod: 'geri' as const,
      ikon: '♻️',
      baslik: 'Yedekten geri yükle',
      aciklama:
        'Bilgisayar değiştiyse ya da veriler sıfırlandıysa. Satışlar, stok, veresiye, kullanıcılar olduğu gibi geri gelir.',
    },
  ];
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-2xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-vurgu">AKYSOFTMARKETV1'e Hoş Geldiniz</h1>
          <p className="mt-1 text-sm text-metin-3">Nasıl başlamak istersiniz?</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {secenekler.map((s) => (
            <button
              key={s.mod}
              type="button"
              onClick={() => onSec(s.mod)}
              className="kart flex flex-col gap-2 p-6 text-left transition-colors hover:border-vurgu hover:bg-vurgu-yumusak"
            >
              <span className="text-4xl" aria-hidden>
                {s.ikon}
              </span>
              <span className="text-lg font-semibold">{s.baslik}</span>
              <span className="text-sm text-metin-3">{s.aciklama}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface YedekSatiri {
  dosya: string;
  yol: string;
  boyut: number;
  zaman: string;
  sifreli: boolean;
}

/** Kurulum ekranından geri yükleme: bu bilgisayardaki yedekler ya da başka yerden (USB, OneDrive) bir dosya. */
function KurulumdanGeriYukle({ onGeri }: { onGeri: () => void }) {
  const [yedekler, setYedekler] = useState<YedekSatiri[] | null>(null);
  const [secili, setSecili] = useState<{ yol: string; dosya: string } | null>(null);
  const [calisiyor, setCalisiyor] = useState(false);

  useEffect(() => {
    cagir<YedekSatiri[]>('kurulum.yedekler')
      .then(setYedekler)
      .catch((hata: unknown) => {
        setYedekler([]);
        hatayiBildir(hata, 'Yedek listesi');
      });
  }, []);

  const dosyaSec = async () => {
    try {
      const s = await cagir<{ yol: string | null; dosya?: string; saglam?: boolean; detay?: string }>('yedek.dosyaSec');
      if (!s.yol) return;
      if (!s.saglam) {
        bildir.hata('Bu dosya geri yüklenemez', s.detay ?? 'Geçerli bir yedek değil.');
        return;
      }
      setSecili({ yol: s.yol, dosya: s.dosya ?? s.yol });
    } catch (hata) {
      hatayiBildir(hata, 'Dosya seçimi');
    }
  };

  const geriYukle = async () => {
    if (!secili) return;
    setCalisiyor(true);
    try {
      // Başarılıysa program kendini yeniden başlatır (tam ekran mesaj gelir).
      await cagir('kurulum.geriYukle', { yol: secili.yol });
    } catch (hata) {
      hatayiBildir(hata, 'Geri yükleme');
      setCalisiyor(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-2xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-vurgu">Yedekten Geri Yükle</h1>
          <p className="mt-1 text-sm text-metin-3">Geri yüklenecek yedeği seçin. En üstteki en yenisidir.</p>
          <button type="button" className="mt-2 text-sm text-metin-3 underline hover:text-metin" onClick={onGeri}>
            ← Başa dön
          </button>
        </div>

        <div className="kart grid gap-4 p-6">
          <div>
            <h2 className="mb-2 font-semibold">Bu bilgisayardaki yedekler</h2>
            {yedekler === null ? (
              <p className="text-sm text-metin-3">Yükleniyor…</p>
            ) : yedekler.length === 0 ? (
              <p className="text-sm text-metin-3">
                Bu bilgisayarda yedek yok. Yedeğiniz USB'de ya da OneDrive'daysa aşağıdan seçin.
              </p>
            ) : (
              <ul className="max-h-72 divide-y divide-cizgi overflow-auto rounded-lg border border-cizgi">
                {yedekler.map((y) => (
                  <li key={y.yol}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-yuzey-2">
                      <input type="radio" name="yedek" checked={secili?.yol === y.yol} onChange={() => setSecili(y)} />
                      <span className="flex-1">
                        <span className="block text-sm font-medium">{tarihSaatFormat(y.zaman)}</span>
                        <span className="block font-mono text-xs text-metin-3">{y.dosya}</span>
                      </span>
                      <span className="text-xs text-metin-3">{(y.boyut / 1024 / 1024).toFixed(2)} MB</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-cizgi pt-4">
            <button type="button" className="tus-ikincil" onClick={() => void dosyaSec()}>
              Başka Yerden Seç (USB, OneDrive)…
            </button>
            {secili && !yedekler?.some((y) => y.yol === secili.yol) && (
              <span className="font-mono text-xs text-metin-2">{secili.dosya}</span>
            )}
          </div>

          <button type="button" className="tus-birincil py-3" disabled={!secili || calisiyor} onClick={() => void geriYukle()}>
            {calisiyor ? 'Geri yükleniyor…' : secili ? 'Seçili Yedeği Geri Yükle' : 'Önce bir yedek seçin'}
          </button>
          <p className="text-xs text-metin-3">
            Geri yüklemeden sonra program kendini yeniden başlatır ve yedekteki kullanıcı adı ve şifreyle giriş yaparsınız.
          </p>
        </div>
      </div>
    </div>
  );
}
