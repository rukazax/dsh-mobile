# DSH Mobile — протокол мобильного шлюза (v0.1)

Статус: черновик контракта. Источник истины для бэкенда (`packages/dsh-mobile`) и PWA
(`packages/dsh-mobile/web`). Версия протокола: `1`.

## 1. Модель развёртывания

```
┌────────────────────────── Android (Honor Magic V3 и др.) ─────────────────────────┐
│  DSH Mobile PWA / APK (WebView)                                                     │
│  localStorage: baseUrl, deviceToken, deviceId, lastCursors{}                        │
└───────────────────────────────┬─────────────────────────────────────────────────────┘
                                │  Wi-Fi LAN, HTTPS (или HTTP с предупреждением)
                                │  Authorization: Bearer <deviceToken>
┌───────────────────────────────▼─────────────────────────────────────────────────────┐
│  DSH host (Windows/ПК, Electron)                                                     │
│  plugin `dsh-mobile` (in-process, Cordis):                                           │
│   • LAN listener :3081  — раздаёт PWA + /api/v1/*                                    │
│   • loopback :59xxx (родной DSH origin) — страница /m/pair (QR + код), под auth DSH  │
│   • доступ к ctx.sessionController / ctx.agent / ctx.userApproval напрямую            │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Смысл: PWA не ходит в родной `/api` DSH (Typert), а говорит с узким мобильным API,
который плагин реализует внутри процесса. Это даёт: минимум байт, отсутствие лишних
LLM-вызовов, независимую авторизацию устройства (pairing), и работу без изменения
штатного кода DSH.

## 2. Аутентификация и pairing

1. Владелец открывает на ПК `http://127.0.0.1:<dsh-port>/m/pair` (родная авторизация
   DSH-браузера). Страница показывает: LAN-адрес, QR (`dshm://pair?...`), 8-символьный код,
   TTL.
2. На телефоне: «Подключить ПК» → сканирует QR/вводит код + адрес.
3. `POST /api/v1/pair { code, deviceName, devicePlatform }` → `{ deviceToken, deviceId, host }`.
4. Токен хранится в `localStorage`/Keystore, шлётся как `Authorization: Bearer`.
   Сервер хранит только хеш токена (SHA-256) + метаданные устройства.

Правила:
- pairing-код одноразовый, живёт `pairingTtlSec` (по умолчанию 300 с), максимум 5 попыток;
- устройство можно отозвать на странице `/m/pair` (список устройств);
- TLS: если задан cert/key — HTTPS; иначе HTTP + явный бейдж «незашифрованный канал»
  и предупреждение в UI. Для установки PWA (service worker) нужен HTTPS или localhost;
  APK-обёртка работает и по HTTP (cleartext разрешён в манифесте).
- Все запросы, кроме `/pair` и статики PWA, требуют токен. Неверный токен → 401,
  после 10 ошибок с одного IP — 429 на 60 с.

## 3. Общие соглашения

- Base: `{scheme}://{host}:{port}/api/v1`
- Формат: JSON UTF-8, `Content-Type: application/json`, ответы gzip/br при `Accept-Encoding`.
- Время: ISO-8601 UTC строки.
- Ошибка: `{ "error": { "code": "...", "message": "..." } }`, HTTP 4xx/5xx.
  Коды: `auth-required`, `auth-invalid`, `pairing-invalid`, `pairing-expired`,
  `session-not-found`, `session-archived`, `agent-busy`, `prompt-invalid`, `approval-unknown`,
  `unsupported`, `rate-limited`, `internal`.
- Идемпотентность: все POST, меняющие состояние, принимают `requestId` (UUID клиента).
  Повтор с тем же `requestId` возвращает прежний результат (`200`, `deduplicated: true`).
- Курсоры: непрозрачные строки, но для отладки кодируют `seq` (durable event seq сессии)
  либо `updatedAt|id` для списков. Клиент обязан хранить их как opaque.

## 4. Эндпоинты

### 4.1 Служебные

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/hello` | `{ protocol:1, appVersion, hostName, capabilities:{ approvals:true, questions:true, attachments:false, jobs:true }, limits:{ maxPromptChars } }` |
| POST | `/pair` | `{ deviceToken, deviceId, host:{ name, appVersion, protocol } }` (без токена) |
| POST | `/devices/revoke` | `{ ok:true }` — отозвать текущее устройство |
| GET | `/health` | `{ ok:true, uptimeSec }` |

### 4.2 Сессии

`SessionSummary` (компактный, ≤ ~700 байт):

```json
{
  "id": "session-…",
  "title": "…",
  "workspaceId": "ws-…",
  "workspaceName": "harness",
  "cwd": "C:\\…\\harness",
  "createdAt": "2026-10-23T09:00:00Z",
  "updatedAt": "2026-10-23T12:00:00Z",
  "status": "idle|running|blocked|queued",
  "model": "deepseek-flash",
  "parentSessionId": null,
  "lastText": "…обрезано до 180 символов…",
  "lastRole": "assistant|user|tool",
  "eventCount": 1234,
  "cursor": "1234",
  "hasPendingApproval": false,
  "hasPendingQuestion": false,
  "formatStatus": "ok|migration-required"
}
```

| Метод | Путь | Параметры | Ответ |
|---|---|---|---|
| GET | `/sessions` | `cursor?`, `limit?` (≤100, деф. 50), `archived?=0`, `q?` (локальный поиск) | `{ sessions:[SessionSummary], nextCursor, removed:[id], serverTime }` |
| GET | `/sessions/{id}` | `turns?` (деф. 2, ≤10), `before?` (курсор) | `{ session, events:[WireEvent], cursor:"<последний seq>", hasOlder:bool, running, queue:[…], pendingApproval?, pendingQuestion? }` |
| GET | `/sessions/{id}/older` | `before`, `turns?` | `{ events, hasOlder }` |
| POST | `/sessions` | `{ requestId, workspaceId?, preset? }` | `{ session: SessionSummary }` |
| POST | `/sessions/{id}/prompt` | `{ requestId, text, mode:"transcript"\|"queue"\|"steer", attachments?:[] }` | `{ accepted:true, requestId, seq, deduplicated? }` |
| POST | `/sessions/{id}/cancel` | `{ requestId, scope:"turn"\|"queue"\|"all" }` | `{ ok:true }` |
| POST | `/sessions/{id}/approval` | `{ requestId, approvalId, decision:"allow"\|"deny", remember? }` | `{ ok:true }` |
| POST | `/sessions/{id}/question` | `{ requestId, questionId, answer }` | `{ ok:true }` |
| POST | `/sessions/{id}/read` | `{ lastSeenSeq }` | `{ ok:true }` (для непрочитанных) |

`POST /sessions` создаёт сессию в workspace; если `workspaceId` не задан — последний.

### 4.3 Живой поток (SSE)

`GET /sessions/{id}/stream?cursor=<seq>` — `text/event-stream`:

```
event: hello
data: {"sessionId":"…","cursor":"1234","running":true}

event: delta
data: {"from":"1235","events":[{...WireEvent...}]}

event: live
data: {"attemptId":"…","index":12,"text":"…","role":"assistant"}

event: state
data: {"running":true,"status":"running","queue":0,"pendingApproval":null}

event: ping
data: {"t":1730000000}

event: resync
data: {"reason":"gap|generation-changed"}
```

- `delta` содержит только durable-события с `seq > cursor`, непрерывно.
- `live` — транзиентные чанки ассистента; не сохраняются, при реконнекте не повторяются
  (после реконнекта текст придёт durable-событием `assistant/message`).
- `resync` — клиент обязан перезапросить `GET /sessions/{id}` с текущим `cursor`.
- keepalive: `ping` каждые 15 с; сервер закрывает поток после 60 с без ping-ответа
  (браузер сам не отвечает — поэтому ping только server→client, и сервер шлёт его всегда).
- один поток на сессию; при открытии второго с тем же `deviceId` старый закрывается.

### 4.4 Рабочие пространства и фоновые задачи

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/workspaces` | `[{ id, path, name, isDefault, sessionCount }]` |
| GET | `/jobs` | `[{ id, sessionId, kind, status, startedAt, title }]` |
| POST | `/jobs/{id}/kill` | `{ ok:true }` |

### 4.5 Статика PWA и страница pairing

| Метод | Путь | Примечание |
|---|---|---|
| GET | `/` , `/m/` | `index.html` PWA (на LAN-порту) |
| GET | `/assets/*`, `/manifest.webmanifest`, `/sw.js`, `/icons/*` | статика, ETag, gzip, immutable для хешированных имён |
| GET | `/m/pair` | HTML-страница pairing (только на loopback-порту DSH, auth DSH) |
| GET | `/m/pair.json` | `{ lanUrls:[], code, expiresAt, devices:[] }` (auth DSH) |

## 5. WireEvent — компактная схема

Событие в `events[]`:

```json
{ "seq": 1235, "t": "2026-10-23T12:00:00Z", "k": "assistant/message", "d": { … } }
```

`k` — вид события (сокращённые имена), `d` — полезная нагрузка, отобранная под мобильный
UI (без внутренних полей, без дублей). Поддерживаемые виды v1:

| `k` | `d` |
|---|---|
| `user/message` | `{ text, attachments? }` |
| `assistant/message` | `{ text, toolCalls? }` |
| `tool/call` | `{ callId, name, argsPreview }` (args ≤ 2 КБ, обрезка с `truncated:true`) |
| `tool/result` | `{ callId, ok, textPreview, truncated }` |
| `turn/start`, `turn/end` | `{ turnId, reason? }` |
| `step/start`, `step/end` | `{ stepId, index }` |
| `approval/request` | `{ approvalId, title, detail, options }` |
| `approval/resolved` | `{ approvalId, decision }` |
| `question/request` | `{ questionId, question, options? }` |
| `question/resolved` | `{ questionId, answer }` |
| `session/title` | `{ title }` |
| `error` | `{ message, code? }` |
| `notice` | `{ text, level }` (сжатие/переполнение/прочее — только текст) |

Правила:
- `seq` строго возрастает в пределах сессии, непрерывен; повторная доставка одного `seq`
  допустима, клиент дедуплицирует по `seq`.
- Полные tool-результаты и файлы не передаются: только превью (≤ 2 КБ) + флаг
  `truncated`. Полный текст по требованию — `GET /sessions/{id}/events/{seq}` (v1.1).
- Никаких служебных событий с полным транскриптом модели.

## 6. Экономия токенов (жёсткие правила)

Синхронизация **не должна** приводить к вызовам модели. Запрещено в мобильном шлюзе:

1. Вызывать генерацию заголовков сессий (title LLM) при открытии/обзоре списка.
2. Вызывать суммаризацию/компакцию/саммари при чтении истории.
3. Делать «resume» холодной сессии при простом просмотре — только чтение durable-лога.
4. Отправлять полный транскрипт: только окно последних N ходов + дельта по `cursor`.
5. Автоматически запускать какие-либо промпты (в т.ч. «привет»/служебные) при подключении.

Мобильный шлюз читает те же durable-события, что и десктопный GUI, и не участвует в
сборке контекста модели. Подключение/просмотр с телефона = 0 токенов.
Промпт с телефона расходует токены ровно как промпт с десктопа (тот же agent loop),
без дополнительных накладных вызовов.

## 7. Синхронизация и устойчивость

- Клиент хранит на устройстве: `sessionsCache` (JSON, ≤ 200 строк), для 10 последних
  сессий — последние 50 событий, `cursor` на сессию, черновики промптов.
- Холодный старт: показать кэш мгновенно → `GET /sessions` → `GET /sessions/{id}?turns=2`.
- Реконнект: `stream?cursor=last`; при `resync` — полный снапшот.
- Фон: при сворачивании PWA закрываем SSE, запоминаем cursor; при возврате — догоняем.
- Android WebView/Chrome может убить страницу: состояние восстанавливается из IndexedDB.
- Никаких периодических опросов (polling) — только SSE + ручной refresh.
- Байтовый бюджет: список 50 сессий ≤ 25 КБ gzip; открытие сессии (2 хода) ≤ 15 КБ gzip;
  дельта одного хода ≤ 8 КБ gzip.

## 8. Раскладные устройства (Honor Magic V3 и т.п.)

- Обнаружение: `@media (horizontal-viewport-segments: 2)`, `@media (spanning: single-fold-vertical)`,
  `env(viewport-segment-width 0 0)`, `env(viewport-segment-left 1 0)`, `env(device-posture)`.
- Открыт (2 вертикальных сегмента): двухпанельный режим — список сессий в левом сегменте
  (ширина сегмента), чат в правом; шов (hinge) как gutter ≥ 16 px, контент не пересекает шов.
- Сложен/внешний экран: однопанельный режим, список ↔ чат через навигацию, composer
  прижат к нижней безопасной зоне, учёт `visualViewport` при клавиатуре.
- Планшет/широкий экран (≥ 840 dp): постоянный rail со списком + чат.
- Смена posture/orientation не сбрасывает: черновик, позицию скролла, открытую сессию,
  активный SSE (поток не пересоздаётся, т.к. разметка — CSS-only).
- Safe areas: `env(safe-area-inset-*)` для внешнего экрана с вырезом.

## 9. Уточнения по факту реализации (v0.2)

Ниже — места, где реальные API DSH 0.2.1-rc.2 заставили уточнить контракт. Это
часть контракта, а не «пожелания»: реализация в `packages/dsh-mobile` следует
именно этим правилам.

### 9.1 Список сессий

- `eventCount` и `cursor` могут быть `null` — у холодной сессии дешёвого счётчика
  событий нет; клиент обязан терпеть `null` и обновлять курсор после открытия.
- `title` может быть `"Без названия"`: projection-кэш DSH может не содержать
  заголовка; при открытии заголовок восстанавливается из события `session/title`
  (без LLM). Клиент не должен считать это ошибкой.
- `status: "archived"` — сессии из `archivedSessionIds`; по умолчанию (без
  `?archived=1`) они отфильтровываются.
- `workspaces`: `id` равен пути воркспейса (`cwd`), `name` — его basename; в
  `/sessions` `workspaceId` может быть пустым.

### 9.2 Окно истории

- `GET /sessions/{id}?turns=N` возвращает **не более `sessionWindowEvents`**
  (по умолчанию 40) событий; окно гарантированно содержит ближайший
  `user/message` (при необходимости к нему добавляется контекст).
- `cursor` — последний `seq` журнала, может быть `-1` для пустой сессии.
- `hasOlder` — есть ли более старые события; `GET .../older?before=<seq>`.
- Начало окна не обязано совпадать с границей турна, если сработал жёсткий кап.

### 9.3 Живой поток

- Изначально `event: hello` содержит `{sessionId, cursor, running, serverTime}`.
- `event: delta` → `{from, events:[WireEvent]}`; `seq` строго плотный.
- `event: live` → `{attemptId, revision, type:"start"|"end"}` либо
  `{attemptId, revision, index, blockIndex, text}` (только `text-delta`).
  Транзиентные кадры не переживают реконнект.
- `event: state` → `{running, status}`.
- `event: approval` → `{approval: {...}|null}`; `approvalId` — идентификатор
  релея (durable-события `approval/asked|decided` в поток не проецируются).
- `event: resync` → `{reason, expected?, received?}` — клиент перезапрашивает окно.

### 9.4 Промпт, отмена, approvals

- `POST /prompt`: `mode` — `transcript` (по умолчанию) или `queue` → Host
  `mode:"queue"`, `steer` → Host `mode:"steer"`. Ответ `{accepted, requestId,
  seq}`; `seq` может быть `"-1"` (точный seq придёт дельтой).
- `POST /cancel`: `scope:"turn"` — прервать ход; `"queue"` — удалить очередь;
  `"all"` — и то и другое. Хост не имеет единого «cancel со scope», поэтому
  очередь удаляется по одному элементу.
- `POST /approval`: `{requestId, approvalId, decision:"allow"|"deny"}`.
  `remember` **не поддерживается** (в DSH нет «разрешить всегда»).
  Если `approvals:"observe"` — ответ с телефона отклоняется с
  `409 approval-desktop-only`.
- `POST /question` в v1 — `501 unsupported`: ответ на вопрос требует живого
  корневого агента и создаёт model-visible сообщение.

### 9.5 Что запрещено на сервере синхронизации

1. `sessionController.follow()` для холодных сессий (promote + запись в журнал).
2. `sessionTitle.refresh()` и любая LLM-генерация при чтении/списке.
3. Компакция, суммаризация, «прогрев» агента ради истории.
4. Периодический polling вместо SSE.
5. Пересылка полного транскрипта и полных выводов инструментов.
