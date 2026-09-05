# Senkron Protokolü

Blueprint §7 ve §9'un uygulama karşılığı. Bu belge operasyon ekibi ve entegrasyon
yapacak geliştiriciler içindir.

## Neden bu tasarım?

Senkronun klasik iki hatası vardır: **çift kayıt** ve **veri kaybı**. İkisi de aynı
kökten çıkar — "son hâli gönderip üzerine yazmak". Bu sistem bunun yerine:

1. **Ne olduğunu** gönderir (olay), son hâli değil.
2. Her olayın **kalıcı bir kimliği** (UUID) vardır.
3. Miktar ve bakiye **hesaplanır**, aktarılmaz.

Sonuç: aynı olay yüz kez gitse sonuç değişmez; kopan bağlantı yalnız gecikmedir.

---

## Outbox deseni

Kasada her yazma işlemi, ana tablolarla **aynı transaction içinde** `sync_outbox`
tablosuna bir olay bırakır:

```
BEGIN IMMEDIATE
  INSERT INTO satislar ...
  INSERT INTO satis_kalemleri ...
  INSERT INTO stok_hareketleri ...
  INSERT INTO kasa_hareketleri ...
  INSERT INTO sync_outbox ...      ← aynı transaction
COMMIT
```

Uygulama tam bu sırada çökerse ya ikisi de yazılmıştır ya da hiçbiri. "Satış oldu
ama senkrona düşmedi" durumu **yapısal olarak imkânsızdır**.

---

## PUSH akışı

```
kasa                                     sunucu
 │  POST /v1/sync/push                      │
 │  { cihaz_id, sema_surumu, olaylar[500] } │
 │─────────────────────────────────────────▶│
 │                                          │ her olay için:
 │                                          │   islenen_olaylar'da var mı?
 │                                          │     evet → "yinelenen"
 │                                          │     hayır → işle + rollup güncelle
 │  { kabul_edilen[], yinelenen[],          │
 │    reddedilen[], sunucu_versiyonu }      │
 │◀─────────────────────────────────────────│
 │                                          │
 │ kabul + yinelenen → synced_at yazılır    │
 │ reddedilen → deneme_sayisi++, hata kaydı │
```

**Kritik nokta:** Yalnız sunucunun onayladığı UUID'ler arşivlenir. Yanıt yolda
kaybolursa olaylar bekliyor kalır ve tekrar gönderilir — sunucu bunları
"yinelenen" der, ikinci kez işlemez.

### Kısmi başarı

Bir olayın verisi bozuksa yalnız o olay reddedilir; partinin geri kalanı işlenir.
Reddedilen olay `kalici: true` ile işaretlenirse istemci tekrar denemez ve kayıt
*Ayarlar → Senkron → Hatalı olaylar* listesinde görünür.

### Şema uyumsuzluğu

Kasa şema sürümü sunucudan yeniyse push **reddedilir** (`SEMA_UYUMSUZ`, HTTP 422).
Yanlış yorumlanmış veriyi yazmaktansa durmak yeğdir. Kullanıcıya "sunucuyu
güncelleyin" mesajı gösterilir; kasa yerelde çalışmaya devam eder.

---

## PULL akışı

Sunucudaki her yönetimsel kayıt monoton artan bir `versiyon` taşır.

```
GET /v1/sync/pull?since=84213&limit=500
→ { kayitlar: [{ varlik, versiyon, silindi_mi, veri }], sunucu_versiyonu, has_more }
```

Kasa yalnız `versiyon > since` olanları alır — tüm tablo hiç taranmaz. Bu, blueprint
§6.5'teki "sadece delta çek" kuralıdır ve bulut okuma maliyetini düşük tutar.

`has_more: true` ise kasa yeni `since` ile devam eder.

**Pull edilen varlıklar:** ürünler, barkodlar, kategoriler, kampanyalar,
kullanıcılar, cariler. Satış/stok/kasa hareketleri **hiçbir zaman** buluttan
kasaya inmez — onların tek üreticisi kasadır.

### Silme: mezar taşı

Panelden silinen kayıt merkezde **fiziksel olarak kaldırılmaz**; `silindi_mi = 1`
işaretlenip yeni bir versiyon alır. Satır kaldırılsaydı kasaya iletilecek bir
versiyonu kalmaz ve kasa silmeyi asla öğrenemezdi.

Bugün bu bayrağı yalnız **kullanıcılar** için işliyoruz (§12.1). Kasa, mezar taşını
görünce kararı *yerelde yeniden verir*: o kasada satış/kasa/stok kaydı olan
kullanıcı silinmez, yalnız girişi kapatılır. Merkezin "silinebilir" kararı
doğrudan uygulanmaz, çünkü kasadaki geçmiş merkezdekinden farklı olabilir.

### Cihaza özel ayarlar korunur

Pull sırasında `cihaz.*`, `yazici.*` ve `yedek.*` ile başlayan ayarlar
uygulanmaz: her kasanın yazıcısı ve yedek klasörü farklıdır.

---

## Çakışma çözümü

| Durum | Sonuç |
|---|---|
| İki farklı kasadan aynı ürüne hareket | İkisi de eklenir; miktar toplamdır. Çakışma yoktur. |
| Panel ve kasa aynı ürünün fiyatını değiştirdi | `updated_at` yeni olan kazanır (Last-Write-Wins). |
| `updated_at` eşit | `cihaz_id` sözlük sırası ile deterministik çözülür — iki taraf da aynı sonuca varır. |

Kaybeden taraf `sync_cakismalar` tablosuna yazılır ve panelde *Çözülen çakışmalar*
altında görünür. Sessiz veri kaybı olmaz.

---

## Tetikleme modları

| Mod | Davranış |
|---|---|
| `MANUEL` | Yalnız kullanıcı "Şimdi Senkronize Et" derse. |
| `GUN_SONU` | Kasa kapanışında otomatik denenir; başarısız olsa da gün sonu geçerlidir. |
| `FIRSATCI` | İnternet varsa arka planda her N dakikada bir. |

Hata durumunda üstel geri çekilme uygulanır: 1s, 2s, 4s … azami 5 dakika.
Gürültü (jitter) eklenir ki çok kasalı kurulumda hepsi aynı anda denemesin.

---

## Kullanıcıya gösterilen durum

| Rozet | Anlamı |
|---|---|
| 🟢 | Her şey güncel |
| 🟡 | N değişiklik gönderilmeyi bekliyor |
| 🔴 | 3 gündür senkron yapılmadı — internet kontrol edilmeli |
| ⚪ | Senkron kapalı (sunucu ayarlanmamış) |

---

## Mutabakat

*Ayarlar → Senkron → Yerel–Bulut Mutabakatı* tablo bazında kayıt sayılarını
karşılaştırır. Fark varsa hangi tabloda olduğu gösterilir. Beklenen tek fark,
henüz gönderilmemiş olaylardır; onlar da ayrıca raporlanır.

---

## Kimlik doğrulama

Senkron uçları `X-Device-Token` başlığı ister. Token:

- Cihaz aktivasyonunda **bir kez** üretilir ve yalnız o anda düz metin döner.
- Sunucuda yalnız **SHA-256 hash'i** saklanır.
- Panelden iptal edilebilir — kayıp/çalıntı kasa anında senkron dışı kalır.

Panel uçları JWT kullanır; refresh token'da **rotasyon** uygulanır (kullanılan
token iptal edilir, yenisi verilir).
