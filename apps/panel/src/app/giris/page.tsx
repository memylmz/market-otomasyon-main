'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { girisYap, kaliciOturumAyarla, kaliciOturumMu } from '@/lib/api';

export default function GirisSayfasi() {
  const yonlendir = useRouter();
  const [kullaniciAdi, setKullaniciAdi] = useState('');
  const [sifre, setSifre] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  /*
   * Oturum bu cihazda açık kalsın mı.
   *
   * Varsayılan AÇIK. Panel telefona kurulan bir PWA ve işletim sistemi sayfayı
   * sık sık bellekten atıyor; oturum yalnız sekmede yaşarken kullanıcı her
   * dönüşünde giriş ekranıyla karşılaşıyordu. Ortak bir bilgisayarda kapatılır,
   * o zaman oturum sekme kapanınca düşer (§15.5).
   *
   * Başlangıç değeri okunurken `useState` başlatıcısı kullanılır: sunucu
   * tarafında `localStorage` yoktur, render sırasında okumak sayfayı düşürür.
   */
  const [kalici, setKalici] = useState(true);

  useEffect(() => setKalici(kaliciOturumMu()), []);

  const gonder = async (olay: React.FormEvent) => {
    olay.preventDefault();
    setGonderiliyor(true);
    setHata(null);
    try {
      // Tercih girişten ÖNCE yazılır: token'ın hangi depoya yazılacağını belirler.
      kaliciOturumAyarla(kalici);
      await girisYap(kullaniciAdi.trim(), sifre);
      yonlendir.replace('/');
    } catch (h) {
      setHata(h instanceof Error ? h.message : 'Giriş yapılamadı.');
      setSifre('');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-vurgu">Market Otomasyon</h1>
          <p className="mt-1 text-sm text-metin-3">Yönetim Paneli</p>
        </div>

        <form onSubmit={gonder} className="kart space-y-4 p-6">
          <label className="block">
            <span className="mb-1 block text-sm text-metin-2">Kullanıcı adı</span>
            <input
              className="alan"
              value={kullaniciAdi}
              onChange={(e) => setKullaniciAdi(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-metin-2">Şifre</span>
            <input
              type="password"
              className="alan"
              value={sifre}
              onChange={(e) => setSifre(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-metin-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-vurgu"
              checked={kalici}
              onChange={(e) => setKalici(e.target.checked)}
            />
            Bu cihazda oturumum açık kalsın
          </label>
          {!kalici && (
            <p className="text-xs text-metin-4">
              Oturum yalnız bu sekmede yaşar; sekmeyi kapatınca çıkış yapılır. Ortak kullanılan bilgisayarlar için.
            </p>
          )}

          {hata && (
            <p className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm text-metin" role="alert">
              {hata}
            </p>
          )}

          <button type="submit" className="tus-birincil w-full py-3" disabled={gonderiliyor}>
            {gonderiliyor ? 'Kontrol ediliyor…' : 'Giriş Yap'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-metin-4">
          Panel yalnız izleme ve üst düzey yönetim içindir. Kasa işlemleri masaüstü uygulamasından yapılır.
        </p>
        {/*
          Kasada PIN'le giren yönetici, panelde aynı PIN'i deneyip
          "şifre hatalı" alıyordu. 4 haneli PIN internete açık bir panel için
          kimlik bilgisi değildir; bu ayrım burada açıkça söylenir.
        */}
        <p className="mt-2 text-center text-xs text-metin-4">
          Kasaya <strong>PIN</strong> ile, panele <strong>şifre</strong> ile girilir. Şifrenizi bilmiyorsanız panele girebilen bir
          yönetici, Personel ekranından size yeni şifre atayabilir.
        </p>
      </div>
    </div>
  );
}
