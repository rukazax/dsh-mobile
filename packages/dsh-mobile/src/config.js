/**
 * Configuration of the DSH Mobile plugin.
 *
 * The plugin deliberately validates its own config instead of depending on a
 * specific `@deepseek-ai/schemastery` build: a plugin installed into a user
 * profile must keep working across patch releases of the host, and a plain
 * normalizer has no version coupling.
 *
 * @module dsh-mobile/src/config
 */

import { clampInt } from './util.js';

/**
 * @typedef {object} MobileTlsConfig
 * @property {string} certFile absolute path to a PEM certificate chain
 * @property {string} keyFile absolute path to an unencrypted PEM private key
 */

/**
 * @typedef {object} MobileConfig
 * @property {boolean} enabled
 * @property {string} listenHost bind address of the LAN listener
 * @property {number} listenPort 0 selects an OS-assigned port
 * @property {MobileTlsConfig | undefined} tls
 * @property {string | undefined} publicUrl optional advertised root behind a proxy
 * @property {number} pairingTtlSec lifetime of a pairing code
 * @property {number} maxDevices paired devices kept per host
 * @property {number} sessionWindowTurns turns included in an opening snapshot
 * @property {number} sessionWindowEvents hard cap on events in an opening snapshot
 * @property {number} maxPromptChars prompt length limit
 * @property {number} sseHeartbeatMs server heartbeat for live streams
 * @property {number} apiBodyLimitBytes max JSON request body
 * @property {boolean} allowCleartext allow plain HTTP on a non-loopback bind
 * @property {string} dataDir absolute directory for the device registry
 * @property {string[]} corsOrigins allowed browser origins (`*` allowed)
 * @property {boolean} debug verbose logging
 */

/** @type {Readonly<MobileConfig>} */
export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  listenHost: '0.0.0.0',
  listenPort: 3081,
  tls: undefined,
  publicUrl: undefined,
  pairingTtlSec: 300,
  maxDevices: 8,
  sessionWindowTurns: 1,
  sessionWindowEvents: 40,
  approvals: 'auto',
  maxPromptChars: 24_000,
  sseHeartbeatMs: 15_000,
  apiBodyLimitBytes: 512 * 1024,
  allowCleartext: true,
  dataDir: '',
  corsOrigins: ['*'],
  debug: false,
});

/**
 * Turn a value that may be a Cordis config getter into a plain value.
 * DSH plugins receive live config objects whose fields can be functions when
 * the profile uses `!!js` expressions.
 * @template T
 * @param {T | (() => T) | undefined} value
 * @returns {T | undefined}
 */
export function configValue(value) {
  return typeof value === 'function' ? value() : value;
}

/**
 * Normalize and validate raw plugin config.
 * @param {Partial<MobileConfig> | (() => Partial<MobileConfig>) | undefined} raw
 * @returns {MobileConfig}
 * @throws {Error} when a field is present but invalid
 */
export function normalizeConfig(raw) {
  const source = configValue(raw) ?? {};
  if (typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('dsh-mobile: config must be an object');
  }

  /** @type {MobileConfig} */
  const config = { ...DEFAULT_CONFIG };

  if (source.enabled !== undefined) config.enabled = Boolean(configValue(source.enabled));
  if (!config.enabled) return config;

  if (source.listenHost !== undefined) {
    const host = String(configValue(source.listenHost) ?? '').trim();
    if (host === '') throw new Error('dsh-mobile: listenHost must not be empty');
    config.listenHost = host;
  }

  if (source.listenPort !== undefined) {
    const port = Number(configValue(source.listenPort));
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new Error('dsh-mobile: listenPort must be an integer between 0 and 65535');
    }
    config.listenPort = port;
  }

  const tls = configValue(source.tls);
  if (tls !== undefined && tls !== null) {
    const certFile = String(configValue(tls.certFile) ?? '').trim();
    const keyFile = String(configValue(tls.keyFile) ?? '').trim();
    if (certFile === '' || keyFile === '') {
      throw new Error('dsh-mobile: tls requires both certFile and keyFile');
    }
    config.tls = { certFile, keyFile };
  }

  const publicUrl = configValue(source.publicUrl);
  if (publicUrl !== undefined && publicUrl !== null && String(publicUrl).trim() !== '') {
    const text = String(publicUrl).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(text)) throw new Error('dsh-mobile: publicUrl must be an http(s) URL');
    config.publicUrl = text;
  }

  config.pairingTtlSec = clampInt(configValue(source.pairingTtlSec), 30, 3600, DEFAULT_CONFIG.pairingTtlSec);
  config.maxDevices = clampInt(configValue(source.maxDevices), 1, 64, DEFAULT_CONFIG.maxDevices);
  config.sessionWindowTurns = clampInt(configValue(source.sessionWindowTurns), 1, 20, DEFAULT_CONFIG.sessionWindowTurns);
  config.sessionWindowEvents = clampInt(
    configValue(source.sessionWindowEvents),
    20,
    2000,
    DEFAULT_CONFIG.sessionWindowEvents,
  );
  config.maxPromptChars = clampInt(configValue(source.maxPromptChars), 256, 200_000, DEFAULT_CONFIG.maxPromptChars);
  config.sseHeartbeatMs = clampInt(configValue(source.sseHeartbeatMs), 5000, 60_000, DEFAULT_CONFIG.sseHeartbeatMs);
  config.apiBodyLimitBytes = clampInt(
    configValue(source.apiBodyLimitBytes),
    16 * 1024,
    8 * 1024 * 1024,
    DEFAULT_CONFIG.apiBodyLimitBytes,
  );

  const approvals = configValue(source.approvals);
  if (approvals !== undefined && approvals !== null) {
    if (approvals !== 'auto' && approvals !== 'relay' && approvals !== 'observe') {
      throw new Error('dsh-mobile: approvals must be "auto", "relay" or "observe"');
    }
    config.approvals = approvals;
  }

  if (source.allowCleartext !== undefined) config.allowCleartext = Boolean(configValue(source.allowCleartext));
  if (source.debug !== undefined) config.debug = Boolean(configValue(source.debug));

  const dataDir = configValue(source.dataDir);
  if (dataDir !== undefined && dataDir !== null && String(dataDir).trim() !== '') {
    config.dataDir = String(dataDir).trim();
  }

  const origins = configValue(source.corsOrigins);
  if (origins !== undefined && origins !== null) {
    if (!Array.isArray(origins)) throw new Error('dsh-mobile: corsOrigins must be an array of strings');
    config.corsOrigins = origins.map((origin) => String(origin).trim()).filter((origin) => origin !== '');
  }

  // A plain-HTTP LAN listener exposes the device token in transit. Refuse the
  // combination unless the operator explicitly opts in, and always keep the
  // loopback default working.
  const loopback = config.listenHost === '127.0.0.1' || config.listenHost === '::1' || config.listenHost === 'localhost';
  if (!loopback && config.tls === undefined && !config.allowCleartext) {
    throw new Error(
      'dsh-mobile: a non-loopback listenHost without tls requires allowCleartext: true — ' +
        'the bearer token would otherwise travel unencrypted over the network',
    );
  }

  return config;
}

