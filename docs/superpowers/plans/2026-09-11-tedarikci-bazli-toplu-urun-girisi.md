# Tedarikçi Bazlı Toplu Ürün Girişi — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bir tedarikçiden gelen malı tek alış belgesinde, katalogda olmayan ürünlerin kartlarını da açarak girebilmek — kasada ve panelde, ADMIN+MÜDÜR yetkisiyle.

**Architecture:** Yeni belge türü, yeni tablo, yeni senkron varlığı ve yeni IPC kanalı **yoktur**. Mevcut alış faturası kaleminin sözleşmesi `urun_id` **XOR** `yeni_urun` olacak şekilde genişletilir; ürünü de belgeyi de kasa üretir (`malKabulOnayla`, tek transaction). Panel yalnız niyeti yazar (`alis_talimatlari`), kasa talimatı aynı servisten geçirir.

**Tech Stack:** TypeScript (ESM), Zod, better-sqlite3 (kasa), Fastify + libSQL (bulut), React 18 + Tailwind (kasa arayüzü), Next.js App Router (panel), Vitest.

**Spec:** [docs/superpowers/specs/2026-09-11-tedarikci-bazli-toplu-urun-girisi-design.md](../specs/2026-09-11-tedarikci-bazli-toplu-urun-girisi-design.md)

## Global Constraints

- **Parada float yok:** tutarlar tam sayı **kuruş**, miktarlar tam sayı **bindebir** (1 adet = 1000). Ara hesapta `Math.round` kullanılır.
- **Yeni tablo / yeni senkron varlığı / yeni IPC kanalı eklenmez.** Kasa arayüzü mevcut `stok.malKabul` kanalını çağırır.
- **Stok hareketlerinin tek üreticisi kasadır.** Bulut hiçbir koşulda stok, cari ya da fatura satırı yazmaz; yalnız `alis_talimatlari`'na niyet yazar.
- **Yetki:** `stok.giris` + (kalemlerde yeni ürün varsa) `urun.duzenle`. Yeni yetki tanımlanmaz. Panelde uç `yonetici` guard'ı (ADMIN+MUDUR) ile korunur.
- **Kalem üst sınırı:** 200.
- **Panele yalnız ADMIN girebilir** (`apps/api/src/rota/kimlik.ts`, `WHERE ... rol = 'ADMIN'`). Uçtaki `yonetici` guard'ı ADMIN+MUDUR'e açıktır ama bugün müdür panele giriş yapamaz; bu mevcut davranıştır, bu iş kapsamında değiştirilmez. Kasada müdür kendi yetkileriyle çalışır.
- **Dil:** kod, yorum, değişken adları ve kullanıcı mesajları Türkçedir; dosyanın mevcut üslubu (yorum yoğunluğu, "neden böyle" açıklamaları) korunur.
- **Hepsi-veya-hiçbiri:** bir satır hatalıysa belgenin tamamı yazılmaz.
- **Her görevin sonunda:** `npm run typecheck && npm run lint` temiz olmalı.
- Commit mesajları Türkçe; her commit sonunda `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` satırı bulunur.
- Testler tek dosya olarak `npx vitest run <yol>` ile, tamamı `npm test` ile koşulur.

---

### Görev 1: Sözleşme — kalem `urun_id` XOR `yeni_urun`, `HAVALE` ödemesi

**Files:**
- Modify: `packages/shared/src/semalar.ts` (`zAlisGirdi`, satır ~410-440)
- Test: `packages/shared/test/alis-girdi.test.ts` (yeni)

**Interfaces:**
- Consumes: mevcut `zUuid`, `zMetin`, `zMiktar`, `zKurusPozitif`, `zKdvOrani`, `zBarkod`, `zGun`, `BIRIM_TIPI` (hepsi aynı dosyada tanımlı).
- Produces:
  - `zYeniUrunKalemi` / `YeniUrunKalemi` = `{ ad: string; barkod?: string | null; marka?: string | null; birim_tipi: 'ADET'|'KG'|'LT'; kategori_id?: string | null; satis_fiyati: number; kritik_stok?: number }`
  - `zAlisGirdi.kalemler[]` artık `{ urun_id?: string; yeni_urun?: YeniUrunKalemi; miktar; birim_fiyat; kdv_orani; skt?; lot_no?; yeni_satis_fiyati? }`
  - `zAlisGirdi.odeme_tipi`: `'NAKIT' | 'KART' | 'HAVALE'`

- [ ] **Step 1: Testi yaz**

`packages/shared/test/alis-girdi.test.ts`:

```ts
/**
 * Alış girdisi sözleşmesi: bir kalem ya mevcut ürüne ya da faturada açılacak
 * yeni ürüne bağlıdır. Bu kural şemada durmak zorundadır — kasa ve bulut aynı
 * gövdeyi ayrı ayrı doğruluyor, ikisinin de aynı cevabı vermesi gerekir.
 */

import { describe, expect, it } from 'vitest';
import { adet, zAlisGirdi } from '@market/shared';

const TEDARIKCI = '33333333-3333-4333-8333-333333333333';
const URUN = '44444444-4444-4444-8444-444444444444';

function govde(kalem: Record<string, unknown>) {
  return { tedarikci_id: TEDARIKCI, kalemler: [{ miktar: adet(2), birim_fiyat: 700, kdv_orani: 20, ...kalem }] };
}

describe('zAlisGirdi kalemleri', () => {
  it('mevcut ürüne bağlı kalemi kabul eder (eski gövdeler bozulmaz)', () => {
    const sonuc = zAlisGirdi.safeParse(govde({ urun_id: URUN }));
    expect(sonuc.success).toBe(true);
  });

  it('yeni ürün tarif eden kalemi kabul eder', () => {
    const sonuc = zAlisGirdi.safeParse(
      govde({ yeni_urun: { ad: 'Toptan Kola 1L', barkod: '8690000000017', satis_fiyati: 2500 } }),
    );
    expect(sonuc.success).toBe(true);
    if (sonuc.success) {
      // Varsayılanlar uygulanır: birim ADET, ödeme NAKIT.
      expect(sonuc.data.kalemler[0]!.yeni_urun!.birim_tipi).toBe('ADET');
      expect(sonuc.data.odeme_tipi).toBe('NAKIT');
    }
  });

  it('ikisi birden verilirse reddeder', () => {
    const sonuc = zAlisGirdi.safeParse(govde({ urun_id: URUN, yeni_urun: { ad: 'Kola', satis_fiyati: 2500 } }));
    expect(sonuc.success).toBe(false);
  });

  it('ikisi de verilmezse reddeder', () => {
    expect(zAlisGirdi.safeParse(govde({})).success).toBe(false);
  });

  it('yeni üründe satış fiyatı zorunludur', () => {
    expect(zAlisGirdi.safeParse(govde({ yeni_urun: { ad: 'Kola' } })).success).toBe(false);
  });

  it('200 kalemi geçen belgeyi reddeder', () => {
    const kalemler = Array.from({ length: 201 }, () => ({
      urun_id: URUN,
      miktar: adet(1),
      birim_fiyat: 100,
      kdv_orani: 20,
    }));
    expect(zAlisGirdi.safeParse({ tedarikci_id: TEDARIKCI, kalemler }).success).toBe(false);
  });

  it('HAVALE ödeme tipini kabul eder', () => {
    const sonuc = zAlisGirdi.safeParse({ ...govde({ urun_id: URUN }), odenen_tutar: 1680, odeme_tipi: 'HAVALE' });
    expect(sonuc.success).toBe(true);
  });
});
```

- [ ] **Step 2: Testi koş, kırmızı olduğunu gör**

Run: `npx vitest run packages/shared/test/alis-girdi.test.ts`
Expected: FAIL — "ikisi birden verilirse reddeder", "ikisi de verilmezse reddeder", "200 kalemi geçen…" ve "HAVALE…" başarısız (bugün `urun_id` zorunlu, XOR kuralı, üst sınır ve HAVALE yok).

- [ ] **Step 3: Şemayı genişlet**

`packages/shared/src/semalar.ts` — `zAlisGirdi`'nin **hemen üstüne** ekle:

```ts
/**
 * Faturada açılacak YENİ ürün (§11.8).
 *
 * Toptancıdan gelen malın çoğu katalogda yoktur. Kalem ya mevcut bir ürüne
 * (`urun_id`) ya da burada tarif edilen yeni ürüne bağlanır; ürünü de belgeyi
 * de KASA üretir, böylece ikisi tek transaction'da doğar.
 */
export const zYeniUrunKalemi = z.object({
  ad: zMetin(200).min(1, 'Ürün adı zorunludur'),
  barkod: zBarkod.nullable().optional(),
  marka: zMetin(120).nullable().optional(),
  birim_tipi: z.enum(BIRIM_TIPI).default('ADET'),
  kategori_id: zUuid.nullable().default(null),
  /** KDV **dahil** raf fiyatı. Alış fiyatı kalemin `birim_fiyat` alanından gelir. */
  satis_fiyati: zKurusPozitif,
  kritik_stok: zMiktar.optional(),
});
export type YeniUrunKalemi = z.infer<typeof zYeniUrunKalemi>;
```

`zAlisGirdi` içinde `odeme_tipi` satırını değiştir:

```ts
  /** Peşin ödeme NAKIT ise kasadan da düşülür; KART/HAVALE yalnız cariyi kapatır. */
  odeme_tipi: z.enum(['NAKIT', 'KART', 'HAVALE'] as const).default('NAKIT'),
```

ve `kalemler` alanını şununla değiştir:

```ts
  kalemler: z
    .array(
      z
        .object({
          urun_id: zUuid.optional(),
          yeni_urun: zYeniUrunKalemi.optional(),
          miktar: zMiktar.positive('Miktar sıfırdan büyük olmalıdır'),
          birim_fiyat: zKurusPozitif,
          kdv_orani: zKdvOrani,
          skt: zGun.nullable().optional(),
          lot_no: zMetin(60).nullable().optional(),
          /** Doluysa MEVCUT ürünün satış fiyatı da güncellenir. */
          yeni_satis_fiyati: zKurusPozitif.optional(),
        })
        .refine((k) => Boolean(k.urun_id) !== Boolean(k.yeni_urun), {
          message: 'Kalem ya mevcut bir ürüne ya da yeni bir ürüne bağlı olmalıdır',
        }),
    )
    .min(1, 'En az bir kalem gereklidir')
    // Tek transaction'da yazılıyor: kazara yapıştırılan devasa liste kasayı kilitlemesin.
    .max(200, 'Tek belgede en fazla 200 kalem girilebilir'),
```

- [ ] **Step 4: Testi koş, yeşil olduğunu gör**

Run: `npx vitest run packages/shared/test/alis-girdi.test.ts`
Expected: PASS (7 test)

- [ ] **Step 5: Tüm paketi koş — mevcut çağıranlar bozulmamalı**

Run: `npm test && npm run typecheck`
Expected: PASS. `apps/desktop/src/main/servis/stok-servis.ts` içinde `kalem.urun_id` artık `string | undefined` olduğu için **tip hatası vermesi beklenir** — bu hata Görev 2'de giderilir. Tip hatası dışında test kırığı olmamalı.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/semalar.ts packages/shared/test/alis-girdi.test.ts
git commit -m "feat(shared): alış kalemi mevcut ürün ya da yeni ürün olabilsin

Kalem artık urun_id XOR yeni_urun taşır; belgeye 200 kalem sınırı ve
kasaya dokunmayan HAVALE ödeme tipi eklendi.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Görev 2: Kasa — mal kabulü faturada yeni ürün açsın

**Files:**
- Modify: `apps/desktop/src/main/servis/stok-servis.ts` (`malKabulOnayla`, satır 264-515)
- Test: `apps/desktop/test/mal-kabul-yeni-urun.test.ts` (yeni)

**Interfaces:**
- Consumes: Görev 1'in `zAlisGirdi` sözleşmesi; `urunKaydet(vt, girdi, cihazId, zaman) => string`, `urunBul(vt, id)`, `barkodSahibi(vt, barkod) => string | null`, `barkodEkle(vt, urunId, barkod, ambalaj, cihazId, zaman) => string`, `olayYaz`, `yetkiIste(aktor, yetki, aciklama?)`.
- Produces: `malKabulOnayla` imzası **değişmez** (`MalKabulSonucu`); yeni ürünlü kalemler de aynı sonucu döndürür.

- [ ] **Step 1: Testi yaz**

`apps/desktop/test/mal-kabul-yeni-urun.test.ts`:

```ts
/**
 * Toptancıdan gelen malın katalogda olmayan ürünleri: fatura hem ürün kartını
 * açar hem stoğu yazar. Belgeyle ürün aynı transaction'da doğmalıdır — yarım
 * yazılmış bir irsaliye, kullanıcının en pahalıya mal olan hâlidir.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet } from '@market/shared';
import { cariBul } from '../src/main/depo/cari.js';
import { barkodSahibi, urunBul } from '../src/main/depo/katalog.js';
import { stokOku } from '../src/main/depo/stok.js';
import { malKabulOnayla } from '../src/main/servis/stok-servis.js';
import { tedarikciEkle, testOrtamiKur, urunEkle, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

describe('faturada yeni ürün', () => {
  it('ürün kartını açar, tedarikçisini yazar, stoğu ve borcu belgeye bağlar', () => {
    const tedarikciId = tedarikciEkle(ortam, 'Toptancı A');

    const sonuc = malKabulOnayla(ortam.uygulama.baglam, ortam.admin, {
      tedarikci_id: tedarikciId,
      fatura_no: 'TOP-1001',
      kalemler: [
        {
          yeni_urun: { ad: 'Toptan Kola 1L', barkod: '8690000000017', satis_fiyati: 2500, birim_tipi: 'ADET' },
          miktar: adet(12),
          birim_fiyat: 1500,
          kdv_orani: 20,
        },
      ],
    });

    // net 12 × 15,00 = 180,00; %20 KDV = 36,00 → 216,00 ₺
    expect(sonuc.genelToplam).toBe(21_600);
    expect(sonuc.kalemSayisi).toBe(1);

    const urunId = barkodSahibi(ortam.uygulama.baglam.vt, '8690000000017');
    expect(urunId).not.toBeNull();

    const urun = urunBul(ortam.uygulama.baglam.vt, urunId!);
    expect(urun?.ad).toBe('Toptan Kola 1L');
    expect(urun?.varsayilan_tedarikci_id).toBe(tedarikciId);
    expect(urun?.alis_fiyati).toBe(1500); // kalemin birim fiyatı
    expect(urun?.satis_fiyati).toBe(2500);

    // Stok faturanın GİRİŞ hareketidir ve belgeye bağlıdır.
    expect(stokOku(ortam.uygulama.baglam.vt, urunId!)).toBe(adet(12));
    const hareket = ortam.uygulama.baglam.vt
      .hazirla('SELECT hareket_tipi, miktar, belge_id FROM stok_hareketleri WHERE urun_id = ?')
      .tek<{ hareket_tipi: string; miktar: number; belge_id: string }>(urunId!);
    expect(hareket).toEqual({ hareket_tipi: 'GIRIS', miktar: adet(12), belge_id: sonuc.faturaId });

    // Tedarikçiye borç.
    expect(cariBul(ortam.uygulama.baglam.vt, tedarikciId)?.bakiye).toBe(21_600);

    // Senkron kuyruğu: ürün, barkod, stok ve cari olayları.
    const olaylar = ortam.uygulama.baglam.vt
      .hazirla('SELECT olay_tipi FROM sync_outbox')
      .tumu<{ olay_tipi: string }>()
      .map((o) => o.olay_tipi);
    expect(olaylar).toContain('URUN_KAYDEDILDI');
    expect(olaylar).toContain('BARKOD_KAYDEDILDI');
    expect(olaylar).toContain('STOK_HAREKETI');
    expect(olaylar).toContain('ALIS_FATURASI_ONAYLANDI');
  });

  it('mevcut ve yeni ürünü tek belgede birleştirir', () => {
    const tedarikciId = tedarikciEkle(ortam);
    const mevcutId = urunEkle(ortam, { ad: 'Bilinen Süt', stok: adet(5), alisFiyati: 900 });

    const sonuc = malKabulOnayla(ortam.uygulama.baglam, ortam.admin, {
      tedarikci_id: tedarikciId,
      kalemler: [
        { urun_id: mevcutId, miktar: adet(6), birim_fiyat: 1000, kdv_orani: 10 },
        { yeni_urun: { ad: 'Yeni Ayran', satis_fiyati: 1800 }, miktar: adet(4), birim_fiyat: 1200, kdv_orani: 10 },
      ],
    });

    expect(sonuc.kalemSayisi).toBe(2);
    expect(stokOku(ortam.uygulama.baglam.vt, mevcutId)).toBe(adet(11));

    const kalemSayisi = ortam.uygulama.baglam.vt
      .hazirla('SELECT COUNT(*) AS adet FROM alis_kalemleri WHERE alis_faturasi_id = ?')
      .tek<{ adet: number }>(sonuc.faturaId);
    expect(kalemSayisi?.adet).toBe(2);
  });

  it('barkod başka üründeyse HİÇBİR satırı yazmaz', () => {
    const tedarikciId = tedarikciEkle(ortam);
    urunEkle(ortam, { ad: 'Eski Kola', barkod: '8690000000017' });
    const oncekiUrunSayisi = ortam.uygulama.baglam.vt.hazirla('SELECT COUNT(*) AS adet FROM urunler').tek<{ adet: number }>()!
      .adet;

    expect(() =>
      malKabulOnayla(ortam.uygulama.baglam, ortam.admin, {
        tedarikci_id: tedarikciId,
        kalemler: [
          { yeni_urun: { ad: 'Sağlam Satır', satis_fiyati: 1000 }, miktar: adet(1), birim_fiyat: 500, kdv_orani: 20 },
          {
            yeni_urun: { ad: 'Çakışan Kola', barkod: '8690000000017', satis_fiyati: 2500 },
            miktar: adet(1),
            birim_fiyat: 1500,
            kdv_orani: 20,
          },
        ],
      }),
    ).toThrow(/2\. satır/);

    // Ne ürün, ne fatura, ne hareket: hiçbiri yazılmamalı.
    expect(ortam.uygulama.baglam.vt.hazirla('SELECT COUNT(*) AS adet FROM urunler').tek<{ adet: number }>()!.adet).toBe(
      oncekiUrunSayisi,
    );
    expect(ortam.uygulama.baglam.vt.hazirla('SELECT COUNT(*) AS adet FROM alis_faturalari').tek<{ adet: number }>()!.adet).toBe(
      0,
    );
  });

  it('ürün düzenleme yetkisi olmayan kullanıcıyı reddeder', () => {
    const tedarikciId = tedarikciEkle(ortam);
    // Kasiyerde ne stok.giris ne urun.duzenle var; yetki hatası beklenir.
    expect(() =>
      malKabulOnayla(ortam.uygulama.baglam, ortam.kasiyer, {
        tedarikci_id: tedarikciId,
        kalemler: [{ yeni_urun: { ad: 'Kaçak Ürün', satis_fiyati: 1000 }, miktar: adet(1), birim_fiyat: 500, kdv_orani: 20 }],
      }),
    ).toThrow();
  });

  it('HAVALE ödemede cari kapanır ama kasa çekmecesine dokunulmaz', () => {
    const tedarikciId = tedarikciEkle(ortam);

    const sonuc = malKabulOnayla(ortam.uygulama.baglam, ortam.admin, {
      tedarikci_id: tedarikciId,
      odenen_tutar: 1200,
      odeme_tipi: 'HAVALE',
      kalemler: [{ yeni_urun: { ad: 'Havaleli Ürün', satis_fiyati: 2000 }, miktar: adet(1), birim_fiyat: 1000, kdv_orani: 20 }],
    });

    expect(sonuc.genelToplam).toBe(1200);
    expect(sonuc.kalanBorc).toBe(0);
    expect(cariBul(ortam.uygulama.baglam.vt, tedarikciId)?.bakiye).toBe(0);

    const kasaHareketi = ortam.uygulama.baglam.vt
      .hazirla('SELECT COUNT(*) AS adet FROM kasa_hareketleri WHERE belge_id = ?')
      .tek<{ adet: number }>(sonuc.faturaId);
    expect(kasaHareketi?.adet).toBe(0);
  });
});
```

- [ ] **Step 2: Testi koş, kırmızı olduğunu gör**

Run: `npx vitest run apps/desktop/test/mal-kabul-yeni-urun.test.ts`
Expected: FAIL — `yeni_urun` taşıyan kalemlerde `urunBul(vt, kalem.urun_id)` `undefined` ile çağrıldığı için "Ürün bulunamadı" hatası.

- [ ] **Step 3: `malKabulOnayla`'yı yeni ürün açacak biçimde genişlet**

`apps/desktop/src/main/servis/stok-servis.ts`:

(a) İçe aktarmalara ekle — `@market/shared` bloğuna `barkodNormalize`, `HATA_KODU`, `UygulamaHatasi`; depo bloğuna (`../depo/katalog.js`) `barkodEkle`, `barkodSahibi`:

```ts
import {
  barkodNormalize,
  gunAnahtari,
  hatalar,
  HATA_KODU,
  kdvAyir,
  simdi,
  UygulamaHatasi,
  uuid,
  // … mevcut içe aktarmalar
} from '@market/shared';
import { barkodEkle, barkodSahibi, urunBul, urunKaydet } from '../depo/katalog.js';
```

(b) `const girdi: AlisGirdi = ayrisim.data;` satırının hemen ardına yetki kapısını ekle:

```ts
  /*
   * Faturada yeni ürün açmak katalog yazmaktır: stok yetkisi tek başına
   * yetmez. Kapı burada, HİÇBİR yazma yapılmadan önce kapanır.
   */
  const yeniUrunVar = girdi.kalemler.some((k) => k.yeni_urun);
  if (yeniUrunVar) yetkiIste(aktor, 'urun.duzenle', 'faturada yeni ürün açma');
```

(c) `vt.islem(() => {` bloğunun içinde, `alisFaturasiEkle(...)` çağrısının **hemen ardına**, `for (const kalem of hesaplananlar)` döngüsünden **önce** yeni ürünleri yarat ve kalemleri çöz:

```ts
    /*
     * Yeni ürünler kalemlerden ÖNCE yaratılır: kartı olmayan bir ürüne ne
     * fatura kalemi ne stok hareketi bağlanabilir. Aynı transaction içinde
     * oldukları için barkodu çakışan tek bir satır bile belgenin tamamını
     * geri alır — toptancının karşısında yarım yazılmış fatura, kullanıcının
     * en pahalıya mal olan hâlidir.
     */
    const cozulmusKalemler = hesaplananlar.map((kalem, sira) => {
      if (kalem.urun_id) return { ...kalem, urun_id: kalem.urun_id };

      const yeni = kalem.yeni_urun!;
      const barkod = yeni.barkod ? barkodNormalize(yeni.barkod) : null;
      if (barkod) {
        const sahip = barkodSahibi(vt, barkod);
        if (sahip) {
          const sahipUrun = urunBul(vt, sahip);
          throw new UygulamaHatasi(
            HATA_KODU.BARKOD_KULLANIMDA,
            `${sira + 1}. satır: "${barkod}" barkodu "${sahipUrun?.ad ?? sahip}" ürününde kayıtlı.`,
            { detay: { barkod, mevcut_urun_id: sahip, satir: sira + 1 } },
          );
        }
      }

      const yeniUrunId = urunKaydet(
        vt,
        {
          ad: yeni.ad,
          kategori_id: yeni.kategori_id ?? null,
          marka: yeni.marka ?? null,
          birim_tipi: yeni.birim_tipi,
          // Maliyet faturanın kendisinden gelir; ikinci bir yerde tutulmaz.
          alis_fiyati: kalem.birim_fiyat,
          satis_fiyati: yeni.satis_fiyati,
          kdv_orani: kalem.kdv_orani,
          kritik_stok: yeni.kritik_stok ?? 0,
          varsayilan_tedarikci_id: girdi.tedarikci_id,
        },
        cihazId,
        kayitZamani,
      );

      if (barkod) {
        const barkodId = barkodEkle(vt, yeniUrunId, barkod, null, cihazId, kayitZamani);
        olayYaz(
          vt,
          {
            id: uuid(),
            olay_tipi: 'BARKOD_KAYDEDILDI',
            entity: 'barkod',
            entity_id: barkodId,
            veri: {
              id: barkodId,
              urun_id: yeniUrunId,
              barkod,
              ambalaj_aciklamasi: null,
              aktif_mi: true,
              created_at: kayitZamani,
              updated_at: kayitZamani,
            },
            olusturma_zamani: kayitZamani,
          },
          cihazId,
          kayitZamani,
        );
      }

      const kayit = urunBul(vt, yeniUrunId);
      olayYaz(
        vt,
        {
          id: uuid(),
          olay_tipi: 'URUN_KAYDEDILDI',
          entity: 'urun',
          entity_id: yeniUrunId,
          veri: kayit ?? { id: yeniUrunId },
          olusturma_zamani: kayitZamani,
        },
        cihazId,
        kayitZamani,
      );

      return { ...kalem, urun_id: yeniUrunId };
    });
```

(d) Bu noktadan sonra `hesaplananlar` yerine `cozulmusKalemler` kullanılır. Üç yeri değiştir:
- `for (const kalem of hesaplananlar) {` → `for (const kalem of cozulmusKalemler) {`
- `ALIS_FATURASI_ONAYLANDI` olayındaki `kalemler: hesaplananlar.map(...)` → `kalemler: cozulmusKalemler.map(...)`
- Döngü içindeki `urunKaydet(...)` çağrısı (alış fiyatı güncellemesi) olduğu gibi kalır; yeni ürün için de doğru çalışır çünkü kart artık vardır.

- [ ] **Step 4: Testi koş, yeşil olduğunu gör**

Run: `npx vitest run apps/desktop/test/mal-kabul-yeni-urun.test.ts`
Expected: PASS (5 test)

- [ ] **Step 5: Bütün testleri ve tipleri koş**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS — Görev 1'de beklenen tip hatası da bu değişiklikle kapanır.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/servis/stok-servis.ts apps/desktop/test/mal-kabul-yeni-urun.test.ts
git commit -m "feat(kasa): mal kabul faturada yeni ürün kartı açabilsin

Yeni ürünler kalemlerden önce, aynı transaction içinde yaratılır; barkod
çakışan tek satır belgenin tamamını geri alır. Açılış stoğu diye ayrı bir
hareket yoktur: stok faturanın GIRIS hareketidir ve belge_id taşır.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Görev 3: CSV içe aktarmada açılış stoğu buluta gitsin

**Files:**
- Modify: `apps/desktop/src/main/servis/katalog-servis.ts` (`urunleriIceAktar`, satır ~741)
- Test: `apps/desktop/test/urun-ice-aktarim.test.ts` (yeni)

**Interfaces:**
- Consumes: `stokOlayiYaz(baglam, hareketId, urunId, tip, miktar, aktor, zaman)` — `../servis/stok-servis.js` içinde tanımlı.
- Produces: davranış değişikliği; imza değişmez.

- [ ] **Step 1: Testi yaz**

`apps/desktop/test/urun-ice-aktarim.test.ts`:

```ts
/**
 * CSV içe aktarma açılış stoğu yazıyordu ama olayını kuyruğa DÜŞMÜYORDU:
 * miktar yalnız kasada kalıyor, panel ilk günden farklı bir stok gösteriyordu.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet } from '@market/shared';
import { barkodSahibi } from '../src/main/depo/katalog.js';
import { stokOku } from '../src/main/depo/stok.js';
import { urunleriIceAktar } from '../src/main/servis/katalog-servis.js';
import { testOrtamiKur, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

describe('CSV içe aktarma', () => {
  it('açılış stoğunu yazar ve STOK_HAREKETI olayını kuyruğa düşer', () => {
    const csv = ['ad;barkod;satis_fiyati;alis_fiyati;acilis_stogu', 'İçe Aktarılan Kola;8690000000024;25,00;15,00;7'].join('\n');

    const sonuc = urunleriIceAktar(ortam.uygulama.baglam, ortam.admin, csv, true);
    expect(sonuc.eklenen).toBe(1);
    expect(sonuc.hatali).toBe(0);

    const urunId = barkodSahibi(ortam.uygulama.baglam.vt, '8690000000024');
    expect(stokOku(ortam.uygulama.baglam.vt, urunId!)).toBe(adet(7));

    const olaylar = ortam.uygulama.baglam.vt
      .hazirla('SELECT olay_tipi FROM sync_outbox')
      .tumu<{ olay_tipi: string }>()
      .map((o) => o.olay_tipi);
    expect(olaylar).toContain('STOK_HAREKETI');
  });
});
```

- [ ] **Step 2: Testi koş, kırmızı olduğunu gör**

Run: `npx vitest run apps/desktop/test/urun-ice-aktarim.test.ts`
Expected: FAIL — `expect(olaylar).toContain('STOK_HAREKETI')` başarısız (ürün ve barkod olayları var, stok olayı yok).

- [ ] **Step 3: Eksik olayı yaz**

`apps/desktop/src/main/servis/katalog-servis.ts` içinde açılış stoğu bloğunu şuna çevir:

```ts
          if (!mevcutUrunId && acilisStogu > 0) {
            const acilisHareketId = hareketEkle(
              vt,
              {
                urun_id: urunId,
                hareket_tipi: 'ACILIS',
                miktar: acilisStogu,
                birim_maliyet: alisFiyati,
                belge_tipi: 'ICE_AKTARIM',
                aciklama: 'CSV açılış stoğu',
                kullanici_id: aktor.kullaniciId,
              },
              cihazId,
              zaman,
            );
            // Olay ŞART: hareket yalnız yerelde kalırsa merkezdeki stok özeti
            // açılış miktarını hiç görmez ve panel ile kasa ilk günden ayrışır.
            stokOlayiYaz(baglam, acilisHareketId, urunId, 'ACILIS', acilisStogu, aktor, zaman);
          }
```

`stokOlayiYaz` içe aktarmasını dosyanın başındaki `../servis/stok-servis.js` (yoksa `./stok-servis.js`) bloğuna ekle.

- [ ] **Step 4: Testi koş, yeşil olduğunu gör**

Run: `npx vitest run apps/desktop/test/urun-ice-aktarim.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/servis/katalog-servis.ts apps/desktop/test/urun-ice-aktarim.test.ts
git commit -m "fix(kasa): CSV açılış stoğu senkron kuyruğuna düşsün

Hareket yazılıyor ama olayı kuyruğa girmiyordu; CSV ile kurulan katalogda
panel ile kasa ilk günden farklı stok gösteriyordu.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Görev 4: Satır → kalem dönüştürücü (paylaşılan, saf)

Kasa ve panel aynı tabloyu dolduruyor: metin alanlarını kuruş/bindebir kalemlere çeviren kural tek yerde yaşamalı, yoksa iki ekran aynı satırdan farklı fatura üretir.

**Files:**
- Create: `packages/shared/src/toplu-urun.ts`
- Modify: `packages/shared/src/index.ts` (dışa aktarım)
- Test: `packages/shared/test/toplu-urun.test.ts` (yeni)

**Interfaces:**
- Consumes: `paraParse`, `miktarParse`, `marjdanFiyat`, `barkodNormalize`, `YeniUrunKalemi` (Görev 1).
- Produces:
  - `interface TopluGirisSatiri { barkod: string; ad: string; miktar: string; alis: string; satis: string; kdv: string; urun_id?: string }` — arayüzdeki ham metin satırı.
  - `topluGirisKalemleri(satirlar: TopluGirisSatiri[], secenekler?: { marjYuzde?: number | null }): { kalemler: AlisKalemGirdisi[]; hatalar: { satir: number; mesaj: string }[] }`
  - `satirSatisFiyati(satir: TopluGirisSatiri, marjYuzde: number | null | undefined): number | null` — satırda elle yazılmış fiyat varsa o, yoksa marjdan hesaplanan.

- [ ] **Step 1: Testi yaz**

`packages/shared/test/toplu-urun.test.ts`:

```ts
/**
 * Toplu giriş satırlarının kaleme çevrilmesi. Buradaki hata doğrudan yanlış
 * fatura demektir: 2,5 kg "2500 bindebir", 15,00 ₺ "1500 kuruş" olmak zorunda.
 */

import { describe, expect, it } from 'vitest';
import { topluGirisKalemleri, type TopluGirisSatiri } from '@market/shared';

function satir(ek: Partial<TopluGirisSatiri> = {}): TopluGirisSatiri {
  return { barkod: '', ad: 'Kola 1L', miktar: '12', alis: '15,00', satis: '25,00', kdv: '20', ...ek };
}

describe('topluGirisKalemleri', () => {
  it('metin satırını kuruş ve bindebir kaleme çevirir', () => {
    const { kalemler, hatalar } = topluGirisKalemleri([satir({ barkod: '8690000000017' })]);
    expect(hatalar).toEqual([]);
    expect(kalemler).toEqual([
      {
        yeni_urun: { ad: 'Kola 1L', barkod: '8690000000017', satis_fiyati: 2500 },
        miktar: 12_000,
        birim_fiyat: 1500,
        kdv_orani: 20,
      },
    ]);
  });

  it('satış fiyatı boşsa kâr marjından hesaplar', () => {
    const { kalemler } = topluGirisKalemleri([satir({ satis: '' })], { marjYuzde: 40 });
    // 1500 / (1 - 0,40) = 2500 matrah; %20 KDV → 3000
    expect(kalemler[0]!.yeni_urun!.satis_fiyati).toBe(3000);
  });

  it('elle yazılan satış fiyatı marjı ezer', () => {
    const { kalemler } = topluGirisKalemleri([satir({ satis: '27,50' })], { marjYuzde: 40 });
    expect(kalemler[0]!.yeni_urun!.satis_fiyati).toBe(2750);
  });

  it('mevcut ürün satırını urun_id ile bağlar, yeni_urun üretmez', () => {
    const { kalemler } = topluGirisKalemleri([satir({ urun_id: '44444444-4444-4444-8444-444444444444' })]);
    expect(kalemler[0]!.urun_id).toBe('44444444-4444-4444-8444-444444444444');
    expect(kalemler[0]!.yeni_urun).toBeUndefined();
  });

  it('ondalıklı miktarı bindebire çevirir', () => {
    const { kalemler } = topluGirisKalemleri([satir({ miktar: '2,5' })]);
    expect(kalemler[0]!.miktar).toBe(2500);
  });

  it('eksik ad, sıfır miktar ve okunamayan fiyatı satır numarasıyla bildirir', () => {
    const { kalemler, hatalar } = topluGirisKalemleri([
      satir({ ad: '  ' }),
      satir({ miktar: '0' }),
      satir({ alis: 'abc' }),
      satir({ satis: '' }),
    ]);
    expect(kalemler).toEqual([]);
    expect(hatalar.map((h) => h.satir)).toEqual([1, 2, 3, 4]);
    expect(hatalar[0]!.mesaj).toContain('Ürün adı');
    expect(hatalar[3]!.mesaj).toContain('Satış fiyatı');
  });

  it('tamamen boş satırı yok sayar (kullanıcı fazladan satır açmış olabilir)', () => {
    const { kalemler, hatalar } = topluGirisKalemleri([
      { barkod: '', ad: '', miktar: '', alis: '', satis: '', kdv: '20' },
      satir(),
    ]);
    expect(hatalar).toEqual([]);
    expect(kalemler).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Testi koş, kırmızı olduğunu gör**

Run: `npx vitest run packages/shared/test/toplu-urun.test.ts`
Expected: FAIL — `topluGirisKalemleri` dışa aktarılmamış ("does not provide an export named").

- [ ] **Step 3: Modülü yaz**

`packages/shared/src/toplu-urun.ts`:

```ts
/**
 * Tedarikçiden toplu ürün girişi: arayüz satırlarının fatura kalemine çevrimi.
 *
 * Kasa ve panel aynı tabloyu doldurur. Kural tek yerde durmak zorundadır:
 * aynı satırdan iki ekran farklı fatura üretirse raf etiketi ile panel
 * ayrışır ve hangisinin doğru olduğu belirsizleşir (§11.8).
 */

import { marjdanFiyat } from './hesap.js';
import { barkodNormalize } from './metin.js';
import { miktarParse } from './miktar.js';
import { paraParse } from './para.js';
import type { AlisGirdi } from './semalar.js';

export type AlisKalemGirdisi = AlisGirdi['kalemler'][number];

/** Arayüzdeki ham satır — bütün alanlar kullanıcının yazdığı metindir. */
export interface TopluGirisSatiri {
  barkod: string;
  ad: string;
  miktar: string;
  /** KDV hariç birim alış fiyatı. */
  alis: string;
  /** KDV dahil raf fiyatı. Boşsa marjdan hesaplanır. */
  satis: string;
  kdv: string;
  /** Doluysa satır mevcut bir ürüne bağlıdır; ad/barkod yalnız gösterim içindir. */
  urun_id?: string;
}

export interface TopluGirisSonucu {
  kalemler: AlisKalemGirdisi[];
  hatalar: { satir: number; mesaj: string }[];
}

function bosMu(satir: TopluGirisSatiri): boolean {
  return !satir.urun_id && !satir.ad.trim() && !satir.barkod.trim() && !satir.alis.trim() && !satir.miktar.trim();
}

/** Satırın raf fiyatı: elle yazılmışsa o, yoksa marjdan hesaplanan. */
export function satirSatisFiyati(satir: TopluGirisSatiri, marjYuzde: number | null | undefined): number | null {
  const elle = paraParse(satir.satis);
  if (elle !== null) return elle;
  const alis = paraParse(satir.alis);
  const kdv = Number(String(satir.kdv).replace(',', '.'));
  if (alis === null || !Number.isFinite(kdv)) return null;
  if (marjYuzde === null || marjYuzde === undefined || !Number.isFinite(marjYuzde) || marjYuzde >= 100) return null;
  return marjdanFiyat(alis, marjYuzde, kdv);
}

export function topluGirisKalemleri(
  satirlar: readonly TopluGirisSatiri[],
  secenekler: { marjYuzde?: number | null } = {},
): TopluGirisSonucu {
  const kalemler: AlisKalemGirdisi[] = [];
  const hatalar: { satir: number; mesaj: string }[] = [];

  satirlar.forEach((satir, sira) => {
    const satirNo = sira + 1;
    // Kullanıcı fazladan satır açmış olabilir; boş satır hata değildir.
    if (bosMu(satir)) return;

    const ad = satir.ad.trim();
    if (!satir.urun_id && !ad) {
      hatalar.push({ satir: satirNo, mesaj: 'Ürün adı zorunludur.' });
      return;
    }

    const miktar = miktarParse(satir.miktar);
    if (miktar === null || miktar <= 0) {
      hatalar.push({ satir: satirNo, mesaj: 'Miktar sıfırdan büyük olmalıdır.' });
      return;
    }

    const alis = paraParse(satir.alis);
    if (alis === null) {
      hatalar.push({ satir: satirNo, mesaj: 'Alış fiyatı okunamadı.' });
      return;
    }

    const kdvSayi = Number(String(satir.kdv).replace(',', '.'));
    const kdvOrani = Number.isFinite(kdvSayi) ? kdvSayi : 20;

    if (satir.urun_id) {
      kalemler.push({ urun_id: satir.urun_id, miktar, birim_fiyat: alis, kdv_orani: kdvOrani });
      return;
    }

    const satis = satirSatisFiyati(satir, secenekler.marjYuzde);
    if (satis === null) {
      hatalar.push({ satir: satirNo, mesaj: 'Satış fiyatı yazılmalı ya da kâr marjı girilmelidir.' });
      return;
    }

    const barkod = satir.barkod.trim() ? barkodNormalize(satir.barkod) : null;
    kalemler.push({
      yeni_urun: { ad, ...(barkod ? { barkod } : {}), satis_fiyati: satis },
      miktar,
      birim_fiyat: alis,
      kdv_orani: kdvOrani,
    } as AlisKalemGirdisi);
  });

  return { kalemler, hatalar };
}
```

`packages/shared/src/index.ts` — `semalar.js` satırının ardına ekle:

```ts
export * from './toplu-urun.js';
```

- [ ] **Step 4: Testi koş, yeşil olduğunu gör**

Run: `npx vitest run packages/shared/test/toplu-urun.test.ts`
Expected: PASS (7 test)

- [ ] **Step 5: Paylaşılan paketi derle (panel ve kasa derlenmiş çıktıyı kullanır)**

Run: `npm run build:shared && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/toplu-urun.ts packages/shared/src/index.ts packages/shared/test/toplu-urun.test.ts
git commit -m "feat(shared): toplu giriş satırlarını fatura kalemine çeviren modül

Kasa ve panel aynı tabloyu dolduruyor; metin → kuruş/bindebir çevrimi ile
marj hesabı tek yerde yaşasın diye saf bir modüle alındı.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Görev 5: Kasa arayüzü — Tedarikçiden Toplu Ürün diyaloğu

**Files:**
- Create: `apps/desktop/src/renderer/src/sayfa/stok/TopluUrunGirisiDiyalogu.tsx`
- Modify: `apps/desktop/src/renderer/src/sayfa/Urunler.tsx` (başlık düğmeleri, satır 140-170)
- Modify: `apps/desktop/src/renderer/src/sayfa/Stok.tsx` (Mal Kabul diyaloğuna kısayol notu)

**Interfaces:**
- Consumes: `topluGirisKalemleri`, `TopluGirisSatiri` (Görev 4); `cagir('stok.malKabul', girdi)`; `Diyalog`, `Alan` (`bilesen/temel`); `UrunSecici`, `SecilenUrun` (`bilesen/UrunSecici`); `useYetki` (`durum/oturum`); `bildir`, `hatayiBildir` (`durum/bildirim`).
- Produces: `TopluUrunGirisiDiyalogu({ acik, onKapat, onTamam }: { acik: boolean; onKapat: () => void; onTamam: () => void })`

- [ ] **Step 1: Diyaloğu yaz**

`apps/desktop/src/renderer/src/sayfa/stok/TopluUrunGirisiDiyalogu.tsx`:

```tsx
/**
 * Tedarikçiden toplu ürün girişi (§11.8).
 *
 * Toptancıdan gelen malın çoğu katalogda yoktur. Bu ekran ürün kartlarını
 * açar VE malı fatura olarak kaydeder: tek belge, tek transaction. Böylece
 * iki hafta sonra "bu ürünleri kimden, ne zaman, kaça aldım" sorusu Stok →
 * Alış Faturaları ekranından cevaplanır.
 *
 * Kayıt işini kendisi yapmaz; mevcut mal kabul kanalını (`stok.malKabul`)
 * çağırır — kasadan ve panelden girilen fatura aynı yoldan geçsin diye.
 */

import { useEffect, useMemo, useState } from 'react';
import { paraFormat, paraParse, topluGirisKalemleri, type Kurus, type TopluGirisSatiri } from '@market/shared';
import { Alan, Diyalog } from '../../bilesen/temel';
import { UrunSecici, type SecilenUrun } from '../../bilesen/UrunSecici';
import { bildir, hatayiBildir } from '../../durum/bildirim';
import { cagir } from '../../kopru';

interface Tedarikci {
  id: string;
  ad_unvan: string;
}

interface Kategori {
  id: string;
  ad: string;
}

/** Satırda ayrıca gösterim için tutulanlar (sözleşmeye gitmez). */
interface Satir extends TopluGirisSatiri {
  /** Mevcut üründen eklenen satırın adı — alanı kilitli gösterilir. */
  mevcutMu: boolean;
}

const BOS_SATIR: Satir = { barkod: '', ad: '', miktar: '1', alis: '', satis: '', kdv: '20', mevcutMu: false };

export function TopluUrunGirisiDiyalogu({
  acik,
  onKapat,
  onTamam,
}: {
  acik: boolean;
  onKapat: () => void;
  onTamam: () => void;
}) {
  const [tedarikciler, setTedarikciler] = useState<Tedarikci[]>([]);
  const [kategoriler, setKategoriler] = useState<Kategori[]>([]);
  const [tedarikciId, setTedarikciId] = useState('');
  const [kategoriId, setKategoriId] = useState('');
  const [marj, setMarj] = useState('30');
  const [faturaNo, setFaturaNo] = useState('');
  const [odemeDurumu, setOdemeDurumu] = useState<'NAKIT' | 'HAVALE' | 'BORC'>('NAKIT');
  const [satirlar, setSatirlar] = useState<Satir[]>([{ ...BOS_SATIR }]);
  const [gonderiliyor, setGonderiliyor] = useState(false);

  useEffect(() => {
    if (!acik) return;
    setSatirlar([{ ...BOS_SATIR }]);
    setFaturaNo('');
    void cagir<{ kayitlar: Tedarikci[] }>('cari.listele', { filtre: { tip: 'TEDARIKCI' }, limit: 200 })
      .then((v) => setTedarikciler(v.kayitlar))
      .catch(() => setTedarikciler([]));
    // `kategori.listele` düz dizi döndürür (tedarikçi listesinden farklı olarak
    // `kayitlar` sarmalayıcısı yoktur).
    void cagir<Kategori[]>('kategori.listele')
      .then((v) => setKategoriler(v ?? []))
      .catch(() => setKategoriler([]));
  }, [acik]);

  const marjYuzde = useMemo(() => {
    const sayi = Number(marj.replace(',', '.'));
    return Number.isFinite(sayi) && sayi > 0 && sayi < 100 ? sayi : null;
  }, [marj]);

  const { kalemler, hatalar } = useMemo(
    () => topluGirisKalemleri(satirlar, { marjYuzde }),
    [satirlar, marjYuzde],
  );

  /* Toplam KASADAKİ kuralla hesaplanır: birim fiyat KDV hariçtir. Ekranda
     görünen rakam ile servisin yazacağı rakam aynı olmalı. */
  const toplam = useMemo(() => {
    let ara = 0;
    let kdv = 0;
    for (const k of kalemler) {
      const net = Math.round((k.miktar * k.birim_fiyat) / 1000);
      ara += net;
      kdv += Math.round((net * k.kdv_orani) / 100);
    }
    return { ara, kdv, genel: ara + kdv } as { ara: Kurus; kdv: Kurus; genel: Kurus };
  }, [kalemler]);

  const satirGuncelle = (i: number, alan: keyof Satir, deger: string) =>
    setSatirlar((liste) => liste.map((s, j) => (j === i ? { ...s, [alan]: deger } : s)));

  const satirSil = (i: number) => setSatirlar((liste) => liste.filter((_, j) => j !== i));

  /** Barkod okutulunca ya da "Satır ekle" denince sona boş satır açılır. */
  const satirEkle = () => setSatirlar((liste) => [...liste, { ...BOS_SATIR }]);

  const mevcutUrunEkle = (urun: SecilenUrun) =>
    setSatirlar((liste) => [
      ...liste.filter((s) => s.ad.trim() || s.urun_id || s.barkod.trim()),
      {
        barkod: urun.barkodlar[0] ?? '',
        ad: urun.ad,
        miktar: '1',
        alis: paraFormat(urun.alis_fiyati, { simge: false }),
        satis: paraFormat(urun.satis_fiyati, { simge: false }),
        kdv: String(urun.kdv_orani),
        urun_id: urun.id,
        mevcutMu: true,
      },
    ]);

  const gonder = async () => {
    if (!tedarikciId || kalemler.length === 0 || hatalar.length > 0) return;
    setGonderiliyor(true);
    try {
      const sonuc = await cagir<{ faturaId: string; genelToplam: Kurus; kalemSayisi: number }>('stok.malKabul', {
        tedarikci_id: tedarikciId,
        fatura_no: faturaNo.trim() || null,
        odenen_tutar: odemeDurumu === 'BORC' ? 0 : toplam.genel,
        odeme_tipi: odemeDurumu === 'HAVALE' ? 'HAVALE' : 'NAKIT',
        // Başlıkta seçilen kategori yalnız bir doldurma kolaylığıdır; sözleşmede
        // kategori satır alanıdır.
        kalemler: kalemler.map((k) =>
          k.yeni_urun && kategoriId ? { ...k, yeni_urun: { ...k.yeni_urun, kategori_id: kategoriId } } : k,
        ),
      });
      bildir.basari(
        'Toplu ürün girişi tamamlandı',
        `${sonuc.kalemSayisi} kalem, ${paraFormat(sonuc.genelToplam)} tutarında fatura kaydedildi.`,
      );
      onTamam();
    } catch (hata) {
      // Diyalog KAPANMAZ: satırlar dursun, kullanıcı hatayı düzeltip yeniden göndersin.
      hatayiBildir(hata, 'Toplu ürün girişi');
    } finally {
      setGonderiliyor(false);
    }
  };

  const gecerli = Boolean(tedarikciId) && kalemler.length > 0 && hatalar.length === 0 && !gonderiliyor;

  return (
    <Diyalog
      acik={acik}
      baslik="Tedarikçiden Toplu Ürün Girişi"
      aciklama="Ürün kartları açılır, stok artar ve tedarikçi faturası oluşur — hepsi tek belgede."
      genislik="genis"
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil" onClick={() => void gonder()} disabled={!gecerli}>
            {gonderiliyor ? 'Kaydediliyor…' : `Kaydet (${paraFormat(toplam.genel)})`}
          </button>
        </>
      }
    >
      <div className="mb-3 grid gap-3 md:grid-cols-4">
        <Alan etiket="Tedarikçi *">
          <select className="alan" value={tedarikciId} onChange={(e) => setTedarikciId(e.target.value)} data-odak>
            <option value="">Seçiniz…</option>
            {tedarikciler.map((t) => (
              <option key={t.id} value={t.id}>
                {t.ad_unvan}
              </option>
            ))}
          </select>
        </Alan>
        <Alan etiket="Kategori" ipucu="Yeni ürünlerin hepsine uygulanır.">
          <select className="alan" value={kategoriId} onChange={(e) => setKategoriId(e.target.value)}>
            <option value="">Kategorisiz</option>
            {kategoriler.map((k) => (
              <option key={k.id} value={k.id}>
                {k.ad}
              </option>
            ))}
          </select>
        </Alan>
        <Alan etiket="Hedef kâr marjı %" ipucu="Satış fiyatı boş bırakılan satırlarda kullanılır.">
          <input className="alan sayi" value={marj} onChange={(e) => setMarj(e.target.value)} />
        </Alan>
        <Alan etiket="Fatura / irsaliye no">
          <input className="alan" value={faturaNo} onChange={(e) => setFaturaNo(e.target.value)} />
        </Alan>
      </div>

      <div className="mb-3">
        <UrunSecici onSec={mevcutUrunEkle} placeholder="Katalogda olan bir ürünü eklemek için barkod okutun ya da ad yazın…" />
      </div>

      <table className="tablo">
        <thead>
          <tr>
            <th className="w-40">Barkod</th>
            <th>Ürün adı</th>
            <th className="w-24">Miktar</th>
            <th className="w-28">Alış (KDV hariç)</th>
            <th className="w-28">Satış (KDV dahil)</th>
            <th className="w-20">KDV %</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {satirlar.map((s, i) => {
            const satirHatasi = hatalar.find((h) => h.satir === i + 1);
            return (
              <tr key={i} className={satirHatasi ? 'bg-tehlike-yumusak' : ''}>
                <td>
                  <input
                    className="alan py-1"
                    value={s.barkod}
                    readOnly={s.mevcutMu}
                    onChange={(e) => satirGuncelle(i, 'barkod', e.target.value)}
                    onKeyDown={(e) => {
                      // Barkod okuyucu sonda Enter gönderir: imleç ada geçsin.
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        (e.currentTarget.closest('tr')?.querySelector('[data-ad]') as HTMLElement | null)?.focus();
                      }
                    }}
                  />
                </td>
                <td>
                  <input
                    data-ad
                    className="alan py-1"
                    value={s.ad}
                    readOnly={s.mevcutMu}
                    onChange={(e) => satirGuncelle(i, 'ad', e.target.value)}
                  />
                </td>
                <td>
                  <input className="alan sayi py-1" value={s.miktar} onChange={(e) => satirGuncelle(i, 'miktar', e.target.value)} />
                </td>
                <td>
                  <input className="alan sayi py-1" value={s.alis} onChange={(e) => satirGuncelle(i, 'alis', e.target.value)} />
                </td>
                <td>
                  <input
                    className="alan sayi py-1"
                    placeholder={marjYuzde ? 'marjdan' : ''}
                    value={s.satis}
                    onChange={(e) => satirGuncelle(i, 'satis', e.target.value)}
                  />
                </td>
                <td>
                  <input className="alan sayi py-1" value={s.kdv} onChange={(e) => satirGuncelle(i, 'kdv', e.target.value)} />
                </td>
                <td>
                  <button type="button" className="text-tehlike" onClick={() => satirSil(i)} aria-label={`${i + 1}. satırı sil`}>
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" className="tus-ikincil" onClick={satirEkle}>
          + Satır
        </button>
        <Alan etiket="Ödeme">
          <select className="alan" value={odemeDurumu} onChange={(e) => setOdemeDurumu(e.target.value as typeof odemeDurumu)}>
            <option value="NAKIT">Ödedim — nakit (kasadan çıkar)</option>
            <option value="HAVALE">Ödedim — havale / kart (kasaya dokunmaz)</option>
            <option value="BORC">Ödemedim — tedarikçiye borç kalsın</option>
          </select>
        </Alan>
        <span className="ml-auto text-sm text-metin-3">
          Ara toplam {paraFormat(toplam.ara)} · KDV {paraFormat(toplam.kdv)} ·{' '}
          <strong className="text-metin-1">{paraFormat(toplam.genel)}</strong>
        </span>
      </div>

      {hatalar.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-tehlike">
          {hatalar.map((h) => (
            <li key={h.satir}>
              {h.satir}. satır: {h.mesaj}
            </li>
          ))}
        </ul>
      )}
    </Diyalog>
  );
}
```

- [ ] **Step 2: Ürünler sayfasına düğmeyi ekle**

`apps/desktop/src/renderer/src/sayfa/Urunler.tsx`:

```tsx
// Bileşenin üstündeki içe aktarmalara:
import { TopluUrunGirisiDiyalogu } from './stok/TopluUrunGirisiDiyalogu';

// UrunlerSayfasi içinde, diğer useState'lerin yanına:
const [topluGirisAcik, setTopluGirisAcik] = useState(false);
const stokGirisYetkisi = useYetki('stok.giris');

// Başlıkta "Yeni Ürün" düğmesinin HEMEN ÖNÜNE:
{duzenleyebilir && stokGirisYetkisi && (
  <button type="button" className="tus-ikincil" onClick={() => setTopluGirisAcik(true)}>
    Tedarikçiden Toplu Ürün
  </button>
)}

// Diğer diyalogların yanına (TopluFiyatDiyalogu'nun altına):
<TopluUrunGirisiDiyalogu
  acik={topluGirisAcik}
  onKapat={() => setTopluGirisAcik(false)}
  onTamam={() => {
    setTopluGirisAcik(false);
    void tazele();
  }}
/>
```

`duzenleyebilir` ve `tazele` bu dosyada zaten tanımlıdır; `tazele` adı farklıysa listeyi yenileyen mevcut çağrıyı kullan (`grep -n "tazele\|yukle" apps/desktop/src/renderer/src/sayfa/Urunler.tsx`).

- [ ] **Step 3: Mal Kabul diyaloğuna kısayol notu ekle**

`apps/desktop/src/renderer/src/sayfa/Stok.tsx` — `MalKabulDiyalogu` içindeki `UrunSecici`'nin hemen altına:

```tsx
<p className="mt-1 text-xs text-metin-4">
  Katalogda olmayan ürünler mi geldi? Ürünler ekranındaki <strong>Tedarikçiden Toplu Ürün</strong> ile kartları da
  açarak tek faturada girebilirsiniz.
</p>
```

- [ ] **Step 4: Tip ve stil denetimi**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 5: Uygulamayı çalıştırıp elle doğrula**

Run: `npm run dev:desktop`
Senaryo:
1. Yönetici olarak gir, Kasa → Açılış yap.
2. Cari ekranından bir **tedarikçi** ekle (yoksa).
3. Ürünler → "Tedarikçiden Toplu Ürün": tedarikçiyi seç, marjı 30 bırak, iki satır doldur (birine barkod yaz, diğerine yazma), satış fiyatını boş bırak → marjdan dolduğunu gör.
4. Kaydet → bildirim gelir.
5. Ürünler listesinde iki yeni ürünü, Stok → Alış Faturaları'nda tek faturayı, Cari'de tedarikçi bakiyesinin sıfır (nakit ödeme) olduğunu gör.
6. Aynı barkodu ikinci kez girmeyi dene → satır numaralı hata mesajı gelir, hiçbir şey kaydedilmez.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/sayfa/stok/TopluUrunGirisiDiyalogu.tsx apps/desktop/src/renderer/src/sayfa/Urunler.tsx apps/desktop/src/renderer/src/sayfa/Stok.tsx
git commit -m "feat(kasa): Ürünler ekranına tedarikçiden toplu ürün girişi

Barkod okutma odaklı çok satırlı diyalog: ürün kartlarını açar ve malı tek
alış faturası olarak kaydeder. Kayıt mevcut stok.malKabul kanalından geçer.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Görev 6: Bulut — talimat yeni ürün kalemi taşısın

**Files:**
- Modify: `apps/api/src/rota/yonetim.ts` (`zAlisTalimatiGovde` ~satır 757, `OLUSTUR` doğrulaması ~satır 1043)
- Test: `apps/api/test/alis-talimati.test.ts` (yeni)

**Interfaces:**
- Consumes: `panelKorumasi`, `rolIste('ADMIN','MUDUR')` (`yonetici`), `hatalar`, `sonrakiVersiyon`.
- Produces: `POST /v1/alis-talimatlari` gövdesinde `kalemler[].yeni_urun` kabul edilir; `urun_id` opsiyonel olur.

- [ ] **Step 1: Testi yaz**

`apps/api/test/alis-talimati.test.ts`:

```ts
/**
 * Panelden gelen alış talimatı: yeni ürün açan kalemler de taşınır.
 * Bulut ürünü YARATMAZ — belgeyi ve kartı kasa üretir; buradaki doğrulama
 * yalnız "kullanıcı hâlâ ekrandayken" hatayı göstermek içindir.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { simdi, UCLAR, uuid } from '@market/shared';
import { parolaHashle, tokenHashle } from '../src/guvenlik.js';
import { sunucuOlustur } from '../src/sunucu.js';
import { vtOlustur, type MerkezVt } from '../src/vt/baglanti.js';
import { yapilandirmayiOku } from '../src/yapilandirma.js';

let uygulama: FastifyInstance;
let vt: MerkezVt;
let geciciKlasor: string;
let token: string;

const ISLETME_ID = '11111111-1111-4111-8111-111111111111';
const TEDARIKCI_ID = '55555555-5555-4555-8555-555555555555';
const MUSTERI_ID = '66666666-6666-4666-8666-666666666666';
const CIHAZ_TOKEN = 'test-cihaz-tokeni-yeterince-uzun-1234567890';

async function girisYap(kullaniciAdi: string, sifre: string): Promise<string> {
  const yanit = await uygulama.inject({ method: 'POST', url: UCLAR.giris, payload: { kullanici_adi: kullaniciAdi, sifre } });
  return (yanit.json() as { access_token: string }).access_token;
}

/**
 * Panel girişi YALNIZ ADMIN'e token verir (`kimlik.ts`: `WHERE ... rol = 'ADMIN'`).
 * Rotadaki rol kapısını sınamak için token doğrudan imzalanır — aksi hâlde
 * "müdür geçiyor mu, kasiyer düşüyor mu" sorusu hiç sorulamaz.
 */
function rolTokeni(rol: string): string {
  return uygulama.jwt.sign({ sub: uuid(), isletme_id: ISLETME_ID, rol, kullanici_adi: 'rol-testi' });
}

function talimatGonder(govde: unknown, erisim = token) {
  return uygulama.inject({
    method: 'POST',
    url: UCLAR.alisTalimatlari,
    headers: { authorization: `Bearer ${erisim}` },
    payload: govde,
  });
}

beforeEach(async () => {
  geciciKlasor = mkdtempSync(join(tmpdir(), 'market-alis-talimat-test-'));
  vt = vtOlustur('file:' + join(geciciKlasor, 'merkez.db').replace(/\\/g, '/'));
  uygulama = await sunucuOlustur({
    yapilandirma: yapilandirmayiOku({
      NODE_ENV: 'test',
      JWT_SECRET: 'test-gizli-anahtar-en-az-otuz-iki-karakter-olmali',
      LOG_SEVIYESI: 'fatal',
    } as NodeJS.ProcessEnv),
    vt,
  });

  const zaman = simdi();
  await vt.calistir('INSERT INTO isletmeler (id, ad, lisans_anahtari, aktif_mi, created_at) VALUES (?, ?, ?, 1, ?)', [
    ISLETME_ID,
    'Test Market',
    'TEST-LISANS-0003',
    zaman,
  ]);
  await vt.calistir(
    `INSERT INTO cihazlar (id, isletme_id, cihaz_id, cihaz_adi, token_hash, aktif_mi, created_at, updated_at)
     VALUES (?, ?, 'kasa-01', 'Kasa 1', ?, 1, ?, ?)`,
    [uuid(), ISLETME_ID, tokenHashle(CIHAZ_TOKEN), zaman, zaman],
  );
  for (const [id, tip, ad] of [
    [TEDARIKCI_ID, 'TEDARIKCI', 'Toptancı A'],
    [MUSTERI_ID, 'MUSTERI', 'Ayşe Müşteri'],
  ] as const) {
    await vt.calistir(
      `INSERT INTO cariler (id, isletme_id, tip, ad_unvan, created_at, updated_at, versiyon, silindi_mi)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0)`,
      [id, ISLETME_ID, tip, ad, zaman, zaman],
    );
  }
  await vt.calistir(
    `INSERT INTO barkodlar (id, isletme_id, urun_id, barkod, aktif_mi, created_at, updated_at, versiyon, silindi_mi)
     VALUES (?, ?, ?, '8690000000017', 1, ?, ?, 1, 0)`,
    [uuid(), ISLETME_ID, uuid(), zaman, zaman],
  );
  await vt.calistir(
    `INSERT INTO panel_kullanicilari (id, isletme_id, ad, kullanici_adi, sifre_hash, rol, aktif_mi, created_at, updated_at)
     VALUES (?, ?, 'Patron', 'patron', ?, 'ADMIN', 1, ?, ?)`,
    [uuid(), ISLETME_ID, parolaHashle('Sifre1234'), zaman, zaman],
  );
  token = await girisYap('patron', 'Sifre1234');
});

afterEach(async () => {
  await uygulama?.close();
  vt?.kapat();
  try {
    if (geciciKlasor) rmSync(geciciKlasor, { recursive: true, force: true });
  } catch {
    /* Windows dosya tanıtıcıyı geç bırakabilir */
  }
});

function yeniUrunGovdesi(ek: Record<string, unknown> = {}) {
  return {
    tip: 'OLUSTUR',
    tedarikci_id: TEDARIKCI_ID,
    odenen_tutar: 0,
    kalemler: [
      {
        yeni_urun: { ad: 'Toptan Kola 1L', satis_fiyati: 2500 },
        miktar: 12_000,
        birim_fiyat: 1500,
        kdv_orani: 20,
      },
    ],
    ...ek,
  };
}

describe('alış talimatı — yeni ürün kalemleri', () => {
  it('yeni ürünlü talimatı kabul eder ve kasaya yazar', async () => {
    const yanit = await talimatGonder(yeniUrunGovdesi());
    expect(yanit.statusCode).toBe(200);

    const satir = await vt.tek<{ veri: string; hedef_cihaz_id: string }>(
      'SELECT veri, hedef_cihaz_id FROM alis_talimatlari WHERE isletme_id = ?',
      [ISLETME_ID],
    );
    expect(satir?.hedef_cihaz_id).toBe('kasa-01');
    expect(JSON.parse(String(satir?.veri)).kalemler[0].yeni_urun.ad).toBe('Toptan Kola 1L');
  });

  it('bulutta kullanımda olan barkodu reddeder', async () => {
    const yanit = await talimatGonder(
      yeniUrunGovdesi({
        kalemler: [
          {
            yeni_urun: { ad: 'Çakışan Kola', barkod: '8690000000017', satis_fiyati: 2500 },
            miktar: 1000,
            birim_fiyat: 1500,
            kdv_orani: 20,
          },
        ],
      }),
    );
    expect(yanit.statusCode).toBeGreaterThanOrEqual(400);
    expect(yanit.body).toContain('8690000000017');
  });

  it('aynı barkodu iki satırda taşıyan talimatı reddeder', async () => {
    const kalem = (barkod: string) => ({
      yeni_urun: { ad: 'Kola', barkod, satis_fiyati: 2500 },
      miktar: 1000,
      birim_fiyat: 1500,
      kdv_orani: 20,
    });
    const yanit = await talimatGonder(yeniUrunGovdesi({ kalemler: [kalem('8690000000024'), kalem('8690000000024')] }));
    expect(yanit.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('tedarikçi olmayan cariyi reddeder', async () => {
    const yanit = await talimatGonder(yeniUrunGovdesi({ tedarikci_id: MUSTERI_ID }));
    expect(yanit.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('müdür rolüne açıktır', async () => {
    const yanit = await talimatGonder(yeniUrunGovdesi(), rolTokeni('MUDUR'));
    expect(yanit.statusCode).toBe(200);
  });

  it('kasiyer rolüne kapalıdır', async () => {
    const yanit = await talimatGonder(yeniUrunGovdesi(), rolTokeni('KASIYER'));
    expect(yanit.statusCode).toBeGreaterThanOrEqual(400);
    expect(yanit.statusCode).not.toBe(200);
  });
});
```

- [ ] **Step 2: Testi koş, kırmızı olduğunu gör**

Run: `npx vitest run apps/api/test/alis-talimati.test.ts`
Expected: FAIL — ilk test bile geçmez; `urun_id` zorunlu olduğu için gövde doğrulamada düşer.

- [ ] **Step 3: Gövdeyi ve doğrulamayı genişlet**

`apps/api/src/rota/yonetim.ts` — `zAlisTalimatiGovde` içindeki `kalemler` alanını değiştir:

```ts
    kalemler: z
      .array(
        z
          .object({
            urun_id: z.string().uuid().optional(),
            /**
             * Faturada açılacak yeni ürün. Bulut ürünü YARATMAZ; kartı da
             * belgeyi de kasa üretir (§11.8). Buradaki alanlar yalnız taşınır.
             */
            yeni_urun: z
              .object({
                ad: z.string().trim().min(1).max(200),
                barkod: z.string().trim().max(32).nullable().optional(),
                marka: z.string().max(120).nullable().optional(),
                birim_tipi: z.enum(['ADET', 'KG', 'LT']).default('ADET'),
                kategori_id: z.string().uuid().nullable().optional(),
                satis_fiyati: z.number().int().nonnegative(),
                kritik_stok: z.number().int().nonnegative().optional(),
              })
              .optional(),
            miktar: z.number().int().positive(),
            birim_fiyat: z.number().int().nonnegative(),
            kdv_orani: z.number().min(0).max(100),
            skt: z.string().nullable().optional(),
            lot_no: z.string().max(60).nullable().optional(),
            yeni_satis_fiyati: z.number().int().nonnegative().optional(),
          })
          .refine((k) => Boolean(k.urun_id) !== Boolean(k.yeni_urun), {
            message: 'Kalem ya mevcut bir ürüne ya da yeni bir ürüne bağlı olmalıdır',
          }),
      )
      .max(200)
      .optional(),
```

Aynı şemadaki `odeme_tipi` satırını da güncelle:

```ts
    odeme_tipi: z.enum(['NAKIT', 'KART', 'HAVALE']).default('NAKIT'),
```

`OLUSTUR` dalındaki ürün doğrulama döngüsünü şununla değiştir:

```ts
        /*
         * Mevcut ürünler burada doğrulanır: kasada bulunamayan ürün talimatı
         * tümden düşürür ve kullanıcı hatayı ancak çok sonra görürdü.
         *
         * Yeni ürünlerde asıl kontrol kasadadır (barkod tekilliği orada
         * kesinleşir); buradaki ön kontrol, kullanıcı hâlâ ekrandayken
         * "bu barkod zaten var" diyebilmek içindir.
         */
        const govdedekiBarkodlar = new Set<string>();
        for (const kalem of govde.kalemler) {
          if (kalem.urun_id) {
            const urun = await islem.tek<{ id: string }>(
              'SELECT id FROM urunler WHERE isletme_id = ? AND id = ? AND silindi_mi = 0',
              [isletmeId, kalem.urun_id],
            );
            if (!urun) throw hatalar.bulunamadi('Ürün');
            continue;
          }

          const barkod = kalem.yeni_urun?.barkod?.trim();
          if (!barkod) continue;
          if (govdedekiBarkodlar.has(barkod)) {
            throw hatalar.dogrulama(`"${barkod}" barkodu aynı belgede iki kez kullanılmış.`);
          }
          govdedekiBarkodlar.add(barkod);

          const mevcut = await islem.tek<{ urun_id: string }>(
            'SELECT urun_id FROM barkodlar WHERE isletme_id = ? AND barkod = ? AND silindi_mi = 0',
            [isletmeId, barkod],
          );
          if (mevcut) throw hatalar.dogrulama(`"${barkod}" barkodu başka bir üründe kayıtlı.`);
        }
```

- [ ] **Step 4: Testi koş, yeşil olduğunu gör**

Run: `npx vitest run apps/api/test/alis-talimati.test.ts`
Expected: PASS (6 test)

- [ ] **Step 5: Tüm testler ve tipler**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/rota/yonetim.ts apps/api/test/alis-talimati.test.ts
git commit -m "feat(api): alış talimatı yeni ürün kalemi taşısın

Kalem urun_id XOR yeni_urun; barkod hem bulutta hem gövde içinde tekillik
ön kontrolünden geçer. Ürünü ve belgeyi yine kasa üretir.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Görev 7: Kasa — panelden inen yeni ürünlü talimat

Spec'in test bölümü bu yolu şart koşuyor: panelden gelen talimat kasada aynı belgeyi üretmeli ve ikinci pull'da tekrarlanmamalı. `uygula()` gövdeyi `malKabulOnayla`'ya olduğu gibi geçirdiği için **kod değişikliği beklenmiyor**; bu görev o varsayımı teste bağlar. Test kırmızı çıkarsa sebebi `alis-talimat-servis.ts` içindeki bir varsayımdır, orada düzeltilir.

**Files:**
- Test: `apps/desktop/test/alis-talimati-yeni-urun.test.ts` (yeni)
- Modify (yalnız test kırmızıysa): `apps/desktop/src/main/servis/alis-talimat-servis.ts`

**Interfaces:**
- Consumes: `alisTalimatiniSakla(vt, veri, zaman?)`, `bekleyenAlisTalimatlariniIsle(baglam, aktor) => { uygulanan: number; basarisiz: number }`, Görev 2'nin `malKabulOnayla` davranışı.
- Produces: davranış güvencesi; yeni dışa aktarım yok.

- [ ] **Step 1: Testi yaz**

`apps/desktop/test/alis-talimati-yeni-urun.test.ts`:

```ts
/**
 * Panelden inen alış talimatı katalogda olmayan ürünü de açar.
 *
 * Panel belgeyi ÜRETMEZ, yalnız niyeti yazar; kasa onu kendi mal kabul
 * servisinden geçirir. Bu test o yolun uçtan uca çalıştığını ve talimatın
 * ikinci kez uygulanmadığını kilitler.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adet, simdi, uuid } from '@market/shared';
import { barkodSahibi, urunBul } from '../src/main/depo/katalog.js';
import { stokOku } from '../src/main/depo/stok.js';
import { alisTalimatiniSakla, bekleyenAlisTalimatlariniIsle } from '../src/main/servis/alis-talimat-servis.js';
import { tedarikciEkle, testOrtamiKur, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

/** Panelin yazdığı talimatın kasadaki karşılığını kurar. */
function talimatYaz(tedarikciId: string): string {
  const id = uuid();
  ortam.uygulama.baglam.vt.islem(() =>
    alisTalimatiniSakla(ortam.uygulama.baglam.vt, {
      id,
      tip: 'OLUSTUR',
      fatura_id: null,
      veri: {
        tip: 'OLUSTUR',
        tedarikci_id: tedarikciId,
        fatura_no: 'PANEL-1',
        odenen_tutar: 0,
        odeme_tipi: 'HAVALE',
        kalemler: [
          {
            yeni_urun: { ad: 'Panelden Gelen Kola', barkod: '8690000000031', satis_fiyati: 2500 },
            miktar: adet(6),
            birim_fiyat: 1500,
            kdv_orani: 20,
          },
        ],
      },
      hedef_cihaz_id: ortam.uygulama.cihazId,
      created_at: simdi(),
    }),
  );
  return id;
}

describe('panelden inen yeni ürünlü alış talimatı', () => {
  it('ürün kartını ve faturayı kasada üretir', () => {
    const tedarikciId = tedarikciEkle(ortam, 'Panel Toptancısı');
    talimatYaz(tedarikciId);

    const sonuc = bekleyenAlisTalimatlariniIsle(ortam.uygulama.baglam, ortam.admin);
    expect(sonuc).toEqual({ uygulanan: 1, basarisiz: 0 });

    const urunId = barkodSahibi(ortam.uygulama.baglam.vt, '8690000000031');
    expect(urunId).not.toBeNull();
    expect(urunBul(ortam.uygulama.baglam.vt, urunId!)?.varsayilan_tedarikci_id).toBe(tedarikciId);
    expect(stokOku(ortam.uygulama.baglam.vt, urunId!)).toBe(adet(6));
  });

  it('ikinci kez işlenince tekrar uygulanmaz', () => {
    const tedarikciId = tedarikciEkle(ortam);
    talimatYaz(tedarikciId);

    bekleyenAlisTalimatlariniIsle(ortam.uygulama.baglam, ortam.admin);
    const ikinci = bekleyenAlisTalimatlariniIsle(ortam.uygulama.baglam, ortam.admin);
    expect(ikinci).toEqual({ uygulanan: 0, basarisiz: 0 });

    const faturalar = ortam.uygulama.baglam.vt.hazirla('SELECT COUNT(*) AS adet FROM alis_faturalari').tek<{ adet: number }>();
    expect(faturalar?.adet).toBe(1);
  });
});
```

- [ ] **Step 2: Testi koş**

Run: `npx vitest run apps/desktop/test/alis-talimati-yeni-urun.test.ts`
Expected: PASS (2 test). Kırmızıysa hata mesajını oku: `alis-talimat-servis.ts` gövdeyi `malKabulOnayla`'ya değiştirmeden geçirmiyor demektir — orada düzelt, testi tekrar koş.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/test/alis-talimati-yeni-urun.test.ts
git commit -m "test(kasa): panelden inen yeni ürünlü alış talimatı

Talimat kasada ürünü ve faturayı üretiyor, ikinci işlemede tekrarlamıyor.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Görev 8: Panel arayüzü — yeni ürün satırı, marj ve ödeme

**Files:**
- Modify: `apps/panel/src/app/alis/page.tsx` (`YeniFaturaDiyalogu`, satır 477-751)
- Modify: `apps/panel/src/app/urunler/page.tsx` (kısayol düğmesi)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `topluGirisKalemleri`, `TopluGirisSatiri` (Görev 4); `POST /v1/alis-talimatlari` (Görev 6); `Modal`, `Rozet` (`@/bilesen/kabuk`); `api`, `uclar` (`@/lib/api`).
- Produces: kullanıcıya görünen davranış; dışa aktarılan yeni API yok.

- [ ] **Step 1: Yeni fatura diyaloğunu satır tipi taşıyacak biçimde değiştir**

`apps/panel/src/app/alis/page.tsx`:

(a) İçe aktarmalara `topluGirisKalemleri, type TopluGirisSatiri` ekle (`@market/shared`).

(b) `SatirGirdisi` ve `BOS_SATIR`'ı değiştir:

```tsx
/** Satır ya katalogdaki bir ürüne bağlıdır ya da faturada açılacak yeni üründür. */
interface SatirGirdisi extends TopluGirisSatiri {
  tip: 'mevcut' | 'yeni';
}

const BOS_SATIR: SatirGirdisi = { tip: 'mevcut', urun_id: '', barkod: '', ad: '', miktar: '1', alis: '', satis: '', kdv: '20' };
```

(c) `form` durumuna marj ve HAVALE ekle:

```tsx
    odeme_tipi: 'NAKIT' as 'NAKIT' | 'KART' | 'HAVALE',
    marj: '30',
```

(d) `hesap` ve `gecerliSatirlar`/`gonder` hesaplarını paylaşılan çevirici üzerinden kur:

```tsx
  const marjYuzde = useMemo(() => {
    const sayi = Number(form.marj.replace(',', '.'));
    return Number.isFinite(sayi) && sayi > 0 && sayi < 100 ? sayi : null;
  }, [form.marj]);

  // Satırları kaleme çeviren kural kasayla ORTAK: aynı satırdan iki ekran
  // farklı fatura üretmesin.
  const { kalemler, hatalar: satirHatalari } = useMemo(
    () => topluGirisKalemleri(satirlar.map((s) => (s.tip === 'mevcut' ? s : { ...s, urun_id: undefined })), { marjYuzde }),
    [satirlar, marjYuzde],
  );

  const hesap = useMemo(() => {
    let ara = 0;
    let kdv = 0;
    for (const k of kalemler) {
      const net = Math.round((k.miktar * k.birim_fiyat) / 1000);
      ara += net;
      kdv += Math.round((net * k.kdv_orani) / 100);
    }
    return { ara, kdv, genel: ara + kdv };
  }, [kalemler]);

  const gecerli = Boolean(form.tedarikci_id) && kalemler.length > 0 && satirHatalari.length === 0 && !gonderiliyor;
```

(e) `gonder` içindeki `kalemler: gecerliSatirlar.map(...)` bloğunu `kalemler` değişkeniyle değiştir; `odeme_tipi: form.odeme_tipi` olarak kalsın.

(f) Satır arayüzünde tip seçicisi: `tip === 'mevcut'` iken bugünkü ürün `<select>`'i (`urun_id`), `tip === 'yeni'` iken barkod + ad + satış fiyatı alanları gösterilir. Panel mobil-önceliklidir: satırlar dar ekranda kart (`div.kart` + dikey alanlar), `md` ve üstünde tablo satırı olarak dizilir — bugünkü diyaloğun düzen sınıfları korunur. Mevcut ürün seçilince bugün olduğu gibi alış fiyatı ve KDV karttan doldurulur; `satirGuncelle`'deki `alan === 'urun_id'` dalı `s.alis`/`s.kdv` alanlarını dolduracak şekilde güncellenir:

```tsx
      if (alan === 'urun_id') {
        const urun = urunHaritasi.get(deger);
        if (urun) {
          satir.alis = paraFormat(urun.alis_fiyati, { simge: false });
          satir.kdv = String(urun.kdv_orani);
          satir.ad = urun.ad;
        }
      }
```

(g) Satır hatalarını listenin altında satır numarasıyla göster:

```tsx
{satirHatalari.length > 0 && (
  <ul className="mt-2 space-y-1 text-xs text-tehlike">
    {satirHatalari.map((h) => (
      <li key={h.satir}>
        {h.satir}. satır: {h.mesaj}
      </li>
    ))}
  </ul>
)}
```

(h) Ödeme seçeneğine HAVALE ekle (mevcut NAKIT/KART seçicisine üçüncü seçenek):

```tsx
<option value="HAVALE">Havale / EFT (kasaya dokunmaz)</option>
```

- [ ] **Step 2: Ürünler sayfasına kısayol ekle**

`apps/panel/src/app/urunler/page.tsx` — "Yeni Ürün" düğmesinin hemen öncesine (diyalog burada KOPYALANMAZ, Alış sayfasına yönlendirilir):

```tsx
<a className="tus-ikincil" href="/alis?yeni=1">
  Tedarikçiden Toplu Ürün
</a>
```

`apps/panel/src/app/alis/page.tsx` içinde `AlisSayfasi` bileşeninde sorgu parametresini oku:

```tsx
import { useSearchParams } from 'next/navigation';
// …
const aramaParametreleri = useSearchParams();
const [yeniAcik, setYeniAcik] = useState(aramaParametreleri.get('yeni') === '1');
```

- [ ] **Step 3: Derleme ve tip denetimi**

Run: `npm run typecheck && npm run lint && npm run build -w @market/panel`
Expected: PASS. `useSearchParams` bir Suspense sınırı isterse Next.js hatası verir; bu durumda `AlisSayfasi`'nin dışına `<Suspense>` sarmalayıcı ekle (Next 14 App Router kuralı).

- [ ] **Step 4: Elle doğrula**

Run (üç terminal): `npm run dev:api`, `npm run dev:panel`, `npm run dev:desktop`
Senaryo:
1. Panelde Alış → Yeni Fatura: tedarikçi seç, bir satırı "yeni ürün" yap, ad + alış fiyatı yaz, satışı boş bırak (marjdan dolar), bir satırı da mevcut üründen seç.
2. Gönder → "kasada uygulanmayı bekliyor" davranışını gör.
3. Kasada Ayarlar → Senkron → şimdi senkronla.
4. Kasada Ürünler listesinde yeni ürünün, Stok → Alış Faturaları'nda faturanın oluştuğunu gör.
5. Panelde senkron sonrası Ürünler listesinde yeni ürünün göründüğünü doğrula.

- [ ] **Step 5: CHANGELOG'a işle**

`CHANGELOG.md` — "## [2.0.0]" başlığının üstüne:

```markdown
## [Yayımlanmamış]

### Eklenenler
- **Tedarikçiden toplu ürün girişi:** toptancıdan gelen mal, katalogda olmayan
  ürünlerin kartları da açılarak tek alış faturasında girilebiliyor. Kasada
  Ürünler → "Tedarikçiden Toplu Ürün", panelde Alış → Yeni Fatura. Fatura
  tedarikçiye ve tarihe göre sonradan açılıp incelenebilir, yanlışsa iptal
  edilebilir. Yetki: yönetici ve müdür (`stok.giris` + `urun.duzenle`).
- Alış ödemelerinde **havale/EFT** seçeneği: cari borç kapanır, kasa
  çekmecesine dokunulmaz.

### Düzeltmeler
- CSV içe aktarmada açılış stoğu senkron kuyruğuna düşmüyordu; panel ile kasa
  ilk günden farklı stok gösteriyordu.
```

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/app/alis/page.tsx apps/panel/src/app/urunler/page.tsx CHANGELOG.md
git commit -m "feat(panel): alış faturasına yeni ürün satırı, kâr marjı ve havale

Panelden de katalogda olmayan ürünler faturayla birlikte açılabiliyor;
satır → kalem çevrimi kasayla ortak modülden geçiyor.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Bitirme kontrolü

- [ ] `npm test` — tamamı yeşil
- [ ] `npm run typecheck && npm run lint` — temiz
- [ ] `npm run build` — üç paket de derleniyor
- [ ] Spec'teki "Test" bölümündeki senaryoların hepsinin bir testte karşılığı var
- [ ] Kasa ve panel senaryoları elle bir kez uçtan uca koşuldu (Görev 5 Step 5, Görev 8 Step 4)
