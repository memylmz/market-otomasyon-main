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
              COALESCE(k.ad, s.kasiyer_adi, '—') kullanici_adi, c.ad_unvan musteri_adi
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
    const [satis, kalemler, odemeler, iadeler] = await Promise.all([
      uygulama.vt.tek<Record<string, unknown>>(
        `SELECT s.*, COALESCE(k.ad, s.kasiyer_adi, '—') kullanici_adi, c.ad_unvan musteri_adi,
                (SELECT ks.fis_no FROM satislar ks
                  WHERE ks.isletme_id = s.isletme_id AND ks.id = s.kaynak_satis_id) kaynak_fis_no
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
      // Bu satıştan yapılmış iadeler — kasadaki fiş detayıyla aynı liste.
      uygulama.vt.tumu(
        `SELECT id, fis_no, tarih, genel_toplam FROM satislar
          WHERE isletme_id = ? AND kaynak_satis_id = ? AND iade_mi = 1 ORDER BY tarih`,
        [isletmeId, istek.params.id],
      ),
    ]);

    // Bulunamayan fiş 404 değil boş gövde döner; panel "senkron edilmemiş
    // olabilir" mesajını gösterir (kasada var, buluta henüz gelmemiş olabilir).
    return { satis, kalemler, odemeler, iadeler, uretim_zamani: simdi() };
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
      `SELECT f.id, f.fatura_no, f.tarih, f.ara_toplam, f.kdv_toplam, f.genel_toplam, f.odenen_tutar,
              f.durum, f.vade_tarihi, f.kullanici_id, f.cihaz_id,
              f.tedarikci_id, COALESCE(c.ad_unvan, 'Bilinmeyen tedarikçi') tedarikci_adi,
              COALESCE(k.ad, '—') kullanici_adi,
              (SELECT COUNT(*) FROM alis_kalemleri ak WHERE ak.isletme_id = f.isletme_id AND ak.fatura_id = f.id) kalem_sayisi
         FROM alis_faturalari f
         LEFT JOIN kullanicilar k ON k.isletme_id = f.isletme_id AND k.id = f.kullanici_id
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
        `SELECT f.*, COALESCE(c.ad_unvan, 'Bilinmeyen tedarikçi') tedarikci_adi,
                COALESCE(k.ad, '—') kullanici_adi
           FROM alis_faturalari f
           LEFT JOIN cariler c ON c.isletme_id = f.isletme_id AND c.id = f.tedarikci_id
           LEFT JOIN kullanicilar k ON k.isletme_id = f.isletme_id AND k.id = f.kullanici_id
          WHERE f.isletme_id = ? AND f.id = ?`,
        [isletmeId, istek.params.id],
      ),
      uygulama.vt.tumu(
        `SELECT k.id, k.urun_id, COALESCE(u.ad, 'Bilinmeyen ürün') urun_adi, u.birim_tipi,
                k.miktar, k.birim_fiyat, k.kdv_orani, k.satir_toplam, k.skt, k.lot_no
           FROM alis_kalemleri k
           LEFT JOIN urunler u ON u.isletme_id = k.isletme_id AND u.id = k.urun_id
          WHERE k.isletme_id = ? AND k.fatura_id = ?`,
        [isletmeId, istek.params.id],
      ),
    ]);

    /*
     * Kasada uygulanmayı bekleyen talimat da döner: panelden verilen iptal ya
     * da düzeltme anında değil, kasa bir sonraki senkronda uyguladığında
     * görünür. Ekran bunu söylemezse kullanıcı "olmadı" sanıp ikinci kez dener.
     *
     * `uygulandi_mi = 0` filtresi şart: kasa sonucu `TALIMAT_SONUCLANDI` ile
     * bildirene kadar bu sütun yoktu, uygulanmış talimat da "bekliyor"
     * görünüyor ve fatura kalıcı olarak kilitli kalıyordu. Hata varsa satır
     * bekliyor sayılmaya devam eder — nedeni ekranda yazsın diye `hata` da döner.
     */
    const bekleyen = await uygulama.vt.tumu<Record<string, unknown>>(
      `SELECT id, tip, hata, created_at FROM alis_talimatlari
        WHERE isletme_id = ? AND fatura_id = ? AND silindi_mi = 0 AND uygulandi_mi = 0 ORDER BY created_at`,
      [isletmeId, istek.params.id],
    );

    return { fatura, kalemler, bekleyen_talimatlar: bekleyen, uretim_zamani: simdi() };
  });

  // ----------------------------------------------------------- CARİ EKSTRE
  /**
   * Müşterinin bütün alışverişleri, ödeme dökümüyle — kasadaki Cari →
   * Alışverişler görünümünün karşılığı; süzgeç kuralları aynıdır: `odenmis`
   * veresiye payı olmayan, `borc` veresiye payı olan satışlar; iptal ve iade
   * yalnız `tumu`da görünür.
   */
  uygulama.get<{ Params: { id: string } }>(`${UCLAR.cariler}/:id/alisverisler`, korumali, async (istek) => {
    // Aralık verilmezse sınır yok (müşterinin bütün geçmişi).
    const aralik = zTarihAraligi.partial().parse(istek.query);
    const durum = z
      .enum(['tumu', 'odenmis', 'borc'])
      .default('tumu')
      .parse((istek.query as { durum?: string }).durum ?? 'tumu');
    const sonra =
      durum === 'odenmis'
        ? 'WHERE iptal_mi = 0 AND iade_mi = 0 AND veresiye = 0'
        : durum === 'borc'
          ? 'WHERE iptal_mi = 0 AND iade_mi = 0 AND veresiye > 0'
          : '';
    const data = await uygulama.vt.tumu(
      `SELECT * FROM (
         SELECT s.id, s.fis_no, s.tarih, s.genel_toplam, s.iptal_mi, s.iade_mi,
                COALESCE(k.ad, s.kasiyer_adi) kullanici_adi,
                COALESCE(SUM(CASE WHEN o.odeme_tipi = 'NAKIT' THEN o.tutar END), 0) nakit,
                COALESCE(SUM(CASE WHEN o.odeme_tipi = 'KART' THEN o.tutar END), 0) kart,
                COALESCE(SUM(CASE WHEN o.odeme_tipi = 'VERESIYE' THEN o.tutar END), 0) veresiye
         FROM satislar s
         LEFT JOIN odemeler o ON o.isletme_id = s.isletme_id AND o.satis_id = s.id
         LEFT JOIN kullanicilar k ON k.isletme_id = s.isletme_id AND k.id = s.kullanici_id
         WHERE s.isletme_id = ? AND s.musteri_id = ?
           AND (? IS NULL OR s.tarih >= ?) AND (? IS NULL OR s.tarih < ?)
         GROUP BY s.id
       ) ${sonra}
       ORDER BY tarih DESC LIMIT 500`,
      [
        istek.kullanici?.isletmeId,
        istek.params.id,
        aralik.from ? gunBasi(aralik.from) : null,
        aralik.from ? gunBasi(aralik.from) : null,
        aralik.to ? gunSonu(aralik.to) : null,
        aralik.to ? gunSonu(aralik.to) : null,
      ],
    );
    return { data, uretim_zamani: simdi() };
  });

  /** Tek carinin hareket dökümü ve yürüyen bakiyesi (kasadaki cari ekstresi). */
  uygulama.get<{ Params: { id: string } }>(`${UCLAR.cariler}/:id/ekstre`, korumali, async (istek) => {
    const isletmeId = istek.kullanici?.isletmeId;
    const aralik = istek.query as { from?: string; to?: string };
    const [cari, hareketler, talimatlar] = await Promise.all([
      uygulama.vt.tek<Record<string, unknown>>(
        `SELECT c.id, c.tip, c.ad_unvan, c.telefon, c.eposta, c.adres, c.vergi_dairesi, c.vergi_no, c.notlar,
                c.kredi_limiti, c.vade_gun, c.iletisim_rizasi, c.aktif_mi, c.anonimlestirildi_mi,
                COALESCE(o.bakiye, 0) bakiye, o.son_hareket
         FROM cariler c
         LEFT JOIN cari_ozet o ON o.isletme_id = c.isletme_id AND o.cari_id = c.id
         WHERE c.isletme_id = ? AND c.id = ?`,
        [isletmeId, istek.params.id],
      ),
      uygulama.vt.tumu<Record<string, unknown>>(
        /*
         * `belge_tipi` de gelir: bir tahsilatın zaten iptal edilmiş olduğu,
         * ona bağlı TAHSILAT_IPTAL ters kaydından anlaşılır. Onsuz panel iptal
         * edilmiş tahsilatı ikinci kez iptal etmeyi teklif ederdi.
         *
         * Tarih aralığı kasadaki ekstre ile aynı: gün başı / gün sonu
         * yerel saate göre sınırlanır, yoksa günün ilk saatleri düşer.
         */
        // nakit_mi: iptal penceresi paranın geri dönüş yolunu buna göre önerir (kasadaki kuralın aynısı).
        `SELECT id, hareket_tipi, tutar, aciklama, belge_id, belge_tipi, tarih, vade_tarihi, cihaz_id,
                CASE WHEN hareket_tipi IN ('TAHSILAT', 'ODEME') THEN
                  EXISTS (SELECT 1 FROM kasa_hareketleri k
                           WHERE k.isletme_id = cari_hareketler.isletme_id AND k.belge_id = cari_hareketler.id)
                  OR (belge_tipi = 'ALIS_ODEME' AND EXISTS (
                    SELECT 1 FROM kasa_hareketleri k
                     WHERE k.isletme_id = cari_hareketler.isletme_id AND k.belge_id = cari_hareketler.belge_id
                       AND k.tip = 'ODEME'))
                END AS nakit_mi
         FROM cari_hareketler
         WHERE isletme_id = ? AND cari_id = ?
           AND (? IS NULL OR tarih >= ?) AND (? IS NULL OR tarih <= ?)
         ORDER BY tarih LIMIT 500`,
        [
          isletmeId,
          istek.params.id,
          aralik.from ? gunBasi(aralik.from) : null,
          aralik.from ? gunBasi(aralik.from) : null,
          aralik.to ? gunSonu(aralik.to) : null,
          aralik.to ? gunSonu(aralik.to) : null,
        ],
      ),
      /*
       * Kasada uygulanmayı bekleyen talimatlar. Panelden verilen düzeltme
       * anında değil, kasa bir sonraki senkronda uyguladığında görünür;
       * ekran bunu söylemezse kullanıcı "işlemedi" sanıp ikinci kez dener.
       */
      uygulama.vt.tumu<Record<string, unknown>>(
        `SELECT id, tip, tutar, hedef_hareket_id, neden, created_at
         FROM cari_talimatlari WHERE isletme_id = ? AND cari_id = ? AND silindi_mi = 0
         ORDER BY created_at`,
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

    return { cari, hareketler: dokum.reverse(), bekleyen_talimatlar: talimatlar, uretim_zamani: simdi() };
  });
}
