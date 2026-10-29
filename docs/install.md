# Установка и настройка DSH Mobile

## 0. Что понадобится

- DeepSeek Harness **0.2.1-rc.2** (проверено) на Windows; профиль `desktop` или `web`.
- Node.js в комплекте DSH (отдельно ставить не нужно): плагин использует только
  встроенные модули.
- Телефон и ПК в одной сети Wi-Fi. Порты: `3081` (LAN-шлюз) — должен быть свободен.

## 1. Установка плагина

Плагин — локальный пакет `packages/dsh-mobile` в этой папке. Есть три способа.

### 1.1. Через CLI DSH (рекомендуется, `desktop`)

```powershell
# 1) полностью закройте DeepSeek Harness (иначе профиль занят)
# 2) установите пакет как link-зависимость профиля
$cli = "C:\Users\<вы>\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
& $cli plugin --profile desktop add "link:C:\Users\<user>\Documents\deepseek-harness\harness\packages\dsh-mobile"
# 3) запустите DeepSeek Harness
```

`dsh plugin` вызывает pnpm в профиле и после успеха дописывает пакет в
`dsh.profile.bundles` (`$DSH_HOME/profiles/<profile>/package.json`). Ручное
редактирование профиля не требуется и не рекомендуется.

### 1.2. Через страницу Plugins в приложении

Откройте **Settings → Plugins** (или страницу менеджера плагинов) и установите
локальный пакет по пути `…\harness\packages\dsh-mobile`. Способ зависит от версии
UI; CLI из 1.1 воспроизводим и предпочтителен.

### 1.3. В изолированный/тестовый профиль (для разработки)

```powershell
$env:DSH_HOME = "C:\…\harness\research\dshtest2"
& $cli plugin --profile mobile add "link:C:\…\harness\packages\dsh-mobile"
```

Тестовый профиль в этом репозитории уже собран
(`research/dshtest2/profiles/mobile`, см. `research/test-instance.md`); в нём
удобно проверять изменения, не трогая рабочий профиль.

## 2. Первый запуск и pairing

1. После старта DSH откройте на ПК:
   `http://127.0.0.1:<порт DSH>/m/pair`
   (порт виден в `DSH_WEB_URL` или в окне приложения).
2. На странице: 8-символьный код, LAN-адреса, список устройств, кнопки
   «Новый код» / «Отозвать».
3. На телефоне откройте `http://<LAN-IP>:3081/`:
   - «Подключить ПК» → введите адрес и код → «Подключить»;
   - либо откройте `dshm://pair?url=http://<LAN-IP>:3081&code=XXXXXXXX`
     (эту ссылку можно закодировать в QR любым генератором).
4. Появится список сессий. Код одноразовый — после успешной привязки он исчезает.

Проверка «на живом»: `GET http://<LAN-IP>:3081/api/v1/hello` должен вернуть
`{"protocol":1,…}` без токена; `GET /api/v1/sessions` без токена — `401`.

## 3. Конфигурация

Все поля необязательны; правятся в `$DSH_HOME/profiles/<profile>/cordis.patch.yml`
через id `mobile-remote`:

```yaml
- id: mobile-remote
  name: dsh-mobile
  config:
    listenPort: 3081
    pairingTtlSec: 300
    approvals: auto        # auto | relay | observe
    sessionWindowTurns: 1
    sessionWindowEvents: 40
    tls:
      certFile: C:\certs\dsh-mobile.pem   # полная цепочка
      keyFile:  C:\certs\dsh-mobile.key   # PEM без пароля
    debug: false
```

| Поле | По умолчанию | Смысл |
|---|---|---|
| `enabled` | `true` | выключить плагин, не удаляя |
| `listenHost` | `0.0.0.0` | адрес LAN-слушателя; `127.0.0.1` — только локально |
| `listenPort` | `3081` | порт; `0` — выбрать свободный |
| `tls` | — | включить HTTPS на LAN (оба файла обязательны) |
| `publicUrl` | — | внешний адрес за прокси/туннелем |
| `pairingTtlSec` | `300` | TTL кода привязки (30…3600) |
| `maxDevices` | `8` | сколько устройств помнить (старые вытесняются) |
| `sessionWindowTurns` | `1` | минимум ходов в открываемом окне |
| `sessionWindowEvents` | `40` | жёсткий кап событий в окне |
| `maxPromptChars` | `24000` | лимит длины промпта |
| `sseHeartbeatMs` | `15000` | период ping в SSE |
| `apiBodyLimitBytes` | `524288` | лимит JSON-тела |
| `allowCleartext` | `true` | разрешить HTTP на не-loopback (осознанно) |
| `approvals` | `auto` | `auto` — релей, только если десктопный GUI не подключён; `relay` — всегда с телефона; `observe` — только показ, ответ на ПК |
| `dataDir` | `$DSH_HOME/mobile-remote` | где лежит реестр устройств |
| `corsOrigins` | `["*"]` | источники для APK/сторонних обёрток |
| `debug` | `false` | подробный лог запросов |

При смене `tls`/порта нужен перезапуск DSH (listener читает материалы один раз).

## 4. TLS и установка PWA

- Без TLS PWA работает из браузера, но **service worker и полноценная установка
  (standalone) недоступны**: Chrome требует secure context. Иконка на домашнем
  экране будет ярлыком.
- С TLS (`tls.certFile/keyFile`) или через туннель с валидным сертификатом PWA
  ставится как приложение, работает офлайн-оболочка.
- Самоподписанный сертификат нужно один раз принять в браузере телефона; для
  service worker Chrome всё равно требует доверенный сертификат — надёжнее
  локальный CA (mkcert) или Tailscale.

## 5. Обновление

```powershell
# остановить DSH, затем
& $cli plugin --profile desktop add "link:C:\…\harness\packages\dsh-mobile"
# запустить DSH
```

`link:` указывает на рабочую папку, поэтому после правок кода достаточно
перезапустить DSH (ESM-кэш не переживает замену модулей). Файл
`$DSH_HOME/mobile-remote/mobile-remote.json` (привязки) сохраняется.

## 6. Удаление

```powershell
& $cli plugin --profile desktop remove dsh-mobile
# опционально: удалить состояние
Remove-Item -Recurse "$env:USERPROFILE\.dsh\mobile-remote"
```

## 7. Диагностика

| Симптом | Что проверить |
|---|---|
| нет `/m/pair` (404) | плагин не загрузился: `$DSH_HOME/logs/dsh-mobile.log`, строка `apply() start` |
| `:3081` не слушается | занят порт (`listenPort`), либо плагин упал — см. лог |
| телефон не открывает страницу | IP ПК в той же сети, брандмауэр Windows разрешает порт 3081, `listenHost` не `127.0.0.1` |
| `/api/v1/sessions` → 503 | в композиции нет `sessionController` (не web/desktop профиль) |
| 401 после привязки | устройство отозвано или DSH перезапускался с удалённым `mobile-remote.json` |
| 403 на `/m/pair` | страница открыта не на loopback; откройте на самом ПК |
| pairing «код недействителен» | код истёк/использован/попытки исчерпаны — нажмите «Новый код» |
| сессии есть, чат пустой | у сессии нет durable-событий; проверьте `GET /sessions/{id}` вручную |
| Windows Firewall | добавьте правило для входящих TCP 3081 (частная сеть) |

Лог: `$DSH_HOME\logs\dsh-mobile.log` (пишется плагином; в web-профиле DSH
собственного консольного экспортёра нет).

## 8. Безопасность — коротко

- Привязывайте только свои устройства; отзывайте ненужные на `/m/pair`.
- LAN-HTTP: токен виден в трафике — используйте только в доверенной сети.
- Не публикуйте порт 3081 в интернет без TLS и туннеля.
- Плагин не читает секреты DSH и не может выполнять произвольные команды:
  мобильный API ограничен операциями над сессиями.
