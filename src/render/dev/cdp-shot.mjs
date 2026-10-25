// 开发用截图脚本：启动无头 Chrome，通过 CDP 截图并收集控制台错误。
// 仅用于 src/render 的视觉自测；不进入产品运行时。
//
//   node src/render/dev/cdp-shot.mjs --url=/src/render/dev/preview.html?hud=1 --out=/tmp/shot.png
//
// 可选参数：
//   --w=1280 --h=720 --dpr=1 --wait=1500 --timeout=12000 --json
//   --base=http://127.0.0.1:8899

import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opts = {
  base: 'http://127.0.0.1:8899',
  url: '/src/render/dev/preview.html',
  out: '/tmp/render-shots/shot.png',
  w: 1280,
  h: 720,
  dpr: 1,
  wait: 1600,
  timeout: 15000,
  json: false,
};
for (const a of args) {
  const m = a.match(/^--([^=]+)=(.*)$/);
  if (!m) continue;
  const [, key, value] = m;
  if (key in opts) opts[key] = typeof opts[key] === 'number' ? Number(value) : value;
  if (key === 'json') opts.json = value === '1' || value === 'true';
}
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333 + Math.floor(Math.random() * 200);
const profile = mkdtempSync(join(tmpdir(), 'render-chrome-'));
const url = opts.url.startsWith('http') ? opts.url : opts.base + opts.url;

const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--disable-crashpad',
  '--disable-breakpad',
  '--disable-gpu',
  '--hide-scrollbars',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--mute-audio',
  '--no-proxy-server',
  '--proxy-bypass-list=*',
  `--user-data-dir=${profile}`,
  `--window-size=${opts.w},${opts.h}`,
  `--force-device-scale-factor=${opts.dpr}`,
  `--remote-debugging-port=${PORT}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let stderr = '';
chrome.stderr.on('data', (d) => {
  stderr += d.toString();
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function collectErrors(cdp) {
  const out = [];
  for (const e of cdp.events) {
    if (e.method === 'Runtime.exceptionThrown') {
      out.push(e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text || 'exception');
    } else if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
      out.push(e.params.entry.text);
    } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
      out.push('console.error: ' + (e.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
    }
  }
  return out;
}

async function getVersion() {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch (e) { /* 等待 */ }
    await sleep(120);
  }
  throw new Error('Chrome 调试端口未就绪');
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(new Error('WebSocket 错误')));
    });
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id != null) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close() {
    try { this.ws.close(); } catch (e) { /* 忽略 */ }
  }
}

function fail(msg) {
  console.error('SHOT_FAIL:', msg);
  try { chrome.kill('SIGKILL'); } catch (e) { /* 忽略 */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  process.exit(1);
}

try {
  const version = await getVersion();
  const cdp = new CDP(version.webSocketDebuggerUrl);
  await cdp.ready;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: opts.w, height: opts.h, deviceScaleFactor: opts.dpr, mobile: false,
  });
  await send('Page.navigate', { url });
  await sleep(500);
  // 偶发连接重置：自动重载一次
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    const rs = r.result?.value;
    const resetHappened = cdp.events.some((e) => e.method === 'Log.entryAdded' && /ERR_CONNECTION_RESET/.test(e.params.entry.text || ''));
    if (rs !== 'loading' && resetHappened) {
      cdp.events.length = 0;
      await send('Page.reload', { ignoreCache: false });
      await sleep(900);
    } else {
      break;
    }
  }
  // 等待渲染器就绪（最多 timeout 毫秒）
  let ready = false;
  const start = Date.now();
  let errors = [];
  while (Date.now() - start < opts.timeout) {
    const res = await send('Runtime.evaluate', {
      expression: '!!(window.__ready && window.__renderer)',
      returnByValue: true,
    });
    ready = !!res.result?.value;
    errors = collectErrors(cdp);
    if (ready) break;
    await sleep(150);
  }
  await sleep(opts.wait);
  // 读取布局/性能/画面状态
  let debug = null;
  try {
    const res = await send('Runtime.evaluate', {
      expression: `(() => {
        const r = window.__renderer, s = window.__state;
        return {
          layout: r && r.getLayout && r.getLayout(s),
          perf: r && r.getPerformance ? r.getPerformance() : null,
          ready: !!window.__ready,
          state: s ? { screen: s.screen, phase: s.phase, roomId: s.roomId, monsters: (s.activeNightmares||[]).map(n=>n.type) } : null,
        };
      })()`,
      returnByValue: true,
    });
    debug = res.result?.value;
  } catch (e) { /* 忽略 */ }

  errors = collectErrors(cdp);

  const diag = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      ready: window.__ready,
      frames: window.__frames || 0,
      stateScreen: window.__state && window.__state.screen,
      canvasW: document.getElementById('game-canvas') && document.getElementById('game-canvas').width,
      canvasH: document.getElementById('game-canvas') && document.getElementById('game-canvas').height,
      stamp: document.getElementById('stamp') && document.getElementById('stamp').textContent,
      hasRenderer: !!window.__renderer,
    })`,
    returnByValue: true,
  });
  const diagValue = diag.result?.value;

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(opts.out, Buffer.from(shot.data, 'base64'));
  const report = {
    ok: ready && errors.length === 0,
    ready,
    errors: errors.slice(0, 8),
    out: opts.out,
    url,
    diag: diagValue,
    debug,
  };
  const verbose = process.argv.includes('--verbose');
  if (verbose) {
    report.eventMethods = cdp.events.map((e) => e.method);
    report.console = cdp.events
      .filter((e) => e.method === 'Runtime.consoleAPICalled')
      .map((e) => (e.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
    report.exceptions = cdp.events
      .filter((e) => e.method === 'Runtime.exceptionThrown')
      .map((e) => e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text);
  }
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`shot: ${opts.out}`);
    console.log('diag:', diagValue);
    if (!ready) console.log('WARN: 页面未在超时前就绪');
    for (const e of report.errors) console.log('ERR:', e);
    for (const c of report.console || []) console.log('CONSOLE:', c);
    if (debug?.perf) console.log('perf:', JSON.stringify(debug.perf));
    if (debug?.layout) {
      console.log('layout:', JSON.stringify({
        canvas: debug.layout.canvas,
        room: debug.layout.room,
        scale: debug.layout.tile?.scale,
        door: debug.layout.door,
        bounds: debug.layout.bounds,
      }));
    }
  }
  cdp.close();
  chrome.kill('SIGKILL');
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  process.exit(report.errors.length ? 2 : 0);
} catch (err) {
  fail(err && err.message ? err.message : String(err));
}
