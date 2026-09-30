/** Senkron rotaları: push / pull / status / conflicts (§7.3, §9.2). */

import {
  hatalar,
  HATA_KODU,
  PULL_VARLIKLARI,
  SEMA_SURUMU,
  SENKRON_PROTOKOL_SURUMU,
  simdi,
  UCLAR,
  UygulamaHatasi,
  zPullIstegi,
  zPushIstegi,
  type PullKaydi,
  type PullVarligi,
  type ReddedilenOlay,
} from '@market/shared';
import type { FastifyInstance } from 'fastify';
import { olayiIsle } from '../olay-isleyici.js';
import { mevcutVersiyon } from '../vt/baglanti.js';
import { cihazKorumasi } from './koruma.js';
import { sonrakiSeri } from './kimlik.js';

/** Pull edilebilen tabloların sütun listeleri — `SELECT *` yerine açık liste. */
const PULL_TABLOLARI: Record<PullVarligi, { tablo: string; sutunlar: string }> = {
  urunler: {
    tablo: 'urunler',
    sutunlar: `id, ad, kategori_id, marka, birim_tipi, alis_fiyati, satis_fiyati, kdv_orani, kritik_stok,
               ideal_stok, raf_konumu, aktif_mi, varsayilan_tedarikci_id, skt_takibi, notlar,
               created_at, updated_at, cihaz_id`,
  },
  barkodlar: {
    tablo: 'barkodlar',
    sutunlar: 'id, urun_id, barkod, ambalaj_aciklamasi, aktif_mi, created_at, updated_at, cihaz_id',
  },
  kategoriler: { tablo: 'kategoriler', sutunlar: 'id, ad, ust_kategori_id, sira, aktif_mi, created_at, updated_at, cihaz_id' },
  kampanyalar: {
    tablo: 'kampanyalar',
    sutunlar:
      'id, ad, tip, kapsam, hedef_id, deger, esik_miktar, baslangic, bitis, oncelik, aktif_mi, created_at, updated_at, cihaz_id',
  },
  kullanicilar: {
    tablo: 'kullanicilar',
    sutunlar:
      'id, ad, kullanici_adi, pin_hash, sifre_hash, rol, ek_yetkiler, kaldirilan_yetkiler, aktif_mi, created_at, updated_at, cihaz_id',
  },
  cariler: {
    tablo: 'cariler',
    sutunlar: `id, tip, ad_unvan, telefon, eposta, adres, vergi_dairesi, vergi_no, kredi_limiti, vade_gun,
               notlar, aktif_mi, anonimlestirildi_mi, iletisim_rizasi, iletisim_rizasi_zamani,
               created_at, updated_at, cihaz_id`,
  },
  ayarlar: { tablo: 'ayarlar', sutunlar: 'id, anahtar, deger, aciklama, created_at, updated_at, cihaz_id' },
  iade_talimatlari: {
    tablo: 'iade_talimatlari',
    sutunlar: 'id, satis_id, kalemler, iade_yontemi, neden, hedef_cihaz_id, kullanici_id, created_at, updated_at, cihaz_id',
  },
  stok_duzeltmeleri: {
    tablo: 'stok_duzeltmeleri',
    sutunlar: 'id, urun_id, tip, fark, hedef_miktar, neden, hedef_cihaz_id, kullanici_id, created_at, updated_at, cihaz_id',
  },
  cari_talimatlari: {
    tablo: 'cari_talimatlari',
    sutunlar: `id, cari_id, tip, tutar, hedef_hareket_id, neden, hedef_cihaz_id, kullanici_id,
               created_at, updated_at, cihaz_id, para_yolu`,
  },
  alis_talimatlari: {
    tablo: 'alis_talimatlari',
    sutunlar: 'id, tip, fatura_id, veri, hedef_cihaz_id, kullanici_id, created_at, updated_at, cihaz_id',
  },
};

export async function senkronRotalari(uygulama: FastifyInstance): Promise<void> {
  // ----------------------------------------------------------------- PUSH
  uygulama.post(UCLAR.senkronPush, { preHandler: cihazKorumasi }, async (istek) => {
    const govde = zPushIstegi.parse(istek.body);
    const cihaz = istek.cihaz;
    if (!cihaz) throw new UygulamaHatasi(HATA_KODU.CIHAZ_YETKISIZ);

    // Şema uyumsuzluğunda senkron güvenli biçimde REDDEDİLİR (§8.6/§22.4):
    // yanlış yorumlanmış veriyi yazmaktansa durmak yeğdir.
    if (govde.sema_surumu > SEMA_SURUMU) {
      throw new UygulamaHatasi(HATA_KODU.SEMA_UYUMSUZ, 'Kasa sürümü sunucudan yeni. Lütfen sunucuyu güncelleyin.', {
        detay: { kasa_sema: govde.sema_surumu, sunucu_sema: SEMA_SURUMU },
      });
    }

    const zaman = simdi();
    const kabulEdilen: string[] = [];
    const yinelenen: string[] = [];
    const reddedilen: ReddedilenOlay[] = [];

    // Tüm parti tek transaction'da işlenir (§6.5 toplu yazma). Bir olayın iş
    // kuralı hatası partiyi düşürmez; yalnız o olay reddedilir.
    await uygulama.vt.islem(async (islem) => {
      const baglam = { isletmeId: cihaz.isletmeId, cihazId: cihaz.cihazId, zaman };
      for (const olay of govde.olaylar) {
        const sonuc = await olayiIsle(islem, baglam, olay);
        if (sonuc.durum === 'kabul') kabulEdilen.push(olay.uuid);
        else if (sonuc.durum === 'yinelenen') yinelenen.push(olay.uuid);
        else {
          reddedilen.push({
            uuid: olay.uuid,
            kod: sonuc.kod ?? 'ISLEME_HATASI',
            mesaj: sonuc.mesaj ?? 'Olay işlenemedi.',
            kalici: sonuc.kalici ?? true,
          });
        }
      }
      await islem.calistir('UPDATE cihazlar SET son_push = ?, sema_surumu = ?, updated_at = ? WHERE id = ?', [
        zaman,
        govde.sema_surumu,
        zaman,
        cihaz.id,
      ]);
    });

    if (reddedilen.length > 0) {
      istek.log.warn({ cihaz: cihaz.cihazId, reddedilen: reddedilen.length, ornek: reddedilen[0] }, 'Push kısmen reddedildi');
    }
    istek.log.info(
      { cihaz: cihaz.cihazId, kabul: kabulEdilen.length, yinelenen: yinelenen.length, red: reddedilen.length },
      'Push işlendi',
    );

    return {
      kabul_edilen: kabulEdilen,
      yinelenen,
      reddedilen,
      sunucu_versiyonu: await mevcutVersiyon(uygulama.vt, cihaz.isletmeId),
      sunucu_zamani: zaman,
    };
  });

  // ----------------------------------------------------------------- PULL
  uygulama.get(UCLAR.senkronPull, { preHandler: cihazKorumasi }, async (istek) => {
    const sorgu = zPullIstegi.parse(istek.query);
    const cihaz = istek.cihaz;
    if (!cihaz) throw new UygulamaHatasi(HATA_KODU.CIHAZ_YETKISIZ);

    const zaman = simdi();
    const kayitlar: PullKaydi[] = [];
    const cihazSatiri = await uygulama.vt.tek<{ seri: string | null }>(
      'SELECT seri FROM cihazlar WHERE isletme_id = ? AND cihaz_id = ?',
      [cihaz.isletmeId, cihaz.cihazId],
    );

    // Delta çekme (§6.5 kural 2): tüm tablo değil, yalnız `versiyon > since`.
    for (const varlik of PULL_VARLIKLARI) {
      if (kayitlar.length >= sorgu.limit) break;
      const tanim = PULL_TABLOLARI[varlik];
      if (!tanim.tablo) continue;

      const kalan = sorgu.limit - kayitlar.length;
      const satirlar = await uygulama.vt.tumu<Record<string, unknown>>(
        `SELECT ${tanim.sutunlar}, versiyon, silindi_mi FROM ${tanim.tablo}
         WHERE isletme_id = ? AND versiyon > ?
         ORDER BY versiyon LIMIT ?`,
        [cihaz.isletmeId, sorgu.since, kalan],
      );

      for (const satir of satirlar) {
        const { versiyon, silindi_mi, ...veri } = satir;
        kayitlar.push({
          varlik,
          versiyon: Number(versiyon),
          silindi_mi: Number(silindi_mi) === 1,
          veri: normalizeVeri(veri),
        });
      }
    }

    const sunucuVersiyonu = await mevcutVersiyon(uygulama.vt, cihaz.isletmeId);
    const enYuksek = kayitlar.reduce((m, k) => Math.max(m, k.versiyon), sorgu.since);
    // Limit dolduysa aynı `since`'ten devam edilecek daha veri olabilir.
    const hasMore = kayitlar.length >= sorgu.limit && enYuksek < sunucuVersiyonu;

    await uygulama.vt.calistir('UPDATE cihazlar SET son_pull = ?, updated_at = ? WHERE id = ?', [zaman, zaman, cihaz.id]);

    /*
     * Fiş serisi her pull'da taşınır (§10.2). Aktivasyon yanıtında da gelir,
     * ama aktivasyondan ÖNCE kurulmuş kasalar yeniden aktive olmadan onu
     * alamazdı; seri boş kalınca kasa eski (çakışabilen) türetmeye düşerdi.
     * Seri yoksa burada ATANIR: mevcut kurulumlar da kendiliğinden düzelir.
     */
    let seri = cihazSatiri?.seri ? String(cihazSatiri.seri) : '';
    if (!seri) {
      seri = await sonrakiSeri(uygulama, cihaz.isletmeId);
      await uygulama.vt.calistir('UPDATE cihazlar SET seri = ? WHERE isletme_id = ? AND cihaz_id = ?', [
        seri,
        cihaz.isletmeId,
        cihaz.cihazId,
      ]);
    }

    return { kayitlar, sunucu_versiyonu: sunucuVersiyonu, has_more: hasMore, seri, sunucu_zamani: zaman };
  });

  // --------------------------------------------------------------- DURUM
  uygulama.get(UCLAR.senkronDurum, { preHandler: cihazKorumasi }, async (istek) => {
    const cihaz = istek.cihaz;
    if (!cihaz) throw new UygulamaHatasi(HATA_KODU.CIHAZ_YETKISIZ);

    const kayit = await uygulama.vt.tek<{ son_push: string | null; son_pull: string | null }>(
      'SELECT son_push, son_pull FROM cihazlar WHERE id = ?',
      [cihaz.id],
    );

    // Mutabakat için kayıt sayıları (§18.4). Yerel tablo adlarıyla eşleşir.
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
    const sayimlar: Record<string, number> = {};
    for (const tablo of tablolar) {
      const satir = await uygulama.vt.tek<{ adet: number }>(`SELECT COUNT(*) AS adet FROM ${tablo} WHERE isletme_id = ?`, [
        cihaz.isletmeId,
      ]);
      sayimlar[tablo] = Number(satir?.adet ?? 0);
    }

    return {
      cihaz_id: cihaz.cihazId,
      son_push: kayit?.son_push ?? null,
      son_pull: kayit?.son_pull ?? null,
      sunucu_versiyonu: await mevcutVersiyon(uygulama.vt, cihaz.isletmeId),
      sema_surumu: SEMA_SURUMU,
      protokol_surumu: SENKRON_PROTOKOL_SURUMU,
      sayimlar,
      sunucu_zamani: simdi(),
    };
  });

  // ----------------------------------------------------------- ÇAKIŞMALAR
  uygulama.get(UCLAR.senkronCakismalar, { preHandler: cihazKorumasi }, async (istek) => {
    const cihaz = istek.cihaz;
    if (!cihaz) throw hatalar.kimlik();
    const kayitlar = await uygulama.vt.tumu(
      `SELECT id, entity, entity_id, kaynak_a, kaynak_b, cozum, cozum_zamani, detay
       FROM sync_cakismalar WHERE isletme_id = ? ORDER BY cozum_zamani DESC LIMIT 100`,
      [cihaz.isletmeId],
    );
    return { data: kayitlar };
  });
}

/** SQLite'tan gelen 0/1 değerlerini boolean'a çevirir (istemci beklentisi). */
function normalizeVeri(veri: Record<string, unknown>): Record<string, unknown> {
  const boolAlanlar = ['aktif_mi', 'skt_takibi', 'anonimlestirildi_mi', 'iletisim_rizasi'];
  const sonuc: Record<string, unknown> = {};
  for (const [anahtar, deger] of Object.entries(veri)) {
    if (boolAlanlar.includes(anahtar)) sonuc[anahtar] = Number(deger) === 1;
    else if (anahtar === 'ek_yetkiler' || anahtar === 'kaldirilan_yetkiler') {
      try {
        sonuc[anahtar] = JSON.parse(String(deger ?? '[]'));
      } catch {
        sonuc[anahtar] = [];
      }
    } else sonuc[anahtar] = deger;
  }
  return sonuc;
}
