/* DSH Mobile — IndexedDB cache.
 * Contract §7: sessions cache (≤200 rows), last 50 events per recent session,
 * per-session cursors, prompt drafts. Cold start renders from here before the
 * network answers; if IndexedDB is unavailable, an in-memory fallback keeps the
 * app usable in the current tab (private mode / hardened WebView).
 *
 * All transactions attach their requests synchronously inside one task — never
 * await unrelated promises between creating a transaction and using it.
 */

const DB_NAME = 'dshm';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';
const STORE_EVENTS = 'events';
const STORE_KV = 'kv';
const MAX_SESSIONS = 200;
const MAX_EVENTS = 50;
const SEQ_MAX = Number.MAX_SAFE_INTEGER;

let dbPromise = null;
const memory = {
  sessions: new Map(),
  events: new Map(), // sid -> Map(seq, event)
  kv: new Map(),
};

export function initDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        db.createObjectStore(STORE_EVENTS, { keyPath: ['sid', 'seq'] });
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: 'k' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

/** Read transaction; fn receives (tx, holder) and must attach requests sync. */
async function readTx(names, fn) {
  const db = await initDB();
  if (!db) return null;
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(names, 'readonly');
    } catch {
      resolve(null);
      return;
    }
    const holder = {};
    try {
      fn(tx, holder);
    } catch {
      resolve(null);
      return;
    }
    tx.oncomplete = () => resolve(holder.value);
    tx.onerror = () => resolve(null);
    tx.onabort = () => resolve(null);
  });
}

/** Write transaction; resolves true on commit. */
async function writeTx(names, fn) {
  const db = await initDB();
  if (!db) return false;
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(names, 'readwrite');
    } catch {
      resolve(false);
      return;
    }
    try {
      fn(tx);
    } catch {
      resolve(false);
      return;
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

function sortByUpdated(list) {
  return list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

/* ── sessions cache ────────────────────────────────────────────────── */

export async function readSessions() {
  const all = await readTx([STORE_SESSIONS], (tx, holder) => {
    const request = tx.objectStore(STORE_SESSIONS).getAll();
    request.onsuccess = () => {
      holder.value = request.result || [];
    };
  });
  const source = all || [...memory.sessions.values()];
  return sortByUpdated(source.slice()).slice(0, MAX_SESSIONS);
}

export async function cacheSessions(list) {
  const rows = (Array.isArray(list) ? list : []).slice(0, MAX_SESSIONS);
  const ok = await writeTx([STORE_SESSIONS], (tx) => {
    const target = tx.objectStore(STORE_SESSIONS);
    target.clear();
    for (const row of rows) target.put(row);
  });
  if (!ok) {
    memory.sessions.clear();
    for (const row of rows) memory.sessions.set(row.id, row);
  }
  return rows.length;
}

/* ── per-session events (last 50) ──────────────────────────────────── */

function eventRange(sid) {
  return IDBKeyRange.bound([sid, 0], [sid, SEQ_MAX]);
}

export async function readEvents(sid, limit = MAX_EVENTS) {
  const all = await readTx([STORE_EVENTS], (tx, holder) => {
    const request = tx.objectStore(STORE_EVENTS).getAll(eventRange(sid));
    request.onsuccess = () => {
      holder.value = request.result || [];
    };
  });
  if (all) {
    all.sort((a, b) => a.seq - b.seq);
    return all.slice(-limit);
  }
  const bucket = memory.events.get(sid);
  const list = bucket ? [...bucket.values()] : [];
  list.sort((a, b) => a.seq - b.seq);
  return list.slice(-limit);
}

export async function putEvents(sid, events) {
  if (!sid || !Array.isArray(events) || !events.length) return;
  const rows = events
    .filter((event) => event && event.seq != null)
    .map((event) => ({ ...event, sid }));

  const writeOk = await writeTx([STORE_EVENTS], (tx) => {
    const target = tx.objectStore(STORE_EVENTS);
    for (const row of rows) target.put(row);
  });

  if (!writeOk) {
    const bucket = memory.events.get(sid) || new Map();
    for (const row of rows) bucket.set(row.seq, row);
    memory.events.set(sid, bucket);
    pruneMemory(sid);
    return;
  }

  const keys = await readTx([STORE_EVENTS], (tx, holder) => {
    const request = tx.objectStore(STORE_EVENTS).getAllKeys(eventRange(sid));
    request.onsuccess = () => {
      holder.value = request.result || [];
    };
  });
  if (keys && keys.length > MAX_EVENTS) {
    keys.sort((a, b) => a[1] - b[1]);
    const excess = keys.slice(0, keys.length - MAX_EVENTS);
    await writeTx([STORE_EVENTS], (tx) => {
      const target = tx.objectStore(STORE_EVENTS);
      for (const key of excess) target.delete(key);
    });
  }
}

function pruneMemory(sid) {
  const bucket = memory.events.get(sid);
  if (!bucket) return;
  const keys = [...bucket.keys()].sort((a, b) => a - b);
  while (keys.length > MAX_EVENTS) bucket.delete(keys.shift());
}

/* ── key/value: cursors, drafts, meta ──────────────────────────────── */

async function kvGet(key, fallbackValue) {
  const value = await readTx([STORE_KV], (tx, holder) => {
    const request = tx.objectStore(STORE_KV).get(key);
    request.onsuccess = () => {
      holder.value = request.result ? request.result.v : fallbackValue;
    };
  });
  return value === undefined || value === null ? fallbackValue : value;
}

async function kvSet(key, value) {
  memory.kv.set(key, value);
  await writeTx([STORE_KV], (tx) => {
    tx.objectStore(STORE_KV).put({ k: key, v: value });
  });
}

async function kvDelete(key) {
  memory.kv.delete(key);
  await writeTx([STORE_KV], (tx) => {
    tx.objectStore(STORE_KV).delete(key);
  });
}

export function getCursor(sid) {
  return kvGet(`cursor:${sid}`, null);
}

export function setCursor(sid, cursor) {
  if (!sid || cursor == null) return Promise.resolve();
  return kvSet(`cursor:${sid}`, String(cursor));
}

export function getDraft(sid) {
  return kvGet(`draft:${sid}`, '');
}

export function setDraft(sid, text) {
  if (!sid) return Promise.resolve();
  if (!text) return kvDelete(`draft:${sid}`);
  return kvSet(`draft:${sid}`, String(text));
}

export function getMeta(key, fallbackValue = null) {
  return kvGet(`meta:${key}`, fallbackValue);
}

export function setMeta(key, value) {
  return kvSet(`meta:${key}`, value);
}

export function deleteMeta(key) {
  return kvDelete(`meta:${key}`);
}

/* ── maintenance ───────────────────────────────────────────────────── */

export async function clearAll() {
  memory.sessions.clear();
  memory.events.clear();
  memory.kv.clear();
  await writeTx([STORE_SESSIONS, STORE_EVENTS, STORE_KV], (tx) => {
    tx.objectStore(STORE_SESSIONS).clear();
    tx.objectStore(STORE_EVENTS).clear();
    tx.objectStore(STORE_KV).clear();
  });
}

export async function stats() {
  const counts = await readTx([STORE_SESSIONS, STORE_EVENTS], (tx, holder) => {
    const sessions = tx.objectStore(STORE_SESSIONS).count();
    const events = tx.objectStore(STORE_EVENTS).count();
    holder.value = { sessions: 0, events: 0 };
    sessions.onsuccess = () => {
      holder.value.sessions = sessions.result;
    };
    events.onsuccess = () => {
      holder.value.events = events.result;
    };
  });
  if (counts) return { ...counts, mode: 'indexeddb' };
  let events = 0;
  for (const bucket of memory.events.values()) events += bucket.size;
  return { sessions: memory.sessions.size, events, mode: 'memory' };
}
