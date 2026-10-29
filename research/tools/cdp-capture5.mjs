/**
 * Round 5: capture the auto-opened approval/question sheets without any click
 * (the sheet opens by itself when a pending approval/question arrives).
 *
 *   node cdp-capture5.mjs <outDir> <webRoot>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'docs/guide/screens';
const WEB_ROOT = process.argv[3] ?? 'packages/dsh-mobile/web';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PYTHON = 'C:\\Users\\<user>\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe';
const DEBUG_PORT = 9226;
const PROFILE = 'C:\\Users\\<user>\\Documents\\deepseek-harness\\harness\\research\\tmp\\chrome-cdp5';
const BASE = 'http://127.0.0.1:3081/';

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

const server = spawn(PYTHON, ['-m', 'http.server', '3081', '--bind', '127.0.0.1'], {
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

async function capture(name) {
  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(png.data, 'base64');
  writeFileSync(join(OUT, name), bytes);
  console.log(`[shot] ${name.padEnd(20)} ${String(bytes.length).padStart(7)}B`);
}

async function open(url, waitMs) {
  await send('Page.navigate', { url });
  await sleep(waitMs);
}

try {
  await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
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
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844,
  });

  await open(`${BASE}?v=s2&demo=1&theme=dark#/s/s-demo-2`, 6000);
  console.log('approval sheets:', await evaluate(`document.querySelectorAll('.sheet').length`));
  await capture('03-approval.png');

  await open(`${BASE}?v=s6&demo=1&theme=dark#/s/s-demo-6`, 6000);
  console.log('question sheets:', await evaluate(`document.querySelectorAll('.sheet').length`));
  await capture('04-question.png');
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
