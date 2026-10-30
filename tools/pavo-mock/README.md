# Sahte Pavo N86

Gerçek cihaz olmadan Pavo entegrasyonunu denemek için. Cybele kasasının
mock'undan alındı; markete özgü eklemeler: Açık Hesap (veresiye) ödemesi,
`/PartialReturn` (kısmi iade) ve etkileşimsiz kipte gerçekten çalışan
`/AbortCurrentPayment`.

Dart gerekir (`dart --version`).

## Ekranlı (kartı sen onaylarsın)

`baslat.bat`'a çift tıklayın, ya da:

```
dart run tools/pavo-mock/pavo_mock_server.dart --port 4568 --serial PAVMOCK00001 --interactive
```

Tarayıcıda http://localhost:4568/_mock/ui açılır: kart istendiğinde "Onayla /
Reddet" buradan seçilir.

## Kasada

Ayarlar → Donanım → POS → **Pavo N86**: adres `127.0.0.1:4568`, seri no
`PAVMOCK00001` → Kaydet → **Eşleştir** (ekranlı kipte tarayıcıdan onaylayın)
→ Bağlantıyı Test Et.

## Senaryolar (yalnız test; uygulama `/_mock/*` çağırmaz)

```
curl -X POST localhost:4568/_mock/scenario -d "{\"failNextPayment\":true}"   # sıradaki kart reddedilsin
curl -X POST localhost:4568/_mock/scenario -d "{\"noResponseOnce\":true}"    # satış işlensin, cevap kaybolsun
curl -X POST localhost:4568/_mock/scenario -d "{\"cardDelayMs\":15000}"      # kart uzun beklesin (vazgeç denemesi)
curl localhost:4568/_mock/state                                              # cihazın iç durumu
```
