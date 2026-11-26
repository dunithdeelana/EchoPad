'use strict';
/**
 * Automatic Windows audio setup + self-healing for Echopad.
 *
 * Responsibilities
 *  - Detect / install the virtual audio cable (VB-CABLE, via VB-Audio's own signed installer).
 *  - Make the virtual mic ("CABLE Output") the Windows default recording device while Echopad runs,
 *    so Discord (Input Device = Default) hears voice + sounds with no configuration, and restore
 *    the user's real microphone when Echopad quits.
 *  - Keep the user's speakers as the default playback device.
 *  - Allow desktop apps to use the microphone.
 *  - Detect which microphone Discord is actually recording from.
 *
 * All Windows calls go through resources/bin/EchopadAudio.exe (see native/EchopadAudio.cs).
 * On other platforms this module is inert unless ECHOPAD_FAKE_SYSTEM=1, which simulates Windows for testing.
 */
const { app, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { execFile } = require('node:child_process');

const CABLE_PAGE = 'https://vb-audio.com/Cable/';
const KNOWN_PACKS = [
  'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack46.zip',
  'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip',
  'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack43.zip',
];
const STATE_ACTIVE = 1;
const STATE_DISABLED = 2;

const STATE_NOTPRESENT = 4;
const isCableRender = (n) => /\bcable in(put)?\b/i.test(n) || (/vb-audio virtual cable/i.test(n) && !/cable output/i.test(n));
const isCableCapture = (n) => /\bcable output\b/i.test(n) || (/vb-audio virtual cable/i.test(n) && !/cable in/i.test(n));
/** Best matching cable endpoint: active first, then the standard "CABLE Input/Output" over e.g. "CABLE In 16 Ch". */
function findCable(list, match, preferred) {
  return list
    .filter((e) => match(e.name))
    .sort((a, b) => (b.state === STATE_ACTIVE) - (a.state === STATE_ACTIVE) || preferred.test(b.name) - preferred.test(a.name))[0];
}
const PNP_ERRORS = {
  1: 'the device is not configured correctly',
  10: 'the device cannot start',
  18: 'the driver needs to be reinstalled',
  19: 'its configuration in the registry is damaged',
  21: 'Windows is removing the device',
  22: 'the device is disabled in Device Manager',
  24: 'the device is not present or not working',
  28: 'its drivers are not installed',
  31: 'Windows cannot load its driver',
  37: 'Windows cannot initialize its driver',
  39: 'its driver is missing or damaged',
  43: 'Windows stopped the device after it reported problems',
  45: 'the device is not connected',
  48: 'Windows blocked its driver because of known problems',
  52: 'Windows could not verify its driver signature',
};
const isVirtual = (n) => /vb-audio|voicemeeter|virtual|cable (input|output)|stereo mix/i.test(n);
const isDiscord = (p) => /^discord(ptb|canary|development)?$/i.test(p || '');

// ---------------------------------------------------------------------------
// Persistent state (remembers the user's real devices)
// ---------------------------------------------------------------------------
const stateFile = () => path.join(app.getPath('userData'), 'system-state.json');
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return {};
  }
}
function saveState(s) {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Helper process
// ---------------------------------------------------------------------------
function helperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'EchopadAudio.exe')
    : path.join(__dirname, '..', 'resources', 'bin', 'EchopadAudio.exe');
}

function runHelper(args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(helperPath(), args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      const text = String(stdout || '').trim().split(/\r?\n/).pop() || '';
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve({ ok: false, error: err ? err.message : 'helper returned no data' });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Simulated Windows (for development on Linux/macOS: ECHOPAD_FAKE_SYSTEM=1)
// ---------------------------------------------------------------------------
function createFakeWindows() {
  const sim = {
    driver: process.env.ECHOPAD_FAKE_DRIVER === '1',
    render: [
      { id: 'r-spk', name: 'Speakers (Realtek(R) Audio)', state: 1 },
      { id: 'r-hs', name: 'Headphones (HyperX Cloud II)', state: 1 },
    ],
    capture: [{ id: 'c-mic', name: 'Microphone (HyperX Cloud II)', state: 1 }],
    defRender: 'r-hs',
    defCapture: 'c-mic',
    privacy: { user: 'Allow', desktop: process.env.ECHOPAD_FAKE_PRIVACY || 'Allow', machine: 'Allow' },
    discordOn: process.env.ECHOPAD_FAKE_DISCORD || '', // '' | 'default' | 'mic'
  };
  // ECHOPAD_FAKE_BROKEN=52 → driver installed but the device fails with that Device Manager code; 'incomplete' → files only
  const broken = process.env.ECHOPAD_FAKE_BROKEN;
  if (broken === 'incomplete') sim.serviceOnly = true;
  else if (broken) sim.pnpError = Number(broken);
  const addCable = () => {
    sim.render.push({ id: 'r-cable', name: 'CABLE Input (VB-Audio Virtual Cable)', state: 1 });
    sim.capture.push({ id: 'c-cable', name: 'CABLE Output (VB-Audio Virtual Cable)', state: 1 });
    // Like the real installer, VB-CABLE sometimes grabs the defaults.
    sim.defRender = 'r-cable';
    sim.defCapture = 'c-cable';
  };
  if (sim.driver) addCable();
  const ep = (list, def) => list.map((e) => ({ ...e, defaults: [e.id === def, e.id === def, e.id === def] }));
  return async (args) => {
    await new Promise((r) => setTimeout(r, 120));
    const [cmd, arg] = args;
    if (cmd === 'status') {
      const sessions = [];
      if (sim.discordOn) {
        const dev = sim.discordOn === 'mic' ? 'c-mic' : sim.defCapture;
        const d = sim.capture.find((c) => c.id === dev);
        sessions.push({ deviceId: dev, deviceName: d?.name, pid: 4242, process: 'Discord', active: true });
      }
      return {
        ok: true,
        render: ep(sim.render, sim.defRender),
        capture: ep(sim.capture, sim.defCapture),
        sessions,
        micPrivacy: sim.privacy,
        driverService: sim.driver || !!sim.serviceOnly,
        driverFile: sim.driver || !!sim.serviceOnly,
        pnp: sim.pnpError !== undefined
          ? [{ name: 'VB-Audio Virtual Cable', id: 'ROOT\\MEDIA\\0001', status: sim.pnpError ? 'Error' : 'OK', error: sim.pnpError }]
          : [],
        os: 'Microsoft Windows NT 10.0.26100.0 (simulated)',
      };
    }
    if (cmd === 'set-default') {
      if (sim.render.some((e) => e.id === arg)) sim.defRender = arg;
      else sim.defCapture = arg;
      return { ok: true };
    }
    if (cmd === 'enable') return { ok: true };
    if (cmd === 'enable-pnp') {
      sim.pnpError = 0;
      addCable();
      return { ok: true, exitCode: 0 };
    }
    if (cmd === 'fix-mic-privacy') {
      sim.privacy = { ...sim.privacy, user: 'Allow', desktop: 'Allow' };
      return { ok: true };
    }
    if (cmd === 'run-installer') {
      await new Promise((r) => setTimeout(r, 1500));
      if (process.env.ECHOPAD_FAKE_INSTALL === 'fail') return { ok: false, error: 'signature' };
      if (sim.pnpError || sim.serviceOnly) {
        // Reinstall repairs the broken device.
        sim.pnpError = undefined;
        sim.serviceOnly = false;
        addCable();
        sim.driver = true;
        return { ok: true, exitCode: 0, signer: 'CN=Vincent Burel' };
      }
      if (process.env.ECHOPAD_FAKE_INSTALL === 'reboot') {
        sim.serviceOnly = true; // driver installed, devices appear only after a restart
        return { ok: true, exitCode: 0, signer: 'CN=Vincent Burel' };
      }
      addCable();
      sim.driver = true;
      return { ok: true, exitCode: 0, signer: 'CN=Vincent Burel' };
    }
    return { ok: false, error: 'unknown' };
  };
}

// ---------------------------------------------------------------------------
// System controller
// ---------------------------------------------------------------------------
class SystemController {
  constructor(onReport) {
    this.onReport = onReport;
    this.supported = process.platform === 'win32' || process.env.ECHOPAD_FAKE_SYSTEM === '1';
    this.exec = process.platform === 'win32' ? runHelper : createFakeWindows();
    this.state = loadState();
    this.log = [];
    this.installing = false;
    this.installAttempted = false;
    this.lastReport = null;
    this.running = null;
    this.takeover = true; // make the virtual mic the default while Echopad runs
  }

  addLog(text, kind = 'fix') {
    this.log.unshift({ at: Date.now(), text, kind });
    this.log = this.log.slice(0, 40);
  }

  // ------------------------------------------------------------------ driver install
  async findPackUrl() {
    try {
      const res = await net.fetch(CABLE_PAGE);
      const html = await res.text();
      const found = [...html.matchAll(/https?:\/\/download\.vb-audio\.com\/Download_CABLE\/VBCABLE_Driver_Pack(\d+)\.zip/g)]
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map((m) => m[0].replace(/^http:/, 'https:'));
      if (found.length) return [found[0], ...KNOWN_PACKS];
    } catch {
      /* fall back to known packs */
    }
    return KNOWN_PACKS;
  }

  async downloadPack(progress) {
    const dir = path.join(app.getPath('userData'), 'downloads');
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'VBCABLE_Driver_Pack.zip');
    let lastErr = 'download failed';
    for (const url of await this.findPackUrl()) {
      try {
        progress?.(`Downloading the virtual audio driver from vb-audio.com…`);
        const res = await net.fetch(url);
        if (!res.ok) {
          lastErr = `HTTP ${res.status}`;
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 100_000 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
          lastErr = 'unexpected file';
          continue;
        }
        await fsp.writeFile(file, buf);
        return file;
      } catch (err) {
        lastErr = String(err?.message || err);
      }
    }
    throw new Error(lastErr);
  }

  /** Download VB-CABLE and run VB-Audio's own installer (user approves UAC + clicks "Install Driver"). */
  async installDriver(progress) {
    if (this.installing) return { ok: false, error: 'busy' };
    this.installing = true;
    this.installAttempted = true;
    this.emitPhase('installing', 'Downloading the virtual audio driver…');
    try {
      const zip =
        process.platform === 'win32' ? await this.downloadPack((m) => this.emitPhase('installing', m)) : 'fake.zip';
      this.emitPhase('installing', 'Approve the Windows prompt, then click “Install Driver” in the VB-Audio window.');
      const res = await this.exec(['run-installer', zip], 15 * 60 * 1000);
      if (!res.ok) {
        const msg =
          res.error === 'cancelled'
            ? 'The Windows permission prompt was declined.'
            : res.error === 'signature'
              ? 'The downloaded driver failed its signature check, so it was not installed.'
              : `Driver setup failed: ${res.error}`;
        this.addLog(msg, 'error');
        this.state.lastInstallError = msg;
        // Don't re-open the installer on every launch if the user said no; the Health page offers it again.
        if (res.error === 'cancelled') this.state.autoInstallDeclined = true;
        saveState(this.state);
        return { ok: false, error: msg };
      }
      this.state.autoInstallDeclined = false;
      this.state.lastInstallError = '';
      this.addLog('Installed the VB-CABLE virtual audio driver (signed by VB-Audio).');
      this.state.driverInstalledAt = Date.now();
      saveState(this.state);
      // Devices usually appear within seconds; give Windows time to register them.
      this.emitPhase('installing', 'Waiting for Windows to register the virtual microphone…');
      for (let i = 0; i < 20; i++) {
        const st = await this.exec(['status']);
        if (st.ok && st.capture.some((c) => isCableCapture(c.name) && c.state === STATE_ACTIVE)) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      return { ok: true };
    } catch (err) {
      const msg = `Couldn't download the driver: ${err.message}. Check your internet connection.`;
      this.addLog(msg, 'error');
      this.state.lastInstallError = msg;
      saveState(this.state);
      return { ok: false, error: msg };
    } finally {
      this.installing = false;
      // Call the implementation directly: installDriver may run inside a check() already in progress.
      await this._check({ autoFix: true });
    }
  }

  emitPhase(phase, message) {
    const base = this.lastReport || { checks: [] };
    const report = { ...base, supported: true, phase, phaseMessage: message, log: this.log };
    this.lastReport = report;
    this.onReport(report);
  }

  // ------------------------------------------------------------------ health check + auto repair
  check(opts = {}) {
    if (this.running) return this.running;
    this.running = this._check(opts).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async _check({ autoFix = true, firstRun = false } = {}) {
    if (!this.supported) {
      const report = { supported: false, phase: 'ready', checks: [], log: this.log };
      this.lastReport = report;
      this.onReport(report);
      return report;
    }

    let st = await this.exec(['status']);
    if (!st.ok) {
      const report = {
        supported: true,
        phase: 'error',
        checks: [{ id: 'helper', status: 'error', title: 'Windows audio service', detail: st.error || 'unavailable' }],
        log: this.log,
      };
      this.lastReport = report;
      this.onReport(report);
      return report;
    }

    const fixes = [];
    const realCaptures = () => st.capture.filter((c) => c.state === STATE_ACTIVE && !isVirtual(c.name));
    const realRenders = () => st.render.filter((r) => r.state === STATE_ACTIVE && !isVirtual(r.name));

    // Remember the user's real devices before we change anything.
    const defCap = st.capture.find((c) => c.defaults[0]);
    const defRen = st.render.find((r) => r.defaults[0]);
    if (defCap && !isVirtual(defCap.name)) this.state.realMic = { id: defCap.id, name: defCap.name };
    if (defRen && !isVirtual(defRen.name)) this.state.realSpeaker = { id: defRen.id, name: defRen.name };

    this.lastRaw = st;
    let cableRender = findCable(st.render, isCableRender, /cable input/i);
    let cableCapture = findCable(st.capture, isCableCapture, /cable output/i);

    // 1. Disabled virtual devices → re-enable.
    if (autoFix) {
      for (const dev of [cableRender, cableCapture]) {
        if (dev && dev.state === STATE_DISABLED) {
          const r = await this.exec(['enable', dev.id]);
          if (r.ok) fixes.push(`Re-enabled “${dev.name}”, which was disabled in Windows.`);
        }
      }
    }

    // ---- What state is the driver in? (installed / restart pending / broken / disabled / missing)
    const bootTime = Date.now() - os.uptime() * 1000;
    const installedThisBoot = !!this.state.driverInstalledAt && this.state.driverInstalledAt > bootTime;
    const pnpDev = (st.pnp || []).find((d) => /VBAUDIOVAC/i.test(d.id || '') || /vb-audio virtual cable/i.test(d.name || ''));
    const pnpError = pnpDev ? Number(pnpDev.error) || 0 : 0;
    const endpointsActive = cableRender?.state === STATE_ACTIVE && cableCapture?.state === STATE_ACTIVE;
    const driverTraces = !!pnpDev || st.driverService === true || st.driverFile === true;
    let driverState = 'missing';
    if (endpointsActive) driverState = 'ok';
    else if (pnpError === 22) driverState = 'disabled';
    else if (pnpError) driverState = 'broken';
    else if (installedThisBoot) driverState = 'restart';
    else if (driverTraces || cableRender || cableCapture) driverState = 'incomplete';

    // Disabled in Device Manager → turn it back on (Windows asks for approval once).
    if (autoFix && driverState === 'disabled' && !this.enableAttempted) {
      this.enableAttempted = true;
      const r = await this.exec(['enable-pnp', pnpDev.id], 120000);
      if (r.ok) {
        this.addLog('Turned the VB-CABLE device back on (it was disabled in Device Manager).');
        return this._check({ autoFix, firstRun: false });
      }
    }

    // Broken or half-installed driver → run VB-Audio's installer again once (it repairs in place).
    const repairDue = !this.state.autoRepairAt || Date.now() - this.state.autoRepairAt > 24 * 3600 * 1000;
    if (autoFix && (driverState === 'broken' || driverState === 'incomplete') && repairDue && !this.installAttempted) {
      this.state.autoRepairAt = Date.now();
      saveState(this.state);
      this.addLog(
        driverState === 'broken'
          ? `VB-CABLE is installed but ${PNP_ERRORS[pnpError] || `reports error ${pnpError}`}. Reinstalling it.`
          : 'VB-CABLE is only partly installed. Reinstalling it.',
        'info',
      );
      await this.installDriver();
      return this.lastReport;
    }

    // 2. Driver missing → install automatically on first run.
    if (driverState === 'missing' && autoFix && firstRun && !this.installAttempted) {
      await this.installDriver();
      return this.lastReport;
    }

    // 3. Speakers: never leave the cable as the default playback device.
    if (autoFix && cableRender && defRen && defRen.id === cableRender.id) {
      const target =
        realRenders().find((r) => r.id === this.state.realSpeaker?.id) ||
        realRenders().find((r) => r.name === this.state.realSpeaker?.name) ||
        realRenders()[0];
      if (target) {
        const r = await this.exec(['set-default', target.id]);
        if (r.ok) fixes.push(`Set “${target.name}” back as your speakers (the cable had taken over your sound).`);
      }
    }

    // 4. Virtual mic as Windows default recording device, so apps on "Default" hear Echopad.
    if (autoFix && this.takeover && cableCapture && cableCapture.state === STATE_ACTIVE) {
      const allDefault = cableCapture.defaults.every(Boolean);
      if (!allDefault) {
        const r = await this.exec(['set-default', cableCapture.id]);
        if (r.ok) fixes.push('Made Echopad’s virtual microphone the default so Discord hears your voice and sounds.');
      }
    }

    // 5. Microphone privacy for desktop apps (current user).
    const priv = st.micPrivacy || {};
    if (autoFix && (priv.user === 'Deny' || priv.desktop === 'Deny')) {
      const r = await this.exec(['fix-mic-privacy']);
      if (r.ok) fixes.push('Allowed desktop apps to use your microphone in Windows privacy settings.');
    }

    if (fixes.length) {
      fixes.forEach((f) => this.addLog(f));
      st = (await this.exec(['status'])) || st;
      this.lastRaw = st;
      cableRender = findCable(st.render, isCableRender, /cable input/i);
      cableCapture = findCable(st.capture, isCableCapture, /cable output/i);
    }
    saveState(this.state);

    // ---------------------------------------------------------------- build report
    const checks = [];
    const lastError = this.state.lastInstallError;
    const driverActive = endpointsActive;
    const DRIVER = {
      ok: ['ok', 'VB-CABLE is installed and working.', null],
      restart: [
        'warn',
        'The driver was just installed. Restart your PC to finish; Echopad starts with Windows and completes the setup by itself.',
        'restart',
      ],
      disabled: ['warn', 'The VB-CABLE device is disabled in Windows Device Manager.', 'enable-device'],
      broken: [
        'error',
        `VB-CABLE is installed, but ${PNP_ERRORS[pnpError] || `Windows reports error code ${pnpError}`} (code ${pnpError}). Repair reinstalls it with VB-Audio's installer.`,
        'repair-driver',
      ],
      incomplete: [
        'error',
        'VB-CABLE is only partly installed: Windows has its driver files but no working virtual microphone. Repair reinstalls it: approve the Windows prompt, then click “Install Driver”.',
        'repair-driver',
      ],
      missing: [
        'error',
        lastError
          ? `Last attempt failed: ${lastError} Click Install now to try again.`
          : 'Not installed yet. Click Install now: approve the Windows prompt, then click “Install Driver”.',
        'install-driver',
      ],
    }[driverState];
    checks.push({ id: 'driver', title: 'Virtual microphone driver', status: DRIVER[0], detail: DRIVER[1], fix: DRIVER[2] });

    const defRen2 = st.render.find((r) => r.defaults[0]);
    checks.push({
      id: 'speakers',
      title: 'Your speakers',
      status: defRen2 && cableRender && defRen2.id === cableRender.id ? 'warn' : 'ok',
      detail: defRen2 ? `Windows plays sound through “${defRen2.name}”.` : 'No playback device found.',
      fix: null,
    });

    const realMicList = realCaptures();
    checks.push({
      id: 'mic',
      title: 'Your microphone',
      status: realMicList.length ? 'ok' : 'error',
      detail: realMicList.length
        ? `Echopad mixes “${this.state.realMic?.name || realMicList[0].name}” into the call.`
        : 'No microphone found. Plug in your headset or microphone.',
      fix: null,
    });

    const priv2 = st.micPrivacy || {};
    const privacyBlocked = priv2.machine === 'Deny' || priv2.user === 'Deny' || priv2.desktop === 'Deny';
    checks.push({
      id: 'privacy',
      title: 'Microphone permission',
      status: privacyBlocked ? 'error' : 'ok',
      detail:
        priv2.machine === 'Deny'
          ? 'Microphone access is turned off for this whole PC. Turn on “Microphone access” in Windows Settings → Privacy & security → Microphone (needs an administrator).'
          : privacyBlocked
            ? 'Windows is blocking desktop apps from the microphone.'
            : 'Desktop apps may use the microphone.',
      fix: privacyBlocked && priv2.machine !== 'Deny' ? 'fix-privacy' : priv2.machine === 'Deny' ? 'open-privacy' : null,
    });

    const cableIsDefault = !!cableCapture && cableCapture.defaults.every(Boolean);
    checks.push({
      id: 'default-mic',
      title: 'Windows default microphone',
      status: !driverActive ? 'pending' : cableIsDefault ? 'ok' : 'warn',
      detail: !driverActive
        ? 'Waiting for the driver.'
        : cableIsDefault
          ? 'Echopad’s virtual microphone is the default, so apps set to “Default” hear you and your sounds.'
          : 'Echopad could not make its virtual microphone the default.',
      fix: driverActive && !cableIsDefault ? 'retry' : null,
    });

    const discord = (st.sessions || []).filter((s) => isDiscord(s.process));
    const discordActive = discord.filter((s) => s.active);
    const discordOnCable = discordActive.some((s) => cableCapture && s.deviceId === cableCapture.id);
    const discordElsewhere = discordActive.find((s) => !cableCapture || s.deviceId !== cableCapture.id);
    checks.push({
      id: 'discord',
      title: 'Discord',
      status: discordOnCable ? 'ok' : discordElsewhere ? 'warn' : 'info',
      detail: discordOnCable
        ? 'Discord is listening to Echopad: friends hear your voice and your sounds.'
        : discordElsewhere
          ? `Discord is recording straight from “${discordElsewhere.deviceName}”, so friends won't hear your sounds. In Discord → Voice & Video, set Input Device to “Default”.`
          : 'Join a voice channel and Echopad will confirm Discord can hear it.',
      fix: discordElsewhere ? 'open-discord' : null,
    });

    const anyError = checks.some((c) => c.status === 'error');
    const report = {
      supported: true,
      phase: this.installing ? 'installing' : anyError ? 'attention' : 'ready',
      phaseMessage: '',
      checks,
      log: this.log,
      realMicName: this.state.realMic?.name || realMicList[0]?.name || '',
      cableRenderName: cableRender?.state === STATE_ACTIVE ? cableRender.name : '',
      checkedAt: Date.now(),
    };
    this.lastReport = report;
    this.onReport(report);
    return report;
  }

  /** Put the user's real microphone back as the Windows default (on quit / uninstall). */
  async restore() {
    if (!this.supported) return;
    const st = await this.exec(['status'], 8000);
    if (!st.ok) return;
    const cable = findCable(st.capture, isCableCapture, /cable output/i);
    if (!cable || !cable.defaults.some(Boolean)) return;
    const real =
      st.capture.find((c) => c.id === this.state.realMic?.id && c.state === STATE_ACTIVE) ||
      st.capture.find((c) => c.name === this.state.realMic?.name && c.state === STATE_ACTIVE) ||
      st.capture.find((c) => c.state === STATE_ACTIVE && !isVirtual(c.name));
    if (real) await this.exec(['set-default', real.id], 8000);
  }

  async enableDevice() {
    this.enableAttempted = false;
    return this.check({ autoFix: true });
  }

  /** Plain-text report for support: what Windows reports, what Echopad concluded, what it changed. */
  diagnostics() {
    const lines = [];
    lines.push(`Echopad ${app.getVersion()} on ${this.lastRaw?.os || os.release()} (${os.arch()})`);
    lines.push(`Generated ${new Date().toISOString()}`);
    lines.push('');
    for (const c of this.lastReport?.checks || []) lines.push(`[${c.status.toUpperCase()}] ${c.title}: ${c.detail}`);
    const raw = this.lastRaw || {};
    const ep = (e) => `  ${e.name} | state=${e.state}${e.defaults?.some(Boolean) ? ' | default' : ''}`;
    lines.push('', 'Playback devices:', ...(raw.render || []).map(ep));
    lines.push('Recording devices:', ...(raw.capture || []).map(ep));
    lines.push('VB-CABLE device (Device Manager):', ...((raw.pnp || []).length ? raw.pnp.map((d) => `  ${d.name || d.queryError} | ${d.id || ''} | status=${d.status || ''} | error=${d.error ?? ''}`) : ['  none']));
    lines.push(`Driver service: ${raw.driverService} | driver file: ${raw.driverFile}`);
    lines.push(`Mic privacy: ${JSON.stringify(raw.micPrivacy || {})}`);
    lines.push('Apps using microphones:', ...((raw.sessions || []).map((x) => `  ${x.process} → ${x.deviceName}${x.active ? ' (active)' : ''}`)));
    const st = { ...this.state };
    lines.push(`Install: ${JSON.stringify({ driverInstalledAt: st.driverInstalledAt, lastInstallError: st.lastInstallError, autoRepairAt: st.autoRepairAt, declined: st.autoInstallDeclined })}`);
    lines.push('', 'Recent actions:', ...this.log.map((l) => `  ${new Date(l.at).toISOString()} [${l.kind}] ${l.text}`));
    return lines.join('\n');
  }

  async fixPrivacy() {
    const r = await this.exec(['fix-mic-privacy']);
    if (r.ok) this.addLog('Allowed desktop apps to use your microphone in Windows privacy settings.');
    return this.check({ autoFix: true });
  }
}

module.exports = { SystemController };
