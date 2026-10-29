/**
 * CDP screenshot capture for the DSH Mobile manual.
 *
 * Headless Chromium is launched with a remote-debugging port and driven over the
 * DevTools Protocol from Node (no Playwright dependency). This is the only way
 * to take real screenshots in this environment: the workspace sandbox blocks the
 * named pipes Chromium needs, so the script must run with full access.
 *
 *   node cdp-capture.mjs <outDir> [webRoot]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'docs/guide/screens';
const WEB_ROOT = process.argv[3] ?? 'packages/dsh-mobile/web';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PYTHON = 'C:\\Users\\<user>\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe';
const SERVER_PORT = 3081;
const DEBUG_PORT = 9222;
const PROFILE = 'C:\\Users\\<user>\\Documents\\deepseek-harness\\harness\\research\\tmp\\chrome-cdp';
const BASE = `http://127.0.0.1:${SERVER_PORT}/`;

mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, tries = 60) {
  for (let index = 0; index < tries; index += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* not ready yet */
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

/** @type {any} */
let cdp;
let messageId = 0;
const pending = new Map();
const consoleErrors = [];
const exceptions = [];

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

async function shot(name, width, height, scale, mobile, url, waitMs = 3500) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: scale,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
  consoleErrors.length = 0;
  exceptions.length = 0;
  await send('Page.navigate', { url });
  await sleep(waitMs);
  const text = await evaluate(
    `(() => { const el = document.querySelector('.chat-scroller, .sessions-list, main') || document.body; return (el.innerText || '').slice(0, 400); })()`,
  );
  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(png.data, 'base64');
  writeFileSync(join(OUT, name), bytes);
  console.log(
    `[shot] ${name.padEnd(26)} ${String(bytes.length).padStart(7)}B  errors=${consoleErrors.length} exceptions=${exceptions.length}`,
  );
  console.log(`       text: ${String(text).replaceAll('\n', ' | ').slice(0, 220)}`);
  for (const message of consoleErrors.slice(0, 3)) console.log(`       console: ${message}`);
  for (const message of exceptions.slice(0, 3)) console.log(`       exception: ${message}`);
}

try {
  const version = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  console.log('browser:', version['Browser'], 'protocol:', version['Protocol-Version']);
  let targets = [];
  for (let index = 0; index < 40; index += 1) {
    targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    if (targets.some((target) => target.type === 'page')) break;
    await sleep(250);
  }
  const page = targets.find((target) => target.type === 'page');
  if (page === undefined) throw new Error('no page target');
  cdp = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    cdp.addEventListener('open', resolve, { once: true });
    cdp.addEventListener('error', reject, { once: true });
  });
  cdp.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry?.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else entry?.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(
        message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ').slice(0, 200),
      );
    }
    if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(String(message.params.exceptionDetails?.exception?.description ?? '').slice(0, 300));
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');

  await shot('01-sessions.png', 390, 844, 2, true, `${BASE}?demo=1#/sessions`, 2500);
  await shot('02-chat.png', 390, 844, 2, true, `${BASE}?demo=1&theme=dark#/s/s-demo-1`, 6000);
  await shot('03-approval.png', 390, 844, 2, true, `${BASE}?demo=1&theme=dark#/s/s-demo-2`, 6000);
  await shot('04-question.png', 390, 844, 2, true, `${BASE}?demo=1&theme=dark#/s/s-demo-6`, 6000);
  await shot('05-settings.png', 390, 844, 2, true, `${BASE}?demo=1#/settings`, 2500);
  await shot('06-pair.png', 390, 844, 2, true, `${BASE}?demo=0#/pair`, 2500);
  await shot('08-chat-light.png', 390, 844, 2, true, `${BASE}?demo=1&theme=light#/s/s-demo-3`, 6000);

  // Foldable: emulate two viewport segments and verify the CSS media query.
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1000,
    height: 800,
    deviceScaleFactor: 2,
    mobile: true,
    screenWidth: 1000,
    screenHeight: 800,
  });
  try {
    await send('Emulation.setDisplayFeaturesOverride', {
      features: [{ orientation: 'vertical', offset: 500, maskLength: 0 }],
    });
    console.log('display features override: ok');
  } catch (error) {
    console.log('display features override failed:', error.message);
  }
  await send('Page.navigate', { url: `${BASE}?demo=1&theme=dark#/s/s-demo-1` });
  await sleep(6000);
  const foldable = await evaluate(`({
    segments: matchMedia('(horizontal-viewport-segments: 2)').matches,
    spanning: matchMedia('(spanning: single-fold-vertical)').matches,
    width: innerWidth, height: innerHeight,
    columns: getComputedStyle(document.querySelector('.app, main, body')).gridTemplateColumns,
  })`);
  console.log('foldable probe:', JSON.stringify(foldable));
  const foldPng = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(OUT, '07-foldable.png'), Buffer.from(foldPng.data, 'base64'));
  console.log(`[shot] 07-foldable.png           ${Buffer.from(foldPng.data, 'base64').length}B`);

  // Layout-lab fallback (a normal, non-foldable screen).
  await send('Emulation.clearDisplayFeaturesOverride').catch(() => {});
  await shot('09-layout-lab.png', 1280, 900, 1, false, `${BASE}?demo=1&lab=1`, 3000);
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
