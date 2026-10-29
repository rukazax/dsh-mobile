/**
 * CDP screenshot capture for the DSH Mobile manual (round 2).
 *
 * Fixes from round 1:
 *  - unique query values force a full document load for hash routes;
 *  - approval/question bottom sheets are opened by clicking the header button;
 *  - local storage is cleared for the unpaired pairing screen;
 *  - viewport-segment flags are enabled for the real foldable layout.
 *
 *   node cdp-capture2.mjs <outDir> [webRoot]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'docs/guide/screens';
const WEB_ROOT = process.argv[3] ?? 'packages/dsh-mobile/web';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PYTHON = 'C:\\Users\\<user>\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe';
const SERVER_PORT = 3081;
const DEBUG_PORT = 9223;
const PROFILE = 'C:\\Users\\<user>\\Documents\\deepseek-harness\\harness\\research\\tmp\\chrome-cdp2';
const BASE = `http://127.0.0.1:${SERVER_PORT}/`;

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
    '--enable-features=DevicePosture,ViewportSegments,DevicePostureApi',
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
  const text = await evaluate(`(document.querySelector('.chat-scroller, main') || document.body).innerText.slice(0, 160)`);
  console.log(`[shot] ${name.padEnd(26)} ${String(bytes.length).padStart(7)}B  ${String(text).replaceAll('\n', ' | ').slice(0, 140)}`);
}

async function open(url, waitMs = 2500) {
  await send('Page.navigate', { url });
  await sleep(waitMs);
}

async function clickByLabel(pattern) {
  const clicked = await evaluate(`(() => {
    const rx = new RegExp(${JSON.stringify(pattern)});
    const button = [...document.querySelectorAll('button')].find((b) => rx.test(b.getAttribute('aria-label') || ''));
    if (button === undefined) return 'none';
    button.click();
    return button.getAttribute('aria-label');
  })()`);
  console.log(`       clicked: ${clicked}`);
  await sleep(900);
  return clicked;
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
  const page = targets.find((target) => target.type === 'page');
  cdp = new WebSocket(page.webSocketDebuggerUrl);
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

  // 1. Sessions list (dark).
  await metrics(390, 844, 2, true);
  await open(`${BASE}?v=a1&demo=1#/sessions`, 2500);
  await capture('01-sessions.png');

  // 2. Chat, dark.
  await open(`${BASE}?v=a2&demo=1&theme=dark#/s/s-demo-1`, 5500);
  await capture('02-chat.png');

  // 3. Approval session + opened sheet.
  await open(`${BASE}?v=a3&demo=1&theme=dark#/s/s-demo-2`, 5000);
  await clickByLabel('одтвержд');
  await capture('03-approval.png');

  // 4. Question session + opened sheet.
  await open(`${BASE}?v=a4&demo=1&theme=dark#/s/s-demo-6`, 5000);
  await clickByLabel('опрос');
  await capture('04-question.png');

  // 5. Settings (full load).
  await open(`${BASE}?v=a5&demo=1#/settings`, 3000);
  await capture('05-settings.png');

  // 6. Pairing screen (unpaired, storage cleared).
  await open(`${BASE}?v=a6&demo=0`, 1200);
  await evaluate(`localStorage.clear(); sessionStorage.clear(); true`);
  await open(`${BASE}?v=a7&demo=0#/pair`, 3000);
  await capture('06-pair.png');

  // 7. Light theme chat.
  await metrics(390, 844, 2, true);
  await open(`${BASE}?v=a8&demo=1&theme=light#/s/s-demo-3`, 5500);
  await capture('08-chat-light.png');

  // 8. Real foldable: two viewport segments with a 24px hinge.
  await metrics(1000, 800, 2, true);
  try {
    await send('Emulation.setDisplayFeaturesOverride', {
      features: [{ orientation: 'vertical', offset: 500, maskLength: 24 }],
    });
    console.log('display features override: ok');
  } catch (error) {
    console.log('display features override failed:', error.message);
  }
  await open(`${BASE}?v=a9&demo=1&theme=dark#/s/s-demo-1`, 5500);
  const probe = await evaluate(`({
    segments2: matchMedia('(horizontal-viewport-segments: 2)').matches,
    spanning: matchMedia('(spanning: single-fold-vertical)').matches,
    columns: getComputedStyle(document.querySelector('.app') || document.body).gridTemplateColumns,
  })`);
  console.log('foldable probe:', JSON.stringify(probe));
  await capture('07-foldable.png');

  // 9. Wide tablet layout (no segments) as a comparison shot.
  await send('Emulation.clearDisplayFeaturesOverride').catch(() => {});
  await metrics(1000, 800, 2, true);
  await open(`${BASE}?v=b1&demo=1&theme=dark#/s/s-demo-2`, 5000);
  await capture('10-wide.png');
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
