/**
 * SSE hub for live session streams.
 *
 * One stream per (device, session). The hub owns framing, heartbeats, back
 * pressure and reconnection bookkeeping; the session bridge owns payload
 * production. Clients resume with the last durable `seq` they applied, so a
 * reconnect replays only missing events (`event: delta`) and never re-sends a
 * transcript.
 *
 * @module dsh-mobile/src/sse
 */

import { ApiError } from './http.js';
import { errorInfo } from './util.js';

/** Per-client write buffer cap; a slow phone must not grow host memory. */
const MAX_BUFFERED_BYTES = 256 * 1024;

/**
 * @typedef {object} StreamEvent
 * @property {string} event SSE event name
 * @property {unknown} data JSON payload
 */

/**
 * A single connected phone.
 */
class StreamClient {
  /**
   * @param {import('node:http').ServerResponse} res
   * @param {string} sessionId
   * @param {string} deviceId
   * @param {number} cursor
   */
  constructor(res, sessionId, deviceId, cursor) {
    this.res = res;
    this.sessionId = sessionId;
    this.deviceId = deviceId;
    this.cursor = cursor;
    this.closed = false;
    this.lastWriteAt = Date.now();
  }

  /**
   * @param {string} event
   * @param {unknown} data
   * @param {number} [id]
   */
  write(event, data, id) {
    if (this.closed || this.res.writableEnded) return;
    if (this.res.writableLength > MAX_BUFFERED_BYTES) {
      // The phone stopped reading: drop it and let the client reconnect with
      // its cursor instead of buffering an unbounded transcript.
      this.close('slow-consumer');
      return;
    }
    let chunk = '';
    if (id !== undefined) chunk += `id: ${id}\n`;
    chunk += `event: ${event}\n`;
    chunk += `data: ${JSON.stringify(data)}\n\n`;
    try {
      this.res.write(chunk);
      this.lastWriteAt = Date.now();
    } catch (error) {
      this.close(`write-failed: ${errorInfo(error).message}`);
    }
  }

  /**
   * @param {string} [reason]
   */
  close(reason) {
    if (this.closed) return;
    this.closed = true;
    this.res.end();
    this.res.emit('dsh-mobile:closed', reason);
  }
}

export class StreamHub {
  /**
   * @param {object} options
   * @param {{ info: (msg: string) => void, warn: (msg: string) => void }} [options.logger]
   * @param {number} [options.heartbeatMs]
   */
  constructor({ logger, heartbeatMs = 15_000 } = {}) {
    this.logger = logger ?? { info() {}, warn() {} };
    this.heartbeatMs = heartbeatMs;
    /** @type {Map<string, Set<StreamClient>>} */
    this.bySession = new Map();
    /** @type {NodeJS.Timeout | undefined} */
    this.timer = undefined;
    this.stats = { opened: 0, closed: 0, bytes: 0 };
  }

  start() {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => this.heartbeat(), this.heartbeatMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop() {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    for (const clients of this.bySession.values()) {
      for (const client of clients) client.close('server-shutdown');
    }
    this.bySession.clear();
  }

  heartbeat() {
    const at = Date.now();
    for (const clients of this.bySession.values()) {
      for (const client of clients) {
        if (at - client.lastWriteAt >= this.heartbeatMs) client.write('ping', { t: Math.floor(at / 1000) });
      }
    }
  }

  /**
   * Attach a new SSE response. The caller has already written headers.
   *
   * @param {object} request
   * @param {import('node:http').ServerResponse} request.res
   * @param {string} request.sessionId
   * @param {string} request.deviceId
   * @param {number} request.cursor last durable seq the client applied
   * @returns {StreamClient}
   */
  attach({ res, sessionId, deviceId, cursor }) {
    const client = new StreamClient(res, sessionId, deviceId, cursor);
    const existing = this.bySession.get(sessionId) ?? new Set();
    // A second stream for the same device supersedes the first one: a phone
    // that lost connectivity without a clean close must not keep a zombie.
    for (const other of existing) {
      if (other.deviceId === deviceId) other.close('superseded');
    }
    existing.add(client);
    this.bySession.set(sessionId, existing);
    this.stats.opened += 1;
    res.on('close', () => {
      existing.delete(client);
      if (existing.size === 0) this.bySession.delete(sessionId);
      this.stats.closed += 1;
    });
    return client;
  }

  /**
   * @param {string} sessionId
   * @param {string} event
   * @param {unknown} data
   * @param {number} [id]
   */
  broadcast(sessionId, event, data, id) {
    const clients = this.bySession.get(sessionId);
    if (clients === undefined || clients.size === 0) return;
    for (const client of clients) client.write(event, data, id);
  }

  /**
   * Whether any phone is currently watching a session.
   * @param {string} sessionId
   * @returns {boolean}
   */
  hasSubscribers(sessionId) {
    const clients = this.bySession.get(sessionId);
    return clients !== undefined && clients.size > 0;
  }

  /** @returns {number} number of open streams */
  size() {
    let total = 0;
    for (const clients of this.bySession.values()) total += clients.size;
    return total;
  }
}

/**
 * Open an SSE response.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export function openEventStream(req, res) {
  if (typeof res.setHeader !== 'function') throw new ApiError(500, 'internal', 'not an HTTP response');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  });
  res.flushHeaders?.();
  req.socket?.setNoDelay?.(true);
}

export { StreamClient, MAX_BUFFERED_BYTES };
