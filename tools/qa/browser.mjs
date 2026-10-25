#!/usr/bin/env node
// QA 用 Chrome headless 驱动：复用 tools/shot.mjs 的 CDP 思路，但支持多步骤操作、
// 控制台/网络监听、动态视口、真实鼠标键盘输入与截图。
// 仅用于独立 QA，不修改产品代码。
//
// 作为 CLI：
//   node tools/qa/regress.mjs            # 完整浏览器回归（本文件是它的底座）
// 作为模块：
//   import { openBrowser } from './browser.mjs';
//   const b = await openBrowser({ width: 1440, height: 900 });
//   await b.goto('http://127.0.0.1:8787');
//   const state = await b.evalJs('window.__HORRIBLE_DORM.state.now');
//   await b.shot('shots/qa/menu.png');
//   await b.close();

import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let portSeq = 9600 + Math.floor(Math.random() * 300);

const KEY_MAP = {
  ' ': { code: 'Space', vk: 32, text: ' ' },
  Space: { code: 'Space', vk: 32, text: ' ' },
  Escape: { code: 'Escape', vk: 27 },
  Esc: { code: 'Escape', vk: 27 },
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  Tab: { code: 'Tab', vk: 9 },
  q: { code: 'KeyQ', vk: 81, text: 'q' },
  r: { code: 'KeyR', vk: 82, text: 'r' },
};

function keyInfo(key) {
  if (KEY_MAP[key]) return KEY_MAP[key];
  if (/^[0-9]$/.test(key)) {
    return { code: `Digit${key}`, vk: 48 + Number(key), text: key };
  }
  if (/^[a-zA-Z]$/.test(key)) {
    const upper = key.toUpperCase();
    return { code: `Key${upper}`, vk: upper.charCodeAt(0), text: key };
  }
  return { code: key, vk: 0 };
}

export class BrowserDriver {
  constructor({ width = 1440, height = 900, port, chromePath = CHROME, profileDir } = {}) {
    this.width = width;
    this.height = height;
    this.port = port || portSeq++;
    this.chromePath = chromePath;
    this.profileDir = profileDir || path.join('/tmp', `dorm-qa-chrome-${this.port}-${Date.now()}`);
    this.proc = null;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.consoleWarnings = [];
    this.exceptions = [];
    this.logEntries = [];
    this.requests = [];
    this.responses = [];
    this.failures = [];
    this.pageErrors = [];
    this._waiters = [];
  }

  async launch() {
    this.proc = spawn(this.chromePath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.profileDir}`,
      `--window-size=${this.width},${this.height}`,
      '--hide-scrollbars',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    this.proc.stderr?.on('data', () => {});
    await this._connect();
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    await this.send('Log.enable');
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: this.width, height: this.height, deviceScaleFactor: 1, mobile: false,
    });
    return this;
  }

  async _connect() {
    let info = null;
    for (let i = 0; i < 60; i += 1) {
      try {
        const list = await fetch(`http://127.0.0.1:${this.port}/json/list`).then((r) => r.json());
        info = list?.find((t) => t.type === 'page') || null;
        if (info) break;
      } catch { /* not ready */ }
      await sleep(120);
    }
    if (!info) throw new Error('Chrome DevTools 端点不可用（headless Chrome 启动失败？）');
    this.ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => this._onMessage(event));
  }

  _onMessage(event) {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.id && this.pending.has(data.id)) {
      const { resolve, reject } = this.pending.get(data.id);
      this.pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message || JSON.stringify(data.error)));
      else resolve(data.result);
      return;
    }
    const params = data.params || {};
    if (data.method === 'Runtime.exceptionThrown') {
      this.exceptions.push({
        text: params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'JS exception',
        url: params.exceptionDetails?.url,
      });
    } else if (data.method === 'Runtime.consoleAPICalled') {
      const text = (params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      if (params.type === 'error' || params.type === 'assert') this.consoleErrors.push(text);
      else if (params.type === 'warning') this.consoleWarnings.push(text);
    } else if (data.method === 'Log.entryAdded') {
      const entry = params.entry || {};
      this.logEntries.push({ level: entry.level, text: entry.text, url: entry.url, source: entry.source });
    } else if (data.method === 'Network.requestWillBeSent') {
      this.requests.push({
        url: params.request?.url || '',
        method: params.request?.method || 'GET',
        type: params.type || '',
        ts: Date.now(),
      });
    } else if (data.method === 'Network.responseReceived') {
      this.responses.push({
        url: params.response?.url || '',
        status: params.response?.status,
        type: params.type || '',
        mime: params.response?.mimeType,
      });
    } else if (data.method === 'Network.loadingFailed') {
      this.failures.push({
        url: params.requestId,
        error: params.errorText,
        type: params.type,
        canceled: !!params.canceled,
      });
    } else if (data.method === 'Page.javascriptDialogOpening') {
      this.pageErrors.push(`dialog:${params.message}`);
    }
    if (this._waiters.length) {
      for (const waiter of this._waiters.slice()) {
        waiter();
      }
    }
  }

  send(method, params = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, timeoutMs);
    });
  }

  async goto(url, { wait = 1200 } = {}) {
    await this.send('Page.navigate', { url });
    await this._waitLoad(wait);
    return this;
  }

  async _waitLoad(wait) {
    const start = Date.now();
    const deadline = start + Math.max(wait, 100);
    while (Date.now() < deadline) {
      const ready = await this.evalJs('document.readyState').catch(() => '');
      const booted = await this.evalJs(
        `(() => { const b = document.getElementById('boot-screen'); const app = document.querySelector('[data-hd-ui]'); return Boolean(app) && (!b || b.classList.contains('is-hidden') || b.hidden); })()`,
      ).catch(() => false);
      if (ready === 'complete' && booted) break;
      await sleep(120);
    }
    await sleep(250);
  }

  async evalJs(expression, { awaitPromise = true, timeoutMs = 20000 } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    }, timeoutMs);
    if (result?.exceptionDetails) {
      const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(`页面脚本异常: ${desc} :: expr=${String(expression).slice(0, 160)}`);
    }
    return result?.result?.value;
  }

  async waitFor(expression, { timeout = 6000, interval = 80 } = {}) {
    const start = Date.now();
    let last;
    while (Date.now() - start < timeout) {
      last = await this.evalJs(expression).catch((err) => ({ error: err.message }));
      if (last) return last;
      await sleep(interval);
    }
    throw new Error(`waitFor 超时: ${expression} (最后结果 ${JSON.stringify(last)})`);
  }

  async setViewport(width, height, { mobile = false, wait = 450 } = {}) {
    this.width = width;
    this.height = height;
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile,
    });
    if (mobile) {
      await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else {
      await this.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
    }
    await sleep(wait);
  }

  async shot(outPath, { fullPage = false } = {}) {
    await mkdir(path.dirname(outPath), { recursive: true }).catch(() => {});
    const shot = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: fullPage,
    });
    await writeFile(outPath, Buffer.from(shot.data, 'base64'));
    return outPath;
  }

  async mouseMove(x, y) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, button: 'none', buttons: 0,
    });
  }

  async click(x, y, { button = 'left', clickCount = 1 } = {}) {
    await this.mouseMove(x, y);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button, buttons: button === 'left' ? 1 : 2, clickCount,
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button, buttons: 0, clickCount,
    });
    await sleep(90);
  }

  async rightClick(x, y) {
    await this.mouseMove(x, y);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1,
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1,
    });
    // 部分 headless 版本不会自动派发 contextmenu，这里补一条原始事件。
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1,
    }).catch(() => {});
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1,
    }).catch(() => {});
    await sleep(90);
  }

  async wheel(x, y, deltaY = 400, deltaX = 0) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x, y, deltaX, deltaY, button: 'none', buttons: 0,
    });
    await sleep(200);
  }

  async clickSelector(selector) {
    const box = await this.evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      return {
        x: cx, y: cy, w: r.width, h: r.height,
        visible: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden',
        hit: Boolean(top && (top === el || el.contains(top))),
        topTag: top ? (top.tagName + '.' + top.className) : null,
      };
    })()`);
    if (!box) throw new Error(`找不到选择器: ${selector}`);
    if (!box.visible) throw new Error(`元素不可见: ${selector}`);
    if (!box.hit) throw new Error(`元素被遮挡: ${selector} (命中 ${box.topTag})`);
    await this.click(box.x, box.y);
    return box;
  }

  async key(key, { modifiers = 0 } = {}) {
    const info = keyInfo(key);
    const base = {
      modifiers,
      key,
      code: info.code,
      windowsVirtualKeyCode: info.vk,
      nativeVirtualKeyCode: info.vk,
    };
    if (info.text) {
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: info.text });
    } else {
      await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    }
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(120);
  }

  async reload({ wait = 1400 } = {}) {
    await this.send('Page.reload', { ignoreCache: false });
    await this._waitLoad(wait);
  }

  clearEvents() {
    this.consoleErrors = [];
    this.consoleWarnings = [];
    this.exceptions = [];
    this.logEntries = [];
    this.requests = [];
    this.responses = [];
    this.failures = [];
    this.pageErrors = [];
  }

  async close() {
    try { this.ws?.close(); } catch { /* ignore */ }
    try { this.proc?.kill('SIGKILL'); } catch { /* ignore */ }
    await sleep(200);
    await rm(this.profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function openBrowser(options = {}) {
  const driver = new BrowserDriver(options);
  await driver.launch();
  return driver;
}

export const sleepMs = sleep;
