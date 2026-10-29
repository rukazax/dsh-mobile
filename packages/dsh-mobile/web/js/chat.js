/* DSH Mobile — chat pane.
 * Streaming (SSE), markdown, tool cards, approval/question sheets, composer with
 * send/queue/steer + stop, drafts, read markers, autoscroll and "jump to latest".
 * The pane never unmounts: switching routes or changing posture keeps the stream,
 * the draft and the scroll position alive (contract §8).
 */
import { api, newRequestId, errorText } from './api.js';
import { createStream } from './sse.js';
import { store } from './store.js';
import { t, tn, subscribe as onLangChange } from './i18n.js';
import * as db from './db.js';
import { patchSession } from './sessions.js';
import { navigate } from './router.js';
import { renderMD } from './markdown.js';
import {
  announce,
  autoGrow,
  clear,
  closeAllSheets,
  debounce,
  h,
  icon,
  isNearBottom,
  openSheet,
  raf,
  scrollToBottom,
  toast,
} from './dom.js';

const chat = {
  sessionId: null,
  summary: null,
  events: [],
  seqs: new Set(),
  lastSeq: 0,
  hasOlder: false,
  running: false,
  queue: 0,
  pendingApproval: null,
  pendingQuestion: null,
  liveText: '',
  mode: 'transcript',
  stream: null,
  unread: 0,
  loaded: false,
  error: '',
  loadingOlder: false,
  approvalOpen: false,
  questionOpen: false,
  readSent: 0,
  toolCards: new Map(),
  pendingSends: new Map(),
  draftTimer: 0,
  readTimer: 0,
  openSeq: 0,
};

const refs = {};

function oneLine(text, max = 120) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/* ── init ──────────────────────────────────────────────────────────── */

export function initChat() {
  const root = document.getElementById('pane-chat');
  if (!root) return;
  const back = h(
    'button.btn-icon.chat-back',
    { type: 'button', 'aria-label': t('chat.back'), onclick: () => navigate('/sessions') },
    icon('back')
  );
  const title = h('h1.chat-title', { text: t('chat.noSession') });
  const subDot = h('span.dot.dot-idle');
  const subText = h('span', { text: '' });
  const sub = h('div.chat-sub', null, subDot, subText);
  const pendingBtn = h(
    'button.btn-icon',
    {
      type: 'button',
      'aria-label': t('chat.approval.title'),
      hidden: true,
      onclick: () => {
        if (chat.pendingApproval) showApprovalSheet();
        else if (chat.pendingQuestion) showQuestionSheet();
      },
    },
    icon('alert')
  );
  const refreshBtn = h(
    'button.btn-icon',
    { type: 'button', 'aria-label': t('common.refresh'), onclick: () => reload() },
    icon('refresh')
  );
  const head = h(
    'header.pane-head.chat-head',
    null,
    back,
    h('div.chat-title-wrap', null, title, sub),
    h('div.head-actions', null, pendingBtn, refreshBtn)
  );

  const messages = h('div.messages', { id: 'chat-messages' });
  const liveSlot = h('div.live-slot');
  const jumpBtn = h(
    'button.jump-bottom',
    { type: 'button', hidden: true, onclick: jumpToLatest },
    icon('arrow-down', 'icon-sm'),
    h('span', { text: t('chat.jump') }),
    h('span.chip.chip-accent', { text: '0', hidden: true })
  );
  const transcript = h('div.transcript', { id: 'transcript' }, messages, liveSlot, jumpBtn);
  const scroller = h('div.scroll.chat-scroll', { id: 'chat-scroll', tabindex: '-1' }, transcript);

  const textarea = h('textarea.composer-input', {
    id: 'composer-input',
    rows: '1',
    placeholder: t('chat.composerPlaceholder'),
    'aria-label': t('chat.composerPlaceholder'),
    enterkeyhint: 'enter',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    spellcheck: 'true',
  });
  const sendBtn = h(
    'button.send-btn',
    { type: 'submit', 'aria-label': t('chat.send'), title: t('chat.send'), disabled: true },
    icon('send', 'icon-lg')
  );
  const stopBtn = h(
    'button.stop-btn',
    {
      type: 'button',
      hidden: true,
      'aria-label': t('chat.stop'),
      title: t('chat.stopHint'),
      onclick: stopTurn,
    },
    icon('stop', 'icon-lg')
  );
  const modes = h('div.composer-modes', { hidden: true, role: 'radiogroup', 'aria-label': t('chat.send') });
  const modeHint = h('span', { text: '' });
  const queueLabel = h('span', { text: '' });
  const composer = h(
    'form.composer',
    { id: 'composer', autocomplete: 'off' },
    modes,
    h('div.composer-row', null, textarea, sendBtn, stopBtn),
    h('div.composer-hint', null, modeHint, queueLabel)
  );

  clear(root);
  root.append(head, scroller, composer);

  Object.assign(refs, {
    root,
    head,
    back,
    title,
    subDot,
    subText,
    pendingBtn,
    refreshBtn,
    scroller,
    transcript,
    messages,
    liveSlot,
    jumpBtn,
    composer,
    textarea,
    sendBtn,
    stopBtn,
    modes,
    modeHint,
    queueLabel,
  });

  renderModeChips();
  updateComposerState();
  setEmptyState();
  bindEvents();
  bindKeyboard();

  onLangChange(() => {
    renderModeChips();
    refs.title.textContent = chat.summary ? chat.summary.title : t('chat.noSession');
    refs.textarea.placeholder = t('chat.composerPlaceholder');
    refs.textarea.setAttribute('aria-label', t('chat.composerPlaceholder'));
    updateHeader();
    updateComposerState();
    if (chat.sessionId) renderAll();
  });
}

function bindEvents() {
  refs.textarea.addEventListener('input', () => {
    autoGrow(refs.textarea);
    updateComposerState();
    scheduleDraftSave();
  });
  refs.textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submitPrompt();
    }
  });
  refs.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    submitPrompt();
  });
  refs.scroller.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pagehide', saveDraftNow);
  window.addEventListener('online', () => updateHeader());
  window.addEventListener('offline', () => updateHeader());
}

function bindKeyboard() {
  document.addEventListener('keydown', (event) => {
    if (!refs.root || document.hidden) return;
    if (event.defaultPrevented) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.querySelector('.sheet')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j') {
      event.preventDefault();
      jumpToLatest();
    }
  });
}

/* ── routing / lifecycle ───────────────────────────────────────────── */

export function getOpenSessionId() {
  return chat.sessionId;
}

export function openSession(id) {
  if (!id) return;
  if (chat.sessionId === id && chat.loaded) {
    store.set({ activeSessionId: id });
    return;
  }
  saveDraftNow();
  teardownStream();
  closePendingSheets();
  chat.sessionId = id;
  chat.summary = store.get('sessions').find((item) => item.id === id) || null;
  chat.events = [];
  chat.seqs = new Set();
  chat.lastSeq = 0;
  chat.hasOlder = false;
  chat.liveText = '';
  chat.running = false;
  chat.queue = 0;
  chat.pendingApproval = null;
  chat.pendingQuestion = null;
  chat.unread = 0;
  chat.loaded = false;
  chat.error = '';
  chat.readSent = 0;
  chat.toolCards.clear();
  chat.pendingSends.forEach((entry) => clearTimeout(entry.timer));
  chat.pendingSends.clear();
  chat.openSeq += 1;
  const token = chat.openSeq;

  store.set({ activeSessionId: id, session: chat.summary });
  clearLiveSlot();
  updateHeader();
  updateComposerState();
  refs.textarea.value = '';
  refs.textarea.disabled = false;
  showSkeleton();

  loadCached(token).then(() => loadSnapshot(token));
}

async function loadCached(token) {
  const [cachedEvents, draft] = await Promise.all([
    db.readEvents(chat.sessionId),
    db.getDraft(chat.sessionId),
  ]);
  if (token !== chat.openSeq) return;
  if (cachedEvents.length) {
    clear(refs.messages);
    applyEvents(cachedEvents, { persist: false, scroll: false });
    chat.loaded = true;
    scrollToBottom(refs.scroller);
  }
  if (draft && !refs.textarea.value) {
    refs.textarea.value = draft;
    autoGrow(refs.textarea);
    updateComposerState();
  }
}

async function loadSnapshot(token) {
  try {
    const snapshot = await api.session(chat.sessionId, { turns: 2 });
    if (token !== chat.openSeq) return;
    applySnapshot(snapshot);
    chat.error = '';
    chat.loaded = true;
    startStream(token);
    scheduleRead();
  } catch (error) {
    if (token !== chat.openSeq) return;
    chat.error = errorText(error);
    showError(chat.error);
    if (String(error?.code || '') === 'session-not-found') {
      toast(t('chat.sessionNotFound'), 'danger');
      return;
    }
    startStream(token);
  }
}

function reload() {
  if (!chat.sessionId) return;
  chat.openSeq += 1;
  const token = chat.openSeq;
  teardownStream();
  chat.loaded = false;
  showSkeleton();
  loadSnapshot(token);
}

function teardownStream() {
  if (chat.stream) {
    chat.stream.stop();
    chat.stream = null;
  }
  store.update('stream', { state: 'idle' });
}

function startStream(token) {
  if (!token || token !== chat.openSeq || !chat.sessionId) return;
  const sessionId = chat.sessionId;
  if (chat.stream) chat.stream.stop();
  const saveCursor = debounce((cursor) => db.setCursor(sessionId, cursor), 400);
  chat.stream = createStream({
    sessionId,
    getCursor: () => String(chat.lastSeq || 0),
    onCursor: (cursor) => saveCursor(cursor),
    onEvent: (message) => {
      if (token !== chat.openSeq) return;
      handleStreamEvent(message);
    },
    onStatus: (state, detail) => {
      if (token !== chat.openSeq) return;
      handleStreamStatus(state, detail);
    },
  });
  chat.stream.start();
}

/* ── stream handling ───────────────────────────────────────────────── */

function handleStreamStatus(state, detail) {
  store.update('stream', { state });
  const connectionState =
    state === 'open' ? 'online' : state === 'connecting' || state === 'reconnecting' ? 'connecting' : state === 'error' ? 'offline' : 'idle';
  store.update('connection', { state: connectionState, detail });
  refs.root.dataset.stream = state;
  updateHeader();
  if (state === 'error') {
    toast(t('chat.connectionLost'), 'danger');
  }
}

function handleStreamEvent({ event, data }) {
  switch (event) {
    case 'hello':
      if (data && data.running != null) setRunning(!!data.running);
      break;
    case 'delta':
      if (data && Array.isArray(data.events) && data.events.length) {
        applyEvents(data.events);
        scheduleRead();
      }
      break;
    case 'live':
      if (data && data.text) appendLive(String(data.text));
      break;
    case 'state':
      applyStateEvent(data);
      break;
    case 'resync':
      store.update('diagnostics', {
        resyncs: (store.get('diagnostics').resyncs || 0) + 1,
      });
      toast(t('chat.resync'), 'info');
      resync();
      break;
    case 'error':
      if (data?.message) toast(data.message, 'danger');
      break;
    default:
      break;
  }
}

function applyStateEvent(state) {
  if (!state) return;
  setRunning(state.running != null ? !!state.running : chat.running);
  if (state.status) {
    chat.summary = { ...(chat.summary || {}), status: state.status };
    patchSession(chat.sessionId, { status: state.status });
  }
  if (state.queue != null) {
    chat.queue = Array.isArray(state.queue) ? state.queue.length : Number(state.queue) || 0;
  }
  setPendingApproval(state.pendingApproval || null);
  setPendingQuestion(state.pendingQuestion || null);
  updateHeader();
  updateComposerState();
}

async function resync() {
  if (!chat.sessionId) return;
  const id = chat.sessionId;
  try {
    const snapshot = await api.session(id, { turns: 2 });
    if (chat.sessionId !== id) return;
    applySnapshot(snapshot, { keepLive: true });
    toast(t('conn.connected'), 'ok');
  } catch (error) {
    toast(errorText(error), 'danger');
  }
}

/* ── snapshot / events ─────────────────────────────────────────────── */

function mergeEvents(existing, incoming) {
  const map = new Map();
  for (const event of existing) if (event && event.seq != null) map.set(event.seq, event);
  for (const event of incoming) if (event && event.seq != null) map.set(event.seq, event);
  return [...map.values()].sort((a, b) => Number(a.seq) - Number(b.seq));
}

function applySnapshot(snapshot, { keepLive = false } = {}) {
  const incoming = Array.isArray(snapshot.events) ? snapshot.events : [];
  const merged = mergeEvents(chat.events, incoming).slice(-80);
  chat.events = merged;
  chat.seqs = new Set(merged.map((event) => Number(event.seq)));
  chat.lastSeq = merged.reduce((max, event) => Math.max(max, Number(event.seq) || 0), 0);
  chat.summary = snapshot.session || chat.summary;
  chat.hasOlder = !!snapshot.hasOlder;
  chat.running = !!snapshot.running;
  chat.queue = Array.isArray(snapshot.queue) ? snapshot.queue.length : Number(snapshot.queue) || 0;
  chat.pendingApproval = snapshot.pendingApproval || null;
  chat.pendingQuestion = snapshot.pendingQuestion || null;
  chat.error = '';
  if (!keepLive) clearLive();
  chat.loaded = true;
  db.putEvents(chat.sessionId, merged.slice(-50));
  store.set({ session: chat.summary });
  patchSession(chat.sessionId, chat.summary || {});
  renderAll();
  updateHeader();
  updateComposerState();
  syncSheets();
  scrollToBottom(refs.scroller);
}

function applyEvents(events, { persist = true, scroll = true } = {}) {
  const fresh = [];
  for (const event of events) {
    if (!event || event.seq == null) continue;
    const seq = Number(event.seq);
    if (chat.seqs.has(seq)) continue;
    chat.seqs.add(seq);
    chat.events.push(event);
    fresh.push(event);
    if (seq > chat.lastSeq) chat.lastSeq = seq;
  }
  if (!fresh.length) return;
  chat.events.sort((a, b) => Number(a.seq) - Number(b.seq));
  reconcilePendingSends(fresh);
  const stick = isNearBottom(refs.scroller, 150);
  const appended = [];
  for (const event of fresh) {
    const node = eventNode(event);
    if (node) appended.push(node);
    handleDurableEvent(event);
  }
  if (appended.length) {
    for (const node of appended) refs.messages.appendChild(node);
    if (stick && scroll) scrollToBottom(refs.scroller);
    else if (!stick && scroll) addUnread(appended.length);
  }
  if (appended.length && !chat.loaded) {
    chat.loaded = true;
    hideEmptyState();
  }
  if (fresh.some((event) => event.k === 'assistant/message' || event.k === 'turn/end')) clearLive();
  if (persist && chat.sessionId) db.putEvents(chat.sessionId, fresh);
}

function handleDurableEvent(event) {
  const data = event.d || {};
  if (event.k === 'session/title' && data.title) {
    chat.summary = { ...(chat.summary || {}), title: data.title };
    patchSession(chat.sessionId, { title: data.title });
    updateHeader();
  }
  if (event.k === 'approval/request') setPendingApproval(data);
  if (event.k === 'approval/resolved') setPendingApproval(null);
  if (event.k === 'question/request') setPendingQuestion(data);
  if (event.k === 'question/resolved') setPendingQuestion(null);
  if (event.k === 'user/message' || event.k === 'assistant/message' || event.k === 'tool/result') {
    const eventCount = (chat.summary?.eventCount || 0) + 1;
    if (chat.summary) chat.summary.eventCount = eventCount;
    patchSession(chat.sessionId, {
      lastText: oneLine(data.text || data.textPreview || '', 180),
      lastRole: event.k === 'user/message' ? 'user' : event.k === 'assistant/message' ? 'assistant' : 'tool',
      updatedAt: event.t || new Date().toISOString(),
      cursor: String(event.seq),
      eventCount,
    });
  }
}

/* ── rendering ─────────────────────────────────────────────────────── */

function renderAll() {
  clear(refs.messages);
  chat.toolCards.clear();
  clearLiveSlot();
  refs.jumpBtn.hidden = true;
  chat.unread = 0;

  if (chat.hasOlder) {
    refs.messages.appendChild(
      h(
        'button.btn.btn-sm.older-btn',
        { type: 'button', onclick: loadOlder },
        icon('chevron-up', 'icon-sm'),
        h('span', { text: t('chat.older') })
      )
    );
  }

  if (!chat.events.length && chat.loaded && !chat.error) {
    refs.messages.appendChild(emptySessionState());
  } else {
    for (const event of chat.events) {
      const node = eventNode(event);
      if (node) refs.messages.appendChild(node);
    }
  }
  updatePendingBadge();
}

function eventNode(event) {
  const data = event.d || {};
  switch (event.k) {
    case 'user/message':
      return userNode(data.text);
    case 'assistant/message':
      return assistantNode(data.text);
    case 'tool/call':
      return toolCallNode(event);
    case 'tool/result':
      return toolResultNode(event);
    case 'approval/resolved':
      return noticeNode('check', resolvedText('approval', data.decision), 'ok');
    case 'question/resolved':
      return noticeNode('check', resolvedText('question', data.answer), 'ok');
    case 'error':
      return noticeNode('alert', data.message || t('chat.errorEvent'), 'danger');
    case 'notice':
      return noticeNode('info', data.text, data.level === 'error' ? 'danger' : data.level === 'warning' ? 'warn' : '');
    default:
      return null;
  }
}

function userNode(text) {
  const bubble = h('div.msg.msg-user');
  renderMD(bubble, text);
  return bubble;
}

function assistantNode(text) {
  return h(
    'div.msg.msg-assistant',
    null,
    h('div.msg-role', null, icon('sparkle'), h('span', { text: t('chat.assistant') })),
    renderMD(h('div.msg-body'), text)
  );
}

function noticeNode(glyph, text, tone = '') {
  if (!text) return null;
  return h(
    'div.notice',
    { class: tone ? `notice-${tone}` : '' },
    icon(glyph, 'icon-sm'),
    h('span', { text: String(text) })
  );
}

function resolvedText(kind, value) {
  if (kind === 'approval') {
    const allow = value !== 'deny';
    return `${t(allow ? 'chat.approval.allow' : 'chat.approval.deny')} — ${t('chat.approval.done')}`;
  }
  return `${t('chat.question.done')}: ${value || '—'}`;
}

function toolCallNode(event) {
  const data = event.d || {};
  const callId = data.callId || `call-${event.seq}`;
  const chip = h('span.chip', { text: t('chat.tool.pending') });
  const body = h(
    'div.tool-body',
    null,
    h('p.tool-section-label', { text: t('chat.tool.args') }),
    h('pre.tool-pre', { text: data.argsPreview || '' })
  );
  const details = h(
    'details.tool-card',
    null,
    h(
      'summary',
      null,
      h('span.tool-icon', null, icon('tool', 'icon-sm')),
      h('span.tool-name', { text: data.name || 'tool' }),
      h('span.tool-sum', { text: oneLine(data.argsPreview, 80) }),
      chip,
      icon('chevron-down', 'icon-sm tool-caret')
    ),
    body
  );
  chat.toolCards.set(callId, { details, body, chip, resultNode: null });
  return details;
}

function toolResultNode(event) {
  const data = event.d || {};
  const callId = data.callId || `call-${event.seq}`;
  const card = chat.toolCards.get(callId);
  const label = h('p.tool-section-label', {
    text: `${t('chat.tool.result')}${data.truncated ? ` · ${t('chat.tool.truncated')}` : ''}`,
  });
  const pre = h('pre.tool-pre', { class: data.ok ? 'ok' : 'err', text: data.textPreview || '' });
  if (!card) {
    const details = h(
      'details.tool-card',
      null,
      h(
        'summary',
        null,
        h('span.tool-icon', null, icon('terminal', 'icon-sm')),
        h('span.tool-name', { text: data.ok ? t('chat.tool.ok') : t('chat.tool.failed') }),
        h('span.tool-sum', { text: oneLine(data.textPreview, 80) }),
        h('span.chip', { class: data.ok ? 'chip-ok' : 'chip-danger', text: data.ok ? t('chat.tool.ok') : t('chat.tool.failed') }),
        icon('chevron-down', 'icon-sm tool-caret')
      ),
      h('div.tool-body', null, label, pre)
    );
    return details;
  }
  card.chip.textContent = data.ok ? t('chat.tool.ok') : t('chat.tool.failed');
  card.chip.className = `chip ${data.ok ? 'chip-ok' : 'chip-danger'}`;
  card.body.append(label, pre);
  return null;
}

/* ── live stream bubble ────────────────────────────────────────────── */

const updateLiveText = raf(() => {
  if (chat.liveNode && chat.liveBody) chat.liveBody.textContent = chat.liveText;
});

function appendLive(text) {
  const stick = isNearBottom(refs.scroller, 160);
  if (!chat.liveNode) {
    chat.liveBody = h('div.msg-body');
    chat.liveNode = h(
      'div.msg.msg-assistant.live',
      { 'aria-live': 'off' },
      h('div.msg-role', null, icon('sparkle'), h('span', { text: t('chat.assistant') })),
      chat.liveBody
    );
    refs.liveSlot.appendChild(chat.liveNode);
    announce(t('chat.streamStarted'));
  }
  chat.liveText += text;
  updateLiveText();
  if (stick) scrollToBottom(refs.scroller);
}

function clearLive() {
  chat.liveText = '';
  chat.liveNode = null;
  chat.liveBody = null;
  clear(refs.liveSlot);
  announce(t('a11y.streamDone'));
}

function clearLiveSlot() {
  chat.liveText = '';
  chat.liveNode = null;
  chat.liveBody = null;
  clear(refs.liveSlot);
}

/* ── header / status ───────────────────────────────────────────────── */

function updateHeader() {
  if (!chat.summary) {
    refs.title.textContent = t('chat.noSession');
    refs.subText.textContent = '';
    refs.subDot.className = 'dot dot-idle';
    refs.pendingBtn.hidden = true;
    refs.back.hidden = false;
    return;
  }
  refs.title.textContent = chat.summary.title || t('chat.noSession');
  refs.subDot.className = `dot dot-${statusKind(chat.summary.status, chat.running)}`;
  const parts = [statusLabel(chat.summary.status, chat.running)];
  if (chat.summary.model) parts.push(chat.summary.model);
  if (chat.summary.workspaceName) parts.push(chat.summary.workspaceName);
  refs.subText.textContent = parts.join(' · ');
  updatePendingBadge();
  updateStopButton();
  updateQueueLabel();
}

function statusKind(status, running) {
  if (running) return 'running';
  if (status === 'blocked') return 'blocked';
  if (status === 'queued') return 'blocked';
  if (status === 'running') return 'running';
  return 'idle';
}

function statusLabel(status, running) {
  if (running) return t('chat.status.running');
  if (status === 'blocked') return t('chat.status.blocked');
  if (status === 'queued') return t('chat.status.queued');
  if (status === 'running') return t('chat.status.running');
  return t('chat.status.idle');
}

function updatePendingBadge() {
  const pending = Boolean(chat.pendingApproval || chat.pendingQuestion);
  refs.pendingBtn.hidden = !pending;
  if (pending) {
    refs.pendingBtn.setAttribute(
      'aria-label',
      chat.pendingApproval ? t('chat.approval.title') : t('chat.question.title')
    );
  }
}

function setRunning(running) {
  if (chat.running === running) {
    updateComposerState();
    return;
  }
  chat.running = running;
  if (chat.summary) chat.summary.status = running ? 'running' : chat.summary.status === 'blocked' ? 'blocked' : 'idle';
  if (chat.sessionId) patchSession(chat.sessionId, { status: running ? 'running' : 'idle' });
  if (!running) chat.mode = 'transcript';
  updateHeader();
  updateComposerState();
}

/* ── composer ──────────────────────────────────────────────────────── */

function renderModeChips() {
  const modes = [
    { id: 'transcript', label: t('chat.mode.send'), hint: t('chat.mode.hint.send'), glyph: 'send' },
    { id: 'queue', label: t('chat.mode.queue'), hint: t('chat.mode.hint.queue'), glyph: 'queue' },
    { id: 'steer', label: t('chat.mode.steer'), hint: t('chat.mode.hint.steer'), glyph: 'steer' },
  ];
  clear(refs.modes);
  for (const mode of modes) {
    refs.modes.appendChild(
      h(
        'button.mode-chip',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': String(chat.mode === mode.id),
          title: mode.hint,
          onclick: () => {
            chat.mode = mode.id;
            renderModeChips();
            updateComposerState();
          },
        },
        icon(mode.glyph, 'icon-sm'),
        h('span', { text: mode.label })
      )
    );
  }
}

function updateComposerState() {
  const hasSession = Boolean(chat.sessionId);
  refs.composer.hidden = !hasSession;
  refs.textarea.disabled = !hasSession || chat.summary?.archived;
  refs.sendBtn.disabled = !hasSession || !refs.textarea.value.trim();
  refs.modes.hidden = !chat.running || !hasSession;
  refs.modeHint.textContent = chat.running
    ? t(`chat.mode.hint.${chat.mode}`)
    : t('chat.composerHint');
  updateStopButton();
  updateQueueLabel();
  refs.root.dataset.empty = hasSession ? 'false' : 'true';
}

function updateStopButton() {
  refs.stopBtn.hidden = !chat.running;
}

function updateQueueLabel() {
  refs.queueLabel.textContent = chat.queue > 0 ? tn('chat.queue', chat.queue) : '';
}

function scheduleDraftSave() {
  clearTimeout(chat.draftTimer);
  const sessionId = chat.sessionId;
  const value = refs.textarea.value;
  chat.draftTimer = setTimeout(() => {
    if (sessionId) db.setDraft(sessionId, value);
  }, 400);
}

function saveDraftNow() {
  clearTimeout(chat.draftTimer);
  if (chat.sessionId) db.setDraft(chat.sessionId, refs.textarea.value);
}

async function submitPrompt() {
  if (!chat.sessionId) return;
  const text = refs.textarea.value.trim();
  if (!text) return;
  const mode = chat.running ? chat.mode : 'transcript';
  const requestId = newRequestId();
  const sessionId = chat.sessionId;

  refs.textarea.value = '';
  autoGrow(refs.textarea);
  updateComposerState();
  saveDraftNow();
  const stick = isNearBottom(refs.scroller, 160);
  const node = userNode(text);
  node.classList.add('msg-pending');
  refs.messages.appendChild(node);
  if (stick) scrollToBottom(refs.scroller);
  else addUnread(1);
  chat.pendingSends.set(requestId, {
    text,
    node,
    timer: setTimeout(() => removePendingSend(requestId), 12000),
  });

  try {
    await api.prompt(sessionId, { requestId, text, mode });
    if (mode !== 'transcript') toast(t('chat.sendQueued'), 'ok');
  } catch (error) {
    removePendingSend(requestId);
    if (!refs.textarea.value) {
      refs.textarea.value = text;
      autoGrow(refs.textarea);
      updateComposerState();
    }
    toast(`${t('chat.sendFailed')}: ${errorText(error)}`, 'danger');
  }
}

function removePendingSend(requestId) {
  const entry = chat.pendingSends.get(requestId);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.node.remove();
  chat.pendingSends.delete(requestId);
}

function reconcilePendingSends(events) {
  if (!chat.pendingSends.size) return;
  for (const event of events) {
    if (event.k !== 'user/message') continue;
    const text = String(event.d?.text || '').trim();
    for (const [requestId, entry] of chat.pendingSends) {
      if (entry.text === text) {
        removePendingSend(requestId);
        break;
      }
    }
  }
}

async function stopTurn() {
  if (!chat.sessionId) return;
  try {
    await api.cancel(chat.sessionId, { requestId: newRequestId(), scope: 'turn' });
    toast(t('chat.stopped'), 'ok');
  } catch (error) {
    toast(`${t('chat.stopFailed')}: ${errorText(error)}`, 'danger');
  }
}

/* ── approval / question ───────────────────────────────────────────── */

function setPendingApproval(approval) {
  chat.pendingApproval = approval || null;
  if (!approval) {
    chat.approvalOpen = false;
    closePendingSheets();
  } else if (!chat.approvalOpen) {
    showApprovalSheet();
  }
  updatePendingBadge();
  updateComposerState();
}

function setPendingQuestion(question) {
  chat.pendingQuestion = question || null;
  if (!question) {
    chat.questionOpen = false;
    closePendingSheets();
  } else if (!chat.questionOpen) {
    showQuestionSheet();
  }
  updatePendingBadge();
  updateComposerState();
}

function syncSheets() {
  if (chat.pendingApproval && !chat.approvalOpen) showApprovalSheet();
  if (!chat.pendingApproval && chat.approvalOpen) {
    chat.approvalOpen = false;
    closeAllSheets();
  }
  if (chat.pendingQuestion && !chat.questionOpen && !chat.pendingApproval) showQuestionSheet();
  if (!chat.pendingQuestion && chat.questionOpen) {
    chat.questionOpen = false;
    closeAllSheets();
  }
  updatePendingBadge();
}

function closePendingSheets() {
  closeAllSheets();
  chat.approvalOpen = false;
  chat.questionOpen = false;
}

function showApprovalSheet() {
  const approval = chat.pendingApproval;
  if (!approval || !chat.sessionId) return;
  // The sheet also opens automatically when a pending approval arrives; a click
  // on the header button must not stack a second copy on top of it.
  if (chat.approvalOpen) return;
  chat.approvalOpen = true;
  const remember = h('input', { type: 'checkbox', id: 'approval-remember' });
  const body = h(
    'div',
    null,
    approval.detail ? h('pre.approval-detail', { text: approval.detail }) : null,
    h(
      'label.remember',
      { for: 'approval-remember' },
      remember,
      h('span', { text: t('chat.approval.remember') })
    )
  );
  const send = async (decision, close) => {
    try {
      await api.approval(chat.sessionId, {
        requestId: newRequestId(),
        approvalId: approval.approvalId,
        decision,
        remember: remember.checked,
      });
      toast(t('chat.approval.done'), 'ok');
      chat.approvalOpen = false;
      close();
      setPendingApproval(null);
    } catch (error) {
      toast(`${t('chat.approval.failed')}: ${errorText(error)}`, 'danger');
    }
  };
  openSheet({
    title: approval.title || t('chat.approval.title'),
    subtitle: t('chat.approval.subtitle'),
    body,
    actions: [
      {
        type: 'button',
        kind: 'primary',
        label: t('chat.approval.allow'),
        icon: 'check',
        onClick: (close) => send('allow', close),
      },
      {
        type: 'button',
        kind: 'danger',
        label: t('chat.approval.deny'),
        icon: 'close',
        onClick: (close) => send('deny', close),
      },
    ],
    onClose: () => {
      chat.approvalOpen = false;
    },
  });
}

function showQuestionSheet() {
  const question = chat.pendingQuestion;
  if (!question || !chat.sessionId) return;
  if (chat.questionOpen) return;
  chat.questionOpen = true;
  const options = Array.isArray(question.options) ? question.options : [];
  const body = h('div');
  if (question.question) body.appendChild(h('p', { text: question.question }));
  const send = async (answer, close) => {
    if (!answer) return;
    try {
      await api.question(chat.sessionId, {
        requestId: newRequestId(),
        questionId: question.questionId,
        answer,
      });
      toast(t('chat.question.done'), 'ok');
      chat.questionOpen = false;
      close();
      setPendingQuestion(null);
    } catch (error) {
      toast(`${t('chat.question.failed')}: ${errorText(error)}`, 'danger');
    }
  };
  const actions = options.map((option) => ({
    type: 'button',
    kind: 'primary',
    label: String(option?.label || option),
    icon: 'check',
    onClick: (close) => send(String(option?.value || option?.label || option), close),
  }));
  const custom = h('textarea.textarea', {
    rows: '2',
    placeholder: t('chat.question.placeholder'),
    'aria-label': t('chat.question.placeholder'),
  });
  const submitCustom = h(
    'button.btn.btn-primary.btn-block',
    {
      type: 'button',
      onclick: () => {
        const value = custom.value.trim();
        if (value) send(value, () => {});
      },
    },
    icon('send', 'icon-sm'),
    h('span', { text: t('chat.question.submit') })
  );
  body.append(h('p.tool-section-label', { text: t('chat.question.custom') }), custom, submitCustom);
  openSheet({
    title: question.question || t('chat.question.title'),
    subtitle: t('chat.question.subtitle'),
    body,
    actions,
    onClose: () => {
      chat.questionOpen = false;
    },
  });
}

/* ── empty / skeleton / errors ─────────────────────────────────────── */

function emptyState() {
  return h(
    'div.empty',
    null,
    h('span.empty-mark', null, icon('sparkle', 'icon-lg')),
    h('p.empty-title', { text: t('chat.emptyTitle') }),
    h('p.empty-hint', { text: t('chat.emptyHint') })
  );
}

function emptySessionState() {
  return h(
    'div.empty',
    null,
    h('span.empty-mark', null, icon('terminal', 'icon-lg')),
    h('p.empty-title', { text: t('chat.emptySessionTitle') }),
    h('p.empty-hint', { text: t('chat.emptySessionHint') })
  );
}

function setEmptyState() {
  clear(refs.messages);
  refs.messages.appendChild(emptyState());
  refs.textarea.disabled = true;
  refs.composer.hidden = true;
}

function hideEmptyState() {
  const empty = refs.messages.querySelector('.empty');
  if (empty) empty.remove();
}

function showSkeleton() {
  clear(refs.messages);
  for (let i = 0; i < 3; i += 1) {
    const node = h(
      'div.msg.msg-assistant',
      null,
      h('div.skel.skel-line', { style: { width: i % 2 ? '42%' : '28%' } }),
      h('div.skel.skel-line', { style: { width: '92%', 'margin-top': '10px' } }),
      h('div.skel.skel-line', { style: { width: i === 1 ? '64%' : '78%', 'margin-top': '6px' } })
    );
    refs.messages.appendChild(node);
  }
}

function showError(message) {
  const node = h(
    'div.notice.notice-danger',
    null,
    icon('alert', 'icon-sm'),
    h('div', null, h('div', { text: message }), h('button.btn.btn-sm', { type: 'button', onclick: reload, style: { 'margin-top': '8px' } }, h('span', { text: t('common.retry') })))
  );
  refs.messages.prepend(node);
}

/* ── scroll / unread / jump ────────────────────────────────────────── */

function addUnread(count) {
  chat.unread += count;
  const chip = refs.jumpBtn.querySelector('.chip');
  chip.textContent = String(chat.unread);
  chip.hidden = false;
  refs.jumpBtn.hidden = false;
}

function onScroll() {
  if (isNearBottom(refs.scroller, 90)) {
    chat.unread = 0;
    refs.jumpBtn.hidden = true;
    const chip = refs.jumpBtn.querySelector('.chip');
    if (chip) chip.hidden = true;
    scheduleRead();
  }
}

function jumpToLatest() {
  scrollToBottom(refs.scroller, true);
  chat.unread = 0;
  refs.jumpBtn.hidden = true;
  const chip = refs.jumpBtn.querySelector('.chip');
  if (chip) chip.hidden = true;
  scheduleRead();
}

function scheduleRead() {
  clearTimeout(chat.readTimer);
  const sessionId = chat.sessionId;
  const seq = chat.lastSeq;
  if (!sessionId || !seq || seq <= chat.readSent) return;
  chat.readTimer = setTimeout(() => {
    if (!chat.sessionId || chat.sessionId !== sessionId) return;
    chat.readSent = seq;
    if (document.hidden) return;
    api.markRead(sessionId, { lastSeenSeq: seq }).catch(() => {});
  }, 1500);
}

/* ── history ───────────────────────────────────────────────────────── */

async function loadOlder() {
  if (!chat.sessionId || chat.loadingOlder) return;
  chat.loadingOlder = true;
  const sessionId = chat.sessionId;
  const before = chat.events.length ? String(chat.events[0].seq) : undefined;
  const button = refs.messages.querySelector('.older-btn');
  if (button) {
    button.disabled = true;
    button.textContent = t('chat.loadingOlder');
  }
  const previousHeight = refs.scroller.scrollHeight;
  try {
    const result = await api.older(sessionId, { before, turns: 3 });
    if (chat.sessionId !== sessionId) return;
    const events = Array.isArray(result.events) ? result.events : [];
    const fresh = events.filter((event) => event && !chat.seqs.has(Number(event.seq)));
    if (!fresh.length) {
      chat.hasOlder = false;
      if (button) button.remove();
      toast(t('chat.noOlder'), 'info');
      return;
    }
    // Prepend while keeping the reading position stable.
    const fragment = document.createDocumentFragment();
    for (const event of fresh) {
      if (chat.seqs.has(Number(event.seq))) continue;
      chat.seqs.add(Number(event.seq));
      chat.events.unshift(event);
      const node = eventNode(event);
      if (node) fragment.appendChild(node);
    }
    chat.events.sort((a, b) => Number(a.seq) - Number(b.seq));
    const anchor = button ? button.nextSibling : refs.messages.firstChild;
    refs.messages.insertBefore(fragment, anchor);
    chat.hasOlder = !!result.hasOlder;
    if (!chat.hasOlder && button) button.remove();
    else if (button) {
      button.disabled = false;
      button.textContent = t('chat.older');
    }
    refs.scroller.scrollTop = refs.scroller.scrollHeight - previousHeight;
    db.putEvents(sessionId, fresh.slice(0, 30));
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = t('chat.older');
    }
    toast(`${t('chat.olderFailed')}: ${errorText(error)}`, 'danger');
  } finally {
    chat.loadingOlder = false;
  }
}

/* ── debug hook for the reviewer ───────────────────────────────────── */

export function debugState() {
  return {
    sessionId: chat.sessionId,
    events: chat.events.length,
    lastSeq: chat.lastSeq,
    liveChars: chat.liveText.length,
    running: chat.running,
    stream: chat.stream?.status || 'none',
  };
}
