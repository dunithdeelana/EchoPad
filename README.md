# Echopad

A soundboard for Windows that plays sounds straight into **Discord** (or any voice chat app) with **global keyboard shortcuts**.

- Drag and drop MP3 / WAV / OGG / M4A / FLAC / OPUS / WEBM files to build your board
- A global shortcut for every sound that works while Discord or a game has focus, plus a "Stop all" shortcut
- **Mic passthrough**: your real microphone is mixed into the same virtual mic, so friends hear your voice *and* the sounds
- **Monitor**: hear the sounds on your own headphones at a separate volume
- Volume and colour per sound, favourites, search, sorting, drag-to-reorder
- Live level meters, first-run setup guide, system tray, launch at startup

## How it works — set up automatically

Discord can only listen to a microphone, so Echopad uses a virtual microphone. On first launch Echopad:

1. Downloads [VB-CABLE](https://vb-cable.com) (donationware by VB-Audio) from vb-audio.com, verifies it is
   signed by VB-Audio, and opens VB-Audio's own installer. You approve the Windows prompt and click
   **Install Driver**. VB-CABLE is not bundled or modified; VB-Audio's license does not allow repackaging it.
2. Makes the virtual microphone the Windows default recording device and mixes your real microphone into it,
   so Discord (Input Device = **Default**) hears your voice and your sounds. No Discord settings needed.
3. Keeps your speakers as the default playback device, and allows desktop apps to use the microphone.

A health monitor re-checks every 30 seconds and on every device change, and repairs what it can:
disabled devices, the cable taking over your speakers, mic permission, the default microphone.
It also detects which microphone Discord is actually recording from. When you quit Echopad
(or uninstall it) your real microphone becomes the Windows default again.

Windows changes go through `EchopadAudio.exe` (`native/EchopadAudio.cs`), a small C# helper that uses the
Windows Core Audio APIs.

## Install

Run `Echopad-Setup-<version>.exe`. It installs per-user (no admin needed) into
`%LOCALAPPDATA%\Programs\Echopad` and adds Start Menu and (optional) desktop shortcuts.
Your sounds and settings live in `%APPDATA%\Echopad`.

> The installer is not code-signed, so Windows SmartScreen may say "Windows protected your PC".
> Click **More info → Run anyway**. Signing needs a paid code-signing certificate.

## Development

```bash
npm install
npm start          # build the UI and launch the app
npm run dev        # UI only, in a browser, with mock audio (http://localhost:5173)
npm run dist       # build release/Echopad-Setup-<version>.exe
```

`npm run dist` works on Windows, macOS and Linux. It uses electron-builder to package
`release/win-unpacked`, stamps the icon and version info into `Echopad.exe` (`scripts/afterPack.mjs`),
then compiles `installer/echopad.nsi` with NSIS (`scripts/build-installer.mjs`). Wine is not required.
Every push to `main` also builds the installer on GitHub Actions and publishes it as a GitHub Release for the version in `package.json` (`.github/workflows/build.yml`).

### Layout

| Path | What |
| --- | --- |
| `electron/main.js` | Window, tray, global shortcuts, file import and storage |
| `electron/preload.js` | Safe IPC bridge (`window.echopad`) |
| `src/audio.ts` | Audio engine: cable output, monitor output, mic passthrough, meters |
| `src/store.ts` | App state and persistence |
| `src/components/` | UI |
| `electron/system.js` | Automatic setup, health checks and self-repair |
| `native/EchopadAudio.cs` | Windows audio helper (devices, defaults, sessions, mic privacy) |
| `installer/echopad.nsi` | NSIS installer script |
