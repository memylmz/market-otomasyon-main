/**
 * Sayfa düzeyi hata sınırı (§11.1).
 *
 * React'te render sırasında yakalanmayan bir hata tüm ağacı söker ve kullanıcı
 * yalnız beyaz ekran görür. Next.js App Router'da bu dosya o hatayı yakalar:
 * kök düzen ayakta kalır, kullanıcı ne olduğunu ve ne yapacağını görür.
 *
 * Kasadaki `HataSiniri` bileşeninin panel karşılığıdır; ikisi de aynı şeyi
 * söyler ki kullanıcı iki üründe farklı bir dille karşılaşmasın.
 */

'use client';

import { useEffect } from 'react';

export default function Hata({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[panel-hata]', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-tehlike-cizgi bg-yuzey p-6">
        <h1 className="text-lg font-semibold text-tehlike">Bu sayfa açılamadı</h1>
        <p className="mt-2 text-sm text-metin-2">
          Beklenmeyen bir hata oluştu. Verileriniz etkilenmedi — sayfayı yeniden yüklemek çoğu durumda yeterlidir.
        </p>
        {error.digest && <p className="mt-3 font-mono text-xs text-metin-4">İzleme: {error.digest}</p>}
        <div className="mt-4 flex gap-2">
          <button type="button" className="tus-birincil" onClick={reset}>
            Tekrar dene
          </button>
          <a className="tus-ikincil" href="/">
            Panoya dön
          </a>
        </div>
      </div>
    </div>
  );
}
