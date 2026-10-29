/* DSH Mobile — i18n. Russian is the default (the device owner is Russian).
 * Every user-visible string lives here; components never hardcode copy.
 */

const dict = {
  ru: {
    'app.title': 'DSH Mobile',
    'app.tagline': 'пульт DeepSeek Harness',

    'common.close': 'Закрыть',
    'common.cancel': 'Отмена',
    'common.back': 'Назад',
    'common.retry': 'Повторить',
    'common.refresh': 'Обновить',
    'common.save': 'Сохранить',
    'common.ok': 'ОК',
    'common.copy': 'Копировать',
    'common.copied': 'Скопировано',
    'common.loading': 'Загрузка…',
    'common.error': 'Ошибка',
    'common.settings': 'Настройки',
    'common.search': 'Поиск',
    'common.clear': 'Очистить',
    'common.never': 'никогда',
    'common.unknown': 'неизвестно',
    'common.online': 'онлайн',
    'common.offline': 'офлайн',
    'common.demo': 'Демо',
    'common.more': 'Ещё',
    'common.now': 'сейчас',
    'common.yes': 'Да',
    'common.no': 'Нет',

    'a11y.skipToSessions': 'К списку сессий',
    'a11y.sessionsPane': 'Список сессий',
    'a11y.chatPane': 'Диалог',
    'a11y.streaming': 'Ассистент отвечает',
    'a11y.streamDone': 'Ответ готов',
    'a11y.newMessages': 'Новые сообщения',
    'a11y.nav': 'Основная навигация',

    'conn.connected': 'Подключено',
    'conn.connecting': 'Подключение…',
    'conn.reconnecting': 'Переподключение…',
    'conn.suspended': 'Поток на паузе',
    'conn.offline': 'Нет сети',
    'conn.error': 'Ошибка потока',
    'conn.live': 'В эфире',
    'conn.streamIdle': 'Поток не активен',
    'conn.demo': 'демо-режим',
    'conn.insecure': 'Незашифрованный канал (HTTP)',
    'conn.insecureHint':
      'Трафик виден в локальной сети. Для HTTPS настройте сертификат в DSH или используйте APK.',
    'conn.tapToRetry': 'Нажмите, чтобы переподключиться',
    'conn.idle': 'Ожидание',

    'pair.title': 'Подключить ПК',
    'pair.subtitle':
      'Откройте DSH на компьютере, страницу «Мобильный доступ» (/m/pair), и перенесите оттуда адрес и код.',
    'pair.server': 'Адрес DSH',
    'pair.serverPlaceholder': 'http://192.168.1.10:3081',
    'pair.serverHint': 'Адрес и порт из QR-кода или окна DSH. Схема http:// или https://.',
    'pair.code': 'Код подключения',
    'pair.codePlaceholder': 'A1B2C3D4',
    'pair.device': 'Имя устройства',
    'pair.devicePlaceholder': 'Honor Magic V3',
    'pair.submit': 'Подключиться',
    'pair.submitting': 'Подключаемся…',
    'pair.stepsTitle': 'Как это работает',
    'pair.step1': 'На ПК откройте DSH → «Мобильный доступ». Там будет QR и 8-символьный код.',
    'pair.step2': 'Введите адрес и код здесь — или вставьте ссылку dshm://pair из QR.',
    'pair.step3': 'После сопряжения сессии и живой поток появятся на этом экране.',
    'pair.insecureTitle': 'Канал без шифрования',
    'pair.insecureText':
      'Адрес начинается с http://. В локальной сети трафик может быть перехвачен. Для HTTPS настройте сертификат в DSH.',
    'pair.paste': 'Ссылка из QR-кода',
    'pair.pastePlaceholder': 'dshm://pair?url=http://192.168.1.10:3081&code=A1B2C3D4',
    'pair.pasteApply': 'Разобрать ссылку',
    'pair.pasteError': 'Не удалось разобрать ссылку. Нужен формат dshm://pair?url=…&code=…',
    'pair.success': 'ПК подключён',
    'pair.errorInvalid': 'Неверный код. Проверьте код на экране ПК.',
    'pair.errorExpired': 'Код истёк. Обновите страницу /m/pair на компьютере.',
    'pair.errorRate': 'Слишком много попыток. Подождите минуту.',
    'pair.errorNetwork': 'Не удалось связаться с ПК. Проверьте адрес и Wi-Fi.',
    'pair.demoTitle': 'Нет ПК под рукой?',
    'pair.demoText': 'Посмотрите интерфейс в демо-режиме — с сессиями, стримом и подтверждениями.',
    'pair.openDemo': 'Открыть демо',
    'pair.manualTitle': 'Вручную',
    'pair.manualHint': 'Адрес и код можно ввести без сканера.',

    'sessions.title': 'Сессии',
    'sessions.count': ['сессия', 'сессии', 'сессий'],
    'sessions.searchPlaceholder': 'Поиск по сессиям',
    'sessions.emptyTitle': 'Пока нет сессий',
    'sessions.emptyHint': 'Создайте сессию на ПК или новую прямо здесь.',
    'sessions.emptyFiltered': 'Ничего не найдено',
    'sessions.emptyFilteredHint': 'Попробуйте другой запрос.',
    'sessions.new': 'Новая сессия',
    'sessions.creating': 'Создаём…',
    'sessions.refresh': 'Обновить список',
    'sessions.pull': 'Потяните, чтобы обновить',
    'sessions.release': 'Отпустите, чтобы обновить',
    'sessions.error': 'Не удалось загрузить сессии',
    'sessions.footer': 'Обновляется по SSE · без опроса',
    'sessions.status.running': 'работает',
    'sessions.status.idle': 'простой',
    'sessions.status.blocked': 'ждёт решения',
    'sessions.status.queued': 'в очереди',
    'sessions.approval': 'Подтверждение',
    'sessions.question': 'Вопрос',
    'sessions.events': ['событие', 'события', 'событий'],
    'sessions.active': 'Текущая сессия',
    'sessions.cached': 'из кэша',
    'sessions.updated': 'обновлено',
    'sessions.newFailed': 'Не удалось создать сессию',
    'sessions.newDemoHint': 'Демо-сессия создана',

    'chat.emptyTitle': 'Выберите сессию',
    'chat.emptyHint': 'Список сессий — слева. Можно открыть другую или создать новую.',
    'chat.emptySessionTitle': 'Начните диалог',
    'chat.emptySessionHint': 'Напишите запрос внизу — агент ответит потоком.',
    'chat.noSession': 'Сессия не открыта',
    'chat.back': 'К списку сессий',
    'chat.status.running': 'выполняется',
    'chat.status.idle': 'готово',
    'chat.status.blocked': 'ждёт вашего решения',
    'chat.status.queued': 'в очереди',
    'chat.composerPlaceholder': 'Сообщение для агента…',
    'chat.composerHint': 'Ctrl+Enter — отправить · Enter — перенос строки',
    'chat.send': 'Отправить',
    'chat.mode.send': 'Отправить',
    'chat.mode.queue': 'В очередь',
    'chat.mode.steer': 'Перехватить',
    'chat.mode.hint.send': 'Ответить в текущий ход',
    'chat.mode.hint.queue': 'Поставить после текущего хода',
    'chat.mode.hint.steer': 'Вклиниться в текущий ход',
    'chat.stop': 'Остановить',
    'chat.stopHint': 'Остановить текущий ход',
    'chat.queue': ['задача в очереди', 'задачи в очереди', 'задач в очереди'],
    'chat.older': 'Показать старше',
    'chat.loadingOlder': 'Загружаем…',
    'chat.olderFailed': 'Не удалось загрузить историю',
    'chat.noOlder': 'Это начало сессии',
    'chat.jump': 'К последнему',
    'chat.newMessages': ['новое сообщение', 'новых сообщения', 'новых сообщений'],
    'chat.approval.title': 'Нужно подтверждение',
    'chat.approval.subtitle': 'Агент ждёт вашего решения',
    'chat.approval.allow': 'Разрешить',
    'chat.approval.deny': 'Запретить',
    'chat.approval.remember': 'Запомнить выбор',
    'chat.approval.detail': 'Детали',
    'chat.approval.sending': 'Отправляем…',
    'chat.approval.done': 'Решение отправлено',
    'chat.approval.failed': 'Не удалось отправить решение',
    'chat.question.title': 'Вопрос от агента',
    'chat.question.subtitle': 'Ответьте, чтобы продолжить',
    'chat.question.placeholder': 'Свой ответ…',
    'chat.question.submit': 'Ответить',
    'chat.question.custom': 'Свой вариант',
    'chat.question.done': 'Ответ отправлен',
    'chat.question.failed': 'Не удалось отправить ответ',
    'chat.tool.args': 'Аргументы',
    'chat.tool.result': 'Результат',
    'chat.tool.pending': 'выполняется',
    'chat.tool.ok': 'успешно',
    'chat.tool.failed': 'ошибка',
    'chat.tool.truncated': 'обрезано',
    'chat.notice': 'Уведомление',
    'chat.errorEvent': 'Ошибка агента',
    'chat.resync': 'Синхронизация…',
    'chat.you': 'Вы',
    'chat.assistant': 'Ассистент',
    'chat.sendFailed': 'Сообщение не отправлено',
    'chat.sendQueued': 'Поставлено в очередь',
    'chat.stopped': 'Ход остановлен',
    'chat.stopFailed': 'Не удалось остановить',
    'chat.sessionNotFound': 'Сессия не найдена',
    'chat.archivedTitle': 'Сессия в архиве',
    'chat.archivedText': 'Просмотр доступен, отправка — нет.',
    'chat.connectionLost': 'Поток прерван, переподключаемся…',
    'chat.retryConnect': 'Переподключиться',
    'chat.streamStarted': 'Ассистент печатает',
    'chat.msgPending': 'отправляется',
    'chat.sessionRunning': 'Агент работает…',

    'settings.title': 'Настройки',
    'settings.connection': 'Подключение',
    'settings.server': 'Сервер',
    'settings.serverHint': 'Адрес мобильного API, обычно http://<ip>:3081/api/v1',
    'settings.changeServer': 'Изменить',
    'settings.paired': 'Устройство сопряжено',
    'settings.notPaired': 'Не сопряжено',
    'settings.device': 'Устройство',
    'settings.deviceName': 'Имя',
    'settings.host': 'Хост DSH',
    'settings.protocol': 'Протокол',
    'settings.language': 'Язык',
    'settings.theme': 'Тема',
    'settings.theme.auto': 'Системная',
    'settings.theme.light': 'Светлая',
    'settings.theme.dark': 'Тёмная',
    'settings.fontSize': 'Размер текста',
    'settings.fontSizeHint': 'Применяется ко всему интерфейсу',
    'settings.diagnostics': 'Диагностика',
    'settings.diag.requests': 'Запросов',
    'settings.diag.bytes': 'Получено',
    'settings.diag.rtt': 'RTT',
    'settings.diag.sse': 'SSE',
    'settings.diag.sseEvents': 'SSE-событий',
    'settings.diag.resyncs': 'Ресинков',
    'settings.diag.cacheSessions': 'Сессий в кэше',
    'settings.diag.cacheEvents': 'Событий в кэше',
    'settings.diag.lastSync': 'Синхронизация',
    'settings.diag.serverTime': 'Время сервера',
    'settings.actions': 'Действия',
    'settings.refreshAll': 'Обновить всё',
    'settings.clearCache': 'Очистить кэш',
    'settings.clearCacheConfirm':
      'Удалить кэш сессий, событий и черновиков? Офлайн-просмотр перестанет работать.',
    'settings.cacheCleared': 'Кэш очищен',
    'settings.revoke': 'Отозвать устройство',
    'settings.revokeConfirm': 'Отозвать это устройство? Потребуется повторное сопряжение.',
    'settings.revokeDone': 'Устройство отозвано',
    'settings.disconnect': 'Отключиться',
    'settings.disconnectConfirm': 'Отключиться и удалить токен с телефона?',
    'settings.openLab': 'Layout Lab (раскладки)',
    'settings.openDemo': 'Демо-режим',
    'settings.about': 'О приложении',
    'settings.aboutText':
      'DSH Mobile — пульт для DeepSeek Harness. Ноль зависимостей, ноль сборки, SSE без опроса.',
    'settings.version': 'Версия',
    'settings.endpoint': 'Endpoint',
    'settings.state': 'Состояние',
    'settings.none': '—',
    'settings.labHint': 'Симуляция 1–2 сегментов на обычном экране',
    'settings.demoHint': 'Мок-транспорт, реальные жесты',
    'settings.deviceHint': 'Так устройство видно на странице /m/pair',
    'settings.noDevice': 'Сопряжение не выполнено',
    'settings.diagHint': 'Счётчики живые: обновите экран, чтобы увидеть рост.',
    'settings.serverSaved': 'Адрес сохранён',
    'settings.serverInvalid': 'Нужен адрес вида http://host:port/api/v1',
    'settings.languageHint': 'Русский интерфейс по умолчанию',

    'lab.title': 'Layout Lab',
    'lab.subtitle':
      'Симуляция раскладки. Настоящие сегменты определяются CSS-медиа и env(viewport-segment-*), здесь — те же переменные, но управляемые вручную.',
    'lab.layout': 'Раскладка',
    'lab.single': '1 сегмент',
    'lab.dual': '2 сегмента',
    'lab.rail': 'Планшет',
    'lab.width': 'Ширина',
    'lab.hinge': 'Шов',
    'lab.posture': 'Поза',
    'lab.posture.folded': 'Сложен',
    'lab.posture.unfolded': 'Раскрыт',
    'lab.realSegments': 'Реальные сегменты',
    'lab.detected': 'обнаружено сегментов: {n}',
    'lab.notSupported': 'браузер не сообщает о сегментах',
    'lab.envSupported': 'env(viewport-segment-*) поддерживается',
    'lab.envUnsupported': 'env(viewport-segment-*) не поддерживается',
    'lab.note':
      'На Honor Magic V3 раскрытый внутренний экран даёт два вертикальных сегмента: список слева, диалог справа. Сложенный внешний — один сегмент со слайд-навигацией. Черновик, скролл, открытая сессия и живой поток не сбрасываются: раскладка меняется только через CSS.',
    'lab.reset': 'Сбросить',
    'lab.openDemo': 'Демо-режим',
    'lab.hint': 'Откройте ?demo=1&lab=1, чтобы разложить демо по сегментам.',
    'lab.current': 'Сейчас',
    'lab.envValue': 'env-значения',
    'lab.seg0': 'сегмент 0',
    'lab.seg1': 'сегмент 1',
    'lab.hingeWidth': 'шов',
    'lab.frameHint': 'Рамка вокруг — симуляция устройства, не реальный viewport.',
    'lab.viewport': 'Viewport',
    'lab.custom': 'Своя',
    'lab.explainTitle': 'Что проверяем',
    'lab.explain':
      'Переключите раскладку при открытой сессии: черновик в поле ввода, позиция скролла и живой стрим должны остаться. Шов никогда не пересекается контентом.',

    'err.network': 'Нет связи с сервером',
    'err.timeout': 'Сервер не ответил вовремя',
    'err.auth': 'Сеанс истёк. Подключите ПК заново.',
    'err.pairing': 'Код не подошёл',
    'err.rate': 'Слишком много запросов. Подождите.',
    'err.server': 'Ошибка на стороне DSH',
    'err.unknown': 'Неизвестная ошибка',
    'err.session': 'Сессия недоступна',
    'err.busy': 'Агент занят',
    'err.unsupported': 'Не поддерживается этой версией DSH',
    'err.approval': 'Подтверждение устарело',
    'err.promptInvalid': 'Пустой или слишком длинный запрос',
    'err.offline': 'Телефон офлайн',
    'err.noAuth': 'Сначала подключите ПК',

    'demo.banner':
      'Демо-режим: данные и поток имитируются локально. Ничего не отправляется на ПК.',
    'demo.sessionTitle': 'Демо-сессия',
    'demo.reply':
      'Это демо-ответ. В реальном режиме здесь будет поток от агента DSH — чанки, tool-карточки и подтверждения.',
    'demo.live1': 'Смотрю проект и проверяю сборку…',
    'demo.live2': 'Проверяю файлы и тесты.',
    'demo.approvalTitle': 'Разрешить выполнение команды?',
    'demo.approvalDetail': 'bash -lc "pnpm -C packages/dsh-mobile test"',
    'demo.question': 'Какой вариант пагинации предпочитаете?',
    'demo.questionOption1': 'Курсор по seq',
    'demo.questionOption2': 'Смещение по времени',
    'demo.promptAccepted': 'Демо: запрос принят',
    'demo.introLive': 'Запускаю линтер и проверяю вывод сборки…',
    'demo.introDone':
      'Линтер чистый, все 42 теста зелёные. Пагинация исправлена — можно коммитить.',
    'demo.think': 'Смотрю, что уже есть в проекте по этой задаче.',
    'demo.turnReply':
      'Готово: проверил файлы, прогнал тесты и подготовил изменения. Это демо-ответ — в реальном режиме сюда придёт поток от агента DSH.',
    'demo.toolCommand': '{"command":"pnpm -C packages/dsh-mobile test"}',
    'demo.toolOutput': '✓ 42 tests passed',
    'demo.approved': 'Команда выполнена, ревью PR #1281 запущено.',
    'demo.answered': 'Принято: «{answer}». Делаю по выбранному варианту.',
    'demo.stopped': 'Ход остановлен пользователем.',
    'demo.newSession': 'Новая демо-сессия',
    'demo.newPrompt': 'Что нужно сделать?',
  },

  en: {
    'app.title': 'DSH Mobile',
    'app.tagline': 'DeepSeek Harness remote',

    'common.close': 'Close',
    'common.cancel': 'Cancel',
    'common.back': 'Back',
    'common.retry': 'Retry',
    'common.refresh': 'Refresh',
    'common.save': 'Save',
    'common.ok': 'OK',
    'common.copy': 'Copy',
    'common.copied': 'Copied',
    'common.loading': 'Loading…',
    'common.error': 'Error',
    'common.settings': 'Settings',
    'common.search': 'Search',
    'common.clear': 'Clear',
    'common.never': 'never',
    'common.unknown': 'unknown',
    'common.online': 'online',
    'common.offline': 'offline',
    'common.demo': 'Demo',
    'common.more': 'More',
    'common.now': 'now',
    'common.yes': 'Yes',
    'common.no': 'No',

    'a11y.skipToSessions': 'Skip to sessions',
    'a11y.sessionsPane': 'Session list',
    'a11y.chatPane': 'Conversation',
    'a11y.streaming': 'Assistant is replying',
    'a11y.streamDone': 'Reply complete',
    'a11y.newMessages': 'New messages',
    'a11y.nav': 'Main navigation',

    'conn.connected': 'Connected',
    'conn.connecting': 'Connecting…',
    'conn.reconnecting': 'Reconnecting…',
    'conn.suspended': 'Stream paused',
    'conn.offline': 'No network',
    'conn.error': 'Stream error',
    'conn.live': 'Live',
    'conn.streamIdle': 'Stream idle',
    'conn.demo': 'demo mode',
    'conn.insecure': 'Unencrypted channel (HTTP)',
    'conn.insecureHint': 'Traffic is visible on the local network. Use HTTPS or the APK.',
    'conn.tapToRetry': 'Tap to reconnect',
    'conn.idle': 'Idle',

    'pair.title': 'Connect desktop',
    'pair.subtitle':
      'Open DSH on the computer, go to the mobile access page (/m/pair), and copy the address and code.',
    'pair.server': 'DSH address',
    'pair.serverPlaceholder': 'http://192.168.1.10:3081',
    'pair.serverHint': 'Host and port from the QR code or the DSH window. http:// or https://.',
    'pair.code': 'Pairing code',
    'pair.codePlaceholder': 'A1B2C3D4',
    'pair.device': 'Device name',
    'pair.devicePlaceholder': 'Honor Magic V3',
    'pair.submit': 'Connect',
    'pair.submitting': 'Connecting…',
    'pair.stepsTitle': 'How it works',
    'pair.step1': 'On the PC open DSH → Mobile access. You will see a QR code and an 8-character code.',
    'pair.step2': 'Enter the address and code here — or paste the dshm://pair link from the QR.',
    'pair.step3': 'After pairing, sessions and the live stream show up here.',
    'pair.insecureTitle': 'Unencrypted channel',
    'pair.insecureText':
      'The address starts with http://. Traffic on the local network may be intercepted. Configure a certificate in DSH for HTTPS.',
    'pair.paste': 'Link from the QR code',
    'pair.pastePlaceholder': 'dshm://pair?url=http://192.168.1.10:3081&code=A1B2C3D4',
    'pair.pasteApply': 'Parse link',
    'pair.pasteError': 'Could not parse the link. Expected dshm://pair?url=…&code=…',
    'pair.success': 'Desktop connected',
    'pair.errorInvalid': 'Wrong code. Check the code on the PC screen.',
    'pair.errorExpired': 'The code expired. Reload /m/pair on the computer.',
    'pair.errorRate': 'Too many attempts. Wait a minute.',
    'pair.errorNetwork': 'Could not reach the PC. Check the address and Wi-Fi.',
    'pair.demoTitle': 'No desktop nearby?',
    'pair.demoText': 'Explore the interface in demo mode with sessions, streaming and approvals.',
    'pair.openDemo': 'Open demo',
    'pair.manualTitle': 'Manual',
    'pair.manualHint': 'You can type the address and code without a scanner.',

    'sessions.title': 'Sessions',
    'sessions.count': ['session', 'sessions'],
    'sessions.searchPlaceholder': 'Search sessions',
    'sessions.emptyTitle': 'No sessions yet',
    'sessions.emptyHint': 'Create one on the PC or start a new session right here.',
    'sessions.emptyFiltered': 'Nothing found',
    'sessions.emptyFilteredHint': 'Try another query.',
    'sessions.new': 'New session',
    'sessions.creating': 'Creating…',
    'sessions.refresh': 'Refresh list',
    'sessions.pull': 'Pull to refresh',
    'sessions.release': 'Release to refresh',
    'sessions.error': 'Could not load sessions',
    'sessions.footer': 'Updated over SSE · no polling',
    'sessions.status.running': 'running',
    'sessions.status.idle': 'idle',
    'sessions.status.blocked': 'waiting for you',
    'sessions.status.queued': 'queued',
    'sessions.approval': 'Approval',
    'sessions.question': 'Question',
    'sessions.events': ['event', 'events'],
    'sessions.active': 'Current session',
    'sessions.cached': 'from cache',
    'sessions.updated': 'updated',
    'sessions.newFailed': 'Could not create a session',
    'sessions.newDemoHint': 'Demo session created',

    'chat.emptyTitle': 'Pick a session',
    'chat.emptyHint': 'The list is on the left. Open another session or create a new one.',
    'chat.emptySessionTitle': 'Start the conversation',
    'chat.emptySessionHint': 'Type a prompt below — the agent answers as a stream.',
    'chat.noSession': 'No session open',
    'chat.back': 'Back to sessions',
    'chat.status.running': 'running',
    'chat.status.idle': 'ready',
    'chat.status.blocked': 'waiting for you',
    'chat.status.queued': 'queued',
    'chat.composerPlaceholder': 'Message the agent…',
    'chat.composerHint': 'Ctrl+Enter — send · Enter — newline',
    'chat.send': 'Send',
    'chat.mode.send': 'Send',
    'chat.mode.queue': 'Queue',
    'chat.mode.steer': 'Steer',
    'chat.mode.hint.send': 'Reply in the current turn',
    'chat.mode.hint.queue': 'Queue after the current turn',
    'chat.mode.hint.steer': 'Cut into the running turn',
    'chat.stop': 'Stop',
    'chat.stopHint': 'Stop the current turn',
    'chat.queue': ['queued item', 'queued items'],
    'chat.older': 'Load older',
    'chat.loadingOlder': 'Loading…',
    'chat.olderFailed': 'Could not load history',
    'chat.noOlder': 'Start of the session',
    'chat.jump': 'Latest',
    'chat.newMessages': ['new message', 'new messages'],
    'chat.approval.title': 'Approval required',
    'chat.approval.subtitle': 'The agent is waiting for your decision',
    'chat.approval.allow': 'Allow',
    'chat.approval.deny': 'Deny',
    'chat.approval.remember': 'Remember my choice',
    'chat.approval.detail': 'Details',
    'chat.approval.sending': 'Sending…',
    'chat.approval.done': 'Decision sent',
    'chat.approval.failed': 'Could not send the decision',
    'chat.question.title': 'Question from the agent',
    'chat.question.subtitle': 'Answer to continue',
    'chat.question.placeholder': 'Custom answer…',
    'chat.question.submit': 'Answer',
    'chat.question.custom': 'Custom answer',
    'chat.question.done': 'Answer sent',
    'chat.question.failed': 'Could not send the answer',
    'chat.tool.args': 'Arguments',
    'chat.tool.result': 'Result',
    'chat.tool.pending': 'running',
    'chat.tool.ok': 'ok',
    'chat.tool.failed': 'failed',
    'chat.tool.truncated': 'truncated',
    'chat.notice': 'Notice',
    'chat.errorEvent': 'Agent error',
    'chat.resync': 'Resyncing…',
    'chat.you': 'You',
    'chat.assistant': 'Assistant',
    'chat.sendFailed': 'Message not sent',
    'chat.sendQueued': 'Queued',
    'chat.stopped': 'Turn stopped',
    'chat.stopFailed': 'Could not stop',
    'chat.sessionNotFound': 'Session not found',
    'chat.archivedTitle': 'Session archived',
    'chat.archivedText': 'Read-only: sending is disabled.',
    'chat.connectionLost': 'Stream interrupted, reconnecting…',
    'chat.retryConnect': 'Reconnect',
    'chat.streamStarted': 'Assistant is typing',
    'chat.msgPending': 'sending',
    'chat.sessionRunning': 'Agent is working…',

    'settings.title': 'Settings',
    'settings.connection': 'Connection',
    'settings.server': 'Server',
    'settings.serverHint': 'Mobile API address, usually http://<ip>:3081/api/v1',
    'settings.changeServer': 'Change',
    'settings.paired': 'Device paired',
    'settings.notPaired': 'Not paired',
    'settings.device': 'Device',
    'settings.deviceName': 'Name',
    'settings.host': 'DSH host',
    'settings.protocol': 'Protocol',
    'settings.language': 'Language',
    'settings.theme': 'Theme',
    'settings.theme.auto': 'System',
    'settings.theme.light': 'Light',
    'settings.theme.dark': 'Dark',
    'settings.fontSize': 'Text size',
    'settings.fontSizeHint': 'Applies to the whole UI',
    'settings.diagnostics': 'Diagnostics',
    'settings.diag.requests': 'Requests',
    'settings.diag.bytes': 'Received',
    'settings.diag.rtt': 'RTT',
    'settings.diag.sse': 'SSE',
    'settings.diag.sseEvents': 'SSE events',
    'settings.diag.resyncs': 'Resyncs',
    'settings.diag.cacheSessions': 'Cached sessions',
    'settings.diag.cacheEvents': 'Cached events',
    'settings.diag.lastSync': 'Last sync',
    'settings.diag.serverTime': 'Server time',
    'settings.actions': 'Actions',
    'settings.refreshAll': 'Refresh everything',
    'settings.clearCache': 'Clear cache',
    'settings.clearCacheConfirm': 'Delete cached sessions, events and drafts? Offline viewing will stop working.',
    'settings.cacheCleared': 'Cache cleared',
    'settings.revoke': 'Revoke device',
    'settings.revokeConfirm': 'Revoke this device? You will need to pair again.',
    'settings.revokeDone': 'Device revoked',
    'settings.disconnect': 'Disconnect',
    'settings.disconnectConfirm': 'Disconnect and remove the token from this phone?',
    'settings.openLab': 'Layout Lab (foldables)',
    'settings.openDemo': 'Demo mode',
    'settings.about': 'About',
    'settings.aboutText': 'DSH Mobile is a remote for DeepSeek Harness. Zero dependencies, no build step, SSE instead of polling.',
    'settings.version': 'Version',
    'settings.endpoint': 'Endpoint',
    'settings.state': 'State',
    'settings.none': '—',
    'settings.labHint': 'Simulate 1–2 segments on a regular screen',
    'settings.demoHint': 'Mock transport, real gestures',
    'settings.deviceHint': 'This is how the device appears on /m/pair',
    'settings.noDevice': 'Not paired yet',
    'settings.diagHint': 'Live counters: refresh to watch them grow.',
    'settings.serverSaved': 'Address saved',
    'settings.serverInvalid': 'Expected http://host:port/api/v1',
    'settings.languageHint': 'Russian is the default UI language',

    'lab.title': 'Layout Lab',
    'lab.subtitle':
      'Layout simulation. Real segments come from CSS media queries and env(viewport-segment-*); here the same variables are driven manually.',
    'lab.layout': 'Layout',
    'lab.single': '1 segment',
    'lab.dual': '2 segments',
    'lab.rail': 'Tablet',
    'lab.width': 'Width',
    'lab.hinge': 'Hinge',
    'lab.posture': 'Posture',
    'lab.posture.folded': 'Folded',
    'lab.posture.unfolded': 'Unfolded',
    'lab.realSegments': 'Real segments',
    'lab.detected': 'segments detected: {n}',
    'lab.notSupported': 'browser reports no segments',
    'lab.envSupported': 'env(viewport-segment-*) supported',
    'lab.envUnsupported': 'env(viewport-segment-*) unsupported',
    'lab.note':
      'On the Honor Magic V3 the unfolded inner screen provides two vertical segments: list on the left, conversation on the right. Folded outer screen is a single segment with slide navigation. Draft, scroll position, open session and the live stream are preserved — the layout is CSS-only.',
    'lab.reset': 'Reset',
    'lab.openDemo': 'Demo mode',
    'lab.hint': 'Open ?demo=1&lab=1 to spread the demo across segments.',
    'lab.current': 'Now',
    'lab.envValue': 'env values',
    'lab.seg0': 'segment 0',
    'lab.seg1': 'segment 1',
    'lab.hingeWidth': 'hinge',
    'lab.frameHint': 'The frame is a device simulation, not the real viewport.',
    'lab.viewport': 'Viewport',
    'lab.custom': 'Custom',
    'lab.explainTitle': 'What to check',
    'lab.explain':
      'Switch layouts while a session is open: the composer draft, scroll position and live stream must survive. Content must never cross the hinge.',

    'err.network': 'Cannot reach the server',
    'err.timeout': 'The server did not answer in time',
    'err.auth': 'Session expired. Pair the desktop again.',
    'err.pairing': 'Pairing code rejected',
    'err.rate': 'Too many requests. Wait a moment.',
    'err.server': 'DSH-side error',
    'err.unknown': 'Unknown error',
    'err.session': 'Session unavailable',
    'err.busy': 'Agent is busy',
    'err.unsupported': 'Not supported by this DSH version',
    'err.approval': 'Approval is stale',
    'err.promptInvalid': 'Empty or too long prompt',
    'err.offline': 'Phone is offline',
    'err.noAuth': 'Pair a desktop first',

    'demo.banner': 'Demo mode: data and stream are simulated locally. Nothing is sent to the desktop.',
    'demo.sessionTitle': 'Demo session',
    'demo.reply': 'This is a demo reply. In real mode this is the DSH agent stream — chunks, tool cards and approvals.',
    'demo.live1': 'Looking at the project and the build…',
    'demo.live2': 'Checking files and tests.',
    'demo.approvalTitle': 'Allow running this command?',
    'demo.approvalDetail': 'bash -lc "pnpm -C packages/dsh-mobile test"',
    'demo.question': 'Which pagination approach do you prefer?',
    'demo.questionOption1': 'Cursor by seq',
    'demo.questionOption2': 'Time offset',
    'demo.promptAccepted': 'Demo: prompt accepted',
    'demo.introLive': 'Running the linter and checking the build output…',
    'demo.introDone': 'Linter is clean, all 42 tests pass. Pagination is fixed — ready to commit.',
    'demo.think': 'Looking at what the project already has for this task.',
    'demo.turnReply':
      'Done: checked the files, ran the tests and prepared the changes. This is a demo reply — in real mode the DSH agent stream arrives here.',
    'demo.toolCommand': '{"command":"pnpm -C packages/dsh-mobile test"}',
    'demo.toolOutput': '✓ 42 tests passed',
    'demo.approved': 'Command finished, PR #1281 review is running.',
    'demo.answered': 'Got it: “{answer}”. Proceeding with that option.',
    'demo.stopped': 'Turn stopped by the user.',
    'demo.newSession': 'New demo session',
    'demo.newPrompt': 'What should be done?',
  },
};

let lang = 'ru';
const listeners = new Set();

export function availableLanguages() {
  return ['ru', 'en'];
}

export function getLang() {
  return lang;
}

export function setLang(next) {
  lang = next === 'en' ? 'en' : 'ru';
  document.documentElement.lang = lang;
  for (const listener of listeners) listener(lang);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    vars[key] == null ? match : String(vars[key])
  );
}

export function t(key, vars) {
  const value = dict[lang]?.[key] ?? dict.ru[key];
  if (value == null) return key;
  return interpolate(String(value), vars);
}

/** Plural-aware lookup: ru needs 3 forms, en 2. */
export function tn(key, n, vars) {
  const forms = dict[lang]?.[key] ?? dict.ru[key];
  if (!Array.isArray(forms)) return t(key, { ...vars, n });
  let index;
  if (lang === 'ru') {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) index = 0;
    else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) index = 1;
    else index = 2;
  } else {
    index = n === 1 ? 0 : 1;
  }
  const form = forms[Math.min(index, forms.length - 1)];
  return interpolate(form, { ...vars, n });
}

export function locale() {
  return lang === 'ru' ? 'ru-RU' : 'en-US';
}

export function fmtTime(iso) {
  const date = parse(iso);
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

export function fmtDateTime(iso) {
  const date = parse(iso);
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat(locale(), {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

let rtfCache = { lang: null, rtf: null };

function relativeFormatter() {
  if (typeof Intl === 'undefined' || !Intl.RelativeTimeFormat) return null;
  if (rtfCache.lang !== lang) {
    rtfCache = {
      lang,
      rtf: new Intl.RelativeTimeFormat(locale(), { numeric: 'auto', style: 'short' }),
    };
  }
  return rtfCache.rtf;
}

export function fmtRel(iso) {
  const date = parse(iso);
  if (!date) return '';
  const diffSec = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return t('common.now');
  const rtf = relativeFormatter();
  if (!rtf) return fmtTime(iso);
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diffSec / 86400), 'day');
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(date);
}

export function fmtBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export function fmtDuration(ms) {
  const value = Number(ms) || 0;
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function parse(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}
