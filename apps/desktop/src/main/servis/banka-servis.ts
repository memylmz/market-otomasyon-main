/**
 * Banka / POS defterine elle hareket (§ banka defteri).
 *
 * Türetilemeyenler buradan girilir: açılış bakiyesi, banka/POS kesintisi,
 * kasa↔banka aktarımı ve düzeltme. Aktarımda para iki defterde birden yer
 * değiştirir; kasa hareketi AYNI işlemde yazılır ki biri yazılıp diğeri
 * yazılmadan kalmasın.
 */

import { BANKA_HAREKET_TURU, hatalar, simdi, uuid, type BankaHareketTuru, type Kurus } from '@market/shared';
import { bankaHareketiYaz } from '../depo/banka.js';
import { denetimYaz } from '../depo/ozet.js';
import { olayYaz } from '../depo/senkron.js';
import { yetkiIste, type Aktor, type Baglam } from './baglam.js';
import { kasaHareketi } from './kasa-servis.js';

/** Bankadan ÇIKAN türler — tutar eksi işaretle yazılır. */
const CIKAN: ReadonlySet<BankaHareketTuru> = new Set(['KOMISYON', 'BANKADAN_KASAYA']);

export function bankaHareketiEkle(
  baglam: Baglam,
  aktor: Aktor,
  girdi: { tur: BankaHareketTuru; tutar: Kurus; aciklama: string; yon?: 'GIRIS' | 'CIKIS' },
): string {
  yetkiIste(aktor, 'kasa.giris_cikis');
  if (!(BANKA_HAREKET_TURU as readonly string[]).includes(girdi.tur)) throw hatalar.dogrulama('Geçersiz banka hareketi.');
  if (!Number.isInteger(girdi.tutar) || girdi.tutar <= 0) throw hatalar.dogrulama('Tutar sıfırdan büyük olmalıdır.');
  if (!girdi.aciklama.trim()) throw hatalar.dogrulama('Açıklama zorunludur.');

  // Düzeltme iki yönlü olabilir (ekstreyle fark + ya da −); diğerlerinde yön türden gelir.
  const cikis = girdi.tur === 'DUZELTME' ? girdi.yon === 'CIKIS' : CIKAN.has(girdi.tur);
  const isaretli = cikis ? -girdi.tutar : girdi.tutar;

  const { vt, cihazId } = baglam;
  const zaman = simdi();

  return vt.islem(() => {
    let kasaHareketId: string | null = null;
    if (girdi.tur === 'BANKADAN_KASAYA') {
      kasaHareketId = kasaHareketi(baglam, aktor, 'GIRIS', girdi.tutar, `Bankadan çekildi: ${girdi.aciklama.trim()}`);
    } else if (girdi.tur === 'KASADAN_BANKAYA') {
      kasaHareketId = kasaHareketi(baglam, aktor, 'CIKIS', girdi.tutar, `Bankaya yatırıldı: ${girdi.aciklama.trim()}`);
    }

    const id = bankaHareketiYaz(
      vt,
      {
        tur: girdi.tur,
        tutar: isaretli,
        aciklama: girdi.aciklama.trim(),
        kasa_hareket_id: kasaHareketId,
        kullanici_id: aktor.kullaniciId,
      },
      cihazId,
      zaman,
    );

    olayYaz(
      vt,
      {
        id: uuid(),
        olay_tipi: 'BANKA_HAREKETI',
        entity: 'banka_hareketi',
        entity_id: id,
        veri: {
          id,
          tur: girdi.tur,
          tutar: isaretli,
          aciklama: girdi.aciklama.trim(),
          kasa_hareket_id: kasaHareketId,
          kullanici_id: aktor.kullaniciId,
          tarih: zaman,
        },
        olusturma_zamani: zaman,
      },
      cihazId,
      zaman,
    );

    denetimYaz(
      vt,
      {
        kullanici_id: aktor.kullaniciId,
        islem: `BANKA_${girdi.tur}`,
        entity: 'banka_hareketi',
        entity_id: id,
        yeni_deger: { tutar: isaretli, aciklama: girdi.aciklama.trim() },
      },
      cihazId,
      zaman,
    );
    return id;
  });
}
