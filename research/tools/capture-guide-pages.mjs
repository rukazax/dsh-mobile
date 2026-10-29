/** Screenshot selected guide pages for visual QA. */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const GUIDE = process.argv[2];
const OUT = process.argv[3] ?? 'research/tmp/guide-pages';
const WANTED = (process.argv[4] ?? '1,2,3,6,7,9,11,16').split(',').map(Number);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9230;
const PROFILE = 'C:\\Users\\<user>\\Documents\\deepseek-harness\\harness\\research\\tmp\\chrome-guide2';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
mkdirSync(OUT, { recursive: true });

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

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--window-size=900,1200',
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
  await send('Page.navigate', { url: pathToFileURL(GUIDE).href });
  await sleep(2500);
  for (const number of WANTED) {
    const box = await evaluate(`(() => {
      const p = document.querySelectorAll('section.page')[${number - 1}];
      if (!p) return null;
      p.scrollIntoView();
      const r = p.getBoundingClientRect();
      return { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height };
    })()`);
    if (box === null) continue;
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: Math.max(0, box.y), width: box.width, height: box.height, scale: 1 },
    });
    const file = join(OUT, `page-${String(number).padStart(2, '0')}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log('shot:', file);
  }
} catch (error) {
  console.error('FAILED:', error.message);
} finally {
  try {
    cdp?.close();
  } catch {}
  chrome.kill();
  await sleep(300);
}
