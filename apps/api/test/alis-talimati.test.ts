/**
 * Panelden gelen alış talimatı: yeni ürün açan kalemler de taşınır.
 * Bulut ürünü YARATMAZ — belgeyi ve kartı kasa üretir; buradaki doğrulama
 * yalnız "kullanıcı hâlâ ekrandayken" hatayı göstermek içindir.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { simdi, UCLAR, uuid } from '@market/shared';
import { parolaHashle, tokenHashle } from '../src/guvenlik.js';
import { sunucuOlustur } from '../src/sunucu.js';
import { vtOlustur, type MerkezVt } from '../src/vt/baglanti.js';
import { yapilandirmayiOku } from '../src/yapilandirma.js';

let uygulama: FastifyInstance;
let vt: MerkezVt;
let geciciKlasor: string;
let token: string;

const ISLETME_ID = '11111111-1111-4111-8111-111111111111';
const TEDARIKCI_ID = '55555555-5555-4555-8555-555555555555';
const MUSTERI_ID = '66666666-6666-4666-8666-666666666666';
const CIHAZ_TOKEN = 'test-cihaz-tokeni-yeterince-uzun-1234567890';

async function girisYap(kullaniciAdi: string, sifre: string): Promise<string> {
  const yanit = await uygulama.inject({ method: 'POST', url: UCLAR.giris, payload: { kullanici_adi: kullaniciAdi, sifre } });
  return (yanit.json() as { access_token: string }).access_token;
}

/**
 * Panel girişi YALNIZ ADMIN'e token verir (`kimlik.ts`: `WHERE ... rol = 'ADMIN'`).
 * Rotadaki rol kapısını sınamak için token doğrudan imzalanır — aksi hâlde
 * "müdür geçiyor mu, kasiyer düşüyor mu" sorusu hiç sorulamaz.
 */
function rolTokeni(rol: string): string {
  return uygulama.jwt.sign({ sub: uuid(), isletme_id: ISLETME_ID, rol, kullanici_adi: 'rol-testi' });
}

function talimatGonder(govde: unknown, erisim = token) {
  return uygulama.inject({
    method: 'POST',
    url: UCLAR.alisTalimatlari,
    headers: { authorization: `Bearer ${erisim}` },
    payload: govde,
  });
}

beforeEach(async () => {
  geciciKlasor = mkdtempSync(join(tmpdir(), 'market-alis-talimat-test-'));
  vt = vtOlustur('file:' + join(geciciKlasor, 'merkez.db').replace(/\\/g, '/'));
  uygulama = await sunucuOlustur({
    yapilandirma: yapilandirmayiOku({
      NODE_ENV: 'test',
      JWT_SECRET: 'test-gizli-anahtar-en-az-otuz-iki-karakter-olmali',
      LOG_SEVIYESI: 'fatal',
    } as NodeJS.ProcessEnv),
    vt,
  });

  const zaman = simdi();
  await vt.calistir('INSERT INTO isletmeler (id, ad, lisans_anahtari, aktif_mi, created_at) VALUES (?, ?, ?, 1, ?)', [
    ISLETME_ID,
    'Test Market',
    'TEST-LISANS-0003',
    zaman,
  ]);
  await vt.calistir(
    `INSERT INTO cihazlar (id, isletme_id, cihaz_id, cihaz_adi, token_hash, aktif_mi, created_at, updated_at)
     VALUES (?, ?, 'kasa-01', 'Kasa 1', ?, 1, ?, ?)`,
    [uuid(), ISLETME_ID, tokenHashle(CIHAZ_TOKEN), zaman, zaman],
  );
  for (const [id, tip, ad] of [
    [TEDARIKCI_ID, 'TEDARIKCI', 'Toptancı A'],
    [MUSTERI_ID, 'MUSTERI', 'Ayşe Müşteri'],
  ] as const) {
    await vt.calistir(
      `INSERT INTO cariler (id, isletme_id, tip, ad_unvan, created_at, updated_at, versiyon, silindi_mi)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0)`,
      [id, ISLETME_ID, tip, ad, zaman, zaman],
    );
  }
  await vt.calistir(
    `INSERT INTO barkodlar (id, isletme_id, urun_id, barkod, aktif_mi, created_at, updated_at, versiyon, silindi_mi)
     VALUES (?, ?, ?, '8690000000017', 1, ?, ?, 1, 0)`,
    [uuid(), ISLETME_ID, uuid(), zaman, zaman],
  );
  await vt.calistir(
    `INSERT INTO panel_kullanicilari (id, isletme_id, ad, kullanici_adi, sifre_hash, rol, aktif_mi, created_at, updated_at)
     VALUES (?, ?, 'Patron', 'patron', ?, 'ADMIN', 1, ?, ?)`,
    [uuid(), ISLETME_ID, parolaHashle('Sifre1234'), zaman, zaman],
  );
  token = await girisYap('patron', 'Sifre1234');
});

afterEach(async () => {
  await uygulama?.close();
  vt?.kapat();
  try {
    if (geciciKlasor) rmSync(geciciKlasor, { recursive: true, force: true });
  } catch {
    /* Windows dosya tanıtıcıyı geç bırakabilir */
  }
});

function yeniUrunGovdesi(ek: Record<string, unknown> = {}) {
  return {
    tip: 'OLUSTUR',
    tedarikci_id: TEDARIKCI_ID,
    odenen_tutar: 0,
    kalemler: [
      {
        yeni_urun: { ad: 'Toptan Kola 1L', satis_fiyati: 2500 },
        miktar: 12_000,
        birim_fiyat: 1500,
        kdv_orani: 20,
      },
    ],
    ...ek,
  };
}

describe('alış talimatı — yeni ürün kalemleri', () => {
  it('yeni ürünlü talimatı kabul eder ve kasaya yazar', async () => {
    const yanit = await talimatGonder(yeniUrunGovdesi());
    expect(yanit.statusCode).toBe(200);

    const satir = await vt.tek<{ veri: string; hedef_cihaz_id: string }>(
      'SELECT veri, hedef_cihaz_id FROM alis_talimatlari WHERE isletme_id = ?',
      [ISLETME_ID],
    );
    expect(satir?.hedef_cihaz_id).toBe('kasa-01');
    expect(JSON.parse(String(satir?.veri)).kalemler[0].yeni_urun.ad).toBe('Toptan Kola 1L');
  });

  it('bulutta kullanımda olan barkodu reddeder', async () => {
    const yanit = await talimatGonder(
      yeniUrunGovdesi({
        kalemler: [
          {
            yeni_urun: { ad: 'Çakışan Kola', barkod: '8690000000017', satis_fiyati: 2500 },
            miktar: 1000,
            birim_fiyat: 1500,
            kdv_orani: 20,
          },
        ],
      }),
    );
    expect(yanit.statusCode).toBeGreaterThanOrEqual(400);
    expect(yanit.body).toContain('8690000000017');
  });

  it('aynı barkodu iki satırda taşıyan talimatı reddeder', async () => {
    const kalem = (barkod: string) => ({
      yeni_urun: { ad: 'Kola', barkod, satis_fiyati: 2500 },
      miktar: 1000,
      birim_fiyat: 1500,
      kdv_orani: 20,
    });
    const yanit = await talimatGonder(yeniUrunGovdesi({ kalemler: [kalem('8690000000024'), kalem('8690000000024')] }));
    expect(yanit.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('tedarikçi olmayan cariyi reddeder', async () => {
    const yanit = await talimatGonder(yeniUrunGovdesi({ tedarikci_id: MUSTERI_ID }));
    expect(yanit.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('müdür rolüne açıktır', async () => {
    const yanit = await talimatGonder(yeniUrunGovdesi(), rolTokeni('MUDUR'));
    expect(yanit.statusCode).toBe(200);
  });

  it('kasiyer rolüne kapalıdır', async () => {
    const yanit = await talimatGonder(yeniUrunGovdesi(), rolTokeni('KASIYER'));
    expect(yanit.statusCode).toBeGreaterThanOrEqual(400);
    expect(yanit.statusCode).not.toBe(200);
  });
});
