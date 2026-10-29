/**
 * The pairing page served on the native DSH origin (loopback).
 *
 * This page is the only place a pairing code is ever displayed. It lives on the
 * desktop GUI origin — never on the LAN listener — so a code can only be read
 * by someone who already controls the PC session. Requests are authorized with
 * the DSH browser session (`ctx.connection.admit`), not with a device token.
 *
 * @module dsh-mobile/src/pairing
 */

import { randomBytes } from 'node:crypto';
import { sendJson } from './http.js';
import { nowIso } from './util.js';

/**
 * @typedef {object} PairingContext
 * @property {import('./config.js').MobileConfig} config
 * @property {import('./auth.js').AuthManager} auth
 * @property {() => string[]} lanUrls
 * @property {string} appVersion
 * @property {string} hostName
 * @property {(code: string) => string | undefined} qrDataUrl optional QR renderer
 */

/**
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * @param {PairingContext} context
 * @param {{ code: string, expiresAt: string, ttlSec: number, devices: Array<Record<string, unknown>> }} info
 * @returns {string}
 */
function renderPage(context, info) {
  const nonce = randomBytes(16).toString('base64url');
  const urls = context.lanUrls();
  const primaryUrl = urls[0] ?? 'http://127.0.0.1';
  const deviceRows =
    info.devices.length === 0
      ? '<tr><td colspan="3" class="empty">Пока нет подключённых устройств</td></tr>'
      : info.devices
          .map((device) => {
            const revoked = typeof device.revokedAt === 'string';
            const lastSeen = String(device.lastSeenAt ?? '').replace('T', ' ').slice(0, 19);
            return `<tr>
      <td><strong>${escapeHtml(String(device.label ?? '—'))}</strong><br><span class="muted">${escapeHtml(lastSeen)}</span></td>
      <td class="muted">${escapeHtml(String(device.platform ?? 'unknown'))}${revoked ? ' · отозвано' : ''}</td>
      <td>${revoked ? '' : `<button class="link danger" data-revoke="${escapeHtml(String(device.id ?? ''))}">Отозвать</button>`}</td>
    </tr>`;
          })
          .join('\n');

  const codeGroups = info.code.match(/.{1,4}/g) ?? [info.code];
  const codeMarkup = codeGroups.map((group) => `<span class="code-group">${escapeHtml(group)}</span>`).join('');
  const urlItems =
    urls.length === 0
      ? '<li class="muted">Сетевой интерфейс не найден — подключитесь к Wi-Fi.</li>'
      : urls
          .map(
            (url) =>
              `<li><code>${escapeHtml(url)}</code><button class="link" data-copy="${escapeHtml(url)}">копировать</button></li>`,
          )
          .join('');

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>DSH Mobile — подключение телефона</title>
<style>
  :root { --bg:#0f1115; --panel:#171a21; --text:#e8eaf0; --muted:#9aa3b2; --accent:#4b8dff; --danger:#ff6b6b; --ok:#39c07a; --border:#262b36; }
  @media (prefers-color-scheme: light) { :root { --bg:#f5f7fb; --panel:#fff; --text:#14171d; --muted:#5b6472; --border:#e2e6ee; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 -apple-system,"Segoe UI",Roboto,system-ui,sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 28px; }
  .grid { display:grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
  .card { background: var(--panel); border:1px solid var(--border); border-radius:16px; padding:20px; }
  .card h2 { font-size:15px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0 0 14px; }
  .code { display:flex; gap:10px; justify-content:center; margin: 8px 0 6px; font: 700 34px/1 ui-monospace,Consolas,monospace; letter-spacing:.02em; }
  .code-group { background: rgba(75,141,255,.14); color: var(--accent); border-radius:10px; padding: 12px 10px; }
  .hint { text-align:center; color:var(--muted); font-size:13px; }
  ul { list-style:none; padding:0; margin:0; }
  li { display:flex; gap:10px; align-items:center; flex-wrap:wrap; padding:8px 0; border-bottom:1px solid var(--border); }
  li:last-child { border-bottom:0; }
  code { font: 13px ui-monospace,Consolas,monospace; background: rgba(127,127,127,.12); padding:3px 7px; border-radius:6px; }
  .link { background:none; border:0; color:var(--accent); font:inherit; font-size:13px; cursor:pointer; padding:4px 2px; }
  .link.danger { color: var(--danger); }
  table { width:100%; border-collapse: collapse; font-size:14px; }
  td { padding:10px 6px; border-bottom:1px solid var(--border); vertical-align: top; }
  tr:last-child td { border-bottom:0; }
  .muted { color: var(--muted); font-size:13px; }
  .empty { color: var(--muted); text-align:center; }
  .row { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-top:16px; }
  button.primary { background: var(--accent); color:#08131f; border:0; border-radius:10px; padding:10px 16px; font-weight:600; cursor:pointer; }
  button.ghost { background:none; color:var(--text); border:1px solid var(--border); border-radius:10px; padding:10px 16px; cursor:pointer; }
  .banner { border:1px solid var(--border); border-radius:12px; padding:12px 14px; font-size:13px; color:var(--muted); margin-top:18px; }
  .banner.warn { border-color: rgba(255,107,107,.4); color: var(--text); background: rgba(255,107,107,.06); }
  .toast { position: fixed; inset: auto 0 24px; display:flex; justify-content:center; pointer-events:none; }
  .toast span { background: var(--panel); border:1px solid var(--border); border-radius: 999px; padding:8px 16px; font-size:13px; opacity:0; transition: opacity .2s; }
  .toast span.on { opacity:1; }
</style>
</head>
<body>
<main>
  <h1>DSH Mobile</h1>
  <p class="sub">Удалённое управление DeepSeek Harness с телефона — код привязки</p>

  <div class="grid">
    <section class="card">
      <h2>Код привязки</h2>
      <div class="code" aria-label="код привязки">${codeMarkup}</div>
      <p class="hint">Введите этот код в приложении DSH Mobile.<br>Действует ${Math.max(1, Math.round(info.ttlSec / 60))} мин, одноразовый.</p>
      <div class="row">
        <button class="primary" id="rotate">Новый код</button>
        <button class="ghost" data-copy="${escapeHtml(info.code)}">Скопировать код</button>
      </div>
    </section>

    <section class="card">
      <h2>Адрес сервера</h2>
      <ul>${urlItems}</ul>
      <p class="hint" style="margin-top:12px">Телефон и компьютер должны быть в одной сети Wi-Fi.</p>
    </section>
  </div>

  <section class="card" style="margin-top:20px">
    <h2>Устройства</h2>
    <table><tbody>${deviceRows}</tbody></table>
  </section>

  <div class="banner warn">
    Этот канал управления даёт полный доступ к сессиям агента на этом компьютере.
    Привязывайте только свои устройства и отзывайте доступ, когда он больше не нужен.
  </div>
  <div class="banner">
    Сервер: ${escapeHtml(context.hostName)} · версия DSH ${escapeHtml(context.appVersion)} · сформировано ${escapeHtml(nowIso())}
  </div>
</main>
<div class="toast"><span id="toast"></span></div>
<script nonce="${nonce}">
  const code = ${JSON.stringify(info.code)};
  const toast = document.getElementById('toast');
  let toastTimer;
  function notify(text) {
    toast.textContent = text;
    toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('on'), 1800);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); notify('Скопировано'); }
    catch { notify('Не удалось скопировать'); }
  }
  document.addEventListener('click', async (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target === null) return;
    const copyValue = target.getAttribute('data-copy');
    if (copyValue !== null) { event.preventDefault(); await copy(copyValue); return; }
    const revokeId = target.getAttribute('data-revoke');
    if (revokeId !== null) {
      event.preventDefault();
      if (!confirm('Отозвать доступ этого устройства?')) return;
      const response = await fetch('/m/pair/revoke', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ deviceId: revokeId }) });
      if (response.ok) { notify('Устройство отозвано'); setTimeout(() => location.reload(), 600); }
      else notify('Не удалось отозвать');
    }
  });
  document.getElementById('rotate').addEventListener('click', async () => {
    const response = await fetch('/m/pair/rotate', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
    if (response.ok) { notify('Код обновлён'); setTimeout(() => location.reload(), 500); }
    else notify('Не удалось обновить код');
  });
</script>
</body>
</html>`;
}

/**
 * Serve the pairing page and its small JSON API.
 * @param {PairingContext} context
 * @param {(req: import('node:http').IncomingMessage) => Promise<boolean>} authorizeOwner
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, pathname: string) => Promise<boolean>}
 */
export function createPairingHandler(context, authorizeOwner) {
  return async function handlePairing(req, res, pathname) {
    const owner = await authorizeOwner(req);
    if (!owner) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Откройте эту страницу в окне DeepSeek Harness на этом компьютере.');
      return true;
    }

    const method = req.method ?? 'GET';
    if (pathname === '/m/pair' && method === 'GET') {
      const info = await context.auth.pairingInfo();
      const html = renderPage(context, info);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      });
      res.end(html);
      return true;
    }

    if (pathname === '/m/pair.json' && method === 'GET') {
      const info = await context.auth.pairingInfo();
      sendJson(req, res, 200, {
        code: info.code,
        expiresAt: info.expiresAt,
        ttlSec: info.ttlSec,
        lanUrls: context.lanUrls(),
        devices: info.devices,
        hostName: context.hostName,
        appVersion: context.appVersion,
        qr: context.qrDataUrl?.(info.code),
      });
      return true;
    }

    if (pathname === '/m/pair/rotate' && method === 'POST') {
      const pairing = await context.auth.rotatePairing();
      sendJson(req, res, 200, { code: pairing.code, expiresAt: pairing.expiresAt });
      return true;
    }

    if (pathname === '/m/pair/revoke' && method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        body = {};
      }
      const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
      const removed = deviceId === '' ? false : await context.auth.revoke(deviceId);
      sendJson(req, res, removed ? 200 : 404, removed ? { ok: true } : { error: { code: 'not-found', message: 'device not found' } });
      return true;
    }

    if (pathname === '/m/pair' || pathname === '/m/pair.json') {
      res.writeHead(405, { Allow: 'GET' });
      res.end();
      return true;
    }
    return false;
  };
}

export { renderPage, escapeHtml };
