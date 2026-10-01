/** Ayarlar (§10.11): işletme, donanım, senkron/lisans, yedekleme, görünüm. */

import { useCallback, useEffect, useState } from 'react';
import { AYAR, paraFormat, tarihSaatFormat } from '@market/shared';
import { Alan, Diyalog, Rozet, Yukleniyor } from '../bilesen/temel';
import { EtiketOnizleme, FisOnizleme, type EtiketOnizlemeVerisi, type FisOnizlemeVerisi } from '../bilesen/Onizleme';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { oturumDurumu } from '../durum/oturum';
import { cagir } from '../kopru';

type Sekme = 'isletme' | 'donanim' | 'satis' | 'senkron' | 'yedek' | 'gorunum';

export function AyarlarSayfasi() {
  const [sekme, setSekme] = useState<Sekme>('isletme');
  const [ayarlar, setAyarlar] = useState<Record<string, string>>({});
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const tazele = oturumDurumu((s) => s.tazele);
  const sistem = oturumDurumu((s) => s.sistem);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      setAyarlar(await cagir<Record<string, string>>('ayar.tumu'));
    } catch (hata) {
      hatayiBildir(hata, 'Ayarlar');
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  const ayarla = (anahtar: string, deger: string) => setAyarlar((a) => ({ ...a, [anahtar]: deger }));

  const kaydet = async () => {
    setKaydediliyor(true);
    try {
      await cagir('ayar.yaz', { degerler: ayarlar });
      bildir.basari('Ayarlar kaydedildi');
      await tazele();
      // Yazı boyutu anında uygulanır.
      document.documentElement.dataset.yazi = ayarlar[AYAR.YAZI_BOYUTU] ?? 'normal';
    } catch (hata) {
      hatayiBildir(hata, 'Ayar kaydı');
    } finally {
      setKaydediliyor(false);
    }
  };

  if (yukleniyor) return <Yukleniyor />;

  const sekmeler: { anahtar: Sekme; etiket: string }[] = [
    { anahtar: 'isletme', etiket: 'İşletme' },
    { anahtar: 'donanim', etiket: 'Donanım' },
    { anahtar: 'satis', etiket: 'Satış Kuralları' },
    { anahtar: 'senkron', etiket: 'Senkron & Lisans' },
    { anahtar: 'yedek', etiket: 'Yedekleme' },
    { anahtar: 'gorunum', etiket: 'Görünüm' },
  ];

  return (
    <div className="flex h-full flex-col p-4">
      <header className="mb-3 flex items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Ayarlar</h1>
        <button type="button" className="tus-birincil" onClick={kaydet} disabled={kaydediliyor}>
          {kaydediliyor ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </header>

      <nav className="mb-3 flex flex-wrap gap-1 border-b border-cizgi">
        {sekmeler.map((s) => (
          <button
            key={s.anahtar}
            type="button"
            onClick={() => setSekme(s.anahtar)}
            className={`px-3 py-2 text-sm ${sekme === s.anahtar ? 'border-b-2 border-vurgu font-medium text-vurgu' : 'text-metin-3 hover:text-metin'}`}
          >
            {s.etiket}
          </button>
        ))}
      </nav>

      <div className="kart min-h-0 flex-1 overflow-auto p-4">
        {sekme === 'isletme' && (
          <div className="grid max-w-2xl gap-3">
            <Alan etiket="İşletme adı">
              <input
                className="alan"
                value={ayarlar[AYAR.ISLETME_ADI] ?? ''}
                onChange={(e) => ayarla(AYAR.ISLETME_ADI, e.target.value)}
              />
            </Alan>
            <Alan etiket="Adres">
              <input
                className="alan"
                value={ayarlar[AYAR.ISLETME_ADRES] ?? ''}
                onChange={(e) => ayarla(AYAR.ISLETME_ADRES, e.target.value)}
              />
            </Alan>
            <Alan etiket="Telefon">
              <input
                className="alan"
                value={ayarlar[AYAR.ISLETME_TELEFON] ?? ''}
                onChange={(e) => ayarla(AYAR.ISLETME_TELEFON, e.target.value)}
              />
            </Alan>
            <Alan etiket="Vergi no">
              <input
                className="alan"
                value={ayarlar[AYAR.ISLETME_VERGI_NO] ?? ''}
                onChange={(e) => ayarla(AYAR.ISLETME_VERGI_NO, e.target.value)}
              />
            </Alan>
            <Alan etiket="Fiş alt metni" ipucu="Fişin altında görünür. Boş bırakırsanız hiç basılmaz.">
              <input
                className="alan"
                placeholder="Bizi tercih ettiğiniz için teşekkürler"
                value={ayarlar[AYAR.FIS_ALT_METIN] ?? ''}
                onChange={(e) => ayarla(AYAR.FIS_ALT_METIN, e.target.value)}
              />
            </Alan>
            <Alan
              etiket="Yasal uyarı"
              ipucu="Mali değeri olmayan belgeye zorunludur; boş bırakırsanız varsayılan ifade basılır."
            >
              <input
                className="alan"
                placeholder="BİLGİ FİŞİDİR · MALİ DEĞERİ YOKTUR"
                value={ayarlar[AYAR.FIS_YASAL_UYARI] ?? ''}
                onChange={(e) => ayarla(AYAR.FIS_YASAL_UYARI, e.target.value)}
              />
            </Alan>
            <Alan
              etiket="Varsayılan KDV oranı"
              ipucu="Yeni ürünlerde kullanılır. Kesin sınıflandırma için mali müşavirinize danışın."
            >
              <input
                className="alan sayi"
                value={ayarlar[AYAR.VARSAYILAN_KDV] ?? '20'}
                onChange={(e) => ayarla(AYAR.VARSAYILAN_KDV, e.target.value)}
              />
            </Alan>
            <div className="rounded border border-uyari-cizgi bg-uyari-yumusak p-3 text-xs text-uyari">
              ⚠️ Bu yazılımın bastığı fiş <strong>mali belge değildir</strong>. Nihai tüketiciye kesilecek yasal satış belgesi GİB
              onaylı ÖKC (yazarkasa) cihazından düzenlenmelidir (§17.1).
            </div>
          </div>
        )}

        {sekme === 'donanim' && <DonanimSekmesi ayarlar={ayarlar} ayarla={ayarla} />}

        {sekme === 'satis' && (
          <div className="grid max-w-2xl gap-3">
            <Alan
              etiket="Negatif stokta satış"
              ipucu="Kapalıysa stok yetersizken satış engellenir (yetkili onayı ile geçilebilir)."
            >
              <select
                className="alan"
                value={ayarlar[AYAR.NEGATIF_STOK_IZNI] ?? '0'}
                onChange={(e) => ayarla(AYAR.NEGATIF_STOK_IZNI, e.target.value)}
              >
                <option value="0">Engelle</option>
                <option value="1">İzin ver (uyar)</option>
              </select>
            </Alan>
            <Alan etiket="Kredi limiti aşımında davranış">
              <select
                className="alan"
                value={ayarlar[AYAR.KREDI_LIMITI_DAVRANISI] ?? 'UYAR'}
                onChange={(e) => ayarla(AYAR.KREDI_LIMITI_DAVRANISI, e.target.value)}
              >
                <option value="UYAR">Uyar (yetkili onayı ile geç)</option>
                <option value="ENGELLE">Kesin engelle</option>
                <option value="IZIN_VER">İzin ver</option>
              </select>
            </Alan>
            <Alan etiket="Barkod tekrar okuma eşiği (ms)" ipucu="Bu süre içinde aynı barkod ikinci kez okunursa yok sayılır.">
              <input
                className="alan sayi"
                value={ayarlar[AYAR.BARKOD_DEBOUNCE_MS] ?? '120'}
                onChange={(e) => ayarla(AYAR.BARKOD_DEBOUNCE_MS, e.target.value)}
              />
            </Alan>
            <Alan etiket="Kasa farkı uyarı eşiği (kuruş)">
              <input
                className="alan sayi"
                value={ayarlar[AYAR.KASA_FARKI_ESIGI] ?? '5000'}
                onChange={(e) => ayarla(AYAR.KASA_FARKI_ESIGI, e.target.value)}
              />
            </Alan>
            <Alan etiket="Oturum zaman aşımı (dakika)" ipucu="0 = kapalı. Süre boyunca işlem yapılmazsa otomatik çıkış yapılır.">
              <input
                className="alan sayi"
                value={ayarlar[AYAR.OTURUM_ZAMAN_ASIMI_DK] ?? '15'}
                onChange={(e) => ayarla(AYAR.OTURUM_ZAMAN_ASIMI_DK, e.target.value)}
              />
            </Alan>
            <Alan etiket="İç barkod öneki" ipucu="GS1'de 20-29 aralığı mağaza içi kullanıma ayrılmıştır.">
              <input
                className="alan sayi"
                value={ayarlar[AYAR.IC_BARKOD_ONEKI] ?? '29'}
                onChange={(e) => ayarla(AYAR.IC_BARKOD_ONEKI, e.target.value)}
              />
            </Alan>
          </div>
        )}

        {sekme === 'senkron' && (
          <SenkronSekmesi ayarlar={ayarlar} ayarla={ayarla} lisans={sistem?.lisans} cihazId={sistem?.cihazId ?? ''} />
        )}

        {sekme === 'yedek' && <YedekSekmesi ayarlar={ayarlar} ayarla={ayarla} />}

        {sekme === 'gorunum' && (
          <div className="grid max-w-lg gap-3">
            <Alan etiket="Tema" ipucu="Aydınlık ortamda açık tema, loş ortamda koyu tema daha az yorar. Seçim anında uygulanır.">
              <div className="flex gap-2">
                {(
                  [
                    { deger: 'acik', etiket: 'Açık', ipucu: 'Varsayılan' },
                    { deger: 'koyu', etiket: 'Koyu', ipucu: 'Loş ortam' },
                  ] as const
                ).map((secenek) => {
                  const seciliMi = (ayarlar[AYAR.TEMA] ?? 'acik') === secenek.deger;
                  return (
                    <button
                      key={secenek.deger}
                      type="button"
                      className={`${seciliMi ? 'tus-birincil' : 'tus-ikincil'} flex-1 flex-col py-3`}
                      onClick={() => {
                        ayarla(AYAR.TEMA, secenek.deger);
                        // Anında uygula; kaydetmeden önce sonucu görmek gerekir.
                        if (secenek.deger === 'koyu') document.documentElement.dataset.tema = 'koyu';
                        else delete document.documentElement.dataset.tema;
                      }}
                    >
                      <span>{secenek.etiket}</span>
                      <span className="text-xs opacity-70">{secenek.ipucu}</span>
                    </button>
                  );
                })}
              </div>
            </Alan>

            <Alan etiket="Yazı boyutu" ipucu="Dokunmatik ve düşük görüşlü kullanıcılar için büyütün.">
              <select
                className="alan"
                value={ayarlar[AYAR.YAZI_BOYUTU] ?? 'normal'}
                onChange={(e) => {
                  ayarla(AYAR.YAZI_BOYUTU, e.target.value);
                  if (e.target.value === 'normal') delete document.documentElement.dataset.yazi;
                  else document.documentElement.dataset.yazi = e.target.value;
                }}
              >
                <option value="normal">Normal</option>
                <option value="buyuk">Büyük</option>
                <option value="cok-buyuk">Çok büyük</option>
              </select>
            </Alan>
            <p className="text-xs text-metin-4">
              Cihaz kimliği: <span className="font-mono">{sistem?.cihazId}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * POS cihazı (§ POS entegrasyonu). Kapalıyken kart çekimi cihazdan elle yapılır,
 * program yalnız kaydeder. Açıkken kart tutarı cihaza gider, onay gelmeden satış
 * kapanmaz; karta iade de cihazdan yapılır. Cihaza özel ayardır.
 */
function PosAyarlari({ ayarlar, ayarla }: { ayarlar: Record<string, string>; ayarla: (a: string, d: string) => void }) {
  const [sonuc, setSonuc] = useState<{ basarili: boolean; mesaj: string } | null>(null);
  const [deneniyor, setDeneniyor] = useState(false);
  const tur = ayarlar[AYAR.POS_TURU] ?? 'KAPALI';

  const dene = async () => {
    setDeneniyor(true);
    setSonuc(null);
    try {
      // Test kayıtlı ayarla yapılır; değiştirdiyseniz önce Kaydet'e basın.
      setSonuc(await cagir<{ basarili: boolean; mesaj: string }>('pos.test'));
    } catch (hata) {
      hatayiBildir(hata, 'POS testi');
    } finally {
      setDeneniyor(false);
    }
  };

  return (
    <div className="grid gap-3 rounded border border-cizgi p-3">
      <p className="font-medium">POS cihazı</p>
      <Alan
        etiket="POS bağlantısı"
        ipucu={
          tur === 'KAPALI'
            ? 'Kart çekimi POS cihazından elle yapılır; program yalnız kaydeder.'
            : tur === 'SIMULATOR'
              ? 'Gerçek cihaz olmadan akışı denemek için. Kuruşu 13 ile biten tutar (ör. 10,13) reddedilir, 14 ile biten yanıtsız kalır (süre aşımı denemesi).'
              : undefined
        }
      >
        <select className="alan" value={tur} onChange={(e) => ayarla(AYAR.POS_TURU, e.target.value)}>
          <option value="KAPALI">Kapalı (elle çekim)</option>
          <option value="SIMULATOR">Test simülatörü</option>
        </select>
      </Alan>
      {tur !== 'KAPALI' && (
        <>
          <Alan
            etiket="Cihaz adresi"
            ipucu="Ağ POS'unda IP:port (ör. 192.168.1.50:5000), seri bağlantıda COM3. Simülatörde gerekmez."
          >
            <input
              className="alan font-mono"
              value={ayarlar[AYAR.POS_ADRES] ?? ''}
              onChange={(e) => ayarla(AYAR.POS_ADRES, e.target.value)}
              disabled={tur === 'SIMULATOR'}
            />
          </Alan>
          <Alan etiket="Yanıt bekleme süresi (saniye)" ipucu="Müşterinin kartı okutması ve şifre girmesi için tanınan süre.">
            <input
              className="alan sayi w-32"
              inputMode="numeric"
              value={ayarlar[AYAR.POS_ZAMAN_ASIMI_SN] ?? '90'}
              onChange={(e) => ayarla(AYAR.POS_ZAMAN_ASIMI_SN, e.target.value.replace(/\D/g, ''))}
            />
          </Alan>
          <div className="flex items-center gap-2">
            <button type="button" className="tus-ikincil" onClick={() => void dene()} disabled={deneniyor}>
              {deneniyor ? 'Deneniyor…' : 'Bağlantıyı Test Et'}
            </button>
            {sonuc && <Rozet tur={sonuc.basarili ? 'basari' : 'tehlike'}>{sonuc.mesaj}</Rozet>}
          </div>
        </>
      )}
      <PosGunlugu />
    </div>
  );
}

/**
 * Kasaya bağlı terazi (RS-232 / USB-seri ya da ağ). Açıkken kg ürünün tartım
 * penceresi teraziden canlı okur. Ayar yalnız bu kasaya aittir.
 */
function TeraziAyarlari({ ayarlar, ayarla }: { ayarlar: Record<string, string>; ayarla: (a: string, d: string) => void }) {
  const [sonuc, setSonuc] = useState<{ basarili: boolean; mesaj: string } | null>(null);
  const [deneniyor, setDeneniyor] = useState(false);
  const [portlar, setPortlar] = useState<{ yol: string; aciklama: string }[]>([]);
  const tur = ayarlar[AYAR.TERAZI_TURU] ?? 'KAPALI';

  useEffect(() => {
    if (tur !== 'SERI') return;
    cagir<{ yol: string; aciklama: string }[]>('terazi.portlar')
      .then(setPortlar)
      .catch(() => setPortlar([]));
  }, [tur]);

  const dene = async () => {
    setDeneniyor(true);
    setSonuc(null);
    try {
      // Test kayıtlı ayarla yapılır; değiştirdiyseniz önce Kaydet'e basın.
      setSonuc(await cagir<{ basarili: boolean; mesaj: string }>('terazi.test'));
    } catch (hata) {
      hatayiBildir(hata, 'Terazi testi');
    } finally {
      setDeneniyor(false);
    }
  };

  return (
    <div className="grid gap-3 rounded border border-cizgi p-3">
      <p className="font-medium">Kasaya bağlı terazi</p>
      <Alan
        etiket="Terazi bağlantısı"
        ipucu={
          tur === 'KAPALI'
            ? 'Kapalı: kg ürünlerde miktar elle girilir.'
            : tur === 'SIMULATOR'
              ? 'Gerçek terazi olmadan denemek için; her okumada 1,250 kg döner.'
              : 'Açık: kg ürün sepete eklenirken ağırlık teraziden canlı okunur, kefe durunca Enter ile eklenir.'
        }
      >
        <select className="alan" value={tur} onChange={(e) => ayarla(AYAR.TERAZI_TURU, e.target.value)}>
          <option value="KAPALI">Kapalı (elle giriş)</option>
          <option value="SERI">Seri port / USB (COM)</option>
          <option value="AG">Ağ / Ethernet (IP)</option>
          <option value="SIMULATOR">Test simülatörü</option>
        </select>
      </Alan>
      {(tur === 'SERI' || tur === 'AG') && (
        <>
          <Alan
            etiket={tur === 'SERI' ? 'Port' : 'Terazi adresi'}
            ipucu={
              tur === 'SERI'
                ? 'Teraziyi takınca Windows Aygıt Yöneticisi → Bağlantı noktaları altında görünen COM numarası.'
                : 'Terazinin IP adresi ve portu, ör. 192.168.1.60:4001.'
            }
          >
            <input
              className="alan font-mono"
              list={tur === 'SERI' ? 'terazi-portlari' : undefined}
              placeholder={tur === 'SERI' ? 'COM3' : '192.168.1.60:4001'}
              value={ayarlar[AYAR.TERAZI_ADRES] ?? ''}
              onChange={(e) => ayarla(AYAR.TERAZI_ADRES, e.target.value.trim())}
            />
            {tur === 'SERI' && (
              <datalist id="terazi-portlari">
                {portlar.map((p) => (
                  <option key={p.yol} value={p.yol}>
                    {p.aciklama}
                  </option>
                ))}
              </datalist>
            )}
          </Alan>
          {tur === 'SERI' && (
            <div className="grid grid-cols-2 gap-3">
              <Alan etiket="Hız (baud)" ipucu="Terazinin kılavuzunda yazar; çoğunda 9600.">
                <select
                  className="alan"
                  value={ayarlar[AYAR.TERAZI_BAUD] ?? '9600'}
                  onChange={(e) => ayarla(AYAR.TERAZI_BAUD, e.target.value)}
                >
                  {['1200', '2400', '4800', '9600', '19200', '38400', '57600', '115200'].map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </Alan>
              <Alan etiket="Veri biçimi" ipucu="Veri biti, parite, dur biti. Çoğunda 8N1; bazılarında 7E1.">
                <select
                  className="alan"
                  value={ayarlar[AYAR.TERAZI_CERCEVE] ?? '8N1'}
                  onChange={(e) => ayarla(AYAR.TERAZI_CERCEVE, e.target.value)}
                >
                  {['8N1', '7E1', '7O1', '8E1', '8O1', '8N2', '7N1'].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Alan>
            </div>
          )}
          <Alan
            etiket="Ağırlık isteme komutu"
            ipucu={
              'Terazi ağırlığı sürekli gönderiyorsa boş bırakın. İstek bekliyorsa kılavuzdaki komutu yazın, ör. W\\r\\n ya da \\x05 (ENQ).'
            }
          >
            <input
              className="alan font-mono"
              placeholder="boş = sürekli gönderen terazi"
              value={ayarlar[AYAR.TERAZI_KOMUT] ?? ''}
              onChange={(e) => ayarla(AYAR.TERAZI_KOMUT, e.target.value)}
            />
          </Alan>
        </>
      )}
      {tur !== 'KAPALI' && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="tus-ikincil" onClick={() => void dene()} disabled={deneniyor}>
            {deneniyor ? 'Okunuyor…' : 'Teraziyi Test Et'}
          </button>
          {sonuc && <Rozet tur={sonuc.basarili ? 'basari' : 'tehlike'}>{sonuc.mesaj}</Rozet>}
          <span className="text-xs text-metin-3">Önce Kaydet'e basın; test kayıtlı ayarla yapılır.</span>
        </div>
      )}
    </div>
  );
}

interface PosGunlukSatiri {
  id: string;
  zaman: string;
  tur: 'SATIS' | 'IADE' | 'GERI_ALMA';
  tutar: number;
  sonuc: 'ONAY' | 'RED' | 'ZAMAN_ASIMI' | 'HATA';
  onay_kodu: string | null;
  kart: string | null;
  hata: string | null;
  belge_tipi: string | null;
  kullanici_adi?: string | null;
}

const POS_TUR_ADI: Record<PosGunlukSatiri['tur'], string> = { SATIS: 'Çekim', IADE: 'Karta iade', GERI_ALMA: 'Geri alma' };
const POS_SONUC: Record<PosGunlukSatiri['sonuc'], { ad: string; tur: 'basari' | 'uyari' | 'tehlike' }> = {
  ONAY: { ad: 'Onay', tur: 'basari' },
  RED: { ad: 'Red', tur: 'uyari' },
  ZAMAN_ASIMI: { ad: 'Yanıt yok', tur: 'tehlike' },
  HATA: { ad: 'Hata', tur: 'tehlike' },
};

/** Cihaza giden son işlemler — gün sonu slibiyle karşılaştırma ve "para çekildi mi?" sorusu için. */
function PosGunlugu() {
  const [satirlar, setSatirlar] = useState<PosGunlukSatiri[] | null>(null);
  const yukle = () => {
    cagir<PosGunlukSatiri[]>('pos.gunluk', { limit: 50 })
      .then(setSatirlar)
      .catch((hata: unknown) => hatayiBildir(hata, 'POS günlüğü'));
  };
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <button type="button" className="tus-ikincil" onClick={yukle}>
          {satirlar ? 'Yenile' : 'Son POS İşlemlerini Göster'}
        </button>
        <span className="text-xs text-metin-3">Onaylanan, reddedilen ve yanıt alınamayan her işlem burada.</span>
      </div>
      {satirlar && (
        <div className="max-h-72 overflow-auto rounded border border-cizgi">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-yuzey-2 text-left text-metin-3">
              <tr>
                <th className="px-2 py-1">Zaman</th>
                <th className="px-2 py-1">İşlem</th>
                <th className="px-2 py-1 text-right">Tutar</th>
                <th className="px-2 py-1">Sonuç</th>
                <th className="px-2 py-1">Onay / Kart</th>
                <th className="px-2 py-1">Kullanıcı</th>
              </tr>
            </thead>
            <tbody>
              {satirlar.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-3 text-center text-metin-3">
                    Henüz POS işlemi yok.
                  </td>
                </tr>
              )}
              {satirlar.map((s) => (
                <tr key={s.id} className="border-t border-cizgi align-top">
                  <td className="whitespace-nowrap px-2 py-1">{tarihSaatFormat(s.zaman)}</td>
                  <td className="px-2 py-1">{POS_TUR_ADI[s.tur] ?? s.tur}</td>
                  <td className="px-2 py-1 text-right font-mono">{paraFormat(s.tutar)}</td>
                  <td className="px-2 py-1">
                    <Rozet tur={POS_SONUC[s.sonuc]?.tur ?? 'notr'}>{POS_SONUC[s.sonuc]?.ad ?? s.sonuc}</Rozet>
                    {s.hata && <span className="block text-metin-3">{s.hata}</span>}
                  </td>
                  <td className="px-2 py-1 font-mono">{[s.onay_kodu, s.kart].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-2 py-1">{s.kullanici_adi ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DonanimSekmesi({ ayarlar, ayarla }: { ayarlar: Record<string, string>; ayarla: (a: string, d: string) => void }) {
  const [test, setTest] = useState<{ basarili: boolean; hata?: string; onizleme?: string } | null>(null);
  const yaziciTipi = ayarlar[AYAR.YAZICI_TIPI] ?? 'YOK';

  return (
    /*
     * İki sütun: solda ayarlar, sağda KALICI önizleme.
     *
     * Önizleme bir düğmenin arkasındayken kimse açmıyordu; ayarı değiştiren
     * kişinin görmesi gereken şey tam da o an. Sağdaki sütun ekranda zaten boş
     * duruyordu. Dar ekranda önizleme ayarların altına düşer.
     */
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <div className="grid gap-3 xl:max-w-2xl xl:flex-1">
        <Alan etiket="Fiş yazıcısı bağlantısı">
          <select
            className="alan"
            value={ayarlar[AYAR.YAZICI_TIPI] ?? 'YOK'}
            onChange={(e) => ayarla(AYAR.YAZICI_TIPI, e.target.value)}
          >
            <option value="YOK">Yazıcı yok (ekranda önizleme)</option>
            <option value="USB">USB (bu bilgisayara bağlı)</option>
            <option value="AG">Ethernet (ağ üzerinden)</option>
            <option value="OTOMATIK">Otomatik — önce USB, olmazsa Ethernet</option>
            <option value="DOSYA">Dosya / COM portu (eski kurulum)</option>
            <option value="WINDOWS_PAYLASIM">Windows paylaşımı, UNC (eski kurulum)</option>
          </select>
        </Alan>

        {/* USB seçimi: kullanıcı UNC yolunu ezberlemesin, listeden seçsin. */}
        {(yaziciTipi === 'USB' || yaziciTipi === 'OTOMATIK') && (
          <UsbYaziciSecici seciliAd={ayarlar[AYAR.YAZICI_USB_ADI] ?? ''} onSec={(ad) => ayarla(AYAR.YAZICI_USB_ADI, ad)} />
        )}

        {(yaziciTipi === 'AG' || yaziciTipi === 'OTOMATIK' || yaziciTipi === 'DOSYA' || yaziciTipi === 'WINDOWS_PAYLASIM') && (
          <Alan
            etiket={yaziciTipi === 'AG' || yaziciTipi === 'OTOMATIK' ? 'Ethernet yazıcı adresi' : 'Yazıcı hedefi'}
            ipucu={
              yaziciTipi === 'AG' || yaziciTipi === 'OTOMATIK'
                ? 'Yazıcının IP adresi ve portu. Örn. 192.168.1.50:9100 (port yazılmazsa 9100 kullanılır).'
                : 'COM portu için COM1 · Paylaşım için \\\\PC\\Yazici'
            }
          >
            <input
              className="alan font-mono"
              placeholder="192.168.1.50:9100"
              value={ayarlar[AYAR.YAZICI_HEDEF] ?? ''}
              onChange={(e) => ayarla(AYAR.YAZICI_HEDEF, e.target.value)}
            />
          </Alan>
        )}

        {yaziciTipi === 'OTOMATIK' && (
          <p className="rounded border border-bilgi-cizgi bg-bilgi-yumusak px-3 py-2 text-xs text-metin-2">
            Her fişte <strong>önce USB</strong> denenir; yazıcı kapalı ya da kablosu çıkmışsa <strong>Ethernet</strong>
            adresine gönderilir. Kasiyerin arıza anında ayar değiştirmesi gerekmez.
          </p>
        )}
        <Alan etiket="Satır genişliği (karakter)" ipucu="80 mm kağıt genelde 48, 58 mm kağıt 32 karakterdir.">
          <input
            className="alan sayi"
            value={ayarlar[AYAR.YAZICI_GENISLIK] ?? '48'}
            onChange={(e) => ayarla(AYAR.YAZICI_GENISLIK, e.target.value)}
          />
        </Alan>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={(ayarlar[AYAR.OTOMATIK_FIS] ?? '1') === '1'}
            onChange={(e) => ayarla(AYAR.OTOMATIK_FIS, e.target.checked ? '1' : '0')}
          />
          Satış sonrası fişi otomatik yazdır
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={(ayarlar[AYAR.CEKMECE_ACIK] ?? '1') === '1'}
            onChange={(e) => ayarla(AYAR.CEKMECE_ACIK, e.target.checked ? '1' : '0')}
          />
          Nakit ödemede para çekmecesini aç
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={(ayarlar[AYAR.YAZICI_GORSEL_FIS] ?? '1') === '1'}
            onChange={(e) => ayarla(AYAR.YAZICI_GORSEL_FIS, e.target.checked ? '1' : '0')}
          />
          <span>
            Fişi görüntü olarak bas (Türkçe karakterler için)
            <span className="mt-0.5 block text-xs text-metin-4">
              Harfleri uygulama çizer; yazıcının kendi fontu ve kod sayfası devreye girmez. Kapatırsanız fiş metin olarak
              basılır ve Türkçe harfler yazıcının ayarına kalır.
            </span>
          </span>
        </label>

        <div>
          <button
            type="button"
            className="tus-ikincil"
            onClick={async () => {
              try {
                setTest(await cagir('ayar.yaziciTest'));
              } catch (hata) {
                hatayiBildir(hata, 'Yazıcı testi');
              }
            }}
          >
            Test Fişi Yazdır
          </button>
          {test && (
            <div className="mt-2">
              {test.basarili ? <Rozet tur="basari">Yazdırma başarılı</Rozet> : <Rozet tur="tehlike">{test.hata}</Rozet>}
            </div>
          )}
        </div>

        <EtiketYaziciBolumu ayarlar={ayarlar} ayarla={ayarla} />

        <div className="rounded border border-cizgi bg-yuzey-3 p-3 text-xs text-metin-3">
          <p className="font-medium text-metin-2">Barkod okuyucu</p>
          <p>
            USB HID (klavye emülasyonu) okuyucular sürücüsüz çalışır — ayar gerekmez. Okuyucunun sonuna "Enter" göndermesi
            yeterlidir.
          </p>
          <p className="mt-2 font-medium text-metin-2">Etiket basan terazi</p>
          <p>Barkodlu etiket basan teraziler ayar gerektirmez (terazi barkodu okunur). Kasaya bağlı terazi aşağıdadır.</p>
        </div>

        <TeraziAyarlari ayarlar={ayarlar} ayarla={ayarla} />

        <PosAyarlari ayarlar={ayarlar} ayarla={ayarla} />
      </div>

      <aside className="xl:sticky xl:top-4 xl:w-[400px] xl:shrink-0">
        <OnizlemePaneli ayarlar={ayarlar} />
      </aside>
    </div>
  );
}

/**
 * Kalıcı önizleme paneli — değer değişir değişmez yenilenir.
 *
 * Ayarlar ekranındaki değerler KAYDEDİLMEDEN gönderilir: veritabanı o an hâlâ
 * eskisini tutuyor, ama kullanıcının görmek istediği yazdığı şeyin sonucu.
 * Ana süreç bu değerleri yalnız önizlemede kullanır, baskıda değil.
 */
function OnizlemePaneli({ ayarlar }: { ayarlar: Record<string, string> }) {
  const [fis, setFis] = useState<FisOnizlemeVerisi | null>(null);
  const [etiket, setEtiket] = useState<EtiketOnizlemeVerisi | null>(null);
  const etiketVar = (ayarlar[AYAR.ETIKET_YAZICI_TIPI] ?? 'YOK') !== 'YOK';

  useEffect(() => {
    /*
     * Kısa gecikme: kullanıcı "40" yazarken alan bir an "4" olur ve her tuşta
     * ana sürece gidip gelmek gereksiz. 200 ms yazmayı bölmeyecek kadar kısa,
     * her tuşa koşmayacak kadar uzun.
     */
    const zamanlayici = setTimeout(() => {
      void cagir<FisOnizlemeVerisi>('ayar.fisOnizleme', { ayarlar })
        .then(setFis)
        .catch(() => setFis(null));
      void cagir<EtiketOnizlemeVerisi>('etiket.onizleme', { ayarlar })
        .then(setEtiket)
        .catch(() => setEtiket(null));
    }, 200);
    return () => clearTimeout(zamanlayici);
  }, [ayarlar]);

  return (
    <div className="space-y-4">
      <section className="kart p-3">
        <h3 className="mb-1 text-sm font-semibold">Fiş Önizleme</h3>
        <p className="mb-2 text-xs text-metin-4">
          Kağıtta böyle duracak{fis ? ` — ${fis.satirGenisligi} karakterlik satır` : ''}
        </p>
        {fis ? <FisOnizleme veri={fis} /> : <p className="text-xs text-metin-4">Hazırlanıyor…</p>}
      </section>

      <section className="kart p-3">
        <h3 className="mb-1 text-sm font-semibold">Etiket Önizleme</h3>
        {etiketVar ? (
          <>
            <p className="mb-2 text-xs text-metin-4">Etikette böyle duracak — örnek ürünle</p>
            {etiket ? <EtiketOnizleme veri={etiket} olcek={5} /> : <p className="text-xs text-metin-4">Hazırlanıyor…</p>}
          </>
        ) : (
          <p className="text-xs text-metin-4">
            Etiket yazıcısı tanımlı değil. Soldaki <strong>Etiket (Barkod) Yazıcısı</strong> bölümünden bağlantıyı seçin; önizleme
            burada canlanır.
          </p>
        )}
      </section>
    </div>
  );
}

function SenkronSekmesi({
  ayarlar,
  ayarla,
  lisans,
  cihazId,
}: {
  ayarlar: Record<string, string>;
  ayarla: (a: string, d: string) => void;
  lisans?: { seviye: string; mesaj: string | null; lisansBitis: string | null };
  cihazId: string;
}) {
  const [aktivasyonAcik, setAktivasyonAcik] = useState(false);
  const [mutabakat, setMutabakat] = useState<Record<string, unknown> | null>(null);

  return (
    <div className="grid max-w-2xl gap-3">
      <Alan etiket="Senkron sunucu adresi" ipucu="Örn. https://api.marketiniz.com">
        <input
          className="alan font-mono"
          value={ayarlar[AYAR.SENKRON_URL] ?? ''}
          onChange={(e) => ayarla(AYAR.SENKRON_URL, e.target.value)}
        />
      </Alan>
      <Alan etiket="Senkron modu">
        <select
          className="alan"
          value={ayarlar[AYAR.SENKRON_MOD] ?? 'MANUEL'}
          onChange={(e) => ayarla(AYAR.SENKRON_MOD, e.target.value)}
        >
          <option value="MANUEL">Manuel (tek tuş)</option>
          <option value="GUN_SONU">Gün sonunda</option>
          <option value="FIRSATCI">Fırsatçı (internet varsa arka planda)</option>
        </select>
      </Alan>
      <Alan etiket="Fırsatçı senkron aralığı (dakika)">
        <input
          className="alan sayi"
          value={ayarlar[AYAR.SENKRON_ARALIK_DK] ?? '15'}
          onChange={(e) => ayarla(AYAR.SENKRON_ARALIK_DK, e.target.value)}
        />
      </Alan>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={(ayarlar[AYAR.SENKRON_GUN_SONU] ?? '1') === '1'}
          onChange={(e) => ayarla(AYAR.SENKRON_GUN_SONU, e.target.checked ? '1' : '0')}
        />
        Gün sonunda otomatik senkron dene
      </label>

      <div className="rounded border border-cizgi bg-yuzey-3 p-3">
        <p className="text-sm font-medium">Lisans</p>
        <p className="mt-1 text-sm text-metin-3">
          Durum: <strong>{lisans?.seviye ?? '—'}</strong>
          {lisans?.lisansBitis ? ` · Bitiş: ${lisans.lisansBitis}` : ''}
        </p>
        {lisans?.mesaj && <p className="mt-1 text-xs text-uyari">{lisans.mesaj}</p>}
        <p className="mt-1 text-xs text-metin-4">
          Cihaz kimliği: <span className="font-mono">{cihazId}</span>
        </p>
        <p className="mt-2 text-xs text-metin-4">
          Lisans sorununda satış ve tahsilat <strong>her koşulda</strong> çalışmaya devam eder; yalnız yönetim özellikleri
          kısıtlanır.
        </p>
        <button type="button" className="tus-ikincil mt-2" onClick={() => setAktivasyonAcik(true)}>
          Cihazı Aktive Et
        </button>
      </div>

      <div>
        <button
          type="button"
          className="tus-ikincil"
          onClick={async () => {
            try {
              setMutabakat(await cagir<Record<string, unknown>>('senkron.mutabakat'));
              bildir.basari('Mutabakat tamamlandı');
            } catch (hata) {
              hatayiBildir(hata, 'Mutabakat');
            }
          }}
        >
          Yerel–Bulut Mutabakatı
        </button>
        {mutabakat && (
          <div className="mt-2 rounded border border-cizgi bg-yuzey-3 p-3 text-xs">
            {mutabakat.uyumlu ? (
              <Rozet tur="basari">Kayıt sayıları uyumlu</Rozet>
            ) : (
              <>
                <Rozet tur="uyari">Farklar var</Rozet>
                <pre className="mt-2 overflow-auto">{JSON.stringify(mutabakat.farklar, null, 2)}</pre>
                <p className="mt-1 text-metin-4">Bekleyen olay: {String(mutabakat.bekleyenOlay)}</p>
              </>
            )}
          </div>
        )}
      </div>

      <SenkronTanilama />

      <AktivasyonDiyalogu
        acik={aktivasyonAcik}
        sunucuUrl={ayarlar[AYAR.SENKRON_URL] ?? ''}
        onKapat={() => setAktivasyonAcik(false)}
      />
    </div>
  );
}

/**
 * Senkron tanılama: çakışmalar ve reddedilen olaylar (§7.4, §7.6).
 *
 * İkisi de arka uçta hazırdı ama hiçbir ekran okumuyordu. Özellikle REDDEDİLEN
 * olaylar önemli: sunucunun kalıcı olarak kabul etmediği bir kayıt hiçbir yerde
 * görünmüyordu — sessizce kayboluyordu. Bu ekran onları görünür kılar.
 */
function SenkronTanilama() {
  const [cakismalar, setCakismalar] = useState<
    { id: string; entity: string; entity_id: string; cozum: string; cozum_zamani: string }[]
  >([]);
  const [hatalilar, setHatalilar] = useState<
    { id: string; olay_tipi: string; entity: string; deneme_sayisi: number; son_hata: string | null }[]
  >([]);
  const [yuklendi, setYuklendi] = useState(false);

  const yukle = useCallback(async () => {
    try {
      const [c, h] = await Promise.all([
        cagir<typeof cakismalar>('senkron.cakismalar'),
        cagir<typeof hatalilar>('senkron.hataliOlaylar'),
      ]);
      setCakismalar(c);
      setHatalilar(h);
    } catch (hata) {
      hatayiBildir(hata, 'Senkron tanılama');
    } finally {
      setYuklendi(true);
    }
  }, []);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  // Her şey yolundayken bölümü hiç göstermiyoruz: temiz kurulumda boş iki tablo
  // kullanıcıya bir şey anlatmaz, yalnız ekranı doldurur.
  if (!yuklendi || (cakismalar.length === 0 && hatalilar.length === 0)) return null;

  return (
    <div className="rounded border border-uyari-cizgi bg-uyari-yumusak p-3">
      <div className="flex items-center gap-2">
        <p className="mr-auto text-sm font-medium text-uyari">Senkron tanılama</p>
        <button type="button" className="tus-ikincil px-2 py-1 text-xs" onClick={() => void yukle()}>
          Yenile
        </button>
      </div>

      {hatalilar.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-metin-2">Gönderilemeyen kayıtlar ({hatalilar.length})</p>
          <p className="mb-1 text-xs text-metin-4">
            Sunucu bu kayıtları kabul etmedi. Kasadaki veri doğru; merkez bunları görmüyor.
          </p>
          <table className="tablo text-xs">
            <thead>
              <tr>
                <th>Tür</th>
                <th className="text-right">Deneme</th>
                <th>Hata</th>
              </tr>
            </thead>
            <tbody>
              {hatalilar.slice(0, 10).map((h) => (
                <tr key={h.id}>
                  <td>{h.olay_tipi}</td>
                  <td className="sayi text-right">{h.deneme_sayisi}</td>
                  <td className="text-metin-3">{h.son_hata ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cakismalar.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-metin-2">Çakışmalar ({cakismalar.length})</p>
          <p className="mb-1 text-xs text-metin-4">
            Aynı kayıt iki yerde değişti; en son değişiklik kazandı. Kaybeden taraf burada listelenir.
          </p>
          <table className="tablo text-xs">
            <thead>
              <tr>
                <th>Kayıt</th>
                <th>Çözüm</th>
                <th>Zaman</th>
              </tr>
            </thead>
            <tbody>
              {cakismalar.slice(0, 10).map((c) => (
                <tr key={c.id}>
                  <td>{c.entity}</td>
                  <td>{c.cozum}</td>
                  <td className="text-metin-3">{tarihSaatFormat(c.cozum_zamani)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AktivasyonDiyalogu({ acik, sunucuUrl, onKapat }: { acik: boolean; sunucuUrl: string; onKapat: () => void }) {
  const [anahtar, setAnahtar] = useState('');
  const [cihazAdi, setCihazAdi] = useState('Kasa 1');
  const [calisiyor, setCalisiyor] = useState(false);

  const aktiveEt = async () => {
    setCalisiyor(true);
    try {
      const sonuc = await cagir<{ basarili: boolean; hata?: string }>('senkron.aktivasyon', {
        sunucuUrl,
        lisansAnahtari: anahtar.trim(),
        cihazAdi: cihazAdi.trim(),
      });
      if (sonuc.basarili) {
        bildir.basari('Cihaz aktive edildi');
        onKapat();
      } else bildir.hata('Aktivasyon başarısız', sonuc.hata);
    } catch (hata) {
      hatayiBildir(hata, 'Aktivasyon');
    } finally {
      setCalisiyor(false);
    }
  };

  return (
    <Diyalog
      acik={acik}
      baslik="Cihaz Aktivasyonu"
      aciklama="Lisans anahtarınızı girerek bu kasayı bulut hesabınıza bağlayın."
      genislik="dar"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={aktiveEt} disabled={calisiyor || !anahtar.trim() || !sunucuUrl}>
            Aktive Et
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {!sunucuUrl && <Rozet tur="uyari">Önce senkron sunucu adresini girip kaydedin.</Rozet>}
        <Alan etiket="Lisans anahtarı">
          <input className="alan font-mono" value={anahtar} onChange={(e) => setAnahtar(e.target.value)} data-odak />
        </Alan>
        <Alan etiket="Cihaz adı" ipucu="Panelde bu isimle görünür.">
          <input className="alan" value={cihazAdi} onChange={(e) => setCihazAdi(e.target.value)} />
        </Alan>
        <p className="text-xs text-metin-4">İnternet yoksa çevrimdışı yedek anahtar ile geçici aktivasyon yapılabilir.</p>
      </div>
    </Diyalog>
  );
}

function YedekSekmesi({ ayarlar, ayarla }: { ayarlar: Record<string, string>; ayarla: (a: string, d: string) => void }) {
  const [yedekler, setYedekler] = useState<{ dosya: string; yol: string; boyut: number; zaman: string; sifreli: boolean }[]>([]);
  const [calisiyor, setCalisiyor] = useState(false);

  const yukle = useCallback(async () => {
    try {
      setYedekler(await cagir('yedek.listele'));
    } catch (hata) {
      hatayiBildir(hata, 'Yedek listesi');
    }
  }, []);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Alan etiket="İkincil yedek klasörü" ipucu="USB bellek veya ağ klasörü — ikinci kopya buraya da yazılır.">
          <input
            className="alan font-mono"
            value={ayarlar[AYAR.YEDEK_IKINCIL_KLASOR] ?? ''}
            onChange={(e) => ayarla(AYAR.YEDEK_IKINCIL_KLASOR, e.target.value)}
          />
        </Alan>
        <Alan etiket="Saklanacak yedek sayısı">
          <input
            className="alan sayi"
            value={ayarlar[AYAR.YEDEK_SAKLANAN_ADET] ?? '10'}
            onChange={(e) => ayarla(AYAR.YEDEK_SAKLANAN_ADET, e.target.value)}
          />
        </Alan>
        <Alan etiket="Otomatik yedek sıklığı (saat)">
          <input
            className="alan sayi"
            value={ayarlar[AYAR.YEDEK_SIKLIK_SAAT] ?? '6'}
            onChange={(e) => ayarla(AYAR.YEDEK_SIKLIK_SAAT, e.target.value)}
          />
        </Alan>
      </div>

      <button
        type="button"
        className="tus-birincil"
        disabled={calisiyor}
        onClick={async () => {
          setCalisiyor(true);
          try {
            const y = await cagir<{ dosya: string }>('yedek.al', { etiket: 'elle' });
            bildir.basari('Yedek alındı', y.dosya);
            await yukle();
          } catch (hata) {
            hatayiBildir(hata, 'Yedekleme');
          } finally {
            setCalisiyor(false);
          }
        }}
      >
        Şimdi Yedek Al
      </button>

      <div>
        <h3 className="mb-2 font-semibold">Mevcut Yedekler</h3>
        {yedekler.length === 0 ? (
          <p className="text-sm text-metin-4">Henüz yedek yok.</p>
        ) : (
          <table className="tablo">
            <thead>
              <tr>
                <th>Dosya</th>
                <th>Tarih</th>
                <th className="text-right">Boyut</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {yedekler.map((y) => (
                <tr key={y.yol}>
                  <td className="font-mono text-xs">{y.dosya}</td>
                  <td className="text-metin-3">{tarihSaatFormat(y.zaman)}</td>
                  <td className="sayi text-right">{(y.boyut / 1024 / 1024).toFixed(2)} MB</td>
                  <td className="space-x-2">
                    <button
                      type="button"
                      className="text-xs text-bilgi hover:underline"
                      onClick={async () => {
                        const sonuc = await cagir<{ saglam: boolean; detay: string }>('yedek.dogrula', { yol: y.yol });
                        if (sonuc.saglam) bildir.basari('Yedek sağlam');
                        else bildir.hata('Yedek bozuk', sonuc.detay);
                      }}
                    >
                      Doğrula
                    </button>
                    <button
                      type="button"
                      className="text-xs text-tehlike hover:underline"
                      onClick={async () => {
                        if (
                          !window.confirm(
                            'Mevcut veritabanı bu yedekle değiştirilecek ve uygulama yeniden başlatılmalıdır. Devam edilsin mi?',
                          )
                        )
                          return;
                        try {
                          await cagir('yedek.geriYukle', { yol: y.yol });
                          bildir.uyari('Geri yükleme tamamlandı', 'Lütfen uygulamayı yeniden başlatın.');
                        } catch (hata) {
                          hatayiBildir(hata, 'Geri yükleme');
                        }
                      }}
                    >
                      Geri Yükle
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded border border-bilgi-cizgi bg-bilgi-yumusak p-3 text-xs text-bilgi">
        <p className="font-medium">Felaket kurtarma tatbikatı</p>
        <p>
          Test edilmemiş yedek, yedek sayılmaz. Ayda bir kez bir yedeği "Doğrula" ile kontrol edin; yılda bir kez yedek
          bilgisayarda geri yükleme denemesi yapın (RTO hedefi ≤ 2 saat).
        </p>
      </div>
    </div>
  );
}

/**
 * İşletim sistemine kurulu yazıcılardan seçim (§13.2).
 *
 * Seçim bir kez yapılır ve ayarda kalır. Liste Electron'dan gelir; yazıcı
 * sonradan takılırsa "Listeyi yenile" ile tazelenir.
 *
 * NOT: fiş RAW ESC/POS olarak basılır, yani yazıcıya doğrudan bayt gönderilir.
 * Windows'ta bunun yolu yazıcının PAYLAŞIMA açık olmasıdır; program seçilen
 * addan `\\localhost\<ad>` yolunu kurar. Bu yüzden ekranda da söylenir.
 */
function UsbYaziciSecici({ seciliAd, onSec }: { seciliAd: string; onSec: (ad: string) => void }) {
  const [liste, setListe] = useState<{ ad: string; aciklama: string; varsayilan: boolean }[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);

  const yenile = useCallback(async () => {
    setYukleniyor(true);
    try {
      const veri = await cagir<{ yazicilar: { ad: string; aciklama: string; varsayilan: boolean }[] }>('ayar.yazicilariListele');
      setListe(veri.yazicilar);
    } catch (hata) {
      hatayiBildir(hata, 'Yazıcı listesi');
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    void yenile();
  }, [yenile]);

  return (
    <Alan etiket="USB yazıcı" ipucu="Bir kez seçin, ayar kalıcıdır. Yazıcının Windows'ta paylaşıma açık olması gerekir.">
      <div className="flex gap-2">
        <select className="alan flex-1" value={seciliAd} onChange={(e) => onSec(e.target.value)}>
          <option value="">— seçilmedi —</option>
          {seciliAd && !liste.some((y) => y.ad === seciliAd) && (
            // Kayıtlı yazıcı şu an bağlı değilse seçim kaybolmasın.
            <option value={seciliAd}>{seciliAd} (şu an bağlı değil)</option>
          )}
          {liste.map((y) => (
            <option key={y.ad} value={y.ad}>
              {y.ad}
              {y.varsayilan ? ' (varsayılan)' : ''}
            </option>
          ))}
        </select>
        <button type="button" className="tus-ikincil" onClick={() => void yenile()} disabled={yukleniyor}>
          {yukleniyor ? 'Aranıyor…' : 'Listeyi Yenile'}
        </button>
      </div>
      {liste.length === 0 && !yukleniyor && (
        <span className="mt-1 block text-xs text-uyari">
          Kurulu yazıcı bulunamadı. Yazıcıyı Windows'a kurup paylaşıma açtıktan sonra listeyi yenileyin.
        </span>
      )}
    </Alan>
  );
}

/**
 * Etiket (barkod) yazıcısı — fiş yazıcısından AYRI bir cihaz (§13.3).
 *
 * Ayrı olmasının sebebi teknik: fiş yazıcısı ESC/POS konuşur ve "satır satır
 * ak, sonunda kes" mantığıyla çalışır; etiket yazıcısı TSPL ya da ZPL konuşur
 * ve fiziksel ölçü bilir. Aynı baytları göndermek işe yaramaz.
 */
function EtiketYaziciBolumu({ ayarlar, ayarla }: { ayarlar: Record<string, string>; ayarla: (a: string, d: string) => void }) {
  const [test, setTest] = useState<{ basarili: boolean; hata?: string } | null>(null);
  const tip = ayarlar[AYAR.ETIKET_YAZICI_TIPI] ?? 'YOK';

  const sayiAlani = (anahtar: string, etiket: string, varsayilan: string, ipucu?: string) => (
    <Alan etiket={etiket} ipucu={ipucu}>
      <input
        className="alan sayi"
        inputMode="decimal"
        value={ayarlar[anahtar] ?? varsayilan}
        onChange={(e) => ayarla(anahtar, e.target.value)}
      />
    </Alan>
  );

  return (
    <div className="grid gap-3 rounded border border-cizgi bg-yuzey-3 p-3">
      <h3 className="font-semibold">Etiket (Barkod) Yazıcısı</h3>
      <p className="text-xs text-metin-3">
        Raf ve ürün etiketleri buradan basılır. Fiş yazıcısından ayrı bir cihazdır ve farklı bir komut dili konuşur; fiş yazıcısı
        ayarları buraya uygulanmaz.
      </p>

      <Alan etiket="Bağlantı">
        <select className="alan" value={tip} onChange={(e) => ayarla(AYAR.ETIKET_YAZICI_TIPI, e.target.value)}>
          <option value="YOK">Etiket yazıcısı yok</option>
          <option value="USB">USB (bu bilgisayara bağlı)</option>
          <option value="AG">Ethernet (ağ üzerinden)</option>
          <option value="OTOMATIK">Otomatik — önce USB, olmazsa Ethernet</option>
          <option value="DOSYA">Dosyaya yaz (yazıcı gelmeden denemek için)</option>
          <option value="WINDOWS_PAYLASIM">Windows paylaşımı, UNC</option>
        </select>
      </Alan>

      {tip !== 'YOK' && (
        <>
          {(tip === 'USB' || tip === 'OTOMATIK') && (
            <UsbYaziciSecici
              seciliAd={ayarlar[AYAR.ETIKET_YAZICI_USB_ADI] ?? ''}
              onSec={(ad) => ayarla(AYAR.ETIKET_YAZICI_USB_ADI, ad)}
            />
          )}

          {(tip === 'AG' || tip === 'OTOMATIK' || tip === 'DOSYA' || tip === 'WINDOWS_PAYLASIM') && (
            <Alan
              etiket={tip === 'AG' || tip === 'OTOMATIK' ? 'Ethernet yazıcı adresi' : 'Hedef'}
              ipucu={
                tip === 'AG' || tip === 'OTOMATIK'
                  ? 'Örn. 192.168.1.60:9100'
                  : /*
                     * Dosya modunun VARSAYILAN BİR YERİ YOKTUR: komutlar tam
                     * olarak buraya yazdığınız yola gider. Boş bırakılırsa
                     * yazdırma "hedef tanımlı değil" diye başarısız olur.
                     */
                    'Tam dosya yolu yazın; etiket komutları oraya eklenir. Windows: C:\\etiket-test.txt · macOS/Linux: /Users/ad/Desktop/etiket-test.txt'
              }
            >
              <input
                className="alan font-mono"
                placeholder={tip === 'AG' || tip === 'OTOMATIK' ? '192.168.1.60:9100' : '/Users/ad/Desktop/etiket-test.txt'}
                value={ayarlar[AYAR.ETIKET_YAZICI_HEDEF] ?? ''}
                onChange={(e) => ayarla(AYAR.ETIKET_YAZICI_HEDEF, e.target.value)}
              />
            </Alan>
          )}

          <Alan
            etiket="Komut dili"
            ipucu="TSC, Argox, Godex, Xprinter → TSPL. Zebra → ZPL. Yanlış seçilirse yazıcı boş kağıt çıkarır ya da hiç basmaz."
          >
            <select
              className="alan"
              value={ayarlar[AYAR.ETIKET_DILI] ?? 'TSPL'}
              onChange={(e) => ayarla(AYAR.ETIKET_DILI, e.target.value)}
            >
              <option value="TSPL">TSPL — TSC, Argox, Godex, Xprinter</option>
              <option value="ZPL">ZPL — Zebra</option>
            </select>
          </Alan>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {sayiAlani(AYAR.ETIKET_EN_MM, 'Etiket eni (mm)', '40')}
            {sayiAlani(AYAR.ETIKET_BOY_MM, 'Etiket boyu (mm)', '30')}
            {sayiAlani(AYAR.ETIKET_BOSLUK_MM, 'Aradaki boşluk (mm)', '2', 'İki etiket arasındaki kesim aralığı')}
            {sayiAlani(AYAR.ETIKET_DPI, 'Çözünürlük (dpi)', '203', '203 ya da 300 — yazıcının etiketinde yazar')}
            {sayiAlani(AYAR.ETIKET_SUTUN, 'Yan yana etiket', '1')}
            {sayiAlani(AYAR.ETIKET_ISI, 'Isı / koyuluk', '8', '0-15. Baskı soluksa artırın')}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={(ayarlar[AYAR.ETIKET_RAF_GOSTER] ?? '0') === '1'}
                onChange={(e) => ayarla(AYAR.ETIKET_RAF_GOSTER, e.target.checked ? '1' : '0')}
              />
              Raf kodunu yaz
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={(ayarlar[AYAR.ETIKET_BIRIM_FIYAT_GOSTER] ?? '1') === '1'}
                onChange={(e) => ayarla(AYAR.ETIKET_BIRIM_FIYAT_GOSTER, e.target.checked ? '1' : '0')}
              />
              Kg/lt ürünlerde birim fiyat yaz
            </label>
          </div>

          <div>
            <button
              type="button"
              className="tus-ikincil"
              onClick={async () => {
                try {
                  setTest(await cagir('etiket.kalibrasyon'));
                } catch (hata) {
                  hatayiBildir(hata, 'Kalibrasyon');
                }
              }}
            >
              Kalibrasyon Etiketi Bas
            </button>

            {test &&
              (test.basarili ? (
                <span className="ml-2">
                  <Rozet tur="basari">Gönderildi</Rozet>
                </span>
              ) : (
                <span className="ml-2">
                  <Rozet tur="tehlike">{test.hata}</Rozet>
                </span>
              ))}
            {/*
              Barkod yazıcılarında ölçü tutturmak deneme yanılma işidir; bu
              olmadan kullanıcı hangi mm değerini oynatacağını bilemez.
            */}
            <p className="mt-2 text-xs text-metin-3">
              Etiketin dört kenarına çerçeve basar. <strong>Çerçeve etikete tam oturuyorsa</strong> ölçüler doğrudur; taşıyorsa ya
              da içeride kalıyorsa en/boy değerlerini düzeltip tekrar basın.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
