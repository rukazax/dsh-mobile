# DSH Mobile: PWA и Android-обёртка (интеграционная заметка)

Статус: локальный тулчейн установлен (JDK 17, Android SDK 35, Gradle 8.9), **APK собран
локально**: `app-debug.apk` (2.25 МБ) и `app-release-unsigned.apk` (1.74 МБ), сборка через
Gradle и через сгенерированный wrapper проходит. Не проверен только runtime на реальном
устройстве. Подробности — в `android/README.md` и в конце документа.

## 1. Роли: PWA против APK

| Слой | Где живёт | Что делает |
|---|---|---|
| PWA (`packages/dsh-mobile/web`) | отдаётся шлюзом `dsh-mobile` на `http://<pc>:3081/` | весь UI, протокол `/api/v1/*`, SSE, кэш/IndexedDB, CSS-раскладка под складку |
| APK (`android/`) | телефон | экран подключения к ПК, хранение адреса, WebView-контейнер, deep links, back, file chooser, офлайн-копия PWA |

Смысл WebView-обёртки: PWA в Android-браузере не умеет стабильно `dshm://`-ссылки,
не имеет «родного» первого экрана подключения, а по HTTP в LAN не устанавливается как
PWA (service worker требует HTTPS/localhost). APK даёт установку в один тап, свой
launcher-икон, deep links и предсказуемый WebView вместо произвольного браузера.
PWA при этом остаётся единственным местом, где живёт бизнес-логика: обёртка не знает
протокол сессий и не дублирует ни один экран.

## 2. Как обёртка загружает клиент: две стратегии

**Стратегия A — remote-first (рекомендуемая и реализованная по умолчанию).**
WebView открывает `http://<pc>:3081/`. Страница и API находятся на одном origin, поэтому:
* `Authorization: Bearer` в `fetch` не требует CORS-preflight и настройки заголовков на шлюзе;
* `localStorage`/IndexedDB (токен, курсоры, черновики) лежат в origin шлюза и живут между
  запусками;
* service worker (если шлюз будет отдавать HTTPS) и обычная навигация работают без оговорок;
* PWA всегда свежая: обновили плагин/страницу на ПК — телефон увидел изменения без переустановки APK.

Минус: пока ПК выключен, APK нечего показать (кроме офлайн-копии/ошибки). Для
remote-control клиента это приемлемо: без ПК приложение бесполезно по определению.

Первый запуск: нативный экран проверяет адрес через `GET /api/v1/hello` и открывает
`http://<pc>:3081/?url=...&code=...`. PWA (`js/main.js`, `js/pair.js`) при отсутствии
токена сам открывает экран подключения, читает `url`/`code` из `location.search`
(`readDeepLink()`) и показывает форму уже заполненной — пользователю остаётся подтвердить
`POST /pair`. Токен и вся дальнейшая работа живут внутри PWA; при следующем запуске
параметры не передаются, и PWA сразу открывает список сессий по сохранённому токену.

**Стратегия B — bundled-first (встроенная копия + удалённый API).**
WebView открывает `file:///android_asset/www/index.html`, а API берёт с
`http://<pc>:3081/api/v1`. Плюс: UI доступен при выключенном ПК/плохой сети (кэш, чтение).
Минусы, из-за которых это **не** выбрано основным режимом:
* `file://` — «чужой» origin: запросы к шлюзу требуют CORS (`Access-Control-Allow-Origin`
  для `null`-origin, preflight для `Authorization`), то есть изменений на бэкенде,
  которых нет в контракте `docs/mobile-api.md`;
* `EventSource` не умеет отправлять `Authorization` — токен пришлось бы передавать
  query-параметром или cookie (тоже изменение контракта);
* `localStorage` офлайн-копии и удалённой страницы — разные хранилища, кэш не переиспользуется;
* `defaultBase()` в PWA для `file://` возвращает `http://127.0.0.1:3081/api/v1`, то есть на
  телефоне заведомо неверный адрес; даже если вписать LAN-адрес в настройках PWA, запросы
  упрутся в CORS;
* встроенная копия стареет: её обновление = пересборка и переустановка APK.

Поэтому в v1 обёртка remote-first, а `assets/www` — **явный резервный режим**: меню «⋮ →
Открыть встроенную копию (офлайн)», кнопка на экране ошибки подключения и пункт на экране
подключения. В офлайн-режиме чип в шапке предупреждает «данные могут быть устаревшими».
Если позже понадобится полноценный hybrid-режим, это решение на стороне шлюза
(CORS + cookie/query-токен для SSE) — обёртка к этому готова морфологически, но контракт
сейчас не меняет.

## 3. Обновление встроенной копии PWA

```
packages/dsh-mobile/web  --(android/scripts/sync-web.ps1)-->  android/app/src/main/assets/www
                                                               |
                                                    пересборка APK (gradle assembleDebug)
```

* Скрипт копирует статическую сборку PWA (исключая `node_modules`, `.git`, тесты,
  `*.map`, `package*.json`), проверяет наличие `index.html`, поддерживает `-Clean`.
* Содержимое `assets/www` — build-артефакт: `android/.gitignore` игнорирует всё, кроме
  `README.txt`-заглушки. В git попадает только исходная PWA, а не её копия в APK.
* CI выполняет тот же шаг (`cp -a packages/dsh-mobile/web/. android/app/src/main/assets/www/`),
  если каталог PWA существует; иначе APK собирается без встроенной копии, и
  `BundledAssets.isAvailable()` честно возвращает `false` (меню/кнопки не предлагают то,
  чего нет).
* Обновление «на лету» (без APK) возможно только для remote-режима: обновили страницу на
  ПК — всё. Версия встроенной копии фиксируется версией APK (`versionName` = 0.1.0).

## 4. Точки соприкосновения с контрактом `docs/mobile-api.md`

| Что | Где | Примечание |
|---|---|---|
| `GET /api/v1/hello` | `DshApi.probeHello` (нативный код) | единственный запрос обёртки; без токена, проверяет `protocol == 1`, `hostName`, `appVersion` |
| `POST /api/v1/pair` | PWA | обёртка код **не расходует**; передаёт адрес и код странице как `?url=…&code=…` (формат читает `readDeepLink()` в `js/pair.js`) |
| `dshm://pair?url=&code=` | `DshLinks.parsePairLink`; intent-filter в `MainActivity` | принимаются параметры `url|server|base` и `code|pairingCode|c` |
| `/api/v1/*`, SSE `/stream` | PWA | обёртка не перехватывает и не модифицирует запросы |

Что стоит учесть владельцам бэкенда/PWA (не требует изменений в Android):

1. **SSE и `Authorization`.** Браузерный `EventSource` не умеет отправлять заголовки,
   поэтому PWA уже стримит через `fetch` + `ReadableStream` (`js/sse.js`). В remote-режиме
   это same-origin, и `Authorization: Bearer` работает так, как описано в контракте.
   Если PWA когда-нибудь переведут на `EventSource` или на cross-origin (bundled-режим),
   токен придётся передавать cookie или query-параметром — это изменение контракта,
   а не Android-обёртки.
2. **Передача адреса/кода через `?url=&code=`.** Это фактический формат PWA
   (`readDeepLink()` в `js/pair.js`): страница открывает свой экран подключения с уже
   заполненными полями; нативный `GET /hello` одноразовый код не расходует. Автоматического
   `POST /pair` без подтверждения пользователя нет — и это осознанно (одноразовый код
   остаётся под контролем пользователя). Если PWA захочет полностью одношаговый старт,
   ему достаточно при наличии `?code=` сразу отправлять `POST /pair`.
3. **HTTPS.** Обёртка не обходит ошибки TLS: самоподписанный сертификат будет отклонён.
   Для HTTPS на шлюзе нужен сертификат, которому доверяет Android (или пользовательский
   CA, установленный в системе).

## 5. Раскладушки, инсеты, клавиатура

* `android:resizeableActivity="true"` и `configChanges="orientation|screenSize|smallestScreenSize|screenLayout|keyboard|keyboardHidden|uiMode"`
  у `MainActivity`: складывание/разворачивание и поворот **не пересоздают** WebView,
  поэтому позиция SSE, скролл и черновики не теряются.
* WebView занимает всё окно, включая область шарнира; сегментацию и gutter делает PWA
  через `@media (horizontal-viewport-segments: …)`, `env(viewport-segment-*)`,
  `env(device-posture)`, `env(safe-area-inset-*)` (см. §8 контракта). Обёртка **не**
  пытается вычислять позицию шарнира: единственный View не может «разъехаться» на два окна.
* Edge-to-edge: `enableEdgeToEdge()`, системные инсеты учитывает только нативный chrome
  (баннер, меню, панель ошибки); сам WebView рисуется под системными барами, а safe-area
  внутри страницы обрабатывает PWA.
* IME: `windowSoftInputMode=adjustResize`; страница слушает `visualViewport`, обёртка
  не подменяет это поведение. На экране подключения IME-инсет обрабатывается вручную
  (форма скроллится над клавиатурой).
* Внешний экран Honor Magic V3 (узкий, с вырезом) — однопанельный режим PWA; внутренний
  (2344×2156) — две панели. Это CSS PWA; в APK для этого нет отдельного кода, только
  `values-land`/`values-sw600dp` для отступов нативного экрана подключения.

## 6. Безопасность (сводка)

* **Cleartext HTTP.** Адрес шлюза вводится в рантайме, а network security config статичен,
  поэтому `usesCleartextTraffic="true"` + глобальный `cleartextTrafficPermitted` в
  `res/xml/network_security_config.xml`. Компенсация — жёлтый баннер в приложении при
  каждом `http://` (скрывается на сессию) и постоянные предупреждения в UI подключения.
* **Токен.** Хранится только в web-хранилище PWA (origin шлюза). Нативная часть не пишет
  токен в `SharedPreferences`; там только адрес/имя хоста/флаг офлайна.
  `android:allowBackup="false"` исключает web-хранилище из облачного бэкапа.
  Отзыв — на странице `/m/pair` на ПК.
* **TLS.** Ошибки сертификата не обходятся (`SslErrorHandler.cancel()`).
* **Ссылки.** Всё, что не принадлежит origin шлюза и не `dshm://`, уходит в системный
  браузер через `ACTION_VIEW`; `javascript:`/`data:`/`blob:` остаются в WebView.
* **Разрешения.** Только `INTERNET`. Нет камеры, микрофона, хранилища, геолокации;
  page-запросы `getUserMedia` отклоняются (`PermissionRequest.deny()`).
* **Подпись.** Debug APK — debug-ключ; release — неподписанный артефакт. Play-подписи нет.

## 7. CI и артефакты

`.github/workflows/android.yml` (push по `android/**` и `workflow_dispatch`):
ubuntu-latest, JDK 17 Temurin, `android-actions/setup-android@v3`, установка
`platforms;android-35` + `build-tools;35.0.0`, `gradle/actions/setup-gradle@v4` с
Gradle 8.9 (wrapper JAR в репозитории нет), затем `gradle assembleDebug` и
`gradle assembleRelease`. Артефакт `dsh-mobile-apk`: `app-debug.apk` (устанавливается)
и `app-release-unsigned.apk` (нужна своя подпись). Таблица версий: AGP 8.7.3,
Kotlin 2.0.21, Gradle 8.9, compileSdk/targetSdk 35, minSdk 26.

## 8. Что проверено и что нет

Локальный тулчейн установлен и использован для реальной сборки:

| Компонент | Версия | Путь |
|---|---|---|
| JDK (Temurin) | 17.0.20.1+1 | `%LOCALAPPDATA%\Programs\jdk-17` |
| Android SDK | platform-tools 37.0.1, platforms;android-35, build-tools;35.0.0 | `%LOCALAPPDATA%\Android\Sdk` |
| Gradle | 8.9 | `%LOCALAPPDATA%\Programs\gradle-8.9` |
| Gradle wrapper | 8.9 (сгенерирован локально, JAR в `.gitignore`) | `android/` |

**Проверено сборкой:**
- `gradle assembleDebug assembleRelease` → `BUILD SUCCESSFUL`, 72 задачи;
- `gradlew.bat assembleDebug` (wrapper) → `BUILD SUCCESSFUL`, дистрибутив скачан wrapper'ом;
- `aapt2 dump badging` подтверждает `com.dshmobile.app.debug`, minSdk 26, targetSdk 35,
  compileSdk 35, разрешение `INTERNET`, label `DSH Mobile` (ru/en);
- найдена и исправлена первая реальная ошибка компиляции: `onNewIntent(Intent?)` не
  переопределяет `ComponentActivity.onNewIntent(Intent)` — сигнатура исправлена на non-null;
- Kotlin/AGP/Gradle конфигурация компилируется без ошибок (есть только deprecation-варнинги
  Kotlin DSL, не влияющие на сборку).

**Проверено статически ранее:** well-formedness всех XML (`lxml`), YAML CI-workflow,
TOML каталога версий, согласованность ссылок на ресурсы, прогоны `sync-web.ps1`.

**Android Lint:** прогнан (`gradlew :app:lintDebug`) — **0 ошибок, 26 предупреждений**
(только «доступны новые версии AGP/зависимостей»). Два исходных `NewApi`-замечания закрыты
выносом API-27-атрибутов (`windowLightNavigationBar`, `windowLayoutInDisplayCutoutMode`)
в `values-v27/themes.xml`. Отчёт: `app/build/reports/lint-results-debug.html`.

**Bundled PWA:** `sync-web.ps1` скопировал 26 файлов (0.3 МБ) в `app/src/main/assets/www`;
в APK подтверждены `assets/www/index.html`, `assets/www/js/main.js`, `assets/www/styles/layout.css`.

**Не проверено:** установка и runtime на реальном устройстве (шарнир, инсеты, file chooser,
SSE, авторизация), первый запуск GitHub Actions.
