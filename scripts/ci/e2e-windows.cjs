// CI only: drives the packaged Echopad.exe on a real Windows VM and checks what it concludes.
// VB-CABLE is installed by the workflow with VB-Audio's own installer; this script checks
// Echopad's detection, configuration and repair diagnosis against real Windows.
const { _electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const exe = path.resolve('release/win-unpacked/Echopad.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const expect = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!cond) failures.push(msg);
};

async function scenario(name, { state } = {}) {
  console.log(`\n========== SCENARIO: ${name} ==========`);
  const ud = path.resolve(`e2e-${name}`);
  fs.rmSync(ud, { recursive: true, force: true });
  fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'library.json'), JSON.stringify({ version: 1, sounds: [], settings: { onboarded: true } }));
  if (state) fs.writeFileSync(path.join(ud, 'system-state.json'), JSON.stringify(state));
  const app = await _electron.launch({ executablePath: exe, env: { ...process.env, ECHOPAD_USER_DATA: ud }, timeout: 90000 });
  const win = await app.firstWindow();
  const t0 = Date.now();
  let report = null;
  while (Date.now() - t0 < 120000) {
    report = await win.evaluate(() => window.echopad.systemLast()).catch(() => null);
    if (report?.checks?.length && report.phase !== 'installing') break;
    await sleep(2000);
  }
  await sleep(6000); // let one more check + the renderer's routing settle
  await win.locator('.nav-item', { hasText: 'Health' }).click();
  await sleep(1500);
  const rows = await win.locator('.check-row').evaluateAll((els) =>
    els.map((e) => ({
      status: e.className.replace('check-row', '').trim(),
      title: e.querySelector('.check-title')?.textContent,
      detail: e.querySelector('.check-detail')?.textContent,
      fix: e.querySelector('button')?.textContent || null,
    })),
  );
  await win.screenshot({ path: `e2e-${name}.png` });
  const diag = await win.evaluate(() => window.echopad.copyDiagnostics());
  console.log(`---- Health page (${name}) ----`);
  for (const r of rows) console.log(`  [${r.status}] ${r.title}: ${r.detail}${r.fix ? `  <${r.fix}>` : ''}`);
  console.log(`---- diagnostics (${name}) ----\n${diag.split('\n--- Echopad log')[0]}`);
  console.log(`---- Echopad log (${name}) ----\n${diag.split('--- Echopad log (latest) ---')[1] || ''}`);
  await app.close();
  return Object.fromEntries(rows.map((r) => [r.title, r]));
}

function vbInstallSilently() {
  // Test VM only: VB-Audio's installer in its own silent mode, standing in for the user's "Install Driver" click.
  console.log(execSync('powershell -NoProfile -Command "$p = Start-Process vb\\VBCABLE_Setup_x64.exe -ArgumentList \'-i\',\'-h\' -WorkingDirectory vb -PassThru -Wait; $p.ExitCode"', { encoding: 'utf8' }));
}

(async () => {
  // 1. Driver installed and working.
  let r = await scenario('installed');
  expect(r['Virtual microphone driver']?.status === 'ok', 'installed: driver check is ok');
  expect(r['Windows default microphone']?.status === 'ok', 'installed: virtual mic is the Windows default');
  expect(r['Sounds routed to the call']?.status === 'ok', 'installed: sounds are routed into the cable');

  // 2. The user's situation: driver package + service present, device removed.
  console.log(execSync('pnputil /remove-device ROOT\\MEDIA\\0000', { encoding: 'utf8' }));
  await sleep(5000);
  r = await scenario('half-installed', {
    // Installed during an earlier boot; automatic repair already used today (so no installer pops up in CI).
    state: { setupStarted: 1, driverInstalledAt: 1000, autoRepairAt: Date.now() },
  });
  const d = r['Virtual microphone driver'];
  expect(d?.status === 'error', 'half-installed: driver check is an error (not "restart")');
  expect(/partly installed/i.test(d?.detail || ''), 'half-installed: says the driver is only partly installed');
  expect(/repair/i.test(d?.fix || ''), 'half-installed: offers Repair driver');

  // 3. Repair = run VB-Audio's installer again (what the user's click does).
  vbInstallSilently();
  await sleep(10000);
  r = await scenario('repaired', { state: { setupStarted: 1, driverInstalledAt: 1000, autoRepairAt: Date.now() } });
  expect(r['Virtual microphone driver']?.status === 'ok', 'repaired: driver check is ok again');
  expect(r['Windows default microphone']?.status === 'ok', 'repaired: virtual mic is the Windows default');

  console.log(`\n${failures.length ? `FAILED (${failures.length}):\n - ${failures.join('\n - ')}` : 'ALL CHECKS PASSED'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
