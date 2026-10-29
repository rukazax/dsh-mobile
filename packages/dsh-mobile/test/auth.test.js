import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AuthManager, MAX_CODE_ATTEMPTS, normalizePairingCode } from '../src/auth.js';
import { normalizeConfig } from '../src/config.js';
import { DeviceStore } from '../src/store.js';
import { makeTmp, removeTmp } from './helpers/tmp.js';

/** @returns {Promise<{ dir: string, store: DeviceStore, auth: AuthManager, config: import('../src/config.js').MobileConfig, cleanup: () => Promise<void> }>} */
async function setup() {
  const dir = await makeTmp('auth');
  const config = normalizeConfig({ dataDir: dir, pairingTtlSec: 120 });
  const store = new DeviceStore({ dataDir: dir });
  const auth = new AuthManager(store, config);
  return {
    dir,
    store,
    auth,
    config,
    cleanup: async () => {
      await removeTmp(dir);
    },
  };
}

test('pairing code is single-use and issues a verifiable token', async () => {
  const { auth, store, cleanup } = await setup();
  try {
    const info = await auth.pairingInfo();
    assert.equal(info.code.length, 8);
    assert.match(info.code, /^[A-HJ-NP-Z2-9]+$/);

    const result = await auth.pair({ code: info.code, label: 'Honor Magic V3', platform: 'android-browser' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.device.label, 'Honor Magic V3');
    assert.ok(result.token.length >= 32);

    const verified = await auth.verify(result.token);
    assert.equal(verified.ok, true);
    assert.equal((await auth.verify('not-a-token-but-long-enough')).ok, false);

    // One-time: the same code cannot be replayed.
    const replay = await auth.pair({ code: info.code, label: 'second' });
    assert.deepEqual(replay, { ok: false, reason: 'invalid' });

    // Only the hash is persisted.
    const raw = await readFile(join(store.dir, store.filename), 'utf8');
    assert.equal(raw.includes(result.token), false);
    assert.equal(raw.includes('tokenHash'), true);
  } finally {
    await cleanup();
  }
});

test('wrong codes burn the pairing slot after the attempt limit', async () => {
  const { auth, cleanup } = await setup();
  try {
    const info = await auth.pairingInfo();
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const result = await auth.pair({ code: 'WRONG123' });
      assert.equal(result.ok, false);
    }
    const after = await auth.pair({ code: info.code });
    assert.equal(after.ok, false);
    // A fresh code is available for the owner.
    const fresh = await auth.pairingInfo();
    assert.notEqual(fresh.code, info.code);
  } finally {
    await cleanup();
  }
});

test('expired pairing codes are rejected', async () => {
  const { auth, store, config, cleanup } = await setup();
  try {
    const expired = {
      code: 'ABCD2345',
      issuedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      attempts: 0,
    };
    await store.setPairing(expired);
    const result = await auth.pair({ code: 'ABCD2345' });
    assert.deepEqual(result, { ok: false, reason: 'expired' });
    assert.equal(store.snapshot().pairing, null);
    assert.ok(config.pairingTtlSec > 0);
  } finally {
    await cleanup();
  }
});

test('revocation invalidates a token and survives a restart', async () => {
  const { auth, store, config, dir, cleanup } = await setup();
  try {
    const info = await auth.pairingInfo();
    const paired = await auth.pair({ code: info.code, label: 'phone' });
    assert.equal(paired.ok, true);
    if (!paired.ok) return;

    const restarted = new AuthManager(new DeviceStore({ dataDir: config.dataDir }), config);
    assert.equal((await restarted.verify(paired.token)).ok, true);
    assert.equal(await restarted.revoke(paired.device.id), true);
    assert.equal((await restarted.verify(paired.token)).ok, false);
    assert.equal(await restarted.revoke('dev_missing'), false);

    // A second restart keeps the revocation durable.
    const again = new AuthManager(new DeviceStore({ dataDir: dir }), config);
    assert.equal((await again.verify(paired.token)).ok, false);
    assert.equal(store.snapshot().devices.length, 1);
  } finally {
    await cleanup();
  }
});

test('the device registry is pruned to maxDevices', async () => {
  const dir = await makeTmp('prune');
  try {
    const config = normalizeConfig({ dataDir: dir, maxDevices: 2 });
    const auth = new AuthManager(new DeviceStore({ dataDir: dir }), config);
    /** @type {string[]} */
    const tokens = [];
    for (let index = 0; index < 4; index += 1) {
      const info = await auth.pairingInfo();
      const paired = await auth.pair({ code: info.code, label: `phone-${index}` });
      assert.equal(paired.ok, true);
      if (paired.ok) tokens.push(paired.token);
    }
    const devices = await auth.devices();
    assert.equal(devices.length, 2);
    assert.equal((await auth.verify(tokens[0])).ok, false);
    assert.equal((await auth.verify(tokens[3])).ok, true);
  } finally {
    await removeTmp(dir);
  }
});

test('rate limiting blocks repeated failures per address', async () => {
  const { auth, cleanup } = await setup();
  try {
    for (let index = 0; index < 10; index += 1) {
      assert.equal(auth.isRateLimited('192.168.1.9'), false);
      auth.recordFailure('192.168.1.9');
    }
    assert.equal(auth.isRateLimited('192.168.1.9'), true);
    assert.equal(auth.isRateLimited('192.168.1.10'), false);
  } finally {
    await cleanup();
  }
});

test('pairing codes normalize user input', () => {
  assert.equal(normalizePairingCode(' abcd-2345 '), 'ABCD2345');
  assert.equal(normalizePairingCode(undefined), '');
});

