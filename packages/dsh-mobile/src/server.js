/**
 * The LAN listener of the DSH Mobile gateway.
 *
 * This is a second, independent HTTP(S) server owned by the plugin. It never
 * touches the DSH web server: the phone talks to a narrow, versioned API
 * (`/api/v1`) plus the bundled PWA, while the native DSH origin keeps serving
 * the desktop GUI on loopback.
 *
 * @module dsh-mobile/src/server
 */

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { applyCors, ApiError, clientIp, sendError, sendJson, sendText } from './http.js';
import { serveStatic } from './static.js';
import { lanInterfaces } from './util.js';

/**
 * @typedef {object} GatewayOptions
 * @property {import('./config.js').MobileConfig} config
 * @property {import('./routes.js').ApiRouter} router
 * @property {string} webRoot absolute path of the bundled PWA
 * @property {{ info: (msg: string) => void, warn: (msg: string) => void, debug: (msg: string) => void }} logger
 * @property {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, pathname: string) => Promise<boolean>} [pairingHandler]
 */

/**
 * @param {Record<string, string | string[] | undefined>} headers
 * @returns {string} a compact header summary for the debug log
 */
function describeRequest(headers) {
  const agent = String(headers['user-agent'] ?? 'unknown');
  return agent.length > 60 ? `${agent.slice(0, 57)}...` : agent;
}

export class GatewayServer {
  /** @param {GatewayOptions} options */
  constructor(options) {
    this.options = options;
    this.config = options.config;
    this.logger = options.logger;
    /** @type {import('node:http').Server | undefined} */
    this.server = undefined;
    /** @type {{ host: string, port: number, tls: boolean } | undefined} */
    this.address = undefined;
    this.startedAt = Date.now();
  }

  /** @returns {string} origin of the LAN listener, or `publicUrl` when configured */
  getOrigin() {
    if (this.config.publicUrl !== undefined) return this.config.publicUrl;
    const address = this.address;
    if (address === undefined) throw new Error('dsh-mobile: origin read before the gateway listened');
    const host = address.host === '0.0.0.0' || address.host === '::' ? '127.0.0.1' : address.host;
    const bracketed = host.includes(':') ? `[${host}]` : host;
    return `${address.tls ? 'https' : 'http'}://${bracketed}:${address.port}`;
  }

  /**
   * LAN URLs a phone can dial. Empty when bound to loopback only.
   * @returns {string[]}
   */
  getLanUrls() {
    if (this.address === undefined) return [];
    const port = this.address.port;
    const scheme = this.address.tls ? 'https' : 'http';
    const bounded = this.address.host;
    if (bounded !== '0.0.0.0' && bounded !== '::') {
      return bounded.startsWith('127.') || bounded === '::1' ? [] : [`${scheme}://${bounded}:${port}`];
    }
    return lanInterfaces().map((entry) => `${scheme}://${entry.address}:${port}`);
  }

  async listen() {
    const { config, logger } = this;
    const handler = (req, res) => {
      void this.handle(req, res);
    };

    if (config.tls !== undefined) {
      let cert;
      let key;
      try {
        [cert, key] = await Promise.all([readFile(config.tls.certFile, 'utf8'), readFile(config.tls.keyFile, 'utf8')]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`dsh-mobile: cannot read tls material (${config.tls.certFile}, ${config.tls.keyFile}): ${message}`);
      }
      if (cert.trim() === '' || key.trim() === '') {
        throw new Error('dsh-mobile: tls certificate or key file is empty');
      }
      this.server = createHttpsServer({ cert, key }, handler);
    } else {
      this.server = createHttpServer(handler);
    }

    // SSE connections are long lived: disable the request timeout and cap only
    // how long a peer may take to send headers.
    this.server.requestTimeout = 0;
    this.server.headersTimeout = 30_000;
    this.server.keepAliveTimeout = 65_000;
    this.server.timeout = 0;

    this.server.on('clientError', (error, socket) => {
      logger.debug(`dsh-mobile: client error from ${clientIp(/** @type {any} */ (socket))}: ${error.message}`);
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      else socket.destroy();
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server?.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server?.off('error', onError);
        resolve(undefined);
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(config.listenPort, config.listenHost);
    });

    const address = this.server.address();
    if (address === null || typeof address === 'string') throw new Error('dsh-mobile: listener bound without a TCP address');
    this.address = { host: address.address, port: address.port, tls: config.tls !== undefined };

    if (this.address.host !== '127.0.0.1' && this.address.host !== '::1' && config.tls === undefined) {
      logger.warn(
        'dsh-mobile: LAN listener serves plain HTTP — the paired-device bearer token is readable by anyone who can ' +
          'sniff this network. Configure tls.certFile/tls.keyFile, or use a trusted tunnel, for anything beyond a ' +
          'home network you control.',
      );
    }
    logger.info(`dsh-mobile: gateway listening on ${this.getOrigin()}`);
    const lanUrls = this.getLanUrls();
    if (lanUrls.length > 0) logger.info(`dsh-mobile: phone URL ${lanUrls[0]}`);
    return this;
  }

  async close() {
    const server = this.server;
    if (server === undefined) return;
    this.server = undefined;
    await new Promise((resolve) => {
      server.close(() => resolve(undefined));
      server.closeAllConnections?.();
    });
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async handle(req, res) {
    const { config, logger, router, webRoot, pairingHandler } = this.options;
    const started = Date.now();
    try {
      if (!applyCors(req, res, config.corsOrigins)) {
        sendError(req, res, new ApiError(403, 'origin-not-allowed', 'origin is not allowed'));
        return;
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'gateway.local'}`);
      const pathname = url.pathname;

      if (pathname === '/api/v1' || pathname.startsWith('/api/v1/')) {
        await router.handle(req, res, pathname.slice('/api/v1'.length) || '/', url.search);
        return;
      }

      if (pathname === '/m/pair' || pathname.startsWith('/m/pair/')) {
        if (pairingHandler !== undefined && (await pairingHandler(req, res, pathname))) return;
        sendError(req, res, new ApiError(404, 'not-found', 'pairing is not available'));
        return;
      }

      if (pathname === '/robots.txt') {
        sendText(req, res, 200, 'User-agent: *\nDisallow: /\n');
        return;
      }

      if (await serveStatic(req, res, webRoot, pathname)) return;
      // Hash routing means the shell is the fallback for every non-asset path.
      if (await serveStatic(req, res, webRoot, '/index.html')) return;
      sendError(req, res, new ApiError(404, 'not-found', `no route for ${pathname}`));
    } catch (error) {
      if (error instanceof ApiError) {
        sendError(req, res, error);
        return;
      }
      logger.warn(`dsh-mobile: unhandled ${req.method} ${req.url}: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) sendJson(req, res, 500, { error: { code: 'internal', message: 'internal gateway error' } }, { etag: false });
      else res.destroy();
    } finally {
      if (config.debug) {
        logger.debug(
          `dsh-mobile: ${req.method} ${req.url} -> ${res.statusCode} ${Date.now() - started}ms [${describeRequest(req.headers)}]`,
        );
      }
    }
  }
}

/**
 * Create and start a gateway.
 * @param {GatewayOptions} options
 * @returns {Promise<GatewayServer>}
 */
export async function startGateway(options) {
  const server = new GatewayServer(options);
  await server.listen();
  return server;
}
