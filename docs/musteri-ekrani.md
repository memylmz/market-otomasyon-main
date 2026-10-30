# Müşteri Ekranı

Çift ekranlı POS'un müşteriye bakan ikinci monitörü içindir. Kasa programı
müşteri ekranını kendisi açar; ayrı bir program kurulmaz.

## Ne gösterir

| Durum | Ekranda |
|---|---|
| Kasada müşteri yok | **Bekleme:** yayın listesi sırayla döner (karşılama, kampanyalar, duyuru, ürün fiyatı, görsel/GIF, video). |
| İlk ürün okutuldu | **Sepet**, tam ekran: son okutulan ürün büyük, solda; liste ve toplam sağda. Kampanyalı ürünün eski fiyatı üstü çizili, "Bu alışverişte kazancınız" altta. |
| Satış tamamlandı | **Teşekkür:** ödenen tutar ve para üstü, birkaç saniye. Sonra bekleme. |
| Sepet temizlendi / satış iptal | Doğrudan bekleme. |

Kasiyer satış ortasında başka sayfaya geçse de müşteri sepeti görmeye devam
eder. Seçili veresiye müşterisinin adı ve borcu müşteri ekranına **gitmez**
(KVKK — arkadaki kişi görür).

## Kurulum

1. Windows'ta ikinci ekranı **Genişlet** olarak ayarlayın (Ayarlar → Sistem →
   Ekran → "Bu ekranları genişlet"). "Yinele" seçiliyse müşteri kasanın
   ekranının kopyasını görür.
2. Kasa programında **Ayarlar → Müşteri Ekranı**:
   - "Müşteri ekranını kullan" işaretleyin.
   - Monitör: **Otomatik** — kasa programının açık olmadığı ekranı kullanır.
     Çift ekranlı POS'ta doğru olan budur.
   - **Kaydet**. Durum satırı "Ekran 2 üzerinde açık" yazmalı.
3. İkinci ekran olmadan denemek için monitör olarak **Deneme penceresi**
   seçin: müşteri ekranı kasa ekranında normal bir pencere olarak açılır.

Ayarlar yalnız o kasaya aittir; buluta ve diğer kasalara gitmez. Görsel ve
video dosyaları kasanın `%APPDATA%\Market Otomasyon\musteri-ekrani\`
klasöründe durur.

## Yayın listesi

Ayarlar → Müşteri Ekranı → **Bekleme ekranı yayın listesi**. Satırlar ▲▼ ile
sıralanır, kutucukla yayından çıkarılır; sağdaki önizleme müşterinin göreceğini
gösterir.

| Slayt | Açıklama |
|---|---|
| Karşılama | Logo, market adı (İşletme sekmesinden), karşılama ve alt yazı, saat. |
| Aktif kampanyalar | Panelden tanımlanmış ve **şu an geçerli** her kampanya için otomatik bir slayt. Kampanya bitince kendiliğinden düşer. Geçerli kampanya yoksa atlanır. |
| Ürün fiyatı | Bir ürün seçilir; fiyat **her zaman katalogdan** okunur. Kampanyadaysa eski fiyat üstü çizili. Ürün pasife alınırsa gösterilmez. |
| Duyuru | Başlık + metin + renk. "Taze ekmek çıktı" gibi. |
| Görsel / GIF | PNG, JPG, GIF, WEBP — en fazla 15 MB. Ekrana sığdırılır, kesilmez. |
| Video | MP4 ya da WEBM — en fazla 60 MB. Sesiz ve sonuna kadar oynar. GIF yerine MP4 önerilir: aynı animasyon çok daha küçük ve net. |

Fiyatı elle hazırlanmış afiş yerine "Aktif kampanyalar" ya da "Ürün fiyatı"
kullanın: fiyat değişince afişteki eski fiyat ekranda kalır, otomatik
slaytlarda kalmaz. Ekran dakikada bir ve her kayıtta kendini yeniler.

## Sorun giderme

| Belirti | Neden / çözüm |
|---|---|
| Durum "İkinci ekran bulunamadı" | Kablo ya da Windows'ta "Yinele" seçili. Ekranı Genişlet'e alın; program ekranı kendiliğinden bulur. |
| Müşteri ekranı kasanın monitöründe açılıyor | Kasa programını birincil ekrana taşıyın ya da monitörü listeden elle seçin. |
| Görsel eklendi ama görünmüyor | Kaydet'e basılmadı. Kaydedilmeyen dosya sonraki kayıtta silinir. |
| Video oynamıyor, sıradakine geçiyor | Dosya bozuk ya da desteklenmeyen kodek. H.264 MP4 olarak yeniden dışa aktarın. |

Müşteri ekranı odak almaz: barkod okuyucu her zaman kasa ekranına yazar,
müşteri ekrana dokunsa da satış bozulmaz. Ekran açıkken Windows ekranı uykuya
almaz.
