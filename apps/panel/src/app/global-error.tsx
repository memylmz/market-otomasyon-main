/**
 * Kök düzenin kendisi patlarsa devreye giren son çare (§11.1).
 *
 * `error.tsx` kök düzenin İÇİNDE çalışır; düzen bileşeninin kendisi hata
 * verirse o yakalayamaz ve kullanıcı yine beyaz ekran görür. Bu dosya kendi
 * <html>/<body> etiketlerini basar, bu yüzden proje stillerine bağlı değildir
 * ve stil yüklenemediğinde bile okunur kalır.
 */

'use client';

export default function KokHata({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="tr">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#f6f8fa',
          color: '#0f172a',
        }}
      >
        <div style={{ maxWidth: '28rem', padding: '1.5rem' }}>
          <h1 style={{ fontSize: '1.125rem', margin: '0 0 0.5rem' }}>Panel açılamadı</h1>
          <p style={{ fontSize: '0.875rem', lineHeight: 1.6, margin: '0 0 1rem' }}>
            Beklenmeyen bir hata oluştu. Kasa uygulaması bundan etkilenmez; satış ve kasa işlemleri çevrimdışı çalışmaya devam
            eder.
          </p>
          {error.digest && (
            <p style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#64748b' }}>İzleme: {error.digest}</p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '0.5rem',
              padding: '0.5rem 1rem',
              border: '1px solid #0f172a',
              borderRadius: '0.375rem',
              background: '#0f172a',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Tekrar dene
          </button>
        </div>
      </body>
    </html>
  );
}
