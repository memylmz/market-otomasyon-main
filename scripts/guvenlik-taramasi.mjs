/**
 * Çalışma zamanı bağımlılıklarının güvenlik taraması (§15.4) — CI kapısı.
 *
 * `npm audit --audit-level=high` istisna tanımaz: büyük sürüm atlaması isteyen
 * tek bir açık bütün CI'yı süresiz kırmızıda tutuyor, yeni bir açık da o
 * kırmızının içinde görünmez oluyordu. Bu betik yüksek/kritik açıklarda yine
 * düşer; yalnız aşağıdaki listede GEREKÇESİ ve SON TARİHİ yazılı açıkları
 * geçirir. Süresi dolan istisna da CI'yı düşürür — istisna kalıcı olamaz.
 *
 * Kullanım: node scripts/guvenlik-taramasi.mjs
 */

import { execFileSync } from 'node:child_process';

/** @type {{ paket: string; ghsa: string; sonTarih: string; gerekce: string }[]} */
const ISTISNALAR = [
  {
    paket: 'zod',
    ghsa: 'GHSA-mrhx-c7xc-m3w5',
    sonTarih: '2027-01-31',
    gerekce:
      'Yama yalnız Zod 4 hattında; Zod paylaşılan paket, API ve kasada her yerde kullanıldığı için geçiş ayrı iş. ' +
      'Saldırı çok büyük koleksiyon ister: API gövdesi 8 MB ile, push partisi 1000 olayla sınırlı.',
  },
  {
    paket: 'postcss',
    ghsa: 'GHSA-6g55-p6wh-862q',
    sonTarih: '2027-01-31',
    gerekce:
      'Next 15 kendi postcss 8.4.31 kopyasını sabitler; yalnız derleme anında projenin KENDİ CSS dosyalarını işler, ' +
      'saldırganın verdiği CSS hiç işlenmez. Next 16 geçişiyle kalkar.',
  },
  {
    paket: 'postcss',
    ghsa: 'GHSA-r28c-9q8g-f849',
    sonTarih: '2027-01-31',
    gerekce: 'Yukarıdakiyle aynı: Next içindeki derleme zamanı postcss kopyası.',
  },
];

const ESIK = new Set(['high', 'critical']);

function denetimRaporu() {
  try {
    return execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (hata) {
    // npm audit açık bulunca 1 ile çıkar; rapor yine stdout'tadır.
    if (hata && typeof hata === 'object' && 'stdout' in hata && hata.stdout) return String(hata.stdout);
    throw hata;
  }
}

const rapor = JSON.parse(denetimRaporu());
const bugun = new Date().toISOString().slice(0, 10);
const ghsaAl = (url) =>
  String(url ?? '')
    .split('/')
    .pop();

const engelleyenler = [];
const gecenler = [];
const gorulenIstisnalar = new Set();

for (const [paket, kayit] of Object.entries(rapor.vulnerabilities ?? {})) {
  for (const kaynak of kayit.via ?? []) {
    // Dize olan `via`, açığın başka bir pakette olduğunu söyler; o paket kendi kaydında ele alınır.
    if (typeof kaynak !== 'object' || !ESIK.has(kaynak.severity)) continue;
    const ghsa = ghsaAl(kaynak.url);
    const istisna = ISTISNALAR.find((i) => i.paket === paket && i.ghsa === ghsa);
    const satir = `${kaynak.severity.toUpperCase()} ${paket} ${ghsa} — ${kaynak.title}`;
    if (!istisna) engelleyenler.push(satir);
    else if (istisna.sonTarih < bugun) engelleyenler.push(`${satir} (istisnanın süresi ${istisna.sonTarih} tarihinde doldu)`);
    else {
      gecenler.push(`${satir}\n      istisna (${istisna.sonTarih}'e kadar): ${istisna.gerekce}`);
      gorulenIstisnalar.add(`${paket}:${ghsa}`);
    }
  }
}

for (const satir of gecenler) console.log(`İSTİSNA  ${satir}`);
for (const i of ISTISNALAR) {
  if (!gorulenIstisnalar.has(`${i.paket}:${i.ghsa}`)) {
    console.log(`BİLGİ    ${i.paket} ${i.ghsa} artık raporda yok — istisna listeden çıkarılabilir.`);
  }
}

if (engelleyenler.length > 0) {
  console.error('\nİstisnası olmayan yüksek/kritik açıklar:');
  for (const satir of engelleyenler) console.error(`  ${satir}`);
  process.exit(1);
}
console.log('\nGüvenlik taraması geçti: istisnası olmayan yüksek/kritik açık yok.');
