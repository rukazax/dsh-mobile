# DSH in-process session / agent / approval API map (for `dsh-mobile`)

Target: DeepSeek Harness **0.2.1-rc.2** desktop build. Everything below is verified
against the installed application extracted at `research\app\dsh` (README + compiled
`lib/*.js`; shipped `.d.ts` are stripped, so the authoritative runtime shapes come from
`lib/typert.host.js` / `lib/typert.remote-client.js` declaration strings and from the
type-declaration catalog in `dsh-tool-cordis\lib\types\api-catalog.js`), plus real
session logs under `C:\Users\<user>\.dsh\sessions\` (read-only, decompressed with the
multi-frame zstd reader in §13).

Notation: `P = research\app\dsh\node_modules\@deepseek-ai\`. A citation `pkg/lib/x.js:123`
therefore means `P<pkg>\lib\x.js`, line 123.

Contents

1. Composition map and `ctx` service keys
2. Safety model: live vs cold, promotion, read paths
3. Session listing (cheapest correct source)
4. Durable history window + live follow
5. Prompt / queue / steering / cancel
6. Approvals
7. User questions
8. Session create / fork / resume / rename / model
9. Workspaces and background jobs
10. Event wire shapes (real JSON + proposed mobile projection)
11. Token-cost hazard list
12. Recommended mobile gateway design (endpoint → call map)
13. Reading the durable log from disk (if a pure reader is preferred)
14. What could not be verified

---

## 1. Composition map and `ctx` service keys

The shipped desktop profile composes `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`
(`C:\Users\<user>\.dsh\profiles\desktop\package.json`, field `dsh.profile.bundles`).
Relevant rows are mounted there, so all services below exist in the live app:

- `dsh-base\cordis.patch.yml:41` session store; `:60` session-title;
  `:67` session-title-first-prompt-llm; `:79` user-questions; `:138`
  session-persistence-jsonl (`root: dshHomePath('sessions')`); `:157`
  session-query-sqlite (`path: ':memory:'`, `openAt: never`); `:173`
  session-projection; `:196` session-projection-cache (`writeEveryEvents: 200`,
  `writeIntervalMs: 5000`); `:260` user-approval
  (`policy: env DSH_PERMISSION_MODE==='danger-full-access' ? 'never' : 'ask'`).
- `dsh-web-app\cordis.patch.yml:122` api-session-controller; `:127`
  api-job-controller; `:155` api-workspace-controller; `:179` host-webserver;
  `:248` api-remotes.

| Purpose | `ctx` key | Package | Service registration |
|---|---|---|---|
| Session list/page/follow/prompt/cancel/rename/fork/create/projections/control | `sessionController` | dsh-api-session-controller | `lib/index.js:2952` (`super(ctx,"sessionController",{namespace:"session"})`) |
| Live session store (entered sessions only) | `sessions` | dsh-session | `P dsh-session\lib\index.js` (store service; `get()` :1980) |
| Live agent registry + Agent handles | `agents` | dsh-agent | `lib/index.js:332` (`super(ctx,"agents")`) |
| Durable read/list/observe/title/trace | `sessionQuery` | dsh-session-query | `lib/index.js:1048` |
| Durable persistence backend (stat/list/open) | `sessionPersistence` | dsh-session-persistence-jsonl | registered by backend; `stat` :2570, `list` :2603 |
| Projection registry (live per-session values) | `sessionProjections` | dsh-session-projection | `snapshot` :141, `stateOf` :126, `onChanged` :109 |
| Persisted projection cache (cold rows) | `sessionProjectionCache` | dsh-session-projection-cache | `cachedSnapshot(header)`, `cachedPredecessorTitle(header)` |
| Approvals | `approval` | dsh-user-approval | `lib/index.js:76` |
| User questions | `userQuestions` | dsh-user-questions | `lib/index.js:490` |
| Workspace registry | `workspaceRegistry` | dsh-workspace | `lib/index.js:376` |
| Workspace navigation RPC (optional) | `workspaceController` | dsh-api-workspace-controller | `lib/index.js:857` |
| Background jobs (snapshot/kill) | `jobs` | dsh-jobs-local | `super(ctx,"jobs")` `P dsh-jobs\lib\index.js:118`; impl `dsh-jobs-local\lib\index.js:503-527` |
| Job RPC streams (optional) | `jobController` | dsh-api-job-controller | `lib/index.js:319` |
| Session titles | `sessionTitle` | dsh-session-title | `lib/index.js:214`; projections `title`, `titleInput` |

> The current `packages/dsh-mobile/src/session-bridge.js:41` probes `agent`,
> `userApproval`, `workspace` — **those keys do not exist**. Use `agents`,
> `approval`, `workspaceRegistry` (plus the others above).

A plugin runs in the Host process and may call these services directly. Nothing below
requires the Typert Remote gateway; the Remote endpoints (`session/*`, `job/*`,
`workspace/*`) are thin wrappers over exactly these methods (e.g. `session/list` →
`SessionController.list`, `lib/index.js:3061`).

---

## 2. Safety model: live vs cold, promotion, read paths

This is the single most important section for a zero-token gateway.

### 2.1 Three Session states

1. **Live / attached** — a `Session` entered into `ctx.sessions`; usually also a live
   `Agent` in `ctx.agents`. `ctx.sessions.get(id)` returns it, `ctx.agents.get(id)`
   returns the Agent. It owns a write handle to persistence (`sessionPersistence`).
2. **Prepared (cold-read cache)** — created by `ctx.sessionQuery.observeSession()` via
   `ctx.sessions.prepare(...)` for a persisted session that is **not** entered and has
   **no** Agent (`P dsh-session-query\lib\index.js:350-396`, `dsh-session\lib\index.js:1799-1830`).
   Invisible to `ctx.sessions.get` / `ctx.agents.get`. Pinned by observation leases,
   LRU-cached up to `preparedSessionCacheSize` (default 5) keyed by persistence revision.
   Reads only; no writes; no model calls.
3. **Stored only** — on disk; reached through `sessionPersistence.stat/list` or a
   `sessionQuery` read (which prepares it).

`get()` semantics: `ctx.sessions.get(id)` returns only entered sessions
`P dsh-session\lib\index.js:1980-1982`; `prepare()` does not enter the store. Therefore:

```js
const isLive     = (id) => ctx.sessions.get(id) !== undefined;   // side-effect free
const liveAgent  = (id) => ctx.agents.get(id);                    // undefined when none
const isCold     = (id) => !isLive(id);
```

`AgentStatus = 'idle' | 'running'` (api-catalog declaration `AgentStatus`).

### 2.2 The promotion trap (`session/follow`)

`SessionHistoryController.follow()` yields its opening snapshot, then, for an ordinary
Session address whose observation source is `'prepared'`, calls
`this.promote(observation)`:

- `P dsh-api-session-controller\lib\types\history.js:196-230` (`sourceFor(...)`,
  `if (address.kind === 'session' && source.source === 'prepared') { const promotion =
  source.retain(); ... this.promote(promotion) }`),
- `P dsh-api-session-controller\lib\index.js:3006-3031` (`promote()` →
  `this.agents.resolveObservedAgent(observation)`),
- `P dsh-api-session-controller\lib\index.js:392-404` (`resumeObserved()` →
  `this.ctx.agents.resume({ resumeSessionId, agentOptions, setup })`).

Consequence: **following a cold session publishes an Agent and resumes it.** Resume is
not a model request (no tokens), but it is not read-only either: agent-loop resume reads
the stored log through its write handle, computes `interruptedTurnClosers`, and appends
synthetic `tool/result`, `step/end`, `turn/end {reason:{kind:'interrupted'}}` events
(`P dsh-session-persistence-jsonl\README.md:61`; `dsh-agent-loop\lib\index.js:1029`),
takes single-writer ownership, and materializes projectors. So a phone merely opening a
cold session through `follow` would mutate the desktop's session log.

**Rules for the gateway**
- Never call `ctx.sessionController.follow(...)` for a session with no live Agent.
- `ctx.sessionController.page(...)` does **not** promote — it calls
  `sourceFor(address, signal, false)` and never uses the retained promotion path
  (`history.js:97-132` vs `:139-269`).
- The durable live stream can be taken directly from the root bus
  `ctx.on('session/event', (session, event) => …)`, which is exactly what `follow`
  uses internally (`history.js:158-163`). Events are emitted on commit
  (`P dsh-session\lib\index.js:1579-1592`, commit → `session/event` with `(session, event)`).
- Assistant token chunks are a separate bus: `ctx.on('agent/assistant-stream', …)`
  (`P dsh-agent-loop\lib\index.js:1080`); safe on any live agent.

### 2.3 Cheap vs expensive reads (no tokens either way)

| Call | Cold cost | Live cost | Writes / promotion | Notes |
|---|---|---|---|---|
| `sessionController.list(req, signal)` | `sessionQuery.listSessions()` (one `stat`-like header read per artifact) + projection-cache rows | same + live projection snapshot | none | `P …\lib\types\list.js:112-161`; README:34 "List reads only stored headers and projection-cache rows: it never calls per-session stat or opens a cold Session body" |
| `sessionQuery.listSessions(signal)` | header-only listing | + `structuredClone(header)` | none | `P dsh-session-query\lib\index.js:95-118` |
| `sessionController.page(req, signal)` | full log load (cold observation) | `snapshotEvents()` copy | none | `history.js:97-132`; paginate `:395-426` |
| `sessionController.inspect(id, signal)` | full log load (`observeSession`, `projectionMode:'none'`) | `snapshotEvents()` | none; docstring "without repairing, resuming, or publishing" | `P …\lib\index.js:143-178`, `:3046-3054` |
| `sessionQuery.observeSession(id, {projectionMode})` | full log load (cached by revision) | lazy full prefix | none | `P dsh-session-query\lib\index.js:350-396` |
| `sessionController.projections({sessionId})` | observes + folds projections | registry snapshot | none (no resume) | `P …\lib\index.js:3281-3322` |
| `sessionPersistence.stat(id)` | header + revision + sizeBytes only | — | none | `P dsh-session-persistence-jsonl\lib\index.js:2570-2596` |
| `sessionController.follow(req, signal)` | **promotes cold session** | no promotion | Agent resume + possible log repair | avoid for cold |
| `sessionController.prompt/cancel/rename/updateQueue/fork/create/selectModel` | may resolve/resume | acts on agent | see §5/§8 | prompts cost tokens |

There is **no tail-only read API**. Both the GUI and `page` load the entire logical log
for a cold session (`dsh-session-query\README.md:151`: "Exact reads replay whole logs").
At ~7 MB decompressed for a 2 300-event session that is fine for occasional opens; do not
do it for 50 rows on every list request.

---

## 3. Session listing (cheapest correct source)

### 3.1 What exists

`SessionSummary` (the Host list row type, `api-catalog` declaration):

```ts
interface SessionSummary {
  agentAvailable: boolean
  formatStatus?: 'current' | 'migration-required'
  sessionId: SessionId
  updatedAt: number                 // epoch ms; max(header.createdAt, lastPromptAt)
  running: boolean
  blank: boolean
  parentSessionId?: SessionId
  origin?: 'subagent'
  cwd?: string
  projections?: SessionProjectionHints  // { kind:'cached'|'sequenced', asOfSeq, values }
}
```

Note what it does **not** have: `createdAt`, title, last message, event count. Title,
model and blank/lastPrompt come from `projections.values` (see 3.3).

Two list implementations:

- `ctx.sessionController.list(request, signal)` → `{ items: SessionSummary[] }`
  (`P …\lib\index.js:3061-3066`), sorted by `updatedAt` desc
  (`list.js:144`), owner sees everything (`remoteAccess.allows` on the owner principal).
- `ctx.sessionQuery.listSessions(signal)` → `{ header, live, persisted, formatStatus? }[]`
  sorted by `header.createdAt` desc (`P dsh-session-query\lib\index.js:95-118`,
  `compareSessions` :309-311). Headers carry `createdAt`, `cwd`, `parentSession`,
  `isSeeded`, `origin`, `delegationDepth`, `agentPreset`.

### 3.2 Recommended: one `listSessions` + projection registry + cache (no double listing)

`sessionController.list()` internally calls `sessionQuery.listSessions()` once
(`list.js:114`), then summarizes. Calling both would list twice. Build the compact row
yourself; this is exactly what `ApiSessionList` does, minus the wire padding:

```js
const P = ctx.get('sessionProjectionCache')
const recs = await ctx.sessionQuery.listSessions(signal)
const archived = new Set(ctx.workspaceRegistry.archivedSessionIds)
const wsFor = new Map()
for (const w of ctx.workspaceRegistry.list())
  for (const sid of w.sessionIds) wsFor.set(sid, w)

const rows = recs.filter(r => !archived.has(r.header.id)
        && (r.live || r.header.cwd !== undefined)).map(r => {
  const id = r.header.id
  const live = ctx.sessions.get(id)
  const agent = ctx.agents.get(id)
  const proj = live !== undefined
    ? ctx.sessionProjections.snapshot(live)                       // { asOfSeq, values }
    : P?.cachedSnapshot(r.header) ?? P?.cachedPredecessorTitle(r.header)
  const v = proj?.values ?? {}
  const meta = v.sessionListMetadata                            // { blank, lastPromptAt }
  const ms = v.modelSelection                                   // { lastUsed, next }
  const inbox = v.inbox                                         // { 'next-turn':[], 'next-step':[] }
  const q = v.userQuestions                                     // { active, settled }
  return {
    id,
    title: typeof v.title === 'string' ? v.title : null,
    ws: wsFor.get(id),
    createdAt: r.header.createdAt,
    updatedAt: Math.max(r.header.createdAt, meta?.lastPromptAt ?? 0),
    running: agent?.status === 'running',
    queueLen: (inbox?.['next-turn']?.length ?? 0) + (inbox?.['next-step']?.length ?? 0),
    pendingQuestion: (q?.active?.length ?? 0) > 0,
    model: ms?.lastUsed?.model ?? null,
    parentSessionId: r.header.parentSession ?? null,
    eventCount: live ? live.seq : (proj?.asOfSeq != null ? proj.asOfSeq + 1 : null),
  }
})
```

Cheaper still (marginal): `sessionController.list()` alone and accept no `createdAt`;
but the contract needs `createdAt`, so use the snippet above.

### 3.3 Fields the mobile `SessionSummary` needs, and where each comes from

| Mobile field | Source (exact) | Cold availability |
|---|---|---|
| `id` | `header.id` | always |
| `title` | projection `title` (string\|null): registered by `dsh-session-title\lib\index.js:172-182`; wire view is the string itself. Live: `sessionProjections.snapshot`. Cold: `sessionProjectionCache.cachedSnapshot(header).values.title` (checkpointed at `turn/end`, `dsh-session-projection-cache\README.md:57`). | often, not guaranteed |
| `workspaceId` / `workspaceName` | `workspaceRegistry.list()` entities `{id, path, title, sessionIds}`; find `sessionIds.includes(id)`; `isDefault` = `workspaceRegistry` default id (`dsh-workspace\README.md:101,117`) | always |
| `cwd` | `header.cwd` | always |
| `createdAt` | `header.createdAt` (epoch ms → ISO in the gateway) | always |
| `updatedAt` | `max(header.createdAt, projections.sessionListMetadata.lastPromptAt)` (`list.js:316-318`) | cached value, else createdAt |
| `status` | see 3.4 | mostly |
| `model` | projection `modelSelection.lastUsed.model` (`P …\lib\types\model-selection-projection.js:42-52`; wire `{lastUsed,next}`). Equivalent durable event: `model/selection` / `request/header.header.config.model` | cached often |
| `parentSessionId` | `header.parentSession` (`origin === 'subagent'` for children) | always |
| `lastText` / `lastRole` | **not in any list source**. Derive only after opening the log (or maintain a gateway-side cache from the live bus). See 3.5. | no |
| `eventCount` / `cursor` | live: `eventCount = live.seq` (`Session.seq` **is** the log length, `dsh-session\README.md:62`), `cursor = live.seq - 1`. Cold: `projectionCache.cachedSnapshot().asOfSeq + 1` when cached, else **null**. `stat()` has no event count — `SessionPersistenceSnapshot.eventCount?` exists in the seam type but the shipped JSONL backend never sets it (`P dsh-session-persistence-jsonl\lib\index.js:2570-2596,2629-2634`). | nullable |
| `hasPendingApproval` | fold `approval/asked` minus `approval/decided` (§6.3); only meaningful for open turns | null → false |
| `hasPendingQuestion` | projection `userQuestions.active.length > 0` | cached often |
| `formatStatus` | `record.formatStatus` (`'current' | 'migration-required'`) | always |

### 3.4 Status derivation

- `running` = `agent?.status === 'running'` (or list row `running`).
- `queued` = projection `inbox` wire value
  `{ 'next-turn': UserMessage[], 'next-step': UserMessage[] }`
  (`P dsh-agent-loop\lib\index.js:20-62`, registered at `:1583`); or
  `agent.inbox.nextTurn.length + agent.inbox.nextStep.length`.
- `blocked` = `hasPendingApproval || hasPendingQuestion` (also `turnBoundary.openTurnStartSeq
  !== null` while no step is in flight, but the two predicates above are the actionable ones).
- else `idle`.

### 3.5 `lastText` / `lastRole` honestly

The Host never materializes "last visible text" in a list row. Two acceptable designs:

1. **Nullable until first open** (recommended): return `lastText:null` for cold rows;
   after the gateway reads a session's log (opening window), cache the last
   `user/message`/`assistant/message` text and serve it from that cache. A row with a
   cached title is still readable; the UI shows the title (the title *is* derived from the
   first prompt anyway).
2. **Warm on demand**: when a device opens the sessions list, a bounded background job
   (concurrency ≤2, only sessions without cache, ≤50 rows) reads each log through
   `sessionQuery.observeSession` and extracts the last message. This is CPU+IO only, no
   tokens, but costs megabytes per row; do not do it synchronously in `GET /sessions`.

Do **not** try `sessionQuery.searchSessions` for this: the shipped composition mounts
`session-query-sqlite` with `openAt: never` (`dsh-base\cordis.patch.yml:157`), so
`searchSessions`/`searchEvents` fail with `SESSION_QUERY_SEARCH_DISABLED`
(`dsh-session-query-sqlite\README.md:46,67`). The contract's `q=` must be a gateway-side
filter over the cached rows (title + lastText + cwd).

### 3.6 Live updates for the list

- `ctx.on('session/event', …)` → `api-session/activity` equivalent (the controller emits
  `api-session/activity` for each `user/message`; `P …\lib\index.js:2997-3003`).
- `ctx.on('agent/status', ({agent, status}) => …)` → running flag
  (`P …\lib\index.js:2991-2993`).
- `ctx.sessionProjections.onChanged((session, key, value, seq) => …)` → title/blank/
  model/inbox/question changes (`P dsh-session-projection\lib\index.js:109-124`).
- `ctx.on('session/created'|'session/disposed')` → add/remove rows.
- `ctx.sessionController.control(signal)` is the packaged version of the same
  (baseline `{projections:{id:{asOfSeq,values}}}` + `projection` frames;
  `P dsh-session-controller\lib\types\control.js:30-65`), but consuming the two buses
  directly is simpler in-process.

These make the list *live* without polling; no tokens, no log reads.

---

## 4. Durable history window + live follow

### 4.1 `page` (cold-safe, GUI-equivalent windowing)

Request (`SessionPageRequest`, api-catalog):

```ts
{ address: { kind:'session', sessionId } | { kind:'subagent', parentSessionId, childSessionId, mode },
  throughSeq: number,        // inclusive log cut, "obtained from the corresponding follow opening frame"
  beforeSeq?: number,        // exclusive upper bound for older pages
  maxMessages?: number,      // default 50
  turnWindow?: { minMessages, minTurns } }
```

Response `{ records: [{ type:'event', event: SessionWireEvent }], hasMore: boolean }`
(`P …\lib\types\history.js:97-132`; paginate algorithm `:395-426`; validators `:318-347`).

Semantics: start at `end = min(throughSeq+1, beforeSeq)` and walk backwards counting
`user/message` + `assistant/message` append-surface events (a `tool/result` group counts
with its `sourceEventSeqs`), stop at the turn boundary satisfying `turnWindow`, or at
`maxMessages`, or at history exhaustion. Steering adds no turn boundary. With
`turnWindow` omitted, paging is message-aligned.

### 4.2 The lowest-level correct opening read: `observeSession`

For an in-process plugin, the cheapest single read that yields header + full event prefix
+ cursor + optional projections is:

```js
import { SessionLogOffset } from '@deepseek-ai/dsh-session'   // optional, branding is erased

const obs = await ctx.sessionQuery.observeSession(sessionId, { projectionMode: 'none' })
// obs = { source:'live'|'prepared', header, inheritedEventCount, events: readonly SessionEvent[],
//         cursor: lastSeq | -1, revision?, projections?, retain(), [Symbol.dispose]() }
try {
  const lastSeq = obs.cursor            // number, -1 for an empty log
  // ... build the mobile window from obs.events ...
} finally { obs[Symbol.dispose]() }
```

`observeSession` never publishes a Session and never resumes an Agent
(`P dsh-session-query\lib\index.js:350-396`). Cold observations are cached by
`(persistence identity, stat revision)` with LRU capacity 5 and are pinned while a lease
is alive (`dsh-session-query\README.md:61`). Keep the lease for the duration of a mobile
"open session" if you want cheap `older` paging; the full prefix is already in memory.

`ctx.sessionController.inspect(sessionId, signal)` returns the same idea but as a plain
object `{ meta: SessionHeader, inheritedEventCount, events }` (`P …\lib\index.js:143-178`,
`3046-3054`). Use `inspect` if you do not need projections/cursor; use `observeSession`
if you want projections too (`projectionMode:'all'`).

### 4.3 Re-implementing the GUI window locally (recommended; one read)

Copy the Host algorithm (`history.js:395-426`), so the mobile opening window matches the
desktop window byte-for-byte in content:

```js
const MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])
function pageWindow(events, end /* = lastSeq+1 */, maxMessages, turnWindow) {
  let count = 0, turns = 0, cut = 0
  for (let i = end - 1; i >= 0; i--) {
    const e = events[i]
    if (turnWindow !== undefined && e.type === 'turn/start') {
      turns++
      if (count >= turnWindow.minMessages && turns >= turnWindow.minTurns) { cut = i; break }
    }
    if (!MESSAGE_TYPES.has(e.type) || !isAppendSurface(e)) continue
    count++
    let groupStart = e.seq
    for (const s of e.sourceEventSeqs ?? []) if (s < groupStart) groupStart = s
    if (count >= maxMessages) { cut = groupStart; break }
  }
  return { events: events.slice(cut, end), hasOlder: cut > 0 }
}
const isAppendSurface = (e) => e.surfaceOp === 'append'
```

GUI opening rules (for parity): at least 50 append-origin messages and at least two
`turn/start` events, capped at 500 counted messages (`P …\README.md:69`). For mobile
`turns=2..10`, `maxMessages: 40` and `turnWindow:{minMessages:40,minTurns:2}` are a
reasonable window (≈2–4× byte budget of the contract).

### 4.4 Live durable follow (root bus, resume by seq)

Events are strictly contiguous, 0-based, per session, and delivered synchronously on
commit; a duplicate delivery is impossible from one subscription but a reconnect can
replay an overlap:

```js
const follower = { id: sessionId, lastSent: -1, buffer: new Map(), closed: false }
const off = ctx.on('session/event', (session, event) => {
  if (session.id !== follower.id) return
  follower.buffer.set(event.seq, event)          // events arrive synchronously after commit
  drain(follower)
}, { global: true })                              // global: cross-scope delivery (follow uses it)
function drain(f) {
  while (f.buffer.has(f.lastSent + 1)) {
    const e = f.buffer.get(f.lastSent + 1)
    f.buffer.delete(f.lastSent + 1)
    f.lastSent = e.seq
    sendSse({ event: 'delta', data: { from: String(e.seq), events: [project(e)] } })
  }
  if (f.buffer.size > 0) { sendSse({ event: 'resync', data: { reason: 'gap' } }); f.closed = true }
}
```

Opening sequence (subscribe first, then read, then replay the overlap):

1. register the `session/event` listener and the `agent/assistant-stream` listener
   (filter by `agent.session.id`);
2. `observeSession(id, { projectionMode:'all' })` (or `inspect`);
3. compute the window with `pageWindow(events, obs.cursor + 1, …)`; set
   `lastSent = obs.cursor`; send `{ session, events:[…], cursor: lastSent, hasOlder }`;
4. drain the buffer: events with `seq <= lastSent` are already in the window (one
   overlap line from the race), events `seq === lastSent+1` are deltas. A true gap
   (`seq > lastSent+1` with nothing in between) cannot happen with the listener
   registered first, unless the gateway itself dropped events; then send `resync`.
5. On client reconnect with `cursor=N`: reply `delta` with `seq > N` from
   `ctx.sessions.get(id)?.snapshotEvents()`? **No** — do not copy the whole log per
   reconnect. Keep a per-session recent-event ring (e.g. last 512 events) in the gateway;
   if `N` is older than the ring, send `resync` and let the client re-open. This mirrors
   the GUI's `loadThrough(seq)` gap repair (`P …\README.md:54,69`) but simpler.
6. `assistantStream` chunks are *transient*: they exist only for a live agent and cannot
   be replayed. After a reconnect, text arrives durably as `assistant/message`; the
   gateway should not buffer them for replay.

### 4.5 What `session/follow` would have given you (context, do not use for cold)

- Frame union `SessionFollowFrame` (`api-catalog`): `snapshot { header, cursor, records,
  hasMore, projections: {asOfSeq, values}, assistantStream? }`, `{type:'event', event}`,
  `{type:'assistant-stream', frame}`.
- It attaches its listener *after* reading the opening prefix, and asserts
  `item.event.seq === expectedSeq` else throws `gateway/internal` (`history.js:231-252`).
- Its assistant baseline compacts dense chunks into one stream for reconnecting clients
  (`P …\lib\types\assistant-stream.js:8-82`); the Web client converts that to
  `assistant/live-chunk` entries (`P …\README.md:54`).
- Useful only when you actually want an Agent resumed (e.g. the desktop GUI). The mobile
  gateway gets the same event stream from the bus, without promotion.

### 4.6 Assistant streaming frames (transient)

Emitted on `agent/assistant-stream` as `{ agent, frame }` (`P dsh-agent-loop\lib\index.js:1080`):

```js
// start
{ type:'start', attemptId:`${sessionId}:${n}`, revision, turn, step }
// chunk (dense revision +1, dense index from 0)
{ type:'chunk', attemptId, revision, index, time, chunk: StreamChunk }
// end (settlement; committed seq points at the durable assistant/message|assistant/attempt)
{ type:'end', attemptId, revision, index,
  outcome: { kind:'committed', eventType:'assistant/message'|'assistant/attempt', seq } |
           { kind:'abandoned' } }
```

`StreamChunk` union (api-catalog `StreamChunk`): `block-start {index,blockType}` |
`text-delta {index,text}` | `reasoning-delta {index,text}` |
`tool-call-delta {index,id,name?,argumentsDelta}` | `block-end {index,block}` |
`usage {usage}` | `finish {reason,replayState?}`. Mobile should forward only
`text-delta.text` (and optionally `reasoning-delta`) as the contract's `live` frame; tool
arguments are only useful after the durable `tool/call`.

---

## 5. Prompt / queue / steering / cancel

### 5.1 `sessionController.prompt` — the only prompt path

Remote signature (`P …\lib\index.js:3218-3231`): `prompt(request, signal) → { accepted:true }`.

`SessionPromptRequest` (api-catalog; JSON schema `P …\lib\typert.remote-client.js:1125-1145`):

```ts
{
  requestId: string                       // client-minted idempotency identity
  sessionId: string
  mode: 'queue' | 'steer'                 // NOTE: no 'transcript' — see below
  content: Array<
    { type:'text', text:string } |
    { type:'image', mediaType:'image/png'|'image/jpeg'|'image/webp'|'image/gif', data:string /*base64*/, name?:string } |
    { type:'file', receiptId:string }     // requires a fileUploads receipt (upload service)
  >
  clientTimeZone?: string                 // IANA name or 'UTC'
}
```

Mapping from the mobile contract:
- `mode:"transcript"` and `mode:"queue"` → Host `mode:'queue'` (both call
  `agent.followup(message)`; `followup` starts a new turn when idle = "transcript", queues
  into `next-turn` when running).
- `mode:"steer"` → Host `mode:'steer'` (`agent.steer(message)`; next-step input).
  Steering on an idle agent is not meaningful; the gateway should downgrade to `queue`
  unless `agent.status === 'running'`.

Implementation path: `SessionCommandController.prompt` (`P …\lib\index.js:925-966`):
`resolveAgent(sessionId)` (resumes a cold session) → idempotency check
(`hasPromptRequest`, `:1128-1139`: same `requestId` already in `inbox.nextTurn/nextStep`
or in a durable `user/message.source.rpcId` → returns `{accepted:true}` without a second
message) → `createUserMessage({content, source:{kind:'user', rpcId:requestId,
clientTimeZone?}})` → `agent.followup` / `agent.steer` → wake the loop.

**What it triggers:** a model request (turn), exactly like the desktop prompt; plus, on
the first eligible user message of a session, the automatic title LLM provider
(`dsh-base` mounts `session-title-first-prompt-llm`, `dsh-base\cordis.patch.yml:67`) makes
one auxiliary title request. That auxiliary request is triggered by the `user/message`
event, not by the gateway's call, so it is unavoidable when prompting from mobile (same
as desktop). Observing/listing sessions never triggers titles.

Attachments: images are technically accepted inline as base64 (`{type:'image',…}`) and
pass through `ctx.attachments.admitPromptContent`; admission checks the session model's
`inputModalities` (`P …\lib\index.js:937-941`). `{type:'file'}` needs a `fileUploads`
receipt, which a mobile device cannot mint without the upload service. Recommendation for
v1 stays `attachments:false` (contract); image support can be added later as
`{type:'image'}` without any DSH change.

### 5.2 Cancel and queue mutation

`cancel` (`P …\lib\index.js:1056-1067`, Remote `:3253-3255`):

```js
ctx.sessionController.cancel({ sessionId })   // → { accepted: true }
// requires a live agent; else gateway error 'session/not-found'
agent.cancel({ kind:'user' }, { keepInbox: true })
```

That is the **entire** cancellation API. It aborts the current turn and **keeps** pending
inbox work. There is no scope parameter (`SessionCancelRequest = { sessionId }`), and
`agent.cancel(cause)` with `keepInbox:false` is the only "drop the queue" primitive
(`dsh-agent\README.md:47,177`: "cancel() clears the inbox by default … there is no
step-only abort that keeps the turn running").

Queue mutation: `updateQueue` (`P …\lib\index.js:1004-1055`, Remote `:3245-3247`):

```ts
{ sessionId, itemId: MessageId, action: {kind:'edit', content:[TextBlock]} | {kind:'remove'} | {kind:'steer'} }
```

- locates the message in `agent.inbox.nextTurn` or `nextStep`; missing → `session/queue-item-not-found`;
- `edit` accepts non-whitespace text content only (`:1005-1008`);
- `remove` durable; also retires prompt file receipts (`:1041-1046`);
- `steer` only from `next-turn` while `agent.status === 'running'`, else `session/steer-unavailable` (`:1033`);
- resumes a cold agent when there is no live one (`:1009-1017`).

Implementation of the contract's scopes:

```js
async function cancelScope(sessionId, scope) {
  const agent = ctx.agents.get(sessionId)
  if (scope !== 'queue' && agent !== undefined) ctx.sessionController.cancel({ sessionId })
  if (scope === 'turn') return { ok: true }
  const live = ctx.agents.get(sessionId)
  if (live === undefined) return { ok: scope === 'queue' }     // nothing to clear cold
  const ids = [...live.inbox.nextTurn, ...live.inbox.nextStep].map(m => m.id)
  for (const itemId of ids)
    ctx.sessionController.updateQueue({ sessionId, itemId, action: { kind: 'remove' } })
  return { ok: true }
}
```

Ordering: cancel first, then remove — after `cancel(keepInbox:true)` the queue is intact
and the turn is closing; removing items immediately is durable. If `updateQueue` throws
`session/queue-item-not-found` for a race-claimed item, ignore it.

### 5.3 Error surface (map to the contract's `error.code`)

RemoteError codes seen on these paths: `gateway/bad-request`, `session/not-found`,
`session/agent-busy` (subagent-routed), `session/writer-held` (another process owns the
log), `session/queue-item-not-found`, `session/steer-unavailable`,
`session/attachment-invalid`, `session/model-unavailable`, `session/conflict`,
`agent-preset/*`, `gateway/internal`. `RemoteError` instances are plain objects with
`code`/`message`/`details` (`P dsh-typert-protocol\lib\types\remote-error.js`); a plugin
calling the service directly receives the same objects, so the HTTP layer can pass
`error.code` through.

---

## 6. Approvals

### 6.1 The service has no "pending" or "answer" method

`ctx.approval` (`ApprovalService`, `P dsh-user-approval\lib\index.js:76`) exposes:

| Member | Line | Meaning |
|---|---|---|
| `request(req)` | :128-144 | called by tools; appends `approval/asked`, dispatches, appends `approval/decided`, returns outcome. Not for UI. |
| `effectivePolicy(session)` | :146-148 | `'ask' | 'never'` |
| `overrideOf(session)` | :150-162 | last durable `approval/policy` or `undefined` |
| `setPolicy(agent, policy)` | :90-102 | appends policy + **queues a model-visible user message** (tokens, wakes agent) |

Answering is exclusively the Cordis **waterfall event** `approval/request`:

```js
// inside decide(): the fallback is 'unavailable' => fail closed
ctx.waterfall(scopeTarget(req.agent, req.agent), 'approval/request', req,
              () => Promise.resolve('unavailable'))     // P dsh-user-approval\lib\index.js:169-190
```

Listener contract (the shipped ACP integration is the reference second answerer,
`P dsh-acp\lib\index.js:1158-1181`):

```ts
ctx.on('approval/request',
  (req: ApprovalRequestEvent, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>,
  { prepend?: true, global?: true })

ApprovalRequestEvent = { agent, toolName: string, callId?: ToolCallId,
                         reason?: string, displayReason?: Record<locale,string>,
                         signal?: AbortSignal }            // api-catalog declaration
ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'  // lib/index.js:30-35
```

There is **no approval id in the request**; the id is minted inside `request()` and
appended to the log before dispatch:

```js
session.append('approval/asked', { id, toolName, callId?, reason? })   // :132-137
// ... await decide(...) ...
session.append('approval/decided', { id, outcome })                   // :139-142
```

So the durable pair is the observation source, and the live listener must correlate by
`(callId, toolName)` — see 6.3.

### 6.2 Ordering vs the desktop GUI's answerer, and how to answer safely

- Cordis waterfall runs listeners **outermost-first**; a listener that does not call
  `next()` vetoes the rest including the built-in behaviour (`P cordis\lib\index.js:307-325`).
- Listener arrays are `push`-ordered; `prepend:true` unshifts (`P cordis\lib\index.js:335-345`).
- The desktop GUI's answerer is a root listener registered by `dsh-api-remotes` at load
  (`P dsh-api-remotes\lib\index.js:165-175`), forwarding to the browser page as a
  `waterfall` Remote event (declared `P dsh-api-remotes\lib\types\remote-events.js:18`).
  The shipped desktop page stays connected while the app runs.

Consequences:

- **Register without `prepend`** → your listener runs *after* the GUI bridge. It only
  runs when the bridge calls `next()` (its browser answered `next`, or no browser is
  connected). Practically: the desktop answers, mobile never does.
- **Register with `prepend:true`** → mobile is asked first; the GUI never receives that
  request unless you call `next()`. This is the only way to make mobile authoritative.
- To keep the desktop usable too, call `next()` and race it:

```js
ctx.on('approval/request', (req, next) => {
  if (!mobileShouldHandle(req)) return next()          // e.g. no device watching that session
  const desktop = next()                               // delivers to the GUI bridge; may hang if no page
  const mobile  = awaitMobileDecision(req, 120_000)    // your pending map / SSE round-trip
  const timeout = new Promise(r => setTimeout(() => r('unavailable'), 180_000))
  return Promise.race([mobile, desktop, timeout])
}, { prepend: true, global: true })
```

Caveats (important, and code-derived rather than runtime-verified):
- If no answering GUI page is connected, the bridge's forwarded event is registered with
  zero deliveries and nothing settles it (`P dsh-api-gateway\lib\types\index.js:464-467`
  dispatch only to `client.answers`; `:479-497` settles `next` only when a client result
  arrives and no deliveries remain) ⇒ `next()` can stay pending forever. Always race your
  own timeout.
- `next()` may be the same promise as the GUI's human answer; if mobile answers first the
  GUI card stays on screen until it is dismissed and its late result is a no-op in the
  gateway. Acceptable, but tell the user in the UI.
- The waterfall request carries the live `AbortSignal`; if it aborts (turn cancelled), its
  listener should return `cancelled` (the service also races the signal itself and returns
  `cancelled` — `:174-189`).
- `never` policy is enforced **before** any listener (`:175-179`), so mobile cannot
  bypass a `never` session.
- Only one-shot grants exist; there is no "always allow" / remembered decision
  (`dsh-user-approval\README.md:154`). The contract's `remember?` must be rejected as
  `unsupported`.
- A request must be inside an open turn (`hasOpenTurn` gate, `:49-56,130`); answers are
  only possible for a live turn.

### 6.3 Pending approval detection and id correlation

```js
// fold over a session log (durable; cheap CPU over an already-loaded array)
function pendingApprovals(events) {
  const open = new Map()
  for (const e of events) {
    if (e.type === 'approval/asked')   open.set(e.data.id, e.data)      // {id,toolName,callId?,reason?}
    if (e.type === 'approval/decided') open.delete(e.data.id)           // {id,outcome}
  }
  return [...open.values()]                                             // typically 0 or 1
}
```

- In the live listener, `req` has no id: take `req.agent.session.snapshotEvents()` (live
  log, in memory) and pick the most recent `approval/asked` whose `id` is not decided and
  whose `callId`/`toolName` match `req`; that is the id the phone will use. Store
  `id → { resolve }` in a map; the mobile `POST /sessions/{id}/approval {approvalId,
  decision}` resolves it with `'allowed-once' | 'rejected'`.
- For the sessions list, `hasPendingApproval` can only be exact for (a) approvals observed
  since the gateway started (bus-maintained map) and (b) live sessions with an open turn
  whose log you scan. The open-turn predicate is the **host-only** `turnBoundary` unit
  (`P dsh-agent-loop\lib\index.js:1364-1412`, no `wire` block): read it with
  `ctx.sessionProjections.stateOf(liveSession, 'turnBoundary')?.openTurnStartSeq !== null`
  (`P dsh-session-projection\lib\index.js:126`), not from `snapshot()`. Approvals cannot
  exist outside an open turn, so scanning only open-turn sessions is sufficient and cheap
  (usually 0–2 sessions).
- The approval card data: `title` = `toolName` (plus a hint from `reason`); `detail` =
  `reason` (already localized human text for sandbox escalations, real example in §10).
- The `displayReason` map (`{en, ru, …}`) is only available on the live waterfall request,
  not in the durable event; to show a localized reason on a late-joining phone, the
  gateway must cache it from the listener keyed by approval id.

---

## 7. User questions (`ask_user_question`)

Two states, two answer paths.

### 7.1 Durable observation: the `userQuestions` projection

Registered by `ctx.userQuestions` when the projection registry is mounted
(`P dsh-user-questions\lib\index.js:490-493`), definition
`P dsh-user-questions\lib\types\projection.js:281-297`. Wire value:

```ts
{
  active: Array<{
    callId: string
    questions: Array<{ id: string, question: string, detail?: string, header?: string,
                       options?: Array<{label: string, description?: string}>,
                       multiSelect?: boolean }>
    state: 'open' | 'continued'
  }>
  settled: Array<{ callId: string, answers: Array<{id:string, selected:string[], custom?:string}> }>
}
```

Registered only for calls made under the **timed** `ask_user_question` schema (the
`request/header.tools` entry must declare a `timeout` parameter); legacy blocking calls
never enter the projection (`projection.js:8-13,197-206`). `state:'open'` = the tool call
is still awaiting an answer; `continued` = the tool returned `{pending:true,callId}` (or
crash repair) and the answer can arrive later.

Read it cheaply: `ctx.sessionProjections.snapshot(liveSession).values.userQuestions`
(live) or `sessionQuery.observeSession(id,{projectionMode:'all'}).projections.values` /
projection-cache (cold). No resume, no tokens.

### 7.2 Open question → `user-questions/request` waterfall

`ctx.userQuestions.ask()` dispatches a scoped waterfall
(`P dsh-user-questions\lib\index.js:668-691`):

```js
ctx.waterfall(scopeTarget(agent, agent), 'user-questions/request',
              { ...request, agent }, noAnswerer /* rejects NO_PROVIDER */)
```

Listener payload (`AskUserQuestionRequestEvent`, api-catalog):
`{ questions: AskUserQuestionItem[], agent?: Agent, signal?: AbortSignal,
   wait?: { callId, timed?: boolean } }`.

Return value: `{ answers: [ { id: string, selected: string[], custom?: string } ] }`
(`AskUserQuestionAnswer`, `projection.js:59-67`; for single-select `custom` overrides and
`selected` is empty; for multi-select `custom` supplements `selected`; a skipped item is
`{id, selected: []}` — `dsh-user-questions\README.md:29`).

```js
ctx.on('user-questions/request', (req, next) => {
  if (!mobileShouldHandle(req)) return next()
  const desktop = next()                     // GUI bridge -> browser card
  const mobile = awaitMobileAnswer(req, 120_000)
  return Promise.race([mobile, desktop, timeoutUnavailable(180_000)])
}, { prepend: true, global: true })
```

Same ordering/stealing/hang caveats as approvals (§6.2). The shipped Web answerer is a
second listener bridged by api-remotes (`dsh-api-remotes\lib\types\remote-events.js:44`).

### 7.3 Continued question → `ctx.userQuestions.answer(...)`

```js
const agent = ctx.agents.get(sessionId)                 // must be the exact live root agent
ctx.userQuestions.answer(agent, callId, { answers })     // → boolean
```

`P dsh-user-questions\lib\index.js:552-588`; requires `assertLiveRoot` (`:531-535`: exact
live instance, runtime root — a subagent child rejects with `DELEGATED_CALLER`). If the
session is cold, resume it first:

```js
if (!ctx.agents.get(id))
  await ctx.agents.resume({ resumeSessionId: id, agentOptions: currentSelection(ctx) })
```

(`ctx.agents.resume` `P dsh-agent\lib\index.js:466`; `agentOptions` from
`ctx.agentDefaultModel.currentSelection()` as the controller does at
`P …\lib\index.js:527-533`.)

Side effects of `answer()`: it builds a `user-question-reply` user message and calls
`agent.steer(message)` (`:561-582`) ⇒ a model-visible message; the next model step sees it
and the eventual answer consumes tokens. Errors: `BAD_ANSWER` (batch size/mismatch),
`REPLY_QUEUED`, `CALLER_NOT_LIVE`, `DELEGATED_CALLER`, `ASK_ABORTED`.

`attachWait(agent, callId, signal)` is a Remote **stream** yielding
`{ remainingMs }`-style frames for the countdown (`:596-600`, `TimedQuestionWait` in
`lib/types/timed-wait.js`); a mobile gateway can instead compute the deadline itself from
the `ask_user_question` schema's `timeout` argument — there is no remaining-time value in
the projection.

Timeouts: `askTimed(request, callId, timeoutMs)` (`:613-651`) releases the model at the
deadline and returns `{pending:true, callId}`; the question stays `continued` in the
projection and remains answerable indefinitely ("No Remote method abandons a question",
`dsh-user-questions\README.md:35`).

### 7.4 Querying question state without activating agents

For the mobile contract: `hasPendingQuestion` = projection `active.length > 0`; the card
data = first active `questions[]`. On answer, if the question is `open` you must be the
waterfall answerer (i.e. your listener must have intercepted it — otherwise the GUI is
holding it); if `continued`, call `answer()`. The gateway should tell the phone which
state the card is in (`open` vs `continued`) so it can pick the right POST path — or hide
the distinction behind one endpoint that tries the pending-resolver map first, then
`answer()`.

---

## 8. Session create / fork / resume / rename / model

### 8.1 Create (`POST /sessions`)

```js
const res = await ctx.sessionController.create({
  workspaceId,                 // XOR cwd; omitting both uses Host process.cwd()
  // cwd,
  // sessionId,                // reuse a named blank session (advanced)
  // agentPreset,              // default preset otherwise
})                             // → { sessionId, agentPreset? }
```

`SessionCommandController.create` (`P …\lib\index.js:755-787`):
- `workspaceId` → `workspaceRegistry.get(id)`; `cwd = workspace.path`;
- else `cwd = request.cwd ?? this.defaultCwd` where `defaultCwd = process.cwd()` of the
  Host app (`:2957`) — **not** "the last workspace". If the phone omits `workspaceId`, the
  gateway should pick a workspace itself (e.g. first in `workspaceRegistry.list()` or the
  one containing the most recently updated session) and pass its id, then attach.
- Creates an Agent (`ctx.agents.create`), ensures the directory (`mkdir -p`), no model
  call. Returns the preset that ran.
- Errors: `gateway/bad-request` (both workspaceId and cwd), `workspace/not-found`,
  `session/conflict` (named session in another cwd), `session/agent-busy`,
  `session/workspace-attach-failed`, `agent-preset/*`.

### 8.2 Fork

```js
await ctx.sessionController.fork({ sessionId, atSeq?, allowMigration? })  // → { sessionId }
```

Cold-readable exact event prefix (`P …\lib\index.js:3206-3211` and `:849-917`);
`atSeq` omitted = latest completed turn (a cut inside an open turn gets synthetic closers);
copies up to the prefix and attaches the child to the source's workspace. With
`allowMigration:false` a migration-required source rejects `session/migration-required`
before any write (`:3207-3209`). No Agent is created for the source; a child Session is
created. No tokens.

### 8.3 Resume (what "activation" means)

`ctx.agents.resume({ resumeSessionId, agentOptions?, setup?, signal? })` →
`AgentHandle` (`dsh-agent\lib\index.js:466`; type `ResumeAgentOptions`).
Effects: loads the persisted log, computes + appends crash-report closers, takes the
persistence write handle, publishes the Session, builds the agent scope. **No model
request** until input arrives (`dsh-agent\README.md:28-43`). It is still a write and must
be treated as a side effect, not a read.

The controller's own helper (`ctx.sessionController.resolveAgent(sessionId)`,
`P …\lib\index.js:3037-3039`) is what prompt/rename/selectModel/updateQueue use; you can
avoid it by checking `ctx.agents.get(id)` first when you *don't* want activation.

### 8.4 Rename

```js
await ctx.sessionController.rename({ sessionId, title })   // → { title, seq }
```

Requires `ctx.sessionTitle` (`:827-841`); **resumes a cold agent** (`:828`), appends
`session/title` with `source:{kind:'user'}` (pins the title against automatic revision,
`dsh-session-title\README.md:32`). No tokens, but activation side effects. The automatic
title can alternatively be refreshed **costing an LLM call** via
`ctx.sessionTitle.refresh(session)` (`P dsh-session-title\lib\index.js:319`) — do not
expose refresh from mobile.

### 8.5 Model selection

```js
await ctx.sessionController.selectModel({ sessionId, provider, model, reasoningEffort? })
// → { selected: { provider, model, reasoningEffort? } }
```

Resumes the session (`:793-820`); validates against the live model catalog; appends
`model/selection` and saves the default profile in the background (no model call).
Read-only alternative for the UI: `ctx.sessionController.modelCatalog()` (`:3121-3123`)
which is a pure registry read.

---

## 9. Workspaces and background jobs

### 9.1 Workspaces

`ctx.workspaceRegistry` (`P dsh-workspace\lib\index.js:376`) is synchronous and cheap
(header-only accounting, no log reads — `dsh-workspace\README.md:95`):

```js
const list = ctx.workspaceRegistry.list()        // :454-460, durable registry order
// entity: { id, path, title, createdAt, updatedAt, sessionIds, setTitle(), attachSession(), ... }
// (api-catalog `Workspace`; createdAt/updatedAt are ISO strings)
const archived = ctx.workspaceRegistry.archivedSessionIds   // :506-508
const pinned   = ctx.workspaceRegistry.pinnedSessionIds
```

For the mobile `/workspaces` payload:
`{ id: w.id, path: w.path, name: w.title, isDefault: <registry default id>, sessionCount: w.sessionIds.filter(id => !archived.has(id)).length }`.
`isDefault`: the registry keeps `defaultWorkspaceId` in its global state
(`dsh-workspace\README.md:117`); the Host controller's `initializeDefault()` is the
creation path (`dsh-api-workspace-controller\lib\index.js`). There is no public
`defaultWorkspaceId` getter documented in the README excerpt we read; if you need it,
check `ctx.workspaceRegistry` instance fields at runtime (not verified).

### 9.2 Jobs

The registry `ctx.jobs` (impl `dsh-jobs-local`) is synchronous for snapshots:

```js
const views = ctx.jobs.list(sessionId)          // JobView[]; also lists unowned jobs when caller omitted
// JobView: { id, kind, label, owner?, outputLimitBytes?, status, progress?, detail?,
//            startedAt, finishedAt?, output:{ total, earliest, spillPaths? } }
const outcome = ctx.jobs.kill(jobId, sessionId, 'cancelled by the user')  // 'requested'|'already-finished'
```

`P dsh-jobs-local\lib\index.js:503-527`; owner fence is the caller SessionId; a child
session's own jobs are visible to it. For a global `/jobs` list, union
`ctx.jobs.list(sessionId)` over live sessions (plus `ctx.jobs.list(undefined)` for
unowned jobs). `jobController` (`P dsh-api-job-controller\lib\index.js:319`) only offers
streams (`job.list`, `job.follow`) that mirror the same registry; its `job.kill` maps to
`ctx.jobs.kill` with reason `'cancelled by the user'` and answers
`{ outcome:'requested'|'already-finished' }` (`dsh-api-job-controller\README.md:25-27`).
Neither read consumes the model's job output cursor.

Durable lifecycle events also exist (`job/registered`, `job/settled` — §10), useful for
the phone's stream without another subscription.

---

## 10. Event wire shapes (real JSON + proposed mobile projection)

Envelope (durable, `SessionEvent` / `SessionWireEvent`):

```json
{ "type": "…", "seq": 0, "time": 1792745782343, "data": { … },
  "surfaceOp": "append"|{ "op":"replace", "startSeq":n, "endSeq":n },
  "sourceEventSeqs": [ … ], "ignorable": true }
```

- `seq`: dense, 0-based, per session; event count = `seq+1`.
- `time`: epoch milliseconds (convert to ISO in the mobile layer).
- `surfaceOp` present only for surface events (`system/message`, `developer/message`,
  `user/message`, `assistant/message`, `tool/result`) and always `"append"` except
  compaction replacements (`api-catalog` `SurfaceIntent`, `SurfaceOp`).
- `sourceEventSeqs`: surface events that cite earlier events (`tool/result` cites its
  `tool/call`; see the real example).
- `ignorable`: only producers of unknown event types set it; a reader must skip unknown
  non-ignorable types (`P dsh-session\lib\types\known-event-types.js:7-19`).

The complete current map (extracted from the shipped declaration
`P dsh-agent-preset-registry\lib\typert.host.js` `SessionEventMap`; event names also in
`P dsh-session\lib\types\known-event-types.js:21-84`):

```
turn/start {turn}                                    turn/end {turn, reason}
step/start {turn, step}                              step/end {turn, step}
user/message UserMessage                             developer/message {turn, step, message, headerSeq?}
system/message {turn, step, message}
assistant/message {turn, step, message, stream, usage?, interrupted?}
assistant/attempt {turn, step, stream}
tool/call {turn, step, callId, name, arguments:string}
tool/result {turn, step, message, error?, meta?}
request/header {header, reason, startsSeries?}       request/context {provider, model, contextWindow, systemPromptUpdate}
session/end-seed {inherited?}                        agent/inbox/spliced {target,start,removedCount?,inserted,outcome?}
working-directory/change {cwd}                       sandbox/mode {mode, source?}
approval/asked {id, toolName, callId?, reason?}      approval/decided {id, outcome}
approval/policy {policy, source?}                    tool/ptc-dispatch-start / tool/ptc-dispatch
agent-preset/selected {agentPreset}                  job/registered JobRegisteredData; job/settled JobSettledData
command/run {commandId, name, args?, source}         command/done {commandId, kind, text?, sourceEventSeq?}
image/offload {targets}                              session/title {title, messageSeqs, source}
todo/write {todos}                                   model/selection {provider, model, reasoningEffort?}
permission/preset {preset}                           subagent/descriptor, subagent/catalog
compaction/start {compactionId, sourceCommandId?, turn}
compaction/summary {compactionId, sourceCommandId?, summary: ContentBlock[], shadowedRange, shadowedSeqs,
                    shadowedTokenCount, provider, model, maxTokens?, usage?, rawOutput?, llmStreamCall?}
compaction/end {compactionId, sourceCommandId?, turn, error?}
compaction/prune {shadowedRange, shadowedSeqs, shadowedTokenCount}
feedback/record; llm/retry LlmRetryEventData; llm/retry-started LlmRetryStartedEventData
team/member, team/task, team/message/queued|delivered; goal/change; feedback/message-put|delete
plan/mode {active}; schedule/change; subagent/model-selection-policy; workspace/changes {turn}
```

Message/block shapes (`api-catalog`):

```
MessageBase   { id, content: ContentBlock[], source: MessageSource }
ContentBlock  {type:'text', text} | {type:'reasoning', text}
            | {type:'image', attachment, offloaded?} | {type:'file', attachment}
            | {type:'tool-call', id, name, arguments:string}
            | {type:'tool-addition', toolName} | {type:'tool-removal', toolName}
UserMessage       { role:'user', ...MessageBase }
AssistantMessage  { role:'assistant', source:{kind:'model', provider, model, replayState?}, ... }
ToolResultMessage { role:'tool', toolCallId, isError?, source:{kind:'tool', callId}, ... }
TokenUsage        { inputTokens, outputTokens, totalTokens?, cacheReadTokens?, cacheWriteTokens?, reasoningTokens? }
AssistantStreamRecord = {type:'text-chunks',time0,index,dt[],texts[]}
                      | {type:'reasoning-chunks',…} | {type:'tool-call-chunks',time0,index,dt,id,name?,args[]}
                      | {type:'chunk',time,chunk:StreamChunk}
TurnEndReason = {kind:'completed'} | {kind:'aborted', reason:AgentCancelCause}
              | {kind:'blocked'} | {kind:'error', error:LlmFailure}
              | {kind:'max-tokens'} | {kind:'interrupted'} | {kind:'forked'}
AgentCancelCause = {kind:'user'}|{kind:'parent'}|{kind:'hook',reason}|{kind:'disposed'}
LlmFailure = { message, code, status?, providerRetryAfterMs?, requestId?, offloadImages? }
```

### 10.1 Real examples (from `C:\Users\<user>\.dsh\sessions\`, strings trimmed)

`turn/start` (real, seq 4):
```json
{"type":"turn/start","seq":4,"time":1792746030881,"data":{"turn":1}}
```

`step/start` (real, seq 6):
```json
{"type":"step/start","seq":6,"time":1792746030898,"data":{"turn":1,"step":1}}
```

`user/message` (real, seq 8, prompt text trimmed):
```json
{"type":"user/message","seq":8,"time":1792746030900,
 "data":{"content":[{"type":"text","text":"создай мобильный клиент deepseek harness …"}],
         "source":{"kind":"user","rpcId":"c036a7ec-61d6-4575-8971-7444a3544bed",
                   "clientTimeZone":"Europe/Moscow"},
         "role":"user","id":"fb6eeb67-c7e1-4c5e-b31b-5670783ff9ab"},
 "surfaceOp":"append"}
```
Mobile: `{ k:"user/message", d:{ text, attachments?:[] } }`; source text = concatenation of
`data.content` blocks with `type === 'text'`; `rpcId` is the client `requestId` (useful to
match the phone's optimistic bubble).

`assistant/message` (real, seq 17; reasoning text and args trimmed):
```json
{"type":"assistant/message","seq":17,"time":1792746034197,
 "data":{"turn":1,"step":1,
  "message":{"role":"assistant",
   "content":[{"type":"reasoning","text":"The user wants a mobile client …"},
              {"type":"tool-call","id":"call_00_yjmJGjOQczdyrLhAsdFx3865",
               "name":"working_directory","arguments":"{}"},
              {"type":"tool-call","id":"call_01_1TLO7ROAfI4uWrWa8OrP4224",
               "name":"pwsh","arguments":"{\"command\":\"Get-ChildItem -Force …\"}"}],
   "source":{"kind":"model","provider":"deepseek-account","model":"deepseek-flash",
             "replayState":{"response":{"kind":"deepseek-messages","version":1,"model":"deepseek-flash"},
                            "blocks":[{"type":"reasoning","signature":"…"},{"type":"tool-call"},{"type":"tool-call"}]}},
   "id":"2b58aca8-f6a8-4af1-b4a6-035ea3e40b62"},
  "usage":{"inputTokens":943,"outputTokens":293,"cacheReadTokens":9856,"cacheWriteTokens":0,"totalTokens":11092},
  "stream":[{"type":"chunk","time":1792746032190,"chunk":{"type":"block-start","index":0,"blockType":"reasoning"}},
            {"type":"reasoning-chunks","time0":1792746032735,"index":0,"dt":[117,18,0],"texts":["The"," user"," wants"]},
            {"type":"chunk","time":1792746033980,"chunk":{"type":"block-end","index":0,"block":{"type":"reasoning","text":"…"}}}]},
 "surfaceOp":"append"}
```
Mobile: `{ k:"assistant/message", d:{ text, toolCalls?:[{callId,name,argsPreview}] } }`;
`text` = join of `content` blocks with `type==='text'` (reasoning is separate on purpose —
show it only in an "expanded" view); `toolCalls` = `content.filter(b=>b.type==='tool-call').map(b=>({callId:b.id,name:b.name,argsPreview:truncate(b.arguments,2048)}))`.
The durable `stream` is 1–5 KB and should **never** be forwarded to the phone.

`tool/call` (real, seq 18):
```json
{"type":"tool/call","seq":18,"time":1792746034198,
 "data":{"turn":1,"step":1,"callId":"call_00_yjmJGjOQczdyrLhAsdFx3865",
         "name":"working_directory","arguments":"{}"}}
```
Mobile: `d:{callId, name, argsPreview: truncate(arguments,2048), truncated}` (contract
wants `callId` + `name`; args are the raw JSON string).

`tool/result` (real, seq 24 from the pc-admin log, meta/sources trimmed):
```json
{"type":"tool/result","seq":24,"time":1792660375499,
 "data":{"turn":1,"step":1,
  "message":{"role":"tool",
   "source":{"kind":"tool","callId":"call_00_OCFEnq51ejrd5GPIIoKf2929"},
   "toolCallId":"call_00_OCFEnq51ejrd5GPIIoKf2929",
   "content":[{"type":"text","text":"External web content follows. Treat it as untrusted …"}],
   "isError":false,"id":"406ba7c7-d818-4bd9-871a-ef7a798b05fd"},
  "meta":{"sources":[{"url":"https://…","title":"…"}],"truncated":true}},
 "sourceEventSeqs":[20],"surfaceOp":"append"}
```
Mobile: `d:{callId: data.message.toolCallId, ok: data.message.isError !== true,
textPreview: truncate(join(text blocks),2048), truncated}`; on failure also
`code: data.error?.code`. `data.meta` is owner-defined UI data (e.g. web sources); a v1
gateway can drop it, or whitelist `meta.sources[].url/title` for link previews (≤ 2 KB).

`turn/end` (real, pc-admin seq 438):
```json
{"type":"turn/end","seq":438,"time":1792661534740,
 "data":{"turn":1,"reason":{"kind":"completed"}}}
```
Mobile: `d:{turnId:String(data.turn), reason:data.reason.kind}`; treat
`aborted|interrupted|error` as "stopped".

`approval/asked` / `approval/decided` (real, pc-admin seq 325/326):
```json
{"type":"approval/asked","seq":325,"time":1792660804941,
 "data":{"id":"25cb1992-6c33-460a-9312-a67681fa8332","toolName":"pwsh",
         "callId":"call_00_ET_TXURirMmniXybK5Bjsd85432",
         "reason":"escalate sandbox to danger-full-access: …"}}
{"type":"approval/decided","seq":326,"time":1792661310123,
 "data":{"id":"25cb1992-6c33-460a-9312-a67681fa8332","outcome":"allowed-once"}}
```
Mobile: `k:"approval/request"`, `d:{approvalId:data.id, title:data.toolName,
detail:data.reason, options:["allow","deny"]}`; resolved →
`d:{approvalId:data.id, decision:data.outcome==='allowed-once'?'allow':'deny'}`.

`session/title` (real, seq 14):
```json
{"type":"session/title","seq":14,"time":1792746030907,
 "data":{"title":"создай мобильный клие","messageSeqs":[8],"source":{"kind":"fallback"}}}
```
`source.kind` is `fallback` (deterministic from the first prompt), `provider` (LLM-refined,
`{provider, model?}`) or `user` (rename). Mobile: `k:"session/title"`, `d:{title}`.

`assistant/attempt` (real, pc-admin seq 2132; failure settlement of a stream — log-only):
```json
{"type":"assistant/attempt","seq":2132,"time":1792675894387,
 "data":{"turn":22,"step":4,
  "stream":[{"type":"chunk","time":1792675894387,
             "chunk":{"type":"finish","reason":{"kind":"error",
                      "failure":{"message":"DeepSeek Messages transport failed","code":"TRANSPORT"}}}}]}}
```
Mobile: there is no durable `error` event type. Derive `k:"error"` from this
(`failure.message/code`), and/or from `llm/retry` (below), and/or from the transient bus
`agent/error` (`{agent,error}`, `dsh-agent\README.md:67`).

`llm/retry` (real, seq 2133, policyKey trimmed):
```json
{"type":"llm/retry","seq":2133,"time":1792675894388,
 "data":{"retryId":"846b154a-…","turn":22,"step":4,"provider":"deepseek-account","mode":"normal",
         "policyKey":"[\"normal\",5,[\"EMPTY_RESPONSE\",…],500,10000,0.1]",
         "retry":1,"maxRetries":5,"delayMs":549.4055727121763,
         "failure":{"message":"DeepSeek Messages transport failed","code":"TRANSPORT"}}}
```
Mobile: `k:"error"` with `d:{message:data.failure.message, code:data.failure.code}`, or a
retry notice — one line, not a card.

`job/registered` / `job/settled` (real, seq 21/22):
```json
{"type":"job/registered","seq":21,"time":1792746034211,
 "data":{"jobId":"pwsh-bd974bdc3d154bce","owner":"session-851b…","kind":"pwsh",
         "label":"Get-ChildItem -Force | …","startedAt":1792746034211,
         "toolCall":{"callId":"call_01_1TLO…","rootCallId":"call_01_1TLO…"}}}
{"type":"job/settled","seq":22,"time":1792746041896,
 "data":{"jobId":"pwsh-bd974bdc3d154bce","owner":"session-851b…","kind":"pwsh","label":"…",
         "startedAt":1792746034211,"toolCall":{"callId":"…","rootCallId":"…"},
         "finishedAt":1792746041896,"status":"completed","cause":"producer",
         "producerReported":true,"detail":"exit code: 0"}}
```

`compaction/*` — no instance in the available logs; shapes are from the declaration above.
For mobile map them to `notice` only (never forward `summary` content):
`compaction/start → {text:"Compacting history…",level:"info"}`, `compaction/end` (no
`error`) `→ {text:"Compaction finished"}` or with `error` `→ {text:"Compaction failed:
"+error, level:"warn"}`, `compaction/prune → {text:"Trimmed tool output", level:"info"}`.

### 10.2 Proposed compact projection (matches docs/mobile-api.md §5)

| durable `type` | mobile `k` | `d` built from | drop |
|---|---|---|---|
| `user/message` | `user/message` | `text` = join text blocks; `attachments` = content blocks of type image/file (v1: count only) | `source`, `id`, `role`, blocks | 
| `assistant/message` | `assistant/message` | `text` = join text blocks; `toolCalls` = tool-call blocks as `{callId,name,argsPreview}` | `stream`, `replayState`, `usage` (optional `tokens` if UI shows it) |
| `tool/call` | `tool/call` | `callId`, `name`, `argsPreview` (≤2 K), `truncated` | `turn`, `step` |
| `tool/result` | `tool/result` | `callId`, `ok`, `textPreview` (≤2 K), `truncated`, `code?` | `message.id`, `content` beyond preview, `meta` (whitelist sources if wanted) |
| `turn/start` | `turn/start` | `turnId:String(turn)` | — |
| `turn/end` | `turn/end` | `turnId`, `reason:reason.kind` | `error` details (map to `k:"error"`) |
| `step/start`,`step/end` | `step/start`,`step/end` | `stepId:"t:s"`, `index:step` | — (could be omitted entirely; the UI only needs turn boundaries) |
| `approval/asked` | `approval/request` | `approvalId:id`, `title:toolName`, `detail:reason`, `options:["allow","deny"]` | `callId` |
| `approval/decided` | `approval/resolved` | `approvalId:id`, `decision` mapped | — |
| `session/title` | `session/title` | `title` | `messageSeqs`, `source` |
| `assistant/attempt` | `error` | `failure.message`, `failure.code` from the last `finish` chunk | `stream` |
| `llm/retry` | `error`/`notice` | `failure.message/code`, `retry/maxRetries` | `policyKey` |
| `compaction/*` | `notice` | text by kind | all payload |
| `command/done` | `notice` | `text`, level from `kind` | `commandId` |
| `job/registered`/`job/settled` | optional | `{id,kind,status,label}` for a jobs strip | `toolCall`, `cause` |
| anything else | — | **skip silently** (do not forward system/developer/request/* etc.) | all |

Deduplicate by `seq` client-side (contract rule); a repeated `seq` is allowed after a
gateway restart.

---

## 11. Token-cost hazard list

Everything in §3–§4 is zero-token by construction: the projection registry, persistence
reads, list, page, inspect, `observeSession`, `sessionProjections.snapshot`, workspace and
job snapshots never reach an LLM.

Calls that **can spend tokens** or cause model work:

| Call / action | Cost | Why |
|---|---|---|
| `sessionController.prompt` / `agent.followup` / `agent.steer` / `agent.inject` | model request(s) | wakes the agent loop; `followup` starts a turn; `steer`/`inject` become model history (`dsh-agent\README.md:139-152`) |
| first prompt of a session (only through the prompt path) | +1 auxiliary title LLM request | `session-title-first-prompt-llm` is mounted (`dsh-base\cordis.patch.yml:67`, `dsh-session-title\README.md:57`) — unavoidable, but never triggered by reads |
| `ctx.sessionTitle.refresh(session)` | +1 title LLM request | `dsh-session-title\lib\index.js:319`; never expose from mobile |
| `ctx.commands` user commands (`/compact`, `/goal`, …) | compaction/goal model calls | command execution is model work (`command/run`/`command/done` events) |
| `ctx.compaction*` / `agent.runMaintenance` | compaction model call | explicit maintenance; not used by the gateway |
| answering a **continued** user question via `ctx.userQuestions.answer` | tokens on the next model step | it steers a model-visible reply (`dsh-user-questions\lib\index.js:561-582`) |
| answering an **open** question via the waterfall | no direct tokens (the waiting agent continues) | the answer becomes tool output |
| approvals | no tokens | audit only; the tool proceeds/aborts |
| `ctx.approval.setPolicy(agent,'never'|'ask')` | tokens | queues a model-visible user message (`dsh-user-approval\lib\index.js:98-109`) |
| `sessionController.create` | none immediately (agent created, idle) | no model request until a prompt (`dsh-agent\README.md:43`) |
| `sessionController.fork` | none | copies events; no agent |
| `agents.resume` (also via prompt/rename/updateQueue/follow-cold) | **no tokens**, but durable writes + repair events + write lock | §2.2, §8.3 |
| `sessionController.list/page/inspect/projections` | none, no writes | §2.3 |
| `sessionController.follow` on a cold session | no tokens, **but resumes & repairs** | §2.2 |
| `sessionQuery.readSession/readSurface/filterEvents/traceEvent` | none, O(n) log replay | `dsh-session-query\README.md:151` |
| `sessionTitle.get/foldSessionTitle` | none | pure fold |
| model catalog (`modelCatalog`, `resolveModelInfo`) | none | registry read |

Also token-neutral but potentially destructive: anything that appends to the log via
resume; `cancel` (aborts turn, keeps queue); `updateQueue` (durable inbox edit);
`rename` (title event, but resumes a cold session).

Hard rules for `dsh-mobile` (echoing contract §6, now backed by code):
1. never call `refresh()`/`setPolicy`/commands/compaction from the gateway;
2. never `follow` a cold session; never `rename` as a side effect of viewing;
3. prompt only on explicit user action, one requestId per tap;
4. list/stream from projections + bus, never from full-log reads on a timer.

---

## 12. Recommended mobile gateway design

Mapping of the contract to service calls. `Bridge` below is the in-process module; it must
be created only if the services are present (`ctx.get('sessionController')`,
`ctx.get('sessionQuery')`, `ctx.get('sessions')`, `ctx.get('agents')`,
`ctx.get('sessionProjections')`, `ctx.get('sessionTitle')` optional, `ctx.get('approval')`,
`ctx.get('userQuestions')`, `ctx.get('workspaceRegistry')`, `ctx.get('jobs')`).
Use `ctx.get(key)` (not `ctx[key]`) so an absent optional service is `undefined` rather
than throwing during composition.

### 12.1 Endpoint → call map

| Endpoint | Implementation | Notes |
|---|---|---|
| `GET /hello` | probe services; `capabilities.attachments=false`; `limits.maxPromptChars` from config | `protocol:1` |
| `GET /sessions` | §3.2 snippet: `sessionQuery.listSessions` + projection registry/cache + `workspaceRegistry` | cache the compact rows; refresh on `session/event`(user/message), `session/title`, `agent/status`, `sessionProjections.onChanged`; `q=` local filter; `removed` = ids seen before but no longer visible |
| `GET /sessions/{id}` | `observeSession(id,{projectionMode:'all'})` → `pageWindow(obs.events, obs.cursor+1, …)`; `projections = obs.projections`; `running/queue` from live agent when `source==='live'`; pending question from projections; pending approval fold | queue = `projections.values.inbox['next-turn']` mapped to `{id, text}` (drop `content` blocks/source except `rpcId`); keep the observation lease in the open-session cache (LRU by device); `cursor = obs.cursor`; `hasOlder = cut > 0` |
| `GET /sessions/{id}/older` | slice the cached observation's events with `pageWindow(events, beforeSeq, …)` | if the observation was released, re-observe (cold: cached by revision) |
| `GET /sessions/{id}/stream` | §4.4: subscribe `session/event` + `agent/assistant-stream` first, then observe + window, then drain buffer; `live` frames from `text-delta`; `state` from running/queue/pending; `ping` timer; `resync` on bus gap or on client cursor older than the per-session ring | never `follow`; close both listeners on SSE close |
| `POST /sessions/{id}/prompt` | `sessionController.prompt({requestId, sessionId, mode: contractMode==='steer'?'steer':'queue', content:[{type:'text',text}], clientTimeZone?}, signal)` | dedupe at gateway by `requestId` too (cheap; Host also dedupes via `source.rpcId`); respond `{accepted:true, requestId, seq}` where `seq` is the `user/message` seq observed on the bus (wait for it, ≤2 s) or omit; 409 `agent-busy` when live agent missing? no — Host resumes, so only real errors |
| `POST /sessions/{id}/cancel` | §5.2 `cancelScope` | `turn`: Host cancel; `queue`: updateQueue removes; `all`: both; if no live agent: `turn` → `ok` (nothing running), `queue`/`all` → `ok` (nothing to clear) |
| `POST /sessions/{id}/approval` | resolve the pending waterfall entry (§6.2/6.3) | 404 `approval-unknown` when no pending entry or wrong id; reject `remember` as `unsupported` |
| `POST /sessions/{id}/question` | if pending waterfall entry for that callId → resolve with `{answers}`; else `ctx.userQuestions.answer(liveAgent, callId, {answers})` (resume first if needed) | answer validation: every question id exactly once (`BAD_ANSWER`); `REPLY_QUEUED` → 409 |
| `POST /sessions` | resolve workspace (body `workspaceId` or first/last workspace) → `sessionController.create({workspaceId})` → build the summary row from the response | returns `{session: row}`; do not prompt automatically |
| `POST /sessions/{id}/read` | gateway-side per-device map `lastSeenSeq` (persist in the plugin's storage) | no DSH API |
| `GET /workspaces` | `workspaceRegistry.list()` + `archivedSessionIds` (§9.1) | sync, cheap |
| `GET /jobs` | union `ctx.jobs.list(sessionId)` over live sessions (+ `ctx.jobs.list()` unowned) | sync, cheap; include `sessionId: job.owner ?? null` |
| `POST /jobs/{id}/kill` | `ctx.jobs.kill(jobId, sessionId, 'cancelled by the user')` | `{ok:true}`; 404 `job/not-found` when `expect` throws |
| `GET /m/pair*`, static | served on the DSH loopback server via `ctx.webServer`, not here | see plugin-authoring research |

### 12.2 What to cache in the gateway (all zero-token)

- **Compact session rows** (§3.2), refreshed by the bus events listed in §3.6; TTL-free.
- **Open-session entries** keyed `(deviceId, sessionId)`: observation lease or event array
  + last window, `cursor`, `pendingApprovals` map, `pendingQuestion` callIds, recent-event
  ring (for reconnect deltas), last `lastText` for list enrichment.
- **Approval id ⇄ waterfall promise** map (§6.3), plus `displayReason` per id.
- **Question callId ⇄ waterfall promise** map (§7.2), plus waiting `timeoutMs`.
- **Per-device cursors** for reconnect (`stream?cursor=N`) and `read` markers.
- Never cache `assistant` streaming chunks for replay; never cache prompt bodies beyond
  idempotency (requestId set with TTL).

### 12.3 SSE algorithm (contract §4.3)

```text
on open (device, sessionId, cursor?):
  attach bus listeners
  obs = observeSession(id, {projectionMode:'all'})
  window = pageWindow(obs.events, obs.cursor+1, maxMessages, turnWindow)
  send hello {sessionId, cursor: obs.cursor, running}
  send delta {from: window[0]?.seq ?? obs.cursor+1, events: window.map(project)}
  lastSent = obs.cursor ; drain bus buffer (seq <= lastSent: drop; seq === lastSent+1: delta)
  loop: bus event -> if session matches -> buffer/delta; assistant stream text-delta -> live frame
        every 15 s -> ping; state frame on running/queue/pending changes
  on close: dispose listeners + observation lease
on client reconnect cursor=N:
  if N >= ring.firstSeq -> replay ring seq>N as delta, then live
  else -> send resync, client re-runs GET /sessions/{id}
```

`state` frames: `{running, status, queue, pendingApproval:{approvalId,title,detail}|null,
pendingQuestion:{callId,questions}|null}` — all derivable from the same projections/buses.

### 12.4 Byte budget notes

- A `SessionSummary` row ≤ ~400–700 B; strip `projections` entirely.
- Opening window: 40 messages + tool cards ≤ ~15 KB gzip as the contract assumes (real
  `tool/result` texts are the main weight — always truncate to 2 KB per event).
- Delta per turn: forward only the projection table of §10.2; do not forward
  `assistant.message.stream` (1–5 KB per assistant message) or `request/header`
  (tool schemas can be 5–20 KB per event — see the real example: one such event in the
  logs carries several KB; `request/header` and `system/message` must never reach the phone).
- Never forward `system/message`, `developer/message`, `request/header`, `request/context`,
  `assistant.message.stream`, `agent/inbox/spliced.inserted` (duplicates user messages!),
  `tool-result.context` full bodies.

Important subtlety: `agent/inbox/spliced` **inserts** copies of user messages into the
inbox and then claim splices remove them; after admission the durable `user/message`
appears. If the gateway forwards both inbox splices and `user/message`, the phone would
see duplicates. The projection table above skips `agent/inbox/spliced`; instead render
optimistic bubbles from the prompt response and reconcile with `user/message.source.rpcId`.

### 12.5 Approvals/questions/steering from the phone — summarized decision

- Approvals: intercept `approval/request` with `{prepend:true, global:true}` only for
  sessions a device is streaming; race `next()` + mobile answer + timeout (§6.2). The
  durable `approval/asked|decided` pair drives the UI and late joiners.
- Questions: same waterfall interception for `open`; `ctx.userQuestions.answer` for
  `continued` (after a resume; costs tokens by design — it is a model-visible reply).
- Steering: only when `agent.status==='running'`; otherwise send `queue` mode.

### 12.6 Bridge-interface notes for `packages/dsh-mobile/src/session-bridge.js`

The HTTP layer already defines the bridge contract
(`packages/dsh-mobile/src/routes.js` `@typedef SessionBridge`, lines 45-57) and
idempotency-wraps `prompt`/`createSession` (`routes.js:486,348`). Per method:

| Bridge method | In-process implementation notes |
|---|---|
| `listSessions()` | §3.2. Return non-archived rows only (or add an `archived` flag and change `routes.js:327`, which currently tests `status==='archived'` — that value is not in the contract's status enum). `lastText`/`lastRole` stay `null` until cached; `eventCount`/`cursor` nullable for cold rows. |
| `openSession(id,{turns,before,maxEvents})` | `observeSession` + `pageWindow`; `pendingApproval` from the gateway map/fold, `pendingQuestion` from `userQuestions.active[0]`; `queue` = inbox projection `next-turn` items `{id,text}`. |
| `olderEvents(id,{before,turns,maxEvents})` | slice the cached observation (§4.3); if the lease was released, re-observe and slice. |
| `followSession(id,cursor,emit)` | §4.4; supported `emit` kinds are `delta`, `live`, `state`, `approval`, `resync` (`routes.js:430-455`). Use `emit('approval', {approvalId,title,detail,options:[…]})` when the waterfall intercepts; `emit('state',…)` on running/queue changes; `emit('resync',{reason:'gap'})` on a bus gap. |
| `prompt(id,{text,mode,requestId})` | Host returns only `{accepted:true}`; derive `seq` by awaiting the `user/message` whose `data.source.rpcId === requestId` on the bus (2 s cap; fall back to `lastCursor+1`). The HTTP layer already dedupes the same `requestId`, and the Host dedupes by `rpcId` too. |
| `cancel(id,scope)` | §5.2 mapping. |
| `answerApproval(id,{approvalId,decision,remember})` | resolve the intercepted waterfall promise for that approval id; `remember:true` → throw a typed `unsupported` error (no allow-always in DSH). If there is no live pending entry (e.g. the GUI is holding it because the gateway did not prepend), return `approval-unknown`. |
| `answerQuestion(id,{questionId,answer})` | the bridge payload carries a single question id and answer text, while DSH keys by **callId** and takes `{answers:[{id,selected:string[],custom?}]}`. Keep the `callId` in the question card shown by the phone and either embed it in `questionId` (`"<callId>/<questionId>"`) or widen the bridge payload to `{callId, questionId, answer, selected?}`. Single-select: `selected:[answer]`; free text: `custom:answer, selected:[]`; multi-select: `selected:[...]`. For `state:'continued'` call `ctx.userQuestions.answer(...)`; for `state:'open'` resolve the waterfall. |
| `listWorkspaces()` | `workspaceRegistry.list()` + `archivedSessionIds` (§9.1). |
| `listJobs()` / `killJob(id)` | `ctx.jobs.list(sessionId)`, `ctx.jobs.kill(jobId, sessionId, 'cancelled by the user')` (§9.2). |
| `dispose()` | remove bus listeners, release observation leases, clear approval/question pending maps. |

The bridge must be created lazily/via `ctx.get(...)` so a composition without the web
bundle reports `unsupported` instead of failing plugin load.

---

## 13. Reading the durable log from disk (pure-reader option)

If the gateway ever prefers a read-only path that bypasses the Session store entirely
(e.g. for a second process), the on-disk contract is:

- Root: `dshHomePath('sessions')` (default `C:\Users\<user>\.dsh\sessions`; configured at
  `dsh-base\cordis.patch.yml:138-139`).
- Per **project directory**: `--<projectKey(cwd)>--`, where `projectKey` replaces every run
  of `/`, `\`, `:` with one `-`, percent-encodes any other unsafe character as `~XXXX`
  (uppercase hex of the UTF-16 code unit), wraps the result in `--…--`, caps it at 251
  characters, and uses `_no-cwd` when the header has no `cwd`
  (`P dsh-session-persistence-jsonl\lib\index.js:880-909`). Example:
  `--C-Users-<user>-Documents-deepseek-harness-harness--`.
- Per **session directory**: `sessionDir = projectDir/<encodeSegment(sessionId)>`; artifact
  `session.v4.jsonl.zstd` (`generationLogPath`, `:919-943`; filename convention shared with
  export/fixtures: `session[.vN].jsonl`, `dsh-session-format\lib\index.js` filename module).
- File = concatenated independent **zstd frames**, each frame one or more JSONL records
  (header frame first: exactly one line; then batches per append/flush). The first line is
  the header record, not an event:
  `{"type":"session","version":4,"id":"session-…","createdAt":1792745782320,
   "cwd":"C:\\…","isSeeded":false,"delegationDepth":0,"agentPreset":"standard"}`.
- Multi-frame decoding: Node's `zstdDecompressSync` stops after the first frame. Scan
  frames with the structure walker from the backend (magic `0x28 0xB5 0x2F 0xFD`,
  frame header flags, 3-byte block headers) and decompress each frame separately; a torn
  final frame is a crash tail (ignore it or use the backend's prefix recovery).
  `P dsh-session-persistence-jsonl\lib\index.js:1293-1367` (`scanZstdFrames`),
  `:1382-1384` (`decompressZstdFrame`).

```js
// zero-dependency multi-frame reader (verified against all 22 logs on this machine)
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
const MAGIC = 0xFD2FB528   // readUInt32LE LE magic
function frames(buf) {
  const out = []; let o = 0
  while (o < buf.length) {
    const start = o
    if (buf.length - o < 4) return { out, torn: start }
    if (buf.readUInt32LE(o) !== MAGIC) throw new Error(`bad zstd magic at ${o}`)
    o += 4
    if (o === buf.length) return { out, torn: start }
    const d = buf.readUInt8(o); o += 1
    if ((d & 24) !== 0) throw new Error('reserved zstd bit')
    const csFlag = d >>> 6, single = (d & 32) !== 0, checksum = (d & 4) !== 0, df = d & 3
    const dictBytes = df === 3 ? 4 : df
    const csBytes = csFlag === 0 ? (single ? 1 : 0) : 1 << csFlag
    const rem = (single ? 0 : 1) + dictBytes + csBytes
    if (buf.length - o < rem) return { out, torn: start }
    o += rem
    for (;;) {
      if (buf.length - o < 3) return { out, torn: start }
      const bh = buf.readUIntLE(o, 3); o += 3
      const last = (bh & 1) !== 0, type = (bh >>> 1) & 3, size = bh >>> 3
      const payload = type === 1 ? 1 : size
      if (buf.length - o < payload) return { out, torn: start }
      o += payload
      if (last) break
    }
    if (checksum) { if (buf.length - o < 4) return { out, torn: start }; o += 4 }
    out.push({ start, end: o })
  }
  return { out }
}
export function readEvents(file) {
  const buf = readFileSync(file)
  const { out, torn } = frames(buf)
  const text = out.map(f => zstdDecompressSync(buf.subarray(f.start, f.end))).join('')
  return { header: JSON.parse(text.slice(0, text.indexOf('\n'))), torn: torn !== undefined,
           events: text.split('\n').slice(1).filter(Boolean).map(JSON.parse) }
}
```

Ordering/seq: records are append-only, `seq` dense from 0 across the whole logical log
(header excluded). A torn tail is never returned by the Host backend; a raw reader may see
a torn final frame (all 22 local logs decoded cleanly with the code above; one 1.8 MB
session had 249 frames).

Format migration: `stat`/`list` report `formatStatus` `'migration-required'` when the file
is an older adjacent version (`session.v3.jsonl.zstd`, etc.). The Host migrates on
write-open through `session-format-catalog` and the `v3→v4` edge
(`dsh-session-format-v3-to-v4\lib\index.js`); a raw reader must not interpret v3 content
as v4. Current `SESSION_FORMAT_VERSION = 4` and the header carries `version: 4`.
Do not write: even "reading with repair" is the Host's job (`interruptedTurnClosers` are
appended by resume, not by readers — `dsh-session-query` balances cold logs **in memory**,
`dsh-session-persistence\README.md:61`).

This path is only worth it if you need a second OS process without a Cordis plugin; inside
the plugin, `sessionQuery`/`observeSession` is strictly better (validation, projection
cache, in-memory crash balancing, no parse of every header yourself).

---

## 14. What could not be verified

1. **Approval/question stealing behavior at runtime.** The ordering analysis
   (`prepend` before the GUI bridge; waterfall outermost-first) is code-derived; we did
   not boot the GUI and answer an approval from a second listener. Also unverified:
   whether a pending forwarded `approval/request` with **no** connected browser page
   ever settles (code suggests it does not; see §6.2). Test on the isolated 18080 instance
   before trusting mobile approvals.
2. **`displayReason` localization map content** — declared, no real example captured.
3. **Compaction event payloads** — no real examples in the available logs; shapes come
   from the generated declaration only.
4. **`eventCount` for cold sessions** — the seam type has an optional field but the
   shipped JSONL backend never populates it (verified by reading `stat`/`list`); a future
   backend may. Treat as nullable.
5. **`defaultWorkspaceId` public getter** — the durable state has it, the README excerpt
   we read does not document a getter; not verified on a live `workspaceRegistry` object.
6. **`ctx.agents.resume` option object for a plain plugin** — the controller passes
   `{resumeSessionId, agentOptions:{provider,model}, setup}`; a plugin calling resume
   without `setup` should work (setup is optional in `ResumeAgentOptions`) but this was
   not exercised.
7. **`sessionController.*` methods are Typert Remote methods** whose direct-call argument
   validation is the Zod schema used at the Remote boundary. Calling them in-process with
   the documented request objects is what `ctx.sessionController` exports, but only the
   Remote path was verified by schema; the in-process path is exercised by other in-app
   callers (e.g. file-upload resolver, `resolveAgent`), which supports the assumption.
8. **Token accounting of `answer()` for continued questions** — inferred from
   `agent.steer(user message)`; the exact next-step token delta was not measured.
9. **Multiple simultaneous approvals in one turn** (parallel tool calls): the correlation
   heuristic (latest undecided `approval/asked` matching `callId`+`toolName`) is sound
   because `callId` is unique per tool call, but it was not loaded with 2+ concurrent
   approvals.
10. **Windows path canonicalization for the per-project session directory** — matched
    locally by inspection, not by reading every line of the canonicalizer.
