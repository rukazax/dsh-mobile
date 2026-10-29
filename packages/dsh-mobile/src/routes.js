/**
 * Mobile REST + SSE routes.
 *
 * The routes are transport-only: they validate input, enforce auth, shape the
 * JSON envelopes from `docs/mobile-api.md`, and delegate every DSH interaction
 * to a {@link SessionBridge}. That split keeps the HTTP layer testable with a
 * fake bridge and keeps host-specific knowledge in `session-bridge.js`.
 *
 * @module dsh-mobile/src/routes
 */

import { ApiError, bearerToken, clientIp, readJson, requestUrl, sendError, sendJson } from './http.js';
import { openEventStream } from './sse.js';
import { clampInt, nowIso, truncate } from './util.js';

/** Idempotency records live this long. */
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
/** Maximum cached idempotent responses. */
const IDEMPOTENCY_MAX = 200;

/**
 * @typedef {import('./config.js').MobileConfig} MobileConfig
 * @typedef {import('./auth.js').AuthManager} AuthManager
 * @typedef {import('./sse.js').StreamHub} StreamHub
 *
 * @typedef {object} SessionSummary
 * @property {string} id
 * @property {string} title
 * @property {string} workspaceId
 * @property {string} workspaceName
 * @property {string} cwd
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {'idle'|'running'|'blocked'|'queued'} status
 * @property {string} model
 * @property {string | null} parentSessionId
 * @property {string} lastText
 * @property {string} lastRole
 * @property {number} eventCount
 * @property {string} cursor
 * @property {boolean} hasPendingApproval
 * @property {boolean} hasPendingQuestion
 * @property {string} formatStatus
 *
 * @typedef {object} SessionBridge
 * @property {() => Promise<SessionSummary[]>} listSessions
 * @property {(id: string, options: { turns: number, before?: string, maxEvents: number }) => Promise<{ session: SessionSummary | null, events: unknown[], cursor: string, hasOlder: boolean, running: boolean, queue: unknown[], pendingApproval: unknown, pendingQuestion: unknown }>} openSession
 * @property {(id: string, options: { before: string, turns: number, maxEvents: number }) => Promise<{ events: unknown[], hasOlder: boolean }>} olderEvents
 * @property {(id: string, cursor: string, onEvent: (event: unknown) => void) => Promise<() => void>} followSession
 * @property {(id: string, request: { text: string, mode: 'transcript'|'queue'|'steer', requestId: string }) => Promise<{ seq: string, requestId: string }>} prompt
 * @property {(id: string, scope: 'turn'|'queue'|'all') => Promise<void>} cancel
 * @property {(id: string, request: { approvalId: string, decision: 'allow'|'deny', remember?: boolean }) => Promise<void>} answerApproval
 * @property {(id: string, request: { questionId: string, answer: string }) => Promise<void>} answerQuestion
 * @property {() => Promise<unknown[]>} listWorkspaces
 * @property {() => Promise<unknown[]>} listJobs
 * @property {(id: string) => Promise<void>} killJob
 * @property {() => Promise<void>} dispose
 */

/**
 * @param {unknown} value
 * @param {number} max
 * @param {string} field
 * @returns {string}
 */
function requireString(value, max, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(400, 'invalid-argument', `${field} must be a non-empty string`);
  }
  if (value.length > max) throw new ApiError(400, 'invalid-argument', `${field} exceeds ${max} characters`);
  return value;
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function optionalString(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ApiError(400, 'invalid-argument', 'expected a string');
  return value;
}

/**
 * @param {unknown} value
 * @returns {'transcript'|'queue'|'steer'}
 */
function parseMode(value) {
  if (value === undefined || value === null) return 'transcript';
  if (value === 'transcript' || value === 'queue' || value === 'steer') return value;
  throw new ApiError(400, 'invalid-argument', 'mode must be transcript, queue or steer');
}

/** @param {unknown} value */
function requireObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'invalid-argument', 'expected an object');
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {import('node:http').ServerResponse} res
 */
function noContent(res) {
  res.writeHead(204, { 'Cache-Control': 'no-store' });
  res.end();
}

export class ApiRouter {
  /**
   * @param {object} options
   * @param {MobileConfig} options.config
   * @param {AuthManager} options.auth
   * @param {StreamHub} options.hub
   * @param {SessionBridge} options.bridge
   * @param {{ info: (msg: string) => void, warn: (msg: string) => void, debug: (msg: string) => void }} options.logger
   * @param {string} options.appVersion
   * @param {string} options.hostName
   */
  constructor({ config, auth, hub, bridge, logger, appVersion, hostName }) {
    this.config = config;
    this.auth = auth;
    this.hub = hub;
    this.bridge = bridge;
    this.logger = logger;
    this.appVersion = appVersion;
    this.hostName = hostName;
    /** @type {Map<string, { at: number, status: number, body: unknown }>} */
    this.idempotency = new Map();
  }

  /** @returns {number} ms until the next idempotency sweep */
  sweepIdempotency() {
    const now = Date.now();
    for (const [key, record] of this.idempotency) {
      if (now - record.at > IDEMPOTENCY_TTL_MS) this.idempotency.delete(key);
    }
    while (this.idempotency.size > IDEMPOTENCY_MAX) {
      const first = this.idempotency.keys().next().value;
      if (first === undefined) break;
      this.idempotency.delete(first);
    }
    return IDEMPOTENCY_TTL_MS;
  }

  /**
   * Remember or replay a mutation by `requestId`.
   * @param {string | undefined} requestId
   * @param {string} operation
   * @param {() => Promise<unknown>} run
   * @returns {Promise<unknown>}
   */
  async idempotent(requestId, operation, run) {
    if (requestId === undefined) return run();
    const key = `${operation}:${requestId}`;
    const record = this.idempotency.get(key);
    if (record !== undefined) {
      this.logger.debug(`dsh-mobile: replay ${key}`);
      return { .../** @type {Record<string, unknown>} */ (record.body), deduplicated: true };
    }
    const body = await run();
    this.idempotency.set(key, { at: Date.now(), status: 200, body });
    this.sweepIdempotency();
    return body;
  }

  /**
   * Handle one `/api/v1/*` request.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} pathname path below `/api/v1`
   * @param {string} search
   */
  async handle(req, res, pathname, search) {
    const url = new URL(`${pathname}${search}`, 'http://gateway.local');
    const method = req.method ?? 'GET';

    try {
      if (method === 'OPTIONS') {
        noContent(res);
        return;
      }

      // Public but unauthenticated: pair, hello, health.
      if (pathname === '/pair' && method === 'POST') return await this.handlePair(req, res);
      if (pathname === '/hello' && method === 'GET') return this.handleHello(req, res);
      if (pathname === '/health' && method === 'GET') {
        return sendJson(req, res, 200, { ok: true, at: nowIso(), streams: this.hub.size() });
      }

      const token = bearerToken(req);
      const verified = await this.auth.verify(token);
      if (!verified.ok) throw new ApiError(401, 'auth-required', 'a paired device token is required');
      const device = verified.device;

      if (pathname === '/devices/revoke' && method === 'POST') {
        await this.auth.revoke(device.id);
        return sendJson(req, res, 200, { ok: true });
      }

      if (pathname === '/sessions' && method === 'GET') return await this.handleSessionList(req, res, url);
      if (pathname === '/sessions' && method === 'POST') return await this.handleSessionCreate(req, res);

      const sessionMatch = /^\/sessions\/([^/]+)(?:\/([^/]+))?$/.exec(pathname);
      if (sessionMatch !== null) {
        const sessionId = decodeURIComponent(sessionMatch[1] ?? '');
        const action = sessionMatch[2];
        if (action === undefined && method === 'GET') return await this.handleSessionOpen(req, res, sessionId, url);
        if (action === 'older' && method === 'GET') return await this.handleOlder(req, res, sessionId, url);
        if (action === 'stream' && method === 'GET') return await this.handleStream(req, res, sessionId, url, device.id);
        if (action === 'prompt' && method === 'POST') return await this.handlePrompt(req, res, sessionId);
        if (action === 'cancel' && method === 'POST') return await this.handleCancel(req, res, sessionId);
        if (action === 'approval' && method === 'POST') return await this.handleApproval(req, res, sessionId);
        if (action === 'question' && method === 'POST') return await this.handleQuestion(req, res, sessionId);
        if (action === 'read' && method === 'POST') return sendJson(req, res, 200, { ok: true });
      }

      if (pathname === '/workspaces' && method === 'GET') {
        const workspaces = await this.bridge.listWorkspaces();
        return sendJson(req, res, 200, { workspaces });
      }
      if (pathname === '/jobs' && method === 'GET') {
        const jobs = await this.bridge.listJobs();
        return sendJson(req, res, 200, { jobs });
      }
      const jobMatch = /^\/jobs\/([^/]+)\/kill$/.exec(pathname);
      if (jobMatch !== null && method === 'POST') {
        await this.bridge.killJob(decodeURIComponent(jobMatch[1] ?? ''));
        return sendJson(req, res, 200, { ok: true });
      }

      throw new ApiError(404, 'not-found', `unknown endpoint ${method} ${pathname}`);
    } catch (error) {
      if (error instanceof ApiError) {
        sendError(req, res, error);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const code = /** @type {{ code?: string }} */ (error).code ?? 'internal';
      this.logger.warn(`dsh-mobile: ${req.method} ${pathname} failed: ${message}`);
      // Session-level domain failures reach the phone as protocol codes.
      if (code === 'session/not-found' || code === 'session-not-found') {
        sendError(req, res, new ApiError(404, 'session-not-found', message));
        return;
      }
      if (code === 'session/agent-busy' || code === 'agent-busy') {
        sendError(req, res, new ApiError(409, 'agent-busy', message));
        return;
      }
      if (code === 'approval-unknown') {
        sendError(req, res, new ApiError(404, 'approval-unknown', message));
        return;
      }
      if (code === 'approval-desktop-only') {
        sendError(req, res, new ApiError(409, 'approval-desktop-only', message));
        return;
      }
      if (code === 'unsupported' || /^unsupported:/.test(message)) {
        sendError(req, res, new ApiError(501, 'unsupported', message));
        return;
      }
      sendError(req, res, new ApiError(500, 'internal', message));
    }
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  handleHello(req, res) {
    sendJson(req, res, 200, {
      protocol: 1,
      appVersion: this.appVersion,
      hostName: this.hostName,
      requiresPairing: true,
      capabilities: { approvals: true, questions: true, attachments: false, jobs: true, workspaces: true, liveStream: true },
      limits: { maxPromptChars: this.config.maxPromptChars, maxDevices: this.config.maxDevices },
    });
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async handlePair(req, res) {
    const ip = clientIp(req);
    if (this.auth.isRateLimited(ip)) {
      sendError(req, res, new ApiError(429, 'rate-limited', 'too many pairing attempts, try again later'));
      return;
    }
    const body = await readJson(req, this.config.apiBodyLimitBytes);
    const code = requireString(body.code, 32, 'code');
    const label = optionalString(body.deviceName);
    const platform = optionalString(body.devicePlatform) ?? 'unknown';
    const result = await this.auth.pair({ code, label, platform });
    if (!result.ok) {
      this.auth.recordFailure(ip);
      const message =
        result.reason === 'expired'
          ? 'pairing code expired — show a fresh code on the PC'
          : result.reason === 'too-many-attempts'
            ? 'too many wrong attempts — show a fresh code on the PC'
            : 'pairing code is not valid';
      sendError(req, res, new ApiError(403, result.reason === 'invalid' ? 'pairing-invalid' : 'pairing-expired', message));
      return;
    }
    this.logger.info(`dsh-mobile: paired device ${result.device.label} from ${ip}`);
    sendJson(req, res, 200, {
      deviceToken: result.token,
      deviceId: result.device.id,
      host: { name: this.hostName, appVersion: this.appVersion, protocol: 1 },
    });
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {URL} url
   */
  async handleSessionList(req, res, url) {
    const limit = clampInt(url.searchParams.get('limit'), 1, 100, 50);
    const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const includeArchived = url.searchParams.get('archived') === '1';
    const sessions = await this.bridge.listSessions();
    const filtered = sessions.filter((session) => {
      if (!includeArchived && session.status === 'archived') return false;
      if (query === '') return true;
      return `${session.title} ${session.workspaceName} ${session.cwd} ${session.lastText}`.toLowerCase().includes(query);
    });
    filtered.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    sendJson(req, res, 200, {
      sessions: filtered.slice(0, limit),
      nextCursor: filtered.length > limit ? String(limit) : null,
      removed: [],
      serverTime: nowIso(),
    });
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async handleSessionCreate(req, res) {
    const body = await readJson(req, this.config.apiBodyLimitBytes);
    const requestId = requireString(body.requestId, 80, 'requestId');
    const workspaceId = optionalString(body.workspaceId);
    const session = await this.idempotent(requestId, 'session-create', () =>
      this.bridge.createSession({ workspaceId: workspaceId ?? null, requestId }),
    );
    sendJson(req, res, 200, { session });
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} sessionId
   * @param {URL} url
   */
  async handleSessionOpen(req, res, sessionId, url) {
    const turns = clampInt(url.searchParams.get('turns'), 1, 10, this.config.sessionWindowTurns);
    const before = url.searchParams.get('before') ?? undefined;
    const snapshot = await this.bridge.openSession(sessionId, {
      turns,
      before,
      maxEvents: this.config.sessionWindowEvents,
    });
    if (snapshot.session === null) throw new ApiError(404, 'session-not-found', `session ${sessionId} not found`);
    sendJson(req, res, 200, snapshot);
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} sessionId
   * @param {URL} url
   */
  async handleOlder(req, res, sessionId, url) {
    const before = url.searchParams.get('before');
    if (before === null) throw new ApiError(400, 'invalid-argument', 'before is required');
    const turns = clampInt(url.searchParams.get('turns'), 1, 10, 2);
    const page = await this.bridge.olderEvents(sessionId, {
      before,
      turns,
      maxEvents: this.config.sessionWindowEvents,
    });
    sendJson(req, res, 200, page);
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} sessionId
   * @param {URL} url
   * @param {string} deviceId
   */
  async handleStream(req, res, sessionId, url, deviceId) {
    const cursorRaw = url.searchParams.get('cursor') ?? req.headers['last-event-id'] ?? '-1';
    const cursor = clampInt(cursorRaw, -1, Number.MAX_SAFE_INTEGER, -1);
    // Verify the session exists before committing the stream headers. This must
    // not read the log: a cached listing row is enough.
    let running = false;
    if (typeof this.bridge.describeSession === 'function') {
      const summary = await this.bridge.describeSession(sessionId);
      if (summary === null) throw new ApiError(404, 'session-not-found', `session ${sessionId} not found`);
      running = summary.status === 'running';
    } else {
      const info = await this.bridge.openSession(sessionId, { turns: 1, maxEvents: 1 });
      if (info.session === null) throw new ApiError(404, 'session-not-found', `session ${sessionId} not found`);
      running = info.running === true;
    }

    openEventStream(req, res);
    const client = this.hub.attach({ res, sessionId, deviceId, cursor });
    client.write('hello', { sessionId, cursor, running, serverTime: nowIso() });

    let disposed = false;
    /** @type {(() => void) | undefined} */
    let unsubscribe;
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      try {
        unsubscribe?.();
      } catch {
        /* ignore */
      }
    };
    res.on('close', cleanup);
    req.on('close', cleanup);

    /**
     * @param {string} kind
     * @param {any} payload
     */
    const emit = (kind, payload) => {
      if (disposed) return;
      switch (kind) {
        case 'delta': {
          const events = Array.isArray(payload?.events) ? payload.events : [];
          const last = events.at(-1);
          if (typeof last?.seq === 'number') client.cursor = last.seq;
          client.write('delta', { from: String(client.cursor), events }, last?.seq);
          break;
        }
        case 'live':
          client.write('live', payload);
          break;
        case 'state':
          client.write('state', payload);
          break;
        case 'approval':
          client.write('approval', payload);
          break;
        case 'resync':
          client.write('resync', payload ?? { reason: 'gap' });
          break;
        default:
          break;
      }
    };

    try {
      unsubscribe = await this.bridge.followSession(sessionId, String(cursor), emit);
    } catch (error) {
      if (!disposed) {
        const message = error instanceof Error ? error.message : String(error);
        client.write('resync', { reason: `follow-failed: ${message}` });
        cleanup();
      }
    }
    if (disposed) unsubscribe?.();
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} sessionId
   */
  async handlePrompt(req, res, sessionId) {
    const body = await readJson(req, this.config.apiBodyLimitBytes);
    const requestId = requireString(body.requestId, 80, 'requestId');
    if (typeof body.text !== 'string' || body.text.length === 0) {
      throw new ApiError(400, 'invalid-argument', 'text must be a non-empty string');
    }
    if (body.text.length > this.config.maxPromptChars) {
      throw new ApiError(400, 'invalid-argument', `text exceeds ${this.config.maxPromptChars} characters`);
    }
    const text = body.text;
    const mode = parseMode(body.mode);
    if (!/[^\s]/.test(text)) throw new ApiError(400, 'prompt-invalid', 'prompt must contain non-whitespace characters');
    const result = await this.idempotent(requestId, `prompt:${sessionId}`, () =>
      this.bridge.prompt(sessionId, { text, mode, requestId }),
    );
    sendJson(req, res, 200, { accepted: true, .../** @type {object} */ (result) });
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} sessionId
   */
  async handleCancel(req, res, sessionId) {
    const body = await readJson(req, this.config.apiBodyLimitBytes);
    const scope = body.scope === undefined ? 'turn' : String(body.scope);
    if (scope !== 'turn' && scope !== 'queue' && scope !== 'all') {
      throw new ApiError(400, 'invalid-argument', 'scope must be turn, queue or all');
    }
    await this.bridge.cancel(sessionId, scope);
    sendJson(req, res, 200, { ok: true });
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} sessionId
   */
  async handleApproval(req, res, sessionId) {
    const body = await readJson(req, this.config.apiBodyLimitBytes);
    const approvalId = requireString(body.approvalId, 120, 'approvalId');
    const decision = body.decision;
    if (decision !== 'allow' && decision !== 'deny') {
      throw new ApiError(400, 'invalid-argument', 'decision must be allow or deny');
    }
    await this.bridge.answerApproval(sessionId, {
      approvalId,
      decision,
      remember: body.remember === true,
    });
    sendJson(req, res, 200, { ok: true });
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} sessionId
   */
  async handleQuestion(req, res, sessionId) {
    const body = await readJson(req, this.config.apiBodyLimitBytes);
    const questionId = requireString(body.questionId, 120, 'questionId');
    const answer = requireString(body.answer, 4000, 'answer');
    await this.bridge.answerQuestion(sessionId, { questionId, answer });
    sendJson(req, res, 200, { ok: true });
  }
}

/**
 * A bridge that answers every call with a protocol error. Used when the host
 * composition does not expose the services the gateway needs, so the phone sees
 * a clear message instead of a broken UI.
 * @returns {SessionBridge}
 */
export function createUnavailableBridge() {
  /** @param {string} operation */
  const unavailable = (operation) => async () => {
    throw new ApiError(503, 'unsupported', `${operation} is unavailable in this DSH composition`);
  };
  return {
    listSessions: unavailable('session listing'),
    openSession: unavailable('session opening'),
    olderEvents: unavailable('history paging'),
    followSession: unavailable('live streaming'),
    prompt: unavailable('prompting'),
    cancel: unavailable('cancelling'),
    answerApproval: unavailable('approval'),
    answerQuestion: unavailable('questions'),
    createSession: unavailable('session creation'),
    listWorkspaces: unavailable('workspaces'),
    listJobs: unavailable('jobs'),
    killJob: unavailable('job control'),
    dispose: async () => {},
  };
}

export { noContent, requireString, requireObject, truncate };
