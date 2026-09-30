/**
 * Rapor ve dashboard rotaları (§9.2, §11.2/11.3/11.5/11.6/11.7).
 *
 * MALİYET KURALI (§6.5 kural 3): Bu rotalar **yalnız rollup tablolarını** okur.
 * Ham `satislar` taraması yapılmaz — okuma satırı 100–1000 kat düşer ve
 * dashboard ≤2 sn hedefi tutar (§3.1).
 */

import { UCLAR, bugun, gunBasi, gunEkle, gunSonu, simdi, zTarihAraligi } from '@market/shared';
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

export async function raporRotalari(uygulama: FastifyInstance): Promise<void> {
  const korumali = { preHandler: panelKorumasi };

  // ------------------------------------------------------------ DASHBOARD
  uygulama.get(UCLAR.dashboard, korumali, async (istek) => {
    const isletmeId = istek.kullanici?.isletmeId;
    const bugunAnahtari = bugun();
    const dun = gunEkle(bugunAnahtari, -1);
    const yediGunOnce = gunEkle(bugunAnahtari, -6);

    const [bugunSatir, dunSatir, trend, enCokSatan, kritik, cari, cihazlar] = await Promise.all([
      uygulama.vt.tek<Record<string, unknown>>(
        `SELECT COALESCE(SUM(ciro),0) ciro, COALESCE(SUM(islem_sayisi),0) islem, COALESCE(SUM(brut_kar),0) kar,
                COALESCE(SUM(nakit),0) nakit, COALESCE(SUM(kart),0) kart, COALESCE(SUM(veresiye),0) veresiye,
                COALESCE(SUM(iade_toplam),0) iade
         FROM gunluk_ozet WHERE isletme_id = ? AND tarih = ?`,
        [isletmeId, bugunAnahtari],
      ),
      uygulama.vt.tek<Record<string, unknown>>(
        'SELECT COALESCE(SUM(ciro),0) ciro FROM gunluk_ozet WHERE isletme_id = ? AND tarih = ?',
        [isletmeId, dun],
      ),
      uygulama.vt.tumu<Record<string, unknown>>(
        `SELECT tarih, COALESCE(SUM(ciro),0) ciro, COALESCE(SUM(islem_sayisi),0) islem_sayisi
         FROM gunluk_ozet WHERE isletme_id = ? AND tarih >= ? AND tarih <= ?
         GROUP BY tarih ORDER BY tarih`,
        [isletmeId, yediGunOnce, bugunAnahtari],
      ),
      uygulama.vt.tumu<Record<string, unknown>>(
        `SELECT o.urun_id, u.ad AS urun_adi, SUM(o.adet) adet, SUM(o.ciro) ciro, SUM(o.kar) kar
         FROM urun_satis_ozet o LEFT JOIN urunler u ON u.isletme_id = o.isletme_id AND u.id = o.urun_id
         WHERE o.isletme_id = ? AND o.donem >= ? AND o.donem <= ?
         GROUP BY o.urun_id ORDER BY ciro DESC LIMIT 5`,
        [isletmeId, yediGunOnce, bugunAnahtari],
      ),
      uygulama.vt.tek<{ adet: number }>(
        `SELECT COUNT(*) adet FROM urunler u
         LEFT JOIN stok_ozet s ON s.isletme_id = u.isletme_id AND s.urun_id = u.id
         WHERE u.isletme_id = ? AND u.aktif_mi = 1 AND u.silindi_mi = 0
           AND u.kritik_stok > 0 AND COALESCE(s.miktar, 0) <= u.kritik_stok`,
        [isletmeId],
      ),
      uygulama.vt.tek<{ musteri: number; tedarikci: number }>(
        `SELECT
           COALESCE(SUM(CASE WHEN c.tip = 'MUSTERI' AND o.bakiye > 0 THEN o.bakiye ELSE 0 END), 0) musteri,
           COALESCE(SUM(CASE WHEN c.tip = 'TEDARIKCI' AND o.bakiye > 0 THEN o.bakiye ELSE 0 END), 0) tedarikci
         FROM cari_ozet o JOIN cariler c ON c.isletme_id = o.isletme_id AND c.id = o.cari_id
         WHERE o.isletme_id = ? AND c.aktif_mi = 1`,
        [isletmeId],
      ),
      uygulama.vt.tek<{ toplam: number; son: string | null }>(
        'SELECT COUNT(*) toplam, MAX(son_push) son FROM cihazlar WHERE isletme_id = ? AND aktif_mi = 1',
        [isletmeId],
      ),
    ]);

    const bugunCiro = sayi(bugunSatir?.ciro);
    const dunCiro = sayi(dunSatir?.ciro);
    const islem = sayi(bugunSatir?.islem);

    return {
      tarih: bugunAnahtari,
      bugun: {
        ciro: bugunCiro,
        islem_sayisi: islem,
        ortalama_sepet: islem > 0 ? Math.round(bugunCiro / islem) : 0,
        brut_kar: sayi(bugunSatir?.kar),
        nakit: sayi(bugunSatir?.nakit),
        kart: sayi(bugunSatir?.kart),
        veresiye: sayi(bugunSatir?.veresiye),
      },
      degisim_yuzde: dunCiro > 0 ? Math.round(((bugunCiro - dunCiro) / dunCiro) * 10000) / 100 : 0,
      trend: trend.map((t) => ({ tarih: String(t.tarih), ciro: sayi(t.ciro), islem_sayisi: sayi(t.islem_sayisi) })),
      en_cok_satan: enCokSatan.map((u) => ({
        urun_id: String(u.urun_id),
        urun_adi: String(u.urun_adi ?? 'Bilinmeyen ürün'),
        adet: sayi(u.adet),
        ciro: sayi(u.ciro),
        kar: sayi(u.kar),
      })),
      kritik_stok_sayisi: sayi(kritik?.adet),
      toplam_musteri_alacagi: sayi(cari?.musteri),
      toplam_tedarikci_borcu: sayi(cari?.tedarikci),
      senkron: {
        son_senkron: cihazlar?.son ?? null,
        bekleyen_cihaz_sayisi: 0,
        aktif_cihaz_sayisi: sayi(cihazlar?.toplam),
      },
      // Panelde "veriler son senkron: X önce" göstergesi bu alandan beslenir (§11).
      uretim_zamani: simdi(),
    };
  });

  // ------------------------------------------------------- GÜNLÜK RAPOR
  uygulama.get(UCLAR.raporGunluk, korumali, async (istek) => {
    const { from, to } = zAralik.parse(istek.query);
    const satirlar = await uygulama.vt.tumu<Record<string, unknown>>(
      `SELECT tarih, COALESCE(SUM(ciro),0) ciro, COALESCE(SUM(iade_toplam),0) iade_toplam,
              COALESCE(SUM(islem_sayisi),0) islem_sayisi, COALESCE(SUM(nakit),0) nakit,
              COALESCE(SUM(kart),0) kart, COALESCE(SUM(veresiye),0) veresiye,
              COALESCE(SUM(brut_kar),0) brut_kar, COALESCE(SUM(gider),0) gider,
              COALESCE(SUM(kdv_toplam),0) kdv_toplam
       FROM gunluk_ozet WHERE isletme_id = ? AND tarih >= ? AND tarih <= ?
       GROUP BY tarih ORDER BY tarih`,
      [istek.kullanici?.isletmeId, from, to],
    );

    const data = satirlar.map((s) => {
      const ciro = sayi(s.ciro);
      const islem = sayi(s.islem_sayisi);
      return {
        tarih: String(s.tarih),
        ciro,
        iade_toplam: sayi(s.iade_toplam),
        islem_sayisi: islem,
        nakit: sayi(s.nakit),
        kart: sayi(s.kart),
        veresiye: sayi(s.veresiye),
        brut_kar: sayi(s.brut_kar),
        gider: sayi(s.gider),
        kdv_toplam: sayi(s.kdv_toplam),
        ortalama_sepet: islem > 0 ? Math.round(ciro / islem) : 0,
      };
    });

    /*
     * Gider ve KDV toplamları kasadaki Ciro Özeti'nde vardı, panelde yoktu.
     * Satır verisi zaten geliyordu; yalnız toplanmıyordu.
     */
    const toplam = data.reduce(
      (t, g) => ({
        ciro: t.ciro + g.ciro,
        iade: t.iade + g.iade_toplam,
        islem: t.islem + g.islem_sayisi,
        kar: t.kar + g.brut_kar,
        nakit: t.nakit + g.nakit,
        kart: t.kart + g.kart,
        veresiye: t.veresiye + g.veresiye,
        gider: t.gider + g.gider,
        kdv: t.kdv + g.kdv_toplam,
      }),
      { ciro: 0, iade: 0, islem: 0, kar: 0, nakit: 0, kart: 0, veresiye: 0, gider: 0, kdv: 0 },
    );

    return { from, to, data, toplam, uretim_zamani: simdi() };
  });

  // --------------------------------------------------------- ÜRÜN RAPORU
  uygulama.get(UCLAR.raporUrun, korumali, async (istek) => {
    const { from, to } = zAralik.parse(istek.query);
    const limit = z.coerce
      .number()
      .int()
      .positive()
      .max(200)
      .default(50)
      .parse((istek.query as { limit?: string }).limit);

    /*
     * Kasadaki Ürün Performansı üç liste gösterir: en çok satan, EN KÂRLI ve
     * ölü stok. Panelde en kârlı yoktu — oysa işletme sahibinin asıl baktığı
     * liste odur: çok satan ürün her zaman kazandıran ürün değildir.
     */
    const [enCok, enKarli, oluStok] = await Promise.all([
      uygulama.vt.tumu<Record<string, unknown>>(
        `SELECT o.urun_id, u.ad AS urun_adi, SUM(o.adet) adet, SUM(o.ciro) ciro, SUM(o.kar) kar
         FROM urun_satis_ozet o LEFT JOIN urunler u ON u.isletme_id = o.isletme_id AND u.id = o.urun_id
         WHERE o.isletme_id = ? AND o.donem >= ? AND o.donem <= ?
         GROUP BY o.urun_id ORDER BY ciro DESC LIMIT ?`,
        [istek.kullanici?.isletmeId, from, to, limit],
      ),
      uygulama.vt.tumu<Record<string, unknown>>(
        `SELECT o.urun_id, u.ad AS urun_adi, SUM(o.adet) adet, SUM(o.ciro) ciro, SUM(o.kar) kar
         FROM urun_satis_ozet o LEFT JOIN urunler u ON u.isletme_id = o.isletme_id AND u.id = o.urun_id
         WHERE o.isletme_id = ? AND o.donem >= ? AND o.donem <= ?
         GROUP BY o.urun_id ORDER BY kar DESC LIMIT ?`,
        [istek.kullanici?.isletmeId, from, to, limit],
      ),
      uygulama.vt.tumu<Record<string, unknown>>(
        `SELECT u.id urun_id, u.ad, s.miktar stok, u.alis_fiyati,
                CAST(s.miktar * u.alis_fiyati / 1000.0 AS INTEGER) bagli_sermaye
         FROM urunler u JOIN stok_ozet s ON s.isletme_id = u.isletme_id AND s.urun_id = u.id
         WHERE u.isletme_id = ? AND u.aktif_mi = 1 AND u.silindi_mi = 0 AND s.miktar > 0
           AND NOT EXISTS (
             SELECT 1 FROM urun_satis_ozet o
             WHERE o.isletme_id = u.isletme_id AND o.urun_id = u.id AND o.donem >= ? AND o.donem <= ? AND o.adet > 0
           )
         ORDER BY bagli_sermaye DESC LIMIT ?`,
        [istek.kullanici?.isletmeId, from, to, limit],
      ),
    ]);

    return { from, to, en_cok_satan: enCok, en_karli: enKarli, olu_stok: oluStok, uretim_zamani: simdi() };
  });

  // --------------------------------------------------------- CARİ RAPORU
  uygulama.get(UCLAR.raporCari, korumali, async (istek) => {
    const tip = (istek.query as { tip?: string }).tip ?? 'MUSTERI';
    const isletmeId = istek.kullanici?.isletmeId;

    const bakiyeler = await uygulama.vt.tumu<Record<string, unknown>>(
      `SELECT c.id cari_id, c.ad_unvan, c.tip, c.telefon, COALESCE(o.bakiye,0) bakiye, o.son_hareket
       FROM cariler c JOIN cari_ozet o ON o.isletme_id = c.isletme_id AND o.cari_id = c.id
       WHERE c.isletme_id = ? AND c.tip = ? AND c.aktif_mi = 1 AND o.bakiye > 0
       ORDER BY o.bakiye DESC LIMIT 200`,
      [isletmeId, tip],
    );

    // Yaşlandırma: açık borçların yaşı FIFO mahsup ile bulunur (§11.6).
    const data = [];
    for (const cari of bakiyeler) {
      const hareketler = await uygulama.vt.tumu<{ tutar: number; tarih: string }>(
        'SELECT tutar, tarih FROM cari_hareketler WHERE isletme_id = ? AND cari_id = ? ORDER BY tarih',
        [isletmeId, cari.cari_id],
      );

      const acik: { tutar: number; tarih: string }[] = [];
      for (const h of hareketler) {
        const tutar = sayi(h.tutar);
        if (tutar > 0) {
          acik.push({ tutar, tarih: String(h.tarih) });
          continue;
        }
        let mahsup = -tutar;
        while (mahsup > 0 && acik.length > 0) {
          const ilk = acik[0];
          if (!ilk) break;
          const dus = Math.min(ilk.tutar, mahsup);
          ilk.tutar -= dus;
          mahsup -= dus;
          if (ilk.tutar === 0) acik.shift();
        }
      }

      const simdiMs = Date.now();
      const dilimler = [0, 0, 0, 0];
      for (const borc of acik) {
        const gun = Math.floor((simdiMs - Date.parse(borc.tarih)) / 86400000);
        const i = gun <= 30 ? 0 : gun <= 60 ? 1 : gun <= 90 ? 2 : 3;
        dilimler[i] = (dilimler[i] ?? 0) + borc.tutar;
      }

      data.push({
        cari_id: String(cari.cari_id),
        ad_unvan: String(cari.ad_unvan),
        tip: String(cari.tip),
        telefon: cari.telefon ?? null,
        bakiye: sayi(cari.bakiye),
        son_hareket: cari.son_hareket ?? null,
        yaslandirma: [
          { dilim: '0-30', tutar: dilimler[0] ?? 0 },
          { dilim: '31-60', tutar: dilimler[1] ?? 0 },
          { dilim: '61-90', tutar: dilimler[2] ?? 0 },
          { dilim: '90+', tutar: dilimler[3] ?? 0 },
        ],
      });
    }

    return { data, uretim_zamani: simdi() };
  });

  // --------------------------------------------------------- KASA RAPORU
  uygulama.get(UCLAR.raporKasa, korumali, async (istek) => {
    const { from, to } = zAralik.parse(istek.query);
    const data = await uygulama.vt.tumu(
      `SELECT id, cihaz_id, kullanici_id, acilis_zamani, kapanis_zamani, acilis_bakiye, sayilan_nakit,
              beklenen_nakit, kasa_farki, satis_nakit, satis_kart, veresiye, gider, islem_sayisi, durum
       FROM kasa_oturumlari
       WHERE isletme_id = ? AND acilis_zamani >= ? AND acilis_zamani <= ?
       ORDER BY acilis_zamani DESC LIMIT 200`,
      [istek.kullanici?.isletmeId, gunBasi(from), gunSonu(to)],
    );
    return { data, uretim_zamani: simdi() };
  });

  /**
   * Bir vardiyanın para hareketleri (§10.11).
   *
   * Özet satırı "içinde ne oldu" sorusunu cevaplamaz; kasadaki Vardiya Dökümü
   * ekranının merkezdeki karşılığıdır ve aynı kolonları döndürür.
   */
  uygulama.get<{ Params: { id: string } }>(`${UCLAR.raporKasa}/:id`, korumali, async (istek) => {
    const isletmeId = istek.kullanici?.isletmeId as string;
    const [oturum, hareketler] = await Promise.all([
      uygulama.vt.tek(
        `SELECT id, cihaz_id, kullanici_id, acilis_zamani, kapanis_zamani, acilis_bakiye, sayilan_nakit,
                beklenen_nakit, kasa_farki, satis_nakit, satis_kart, veresiye, gider, islem_sayisi, durum
         FROM kasa_oturumlari WHERE isletme_id = ? AND id = ?`,
        [isletmeId, istek.params.id],
      ),
      uygulama.vt.tumu(
        // Satıştan doğan harekette müşteri — kasadaki Kasa Geçmişi'yle aynı bilgi.
        `SELECT h.id, h.tip, h.tutar, h.aciklama, h.belge_id, h.created_at, c.ad_unvan AS musteri_adi
         FROM kasa_hareketleri h
         LEFT JOIN satislar s ON s.isletme_id = h.isletme_id AND s.id = h.belge_id
         LEFT JOIN cariler c ON c.isletme_id = h.isletme_id AND c.id = s.musteri_id
         WHERE h.isletme_id = ? AND h.kasa_oturum_id = ?
         ORDER BY h.created_at LIMIT 1000`,
        [isletmeId, istek.params.id],
      ),
    ]);
    return { oturum, hareketler, uretim_zamani: simdi() };
  });

  // -------------------------------------------------------- STOK DURUMU
  uygulama.get(UCLAR.raporStok, korumali, async (istek) => {
    const isletmeId = istek.kullanici?.isletmeId;
    /*
     * Kasadaki Stok ekranı dört şey gösterir: değer, kritik stok, SKT takibi ve
     * NEGATİF stok. Panelde yalnız ilk ikisi vardı. Negatif stok özellikle
     * önemli: sayım hatasının ya da atlanmış mal kabulün ilk işaretidir.
     */
    const sktGun = Number((istek.query as { skt_gun?: string }).skt_gun ?? 30) || 30;
    const sktSinir = gunEkle(bugun(), sktGun);
    const [deger, kritikler, negatifler, sktYaklasanlar] = await Promise.all([
      uygulama.vt.tek<Record<string, unknown>>(
        `SELECT COALESCE(SUM(s.miktar * u.alis_fiyati), 0) / 1000.0 maliyet,
                COALESCE(SUM(s.miktar * u.satis_fiyati), 0) / 1000.0 satis,
                COUNT(*) kalem
         FROM stok_ozet s JOIN urunler u ON u.isletme_id = s.isletme_id AND u.id = s.urun_id
         WHERE s.isletme_id = ? AND s.miktar > 0 AND u.aktif_mi = 1`,
        [isletmeId],
      ),
      uygulama.vt.tumu(
        `SELECT u.id urun_id, u.ad, COALESCE(s.miktar,0) stok, u.kritik_stok, u.ideal_stok, u.birim_tipi,
                MAX(0, u.ideal_stok - COALESCE(s.miktar,0)) onerilen_siparis
         FROM urunler u LEFT JOIN stok_ozet s ON s.isletme_id = u.isletme_id AND s.urun_id = u.id
         WHERE u.isletme_id = ? AND u.aktif_mi = 1 AND u.silindi_mi = 0
           AND u.kritik_stok > 0 AND COALESCE(s.miktar,0) <= u.kritik_stok
         ORDER BY (COALESCE(s.miktar,0) - u.kritik_stok) LIMIT 200`,
        [isletmeId],
      ),
      uygulama.vt.tumu(
        `SELECT u.id urun_id, u.ad, s.miktar stok, u.birim_tipi
         FROM urunler u JOIN stok_ozet s ON s.isletme_id = u.isletme_id AND s.urun_id = u.id
         WHERE u.isletme_id = ? AND u.silindi_mi = 0 AND s.miktar < 0
         ORDER BY s.miktar LIMIT 200`,
        [isletmeId],
      ),
      /*
       * SKT takibi — kasadaki sorgunun aynısı: lot bazında KALAN miktar.
       * Giriş ve çıkış hareketleri aynı (ürün, skt, lot) altında toplanır;
       * kalanı sıfırlanmış lot listede görünmez.
       */
      uygulama.vt.tumu(
        `SELECT h.urun_id, u.ad, h.skt, h.lot_no, SUM(h.miktar) AS kalan_miktar, u.birim_tipi
         FROM stok_hareketleri h
         JOIN urunler u ON u.isletme_id = h.isletme_id AND u.id = h.urun_id
         WHERE h.isletme_id = ? AND h.skt IS NOT NULL AND h.skt <= ?
         GROUP BY h.urun_id, h.skt, h.lot_no
         HAVING SUM(h.miktar) > 0
         ORDER BY h.skt, u.ad LIMIT 200`,
        [isletmeId, sktSinir],
      ),
    ]);

    return {
      deger: { maliyet: Math.round(sayi(deger?.maliyet)), satis: Math.round(sayi(deger?.satis)), kalem: sayi(deger?.kalem) },
      kritikler,
      negatifler,
      skt_yaklasanlar: (sktYaklasanlar as Record<string, unknown>[]).map((r) => ({
        ...r,
        kalan_gun: Math.round((Date.parse(String(r.skt) + 'T00:00:00Z') - Date.parse(bugun() + 'T00:00:00Z')) / 86400000),
      })),
      uretim_zamani: simdi(),
    };
  });

  // ------------------------------------------------------ SAATLİK YOĞUNLUK
  /*
   * Kasadaki `rapor.saatlik` ile aynı şekli döndürür: 24 elemanlı dizi.
   * Rollup'ta saat kırılımı yoktur; bu tek rapor ham `satislar` tablosunu okur.
   * Tarih aralığıyla sınırlıdır ve indeksli sütun (tarih) üzerinden çalışır —
   * personel planlaması ayda birkaç kez bakılan bir rapordur (§6.5 istisnası).
   */
  uygulama.get(UCLAR.raporSaatlik, korumali, async (istek) => {
    const { from, to } = zAralik.parse(istek.query);
    const satirlar = await uygulama.vt.tumu<{ saat: string; ciro: number; islem: number }>(
      `SELECT CAST(strftime('%H', tarih) AS INTEGER) saat,
              COALESCE(SUM(genel_toplam), 0) ciro, COUNT(*) islem
       FROM satislar
       WHERE isletme_id = ? AND tarih >= ? AND tarih <= ? AND iptal_mi = 0 AND iade_mi = 0
       GROUP BY saat`,
      [istek.kullanici?.isletmeId, gunBasi(from), gunSonu(to)],
    );

    const saatler = Array.from({ length: 24 }, (_, saat) => ({ saat, ciro: 0, islem: 0 }));
    for (const s of satirlar) {
      const i = Number(s.saat);
      if (i >= 0 && i < 24) saatler[i] = { saat: i, ciro: sayi(s.ciro), islem: sayi(s.islem) };
    }
    return { from, to, data: saatler, uretim_zamani: simdi() };
  });

  // -------------------------------------------------- İADE / İPTAL ANALİZİ
  /*
   * Suistimal göstergesi (§11.7): iade ve iptal oranları ile kasiyer kırılımı.
   * Oranlar rollup'tan (gunluk_ozet), kasiyer kırılımı satislar'dan gelir.
   */
  uygulama.get(UCLAR.raporSuistimal, korumali, async (istek) => {
    const { from, to } = zAralik.parse(istek.query);
    const isletmeId = istek.kullanici?.isletmeId;
    const bas = gunBasi(from);
    const bit = gunSonu(to);

    const [ozet, kasiyerler] = await Promise.all([
      uygulama.vt.tek<Record<string, unknown>>(
        `SELECT COALESCE(SUM(ciro),0) ciro, COALESCE(SUM(iade_toplam),0) iade, COALESCE(SUM(iptal_toplam),0) iptal
         FROM gunluk_ozet WHERE isletme_id = ? AND tarih >= ? AND tarih <= ?`,
        [isletmeId, from, to],
      ),
      uygulama.vt.tumu<Record<string, unknown>>(
        `SELECT s.kullanici_id, COALESCE(k.ad, MAX(s.kasiyer_adi), 'Bilinmeyen') kullanici_adi,
                SUM(CASE WHEN s.iade_mi = 0 AND s.iptal_mi = 0 THEN 1 ELSE 0 END) satis,
                SUM(CASE WHEN s.iade_mi = 1 THEN 1 ELSE 0 END) iade,
                SUM(CASE WHEN s.iptal_mi = 1 THEN 1 ELSE 0 END) iptal,
                COALESCE(SUM(CASE WHEN s.iade_mi = 1 THEN ABS(s.genel_toplam) ELSE 0 END), 0) iade_tutari,
                COALESCE(SUM(CASE WHEN s.iptal_mi = 1 THEN s.genel_toplam ELSE 0 END), 0) iptal_tutari
         FROM satislar s
         LEFT JOIN kullanicilar k ON k.isletme_id = s.isletme_id AND k.id = s.kullanici_id
         WHERE s.isletme_id = ? AND s.tarih >= ? AND s.tarih <= ?
         GROUP BY s.kullanici_id ORDER BY iade DESC, iptal DESC`,
        [isletmeId, bas, bit],
      ),
    ]);

    const ciro = sayi(ozet?.ciro);
    // iade_toplam rollup'ta negatif tutulur; oran için mutlak değeri kullanılır.
    const iadeTutari = Math.abs(sayi(ozet?.iade));
    const iptalTutari = sayi(ozet?.iptal);
    const oran = (tutar: number) => (ciro > 0 ? Math.round((tutar / ciro) * 10000) / 100 : 0);

    return {
      from,
      to,
      ciro,
      iadeTutari,
      iptalTutari,
      iadeOrani: oran(iadeTutari),
      iptalOrani: oran(iptalTutari),
      kasiyerBazli: kasiyerler.map((k) => ({
        kullanici_id: k.kullanici_id ?? null,
        kullanici_adi: String(k.kullanici_adi),
        satis: sayi(k.satis),
        iade: sayi(k.iade),
        iptal: sayi(k.iptal),
        iade_tutari: sayi(k.iade_tutari),
        iptal_tutari: sayi(k.iptal_tutari),
      })),
      uretim_zamani: simdi(),
    };
  });
}
