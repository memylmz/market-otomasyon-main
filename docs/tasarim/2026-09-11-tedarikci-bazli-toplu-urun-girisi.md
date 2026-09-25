# Tedarikçi bazlı toplu ürün girişi — tasarım

**Tarih:** 2026-09-11
**Durum:** Uygulandı
**Kapsam:** Bir tedarikçiden gelen malı **tek belgede**, katalogda olmayan ürünlerin kartlarını
da açarak girebilmek. Hem kasada hem yönetim panelinde; yetki ADMIN + MÜDÜR.

---

## Sorun

Toptancıdan gelen malın büyük kısmı katalogda yoktur. Bugünkü yollar bu işi karşılamıyor:

- **Kasa:** ürünler tek tek "Yeni Ürün" diyaloğundan açılıyor (her ürün için aç-kaydet-kapat),
  ya da CSV içe aktarma kullanılıyor — toptancının karşısında dosya hazırlamak gerçekçi değil.
  Mal Kabul ekranı yalnız **mevcut** ürünleri kabul ediyor: `zAlisGirdi` kaleminde `urun_id`
  zorunlu.
- **Panel:** aynı şekilde tek tek "Yeni Ürün"; Alış faturası kalemleri de mevcut ürünlerden
  seçiliyor.
- `urunler.varsayilan_tedarikci_id` sütunu üç şemada da var ama onu yazan tek yer mal kabul
  ([stok-servis.ts:373](../../apps/desktop/src/main/servis/stok-servis.ts)); ne kasa ürün
  kartı ne panelin `POST /v1/urunler` ucu dokunuyor.

Sonuç: "şu toptancıdan, şu tarihte, şunları, şu fiyata aldım" bilgisi ya hiç oluşmuyor ya da
ürün kartlarıyla belge birbirine bağlanmadan dağılıyor. Kullanıcının asıl istediği, iki hafta
sonra bir sorun çıktığında **o girişi bir bütün olarak açıp bakabilmek**.

## Kararlar

| Karar | Seçim | Gerekçe |
|---|---|---|
| Kayıt biçimi | Yeni belge türü değil, **mevcut alış faturası** | Tedarikçiye + tarihe göre listeleme, detay, iptal (ters kayıt) ve iki yönlü senkron iki uygulamada da zaten var ve testli. İkinci bir "parti" altyapısı aynı işi tekrar eder. "Ne zaman, kimden, kaça aldım" zaten faturanın cevapladığı sorudur. |
| Ürünü kim yaratır | **Kasa** | "Belgeyi kasa üretir, panel niyeti yazar" kuralı ([senkron-protokolu.md](../senkron-protokolu.md)). Ürün + fatura + stok + cari tek transaction'da doğar; panelden girilen fatura kasadan girilenle birebir aynı yoldan geçer. |
| Açılış stoğu | **Ayrı `ACILIS` hareketi yok** | Stok, faturanın `GIRIS` hareketidir ve `belge_id = fatura_id` taşır. Miktar belgeyle aynı yerde durur; `stok_duzeltmeleri` talimatına gerek kalmaz. |
| Kalem sözleşmesi | `urun_id` **XOR** `yeni_urun` | Gerçek irsaliyede bilinen ve yeni ürün bir aradadır, tek belge olmalıdır. `urun_id` opsiyonele düşer; mevcut çağrıların hiçbiri bozulmaz. |
| Satış fiyatı | Kâr marjı **arayüzde** hesaplanır, kuruş gönderilir | `marjdanFiyat` zaten var ve testli. Aynı fiyat kasada ve bulutta iki ayrı yuvarlamayla hesaplanırsa raf etiketi panelle ayrışır. |
| Tedarikçi borcu | Fatura her zaman borç yazar; ödeme **ayrı** hareket | Ekstrede "1.240 aldım / 1.240 ödedim" çifti görünür — mutabakat ve denetim için gereken budur. Ödendi işaretlenirse bakiye sıfır kalır. |
| Kasaya dokunmayan ödeme | `odeme_tipi` += **`HAVALE`** | Parayı çekmeceden vermeden borcu kapatmak yaygın hâl; bugün bunun için ödemeyi `KART` diye yanlış etiketlemek gerekiyor. `KART` ile aynı işlenir, yalnız ekstrede doğru yazar. |
| Yetki | `stok.giris` **+** `urun.duzenle` (yeni ürün varsa) | İkisi de ADMIN+MÜDÜR varsayılanında, kasiyerde ikisi de yok. Yeni yetki uydurulmuyor; patron istediği müdürden Kullanıcılar ekranından alabiliyor. |
| Satır sınırı | 200 | Tek transaction'da yazılıyor; irsaliye için fazlasıyla yeterli, kazara yapıştırılan devasa liste kasayı kilitlemesin. |

## Mimari

Yeni bir senkron varlığı, yeni tablo ve yeni belge türü **yoktur**. İki giriş noktası, tek yol:

```
KASA (çevrimdışı da çalışır)
  Ürünler → "Tedarikçiden Toplu Ürün"
        │  satırlar: yeni ürün ve/veya mevcut ürün
        ▼
  stok.malKabul IPC ───► malKabulOnayla()   ← tek transaction (yeni IPC kanalı yok)
        │                   ├─ yeni_urun satırları: urunKaydet + barkodEkle
        │                   ├─ alış faturası + kalemler
        │                   ├─ stok GIRIS  (belge_id = fatura_id)
        │                   ├─ cari BORÇ (+ ödendiyse ÖDEME)
        │                   └─ outbox olayları
        ▼
  bir sonraki push'ta buluta

PANEL
  Alış → "Yeni Fatura" (yeni ürün satırı destekli)
        │
        ▼
  POST /v1/alis-talimatlari  ──► alis_talimatlari (versiyon alır)
        │  bulut: tedarikçi var mı, barkod kullanımda mı (ön kontrol)
        ▼
  pull ──► KASA ──► aynı malKabulOnayla() ──► aynı belge, aynı hareketler
```

Panelden girilen ürün, kasa talimatı uygulayıp push edene kadar panelde görünmez. Bu, bugün
panelden girilen faturalarda da böyle; ekranda "kasa bir sonraki senkronda uygular" uyarısı
zaten var.

## Değişiklikler

### `packages/shared`
- `zYeniUrunKalemi`: `{ ad, barkod?, marka?, birim_tipi, kategori_id?, satis_fiyati, kritik_stok? }`
  — `satis_fiyati` KDV **dahil** raf fiyatı. `kategori_id` satır alanıdır; arayüzdeki başlık
  kategorisi yalnız satırları doldurmak için bir kolaylıktır, sözleşmede karşılığı yoktur.
- `zAlisGirdi.kalemler[]`: `urun_id` opsiyonel olur, `yeni_urun?` eklenir, `superRefine` ile
  "ikisinden tam biri" kuralı. Kalemin `birim_fiyat`'ı yeni ürünün alış fiyatı olur.
- `zAlisGirdi.kalemler`: `.max(200)` eklenir (bugün üst sınır yok).
- `zAlisGirdi.odeme_tipi`: `'NAKIT' | 'KART' | 'HAVALE'`. Alışta bu alan veritabanına
  yazılmaz — yalnız cari hareketin açıklamasına ve "kasadan düşülsün mü" kararına girer,
  o yüzden CHECK kısıtı değişmez. (`satis_odemeleri.odeme_tipi` ayrı bir alandır, dokunulmuyor.)

### `apps/desktop` — ana süreç
- `malKabulOnayla` ([stok-servis.ts:264](../../apps/desktop/src/main/servis/stok-servis.ts)):
  kalemler işlenmeden önce `yeni_urun` taşıyanlar yaratılır — `yetkiIste('urun.duzenle')`,
  `barkodSahibi` ile çakışma kontrolü (hata mesajı satır numarası ve mevcut ürün adıyla),
  `urunKaydet` (`varsayilan_tedarikci_id` = faturanın tedarikçisi, `alis_fiyati` = `birim_fiyat`),
  `barkodEkle`, `URUN_KAYDEDILDI` + `BARKOD_KAYDEDILDI` olayları. Sonra kalem normal akışa girer.
- Ödeme: `HAVALE` `KART` gibi işlenir (cari kapanır, kasa hareketi yazılmaz).
- Yan düzeltme: `urunleriIceAktar` açılış stoğu için `hareketEkle` çağırıp `stokOlayiYaz`
  çağırmıyor ([katalog-servis.ts:741](../../apps/desktop/src/main/servis/katalog-servis.ts)) —
  CSV'den gelen açılış stoğu buluta hiç gitmiyor. Bitişik ve aynı sınıftan bir hata; testiyle
  birlikte düzeltilir.

### `apps/desktop` — arayüz
- **Yeni dosya** `sayfa/stok/TopluUrunGirisiDiyalogu.tsx`. (`Urunler.tsx` 1718, `Stok.tsx` 1300+
  satır; yeni diyalog içlerine eklenmiyor.) Üstte tedarikçi, kategori, hedef kâr marjı, fatura no,
  ödeme durumu; altta satır listesi. Barkod okutma yeni satır açar ve imleci ada taşır; alış
  fiyatı yazılınca satış fiyatı marjdan dolar; "Mevcut üründen ekle" ürün seçiciyi açar.
  Okutulan barkod kayıtlıysa satır kırmızıya döner ve ürünün adını gösterir.
- `Urunler.tsx`: "Yeni Ürün"ün yanına **"Tedarikçiden Toplu Ürün"** (yalnız `stok.giris` +
  `urun.duzenle` olanlara görünür).
- `Stok.tsx`: Mal Kabul diyaloğuna "Yeni ürün mü geldi?" kısayolu.

### `apps/api`
- `zAlisTalimatiGovde.kalemler[]` aynı XOR'u kabul eder.
- `OLUSTUR` doğrulaması: `urun_id` satırlarında ürün varlığı (mevcut davranış), `yeni_urun`
  satırlarında şekil + barkodun bulutta kullanımda olmaması + gövde içinde yinelenmemesi.
  Kesin kontrol kasada; bu, kullanıcı hâlâ ekrandayken uyarmak içindir.
- `odeme_tipi` enum'u `HAVALE` kabul eder.

### `apps/panel`
- Alış → "Yeni Fatura": satır tipi seçimi (mevcut ürün / yeni ürün), kâr marjı kutusu, ödeme
  durumu seçimi. Mobil-öncelikli olduğu için satırlar kart biçiminde.
- Ürünler sayfasına kısayol: diyalog kopyalanmaz, Alış sayfasındaki diyaloğu açacak
  şekilde yönlendirilir (`/alis?yeni=1`).

## Akış: yeni ürünlü bir kalem

1. Kullanıcı barkodu okutur/yazar, adı ve alış fiyatını girer; satış fiyatı marjdan hesaplanır.
2. Kaydet → `malKabulOnayla` tek transaction açar.
3. Barkod başka üründe kayıtlıysa **hiçbir satır yazılmaz**; hata satır numarası ve o ürünün
   adıyla döner, diyalog açık kalır, girilen satırlar durur.
4. Ürün kartı yazılır (tedarikçi + kategori + fiyatlar), barkodu eklenir, olayları outbox'a düşer.
5. Fatura kalemi yazılır, `GIRIS` hareketi `belge_id = fatura_id` ile eklenir, `stokOlayiYaz`
   çalışır.
6. Fatura toplamı tedarikçiye **borç**, ödendiyse aynı tutarda **ödeme** hareketi yazılır;
   `NAKIT` ise kasadan da düşer.
7. İki hafta sonra: Kasa → Stok → Alış Faturaları ya da Panel → Alış, tedarikçi ve tarihe göre
   filtrelenir; belge açılınca o girişte gelen bütün ürünler, miktarları ve birim fiyatlarıyla
   bir arada görünür. Yanlışsa "İptal" stoğu ve borcu ters kayıtla geri alır.

## Bilinen sınırlar

- Panelden gönderilen talimat kasada uygulanamazsa (ör. arada aynı barkod kasada açılmışsa)
  hata yalnız kasada kalır, panele geri dönmez — mevcut davranış, bu tasarım değiştirmiyor.
  Buluttaki barkod ön kontrolü pratikte bu hâlleri ekranda yakalar.
- Panele bugün **yalnız ADMIN** giriş yapabiliyor (`kimlik.ts` girişte `rol = 'ADMIN'` arıyor);
  uçtaki `yonetici` guard'ı ADMIN+MÜDÜR'e açık olsa da müdür panelde oturum açamaz. Kasada
  müdür kendi yetkileriyle çalışır. Mevcut davranış, bu iş kapsamında değiştirilmiyor.
- Toplu girişte **miktar zorunludur**: fatura kalemi miktarsız olamaz. "Ürünü şimdi tanımlayayım,
  malı sonra alayım" için tekil "Yeni Ürün" kullanılır.
- Ürünleri tedarikçiye göre listeleme/filtreleme bu işin dışında bırakıldı. Kasadaki katalog
  sorgusu filtreyi destekliyor ([katalog.ts:299](../../apps/desktop/src/main/depo/katalog.ts)),
  ekranda seçici yok; panelde liste `tedarikci_adi` döndürmüyor.

## Test

- **shared (vitest):** kalem XOR şeması — `urun_id` de `yeni_urun` de yoksa/ikisi de varsa
  reddedilir; mevcut `zAlisGirdi` gövdeleri geçerli kalır.
- **Kasa (vitest):** yeni ürünlü mal kabul ürün + barkod + fatura kalemi + `GIRIS` hareketi +
  cari borç yazar ve olayları outbox'a düşer; barkod çakışmasında hiçbir satır yazılmaz;
  `urun.duzenle` olmayan aktör reddedilir; karışık (mevcut + yeni) satırlı fatura tek belge olur;
  `HAVALE` ödemede cari kapanır ama kasa hareketi oluşmaz; CSV içe aktarmada açılış stoğu artık
  `STOK_HAREKETI` olayı üretir.
- **API (vitest):** yeni ürünlü talimat ADMIN/MÜDÜR'e açık, KASİYER'e kapalı; tedarikçi olmayan
  cari reddedilir; bulutta kullanımdaki barkod reddedilir; gövde içinde yinelenen barkod reddedilir.
- **Kasa senkron (vitest):** panelden inen yeni ürünlü talimat uygulanır, fatura ve ürün oluşur;
  ikinci pull'da tekrar uygulanmaz.
