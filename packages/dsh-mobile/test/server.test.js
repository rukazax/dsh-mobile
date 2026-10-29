import assert from 'node:assert/strict';
import { } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AuthManager } from '../src/auth.js';
import { normalizeConfig } from '../src/config.js';
import { fileURLToPath } from 'node:url';
import { ApiRouter } from '../src/routes.js';
import { GatewayServer } from '../src/server.js';
import { StreamHub } from '../src/sse.js';
import { DeviceStore } from '../src/store.js';
import { makeTmp, removeTmp } from './helpers/tmp.js';

const WEB_ROOT = fileURLToPath(new URL('../web/', import.meta.url));

/**
 * @typedef {{ status: number, headers: import('node:http').IncomingHttpHeaders, body: string, json: () => any }} ResponseLike
 */

/**
 * @param {number} port
 * @param {string} method
 * @param {string} path
 * @param {{ token?: string, body?: unknown, headers?: Record<string, string> }} [options]
 * @returns {Promise<ResponseLike>}
 */
function call(port, method, path, options = {}) {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
          ...(options.token === undefined ? {} : { Authorization: `Bearer ${options.token}` }),
          ...(options.headers ?? {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            json: () => JSON.parse(body),
          });
        });
      },
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/**
 * @returns {any} a deterministic fake bridge
 */
function createFakeBridge() {
  const sinks = new Set();
  const summaries = [
    {
      id: 'session-a',
      title: 'Foldable layout review',
      workspaceId: '',
      workspaceName: 'harness',
      cwd: 'C:\\work\\harness',
      createdAt: '2026-10-23T09:00:00.000Z',
      updatedAt: '2026-10-23T12:00:00.000Z',
      status: 'running',
      model: 'deepseek-flash',
      parentSessionId: null,
      lastText: '',
      lastRole: '',
      eventCount: null,
      cursor: null,
      hasPendingApproval: false,
      hasPendingQuestion: false,
      formatStatus: 'ok',
    },
    {
      id: 'session-b',
      title: 'Old session',
      workspaceId: '',
      workspaceName: 'other',
      cwd: 'C:\\work\\other',
      createdAt: '2026-10-22T09:00:00.000Z',
      updatedAt: '2026-10-22T12:00:00.000Z',
      status: 'idle',
      model: 'deepseek-flash',
      parentSessionId: null,
      lastText: '',
      lastRole: '',
      eventCount: null,
      cursor: null,
      hasPendingApproval: false,
      hasPendingQuestion: false,
      formatStatus: 'ok',
    },
  ];
  const events = [
    { seq: 0, t: '2026-10-23T09:00:00.000Z', k: 'user/message', d: { text: 'Привет' } },
    { seq: 1, t: '2026-10-23T09:00:01.000Z', k: 'assistant/message', d: { text: 'Здравствуйте!' } },
  ];
  return {
    sinks,
    async listSessions() {
      return summaries;
    },
    async openSession(id) {
      const session = summaries.find((entry) => entry.id === id);
      if (session === undefined) return { session: null };
      return {
        session,
        events,
        cursor: '1',
        hasOlder: false,
        running: session.status === 'running',
        queue: [],
        pendingApproval: null,
        pendingQuestion: null,
      };
    },
    async olderEvents() {
      return { events: [], hasOlder: false };
    },
    async followSession(id, cursor, sink) {
      sinks.add(sink);
      return () => sinks.delete(sink);
    },
    async prompt(id, request) {
      return { requestId: request.requestId, seq: '2' };
    },
    async cancel() {},
    async createSession() {
      return summaries[0];
    },
    async answerApproval() {
      throw Object.assign(new Error('approval-unknown'), { code: 'approval-unknown' });
    },
    async answerQuestion() {
      throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
    },
    async listWorkspaces() {
      return [];
    },
    async listJobs() {
      return [];
    },
    async killJob() {},
    async dispose() {},
    emit(kind, payload) {
      for (const sink of sinks) sink(kind, payload);
    },
  };
}

async function setup() {
  const dir = await makeTmp('gateway');
  const config = normalizeConfig({
    dataDir: dir,
    listenHost: '127.0.0.1',
    listenPort: 0,
    approvals: 'observe',
    debug: false,
  });
  const store = new DeviceStore({ dataDir: dir });
  await store.load();
  const auth = new AuthManager(store, config);
  const hub = new StreamHub({ heartbeatMs: 60_000 });
  hub.start();
  const bridge = createFakeBridge();
  const logger = { info() {}, warn() {}, debug() {} };
  const router = new ApiRouter({ config, auth, hub, bridge, logger, appVersion: '0.0.0-test', hostName: 'test-host' });
  const gateway = new GatewayServer({ config, router, webRoot: WEB_ROOT, logger });
  await gateway.listen();
  const port = gateway.address.port;
  const pairing = await auth.pairingInfo();
  return {
    port,
    gateway,
    hub,
    bridge,
    auth,
    config,
    pairing,
    async cleanup() {
      hub.stop();
      await gateway.close();
      await removeTmp(dir);
    },
  };
}

test('gateway: pairing, auth and session listing', async () => {
  const ctx = await setup();
  try {
    const hello = await call(ctx.port, 'GET', '/api/v1/hello');
    assert.equal(hello.status, 200);
    assert.equal(hello.json().protocol, 1);

    const unauth = await call(ctx.port, 'GET', '/api/v1/sessions');
    assert.equal(unauth.status, 401);
    assert.equal(unauth.json().error.code, 'auth-required');

    const wrong = await call(ctx.port, 'POST', '/api/v1/pair', { body: { code: 'ZZZZZZZZ', deviceName: 'x' } });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.json().error.code, 'pairing-invalid');

    const paired = await call(ctx.port, 'POST', '/api/v1/pair', {
      body: { code: ctx.pairing.code, deviceName: 'Honor Magic V3', devicePlatform: 'android' },
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14)' },
    });
    assert.equal(paired.status, 200);
    const { deviceToken } = paired.json();
    assert.ok(deviceToken);

    const list = await call(ctx.port, 'GET', '/api/v1/sessions', { token: deviceToken });
    assert.equal(list.status, 200);
    assert.equal(list.json().sessions.length, 2);
    assert.equal(list.json().sessions[0].title, 'Foldable layout review');

    const search = await call(ctx.port, 'GET', '/api/v1/sessions?q=other', { token: deviceToken });
    assert.equal(search.json().sessions.length, 1);

    const revoke = await call(ctx.port, 'POST', '/api/v1/devices/revoke', { token: deviceToken, body: {} });
    assert.equal(revoke.status, 200);
    const afterRevoke = await call(ctx.port, 'GET', '/api/v1/sessions', { token: deviceToken });
    assert.equal(afterRevoke.status, 401);
  } finally {
    await ctx.cleanup();
  }
});

test('gateway: session snapshot, prompt idempotency and validation', async () => {
  const ctx = await setup();
  try {
    const paired = await call(ctx.port, 'POST', '/api/v1/pair', { body: { code: ctx.pairing.code } });
    const token = paired.json().deviceToken;

    const open = await call(ctx.port, 'GET', '/api/v1/sessions/session-a?turns=2', { token });
    assert.equal(open.status, 200);
    const snapshot = open.json();
    assert.equal(snapshot.session.id, 'session-a');
    assert.equal(snapshot.events.length, 2);
    assert.equal(snapshot.cursor, '1');

    const missing = await call(ctx.port, 'GET', '/api/v1/sessions/nope', { token });
    assert.equal(missing.status, 404);

    const body = { requestId: 'req-1', text: 'Привет с телефона', mode: 'transcript' };
    const prompt = await call(ctx.port, 'POST', '/api/v1/sessions/session-a/prompt', { token, body });
    assert.equal(prompt.status, 200);
    assert.equal(prompt.json().accepted, true);

    const replay = await call(ctx.port, 'POST', '/api/v1/sessions/session-a/prompt', { token, body });
    assert.equal(replay.status, 200);
    assert.equal(replay.json().deduplicated, true);

    const empty = await call(ctx.port, 'POST', '/api/v1/sessions/session-a/prompt', {
      token,
      body: { requestId: 'req-2', text: '   ' },
    });
    assert.equal(empty.status, 400);
    assert.equal(empty.json().error.code, 'prompt-invalid');

    const badJson = await call(ctx.port, 'POST', '/api/v1/sessions/session-a/prompt', {
      token,
      body: {},
      headers: { 'Content-Type': 'text/plain' },
    });
    assert.equal(badJson.status, 415);

    const answer = await call(ctx.port, 'POST', '/api/v1/sessions/session-a/approval', {
      token,
      body: { requestId: 'req-3', approvalId: 'apr_x', decision: 'allow' },
    });
    assert.equal(answer.status, 404);
    assert.equal(answer.json().error.code, 'approval-unknown');
  } finally {
    await ctx.cleanup();
  }
});

test('gateway: SSE stream delivers hello, delta, live and state frames', async () => {
  const ctx = await setup();
  try {
    const paired = await call(ctx.port, 'POST', '/api/v1/pair', { body: { code: ctx.pairing.code } });
    const token = paired.json().deviceToken;

    /** @type {string[]} */
    const frames = [];
    let resolveFrame;
    const framePromise = new Promise((resolve) => {
      resolveFrame = resolve;
    });
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: ctx.port,
        method: 'GET',
        path: '/api/v1/sessions/session-a/stream?cursor=-1',
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      },
      (res) => {
        assert.equal(res.statusCode, 200);
        assert.match(String(res.headers['content-type']), /text\/event-stream/);
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          let index;
          while ((index = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            frames.push(frame);
            if (frames.length === 4) resolveFrame(undefined);
          }
        });
      },
    );
    req.end();

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(frames.some((frame) => frame.includes('event: hello')));

    ctx.bridge.emit('delta', { events: [{ seq: 2, t: '2026-10-23T12:00:02.000Z', k: 'assistant/message', d: { text: 'Р“РѕС‚РѕРІРѕ' } }] });
    ctx.bridge.emit('live', { attemptId: 'a1', revision: 1, text: 'Печатаю' });
    ctx.bridge.emit('state', { running: false });

    await Promise.race([framePromise, new Promise((resolve) => setTimeout(resolve, 1000))]);
    const all = frames.join('\n\n');
    assert.match(all, /event: hello/);
    assert.match(all, /event: delta/);
    assert.match(all, /"k":"assistant\/message"/);
    assert.match(all, /event: live/);
    assert.match(all, /Печатаю/);
    assert.match(all, /event: state/);
    req.destroy();
  } finally {
    await ctx.cleanup();
  }
});

test('gateway: static PWA assets and CORS preflight', async () => {
  const ctx = await setup();
  try {
    const index = await call(ctx.port, 'GET', '/index.html');
    assert.equal(index.status, 200);
    assert.match(String(index.headers['content-type']), /text\/html/);

    const preflight = await call(ctx.port, 'OPTIONS', '/api/v1/sessions', {
      headers: { Origin: 'https://appassets.androidplatform.net', 'Access-Control-Request-Method': 'GET' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(String(preflight.headers['access-control-allow-origin']), '*');

    const missing = await call(ctx.port, 'GET', '/api/v1/nope');
    assert.equal(missing.status, 401);
  } finally {
    await ctx.cleanup();
  }
});

