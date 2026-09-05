/**
 * Demo/ilk kurulum verisi üretir: işletme, lisans anahtarı ve panel yöneticisi.
 *
 * Kullanım:
 *   npm run seed -w @market/api
 *   npm run seed -w @market/api -- --isletme "Market Adı" --kullanici patron --sifre "Guclu1234"
 */

import { randomBytes } from 'node:crypto';
import { simdi, uuid } from '@market/shared';
import { parolaHashle } from '../src/guvenlik.js';
import { semayiHazirla, vtOlustur } from '../src/vt/baglanti.js';
import { yapilandirmayiOku } from '../src/yapilandirma.js';

function argOku(ad: string, varsayilan: string): string {
  const index = process.argv.indexOf(`--${ad}`);
  return index >= 0 ? (process.argv[index + 1] ?? varsayilan) : varsayilan;
}

function lisansAnahtariUret(): string {
  const ham = randomBytes(10).toString('hex').toUpperCase();
  return (ham.match(/.{1,5}/g) ?? []).join('-');
}

async function calistir(): Promise<void> {
  const yapilandirma = yapilandirmayiOku();
  const vt = vtOlustur(yapilandirma.DB_URL, yapilandirma.DB_AUTH_TOKEN);
  await semayiHazirla(vt);

  const isletmeAdi = argOku('isletme', 'Demo Market');
  const kullaniciAdi = argOku('kullanici', 'patron');
  const sifre = argOku('sifre', 'Demo1234');

  const mevcut = await vt.tek<{ id: string; lisans_anahtari: string }>(
    'SELECT id, lisans_anahtari FROM isletmeler WHERE ad = ?',
    [isletmeAdi],
  );

  if (mevcut) {
    console.log(`İşletme zaten var: ${isletmeAdi}`);
    console.log(`Lisans anahtarı: ${mevcut.lisans_anahtari}`);
    vt.kapat();
    return;
  }

  const isletmeId = uuid();
  const lisans = lisansAnahtariUret();
  const zaman = simdi();

  await vt.islem(async (islem) => {
    await islem.calistir(
      'INSERT INTO isletmeler (id, ad, lisans_anahtari, lisans_bitis, aktif_mi, created_at) VALUES (?, ?, ?, NULL, 1, ?)',
      [isletmeId, isletmeAdi, lisans, zaman],
    );
    await islem.calistir(
      `INSERT INTO panel_kullanicilari (id, isletme_id, ad, kullanici_adi, sifre_hash, rol, aktif_mi, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'ADMIN', 1, ?, ?)`,
      [uuid(), isletmeId, 'İşletme Sahibi', kullaniciAdi, parolaHashle(sifre), zaman, zaman],
    );
    await islem.calistir('INSERT INTO versiyon_sayaci (isletme_id, sonraki) VALUES (?, 1)', [isletmeId]);
  });

  console.log('─'.repeat(60));
  console.log('Kurulum tamamlandı.');
  console.log(`  İşletme        : ${isletmeAdi}`);
  console.log(`  İşletme kimliği: ${isletmeId}`);
  console.log(`  Panel kullanıcı: ${kullaniciAdi}`);
  console.log(`  Panel şifresi  : ${sifre}   ← ilk girişte değiştirin`);
  console.log(`  LİSANS ANAHTARI: ${lisans}`);
  console.log('─'.repeat(60));
  console.log('Kasadan Ayarlar → Senkron → "Cihazı Aktive Et" adımında bu lisans anahtarını kullanın.');

  vt.kapat();
}

calistir().catch((hata) => {
  console.error('Seed başarısız:', hata instanceof Error ? hata.message : hata);
  process.exit(1);
});
