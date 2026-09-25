# Market Otomasyon Sistemi

**Barkodlu stok + cari hesaplı, offline-first market otomasyonu.**
Masaüstü kasa uygulaması · bulut senkron servisi · mobil-öncelikli web yönetim paneli.

Bu depo, `market-otomasyon-blueprint v2.0` belgesinin uygulamasıdır. Kod içindeki
`§` referansları blueprint bölümlerine karşılık gelir.

---

## Temel ilkeler

| İlke | Uygulama |
|---|---|
| **Offline-first** | Kasa internet olmadan %100 çalışır. Gün içi kaynak doğruluk yereldir. |
| **Append-only** | Stok miktarı ve cari bakiye asla üzerine yazılmaz; hareketlerden hesaplanır. Veritabanı tetikleyicileri `UPDATE`/`DELETE` denemesini reddeder. |
| **Tek transaction** | Satış = kalemler + ödemeler + stok + kasa + cari + özet + outbox olayı. Ya hepsi ya hiçbiri. |
| **İdempotent senkron** | Her olayın UUID'si vardır; aynı olay iki kez gitse sunucuda tek kayıt oluşur. |
| **Parada float yok** | Tüm tutarlar tam sayı **kuruş**; miktarlar tam sayı **bindebir** (0,001 kg). |
| **Kasa asla durmaz** | Yazıcı, internet, bulut veya lisans sorunu satışı engellemez. |

---

## Hızlı başlangıç

Gereksinimler: **Node.js 20.11+** (22 LTS önerilir), npm 10+.

```bash
npm install
npm run build:shared
npm test
```

### Kasa uygulamasını çalıştır

```bash
npm run dev:desktop
```

İlk açılışta kurulum sihirbazı gelir: işletme bilgileri → yönetici hesabı → özet.
Kurulumdan sonra **Kasa → Açılış** yapın, ardından satış ekranı kullanılabilir olur.

### Bulut API'yi çalıştır

```bash
cp apps/api/.env.example apps/api/.env
npm run seed -w @market/api
npm run dev:api
```

`seed` komutu bir işletme, panel yöneticisi ve **lisans anahtarı** üretir.
Bu anahtarı kasadaki *Ayarlar → Senkron → Cihazı Aktive Et* adımında kullanın.

### Yönetim panelini çalıştır

```bash
cp apps/panel/.env.example apps/panel/.env.local
npm run dev:panel
```

Panel `http://localhost:3100` adresinde açılır.

---

## Depo yapısı

```
packages/shared     Para/miktar aritmetiği, Zod şemaları, iş kuralı hesapları,
                    yetki matrisi, API sözleşmesi — üç uygulamada da aynı kod
apps/desktop        Electron kasa uygulaması
  src/main            İş kuralları, SQLite, senkron motoru, donanım, IPC
  src/preload         contextBridge köprüsü (yalın ve dar yüzey)
  src/renderer        React arayüz (klavye-öncelikli satış ekranı)
apps/api            Fastify + libSQL/Turso senkron ve rapor servisi
apps/panel          Next.js mobil-öncelikli yönetim paneli (PWA)
docs/               İşletim, güvenlik, KVKK ve senkron protokolü belgeleri
docs/tasarim/       Özellik tasarım notları (karar gerekçeleri)
```

### Neden bu üçlü?

Kasa **yerelde** çalışır çünkü market internetsiz kalınca satış duramaz.
API yalnız **senkron ve raporlama** yapar; iş kuralları orada tekrarlanmaz.
Panel **hiç ham veri taramaz**, yalnız özet (rollup) tablolarını okur — bu, bulut
okuma maliyetini 100–1000 kat düşürür (blueprint §6.5).

---

## Komutlar

| Komut | Açıklama |
|---|---|
| `npm test` | Tüm birim + entegrasyon + sözleşme testleri |
| `npm run test:coverage` | Kapsam raporu (alan bazlı eşikler — bkz. `vitest.config.ts`) |
| `npm run typecheck` | Tüm paketlerde tip kontrolü |
| `npm run format` / `format:check` | Prettier |
| `npm run build` | shared + api + desktop derlemesi |
| `npm run dist:desktop` | Windows kurulum paketi (`.exe`) üretir |
| `npm run seed -w @market/desktop` | Kasaya demo katalog + satış verisi yükler |
| `npm run seed -w @market/api` | Bulutta işletme + lisans anahtarı oluşturur |
| `npm run native -w @market/desktop` | Yerel SQLite ikilisini Node ve Electron için hazırlar |

### Yerel modül (native) hakkında

`better-sqlite3` **ABI'ye özel** derlenir ve bu depoda iki çalışma zamanı var:
Node (test, seed, API) ve Electron (kasa). Tek dosya ikisine birden hizmet edemez —
`npm install` yalnız Node sürümünü indirir ve kasa uygulaması açılmaz.

`npm run native` her iki ikiliyi de indirip ABI numarasıyla yan yana saklar
(`better_sqlite3-abi130.node`, `better_sqlite3-abi141.node`); sürücü çalışma anında
`process.versions.modules` ile doğru olanı seçer. Takas gerekmez, iki ortam aynı
anda çalışır.

Bu adım `dev` ve `dist` öncesinde **otomatik** çalışır. Elle çalıştırmanız
gereken tek durum: `npm install` sonrası doğrudan `npm run start -w @market/desktop`
demek.

> **Not:** Electron 33 gömülü Node 20 kullandığı için `node:sqlite` yedek sürücüsü
> orada **yoktur**; yedek yalnız Node tarafındaki betikler için anlamlıdır. Kasa
> uygulaması doğru ABI ikilisine ihtiyaç duyar.

---

## Veri modeli özeti

Hareket tabloları **append-only**'dir ve özet tabloları tetikleyicilerle güncellenir:

```
stok_hareketleri  ──(trigger)──▶  stok_ozet.miktar
cari_hareketler   ──(trigger)──▶  cari_ozet.bakiye
satislar/kalemler ──(servis)───▶  gunluk_ozet, urun_satis_ozet
her yerel yazma   ──(aynı tx)──▶  sync_outbox
```

`stogYenidenHesapla()` ve `ozetleriYenidenHesapla()` her an gerçeği hareketlerden
yeniden üretebilir — özet tabloları yalnız hızlandırıcıdır, kaynak doğruluk değildir.

---

## Senkron protokolü

Bir senkron turu = **önce PUSH, sonra PULL**.

- **PUSH** — `sync_outbox`'taki olaylar 500'lük partiler hâlinde gönderilir.
  Sunucu her olayın UUID'sini `islenen_olaylar` defterine yazar; ikinci gelişte
  "yinelenen" der ve tekrar işlemez. Yalnız sunucunun **kabul ettiği** UUID'ler
  yerelde arşivlenir — kopan bağlantı veri kaybettirmez.
- **PULL** — `?since=<sürüm>` ile yalnız değişen yönetimsel kayıtlar iner.
- **Çakışma** — Hareketler append-only olduğu için çakışmaz. Ürün/cari gibi çift
  yönlü kayıtlarda **Last-Write-Wins** uygulanır ve çakışma `sync_cakismalar`'a
  loglanarak panelde görünür.

Ayrıntı: [`docs/senkron-protokolu.md`](docs/senkron-protokolu.md)

---

## Test stratejisi

| Katman | Kapsam |
|---|---|
| Birim | Para/KDV/iskonto aritmetiği, stok ve cari toplamları, kredi limiti, kasa farkı, LWW |
| Entegrasyon | Gerçek SQLite üzerinde satış/iade/iptal akışı, transaction atomikliği, append-only tetikleyicileri |
| Sözleşme | Gerçek Fastify + libSQL üzerinde push idempotency, kısmi başarı, delta pull, şema uyumsuzluğu |

```bash
npm test
```

Blueprint §25'teki kabul kriterleri doğrudan test adı olarak yer alır
(örn. *"stokta 5 adet varken 3 adet satılınca stok 2 olur ve kasaya tutar girer"*).

---

## Güvenlik özeti

- Şifre ve PIN'ler **scrypt** ile hash'lenir; düz metin hiçbir yerde tutulmaz, loglanmaz.
- Cihaz ve refresh token'larının veritabanında yalnız **SHA-256 hash'i** saklanır.
- Renderer'da Node erişimi yoktur (`contextIsolation`), yalnız beyaz listedeki IPC kanalları çağrılabilir.
- Yetki kararları **her zaman ana süreçte/sunucuda** verilir; arayüzdeki gizleme yalnız kullanıcı deneyimi içindir.
- Satış ekranından gelen fiyat sunucuda yeniden hesaplanır; yetkisiz kullanıcı fiyat değiştiremez.

Ayrıntı: [`docs/guvenlik.md`](docs/guvenlik.md)

---

## ⚠️ Yasal uyarı

Bu yazılım bir **operasyon/stok/cari otomasyonu**dur. Bastığı fiş bir satış
özetidir; **mali belge değildir**. Türkiye'de nihai tüketiciye kesilecek yasal
satış belgesi GİB onaylı **Yeni Nesil ÖKC (yazarkasa)** cihazından düzenlenir.
Bu sürümde banka POS ve terazi entegrasyonu bilinçli olarak yoktur: kart tutarı
manuel işaretlenir, kg/lt ürünlerde miktar elle girilir.

KDV oranları, ÖKC yükümlülüğü, kayıt saklama süreleri ve KVKK konularında
**mali müşavir ve gerekiyorsa avukat onayı esastır.** Mevzuat değişebilir;
kod içindeki oranlar ayarlardan güncellenebilir biçimde tutulmuştur.

Ayrıntı: [`docs/kvkk.md`](docs/kvkk.md)

---

## Belgeler

- [Kurulum ve ilk çalıştırma](docs/kurulum.md)
- [Senkron protokolü](docs/senkron-protokolu.md)
- [Yedekleme ve felaket kurtarma](docs/yedekleme-dr.md)
- [Güvenlik](docs/guvenlik.md)
- [KVKK ve kişisel veri](docs/kvkk.md)
- Tasarım notları — bir özelliğin NEDEN öyle yapıldığını kaydeder:
  [panelden stok girişi](docs/tasarim/2026-09-02-panel-stok-girisi.md),
  [tedarikçi bazlı toplu ürün girişi](docs/tasarim/2026-09-11-tedarikci-bazli-toplu-urun-girisi.md)
- [Sürüm geçmişi](CHANGELOG.md)
