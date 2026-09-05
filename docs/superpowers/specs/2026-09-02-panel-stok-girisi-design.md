# Panelden stok girişi — tasarım

**Tarih:** 2026-09-02
**Durum:** Onaylandı, uygulanıyor
**Kapsam:** Yönetim panelinden (a) yeni ürüne açılış stoğu vermek, (b) mevcut ürünün stoğunu düzeltmek.

---

## Sorun

Panelde ürünün stok miktarı girilemiyor. Bu eksik bir ekran değil, protokolün açık bir
kuralı: [senkron-protokolu.md](../../senkron-protokolu.md) "Satış/stok/kasa hareketleri
**hiçbir zaman** buluttan kasaya inmez — onların tek üreticisi kasadır" diyor. Buna uygun
olarak API'de stok yazan hiçbir uç nokta yok; panelin ürün formunda yalnız kritik/ideal
stok eşikleri var, gerçek stok yok.

Kullanıcı her iki yeteneği de istiyor. Bu, protokol değişikliği demektir.

## Kararlar

| Karar | Seçim | Gerekçe |
|---|---|---|
| Kasaya ne iner? | Hareketin kendisi değil, **talimat** | "Stok hareketleri inmez" kuralı korunur: hareketi yine kasa üretir. |
| Çakışma | **Fark (delta)** uygulanır, mutlak değer değil | Panel 35 görürken 40 yazarsan +5 gider. Arada 3 satış olduysa sonuç 32+5=37 olur, satışlar yutulmaz. |
| Çok kasa | Talimat **tek bir hedef cihaza** yazılır | Bulutta `stok_ozet` cihaz boyutu taşımıyor; iki kasa uygularsa çift sayılırdı. |
| Açılış stoğu | Ayrı alan değil, aynı talimat mekanizması (`tip: ACILIS`) | Bulut şemasında **göç mekanizması yok** (`CREATE TABLE IF NOT EXISTS`), `urunler`'e sütun eklemek mevcut veritabanlarına inmez. Yeni tablo sorunsuz oluşur. |

## Mimari

Tek yeni pull varlığı: **`stok_duzeltmeleri`**. Hem açılış stoğunu hem düzeltmeyi taşır.

```
Panel                    Bulut (API)                      Kasa
  │                          │                              │
  ├─ POST /v1/stok-duzeltme ─►│                             │
  │   {urun_id, fark, tip,   │  stok_duzeltmeleri'ne yaz    │
  │    neden, hedef_cihaz}   │  (versiyon alır)             │
  │                          │                              │
  │                          │◄──── GET /v1/sync/pull ──────┤
  │                          │────► {varlik:'stok_duzeltmeleri'} ─►│
  │                          │                              │
  │                          │              hedef_cihaz == benim mi?
  │                          │              bu id'li hareket var mı?
  │                          │              → DUZELTME/ACILIS hareketi yaz
  │                          │                (hareket.id = düzeltme.id)
  │                          │                              │
  │                          │◄─ POST /v1/sync/push ────────┤
  │                          │   STOK_HAREKETI olayı        │
  │                          │   (ON CONFLICT DO NOTHING)   │
```

**Çift uygulamaya karşı iki katmanlı güvence:**
1. `hedef_cihaz_id` — yalnız o kasa uygular, diğerleri atlar.
2. Üretilen stok hareketinin id'si **düzeltmenin id'sidir**. Aynı talimat ikinci kez
   inse bile yerelde id çakışır ve atlanır; iki kasa bir şekilde uygulasa bile buluta
   aynı id gider ve `ON CONFLICT(isletme_id, id) DO NOTHING` tekilleştirir.

## Değişiklikler

### `packages/shared`
- `PULL_VARLIKLARI` += `'stok_duzeltmeleri'`
- `UCLAR.stokDuzeltmeleri = '/v1/stok-duzeltmeleri'`
- `zStokDuzeltmeGovde`: `{ urun_id, fark, tip: 'DUZELTME'|'ACILIS', neden, hedef_cihaz_id }`

### `apps/api`
- Şema: `stok_duzeltmeleri (isletme_id, id, urun_id, tip, fark, neden, hedef_cihaz_id,
  kullanici_id, created_at, versiyon, silindi_mi)` + versiyon indeksi
- `PULL_TABLOLARI.stok_duzeltmeleri`
- `POST /v1/stok-duzeltmeleri` (yönetici): kaydı yazar, versiyon verir, denetim kaydı düşer
- `GET /v1/stok-duzeltmeleri`: son talimatları listeler (panelde geçmiş için)

### `apps/panel`
- Ürünler tablosunda stok hücresi tıklanabilir → **Stok Düzelt** modalı: mevcut miktar,
  yeni miktar, hesaplanan fark, zorunlu neden, hedef kasa seçimi (tek cihaz varsa otomatik)
- Yeni ürün formunda **Açılış stoğu** alanı → ürün kaydedildikten sonra `tip: ACILIS`
  talimatı oluşturur
- Her ikisinde de "kasa ilk senkronda uygulayacak" uyarısı; stok rakamı kasa hareketi
  geri gönderdiğinde güncellenir

### `apps/desktop`
- `hareketEkle` opsiyonel `id` kabul eder (varsayılan `uuid()`)
- `pullKaydiniUygula`'ya `case 'stok_duzeltmeleri'`: hedef cihaz değilse atla, id'li hareket
  varsa atla, ürün yoksa uyarı loglayıp atla, aksi hâlde hareketi yaz + `stokOlayiYaz`

### `docs/senkron-protokolu.md`
Pull varlıkları listesi ve "stok hareketleri inmez" cümlesi güncellenir: inen şey hareket
değil talimattır.

## Bilinen sınır (bu tasarımın değiştirmediği)

Bugünkü modelde her kasanın yerel stoğu yalnız **kendi** hareketlerini yansıtır; hareketler
kasalar arası akmaz. Çok kasalı bir mağazada yerel rakamlar bu yüzden zaten kısmidir.
Bu tasarım o sınırı çözmez — sadece panelden gelen talimatın tek bir kasada uygulanmasını
garanti ederek durumu kötüleştirmez.

## Test

- **Kasa (vitest):** talimat uygulanır; ikinci kez gelince atlanır; başka cihaza yazılmışsa
  atlanır; bilinmeyen ürün atlanır; uygulanan hareket outbox'a `STOK_HAREKETI` olarak düşer
- **API (vitest):** POST kayıt yazar ve versiyon verir; pull `stok_duzeltmeleri` döndürür
