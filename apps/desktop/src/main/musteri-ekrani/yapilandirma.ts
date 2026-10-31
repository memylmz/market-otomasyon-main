/**
 * Müşteri ekranı yapılandırması — ayarlardan ve katalogdan, müşteri
 * penceresinin doğrudan çizebileceği oynatma listesini üretir.
 *
 * Fiyatlar burada, HER ÜRETİMDE katalogdan okunur: ürün fiyatı ya da kampanya
 * değişince ekran kendiliğinden güncellenir (ana süreç dakikada bir ve her
 * ayar kaydı/senkronda yeniden üretir). Bitmiş ya da başlamamış kampanya
 * listeye girmez.
 */

import {
  AYAR,
  kampanyaFiyatiBul,
  kampanyaFiyatKarti,
  MAKS_KAMPANYA_SLAYTI,
  MUSTERI_EKRANI_AYAR,
  MUSTERI_EKRANI_VARSAYILAN,
  musteriTemaDegiskenleri,
  musteriTemasiCoz,
  simdi,
  slaytlariCoz,
  urunFiyatKarti,
  VIDEO_UST_SINIR_MS,
  type EkranSlayti,
  type KampanyaSlaytHedefi,
  type KampanyaTanimi,
  type KampanyaTipi,
  type MusteriEkraniYapilandirmasi,
  type ZamanDamgasi,
} from '@market/shared';
import { ayarOku } from '../depo/ayar.js';
import { etkinKampanyalar, kategoriBul, urunBul, type KampanyaKaydi } from '../depo/katalog.js';
import type { Baglam } from '../servis/baglam.js';
import { medyaYolu } from './medya.js';

/** Müşteri penceresinin medya dosyalarını aldığı özel şema (bkz. pencere.ts). */
export const MEDYA_SEMASI = 'musteri-medya';

export function medyaUrl(ad: string): string {
  return `${MEDYA_SEMASI}://dosya/${ad}`;
}

export interface YapilandirmaSecenekleri {
  /**
   * Kaydedilmemiş ayarlar (Ayarlar ekranındaki önizleme). Verilen anahtarlar
   * veritabanındakinin yerine geçer; verilmeyenler veritabanından okunur.
   */
  ayarlar?: Record<string, string>;
  zaman?: ZamanDamgasi;
}

function tanimaCevir(k: KampanyaKaydi): KampanyaTanimi {
  return {
    id: k.id,
    tip: k.tip as KampanyaTipi,
    kapsam: k.kapsam,
    hedefId: k.hedef_id,
    deger: k.deger,
    esikMiktar: k.esik_miktar ?? undefined,
    baslangic: k.baslangic,
    bitis: k.bitis,
    aktifMi: k.aktif_mi,
    oncelik: k.oncelik,
  };
}

/** Kampanyanın hedefini ekrana yazılabilir hâle getirir; hedef yoksa/pasifse null. */
function kampanyaHedefi(baglam: Baglam, k: KampanyaKaydi): KampanyaSlaytHedefi | null {
  if (k.kapsam === 'TUM') return { kapsam: 'TUM' };
  if (!k.hedef_id) return null;
  if (k.kapsam === 'KATEGORI') {
    const kategori = kategoriBul(baglam.vt, k.hedef_id);
    return kategori && kategori.aktif_mi ? { kapsam: 'KATEGORI', ad: kategori.ad } : null;
  }
  const urun = urunBul(baglam.vt, k.hedef_id);
  if (!urun || !urun.aktif_mi) return null;
  return { kapsam: 'URUN', ad: urun.ad, listeFiyati: urun.satis_fiyati, birimTipi: urun.birim_tipi };
}

function sayiAyari(ham: string | null, varsayilan: number, en: number, cok: number): number {
  const sayi = Number(ham);
  if (ham === null || ham.trim() === '' || !Number.isFinite(sayi)) return varsayilan;
  return Math.min(cok, Math.max(en, Math.round(sayi)));
}

export function musteriEkraniYapilandirmasi(baglam: Baglam, secenek: YapilandirmaSecenekleri = {}): MusteriEkraniYapilandirmasi {
  const zaman = secenek.zaman ?? simdi();
  const oku = (anahtar: string): string | null => secenek.ayarlar?.[anahtar] ?? ayarOku(baglam.vt, anahtar);

  const kampanyalar = etkinKampanyalar(baglam.vt, zaman);
  const tanimlar = kampanyalar.map(tanimaCevir);

  const slaytlar: EkranSlayti[] = [];
  for (const s of slaytlariCoz(oku(MUSTERI_EKRANI_AYAR.SLAYTLAR))) {
    if (!s.aktif) continue;
    switch (s.tip) {
      case 'KARSILAMA':
        slaytlar.push({ anahtar: s.id, tip: 'KARSILAMA', sureMs: s.sure_sn * 1000 });
        break;

      case 'KAMPANYALAR': {
        let eklenen = 0;
        for (const k of kampanyalar) {
          if (eklenen >= MAKS_KAMPANYA_SLAYTI) break;
          const hedef = kampanyaHedefi(baglam, k);
          if (!hedef) continue;
          const kart = kampanyaFiyatKarti(
            { ad: k.ad, tip: k.tip as KampanyaTipi, kapsam: k.kapsam, deger: k.deger, esikMiktar: k.esik_miktar },
            hedef,
          );
          if (!kart) continue;
          slaytlar.push({ anahtar: `${s.id}:${k.id}`, tip: 'FIYAT', sureMs: s.sure_sn * 1000, kart });
          eklenen++;
        }
        break;
      }

      case 'URUN': {
        const urun = urunBul(baglam.vt, s.urun_id);
        // Silinen ya da pasife alınan ürünün eski fiyatı ekranda kalmasın.
        if (!urun || !urun.aktif_mi) break;
        const { fiyat } = kampanyaFiyatiBul(
          urun.satis_fiyati,
          { urunId: urun.id, kategoriId: urun.kategori_id },
          tanimlar,
          zaman,
        );
        slaytlar.push({
          anahtar: s.id,
          tip: 'FIYAT',
          sureMs: s.sure_sn * 1000,
          kart: urunFiyatKarti(s, { ad: urun.ad, listeFiyati: urun.satis_fiyati, fiyat, birimTipi: urun.birim_tipi }),
        });
        break;
      }

      case 'DUYURU':
        slaytlar.push({ anahtar: s.id, tip: 'DUYURU', sureMs: s.sure_sn * 1000, baslik: s.baslik, metin: s.metin, tema: s.tema });
        break;

      case 'GORSEL':
        // Dosyası silinmiş slayt atlanır; siyah ekran gösterilmez.
        if (medyaYolu(baglam.yollar, s.dosya)) {
          slaytlar.push({ anahtar: s.id, tip: 'GORSEL', sureMs: s.sure_sn * 1000, url: medyaUrl(s.dosya) });
        }
        break;

      case 'VIDEO':
        if (medyaYolu(baglam.yollar, s.dosya)) {
          slaytlar.push({ anahtar: s.id, tip: 'VIDEO', sureMs: VIDEO_UST_SINIR_MS, url: medyaUrl(s.dosya) });
        }
        break;
    }
  }

  const logo = oku(MUSTERI_EKRANI_AYAR.LOGO) ?? '';
  return {
    isletmeAdi: (oku(AYAR.ISLETME_ADI) ?? '').trim(),
    karsilamaMetni: (oku(MUSTERI_EKRANI_AYAR.KARSILAMA_METNI) ?? MUSTERI_EKRANI_VARSAYILAN.KARSILAMA_METNI).trim(),
    karsilamaAltMetni: (oku(MUSTERI_EKRANI_AYAR.KARSILAMA_ALT_METNI) ?? MUSTERI_EKRANI_VARSAYILAN.KARSILAMA_ALT_METNI).trim(),
    logoUrl: logo && medyaYolu(baglam.yollar, logo) ? medyaUrl(logo) : null,
    tesekkurMetni: (oku(MUSTERI_EKRANI_AYAR.TESEKKUR_METNI) ?? MUSTERI_EKRANI_VARSAYILAN.TESEKKUR_METNI).trim(),
    tesekkurMs: sayiAyari(oku(MUSTERI_EKRANI_AYAR.TESEKKUR_SN), MUSTERI_EKRANI_VARSAYILAN.TESEKKUR_SN, 2, 30) * 1000,
    slaytlar,
    gorunum: musteriTemaDegiskenleri(musteriTemasiCoz(oku(MUSTERI_EKRANI_AYAR.TEMA))),
  };
}
