// Compiles native/EchopadAudio.cs → resources/bin/EchopadAudio.exe (.NET Framework 4.x, built into Windows 10/11).
// Uses the C# compiler that ships with Windows, or Mono's mcs on Linux/macOS.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'native', 'EchopadAudio.cs');
const outDir = path.join(root, 'resources', 'bin');
const out = path.join(outDir, 'EchopadAudio.exe');
fs.mkdirSync(outDir, { recursive: true });

const refs = ['System.dll', 'System.Management.dll', 'System.IO.Compression.dll', 'System.IO.Compression.FileSystem.dll'];
let compiler;
let args;
if (process.platform === 'win32') {
  const windir = process.env.WINDIR || 'C:\\Windows';
  compiler = [
    path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ].find((p) => fs.existsSync(p));
  args = ['/nologo', '/target:exe', '/platform:anycpu', '/optimize+', `/out:${out}`, ...refs.map((r) => `/r:${r}`), src];
} else {
  compiler = 'mcs';
  args = ['-target:exe', '-platform:anycpu', '-optimize+', '-sdk:4.5', `-out:${out}`, ...refs.map((r) => `-r:${r}`), src];
}
if (!compiler) {
  console.error('C# compiler not found (expected csc.exe from .NET Framework 4.x).');
  process.exit(1);
}
const res = spawnSync(compiler, args, { stdio: 'inherit' });
if (res.status !== 0) {
  console.error('Failed to compile EchopadAudio.exe');
  process.exit(res.status ?? 1);
}
console.log(`✓ ${path.relative(root, out)}`);
