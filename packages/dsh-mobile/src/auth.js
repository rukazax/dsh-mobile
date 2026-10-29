/**
 * Pairing and device authentication for the DSH Mobile gateway.
 *
 * Threat model: the LAN listener is reachable by anyone on the same network.
 * It must therefore never authorise a request without a device bearer token,
 * except the one-time pairing exchange and public PWA assets. Pairing codes are
 * short, single-use, expiring, attempt-limited and additionally rate limited per
 * source address.
 *
 * @module dsh-mobile/src/auth
 */

import { randomInt } from 'node:crypto';
import { nowIso, nowMs, randomToken, safeEqualHex, sha256Hex, truncate } from './util.js';

/** Unambiguous alphabet: no I, O, 0, 1. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Default pairing code length. */
const CODE_LENGTH = 8;
/** Wrong-code attempts allowed against one pairing code before it is burned. */
const MAX_CODE_ATTEMPTS = 5;
/** Pairing exchange failures allowed per address inside the window. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_FAILURES = 10;

/**
 * @typedef {object} DeviceCredential
 * @property {string} id
 * @property {string} label
 * @property {string} platform
 * @property {string} tokenHash
 * @property {string} createdAt
 * @property {string} lastSeenAt
 * @property {string} [revokedAt]
 */

/**
 * @param {number} length
 * @returns {string}
 */
function generateCode(length = CODE_LENGTH) {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Normalize user-typed pairing codes: uppercase, strip spaces and dashes.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePairingCode(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export class AuthManager {
  /**
   * @param {import('./store.js').DeviceStore} store
   * @param {import('./config.js').MobileConfig} config
   * @param {{ info: (msg: string) => void, warn: (msg: string) => void }} [logger]
   */
  constructor(store, config, logger) {
    this.store = store;
    this.config = config;
    this.logger = logger ?? { info() {}, warn() {} };
    /** @type {Map<string, { count: number, resetAt: number }>} */
    this.failures = new Map();
  }

  /** @returns {{ code: string, expiresAt: string, issuedAt: string, attempts: number }} */
  async ensurePairing() {
    await this.store.load();
    const current = this.store.snapshot().pairing;
    if (current !== null && current !== undefined) {
      const expires = Date.parse(current.expiresAt);
      if (Number.isFinite(expires) && expires > nowMs() && current.attempts < MAX_CODE_ATTEMPTS) {
        return current;
      }
    }
    return this.rotatePairing();
  }

  /** @returns {Promise<{ code: string, expiresAt: string, issuedAt: string, attempts: number }>} */
  async rotatePairing() {
    await this.store.load();
    const issuedAt = nowIso();
    const pairing = {
      code: generateCode(),
      issuedAt,
      expiresAt: new Date(nowMs() + this.config.pairingTtlSec * 1000).toISOString(),
      attempts: 0,
    };
    await this.store.setPairing(pairing);
    this.logger.info(`dsh-mobile: pairing code ${pairing.code} valid until ${pairing.expiresAt}`);
    return pairing;
  }

  /** The pairing view for the PC page, rotating an expired code. */
  async pairingInfo() {
    const pairing = await this.ensurePairing();
    return {
      code: pairing.code,
      expiresAt: pairing.expiresAt,
      ttlSec: Math.max(0, Math.round((Date.parse(pairing.expiresAt) - nowMs()) / 1000)),
      devices: this.store.listDevices(),
    };
  }

  /**
   * Check whether an address is currently rate limited.
   * @param {string} ip
   * @returns {boolean}
   */
  isRateLimited(ip) {
    const entry = this.failures.get(ip);
    if (entry === undefined) return false;
    if (entry.resetAt <= nowMs()) {
      this.failures.delete(ip);
      return false;
    }
    return entry.count >= RATE_MAX_FAILURES;
  }

  /**
   * @param {string} ip
   */
  recordFailure(ip) {
    const current = this.failures.get(ip);
    if (current === undefined || current.resetAt <= nowMs()) {
      this.failures.set(ip, { count: 1, resetAt: nowMs() + RATE_WINDOW_MS });
      return;
    }
    current.count += 1;
  }

  /**
   * Exchange a pairing code for a device token. The code is consumed on
   * success; repeated wrong codes burn it and force the owner to rotate.
   *
   * @param {object} request
   * @param {string} request.code user-typed code
   * @param {string} [request.label] device name shown on the PC
   * @param {string} [request.platform] coarse platform label
   * @returns {Promise<{ ok: true, token: string, device: Omit<DeviceCredential, 'tokenHash'> } | { ok: false, reason: 'invalid' | 'expired' | 'too-many-attempts' }>}
   */
  async pair({ code, label, platform }) {
    await this.store.load();
    const pairing = this.store.snapshot().pairing;
    if (pairing === null || pairing === undefined) return { ok: false, reason: 'invalid' };

    if (Date.parse(pairing.expiresAt) <= nowMs()) {
      await this.store.setPairing(null);
      return { ok: false, reason: 'expired' };
    }
    if (pairing.attempts >= MAX_CODE_ATTEMPTS) {
      await this.store.setPairing(null);
      return { ok: false, reason: 'too-many-attempts' };
    }

    const given = normalizePairingCode(code);
    const expected = normalizePairingCode(pairing.code);
    const matches = given.length === expected.length && safeEqualHex(sha256Hex(given), sha256Hex(expected));
    if (!matches) {
      pairing.attempts += 1;
      await this.store.setPairing(pairing);
      if (pairing.attempts >= MAX_CODE_ATTEMPTS) await this.store.setPairing(null);
      return { ok: false, reason: 'invalid' };
    }

    const token = randomToken(32);
    const createdAt = nowIso();
    /** @type {DeviceCredential} */
    const device = {
      id: `dev_${randomToken(9)}`,
      label: truncate(String(label ?? '').trim(), 60) || `Android ${createdAt.slice(5, 16)}`,
      platform: truncate(String(platform ?? 'unknown'), 40) || 'unknown',
      tokenHash: sha256Hex(token),
      createdAt,
      lastSeenAt: createdAt,
    };
    await this.store.addDevice(device);
    await this.store.pruneDevices(this.config.maxDevices, device.id);
    await this.store.setPairing(null);
    const { tokenHash: _ignored, ...publicDevice } = device;
    this.logger.info(`dsh-mobile: paired "${device.label}" (${device.platform})`);
    return { ok: true, token, device: publicDevice };
  }

  /**
   * Verify a bearer token.
   * @param {string | undefined} token
   * @returns {Promise<{ ok: true, device: DeviceCredential } | { ok: false }>}
   */
  async verify(token) {
    if (typeof token !== 'string' || token.length < 16) return { ok: false };
    await this.store.load();
    const hash = sha256Hex(token);
    const device = this.store.findByTokenHash(hash);
    if (device === undefined || device.revokedAt !== undefined) return { ok: false };
    // Throttle registry writes: lastSeenAt is informational.
    if (nowMs() - Date.parse(device.lastSeenAt) > 60_000) {
      void this.store.updateDevice(device.id, { lastSeenAt: nowIso() }).catch(() => {});
    }
    return { ok: true, device };
  }

  /**
   * @param {string} deviceId
   * @returns {Promise<boolean>}
   */
  async revoke(deviceId) {
    await this.store.load();
    const device = this.store.findById(deviceId);
    if (device === undefined) return false;
    await this.store.updateDevice(deviceId, { revokedAt: nowIso() });
    this.logger.info(`dsh-mobile: revoked device ${deviceId}`);
    return true;
  }

  /** @returns {Promise<Array<Omit<DeviceCredential, 'tokenHash'>>>} */
  async devices() {
    await this.store.load();
    return this.store.listDevices();
  }
}

export { CODE_ALPHABET, CODE_LENGTH, MAX_CODE_ATTEMPTS, RATE_MAX_FAILURES };
