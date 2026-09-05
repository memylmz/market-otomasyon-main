# KVKK ve Kişisel Veri Yönetimi

> ⚠️ Bu belge **genel bilgilendirme** amaçlıdır, hukuki danışmanlık değildir.
> Uygulamaya geçmeden bir hukukçu ve mali müşavirle doğrulayın. Mevzuat değişebilir.

Blueprint §16'nın uygulama karşılığı.

## Hangi kişisel veri işleniyor?

Yalnız **cari hesap** kayıtlarında:

| Alan | Zorunlu mu? | Amaç |
|---|---|---|
| Ad / unvan | Evet | Veresiye defterinde hesabı tanımlamak |
| Telefon | Hayır | Bakiye hatırlatma, ekstre gönderimi |
| E-posta | Hayır | Ekstre gönderimi |
| Adres | Hayır | Fatura/teslimat |
| Vergi no / dairesi | Hayır | Kurumsal müşteri faturası |

**Veri minimizasyonu:** TC kimlik numarası hiç istenmez. Telefon ve adres
zorunlu değildir; veresiye çalışmayan bir müşteri için hiçbir kişisel veri
girilmesi gerekmez.

Satış kayıtlarında müşteri bağlantısı yalnız veresiye satışlarda kurulur; nakit
satışta hiçbir kişisel veri tutulmaz.

## Açık rıza

Cari kartında **"SMS / WhatsApp / e-posta gönderimi için açık rıza alındı"**
kutusu vardır. İşaretlendiğinde rıza zamanı da kaydedilir.

Bu kutu işaretli değilse müşteriye ticari ileti gönderilmemelidir. Sistem rızayı
kaydeder; gönderim kararı ve aydınlatma metninin sunulması işletmenin
sorumluluğundadır.

## Veri sahibi hakları

### Silme / anonimleştirme talebi

*Cari Hesap → müşteri seç → KVKK işlemleri → Anonimleştir*
(panelde: cari kartı → Anonimleştir; `ADMIN` rolü gerekir)

Uygulanan işlem:

```
ad_unvan  → "Anonimleştirilmiş kayıt <kısa-id>"
telefon, eposta, adres, vergi_no, vergi_dairesi, notlar → NULL
iletisim_rizasi → 0
anonimlestirildi_mi → 1, aktif_mi → 0
```

**Mali kayıt bütünlüğü korunur:** hareketler, tutarlar ve tarihler aynen kalır.
Vergi mevzuatı (VUK) gereği ticari kayıtların genelde 5 yıl saklanması beklenir;
bu yüzden kaydın tamamı silinmez, yalnız kimliklendirici alanlar kaldırılır.

İşlem `denetim_log`'a gerekçesiyle birlikte yazılır ve geri alınamaz.

### Veri taşınabilirliği / erişim talebi

*Cari Hesap → müşteri seç → KVKK Dışa Aktar*

Kişisel veriler ve tüm hesap hareketleri JSON olarak indirilir. Veri sahibine bu
dosya verilebilir.

## Saklama süresi

| Veri | Süre |
|---|---|
| Ticari/mali kayıtlar (satış, cari hareket, kasa) | Mevzuat gereği genelde 5 yıl |
| Kişisel iletişim bilgileri | Amaç sona erdiğinde anonimleştirilir |
| Denetim logları | Silinmez |
| Yedekler | Son N sürüm; eski yedekler otomatik temizlenir |

> Anonimleştirilen bir carinin kişisel verisi **yedeklerde** bir süre daha
> bulunabilir. Yedek saklama sürenizi veri saklama politikanızla uyumlu tutun.

## Teknik ve idari tedbirler

- Rol bazlı erişim; KVKK işlemleri için ayrı yetki (`cari.kvkk_islem`, panelde `ADMIN`).
- Şifre/PIN hash'li; loglarda kişisel veri ve kimlik bilgisi maskelenir.
- Bulut trafiği TLS ile korunur.
- Yedekler isteğe bağlı AES-256-GCM ile şifrelenir.
- Her erişim ve değişiklik denetim loguna yazılır.

## Üçüncü taraflar

SMS / WhatsApp / e-posta sağlayıcıları **veri işleyen** konumundadır. Böyle bir
entegrasyon eklerken:

- Veri işleyen sözleşmesi yapılmalı,
- Yurt dışına aktarım varsa KVKK'nın aktarım koşulları gözetilmeli,
- Yalnız açık rızası olan carilere gönderim yapılmalıdır.

Bu sürümde otomatik gönderim **yoktur**; ekstre yalnız yerel yazıcıdan basılır ya
da dosya olarak dışa aktarılır.

## İhlal müdahalesi

Sızıntı şüphesinde:

1. Etkilenen cihazın token'ını panelden iptal edin (senkron anında durur).
2. Panel kullanıcılarının şifrelerini sıfırlayın (refresh token'lar iptal olur).
3. `denetim_log` ve API loglarını `izleme_id` ile inceleyin.
4. Gerekiyorsa KVKK'ya bildirim sürecini başlatın (yasal süreler için hukukçunuza danışın).

## Aydınlatma metni

Veresiye kaydı açarken müşteriye aydınlatma metni sunulmalıdır. Sistem bunu
otomatik göstermez; işletmenin kendi metnini kasada basılı bulundurması veya fiş
alt metnine eklemesi önerilir (*Ayarlar → İşletme → Fiş alt metni*).
