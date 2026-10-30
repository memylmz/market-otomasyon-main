# POS Entegrasyonu

Kasa, kart çekimini ve karta iadeyi POS cihazına **tek bir sürücü arayüzü**
üzerinden yaptırır. Altyapı hazırdır: satış, iade, iptal akışı, kayıt, fiş ve
ayarlar POS'u tanır. Gerçek bir cihazı desteklemek için yalnız o cihazın
**sürücüsü** yazılır.

## Bugün ne var

| Parça                                                                      | Durum                         |
| -------------------------------------------------------------------------- | ----------------------------- |
| Sürücü arayüzü (`apps/desktop/src/main/donanim/pos.ts` → `PosSurucusu`)    | Hazır                         |
| Test simülatörü (gerçek cihaz olmadan bütün akış)                          | Hazır                         |
| Satışta kart tutarını cihaza gönderme, onay gelmeden satışı kapatmama      | Hazır                         |
| Onaylanan çekimden sonra satış kaydedilemezse çekimi geri alma             | Hazır                         |
| Satış iptali ve iadede "karta" seçilirse cihazdan iade                     | Hazır                         |
| Cari ekranında müşteriden kartla tahsilat ve tahsilat iptalinde karta iade | Hazır                         |
| Kuru deneme, otomatik geri alma, süre aşımı, geç onay, meşgul kilidi       | Hazır                         |
| POS işlem günlüğü (Ayarlar → POS & Yazarkasa)                              | Hazır                         |
| Onay kodu, cihaz referansı, maskeli kart → kayıt, fiş ve bulut             | Hazır                         |
| Ayarlar → POS & Yazarkasa (tür, adres, bekleme süresi, bağlantı testi)     | Hazır                         |
| Gerçek cihaz sürücüsü                                                      | **Cihaz seçilince yazılacak** |

POS türü **Kapalı** iken program eskisi gibi çalışır: kart çekimi cihazdan elle
yapılır, program yalnız kaydeder.

## Akış

Bütün POS akışı ana süreçte, `servis/pos-servis.ts` içindedir (ekranlar yalnız
"kart bekleniyor" bilgisini gösterir).

**Satış ve müşteriden kartla tahsilat**

1. Kayıt önce _kuru_ denenir (kasa açık mı, ödeme toplamı, kredi limiti, yetki…).
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
  Ayarlar → POS & Yazarkasa → "Son POS işlemleri".

**Panelden gelen iade talimatları** kasada kayıt olarak uygulanır; kart iadesi
müşteri kasadayken POS'tan elle yapılır (kart fiziksel olarak gerekir).
Tedarikçiye kartla ödeme POS'a gitmez.

## Simülatörle deneme

Ayarlar → POS & Yazarkasa → Test simülatörü. Kuruşu **13** ile biten tutar
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
4. `sayfa/ayarlar/PosSekmesi.tsx` içindeki `TURLER` listesine seçeneği ekleyin.
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

## Pavo N86 (yazarkasa POS)

Ayarlar → POS & Yazarkasa → **Pavo N86 (yazarkasa POS)**. Pavo bir banka POS'u
sürücüsü gibi çalışmaz: yasal fişi Pavo keser, bu yüzden **nakit ve veresiye
dahil her satış** cihazdan geçer. Kod: `servis/pavo-servis.ts` (akış),
`donanim/pavo-istemci.ts` (HTTP), `packages/shared/src/pavo.ts` (protokol
kuralları). Kurallar Cybele kasasında sahada doğrulananlardır.

**Kurulum**

1. Cihaz adresi (IP; port yazılmazsa HTTP 4568, HTTPS 4567), cihazın seri
   numarası ve Pavo'ya kayıtlı uygulama adı girilir → **Kaydet**.
2. **Eşleştir** → Pavo ekranında onaylanır. Seri numarası eşleştirmede de
   doğrulandığı için önce girilmelidir.
3. **Bağlantıyı Test Et** "Pavo bağlı ve eşleşmiş" demelidir.

**Satış akışı**

1. Satış önce kasada kuru denenir (limit, kasa, yetki, KDV grubu…); hata varsa
   cihaza hiçbir şey gitmez.
2. Satış **niyet defterine** (`pavo_defteri`) yazılır, sonra sepet cihaza
   gider (`StartSaleWithItems`) — cihaz satışı askıya alır.
3. Ödemeler tek tek gider (`AddPaymentAndFinalizeSale`), **kart önce**.
   Veresiye cihazda "Açık Hesap" aracıyla geçer; belge yine kesilir.
4. Satışın nihai hâli cihaza sorulur; kapandıysa kasada kaydedilir ve cihazdaki
   satış/kalem kimlikleri `pavo_satislari`na yazılır.

**Bir satış = bir ödeme akışı, askıya alma yok.** Kart reddedilir ya da
kasiyer "Ödemeden vazgeç"e basarsa satış cihazdan da silinir; müşteri tam o
anda ödediyse silinmez, kaydedilir. Kasadaki "+ Sepet" bununla ilgisizdir —
o sepetler cihaza hiç gitmemiştir.

**Kör tekrar yok.** Cevap kaybolursa (zaman aşımı, bağlantı koptu) istek
tekrarlanmaz; önce `GetSaleResult` / `CheckPendingSale` ile gerçek öğrenilir.
Sıra numarası istekten önce yazılır (write-ahead), hata 73'te dokümandaki +1
düzeltmesi uygulanır.

**Kurtarma.** Program kart beklerken kapanırsa açık defter kaydı, satış ekranı
açılınca ve her yeni satıştan önce cihaza sorulur: ödenmişse satış defterdeki
girdiden **kayda geçirilir**, yarım kalmışsa cihazdan silinir, cihaza hiç
ulaşmamışsa kapatılır. Akıbet öğrenilemezse (cihaz kapalı) yeni satış açılmaz
— çift tahsilat olmasın.

**İptal ve iade.** Satış iptali `CancelSale` (cihaz ödendiği gibi iade eder),
kısmi iade `PartialReturn` (orijinal satış ve kalem kimlikleriyle). Pavo
öncesi bir satışın karta iadesi Pavo'dan yapılamaz; nakit iade edilir.

**Gün sonu ve raporlar — Yazarkasa sayfası.** Pavo açıkken sol menüde
**Yazarkasa** görünür. Günü kapatan tek işlem gün sonudur; diğerleri yalnız
okur ve basar.

| Düğme             | Pavo servisi                                                | Günü kapatır mı         | Yetki             |
| ----------------- | ----------------------------------------------------------- | ----------------------- | ----------------- |
| Gün sonu (Z)      | `CreateReportWithSummaries` + `T`                           | **Evet, geri alınamaz** | `kasa.kapat`      |
| Banka gün sonu    | `PerformBatchEod`                                           | Hayır                   | `kasa.kapat`      |
| X raporu / X fark | `QueryReport` + `XReport` / `XDiffReport`                   | Hayır                   | `kasa.kapat`      |
| Aylık rapor       | `QueryReport` + `TeminalDateRangeSaleReport` (≤ 12 ay geri) | Hayır                   | `rapor.goruntule` |
| Geçmiş gün sonu   | `QueryReport` + `ZReportWithDateTime`                       | Hayır                   | `rapor.goruntule` |
| Rapor arşivi      | `ListReports` (≤ 31 gün) + `GetReportSummaries`             | Hayır                   | `rapor.goruntule` |
| Nüsha bastır      | `PrintReport` (yeni rapor oluşturmaz)                       | Hayır                   | `rapor.goruntule` |

Sahada doğrulandı (Cybele): `CreateReport` + `ZReport` günü KAPATMIYOR; gün
sonunun gerçek karşılığı `T` (cihaz menüsündeki "Terminal Satış Raporu").
Gün sonunda "önce banka gün sonu" işaretliyse banka gün sonu önce alınır;
başarısızsa Z alınmaz (banka tekrar denenebilir, Z denenemez). Gün sonu özeti
Z numarasını taşımadığı için numara arşiv satırından tamamlanır.

**Mali hafıza raporu** Pavo'nun entegrasyon arayüzünde yok; cihazın kendi
menüsünden alınır.

**Faturalı satış (e-Arşiv / e-Fatura):** ödeme penceresinde "📄 Fatura iste" →
vergi no (10 hane) ya da TC kimlik no (11 hane) → "GİB'den Getir"
(`QueryCustomerInfo`) unvan, vergi dairesi ve adresi doldurur; bulunamazsa elle
yazılır. Satış `StartSaleWithItems` gövdesinde `CustomerParty` ile gider; belgeyi
cihaz keser — alıcı e-Fatura mükellefiyse e-Fatura, değilse e-Arşiv (karar GİB
kaydına göre cihazda). Numaralar algoritmayla, eksik alanlar (unvan / ad-soyad,
şirkette vergi dairesi, il-ilçe) cihaza gitmeden denetlenir. Belge no ve sorgu
linki `pavo_satislari` tablosunda durur. Pavo tanımlı değilken faturalı satış
reddedilir (sessizce fişe dönmez). Pavo hesabında e-belge (e-Arşiv / e-Fatura)
hizmetinin açık olması gerekir — bu, Pavo ile yapılan sözleşmenin konusudur.

**Fatura düzenleme sınırı (VUK 232):** Ayarlar → Satış Kuralları'nda yıl yıl
girilir (`fatura.sinirlar`). Satış tutarı sınıra ulaşır ve alıcı girilmemişse
ödeme penceresi satışı kilitler; `pavoIleSatis` da cihaza gitmeden reddeder.

**Henüz yok:** kartla cari tahsilat (Pavo'da "fatura tahsilatı" işlemi ister;
şimdilik nakit alınır).

**Cihaz olmadan deneme:** `tools/pavo-mock/` — gerçek protokolü konuşan sahte
Pavo (bkz. oradaki README).
