import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG, configValue, normalizeConfig } from '../src/config.js';

test('defaults are stable and safe', () => {
  const config = normalizeConfig(undefined);
  assert.equal(config.enabled, true);
  assert.equal(config.listenHost, '0.0.0.0');
  assert.equal(config.listenPort, 3081);
  assert.equal(config.tls, undefined);
  assert.equal(config.pairingTtlSec, 300);
  assert.equal(config.allowCleartext, true);
});

test('a non-loopback cleartext listener can be refused explicitly', () => {
  assert.throws(() => normalizeConfig({ allowCleartext: false }), /allowCleartext/);
  // loopback stays allowed
  const loopback = normalizeConfig({ listenHost: '127.0.0.1', allowCleartext: false });
  assert.equal(loopback.listenHost, '127.0.0.1');
});

test('tls requires both files', () => {
  assert.throws(() => normalizeConfig({ tls: { certFile: 'a.pem' } }), /both certFile and keyFile/);
  const config = normalizeConfig({ tls: { certFile: 'a.pem', keyFile: 'b.pem' } });
  assert.deepEqual(config.tls, { certFile: 'a.pem', keyFile: 'b.pem' });
});

test('invalid ports and urls are rejected', () => {
  assert.throws(() => normalizeConfig({ listenPort: 70_000 }), /listenPort/);
  assert.throws(() => normalizeConfig({ listenPort: 3.5 }), /listenPort/);
  assert.throws(() => normalizeConfig({ publicUrl: 'ftp://example' }), /http\(s\) URL/);
});

test('numbers are clamped into their supported range', () => {
  const config = normalizeConfig({ pairingTtlSec: 5, maxDevices: 999, sessionWindowTurns: 0, sseHeartbeatMs: 1 });
  assert.equal(config.pairingTtlSec, 30);
  assert.equal(config.maxDevices, 64);
  assert.equal(config.sessionWindowTurns, 1);
  assert.equal(config.sseHeartbeatMs, 5000);
});

test('cors origins accept arrays only', () => {
  assert.throws(() => normalizeConfig({ corsOrigins: '*' }), /array/);
  assert.deepEqual(normalizeConfig({ corsOrigins: ['https://a', ' '] }).corsOrigins, ['https://a']);
});

test('disabled config short-circuits validation', () => {
  const config = normalizeConfig({ enabled: false, listenPort: 99_999 });
  assert.equal(config.enabled, false);
});

test('configValues may be getters, as Cordis emits them', () => {
  assert.equal(configValue(() => 'x'), 'x');
  assert.equal(configValue('x'), 'x');
  const config = normalizeConfig(() => ({ listenPort: 4444 }));
  assert.equal(config.listenPort, 4444);
});

test('module defaults stay frozen', () => {
  assert.equal(Object.isFrozen(DEFAULT_CONFIG), true);
  normalizeConfig({ listenPort: 1234 });
  assert.equal(DEFAULT_CONFIG.listenPort, 3081);
});
