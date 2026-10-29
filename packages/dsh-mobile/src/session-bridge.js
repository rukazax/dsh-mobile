/**
 * In-process bridge from the mobile protocol to DeepSeek Harness services.
 *
 * Everything the phone reads comes from durable Session events that already
 * exist on the host. Opening a session reads one history window through
 * `sessionQuery.observeSession` (cold-safe: it never promotes an Agent and never
 * writes), and live updates come from the root Session event bus.
 *
 * The bridge deliberately avoids `sessionController.follow()`: that path
 * promotes a cold session into a live Agent (allocating model context and
 * appending crash-repair events). The mobile client must be a pure observer.
 * Prompts are the only operation that activates an Agent, exactly like the
 * desktop GUI.
 *
 * @module dsh-mobile/src/session-bridge
 */

import { randomToken, truncate } from './util.js';

/** Tool output and argument previews are capped before leaving the host. */
const PREVIEW_LIMIT = 1024;
/** An approval relayed to the phone settles on its own after this long. */
const APPROVAL_TIMEOUT_MS = 120_000;
/** Event types the host counts as messages when cutting a history window. */
const MESSAGE_TYPES = new Set(['user/message', 'assistant/message']);
/** Event types that carry no value for the mobile transcript. */
const DROPPED_EVENTS = new Set([
  'request/header',
  'request/context',
  'system/message',
  'developer/message',
  'assistant/attempt',
  'approval/asked',
  'approval/decided',
  'approval/policy',
  'model/selection',
  'permission/preset',
  'sandbox/mode',
  'agent/inbox/spliced',
  'session/end-seed',
  'session/title-llm-request',
  'session-log-deepseek/delivery-accepted',
  'feedback/message-put',
  'feedback/message-delete',
  'feedback/record',
  'hook/invoked',
  'hook/result',
  'image/offload',
  'subagent/catalog',
  'subagent/descriptor',
  'subagent/model-selection-policy',
  'team/member',
  'team/message/queued',
  'team/message/delivered',
  'team/task',
  'todo/write',
  'workspace/changes',
  'working-directory/change',
  'job/registered',
  'job/settled',
  'schedule/change',
  'goal/change',
  'compaction/prune',
  'compaction/summary',
  'command/run',
  'command/done',
  'deliverables/presented',
  'tool/ptc-dispatch',
  'tool/ptc-dispatch-start',
  'tool-workflow/agent-start',
  'tool-workflow/agent-end',
  'tool-workflow/run-start',
  'tool-workflow/run-end',
  'web/deepseek-search-llm-request',
]);

/**
 * Read a host service without throwing when the composition does not mount it.
 * @param {any} ctx
 * @param {string} key
 * @returns {any}
 */
function service(ctx, key) {
  try {
    if (typeof ctx.get === 'function') return ctx.get(key);
  } catch {
    /* fall through to the property probe */
  }
  return ctx[key];
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function asSeq(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * @param {unknown} time
 * @returns {string}
 */
function isoTime(time) {
  if (typeof time === 'number' && Number.isFinite(time)) return new Date(time).toISOString();
  if (typeof time === 'string') return time;
  return new Date().toISOString();
}

/**
 * Flatten a message content block array into plain text.
 * @param {unknown} content
 * @returns {string}
 */
function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    const record = /** @type {Record<string, unknown>} */ (block);
    if (record.type === 'text' && typeof record.text === 'string') parts.push(record.text);
    else if (record.type === 'image') parts.push('[изображение]');
    else if (record.type === 'file') parts.push(`[файл ${String(record.name ?? '')}]`);
  }
  return parts.join('\n');
}

/**
 * Pull a chat message out of an event payload that may be the message itself,
 * a wrapper with `.message`, or a tool result envelope.
 * @param {Record<string, unknown>} data
 * @returns {Record<string, unknown> | undefined}
 */
function messageOf(data) {
  if (data !== null && typeof data === 'object') {
    const wrapped = /** @type {Record<string, unknown>} */ (data).message;
    if (wrapped !== null && typeof wrapped === 'object') return /** @type {Record<string, unknown>} */ (wrapped);
    if (typeof data.role === 'string' || Array.isArray(data.content)) return data;
  }
  return undefined;
}

/**
 * @param {unknown} value
 * @param {number} limit
 * @returns {{ text: string, truncated: boolean }}
 */
function truncateSafe(value, limit) {
  let text;
  if (typeof value === 'string') text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  if (typeof text !== 'string') text = '';
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit - 1)}…`, truncated: true };
}

/**
 * Tool-call blocks embedded in an assistant message.
 * @param {Record<string, unknown> | undefined} message
 * @returns {Array<{ callId: string, name: string, argsPreview: string, truncated: boolean }>}
 */
function toolCallsOf(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return [];
  const calls = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    const record = /** @type {Record<string, unknown>} */ (block);
    if (record.type !== 'tool-call' && record.type !== 'tool_use') continue;
    const preview = truncateSafe(record.arguments ?? record.input ?? {}, 800);
    calls.push({
      callId: String(record.id ?? ''),
      name: String(record.name ?? 'tool'),
      argsPreview: preview.text,
      truncated: preview.truncated,
    });
  }
  return calls;
}

/**
 * Project one durable Session event into the compact mobile wire shape.
 * Returns `null` for events the phone does not need.
 *
 * @param {{ seq: number, type: string, time?: number, data?: any }} event
 * @returns {{ seq: number, t: string, k: string, d: Record<string, unknown> } | null}
 */
export function projectEvent(event) {
  if (event === null || typeof event !== 'object') return null;
  const type = String(event.type ?? '');
  if (DROPPED_EVENTS.has(type)) return null;
  const data = event.data !== null && typeof event.data === 'object' ? event.data : {};
  const seq = asSeq(event.seq) ?? 0;
  const base = { seq, t: isoTime(event.time) };

  switch (type) {
    case 'user/message': {
      const message = messageOf(data) ?? {};
      return { ...base, k: 'user/message', d: { text: contentText(message.content) } };
    }
    case 'assistant/message': {
      const message = messageOf(data);
      const toolCalls = toolCallsOf(message);
      return {
        ...base,
        k: 'assistant/message',
        d: {
          text: contentText(message?.content),
          ...(toolCalls.length === 0 ? {} : { toolCalls }),
        },
      };
    }
    case 'tool/call': {
      const preview = truncateSafe(data.arguments ?? {}, 600);
      return {
        ...base,
        k: 'tool/call',
        d: {
          callId: String(data.callId ?? ''),
          name: String(data.name ?? 'tool'),
          argsPreview: preview.text,
          truncated: preview.truncated,
        },
      };
    }
    case 'tool/result': {
      const message = messageOf(data);
      const preview = truncateSafe(contentText(message?.content), PREVIEW_LIMIT);
      const failed = data.error !== undefined || message?.isError === true;
      return {
        ...base,
        k: 'tool/result',
        d: {
          callId: String(data.callId ?? message?.callId ?? ''),
          ok: !failed,
          textPreview: preview.text,
          truncated: preview.truncated,
        },
      };
    }
    case 'turn/start':
      return { ...base, k: 'turn/start', d: { turn: String(data.turn ?? '') } };
    case 'turn/end': {
      const reason = data.reason;
      const kind = reason !== null && typeof reason === 'object' ? String(reason.kind ?? '') : String(reason ?? '');
      const detail =
        reason !== null &&
        typeof reason === 'object' &&
        reason.kind === 'error' &&
        reason.error !== null &&
        typeof reason.error === 'object'
          ? truncate(String(reason.error.message ?? ''), 300)
          : '';
      return {
        ...base,
        k: 'turn/end',
        d: { turn: String(data.turn ?? ''), reason: kind, ...(detail === '' ? {} : { detail }) },
      };
    }
    case 'step/start':
      return { ...base, k: 'step/start', d: { step: `${String(data.turn ?? '')}.${String(data.step ?? '')}` } };
    case 'step/end':
      return { ...base, k: 'step/end', d: { step: `${String(data.turn ?? '')}.${String(data.step ?? '')}` } };
    case 'session/title':
      return { ...base, k: 'session/title', d: { title: truncate(String(data.title ?? ''), 200) } };
    case 'compaction/start':
      return { ...base, k: 'notice', d: { level: 'info', text: 'Сжатие контекста…' } };
    case 'compaction/end':
      return { ...base, k: 'notice', d: { level: 'info', text: 'Контекст сжат' } };
    case 'llm/retry':
    case 'llm/retry-started':
      return { ...base, k: 'notice', d: { level: 'warn', text: 'Повтор запроса к модели…' } };
    case 'plan/mode':
      return {
        ...base,
        k: 'notice',
        d: {
          level: 'info',
          text: data.enabled === true || data.mode === 'plan' ? 'Режим плана включён' : 'Режим плана выключен',
        },
      };
    default:
      // Unknown plugin events stay out of the mobile transcript; the durable
      // cursor advances regardless.
      return null;
  }
}

/**
 * @param {any} row list row from `sessionController.list`
 * @returns {string}
 */
function workspaceNameOf(row) {
  const cwd = typeof row.cwd === 'string' ? row.cwd : '';
  if (cwd === '') return '';
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? cwd;
}

/**
 * @param {any} row
 * @returns {Record<string, any> | undefined}
 */
function projectionValues(row) {
  const projections = row?.projections;
  if (projections === null || typeof projections !== 'object') return undefined;
  const values = /** @type {Record<string, any>} */ (projections).values;
  if (values === null || typeof values !== 'object') return undefined;
  return values;
}

/**
 * Map one host list row to the mobile SessionSummary.
 * @param {any} row
 * @param {Map<string, any>} approvals
 * @returns {any}
 */
function summaryOf(row, approvals) {
  const values = projectionValues(row);
  const title = String(values?.title ?? values?.titleInput?.title ?? '').trim();
  const selection = values?.modelSelection;
  const updatedAt = typeof row.updatedAt === 'number' ? row.updatedAt : 0;
  const pending = approvals.get(String(row.sessionId ?? ''));
  return {
    id: String(row.sessionId ?? ''),
    title: title === '' ? 'Без названия' : truncate(title, 180),
    workspaceId: '',
    workspaceName: workspaceNameOf(row),
    cwd: typeof row.cwd === 'string' ? row.cwd : '',
    createdAt: isoTime(typeof row.createdAt === 'number' ? row.createdAt : updatedAt),
    updatedAt: isoTime(updatedAt),
    status: row.running === true ? 'running' : pending !== undefined ? 'blocked' : 'idle',
    model: String(selection?.lastUsed?.model ?? ''),
    parentSessionId: typeof row.parentSessionId === 'string' ? row.parentSessionId : null,
    lastText: '',
    lastRole: '',
    eventCount: typeof row.eventCount === 'number' ? row.eventCount : null,
    cursor: typeof row.cursor === 'number' ? String(row.cursor) : null,
    hasPendingApproval: pending !== undefined,
    hasPendingQuestion: false,
    formatStatus: String(row.formatStatus ?? 'ok'),
    blank: row.blank === true,
  };
}

/**
 * Cut one chronological window out of a durable event array.
 * Mirrors the Host's own `paginate` so a mobile window matches the desktop GUI:
 * the page ends at `before` (exclusive) and starts at a turn boundary once at
 * least `minMessages`/`minTurns` are covered.
 *
 * @param {any[]} events dense event array indexed by seq
 * @param {{ before?: number, maxMessages: number, minMessages: number, minTurns: number }} options
 * @returns {{ events: any[], hasMore: boolean }}
 */
function paginate(events, options) {
  const cursor = events.length === 0 ? -1 : Number(events.at(-1).seq ?? events.length - 1);
  const end = Math.min(options.before === undefined ? cursor + 1 : options.before, cursor + 1);
  let count = 0;
  let turns = 0;
  let cut = 0;
  for (let index = end - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined) continue;
    if (event.type === 'turn/start') {
      turns += 1;
      if (count >= options.minMessages && turns >= options.minTurns) {
        cut = index;
        break;
      }
    }
    if (!MESSAGE_TYPES.has(event.type)) continue;
    if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') continue;
    count += 1;
    const sources = event.sourceEventSeqs;
    let groupStart = event.seq;
    if (Array.isArray(sources)) {
      for (const source of sources) if (source < groupStart) groupStart = source;
    }
    if (count >= options.maxMessages) {
      cut = groupStart;
      break;
    }
  }
  return { events: events.slice(cut, end), hasMore: cut > 0 };
}

/**
 * Build the in-process bridge.
 * @param {{ ctx: any, config: import('./config.js').MobileConfig, logger: { info: Function, warn: Function, debug: Function } }} environment
 * @returns {Promise<any | undefined>}
 */
export async function createBridge({ ctx, config, logger }) {
  const controller = service(ctx, 'sessionController');
  if (controller === undefined || controller === null || typeof controller.list !== 'function') {
    logger.warn('dsh-mobile: sessionController is unavailable; session endpoints report "unsupported"');
    return undefined;
  }
  const sessionQuery = service(ctx, 'sessionQuery');
  const agents = service(ctx, 'agents');

  /** @type {Map<string, any>} */
  const summaryCache = new Map();
  /** @type {Map<string, any>} */
  const pendingApprovals = new Map();
  /** @type {Map<string, Set<(kind: string, payload: unknown) => void>>} */
  const listeners = new Map();
  /** @type {Set<() => void>} */
  const disposers = new Set();

  /**
   * @param {string} sessionId
   * @param {string} kind
   * @param {unknown} payload
   */
  function emit(sessionId, kind, payload) {
    const set = listeners.get(sessionId);
    if (set === undefined) return;
    for (const listener of set) {
      try {
        listener(kind, payload);
      } catch (error) {
        logger.warn(`dsh-mobile: stream listener failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /** @returns {boolean} */
  function hasLiveOwnerClient() {
    try {
      return service(ctx, 'typertGateway')?.hasLiveClient?.() === true;
    } catch {
      return true;
    }
  }

  /**
   * Observe one session's durable log without promoting it.
   * @param {string} sessionId
   * @param {boolean} withProjections
   * @returns {Promise<{ header: any, events: any[], cursor: number, projections?: any, dispose: () => void }>}
   */
  async function observe(sessionId, withProjections) {
    const signal = new AbortController().signal;
    if (sessionQuery !== undefined && sessionQuery !== null && typeof sessionQuery.observeSession === 'function') {
      const observation = await sessionQuery.observeSession(sessionId, {
        signal,
        projectionMode: withProjections ? 'all' : 'none',
      });
      const events = Array.isArray(observation.events) ? observation.events : [];
      const cursor =
        typeof observation.cursor === 'number' ? observation.cursor : events.length === 0 ? -1 : Number(events.at(-1).seq);
      return {
        header: observation.header ?? {},
        events,
        cursor,
        projections: observation.projections,
        dispose: () => {
          try {
            observation[Symbol.dispose]?.();
          } catch {
            /* best effort */
          }
        },
      };
    }
    const inspected = await controller.inspect(sessionId, signal);
    const events = Array.isArray(inspected?.events) ? inspected.events : [];
    return {
      header: inspected?.meta ?? {},
      events,
      cursor: events.length === 0 ? -1 : Number(events.at(-1).seq),
      projections: undefined,
      dispose: () => {},
    };
  }

  /**
   * @param {AbortSignal | undefined} signal
   * @returns {Promise<any[]>}
   */
  async function listRows(signal) {
    const result = await controller.list({}, signal);
    const rows = Array.isArray(result?.items) ? result.items : [];
    const registry = service(ctx, 'workspaceRegistry');
    const archived = new Set(Array.isArray(registry?.archivedSessionIds) ? registry.archivedSessionIds : []);
    summaryCache.clear();
    const mapped = [];
    for (const row of rows) {
      const summary = summaryOf(row, pendingApprovals);
      if (archived.has(summary.id)) summary.status = 'archived';
      summaryCache.set(summary.id, summary);
      mapped.push(summary);
    }
    return mapped;
  }

  /**
   * @param {string} sessionId
   * @returns {Promise<any | undefined>}
   */
  async function summaryFor(sessionId) {
    if (summaryCache.has(sessionId)) return summaryCache.get(sessionId);
    await listRows(undefined);
    return summaryCache.get(sessionId);
  }

  /**
   * @param {string} sessionId
   * @returns {{ running: boolean, queue: number, agentAvailable: boolean }}
   */
  function agentState(sessionId) {
    const agent = agents?.get?.(sessionId);
    if (agent === undefined || agent === null) return { running: false, queue: 0, agentAvailable: false };
    const queue =
      (Array.isArray(agent.inbox?.nextTurn) ? agent.inbox.nextTurn.length : 0) +
      (Array.isArray(agent.inbox?.nextStep) ? agent.inbox.nextStep.length : 0);
    return { running: agent.status === 'running', queue, agentAvailable: true };
  }

  /**
   * Read one history window and, when asked, enrich the cached summary with the
   * session's own header/projections (title, model, created time).
   *
   * @param {string} sessionId
   * @param {{ before?: string, turns: number, maxEvents: number, projections: boolean }} options
   */
  async function readWindow(sessionId, options) {
    const observed = await observe(sessionId, options.projections);
    const beforeSeq = options.before === undefined ? undefined : Number(options.before);
    const maxMessages = Math.max(1, options.maxEvents);
    const page = paginate(observed.events, {
      ...(Number.isSafeInteger(beforeSeq) && beforeSeq >= 0 ? { before: beforeSeq } : {}),
      maxMessages: Math.min(8, maxMessages),
      minMessages: Math.min(3, Math.min(8, maxMessages)),
      minTurns: Math.max(1, options.turns),
    });
    // One long turn can produce hundreds of events after a single message; the
    // phone gets a hard event cap so a cold open stays in the tens of kilobytes.
    let records = page.events;
    let hasMore = page.hasMore;
    if (records.length > maxMessages) {
      records = records.slice(-maxMessages);
      hasMore = true;
    }
    // A hard tail cut can drop the user message that started the visible work.
    // Recover the nearest preceding user/message (and a little context) so the
    // phone always opens on something the user actually said.
    if (records.length > 0 && !records.some((event) => event.type === 'user/message')) {
      const firstSeq = Number(records[0].seq ?? 0);
      for (let index = observed.events.length - 1; index >= 0; index -= 1) {
        const candidate = observed.events[index];
        if (candidate === undefined || Number(candidate.seq) >= firstSeq) continue;
        if (candidate.type !== 'user/message') continue;
        records = [...observed.events.slice(Math.max(0, index - 2), index + 1), ...records];
        hasMore = index > 2 || hasMore;
        break;
      }
    }
    const summary = summaryCache.get(sessionId);
    if (summary !== undefined && options.projections) {
      const values = observed.projections?.values ?? {};
      let title = String(values.title ?? '').trim();
      if (title === '') {
        for (let index = observed.events.length - 1; index >= 0; index -= 1) {
          const event = observed.events[index];
          if (event?.type !== 'session/title') continue;
          title = String(event.data?.title ?? '').trim();
          break;
        }
      }
      if (title !== '') summary.title = truncate(title, 180);
      const model = values.modelSelection?.lastUsed?.model;
      if (typeof model === 'string' && model !== '') summary.model = model;
      const createdAt = observed.header?.createdAt;
      if (typeof createdAt === 'number') summary.createdAt = isoTime(createdAt);
      if (typeof observed.header?.cwd === 'string' && observed.header.cwd !== '') {
        summary.cwd = observed.header.cwd;
        summary.workspaceName = workspaceNameOf(observed.header);
      }
      if (typeof observed.header?.parentSession === 'string' && observed.header.parentSession !== '') {
        summary.parentSessionId = observed.header.parentSession;
      }
    }
    return {
      records,
      hasMore,
      cursor: observed.cursor,
      dispose: observed.dispose,
    };
  }

  /**
   * @param {any[]} events
   * @returns {any[]}
   */
  function projectEvents(events) {
    const projected = [];
    for (const event of events) {
      const item = projectEvent(event);
      if (item !== null) projected.push(item);
    }
    return projected;
  }

  /**
   * @param {any} req approval/request payload
   * @param {() => any} proceed downstream waterfall continuation
   * @returns {Promise<any>}
   */
  async function handleApprovalRequest(req, proceed) {
    const agent = req?.agent;
    const sessionId = String(agent?.session?.id ?? agent?.id ?? '');
    if (sessionId === '') return proceed();
    const approvalId = `apr_${randomToken(8)}`;
    /** @type {any} */
    const pending = {
      approvalId,
      sessionId,
      toolName: String(req?.toolName ?? 'tool'),
      ...(typeof req?.callId === 'string' ? { callId: req.callId } : {}),
      ...(typeof req?.displayReason === 'string'
        ? { reason: req.displayReason }
        : typeof req?.reason === 'string'
          ? { reason: req.reason }
          : {}),
      createdAt: new Date().toISOString(),
    };
    const relay = config.approvals === 'relay' || (config.approvals === 'auto' && !hasLiveOwnerClient());
    if (!relay) {
      pendingApprovals.set(sessionId, pending);
      emit(sessionId, 'approval', { approval: { ...pending, answerable: false } });
      try {
        return await proceed();
      } finally {
        pendingApprovals.delete(sessionId);
        emit(sessionId, 'approval', { approval: null });
      }
    }

    pendingApprovals.set(sessionId, pending);
    emit(sessionId, 'approval', { approval: { ...pending, answerable: true } });
    const decision = await new Promise((resolve) => {
      pending.resolve = resolve;
      const timer = setTimeout(() => resolve('timeout'), APPROVAL_TIMEOUT_MS);
      if (typeof timer.unref === 'function') timer.unref();
      const signal = req?.signal;
      if (signal !== undefined && typeof signal.addEventListener === 'function') {
        if (signal.aborted) resolve('timeout');
        else signal.addEventListener('abort', () => resolve('timeout'), { once: true });
      }
    });
    pendingApprovals.delete(sessionId);
    emit(sessionId, 'approval', { approval: null });
    if (decision === 'allow') return 'allowed-once';
    if (decision === 'deny') return 'rejected';
    // Nobody answered: fail closed but keep the turn alive by withdrawing the
    // question instead of awaiting a desktop answerer that may not exist.
    return 'cancelled';
  }

  try {
    const disposeWatcher = ctx.on(
      'approval/request',
      (req, next) =>
        handleApprovalRequest(req, () => (typeof next === 'function' ? next() : Promise.resolve('unavailable'))),
      { prepend: true },
    );
    if (typeof disposeWatcher === 'function') disposers.add(disposeWatcher);
    logger.info(`dsh-mobile: approval mode "${config.approvals}" (relay only when the desktop GUI is not connected)`);
  } catch (error) {
    logger.warn(`dsh-mobile: cannot observe approvals: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    async listSessions() {
      return listRows(undefined);
    },

    async describeSession(sessionId) {
      const summary = await summaryFor(sessionId);
      return summary ?? null;
    },

    async openSession(sessionId, { turns, before, maxEvents }) {
      const window = await readWindow(sessionId, { turns, before, maxEvents, projections: true });
      try {
        const summary = await summaryFor(sessionId);
        if (summary === undefined) return { session: null };
        const state = agentState(sessionId);
        const pending = pendingApprovals.get(sessionId) ?? null;
        return {
          session: {
            ...summary,
            status: state.running ? 'running' : pending !== null ? 'blocked' : summary.status,
          },
          events: projectEvents(window.records),
          cursor: String(window.cursor),
          hasOlder: window.hasMore,
          running: state.running,
          queue: state.queue > 0 ? new Array(state.queue).fill(null) : [],
          pendingApproval: pending === null ? null : { ...pending, answerable: config.approvals !== 'observe' },
          pendingQuestion: null,
        };
      } finally {
        window.dispose();
      }
    },

    async olderEvents(sessionId, { before, turns, maxEvents }) {
      const window = await readWindow(sessionId, { turns, before, maxEvents, projections: false });
      try {
        return { events: projectEvents(window.records), hasOlder: window.hasMore };
      } finally {
        window.dispose();
      }
    },

    async followSession(sessionId, cursorRaw, sink) {
      const startCursor = Number.parseInt(String(cursorRaw), 10);
      let lastSeq = Number.isSafeInteger(startCursor) ? startCursor : -1;
      const set = listeners.get(sessionId) ?? new Set();
      set.add(sink);
      listeners.set(sessionId, set);

      const subscribe = [];
      const onEvent = (session, event) => {
        if (session?.id !== sessionId) return;
        const seq = asSeq(event?.seq);
        if (seq === undefined || seq <= lastSeq) return;
        if (seq !== lastSeq + 1) {
          sink('resync', { reason: 'gap', expected: lastSeq + 1, received: seq });
          lastSeq = seq;
          return;
        }
        lastSeq = seq;
        const projected = projectEvent(event);
        if (projected !== null) sink('delta', { events: [projected] });
      };
      const onAssistant = ({ agent, frame }) => {
        if (agent?.session?.id !== sessionId) return;
        if (frame === null || typeof frame !== 'object') return;
        if (frame.type === 'start') {
          sink('live', { attemptId: String(frame.attemptId ?? ''), revision: frame.revision, type: 'start' });
          return;
        }
        if (frame.type === 'end') {
          sink('live', {
            attemptId: String(frame.attemptId ?? ''),
            revision: frame.revision,
            type: 'end',
            outcome: frame.outcome?.kind ?? 'unknown',
          });
          return;
        }
        const chunk = frame.chunk;
        if (chunk === null || typeof chunk !== 'object') return;
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          sink('live', {
            attemptId: String(frame.attemptId ?? ''),
            revision: frame.revision,
            index: typeof frame.index === 'number' ? frame.index : undefined,
            blockIndex: typeof chunk.index === 'number' ? chunk.index : undefined,
            text: chunk.text,
          });
        }
      };
      const onStatus = ({ agent, status }) => {
        if (agent?.session?.id !== sessionId) return;
        sink('state', { running: status === 'running', status: status === 'running' ? 'running' : 'idle' });
      };
      const onCreated = (session) => {
        if (session?.id !== sessionId) return;
        sink('resync', { reason: 'session-attached' });
      };

      for (const [event, listener] of [
        ['session/event', onEvent],
        ['agent/assistant-stream', onAssistant],
        ['agent/status', onStatus],
        ['session/created', onCreated],
      ]) {
        const dispose = ctx.on?.(event, listener, { global: true });
        if (typeof dispose === 'function') {
          disposers.add(dispose);
          subscribe.push(dispose);
        }
      }

      return () => {
        set.delete(sink);
        if (set.size === 0) listeners.delete(sessionId);
        for (const dispose of subscribe) {
          try {
            dispose();
          } catch {
            /* ignore */
          }
          disposers.delete(dispose);
        }
      };
    },

    async prompt(sessionId, { text, mode, requestId }) {
      const signal = AbortSignal.timeout(60_000);
      await controller.prompt(
        {
          sessionId,
          content: [{ type: 'text', text }],
          requestId,
          ...(mode === 'steer' ? { mode: 'steer' } : {}),
        },
        signal,
      );
      return { requestId, seq: '-1' };
    },

    async cancel(sessionId, scope) {
      const agent = agents?.get?.(sessionId);
      if (scope === 'turn' || scope === 'all') {
        if (agent !== undefined && agent !== null) controller.cancel({ sessionId });
        else if (scope === 'turn') throw new Error(`session/not-found: session "${sessionId}" is not attached`);
      }
      if (scope === 'queue' || scope === 'all') {
        const items = [
          ...(Array.isArray(agent?.inbox?.nextTurn) ? agent.inbox.nextTurn : []),
          ...(Array.isArray(agent?.inbox?.nextStep) ? agent.inbox.nextStep : []),
        ];
        for (const item of items) {
          const itemId = item?.id;
          if (typeof itemId !== 'string') continue;
          try {
            await controller.updateQueue({ sessionId, itemId, action: { kind: 'remove' } });
          } catch (error) {
            logger.debug(
              `dsh-mobile: queue item ${itemId} not removable: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    },

    async createSession({ workspaceId }) {
      const target = typeof workspaceId === 'string' ? workspaceId.trim() : '';
      const looksLikePath = /^[A-Za-z]:[\\/]/.test(target) || target.startsWith('/') || target.startsWith('\\\\');
      const created = await controller.create(
        target === '' ? {} : looksLikePath ? { cwd: target } : { workspaceId: target },
      );
      const sessionId = String(created?.sessionId ?? created?.id ?? '');
      const summary = await summaryFor(sessionId);
      return summary ?? { id: sessionId, title: 'Новая сессия', status: 'idle' };
    },

    async answerApproval(sessionId, { approvalId, decision }) {
      const pending = pendingApprovals.get(sessionId);
      if (pending === undefined || pending.approvalId !== approvalId) {
        const error = new Error('approval-unknown: this approval is no longer pending');
        // @ts-ignore protocol code mapped by the router
        error.code = 'approval-unknown';
        throw error;
      }
      if (config.approvals === 'observe') {
        const error = new Error('approval-desktop-only: approvals are answered in the desktop GUI');
        // @ts-ignore
        error.code = 'approval-desktop-only';
        throw error;
      }
      pending.resolve?.(decision === 'allow' ? 'allow' : 'deny');
      return { ok: true };
    },

    async answerQuestion() {
      const error = new Error('unsupported: questions are answered in the desktop GUI');
      // @ts-ignore
      error.code = 'unsupported';
      throw error;
    },

    async listWorkspaces() {
      const registry = service(ctx, 'workspaceRegistry');
      const archived = new Set(Array.isArray(registry?.archivedSessionIds) ? registry.archivedSessionIds : []);
      try {
        if (registry !== undefined && registry !== null && typeof registry.list === 'function') {
          const workspaces = registry.list();
          if (Array.isArray(workspaces) && workspaces.length > 0) {
            return workspaces.map((workspace, index) => ({
              id: String(workspace.id ?? ''),
              path: String(workspace.path ?? ''),
              name: String(workspace.title ?? workspace.name ?? workspace.path ?? ''),
              isDefault: index === 0,
              sessionCount: Array.isArray(workspace.sessionIds)
                ? workspace.sessionIds.filter((id) => !archived.has(id)).length
                : 0,
            }));
          }
        }
      } catch (error) {
        logger.debug(
          `dsh-mobile: workspace registry read failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const paths = new Map();
      for (const summary of summaryCache.values()) {
        if (summary.cwd === '') continue;
        if (!paths.has(summary.cwd)) {
          paths.set(summary.cwd, {
            id: summary.cwd,
            path: summary.cwd,
            name: summary.workspaceName,
            isDefault: paths.size === 0,
            sessionCount: 0,
          });
        }
        paths.get(summary.cwd).sessionCount += 1;
      }
      return [...paths.values()];
    },

    async listJobs() {
      try {
        const jobs = service(ctx, 'jobs');
        if (jobs === undefined || jobs === null || typeof jobs.list !== 'function') return [];
        const list = await Promise.resolve(jobs.list());
        if (!Array.isArray(list)) return [];
        return list.slice(0, 50).map((job) => ({
          id: String(job.id ?? ''),
          sessionId: String(job.sessionId ?? job.owner?.sessionId ?? ''),
          kind: String(job.kind ?? 'job'),
          status: String(job.status ?? ''),
          title: String(job.label ?? job.title ?? job.kind ?? ''),
          startedAt: job.startedAt === undefined ? undefined : isoTime(job.startedAt),
        }));
      } catch (error) {
        logger.debug(`dsh-mobile: job listing failed: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
    },

    async killJob(jobId) {
      const jobs = service(ctx, 'jobs');
      if (jobs === undefined || jobs === null || typeof jobs.kill !== 'function') {
        const error = new Error('unsupported: job control is not wired in this version');
        // @ts-ignore
        error.code = 'unsupported';
        throw error;
      }
      const target = String(jobId);
      const list = await Promise.resolve(jobs.list?.());
      const job = Array.isArray(list) ? list.find((entry) => String(entry.id ?? '') === target) : undefined;
      await jobs.kill(target, String(job?.sessionId ?? job?.owner?.sessionId ?? ''), 'cancelled by the user');
    },

    async dispose() {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          /* ignore */
        }
      }
      disposers.clear();
      listeners.clear();
      pendingApprovals.clear();
      summaryCache.clear();
    },
  };
}

