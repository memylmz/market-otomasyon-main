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
| Onay kodu, cihaz referansı, maskeli kart → kayıt, fiş ve bulut | Hazır |
| Ayarlar → Donanım → POS (tür, adres, bekleme süresi, bağlantı testi) | Hazır |
| Gerçek cihaz sürücüsü | **Cihaz seçilince yazılacak** |

POS türü **Kapalı** iken program eskisi gibi çalışır: kart çekimi cihazdan elle
yapılır, program yalnız kaydeder.

## Akış

**Satış:** Ödemede kart tutarı varsa → `pos.odeme` → cihaz onaylarsa satış onay
bilgisiyle kaydedilir; reddederse ödeme ekranında kalınır. Satış kaydı hata
verirse kasa çekimi otomatik geri alır (`pos.iade`); geri alınamazsa kasiyere
"cihazdan iptal edin" uyarısı çıkar.

**İptal / iade:** "Karta" seçildiyse tutar kayıttan **önce** cihaza gönderilir
(orijinal çekimin referansıyla). Cihaz onaylamazsa iptal/iade yazılmaz.

**Cari tahsilat:** Müşteriden kartla tahsilat önce cihazdan çekilir; kayıt
hata verirse çekim geri alınır. Tahsilat iptalinde "karta" seçilirse önce
cihazdan iade yapılır. Tedarikçiye yapılan ödemeler POS'a gitmez.

**Panelden gelen iade talimatları** kasada kayıt olarak uygulanır; kart iadesi
müşteri kasadayken POS'tan elle yapılır (kart fiziksel olarak gerekir).

## Yeni cihaz sürücüsü eklemek

1. `donanim/pos.ts` içinde `PosSurucusu`'nu uygulayan bir sınıf yazın:
   - `satis(tutar, referans)` — kart çekimi
   - `iade(tutar, orijinalReferans)` — karta iade
   - `test()` — bağlantı testi
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
