# Relay — a lightweight server for a single shared Telegram bot

Accepts matches from clients over HTTP and sends them through **one shared bot**,
and also routes bot commands and button presses back to the client over WebSocket.
The bot token lives only on the server.

## Structure

```
relay/
├── docker-compose.yml
└── app/
    ├── Dockerfile
    ├── package.json
    ├── index.js
    ├── .env.example   # sample
    └── .env           # fill in with real values
```

## Deploy (Ubuntu, Docker)

```bash
cd relay
cp app/.env.example app/.env
nano app/.env          # fill in BOT_TOKEN and API_KEYS
docker compose up -d --build
docker compose logs -f relay
```

## API_KEYS

Comma-separated list of keys (`x-api-key` header):

```
API_KEYS=secret1,secret2
```

Any valid key can send notifications and connect over WebSocket.

## Verification

```bash
curl https://DOMAIN/health
```

Send a notification (chat_id is obtained with the `/start` command at the bot):

```bash
curl -X POST https://DOMAIN/notify \
  -H "Content-Type: application/json" \
  -H "x-api-key: key1" \
  -d '{"chat_id": 658834682, "text": "test"}'
```

## Endpoints

- `POST /notify` — accept a notification (`chat_id`, `text`, `reply_markup`; `x-api-key` header).
- `GET /health` — liveness check.
- `WS /ws` — server ↔ client command channel (`hello`, `req`, `res`).

## What's next (not part of the minimal version)

- Send queue + rate limiting (protection against Telegram limits).
- User registry in a database (currently keys and chat_id are in env).

