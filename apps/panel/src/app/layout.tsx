import type { Metadata, Viewport } from 'next';
import './global.css';

export const metadata: Metadata = {
  title: 'Market Otomasyon — Yönetim Paneli',
  description: 'Ciro, stok, cari ve raporları her yerden izleyin.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Market Paneli', statusBarStyle: 'default' },
};

// Mobil-öncelikli (§11): telefonda "ana ekrana ekle" ile PWA gibi çalışır.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f8fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
};

/**
 * Tema, React devreye girmeden ÖNCE uygulanır: aksi hâlde koyu tema seçmiş
 * kullanıcı her sayfa açılışında bir kare beyaz görür (flash of wrong theme).
 * Kasadaki `gorunum.tema` ayarının panel karşılığıdır; localStorage'da tutulur.
 */
const TEMA_BETIGI = `
try {
  var t = localStorage.getItem('market.tema');
  if (t === 'koyu') document.documentElement.setAttribute('data-tema', 'koyu');
} catch (e) {}
`;

export default function KokDuzen({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEMA_BETIGI }} />
      </head>
      <body className="min-h-screen bg-zemin text-metin antialiased">{children}</body>
    </html>
  );
}
