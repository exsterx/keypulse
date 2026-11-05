# Keypulse Desktop (Windows)

Electron wrapper around the Keypulse engine. Runs the same Telegram keyword
monitor with a GUI, system tray status and English/Russian localization.

## Features

- **System tray** with status indication:
  - 🟢 green — running
  - 🟡 yellow — paused
  - 🔴 red — no connection (Telegram / relay)
- **First-run config** in `%APPDATA%\Keypulse\config.json`. The relay URL is
  pre-filled with the default (`https://keypulse.xyz/`).
- **Language switch** RU/EN (in-app, and in the NSIS installer when packaged).
- **Account authorization** via the in-app wizard (phone → code → 2FA).
- Reuses the engine from `../dist` (compiled TypeScript) — no duplicated logic.

## Dev run (no packaging)

The engine must be compiled first (from the repo root):

```bash
npm run build           # compiles src/ -> dist/
cd desktop
npm install
npm start               # electron .
```

## Packaging (electron-builder)

```bash
cd desktop
npm run dist            # electron-builder --win
```

Notes:
- `better-sqlite3` is a native module: before packaging, rebuild it for
  Electron's ABI:
  ```bash
  npx electron-rebuild -f -w better-sqlite3
  ```
- The compiled `dist/` is included via `extraResources` in `electron-builder.yml`.
- The NSIS installer is multi-language (RU/EN) via `installerLanguages`.

## Tray icons

Optional colored tray icons (`green/yellow/red`) can be dropped into
`desktop/assets/` as `tray-green.png`, `tray-yellow.png`, `tray-red.png`.
Without them, the status is shown via the tray tooltip and the colored dot in
the window.

## Data locations (does not affect the CLI version)

| Item | Location |
|---|---|
| Config | `%APPDATA%\Keypulse\config.json` |
| SQLite DB | `%APPDATA%\Keypulse\data\` |
| Session (DPAPI) | `%APPDATA%\Keypulse\data\session.bin` |
| Logs | `%APPDATA%\Keypulse\logs\` |
