# Keypulse

Local Telegram keyword monitor for Windows. It connects to your personal
Telegram account (MTProto), reads the channels/groups you have access to, finds
messages matching your keywords, stores matches in SQLite and sends
notifications + a daily digest through a Telegram bot.

Everything is local. No cloud databases, no Docker required for the core.

## Repo layout

```
keypulse/
├── src/                  # shared engine (TypeScript)
├── scripts/              # CLI helpers (auth, start, autostart, backup)
├── tests/                # matcher + dedupe tests
├── relay/                # optional central relay server (shared bot)
├── desktop/              # Electron desktop app (Windows GUI)
├── keywords.txt          # keywords (one per line)
├── exclude_words.txt     # exclude words
└── README.md
```

## Components

| Component | Entry | Description |
|---|---|---|
| Engine | `src/` | config, storage, matcher, telegram, monitor, notifications, digest, bot |
| CLI | `src/index.ts` | headless runner (`npm start`) |
| Desktop | `desktop/main.js` | GUI + tray (uses the engine from `dist/`) |
| Relay | `relay/` | central server holding one shared bot token |

## Quick start (CLI)

```bash
npm install
copy .env.example .env    # fill TG_API_ID, TG_API_HASH, BOT_TOKEN, OWNER_TELEGRAM_ID
npm run auth              # authorize your Telegram account
npm run build
scripts\start.bat
```

## Desktop

```bash
npm run build             # compile the engine first
cd desktop && npm install && npm start
```

See `desktop/README.md` for packaging (electron-builder) details.

## Relay (optional)

```bash
cd relay && docker compose up -d --build
```

See `relay/README.md`.

## Security

- The session is encrypted with Windows DPAPI and stored in `data/session.bin`.
- Secrets (`.env`, session, database) are gitignored.
- The relay accepts notifications only with a valid API key.

## Releases

Built artifacts (desktop installers, portable exe) are published on
**GitHub Releases**. Tag per component: `cli-vX.Y.Z`, `desktop-vX.Y.Z`,
`relay-vX.Y.Z`.
