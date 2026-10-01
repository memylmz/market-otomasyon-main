# POS Entegrasyonu

Kasa, kart çekimini ve karta iadeyi POS cihazına **tek bir sürücü arayüzü**
üzerinden yaptırır. Altyapı hazırdır: satış, iade, iptal akışı, kayıt, fiş ve
ayarlar POS'u tanır. Gerçek bir cihazı desteklemek için yalnız o cihazın
**sürücüsü** yazılır.

## Bugün ne var

| Parça | Durum |
|---|---|
| Sürücü arayüzü (`apps/desktop/src/main/donanim/pos.ts` → `PosSurucusu`) | Hazır |
| Test simülatörü (gerçek cihaz olmadan bütün akış) | Hazır |
| Satışta kart tutarını cihaza gönderme, onay gelmeden satışı kapatmama | Hazır |
| Onaylanan çekimden sonra satış kaydedilemezse çekimi geri alma | Hazır |
| Satış iptali ve iadede "karta" seçilirse cihazdan iade | Hazır |
| Cari ekranında müşteriden kartla tahsilat ve tahsilat iptalinde karta iade | Hazır |
| Kuru deneme, otomatik geri alma, süre aşımı, geç onay, meşgul kilidi | Hazır |
| POS işlem günlüğü (Ayarlar → Donanım → POS) | Hazır |
| Onay kodu, cihaz referansı, maskeli kart → kayıt, fiş ve bulut | Hazır |
| Ayarlar → Donanım → POS (tür, adres, bekleme süresi, bağlantı testi) | Hazır |
| Gerçek cihaz sürücüsü | **Cihaz seçilince yazılacak** |

POS türü **Kapalı** iken program eskisi gibi çalışır: kart çekimi cihazdan elle
yapılır, program yalnız kaydeder.

## Akış

Bütün POS akışı ana süreçte, `servis/pos-servis.ts` içindedir (ekranlar yalnız
"kart bekleniyor" bilgisini gösterir).

**Satış ve müşteriden kartla tahsilat**
1. Kayıt önce *kuru* denenir (kasa açık mı, ödeme toplamı, kredi limiti, yetki…).
   Kaydedilemeyecek bir satış için karttan para **hiç çekilmez**.
2. Kart tutarı cihaza gider. Karma ödemede yalnız kart kısmı gider.
3. Onaylanırsa satış onay kodu, referans ve maskeli kartla kaydedilir.
4. Kayıt yine de düşerse çekim otomatik **geri alınır** (`geriAl` / void; cihaz
   desteklemiyorsa `iade`). Geri alma da başarısızsa kasiyere "cihazdan iptal
   edin" denir. Kasiyerin iade yetkisi olmasa da kendi çekimi geri alınır.

**Satış iadesi, satış iptali, tahsilat iptali** — "karta" seçildiyse:
1. Kayıt kuru denenir (iadesi yapılmış satış iptal edilemez vb.).
2. Karta iade **kartla ödeneni aşamaz** (banka POS'u kabul etmez). Nakit
   ödenmiş satış/tahsilat POS açıkken karta iade edilemez; ekran nakit önerir.
3. Tutar orijinal çekimin referansıyla cihaza gider; cihaz onaylamazsa kayıt
   yazılmaz.

**Cihazla ilgili güvenceler**
- Aynı anda tek işlem: cihaz meşgulken ikinci istek reddedilir (çift tıklama
  iki kez çekmez).
- Sürücü istisna fırlatsa da kasiyer okunur bir hata görür.
- Süre aşımında işlem reddedilmiş sayılır, sürücünün `bekleyeniIptal`'i
  çağrılır. Cihaz **sonradan** onay verirse günlüğe yazılır; satış çekimiyse
  otomatik geri alınır, iadeyse kasiyer uyarılır.
- Her istek ve sonucu `pos_islemleri` günlüğüne yazılır (yalnız bu kasada).
  Ayarlar → Donanım → POS → "Son POS İşlemlerini Göster".

**Panelden gelen iade talimatları** kasada kayıt olarak uygulanır; kart iadesi
müşteri kasadayken POS'tan elle yapılır (kart fiziksel olarak gerekir).
Tedarikçiye kartla ödeme POS'a gitmez.

## Simülatörle deneme

Ayarlar → Donanım → POS → Test simülatörü. Kuruşu **13** ile biten tutar
reddedilir (ör. 10,13 ₺), **14** ile biten hiç yanıt vermez (süre aşımı).

## Gerçek cihazla ilk gün kontrol listesi

1. Bağlantıyı Test Et.
2. Küçük kart satışı → fişte onay kodu ve kart görünmeli.
3. Aynı satıştan kısmi iade "karta" → cihazda iade, iade fişinde onay.
4. Başka bir kart satışını iptal → cihazda iade.
5. Kartı reddettirin (yanlış şifre) → satış kaydedilmemeli.
6. Cihazda işlemi bekletip süreyi aşın → satış kaydedilmemeli; günlükte
   "Yanıt yok". Cihaz sonra onaylarsa otomatik geri alınmalı.
7. Gün sonunda günlüğü POS slibiyle karşılaştırın.

## Yeni cihaz sürücüsü eklemek

1. `donanim/pos.ts` içinde `PosSurucusu`'nu uygulayan bir sınıf yazın:
   - `satis(tutar, referans)` — kart çekimi
   - `iade(tutar, orijinalReferans)` — karta iade
   - `test()` — bağlantı testi
   - isteğe bağlı `geriAl(tutar, referans)` — aynı gün iptal (void)
   - isteğe bağlı `bekleyeniIptal()` — süre aşımında cihazdaki işlemi durdurur
   - isteğe bağlı `kapat()` — ayar değişince bağlantıyı bırakır
   Kurallar: **istisna fırlatmayın**; reddedilen/başarısız işlem
   `{ onaylandi: false, hata: 'okunur açıklama' }` döner. Tutarlar kuruştur.
2. `@market/shared` → `POS_TURU` listesine türü ekleyin (ör. `'INGENICO'`).
3. `posSurucusuOlustur` içine `case` ekleyin; adres ayarı `secenek.adres`'tedir.
4. Ayarlar → Donanım → POS seçim kutusuna seçeneği ekleyin.
5. Cihazla test: Bağlantıyı Test Et → küçük bir kart satışı → iade → iptal.

## Cihaz seçerken bilinmesi gerekenler

- **Yazarkasa POS (ÖKC)** — Türkiye'de perakende satışta yasal fiş ÖKC'den
  kesilmelidir. ÖKC entegrasyonunda hem kart çekimi hem yasal fiş tek adımda
  olur. Üreticiler (Ingenico, Beko, Hugin, Pavo, Profilo…) entegrasyon için
  genellikle bir SDK / protokol dokümanı verir (çoğunda GMP-3 tabanlı); bazıları
  başvuru ve sertifikasyon ister. Sürücüye yasal fiş komutları da eklenir.
- **Yalnız banka POS'u** — Bankalar tutar gönderme entegrasyonunu her zaman
  açmaz; banka ile görüşülmelidir. Açmıyorsa POS türü Kapalı kalır.
- Bağlantı türü (USB/seri, ağ), Windows sürücüsü/DLL gerekip gerekmediği ve test
  cihazı temini sürücü işinin süresini belirler.
