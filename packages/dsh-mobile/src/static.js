/**
 * Static file serving for the bundled mobile PWA.
 *
 * The gateway serves `packages/dsh-mobile/web` as-is: no build step, no bundler.
 * Path traversal is rejected after resolution, ETags allow cheap revalidation,
 * and text assets are compressed on the fly.
 *
 * @module dsh-mobile/src/static
 */

import { stat, readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { BASE_HEADERS, etagOf } from './http.js';

/** @type {Record<string, string>} */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Cached on disk; safe for a session because the bundle is static per install. */
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt', '.map']);

/** @type {Map<string, { mtimeMs: number, size: number, buffer: Buffer }>} */
const fileCache = new Map();
const MAX_CACHE_ENTRIES = 64;

/**
 * Resolve a URL pathname to a file inside `root`, or `undefined` when the
 * request escapes the root or addresses a directory.
 *
 * @param {string} root absolute web root
 * @param {string} pathname decoded URL pathname
 * @returns {string | undefined}
 */
export function resolveAsset(root, pathname) {
  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (relative === '/' || relative === '') relative = '/index.html';
  if (relative.endsWith('/')) relative += 'index.html';
  const candidate = resolve(join(root, normalize(relative)));
  const rootResolved = resolve(root);
  if (candidate !== rootResolved && !candidate.startsWith(`${rootResolved}${sep}`)) return undefined;
  return candidate;
}

/**
 * @param {string} file absolute path
 * @returns {Promise<{ mtimeMs: number, size: number, buffer: Buffer } | undefined>}
 */
async function loadFile(file) {
  const cached = fileCache.get(file);
  try {
    const info = await stat(file);
    if (!info.isFile()) return undefined;
    if (cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached;
    const buffer = await readFile(file);
    const entry = { mtimeMs: info.mtimeMs, size: info.size, buffer };
    if (fileCache.size >= MAX_CACHE_ENTRIES) fileCache.delete(fileCache.keys().next().value);
    fileCache.set(file, entry);
    return entry;
  } catch {
    return undefined;
  }
}

/**
 * Serve one static asset.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} root
 * @param {string} pathname
 * @returns {Promise<boolean>} whether a file was served
 */
export async function serveStatic(req, res, root, pathname) {
  const file = resolveAsset(root, pathname);
  if (file === undefined) return false;
  const entry = await loadFile(file);
  if (entry === undefined) return false;

  const extension = extname(file).toLowerCase();
  const etag = `W/"${entry.size.toString(36)}-${Math.round(entry.mtimeMs).toString(36)}"`;
  const isShell = file.endsWith('index.html') || file.endsWith('sw.js');
  const cacheControl = isShell
    ? 'no-cache'
    : extension === '.html'
      ? 'no-cache'
      : 'public, max-age=3600, stale-while-revalidate=86400';

  const headers = {
    ...BASE_HEADERS,
    'Content-Type': MIME[extension] ?? 'application/octet-stream',
    'Cache-Control': cacheControl,
    ETag: etag,
    'Accept-Ranges': 'none',
  };

  const ifNoneMatch = req.headers['if-none-match'];
  if (typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').some((value) => value.trim() === etag)) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }

  let body = entry.buffer;
  const accept = String(req.headers['accept-encoding'] ?? '');
  if (COMPRESSIBLE.has(extension) && body.length > 2048) {
    if (/\bbr\b/.test(accept)) {
      const compressed = brotliCompressSync(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } });
      if (compressed.length < body.length) {
        res.setHeader('Content-Encoding', 'br');
        body = compressed;
      }
    } else if (/\bgzip\b/.test(accept)) {
      const compressed = gzipSync(body, { level: 6 });
      if (compressed.length < body.length) {
        res.setHeader('Content-Encoding', 'gzip');
        body = compressed;
      }
    }
    if (res.getHeader('Content-Encoding') !== undefined) res.setHeader('Vary', 'Accept-Encoding');
  }

  res.setHeader('Content-Length', String(body.length));
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

/**
 * Drop cached file contents (used by tests and after an in-place install).
 */
export function clearStaticCache() {
  fileCache.clear();
}
