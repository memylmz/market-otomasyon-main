/** Giriş / kilit ekranı (§10.2) — tamamen çevrimdışı doğrulama. */

import { useEffect, useRef, useState } from 'react';
import { Kisayol } from '../bilesen/temel';
import { hatayiBildir } from '../durum/bildirim';
import { oturumDurumu } from '../durum/oturum';
import { cagir } from '../kopru';

interface HizliKullanici {
  id: string;
  ad: string;
  kullanici_adi: string;
  rol: string;
}

export function GirisSayfasi() {
  const girisYap = oturumDurumu((s) => s.girisYap);
  const [kullaniciAdi, setKullaniciAdi] = useState('');
  const [parola, setParola] = useState('');
  const [yontem, setYontem] = useState<'SIFRE' | 'PIN'>('SIFRE');
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [hizliListe, setHizliListe] = useState<HizliKullanici[]>([]);
  const parolaAlani = useRef<HTMLInputElement>(null);
  const kullaniciAlani = useRef<HTMLInputElement>(null);

  useEffect(() => {
    cagir<HizliKullanici[]>('oturum.hizliKullanicilar')
      .then(setHizliListe)
      .catch(() => setHizliListe([]));
    kullaniciAlani.current?.focus();
  }, []);

  const gonder = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!kullaniciAdi.trim() || !parola) return;
    setGonderiliyor(true);
    setHata(null);
    try {
      await girisYap(kullaniciAdi.trim(), parola, yontem);
    } catch (h) {
      const mesaj = h instanceof Error ? h.message : String(h);
      setHata(mesaj);
      setParola('');
      parolaAlani.current?.focus();
      hatayiBildir(h);
    } finally {
      setGonderiliyor(false);
    }
  };

  const hizliSec = (kullanici: HizliKullanici) => {
    setKullaniciAdi(kullanici.kullanici_adi);
    setYontem('PIN');
    setParola('');
    setTimeout(() => parolaAlani.current?.focus(), 10);
  };

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-zemin to-zemin p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-vurgu">Market Otomasyon</h1>
          <p className="mt-1 text-sm text-metin-3">Devam etmek için giriş yapın</p>
        </div>

        {hizliListe.length > 0 && (
          <div className="mb-4">
            <p className="etiket">Hızlı kullanıcı değiştirme (vardiya)</p>
            <div className="flex flex-wrap gap-2">
              {hizliListe.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  className={`tus-ikincil px-3 py-1.5 text-sm ${kullaniciAdi === k.kullanici_adi ? 'border-vurgu text-vurgu' : ''}`}
                  onClick={() => hizliSec(k)}
                >
                  {k.ad}
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={gonder} className="kart space-y-4 p-6">
          <label className="block">
            <span className="etiket">Kullanıcı adı</span>
            <input
              ref={kullaniciAlani}
              type="text"
              className="alan"
              value={kullaniciAdi}
              onChange={(e) => setKullaniciAdi(e.target.value)}
              autoComplete="username"
              spellCheck={false}
            />
          </label>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="etiket mb-0">{yontem === 'PIN' ? 'PIN' : 'Şifre'}</span>
              <button
                type="button"
                className="text-xs text-vurgu hover:underline"
                onClick={() => {
                  setYontem((y) => (y === 'PIN' ? 'SIFRE' : 'PIN'));
                  setParola('');
                }}
              >
                {yontem === 'PIN' ? 'Şifre ile gir' : 'PIN ile gir'}
              </button>
            </div>
            <input
              ref={parolaAlani}
              type="password"
              inputMode={yontem === 'PIN' ? 'numeric' : 'text'}
              className="alan text-center text-lg tracking-widest"
              value={parola}
              onChange={(e) => setParola(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {hata && (
            <p className="rounded border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm text-tehlike" role="alert">
              {hata}
            </p>
          )}

          <button type="submit" className="tus-birincil w-full py-3" disabled={gonderiliyor || !kullaniciAdi || !parola}>
            {gonderiliyor ? 'Kontrol ediliyor…' : 'Giriş Yap'} <Kisayol>Enter</Kisayol>
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-metin-4">
          Giriş bilgileri bu bilgisayarda saklanır; internet bağlantısı gerekmez.
        </p>
      </div>
    </div>
  );
}
