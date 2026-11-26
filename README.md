# Echopad

A soundboard for Windows that plays sounds straight into **Discord** (or any voice chat app) with **global keyboard shortcuts**.

- Drag and drop MP3 / WAV / OGG / M4A / FLAC / OPUS / WEBM files to build your board
- A global shortcut for every sound that works while Discord or a game has focus, plus a "Stop all" shortcut
- **Mic passthrough**: your real microphone is mixed into the same virtual mic, so friends hear your voice *and* the sounds
- **Monitor**: hear the sounds on your own headphones at a separate volume
- Volume and colour per sound, favourites, search, sorting, drag-to-reorder
- Live level meters, first-run setup guide, system tray, launch at startup

## How it works

Discord can only listen to a microphone. Echopad plays sounds into the free
[VB-CABLE](https://vb-audio.com/Cable/) virtual audio device and mixes your real microphone into it.
In Discord you pick **CABLE Output** as your input device. The in-app guide walks through it.

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
Pushing a `v*` tag also builds the installer on GitHub Actions (`.github/workflows/build.yml`).

### Layout

| Path | What |
| --- | --- |
| `electron/main.js` | Window, tray, global shortcuts, file import and storage |
| `electron/preload.js` | Safe IPC bridge (`window.echopad`) |
| `src/audio.ts` | Audio engine: cable output, monitor output, mic passthrough, meters |
| `src/store.ts` | App state and persistence |
| `src/components/` | UI |
| `installer/echopad.nsi` | NSIS installer script |
