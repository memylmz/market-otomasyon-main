/**
 * Yönetim (panel) rotaları — §9.2, §11.4/11.8/11.9.
 *
 * Panelden yapılan her değişiklik yeni bir `versiyon` alır; kasa bir sonraki
 * pull'da yalnız bu deltayı çeker (§6.5 kural 2).
 */

import {
  aramaNormalize,
  hatalar,
  merkeziAyarMi,
  MERKEZI_AYARLAR,
  simdi,
  turkceSiralamaAnahtari,
  UCLAR,
  uuid,
  zSayfaIstegi,
  type Rol,
} from '@market/shared';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { parolaHashle } from '../guvenlik.js';
import { sonrakiVersiyon, type Islem } from '../vt/baglanti.js';
import { panelKorumasi, rolIste } from './koruma.js';

const zUrunGovde = z.object({
  id: z.string().uuid().optional(),
  ad: z.string().trim().min(1).max(200),
  kategori_id: z.string().uuid().nullable().optional(),
  marka: z.string().max(120).nullable().optional(),
  birim_tipi: z.enum(['ADET', 'KG', 'LT']).default('ADET'),
  alis_fiyati: z.number().int().nonnegative().default(0),
  satis_fiyati: z.number().int().nonnegative(),
  kdv_orani: z.number().min(0).max(100).default(20),
  kritik_stok: z.number().int().default(0),
  ideal_stok: z.number().int().default(0),
  raf_konumu: z.string().max(60).nullable().optional(),
  aktif_mi: z.boolean().default(true),
  skt_takibi: z.boolean().default(false),
  notlar: z.string().max(1000).nullable().optional(),
});

/**
 * Panelden girilen stok talimatı (§11.5).
 *
 * `fark` GÖRELİdir, mutlak hedef değildir: panel 35 görürken 40 yazılırsa +5
 * gider. Senkron gecikirken kasa 3 adet satmışsa sonuç 32+5=37 olur; mutlak
 * hedef gönderilseydi o 3 satış stok tablosundan silinmiş olurdu.
 */
const zStokDuzeltmeGovde = z.object({
  urun_id: z.string().uuid(),
  tip: z.enum(['DUZELTME', 'ACILIS']).default('DUZELTME'),
  /**
   * Stoğun olması istenen miktarı. Farkı KASA hesaplar, kendi güncel stoğuna
   * göre — panelin gördüğü rakam senkron beklerken bayatlayabildiği için fark
   * burada hesaplanırsa yanlış tabana oturur ve sonuç kullanıcının yazdığı
   * sayı olmaz (§11.5).
   */
  hedef_miktar: z.number().int().nonnegative(),
  neden: z.string().trim().min(1).max(200),
  hedef_cihaz_id: z.string().min(1).max(64),
});

const zKategoriGovde = z.object({
  id: z.string().uuid().optional(),
  ad: z.string().trim().min(1).max(120),
  ust_kategori_id: z.string().uuid().nullable().optional(),
  sira: z.number().int().default(0),
  aktif_mi: z.boolean().default(true),
});

const zKampanyaGovde = z.object({
  id: z.string().uuid().optional(),
  ad: z.string().trim().min(1).max(120),
  tip: z.enum(['YUZDE', 'TUTAR', 'SABIT_FIYAT']),
  kapsam: z.enum(['URUN', 'KATEGORI', 'TUM']),
  hedef_id: z.string().uuid().nullable().optional(),
  deger: z.number(),
  baslangic: z.string().datetime({ offset: true }),
  bitis: z.string().datetime({ offset: true }),
  oncelik: z.number().int().default(0),
  aktif_mi: z.boolean().default(true),
});

const zCariGovde = z.object({
  id: z.string().uuid().optional(),
  tip: z.enum(['MUSTERI', 'TEDARIKCI']),
  ad_unvan: z.string().trim().min(1).max(200),
  telefon: z.string().max(32).nullable().optional(),
  eposta: z.string().max(120).nullable().optional(),
  adres: z.string().max(500).nullable().optional(),
  vergi_dairesi: z.string().max(120).nullable().optional(),
  vergi_no: z.string().max(32).nullable().optional(),
  kredi_limiti: z.number().int().nonnegative().default(0),
  vade_gun: z.number().int().min(0).max(365).default(0),
  notlar: z.string().max(1000).nullable().optional(),
  aktif_mi: z.boolean().default(true),
  iletisim_rizasi: z.boolean().default(false),
});

const zKullaniciGovde = z.object({
  id: z.string().uuid().optional(),
  ad: z.string().trim().min(1).max(120),
  kullanici_adi: z
    .string()
    .trim()
    .min(3)
    .max(60)
    .regex(/^[a-zA-Z0-9._-]+$/),
  rol: z.enum(['ADMIN', 'MUDUR', 'KASIYER']),
  sifre: z.string().min(8).max(200).optional(),
  pin: z
    .string()
    .regex(/^\d{4,8}$/)
    .optional(),
  aktif_mi: z.boolean().default(true),
  ek_yetkiler: z.array(z.string()).default([]),
  kaldirilan_yetkiler: z.array(z.string()).default([]),
});

/** Denetim kaydı — panelden yapılan her değişiklik izlenir (§11.9). */
async function denetle(
  islem: Islem,
  isletmeId: string,
  kullaniciId: string,
  islemAdi: string,
  entity: string,
  entityId: string,
  yeniDeger: unknown,
): Promise<void> {
  await islem.calistir(
    `INSERT INTO denetim_log (id, isletme_id, kullanici_id, islem, entity, entity_id, yeni_deger, zaman, cihaz_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'panel')`,
    [uuid(), isletmeId, kullaniciId, islemAdi, entity, entityId, JSON.stringify(yeniDeger), simdi()],
  );
}

export async function yonetimRotalari(uygulama: FastifyInstance): Promise<void> {
  const korumali = { preHandler: panelKorumasi };
  const yonetici = { preHandler: [panelKorumasi, rolIste('ADMIN', 'MUDUR')] };

  // ------------------------------------------------------------- ÜRÜNLER
  uygulama.get(UCLAR.urunler, korumali, async (istek) => {
    const sorgu = zSayfaIstegi.parse(istek.query);
    const isletmeId = istek.kullanici?.isletmeId;

    /*
     * Arama ve sıralama JS'te yapılır (kasa ile aynı davranış):
     *  - `aramaNormalize` sayesinde "sut" → "Süt" bulunur (SQL LOWER bunu yapamaz).
     *  - `turkceSiralamaAnahtari` ile ç/ğ/ı/ö/ş/ü doğru sırada, harf boyutu önemsiz
     *    (libSQL'e özel fonksiyon kaydedilemediği için SQL'de yapılamıyor).
     * Katalog ölçeği (birkaç bin ürün) için bellek maliyeti önemsizdir.
     */
    const satirlar = await uygulama.vt.tumu<Record<string, unknown>>(
      `SELECT u.id, u.ad, u.kategori_id, u.marka, u.birim_tipi, u.alis_fiyati, u.satis_fiyati, u.kdv_orani,
              u.kritik_stok, u.ideal_stok, u.raf_konumu, u.aktif_mi, u.skt_takibi, u.notlar, u.updated_at,
              COALESCE(s.miktar, 0) AS stok, k.ad AS kategori_adi
       FROM urunler u
       LEFT JOIN stok_ozet s ON s.isletme_id = u.isletme_id AND s.urun_id = u.id
       LEFT JOIN kategoriler k ON k.isletme_id = u.isletme_id AND k.id = u.kategori_id
       WHERE u.isletme_id = ? AND u.silindi_mi = 0
       LIMIT 5000`,
      [isletmeId],
    );

    const q = istek.query as { kategori_id?: string; siralama?: string; ofset?: string; sadece_kritik?: string };
    const terim = sorgu.q ? aramaNormalize(sorgu.q) : '';

    let suzulen = terim
      ? satirlar.filter((u) => aramaNormalize(`${String(u.ad)} ${String(u.marka ?? '')}`).includes(terim))
      : satirlar;
    if (q.kategori_id) suzulen = suzulen.filter((u) => u.kategori_id === q.kategori_id);
    if (q.sadece_kritik === '1') {
      suzulen = suzulen.filter((u) => Number(u.kritik_stok) > 0 && Number(u.stok) <= Number(u.kritik_stok));
    }

    // Sıralama seçenekleri kasadaki ürün listesiyle birebir aynı.
    const adAnahtari = (u: Record<string, unknown>) => turkceSiralamaAnahtari(String(u.ad));
    if (q.siralama === 'stok')
      suzulen.sort((a, b) => Number(a.stok) - Number(b.stok) || (adAnahtari(a) < adAnahtari(b) ? -1 : 1));
    else if (q.siralama === 'fiyat') suzulen.sort((a, b) => Number(b.satis_fiyati) - Number(a.satis_fiyati));
    else if (q.siralama === 'guncelleme') suzulen.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    else suzulen.sort((a, b) => (adAnahtari(a) < adAnahtari(b) ? -1 : 1));

    const ofset = Math.max(0, Number(q.ofset ?? 0) || 0);
    const veri = suzulen.slice(ofset, ofset + sorgu.limit);
    return { data: veri, toplam: suzulen.length, next_cursor: null, has_more: ofset + veri.length < suzulen.length };
  });

  uygulama.post(UCLAR.urunler, yonetici, async (istek) => {
    const govde = zUrunGovde.parse(istek.body);
    const isletmeId = istek.kullanici?.isletmeId as string;
    const zaman = simdi();
    const id = govde.id ?? uuid();

    await uygulama.vt.islem(async (islem) => {
      const versiyon = await sonrakiVersiyon(islem, isletmeId);
      await islem.calistir(
        `INSERT INTO urunler (isletme_id, id, ad, kategori_id, marka, birim_tipi, alis_fiyati, satis_fiyati,
                              kdv_orani, kritik_stok, ideal_stok, raf_konumu, aktif_mi, skt_takibi, notlar,
                              created_at, updated_at, cihaz_id, versiyon)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'panel', ?)
         ON CONFLICT(isletme_id, id) DO UPDATE SET
           ad = excluded.ad, kategori_id = excluded.kategori_id, marka = excluded.marka,
           birim_tipi = excluded.birim_tipi, alis_fiyati = excluded.alis_fiyati,
           satis_fiyati = excluded.satis_fiyati, kdv_orani = excluded.kdv_orani,
           kritik_stok = excluded.kritik_stok, ideal_stok = excluded.ideal_stok,
           raf_konumu = excluded.raf_konumu, aktif_mi = excluded.aktif_mi,
           skt_takibi = excluded.skt_takibi, notlar = excluded.notlar,
           updated_at = excluded.updated_at, cihaz_id = 'panel', versiyon = excluded.versiyon`,
        [
          isletmeId,
          id,
          govde.ad,
          govde.kategori_id ?? null,
          govde.marka ?? null,
          govde.birim_tipi,
          govde.alis_fiyati,
          govde.satis_fiyati,
          govde.kdv_orani,
          govde.kritik_stok,
          govde.ideal_stok,
          govde.raf_konumu ?? null,
          govde.aktif_mi ? 1 : 0,
          govde.skt_takibi ? 1 : 0,
          govde.notlar ?? null,
          zaman,
          zaman,
          versiyon,
        ],
      );
      await denetle(islem, isletmeId, istek.kullanici?.id as string, govde.id ? 'URUN_GUNCELLE' : 'URUN_EKLE', 'urun', id, govde);
    });

    return { id };
  });

  /** Toplu zam (§11.4) — tek transaction, her ürün yeni sürüm alır.
      Kasadaki toplu fiyat işlemiyle aynı kural: hedef SATIS ya da ALIS (maliyet),
      ikisi ayrı ayrı uygulanır; ALIS seçilince raf fiyatına dokunulmaz. */
  uygulama.post(`${UCLAR.urunler}/toplu-fiyat`, yonetici, async (istek) => {
    const govde = z
      .object({
        yuzde: z.number().min(-90).max(500),
        kategori_id: z.string().uuid().nullable().optional(),
        hedef: z.enum(['SATIS', 'ALIS']).default('SATIS'),
      })
      .parse(istek.body);
    const isletmeId = istek.kullanici?.isletmeId as string;
    const zaman = simdi();
    const sutun = govde.hedef === 'ALIS' ? 'alis_fiyati' : 'satis_fiyati';

    const etkilenen = await uygulama.vt.islem(async (islem) => {
      const urunler = await islem.tumu<{ id: string; fiyat: number }>(
        `SELECT id, ${sutun} AS fiyat FROM urunler
           WHERE isletme_id = ? AND silindi_mi = 0 AND aktif_mi = 1
             AND (? IS NULL OR kategori_id = ?)`,
        [isletmeId, govde.kategori_id ?? null, govde.kategori_id ?? null],
      );

      let degisen = 0;
      for (const urun of urunler) {
        const eski = Number(urun.fiyat);
        // Yuvarlama sıfırdan uzağa; kuruş kaybı olmasın.
        const yeni = Math.max(0, eski + Math.round((eski * govde.yuzde) / 100));
        if (yeni === eski) continue;
        degisen++;
        const versiyon = await sonrakiVersiyon(islem, isletmeId);
        await islem.calistir(
          `UPDATE urunler SET ${sutun} = ?, updated_at = ?, cihaz_id = ?, versiyon = ? WHERE isletme_id = ? AND id = ?`,
          [yeni, zaman, 'panel', versiyon, isletmeId, urun.id],
        );
      }
      await denetle(islem, isletmeId, istek.kullanici?.id as string, 'TOPLU_FIYAT', 'urun', 'toplu', {
        yuzde: govde.yuzde,
        hedef: govde.hedef,
        adet: degisen,
      });
      return degisen;
    });

    return { etkilenen };
  });

  // --------------------------------------------------------- KATEGORİLER
  uygulama.get(UCLAR.kategoriler, korumali, async (istek) => {
    const veri = await uygulama.vt.tumu<Record<string, unknown>>(
      'SELECT id, ad, ust_kategori_id, sira, aktif_mi FROM kategoriler WHERE isletme_id = ? AND silindi_mi = 0',
      [istek.kullanici?.isletmeId],
    );
    // Kasa ile aynı sıra: önce sira, sonra Türkçe alfabetik ad.
    veri.sort((a, b) => {
      const fark = Number(a.sira) - Number(b.sira);
      if (fark !== 0) return fark;
      return turkceSiralamaAnahtari(String(a.ad)) < turkceSiralamaAnahtari(String(b.ad)) ? -1 : 1;
    });
    return { data: veri };
  });

  uygulama.post(UCLAR.kategoriler, yonetici, async (istek) => {
    const govde = zKategoriGovde.parse(istek.body);
    const isletmeId = istek.kullanici?.isletmeId as string;
    const zaman = simdi();
    const id = govde.id ?? uuid();

    await uygulama.vt.islem(async (islem) => {
      const versiyon = await sonrakiVersiyon(islem, isletmeId);
      await islem.calistir(
        `INSERT INTO kategoriler (isletme_id, id, ad, ust_kategori_id, sira, aktif_mi, created_at, updated_at, cihaz_id, versiyon)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'panel', ?)
         ON CONFLICT(isletme_id, id) DO UPDATE SET
           ad = excluded.ad, ust_kategori_id = excluded.ust_kategori_id, sira = excluded.sira,
           aktif_mi = excluded.aktif_mi, updated_at = excluded.updated_at, versiyon = excluded.versiyon`,
        [isletmeId, id, govde.ad, govde.ust_kategori_id ?? null, govde.sira, govde.aktif_mi ? 1 : 0, zaman, zaman, versiyon],
      );
      await denetle(islem, isletmeId, istek.kullanici?.id as string, 'KATEGORI_KAYDET', 'kategori', id, govde);
    });
    return { id };
  });

  // --------------------------------------------------------- KAMPANYALAR
  uygulama.get(UCLAR.kampanyalar, korumali, async (istek) => {
    const veri = await uygulama.vt.tumu(
      `SELECT id, ad, tip, kapsam, hedef_id, deger, baslangic, bitis, oncelik, aktif_mi
       FROM kampanyalar WHERE isletme_id = ? AND silindi_mi = 0 ORDER BY baslangic DESC`,
      [istek.kullanici?.isletmeId],
    );
    return { data: veri };
  });

  uygulama.post(UCLAR.kampanyalar, yonetici, async (istek) => {
    const govde = zKampanyaGovde.parse(istek.body);
    if (govde.bitis <= govde.baslangic) throw hatalar.dogrulama('Bitiş tarihi başlangıçtan sonra olmalıdır.');
    const isletmeId = istek.kullanici?.isletmeId as string;
    const zaman = simdi();
    const id = govde.id ?? uuid();

    await uygulama.vt.islem(async (islem) => {
      const versiyon = await sonrakiVersiyon(islem, isletmeId);
      await islem.calistir(
        `INSERT INTO kampanyalar (isletme_id, id, ad, tip, kapsam, hedef_id, deger, baslangic, bitis,
                                  oncelik, aktif_mi, created_at, updated_at, cihaz_id, versiyon)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'panel', ?)
         ON CONFLICT(isletme_id, id) DO UPDATE SET
           ad = excluded.ad, tip = excluded.tip, kapsam = excluded.kapsam, hedef_id = excluded.hedef_id,
           deger = excluded.deger, baslangic = excluded.baslangic, bitis = excluded.bitis,
           oncelik = excluded.oncelik, aktif_mi = excluded.aktif_mi, updated_at = excluded.updated_at,
           versiyon = excluded.versiyon`,
        [
          isletmeId,
          id,
          govde.ad,
          govde.tip,
          govde.kapsam,
          govde.hedef_id ?? null,
          govde.deger,
          govde.baslangic,
          govde.bitis,
          govde.oncelik,
          govde.aktif_mi ? 1 : 0,
          zaman,
          zaman,
          versiyon,
        ],
      );
      await denetle(islem, isletmeId, istek.kullanici?.id as string, 'KAMPANYA_KAYDET', 'kampanya', id, govde);
    });
    return { id };
  });

  // -------------------------------------------------------------- CARİLER
  uygulama.get(UCLAR.cariler, korumali, async (istek) => {
    const sorgu = zSayfaIstegi.parse(istek.query);
    const tip = (istek.query as { tip?: string }).tip ?? null;
    const veri = await uygulama.vt.tumu(
      `SELECT c.id, c.tip, c.ad_unvan, c.telefon, c.eposta, c.kredi_limiti, c.vade_gun, c.aktif_mi,
              COALESCE(o.bakiye, 0) AS bakiye, o.son_hareket
       FROM cariler c
       LEFT JOIN cari_ozet o ON o.isletme_id = c.isletme_id AND o.cari_id = c.id
       WHERE c.isletme_id = ? AND c.silindi_mi = 0 AND (? IS NULL OR c.tip = ?)
       ORDER BY ABS(COALESCE(o.bakiye, 0)) DESC, c.ad_unvan LIMIT ?`,
      [istek.kullanici?.isletmeId, tip, tip, sorgu.limit],
    );
    return { data: veri, next_cursor: null, has_more: veri.length >= sorgu.limit };
  });

  uygulama.post(UCLAR.cariler, yonetici, async (istek) => {
    const govde = zCariGovde.parse(istek.body);
    const isletmeId = istek.kullanici?.isletmeId as string;
    const zaman = simdi();
    const id = govde.id ?? uuid();

    await uygulama.vt.islem(async (islem) => {
      const versiyon = await sonrakiVersiyon(islem, isletmeId);
      await islem.calistir(
        `INSERT INTO cariler (isletme_id, id, tip, ad_unvan, telefon, eposta, adres, vergi_dairesi, vergi_no,
                              kredi_limiti, vade_gun, notlar, aktif_mi, iletisim_rizasi, iletisim_rizasi_zamani,
                              created_at, updated_at, cihaz_id, versiyon)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'panel', ?)
         ON CONFLICT(isletme_id, id) DO UPDATE SET
           tip = excluded.tip, ad_unvan = excluded.ad_unvan, telefon = excluded.telefon,
           eposta = excluded.eposta, adres = excluded.adres, vergi_dairesi = excluded.vergi_dairesi,
           vergi_no = excluded.vergi_no, kredi_limiti = excluded.kredi_limiti, vade_gun = excluded.vade_gun,
           notlar = excluded.notlar, aktif_mi = excluded.aktif_mi, iletisim_rizasi = excluded.iletisim_rizasi,
           iletisim_rizasi_zamani = excluded.iletisim_rizasi_zamani,
           updated_at = excluded.updated_at, versiyon = excluded.versiyon`,
        [
          isletmeId,
          id,
          govde.tip,
          govde.ad_unvan,
          govde.telefon ?? null,
          govde.eposta ?? null,
          govde.adres ?? null,
          govde.vergi_dairesi ?? null,
          govde.vergi_no ?? null,
          govde.kredi_limiti,
          govde.vade_gun,
          govde.notlar ?? null,
          govde.aktif_mi ? 1 : 0,
          govde.iletisim_rizasi ? 1 : 0,
          govde.iletisim_rizasi ? zaman : null,
          zaman,
          zaman,
          versiyon,
        ],
      );
      await denetle(islem, isletmeId, istek.kullanici?.id as string, 'CARI_KAYDET', 'cari', id, { ...govde, notlar: undefined });
    });
    return { id };
  });

  /** KVKK anonimleştirme (§16.2) — mali kayıtlar korunur, kişisel alanlar silinir. */
  uygulama.post<{ Params: { id: string } }>(
    `${UCLAR.cariler}/:id/anonimlestir`,
    { preHandler: [panelKorumasi, rolIste('ADMIN')] },
    async (istek) => {
      const isletmeId = istek.kullanici?.isletmeId as string;
      const zaman = simdi();
      const gerekce = (istek.body as { gerekce?: string } | undefined)?.gerekce ?? 'Veri sahibi talebi';

      await uygulama.vt.islem(async (islem) => {
        const versiyon = await sonrakiVersiyon(islem, isletmeId);
        const sonuc = await islem.calistir(
          `UPDATE cariler SET
             ad_unvan = 'Anonimleştirilmiş kayıt ' || substr(id, 1, 8),
             telefon = NULL, eposta = NULL, adres = NULL, vergi_dairesi = NULL, vergi_no = NULL,
             notlar = NULL, iletisim_rizasi = 0, iletisim_rizasi_zamani = NULL,
             anonimlestirildi_mi = 1, aktif_mi = 0, updated_at = ?, versiyon = ?
           WHERE isletme_id = ? AND id = ?`,
          [zaman, versiyon, isletmeId, istek.params.id],
        );
        if (sonuc.rowsAffected === 0) throw hatalar.bulunamadi('Cari hesap');
        await denetle(islem, isletmeId, istek.kullanici?.id as string, 'KVKK_ANONIMLESTIRME', 'cari', istek.params.id, {
          gerekce,
        });
      });

      istek.log.info({ cari: istek.params.id, kullanici: istek.kullanici?.id }, 'KVKK anonimleştirme uygulandı');
      return { basarili: true };
    },
  );

  // ---------------------------------------------------------- KULLANICILAR
  uygulama.get(UCLAR.kullanicilar, { preHandler: [panelKorumasi, rolIste('ADMIN')] }, async (istek) => {
    const veri = await uygulama.vt.tumu(
      /*
       * Hash'ler ASLA dışarı çıkmaz; yalnız VAR/YOK bilgisi döner.
       *
       * Panele giriş şifre ister, kasaya giriş PIN. Liste bunu göstermezse
       * "Yönetici" rozetini gören kişi o hesabın panele girebileceğini sanır;
       * şifresi yoksa giremez ve sebebini hiçbir yerde göremez.
       */
      `SELECT id, ad, kullanici_adi, rol, aktif_mi, ek_yetkiler, kaldirilan_yetkiler, updated_at,
              CASE WHEN sifre_hash IS NULL OR sifre_hash = '' THEN 0 ELSE 1 END AS sifre_var,
              CASE WHEN pin_hash IS NULL OR pin_hash = '' THEN 0 ELSE 1 END AS pin_var
       FROM kullanicilar WHERE isletme_id = ? AND silindi_mi = 0 ORDER BY ad`,
      [istek.kullanici?.isletmeId],
    );
    return { data: veri };
  });

  uygulama.post(UCLAR.kullanicilar, { preHandler: [panelKorumasi, rolIste('ADMIN')] }, async (istek) => {
    const govde = zKullaniciGovde.parse(istek.body);
    const isletmeId = istek.kullanici?.isletmeId as string;
    const zaman = simdi();
    const id = govde.id ?? uuid();

    await uygulama.vt.islem(async (islem) => {
      const mevcut = await islem.tek<{ sifre_hash: string | null; pin_hash: string | null; rol: Rol }>(
        'SELECT sifre_hash, pin_hash, rol FROM kullanicilar WHERE isletme_id = ? AND id = ?',
        [isletmeId, id],
      );

      // Son aktif yönetici kilitlenemez.
      if (mevcut?.rol === 'ADMIN' && (govde.rol !== 'ADMIN' || !govde.aktif_mi)) {
        const kalan = await islem.tek<{ adet: number }>(
          "SELECT COUNT(*) AS adet FROM kullanicilar WHERE isletme_id = ? AND rol = 'ADMIN' AND aktif_mi = 1 AND silindi_mi = 0 AND id <> ?",
          [isletmeId, id],
        );
        if (Number(kalan?.adet ?? 0) === 0) throw hatalar.dogrulama('Sistemde en az bir aktif yönetici kalmalıdır.');
      }

      const versiyon = await sonrakiVersiyon(islem, isletmeId);
      await islem.calistir(
        `INSERT INTO kullanicilar (isletme_id, id, ad, kullanici_adi, sifre_hash, pin_hash, rol,
                                   ek_yetkiler, kaldirilan_yetkiler, aktif_mi, created_at, updated_at, cihaz_id, versiyon)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'panel', ?)
         ON CONFLICT(isletme_id, id) DO UPDATE SET
           ad = excluded.ad, kullanici_adi = excluded.kullanici_adi,
           sifre_hash = COALESCE(excluded.sifre_hash, kullanicilar.sifre_hash),
           pin_hash = COALESCE(excluded.pin_hash, kullanicilar.pin_hash),
           rol = excluded.rol, ek_yetkiler = excluded.ek_yetkiler,
           kaldirilan_yetkiler = excluded.kaldirilan_yetkiler, aktif_mi = excluded.aktif_mi,
           updated_at = excluded.updated_at, versiyon = excluded.versiyon`,
        [
          isletmeId,
          id,
          govde.ad,
          govde.kullanici_adi,
          govde.sifre ? parolaHashle(govde.sifre) : (mevcut?.sifre_hash ?? null),
          govde.pin ? parolaHashle(govde.pin) : (mevcut?.pin_hash ?? null),
          govde.rol,
          JSON.stringify(govde.ek_yetkiler),
          JSON.stringify(govde.kaldirilan_yetkiler),
          govde.aktif_mi ? 1 : 0,
          zaman,
          zaman,
          versiyon,
        ],
      );
      // Şifre/PIN denetim kaydına ASLA yazılmaz.
      await denetle(islem, isletmeId, istek.kullanici?.id as string, 'KULLANICI_KAYDET', 'kullanici', id, {
        ad: govde.ad,
        kullanici_adi: govde.kullanici_adi,
        rol: govde.rol,
        aktif_mi: govde.aktif_mi,
      });
    });

    return { id };
  });

  /**
   * Kategori silme (§10.5). Kullanıcı silmeyle aynı kural ve aynı mezar taşı
   * mantığı: satır fiziksel kaldırılmaz, `silindi_mi = 1` + yeni versiyon.
   */
  uygulama.delete<{ Params: { id: string } }>(`${UCLAR.kategoriler}/:id`, yonetici, async (istek) => {
    const isletmeId = istek.kullanici?.isletmeId as string;
    const id = istek.params.id;
    const zaman = simdi();

    return uygulama.vt.islem(async (islem) => {
      const mevcut = await islem.tek<{ ad: string }>(
        'SELECT ad FROM kategoriler WHERE isletme_id = ? AND id = ? AND silindi_mi = 0',
        [isletmeId, id],
      );
      if (!mevcut) throw hatalar.bulunamadi('Kategori');

      const urun = await islem.tek<{ adet: number }>(
        'SELECT COUNT(*) AS adet FROM urunler WHERE isletme_id = ? AND kategori_id = ? AND silindi_mi = 0',
        [isletmeId, id],
      );
      const alt = await islem.tek<{ adet: number }>(
        'SELECT COUNT(*) AS adet FROM kategoriler WHERE isletme_id = ? AND ust_kategori_id = ? AND silindi_mi = 0',
        [isletmeId, id],
      );
      const urunSayisi = Number(urun?.adet ?? 0);
      const altKategoriSayisi = Number(alt?.adet ?? 0);
      const silinebilir = urunSayisi === 0 && altKategoriSayisi === 0;

      const versiyon = await sonrakiVersiyon(islem, isletmeId);
      await islem.calistir(
        `UPDATE kategoriler SET silindi_mi = ?, aktif_mi = 0, updated_at = ?, cihaz_id = 'panel', versiyon = ?
           WHERE isletme_id = ? AND id = ?`,
        [silinebilir ? 1 : 0, zaman, versiyon, isletmeId, id],
      );

      await denetle(
        islem,
        isletmeId,
        istek.kullanici?.id as string,
        silinebilir ? 'KATEGORI_SIL' : 'KATEGORI_PASIFLESTIR',
        'kategori',
        id,
        { ad: mevcut.ad, urun_sayisi: urunSayisi, alt_kategori_sayisi: altKategoriSayisi },
      );

      return { silindi: silinebilir, urunSayisi, altKategoriSayisi, ad: mevcut.ad };
    });
  });

  // --------------------------------------------------------- STOK TALİMATI
  uygulama.get(UCLAR.stokDuzeltmeleri, { preHandler: panelKorumasi }, async (istek) => {
    const veri = await uygulama.vt.tumu(
      `SELECT d.id, d.urun_id, u.ad AS urun_adi, d.tip, d.fark, d.neden, d.hedef_cihaz_id, d.created_at
       FROM stok_duzeltmeleri d LEFT JOIN urunler u ON u.isletme_id = d.isletme_id AND u.id = d.urun_id
       WHERE d.isletme_id = ? AND d.silindi_mi = 0
       ORDER BY d.created_at DESC LIMIT 100`,
      [istek.kullanici?.isletmeId],
    );
    return { data: veri };
  });

  const zAyarGovde = z.object({
    degerler: z.record(z.string(), z.string().max(2000)),
  });

  // ------------------------------------------------------- MAĞAZA AYARLARI
  /*
   * Mağaza geneli ayarlar (§8.3).
   *
   * Yalnız BEYAZ LİSTEDEKİ anahtarlar okunur ve yazılır. Yazıcı hedefi, cihaz
   * kimliği, fiş serisi gibi cihaza özel ayarlar buradan yönetilemez: hepsi
   * aynı değeri alsaydı her kasa aynı yazıcıya basmaya çalışırdı.
   *
   * Yazma sürüm alır, böylece kasalar normal pull ile ayarı indirir.
   */
  uygulama.get(UCLAR.ayarlar, korumali, async (istek) => {
    const satirlar = await uygulama.vt.tumu<{ anahtar: string; deger: string; updated_at: string }>(
      'SELECT anahtar, deger, updated_at FROM ayarlar WHERE isletme_id = ? AND silindi_mi = 0 ORDER BY anahtar',
      [istek.kullanici?.isletmeId],
    );
    const bilinen = satirlar.filter((r) => merkeziAyarMi(String(r.anahtar)));
    return { data: bilinen, yonetilebilir: MERKEZI_AYARLAR, uretim_zamani: simdi() };
  });

  uygulama.post(UCLAR.ayarlar, yonetici, async (istek) => {
    const govde = zAyarGovde.parse(istek.body);
    const isletmeId = istek.kullanici?.isletmeId as string;
    const zaman = simdi();

    const gecersiz = Object.keys(govde.degerler).filter((k) => !merkeziAyarMi(k));
    if (gecersiz.length > 0) {
      throw hatalar.dogrulama(`Bu ayarlar merkezden yönetilemez: ${gecersiz.join(', ')}`);
    }

    await uygulama.vt.islem(async (islem) => {
      for (const [anahtar, deger] of Object.entries(govde.degerler)) {
        const mevcut = await islem.tek<{ id: string }>('SELECT id FROM ayarlar WHERE isletme_id = ? AND anahtar = ?', [
          isletmeId,
          anahtar,
        ]);
        const versiyon = await sonrakiVersiyon(islem, isletmeId);
        await islem.calistir(
          `INSERT INTO ayarlar (id, isletme_id, anahtar, deger, created_at, updated_at, cihaz_id, versiyon, silindi_mi)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0)
           ON CONFLICT(isletme_id, id) DO UPDATE SET
             deger = excluded.deger, updated_at = excluded.updated_at, versiyon = excluded.versiyon`,
          [mevcut ? String(mevcut.id) : uuid(), isletmeId, anahtar, String(deger), zaman, zaman, versiyon],
        );
      }
    });

    return { basarili: true, yazilan: Object.keys(govde.degerler).length, uretim_zamani: zaman };
  });

  uygulama.post(UCLAR.stokDuzeltmeleri, yonetici, async (istek) => {
    const govde = zStokDuzeltmeGovde.parse(istek.body);
    const isletmeId = istek.kullanici?.isletmeId as string;
    const zaman = simdi();
    const id = uuid();

    await uygulama.vt.islem(async (islem) => {
      const urun = await islem.tek<{ id: string }>('SELECT id FROM urunler WHERE isletme_id = ? AND id = ? AND silindi_mi = 0', [
        isletmeId,
        govde.urun_id,
      ]);
      if (!urun) throw hatalar.bulunamadi('Ürün');

      // DİKKAT — iki ayrı kimlik: `cihazlar.id` bulut satırının UUID'si,
      // `cihazlar.cihaz_id` ise kasanın KENDİ kimliğidir (örn. "kasa-f9549a8c").
      // Panel /v1/devices'tan aldığı satır id'sini gönderir; kasa ise talimatı
      // kendi `cihaz_id`'siyle karşılaştırır. Çeviriyi burada yapıyoruz, yoksa
      // talimat hiçbir kasada eşleşmez ve sessizce hiç uygulanmaz.
      const cihaz = await islem.tek<{ cihaz_id: string }>(
        'SELECT cihaz_id FROM cihazlar WHERE isletme_id = ? AND (id = ? OR cihaz_id = ?)',
        [isletmeId, govde.hedef_cihaz_id, govde.hedef_cihaz_id],
      );
      if (!cihaz) throw hatalar.bulunamadi('Kasa');

      /**
       * Aynı ürün + aynı kasa için HENÜZ UYGULANMAMIŞ talimatlar iptal edilir.
       *
       * Talimatlar farktır ve panel stoğu ancak kasa uyguladıktan sonra
       * güncellenir. Kasa senkron olmadan kullanıcı "olmadı" deyip tekrar
       * girerse, ikinci fark da AYNI eski rakama göre hesaplanır; ikisi birden
       * uygulanınca stok istenenin iki katına çıkar. Bu yüzden sonuncusu
       * öncekilerin yerine geçer.
       *
       * "Uygulandı mı?" sorusunun cevabı ek bir onay mekanizması gerektirmez:
       * kasa talimatı uygularken ürettiği stok hareketine talimatın id'sini
       * verir ve o hareket buraya geri gelir. `stok_hareketleri`'nde o id
       * varsa uygulanmıştır ve GEÇMİŞ SAYILIR — dokunulmaz.
       */
      const bekleyenler = await islem.tumu<{ id: string }>(
        `SELECT d.id FROM stok_duzeltmeleri d
         WHERE d.isletme_id = ? AND d.urun_id = ? AND d.hedef_cihaz_id = ? AND d.silindi_mi = 0
           AND NOT EXISTS (SELECT 1 FROM stok_hareketleri h WHERE h.isletme_id = d.isletme_id AND h.id = d.id)`,
        [isletmeId, govde.urun_id, cihaz.cihaz_id],
      );
      for (const bekleyen of bekleyenler) {
        const iptalVersiyon = await sonrakiVersiyon(islem, isletmeId);
        await islem.calistir(
          'UPDATE stok_duzeltmeleri SET silindi_mi = 1, updated_at = ?, versiyon = ? WHERE isletme_id = ? AND id = ?',
          [zaman, iptalVersiyon, isletmeId, String(bekleyen.id)],
        );
      }

      const versiyon = await sonrakiVersiyon(islem, isletmeId);
      await islem.calistir(
        `INSERT INTO stok_duzeltmeleri (id, isletme_id, urun_id, tip, fark, hedef_miktar, neden, hedef_cihaz_id,
                                        kullanici_id, created_at, updated_at, cihaz_id, versiyon)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'panel', ?)`,
        [
          id,
          isletmeId,
          govde.urun_id,
          govde.tip,
          govde.hedef_miktar,
          govde.neden,
          cihaz.cihaz_id,
          istek.kullanici?.id ?? null,
          zaman,
          zaman,
          versiyon,
        ],
      );
      await denetle(islem, isletmeId, istek.kullanici?.id as string, 'STOK_TALIMATI', 'urun', govde.urun_id, {
        tip: govde.tip,
        hedef_miktar: govde.hedef_miktar,
        neden: govde.neden,
        hedef_cihaz_id: govde.hedef_cihaz_id,
      });
    });

    return { id };
  });

  /**
   * Kullanıcı silme (§12.1).
   *
   * Satır FİZİKSEL OLARAK SİLİNMEZ: pull sürüm deltasıyla çalıştığı için
   * kaldırılan bir satırın kasaya iletilecek versiyonu kalmaz ve kasa silmeyi
   * asla öğrenemezdi. Bunun yerine `silindi_mi = 1` mezar taşı yazılır ve yeni
   * bir versiyon alınır; kasa bunu çekip kararı yerelde yeniden verir.
   *
   * Buluttaki kayıtları olan kullanıcı silinmez, yalnız pasife alınır.
   */
  uygulama.delete<{ Params: { id: string } }>(
    `${UCLAR.kullanicilar}/:id`,
    { preHandler: [panelKorumasi, rolIste('ADMIN')] },
    async (istek) => {
      const isletmeId = istek.kullanici?.isletmeId as string;
      const id = istek.params.id;
      const zaman = simdi();

      // "Kendi hesabını silemezsin" kontrolü BURADA YOKTUR ve gerekmez: panel
      // girişi `panel_kullanicilari`, buradaki kayıtlar ise kasa personelini
      // tutan `kullanicilar` tablosundandır. İki ayrı kimlik uzayı olduğu için
      // silen ile silinen asla aynı olamaz. Kasada ise tek tablo vardır ve o
      // kontrol `kullanici-servis.ts` içinde uygulanır.

      return uygulama.vt.islem(async (islem) => {
        const mevcut = await islem.tek<{ ad: string; kullanici_adi: string; rol: Rol; aktif_mi: number }>(
          'SELECT ad, kullanici_adi, rol, aktif_mi FROM kullanicilar WHERE isletme_id = ? AND id = ? AND silindi_mi = 0',
          [isletmeId, id],
        );
        if (!mevcut) throw hatalar.bulunamadi('Kullanıcı');

        if (mevcut.rol === 'ADMIN' && Number(mevcut.aktif_mi) === 1) {
          const kalan = await islem.tek<{ adet: number }>(
            "SELECT COUNT(*) AS adet FROM kullanicilar WHERE isletme_id = ? AND rol = 'ADMIN' AND aktif_mi = 1 AND silindi_mi = 0 AND id <> ?",
            [isletmeId, id],
          );
          if (Number(kalan?.adet ?? 0) === 0) throw hatalar.dogrulama('Sistemde en az bir aktif yönetici kalmalıdır.');
        }

        // Merkezde bu kullanıcıya bağlı kayıt var mı? (Kasadaki tabloların
        // buluttaki karşılıkları; hepsinde `kullanici_id` bulunmaz.)
        let kayitSayisi = 0;
        for (const tablo of ['satislar', 'stok_hareketleri', 'kasa_oturumlari', 'cari_hareketler']) {
          const satir = await islem.tek<{ adet: number }>(
            `SELECT COUNT(*) AS adet FROM ${tablo} WHERE isletme_id = ? AND kullanici_id = ?`,
            [isletmeId, id],
          );
          kayitSayisi += Number(satir?.adet ?? 0);
        }
        const silinebilir = kayitSayisi === 0;

        const versiyon = await sonrakiVersiyon(islem, isletmeId);
        await islem.calistir(
          `UPDATE kullanicilar SET silindi_mi = ?, aktif_mi = ?, updated_at = ?, cihaz_id = 'panel', versiyon = ?
           WHERE isletme_id = ? AND id = ?`,
          [silinebilir ? 1 : 0, 0, zaman, versiyon, isletmeId, id],
        );

        await denetle(
          islem,
          isletmeId,
          istek.kullanici?.id as string,
          silinebilir ? 'KULLANICI_SIL' : 'KULLANICI_PASIFLESTIR',
          'kullanici',
          id,
          { ad: mevcut.ad, kullanici_adi: mevcut.kullanici_adi, kayit_sayisi: kayitSayisi },
        );

        return { silindi: silinebilir, kayitSayisi, ad: mevcut.ad };
      });
    },
  );

  // ------------------------------------------------------------- DENETİM
  uygulama.get(UCLAR.denetim, { preHandler: [panelKorumasi, rolIste('ADMIN')] }, async (istek) => {
    const sorgu = zSayfaIstegi.parse(istek.query);
    const veri = await uygulama.vt.tumu(
      `SELECT id, kullanici_id, islem, entity, entity_id, yeni_deger, zaman, cihaz_id
       FROM denetim_log WHERE isletme_id = ? ORDER BY zaman DESC LIMIT ?`,
      [istek.kullanici?.isletmeId, sorgu.limit],
    );
    return { data: veri };
  });
}
