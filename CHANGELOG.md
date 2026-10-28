# Sürüm Geçmişi

Bu proje [Semantic Versioning](https://semver.org/lang/tr/) kullanır.

## Yayımlanmamış

## [2.1.0] — 2026-10-28

### Yükseltme notları

- **Önce bulutu (API), sonra kasaları güncelleyin.** Yeni API eski kasalarla
  uyumludur; yeni kasa eski API ile de çalışır ama pull düzeltmesi ancak ikisi
  de güncellenince devreye girer. Güncellenmemiş kasa eski (kayıt atlayabilen)
  sayfalamayı kullanmaya devam eder.
- Kasa açılışta şema göçü 16'yı uygular (`satis_kalemleri.kaynak_kalem_id`);
  göçten önce otomatik yedek alınır. API yeni sütunları açılışta kendisi ekler.
- Kasa güncellendiğinde göç 17 senkron imlecini **bir kez sıfırlar**: ilk
  senkronda kasa bütün yönetimsel kayıtları baştan çeker ve eski sayfalamanın
  atladığı barkod/kayıtlar kendiliğinden geri gelir. Büyük katalogda bu ilk
  senkron normalden uzun sürebilir.

### Değişenler

- **Fiş ve ekstre yazdırma görüntüye çevrildi.** Yazıcının kod sayfası artık
  devrede değil; harfleri uygulama çiziyor. 2.0.0'daki CP857 yolu Türkçe'de
  ı/İ ailesini bozuyordu. Etiket tarafında TSPL + CP1254 kullanılıyor.
- **Alış faturası formu yeniden düzenlendi** (kasa ve panelde aynı): satır
  tutarı ve kâr marjı sütunları, faturada yazan toplamla karşılaştırma, yapışkan
  başlıklı kayan kalem listesi, katlanır fatura bilgileri.
- **Mal kabul ile alış faturası tek form.** Katalogda olmayan ürünler fatura ile
  aynı transaction'da açılıyor; okutulan barkod mevcut bir ürüne bağlanabiliyor.

### Düzeltilenler

- **Kasa buluttan kayıt çekerken barkodları kaybediyordu.** Sürüm sayacı tüm
  tablolarda ortak olduğu için sayfa sınırı ürünlerin ortasında dolunca daha
  küçük sürümlü barkodlar hiç inmiyordu. Pull artık imleçli sayfalıyor.
- **Panelde değiştirilen kısa kod kasada geçerli kalıyordu.** Eski kod artık
  mezar taşıyla kapanıyor, kasada pasife düşüyor.
- **İade edilen miktar ürün bazında sayılıyordu;** aynı ürün fişte iki satırda
  olunca bir satırın iadesi ötekini kilitliyordu. Artık kalem bazında.
- **Aynı satışa panelden ikinci iade verilemiyordu;** kasa iade talimatının
  sonucunu artık buluta bildiriyor.
- **Günlük nakit kasada ve panelde farklıydı** (para giriş/çıkışı, mal kabul
  nakit ödemesi, tedarikçi nakit iadesi, alış ve tahsilat iptali). Özet etkisi
  artık kasada belirlenip olayla aynen gidiyor.
- **Parça parça iadede kuruş kayması;** son parça artık kalanı alıyor.
- **Bazı kasa işlemleri oturum açmadan çalışıyordu** (alış fiyatlı ürün dışa
  aktarma, müşteri ekstresi yazdırma, fiş okuma); artık oturum ve yetki istiyor.
- **Bir kasa, kullanıcıların rolünü ve PIN'ini merkezden ezebiliyordu;** kasadan
  gelen kullanıcı kaydı artık yalnız yeni hesap açıyor.
- Kasada buluta gitmeyen kampanya yazma kanalı ve hatalı, kullanılmayan
  `ozetleriYenidenHesapla` kaldırıldı; nakit birimleri gerçek banknotlarla
  düzeltildi.
- **CI etiketle tetiklenmiyordu;** Windows kurulum paketi işi hiç çalışmıyordu.
- **Panelden inen talimat iki kez uygulanabiliyordu.** Uygulama ile "uygulandı"
  işareti ayrı yazmalardı; arada kesinti olursa iş yapılmış ama talimat bekliyor
  kalıyor ve sonraki senkronda yineleniyordu (stok 10→20, borç 120→240).
- **Talimat sonucu buluta dönmüyordu.** Düzeltme/iptal gönderilen fatura panelde
  kalıcı olarak kilitleniyordu; kasa artık sonucu bildiriyor.
- **Panelde gönderilen fatura görünmüyordu** — kasa uygulayana kadar hiçbir iz
  yoktu, kullanıcı ikinci kez gönderip iki fatura oluşturuyordu.
- **Panel oturumu sürekli düşüyordu:** token'lar sekmeyle ölen depodaydı ve
  yenileme sırasındaki her ağ hatası oturumu siliyordu.
- **Ürün etiketi hiç basılmıyordu.** Electron'da `window.prompt()` istisna atar;
  düğme sessizce ölüyordu.
- **`.tablo` içinde `text-right` ortalıyordu** — 74 yerde sağa yaslama yazılmış
  ama hiçbiri çalışmıyordu.

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
