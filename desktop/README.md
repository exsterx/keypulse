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
- The semantic matcher runs a local cross-encoder
  (`onnx-community/bge-reranker-v2-m3-ONNX`, q8) through
  `@huggingface/transformers` + `onnxruntime-node`. Both are runtime
  dependencies, and `asarUnpack` in `electron-builder.yml` keeps the native
  binary (`onnxruntime.dll`, `*.node`) plus the ESM build outside the asar
  archive — without that the model cannot load in the packaged app.
- The model is downloaded on first run (~570 MB, once) into
  `%APPDATA%\Keypulse\data\models` and loads from disk in 1–2 s afterwards.
  The score of one message against the semantic keys is ~16–20 ms, so live
  matching has no noticeable delay.
- A manual `/scan 7d` is keyword-only; `/scan 7d deep` (or
  `BACKFILL_SEMANTIC=true` for the startup backfill) additionally scores the
  scanned history by meaning. On CPU the cross-encoder needs ~270 ms per
  (message, key) pair, so a deep scan over a week of history across many chats
  takes minutes-to-hours: the scan drains the semantic queue every few
  messages, logs progress every 100 messages, and reports progress to Telegram
  every 90 s, so it never silently hangs. If the model is not ready yet the
  scan falls back to keywords and says so in the result message.
- The Telegram liveness watchdog is paused while a scan runs, so a deep scan
  (which keeps the connection busy and pegs the CPU) is not mistaken for a dead
  connection and does not trigger a reconnect storm.
- The dialog cache is filled from both the main and the archived folder; a chat
  that is still missing from it is resolved on demand during the scan. Chats
  Telegram refuses to open are counted in the result message instead of being
  skipped silently.
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
