/**
 * Yapılandırılmış loglama (§19.1).
 *
 *  - JSON satır formatı: `{ zaman, seviye, mesaj, izleme_id, ...baglam }`
 *  - Dönen dosya (rotating): boyut sınırına gelince `.1`, `.2` ... olarak kaydırılır.
 *  - **Hassas veri maskelenir**: şifre, PIN, hash, token asla loga yazılmaz (§15.1).
 *  - Log yazımı hiçbir zaman uygulamayı düşürmez; hata olursa sessizce yutulur
 *    (kasa, log diski dolu diye durmamalı — §20).
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export type Seviye = 'ayrinti' | 'bilgi' | 'uyari' | 'hata';

const SEVIYE_SIRASI: Record<Seviye, number> = { ayrinti: 10, bilgi: 20, uyari: 30, hata: 40 };

/** Anahtar adı bu kalıba uyuyorsa değeri maskelenir. */
const HASSAS_ANAHTAR = /(sifre|password|parola|pin|hash|token|secret|gizli|anahtar|authorization|cookie)/i;

const AZAMI_DERINLIK = 6;

export function hassasMaskele(deger: unknown, derinlik = 0): unknown {
  if (deger === null || deger === undefined) return deger;
  if (derinlik >= AZAMI_DERINLIK) return '[derin]';
  if (Array.isArray(deger)) return deger.slice(0, 50).map((o) => hassasMaskele(o, derinlik + 1));
  if (deger instanceof Error) return { ad: deger.name, mesaj: deger.message, yigin: deger.stack?.split('\n').slice(0, 5) };
  if (typeof deger === 'object') {
    const sonuc: Record<string, unknown> = {};
    for (const [anahtar, icDeger] of Object.entries(deger as Record<string, unknown>)) {
      sonuc[anahtar] = HASSAS_ANAHTAR.test(anahtar) ? '***' : hassasMaskele(icDeger, derinlik + 1);
    }
    return sonuc;
  }
  if (typeof deger === 'bigint') return deger.toString();
  return deger;
}

export interface Kayitci {
  ayrinti(mesaj: string, veri?: Record<string, unknown>): void;
  bilgi(mesaj: string, veri?: Record<string, unknown>): void;
  uyari(mesaj: string, veri?: Record<string, unknown>): void;
  hata(mesaj: string, veri?: Record<string, unknown>): void;
  /** Sabit bağlam ekleyen alt kayıtçı (ör. { modul: 'senkron' }). */
  alt(baglam: Record<string, unknown>): Kayitci;
}

export interface KayitciSecenekleri {
  /** Boşsa yalnız konsola yazar (testlerde kullanışlı). */
  klasor?: string;
  dosyaAdi?: string;
  seviye?: Seviye;
  konsol?: boolean;
  azamiDosyaBayt?: number;
  saklananDosya?: number;
  taban?: Record<string, unknown>;
}

class DosyaKayitcisi implements Kayitci {
  private readonly seviye: number;
  private readonly dosyaYolu: string | null;
  private readonly azamiBayt: number;
  private readonly saklanan: number;
  private readonly konsol: boolean;
  private yazmaHatasiBildirildi = false;

  constructor(
    private readonly secenekler: KayitciSecenekleri,
    private readonly taban: Record<string, unknown>,
  ) {
    this.seviye = SEVIYE_SIRASI[secenekler.seviye ?? 'bilgi'];
    this.azamiBayt = secenekler.azamiDosyaBayt ?? 5 * 1024 * 1024;
    this.saklanan = secenekler.saklananDosya ?? 5;
    this.konsol = secenekler.konsol ?? true;
    if (secenekler.klasor) {
      try {
        mkdirSync(secenekler.klasor, { recursive: true });
      } catch {
        /* yol oluşturulamadıysa dosyaya yazmayı denemeyiz */
      }
      this.dosyaYolu = join(secenekler.klasor, secenekler.dosyaAdi ?? 'uygulama.log');
    } else {
      this.dosyaYolu = null;
    }
  }

  private yaz(seviye: Seviye, mesaj: string, veri?: Record<string, unknown>): void {
    if (SEVIYE_SIRASI[seviye] < this.seviye) return;

    const kayit = {
      zaman: new Date().toISOString(),
      seviye,
      mesaj,
      ...(hassasMaskele(this.taban) as Record<string, unknown>),
      ...(veri ? (hassasMaskele(veri) as Record<string, unknown>) : {}),
    };

    let satir: string;
    try {
      satir = JSON.stringify(kayit);
    } catch {
      satir = JSON.stringify({ zaman: kayit.zaman, seviye, mesaj, not: 'veri serileştirilemedi' });
    }

    if (this.konsol) {
      const cikti = seviye === 'hata' ? console.error : seviye === 'uyari' ? console.warn : console.log;
      cikti(satir);
    }

    if (!this.dosyaYolu) return;
    try {
      this.dondurGerekiyorsa();
      appendFileSync(this.dosyaYolu, satir + '\n', 'utf8');
    } catch (hata) {
      // Loglama hiçbir koşulda iş akışını kesmez.
      if (!this.yazmaHatasiBildirildi) {
        this.yazmaHatasiBildirildi = true;
        console.error('[kayit] Log dosyasına yazılamıyor:', hata instanceof Error ? hata.message : hata);
      }
    }
  }

  private dondurGerekiyorsa(): void {
    if (!this.dosyaYolu || !existsSync(this.dosyaYolu)) return;
    if (statSync(this.dosyaYolu).size < this.azamiBayt) return;

    const enEski = `${this.dosyaYolu}.${this.saklanan}`;
    if (existsSync(enEski)) unlinkSync(enEski);
    for (let i = this.saklanan - 1; i >= 1; i--) {
      const kaynak = `${this.dosyaYolu}.${i}`;
      if (existsSync(kaynak)) renameSync(kaynak, `${this.dosyaYolu}.${i + 1}`);
    }
    renameSync(this.dosyaYolu, `${this.dosyaYolu}.1`);
  }

  ayrinti(mesaj: string, veri?: Record<string, unknown>): void {
    this.yaz('ayrinti', mesaj, veri);
  }
  bilgi(mesaj: string, veri?: Record<string, unknown>): void {
    this.yaz('bilgi', mesaj, veri);
  }
  uyari(mesaj: string, veri?: Record<string, unknown>): void {
    this.yaz('uyari', mesaj, veri);
  }
  hata(mesaj: string, veri?: Record<string, unknown>): void {
    this.yaz('hata', mesaj, veri);
  }

  alt(baglam: Record<string, unknown>): Kayitci {
    return new DosyaKayitcisi(this.secenekler, { ...this.taban, ...baglam });
  }
}

export function kayitciOlustur(secenekler: KayitciSecenekleri = {}): Kayitci {
  return new DosyaKayitcisi(secenekler, secenekler.taban ?? {});
}

/** Hiçbir şey yazmayan kayıtçı — birim testlerinde gürültüyü keser. */
export function sessizKayitci(): Kayitci {
  const bos: Kayitci = {
    ayrinti: () => {},
    bilgi: () => {},
    uyari: () => {},
    hata: () => {},
    alt: () => bos,
  };
  return bos;
}
