/**
 * HTTP plumbing for the DSH Mobile gateway: body limits, JSON envelopes,
 * compression negotiation, ETags and CORS.
 *
 * @module dsh-mobile/src/http
 */

import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { nowIso } from './util.js';

/** Responses below this size are not worth compressing. */
const COMPRESS_THRESHOLD = 1024;

/** Security headers common to every gateway response. */
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/**
 * @typedef {object} ApiErrorShape
 * @property {string} code machine-readable code
 * @property {string} message human-readable message
 * @property {string} [requestId]
 */

/** Error carrying an HTTP status and a protocol error code. */
export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
export function fail(status, code, message) {
  throw new ApiError(status, code, message);
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {string} remote address without the IPv6-mapped prefix
 */
export function clientIp(req) {
  const address = req.socket?.remoteAddress ?? '';
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {string | undefined} bearer token from the Authorization header
 */
export function bearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim();
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {URL}
 */
export function requestUrl(req) {
  const host = typeof req.headers.host === 'string' ? req.headers.host : '127.0.0.1';
  return new URL(req.url ?? '/', `http://${host}`);
}

/**
 * Read a request body with a hard byte limit.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<Buffer>}
 */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new ApiError(413, 'body-too-large', `request body exceeds ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (error) => reject(error));
  });
}

/**
 * Read and parse a JSON request body.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readJson(req, limit) {
  const contentType = String(req.headers['content-type'] ?? '');
  if (!/^application\/json\b/i.test(contentType)) {
    throw new ApiError(415, 'unsupported-media-type', 'Content-Type must be application/json');
  }
  const buffer = await readBody(req, limit);
  if (buffer.length === 0) return {};
  let parsed;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new ApiError(400, 'invalid-json', 'request body is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'invalid-json', 'request body must be a JSON object');
  }
  return parsed;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {Buffer} body
 * @returns {{ body: Buffer, encoding: string }}
 */
function encode(req, body) {
  if (body.length < COMPRESS_THRESHOLD) return { body, encoding: 'identity' };
  const accept = String(req.headers['accept-encoding'] ?? '');
  if (/\bbr\b/.test(accept)) {
    const compressed = brotliCompressSync(body, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
    });
    if (compressed.length < body.length) return { body: compressed, encoding: 'br' };
  }
  if (/\bgzip\b/.test(accept)) {
    const compressed = gzipSync(body, { level: 6 });
    if (compressed.length < body.length) return { body: compressed, encoding: 'gzip' };
  }
  return { body, encoding: 'identity' };
}

/**
 * @param {string} value
 * @returns {string} weak ETag for a string payload
 */
export function etagOf(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `W/"${value.length.toString(36)}-${hash.toString(36)}"`;
}

/**
 * Apply CORS headers. The gateway authenticates with a bearer token and never
 * with cookies, so a wildcard origin does not create a CSRF surface.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string[]} origins
 * @returns {boolean} whether the request is an allowed CORS request
 */
export function applyCors(req, res, origins) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  if (origin === undefined) return true;
  const allowed = origins.includes('*') || origins.includes(origin);
  if (!allowed) return false;
  res.setHeader('Access-Control-Allow-Origin', origins.includes('*') ? '*' : origin);
  res.setHeader('Vary', 'Origin, Accept-Encoding');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {Record<string, string>} headers
 */
export function setHeaders(res, headers) {
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
}

/**
 * Write a JSON response honouring ETag and compression.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 * @param {{ etag?: boolean, headers?: Record<string, string> }} [options]
 */
export function sendJson(req, res, status, payload, options = {}) {
  if (res.writableEnded) return;
  const text = JSON.stringify(payload);
  const tag = options.etag === false ? undefined : etagOf(text);
  setHeaders(res, { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  if (tag !== undefined) {
    res.setHeader('ETag', tag);
    const ifNoneMatch = req.headers['if-none-match'];
    if (typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').some((value) => value.trim() === tag)) {
      res.writeHead(304);
      res.end();
      return;
    }
  }
  if (options.headers !== undefined) setHeaders(res, options.headers);
  const encoded = encode(req, Buffer.from(text, 'utf8'));
  res.setHeader('Content-Encoding', encoded.encoding === 'identity' ? 'identity' : encoded.encoding);
  if (encoded.encoding !== 'identity') res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('Content-Length', String(encoded.body.length));
  res.writeHead(status);
  res.end(req.method === 'HEAD' ? undefined : encoded.body);
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {ApiError} error
 * @param {string} [requestId]
 */
export function sendError(req, res, error, requestId) {
  /** @type {ApiErrorShape} */
  const body = { code: error.code, message: error.message };
  if (requestId !== undefined) body.requestId = requestId;
  sendJson(req, res, error.status, { error: body, at: nowIso() }, { etag: false });
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} text
 * @param {Record<string, string>} [headers]
 */
export function sendText(req, res, status, text, headers = {}) {
  if (res.writableEnded) return;
  setHeaders(res, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  const encoded = encode(req, Buffer.from(text, 'utf8'));
  res.setHeader('Content-Encoding', encoded.encoding === 'identity' ? 'identity' : encoded.encoding);
  res.setHeader('Content-Length', String(encoded.body.length));
  res.writeHead(status);
  res.end(req.method === 'HEAD' ? undefined : encoded.body);
}

export { BASE_HEADERS, COMPRESS_THRESHOLD };
