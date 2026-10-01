# Terazi Entegrasyonu

Kasaya kabloyla ya da ağla bağlı, ağırlığı bilgisayara gönderen terazi içindir.
Etiket basan barkodlu terazi bu ayarı istemez (terazi barkodu okunur).

## Açma / kapama

Ayarlar → Donanım → **Kasaya bağlı terazi**:

| Seçenek | Ne olur |
|---|---|
| Kapalı (varsayılan) | Kg ürünlerde miktar elle girilir. |
| Seri port / USB (COM) | RS-232 ya da USB-seri kablo. Port (ör. COM3), hız, veri biçimi. |
| Ağ / Ethernet (IP) | Terazinin IP:port adresi. |
| Test simülatörü | Terazi olmadan denemek için; her okumada 1,250 kg. |

Ayar yalnız o kasaya aittir; merkeze gitmez. Kaydet → **Teraziyi Test Et**.

## Satışta

Kg ürün okutulunca tartım penceresi açılır. Terazi açıksa ağırlık canlı görünür:
**Kararlı** olunca Enter ile sepete eklenir; **Sallanıyor** iken eklenmez. Kefe
boşsa, eksi (dara) ya da aşırı yük varsa pencere yazar. Kasiyer isterse elle
miktar ya da tutar yazabilir; alanı boşaltınca teraziye döner. Litre ürünlerde
terazi kullanılmaz.

## Terazi kurulumu

Terazinin kılavuzunda "PC bağlantısı / RS-232 / veri çıkışı" bölümüne bakın:

- **Hız (baud)** ve **veri biçimi**: çoğunda 9600 ve 8N1; bazılarında 7E1.
- **Komut**: terazi ağırlığı sürekli gönderiyorsa boş bırakın. İstek
  bekliyorsa kılavuzdaki komutu yazın: `W\r\n`, `P`, ENQ için `\x05` gibi.
- Terazide birim **kg** olmalı (lb kabul edilmez).

Okunan biçimler (marka fark etmez): `ST,GS,+0001.234kg`, `US,GS,…` (sallanıyor),
`  1.250`, `850 g`, `@ 01 1.234`, STX/ETX çerçeveli satırlar. Test "Terazi verisi
çözülemedi" derse gelen satır mesajda görünür; hız/biçim yanlıştır ya da yeni
bir biçimdir (`donanim/terazi.ts` → `agirlikCoz`'a eklenir).

## Yasal not

Satışta kullanılan terazinin metrolojik onaylı (damgalı) olması gerekir.
Program teraziden gelen değeri kullanır; ağırlığı kendisi ölçmez.

## Geliştirici

- Sürücüler: `apps/desktop/src/main/donanim/terazi.ts` (`TeraziSurucusu`).
- Servis: `servis/terazi-servis.ts`; IPC: `terazi.durum`, `terazi.oku`,
  `terazi.test`, `terazi.portlar`.
- Seri port `serialport` paketiyle açılır ve açık tutulur; koparsa sonraki
  okumada yeniden bağlanır.
- Testler: `test/terazi.test.ts` (sahte seri port, gerçek TCP sunucusu).
