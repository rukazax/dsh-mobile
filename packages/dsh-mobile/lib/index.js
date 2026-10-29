/**
 * DSH Mobile — remote control of DeepSeek Harness from a phone.
 *
 * The plugin owns two things:
 *  1. a LAN HTTP(S) listener that serves the bundled PWA and the compact
 *     `/api/v1` mobile protocol, authenticated with a paired-device token;
 *  2. pairing endpoints on the native DSH origin (`/m/pair`), authenticated by
 *     the DSH browser cookie, where the owner reads the one-time code.
 *
 * Session access is delegated to `session-bridge.js`, which talks to the host
 * in-process and never performs model work of its own: listing, reading history
 * and streaming deltas cost zero tokens. Prompts are the only operation that
 * activates an agent, exactly like the desktop GUI.
 *
 * @module dsh-mobile
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';
import { AuthManager } from '../src/auth.js';
import { normalizeConfig } from '../src/config.js';
import { createPairingHandler } from '../src/pairing.js';
import { ApiRouter, createUnavailableBridge } from '../src/routes.js';
import { createBridge } from '../src/session-bridge.js';
import { GatewayServer } from '../src/server.js';
import { StreamHub } from '../src/sse.js';
import { DeviceStore } from '../src/store.js';
import { errorInfo, resolveDshHome } from '../src/util.js';

/** Cordis plugin name (sets the logger name). */
export const name = 'dsh-mobile';

/**
 * Services are read lazily through `ctx.get` so the plugin also loads in a
 * composition that lacks some of them: the affected endpoints report
 * `unsupported` instead of failing the whole host boot. `webServer` is the only
 * hard requirement for the pairing page, and it is injected optionally.
 */
export const inject = [];

const WEB_ROOT = fileURLToPath(new URL('../web/', import.meta.url));

/**
 * The shipped web profile mounts no console log exporter (Cordis only buffers),
 * so the plugin writes its own diagnostics to `<DSH_HOME>/logs/dsh-mobile.log`.
 * Without this a headless install has no way to explain a failed pairing.
 *
 * @param {any} ctx
 * @param {string} logFile
 */
function attachFileLogExporter(ctx, logFile) {
  ctx.effect(() => {
    try {
      mkdirSync(dirname(logFile), { recursive: true });
    } catch {
      /* logging must never fail activation */
    }
    return ctx.logger.exporter?.({
      levels: { default: 4 },
      formatters: {},
      export(message) {
        if (message.name !== name) return;
        const text = `${new Date(message.ts).toISOString()} ${String(message.type).toUpperCase()} ${format(...message.args)}\n`;
        try {
          appendFileSync(logFile, text);
        } catch {
          /* best effort */
        }
      },
    });
  }, 'dsh-mobile: file log exporter');
}
const PAIRING_ROUTES = ['/m/pair', '/m/pair.json', '/m/pair/rotate', '/m/pair/revoke'];

/**
 * Read a service without throwing when the composition does not mount it.
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
 * @param {any} ctx
 * @param {string} method
 * @param {string} path
 * @param {import('node:http').ServerResponse} res
 * @param {unknown} body
 */
function replyJson(ctx, method, path, res, body) {
  void ctx;
  void method;
  void path;
  const text = JSON.stringify(body);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

/**
 * Authenticate a pairing-page request as the DSH owner.
 *
 * `connection.requestRejection(req)` is the same admission the native `/api`
 * bridge applies: `undefined` for an owner request carrying the signed browser
 * cookie, `401` before authentication, `403` for an untrusted Host/Origin.
 *
 * @param {any} ctx
 * @param {import('node:http').IncomingMessage} req
 * @returns {number | undefined}
 */
function ownerRejection(ctx, req) {
  const connection = service(ctx, 'connection');
  if (connection === undefined || connection === null || typeof connection.requestRejection !== 'function') {
    return 401;
  }
  try {
    return connection.requestRejection(req);
  } catch {
    return 401;
  }
}

/**
 * Resolve the session bridge on first use.
 *
 * A profile's host services are not necessarily registered by the time the last
 * bundle's `apply()` runs, so resolving `sessionController` eagerly loses the
 * bridge forever. The lazy proxy resolves on the first phone request — after
 * boot has settled — and retries while the service is still absent.
 *
 * @param {any} ctx
 * @param {import('../src/config.js').MobileConfig} config
 * @param {{ info: (m: string) => void, warn: (m: string) => void, debug: (m: string) => void }} logger
 * @returns {any}
 */
function createLazyBridge(ctx, config, logger) {
  /** @type {any} */
  let real;
  /** @type {Promise<any> | undefined} */
  let pending;
  const ensure = () => {
    if (real !== undefined) return Promise.resolve(real);
    pending ??= createBridge({ ctx, config, logger }).then((bridge) => {
      if (bridge !== undefined) real = bridge;
      return bridge ?? createUnavailableBridge();
    });
    return pending;
  };
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === '__dispose') {
          return async () => {
            if (real !== undefined) await real.dispose?.();
          };
        }
        return async (...args) => {
          const bridge = await ensure();
          return bridge[property](...args);
        };
      },
    },
  );
}

/**
 * Start the mobile gateway for one host lifetime.
 *
 * @param {any} ctx
 * @param {import('../src/config.js').MobileConfig} config
 * @param {(message: string) => void} log
 * @returns {Promise<{ gateway: GatewayServer, dispose: () => Promise<void> }>}
 */
async function startGatewayForHost(ctx, config, log) {
  const logger = {
    info: (message) => log(`INFO ${message}`),
    warn: (message) => log(`WARN ${message}`),
    debug: (message) => {
      if (config.debug) log(`DEBUG ${message}`);
    },
  };

  const dataDir = config.dataDir === '' ? `${resolveDshHome()}\\mobile-remote` : config.dataDir;
  const store = new DeviceStore({ dataDir, logger });
  await store.load();
  const auth = new AuthManager(store, config, logger);
  await auth.ensurePairing();

  const hub = new StreamHub({ logger, heartbeatMs: config.sseHeartbeatMs });
  hub.start();

  const bridge = createLazyBridge(ctx, config, logger);

  const router = new ApiRouter({
    config,
    auth,
    hub,
    bridge,
    logger,
    appVersion: process.env.DSH_VERSION ?? '0.2.x',
    hostName: process.env.COMPUTERNAME ?? 'dsh-host',
  });

  const gateway = new GatewayServer({ config, router, webRoot: WEB_ROOT, logger });
  await gateway.listen();

  const pairingHandler = createPairingHandler(
    {
      config,
      auth,
      lanUrls: () => gateway.getLanUrls(),
      appVersion: process.env.DSH_VERSION ?? '0.2.x',
      hostName: process.env.COMPUTERNAME ?? 'dsh-host',
    },
    (req) => ownerRejection(ctx, req) === undefined,
  );

  // Pairing routes live on the native DSH origin, so the one-time code never
  // appears on the LAN listener. `webServer` is injected optionally: without a
  // web composition there is simply nowhere to show the code.
  ctx.inject(['webServer'], (webCtx) => {
    for (const path of PAIRING_ROUTES) {
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: 'exact',
            path,
            handler: (req, res) => {
              void pairingHandler(req, res, path).then((handled) => {
                if (!handled && !res.writableEnded) {
                  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                  res.end('not found');
                }
              });
            },
          }),
        `dsh-mobile: ${path}`,
      );
    }
    log(`INFO pairing page: ${safeOrigin(webCtx)}/m/pair`);
  });

  const pairing = await auth.pairingInfo();
  log(`INFO pairing code ${pairing.code} (expires ${pairing.expiresAt})`);
  log(`INFO phone URL ${gateway.getLanUrls()[0] ?? gateway.getOrigin()}`);
  log('INFO sync is delta-only and makes no model requests; viewing sessions from the phone costs 0 tokens');

  return {
    gateway,
    async dispose() {
      hub.stop();
      await bridge.__dispose?.();
      await gateway.close();
    },
  };
}

/**
 * @param {any} webCtx
 * @returns {string}
 */
function safeOrigin(webCtx) {
  try {
    return webCtx.webServer.getOrigin();
  } catch {
    return 'http://127.0.0.1:<dsh-port>';
  }
}

/**
 * Cordis entry point.
 * @param {any} ctx
 * @param {Partial<import('./config.js').MobileConfig>} [rawConfig]
 */
export async function apply(ctx, rawConfig) {
  const log = typeof ctx.logger === 'function' ? ctx.logger(name) : ctx.logger;
  let config;
  try {
    config = normalizeConfig(rawConfig);
  } catch (error) {
    log.warn(`invalid config: ${errorInfo(error).message} — mobile gateway disabled`);
    return;
  }
  if (!config.enabled) {
    log.info('disabled by config');
    return;
  }

  const logFile = join(resolveDshHome(), 'logs', 'dsh-mobile.log');
  attachFileLogExporter(ctx, logFile);
  log.info(`apply() start pid=${process.pid} dshHome=${process.env.DSH_HOME ?? '(unset)'} logFile=${logFile}`);

  let started;
  try {
    started = await startGatewayForHost(ctx, config, (message) => {
      if (message.startsWith('WARN ')) log.warn(message.slice(5));
      else if (message.startsWith('DEBUG ')) log.debug?.(message.slice(6)) ?? log.info(message.slice(6));
      else log.info(message.slice(5));
    });
  } catch (error) {
    const info = errorInfo(error);
    log.warn(`failed to start the LAN gateway: ${info.message}`);
    if (config.debug && info.stack !== undefined) log.warn(info.stack);
    return;
  }

  ctx.effect(
    () => () => started.dispose(),
    'dsh-mobile: gateway lifetime',
  );
}

export { normalizeConfig };


