/**
 * Yerel (native) SQLite ikilisini hem Node hem Electron için hazırlar.
 *
 * SORUN: `better_sqlite3.node` belirli bir ABI sürümüne göre derlenir.
 * Bu depoda iki ayrı çalışma zamanı var:
 *   - Node       → testler, seed betiği, API
 *   - Electron   → kasa uygulaması (farklı ABI)
 * Tek bir dosya ikisine birden hizmet edemez; `npm install` her seferinde Node
 * sürümünü indirir ve Electron uygulaması "modül farklı sürüme göre derlenmiş"
 * hatasıyla açılmaz.
 *
 * ÇÖZÜM: Her iki ikili de indirilip ABI numarasıyla yan yana saklanır:
 *   build/Release/better_sqlite3-abi141.node   (Node 25)
 *   build/Release/better_sqlite3-abi130.node   (Electron 33)
 * Çalışma anında `surucu.ts` `process.versions.modules` ile doğru olanı seçer.
 * Böylece dosya takası (swap) gerekmez; iki ortam aynı anda çalışır.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const gerekli = createRequire(import.meta.url);

function paketKoku(ad) {
  return dirname(gerekli.resolve(`${ad}/package.json`));
}

function abiHesapla(surum, calismaZamani) {
  try {
    const nodeAbi = gerekli('node-abi');
    return String(nodeAbi.getAbi(surum, calismaZamani));
  } catch {
    return null;
  }
}

/**
 * `prebuild-install` CLI'ını doğrudan Node ile çalıştırır.
 *
 * `npx` kullanılmaz: Windows'ta `.cmd` sarmalayıcıları `execFileSync` ile
 * çalıştırmak Node 20+ güvenlik kısıtı yüzünden EINVAL verir ve `shell: true`
 * ile çalıştırmak argüman kaçırma riski doğurur. prebuild-install zaten
 * better-sqlite3'ün bağımlılığı olduğu için yerel yolundan çağrılır.
 */
function indir(betterKok, calismaZamani, hedefSurum) {
  const binYolu = join(paketKoku('prebuild-install'), 'bin.js');
  execFileSync(
    process.execPath,
    [binYolu, '--runtime', calismaZamani, '--target', hedefSurum, '--arch', process.arch, '--platform', process.platform],
    { cwd: betterKok, stdio: 'pipe' },
  );
}

function main() {
  let betterKok;
  try {
    betterKok = paketKoku('better-sqlite3');
  } catch {
    console.log('better-sqlite3 kurulu değil, atlanıyor.');
    return;
  }

  const cikti = join(betterKok, 'build', 'Release');
  mkdirSync(cikti, { recursive: true });
  const varsayilan = join(cikti, 'better_sqlite3.node');

  const hedefler = [{ calismaZamani: 'node', surum: process.versions.node, abi: process.versions.modules }];

  // Electron kurulu değilse (ör. yalnız API dağıtımı) yalnız Node hedefi hazırlanır.
  try {
    const electronSurumu = JSON.parse(readFileSync(join(paketKoku('electron'), 'package.json'), 'utf8')).version;
    const electronAbi = abiHesapla(electronSurumu, 'electron');
    if (electronAbi) hedefler.push({ calismaZamani: 'electron', surum: electronSurumu, abi: electronAbi });
    else console.warn('Electron ABI numarası hesaplanamadı; Electron ikilisi atlanıyor.');
  } catch {
    console.log('Electron kurulu değil, yalnız Node ikilisi hazırlanıyor.');
  }

  let hata = 0;
  for (const hedef of hedefler) {
    const abiDosyasi = join(cikti, `better_sqlite3-abi${hedef.abi}.node`);
    if (existsSync(abiDosyasi)) {
      console.log(`✓ ${hedef.calismaZamani} (ABI ${hedef.abi}) zaten hazır`);
      continue;
    }
    try {
      indir(betterKok, hedef.calismaZamani, hedef.surum);
      copyFileSync(varsayilan, abiDosyasi);
      console.log(`✓ ${hedef.calismaZamani} ${hedef.surum} (ABI ${hedef.abi}) indirildi`);
    } catch (h) {
      hata++;
      const mesaj = h instanceof Error ? h.message.split('\n')[0] : String(h);
      console.warn(`✗ ${hedef.calismaZamani} ${hedef.surum} (ABI ${hedef.abi}) hazırlanamadı: ${mesaj}`);
      console.warn('  Hazır ikili yoksa kaynaktan derleme gerekir (Windows: Visual Studio Build Tools).');
    }
  }

  // Varsayılan dosyayı mevcut Node ABI'sine geri al ki `node` ile çalışan
  // betikler (test, seed, API) `nativeBinding` verilmese de doğru ikiliyi bulsun.
  const nodeAbiDosyasi = join(cikti, `better_sqlite3-abi${process.versions.modules}.node`);
  if (existsSync(nodeAbiDosyasi)) copyFileSync(nodeAbiDosyasi, varsayilan);

  if (hata > 0) process.exitCode = 0; // uyarı yeterli; uygulama yedek sürücüye düşebilir
}

main();
