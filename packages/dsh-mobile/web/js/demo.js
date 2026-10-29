/* DSH Mobile — demo mode (?demo=1).
 * A full mock of the gateway: sessions, snapshot, SSE stream (hello / live /
 * delta / state / resync-free), prompt/queue/steer, cancel, approval, question.
 * It is the reviewer's path to the UI without the backend, so it streams for
 * real (timers, chunks, tool cards) instead of rendering static mockups.
 */
import { ApiError, setDevice, setToken, setTransport } from './api.js';
import { setStreamFactory, sseStats } from './sse.js';
import { store } from './store.js';
import { t } from './i18n.js';

const DEMO_TOKEN = 'demo-token';
const DEMO_DEVICE_ID = 'dev-demo';
const MAX_EVENTS = 60;

const now = () => new Date().toISOString();
const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = (value) => JSON.parse(JSON.stringify(value));
const short = (text, n = 90) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
};

/* ── seed data ─────────────────────────────────────────────────────── */

const sessions = [
  {
    id: 's-demo-1',
    title: 'Починить пагинацию в списке сессий',
    workspaceId: 'ws-harness',
    workspaceName: 'harness',
    cwd: 'C:\\work\\harness',
    createdAt: ago(96),
    updatedAt: ago(1),
    status: 'running',
    model: 'deepseek-flash',
    parentSessionId: null,
    lastText: 'Запускаю линтер и проверяю вывод сборки…',
    lastRole: 'assistant',
    eventCount: 412,
    cursor: '0',
    hasPendingApproval: false,
    hasPendingQuestion: false,
    formatStatus: 'ok',
  },
  {
    id: 's-demo-2',
    title: 'Ревью PR #1281: мобильный шлюз',
    workspaceId: 'ws-harness',
    workspaceName: 'harness',
    cwd: 'C:\\work\\harness',
    createdAt: ago(180),
    updatedAt: ago(7),
    status: 'blocked',
    model: 'deepseek-flash',
    parentSessionId: null,
    lastText: 'Для ревью нужно выполнить команду в репозитории — подтвердите.',
    lastRole: 'assistant',
    eventCount: 231,
    cursor: '0',
    hasPendingApproval: true,
    hasPendingQuestion: false,
    formatStatus: 'ok',
  },
  {
    id: 's-demo-3',
    title: 'Перевести интерфейс на русский',
    workspaceId: 'ws-dsh-mobile',
    workspaceName: 'dsh-mobile',
    cwd: 'C:\\work\\dsh-mobile',
    createdAt: ago(1440),
    updatedAt: ago(42),
    status: 'idle',
    model: 'deepseek-flash',
    parentSessionId: null,
    lastText: 'Готово: 126 строк локализованы, переключатель языка в настройках.',
    lastRole: 'assistant',
    eventCount: 189,
    cursor: '0',
    hasPendingApproval: false,
    hasPendingQuestion: false,
    formatStatus: 'ok',
  },
  {
    id: 's-demo-4',
    title: 'Сгенерировать иконки PWA',
    workspaceId: 'ws-dsh-mobile',
    workspaceName: 'dsh-mobile',
    cwd: 'C:\\work\\dsh-mobile',
    createdAt: ago(1500),
    updatedAt: ago(75),
    status: 'idle',
    model: 'deepseek-flash',
    parentSessionId: null,
    lastText: 'Иконки 192/512 и maskable готовы, манифест обновлён.',
    lastRole: 'assistant',
    eventCount: 96,
    cursor: '0',
    hasPendingApproval: false,
    hasPendingQuestion: false,
    formatStatus: 'ok',
  },
  {
    id: 's-demo-5',
    title: 'Миграция events.seq для старых сессий',
    workspaceId: 'ws-harness',
    workspaceName: 'harness',
    cwd: 'C:\\work\\harness',
    createdAt: ago(2400),
    updatedAt: ago(120),
    status: 'queued',
    model: 'deepseek-flash',
    parentSessionId: null,
    lastText: 'Задача в очереди: дождётся завершения текущего хода.',
    lastRole: 'assistant',
    eventCount: 64,
    cursor: '0',
    hasPendingApproval: false,
    hasPendingQuestion: false,
    formatStatus: 'ok',
  },
  {
    id: 's-demo-6',
    title: 'Падение на foldable-эмуляторе',
    workspaceId: 'ws-dsh-mobile',
    workspaceName: 'dsh-mobile',
    cwd: 'C:\\work\\dsh-mobile',
    createdAt: ago(3000),
    updatedAt: ago(200),
    status: 'idle',
    model: 'deepseek-flash',
    parentSessionId: null,
    lastText: 'Какой вариант пагинации предпочитаете?',
    lastRole: 'assistant',
    eventCount: 142,
    cursor: '0',
    hasPendingApproval: false,
    hasPendingQuestion: true,
    formatStatus: 'ok',
  },
  {
    id: 's-demo-7',
    title: 'SSE keepalive: ping каждые 15 секунд',
    workspaceId: 'ws-harness',
    workspaceName: 'harness',
    cwd: 'C:\\work\\harness',
    createdAt: ago(3900),
    updatedAt: ago(320),
    status: 'idle',
    model: 'deepseek-flash',
    parentSessionId: null,
    lastText: 'Добавил watchdog на 70 секунд и pong-таймаут на сервере.',
    lastRole: 'assistant',
    eventCount: 77,
    cursor: '0',
    hasPendingApproval: false,
    hasPendingQuestion: false,
    formatStatus: 'ok',
  },
  {
    id: 's-demo-8',
    title: 'Собрать APK и подписать релиз',
    workspaceId: 'ws-dsh-mobile',
    workspaceName: 'dsh-mobile',
    cwd: 'C:\\work\\dsh-mobile',
    createdAt: ago(5200),
    updatedAt: ago(880),
    status: 'idle',
    model: 'deepseek-flash',
    parentSessionId: null,
    lastText: 'Жду keystore: без него релиз не подписать.',
    lastRole: 'assistant',
    eventCount: 45,
    cursor: '0',
    hasPendingApproval: false,
    hasPendingQuestion: false,
    formatStatus: 'ok',
  },
];

const logs = new Map(); // sid -> events[]
const pendingApprovals = new Map(); // sid -> approval payload
const pendingQuestions = new Map(); // sid -> question payload
const streams = new Map(); // sid -> emitter (only while a stream is open)
const runningTurns = new Map(); // sid -> cancel fn
const played = new Set();

let newSessionCounter = 0;

function sessionById(sid) {
  return sessions.find((item) => item.id === sid);
}

function nextSeq(sid) {
  const log = logs.get(sid) || [];
  return (log[log.length - 1]?.seq || 0) + 1;
}

function addEvent(sid, kind, data) {
  const log = logs.get(sid) || [];
  const seq = nextSeq(sid);
  const event = { seq, t: now(), k: kind, d: data };
  log.push(event);
  logs.set(sid, log);
  const summary = sessionById(sid);
  if (summary) {
    summary.eventCount = (summary.eventCount || 0) + 1;
    summary.cursor = String(seq);
    summary.updatedAt = event.t;
    if (kind === 'assistant/message' && data && data.text) {
      summary.lastText = short(data.text, 180);
      summary.lastRole = 'assistant';
    } else if (kind === 'user/message' && data && data.text) {
      summary.lastText = short(data.text, 180);
      summary.lastRole = 'user';
    }
  }
  const stream = streams.get(sid);
  if (stream) stream.delta([event]);
  return event;
}

function seedEvent(sid, kind, data) {
  const log = logs.get(sid) || [];
  const seq = (log[log.length - 1]?.seq || 0) + 1;
  log.push({ seq, t: ago(30), k: kind, d: data });
  logs.set(sid, log);
  const summary = sessionById(sid);
  if (summary) summary.cursor = String(seq);
}

seedEvent('s-demo-1', 'user/message', {
  text: 'Починить пагинацию в списке сессий: при прокрутке вверх пропадают старые события.',
});
seedEvent('s-demo-1', 'assistant/message', {
  text: 'Понял. Сначала посмотрю текущую реализацию списка и запросы к сессиям.',
});
seedEvent('s-demo-1', 'tool/call', {
  callId: 'c1',
  name: 'read_file',
  argsPreview: '{"path":"packages/dsh-mobile/web/js/sessions.js"}',
});
seedEvent('s-demo-1', 'tool/result', {
  callId: 'c1',
  ok: true,
  textPreview: 'export function initSessions() {\n  // renders cached sessions immediately\n}',
  truncated: false,
});
seedEvent('s-demo-1', 'assistant/message', {
  text: 'Вижу проблему: курсор `before` не сохраняется между запросами, поэтому пагинация начинается с начала. Исправлю и добавлю тест.',
});
seedEvent('s-demo-1', 'tool/call', {
  callId: 'c2',
  name: 'bash',
  argsPreview: '{"command":"pnpm -C packages/dsh-mobile test"}',
});
seedEvent('s-demo-1', 'tool/result', {
  callId: 'c2',
  ok: true,
  textPreview: '✓ 42 tests passed (3.4s)',
  truncated: false,
});
seedEvent('s-demo-1', 'notice', { text: 'Контекст сжат: старые ходы свёрнуты в сводку.', level: 'info' });
seedEvent('s-demo-1', 'assistant/message', {
  text: 'Пагинация исправлена, тесты зелёные. Осталось прогнать линтер — запускаю.',
});

seedEvent('s-demo-2', 'user/message', { text: 'Проведи ревью PR #1281 и примени правки по замечаниям.' });
seedEvent('s-demo-2', 'assistant/message', {
  text: 'Для ревью нужно выполнить команду в репозитории — подтвердите, пожалуйста.',
});
seedEvent('s-demo-2', 'tool/call', {
  callId: 'ap-call',
  name: 'bash',
  argsPreview: t('demo.toolCommand'),
});
pendingApprovals.set('s-demo-2', {
  approvalId: 'ap-1',
  title: t('demo.approvalTitle'),
  detail: t('demo.approvalDetail'),
  options: [t('chat.approval.allow'), t('chat.approval.deny')],
});
addEvent('s-demo-2', 'approval/request', pendingApprovals.get('s-demo-2'));

seedEvent('s-demo-3', 'user/message', { text: 'Переведи весь интерфейс на русский, английский оставь переключателем.' });
seedEvent('s-demo-3', 'assistant/message', {
  text: 'Готово: 126 строк локализованы, все строки вынесены в i18n-модуль, язык переключается в настройках.',
});
seedEvent('s-demo-3', 'notice', { text: 'Проверено 14 экранов, оба языка.', level: 'info' });

seedEvent('s-demo-4', 'user/message', { text: 'Сгенерируй иконки PWA 192/512 и maskable.' });
seedEvent('s-demo-4', 'assistant/message', {
  text: 'Иконки 192/512 и maskable готовы, манифест обновлён, превью прилагаю.',
});
seedEvent('s-demo-4', 'tool/call', {
  callId: 'icon-call',
  name: 'python',
  argsPreview: '{"script":"_icons.py","output":"icons/*.png"}',
});
seedEvent('s-demo-4', 'tool/result', {
  callId: 'icon-call',
  ok: true,
  textPreview: 'icons written\nicon-192.png  7986\nicon-512.png  19866',
  truncated: false,
});

seedEvent('s-demo-5', 'user/message', { text: 'Нужна миграция events.seq для старых сессий.' });
seedEvent('s-demo-5', 'assistant/message', {
  text: 'Задача в очереди: дождётся завершения текущего хода и я пришлю план миграции.',
});

seedEvent('s-demo-6', 'user/message', { text: 'На эмуляторе раскладушки падает список при смене позы.' });
seedEvent('s-demo-6', 'assistant/message', {
  text: 'Похоже на сброс состояния при resize. Прежде чем править, уточню подход.',
});
pendingQuestions.set('s-demo-6', {
  questionId: 'q-1',
  question: t('demo.question'),
  options: [t('demo.questionOption1'), t('demo.questionOption2')],
});
addEvent('s-demo-6', 'question/request', pendingQuestions.get('s-demo-6'));

seedEvent('s-demo-7', 'user/message', { text: 'Добавь keepalive ping каждые 15 секунд.' });
seedEvent('s-demo-7', 'assistant/message', {
  text: 'Добавил watchdog на 70 секунд и pong-таймаут на сервере, поток переподключается сам.',
});
seedEvent('s-demo-8', 'user/message', { text: 'Собери APK и подпиши релиз.' });
seedEvent('s-demo-8', 'assistant/message', { text: 'Жду keystore: без него релиз не подписать.' });

for (const summary of sessions) {
  summary.cursor = String(logs.get(summary.id)?.at(-1)?.seq || 0);
}

/* ── stream emitters ───────────────────────────────────────────────── */

function emitStateFor(sid) {
  const stream = streams.get(sid);
  if (!stream) return;
  const summary = sessionById(sid);
  stream.emit('state', {
    running: summary ? summary.status === 'running' : false,
    status: summary ? summary.status : 'idle',
    queue: summary && summary.status === 'queued' ? 1 : 0,
    pendingApproval: pendingApprovals.get(sid) || null,
    pendingQuestion: pendingQuestions.get(sid) || null,
  });
}

/** Push live assistant chunks one by one, then call onDone. */
function streamLive(stream, text, onDone, stepMs = 48) {
  const chunks = String(text || '').match(/\S+\s*/g) || [];
  let index = 0;
  const timer = setInterval(() => {
    if (!stream || !stream.alive()) {
      clearInterval(timer);
      return;
    }
    if (index >= chunks.length) {
      clearInterval(timer);
      if (onDone) onDone();
      return;
    }
    stream.live(chunks[index]);
    index += 1;
  }, stepMs);
  return () => clearInterval(timer);
}

function setStatus(sid, status) {
  const summary = sessionById(sid);
  if (!summary) return;
  summary.status = status;
  summary.updatedAt = now();
  emitStateFor(sid);
}

function playIntro(sid, stream) {
  const summary = sessionById(sid);
  if (!summary) return;
  setStatus(sid, 'running');
  streamLive(stream, t('demo.introLive'), () => {
    if (!stream.alive()) return;
    const call = addEvent(sid, 'tool/call', {
      callId: 'c3',
      name: 'bash',
      argsPreview: '{"command":"pnpm -C packages/dsh-mobile lint"}',
    });
    setTimeout(() => {
      if (!stream.alive()) return;
      addEvent(sid, 'tool/result', {
        callId: call.d.callId,
        ok: true,
        textPreview: '✓ eslint: 0 problems',
        truncated: false,
      });
      setTimeout(() => {
        if (!stream.alive()) return;
        addEvent(sid, 'assistant/message', { text: t('demo.introDone') });
        setStatus(sid, 'idle');
      }, 700);
    }, 700);
  }, 55);
}

function runPromptTurn(sid, promptText) {
  const summary = sessionById(sid);
  if (!summary) return;
  runningTurns.get(sid)?.();
  let cancelled = false;
  runningTurns.set(sid, () => {
    cancelled = true;
  });
  setStatus(sid, 'running');
  const stream = streams.get(sid);
  const reply = `${t('demo.think')} ${t('demo.turnReply')}`;
  const stopLive = stream ? streamLive(stream, reply, () => {}, 45) : () => {};
  setTimeout(() => {
    if (cancelled) return;
    stopLive();
    const call = addEvent(sid, 'tool/call', {
      callId: `demo-${Date.now()}`,
      name: 'bash',
      argsPreview: t('demo.toolCommand'),
    });
    if (stream && stream.alive()) stream.live?.('');
    setTimeout(() => {
      if (cancelled) return;
      addEvent(sid, 'tool/result', {
        callId: call.d.callId,
        ok: true,
        textPreview: t('demo.toolOutput'),
        truncated: false,
      });
      setTimeout(() => {
        if (cancelled) return;
        addEvent(sid, 'assistant/message', {
          text: `${t('demo.think')} ${short(promptText, 100)} — ${t('demo.turnReply')}`,
        });
        setStatus(sid, 'idle');
        runningTurns.delete(sid);
      }, 650);
    }, 650);
  }, 1900);
}

/* ── transport ─────────────────────────────────────────────────────── */

function snapshot(sid) {
  const summary = sessionById(sid);
  if (!summary) throw new ApiError('session not found', { code: 'session-not-found', status: 404 });
  const events = clone((logs.get(sid) || []).slice(-MAX_EVENTS));
  const hasApproval = pendingApprovals.has(sid);
  const hasQuestion = pendingQuestions.has(sid);
  const body = {
    session: clone(summary),
    events,
    cursor: String(summary.cursor),
    hasOlder: false,
    running: summary.status === 'running',
    queue: summary.status === 'queued' ? [clone(summary)] : [],
  };
  if (hasApproval) body.pendingApproval = clone(pendingApprovals.get(sid));
  if (hasQuestion) body.pendingQuestion = clone(pendingQuestions.get(sid));
  return body;
}

async function demoRequest(path, { method = 'GET', query = null, body = null } = {}) {
  await delay(90 + Math.random() * 210);
  const parts = String(path || '/').replace(/^\/+/, '').split('/').filter(Boolean);
  const [head, first, action] = parts;

  if (!parts.length || (head === 'hello' && method === 'GET')) {
    return {
      protocol: 1,
      appVersion: '0.1.0-demo',
      hostName: 'DESKTOP-DEMO',
      capabilities: { approvals: true, questions: true, attachments: false, jobs: true },
      limits: { maxPromptChars: 32000 },
    };
  }
  if (head === 'pair' && method === 'POST') {
    return {
      deviceToken: DEMO_TOKEN,
      deviceId: DEMO_DEVICE_ID,
      host: { name: 'DESKTOP-DEMO', appVersion: '0.1.0-demo', protocol: 1 },
    };
  }
  if (head === 'health') return { ok: true, uptimeSec: 3210 };
  if (head === 'devices') return { ok: true };
  if (head === 'workspaces') {
    return [
      { id: 'ws-harness', path: 'C:\\work\\harness', name: 'harness', isDefault: true, sessionCount: 5 },
      { id: 'ws-dsh-mobile', path: 'C:\\work\\dsh-mobile', name: 'dsh-mobile', isDefault: false, sessionCount: 3 },
    ];
  }
  if (head === 'jobs') {
    return [
      {
        id: 'job-1',
        sessionId: 's-demo-1',
        kind: 'test',
        status: 'running',
        startedAt: ago(1),
        title: 'pnpm test',
      },
      {
        id: 'job-2',
        sessionId: 's-demo-5',
        kind: 'migration',
        status: 'queued',
        startedAt: ago(2),
        title: 'events.seq migration',
      },
    ];
  }

  if (head !== 'sessions') {
    throw new ApiError(`demo: unsupported ${path}`, { code: 'unsupported', status: 404 });
  }

  if (!first && method === 'GET') {
    const q = String(query?.q || '').trim().toLowerCase();
    const limit = Math.min(Number(query?.limit) || 50, 100);
    const rows = sessions
      .filter((item) => (q ? `${item.title} ${item.lastText} ${item.workspaceName}`.toLowerCase().includes(q) : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((item) => clone(item));
    return { sessions: rows, nextCursor: null, removed: [], serverTime: now() };
  }

  if (!first && method === 'POST') {
    newSessionCounter += 1;
    const summary = {
      id: `s-demo-new-${newSessionCounter}`,
      title: t('demo.newSession'),
      workspaceId: 'ws-harness',
      workspaceName: 'harness',
      cwd: 'C:\\work\\harness',
      createdAt: now(),
      updatedAt: now(),
      status: 'idle',
      model: 'deepseek-flash',
      parentSessionId: null,
      lastText: t('demo.newPrompt'),
      lastRole: 'assistant',
      eventCount: 1,
      cursor: '1',
      hasPendingApproval: false,
      hasPendingQuestion: false,
      formatStatus: 'ok',
    };
    sessions.unshift(summary);
    logs.set(summary.id, []);
    seedEvent(summary.id, 'assistant/message', { text: t('demo.newPrompt') });
    summary.cursor = '1';
    return { session: clone(summary) };
  }

  const sid = first;
  const summary = sessionById(sid);
  if (!summary) throw new ApiError('session not found', { code: 'session-not-found', status: 404 });

  if (action === 'older' && method === 'GET') return { events: [], hasOlder: false };
  if (!action && method === 'GET') return snapshot(sid);

  if (action === 'prompt' && method === 'POST') {
    const text = String(body?.text || '').trim();
    const mode = body?.mode || 'transcript';
    if (!text) throw new ApiError('prompt-invalid', { code: 'prompt-invalid', status: 400 });
    const event = addEvent(sid, 'user/message', { text });
    if (mode === 'queue') {
      setStatus(sid, 'queued');
      setTimeout(() => runPromptTurn(sid, text), 900);
    } else {
      runPromptTurn(sid, text);
    }
    return { accepted: true, requestId: body?.requestId || 'demo', seq: event.seq };
  }
  if (action === 'cancel' && method === 'POST') {
    runningTurns.get(sid)?.();
    runningTurns.delete(sid);
    addEvent(sid, 'notice', { text: t('demo.stopped'), level: 'warning' });
    setStatus(sid, 'idle');
    return { ok: true };
  }
  if (action === 'approval' && method === 'POST') {
    const decision = body?.decision === 'deny' ? 'deny' : 'allow';
    pendingApprovals.delete(sid);
    const approval = { approvalId: body?.approvalId || 'ap-1', decision };
    addEvent(sid, 'approval/resolved', approval);
    summary.hasPendingApproval = false;
    emitStateFor(sid);
    if (decision === 'allow') {
      setStatus(sid, 'running');
      const stream = streams.get(sid);
      if (stream) {
        streamLive(stream, t('demo.approved'), () => {
          addEvent(sid, 'assistant/message', { text: t('demo.approved') });
          setStatus(sid, 'idle');
        }, 55);
      } else {
        addEvent(sid, 'assistant/message', { text: t('demo.approved') });
        setStatus(sid, 'idle');
      }
    } else {
      addEvent(sid, 'assistant/message', { text: 'Понял, команду не запускаю. Предложу другой план.' });
      setStatus(sid, 'idle');
    }
    return { ok: true };
  }
  if (action === 'question' && method === 'POST') {
    const answer = String(body?.answer || '');
    pendingQuestions.delete(sid);
    summary.hasPendingQuestion = false;
    addEvent(sid, 'question/resolved', { questionId: body?.questionId || 'q-1', answer });
    emitStateFor(sid);
    const text = t('demo.answered', { answer: short(answer, 60) });
    addEvent(sid, 'assistant/message', { text });
    setStatus(sid, 'idle');
    return { ok: true };
  }
  if (action === 'read' && method === 'POST') return { ok: true };

  throw new ApiError(`demo: unsupported ${method} ${path}`, { code: 'unsupported', status: 404 });
}

/* ── stream factory ────────────────────────────────────────────────── */

function demoStream({ sessionId, getCursor, onCursor, onEvent, onStatus }) {
  let stopped = false;
  const timers = [];
  let liveIndex = 0;

  const later = (ms, fn) => {
    const id = setTimeout(() => {
      if (!stopped) fn();
    }, ms);
    timers.push(id);
    return id;
  };

  const emit = (event, data) => {
    if (stopped) return;
    sseStats.events += 1;
    sseStats.bytes += JSON.stringify(data || '').length;
    sseStats.lastEventAt = Date.now();
    if (event === 'hello' && data?.cursor != null) onCursor(String(data.cursor));
    if (event === 'delta' && Array.isArray(data?.events)) {
      let max = null;
      for (const item of data.events) {
        if (item?.seq != null) max = max == null ? item.seq : Math.max(max, item.seq);
      }
      if (max != null) onCursor(String(max));
    }
    onEvent({ event, data });
  };

  const stream = {
    status: 'idle',
    alive: () => !stopped,
    emit,
    live: (text) => {
      emit('live', { attemptId: 'demo-attempt', index: liveIndex, text, role: 'assistant' });
      liveIndex += 1;
    },
    delta: (events) => {
      if (!events || !events.length) return;
      emit('delta', { from: String(events[0].seq), events });
    },
    state: () => emitStateFor(sessionId),
  };

  return {
    get status() {
      return stream.status;
    },
    start() {
      if (stopped) return;
      onStatus('connecting');
      later(240, () => {
        onStatus('open');
        sseStats.connects += 1;
        const summary = sessionById(sessionId);
        streams.set(sessionId, stream);
        emit('hello', {
          sessionId,
          cursor: String(getCursor() || summary?.cursor || '0'),
          running: summary?.status === 'running',
        });
        emitStateFor(sessionId);
        // Replay durable events the client missed while its stream was closed,
        // exactly like the real gateway replays everything after `cursor`.
        const since = Number(getCursor() || 0);
        const backlog = (logs.get(sessionId) || []).filter((event) => event.seq > since);
        if (backlog.length) emit('delta', { from: String(backlog[0].seq), events: backlog });
        if (!played.has(sessionId)) {
          played.add(sessionId);
          if (summary?.status === 'running') playIntro(sessionId, stream);
        }
      });
    },
    stop() {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      streams.delete(sessionId);
      onStatus('closed');
    },
  };
}

/* ── install ───────────────────────────────────────────────────────── */

export function installDemo() {
  setToken(DEMO_TOKEN);
  setDevice({
    id: DEMO_DEVICE_ID,
    name: 'Honor Magic V3 (демо)',
    platform: 'Android · foldable',
    host: { name: 'DESKTOP-DEMO', appVersion: '0.1.0-demo', protocol: 1 },
  });
  store.update('auth', { paired: true });
  store.set({
    device: {
      id: DEMO_DEVICE_ID,
      name: 'Honor Magic V3 (демо)',
      host: { name: 'DESKTOP-DEMO', appVersion: '0.1.0-demo', protocol: 1 },
    },
    sessions: clone(sessions),
    sessionsState: 'ready',
    sessionsUsedCache: false,
  });
  store.update('ui', { demo: true });
  setTransport({ request: demoRequest });
  setStreamFactory(demoStream);
  return { sessions: clone(sessions) };
}

export function isDemoInstalled() {
  return Boolean(store.get('ui')?.demo);
}
