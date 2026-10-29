# dsh-mobile

Плагин DeepSeek Harness, который превращает телефон (Android/раскладной) в пульт
управления живыми сессиями агента: список сессий, история, промпты, остановка,
approvals — поверх собственного LAN-шлюза с pairing-кодами.

Полное описание продукта — в [корневом README](../../README.md); архитектура —
`docs/architecture.md`; протокол — `docs/mobile-api.md`.

## Что внутри

```
lib/index.js          Cordis-вход: LAN-listener, /m/pair на loopback, файловый лог,
                      ленивый мост к сервисам хоста, корректный dispose
src/config.js         нормализация конфига без зависимости от schemastery
src/auth.js           pairing-коды (TTL, попытки, rate-limit), device-токены (SHA-256)
src/store.js          атомарный JSON-реестр устройств в $DSH_HOME/mobile-remote
src/http.js           JSON-конверт, ошибки, gzip/br, ETag, CORS, лимиты тела
src/static.js         отдача PWA (path-traversal-safe, ETag, сжатие)
src/sse.js            SSE-hub: один поток на (device, session), heartbeat, backpressure
src/routes.js         /api/v1: auth, идемпотентность, сессии, approvals, jobs
src/server.js         LAN-слушатель (HTTP/HTTPS), роутинг, graceful shutdown
src/pairing.js        HTML-страница /m/pair на родном origin DSH
src/session-bridge.js in-process мост: list/observe/page/prompt/cancel/approval
src/util.js           мелкие утилиты (LAN-IP, токены, ISO)
web/                  PWA без сборки и зависимостей
test/                 node:test (20 тестов, in-process runner)
```

## Установка

```powershell
# DSH должен быть закрыт
& "<DSH>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add `
    "link:C:\Users\<user>\Documents\deepseek-harness\harness\packages\dsh-mobile"
```

После запуска DSH: страница `http://127.0.0.1:<порт DSH>/m/pair` (код + LAN-адреса),
телефон — `http://<LAN-IP>:3081/`. Подробно — `docs/install.md`.

## Конфиг (все поля опциональны)

```yaml
- id: mobile-remote
  name: dsh-mobile
  config:
    listenPort: 3081
    pairingTtlSec: 300
    approvals: auto     # auto | relay | observe
    sessionWindowTurns: 1
    sessionWindowEvents: 40
    debug: false
```

Полная таблица — `docs/install.md` §3.

## Разработка и проверка

```powershell
# тесты (in-process, без спавна)
& "<bundled-node>" scripts/run-tests.mjs

# локальный предпросмотр PWA без DSH
& "<bundled-python>" -m http.server 8765 --bind 127.0.0.1   # из web/
# ?demo=1 — демо-чат; ?demo=1&lab=1 — симулятор раскладного экрана

# изолированный DSH: см. research/test-instance.md
```

## Токены

Плагин читает только durable-журнал сессии (`sessionQuery.observeSession`) и
шину `session/event`. Он **не** вызывает генерацию заголовков, компакцию или
`session/follow` (последний «промоутит» холодную сессию). Просмотр с телефона
стоит 0 токенов; промпт — как с десктопа.

## Лицензия

MIT.
