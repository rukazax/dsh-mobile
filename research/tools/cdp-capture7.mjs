/** Round 7: approval sheet (click header, guarded against duplicates). */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'docs/guide/screens';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PYTHON = 'C:\\Users\\<user>\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe';
const DEBUG_PORT = 9228;
const PROFILE = 'C:\\Users\\<user>\\Documents\\deepseek-harness\\harness\\research\\tmp\\chrome-cdp7';
const BASE = 'http://127.0.0.1:3081/';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, tries = 60) {
  for (let index = 0; index < tries; index += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(250);
  }
  throw new Error('timeout');
}

const server = spawn(PYTHON, ['-m', 'http.server', '3081', '--bind', '127.0.0.1'], {
  cwd: 'packages/dsh-mobile/web',
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
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    cdp.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
};

try {
  await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  let targets = [];
  for (let index = 0; index < 40; index += 1) {
    targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    if (targets.some((t) => t.type === 'page')) break;
    await sleep(250);
  }
  cdp = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
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
  await send('Page.navigate', { url: `${BASE}?v=ap1&demo=1&theme=dark#/s/s-demo-2` });
  await sleep(6000);
  const before = await evaluate(`document.querySelectorAll('.sheet').length`);
  const clicked = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').includes('одтвержд'));
    if (!b) return 'none';
    b.click();
    return b.getAttribute('aria-label');
  })()`);
  await sleep(1200);
  const after = await evaluate(`document.querySelectorAll('.sheet').length`);
  console.log('approval:', JSON.stringify({ before, clicked, after }));
  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(OUT, '03-approval.png'), Buffer.from(png.data, 'base64'));
  console.log('03-approval.png written');
} catch (error) {
  console.error('FAILED:', error.message);
} finally {
  try {
    cdp?.close();
  } catch {}
  chrome.kill();
  server.kill();
  await sleep(400);
}
