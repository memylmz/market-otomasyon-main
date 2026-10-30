# Sürüm Geçmişi

Bu proje [Semantic Versioning](https://semver.org/lang/tr/) kullanır.

## Yayımlanmamış

### Eklenenler

- **Gün sonu (Z) hatırlatması.** Pavo'dan satış yapılıp Z alınmadıysa kasa
  kapanışında uyarı; önceki günlerin Z'si eksikse üst çubukta kırmızı "Z alınmadı"
  rozeti (Yazarkasa'ya götürür). Z cihazın kendi tuşlarıyla alındıysa cihaz arşivinden
  anlaşılır. Hiçbir işlem engellenmez.
- **SKT uyarıları görünür.** Tarihi geçmiş ya da 3 gün içinde dolacak partisi olan ürün
  sepete girince uyarı; üst çubukta "⏳ SKT: 2 geçmiş · 3 yaklaşıyor" rozeti (Stok → SKT
  Takibi'ni açar). Satış engellenmez — parti dağılımı bir tahmindir.
- **Stok → Hareketler'de ürün süzgeci.** Barkod okutulur ya da ad yazılır; o ürünün tüm
  hareketleri veritabanından gelir (eskiden yalnız ekrandaki son 300 hareket süzülüyordu).
- **Panelde şifre değiştirme** (Ayarlar → Hesabım / Şifre). Diğer cihazlardaki panel
  oturumları kapanır; kasaya aynalanmış yönetici kopyasının şifresi de güncellenir.
- **Kampanya zarar kontrolü tüm katalogda** (ana süreçte, ağırlıklı ortalama maliyetle).
- **Sunucuyu uyanık tutan zamanlanmış görev** (GitHub Actions, market saatlerinde).

- **Kampanyalar kasadan da yönetilir.** Menüde "Kampanyalar": panelle aynı form
  (yüzde, tutar, sabit fiyat, N al M öde, kademeli fiyat; tüm ürünler / kategori /
  tek ürün), zararına satış uyarısı. Kaydedilen kampanya bu kasada hemen geçerli
  olur, `KAMPANYA_KAYDEDILDI` olayıyla buluta ve oradan diğer kasalara gider.
  Buluttan gelen eski kayıt kasadaki daha yeni değişikliği ezmez. **Bulut API'si
  bu olayı tanıyan sürüme kasalardan ÖNCE güncellenmelidir.**
- **Sol menü daraltılabilir.** Üst çubuktaki ☰ menüyü yalnız simgelere indirir;
  tercih o bilgisayarda hatırlanır.
- **Satış ekranındaki hızlı ürün ızgarası genişletilip daraltılabilir.** Sol
  kenarından sürüklenir, kutucuk sayısı genişliğe uyar; varsayılan satırda 3 ürün,
  çift tık varsayılana döner.

- **Etiket düzeni ayarlanabilir.** Ayarlar → Donanım → Etiket Yazıcısı → "Etiket
  düzeni": ürün adı (sola / ortaya / sağa, küçük / normal / büyük, uzun adı iki
  satıra böl), fiyat (hiza, boyut), barkod (bas / basma, hiza), çerçeve ve basım
  tarihi. Sağdaki etiket önizlemesi kaydetmeden canlı değişir; ortalama yazıcının
  fontunun gerçek genişliğine göre hesaplanır, önizleme de o genişlikte çizilir.
  Etikete sığmayan yazı (ör. dar etikette büyük fiyat) kendiliğinden küçültülür ve
  uyarılır. Varsayılan, bugüne kadarki etiketin aynısıdır.

- **Fatura düzenleme sınırı (VUK 232), ayarlanabilir.** Ayarlar → Satış Kuralları'nda
  yıl yıl tutar tablosu (her yıl Aralık sonunda Resmi Gazete'deki tebliğle girilir;
  başlangıç 2025: 9.900 TL, 2026: 12.000 TL — Cybele ile aynı). Bu yılın tutarı
  girilmemişse son bilinen yıl kullanılır ve ekran kırmızı uyarır. Satış sınıra
  ulaşırsa ödeme penceresi "Fatura zorunlu" der: Pavo varsa fatura bilgisi girilmeden
  satış tamamlanmaz (kasa da ayrıca reddeder), Pavo yoksa "faturayı başka yoldan
  keseceğim" onayı istenir. E-posta yazılan faturalı satışta belge alıcıya e-postayla
  da gönderilir.

- **Faturalı satış (e-Arşiv / e-Fatura) — Pavo ile.** Ödeme penceresinde
  "📄 Fatura iste": vergi no ya da TC kimlik no yazılır, "GİB'den Getir" unvanı,
  vergi dairesini ve adresi doldurur (bulunamazsa elle). Satış alıcı bilgisiyle
  cihaza gider; e-Fatura mükellefine e-Fatura, diğerlerine e-Arşiv kesilir. Belge
  numarası satış bildiriminde görünür. Numara algoritmayla, eksikler cihaza
  gitmeden denetlenir; Pavo tanımlı değilken faturalı satış reddedilir.

- **Klasik fiş tasarımı (varsayılan).** Görsel fiş artık yazarkasa fişi gibi: tek
  aralıklı yazı, kesikli çizgiler, TOPLAM siyah bant yerine çift çizgi arasında,
  gri ton yok (az mürekkep). Eski görünüm Ayarlar → Fiş Düzeni → Tasarım → "Modern"
  ile seçilebilir. Satış fişi, ekstre ve gün sonu raporu aynı tasarımı kullanır.

- **Ürün adı AKYSOFTMARKETV1 ve yeni simge.** Kurulum dosyası
  `AKYSOFTMARKETV1-Kurulum-<sürüm>.exe`, program `AKYSOFTMARKETV1.exe`, masaüstü ve
  Başlat kısayolu, pencere başlığı, giriş/kurulum ekranları ve panel başlığı yeni
  adı taşır; yeşil "AKY / MARKET" simgesi (küçük boyutta "A"). VERİ KLASÖRÜ
  DEĞİŞMEDİ (`%APPDATA%\Market Otomasyon`): güncellenen kasalar verilerini
  bulmaya devam eder.

- **Satış ekranında dokunmatik tuş takımı.** Barkod kutusuna parmakla dokununca
  da tuş takımı açılır (× tuşu koli girişi için, ABC harfle arama için; Tamam ürünü
  ekler, takım açık kalır — arka arkaya kısa kod girilir). Satış ekranında takım
  sepetin üstüne değil sağdaki hızlı ürün ızgarasının altına yerleşir; sepet, toplam
  ve ÖDEME görünür kalır. Satıştan sonra barkod kutusu odak alınca takım kendiliğinden
  açılmaz. Sayı alanına parmakla dokunulunca Windows'un kendi dokunmatik klavyesi
  açılmaz (ekranın yarısını kapatıyordu).

- **Ayarlar → Fiş Düzeni.** Satış fişinde ve cari ekstresinde ne basılacağı tek
  yerden ayarlanır, sağda **canlı önizlemeyle** (son satışınız / en çok hareketi
  olan cari; kayıt yoksa örnek veri; görsel ya da metin fiş, yazıcıdan çıkacağı
  gibi). Yazı boyutu (küçük/normal/büyük); işletme adresi, telefonu, vergi no,
  kasiyer, müşteri, ürün altındaki "miktar × fiyat" satırı, KDV dökümü, fiş no
  barkodu aç/kapat; üst metin ("Hoş geldiniz"), alt metin ve yasal uyarı; ekstrede
  kaç hareket basılacağı ve dönem özeti. Yasal uyarı kapatılamaz; veresiye ve iade
  fişinde müşteri adı her zaman basılır. Eskiden yalnız Donanım sekmesinde düz metin
  bir test fişi önizlenebiliyordu.

- **"Yarısını şimdi, kalanını sonra."** Ödeme penceresinde kalan varken
  "📒 Kalan X TL müşterinin borcuna yazılsın" düğmesi çıkar; müşteri seçili değilse
  müşteri penceresini açar, seçilince kalan veresiyeye yazılır. Ön seçili yöntem
  kalanı kendiliğinden emer: müşteri seçili, 100 TL veresiye açıldıysa nakite 40
  yazınca veresiye 60 olur; nakit açıldıysa karta 30 yazınca nakit 70 olur.

- **"Kasa kapalı — aç" rozeti.** Üst çubuktaki rozet tek tıkla Kasa sayfasına
  götürür ve açılış penceresini açar.

- **Hangi market, hangi kopya?** Sol menünün üstünde açık veritabanının işletme
  adı yazar. Proje klasöründen çalışan deneme kopyasında kırmızı "DEMO — kurulu
  program değil" işareti çıkar; verisi kurulu programdan tamamen ayrıdır.

- **Mal kabulde raf fiyatı listeye doğrudan yazılır.** 2. adımdaki listede
  Miktar, Alış ve Raf fiyatı artık yazılabilir hücreler; **Enter** aynı sütunda
  alt satıra geçer, son satırdan sonra barkod alanına döner. Yanındaki **Kâr**
  sütunu yüzdeyi renkli gösterir (zararına kırmızı, %10 altı turuncu). Raf fiyatı
  değişen satırın altında eski fiyat yazar. Toptancının söylediği fiyatları her
  satırı tek tek açmadan girmek için.

- **Etiketi basılacaklar listesi.** Satış fiyatı nereden değişirse değişsin
  (mal kabul, toplu zam, ürün kartı, panel) ya da yeni ürün açılırsa ürün bu
  listeye düşer; etiketi basılınca kendiliğinden çıkar. *Ürünler* sayfasının
  üstünde "N ürünün raf etiketi güncel değil" şeridi → liste (raftaki eski / kasadaki
  yeni fiyat) → seçilenleri etiket kuyruğuna ekle ya da "listeden çıkar". Fiyat
  eski hâline dönerse ürün listeden kendiliğinden düşer. Mal kabul kaydı bildirimi
  listeyi hatırlatır.

- **Ağırlıklı ortalama maliyet.** Satışın maliyeti artık ürünün son alış fiyatı
  değil, rafta kalan eski alışlarla birlikte ortalamasıdır (TMS 2 ¶27): 100'den
  kalan 5 + 110'dan gelen 10 → 106,67. Kâr raporu, stok değeri, bağlı sermaye,
  sayım farkı ve fire maliyeti bu temelden hesaplanır. Son alış fiyatı ayrı durur
  ve fiyat belirlemek için kullanılmaya devam eder. Ortalama son alıştan farklıysa
  ürün kartında görünür. İptal edilen alış faturası hesaba hiç girmemiş sayılır.
  Eski satışların maliyeti değişmez (satış anında dondurulmuştu).

- **SKT kalanı satışlardan düşer (FEFO).** Kasada okutulan ürün hangi partiden
  olduğunu bilmediği için satılan parti SKT listesinde dolu görünüyordu. Artık
  eldeki gerçek stok, son kullanma tarihi en uzak partiden geriye dağıtılır:
  satış önce tarihi en yakın partiden düşmüş sayılır, biten parti listeden çıkar.

- **Müşteri ekranı aç / kapat kartı.** *Ayarlar → Müşteri Ekranı*'nın başında
  büyük bir durum kartı: Açık / Kapalı / "Açık ama görünmüyor" ve nedeni.
  **Aç** ve **Kapat** düğmeleri hemen uygulanır (Kaydet gerekmez). İkinci monitör
  bağlı değilse "Aç" müşteri ekranını kasa ekranında pencere olarak açar ve ikinci
  monitörün nasıl tanıtılacağı yazar. Eskiden tek yol gözden kaçan küçük bir kutu
  ve Kaydet'ti; ayar açıkken ikinci ekran yoksa ekran neden açılmadı anlaşılmıyordu.

- **Mal kabul üç adımda (kasa).** *Stok → Mal Kabul / Alış* artık tek kalabalık
  ekran değil: **1. Fatura** (tedarikçi, fatura no/tarih, ödeme ve "faturadaki
  fiyatlar KDV dahil mi hariç mi?" — fatura başına bir kez; faturada ne yazıyorsa
  o girilir, program KDV hariçe çevirir), **2. Ürünler** (barkod okut; bilinen
  ürün tek dokunuşla girer, yeni barkod sağdaki sade panelde açılır — ad,
  kategori, birim, KDV düğmeleri, kâr satırı; alış değişince "aynı kâr oranıyla
  raf fiyatını X yap" önerisi), **3. Kontrol** (fatura toplamı tutuyor mu,
  eksikler "Düzelt" bağlantısıyla, fiyatı değişen ürünler, ödenen tutar). F2
  önce kontrol adımına götürür, orada kaydeder. Yarım fatura sorulmadan kapanmaz.
  Panel'deki mal kabul formu henüz eski düzende.

- **Ekran tuş takımı.** Fiyat, miktar, tutar gibi sayı alanlarına parmakla
  dokununca alanın penceresinin yanında büyük rakam tuşları açılır (7-8-9, ⌫,
  C, virgül, Tamam = Enter). Fareyle tıklanınca ya da klavyeden yazılınca
  açılmaz / çekilir; aynı program dokunmatik kasada da dizüstünde de ayar
  değiştirmeden doğru davranır. Klavye her durumda çalışır. Ayarlar → Görünüm →
  Ekran tuş takımı: Otomatik (varsayılan) / Her zaman / Kapalı — cihaza özel.

- **Ayarlar → POS & Yazarkasa sekmesi.** POS ayarları Donanım sekmesinin
  altından kendi sekmesine taşındı. Ödeme yolu kartlarla seçilir; Pavo kurulumu
  1-2-3 adım (bağlantı → cihaz bilgisi → eşleştirme) olarak gösterilir. Sağdaki
  durum kartı bağlantıyı sekme açılınca ve her kayıttan sonra kendiliğinden
  dener; kaydedilmemiş değişiklik varsa bunu söyler ve eşleştirmeyi kapatır
  (test ve eşleştirme kayıtlı ayarla yapılır). Yazarkasa sayfası da yenilendi:
  üstte cihaz şeridi ve yarım kalan satış uyarısı, her kartta "Günü kapatmaz"
  ya da "Geri alınamaz" etiketi, gün sonunun adımları.

- **Zararına satış uyarıları.** Ürün kartında fiyatların altında "raf fiyatı −
  KDV = size kalan − alış = kâr (%marj)" satırı görünür; fiyat zararınaysa
  kırmızı uyarı çıkar ve kaydetmeden önce sorulur. Alış fiyatı "KDV dahil
  yazacağım" kutusuyla KDV dahil de girilebilir (program KDV hariç kaydeder).
  Satış ekranında fiyat, indirim ya da kampanya ürünü alışın altına indirirse
  satırda "⚠ zararına" yazar. Panelde kampanya formu, kampanyayla zararına
  satılacak ürünleri listeler ve kaydetmeden önce sorar.

- **Pavo N86 yazarkasa POS entegrasyonu.** Ayarlar → POS & Yazarkasa → Pavo
  N86. Yasal fişi Pavo keser; nakit ve veresiye (cihazda "Açık Hesap") dahil her
  satış cihazdan geçer. Kurallar Cybele kasasında sahada doğrulananlardır: bir
  satış = bir ödeme akışı, askıya alma yok (kart reddinde ve "Ödemeden vazgeç"te
  satış cihazdan da silinir), kör tekrar yok (kayıp cevapta önce cihaza
  sorulur), write-ahead sıra numarası ve hata 73 düzeltmesi. Niyet defteri
  sayesinde program ödeme ortasında kapansa da parası alınmış satış açılışta
  kayda geçer. Satış iptali `CancelSale`, kısmi iade `PartialReturn` ile.
  Yeni **Yazarkasa** sayfası (Pavo açıkken menüde): gün sonu (Z, isteğe bağlı
  önce banka gün sonu), banka gün sonu, X / X fark raporu, aylık rapor, geçmiş
  gün sonu, rapor arşivi ve nüsha bastırma — her düğmede ne yaptığı ve günü
  kapatıp kapatmadığı yazar. Ayarlar ekranı sıra numarasını ve
  parmak izini ezemez. Cihaz olmadan deneme için `tools/pavo-mock/` (gerçek
  protokolü konuşan sahte Pavo). Ayrıntı: `docs/pos-entegrasyonu.md`.
  Henüz yok: kartla cari tahsilat ve faturalı (e-Arşiv) satış.

- **Müşteri ekranı (çift ekranlı POS).** Kasa programı ikinci monitörde müşteri
  penceresini kendisi açar. Müşteri yokken yayın listesi döner (karşılama, logo,
  otomatik kampanya slaytları, ürün fiyatı, duyuru, görsel/GIF, video); ilk ürün
  okutulunca sepet tam ekran görünür, satış bitince ödenen tutar ve para üstü
  gösterilir, sonra yayına dönülür. Ayarlar → Müşteri Ekranı'nda yayın listesi
  sıralanır ve canlı önizlenir. Kampanya ve ürün fiyatı slaytları fiyatı her
  gösterimde katalogdan okur; bitmiş kampanya ve pasif ürün ekranda kalmaz.
  Pencere odak almaz (barkod okuyucu hep kasaya yazar), monitör takılıp
  çıkarılınca kendini yeniden yerleştirir, cari müşteri adı/borcu müşteri
  ekranına gitmez. Medya dosyaları içerikten tür denetiminden geçer ve yalnız
  kendi klasöründen, uuid adıyla sunulur. Ayrıntı: `docs/musteri-ekrani.md`.

- **Ayarlar → Yedekleme → Tehlikeli bölge: tüm veriyi sıfırlama.** İşletmeyi,
  kullanıcıları, katalogu ve tüm hareketleri silip kasayı kurulum sihirbazına
  döndürür. Bugüne kadar bunun tek yolu `%APPDATA%Market Otomasyon`
  klasörünü elle silmekti; yanlış klasörü ya da yedeksiz silmek kullanıcının
  elindeydi. Yeni akış üç güvence getirir: yetki `veri.sifirla` ile yalnız
  ADMİNe açıktır, işletme adının birebir yazılması istenir ve sıfırlamadan önce
  **zorunlu yedek** alınır. Eski veritabanı silinmez,
  `.sifirlama-oncesi` uzantısıyla saklanır.

  Append-only şemada satır silinemediği için (hareket tablolarındaki
  tetikleyiciler `DELETE`i reddeder) sıfırlama, geri yüklemeyle aynı yolu
  kullanır: bağlantı kapatılır, dosya devreden çıkarılır, şema sıfırdan kurulur.

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

- **Muhtelif kalem.** Aynı tutarlı, adsız ikinci muhtelif kalem öncekiyle birleşip "adet 2"
  oluyordu; artık her ekleme ayrı satırdır. "Muhtelif" sistem kaydı Ürünler listesinde,
  aramada, hızlı ızgarada, stok uyarılarında ve panelin ürün listesinde görünmez (satış
  satırının bağlandığı teknik kayıttır, ürün değildir).
- **Bulut veritabanında eksik indeksler**: ödemeler (satış), kasa hareketleri (vardiya,
  belge), kasa oturumları (tarih), stok hareketleri (tarih, SKT). Fiş detayı ve satış
  iptali işletmenin tüm ödeme geçmişini tarıyordu; veri biriktikçe yavaşlar ve Turso
  okuma kotasını yerdi.
- **Kasanın sunucu bekleme süresi 30 → 90 sn.** Ücretsiz sunucu uykudan ~60 sn'de
  uyandığı için uzun aradan sonraki ilk senkron düşüyordu.
- **Müşteri ekranı ilk açılışta Windows görev çubuğunun altında kalıyordu**;
  Ayarlar'da Kaydet'e basılınca düzeliyordu. Pencere artık göründükten sonra
  monitöre yeniden yerleşir.
- **Boşaltılan ya da SATILAN sepet, program hemen kapatılınca geri geliyordu.**
  Sepet kurtarma kaydı 1,2 sn gecikmeyle yazılıyordu; Temizle ya da satış sonrası
  program bu süre içinde kapatılırsa yeniden açılışta eski ürünler sepete
  dönüyordu (satılmış ürün için çift satış riski). Artık sepetten bir şey
  eksildiğinde kayıt beklemeden yazılır, kapanışta bekleyen kayıt da hemen
  gönderilir. Doluyken kapatılan sepetin geri gelmesi bilinçlidir (elektrik
  kesintisi koruması).

- **Etikette barkod önizlemeden küçük, Türkçe harfler bozuk çıkıyordu.** Önizleme
  barkodu CODE128-B ile 178 modül hesaplarken yazıcı rakamları C kümesine sıkıştırıp
  ~112 modül basıyordu (kâğıtta üçte iki genişlik). Artık EAN-13 / EAN-8 barkodlar
  etikete EAN olarak basılır (sessiz bölge payıyla, etiket enine göre modül), diğer
  kodlarda yazıcıya CODE128-B zorlanır — önizleme ile kâğıt aynı. Ayrıca etiket
  varsayılan olarak **görüntü olarak** basılır (Ayarlar → Donanım → "Etiketi görüntü
  olarak bas"): harfleri ve barkodu program çizer, yazıcının fontu devreye girmez;
  İ, ı, ğ, ş, ç ve ₺ önizlemedeki gibi çıkar. Çizilemezse metin etiketine düşülür.

- **Dokunmatikte ÖDEME düğmesiyle fiş çıkmıyordu.** Fiş kararı yalnız F4 (fişli)
  ve F5 (fişsiz) tuşlarıyla veriliyordu; ekrandaki ÖDEME düğmesi kararı hiç
  ayarlamadığı için "Satış sonrası fişi otomatik yazdır" açıkken bile fiş basılmıyordu.
  Artık ÖDEME düğmesi bu ayara uyar, ödeme penceresinin sol altında dokunulabilir
  **🧾 Fiş yazdırılacak / Fiş yok** düğmesi vardır (F4 açık, F5 kapalı başlatır).
  Fiş basılmayan nakit satışta da para üstü için çekmece açılır (ayardaki "çekmece
  aç" kapalıysa açılmaz).

- **USB yazıcı paylaşıma açık değilse fiş çıkmıyordu.** Fiş Windows paylaşım
  yolundan gönderiliyordu; yazıcı paylaşıma açılmamışsa "UNKNOWN: unknown error,
  open ..." hatası alınıyordu. Artık paylaşım yolu çalışmazsa fiş doğrudan Windows
  yazdırma kuyruğuna (RAW) gönderilir; paylaşım gerekmez. Etiket yazıcısı da aynı
  yoldan yararlanır.

- **"Müşteriden alınan nakit" azsa yok sayılıyordu.** 126 TL'lik satışta alınana
  100 yazılınca satış yine 126 TL nakit kaydediliyor, kasa 26 TL eksik çıkıyordu.
  Artık nakit satırı verilen tutara iner, "26 TL eksik" yazar; eksik sarı düğmeyle
  müşterinin borcuna ya da "Kart → Kalanı" ile karta yazılır. Alınan tekrar
  büyütülürse (200) nakit eski tutara döner ve para üstü çıkar.

- **Parçalı ödeme yapılamıyordu.** İki hata birden: (1) ödeme penceresi açılınca
  nakit tutarı seçili gelmiyor, kasiyerin yazdığı "50" eski tutarın önüne
  ekleniyordu ("50126,00" → "fazla girilen", satış tamamlanamıyor); (2) pencere
  açıkken müşteri seçilince (F1) pencere sıfırlanıyor, yazılan nakit silinip
  tutarın tamamı veresiyeye geçiyordu. Artık tutar seçili gelir, müşteri seçimi
  yazılanı korur ve ödenmeyen kalanı veresiyeye yazar.

- **Pencereden çıkış yolu.** Her pencerenin sağ üstünde ✕ var. Etiket kuyruğunda
  "Kapat" düğmesi yoktu; yazıcı tanımlı değilken pencereden yalnız Esc ile
  çıkılabiliyordu. Yazıcı yokken "Hepsini Bas" kapalı.

- **Şüpheli barkod uyarısı.** Mal kabulde ve ürün kartında 8/13 haneli olup kontrol
  hanesi tutmayan ya da 9-11, 15+ haneli barkod "Barkod şüpheli" diye işaretlenir
  (kaydı engellemez). Fiyat yazılırken rakamlar barkoda karışınca
  (`110152388694740`) ürün kasada okutulamıyor ve fark edilmiyordu.

- **Sıfırlama onayı bazen reddediliyordu.** Ekran onay için formdaki işletme
  adını istiyor, program ise kayıtlı adı bekliyordu; Genel sekmesinde ad
  değiştirilip Kaydet'e basılmadıysa doğru yazılan ad "eşleşmiyor" sayılıyordu.
  Artık ikisi de kayıtlı adı kullanır; eşleşmezse kutunun altında neyin
  yazılacağı söylenir.

- **İkincil yedek klasörüne kopya alınmıyordu.** "Klasör Seç" seçilen yolu yalnız
  ekrandaki kutuya yazıyordu; ayar sayfanın Kaydet düğmesine basılmadan
  kaydedilmiyor, "Şimdi Yedek Al" da kayıtlı ayara baktığı için kopya hiç
  alınmıyordu (klasör kutuda göründüğü için fark edilmiyordu). Artık seçim hemen
  kaydedilir (önce klasöre yazılabildiği denenir) ve ilk yedek hemen kopyalanır.
  Kart klasörde gerçekten kaç yedek olduğunu ve en yenisinin tarihini gösterir;
  klasöre ulaşılamıyorsa (USB çıkarılmış) söyler. Klasör seçilmemişken yedek
  alınırsa "ikinci kopyası yok" uyarısı çıkar.

- **Mal kabulde değiştirilen raf fiyatı kaydedilmiyordu.** Mevcut ürün
  satırındaki satış fiyatı kutusu düzenlenebiliyordu ama değer faturaya hiç
  konmuyordu; ürünün raf fiyatı sessizce eski kalıyordu. Artık önceki raf
  fiyatından farklıysa kaleme `yeni_satis_fiyati` olarak taşınır ve ürüne yazılır.

- **Boşaltılan sepet çıkış-girişten sonra geri geliyordu.** Sepet kurtarma
  noktası diske 1,2 sn gecikmeyle yazılıyor; sepet boşaltılıp hemen çıkış
  yapılınca bekleyen "sil" işi satış ekranıyla birlikte iptal oluyor, geri
  girişte eski ürün "kurtarılan sepet" diye yükleniyordu. Çıkışta kurtarma
  noktası açıkça silinir; ekrandan çıkılırken bekleyen yazım atılmaz, hemen
  yapılır. Çökme sonrası kurtarma aynen çalışır.

- **Sıfırlama / geri yükleme sonrası "Beklenmeyen bir hata".** Sıfırlama ve
  geri yükleme veritabanını kapatıp yalnız "lütfen yeniden başlatın" diyordu;
  ekran eski oturumla açık kalıyor, basılan her düğme (Geri Yükle dahil) kapalı
  veritabanına çarpıp hata veriyordu. Artık program kendini yeniden başlatır,
  bu sırada tam ekran mesaj gösterir ve işlem kabul etmez. Kurulum ekranına
  **"Yedekten geri yükle"** seçeneği eklendi (eskiden önce sahte bir işletme
  açmak gerekiyordu); geri yüklemede **USB / OneDrive'dan dosya seçilebilir**
  (eskiden yalnız programın kendi yedek klasörü listeleniyordu). Programın daha
  yeni bir sürümüyle alınmış yedek, dosya değiştirilmeden reddedilir.

- **Yedekleme: ikincil klasör ve otomatik yedek zamanlaması.** (1) İkincil
  yedek klasörü hiç temizlenmiyordu; yılda ~1.500 dosya birikip USB ya da
  OneDrive kotasını dolduruyordu. Artık orada da son N yedek tutulur ve yalnız
  programın kendi yedek dosyalarına dokunulur. (2) Otomatik yedek ayarları
  açılışta bir kez okunuyordu; klasörü seçip kaydetmek program yeniden açılana
  kadar işlemiyordu. (3) Sayaç her açılışta sıfırlanıyordu; program 6 saatten
  kısa açık kalan kasada otomatik yedek hiç alınmıyordu. Artık sayaç son
  yedekten başlar ve ayarlar her kontrolde okunur. İkincil klasör "Klasör Seç"
  ile seçilir; kopya alınamazsa elle yedekte uyarı çıkar (eskiden yalnız loga
  yazılıyordu).

- **Kg/lt ürünün tartım penceresi girildiği yere göre farklıydı.** Barkodla
  ya da adla eklenen üründe "20 liralık" yazınca miktar kendiliğinden
  hesaplanıyordu; sağdaki hızlı ürün kutucuğundan açılan ayrı pencerede ise
  Hesapla'ya basmak gerekiyor ve kampanyalı fiyat yerine liste fiyatıyla
  hesaplanıyordu. Artık her yol aynı tartım penceresini açar (terazi okuması
  dahil).

- **Raporlardaki kâr marjı yanlış yüzde gösteriyordu.** Kâr KDV dahil ciroya
  bölünüyordu: %20 KDV'li üründe %25'lik marj %20,8 görünüyor, alış faturası
  ekranıyla çelişiyordu. Kasa ve panel raporları artık marjı KDV hariç satışa
  göre hesaplar (kâr tutarları zaten doğruydu).

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
- **Windows kurulum paketi üretilemiyordu:** çalışma alanında electron-builder
  Electron sürümünü bulamıyor ve paylaşılan paketi pakete koymaya çalışıyordu.

### Güvenlik

- **Panel Next.js 15.5.28'e yükseltildi.** Next 14'te görsel optimizasyon
  üzerinden kimlik doğrulamasız uzaktan kod çalıştırma (kritik) ve SSRF/DoS
  açıkları vardı; 14 hattında yama yok.
- Kırıcı olmayan bağımlılık yamaları (fast-uri, fast-jwt, source-map-js).
- CI güvenlik taraması gerekçeli ve süreli istisna tanıyor
  (`scripts/guvenlik-taramasi.mjs`). Açık kalan iki istisna 2027-01-31'de
  dolar: Zod 4 geçişi ve Next içindeki derleme zamanı postcss kopyası.
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
