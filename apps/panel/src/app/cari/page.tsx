/**
 * Cari hesaplar, yaşlandırma ve hesap ekstresi (§11.6).
 *
 * Liste tüm carileri gösterir (bakiyesi sıfır olanlar dahil); yaşlandırma
 * yalnız borçlu hesaplar için anlamlıdır, o yüzden ayrı uçtan gelir.
 * Tahsilat/ödeme kaydı KASADAN yapılır — para fiziksel olarak orada alınır.
 */

'use client';

import { useState } from 'react';
import { goreliZaman, paraFormat, paraParse, tarihFormat, type Kurus } from '@market/shared';
import { YaslandirmaGrafigi } from '@/bilesen/grafik';
import { BosDurum, HataKutusu, Kabuk, Modal, ParaKutusu, Rozet, Yukleniyor } from '@/bilesen/kabuk';
import { FisIcerigi, fisBasligi, useFis } from '@/bilesen/fis';
import { api, uclar } from '@/lib/api';
import { useVeri } from '@/lib/kanca';

interface Cari {
  id: string;
  tip: string;
  ad_unvan: string;
  telefon: string | null;
  eposta: string | null;
  kredi_limiti: Kurus;
  vade_gun: number;
  aktif_mi: number;
  bakiye: Kurus;
  son_hareket: string | null;
}

interface YaslandirmaSatiri {
  cari_id: string;
  ad_unvan: string;
  bakiye: Kurus;
  yaslandirma: { dilim: string; tutar: Kurus }[];
}

const DILIMLER = ['0-30', '31-60', '61-90', '90+'];

export default function CariSayfasi() {
  const [tip, setTip] = useState<'MUSTERI' | 'TEDARIKCI'>('MUSTERI');
  const [arama, setArama] = useState('');
  const [ekstreId, setEkstreId] = useState<string | null>(null);
  const [duzenlenen, setDuzenlenen] = useState<Cari | 'yeni' | null>(null);

  // 200, paylaşılan sayfalama sözleşmesinin üst sınırı; dolarsa kullanıcı uyarılır.
  const liste = useVeri<{ data: Cari[]; has_more: boolean }>(`${uclar.cariler}?tip=${tip}&limit=200`, [tip]);
  const yaslandirma = useVeri<{ data: YaslandirmaSatiri[]; uretim_zamani: string }>(`${uclar.raporCari}?tip=${tip}`, [tip]);

  const kayitlar = (liste.veri?.data ?? []).filter((c) =>
    arama ? c.ad_unvan.toLocaleLowerCase('tr').includes(arama.toLocaleLowerCase('tr')) : true,
  );
  const toplam = kayitlar.reduce((t, c) => t + Math.max(0, c.bakiye), 0);

  const genelYaslandirma = DILIMLER.map((dilim) => ({
    dilim,
    tutar: (yaslandirma.veri?.data ?? []).reduce((t, c) => t + (c.yaslandirma.find((y) => y.dilim === dilim)?.tutar ?? 0), 0),
  }));
  const vadesiGecen = genelYaslandirma.slice(1).reduce((t, y) => t + y.tutar, 0);

  // Yaşlandırma satırını cari id'siyle eşle: liste ve rapor ayrı uçlardan gelir.
  const yaslandirmaHaritasi = new Map((yaslandirma.veri?.data ?? []).map((y) => [y.cari_id, y.yaslandirma] as const));

  return (
    <Kabuk baslik="Cari Hesap" tazelik={yaslandirma.veri?.uretim_zamani}>
      <div className="space-y-4">
        <div className="flex rounded-lg border border-cizgi-kuvvetli">
          {(['MUSTERI', 'TEDARIKCI'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTip(t)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm ${
                tip === t ? 'bg-vurgu font-medium text-vurgu-uzeri' : 'text-metin-2'
              }`}
            >
              {t === 'MUSTERI' ? 'Müşteri Alacakları' : 'Tedarikçi Borçları'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            className="alan max-w-xs flex-1"
            placeholder="Ad / unvan ara…"
            value={arama}
            onChange={(e) => setArama(e.target.value)}
          />
          <button type="button" className="tus-birincil" onClick={() => setDuzenlenen('yeni')}>
            Yeni {tip === 'MUSTERI' ? 'Müşteri' : 'Tedarikçi'}
          </button>
        </div>

        {liste.yukleniyor ? (
          <Yukleniyor />
        ) : liste.hata ? (
          <HataKutusu mesaj={liste.hata} tekrarDene={liste.tazele} />
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3">
              <ParaKutusu
                etiket={tip === 'MUSTERI' ? 'Toplam alacak' : 'Toplam borç'}
                tutar={toplam}
                alt={`${kayitlar.length} hesap`}
                vurgulu
              />
              <ParaKutusu etiket="Vadesi geçen (30+ gün)" tutar={vadesiGecen} alt="Takip gerekebilir" />
            </section>

            {vadesiGecen > 0 && (
              <section className="kart p-4">
                <h2 className="mb-3 font-semibold">Yaşlandırma</h2>
                <YaslandirmaGrafigi dilimler={genelYaslandirma} />
              </section>
            )}

            <section className="kart p-4">
              <h2 className="mb-3 font-semibold">Hesap Dökümü</h2>
              {kayitlar.length === 0 ? (
                <BosDurum
                  baslik="Kayıt yok"
                  aciklama={arama ? 'Arama sonucuna uyan hesap bulunamadı.' : 'Bu türde hesap kaydı bulunmuyor.'}
                />
              ) : (
                <div className="tablo-sarmal">
                  <table className="tablo">
                    <thead>
                      <tr>
                        <th className="text-left">Ad / Unvan</th>
                        <th>Bakiye</th>
                        {DILIMLER.map((d) => (
                          <th key={d}>{d}</th>
                        ))}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {kayitlar.map((c) => {
                        const dilimler = yaslandirmaHaritasi.get(c.id);
                        return (
                          <tr key={c.id}>
                            <td className="text-left">
                              <button
                                type="button"
                                className="max-w-[180px] truncate font-medium text-vurgu hover:underline"
                                onClick={() => setEkstreId(c.id)}
                              >
                                {c.ad_unvan}
                              </button>
                              <div className="text-xs text-metin-4">
                                {c.telefon ?? '—'}
                                {c.son_hareket ? ` · ${goreliZaman(c.son_hareket)}` : ''}
                              </div>
                            </td>
                            <td className={`sayi font-semibold ${c.bakiye > 0 ? 'text-uyari' : 'text-metin-3'}`}>
                              {paraFormat(c.bakiye, { simge: false })}
                            </td>
                            {DILIMLER.map((dilim, i) => {
                              const tutar = dilimler?.find((y) => y.dilim === dilim)?.tutar ?? 0;
                              return (
                                <td key={dilim} className={`sayi ${i >= 2 && tutar > 0 ? 'text-tehlike' : 'text-metin-4'}`}>
                                  {tutar > 0 ? paraFormat(tutar, { simge: false }) : '—'}
                                </td>
                              );
                            })}
                            <td>
                              <button
                                type="button"
                                className="text-xs text-metin-3 hover:text-metin hover:underline"
                                onClick={() => setDuzenlenen(c)}
                              >
                                Düzenle
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-xs text-metin-4">
                Ekstre için hesap adına dokunun. Yaşlandırma, tahsilatların en eski borçtan mahsup edilmesiyle (FIFO) hesaplanır.
                {liste.veri?.has_more && ' Liste 200 kayıtla sınırlıdır; aramayı daraltın.'}
              </p>
            </section>

            <p className="text-xs text-metin-4">
              Tahsilat ve ödeme kayıtları kasadan girilir — para fiziksel olarak orada alınır ve aynı anda kasa hareketi oluşur.
              Kişisel verilerin işlenmesi KVKK kapsamındadır; iletişim için açık rıza gerekir.
            </p>
          </>
        )}
      </div>

      {ekstreId && <EkstreDiyalogu cariId={ekstreId} onKapat={() => setEkstreId(null)} />}

      {duzenlenen && (
        <CariFormu
          cari={duzenlenen}
          tip={tip}
          onKapat={() => setDuzenlenen(null)}
          onKaydedildi={() => {
            setDuzenlenen(null);
            liste.tazele();
            yaslandirma.tazele();
          }}
        />
      )}
    </Kabuk>
  );
}

// ---------------------------------------------------------------------------
// Ekstre
// ---------------------------------------------------------------------------

interface EkstreVerisi {
  cari: (Cari & { adres: string | null; iletisim_rizasi: number }) | null;
  hareketler: {
    id: string;
    hareket_tipi: string;
    tutar: Kurus;
    aciklama: string | null;
    tarih: string;
    vade_tarihi: string | null;
    /** Hareketi doğuran belge — satışsa fişi açılabilir (§10.7). */
    belge_id: string | null;
    yuruyen_bakiye: Kurus;
  }[];
}

const HAREKET_ETIKETI: Record<string, string> = {
  BORC: 'Borç',
  ALACAK: 'Alacak',
  TAHSILAT: 'Tahsilat',
  ODEME: 'Ödeme',
  IADE: 'İade',
  DUZELTME: 'Düzeltme',
  ACILIS: 'Açılış bakiyesi',
};

function EkstreDiyalogu({ cariId, onKapat }: { cariId: string; onKapat: () => void }) {
  const [fisId, setFisId] = useState<string | null>(null);
  const { veri, yukleniyor, hata, tazele } = useVeri<EkstreVerisi>(`${uclar.cariler}/${cariId}/ekstre`);

  const csvIndir = () => {
    if (!veri) return;
    const satirlar = ['tarih;islem;aciklama;tutar;yuruyen_bakiye'];
    // CSV eskiden yeniye yazılır: muhasebe ekstresi bu sırayla okunur.
    for (const h of [...veri.hareketler].reverse()) {
      satirlar.push(
        [
          tarihFormat(h.tarih),
          HAREKET_ETIKETI[h.hareket_tipi] ?? h.hareket_tipi,
          h.aciklama ?? '',
          h.tutar,
          h.yuruyen_bakiye,
        ].join(';'),
      );
    }
    const bag = document.createElement('a');
    bag.href = URL.createObjectURL(new Blob(['﻿' + satirlar.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    bag.download = `ekstre-${veri.cari?.ad_unvan ?? cariId}.csv`;
    bag.click();
    URL.revokeObjectURL(bag.href);
  };

  return (
    <Modal
      baslik={veri?.cari ? `Ekstre — ${veri.cari.ad_unvan}` : 'Hesap ekstresi'}
      genis
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil" onClick={csvIndir} disabled={!veri?.hareketler.length}>
            Excel / CSV
          </button>
          <button type="button" className="tus-birincil ml-auto" onClick={onKapat}>
            Kapat
          </button>
        </>
      }
    >
      {yukleniyor ? (
        <Yukleniyor />
      ) : hata ? (
        <HataKutusu mesaj={hata} tekrarDene={tazele} />
      ) : !veri?.cari ? (
        <BosDurum baslik="Hesap bulunamadı" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span>
              <span className="text-metin-3">Bakiye:</span>{' '}
              <strong className={veri.cari.bakiye > 0 ? 'text-uyari' : ''}>{paraFormat(veri.cari.bakiye)}</strong>
            </span>
            <span>
              <span className="text-metin-3">Kredi limiti:</span>{' '}
              {veri.cari.kredi_limiti > 0 ? paraFormat(veri.cari.kredi_limiti) : 'Sınırsız'}
            </span>
            <span>
              <span className="text-metin-3">Vade:</span> {veri.cari.vade_gun} gün
            </span>
            {veri.cari.iletisim_rizasi === 1 ? (
              <Rozet tur="basari">İletişim rızası var</Rozet>
            ) : (
              <Rozet tur="notr">İletişim rızası yok</Rozet>
            )}
          </div>

          {veri.hareketler.length === 0 ? (
            <BosDurum baslik="Hareket yok" aciklama="Bu hesapta henüz işlem kaydı bulunmuyor." />
          ) : (
            <div className="tablo-sarmal">
              <table className="tablo">
                <thead>
                  <tr>
                    <th className="text-left">Tarih</th>
                    <th>İşlem</th>
                    <th>Tutar</th>
                    <th>Yürüyen bakiye</th>
                  </tr>
                </thead>
                <tbody>
                  {veri.hareketler.map((h) => {
                    // Kasadaki Cari ekranıyla aynı davranış: borcun arkasındaki
                    // fişin kalemlerine buradan da inilebilir.
                    const fisVar = Boolean(h.belge_id);
                    return (
                      <tr
                        key={h.id}
                        className={fisVar ? 'cursor-pointer hover:bg-yuzey-2' : ''}
                        onClick={() => fisVar && h.belge_id && setFisId(h.belge_id)}
                      >
                        <td className="whitespace-nowrap text-left text-metin-3">{tarihFormat(h.tarih)}</td>
                        <td>
                          <div>
                            {HAREKET_ETIKETI[h.hareket_tipi] ?? h.hareket_tipi}
                            {fisVar && <span className="ml-2 text-xs text-vurgu">fişi gör →</span>}
                          </div>
                          {h.aciklama && <div className="text-xs text-metin-4">{h.aciklama}</div>}
                        </td>
                        <td className={`sayi ${h.tutar > 0 ? 'text-uyari' : 'text-vurgu'}`}>
                          {paraFormat(h.tutar, { simge: false, isaret: true })}
                        </td>
                        <td className="sayi font-semibold">{paraFormat(h.yuruyen_bakiye, { simge: false })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-metin-4">
            Artı tutar borcu artırır, eksi tutar azaltır. Ekstre en yeni hareketten başlar; CSV dosyası eskiden yeniye sıralıdır.
          </p>
        </div>
      )}

      <FisDiyalogu satisId={fisId} onKapat={() => setFisId(null)} />
    </Modal>
  );
}

/**
 * Borcun arkasındaki fiş — tablo `bilesen/fis` içinde, iki ekran ortak kullanır.
 */
function FisDiyalogu({ satisId, onKapat }: { satisId: string | null; onKapat: () => void }) {
  const { veri } = useFis(satisId);
  if (!satisId) return null;
  return (
    <Modal baslik={fisBasligi(veri ?? null)} onKapat={onKapat}>
      <FisIcerigi satisId={satisId} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Cari kartı
// ---------------------------------------------------------------------------

function CariFormu({
  cari,
  tip,
  onKapat,
  onKaydedildi,
}: {
  cari: Cari | 'yeni';
  tip: 'MUSTERI' | 'TEDARIKCI';
  onKapat: () => void;
  onKaydedildi: () => void;
}) {
  const yeniMi = cari === 'yeni';
  const mevcut = yeniMi ? null : cari;

  const [form, setForm] = useState({
    adUnvan: mevcut?.ad_unvan ?? '',
    telefon: mevcut?.telefon ?? '',
    eposta: mevcut?.eposta ?? '',
    krediLimiti: mevcut?.kredi_limiti ? paraFormat(mevcut.kredi_limiti, { simge: false }) : '',
    vadeGun: String(mevcut?.vade_gun ?? 0),
    aktif: mevcut ? mevcut.aktif_mi === 1 : true,
    rizaVar: false,
  });
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const kaydet = async () => {
    if (!form.adUnvan.trim()) {
      setHata('Ad / unvan zorunludur.');
      return;
    }
    setGonderiliyor(true);
    setHata(null);
    try {
      await api(uclar.cariler, {
        method: 'POST',
        body: JSON.stringify({
          id: mevcut?.id,
          tip: mevcut?.tip ?? tip,
          ad_unvan: form.adUnvan.trim(),
          telefon: form.telefon.trim() || null,
          eposta: form.eposta.trim() || null,
          kredi_limiti: paraParse(form.krediLimiti) ?? 0,
          vade_gun: Number(form.vadeGun) || 0,
          aktif_mi: form.aktif,
          iletisim_rizasi: form.rizaVar,
        }),
      });
      onKaydedildi();
    } catch (h) {
      setHata(h instanceof Error ? h.message : 'Kaydedilemedi.');
    } finally {
      setGonderiliyor(false);
    }
  };

  return (
    <Modal
      baslik={yeniMi ? `Yeni ${tip === 'MUSTERI' ? 'Müşteri' : 'Tedarikçi'}` : 'Cari Kartı'}
      onKapat={onKapat}
      altBilgi={
        <>
          <button type="button" className="tus-ikincil flex-1" onClick={onKapat}>
            Vazgeç
          </button>
          <button type="button" className="tus-birincil flex-1" onClick={kaydet} disabled={gonderiliyor}>
            {gonderiliyor ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="etiket">Ad / Unvan *</span>
          <input
            className="alan"
            value={form.adUnvan}
            onChange={(e) => setForm({ ...form, adUnvan: e.target.value })}
            autoFocus
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="etiket">Telefon</span>
            <input
              className="alan"
              inputMode="tel"
              value={form.telefon}
              onChange={(e) => setForm({ ...form, telefon: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="etiket">E-posta</span>
            <input
              className="alan"
              inputMode="email"
              value={form.eposta}
              onChange={(e) => setForm({ ...form, eposta: e.target.value })}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="etiket">Kredi limiti (₺)</span>
            <input
              className="alan sayi"
              inputMode="decimal"
              value={form.krediLimiti}
              onChange={(e) => setForm({ ...form, krediLimiti: e.target.value })}
            />
            <span className="mt-1 block text-xs text-metin-4">Boş / 0 = sınırsız</span>
          </label>
          <label className="block">
            <span className="etiket">Vade (gün)</span>
            <input
              className="alan sayi"
              inputMode="numeric"
              value={form.vadeGun}
              onChange={(e) => setForm({ ...form, vadeGun: e.target.value })}
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.aktif} onChange={(e) => setForm({ ...form, aktif: e.target.checked })} />
          Hesap aktif
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={form.rizaVar}
            onChange={(e) => setForm({ ...form, rizaVar: e.target.checked })}
          />
          <span>
            Bakiye bildirimi için iletişim izni var
            <span className="mt-0.5 block text-xs text-metin-4">
              KVKK açık rıza kaydıdır. İşaretlemek rızanın alındığını beyan eder; işaretlenmeden SMS/WhatsApp/e-posta
              gönderilemez.
            </span>
          </span>
        </label>

        {hata && <p className="rounded-lg border border-tehlike-cizgi bg-tehlike-yumusak px-3 py-2 text-sm text-metin">{hata}</p>}
      </div>
    </Modal>
  );
}
