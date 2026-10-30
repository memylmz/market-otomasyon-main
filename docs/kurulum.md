# Kurulum ve İlk Çalıştırma

## 1. Kasa bilgisayarı

İki durum vardır; adımları farklıdır:

- **A — Yepyeni market:** veri yok, sıfırdan başlanır.
- **B — Aynı market, bilgisayar değişiyor:** veriler eski bilgisayardan taşınır.

### Gereksinimler

| | Asgari | Önerilen |
|---|---|---|
| İşletim sistemi | Windows 10 (64-bit) | Windows 11 |
| RAM | 2 GB | 4 GB |
| Disk | 2 GB boş | SSD, 10 GB boş |
| Ekran | 1024×768 | 1366×768 veya üstü, dokunmatik |

Linux (AppImage / deb) ikincil olarak desteklenir.

### Donanım

- **Barkod okuyucu:** USB HID (klavye emülasyonu). Sürücü gerekmez. Okuyucunun
  barkod sonuna `Enter` göndermesi yeterlidir — çoğu okuyucu fabrika ayarında
  böyledir.
- **Fiş yazıcısı:** 80 mm ESC/POS termal. Ağ (TCP 9100), COM portu veya Windows
  paylaşımı üzerinden bağlanabilir. Marka bağımsızdır. **USB yazıcı Windows'ta
  paylaşıma açılmalıdır** (program `\\localhost\<yazıcı adı>` yoluna basar).
- **Para çekmecesi:** Yazıcının çekmece (kick-out) portuna bağlanır.
- **Yazarkasa POS:** Pavo N86 (ağ üzerinden). Ayrıntı: [pos-entegrasyonu.md](pos-entegrasyonu.md).
- **Terazi:** Kasaya seri port / USB-seri ile bağlı terazi canlı okunur; barkodlu
  etiket basan terazi ayar gerektirmez. Ayrıntı: [terazi-entegrasyonu.md](terazi-entegrasyonu.md).
- **Müşteri ekranı:** İkinci monitör takılıysa program kendisi açar. Ayrıntı:
  [musteri-ekrani.md](musteri-ekrani.md).

### 0. Hazırlık (bilgisayar gelmeden)

- [ ] Güncel kurulum dosyası (`AKYSOFTMARKETV1-Kurulum-<sürüm>.exe`) bir USB bellekte
- [ ] Lisans anahtarı, senkron sunucu adresi, panel giriş bilgileri elde
- [ ] B durumunda: eski kasadan alınmış **en son yedek** (USB / OneDrive)

### 1. Windows hazırlığı (A ve B)

- [ ] Windows güncellemeleri bitti, bilgisayar yeniden başlatıldı
- [ ] *Ayarlar → Sistem → Güç* → **Uyku: Hiçbir zaman** (uyuyan kasada Pavo
      bağlantısı ve otomatik yedek durur)
- [ ] İnternet ve **Pavo ile aynı modem** (mümkünse kablo)
- [ ] OneDrive / Google Drive'a market hesabıyla girildi, `MarketYedek` klasörü açıldı

### 2. Programı kurma (A ve B)

1. `AKYSOFTMARKETV1-Kurulum-<sürüm>.exe` dosyasını çalıştırın. *"Windows
   bilgisayarınızı korudu"* çıkarsa **Ek bilgi → Yine de çalıştır** (program henüz
   dijital imzalı değildir).
2. Kurulum yerini olduğu gibi bırakın; masaüstü kısayolu işaretli kalsın.
3. Program açılınca iki seçenek gelir: **Yeni market kur** ve **Yedekten geri yükle**.

### A — Yepyeni market

1. **Yeni market kur** → işletme bilgileri (fişte görünür), varsayılan KDV oranı,
   yönetici hesabı (şifre en az 8 karakter, harf + rakam; isteğe bağlı PIN).
   Bu hesapla giriş yapın.
2. **Ayarlar → Senkron & Lisans** → sunucu adresi → *Kaydet* → **Cihazı Aktive Et**
   (lisans anahtarı + cihaz adı, ör. "Kasa 1") → senkron modu **Fırsatçı** →
   *Kaydet*. Durum rozeti 🟢 olmalı. Ayrıntı: bölüm 5.
3. **Ayarlar → Donanım** → fiş yazıcısı → *Test Fişi Yazdır* (`ç ğ ı ö ş ü`
   düzgün çıkmalı); varsa terazi (*Teraziyi Test Et*) ve etiket yazıcısı → *Kaydet*.
   Barkod okuyucuyu önce Not Defteri'nde deneyin.
4. **Ayarlar → POS & Yazarkasa** → *Pavo N86* → cihaz adresi (IP) ve seri no →
   *Kaydet* → **Eşleştir** (Pavo ekranında onaylayın). Sağdaki kart "Bağlı" demeli.
5. **Ayarlar → Müşteri Ekranı** (ikinci monitör varsa) ve **Ayarlar → Görünüm**
   (tema, yazı boyutu, ekran tuş takımı).
6. **Ayarlar → Yedekleme** → **Klasör Seç** → OneDrive'daki `MarketYedek` →
   *Kaydet* → **Şimdi Yedek Al**. Bildirimde "ikincil klasöre de kopyalandı"
   yazmalı.
7. **Ürünler → İçe Aktar** (bölüm 2) ya da ürünleri panelden girin.
8. **Kasiyerler panelden açılır** (kasada kullanıcı yönetimi yoktur): *Panel →
   Kullanıcılar* → kasiyer + PIN. Senkronla birkaç dakikada kasaya iner.
9. **Deneme:** Pavo bağlıyken her satış **yasal fiştir** (iptal ve iade de kayda
   geçer). Akışı önce *POS & Yazarkasa → Test simülatörü* ile deneyin; sonra Pavo'ya
   dönüp tek küçük gerçek satış yapın. Fiş, çekmece ve müşteri ekranını kontrol edin.
10. **İlk gün:** sabah *Kasa → Kasa Açılışı Yap*; akşam *Yazarkasa → Gün Sonunu Al*
    ve *Kasa → Kapanış*. Ertesi gün satışların panelde göründüğünü kontrol edin.

### B — Aynı market, yeni bilgisayar

Eski bilgisayar çalışıyorsa **önce** orada:

1. Gün sonunu alın, kasayı kapatın.
2. *Ayarlar → Senkron & Lisans → Şimdi Senkronize Et*.
3. *Ayarlar → Yedekleme → Şimdi Yedek Al* ve bu yedeği USB'ye / OneDrive'a kopyalayın.
4. **Eski bilgisayarda programı bir daha açmayın.** Yedek, kasanın cihaz kimliğini
   ve lisans bilgisini de taşır; aynı kimlikle iki kasa çalışırsa senkron karışır.

Yeni bilgisayarda (Windows hazırlığı ve kurulumdan sonra):

1. **Yedekten geri yükle** → **Başka Yerden Seç (USB, OneDrive)** → son yedek →
   **Seçili Yedeği Geri Yükle**. Program kendini yeniden açar; **eski kullanıcı adı
   ve şifreyle** girin. Satışlar, stok, veresiye ve ayarlar yerindedir.
2. Bilgisayara bağlı ayarları kontrol edin (yedekle geldiler ama yeni bilgisayarda
   farklı olabilirler):
   - [ ] Fiş yazıcısı: Windows'ta yeniden kurulup paylaşıma açıldı, programda
         seçildi, *Test Fişi Yazdır* çalışıyor
   - [ ] Terazi: COM portu yeniden seçildi, *Teraziyi Test Et* çalışıyor
   - [ ] Pavo: *POS & Yazarkasa* "Bağlı" diyor (demiyorsa **Eşleştir**)
   - [ ] Yedekleme: ikincil klasör yeni bilgisayarda doğru (gerekirse **Klasör Seç**)
3. Senkron rozeti 🟢 olmalı; değilse *Şimdi Senkronize Et*.
4. *Kasa Açılışı* → bir küçük satış → devam.

**Eski bilgisayar öldü ve yedek yoksa:** A'daki adımları izleyin, 2. adımda **aynı
lisans anahtarıyla** aktive edin. Buluttan ürünler, müşteriler ve kullanıcılar
gelir; **geçmiş satışlar, kasa hareketleri ve veresiye bakiyeleri gelmez**
(bkz. [yedekleme-dr.md](yedekleme-dr.md)). İkincil yedek klasörü bu yüzden ilk gün
tanımlanır.

---

## 2. Ürün kataloğunu içe aktarma

*Ürünler → İçe Aktar*

CSV sütunları (noktalı virgül ayraçlı, UTF-8):

```
ad;barkod;kategori;marka;birim_tipi;alis_fiyati;satis_fiyati;kdv_orani;kritik_stok;acilis_stogu;raf_konumu
Tam Yağlı Süt 1L;8690000000017;Süt Ürünleri;Marka A;ADET;18,50;24,90;1;12;40;A-03
Domates;;Manav;;KG;12,00;19,90;1;5;25;M-01
```

Kurallar:

- `ad` ve `satis_fiyati` zorunludur.
- Fiyatlar TR biçiminde yazılabilir (`1.234,56`) — nokta ondalıklı da kabul edilir.
- `satis_fiyati` **KDV dahil** (raf fiyatı), `alis_fiyati` **KDV hariç**'tir.
- `birim_tipi`: `ADET`, `KG` veya `LT`. KG/LT'de satışta miktar elle girilir.
- Barkod varsa ve o barkod zaten kayıtlıysa **mevcut ürün güncellenir**.
- Kategori yoksa otomatik oluşturulur.
- 13 haneli barkodun kontrol hanesi doğrulanır; tutmuyorsa satır hatalı sayılır.

**Önce *Doğrula* düğmesine basın.** Hatalı satırlar numarasıyla listelenir.
İçe aktarma sırasında hatalı satırlar atlanır, sağlam satırlar yazılır.

---

## 3. Bulut servisi (isteğe bağlı)

Senkron ve web paneli kullanmak istemiyorsanız bu adımı atlayabilirsiniz —
kasa tek başına tam işlevlidir.

### Seçenek A — Turso (önerilen, tek market ölçeğinde ücretsiz)

```bash
turso db create market-otomasyon
turso db show market-otomasyon --url       # DB_URL
turso db tokens create market-otomasyon    # DB_AUTH_TOKEN
```

### Seçenek B — Kendi sunucunuz

`DB_URL=file:./veri/merkez.db` yeterlidir. Veritabanı dosyasının bulunduğu diski
düzenli yedekleyin.

### Çalıştırma

```bash
cp apps/api/.env.example apps/api/.env
# .env içinde JWT_SECRET üretin:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

npm run seed -w @market/api          # işletme + panel kullanıcısı + lisans anahtarı
npm run build -w @market/api
npm start -w @market/api
```

`seed` çıktısındaki **LİSANS ANAHTARI**'nı not edin — kasa aktivasyonunda gerekir.

Üretimde:

- HTTPS zorunludur (ters vekil: Caddy, nginx veya bulut sağlayıcının TLS'i).
- `JWT_SECRET` tanımlı değilse sunucu bilinçli olarak **açılmaz**.
- `CORS_KOKENLER` panelin gerçek adresini içermelidir.
- `/v1/health` ve `/v1/ready` uçlarını izleme sisteminize bağlayın.

---

## 4. Yönetim paneli

```bash
cp apps/panel/.env.example apps/panel/.env.local   # NEXT_PUBLIC_API_URL
npm run build -w @market/panel
npm start -w @market/panel
```

Telefonda tarayıcıdan açıp **"Ana ekrana ekle"** derseniz uygulama gibi çalışır (PWA).

---

## 5. Kasayı buluta bağlama

Kasada *Ayarlar → Senkron & Lisans*:

1. **Senkron sunucu adresi**: `https://api.sizinalanadi.com`
2. **Kaydet**
3. **Cihazı Aktive Et** → lisans anahtarını ve cihaz adını girin (örn. "Kasa 1").
   Başka bir market kuruyorsanız kendi anahtarınızı **kullanmayın**: bkz.
   [Yeni market için kurulum](yeni-market-kurulumu.md).
4. **Senkron modu** seçin:
   - *Manuel* — yalnız düğmeye basınca
   - *Gün sonu* — kasa kapanışında otomatik
   - *Fırsatçı* — internet varsa arka planda her N dakikada (**önerilen**)

Durum çubuğundaki rozet 🟢 olduğunda bağlantı çalışıyordur.

---

## 6. Günlük kullanım akışı

```
Sabah   → Giriş → Kasa Açılış (kasadaki nakdi gir)
Gün içi → Satış ekranı (barkod okut → F4/F5 → ödeme)
        → Mal kabul, fire, tahsilat işlemleri
Akşam   → Yazarkasa → Gün Sonunu Al (Pavo Z raporu)
        → Kasa → Kapanış (nakdi say, tutarı gir)
          → kasa farkı hesaplanır, vardiya raporu basılır
          → senkron otomatik denenir
```

## Satış ekranı kısayolları

Ekranın altındaki çubukta da yazar.

| Tuş | İşlev |
|---|---|
| `Enter` | Barkodu sepete ekle |
| `3 x <barkod>` ya da `3*<barkod>` | 3 adet ekle |
| `F1` | Müşteri seç (veresiye) |
| `F2` | Tahsilat |
| `F3` | Ürün ara (isim/marka/barkod) |
| `F4` | Ödeme + fiş |
| `F5` | Ödeme (fişsiz) |
| `F8` | Seçili satırı sil |
| `F9` | Fiyat sorgulama |
| `F10` | Yeni sepet |
| `↑ ↓` | Satır seç |
| `+ −` | Seçili satırın adedini değiştir |
| `ESC` | İptal / sepeti temizle |

---

## Sorun giderme

| Belirti | Çözüm |
|---|---|
| Barkod okutunca hiçbir şey olmuyor | İmleç barkod alanında mı? Okuyucu `Enter` gönderiyor mu? Not defterinde test edin. |
| Fiş basılmıyor ama satış kaydediliyor | Beklenen davranıştır — satış yazıcıya bağımlı değildir. *Raporlar → Satışlar → Fiş yazdır* ile tekrar deneyin. |
| Türkçe karakterler fişte bozuk | Fiş görüntüye çevrilip basıldığı için kod sayfasıyla ilgisi yoktur. *Ayarlar → Donanım → Fişi görüntü olarak bas* açık olmalı; kapalıysa yazıcının kod sayfasına düşer ve Türkçe bozulur. |
| Türkçe karakterler etikette bozuk | *Ayarlar → Donanım → Komut dili = TSPL* seçin. TSPL, CP1254 kod sayfasını kullanır; ZPL'de küçük ı/İ ailesi bozuk basılır. |
| Senkron rozeti 🔴 | İnternet bağlantısı ve *Ayarlar → Senkron & Lisans* sunucu adresi. Kasa bu durumda da normal çalışır. |
| "Kasa açık değil" uyarısı | *Kasa → Açılış* yapın. |
| Uygulama açılmıyor, DB hatası | Kurulum ekranı geliyorsa **Yedekten geri yükle**; program hiç açılmıyorsa `docs/yedekleme-dr.md` → elle geri yükleme. |
| Geliştirmede "Veritabanı sürücüsü yüklenemedi" / "No such built-in module: node:sqlite" | Yerel modül Electron ABI'sine göre hazır değil. `npm run native -w @market/desktop` çalıştırın. `npm install` sonrası gerekebilir. |
