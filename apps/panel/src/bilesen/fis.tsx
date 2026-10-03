/**
 * Satış fişinin içeriği — panelde birden çok yerden açılır (§10.7, §10.11).
 *
 * ORTAK bileşendir: Cari ekstresinde borcun arkasındaki fiş, Vardiya
 * Dökümünde nakit hareketinin arkasındaki fiş — ikisi de aynı şeyi gösterir.
 * Modal SARMALAYICISI burada YOKTUR: çağıran kendi bağlamına göre karar verir
 * (Cari ayrı pencere açar, Vardiya Dökümü aynı pencerede içerik değiştirir),
 * ama fiş tek yerde durur ki iki ekran ayrışmasın.
 */

'use client';

import Link from 'next/link';
import { tarihSaatFormat } from '@market/shared';
import { FisDurumNotlari, FisKagidi, IadeDokumu, type FisKagidiVerisi } from './fis-kagidi';
import { BosDurum, HataKutusu, Yukleniyor } from './kabuk';
import { uclar } from '@/lib/api';
import { useVeri } from '@/lib/kanca';

/** Fiş detayı — çizim için gereken alanlar `FisKagidiVerisi`de. */
export type FisVerisi = FisKagidiVerisi;

/** Fişin başlığı — çağıran pencere başlığında kullanabilsin diye ayrı. */
export function fisBasligi(veri: FisVerisi | null): string {
  return veri?.satis ? `Fiş ${veri.satis.fis_no}` : 'Fiş';
}

export function useFis(satisId: string | null) {
  return useVeri<FisVerisi>(satisId ? `${uclar.satislar}/${satisId}` : null);
}

export function FisIcerigi({ satisId }: { satisId: string }) {
  const { veri, yukleniyor, hata } = useFis(satisId);

  if (yukleniyor) return <Yukleniyor />;
  if (hata) return <HataKutusu mesaj={hata} />;
  if (!veri?.satis) {
    return (
      <BosDurum
        baslik="Fiş bulunamadı"
        aciklama="Bu hareket bir satıştan doğmamış ya da fiş henüz merkeze senkronlanmamış olabilir."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-metin-3">
        {tarihSaatFormat(veri.satis.tarih)} · Müşteri: {veri.satis.musteri_adi ?? 'Perakende'}
      </p>
      <FisDurumNotlari veri={veri} />
      {/* Fişin kendisi: kasanın yazdırdığı kağıdın aynısı. */}
      <FisKagidi veri={veri} />
      <IadeDokumu veri={veri} />

      {/*
        Bu içerik SALT OKUNURDUR. İade tek yerden, Satışlar sayfasından
        başlatılır; aynı satışa birden çok ekrandan işlem yapılabilmesi
        karışıklık üretir.
      */}
      {veri.satis.iptal_mi !== 1 && (
        <Link href={`/satislar?fis=${encodeURIComponent(satisId)}`} className="inline-block text-sm text-vurgu hover:underline">
          İade işlemleri için Satışlar&apos;da aç →
        </Link>
      )}
    </div>
  );
}
