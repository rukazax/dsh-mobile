/**
 * Round 3: retake the question sheet (round 2 caught two stacked sheets) and
 * capture the real pairing page served by a running DSH host.
 *
 *   node cdp-capture3.mjs <outDir> <webRoot> <pairToken>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'docs/guide/screens';
const WEB_ROOT = process.argv[3] ?? 'packages/dsh-mobile/web';
const PAIR_TOKEN = process.argv[4];
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PYTHON = 'C:\\Users\\<user>\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe';
const SERVER_PORT = 3081;
const DEBUG_PORT = 9224;
const PROFILE = 'C:\\Users\\<user>\\Documents\\deepseek-harness\\harness\\research\\tmp\\chrome-cdp3';
const BASE = `http://127.0.0.1:${SERVER_PORT}/`;
const DSH_BASE = 'http://127.0.0.1:18081';

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, tries = 60) {
  for (let index = 0; index < tries; index += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* not ready */
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}`);
}

const server = spawn(PYTHON, ['-m', 'http.server', String(SERVER_PORT), '--bind', '127.0.0.1'], {
  cwd: WEB_ROOT,
  stdio: 'ignore',
});
const chrome = spawn(
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

let cdp;
let messageId = 0;
const pending = new Map();

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

async function metrics(width, height, scale, mobile) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: scale,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
}

async function capture(name) {
  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(png.data, 'base64');
  writeFileSync(join(OUT, name), bytes);
  console.log(`[shot] ${name.padEnd(28)} ${String(bytes.length).padStart(7)}B`);
}

async function open(url, waitMs = 3000) {
  await send('Page.navigate', { url });
  await sleep(waitMs);
}

try {
  const version = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  console.log('browser:', version['Browser']);
  let targets = [];
  for (let index = 0; index < 40; index += 1) {
    targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    if (targets.some((target) => target.type === 'page')) break;
    await sleep(250);
  }
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
    if (message.error) entry?.reject(new Error(`${message.error.code}: ${message.error.message}`));
    else entry?.resolve(message.result);
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.clearBrowserCache').catch(() => {});
  await metrics(390, 844, 2, true);

  // Question sheet, opened once, with a long settle time.
  await open(`${BASE}?v=q1&demo=1&theme=dark#/s/s-demo-6`, 5500);
  const before = await evaluate(`document.querySelectorAll('.sheet').length`);
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').includes('Вопрос'));
    if (button === undefined) return 'none';
    button.click();
    return button.getAttribute('aria-label');
  })()`);
  await sleep(2500);
  const after = await evaluate(`({
    sheets: document.querySelectorAll('.sheet').length,
    sheetText: (document.querySelector('.sheet')?.innerText || '').slice(0, 120),
  })`);
  console.log('question:', JSON.stringify({ before, clicked, after }));
  await capture('04-question.png');

  // Real pairing page served by the DSH host (cookie exchanged via token URL).
  if (PAIR_TOKEN !== undefined && PAIR_TOKEN !== '') {
    await metrics(1440, 1000, 1, false);
    await open(`${DSH_BASE}/?token=${encodeURIComponent(PAIR_TOKEN)}`, 2500);
    await open(`${DSH_BASE}/m/pair`, 2500);
    const heading = await evaluate(`document.querySelector('h1')?.textContent || 'no h1'`);
    const code = await evaluate(`(document.querySelector('.code')?.innerText || '').replace(/\\s+/g, ' ').trim()`);
    console.log('pair page:', heading, '| code:', code);
    await capture('11-pair-page-pc.png');
  }
} catch (error) {
  console.error('CAPTURE FAILED:', error.message);
  process.exitCode = 1;
} finally {
  try {
    cdp?.close();
  } catch {
    /* ignore */
  }
  chrome.kill();
  server.kill();
  await sleep(500);
}

