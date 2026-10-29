/* DSH Mobile — bootstrap.
 * Order matters: preferences → demo transport (if any) → panes → lab → router.
 * The two panes are mounted once and never torn down, so a foldable posture
 * change only rearranges CSS; the draft, scroll position and live SSE survive.
 */
import { prefs, store } from './store.js';
import { setLang, t } from './i18n.js';
import * as db from './db.js';
import { api, clearAuth, getBase, hasAuth, onAuthError } from './api.js';
import { replaceRoute, startRouter } from './router.js';
import { createSession, initSessions, refreshSessions } from './sessions.js';
import { debugState, initChat, openSession } from './chat.js';
import { openSettings } from './settings.js';
import { openPair } from './pair.js';
import { initLab, openLab } from './lab.js';
import { installDemo } from './demo.js';
import { closeAllSheets, closeOverlay, toast } from './dom.js';

const params = new URLSearchParams(location.search);
const demoMode = params.get('demo') != null && params.get('demo') !== '0';
const labMode = params.get('lab') != null && params.get('lab') !== '0';
const app = document.getElementById('app');

function boot() {
  // URL overrides are handy for review links (?theme=dark&lang=en).
  const langParam = params.get('lang');
  if (langParam === 'en' || langParam === 'ru') prefs.set('lang', langParam);
  const themeParam = params.get('theme');
  if (['auto', 'light', 'dark'].includes(themeParam)) prefs.set('theme', themeParam);

  const lang = prefs.get('lang', 'ru') === 'en' ? 'en' : 'ru';
  const theme = ['auto', 'light', 'dark'].includes(prefs.get('theme', 'auto'))
    ? prefs.get('theme', 'auto')
    : 'auto';
  setLang(lang);
  store.update('ui', {
    lang,
    theme,
    fontScale: prefs.get('fontScale', 1),
    demo: false,
    lab: labMode,
    online: navigator.onLine !== false,
  });
  applyTheme(theme);
  applyFontScale(store.get('ui').fontScale);

  if (demoMode) installDemo();

  db.initDB();
  initChat();
  initSessions();
  initLab();
  bindGlobal();
  registerServiceWorker();

  if (!location.hash) {
    if (demoMode) replaceRoute('/s/s-demo-1');
    else if (hasAuth()) replaceRoute('/sessions');
    else replaceRoute('/pair');
  }

  startRouter(handleRoute);
  updateTitle(store.get());
  store.subscribe((state) => updateTitle(state));
}

/* ── routing ───────────────────────────────────────────────────────── */

function handleRoute(route) {
  const paired = hasAuth() || store.get('ui').demo;
  app.dataset.route = route.name;

  if (!paired && route.name === 'session') {
    app.dataset.view = 'list';
    closeOverlay('route');
    replaceRoute('/pair');
    openPair();
    return;
  }

  closeOverlay('route');
  if (route.name !== 'session') closeAllSheets();

  switch (route.name) {
    case 'pair':
      app.dataset.view = 'list';
      openPair();
      break;
    case 'settings':
      app.dataset.view = 'list';
      openSettings();
      break;
    case 'lab':
      app.dataset.view = 'list';
      openLab();
      break;
    case 'session':
      app.dataset.view = 'chat';
      openSession(route.params.id);
      break;
    case 'sessions': {
      app.dataset.view = 'list';
      if (route.query.get('new') === '1') {
        replaceRoute('/sessions');
        createSession();
        break;
      }
      const lastSync = store.get('diagnostics').lastSyncAt || 0;
      if (paired && Date.now() - lastSync > 30000) refreshSessions({ silent: true });
      break;
    }
    default:
      app.dataset.view = 'list';
      replaceRoute('/sessions');
      break;
  }
}

/* ── theme / typography ────────────────────────────────────────────── */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  requestAnimationFrame(updateThemeColor);
}

function updateThemeColor() {
  const meta = document.getElementById('meta-theme-color');
  if (!meta) return;
  const color = getComputedStyle(document.body).backgroundColor;
  if (color && color !== 'rgba(0, 0, 0, 0)') meta.setAttribute('content', color);
}

function applyFontScale(scale) {
  document.documentElement.style.setProperty('--font-scale', String(scale));
}

function updateTitle(state) {
  const title = state?.session?.title
    ? `${state.session.title} — ${t('app.title')}`
    : t('app.title');
  if (document.title !== title) document.title = title;
}

/* ── global wiring ─────────────────────────────────────────────────── */

function bindGlobal() {
  window.addEventListener('online', () => {
    store.update('ui', { online: true });
    store.update('connection', { state: 'connecting' });
    toast(t('conn.connected'), 'ok');
    refreshSessions({ silent: true });
  });
  window.addEventListener('offline', () => {
    store.update('ui', { online: false });
    store.update('connection', { state: 'offline' });
    toast(t('conn.offline'), 'danger');
  });

  onAuthError(handleAuthError);
  window.addEventListener('dshm-auth-error', handleAuthError);

  window.addEventListener('visibilitychange', () => {
    // SSE suspends/resumes itself; nothing to do for the list (no polling).
    if (!document.hidden) updateThemeColor();
  });

  const colorQuery = window.matchMedia('(prefers-color-scheme: dark)');
  if (colorQuery.addEventListener) colorQuery.addEventListener('change', updateThemeColor);

  setupVisualViewport();

  // Reviewer/debug hook: inspect state from DevTools without a build step.
  window.__dshm = {
    store,
    api,
    getBase,
    sessionDebug: debugState,
    version: '0.1.0',
  };
}

function handleAuthError() {
  if (store.get('ui').demo) return;
  clearAuth();
  store.update('auth', { paired: false });
  store.set({ device: null });
  closeAllSheets();
  toast(t('err.auth'), 'danger');
  replaceRoute('/pair');
  app.dataset.view = 'list';
  closeOverlay('route');
  openPair();
}

function setupVisualViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const apply = () => {
    document.documentElement.style.setProperty('--app-h', `${Math.round(viewport.height)}px`);
  };
  viewport.addEventListener('resize', apply);
  viewport.addEventListener('scroll', apply);
  apply();
  window.addEventListener('orientationchange', () => setTimeout(apply, 150));
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const secure =
    location.protocol === 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1';
  if (!secure) return; // LAN HTTP gateway: SW is unavailable, APK wraps the same files.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      /* offline shell is best-effort */
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
