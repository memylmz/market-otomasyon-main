/**
 * Pavo N86 yazarkasa POS'u — kasanın satışları cihazdan geçirdiği yer.
 *
 * Banka POS'undan farkı: Pavo yalnız kart çekmez, YASAL FİŞİ KESER. Bu yüzden
 * POS türü PAVO iken nakit ve veresiye dahil HER satış cihaza gider.
 *
 * ALTIN KURAL: para hakkındaki tek doğru kaynak cihazın cevabıdır. Satış cihaz
 * "tamam" demeden ödenmiş sayılmaz; cevap kaybolursa kör tekrar YOK, önce
 * `GetSaleResult` ile gerçek öğrenilir.
 *
 * BİR SATIŞ = BİR ÖDEME AKIŞI, ASKIYA ALMA YOK (Cybele, 23 Ekim 2026): satış
 * ya tamamen ödenir ya cihazdan silinir. Kart reddedilir ya da kasiyer
 * vazgeçerse satış cihazdan da silinir (Pavo reddedilen sepeti askıda tutuyor;
 * askıda satış varken yeni satış açılamaz — hata 30). Müşteri tam o anda
 * ödediyse silinmez, satış kaydedilir. Askıda satış ancak teknik kazayla kalır
 * (elektrik kesildi, program çöktü) ve açılıştaki kurtarma onu çözer.
 *
 * Kasadaki "+ Sepet" bununla karışmaz: o sepetler cihaza hiç gitmemiştir.
 *
 * NİYET DEFTERİ: her satış cihaza gitmeden ÖNCE `pavo_defteri`ne yazılır.
 * Ödeme cihazda alınıp program kayıt yazamadan ölürse, kurtarma kaydı cihaza
 * sorar ve satışı defterdeki girdiden oluşturur.
 */

import {
  AYAR,
  bugun,
  gunEkle,
  gunFarki,
  hatalar,
  pavoFaturaNo,
  pavoHataMetni,
  pavoKalanTutar,
  pavoKapandiMi,
  pavoOdemesi,
  pavoOdemeSirasi,
  pavoRaporBirlestir,
  pavoRaporlariCoz,
  pavoSatisIstegi,
  faturaAlicisiDogrula,
  faturaSinirlariCoz,
  faturaSiniriIcin,
  faturaZorunlu,
  faturaAlicisiPartisi,
  kimlikTuru,
  mukellefBilgisiCoz,
  type FaturaAlicisi,
  pavoSatisiCoz,
  pavoTl,
  pavoVergiKodu,
  PAVO_AYAR,
  PAVO_VARSAYILAN_UYGULAMA_ADI,
  simdi,
  URUN_SURUMU,
  uuid,
  type Kurus,
  type PavoOdemeTipi,
  type PavoRaporu,
  type PavoRaporTuru,
  type PavoSatisi,
  type PavoYaniti,
  type PosIslemSonucu,
} from '@market/shared';
import type { Vt } from '../db/surucu.js';
import { ayarMetin, ayarOku, ayarSayi, ayarYaz } from '../depo/ayar.js';
import {
  acikDefterKayitlari,
  defterKapat,
  defterNotu,
  defterSatisNo,
  defterYaz,
  pavoSatisiBul,
  pavoSatisiYaz,
  type PavoDefterKaydi,
} from '../depo/pavo.js';
import { posGunlukYaz } from '../depo/pos-gunluk.js';
import { kalemleriGetir } from '../depo/satis.js';
import { PavoIstemci, PavoTasimaHatasi, type PavoGonderimi, type PavoTasiyici } from '../donanim/pavo-istemci.js';
import { yetkiIste, type Aktor, type Baglam } from './baglam.js';
import { iadeYap, satisIptal, satisKesinlestir, type SatisSonucu } from './satis-servis.js';

// ---------------------------------------------------------------------------
// Bağlantı
// ---------------------------------------------------------------------------

export function pavoAcikMi(baglam: Baglam): boolean {
  return ayarMetin(baglam.vt, AYAR.POS_TURU, 'KAPALI') === 'PAVO';
}

/** Bu kasanın kalıcı parmak izi; bir kez üretilir, değişirse cihaz yeniden eşleştirme ister. */
function parmakIzi(vt: Vt): string {
  const mevcut = ayarOku(vt, PAVO_AYAR.PARMAK_IZI);
  if (mevcut) return mevcut;
  const yeni = `market-kasa-${uuid()}`;
  ayarYaz(vt, PAVO_AYAR.PARMAK_IZI, yeni);
  return yeni;
}

let disaridanTasiyici: PavoTasiyici | undefined;
let istemci: PavoIstemci | null = null;

/** Testlerde sahte cihaz takmak için. */
export function pavoTasiyiciDegistir(t: PavoTasiyici | undefined): void {
  disaridanTasiyici = t;
}

function tasiyici(baglam: Baglam): PavoTasiyici {
  if (disaridanTasiyici) return disaridanTasiyici;
  // Bağlantı bilgisi her istekte AYARDAN okunur; istemci yalnız şeridi ve
  // kuyruğu tutar. Adres değişince istemciyi yeniden kurmak gerekmez.
  istemci ??= new PavoIstemci(
    () => ({
      adres: ayarMetin(baglam.vt, AYAR.POS_ADRES, ''),
      https: ayarMetin(baglam.vt, PAVO_AYAR.HTTPS, '0') === '1',
      seriNo: ayarMetin(baglam.vt, PAVO_AYAR.SERI_NO, '').trim(),
      parmakIzi: parmakIzi(baglam.vt),
      sertifika: ayarMetin(baglam.vt, PAVO_AYAR.SERTIFIKA, ''),
    }),
    {
      sonSira: () => ayarSayi(baglam.vt, PAVO_AYAR.SON_SIRA, 0),
      sonSiraYaz: (n) => ayarYaz(baglam.vt, PAVO_AYAR.SON_SIRA, String(n)),
      sertifikaYaz: (o) => ayarYaz(baglam.vt, PAVO_AYAR.SERTIFIKA, o),
    },
  );
  return istemci;
}

function uygulama(vt: Vt): { RefererApp: string; RefererAppVersion: string } {
  return {
    RefererApp: ayarMetin(vt, PAVO_AYAR.UYGULAMA_ADI, '').trim() || PAVO_VARSAYILAN_UYGULAMA_ADI,
    RefererAppVersion: URUN_SURUMU,
  };
}

function kartOkumaSn(vt: Vt): number {
  return Math.max(15, Math.min(180, ayarSayi(vt, AYAR.POS_ZAMAN_ASIMI_SN, 60)));
}

/** Cihaz hata döndürdü (taşıma değil). */
export class PavoCihazHatasi extends Error {
  constructor(readonly yanit: PavoYaniti) {
    super(pavoHataMetni(yanit));
    this.name = 'PavoCihazHatasi';
  }
}

const KISA_MS = 20_000;
const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Testler beklemeleri kısaltır. */
let beklemeCarpani = 1;
export function pavoBeklemeCarpani(c: number): void {
  beklemeCarpani = c;
}

async function gonder(baglam: Baglam, yol: string, g: PavoGonderimi): Promise<PavoYaniti> {
  return tasiyici(baglam).gonder(yol, g);
}

async function gonderVeyaFirlat(baglam: Baglam, yol: string, g: PavoGonderimi): Promise<PavoYaniti> {
  const y = await gonder(baglam, yol, g);
  if (y.hata) throw new PavoCihazHatasi(y);
  return y;
}

/** Kasiyere gösterilecek metin. */
function metin(hata: unknown): string {
  if (hata instanceof PavoCihazHatasi || hata instanceof PavoTasimaHatasi) return hata.message;
  if (hata instanceof Error) return hata.message;
  return String(hata);
}

// ---------------------------------------------------------------------------
// Cihaz işlemleri
// ---------------------------------------------------------------------------

/**
 * Eşleştirme. Cihaz ekranında ONAY ister — bekleme uzun. Seri numarası önceden
 * girilmeli: cihaz eşleştirmede de doğruluyor (hata 71). Başarıda sıra 1'e
 * çekilir (sıradaki istek 2 ile gider — doküman kuralı).
 */
export async function pavoEsles(baglam: Baglam, aktor: Aktor): Promise<{ seriNo: string }> {
  yetkiIste(aktor, 'ayar.yonet');
  if (!ayarMetin(baglam.vt, PAVO_AYAR.SERI_NO, '').trim()) {
    throw hatalar.dogrulama("Önce Pavo'nun seri numarasını girip kaydedin — eşleştirmede de doğrulanıyor.");
  }
  const y = await pavoCagri(() => gonderVeyaFirlat(baglam, '/Pairing', { zamanAsimiMs: 150_000, muaf: true, sabitSira: 1 }));
  if (y.seriNo) ayarYaz(baglam.vt, PAVO_AYAR.SERI_NO, y.seriNo);
  ayarYaz(baglam.vt, PAVO_AYAR.SON_SIRA, '1');
  return { seriNo: y.seriNo ?? ayarMetin(baglam.vt, PAVO_AYAR.SERI_NO, '') };
}

/**
 * GİB mükellef sorgusu (faturalı satış): vergi no / TC kimlik no → unvan,
 * vergi dairesi, adres. Cihaz internete çıkıp GİB'e sorar; bulunamazsa
 * kasiyer bilgileri elle yazar.
 */
export async function pavoMukellefSorgula(baglam: Baglam, aktor: Aktor, hamNo: string): Promise<FaturaAlicisi> {
  yetkiIste(aktor, 'satis.yap');
  const no = String(hamNo ?? '').replace(/[\s-]/g, '');
  const tur = kimlikTuru(no);
  if (!tur) throw hatalar.dogrulama('Vergi no (10 hane) ya da TC kimlik no (11 hane) geçersiz.');
  const y = await pavoCagri(() =>
    gonderVeyaFirlat(baglam, '/QueryCustomerInfo', {
      input: tur === 'VKN' ? { Vkn: no } : { Tckn: no },
      inputKey: 'Customer',
      zamanAsimiMs: 30_000,
    }),
  );
  const bilgi = (y.veri as { CustomerInfo?: Record<string, unknown> } | null)?.CustomerInfo;
  if (!bilgi) throw hatalar.dogrulama('GİB kaydı bulunamadı; bilgileri elle yazın.');
  return mukellefBilgisiCoz(bilgi, no);
}

/** Bağlantı testi (POS ayarlarındaki "Bağlantıyı Test Et"). */
export async function pavoTesti(baglam: Baglam): Promise<{ basarili: boolean; mesaj: string }> {
  try {
    const y = await gonder(baglam, '/Ping', { zamanAsimiMs: 8_000, muaf: true });
    if (y.hata) return { basarili: false, mesaj: pavoHataMetni(y) };
    // Ping eşleşmeyi doğrulamaz; eşleşme ödeme aracı sorgusuyla sınanır.
    const araci = await gonder(baglam, '/PaymentMediators', { zamanAsimiMs: KISA_MS });
    if (araci.hata) return { basarili: false, mesaj: `Cihaza ulaşıldı ama: ${pavoHataMetni(araci)}` };
    return { basarili: true, mesaj: 'Pavo bağlı ve eşleşmiş.' };
  } catch (hata) {
    return { basarili: false, mesaj: metin(hata) };
  }
}

/** UygulamaHatası'na çevirir; ham taşıma/cihaz hatası arayüze sızmasın. */
async function pavoCagri<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (hata) {
    if (hata instanceof PavoCihazHatasi || hata instanceof PavoTasimaHatasi) throw hatalar.dogrulama(hata.message);
    throw hata;
  }
}

type Arama = { durum: 'BULUNDU'; satis: PavoSatisi } | { durum: 'YOK' } | { durum: 'BELIRSIZ' };

/**
 * Siparişi cihazda arar — ve "bulamadım" ile "kesinlikle yok"u karıştırmaz.
 *
 * İki tuzak (ikisi de sahada yandı): askıdaki satış `GetSaleResult` ile
 * bulunmuyor (hata 1) — bu yüzden bulunamayınca askıdakilere de bakılır.
 * Cihaz meşgul/ulaşılamazsa da cevap gelmez; bunu "yok" saymak tahsil
 * edilmiş bir satışın tek izini silmek olurdu → BELIRSIZ.
 */
async function satisAra(baglam: Baglam, siparisNo: string, deneme = 3): Promise<Arama> {
  for (let i = 0; i < deneme; i++) {
    try {
      const y = await gonder(baglam, '/GetSaleResult', { input: { OrderNo: siparisNo }, zamanAsimiMs: KISA_MS });
      if (!y.hata && y.veri) return { durum: 'BULUNDU', satis: pavoSatisiCoz(y.veri) };
      if (y.kod === 130) {
        // Satış hâlâ işleniyor (kart bekleniyor olabilir).
        await bekle(3_000 * beklemeCarpani);
        continue;
      }
      if (y.kod === 1) {
        const askida = await gonder(baglam, '/CheckPendingSale', { input: { OrderNo: siparisNo }, zamanAsimiMs: KISA_MS });
        if (!askida.hata && askida.veri) return { durum: 'BULUNDU', satis: pavoSatisiCoz(askida.veri) };
        return { durum: 'YOK' };
      }
    } catch {
      /* ulaşılamadı: bekle, tekrar dene */
    }
    await bekle(2_000 * beklemeCarpani);
  }
  return { durum: 'BELIRSIZ' };
}

/** Askıdaki satışı ödemesiz terk eder (alınmış ödemeleri cihaz iade eder). */
async function askidakiniSil(baglam: Baglam, satisNo: string, siparisNo: string, siraAtla = false): Promise<boolean> {
  const dene = async (kimlik: Record<string, string>) => {
    try {
      const y = await gonder(baglam, '/AbandonSuspendedSale', {
        input: { ...uygulama(baglam.vt), ...kimlik },
        zamanAsimiMs: siraAtla ? KISA_MS : (kartOkumaSn(baglam.vt) + 60) * 1000,
        siraAtla,
      });
      return !y.hata;
    } catch {
      return false;
    }
  };
  if (satisNo && (await dene({ SaleNumber: satisNo }))) return true;
  return dene({ OrderNo: siparisNo });
}

/** Tamamlanmış satışı iptal eder (cihaz ödemeleri iade eder, belgeyi iptal eder). */
async function cihazdaIptal(baglam: Baglam, satisNo: string, neden: string): Promise<PavoSatisi> {
  const y = await gonderVeyaFirlat(baglam, '/CancelSale', {
    input: {
      ...uygulama(baglam.vt),
      SaleNumber: satisNo,
      CancelReason: neden,
      SendResponseBeforePrint: true,
      // İptal kasadan başlatıldı; cihaz ödeme özeti ekranında "devam" beklemesin.
      SkipPaymentSummary: true,
    },
    zamanAsimiMs: (kartOkumaSn(baglam.vt) + 60) * 1000,
  });
  return pavoSatisiCoz(y.veri);
}

// ---------------------------------------------------------------------------
// Ödemeden vazgeç
// ---------------------------------------------------------------------------

let surenSatis: { siparisNo: string; satisNo: string } | null = null;
let kasiyerVazgecti = false;

/**
 * Kart beklenirken kasiyerin "Ödemeden vazgeç"i. Sırayı atlar — süren ödeme
 * isteğinin bitmesini beklemek, kart okuma süresi dolana kadar hiçbir şey
 * olmaması demekti. Satış akışı ardından cihaza sorup satışı siler (müşteri tam
 * o anda ödediyse silmez, kaydeder).
 */
export async function pavoOdemedenVazgec(baglam: Baglam): Promise<{ gonderildi: boolean }> {
  if (!surenSatis) return { gonderildi: false };
  kasiyerVazgecti = true;
  try {
    await gonder(baglam, '/AbortCurrentPayment', { zamanAsimiMs: KISA_MS, siraAtla: true });
  } catch {
    /* "kesilecek ödeme yok" da olabilir; akış yine cihaza soracak */
  }
  return { gonderildi: true };
}

// ---------------------------------------------------------------------------
// Satış
// ---------------------------------------------------------------------------

/** Kayıt yazmadan dener ve SONUCU döndürür (cihaza gidecek kalemler buradan alınır). */
function kuruSonuc<T>(vt: Vt, govde: () => T): T {
  const kuru = Symbol('kuru');
  let sonuc: T | undefined;
  try {
    vt.islem(() => {
      sonuc = govde();
      throw kuru;
    });
  } catch (hata) {
    if (hata !== kuru) throw hata;
  }
  return sonuc as T;
}

function ozet(sonuc: SatisSonucu, odemeler: { tip?: string }[]): string {
  const k = sonuc.detay.kalemler;
  const ilk = k
    .slice(0, 3)
    .map((x) => x.urun_adi)
    .join(', ');
  const tipler = [...new Set(odemeler.map((o) => o.tip))].join('+');
  return `${ilk}${k.length > 3 ? ` +${k.length - 3}` : ''} — ${tipler}`;
}

interface PavoSatisGirdisi {
  odemeler?: { tip?: string; tutar?: number; alinan?: number; [a: string]: unknown }[];
  /** Faturalı satış: alıcı. Yoksa nihai tüketici fişi. */
  fatura?: FaturaAlicisi | null;
  [a: string]: unknown;
}

/** Cihazın kestiği e-belge (faturalı satışta). */
export interface EBelgeSonucu {
  no: string;
  sorguLinki: string | null;
}

/** Cihazın kalemlerini bizim satış kalemlerimize sırayla bağlar (kısmi iade için). */
function kalemEslesmesi(sonuc: SatisSonucu, satis: PavoSatisi) {
  return sonuc.detay.kalemler.map((k, i) => ({ satis_kalemi_id: k.id, pavo_kalem_id: satis.kalemler[i]?.id ?? 0 }));
}

/** Cihazda kapanmış satışı kayda geçirir: satış + Pavo eşleşmesi + POS günlüğü, tek transaction. */
function satisiKaydet(baglam: Baglam, aktor: Aktor, girdi: PavoSatisGirdisi, siparisNo: string, satis: PavoSatisi): SatisSonucu {
  const faturaNo = pavoFaturaNo(satis) || null;
  const ilkKart = (girdi.odemeler ?? []).findIndex((o) => o.tip === 'KART');
  const posluGirdi = {
    ...girdi,
    odemeler: (girdi.odemeler ?? []).map((o, i) =>
      i === ilkKart ? { ...o, pos_referans: satis.satisNo, pos_onay_kodu: faturaNo } : o,
    ),
  };
  return baglam.vt.islem(() => {
    const sonuc = satisKesinlestir(baglam, aktor, posluGirdi);
    pavoSatisiYaz(baglam.vt, {
      satis_id: sonuc.satisId,
      siparis_no: siparisNo,
      pavo_id: satis.id,
      satis_no: satis.satisNo,
      fatura_no: faturaNo,
      belge_no: satis.belgeler[0]?.belgeNo || null,
      sorgu_linki: satis.sorguLinki || null,
      kalemler: kalemEslesmesi(sonuc, satis),
    });
    posGunlukYaz(
      baglam.vt,
      {
        tur: 'SATIS',
        tutar: sonuc.genelToplam,
        sonuc: 'ONAY',
        onay_kodu: faturaNo,
        referans: satis.satisNo,
        kart: null,
        hata: null,
        orijinal_referans: null,
        belge_id: sonuc.satisId,
        belge_tipi: 'PAVO_SATIS',
        kullanici_id: aktor.kullaniciId,
      },
      baglam.cihazId,
    );
    defterKapat(baglam.vt, siparisNo, 'ONAYLANDI', { satisId: sonuc.satisId });
    return sonuc;
  });
}

let satisSuruyor = false;

export async function pavoIleSatis(
  baglam: Baglam,
  aktor: Aktor,
  hamGirdi: unknown,
): Promise<SatisSonucu & { pos: PosIslemSonucu | null; eBelge?: EBelgeSonucu | null }> {
  if (satisSuruyor) throw hatalar.dogrulama("Pavo'da süren bir satış var; bitmesini bekleyin.");
  satisSuruyor = true;
  kasiyerVazgecti = false;
  try {
    // Önceki satışın akıbeti belirsizken yeni satış açılmaz: çift tahsilat olmasın.
    const engel = await defteriCoz(baglam, aktor);
    if (engel.kalan.length > 0) {
      throw hatalar.dogrulama(
        `Önceki bir Pavo satışının durumu belirsiz (${engel.kalan[0]!.ozet}). Çift tahsilat olmasın diye yeni satış başlatılmadı. ` +
          'Pavo\'nun açık ve bağlı olduğunu kontrol edip tekrar deneyin; düzelmezse Ayarlar → POS & Yazarkasa → "Yarım kalan satışları çöz".',
      );
    }

    const girdi = (hamGirdi ?? {}) as PavoSatisGirdisi;
    // Faturalı satışta alıcı cihaza gitmeden denetlenir: GİB reddi ancak satış açıldıktan sonra gelirdi.
    if (girdi.fatura) {
      const sorun = faturaAlicisiDogrula(girdi.fatura);
      if (sorun) throw hatalar.dogrulama(`Fatura bilgisi: ${sorun}`);
    }
    // Kuru deneme: limit, kasa, yetki, stok hataları cihaza bir şey gitmeden yakalanır.
    const kuru = kuruSonuc(baglam.vt, () => satisKesinlestir(baglam, aktor, hamGirdi));

    /*
     * FATURA DÜZENLEME SINIRI (VUK 232): tutar sınıra ulaştıysa fiş yetmez.
     * Ödeme ekranı zaten uyarıyor; burası son kapı — eski bir ekran ya da
     * başka bir yol sınırı atlayıp fiş kesemesin. İade (eksi tutar) muaf.
     */
    if (!girdi.fatura) {
      const sinir = faturaSiniriIcin(faturaSinirlariCoz(ayarMetin(baglam.vt, AYAR.FATURA_SINIRLARI, '')));
      if (faturaZorunlu(kuru.genelToplam, sinir.tutar)) {
        throw hatalar.dogrulama(
          `Bu satış ${pavoTl(kuru.genelToplam).toFixed(2)} ₺ — ${sinir.yil} fatura düzenleme sınırı ` +
            `${pavoTl(sinir.tutar).toFixed(2)} ₺. Fiş yetmez; "Fatura iste" ile alıcı bilgisini girin.`,
        );
      }
    }

    let istek: ReturnType<typeof pavoSatisIstegi>;
    try {
      istek = pavoSatisIstegi({
        ...{ uygulamaAdi: uygulama(baglam.vt).RefererApp, uygulamaSurumu: URUN_SURUMU },
        siparisNo: uuid(),
        kartOkumaSn: kartOkumaSn(baglam.vt),
        kalemler: kuru.detay.kalemler.map((k) => ({
          ad: k.urun_adi,
          miktar: k.miktar,
          birimTipi: k.birim_tipi as 'ADET' | 'KG' | 'LT',
          birimFiyat: k.birim_fiyat,
          brut: k.satir_toplam + k.iskonto,
          iskonto: k.iskonto,
          kdvOrani: k.kdv_orani,
          urunId: k.urun_id,
          barkod: k.barkod,
        })),
        musteri: girdi.fatura ? faturaAlicisiPartisi(girdi.fatura) : null,
      });
    } catch (hata) {
      throw hatalar.dogrulama(metin(hata));
    }
    const siparisNo = String(istek.govde.OrderNo);
    // Faturalı satışta e-posta yazıldıysa belgeyi Pavo alıcıya da gönderir (e-Arşiv'in teslim yolu).
    const faturaEpostasi = girdi.fatura?.eposta?.trim();
    if (faturaEpostasi) {
      istek.govde.SendEMailNotification = true;
      istek.govde.NotificationEMail = faturaEpostasi;
    }
    if (istek.toplam !== kuru.genelToplam) {
      throw hatalar.dogrulama('Sepet tutarı Pavo için hesaplanan tutarla tutmuyor; satış gönderilmedi.');
    }

    defterYaz(baglam.vt, {
      siparis_no: siparisNo,
      tutar: kuru.genelToplam,
      ozet: ozet(kuru, girdi.odemeler ?? []),
      girdi: JSON.stringify(hamGirdi),
      kullanici_id: aktor.kullaniciId,
    });

    // 1) Sepet cihaza: satış başlar ve askıya alınır.
    let satis: PavoSatisi;
    try {
      const y = await gonder(baglam, '/StartSaleWithItems', {
        input: istek.govde,
        zamanAsimiMs: 60_000,
      });
      if (y.hata) {
        // 204: işlem yapılmış olabilir; 129: bu sipariş zaten geçmiş → sonucu getir.
        if (y.kod === 204 || y.kod === 129) {
          const ara = await satisAra(baglam, siparisNo);
          if (ara.durum !== 'BULUNDU') throw new PavoCihazHatasi(y);
          satis = ara.satis;
        } else {
          defterKapat(baglam.vt, siparisNo, 'BASARISIZ', { hata: pavoHataMetni(y) });
          throw hatalar.dogrulama(pavoHataMetni(y));
        }
      } else satis = pavoSatisiCoz(y.veri);
    } catch (hata) {
      if (hata instanceof PavoTasimaHatasi && hata.islenmisOlabilir) {
        // Cevap kayıp — cihaz işlemi yapmış olabilir. Gerçeği sor.
        const ara = await satisAra(baglam, siparisNo);
        if (ara.durum === 'BULUNDU') satis = ara.satis;
        else if (ara.durum === 'YOK') {
          defterKapat(baglam.vt, siparisNo, 'BASARISIZ', { hata: hata.message });
          throw hatalar.dogrulama("Pavo'dan cevap alınamadı; cihazda bu satışın izi yok. Güvenle tekrar deneyin.");
        } else {
          defterNotu(baglam.vt, siparisNo, hata.message);
          throw hatalar.dogrulama(`${hata.message} Satışın akıbeti öğrenilemedi; Pavo bağlanınca kendiliğinden çözülecek.`);
        }
      } else if (hata instanceof PavoTasimaHatasi || hata instanceof PavoCihazHatasi) {
        defterKapat(baglam.vt, siparisNo, 'BASARISIZ', { hata: hata.message });
        throw hatalar.dogrulama(hata.message);
      } else throw hata;
    }
    defterSatisNo(baglam.vt, siparisNo, satis.satisNo);
    surenSatis = { siparisNo, satisNo: satis.satisNo };

    // 2) Ödemeler, kart önce. Her biri ayrı istek; sonuncusu satışı kapatır.
    const odemeler = pavoOdemeSirasi(
      (girdi.odemeler ?? [])
        .filter((o) => typeof o.tutar === 'number' && o.tutar > 0)
        .map((o) => ({ tip: o.tip as PavoOdemeTipi, tutar: o.tutar as Kurus, alinan: (o.alinan as Kurus | undefined) ?? null })),
    );
    for (const odeme of odemeler) {
      if (pavoKapandiMi(satis)) break;
      let hataMetni: string | null = null;
      try {
        const kart = odeme.tip === 'KART';
        const y = await gonder(baglam, '/AddPaymentAndFinalizeSale', {
          input: {
            ...uygulama(baglam.vt),
            SaleNumber: satis.satisNo,
            GrossPrice: pavoTl(istek.brut),
            PaymentInformations: [pavoOdemesi(odeme)],
            SendResponseBeforePrint: true,
            ShowCreditCardMenu: false,
            SkipAmountCash: true,
            // Tek yöntemle ödemede karar kasada verilir: cihaz "tekrar dene /
            // başka yöntem" menüsünü göstermez, hata doğrudan kasaya döner.
            TryAgainOnPaymentFailure: false,
            AllowDismissCardRead: true,
            ...(kart ? { CardReadTimeout: kartOkumaSn(baglam.vt) } : {}),
          },
          zamanAsimiMs: (kart ? kartOkumaSn(baglam.vt) + 60 : 40) * 1000,
        });
        if (y.hata) hataMetni = pavoHataMetni(y);
        else satis = pavoSatisiCoz(y.veri);
      } catch (hata) {
        hataMetni = metin(hata);
      }
      if (hataMetni === null) continue;

      // Ödeme alınamadı ya da cevap kayboldu. Kör tekrar yok: cihaza sor —
      // müşteri tam o anda ödediyse satış kaydedilir, silinmez.
      const ara = await satisAra(baglam, siparisNo, 1);
      if (ara.durum === 'BULUNDU' && pavoKapandiMi(ara.satis)) {
        satis = ara.satis;
        break;
      }
      // SATIŞ CİHAZDAN DA SİLİNİR (alınmış kısmi ödemeyi cihaz iade eder).
      const silindi = await askidakiniSil(baglam, satis.satisNo, siparisNo);
      if (!silindi) {
        defterNotu(baglam.vt, siparisNo, hataMetni);
        throw hatalar.dogrulama(
          `${hataMetni} Satış Pavo'dan silinemedi, askıda kaldı. Ayarlar → POS & Yazarkasa → "Askıdaki satışlar"dan silin.`,
        );
      }
      const vazgecildi = kasiyerVazgecti;
      defterKapat(baglam.vt, siparisNo, 'BASARISIZ', { hata: vazgecildi ? 'Kasiyer ödemeden vazgeçti.' : hataMetni });
      throw hatalar.dogrulama(
        vazgecildi
          ? "Ödemeden vazgeçildi — satış Pavo'dan silindi, müşteriden para alınmadı."
          : `${hataMetni} Satış Pavo'dan silindi; müşteriden para alınmadı. Yeniden deneyin.`,
      );
    }

    // 3) Son cevap yerine satışın NİHAİ hâli sorulur (kart reddinden sonra
    //    cihazda yapılan yöntem değişikliği cevaba her zaman yansımıyor).
    const son = await satisAra(baglam, siparisNo, 1);
    if (son.durum === 'BULUNDU') satis = son.satis;
    if (!pavoKapandiMi(satis)) {
      // Ödeme alındığı hâlde cihaz kalan diyor — satış yarım bırakılmaz.
      const silindi = await askidakiniSil(baglam, satis.satisNo, siparisNo);
      if (silindi) defterKapat(baglam.vt, siparisNo, 'BASARISIZ', { hata: 'Cihaz ödemenin tamamını almadı.' });
      else defterNotu(baglam.vt, siparisNo, 'Cihaz ödemenin tamamını almadı; silinemedi.');
      throw hatalar.dogrulama(
        `Pavo ödemenin tamamını almadı (kalan ${pavoTl(pavoKalanTutar(satis)).toFixed(2)} ₺). ` +
          (silindi
            ? 'Satış silindi, alınan iade edildi. Yeniden deneyin.'
            : 'Satış askıda kaldı; Ayarlar → POS & Yazarkasa sekmesinden silin.'),
      );
    }

    // 4) Kayıt. Yazılamazsa cihazdaki satış İPTAL edilir (para iade).
    try {
      const sonuc = satisiKaydet(baglam, aktor, girdi, siparisNo, satis);
      return {
        ...sonuc,
        pos: { onaylandi: true, referans: satis.satisNo, onay_kodu: pavoFaturaNo(satis) || null },
        // Faturalı satışta kasiyere fatura no gösterilir; belge gecikmeli oluşabilir (no boş kalır).
        eBelge: girdi.fatura ? { no: pavoFaturaNo(satis), sorguLinki: satis.sorguLinki || null } : null,
      };
    } catch (kayitHatasi) {
      try {
        await cihazdaIptal(baglam, satis.satisNo, 'Kasa kaydı yazılamadı');
        defterKapat(baglam.vt, siparisNo, 'BASARISIZ', { hata: metin(kayitHatasi) });
      } catch {
        // İptal de olmadı: kayıt AÇIK kalır, kurtarma satışı defterdeki girdiden oluşturacak.
        defterNotu(baglam.vt, siparisNo, `Kayıt yazılamadı: ${metin(kayitHatasi)}`);
        throw hatalar.dogrulama(
          `Ödeme Pavo'da alındı ama satış kaydedilemedi ve Pavo'da iptal edilemedi (${metin(kayitHatasi)}). ` +
            'Satış kaybolmadı: Pavo bağlıyken "Yarım kalan satışları çöz" ile kayda geçirin.',
        );
      }
      throw hatalar.dogrulama(
        `Satış kaydedilemedi; Pavo'daki satış iptal edildi, müşteriden para alınmadı. (${metin(kayitHatasi)})`,
      );
    }
  } finally {
    satisSuruyor = false;
    surenSatis = null;
  }
}

// ---------------------------------------------------------------------------
// Kurtarma
// ---------------------------------------------------------------------------

/**
 * Açık defter kayıtlarını cihaza sorup çözer.
 *  - Cihazda kapanmış → satış defterdeki girdiden OLUŞTURULUR (parası alınmış
 *    satış kaybolmaz).
 *  - Askıda (yarım) → cihazdan silinir: askı yok, alınmış kısmi ödemeyi cihaz
 *    iade eder; kasiyer uyarılır.
 *  - Cihazda yok → hiç ulaşmamış; kapatılır.
 *  - Öğrenilemedi (cihaz kapalı/meşgul) → AÇIK kalır, sonra tekrar denenir.
 */
export async function defteriCoz(
  baglam: Baglam,
  aktor: Aktor,
): Promise<{ olusturulan: string[]; silinen: string[]; kalan: PavoDefterKaydi[] }> {
  const olusturulan: string[] = [];
  const silinen: string[] = [];
  for (const kayit of acikDefterKayitlari(baglam.vt)) {
    const ara = await satisAra(baglam, kayit.siparis_no, 2);
    if (ara.durum === 'BELIRSIZ') continue;
    if (ara.durum === 'YOK') {
      defterKapat(baglam.vt, kayit.siparis_no, 'BASARISIZ', { hata: 'Satış cihaza hiç ulaşmamış.' });
      continue;
    }
    const satis = ara.satis;
    if (pavoKapandiMi(satis)) {
      try {
        const sonuc = satisiKaydet(baglam, aktor, JSON.parse(kayit.girdi) as PavoSatisGirdisi, kayit.siparis_no, satis);
        olusturulan.push(sonuc.fisNo);
      } catch (hata) {
        defterNotu(baglam.vt, kayit.siparis_no, `Kurtarmada kayıt yazılamadı: ${metin(hata)}`);
      }
      continue;
    }
    if (satis.durum === 11 || satis.durum === 13 || satis.durum === 7) {
      defterKapat(baglam.vt, kayit.siparis_no, 'BASARISIZ', { hata: 'Satış cihazda iptal/terk edilmiş.' });
      continue;
    }
    if (await askidakiniSil(baglam, satis.satisNo, kayit.siparis_no)) {
      defterKapat(baglam.vt, kayit.siparis_no, 'BASARISIZ', { hata: 'Yarım kalan satış cihazdan silindi.' });
      silinen.push(kayit.ozet);
    }
  }
  return { olusturulan, silinen, kalan: acikDefterKayitlari(baglam.vt) };
}

export async function pavoDefteriniCoz(baglam: Baglam, aktor: Aktor) {
  yetkiIste(aktor, 'satis.yap');
  const sonuc = await defteriCoz(baglam, aktor);
  return {
    olusturulan: sonuc.olusturulan,
    silinen: sonuc.silinen,
    kalan: sonuc.kalan.map((k) => ({ ozet: k.ozet, hata: k.hata })),
  };
}

// ---------------------------------------------------------------------------
// İptal ve iade
// ---------------------------------------------------------------------------

/**
 * Satış iptali. Pavo'dan geçmiş satışta cihaz ödemeleri ÖDENDİĞİ GİBİ iade
 * eder (kart karta, nakit nakde) ve belgeyi iptal eder; para yolu seçimi
 * yoktur. Pavo öncesi satış (eşleşmesi yok) eskisi gibi iptal edilir.
 */
export async function pavoIleSatisIptal(baglam: Baglam, aktor: Aktor, satisId: string, neden: string): Promise<boolean> {
  const kayit = pavoSatisiBul(baglam.vt, satisId);
  if (!kayit) return false;
  kuruSonuc(baglam.vt, () => satisIptal(baglam, aktor, satisId, neden));
  const iptal = await pavoCagri(() => cihazdaIptal(baglam, kayit.satis_no, neden.slice(0, 100)));
  try {
    satisIptal(baglam, aktor, satisId, neden, undefined, { referans: iptal.satisNo || kayit.satis_no });
  } catch (hata) {
    throw hatalar.dogrulama(
      `Satış Pavo'da iptal edildi (ödemeler iade edildi) ama kasada kaydedilemedi: ${metin(hata)}. Aynı iptali Pavo'da tekrar YAPMAYIN, yöneticiye bildirin.`,
    );
  }
  return true;
}

/**
 * Kısmi iade (`PartialReturn`). Cihaz, iade edilen kalemleri orijinal satışın
 * kalem kimlikleriyle ister; bunlar satış anında `pavo_satislari`na yazılmıştı.
 */
export async function pavoIleIade(baglam: Baglam, aktor: Aktor, hamGirdi: unknown): Promise<SatisSonucu | null> {
  const girdi = (hamGirdi ?? {}) as { kaynak_satis_id?: string; iade_yontemi?: string; kalemler?: { satis_kalemi_id: string }[] };
  const kayit = girdi.kaynak_satis_id ? pavoSatisiBul(baglam.vt, girdi.kaynak_satis_id) : null;
  if (!kayit) return null;

  const kuru = kuruSonuc(baglam.vt, () => iadeYap(baglam, aktor, hamGirdi));
  const kaynakKalemler = new Map(kalemleriGetir(baglam.vt, kayit.satis_id).map((k) => [k.id, k]));
  const eslesme = new Map(kayit.kalemler.map((e) => [e.satis_kalemi_id, e.pavo_kalem_id]));

  // İade kalemleri girdi sırasıyla yazılır (sira = girdideki konum).
  const kalemler = kuru.detay.kalemler.map((iadeKalemi, i) => {
    const kaynakId = girdi.kalemler?.[i]?.satis_kalemi_id ?? '';
    const kaynak = kaynakKalemler.get(kaynakId);
    const pavoKalemId = eslesme.get(kaynakId);
    if (!kaynak || !pavoKalemId) throw hatalar.dogrulama('Bu satışın Pavo kalem bilgisi eksik; kısmi iade cihazdan yapılamıyor.');
    const tutar = Math.abs(iadeKalemi.satir_toplam);
    const miktar = Math.abs(iadeKalemi.miktar) / 1000;
    return {
      RelatedSaleItemId: pavoKalemId,
      ReturnAmount: pavoTl(tutar),
      Name: kaynak.urun_adi,
      ItemQuantity: miktar,
      UnitPriceAmount: pavoTl(kaynak.birim_fiyat),
      GrossPriceAmount: pavoTl(tutar),
      TotalPriceAmount: pavoTl(tutar),
      TaxGroupCode: pavoVergiKodu(kaynak.kdv_orani),
      VATRate: kaynak.kdv_orani,
      IsGeneric: false,
    };
  });
  const toplam = Math.abs(kuru.genelToplam);
  const yontem = (girdi.iade_yontemi ?? 'NAKIT') as PavoOdemeTipi;

  const y = await pavoCagri(() =>
    gonderVeyaFirlat(baglam, '/PartialReturn', {
      input: {
        ...uygulama(baglam.vt),
        RelatedSaleId: kayit.pavo_id,
        AddedSaleItems: kalemler,
        PaymentInformations: [pavoOdemesi({ tip: yontem, tutar: toplam })],
        OrderNo: uuid(),
        SendResponseBeforePrint: true,
        ShowCreditCardMenu: false,
        SkipAmountCash: true,
        TryAgainOnPaymentFailure: false,
        CardReadTimeout: kartOkumaSn(baglam.vt),
      },
      zamanAsimiMs: (kartOkumaSn(baglam.vt) + 60) * 1000,
    }),
  );
  const iade = pavoSatisiCoz(y.veri);
  try {
    return iadeYap(baglam, aktor, hamGirdi, { referans: iade.satisNo, onay_kodu: pavoFaturaNo(iade) || null });
  } catch (hata) {
    throw hatalar.dogrulama(
      `İade Pavo'da yapıldı (${pavoTl(toplam).toFixed(2)} ₺) ama kasada kaydedilemedi: ${metin(hata)}. Aynı iadeyi Pavo'da tekrar YAPMAYIN, yöneticiye bildirin.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Askıdakiler ve gün sonu
// ---------------------------------------------------------------------------

export async function pavoAskidakiler(baglam: Baglam, aktor: Aktor) {
  yetkiIste(aktor, 'satis.yap');
  const y = await pavoCagri(() => gonder(baglam, '/ListPendingSaleWithDetail', { zamanAsimiMs: KISA_MS }));
  if (y.hata) {
    // "NoPendingSales" bir hata değil, boş liste.
    if (y.kodMetni === 'NoPendingSales') return [];
    throw hatalar.dogrulama(pavoHataMetni(y));
  }
  const liste = Array.isArray(y.veri?.Sales) ? (y.veri!.Sales as Record<string, unknown>[]) : [];
  return liste.map((s) => {
    const satis = pavoSatisiCoz(s);
    return {
      satisNo: satis.satisNo,
      siparisNo: satis.siparisNo,
      toplam: satis.toplam,
      kalan: pavoKalanTutar(satis),
      durum: satis.durum,
    };
  });
}

export async function pavoAskidakiniSil(baglam: Baglam, aktor: Aktor, satisNo: string): Promise<{ silindi: boolean }> {
  yetkiIste(aktor, 'satis.iptal');
  return { silindi: await askidakiniSil(baglam, satisNo, '') };
}

/**
 * BANKA gün sonu (ödeme aracısının batch'i). MALİ gün sonu (Z) değildir;
 * kapanışta ikisi de alınır. Başarı zarftan değil `EodResult` içinden okunur.
 * Girdi anahtarı `Sale` — evet, gün sonunda bile (cihaz 175 ile bunu istiyor).
 */
export async function pavoBankaGunSonu(baglam: Baglam, aktor: Aktor): Promise<{ basarili: boolean; ayrintilar: string[] }> {
  yetkiIste(aktor, 'kasa.kapat');
  const y = await pavoCagri(() =>
    gonderVeyaFirlat(baglam, '/PerformBatchEod', { input: { AdditionalInfo: {} }, zamanAsimiMs: 120_000 }),
  );
  const sonuclar = Array.isArray(y.veri?.EodResult) ? (y.veri!.EodResult as Record<string, unknown>[]) : [];
  if (sonuclar.length === 0) return { basarili: true, ayrintilar: ['Banka gün sonu tamamlandı.'] };
  return {
    basarili: sonuclar.every((r) => r.IsSucceeded === true),
    ayrintilar: sonuclar.map(
      (r) => `Araç ${String(r.MediatorId)}: ${r.IsSucceeded === true ? 'başarılı' : String(r.ErrorMessage ?? 'başarısız')}`,
    ),
  };
}

// ---------------------------------------------------------------------------
// Mali raporlar (X, gün sonu, dönem, arşiv)
// ---------------------------------------------------------------------------
//
// İki ayrı "gün sonu" var, karıştırılmamalı: BANKA gün sonu kart ödemelerini
// bankaya gönderir (tekrar alınabilir); MALİ gün sonu (Z) günü kapatır (geri
// alınamaz). Rapor kuralları Cybele'den: X, dönem ve geçmiş Z raporları
// `QueryReport` ile alınır ve günü KAPATMAZ; gün sonu yalnız `pavoGunSonu`.

/** Rapor üretip fişe basmak gün sonuyla aynı mertebede sürebilir. */
const RAPOR_MS = 120_000;

/** Cihazın 175 cevabındaki "Bu servis için input key: X" ipucu. */
const GIRDI_IPUCU = /input key\s*:?\s*([A-Za-z]\w*)/i;

/**
 * Rapor isteği. Doküman alanları gövdenin ÜST seviyesinde gösteriyor; cihaz
 * `PerformBatchEod`'da olduğu gibi 175 ile başka bir girdi anahtarı isterse
 * ipucunu kendi mesajından okuyup bir kez daha denenir — tahminle ikinci bir
 * yol yazmaktansa cihaza sormak.
 */
async function raporGonder(baglam: Baglam, yol: string, alanlar: Record<string, unknown>, zamanAsimiMs = RAPOR_MS) {
  const y = await gonder(baglam, yol, { ust: alanlar, zamanAsimiMs });
  if (!y.hata || y.kod !== 175) return y;
  const anahtar = GIRDI_IPUCU.exec(y.mesaj)?.[1];
  return anahtar ? gonder(baglam, yol, { input: alanlar, inputKey: anahtar, zamanAsimiMs }) : y;
}

/** "Böyle bir rapor yok" bir hata değil, boş cevaptır. */
function raporYokMu(y: PavoYaniti): boolean {
  return y.hata && y.kodMetni === 'ReportNotFound';
}

function raporVeyaFirlat(y: PavoYaniti): PavoYaniti {
  if (y.hata) throw hatalar.dogrulama(pavoHataMetni(y));
  return y;
}

function ilkRapor(y: PavoYaniti, tur: PavoRaporTuru): PavoRaporu | null {
  const r = pavoRaporlariCoz(y.veri)[0];
  return r ? { ...r, tur } : null;
}

const GUN_KALIBI = /^\d{4}-\d{2}-\d{2}$/;

function gunDogrula(gun: unknown, ad: string): string {
  if (typeof gun !== 'string' || !GUN_KALIBI.test(gun)) throw hatalar.dogrulama(`${ad} geçerli bir tarih değil.`);
  if (gunFarki(gun, bugun()) < 0) throw hatalar.dogrulama(`${ad} ileri bir tarih olamaz.`);
  return gun;
}

/**
 * X raporu (ya da X fark): o ana kadarki özet, cihazda basılır. Günü
 * KAPATMAZ; istendiği kadar alınabilir.
 */
export async function pavoXRaporu(baglam: Baglam, aktor: Aktor, girdi: { fark?: boolean }): Promise<PavoRaporu | null> {
  // Kasayı kapatan kişi (kasiyer) gün içinde X alabilmeli; geçmiş raporlar müdürün.
  yetkiIste(aktor, 'kasa.kapat');
  const fark = girdi?.fark === true;
  const y = await pavoCagri(() =>
    raporGonder(baglam, '/QueryReport', { ReportData: { ReportType: fark ? 'XDiffReport' : 'XReport', PrintReport: true } }),
  );
  return ilkRapor(raporVeyaFirlat(y), fark ? 'XFARK' : 'X');
}

/**
 * Dönem (aylık) satış raporu — mali müşavirin istediği. Günü KAPATMAZ:
 * var olan satışları özetler. Cihaz en fazla 12 ay geriye izin veriyor;
 * boşuna istek atmaktansa burada söylenir.
 */
export async function pavoDonemRaporu(
  baglam: Baglam,
  aktor: Aktor,
  girdi: { baslangic: string; bitis: string; bastir?: boolean },
): Promise<PavoRaporu | null> {
  yetkiIste(aktor, 'rapor.goruntule');
  const baslangic = gunDogrula(girdi?.baslangic, 'Başlangıç');
  const bitis = gunDogrula(girdi?.bitis, 'Bitiş');
  if (gunFarki(baslangic, bitis) < 0) throw hatalar.dogrulama('Bitiş tarihi başlangıçtan önce olamaz.');
  if (gunFarki(baslangic, bugun()) > 366) throw hatalar.dogrulama('Dönem raporu en fazla 12 ay geriye alınabilir.');
  const y = await pavoCagri(() =>
    raporGonder(baglam, '/QueryReport', {
      ReportData: {
        ReportType: 'TeminalDateRangeSaleReport',
        StartDate: baslangic,
        EndDate: bitis,
        PrintReport: girdi.bastir === true,
      },
    }),
  );
  return ilkRapor(raporVeyaFirlat(y), 'DONEM');
}

/**
 * Geçmiş bir günün gün sonu raporu. Yeni rapor OLUŞTURMAZ, günü kapatmaz.
 * O gün gün sonu alınmadıysa null.
 */
export async function pavoGecmisGunSonu(
  baglam: Baglam,
  aktor: Aktor,
  girdi: { tarih: string; bastir?: boolean },
): Promise<PavoRaporu | null> {
  yetkiIste(aktor, 'rapor.goruntule');
  const tarih = gunDogrula(girdi?.tarih, 'Tarih');
  const y = await pavoCagri(() =>
    raporGonder(baglam, '/QueryReport', {
      ReportData: { ReportType: 'ZReportWithDateTime', ReportDate: tarih, PrintReport: girdi.bastir === true },
    }),
  );
  if (raporYokMu(y)) return null;
  return ilkRapor(raporVeyaFirlat(y), 'GUN_SONU');
}

/**
 * Cihazın rapor arşivi, en yeni üstte. Aralık cihazda en fazla 31 gün.
 * Satırlar kırılım taşımaz — ayrıntı `pavoRaporOzeti` ile istenir.
 */
export async function pavoRaporArsivi(
  baglam: Baglam,
  aktor: Aktor,
  girdi: { baslangic: string; bitis: string },
): Promise<PavoRaporu[]> {
  yetkiIste(aktor, 'rapor.goruntule');
  const baslangic = gunDogrula(girdi?.baslangic, 'Başlangıç');
  const bitis = gunDogrula(girdi?.bitis, 'Bitiş');
  if (gunFarki(baslangic, bitis) < 0) throw hatalar.dogrulama('Bitiş tarihi başlangıçtan önce olamaz.');
  if (gunFarki(baslangic, bitis) > 31) throw hatalar.dogrulama('Rapor arşivi en fazla 31 günlük aralık için listelenebilir.');
  const y = await pavoCagri(() => raporGonder(baglam, '/ListReports', { StartDate: baslangic, EndDate: bitis }, KISA_MS));
  // Aynı rapor iki kez gelirse ekranda iki satır olur; rapor kimliği benzersiz.
  const gorulen = new Set<number>();
  return pavoRaporlariCoz(raporVeyaFirlat(y).veri)
    .filter((r) => !gorulen.has(r.raporId) && gorulen.add(r.raporId))
    .sort((a, b) => b.raporId - a.raporId);
}

/** Bir raporun ödeme/KDV/belge/ürün kırılımı. Rapor yoksa null. */
export async function pavoRaporOzeti(baglam: Baglam, aktor: Aktor, raporId: number): Promise<PavoRaporu | null> {
  yetkiIste(aktor, 'rapor.goruntule');
  if (!Number.isInteger(raporId) || raporId <= 0) throw hatalar.dogrulama('Geçersiz rapor.');
  const y = await pavoCagri(() => raporGonder(baglam, '/GetReportSummaries', { ReportId: raporId }, KISA_MS));
  if (raporYokMu(y)) return null;
  return pavoRaporlariCoz(raporVeyaFirlat(y).veri)[0] ?? null;
}

/** Var olan bir raporun NÜSHASINI cihazda basar. Yeni rapor oluşturmaz; Z nüshası günü ikinci kez kapatmaz. */
export async function pavoRaporNushasi(baglam: Baglam, aktor: Aktor, raporId: number): Promise<{ basildi: true }> {
  yetkiIste(aktor, 'rapor.goruntule');
  if (!Number.isInteger(raporId) || raporId <= 0) throw hatalar.dogrulama('Geçersiz rapor.');
  raporVeyaFirlat(await pavoCagri(() => raporGonder(baglam, '/PrintReport', { ReportId: raporId })));
  return { basildi: true };
}

/**
 * MALİ GÜN SONU (Z). GERİ ALINAMAZ.
 *
 * Sahada doğrulandı (Cybele, 31 Ağustos 2026): `CreateReport` + `ZReport`
 * gün sonu ALMIYOR; gerçek karşılığı `CreateReportWithSummaries` + `T`
 * (cihaz menüsündeki "Terminal Satış Raporu"). Saha bilgisi dokümanı ezer.
 *
 * `bankaGunSonu` ile önce banka gün sonu alınır: o tekrar denenebilir, Z
 * değil — sorun çıkarsa mali gün kapatılmamış kalır.
 */
export async function pavoGunSonu(
  baglam: Baglam,
  aktor: Aktor,
  girdi: { bankaGunSonu?: boolean },
): Promise<{ rapor: PavoRaporu | null; banka: { basarili: boolean; ayrintilar: string[] } | null }> {
  yetkiIste(aktor, 'kasa.kapat');
  let banka: { basarili: boolean; ayrintilar: string[] } | null = null;
  if (girdi?.bankaGunSonu === true) {
    banka = await pavoBankaGunSonu(baglam, aktor);
    if (!banka.basarili) {
      throw hatalar.dogrulama(
        `Banka gün sonu sorunlu, gün sonu (Z) ALINMADI.\n${banka.ayrintilar.join('\n')}\nSorunu giderip tekrar deneyin ya da yalnız Z alın.`,
      );
    }
  }
  const y = await pavoCagri(() => raporGonder(baglam, '/CreateReportWithSummaries', { ReportType: 'T' }));
  const rapor = ilkRapor(raporVeyaFirlat(y), 'GUN_SONU');
  if (!rapor) return { rapor: null, banka };
  // Özet Z numarasını taşımayabilir; arşiv satırı taşır. Gece yarısından sonra
  // alınan gün sonu dünün tarihine düşebilir → dün de taranır. Rapor ALINDI;
  // arşiv okunamazsa yalnız numara eksik kalır.
  try {
    const satirlar = await pavoRaporArsivi(baglam, aktor, { baslangic: gunEkle(bugun(), -1), bitis: bugun() });
    const satir = satirlar.find((s) => s.raporId === rapor.raporId);
    return { rapor: satir ? pavoRaporBirlestir(rapor, satir) : rapor, banka };
  } catch {
    return { rapor, banka };
  }
}

/** Durum: arayüz akışı buna göre değişir (her satış cihaza gider). */
export function pavoDurumu(baglam: Baglam): { acik: boolean; adres: string; seriNo: string; acikKayit: number; zaman: string } {
  return {
    acik: pavoAcikMi(baglam),
    adres: ayarMetin(baglam.vt, AYAR.POS_ADRES, ''),
    seriNo: ayarMetin(baglam.vt, PAVO_AYAR.SERI_NO, ''),
    acikKayit: acikDefterKayitlari(baglam.vt).length,
    zaman: simdi(),
  };
}
