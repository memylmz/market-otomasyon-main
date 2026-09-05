/**
 * Sayfa düzeyi hata sınırı.
 *
 * React'te render sırasında yakalanmayan bir hata TÜM ağacı söker ve kullanıcı
 * yalnızca beyaz bir ekran görür (kasada en kötü senaryo). Bu sınır hatayı
 * sayfa seviyesinde durdurur: kabuk ve diğer ekranlar çalışmaya devam eder,
 * kullanıcıya ne olduğu ve ne yapacağı söylenir (§3.3 hata affı).
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Durum {
  hata: Error | null;
}

export class HataSiniri extends Component<{ children: ReactNode }, Durum> {
  override state: Durum = { hata: null };

  static getDerivedStateFromError(hata: Error): Durum {
    return { hata };
  }

  override componentDidCatch(hata: Error, bilgi: ErrorInfo): void {
    // Ana sürece log kanalı yok; geliştirici konsolunda tam iz kalsın.
    console.error('[hata-siniri]', hata, bilgi.componentStack);
  }

  override render(): ReactNode {
    if (this.state.hata) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="kart max-w-lg p-6 text-center">
            <h1 className="mb-2 text-lg font-semibold text-tehlike">Bu ekranda bir hata oluştu</h1>
            <p className="text-sm text-metin-3">
              Ekran görüntülenirken beklenmeyen bir hata yaşandı. Verileriniz güvende; kayıtlı hiçbir şey kaybolmadı. Diğer
              ekranlar çalışmaya devam ediyor.
            </p>
            <p className="mt-2 break-all font-mono text-xs text-metin-4">{this.state.hata.message}</p>
            <div className="mt-4 flex justify-center gap-2">
              <button type="button" className="tus-birincil" onClick={() => this.setState({ hata: null })}>
                Tekrar Dene
              </button>
              <button type="button" className="tus-ikincil" onClick={() => window.location.reload()}>
                Uygulamayı Yenile
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
