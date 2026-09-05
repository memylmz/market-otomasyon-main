/**
 * Operasyonel veri listeleri (salt okunur) — panelin kasadaki ekranlara
 * karşılık gelen görünümleri.
 *
 * Bu rotalar rollup DEĞİL ham hareket tablolarını okur; çünkü "şu fişin içinde
 * ne vardı", "şu ürün stoğuna ne oldu", "bu müşteri ne zaman ne ödedi"
 * sorularının rollup karşılığı yoktur. Her biri tarih/kayıt sayısı ile
 * sınırlıdır ve indeksli sütunlar üzerinden çalışır (§6.5 kural 3 istisnası:
 * detay sorgusu tek kayıt içindir, dashboard yolunda değildir).
 */

import { UCLAR, bugun, gunBasi, gunEkle, gunSonu, simdi, zSayfaIstegi, zTarihAraligi } from '@market/shared';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { panelKorumasi } from './koruma.js';

const zAralik = zTarihAraligi.partial().transform((v) => {
  const to = v.to ?? bugun();
  const from = v.from ?? gunEkle(to, -29);
  return { from, to };
});

function sayi(deger: unknown): number {
  const n = Number(deger);
  return Number.isFinite(n) ? n : 0;
}

export async function veriRotalari(uygulama: FastifyInstance): Promise<void> {
  const korumali = { preHandler: panelKorumasi };

  // ------------------------------------------------------------- SATIŞLAR
  /** Fiş listesi — kasadaki Raporlar → Satışlar sekmesinin karşılığı. */
  uygulama.get(UCLAR.satislar, korumali, async (istek) => {
    const { from, to } = zAralik.parse(istek.query);
    const sorgu = zSayfaIstegi.parse(istek.query);
    const durum = z
      .enum(['tumu', 'gecerli', 'iade', 'iptal'])
      .default('tumu')
      .parse((istek.query as { durum?: string }).durum ?? 'tumu');

    const kosul =
      durum === 'gecerli'
        ? 'AND s.iptal_mi = 0 AND s.iade_mi = 0'
        : durum === 'iade'
          ? 'AND s.iade_mi = 1'
          : durum === 'iptal'
            ? 'AND s.iptal_mi = 1'
            : '';

    const data = await uygulama.vt.tumu(
      `SELECT s.id, s.fis_no, s.tarih, s.cihaz_id, s.genel_toplam, s.ara_toplam, s.kdv_toplam,
              s.iskonto_toplam, s.brut_kar, s.odeme_ozeti, s.iptal_mi, s.iptal_neden, s.iade_mi,
              COALESCE(k.ad, '—') kullanici_adi, c.ad_unvan musteri_adi
       FROM satislar s
       LEFT JOIN kullanicilar k ON k.isletme_id = s.isletme_id AND k.id = s.kullanici_id
       LEFT JOIN cariler c ON c.isletme_id = s.isletme_id AND c.id = s.musteri_id
       WHERE s.isletme_id = ? AND s.tarih >= ? AND s.tarih <= ? ${kosul}
       ORDER BY s.tarih DESC LIMIT ?`,
      [istek.kullanici?.isletmeId, gunBasi(from), gunSonu(to), sorgu.limit],
    );

    return { from, to, data, has_more: data.length >= sorgu.limit, uretim_zamani: simdi() };
  });

  /** Fiş detayı: kalemler + ödemeler + KDV kırılımı (kasadaki fiş detay diyaloğu). */
  uygulama.get<{ Params: { id: string } }>(`${UCLAR.satislar}/:id`, korumali, async (istek) => {
    const isletmeId = istek.kullanici?.isletmeId;
    const [satis, kalemler, odemeler] = await Promise.all([
      uygulama.vt.tek<Record<string, unknown>>(
        `SELECT s.*, COALESCE(k.ad, '—') kullanici_adi, c.ad_unvan musteri_adi
         FROM satislar s
         LEFT JOIN kullanicilar k ON k.isletme_id = s.isletme_id AND k.id = s.kullanici_id
         LEFT JOIN cariler c ON c.isletme_id = s.isletme_id AND c.id = s.musteri_id
         WHERE s.isletme_id = ? AND s.id = ?`,
        [isletmeId, istek.params.id],
      ),
      uygulama.vt.tumu(
        `SELECT id, urun_id, urun_adi, barkod, miktar, birim_fiyat, birim_maliyet, iskonto,
                kdv_orani, kdv_tutar, satir_toplam
         FROM satis_kalemleri WHERE isletme_id = ? AND satis_id = ?`,
        [isletmeId, istek.params.id],
      ),
      uygulama.vt.tumu('SELECT id, odeme_tipi, tutar FROM odemeler WHERE isletme_id = ? AND satis_id = ?', [
        isletmeId,
        istek.params.id,
      ]),
    ]);

    // Bulunamayan fiş 404 değil boş gövde döner; panel "senkron edilmemiş
    // olabilir" mesajını gösterir (kasada var, buluta henüz gelmemiş olabilir).
    return { satis, kalemler, odemeler, uretim_zamani: simdi() };
  });

  // -------------------------------------------------------- STOK HAREKETLERİ
  /**
   * Kasadaki Stok → Hareketler sekmesinin karşılığı; aynı filtreler.
   *
   * Ortak `zSayfaIstegi` 200 satırla sınırlıdır; hareket dökümü bir tanı
   * ekranıdır ve tek günde yüzlerce satır üretir, 200'de kesmek listeyi
   * sessizce yanıltıcı kılardı. Satırlar küçük ve sorgu tarih indeksi
   * üzerinden çalıştığı için bu uçta sınır ayrıca tanımlanır.
   */
  const zHareketLimiti = z.coerce.number().int().positive().max(500).default(200);

  uygulama.get(UCLAR.stokHareketler, korumali, async (istek) => {
    const { from, to } = zAralik.parse(istek.query);
    const limit = zHareketLimiti.parse((istek.query as { limit?: string }).limit);
    const sorgu = { limit };
    const q = istek.query as { tip?: string; urun_id?: string };

    const kosullar: string[] = [];
    const parametreler: unknown[] = [istek.kullanici?.isletmeId, gunBasi(from), gunSonu(to)];
    if (q.tip) {
      kosullar.push('AND h.hareket_tipi = ?');
      parametreler.push(q.tip);
    }
    if (q.urun_id) {
      kosullar.push('AND h.urun_id = ?');
      parametreler.push(q.urun_id);
    }
    parametreler.push(sorgu.limit);

    const data = await uygulama.vt.tumu(
      `SELECT h.id, h.urun_id, COALESCE(u.ad, 'Bilinmeyen ürün') urun_adi, u.birim_tipi,
              h.hareket_tipi, h.miktar, h.birim_maliyet, h.belge_id, h.cihaz_id, h.created_at
       FROM stok_hareketleri h
       LEFT JOIN urunler u ON u.isletme_id = h.isletme_id AND u.id = h.urun_id
       WHERE h.isletme_id = ? AND h.created_at >= ? AND h.created_at <= ? ${kosullar.join(' ')}
       ORDER BY h.created_at DESC LIMIT ?`,
      parametreler,
    );

    return { from, to, data, has_more: data.length >= sorgu.limit, uretim_zamani: simdi() };
  });

  // ------------------------------------------------------- ALIŞ FATURALARI
  /**
   * Tedarikçiden ne, hangi belgeyle alındı (§11.8).
   *
   * Stok ve tedarikçi borcu ayrı olaylardan zaten doğru işliyordu; eksik olan
   * belgenin kendisiydi. Kalemler talep üzerine ayrı çekilir, liste hafif kalsın.
   */
  uygulama.get(UCLAR.alisFaturalari, korumali, async (istek) => {
    const sorgu = zSayfaIstegi.parse(istek.query);
    const { from, to } = zAralik.parse(istek.query);
    const tedarikciId = (istek.query as { tedarikci_id?: string }).tedarikci_id;

    const kosul = tedarikciId ? 'AND f.tedarikci_id = ?' : '';
    const parametreler: unknown[] = [istek.kullanici?.isletmeId, gunBasi(from), gunSonu(to)];
    if (tedarikciId) parametreler.push(tedarikciId);
    parametreler.push(sorgu.limit);

    const data = await uygulama.vt.tumu(
      `SELECT f.id, f.fatura_no, f.tarih, f.genel_toplam, f.odenen_tutar, f.cihaz_id,
              f.tedarikci_id, COALESCE(c.ad_unvan, 'Bilinmeyen tedarikçi') tedarikci_adi,
              (SELECT COUNT(*) FROM alis_kalemleri k WHERE k.isletme_id = f.isletme_id AND k.fatura_id = f.id) kalem_sayisi
         FROM alis_faturalari f
         LEFT JOIN cariler c ON c.isletme_id = f.isletme_id AND c.id = f.tedarikci_id
        WHERE f.isletme_id = ? AND f.tarih >= ? AND f.tarih <= ? ${kosul}
        ORDER BY f.tarih DESC LIMIT ?`,
      parametreler,
    );
    return { from, to, data, has_more: data.length >= sorgu.limit, uretim_zamani: simdi() };
  });

  /** Tek faturanın kalemleri. */
  uygulama.get<{ Params: { id: string } }>(`${UCLAR.alisFaturalari}/:id`, korumali, async (istek) => {
    const isletmeId = istek.kullanici?.isletmeId;
    const [fatura, kalemler] = await Promise.all([
      uygulama.vt.tek<Record<string, unknown>>(
        `SELECT f.*, COALESCE(c.ad_unvan, 'Bilinmeyen tedarikçi') tedarikci_adi
           FROM alis_faturalari f
           LEFT JOIN cariler c ON c.isletme_id = f.isletme_id AND c.id = f.tedarikci_id
          WHERE f.isletme_id = ? AND f.id = ?`,
        [isletmeId, istek.params.id],
      ),
      uygulama.vt.tumu(
        `SELECT k.id, k.urun_id, COALESCE(u.ad, 'Bilinmeyen ürün') urun_adi, u.birim_tipi, k.miktar, k.birim_fiyat
           FROM alis_kalemleri k
           LEFT JOIN urunler u ON u.isletme_id = k.isletme_id AND u.id = k.urun_id
          WHERE k.isletme_id = ? AND k.fatura_id = ?`,
        [isletmeId, istek.params.id],
      ),
    ]);
    return { fatura, kalemler, uretim_zamani: simdi() };
  });

  // ----------------------------------------------------------- CARİ EKSTRE
  /** Tek carinin hareket dökümü ve yürüyen bakiyesi (kasadaki cari ekstresi). */
  uygulama.get<{ Params: { id: string } }>(`${UCLAR.cariler}/:id/ekstre`, korumali, async (istek) => {
    const isletmeId = istek.kullanici?.isletmeId;
    const [cari, hareketler] = await Promise.all([
      uygulama.vt.tek<Record<string, unknown>>(
        `SELECT c.id, c.tip, c.ad_unvan, c.telefon, c.eposta, c.adres, c.kredi_limiti, c.vade_gun,
                c.iletisim_rizasi, c.aktif_mi, COALESCE(o.bakiye, 0) bakiye, o.son_hareket
         FROM cariler c
         LEFT JOIN cari_ozet o ON o.isletme_id = c.isletme_id AND o.cari_id = c.id
         WHERE c.isletme_id = ? AND c.id = ?`,
        [isletmeId, istek.params.id],
      ),
      uygulama.vt.tumu<Record<string, unknown>>(
        `SELECT id, hareket_tipi, tutar, aciklama, belge_id, tarih, vade_tarihi, cihaz_id
         FROM cari_hareketler WHERE isletme_id = ? AND cari_id = ? ORDER BY tarih LIMIT 500`,
        [isletmeId, istek.params.id],
      ),
    ]);

    // Yürüyen bakiye eskiden yeniye hesaplanır; ekstre okunurken bakiye takibi
    // yapılabilsin (kasadaki ekstre görünümüyle aynı).
    let yurüyen = 0;
    const dokum = hareketler.map((h) => {
      yurüyen += sayi(h.tutar);
      return { ...h, tutar: sayi(h.tutar), yuruyen_bakiye: yurüyen };
    });

    return { cari, hareketler: dokum.reverse(), uretim_zamani: simdi() };
  });
}
