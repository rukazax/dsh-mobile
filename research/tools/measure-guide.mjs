/**
 * Measure the printed guide: every <section class="page"> must fit one A4 page.
 * Reports sections taller than the screen A4 box (1123px at 96dpi) and captures
 * a screenshot of each overflow candidate.
 *
 *   node measure-guide.mjs <guide.html> <shotsDir>
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const GUIDE = process.argv[2];
const SHOTS = process.argv[3] ?? 'research/tmp/guide-shots';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9255;
const PROFILE = 'C:\\Users\\<user>\\Documents\\deepseek-harness\\harness\\research\\tmp\\chrome-guide3';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
mkdirSync(SHOTS, { recursive: true });

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
    width: 900,
    height: 1200,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 900,
    screenHeight: 1200,
  });
  await send('Page.navigate', { url: pathToFileURL(GUIDE).href });
  await sleep(2500);

  const pages = await evaluate(`[...document.querySelectorAll('section.page')].map((p, index) => ({
    index,
    height: Math.round(p.getBoundingClientRect().height),
    title: (p.querySelector('h1, h2')?.textContent || '').trim().slice(0, 48),
    scroll: p.scrollHeight,
    client: p.clientHeight,
  }))`);
  console.log('pages:', pages.length);
  let overflow = 0;
  for (const page of pages) {
    const mm = Math.round((page.height / 96) * 25.4);
    const flag = page.height > 1124 ? 'OVERFLOW' : 'ok';
    if (flag === 'OVERFLOW') overflow += 1;
    console.log(`${String(page.index + 1).padStart(2)} ${flag.padEnd(9)} ${String(page.height).padStart(5)}px ${String(mm).padStart(4)}mm  ${page.title}`);
  }
  console.log('overflow count:', overflow);

  // Screenshot each section that does not fit, for visual diagnosis.
  for (const page of pages.filter((entry) => entry.height > 1124).slice(0, 6)) {
    const box = await evaluate(`(() => {
      const p = document.querySelectorAll('section.page')[${page.index}];
      p.scrollIntoView();
      const r = p.getBoundingClientRect();
      return { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height };
    })()`);
    await send('Emulation.setDeviceMetricsOverride', {
      width: Math.ceil(box.width) + 40,
      height: Math.min(Math.ceil(box.height) + 20, 4000),
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(300);
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: Math.max(0, box.y - 10), width: box.width, height: box.height + 20, scale: 1 },
    });
    const file = join(SHOTS, `overflow-${String(page.index + 1).padStart(2, '0')}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log('shot:', file);
  }
} catch (error) {
  console.error('MEASURE FAILED:', error.message);
  process.exitCode = 1;
} finally {
  try {
    cdp?.close();
  } catch {}
  chrome.kill();
  await sleep(300);
}

