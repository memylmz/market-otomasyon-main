/**
 * Fişin GÖRÜNTÜ olarak basılması (§13.2).
 *
 * NEDEN VAR: ucuz ESC/POS yazıcıların gömülü fontları Türkçe harfleri "kod
 * sayfası" tablosundan okur ve bu tabloların numaraları üreticiden üreticiye
 * değişir. `ESC t 13` bir yazıcıda CP857 (Türkçe) seçerken ötekinde bambaşka
 * bir alfabeye denk gelir; sahada "Çiğ Köfte" yerine bozuk harfler çıkar ve
 * doğru numarayı bulmak deneme yanılmaya kalır.
 *
 * Fiş bir görüntü olarak basıldığında yazıcının fontu HİÇ devreye girmez:
 * harfleri biz çizeriz, yazıcı yalnız piksel basar. Türkçe garanti olur ve
 * yazı, yazıcının nokta fontundan daha okunaklı çıkar.
 *
 * KAYNAK YİNE BAYT AKIŞIDIR: görüntü, yazıcıya gidecek ESC/POS baytlarından
 * `EscPosYazici.onizlemeYapisi()` ile geri çözülen satır modelinden çizilir.
 * Ayrı bir "görüntü üreteci" yazılsaydı metin fişi ile görüntü fişi zamanla
 * ayrışır, biri düzeltilip öteki unutulurdu.
 */

import { code128Cizimi } from '@market/shared';
import { EscPosYazici, type FisOnizlemesi } from './escpos.js';

const ESC = 0x1b;
const GS = 0x1d;

/**
 * Tek kağıt satırındaki nokta sayısı (203 dpi termal kafa).
 *
 * 80 mm kağıt 576, 58 mm kağıt 384 nokta basar. Karar satır genişliğinden
 * verilir: ayarlarda kağıt boyutu değil "kaç karakter" tutuluyor.
 */
export function kagitNoktaGenisligi(satirGenisligi: number): number {
  return satirGenisligi <= 36 ? 384 : 576;
}

/**
 * Tek aralıklı yazıda karakter genişliğinin punto'ya oranı.
 *
 * Menlo, DejaVu Sans Mono ve Courier ailesinde 0,602 em'dir. Fişin sütunları
 * (ürün adı ile fiyatın hizalanması) boşlukla yapıldığı için yazının GERÇEKTEN
 * tek aralıklı olması ve satırın kağıda sığması şarttır; bu yüzden punto
 * ölçüden hesaplanır, sabit verilmez.
 */
const TEK_ARALIK_ORANI = 0.602;

/**
 * Boşlukla hizalanmış iki sütunlu satırı parçalarına ayırır.
 *
 * NEDEN GEREKLİ: `ikiSutun()` satırı kağıt genişliğine (48 karakter) göre
 * boşlukla doldurur. Çift puntoda kağıda yalnız 24 karakter sığar; satır
 * olduğu gibi çizilirse sağdaki TUTAR kağıt dışında kalır ve fişte TOPLAM'ın
 * rakamı hiç görünmez. Sol ve sağ parçalar ayrıldığında ikisi de sığar —
 * "TOPLAM" ve "511,15" çift puntoda bile 24 karakterin altındadır.
 */
function ikiSutunAyir(metin: string): [string, string] | null {
  const eslesme = /^(\S.*?\S|\S)\s{2,}(\S.*)$/.exec(metin);
  return eslesme ? [eslesme[1]!, eslesme[2]!] : null;
}

/** HTML'e gömülecek metni kaçırır — ürün adında `<` geçebilir. */
function kacir(metin: string): string {
  return metin.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Satır modelini, yazıcı genişliğinde bir HTML sayfasına çevirir.
 *
 * Saf fonksiyondur: aynı model her zaman aynı HTML'i verir, test edilebilir.
 * Çizim işini (HTML → piksel) Electron adaptörü yapar.
 */
export function fisHtml(onizleme: FisOnizlemesi, enNokta: number, satirGenisligi: number): string {
  // Kağıda tam oturması için punto ölçüden hesaplanır; %3 pay bırakılır ki
  // font ailesi değişirse satır sağdan taşıp kırpılmasın.
  const punto = ((enNokta / satirGenisligi) / TEK_ARALIK_ORANI) * 0.97;

  const govde = onizleme.ogeler
    .map((oge) => {
      if (oge.tip === 'bosluk') return `<div class="bos" style="height:${oge.satir * punto * 1.25}px"></div>`;
      // Kesme kağıt komutudur, çizime girmez: görüntüden sonra gerçek ESC/POS
      // komutu olarak gönderilir.
      if (oge.tip === 'kesme') return '';

      const hiza = oge.hiza === 'orta' ? 'o' : oge.hiza === 'sag' ? 'g' : 's';

      if (oge.tip === 'barkod') {
        const cizim = code128Cizimi(oge.veri);
        if (!cizim) return `<div class="${hiza}">${kacir(oge.veri)}</div>`;
        // Modül genişliği tam sayı nokta olmalı: kesirli değer termal kafada
        // çubukları eşitsiz bastırır ve okuyucu barkodu okuyamaz.
        const modul = Math.max(1, Math.floor((enNokta * 0.9) / cizim.toplamModul));
        const cubuklar = cizim.desenler
          .map((genislik, sira) => {
            const renk = sira % 2 === 0 ? '#000' : '#fff';
            return `<i style="width:${genislik * modul}px;background:${renk}"></i>`;
          })
          .join('');
        return `<div class="barkod ${hiza}"><div class="cubuklar">${cubuklar}</div><div class="hri">${kacir(cizim.metin)}</div></div>`;
      }

      const sinif = [hiza, oge.kalin ? 'k' : '', oge.altCizgi ? 'a' : '', oge.boyut > 1 ? `b${oge.boyut}` : '']
        .filter(Boolean)
        .join(' ');

      // Büyük puntoda iki sütunlu satır: sol ve sağ uçlara yaslanır, yoksa
      // sağdaki tutar kağıt dışında kalır.
      const ikili = oge.boyut > 1 ? ikiSutunAyir(oge.metin) : null;
      if (ikili) {
        return `<div class="${sinif} ikili"><span>${kacir(ikili[0])}</span><span>${kacir(ikili[1])}</span></div>`;
      }

      // Boş satır da yükseklik kaplamalı; `&nbsp;` olmadan div çöker.
      return `<div class="${sinif}">${oge.metin ? kacir(oge.metin) : '&nbsp;'}</div>`;
    })
    /*
     * ARALARINDA SATIR SONU YOK.
     *
     * Gövdede `white-space: pre` var (sütun hizası boşlukla yapıldığı için
     * şart). Öğeler `\n` ile birleştirilseydi bu satır sonları da metin
     * sayılır, her satırdan sonra bir boş satır basılır ve fiş iki katı kağıt
     * harcardı — ölçüldü: 176 mm yerine 90 mm.
     */
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#fff}
body{width:${enNokta}px;color:#000;
  font-family:Menlo,"DejaVu Sans Mono","Liberation Mono",Consolas,monospace;
  font-size:${punto.toFixed(2)}px;line-height:1.25;
  /* pre-wrap: sütun hizası için boşluklar korunur, ama kağıda sığmayan satır
     kırpılmak yerine alta sarar; yazıcının kendi davranışı da budur. */
  white-space:pre-wrap;overflow-wrap:anywhere;
  /* Yumuşatma kapalı: 1-bit'e indirilecek görüntüde gri pikseller harfleri
     soluklaştırır, termal kafada yazı cılız basar. */
  -webkit-font-smoothing:none;font-smooth:never}
.s{text-align:left}.o{text-align:center}.g{text-align:right}
.k{font-weight:700}.a{text-decoration:underline}
.b2{font-size:${(punto * 2).toFixed(2)}px;line-height:1.2}
.b3{font-size:${(punto * 3).toFixed(2)}px;line-height:1.2}
.ikili{display:flex;justify-content:space-between;gap:${punto.toFixed(0)}px}
.barkod{margin:${(punto * 0.4).toFixed(0)}px 0}
.barkod .cubuklar{display:flex;align-items:flex-end;height:${Math.round(punto * 3.5)}px;justify-content:inherit}
.barkod.o .cubuklar{justify-content:center}.barkod.g .cubuklar{justify-content:flex-end}
.barkod i{display:block;height:100%}
.barkod .hri{font-size:${(punto * 0.8).toFixed(2)}px;text-align:inherit}
</style></head><body>${govde}</body></html>`;
}

/**
 * BGRA piksellerini 1-bit siyah/beyaza indirir (satır başına paketlenmiş bit).
 *
 * Eşik altındaki parlaklık SİYAH sayılır. Termal kafa gri basamaz; ara tonlar
 * ya siyah ya beyaz olmak zorundadır.
 */
export function siyahBeyazaIndir(bgra: Uint8Array, enNokta: number, boy: number, esik = 170): Uint8Array {
  const satirBayti = Math.ceil(enNokta / 8);
  const bitler = new Uint8Array(satirBayti * boy);

  for (let y = 0; y < boy; y++) {
    for (let x = 0; x < enNokta; x++) {
      const p = (y * enNokta + x) * 4;
      // Parlaklık: gözün duyarlılığına göre ağırlıklı (BGRA sırası).
      const parlaklik = 0.114 * (bgra[p] ?? 255) + 0.587 * (bgra[p + 1] ?? 255) + 0.299 * (bgra[p + 2] ?? 255);
      if (parlaklik < esik) {
        bitler[y * satirBayti + (x >> 3)]! |= 0x80 >> (x & 7);
      }
    }
  }
  return bitler;
}

/**
 * 1-bit görüntüyü ESC/POS raster komutuna çevirir (`GS v 0`).
 *
 * ŞERİTLERE BÖLÜNÜR: birçok yazıcı tek komutta çok uzun görüntüyü ara belleğe
 * sığdıramaz ve fişi yarıda keser. 128 satırlık şeritler her modelde güvenle
 * basar; şeritler arka arkaya gönderildiğinde kağıtta kesinti görünmez.
 */
export function rasterKomutu(bitler: Uint8Array, enNokta: number, boy: number, seritYuksekligi = 128): Buffer {
  const satirBayti = Math.ceil(enNokta / 8);
  const parcalar: Buffer[] = [];

  for (let ust = 0; ust < boy; ust += seritYuksekligi) {
    const yukseklik = Math.min(seritYuksekligi, boy - ust);
    const veri = Buffer.from(bitler.subarray(ust * satirBayti, (ust + yukseklik) * satirBayti));
    parcalar.push(
      Buffer.from([
        GS,
        0x76,
        0x30,
        0x00, // m = 0: normal boyut
        satirBayti & 0xff,
        (satirBayti >> 8) & 0xff,
        yukseklik & 0xff,
        (yukseklik >> 8) & 0xff,
      ]),
      veri,
    );
  }
  return Buffer.concat(parcalar);
}

/**
 * Özgün bayt akışındaki KAĞIT komutlarını görüntünün ardına taşır.
 *
 * Kesme ve çekmece görüntünün parçası değildir; bunlar yazıcıya emirdir ve
 * görüntü basıldıktan SONRA gönderilmelidir. Fişte kesme yoksa (ör. önizleme
 * amaçlı üretilmiş bir akış) eklenmez — olmayan komutu uydurmak, kağıdı
 * beklenmedik yerde kestirir.
 */
export function kuyrukKomutlari(orijinal: Buffer): Buffer {
  const parcalar: Buffer[] = [];
  let kesmeVar = false;
  let cekmecePin: number | null = null;

  for (let i = 0; i < orijinal.length - 1; i++) {
    if (orijinal[i] === GS && orijinal[i + 1] === 0x56) kesmeVar = true;
    if (orijinal[i] === ESC && orijinal[i + 1] === 0x70) cekmecePin = orijinal[i + 2] ?? 0;
  }

  if (cekmecePin !== null) parcalar.push(Buffer.from([ESC, 0x70, cekmecePin, 25, 250]));
  if (kesmeVar) parcalar.push(Buffer.from([ESC, 0x64, 4, GS, 0x56, 1]));
  return Buffer.concat(parcalar);
}

/**
 * Görüntüyü çizen adaptörün sözleşmesi — Electron dışında sahte ile değiştirilir.
 *
 * GERÇEK ÖLÇÜ DÖNER, istenen ölçü değil: Chromium yakalanan görüntüyü birkaç
 * piksel farklı verebilir ve bit paketleme yanlış genişlikle yapılırsa her
 * satır bir miktar kayar, fiş kağıda eğri basar.
 */
export interface GorselCizici {
  (html: string, enNokta: number): Promise<{ bgra: Uint8Array; en: number; boy: number }>;
}

/**
 * Metin fişini görüntü fişine çevirir.
 *
 * Çizim başarısız olursa ÖZGÜN baytlar döner: bir render hatası satışı
 * durdurmamalı, fiş hiç çıkmamaktansa Türkçesiz çıkmalıdır (§3 "kasa asla
 * durmaz").
 */
export async function fisiGorselleStir(
  baytlar: Buffer,
  satirGenisligi: number,
  ciz: GorselCizici,
): Promise<{ baytlar: Buffer; gorsel: boolean; hata?: string }> {
  const enNokta = kagitNoktaGenisligi(satirGenisligi);
  try {
    const onizleme = EscPosYazici.onizlemeYapisi(baytlar);
    const html = fisHtml(onizleme, enNokta, satirGenisligi);
    const { bgra, en, boy } = await ciz(html, enNokta);
    if (boy <= 0 || en <= 0) throw new Error('Görüntü ölçüsü sıfır.');

    const bitler = siyahBeyazaIndir(bgra, en, boy);
    const cikti = Buffer.concat([
      Buffer.from([ESC, 0x40]), // yazıcıyı sıfırla
      rasterKomutu(bitler, en, boy),
      kuyrukKomutlari(baytlar),
    ]);
    return { baytlar: cikti, gorsel: true };
  } catch (hata) {
    return { baytlar, gorsel: false, hata: hata instanceof Error ? hata.message : String(hata) };
  }
}
