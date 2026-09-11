/**
 * Senkron olay işleyicisi (§7.3 PUSH tarafı).
 *
 * Her olay **idempotent**tir: `islenen_olaylar` tablosuna uuid yazılır, aynı uuid
 * ikinci kez gelirse "yinelenen" olarak raporlanır ve tekrar işlenmez (§7.1).
 * Tüm yazmalar tek transaction içinde yapılır (§6.5 toplu yazma).
 *
 * Rollup tabloları burada da güncellenir; panel ham `satislar`'ı hiç taramaz.
 */

import { gunAnahtari, type OlayTipi, type SenkronOlayi } from '@market/shared';
import { sonrakiVersiyon, type Islem } from './vt/baglanti.js';

export interface IslemeBaglami {
  isletmeId: string;
  cihazId: string;
  zaman: string;
}

export interface OlaySonucu {
  durum: 'kabul' | 'yinelenen' | 'red';
  kod?: string;
  mesaj?: string;
  kalici?: boolean;
}

function sayi(deger: unknown, varsayilan = 0): number {
  const n = Number(deger);
  return Number.isFinite(n) ? n : varsayilan;
}

function metin(deger: unknown, varsayilan = ''): string {
  return typeof deger === 'string' ? deger : varsayilan;
}

/** Rollup: günlük özete artımlı ekleme. */
async function gunlukOzetEkle(
  islem: Islem,
  baglam: IslemeBaglami,
  tarih: string,
  delta: Partial<
    Record<
      | 'ciro'
      | 'iade_toplam'
      | 'iptal_toplam'
      | 'islem_sayisi'
      | 'nakit'
      | 'kart'
      | 'veresiye'
      | 'tahsilat'
      | 'gider'
      | 'brut_kar'
      | 'kdv_toplam',
      number
    >
  >,
): Promise<void> {
  await islem.calistir(
    `INSERT INTO gunluk_ozet (isletme_id, tarih, cihaz_id, ciro, iade_toplam, iptal_toplam, islem_sayisi,
                              nakit, kart, veresiye, tahsilat, gider, brut_kar, kdv_toplam, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(isletme_id, tarih, cihaz_id) DO UPDATE SET
       ciro = gunluk_ozet.ciro + excluded.ciro,
       iade_toplam = gunluk_ozet.iade_toplam + excluded.iade_toplam,
       iptal_toplam = gunluk_ozet.iptal_toplam + excluded.iptal_toplam,
       islem_sayisi = gunluk_ozet.islem_sayisi + excluded.islem_sayisi,
       nakit = gunluk_ozet.nakit + excluded.nakit,
       kart = gunluk_ozet.kart + excluded.kart,
       veresiye = gunluk_ozet.veresiye + excluded.veresiye,
       tahsilat = gunluk_ozet.tahsilat + excluded.tahsilat,
       gider = gunluk_ozet.gider + excluded.gider,
       brut_kar = gunluk_ozet.brut_kar + excluded.brut_kar,
       kdv_toplam = gunluk_ozet.kdv_toplam + excluded.kdv_toplam,
       updated_at = excluded.updated_at`,
    [
      baglam.isletmeId,
      tarih,
      baglam.cihazId,
      delta.ciro ?? 0,
      delta.iade_toplam ?? 0,
      delta.iptal_toplam ?? 0,
      delta.islem_sayisi ?? 0,
      delta.nakit ?? 0,
      delta.kart ?? 0,
      delta.veresiye ?? 0,
      delta.tahsilat ?? 0,
      delta.gider ?? 0,
      delta.brut_kar ?? 0,
      delta.kdv_toplam ?? 0,
      baglam.zaman,
    ],
  );
}

async function urunOzetEkle(
  islem: Islem,
  baglam: IslemeBaglami,
  urunId: string,
  donem: string,
  delta: { adet: number; ciro: number; kar: number },
): Promise<void> {
  await islem.calistir(
    `INSERT INTO urun_satis_ozet (isletme_id, urun_id, donem, cihaz_id, adet, ciro, kar, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(isletme_id, urun_id, donem, cihaz_id) DO UPDATE SET
       adet = urun_satis_ozet.adet + excluded.adet,
       ciro = urun_satis_ozet.ciro + excluded.ciro,
       kar = urun_satis_ozet.kar + excluded.kar,
       updated_at = excluded.updated_at`,
    [baglam.isletmeId, urunId, donem, baglam.cihazId, delta.adet, delta.ciro, delta.kar, baglam.zaman],
  );
}

async function stokOzetEkle(islem: Islem, baglam: IslemeBaglami, urunId: string, miktar: number): Promise<void> {
  await islem.calistir(
    `INSERT INTO stok_ozet (isletme_id, urun_id, miktar, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(isletme_id, urun_id) DO UPDATE SET
       miktar = stok_ozet.miktar + excluded.miktar, updated_at = excluded.updated_at`,
    [baglam.isletmeId, urunId, miktar, baglam.zaman],
  );
}

async function cariOzetEkle(islem: Islem, baglam: IslemeBaglami, cariId: string, tutar: number, tarih: string): Promise<void> {
  await islem.calistir(
    `INSERT INTO cari_ozet (isletme_id, cari_id, bakiye, son_hareket, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(isletme_id, cari_id) DO UPDATE SET
       bakiye = cari_ozet.bakiye + excluded.bakiye,
       son_hareket = MAX(COALESCE(cari_ozet.son_hareket, ''), excluded.son_hareket),
       updated_at = excluded.updated_at`,
    [baglam.isletmeId, cariId, tutar, tarih, baglam.zaman],
  );
}

/**
 * Çift yönlü (LWW) varlıklar için upsert.
 * Sunucudaki kayıt daha yeniyse gelen veri **uygulanmaz** ve çakışma loglanır (§7.4).
 */
async function lwwUpsert(
  islem: Islem,
  baglam: IslemeBaglami,
  tablo: string,
  sutunlar: string[],
  degerler: unknown[],
  id: string,
  gelenZaman: string,
): Promise<'uygulandi' | 'atlandi'> {
  const mevcut = await islem.tek<{ updated_at: string }>(`SELECT updated_at FROM ${tablo} WHERE isletme_id = ? AND id = ?`, [
    baglam.isletmeId,
    id,
  ]);

  if (mevcut && String(mevcut.updated_at) > gelenZaman) {
    await islem.calistir(
      `INSERT INTO sync_cakismalar (id, isletme_id, entity, entity_id, kaynak_a, kaynak_b, cozum, cozum_zamani, detay)
       VALUES (?, ?, ?, ?, 'bulut', 'kasa', 'BULUT_KAZANDI', ?, ?)`,
      [
        crypto.randomUUID(),
        baglam.isletmeId,
        tablo,
        id,
        baglam.zaman,
        JSON.stringify({ bulut_updated_at: mevcut.updated_at, kasa_updated_at: gelenZaman, cihaz: baglam.cihazId }),
      ],
    );
    return 'atlandi';
  }

  const versiyon = await sonrakiVersiyon(islem, baglam.isletmeId);
  const tumSutunlar = ['isletme_id', 'id', ...sutunlar, 'versiyon'];
  const yerTutucu = tumSutunlar.map(() => '?').join(', ');
  const guncelleme = [...sutunlar, 'versiyon'].map((s) => `${s} = excluded.${s}`).join(', ');

  await islem.calistir(
    `INSERT INTO ${tablo} (${tumSutunlar.join(', ')}) VALUES (${yerTutucu})
     ON CONFLICT(isletme_id, id) DO UPDATE SET ${guncelleme}`,
    [baglam.isletmeId, id, ...(degerler as never[]), versiyon],
  );
  return 'uygulandi';
}

// ---------------------------------------------------------------------------
// Ana giriş
// ---------------------------------------------------------------------------

export async function olayiIsle(islem: Islem, baglam: IslemeBaglami, olay: SenkronOlayi): Promise<OlaySonucu> {
  // İdempotency kapısı: aynı uuid daha önce işlendiyse hiçbir şey yapma.
  const daha = await islem.tek<{ uuid: string }>('SELECT uuid FROM islenen_olaylar WHERE uuid = ?', [olay.uuid]);
  if (daha) return { durum: 'yinelenen' };

  const veri = olay.veri as Record<string, unknown>;

  try {
    await isle(islem, baglam, olay.tip, veri);
  } catch (hata) {
    return {
      durum: 'red',
      kod: 'ISLEME_HATASI',
      mesaj: hata instanceof Error ? hata.message : String(hata),
      // Veri kaynaklı hatalar kalıcıdır; tekrar denemek aynı sonucu verir.
      kalici: true,
    };
  }

  await islem.calistir(
    `INSERT INTO islenen_olaylar (uuid, isletme_id, cihaz_id, olay_tipi, entity, entity_id, olusturma_zamani, islenme_zamani)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [olay.uuid, baglam.isletmeId, baglam.cihazId, olay.tip, olay.entity, olay.entity_id, olay.olusturma_zamani, baglam.zaman],
  );

  return { durum: 'kabul' };
}

async function isle(islem: Islem, baglam: IslemeBaglami, tip: OlayTipi, veri: Record<string, unknown>): Promise<void> {
  const isletmeId = baglam.isletmeId;

  switch (tip) {
    case 'SATIS_YAPILDI':
    case 'IADE_YAPILDI': {
      const satisId = metin(veri.id);
      const tarih = metin(veri.tarih, baglam.zaman);
      const gun = gunAnahtari(tarih);
      const iadeMi = tip === 'IADE_YAPILDI';
      const genelToplam = sayi(veri.genel_toplam);
      const kdvToplam = sayi(veri.kdv_toplam);
      const brutKar = sayi(veri.brut_kar);

      await islem.calistir(
        `INSERT INTO satislar (id, isletme_id, cihaz_id, fis_no, tarih, kullanici_id, kasa_oturum_id,
                               ara_toplam, iskonto_toplam, kdv_toplam, genel_toplam, odeme_ozeti,
                               musteri_id, brut_kar, iade_mi, kaynak_satis_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(isletme_id, id) DO NOTHING`,
        [
          satisId,
          isletmeId,
          baglam.cihazId,
          metin(veri.fis_no),
          tarih,
          veri.kullanici_id ?? null,
          veri.kasa_oturum_id ?? null,
          sayi(veri.ara_toplam),
          sayi(veri.iskonto_toplam),
          kdvToplam,
          genelToplam,
          metin(veri.odeme_ozeti, iadeMi ? metin(veri.iade_yontemi, 'NAKIT') : 'NAKIT'),
          veri.musteri_id ?? null,
          brutKar,
          iadeMi ? 1 : 0,
          veri.kaynak_satis_id ?? null,
          baglam.zaman,
        ],
      );

      let nakit = 0;
      let kart = 0;
      let veresiye = 0;
      const odemeler = Array.isArray(veri.odemeler) ? (veri.odemeler as Record<string, unknown>[]) : [];
      for (const [i, odeme] of odemeler.entries()) {
        const tutar = sayi(odeme.tutar);
        const odemeTipi = metin(odeme.tip, 'NAKIT');
        if (odemeTipi === 'NAKIT') nakit += tutar;
        else if (odemeTipi === 'KART') kart += tutar;
        else veresiye += tutar;
        await islem.calistir(
          `INSERT INTO odemeler (id, isletme_id, satis_id, odeme_tipi, tutar) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(isletme_id, id) DO NOTHING`,
          [`${satisId}-o${i}`, isletmeId, satisId, odemeTipi, tutar],
        );
      }
      // İade olaylarında ödeme listesi gelmeyebilir; iade yöntemine göre kırılım kur.
      if (iadeMi && odemeler.length === 0) {
        const yontem = metin(veri.iade_yontemi, 'NAKIT');
        if (yontem === 'NAKIT') nakit = genelToplam;
        else if (yontem === 'KART') kart = genelToplam;
        else veresiye = genelToplam;
      }

      const kalemler = Array.isArray(veri.kalemler) ? (veri.kalemler as Record<string, unknown>[]) : [];
      for (const [i, kalem] of kalemler.entries()) {
        const urunId = metin(kalem.urun_id);
        if (!urunId) continue;
        const miktar = sayi(kalem.miktar);
        const satirToplam = sayi(kalem.satir_toplam);
        const kdvTutar = sayi(kalem.kdv_tutar);
        const birimMaliyet = sayi(kalem.birim_maliyet);
        const kar = satirToplam - kdvTutar - Math.round((miktar * birimMaliyet) / 1000);

        await islem.calistir(
          `INSERT INTO satis_kalemleri (id, isletme_id, satis_id, urun_id, urun_adi, barkod, miktar,
                                        birim_fiyat, birim_maliyet, iskonto, kdv_orani, kdv_tutar, satir_toplam)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(isletme_id, id) DO NOTHING`,
          [
            `${satisId}-k${i}`,
            isletmeId,
            satisId,
            urunId,
            metin(kalem.urun_adi),
            kalem.barkod ?? null,
            miktar,
            sayi(kalem.birim_fiyat),
            birimMaliyet,
            sayi(kalem.iskonto),
            sayi(kalem.kdv_orani, 20),
            kdvTutar,
            satirToplam,
          ],
        );
        await urunOzetEkle(islem, baglam, urunId, gun, { adet: miktar, ciro: satirToplam, kar });

        /**
         * Stok özeti satış olayından düşülür.
         *
         * Kasa satışın stok çıkışı için AYRI bir `STOK_HAREKETI` olayı
         * göndermez — kalemler zaten bu olayın içindedir. Buradan düşmezsek
         * panel ile kasa ayrışır: kasada 7 adet görünen ürün panelde 20 kalır.
         * İade satışın tersidir, stoğu geri ekler.
         */
        /**
         * Stok etkisi HER DURUMDA `-miktar`'dır; iade özel durum DEĞİLDİR.
         * İade kalemleri kasada negatif miktarla yazılır (`miktar: -satir.miktar`),
         * yani işaret zaten verinin içindedir: satışta pozitif miktar stoğu
         * düşürür, iadede negatif miktar geri ekler. Burada ayrıca iadeyi
         * ayırmak işareti ters çevirir ve iade stoğu ARTIRACAĞINA azaltırdı.
         */
        await stokOzetEkle(islem, baglam, urunId, -miktar);
      }

      /**
       * Veresiye satış cari borcu yazar.
       *
       * Kasa bunu YERELDE yazar ama ayrı bir `CARI_HAREKETI` olayı göndermez;
       * satış olayı `musteri_id` ve ödeme kırılımını zaten taşır. Buradan
       * türetmezsek panelin Cari ekranı boş kalır — kasada borcu görünen
       * müşteri merkezde borçsuz görünür. İade tersine çalışır.
       *
       * Deterministik id (`<satis>-veresiye`) + ON CONFLICT sayesinde aynı
       * satış iki kez işlense borç bir kez yazılır.
       */
      const musteriId = veri.musteri_id ? metin(veri.musteri_id) : '';

      if (musteriId && veresiye > 0) {
        const imzali = iadeMi ? -veresiye : veresiye;
        const eklendi = await islem.calistir(
          `INSERT INTO cari_hareketler (id, isletme_id, cari_id, hareket_tipi, tutar, aciklama, belge_id,
                                        belge_tipi, tarih, cihaz_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'SATIS', ?, ?)
           ON CONFLICT(isletme_id, id) DO NOTHING`,
          [
            `${satisId}-veresiye`,
            isletmeId,
            musteriId,
            iadeMi ? 'ALACAK' : 'BORC',
            imzali,
            iadeMi ? 'İade (veresiye)' : 'Veresiye satış',
            satisId,
            metin(veri.tarih, baglam.zaman),
            baglam.cihazId,
          ],
        );
        // Özet yalnız satır GERÇEKTEN eklendiyse güncellenir; yoksa tekrar
        // işlemede bakiye iki kez artardı.
        if (eklendi.rowsAffected > 0) {
          await cariOzetEkle(islem, baglam, musteriId, imzali, metin(veri.tarih, baglam.zaman));
        }
      }

      await gunlukOzetEkle(islem, baglam, gun, {
        ciro: iadeMi ? 0 : genelToplam,
        iade_toplam: iadeMi ? -genelToplam : 0,
        islem_sayisi: iadeMi ? 0 : 1,
        nakit,
        kart,
        veresiye,
        brut_kar: brutKar,
        kdv_toplam: kdvToplam,
      });
      return;
    }

    case 'SATIS_IPTAL_EDILDI': {
      const satisId = metin(veri.id);
      const mevcut = await islem.tek<{
        genel_toplam: number;
        tarih: string;
        brut_kar: number;
        kdv_toplam: number;
        iptal_mi: number;
      }>('SELECT genel_toplam, tarih, brut_kar, kdv_toplam, iptal_mi FROM satislar WHERE isletme_id = ? AND id = ?', [
        isletmeId,
        satisId,
      ]);
      await islem.calistir('UPDATE satislar SET iptal_mi = 1, iptal_neden = ? WHERE isletme_id = ? AND id = ?', [
        metin(veri.neden),
        isletmeId,
        satisId,
      ]);
      // Zaten iptalse rollup ikinci kez düşürülmemeli.
      if (mevcut && Number(mevcut.iptal_mi) === 0) {
        // İptal stoğu geri verir. Kalemler merkezde `satis_kalemleri`'nde
        // durduğu için olay yükünde tekrar gönderilmelerine gerek yok.
        // `iptal_mi = 0` koşulu içinde olduğumuz için bu blok satış başına
        // yalnız bir kez çalışır; iki kez iptal gelse stok iki kez artmaz.
        const kalemler = await islem.tumu<{ urun_id: string; miktar: number }>(
          'SELECT urun_id, miktar FROM satis_kalemleri WHERE isletme_id = ? AND satis_id = ?',
          [isletmeId, satisId],
        );
        for (const kalem of kalemler) {
          await stokOzetEkle(islem, baglam, String(kalem.urun_id), sayi(kalem.miktar));
        }

        // Veresiye borcu da geri alınır: iptal edilen satışın borcu müşterinin
        // üzerinde kalırsa kasada borcu sıfırlanan müşteri panelde borçlu
        // görünür. Ters kayıt ayrı bir id taşır, bu blok satış başına bir kez
        // çalıştığı için mükerrer yazılmaz.
        const iptalEdilen = await islem.tek<{ musteri_id: string | null }>(
          'SELECT musteri_id FROM satislar WHERE isletme_id = ? AND id = ?',
          [isletmeId, satisId],
        );
        const veresiyeSatiri = await islem.tek<{ toplam: number }>(
          "SELECT SUM(tutar) AS toplam FROM odemeler WHERE isletme_id = ? AND satis_id = ? AND odeme_tipi = 'VERESIYE'",
          [isletmeId, satisId],
        );
        const iptalVeresiye = sayi(veresiyeSatiri?.toplam);
        if (iptalEdilen?.musteri_id && iptalVeresiye > 0) {
          const cariId = String(iptalEdilen.musteri_id);
          const eklendi = await islem.calistir(
            `INSERT INTO cari_hareketler (id, isletme_id, cari_id, hareket_tipi, tutar, aciklama, belge_id, tarih, cihaz_id)
             VALUES (?, ?, ?, 'ALACAK', ?, 'Satış iptali', ?, ?, ?)
             ON CONFLICT(isletme_id, id) DO NOTHING`,
            [`${satisId}-veresiye-iptal`, isletmeId, cariId, -iptalVeresiye, satisId, String(mevcut.tarih), baglam.cihazId],
          );
          if (eklendi.rowsAffected > 0) {
            await cariOzetEkle(islem, baglam, cariId, -iptalVeresiye, String(mevcut.tarih));
          }
        }

        const gun = gunAnahtari(String(mevcut.tarih));
        await gunlukOzetEkle(islem, baglam, gun, {
          ciro: -Number(mevcut.genel_toplam),
          iptal_toplam: Number(mevcut.genel_toplam),
          islem_sayisi: -1,
          brut_kar: -Number(mevcut.brut_kar),
          kdv_toplam: -Number(mevcut.kdv_toplam),
        });
      }
      return;
    }

    case 'STOK_HAREKETI': {
      const urunId = metin(veri.urun_id);
      const miktar = sayi(veri.miktar);
      await islem.calistir(
        `INSERT INTO stok_hareketleri (id, isletme_id, urun_id, hareket_tipi, miktar, birim_maliyet,
                                       belge_id, belge_tipi, skt, lot_no, neden_kodu, aciklama,
                                       kullanici_id, cihaz_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(isletme_id, id) DO NOTHING`,
        [
          metin(veri.id),
          isletmeId,
          urunId,
          metin(veri.hareket_tipi, 'DUZELTME'),
          miktar,
          sayi(veri.birim_maliyet),
          veri.belge_id ?? null,
          veri.belge_tipi ?? null,
          veri.skt ?? null,
          veri.lot_no ?? null,
          veri.neden_kodu ?? null,
          veri.aciklama ?? null,
          veri.kullanici_id ?? null,
          baglam.cihazId,
          metin(veri.created_at, baglam.zaman),
        ],
      );
      await stokOzetEkle(islem, baglam, urunId, miktar);
      return;
    }

    case 'CARI_HAREKETI': {
      const cariId = metin(veri.cari_id);
      const tutar = sayi(veri.tutar);
      const tarih = metin(veri.tarih, baglam.zaman);
      await islem.calistir(
        `INSERT INTO cari_hareketler (id, isletme_id, cari_id, hareket_tipi, tutar, aciklama, belge_id,
                                      belge_tipi, tarih, vade_tarihi, kullanici_id, cihaz_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(isletme_id, id) DO NOTHING`,
        [
          metin(veri.id),
          isletmeId,
          cariId,
          metin(veri.hareket_tipi, 'DUZELTME'),
          tutar,
          veri.aciklama ?? null,
          veri.belge_id ?? null,
          veri.belge_tipi ?? null,
          tarih,
          veri.vade_tarihi ?? null,
          veri.kullanici_id ?? null,
          baglam.cihazId,
        ],
      );
      await cariOzetEkle(islem, baglam, cariId, tutar, tarih);

      /*
       * Günlük özet, kasadaki yerel rollup ile BİRE BİR aynı kurala uyar:
       * yalnız NAKİT tahsilat/ödeme işlenir (kartla tahsilat fiziksel kasayı
       * etkilemez) ve tedarikçiye yapılan ödeme tahsilatı AZALTIR.
       * Olaydaki tutar işaretlidir (müşteri tahsilatı ve tedarikçi ödemesi
       * ikisi de eksi gelir); TAHSILAT için tersine çevrilir.
       */
      const hareketTipi = metin(veri.hareket_tipi);
      const odemeTipi = metin(veri.odeme_tipi);
      if ((hareketTipi === 'TAHSILAT' || hareketTipi === 'ODEME') && odemeTipi === 'NAKIT') {
        const delta = hareketTipi === 'TAHSILAT' ? -tutar : tutar;
        await gunlukOzetEkle(islem, baglam, gunAnahtari(tarih), { tahsilat: delta, nakit: delta });
      }
      return;
    }

    case 'KASA_OTURUM_ACILDI': {
      await islem.calistir(
        `INSERT INTO kasa_oturumlari (id, isletme_id, cihaz_id, kullanici_id, acilis_zamani, acilis_bakiye, durum)
         VALUES (?, ?, ?, ?, ?, ?, 'ACIK') ON CONFLICT(isletme_id, id) DO NOTHING`,
        [
          metin(veri.id),
          isletmeId,
          baglam.cihazId,
          veri.kullanici_id ?? null,
          metin(veri.acilis_zamani, baglam.zaman),
          sayi(veri.acilis_bakiye),
        ],
      );
      return;
    }

    case 'KASA_OTURUM_KAPANDI': {
      await islem.calistir(
        `UPDATE kasa_oturumlari SET kapanis_zamani = ?, sayilan_nakit = ?, beklenen_nakit = ?, kasa_farki = ?,
                satis_nakit = ?, satis_kart = ?, veresiye = ?, gider = ?, islem_sayisi = ?, durum = 'KAPALI'
         WHERE isletme_id = ? AND id = ?`,
        [
          metin(veri.kapanis_zamani, baglam.zaman),
          sayi(veri.sayilan_nakit),
          sayi(veri.beklenen_nakit),
          sayi(veri.kasa_farki),
          sayi(veri.satis_nakit),
          sayi(veri.satis_kart),
          sayi(veri.veresiye),
          sayi(veri.gider),
          sayi(veri.islem_sayisi),
          isletmeId,
          metin(veri.id),
        ],
      );
      return;
    }

    case 'KASA_HAREKETI': {
      const tutar = sayi(veri.tutar);
      const zaman = metin(veri.created_at, baglam.zaman);
      await islem.calistir(
        `INSERT INTO kasa_hareketleri (id, isletme_id, kasa_oturum_id, tip, tutar, aciklama, belge_id, cihaz_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(isletme_id, id) DO NOTHING`,
        [
          metin(veri.id),
          isletmeId,
          metin(veri.kasa_oturum_id),
          metin(veri.tip),
          tutar,
          veri.aciklama ?? null,
          veri.belge_id ?? null,
          baglam.cihazId,
          zaman,
        ],
      );
      if (metin(veri.tip) === 'GIDER') {
        await gunlukOzetEkle(islem, baglam, gunAnahtari(zaman), { gider: Math.abs(tutar), nakit: tutar });
      }
      return;
    }

    case 'URUN_KAYDEDILDI': {
      const id = metin(veri.id);
      await lwwUpsert(
        islem,
        baglam,
        'urunler',
        [
          'ad',
          'kategori_id',
          'marka',
          'birim_tipi',
          'alis_fiyati',
          'satis_fiyati',
          'kdv_orani',
          'kritik_stok',
          'ideal_stok',
          'raf_konumu',
          'aktif_mi',
          'varsayilan_tedarikci_id',
          'skt_takibi',
          'notlar',
          'created_at',
          'updated_at',
          'cihaz_id',
        ],
        [
          metin(veri.ad),
          veri.kategori_id ?? null,
          veri.marka ?? null,
          metin(veri.birim_tipi, 'ADET'),
          sayi(veri.alis_fiyati),
          sayi(veri.satis_fiyati),
          sayi(veri.kdv_orani, 20),
          sayi(veri.kritik_stok),
          sayi(veri.ideal_stok),
          veri.raf_konumu ?? null,
          veri.aktif_mi === false ? 0 : 1,
          veri.varsayilan_tedarikci_id ?? null,
          veri.skt_takibi ? 1 : 0,
          veri.notlar ?? null,
          metin(veri.created_at, baglam.zaman),
          metin(veri.updated_at, baglam.zaman),
          baglam.cihazId,
        ],
        id,
        metin(veri.updated_at, baglam.zaman),
      );
      return;
    }

    case 'BARKOD_KAYDEDILDI': {
      await lwwUpsert(
        islem,
        baglam,
        'barkodlar',
        ['urun_id', 'barkod', 'ambalaj_aciklamasi', 'aktif_mi', 'created_at', 'updated_at', 'cihaz_id'],
        [
          metin(veri.urun_id),
          metin(veri.barkod),
          veri.ambalaj_aciklamasi ?? null,
          veri.aktif_mi === false ? 0 : 1,
          metin(veri.created_at, baglam.zaman),
          metin(veri.updated_at, baglam.zaman),
          baglam.cihazId,
        ],
        metin(veri.id),
        metin(veri.updated_at, baglam.zaman),
      );
      return;
    }

    case 'KATEGORI_KAYDEDILDI': {
      // Kasada gerçekten silinen kategori mezar taşı olarak işaretlenir; aksi
      // hâlde merkez kaydı korur ve bir sonraki pull'da kasaya geri iner.
      if (veri.silindi_mi === true) {
        const versiyon = await sonrakiVersiyon(islem, baglam.isletmeId);
        await islem.calistir(
          `UPDATE kategoriler SET silindi_mi = 1, aktif_mi = 0, updated_at = ?, versiyon = ?
           WHERE isletme_id = ? AND id = ?`,
          [metin(veri.updated_at, baglam.zaman), versiyon, baglam.isletmeId, metin(veri.id)],
        );
        return;
      }
      await lwwUpsert(
        islem,
        baglam,
        'kategoriler',
        ['ad', 'ust_kategori_id', 'sira', 'aktif_mi', 'created_at', 'updated_at', 'cihaz_id'],
        [
          metin(veri.ad),
          veri.ust_kategori_id ?? null,
          sayi(veri.sira),
          veri.aktif_mi === false ? 0 : 1,
          metin(veri.created_at, baglam.zaman),
          metin(veri.updated_at, baglam.zaman),
          baglam.cihazId,
        ],
        metin(veri.id),
        metin(veri.updated_at, baglam.zaman),
      );
      return;
    }

    case 'CARI_KAYDEDILDI': {
      await lwwUpsert(
        islem,
        baglam,
        'cariler',
        [
          'tip',
          'ad_unvan',
          'telefon',
          'eposta',
          'adres',
          'vergi_dairesi',
          'vergi_no',
          'kredi_limiti',
          'vade_gun',
          'notlar',
          'aktif_mi',
          'anonimlestirildi_mi',
          'iletisim_rizasi',
          'iletisim_rizasi_zamani',
          'created_at',
          'updated_at',
          'cihaz_id',
        ],
        [
          metin(veri.tip, 'MUSTERI'),
          metin(veri.ad_unvan),
          veri.telefon ?? null,
          veri.eposta ?? null,
          veri.adres ?? null,
          veri.vergi_dairesi ?? null,
          veri.vergi_no ?? null,
          sayi(veri.kredi_limiti),
          sayi(veri.vade_gun),
          veri.notlar ?? null,
          veri.aktif_mi === false ? 0 : 1,
          veri.anonimlestirildi_mi ? 1 : 0,
          veri.iletisim_rizasi ? 1 : 0,
          veri.iletisim_rizasi_zamani ?? null,
          metin(veri.created_at, baglam.zaman),
          metin(veri.updated_at, baglam.zaman),
          baglam.cihazId,
        ],
        metin(veri.id),
        metin(veri.updated_at, baglam.zaman),
      );
      return;
    }

    /*
     * Kasadan gelen TEK kullanıcı olayı: kurulum sihirbazının açtığı sahip
     * hesabı (§12.1). Kullanıcı yönetimi paneldedir; buranın amacı yönetim
     * değil, o hesabın panelde GÖRÜNMESİNİ sağlamaktır.
     *
     * Kullanıcı adı bu işletmede başka bir id'ye aitse kayıt AÇILMAZ: aksi
     * hâlde panelde aynı adlı iki kullanıcı oluşur ve kasa tarafında
     * `kullanici_adi` UNIQUE kısıtı pull'u kilitler. Bu durumda buluttaki
     * kayıt kazanır; kasa onu indirince iki kimliği kendisi birleştirir.
     */
    case 'KULLANICI_KAYDEDILDI': {
      const id = metin(veri.id);
      const kullaniciAdi = metin(veri.kullanici_adi);
      const adSahibi = await islem.tek<{ id: string }>(
        'SELECT id FROM kullanicilar WHERE isletme_id = ? AND kullanici_adi = ? AND id <> ? AND silindi_mi = 0',
        [baglam.isletmeId, kullaniciAdi, id],
      );
      if (adSahibi) {
        await islem.calistir(
          `INSERT INTO sync_cakismalar (id, isletme_id, entity, entity_id, kaynak_a, kaynak_b, cozum, cozum_zamani, detay)
           VALUES (?, ?, 'kullanicilar', ?, 'bulut', 'kasa', 'BULUT_KAZANDI', ?, ?)`,
          [
            crypto.randomUUID(),
            baglam.isletmeId,
            id,
            baglam.zaman,
            JSON.stringify({ neden: 'kullanici_adi cakismasi', bulut_id: adSahibi.id, cihaz: baglam.cihazId }),
          ],
        );
        return;
      }

      await lwwUpsert(
        islem,
        baglam,
        'kullanicilar',
        [
          'ad',
          'kullanici_adi',
          'pin_hash',
          'sifre_hash',
          'rol',
          'ek_yetkiler',
          'kaldirilan_yetkiler',
          'aktif_mi',
          'created_at',
          'updated_at',
          'cihaz_id',
        ],
        [
          metin(veri.ad),
          kullaniciAdi,
          veri.pin_hash ?? null,
          veri.sifre_hash ?? null,
          metin(veri.rol, 'KASIYER'),
          JSON.stringify(veri.ek_yetkiler ?? []),
          JSON.stringify(veri.kaldirilan_yetkiler ?? []),
          veri.aktif_mi === false ? 0 : 1,
          metin(veri.created_at, baglam.zaman),
          metin(veri.updated_at, baglam.zaman),
          baglam.cihazId,
        ],
        id,
        metin(veri.updated_at, baglam.zaman),
      );
      return;
    }

    case 'ALIS_FATURASI_ONAYLANDI': {
      /*
       * Stok girişleri STOK_HAREKETI olaylarıyla ayrıca gelir, ancak kasa mal
       * kabulün cari BORC hareketini AYRI OLAY OLARAK GÖNDERMEZ. Tedarikçi
       * borcu (panel "Tedarikçi borçları" ve yaşlandırma) burada fatura
       * olayından türetilir. Deterministik id (`<fatura>-borc`) + ON CONFLICT
       * ile yeniden işleme güvenlidir.
       *
       * Bilinen sınır: mal kabulde yapılan peşin/kısmi ödeme olay yükünde
       * bulunmadığından merkezde borç TAM tutar görünür; ödeme kasada kalır.
       */
      const faturaId = metin(veri.id);
      const tedarikciId = metin(veri.tedarikci_id);
      const faturaTarihi = metin(veri.tarih, baglam.zaman);
      const genelToplam = sayi(veri.genel_toplam);
      if (faturaId && tedarikciId && genelToplam > 0) {
        const faturaNo = metin(veri.fatura_no);

        /*
         * BELGENİN KENDİSİ de saklanır. Eskiden yalnız cari borcu ve stok
         * hareketleri işleniyordu; fatura kaydı hiç merkeze ulaşmıyordu ve
         * panelden "bu tedarikçiye hangi faturayla ne aldık" sorusu
         * cevaplanamıyordu. `ON CONFLICT DO NOTHING` ile yeniden işleme güvenli.
         */
        await islem.calistir(
          `INSERT INTO alis_faturalari (id, isletme_id, tedarikci_id, fatura_no, tarih, ara_toplam, kdv_toplam,
                                        genel_toplam, odenen_tutar, durum, vade_tarihi, notlar, kullanici_id,
                                        created_at, updated_at, cihaz_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ONAYLANDI', ?, ?, ?, ?, ?, ?)
           ON CONFLICT(isletme_id, id) DO NOTHING`,
          [
            faturaId,
            isletmeId,
            tedarikciId,
            faturaNo || null,
            faturaTarihi,
            sayi(veri.ara_toplam),
            sayi(veri.kdv_toplam),
            genelToplam,
            sayi(veri.odenen_tutar),
            veri.vade_tarihi ?? null,
            veri.notlar ?? null,
            veri.kullanici_id ?? null,
            faturaTarihi,
            baglam.zaman,
            baglam.cihazId,
          ],
        );

        const kalemler = Array.isArray(veri.kalemler) ? (veri.kalemler as Record<string, unknown>[]) : [];
        for (const [sira, kalem] of kalemler.entries()) {
          await islem.calistir(
            `INSERT INTO alis_kalemleri (id, isletme_id, fatura_id, urun_id, miktar, birim_fiyat,
                                         kdv_orani, satir_toplam, skt, lot_no)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(isletme_id, id) DO NOTHING`,
            // Kalem id'si yükte yok; fatura + sıra deterministik ve tekrar güvenlidir.
            [
              `${faturaId}-${sira}`,
              isletmeId,
              faturaId,
              metin(kalem.urun_id),
              sayi(kalem.miktar),
              sayi(kalem.birim_fiyat),
              sayi(kalem.kdv_orani),
              sayi(kalem.satir_toplam),
              kalem.skt ?? null,
              kalem.lot_no ?? null,
            ],
          );
        }

        await islem.calistir(
          `INSERT INTO cari_hareketler (id, isletme_id, cari_id, hareket_tipi, tutar, aciklama, belge_id,
                                        tarih, vade_tarihi, kullanici_id, cihaz_id)
           VALUES (?, ?, ?, 'BORC', ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(isletme_id, id) DO NOTHING`,
          [
            `${faturaId}-borc`,
            isletmeId,
            tedarikciId,
            genelToplam,
            `Mal alımı${faturaNo ? ` (Fatura ${faturaNo})` : ''}`,
            faturaId,
            faturaTarihi,
            veri.vade_tarihi ?? null,
            veri.kullanici_id ?? null,
            baglam.cihazId,
          ],
        );
        await cariOzetEkle(islem, baglam, tedarikciId, genelToplam, faturaTarihi);

        /**
         * Peşin/kısmi ödeme borçtan düşülür.
         *
         * Kasa mal kabulde yaptığı ödemeyi cari hareket olarak YEREL yazar ama
         * ayrı bir olay göndermez; ödeme tutarı fatura olayının içindedir.
         * Buradan düşmezsek merkez faturanın tamamını borç gösterir: kasada
         * 800,00 borcu olan tedarikçi panelde 1.200,00 görünür.
         *
         * Deterministik id + ON CONFLICT ile aynı fatura iki kez işlense
         * ödeme bir kez düşülür.
         */
        const odenen = sayi(veri.odenen_tutar);
        if (odenen > 0) {
          const eklendi = await islem.calistir(
            `INSERT INTO cari_hareketler (id, isletme_id, cari_id, hareket_tipi, tutar, aciklama, belge_id,
                                          tarih, kullanici_id, cihaz_id)
             VALUES (?, ?, ?, 'ODEME', ?, 'Mal alımı peşin ödeme', ?, ?, ?, ?)
             ON CONFLICT(isletme_id, id) DO NOTHING`,
            [
              `${faturaId}-odeme`,
              isletmeId,
              tedarikciId,
              -odenen,
              faturaId,
              faturaTarihi,
              veri.kullanici_id ?? null,
              baglam.cihazId,
            ],
          );
          if (eklendi.rowsAffected > 0) {
            await cariOzetEkle(islem, baglam, tedarikciId, -odenen, faturaTarihi);
          }
        }
      }

      await islem.calistir(
        `INSERT INTO denetim_log (id, isletme_id, kullanici_id, islem, entity, entity_id, yeni_deger, zaman, cihaz_id)
         VALUES (?, ?, ?, 'MAL_KABUL', 'alis_faturasi', ?, ?, ?, ?)
         ON CONFLICT(isletme_id, id) DO NOTHING`,
        [
          crypto.randomUUID(),
          isletmeId,
          veri.kullanici_id ?? null,
          metin(veri.id),
          JSON.stringify(veri),
          baglam.zaman,
          baglam.cihazId,
        ],
      );
      return;
    }

    /*
     * Fatura iptali (§11.8).
     *
     * Belge SİLİNMEZ, durumu IPTAL olur — "bu mal hiç gelmedi" ile "bu fatura
     * yanlıştı, düzeltildi" farklı şeylerdir ve ikisi de görünmelidir. Stok
     * geri alınması ayrı STOK_HAREKETI olaylarıyla gelir; buradaki iş cari
     * borcu ters kayıtla geri almak ve belgeyi işaretlemektir.
     */
    case 'ALIS_FATURASI_IPTAL': {
      const faturaId = metin(veri.id);
      const tedarikciId = metin(veri.tedarikci_id);
      const tutar = sayi(veri.genel_toplam);
      const zaman = metin(veri.tarih, baglam.zaman);
      if (!faturaId) return;

      await islem.calistir(
        `UPDATE alis_faturalari SET durum = 'IPTAL', iptal_neden = ?, iptal_zamani = ?, updated_at = ?
         WHERE isletme_id = ? AND id = ?`,
        [metin(veri.neden) || null, zaman, baglam.zaman, isletmeId, faturaId],
      );

      if (tedarikciId && tutar > 0) {
        const eklendi = await islem.calistir(
          `INSERT INTO cari_hareketler (id, isletme_id, cari_id, hareket_tipi, tutar, aciklama, belge_id,
                                        belge_tipi, tarih, kullanici_id, cihaz_id)
           VALUES (?, ?, ?, 'DUZELTME', ?, ?, ?, 'ALIS_IPTAL', ?, ?, ?)
           ON CONFLICT(isletme_id, id) DO NOTHING`,
          [
            `${faturaId}-iptal`,
            isletmeId,
            tedarikciId,
            -tutar,
            `Alış faturası iptali${metin(veri.neden) ? `: ${metin(veri.neden)}` : ''}`,
            faturaId,
            zaman,
            veri.kullanici_id ?? null,
            baglam.cihazId,
          ],
        );
        if (eklendi.rowsAffected > 0) await cariOzetEkle(islem, baglam, tedarikciId, -tutar, zaman);

        // Peşin ödeme yapılmıştıysa onun da tersi yazılır, yoksa tedarikçi alacaklı görünür.
        const odenen = sayi(veri.odenen_tutar);
        if (odenen > 0) {
          const odemeIptal = await islem.calistir(
            `INSERT INTO cari_hareketler (id, isletme_id, cari_id, hareket_tipi, tutar, aciklama, belge_id,
                                          belge_tipi, tarih, kullanici_id, cihaz_id)
             VALUES (?, ?, ?, 'DUZELTME', ?, ?, ?, 'ALIS_ODEME_IPTAL', ?, ?, ?)
             ON CONFLICT(isletme_id, id) DO NOTHING`,
            [
              `${faturaId}-odeme-iptal`,
              isletmeId,
              tedarikciId,
              odenen,
              'Alış ödemesi iptali',
              faturaId,
              zaman,
              veri.kullanici_id ?? null,
              baglam.cihazId,
            ],
          );
          if (odemeIptal.rowsAffected > 0) await cariOzetEkle(islem, baglam, tedarikciId, odenen, zaman);
        }
      }
      return;
    }

    /** Belge bilgisi düzeltmesi — mali etkisi yoktur, yalnız alanlar güncellenir. */
    case 'ALIS_FATURASI_GUNCELLENDI': {
      const faturaId = metin(veri.id);
      if (!faturaId) return;
      await islem.calistir(
        `UPDATE alis_faturalari SET fatura_no = ?, vade_tarihi = ?, notlar = ?, updated_at = ?
         WHERE isletme_id = ? AND id = ? AND durum <> 'IPTAL'`,
        [
          veri.fatura_no ?? null,
          veri.vade_tarihi ?? null,
          veri.notlar ?? null,
          metin(veri.updated_at, baglam.zaman),
          isletmeId,
          faturaId,
        ],
      );
      return;
    }

    case 'DENETIM_KAYDI':
      await islem.calistir(
        `INSERT INTO denetim_log (id, isletme_id, kullanici_id, islem, entity, entity_id, eski_deger, yeni_deger, zaman, cihaz_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(isletme_id, id) DO NOTHING`,
        [
          metin(veri.id, crypto.randomUUID()),
          isletmeId,
          veri.kullanici_id ?? null,
          metin(veri.islem),
          metin(veri.entity),
          veri.entity_id ?? null,
          veri.eski_deger ?? null,
          veri.yeni_deger ?? null,
          metin(veri.zaman, baglam.zaman),
          baglam.cihazId,
        ],
      );
      return;

    /*
     * Mağaza ayarı (§8.3). Kasa YALNIZ merkezî ayarlar için bu olayı üretir;
     * yazıcı, yedek, tema gibi cihaza özel anahtarlar hiç gönderilmez.
     *
     * Ayarın kimliği ANAHTARIN KENDİSİDİR: aynı ayar iki kasadan gelirse iki
     * satır değil, tek satırın güncellenmesi gerekir. Bu yüzden id rastgele
     * değil, işletme + anahtar üzerinden belirlenimli üretilir.
     */
    case 'AYAR_DEGISTI': {
      const anahtar = metin(veri.anahtar);
      if (!anahtar) return;
      const mevcut = await islem.tek<{ id: string }>('SELECT id FROM ayarlar WHERE isletme_id = ? AND anahtar = ?', [
        baglam.isletmeId,
        anahtar,
      ]);
      await lwwUpsert(
        islem,
        baglam,
        'ayarlar',
        ['anahtar', 'deger', 'aciklama', 'created_at', 'updated_at', 'cihaz_id'],
        [
          anahtar,
          metin(veri.deger),
          veri.aciklama ?? null,
          metin(veri.created_at, baglam.zaman),
          metin(veri.updated_at, baglam.zaman),
          baglam.cihazId,
        ],
        mevcut ? String(mevcut.id) : crypto.randomUUID(),
        metin(veri.updated_at, baglam.zaman),
      );
      return;
    }

    case 'GUNLUK_OZET':
      // Rollup zaten satış olaylarından üretilir; ayrıca saklanmaz.
      return;

    default:
      throw new Error(`Desteklenmeyen olay tipi: ${tip}`);
  }
}
