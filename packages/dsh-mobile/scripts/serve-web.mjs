#!/usr/bin/env node
/**
 * Serve the bundled PWA on a loopback port for development.
 *
 * This is a convenience only: in production the plugin's LAN listener serves the
 * same files. No dependencies, no build step.
 *
 *   node scripts/serve-web.mjs [port] [--host 127.0.0.1]
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

process.env.DSH_MOBILE_STANDALONE = '1';

const { serveStatic } = await import('../src/static.js');

const WEB_ROOT = fileURLToPath(new URL('../web/', import.meta.url));
const args = process.argv.slice(2);
const port = Number.parseInt(args.find((arg) => /^\d+$/.test(arg)) ?? '8765', 10);
const hostIndex = args.indexOf('--host');
const host = hostIndex === -1 ? '127.0.0.1' : (args[hostIndex + 1] ?? '127.0.0.1');

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${host}`);
  if (await serveStatic(req, res, WEB_ROOT, url.pathname)) return;
  if (await serveStatic(req, res, WEB_ROOT, '/index.html')) return;
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(port, host, () => {
  console.log(`DSH Mobile PWA: http://${host}:${port}/?demo=1`);
  console.log(`Foldable layout lab: http://${host}:${port}/?demo=1&lab=1`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
