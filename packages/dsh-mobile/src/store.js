/**
 * Durable, tiny state store for the DSH Mobile gateway.
 *
 * Keeps the paired-device registry and the current pairing secret in one JSON
 * file under the DSH home directory. Writes are atomic (temp file + rename) and
 * serialized; reads are served from memory. The file never contains a device
 * token — only its SHA-256 hash.
 *
 * @module dsh-mobile/src/store
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createMutex, nowIso, resolveDshHome } from './util.js';

/** Bump when the on-disk shape changes incompatibly. */
const STORE_VERSION = 1;

/**
 * @typedef {object} StoredDevice
 * @property {string} id stable random id
 * @property {string} label user-visible name
 * @property {string} platform coarse platform label
 * @property {string} tokenHash hex SHA-256 of the bearer token
 * @property {string} createdAt ISO timestamp
 * @property {string} lastSeenAt ISO timestamp
 * @property {string} [revokedAt] ISO timestamp once revoked
 */

/**
 * @typedef {object} StoreData
 * @property {number} version
 * @property {StoredDevice[]} devices
 * @property {{ code: string, expiresAt: string, issuedAt: string, attempts: number } | null} pairing
 */

/** @returns {StoreData} */
function emptyData() {
  return { version: STORE_VERSION, devices: [], pairing: null };
}

/**
 * @param {unknown} candidate
 * @returns {StoreData}
 */
function sanitize(candidate) {
  if (candidate === null || typeof candidate !== 'object') return emptyData();
  const raw = /** @type {Record<string, unknown>} */ (candidate);
  const devices = Array.isArray(raw.devices)
    ? raw.devices.filter((device) => device !== null && typeof device === 'object')
    : [];
  const pairing = raw.pairing !== null && typeof raw.pairing === 'object' ? raw.pairing : null;
  return {
    version: STORE_VERSION,
    devices: /** @type {StoredDevice[]} */ (devices),
    pairing: /** @type {StoreData['pairing']} */ (pairing),
  };
}

export class DeviceStore {
  /**
   * @param {object} options
   * @param {string} [options.dataDir] absolute directory; defaults to `$DSH_HOME/mobile-remote`
   * @param {string} [options.filename] file name inside the directory
   * @param {{ info: (msg: string) => void, warn: (msg: string) => void }} [options.logger]
   */
  constructor({ dataDir, filename = 'mobile-remote.json', logger } = {}) {
    this.dir = dataDir && dataDir !== '' ? dataDir : join(resolveDshHome(), 'mobile-remote');
    this.filename = filename;
    this.path = join(this.dir, filename);
    this.logger = logger ?? { info() {}, warn() {} };
    /** @type {StoreData} */
    this.data = emptyData();
    this.loaded = false;
    this.mutex = createMutex();
  }

  /** Load the file if present; a corrupt file is quarantined by starting empty. */
  async load() {
    if (this.loaded) return this.data;
    try {
      await mkdir(dirname(this.path), { recursive: true });
      const text = await readFile(this.path, 'utf8');
      this.data = sanitize(JSON.parse(text));
    } catch (error) {
      const code = /** @type {{ code?: string }} */ (error).code;
      if (code !== 'ENOENT') {
        this.logger.warn(`dsh-mobile: cannot read ${this.path} (${code ?? 'error'}), starting with an empty registry`);
      }
      this.data = emptyData();
    }
    this.loaded = true;
    return this.data;
  }

  /** Persist the current state atomically. */
  async flush() {
    return this.mutex.run(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
      await rename(tmp, this.path);
    });
  }

  /** @returns {StoreData} */
  snapshot() {
    return this.data;
  }

  /**
   * Replace the pairing slot.
   * @param {StoreData['pairing']} pairing
   */
  async setPairing(pairing) {
    this.data.pairing = pairing;
    await this.flush();
  }

  /**
   * @param {StoredDevice} device
   */
  async addDevice(device) {
    this.data.devices = [...this.data.devices.filter((entry) => entry.id !== device.id), device];
    await this.flush();
  }

  /**
   * @param {string} id
   * @param {Partial<StoredDevice>} patch
   */
  async updateDevice(id, patch) {
    let changed = false;
    this.data.devices = this.data.devices.map((device) => {
      if (device.id !== id) return device;
      changed = true;
      return { ...device, ...patch };
    });
    if (changed) await this.flush();
  }

  /**
   * Drop a device entirely (revocation keeps history only in the log).
   * @param {string} id
   * @returns {Promise<boolean>} whether the device existed
   */
  async removeDevice(id) {
    const before = this.data.devices.length;
    this.data.devices = this.data.devices.filter((device) => device.id !== id);
    const removed = this.data.devices.length !== before;
    if (removed) await this.flush();
    return removed;
  }

  /**
   * Keep the registry within `maxDevices` by dropping the least recently seen
   * active device, never the one passed as `keepId`.
   * @param {number} maxDevices
   * @param {string | undefined} keepId
   * @returns {Promise<string[]>} removed device ids
   */
  async pruneDevices(maxDevices, keepId) {
    const active = this.data.devices.filter((device) => !device.revokedAt);
    if (active.length <= maxDevices) return [];
    const sorted = [...active].sort((a, b) => String(a.lastSeenAt).localeCompare(String(b.lastSeenAt)));
    const removable = sorted.filter((device) => device.id !== keepId).slice(0, active.length - maxDevices);
    const ids = removable.map((device) => device.id);
    if (ids.length === 0) return [];
    this.data.devices = this.data.devices.filter((device) => !ids.includes(device.id));
    await this.flush();
    return ids;
  }

  /** @returns {Array<Omit<StoredDevice, 'tokenHash'>>} public device list */
  listDevices() {
    const seen = nowIso();
    return this.data.devices.map(({ tokenHash: _ignored, ...device }) => ({ ...device, now: seen }));
  }

  /**
   * @param {string} tokenHash
   * @returns {StoredDevice | undefined}
   */
  findByTokenHash(tokenHash) {
    return this.data.devices.find((device) => device.tokenHash === tokenHash);
  }

  /**
   * @param {string} id
   * @returns {StoredDevice | undefined}
   */
  findById(id) {
    return this.data.devices.find((device) => device.id === id);
  }
}
