// Renders build/icon.svg to PNGs with Chromium, then packs a multi-size .ico with ImageMagick.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
(async () => {
  const dir = path.join(__dirname, '..', 'build');
  const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
  for (const s of sizes) {
    await page.setViewportSize({ width: s, height: s });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
    await page.screenshot({ path: path.join(dir, `icon-${s}.png`), omitBackground: true });
  }
  await browser.close();
  fs.copyFileSync(path.join(dir, 'icon-512.png'), path.join(dir, 'icon.png'));
  fs.copyFileSync(path.join(dir, 'icon-32.png'), path.join(dir, 'tray.png'));
  execFileSync('convert', [16, 24, 32, 48, 64, 128, 256].map((s) => path.join(dir, `icon-${s}.png`)).concat(path.join(dir, 'icon.ico')));
  console.log('icons written');
})();
