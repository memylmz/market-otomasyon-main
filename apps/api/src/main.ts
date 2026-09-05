/** API giriş noktası — sunucuyu ayağa kaldırır ve zarif kapanışı yönetir. */

import { sunucuOlustur } from './sunucu.js';
import { yapilandirmayiOku } from './yapilandirma.js';

async function baslat(): Promise<void> {
  const yapilandirma = yapilandirmayiOku();
  const uygulama = await sunucuOlustur({ yapilandirma });

  // Zarif kapanış: yeni istek alma, açık istekleri bitir, bağlantıları kapat.
  const kapat = async (sinyal: string) => {
    uygulama.log.info({ sinyal }, 'Kapanış sinyali alındı');
    try {
      await uygulama.close();
      process.exit(0);
    } catch (hata) {
      uygulama.log.error({ hata }, 'Kapanış sırasında hata');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void kapat('SIGTERM'));
  process.on('SIGINT', () => void kapat('SIGINT'));

  await uygulama.listen({ port: yapilandirma.PORT, host: yapilandirma.HOST });
  uygulama.log.info(
    { port: yapilandirma.PORT, ortam: yapilandirma.NODE_ENV, db: yapilandirma.DB_URL.split('?')[0] },
    'API çalışıyor',
  );
}

baslat().catch((hata) => {
  console.error('Sunucu başlatılamadı:', hata instanceof Error ? hata.message : hata);
  process.exit(1);
});
