// CI only: drives the packaged Echopad.exe on a real Windows VM and prints what it concludes.
const { _electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const exe = path.resolve('release/win-unpacked/Echopad.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scenario(name, { timeoutMs = 300000, state } = {}) {
  console.log(`\n========== SCENARIO: ${name} ==========`);
  const ud = path.resolve(`e2e-${name}`);
  fs.rmSync(ud, { recursive: true, force: true });
  fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'library.json'), JSON.stringify({ version: 1, sounds: [], settings: { onboarded: false } }));
  if (state) fs.writeFileSync(path.join(ud, 'system-state.json'), JSON.stringify(state));
  const app = await _electron.launch({ executablePath: exe, env: { ...process.env, ECHOPAD_USER_DATA: ud }, timeout: 90000 });
  const win = await app.firstWindow();
  const t0 = Date.now();
  let report = null;
  let last = '';
  while (Date.now() - t0 < timeoutMs) {
    report = await win.evaluate(() => window.echopad.systemLast()).catch(() => null);
    const sig = JSON.stringify([report?.phase, report?.phaseMessage, (report?.checks || []).map((c) => [c.id, c.status])]);
    if (sig !== last) {
      last = sig;
      console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${sig}`);
    }
    const d = report?.checks?.find((c) => c.id === 'driver');
    if (d?.status === 'ok' && report.phase !== 'installing') break;
    await sleep(3000);
  }
  await sleep(4000);
  report = await win.evaluate(() => window.echopad.systemLast());
  await win.screenshot({ path: `e2e-${name}.png` });
  const diag = await win.evaluate(() => window.echopad.copyDiagnostics());
  console.log(`---- final checks (${name}) ----`);
  for (const c of report.checks) console.log(`  [${c.status}] ${c.title}: ${c.detail}`);
  console.log(`---- diagnostics (${name}) ----\n${diag}`);
  await app.close();
  return report.checks.find((c) => c.id === 'driver')?.status === 'ok';
}

(async () => {
  const results = {};
  results.fresh = await scenario('fresh-install');
  // Recreate the user's situation: driver package + service present, but the device itself removed.
  try {
    console.log(execSync('pnputil /remove-device ROOT\\MEDIA\\0000', { encoding: 'utf8' }));
  } catch (e) {
    console.log('remove-device failed', e.message);
  }
  await sleep(5000);
  results.halfInstalled = await scenario('half-installed', { state: { setupStarted: 1, driverInstalledAt: 1000 } });
  console.log('\nRESULTS', JSON.stringify(results));
  process.exit(results.fresh && results.halfInstalled ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
