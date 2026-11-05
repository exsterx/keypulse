# Relay — «лёгкий сервер» для одного общего Telegram-бота

Принимает совпадения от клиентов по HTTP и отправляет их через **один общий бот**,
а также маршрутизирует команды бота и нажатия кнопок обратно к клиенту по WebSocket.
Токен бота живёт только на сервере.

## Структура

```
relay/
├── docker-compose.yml
└── app/
    ├── Dockerfile
    ├── package.json
    ├── index.js
    ├── .env.example   # образец
    └── .env           # заполнить реальными значениями
```

## Деплой (Ubuntu, Docker)

```bash
cd relay
cp app/.env.example app/.env
nano app/.env          # вписать BOT_TOKEN и API_KEYS
docker compose up -d --build
docker compose logs -f relay
```

## API_KEYS

Список ключей через запятую (заголовок `x-api-key`):

```
API_KEYS=secret1,secret2
```

Любой валидный ключ может слать уведомления и подключаться по WebSocket.

## Проверка

```bash
curl https://DOMAIN/health
```

Отправить уведомление (chat_id узнаётся командой `/start` у бота):

```bash
curl -X POST https://DOMAIN/notify \
  -H "Content-Type: application/json" \
  -H "x-api-key: ключ1" \
  -d '{"chat_id": 658834682, "text": "тест"}'
```

## Эндпоинты

- `POST /notify` — принять уведомление (`chat_id`, `text`, `reply_markup`; заголовок `x-api-key`).
- `GET /health` — проверка живости.
- `WS /ws` — канал команд сервер ↔ клиент (`hello`, `req`, `res`).

## Что дальше (не входит в минимальную версию)

- Очередь отправки + rate-limit (защита от лимитов Telegram).
- Реестр пользователей в базе (сейчас — ключи и chat_id в env).

