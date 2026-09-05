# Güvenlik

Blueprint §15'in uygulama karşılığı ve tehdit modeli.

## Kimlik ve parola

- Şifre ve PIN'ler **scrypt** (N=32768, r=8, p=1) ile hash'lenir.
  Parametreler hash'in içinde saklanır; ileride maliyet artırılırsa eski kayıtlar
  doğrulanmaya devam eder ve girişte sessizce yükseltilir.
- Blueprint argon2id/bcrypt öneriyordu; scrypt de bellek-zor bir KDF'tir ve Node
  çekirdeğinde yer aldığı için **yerel derleme gerektirmez** — kasa PC'sinde
  kurulum kırılganlığını ve tedarik zinciri yüzeyini azaltır. Hash biçimi masaüstü
  ve sunucuda aynıdır, kullanıcılar iki yönde de doğrulanabilir.
- Var olmayan kullanıcıda da hash hesaplanır; yanıt süresinden kullanıcı adı
  numaralandırması zorlaştırılır.
- 5 hatalı denemeden sonra hesap 60 saniye kilitlenir.
- Zayıf PIN'ler (`1234`, `0000`, tekrar eden haneler) reddedilir.

## Token'lar

| Token | Saklama |
|---|---|
| Cihaz token | Sunucuda yalnız **SHA-256 hash'i**. Düz metin sadece aktivasyon yanıtında bir kez döner. |
| Refresh token | Hash'lenmiş; kullanıldığında **iptal edilir ve yenisi verilir** (rotasyon). |
| Access token | Kısa ömürlü JWT (15 dk), saklanmaz. |
| Panel oturumu | `sessionStorage` — sekme kapanınca düşer, ortak bilgisayarda iz bırakmaz. |

Token'lar yüksek entropili rastgele değerlerdir; bu yüzden SHA-256 yeterlidir
(parolalardaki gibi yavaş KDF gerekmez).

## Yetki

Roller: **ADMIN**, **MUDUR**, **KASIYER** — üstüne kullanıcı bazlı ek/kaldırılan
yetkiler eklenebilir.

**Altın kural:** Yetki kararı her zaman ana süreçte (masaüstü) veya sunucuda (API)
verilir. Arayüzdeki düğme gizleme yalnız kullanıcı deneyimi içindir.

Somut örnekler:

- Satış ekranından gelen birim fiyat sunucuda **yeniden hesaplanır**. Kullanıcının
  `satis.fiyat_degistir` yetkisi yoksa gönderdiği fiyat sessizce doğru fiyata çekilir.
- Kasiyer iskonto satırı gönderirse istek `YETKI_YOK` ile reddedilir.
- Son aktif yöneticinin rolü düşürülemez veya hesabı pasifleştirilemez.

## Süreç yalıtımı (Electron)

- `contextIsolation: true`, `nodeIntegration: false`.
- Renderer'a yalnız iki yetenek açılır: beyaz listedeki IPC kanallarını çağırmak ve
  ana süreçten olay dinlemek. Dosya sistemi, `require`, ortam değişkeni erişimi yok.
- Renderer'da katı CSP; uzak script/stil yüklenemez.
- Dış bağlantılar uygulama içinde değil, varsayılan tarayıcıda açılır.
- Uygulama içi gezinme geliştirme sunucusu dışında engellenir.

## Veri bütünlüğü (Tampering)

Hareket tabloları veritabanı seviyesinde korunur:

```sql
CREATE TRIGGER trg_stok_hareket_degistirilemez BEFORE UPDATE ON stok_hareketleri
BEGIN SELECT RAISE(ABORT, 'append-only bir tablodur; güncellenemez'); END;
```

Birisi DB dosyasını açıp `UPDATE stok_hareketleri SET miktar = 999` çalıştırsa bile
işlem reddedilir. Özet tablolar da tetikleyicilerle güncellendiği için ham SQL ile
tutarsız duruma getirilemez.

Her kritik işlem `denetim_log`'a kullanıcı + zaman + cihaz iziyle yazılır.

## STRIDE özeti

| Tehdit | Önlem |
|---|---|
| **Spoofing** — sahte cihaz senkron denemesi | Cihaz token + aktivasyon; token hash'li saklanır, iptal edilebilir |
| **Tampering** — yerel DB'yi elle değiştirme | Append-only tetikleyiciler, denetim logu, sunucu tarafı yeniden hesaplama |
| **Repudiation** — "ben yapmadım" | Her işlemde kullanıcı + zaman + cihaz kimliği |
| **Information Disclosure** — cari/telefon sızıntısı | TLS, en az yetki, KVKK anonimleştirme, loglarda maskeleme |
| **DoS** — API'ye yük | Hız limiti (429 + Retry-After), parti boyutu sınırı, gövde boyutu sınırı, üstel geri çekilme |
| **Elevation of Privilege** — kasiyerin admin işlemi | Yetki kararı yalnız sunucuda; istemciye asla güvenilmez |

## Loglama

Yapılandırılmış JSON log; her kayıt izleme kimliği taşır.
`sifre`, `parola`, `pin`, `hash`, `token`, `secret`, `authorization`, `cookie`
içeren anahtarlar otomatik `***` ile maskelenir — hem masaüstünde hem API'de.

Kullanıcıya gösterilen mesaj her zaman Türkçe ve anlaşılırdır; teknik ayrıntı
yalnız logda, `izleme_id` ile eşleştirilebilir biçimde kalır.

## Aktarım

- Tüm bulut trafiği HTTPS; sertifika doğrulaması Node varsayılanıyla zorunludur.
- Üretimde `JWT_SECRET` tanımlı değilse **sunucu açılmaz** — varsayılan bir
  anahtarla çalışmak sessiz bir güvenlik açığıdır.
- CORS yalnız tanımlı kökenlere açıktır.
- Güvenlik başlıkları (`helmet`, `X-Frame-Options`, `nosniff`) uygulanır.

## Bağımlılık güvenliği

CI'da `npm audit --audit-level=high` derlemeyi durdurur. Üretim bağımlılıkları
bilinçli olarak azdır: masaüstünde yalnız `better-sqlite3` ve `electron-updater`,
API'de Fastify eklentileri ve libSQL istemcisi.

## Fiziksel / operasyonel

- Oturum zaman aşımı (varsayılan 15 dk) — kasa başında bırakılan ekran kilitlenir.
- Yedekler isteğe bağlı AES-256-GCM ile şifrelenir (USB ile taşınanlar için önerilir).
- Kayıp/çalıntı kasa: panelden cihaz token'ı iptal edilir, senkron anında durur.
