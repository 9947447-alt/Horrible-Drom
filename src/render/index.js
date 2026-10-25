// Canvas 渲染器门面：DPR/缩放、静态层缓存、绘制编排、pickTile 坐标换算。
//
//   const renderer = createRenderer(canvas);
//   renderer.resize();
//   renderer.render(state, nowSeconds, deltaSeconds);
//   renderer.pickTile(clientX, clientY, state); // {tile:{x,y}, buildingId?}|null
//   renderer.getLayout(state);                 // 调试
//   renderer.destroy();

import { clamp, rgba, hash01 } from './util.js';
import {
  createLayout, screenToTile, project, unproject, layoutSummary, TILE,
} from './layout.js';
import { getRoom } from '../content/index.js';
import { getRoomTheme } from './themes.js';
import {
  buildStaticRoomCanvas, getRoomSpec, drawRoomAmbient, drawBed, drawDoor,
  drawCorridorDynamic, doorHpRatio,
} from './room.js';
import { drawBuildings, drawReactionLinks, drawReactionEmblems, drawPlacementHints } from './buildings.js';
import { computeNightmareVisuals, drawNightmares, nightmareBodyCenter } from './nightmares.js';
import { createFxSystem } from './fx.js';
import { buildOverlayCanvas } from './overlay.js';

const QUALITY_DPR = [2, 1.5, 1.25, 1];

export function createRenderer(canvas, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new Error('createRenderer(canvas): 需要有效的 <canvas> 元素');
  }
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('createRenderer: 无法获取 2D 上下文');

  const fx = createFxSystem();
  let layout = null;
  let layoutKey = '';
  let room = null;
  let theme = null;
  let spec = null;
  let staticCanvas = null;
  let overlayCanvas = null;
  let lastState = null;
  let lastScreen = null;
  let destroyed = false;
  let errorCount = 0;
  let shake = { x: 0, y: 0, amp: 0 };
  let lastFrameTime = 0;
  let resizeObserver = null;
  let needsResize = true;
  let qualityLevel = 0;
  let frameAvg = 1 / 60;
  let frameSamples = 0;
  let lastDeviceDpr = 1;

  // ---------------- 尺寸 / DPR ----------------

  function effectiveDpr() {
    const device = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    return Math.max(1, Math.min(device, QUALITY_DPR[qualityLevel], 2));
  }

  function measureCanvas() {
    const rect = canvas.getBoundingClientRect();
    let cssW = canvas.clientWidth || rect.width;
    let cssH = canvas.clientHeight || rect.height;
    if (!cssW || !cssH) {
      cssW = typeof window !== 'undefined' ? window.innerWidth : 1280;
      cssH = typeof window !== 'undefined' ? window.innerHeight : 720;
    }
    return { cssW, cssH };
  }

  function resizeBackingStore(cssW, cssH, dpr) {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }

  function resolveRoom(state) {
    const id = state?.roomId || state?.player?.roomId || room?.id || 'room-301';
    return getRoom(id);
  }

  function ensureLayout(state, force = false) {
    const roomDef = resolveRoom(state);
    const { cssW, cssH } = measureCanvas();
    const dpr = effectiveDpr();
    const key = `${roomDef.id}|${cssW.toFixed(1)}x${cssH.toFixed(1)}|${dpr}`;
    if (!force && layout && layoutKey === key) return layout;
    layout = createLayout({ cssW, cssH, room: roomDef, dpr });
    room = roomDef;
    theme = getRoomTheme(roomDef);
    spec = getRoomSpec(roomDef, theme);
    resizeBackingStore(cssW, cssH, dpr);
    staticCanvas = buildStaticRoomCanvas(layout, room, theme, dpr);
    overlayCanvas = buildOverlayCanvas(cssW, cssH, dpr);
    layoutKey = key;
    lastDeviceDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    needsResize = false;
    return layout;
  }

  function invalidate() {
    layout = null;
    layoutKey = '';
    staticCanvas = null;
    overlayCanvas = null;
    needsResize = true;
  }

  function handleResize() {
    needsResize = true;
    if (lastState && lastState.screen === 'game') {
      ensureLayout(lastState, true);
    }
  }

  // 监听容器尺寸变化（控制器即使忘记调 resize 也能自愈）
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleResize);
    if (typeof ResizeObserver !== 'undefined') {
      try {
        resizeObserver = new ResizeObserver(() => { needsResize = true; });
        resizeObserver.observe(canvas);
      } catch (e) {
        resizeObserver = null;
      }
    }
  }

  // ---------------- 质量自适应 ----------------

  function updateQuality(dt) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.2) return;
    frameAvg += (dt - frameAvg) * 0.06;
    frameSamples++;
    if (frameSamples > 120 && frameAvg > 0.021 && qualityLevel < QUALITY_DPR.length - 1) {
      qualityLevel++;
      frameSamples = 0;
      frameAvg = 1 / 60;
      invalidate();
    }
  }

  // ---------------- 环境对象 ----------------

  function buildEnv(state, nowSeconds, dt) {
    const simNow = Number.isFinite(state.now) ? state.now : nowSeconds;
    let now = Number(nowSeconds);
    if (!Number.isFinite(now)) now = simNow || 0;
    // 兼容把毫秒传进来的控制器
    if (now > 1e6) now = now / 1000;
    if (simNow > 1e6) simNow = simNow / 1000;
    const env = {
      layout,
      room,
      theme,
      spec,
      state,
      now,
      simNow,
      dt,
      dpr: layout.dpr,
      reducedMotion: !!(state.settings && state.settings.reducedMotion),
      nightmareVisuals: [],
      targets: [],
      pulses: null,
      repairLockUntil: 0,
    };
    env.nightmareVisuals = computeNightmareVisuals(env);
    env.targets = env.nightmareVisuals.map((v) => {
      const c = nightmareBodyCenter(v);
      return { x: c.x, y: c.y, hidden: v.hidden, dead: false, id: v.n && v.n.id };
    });
    // 维修锁定：任意梦魇的修复封锁时间
    let lock = 0;
    for (const n of state.activeNightmares || []) {
      if (n && n.statuses && Number.isFinite(n.statuses.repairLockUntil)) {
        lock = Math.max(lock, n.statuses.repairLockUntil);
      }
    }
    env.repairLockUntil = lock;
    return env;
  }

  // ---------------- 绘制 ----------------

  function drawWorld(env) {
    const dpr = layout.dpr;
    const shakeX = shake.amp > 0.02 ? shake.x : 0;
    const shakeY = shake.amp > 0.02 ? shake.y : 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#05080d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 静态房间层：一次 blit
    if (staticCanvas) {
      ctx.setTransform(1, 0, 0, 1, Math.round(shakeX * dpr), Math.round(shakeY * dpr));
      ctx.drawImage(staticCanvas, 0, 0);
    }

    ctx.setTransform(dpr, 0, 0, dpr, shakeX * dpr, shakeY * dpr);

    drawRoomAmbient(ctx, env);
    drawBed(ctx, env);
    drawReactionLinks(ctx, env);
    drawPlacementHints(ctx, env);
    drawBuildings(ctx, env);
    drawReactionEmblems(ctx, env);
    drawDoor(ctx, env);
    drawCorridorDynamic(ctx, env);
    drawNightmares(ctx, env);
    fx.draw(ctx, env);
    fx.drawText(ctx, env);
    drawAtmosphere(ctx, env);
    fx.drawScreen(ctx, env);

    // 全屏叠加层不跟随震屏，保持“镜头”稳定
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (overlayCanvas) ctx.drawImage(overlayCanvas, 0, 0);
  }

  function drawAtmosphere(ctx, env) {
    const { state, layout } = env;
    const { cssW, cssH } = layout;
    const phase = state.phase;
    const hpRatio = doorHpRatio(state);
    ctx.save();

    if (phase === 'night' || phase === 'prep') {
      // 夜色：前半夜偏冷，后半夜略微透暖
      const dawnAt = Number(state.dawnAt) || 480;
      const progress = phase === 'prep' ? 0 : clamp((state.nightElapsed || 0) / dawnAt, 0, 1);
      const cool = 0.1 - progress * 0.045;
      if (cool > 0.004) {
        ctx.fillStyle = rgba('#0d1a2b', cool);
        ctx.fillRect(0, 0, cssW, cssH);
      }
      // 黎明前从天窗/窗口方向透出的暖意
      if (progress > 0.62) {
        const a = (progress - 0.62) / 0.38;
        const g = ctx.createLinearGradient(0, 0, 0, cssH);
        g.addColorStop(0, rgba('#ff9f6a', 0.05 + a * 0.1));
        g.addColorStop(0.55, rgba('#ffc75a', 0.01 + a * 0.02));
        g.addColorStop(1, 'rgba(255,199,90,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, cssW, cssH);
      }
      // 门低血：红色警报边缘
      if (hpRatio < 0.32 && phase === 'night') {
        const pulseA = 0.5 + 0.5 * Math.sin(env.now * 5.4);
        const g = ctx.createRadialGradient(
          cssW / 2, cssH * 0.6, Math.min(cssW, cssH) * 0.24,
          cssW / 2, cssH * 0.6, Math.max(cssW, cssH) * 0.7
        );
        g.addColorStop(0, 'rgba(255,70,50,0)');
        g.addColorStop(1, `rgba(255,64,44,${0.07 + pulseA * 0.1})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, cssW, cssH);
      }
      // 准备阶段的冷雾边缘
      if (phase === 'prep') {
        const g = ctx.createLinearGradient(0, cssH * 0.75, 0, cssH);
        g.addColorStop(0, 'rgba(90,120,140,0)');
        g.addColorStop(1, 'rgba(90,120,140,0.08)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, cssW, cssH);
      }
    } else if (phase === 'victory') {
      const g = ctx.createLinearGradient(0, 0, 0, cssH);
      g.addColorStop(0, 'rgba(255,214,140,0.2)');
      g.addColorStop(0.45, 'rgba(255,180,94,0.08)');
      g.addColorStop(1, 'rgba(255,180,94,0.02)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cssW, cssH);
      // 清晨的一束光
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,224,170,0.06)';
      ctx.beginPath();
      ctx.moveTo(cssW * 0.42, 0);
      ctx.lineTo(cssW * 0.72, 0);
      ctx.lineTo(cssW * 0.62, cssH);
      ctx.lineTo(cssW * 0.3, cssH);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    } else if (phase === 'defeat') {
      ctx.fillStyle = 'rgba(24,4,6,0.38)';
      ctx.fillRect(0, 0, cssW, cssH);
      const g = ctx.createRadialGradient(cssW * 0.5, cssH * 0.55, 40, cssW * 0.5, cssH * 0.55, cssW * 0.7);
      g.addColorStop(0, 'rgba(70,6,8,0)');
      g.addColorStop(1, 'rgba(70,6,8,0.42)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cssW, cssH);
    }
    ctx.restore();
  }

  // ---------------- 公开 API ----------------

  function render(state, nowSeconds, deltaSeconds) {
    if (destroyed) return;
    try {
      if (!state || state.screen !== 'game') {
        lastState = state || lastState;
        if (lastScreen !== 'blank') {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          lastScreen = 'blank';
        }
        return;
      }
      lastScreen = 'game';
      lastState = state;

      // 浏览器缩放 / 窗口尺寸变化自愈
      if (typeof window !== 'undefined' && Math.abs((window.devicePixelRatio || 1) - lastDeviceDpr) > 0.01) {
        invalidate();
      }
      // 房间变化（重开/换房）
      const roomDef = resolveRoom(state);
      if (layout && layout.roomId !== roomDef.id) ensureLayout(state, true);

      let dt = Number(deltaSeconds);
      if (!Number.isFinite(dt) || dt < 0) dt = 0;
      if (dt > 10) dt /= 1000;
      dt = clamp(dt, 0, 0.1);
      updateQuality(dt);

      // updateQuality 可能因降档调用 invalidate()，必须在本帧 buildEnv 前重建布局。
      if (needsResize || !layout) ensureLayout(state, true);

      const env = buildEnv(state, nowSeconds, dt);
      fx.update(dt, env);
      env.pulses = fx.getPulses();
      shake = fx.getShake(env);

      drawWorld(env);
      lastFrameTime = env.now;
    } catch (err) {
      errorCount++;
      if (errorCount <= 3 && typeof console !== 'undefined') {
        console.error('[render] 渲染出现异常，已跳过本帧：', err);
      }
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#05080d';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } catch (e) { /* 忽略 */ }
    }
  }

  function resize() {
    if (destroyed) return;
    const state = lastState;
    if (state && state.screen === 'game') {
      ensureLayout(state, true);
    } else {
      invalidate();
    }
  }

  function clientToCss(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const layoutW = canvas.clientWidth || rect.width || 1;
    const layoutH = canvas.clientHeight || rect.height || 1;
    const fxScale = rect.width ? layoutW / rect.width : 1;
    const fyScale = rect.height ? layoutH / rect.height : 1;
    return {
      x: (clientX - rect.left) * fxScale,
      y: (clientY - rect.top) * fyScale,
    };
  }

  function pickTile(clientX, clientY, state) {
    if (destroyed) return null;
    const s = state || lastState;
    if (!s || s.screen !== 'game') return null;
    try {
      if (!layout || layout.roomId !== resolveRoom(s).id) ensureLayout(s, true);
      const css = clientToCss(clientX, clientY);
      const hit = screenToTile(layout, css.x, css.y);
      if (!hit) return null;
      const building = (s.buildings || []).find(
        (b) => b && b.tile && b.tile.x === hit.tile.x && b.tile.y === hit.tile.y
      );
      const result = { tile: hit.tile };
      if (building) result.buildingId = building.id;
      return result;
    } catch (err) {
      return null;
    }
  }

  function getLayout(state) {
    const s = state || lastState;
    if (!layout) {
      if (s && s.screen === 'game') {
        try {
          ensureLayout(s, true);
        } catch (e) {
          return null;
        }
      } else {
        return null;
      }
    }
    const summary = layoutSummary(layout);
    summary.canvas = {
      cssW: layout.cssW,
      cssH: layout.cssH,
      dpr: layout.dpr,
      backingW: canvas.width,
      backingH: canvas.height,
    };
    summary.pointer = clientToCss;
    summary.projectTile = (x, y) => project(layout, x + 0.5, y + 0.5);
    summary.unproject = (screenX, screenY) => unproject(layout, screenX, screenY);
    summary.quality = { level: qualityLevel, frameAvg };
    return summary;
  }

  function getPerformance() {
    return {
      fps: frameAvg > 0 ? 1 / frameAvg : 0,
      dpr: layout ? layout.dpr : effectiveDpr(),
      qualityLevel,
      canvas: { width: canvas.width, height: canvas.height },
      lastFrameTime,
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (typeof window !== 'undefined') window.removeEventListener('resize', handleResize);
    if (resizeObserver) {
      try { resizeObserver.disconnect(); } catch (e) { /* 忽略 */ }
      resizeObserver = null;
    }
    fx.reset();
    staticCanvas = null;
    overlayCanvas = null;
    layout = null;
    lastState = null;
    room = null;
    theme = null;
    spec = null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    try { ctx.clearRect(0, 0, canvas.width, canvas.height); } catch (e) { /* 忽略 */ }
  }

  // 初始按当前画布尺寸建好布局，避免第一帧闪错位。
  if (typeof window !== 'undefined') {
    try {
      const initial = measureCanvas();
      if (initial.cssW > 0 && initial.cssH > 0) {
        // 首次 render 时再按 state 建房；这里只记录 DPR。
        lastDeviceDpr = window.devicePixelRatio || 1;
      }
    } catch (e) { /* 忽略 */ }
  }

  return {
    resize,
    render,
    pickTile,
    getLayout,
    destroy,
    getPerformance,
  };
}

export { TILE };
