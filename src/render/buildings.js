// 建筑美术：酸系六阶段 × I–III、氯酸钾/苯 I–X、七种设备。
// 全部程序化绘制；只读取 state.buildings 与 content 的展示数据。

import {
  TAU, clamp, lerp, hash01, hashString, rngFrom, rgba, mixColor, darken, lighten,
  smoothNoise, roman, angleTo, dist,
} from './util.js';
import { project, tileCenter, projectElevated, rangeEllipse, tracePolygon } from './layout.js';
import {
  drawText, drawGlow, drawSoftShadow, roundRect, blobPath, flameShape, boltPath,
  dashedEllipse, line, drawTag, paperTag, FONT_SANS, FONT_SERIF,
} from './paint.js';
import { gauge, rivet, screenCylinder, screenPlate, isoBox, nameplate } from './iso.js';
import {
  ACID_STAGES, getAcidStage, SPECIAL_TOWERS, DEVICES, getBuildingLabel,
  getBuildingStats, getBuildCost, getBuildDef,
} from '../content/index.js';
import { isBuildableTile } from '../content/index.js';
import { REACTIONS, REACTION_LOOKUP } from '../content/index.js';

const ART_SCALE = 1.24; // 建筑主体的视觉放大（不改变格子锚点）

const BASE = {
  padTop: 'rgba(74,72,64,0.98)',
  padSide: 'rgba(47,46,41,0.98)',
  padEdge: 'rgba(24,22,18,0.8)',
  ink: 'rgba(18,14,10,0.85)',
  brass: 'rgba(160,124,66,0.95)',
  steel: 'rgba(92,96,94,0.98)',
  steelLight: 'rgba(134,140,136,0.98)',
  steelDark: 'rgba(56,60,58,0.98)',
  paper: 'rgba(226,212,180,0.95)',
};

// 煤/碱/苯/设备的屏幕高度与炮口长度（单位：scale 后的 px 系数）。
const MUZZLE = {
  acid: { height: 34, len: 24 },
  chlorate: { height: 38, len: 30 },
  benzene: { height: 40, len: 18 },
  analyzer: { height: 48, len: 10 },
  condenser: { height: 34, len: 14 },
  vent: { height: 44, len: 14 },
  catalyst: { height: 26, len: 14 },
  neutralizer: { height: 14, len: 14 },
  accelerator: { height: 30, len: 26 },
  atm: { height: 38, len: 10 },
};

export function getBuildCenter(layout, building) {
  return tileCenter(layout, building.tile.x, building.tile.y);
}

/** 炮口位置与朝向；特效层也使用同一套计算，保证弹道从炮口发出。 */
export function getBuildingMuzzle(layout, building, target) {
  const p = getBuildCenter(layout, building);
  const s = layout.scale * ART_SCALE;
  const cfg = MUZZLE[building.type] || MUZZLE.acid;
  const pivot = { x: p.x, y: p.y - (cfg.height + (building.type === 'acid' ? (building.stage - 1) * 2 : 0)) * s };
  let tx = p.x + 120 * s;
  let ty = p.y + 60 * s;
  if (target) {
    tx = target.x;
    ty = target.y;
  }
  const angle = Math.atan2(ty - pivot.y, tx - pivot.x);
  const len = (cfg.len + (building.type === 'acid' ? building.stage * 1.2 : 0)) * s;
  return {
    x: pivot.x + Math.cos(angle) * len,
    y: pivot.y + Math.sin(angle) * len,
    pivot,
    angle,
    scale: s,
  };
}

function pickupTarget(env, p, range) {
  const targets = env.targets || [];
  let best = null;
  let bestD = Infinity;
  for (const t of targets) {
    if (!t || t.dead) continue;
    const d = dist(p.x, p.y, t.x, t.y);
    if (d < bestD && d <= (range || 1e9)) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

function aimFor(ctx, env, b, rangePx) {
  const p = getBuildCenter(env.layout, b);
  const target = pickupTarget(env, p, rangePx);
  return getBuildingMuzzle(env.layout, b, target);
}

// ---------------- 主入口 ----------------

export function drawReactionLinks(ctx, env) {
  const { layout, state, now } = env;
  const links = Array.isArray(state?.reactions) ? state.reactions : [];
  if (!links.length) return;
  const byId = new Map((state.buildings || []).map((b) => [b.id, b]));
  ctx.save();
  for (const link of links) {
    const a = byId.get(link.aId);
    const b = byId.get(link.bId);
    if (!a || !b) continue;
    const pa = getBuildCenter(layout, a);
    const pb = getBuildCenter(layout, b);
    const def = REACTION_LOOKUP[link.id] || null;
    const color = def?.accent || '#ffc75a';
    const s = layout.scale;
    const phase = (now * 0.6 + hashString(link.id) % 100 / 100) % 1;
    // 贴地的发光管道
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y + 3 * s);
    ctx.lineTo(pb.x, pb.y + 3 * s);
    ctx.strokeStyle = rgba(color, 0.14);
    ctx.lineWidth = 10 * s;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y + 3 * s);
    ctx.lineTo(pb.x, pb.y + 3 * s);
    ctx.strokeStyle = rgba(color, 0.62);
    ctx.lineWidth = 2.2 * s;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y + 3 * s);
    ctx.lineTo(pb.x, pb.y + 3 * s);
    ctx.strokeStyle = rgba('#fff4d8', 0.28);
    ctx.lineWidth = 0.8 * s;
    ctx.stroke();
    // 流动的光点
    for (let i = 0; i < 2; i++) {
      const t = (phase + i * 0.5) % 1;
      const x = lerp(pa.x, pb.x, t);
      const y = lerp(pa.y, pb.y, t) + 3 * s;
      drawGlow(ctx, color, x, y, 7 * s, 0.5);
      ctx.fillStyle = rgba('#fff4d8', 0.7);
      ctx.beginPath();
      ctx.arc(x, y, 1.8 * s, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    // 中点反应徽记
    const mx = (pa.x + pb.x) / 2;
    const my = (pa.y + pb.y) / 2;
    ctx.save();
    ctx.translate(mx, my - 2 * s);
    ctx.rotate(now * 0.3);
    ctx.strokeStyle = rgba(color, 0.55);
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const r = 5 * s;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** 反应链的悬浮徽记：在建筑之上再强调一次，避免被建筑遮住。 */
export function drawReactionEmblems(ctx, env) {
  const { layout, state, now } = env;
  const links = Array.isArray(state?.reactions) ? state.reactions : [];
  if (!links.length) return;
  const byId = new Map((state.buildings || []).map((b) => [b.id, b]));
  const s = layout.scale;
  ctx.save();
  for (const link of links) {
    const a = byId.get(link.aId);
    const b = byId.get(link.bId);
    if (!a || !b) continue;
    const pa = getBuildCenter(layout, a);
    const pb = getBuildCenter(layout, b);
    const def = REACTION_LOOKUP[link.id] || null;
    const color = def?.accent || '#ffc75a';
    const mx = (pa.x + pb.x) / 2;
    const my = (pa.y + pb.y) / 2 - 42 * s;
    const bob = Math.sin(now * 1.6 + (hashString(link.id) % 100) / 30) * 2.2 * s;
    ctx.save();
    ctx.translate(mx, my + bob);
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, color, 0, 0, 16 * s, 0.22);
    ctx.globalCompositeOperation = 'source-over';
    ctx.rotate(now * 0.25);
    ctx.strokeStyle = rgba(color, 0.7);
    ctx.lineWidth = 1.3 * s;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * TAU;
      const r = 6 * s;
      if (i === 0) ctx.moveTo(Math.cos(ang) * r, Math.sin(ang) * r);
      else ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = rgba(color, 0.18);
    ctx.fill();
    ctx.rotate(-now * 0.25);
    // 两条细线连回建筑
    ctx.strokeStyle = rgba(color, 0.16);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-6 * s, 4 * s);
    ctx.lineTo(pa.x - mx, pa.y - my + bob);
    ctx.moveTo(6 * s, 4 * s);
    ctx.lineTo(pb.x - mx, pb.y - my + bob);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** 放置提示、建造预览、射程圈、悬浮高亮。 */
export function drawPlacementHints(ctx, env) {
  const { layout, state } = env;
  const room = env.room;
  const ui = state?.ui || {};
  const s = layout.scale;
  const buildMode = ui.buildMode;
  const hover = ui.hoverTile;
  const selectedId = ui.selectedBuildingId;

  // 建造模式：给所有可建造格加一层很淡的提示
  if (buildMode) {
    for (let y = 0; y < room.h; y++) {
      for (let x = 0; x < room.w; x++) {
        if (!isBuildableTile(room, { x, y })) continue;
        if (occupied(state, x, y)) continue;
        const pts = floorDiamond(layout, x, y, 0.1);
        tracePolygon(ctx, pts);
        ctx.fillStyle = 'rgba(244,234,212,0.035)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(244,234,212,0.06)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
  }

  // 悬停格
  if (hover && Number.isInteger(hover.x) && Number.isInteger(hover.y)) {
    const inRoom = hover.x >= 0 && hover.y >= 0 && hover.x < room.w && hover.y < room.h;
    if (inRoom) {
      let valid = true;
      if (buildMode) valid = checkPlacement(state, room, buildMode, hover).ok;
      const pts = floorDiamond(layout, hover.x, hover.y, 0.04);
      tracePolygon(ctx, pts);
      ctx.fillStyle = buildMode
        ? valid
          ? 'rgba(126,217,167,0.18)'
          : 'rgba(255,107,87,0.18)'
        : 'rgba(255,199,90,0.12)';
      ctx.fill();
      ctx.strokeStyle = buildMode
        ? valid
          ? 'rgba(126,217,167,0.65)'
          : 'rgba(255,107,87,0.7)'
        : 'rgba(255,199,90,0.4)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      // 四角提亮
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6, 0, TAU);
        ctx.fillStyle = 'rgba(244,234,212,0.5)';
        ctx.fill();
      }
    }
  }

  // 选中建筑：射程圈 + 底座描边
  const selected = (state?.buildings || []).find((b) => b.id === selectedId);
  if (selected) {
    const p = getBuildCenter(layout, selected);
    const stats = safeStats(selected);
    if (stats && typeof stats.range === 'number') {
      const e = rangeEllipse(layout, selected.tile.x, selected.tile.y, stats.range);
      dashedEllipse(ctx, e.x, e.y, e.rx, e.ry, {
        color: 'rgba(255,199,90,0.5)',
        width: 1.3,
        dash: [6, 7],
        offset: (env.now * 12) % 13,
      });
      dashedEllipse(ctx, e.x, e.y, e.rx * 0.995, e.ry * 0.995, {
        color: 'rgba(255,199,90,0.12)',
        width: 4,
        dash: [6, 7],
        offset: (env.now * 12) % 13,
      });
    }
    drawSelectionRing(ctx, p, layout, '#ffc75a', env.now);
    // 名称浮签
    const label = getBuildingLabel(selected);
    drawTag(ctx, p.x, p.y - 66 * s, measureTagWidth(ctx, label, 11.5 * s), 17 * s, label, {
      bar: stats?.accent || '#ffc75a',
      size: 11 * s,
    });
  }

  // 建造预览鬼影
  if (buildMode && hover) {
    const check = checkPlacement(state, room, buildMode, hover);
    if (check.inRoom) {
      const ghostBuilding = {
        id: '__preview__',
        type: buildMode.type,
        stage: buildMode.stage || 1,
        level: 1,
        tile: { x: hover.x, y: hover.y },
      };
      ctx.save();
      ctx.globalAlpha = check.ok ? 0.55 : 0.32;
      drawBuilding(ctx, ghostBuilding, env, { ghost: true });
      ctx.restore();
      // 预览射程
      const def = buildMode.type === 'acid' ? getAcidStage(buildMode.stage || 1) : getBuildDef(buildMode.type);
      const stats = buildMode.type === 'acid'
        ? { range: def.baseRange, accent: def.accent }
        : def && def.type !== 'atm' && def.type !== 'accelerator'
          ? { range: def.baseRange || def.range?.[1] || def.revealRange?.[1] || 2.2, accent: def.accent }
          : null;
      if (stats && stats.range) {
        const e = rangeEllipse(layout, hover.x, hover.y, stats.range);
        dashedEllipse(ctx, e.x, e.y, e.rx, e.ry, {
          color: check.ok ? rgba(stats.accent || '#7ed9a7', 0.5) : 'rgba(255,107,87,0.45)',
          width: 1.2,
          dash: [5, 6],
        });
      }
      // 有效/无效提示
      const pts = floorDiamond(layout, hover.x, hover.y, 0.02);
      tracePolygon(ctx, pts);
      ctx.strokeStyle = check.ok ? 'rgba(126,217,167,0.8)' : 'rgba(255,107,87,0.85)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }
}

function safeStats(building) {
  try {
    return getBuildingStats(building);
  } catch (e) {
    return null;
  }
}

function occupied(state, x, y) {
  return (state?.buildings || []).some((b) => b.tile && b.tile.x === x && b.tile.y === y);
}

/** 判断是否可放置（只用于预览着色，最终以游戏层结果为准）。 */
export function checkPlacement(state, room, buildMode, tile) {
  const inRoom = !!tile && tile.x >= 0 && tile.y >= 0 && tile.x < room.w && tile.y < room.h;
  if (!inRoom) return { ok: false, inRoom: false, reason: 'outside' };
  if (!isBuildableTile(room, tile)) return { ok: false, inRoom: true, reason: 'blocked' };
  if (occupied(state, tile.x, tile.y)) return { ok: false, inRoom: true, reason: 'occupied' };
  const player = state?.player || {};
  const cost = getBuildCost(buildMode.type, { stage: buildMode.stage || 1 });
  if (cost) {
    if ((player.dream || 0) < (cost.dream || 0) || (player.reagent || 0) < (cost.reagent || 0)) {
      return { ok: false, inRoom: true, reason: 'cost' };
    }
  }
  if (buildMode.type === 'acid') {
    const stage = buildMode.stage || 1;
    if (stage > (state?.acidUnlocked || 1)) return { ok: false, inRoom: true, reason: 'locked' };
  }
  const def = getBuildDef(buildMode.type);
  if (def?.maxCount) {
    const count = (state?.buildings || []).filter((b) => b.type === buildMode.type).length;
    if (count >= def.maxCount) return { ok: false, inRoom: true, reason: 'limit' };
  }
  return { ok: true, inRoom: true };
}

// ---------------- 建筑遍历 ----------------

export function drawBuildings(ctx, env) {
  const buildings = Array.isArray(env.state?.buildings) ? env.state.buildings : [];
  const sorted = [...buildings].sort((a, b) => {
    const da = a.tile.x + a.tile.y;
    const db = b.tile.x + b.tile.y;
    if (da !== db) return da - db;
    return a.tile.x - b.tile.x;
  });
  const selectedId = env.state?.ui?.selectedBuildingId;
  const hover = env.state?.ui?.hoverTile;
  for (const b of sorted) {
    const isSelected = b.id === selectedId;
    const isHover = !!hover && b.tile.x === hover.x && b.tile.y === hover.y;
    drawBuilding(ctx, b, env, { selected: isSelected, hover: isHover });
  }
}

export function drawBuilding(ctx, b, env, opts = {}) {
  const { layout, now, simNow } = env;
  const p = getBuildCenter(layout, b);
  const s = layout.scale;
  const disabled = !opts.ghost && typeof b.disabledUntil === 'number' && b.disabledUntil > simNow;
  const overheat = !opts.ghost && typeof b.overheat === 'number' && b.overheat > 0;
  const seed = hashString(b.id || `${b.type}${b.tile.x},${b.tile.y}`);

  // 阴影 & 底座
  ctx.save();
  if (!opts.ghost) drawSoftShadow(ctx, p.x, p.y + 3 * s, 26 * s, 9 * s, 0.5);
  drawPad(ctx, layout, b, p, s, seed, opts);
  ctx.restore();

  // 建筑主体
  ctx.save();
  const aim = drawDispatch(ctx, b, env, p, s, seed, opts);
  ctx.restore();

  // 状态叠层
  if (opts.ghost) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    if (opts.hover) {
      ctx.strokeStyle = 'rgba(255,199,90,0.7)';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(p.x - 20 * s, p.y - 56 * s, 40 * s, 58 * s);
    }
    ctx.restore();
    return;
  }

  if (disabled) drawDisabled(ctx, p, s, now);
  if (overheat) drawOverheat(ctx, p, s, now);
  if (opts.selected) {
    drawSelectionRing(ctx, p, layout, '#ffc75a', now, true);
  } else if (opts.hover) {
    drawSelectionRing(ctx, p, layout, 'rgba(255,199,90,0.55)', now, false);
  }

  // 极小的等级记号：炮塔用黄铜刻度，设备用铆钉
  drawLevelMarks(ctx, b, p, s);
}

function drawDispatch(ctx, b, env, p, s, seed, opts) {
  const aimTarget = pickupTarget(env, p, 1e9);
  const aim = getBuildingMuzzle(env.layout, b, aimTarget);
  const artS = s * ART_SCALE;
  switch (b.type) {
    case 'acid':
      return drawAcid(ctx, env, b, p, artS, seed, aim, opts);
    case 'chlorate':
      return drawChlorate(ctx, env, b, p, artS, seed, aim, opts);
    case 'benzene':
      return drawBenzene(ctx, env, b, p, artS, seed, aim, opts);
    case 'analyzer':
      return drawAnalyzer(ctx, env, b, p, artS, seed, opts);
    case 'condenser':
      return drawCondenser(ctx, env, b, p, artS, seed, opts);
    case 'vent':
      return drawVent(ctx, env, b, p, artS, seed, opts);
    case 'catalyst':
      return drawCatalyst(ctx, env, b, p, artS, seed, opts);
    case 'neutralizer':
      return drawNeutralizer(ctx, env, b, p, artS, seed, opts);
    case 'accelerator':
      return drawAccelerator(ctx, env, b, p, artS, seed, opts);
    case 'atm':
      return drawAtm(ctx, env, b, p, artS, seed, opts);
    default:
      drawGeneric(ctx, p, s, seed);
      return aim;
  }
}

// ---------------- 底座与状态 ----------------

function drawPad(ctx, layout, b, p, s, seed, opts) {
  const x = b.tile.x + 0.07;
  const y = b.tile.y + 0.07;
  const pad = [
    projectElevated(layout, x, y, 3),
    projectElevated(layout, x + 0.86, y, 3),
    projectElevated(layout, x + 0.86, y + 0.86, 3),
    projectElevated(layout, x, y + 0.86, 3),
  ];
  isoBox(ctx, layout, x, y, x + 0.86, y + 0.86, 3, {
    topFill: 'rgba(78,76,66,0.99)',
    southFill: 'rgba(52,50,43,0.99)',
    eastFill: 'rgba(40,38,33,0.99)',
    line: 'rgba(18,15,11,0.8)',
    lineWidth: 1,
  });
  // 顶面的网格蚀刻
  tracePolygon(ctx, pad);
  ctx.strokeStyle = 'rgba(244,234,212,0.07)';
  ctx.lineWidth = 0.7;
  ctx.stroke();
  // 四角铆钉
  for (const q of [
    projectElevated(layout, x + 0.12, y + 0.12, 3.4),
    projectElevated(layout, x + 0.74, y + 0.12, 3.4),
    projectElevated(layout, x + 0.74, y + 0.74, 3.4),
    projectElevated(layout, x + 0.12, y + 0.74, 3.4),
  ]) {
    rivet(ctx, q.x, q.y, 2.2 * s, 'rgba(26,24,20,0.85)', 'rgba(240,226,190,0.3)');
  }
  // 底部标签槽
  const front = projectElevated(layout, x + 0.5, y + 0.86, 1.2);
  ctx.fillStyle = 'rgba(20,18,14,0.45)';
  ctx.fillRect(front.x - 12 * s, front.y - 1.6 * s, 24 * s, 2.6 * s);
}

function drawLevelMarks(ctx, b, p, s) {
  const level = b.level || 1;
  ctx.save();
  if (b.type === 'acid' || b.type === 'analyzer' || b.type === 'condenser' || b.type === 'vent'
    || b.type === 'catalyst' || b.type === 'neutralizer' || b.type === 'accelerator' || b.type === 'atm') {
    for (let i = 0; i < 3; i++) {
      const lit = i < level;
      ctx.fillStyle = lit ? 'rgba(255,199,90,0.85)' : 'rgba(30,26,20,0.55)';
      ctx.beginPath();
      ctx.arc(p.x - 8 * s + i * 8 * s, p.y + 6 * s, 1.8 * s, 0, TAU);
      ctx.fill();
    }
  } else {
    // 特化炮塔：在底座前缘刻下罗马数字
    ctx.fillStyle = 'rgba(226,212,180,0.55)';
    ctx.font = `700 ${8 * s}px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(roman(level), p.x, p.y + 8 * s);
  }
  ctx.restore();
}

function drawSelectionRing(ctx, p, layout, color, now, strong) {
  const s = layout.scale;
  const rx = 32 * s;
  const ry = 15 * s;
  ctx.save();
  const pulseA = strong ? 0.65 + 0.2 * Math.sin(now * 4) : 0.4;
  ctx.strokeStyle = rgba(color, pulseA);
  ctx.lineWidth = strong ? 1.8 : 1.1;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + 5 * s, rx, ry, 0, 0, TAU);
  ctx.stroke();
  // 四角括号
  ctx.strokeStyle = rgba(color, 0.75);
  ctx.lineWidth = strong ? 1.6 : 1;
  const cy = -38 * s;
  for (let i = 0; i < 4; i++) {
    const sx = (i % 2 === 0 ? -1 : 1) * (rx + 3 * s);
    const sy = p.y + cy + (i < 2 ? 0 : 70 * s);
    ctx.beginPath();
    ctx.moveTo(p.x + sx * 0.82, sy + (i < 2 ? 6 * s : -6 * s));
    ctx.lineTo(p.x + sx, sy);
    ctx.lineTo(p.x + sx * 0.62, sy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDisabled(ctx, p, s, now) {
  ctx.save();
  ctx.fillStyle = 'rgba(8,12,16,0.5)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + 3 * s, 28 * s, 12 * s, 0, 0, TAU);
  ctx.fill();
  // 电气噪点
  const flick = 0.4 + 0.3 * Math.sin(now * 13);
  ctx.strokeStyle = rgba('#9fd0f0', flick);
  ctx.lineWidth = 1;
  ctx.beginPath();
  const seed = Math.floor(now * 14);
  boltPath(ctx, p.x - 14 * s, p.y - 24 * s, p.x + 12 * s, p.y - 6 * s, seed, 7, 14 * s);
  ctx.stroke();
  drawGlow(ctx, '#8fd8ff', p.x, p.y - 20 * s, 16 * s, 0.12);
  ctx.restore();
}

function drawOverheat(ctx, p, s, now) {
  ctx.save();
  const a = 0.25 + 0.2 * Math.sin(now * 8);
  drawGlow(ctx, '#ff6b57', p.x, p.y - 30 * s, 34 * s, a * 0.5);
  // 蒸汽
  ctx.strokeStyle = 'rgba(230,220,200,0.18)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    const t = (now * 0.6 + i * 0.33) % 1;
    ctx.beginPath();
    ctx.arc(p.x + Math.sin(now * 2 + i) * 6 * s, p.y - (26 + t * 40) * s, (2 + t * 6) * s, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------- 酸系炮台 ----------------

function drawAcid(ctx, env, b, p, s, seed, aim, opts) {
  const stage = clamp(b.stage || 1, 1, 6);
  const def = getAcidStage(stage);
  const level = clamp(b.level || 1, 1, 3);
  const accent = def.accent;
  const t = env.now;

  // 主体支架：纸板+铁架
  ctx.save();
  ctx.translate(p.x, p.y);
  const h = (24 + stage * 1.5 + level * 2) * s;

  // 后侧铁架
  ctx.strokeStyle = BASE.steelDark;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(-13 * s, 0);
  ctx.lineTo(-10 * s, -h);
  ctx.moveTo(13 * s, 0);
  ctx.lineTo(10 * s, -h);
  ctx.stroke();

  // 阶段主体
  if (stage === 1) drawAcidSilica(ctx, env, s, h, accent, level, t, seed);
  else if (stage === 2) drawAcidCarbonic(ctx, env, s, h, accent, level, t, seed);
  else if (stage === 3) drawAcidHydrochloric(ctx, env, s, h, accent, level, t, seed);
  else if (stage === 4) drawAcidSulfuric(ctx, env, s, h, accent, level, t, seed);
  else if (stage === 5) drawAcidHypochlorous(ctx, env, s, h, accent, level, t, seed);
  else drawAcidPerchloric(ctx, env, s, h, accent, level, t, seed);

  // 等级强化：黄铜环/额外支架/刻度
  if (level >= 2) {
    ctx.strokeStyle = 'rgba(176,138,74,0.9)';
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.72, 13 * s, 5 * s, 0, 0, TAU);
    ctx.stroke();
    // 侧面小罐
    screenCylinder(ctx, -12 * s, -h * 0.3, 4 * s, 2.6 * s, 10 * s, {
      side: rgba(darken(accent, 0.4), 0.85),
      top: rgba(accent, 0.5),
      rim: 'rgba(30,24,16,0.6)',
    });
  }
  if (level >= 3) {
    // 发光刻度与底座护板
    for (let i = 0; i < 3; i++) {
      const y = -h * (0.35 + i * 0.18);
      ctx.fillStyle = rgba(accent, 0.28 + 0.12 * Math.sin(t * 2 + i));
      ctx.fillRect(-14 * s, y, 28 * s, 1.4 * s);
    }
    drawGlow(ctx, accent, 0, -h * 0.5, 30 * s, 0.12);
    ctx.strokeStyle = 'rgba(176,138,74,0.8)';
    ctx.lineWidth = 1.4 * s;
    ctx.strokeRect(-14 * s, -h * 0.16, 28 * s, 6 * s);
  }

  // 炮口（绝对坐标，不随主体平移）
  ctx.restore();
  drawAcidNozzle(ctx, aim, s, accent, stage, t);

  // 阶段光环
  if (stage >= 4) {
    drawGlow(ctx, accent, p.x, p.y - h * 0.8, (18 + stage * 2) * s, 0.08);
  }
}

function drawAcidNozzle(ctx, aim, s, accent, stage, t) {
  const pivot = aim.pivot;
  ctx.save();
  ctx.translate(pivot.x, pivot.y);
  ctx.rotate(aim.angle);
  const len = aim.scale * (16 + stage * 1.5);
  // 炮筒
  const g = ctx.createLinearGradient(0, -3 * s, 0, 3 * s);
  g.addColorStop(0, 'rgba(120,116,106,0.98)');
  g.addColorStop(1, 'rgba(56,54,48,0.98)');
  ctx.fillStyle = g;
  roundRect(ctx, 0, -2.6 * s, len, 5.2 * s, 2.4 * s, g);
  ctx.strokeStyle = 'rgba(20,16,12,0.7)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // 炮口环
  ctx.fillStyle = rgba(accent, 0.9);
  ctx.beginPath();
  ctx.ellipse(len, 0, 2.4 * s, 3 * s, 0, 0, TAU);
  ctx.fill();
  drawGlow(ctx, accent, len, 0, 8 * s, 0.3);
  // 后座橡皮/弹簧
  ctx.strokeStyle = 'rgba(60,50,38,0.9)';
  ctx.lineWidth = 1.6 * s;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(2 * s + i * 2.4 * s, -3.4 * s);
    ctx.lineTo(2 * s + i * 2.4 * s, 3.4 * s);
    ctx.stroke();
  }
  // 枪口冒出的阶段特征
  if (stage === 2) {
    for (let i = 0; i < 3; i++) {
      const t2 = (t * 1.4 + i * 0.33) % 1;
      ctx.fillStyle = rgba(accent, (1 - t2) * 0.5);
      ctx.beginPath();
      ctx.arc(len + 4 * s + t2 * 10 * s, Math.sin(i * 2 + t * 3) * 3 * s, (1.4 - t2) * s, 0, TAU);
      ctx.fill();
    }
  } else if (stage >= 5) {
    const a = 0.1 + 0.06 * Math.sin(t * 6);
    ctx.fillStyle = rgba(accent, a);
    ctx.beginPath();
    ctx.moveTo(len, -2 * s);
    ctx.lineTo(len + 16 * s, -7 * s);
    ctx.lineTo(len + 20 * s, 5 * s);
    ctx.lineTo(len, 2 * s);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawAcidSilica(ctx, env, s, h, accent, level, t, seed) {
  // 木架 + 玻璃滴管
  ctx.save();
  // 木架
  ctx.fillStyle = 'rgba(96,72,46,0.98)';
  ctx.fillRect(-11 * s, -9 * s, 22 * s, 5 * s);
  ctx.fillStyle = 'rgba(60,44,28,0.98)';
  ctx.fillRect(-11 * s, -4 * s, 22 * s, 3 * s);
  // 玻璃管
  const tubeH = h * 0.62;
  const g = ctx.createLinearGradient(-8 * s, 0, 8 * s, 0);
  g.addColorStop(0, 'rgba(170,220,214,0.25)');
  g.addColorStop(0.45, 'rgba(220,250,244,0.4)');
  g.addColorStop(1, 'rgba(120,180,174,0.22)');
  ctx.fillStyle = g;
  roundRect(ctx, -7 * s, -tubeH, 14 * s, tubeH - 8 * s, 5 * s, g);
  ctx.strokeStyle = 'rgba(200,240,232,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 凝胶液
  ctx.fillStyle = rgba(accent, 0.55);
  roundRect(ctx, -5.4 * s, -tubeH * 0.66, 10.8 * s, tubeH * 0.58, 4 * s, rgba(accent, 0.55));
  // 液面
  ctx.fillStyle = rgba(lighten(accent, 0.3), 0.6);
  ctx.beginPath();
  ctx.ellipse(0, -tubeH * 0.66, 5.4 * s, 1.8 * s, 0, 0, TAU);
  ctx.fill();
  // 气泡
  for (let i = 0; i < 4; i++) {
    const t2 = (t * 0.5 + i * 0.25) % 1;
    ctx.fillStyle = rgba('#d8fff7', 0.4 * (1 - t2));
    ctx.beginPath();
    ctx.arc((hash01(seed, i) - 0.5) * 6 * s, -tubeH * 0.2 - t2 * tubeH * 0.5, (1.2 + hash01(i, 2) * 1.6) * s, 0, TAU);
    ctx.fill();
  }
  // 滴管头
  ctx.fillStyle = 'rgba(90,74,54,0.98)';
  roundRect(ctx, -4.4 * s, -tubeH - 5 * s, 8.8 * s, 6 * s, 2 * s, 'rgba(90,74,54,0.98)');
  ctx.fillStyle = rgba(accent, 0.7);
  ctx.beginPath();
  ctx.arc(0, -tubeH - 1.5 * s, 1.6 * s, 0, TAU);
  ctx.fill();
  // 滴落
  const drip = (t * 0.7) % 1;
  ctx.fillStyle = rgba(accent, 0.8 * (1 - drip));
  ctx.beginPath();
  ctx.arc(0, -tubeH + 8 * s + drip * 14 * s, 1.4 * s, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawAcidCarbonic(ctx, env, s, h, accent, level, t, seed) {
  // 圆底烧瓶 + 泡沫
  const cy = -h * 0.6;
  const rx = (12 + level) * s;
  const ry = (11 + level) * s;
  ctx.save();
  // 支架
  ctx.strokeStyle = 'rgba(60,58,50,0.95)';
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(-14 * s, -6 * s);
  ctx.lineTo(-14 * s, -h * 0.9);
  ctx.moveTo(-14 * s, -h * 0.36);
  ctx.lineTo(0, -h * 0.5);
  ctx.stroke();
  // 烧瓶
  const g = ctx.createRadialGradient(-rx * 0.3, cy - ry * 0.3, 1, 0, cy, rx * 1.4);
  g.addColorStop(0, 'rgba(220,250,244,0.4)');
  g.addColorStop(0.6, 'rgba(150,210,200,0.25)');
  g.addColorStop(1, 'rgba(90,140,132,0.25)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, cy, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(200,240,232,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 液体
  ctx.fillStyle = rgba(accent, 0.45);
  ctx.beginPath();
  ctx.ellipse(0, cy + ry * 0.35, rx * 0.86, ry * 0.6, 0, 0, Math.PI);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, cy + ry * 0.35, rx * 0.86, ry * 0.22, 0, 0, TAU);
  ctx.fillStyle = rgba(lighten(accent, 0.3), 0.5);
  ctx.fill();
  // 泡沫
  for (let i = 0; i < 9; i++) {
    const t2 = (t * 0.6 + hash01(seed, i, 2)) % 1;
    ctx.fillStyle = rgba('#f0fffa', (1 - t2) * 0.45);
    ctx.beginPath();
    ctx.arc(Math.sin(i * 2.3 + t) * rx * 0.6, cy + ry * 0.2 - t2 * ry * 0.7, (1.2 + hash01(seed, i) * 2.2) * s, 0, TAU);
    ctx.fill();
  }
  // 瓶口/塞子
  ctx.fillStyle = 'rgba(70,54,38,0.98)';
  ctx.fillRect(-4 * s, -h * 0.92, 8 * s, 7 * s);
  ctx.fillStyle = 'rgba(120,94,60,0.95)';
  ctx.fillRect(-5 * s, -h * 0.93, 10 * s, 2.4 * s);
  // 瓶口喷出的气泡
  for (let i = 0; i < 4; i++) {
    const t2 = (t * 0.9 + i * 0.25) % 1;
    ctx.fillStyle = rgba(accent, (1 - t2) * 0.5);
    ctx.beginPath();
    ctx.arc(-3 * s + t2 * 12 * s, -h * 0.98 - t2 * 12 * s, (1.4 + hash01(i, 4)) * s, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawAcidHydrochloric(ctx, env, s, h, accent, level, t, seed) {
  // 喷雾瓶 + 橡胶球
  ctx.save();
  // 瓶身
  const g = ctx.createLinearGradient(-12 * s, 0, 12 * s, 0);
  g.addColorStop(0, 'rgba(70,90,64,0.95)');
  g.addColorStop(0.4, 'rgba(112,138,100,0.98)');
  g.addColorStop(1, 'rgba(62,80,56,0.98)');
  roundRect(ctx, -13 * s, -h * 0.72, 26 * s, h * 0.62, 5 * s, g);
  ctx.strokeStyle = 'rgba(24,30,20,0.7)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 液位窗
  ctx.fillStyle = rgba(accent, 0.5);
  roundRect(ctx, -5 * s, -h * 0.56, 10 * s, h * 0.3, 2 * s, rgba(accent, 0.5));
  ctx.fillStyle = rgba(lighten(accent, 0.4), 0.35);
  roundRect(ctx, -4 * s, -h * 0.5, 8 * s, 4 * s, 2 * s, rgba(lighten(accent, 0.4), 0.35));
  // 瓶颈与喷嘴
  ctx.fillStyle = 'rgba(64,80,58,0.98)';
  roundRect(ctx, -6 * s, -h * 0.8, 12 * s, h * 0.1, 2 * s, 'rgba(64,80,58,0.98)');
  ctx.fillStyle = 'rgba(160,150,120,0.95)';
  roundRect(ctx, -3 * s, -h * 0.86, 10 * s, 4 * s, 2 * s, 'rgba(160,150,120,0.95)');
  // 橡胶球
  const squeeze = 1 + Math.sin(t * 3.4) * 0.05;
  ctx.fillStyle = 'rgba(80,50,44,0.95)';
  ctx.beginPath();
  ctx.ellipse(-16 * s, -h * 0.62, 7 * s * squeeze, 8 * s, 0.2, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,26,20,0.6)';
  ctx.stroke();
  // 皮管
  ctx.strokeStyle = 'rgba(110,84,58,0.9)';
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(-11 * s, -h * 0.68);
  ctx.quadraticCurveTo(-14 * s, -h * 0.8, -6 * s, -h * 0.82);
  ctx.stroke();
  // 雾滴
  for (let i = 0; i < 5; i++) {
    const t2 = (t * 1.2 + i * 0.2) % 1;
    ctx.fillStyle = rgba(accent, (1 - t2) * 0.35);
    ctx.beginPath();
    ctx.arc(12 * s + t2 * 20 * s, -h * 0.8 + Math.sin(i + t) * 4 * s, (1 + t2) * s, 0, TAU);
    ctx.fill();
  }
  if (level >= 3) {
    // 顶部压力灯
    ctx.fillStyle = rgba(accent, 0.7 + 0.3 * Math.sin(t * 4));
    ctx.beginPath();
    ctx.arc(0, -h * 0.92, 2.2 * s, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawAcidSulfuric(ctx, env, s, h, accent, level, t, seed) {
  // 锥形瓶 + 酒精灯 + 冷凝管
  ctx.save();
  // 灯焰
  flameShape(ctx, 0, -h * 0.14, 14 * s, (16 + level * 2) * s, t, 5, {
    hot: '#fff0c0',
    mid: '#ffb45e',
    low: '#a04a24',
  });
  // 三脚架
  ctx.strokeStyle = 'rgba(58,52,42,0.95)';
  ctx.lineWidth = 1.8 * s;
  ctx.beginPath();
  ctx.moveTo(-12 * s, -h * 0.12);
  ctx.lineTo(-6 * s, -h * 0.26);
  ctx.moveTo(12 * s, -h * 0.12);
  ctx.lineTo(6 * s, -h * 0.26);
  ctx.stroke();
  // 锥形瓶
  const flaskH = h * 0.38;
  ctx.fillStyle = 'rgba(190,220,214,0.18)';
  ctx.beginPath();
  ctx.moveTo(-4 * s, -h * 0.66);
  ctx.lineTo(-4 * s, -h * 0.38);
  ctx.lineTo(-14 * s, -h * 0.24);
  ctx.lineTo(-14 * s, -h * 0.14);
  ctx.lineTo(14 * s, -h * 0.14);
  ctx.lineTo(14 * s, -h * 0.24);
  ctx.lineTo(4 * s, -h * 0.38);
  ctx.lineTo(4 * s, -h * 0.66);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(210,240,232,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 酸液
  ctx.fillStyle = rgba(accent, 0.55);
  ctx.beginPath();
  ctx.moveTo(-12.6 * s, -h * 0.2);
  ctx.lineTo(12.6 * s, -h * 0.2);
  ctx.lineTo(14 * s, -h * 0.14);
  ctx.lineTo(-14 * s, -h * 0.14);
  ctx.closePath();
  ctx.fill();
  // 冷凝管
  ctx.strokeStyle = 'rgba(180,210,205,0.35)';
  ctx.lineWidth = 2.6 * s;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.66);
  ctx.lineTo(0, -h * 0.92);
  ctx.stroke();
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = 'rgba(190,220,214,0.3)';
    ctx.lineWidth = 1.4 * s;
    ctx.beginPath();
    ctx.ellipse(0, -h * (0.7 + i * 0.08), 5 * s, 1.8 * s, 0, 0, TAU);
    ctx.stroke();
  }
  // 蒸汽
  for (let i = 0; i < 4; i++) {
    const t2 = (t * 0.8 + i * 0.25) % 1;
    ctx.strokeStyle = rgba('#e8f0e8', (1 - t2) * 0.2);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(Math.sin(i * 2 + t) * 3 * s, -h * 0.9 - t2 * 10 * s, (1 + t2 * 2) * s, 0, TAU);
    ctx.stroke();
  }
  // 沸腾气泡
  for (let i = 0; i < 5; i++) {
    const t2 = (t * 1.4 + i * 0.2) % 1;
    ctx.fillStyle = rgba(lighten(accent, 0.25), (1 - t2) * 0.5);
    ctx.beginPath();
    ctx.arc((hash01(seed, i) - 0.5) * 20 * s, -h * 0.16 - t2 * h * 0.2, (1 + hash01(i, 3) * 1.4) * s, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawAcidHypochlorous(ctx, env, s, h, accent, level, t, seed) {
  // 加压钢罐 + 喷雾头
  ctx.save();
  // 罐体
  screenCylinder(ctx, 0, 0, 13 * s, 6 * s, h * 0.7, {
    side: 'rgba(96,120,118,0.98)',
    sideDark: 'rgba(44,60,60,0.98)',
    sideLight: 'rgba(150,180,176,0.95)',
    top: 'rgba(170,200,196,0.98)',
    rim: 'rgba(20,30,30,0.8)',
  });
  // 漂白标识
  ctx.fillStyle = 'rgba(222,212,184,0.85)';
  roundRect(ctx, -8 * s, -h * 0.5, 16 * s, 12 * s, 2 * s, 'rgba(222,212,184,0.85)');
  drawText(ctx, 'HClO', 0, -h * 0.5 + 6 * s, { size: 5.5 * s, color: 'rgba(50,44,32,0.9)', weight: 800 });
  // 喷头
  ctx.fillStyle = 'rgba(74,84,80,0.98)';
  roundRect(ctx, -3 * s, -h * 0.74, 6 * s, 8 * s, 2 * s, 'rgba(74,84,80,0.98)');
  ctx.fillStyle = 'rgba(130,150,144,0.98)';
  roundRect(ctx, -8 * s, -h * 0.86, 16 * s, 5 * s, 2 * s, 'rgba(130,150,144,0.98)');
  // 喷雾
  const puff = 0.5 + 0.5 * Math.sin(t * 4.2);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const ang = -0.6 + i * 0.2 + Math.sin(t * 2 + i) * 0.1;
    const d = (14 + i * 5) * s;
    ctx.fillStyle = rgba(accent, (0.06 + puff * 0.06) * (1 - i / 9));
    ctx.beginPath();
    ctx.arc(Math.cos(ang) * d, -h * 0.86 + Math.sin(ang) * d * 0.5, (4 + i) * s, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  // 压力表
  gauge(ctx, 10 * s, -h * 0.56, 5 * s, 0.7 + 0.1 * Math.sin(t), { face: '#d8d0b4' });
  // 泄压阀
  const psh = 0.5 + 0.5 * Math.sin(t * 3);
  ctx.strokeStyle = rgba('#e8f8f4', 0.15 + psh * 0.15);
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(13 * s, -h * 0.7 - i * 3 * s);
    ctx.lineTo(20 * s, -h * 0.74 - i * 4 * s);
    ctx.stroke();
  }
  // 罐底黄黑条
  ctx.fillStyle = 'rgba(180,158,74,0.7)';
  ctx.fillRect(-13 * s, -h * 0.16, 26 * s, 4 * s);
  ctx.fillStyle = 'rgba(24,20,14,0.65)';
  for (let i = -1; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(-13 * s + i * 5 * s, -h * 0.12);
    ctx.lineTo(-13 * s + i * 5 * s + 2.4 * s, -h * 0.12);
    ctx.lineTo(-13 * s + i * 5 * s + 4.8 * s, -h * 0.16);
    ctx.lineTo(-13 * s + i * 5 * s + 2.4 * s, -h * 0.16);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawAcidPerchloric(ctx, env, s, h, accent, level, t, seed) {
  // 高氯酸爆轰罐：重装、警示、双管
  ctx.save();
  // 重型底座
  drawGlow(ctx, '#ff8d6b', 0, -h * 0.3, 34 * s, 0.08);
  // 主体罐
  screenCylinder(ctx, 0, 0, 17 * s, 8 * s, h * 0.78, {
    side: 'rgba(104,78,64,0.99)',
    sideDark: 'rgba(52,36,28,0.99)',
    sideLight: 'rgba(150,112,92,0.98)',
    top: 'rgba(84,64,52,0.99)',
    rim: 'rgba(20,14,10,0.85)',
  });
  // 白色危险环带 + 爆轰纹
  ctx.fillStyle = 'rgba(214,202,170,0.9)';
  ctx.fillRect(-17 * s, -h * 0.56, 34 * s, 9 * s);
  ctx.fillStyle = 'rgba(40,32,24,0.9)';
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.translate(-12 * s + i * 6 * s, -h * 0.56 + 4.5 * s);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-1.6 * s, -1.6 * s, 3.2 * s, 3.2 * s);
    ctx.restore();
  }
  // 观察窗（内部熔岩般的反应）
  ctx.fillStyle = 'rgba(20,16,12,0.9)';
  ctx.beginPath();
  ctx.arc(0, -h * 0.36, 6.4 * s, 0, TAU);
  ctx.fill();
  const flame = 0.5 + 0.5 * Math.sin(t * 3.7);
  ctx.fillStyle = rgba(lighten(accent, 0.2), 0.4 + flame * 0.3);
  ctx.beginPath();
  ctx.arc(0, -h * 0.36, 4.8 * s, 0, TAU);
  ctx.fill();
  // 双排气管
  for (let i = 0; i < 2; i++) {
    ctx.fillStyle = 'rgba(52,40,32,0.98)';
    roundRect(ctx, (-10 + i * 12) * s, -h * 0.9, 6 * s, h * 0.2, 2 * s, 'rgba(52,40,32,0.98)');
    ctx.fillStyle = rgba(accent, 0.5);
    ctx.beginPath();
    ctx.ellipse((-7 + i * 12) * s, -h * 0.9, 3 * s, 1.6 * s, 0, 0, TAU);
    ctx.fill();
  }
  // 点火火焰
  flameShape(ctx, 0, -h * 0.92, 12 * s, (10 + level * 3) * s, t * 1.3, 9, {
    hot: '#fff2cf',
    mid: '#ff8d6b',
    low: '#a8321c',
  });
  // 警告灯
  ctx.fillStyle = rgba('#ff6b57', 0.7 + 0.3 * Math.sin(t * 6));
  ctx.beginPath();
  ctx.arc(13 * s, -h * 0.66, 2.6 * s, 0, TAU);
  ctx.fill();
  drawGlow(ctx, '#ff6b57', 13 * s, -h * 0.66, 8 * s, 0.3);
  // 加固箍
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = 'rgba(160,136,88,0.8)';
    ctx.lineWidth = 1.8 * s;
    ctx.beginPath();
    ctx.ellipse(0, -h * (0.2 + i * 0.18), 17.4 * s, 8.2 * s, 0, 0, TAU);
    ctx.stroke();
  }
  // 底座沙袋/挡板
  ctx.fillStyle = 'rgba(84,66,44,0.95)';
  ctx.beginPath();
  ctx.moveTo(-22 * s, 0);
  ctx.lineTo(22 * s, 0);
  ctx.lineTo(17 * s, -6 * s);
  ctx.lineTo(-17 * s, -6 * s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------------- 氯酸钾炮台 ----------------

function drawChlorate(ctx, env, b, p, s, seed, aim, opts) {
  const level = clamp(b.level || 1, 1, 10);
  const t = env.now;
  const accent = '#ffe27a';
  const size = 1 + (level - 1) * 0.045;
  const barrels = level >= 8 ? 3 : level >= 4 ? 2 : 1;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(size, size);
  const h = (30 + level * 1.2) * s;
  // 三脚架
  ctx.strokeStyle = 'rgba(52,48,38,0.98)';
  ctx.lineWidth = 2.4 * s;
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i - 1) * 0.8;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 16 * s, -h * 0.18 + Math.sin(a) * 7 * s);
    ctx.lineTo(Math.cos(a) * 4 * s, -h * 0.16);
    ctx.stroke();
  }
  // 氧气罐
  screenCylinder(ctx, -11 * s, -h * 0.18, 6 * s, 3.2 * s, h * 0.46, {
    side: 'rgba(96,112,70,0.98)',
    sideDark: 'rgba(46,56,34,0.98)',
    sideLight: 'rgba(140,158,104,0.98)',
    top: 'rgba(160,178,120,0.98)',
    rim: 'rgba(26,30,18,0.8)',
  });
  ctx.fillStyle = 'rgba(44,52,32,0.9)';
  ctx.fillRect(-17 * s, -h * 0.42, 12 * s, 3 * s);
  drawText(ctx, 'O₂', -11 * s, -h * 0.36, { size: 4.5 * s, color: 'rgba(220,232,180,0.9)', weight: 700 });
  // 燃烧室
  const chamberY = -h * 0.55;
  const chamberR = (11 + level * 0.35) * s;
  const glow = 0.5 + 0.5 * Math.sin(t * 5 + 1);
  screenCylinder(ctx, 1 * s, -h * 0.3, chamberR, 5.2 * s, h * 0.26, {
    side: 'rgba(92,88,64,0.98)',
    sideDark: 'rgba(46,44,30,0.98)',
    sideLight: 'rgba(140,132,94,0.98)',
    top: 'rgba(70,66,46,0.99)',
    rim: 'rgba(24,22,14,0.85)',
  });
  // 观察窗/爆燃核心
  ctx.fillStyle = 'rgba(26,22,14,0.92)';
  ctx.beginPath();
  ctx.arc(1 * s, chamberY, 7 * s, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgba(accent, 0.5 + glow * 0.3);
  ctx.beginPath();
  ctx.arc(1 * s, chamberY, 5 * s, 0, TAU);
  ctx.fill();
  drawGlow(ctx, accent, 1 * s, chamberY, (14 + level) * s, 0.16 + glow * 0.06);
  // 散热鳍片
  const fins = Math.min(6, 2 + Math.floor(level / 2));
  for (let i = 0; i < fins; i++) {
    ctx.fillStyle = 'rgba(64,60,42,0.98)';
    ctx.fillRect(-14 * s, -h * (0.2 + i * 0.055), 20 * s, 1.8 * s);
    ctx.fillStyle = 'rgba(150,140,96,0.25)';
    ctx.fillRect(-14 * s, -h * (0.2 + i * 0.055), 20 * s, 0.6 * s);
  }
  // 压力表
  gauge(ctx, 10 * s, -h * 0.62, 3.8 * s, 0.5 + glow * 0.3, { face: '#d8d0a8', needleColor: '#a0602c' });
  // 高等级：警示条纹 + 蒸汽
  if (level >= 6) {
    ctx.fillStyle = 'rgba(176,154,74,0.75)';
    ctx.fillRect(-18 * s, -h * 0.1, 36 * s, 3.2 * s);
    ctx.fillStyle = 'rgba(24,20,12,0.7)';
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.moveTo(-18 * s + i * 5.4 * s, -h * 0.1);
      ctx.lineTo(-18 * s + i * 5.4 * s + 2.4 * s, -h * 0.1);
      ctx.lineTo(-18 * s + i * 5.4 * s + 4.6 * s, -h * 0.068);
      ctx.lineTo(-18 * s + i * 5.4 * s + 2.2 * s, -h * 0.068);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (level >= 9) {
    for (let i = 0; i < 3; i++) {
      const t2 = (t * 0.7 + i * 0.33) % 1;
      ctx.strokeStyle = rgba('#e8e0c0', (1 - t2) * 0.16);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, -h * (0.9 + t2 * 0.3), (2 + t2 * 5) * s, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.restore();

  // 炮管数随等级增加（绝对坐标）
  for (let i = 0; i < barrels; i++) {
    drawChlorateBarrel(ctx, aim, s, accent, i, barrels, t);
  }
}

function drawChlorateBarrel(ctx, aim, s, accent, index, total, t) {
  const pivot = aim.pivot;
  const offset = (index - (total - 1) / 2) * 0.14;
  ctx.save();
  ctx.translate(pivot.x, pivot.y + 6 * s);
  ctx.rotate(aim.angle + offset);
  const len = aim.scale * (22 + index * 3);
  const g = ctx.createLinearGradient(0, -3.4 * s, 0, 3.4 * s);
  g.addColorStop(0, 'rgba(118,110,82,0.98)');
  g.addColorStop(0.5, 'rgba(74,70,52,0.98)');
  g.addColorStop(1, 'rgba(44,42,30,0.98)');
  ctx.fillStyle = g;
  roundRect(ctx, 0, -3.4 * s, len, 6.8 * s, 2.6 * s, g);
  ctx.strokeStyle = 'rgba(22,20,12,0.8)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // 炮口火光
  ctx.fillStyle = rgba(accent, 0.75 + 0.25 * Math.sin(t * 6 + index));
  ctx.beginPath();
  ctx.ellipse(len, 0, 2 * s, 3 * s, 0, 0, TAU);
  ctx.fill();
  drawGlow(ctx, accent, len, 0, 9 * s, 0.4);
  ctx.restore();
}

// ---------------- 苯炮台 ----------------

function drawBenzene(ctx, env, b, p, s, seed, aim, opts) {
  const level = clamp(b.level || 1, 1, 10);
  const t = env.now;
  const accent = '#ff9ab5';
  const scaleSize = 1 + (level - 1) * 0.05;
  ctx.save();
  ctx.translate(p.x, p.y);
  // 底座支架构件
  ctx.fillStyle = 'rgba(64,54,44,0.98)';
  ctx.beginPath();
  ctx.moveTo(-20 * s, 0);
  ctx.lineTo(20 * s, 0);
  ctx.lineTo(12 * s, -7 * s);
  ctx.lineTo(-12 * s, -7 * s);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,16,12,0.7)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 音叉式支架
  ctx.strokeStyle = 'rgba(120,100,80,0.95)';
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(-10 * s, -6 * s);
  ctx.lineTo(-6 * s, -34 * s);
  ctx.moveTo(10 * s, -6 * s);
  ctx.lineTo(6 * s, -34 * s);
  ctx.stroke();
  // 六元环：透视压扁的六边形 + 旋转
  const ringY = -46 * s;
  const rotation = t * 0.5;
  const rx = (18 + level * 0.9) * s;
  const ry = rx * 0.38;
  ctx.save();
  ctx.translate(0, ringY);
  ctx.rotate(Math.sin(t * 0.4) * 0.08);
  // 共振光晕
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, rx * 1.8);
  halo.addColorStop(0, 'rgba(255,154,181,0.16)');
  halo.addColorStop(1, 'rgba(255,154,181,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 1.8, ry * 2.8, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  // 环
  const ringPts = [];
  for (let i = 0; i < 6; i++) {
    const a = rotation + (i / 6) * TAU;
    ringPts.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry, a });
  }
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    if (i === 0) ctx.moveTo(ringPts[i].x, ringPts[i].y);
    else ctx.lineTo(ringPts[i].x, ringPts[i].y);
  }
  ctx.closePath();
  ctx.strokeStyle = 'rgba(40,28,38,0.95)';
  ctx.lineWidth = 4.6 * s;
  ctx.stroke();
  ctx.strokeStyle = rgba('#ffc2d2', 0.7);
  ctx.lineWidth = 1.4 * s;
  ctx.stroke();
  // 内圈（高等级）
  if (level >= 5) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = -rotation * 0.7 + (i / 6) * TAU;
      const x = Math.cos(a) * rx * 0.62;
      const y = Math.sin(a) * ry * 0.62;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = rgba(accent, 0.5);
    ctx.lineWidth = 1.8 * s;
    ctx.stroke();
  }
  // 环上节点与眼睛般的辉光
  for (let i = 0; i < ringPts.length; i++) {
    const q = ringPts[i];
    const glowA = 0.4 + 0.3 * Math.sin(t * 2.4 + i * 1.2);
    drawGlow(ctx, accent, q.x, q.y, 8 * s, glowA * 0.5);
    ctx.fillStyle = rgba('#fff0f4', 0.75);
    ctx.beginPath();
    ctx.arc(q.x, q.y, 2 * s, 0, TAU);
    ctx.fill();
  }
  // 中心芳香环符号
  ctx.strokeStyle = rgba(accent, 0.4 + 0.1 * Math.sin(t * 3));
  ctx.lineWidth = 1.2 * s;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 0.34, ry * 0.9, 0, 0, TAU);
  ctx.stroke();
  // 环绕的电子/光点
  const electrons = Math.min(4, 1 + Math.floor(level / 3));
  for (let i = 0; i < electrons; i++) {
    const a = rotation * 2 + (i / electrons) * TAU;
    const ex = Math.cos(a) * rx * 1.22;
    const ey = Math.sin(a) * ry * 1.5 - 2 * s;
    ctx.fillStyle = rgba('#ffd6e2', 0.85);
    ctx.beginPath();
    ctx.arc(ex, ey, 1.8 * s, 0, TAU);
    ctx.fill();
    drawGlow(ctx, accent, ex, ey, 6 * s, 0.35);
  }
  // 共振闪电（高等级）
  if (level >= 6) {
    ctx.strokeStyle = rgba(accent, 0.4 + 0.2 * Math.sin(t * 5));
    ctx.lineWidth = 0.9 * s;
    ctx.beginPath();
    const seedBolt = Math.floor(t * 8);
    boltPath(ctx, -rx, 0, ringPts[2].x, ringPts[2].y, seedBolt, 5, 6 * s);
    ctx.stroke();
  }
  ctx.restore();
  // 底座上的共振刻度
  for (let i = 0; i < Math.min(10, level); i++) {
    ctx.fillStyle = rgba(accent, 0.25 + 0.05 * i);
    ctx.fillRect(-16 * s + i * 3.4 * s, -2 * s, 1.8 * s, 2 * s);
  }
  // 地面脉冲环
  const pulseR = (t * 0.5) % 1;
  ctx.strokeStyle = rgba(accent, (1 - pulseR) * 0.18);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(0, 2 * s, pulseR * 40 * s, pulseR * 18 * s, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

// ---------------- 七种设备 ----------------

function deviceFrame(ctx, p, s, h, accent, seed) {
  // 设备共用的钢筋底座 + 铭牌
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.strokeStyle = 'rgba(58,54,46,0.98)';
  ctx.lineWidth = 2.2 * s;
  ctx.beginPath();
  ctx.moveTo(-14 * s, 0);
  ctx.lineTo(-10 * s, -h);
  ctx.moveTo(14 * s, 0);
  ctx.lineTo(10 * s, -h);
  ctx.stroke();
  ctx.restore();
}

function drawAnalyzer(ctx, env, b, p, s, seed, opts) {
  const level = clamp(b.level || 1, 1, 3);
  const t = env.now;
  const accent = '#63e0c2';
  const h = (38 + level * 6) * s;
  ctx.save();
  ctx.translate(p.x, p.y);
  deviceFrame(ctx, { x: 0, y: 0 }, s, h * 0.7, accent, seed);
  // 层析柱：玻璃管 + 分层色带
  const tubeW = 9 * s;
  const g = ctx.createLinearGradient(-tubeW, 0, tubeW, 0);
  g.addColorStop(0, 'rgba(170,220,214,0.3)');
  g.addColorStop(0.35, 'rgba(236,255,250,0.42)');
  g.addColorStop(1, 'rgba(120,180,174,0.28)');
  ctx.fillStyle = g;
  roundRect(ctx, -tubeW / 2, -h, tubeW, h - 6 * s, 4 * s, g);
  ctx.strokeStyle = 'rgba(210,245,238,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 色带：随等级增加
  const bands = 4 + level * 2;
  for (let i = 0; i < bands; i++) {
    const y = -h + 7 * s + (i / bands) * (h - 16 * s);
    const hue = ['#63e0c2', '#8fd8ff', '#ffe27a', '#ff9ab5', '#b8e37a'][i % 5];
    ctx.fillStyle = rgba(hue, 0.35 + 0.1 * Math.sin(t * 1.3 + i));
    ctx.fillRect(-tubeW / 2 + 1.4 * s, y, tubeW - 2.8 * s, Math.max(1.6, (h - 16 * s) / bands - 0.8) * 1);
  }
  // 滴液
  const drop = (t * 0.55) % 1;
  ctx.fillStyle = rgba(accent, (1 - drop) * 0.8);
  ctx.beginPath();
  ctx.arc(0, -6 * s + drop * 4 * s, 1.6 * s, 0, TAU);
  ctx.fill();
  // 接液瓶
  screenCylinder(ctx, 0, 0, 6.5 * s, 3.2 * s, 6 * s, {
    side: 'rgba(130,180,172,0.3)',
    top: 'rgba(180,220,212,0.4)',
    rim: 'rgba(120,170,160,0.5)',
  });
  ctx.fillStyle = rgba(accent, 0.35);
  ctx.beginPath();
  ctx.ellipse(0, -1.6 * s, 5 * s, 2.4 * s, 0, 0, TAU);
  ctx.fill();
  // 上部旋钮/冷凝头
  ctx.fillStyle = 'rgba(84,90,84,0.98)';
  roundRect(ctx, -6 * s, -h - 6 * s, 12 * s, 7 * s, 2 * s, 'rgba(84,90,84,0.98)');
  ctx.fillStyle = rgba(accent, 0.7);
  ctx.beginPath();
  ctx.arc(0, -h - 2.5 * s, 1.8 * s, 0, TAU);
  ctx.fill();
  // 刻度
  for (let i = 0; i < 6; i++) {
    ctx.strokeStyle = 'rgba(220,245,236,0.25)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(tubeW / 2 - 1 * s, -h + 10 * s + i * (h / 8));
    ctx.lineTo(tubeW / 2 + 1.4 * s, -h + 10 * s + i * (h / 8));
    ctx.stroke();
  }
  drawGlow(ctx, accent, 0, -h * 0.55, 18 * s, 0.08);
  ctx.restore();
}

function drawCondenser(ctx, env, b, p, s, seed, opts) {
  const level = clamp(b.level || 1, 1, 3);
  const t = env.now;
  const accent = '#8fd8ff';
  const h = (28 + level * 5) * s;
  ctx.save();
  ctx.translate(p.x, p.y);
  deviceFrame(ctx, { x: 0, y: 0 }, s, h * 0.7, accent, seed);
  // 机身
  const bodyW = (15 + level * 2) * s;
  const bodyH = (14 + level * 2) * s;
  const g = ctx.createLinearGradient(-bodyW, 0, bodyW, 0);
  g.addColorStop(0, 'rgba(66,84,96,0.98)');
  g.addColorStop(0.45, 'rgba(104,130,146,0.98)');
  g.addColorStop(1, 'rgba(54,70,82,0.98)');
  roundRect(ctx, -bodyW, -bodyH, bodyW * 2, bodyH, 3 * s, g);
  ctx.strokeStyle = 'rgba(22,32,40,0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 冷凝盘管
  const coilCount = 2 + level;
  for (let i = 0; i < coilCount; i++) {
    const cy = -bodyH * 0.2 - i * (bodyH * 0.7 / coilCount);
    ctx.strokeStyle = 'rgba(168,208,224,0.6)';
    ctx.lineWidth = 1.6 * s;
    ctx.beginPath();
    ctx.ellipse(0, cy, bodyW * 0.7, 2.6 * s, 0, 0, Math.PI);
    ctx.stroke();
  }
  // 风扇
  const fanR = (bodyH * 0.45) * 1;
  const rot = t * 4;
  ctx.save();
  ctx.translate(bodyW * 0.1, -bodyH - 2 * s);
  ctx.strokeStyle = 'rgba(120,150,166,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, fanR, 0, TAU);
  ctx.stroke();
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate(rot + (i / 3) * TAU);
    ctx.fillStyle = 'rgba(190,220,234,0.32)';
    ctx.beginPath();
    ctx.ellipse(fanR * 0.45, 0, fanR * 0.45, fanR * 0.16, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  // 霜/冰棱
  for (let i = 0; i < 4 + level * 2; i++) {
    const x = -bodyW * 0.85 + (i / (4 + level * 2)) * bodyW * 1.7;
    const len = (3 + hash01(seed, i) * 7) * s;
    ctx.fillStyle = 'rgba(210,240,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(x - 1.2 * s, 0);
    ctx.lineTo(x + 1.2 * s, 0);
    ctx.lineTo(x, len * 0.9);
    ctx.closePath();
    ctx.fill();
  }
  // 冷雾
  for (let i = 0; i < 4; i++) {
    const t2 = (t * 0.3 + i * 0.25) % 1;
    ctx.strokeStyle = rgba(accent, (1 - t2) * 0.18);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(Math.sin(i * 2 + t) * 12 * s, -bodyH - t2 * 14 * s, (3 + t2 * 8) * s, 0, TAU);
    ctx.stroke();
  }
  drawGlow(ctx, accent, 0, -bodyH * 0.5, 20 * s, 0.1);
  // 铭牌
  ctx.fillStyle = 'rgba(226,212,180,0.85)';
  ctx.fillRect(-7 * s, -3.5 * s, 14 * s, 3 * s);
  ctx.restore();
}

function drawVent(ctx, env, b, p, s, seed, opts) {
  const level = clamp(b.level || 1, 1, 3);
  const t = env.now;
  const accent = '#9ee7d8';
  const h = (44 + level * 6) * s;
  ctx.save();
  ctx.translate(p.x, p.y);
  // 柜体
  const bw = (16 + level * 2) * s;
  const bh = h * 0.62;
  const g = ctx.createLinearGradient(-bw, 0, bw, 0);
  g.addColorStop(0, 'rgba(62,72,64,0.99)');
  g.addColorStop(0.5, 'rgba(94,110,98,0.99)');
  g.addColorStop(1, 'rgba(50,60,54,0.99)');
  roundRect(ctx, -bw, -bh, bw * 2, bh, 2 * s, g);
  ctx.strokeStyle = 'rgba(20,26,20,0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 拉门玻璃窗
  ctx.fillStyle = 'rgba(40,52,48,0.9)';
  roundRect(ctx, -bw * 0.82, -bh * 0.9, bw * 1.64, bh * 0.6, 2 * s, 'rgba(40,52,48,0.9)');
  ctx.fillStyle = 'rgba(150,200,186,0.16)';
  roundRect(ctx, -bw * 0.78, -bh * 0.86, bw * 1.56, bh * 0.52, 1.5 * s, 'rgba(150,200,186,0.16)');
  // 拉门把手
  ctx.fillStyle = 'rgba(170,190,178,0.8)';
  ctx.fillRect(-bw * 0.2, -bh * 0.36, bw * 0.4, 1.4 * s);
  // 柜内风道
  ctx.strokeStyle = rgba(accent, 0.25);
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(-bw * 0.5 + i * bw * 0.33, -bh * 0.7);
    ctx.bezierCurveTo(-bw * 0.3 + i * bw * 0.2, -bh * 0.4, bw * 0.2, -bh * 0.3, bw * 0.4, -bh * 0.1);
    ctx.stroke();
  }
  // 上方排风管
  const ductH = h * 0.36;
  ctx.fillStyle = 'rgba(64,76,70,0.99)';
  ctx.fillRect(-bw * 0.35, -bh - ductH, bw * 0.7, ductH);
  ctx.strokeStyle = 'rgba(20,26,22,0.8)';
  ctx.strokeRect(-bw * 0.35, -bh - ductH, bw * 0.7, ductH);
  for (let i = 1; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(-bw * 0.35, -bh - ductH + (ductH / 3) * i);
    ctx.lineTo(bw * 0.35, -bh - ductH + (ductH / 3) * i);
    ctx.strokeStyle = 'rgba(20,26,22,0.6)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  // 排风气流
  for (let i = 0; i < 3; i++) {
    const t2 = (t * 0.5 + i * 0.33) % 1;
    ctx.strokeStyle = rgba(accent, (1 - t2) * 0.3);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-bw * 0.2 + i * bw * 0.2, -bh - ductH - 2 * s);
    ctx.lineTo(-bw * 0.2 + i * bw * 0.2 + 4 * s, -bh - ductH - (6 + t2 * 12) * s);
    ctx.stroke();
  }
  drawGlow(ctx, accent, 0, -bh * 0.5, 22 * s, 0.08);
  ctx.restore();
}

function drawCatalyst(ctx, env, b, p, s, seed, opts) {
  const level = clamp(b.level || 1, 1, 3);
  const t = env.now;
  const accent = '#ffb45e';
  const layout = env.layout;
  const tx = b.tile.x;
  const ty = b.tile.y;
  const P = (x, y, z = 0) => projectElevated(layout, tx + x, ty + y, z);
  ctx.save();

  // 铁腿
  for (const [lx, ly] of [[0.16, 0.8], [0.82, 0.8], [0.82, 0.2]]) {
    const a = P(lx, ly, 0);
    const bb = P(lx, ly, 13);
    ctx.strokeStyle = 'rgba(56,52,42,0.98)';
    ctx.lineWidth = 2.2 * s;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(bb.x, bb.y);
    ctx.stroke();
  }
  // 工作台
  isoBox(ctx, layout, tx + 0.1, ty + 0.12, tx + 0.9, ty + 0.88, 16, {
    topFill: 'rgba(128,96,60,1)',
    southFill: 'rgba(78,56,34,1)',
    eastFill: 'rgba(60,42,26,1)',
    line: 'rgba(20,14,9,0.7)',
  });
  const top = P(0.5, 0.5, 16);
  // 台面蚀刻网格
  ctx.strokeStyle = 'rgba(255,214,150,0.16)';
  ctx.lineWidth = 0.7;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(top.x - 22 * s, top.y + i * 4.2 * s);
    ctx.lineTo(top.x + 22 * s, top.y + i * 4.2 * s + i * 1.6 * s);
    ctx.stroke();
  }
  // 催化网架：两根立柱 + 发光横向栅格
  const postL = P(0.26, 0.62, 16);
  const postR = P(0.74, 0.62, 16);
  ctx.strokeStyle = 'rgba(96,86,64,0.98)';
  ctx.lineWidth = 1.8 * s;
  ctx.beginPath();
  ctx.moveTo(postL.x, postL.y);
  ctx.lineTo(postL.x, postL.y - (16 + level * 3) * s);
  ctx.moveTo(postR.x, postR.y);
  ctx.lineTo(postR.x, postR.y - (16 + level * 3) * s);
  ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const yy = postL.y - (7 + i * (7 + level)) * s;
    ctx.strokeStyle = rgba(accent, 0.35 + 0.15 * Math.sin(t * 3 + i));
    ctx.lineWidth = 1.1 * s;
    ctx.beginPath();
    ctx.moveTo(postL.x, yy);
    ctx.lineTo(postR.x, yy - 2 * s);
    ctx.stroke();
    ctx.strokeStyle = rgba('#fff0c8', 0.3);
    ctx.lineWidth = 0.4 * s;
    ctx.stroke();
  }
  // 坩埚
  const cr = P(0.5, 0.48, 16);
  screenCylinder(ctx, cr.x, cr.y, 6.5 * s, 3.2 * s, 7.5 * s, {
    side: 'rgba(78,66,50,0.98)',
    sideDark: 'rgba(40,32,22,0.98)',
    sideLight: 'rgba(124,106,78,0.98)',
    top: rgba(accent, 0.5),
    rim: 'rgba(24,18,12,0.85)',
  });
  flameShape(ctx, cr.x, cr.y - 2 * s, 8 * s, (9 + level * 2.4) * s, t * 1.2, 3, {
    hot: '#fff2cc',
    mid: '#ffb45e',
    low: '#a05a24',
  });
  // 反应火星
  for (let i = 0; i < 6; i++) {
    const t2 = (t * 0.8 + i * 0.17) % 1;
    ctx.fillStyle = rgba('#ffd9a0', (1 - t2) * 0.6);
    ctx.beginPath();
    ctx.arc(cr.x + Math.sin(i * 2.1 + t) * 11 * s, cr.y - 8 * s - t2 * 18 * s, 1.2 * s, 0, TAU);
    ctx.fill();
  }
  // 试管架
  for (let i = 0; i < level; i++) {
    const tube = P(0.32 + i * 0.16, 0.82, 16);
    ctx.fillStyle = 'rgba(180,220,210,0.35)';
    roundRect(ctx, tube.x - 2 * s, tube.y - 13 * s, 4 * s, 12 * s, 1.6 * s, 'rgba(180,220,210,0.35)');
    const liquid = ['#ffb45e', '#63e0c2', '#ff9ab5'][i % 3];
    ctx.fillStyle = rgba(liquid, 0.6);
    roundRect(ctx, tube.x - 1.4 * s, tube.y - 8 * s, 2.8 * s, 5.4 * s, 1.1 * s, rgba(liquid, 0.6));
    ctx.strokeStyle = 'rgba(220,245,236,0.3)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  drawGlow(ctx, accent, cr.x, cr.y - 8 * s, 24 * s, 0.12 + 0.04 * Math.sin(t * 3));
  // 铭牌
  const plate = P(0.5, 0.9, 12);
  ctx.fillStyle = 'rgba(226,212,180,0.9)';
  ctx.fillRect(plate.x - 8 * s, plate.y - 1.5 * s, 16 * s, 3 * s);
  drawText(ctx, '催化', plate.x, plate.y, { size: 3.2 * s, color: 'rgba(60,44,26,0.9)', weight: 800 });
  ctx.restore();
}

function drawNeutralizer(ctx, env, b, p, s, seed, opts) {
  const level = clamp(b.level || 1, 1, 3);
  const t = env.now;
  const accent = '#c7e8a8';
  ctx.save();
  ctx.translate(p.x, p.y);
  // 浅池
  const rx = (26 + level * 3) * s;
  const ry = rx * 0.46;
  ctx.fillStyle = 'rgba(54,58,50,0.99)';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(22,26,20,0.85)';
  ctx.lineWidth = 2 * s;
  ctx.stroke();
  // 池内液体
  const lg = ctx.createRadialGradient(0, -2 * s, 2, 0, 0, rx * 0.9);
  lg.addColorStop(0, rgba(lighten(accent, 0.15), 0.5));
  lg.addColorStop(1, rgba(accent, 0.3));
  ctx.fillStyle = lg;
  ctx.beginPath();
  ctx.ellipse(0, -1.5 * s, rx * 0.86, ry * 0.8, 0, 0, TAU);
  ctx.fill();
  // 液面涟漪
  for (let i = 0; i < 3; i++) {
    const t2 = (t * 0.4 + i * 0.33) % 1;
    ctx.strokeStyle = rgba('#e8ffe0', (1 - t2) * 0.18);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, -1.5 * s, rx * 0.2 + t2 * rx * 0.6, ry * 0.2 + t2 * ry * 0.6, 0, 0, TAU);
    ctx.stroke();
  }
  // 气泡
  for (let i = 0; i < 6 + level * 2; i++) {
    const t2 = (t * 0.7 + hash01(seed, i) * 0.3) % 1;
    ctx.fillStyle = rgba('#e8ffdc', (1 - t2) * 0.5);
    ctx.beginPath();
    ctx.arc((hash01(seed, i, 2) - 0.5) * rx * 1.4, -2 * s - t2 * 12 * s, (1 + hash01(i, 3)) * s, 0, TAU);
    ctx.fill();
  }
  // 泵与管道
  ctx.fillStyle = 'rgba(70,80,68,0.98)';
  roundRect(ctx, rx * 0.5, -14 * s, 12 * s, 12 * s, 2 * s, 'rgba(70,80,68,0.98)');
  ctx.strokeStyle = 'rgba(30,36,28,0.8)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(110,130,110,0.8)';
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(rx * 0.5, -8 * s);
  ctx.quadraticCurveTo(-rx * 0.2, -18 * s, -rx * 0.5, -6 * s);
  ctx.stroke();
  // 指示灯
  ctx.fillStyle = rgba('#c7e8a8', 0.6 + 0.4 * Math.sin(t * 2.4));
  ctx.beginPath();
  ctx.arc(rx * 0.5 + 6 * s, -14 * s, 1.8 * s, 0, TAU);
  ctx.fill();
  drawGlow(ctx, accent, 0, -2 * s, rx * 0.8, 0.08);
  ctx.restore();
}

function drawAccelerator(ctx, env, b, p, s, seed, opts) {
  const level = clamp(b.level || 1, 1, 3);
  const t = env.now;
  const accent = '#ffe27a';
  const h = (26 + level * 4) * s;
  ctx.save();
  ctx.translate(p.x, p.y);
  // 电容组
  for (let i = 0; i < 2; i++) {
    screenCylinder(ctx, (-12 + i * 24) * s, 0, 5.5 * s, 3 * s, h * 0.7, {
      side: 'rgba(82,80,62,0.99)',
      sideDark: 'rgba(40,40,30,0.99)',
      sideLight: 'rgba(130,126,94,0.99)',
      top: 'rgba(160,154,110,0.99)',
      rim: 'rgba(24,22,14,0.85)',
    });
    ctx.fillStyle = rgba(accent, 0.15);
    ctx.fillRect((-12 + i * 24 - 5.5) * s, -h * 0.5, 11 * s, 3 * s);
  }
  // 中央加速腔
  const bodyTop = -h;
  ctx.strokeStyle = 'rgba(90,86,66,0.98)';
  ctx.lineWidth = 2.4 * s;
  ctx.beginPath();
  ctx.moveTo(-8 * s, 0);
  ctx.lineTo(-4 * s, bodyTop);
  ctx.moveTo(8 * s, 0);
  ctx.lineTo(4 * s, bodyTop);
  ctx.stroke();
  // 轨道环
  for (let i = 0; i < level + 2; i++) {
    const ry2 = h * (0.2 + i * 0.16);
    ctx.strokeStyle = rgba(accent, 0.3 + 0.1 * Math.sin(t * 4 + i));
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.ellipse(0, -ry2, (14 - i) * s, 4.6 * s, 0, 0, TAU);
    ctx.stroke();
  }
  // 电弧
  const arcSeed = Math.floor(t * 12);
  for (let i = 0; i < 2; i++) {
    ctx.strokeStyle = rgba('#fff6c8', 0.25 + 0.25 * Math.sin(t * 9 + i));
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    boltPath(ctx, -18 * s, -h * 0.45, 18 * s, -h * 0.55, arcSeed + i, 7, 10 * s);
    ctx.stroke();
  }
  drawGlow(ctx, accent, 0, -h * 0.6, 26 * s, 0.13);
  // 中央球
  const orbR = 6 * s;
  const og = ctx.createRadialGradient(-2 * s, -h * 0.62 - 2 * s, 0.5, 0, -h * 0.62, orbR);
  og.addColorStop(0, 'rgba(255,252,222,0.95)');
  og.addColorStop(0.5, rgba(accent, 0.7));
  og.addColorStop(1, rgba(accent, 0.15));
  ctx.fillStyle = og;
  ctx.beginPath();
  ctx.arc(0, -h * 0.62, orbR, 0, TAU);
  ctx.fill();
  // 地面电磁纹
  ctx.strokeStyle = rgba(accent, 0.2);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, 2 * s, (24 + Math.sin(t * 3) * 3) * s, 9 * s, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawAtm(ctx, env, b, p, s, seed, opts) {
  const level = clamp(b.level || 1, 1, 3);
  const t = env.now;
  const accent = '#c7a8ff';
  const h = (34 + level * 4) * s;
  ctx.save();
  ctx.translate(p.x, p.y);
  // 机身
  const bw = 17 * s;
  const bh = h * 0.86;
  const g = ctx.createLinearGradient(-bw, 0, bw, 0);
  g.addColorStop(0, 'rgba(58,48,68,0.99)');
  g.addColorStop(0.45, 'rgba(86,72,100,0.99)');
  g.addColorStop(1, 'rgba(46,38,56,0.99)');
  roundRect(ctx, -bw, -bh, bw * 2, bh, 2.5 * s, g);
  ctx.strokeStyle = 'rgba(18,14,24,0.85)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 屏幕
  ctx.fillStyle = 'rgba(22,26,30,0.95)';
  roundRect(ctx, -bw * 0.72, -bh * 0.9, bw * 1.44, bh * 0.34, 1.5 * s, 'rgba(22,26,30,0.95)');
  // 屏幕内容：梦能数字/波形
  ctx.fillStyle = rgba('#63e0c2', 0.55 + 0.1 * Math.sin(t * 2.2));
  ctx.fillRect(-bw * 0.6, -bh * 0.74, bw * 0.9, 1.4 * s);
  ctx.fillRect(-bw * 0.6, -bh * 0.68, bw * 0.55, 1.2 * s);
  ctx.strokeStyle = rgba('#63e0c2', 0.35);
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const x = -bw * 0.55 + i * bw * 0.12;
    const y = -bh * 0.94 + Math.sin(t * 2 + i) * 2 * s;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // 出钞口（梦能票据）
  ctx.fillStyle = 'rgba(24,20,28,0.95)';
  ctx.fillRect(-bw * 0.55, -bh * 0.4, bw * 1.1, 3.2 * s);
  // 键盘
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      ctx.fillStyle = 'rgba(160,148,168,0.35)';
      ctx.fillRect(-bw * 0.45 + c * 5.4 * s, -bh * 0.28 + r * 4 * s, 3.4 * s, 2.6 * s);
    }
  }
  // 取款口的光标与吐出的梦能票据
  const t2 = (t * 0.35) % 1;
  ctx.fillStyle = rgba(accent, 0.3 + 0.2 * Math.sin(t * 3));
  ctx.fillRect(-bw * 0.3, -bh * 0.38, bw * 0.6, 1.2 * s);
  if (t2 < 0.4) {
    ctx.fillStyle = 'rgba(232,240,236,0.8)';
    ctx.fillRect(-bw * 0.22, -bh * 0.4 - 1 * s, bw * 0.44, 6 * s * (t2 / 0.4));
  }
  // 顶部招牌
  ctx.fillStyle = 'rgba(226,214,190,0.9)';
  roundRect(ctx, -bw * 0.7, -bh - 8 * s, bw * 1.4, 6 * s, 1.5 * s, 'rgba(226,214,190,0.9)');
  drawText(ctx, '梦能', 0, -bh - 5 * s, { size: 4.2 * s, color: 'rgba(60,48,72,0.95)', weight: 800 });
  // 梦能硬币粒子
  for (let i = 0; i < 4; i++) {
    const t3 = (t * 0.5 + i * 0.25) % 1;
    ctx.fillStyle = rgba('#c7a8ff', (1 - t3) * 0.7);
    ctx.beginPath();
    ctx.arc(Math.sin(i * 2 + t) * 10 * s, -bh * 0.9 - t3 * 18 * s, 1.5 * s, 0, TAU);
    ctx.fill();
    drawGlow(ctx, accent, Math.sin(i * 2 + t) * 10 * s, -bh * 0.9 - t3 * 18 * s, 5 * s, 0.15);
  }
  drawGlow(ctx, accent, 0, -bh * 0.7, 22 * s, 0.06);
  ctx.restore();
}

function drawGeneric(ctx, p, s, seed) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(80,76,64,0.95)';
  ctx.fillRect(-10 * s, -24 * s, 20 * s, 24 * s);
  ctx.restore();
}

// ---------------- 其它工具 ----------------

function floorDiamond(layout, x, y, inset) {
  return [
    project(layout, x + inset, y + inset),
    project(layout, x + 1 - inset, y + inset),
    project(layout, x + 1 - inset, y + 1 - inset),
    project(layout, x + inset, y + 1 - inset),
  ];
}

function measureTagWidth(ctx, text, size) {
  ctx.save();
  ctx.font = `700 ${size}px ${FONT_SANS}`;
  const w = ctx.measureText(text).width;
  ctx.restore();
  return Math.max(38, w + size * 1.8);
}

export { floorDiamond };
