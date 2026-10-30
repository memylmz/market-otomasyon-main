# Yeni Market İçin Kurulum

Başka bir markete (ayrı bir işletmeye) kasa kurarken izlenecek yol. Bu yola
uyulmazsa yeni bilgisayar **sizin marketinizin** bulut verisine bağlanır.

## Neden başka marketin verisi görünür?

- Kasa programının kendi veritabanı **yereldir**: her bilgisayarda
  `%APPDATA%\Market Otomasyon\veri\market.db`. Kurulum paketinin içinde veri
  ya da sunucu adresi yoktur; temiz kurulum boş başlar.
- Bulut sunucusu (API) **tektir** ve içinde birden çok işletme barınabilir.
  İşletmeleri birbirinden ayıran şey **lisans anahtarıdır**.
- Kasa *Ayarlar → Senkron → Cihazı Aktive Et* adımında hangi lisans anahtarı
  girilirse o işletmenin kasası olur ve o işletmenin ürünlerini, carilerini,
  ayarlarını indirir.

Yani yeni bilgisayarda **kendi lisans anahtarınızla** aktivasyon yapıldıysa, o
bilgisayar artık sizin marketinizin bir kasasıdır. Çözüm: yeni market için ayrı
bir işletme ve ayrı bir lisans anahtarı üretmek.

> Yeni bilgisayar gerçekten **sizin marketinizin ikinci kasasıysa** her şey
> doğrudur, bir şey yapmanız gerekmez. Bu kılavuz ayrı bir market içindir.

---

## 1. Yanlış bağlanan bilgisayarı ayırın

### 1a. Bulutta cihaz yetkisini iptal edin

Kendi panel hesabınızla:

*Ayarlar → Cihazlar & Senkron* → yeni bilgisayarın adını bulun →
**Cihaz yetkisini iptal et**

Bundan sonra o bilgisayar sizin işletmenize veri gönderemez ve alamaz.

> **Dikkat:** İptal, lisans anahtarını bilen biri için kalıcı değildir.
> Aynı anahtarla *Cihazı Aktive Et* yapılırsa cihaz yeniden etkinleşir.
> Anahtarınız yeni marketin sahibine ya da kurulumu yapan başka birine
> verildiyse/görüldüyse, iptal yetmez; **kendi anahtarınızın değiştirilmesi**
> gerekir. Bunun için hazır bir komut yoktur, sunucu veritabanında
> `isletmeler.lisans_anahtari` alanı elle güncellenmelidir. Mevcut kasalarınız
> aktivasyon anahtarıyla değil cihaz token'ıyla çalıştığı için etkilenmez.

### 1b. Sizin verinize karışan kayıt var mı, kontrol edin

Yeni bilgisayarda aktivasyondan sonra **satış, mal kabul, tahsilat, ürün
değişikliği** yapıldıysa bunlar senkronla sizin buluta gitmiş olabilir.

- Panelde *Satışlar* ekranında o kasanın adıyla/fiş serisiyle kesilmiş fişleri
  arayın.
- Varsa iade/düzeltme ile geri alın; stok ve cari bakiyeleri kontrol edin.

Yeni bilgisayarda yalnızca bakıldıysa (işlem yapılmadıysa) bu adım boş geçer.

### 1c. Yeni bilgisayardaki yerel veriyi silin

Yeni bilgisayarda sizin ürünleriniz/carileriniz indirilmiş durumda. Programı
kaldırmak bunları **silmez** (bilinçli: kaldırma kullanıcı verisini korur).

### Yöntem 1 — uygulama içinden (önerilen)

ADMIN hesabıyla girin:

*Ayarlar → Yedekleme → Tehlikeli bölge* → işletme adını birebir yazın →
**Sıfırla** → uygulamayı yeniden başlatın.

Sıfırlama öncesinde otomatik yedek alınır ve mevcut veritabanı
`.sifirlama-oncesi` uzantısıyla saklanır. Yanlış bilgisayarda çalıştırılsa bile
veri geri getirilebilir — elle klasör silmenin aksine.

### Yöntem 2 — klasörü elle silmek

Uygulama hiç açılmıyorsa ya da yedeklerin de gitmesi isteniyorsa:

1. AKYSOFTMARKETV1'i tamamen kapatın (sistem tepsisinde de kapalı olsun).
2. `Win + R` → `%APPDATA%` → Enter.
3. **`Market Otomasyon`** klasörünü silin. İçinde veritabanı, senkron
   anahtarı, ayarlar, yedekler ve loglar vardır; hepsi gider.
4. Program yeniden açıldığında boş haliyle **kurulum sihirbazını** gösterir.

> Silmeden önce bu klasörde yeni markete ait saklamak istediğiniz bir şey
> olmadığından emin olun. Temiz başlangıçta saklanacak bir şey yoktur.

---

## 2. Yeni market için işletme ve lisans anahtarı üretin

Bu adım **bulut sunucusunun** çalıştığı yerde, sunucunun gerçek veritabanına
bakan `.env` ile yapılır (`apps/api/.env` içindeki `DB_URL` ve
`DB_AUTH_TOKEN` canlı veritabanını göstermeli).

```bash
npm run seed -w @market/api -- --isletme "Yeni Marketin Adı" --kullanici yenipatron --sifre "GucluSifre123"
```

Çıktı:

```
  İşletme        : Yeni Marketin Adı
  Panel kullanıcı: yenipatron
  Panel şifresi  : GucluSifre123   ← ilk girişte değiştirin
  LİSANS ANAHTARI: XXXXX-XXXXX-XXXXX-XXXXX
```

- **LİSANS ANAHTARI**'nı yeni market sahibine verin. Bu anahtar yalnız o
  markete aittir.
- İşletme adı benzersiz olmalı. Aynı adla tekrar çalıştırırsanız yeni işletme
  açılmaz, var olanın anahtarı gösterilir.
- Kullanıcı adı ve şifreyi **varsayılan bırakmayın** (`patron` / `Demo1234`).
- Kendi lisans anahtarınızı hiçbir zaman başka markete vermeyin.

---

## 3. Yeni bilgisayarda temiz kurulum

1. `AKYSOFTMARKETV1-Kurulum-<sürüm>.exe` dosyasını çalıştırın.
2. Kurulum sihirbazı açılır:
   - **İşletme bilgileri:** yeni marketin adı, adresi, vergi no, varsayılan KDV
   - **Yönetici hesabı:** yeni marketin yöneticisi (sizin hesabınız değil)
3. Yeni yönetici hesabıyla giriş yapın.
4. *Ayarlar → Donanım*: yazıcıyı tanımlayın, test fişi basın.
5. *Ayarlar → Yedekleme*: ikincil yedek klasörü (USB veya ağ) tanımlayın.
6. *Ürünler → İçe Aktar*: yeni marketin ürün listesini yükleyin.

Bulut/panel kullanılmayacaksa burada bitti; kasa tek başına tam çalışır.
**Senkron ayarına hiç dokunmayın.**

---

## 4. Yeni marketi buluta bağlama (isteğe bağlı)

Yeni bilgisayarda *Ayarlar → Senkron*:

1. **Senkron sunucu adresi:** sizinkiyle aynı sunucu adresi olabilir
   (örn. `https://api.sizinalanadi.com`). Ayrımı adres değil anahtar yapar.
2. **Kaydet**
3. **Cihazı Aktive Et** → **2. adımda üretilen YENİ lisans anahtarı** + cihaz
   adı (örn. "Kasa 1").
4. Senkron modunu seçin (Manuel / Gün sonu / Fırsatçı).

---

## 5. Doğrulama

Hepsi sağlanmalı:

- [ ] Yeni bilgisayarda ürün listesinde **sizin ürünleriniz yok**.
- [ ] Yeni marketin panel hesabıyla (`yenipatron`) girildiğinde
      *Ayarlar → Cihazlar & Senkron*'da yalnız yeni marketin kasası görünüyor.
- [ ] **Sizin** panel hesabınızda *Cihazlar & Senkron* listesinde yeni
      bilgisayar yok (ya da 1a'da iptal edildiği için pasif görünüyor).
- [ ] Yeni kasada bir deneme satışı yapıp senkronlayın: sizin panelinizdeki
      satışlarda **görünmemeli**, yeni marketin panelinde görünmeli.

---

## Kısa özet

| Durum | Yapılacak |
|---|---|
| Aynı market, ikinci kasa | Aynı lisans anahtarıyla aktive edin |
| Farklı market, bulutsuz | Temiz kurulum, senkrona dokunmayın |
| Farklı market, bulutlu | `seed` ile yeni işletme → **yeni** lisans anahtarıyla aktive edin |
| Yanlış anahtarla bağlandı | Panelden cihazı iptal et → `%APPDATA%\Market Otomasyon` sil → baştan kur |
