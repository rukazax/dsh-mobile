#!/usr/bin/env node
/**
 * e2e-mobile.mjs — end-to-end probe of the DSH Mobile LAN gateway.
 *
 * Talks to an ISOLATED test instance only (default http://127.0.0.1:3081). It
 * never prompts a model: listing, opening and streaming are read-only, so this
 * script costs zero tokens.
 *
 * Usage:
 *   node e2e-mobile.mjs <pairing-code> [base]
 */
const code = process.argv[2];
const base = (process.argv[3] ?? 'http://127.0.0.1:3081').replace(/\/$/, '');
if (code === undefined) {
  console.error('usage: node e2e-mobile.mjs <pairing-code> [base]');
  process.exit(2);
}

let token;
let bytes = 0;

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown, token?: string, headers?: Record<string, string> }} [options]
 */
async function call(path, options = {}) {
  const method = options.method ?? 'GET';
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  const started = performance.now();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
      ...(options.headers ?? {}),
    },
    body: payload,
  });
  const text = await res.text();
  bytes += Buffer.byteLength(text);
  const wire = Number(res.headers.get('content-length') ?? text.length);
  const encoding = res.headers.get('content-encoding') ?? 'identity';
  return {
    status: res.status,
    ms: Math.round(performance.now() - started),
    text,
    wire,
    encoding,
    json: () => JSON.parse(text),
    headers: res.headers,
  };
}

function line(label, value) {
  console.log(`${label.padEnd(34)} ${value}`);
}

// 1. hello
const hello = await call('/api/v1/hello');
line('GET /hello', `${hello.status} ${hello.ms}ms ${hello.text.length}B`);

// 2. unauthorized access
const unauth = await call('/api/v1/sessions');
line('GET /sessions (no token)', `${unauth.status} ${unauth.json().error?.code}`);

// 3. pair
const paired = await call('/api/v1/pair', {
  method: 'POST',
  body: { code, deviceName: 'Honor Magic V3 (e2e)', devicePlatform: 'android-browser' },
  headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; wv) DshMobileApp/0.1' },
});
if (paired.status !== 200) {
  console.error('pairing failed:', paired.status, paired.text);
  process.exit(1);
}
token = paired.json().deviceToken;
line('POST /pair', `${paired.status} ${paired.ms}ms token=${token.length} chars`);

// 4. replayed pairing must fail
const replay = await call('/api/v1/pair', { method: 'POST', body: { code } });
line('POST /pair (replay, same code)', `${replay.status} ${replay.json().error?.code}`);

// 5. list sessions
const list = await call('/api/v1/sessions', { token });
const sessions = list.json().sessions ?? [];
line('GET /sessions', `${list.status} ${list.ms}ms ${list.text.length}B ${sessions.length} rows`);
for (const session of sessions.slice(0, 5)) {
  console.log(
    `  - ${session.id.slice(0, 22).padEnd(22)} ${String(session.updatedAt).slice(0, 19)} ` +
      `${session.status.padEnd(8)} ${session.workspaceName.padEnd(10)} ${session.title.slice(0, 40)}`,
  );
}
if (sessions.length === 0) {
  console.log('  (no sessions in this test home)');
}

// 6. open the first session (2-turn window)
const target = sessions[0];
if (target !== undefined) {
  const open = await call(`/api/v1/sessions/${encodeURIComponent(target.id)}?turns=2`, { token });
  const snapshot = open.json();
  line(
    'GET /sessions/{id}',
    `${open.status} ${open.ms}ms ${open.wire}B on wire (${open.encoding}), ${open.text.length}B json`,
  );
  line('  events', `${snapshot.events?.length ?? 0} (cursor ${snapshot.cursor})`);
  const kinds = new Map();
  for (const event of snapshot.events ?? []) kinds.set(event.k, (kinds.get(event.k) ?? 0) + 1);
  line('  kinds', [...kinds.entries()].map(([kind, count]) => `${kind}:${count}`).join(', ') || '—');
  line('  running/queue', `${snapshot.running} / ${snapshot.queue?.length ?? 0}`);
  line('  pendingApproval', snapshot.pendingApproval === null ? 'null' : 'present');

  // 7. older page
  const older = await call(
    `/api/v1/sessions/${encodeURIComponent(target.id)}/older?before=${snapshot.cursor}&turns=2`,
    { token },
  );
  line('GET /sessions/{id}/older', `${older.status} ${older.ms}ms ${older.text.length}B`);

  // 8. SSE stream: expect the hello frame, then close.
  const controller = new AbortController();
  const streamRes = await fetch(
    `${base}/api/v1/sessions/${encodeURIComponent(target.id)}/stream?cursor=${snapshot.cursor}`,
    {
      headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
      signal: controller.signal,
    },
  );
  line('GET stream (status)', `${streamRes.status} ${streamRes.headers.get('content-type')}`);
  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let received = '';
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && !received.includes('event: hello')) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += decoder.decode(chunk.value, { stream: true });
  }
  line('SSE first frame', received.split('\n').filter(Boolean).slice(0, 2).join(' | '));
  controller.abort();

  // 9. write paths reject bad input without touching a model
  const badPrompt = await call(`/api/v1/sessions/${encodeURIComponent(target.id)}/prompt`, {
    token,
    method: 'POST',
    body: { requestId: 'e2e-bad', text: '   ' },
  });
  line('POST prompt (blank)', `${badPrompt.status} ${badPrompt.json().error?.code}`);
  const badMode = await call(`/api/v1/sessions/${encodeURIComponent(target.id)}/prompt`, {
    token,
    method: 'POST',
    body: { requestId: 'e2e-bad2', text: 'hi', mode: 'teleport' },
  });
  line('POST prompt (bad mode)', `${badMode.status} ${badMode.json().error?.code}`);
} else {
  console.log('skipping open/stream/prompt probes: no session available');
}

// 10. workspaces + jobs
const workspaces = await call('/api/v1/workspaces', { token });
line('GET /workspaces', `${workspaces.status} ${workspaces.text.length}B`);
const jobs = await call('/api/v1/jobs', { token });
line('GET /jobs', `${jobs.status} ${jobs.text.length}B`);

// 11. revoke and verify the token dies
const revoke = await call('/api/v1/devices/revoke', { token, method: 'POST', body: {} });
line('POST /devices/revoke', `${revoke.status}`);
const after = await call('/api/v1/sessions', { token });
line('GET /sessions (revoked token)', `${after.status} ${after.json().error?.code}`);

line('total response bytes', `${bytes} B`);

