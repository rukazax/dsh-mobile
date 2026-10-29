/* DSH Mobile — HTTP client for the mobile gateway (docs/mobile-api.md).
 * - Bearer token, JSON envelope, idempotent requestId, 401 → re-pair.
 * - Retries only where it is safe: GETs, 5xx and 429; POSTs reuse their requestId.
 * - Tracks RTT and received bytes for the diagnostics screen (byte thrift is a
 *   product requirement, so we measure it).
 */
import { prefs } from './store.js';
import { t } from './i18n.js';

const API_PATH = '/api/v1';
const DEFAULT_TIMEOUT = 20000;

let transport = null; // demo mode swaps this out
let authHandler = null;

export const netStats = {
  requests: 0,
  bytes: 0,
  rttMs: 0,
  lastStatus: 0,
  lastAt: 0,
  lastError: '',
};

export class ApiError extends Error {
  constructor(message, { code = 'internal', status = 0, retryable = false, cause = null } = {}) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.cause = cause;
  }
}

export function setTransport(next) {
  transport = next;
}

export function getTransport() {
  return transport;
}

export function onAuthError(handler) {
  authHandler = handler;
  return () => {
    if (authHandler === handler) authHandler = null;
  };
}

export function newRequestId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* older WebView */
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ── endpoints & credentials ───────────────────────────────────────── */

export function defaultBase() {
  try {
    const { protocol, hostname, port, origin, pathname } = location;
    if (protocol !== 'http:' && protocol !== 'https:') {
      return `http://127.0.0.1:3081${API_PATH}`;
    }
    if (port === '3081' || pathname === '/' || pathname === '/m/' || pathname === '/index.html') {
      return `${origin}${API_PATH}`;
    }
    // Served from a dev static server: assume the gateway keeps its default LAN port.
    return `${protocol}//${hostname}:3081${API_PATH}`;
  } catch {
    return `http://127.0.0.1:3081${API_PATH}`;
  }
}

export function normalizeBase(input) {
  let raw = String(input || '').trim();
  if (!raw) return defaultBase();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `http://${raw}`;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return defaultBase();
    let path = url.pathname.replace(/\/+$/, '');
    if (!/\/api\/v\d+$/.test(path)) {
      if (!path || path === '/') path = API_PATH;
      else if (/\/api$/.test(path)) path += '/v1';
    }
    return url.origin + path;
  } catch {
    return defaultBase();
  }
}

export function getBase() {
  const stored = prefs.get('base', '');
  return stored ? String(stored) : defaultBase();
}

export function setBase(input) {
  const normalized = normalizeBase(input);
  prefs.set('base', normalized);
  return normalized;
}

export function resetBase() {
  prefs.del('base');
}

export function getToken() {
  return prefs.get('token', '') || '';
}

export function setToken(token) {
  if (token) prefs.set('token', String(token));
  else prefs.del('token');
}

export function getDevice() {
  return prefs.get('device', null);
}

export function setDevice(device) {
  if (device) prefs.set('device', device);
  else prefs.del('device');
}

export function hasAuth() {
  return Boolean(getToken());
}

export function clearAuth() {
  prefs.del('token');
  prefs.del('device');
}

/* ── error helpers ─────────────────────────────────────────────────── */

function byteLength(value) {
  try {
    return new TextEncoder().encode(value).length;
  } catch {
    return value.length;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(attempt) {
  const base = Math.min(8000, 400 * 2 ** Math.max(0, attempt - 1));
  return base * (0.7 + Math.random() * 0.6);
}

function errorFromResponse(status, data) {
  const code = data?.error?.code || (status === 401 ? 'auth-invalid' : status >= 500 ? 'internal' : 'unknown');
  const message = data?.error?.message || `HTTP ${status}`;
  return new ApiError(message, {
    code,
    status,
    retryable: status >= 500 || status === 429,
  });
}

function normalizeFetchError(error) {
  if (error instanceof ApiError) return error;
  if (error?.name === 'AbortError') {
    return new ApiError('aborted', { code: 'aborted', retryable: false, cause: error });
  }
  if (error instanceof TypeError) {
    return new ApiError('network', { code: 'network', retryable: true, cause: error });
  }
  return new ApiError(String(error?.message || error), { code: 'internal', retryable: true, cause: error });
}

export function errorText(error) {
  const code = error?.code || 'unknown';
  const map = {
    'auth-required': 'err.auth',
    'auth-invalid': 'err.auth',
    'pairing-invalid': 'pair.errorInvalid',
    'pairing-expired': 'pair.errorExpired',
    'rate-limited': 'err.rate',
    'session-not-found': 'err.session',
    'session-archived': 'chat.archivedTitle',
    'agent-busy': 'err.busy',
    'prompt-invalid': 'err.promptInvalid',
    'approval-unknown': 'err.approval',
    unsupported: 'err.unsupported',
    network: 'err.network',
    timeout: 'err.timeout',
    aborted: 'err.network',
    internal: 'err.server',
    'bad-json': 'err.server',
  };
  const key = map[code];
  if (key) return t(key);
  if (error?.status === 429) return t('err.rate');
  if (error?.status >= 500) return t('err.server');
  return error?.message && error.message !== code ? error.message : t('err.unknown');
}

function recordStats(elapsed, payload, status) {
  netStats.requests += 1;
  netStats.rttMs = netStats.rttMs ? netStats.rttMs * 0.75 + elapsed * 0.25 : elapsed;
  netStats.lastStatus = status;
  netStats.lastAt = Date.now();
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload || '');
  netStats.bytes += byteLength(text);
}

/* ── core request ──────────────────────────────────────────────────── */

function buildUrl(path, query) {
  const base = getBase().replace(/\/+$/, '');
  let url = base + path;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }
  return url;
}

export async function request(path, options = {}) {
  const {
    method = 'GET',
    query = null,
    body,
    auth = true,
    signal = null,
    timeout = DEFAULT_TIMEOUT,
    retries,
  } = options;

  if (transport) {
    const started = performance.now();
    try {
      const data = await transport.request(path, { method, query, body, signal });
      recordStats(performance.now() - started, data, 200);
      return data;
    } catch (error) {
      const apiError = normalizeFetchError(error);
      netStats.lastError = apiError.code;
      if (apiError.code === 'auth-invalid' || apiError.code === 'auth-required') {
        if (authHandler) authHandler(apiError);
      }
      throw apiError;
    }
  }

  const url = buildUrl(path, query);
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const maxAttempts = retries != null ? retries + 1 : method === 'GET' ? 3 : 2;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const started = performance.now();

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
      });
      const raw = await response.text();
      recordStats(performance.now() - started, raw, response.status);
      let data = null;
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          throw new ApiError('invalid JSON', { code: 'bad-json', status: response.status });
        }
      }
      if (!response.ok) {
        const apiError = errorFromResponse(response.status, data);
        if (response.status === 401 && authHandler) authHandler(apiError);
        if (response.status === 429 && attempt < maxAttempts) {
          lastError = apiError;
          const retryAfter = Number(response.headers.get('retry-after') || 1) * 1000;
          await sleep(Math.min(retryAfter, 5000));
          continue;
        }
        if (response.status >= 500 && attempt < maxAttempts) {
          lastError = apiError;
          await sleep(backoff(attempt));
          continue;
        }
        throw apiError;
      }
      return data;
    } catch (error) {
      const apiError = timedOut
        ? new ApiError('timeout', { code: 'timeout', retryable: true, cause: error })
        : normalizeFetchError(error);
      if (apiError instanceof ApiError && apiError.code && error instanceof ApiError) throw apiError;
      lastError = apiError;
      if (apiError.code === 'aborted' || attempt >= maxAttempts) throw apiError;
      await sleep(backoff(attempt));
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
  throw lastError || new ApiError('unknown', { code: 'unknown' });
}

/* ── typed endpoints (path strings are what the demo transport receives) ── */

export const api = {
  hello: () => request('/hello'),
  pair: (body) => request('/pair', { method: 'POST', body, auth: false }),
  health: () => request('/health'),
  revoke: (body) => request('/devices/revoke', { method: 'POST', body: body || {} }),

  sessions: ({ cursor, limit = 50, q, archived = 0 } = {}) =>
    request('/sessions', { query: { cursor, limit, q, archived } }),
  session: (id, { turns = 2, before } = {}) =>
    request(`/sessions/${encodeURIComponent(id)}`, { query: { turns, before } }),
  older: (id, { before, turns = 2 } = {}) =>
    request(`/sessions/${encodeURIComponent(id)}/older`, { query: { before, turns } }),
  createSession: (body) => request('/sessions', { method: 'POST', body }),
  prompt: (id, body) => request(`/sessions/${encodeURIComponent(id)}/prompt`, { method: 'POST', body }),
  cancel: (id, body) => request(`/sessions/${encodeURIComponent(id)}/cancel`, { method: 'POST', body }),
  approval: (id, body) => request(`/sessions/${encodeURIComponent(id)}/approval`, { method: 'POST', body }),
  question: (id, body) => request(`/sessions/${encodeURIComponent(id)}/question`, { method: 'POST', body }),
  markRead: (id, body) => request(`/sessions/${encodeURIComponent(id)}/read`, { method: 'POST', body }),
  workspaces: () => request('/workspaces'),
  jobs: () => request('/jobs'),

  base: getBase,
  defaultBase,
};
