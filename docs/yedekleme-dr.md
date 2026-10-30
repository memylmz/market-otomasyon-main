# Yedekleme ve Felaket Kurtarma

Blueprint §18'in operasyonel karşılığı.

## Hedefler

| Ölçüt | Hedef | Nasıl sağlanır |
|---|---|---|
| **RPO** (kabul edilebilir veri kaybı) | ≤ 1 gün, ideal birkaç saat | Otomatik yerel yedek (varsayılan 6 saatte bir) + bulut senkronu |
| **RTO** (kurtarma süresi) | ≤ 2 saat | Yeni PC'ye kurulum → lisans aktivasyonu → yedekten geri yükleme |

---

## Katmanlar

1. **Yerel otomatik yedek** — `%APPDATA%/Market Otomasyon/yedekler/`
   Varsayılan 6 saatte bir, son 10 sürüm saklanır. Sayaç **son yedekten**
   başlar (program her 10 dakikada "son yedek eskidi mi?" diye bakar); program
   her gün kısa süre açık kalsa da yedek alınır.
2. **İkincil konum** — USB bellek, ağ klasörü ya da **OneDrive / Google Drive
   klasörü** (seçilirse yedek kendiliğinden buluta yüklenir; yalnız yedekler
   şifresiz gider). *Ayarlar → Yedekleme → İkincil yedek klasörü → Klasör Seç*.
   Orada da son N yedek tutulur; klasördeki başka dosyalara dokunulmaz.
3. **Bulut** — Senkronlanan veri zaten ikinci bir kopyadır.
   Sunucu tarafında ayrıca düzenli DB yedeği alınmalıdır (Turso otomatik yapar;
   kendi sunucunuzda `sqlite3 .backup` ya da dosya kopyası + sürümleme).

---

## Yedek nasıl alınır?

Yedekler `VACUUM INTO` ile alınır. Bu, dosyayı kopyalamaktan farklıdır:

- WAL dosyasındaki kesinleşmiş işlemler dahil edilir,
- yarım transaction yakalanmaz,
- çıktı sıkıştırılmış ve tutarlıdır.

**Alındıktan hemen sonra doğrulanır** (`PRAGMA integrity_check`). Doğrulamayı
geçemeyen dosya silinir ve hata verilir — bozuk bir dosyanın "yedek" sanılması
en tehlikeli durumdur.

İsteğe bağlı **AES-256-GCM şifreleme** desteklenir (USB ile taşınan yedekler için).
Şifreli dosya `.enc` uzantılıdır ve kurcalanırsa çözme aşamasında hata verir.

---

## Geri yükleme

İki yerden yapılır:

- *Ayarlar → Yedekleme → Mevcut Yedekler → Geri Yükle* ya da **Başka Yerden
  Geri Yükle (USB, OneDrive)…** (oturum açıkken).
- **Kurulum ekranı → Yedekten geri yükle** (yeni bilgisayar ya da sıfırlama
  sonrası; yalnız henüz yönetici yokken çalışır).

1. Seçilen yedek önce **doğrulanır**; bozuksa ya da programın daha yeni bir
   sürümüyle alınmışsa işlem hiç başlamaz.
2. Mevcut veritabanı silinmez — `market.db.geri-alma-<zaman>` olarak saklanır.
3. Eski `-wal` / `-shm` yan dosyaları temizlenir (kalırlarsa yeni dosyayı bozarlar).
4. Yedek kopyalanır ve program **kendini yeniden başlatır** (sıfırlamada da).

Yanlış yedek seçilirse `.geri-alma-*` dosyasını geri adlandırarak dönülebilir.

---

## Felaket senaryosu: kasa PC'si bozuldu

```
1. Yeni PC'ye kurulum paketini kur
2. Uygulamayı aç → kurulum ekranı
3a. Son yedek elinizdeyse (USB / OneDrive): "Yedekten geri yükle" →
    "Başka Yerden Seç" → dosyayı seç → program yeniden açılır, eski kullanıcıyla gir
3b. Yedek yoksa: "Yeni market kur" → Ayarlar → Senkron → Cihazı Aktive Et;
    buluttan katalog/cari/kullanıcı iner (satış geçmişi gelmez)
4. Ayarlar → Senkron: lisans aktivasyonunu kontrol et
5. Kasa → Açılış → çalışmaya devam
```

> **Not:** Bulut yalnız **yönetimsel** veriyi geri verir (ürün, cari, kullanıcı,
> kampanya). Satış ve kasa hareketleri kasadan buluta tek yönlüdür; geçmiş satış
> dökümü için yerel yedek gerekir. Bu yüzden ikincil yedek konumu (USB/ağ)
> **tavsiye değil, gerekliliktir.**

---

## Tatbikat takvimi

Test edilmemiş yedek, yedek değildir.

| Sıklık | İşlem |
|---|---|
| Aylık | Bir yedeği *Doğrula* düğmesiyle kontrol et |
| Üç aylık | Yerel–bulut mutabakatı çalıştır, farkları incele |
| Yıllık | Yedek bir bilgisayarda tam geri yükleme denemesi yap, süreyi ölç (RTO hedefi ≤ 2 saat) |

Tatbikat sonucunu tarih ve süreyle birlikte kayıt altına alın.

---

## Bütünlük kontrolleri

- Her yedekten sonra `PRAGMA integrity_check`.
- Açılışta şema sürümü kontrolü; veritabanı koddan yeniyse uygulama güvenli durur.
- `stokMutabakati()` — özet tablo ile hareket toplamı arasında sapma var mı?
- `stogYenidenHesapla()` — stok özetini hareketlerden sıfırdan yeniden üretir.
  Sapma bulunursa onarım yolu budur. (Günlük/ürün satış özeti için bir yeniden
  hesaplama aracı yoktur; eski `ozetleriYenidenHesapla()` artımlı kurallarla
  tutarsız sonuç verdiği için kaldırıldı.)

---

## Disk yönetimi

- Yedek klasöründe son N sürüm tutulur, eskiler otomatik silinir.
- WAL dosyası `wal_autocheckpoint` ile sınırlandırılır.
- Arşivlenmiş outbox olayları `eskiOlaylariTemizle()` ile temizlenebilir.
- Disk %80/%90 dolulukta kullanıcıya uyarı gösterilmelidir (izleme sorumluluğu).
