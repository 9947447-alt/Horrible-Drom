// 六种梦魇：剪影、配色、动画全部独立；支持双魇同场、等级、前摇、受击闪白、
// 低血/狂暴、终焉形态、眩晕/灼烧/减速状态与 CO 潜影的隐身。
// 只读 state.activeNightmares / statuses / roommates；不修改任何状态。

import {
  TAU, clamp, lerp, hash01, hashString, rngFrom, rgba, mixColor, darken, lighten,
  smoothNoise, pulse,
} from './util.js';
import { project } from './layout.js';
import {
  drawGlow, drawSoftShadow, drawTag, drawText, blobPath, flameShape, boltPath,
  crackLine, roundRect, paperTag, FONT_SANS, FONT_SERIF, tracePolygon,
} from './paint.js';
import { isoCylinder, rivet, gauge, screenCylinder } from './iso.js';
import { NIGHTMARE_LOOK, getNightmareLook, CORRIDOR } from './themes.js';
import { getNightmare } from '../content/index.js';

const BODY_U = 116; // 梦魇基准身高（世界单位 × scale）

// ---------------- 位置计算 ----------------

function playerRoomId(state) {
  return state?.player?.roomId || state?.roomId || null;
}

function doorAnchor(layout, state, targetRoomId) {
  const pid = playerRoomId(state);
  if (!targetRoomId || targetRoomId === pid) {
    const d = layout.door;
    return {
      x: d.center.x,
      y: d.center.y + d.height * 0.27,
      width: d.width,
      height: d.height,
      isPlayer: true,
      slot: -1,
    };
  }
  const roommates = Array.isArray(state?.roommates) ? state.roommates : [];
  let idx = roommates.findIndex((r) => r && r.roomId === targetRoomId);
  if (idx < 0) idx = 0;
  const slot = layout.roommates[Math.min(idx, layout.roommates.length - 1)];
  const base = project(layout, slot.x, layout.roomH);
  return {
    x: base.x,
    y: base.y + 26 * layout.scale,
    width: 36 * layout.scale,
    height: 54 * layout.scale,
    isPlayer: false,
    slot: idx,
  };
}

/**
 * 计算本帧要绘制的梦魇视觉信息。scene 会把结果同时交给建筑瞄准 / 特效定位。
 * @returns {Array<object>}
 */
export function computeNightmareVisuals(env) {
  const { layout, state, now, simNow } = env;
  const actives = (state?.activeNightmares || []).filter((n) => n && !n.dead && n.state !== 'dead');
  if (!actives.length) return [];
  const pid = playerRoomId(state);

  // 按目标门分组，用于并排站位
  const groups = new Map();
  for (const n of actives) {
    const anchor = doorAnchor(layout, state, n.targetRoomId);
    const key = `${anchor.isPlayer ? 'p' : anchor.slot}`;
    if (!groups.has(key)) groups.set(key, { anchor, list: [] });
    groups.get(key).list.push(n);
  }

  const visuals = [];
  for (const { anchor, list } of groups.values()) {
    // 主魇靠前，副魇靠右
    list.sort((a, b) => (a.secondary ? 1 : 0) - (b.secondary ? 1 : 0));
    const count = list.length;
    for (let i = 0; i < count; i++) {
      const n = list[i];
      const angle = n.state === 'attack' ? n.attackTimer / Math.max(0.001, n.attackInterval || 1.8) : 0;
      const attackRatio = n.state === 'attack' ? clamp(angle, 0, 1) : 0;
      const own = hashString(String(n.id || n.type || i));
      const phase = (own % 1000) / 1000;
      const level = clamp(n.level || 1, 1, 14);
      const hpRatio = n.maxHp > 0 ? clamp(n.hp / n.maxHp, 0, 1) : 1;
      const stunned = typeof n.disabledUntil === 'number' && n.disabledUntil > simNow;
      const burn = n.statuses && n.statuses.burnUntil > simNow;
      const slow = n.statuses && n.statuses.slowUntil > simNow;
      const stun = n.statuses && n.statuses.stunUntil > simNow;
      const revealed = !n.revealUntil || n.revealUntil > simNow;
      const hidden = n.type === 'carbon_monoxide' && !revealed && !stunned;
      const enraged = hpRatio < 0.4;
      const finalForm = level >= 14;
      const retreat = n.state === 'retreat';
      const attacking = n.state === 'attack';

      const spread = count > 1 ? (i - (count - 1) / 2) * anchor.width * 0.42 : 0;
      const typeScale = n.type === 'benzene' ? 1.14
        : n.type === 'carbon_monoxide' ? 1.1
          : n.type === 'formaldehyde' ? 1.12
            : 1;
      const u = layout.scale * typeScale * (n.secondary ? 0.88 : 1) * (1 + (level - 1) * 0.011);
      const sway = retreat ? 0 : Math.sin(now * 0.8 + phase * TAU) * 7 * u;
      const bob = retreat ? 0 : Math.cos(now * 0.6 + phase * TAU) * 2.5 * u;
      const lunge = attacking ? attackRatio * 7 * u : 0;
      const retreatX = retreat ? (own % 2 ? 1 : -1) * (10 + Math.sin(now * 0.8) * 6) * u : 0;
      const x = anchor.x + spread + sway + retreatX + Math.sin(now * 0.35 + phase) * (hidden ? 4 : 0) * u;
      const groundY = anchor.y + bob - lunge + (retreat ? 12 * u : 0);
      const alpha = retreat ? 0.72 : 1;
      const pulseMap = env.pulses?.boss;
      const flash = clamp((pulseMap && typeof pulseMap.get === 'function' ? pulseMap.get(n.id) : pulseMap?.[n.id]) || 0, 0, 1);
      visuals.push({
        n,
        x,
        groundY,
        u,
        phase,
        level,
        hpRatio,
        hidden,
        revealed,
        stunned: stunned || stun,
        burning: !!burn,
        slowed: !!slow,
        enraged,
        finalForm,
        attacking,
        attackRatio,
        retreat,
        alpha,
        flash,
        secondary: !!n.secondary,
        isPlayer: anchor.isPlayer,
      });
    }
  }
  visuals.sort((a, b) => a.groundY - b.groundY);
  return visuals;
}

/** 梦魇身体中心（给弹道/飘字定位）。 */
export function nightmareBodyCenter(visual) {
  return {
    x: visual.x,
    y: visual.groundY - BODY_U * 0.55 * visual.u,
  };
}

// ---------------- 绘制入口 ----------------

export function drawNightmares(ctx, env) {
  const visuals = env.nightmareVisuals || [];
  for (const vis of visuals) drawOne(ctx, env, vis);
}

function drawOne(ctx, env, vis) {
  const { n, u, x, groundY } = vis;
  const look = getNightmareLook(n.type);
  const t = vis.stunned ? 0 : env.now;
  const screen = { x, y: groundY };

  // 地面阴影
  drawSoftShadow(ctx, x, groundY + 2 * u, 30 * u, 11 * u, vis.hidden ? 0.18 : 0.5);

  // 背后的冷色逆光：把深色剪影从门体/走廊里“托”出来
  if (!vis.hidden) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(x, groundY - 52 * u, 4 * u, x, groundY - 52 * u, 46 * u);
    halo.addColorStop(0, rgba(look.accent, 0.12));
    halo.addColorStop(0.6, rgba(look.accent, 0.045));
    halo.addColorStop(1, rgba(look.accent, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.ellipse(x, groundY - 52 * u, 46 * u, 62 * u, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // 低血/终焉的地面光晕
  if (vis.finalForm) {
    const p = 0.55 + 0.45 * Math.sin(t * 2.4 + vis.phase * 5);
    drawGlow(ctx, look.glow, x, groundY - 4 * u, 52 * u, 0.12 + p * 0.08);
  }
  if (vis.hpRatio < 0.35) {
    const p = 0.5 + 0.5 * Math.sin(t * 5.2 + vis.phase * 4);
    drawGlow(ctx, '#ff5b47', x, groundY - 30 * u, 44 * u, 0.05 + p * 0.07);
  }

  ctx.save();
  ctx.translate(x, groundY);
  const jitter = vis.flash > 0.05 ? Math.sin(env.now * 70) * vis.flash * 1.5 : 0;
  ctx.translate(jitter, 0);
  ctx.scale(u, u);
  ctx.globalAlpha *= vis.alpha;

  switch (n.type) {
    case 'benzene':
      drawBenzene(ctx, vis, t, look);
      break;
    case 'phosphorus':
      drawPhosphorus(ctx, vis, t, look);
      break;
    case 'mercury':
      drawMercury(ctx, vis, t, look);
      break;
    case 'hydrogen_sulfide':
      drawHydrogenSulfide(ctx, vis, t, look);
      break;
    case 'carbon_monoxide':
      drawCarbonMonoxide(ctx, vis, t, look);
      break;
    case 'formaldehyde':
      drawFormaldehyde(ctx, vis, t, look);
      break;
    default:
      drawBenzene(ctx, vis, t, look);
  }

  // 状态：灼烧 / 减速 / 眩晕
  if (vis.burning) drawBurnStatus(ctx, vis, t, look);
  if (vis.slowed) drawSlowStatus(ctx, vis, t);
  if (vis.stunned) drawStunStatus(ctx, vis, env.now, look);
  // 前摇蓄力
  if (vis.attacking && vis.attackRatio > 0.55) drawWindup(ctx, vis, t, look);
  // 受击闪白
  if (vis.flash > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, '#fff6e6', 0, -BODY_U * 0.55, 44, vis.flash * 0.32);
    ctx.fillStyle = `rgba(255,246,230,${vis.flash * 0.16})`;
    ctx.beginPath();
    ctx.ellipse(0, -BODY_U * 0.5, 30, 58, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  // 终焉形态
  if (vis.finalForm) drawFinalForm(ctx, vis, t, look);
  ctx.restore();

  // 等级纸牌
  drawLevelTag(ctx, env, vis, look);
  // 潜影的隐身提示波纹
  if (vis.hidden) {
    drawStealthRipple(ctx, env, vis);
  }
  // 攻击前摇时在门上的危险预兆
  if (vis.attacking && vis.attackRatio > 0.62) {
    drawDoorWarning(ctx, env, vis, look);
  }
  // 血条只由 HUD 负责；这里仅显示“终焉”小印
  if (vis.finalForm) {
    drawTag(ctx, screen.x + 34 * u, groundY - BODY_U * u - 2, 26 * u, 13 * u, '终焉', {
      fill: 'rgba(40,18,18,0.85)',
      color: look.accent,
      size: 8 * u,
      bar: look.accent,
    });
  }
}

function drawLevelTag(ctx, env, vis, look) {
  const { u, x, groundY } = vis;
  const y = groundY - BODY_U * u - 4 * u;
  const label = `Lv.${vis.level}`;
  const size = clamp(9 * u, 9, 13);
  const w = clamp(34 * u, 34, 46);
  drawTag(ctx, x - 20 * u, y, w, 14 * u, label, {
    fill: 'rgba(232,220,192,0.92)',
    color: '#2c2118',
    size,
    bar: look.accent,
    angle: (vis.phase - 0.5) * 0.06,
  });
  if (vis.secondary) {
    drawTag(ctx, x + 26 * u, y + 2 * u, 26 * u, 12 * u, '副魇', {
      fill: 'rgba(38,30,36,0.8)',
      color: look.accent,
      size: clamp(7.5 * u, 7, 10),
    });
  }
}

function drawStealthRipple(ctx, env, vis) {
  const { u, x, groundY } = vis;
  const t = env.now;
  ctx.save();
  for (let i = 0; i < 2; i++) {
    const p = ((t * 0.35 + i * 0.5) % 1);
    ctx.strokeStyle = `rgba(200,220,235,${(1 - p) * 0.16})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, groundY - 40 * u, (18 + p * 42) * u, (36 + p * 60) * u, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDoorWarning(ctx, env, vis, look) {
  const { layout, now } = env;
  const d = layout.door;
  const p = 0.5 + 0.5 * Math.sin(now * 9);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const r = 34 * layout.scale * (0.9 + p * 0.12);
  ctx.strokeStyle = rgba('#ff6b57', 0.25 + p * 0.25);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(d.center.x, d.center.y - d.height * 0.4, r, r * 0.45, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

// ---------------- 公共状态叠层 ----------------

function drawBurnStatus(ctx, vis, t, look) {
  for (let i = 0; i < 7; i++) {
    const ph = hash01(i, 3) * TAU;
    const y = -10 - ((t * (22 + hash01(i, 4) * 30) + hash01(i, 5) * 80) % 90);
    const x = Math.sin(t * 2 + ph) * 18 + (hash01(i, 6) - 0.5) * 26;
    const a = clamp(1 - (-y) / 95, 0, 1) * 0.7;
    ctx.fillStyle = rgba(i % 2 ? '#ff9a5c' : '#ffd27a', a * 0.55);
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + hash01(i, 7) * 1.5, 0, TAU);
    ctx.fill();
  }
  drawGlow(ctx, '#ff9a5c', 0, -40, 34, 0.1);
}

function drawSlowStatus(ctx, vis, t) {
  for (let i = 0; i < 8; i++) {
    const x = (hash01(i, 2) - 0.5) * 52;
    const y = -hash01(i, 3) * 82 - 4;
    ctx.fillStyle = 'rgba(190,230,255,0.35)';
    ctx.beginPath();
    ctx.arc(x + Math.sin(t + i) * 1.5, y, 0.9 + hash01(i, 4) * 1.2, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(160,210,240,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, -2, 24, 6, 0, 0, TAU);
  ctx.stroke();
}

function drawStunStatus(ctx, vis, now, look) {
  ctx.save();
  ctx.strokeStyle = `rgba(180,220,255,${0.35 + 0.2 * Math.sin(now * 12)})`;
  ctx.lineWidth = 1.1;
  const seed = Math.floor(now * 10);
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    boltPath(ctx, -26 + i * 18, -70, 20 - i * 12, -20, seed + i, 7, 12);
    ctx.stroke();
  }
  // 眩晕小星
  for (let i = 0; i < 3; i++) {
    const a = now * 2.4 + (i / 3) * TAU;
    ctx.fillStyle = 'rgba(255,240,190,0.7)';
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 20, -95 + Math.sin(a) * 5, 1.8, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawWindup(ctx, vis, t, look) {
  const { u } = vis;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const p = 0.5 + 0.5 * Math.sin(t * 12);
  drawGlow(ctx, look.accent, 0, -BODY_U * 0.5, 34, 0.09 + p * 0.06);
  // 向内汇聚的粒子
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + t * 1.6;
    const r = 40 * (1 - ((t * 0.9 + i * 0.17) % 1));
    ctx.fillStyle = rgba(look.accent, 0.5);
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r, -BODY_U * 0.5 + Math.sin(a) * r * 0.6, 1.3, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawFinalForm(ctx, vis, t, look) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const p = 0.5 + 0.5 * Math.sin(t * 2);
  ctx.strokeStyle = rgba(look.accent, 0.25 + p * 0.2);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(0, -BODY_U * 0.5, 40, 62, 0, 0, TAU);
  ctx.stroke();
  // 环绕的墨色符印
  for (let i = 0; i < 4; i++) {
    const a = t * 0.7 + (i / 4) * TAU;
    const x = Math.cos(a) * 42;
    const y = -BODY_U * 0.5 + Math.sin(a) * 58;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = rgba(look.accent, 0.4);
    ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();
  }
  ctx.restore();
}

// ---------------- 苯环幽影 ----------------

function drawBenzene(ctx, vis, t, look) {
  const ph = vis.phase;
  const float = Math.sin(t * 0.9 + ph * 6) * 3;
  const ringY = -62 + float;
  const R = 30;
  const RY = 10;

  // 地面墨池
  ctx.save();
  ctx.fillStyle = rgba(look.ink, 0.42);
  blobPath(ctx, 0, -1, 28, 7, 3, t * 0.3, 0.18, 14);
  ctx.fill();
  ctx.restore();

  // 下方墨色触须（细而少，避免像笼子）
  ctx.strokeStyle = rgba(look.ink, 0.75);
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const sx = -14 + i * 9;
    const sway = Math.sin(t * 1.2 + i * 1.7 + ph) * 5;
    ctx.lineWidth = 2.4 - i * 0.3;
    ctx.beginPath();
    ctx.moveTo(sx * 0.5, ringY + RY + 2);
    ctx.bezierCurveTo(sx + sway, ringY + 20, sx * 1.2 - sway, -18, sx * 1.1, 0);
    ctx.stroke();
  }
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = rgba(look.ink, 0.7);
    ctx.beginPath();
    ctx.arc(-16 + i * 16 + Math.sin(t + i) * 2, -1, 1.4 + hash01(i, 2), 0, TAU);
    ctx.fill();
  }

  drawGlow(ctx, look.glow, 0, ringY, 46, 0.12 + 0.03 * Math.sin(t * 2));

  // 环与眼睛（统一平移到环的高度）
  ctx.save();
  ctx.translate(0, ringY);
  // 外层虚影
  ctx.save();
  ctx.globalAlpha *= 0.28;
  drawHexRing(ctx, t * 0.18 + ph, R * 1.16, RY * 1.16, 6, rgba(look.inkSoft, 0.9), 3.4);
  ctx.restore();
  // 主环：黑色粗环 + 内侧微光
  const rot = t * 0.5 + ph * 4;
  drawHexRing(ctx, rot, R, RY, 6, look.ink, 9);
  drawHexRing(ctx, rot + 0.03, R, RY, 6, rgba(look.inkSoft, 0.9), 5);
  drawHexRing(ctx, rot, R, RY, 6, rgba(look.edge, 0.9), 1.8);
  drawHexRing(ctx, rot, R, RY, 6, rgba(look.accent, 0.35), 0.8);
  // 环内部的暗色膜
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rot + (i / 6) * TAU;
    const x = Math.cos(a) * (R - 3);
    const y = Math.sin(a) * (RY - 1.2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(8,6,12,0.55)';
  ctx.fill();
  // 六只眼睛：每个顶点一只，会轮流眨
  for (let i = 0; i < 6; i++) {
    const a = rot + (i / 6) * TAU;
    const ex = Math.cos(a) * R;
    const ey = Math.sin(a) * RY;
    const blink = Math.max(0.14, Math.abs(Math.sin(t * 0.9 + i * 1.9 + ph * 3)));
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(a * 0.3);
    // 眼窝
    ctx.fillStyle = look.ink;
    ctx.beginPath();
    ctx.ellipse(0, 0, 6, 4.2, 0, 0, TAU);
    ctx.fill();
    // 眼白
    ctx.fillStyle = rgba(look.eye, 0.8);
    ctx.beginPath();
    ctx.ellipse(0, 0, 4.2, 2.4 * blink + 0.4, 0, 0, TAU);
    ctx.fill();
    // 竖瞳
    ctx.fillStyle = 'rgba(20,12,30,0.95)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 1.2, (1.5 * blink) + 0.3, 0, 0, TAU);
    ctx.fill();
    drawGlow(ctx, look.glow, 0, 0, 8, 0.22);
    ctx.restore();
  }
  // 中心竖眼（前摇时睁开）
  const open = vis.attacking ? clamp((vis.attackRatio - 0.15) / 0.85, 0.2, 1) : 0.24 + 0.1 * Math.sin(t * 1.3);
  ctx.fillStyle = 'rgba(8,6,12,0.92)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 8, 12, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba(look.edge, 0.8);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = rgba(look.eyeCore, 0.65 + open * 0.3);
  ctx.beginPath();
  ctx.ellipse(0, 0, 3.2, (2.4 + open * 7), 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(16,8,24,0.95)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 1.2, (0.8 + open * 4.6), 0, 0, TAU);
  ctx.fill();
  drawGlow(ctx, look.glow, 0, 0, 16, 0.18 + open * 0.25);
  // 终焉：外层符环
  if (vis.finalForm) {
    drawHexRing(ctx, -rot * 0.5, R * 1.5, RY * 1.5, 6, rgba(look.accent, 0.35), 1.1);
  }
  ctx.restore();

  // 环下的墨滴
  for (let i = 0; i < 3; i++) {
    const dt = (t * 0.6 + i * 0.33) % 1;
    ctx.fillStyle = rgba(look.ink, (1 - dt) * 0.8);
    ctx.beginPath();
    ctx.ellipse((i - 1) * 13, ringY + RY + 6 + dt * 20, 1.6, 2.8, 0, 0, TAU);
    ctx.fill();
  }
}

function drawHexRing(ctx, rotation, R, RY, n, color, width) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rotation + (i / n) * TAU;
    const x = Math.cos(a) * R;
    const y = Math.sin(a) * RY;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawHexRingRaw(ctx, rotation, R, RY, n, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rotation + (i / n) * TAU;
    const x = Math.cos(a) * R;
    const y = Math.sin(a) * RY;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
}

// ---------------- 白磷鬼火 ----------------

function drawPhosphorus(ctx, vis, t, look) {
  const ph = vis.phase;
  const enrage = vis.enraged;
  const flameScale = (enrage ? 1.3 : 1) * (1 + Math.sin(t * 4 + ph * 5) * 0.05);
  // 地面灼烧
  ctx.save();
  ctx.fillStyle = rgba(look.flameLow, 0.18);
  ctx.beginPath();
  ctx.ellipse(0, 0, 30, 8, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  drawGlow(ctx, look.glow, 0, -6, 40, enrage ? 0.28 : 0.18);

  // 背后的大火焰
  const backFlames = [
    { x: -13, h: 52, w: 24, seed: 3 },
    { x: 0, h: 68, w: 30, seed: 5 },
    { x: 13, h: 48, w: 22, seed: 7 },
  ];
  for (const f of backFlames) {
    flameShape(ctx, f.x, -6, f.w * flameScale, f.h * flameScale, t * 1.6 + ph, f.seed, {
      hot: enrage ? '#ffffff' : look.flameHot,
      mid: enrage ? '#eaffd2' : look.flameMid,
      low: look.flameLow,
    });
  }
  drawGlow(ctx, look.flameMid, 0, -44, 44, 0.16);
  // 飘起的火星
  for (let i = 0; i < 10; i++) {
    const sp = 16 + hash01(i, 2) * 26;
    const yy = -((t * sp + hash01(i, 3) * 120) % 105);
    const xx = Math.sin(t * 1.4 + i * 2.1) * 18 + (hash01(i, 4) - 0.5) * 20;
    ctx.fillStyle = rgba(i % 3 === 0 ? '#ffffff' : look.flameMid, clamp(1 + yy / 105, 0, 1) * 0.65);
    ctx.beginPath();
    ctx.arc(xx, yy, 0.9 + hash01(i, 5) * 1.3, 0, TAU);
    ctx.fill();
  }

  // 焦黑的孩子轮廓
  const sway = Math.sin(t * 1.1 + ph * 3) * 2;
  ctx.save();
  ctx.translate(sway, 0);
  // 腿
  ctx.strokeStyle = look.ink;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-5, -24);
  ctx.quadraticCurveTo(-8, -12, -6, -2);
  ctx.moveTo(5, -24);
  ctx.quadraticCurveTo(8, -12, 6, -2);
  ctx.stroke();
  // 身体
  ctx.fillStyle = look.ink;
  ctx.beginPath();
  ctx.moveTo(-9, -52);
  ctx.quadraticCurveTo(-13, -38, -8, -23);
  ctx.lineTo(8, -23);
  ctx.quadraticCurveTo(13, -38, 9, -52);
  ctx.closePath();
  ctx.fill();
  // 手臂
  ctx.strokeStyle = look.ink;
  ctx.lineWidth = 4.6;
  ctx.beginPath();
  ctx.moveTo(-9, -48);
  ctx.quadraticCurveTo(-16, -38, -15, -27);
  ctx.moveTo(9, -48);
  ctx.quadraticCurveTo(16, -38, 15, -27);
  ctx.stroke();
  // 头
  ctx.fillStyle = look.ink;
  ctx.beginPath();
  ctx.arc(0, -62, 11.5, 0, TAU);
  ctx.fill();
  // 火焰刘海
  flameShape(ctx, 0, -66, 22, 26, t * 2.2 + ph, 9, {
    hot: enrage ? '#ffffff' : look.flameHot,
    mid: enrage ? '#f2ffe0' : look.flameMid,
    low: look.flameLow,
  });
  // 磷光轮廓
  ctx.strokeStyle = rgba(look.flameMid, 0.5);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(0, -62, 11.5, Math.PI * 0.9, Math.PI * 2.1);
  ctx.stroke();
  // 眼睛
  const blink = Math.abs(Math.sin(t * 0.7 + ph * 4)) > 0.15 ? 1 : 0.15;
  for (let s = -1; s <= 1; s += 2) {
    ctx.fillStyle = rgba(look.eyeCore, 0.95);
    ctx.beginPath();
    ctx.ellipse(s * 4.2, -64, 2.2, 2.2 * blink, 0, 0, TAU);
    ctx.fill();
    drawGlow(ctx, look.flameMid, s * 4.2, -64, 7, 0.35);
  }
  // 胸口的光
  drawGlow(ctx, look.flameLow, 0, -40, 14, 0.25 + 0.1 * Math.sin(t * 3 + ph));
  ctx.restore();

  // 终焉：白色日晕
  if (vis.finalForm) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const p = 0.5 + 0.5 * Math.sin(t * 1.8);
    const halo = ctx.createRadialGradient(0, -55, 4, 0, -55, 62);
    halo.addColorStop(0, 'rgba(255,255,240,0.22)');
    halo.addColorStop(0.6, 'rgba(200,255,180,0.06)');
    halo.addColorStop(1, 'rgba(200,255,180,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, -55, 62, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

// ---------------- 汞形怪 ----------------

function drawMercury(ctx, vis, t, look) {
  const ph = vis.phase;
  const sway = Math.sin(t * 0.9 + ph * 3) * 2.8;

  // 镜面水洼
  ctx.save();
  const puddle = ctx.createLinearGradient(-42, 0, 46, 0);
  puddle.addColorStop(0, 'rgba(38,50,60,0.85)');
  puddle.addColorStop(0.45, 'rgba(150,178,196,0.9)');
  puddle.addColorStop(0.7, 'rgba(206,226,238,0.85)');
  puddle.addColorStop(1, 'rgba(30,42,52,0.8)');
  blobPath(ctx, 0, 0, 36, 8.5, 4, t * 0.4, 0.16, 16);
  ctx.fillStyle = puddle;
  ctx.fill();
  ctx.strokeStyle = 'rgba(226,244,255,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 水洼倒影
  ctx.fillStyle = 'rgba(20,28,36,0.35)';
  blobPath(ctx, 0, -1, 18, 4, 7, t * 0.2, 0.2, 12);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(sway, Math.sin(t * 1.1 + ph) * 1.6);
  // 水银金属：暗底 + 强高光
  const chrome = ctx.createLinearGradient(-30, -95, 34, 0);
  chrome.addColorStop(0, '#4a5a68');
  chrome.addColorStop(0.2, '#dfeaf2');
  chrome.addColorStop(0.34, '#8fa4b4');
  chrome.addColorStop(0.55, '#3d4b58');
  chrome.addColorStop(0.7, '#b7c9d6');
  chrome.addColorStop(0.88, '#5b6d7c');
  chrome.addColorStop(1, '#26323c');

  // 腿（两条液态）
  for (let sd = -1; sd <= 1; sd += 2) {
    ctx.beginPath();
    ctx.moveTo(sd * 4, -34);
    ctx.quadraticCurveTo(sd * 13 + Math.sin(t * 1.3 + sd) * 1.5, -20, sd * 9, -2);
    ctx.quadraticCurveTo(sd * 6, -10, sd * 2, -30);
    ctx.closePath();
    ctx.fillStyle = chrome;
    ctx.fill();
    ctx.strokeStyle = 'rgba(14,20,26,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // 躯干
  blobPath(ctx, 0, -52, 18, 28, 7, t * 0.5, 0.06, 16);
  ctx.fillStyle = chrome;
  ctx.fill();
  ctx.strokeStyle = 'rgba(243,252,255,0.38)';
  ctx.lineWidth = 1.1;
  ctx.stroke();
  // 手臂（垂坠液态，末端拉丝）
  for (let sd = -1; sd <= 1; sd += 2) {
    ctx.beginPath();
    ctx.moveTo(sd * 14, -66);
    ctx.quadraticCurveTo(sd * 27 + Math.sin(t * 1.1 + sd) * 3, -52, sd * 23, -30 + Math.sin(t * 1.4 + sd) * 3);
    ctx.quadraticCurveTo(sd * 20, -42, sd * 12, -60);
    ctx.closePath();
    ctx.fillStyle = chrome;
    ctx.fill();
    ctx.strokeStyle = 'rgba(235,248,255,0.26)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    // 指尖液滴
    const dropY = -26 + Math.sin(t * 1.4 + sd) * 3;
    ctx.fillStyle = 'rgba(220,238,248,0.8)';
    ctx.beginPath();
    ctx.ellipse(sd * 23, dropY + 4, 1.8, 3.4, 0, 0, TAU);
    ctx.fill();
  }
  // 头（镜面圆头，略微前倾）
  blobPath(ctx, 0, -86, 12, 13, 3, t * 0.8, 0.05, 16);
  ctx.fillStyle = chrome;
  ctx.fill();
  ctx.strokeStyle = 'rgba(244,253,255,0.5)';
  ctx.lineWidth = 1.1;
  ctx.stroke();
  // 高光：流线
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-9, -94);
  ctx.quadraticCurveTo(-13, -80, -9, -66);
  ctx.moveTo(-12, -50);
  ctx.quadraticCurveTo(-15, -38, -12, -26);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(8, -60);
  ctx.quadraticCurveTo(12, -46, 9, -34);
  ctx.stroke();
  // 眼睛：两道发白的细缝
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.ellipse(-4.5, -88, 3.2, 1.1, -0.1, 0, TAU);
  ctx.ellipse(4.5, -88, 3.2, 1.1, 0.1, 0, TAU);
  ctx.fill();
  drawGlow(ctx, '#dff4ff', 0, -88, 9, 0.3);
  // 镜面反射的暖色光斑
  ctx.fillStyle = 'rgba(255,199,120,0.18)';
  ctx.beginPath();
  ctx.ellipse(-6, -56, 3.4, 8, 0.2, 0, TAU);
  ctx.fill();
  ctx.restore();

  // 环绕/甩出的液滴
  for (let i = 0; i < 6; i++) {
    const p = (t * 0.32 + i * 0.167 + ph) % 1;
    const a = (i / 6) * TAU;
    const orbit = 30 + Math.sin(t * 0.7 + i) * 6;
    const dx = Math.cos(a + t * 0.3) * orbit;
    const dy = -58 + Math.sin(a + t * 0.3) * 24 + p * 24;
    const r = 2.4 + hash01(i, 3) * 2.8;
    const drop = ctx.createRadialGradient(dx - r * 0.3, dy - r * 0.3, 0.2, dx, dy, r);
    drop.addColorStop(0, 'rgba(255,255,255,0.95)');
    drop.addColorStop(0.5, 'rgba(176,202,216,0.9)');
    drop.addColorStop(1, 'rgba(58,74,86,0.85)');
    ctx.fillStyle = drop;
    ctx.beginPath();
    ctx.arc(dx, dy, r, 0, TAU);
    ctx.fill();
  }
  // 滴落
  for (let i = 0; i < 3; i++) {
    const p = (t * 0.7 + i * 0.33) % 1;
    ctx.fillStyle = `rgba(200,225,240,${(1 - p) * 0.65})`;
    ctx.beginPath();
    ctx.ellipse((i - 1) * 15, -10 + p * 12, 1.5, 3, 0, 0, TAU);
    ctx.fill();
  }
  drawGlow(ctx, look.glow, 0, -54, 38, 0.08);

  if (vis.finalForm) {
    ctx.save();
    ctx.fillStyle = 'rgba(170,200,220,0.2)';
    blobPath(ctx, 0, 0, 70, 15, 9, t * 0.3, 0.2, 20);
    ctx.fill();
    ctx.strokeStyle = 'rgba(226,244,255,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}

// ---------------- 硫化氢瘴气 ----------------

function drawHydrogenSulfide(ctx, vis, t, look) {
  const ph = vis.phase;
  const sway = Math.sin(t * 0.7 + ph * 3) * 3;
  // 背后的黄绿气团
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + t * 0.12;
    const x = Math.cos(a + ph) * 18;
    const y = -52 + Math.sin(a * 1.6) * 22;
    ctx.fillStyle = rgba(look.gasDark, 0.16 + 0.04 * Math.sin(t + i));
    blobPath(ctx, x, y, 24 + i * 3, 17 + i * 2, i + 3, t * 0.3 + i, 0.3, 14);
    ctx.fill();
  }
  drawGlow(ctx, look.gas, 0, -46, 44, 0.12);

  ctx.save();
  ctx.translate(sway, Math.sin(t * 1.1 + ph) * 1.5);
  // 实验服：破旧的下摆
  const coat = ctx.createLinearGradient(0, -66, 0, 0);
  coat.addColorStop(0, mixColor(look.inkSoft, look.gasDark, 0.4));
  coat.addColorStop(1, mixColor(look.ink, '#000000', 0.1));
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.moveTo(-13, -62);
  ctx.quadraticCurveTo(-22, -42, -24, -12);
  // 破烂下摆
  const hem = [
    [-24, -12], [-18, -18], [-15, -6], [-10, -15], [-5, -4],
    [0, -14], [5, -3], [10, -15], [15, -6], [19, -17], [24, -12],
  ];
  for (const [hx, hy] of hem) ctx.lineTo(hx, hy);
  ctx.quadraticCurveTo(22, -42, 13, -62);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba(look.gasDark, 0.5);
  ctx.lineWidth = 1;
  ctx.stroke();
  // 衣褶
  ctx.strokeStyle = 'rgba(20,22,12,0.35)';
  ctx.lineWidth = 1.1;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 7, -58);
    ctx.quadraticCurveTo(i * 10, -34, i * 8, -10);
    ctx.stroke();
  }
  // 肩部/领口的气团
  ctx.fillStyle = rgba(look.gas, 0.3);
  blobPath(ctx, 0, -64, 19, 8, 5, t * 0.5, 0.16, 12);
  ctx.fill();
  // 连帽与防毒面具
  ctx.fillStyle = 'rgba(40,42,30,0.98)';
  ctx.beginPath();
  ctx.ellipse(0, -78, 15, 15.5, 0, 0, TAU);
  ctx.fill();
  // 兜帽边缘
  ctx.strokeStyle = rgba(look.gasDark, 0.6);
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // 面具：两个滤毒罐 + 中间呼气阀
  ctx.fillStyle = look.mask;
  ctx.beginPath();
  ctx.ellipse(0, -77, 10.5, 9, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(16,16,10,0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();
  for (let s = -1; s <= 1; s += 2) {
    screenCylinder(ctx, s * 12, -72, 4.6, 3, 8, {
      side: darken(look.filter, 0.1),
      sideDark: darken(look.filter, 0.35),
      sideLight: lighten(look.filter, 0.1),
      top: lighten(look.filter, 0.18),
      rim: 'rgba(16,16,10,0.8)',
    });
    // 滤毒罐的网格
    ctx.strokeStyle = 'rgba(20,20,12,0.5)';
    ctx.lineWidth = 0.5;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(s * 12 - 4, -76 + k * 2.2);
      ctx.lineTo(s * 12 + 4, -76 + k * 2.2);
      ctx.stroke();
    }
  }
  // 镜片（暗琥珀）
  for (let s = -1; s <= 1; s += 2) {
    ctx.fillStyle = rgba(look.eye, 0.25);
    ctx.beginPath();
    ctx.ellipse(s * 4.6, -80, 3.4, 2.4, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,20,12,0.7)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    const glowA = 0.18 + 0.1 * Math.sin(t * 1.7 + s);
    drawGlow(ctx, look.eye, s * 4.6, -80, 4, glowA);
  }
  // 呼气阀
  ctx.fillStyle = 'rgba(30,32,22,0.95)';
  ctx.beginPath();
  ctx.arc(0, -73, 3, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(150,150,110,0.3)';
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.restore();

  // 外部毒雾
  for (let i = 0; i < 4; i++) {
    const p = (t * 0.25 + i * 0.25) % 1;
    ctx.fillStyle = rgba(look.gas, 0.05 + (1 - p) * 0.05);
    blobPath(
      ctx,
      Math.sin(t * 0.5 + i * 2) * 30,
      -30 - p * 24,
      22 + p * 16, 12 + p * 10,
      i + 9, t * 0.4, 0.35, 12
    );
    ctx.fill();
  }
  // 悬浮的腐臭气泡
  for (let i = 0; i < 5; i++) {
    const p = (t * 0.4 + i * 0.2) % 1;
    ctx.strokeStyle = rgba(look.gas, (1 - p) * 0.3);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(18 + Math.sin(i * 3 + t) * 10, -50 - p * 40, 1.6 + hash01(i, 3) * 2, 0, TAU);
    ctx.stroke();
  }
  if (vis.finalForm) {
    // 终焉：瘴气吞没门口
    ctx.save();
    ctx.fillStyle = 'rgba(60,72,30,0.1)';
    blobPath(ctx, 0, -6, 60, 18, 13, t * 0.2, 0.3, 18);
    ctx.fill();
    ctx.restore();
  }
}

// ---------------- 一氧化碳潜影 ----------------

function drawCarbonMonoxide(ctx, vis, t, look) {
  const ph = vis.phase;
  const hidden = vis.hidden;
  const sway = Math.sin(t * 0.6 + ph * 3) * 2;
  ctx.save();
  ctx.translate(sway, 0);

  if (!hidden) {
    // 热浪轮廓：多层半透明抖动的人形
    for (let layer = 0; layer < 3; layer++) {
      const off = (layer - 1) * 2.4;
      const a = 0.1 - layer * 0.02;
      ctx.fillStyle = rgba(look.edge, a);
      ctx.beginPath();
      const ys = [0, -18, -34, -48, -58, -66, -72, -78, -84, -90];
      const widths = [16, 19, 17, 16, 15, 17, 15, 12, 10, 1];
      // 左侧向下
      for (let i = 0; i < ys.length; i++) {
        const w = widths[i];
        const wav = Math.sin(ys[i] * 0.14 + t * 3 + layer + ph * 5) * 2.4;
        const x = -w + off + wav;
        if (i === 0) ctx.moveTo(x, 0);
        else ctx.lineTo(x, ys[i]);
      }
      // 右侧向上
      for (let i = ys.length - 1; i >= 0; i--) {
        const w = widths[i];
        const wav = Math.sin(ys[i] * 0.14 + t * 3 + layer + ph * 5 + 1.7) * 2.4;
        ctx.lineTo(w + off + wav, ys[i]);
      }
      ctx.closePath();
      ctx.fill();
    }
    // 内部的热浪折线
    ctx.strokeStyle = rgba(look.glow, 0.12);
    ctx.lineWidth = 0.9;
    for (let i = 0; i < 6; i++) {
      const y = -12 - i * 13;
      ctx.beginPath();
      for (let k = 0; k <= 8; k++) {
        const xx = -12 + k * 3;
        const yy = y + Math.sin(k * 0.9 + t * 3 + i) * 2;
        if (k === 0) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
    // 如果被照出：加强轮廓
    if (vis.revealed) {
      ctx.strokeStyle = rgba(look.glow, 0.28);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(0, -46, 19, 46, 0, 0, TAU);
      ctx.stroke();
      drawGlow(ctx, look.glow, 0, -48, 30, 0.1);
    }
  } else {
    // 隐身：只有淡淡热浪
    for (let i = 0; i < 3; i++) {
      const yy = -20 - i * 20;
      ctx.strokeStyle = `rgba(200,220,235,${0.035 + i * 0.01})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k <= 8; k++) {
        const xx = -14 + k * 3.5;
        const yo = yy + Math.sin(k * 0.8 + t * 2.4 + i) * 2.4;
        if (k === 0) ctx.moveTo(xx, yo);
        else ctx.lineTo(xx, yo);
      }
      ctx.stroke();
    }
  }

  // 苍白的眼睛（始终可见）
  const blink = Math.abs(Math.sin(t * 0.5 + ph * 7)) > 0.1 ? 1 : 0.1;
  const eyeY = -80;
  for (let s = -1; s <= 1; s += 2) {
    ctx.fillStyle = `rgba(255,255,255,${hidden ? 0.6 : 0.95})`;
    ctx.beginPath();
    ctx.ellipse(s * 5, eyeY, 2.6, 1.7 * blink, s * 0.08, 0, TAU);
    ctx.fill();
    drawGlow(ctx, '#eaf6ff', s * 5, eyeY, hidden ? 5 : 8, hidden ? 0.2 : 0.4);
  }
  // 若有攻击前摇：眼睛眯起
  if (vis.attacking) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-9, eyeY - 4);
    ctx.lineTo(-2, eyeY - 2);
    ctx.moveTo(9, eyeY - 4);
    ctx.lineTo(2, eyeY - 2);
    ctx.stroke();
  }
  ctx.restore();

  // 地面热浪
  for (let i = 0; i < 2; i++) {
    const p = ((t * 0.4 + i * 0.5) % 1);
    ctx.strokeStyle = `rgba(200,220,235,${(1 - p) * 0.12})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, 18 + p * 30, 5 + p * 9, 0, 0, TAU);
    ctx.stroke();
  }
  if (vis.finalForm) {
    // 终焉：更大的扭曲
    ctx.save();
    ctx.strokeStyle = 'rgba(220,235,250,0.12)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      const p = (t * 0.3 + i * 0.33) % 1;
      ctx.beginPath();
      ctx.ellipse(0, -50, 30 + p * 40, 62 + p * 26, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------- 甲醛标本 ----------------

function drawFormaldehyde(ctx, vis, t, look) {
  const ph = vis.phase;
  const floatY = -52 + Math.sin(t * 0.9 + ph * 4) * 3;
  // 地面上的福尔马林积液
  ctx.save();
  ctx.fillStyle = 'rgba(160,96,112,0.14)';
  blobPath(ctx, 0, 0, 27, 7, 5, t * 0.3, 0.2, 12);
  ctx.fill();
  ctx.restore();
  drawGlow(ctx, look.glow, 0, floatY, 38, 0.1);

  // 下方的触手
  ctx.strokeStyle = rgba(look.liquidDark, 0.75);
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const sx = -10 + i * 5;
    const sway = Math.sin(t * 1.4 + i * 1.6 + ph * 5) * 6;
    ctx.lineWidth = 1.6 + hash01(i, 2) * 1.4;
    ctx.beginPath();
    ctx.moveTo(sx, floatY + 18);
    ctx.bezierCurveTo(sx + sway, floatY + 30, sx + sway * 1.6, -14, sx + sway, 0);
    ctx.stroke();
    // 吸盘
    ctx.fillStyle = rgba(look.liquidDark, 0.5);
    ctx.beginPath();
    ctx.arc(sx + sway * 1.2, -6 - i * 2, 1.2, 0, TAU);
    ctx.fill();
  }

  // 标本罐
  ctx.save();
  ctx.translate(0, floatY);
  const jarW = 32;
  const jarH = 44;
  // 罐体阴影
  ctx.fillStyle = 'rgba(20,12,16,0.28)';
  roundRect(ctx, -jarW / 2 + 3, -jarH / 2 + 3, jarW, jarH, 7, 'rgba(20,12,16,0.28)');
  // 玻璃
  const glass = ctx.createLinearGradient(-jarW / 2, 0, jarW / 2, 0);
  glass.addColorStop(0, 'rgba(190,225,220,0.2)');
  glass.addColorStop(0.25, 'rgba(235,255,250,0.34)');
  glass.addColorStop(0.6, 'rgba(190,225,220,0.18)');
  glass.addColorStop(1, 'rgba(140,180,174,0.24)');
  ctx.fillStyle = glass;
  roundRect(ctx, -jarW / 2, -jarH / 2, jarW, jarH, 7, glass);
  ctx.strokeStyle = 'rgba(235,255,250,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 液体
  const liq = ctx.createLinearGradient(0, -6, 0, jarH / 2);
  liq.addColorStop(0, rgba(look.liquid, 0.42));
  liq.addColorStop(1, rgba(look.liquidDark, 0.5));
  ctx.fillStyle = liq;
  roundRect(ctx, -jarW / 2 + 1.6, -jarH * 0.06, jarW - 3.2, jarH / 2 - 2, 4, liq);
  // 液面
  ctx.fillStyle = rgba(lighten(look.liquid, 0.3), 0.5);
  ctx.beginPath();
  ctx.ellipse(0, -jarH * 0.06, jarW / 2 - 2.4, 2.2, 0, 0, TAU);
  ctx.fill();
  // 漂浮的标本：小孩影子
  const float2 = Math.sin(t * 0.8 + ph) * 2;
  ctx.save();
  ctx.translate(0, float2);
  ctx.fillStyle = 'rgba(60,40,48,0.65)';
  // 头
  ctx.beginPath();
  ctx.arc(0, -10, 5.4, 0, TAU);
  ctx.fill();
  // 身体
  ctx.beginPath();
  ctx.moveTo(-5, -5);
  ctx.quadraticCurveTo(-6.4, 3, -3, 6);
  ctx.lineTo(3, 6);
  ctx.quadraticCurveTo(6.4, 3, 5, -5);
  ctx.closePath();
  ctx.fill();
  // 头发的细丝
  ctx.strokeStyle = 'rgba(50,32,40,0.55)';
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(-4 + i * 2, -14);
    ctx.quadraticCurveTo(-6 + i * 3, -19 + Math.sin(t + i) * 2, -2 + i * 2, -22);
    ctx.stroke();
  }
  ctx.restore();
  // 气泡
  for (let i = 0; i < 6; i++) {
    const p = (t * 0.5 + i * 0.17) % 1;
    ctx.strokeStyle = rgba('#f0fff8', (1 - p) * 0.4);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(-10 + hash01(i, 4) * 20, jarH / 2 - p * 40, 1 + hash01(i, 5) * 2, 0, TAU);
    ctx.stroke();
  }
  // 玻璃反光
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.moveTo(-jarW / 2 + 3, -jarH / 2 + 6);
  ctx.lineTo(-jarW / 2 + 7, -jarH / 2 + 6);
  ctx.lineTo(-jarW / 2 + 3, jarH / 2 - 12);
  ctx.lineTo(-jarW / 2 + 1.5, jarH / 2 - 14);
  ctx.closePath();
  ctx.fill();
  // 金属盖
  ctx.fillStyle = 'rgba(92,88,82,0.98)';
  roundRect(ctx, -jarW / 2 - 2, -jarH / 2 - 5, jarW + 4, 6, 2, 'rgba(92,88,82,0.98)');
  ctx.fillStyle = 'rgba(140,136,128,0.95)';
  roundRect(ctx, -jarW / 2 - 2, -jarH / 2 - 5, jarW + 4, 2, 1, 'rgba(140,136,128,0.95)');
  // 盖子上的把手
  ctx.strokeStyle = 'rgba(60,56,52,0.9)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, -jarH / 2 - 7, 4, Math.PI, 0);
  ctx.stroke();
  // 标签
  ctx.fillStyle = 'rgba(232,220,196,0.9)';
  ctx.fillRect(-8, 2, 16, 9);
  ctx.strokeStyle = 'rgba(90,70,54,0.4)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(-8, 2, 16, 9);
  drawText(ctx, '标本', 0, 6.5, { size: 4.6, color: 'rgba(60,40,34,0.9)', weight: 700 });
  ctx.restore();

  // 高等级：环绕的小标本罐
  if (vis.level >= 8) {
    for (let i = 0; i < 3; i++) {
      const a = t * 0.5 + (i / 3) * TAU + ph;
      const x = Math.cos(a) * 40;
      const y = floatY + Math.sin(a) * 14 - 8;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(a) * 0.18);
      ctx.fillStyle = 'rgba(180,210,205,0.22)';
      roundRect(ctx, -5, -7, 10, 14, 2.5, 'rgba(180,210,205,0.22)');
      ctx.strokeStyle = 'rgba(225,250,245,0.35)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.fillStyle = rgba(look.liquid, 0.4);
      roundRect(ctx, -4, 0, 8, 6, 1, rgba(look.liquid, 0.4));
      ctx.fillStyle = 'rgba(60,44,50,0.5)';
      ctx.beginPath();
      ctx.arc(0, -1, 1.6, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
  if (vis.finalForm) {
    // 终焉：整面墙般的标本柜阴影
    ctx.save();
    ctx.strokeStyle = rgba(look.accent, 0.16);
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) {
      roundRect(ctx, -42 + i * 22, -104, 18, 30, 3, null);
      ctx.stroke();
    }
    ctx.restore();
  }
}
