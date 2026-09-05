/** Cihaz yönetimi, kasa geçmişi ve denetim logları (§11.7, §11.9, §11.10). */

'use client';

import { useState } from 'react';
import { goreliZaman } from '@market/shared';
import { BosDurum, HataKutusu, Kabuk, Rozet, Yukleniyor } from '@/bilesen/kabuk';
import { api, kullaniciyiOku, uclar } from '@/lib/api';
import { useVeri } from '@/lib/kanca';

type Sekme = 'magaza' | 'cihazlar';

export default function AyarlarSayfasi() {
  const [sekme, setSekme] = useState<Sekme>('magaza');
  const kullanici = kullaniciyiOku();

  return (
    <Kabuk baslik="Ayarlar">
      <div className="space-y-4">
        <nav className="flex gap-1 overflow-x-auto border-b border-cizgi">
          {[
            { anahtar: 'magaza' as const, etiket: 'Mağaza Ayarları' },
            { anahtar: 'cihazlar' as const, etiket: 'Cihazlar & Senkron' },
          ].map((s) => (
            <button
              key={s.anahtar}
              type="button"
              onClick={() => setSekme(s.anahtar)}
              className={`whitespace-nowrap px-3 py-2 text-sm ${
                sekme === s.anahtar ? 'border-b-2 border-vurgu font-medium text-vurgu' : 'text-metin-3 hover:text-metin'
              }`}
            >
              {s.etiket}
            </button>
          ))}
        </nav>

        {sekme === 'magaza' && <MagazaAyarlariSekmesi yoneticiMi={kullanici?.rol === 'ADMIN'} />}
        {sekme === 'cihazlar' && <CihazlarSekmesi yoneticiMi={kullanici?.rol === 'ADMIN'} />}
      </div>
    </Kabuk>
  );
}

// ---------------------------------------------------------------------------
// Mağaza ayarları (§8.3)
// ---------------------------------------------------------------------------

/**
 * Buradan değiştirilen ayar bir sonraki senkronda BÜTÜN kasalara iner.
 *
 * Listede yalnız "tüm mağazada aynı olmalı" denen anahtarlar var. Yazıcı
 * hedefi, cihaz kimliği, fiş serisi gibi cihaza özel ayarlar bilerek yok:
 * hepsi aynı değeri alsaydı her kasa aynı yazıcıya basmaya çalışırdı.
 */
const AYAR_TANIMLARI: {
  anahtar: string;
  etiket: string;
  ipucu?: string;
  tip?: 'metin' | 'sayi' | 'secim';
  secenekler?: string[];
}[] = [
  { anahtar: 'isletme.ad', etiket: 'İşletme adı', ipucu: 'Fişin başında yazar' },
  { anahtar: 'isletme.adres', etiket: 'Adres' },
  { anahtar: 'isletme.telefon', etiket: 'Telefon' },
  { anahtar: 'isletme.vergi_no', etiket: 'Vergi no' },
  { anahtar: 'kdv.varsayilan', etiket: 'Varsayılan KDV (%)', tip: 'secim', secenekler: ['0', '1', '10', '20'] },
  { anahtar: 'fis.alt_metin', etiket: 'Fiş alt metni', ipucu: 'Fişin sonunda basılır' },
  { anahtar: 'fis.yasal_uyari', etiket: 'Fiş yasal uyarısı' },
  {
    anahtar: 'stok.negatif_izin',
    etiket: 'Stok yetersizken satışa izin ver',
    tip: 'secim',
    secenekler: ['1', '0'],
    ipucu: '1 = izin ver (önerilen; kasa stok hatası yüzünden durmaz)',
  },
  { anahtar: 'stok.kritik_uyari', etiket: 'Kritik stok uyarısı', tip: 'secim', secenekler: ['1', '0'] },
  {
    anahtar: 'cari.limit_davranisi',
    etiket: 'Kredi limiti aşılınca',
    tip: 'secim',
    secenekler: ['UYAR', 'ENGELLE'],
  },
  { anahtar: 'kasa.fark_esigi', etiket: 'Kasa farkı uyarı eşiği (kuruş)', tip: 'sayi' },
  { anahtar: 'guvenlik.oturum_zaman_asimi_dk', etiket: 'Oturum zaman aşımı (dakika)', tip: 'sayi' },
  { anahtar: 'barkod.ic_onek', etiket: 'İç barkod öneki', ipucu: 'Kendi ürettiğiniz barkodların başı' },
  { anahtar: 'bakim.olay_saklama_gun', etiket: 'Senkron olayı saklama (gün)', tip: 'sayi' },
  { anahtar: 'bakim.denetim_saklama_gun', etiket: 'Denetim logu saklama (gün)', tip: 'sayi' },
];

interface AyarSatiri {
  anahtar: string;
  deger: string;
  updated_at: string;
}

function MagazaAyarlariSekmesi({ yoneticiMi }: { yoneticiMi: boolean }) {
  const { veri, yukleniyor, hata, tazele } = useVeri<{ data: AyarSatiri[] }>(uclar.ayarlar);
  const [taslak, setTaslak] = useState<Record<string, string>>({});
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [mesaj, setMesaj] = useState<string | null>(null);

  const mevcut = new Map((veri?.data ?? []).map((a) => [a.anahtar, a.deger]));
  const deger = (anahtar: string) => taslak[anahtar] ?? mevcut.get(anahtar) ?? '';
  const degisenler = Object.entries(taslak).filter(([k, v]) => v !== (mevcut.get(k) ?? ''));

  const kaydet = async () => {
    if (degisenler.length === 0) return;
    setKaydediliyor(true);
    setMesaj(null);
    try {
      await api(uclar.ayarlar, {
        method: 'POST',
        body: JSON.stringify({ degerler: Object.fromEntries(degisenler) }),
      });
      setTaslak({});
      setMesaj(`${degisenler.length} ayar kaydedildi. Kasalara bir sonraki senkronda iner.`);
      tazele();
    } catch (h) {
      setMesaj(h instanceof Error ? h.message : 'Kaydedilemedi.');
    } finally {
      setKaydediliyor(false);
    }
  };

  if (yukleniyor && !veri) return <Yukleniyor />;
  if (hata) return <HataKutusu mesaj={hata} />;

  return (
    <div className="kart p-4">
      <h2 className="text-base font-semibold">Mağaza Ayarları</h2>
      <p className="mb-4 mt-1 text-sm text-metin-3">
        Buradaki değerler bütün kasalara senkronlanır. Yazıcı ve yedek gibi cihaza özel ayarlar kasadan yapılır.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {AYAR_TANIMLARI.map((t) => (
          <label key={t.anahtar} className="block">
            <span className="mb-1 block text-sm font-medium">{t.etiket}</span>
            {t.tip === 'secim' ? (
              <select
                className="alan w-full"
                value={deger(t.anahtar)}
                disabled={!yoneticiMi}
                onChange={(e) => setTaslak({ ...taslak, [t.anahtar]: e.target.value })}
              >
                <option value="">— tanımsız —</option>
                {t.secenekler?.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="alan w-full"
                inputMode={t.tip === 'sayi' ? 'numeric' : 'text'}
                value={deger(t.anahtar)}
                disabled={!yoneticiMi}
                onChange={(e) => setTaslak({ ...taslak, [t.anahtar]: e.target.value })}
              />
            )}
            {t.ipucu && <span className="mt-1 block text-xs text-metin-4">{t.ipucu}</span>}
            <span className="mt-0.5 block font-mono text-[11px] text-metin-4">{t.anahtar}</span>
          </label>
        ))}
      </div>

      {mesaj && <p className="mt-4 rounded border border-cizgi bg-yuzey-2 px-3 py-2 text-sm">{mesaj}</p>}

      {yoneticiMi ? (
        <div className="mt-4 flex items-center gap-3">
          <button type="button" className="tus-birincil" onClick={kaydet} disabled={degisenler.length === 0 || kaydediliyor}>
            {kaydediliyor ? 'Kaydediliyor…' : `Kaydet${degisenler.length > 0 ? ` (${degisenler.length})` : ''}`}
          </button>
          {degisenler.length > 0 && (
            <button type="button" className="tus-ikincil" onClick={() => setTaslak({})}>
              Değişiklikleri geri al
            </button>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-metin-3">Ayarları yalnız sahip/yönetici değiştirebilir.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cihazlar
// ---------------------------------------------------------------------------

interface Cihaz {
  id: string;
  cihaz_id: string;
  cihaz_adi: string;
  platform: string | null;
  uygulama_surumu: string | null;
  son_push: string | null;
  son_pull: string | null;
  aktif_mi: number;
}

function CihazlarSekmesi({ yoneticiMi }: { yoneticiMi: boolean }) {
  const { veri, yukleniyor, hata, tazele } = useVeri<{ data: Cihaz[] }>(uclar.cihazlar);
  const [islemde, setIslemde] = useState<string | null>(null);

  const iptalEt = async (cihaz: Cihaz) => {
    if (
      !window.confirm(
        `"${cihaz.cihaz_adi}" cihazının senkron yetkisi iptal edilecek. Bu kasa artık veri gönderemeyecek. Onaylıyor musunuz?`,
      )
    )
      return;
    setIslemde(cihaz.id);
    try {
      await api(`${uclar.cihazlar}/${cihaz.id}/iptal`, { method: 'POST' });
      tazele();
    } catch (h) {
      window.alert(h instanceof Error ? h.message : 'İptal edilemedi.');
    } finally {
      setIslemde(null);
    }
  };

  if (yukleniyor) return <Yukleniyor />;
  if (hata) return <HataKutusu mesaj={hata} tekrarDene={tazele} />;

  return (
    <div className="space-y-3">
      {(veri?.data ?? []).map((c) => {
        // 3 gündür veri göndermeyen kasa kritik: ya kapalı ya da ağ sorunu var.
        const gecikme = c.son_push ? (Date.now() - Date.parse(c.son_push)) / 86400000 : Infinity;
        const durum = Number(c.aktif_mi) !== 1 ? 'iptal' : gecikme >= 3 ? 'kritik' : gecikme >= 1 ? 'uyari' : 'iyi';
        return (
          <div key={c.id} className="kart p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{c.cihaz_adi}</p>
                <p className="truncate text-xs text-metin-4">
                  {c.cihaz_id} · {c.platform ?? 'bilinmiyor'} · v{c.uygulama_surumu ?? '—'}
                </p>
                <p className="mt-1 text-sm">
                  <span className="text-metin-3">Son gönderim: </span>
                  {c.son_push ? goreliZaman(c.son_push) : 'hiç'}
                </p>
              </div>
              <span className="shrink-0">
                {durum === 'iptal' ? (
                  <Rozet tur="notr">İptal</Rozet>
                ) : durum === 'kritik' ? (
                  <Rozet tur="tehlike">Senkron yok</Rozet>
                ) : durum === 'uyari' ? (
                  <Rozet tur="uyari">Gecikmeli</Rozet>
                ) : (
                  <Rozet tur="basari">Güncel</Rozet>
                )}
              </span>
            </div>

            {yoneticiMi && Number(c.aktif_mi) === 1 && (
              <button
                type="button"
                className="mt-3 text-sm text-tehlike hover:underline disabled:opacity-50"
                onClick={() => iptalEt(c)}
                disabled={islemde === c.id}
              >
                Cihaz yetkisini iptal et
              </button>
            )}
          </div>
        );
      })}

      {(veri?.data.length ?? 0) === 0 && (
        <div className="kart p-6">
          <BosDurum
            baslik="Henüz bağlı cihaz yok"
            aciklama='Kasa uygulamasından Ayarlar → Senkron → "Cihazı Aktive Et" adımını uygulayın.'
          />
        </div>
      )}

      <p className="text-xs text-metin-4">
        Bir kasa 3 gündür veri göndermiyorsa kırmızı görünür. Kayıp/çalıntı cihazın token'ını iptal ederek senkronunu anında
        durdurabilirsiniz.
      </p>
    </div>
  );
}
