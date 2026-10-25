// E2E 冒烟测试：真实 headless Chrome + 本地服务，覆盖“能启动 / 能进入对局 / 核心交互不报错”。
// 更完整的人工验收见 tools/qa/regress.mjs 与 docs/QA.md。
//
// 运行：node --test tests/e2e/
// 若本地服务未启动（npm start）或本机没有 Chrome，测试自动跳过而不是失败。
// 可用环境变量：QA_URL（默认 http://127.0.0.1:8787）、CHROME_PATH。

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { openBrowser, CHROME, sleepMs } from '../../tools/qa/browser.mjs';

const BASE = process.env.QA_URL || 'http://127.0.0.1:8787';

async function environmentProblem() {
  if (!existsSync(CHROME)) return `Chrome 不存在：${CHROME}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${BASE}/__health`, { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) return `本地服务不可用：${BASE}`;
  } catch {
    return `无法连接本地服务：${BASE}（先运行 npm start）`;
  }
  return null;
}

const problem = await environmentProblem();

test('E2E 冒烟：真实浏览器验收', { skip: problem || false }, async (t) => {
  const browser = await openBrowser({ width: 1280, height: 720 });
  try {
    await t.test('首屏加载：UI 挂载、无 console error、无外部请求/404', async () => {
      await browser.goto(BASE, { wait: 2000 });
      assert.equal(await browser.evalJs('Boolean(document.querySelector("[data-hd-ui]"))'), true);
      assert.equal(await browser.evalJs('Boolean(document.querySelector(".screen--menu"))'), true);
      assert.deepEqual(browser.consoleErrors, []);
      assert.deepEqual(browser.exceptions, []);
      const external = browser.requests.filter((r) => {
        if (r.url.startsWith('data:')) return false;
        try { return new URL(r.url).origin !== new URL(BASE).origin; } catch { return true; }
      });
      assert.deepEqual(external.map((r) => r.url), []);
      const bad = browser.responses.filter((r) => r.status >= 400);
      assert.deepEqual(bad.map((r) => `${r.status} ${r.url}`), []);
      const favicon = browser.requests.filter((r) => /favicon/.test(r.url));
      assert.equal(favicon.length, 0, 'favicon 已内联，不应产生请求');
      const canvas = await browser.evalJs('(() => { const c = document.getElementById("game-canvas"); return { w: c.clientWidth, h: c.clientHeight }; })()');
      assert.deepEqual(canvas, { w: 1280, h: 720 });
      await browser.evalJs(`window.__qaE2E = {
        click(sel) { const el = document.querySelector(sel); if (!el) throw new Error('缺少 ' + sel); el.click(); return true; },
        waitTutorial() { return Boolean(document.querySelector('.panel--tutorial')); },
        state() { return window.__HORRIBLE_DORM.state; },
        snap() { const s = window.__HORRIBLE_DORM.state; return { screen: s.screen, phase: s.phase, paused: s.paused, roomId: s.roomId, difficulty: s.difficulty, buildings: s.buildings.length, result: s.result && s.result.outcome }; },
      }; true`);
    });

    await t.test('主流程：菜单 → 难度 → 选房 → 对局 → 首次教程', async () => {
      await browser.evalJs(`window.__qaE2E.click('[data-menu="start"]')`);
      await browser.waitFor(`Boolean(document.querySelector('[data-diff="normal"]'))`, { timeout: 4000 });
      await browser.evalJs(`window.__qaE2E.click('[data-diff="normal"]')`);
      await browser.evalJs(`window.__qaE2E.click('[data-diff-confirm]')`);
      await browser.waitFor(`Boolean(document.querySelector('.screen--room'))`, { timeout: 4000 });
      assert.equal(await browser.evalJs(`document.querySelectorAll('[data-room-pick]').length`), 6);
      await browser.evalJs(`window.__qaE2E.click('[data-room-pick="room-301"]')`);
      await browser.evalJs(`window.__qaE2E.click('[data-room-confirm]')`);
      await browser.waitFor(`window.__HORRIBLE_DORM.state.screen === 'game'`, { timeout: 5000 });
      assert.equal(await browser.waitFor(`document.querySelector('.panel--tutorial') ? 'yes' : ''`, { timeout: 4000 }), 'yes');
      assert.equal(await browser.evalJs(`localStorage.getItem('hd-tutorial-seen-v1')`), '1');
      await browser.evalJs(`window.__qaE2E.click('[data-tut-skip]')`);
      await browser.waitFor(`!document.querySelector('.panel--tutorial')`, { timeout: 3000 });
      const snap = await browser.evalJs('window.__qaE2E.snap()');
      assert.equal(snap.roomId, 'room-301');
      assert.equal(snap.difficulty, 'normal');
      assert.equal(snap.phase, 'prep');
    });

    await t.test('对局交互：建造栏 / 暂停 / 帮助 4 tab', async () => {
      assert.equal(await browser.evalJs(`document.querySelectorAll('.build-card').length`), 3);
      await browser.key(' ');
      await browser.waitFor(`window.__HORRIBLE_DORM.state.paused === true`, { timeout: 3000 });
      assert.match(await browser.evalJs(`document.querySelector('[data-hd-overlays]').getAttribute('data-key') || ''`), /^pause/);
      await browser.key(' ');
      await browser.waitFor(`window.__HORRIBLE_DORM.state.paused === false`, { timeout: 3000 });
      await browser.evalJs(`window.__qaE2E.click('[data-act="hud.codex"]')`);
      await browser.waitFor(`document.querySelectorAll('[data-help-tab]').length === 4`, { timeout: 3000 });
      assert.equal(await browser.evalJs(`document.querySelectorAll('[data-help-tab]').length`), 4);
      await browser.evalJs(`window.__qaE2E.click('[data-help-tab="reactions"]')`);
      assert.equal(await browser.evalJs(`document.querySelectorAll('.reaction-card').length`), 6);
      await browser.key('Escape');
      await browser.waitFor(`document.querySelector('[data-hd-overlays]').hidden === true`, { timeout: 3000 });
      assert.deepEqual(browser.consoleErrors, []);
    });

    await t.test('结算与重开：失败结算 → 再来一局', async () => {
      await browser.evalJs(`(() => {
        const d = window.__HORRIBLE_DORM;
        const s = d.state;
        if (s.phase === 'prep') d.advance(s.prepRemaining + 0.2);
        s.player.doorHp = 0;
        d.advance(0.2);
        return s.result && s.result.outcome;
      })()`);
      await browser.waitFor(`window.__HORRIBLE_DORM.state.phase === 'defeat'`, { timeout: 4000 });
      await browser.waitFor(`document.querySelector('[data-result="restart"]')`, { timeout: 4000 });
      const result = await browser.evalJs(`window.__HORRIBLE_DORM.state.result`);
      assert.equal(result.outcome, 'defeat');
      assert.ok(result.grade);
      await browser.evalJs(`window.__qaE2E.click('[data-result="restart"]')`);
      await browser.waitFor(`window.__HORRIBLE_DORM.state.phase === 'prep'`, { timeout: 4000 });
      const snap = await browser.evalJs('window.__qaE2E.snap()');
      assert.equal(snap.screen, 'game');
      assert.equal(snap.roomId, 'room-301');
      assert.equal(snap.difficulty, 'normal');
      assert.deepEqual(browser.consoleErrors, []);
    });
  } finally {
    await browser.close();
    await sleepMs(100);
  }
});
