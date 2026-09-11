/**
 * ESC/POS komut üreticisi — 80 mm termal fiş yazıcıları (§13.2).
 *
 * Marka bağımsızdır: yalnız ESC/POS standardındaki temel komutlar kullanılır.
 * Türkçe karakterler **CP857 (DOS Türkçe)** kod sayfasına çevrilir; bu, piyasadaki
 * termal yazıcıların neredeyse tamamında desteklenen kod sayfasıdır.
 */

const ESC = 0x1b;
const GS = 0x1d;

export type Hizalama = 'sol' | 'orta' | 'sag';

/** Fiş önizlemesinin tek bir öğesi — kağıttaki bir satırın karşılığı. */
export type FisOgesi =
  | { tip: 'metin'; metin: string; hiza: Hizalama; kalin: boolean; altCizgi: boolean; boyut: 1 | 2 | 3 }
  | { tip: 'barkod'; veri: string; hiza: Hizalama }
  | { tip: 'bosluk'; satir: number }
  | { tip: 'kesme' };

export interface FisOnizlemesi {
  ogeler: FisOgesi[];
}

/** CP857 (Türkçe) karakter eşlemesi — yalnız ASCII dışı harfler. */
// Anahtarlar tırnak içindedir: '£' gibi para birimi simgeleri geçerli bir JS
// tanımlayıcısı değildir ve tırnaksız yazılamaz.
const CP857: Readonly<Record<string, number>> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ä: 0x84,
  à: 0x85,
  å: 0x86,
  ç: 0x87,
  ê: 0x88,
  ë: 0x89,
  è: 0x8a,
  ï: 0x8b,
  î: 0x8c,
  ı: 0x8d,
  Ä: 0x8e,
  Å: 0x8f,
  É: 0x90,
  æ: 0x91,
  Æ: 0x92,
  ô: 0x93,
  ö: 0x94,
  ò: 0x95,
  û: 0x96,
  ù: 0x97,
  İ: 0x98,
  Ö: 0x99,
  Ü: 0x9a,
  ø: 0x9b,
  '£': 0x9c,
  Ø: 0x9d,
  Ş: 0x9e,
  ş: 0x9f,
  á: 0xa0,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  Ğ: 0xa6,
  ğ: 0xa7,
};

/**
 * CP857 ters haritası — önizlemede baytı harfe çevirmek için.
 *
 * Eskiden her bayt için tablo baştan taranıyordu; uzun bir fişte bu
 * gereksiz binlerce karşılaştırma demek.
 */
const TERS_CP857 = new Map<number, string>();

/** ASCII karşılığı olmayan karakterler için sadeleştirme. */
const SADELESTIRME: Readonly<Record<string, string>> = {
  '₺': 'TL',
  '–': '-',
  '—': '-',
  '’': "'",
  '‘': "'",
  '“': '"',
  '”': '"',
  '…': '...',
};

for (const [harf, kod] of Object.entries(CP857)) TERS_CP857.set(kod, harf);

export function cp857Kodla(metin: string): Buffer {
  const baytlar: number[] = [];
  for (const karakter of metin.normalize('NFC')) {
    const sade = SADELESTIRME[karakter];
    if (sade !== undefined) {
      for (const s of sade) baytlar.push(s.charCodeAt(0) & 0x7f);
      continue;
    }
    const kod = karakter.codePointAt(0) ?? 63;
    if (kod < 0x80) {
      baytlar.push(kod);
      continue;
    }
    const eslesme = CP857[karakter];
    baytlar.push(eslesme ?? 0x3f); // bilinmeyen karakter → '?'
  }
  return Buffer.from(baytlar);
}

/**
 * ESC/POS bayt akışı oluşturucu. Akıcı (fluent) API ile fiş dizilir,
 * sonunda `bitir()` ile Buffer alınır.
 */
export class EscPosYazici {
  private readonly parcalar: Buffer[] = [];

  constructor(readonly satirGenisligi = 48) {}

  private ekle(...baytlar: (number | Buffer)[]): this {
    for (const b of baytlar) this.parcalar.push(typeof b === 'number' ? Buffer.from([b]) : b);
    return this;
  }

  /** Yazıcıyı sıfırlar ve kod sayfasını CP857'ye ayarlar. */
  baslat(): this {
    // ESC @ : initialize, ESC t 13 : select code page 13 (CP857)
    return this.ekle(ESC, 0x40, ESC, 0x74, 13);
  }

  hizala(hizalama: Hizalama): this {
    const kod = hizalama === 'orta' ? 1 : hizalama === 'sag' ? 2 : 0;
    return this.ekle(ESC, 0x61, kod);
  }

  kalin(acik: boolean): this {
    return this.ekle(ESC, 0x45, acik ? 1 : 0);
  }

  altCizgi(acik: boolean): this {
    return this.ekle(ESC, 0x2d, acik ? 1 : 0);
  }

  /** 1 = normal, 2 = iki kat, 3 = üç kat (genişlik ve yükseklik). */
  boyut(carpan: 1 | 2 | 3): this {
    const n = (carpan - 1) * 0x10 + (carpan - 1);
    return this.ekle(GS, 0x21, n);
  }

  metin(icerik: string): this {
    return this.ekle(cp857Kodla(icerik));
  }

  satir(icerik = ''): this {
    return this.metin(icerik).ekle(0x0a);
  }

  /** Sol ve sağ metni satır genişliğine yaslar: "Ekmek            12,50 TL" */
  ikiSutun(sol: string, sag: string, dolgu = ' '): this {
    const genislik = this.satirGenisligi;
    const solKirpik = sol.length + sag.length + 1 > genislik ? sol.slice(0, Math.max(0, genislik - sag.length - 1)) : sol;
    const bosluk = Math.max(1, genislik - solKirpik.length - sag.length);
    return this.satir(solKirpik + dolgu.repeat(bosluk) + sag);
  }

  ayirici(karakter = '-'): this {
    return this.satir(karakter.repeat(this.satirGenisligi));
  }

  bosluk(satirSayisi = 1): this {
    return this.ekle(ESC, 0x64, satirSayisi);
  }

  /** Kağıdı keser (tam kesme için 0, kısmi için 1). */
  kes(tam = false): this {
    return this.bosluk(4).ekle(GS, 0x56, tam ? 0 : 1);
  }

  /** Para çekmecesini açar (§13.4). Pin 2 varsayılan; bazı modeller pin 5 kullanır. */
  cekmeceAc(pin: 2 | 5 = 2): this {
    return this.ekle(ESC, 0x70, pin === 2 ? 0 : 1, 25, 250);
  }

  /** Barkod basar (CODE39 / CODE128 desteklenen yaygın tipler). */
  barkod(veri: string, tip: 'CODE39' | 'CODE128' = 'CODE128', yukseklik = 60): this {
    this.ekle(GS, 0x68, yukseklik); // yükseklik
    this.ekle(GS, 0x77, 2); // genişlik
    this.ekle(GS, 0x48, 2); // HRI: altta
    if (tip === 'CODE39') {
      this.ekle(GS, 0x6b, 4, cp857Kodla(veri), 0x00);
    } else {
      const govde = cp857Kodla('{B' + veri);
      this.ekle(GS, 0x6b, 73, govde.length, govde);
    }
    return this.satir();
  }

  bitir(): Buffer {
    return Buffer.concat(this.parcalar);
  }

  /**
   * Önizleme YAPISI — kağıda basılanın birebir karşılığı (§13.2).
   *
   * Eskiden düz metin dönüyordu: kalın yazı, çift punto ve hizalama komutları
   * atılıyor, her satır sola yaslı normal metin olarak görünüyordu. Ekranda
   * düzgün duran fiş kağıtta bambaşka oturuyordu ve fark ancak baskıdan sonra
   * anlaşılıyordu.
   *
   * Kaynak, yazıcıya giden BAYT AKIŞININ KENDİSİDİR — ayrı bir "önizleme
   * üreteci" yazılsaydı ikisi zamanla ayrışırdı. Üretecin bir hatası varsa
   * önizleme de aynı hatayı gösterir; istenen budur.
   */
  static onizlemeYapisi(baytlar: Buffer): FisOnizlemesi {
    const ogeler: FisOgesi[] = [];
    let hiza: Hizalama = 'sol';
    let kalin = false;
    let altCizgi = false;
    let boyut: 1 | 2 | 3 = 1;
    let mevcut = '';

    const satiriKapat = () => {
      ogeler.push({ tip: 'metin', metin: mevcut, hiza, kalin, altCizgi, boyut });
      mevcut = '';
    };

    for (let i = 0; i < baytlar.length; i++) {
      const bayt = baytlar[i] as number;

      if (bayt === ESC || bayt === GS) {
        const sonraki = baytlar[i + 1];
        const deger = baytlar[i + 2] ?? 0;

        if (bayt === ESC && sonraki === 0x61) {
          hiza = deger === 1 ? 'orta' : deger === 2 ? 'sag' : 'sol';
          i += 2;
        } else if (bayt === ESC && sonraki === 0x45) {
          kalin = deger === 1;
          i += 2;
        } else if (bayt === ESC && sonraki === 0x2d) {
          altCizgi = deger === 1;
          i += 2;
        } else if (bayt === GS && sonraki === 0x21) {
          // GS ! n : üst yarı genişlik, alt yarı yükseklik çarpanı.
          boyut = Math.min(3, Math.max(1, (deger & 0x0f) + 1)) as 1 | 2 | 3;
          i += 2;
        } else if (bayt === ESC && sonraki === 0x64) {
          if (mevcut) satiriKapat();
          ogeler.push({ tip: 'bosluk', satir: deger });
          i += 2;
        } else if (bayt === GS && sonraki === 0x56) {
          if (mevcut) satiriKapat();
          ogeler.push({ tip: 'kesme' });
          i += 2;
        } else if (bayt === GS && sonraki === 0x6b) {
          // Barkod: GS k 73 <uzunluk> <veri>  ya da  GS k 4 <veri> NUL
          if (mevcut) satiriKapat();
          let veri = '';
          if (deger === 73) {
            const uzunluk = baytlar[i + 3] ?? 0;
            veri = baytlar.subarray(i + 4, i + 4 + uzunluk).toString('latin1');
            i += 3 + uzunluk;
          } else {
            let j = i + 3;
            while (j < baytlar.length && baytlar[j] !== 0x00) j++;
            veri = baytlar.subarray(i + 3, j).toString('latin1');
            i = j;
          }
          // `{B` öneki kod kümesi seçimidir, basılan veriye dahil değildir.
          ogeler.push({ tip: 'barkod', veri: veri.replace(/^\{B/, ''), hiza });
        } else if (bayt === GS && (sonraki === 0x68 || sonraki === 0x77 || sonraki === 0x48)) {
          i += 2; // barkod yükseklik/genişlik/HRI ayarı — çizimi etkilemez
        } else if (bayt === ESC && sonraki === 0x74) {
          i += 2; // kod sayfası
        } else if (bayt === ESC && sonraki === 0x40) {
          i += 1; // sıfırla
        } else if (bayt === ESC && sonraki === 0x70) {
          i += 4; // çekmece — kağıda bir şey basmaz
        } else {
          i += 1;
        }
        continue;
      }

      if (bayt === 0x0a) {
        satiriKapat();
        continue;
      }

      const ters = TERS_CP857.get(bayt);
      mevcut += ters ?? String.fromCharCode(bayt);
    }

    if (mevcut) satiriKapat();
    return { ogeler };
  }

  /** Yazıcı yokken önizleme için düz metin üretir (kontrol baytları atılır). */
  static onizleme(baytlar: Buffer): string {
    const satirlar: string[] = [];
    for (const oge of EscPosYazici.onizlemeYapisi(baytlar).ogeler) {
      if (oge.tip === 'metin') satirlar.push(oge.metin);
      else if (oge.tip === 'barkod') satirlar.push(`[${oge.veri}]`);
      else if (oge.tip === 'bosluk') satirlar.push(...Array<string>(oge.satir).fill(''));
    }
    return satirlar.join('\n');
  }
}
