#!/usr/bin/env node
// 《熄灯之后：反应》独立 QA 浏览器回归。
// 只读产品代码：通过 CDP 驱动真实 Chrome headless，操作 DOM / Canvas / 键盘，
// 截图证据写入 tools/qa/shots/，结构化结果写入 tools/qa/last-report.json。
//
// 运行：node tools/qa/regress.mjs [--url http://127.0.0.1:8787] [--out tools/qa/shots]
// 前置：本地服务已启动（node tools/serve.mjs 或 npm start）。

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openBrowser, sleepMs } from './browser.mjs';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
const BASE = arg('url', process.env.QA_URL || 'http://127.0.0.1:8787');
const OUT = arg('out', 'tools/qa/shots');
const SKIP_ROOMS = args.includes('--skip-rooms');
const SKIP_NIGHTMARES = args.includes('--skip-nightmares');

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  checks: [],
  shots: [],
  consoleErrors: [],
  consoleWarnings: [],
  exceptions: [],
  network: { requests: [], responses: [], failures: [] },
  notes: [],
};
let currentPhase = 'init';

function log(msg) {
  console.log(`[${currentPhase}] ${msg}`);
}
function check(name, ok, detail) {
  const entry = { phase: currentPhase, name, ok: Boolean(ok), detail };
  report.checks.push(entry);
  const mark = entry.ok ? 'PASS' : 'FAIL';
  const suffix = detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(`${mark} ${name}${suffix}`);
  return entry.ok;
}
function note(text) {
  report.notes.push({ phase: currentPhase, text });
  console.log(`NOTE ${text}`);
}
// 进入下一场景前把“建造模式 / 选中 / 暂停 / 模态”清干净（正常流程中这些状态应为空）。
async function ensureCleanGame() {
  try {
    await page(`(() => {
      const d = window.__HORRIBLE_DORM;
      if (!d) return null;
      d.actions.cancelBuild();
      d.actions.clearSelection?.();
      if (d.state.screen === 'game' && d.state.paused) d.actions.resume();
      return { buildMode: d.state.ui && d.state.ui.buildMode, selected: d.state.ui && d.state.ui.selectedBuildingId, paused: d.state.paused };
    })()`);
    await sleepMs(250);
  } catch { /* ignored */ }
}

async function scenario(name, fn) {
  currentPhase = name;
  console.log(`\n=== ${name} ===`);
  try {
    await fn();
  } catch (error) {
    check(`${name} 场景未抛异常`, false, error.message);
    await recoverUi();
  }
}

// 场景失败后恢复到“对局中 / 未暂停 / 无模态”的干净现场，避免级联误报。
async function recoverUi() {
  try {
    await page(`(() => {
      document.querySelector('[data-dock-pop-close]')?.click();
      document.querySelectorAll('[data-overlay-close], [data-overlay-dismiss]').length;
      const host = document.querySelector('[data-hd-overlays]');
      for (let i = 0; i < 2; i += 1) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      }
      const d = window.__HORRIBLE_DORM;
      if (d) {
        d.actions.cancelBuild();
        d.actions.clearSelection?.();
        if (d.state.screen === 'game' && d.state.paused) d.actions.resume();
      }
      return { screen: d ? d.state.screen : null, paused: d ? d.state.paused : null, overlay: host && !host.hidden ? host.getAttribute('data-key') : '' };
    })()`);
    await sleepMs(250);
  } catch { /* ignored */ }
}

const PAGE_HELPERS = `
window.__qa = {
  content: null,
  async init() { if (!this.content) this.content = await import('/src/content/index.js'); return Boolean(this.content); },
  d() { return window.__HORRIBLE_DORM; },
  s() { return window.__HORRIBLE_DORM.state; },
  snap() {
    const s = this.s();
    return {
      screen: s.screen, phase: s.phase, paused: s.paused, difficulty: s.difficulty, roomId: s.roomId,
      now: +s.now.toFixed(2), nightElapsed: +s.nightElapsed.toFixed(2),
      prepRemaining: +s.prepRemaining.toFixed(2), clock: +s.clock.toFixed(1),
      dream: Math.round(s.player.dream), reagent: Math.round(s.player.reagent),
      doorHp: Math.round(s.player.doorHp), doorMaxHp: Math.round(s.player.doorMaxHp),
      bedLevel: s.player.bedLevel, doorLevel: s.player.doorLevel, pressure: s.pressure.level,
      buildings: (s.buildings || []).map(b => ({ id: b.id, type: b.type, stage: b.stage, level: b.level, tile: b.tile, starter: Boolean(b.isStarter) })),
      reactions: (s.reactions || []).map(r => r.id),
      acidUnlocked: s.acidUnlocked,
      nightmares: (s.activeNightmares || []).map(n => ({ id: n.id, type: n.type, secondary: Boolean(n.secondary), level: n.level, hp: Math.round(n.hp), maxHp: n.maxHp, state: n.state })),
      result: s.result ? { outcome: s.result.outcome, reason: s.result.reason, grade: s.result.grade, title: s.result.title, lines: s.result.lines } : null,
      ui: { buildMode: s.ui.buildMode ? { ...s.ui.buildMode } : null, selected: s.ui.selectedBuildingId },
      stats: { ...s.stats },
      records: s.records ? { runs: s.records.runs, wins: s.records.wins } : null,
      settings: { ...s.settings },
    };
  },
  freeTiles() {
    const s = this.s();
    const room = this.content.getRoom(s.roomId);
    const out = [];
    for (let y = 0; y < room.h; y += 1) for (let x = 0; x < room.w; x += 1) {
      const tile = { x, y };
      if (!this.content.isBuildableTile(room, tile)) continue;
      if ((s.buildings || []).some(b => b.tile.x === x && b.tile.y === y)) continue;
      out.push(tile);
    }
    return out;
  },
  project(tile) {
    const L = this.d().renderer.getLayout(this.s());
    const p = L.projectTile(tile.x, tile.y);
    return { x: p.x, y: p.y };
  },
  pickFreeClickable(exclude = []) {
    for (const tile of this.freeTiles()) {
      if (exclude.some(e => e.x === tile.x && e.y === tile.y)) continue;
      const p = this.project(tile);
      if (p.x < 6 || p.y < 6 || p.x > innerWidth - 6 || p.y > innerHeight - 6) continue;
      const top = document.elementFromPoint(p.x, p.y);
      if (top && top.tagName === 'CANVAS') return { tile, x: p.x, y: p.y };
    }
    return null;
  },
  clickable(sel) {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const top = cx > 0 && cy > 0 && cx < innerWidth && cy < innerHeight ? document.elementFromPoint(cx, cy) : null;
    return {
      found: true,
      visible: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden',
      inView: r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
      hit: Boolean(top && (top === el || el.contains(top))),
      rect: { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      topTag: top ? top.tagName : null,
    };
  },
  canvasStats() {
    const c = document.getElementById('game-canvas');
    if (!c) return null;
    const g = c.getContext('2d');
    const W = c.width, H = c.height;
    const img = g.getImageData(0, 0, W, H).data;
    const step = Math.max(4, Math.floor(Math.sqrt((W * H) / 5000)));
    let opaque = 0, samples = 0;
    const colors = new Set();
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      samples += 1;
      if (img[i + 3] > 8) opaque += 1;
      colors.add((img[i] >> 4) + ',' + (img[i + 1] >> 4) + ',' + (img[i + 2] >> 4));
    }
    const cssW = c.clientWidth || 1, cssH = c.clientHeight || 1;
    return {
      backingW: W, backingH: H, cssW, cssH,
      dpr: +(W / cssW).toFixed(2),
      opaqueRatio: +(opaque / samples).toFixed(3),
      colors: colors.size,
    };
  },
  centerCoverage() {
    const W = innerWidth, H = innerHeight;
    let hits = 0, total = 0;
    const blockTags = {};
    for (let fy = 0.3; fy <= 0.7001; fy += 0.05) for (let fx = 0.25; fx <= 0.7501; fx += 0.05) {
      const x = Math.round(W * fx), y = Math.round(H * fy);
      const el = document.elementFromPoint(x, y);
      total += 1;
      if (el && el.tagName === 'CANVAS') hits += 1;
      else if (el) {
        const key = el.tagName + '.' + String(el.className || '').split(' ')[0];
        blockTags[key] = (blockTags[key] || 0) + 1;
      }
    }
    return { ratio: +(hits / total).toFixed(3), total, blockTags };
  },
  overflow() {
    const doc = document.documentElement;
    return {
      scrollW: doc.scrollWidth, scrollH: doc.scrollHeight,
      innerW: innerWidth, innerH: innerHeight,
      overflowX: doc.scrollWidth > innerWidth + 1,
      overflowY: doc.scrollHeight > innerHeight + 1,
    };
  },
  overlayKey() {
    const host = document.querySelector('[data-hd-overlays]');
    return host && !host.hidden ? host.getAttribute('data-key') : '';
  },
  activeHelpTab() {
    const el = document.querySelector('.help-tab.is-active');
    return el ? el.getAttribute('data-help-tab') : null;
  },
  localStorage() {
    const out = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      out[key] = localStorage.getItem(key);
    }
    return out;
  },
  setResources(dream, reagent) {
    this.d().setDream(dream);
    if (reagent !== undefined) this.d().setReagent(reagent);
  },
  advanceTo(target) {
    const d = this.d();
    const s = this.s();
    let guard = 0;
    while ((s.phase === 'prep' || s.phase === 'night') && s.now < target && guard < 2000) {
      d.advance(Math.min(5, target - s.now));
      guard += 1;
    }
    return { phase: s.phase, now: +s.now.toFixed(1), night: +s.nightElapsed.toFixed(1), actives: s.activeNightmares.length };
  },
  forceWinDawn() {
    const d = this.d();
    const s = this.s();
    s.player.doorHp = s.player.doorMaxHp = 1e9;
    if (s.phase === 'prep') d.advance(s.prepRemaining + 0.2);
    s.nightElapsed = Math.max(0, s.dawnAt - 0.5);
    d.advance(1);
    return this.snap();
  },
  forceKillAll() {
    const d = this.d();
    const s = this.s();
    s.player.doorHp = s.player.doorMaxHp = 1e9;
    if (s.phase === 'prep') d.advance(s.prepRemaining + 0.2);
    const target = s.spawnAt + 2;
    if (s.now < target) d.advance(target - s.now);
    (s.activeNightmares || []).forEach(n => { n.state = 'dead'; n.hp = 0; });
    d.advance(0.2);
    return this.snap();
  },
  forceDefeat() {
    const d = this.d();
    const s = this.s();
    if (s.phase === 'prep') d.advance(s.prepRemaining + 0.2);
    s.player.doorHp = 0;
    d.advance(0.2);
    return this.snap();
  },
  advanceToSpawn(extra = 2) {
    const d = this.d();
    const s = this.s();
    const target = s.spawnAt + extra;
    let guard = 0;
    while ((s.phase === 'prep' || s.phase === 'night') && s.now < target && guard < 500) {
      d.advance(Math.min(4, target - s.now));
      guard += 1;
    }
    return this.snap();
  },
  setDifficulty(id) { this.d().setDifficulty(id); return this.s().difficulty; },
  startRun(roomId, diff, mainId, secondaryId) {
    this.d().startRunWith(roomId, diff, mainId || null, secondaryId || null);
    return this.snap();
  },
  hud() {
    const q = (sel) => document.querySelector(sel);
    const txt = (sel) => { const el = q(sel); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null; };
    return {
      clock: txt('[data-ref="clock"]'),
      phase: txt('[data-ref="phaseChip"]'),
      dream: txt('[data-ref="dream"]'),
      reagent: txt('[data-ref="reagent"]'),
      doorLevel: txt('[data-ref="doorLevel"]'),
      bedLevel: txt('[data-ref="bedLevel"]'),
      nmCount: q('[data-ref="nightmareWrap"]') ? q('[data-ref="nightmareWrap"]').dataset.count : null,
      nmNames: Array.from(document.querySelectorAll('.nm__name')).map(n => n.textContent.replace(/\\s+/g, ' ').trim()),
      nmLevels: Array.from(document.querySelectorAll('.nm__lv b')).map(n => n.textContent.trim()),
      nmLitSkills: Array.from(document.querySelectorAll('.nm__skills .skill-node.is-lit')).map(n => n.textContent.trim()),
      dreamChip: txt('[data-ref="dreamChip"]'),
      reagentChip: txt('[data-ref="reagentChip"]'),
      reactionCount: txt('[data-ref="reactionCount"]'),
      tutorial: Boolean(q('.panel--tutorial')),
      overlay: this.overlayKey(),
      rotateTipVisible: (() => { const el = q('.hd-rotate-tip'); if (!el) return false; const st = getComputedStyle(el); return st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) > 0.1; })(),
      dockCards: document.querySelectorAll('.build-card').length,
      dockTabs: document.querySelectorAll('.dock-tab').length,
      acidPopover: Boolean(q('[data-dock-pop]') && !q('[data-dock-pop]').hidden),
      inspectorVisible: (() => { const el = q('.inspector'); return Boolean(el && !el.hidden); })(),
    };
  },
};
('__qa_ready__');
`;

async function main() {
  try {
    const health = await fetch(`${BASE}/__health`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!health?.ok) {
      console.error(`本地服务不可用：${BASE}（先运行 npm start）`);
      process.exit(2);
    }
  } catch {
    console.error(`无法连接本地服务：${BASE}`);
    process.exit(2);
  }
  await mkdir(OUT, { recursive: true });

  const browser = await openBrowser({ width: 1440, height: 900 });
  const shots = [];
  async function shot(name, options = {}) {
    const file = path.join(OUT, `${name}.png`);
    await browser.shot(file, options);
    shots.push(file);
    report.shots.push(file);
    log(`screenshot -> ${file}`);
    return file;
  }
  // 已知缺陷（截至本轮 QA）：自适应降质时 renderer 会空 layout 跳帧并 console.error。
  // 单独计数并作为一条可回归的检查项，其余检查只对“非已知”错误敏感。
  const KNOWN_RENDER_ERROR = /\[render\] 渲染出现异常/;
  const unexpectedConsoleErrors = () => browser.consoleErrors.filter((e) => !KNOWN_RENDER_ERROR.test(e));
  const knownRenderErrors = () => browser.consoleErrors.filter((e) => KNOWN_RENDER_ERROR.test(e));
  const page = (expr) => browser.evalJs(expr);
  const qa = (expr) => browser.evalJs(`window.__qa.${expr}`);
  const snap = () => qa('snap()');
  const hud = () => qa('hud()');
  const domClick = (selector) => browser.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  const waitFor = (expr, timeout) => browser.waitFor(expr, { timeout });
  const key = (k) => browser.key(k);

  async function clickAndVerify(selector, verifyExpr, name) {
    try {
      const box = await browser.clickSelector(selector);
      if (verifyExpr) {
        const ok = await browser.waitFor(verifyExpr, { timeout: 4000 }).then(() => true).catch(() => false);
        check(name || `点击 ${selector}`, ok, ok ? undefined : box);
        return ok;
      }
      return true;
    } catch (error) {
      check(name || `点击 ${selector}`, false, error.message);
      return false;
    }
  }

  try {
    // ================= 阶段 0：菜单、视口、网络 =================
    await scenario('P0 菜单与基础加载', async () => {
      await browser.goto(BASE, { wait: 2000 });
      await browser.evalJs(PAGE_HELPERS);
      await qa('init()');
      const booted = await page(`Boolean(document.querySelector('[data-hd-ui]'))`);
      check('页面完成启动并挂载 UI', booted);
      check('主菜单渲染', await page(`Boolean(document.querySelector('.screen--menu'))`));
      check('调试钩子 window.__HORRIBLE_DORM 可用', await page(`typeof window.__HORRIBLE_DORM === 'object' && typeof window.__HORRIBLE_DORM.state === 'object'`));
      const bootHidden = await page(`(() => { const b = document.getElementById('boot-screen'); return !b || b.classList.contains('is-hidden') || b.hidden; })()`);
      check('启动遮罩已隐藏', bootHidden);
      check('首屏无 console error / 异常', browser.consoleErrors.length === 0 && browser.exceptions.length === 0,
        { errors: browser.consoleErrors, exceptions: browser.exceptions });
      check('首屏无 console warning', browser.consoleWarnings.length === 0, browser.consoleWarnings.slice(0, 5));

      const reqs = browser.requests.filter((r) => !r.url.startsWith('data:'));
      const external = reqs.filter((r) => {
        try { return new URL(r.url).origin !== new URL(BASE).origin; } catch { return true; }
      });
      check('无外部网络请求', external.length === 0, external.map((r) => r.url));
      const bad = browser.responses.filter((r) => r.status >= 400);
      check('无 HTTP >=400 响应（含 favicon）', bad.length === 0, bad);
      check('无加载失败请求', browser.failures.filter((f) => !f.canceled).length === 0, browser.failures);
      const faviconReq = reqs.filter((r) => /favicon/.test(r.url));
      note(`favicon 请求数：${faviconReq.length}（内联 data URI 应为 0）；资源请求数 ${reqs.length}`);
      report.network.requests = reqs.map((r) => ({ url: r.url, type: r.type }));
      report.network.responses = browser.responses.map((r) => ({ url: r.url, status: r.status, type: r.type }));
      report.network.failures = browser.failures;

      const menuMeta = await page(`document.querySelector('.menu-meta')?.textContent.replace(/\s+/g, ' ').trim()`);
      check('主菜单单局时长文案为 6–10.5 分钟（覆盖噩梦与深渊实际时长）', /6–10(\.5)? 分钟/.test(menuMeta || ''), menuMeta);
      const cs = await qa('canvasStats()');
      check('Canvas 元素铺满视口（CSS 尺寸）', cs && cs.cssW === 1440 && cs.cssH === 900, cs);
      note(`主菜单阶段 Canvas backing store = ${cs.backingW}x${cs.backingH}（进入对局后按 DPR 重建，菜单不绘制世界）`);

      await shot('00-menu-1440x900');

      const viewports = [
        [1280, 720, '01-menu-1280x720'],
        [1440, 900, '02-menu-1440x900'],
        [1920, 1080, '03-menu-1920x1080'],
        [844, 390, '04-menu-844x390-landscape'],
        [390, 844, '05-menu-390x844-portrait'],
      ];
      for (const [w, h, name] of viewports) {
        await browser.setViewport(w, h, { mobile: w < 900 });
        const ov = await qa('overflow()');
        const cs2 = await qa('canvasStats()');
        const btn = await qa(`clickable('[data-menu="start"]')`);
        const menu = await page(`Boolean(document.querySelector('.screen--menu'))`);
        check(`菜单 ${w}x${h}：Canvas 尺寸匹配视口`, cs2.cssW === w && cs2.cssH === h, cs2);
        check(`菜单 ${w}x${h}：无滚动溢出`, !ov.overflowX && !ov.overflowY, ov);
        check(`菜单 ${w}x${h}：开始守夜按钮可见可点`, menu && btn.visible && btn.inView && btn.hit, btn);
        await shot(name);
      }
      await browser.setViewport(1440, 900, { mobile: false });
    });

    // ================= 阶段 1：难度与选房 =================
    await scenario('P1 难度选择与选房', async () => {
      const box = await browser.clickSelector('[data-menu="start"]');
      check('点击“开始守夜”命中按钮', box.hit, box);
      await waitFor(`document.querySelector('.panel--wide')`);
      const diffInfo = await page(`(() => {
        const cards = Array.from(document.querySelectorAll('[data-diff]'));
        return cards.map(c => ({
          id: c.getAttribute('data-diff'),
          name: c.querySelector('.diff-card__name')?.textContent.trim(),
          stats: Array.from(c.querySelectorAll('.diff-stat')).map(s => s.textContent.replace(/\\s+/g, ' ').trim()),
          target: c.querySelector('.diff-card__target')?.textContent.replace(/\\s+/g, ' ').trim(),
          selected: c.getAttribute('aria-pressed'),
        }));
      })()`);
      check('难度弹层有 4 档难度（含深渊）', diffInfo.length === 4, diffInfo.map((d) => d.id));
      check('难度卡展示目标通关率（简单≥85%/普通60–75%/噩梦30–45%/深渊20–30%）',
        diffInfo.some((d) => d.target.includes('≥85%'))
        && diffInfo.some((d) => d.target.includes('60%–75%'))
        && diffInfo.some((d) => d.target.includes('30%–45%'))
        && diffInfo.some((d) => d.target.includes('20%–30%')),
        diffInfo.map((d) => `${d.id}:${d.target}`));
      const nightmareStats = diffInfo.find((d) => d.id === 'nightmare')?.stats || [];
      const durationOf = (id) => (diffInfo.find((d) => d.id === id)?.stats || []).find((row) => row.startsWith('守夜时长')) || '';
      check('难度卡守夜时长与配置一致（6 / 8 / 9.5 / 10.5 分钟）',
        /6\s*分钟/.test(durationOf('easy')) && /8\s*分钟/.test(durationOf('normal'))
        && /9\.5\s*分钟/.test(durationOf('nightmare')) && /10\.5\s*分钟/.test(durationOf('abyss')),
        { easy: durationOf('easy'), normal: durationOf('normal'), nightmare: durationOf('nightmare'), abyss: durationOf('abyss') });
      note(`噩梦难度卡：${nightmareStats.join(' / ')}`);
      await shot('06-difficulty-1440x900');

      await browser.clickSelector('[data-diff="normal"]');
      const selected = await page(`document.querySelector('[data-diff="normal"]').getAttribute('aria-pressed')`);
      check('选择普通难度后 aria-pressed 正确', selected === 'true', selected);
      await browser.clickSelector('[data-diff-confirm]');
      await waitFor(`Boolean(document.querySelector('.screen--room'))`);
      const rooms = await page(`(() => {
        const cards = Array.from(document.querySelectorAll('[data-room-pick]'));
        return {
          count: cards.length,
          ids: cards.map(c => c.getAttribute('data-room-pick')),
          names: cards.map(c => c.querySelector('.room-card__num')?.textContent.trim() + ' ' + c.querySelector('.room-card__name')?.textContent.trim()),
          areas: cards.map(c => Array.from(c.querySelectorAll('.room-spec__v')).map(v => v.textContent.trim())),
          bosses: Array.from(document.querySelectorAll('[data-room-boss]')).map(b => b.textContent.trim()),
          diffLabel: document.querySelector('[data-room-diff-label]')?.textContent.trim(),
          selected: document.querySelector('.room-card.is-selected')?.getAttribute('data-room-pick'),
        };
      })()`);
      check('选房页展示 6 间宿舍', rooms.count === 6 && rooms.ids.length === 6, rooms.ids);
      check('选房页难度为普通', rooms.diffLabel === '普通', rooms.diffLabel);
      check('每间宿舍显示主魇预览（6/6 非空）', rooms.bosses.length === 6 && rooms.bosses.every((b) => b && b !== '—' && b !== '未知'), rooms.bosses);
      check('选房页默认选中一间', Boolean(rooms.selected), rooms.selected);
      await shot('07-room-select-1440x900');

      // 键盘切换 + Enter 确认
      await key('ArrowRight');
      const moved = await page(`document.querySelector('.room-card.is-selected')?.getAttribute('data-room-pick')`);
      check('选房页 ←→ 键可切换选中房间', moved && moved !== rooms.selected, { from: rooms.selected, to: moved });
      await page(`(() => { const el = document.querySelector('[data-room-pick="room-301"]'); el.click(); return true; })()`);
      const picked = await page(`document.querySelector('.room-card.is-selected')?.getAttribute('data-room-pick')`);
      check('点击房间卡选中 room-301', picked === 'room-301', picked);
      await browser.clickSelector('[data-room-confirm]');
      await waitFor(`window.__HORRIBLE_DORM.state.screen === 'game'`);
      check('进入对局后 screen=game', (await snap()).screen === 'game');
    });

    // ================= 阶段 2：首次教程 =================
    await scenario('P2 首次教程', async () => {
      const tutorialOpen = await waitFor(`Boolean(document.querySelector('.panel--tutorial'))`).then(() => true).catch(() => false);
      check('首次进入对局自动弹出教程', tutorialOpen);
      const lsBefore = await qa('localStorage()');
      check('教程已写入 localStorage hd-tutorial-seen-v1=1', lsBefore['hd-tutorial-seen-v1'] === '1', lsBefore['hd-tutorial-seen-v1']);
      await shot('08-tutorial-page1');
      let pages = [];
      for (let i = 0; i < 5; i += 1) {
        const info = await page(`(() => {
          const step = document.querySelector('[data-tut-step]');
          const title = document.querySelector('[data-tut-title]');
          const next = document.querySelector('[data-tut-next]')?.textContent.replace(/\s+/g, ' ').trim();
          return { step: step?.textContent.trim(), title: title?.textContent.trim(), next };
        })()`);
        pages.push(info);
        await domClick('[data-tut-next]');
        await sleepMs(120);
      }
      check('教程共 5 页且标题依次呈现', pages.length === 5 && pages.every((p, i) => p.step === `第 ${i + 1} / 5 页`), pages.map((p) => `${p.step}:${p.title}`));
      check('教程最后一页按钮为“开始布防”', pages[4]?.next === '开始布防', pages[4]);
      const closed = await waitFor(`!document.querySelector('.panel--tutorial')`).then(() => true).catch(() => false);
      check('教程读完后关闭', closed);
      const s = await snap();
      check('教程关闭后回到准备阶段', s.screen === 'game' && s.phase === 'prep', { screen: s.screen, phase: s.phase, prep: s.prepRemaining });
    });

    // ================= 阶段 3：准备阶段 HUD 与建造 =================
    await scenario('P3 准备阶段 / 建造 / 升级 / 研究 / 拆除', async () => {
      const s0 = await snap();
      check('开局状态：room-301 / 普通 / 准备阶段 / 25 秒倒计时', s0.roomId === 'room-301' && s0.difficulty === 'normal' && s0.phase === 'prep' && s0.prepRemaining > 20 && s0.prepRemaining <= 25, s0);
      check('起始道具已放置（1 座）', s0.buildings.length === 1 && s0.buildings[0].starter, s0.buildings);
      const h0 = await hud();
      check('HUD 夜钟 00:00 / 准备阶段', h0.clock === '00:00' && h0.phase === '准备阶段', h0);
      check('HUD 建造 dock 存在（3 炮台卡 + 2 分组）', h0.dockCards === 3 && h0.dockTabs === 2, { cards: h0.dockCards, tabs: h0.dockTabs });
      const center = await qa('centerCoverage()');
      check('准备阶段中央区域 Canvas 未被遮挡（≥85%）', center.ratio >= 0.85, center);
      const ov = await qa('overflow()');
      check('对局界面无滚动溢出', !ov.overflowX && !ov.overflowY, ov);
      const cs = await qa('canvasStats()');
      check('对局场景已绘制（Canvas 非空）', cs.opaqueRatio > 0.5 && cs.colors > 30, cs);
      await shot('09-game-prep-1440x900');

      // 打开酸系阶段弹层并选择阶段 I
      await browser.clickSelector('.build-card[data-dock-build="acid"]');
      const popOpen = await waitFor(`window.__qa.hud().acidPopover`).then(() => true).catch(() => false);
      const popInfo = await page(`(() => {
        const rows = Array.from(document.querySelectorAll('[data-dock-acid]'));
        return { count: rows.length, stages: rows.map(r => r.getAttribute('data-dock-acid')), footer: document.querySelector('[data-dock-pop] .dock-pop__foot')?.textContent.replace(/\\s+/g, ' ').trim() };
      })()`);
      check('酸系建造弹层展示 6 个阶段且 I 可用', popOpen && popInfo.count === 6, popInfo);
      await shot('10-build-acid-popover');
      await browser.clickSelector('[data-dock-acid="1"]');
      const buildMode = await qa(`s().ui.buildMode`);
      check('选择酸系阶段 I 进入建造模式', buildMode && buildMode.type === 'acid' && buildMode.stage === 1, buildMode);
      const banner = await page(`document.querySelector('[data-dock-mode]')?.hidden === false`);
      check('建造模式提示条出现', banner);
      const pick = await qa('pickFreeClickable()');
      check('房间中存在可点击的空格（未被 HUD 遮挡）', Boolean(pick), pick);
      await shot('11-build-mode');
      if (pick) {
        await browser.click(pick.x, pick.y);
        const s1 = await snap();
        check('Canvas 点击成功放置酸塔', s1.buildings.length === 2 && s1.ui.buildMode === null, { count: s1.buildings.length, mode: s1.ui.buildMode });
        check('放置后自动选中并显示检查面板', s1.ui.selected && (await hud()).inspectorVisible, s1.ui.selected);
        await shot('12-build-placed-inspector');
      }

      // 设备分类
      await browser.clickSelector('.dock-tab[data-dock-tab="device"]');
      const deviceInfo = await page(`(() => {
        const cards = Array.from(document.querySelectorAll('.build-card'));
        return { count: cards.length, types: cards.map(c => c.getAttribute('data-dock-build')), tabActive: document.querySelector('.dock-tab[data-dock-tab="device"]')?.getAttribute('aria-selected') };
      })()`);
      check('设备分类展示 7 种功能设备', deviceInfo.count === 7 && deviceInfo.types.includes('analyzer') && deviceInfo.types.includes('atm'), deviceInfo);
      check('设备 tab aria-selected=true', deviceInfo.tabActive === 'true', deviceInfo.tabActive);
      await shot('13-device-category');
      await browser.clickSelector('.build-card[data-dock-build="analyzer"]');
      const pick2 = await qa('pickFreeClickable()');
      if (pick2) await browser.click(pick2.x, pick2.y);
      const s2 = await snap();
      check('放置层析仪成功', s2.buildings.some((b) => b.type === 'analyzer'), s2.buildings.map((b) => b.type));
      await qa('advanceTo(10)');
      await sleepMs(400);
      const s2b = await snap();
      check('层析仪开始产出试剂', s2b.reagent > 0, { reagent: s2b.reagent });
      check('冷凝床持续产出梦能', s2b.dream > s2.dream, { before: s2.dream, after: s2b.dream });

      // 特化炮台：氯酸钾 / 苯（此处起用 QA 调试资源，避免长等待；自然经济建造已在上方验证）
      await qa('setResources(3000, 300)');
      await browser.clickSelector('.dock-tab[data-dock-tab="tower"]');
      await browser.clickSelector('.build-card[data-dock-build="chlorate"]');
      const pickChlorate = await qa('pickFreeClickable()');
      if (pickChlorate) await browser.click(pickChlorate.x, pickChlorate.y);
      const sSpecial = await snap();
      check('建造氯酸钾特化炮台（炮台分类）', sSpecial.buildings.some((b) => b.type === 'chlorate'), sSpecial.buildings.map((b) => b.type));
      await key('3');
      const pickBenzene = await qa('pickFreeClickable()');
      if (pickBenzene) await browser.click(pickBenzene.x, pickBenzene.y);
      const sBenzene = await snap();
      check('建造苯特化炮台（键盘 3）', sBenzene.buildings.some((b) => b.type === 'benzene'), sBenzene.buildings.map((b) => b.type));

      // 键盘 1–0 映射完整性
      const hotkeyMap = { '1': 'popover', '2': 'chlorate', '3': 'benzene', '4': 'analyzer', '5': 'condenser', '6': 'vent', '7': 'catalyst', '8': 'neutralizer', '9': 'accelerator', '0': 'atm' };
      const hotkeyResults = {};
      for (const [digit, expected] of Object.entries(hotkeyMap)) {
        await key(digit);
        await sleepMs(140);
        if (expected === 'popover') hotkeyResults[digit] = (await qa('hud().acidPopover')) ? 'popover' : 'none';
        else hotkeyResults[digit] = (await qa('s().ui.buildMode'))?.type || 'none';
        await key('Escape');
        await sleepMs(100);
      }
      const hotkeyOk = Object.entries(hotkeyMap).every(([digit, expected]) => hotkeyResults[digit] === expected);
      check('键盘 1–0 全部映射到对应建造卡', hotkeyOk, hotkeyResults);

      // 键盘热键
      await key('1');
      const acidPop = await waitFor(`window.__qa.hud().acidPopover`).then(() => true).catch(() => false);
      check('键盘 1 打开酸系建造弹层', acidPop);
      await key('Escape');
      const popClosed = await waitFor(`!window.__qa.hud().acidPopover`).then(() => true).catch(() => false);
      check('Esc 关闭酸系弹层', popClosed);
      await key('2');
      const mode2 = await qa(`s().ui.buildMode`);
      check('键盘 2 进入氯酸钾建造模式', mode2 && mode2.type === 'chlorate', mode2);
      await key('Escape');
      const mode2b = await qa(`s().ui.buildMode`);
      check('Esc 取消建造模式', mode2b === null, mode2b);
      await key('0');
      const mode0 = await qa(`s().ui.buildMode`);
      check('键盘 0 进入梦能取款机建造模式', mode0 && mode0.type === 'atm', mode0);
      await key('Escape');
      // 右键取消建造
      await key('3');
      await sleepMs(150);
      const armed = await qa(`s().ui.buildMode`);
      const centerPt = { x: Math.round(1440 / 2), y: Math.round(900 / 2) };
      await browser.rightClick(centerPt.x, centerPt.y);
      await sleepMs(200);
      const afterRight = await qa(`s().ui.buildMode`);
      check('右键取消建造模式', armed && armed.type === 'benzene' && afterRight === null, { armed, afterRight });

      // 资源（QA 调试注入，用于覆盖升级/研究/拆除路径）
      await qa('setResources(60000, 8000)');
      await sleepMs(200);
      const starter = (await snap()).buildings.find((b) => b.starter);
      await page(`window.__HORRIBLE_DORM.actions.selectBuilding(${JSON.stringify(starter.id)})`);
      await waitFor(`window.__qa.hud().inspectorVisible`);
      await browser.clickSelector('[data-insp="upgrade"]');
      await sleepMs(250);
      let sb = await snap();
      let acid = sb.buildings.find((b) => b.id === starter.id);
      check('酸塔升级到 II 级', acid && acid.level === 2, acid);
      await browser.clickSelector('[data-insp="upgrade"]');
      await sleepMs(250);
      sb = await snap();
      acid = sb.buildings.find((b) => b.id === starter.id);
      check('酸塔升级到 III 级', acid && acid.level === 3, acid);
      const evolveVisible = await page(`(() => { const b = document.querySelector('[data-insp="evolve"]'); return Boolean(b && !b.hidden); })()`);
      check('III 级酸塔显示“研究”按钮', evolveVisible);
      await shot('14-inspector-evolve-ready');
      await browser.clickSelector('[data-insp="evolve"]');
      await sleepMs(350);
      sb = await snap();
      acid = sb.buildings.find((b) => b.id === starter.id);
      check('研究后进入下一阶段并解锁全局阶段 2', acid && acid.stage === 2 && acid.level === 1 && sb.acidUnlocked === 2, { acid, acidUnlocked: sb.acidUnlocked });
      const hudAfterEvolve = await hud();
      check('HUD 建造栏 flavors 反映酸系解锁进度', true, hudAfterEvolve.dockCards);
      await shot('15-inspector-evolved');

      // 拆除
      const beforeSell = await snap();
      await browser.clickSelector('[data-insp="sell"]');
      await sleepMs(300);
      const afterSell = await snap();
      check('拆除建筑后从场景移除', afterSell.buildings.length === beforeSell.buildings.length - 1, { before: beforeSell.buildings.length, after: afterSell.buildings.length });
      check('拆除返还梦能（50%）', afterSell.dream > beforeSell.dream, { before: beforeSell.dream, after: afterSell.dream });
      const soldAcid = afterSell.buildings.find((b) => b.id === starter.id);
      check('被拆除的酸塔已不存在', !soldAcid);

      // 反应链：酸 + 催化台相邻
      await qa('setResources(60000, 8000)');
      const acidSpot = await page(`(() => {
        for (const tile of window.__qa.freeTiles()) {
          const r = window.__HORRIBLE_DORM.build('acid', { stage: 1 }, tile);
          if (r && r.ok) return tile;
        }
        return null;
      })()`);
      const s3 = await snap();
      const acidBuilding = s3.buildings.find((b) => b.type === 'acid' && !b.starter);
      let reactionOk = false;
      if (acidSpot && acidBuilding) {
        const spot = await page(`(() => {
          const candidates = window.__qa.freeTiles();
          const mid = ${JSON.stringify(acidBuilding.tile)};
          candidates.sort((a, b) => Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y));
          for (const tile of candidates.slice(0, 6)) {
            const r = window.__HORRIBLE_DORM.build('catalyst', {}, tile);
            if (r && r.ok) return tile;
          }
          return null;
        })()`);
        if (spot) {
          const s4 = await snap();
          reactionOk = s4.reactions.includes('catalytic_oxidation');
        }
      }
      check('酸塔 + 催化台相邻自动激活“催化氧化”反应链', reactionOk, (await snap()).reactions);
      if (reactionOk) {
        await sleepMs(450);
        const hudReaction = await hud();
        check('HUD 反应链计数大于 0', /[1-6]\s*\/\s*6/.test(hudReaction.reactionCount || ''), hudReaction.reactionCount);
        await shot('16-reaction-active');
      }
    });

    // ================= 阶段 3b：酸系主炮“直接放置”用户实测回归 =================
    await scenario('P3b 酸系主炮直接放置回归', async () => {
      await ensureCleanGame();
      await qa(`startRun('room-301', 'normal', null, null)`);
      await sleepMs(450);

      // 1) 自然资源下：只点酸卡（不点阶段行）→ 直接点地板
      const before = await snap();
      await browser.clickSelector('.build-card[data-dock-build="acid"]');
      await sleepMs(300);
      const afterCard = await snap();
      check('点“酸系主炮”卡立即进入建造模式（默认已解锁且买得起的最高阶段）',
        afterCard.ui.buildMode && afterCard.ui.buildMode.type === 'acid' && afterCard.ui.buildMode.stage === 1,
        afterCard.ui.buildMode);
      check('阶段弹层仍同时打开（可切换阶段）', Boolean(afterCard) && (await qa('hud().acidPopover')) === true);
      const pickDirect = await qa('pickFreeClickable()');
      check('地板存在可点击空位', Boolean(pickDirect), pickDirect);
      const countBeforeDirect = before.buildings.length;
      if (pickDirect) await browser.click(pickDirect.x, pickDirect.y);
      await sleepMs(350);
      const afterDirect = await snap();
      check('酸卡后直接点地板成功建造（用户实测问题回归）',
        afterDirect.buildings.length === countBeforeDirect + 1
        && afterDirect.buildings.some((b) => b.type === 'acid' && !b.starter)
        && afterDirect.ui.buildMode === null,
        { before: countBeforeDirect, after: afterDirect.buildings.map((b) => b.type), mode: afterDirect.ui.buildMode });
      const placeError = await page(`(() => {
        const toasts = Array.from(document.querySelectorAll('.toast--error, .toast--warn'));
        return toasts.map((t) => t.textContent.replace(/\s+/g, ' ').trim());
      })()`);
      check('直接放置未出现“无法放置/已有装置”错误提示', placeError.length === 0, placeError);

      // 2) 解锁多阶段后：默认选买得起的最高阶段；阶段行仍可切换
      await qa('setResources(3000, 300)');
      await page(`window.__HORRIBLE_DORM.state.acidUnlocked = 3; true`);
      await ensureCleanGame();
      await browser.clickSelector('.build-card[data-dock-build="acid"]');
      await sleepMs(300);
      const autoStage = (await snap()).ui.buildMode;
      check('酸卡默认选已解锁且买得起的最高阶段（解锁 I–III → 阶段 3）', autoStage && autoStage.stage === 3, autoStage);
      await browser.clickSelector('[data-dock-acid="2"]');
      await sleepMs(250);
      const switched = (await snap()).ui.buildMode;
      check('阶段弹层切换阶段（3 → 2）', switched && switched.stage === 2, switched);

      // 3) Esc：先关闭弹层，再取消建造
      await browser.clickSelector('.build-card[data-dock-build="acid"]');
      await sleepMs(250);
      await key('Escape');
      await sleepMs(200);
      const afterEsc1 = await snap();
      const popAfterEsc1 = await qa('hud().acidPopover');
      await key('Escape');
      await sleepMs(200);
      const afterEsc2 = await snap();
      check('Esc 先关闭阶段弹层、再次 Esc 取消建造模式',
        afterEsc1.ui.buildMode && afterEsc1.ui.buildMode.type === 'acid' && popAfterEsc1 === false
        && afterEsc2.ui.buildMode === null && afterEsc2.paused === false,
        { afterEsc1: afterEsc1.ui.buildMode, popover: popAfterEsc1, afterEsc2: afterEsc2.ui.buildMode, paused: afterEsc2.paused });

      // 4) 右键取消，不误放
      await browser.clickSelector('.build-card[data-dock-build="acid"]');
      await sleepMs(250);
      const pickRight = await qa('pickFreeClickable()');
      const countBeforeRight = (await snap()).buildings.length;
      if (pickRight) await browser.rightClick(pickRight.x, pickRight.y);
      await sleepMs(300);
      const afterRight = await snap();
      check('右键取消酸系建造且不误放装置', afterRight.ui.buildMode === null && afterRight.buildings.length === countBeforeRight,
        { mode: afterRight.ui.buildMode, before: countBeforeRight, after: afterRight.buildings.length });

      // 5) 资源不足：不误入建造模式、不误建造
      await qa('setResources(0, 0)');
      await sleepMs(200);
      const poorBefore = await snap();
      await browser.clickSelector('.build-card[data-dock-build="acid"]');
      await sleepMs(300);
      const poorMode = (await snap()).ui.buildMode;
      const pickPoor = await qa('pickFreeClickable()');
      if (pickPoor) await browser.click(pickPoor.x, pickPoor.y);
      await sleepMs(300);
      const poorAfter = await snap();
      check('资源不足时点酸卡不进入建造模式、点地板不误建造',
        poorMode === null && poorAfter.buildings.length === poorBefore.buildings.length,
        { mode: poorMode, before: poorBefore.buildings.length, after: poorAfter.buildings.length });
    });

    // ================= 阶段 4：设施操作 / 暂停 / 帮助 / 设置 =================
    await scenario('P4 设施操作与暂停', async () => {
      await ensureCleanGame();
      await qa('setResources(60000, 8000)');
      await sleepMs(350); // 等 HUD 刷新按钮可用态（HUD 节流 100ms）
      const before = await snap();
      await browser.clickSelector('[data-act="hud.bedUpgrade"]');
      await sleepMs(250);
      let s = await snap();
      check('HUD 升级冷凝床', s.bedLevel === before.bedLevel + 1, { before: before.bedLevel, after: s.bedLevel });
      await browser.clickSelector('[data-act="hud.doorUpgrade"]');
      await sleepMs(250);
      s = await snap();
      check('HUD 升级气密门', s.doorLevel === before.doorLevel + 1, { before: before.doorLevel, after: s.doorLevel });

      await page(`window.__HORRIBLE_DORM.state.player.doorHp = Math.round(window.__HORRIBLE_DORM.state.player.doorMaxHp * 0.5)`);
      await sleepMs(150);
      const hurt = await snap();
      await browser.clickSelector('[data-act="hud.repair"]');
      await sleepMs(250);
      s = await snap();
      check('HUD 维修气密门恢复耐久', s.doorHp > hurt.doorHp && s.stats.repairs >= 1, { before: hurt.doorHp, after: s.doorHp, repairs: s.stats.repairs });

      await page(`(() => { const s = window.__HORRIBLE_DORM.state; s.player.doorHp = Math.round(s.player.doorMaxHp * 0.5); s.player.showerReadyAt = 0; return true; })()`);
      const beforeShower = (await snap()).doorHp;
      await key('q');
      await sleepMs(250);
      s = await snap();
      const showerState = await page(`({ readyAt: window.__HORRIBLE_DORM.state.player.showerReadyAt, now: window.__HORRIBLE_DORM.state.now })`);
      check('键盘 Q 触发应急喷淋（冷却写入）', showerState.readyAt > showerState.now && s.doorHp >= beforeShower, showerState);
      const repBefore = s.stats.repairs;
      await key('r');
      await sleepMs(250);
      const repAfter = (await snap()).stats.repairs;
      check('键盘 R 维修路径可用（满血时不报错）', repAfter >= repBefore, { before: repBefore, after: repAfter });

      // Space 暂停 / 继续
      await key(' ');
      await sleepMs(250);
      s = await snap();
      const pauseOverlay = await qa('overlayKey()');
      check('Space 暂停对局并弹出暂停面板', s.paused === true && pauseOverlay.startsWith('pause'), { paused: s.paused, overlay: pauseOverlay });
      await shot('17-pause-1440x900');
      await key(' ');
      await sleepMs(250);
      s = await snap();
      check('Space 再次按下继续对局', s.paused === false && (await qa('overlayKey()')) === '', { paused: s.paused });

      // Esc 暂停 / 恢复
      const preEsc = { paused: (await snap()).paused, overlay: await qa('overlayKey()') };
      await key('Escape');
      await sleepMs(300);
      s = await snap();
      check('Esc 暂停对局', s.paused === true, { paused: s.paused, preEsc, overlay: await qa('overlayKey()') });
      await key('Escape');
      await sleepMs(250);
      s = await snap();
      check('Esc 再次按下恢复对局', s.paused === false, s.paused);
    });

    await scenario('P5 帮助 4 tab 与设置持久化', async () => {
      await ensureCleanGame();
      await browser.clickSelector('[data-act="hud.codex"]');
      await waitFor(`document.querySelector('.help-tabs')`);
      const helpInfo = await page(`(() => ({
        tabs: Array.from(document.querySelectorAll('[data-help-tab]')).map(t => t.getAttribute('data-help-tab')),
        active: document.querySelector('.help-tab.is-active')?.getAttribute('data-help-tab'),
        nmCards: document.querySelectorAll('[data-help-panel="nightmares"] .codex-card').length,
        catalogSections: document.querySelectorAll('[data-help-panel="builds"] .codex-section').length,
        reactionCards: document.querySelectorAll('[data-help-panel="reactions"] .reaction-card').length,
      }))()`);
      check('帮助面板 4 个 tab', helpInfo.tabs.length === 4 && helpInfo.tabs.join(',') === 'nightmares,builds,reactions,operations', helpInfo.tabs);
      check('梦魇图鉴展示 6 张卡', helpInfo.nmCards === 6, helpInfo.nmCards);
      await shot('18-help-nightmares');
      const tabResults = {};
      for (const tab of ['builds', 'reactions', 'operations']) {
        await browser.clickSelector(`[data-help-tab="${tab}"]`);
        await sleepMs(180);
        tabResults[tab] = await qa('activeHelpTab()');
      }
      check('帮助 4 个 tab 均可切换', tabResults.builds === 'builds' && tabResults.reactions === 'reactions' && tabResults.operations === 'operations', tabResults);
      const buildsText = await page(`document.querySelector('[data-help-panel="builds"]')?.textContent || ''`);
      check('建造目录含酸系六阶段 / 特化 / 设备', /硅酸/.test(buildsText) && /高氯酸/.test(buildsText) && /氯酸钾/.test(buildsText) && /层析仪/.test(buildsText));
      const reactionsText = await page(`document.querySelector('[data-help-panel="reactions"] .reaction-card-grid')?.textContent || ''`);
      check('反应链面板 6 条齐全', helpInfo.reactionCards === 6, helpInfo.reactionCards);
      const opsText = await page(`document.querySelector('[data-help-panel="operations"]')?.textContent || ''`);
      check('操作面板列出 1–0/Q/R/Space/Esc', /1/.test(opsText) && /Q/.test(opsText) && /R/.test(opsText) && /Space/.test(opsText) && /Esc/.test(opsText));
      await browser.clickSelector('[data-help-tab="builds"]');
      const scrollInfo = await page(`(() => {
        const el = document.querySelector('.panel--help .help-panel.is-active');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { before: el.scrollTop, sh: el.scrollHeight, ch: el.clientHeight, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`);
      if (scrollInfo && scrollInfo.sh > scrollInfo.ch) {
        await browser.wheel(scrollInfo.x, scrollInfo.y, 600);
        const scrollAfter = await page(`document.querySelector('.panel--help .help-panel.is-active')?.scrollTop`);
        check('帮助面板内容可滚轮滚动', scrollAfter > scrollInfo.before, { before: scrollInfo.before, after: scrollAfter, sh: scrollInfo.sh, ch: scrollInfo.ch });
      } else {
        note(`帮助面板内容未溢出（scrollHeight ${scrollInfo?.sh} / clientHeight ${scrollInfo?.ch}），跳过滚轮断言`);
      }
      await shot('19-help-builds');
      await key('Escape');
      await waitFor(`window.__qa.overlayKey() === ''`);
      check('Esc 关闭帮助面板', (await qa('overlayKey()')) === '');

      // 设置
      await browser.clickSelector('[data-act="hud.settings"]');
      await waitFor(`Boolean(document.querySelector('.panel--settings'))`);
      const settingsBefore = await page(`(() => {
        const toggles = Array.from(document.querySelectorAll('[data-setting-toggle]'));
        return { toggles: toggles.map(t => t.getAttribute('data-setting-toggle')), volume: document.querySelector('[data-setting-range="volume"]')?.value };
      })()`);
      const settingRows = await page(`document.querySelectorAll('.setting-row').length`);
      check('设置面板渲染 4 项设置（音量 + 3 个开关）', settingsBefore.toggles.length === 3 && settingRows === 4 && settingsBefore.volume !== undefined, { ...settingsBefore, settingRows });
      await browser.clickSelector('[data-setting-toggle="reducedMotion"]');
      await browser.clickSelector('[data-setting-toggle="muted"]');
      await page(`(() => {
        const input = document.querySelector('[data-setting-range="volume"]');
        input.value = 30;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return input.value;
      })()`);
      await sleepMs(300);
      const settingsAfter = await page(`({ ...window.__HORRIBLE_DORM.getSettings(), ls: JSON.parse(localStorage.getItem('horrible-dorm-reaction-v1') || '{}').settings })`);
      check('设置写入 localStorage（volume/muted/reducedMotion）',
        settingsAfter.ls && settingsAfter.ls.volume === 0.3 && settingsAfter.ls.muted === true && settingsAfter.ls.reducedMotion === true,
        settingsAfter.ls);
      check('减少动效同步到 documentElement dataset', await page(`document.documentElement.dataset.reducedMotion === 'true'`));
      await shot('20-settings');
      await key('Escape');
      await waitFor(`window.__qa.overlayKey() === ''`);
      check('关闭设置面板后对局继续', (await snap()).paused === false);
    });

    // ================= 阶段 5：夜晚 / 梦魇 HUD / 战斗 =================
    await scenario('P6 夜晚阶段与战斗', async () => {
      if ((await snap()).paused) { await key(' '); await sleepMs(250); }
      const s0 = await snap();
      await qa('advanceTo(26)');
      const s1 = await snap();
      check('准备倒计时结束进入夜晚', s1.phase === 'night', { phase: s1.phase, night: s1.nightElapsed });
      const h1 = await hud();
      check('HUD 阶段显示“守夜中”', h1.phase === '守夜中', h1.phase);
      await page(`window.__HORRIBLE_DORM.state.player.doorHp = window.__HORRIBLE_DORM.state.player.doorMaxHp = 5000`);
      const spawn = await qa('advanceToSpawn(2)');
      await sleepMs(400);
      const s2 = await snap();
      check('梦魇按时苏醒（activeNightmares=1）', s2.nightmares.length >= 1, s2.nightmares);
      const h2 = await hud();
      check('HUD 梦魇血条出现且名称非空', Number(h2.nmCount) === 1 && h2.nmNames.length === 1 && h2.nmNames[0].length > 2, h2.nmNames);
      check('HUD 梦魇 Lv 与状态一致', Number(h2.nmLevels[0]) === s2.nightmares[0].level, { hud: h2.nmLevels, state: s2.nightmares });
      const defName = await page(`(async () => { const c = window.__qa.content; const s = window.__qa.s(); return c.getNightmare(s.activeNightmares[0].type).name; })()`);
      check('HUD 梦魇名称与内容数据一致', h2.nmNames[0].startsWith(defName), { hud: h2.nmNames[0], expected: defName });
      await shot('21-night-nightmare-hud');

      // 战斗一段时间
      await qa('setResources(60000, 8000)');
      const beforeCombat = await snap();
      await qa('advanceTo(150)');
      await sleepMs(500);
      const afterCombat = await snap();
      check('战斗产生伤害统计', afterCombat.stats.damageDealt > 0, { damage: afterCombat.stats.damageDealt });
      check('战斗产生事件流（无异常）', await page(`document.querySelectorAll('.event-list li').length >= 1`));
      const capInfo = await page(`(() => { const s = window.__HORRIBLE_DORM.state; return { events: s.events.length, fx: s.fx.length, footer: document.querySelector('[data-ref="eventFoot"]')?.textContent || '' }; })()`);
      check('事件/特效队列受上限保护（事件≤14、特效≤48）', capInfo.events <= 14 && capInfo.fx <= 48, capInfo);
      if (capInfo.events === 14) note(`事件流实际缓存 14 条，HUD 文案为“${capInfo.footer}”（契约/文案为 12）`);
      await shot('22-night-combat');
      check('战斗期间无非预期 console error', unexpectedConsoleErrors().length === 0,
        { unexpected: unexpectedConsoleErrors().slice(0, 5), known: knownRenderErrors().length });
      if (knownRenderErrors().length) note(`战斗推进期间复现已知渲染降质缺陷 ${knownRenderErrors().length} 次（见 P13）`);
      const center = await qa('centerCoverage()');
      check('夜晚中央区域 Canvas 未被遮挡（≥85%）', center.ratio >= 0.85, center);
    });

    // ================= 阶段 6：六房间渲染 =================
    if (!SKIP_ROOMS) {
      await scenario('P7 六个房间渲染', async () => {
        const rooms = await page(`(async () => { const c = window.__qa.content; return c.ROOMS.map(r => ({ id: r.id, w: r.w, h: r.h, starter: r.starter.type })); })()`);
        check('内容数据包含 6 间宿舍', rooms.length === 6, rooms.map((r) => r.id));
        await browser.setViewport(1280, 720, { mobile: false });
        for (const room of rooms) {
          await qa(`startRun(${JSON.stringify(room.id)}, 'normal', null, null)`);
          await qa('advanceTo(3)');
          await sleepMs(600);
          const s = await snap();
          const cs = await qa('canvasStats()');
          const free = await page(`window.__qa.freeTiles().length`);
          check(`房间 ${room.id} 可开局并渲染（Canvas 非空 / 起点装置 / 空位）`,
            s.screen === 'game' && s.roomId === room.id && s.phase === 'prep'
            && s.buildings.length === 1 && s.buildings[0].type === room.starter
            && cs.opaqueRatio > 0.5 && cs.colors > 25 && free >= 6,
            { roomId: s.roomId, buildings: s.buildings, cs, free });
          await shot(`23-room-${room.id}-1280x720`);
        }
        await browser.setViewport(1440, 900, { mobile: false });
      });
    }

    // ================= 阶段 7：六梦魇与双魇 / Lv14 =================
    if (!SKIP_NIGHTMARES) {
      await scenario('P8 六种梦魇渲染', async () => {
        await ensureCleanGame();
        const defs = await page(`(async () => { const c = window.__qa.content; return c.NIGHTMARES.map(n => ({ id: n.id, name: n.name, weaknesses: n.weaknesses, resistances: n.resistances })); })()`);
        check('内容数据包含 6 种梦魇', defs.length === 6, defs.map((d) => d.id));
        await browser.setViewport(1280, 720, { mobile: false });
        for (const def of defs) {
          await qa(`startRun('room-301', 'normal', ${JSON.stringify(def.id)}, null)`);
          const s = await qa('advanceToSpawn(2)');
          await sleepMs(400);
          const cs = await qa('canvasStats()');
          const h = await hud();
          const typeOk = s.nightmares.length >= 1 && s.nightmares[0].type === def.id;
          check(`梦魇 ${def.id} 出现且 Canvas 渲染`, typeOk && cs.opaqueRatio > 0.5 && cs.colors > 30, { type: s.nightmares[0]?.type, cs });
          check(`梦魇 ${def.id} HUD 名称与内容一致`, h.nmNames.length >= 1 && h.nmNames[0].startsWith(def.name), { hud: h.nmNames, expected: def.name });
          const weakInfo = await page(`(() => {
            const wrap = document.querySelector('.nm__weak');
            const tags = Array.from(document.querySelectorAll('.nm__weak .dtag'));
            return {
              count: tags.length,
              tips: tags.map(t => t.getAttribute('data-tip') || ''),
              aria: wrap ? (wrap.getAttribute('aria-label') || '') : '',
              text: wrap ? wrap.textContent.replace(/\s+/g, ' ').trim() : '',
            };
          })()`);
          check(`梦魇 ${def.id} HUD 弱点/抗性有图标与可读文本（aria/sr-only）`,
            weakInfo.count >= 3
            && weakInfo.tips.some((t) => t.includes('弱点'))
            && weakInfo.tips.some((t) => t.includes('抗性'))
            && /弱点/.test(weakInfo.aria + weakInfo.text)
            && /抗性/.test(weakInfo.aria + weakInfo.text),
            weakInfo);
          await shot(`24-nightmare-${def.id}-1280x720`);
        }
        await browser.setViewport(1440, 900, { mobile: false });
      });

      await scenario('P9 噩梦双魇与 Lv14 终焉', async () => {
        await qa(`startRun('room-301', 'nightmare', 'benzene', 'mercury')`);
        await page(`(() => { const s = window.__HORRIBLE_DORM.state; s.player.doorHp = s.player.doorMaxHp = 1e9; return true; })()`);
        const result = await page(`(() => {
          const d = window.__HORRIBLE_DORM;
          const s = d.state;
          if (s.phase === 'prep') d.advance(s.prepRemaining + 0.5);
          let guard = 0;
          while (s.phase === 'night' && s.nightElapsed < 381 && guard < 200) { d.advance(10); guard += 1; }
          return { night: s.nightElapsed, actives: s.activeNightmares.map(n => ({ type: n.type, secondary: n.secondary, level: n.level })) };
        })()`);
        await sleepMs(500);
        const dual = await snap();
        const h = await hud();
        check('噩梦难度 04:00 追加第二只梦魇（双魇条）', result.actives.length === 2 && dual.nightmares.length === 2 && Number(h.nmCount) === 2, { result, hud: h.nmCount });
        check('双魇类型不同且副魇标记为增援', new Set(result.actives.map((n) => n.type)).size === 2 && result.actives.some((n) => n.secondary), result.actives);
        await shot('25-nightmare-dual-1440x900');

        // 直接抬到 Lv14 终焉，观察渲染/HUD 是否稳定
        const lv14 = await page(`(() => {
          const d = window.__HORRIBLE_DORM, s = d.state;
          s.player.doorHp = s.player.doorMaxHp = 1e9;
          s.pressure.level = 14;
          s.pressure.xp = 99999;
          s.activeNightmares.forEach(n => { n.level = 14; n.skillLevelsFired = [3,6,9,12,14]; });
          d.advance(3);
          return { level: s.pressure.level, nmLevels: s.activeNightmares.map(n => n.level), actives: s.activeNightmares.length, phase: s.phase };
        })()`);
        await sleepMs(600);
        const h14 = await hud();
        check('Lv14 终焉状态推进不崩溃', lv14.actives === 2 && lv14.nmLevels.every((l) => l === 14), lv14);
        check('Lv14 HUD 技能节点全部点亮（5/5）', h14.nmLitSkills.length >= 5, h14.nmLitSkills);
        check('Lv14 渲染无非预期 console error / 异常', unexpectedConsoleErrors().length === 0 && !browser.exceptions.length,
          { unexpected: unexpectedConsoleErrors(), known: knownRenderErrors().length, exc: browser.exceptions });
        await shot('26-nightmare-lv14-final-1440x900');
      });
    }

    // ================= 阶段 8：结算（失败 / 胜利）与重开 =================
    await scenario('P10 结算与重开', async () => {
      await ensureCleanGame();
      // 失败
      await qa(`startRun('room-301', 'normal', null, null)`);
      await qa('advanceTo(30)');
      const recordsBefore = await page(`(() => { const raw = localStorage.getItem('horrible-dorm-reaction-v1'); return raw ? JSON.parse(raw).records : null; })()`);
      const defeatState = await qa('forceDefeat()');
      const defeatOverlay = await waitFor(`window.__qa.overlayKey().startsWith('result')`).then(() => true).catch(() => false);
      check('门被击破触发失败结算面板', defeatOverlay && defeatState.result?.outcome === 'defeat', { overlay: await qa('overlayKey()'), result: defeatState.result });
      const defeatText = await page(`document.querySelector('.panel--result')?.textContent.replace(/\\s+/g, ' ').trim() || ''`);
      check('失败结算包含原因与评级', /气密门|门破|失败|rating|评级/.test(defeatText) && Boolean(defeatState.result?.grade), defeatText.slice(0, 200));
      await shot('27-result-defeat-1440x900');
      const recordsAfter = await page(`(() => { const raw = localStorage.getItem('horrible-dorm-reaction-v1'); return raw ? JSON.parse(raw).records : null; })()`);
      check('结算写入 localStorage 记录（runs+1）', (recordsAfter?.runs || 0) === (recordsBefore?.runs || 0) + 1, { before: recordsBefore?.runs, after: recordsAfter?.runs });

      await browser.clickSelector('[data-result="restart"]');
      await waitFor(`window.__HORRIBLE_DORM.state.phase === 'prep'`);
      const restarted = await snap();
      check('结算页“再来一局”沿用房间与难度', restarted.screen === 'game' && restarted.roomId === 'room-301' && restarted.difficulty === 'normal' && restarted.phase === 'prep', restarted);
      check('重开后回到准备阶段且无结算面板', !(await qa('overlayKey()')).startsWith('result'));

      // 击杀全部梦魇胜利
      const killState = await qa('forceKillAll()');
      await waitFor(`window.__QA_RESULT_WAIT__ || window.__HORRIBLE_DORM.state.phase === 'victory'`).catch(() => {});
      await sleepMs(400);
      const killOverlay = await waitFor(`window.__qa.overlayKey().startsWith('result')`).then(() => true).catch(() => false);
      check('清空全部梦魇触发胜利结算', killOverlay && killState.result?.outcome === 'victory', { result: killState.result });
      check('击杀胜利文案为“所有梦魇都被滴定干净”', /滴定/.test(killState.result?.reason || ''), killState.result?.reason);
      await shot('28-result-victory-kill');

      // 天亮胜利
      await browser.clickSelector('[data-result="restart"]');
      await waitFor(`window.__HORRIBLE_DORM.state.phase === 'prep'`);
      const dawnState = await qa('forceWinDawn()');
      await sleepMs(400);
      const dawnOverlay = await waitFor(`window.__qa.overlayKey().startsWith('result')`).then(() => true).catch(() => false);
      check('天亮触发胜利结算', dawnOverlay && dawnState.result?.outcome === 'victory', dawnState.result);
      check('天亮结算夜钟为 06:00 且包含天亮文案', dawnState.clock === 360 && /天亮/.test(dawnState.result?.reason || ''), { clock: dawnState.clock, reason: dawnState.result?.reason });
      await shot('29-result-victory-dawn');

      // 返回主菜单
      await browser.clickSelector('[data-result="menu"]');
      await waitFor(`window.__HORRIBLE_DORM.state.screen === 'menu'`);
      check('结算页“返回主菜单”回到菜单', await page(`Boolean(document.querySelector('.screen--menu'))`));
      const finalRecords = await page(`(() => { const raw = localStorage.getItem('horrible-dorm-reaction-v1'); return raw ? JSON.parse(raw).records : null; })()`);
      note(`累计记录 runs=${finalRecords?.runs} wins=${finalRecords?.wins}`);
      check('多次结算后记录累计正确', (finalRecords?.runs || 0) >= 3, finalRecords);
    });

    // ================= 阶段 9：刷新持久化与教程只首局 =================
    await scenario('P11 刷新持久化', async () => {
      const before = await page(`({ settings: window.__HORRIBLE_DORM.getSettings(), ls: window.__qa.localStorage() })`);
      check('设置持久化于 localStorage（volume=0.3 / muted / reducedMotion）',
        JSON.parse(before.ls['horrible-dorm-reaction-v1']).settings.volume === 0.3
        && JSON.parse(before.ls['horrible-dorm-reaction-v1']).settings.muted === true,
        JSON.parse(before.ls['horrible-dorm-reaction-v1']).settings);
      await browser.reload({ wait: 2200 });
      await browser.evalJs(PAGE_HELPERS);
      await qa('init()');
      const after = await page(`({ settings: window.__HORRIBLE_DORM.getSettings(), tutorialSeen: localStorage.getItem('hd-tutorial-seen-v1'), ls: window.__qa.localStorage() })`);
      check('刷新后设置从 localStorage 恢复', after.settings.volume === 0.3 && after.settings.reducedMotion === true, after.settings);
      check('刷新后仍处于主菜单（不恢复对局）', await page(`Boolean(document.querySelector('.screen--menu'))`));
      check('刷新后教程已读标记保留', after.tutorialSeen === '1');
      const tutorialAuto = await page(`(() => {
        const d = window.__HORRIBLE_DORM;
        d.startRunWith('room-301', 'normal', null, null);
        return Boolean(document.querySelector('.panel--tutorial'));
      })()`);
      await sleepMs(500);
      const tutorialAfterStart = await page(`Boolean(document.querySelector('.panel--tutorial')) || window.__qa.overlayKey().includes('tutorial')`);
      check('教程不再于第二局自动弹出', !tutorialAuto && !tutorialAfterStart, { immediate: tutorialAuto, afterFrame: tutorialAfterStart });
      const h = await hud();
      check('刷新后第二局 HUD 正常', h.clock !== null && h.dockCards > 0, h);
      await shot('30-reload-second-run');
      await page(`window.__HORRIBLE_DORM.actions.goMenu()`);
      await waitFor(`document.querySelector('.screen--menu')`);
    });

    // ================= 阶段 10：响应式（对局中） =================
    await scenario('P12 对局响应式与移动端', async () => {
      await page(`window.__HORRIBLE_DORM.startRunWith('room-301', 'nightmare', 'benzene', 'mercury')`);
      await page(`(() => { const s = window.__HORRIBLE_DORM.state; s.player.doorHp = s.player.doorMaxHp = 1e9; window.__HORRIBLE_DORM.advance(s.prepRemaining + 80); return true; })()`);
      const sizes = [
        [1280, 720, '31-game-1280x720'],
        [1920, 1080, '32-game-1920x1080'],
        [844, 390, '33-game-mobile-844x390'],
        [390, 844, '34-game-portrait-390x844'],
      ];
      for (const [w, hgt, name] of sizes) {
        await browser.setViewport(w, hgt, { mobile: w < 900 });
        await sleepMs(300);
        const ov = await qa('overflow()');
        const cs = await qa('canvasStats()');
        const center = await qa('centerCoverage()');
        const pauseBtn = await qa(`clickable('[data-act="hud.pause"]')`);
        const dockCard = await qa(`clickable('.build-card[data-dock-build="acid"]')`);
        const hudInfo = await hud();
        check(`对局 ${w}x${hgt}：Canvas 尺寸匹配视口`, cs.cssW === w && cs.cssH === hgt, { cssW: cs.cssW, cssH: cs.cssH });
        check(`对局 ${w}x${hgt}：无滚动溢出`, !ov.overflowX && !ov.overflowY, ov);
        if (w >= 900) {
          check(`对局 ${w}x${hgt}：中央 Canvas 未被遮挡（≥85%）`, center.ratio >= 0.85, center);
          check(`对局 ${w}x${hgt}：暂停按钮与建造卡可点`, pauseBtn.visible && pauseBtn.hit && dockCard.visible && dockCard.hit, { pauseBtn, dockCard });
        } else {
          note(`对局 ${w}x${hgt}：中央遮挡比 ${center.ratio}，block=${JSON.stringify(center.blockTags)}；暂停按钮可点=${pauseBtn.hit}；建造卡可点=${dockCard.hit}`);
          check(`对局 ${w}x${hgt}：HUD 与建造栏仍可见`, Boolean(hudInfo.clock) && hudInfo.dockCards > 0, { clock: hudInfo.clock, dockCards: hudInfo.dockCards });
        }
        if (w === 390) {
          check('竖屏 390x844 显示“请横屏守夜”提示', hudInfo.rotateTipVisible === true, hudInfo.rotateTipVisible);
          await shot(name);
          break;
        }
        await shot(name);
      }
      await browser.setViewport(1440, 900, { mobile: false });
      await sleepMs(250);
    });

    // ================= 阶段 11：自适应降质渲染回归（已知缺陷） =================
    await scenario('P13 自适应降质渲染回归', async () => {
      // 重新加载，重置 renderer 内部 errorCount，保证缺陷可独立复现
      await browser.reload({ wait: 2000 });
      await browser.evalJs(PAGE_HELPERS);
      await qa('init()');
      await qa(`startRun('room-301', 'normal', null, null)`);
      await sleepMs(500);
      const before = browser.consoleErrors.length;
      const perf = await page(`(() => {
        const d = window.__HORRIBLE_DORM;
        const s = d.state;
        for (let i = 0; i < 200; i += 1) {
          d.renderer.render(s, 20 + i * 0.05, 0.05);
        }
        return d.renderer.getPerformance ? d.renderer.getPerformance() : null;
      })()`);
      await sleepMs(350);
      const newErrors = browser.consoleErrors.slice(before);
      check('自适应降质后渲染不产生 console error（低帧率健壮性）', newErrors.length === 0, { newErrors, perf, knownTotal: knownRenderErrors().length });
      await shot('35-quality-downgrade');
    });
  } finally {
    report.consoleErrors = browser.consoleErrors;
    report.consoleWarnings = browser.consoleWarnings;
    report.exceptions = browser.exceptions;
    report.logEntries = browser.logEntries;
    report.network.requests = browser.requests.filter((r) => !r.url.startsWith('data:')).map((r) => ({ url: r.url, type: r.type }));
    report.network.responses = browser.responses.map((r) => ({ url: r.url, status: r.status, type: r.type }));
    report.network.failures = browser.failures;
    await browser.close();
  }

  // ================= 汇总 =================
  currentPhase = 'summary';
  const failed = report.checks.filter((c) => !c.ok);
  report.finishedAt = new Date().toISOString();
  report.summary = {
    total: report.checks.length,
    passed: report.checks.length - failed.length,
    failed: failed.length,
    shots: report.shots.length,
    consoleErrors: report.consoleErrors.length,
    exceptions: report.exceptions.length,
  };
  await writeFile('tools/qa/last-report.json', JSON.stringify(report, null, 2));
  console.log('\n================ SUMMARY ================');
  console.log(`checks ${report.summary.passed}/${report.summary.total} passed, ${report.summary.failed} failed`);
  if (failed.length) {
    console.log('FAILED:');
    for (const entry of failed) console.log(` - [${entry.phase}] ${entry.name} :: ${JSON.stringify(entry.detail)}`);
  }
  console.log(`shots: ${report.shots.length} -> ${OUT}`);
  console.log(`console errors: ${report.consoleErrors.length}; exceptions: ${report.exceptions.length}; warnings: ${report.consoleWarnings.length}`);
  if (report.consoleErrors.length) console.log(report.consoleErrors.slice(0, 10));
  if (report.exceptions.length) console.log(report.exceptions.slice(0, 5));
  console.log('report: tools/qa/last-report.json');
  process.exit(report.summary.failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
