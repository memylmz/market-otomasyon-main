/**
 * İmleçli pull sayfalaması (§7.3) — motorun uçtan uca davranışı.
 *
 * Sürüm sayacı bulutta tüm tablolarda ortaktır: panel her ürünün ardından
 * barkodunu yazınca sürümler iç içe geçer (ürün 1, barkod 2, ürün 3…). Kasa
 * eskiden bir sonraki sayfayı gelen kayıtların en yüksek sürümünden istiyordu;
 * sınır ürünlerin ortasında dolunca daha küçük sürümlü barkodlar hiç inmiyordu.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PULL_VARLIKLARI, simdi, uuid } from '@market/shared';
import { senkronCalistir } from '../src/main/senkron/motor.js';
import { barkodlaBul } from '../src/main/depo/katalog.js';
import { durumOku } from '../src/main/depo/senkron.js';
import { testOrtamiKur, type TestOrtami } from './yardimci.js';

let ortam: TestOrtami;

beforeEach(async () => {
  ortam = await testOrtamiKur();
});

afterEach(async () => {
  await ortam.temizle();
});

type Kayit = { varlik: (typeof PULL_VARLIKLARI)[number]; versiyon: number; silindi_mi: boolean; veri: Record<string, unknown> };

/** Sunucunun imleçli sayfalamasının aynısı; sayfa sınırı küçük tutulur. */
function sahteSunucu(kayitlar: Kayit[], sayfaSiniri: number) {
  const istekler: { since: number; imlec: string | null }[] = [];
  let sunucuVersiyonu = Math.max(...kayitlar.map((k) => k.versiyon));

  const getir = (async (adres: string | URL, secenek?: RequestInit) => {
    const url = new URL(String(adres));
    const yanit = (govde: unknown) =>
      new Response(JSON.stringify(govde), { status: 200, headers: { 'content-type': 'application/json' } });

    if (url.pathname.endsWith('/sync/push')) {
      const olaylar = (JSON.parse(String(secenek?.body ?? '{}')).olaylar ?? []) as { uuid: string }[];
      return yanit({
        kabul_edilen: olaylar.map((o) => o.uuid),
        yinelenen: [],
        reddedilen: [],
        sunucu_versiyonu: 0,
        sunucu_zamani: simdi(),
      });
    }

    const since = Number(url.searchParams.get('since'));
    const imlec = url.searchParams.get('imlec');
    istekler.push({ since, imlec });
    const [basSira, imlecVersiyonu] = (imlec ?? `0:${since}`).split(':').map(Number);

    const sayfa: Kayit[] = [];
    let sonraki: string | null = null;
    for (const [sira, varlik] of PULL_VARLIKLARI.entries()) {
      if (sira < (basSira ?? 0) || sayfa.length >= sayfaSiniri) continue;
      const alt = sira === basSira ? (imlecVersiyonu ?? since) : since;
      const uygun = kayitlar
        .filter((k) => k.varlik === varlik && k.versiyon > alt)
        .sort((a, b) => a.versiyon - b.versiyon)
        .slice(0, sayfaSiniri - sayfa.length);
      sayfa.push(...uygun);
      if (sayfa.length >= sayfaSiniri) sonraki = `${sira}:${sayfa[sayfa.length - 1]?.versiyon}`;
    }

    const govde = {
      kayitlar: sayfa,
      sunucu_versiyonu: sunucuVersiyonu,
      has_more: sonraki !== null,
      imlec: sonraki,
      sunucu_zamani: simdi(),
    };
    // Sayfalama sürerken bulutta başka bir değişiklik oluyor: sürüm ilerler.
    sunucuVersiyonu += 1;
    return yanit(govde);
  }) as typeof fetch;

  return { getir, istekler };
}

describe('imleçli pull', () => {
  it('iç içe sürümlü ürün/barkodların hepsi iner; since sabit kalır, imleç ilk sayfanın sürümüne taşınır', async () => {
    const zaman = simdi();
    const kayitlar: Kayit[] = [];
    for (let i = 0; i < 3; i++) {
      const urunId = uuid();
      kayitlar.push({
        varlik: 'urunler',
        versiyon: i * 2 + 1,
        silindi_mi: false,
        veri: {
          id: urunId,
          ad: `Ürün ${i}`,
          kategori_id: null,
          marka: null,
          birim_tipi: 'ADET',
          alis_fiyati: 0,
          satis_fiyati: 1000,
          kdv_orani: 20,
          kritik_stok: 0,
          ideal_stok: 0,
          raf_konumu: null,
          aktif_mi: true,
          varsayilan_tedarikci_id: null,
          skt_takibi: false,
          notlar: null,
          created_at: zaman,
          updated_at: zaman,
          cihaz_id: 'panel',
        },
      });
      kayitlar.push({
        varlik: 'barkodlar',
        versiyon: i * 2 + 2,
        silindi_mi: false,
        veri: {
          id: uuid(),
          urun_id: urunId,
          barkod: String(500 + i),
          aktif_mi: true,
          created_at: zaman,
          updated_at: zaman,
          cihaz_id: 'panel',
        },
      });
    }

    const sunucu = sahteSunucu(kayitlar, 2);
    const sonuc = await senkronCalistir(ortam.uygulama.baglam, {
      temelUrl: 'http://sunucu.test',
      cihazToken: 'test-cihaz-tokeni-yeterince-uzun',
      getir: sunucu.getir,
    });

    expect(sonuc.basarili).toBe(true);
    for (let i = 0; i < 3; i++) expect(barkodlaBul(ortam.uygulama.baglam.vt, String(500 + i))).not.toBeNull();
    // Sayfalama boyunca since değişmez; ilk sayfa imleci "0:since"tır.
    expect(new Set(sunucu.istekler.map((i) => i.since))).toEqual(new Set([0]));
    expect(sunucu.istekler[0]?.imlec).toBe('0:0');
    // Bitişte imleç İLK sayfanın sunucu sürümüne (6) geçer; sayfalama sırasındaki değişiklikler sonraki senkronda gelir.
    expect(durumOku(ortam.uygulama.baglam.vt).last_pull_version).toBe(6);
  });
});
