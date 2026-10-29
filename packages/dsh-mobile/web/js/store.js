/* DSH Mobile — state.
 * One tiny observable store for durable UI state. High-frequency streaming text
 * lives inside chat.js on purpose: re-rendering the session list on every chunk
 * would burn CPU and battery for no reason.
 */

const PREFIX = 'dshm.';

export const prefs = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* private mode / quota — in-memory fallback is the caller's problem */
    }
  },
  del(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  },
  has(key) {
    try {
      return localStorage.getItem(PREFIX + key) != null;
    } catch {
      return false;
    }
  },
};

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function createStore(initial) {
  let state = { ...initial };
  const listeners = new Set();
  return {
    get(key) {
      return key ? state[key] : state;
    },
    set(patch) {
      const next = typeof patch === 'function' ? { ...state, ...patch(state) } : { ...state, ...patch };
      const prev = state;
      state = next;
      for (const listener of listeners) {
        try {
          listener(state, prev);
        } catch (error) {
          console.error('store listener failed', error);
        }
      }
      return state;
    },
    update(key, patch) {
      const current = state[key];
      const merged = current && typeof current === 'object' && !Array.isArray(current)
        ? { ...current, ...patch }
        : patch;
      return this.set({ [key]: merged });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Subscribe to a projection; projection is compared with Object.is. */
    select(project, listener) {
      let last = project(state);
      return this.subscribe((next) => {
        const value = project(next);
        if (!Object.is(value, last)) {
          last = value;
          listener(value, next);
        }
      });
    },
  };
}

const validTheme = ['auto', 'light', 'dark'];
const storedTheme = prefs.get('theme', 'auto');
const storedScale = clamp(prefs.get('fontScale', 1), 0.9, 1.3);

export const store = createStore({
  ui: {
    lang: prefs.get('lang', 'ru') === 'en' ? 'en' : 'ru',
    theme: validTheme.includes(storedTheme) ? storedTheme : 'auto',
    fontScale: storedScale,
    demo: false,
    lab: false,
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  },
  auth: { paired: false },
  device: null, // { id, name, host: { name, appVersion, protocol } }
  connection: { state: 'idle', detail: '' },
  sessions: [],
  sessionsState: 'idle', // idle | loading | ready | error
  sessionsError: '',
  sessionsQuery: '',
  sessionsCursor: null,
  sessionsUsedCache: false,
  activeSessionId: null,
  session: null, // SessionSummary of the open session
  stream: {
    state: 'idle', // idle | connecting | open | reconnecting | suspended | closed
    running: false,
    status: 'idle',
    queue: 0,
    pendingApproval: null,
    pendingQuestion: null,
  },
  openApprovalId: null,
  openQuestionId: null,
  diagnostics: {
    requests: 0,
    bytes: 0,
    rttMs: 0,
    sseEvents: 0,
    resyncs: 0,
    lastSyncAt: 0,
    cacheSessions: 0,
    cacheEvents: 0,
    serverTimeOffset: 0,
  },
});

export function statusKind(status) {
  switch (status) {
    case 'running':
      return 'running';
    case 'blocked':
      return 'blocked';
    case 'queued':
      return 'queued';
    default:
      return 'idle';
  }
}
