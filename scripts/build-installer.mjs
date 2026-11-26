// Builds release/Echopad-Setup-<version>.exe from release/win-unpacked using NSIS.
// Works on Windows, macOS and Linux (no Wine needed): makensis is fetched by electron-builder's toolset.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const sourceDir = path.join(root, 'release', 'win-unpacked');
const outFile = path.join(root, 'release', `Echopad-Setup-${version}.exe`);

if (!fs.existsSync(path.join(sourceDir, 'Echopad.exe'))) {
  console.error('release/win-unpacked/Echopad.exe not found — run electron-builder --win --dir first.');
  process.exit(1);
}

// The uninstaller removes exactly the files we ship (never a whole user-chosen directory).
const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
const lines = entries.map((e) =>
  e.isDirectory() ? `RMDir /r "$INSTDIR\\${e.name}"` : `Delete "$INSTDIR\\${e.name}"`,
);
fs.writeFileSync(path.join(root, 'installer', 'uninstall-files.nsh'), `; generated\n${lines.join('\n')}\n`);

let makensis = process.env.MAKENSIS ? { path: process.env.MAKENSIS, env: {} } : null;
if (!makensis) {
  const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows');
  makensis = await getMakeNsisPath();
}

const win = process.platform === 'win32';
const def = (k, v) => `${win ? '/' : '-'}D${k}=${v}`;
// makensis on Linux/macOS still expects Windows-style separators inside the script; it maps them.
const args = [
  def('VERSION', version),
  def('SOURCE_DIR', sourceDir),
  def('OUT_FILE', outFile),
  def('ROOT', root),
  win ? '/V2' : '-V2',
  path.join(root, 'installer', 'echopad.nsi'),
];
console.log(`• makensis ${path.basename(makensis.path)} → ${path.relative(root, outFile)}`);
const res = spawnSync(makensis.path, args, {
  stdio: 'inherit',
  env: { ...process.env, ...(makensis.env ?? {}) },
});
if (res.status !== 0) {
  console.error('makensis failed');
  process.exit(res.status ?? 1);
}
const size = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
console.log(`✓ ${path.relative(root, outFile)} (${size} MB)`);
