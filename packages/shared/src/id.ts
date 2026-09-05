/**
 * Kimlik üretimi.
 *
 * Tüm birincil anahtarlar UUID'dir (§8.5): farklı cihazlarda üretilen kayıtlar
 * çakışmadan buluta gider, senkron için merkezi numaratör gerekmez.
 */

/** RFC 4122 v4 UUID. */
export function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (c && typeof c.getRandomValues === 'function') {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
    b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  throw new Error('Kriptografik rastgelelik kaynağı bulunamadı');
}

export function uuidMi(deger: unknown): deger is string {
  return typeof deger === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deger);
}

/**
 * Fiş numarası: `{seri}-{sıra}` (ör. "A-000512").
 * Seri harfi cihaza özeldir; böylece çok kasalı kurulumda numaralar çakışmaz.
 */
export function fisNo(seri: string, sira: number): string {
  return `${seri}-${String(sira).padStart(6, '0')}`;
}

/** Cihaz kimliğinden kararlı bir seri harfi türetir ("kasa-01" → "A"). */
export function seriHarfi(cihazId: string): string {
  let toplam = 0;
  for (let i = 0; i < cihazId.length; i++) toplam = (toplam * 31 + cihazId.charCodeAt(i)) >>> 0;
  return String.fromCharCode(65 + (toplam % 26));
}

// ---------------------------------------------------------------------------
// Barkod (§13.1)
// ---------------------------------------------------------------------------

/** EAN-8 / EAN-13 kontrol hanesini hesaplar. */
export function eanKontrolHanesi(rakamlar: string): number {
  let toplam = 0;
  // Sağdan sola: son haneden başlayarak 3,1,3,1... ağırlık
  const ters = rakamlar.split('').reverse();
  for (let i = 0; i < ters.length; i++) {
    const d = Number(ters[i]);
    toplam += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (toplam % 10)) % 10;
}

/** EAN-8 / EAN-13 barkodunun kontrol hanesini doğrular. */
export function eanGecerliMi(barkod: string): boolean {
  if (!/^\d{8}$|^\d{13}$/.test(barkod)) return false;
  const govde = barkod.slice(0, -1);
  const kontrol = Number(barkod.slice(-1));
  return eanKontrolHanesi(govde) === kontrol;
}

/**
 * Barkodsuz ürünler için mağaza içi (in-store) EAN-13 üretir.
 * GS1'de 20-29 önekleri mağaza içi kullanıma ayrılmıştır; varsayılan "29".
 */
export function icBarkodUret(sira: number, onek = '29'): string {
  if (!/^2\d$/.test(onek)) throw new RangeError('İç barkod öneki 20-29 aralığında olmalıdır');
  const govde = onek + String(sira % 10_000_000_000).padStart(10, '0');
  return govde + String(eanKontrolHanesi(govde));
}

/**
 * Okuyucudan gelen ham barkodu normalize eder: boşluk/kontrol karakterlerini atar,
 * EAN-13'e sıfırla doldurulmuş UPC-A (12 hane) girdisini 13 haneye tamamlar.
 */
/** Terazinin bastığı barkoddan çıkan bilgi (§10.1). */
export interface TartiliBarkod {
  /** Ürünü bulmak için kullanılan önek: ön ek + ürün kodu (7 hane). */
  urunOneki: string;
  /** Barkoda gömülü değer ağırlık mı, tutar mı? */
  tip: 'AGIRLIK' | 'TUTAR';
  /** AGIRLIK → bindebir (1 g = 1 bindebir kg). TUTAR → kuruş. */
  deger: number;
}

/**
 * Terazi barkodunu çözer (§10.1).
 *
 * Şarküteri, manav ve kasap reyonundaki teraziler ürünü tartıp kendi barkodunu
 * basar. Bu barkod bir ÜRÜN KİMLİĞİ DEĞİLDİR: içine o tartımın ağırlığı ya da
 * tutarı gömülüdür, yani her tartımda farklıdır. Doğrudan aranırsa hiçbir zaman
 * bulunamaz — reyonu olan bir markette o ürünler kasadan geçemez.
 *
 * Yapı (EAN-13): `PP IIIII VVVVV C`
 *   PP    → ön ek (mağaza içi aralık; Türkiye'de yaygın olarak 27 ve 28)
 *   IIIII → ürün kodu (terazide tanımlı PLU)
 *   VVVVV → gömülü değer: gram ya da kuruş
 *   C     → EAN kontrol hanesi
 *
 * Ön ekler AYARDAN gelir çünkü hangi ön ekin ağırlık hangisinin tutar taşıdığı
 * terazinin yapılandırmasına bağlıdır; sabit varsaymak yanlış fiyat üretir.
 */
export function tartiliBarkodCoz(
  ham: string,
  secenekler: { agirlikOnekleri?: readonly string[]; tutarOnekleri?: readonly string[] } = {},
): TartiliBarkod | null {
  const barkod = barkodNormalize(ham);
  if (barkod.length !== 13 || !/^\d{13}$/.test(barkod)) return null;

  const agirlik = secenekler.agirlikOnekleri ?? ['28'];
  const tutar = secenekler.tutarOnekleri ?? ['27'];
  const onek = barkod.slice(0, 2);

  const tip: 'AGIRLIK' | 'TUTAR' | null = agirlik.includes(onek) ? 'AGIRLIK' : tutar.includes(onek) ? 'TUTAR' : null;
  if (!tip) return null;

  // Kontrol hanesi tutmuyorsa bu bir okuma hatasıdır; yanlış ağırlıkla satış
  // yapmaktansa hiç çözmemek doğrudur.
  if (!eanGecerliMi(barkod)) return null;

  const deger = Number(barkod.slice(7, 12));
  if (!Number.isFinite(deger) || deger <= 0) return null;

  return { urunOneki: barkod.slice(0, 7), tip, deger };
}

/**
 * Kısa kod (PLU) mu? (§10.1)
 *
 * Markette ürünlerin çoğunun barkodu YOKTUR: manav, şarküteri, ekmek, açık
 * ürünler. Bunlar için kasiyerin ürün adı yazıp listeden seçmesi gerekir ve
 * bu, sıradaki müşteriyi bekleten en pahalı adımdır. Standart çözüm kısa
 * koddur: ürüne 2-4 haneli bir numara verilir, kasiyer onu yazıp Enter'lar.
 *
 * Kısa kod ayrı bir alan DEĞİL, kısa bir barkoddur — böylece okutma yolu,
 * arama ve satış tarafı hiç değişmez, tek fark uzunluktur. Gerçek barkodlar
 * en az 8 hanedir (EAN-8), bu yüzden 2-5 hane çakışmadan ayrılabilir. Tek hane
 * bilinçli olarak dışarıdadır: kazara basmak fazla kolaydır.
 */
export function kisaKodMu(barkod: string): boolean {
  return /^\d{2,5}$/.test(barkod.trim());
}

/** Barkod listesindeki ilk kısa kodu döndürür; yoksa null. */
export function kisaKodBul(barkodlar: readonly string[]): string | null {
  return barkodlar.find((b) => kisaKodMu(b)) ?? null;
}

export function barkodNormalize(ham: string): string {
  const temiz = ham.trim().replace(/[\s\r\n\t]/g, '');
  if (/^\d{12}$/.test(temiz)) return '0' + temiz;
  return temiz;
}

// ---------------------------------------------------------------------------
// Belge numaraları
// ---------------------------------------------------------------------------

export function belgeNo(onek: string, sira: number, hane = 6): string {
  return `${onek}-${String(sira).padStart(hane, '0')}`;
}

/**
 * Fiş numarasını karşılaştırma için sadeleştirir: harf+rakam dışındaki her şey
 * atılır, büyük harfe çevrilir. "A-000512" → "A000512"
 *
 * NEDEN GEREKLİ: HID barkod okuyucular tuş kodu gönderir, karakter değil. Türkçe Q
 * klavye düzeninde ABD düzenindeki `-` tuşunun yerinde `*` vardır; okuyucu ABD
 * düzenine göre ayarlıysa "A-000512" fişi "A*000512" olarak okunur. Ayraçları yok
 * sayarak karşılaştırmak bu farkı ve kullanıcının elle yazdığı boşluk/tire
 * varyasyonlarını birlikte çözer.
 */
export function fisNoSadelestir(ham: string): string {
  return ham.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/** Kısa, insan tarafından okunabilir izleme kimliği (log korelasyonu, §19.1). */
export function izlemeId(onek = 'iz'): string {
  return `${onek}_${uuid().replace(/-/g, '').slice(0, 16)}`;
}

/**
 * Satış ekranındaki "3*barkod" / "3 x barkod" adet girişini ayrıştırır (§10.3).
 *
 * Ayrı bir fonksiyon olmasının sebebi tarihsel bir hata: çarpan eskiden React
 * durumuna yazılıp barkod HEMEN ardından işleniyordu; durum güncellemesi
 * asenkron olduğu için işleyici eski değeri (çarpansız) okuyor ve "3*x" tek
 * adet ekliyordu. Çarpanı burada ayrıştırıp çağırana DEĞER olarak vermek o
 * yarışı yapısal olarak imkânsız kılar.
 */
export function carpanAyikla(ham: string): { carpan: number | null; kalan: string } {
  const metin = ham.trim();
  // Ayırıcıdan sonrası BOŞ olabilir: "3*" tek başına da geçerli bir giriştir —
  // kasiyer çarpanı önden kurar, ürünü sonra seçer (barkod okutur ya da hızlı
  // ürün karesine basar). Bu yüzden kalan `(.*)`, `(.+)` değil.
  const eslesme = metin.match(/^(\d{1,3})\s*[x*]\s*(.*)$/i);
  if (!eslesme) return { carpan: null, kalan: metin };

  const carpan = Number(eslesme[1]);
  // 0 ile çarpmak anlamsızdır; ham metin olduğu gibi geçer.
  if (!Number.isFinite(carpan) || carpan <= 0) return { carpan: null, kalan: metin };
  return { carpan, kalan: (eslesme[2] ?? '').trim() };
}
