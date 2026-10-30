// Sahte (mock) Pavo N86 REST sunucusu.
//
// MARKET KOPYASI: Cybele kasasının mock'undan (tools/pavo_mock) alındı.
// Markete özgü eklemeler — hepsi Pavo dokümanındaki gerçek protokol:
//   * Açık Hesap ödeme aracısı (Mediator 29, PaymentTypeId 14) — veresiye satış,
//   * /PartialReturn (kısmi iade) — RelatedSaleId + RelatedSaleItemId ile,
//   * /AbortCurrentPayment etkileşimsiz kipte süren kart adımını gerçekten keser.
//
// Amaç: gerçek cihaz gelmeden PavoPayService'i uçtan uca geliştirmek. Bu
// sunucu, docs/pavo/ altındaki resmi doküman örnekleriyle ve Pavo'nun mail
// cevabıyla (docs/pavo/pavo-cevaplari-2026-08.md) BİREBİR aynı protokolü
// konuşur — alan adları, tuhaflıklar dahil:
//   * Hata mesajı alanı `Message` (genel bakıştaki `ErrorMessage` değil),
//   * ListPendingSaleWithDetail "askıda satış yok"u HasError=true +
//     ErrorCode:"NoPendingSales" (string!) olarak döner,
//   * CheckPendingSale/ListPending kalem anahtarı `SaleItems`,
//     satış cevaplarında `AddedSaleItems`,
//   * Satış cevabında hem `SaleInquieryLink` hem sonu boşluklu
//     `"SaleInquieryLink "` anahtarı bulunur (gerçek cihaz örneğindeki gibi).
//
// Uygulama bu sunucunun mock olduğunu BİLMEZ: sadece IP+port ayarıdır. Cihaz
// geldiği gün ayarlardaki IP değiştirilecek, kod değişmeyecek.
//
// Çalıştırma:
//   dart run tools/pavo_mock/pavo_mock_server.dart            # 4568 (HTTP)
//   dart run tools/pavo_mock/pavo_mock_server.dart --port 4568
//
// İki cihazlı deneme (kasa + garson POS): her biri ayrı süreç, ayrı seri no,
// ayrı durum dosyası → ayrı eşleşme, ayrı sequence, ayrı satış defteri, ayrı
// gün sonu. Gerçekte iki N86 iki IP'dir; burada aynı IP'de iki porttur.
//   dart run tools/pavo_mock/pavo_mock_server.dart --port 4568 --serial PAVMOCK00001
//   dart run tools/pavo_mock/pavo_mock_server.dart --port 4570 --serial PAVMOCK00002 --terminal-id 14633 --state mock_state_garson.json
// Varsayılanlar (argümansız) eskisiyle birebir aynı: 4568, PAVMOCK00001,
// TerminalId 14632, mock_state.json.
//
// Canlı test — ekranlı POS (kartı sen okutursun):
//   ... --interactive --name "POS-1 Kasa"
//   Tarayıcı: http://localhost:<port>/_mock/ui
//   Hazır başlatıcı: tools/pavo_mock/iki_pos_baslat.bat
//
// Senaryo enjeksiyonu (yalnızca test için; gerçek protokolün parçası değil,
// uygulama kodu ASLA /_mock/* çağırmaz):
//   POST /_mock/scenario   gövde: {"noResponseOnce":true, ...}
//   GET  /_mock/state      iç durumu döker
//   POST /_mock/reset      her şeyi sıfırlar
//
// Bilinçli olarak KATI davranır: tutar eşitliklerini kuruşuna kadar doğrular,
// sequence/saat/seri kontrollerini uygular. Böylece gerçek cihazın
// reddedeceği bir isteği mock da reddeder ve hata kodlarını uygulama
// tarafında gerçekçi biçimde test edebiliriz.

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

// ---------------------------------------------------------------------------
// Durum
// ---------------------------------------------------------------------------

// `const` değil: iki cihazlı denemede --serial / --terminal-id ile değişir.
String kSerial = 'PAVMOCK00001';
int kTerminalId = 14632;
const String kDeviceFingerprint =
    'mock/n86_mock/n86_mock:11/MOCK.1.0/keys:user/release-keys';

/// Terminalde tanımlı vergi grupları. Gerçek cihazda Pavo tanımlar; mock,
/// referans tablosundaki güncel kodları açar (KDV18/KDV8 tuzak kodları YOK —
/// onları gönderen uygulama gerçek cihazda da yanlış oranda vergilendirilir).
const Map<String, double> kTaxGroups = {
  'KDV0': 0,
  'KDV1': 1,
  'KDV10': 10,
  'KDV20': 20,
};
const Map<String, int> kTaxGroupIds = {
  'KDV0': 57,
  'KDV1': 50,
  'KDV10': 71,
  'KDV20': 70,
};

class MockState {
  String pairedFingerprint = '';
  int lastSeq = 0;
  int idCounter = 1000;
  int invoiceCounter = 100;
  final List<Map<String, dynamic>> sales = [];

  /// Alınmış mali raporların arşivi (X / X Fark / Z / T), PascalCase şemada.
  final List<Map<String, dynamic>> reports = [];
  int reportIdCounter = 12000;

  /// Kaçıncı Z alındı — Z raporunun `ZReportNo` alanı.
  int zReportNo = 0;

  /// Son Z'ye dahil edilen en büyük satış Id'si. Z ve X Fark raporları
  /// yalnızca bunun ÜSTÜNDEKİ satışları kapsar — gün sonu kapandıktan sonra
  /// aynı satışların ikinci kez raporlanmaması bununla sağlanıyor.
  int lastZSaleId = 0;

  /// Son satış isteğine dönülen cevap — gerçek cihaz gibi RAM'de tutulur,
  /// diske YAZILMAZ (LastProcessedSale "uygulama kapanınca resetlenir").
  Map<String, dynamic>? lastProcessedSaleResponse;

  Map<String, dynamic> toJson() => {
        'pairedFingerprint': pairedFingerprint,
        'lastSeq': lastSeq,
        'idCounter': idCounter,
        'invoiceCounter': invoiceCounter,
        'sales': sales,
        'reports': reports,
        'reportIdCounter': reportIdCounter,
        'zReportNo': zReportNo,
        'lastZSaleId': lastZSaleId,
      };

  void loadFrom(Map<String, dynamic> j) {
    pairedFingerprint = j['pairedFingerprint'] as String? ?? '';
    lastSeq = j['lastSeq'] as int? ?? 0;
    idCounter = j['idCounter'] as int? ?? 1000;
    invoiceCounter = j['invoiceCounter'] as int? ?? 100;
    reportIdCounter = j['reportIdCounter'] as int? ?? 12000;
    zReportNo = j['zReportNo'] as int? ?? 0;
    lastZSaleId = j['lastZSaleId'] as int? ?? 0;
    sales
      ..clear()
      ..addAll((j['sales'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => e.cast<String, dynamic>()));
    reports
      ..clear()
      ..addAll((j['reports'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => e.cast<String, dynamic>()));
  }
}

/// Test senaryoları — /_mock/scenario ile değiştirilir.
/// Desteklenen ödeme aracıları → ödeme tipi (referans tablosu).
const Map<int, int> kMediatorTypes = {1: 1, 2: 2, 29: 14};
int paymentTypeOf(int mediator) => kMediatorTypes[mediator] ?? 0;

/// /AbortCurrentPayment geldi mi? Süren kart adımı bunu görüp kesilir.
bool abortRequested = false;

class Scenario {
  /// Bir sonraki satış isteğini İŞLE ama cevabı hiç gönderme (bağlantıyı
  /// kopar). 204/timeout tatbikatı: satış cihazda var, kasa cevap alamadı.
  bool noResponseOnce = false;

  /// Bir sonraki ödemeyi başarısız yap (kart geçmedi).
  bool failNextPayment = false;

  /// Kartlı satışları 199 (gün sonu alın) ile reddet. PerformEod temizler.
  bool endOfDayRequired = false;

  /// Bir sonraki isteğe 90 (fiş basılıyor) dön.
  bool printerBusyOnce = false;

  /// Kart okuma simülasyon süresi.
  int cardDelayMs = 2500;

  /// e-Belge asenkron gecikmesi: >0 ise satış cevabı StatusId=4 ve BOŞ
  /// FinancialDocuments ile döner; bu süre sonra belge oluşur (StatusId=5).
  int documentDelayMs = 0;

  /// BİLİNMEYEN-1: ücretli sepette 0 TL satır kabul ediliyor mu?
  /// Cihaz gelince gerçek davranışa göre çevrilecek. Varsayılan: reddet
  /// (dokümandaki katı kural), ki uygulama ret yolunu da kodlasın.
  bool allowZeroLineInMixedBasket = false;

  /// BİLİNMEYEN-2: satır bazlı Rate=100 kabul ediliyor mu? Varsayılan: hayır.
  bool acceptRate100 = false;

  /// Satışları offline işaretle (IsOffline: true) — internetsiz cihaz taklidi.
  bool offlineMode = false;

  /// Gün sonu denemesi IsSucceeded=false dönsün (HasError yine false —
  /// gerçek cihazın tuzaklı davranışı).
  bool eodFails = false;

  /// Eşleştirme cihaz ekranında reddedilmiş gibi davran.
  bool pairingRejected = false;

  /// Her cevabı bu kadar geciktir (yavaş ağ simülasyonu).
  int slowResponseMs = 0;

  /// Rapor isteklerini `ReportError` ile reddet — dokümandaki "raporlanacak
  /// satış bulunamadı" durumu. Gün başında Z almaya çalışan kasiyerin ne
  /// göreceğini test etmek için.
  bool reportHasNoSales = false;

  Map<String, dynamic> toJson() => {
        'noResponseOnce': noResponseOnce,
        'failNextPayment': failNextPayment,
        'endOfDayRequired': endOfDayRequired,
        'printerBusyOnce': printerBusyOnce,
        'cardDelayMs': cardDelayMs,
        'documentDelayMs': documentDelayMs,
        'allowZeroLineInMixedBasket': allowZeroLineInMixedBasket,
        'acceptRate100': acceptRate100,
        'offlineMode': offlineMode,
        'eodFails': eodFails,
        'pairingRejected': pairingRejected,
        'slowResponseMs': slowResponseMs,
        'reportHasNoSales': reportHasNoSales,
      };

  void apply(Map<String, dynamic> j) {
    bool b(String k, bool cur) => j[k] is bool ? j[k] as bool : cur;
    int i(String k, int cur) => j[k] is int ? j[k] as int : cur;
    noResponseOnce = b('noResponseOnce', noResponseOnce);
    failNextPayment = b('failNextPayment', failNextPayment);
    endOfDayRequired = b('endOfDayRequired', endOfDayRequired);
    printerBusyOnce = b('printerBusyOnce', printerBusyOnce);
    cardDelayMs = i('cardDelayMs', cardDelayMs);
    documentDelayMs = i('documentDelayMs', documentDelayMs);
    allowZeroLineInMixedBasket =
        b('allowZeroLineInMixedBasket', allowZeroLineInMixedBasket);
    acceptRate100 = b('acceptRate100', acceptRate100);
    offlineMode = b('offlineMode', offlineMode);
    eodFails = b('eodFails', eodFails);
    pairingRejected = b('pairingRejected', pairingRejected);
    slowResponseMs = i('slowResponseMs', slowResponseMs);
    reportHasNoSales = b('reportHasNoSales', reportHasNoSales);
  }
}

final MockState state = MockState();
final Scenario scenario = Scenario();
bool _busy = false;
late final File _stateFile;
final Random _rng = Random();

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

int kurus(dynamic v) {
  if (v is num) return (v * 100).round();
  return 0;
}

double tl(int k) => k / 100.0;

double round2(double v) => (v * 100).roundToDouble() / 100.0;

String nowIso() => DateTime.now().toIso8601String();

String newSaleNumber() {
  const chars = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789';
  return List.generate(10, (_) => chars[_rng.nextInt(chars.length)]).join();
}

String newUuid() {
  String hex(int n) =>
      List.generate(n, (_) => _rng.nextInt(16).toRadixString(16)).join();
  return '${hex(8)}-${hex(4)}-7${hex(3)}-${hex(4)}-${hex(12)}';
}

Map<String, dynamic> deviceHandle() => {
      'SerialNumber': kSerial,
      'Fingerprint': kDeviceFingerprint,
      'TransactionSequence': state.lastSeq,
      'TransactionDate': nowIso(),
    };

/// Standart cevap zarfı. Gerçek örneklerdeki gibi alan adı `Message`.
Map<String, dynamic> envelope({
  bool hasError = false,
  dynamic errorCode,
  String? message,
  Map<String, dynamic>? data,
}) =>
    {
      'HasError': hasError,
      'ErrorCode': errorCode,
      'Message': message,
      'TransactionHandle': deviceHandle(),
      'Data': ?data,
    };

Map<String, dynamic> err(int code, String message) =>
    envelope(hasError: true, errorCode: code, message: message);

Future<void> saveState() =>
    _stateFile.writeAsString(const JsonEncoder.withIndent('  ')
        .convert(state.toJson()));

void log(String msg) {
  final t = DateTime.now().toIso8601String().substring(11, 19);
  stdout.writeln('[$t] $msg');
  _logRing.add('[$t] $msg');
  if (_logRing.length > 40) _logRing.removeAt(0);
}

// ---------------------------------------------------------------------------
// Etkileşimli POS ekranı (--interactive)
// ---------------------------------------------------------------------------
//
// Amaç: cihaz yokken "gerçekten cihaz varmış gibi" canlı test. Tarayıcıda
// http://localhost:<port>/_mock/ui açılır; kart ödemesi gelince ekranda tutar
// görünür ve kartı SEN "okutursun" (Onayla / Reddet / Süre dolsun). Eşleştirme
// de ekrandan onaylanır. Kasa uygulaması bunu bilmez — yalnız gerçek cihaz
// gibi geç cevap alır.
//
// --interactive verilmezse eski davranış birebir aynı (cardDelayMs ile
// kendiliğinden onay) — probe betikleri etkilenmez.

bool interactive = false;
String kDeviceName = 'Mock POS';
final List<String> _logRing = [];

/// Ekranda o an ne görünüyor. phase: idle | pairing | card | processing |
/// receipt | result.
final Map<String, dynamic> screen = {'phase': 'idle'};
DateTime _screenSince = DateTime.now();
Completer<String>? _pendingAction;
String? _pendingKind; // 'pairing' | 'card'

void setScreen(String phase, [Map<String, dynamic> extra = const {}]) {
  screen
    ..clear()
    ..['phase'] = phase
    ..addAll(extra);
  _screenSince = DateTime.now();
}

/// Kullanıcının ekrandan (ya da kasanın AbortCurrentPayment'ıyla) vereceği
/// kararı bekler. Süre dolarsa 'timeout'.
Future<String> waitForUser(String kind, Duration timeout) async {
  final c = Completer<String>();
  _pendingAction = c;
  _pendingKind = kind;
  try {
    return await c.future.timeout(timeout, onTimeout: () => 'timeout');
  } finally {
    if (identical(_pendingAction, c)) {
      _pendingAction = null;
      _pendingKind = null;
    }
  }
}

bool resolveUser(String action, {String? kind}) {
  final c = _pendingAction;
  if (c == null || c.isCompleted) return false;
  if (kind != null && _pendingKind != kind) return false;
  c.complete(action);
  return true;
}

List<Map<String, dynamic>> screenItems(List items) => [
      for (final it in items.whereType<Map>())
        {
          'name': it['Name']?.toString() ?? '',
          'qty': it['ItemQuantity'],
          'total': tl(kurus(it['TotalPriceAmount'])),
        }
    ];

int cardTimeoutOf(Map<String, dynamic>? sale) {
  final v = sale?['CardReadTimeout'];
  if (v is num && v > 0) return v.toInt();
  return 45;
}

/// Kart okutma adımı. `null` → ödeme onaylandı; aksi hâlde cihazın döneceği
/// hata cevabı.
///
/// NOT: kart reddi / süre dolması / kasadan vazgeçme için gerçek cihazın
/// döndüğü hata kodu dokümanda yok. Mock hepsinde 76 ("satış hatası") döner;
/// gerçek kod cihaz günü doğrulanmalı.
Future<Map<String, dynamic>?> cardStep({
  required int amountK,
  required String title,
  List items = const [],
  int timeoutSec = 45,
  String? orderNo,
  bool honorFailFlag = true,
}) async {
  if (!interactive) {
    abortRequested = false;
    final bitis = DateTime.now().add(Duration(milliseconds: scenario.cardDelayMs));
    while (DateTime.now().isBefore(bitis)) {
      await Future.delayed(const Duration(milliseconds: 100));
      if (abortRequested) {
        abortRequested = false;
        return err(76, 'İşlem kullanıcı tarafından iptal edildi (mock: vazgeç)');
      }
    }
    if (honorFailFlag && scenario.failNextPayment) {
      scenario.failNextPayment = false;
      return err(76, 'Bilinmeyen satış hatası (mock: kart reddedildi)');
    }
    return null;
  }

  setScreen('card', {
    'title': title,
    'amount': tl(amountK),
    'items': screenItems(items),
    'orderNo': ?orderNo,
    'deadline': DateTime.now()
        .add(Duration(seconds: timeoutSec))
        .toIso8601String(),
  });
  log('EKRAN: kart bekleniyor ${tl(amountK)} TL (süre ${timeoutSec}sn)');
  final a = await waitForUser('card', Duration(seconds: timeoutSec));
  log('EKRAN: kart kararı → $a');

  if (a == 'approve') {
    setScreen('processing', {'title': 'Banka onayı bekleniyor…', 'amount': tl(amountK)});
    await Future.delayed(const Duration(milliseconds: 900));
    if (honorFailFlag && scenario.failNextPayment) {
      scenario.failNextPayment = false;
      setScreen('result', {'ok': false, 'message': 'Banka reddetti (senaryo)'});
      return err(76, 'Bilinmeyen satış hatası (mock: kart reddedildi)');
    }
    return null;
  }
  if (a == 'decline') {
    setScreen('result', {'ok': false, 'message': 'Kart reddedildi'});
    return err(76, 'Bilinmeyen satış hatası (mock: kart reddedildi)');
  }
  if (a == 'abort') {
    setScreen('result', {'ok': false, 'message': 'Kasadan vazgeçildi'});
    return err(76, 'İşlem iptal edildi (mock: AbortCurrentPayment)');
  }
  setScreen('result', {'ok': false, 'message': 'Kart okuma süresi doldu'});
  return err(76, 'Kart okuma zaman aşımı (mock)');
}

/// Başarılı satıştan sonra ekranda fiş önizlemesi.
void showReceipt(Map<String, dynamic> data, {String title = 'Satış tamamlandı'}) {
  if (!interactive) return;
  final docs = (data['FinancialDocuments'] as List?) ?? const [];
  final pays = (data['AddedPayments'] as List?) ?? const [];
  setScreen('receipt', {
    'title': title,
    'saleNumber': data['SaleNumber'],
    'orderNo': data['OrderNo'],
    'total': data['TotalPrice'],
    'items': screenItems((data['AddedSaleItems'] as List?) ?? const []),
    'payments': [
      for (final p in pays.whereType<Map>())
        if (p['OperationTypeId'] == 1)
          {
            'name': p['PaymentMediatorId'] == 1 ? 'Nakit' : 'Kredi kartı',
            'amount': p['PaymentAmount'],
          }
    ],
    'invoiceNo': docs.isNotEmpty && docs.first is Map
        ? (docs.first as Map)['InvoiceNo']
        : null,
    'remaining': data['RemainingPaymentAmount'],
  });
}

// ---------------------------------------------------------------------------
// TransactionHandle doğrulaması
// ---------------------------------------------------------------------------

/// Sırası önemli: seri → saat → fingerprint → sequence (dokümandaki hata
/// kodlarıyla). /Ping ve /Pairing fingerprint+sequence kontrolünden muaf.
Map<String, dynamic>? validateHandle(Map<String, dynamic> body,
    {required bool exempt}) {
  final h = body['TransactionHandle'];
  if (h is! Map) return err(78, 'TransactionHandle eksik veya hatalı');
  final serial = h['SerialNumber']?.toString() ?? '';
  // GERÇEK CİHAZ DAVRANIŞI (sahada doğrulandı): seri numarası /Pairing'de de
  // doğrulanıyor. Doküman "/Ping ve /Pairing fingerprint ve sequence
  // doğrulamasından muaftır" diyor — seri numarası bu muafiyete DAHİL DEĞİL.
  // Mock bunu taklit etmezse yanlış seri numarasıyla eşleşir ve gerçek cihazda
  // hata 71 alırız.
  if (serial != kSerial) {
    return err(71, 'Seri numarası uyuşmazlığı');
  }
  final dateRaw = h['TransactionDate']?.toString() ?? '';
  final date = DateTime.tryParse(dateRaw);
  if (date == null) return err(202, 'Geçersiz RequestTime.');
  final skew = DateTime.now().difference(date).inSeconds.abs();
  if (skew > 300) {
    return err(72,
        'POS ve harici cihaz zaman uyuşmazlığı. Tolerans aralığı 300 saniyedir');
  }
  if (exempt) return null;

  if (state.pairedFingerprint.isEmpty) {
    return err(74, 'FingerPrint uyuşmazlığı (eşleştirme yapılmamış)');
  }
  final fp = h['Fingerprint']?.toString() ?? '';
  if (fp != state.pairedFingerprint) {
    return err(74, 'FingerPrint uyuşmazlığı');
  }
  final seq = h['TransactionSequence'];
  final seqInt = seq is int ? seq : int.tryParse(seq.toString());
  if (seqInt == null || seqInt <= state.lastSeq) {
    // Doküman (modeller/transactionhandle.md): "Hata 73 alındığında POS,
    // gönderilen değeri yine kaydeder" — böylece +1 retry çalışır.
    if (seqInt != null) state.lastSeq = seqInt;
    return err(73, 'İşlem sıra numarası hatası');
  }
  state.lastSeq = seqInt;
  return null;
}

// ---------------------------------------------------------------------------
// Satış doğrulama + inşa
// ---------------------------------------------------------------------------

class SaleValidation {
  final Map<String, dynamic>? error;
  final List<Map<String, dynamic>> items;
  final List<Map<String, dynamic>> payments;
  final int grossKurus;
  final int totalKurus;
  SaleValidation.err(this.error)
      : items = const [],
        payments = const [],
        grossKurus = 0,
        totalKurus = 0;
  SaleValidation.ok(this.items, this.payments, this.grossKurus, this.totalKurus)
      : error = null;
}

SaleValidation validateSale(Map<String, dynamic> sale) {
  if ((sale['RefererApp']?.toString() ?? '').isEmpty) {
    return SaleValidation.err(err(33, 'Harici uygulama ismi boş olamaz'));
  }
  if ((sale['RefererAppVersion']?.toString() ?? '').isEmpty) {
    return SaleValidation.err(err(34, 'Harici uygulama versiyonu boş olamaz'));
  }
  final mdt = sale['MainDocumentType'];
  if (mdt != 1) {
    return SaleValidation.err(
        err(178, '$mdt numaralı "MainDocumentType" bu satış için geçersiz.'));
  }

  final rawItems = sale['AddedSaleItems'];
  if (rawItems is! List || rawItems.isEmpty) {
    return SaleValidation.err(err(28, 'Sepet boş olamaz'));
  }
  final items = rawItems.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList();

  final grossKurus = kurus(sale['GrossPrice']);
  final totalKurus = kurus(sale['TotalPrice']);
  final rawPayments = sale['PaymentInformations'];
  final payments = rawPayments is List
      ? rawPayments.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList()
      : <Map<String, dynamic>>[];

  // Pavo mail cevabı: tamamen bedelsiz satışta tutarlar 0 ve ödeme YOK.
  final isZeroSale = grossKurus == 0 && totalKurus == 0;
  if (isZeroSale && payments.isNotEmpty) {
    return SaleValidation.err(
        err(24, 'Satış toplam ücreti boş veya negatif değer olamaz'));
  }
  if (grossKurus < 0 || totalKurus < 0) {
    return SaleValidation.err(
        err(23, 'Satış brüt fiyatı boş veya negatif değer olamaz'));
  }

  var sumGross = 0;
  var sumTotal = 0;
  for (var i = 0; i < items.length; i++) {
    final it = items[i];
    final no = i + 1;
    if ((it['Name']?.toString() ?? '').isEmpty) {
      return SaleValidation.err(
          err(35, 'Sipariş kalem ismi boş olamaz. Detail: Sıra No $no'));
    }
    if (it['IsGeneric'] is! bool) {
      return SaleValidation.err(err(36,
          'Sipariş kaleminin generik olup olmadığı belirtilmelidir. Detail: Sıra No $no'));
    }
    final tax = it['TaxGroupCode']?.toString() ?? '';
    if (!kTaxGroups.containsKey(tax)) {
      return SaleValidation.err(err(41,
          'Geçersiz vergi grubu kodu. Detail: Sıra No $no Vergi grubu kodu $tax'));
    }
    final qty = it['ItemQuantity'];
    final qtyD = qty is num ? qty.toDouble() : 0.0;
    if (qtyD < 0.01) {
      return SaleValidation.err(err(37,
          'Sipariş kalemi miktarı 0\'dan büyük olmalıdır. Detail: Sıra No $no'));
    }
    final unitK = kurus(it['UnitPriceAmount']);
    final lineGrossK = kurus(it['GrossPriceAmount']);
    var lineTotalK = kurus(it['TotalPriceAmount']);

    // Satır bazlı PriceEffect (Type 1 indirim / 4 artırım).
    final pe = it['PriceEffect'];
    if (pe is Map) {
      final type = pe['Type'];
      final hasRate = pe['Rate'] is num;
      final hasAmount = pe['Amount'] is num;
      if (hasRate == hasAmount) {
        return SaleValidation.err(err(135,
            'Rate ve Amount alanlarından sadece birisi kullanılmalıdır.'));
      }
      if (type != 1 && type != 4) {
        return SaleValidation.err(
            err(27, 'İskonto tipi(PriceEffectType = $type) bulunamadı'));
      }
      if (hasRate) {
        final r = (pe['Rate'] as num).toDouble();
        if (r <= 0 || r > 100) {
          return SaleValidation.err(err(25,
              'İndirim oranı 0\'dan büyük 100\'den küçük veya eşit olmalıdır'));
        }
        if (type == 1 && r == 100 && !scenario.acceptRate100) {
          // BİLİNMEYEN-2: cihaz gelince netleşecek; şimdilik katı yol.
          return SaleValidation.err(err(40,
              'Sipariş kalemi toplam ücreti 0\'dan büyük olmalıdır. Detail: Sıra No $no'));
        }
      } else {
        final aK = kurus(pe['Amount']);
        if (type == 1 && (aK <= 0 || aK >= lineGrossK)) {
          return SaleValidation.err(err(136,
              'İndirim tutarı 0\'dan büyük GrossPrice\'dan küçük olmalıdır.'));
        }
      }
    }

    final zeroLine = unitK == 0 || lineGrossK == 0 || lineTotalK == 0;
    if (zeroLine) {
      final wholeSaleFree = isZeroSale;
      final tolerated =
          wholeSaleFree || scenario.allowZeroLineInMixedBasket; // BİLİNMEYEN-1
      if (!tolerated) {
        if (unitK <= 0) {
          return SaleValidation.err(err(38,
              'Sipariş kalemi birim fiyatı 0\'dan büyük olmalıdır. Detail: Sıra No $no'));
        }
        if (lineGrossK <= 0) {
          return SaleValidation.err(err(39,
              'Sipariş kalemi brüt ücreti 0\'dan büyük olmalıdır. Detail: Sıra No $no'));
        }
        return SaleValidation.err(err(40,
            'Sipariş kalemi toplam ücreti 0\'dan büyük olmalıdır. Detail: Sıra No $no'));
      }
    }

    final calc = (qtyD * unitK).round();
    if (calc != lineGrossK) {
      return SaleValidation.err(err(42,
          'Sipariş kalemi miktarı ve birim ücreti hesabı(${tl(calc)}) sipariş kalemi brüt(${tl(lineGrossK)}) ücrete eşit olmalıdır'));
    }
    sumGross += lineGrossK;
    sumTotal += lineTotalK;
  }

  if (sumGross != grossKurus) {
    return SaleValidation.err(err(45,
        'Sipariş kalemleri toplam brüt ücreti(${tl(sumGross)}) sipariş toplam brüt ücretine(GrossPrice: ${tl(grossKurus)}) eşit olmalıdır'));
  }

  // Satış bazlı PriceEffect (Type 2 indirim / 3 artırım): beklenen TotalPrice
  // satır toplamından türetilir; kuruş farkı kabul edilmez.
  var expectedTotal = sumTotal;
  final salePe = sale['PriceEffect'];
  if (salePe is Map) {
    final type = salePe['Type'];
    final hasRate = salePe['Rate'] is num;
    final hasAmount = salePe['Amount'] is num;
    if (hasRate == hasAmount) {
      return SaleValidation.err(
          err(135, 'Rate ve Amount alanlarından sadece birisi kullanılmalıdır.'));
    }
    if (type != 2 && type != 3) {
      return SaleValidation.err(
          err(27, 'İskonto tipi(PriceEffectType = $type) bulunamadı'));
    }
    if (hasRate) {
      final r = (salePe['Rate'] as num).toDouble();
      if (r <= 0 || r > 100) {
        return SaleValidation.err(err(25,
            'İndirim oranı 0\'dan büyük 100\'den küçük veya eşit olmalıdır'));
      }
      final delta = (sumTotal * r / 100).round();
      expectedTotal = type == 2 ? sumTotal - delta : sumTotal + delta;
    } else {
      final aK = kurus(salePe['Amount']);
      if (type == 2 && (aK <= 0 || aK >= grossKurus)) {
        return SaleValidation.err(err(136,
            'İndirim tutarı 0\'dan büyük GrossPrice\'dan küçük olmalıdır.'));
      }
      expectedTotal = type == 2 ? sumTotal - aK : sumTotal + aK;
    }
  }
  if (expectedTotal != totalKurus) {
    return SaleValidation.err(err(44,
        'Sipariş kalemleri toplam ücreti(${tl(expectedTotal)}) sipariş toplam ücretine(TotalPrice: ${tl(totalKurus)}) eşit olmalıdır'));
  }

  // Ödemeler.
  var paySum = 0;
  for (final p in payments) {
    final mediator = p['Mediator'];
    if (!kMediatorTypes.containsKey(mediator)) {
      return SaleValidation.err(err(18, 'Ödeme aracısı bulunamadı'));
    }
    final aK = kurus(p['Amount']);
    if (aK <= 0) {
      return SaleValidation.err(err(65, 'Harici ödeme 0\'dan büyük olmalıdır'));
    }
    paySum += aK;
  }
  if (payments.isNotEmpty && paySum != totalKurus) {
    return SaleValidation.err(err(69,
        'Sepet toplam tutarı (${tl(totalKurus)}) harici ödenecek (${tl(paySum)}) tutara eşit değildir'));
  }

  return SaleValidation.ok(items, payments, grossKurus, totalKurus);
}

/// Satış kaydını (cevap Data gövdesiyle aynı biçimde) üretir ve saklar.
Future<Map<String, dynamic>> buildAndStoreSale(
  Map<String, dynamic> sale,
  SaleValidation v, {
  required bool collectPayments,
}) async {
  final id = ++state.idCounter;
  final saleNumber = newSaleNumber();
  final orderNo = sale['OrderNo']?.toString();

  final respItems = <Map<String, dynamic>>[];
  for (final it in v.items) {
    final tax = it['TaxGroupCode'].toString();
    final rate = kTaxGroups[tax]!;
    final lineTotalK = kurus(it['TotalPriceAmount']);
    final vat = rate == 0
        ? 0.0
        : round2(tl(lineTotalK) * rate / (100 + rate));
    respItems.add({
      'Id': id * 10 + respItems.length,
      'SaleId': id,
      'StatusId': 1,
      'Name': it['Name'],
      'ItemQuantity': (it['ItemQuantity'] as num).toDouble(),
      'UnitPriceAmount': tl(kurus(it['UnitPriceAmount'])),
      'GrossPriceAmount': tl(kurus(it['GrossPriceAmount'])),
      'TotalPriceAmount': tl(lineTotalK),
      'VATAmount': vat,
      'VATRate': rate,
      'UnitName': 'Adet',
      'TaxGroupId': kTaxGroupIds[tax],
      'IsGeneric': it['IsGeneric'],
      'ConvertedTotal': tl(lineTotalK),
      if (it['Barcode'] != null) 'Barcode': it['Barcode'],
      if (it['ReservedText'] != null) 'ReservedText': it['ReservedText'],
    });
  }

  // Ödemeleri "tahsil et" (kart için gecikme; senaryoya göre hata).
  final respPayments = <Map<String, dynamic>>[];
  if (collectPayments) {
    for (final p in v.payments) {
      final mediator = p['Mediator'] as int;
      if (mediator == 2) {
        if (scenario.endOfDayRequired) {
          throw PavoFlowError(err(199, 'Lütfen gün sonu alınız.'));
        }
        final cardErr = await cardStep(
          amountK: kurus(p['Amount']),
          title: 'Kartı okutun',
          items: v.items,
          timeoutSec: cardTimeoutOf(sale),
          orderNo: orderNo,
        );
        if (cardErr != null) throw PavoFlowError(cardErr);
      }
      final aK = kurus(p['Amount']);
      final givenK = p['GivenAmount'] is num ? kurus(p['GivenAmount']) : aK;
      respPayments.add({
        'Id': id * 100 + respPayments.length,
        'SaleId': id,
        'StatusId': 2,
        'MerchantId': 2688,
        'PaymentAmount': tl(aK),
        'PaymentTypeId': paymentTypeOf(mediator),
        'PaymentMediatorId': mediator,
        'OperationTypeId': 1,
        'IsExternal': false,
        if (mediator == 1)
          'CashPayment': {
            'Id': 0,
            'PaymentId': id * 100 + respPayments.length,
            'SaleId': id,
            'GivenAmount': tl(givenK),
            'ChangeAmount': tl(givenK - aK),
          },
        'CurrencyCode': 'TRY',
        'ExchangeRate': 1.0,
        'ConvertedTotal': tl(aK),
        'MediatorPaymentReference': '$saleNumber-${nowIso()}',
        'ExternalReference':
            p['ExternalReferenceText']?.toString() ?? 'null',
      });
    }
  }

  final paid = respPayments.fold<int>(0, (a, p) => a + kurus(p['PaymentAmount']));
  final remaining = v.totalKurus - paid;
  // Tamamen bedelsiz satış ödemesiz "tamamlanmış" sayılır (Pavo cevabı).
  final finalized = v.totalKurus == 0 || (v.payments.isNotEmpty && remaining <= 0);

  final taxes = <double, double>{};
  for (final it in respItems) {
    final r = it['VATRate'] as double;
    taxes[r] = (taxes[r] ?? 0) + (it['VATAmount'] as double);
  }

  final documentsDelayed = scenario.documentDelayMs > 0;
  final documents = finalized && !documentsDelayed
      ? [_newDocument()]
      : <Map<String, dynamic>>[];

  final data = <String, dynamic>{
    'Id': id,
    'SaleNumber': saleNumber,
    'IsOffline': scenario.offlineMode,
    'OrderNo': ?orderNo,
    'TypeId': 1,
    'StatusId': finalized ? (documentsDelayed ? 4 : 4) : 23,
    'SaleDate': nowIso(),
    'GrossPrice': tl(v.grossKurus),
    'TotalPrice': tl(v.totalKurus),
    'CurrencyCode': 'TRY',
    'ExchangeRate': 1.0,
    'TotalVATAmount': round2(taxes.values.fold(0.0, (a, b) => a + b)),
    'MerchantId': 2688,
    'TerminalId': kTerminalId,
    'TerminalSerialNo': kSerial,
    'ApplicationId': 28,
    'MultiPayment': respPayments.length > 1,
    'MultiDocument': false,
    'GMUVersion': 'mock-1.0',
    'RefererApp': sale['RefererApp'],
    'RefererAppVersion': sale['RefererAppVersion'],
    'AddedSaleItems': respItems,
    'AddedPriceEffects': const [],
    'AddedPayments': respPayments,
    'FinancialDocuments': documents,
    // FATURALI SATIŞ: müşteri bilgisi geldiyse kayıtta durur (gerçek cihaz
    // e-Arşiv FATURA keser; nihai tüketicide bilgi fişi). Kasanın gerçekten
    // gönderdiğini /_mock/state'ten görmek için.
    if (sale['CustomerParty'] is Map) 'CustomerParty': sale['CustomerParty'],
    'SaleUid': newUuid(),
    'IsInFlightSale': false,
    'CancelRequested': false,
    // Gerçek cihaz örneğindeki çift anahtar tuhaflığı bilerek korunur —
    // istemcinin toleranslı parse'ı bununla test edilir.
    'SaleInquieryLink ': 'p.overtech.com.tr/$saleNumber',
    'SaleInquieryLink': 'p.overtech.com.tr/$saleNumber',
    'IsSuspendedSale': !finalized,
    'RemainingPaymentAmount': tl(max(0, remaining)),
    'Taxes': [
      for (final e in taxes.entries)
        {
          'TaxRate': e.key,
          'TotalTaxAmount': round2(e.value),
          'TotalAmount': tl(v.totalKurus),
        }
    ],
  };

  state.sales.add(data);
  await saveState();

  // Asenkron e-belge: belirlenen süre sonra belge "oluşur".
  if (finalized && documentsDelayed) {
    final saleId = id;
    Timer(Duration(milliseconds: scenario.documentDelayMs), () async {
      Map<String, dynamic>? s;
      for (final x in state.sales) {
        if (x['Id'] == saleId) {
          s = x;
          break;
        }
      }
      if (s == null) return;
      s['StatusId'] = 5;
      (s['FinancialDocuments'] as List).add(_newDocument());
      await saveState();
      log('e-belge oluştu (gecikmeli): sale $saleId');
    });
  }

  return data;
}

Map<String, dynamic> _newDocument() {
  final invoiceNo =
      '8OC${DateTime.now().year}${(++state.invoiceCounter).toString().padLeft(9, '0')}';
  final ettn = newUuid();
  return {
    'Id': state.invoiceCounter,
    'InvoiceNo': invoiceNo,
    'InquiryLink':
        'http://overegov-mock.local/EArchiveInquiryView/Index?ettn=$ettn',
    'DocumentNo': ettn,
    'Type': {'Id': 2, 'Name': 'E-Arşiv', 'Cancellable': true},
  };
}

/// Akış içinden hata cevabı fırlatmak için (ödeme reddi, gün sonu vb.).
class PavoFlowError implements Exception {
  final Map<String, dynamic> response;
  PavoFlowError(this.response);
}

// ---------------------------------------------------------------------------
// Endpoint işleyicileri
// ---------------------------------------------------------------------------

Map<String, dynamic>? findSale(Map<String, dynamic> q) {
  final id = q['Id'];
  final saleNumber = q['SaleNumber']?.toString();
  final orderNo = q['OrderNo']?.toString();
  final invoiceNo = q['InvoiceNo']?.toString();
  for (final s in state.sales.reversed) {
    if (id is int && id != 0 && s['Id'] == id) return s;
    if (saleNumber != null && saleNumber.isNotEmpty && s['SaleNumber'] == saleNumber) {
      return s;
    }
    if (orderNo != null && orderNo.isNotEmpty && s['OrderNo'] == orderNo) return s;
    if (invoiceNo != null && invoiceNo.isNotEmpty) {
      final docs = s['FinancialDocuments'] as List? ?? const [];
      if (docs.any((d) => d is Map && d['InvoiceNo'] == invoiceNo)) return s;
    }
  }
  return null;
}

Future<Map<String, dynamic>> handlePairing(Map<String, dynamic> body) async {
  final h = body['TransactionHandle'];
  final fp = h is Map ? h['Fingerprint']?.toString() ?? '' : '';
  if (interactive) {
    // Gerçek cihaz gibi: ekranda onay ister.
    setScreen('pairing', {'fingerprint': fp});
    log('EKRAN: eşleştirme onayı bekleniyor');
    final a = await waitForUser('pairing', const Duration(seconds: 120));
    if (a != 'approve') {
      setScreen('result', {'ok': false, 'message': 'Eşleştirme reddedildi'});
      return err(0, 'Eşleştirme cihaz üzerinde reddedildi (mock)');
    }
  } else {
    // Cihaz ekranındaki onayın süresi.
    await Future.delayed(const Duration(milliseconds: 1500));
  }
  if (scenario.pairingRejected) {
    return err(0, 'Eşleştirme cihaz üzerinde reddedildi (mock)');
  }
  if (fp.isEmpty) return err(74, 'FingerPrint uyuşmazlığı');
  state.pairedFingerprint = fp;
  state.lastSeq = 1; // Doküman: pairing sayacı sıfırlar, sıradaki işlem 2.
  await saveState();
  log('Eşleştirildi: fingerprint=$fp');
  if (interactive) {
    setScreen('result', {'ok': true, 'message': 'Eşleştirildi'});
  }
  // Gerçek örnekteki gibi: Data yok, handle'da sıradaki sequence (2) döner.
  return {
    'HasError': false,
    'Message': '',
    'TransactionHandle': {
      'SerialNumber': kSerial,
      'Fingerprint': kDeviceFingerprint,
      'TransactionSequence': 2,
      'TransactionDate': nowIso(),
    },
  };
}

Map<String, dynamic> handlePing() {
  if (state.pairedFingerprint.isEmpty) {
    return {
      'HasError': true,
      'Message': 'Ping başarısız. Lütfen eşleştirme yapınız.',
      'TransactionHandle': {
        'SerialNumber': kSerial,
        'Fingerprint': '',
        'TransactionSequence': 0,
        'TransactionDate': '',
      },
    };
  }
  return {
    'HasError': false,
    'Message': '',
    'TransactionHandle': {
      'SerialNumber': kSerial,
      'Fingerprint': kDeviceFingerprint,
      // Doğrulama ajanının notu: Ping cihazdaki güncel sayacı söyler (73
      // kurtarmasında işe yarar) ve sayacı DEĞİŞTİRMEZ.
      'TransactionSequence': state.lastSeq + 1,
      'TransactionDate': nowIso(),
    },
  };
}

Future<Map<String, dynamic>> handleStartSale(Map<String, dynamic> body) async {
  final sale = (body['Sale'] as Map?)?.cast<String, dynamic>();
  if (sale == null) {
    return err(175, 'Gönderilen input boş veya key hatalı. Bu servis için input key: Sale');
  }

  // Mükerrer sipariş kontrolü — Pavo mail cevabı: SON 20 satışa bakılır.
  final orderNo = sale['OrderNo']?.toString();
  if (orderNo != null && orderNo.isNotEmpty) {
    final recent = state.sales.reversed.take(20);
    if (recent.any((s) => s['OrderNo'] == orderNo)) {
      return err(129,
          'Gönderilen satışa ait Order No $orderNo ile son satış işleminize ait Order No aynıdır.');
    }
  }

  final v = validateSale(sale);
  if (v.error != null) return v.error!;

  try {
    final data = await buildAndStoreSale(sale, v, collectPayments: true);
    showReceipt(data,
        title: data['IsSuspendedSale'] == true
            ? 'Askıda satış (ödeme bekliyor)'
            : 'Satış tamamlandı');
    // SendResponseBeforePrint=false → fiş basımı bitmeden cevap dönmez.
    if (sale['SendResponseBeforePrint'] == false) {
      await Future.delayed(const Duration(milliseconds: 1200));
    }
    final resp = envelope(data: data);
    state.lastProcessedSaleResponse = resp;
    return resp;
  } on PavoFlowError catch (e) {
    state.lastProcessedSaleResponse = e.response;
    return e.response;
  }
}

Future<Map<String, dynamic>> handleAddPaymentAndFinalize(
    Map<String, dynamic> body) async {
  final sale = (body['Sale'] as Map?)?.cast<String, dynamic>();
  if (sale == null) {
    return err(175, 'Gönderilen input boş veya key hatalı. Bu servis için input key: Sale');
  }
  final s = findSale(sale);
  if (s == null) return err(1, 'Satış bulunmamaktadır');
  if (s['IsSuspendedSale'] != true) return err(185, 'Geçersiz Askıda Satış.');

  final rawPays = sale['PaymentInformations'];
  final pays = rawPays is List
      ? rawPays.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList()
      : <Map<String, dynamic>>[];
  if (pays.length != 1) return err(186, 'Geçersiz AddPayment input.');
  final p = pays.single;
  final mediator = p['Mediator'];
  if (mediator is! int || !kMediatorTypes.containsKey(mediator)) {
    return err(18, 'Ödeme aracısı bulunamadı');
  }
  final aK = kurus(p['Amount']);
  final remainingK = kurus(s['RemainingPaymentAmount']);
  if (aK <= 0 || aK > remainingK) {
    return err(66, 'Harici ödemeler toplam ödemeden fazla olamaz');
  }

  if (mediator == 2) {
    if (scenario.endOfDayRequired) return err(199, 'Lütfen gün sonu alınız.');
    final cardErr = await cardStep(
      amountK: aK,
      title: 'Kartı okutun (kalan ödeme)',
      items: (s['AddedSaleItems'] as List?) ?? const [],
      timeoutSec: cardTimeoutOf(sale),
      orderNo: s['OrderNo']?.toString(),
    );
    if (cardErr != null) return cardErr;
  }

  final givenK = p['GivenAmount'] is num ? kurus(p['GivenAmount']) : aK;
  final payId = (s['Id'] as int) * 100 + (s['AddedPayments'] as List).length;
  (s['AddedPayments'] as List).add({
    'Id': payId,
    'SaleId': s['Id'],
    'StatusId': 2,
    'MerchantId': 2688,
    'PaymentAmount': tl(aK),
    'PaymentTypeId': paymentTypeOf(mediator),
    'PaymentMediatorId': mediator,
    'OperationTypeId': 1,
    'IsExternal': false,
    if (mediator == 1)
      'CashPayment': {
        'Id': 0,
        'PaymentId': payId,
        'SaleId': s['Id'],
        'GivenAmount': tl(givenK),
        'ChangeAmount': tl(givenK - aK),
      },
    'CurrencyCode': 'TRY',
    'ExchangeRate': 1.0,
    'ConvertedTotal': tl(aK),
    'MediatorPaymentReference': '${s['SaleNumber']}-${nowIso()}',
    'ExternalReference': 'null',
  });
  final newRemaining = remainingK - aK;
  s['RemainingPaymentAmount'] = tl(max(0, newRemaining));
  if (newRemaining <= 0) {
    s['StatusId'] = 4;
    s['IsSuspendedSale'] = false;
    (s['FinancialDocuments'] as List).add(_newDocument());
    // Not: gerçek cihazın doküman örneği son ödemede bile IsSuspendedSale=true
    // gösteriyor; istemcimiz bu yüzden tamamlanmayı bayraktan değil
    // "Remaining==0 + belge var" ikilisinden okur. Mock, askıda-listesi doğru
    // çalışsın diye bayrağı temizler.
  }
  await saveState();
  showReceipt(s,
      title: newRemaining <= 0 ? 'Satış tamamlandı' : 'Ödeme eklendi');
  final resp = envelope(data: s);
  state.lastProcessedSaleResponse = resp;
  return resp;
}

/// KISMİ İADE (`PartialReturn`). Tamamlanmış satışın kalemlerini, orijinal
/// kalem kimlikleriyle iade eder; iade ayrı bir belge (satış kaydı) olarak
/// saklanır. Katı doğrular: kalem orijinal satışta olmalı, toplam iade kalemin
/// tutarını aşamaz, ödemeler iade toplamına kuruşuna kadar eşit olmalı.
Future<Map<String, dynamic>> handlePartialReturn(Map<String, dynamic> body) async {
  final q = (body['Sale'] as Map?)?.cast<String, dynamic>();
  if (q == null) {
    return err(175, 'Gönderilen input boş veya key hatalı. Bu servis için input key: Sale');
  }
  if ((q['RefererApp']?.toString() ?? '').isEmpty) {
    return err(33, 'Harici uygulama ismi boş olamaz');
  }
  final relatedId = q['RelatedSaleId'];
  if (relatedId is! int) return err(1, 'RelatedSaleId zorunludur');
  final orijinal = findSale({'Id': relatedId});
  if (orijinal == null) return err(1, 'Satış bulunmamaktadır');
  if (orijinal['IsSuspendedSale'] == true) return err(6, 'Satış statüsü tamamlanmış değil');
  if (orijinal['StatusId'] == 11 || orijinal['StatusId'] == 13) {
    return err(3, 'İptal edilmiş satış iade edilemez');
  }

  final rawItems = q['AddedSaleItems'];
  final items = rawItems is List
      ? rawItems.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList()
      : <Map<String, dynamic>>[];
  if (items.isEmpty) return err(36, 'İade edilecek ürün listesi boş olamaz');

  final origItems = (orijinal['AddedSaleItems'] as List).cast<Map>();
  var totalK = 0;
  final respItems = <Map<String, dynamic>>[];
  for (final it in items) {
    final relItemId = it['RelatedSaleItemId'];
    final orig = origItems.where((o) => o['Id'] == relItemId).firstOrNull;
    if (orig == null) return err(1, 'İade edilecek kalem ($relItemId) satışta yok');
    final amountK = kurus(it['ReturnAmount']);
    if (amountK <= 0) return err(40, 'İade tutarı sıfırdan büyük olmalıdır');
    final returnedK = kurus(orig['ReturnedAmount'] ?? 0) + amountK;
    if (returnedK > kurus(orig['TotalPriceAmount'])) {
      return err(66, 'İade tutarı kalemin satış tutarını aşamaz (kalem $relItemId)');
    }
    orig['ReturnedAmount'] = tl(returnedK);
    totalK += amountK;
    respItems.add({
      'Id': (relItemId as int) * 10 + 1,
      'RelatedSaleItemId': relItemId,
      'Name': orig['Name'],
      'ItemQuantity': (it['ItemQuantity'] as num?)?.toDouble() ?? 1.0,
      'UnitPriceAmount': orig['UnitPriceAmount'],
      'TotalPriceAmount': tl(amountK),
      'VATRate': orig['VATRate'],
      'ReturnAmount': tl(amountK),
    });
  }

  final rawPays = q['PaymentInformations'];
  final pays = rawPays is List
      ? rawPays.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList()
      : <Map<String, dynamic>>[];
  var payK = 0;
  for (final p in pays) {
    final m = p['Mediator'];
    if (m is! int || !kMediatorTypes.containsKey(m)) return err(18, 'Ödeme aracısı bulunamadı');
    payK += kurus(p['Amount']);
  }
  if (pays.isNotEmpty && payK != totalK) {
    return err(69, 'İade toplamı (${tl(totalK)}) ödeme toplamına (${tl(payK)}) eşit değildir');
  }
  if (pays.any((p) => p['Mediator'] == 2)) {
    final cardErr = await cardStep(
      amountK: totalK,
      title: 'İADE — kartı okutun',
      items: respItems,
      timeoutSec: cardTimeoutOf(q),
      orderNo: q['OrderNo']?.toString(),
      honorFailFlag: false,
    );
    if (cardErr != null) return cardErr;
  }

  final id = ++state.idCounter;
  final saleNumber = newSaleNumber();
  final rec = <String, dynamic>{
    'Id': id,
    'SaleNumber': saleNumber,
    'OrderNo': ?q['OrderNo']?.toString(),
    'TypeId': 3, // iade
    'RelatedSaleId': relatedId,
    'StatusId': 6,
    'SaleDate': nowIso(),
    'GrossPrice': tl(totalK),
    'TotalPrice': tl(totalK),
    'CurrencyCode': 'TRY',
    'ExchangeRate': 1.0,
    'RefererApp': q['RefererApp'],
    'AddedSaleItems': respItems,
    'AddedPayments': [
      for (final p in pays)
        {
          'Id': id * 100,
          'SaleId': id,
          'StatusId': 2,
          'PaymentAmount': tl(kurus(p['Amount'])),
          'PaymentTypeId': paymentTypeOf(p['Mediator'] as int),
          'PaymentMediatorId': p['Mediator'],
          'OperationTypeId': 3, // Refund
        }
    ],
    'FinancialDocuments': [_newDocument()],
    'IsSuspendedSale': false,
    'RemainingPaymentAmount': 0.0,
    'CancelRequested': false,
  };
  state.sales.add(rec);
  await saveState();
  log('Kısmi iade: satış $relatedId → iade $saleNumber, ${tl(totalK)} TL');
  if (interactive) {
    setScreen('result', {'ok': true, 'message': 'İade yapıldı (${tl(totalK)} TL)'});
  }
  return envelope(data: rec);
}

Map<String, dynamic> handleGetSaleResult(Map<String, dynamic> body) {
  final q = (body['Sale'] as Map?)?.cast<String, dynamic>();
  if (q == null) {
    return err(175, 'Gönderilen input boş veya key hatalı. Bu servis için input key: Sale');
  }
  final s = findSale(q);
  // GERÇEK CİHAZ DAVRANIŞI: askıdaki (tamamlanmamış) satış bu servisle
  // BULUNMUYOR, hata 1 dönüyor — onlar CheckPendingSale ile sorgulanır.
  // Mock bunu taklit etmezse, ödeme beklerken kapanan uygulamanın kurtarma
  // yolu testte yanlışlıkla çalışır ve sahada patlar.
  if (s == null || s['IsSuspendedSale'] == true) {
    final key = q['OrderNo'] ?? q['SaleNumber'] ?? q['Id'];
    return err(1, 'Satış id($key) olan bir satış bulunmamaktadır');
  }
  return envelope(data: s);
}

Future<Map<String, dynamic>> handleCancelSale(Map<String, dynamic> body) async {
  final q = (body['Sale'] as Map?)?.cast<String, dynamic>();
  if (q == null) {
    return err(175, 'Gönderilen input boş veya key hatalı. Bu servis için input key: Sale');
  }
  if ((q['RefererApp']?.toString() ?? '').isEmpty) {
    return err(33, 'Harici uygulama ismi boş olamaz');
  }
  final s = findSale(q);
  if (s == null) return err(1, 'Satış bulunmamaktadır');
  if (s['StatusId'] == 13 || s['StatusId'] == 11) {
    return err(3, 'Satış iptal edilebilir değil');
  }
  if (s['IsSuspendedSale'] == true) {
    return err(6, 'Satış statüsü tamamlanmış değil');
  }

  // Kartlı iptalde cihaz kart okutturur.
  final payments = (s['AddedPayments'] as List).cast<Map>();
  final hasCard = payments.any((p) => p['PaymentMediatorId'] == 2);
  if (hasCard) {
    final cardErr = await cardStep(
      amountK: kurus(s['TotalPrice']),
      title: 'İPTAL — iade için kartı okutun',
      items: (s['AddedSaleItems'] as List?) ?? const [],
      timeoutSec: cardTimeoutOf(q),
      orderNo: s['OrderNo']?.toString(),
      honorFailFlag: false, // eski davranış: iptal kart adımında hiç düşmezdi
    );
    if (cardErr != null) return cardErr;
  }

  final reversals = <Map<String, dynamic>>[];
  for (final p in payments.whereType<Map<String, dynamic>>().toList()) {
    if (p['OperationTypeId'] != 1) continue;
    p['StatusId'] = 5; // Cancelled
    reversals.add({
      ...p,
      'Id': (p['Id'] as int) + 1,
      'StatusId': 12,
      'RelatedPaymentId': p['Id'],
      'OperationTypeId': 2,
      'MediatorPaymentReference': '${s['SaleNumber']}-${nowIso()}',
    });
  }
  (s['AddedPayments'] as List).addAll(reversals);
  s['StatusId'] = 13;
  s['CancelRequested'] = false;
  await saveState();
  if (interactive) {
    setScreen('result', {'ok': true, 'message': 'Satış iptal edildi (${s['SaleNumber']})'});
  }
  return envelope(data: s);
}

Map<String, dynamic> handlePaymentMediators() => envelope(data: {
      'PaymentMediators': [
        {
          'Id': 29,
          'Name': 'Açık Hesap',
          'PaymentTypeId': 14,
          'IsActive': true,
          'IsExternal': false,
          'IsOffline': true,
          'HasInFlightMode': false,
          'PaymentMediatorOperationTypes': [
            {'MediatorId': 29, 'OperationTypeId': 1, 'OperationTypeName': 'Payment', 'Amount': 99999.99},
            {'MediatorId': 29, 'OperationTypeId': 3, 'OperationTypeName': 'Refund', 'Amount': 99999.99},
          ],
        },
        {
          'Id': 1,
          'Name': 'Nakit',
          'PaymentTypeId': 1,
          'IsActive': true,
          'IsExternal': false,
          'IsOffline': true,
          'HasInFlightMode': false,
          'PaymentMediatorOperationTypes': [
            {'MediatorId': 1, 'OperationTypeId': 1, 'OperationTypeName': 'Payment', 'Amount': 99999.99},
            {'MediatorId': 1, 'OperationTypeId': 3, 'OperationTypeName': 'Refund', 'Amount': 99999.99},
          ],
        },
        {
          'Id': 2,
          'Name': 'Kredi Kartı',
          'PaymentTypeId': 2,
          'IsActive': true,
          'IsExternal': false,
          'IsOffline': false,
          'HasInFlightMode': true,
          'PaymentMediatorOperationTypes': [
            {'MediatorId': 2, 'OperationTypeId': 1, 'OperationTypeName': 'Payment', 'Amount': 50000.00},
            {'MediatorId': 2, 'OperationTypeId': 3, 'OperationTypeName': 'Refund', 'Amount': 50000.00},
            {'MediatorId': 2, 'OperationTypeId': 4, 'OperationTypeName': 'Void', 'Amount': 50000.00},
          ],
        },
      ],
    });

Map<String, dynamic> handleEod() {
  final ok = !scenario.eodFails;
  if (ok) scenario.endOfDayRequired = false;
  return envelope(data: {
    'EodResult': [
      {
        'MediatorId': 2,
        'Base64Image': null,
        'IsSucceeded': ok,
        'ErrorMessage': ok ? null : 'bkmTechPOS ödeme aracı başlatılmamış.',
      }
    ],
  });
}

Map<String, dynamic> handleCheckPendingSale(Map<String, dynamic> body) {
  final q = (body['Sale'] as Map?)?.cast<String, dynamic>();
  if (q == null) {
    return err(175, 'Gönderilen input boş veya key hatalı. Bu servis için input key: Sale');
  }
  final s = findSale(q);
  if (s == null || s['IsSuspendedSale'] != true) {
    final key = q['OrderNo'] ?? q['SaleNumber'];
    return err(1, 'Satış id($key) olan bir satış bulunmamaktadır');
  }
  return envelope(data: {
    'Id': s['Id'],
    'SaleNumber': s['SaleNumber'],
    'TotalPrice': s['TotalPrice'],
    'RemainingPaymentAmount': s['RemainingPaymentAmount'],
    'StatusId': 1,
    'AddedPayments': s['AddedPayments'],
    // Doküman tuhaflığı: bu servislerde anahtar 'SaleItems'.
    'SaleItems': s['AddedSaleItems'],
  });
}

Map<String, dynamic> handleListPendingSales() {
  final pending =
      state.sales.where((s) => s['IsSuspendedSale'] == true).toList();
  if (pending.isEmpty) {
    // Gerçek cihaz tuhaflığı: boş liste değil, string ErrorCode'lu hata döner.
    return {
      'HasError': true,
      'ErrorCode': 'NoPendingSales',
      'Message': 'Cihazda askıda bekleyen satış bulunamadı.',
      'TransactionHandle': deviceHandle(),
      'Data': null,
    };
  }
  return envelope(data: {
    'Sales': [
      for (final s in pending)
        {
          'Id': s['Id'],
          'SaleNumber': s['SaleNumber'],
          'TotalPrice': s['TotalPrice'],
          'StatusId': 1,
          'AddedPayments': s['AddedPayments'],
          'SaleItems': s['AddedSaleItems'],
        }
    ],
    'SalesCount': pending.length,
  });
}

Future<Map<String, dynamic>> handleAbandonSuspended(
    Map<String, dynamic> body) async {
  final q = (body['Sale'] as Map?)?.cast<String, dynamic>();
  if (q == null) {
    return err(175, 'Gönderilen input boş veya key hatalı. Bu servis için input key: Sale');
  }
  if ((q['RefererApp']?.toString() ?? '').isEmpty) {
    return err(33, 'Harici uygulama ismi boş olamaz');
  }
  final s = findSale(q);
  if (s == null || s['IsSuspendedSale'] != true) {
    return err(185, 'Geçersiz Askıda Satış.');
  }
  // Alınmış ödemeler iade edilir.
  final payments = (s['AddedPayments'] as List).cast<Map>();
  final refunds = <Map<String, dynamic>>[];
  for (final p in payments.whereType<Map<String, dynamic>>().toList()) {
    if (p['OperationTypeId'] != 1) continue;
    refunds.add({
      ...p,
      'Id': (p['Id'] as int) + 1,
      'StatusId': 2,
      'RelatedPaymentId': p['Id'],
      'OperationTypeId': 4,
      'MediatorPaymentReference': '${s['SaleNumber']}-${nowIso()}',
    });
  }
  (s['AddedPayments'] as List).addAll(refunds);
  s['StatusId'] = 7; // Abandoned
  s['IsSuspendedSale'] = false;
  await saveState();
  return envelope(data: s);
}

/// GİB MÜKELLEF SORGUSU taklidi (`QueryCustomerInfo`). Örnek kayıtlar:
///   VKN 1234567890  → ÖRNEK GIDA A.Ş. (tüzel, Kadıköy V.D. 034255)
///   TCKN 10000000146 → AHMET YILMAZ (gerçek kişi / şahıs şirketi)
///   başka geçerli numara → "mükellef bulunamadı"
Map<String, dynamic> handleQueryCustomerInfo(Map<String, dynamic> body) {
  final c = ((body['Customer'] ?? body['CustomerInput']) as Map?)
          ?.cast<String, dynamic>() ??
      const {};
  final vkn = (c['Vkn'] ?? '').toString();
  final tckn = (c['Tckn'] ?? '').toString();
  if (vkn.isEmpty && tckn.isEmpty) {
    return err(175, 'Vkn veya Tckn alanlarından en az biri zorunludur.');
  }
  if (vkn.isNotEmpty && !RegExp(r'^\d{10}$').hasMatch(vkn)) {
    return err(176, 'Vergi kimlik numarası geçersiz.');
  }
  if (tckn.isNotEmpty && !RegExp(r'^\d{11}$').hasMatch(tckn)) {
    return err(176, 'TC kimlik numarası geçersiz.');
  }
  Map<String, dynamic>? info;
  if (vkn == '1234567890') {
    info = {
      'CustomerType': 2,
      'FirstName': null,
      'FamilyName': null,
      'CompanyName': 'ÖRNEK GIDA SANAYİ VE TİCARET A.Ş.',
      'TaxNumber': vkn,
      'TaxOfficeName': 'KADIKÖY',
      'TaxOfficeCode': '034255',
      'Country': 'TÜRKİYE',
      'City': 'İSTANBUL',
      'District': 'KADIKÖY',
      'Address': 'Örnek Mahallesi, Örnek Sokak No:1',
      'Phone': '2165550000',
      'EMail': 'muhasebe@ornekgida.com.tr',
    };
  } else if (tckn == '10000000146') {
    info = {
      'CustomerType': 1,
      'FirstName': 'AHMET',
      'FamilyName': 'YILMAZ',
      'CompanyName': null,
      'TaxNumber': tckn,
      'TaxOfficeName': 'MUĞLA',
      'TaxOfficeCode': '048250',
      'Country': 'TÜRKİYE',
      'City': 'MUĞLA',
      'District': 'MENTEŞE',
      'Address': 'Kötekli Mah. No:5',
      'Phone': '5321112233',
      'EMail': '',
    };
  }
  log('QueryCustomerInfo ${vkn.isNotEmpty ? 'VKN $vkn' : 'TCKN $tckn'} → '
      '${info == null ? 'bulunamadı' : info['CompanyName'] ?? '${info['FirstName']} ${info['FamilyName']}'}');
  if (info == null) {
    return err(181, 'GİB sisteminde mükellef bulunamadı.');
  }
  return envelope(data: {'CustomerInfo': info});
}

Map<String, dynamic> handleGetDeviceInfo(Map<String, dynamic> body) {
  final q = (body['DeviceInfo'] as Map?)?.cast<String, dynamic>();
  if (q == null) return err(88, 'DeviceInfo datası boş olamaz');
  return envelope(data: {
    if (q['serialNumber'] == true) 'serialNumber': kSerial,
    if (q['fingerPrint'] == true) 'fingerPrint': kDeviceFingerprint,
    if (q['networkStatus'] == true) 'networkStatus': true,
    if (q['terminalSettings'] == true)
      'terminalSettings': {
        'terminalId': 14632,
        'serialNumber': kSerial,
        'model': 'N86 (mock 1.0)',
        'applicationVersion': 'mock-1.0',
        'isActive': true,
        'terminalSalesType': 'Senkron',
        'isUnattendedMode': false,
      },
    if (q['listTerminals'] == true)
      'listTerminals': [
        {
          'acquirerId': 1,
          'acquirerName': 'Mock Banka',
          'terminalLabel': 'MOCK-TERM',
          'terminalId': '00014632',
          'merchantId': '000002688',
          'loyaltyIndex': 0,
          'availableCurrencyList': ['TRY'],
        }
      ],
  });
}

Map<String, dynamic> handleLastProcessedSale() {
  final last = state.lastProcessedSaleResponse;
  if (last == null) return err(1, 'Satış bulunmamaktadır');
  return last;
}

// ---------------------------------------------------------------------------
// HTTP sunucusu
// ---------------------------------------------------------------------------

Future<void> main(List<String> args) async {
  var port = 4568;
  var stateName = 'mock_state.json';
  // Değer almayan bayrak — döngüden ayrı okunur.
  if (args.contains('--interactive')) interactive = true;
  for (var i = 0; i < args.length - 1; i++) {
    final v = args[i + 1];
    switch (args[i]) {
      case '--port':
        port = int.tryParse(v) ?? port;
        break;
      case '--serial':
        if (v.trim().isNotEmpty) kSerial = v.trim();
        break;
      case '--terminal-id':
        kTerminalId = int.tryParse(v) ?? kTerminalId;
        break;
      case '--name':
        if (v.trim().isNotEmpty) kDeviceName = v.trim();
        break;
      case '--state':
        // Yalnız dosya adı: durum dosyaları hep bu klasörde durur.
        if (v.trim().isNotEmpty) {
          stateName = v.trim().split(RegExp(r'[\\/]')).last;
        }
        break;
    }
  }

  _stateFile = File('${File.fromUri(Platform.script).parent.path}/$stateName');
  if (_stateFile.existsSync()) {
    try {
      state.loadFrom(
          (jsonDecode(_stateFile.readAsStringSync()) as Map).cast<String, dynamic>());
      log('Durum yüklendi: ${state.sales.length} satış, lastSeq=${state.lastSeq}, '
          'eşleşme=${state.pairedFingerprint.isEmpty ? "YOK" : "var"}');
    } catch (_) {
      log('mock_state.json okunamadı, sıfırdan başlıyor');
    }
  }

  final server = await HttpServer.bind(InternetAddress.anyIPv4, port);
  log('Mock Pavo N86 dinliyor: http://localhost:$port  (seri: $kSerial, '
      'terminal: $kTerminalId, durum: $stateName)');
  log('Senaryo enjeksiyonu: POST /_mock/scenario, durum: GET /_mock/state');
  if (interactive) {
    log('ETKİLEŞİMLİ MOD: "$kDeviceName" ekranı → http://localhost:$port/_mock/ui '
        '(aynı ağdaki telefondan: http://<bu-PC-IP>:$port/_mock/ui)');
  }

  await for (final req in server) {
    unawaited(_route(req));
  }
}

Future<void> _route(HttpRequest req) async {
  final path = req.uri.path;
  try {
    if (path.startsWith('/_mock/')) {
      await _handleMockControl(req);
      return;
    }
    if (req.method != 'POST') {
      await _json(req, err(0, 'Yalnızca POST desteklenir'), status: 405);
      return;
    }

    // AbortCurrentPayment süren ödemeyi KESMEK için var — gerçek cihazda
    // kart ekranı açıkken de cevap verir. Meşgul kontrolünden önce ele alınır,
    // yoksa vazgeç isteği kendi kestiği satış yüzünden 20 alırdı.
    if (_busy && path.toLowerCase() == '/abortcurrentpayment') {
      await _handleAbortWhileBusy(req);
      return;
    }

    // Cihaz aynı anda tek istek işler.
    if (_busy) {
      await _json(req, err(20, 'Cihaz meşgul'));
      return;
    }
    _busy = true;
    try {
      await _handlePavo(req, path);
    } finally {
      _busy = false;
    }
  } catch (e, st) {
    log('HATA: $e\n$st');
    try {
      await _json(req, err(77, 'Sistem Hatası'));
    } catch (_) {}
  }
}

Future<void> _handleAbortWhileBusy(HttpRequest req) async {
  final raw = await utf8.decoder.bind(req).join();
  Map<String, dynamic> body;
  try {
    body = (jsonDecode(raw) as Map).cast<String, dynamic>();
  } catch (_) {
    await _json(req, err(196, 'Geçersiz JSON verisi.'));
    return;
  }
  log('İstek: /AbortCurrentPayment (ödeme sürerken)');
  final handleErr = validateHandle(body, exempt: false);
  await saveState();
  if (handleErr != null) {
    await _json(req, handleErr);
    return;
  }
  if (!interactive) {
    // Etkileşimsiz kip: süren kart adımı bu bayrağı görüp kesilir (cardStep).
    abortRequested = true;
    await _json(req, envelope(data: {'Response': 'İşlem iptal edildi.'}));
  } else if (resolveUser('abort', kind: 'card')) {
    await _json(req, envelope(data: {'Response': 'İşlem iptal edildi.'}));
  } else {
    // Kart ekranı yok (etkileşimsiz mod ya da kart okunmuş, işleniyor).
    await _json(req, err(101, 'İşlem iptal edilemedi.'));
  }
}

Future<void> _handlePavo(HttpRequest req, String path) async {
  final raw = await utf8.decoder.bind(req).join();
  Map<String, dynamic> body;
  try {
    body = (jsonDecode(raw) as Map).cast<String, dynamic>();
  } catch (_) {
    await _json(req, err(196, 'Geçersiz JSON verisi.'));
    return;
  }

  final p = path.toLowerCase();
  log('İstek: $path');

  if (scenario.printerBusyOnce && p != '/ping' && p != '/pairing') {
    scenario.printerBusyOnce = false;
    await _json(req,
        err(90, 'Slip yazma işlemi devam ettiği için ödeme alınamamaktadır'));
    return;
  }

  // Handle doğrulaması (Ping/Pairing muaf).
  final exempt = p == '/ping' || p == '/pairing';
  final handleErr = validateHandle(body, exempt: exempt);
  if (handleErr != null) {
    await saveState(); // 73'te kaydedilen sequence kalıcı olsun
    await _json(req, handleErr);
    return;
  }
  if (!exempt) await saveState();

  Map<String, dynamic> resp;
  var isSaleRequest = false;
  switch (p) {
    case '/pairing':
      resp = await handlePairing(body);
      break;
    case '/ping':
      resp = handlePing();
      break;
    case '/startsalewithitems':
    case '/startmultipayementsale': // gerçek path'teki yazım hatası dahil
    case '/startmultipaymentsale':
      isSaleRequest = true;
      resp = await handleStartSale(body);
      break;
    case '/addpaymentandfinalizesale':
      isSaleRequest = true;
      resp = await handleAddPaymentAndFinalize(body);
      break;
    case '/getsaleresult':
    case '/getmerchantsale':
    case '/completedsale':
      resp = handleGetSaleResult(body);
      break;
    case '/cancelsale':
      resp = await handleCancelSale(body);
      break;
    case '/paymentmediators':
      resp = handlePaymentMediators();
      break;
    case '/performeod':
    case '/performbatcheod':
      resp = handleEod();
      break;
    case '/checkpendingsale':
      resp = handleCheckPendingSale(body);
      break;
    case '/listpendingsalewithdetail':
      resp = handleListPendingSales();
      break;
    case '/abandonsuspendedsale':
      resp = await handleAbandonSuspended(body);
      break;
    // Süren ödemeden vazgeç. Gerçek cihazda kart okuma ekranını kapatır;
    // mock'ta bekleyen bir ödeme olmadığı için tek işi doğru cevabı vermek —
    // kasadaki "Vazgeç" düğmesinin gönderdiği isteğin biçimi burada doğrulanıyor.
    case '/abortcurrentpayment':
      abortRequested = true;
      resp = envelope(data: {'Response': 'İşlem iptal edildi.'});
      break;
    case '/partialreturn':
      isSaleRequest = true;
      resp = await handlePartialReturn(body);
      break;
    case '/getdeviceinfo':
      resp = handleGetDeviceInfo(body);
      break;
    case '/querycustomerinfo':
      resp = handleQueryCustomerInfo(body);
      break;
    case '/lastprocessedsale':
      resp = handleLastProcessedSale();
      break;
    case '/sendofflinesales':
      resp = envelope(data: {'Response': 'Bekleyen satışlar gönderildi'});
      break;
    // Mali raporlar. DİKKAT: bu servisler alanlarını `Sale` gibi bir input
    // key'in ALTINDA değil, gövdenin ÜST SEVİYESİNDE bekliyor.
    case '/createreport':
      resp = handleCreateReport(body);
      await saveState();
      break;
    case '/createreportwithsummaries':
      resp = handleCreateReportWithSummaries(body);
      await saveState();
      break;
    case '/queryreport':
      resp = handleQueryReport(body);
      await saveState();
      break;
    case '/listreports':
      resp = handleListReports(body);
      break;
    case '/getreportsummaries':
      resp = handleGetReportSummaries(body);
      break;
    case '/printreport':
      resp = handlePrintReport(body);
      break;
    default:
      resp = err(230, 'Desteklenmeyen istek: $path');
  }

  if (scenario.slowResponseMs > 0) {
    await Future.delayed(Duration(milliseconds: scenario.slowResponseMs));
  }

  // 204 tatbikatı: satış İŞLENDİ ama cevap kasaya hiç ulaşmıyor.
  if (isSaleRequest && scenario.noResponseOnce) {
    scenario.noResponseOnce = false;
    log('noResponseOnce: cevap GÖNDERİLMEDEN bağlantı koparılıyor '
        '(satış cihazda mevcut) — GetSaleResult kurtarması test edilebilir');
    await req.response.detachSocket().then((s) => s.destroy());
    return;
  }

  await _json(req, resp);
}

// ---------------------------------------------------------------------------
// Mali raporlar (X / X Fark / Z / Terminal)
// ---------------------------------------------------------------------------
//
// Mock'un buradaki asıl işi, gerçek cihazın İKİ AYRI CEVAP ŞEMASINI taklit
// etmek: ListReports/GetReportSummaries PascalCase ve gerçek sayı gönderiyor,
// QueryReport ise camelCase ve BİÇİMLENMİŞ METİN. Dokümandaki tutarsızlıklar
// (aynı cevapta hem "-155,00 TL" hem "-155.0 TL") bilerek korunuyor — istemci
// parse'ı asıl onlarla sınanıyor.

/// Kuruş → "1.520,00 TL" (cihazın rapor metni biçimi).
String moneyTr(int k, {bool signed = false, String suffix = ' TL'}) {
  final neg = k < 0;
  final abs = k.abs();
  final digits = (abs ~/ 100).toString();
  final buf = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buf.write('.');
    buf.write(digits[i]);
  }
  final sign = neg ? '-' : (signed ? '+' : '');
  return '$sign$buf,${(abs % 100).toString().padLeft(2, '0')}$suffix';
}

/// Ham double'ın metne çevrilmiş hâli — "-155.0 TL". Cihaz bazı alanlarda
/// biçimlendirmeyi atlayıp bunu gönderiyor; korunuyor.
String moneyRawTr(int k) => '${k / 100} TL';

/// "19.02.2026 13:03" — QueryReport'un tarih biçimi.
String stampTr(DateTime d) =>
    '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')}.'
    '${d.year} ${d.hour.toString().padLeft(2, '0')}:'
    '${d.minute.toString().padLeft(2, '0')}';

bool _isCancelled(Map<String, dynamic> s) =>
    s['StatusId'] == 11 || s['StatusId'] == 13;

String _mediatorName(dynamic id) => switch (id) {
      1 => 'Nakit (TL)',
      29 => 'Açık Hesap',
      _ => 'Kredi Kartı',
    };

/// Rapora girecek satışlar. X ve T tüm günü, Z ve X Fark son Z'den bu yanayı
/// kapsar.
List<Map<String, dynamic>> _salesForReport(String batchType, bool difference,
    {DateTime? from, DateTime? to}) {
  final all = state.sales
      .where((s) => s['IsSuspendedSale'] != true && s['StatusId'] != 7)
      .toList();
  // Tarih aralıklı terminal raporu (aylık rapor): son Z'ye bakmaz.
  if (from != null && to != null) {
    final end = DateTime(to.year, to.month, to.day, 23, 59, 59);
    return all.where((s) {
      final at = DateTime.tryParse(s['SaleDate']?.toString() ?? '');
      return at != null && !at.isBefore(from) && !at.isAfter(end);
    }).toList();
  }
  // 'T' = cihazın "Terminal Satış Raporu"; SAHADA gün sonu işlevi gören rapor
  // bu (bkz. PavoService.takeDayEndReport). Dolayısıyla Z gibi, son dönemden
  // bu yanayı kapsar.
  if (batchType == 'Z' || batchType == 'T' || difference) {
    return all
        .where((s) => (s['Id'] as int? ?? 0) > state.lastZSaleId)
        .toList();
  }
  return all;
}

/// Bir raporu üretip arşive yazar. Dönen kayıt PascalCase şemadadır
/// (ListReports / GetReportSummaries bunu olduğu gibi verir).
/// [archive] false ise rapor arşive YAZILMAZ ve Z sayacı ilerlemez — yalnız
/// "bu an ne olurdu" önizlemesi üretilir.
Map<String, dynamic> buildReport(String batchType,
    {bool difference = false,
    bool archive = true,
    DateTime? from,
    DateTime? to}) {
  final sales = _salesForReport(batchType, difference, from: from, to: to);
  final now = DateTime.now();

  var paymentCount = 0, paymentK = 0, cancelCount = 0, cancelK = 0;
  final payRows = <String, Map<String, int>>{};
  final vatRows = <double, List<int>>{}; // rate → [matrah, kdv]
  final products = <String, List<num>>{}; // ad → [adet, tutar kuruş]
  var saleDocCount = 0, saleDocK = 0, refundDocCount = 0, refundDocK = 0;
  DateTime? firstAt, lastAt;

  for (final s in sales) {
    final cancelled = _isCancelled(s);
    final at = DateTime.tryParse(s['SaleDate']?.toString() ?? '') ?? now;
    if (firstAt == null || at.isBefore(firstAt)) firstAt = at;
    if (lastAt == null || at.isAfter(lastAt)) lastAt = at;

    for (final p in (s['AddedPayments'] as List).whereType<Map>()) {
      // İptal edilen satışın ödeme listesinde ASIL ödeme ve onun ayna kaydı
      // (OperationTypeId 2, geri alım) yan yana durur. İkisini de saymak iptal
      // tutarını ikiye katlar — rapora yalnız asıl ödemeler girer.
      if (p['OperationTypeId'] != 1) continue;
      final name = _mediatorName(p['PaymentMediatorId']);
      final amount = kurus(p['PaymentAmount']);
      final row = payRows.putIfAbsent(
          name, () => {'count': 0, 'sum': 0, 'cancelCount': 0, 'cancelSum': 0});
      if (cancelled) {
        row['cancelCount'] = row['cancelCount']! + 1;
        row['cancelSum'] = row['cancelSum']! + amount;
        cancelCount++;
        cancelK += amount;
      } else {
        row['count'] = row['count']! + 1;
        row['sum'] = row['sum']! + amount;
        paymentCount++;
        paymentK += amount;
      }
    }

    final totalK = kurus(s['TotalPrice']);
    if (cancelled) {
      refundDocCount++;
      refundDocK += totalK;
      continue; // iptaller KDV ve ürün kırılımına girmez
    }
    saleDocCount++;
    saleDocK += totalK;

    for (final t in (s['Taxes'] as List? ?? const []).whereType<Map>()) {
      final rate = (t['TaxRate'] as num).toDouble();
      final tax = kurus(t['TotalTaxAmount']);
      final row = vatRows.putIfAbsent(rate, () => [0, 0]);
      row[1] += tax;
    }
    for (final it in (s['AddedSaleItems'] as List? ?? const []).whereType<Map>()) {
      final row = products.putIfAbsent(it['Name'].toString(), () => [0, 0]);
      row[0] = row[0] + (it['ItemQuantity'] as num);
      row[1] = row[1] + kurus(it['TotalPriceAmount']);
    }
  }
  // Matrah, KDV tutarından geri hesaplanır (base = tax * 100 / oran).
  // %0'da KDV de 0 olduğu için matrah bu yolla bulunamaz; 0 bırakılır.
  for (final e in vatRows.entries) {
    e.value[0] = e.key == 0 ? 0 : (e.value[1] * 100 / e.key).round();
  }

  final id = ++state.reportIdCounter;
  // Dönemi kapatan rapor: cihazda 'T' (Terminal Satış Raporu). 'Z' de tarihsel
  // olarak burada tutuluyor ama gerçek cihaz onu gün sonu saymıyor.
  final isZ = batchType == 'T';
  if (isZ && archive) {
    state.zReportNo++;
    state.lastZSaleId = state.sales.isEmpty
        ? state.lastZSaleId
        : state.sales.map((s) => s['Id'] as int? ?? 0).reduce(max);
  }

  final report = <String, dynamic>{
    'BatchId': id,
    'BatchType': batchType,
    'DifferenceIndicator': difference ? 'Y' : 'N',
    if (isZ && archive) 'ZReportNo': state.zReportNo,
    'TotalPaymentCount': paymentCount,
    'TotalPaymentAmount': tl(paymentK),
    'TotalCancelledCount': cancelCount,
    'TotalCancelledAmount': tl(cancelK),
    // Doküman alan adını "Minumum" yazıyor — korunuyor.
    'MinumumPaymentDate': (firstAt ?? now).toIso8601String(),
    'MaximumPaymentDate': (lastAt ?? now).toIso8601String(),
    'CreateDate': now.toIso8601String(),
    'UserName': 'MOCK_USER',
    'TerminalNo': kSerial,
    'TaxInfo': '47649695044',
    'PaymentSummary': [
      for (final e in payRows.entries)
        {
          'PaymentType': e.key,
          'PaymentCount': e.value['count'],
          'PaymentSum': tl(e.value['sum']!),
          'CancelCount': e.value['cancelCount'],
          'CancelSum': tl(e.value['cancelSum']!),
          'PaymentTotal': tl(e.value['sum']! - e.value['cancelSum']!),
        }
    ],
    'VATSummary': [
      for (final e in vatRows.entries)
        {
          'VATType': 'KDV %${e.key.toStringAsFixed(0)}',
          'BaseAmount': tl(e.value[0]),
          'TaxAmount': tl(e.value[1]),
        }
    ],
    'DocumentSummary': [
      if (saleDocCount > 0)
        {
          'DocumentType': 'Satış',
          'DocumentCount': saleDocCount,
          'DocumentAmount': tl(saleDocK),
        },
      if (refundDocCount > 0)
        {
          'DocumentType': 'İade',
          'DocumentCount': refundDocCount,
          'DocumentAmount': tl(refundDocK),
        },
    ],
    'ProductSummary': [
      for (final e in products.entries)
        {
          'ProductName': e.key,
          'Quantity': e.value[0],
          'TotalAmount': tl(e.value[1].round()),
        }
    ],
  };
  if (archive) state.reports.add(report);
  return report;
}

/// PascalCase arşiv kaydı → QueryReport'un camelCase + metin şeması.
Map<String, dynamic> queryShape(Map<String, dynamic> r) {
  int k(String key) => kurus(r[key]);
  final pays = (r['PaymentSummary'] as List).whereType<Map>();
  final cash = pays
      .where((p) => p['PaymentType'].toString().contains('Nakit'))
      .fold<int>(0, (s, p) => s + kurus(p['PaymentTotal']));
  final credit = pays
      .where((p) => !p['PaymentType'].toString().contains('Nakit'))
      .fold<int>(0, (s, p) => s + kurus(p['PaymentTotal']));
  final vatBase = (r['VATSummary'] as List)
      .whereType<Map>()
      .fold<int>(0, (s, v) => s + kurus(v['BaseAmount']));
  final vatTax = (r['VATSummary'] as List)
      .whereType<Map>()
      .fold<int>(0, (s, v) => s + kurus(v['TaxAmount']));
  final net = k('TotalPaymentAmount') - k('TotalCancelledAmount');
  final diff = r['DifferenceIndicator'] == 'Y';
  final typeName = switch (r['BatchType']) {
    'Z' => 'Gün Sonu (Z) Raporu',
    'T' => 'Terminal Satış Raporu',
    _ => diff ? 'Kullanıcı Satış Fark Raporu' : 'Kullanıcı Satış Raporu',
  };

  return {
    'taxInfo': r['TaxInfo'],
    'extras': [
      {
        'firstOperationDate':
            stampTr(DateTime.parse(r['MinumumPaymentDate'] as String)),
        'lastOperationDate':
            stampTr(DateTime.parse(r['MaximumPaymentDate'] as String)),
        'isDifferenceX': '$diff',
      }
    ],
    'reportType': typeName,
    'dateTime': stampTr(DateTime.parse(r['CreateDate'] as String)),
    // Cihaz batchId'yi METİN gönderiyor.
    'batchId': '${r['BatchId']}',
    'showBatchInfo': 'true',
    'userName': r['UserName'],
    'terminalNo': r['TerminalNo'],
    'totals': [
      {
        'vatTaxAmountTotal': moneyTr(vatTax, signed: true),
        'vatsBaseTotal': moneyTr(vatBase, signed: true),
        'cashTotal': moneyTr(cash, signed: true),
        'foodTotal': moneyTr(0),
        'creditTotal': moneyTr(credit, signed: true),
        'openAccountTotal': moneyTr(0),
        'transferEFTTotal': moneyTr(0),
        'totalAmount': moneyTr(net, signed: true),
        'paymentCountTotal': '${r['TotalPaymentCount']}',
        'paymentCancelledCountTotal': '${r['TotalCancelledCount']}',
        'transportationCardTotal': moneyTr(0),
        'isVisibleTransportationField': 'false',
        'isVisibleFoodField': 'false',
        'isVisibleCashField': cash == 0 ? 'false' : 'true',
        'isVisibleCreditField': credit == 0 ? 'false' : 'true',
        'isVisibleEFTField': 'false',
        'isVisibleOpenAccountField': 'false',
      }
    ],
    'paymentTypes': [
      for (final p in pays)
        {
          'paymentType': p['PaymentType'],
          'paymentCount': '${p['PaymentCount']}',
          'paymentSum': moneyTr(kurus(p['PaymentSum'])),
          'cancelCount': '${p['CancelCount']}',
          // Biçimlendirilmemiş ham double — dokümandaki tutarsızlık korunuyor.
          'cancelSum': moneyRawTr(-kurus(p['CancelSum'])),
          'paymentTotal': moneyTr(kurus(p['PaymentTotal']), suffix: ''),
        }
    ],
    'vats': [
      for (final v in (r['VATSummary'] as List).whereType<Map>())
        {
          'vatType': v['VATType'],
          'paymentCount': '${r['TotalPaymentCount']}',
          'vatPaymentSum': moneyTr(kurus(v['TaxAmount']), suffix: ' '),
          'paymentTotal': moneyTr(kurus(v['BaseAmount']), suffix: ' '),
          'vatCancelCount': '${r['TotalCancelledCount']}',
          'vatCancelSum': moneyTr(0, suffix: ' '),
          'CancelSum': moneyTr(0, suffix: ' '),
        }
    ],
    // Belge ve ürün kırılımı BİLEREK yok: dokümandaki QueryReport cevabında
    // bu bloklar hiç geçmiyor. Mock'un uydurduğu alanlar "cihazda bu var"
    // yanılgısı yaratır — sorgu şeması yalnız dokümanda GÖRÜLEN alanları
    // gönderiyor. Belge/ürün kırılımı GetReportSummaries'ten geliyor.
  };
}

Map<String, dynamic> _invalidReportType(dynamic v) => envelope(
    hasError: true,
    errorCode: 'InvalidReportType',
    message: 'Geçersiz rapor tipi: $v');

Map<String, dynamic> handleCreateReport(Map<String, dynamic> body) {
  final type = body['ReportType']?.toString();
  // SAHADA DOĞRULANDI: cihaz `ZReport` isteğinde gün sonu ALMIYOR, X raporu
  // gibi bir çıktı üretiyor. Mock aynısını yapıyor ki bu yola dönen bir kod
  // testte hemen yakalansın — gün sonu `CreateReportWithSummaries` + `T`.
  final spec = switch (type) {
    'XReport' => ('X', false),
    'XDiffReport' => ('X', true),
    'ZReport' => ('X', false),
    _ => null,
  };
  if (spec == null) return _invalidReportType(type);
  if (scenario.reportHasNoSales) {
    return envelope(
        hasError: true,
        errorCode: 'ReportError',
        message: 'Raporlanacak satış bulunamadı.');
  }
  final r = buildReport(spec.$1, difference: spec.$2);
  log('Rapor oluşturuldu: ${r['BatchType']} #${r['BatchId']}'
      '${r['ZReportNo'] == null ? '' : ' (Z no ${r['ZReportNo']})'}');
  // Gerçek cihaz gibi: içerik DÖNMEZ.
  return envelope();
}

/// CreateReportWithSummaries — Z'yi KABUL ETMEZ (X / Xfark / T).
Map<String, dynamic> handleCreateReportWithSummaries(Map<String, dynamic> body) {
  final type = body['ReportType']?.toString();
  final List<Map<String, dynamic>> batches;
  switch (type) {
    case 'X':
      // Doküman: X istendiğinde hem X hem X Fark üretilir.
      batches = [buildReport('X'), buildReport('X', difference: true)];
    case 'Xfark':
      batches = [buildReport('X', difference: true)];
    case 'T':
      batches = [buildReport('T')];
    default:
      return _invalidReportType(type);
  }
  return envelope(data: {'Batches': batches});
}

Map<String, dynamic> handleListReports(Map<String, dynamic> body) {
  final start = DateTime.tryParse(body['StartDate']?.toString() ?? '');
  final end = DateTime.tryParse(body['EndDate']?.toString() ?? '');
  if (start == null || end == null) {
    return envelope(
        hasError: true,
        errorCode: 'InvalidDateRange',
        message: 'StartDate ve EndDate zorunludur.');
  }
  if (end.isBefore(start) || end.difference(start).inDays > 31) {
    return envelope(
        hasError: true,
        errorCode: 'InvalidDateRange',
        message: 'Tarih aralığı 31 günü aşamaz.');
  }
  final filter = body['ReportType']?.toString();
  const known = {'X', 'Xfark', 'T', 'Z'};
  if (filter != null && !known.contains(filter)) {
    return _invalidReportType(filter);
  }
  bool matches(Map<String, dynamic> r) {
    if (filter == null) return true;
    final diff = r['DifferenceIndicator'] == 'Y';
    return switch (filter) {
      'X' => r['BatchType'] == 'X' && !diff,
      'Xfark' => r['BatchType'] == 'X' && diff,
      _ => r['BatchType'] == filter,
    };
  }

  final endOfDay = DateTime(end.year, end.month, end.day, 23, 59, 59);
  // GERÇEK CİHAZ DAVRANIŞI: liste satırı KIRILIM taşımıyor (dokümandaki örnek
  // cevapta PaymentSummary/VATSummary/DocumentSummary/ProductSummary yok) ve
  // UserName/TerminalNo/TaxInfo de yok. Kırılım GetReportSummaries'ten gelir.
  const rowOnly = {
    'PaymentSummary', 'VATSummary', 'DocumentSummary', 'ProductSummary',
    'UserName', 'TerminalNo', 'TaxInfo',
  };
  final list = [
    for (final r in state.reports)
      if (matches(r))
        if (() {
          final at = DateTime.tryParse(r['CreateDate'] as String);
          return at != null && !at.isBefore(start) && !at.isAfter(endOfDay);
        }())
          {
            for (final entry in r.entries)
              if (!rowOnly.contains(entry.key)) entry.key: entry.value,
            'CreateUserId': 1,
          }
  ];
  return envelope(data: {'Reports': list});
}

Map<String, dynamic> handleGetReportSummaries(Map<String, dynamic> body) {
  final id = body['ReportId'];
  if (id is! int || id <= 0) {
    return envelope(
        hasError: true,
        errorCode: 'InvalidReportId',
        message: 'ReportId 0\'dan büyük olmalıdır.');
  }
  final r = state.reports.where((e) => e['BatchId'] == id).toList();
  if (r.isEmpty) {
    return envelope(
        hasError: true,
        errorCode: 'ReportNotFound',
        message: 'Rapor bulunamadı: $id');
  }
  // GERÇEK CİHAZ DAVRANIŞI: bu servisin cevabında `ZReportNo`, `CreateDate`,
  // `UserName`, `TerminalNo`, `TaxInfo` YOK (dokümandaki örnek cevap). Onlar
  // ListReports satırında geliyor. Mock hepsini gönderirse istemcinin iki
  // cevabı birleştirmesi hiç sınanmaz ve Z numarasının kaybolduğu sahada
  // anlaşılır.
  const summaryOnly = {'ZReportNo', 'CreateDate', 'UserName', 'TerminalNo', 'TaxInfo'};
  return envelope(data: {
    'Batches': [
      for (final e in r)
        {
          for (final entry in e.entries)
            if (!summaryOnly.contains(entry.key)) entry.key: entry.value,
        }
    ],
  });
}

Map<String, dynamic> handlePrintReport(Map<String, dynamic> body) {
  final id = body['ReportId'];
  if (id is! int || id <= 0) {
    return envelope(
        hasError: true,
        errorCode: 'InvalidReportId',
        message: 'ReportId 0\'dan büyük olmalıdır.');
  }
  if (!state.reports.any((e) => e['BatchId'] == id)) {
    return envelope(
        hasError: true,
        errorCode: 'ReportNotFound',
        message: 'Rapor bulunamadı: $id');
  }
  log('Rapor nüshası basıldı: #$id');
  if (body['PrepareImage'] == true) {
    // 1x1 saydam PNG — görsel yolunun uçtan uca çalıştığını göstermeye yeter.
    return envelope(data: {
      'images': [
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk'
            'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
      ]
    });
  }
  return envelope();
}

Map<String, dynamic> handleQueryReport(Map<String, dynamic> body) {
  final d = (body['ReportData'] as Map?)?.cast<String, dynamic>();
  if (d == null) {
    return err(175,
        'Gönderilen input boş veya key hatalı. Bu servis için input key: ReportData');
  }
  final type = d['ReportType']?.toString();
  Map<String, dynamic>? report;
  switch (type) {
    case 'XReport':
      report = buildReport('X');
    case 'XDiffReport':
      report = buildReport('X', difference: true);
    case 'ZReport':
      // GERÇEK CİHAZDA DOĞRULANMADI: doküman "güncel Z raporu" diyor ama günü
      // kapatıp kapatmadığını söylemiyor. Mock kapatmıyor; uygulama da Z'yi
      // bu yoldan almıyor (CreateReport kullanıyor).
      log('UYARI: QueryReport/ZReport çağrıldı — gün kapatma davranışı '
          'gerçek cihazda doğrulanmadı, mock günü KAPATMIYOR.');
      report = buildReport('Z', archive: false);
    case 'ZReportWithDateTime':
      final date = DateTime.tryParse(d['ReportDate']?.toString() ?? '');
      if (date == null) {
        return envelope(
            hasError: true,
            errorCode: 'InvalidReportDate',
            message: 'ZReportWithDateTime için ReportDate zorunludur.');
      }
      report = state.reports.lastWhere(
        (r) {
          // Gün sonu arşivde 'T' (Terminal Satış Raporu) olarak, Z numarasıyla durur.
          if (r['ZReportNo'] == null) return false;
          final at = DateTime.tryParse(r['CreateDate'] as String);
          return at != null &&
              at.year == date.year &&
              at.month == date.month &&
              at.day == date.day;
        },
        orElse: () => <String, dynamic>{},
      );
      if (report.isEmpty) {
        return envelope(
            hasError: true,
            errorCode: 'ReportNotFound',
            message: 'O tarihte Z raporu yok.');
      }
    case 'TeminalDateRangeSaleReport':
      if (d['StartDate'] == null || d['EndDate'] == null) {
        return envelope(
            hasError: true,
            errorCode: 'InvalidDateRange',
            message: 'Terminal raporu için StartDate ve EndDate zorunludur.');
      }
      // Var olan satışları özetler; dönemi KAPATMAZ (Z sayacı ilerlemez).
      report = buildReport('T',
          archive: false,
          from: DateTime.tryParse(d['StartDate'].toString()),
          to: DateTime.tryParse(d['EndDate'].toString()));
    default:
      return _invalidReportType(type);
  }

  if (d['PrintReport'] != false) log('Rapor cihazda basıldı: $type');
  return envelope(data: {
    'reportResult': 'Rapor başarılı',
    'images': const [],
    'datas': [queryShape(report)],
  });
}

Future<void> _handleMockControl(HttpRequest req) async {
  switch (req.uri.path) {
    case '/_mock/scenario':
      final raw = await utf8.decoder.bind(req).join();
      if (raw.isNotEmpty) {
        scenario.apply((jsonDecode(raw) as Map).cast<String, dynamic>());
      }
      log('Senaryo güncellendi: ${jsonEncode(scenario.toJson())}');
      await _json(req, {'ok': true, 'scenario': scenario.toJson()});
      break;
    case '/_mock/ui':
      {
        final r = req.response;
        r.statusCode = 200;
        r.headers.contentType = ContentType('text', 'html', charset: 'utf-8');
        r.write(kPosUiHtml);
        await r.close();
      }
      break;
    case '/_mock/screen':
      // Fiş / sonuç ekranı 20 sn sonra kendiliğinden ana ekrana döner.
      final ph = screen['phase'];
      if ((ph == 'receipt' || ph == 'result') &&
          DateTime.now().difference(_screenSince).inSeconds > 20) {
        setScreen('idle');
      }
      await _json(req, {
        'device': {
          'name': kDeviceName,
          'serial': kSerial,
          'terminalId': kTerminalId,
          'paired': state.pairedFingerprint.isNotEmpty,
          'lastSeq': state.lastSeq,
          'salesCount': state.sales.length,
        },
        'interactive': interactive,
        'busy': _busy,
        'screen': screen,
        'scenario': scenario.toJson(),
        'log': _logRing.reversed.take(15).toList(),
      });
      break;
    case '/_mock/action':
      final actionRaw = await utf8.decoder.bind(req).join();
      final j = actionRaw.isEmpty
          ? <String, dynamic>{}
          : (jsonDecode(actionRaw) as Map).cast<String, dynamic>();
      final action = j['action']?.toString() ?? '';
      var ok = true;
      if (action == 'setInteractive') {
        interactive = j['value'] == true;
        log('Etkileşimli mod: ${interactive ? "AÇIK" : "KAPALI"}');
      } else if (action == 'dismiss') {
        if (screen['phase'] == 'receipt' || screen['phase'] == 'result') {
          setScreen('idle');
        }
      } else if (action == 'approve' ||
          action == 'decline' ||
          action == 'timeout' ||
          action == 'reject') {
        ok = resolveUser(action);
      } else {
        ok = false;
      }
      await _json(req, {'ok': ok});
      break;
    case '/_mock/state':
      await _json(req, {
        'busy': _busy,
        'scenario': scenario.toJson(),
        ...state.toJson(),
      });
      break;
    case '/_mock/reset':
      state
        ..pairedFingerprint = ''
        ..lastSeq = 0
        ..idCounter = 1000
        ..invoiceCounter = 100
        ..lastProcessedSaleResponse = null
        ..reportIdCounter = 12000
        ..zReportNo = 0
        ..lastZSaleId = 0
        ..sales.clear()
        ..reports.clear();
      scenario.apply(Scenario().toJson());
      await saveState();
      log('Durum sıfırlandı');
      await _json(req, {'ok': true});
      break;
    default:
      await _json(req, {'ok': false, 'error': 'bilinmeyen _mock yolu'},
          status: 404);
  }
}

Future<void> _json(HttpRequest req, Map<String, dynamic> body,
    {int status = 200}) async {
  final resp = req.response;
  resp.statusCode = status;
  resp.headers.contentType = ContentType('application', 'json', charset: 'utf-8');
  // Gerçek cihazın döndüğü CORS başlıkları (doküman: rest-entegrasyonu.md).
  resp.headers.set('Access-Control-Allow-Origin', '*');
  resp.headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  resp.headers.set('Access-Control-Allow-Headers', 'Origin, Content-Type, X-Auth-Token');
  resp.write(jsonEncode(body));
  await resp.close();
}

// ---------------------------------------------------------------------------
// Etkileşimli POS ekranının sayfası (GET /_mock/ui)
// ---------------------------------------------------------------------------
//
// Tek dosya, dış bağımlılık yok. /_mock/screen'i 400 ms'de bir sorar,
// kararları /_mock/action'a, senaryo bayraklarını /_mock/scenario'ya yollar.
// Uygulama kodu bu yolları ASLA çağırmaz.

const String kPosUiHtml = r'''<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mock POS</title>
<style>
  :root{--bg:#0f1115;--panel:#181b22;--line:#2a2f3a;--text:#e8eaf0;--muted:#9aa3b2;
        --ok:#2fb36d;--bad:#e5484d;--warn:#f5a524;--accent:#4f8cff;--paper:#fbfaf6;--ink:#1d1d1f}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wrap{display:flex;gap:24px;padding:20px 16px;justify-content:center;flex-wrap:wrap}
  .device{width:360px;max-width:100%;background:#050608;border-radius:34px;padding:16px 14px 22px;
          box-shadow:0 0 0 2px #23262e,0 20px 50px rgba(0,0,0,.5)}
  .top{display:flex;justify-content:space-between;align-items:center;padding:2px 10px 10px;color:var(--muted);font-size:12px}
  .name{color:var(--text);font-weight:600;font-size:13px}
  .screen{background:#11141a;border-radius:20px;min-height:560px;padding:18px;display:flex;flex-direction:column}
  .center{flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:10px}
  .big{font-size:40px;font-weight:700;letter-spacing:-.5px}
  .title{font-size:18px;font-weight:600}
  .muted{color:var(--muted);font-size:13px}
  .items{width:100%;margin:6px 0 4px;max-height:170px;overflow:auto;border-top:1px solid var(--line)}
  .items div{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);font-size:13px}
  .btns{display:grid;gap:10px;margin-top:14px}
  button{font:inherit;border:0;border-radius:14px;padding:14px;cursor:pointer;font-weight:600;color:#fff;background:#2a2f3a}
  button.ok{background:var(--ok)} button.bad{background:var(--bad)} button.ghost{background:transparent;border:1px solid var(--line);color:var(--muted)}
  .count{font-variant-numeric:tabular-nums;font-size:13px;color:var(--warn)}
  .tap{width:96px;height:96px;border-radius:50%;border:3px solid var(--accent);display:grid;place-items:center;
       font-size:13px;color:var(--accent);animation:pulse 1.4s infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(79,140,255,.5)}70%{box-shadow:0 0 0 22px rgba(79,140,255,0)}100%{box-shadow:0 0 0 0 rgba(79,140,255,0)}}
  .spin{width:46px;height:46px;border-radius:50%;border:4px solid var(--line);border-top-color:var(--accent);animation:sp 1s linear infinite}
  @keyframes sp{to{transform:rotate(360deg)}}
  .paper{background:var(--paper);color:var(--ink);border-radius:6px;padding:14px;font:13px/1.45 ui-monospace,Consolas,monospace;width:100%}
  .paper .row{display:flex;justify-content:space-between}
  .paper hr{border:0;border-top:1px dashed #999;margin:8px 0}
  .icon{font-size:56px;line-height:1}
  .panel{width:380px;max-width:100%;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px}
  .panel h3{margin:4px 0 10px;font-size:14px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
  .kv{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:13px;margin-bottom:14px}
  .kv b{color:var(--muted);font-weight:500}
  label{display:flex;gap:10px;align-items:center;padding:7px 0;font-size:14px;cursor:pointer}
  .log{font:12px/1.5 ui-monospace,Consolas,monospace;color:var(--muted);max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-word}
  .banner{background:#3a2a05;color:#ffd58a;border-radius:12px;padding:10px 12px;font-size:13px;margin-bottom:12px}
  .banner button{margin-top:8px;padding:8px 12px;background:var(--warn);color:#1a1200}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:var(--bad)}
  .dot.on{background:var(--ok)}
</style>
</head>
<body>
<div class="wrap">
  <div class="device">
    <div class="top"><span class="name" id="dname">Mock POS</span><span id="clock"></span></div>
    <div class="screen" id="screen"><div class="center muted">Bağlanıyor…</div></div>
  </div>
  <div class="panel">
    <div id="banner"></div>
    <h3>Cihaz</h3>
    <div class="kv" id="info"></div>
    <h3>Bir sonraki işlemde</h3>
    <div id="flags"></div>
    <h3 style="margin-top:14px">Son olaylar</h3>
    <div class="log" id="log"></div>
  </div>
</div>
<script>
const $ = s => document.querySelector(s);
const tl = v => (Number(v)||0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' TL';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let lastKey = '', lastPhase = '', deadline = null;

const FLAGS = [
  ['failNextPayment','Kart bankadan reddedilsin (76)'],
  ['noResponseOnce','Satış cevabı kaybolsun (kurtarma testi)'],
  ['endOfDayRequired','Gün sonu zorunlu (199)'],
  ['printerBusyOnce','Yazıcı meşgul (90), bir kez'],
  ['offlineMode','Çevrimdışı satış (IsOffline)'],
];

function act(action, extra) {
  return fetch('/_mock/action', {method:'POST', body: JSON.stringify(Object.assign({action}, extra||{}))});
}
function scen(key, val) {
  return fetch('/_mock/scenario', {method:'POST', body: JSON.stringify({[key]: val})});
}
function beep() {
  try {
    const a = new (window.AudioContext||window.webkitAudioContext)();
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.value = 1320; o.connect(g); g.connect(a.destination);
    g.gain.value = .08; o.start(); setTimeout(() => { o.stop(); a.close(); }, 180);
  } catch (e) {}
}
function itemsHtml(items) {
  if (!items || !items.length) return '';
  return '<div class="items">' + items.map(i =>
    `<div><span>${esc(i.qty)} × ${esc(i.name)}</span><span>${tl(i.total)}</span></div>`).join('') + '</div>';
}

function renderScreen(d) {
  const s = d.screen || {phase:'idle'};
  const key = JSON.stringify(s);
  if (s.phase === 'card' && lastPhase !== 'card') beep();
  lastPhase = s.phase;
  deadline = s.deadline ? new Date(s.deadline) : null;
  if (key === lastKey) return;
  lastKey = key;
  let h = '';
  switch (s.phase) {
    case 'pairing':
      h = `<div class="center"><div class="icon">🔗</div><div class="title">Eşleştirme isteği</div>
           <div class="muted">Kasa uygulaması bu cihazla eşleşmek istiyor.</div>
           <div class="muted" style="word-break:break-all">${esc(s.fingerprint)}</div></div>
           <div class="btns"><button class="ok" onclick="act('approve')">Onayla</button>
           <button class="bad" onclick="act('reject')">Reddet</button></div>`;
      break;
    case 'card':
      h = `<div class="center"><div class="muted">${esc(s.title)}</div><div class="big">${tl(s.amount)}</div>
           ${s.orderNo ? `<div class="muted">Sipariş: ${esc(s.orderNo)}</div>` : ''}
           ${itemsHtml(s.items)}<div class="tap">Temassız</div><div class="count" id="count"></div></div>
           <div class="btns"><button class="ok" onclick="act('approve')">Kart okutuldu ✓</button>
           <button class="bad" onclick="act('decline')">Kart reddedildi</button>
           <button class="ghost" onclick="act('timeout')">Süreyi bitir (müşteri okutmadı)</button></div>`;
      break;
    case 'processing':
      h = `<div class="center"><div class="spin"></div><div class="title">${esc(s.title)}</div>
           <div class="muted">${tl(s.amount)}</div></div>`;
      break;
    case 'receipt': {
      const pays = (s.payments||[]).map(p => `<div class="row"><span>${esc(p.name)}</span><span>${tl(p.amount)}</span></div>`).join('');
      const items = (s.items||[]).map(i => `<div class="row"><span>${esc(i.qty)}x ${esc(i.name)}</span><span>${tl(i.total)}</span></div>`).join('');
      h = `<div class="center" style="justify-content:flex-start"><div class="icon" style="font-size:36px">🧾</div>
           <div class="title">${esc(s.title)}</div>
           <div class="paper">${items}<hr><div class="row"><b>TOPLAM</b><b>${tl(s.total)}</b></div>${pays}
           ${Number(s.remaining) > 0 ? `<div class="row"><span>KALAN</span><span>${tl(s.remaining)}</span></div>` : ''}
           <hr><div>Satış no: ${esc(s.saleNumber)}</div>${s.orderNo ? `<div>Sipariş: ${esc(s.orderNo)}</div>` : ''}
           ${s.invoiceNo ? `<div>e-Belge: ${esc(s.invoiceNo)}</div>` : '<div>e-Belge: oluşmadı</div>'}</div></div>
           <div class="btns"><button class="ghost" onclick="act('dismiss')">Tamam</button></div>`;
      break;
    }
    case 'result':
      h = `<div class="center"><div class="icon">${s.ok ? '✅' : '⛔'}</div><div class="title">${esc(s.message)}</div></div>
           <div class="btns"><button class="ghost" onclick="act('dismiss')">Tamam</button></div>`;
      break;
    default: {
      const dv = d.device || {};
      h = `<div class="center"><div class="icon">💳</div><div class="title">Hazır</div>
           <div class="muted">${dv.paired ? 'Kasa ile eşleşmiş' : 'Henüz eşleşmedi — kasadan Eşleştir'}</div>
           ${d.busy ? '<div class="muted">İşlem sürüyor…</div>' : ''}</div>`;
    }
  }
  $('#screen').innerHTML = h;
}

function renderPanel(d) {
  const dv = d.device || {};
  document.title = (dv.name || 'Mock POS') + ' — Mock POS';
  $('#dname').textContent = dv.name || 'Mock POS';
  $('#info').innerHTML =
    `<b>Seri</b><span>${esc(dv.serial)}</span><b>Terminal</b><span>${esc(dv.terminalId)}</span>
     <b>Eşleşme</b><span><span class="dot ${dv.paired ? 'on' : ''}"></span>${dv.paired ? 'var' : 'yok'}</span>
     <b>Sequence</b><span>${esc(dv.lastSeq)}</span><b>Satış sayısı</b><span>${esc(dv.salesCount)}</span>`;
  $('#banner').innerHTML = d.interactive ? '' :
    `<div class="banner">Etkileşimli mod kapalı: kart ödemeleri kendiliğinden onaylanıyor.
     <br><button onclick="act('setInteractive',{value:true})">Etkileşimli modu aç</button></div>`;
  const sc = d.scenario || {};
  const fl = $('#flags');
  if (!fl.dataset.built) {
    fl.innerHTML = FLAGS.map(([k, t]) =>
      `<label><input type="checkbox" data-k="${k}" onchange="scen('${k}', this.checked)"> ${t}</label>`).join('');
    fl.dataset.built = '1';
  }
  fl.querySelectorAll('input').forEach(i => {
    if (document.activeElement !== i) i.checked = !!sc[i.dataset.k];
  });
  $('#log').textContent = (d.log || []).join('\n');
}

function tick() {
  $('#clock').textContent = new Date().toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'});
  const c = document.getElementById('count');
  if (c && deadline) {
    const sec = Math.max(0, Math.round((deadline - new Date()) / 1000));
    c.textContent = `Kart okuma süresi: ${sec} sn`;
  }
}

async function poll() {
  try {
    const r = await fetch('/_mock/screen', {cache:'no-store'});
    const d = await r.json();
    renderScreen(d); renderPanel(d);
  } catch (e) {
    lastKey = '';
    $('#screen').innerHTML = '<div class="center muted">Mock sunucuya ulaşılamıyor.<br>Pencere kapanmış olabilir.</div>';
  }
  setTimeout(poll, 400);
}
setInterval(tick, 500);
poll();
</script>
</body>
</html>
''';
