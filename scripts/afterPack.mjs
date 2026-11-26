// Stamps the app icon and version metadata into Echopad.exe using a pure-JS PE editor,
// so Windows builds made on Linux/macOS don't need Wine/rcedit.
import fs from 'node:fs';
import path from 'node:path';
import * as ResEdit from 'resedit';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { productFilename } = context.packager.appInfo;
  const version = context.packager.appInfo.version;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const icoPath = path.join(context.packager.projectDir, 'build', 'icon.ico');

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const targets = groups.length ? groups : [{ id: 1, lang: 1033 }];
  for (const g of targets) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      g.id,
      g.lang,
      iconFile.icons.map((i) => i.data),
    );
  }

  const [major, minor, patch] = version.split('.').map((n) => parseInt(n, 10) || 0);
  const vis = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = vis[0] ?? ResEdit.Resource.VersionInfo.createEmpty();
  const langs = vi.getAllLanguagesForStringValues();
  const lang = langs[0] ?? { lang: 1033, codepage: 1200 };
  vi.setFileVersion(major, minor, patch, 0, lang.lang);
  vi.setProductVersion(major, minor, patch, 0, lang.lang);
  vi.setStringValues(lang, {
    ProductName: 'Echopad',
    FileDescription: 'Echopad Soundboard',
    CompanyName: 'Echopad',
    LegalCopyright: 'Copyright © 2026 Echopad',
    OriginalFilename: `${productFilename}.exe`,
    InternalName: 'Echopad',
    FileVersion: version,
    ProductVersion: version,
  });
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • stamped icon + version info into ${path.basename(exePath)}`);
}
