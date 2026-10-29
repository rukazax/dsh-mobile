/**
 * Small dependency-free helpers shared by the DSH Mobile gateway.
 *
 * Everything here is intentionally Node-stdlib-only so the plugin runs inside
 * the DeepSeek Harness host process without adding dependencies to the user's
 * profile.
 *
 * @module dsh-mobile/src/util
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';

/** Milliseconds in one second. */
export const SECOND = 1000;
/** Milliseconds in one minute. */
export const MINUTE = 60 * SECOND;

/** @returns {string} an ISO-8601 UTC timestamp. */
export function nowIso() {
  return new Date().toISOString();
}

/** @returns {number} current epoch milliseconds. */
export function nowMs() {
  return Date.now();
}

/**
 * A URL-safe random token with `bytes` bytes of entropy.
 * @param {number} [bytes]
 * @returns {string}
 */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Lowercase hex SHA-256 of a string.
 * @param {string} value
 * @returns {string}
 */
export function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of two equal-length hex strings.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Clamp an integer into `[min, max]`, returning `fallback` for non-numbers.
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
export function clampInt(value, min, max, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/**
 * Truncate a string to `max` characters, appending an ellipsis.
 * @param {string | undefined | null} value
 * @param {number} max
 * @returns {string}
 */
export function truncate(value, max = 200) {
  if (typeof value !== 'string') return '';
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}\u2026`;
}

/**
 * Coarse platform label from a User-Agent header.
 * @param {string | undefined} userAgent
 * @returns {string}
 */
export function describePlatform(userAgent) {
  const ua = String(userAgent ?? '');
  if (/dshm-android|dshmobile/i.test(ua)) return 'dsh-mobile-app';
  if (/Android/i.test(ua)) return /wv\)/i.test(ua) ? 'android-webview' : 'android-browser';
  if (/iPad|iPhone|iPod/i.test(ua)) return 'ios';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh/i.test(ua)) return 'macos';
  if (/Linux/i.test(ua)) return 'linux';
  return 'unknown';
}

/**
 * IPv4 interfaces usable for reaching this machine over a local network.
 * Ordered Wi-Fi/Ethernet first, real private ranges before everything else.
 *
 * @returns {Array<{ address: string, iface: string, score: number }>}
 */
export function lanInterfaces() {
  /** @type {Array<{ address: string, iface: string, score: number }>} */
  const found = [];
  const table = networkInterfaces();
  for (const [iface, entries] of Object.entries(table)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const address = entry.address;
      if (address.startsWith('169.254.')) continue;
      let score = 0;
      if (/^192\.168\./.test(address)) score += 40;
      else if (/^10\./.test(address)) score += 30;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) score += 20;
      else score += 5;
      if (/wi-?fi|wlan|wireless/i.test(iface)) score += 20;
      else if (/ethernet|eth/i.test(iface)) score += 10;
      else if (/vEthernet|virtual|vmware|vbox|docker|loopback/i.test(iface)) score -= 15;
      found.push({ address, iface, score });
    }
  }
  return found.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
}

/**
 * Human-readable byte count.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Message and stack of an unknown thrown value, for logs and JSON errors.
 * @param {unknown} error
 * @returns {{ message: string, stack?: string }}
 */
export function errorInfo(error) {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

/**
 * Resolve the DSH home directory used for plugin state.
 * @returns {string}
 */
export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv;
  const home = process.env.USERPROFILE ?? process.env.HOME ?? process.cwd();
  return `${home}\\.dsh`;
}

/**
 * A tiny promise-based mutex used to serialize JSON-file writes.
 * @returns {{ run: <T>(task: () => Promise<T> | T) => Promise<T> }}
 */
export function createMutex() {
  let tail = Promise.resolve();
  return {
    run(task) {
      const next = tail.then(task, task);
      tail = next.catch(() => {});
      return next;
    },
  };
}

/**
 * Sleep helper.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
