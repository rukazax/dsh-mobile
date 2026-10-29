/**
 * Public screenshots: sanitized pairing page + additional demo screens.
 *
 * Phase A: demo PWA from a static server on :3081 (light sessions, search,
 * composer, approval sheet).
 * Phase B: the real pairing page from an isolated DSH instance, with the machine
 * name and LAN addresses rewritten in the DOM before the screenshot.
 *
 *   node capture-public-shots.mjs <outDir> <webRoot> <dshBin> <dshHome>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'docs/guide/screens';
const WEB_ROOT = process.argv[3] ?? 'packages/dsh-mobile/web';
const DSH_BIN = process.argv[4];
const DSH_HOME = process.argv[5];
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PYTHON = process.env.DSH_PYTHON ?? 'python';
const DEBUG_PORT = 9250;
const PROFILE = join(process.cwd(), 'research', 'tmp', 'chrome-public');
const BASE = 'http://127.0.0.1:3081/';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, tries = 80, delay = 250) {
  for (let index = 0; index < tries; index += 1) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      /* retry */
    }
    await sleep(delay);
  }
  throw new Error('timeout');
}

function startChrome() {
  return spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${PROFILE}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
}

let cdp;
let messageId = 0;
const pending = new Map();

async function connectCdp() {
  await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    return res.ok;
  });
  const targets = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    return list.some((target) => target.type === 'page') ? list : undefined;
  });
  cdp = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    cdp.addEventListener('open', resolve, { once: true });
    cdp.addEventListener('error', reject, { once: true });
  });
  cdp.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id === undefined) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry?.reject(new Error(message.error.message));
    else entry?.resolve(message.result);
  });
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    cdp.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'evaluate failed');
  return result.result?.value;
}

async function open(url, waitMs = 3000) {
  await send('Page.navigate', { url });
  await sleep(waitMs);
}

async function shot(name) {
  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(png.data, 'base64');
  writeFileSync(join(OUT, name), bytes);
  console.log(`[shot] ${name.padEnd(26)} ${String(bytes.length).padStart(7)}B`);
}

async function mobileMetrics() {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844,
  });
}

async function scrollChatToBottom() {
  await evaluate(`(() => {
    const scroller = document.querySelector('.chat-scroller');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    return true;
  })()`);
  await sleep(400);
}

let staticServer;
let dsh;
let chrome;

try {
  // ---------- Phase A: demo screens ----------
  staticServer = spawn(PYTHON, ['-m', 'http.server', '3081', '--bind', '127.0.0.1'], { cwd: WEB_ROOT, stdio: 'ignore' });
  await sleep(1500);
  chrome = startChrome();
  await connectCdp();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await mobileMetrics();

  await open(`${BASE}?v=p1&demo=1&theme=light#/sessions`, 2500);
  await shot('12-sessions-light.png');

  await open(`${BASE}?v=p2&demo=1&theme=light#/sessions`, 2200);
  const typed = await evaluate(`(() => {
    const input = [...document.querySelectorAll('input')].find((el) => (el.getAttribute('placeholder') || '').toLowerCase().includes('поиск'));
    if (!input) return 'no-input';
    input.value = 'пагинац';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  console.log('search input:', typed);
  await sleep(1200);
  await shot('13-search.png');

  await open(`${BASE}?v=p3&demo=1&theme=light#/s/s-demo-3`, 5000);
  const composer = await evaluate(`(() => {
    const area = document.querySelector('textarea');
    if (!area) return 'no-textarea';
    area.value = 'Добавь тест на повторный реконнект и проверь линтер.';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    area.focus();
    return 'ok';
  })()`);
  console.log('composer:', composer);
  await scrollChatToBottom();
  await sleep(800);
  await shot('14-composer.png');

  await open(`${BASE}?v=p4&demo=1&theme=light#/s/s-demo-2`, 4500);
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').includes('одтвержд'));
    if (b) b.click();
    return true;
  })()`);
  await sleep(1200);
  await shot('15-approval-light.png');

  await open(`${BASE}?v=p5&demo=1&theme=light#/s/s-demo-6`, 4500);
  await shot('16-question-light.png');

  staticServer.kill();
  chrome.kill();
  await sleep(800);
  cdp = undefined;

  // ---------- Phase B: sanitized real pairing page ----------
  try {
    rmSync(join(DSH_HOME, 'mobile-remote', 'mobile-remote.json'), { force: true });
  } catch {
    /* first run */
  }

  dsh = spawn(
    process.execPath,
    [DSH_BIN, '--profile', 'mobile', '--no-open', '--port', '18081'],
    {
      cwd: process.cwd(),
      env: { ...process.env, DSH_HOME, DSH_VERSION: '0.2.1-rc.2' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let dshLog = '';
  dsh.stdout.on('data', (chunk) => {
    dshLog += chunk.toString('utf8');
  });
  dsh.stderr.on('data', (chunk) => {
    dshLog += chunk.toString('utf8');
  });

  const tokenMatch = await waitFor(async () => {
    const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(dshLog);
    return match ? match : undefined;
  }, 120, 500);
  const token = tokenMatch[1];
  console.log('dsh token acquired, waiting for pairing route...');
  await waitFor(async () => {
    try {
      const res = await fetch('http://127.0.0.1:18081/m/pair');
      return res.status === 401;
    } catch {
      return false;
    }
  }, 60, 500);

  chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${PROFILE}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  messageId = 0;
  pending.clear();
  await connectCdp();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 1440,
    screenHeight: 1000,
  });
  await open(`http://127.0.0.1:18081/?token=${encodeURIComponent(token)}`, 2500);
  await open('http://127.0.0.1:18081/m/pair', 2500);

  const mutated = await evaluate(`(() => {
    // Machine name and any private address -> neutral placeholders, in every text node.
    const realHost = ${JSON.stringify(hostname())};
    const privateIp = /\\b(?:10|192\\.168|172\\.(?:1[6-9]|2\\d|3[01]))\\.\\d+\\.\\d+\\b/g;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue) continue;
      if (realHost && node.nodeValue.includes(realHost)) node.nodeValue = node.nodeValue.replaceAll(realHost, 'DESKTOP-PC');
      node.nodeValue = node.nodeValue.replace(privateIp, '192.168.1.10');
    }
    // LAN addresses -> documentation examples.
    const codes = [...document.querySelectorAll('.card ul li code')];
    codes.forEach((el, index) => {
      el.textContent = index === 0 ? 'http://192.168.1.10:3081' : 'http://192.168.1.11:3081';
    });
    // Device table -> empty state (no test devices in the picture).
    const body = document.querySelector('.card table tbody');
    if (body) body.innerHTML = '<tr><td colspan="3" class="empty">Пока нет подключённых устройств</td></tr>';
    return {
      hostLeft: realHost ? document.body.innerText.includes(realHost) : false,
      ipLeft: /\\b(?:10|192\\.168|172\\.(?:1[6-9]|2\\d|3[01]))\\.\\d+\\.\\d+\\b/.test(document.body.innerText),
      codes: codes.length,
    };
  })()`);
  console.log('pair page mutation:', JSON.stringify(mutated));
  await sleep(500);
  await shot('11-pair-page-pc.png');
  console.log('done');
} catch (error) {
  console.error('CAPTURE FAILED:', error.message);
  process.exitCode = 1;
} finally {
  try {
    cdp?.close();
  } catch {
    /* ignore */
  }
  chrome?.kill();
  staticServer?.kill();
  dsh?.kill();
  await sleep(500);
}
