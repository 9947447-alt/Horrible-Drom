#!/usr/bin/env node
// Chrome headless 截图 + 可选页面脚本执行，不引入依赖。
// 用法：node tools/shot.mjs --url http://127.0.0.1:8787 --out shots/menu.png [--script "..."] [--wait 1200] [--width 1440] [--height 900]
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const url = arg('url', 'http://127.0.0.1:8787');
const out = arg('out', 'shots/shot.png');
const width = Number(arg('width', '1440'));
const height = Number(arg('height', '900'));
const wait = Number(arg('wait', '1400'));
const evalScript = arg('script', '');
const port = Number(arg('port', String(9400 + Math.floor(Math.random() * 200))));
const profile = path.join('/tmp', `dorm-chrome-${port}-${Date.now()}`);

await mkdir(path.dirname(out), { recursive: true }).catch(() => {});

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  `--window-size=${width},${height}`,
  '--hide-scrollbars',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let ws;
let msgId = 0;
const pending = new Map();
const errors = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 15000);
  });
}

async function connect() {
  let info = null;
  for (let i = 0; i < 50; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      if (list?.length) { info = list[0]; break; }
    } catch { /* wait */ }
    await sleep(150);
  }
  if (!info) throw new Error('Chrome DevTools endpoint unavailable');
  ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message || JSON.stringify(data.error)));
      else resolve(data.result);
      return;
    }
    if (data.method === 'Runtime.exceptionThrown') {
      errors.push(data.params.exceptionDetails?.text || 'JS exception');
    }
    if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') {
      errors.push(data.params.args?.map((a) => a.value ?? a.description).join(' ') || 'console.error');
    }
  });
}

try {
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
  await send('Page.navigate', { url });
  await sleep(wait);
  if (evalScript) {
    const res = await send('Runtime.evaluate', {
      expression: evalScript,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (res?.exceptionDetails) errors.push(res.exceptionDetails.text || 'eval exception');
    await sleep(900);
  }
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(out, Buffer.from(shot.data, 'base64'));
  console.log(`saved ${out} (${width}x${height})`);
  if (errors.length) {
    console.error('browser errors:');
    for (const e of errors.slice(0, 12)) console.error(' -', e);
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  try { chrome.kill('SIGKILL'); } catch { /* ignore */ }
  await sleep(250);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
