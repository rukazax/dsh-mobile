/* DSH Mobile — session list pane.
 * Cached render → revalidate → SSE updates. Byte-thrift: no polling, one list
 * request on open/pull/refresh, the search box filters locally and debounces a
 * server-side `q` query (contract §4.2).
 */
import { api, errorText, hasAuth, newRequestId } from './api.js';
import { store } from './store.js';
import { t, tn, fmtRel } from './i18n.js';
import * as db from './db.js';
import { navigate } from './router.js';
import { clear, h, icon, toast } from './dom.js';

const refs = {};
let pull = { active: false, startY: 0, dist: 0 };
let searchTimer = 0;
let lastRefreshAt = 0;

export function initSessions() {
  const root = document.getElementById('pane-list');
  if (!root) return;

  refs.headerSub = h('span.brand-sub', { text: '' });
  const header = h(
    'header.pane-head.list-head',
    null,
    h(
      'div.brand',
      null,
      h('span.brand-mark', { text: '>_' }),
      h(
        'div.brand-text',
        null,
        h('h1.brand-title', { text: t('app.title') }),
        refs.headerSub
      )
    ),
    h(
      'div.head-actions',
      null,
      (refs.refreshBtn = h(
        'button.btn-icon',
        { type: 'button', 'aria-label': t('sessions.refresh'), title: t('sessions.refresh'), onclick: () => refreshSessions() },
        icon('refresh')
      )),
      (refs.settingsBtn = h(
        'button.btn-icon',
        { type: 'button', 'aria-label': t('common.settings'), title: t('common.settings'), onclick: () => navigate('/settings') },
        icon('gear')
      ))
    )
  );

  refs.searchInput = h('input', {
    type: 'search',
    placeholder: t('sessions.searchPlaceholder'),
    'aria-label': t('sessions.searchPlaceholder'),
    autocomplete: 'off',
    spellcheck: 'false',
    value: store.get('sessionsQuery') || '',
  });
  refs.clearSearch = h(
    'button.btn-icon.btn-sm',
    { type: 'button', 'aria-label': t('common.clear'), hidden: !refs.searchInput.value, onclick: clearSearch },
    icon('close', 'icon-sm')
  );
  refs.newBtn = h(
    'button.btn-icon',
    { type: 'button', 'aria-label': t('sessions.new'), title: t('sessions.new'), onclick: createSession },
    icon('plus')
  );
  const tools = h(
    'div.list-tools',
    null,
    h('label.searchbox', null, icon('search', 'icon-sm'), refs.searchInput, refs.clearSearch),
    refs.newBtn
  );

  refs.banners = h('div.list-banners');
  refs.pullText = h('span', { text: t('sessions.pull') });
  refs.pullIndicator = h('div.pull-indicator', null, icon('arrow-down', 'icon-sm'), refs.pullText);
  refs.list = h('div.session-list', { role: 'list' });
  refs.footer = h('div.list-foot');
  refs.scroller = h(
    'div.scroll.list-scroll',
    { id: 'sessions-scroll', tabindex: '-1' },
    refs.pullIndicator,
    refs.list,
    refs.footer
  );

  clear(root);
  root.append(header, tools, refs.banners, refs.scroller);

  bindEvents();
  subscribeStore();
  renderSessions();

  (async () => {
    if (!store.get('ui').demo) {
      const cached = await db.readSessions();
      if (cached.length) store.set({ sessions: cached, sessionsUsedCache: true });
    }
    if (hasAuth()) refreshSessions({ silent: store.get('sessions').length > 0 });
  })();
}

function bindEvents() {
  refs.searchInput.addEventListener('input', () => {
    store.set({ sessionsQuery: refs.searchInput.value });
    refs.clearSearch.hidden = !refs.searchInput.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => refreshSessions({ silent: true }), 450);
    renderSessions();
  });

  refs.scroller.addEventListener(
    'touchstart',
    (event) => {
      if (refs.scroller.scrollTop <= 0 && event.touches.length === 1 && !pull.active) {
        pull = { active: true, startY: event.touches[0].clientY, dist: 0 };
      }
    },
    { passive: true }
  );
  refs.scroller.addEventListener(
    'touchmove',
    (event) => {
      if (!pull.active) return;
      const delta = event.touches[0].clientY - pull.startY;
      if (delta <= 0) {
        resetPull();
        return;
      }
      pull.dist = Math.min(delta * 0.55, 92);
      refs.pullIndicator.style.height = `${pull.dist}px`;
      refs.pullIndicator.classList.toggle('active', pull.dist > 8);
      const armed = pull.dist > 54;
      refs.pullIndicator.classList.toggle('armed', armed);
      refs.pullText.textContent = armed ? t('sessions.release') : t('sessions.pull');
      if (delta > 8) event.preventDefault();
    },
    { passive: false }
  );
  refs.scroller.addEventListener('touchend', () => {
    const armed = pull.dist > 54;
    resetPull();
    if (armed) refreshSessions();
  });
  window.addEventListener('online', () => {
    renderSessions();
    refreshSessions({ silent: true });
  });
  window.addEventListener('offline', () => renderSessions());
}

function resetPull() {
  pull = { active: false, startY: 0, dist: 0 };
  if (refs.pullIndicator) {
    refs.pullIndicator.style.height = '';
    refs.pullIndicator.classList.remove('active', 'armed');
    if (refs.pullText) refs.pullText.textContent = t('sessions.pull');
  }
}

function clearSearch() {
  refs.searchInput.value = '';
  refs.clearSearch.hidden = true;
  store.set({ sessionsQuery: '' });
  refreshSessions({ silent: true });
}

function subscribeStore() {
  let last = '';
  store.subscribe((state) => {
    const key = [
      state.sessions.length,
      state.sessionsState,
      state.sessionsError,
      state.activeSessionId,
      state.sessionsQuery,
      state.sessionsUsedCache,
      state.ui.lang,
      state.ui.demo,
      state.ui.online,
      state.connection.state,
      state.session?.status,
      state.session?.title,
    ].join('|');
    if (key === last) return;
    last = key;
    renderSessions();
    updateHeaderSub();
  });
}

function updateHeaderSub() {
  const state = store.get();
  let text = '';
  if (state.ui.demo) text = t('common.demo');
  if (!state.ui.online) text = t('conn.offline');
  else if (state.connection.state === 'connecting') text = t('conn.connecting');
  else if (state.connection.state === 'online') text = t('conn.live');
  else if (!hasAuth() && !state.ui.demo) text = t('settings.notPaired');
  refs.headerSub.textContent = text || t('app.tagline');
}

/* ── rendering ─────────────────────────────────────────────────────── */

export function renderSessions() {
  if (!refs.list) return;
  const state = store.get();
  const sessions = state.sessions || [];
  const query = String(state.sessionsQuery || '').trim().toLowerCase();
  const filtered = query
    ? sessions.filter((item) =>
        `${item.title || ''} ${item.lastText || ''} ${item.workspaceName || ''}`.toLowerCase().includes(query)
      )
    : sessions;

  const scrollTop = refs.scroller?.scrollTop || 0;
  clear(refs.list);
  refs.banners.replaceChildren(...banners());
  refs.list.setAttribute('aria-busy', state.sessionsState === 'loading' ? 'true' : 'false');

  if (state.sessionsState === 'loading' && !sessions.length) {
    renderSkeletons();
  } else if (state.sessionsState === 'error' && !sessions.length) {
    refs.list.appendChild(
      h(
        'div.empty',
        null,
        h('span.empty-mark', null, icon('cloud-off', 'icon-lg')),
        h('p.empty-title', { text: t('sessions.error') }),
        state.sessionsError ? h('p.empty-hint', { text: state.sessionsError }) : null,
        h(
          'button.btn.btn-primary',
          { type: 'button', onclick: () => refreshSessions() },
          icon('refresh', 'icon-sm'),
          h('span', { text: t('common.retry') })
        )
      )
    );
  } else if (!filtered.length) {
    renderEmpty(query);
  } else {
    for (const session of filtered) refs.list.appendChild(sessionItem(session, state.activeSessionId));
  }

  renderFooter(filtered.length, sessions.length);
  if (refs.scroller) refs.scroller.scrollTop = scrollTop;
  updateHeaderSub();
}

function sessionItem(session, activeId) {
  const active = session.id === activeId;
  const badges = [];
  if (session.status === 'running') {
    badges.push(h('span.chip.chip-accent', null, h('span.dot.dot-running'), h('span', { text: t('sessions.status.running') })));
  } else if (session.status === 'blocked') {
    badges.push(h('span.chip.chip-warn', null, icon('alert', 'icon-sm'), h('span', { text: t('sessions.status.blocked') })));
  } else if (session.status === 'queued') {
    badges.push(h('span.chip', null, icon('queue', 'icon-sm'), h('span', { text: t('sessions.status.queued') })));
  }
  if (session.hasPendingApproval) {
    badges.push(h('span.chip.chip-warn', null, icon('lock', 'icon-sm'), h('span', { text: t('sessions.approval') })));
  }
  if (session.hasPendingQuestion) {
    badges.push(h('span.chip.chip-accent', null, icon('help', 'icon-sm'), h('span', { text: t('sessions.question') })));
  }

  const item = h(
    'button.session-item',
    {
      type: 'button',
      role: 'listitem',
      'aria-current': active ? 'true' : 'false',
      'aria-label': `${session.title || ''}${session.status ? `, ${t('sessions.status.' + session.status) || session.status}` : ''}`,
      onclick: () => navigate(`/s/${encodeURIComponent(session.id)}`),
    },
    h(
      'div.si-top',
      null,
      h('span.si-title', { text: session.title || session.id }),
      h('time.si-time', { text: fmtRel(session.updatedAt), datetime: session.updatedAt || '' })
    ),
    h(
      'div.si-sub',
      null,
      h('span', { text: session.workspaceName || t('common.unknown') }),
      h('span.sep', { text: '·' }),
      h('span', { text: session.model || '' }),
      session.eventCount ? h('span.sep', { text: '·' }) : null,
      session.eventCount ? h('span', { text: `${session.eventCount} ${tn('sessions.events', session.eventCount)}` }) : null
    ),
    session.lastText ? h('p.si-last', { text: session.lastText }) : null,
    badges.length ? h('div.si-badges', null, ...badges) : null
  );
  return item;
}

function renderSkeletons() {
  for (let i = 0; i < 6; i += 1) {
    refs.list.appendChild(
      h(
        'div.skel-item',
        null,
        h('div.skel.skel-line', { style: { width: i % 2 ? '64%' : '78%' } }),
        h('div.skel.skel-line', { style: { width: i % 2 ? '92%' : '84%' } })
      )
    );
  }
}

function renderEmpty(query) {
  const filtered = Boolean(query);
  const paired = hasAuth() || store.get('ui').demo;
  const empty = h(
    'div.empty',
    null,
    h('span.empty-mark', null, icon(filtered ? 'search' : paired ? 'list' : 'link', 'icon-lg')),
    h('p.empty-title', { text: t(filtered ? 'sessions.emptyFiltered' : 'sessions.emptyTitle') }),
    h('p.empty-hint', { text: t(filtered ? 'sessions.emptyFilteredHint' : 'sessions.emptyHint') }),
    filtered
      ? null
      : h(
          'button.btn.btn-primary',
          {
            type: 'button',
            onclick: () => (paired ? createSession() : navigate('/pair')),
          },
          icon(paired ? 'plus' : 'link', 'icon-sm'),
          h('span', { text: paired ? t('sessions.new') : t('pair.title') })
        )
  );
  refs.list.appendChild(empty);
}

function renderFooter(filteredCount, totalCount) {
  if (!refs.footer) return;
  const state = store.get();
  const parts = [`${filteredCount} ${tn('sessions.count', filteredCount)}`];
  if (state.sessionsUsedCache) parts.push(t('sessions.cached'));
  refs.footer.textContent = parts.join(' · ');
  refs.footer.classList.toggle('list-foot-hint', true);
}

function banners() {
  const state = store.get();
  const nodes = [];
  if (state.ui.demo) {
    nodes.push(
      h('div.banner.banner-info', null, icon('info', 'icon-sm'), h('span', { text: t('demo.banner') }))
    );
  }
  if (!state.ui.online) {
    nodes.push(
      h('div.banner.banner-warn', null, icon('cloud-off', 'icon-sm'), h('span', { text: t('conn.offline') }))
    );
  }
  const base = api.base();
  const insecure = /^http:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(base);
  if (insecure && !state.ui.demo) {
    nodes.push(
      h(
        'div.banner.banner-warn',
        null,
        icon('lock', 'icon-sm'),
        h('div', null, h('div', { text: t('conn.insecure') }), h('div', { text: t('conn.insecureHint') }))
      )
    );
  }
  if (state.sessionsError && state.sessions.length) {
    nodes.push(
      h(
        'div.banner.banner-danger',
        null,
        icon('alert', 'icon-sm'),
        h('span', { text: state.sessionsError }),
        h('button.btn.btn-sm', { type: 'button', onclick: () => refreshSessions() }, h('span', { text: t('common.retry') }))
      )
    );
  }
  return nodes;
}

/* ── network ───────────────────────────────────────────────────────── */

export async function refreshSessions({ silent = false } = {}) {
  const state = store.get();
  if (state.sessionsState === 'loading' && !silent) return;
  if (!hasAuth()) return;
  const now = Date.now();
  if (silent && now - lastRefreshAt < 800) return;
  lastRefreshAt = now;
  if (!state.sessions.length || !silent) {
    store.set({ sessionsState: 'loading', sessionsError: '' });
  }
  try {
    const query = String(store.get('sessionsQuery') || '').trim();
    const result = await api.sessions({ limit: 50, q: query || undefined });
    const rows = (result?.sessions || []).map(normalizeSummary);
    store.set({
      sessions: rows,
      sessionsState: 'ready',
      sessionsError: '',
      sessionsCursor: result?.nextCursor || null,
      sessionsUsedCache: false,
    });
    await db.cacheSessions(rows);
    store.update('diagnostics', { lastSyncAt: Date.now(), cacheSessions: rows.length });
  } catch (error) {
    if (error?.code === 'auth-invalid' || error?.code === 'auth-required') return; // main routes to /pair
    const cached = store.get('sessions');
    store.set({
      sessionsState: cached.length ? 'ready' : 'error',
      sessionsError: errorText(error),
    });
    if (!silent) toast(errorText(error), 'danger');
  }
}

export async function createSession() {
  if (!hasAuth() || refs.newBtn?.disabled) return;
  if (refs.newBtn) refs.newBtn.disabled = true;
  try {
    const result = await api.createSession({ requestId: newRequestId() });
    const session = result?.session;
    if (!session) throw new Error('no session in response');
    const rows = [normalizeSummary(session), ...store.get('sessions').filter((item) => item.id !== session.id)];
    store.set({ sessions: rows, sessionsState: 'ready' });
    await db.cacheSessions(rows);
    if (store.get('ui').demo) toast(t('sessions.newDemoHint'), 'ok');
    navigate(`/s/${encodeURIComponent(session.id)}`);
  } catch (error) {
    toast(`${t('sessions.newFailed')}: ${errorText(error)}`, 'danger');
  } finally {
    if (refs.newBtn) refs.newBtn.disabled = false;
  }
}

export function patchSession(sid, patch) {
  if (!sid) return;
  const state = store.get();
  let changed = false;
  const sessions = state.sessions.map((item) => {
    if (item.id !== sid) return item;
    changed = true;
    return { ...item, ...patch };
  });
  if (!changed) return;
  const current =
    state.session && state.session.id === sid ? { ...state.session, ...patch } : state.session;
  store.set({ sessions, session: current });
}

export function getActiveSession() {
  return store.get('session');
}

function normalizeSummary(summary) {
  return {
    ...summary,
    id: String(summary?.id || ''),
    title: summary?.title || summary?.id || '',
    workspaceName: summary?.workspaceName || '',
    status: summary?.status || 'idle',
    model: summary?.model || '',
    updatedAt: summary?.updatedAt || '',
    hasPendingApproval: Boolean(summary?.hasPendingApproval),
    hasPendingQuestion: Boolean(summary?.hasPendingQuestion),
  };
}
