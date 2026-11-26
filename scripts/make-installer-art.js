// Renders the NSIS welcome/finish sidebar (164x314) and header (150x57) bitmaps.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
(async () => {
  const out = path.join(__dirname, '..', 'installer');
  const glyph = (s) => `<svg width="${s}" height="${s}" viewBox="0 0 256 256"><g fill="#fff">
    <rect x="52" y="96" width="24" height="64" rx="12" opacity=".85"/><rect x="92" y="64" width="24" height="128" rx="12"/>
    <rect x="132" y="84" width="24" height="88" rx="12" opacity=".95"/><rect x="172" y="108" width="24" height="40" rx="12" opacity=".8"/></g></svg>`;
  const b = await chromium.launch();
  const p = await b.newPage();
  const font = "font-family:'Segoe UI',Inter,Arial,sans-serif;";
  await p.setViewportSize({ width: 164, height: 314 });
  await p.setContent(`<body style="margin:0;width:164px;height:314px;${font}background:
    radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,.18), transparent 60%),
    linear-gradient(160deg,#6d4dff 0%,#9b46e6 55%,#e0459b 100%);color:#fff;position:relative;overflow:hidden">
    <div style="position:absolute;left:22px;top:34px;width:64px;height:64px;border-radius:18px;background:rgba(255,255,255,.16);display:grid;place-items:center">${glyph(64)}</div>
    <div style="position:absolute;left:22px;top:116px;font-size:24px;font-weight:700;letter-spacing:-.3px">Echopad</div>
    <div style="position:absolute;left:22px;top:150px;font-size:12px;opacity:.85;line-height:1.4">Soundboard for<br>Discord &amp; voice chat</div>
    <div style="position:absolute;left:-40px;bottom:-60px;width:220px;height:220px;border-radius:50%;border:28px solid rgba(255,255,255,.07)"></div>
  </body>`);
  await p.screenshot({ path: path.join(out, 'sidebar.png') });
  await p.setViewportSize({ width: 150, height: 57 });
  await p.setContent(`<body style="margin:0;width:150px;height:57px;background:#fff;display:flex;align-items:center;justify-content:flex-end;padding-right:12px;box-sizing:border-box">
    <div style="width:40px;height:40px;border-radius:11px;background:linear-gradient(135deg,#8b6cff,#e0459b);display:grid;place-items:center">${glyph(40)}</div></body>`);
  await p.screenshot({ path: path.join(out, 'header.png') });
  await b.close();
  for (const n of ['sidebar', 'header']) {
    execFileSync('convert', [path.join(out, `${n}.png`), '-alpha', 'off', `BMP3:${path.join(out, `${n}.bmp`)}`]);
    fs.unlinkSync(path.join(out, `${n}.png`));
  }
  console.log('installer art written');
})();
