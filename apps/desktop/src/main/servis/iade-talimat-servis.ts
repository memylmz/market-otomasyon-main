/**
 * Panelden gelen kısmi iade talimatlarını uygular (§10.4).
 *
 * NEDEN TALİMAT: stok ve cari hareketlerinin tek üreticisi kasadır. Bulut
 * kendi başına hareket üretirse kasa ondan habersiz kalır ve iki taraf ayrışır.
 * Panel yalnız "şu satıştan şu kalemleri şu miktarda iade et" der; hareketi
 * kasa kendi `iadeYap` servisiyle üretir — yani panelden yapılan iade, kasadan
 * yapılanla birebir aynı yoldan geçer.
 *
 * NEDEN HEMEN UYGULANMAZ: iade bir KASA OTURUMU ister (iade fişi bir vardiyaya
 * aittir; nakit iadede para çekmeceden çıkar). Senkron kasa kapalıyken de
 * çalıştığı için talimat yerelde bekletilir ve kasa açıldığında işlenir.
 */

import { simdi } from '@market/shared';
import type { Vt } from '../db/surucu.js';
import { iadeYap } from './satis-servis.js';
import { yetkisiVarMi, type Aktor, type Baglam } from './baglam.js';

export interface IadeTalimati {
  id: string;
  satis_id: string;
  kalemler: string;
  iade_yontemi: string;
  neden: string;
  hedef_cihaz_id: string;
}

/** Pull'da gelen talimatı yerele yazar. Aynı id tekrar inerse üzerine yazılmaz. */
export function iadeTalimatiniSakla(vt: Vt, veri: Record<string, unknown>, zaman = simdi()): void {
  const id = String(veri.id ?? '');
  if (!id) return;
  vt.hazirla(
    `INSERT INTO iade_talimatlari (id, satis_id, kalemler, iade_yontemi, neden, hedef_cihaz_id,
                                   kullanici_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).calistir(
    id,
    String(veri.satis_id ?? ''),
    typeof veri.kalemler === 'string' ? veri.kalemler : JSON.stringify(veri.kalemler ?? []),
    String(veri.iade_yontemi ?? 'NAKIT'),
    String(veri.neden ?? 'Panelden iade'),
    String(veri.hedef_cihaz_id ?? ''),
    (veri.kullanici_id as string | null) ?? null,
    String(veri.created_at ?? zaman),
    zaman,
  );
}

export interface IslemSonucu {
  uygulanan: number;
  basarisiz: number;
}

/**
 * Bekleyen talimatları uygular.
 *
 * Kasa oturumu olmayan aktörle çağrılırsa hiçbir şey yapılmaz — talimat
 * beklemeye devam eder. Başarısız olan talimat da uygulanmış SAYILMAZ; hata
 * kaydedilir ve bir sonraki denemede tekrar denenir. Kalıcı hata (ör. satış
 * bulunamadı) tekrar denendiğinde de aynı sonucu verir, ama sessizce
 * kaybolmaktansa görünür kalması yeğdir.
 */
export function bekleyenIadeleriIsle(baglam: Baglam, aktor: Aktor): IslemSonucu {
  if (!aktor.kasaOturumId) return { uygulanan: 0, basarisiz: 0 };

  const { vt, cihazId } = baglam;
  const bekleyenler = vt
    .hazirla(
      `SELECT id, satis_id, kalemler, iade_yontemi, neden, hedef_cihaz_id
       FROM iade_talimatlari WHERE uygulandi_mi = 0 ORDER BY created_at`,
    )
    .tumu<IadeTalimati>();

  let uygulanan = 0;
  let basarisiz = 0;

  for (const talimat of bekleyenler) {
    // Talimat BU kasaya yazılmışsa uygulanır; iki kasa uygularsa iade iki kez işlenir.
    if (talimat.hedef_cihaz_id && talimat.hedef_cihaz_id !== cihazId) continue;
    /*
     * Yetkisiz kullanıcı oturumdayken talimat BEKLER, başarısız SAYILMAZ.
     *
     * Kardeş servisler (alış, cari) bunu yapıyordu; burada yoktu. `iadeYap`
     * yetki hatası fırlatıyor, hata yakalanıp talimatın `hata` alanına
     * yazılıyor ve her senkron turunda sahte bir başarısızlık üretiliyordu.
     * Kasiyer oturumdayken iade eninde sonunda uygulanıyor ama arada yanıltıcı
     * hata kaydı birikiyordu.
     */
    if (!yetkisiVarMi(aktor, 'satis.iade')) continue;

    try {
      const kalemler = JSON.parse(talimat.kalemler) as { satis_kalemi_id: string; miktar: number }[];
      /*
       * UYGULAMA VE "UYGULANDI" İŞARETİ TEK İŞLEMDE.
       *
       * Eskiden ikisi ayrı yazmaydı: talimat uygulanıyor, ardından ayrı bir
       * UPDATE ile işaretleniyordu. Arada elektrik kesilirse işlem yapılmış
       * ama talimat "bekliyor" kalıyor ve bir sonraki senkronda TEKRAR
       * uygulanıyordu. Deneyle doğrulandı: alış faturasında stok 10→20 adet,
       * tedarikçi borcu 120→240 TL, fatura sayısı 1→2 oldu; hiçbir koruma
       * devreye girmedi.
       *
       * Sürücü iç içe işlemi SAVEPOINT ile desteklediği için, içeride kendi
       * `vt.islem`ini açan servisler bundan etkilenmez.
       */
      const satisId = vt.islem(() => {
        const sonuc = iadeYap(baglam, aktor, {
          kaynak_satis_id: talimat.satis_id,
          kalemler,
          iade_yontemi: talimat.iade_yontemi,
          neden: talimat.neden,
        });
        vt.hazirla(
          'UPDATE iade_talimatlari SET uygulandi_mi = 1, sonuc_satis_id = ?, hata = NULL, updated_at = ? WHERE id = ?',
        ).calistir(sonuc.satisId, simdi(), talimat.id);
        return sonuc.satisId;
      });
      uygulanan++;
      baglam.kayit.bilgi('Panelden gelen iade uygulandı', { talimat_id: talimat.id, satis_id: satisId });
    } catch (hata) {
      const mesaj = hata instanceof Error ? hata.message : String(hata);
      vt.hazirla('UPDATE iade_talimatlari SET hata = ?, updated_at = ? WHERE id = ?').calistir(mesaj, simdi(), talimat.id);
      basarisiz++;
      baglam.kayit.uyari('Panelden gelen iade uygulanamadı', { talimat_id: talimat.id, mesaj });
    }
  }

  return { uygulanan, basarisiz };
}
