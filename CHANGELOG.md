# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/), versions follow SemVer.

## [1.3.0] — 2026-10-29

### RU

- Публичный релиз: репозиторий открыт, из кода и документации удалены имя ПК, LAN-IP
  и локальные пути пользователя; скриншот страницы `/m/pair` переснят с обезличенными
  адресами и пустым списком устройств.
- Добавлены 5 схем работы: путь промпта, approvals, поток событий, границы доверия,
  слои установки (`docs/guide/diagrams/work-*.png`).
- Добавлены 5 скриншотов: светлый список сессий, поиск, композер, подтверждение
  и вопрос агента в светлой теме.
- PDF-инструкция расширена до 19 страниц: приложения с новыми схемами и галереей.
- README: галерея скриншотов и схем, ссылки на GitHub и релиз.

### EN

- Public release: the repository is public; the machine name, LAN addresses and local
  user paths were removed from code and docs; the `/m/pair` screenshot was retaken with
  neutral addresses and an empty device list.
- Added 5 work diagrams: prompt path, approvals, event pipeline, trust boundaries,
  installation layers (`docs/guide/diagrams/work-*.png`).
- Added 5 screenshots: light session list, search, composer, approval and question sheets.
- The PDF manual grew to 19 pages with the new diagram and gallery appendices.
- README: screenshot/diagram gallery plus GitHub and release links.

## [1.2.1] — 2026-10-29

### RU

- Исправлен дубликат нижней панели вопроса: повторный клик по кнопке статуса больше
  не открывает второй question-sheet (`packages/dsh-mobile/web/js/chat.js`).
- Android: исправлена первая реальная ошибка компиляции — `onNewIntent(Intent?)`
  не переопределял `ComponentActivity.onNewIntent(Intent)`.
- Android Lint: устранены `NewApi`-ошибки (атрибуты API 27 перенесены в `values-v27/themes.xml`);
  итог — 0 ошибок, 26 предупреждений.
- Локальный Android-тулчейн: JDK 17.0.20, Android SDK 35 (platform-tools 37.0.1,
  platforms;android-35, build-tools;35.0.0), Gradle 8.9; APK собран локально
  (debug 2.25 МБ, release 1.74 МБ), в APK упакована PWA (26 файлов).
- Обновлены docs/android.md, android/README.md, docs/verification.md, README.

### EN

- Fixed a duplicated question bottom sheet: a second click on the status button no longer
  stacks another sheet (`packages/dsh-mobile/web/js/chat.js`).
- Android: fixed the first real compile error — `onNewIntent(Intent?)` did not override
  `ComponentActivity.onNewIntent(Intent)`.
- Android Lint: resolved `NewApi` errors (API 27 attributes moved to `values-v27/themes.xml`);
  result: 0 errors, 26 warnings.
- Local Android toolchain: JDK 17.0.20, Android SDK 35, Gradle 8.9; the APK is built locally
  (debug 2.25 MB, release 1.74 MB) with the PWA bundled (26 files).
- Updated android docs, README and the verification report.

## [1.2.0] — 2026-10-29

### RU

- Добавлена иллюстрированная PDF-инструкция (16 страниц A4): реальные скриншоты PWA,
  5 SVG-схем, установка, pairing, сессии, approvals, синхронизация, раскладные экраны,
  безопасность, FAQ, ограничения.
- Скриншоты сняты через Chromium DevTools Protocol; публикация страницы `/m/pair`
  подтверждена на живом экземпляре DSH.

### EN

- Added an illustrated PDF manual (16 A4 pages): real PWA screenshots, 5 SVG diagrams,
  installation, pairing, sessions, approvals, sync, foldables, security, FAQ, limitations.
- Screenshots were captured via the Chromium DevTools Protocol; the `/m/pair` page was
  verified on a live DSH instance.

## [1.1.0] — 2026-10-29

### RU

- In-process мост к сессиям DSH: `sessionQuery.observeSession` для холодного чтения,
  шина `session/event` для дельт, `agent/assistant-stream` для живого текста.
- Клиент синхронизации: окно ~35 событий (4.3 КБ gzip), курсор `seq`, догон после обрыва,
  `resync` при разрыве плотности; промпты, остановка, approvals, отзыв устройств.
- PWA: раскладные экраны (viewport segments), IndexedDB-кэш, demo-режим, Layout Lab.

### EN

- In-process session bridge: `sessionQuery.observeSession` for cold-safe reads,
  the `session/event` bus for deltas, `agent/assistant-stream` for live text.
- Sync client: ~35-event window (4.3 KB gzip), `seq` cursor, catch-up after reconnect,
  `resync` on sequence gaps; prompts, stop, approvals, device revocation.
- PWA: foldable layouts (viewport segments), IndexedDB cache, demo mode, Layout Lab.

## [1.0.0] — 2026-10-29

### RU

- Первый выпуск: плагин `dsh-mobile` (LAN-шлюз :3081, pairing-коды и device-токены,
  `/m/pair` на loopback-origin DSH, файловый лог), 20 unit/e2e-тестов.
- Android-обёртка (Kotlin, WebView, deep links `dshm://pair`), CI-workflow сборки APK.
- Документация: архитектура, установка, протокол `/api/v1`, проверки, UX-заметки.

### EN

- First release: `dsh-mobile` plugin (LAN gateway :3081, pairing codes and device tokens,
  `/m/pair` on the DSH loopback origin, file logging), 20 unit/e2e tests.
- Android wrapper (Kotlin, WebView, `dshm://pair` deep links) and an APK build CI workflow.
- Documentation: architecture, installation, `/api/v1` protocol, verification, UX notes.
