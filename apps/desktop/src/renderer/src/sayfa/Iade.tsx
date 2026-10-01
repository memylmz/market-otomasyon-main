/** İade / değişim ekranı (§10.4) — fiş no ile orijinal satışı bul, tam/kısmi iade et. */

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  fisNoSadelestir,
  IADE_YONTEMI_ETIKETI,
  miktarFormat,
  miktarParse,
  paraFormat,
  tarihSaatFormat,
  varsayilanIadeYontemi,
  type Kurus,
  type Miktar,
} from '@market/shared';
import { Alan, BosDurum, Diyalog } from '../bilesen/temel';
import { bildir, hatayiBildir } from '../durum/bildirim';
import { useBarkodOdakYakalayici } from '../kanca/useKisayol';
import { usePosAktif } from '../kanca/usePosAktif';
import { cagir } from '../kopru';
import { MusteriSecDiyalogu } from './satis/MusteriSecDiyalogu';

/** Orijinal satışın ödeme adları (iade değil, satış dili). */
const IADE_ODEME_ADI: Record<string, string> = { NAKIT: 'Nakit', KART: 'Kart', VERESIYE: 'Veresiye' };

interface Kalem {
  id: string;
  urun_adi: string;
  miktar: Miktar;
  birim_tipi: string;
  birim_fiyat: Kurus;
  satir_toplam: Kurus;
  iade_edilen?: Miktar;
}

interface SatisDetay {
  satis: {
    id: string;
    fis_no: string;
    tarih: string;
    genel_toplam: Kurus;
    iptal_mi: boolean;
    iade_mi: boolean;
    musteri_adi?: string | null;
    musteri_id?: string | null;
  };
  kalemler: Kalem[];
  odemeler: { odeme_tipi: string; tutar: Kurus }[];
  /** Bu satıştan daha önce yapılmış iadeler. */
  iadeler: { id: string; fis_no: string; tarih: string; genel_toplam: Kurus }[];
}

export function IadeSayfasi() {
  // Satışlar'daki fiş detayından "İade Et" ile gelinirse fiş numarası hazır gelir.
  const gelenFisNo = (useLocation().state as { fisNo?: string } | null)?.fisNo ?? '';
  const [fisNo, setFisNo] = useState(gelenFisNo);
  const [detay, setDetay] = useState<SatisDetay | null>(null);
  const [secimler, setSecimler] = useState<Record<string, string>>({});
  const [yontem, setYontem] = useState<'NAKIT' | 'KART' | 'VERESIYE'>('NAKIT');
  const posAktif = usePosAktif();
  const [neden, setNeden] = useState('');
  const [calisiyor, setCalisiyor] = useState(false);
  const [onayAcik, setOnayAcik] = useState(false);
  /**
   * Borçtan düşülecek müşteri ve güncel borcu. Satışın müşterisi varsa odur;
   * perakende satışta kasiyer iade sırasında seçer.
   */
  const [hesap, setHesap] = useState<{ id: string; ad: string; bakiye: Kurus } | null>(null);
  const [musteriSecAcik, setMusteriSecAcik] = useState(false);
  const fisAlani = useRef<HTMLInputElement>(null);

  // Fiş barkodu okutulduğunda alan odakta olmasa da yakalanır.
  useBarkodOdakYakalayici({
    aktif: true,
    odakla: () => fisAlani.current?.focus(),
    onKarakter: (karakter) => setFisNo((mevcut) => mevcut + karakter),
  });

  const bul = async (aranan = fisNo) => {
    if (!aranan.trim()) return;
    try {
      const liste = await cagir<{ kayitlar: { id: string; fis_no: string }[] }>('satis.listele', {
        filtre: { fisNo: aranan.trim() },
        limit: 5,
      });
      /*
       * Fiş numarası tür harfi taşıdığı için (NA-/KA-/VA-…) yalnız rakamla
       * aramak birden çok fişe uyabilir; o zaman tam eşleşen seçilir, yoksa
       * kasiyerden tür harfiyle yazması istenir — yanlış fiş iade edilmesin.
       */
      const sade = fisNoSadelestir(aranan);
      const tam = liste.kayitlar.find((k) => fisNoSadelestir(k.fis_no) === sade);
      if (!tam && liste.kayitlar.length > 1) {
        bildir.uyari(
          'Birden fazla fiş eşleşti',
          `${liste.kayitlar.map((k) => k.fis_no).join(', ')} — fiş numarasını tür harfiyle yazın (örn. NA-000512).`,
        );
        setDetay(null);
        return;
      }
      const ilk = tam ?? liste.kayitlar[0];
      if (!ilk) {
        bildir.uyari('Satış bulunamadı', 'Fiş numarasını kontrol edin.');
        setDetay(null);
        return;
      }
      const d = await cagir<SatisDetay>('satis.detay', { satisId: ilk.id });
      setDetay(d);
      setSecimler({});
      setHesap(null);
      if (d.satis.musteri_id) void hesabiYukle(d.satis.musteri_id);
      // Para müşteriye geldiği yoldan döner: veresiye satışın iadesi borçtan düşülür.
      setYontem(varsayilanIadeYontemi(d.odemeler ?? []));
      if (d.satis.iptal_mi) bildir.uyari('Bu satış iptal edilmiş, iade edilemez.');
      if (d.satis.iade_mi) bildir.uyari('Bu bir iade fişidir, tekrar iade edilemez.');
    } catch (hata) {
      hatayiBildir(hata, 'Satış arama');
    }
  };

  /** Müşterinin güncel borcu — "borç 400 → 200" gösterebilmek için. */
  const hesabiYukle = async (cariId: string) => {
    try {
      const c = await cagir<{ id: string; ad_unvan: string; bakiye: Kurus }>('cari.detay', { cariId });
      setHesap({ id: c.id, ad: c.ad_unvan, bakiye: c.bakiye });
    } catch (hata) {
      hatayiBildir(hata, 'Müşteri hesabı');
    }
  };

  useEffect(() => {
    if (gelenFisNo) void bul(gelenFisNo);
    // Yalnız ilk açılışta: sonradan yazılan fiş numarası Enter/Bul ile aranır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const secilenKalemler = () =>
    Object.entries(secimler)
      .map(([id, metin]) => ({ satis_kalemi_id: id, miktar: miktarParse(metin) ?? 0 }))
      .filter((k) => k.miktar > 0);

  const onayIste = () => {
    if (!detay) return;
    if (secilenKalemler().length === 0) {
      bildir.uyari('İade edilecek kalem seçilmedi');
      return;
    }
    // İade geri alınamaz bir işlemdir: stok, kasa ve cari aynı anda etkilenir.
    // Yıkıcı işlemlerde onay istenir (§3.3 hata affı).
    setOnayAcik(true);
  };

  const iadeEt = async () => {
    if (!detay) return;
    const kalemler = secilenKalemler();
    if (kalemler.length === 0) return;

    setOnayAcik(false);
    setCalisiyor(true);
    try {
      const sonuc = await cagir<{ fisNo: string; genelToplam: Kurus }>('satis.iade', {
        kaynak_satis_id: detay.satis.id,
        kalemler,
        iade_yontemi: yontem,
        // Perakende satışta borçtan düşülecek müşteri iade sırasında seçilir.
        musteri_id: yontem === 'VERESIYE' && !detay.satis.musteri_id ? hesap?.id : undefined,
        // Neden opsiyoneldir; boş bırakılırsa denetim kaydında ayırt edilebilir
        // sabit bir metin yazılır (alan hiç boş kalmasın).
        neden: neden.trim() || 'Belirtilmedi',
      });
      bildir.basari(
        `İade tamamlandı — ${sonuc.fisNo}`,
        [
          `${IADE_YONTEMI_ETIKETI[yontem]}: ${paraFormat(Math.abs(sonuc.genelToplam))}`,
          (yontem === 'VERESIYE' ? hesap?.ad : detay.satis.musteri_adi)
            ? `Müşteri: ${yontem === 'VERESIYE' ? hesap?.ad : detay.satis.musteri_adi}`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
      );
      setDetay(null);
      setSecimler({});
      setNeden('');
      setFisNo('');
    } catch (hata) {
      hatayiBildir(hata, 'İade');
    } finally {
      setCalisiyor(false);
    }
  };

  const toplamIade = detay
    ? detay.kalemler.reduce((t, k) => {
        const m = miktarParse(secimler[k.id] ?? '') ?? 0;
        return t + (k.miktar > 0 ? Math.round(k.satir_toplam * (m / k.miktar)) : 0);
      }, 0)
    : 0;

  const iadeEdilebilir = detay && !detay.satis.iptal_mi && !detay.satis.iade_mi;
  const perakende = !detay?.satis.musteri_id;
  const onerilenYontem = detay ? varsayilanIadeYontemi(detay.odemeler ?? []) : 'NAKIT';
  /*
   * Veresiye alınmış mal nakit/kartla iade edilirse müşteri ödemediği malın
   * parasını alır ve borcu olduğu gibi kalır. Engellenmez (müşteri borcunu
   * sonradan ödemiş olabilir) ama açıkça uyarılır.
   */
  const veresiyeUyarisi = onerilenYontem === 'VERESIYE' && yontem !== 'VERESIYE';
  /** Borçtan düş seçildi ama kimin borcu belli değil — onay verilemez. */
  const hesapEksik = yontem === 'VERESIYE' && !hesap;
  const sonrakiBakiye = hesap ? hesap.bakiye - toplamIade : 0;

  return (
    <div className="flex h-full flex-col p-4">
      <h1 className="mb-3 text-xl font-semibold">İade / Değişim</h1>

      <div className="mb-4 flex max-w-md gap-2">
        <input
          ref={fisAlani}
          className="alan"
          placeholder="Fiş barkodunu okutun veya numarayı yazın (örn. NA-000512)"
          value={fisNo}
          onChange={(e) => setFisNo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void bul()}
          autoFocus
        />
        <button type="button" className="tus-birincil" onClick={() => void bul()}>
          Bul
        </button>
      </div>

      {!detay ? (
        <BosDurum
          baslik="Satış seçilmedi"
          aciklama="İade için önce orijinal satışı fiş numarasıyla bulun. Değişim = iade + yeni satış olarak yapılır."
        />
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          <section className="kart min-w-0 flex-1 overflow-auto">
            <header className="border-b border-cizgi px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono font-semibold">{detay.satis.fis_no}</p>
                  <p className="text-sm text-metin-3">
                    {tarihSaatFormat(detay.satis.tarih)}
                    {detay.satis.musteri_adi ? ` · ${detay.satis.musteri_adi}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-lg font-bold">{paraFormat(detay.satis.genel_toplam)}</p>
                  <p className="text-xs text-metin-3">
                    {(detay.odemeler ?? [])
                      .map((o) => `${IADE_ODEME_ADI[o.odeme_tipi] ?? o.odeme_tipi} ${paraFormat(o.tutar, { simge: false })}`)
                      .join(' · ')}
                  </p>
                </div>
              </div>
              {/* İade hangi müşteriye yazılacak — kasiyer bunu işlemden önce görmeli. */}
              {detay.satis.musteri_adi && (
                <p className="mt-2 rounded bg-bilgi-yumusak px-3 py-2 text-sm">
                  Müşteri: <strong>{detay.satis.musteri_adi}</strong> — iade fişi bu müşteriye bağlanır.
                </p>
              )}
              {(detay.iadeler ?? []).length > 0 && (
                <p className="mt-2 text-xs text-uyari">
                  Bu satıştan daha önce iade yapıldı:{' '}
                  {detay.iadeler.map((i) => `${i.fis_no} (${paraFormat(Math.abs(i.genel_toplam), { simge: false })})`).join(', ')}
                </p>
              )}
            </header>

            {/* İade edilemeyecek fişler küçük bir rozetle geçiştirilmemeli:
                kasiyer neden hiçbir kalemi seçemediğini anında anlamalı. */}
            {(detay.satis.iade_mi || detay.satis.iptal_mi) && (
              <div
                className={`m-4 flex items-start gap-3 rounded-lg border p-4 ${
                  detay.satis.iptal_mi ? 'border-tehlike-cizgi bg-tehlike-yumusak' : 'border-uyari-cizgi bg-uyari-yumusak'
                }`}
                role="alert"
              >
                <span aria-hidden="true" className="text-2xl">
                  {detay.satis.iptal_mi ? '✕' : '↩'}
                </span>
                <div>
                  <p className={`text-base font-semibold ${detay.satis.iptal_mi ? 'text-tehlike' : 'text-uyari'}`}>
                    {detay.satis.iptal_mi ? 'Bu satış iptal edilmiş' : 'Bu bir İADE FİŞİ'}
                  </p>
                  <p className="mt-0.5 text-sm text-metin-2">
                    {detay.satis.iptal_mi
                      ? 'İptal edilmiş bir satış iade edilemez.'
                      : 'İade fişi tekrar iade edilemez. İade etmek istediğiniz asıl satış fişinin numarasını okutun.'}
                  </p>
                </div>
              </div>
            )}

            <table className="tablo">
              <thead>
                <tr>
                  <th>Ürün</th>
                  <th className="text-center">Satılan</th>
                  <th className="text-center">İade edilmiş</th>
                  <th className="text-center">Birim fiyat</th>
                  <th className="w-32 text-center">İade miktarı</th>
                </tr>
              </thead>
              <tbody>
                {detay.kalemler.map((k) => {
                  const dahaOnce = -(k.iade_edilen ?? 0);
                  const kalan = k.miktar - dahaOnce;
                  return (
                    <tr key={k.id}>
                      <td className="font-medium">{k.urun_adi}</td>
                      <td className="text-center font-mono tabular-nums">{miktarFormat(k.miktar)}</td>
                      <td className="text-center font-mono tabular-nums text-uyari">
                        {dahaOnce > 0 ? miktarFormat(dahaOnce) : '—'}
                      </td>
                      <td className="text-center font-mono tabular-nums">{paraFormat(k.birim_fiyat, { simge: false })}</td>
                      <td>
                        <div className="flex justify-center gap-1">
                          <input
                            className="alan sayi py-1"
                            value={secimler[k.id] ?? ''}
                            placeholder="0"
                            disabled={!iadeEdilebilir || kalan <= 0}
                            onChange={(e) => setSecimler((s) => ({ ...s, [k.id]: e.target.value }))}
                          />
                          <button
                            type="button"
                            className="tus-ikincil px-2 py-1 text-xs"
                            disabled={!iadeEdilebilir || kalan <= 0}
                            onClick={() => setSecimler((s) => ({ ...s, [k.id]: String(kalan / 1000) }))}
                          >
                            Tümü
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <aside className="w-72 shrink-0">
            <div className="kart space-y-3 p-4">
              <div>
                <p className="text-sm text-metin-3">İade tutarı</p>
                <p className="font-mono text-3xl font-bold text-uyari">{paraFormat(toplamIade)}</p>
              </div>

              {/*
                Para iadesinin türü — üç seçenek açıkça yan yana: müşteriye
                nakit mi verilecek, karta mı iade edilecek, borcundan mı düşülecek.
              */}
              <div className="space-y-2" role="radiogroup" aria-label="Para iadesi">
                <span className="etiket">Para nasıl iade edilecek?</span>
                {(
                  [
                    { deger: 'NAKIT', baslik: '💵 Nakit ver', alt: 'Tutar kasadan çıkar.' },
                    {
                      deger: 'KART',
                      baslik: '💳 Karta iade',
                      alt: posAktif
                        ? 'Onaylayınca POS cihazından otomatik iade edilir; kartla ödenen tutarı aşamaz.'
                        : 'POS cihazından elle iade yapın; kasa etkilenmez.',
                    },
                    { deger: 'VERESIYE', baslik: '📒 Borcundan düş', alt: 'Müşterinin cari hesabına alacak yazılır.' },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.deger}
                    type="button"
                    role="radio"
                    aria-checked={yontem === s.deger}
                    disabled={!iadeEdilebilir}
                    onClick={() => {
                      setYontem(s.deger);
                      if (s.deger === 'VERESIYE' && !hesap) setMusteriSecAcik(true);
                    }}
                    className={`w-full rounded border px-3 py-2 text-left text-sm ${
                      yontem === s.deger ? 'border-vurgu bg-vurgu-yumusak' : 'border-cizgi hover:bg-yuzey-2'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2 font-medium">
                      {s.baslik}
                      {onerilenYontem === s.deger && <span className="text-xs font-normal text-vurgu">önerilen</span>}
                    </span>
                    <span className="block text-xs text-metin-3">{s.alt}</span>
                  </button>
                ))}
              </div>

              {yontem === 'VERESIYE' && (
                <div className="rounded border border-cizgi px-3 py-2 text-sm">
                  {hesap ? (
                    <>
                      <p className="font-medium">{hesap.ad}</p>
                      <p className="text-xs text-metin-3">
                        Borç {paraFormat(hesap.bakiye)} → <strong>{paraFormat(sonrakiBakiye)}</strong>
                      </p>
                      {sonrakiBakiye < 0 && (
                        <p className="mt-1 text-xs text-uyari">
                          İade borçtan fazla: müşteri {paraFormat(-sonrakiBakiye)} alacaklı olur (sonraki alışverişinden düşülür).
                        </p>
                      )}
                      {perakende && (
                        <button
                          type="button"
                          className="mt-1 text-xs text-vurgu hover:underline"
                          onClick={() => setMusteriSecAcik(true)}
                        >
                          Başka müşteri seç
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-metin-3">Satış perakende yapılmış; borcundan düşülecek müşteriyi seçin.</p>
                      <button type="button" className="tus-ikincil mt-2 w-full" onClick={() => setMusteriSecAcik(true)}>
                        Müşteri Seç
                      </button>
                    </>
                  )}
                </div>
              )}
              {veresiyeUyarisi && (
                <p className="rounded border border-uyari-cizgi bg-uyari-yumusak px-3 py-2 text-xs text-metin-2">
                  Bu satış <strong>veresiye</strong> yapılmıştı. Nakit ya da kartla iade ederseniz müşteriye para verilir ve borcu{' '}
                  <strong>düşmez</strong>. Borcunu zaten ödediyse devam edebilirsiniz.
                </p>
              )}

              <Alan etiket="İade nedeni" ipucu="İsteğe bağlı. Girilirse fişe ve denetim kaydına yazılır.">
                <textarea
                  className="alan"
                  rows={3}
                  value={neden}
                  onChange={(e) => setNeden(e.target.value)}
                  disabled={!iadeEdilebilir}
                  placeholder="Örn. müşteri beğenmedi, ambalaj hasarlı…"
                />
              </Alan>

              <button
                type="button"
                className="tus-tehlike w-full"
                onClick={onayIste}
                disabled={!iadeEdilebilir || calisiyor || toplamIade <= 0 || hesapEksik}
              >
                {calisiyor ? 'İşleniyor…' : 'İadeyi Onayla'}
              </button>

              <p className="text-xs text-metin-4">
                İade onaylandığında: mal stoğa girer, kasa/cari ters kayıtla düzeltilir ve işlem denetim loguna yazılır.
              </p>
            </div>
          </aside>
        </div>
      )}

      <Diyalog
        acik={onayAcik}
        baslik="İadeyi onaylıyor musunuz?"
        aciklama="Bu işlem geri alınamaz."
        genislik="dar"
        onKapat={() => setOnayAcik(false)}
        altBilgi={
          <>
            <button type="button" className="tus-ikincil" onClick={() => setOnayAcik(false)}>
              Vazgeç
            </button>
            <button type="button" className="tus-tehlike" onClick={iadeEt} disabled={calisiyor} data-odak>
              Evet, İade Et
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="rounded-lg bg-yuzey-3 p-4 text-center">
            <p className="text-metin-3">İade tutarı</p>
            <p className="font-mono text-3xl font-bold text-uyari">{paraFormat(toplamIade)}</p>
          </div>

          <ul className="space-y-1">
            <li className="flex items-center gap-2 border-b border-cizgi pb-1 text-xs font-medium text-metin-3">
              <span className="flex-1">Ürün</span>
              <span className="w-24 text-center">Miktar</span>
            </li>
            {detay?.kalemler
              .filter((k) => (miktarParse(secimler[k.id] ?? '') ?? 0) > 0)
              .map((k) => (
                <li key={k.id} className="flex items-center gap-2 border-b border-cizgi-ince pb-1">
                  <span className="flex-1">{k.urun_adi}</span>
                  <span className="w-24 text-center font-mono tabular-nums">
                    {miktarFormat(miktarParse(secimler[k.id] ?? '') ?? 0)}
                  </span>
                </li>
              ))}
          </ul>

          {(yontem === 'VERESIYE' ? hesap?.ad : detay?.satis.musteri_adi) && (
            <p className="text-metin-2">
              Müşteri: <strong>{yontem === 'VERESIYE' ? hesap?.ad : detay?.satis.musteri_adi}</strong>
            </p>
          )}
          <p className="text-metin-2">
            İade şekli:{' '}
            <strong>
              {yontem === 'NAKIT'
                ? 'Nakit (kasadan çıkacak)'
                : yontem === 'KART'
                  ? posAktif
                    ? "Karta iade (POS'tan otomatik)"
                    : 'Karta iade (manuel)'
                  : `${hesap?.ad ?? 'Müşterinin'} hesabına alacak — borcundan düşülecek`}
            </strong>
          </p>

          <p className="text-xs text-metin-3">
            Mal stoğa geri girer, kasa ve cari ters kayıtla düzeltilir, işlem denetim loguna yazılır.
          </p>
        </div>
      </Diyalog>

      <MusteriSecDiyalogu
        acik={musteriSecAcik}
        onKapat={() => setMusteriSecAcik(false)}
        onSec={(id) => {
          setMusteriSecAcik(false);
          if (id) void hesabiYukle(id);
        }}
      />
    </div>
  );
}
