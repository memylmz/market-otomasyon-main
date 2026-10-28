/**
 * electron-builder.yml'deki sabit Electron sürümü, kurulu Electron ile aynı mı?
 *
 * Sürüm yapılandırmaya açıkça yazılıdır (çalışma alanında electron-builder onu
 * kendisi bulamıyor). Electron yükseltilip burası unutulursa paket eski
 * Electron başlığıyla derlenir ve yerel modüller (better-sqlite3) açılmaz.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

describe('paketleme yapılandırması', () => {
  it('electronVersion kurulu Electron sürümüyle aynıdır', () => {
    const yml = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8');
    const yazili = /^electronVersion:\s*(\S+)/m.exec(yml)?.[1];
    const kurulu = (createRequire(import.meta.url)('electron/package.json') as { version: string }).version;
    expect(yazili).toBe(kurulu);
  });
});
