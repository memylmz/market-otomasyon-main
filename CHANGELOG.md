# Sürüm Geçmişi

Bu proje [Semantic Versioning](https://semver.org/lang/tr/) kullanır.

## [2.0.0] — 2026-07-31

Blueprint v2.0'ın ilk tam uygulaması.

### Eklenenler

**Çekirdek**
- Paylaşılan paket: kuruş/bindebir tam sayı aritmetiği, KDV dağılımı, iskonto
  dağıtımı (largest remainder), Zod şemaları, yetki matrisi, API sözleşmesi.
- SQLite (WAL) şeması: append-only hareket tabloları, tetikleyiciyle güncellenen
  özet tabloları, versiyonlu göç sistemi.

**Kasa (masaüstü)**
- Klavye-öncelikli satış ekranı: barkod, çoklu adet, iskonto, askıya alma,
  fiyat sorgulama, parçalı ödeme, para üstü.
- İade/değişim, satış iptali, mal kabul, fire/zaiat, sayım, cari defteri,
  kasa açılış/gün sonu, yerel raporlar, hızlı ürün (manav modu).
- ESC/POS fiş ve etiket yazdırma (CP857 Türkçe), para çekmecesi.
- Şifreli yedekleme, doğrulama ve geri yükleme akışı.
- Kurulum sihirbazı, CSV içe/dışa aktarma, lisans/aktivasyon ve grace period.

**Bulut**
- Fastify + libSQL/Turso senkron servisi: idempotent push, delta pull,
  LWW çakışma çözümü ve çakışma kaydı, mutabakat uçları.
- JWT + refresh rotasyonu, cihaz token'ı (hash'li, iptal edilebilir),
  hız limiti, RFC 7807 tarzı hata gövdesi, health/ready/version uçları.

**Panel**
- Next.js mobil-öncelikli PWA: dashboard, satış raporları, ürün yönetimi ve
  toplu zam, stok/sipariş önerisi, cari yaşlandırma, cihaz ve denetim yönetimi.

**Kalite**
- 134 test: birim (para/KDV/stok/cari/yetki), entegrasyon (gerçek SQLite üzerinde
  satış/iade/iptal, transaction atomikliği, append-only tetikleyicileri),
  sözleşme (gerçek Fastify + libSQL üzerinde senkron protokolü).
- GitHub Actions CI: biçim, tip, test+kapsam, üç uygulamanın derlemesi,
  bağımlılık güvenlik taraması, etiketle tetiklenen imzalı Windows paketi.

### Bilinçli kapsam dışı

- Banka POS / ÖKC entegrasyonu — kart ödemesi manuel işaretlenir.
- Terazi entegrasyonu — kg/lt ürünlerde miktar elle girilir.
- e-Fatura / e-Arşiv otomatik kesimi.
- Çok şube / zincir yönetimi (veri modeli hazır, arayüz tek şube).

### Notlar

- Parola hash'i için argon2id/bcrypt yerine **scrypt** kullanıldı: aynı ailede,
  Node çekirdeğinde, yerel derleme gerektirmiyor.
- API için NestJS yerine **doğrudan Fastify** kullanıldı: doğrulama zaten
  paylaşılan Zod şemalarıyla yapılıyor, ek soyutlama katmanına gerek kalmadı.
