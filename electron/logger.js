'use strict';
/**
 * Persistent log for Echopad: %APPDATA%\Echopad\logs\echopad.log (rotated at 1 MB).
 * Everything the setup/self-repair does is written here so failures can be diagnosed afterwards.
 */
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MAX_BYTES = 1024 * 1024;
let dir = null;

function logDir() {
  if (!dir) {
    dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
const logFile = () => path.join(logDir(), 'echopad.log');

function rotate() {
  try {
    if (fs.statSync(logFile()).size > MAX_BYTES) fs.renameSync(logFile(), `${logFile()}.1`);
  } catch {
    /* no file yet */
  }
}

function write(level, msg, data) {
  try {
    rotate();
    let line = `${new Date().toISOString()} [${level}] ${msg}`;
    if (data !== undefined) line += ` ${typeof data === 'string' ? data : JSON.stringify(data)}`;
    fs.appendFileSync(logFile(), `${line}\n`);
  } catch {
    /* logging must never break the app */
  }
}

const log = {
  info: (m, d) => write('info', m, d),
  warn: (m, d) => write('warn', m, d),
  error: (m, d) => write('error', m, d),
  file: logFile,
  dir: logDir,
  tail(lines = 200) {
    try {
      const all = fs.readFileSync(logFile(), 'utf8').trimEnd().split('\n');
      return all.slice(-lines).join('\n');
    } catch {
      return '(no log yet)';
    }
  },
};

/** Windows' own driver-installation log, trimmed to the most recent VB-CABLE section. */
function setupApiExcerpt(maxLines = 160) {
  if (process.platform !== 'win32') return '(not Windows)';
  const file = path.join(process.env.WINDIR || 'C:\\Windows', 'INF', 'setupapi.dev.log');
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    let last = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/vbaudio|vbmmecable|vb-audio/i.test(lines[i])) {
        last = i;
        break;
      }
    }
    if (last < 0) return '(no VB-CABLE entries in setupapi.dev.log: Windows never started installing its device)';
    // Walk back to the start of that install section (">>>  [Device Install ..." / "[Setup ...").
    let start = last;
    for (let i = last; i >= Math.max(0, last - 600); i--) {
      if (/^>>>\s+\[/.test(lines[i]) && /vbaudio|vbmmecable|device install|setupcopyoeminf|ROOT\\MEDIA/i.test(lines[i])) start = i;
      if (last - i > 600) break;
    }
    const end = Math.min(lines.length, Math.max(last + 25, start + maxLines));
    return lines.slice(start, Math.min(end, start + maxLines)).join('\n');
  } catch (err) {
    return `(could not read ${file}: ${err.code || err.message})`;
  }
}

/** Remove the Windows user name / profile path before a report leaves the PC. */
function scrub(text) {
  let out = text;
  const home = os.homedir();
  const user = os.userInfo().username;
  if (home) out = out.split(home).join('%USERPROFILE%');
  if (user && user.length > 2) out = out.replace(new RegExp(user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<user>');
  const host = os.hostname();
  if (host && host.length > 2) out = out.replace(new RegExp(host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<pc>');
  return out;
}

module.exports = { log, setupApiExcerpt, scrub };
