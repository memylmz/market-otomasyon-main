/**
 * Senkron repository'si: outbox, durum ve çakışma kayıtları (§7, §8.3).
 *
 * Outbox deseninin özü: **her yerel yazma, ana tablolarla aynı transaction
 * içinde** buraya bir olay bırakır. Uygulama tam o anda çökse bile ya ikisi de
 * yazılmıştır ya da hiçbiri — senkronlanmamış değişiklik asla kaybolmaz.
 */

import { simdi, type OlayTipi, type ZamanDamgasi } from '@market/shared';
import type { Vt } from '../db/surucu.js';
import { boolToSayi, sayiToBool, yerTutucular, type HamSatir } from './ortak.js';

export interface OutboxOlayi {
  id: string;
  olay_tipi: OlayTipi;
  entity: string;
  entity_id: string;
  veri: string;
  olusturma_zamani: ZamanDamgasi;
  gonderildi_mi: boolean;
  synced_at: ZamanDamgasi | null;
  deneme_sayisi: number;
  son_hata: string | null;
  cihaz_id: string | null;
}

export interface OlayYazma {
  /** Olayın idempotency anahtarı. Verilmezse çağıran tarafından üretilmelidir. */
  id: string;
  olay_tipi: OlayTipi;
  entity: string;
  entity_id: string;
  veri: unknown;
  olusturma_zamani?: ZamanDamgasi;
}

/**
 * Outbox'a olay yazar. **Mutlaka** ana yazma ile aynı transaction içinde
 * çağrılmalıdır (§7.1).
 */
export function olayYaz(vt: Vt, olay: OlayYazma, cihazId: string, zaman: ZamanDamgasi = simdi()): void {
  vt.hazirla(
    `INSERT INTO sync_outbox (id, olay_tipi, entity, entity_id, veri, olusturma_zamani, gonderildi_mi, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).calistir(
    olay.id,
    olay.olay_tipi,
    olay.entity,
    olay.entity_id,
    JSON.stringify(olay.veri),
    olay.olusturma_zamani ?? zaman,
    cihazId,
  );
}

export function bekleyenOlaylar(vt: Vt, limit = 500): OutboxOlayi[] {
  return vt
    .hazirla(
      `SELECT id, olay_tipi, entity, entity_id, veri, olusturma_zamani, gonderildi_mi, synced_at,
              deneme_sayisi, son_hata, cihaz_id
       FROM sync_outbox WHERE gonderildi_mi = 0
       ORDER BY olusturma_zamani, rowid LIMIT ?`,
    )
    .tumu<HamSatir<OutboxOlayi, 'gonderildi_mi'>>(limit)
    .map((s) => ({ ...s, gonderildi_mi: sayiToBool(s.gonderildi_mi) }));
}

export function bekleyenSayisi(vt: Vt): number {
  const satir = vt.hazirla('SELECT COUNT(*) AS adet FROM sync_outbox WHERE gonderildi_mi = 0').tek<{ adet: number }>();
  return satir?.adet ?? 0;
}

/**
 * Kabul edilen olayları arşivler. Kayıtlar **silinmez** (§7.3 adım 4):
 * denetim izi ve yeniden gönderim analizi için saklanır.
 */
export function olaylariIsaretle(vt: Vt, idler: readonly string[], zaman: ZamanDamgasi = simdi()): number {
  if (idler.length === 0) return 0;
  let etkilenen = 0;
  // SQLite değişken sınırına takılmamak için parçalayarak çalış.
  for (let i = 0; i < idler.length; i += 400) {
    const parca = idler.slice(i, i + 400);
    etkilenen += vt
      .hazirla(
        `UPDATE sync_outbox SET gonderildi_mi = 1, synced_at = ?, son_hata = NULL
         WHERE id IN (${yerTutucular(parca.length)})`,
      )
      .calistir(zaman, ...parca).changes;
  }
  return etkilenen;
}

/** Reddedilen olaylar: deneme sayacı artırılır, hata mesajı saklanır (§7.6). */
export function olayHatasiKaydet(vt: Vt, id: string, hata: string, kalici: boolean, zaman: ZamanDamgasi = simdi()): void {
  vt.hazirla(
    `UPDATE sync_outbox
     SET deneme_sayisi = deneme_sayisi + 1, son_hata = ?, gonderildi_mi = ?, synced_at = ?
     WHERE id = ?`,
  ).calistir(hata.slice(0, 500), boolToSayi(kalici), kalici ? zaman : null, id);
}

/** Kalıcı hata almış ve artık denenmeyecek olaylar — panelde/ayarlarda gösterilir. */
export function kaliciHataliOlaylar(vt: Vt, limit = 100): OutboxOlayi[] {
  return vt
    .hazirla(
      `SELECT id, olay_tipi, entity, entity_id, veri, olusturma_zamani, gonderildi_mi, synced_at,
              deneme_sayisi, son_hata, cihaz_id
       FROM sync_outbox WHERE son_hata IS NOT NULL ORDER BY olusturma_zamani DESC LIMIT ?`,
    )
    .tumu<HamSatir<OutboxOlayi, 'gonderildi_mi'>>(limit)
    .map((s) => ({ ...s, gonderildi_mi: sayiToBool(s.gonderildi_mi) }));
}

/** Arşivlenmiş eski olayları temizler (disk yönetimi). */
export function eskiOlaylariTemizle(vt: Vt, oncekiZaman: ZamanDamgasi): number {
  return vt
    .hazirla('DELETE FROM sync_outbox WHERE gonderildi_mi = 1 AND synced_at IS NOT NULL AND synced_at < ?')
    .calistir(oncekiZaman).changes;
}

// ---------------------------------------------------------------------------
// Senkron durumu
// ---------------------------------------------------------------------------

export interface SenkronDurumKaydi {
  last_pull_version: number;
  last_sync_at: ZamanDamgasi | null;
  last_push_at: ZamanDamgasi | null;
  last_pull_at: ZamanDamgasi | null;
  son_hata: string | null;
  cihaz_id: string | null;
}

export function durumOku(vt: Vt): SenkronDurumKaydi {
  const satir = vt
    .hazirla(
      'SELECT last_pull_version, last_sync_at, last_push_at, last_pull_at, son_hata, cihaz_id FROM sync_state WHERE id = 1',
    )
    .tek<SenkronDurumKaydi>();
  return (
    satir ?? {
      last_pull_version: 0,
      last_sync_at: null,
      last_push_at: null,
      last_pull_at: null,
      son_hata: null,
      cihaz_id: null,
    }
  );
}

export function durumYaz(vt: Vt, guncelleme: Partial<SenkronDurumKaydi>): void {
  const mevcut = durumOku(vt);
  const yeni = { ...mevcut, ...guncelleme };
  vt.hazirla(
    `INSERT INTO sync_state (id, last_pull_version, last_sync_at, last_push_at, last_pull_at, son_hata, cihaz_id)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_pull_version = excluded.last_pull_version, last_sync_at = excluded.last_sync_at,
       last_push_at = excluded.last_push_at, last_pull_at = excluded.last_pull_at,
       son_hata = excluded.son_hata, cihaz_id = excluded.cihaz_id`,
  ).calistir(yeni.last_pull_version, yeni.last_sync_at, yeni.last_push_at, yeni.last_pull_at, yeni.son_hata, yeni.cihaz_id);
}

// ---------------------------------------------------------------------------
// Çakışmalar (§7.4)
// ---------------------------------------------------------------------------

export interface CakismaKaydi {
  id: string;
  entity: string;
  entity_id: string;
  kaynak_a: string | null;
  kaynak_b: string | null;
  cozum: string;
  cozum_zamani: ZamanDamgasi;
  detay: string | null;
}

export function cakismaKaydet(vt: Vt, cakisma: CakismaKaydi): void {
  vt.hazirla(
    `INSERT INTO sync_cakismalar (id, entity, entity_id, kaynak_a, kaynak_b, cozum, cozum_zamani, detay)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
  ).calistir(
    cakisma.id,
    cakisma.entity,
    cakisma.entity_id,
    cakisma.kaynak_a,
    cakisma.kaynak_b,
    cakisma.cozum,
    cakisma.cozum_zamani,
    cakisma.detay,
  );
}

export function cakismalariListele(vt: Vt, limit = 100): CakismaKaydi[] {
  return vt
    .hazirla(
      `SELECT id, entity, entity_id, kaynak_a, kaynak_b, cozum, cozum_zamani, detay
       FROM sync_cakismalar ORDER BY cozum_zamani DESC LIMIT ?`,
    )
    .tumu<CakismaKaydi>(limit);
}

// ---------------------------------------------------------------------------
// Mutabakat (§18.4)
// ---------------------------------------------------------------------------

/** Yerel kayıt sayıları — sunucudakiyle karşılaştırılarak mutabakat yapılır. */
export function yerelSayimlar(vt: Vt): Record<string, number> {
  const tablolar = [
    'urunler',
    'barkodlar',
    'kategoriler',
    'cariler',
    'satislar',
    'satis_kalemleri',
    'odemeler',
    'stok_hareketleri',
    'cari_hareketler',
    'kasa_oturumlari',
    'kasa_hareketleri',
  ];
  const sonuc: Record<string, number> = {};
  for (const tablo of tablolar) {
    const satir = vt.hazirla(`SELECT COUNT(*) AS adet FROM ${tablo}`).tek<{ adet: number }>();
    sonuc[tablo] = satir?.adet ?? 0;
  }
  return sonuc;
}
