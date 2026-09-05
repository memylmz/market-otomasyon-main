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
   Varsayılan 6 saatte bir, son 10 sürüm saklanır.
2. **İkincil konum** — USB bellek veya ağ klasörü.
   *Ayarlar → Yedekleme → İkincil yedek klasörü* alanından tanımlanır.
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

*Ayarlar → Yedekleme → Geri Yükle*

1. Seçilen yedek önce **doğrulanır**; bozuksa işlem hiç başlamaz.
2. Mevcut veritabanı silinmez — `market.db.geri-alma-<zaman>` olarak saklanır.
3. Eski `-wal` / `-shm` yan dosyaları temizlenir (kalırlarsa yeni dosyayı bozarlar).
4. Yedek kopyalanır ve **uygulama yeniden başlatılmalıdır.**

Yanlış yedek seçilirse `.geri-alma-*` dosyasını geri adlandırarak dönülebilir.

---

## Felaket senaryosu: kasa PC'si bozuldu

```
1. Yeni PC'ye kurulum paketini kur
2. Uygulamayı aç → kurulum sihirbazı
3. Ayarlar → Senkron → Cihazı Aktive Et (lisans anahtarı ile)
4a. Son yedek elinizdeyse: Ayarlar → Yedekleme → Geri Yükle
4b. Yedek yoksa: buluttan tam çekme (pull) ile katalog/cari/kullanıcı iner
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
- `stogYenidenHesapla()` / `ozetleriYenidenHesapla()` — özetleri hareketlerden
  sıfırdan yeniden üretir. Sapma bulunursa onarım yolu budur.

---

## Disk yönetimi

- Yedek klasöründe son N sürüm tutulur, eskiler otomatik silinir.
- WAL dosyası `wal_autocheckpoint` ile sınırlandırılır.
- Arşivlenmiş outbox olayları `eskiOlaylariTemizle()` ile temizlenebilir.
- Disk %80/%90 dolulukta kullanıcıya uyarı gösterilmelidir (izleme sorumluluğu).
