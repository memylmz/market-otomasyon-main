/**
 * SQLite sürücü soyutlaması.
 *
 * Tek bir eşzamanlı (synchronous) arayüz arkasında iki sürücü desteklenir:
 *  1. **better-sqlite3** (birincil) — Blueprint §5.1'in önerdiği sürücü.
 *  2. **node:sqlite** (yedek) — yerel modül derlenemediğinde otomatik devreye girer,
 *     böylece derleme aracı kurulu olmayan bir makinede uygulama yine de açılır.
 *
 * Kurallar:
 *  - Yalnız **konumsal** parametre (`?`) kullanılır; iki sürücüde de aynı davranır.
 *  - Parametreler bağlanmadan önce normalize edilir (boolean → 0/1, Date → ISO).
 *  - İç içe transaction SAVEPOINT ile desteklenir; en dış seviye `BEGIN IMMEDIATE`
 *    açar (yazar kilidini baştan alır, SQLITE_BUSY yükseltme kilitlenmesini önler).
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { turkceSiralamaAnahtari } from '@market/shared';

export type Baglanan = string | number | bigint | Uint8Array | null;

export interface CalistirmaSonucu {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface Ifade {
  calistir(...parametreler: unknown[]): CalistirmaSonucu;
  tek<T = unknown>(...parametreler: unknown[]): T | undefined;
  tumu<T = unknown>(...parametreler: unknown[]): T[];
}

export interface Vt {
  readonly surucuAdi: 'better-sqlite3' | 'node:sqlite';
  readonly dosyaYolu: string;
  /** Parametresiz, çok ifadeli ham SQL çalıştırır (DDL, PRAGMA, göç betikleri). */
  ham(sql: string): void;
  /** Hazırlanmış ifade döner; aynı SQL için önbellekten verilir. */
  hazirla(sql: string): Ifade;
  /** Atomik blok. İç içe çağrılarda SAVEPOINT kullanılır. */
  islem<T>(govde: () => T): T;
  islemIcindeMi(): boolean;
  pragmaOku<T = unknown>(ad: string): T | undefined;
  /**
   * SQL içinden çağrılabilen deterministik bir JS fonksiyonu kaydeder.
   * Sürücü desteklemiyorsa `false` döner; sorgu kuran kod `fonksiyonVarMi`
   * ile kontrol edip yedek bir ifadeye düşmelidir.
   */
  fonksiyonKaydet(ad: string, fn: (...args: unknown[]) => unknown): boolean;
  fonksiyonVarMi(ad: string): boolean;
  kapat(): void;
}

/** Sürücüye gitmeden önce JS değerlerini SQLite'ın kabul ettiği tiplere çevirir. */
export function baglananlariNormalize(parametreler: readonly unknown[]): Baglanan[] {
  return parametreler.map((deger) => {
    if (deger === undefined || deger === null) return null;
    if (typeof deger === 'boolean') return deger ? 1 : 0;
    if (deger instanceof Date) return deger.toISOString();
    if (typeof deger === 'number') {
      if (!Number.isFinite(deger)) throw new TypeError('SQLite parametresi sonlu bir sayı olmalıdır');
      return deger;
    }
    if (typeof deger === 'string' || typeof deger === 'bigint') return deger;
    if (deger instanceof Uint8Array) return deger;
    throw new TypeError(`SQLite'a bağlanamayan parametre tipi: ${typeof deger}`);
  });
}

/**
 * SELECT benzeri, satır döndüren ifadeleri ayırt eder.
 *
 * Yalnız ilk sözcüğe bakmak yetmez: SQLite 3.35+ ile `INSERT/UPDATE/DELETE ...
 * RETURNING` de satır döndürür (belge numaratöründe kullanılıyor).
 * better-sqlite3 bunu kesin olarak bildirdiği için orada `reader` alanı esas alınır;
 * bu fonksiyon yalnız yedek sürücü ve emniyet kontrolü içindir.
 */
function hataMetni(hata: unknown): string {
  return hata instanceof Error ? (hata.message.split('\n')[0] ?? hata.message) : String(hata);
}

function satirDonduruyorMu(sql: string): boolean {
  const bas = sql.trimStart().slice(0, 12).toUpperCase();
  if (bas.startsWith('SELECT') || bas.startsWith('WITH') || bas.startsWith('PRAGMA') || bas.startsWith('EXPLAIN')) {
    return true;
  }
  return /\bRETURNING\b/i.test(sql);
}

/** İki sürücünün de (varsa) sunduğu fonksiyon kaydetme arayüzü. */
interface FonksiyonluSurucu {
  function?(ad: string, secenekler: Record<string, unknown>, fn: (...args: unknown[]) => unknown): void;
}

abstract class TemelVt implements Vt {
  abstract readonly surucuAdi: 'better-sqlite3' | 'node:sqlite';
  protected readonly onbellek = new Map<string, Ifade>();
  protected readonly kayitliFonksiyonlar = new Set<string>();
  protected derinlik = 0;
  protected kapaliMi = false;

  constructor(readonly dosyaYolu: string) {}

  abstract ham(sql: string): void;
  protected abstract ifadeOlustur(sql: string): Ifade;
  protected abstract surucuKapat(): void;
  protected abstract hamSurucu(): FonksiyonluSurucu;

  fonksiyonKaydet(ad: string, fn: (...args: unknown[]) => unknown): boolean {
    const surucu = this.hamSurucu();
    if (typeof surucu.function !== 'function') return false;
    try {
      surucu.function(ad, { deterministic: true }, fn);
      this.kayitliFonksiyonlar.add(ad);
      return true;
    } catch {
      return false;
    }
  }

  fonksiyonVarMi(ad: string): boolean {
    return this.kayitliFonksiyonlar.has(ad);
  }

  hazirla(sql: string): Ifade {
    const onbellekli = this.onbellek.get(sql);
    if (onbellekli) return onbellekli;
    const ifade = this.ifadeOlustur(sql);
    this.onbellek.set(sql, ifade);
    return ifade;
  }

  islem<T>(govde: () => T): T {
    const enDis = this.derinlik === 0;
    const etiket = `sp_${this.derinlik}`;
    this.ham(enDis ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${etiket}`);
    this.derinlik++;
    let basarili = false;
    try {
      const sonuc = govde();
      basarili = true;
      return sonuc;
    } finally {
      this.derinlik--;
      if (basarili) {
        this.ham(enDis ? 'COMMIT' : `RELEASE ${etiket}`);
      } else {
        // Geri alma başarısız olursa asıl hatayı gölgelemesin.
        try {
          this.ham(enDis ? 'ROLLBACK' : `ROLLBACK TO ${etiket}; RELEASE ${etiket}`);
        } catch {
          /* asıl hata yukarı taşınıyor */
        }
      }
    }
  }

  islemIcindeMi(): boolean {
    return this.derinlik > 0;
  }

  pragmaOku<T = unknown>(ad: string): T | undefined {
    const satir = this.hazirla(`PRAGMA ${ad}`).tek<Record<string, unknown>>();
    if (!satir) return undefined;
    const degerler = Object.values(satir);
    return degerler[0] as T;
  }

  kapat(): void {
    if (this.kapaliMi) return;
    this.kapaliMi = true;
    this.onbellek.clear();
    this.surucuKapat();
  }
}

// ---------------------------------------------------------------------------
// better-sqlite3
// ---------------------------------------------------------------------------

interface BetterIfade {
  run(...p: Baglanan[]): { changes: number; lastInsertRowid: number | bigint };
  get(...p: Baglanan[]): unknown;
  all(...p: Baglanan[]): unknown[];
  /** better-sqlite3, ifadenin satır döndürüp döndürmediğini kesin olarak bildirir. */
  readonly reader?: boolean;
}
interface BetterVt {
  prepare(sql: string): BetterIfade;
  exec(sql: string): unknown;
  close(): void;
}

class BetterSqliteVt extends TemelVt {
  override readonly surucuAdi = 'better-sqlite3' as const;

  constructor(
    private readonly ic: BetterVt,
    dosyaYolu: string,
  ) {
    super(dosyaYolu);
  }

  override ham(sql: string): void {
    this.ic.exec(sql);
  }

  protected override ifadeOlustur(sql: string): Ifade {
    const ifade = this.ic.prepare(sql);
    const dondurur = typeof ifade.reader === 'boolean' ? ifade.reader : satirDonduruyorMu(sql);
    return {
      calistir: (...p) => ifade.run(...baglananlariNormalize(p)),
      tek: <T>(...p: unknown[]) => {
        if (!dondurur) throw new Error('Satır döndürmeyen ifadede tek() kullanılamaz: ' + sql.slice(0, 60));
        return ifade.get(...baglananlariNormalize(p)) as T | undefined;
      },
      tumu: <T>(...p: unknown[]) => {
        if (!dondurur) throw new Error('Satır döndürmeyen ifadede tumu() kullanılamaz: ' + sql.slice(0, 60));
        return ifade.all(...baglananlariNormalize(p)) as T[];
      },
    };
  }

  protected override surucuKapat(): void {
    this.ic.close();
  }

  protected override hamSurucu(): FonksiyonluSurucu {
    return this.ic as FonksiyonluSurucu;
  }
}

// ---------------------------------------------------------------------------
// node:sqlite (yerleşik yedek sürücü)
// ---------------------------------------------------------------------------

interface NodeIfade {
  run(...p: Baglanan[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...p: Baglanan[]): unknown;
  all(...p: Baglanan[]): unknown[];
}
interface NodeVt {
  prepare(sql: string): NodeIfade;
  exec(sql: string): void;
  close(): void;
}

class NodeSqliteVt extends TemelVt {
  override readonly surucuAdi = 'node:sqlite' as const;

  constructor(
    private readonly ic: NodeVt,
    dosyaYolu: string,
  ) {
    super(dosyaYolu);
  }

  override ham(sql: string): void {
    this.ic.exec(sql);
  }

  protected override ifadeOlustur(sql: string): Ifade {
    const ifade = this.ic.prepare(sql);
    return {
      calistir: (...p) => {
        const s = ifade.run(...baglananlariNormalize(p));
        return { changes: Number(s.changes), lastInsertRowid: s.lastInsertRowid };
      },
      tek: <T>(...p: unknown[]) => ifade.get(...baglananlariNormalize(p)) as T | undefined,
      tumu: <T>(...p: unknown[]) => ifade.all(...baglananlariNormalize(p)) as T[],
    };
  }

  protected override surucuKapat(): void {
    this.ic.close();
  }

  protected override hamSurucu(): FonksiyonluSurucu {
    return this.ic as FonksiyonluSurucu;
  }
}

// ---------------------------------------------------------------------------
// Açılış
// ---------------------------------------------------------------------------

export interface SurucuSecenekleri {
  /** Salt-okunur açılış (yedek doğrulama, onarım analizi). */
  saltOkunur?: boolean;
  /**
   * `synchronous` PRAGMA değeri. Varsayılan FULL: kesinleşen satış elektrik
   * kesintisinde dahi kaybolmaz (§3.2 sıfır veri kaybı hedefi).
   */
  senkronizasyon?: 'FULL' | 'NORMAL';
  /** Yalnız testlerde: hangi sürücünün kullanılacağını zorlar. */
  surucuZorla?: 'better-sqlite3' | 'node:sqlite';
}

/**
 * ABI'ye özel yerel ikili yolunu bulur.
 *
 * `better_sqlite3.node` derlendiği ABI'ye bağlıdır; bu depoda Node (test/seed/API)
 * ve Electron (kasa) farklı ABI kullanır. `scripts/native-hazirla.mjs` her ikisini
 * `better_sqlite3-abi<N>.node` olarak yan yana koyar, burada doğru olanı seçeriz.
 * Dosya yoksa `null` döner ve better-sqlite3 kendi varsayılanını kullanır.
 */
function abiyeOzelIkili(): string | null {
  try {
    // Electron ana süreci CJS'tir (`require` var); vitest/Node ESM'dir (createRequire gerekir).
    const gerekli = typeof require === 'function' ? require : createRequire(import.meta.url);
    const paketYolu = gerekli.resolve('better-sqlite3/package.json');
    const aday = join(dirname(paketYolu), 'build', 'Release', `better_sqlite3-abi${process.versions.modules}.node`);
    return existsSync(aday) ? aday : null;
  } catch {
    return null;
  }
}

async function betterSqliteAc(yol: string, saltOkunur: boolean): Promise<BetterVt> {
  const modul = (await import('better-sqlite3')) as unknown as {
    default: new (yol: string, secenekler?: Record<string, unknown>) => BetterVt;
  };
  const Kurucu = modul.default;
  const secenekler: Record<string, unknown> = { readonly: saltOkunur };
  const ikili = abiyeOzelIkili();
  if (ikili) secenekler.nativeBinding = ikili;
  return new Kurucu(yol, secenekler);
}

async function nodeSqliteAc(yol: string, saltOkunur: boolean): Promise<NodeVt> {
  // `node:sqlite` yalnız Node 22.5+ ile gelir ve Electron 33'ün Node 20'sinde YOKTUR.
  // Modül adı değişkende tutulur ve @vite-ignore verilir: aksi hâlde Vite/vitest
  // bu dinamik import'u paketlemeye çalışıp "Failed to load url sqlite" hatası verir.
  const modulAdi = 'node:sqlite';
  const modul = (await import(/* @vite-ignore */ modulAdi)) as unknown as {
    DatabaseSync: new (yol: string, secenekler?: Record<string, unknown>) => NodeVt;
  };
  return new modul.DatabaseSync(yol, { readOnly: saltOkunur });
}

/**
 * Veritabanını açar, dayanıklılık PRAGMA'larını uygular ve hazır bir `Vt` döner.
 * `:memory:` yolu testlerde kullanılır.
 */
export async function veritabaniAc(yol: string, secenekler: SurucuSecenekleri = {}): Promise<Vt> {
  const saltOkunur = secenekler.saltOkunur ?? false;
  const zorla = secenekler.surucuZorla;

  let vt: Vt;
  let ilkHata: unknown;

  if (zorla !== 'node:sqlite') {
    try {
      vt = new BetterSqliteVt(await betterSqliteAc(yol, saltOkunur), yol);
    } catch (hata) {
      if (zorla === 'better-sqlite3') throw hata;
      ilkHata = hata;
      try {
        vt = new NodeSqliteVt(await nodeSqliteAc(yol, saltOkunur), yol);
      } catch (yedekHatasi) {
        // İki sürücü de açılamadı. Kullanıcıya YEDEĞİN hatasını göstermek
        // ("No such built-in module: node:sqlite") yanıltıcıdır — asıl sebep
        // birincil sürücünün yüklenememesidir. Eyleme dönük mesajı o üretir.
        throw new Error(
          'Veritabanı sürücüsü yüklenemedi.\n\n' +
            `Birincil sürücü (better-sqlite3): ${hataMetni(hata)}\n` +
            `Yedek sürücü (node:sqlite): ${hataMetni(yedekHatasi)}\n\n` +
            'Bu genellikle yerel modülün bu çalışma zamanının ABI sürümüne göre ' +
            'derlenmemiş olmasından kaynaklanır. Çözüm için proje kökünde şunu çalıştırın:\n' +
            '  npm run native -w @market/desktop',
          { cause: hata },
        );
      }
    }
  } else {
    vt = new NodeSqliteVt(await nodeSqliteAc(yol, saltOkunur), yol);
  }

  if (ilkHata) {
    // Sessizce düşmek hata ayıklamayı zorlaştırır; sebebi görünür kılalım.
    console.warn(
      '[vt] better-sqlite3 yüklenemedi, yerleşik node:sqlite sürücüsüne geçildi. Sebep:',
      ilkHata instanceof Error ? ilkHata.message : ilkHata,
    );
  }

  pragmalariUygula(vt, yol, secenekler);

  // Türkçe alfabetik sıralama: ORDER BY tr_sira(ad). better-sqlite3 her zaman,
  // node:sqlite ise 22.5+ sürümlerde destekler; kaydedilemezse sorgular
  // COLLATE NOCASE yedeğine düşer (bkz. depo/katalog).
  const trSira = vt.fonksiyonKaydet('tr_sira', (deger) => turkceSiralamaAnahtari(String(deger ?? '')));
  if (!trSira) {
    console.warn('[vt] tr_sira SQL fonksiyonu kaydedilemedi; alfabetik sıralama Türkçe duyarlı olmayacak.');
  }

  return vt;
}

function pragmalariUygula(vt: Vt, yol: string, secenekler: SurucuSecenekleri): void {
  const bellekMi = yol === ':memory:' || yol.startsWith('file::memory:');
  const satirlar = [
    // Yabancı anahtar bütünlüğü SQLite'ta varsayılan olarak KAPALIDIR.
    'PRAGMA foreign_keys = ON;',
    // Kilit bekleme: başka bir kasa terminali yazarken hemen hata vermek yerine bekle.
    'PRAGMA busy_timeout = 8000;',
    'PRAGMA temp_store = MEMORY;',
    // ~64 MB sayfa önbelleği (negatif değer KB cinsindendir).
    'PRAGMA cache_size = -64000;',
  ];
  if (!bellekMi && !secenekler.saltOkunur) {
    // WAL: okuyucular yazarı engellemez + çökme dayanıklılığı (§3.2, Ek A).
    satirlar.unshift('PRAGMA journal_mode = WAL;');
    satirlar.push(`PRAGMA synchronous = ${secenekler.senkronizasyon ?? 'FULL'};`);
    // WAL dosyası sınırsız büyümesin (disk dolması senaryosu, §20).
    satirlar.push('PRAGMA wal_autocheckpoint = 1000;');
  }
  for (const satir of satirlar) vt.ham(satir);
}

/** `PRAGMA integrity_check` — yedek doğrulama ve bozulma tespiti (§18.4, §20). */
export function butunlukKontrolu(vt: Vt): { saglam: boolean; detay: string } {
  const satirlar = vt.hazirla('PRAGMA integrity_check').tumu<Record<string, unknown>>();
  const mesajlar = satirlar.map((s) => String(Object.values(s)[0] ?? '')).filter(Boolean);
  const saglam = mesajlar.length === 1 && mesajlar[0] === 'ok';
  return { saglam, detay: mesajlar.join('; ') || 'sonuç yok' };
}

/** Yabancı anahtar ihlallerini listeler (göç sonrası doğrulama). */
export function yabanciAnahtarKontrolu(vt: Vt): string[] {
  const satirlar = vt.hazirla('PRAGMA foreign_key_check').tumu<Record<string, unknown>>();
  return satirlar.map((s) => JSON.stringify(s));
}
