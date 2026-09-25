# Kurulum ve İlk Çalıştırma

## 1. Kasa bilgisayarı

### Gereksinimler

| | Asgari | Önerilen |
|---|---|---|
| İşletim sistemi | Windows 10 (64-bit) | Windows 11 |
| RAM | 2 GB | 4 GB |
| Disk | 2 GB boş | SSD, 10 GB boş |
| Ekran | 1024×768 | 1366×768 veya üstü |

Linux (AppImage / deb) ikincil olarak desteklenir.

### Donanım

- **Barkod okuyucu:** USB HID (klavye emülasyonu). Sürücü gerekmez. Okuyucunun
  barkod sonuna `Enter` göndermesi yeterlidir — çoğu okuyucu fabrika ayarında
  böyledir.
- **Fiş yazıcısı:** 80 mm ESC/POS termal. Ağ (TCP 9100), COM portu veya Windows
  paylaşımı üzerinden bağlanabilir. Marka bağımsızdır.
- **Para çekmecesi:** Yazıcının çekmece (kick-out) portuna bağlanır.
- **POS ve terazi:** Bu sürümde entegre **değildir** (bilinçli kapsam kararı).

### Kurulum adımları

1. `MarketOtomasyon-Kurulum-<sürüm>.exe` dosyasını çalıştırın.
2. Uygulama ilk açılışta **kurulum sihirbazını** gösterir:
   - İşletme bilgileri (fişte görünür) ve varsayılan KDV oranı
   - Yönetici hesabı: ad, kullanıcı adı, şifre (en az 8 karakter, harf + rakam)
     ve isteğe bağlı hızlı giriş PIN'i
3. Oluşturduğunuz hesapla giriş yapın.

### Kurulum sonrası kontrol listesi

- [ ] **Ayarlar → Donanım** → yazıcıyı tanımlayın, *Test Fişi Yazdır* ile Türkçe
      karakterleri doğrulayın (`ç ğ ı ö ş ü` düzgün çıkmalı)
- [ ] **Ayarlar → Yedekleme** → ikincil yedek klasörü (USB veya ağ) tanımlayın
- [ ] **Ürünler → İçe Aktar** → katalogu CSV ile yükleyin
- [ ] **Ayarlar → Senkron** → sunucu adresi + *Cihazı Aktive Et*
- [ ] **Kullanıcılar** → kasiyer hesaplarını oluşturun (PIN verin)
- [ ] **Kasa → Açılış** → günün ilk kasa açılışını yapın

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

Kasada *Ayarlar → Senkron*:

1. **Senkron sunucu adresi**: `https://api.sizinalanadi.com`
2. **Kaydet**
3. **Cihazı Aktive Et** → lisans anahtarını ve cihaz adını girin (örn. "Kasa 1")
4. **Senkron modu** seçin:
   - *Manuel* — yalnız düğmeye basınca
   - *Gün sonu* — kasa kapanışında otomatik
   - *Fırsatçı* — internet varsa arka planda her N dakikada

Durum çubuğundaki rozet 🟢 olduğunda bağlantı çalışıyordur.

---

## 6. Günlük kullanım akışı

```
Sabah   → Giriş → Kasa Açılış (kasadaki nakdi gir)
Gün içi → Satış ekranı (barkod okut → F12 → ödeme)
        → Mal kabul, fire, tahsilat işlemleri
Akşam   → Kasa → Gün Sonu (nakdi say, tutarı gir)
          → kasa farkı hesaplanır, vardiya raporu basılır
          → senkron otomatik denenir
```

## Satış ekranı kısayolları

| Tuş | İşlev |
|---|---|
| `Enter` | Barkodu sepete ekle |
| `3 x <barkod>` | 3 adet ekle |
| `F2` | Ürün ara (isim/marka/barkod) |
| `F4` | Seçili satıra iskonto |
| `F6` | Müşteri seç (veresiye) |
| `F8` | Seçili satırı sil |
| `F9` | Fiyat sorgulama modu |
| `F10` | Askıya al / geri çağır |
| `F12` | Ödeme ekranı |
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
| Senkron rozeti 🔴 | İnternet bağlantısı ve *Ayarlar → Senkron* sunucu adresi. Kasa bu durumda da normal çalışır. |
| "Kasa açık değil" uyarısı | *Kasa → Açılış* yapın. |
| Uygulama açılmıyor, DB hatası | *Ayarlar → Yedekleme → Geri Yükle* ya da `docs/yedekleme-dr.md` felaket senaryosu. |
| Geliştirmede "Veritabanı sürücüsü yüklenemedi" / "No such built-in module: node:sqlite" | Yerel modül Electron ABI'sine göre hazır değil. `npm run native -w @market/desktop` çalıştırın. `npm install` sonrası gerekebilir. |
