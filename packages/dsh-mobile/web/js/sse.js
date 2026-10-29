/* DSH Mobile — SSE over fetch(ReadableStream).
 * EventSource can not send an Authorization header, so the stream is a plain
 * fetch. Contract §4.3: hello / delta / live / state / ping / resync, cursor
 * resume, server keepalive every 15 s.
 *
 * Reconnect policy: exponential backoff with jitter, immediate resume when the
 * app becomes visible or the network returns, suspension when hidden (the
 * contract explicitly asks for closing SSE in the background).
 */
import { getBase, getToken } from './api.js';

export const sseStats = {
  connects: 0,
  events: 0,
  bytes: 0,
  lastEventAt: 0,
  lastStatus: 'idle',
};

let streamFactory = null;

export function setStreamFactory(factory) {
  streamFactory = factory;
}

export function createStream(options) {
  if (streamFactory) return streamFactory(options);
  return new LiveStream(options);
}

export function streamSupported() {
  return typeof fetch === 'function' && typeof ReadableStream !== 'undefined' && typeof TextDecoder !== 'undefined';
}

function noop() {}

export class LiveStream {
  constructor({ sessionId, getCursor, onCursor, onEvent, onStatus }) {
    this.sessionId = sessionId;
    this._getCursor = getCursor || (() => '0');
    this._onCursor = onCursor || noop;
    this._onEvent = onEvent || noop;
    this._onStatus = onStatus || noop;
    this._cursor = String(this._getCursor() || '0');
    this._status = 'idle';
    this._stopped = false;
    this._started = false;
    this._suspended = false;
    this._controller = null;
    this._abortReason = '';
    this._wake = null;
    this._decoder = new TextDecoder();
    this._buffer = '';
    this._lastDataAt = 0;
    this._watchdog = 0;
    this._attempt = 0;
    this._handlers = {
      online: () => this._resume(),
      offline: () => this._suspend(),
      visibility: () => (document.hidden ? this._suspend() : this._resume()),
    };
  }

  get status() {
    return this._status;
  }

  start() {
    if (this._started || this._stopped) return;
    this._started = true;
    if (!streamSupported()) {
      this._setStatus('error', 'unsupported');
      return;
    }
    window.addEventListener('online', this._handlers.online);
    window.addEventListener('offline', this._handlers.offline);
    document.addEventListener('visibilitychange', this._handlers.visibility);
    this._loop();
  }

  stop() {
    if (this._stopped) return;
    this._stopped = true;
    this._abort('stop');
    this._wakeUp();
    window.removeEventListener('online', this._handlers.online);
    window.removeEventListener('offline', this._handlers.offline);
    document.removeEventListener('visibilitychange', this._handlers.visibility);
    clearInterval(this._watchdog);
    this._setStatus('closed');
  }

  /* ── loop ────────────────────────────────────────────────────────── */

  async _loop() {
    while (!this._stopped) {
      if (this._suspended || document.hidden || !navigator.onLine) {
        this._setStatus('suspended', navigator.onLine ? 'hidden' : 'offline');
        await this._wait(5000);
        continue;
      }
      this._attempt += 1;
      this._setStatus(this._attempt === 1 ? 'connecting' : 'reconnecting');
      try {
        await this._connect();
        this._attempt = 0;
      } catch (error) {
        if (this._stopped) break;
        if (error && error.auth) {
          this._setStatus('error', 'auth');
          window.dispatchEvent(new CustomEvent('dshm-auth-error'));
          break;
        }
        if (error && error.abortedBy === 'stop') break;
        if (error && error.abortedBy) {
          // Suspend/resume or watchdog: loop again immediately.
          continue;
        }
        this._setStatus('error', 'network');
      }
      if (this._stopped) break;
      await this._wait(this._backoff(this._attempt));
    }
    if (!this._stopped) this._setStatus('closed');
  }

  _backoff(attempt) {
    const base = Math.min(15000, 700 * 2 ** Math.max(0, attempt - 1));
    return base * (0.7 + Math.random() * 0.6);
  }

  /* ── one connection ──────────────────────────────────────────────── */

  async _connect() {
    const controller = new AbortController();
    this._controller = controller;
    this._abortReason = '';
    this._lastDataAt = Date.now();

    const url = `${getBase().replace(/\/+$/, '')}/sessions/${encodeURIComponent(
      this.sessionId
    )}/stream?cursor=${encodeURIComponent(this._cursor)}`;
    const headers = { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    this._watchdog = setInterval(() => {
      if (Date.now() - this._lastDataAt > 70000) {
        this._abortReason = 'watchdog';
        controller.abort();
      }
    }, 10000);

    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
      });
      if (response.status === 401) {
        const error = new Error('unauthorized');
        error.auth = true;
        throw error;
      }
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      if (!response.body) throw new Error('no response body');

      sseStats.connects += 1;
      this._setStatus('open');
      this._attempt = 0;
      this._decoder = new TextDecoder();
      this._buffer = '';

      const reader = response.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        sseStats.bytes += value.byteLength || value.length || 0;
        this._buffer += this._decoder.decode(value, { stream: true });
        const frames = this._buffer.split(/\r?\n\r?\n/);
        this._buffer = frames.pop() || '';
        for (const frame of frames) this._handleFrame(frame);
      }
      if (this._buffer.trim()) this._handleFrame(this._buffer);
      this._buffer = '';
    } catch (error) {
      if (error && (error.name === 'AbortError' || error.code === 'ABORT_ERR')) {
        const aborted = new Error('aborted');
        aborted.abortedBy = this._abortReason || 'suspend';
        throw aborted;
      }
      throw error;
    } finally {
      clearInterval(this._watchdog);
      this._watchdog = 0;
      if (this._controller === controller) this._controller = null;
    }
  }

  /* ── frame parsing ───────────────────────────────────────────────── */

  _handleFrame(frame) {
    if (!frame || !frame.trim() || frame.startsWith(':')) return;
    let event = 'message';
    let id = null;
    const dataLines = [];
    for (const line of frame.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') dataLines.push(value);
      else if (field === 'id') id = value;
    }
    if (!dataLines.length) return;

    const raw = dataLines.join('\n');
    let data = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw;
      }
    }

    sseStats.events += 1;
    sseStats.lastEventAt = Date.now();
    this._lastDataAt = Date.now();

    if (event === 'hello' && data && data.cursor != null) {
      this._cursor = String(data.cursor);
      this._onCursor(this._cursor);
    } else if (event === 'delta' && data && Array.isArray(data.events)) {
      let max = null;
      for (const item of data.events) {
        if (item && item.seq != null) {
          const seq = Number(item.seq);
          if (Number.isFinite(seq) && (max == null || seq > max)) max = seq;
        }
      }
      if (max != null) {
        this._cursor = String(max);
        this._onCursor(this._cursor);
      }
    }

    this._onEvent({ event, data, id });
  }

  /* ── suspend / resume ────────────────────────────────────────────── */

  _suspend() {
    if (this._stopped || !this._started) return;
    this._suspended = true;
    this._abort('suspend');
    this._setStatus('suspended', 'hidden');
  }

  _resume() {
    if (this._stopped || !this._started) return;
    if (!navigator.onLine) return;
    this._suspended = false;
    this._abort('resume');
    this._wakeUp();
  }

  _abort(reason) {
    this._abortReason = reason;
    if (this._controller) {
      try {
        this._controller.abort();
      } catch {
        /* ignore */
      }
      this._controller = null;
    }
  }

  _wait(ms) {
    return new Promise((resolve) => {
      if (this._stopped) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        this._wake = null;
        resolve();
      }, ms);
      this._wake = () => {
        clearTimeout(timer);
        this._wake = null;
        resolve();
      };
    });
  }

  _wakeUp() {
    if (this._wake) this._wake();
  }

  _setStatus(state, detail = '') {
    if (this._status === state && !detail) return;
    this._status = state;
    sseStats.lastStatus = state;
    this._onStatus(state, detail);
  }
}
