# DSH Mobile — Android-обёртка (WebView APK)

Исходники Android-приложения, которое упаковывает мобильный веб-клиент DSH Mobile
в APK, и CI, который собирает этот APK. Клиентская логика живёт в PWA
(`packages/dsh-mobile/web`, его делает отдельная команда), здесь — только нативная
оболочка: экран подключения к ПК, WebView и минимум платформенной интеграции.

> **Статус:** локальный тулчейн установлен и проверен — JDK 17, Android SDK
> (platform-tools, `platforms;android-35`, `build-tools;35.0.0`), Gradle 8.9.
> **APK собран локально:** `app-debug.apk` (2.25 МБ) и `app-release-unsigned.apk`
> (1.74 МБ); wrapper (`gradlew.bat`) сгенерирован, сборка через wrapper тоже проходит.
> Осталось не проверенным только runtime на реальном устройстве — см. «Что проверено».

## Что внутри

```
android/
├── settings.gradle.kts
├── build.gradle.kts
├── gradle.properties
├── gradle/
│   ├── libs.versions.toml                     # все версии зависимостей запинены
│   └── wrapper/gradle-wrapper.properties      # только метаданные, JAR не в репозитории
├── app/
│   ├── build.gradle.kts
│   ├── proguard-rules.pro
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── assets/www/README.txt              # заглушка; реальная PWA копируется сюда
│       ├── java/com/dshmobile/app/
│       │   ├── MainActivity.kt                # WebView, deep links, back, file chooser
│       │   ├── PairingActivity.kt             # адрес ПК + код, GET /api/v1/hello
│       │   ├── ServerStore.kt                 # SharedPreferences (только не-секреты)
│       │   ├── DshApi.kt                      # пробный GET /api/v1/hello
│       │   ├── DshLinks.kt                    # нормализация URL и dshm://pair
│       │   └── BundledAssets.kt               # наличие assets/www/index.html
│       └── res/
│           ├── layout/{activity_main,activity_pairing}.xml
│           ├── values/{strings,colors,dimens,themes}.xml
│           ├── values-ru/strings.xml          # русская локализация
│           ├── values-land/dimens.xml         # ландшафт/сложенный экран
│           ├── values-sw600dp/dimens.xml      # развёрнутая раскладушка/планшет
│           ├── drawable/ (иконка, фоны)
│           ├── mipmap-anydpi-v26/ (adaptive icon)
│           └── xml/network_security_config.xml
├── scripts/sync-web.ps1                       # копирует PWA в assets/www
└── README.md
```

CI лежит в корне репозитория: `.github/workflows/android.yml`.

## Тулчейн (установлен локально)

| Компонент | Версия | Путь |
|---|---|---|
| JDK (Temurin) | 17.0.20.1+1 | `%LOCALAPPDATA%\Programs\jdk-17` |
| Android SDK | platform-tools 37.0.1, `platforms;android-35`, `build-tools;35.0.0` | `%LOCALAPPDATA%\Android\Sdk` |
| Gradle | 8.9 | `%LOCALAPPDATA%\Programs\gradle-8.9` |
| Gradle wrapper | 8.9 (`gradlew.bat` + JAR) | `android/` (JAR в `.gitignore`) |

Переменные `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `GRADLE_HOME` и `PATH`
прописаны в пользовательские переменные окружения — новый терминал их подхватит.
Для уже открытого терминала или для воспроизводимости:

```powershell
. .\android\env.ps1
cd android
.\gradlew.bat assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Эквивалент без wrapper (если wrapper удалён):

```powershell
gradle assembleDebug
```

Полезные проверки:

```powershell
.\gradlew.bat :app:lintDebug        # Android Lint (HTML-отчёт в app/build/reports/lint-results-debug.html)
.\gradlew.bat assembleRelease       # неподписанный release (app-release-unsigned.apk)
```

Первая сборка скачивает зависимости Gradle/AGP/Kotlin (~1–2 минуты на этом канале);
дальше сборка занимает ~30 секунд.

### Встроенная копия PWA (опционально)

```powershell
pwsh -File android/scripts/sync-web.ps1 -Clean
```

Скрипт проверяет наличие `index.html`, копирует статическую сборку `packages/dsh-mobile/web`
в `app/src/main/assets/www` (исключая `node_modules`, `.git`, тесты, `*.map`, `package*.json`)
и не удаляет README-заглушку. Без синхронизации APK работает в remote-режиме: PWA
загружается с ПК. Содержимое `assets/www` — build-артефакт, в git не попадает
(`.gitignore`). CI выполняет ту же копию автоматически, если каталог PWA существует.

Если политика выполнения PowerShell блокирует скрипты:

```powershell
pwsh -ExecutionPolicy Bypass -File android/scripts/sync-web.ps1 -Clean
```

## Как собирает CI

Файл: `.github/workflows/android.yml`.

- Триггеры: `push` с изменениями в `android/**` (и сам workflow), плюс `workflow_dispatch`.
- Runner: `ubuntu-latest`, таймаут 30 минут.
- Шаги: `actions/checkout` → `actions/setup-java` (Temurin 17) →
  `android-actions/setup-android@v3` (ставит cmdline-tools и принимает лицензии) →
  `sdkmanager` ставит `platforms;android-35` и `build-tools;35.0.0` →
  `gradle/actions/setup-gradle@v4` с `gradle-version: 8.9` (wrapper JAR не нужен) →
  опциональный шаг синхронизации PWA из `packages/dsh-mobile/web` (если каталог есть) →
  `gradle assembleDebug` и `gradle assembleRelease` → `actions/upload-artifact@v4`.
- Артефакт: `dsh-mobile-apk` (= `app-debug.apk` + `app-release-unsigned.apk`), хранится 14 дней.
- Ожидаемое время: 5–10 минут на холодном кеше (первая загрузка Gradle/AGP/SDK),
  1–3 минуты на прогретом.

Скачать: вкладка **Actions** → workflow **Android APK** → нужный run → блок **Artifacts**.

## Установка APK

Debug-сборка подписана автоматическим debug-ключом и ставится на устройство:

```powershell
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
# удалить: adb uninstall com.dshmobile.app.debug
```

Без adb: скопировать APK на телефон и открыть в файловом менеджере, разрешив установку
из неизвестных источников для этого приложения. Debug и release можно ставить рядом:
у debug-сборки `applicationId` = `com.dshmobile.app.debug`, у release — `com.dshmobile.app`.

**Release-APK не подписан.** Android не даст установить `app-release-unsigned.apk`:
его нужно подписать своим keystore (`apksigner sign --ks … --out …`). В репозитории нет
ни Play Store-подписи, ни release-keystore, ни AAB — это осознанно.

## Подключение к ПК

1. На ПК запустите DSH и включите мобильный плагин `dsh-mobile` (LAN-порт по умолчанию 3081).
2. Откройте на ПК `http://127.0.0.1:<порт-DSH>/m/pair` — там показаны LAN-адрес,
   QR-код (`dshm://pair?...`), 8-символьный код и TTL.
3. В приложении на первом запуске: адрес ПК (например `http://192.168.1.10:3081`) и
   необязательный код → **Подключить**. Приложение делает `GET /api/v1/hello`
   (без токена, по контракту) и сохраняет адрес. Если порт не указан, подставляется 3081.
4. После успешной проверки открывается PWA с шлюза. Адрес и (если он введён) код
   передаются странице как `?url=...&code=...`: PWA на первом запуске открывает свой
   экран подключения с уже заполненными полями, остаётся нажать «Подключить».
   Код одноразовый (TTL 300 с) и расходуется именно этим `POST /pair`; нативный
   экран его не тратит, потому что проверяет адрес через `GET /api/v1/hello` без токена.
5. Сменить ПК: кнопка «⋮» в правом верхнем углу → «Сменить ПК».
6. QR: встроенного сканера в v1 нет. Можно отсканировать QR любым приложением —
   ссылка `dshm://pair?url=...&code=...` откроет это приложение с заполненными полями.

Если не подключается: проверьте, что телефон и ПК в одной сети Wi-Fi, что брандмауэр
Windows пропускает порт 3081, что на роутере выключена изоляция клиентов (AP isolation)
и что адрес не из другой подсети.

## Безопасность

- **HTTP в локальной сети не шифруется.** При загрузке `http://`-страницы приложение
  показывает жёлтый баннер «Незашифрованный канал». Для HTTPS нужен валидный сертификат:
  самоподписанные сертификаты **не принимаются** (обработчик `SslError` отменяет
  соединение, обхода нет).
- **Токен устройства** (после `POST /api/v1/pair`) хранится в localStorage/IndexedDB PWA
  на origin шлюза. Android-обёртка токен не перехватывает и не дублирует.
  В `SharedPreferences` лежат только не-секреты: адрес, имя хоста, флаг офлайн-режима.
  Поэтому `androidx.security-crypto`/EncryptedSharedPreferences сознательно не используется
  (лишняя альфа-зависимость Tink без выигрыша).
- `android:allowBackup="false"` — хранилище WebView (и токен) не попадает в облачный бэкап.
- Отзыв устройства: на ПК `http://127.0.0.1:<порт>/m/pair` → список устройств → отозвать.
- Внешние ссылки (`https://…` не с шлюза) открываются в системном браузере, а не в WebView.
- Debug-APK подписан общим debug-ключом Android. Release-APK не подписан. Для раздачи
  людям соберите свою подпись.

## Ограничения v1

- Нет встроенного сканера QR и вообще нет разрешения на камеру (только ввод кода и
  обработка внешних `dshm://`-ссылок).
- Нет push/FCM, фоновой синхронизации и виджетов: приложение работает, пока открыто.
- Встроенная офлайн-копия PWA опциональна (`scripts/sync-web.ps1`). Она не умеет ходить
  в API шлюза: `file://` — другой origin, для запросов нужен CORS на шлюзе. Поэтому
  офлайн-копия — экран/кэш, а не полноценный клиент. Основной режим — загрузка PWA с ПК.
- Нет Custom Tabs (внешние ссылки идут через обычный `ACTION_VIEW`), нет линта/юнит-тестов
  как отдельного CI-шага (CI только `assembleDebug`/`assembleRelease`).
- Нет подписи Play Store, нет AAB, нет автоматического версионирования.
- Не проверено на реальном устройстве (Honor Magic V3 в целевой конфигурации не использовался).

## Что проверено, а что нет

**Проверено реальной сборкой (JDK 17 + Android SDK 35 + Gradle 8.9):**
- `gradle assembleDebug assembleRelease` → `BUILD SUCCESSFUL` (72 задачи);
- `gradlew.bat assembleDebug` → `BUILD SUCCESSFUL` (wrapper сам скачал Gradle 8.9);
- APK: `app-debug.apk` 2.25 МБ, `app-release-unsigned.apk` 1.74 МБ (внутри — bundled PWA, 26 файлов);
- `aapt2 dump badging`: `com.dshmobile.app.debug`, minSdk 26, targetSdk 35, compileSdk 35,
  `INTERNET`, label `DSH Mobile` (ru/en);
- найдена и исправлена реальная ошибка компиляции: `onNewIntent(Intent?)` не переопределял
  `ComponentActivity.onNewIntent(Intent)` — теперь сигнатура `onNewIntent(intent: Intent)`.

**Проверено статически ранее:**
- XML-файлы (`AndroidManifest.xml`, layout, values, drawable, mipmap, xml/) — разбор
  `lxml`, все ссылки `@type/name` и `R.type.name` сходятся с определениями ресурсов;
- YAML CI-workflow — синтаксический разбор + проверка структуры;
- `gradle/libs.versions.toml` — разбор TOML, запиненные версии AGP 8.7.3 / Kotlin 2.0.21;
- `scripts/sync-web.ps1` — прогоны на синтетической и на реальной `packages/dsh-mobile/web`;
- handoff к PWA (`?url=&code=`) сверен с фактическим парсером `packages/dsh-mobile/web/js/pair.js`.

**Не проверено:**
- установка и запуск APK на реальном устройстве/эмуляторе (нет подключённого adb-устройства);
- поведение WebView на раскладушке: позиции шарнира, инсеты, поворот/складывание,
  файловый chooser, SSE и авторизация — это runtime-проверки на устройстве;
- первый прогон GitHub Actions.
- Android Lint прогнан: **0 ошибок, 26 предупреждений** (только «доступны новые версии AGP/зависимостей»);
  отчёт: `app/build/reports/lint-results-debug.html`.

## Кратко по-английски (English summary)

Plain Kotlin WebView wrapper for the DSH Mobile PWA. No Compose, no AppCompat, no
third-party UI libraries; dependencies are pinned: `androidx.core:core-ktx`,
`androidx.activity:activity-ktx`, `androidx.webkit:webkit` only (minSdk 26, targetSdk 35,
AGP 8.7.3, Kotlin 2.0.21, Gradle 8.9).

- **Pairing:** first-run screen takes the PC LAN address + optional 8-character code,
  validates it with unauthenticated `GET /api/v1/hello`, persists the origin in plain
  `SharedPreferences` (no secrets there — the device token belongs to the PWA), then loads
  the remote PWA. The address and the typed code are forwarded as `?url=&code=` so the
  PWA's own pairing dialog opens prefilled and the user only confirms it.
- **WebView:** JS/DOM storage, cookies, file chooser, custom `dshm://pair` links, back
  button maps to web history, external links open in the system browser, no TLS-error
  bypass, renderer-crash recovery. Cleartext HTTP is allowed globally (the host is entered
  at runtime so it cannot be scoped statically) and always shows a dismissible warning banner.
- **Foldables:** `resizeableActivity`, `configChanges=orientation|screenSize|smallestScreenSize|
  screenLayout|keyboard|keyboardHidden|uiMode`, edge-to-edge with inset handling, WebView spans
  the hinge; CSS viewport-segment layout is the PWA's job.
- **Two loading modes:** remote PWA from the gateway (recommended, same-origin API/SSE/auth) or
  an optional bundled copy from `assets/www` synced by `android/scripts/sync-web.ps1`
  (offline fallback only).
- **CI:** `.github/workflows/android.yml` builds `app-debug.apk` and an unsigned
  `app-release-unsigned.apk` on `ubuntu-latest` and uploads them as artifacts.
- **Local toolchain:** JDK 17 (Temurin), Android SDK 35 (platform-tools 37.0.1,
  platforms;android-35, build-tools;35.0.0) and Gradle 8.9 are installed; the APK was built
  locally with both `gradle` and the generated `gradlew.bat` (debug 2.25 MB with the bundled PWA, release 1.74 MB).
  Runtime on a physical device is still unverified.
