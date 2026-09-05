/**
 * Cari ekstresini WhatsApp / SMS / e-posta ile gönderme (§11.6).
 *
 * TASARIM KARARI: Hiçbir üçüncü taraf API'si kullanılmaz. Mesaj, işletim
 * sisteminin varsayılan uygulamasında (WhatsApp, SMS, posta istemcisi) **ön
 * doldurulmuş** olarak açılır; gönderme tuşuna kullanıcı basar. Böylece:
 *  - API anahtarı, abonelik ve internet bağımlılığı olmaz,
 *  - mesajın son hâlini insan görüp onaylar,
 *  - KVKK açısından "veri işleyen" bir sağlayıcı devreye girmez (§16.3).
 *
 * KVKK: Gönderim yalnız **açık rızası olan** carilerde etkindir (§16.1).
 * Rıza yoksa arayüz bunu açıkça söyler ve düğmeleri kapatır.
 */

import { useState } from 'react';
import { paraFormat, tarihFormat, type Kurus } from '@market/shared';
import { Diyalog, Rozet } from '../../bilesen/temel';
import { bildir } from '../../durum/bildirim';

export interface EkstreGonderHedefi {
  id: string;
  ad_unvan: string;
  telefon: string | null;
  eposta: string | null;
  bakiye: Kurus;
  iletisim_rizasi: boolean;
}

/** Telefonu wa.me / sms: için uluslararası biçime çevirir. */
export function telefonNormalize(ham: string | null): string | null {
  if (!ham) return null;
  const rakamlar = ham.replace(/\D/g, '');
  if (rakamlar.length === 0) return null;
  // 05XX XXX XX XX → 905XX...
  if (rakamlar.startsWith('0')) return '90' + rakamlar.slice(1);
  if (rakamlar.startsWith('90')) return rakamlar;
  if (rakamlar.length === 10) return '90' + rakamlar;
  return rakamlar;
}

export function varsayilanMesaj(cari: EkstreGonderHedefi, isletmeAdi: string): string {
  const borcMu = cari.bakiye > 0;
  const tutar = paraFormat(Math.abs(cari.bakiye));
  return [
    `Sayın ${cari.ad_unvan},`,
    '',
    borcMu
      ? `${tarihFormat(new Date().toISOString())} tarihi itibarıyla hesap bakiyeniz ${tutar} borç görünmektedir.`
      : cari.bakiye < 0
        ? `${tarihFormat(new Date().toISOString())} tarihi itibarıyla ${tutar} alacaklı görünmektesiniz.`
        : 'Hesabınız kapalıdır, borcunuz bulunmamaktadır.',
    '',
    `${isletmeAdi}`,
  ].join('\n');
}

export function EkstreGonderDiyalogu({
  acik,
  cari,
  isletmeAdi,
  onKapat,
}: {
  acik: boolean;
  cari: EkstreGonderHedefi | null;
  isletmeAdi: string;
  onKapat: () => void;
}) {
  const [mesaj, setMesaj] = useState('');
  const [ilkAcilis, setIlkAcilis] = useState(true);

  if (!cari) return null;

  // Diyalog her açıldığında mesajı tazele (cari değişmiş olabilir).
  if (acik && ilkAcilis) {
    setMesaj(varsayilanMesaj(cari, isletmeAdi));
    setIlkAcilis(false);
  }
  if (!acik && !ilkAcilis) setIlkAcilis(true);

  const telefon = telefonNormalize(cari.telefon);
  const rizaVar = cari.iletisim_rizasi;

  const ac = (url: string, kanal: string) => {
    if (!rizaVar) {
      bildir.hata('İletişim rızası yok', 'KVKK gereği rıza alınmadan ticari ileti gönderilemez.');
      return;
    }
    // Dış bağlantı varsayılan uygulamada açılır (ana süreç shell.openExternal'a yönlendirir).
    window.open(url, '_blank', 'noopener,noreferrer');
    bildir.bilgi(`${kanal} açıldı`, 'Mesajı kontrol edip gönderme tuşuna basın.');
    onKapat();
  };

  return (
    <Diyalog
      acik={acik}
      baslik="Ekstre / Bakiye Bildirimi Gönder"
      aciklama={cari.ad_unvan}
      onKapat={onKapat}
      altBilgi={
        <button type="button" className="tus-ikincil" onClick={onKapat}>
          Kapat
        </button>
      }
    >
      <div className="space-y-4">
        {!rizaVar && (
          <div className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak p-3 text-sm">
            <p className="font-medium text-tehlike">İletişim rızası alınmamış</p>
            <p className="mt-1 text-metin-2">
              KVKK gereği açık rıza olmadan ticari ileti gönderilemez. Cari kartını düzenleyip
              <strong> “SMS / WhatsApp / e-posta gönderimi için açık rıza alındı”</strong> kutusunu işaretleyin.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 text-sm">
          <Rozet tur={telefon ? 'basari' : 'notr'}>{telefon ? `Telefon: +${telefon}` : 'Telefon yok'}</Rozet>
          <Rozet tur={cari.eposta ? 'basari' : 'notr'}>{cari.eposta ? cari.eposta : 'E-posta yok'}</Rozet>
        </div>

        <label className="block">
          <span className="etiket">Mesaj</span>
          <textarea className="alan font-sans" rows={7} value={mesaj} onChange={(e) => setMesaj(e.target.value)} />
          <span className="mt-1 block text-xs text-metin-3">
            Gönderilmeden önce ilgili uygulamada tekrar düzenleyebilirsiniz.
          </span>
        </label>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            type="button"
            className="tus-birincil"
            disabled={!rizaVar || !telefon}
            onClick={() => ac(`https://wa.me/${telefon}?text=${encodeURIComponent(mesaj)}`, 'WhatsApp')}
          >
            WhatsApp
          </button>
          <button
            type="button"
            className="tus-ikincil"
            disabled={!rizaVar || !telefon}
            onClick={() => ac(`sms:+${telefon}?body=${encodeURIComponent(mesaj)}`, 'SMS')}
          >
            SMS
          </button>
          <button
            type="button"
            className="tus-ikincil"
            disabled={!rizaVar || !cari.eposta}
            onClick={() =>
              ac(
                `mailto:${cari.eposta}?subject=${encodeURIComponent(`${isletmeAdi} — Hesap Bakiyeniz`)}&body=${encodeURIComponent(mesaj)}`,
                'E-posta',
              )
            }
          >
            E-posta
          </button>
        </div>

        <p className="text-xs text-metin-3">
          Mesaj seçtiğiniz uygulamada açılır; gönderme işlemini siz onaylarsınız. Bu sistem sizin adınıza otomatik mesaj
          göndermez.
        </p>
      </div>
    </Diyalog>
  );
}
