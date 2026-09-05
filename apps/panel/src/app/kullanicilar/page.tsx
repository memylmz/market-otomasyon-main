/**
 * Personel (kasa kullanıcıları) ve yetki yönetimi (§10.12, §11.8).
 * Buradan tanımlanan hesaplar senkronla kasalara iner; kasada PIN ile giriş yapılır.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  etkinYetkiler,
  goreliZaman,
  ROL,
  ROL_ETIKETI,
  ROL_YETKILERI,
  yetkiGecerliMi,
  YETKI_ETIKETLERI,
  YETKILER,
  type Rol,
  type Yetki,
} from '@market/shared';
import { BosDurum, HataKutusu, Kabuk, Modal, Rozet, Yukleniyor } from '@/bilesen/kabuk';
import { api, kullaniciyiOku, uclar } from '@/lib/api';
import { useVeri } from '@/lib/kanca';

interface Personel {
  id: string;
  ad: string;
  kullanici_adi: string;
  rol: Rol;
  /** SQLite'tan 0/1 gelir; JSON köprüsünden boolean da gelebilir. */
  aktif_mi: number | boolean;
  /** Veritabanında JSON METİN olarak tutulur. */
  ek_yetkiler: string | string[] | null;
  kaldirilan_yetkiler: string | string[] | null;
  updated_at: string;
  /** Panele giriş şifresi tanımlı mı? Hash asla gelmez, yalnız var/yok. */
  sifre_var?: number | boolean;
  /** Kasaya giriş PIN'i tanımlı mı? */
  pin_var?: number | boolean;
}

/**
 * Bu hesap nereye girebilir?
 *
 * Panele giriş ŞİFRE ister ve yalnız yöneticiye açıktır; kasaya giriş PIN'dir.
 * Rozet bunu söylemezse "Yönetici" yazısını gören kişi o hesabın panele
 * girebileceğini sanar — şifresi yoksa giremez ve sebebini hiçbir yerde göremez.
 */
function erisim(p: Personel): { etiket: string; tur: 'basari' | 'uyari' | 'notr'; ipucu?: string } {
  const sifre = Boolean(Number(p.sifre_var ?? 0));
  const pin = Boolean(Number(p.pin_var ?? 0));

  if (p.rol === 'ADMIN') {
    if (sifre) return { etiket: 'Panel + kasa', tur: 'basari' };
    return {
      etiket: 'Yalnız kasa',
      tur: 'uyari',
      ipucu: 'Panele girebilmesi için satıra dokunup şifre atayın. PIN panele yetmez.',
    };
  }
  return {
    etiket: 'Yalnız kasa',
    tur: 'notr',
    ipucu: pin ? undefined : 'PIN tanımlı değil; bu hesap kasaya da giremez.',
  };
}

/** Sunucunun kabul ettiği desen — hata almadan önce kullanıcıyı uyarabilmek için burada da var. */
const KULLANICI_ADI_DESENI = /^[a-zA-Z0-9._-]+$/;

// ---------------------------------------------------------------------------
// Yetki yardımcıları
// ---------------------------------------------------------------------------

/** Bozuk/eksik JSON kayıt tüm sayfayı düşürmesin: çözülemeyeni ve tanınmayan yetkiyi ele. */
function yetkileriCoz(ham: unknown): Yetki[] {
  let deger: unknown = ham;
  if (typeof ham === 'string') {
    try {
      deger = JSON.parse(ham) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(deger)) return [];
  return deger.filter((y): y is Yetki => typeof y === 'string' && yetkiGecerliMi(y));
}

/**
 * Sunucu etkin yetkiyi `rol varsayılanı + ek − kaldırılan` diye hesaplar; bu yüzden
 * mutlak listeyi değil, rolün varsayılanına göre FARKI göndeririz.
 */
function yetkiFarki(rol: Rol, secili: ReadonlySet<Yetki>): { ek_yetkiler: Yetki[]; kaldirilan_yetkiler: Yetki[] } {
  const varsayilan = new Set<Yetki>(ROL_YETKILERI[rol]);
  return {
    ek_yetkiler: YETKILER.filter((y) => secili.has(y) && !varsayilan.has(y)),
    kaldirilan_yetkiler: YETKILER.filter((y) => !secili.has(y) && varsayilan.has(y)),
  };
}

function onekAl(yetki: Yetki): string {
  return yetki.split('.')[0] ?? yetki;
}

const GRUP_TANIMLARI: readonly { baslik: string; onekler: readonly string[] }[] = [
  { baslik: 'Satış', onekler: ['satis'] },
  { baslik: 'Ürün ve Katalog', onekler: ['urun'] },
  { baslik: 'Stok', onekler: ['stok'] },
  { baslik: 'Cari Hesaplar', onekler: ['cari'] },
  { baslik: 'Kasa', onekler: ['kasa'] },
  { baslik: 'Raporlar', onekler: ['rapor'] },
  { baslik: 'Yönetim', onekler: ['kullanici', 'ayar', 'kampanya', 'senkron', 'yedek', 'denetim'] },
];

/** Gruplar modül düzeyinde bir kez kurulur; yeni bir yetki öneki eklenirse "Diğer"e düşer, kaybolmaz. */
const YETKI_GRUPLARI: readonly { baslik: string; yetkiler: Yetki[] }[] = (() => {
  const tanimliOnekler = GRUP_TANIMLARI.flatMap((g) => g.onekler);
  const gruplar = GRUP_TANIMLARI.map((g) => ({
    baslik: g.baslik,
    yetkiler: YETKILER.filter((y) => g.onekler.includes(onekAl(y))),
  })).filter((g) => g.yetkiler.length > 0);
  const diger = YETKILER.filter((y) => !tanimliOnekler.includes(onekAl(y)));
  return diger.length > 0 ? [...gruplar, { baslik: 'Diğer', yetkiler: diger }] : gruplar;
})();

function aktifMi(personel: Personel): boolean {
  return Boolean(Number(personel.aktif_mi));
}

// ---------------------------------------------------------------------------
// Sayfa
// ---------------------------------------------------------------------------

export default function KullanicilarSayfasi() {
  const [rol, setRol] = useState<string | null>(null);
  const [oturumHazir, setOturumHazir] = useState(false);
  const [duzenlenen, setDuzenlenen] = useState<Personel | 'yeni' | null>(null);

  // Oturum yalnız tarayıcıda okunabilir; sunucu render'ıyla uyuşmazlık olmasın diye efektte okunur.
  useEffect(() => {
    setRol(kullaniciyiOku()?.rol ?? null);
    setOturumHazir(true);
  }, []);

  const yoneticiMi = rol === 'ADMIN';
  // Yönetici değilse uç zaten 403 döner; isteği hiç göndermeyip kullanıcıyı hataya sokmayız.
  const { veri, yukleniyor, hata, tazele } = useVeri<{ data: Personel[] }>(yoneticiMi ? uclar.kullanicilar : null);

  if (!oturumHazir) {
    return (
      <Kabuk baslik="Personel">
        <Yukleniyor />
      </Kabuk>
    );
  }

  if (!yoneticiMi) {
    return (
      <Kabuk baslik="Personel">
        <div className="kart border-bilgi-cizgi bg-bilgi-yumusak p-4 text-sm text-metin">
          <p className="font-medium">Bu sayfa yalnız yöneticilere açıktır.</p>
          <p className="mt-1 text-metin-2">
            Personel ve yetki tanımlarını görüntülemek ya da değiştirmek için yönetici hesabıyla giriş yapmanız gerekir.
          </p>
        </div>
      </Kabuk>
    );
  }

  const kayitlar = veri?.data ?? [];

  const sil = async (p: Personel) => {
    const onay = window.confirm(
      `"${p.ad}" silinsin mi?\n\nSatış, kasa ya da stok kaydı varsa silinemez — bunun yerine girişi kapatılır.`,
    );
    if (!onay) return;
    try {
      const sonuc = await api<{ silindi: boolean; kayitSayisi: number; ad: string }>(`${uclar.kullanicilar}/${p.id}`, {
        method: 'DELETE',
      });
      window.alert(
        sonuc.silindi
          ? `${sonuc.ad} silindi. Bir sonraki senkronda kasalardan da düşer.`
          : `${sonuc.ad} silinemedi: ${sonuc.kayitSayisi} kaydı var (satış, kasa, stok). Geçmişin bozulmaması için girişi kapatıldı.`,
      );
      tazele();
    } catch (hata) {
      window.alert(hata instanceof Error ? hata.message : 'Kullanıcı silinemedi.');
    }
  };

  return (
    <Kabuk baslik="Personel">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm text-metin-3">Kasada çalışan hesaplar ve yetkileri.</p>
          <button type="button" className="tus-birincil" onClick={() => setDuzenlenen('yeni')}>
            Yeni Personel
          </button>
        </div>

        {yukleniyor ? (
          <Yukleniyor />
        ) : hata ? (
          <HataKutusu mesaj={hata} tekrarDene={tazele} />
        ) : kayitlar.length === 0 ? (
          <div className="kart">
            <BosDurum
              baslik="Henüz personel kaydı yok"
              aciklama="“Yeni Personel” ile ilk kasiyer hesabını oluşturun; bir sonraki senkronda kasalara iner."
            />
          </div>
        ) : (
          <div className="kart">
            <div className="tablo-sarmal">
              <table className="tablo">
                <thead>
                  <tr>
                    <th>Ad soyad</th>
                    <th>Kullanıcı adı</th>
                    <th>Rol</th>
                    <th>Erişim</th>
                    <th>Durum</th>
                    <th>Son güncelleme</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {kayitlar.map((p) => {
                    const fark = yetkiFarki(
                      p.rol,
                      etkinYetkiler({
                        rol: p.rol,
                        ekYetkiler: yetkileriCoz(p.ek_yetkiler),
                        kaldirilanYetkiler: yetkileriCoz(p.kaldirilan_yetkiler),
                      }),
                    );
                    const ozelAyar = fark.ek_yetkiler.length > 0 || fark.kaldirilan_yetkiler.length > 0;
                    return (
                      <tr key={p.id} className="cursor-pointer" onClick={() => setDuzenlenen(p)}>
                        <td>
                          <span className="font-medium">{p.ad}</span>
                          {ozelAyar && (
                            <span className="mt-0.5 block text-xs text-metin-4">
                              {fark.ek_yetkiler.length > 0 && `+${fark.ek_yetkiler.length} ek yetki`}
                              {fark.ek_yetkiler.length > 0 && fark.kaldirilan_yetkiler.length > 0 && ' · '}
                              {fark.kaldirilan_yetkiler.length > 0 && `−${fark.kaldirilan_yetkiler.length} kısıt`}
                            </span>
                          )}
                        </td>
                        <td className="font-mono text-metin-3">{p.kullanici_adi}</td>
                        <td>
                          <Rozet tur={p.rol === 'ADMIN' ? 'bilgi' : 'notr'}>{ROL_ETIKETI[p.rol]}</Rozet>
                        </td>
                        <td>
                          {(() => {
                            const e = erisim(p);
                            return (
                              <span title={e.ipucu}>
                                <Rozet tur={e.tur}>{e.etiket}</Rozet>
                                {e.ipucu && <span className="mt-0.5 block text-xs text-metin-4">{e.ipucu}</span>}
                              </span>
                            );
                          })()}
                        </td>
                        <td>
                          <Rozet tur={aktifMi(p) ? 'basari' : 'notr'}>{aktifMi(p) ? 'Aktif' : 'Pasif'}</Rozet>
                        </td>
                        <td className="whitespace-nowrap text-metin-3">{goreliZaman(p.updated_at)}</td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="tus-tehlike px-2 py-1 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              void sil(p);
                            }}
                          >
                            Sil
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-xs text-metin-4">
          Buradan eklenen personel bir sonraki senkronda kasalara iner. <strong>Kasaya PIN, panele şifre ile</strong> girilir;
          panele yalnız Patron / Yönetici rolündekiler girebilir. Şifre ve PIN panelde hiçbir şekilde görüntülenemez, yalnız
          yenisi atanabilir. Düzenlemek için satıra dokunun.
        </p>
      </div>

      {duzenlenen && (
        <PersonelFormu
          key={duzenlenen === 'yeni' ? 'yeni' : duzenlenen.id}
          personel={duzenlenen}
          onKapat={() => setDuzenlenen(null)}
          onKaydedildi={() => {
            setDuzenlenen(null);
            tazele();
          }}
        />
      )}
    </Kabuk>
  );
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

function PersonelFormu({
  personel,
  onKapat,
  onKaydedildi,
}: {
  personel: Personel | 'yeni';
  onKapat: () => void;
  onKaydedildi: () => void;
}) {
  const yeniMi = personel === 'yeni';
  const mevcut = yeniMi ? null : personel;

  const [ad, setAd] = useState(mevcut?.ad ?? '');
  const [kullaniciAdi, setKullaniciAdi] = useState(mevcut?.kullanici_adi ?? '');
  const [rol, setRol] = useState<Rol>(mevcut?.rol ?? 'KASIYER');
  const [pin, setPin] = useState('');
  const [sifre, setSifre] = useState('');
  const [aktif, setAktif] = useState(mevcut ? Boolean(Number(mevcut.aktif_mi)) : true);
  const [secili, setSecili] = useState<Set<Yetki>>(() =>
    mevcut
      ? etkinYetkiler({
          rol: mevcut.rol,
          ekYetkiler: yetkileriCoz(mevcut.ek_yetkiler),
          kaldirilanYetkiler: yetkileriCoz(mevcut.kaldirilan_yetkiler),
        })
      : new Set<Yetki>(ROL_YETKILERI.KASIYER),
  );
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const varsayilan = useMemo(() => new Set<Yetki>(ROL_YETKILERI[rol]), [rol]);
  const fark = useMemo(() => yetkiFarki(rol, secili), [rol, secili]);
  const kullaniciAdiGecerli = KULLANICI_ADI_DESENI.test(kullaniciAdi.trim()) && kullaniciAdi.trim().length >= 3;

  const rolDegistir = (yeniRol: Rol) => {
    setRol(yeniRol);
    // Taban küme değişti: eski role göre yapılmış işaretlemeler yeni rolde yanıltıcı olur.
    setSecili(new Set<Yetki>(ROL_YETKILERI[yeniRol]));
  };

  const yetkiDegistir = (yetki: Yetki) => {
    setSecili((onceki) => {
      const sonraki = new Set(onceki);
      if (sonraki.has(yetki)) sonraki.delete(yetki);
      else sonraki.add(yetki);
      return sonraki;
    });
  };

  const kaydet = async () => {
    const temizAd = ad.trim();
    const temizKullaniciAdi = kullaniciAdi.trim();

    if (temizAd.length < 1 || temizAd.length > 120) {
      setHata('Ad soyad zorunludur (en fazla 120 karakter).');
      return;
    }
    if (temizKullaniciAdi.length < 3 || temizKullaniciAdi.length > 60 || !KULLANICI_ADI_DESENI.test(temizKullaniciAdi)) {
      setHata('Kullanıcı adı 3-60 karakter olmalı ve yalnız harf, rakam, nokta, alt çizgi veya tire içermelidir.');
      return;
    }
    // Kasaya inen hesabın giriş yolu PIN'dir; yeni kayıtta PIN'siz hesap kasada kullanılamaz.
    if (yeniMi && !/^\d{4,8}$/.test(pin)) {
      setHata('Yeni personel için 4-8 haneli bir PIN belirleyin.');
      return;
    }
    if (pin && !/^\d{4,8}$/.test(pin)) {
      setHata('PIN 4 ile 8 hane arasında, yalnız rakamlardan oluşmalıdır.');
      return;
    }
    if (sifre && (sifre.length < 8 || sifre.length > 200)) {
      setHata('Panel şifresi en az 8 karakter olmalıdır.');
      return;
    }

    setGonderiliyor(true);
    setHata(null);
    try {
      await api(uclar.kullanicilar, {
        method: 'POST',
        body: JSON.stringify({
          id: mevcut?.id,
          ad: temizAd,
          kullanici_adi: temizKullaniciAdi,
          rol,
          // Boş bırakılan alanlar hiç gönderilmez; sunucu mevcut hash'i korur.
          sifre: sifre || undefined,
          pin: pin || undefined,
          aktif_mi: aktif,
          ...fark,
        }),
      });
      onKaydedildi();
    } catch (h) {
      setHata(h instanceof Error ? h.message : 'Kaydedilemedi.');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Modal
      genis
      baslik={yeniMi ? 'Yeni Personel' : 'Personel Düzenle'}
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil flex-1" onClick={onKapat} disabled={gonderiliyor}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil flex-1" onClick={kaydet} disabled={gonderiliyor}>
            {gonderiliyor ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="etiket">Ad soyad *</span>
            <input className="alan" value={ad} onChange={(e) => setAd(e.target.value)} maxLength={120} autoFocus />
          </label>

          <label className="block">
            <span className="etiket">Kullanıcı adı *</span>
            <input
              className="alan font-mono"
              value={kullaniciAdi}
              onChange={(e) => setKullaniciAdi(e.target.value)}
              maxLength={60}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <span className={`mt-1 block text-xs ${kullaniciAdi && !kullaniciAdiGecerli ? 'text-uyari' : 'text-metin-4'}`}>
              3-60 karakter; yalnız harf, rakam, nokta, alt çizgi ve tire kullanılabilir (örn. ayse.yilmaz).
            </span>
          </label>

          <label className="block">
            <span className="etiket">Rol</span>
            <select className="alan" value={rol} onChange={(e) => rolDegistir(e.target.value as Rol)}>
              {ROL.map((r) => (
                <option key={r} value={r}>
                  {ROL_ETIKETI[r]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
            <input type="checkbox" checked={aktif} onChange={(e) => setAktif(e.target.checked)} />
            Hesap aktif (kasada giriş yapabilir)
          </label>

          <label className="block">
            <span className="etiket">PIN — kasada giriş {yeniMi ? '*' : ''}</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              className="alan font-mono"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder={yeniMi ? '4-8 hane' : '••••'}
            />
            <span className="mt-1 block text-xs text-metin-4">
              4-8 hane. {yeniMi ? 'Kasada bu PIN ile giriş yapılır.' : 'Boş bırakılırsa mevcut PIN değişmez.'}
            </span>
          </label>

          <label className="block">
            <span className="etiket">Panel şifresi (opsiyonel)</span>
            <input
              type="password"
              autoComplete="new-password"
              className="alan"
              value={sifre}
              onChange={(e) => setSifre(e.target.value)}
              placeholder={yeniMi ? 'En az 8 karakter' : '••••••••'}
            />
            <span className="mt-1 block text-xs text-metin-4">
              Yalnız bu panele girecek kişiler için gerekir. Boş bırakılırsa {yeniMi ? 'şifre atanmaz' : 'mevcut şifre değişmez'}.
            </span>
          </label>
        </div>

        {/* Yetkiler */}
        <section className="border-t border-cizgi pt-3">
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <h3 className="mr-auto font-medium">Yetkiler</h3>
            <button
              type="button"
              className="text-xs text-vurgu hover:underline"
              onClick={() => setSecili(new Set<Yetki>(ROL_YETKILERI[rol]))}
            >
              Rol varsayılanına dön
            </button>
          </div>

          <p className="mb-3 text-xs text-metin-3">
            İşaretli kutu “bu kullanıcıda bu yetki var” demektir. Seçilen rolün varsayılanları işaretli gelir; üzerine ek yetki
            verebilir ya da varsayılan bir yetkiyi kaldırabilirsiniz.
            {(fark.ek_yetkiler.length > 0 || fark.kaldirilan_yetkiler.length > 0) && (
              <span className="mt-1 block text-metin-2">
                {ROL_ETIKETI[rol]} varsayılanına göre: {fark.ek_yetkiler.length} ek, {fark.kaldirilan_yetkiler.length} kaldırılan
                yetki.
              </span>
            )}
          </p>

          <div className="space-y-3">
            {YETKI_GRUPLARI.map((grup) => (
              <fieldset key={grup.baslik} className="rounded-lg border border-cizgi bg-yuzey-2/40 p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-metin-3">{grup.baslik}</legend>
                <div className="grid gap-1 sm:grid-cols-2">
                  {grup.yetkiler.map((y) => {
                    const isaretli = secili.has(y);
                    const rolde = varsayilan.has(y);
                    return (
                      <label key={y} className="flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-yuzey-2">
                        <input type="checkbox" className="mt-1" checked={isaretli} onChange={() => yetkiDegistir(y)} />
                        <span className="min-w-0">
                          <span className={isaretli ? 'text-metin' : 'text-metin-4'}>{YETKI_ETIKETLERI[y]}</span>
                          {rolde && !isaretli && <span className="ml-1 text-xs text-tehlike">· kaldırıldı</span>}
                          {!rolde && isaretli && <span className="ml-1 text-xs text-vurgu">· ek yetki</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </section>

        {hata && (
          <p className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm text-tehlike">{hata}</p>
        )}
      </div>
    </Modal>
  );
}
