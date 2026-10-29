# Проверка DSH Mobile — что реально проверено

Документ фиксирует фактические проверки, команды и вывод. Всё, что не проверено,
перечислено в конце с причиной и способом проверки.

Окружение: Windows, DeepSeek Harness `0.2.1-rc.2` (Cordis 4.0.5), Node 24.21.0
(встроенный в DSH), изолированный тестовый профиль
`research/dshtest2` (свой `DSH_HOME`, порт 18081, LAN-порт 3081). Рабочий
экземпляр пользователя на `127.0.0.1:59912` не трогался.

## 1. Юнит- и интеграционные тесты (20/20)

```
packages/dsh-mobile$ node scripts/run-tests.mjs
✔ pairing code is single-use and issues a verifiable token
✔ wrong codes burn the pairing slot after the attempt limit
✔ expired pairing codes are rejected
✔ revocation invalidates a token and survives a restart
✔ the device registry is pruned to maxDevices
✔ rate limiting blocks repeated failures per address
✔ pairing codes normalize user input
✔ defaults are stable and safe
✔ a non-loopback cleartext listener can be refused explicitly
✔ tls requires both files
✔ invalid ports and urls are rejected
✔ numbers are clamped into their supported range
✔ cors origins accept arrays only
✔ disabled config short-circuits validation
✔ configValues may be getters, as Cordis emits them
✔ module defaults stay frozen
✔ gateway: pairing, auth and session listing
✔ gateway: session snapshot, prompt idempotency and validation
✔ gateway: SSE stream delivers hello, delta, live and state frames
✔ gateway: static PWA assets and CORS preflight
ℹ tests 20  pass 20  fail 0
```

Тесты поднимают настоящий HTTP-сервер (`listenPort: 0`), проходят pairing,
проверяют 401/403/404/415/413, ETag/304, gzip, SSE-кадры, идемпотентность
промпта и статику PWA. Запуск — `node scripts/run-tests.mjs` (не `node --test`:
в этой песочнице тест-раннер не может спавнить дочерние процессы — EPERM).

## 2. Плагин грузится в реальном DSH-хосте

Изолированный профиль `research/dshtest2/profiles/mobile` слинкован на
`packages/dsh-mobile`. Лог плагина (`research/dshtest2/logs/dsh-mobile.log`):

```
INFO apply() start pid=57152 dshHome=…\research\dshtest2 logFile=…\logs\dsh-mobile.log
INFO dsh-mobile: pairing code GKH55KP4 valid until 2026-10-23T09:41:16.419Z
INFO dsh-mobile: approval mode "auto" (relay only when the desktop GUI is not connected)
INFO dsh-mobile: gateway listening on http://127.0.0.1:3081
INFO dsh-mobile: phone URL http://192.168.1.10:3081
INFO pairing page: http://127.0.0.1:18081/m/pair
INFO sync is delta-only and makes no model requests; viewing sessions from the phone costs 0 tokens
```

То есть: LAN-сокет поднят, страница pairing зарегистрирована на родном
loopback-origin, порты и реальный Wi-Fi IP определены.

## 3. Pairing на родном origin (cookie DSH)

Запрос к изолированному инстансу с cookie, полученной обменом launch-token:

```
GET /m/pair.json (with cookie) → 200
{"code":"AEHU2H7D","expiresAt":"2026-10-23T09:39:27.551Z","ttlSec":253,
 "lanUrls":["http://192.168.1.10:3081","http://192.168.1.11:3081"],
 "devices":[],"hostName":"DESKTOP-PC","appVersion":"0.2.1-rc.2"}
```

Без cookie тот же путь отдаёт 401 (проверялось в `research/plugin-spike` на
`requestRejection`). Код не публикуется на LAN-порту: в `src/server.js` маршрута
pairing нет вовсе — только `/api/v1/pair`, который принимает код и не отдаёт его.

## 4. Сквозной прогон по LAN (реальные сессии)

В тестовый `DSH_HOME` скопированы два реальных журнала сессий и их
projection-кэш (только чтение исходников). Затем `research/tools/e2e-mobile.mjs`
прошёл полный сценарий:

```
GET /hello                         200 39ms 254B
GET /sessions (no token)           401 auth-required
POST /pair                         200 12ms token=43 chars
POST /pair (replay, same code)     403 pairing-invalid
GET /sessions                      200 23ms 1055B on wire (gzip) 2 rows
  - session-51db0001-94eb- … 09:37:14 idle pc-admin Обслуживание ПК
  - 7879a134-3080-46be-bfc … 08:15:57 idle pc-admin Ты — исполнитель ауди…
GET /sessions/{id}                 200 107ms 4340B on wire (gzip), 17756B json
  events                           35 (cursor 1109)
  kinds                            step/end:8, step/start:7, user/message:1,
                                   assistant/message:6, tool/call:6, tool/result:6, turn/end:1
  running/queue                    false / 0
  pendingApproval                  null
GET /sessions/{id}/older           200 7ms 18284B
GET stream (status)                200 text/event-stream; charset=utf-8
SSE first frame                    event: hello | data: {"sessionId":"session-51db…","cursor":1109,…}
POST prompt (blank)                400 prompt-invalid
POST prompt (bad mode)             400 invalid-argument
GET /workspaces                    200 202B
GET /jobs                          200 11B
POST /devices/revoke               200
GET /sessions (revoked token)      401 auth-required
exit=0
```

Что это доказывает:

- реальные заголовки сессий (`Обслуживание ПК`) читаются из projection-кэша DSH;
- окно открытия — **35 durable-событий, 4.3 КБ gzip** (бюджет был ≤ 15 КБ);
- состав окна корректный: 1 `user/message`, 6 `assistant/message`, 6 пар
  tool call/result, границы турна — то есть телефон получает именно чат;
- SSE отдаёт `hello` с реальным курсором, дальше идут дельты/живой текст;
- отзыв токена немедленно закрывает доступ (401).

## 5. PWA отдаётся тем же LAN-шлюзом

```
GET /                       200 text/html; charset=utf-8 7466B
GET /js/main.js             200 7183B
GET /styles/layout.css      200 8064B
GET /manifest.webmanifest   200 1510B
GET /sw.js                  200 3414B
GET /icons/icon-512.png     200 19866B
```

PWA не требует сборки и деплоится плагином статикой (gzip/br, ETag).

## 6. PWA: логика и синхронизация (headless)

Тестировал владелец UI-части (без браузера — он в песочнице недоступен):
`node --check` всех 15 ES-модулей — 0 ошибок; прогон реальных модулей на
DOM-шиме: demo 43/43, Layout Lab 50/50, интеграция с mock-шлюзом 20/20 (реальный
fetch + SSE-кадры, разбитые на чанки; pairing → Bearer; resume с `cursor=2`
после обрыва; POST промпта; 401 → очистка токена). Ноль `console.error`.

## 7. Android-обёртка (локальная сборка APK)

Тулчейн установлен: **JDK 17.0.20.1 (Temurin)**, **Android SDK** (platform-tools 37.0.1,
`platforms;android-35`, `build-tools;35.0.0`), **Gradle 8.9**. Сборка выполнена локально:

```
gradle assembleDebug assembleRelease   → BUILD SUCCESSFUL, 72 задачи
gradlew.bat assembleDebug              → BUILD SUCCESSFUL (wrapper скачал дистрибутив)
```

Артефакты:

| Файл | Размер | Что это |
|---|---|---|
| `android/app/build/outputs/apk/debug/app-debug.apk` | 2.25 МБ | устанавливаемый debug-APK (с bundled PWA) |
| `android/app/build/outputs/apk/release/app-release-unsigned.apk` | 1.74 МБ | release без подписи (с bundled PWA) |

`aapt2 dump badging` подтверждает `package=com.dshmobile.app.debug`, `minSdkVersion=26`,
`targetSdkVersion=35`, `compileSdkVersion=35`, `uses-permission=INTERNET`,
`application-label='DSH Mobile'` (ru/en). При первой компиляции найдена и исправлена
реальная ошибка Kotlin: `onNewIntent(Intent?)` не переопределял
`ComponentActivity.onNewIntent(Intent)`.

Ранее проверялось статически: 17/17 XML well-formed (lxml), все ссылки `R.*`/`@string`
резолвятся, паритет ru/en, семантика манифеста, TOML, YAML workflow, 6 прогонов
`sync-web.ps1` на реальной PWA.
**Lint:** 0 ошибок, 26 предупреждений (доступны новые версии AGP/зависимостей) —
`app/build/reports/lint-results-debug.xml`. Два исходных `NewApi`-замечания закрыты
выносом API-27-атрибутов в `values-v27/themes.xml`.

**Bundled PWA:** `sync-web.ps1` скопировал 26 файлов (0.3 МБ) в `assets/www`; внутри APK
подтверждены `assets/www/index.html`, `assets/www/js/main.js`, `assets/www/styles/layout.css`.

**Не проверено:** установка и runtime APK на реальном устройстве, первый запуск CI.

## 8. Производительность и байты

| Сценарий | Факт | Бюджет |
|---|---|---|
| список 2 сессий | 1.0 КБ gzip | — |
| открытие сессии (35 событий) | 4.3 КБ gzip / 17.8 КБ JSON | ≤ 15 КБ gzip |
| `/older` (40 событий) | ~18 КБ JSON | — |
| PWA shell (index+js+css) | ~17 КБ (gzip меньше) | одноразово, кэшируется SW |
| SSE idle | ping 15 с, ~40 Б | — |

Токенов потрачено на все проверки: **0** (промпты не отправлялись, модели не
вызывались; в тестовом `DSH_HOME` нет credentials, но дело не в этом — маршрут
промпта в e2e проверялся только на валидации).

## 9. НЕ проверено (и почему)

| Что | Почему | Как проверить |
|---|---|---|
| Реальный промпт с телефона | намеренно — экономия токенов | отправить сообщение в живой сессии на устройстве |
| Реальный approval end-to-end | нужен tool-approval от модели (тратит токены/время) | включить инструмент, требующий approval, отключить десктопную вкладку, ответить с телефона; лог `approval mode` |
| Визуальный рендер PWA, шов, CSS segments | в песочнице нет браузера (Chrome/Edge блокируются named-pipe) | открыть `http://<PC>:3081/?demo=1&lab=1`, затем на Honor Magic V3 |
| Service worker / установка PWA | нужен secure context + браузер | HTTPS-конфиг или APK, затем Chrome → «Установить приложение» |
| APK: установка/запуск | нет устройства или эмулятора | `adb install android/app/build/outputs/apk/debug/app-debug.apk` |
| IndexedDB на устройстве | нет браузера; логика покрыта fallback-тестом | DevTools → Application → IndexedDB |
| Вопросы `ask_user` | v1 не поддерживает ответ | — |
| Поведение при обновлении DSH | проверена одна версия | см. `docs/architecture.md` §9 |

## 10. Как повторить

```powershell
# 1) тесты
cd packages\dsh-mobile
& "C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" scripts\run-tests.mjs

# 2) PWA локально (без DSH)
& "<bundled-python>" -m http.server 8765 --bind 127.0.0.1   # из packages\dsh-mobile\web
# http://127.0.0.1:8765/?demo=1  и  ?demo=1&lab=1

# 3) изолированный DSH с плагином
$env:DSH_HOME="C:\…\harness\research\dshtest2"
$env:TEMP="C:\…\harness\research\tmp"   # обход сломанного %TEMP% в песочнице
& "<bundled-node>" "C:\…\research\app\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js" `
    --profile mobile --no-open --port 18081

# 4) cookie + pairing-код
cd research\tools
& "<bundled-node>" probe.mjs pair http://127.0.0.1:18081 "<token из вывода>"
& "<bundled-node>" probe.mjs get  http://127.0.0.1:18081 /m/pair.json --body

# 5) сквозной прогон
& "<bundled-node>" e2e-mobile.mjs <code>
```
