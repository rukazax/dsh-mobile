/** Diagnostic: who creates the second question sheet? */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PYTHON = 'C:\\Users\\<user>\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe';
const DEBUG_PORT = 9227;
const PROFILE = 'C:\\Users\\<user>\\Documents\\deepseek-harness\\harness\\research\\tmp\\chrome-cdp6';
const BASE = 'http://127.0.0.1:3081/';
mkdirSync(PROFILE, { recursive: true });
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
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, { resolve, reject });
    cdp.send(JSON.stringify({ id: messageId, method, params }));
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
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844,
  });
  await send('Page.navigate', { url: `${BASE}?v=dbg&demo=1&theme=dark#/s/s-demo-6` });
  await sleep(6000);

  await evaluate(`(() => {
    window.__sheetLog = [];
    const host = document.getElementById('sheets');
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1 && node.classList.contains('sheet')) {
            window.__sheetLog.push(new Error('sheet added').stack);
          }
        }
      }
    }).observe(host, { childList: true });
    return document.querySelectorAll('.sheet').length;
  })()`);

  const before = await evaluate(`document.querySelectorAll('.sheet').length`);
  const buttons = await evaluate(`[...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')).filter(Boolean)`);
  const clicked = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').includes('Вопрос'));
    if (!b) return 'none';
    b.click();
    return b.getAttribute('aria-label');
  })()`);
  await sleep(1200);
  const after = await evaluate(`({ count: document.querySelectorAll('.sheet').length, log: window.__sheetLog })`);
  console.log('before:', before, 'buttons:', JSON.stringify(buttons), 'clicked:', clicked);
  console.log('after:', JSON.stringify(after, null, 1).slice(0, 2500));
} catch (error) {
  console.error('DIAG FAILED:', error.message);
} finally {
  try {
    cdp?.close();
  } catch {}
  chrome.kill();
  server.kill();
  await sleep(400);
}
