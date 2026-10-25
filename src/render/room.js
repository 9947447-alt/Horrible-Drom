// 宿舍剖面场景：静态层（地板/墙纸/窗户/家具/走廊/门框，离屏缓存）
// 与动态层（冷凝床、气密门、走廊灯火、尘埃、预兆）。
// 所有坐标由 layout 投影推导；不读取/修改游戏逻辑，只读 state。

import {
  TAU, clamp, lerp, hash01, hashString, rngFrom, rgba, mixColor, darken, lighten,
  smoothNoise, pulse, easeOutCubic,
} from './util.js';
import {
  TILE, project, projectElevated, tileTransform, tileCenter, tracePolygon,
} from './layout.js';
import {
  makeCanvas, drawText, drawTag, paperTag, tapeStrip, plasterPatch, stainShape, inkSplat,
  crackLine, cobweb, drawGlow, drawSoftShadow, lightPool, flameShape, hatchPoly,
  dashedEllipse, roundRect, blobPath, fillPoly, strokePoly, line, FONT_SANS, FONT_SERIF, getGrainTile,
} from './paint.js';
import { isoBox, isoCylinder, screenCylinder, screenPlate, rivet, gauge, valveWheel, floorDot } from './iso.js';
import { CORRIDOR } from './themes.js';

const { HW, HH, WALL_H, CUT_H, NEIGHBOR_WALL_H, DOOR_HEIGHT, DOOR_HALF_TILES } = TILE;

// ---------------- 墙面局部坐标（y 向下，保证文字/图案不镜像） ----------------

function northWallDown(layout) {
  const s = layout.scale;
  const o = project(layout, 0, 0);
  return { a: HW * s, b: HH * s, c: 0, d: s, e: o.x, f: o.y - WALL_H * s };
}

function westWallDown(layout) {
  const s = layout.scale;
  const o = project(layout, 0, 0);
  return { a: -HW * s, b: HH * s, c: 0, d: s, e: o.x, f: o.y - WALL_H * s };
}

function southCutDown(layout) {
  const s = layout.scale;
  const h = layout.roomH;
  const o = project(layout, 0, h);
  return { a: HW * s, b: HH * s, c: 0, d: s, e: o.x, f: o.y - CUT_H * s };
}

function eastCutDown(layout) {
  const s = layout.scale;
  const w = layout.roomW;
  const o = project(layout, w, 0);
  return { a: -HW * s, b: HH * s, c: 0, d: s, e: o.x, f: o.y - CUT_H * s };
}

function southFacadeDown(layout, x0, heightWorld) {
  const s = layout.scale;
  const o = project(layout, x0, layout.roomH);
  return { a: HW * s, b: HH * s, c: 0, d: s, e: o.x, f: o.y - heightWorld * s };
}

function applyDown(ctx, m) {
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
}

// ---------------- 静态层入口 ----------------

export function buildStaticRoomCanvas(layout, room, theme, dpr) {
  const canvas = makeCanvas(layout.cssW * dpr, layout.cssH * dpr);
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, layout.cssW, layout.cssH);
  drawStaticRoom(ctx, layout, room, theme);
  return canvas;
}

/** 生成可复用的房间装饰规格（窗户位置、家具分配等）。 */
export function getRoomSpec(room, theme) {
  const seed = hashString(`${room.id}|static|v3|${theme.id}`);
  return roomSpec(room, theme, seed);
}

export function drawStaticRoom(ctx, layout, room, theme) {
  const spec = getRoomSpec(room, theme);
  const rng = rngFrom(spec.seed);

  drawBackdrop(ctx, layout, room, theme, rng);
  drawFloor(ctx, layout, room, theme, rng, spec);
  drawCutWalls(ctx, layout, room, theme, rng, spec);
  drawBackWalls(ctx, layout, room, theme, rng, spec);
  drawCeilingLampFixture(ctx, layout, room, theme, rng);
  if (spec.wallProps.includes('laundry')) drawLaundry(ctx, layout, theme, rng, spec);
  if (spec.wallProps.includes('slope')) drawAtticSlope(ctx, layout, room, theme, rng, spec);
  drawFloorClutter(ctx, layout, room, theme, rng, spec);
  drawDoorRecess(ctx, layout, room, theme);
  drawCorridor(ctx, layout, room, theme, rng, spec);
  drawEdgeInk(ctx, layout, room, theme, rng);
}

// 依据房间数据推导窗户位置、墙面道具与地面杂物的分配，保证每次一致。
function roomSpec(room, theme, seed) {
  const rng = rngFrom(seed ^ 0x5f3759df);
  const props = Array.isArray(room.props) ? room.props : [];
  const w = room.w;
  const wallProps = [];
  const floorPlan = new Map(); // key: `${x},${y}` -> type

  const has = (name) => props.includes(name);
  const balcony = has('balcony');
  const attic = has('slope');
  const windowW = attic ? 1.55 : balcony ? clamp(w * 0.46, 2.4, 3.2) : clamp(w * 0.34, 2.0, 2.8);
  const windowX = Math.max(2.35, w - windowW - (balcony ? 0.65 : 0.8));
  const windowY = attic ? 74 : balcony ? 12 : 20;
  const windowH = attic ? 32 : balcony ? WALL_H - 26 : 52;

  let posterSeed = rng();
  const blocked = Array.isArray(room.blocked) ? room.blocked.slice() : [];

  // 墙面道具按 props 分配；没有指定时也放一两张纸张/告示。
  if (has('poster')) wallProps.push('poster');
  if (has('pipes')) wallProps.push('pipes');
  if (has('bookshelf')) wallProps.push('bookshelf');
  if (has('mirror')) wallProps.push('mirror');
  if (has('laundry')) wallProps.push('laundry');
  if (has('slope')) wallProps.push('slope');
  if (attic) wallProps.push('slope');

  // 地面占位家具：优先用 blocked 格，避免挡住可建造区。
  const takeBlocked = () => (blocked.length ? blocked.shift() : null);
  if (has('desk')) {
    const a = takeBlocked();
    const b = takeBlocked();
    if (a) floorPlan.set(`${a.x},${a.y}`, { type: 'desk', tile: a, extra: b });
    if (b && !(a && b.x === a.x && b.y === a.y + 1)) floorPlan.set(`${b.x},${b.y}`, { type: 'side-table', tile: b });
  }
  if (has('plant')) {
    const t = blocked.length > 1 ? blocked.pop() : takeBlocked();
    if (t) floorPlan.set(`${t.x},${t.y}`, { type: 'plant', tile: t });
  }
  if (has('boxes')) {
    const t = takeBlocked();
    if (t) floorPlan.set(`${t.x},${t.y}`, { type: 'boxes', tile: t });
  }
  if (has('thermos')) {
    const t = takeBlocked();
    if (t) floorPlan.set(`${t.x},${t.y}`, { type: 'thermos', tile: t });
  }
  if (has('lamp')) {
    const t = takeBlocked();
    if (t) floorPlan.set(`${t.x},${t.y}`, { type: 'desk-lamp', tile: t });
  }
  // 剩下的 blocked 格用杂物填满，让不可建造格有明确的视觉理由。
  const clutterKinds = ['crates', 'chair', 'barrel', 'sack', 'stool'];
  for (const t of blocked) {
    if (!floorPlan.has(`${t.x},${t.y}`)) {
      const kind = clutterKinds[Math.floor(hash01(seed, t.x, t.y) * clutterKinds.length)];
      floorPlan.set(`${t.x},${t.y}`, { type: kind, tile: t });
    }
  }

  return {
    seed,
    rng,
    w,
    wallProps,
    floorPlan,
    window: { x: windowX, y: windowY, w: windowW, h: windowH, style: balcony ? 'balcony' : 'window' },
    posterSeed,
    hasFan: has('fan'),
    lampSeed: rng(),
    windowSeed: Math.floor(rng() * 10000),
  };
}

// ---------------- 背景 ----------------

function drawBackdrop(ctx, layout, room, theme, rng) {
  const { cssW, cssH } = layout;
  const center = project(layout, room.w * 0.5, room.h * 0.5);
  ctx.fillStyle = '#05080d';
  ctx.fillRect(0, 0, cssW, cssH);

  // 房间下方的暖色环境光
  let g = ctx.createRadialGradient(center.x, center.y - cssH * 0.04, cssW * 0.04, center.x, center.y, cssW * 0.62);
  g.addColorStop(0, rgba(theme.lamp, 0.1));
  g.addColorStop(0.42, rgba(theme.ambient, 0.55));
  g.addColorStop(1, 'rgba(4,6,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cssW, cssH);

  // 走廊方向一点冷光
  const cold = project(layout, room.w * 0.55, room.h + 1.6);
  g = ctx.createRadialGradient(cold.x, cold.y, 10, cold.x, cold.y, cssW * 0.5);
  g.addColorStop(0, 'rgba(90,125,150,0.1)');
  g.addColorStop(0.55, 'rgba(24,36,48,0.18)');
  g.addColorStop(1, 'rgba(4,7,11,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cssW, cssH);

  // 远处黑掉的宿舍：几乎不可见的窗格
  ctx.save();
  for (let i = 0; i < 7; i++) {
    const x = cssW * (0.06 + hash01(room.id ? room.id.length : 3, i, 1) * 0.88);
    const y = cssH * (0.08 + hash01(i, 5, 2) * 0.24);
    const w = 10 + hash01(i, 7) * 22;
    const h = 6 + hash01(i, 9) * 12;
    ctx.fillStyle = rgba('#33404d', 0.05 + hash01(i, 3) * 0.04);
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();

  // 房间后方的暖色扬尘
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i++) {
    const x = center.x + (hash01(i, 11) - 0.5) * cssW * 0.5;
    const y = center.y + (hash01(i, 13) - 0.5) * cssH * 0.36;
    ctx.fillStyle = rgba(theme.lamp, 0.05 + hash01(i, 17) * 0.05);
    ctx.beginPath();
    ctx.arc(x, y, 0.6 + hash01(i, 19) * 1.6, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------- 地板 ----------------

function drawFloor(ctx, layout, room, theme, rng, spec) {
  const { roomW: w, roomH: h } = layout;
  const corners = [project(layout, 0, 0), project(layout, w, 0), project(layout, w, h), project(layout, 0, h)];
  const top = corners[0];
  const bottom = corners[2];

  ctx.save();
  tracePolygon(ctx, corners);
  ctx.clip();

  // 底色：靠近墙更暗，靠镜头略暖
  const g = ctx.createLinearGradient(0, top.y, 0, bottom.y);
  g.addColorStop(0, darken(theme.floor.base, 0.22));
  g.addColorStop(0.45, theme.floor.base);
  g.addColorStop(1, lighten(theme.floor.base, 0.05));
  ctx.fillStyle = g;
  ctx.fillRect(0, top.y - 40, layout.cssW, bottom.y - top.y + 90);

  drawFloorPlanks(ctx, layout, theme, rng);
  drawFloorGrid(ctx, layout, room, theme);
  drawFloorRug(ctx, layout, room, theme, rng);
  drawFloorWear(ctx, layout, room, theme, rng);
  drawFloorStains(ctx, layout, room, theme, rng);
  drawFloorLightPools(ctx, layout, room, theme, spec);
  ctx.restore();

  // 地板边缘切口：剖面的厚度
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(corners[3].x, corners[3].y);
  ctx.lineTo(corners[2].x, corners[2].y);
  ctx.lineTo(corners[1].x, corners[1].y);
  ctx.strokeStyle = rgba(theme.floor.edge, 0.9);
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(corners[3].x, corners[3].y + 1.4);
  ctx.lineTo(corners[2].x, corners[2].y + 1.4);
  ctx.lineTo(corners[1].x, corners[1].y + 1.4);
  ctx.strokeStyle = 'rgba(255,236,200,0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawFloorPlanks(ctx, layout, theme, rng) {
  const { roomW: w, roomH: h } = layout;
  const floor = theme.floor;
  ctx.save();
  applyDown(ctx, tileTransform(layout));

  if (theme.pattern === 'plaster' || theme.id === 'teal') {
    // 冷色房间用大块胶地板：棋盘 + 磨损
    const cw = 0.5;
    const ch = 0.5;
    for (let y = 0; y < h; y += ch) {
      for (let x = 0; x < w; x += cw) {
        const alt = (Math.round(x / cw) + Math.round(y / ch)) % 2 === 0;
        ctx.fillStyle = alt ? floor.plankA : floor.plankB;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(x, y, cw, ch);
      }
    }
    ctx.globalAlpha = 1;
  } else if (theme.pattern === 'damask') {
    // 尽头房：人字拼花
    ctx.strokeStyle = rgba(floor.seam, 0.7);
    ctx.lineWidth = 0.02;
    for (let y = 0; y < h; y += 0.23) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.strokeStyle = rgba(floor.seam, 0.35 + hash01(y * 10) * 0.2);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 0.46) {
      for (let x = 0; x < w; x += 0.46) {
        ctx.fillStyle = rgba((Math.floor(x / 0.46) + Math.floor(y / 0.46)) % 2 ? floor.plankA : floor.plankB, 0.5);
        ctx.fillRect(x, y, 0.46, 0.23);
      }
    }
  } else {
    // 木板：沿 x 方向的长条
    const plank = 0.235;
    for (let y = 0, i = 0; y < h; y += plank, i++) {
      const r = hash01(i, 3, 8);
      ctx.fillStyle = r > 0.66 ? floor.plankC : r > 0.33 ? floor.plankA : floor.plankB;
      ctx.globalAlpha = 0.62;
      ctx.fillRect(0, y, w, plank + 0.006);
      // 木纹
      ctx.globalAlpha = 0.17;
      ctx.strokeStyle = floor.grain;
      ctx.lineWidth = 0.012;
      for (let k = 0; k < 3; k++) {
        const gy = y + plank * (0.2 + k * 0.28 + hash01(i, k, 4) * 0.08);
        ctx.beginPath();
        ctx.moveTo(0.05 + hash01(i, k, 5) * 0.4, gy);
        ctx.bezierCurveTo(w * 0.3, gy + (hash01(i, k, 6) - 0.5) * 0.05, w * 0.7, gy - (hash01(i, k, 7) - 0.5) * 0.05, w - 0.1, gy);
        ctx.stroke();
      }
      // 拼缝错位
      const joints = 2 + Math.round(hash01(i, 9) * 3);
      for (let j = 0; j < joints; j++) {
        const jx = (hash01(i, j, 10) * (w - 0.4)) + 0.2;
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = floor.seam;
        ctx.lineWidth = 0.01;
        ctx.beginPath();
        ctx.moveTo(jx, y);
        ctx.lineTo(jx, y + plank);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // 单个深色木结/钉眼
    for (let i = 0; i < 8; i++) {
      const x = hash01(i, 12) * w;
      const y = hash01(i, 13) * h;
      ctx.fillStyle = rgba(floor.seam, 0.5);
      ctx.beginPath();
      ctx.ellipse(x, y, 0.028, 0.012, 0, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawFloorGrid(ctx, layout, room, theme) {
  const { roomW: w, roomH: h } = layout;
  ctx.save();
  // 淡淡的粉笔网格，帮助看清可建造格
  for (let x = 1; x < w; x++) {
    const a = project(layout, x, 0);
    const b = project(layout, x, h);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = 'rgba(236,222,192,0.085)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y + 1.2);
    ctx.lineTo(b.x, b.y + 1.2);
    ctx.strokeStyle = 'rgba(20,14,9,0.16)';
    ctx.stroke();
  }
  for (let y = 1; y < h; y++) {
    const a = project(layout, 0, y);
    const b = project(layout, w, y);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = 'rgba(236,222,192,0.07)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }
  // 每个交点的小十字刻痕
  for (let x = 1; x < w; x++) {
    for (let y = 1; y < h; y++) {
      const p = project(layout, x, y);
      ctx.beginPath();
      ctx.moveTo(p.x - 2, p.y);
      ctx.lineTo(p.x + 2, p.y);
      ctx.moveTo(p.x, p.y - 1);
      ctx.lineTo(p.x, p.y + 1);
      ctx.strokeStyle = 'rgba(236,222,192,0.1)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawFloorRug(ctx, layout, room, theme, rng) {
  const bed = room.bed;
  if (!bed) return;
  const x0 = bed.x + 0.02;
  const y0 = bed.y + 0.02;
  const x1 = bed.x + bed.w + 0.22;
  const y1 = bed.y + bed.h + 0.2;
  const pts = [
    project(layout, x0, y0), project(layout, x1, y0),
    project(layout, x1, y1), project(layout, x0, y1),
  ];
  ctx.save();
  tracePolygon(ctx, pts);
  const c = project(layout, x0, y0);
  const g = ctx.createLinearGradient(0, c.y, 0, c.y + 180 * layout.scale);
  g.addColorStop(0, rgba(theme.rug, 0.5));
  g.addColorStop(1, rgba(darken(theme.rug, 0.35), 0.62));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = rgba('#e8d8b8', 0.16);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // 编织纹
  ctx.clip();
  for (let i = 0; i < 14; i++) {
    const t = i / 14;
    const a = project(layout, x0, lerp(y0, y1, t));
    const b = project(layout, x1, lerp(y0, y1, t));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = rgba('#f3e7cf', 0.05 + hash01(i, 2) * 0.04);
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  // 流苏边
  for (let i = 0; i < 12; i++) {
    const t = i / 12;
    const p = project(layout, lerp(x0, x1, t), y1 + 0.02);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + (hash01(i, 4) - 0.5) * 3, p.y + 4 + hash01(i, 5) * 3);
    ctx.strokeStyle = rgba(theme.rug, 0.6);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawFloorWear(ctx, layout, room, theme, rng) {
  const door = layout.door;
  const bed = room.bed;
  const from = project(layout, bed.x + bed.w * 0.8, bed.y + bed.h * 0.9);
  const to = { x: door.center.x, y: door.center.y + 3 };
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const x = lerp(from.x, to.x, t) + (hash01(i, 3) - 0.5) * 16;
    const y = lerp(from.y, to.y, t) + (hash01(i, 4) - 0.5) * 8;
    ctx.fillStyle = rgba(theme.floor.stain, 0.05 + hash01(i, 5) * 0.05);
    ctx.beginPath();
    ctx.ellipse(x, y, 8 + hash01(i, 6) * 8, 3 + hash01(i, 7) * 3, hash01(i, 8) * 0.6, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawFloorStains(ctx, layout, room, theme, rng) {
  const { roomW: w, roomH: h } = layout;
  ctx.save();
  // 化学滴落的彩色渍
  const accents = [theme.accent, theme.lampSoft, '#8fd8ff'];
  for (let i = 0; i < 7; i++) {
    const x = 0.5 + hash01(i, 21) * (w - 1);
    const y = 0.4 + hash01(i, 22) * (h - 0.8);
    const p = project(layout, x, y);
    const r = (8 + hash01(i, 23) * 18) * layout.scale;
    stainShape(ctx, p.x, p.y, r, accents[i % accents.length], 0.06 + hash01(i, 24) * 0.07, seed(i));
  }
  // 烧灼痕迹
  for (let i = 0; i < 3; i++) {
    const x = 1 + hash01(i, 31) * (w - 2);
    const y = 0.8 + hash01(i, 32) * (h - 1.5);
    const p = project(layout, x, y);
    ctx.fillStyle = 'rgba(14,10,7,0.22)';
    blobPath(ctx, p.x, p.y, 11 * layout.scale, 5 * layout.scale, i + 3, 0, 0.4, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,20,12,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // 纸屑与胶带
  for (let i = 0; i < 9; i++) {
    const x = 0.4 + hash01(i, 41) * (w - 0.8);
    const y = 0.4 + hash01(i, 42) * (h - 0.8);
    const p = project(layout, x, y);
    paperTag(ctx, p.x, p.y, 10 + hash01(i, 43) * 12, 5 + hash01(i, 44) * 6, hash01(i, 45) * 2 - 1, {
      fill: i % 3 === 0 ? 'rgba(220,206,176,0.65)' : 'rgba(196,186,166,0.45)',
      tear: 1,
      shadowBlur: 1,
    });
  }
  ctx.restore();
  function seed(i) {
    return Math.floor(hash01(i, 77) * 9999) + 1;
  }
}

function drawFloorLightPools(ctx, layout, room, theme, spec) {
  const bed = room.bed;
  const lamp = layout.lamp;
  // 顶灯暖光
  lightPool(ctx, lamp.anchor.x, lamp.anchor.y, 210 * layout.scale, 105 * layout.scale, theme.lamp, 0.2);
  lightPool(ctx, lamp.anchor.x, lamp.anchor.y, 90 * layout.scale, 46 * layout.scale, theme.lamp, 0.16);
  // 床边的暖光
  if (bed) {
    const bp = project(layout, bed.x + bed.w * 0.55, bed.y + bed.h * 0.5);
    lightPool(ctx, bp.x, bp.y, 110 * layout.scale, 55 * layout.scale, theme.lampSoft, 0.1);
  }
  // 窗光：冷色光斑 + 斜向光带
  const win = spec.window;
  const winCenter = project(layout, win.x + win.w * 0.5, 0);
  const floorTarget = project(layout, win.x + win.w * 0.5 - 0.5, 2.2);
  const beamAlpha = theme.id === 'moon' || win.style === 'balcony' ? 0.11 : 0.07;
  const beam = [
    { x: winCenter.x - win.w * HW * layout.scale * 0.5, y: winCenter.y - 8 },
    { x: winCenter.x + win.w * HW * layout.scale * 0.5, y: winCenter.y - 8 },
    { x: floorTarget.x + 170 * layout.scale, y: floorTarget.y + 46 * layout.scale },
    { x: floorTarget.x - 150 * layout.scale, y: floorTarget.y + 46 * layout.scale },
  ];
  const g = ctx.createLinearGradient(winCenter.x, winCenter.y, floorTarget.x, floorTarget.y + 40);
  g.addColorStop(0, rgba(theme.window.light, beamAlpha));
  g.addColorStop(1, 'rgba(120,160,200,0)');
  ctx.save();
  tracePolygon(ctx, beam);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  lightPool(ctx, floorTarget.x, floorTarget.y + 20 * layout.scale, 150 * layout.scale, 70 * layout.scale, theme.window.light, beamAlpha * 1.4);
  // 门前的地垫
  const door = layout.door;
  const mat = [
    project(layout, door.tileX - 1.05, layout.roomH - 0.34),
    project(layout, door.tileX + 1.05, layout.roomH - 0.34),
    project(layout, door.tileX + 1.05, layout.roomH - 0.06),
    project(layout, door.tileX - 1.05, layout.roomH - 0.06),
  ];
  ctx.save();
  tracePolygon(ctx, mat);
  ctx.fillStyle = 'rgba(58,46,32,0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(230,210,170,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

// ---------------- 剖切矮墙 ----------------

function drawCutWalls(ctx, layout, room, theme, rng, spec) {
  const s = layout.scale;
  const wall = theme.wall;

  // 南墙（近侧，低矮切口）
  ctx.save();
  applyDown(ctx, southCutDown(layout));
  const len = layout.roomW;
  ctx.fillStyle = theme.wall.base;
  ctx.fillRect(0, 0, len, CUT_H);
  const g = ctx.createLinearGradient(0, 0, 0, CUT_H * s);
  g.addColorStop(0, rgba('#f3e7cf', 0.16));
  g.addColorStop(0.28, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, len, CUT_H);
  // 剖面的层板（纸板/石膏/木饰面）
  ctx.fillStyle = 'rgba(240,226,196,0.32)';
  ctx.fillRect(0, 0, len, 1.2);
  ctx.fillStyle = rgba(wall.plaster, 0.5);
  ctx.fillRect(0, 1.2, len, 1.6);
  ctx.fillStyle = rgba(wall.wainscotDark, 0.85);
  ctx.fillRect(0, 2.4, len, 1.1);
  ctx.fillStyle = rgba(wall.wainscot, 0.9);
  ctx.fillRect(0, CUT_H - 10, len, 9);
  for (let x = 0; x < len; x += 0.34) {
    ctx.strokeStyle = rgba(wall.wainscotDark, 0.5);
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, CUT_H - 10);
    ctx.lineTo(x, CUT_H - 1);
    ctx.stroke();
  }
  // 门两侧的警示条
  const doorX = layout.door.tileX;
  drawHazard(ctx, doorX - 1.55, CUT_H - 10, 0.55, 9, theme);
  drawHazard(ctx, doorX + 1.0, CUT_H - 10, 0.55, 9, theme);
  // 墙面的污渍与磕碰
  for (let i = 0; i < 5; i++) {
    const x = hash01(i, 1) * len;
    ctx.fillStyle = rgba(wall.stain, 0.1 + hash01(i, 2) * 0.1);
    ctx.beginPath();
    ctx.ellipse(x, 4 + hash01(i, 3) * 6, 0.16 + hash01(i, 4) * 0.3, 2 + hash01(i, 5) * 3, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // 东墙切口
  ctx.save();
  applyDown(ctx, eastCutDown(layout));
  const lenE = layout.roomH;
  ctx.fillStyle = darken(theme.wall.base, 0.12);
  ctx.fillRect(0, 0, lenE, CUT_H);
  ctx.fillStyle = 'rgba(240,226,196,0.26)';
  ctx.fillRect(0, 0, lenE, 1.2);
  ctx.fillStyle = rgba(wall.plaster, 0.4);
  ctx.fillRect(0, 1.2, lenE, 1.6);
  ctx.fillStyle = rgba(wall.wainscotDark, 0.85);
  ctx.fillRect(0, CUT_H - 9, lenE, 8);
  ctx.restore();

  // 门槛钢板：让门与走廊衔接
  const door = layout.door;
  const th = [
    project(layout, door.tileX - DOOR_HALF_TILES - 0.1, layout.roomH - 0.2),
    project(layout, door.tileX + DOOR_HALF_TILES + 0.1, layout.roomH - 0.2),
    project(layout, door.tileX + DOOR_HALF_TILES + 0.1, layout.roomH + 0.2),
    project(layout, door.tileX - DOOR_HALF_TILES - 0.1, layout.roomH + 0.2),
  ];
  ctx.save();
  tracePolygon(ctx, th);
  ctx.fillStyle = 'rgba(62,63,60,0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(18,18,16,0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const p = project(layout, door.tileX - 0.7 + i * 0.35, layout.roomH);
    ctx.fillStyle = 'rgba(180,170,140,0.25)';
    ctx.fillRect(p.x - 1, p.y - 2, 2, 6);
  }
  ctx.restore();

  drawFloorSlab(ctx, layout, theme);
}

// 地板剖面的厚度：让房间像被整体“切”出来的纸板模型，而不是漂浮的色块。
function drawFloorSlab(ctx, layout, theme) {
  const s = layout.scale;
  const slab = 14 * s;
  const southA = project(layout, 0, layout.roomH);
  const southB = project(layout, layout.roomW, layout.roomH);
  const eastA = project(layout, layout.roomW, 0);
  const eastB = project(layout, layout.roomW, layout.roomH);
  ctx.save();
  // 南侧切口
  const southPoly = [
    southA,
    southB,
    { x: southB.x, y: southB.y + slab },
    { x: southA.x, y: southA.y + slab },
  ];
  const sg = ctx.createLinearGradient(0, southA.y, 0, southA.y + slab);
  sg.addColorStop(0, 'rgba(96,78,56,1)');
  sg.addColorStop(0.35, 'rgba(62,48,34,1)');
  sg.addColorStop(1, 'rgba(28,21,14,1)');
  fillPoly(ctx, southPoly, sg);
  ctx.strokeStyle = 'rgba(12,9,6,0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(southA.x, southA.y + slab);
  ctx.lineTo(southB.x, southB.y + slab);
  ctx.stroke();
  // 层板线
  ctx.strokeStyle = 'rgba(226,210,176,0.12)';
  ctx.lineWidth = 0.8;
  for (let k = 1; k < 3; k++) {
    ctx.beginPath();
    ctx.moveTo(southA.x, southA.y + (slab / 3) * k);
    ctx.lineTo(southB.x, southB.y + (slab / 3) * k);
    ctx.stroke();
  }
  // 东侧切口
  const eastPoly = [
    eastA,
    eastB,
    { x: eastB.x, y: eastB.y + slab },
    { x: eastA.x, y: eastA.y + slab },
  ];
  const eg = ctx.createLinearGradient(0, eastA.y, 0, eastA.y + slab);
  eg.addColorStop(0, 'rgba(82,66,48,1)');
  eg.addColorStop(1, 'rgba(24,18,12,1)');
  fillPoly(ctx, eastPoly, eg);
  ctx.strokeStyle = 'rgba(226,210,176,0.1)';
  ctx.lineWidth = 0.8;
  for (let k = 1; k < 3; k++) {
    ctx.beginPath();
    ctx.moveTo(eastA.x, eastA.y + (slab / 3) * k);
    ctx.lineTo(eastB.x, eastB.y + (slab / 3) * k);
    ctx.stroke();
  }
  // 投射到走廊上的阴影
  const shadow = [
    southA, southB,
    { x: southB.x - 8 * s, y: southB.y + slab + 18 * s },
    { x: southA.x - 8 * s, y: southA.y + slab + 18 * s },
  ];
  const shg = ctx.createLinearGradient(0, southA.y + slab, 0, southA.y + slab + 26 * s);
  shg.addColorStop(0, 'rgba(4,6,9,0.55)');
  shg.addColorStop(1, 'rgba(4,6,9,0)');
  fillPoly(ctx, shadow, shg);
  ctx.restore();
}

function drawHazard(ctx, x, y, w, h, theme) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = 'rgba(160,140,66,0.75)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(20,16,10,0.7)';
  for (let i = -1; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * 0.2, y + h);
    ctx.lineTo(x + i * 0.2 + 0.1, y + h);
    ctx.lineTo(x + i * 0.2 + 0.35, y);
    ctx.lineTo(x + i * 0.2 + 0.25, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ---------------- 背墙 ----------------

function drawBackWalls(ctx, layout, room, theme, rng, spec) {
  const s = layout.scale;
  const wallH = WALL_H * s;
  // 把背墙的绘制裁剪到两面墙的并集内，避免任何花纹/线条溢出到房间外。
  const topA = project(layout, 0, 0);
  const topB = project(layout, room.w, 0);
  const baseB = project(layout, room.w, 0);
  const baseA = project(layout, 0, 0);
  const baseW = project(layout, 0, room.h);
  const clipPoly = [
    { x: topA.x - 4, y: topA.y - wallH - 10 },
    { x: topB.x + 4, y: topB.y - wallH - 10 },
    { x: baseB.x + 4, y: baseB.y + 2 },
    { x: baseA.x, y: baseA.y + 2 },
    { x: baseW.x - 4, y: baseW.y + 2 },
    { x: baseW.x - 4, y: baseW.y - wallH - 10 },
  ];
  ctx.save();
  tracePolygon(ctx, clipPoly);
  ctx.clip();
  // 北墙
  ctx.save();
  applyDown(ctx, northWallDown(layout));
  drawWallPanel(ctx, layout.roomW, WALL_H, theme, spec, 'north');
  drawWindow(ctx, spec.window, theme, spec, layout);
  if (spec.wallProps.includes('poster')) drawPosterOnWall(ctx, 0.45, 18, 1.15, 34, theme, spec, 'poster-a');
  if (spec.wallProps.includes('pipes')) drawPipesOnWall(ctx, layout.roomW, theme, spec, 'north');
  if (spec.wallProps.includes('mirror')) drawMirrorOnWall(ctx, Math.min(2.7, layout.roomW * 0.5), 22, 0.95, 44, theme, spec);
  drawWallClock(ctx, layout.roomW * 0.26, 24, theme, spec);
  drawWallConduit(ctx, layout.roomW, theme, spec, 'north');
  drawWallSconce(ctx, layout.roomW - 1.55, 26, theme, spec);
  ctx.restore();

  // 西墙
  ctx.save();
  applyDown(ctx, westWallDown(layout));
  drawWallPanel(ctx, layout.roomH, WALL_H, theme, spec, 'west');
  if (spec.wallProps.includes('poster')) drawPosterOnWall(ctx, 0.5, 24, 1.05, 32, theme, spec, 'poster-b');
  if (spec.wallProps.includes('pipes')) drawPipesOnWall(ctx, layout.roomH, theme, spec, 'west');
  if (spec.wallProps.includes('bookshelf')) drawBookshelfOnWall(ctx, 0.55, WALL_H - 70, 2.2, 66, theme, spec);
  if (spec.wallProps.includes('poster')) {
    drawWallNotes(ctx, layout.roomH * 0.62, 20, theme, spec);
  }
  if (spec.wallProps.includes('pipes')) drawWallNotes(ctx, 2.4, 28, theme, spec);
  drawWallConduit(ctx, layout.roomH, theme, spec, 'west');
  drawWallSconce(ctx, 0.55, 24, theme, spec, true);
  ctx.restore();

  drawWallCaps(ctx, layout, room, theme);
  drawCornerPost(ctx, layout, theme);
  ctx.restore();
}

// 墙体顶部的剖切帽：让背墙读起来像被剖开的纸板模型，而不是倾斜的屋顶。
function drawWallCaps(ctx, layout, room, theme) {
  const s = layout.scale;
  const wallH = WALL_H * s;
  const capH = 6 * s;
  // 北墙顶边
  const nA = project(layout, 0, 0);
  const nB = project(layout, room.w, 0);
  const northQuad = [
    { x: nA.x, y: nA.y - wallH },
    { x: nB.x, y: nB.y - wallH },
    { x: nB.x + 2 * s, y: nB.y - wallH - capH },
    { x: nA.x + 2 * s, y: nA.y - wallH - capH },
  ];
  fillPoly(ctx, northQuad, 'rgba(46,36,24,0.98)');
  strokePoly(ctx, northQuad, 'rgba(12,9,6,0.8)', 1);
  line(ctx, nA.x, nA.y - wallH, nB.x, nB.y - wallH, 'rgba(236,220,188,0.25)', 1.1);
  // 西墙顶边
  const wB = project(layout, 0, room.h);
  const westQuad = [
    { x: nA.x, y: nA.y - wallH },
    { x: wB.x, y: wB.y - wallH },
    { x: wB.x - 2 * s, y: wB.y - wallH - capH },
    { x: nA.x - 2 * s, y: nA.y - wallH - capH },
  ];
  fillPoly(ctx, westQuad, 'rgba(38,29,19,0.98)');
  strokePoly(ctx, westQuad, 'rgba(12,9,6,0.8)', 1);
  line(ctx, nA.x, nA.y - wallH, wB.x, wB.y - wallH, 'rgba(236,220,188,0.22)', 1.1);
}

function drawCornerPost(ctx, layout, theme) {
  const s = layout.scale;
  const corner = project(layout, 0, 0);
  const topY = corner.y - WALL_H * s;
  ctx.save();
  // 转角立柱
  const g = ctx.createLinearGradient(corner.x - 3, 0, corner.x + 4, 0);
  g.addColorStop(0, 'rgba(24,17,11,0.9)');
  g.addColorStop(0.5, 'rgba(74,56,38,0.95)');
  g.addColorStop(1, 'rgba(20,14,9,0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(corner.x - 3.5, topY - 2, 7, corner.y - topY + 2);
  ctx.strokeStyle = 'rgba(226,210,176,0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(corner.x - 3.5, topY);
  ctx.lineTo(corner.x - 3.5, corner.y);
  ctx.stroke();
  ctx.restore();
}

function drawWallSconce(ctx, x, y, theme, spec, side) {
  ctx.save();
  ctx.translate(x, y);
  // 灯座与支架
  ctx.fillStyle = 'rgba(52,42,30,0.95)';
  ctx.fillRect(-1.6, -1, 3.2, 2);
  ctx.strokeStyle = 'rgba(120,96,60,0.9)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(0, 1);
  ctx.quadraticCurveTo(0, 5, -3, 6.5);
  ctx.stroke();
  // 搪瓷灯罩
  ctx.fillStyle = 'rgba(94,80,58,0.98)';
  ctx.beginPath();
  ctx.moveTo(-7, 11);
  ctx.lineTo(7, 11);
  ctx.lineTo(10, 6.5);
  ctx.lineTo(-10, 6.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(24,17,11,0.8)';
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,199,90,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 11.4, 8.5, 1.7, 0, 0, TAU);
  ctx.fill();
  // 灯泡
  ctx.fillStyle = 'rgba(255,232,180,0.9)';
  ctx.beginPath();
  ctx.arc(0, 12.4, 1.5, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawWallConduit(ctx, lengthTiles, theme, spec, side) {
  const y = 6.5;
  ctx.save();
  // 电缆
  ctx.strokeStyle = 'rgba(28,24,20,0.75)';
  ctx.lineWidth = 0.42;
  ctx.beginPath();
  ctx.moveTo(0.05, y);
  ctx.lineTo(lengthTiles - 0.05, y + 0.4);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(226,210,176,0.06)';
  ctx.lineWidth = 0.16;
  ctx.stroke();
  // 管卡
  for (let x = 0.35; x < lengthTiles - 0.2; x += 0.62) {
    ctx.fillStyle = 'rgba(52,46,38,0.85)';
    ctx.fillRect(x, y - 0.7, 0.16, 1.6);
  }
  // 墙上的接线盒
  const bx = Math.max(0.7, lengthTiles * 0.66);
  ctx.fillStyle = 'rgba(74,68,58,0.95)';
  ctx.fillRect(bx, y - 2.2, 2.1, 3.4);
  ctx.strokeStyle = 'rgba(20,16,12,0.7)';
  ctx.lineWidth = 0.25;
  ctx.strokeRect(bx, y - 2.2, 2.1, 3.4);
  ctx.fillStyle = 'rgba(226,210,176,0.2)';
  ctx.fillRect(bx + 0.3, y - 1.6, 1.5, 0.32);
  ctx.restore();
}

function drawWallPanel(ctx, lengthTiles, height, theme, spec, side) {
  const wall = theme.wall;
  const s = 1; // 局部单位
  ctx.save();
  // 底色 + 明暗渐变
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, darken(wall.base, 0.18));
  g.addColorStop(0.35, wall.base);
  g.addColorStop(0.8, mixColor(wall.base, wall.light, 0.25));
  g.addColorStop(1, darken(wall.base, 0.12));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, lengthTiles, height);

  const pattern = theme.pattern;
  if (pattern === 'stripe') {
    for (let x = 0.1; x < lengthTiles; x += 0.24) {
      ctx.fillStyle = rgba(wall.stripe, 0.36);
      ctx.fillRect(x, 0, 0.085, height - 16);
      ctx.fillStyle = rgba(wall.light, 0.12);
      ctx.fillRect(x + 0.085, 0, 0.014, height - 16);
    }
    // 墙纸接缝与老化
    for (let x = 0.96; x < lengthTiles; x += 0.96) {
      ctx.fillStyle = rgba(wall.shadow, 0.3);
      ctx.fillRect(x, 0, 0.018, height - 16);
    }
  } else if (pattern === 'peel') {
    // 剥落的旧漆：漆面 -> 石膏
    for (let i = 0; i < 7; i++) {
      const cx = 0.3 + hash01(spec.seed, i, 1) * (lengthTiles - 0.6);
      const cy = 10 + hash01(spec.seed, i, 2) * (height - 34);
      const rx = 0.18 + hash01(spec.seed, i, 3) * 0.45;
      const ry = 6 + hash01(spec.seed, i, 4) * 14;
      plasterPatch(ctx, cx, cy, rx, ry, wall.plaster, 0.55 + hash01(i, 5) * 0.2, Math.floor(hash01(i, 6) * 999));
      ctx.strokeStyle = rgba(wall.shadow, 0.5);
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
      ctx.stroke();
      // 从剥落处向下的水渍
      ctx.fillStyle = rgba(wall.stain, 0.14);
      ctx.fillRect(cx - 0.03, cy + ry * 0.4, 0.06, height - cy - ry * 0.4);
    }
    // 大块霉菌
    for (let i = 0; i < 14; i++) {
      const x = hash01(spec.seed, i, 21) * lengthTiles;
      const y = height - 24 + hash01(spec.seed, i, 22) * 22;
      ctx.fillStyle = rgba('#2f3b2c', 0.12 + hash01(i, 23) * 0.12);
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + hash01(i, 24) * 2.4, 0, TAU);
      ctx.fill();
    }
  } else if (pattern === 'plaster') {
    for (let i = 0; i < 16; i++) {
      const cx = hash01(spec.seed, i, 1) * lengthTiles;
      const cy = hash01(spec.seed, i, 2) * (height - 18);
      const rx = 0.3 + hash01(spec.seed, i, 3) * 0.9;
      const ry = 3 + hash01(spec.seed, i, 4) * 11;
      plasterPatch(ctx, cx, cy, rx, ry, i % 2 ? wall.plaster : wall.shadow, 0.06 + hash01(i, 5) * 0.07, Math.floor(hash01(i, 6) * 999));
    }
    // 雨水渗漏的竖向痕迹
    for (let i = 0; i < 5; i++) {
      const x = 0.4 + hash01(spec.seed, i, 31) * (lengthTiles - 0.8);
      const g2 = ctx.createLinearGradient(0, 0, 0, height);
      g2.addColorStop(0, rgba(wall.stain, 0.22));
      g2.addColorStop(1, rgba(wall.stain, 0));
      ctx.fillStyle = g2;
      ctx.fillRect(x, 0, 0.1 + hash01(i, 32) * 0.3, height);
    }
  } else if (pattern === 'damask') {
    // 尽头房：旧暗花墙纸
    for (let x = 0.35; x < lengthTiles; x += 0.7) {
      for (let y = 16; y < height - 22; y += 12) {
        const off = (Math.round(x / 0.7) % 2) * 6;
        ctx.save();
        ctx.translate(x, y + off);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = rgba(wall.stripe, 0.34);
        ctx.fillRect(-1.6, -1.6, 3.2, 3.2);
        ctx.fillStyle = rgba(wall.light, 0.12);
        ctx.fillRect(-0.8, -0.8, 1.6, 1.6);
        ctx.restore();
      }
    }
    for (let x = 0.94; x < lengthTiles; x += 0.94) {
      ctx.fillStyle = rgba(wall.shadow, 0.25);
      ctx.fillRect(x, 0, 0.016, height - 16);
    }
  } else if (pattern === 'planks') {
    // 阁楼：木板墙
    for (let y = 0, i = 0; y < height; y += 9.5, i++) {
      ctx.fillStyle = i % 2 ? wall.stripe : wall.base;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(0, y, lengthTiles, 9.5);
      ctx.globalAlpha = 1;
      ctx.fillStyle = rgba(wall.shadow, 0.5);
      ctx.fillRect(0, y + 9.1, lengthTiles, 0.5);
      // 木纹
      ctx.strokeStyle = rgba(wall.light, 0.12);
      ctx.lineWidth = 0.35;
      for (let k = 0; k < 2; k++) {
        ctx.beginPath();
        ctx.moveTo(hash01(i, k) * lengthTiles * 0.3, y + 2 + k * 3);
        ctx.quadraticCurveTo(lengthTiles * 0.5, y + 2 + k * 3 + (hash01(i, k, 2) - 0.5) * 3, lengthTiles, y + 2 + k * 3);
        ctx.stroke();
      }
    }
    for (let x = 1.4; x < lengthTiles; x += 1.6) {
      ctx.fillStyle = rgba(wall.wainscotDark, 0.55);
      ctx.fillRect(x, 0, 0.22, height);
      ctx.fillStyle = rgba(wall.light, 0.14);
      ctx.fillRect(x + 0.22, 0, 0.03, height);
    }
  }

  // 墙脚的灰渍和顶部的烟熏
  const gTop = ctx.createLinearGradient(0, 0, 0, 16);
  gTop.addColorStop(0, 'rgba(8,6,4,0.42)');
  gTop.addColorStop(1, 'rgba(8,6,4,0)');
  ctx.fillStyle = gTop;
  ctx.fillRect(0, 0, lengthTiles, 16);
  const gBottom = ctx.createLinearGradient(0, height - 20, 0, height);
  gBottom.addColorStop(0, 'rgba(8,6,4,0)');
  gBottom.addColorStop(1, 'rgba(8,6,4,0.32)');
  ctx.fillStyle = gBottom;
  ctx.fillRect(0, height - 20, lengthTiles, 20);

  // 护墙板
  ctx.fillStyle = wall.wainscot;
  ctx.fillRect(0, height - 16, lengthTiles, 16);
  const wg = ctx.createLinearGradient(0, height - 16, 0, height);
  wg.addColorStop(0, rgba(wall.light, 0.14));
  wg.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = wg;
  ctx.fillRect(0, height - 16, lengthTiles, 16);
  for (let x = 0.06; x < lengthTiles; x += 0.52) {
    ctx.strokeStyle = rgba(wall.wainscotDark, 0.7);
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    ctx.moveTo(x, height - 14.5);
    ctx.lineTo(x, height - 2.5);
    ctx.stroke();
    ctx.strokeStyle = rgba(wall.light, 0.1);
    ctx.beginPath();
    ctx.moveTo(x + 0.45, height - 14.5);
    ctx.lineTo(x + 0.45, height - 2.5);
    ctx.stroke();
  }
  // 压条
  ctx.fillStyle = rgba(wall.trim, 0.9);
  ctx.fillRect(0, height - 17.2, lengthTiles, 1.5);
  ctx.fillStyle = 'rgba(255,240,205,0.14)';
  ctx.fillRect(0, height - 17.2, lengthTiles, 0.4);
  ctx.fillStyle = rgba(wall.wainscotDark, 0.9);
  ctx.fillRect(0, height - 1.6, lengthTiles, 1.6);

  // 随机钉孔、划痕
  for (let i = 0; i < 14; i++) {
    const x = hash01(spec.seed, i, 41) * lengthTiles;
    const y = 4 + hash01(spec.seed, i, 42) * (height - 26);
    ctx.fillStyle = 'rgba(20,14,8,0.35)';
    ctx.beginPath();
    ctx.arc(x, y, 0.12, 0, TAU);
    ctx.fill();
  }
  for (let i = 0; i < 3; i++) {
    const x = hash01(spec.seed, i, 51) * lengthTiles;
    const y = 20 + hash01(spec.seed, i, 52) * (height - 40);
    ctx.strokeStyle = 'rgba(20,14,8,0.2)';
    ctx.lineWidth = 0.18;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 2 + hash01(i, 53) * 4, y + 1 + hash01(i, 54) * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWindow(ctx, spec, theme, roomSpec, layout) {
  const { x, y, w, h, style } = spec;
  const win = theme.window;
  const balcony = style === 'balcony';
  ctx.save();
  // 窗框的凹陷阴影
  ctx.fillStyle = 'rgba(8,6,4,0.4)';
  ctx.fillRect(x - 1.2, y - 1.2, w + 2.4, h + 2.4);
  // 外框
  ctx.fillStyle = win.frame;
  ctx.fillRect(x - 0.9, y - 0.9, w + 1.8, h + 1.8);
  ctx.fillStyle = rgba(lighten(win.frame, 0.15), 0.8);
  ctx.fillRect(x - 0.9, y - 0.9, w + 1.8, 0.5);

  // 夜空
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, win.skyTop);
  g.addColorStop(0.72, win.skyBottom);
  g.addColorStop(1, mixColor(win.skyBottom, win.light, 0.18));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);

  // 月亮与光晕
  if (win.hasMoon) {
    const mx = x + w * (balcony ? 0.72 : 0.3);
    const my = y + h * 0.26;
    const mr = Math.min(w, h) * 0.09;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 5);
    halo.addColorStop(0, rgba(win.moon, 0.28));
    halo.addColorStop(0.5, rgba(win.moon, 0.08));
    halo.addColorStop(1, rgba(win.moon, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.fillStyle = win.moon;
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(190,170,130,0.35)';
    ctx.beginPath();
    ctx.arc(mx - mr * 0.25, my - mr * 0.2, mr * 0.22, 0, TAU);
    ctx.arc(mx + mr * 0.3, my + mr * 0.25, mr * 0.14, 0, TAU);
    ctx.fill();
  }
  // 远处楼影
  ctx.fillStyle = win.city;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  let bx = x;
  const baseY = y + h * (balcony ? 0.82 : 0.72);
  while (bx < x + w) {
    const bw = w * (0.08 + hash01(bx, 3) * 0.14);
    const bh = h * (0.12 + hash01(bx, 5) * 0.26);
    ctx.lineTo(bx, baseY - bh);
    ctx.lineTo(bx + bw, baseY - bh);
    bx += bw;
  }
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
  // 零星窗户微光
  for (let i = 0; i < 5; i++) {
    const lx = x + hash01(i, 7) * w;
    const ly = baseY - h * (0.08 + hash01(i, 8) * 0.18);
    ctx.fillStyle = rgba(win.light, 0.18 + hash01(i, 9) * 0.16);
    ctx.fillRect(lx, ly, 0.7, 0.5);
  }
  // 雨丝
  ctx.strokeStyle = rgba(win.light, 0.16);
  ctx.lineWidth = 0.16;
  for (let i = 0; i < 12; i++) {
    const rx = x + hash01(i, 11) * w;
    ctx.beginPath();
    ctx.moveTo(rx, y + hash01(i, 12) * h * 0.8);
    ctx.lineTo(rx - 0.8, y + hash01(i, 12) * h * 0.8 + 4 + hash01(i, 13) * 4);
    ctx.stroke();
  }

  // 窗格
  ctx.fillStyle = win.frame;
  const mullions = balcony ? 3 : 2;
  for (let i = 1; i < mullions; i++) {
    ctx.fillRect(x + (w / mullions) * i - 0.22, y, 0.44, h);
  }
  if (!balcony) {
    ctx.fillRect(x, y + h * 0.52, w, 0.4);
  } else {
    // 阳台栏杆与玻璃门把手
    ctx.fillStyle = rgba(win.frame, 0.9);
    for (let i = 0; i <= 6; i++) {
      ctx.fillRect(x + (w / 6) * i - 0.12, y + h * 0.6, 0.24, h * 0.4);
    }
    ctx.fillRect(x, y + h * 0.6, w, 0.35);
    ctx.fillRect(x + w * 0.5 - 0.08, y + h * 0.46, 0.16, 2.2);
  }
  // 窗帘（两侧）
  ctx.fillStyle = rgba(theme.cloth, 0.85);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w * 0.16, y);
  ctx.quadraticCurveTo(x + w * 0.08, y + h * 0.5, x + w * 0.14, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + w, y);
  ctx.lineTo(x + w * 0.86, y);
  ctx.quadraticCurveTo(x + w * 0.94, y + h * 0.5, x + w * 0.88, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
  // 窗台的灰与霜
  ctx.fillStyle = 'rgba(200,212,220,0.12)';
  ctx.fillRect(x - 0.9, y + h + 0.6, w + 1.8, 1.2);
  ctx.fillStyle = win.frame;
  ctx.fillRect(x - 1.1, y + h + 0.4, w + 2.2, 0.9);
  ctx.restore();
}

function drawPosterOnWall(ctx, x, y, w, h, theme, spec, variant) {
  const rng = rngFrom(hashString(`${spec.seed}|${variant}`));
  const angle = (rng() - 0.5) * 0.03;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(angle);
  paperTag(ctx, 0, 0, w, h, 0, {
    fill: variant.endsWith('b') ? '#c9bfa8' : '#ddd0b2',
    tear: 0.8,
    shadowBlur: 3,
    shadowOffsetY: 1.4,
  });
  // 胶带
  tapeStrip(ctx, -w * 0.36, -h * 0.5 + 1, Math.min(w * 0.24, 8), 2.4, -0.3, 'rgba(240,228,196,0.32)');
  tapeStrip(ctx, w * 0.34, -h * 0.48, Math.min(w * 0.22, 7), 2.2, 0.25, 'rgba(240,228,196,0.28)');
  // 内容：化学式涂鸦 / 警告图
  const ink = 'rgba(46,36,24,0.72)';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.3;
  if (variant.endsWith('a')) {
    drawText(ctx, '夜', 0, -h * 0.16, { size: h * 0.3, color: 'rgba(58,44,26,0.6)', weight: 700, font: FONT_SERIF });
    // 小烧瓶
    ctx.beginPath();
    ctx.moveTo(-w * 0.16, h * 0.1);
    ctx.lineTo(-w * 0.1, h * 0.22);
    ctx.lineTo(w * 0.02, h * 0.22);
    ctx.lineTo(w * 0.08, h * 0.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, h * 0.16, 0.8, 0, TAU);
    ctx.fillStyle = rgba(theme.accent, 0.4);
    ctx.fill();
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(-w * 0.38, h * 0.3 + i * 2.4);
      ctx.lineTo(w * 0.34 - rng() * 0.08, h * 0.3 + i * 2.4);
      ctx.strokeStyle = 'rgba(46,36,24,0.32)';
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.arc(0, -h * 0.04, h * 0.16, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.2);
    ctx.lineTo(0, h * 0.14);
    ctx.moveTo(-h * 0.1, h * 0.02);
    ctx.lineTo(h * 0.1, h * 0.02);
    ctx.stroke();
    drawText(ctx, '安全', 0, h * 0.3, { size: h * 0.13, color: 'rgba(58,44,26,0.55)', weight: 700 });
  }
  // 图钉
  rivet(ctx, 0, -h * 0.44, 0.9, 'rgba(120,40,30,0.8)', 'rgba(255,220,200,0.5)');
  ctx.restore();
}

function drawWallNotes(ctx, x, y, theme, spec) {
  for (let i = 0; i < 3; i++) {
    const px = x + i * 0.3;
    paperTag(ctx, px, y + i * 2.4, 0.22, 0.3, -0.06 + i * 0.03, {
      fill: 'rgba(224,212,184,0.75)',
      tear: 0.4,
      shadowBlur: 1,
    });
  }
}

function drawWallClock(ctx, x, y, theme, spec) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(12,9,6,0.4)';
  ctx.beginPath();
  ctx.arc(0, 0.8, 5.4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#d9c9a7';
  ctx.beginPath();
  ctx.arc(0, 0, 5.1, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,44,28,0.8)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 4.2, Math.sin(a) * 4.2);
    ctx.lineTo(Math.cos(a) * 4.7, Math.sin(a) * 4.7);
    ctx.strokeStyle = 'rgba(60,44,28,0.5)';
    ctx.lineWidth = 0.4;
    ctx.stroke();
  }
  // 指针指向 03:40
  ctx.strokeStyle = 'rgba(40,30,18,0.8)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(-Math.PI * 0.7) * 2.6, Math.sin(-Math.PI * 0.7) * 2.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(-Math.PI * 0.25) * 3.8, Math.sin(-Math.PI * 0.25) * 3.8);
  ctx.stroke();
  ctx.fillStyle = 'rgba(40,30,18,0.85)';
  ctx.beginPath();
  ctx.arc(0, 0, 0.5, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawPipesOnWall(ctx, lengthTiles, theme, spec, side) {
  const y = side === 'north' ? 13.5 : 15.5;
  ctx.save();
  // 主横管
  ctx.strokeStyle = 'rgba(78,88,84,0.95)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(0.1, y);
  ctx.lineTo(lengthTiles - 0.1, y);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(160,172,160,0.3)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(0.1, y - 0.6);
  ctx.lineTo(lengthTiles - 0.1, y - 0.6);
  ctx.stroke();
  // 吊卡
  for (let x = 0.5; x < lengthTiles; x += 1.15) {
    ctx.fillStyle = 'rgba(50,54,52,0.9)';
    ctx.fillRect(x - 0.2, y - 1.7, 0.4, 3.4);
    ctx.fillStyle = 'rgba(150,160,150,0.25)';
    ctx.fillRect(x - 0.2, y - 1.7, 0.4, 0.5);
  }
  // 阀门 + 压力表
  valveWheel(ctx, 0.85, y + 2.6, 1.6, 'rgba(120,100,70,0.9)', 0.4);
  ctx.strokeStyle = 'rgba(78,88,84,0.9)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0.85, y);
  ctx.lineTo(0.85, y + 2.6);
  ctx.stroke();
  gauge(ctx, Math.max(1.6, lengthTiles * 0.55), y + 4.2, 2.2, 0.42, { face: '#cfc3a4' });
  ctx.strokeStyle = 'rgba(78,88,84,0.8)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(Math.max(1.6, lengthTiles * 0.55), y);
  ctx.lineTo(Math.max(1.6, lengthTiles * 0.55), y + 2.2);
  ctx.stroke();
  // 漏水痕迹
  for (let i = 0; i < 4; i++) {
    const x = 0.6 + hash01(spec.seed, i, 61) * (lengthTiles - 1.2);
    const g = ctx.createLinearGradient(0, y, 0, y + 28);
    g.addColorStop(0, 'rgba(82,96,94,0.22)');
    g.addColorStop(1, 'rgba(82,96,94,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 0.25 + hash01(i, 62) * 0.5, 26);
  }
  ctx.restore();
}

function drawBookshelfOnWall(ctx, x, y, w, h, theme, spec) {
  ctx.save();
  ctx.translate(x, y);
  // 阴影
  ctx.fillStyle = 'rgba(10,7,4,0.45)';
  ctx.fillRect(1.2, 2, w, h);
  // 柜体
  ctx.fillStyle = 'rgba(52,38,24,0.98)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(92,68,42,0.9)';
  ctx.fillRect(0.5, 1.2, w - 1, h - 2.4);
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const ry = 2 + ((h - 6) / rows) * r;
    const rowH = (h - 6) / rows;
    // 隔板
    ctx.fillStyle = 'rgba(38,26,16,0.95)';
    ctx.fillRect(0.8, ry + rowH - 1.2, w - 1.6, 1.1);
    ctx.fillStyle = 'rgba(140,104,64,0.3)';
    ctx.fillRect(0.8, ry + rowH - 1.2, w - 1.6, 0.35);
    // 书
    let bx = 1.4;
    let bi = 0;
    while (bx < w - 2.2) {
      const bw = 0.5 + hash01(spec.seed, r, bi) * 1.1;
      const bh = rowH * (0.6 + hash01(spec.seed, r, bi, 2) * 0.3);
      const hue = ['#6d3f2f', '#3f5560', '#5c5133', '#433a52', '#2e4a3c'][bi % 5];
      ctx.fillStyle = hue;
      ctx.fillRect(bx, ry + rowH - 1.4 - bh, bw, bh);
      ctx.fillStyle = 'rgba(240,225,190,0.25)';
      ctx.fillRect(bx + 0.15, ry + rowH - 1.4 - bh * 0.7, bw - 0.3, 0.22);
      bx += bw + 0.12;
      bi++;
      if (hash01(spec.seed, r, bi, 9) > 0.86) bx += 1.1;
    }
    if (r === 1) {
      // 一只标本罐
      screenCylinderLocal(ctx, w * 0.7, ry + rowH - 1.4, 1.0, 0.5, 5.4, {
        side: 'rgba(170,200,190,0.28)',
        sideDark: 'rgba(120,160,150,0.25)',
        sideLight: 'rgba(190,220,210,0.2)',
        top: 'rgba(190,215,205,0.35)',
        rim: 'rgba(120,150,140,0.5)',
      });
      ctx.fillStyle = 'rgba(150,180,170,0.3)';
      ctx.beginPath();
      ctx.arc(w * 0.7, ry + rowH - 2.6, 0.9, 0, TAU);
      ctx.fill();
    }
    if (r === 2 && hash01(spec.seed, 5) > 0.4) {
      // 歪倒的书
      ctx.save();
      ctx.translate(w * 0.3, ry + rowH - 1.6);
      ctx.rotate(-0.18);
      ctx.fillStyle = '#704030';
      ctx.fillRect(0, -2.4, 1.4, 2.4);
      ctx.restore();
    }
  }
  // 柜顶的箱子/纸
  ctx.fillStyle = 'rgba(120,96,60,0.7)';
  ctx.fillRect(0.8, -1.6, w * 0.55, 1.6);
  ctx.restore();
}

// 画在墙面局部坐标系里的圆柱（底部中心 cx, cy）
function screenCylinderLocal(ctx, cx, cy, rx, ry, h, opts) {
  const topY = cy - h;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - rx, topY);
  ctx.lineTo(cx - rx, cy);
  ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(cx + rx, topY);
  ctx.ellipse(cx, topY, rx, ry, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.fillStyle = opts.side || 'rgba(160,190,180,0.3)';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, topY, rx, ry, 0, 0, TAU);
  ctx.fillStyle = opts.top || 'rgba(190,215,205,0.4)';
  ctx.fill();
  if (opts.rim) {
    ctx.strokeStyle = opts.rim;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  ctx.restore();
}

function drawMirrorOnWall(ctx, x, y, w, h, theme, spec) {
  ctx.save();
  ctx.translate(x, y);
  // 木质边框
  ctx.fillStyle = 'rgba(44,34,24,0.96)';
  ctx.fillRect(-1.2, -1.2, w + 2.4, h + 2.4);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, 'rgba(40,46,52,1)');
  g.addColorStop(0.4, 'rgba(72,82,90,1)');
  g.addColorStop(0.55, 'rgba(54,62,70,1)');
  g.addColorStop(1, 'rgba(30,35,40,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // 反射：房间的暖光点与门缝
  ctx.fillStyle = 'rgba(255,199,90,0.18)';
  ctx.beginPath();
  ctx.ellipse(w * 0.35, h * 0.6, w * 0.22, h * 0.1, -0.4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(230,240,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(w * 0.1, h * 0.15);
  ctx.lineTo(w * 0.55, h * 0.05);
  ctx.lineTo(w * 0.2, h * 0.5);
  ctx.closePath();
  ctx.fill();
  // 裂纹
  crackLine(ctx, w * 0.62, h * 0.1, 1.4, h * 0.42, 'rgba(220,230,235,0.35)', 0.2, 17, 2);
  // 边框高光
  ctx.strokeStyle = 'rgba(190,160,110,0.25)';
  ctx.lineWidth = 0.4;
  ctx.strokeRect(0.4, 0.4, w - 0.8, h - 0.8);
  ctx.restore();
}

function drawLaundry(ctx, layout, theme, rng, spec) {
  const { roomW: w, roomH: h } = layout;
  const a = project(layout, 0.3, 0.15);
  const b = project(layout, w - 0.6, 0.55);
  ctx.save();
  ctx.strokeStyle = 'rgba(222,210,184,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y - 60);
  ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - 44, b.x, b.y - 66);
  ctx.stroke();
  const clothColors = ['rgba(122,63,51,0.85)', 'rgba(96,116,126,0.85)', 'rgba(210,196,160,0.8)', 'rgba(78,98,72,0.85)'];
  for (let i = 0; i < 4; i++) {
    const t = 0.16 + i * 0.22;
    const x = lerp(a.x, b.x, t);
    const y = lerp(a.y - 60, b.y - 66, t) + Math.sin(t * Math.PI) * -5;
    const cw = 14 + hash01(i, 3) * 10;
    const chh = 20 + hash01(i, 4) * 16;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((hash01(i, 5) - 0.5) * 0.12);
    ctx.fillStyle = clothColors[i % clothColors.length];
    ctx.beginPath();
    ctx.moveTo(-cw * 0.5, 0);
    ctx.lineTo(cw * 0.5, 0);
    ctx.lineTo(cw * 0.45, chh);
    ctx.quadraticCurveTo(cw * 0.2, chh + 4, 0, chh + 1);
    ctx.quadraticCurveTo(-cw * 0.2, chh + 4, -cw * 0.45, chh);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,14,10,0.25)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawAtticSlope(ctx, layout, room, theme, rng, spec) {
  // 阁楼斜顶：覆盖两侧背墙的上半部分，深色木板 + 一根斜梁 + 圆窗
  ctx.save();
  const s = layout.scale;
  const nw = project(layout, 0, 0);
  const ne = project(layout, room.w, 0);
  const ww = project(layout, 0, room.h);
  const topY = nw.y - WALL_H * s;
  const slopeDrop = WALL_H * 0.46 * s;
  const poly = [
    { x: nw.x - 14 * s, y: topY - 16 * s },
    { x: ne.x + 20 * s, y: topY - 16 * s },
    { x: ne.x + 30 * s, y: topY + slopeDrop },
    { x: nw.x - 8 * s, y: topY + slopeDrop * 1.15 },
  ];
  // 斜面底色
  const g = ctx.createLinearGradient(0, topY, 0, topY + slopeDrop);
  g.addColorStop(0, 'rgba(30,22,14,0.98)');
  g.addColorStop(0.6, 'rgba(52,38,24,0.96)');
  g.addColorStop(1, 'rgba(24,17,11,0.9)');
  ctx.fillStyle = g;
  tracePolygon(ctx, poly);
  ctx.fill();
  // 木板条纹
  ctx.save();
  tracePolygon(ctx, poly);
  ctx.clip();
  for (let i = 0; i < 8; i++) {
    const t = i / 8;
    const y = topY - 16 * s + slopeDrop * 1.1 * t;
    ctx.strokeStyle = 'rgba(14,10,6,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(nw.x - 30 * s, y);
    ctx.lineTo(ne.x + 50 * s, y + 8 * s);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(150,116,74,0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(nw.x - 30 * s, y + 2);
    ctx.lineTo(ne.x + 50 * s, y + 8 * s + 2);
    ctx.stroke();
  }
  // 圆窗
  const wx = nw.x + (ne.x - nw.x) * 0.36;
  const wy = topY + slopeDrop * 0.34;
  const wr = 26 * s;
  ctx.fillStyle = 'rgba(12,10,8,0.9)';
  ctx.beginPath();
  ctx.arc(wx, wy, wr + 5 * s, 0, TAU);
  ctx.fill();
  const sky = ctx.createLinearGradient(wx, wy - wr, wx, wy + wr);
  sky.addColorStop(0, '#0a1220');
  sky.addColorStop(1, '#172535');
  ctx.fillStyle = sky;
  ctx.beginPath();
  ctx.arc(wx, wy, wr, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(240,224,184,0.8)';
  ctx.beginPath();
  ctx.arc(wx + wr * 0.3, wy - wr * 0.25, wr * 0.16, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(70,54,36,0.95)';
  ctx.lineWidth = 2.4 * s;
  ctx.beginPath();
  ctx.arc(wx, wy, wr, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(wx - wr, wy);
  ctx.lineTo(wx + wr, wy);
  ctx.moveTo(wx, wy - wr);
  ctx.lineTo(wx, wy + wr);
  ctx.lineWidth = 1.4 * s;
  ctx.stroke();
  // 光斑
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const lg = ctx.createRadialGradient(wx, wy, 2, wx, wy, wr * 3.2);
  lg.addColorStop(0, 'rgba(190,210,255,0.18)');
  lg.addColorStop(1, 'rgba(190,210,255,0)');
  ctx.fillStyle = lg;
  ctx.beginPath();
  ctx.arc(wx, wy, wr * 3.2, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.restore();
  // 斜梁
  ctx.strokeStyle = 'rgba(26,18,11,0.98)';
  ctx.lineWidth = 9 * s;
  ctx.beginPath();
  ctx.moveTo(nw.x - 20 * s, topY - 6 * s);
  ctx.lineTo(ne.x + 40 * s, topY + slopeDrop * 1.2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(90,68,42,0.4)';
  ctx.lineWidth = 2 * s;
  ctx.stroke();
  ctx.restore();
}

// ---------------- 顶灯 ----------------

function drawCeilingLampFixture(ctx, layout, room, theme, rng) {
  const lamp = layout.lamp;
  const sx = lamp.anchor.x;
  const ceilY = Math.max(6, lamp.anchor.y - (WALL_H * 0.98 + 36) * layout.scale);
  const shadeY = lamp.bulbY;
  ctx.save();
  // 电线
  ctx.strokeStyle = 'rgba(24,18,12,0.9)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(sx, ceilY - 10);
  ctx.quadraticCurveTo(sx + 2, (ceilY + shadeY) / 2, sx, shadeY - 8 * layout.scale);
  ctx.stroke();
  // 天花板接线盒
  ctx.fillStyle = 'rgba(30,24,18,0.95)';
  ctx.beginPath();
  ctx.ellipse(sx, ceilY - 8, 5.2, 2.4, 0, 0, TAU);
  ctx.fill();
  // 灯罩（旧搪瓷）
  const sw = 26 * layout.scale;
  const sh = 15 * layout.scale;
  ctx.beginPath();
  ctx.moveTo(sx - sw * 0.28, shadeY - sh);
  ctx.lineTo(sx + sw * 0.28, shadeY - sh);
  ctx.quadraticCurveTo(sx + sw * 0.62, shadeY - sh * 0.3, sx + sw * 0.72, shadeY);
  ctx.quadraticCurveTo(sx, shadeY + 3.4, sx - sw * 0.72, shadeY);
  ctx.quadraticCurveTo(sx - sw * 0.62, shadeY - sh * 0.3, sx - sw * 0.28, shadeY - sh);
  ctx.closePath();
  const sg = ctx.createLinearGradient(0, shadeY - sh, 0, shadeY + 3);
  sg.addColorStop(0, 'rgba(122,104,78,0.98)');
  sg.addColorStop(0.6, 'rgba(70,58,42,0.98)');
  sg.addColorStop(1, 'rgba(34,27,19,0.98)');
  ctx.fillStyle = sg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,14,9,0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 罩内发热的渍
  ctx.fillStyle = 'rgba(255,199,90,0.18)';
  ctx.beginPath();
  ctx.ellipse(sx, shadeY + 1, sw * 0.6, 3, 0, 0, TAU);
  ctx.fill();
  // 灯泡
  ctx.fillStyle = 'rgba(255,232,180,0.95)';
  ctx.beginPath();
  ctx.ellipse(sx, shadeY + 3.4, 4.2 * layout.scale, 3.4 * layout.scale, 0, 0, TAU);
  ctx.fill();
  // 小飞虫/烟熏
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = 'rgba(20,14,9,0.25)';
    ctx.beginPath();
    ctx.arc(sx + (hash01(i, 3) - 0.5) * sw, shadeY - sh * 0.4 + hash01(i, 4) * sh * 0.5, 0.7, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------- 地面杂物 / 家具 ----------------

function drawFloorClutter(ctx, layout, room, theme, rng, spec) {
  const sorted = [...spec.floorPlan.values()].sort((a, b) => (a.tile.x + a.tile.y) - (b.tile.x + b.tile.y));
  for (const item of sorted) {
    drawOneClutter(ctx, layout, room, theme, rng, spec, item);
  }
}

function drawOneClutter(ctx, layout, room, theme, rng, spec, item) {
  const { tile } = item;
  const x0 = tile.x + 0.14;
  const y0 = tile.y + 0.14;
  const x1 = tile.x + 0.88;
  const y1 = tile.y + 0.88;
  const cx = tile.x + 0.5;
  const cy = tile.y + 0.5;
  const seed = Math.floor(hash01(tile.x, tile.y, 5) * 10000);
  ctx.save();
  switch (item.type) {
    case 'desk': {
      const extra = item.extra;
      const deskY1 = extra ? Math.min(tile.y + 1.85, layout.roomH - 0.12) : y1;
      // 桌面
      isoBox(ctx, layout, x0, tile.y + 0.16, tile.x + 1.15, deskY1, 20, {
        topFill: 'rgba(112,83,52,1)',
        southFill: 'rgba(62,44,28,1)',
        eastFill: 'rgba(48,34,22,1)',
        topHighlight: 'rgba(255,235,190,0.05)',
      });
      // 桌面上的纸、书、笔筒
      const dp = projectElevated(layout, tile.x + 0.7, tile.y + 0.6, 20);
      ctx.fillStyle = 'rgba(226,212,180,0.9)';
      ctx.save();
      ctx.translate(dp.x, dp.y);
      ctx.rotate(0.1);
      ctx.fillRect(-11, -7, 22, 13);
      ctx.strokeStyle = 'rgba(80,60,40,0.4)';
      ctx.lineWidth = 0.7;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-8, -3 + i * 3);
        ctx.lineTo(8, -3 + i * 3);
        ctx.stroke();
      }
      ctx.restore();
      const cp = projectElevated(layout, tile.x + 0.85, tile.y + 1.2, 20);
      ctx.fillStyle = 'rgba(60,74,70,0.95)';
      ctx.fillRect(cp.x - 3, cp.y - 9, 6, 9);
      ctx.fillStyle = 'rgba(200,190,120,0.8)';
      ctx.fillRect(cp.x - 2, cp.y - 10, 4, 2);
      // 台灯
      drawDeskLamp(ctx, layout, tile.x + 0.35, tile.y + 1.3, 20, theme, true);
      break;
    }
    case 'side-table':
    case 'thermos': {
      isoBox(ctx, layout, x0, y0, x1, y1, 15, {
        topFill: 'rgba(104,84,58,1)',
        southFill: 'rgba(62,48,32,1)',
        eastFill: 'rgba(48,36,24,1)',
      });
      const p = projectElevated(layout, cx, cy, 15);
      // 暖水瓶
      screenCylinder(ctx, p.x - 4, p.y, 5.2, 3.4, 17, {
        side: 'rgba(116,74,58,1)',
        sideDark: 'rgba(66,40,32,1)',
        sideLight: 'rgba(154,106,84,1)',
        top: 'rgba(196,180,140,1)',
        rim: 'rgba(40,28,20,0.7)',
      });
      ctx.fillStyle = 'rgba(210,196,160,0.9)';
      ctx.fillRect(p.x - 9, p.y - 18, 7, 8);
      // 搪瓷杯
      screenCylinder(ctx, p.x + 6, p.y + 1, 3.4, 2.4, 6, {
        side: 'rgba(196,198,186,1)',
        sideDark: 'rgba(120,124,118,1)',
        sideLight: 'rgba(230,230,220,1)',
        top: 'rgba(80,60,40,0.9)',
        rim: 'rgba(60,50,40,0.6)',
      });
      break;
    }
    case 'plant': {
      const p = project(layout, cx, cy);
      // 花盆
      screenCylinder(ctx, p.x, p.y + 4, 13 * layout.scale, 7 * layout.scale, 18 * layout.scale, {
        side: 'rgba(112,72,52,1)',
        sideDark: 'rgba(58,36,26,1)',
        sideLight: 'rgba(144,96,68,1)',
        top: 'rgba(40,30,20,0.95)',
        rim: 'rgba(30,20,14,0.6)',
      });
      // 叶
      const sway = Math.sin(spec.seed + tile.x) * 1.5;
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI / 2 + (i - 4) * 0.3;
        const len = (18 + hash01(seed, i, 1) * 16) * layout.scale;
        ctx.strokeStyle = 'rgba(64,94,58,0.95)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 16 * layout.scale);
        ctx.quadraticCurveTo(
          p.x + Math.cos(a) * len * 0.6 + sway, p.y - 16 * layout.scale + Math.sin(a) * len * 0.6,
          p.x + Math.cos(a) * len + sway, p.y - 16 * layout.scale + Math.sin(a) * len
        );
        ctx.stroke();
        ctx.fillStyle = 'rgba(76,112,66,0.8)';
        ctx.beginPath();
        ctx.ellipse(
          p.x + Math.cos(a) * len + sway, p.y - 16 * layout.scale + Math.sin(a) * len,
          4.4 * layout.scale, 2.4 * layout.scale, a, 0, TAU
        );
        ctx.fill();
      }
      break;
    }
    case 'boxes': {
      drawBoxStack(ctx, layout, x0, y0, x1, y1, seed, theme);
      break;
    }
    case 'crates': {
      drawCrate(ctx, layout, x0, y0, x1, y1, seed, theme);
      break;
    }
    case 'chair': {
      drawChair(ctx, layout, x0 + 0.05, y0 + 0.05, x1 - 0.05, y1 - 0.05, theme);
      break;
    }
    case 'barrel': {
      isoCylinder(ctx, layout, cx, cy, 0.34, 24, {
        side: 'rgba(88,70,48,0.98)',
        sideDark: 'rgba(46,36,24,0.98)',
        sideLight: 'rgba(116,94,64,0.98)',
        top: 'rgba(60,48,34,1)',
        topInner: 'rgba(34,26,18,1)',
        band: 'rgba(52,46,38,0.8)',
        rim: 'rgba(20,14,9,0.6)',
      });
      break;
    }
    case 'sack': {
      const p = project(layout, cx, cy);
      const g = ctx.createLinearGradient(p.x, p.y - 22, p.x, p.y);
      g.addColorStop(0, 'rgba(168,148,108,0.95)');
      g.addColorStop(1, 'rgba(104,88,60,0.98)');
      ctx.fillStyle = g;
      blobPath(ctx, p.x, p.y - 10 * layout.scale, 16 * layout.scale, 15 * layout.scale, seed, 0, 0.18, 12);
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,48,28,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      drawSoftShadow(ctx, p.x, p.y + 3, 18 * layout.scale, 7 * layout.scale, 0.4);
      break;
    }
    case 'stool': {
      isoBox(ctx, layout, x0 + 0.06, y0 + 0.06, x1 - 0.06, y1 - 0.06, 12, {
        topFill: 'rgba(118,86,54,1)',
        southFill: 'rgba(64,46,28,1)',
        eastFill: 'rgba(50,36,22,1)',
      });
      const p = projectElevated(layout, cx, cy, 12);
      ctx.strokeStyle = 'rgba(40,28,18,0.8)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + 0.4;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(a) * 7, p.y + Math.sin(a) * 4);
        ctx.lineTo(p.x + Math.cos(a) * 6, p.y + 11 + Math.sin(a) * 4);
        ctx.stroke();
      }
      break;
    }
    case 'desk-lamp': {
      isoBox(ctx, layout, x0, y0, x1, y1, 16, {
        topFill: 'rgba(96,74,50,1)',
        southFill: 'rgba(56,42,28,1)',
        eastFill: 'rgba(44,32,20,1)',
      });
      drawDeskLamp(ctx, layout, cx, cy, 16, theme, true);
      break;
    }
    default: {
      drawCrate(ctx, layout, x0, y0, x1, y1, seed, theme);
    }
  }
  ctx.restore();
}

function drawBoxStack(ctx, layout, x0, y0, x1, y1, seed, theme) {
  const rng = rngFrom(seed);
  const p = project(layout, (x0 + x1) / 2, (y0 + y1) / 2);
  drawSoftShadow(ctx, p.x, p.y + 4, 24 * layout.scale, 9 * layout.scale, 0.35);
  isoBox(ctx, layout, x0 + 0.02, y0 + 0.1, x1 - 0.1, y1 - 0.06, 13, {
    topFill: 'rgba(150,122,82,1)',
    southFill: 'rgba(96,74,48,1)',
    eastFill: 'rgba(78,58,38,1)',
  });
  isoBox(ctx, layout, x0 + 0.16, y0 + 0.04, x1 - 0.24, y1 - 0.32, 24, {
    topFill: 'rgba(162,134,92,1)',
    southFill: 'rgba(104,80,52,1)',
    eastFill: 'rgba(84,62,40,1)',
  });
  // 胶带与字迹
  const p2 = projectElevated(layout, (x0 + x1) / 2, (y0 + y1) / 2 - 0.1, 24);
  ctx.strokeStyle = 'rgba(210,196,160,0.55)';
  ctx.lineWidth = 2.2 * layout.scale;
  ctx.beginPath();
  ctx.moveTo(p2.x - 16, p2.y);
  ctx.lineTo(p2.x + 16, p2.y);
  ctx.stroke();
  ctx.save();
  ctx.fillStyle = 'rgba(60,44,26,0.5)';
  ctx.font = `700 ${7 * layout.scale}px ${FONT_SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('试剂', p2.x + 4, p2.y - 5);
  ctx.restore();
}

function drawCrate(ctx, layout, x0, y0, x1, y1, seed, theme) {
  isoBox(ctx, layout, x0 + 0.04, y0 + 0.06, x1 - 0.04, y1 - 0.06, 18, {
    topFill: 'rgba(120,94,62,1)',
    southFill: 'rgba(74,56,36,1)',
    eastFill: 'rgba(58,44,28,1)',
    topHighlight: 'rgba(255,235,190,0.04)',
  });
  const p = projectElevated(layout, (x0 + x1) / 2, (y0 + y1) / 2, 18);
  ctx.strokeStyle = 'rgba(50,36,22,0.55)';
  ctx.lineWidth = 1;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(p.x - 15 + i * 10, p.y - 6);
    ctx.lineTo(p.x - 15 + i * 10, p.y + 6);
    ctx.stroke();
  }
  // 旧报纸
  paperTag(ctx, p.x + 4, p.y - 3, 15, 9, -0.2, { fill: 'rgba(214,202,174,0.75)', tear: 0.6, shadowBlur: 1 });
}

function drawChair(ctx, layout, x0, y0, x1, y1, theme) {
  isoBox(ctx, layout, x0 + 0.08, y0 + 0.08, x1 - 0.08, y1 - 0.08, 12, {
    topFill: 'rgba(126,92,58,1)',
    southFill: 'rgba(70,50,30,1)',
    eastFill: 'rgba(54,38,22,1)',
  });
  const p = projectElevated(layout, (x0 + x1) / 2, (y0 + y1) / 2, 12);
  // 椅背（歪斜）
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(-0.08);
  ctx.fillStyle = 'rgba(88,64,40,0.98)';
  ctx.fillRect(-11, -24, 22, 4);
  ctx.fillStyle = 'rgba(60,42,26,0.98)';
  ctx.fillRect(-11, -21, 3, 21);
  ctx.fillRect(8, -21, 3, 21);
  ctx.fillStyle = 'rgba(120,90,58,0.9)';
  ctx.fillRect(-9, -23, 18, 2);
  ctx.restore();
  ctx.strokeStyle = 'rgba(34,24,14,0.8)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    ctx.moveTo(p.x - 9 + i * 18, p.y + 6);
    ctx.lineTo(p.x - 9 + i * 18, p.y + 16);
    ctx.stroke();
  }
}

function drawDeskLamp(ctx, layout, x, y, baseZ, theme, on) {
  const p = projectElevated(layout, x, y, baseZ);
  const s = layout.scale;
  // 底座
  ctx.fillStyle = 'rgba(50,42,32,0.95)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, 6 * s, 3 * s, 0, 0, TAU);
  ctx.fill();
  // 支臂
  ctx.strokeStyle = 'rgba(90,76,54,0.95)';
  ctx.lineWidth = 1.8 * s;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.quadraticCurveTo(p.x - 8 * s, p.y - 22 * s, p.x + 2 * s, p.y - 30 * s);
  ctx.stroke();
  // 灯罩
  ctx.fillStyle = on ? 'rgba(122,92,52,0.98)' : 'rgba(70,60,48,0.98)';
  ctx.beginPath();
  ctx.moveTo(p.x - 8 * s, p.y - 30 * s);
  ctx.lineTo(p.x + 12 * s, p.y - 30 * s);
  ctx.lineTo(p.x + 9 * s, p.y - 22 * s);
  ctx.lineTo(p.x - 5 * s, p.y - 22 * s);
  ctx.closePath();
  ctx.fill();
  if (on) {
    ctx.fillStyle = 'rgba(255,215,140,0.75)';
    ctx.beginPath();
    ctx.ellipse(p.x + 2 * s, p.y - 21 * s, 5 * s, 2.4 * s, 0, 0, TAU);
    ctx.fill();
  }
}

// ---------------- 气密门 ----------------

// 静态层只画门洞的暗色凹陷，门框与门板在动态层画（保证与建筑的前后遮挡正确）。
function drawDoorRecess(ctx, layout, room, theme) {
  const half = DOOR_HALF_TILES;
  ctx.save();
  applyDown(ctx, southFacadeDown(layout, layout.door.tileX - half - 0.3, DOOR_HEIGHT + 12));
  const totalW = (half + 0.3) * 2;
  ctx.fillStyle = 'rgba(8,10,12,1)';
  ctx.fillRect(0.3, 12, totalW - 0.6, DOOR_HEIGHT);
  ctx.fillStyle = 'rgba(24,28,30,0.8)';
  ctx.fillRect(0.3, 12, totalW - 0.6, 3);
  ctx.restore();
}

export function drawDoorFrame(ctx, layout, room, theme) {
  const door = layout.door;
  const cx = door.tileX;
  const half = DOOR_HALF_TILES;
  const s = layout.scale;
  // 门洞四周的墙面（门框结构，比矮墙高）
  ctx.save();
  applyDown(ctx, southFacadeDown(layout, cx - half - 0.3, DOOR_HEIGHT + 12));
  const totalW = (half + 0.3) * 2;
  // 门洞内部暗色
  ctx.fillStyle = 'rgba(10,12,14,0.98)';
  ctx.fillRect(0.3, 12, totalW - 0.6, DOOR_HEIGHT);
  // 门框
  const frameW = 0.22;
  ctx.fillStyle = 'rgba(56,58,56,0.99)';
  ctx.fillRect(0, 0, totalW, DOOR_HEIGHT + 12);
  ctx.fillStyle = 'rgba(84,86,82,0.98)';
  ctx.fillRect(0.08, 0.4, totalW - 0.16, DOOR_HEIGHT + 11);
  // 内框
  ctx.fillStyle = 'rgba(36,38,36,0.99)';
  ctx.fillRect(0.3, 12, totalW - 0.6, DOOR_HEIGHT);
  // 框上的铆钉
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    rivet(ctx, 0.12, 8 + t * (DOOR_HEIGHT - 4), 0.42, 'rgba(30,30,28,0.9)', 'rgba(210,200,170,0.35)');
    rivet(ctx, totalW - 0.12, 8 + t * (DOOR_HEIGHT - 4), 0.42, 'rgba(30,30,28,0.9)', 'rgba(210,200,170,0.35)');
  }
  // 门楣上的黄黑警示条与标记
  drawHazard(ctx, 0.32, 3.2, totalW - 0.64, 6.4, theme);
  ctx.fillStyle = 'rgba(14,12,10,0.5)';
  ctx.fillRect(0.32, 10.2, totalW - 0.64, 1.2);
  ctx.restore();
}

// ---------------- 走廊 ----------------

function drawCorridor(ctx, layout, room, theme, rng, spec) {
  const corridor = layout.corridorGeometry;
  const corners = corridor.corners;
  ctx.save();
  tracePolygon(ctx, corners);
  ctx.clip();
  // 地面底色：远处偏亮，近处沉入黑暗
  const near = corridor.nearLine[0];
  const farTop = project(layout, layout.corridor.left, layout.roomH);
  const g = ctx.createLinearGradient(0, farTop.y, 0, near.y + 30);
  g.addColorStop(0, CORRIDOR.floor);
  g.addColorStop(0.55, CORRIDOR.floorDark);
  g.addColorStop(1, CORRIDOR.fog);
  ctx.fillStyle = g;
  ctx.fillRect(0, farTop.y - 40, layout.cssW, near.y - farTop.y + 80);

  // 混凝土砖缝
  const cg = layout.corridor;
  for (let x = cg.left; x <= cg.right; x += 0.9) {
    const a = project(layout, x, layout.roomH);
    const b = project(layout, x, layout.roomH + cg.depth);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = rgba(CORRIDOR.seam, 0.7);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  for (let y = 0.6; y < cg.depth; y += 0.7) {
    const a = project(layout, cg.left, layout.roomH + y);
    const b = project(layout, cg.right, layout.roomH + y);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = rgba(CORRIDOR.seam, 0.55);
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }
  // 水渍、油渍
  for (let i = 0; i < 10; i++) {
    const x = cg.left + 0.2 + hash01(spec.seed, i, 71) * (cg.width - 0.4);
    const y = layout.roomH + 0.2 + hash01(spec.seed, i, 72) * (cg.depth - 0.4);
    const p = project(layout, x, y);
    ctx.fillStyle = 'rgba(8,12,15,0.32)';
    blobPath(ctx, p.x, p.y, (10 + hash01(i, 73) * 24) * layout.scale, (5 + hash01(i, 74) * 10) * layout.scale, i + 3, 0, 0.35, 12);
    ctx.fill();
    ctx.fillStyle = 'rgba(120,160,180,0.05)';
    ctx.fill();
  }
  // 门前暖光溢出
  const door = layout.door;
  const spill = ctx.createRadialGradient(door.center.x, door.center.y + 8, 4, door.center.x, door.center.y + 8, 150 * layout.scale);
  spill.addColorStop(0, 'rgba(255,199,90,0.16)');
  spill.addColorStop(0.5, 'rgba(255,199,90,0.05)');
  spill.addColorStop(1, 'rgba(255,199,90,0)');
  ctx.fillStyle = spill;
  ctx.fillRect(door.center.x - 160 * layout.scale, door.center.y - 30, 320 * layout.scale, 220 * layout.scale);
  // 冷色灯下的地砖反光
  for (let i = 0; i < 2; i++) {
    const lx = project(layout, room.w * (0.2 + i * 1.1) + 0.4, room.h + 1.15);
    lightPool(ctx, lx.x, lx.y, 120 * layout.scale, 44 * layout.scale, CORRIDOR.light, 0.07);
  }
  // 散落的纸片与玻璃渣
  for (let i = 0; i < 8; i++) {
    const x = cg.left + 0.3 + hash01(spec.seed, i, 81) * (cg.width - 0.6);
    const y = layout.roomH + 0.2 + hash01(spec.seed, i, 82) * (cg.depth - 0.4);
    const p = project(layout, x, y);
    paperTag(ctx, p.x, p.y, 7 + hash01(i, 83) * 9, 4 + hash01(i, 84) * 5, hash01(i, 85) * 2, {
      fill: 'rgba(178,184,180,0.5)',
      tear: 0.8,
      shadowBlur: 0,
    });
  }
  // 端部融进黑暗
  const dirs = [
    [project(layout, cg.right, layout.roomH), project(layout, cg.right, layout.roomH + cg.depth)],
    [project(layout, cg.left, layout.roomH), project(layout, cg.left, layout.roomH + cg.depth)],
  ];
  for (const [a, b] of dirs) {
    const rg = ctx.createLinearGradient(a.x, 0, b.x, 0);
    rg.addColorStop(0, 'rgba(5,8,12,0.85)');
    rg.addColorStop(1, 'rgba(5,8,12,0)');
    // 通过 canvas 径向遮罩更简单：画一团黑雾
    ctx.fillStyle = rg;
    ctx.fillRect(Math.min(a.x, b.x) - 140, a.y - 160, 280, 400);
  }
  // 近端雾
  const fog = ctx.createLinearGradient(0, near.y - 40, 0, near.y + 80);
  fog.addColorStop(0, 'rgba(6,9,13,0)');
  fog.addColorStop(1, 'rgba(6,9,13,0.9)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, near.y - 50, layout.cssW, 160);
  ctx.restore();

  // 对面宿舍立面（完整墙）
  drawNeighbourFacade(ctx, layout, room, theme, spec, layout.corridor.left, -0.12, 'left');
  drawNeighbourFacade(ctx, layout, room, theme, spec, room.w + 0.12, layout.corridor.right, 'right');
}

function drawNeighbourFacade(ctx, layout, room, theme, spec, x0, x1, side) {
  const len = x1 - x0;
  if (len <= 0.4) return;
  const h = NEIGHBOR_WALL_H;
  const slots = layout.roommates.filter((slot) => slot.side === side && slot.x >= x0 && slot.x <= x1);
  ctx.save();
  applyDown(ctx, southFacadeDown(layout, x0, h));
  // 墙面
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2f363c');
  g.addColorStop(0.5, '#39424a');
  g.addColorStop(0.85, '#252c33');
  g.addColorStop(1, '#1a2026');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, len, h);
  // 旧瓷砖墙面
  for (let y = 4; y < h - 12; y += 7) {
    ctx.strokeStyle = 'rgba(12,16,20,0.4)';
    ctx.lineWidth = 0.25;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(len, y);
    ctx.stroke();
  }
  for (let x = 0.6; x < len; x += 0.62) {
    ctx.strokeStyle = 'rgba(12,16,20,0.25)';
    ctx.lineWidth = 0.2;
    ctx.beginPath();
    ctx.moveTo(x, 4);
    ctx.lineTo(x, h - 12);
    ctx.stroke();
  }
  // 每扇门
  for (const slot of slots) {
    const localX = slot.x - x0;
    drawNeighbourDoor(ctx, localX, h, theme, spec, slot);
  }
  // 走廊壁灯（暖冷混合，给走廊一点可读的层次）
  for (let lx = 0.35; lx < len - 0.2; lx += 1.05) {
    if (slots.some((slot) => Math.abs(slot.x - x0 - lx) < 0.55)) continue;
    const lampY = 18;
    ctx.fillStyle = 'rgba(30,34,36,0.9)';
    ctx.fillRect(lx - 0.22, lampY - 3.2, 0.44, 1.1);
    ctx.strokeStyle = 'rgba(120,128,126,0.6)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(lx, lampY - 2.2);
    ctx.lineTo(lx, lampY);
    ctx.stroke();
    ctx.fillStyle = 'rgba(178,192,186,0.85)';
    ctx.beginPath();
    ctx.moveTo(lx - 2.1, lampY);
    ctx.lineTo(lx + 2.1, lampY);
    ctx.lineTo(lx + 1.2, lampY + 2.2);
    ctx.lineTo(lx - 1.2, lampY + 2.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(220,236,246,0.28)';
    ctx.beginPath();
    ctx.ellipse(lx, lampY + 2.6, 1.8, 0.7, 0, 0, TAU);
    ctx.fill();
  }
  // 墙面管道与电缆
  ctx.strokeStyle = 'rgba(40,48,54,0.95)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.lineTo(len, 6);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(100,112,120,0.2)';
  ctx.lineWidth = 0.3;
  ctx.stroke();
  for (let x = 0.5; x < len; x += 0.9) {
    ctx.fillStyle = 'rgba(20,24,28,0.7)';
    ctx.fillRect(x, 4.9, 0.25, 2.2);
  }
  // 顶部剖切帽
  ctx.fillStyle = 'rgba(18,22,26,0.98)';
  ctx.fillRect(0, -3, len, 3);
  ctx.fillStyle = 'rgba(226,210,176,0.12)';
  ctx.fillRect(0, 0, len, 0.7);
  // 墙脚污渍与踢脚线
  ctx.fillStyle = 'rgba(20,24,26,0.95)';
  ctx.fillRect(0, h - 5.5, len, 5.5);
  const bg = ctx.createLinearGradient(0, h - 9, 0, h);
  bg.addColorStop(0, 'rgba(6,8,10,0)');
  bg.addColorStop(1, 'rgba(6,8,10,0.5)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, h - 9, len, 9);
  ctx.restore();
}

function drawNeighbourDoor(ctx, cx, wallH, theme, spec, slot) {
  const doorW = 0.78;
  const doorH = 54;
  const x = cx - doorW / 2;
  const y = wallH - doorH - 3;
  ctx.save();
  // 门洞阴影
  ctx.fillStyle = 'rgba(6,8,10,0.9)';
  ctx.fillRect(x - 0.18, y - 0.9, doorW + 0.36, doorH + 4);
  // 门框
  ctx.fillStyle = 'rgba(68,72,70,0.98)';
  ctx.fillRect(x - 0.09, y - 0.9, doorW + 0.18, 1.3);
  ctx.fillRect(x - 0.12, y, 0.16, doorH);
  ctx.fillRect(x + doorW - 0.04, y, 0.16, doorH);
  // 门板
  const g = ctx.createLinearGradient(x, 0, x + doorW, 0);
  g.addColorStop(0, 'rgba(64,66,62,0.98)');
  g.addColorStop(0.5, 'rgba(84,86,80,0.98)');
  g.addColorStop(1, 'rgba(54,56,52,0.98)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, doorW, doorH);
  // 横向加强筋
  ctx.strokeStyle = 'rgba(30,32,30,0.6)';
  ctx.lineWidth = 0.35;
  for (let i = 1; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(x, y + (doorH / 5) * i);
    ctx.lineTo(x + doorW, y + (doorH / 5) * i);
    ctx.stroke();
  }
  // 门把手
  ctx.fillStyle = 'rgba(160,150,120,0.8)';
  ctx.beginPath();
  ctx.arc(x + doorW * 0.78, y + doorH * 0.55, 0.65, 0, TAU);
  ctx.fill();
  // 门缝与门底光带（静态中性，动态再点亮）
  ctx.fillStyle = 'rgba(160,180,200,0.12)';
  ctx.fillRect(x + 0.06, y + doorH - 1.1, doorW - 0.12, 1.1);
  // 门牌
  ctx.fillStyle = 'rgba(210,198,168,0.9)';
  ctx.fillRect(x + doorW / 2 - 0.42, y - 6.4, 0.84, 3.4);
  ctx.fillStyle = 'rgba(40,32,22,0.85)';
  ctx.font = `700 2.3px ${FONT_SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('宿舍', x + doorW / 2, y - 4.5);
  // 门上的划痕/贴纸
  ctx.strokeStyle = 'rgba(18,20,18,0.35)';
  ctx.lineWidth = 0.18;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x + 0.1 + i * 0.2, y + doorH * (0.2 + i * 0.15));
    ctx.lineTo(x + 0.35 + i * 0.22, y + doorH * (0.26 + i * 0.15));
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------- 边缘墨迹 ----------------

function drawEdgeInk(ctx, layout, room, theme, rng) {
  const { cssW, cssH } = layout;
  ctx.save();
  // 角落的墨迹晕染
  inkSplat(ctx, cssW * 0.06, cssH * 0.12, 60 + rng() * 30, '#0a0d12', 0.22, 31);
  inkSplat(ctx, cssW * 0.95, cssH * 0.08, 48 + rng() * 30, '#0a0d12', 0.18, 33);
  inkSplat(ctx, cssW * 0.92, cssH * 0.82, 70 + rng() * 40, '#080b10', 0.22, 35);
  inkSplat(ctx, cssW * 0.04, cssH * 0.78, 52 + rng() * 30, '#080b10', 0.18, 37);
  // 纸张边缘的纤维
  ctx.strokeStyle = 'rgba(230,216,184,0.03)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const y = rng() * cssH;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(cssW * (0.2 + rng() * 0.4), y + (rng() - 0.5) * 6);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------- 动态层：顶灯、尘埃、风扇 ----------------

export function drawRoomAmbient(ctx, env) {
  const { layout, room, theme, state, now, simNow } = env;
  const t = now;
  const lamp = layout.lamp;
  const s = layout.scale;

  // 吊灯辉光 + 轻微闪烁
  const flicker = 0.9 + smoothNoise(t * 1.7, 3.2) * 0.08;
  drawGlow(ctx, theme.lamp, lamp.anchor.x, lamp.bulbY + 6 * s, 130 * s, 0.16 * flicker);
  drawGlow(ctx, theme.lamp, lamp.anchor.x, lamp.bulbY + 4 * s, 34 * s, 0.32 * flicker);
  // 灯下的暖光锥（低透明度）
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const cone = ctx.createLinearGradient(0, lamp.bulbY, 0, lamp.anchor.y + 10 * s);
  cone.addColorStop(0, rgba(theme.lamp, 0.06 * flicker));
  cone.addColorStop(1, rgba(theme.lamp, 0));
  ctx.fillStyle = cone;
  tracePolygon(ctx, [
    { x: lamp.anchor.x - 14 * s, y: lamp.bulbY + 4 * s },
    { x: lamp.anchor.x + 14 * s, y: lamp.bulbY + 4 * s },
    { x: lamp.anchor.x + 150 * s, y: lamp.anchor.y + 10 * s },
    { x: lamp.anchor.x - 150 * s, y: lamp.anchor.y + 10 * s },
  ]);
  ctx.fill();
  ctx.restore();

  // 老风扇
  if (env.spec?.hasFan) drawCeilingFan(ctx, env, t);

  // 灯下尘埃
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 24; i++) {
    const phase = hash01(i, 3, 1) * TAU;
    const speed = 0.05 + hash01(i, 4) * 0.06;
    const baseX = lamp.anchor.x + (hash01(i, 5) - 0.5) * 240 * s;
    const baseY = lamp.anchor.y - 20 * s + (hash01(i, 6) - 0.5) * 150 * s;
    const x = baseX + Math.sin(t * speed * TAU + phase) * 14 * s;
    const y = baseY - ((t * (2 + hash01(i, 7) * 5) + hash01(i, 8) * 100) % (60 * s));
    const a = 0.08 + hash01(i, 9) * 0.14;
    ctx.fillStyle = rgba(theme.dust, a);
    ctx.beginPath();
    ctx.arc(x, y, (0.7 + hash01(i, 10) * 1.3) * s, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // 窗前冷尘
  const win = env.spec?.window;
  if (win) {
    const wp = project(layout, win.x + win.w * 0.5, 1.6);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 8; i++) {
      const x = wp.x + Math.sin(t * 0.3 + i * 1.7) * 36 * s + (hash01(i, 21) - 0.5) * 70 * s;
      const y = wp.y - 50 * s + Math.cos(t * 0.22 + i) * 24 * s + (hash01(i, 22) - 0.5) * 50 * s;
      ctx.fillStyle = rgba(theme.window.light, 0.1 + hash01(i, 23) * 0.1);
      ctx.beginPath();
      ctx.arc(x, y, 0.8 * s, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // 门的低血警报光
  const doorHpPct = doorHpRatio(state);
  const door = layout.door;
  if (state?.phase === 'night' && doorHpPct < 0.32) {
    const pulseA = 0.5 + 0.5 * Math.sin(t * 5.2);
    const col = '#ff5b47';
    drawGlow(ctx, col, door.center.x, door.topY + 14 * s, 60 * s, 0.1 + pulseA * 0.16);
    drawGlow(ctx, col, door.center.x, door.center.y + 6 * s, 90 * s, 0.05 + pulseA * 0.06);
  }

  // 胜利/失败氛围
  if (state?.phase === 'victory') {
    const winStar = win ? project(layout, win.x + win.w * 0.5, 0) : { x: layout.cssW * 0.5, y: layout.cssH * 0.2 };
    drawGlow(ctx, '#ffd9a0', winStar.x, winStar.y - 10 * s, 260 * s, 0.2);
  } else if (state?.phase === 'defeat') {
    drawGlow(ctx, '#ff4a3a', layout.door.center.x, layout.door.center.y - 30 * s, 220 * s, 0.09);
  }
}

function drawCeilingFan(ctx, env, t) {
  const { layout, theme } = env;
  const s = layout.scale;
  const lamp = layout.lamp;
  const cx = lamp.anchor.x + 44 * s;
  const cy = lamp.bulbY - 26 * s;
  ctx.save();
  ctx.translate(cx, cy);
  // 吊杆
  ctx.strokeStyle = 'rgba(40,34,26,0.9)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, -26 * s);
  ctx.lineTo(0, 0);
  ctx.stroke();
  // 扇叶
  const rot = t * 2.6;
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate(rot + (i / 3) * TAU);
    ctx.fillStyle = 'rgba(74,60,44,0.75)';
    ctx.beginPath();
    ctx.ellipse(18 * s, 0, 20 * s, 5 * s, 0.1, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(24,18,12,0.5)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(60,48,36,0.95)';
  ctx.beginPath();
  ctx.arc(0, 0, 5 * s, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ---------------- 动态层：冷凝床 ----------------

export function drawBed(ctx, env) {
  const { layout, room, theme, state, now } = env;
  const bed = room.bed;
  if (!bed) return;
  const s = layout.scale;
  const level = clamp(state?.player?.bedLevel || 1, 1, 8);
  const t = now;
  const cloth = theme.cloth;
  const bx = bed.x;
  const by = bed.y;
  const bw = bed.w;
  const bh = bed.h;
  const P = (x, y, z = 0) => projectElevated(layout, bx + x, by + y, z);
  const center = P(bw / 2, bh / 2, 0);

  // 床底阴影
  drawSoftShadow(ctx, center.x, center.y + 4 * s, bw * 42 * s, bh * 16 * s, 0.52);

  // 床架（深色木框）
  isoBox(ctx, layout, bx + 0.04, by + 0.04, bx + bw - 0.04, by + bh - 0.04, 15, {
    topFill: 'rgba(74,54,36,1)',
    southFill: 'rgba(52,37,23,1)',
    eastFill: 'rgba(40,28,17,1)',
    line: 'rgba(18,12,7,0.65)',
  });
  // 床脚（四个黄铜脚）
  for (const [px, py] of [[0.1, bh - 0.1], [bw - 0.1, bh - 0.1], [bw - 0.1, 0.12]]) {
    const q = P(px, py, 0);
    const q2 = P(px, py, 15);
    ctx.strokeStyle = 'rgba(152,118,64,0.9)';
    ctx.lineWidth = 2.2 * s;
    ctx.beginPath();
    ctx.moveTo(q.x, q.y + 1);
    ctx.lineTo(q2.x, q2.y + 1);
    ctx.stroke();
  }

  // 床头板：靠北墙，高一点，带雕花
  const hbA = P(0.1, 0.1, 12);
  const hbB = P(bw - 0.1, 0.1, 12);
  const hbTopA = P(0.1, 0.1, 50);
  const hbTopB = P(bw - 0.1, 0.1, 50);
  ctx.save();
  const hg = ctx.createLinearGradient(0, hbTopA.y, 0, hbA.y);
  hg.addColorStop(0, 'rgba(108,80,50,1)');
  hg.addColorStop(0.5, 'rgba(86,62,38,1)');
  hg.addColorStop(1, 'rgba(52,36,21,1)');
  tracePolygon(ctx, [hbA, hbB, hbTopB, hbTopA]);
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,13,7,0.7)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // 床头竖板条 + 黄铜球饰
  ctx.save();
  tracePolygon(ctx, [hbA, hbB, hbTopB, hbTopA]);
  ctx.clip();
  for (let i = 0; i < 4; i++) {
    const qa = P(0.18 + i * 0.46, 0.1, 12);
    const qb = P(0.18 + i * 0.46, 0.1, 50);
    ctx.strokeStyle = 'rgba(38,26,15,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(qa.x, qa.y);
    ctx.lineTo(qb.x, qb.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(220,190,140,0.12)';
    ctx.beginPath();
    ctx.moveTo(qa.x + 1.4, qa.y);
    ctx.lineTo(qb.x + 1.4, qb.y);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(190,152,86,0.85)';
  for (let i = 0; i < 3; i++) {
    const q = P(0.42 + i * 0.58, 0.1, 48);
    ctx.beginPath();
    ctx.arc(q.x, q.y, 1.8 * s, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // 床垫
  isoBox(ctx, layout, bx + 0.1, by + 0.12, bx + bw - 0.1, by + bh - 0.1, 26, {
    topFill: 'rgba(212,196,160,1)',
    southFill: 'rgba(160,144,114,1)',
    eastFill: 'rgba(134,118,92,1)',
    line: 'rgba(84,68,46,0.4)',
  });

  // 毯子：从枕头下方一直盖到床尾
  const blanket = [
    P(0.11, bh * 0.2, 29.4),
    P(bw - 0.11, bh * 0.2, 29.4),
    P(bw - 0.11, bh - 0.1, 29.4),
    P(0.11, bh - 0.1, 29.4),
  ];
  ctx.save();
  tracePolygon(ctx, blanket);
  const bg = ctx.createLinearGradient(0, blanket[0].y, 0, blanket[2].y);
  bg.addColorStop(0, mixColor(cloth, '#000000', 0.1));
  bg.addColorStop(0.42, cloth);
  bg.addColorStop(1, darken(cloth, 0.3));
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,12,8,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 毯子垂边（南侧）
  const dropA = P(0.11, bh - 0.1, 29.4);
  const dropB = P(bw - 0.11, bh - 0.1, 29.4);
  const dropC = P(bw - 0.11, bh - 0.02, 16);
  const dropD = P(0.11, bh - 0.02, 16);
  const dg = ctx.createLinearGradient(0, dropA.y, 0, dropC.y);
  dg.addColorStop(0, cloth);
  dg.addColorStop(1, darken(cloth, 0.4));
  tracePolygon(ctx, [dropA, dropB, dropC, dropD]);
  ctx.fillStyle = dg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,12,8,0.3)';
  ctx.stroke();
  // 毯子折痕与流苏
  ctx.save();
  tracePolygon(ctx, blanket);
  ctx.clip();
  for (let i = 0; i < 7; i++) {
    const q = P(0.16 + i * 0.26, bh * 0.24, 29.5);
    ctx.strokeStyle = i % 2 ? 'rgba(255,238,206,0.12)' : 'rgba(20,10,6,0.26)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(q.x - 10 * s, q.y);
    ctx.quadraticCurveTo(q.x, q.y + 8 * s, q.x + 14 * s, q.y + 12 * s);
    ctx.stroke();
  }
  // 毯子边缘的缝线
  const stitchA = P(0.12, bh - 0.14, 29.6);
  const stitchB = P(bw - 0.12, bh - 0.14, 29.6);
  ctx.strokeStyle = 'rgba(246,232,198,0.28)';
  ctx.lineWidth = 0.9;
  ctx.setLineDash([2.2, 2]);
  ctx.beginPath();
  ctx.moveTo(stitchA.x, stitchA.y);
  ctx.lineTo(stitchB.x, stitchB.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // 毯子上的梦能纹章
  const emb = P(bw * 0.58, bh * 0.72, 29.6);
  ctx.strokeStyle = 'rgba(255,236,196,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(emb.x, emb.y, 6.5 * s, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i / 3) * TAU;
    const px = emb.x + Math.cos(a) * 4 * s;
    const py = emb.y + Math.sin(a) * 3.4 * s;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  // 枕头
  const pillow = P(bw * 0.36, 0.46, 29);
  ctx.save();
  ctx.translate(pillow.x, pillow.y);
  ctx.rotate(-0.05);
  ctx.fillStyle = 'rgba(236,226,200,1)';
  blobPath(ctx, 0, 0, 19 * s, 7.6 * s, 3, 0, 0.05, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(168,152,120,0.55)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.fillStyle = 'rgba(252,246,228,0.8)';
  blobPath(ctx, -3 * s, -1.5 * s, 12 * s, 4 * s, 5, 0, 0.04, 12);
  ctx.fill();
  ctx.restore();

  // 熟睡的舍友：头发 + 毯子下的鼓包（呼吸）
  const headP = P(bw * 0.32, 0.52, 31);
  ctx.save();
  ctx.fillStyle = 'rgba(38,28,22,0.95)';
  blobPath(ctx, headP.x, headP.y, 6.4 * s, 4.4 * s, 7, 0, 0.12, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(16,10,6,0.5)';
  ctx.lineWidth = 0.7;
  ctx.stroke();
  // 侧脸的一点肤色
  ctx.fillStyle = 'rgba(206,166,128,0.55)';
  ctx.beginPath();
  ctx.ellipse(headP.x + 2.6 * s, headP.y + 1.6 * s, 2.4 * s, 1.6 * s, 0.2, 0, TAU);
  ctx.fill();
  ctx.restore();
  const bump = P(bw * 0.6, bh * 0.66, 30.6);
  const breath = 1 + Math.sin(t * 1.05) * 0.04;
  ctx.save();
  ctx.translate(bump.x, bump.y);
  const bumpG = ctx.createLinearGradient(0, -18 * s, 0, 8 * s);
  bumpG.addColorStop(0, rgba(lighten(cloth, 0.22), 0.95));
  bumpG.addColorStop(1, rgba(darken(cloth, 0.16), 0.95));
  ctx.fillStyle = bumpG;
  blobPath(ctx, 0, 0, 22 * s, 11 * s * breath, 7, 0, 0.07, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,12,8,0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // 床头搁板：闹钟与搪瓷杯
  const shelf = P(bw - 0.42, 0.28, 36);
  ctx.save();
  ctx.fillStyle = 'rgba(78,56,36,0.98)';
  ctx.fillRect(shelf.x - 16 * s, shelf.y, 32 * s, 3.2 * s);
  ctx.strokeStyle = 'rgba(20,13,8,0.6)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(shelf.x - 16 * s, shelf.y, 32 * s, 3.2 * s);
  // 闹钟
  ctx.fillStyle = 'rgba(190,164,116,0.95)';
  ctx.beginPath();
  ctx.arc(shelf.x - 7 * s, shelf.y - 5 * s, 5 * s, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,30,20,0.7)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(shelf.x - 7 * s, shelf.y - 5 * s);
  ctx.lineTo(shelf.x - 4 * s, shelf.y - 7 * s);
  ctx.moveTo(shelf.x - 7 * s, shelf.y - 5 * s);
  ctx.lineTo(shelf.x - 7 * s, shelf.y - 9 * s);
  ctx.stroke();
  // 杯子
  screenCylinder(ctx, shelf.x + 7 * s, shelf.y - 1 * s, 3 * s, 2 * s, 5.5 * s, {
    side: 'rgba(198,198,186,0.95)',
    sideDark: 'rgba(126,130,122,0.95)',
    sideLight: 'rgba(232,230,218,0.95)',
    top: 'rgba(60,46,32,0.9)',
    rim: 'rgba(40,32,24,0.6)',
  });
  ctx.restore();

  // 冷凝装置与梦能泡泡
  drawCondenserRig(ctx, env, bed, level, t);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const orbCount = Math.min(3 + level, 11);
  for (let i = 0; i < orbCount; i++) {
    const life = (t * (0.11 + hash01(i, 31) * 0.07) + hash01(i, 32)) % 1;
    const x = center.x + (hash01(i, 33) - 0.5) * 66 * s + Math.sin(t * 0.9 + i) * 6 * s;
    const y = center.y - 20 * s - life * 104 * s;
    const a = Math.sin(life * Math.PI) * 0.5;
    drawGlow(ctx, '#63e0c2', x, y, (7 + hash01(i, 34) * 5) * s, a * 0.7);
    ctx.fillStyle = rgba('#c5ffee', a * 0.8);
    ctx.beginPath();
    ctx.arc(x, y, 1.8 * s, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // 床等级：床沿的黄铜刻度
  for (let i = 0; i < 8; i++) {
    const lit = i < level;
    const p = P(0.16 + i * 0.2, bh - 0.03, 20);
    ctx.fillStyle = lit ? 'rgba(196,158,88,0.95)' : 'rgba(30,24,16,0.5)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.8 * s, 0, TAU);
    ctx.fill();
    if (lit) {
      ctx.strokeStyle = 'rgba(255,240,200,0.45)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }
}

function drawCondenserRig(ctx, env, bed, level, t) {
  const { layout, theme } = env;
  const s = layout.scale;
  // 放在床脚附近的地面
  const foot = project(layout, bed.x + bed.w - 0.32, bed.y + bed.h - 0.28);
  const baseY = foot.y;
  // 玻璃罐
  screenCylinder(ctx, foot.x + 2 * s, baseY, 12.5 * s, 7 * s, (20 + level * 3) * s, {
    side: 'rgba(150,196,186,0.26)',
    sideDark: 'rgba(90,140,132,0.25)',
    sideLight: 'rgba(196,236,226,0.22)',
    top: 'rgba(196,230,222,0.35)',
    rim: 'rgba(120,170,160,0.45)',
  });
  // 罐内冷凝液
  ctx.fillStyle = 'rgba(99,224,194,0.34)';
  ctx.beginPath();
  ctx.ellipse(foot.x + 2 * s, baseY - 7 * s, 10 * s, 5 * s, 0, 0, TAU);
  ctx.fill();
  // 罐顶铜盖
  ctx.fillStyle = 'rgba(150,112,60,0.95)';
  ctx.beginPath();
  ctx.ellipse(foot.x + 2 * s, baseY - (20 + level * 3) * s, 9 * s, 4.4 * s, 0, 0, TAU);
  ctx.fill();
  // 铜管：从罐子绕到床上方
  ctx.strokeStyle = 'rgba(150,112,60,0.95)';
  ctx.lineWidth = 2.6 * s;
  ctx.beginPath();
  ctx.moveTo(foot.x + 2 * s, baseY - (20 + level * 3) * s);
  ctx.bezierCurveTo(
    foot.x - 16 * s, baseY - 56 * s,
    foot.x - 34 * s, baseY - 42 * s,
    foot.x - 46 * s, baseY - 62 * s
  );
  ctx.stroke();
  ctx.strokeStyle = 'rgba(220,180,110,0.35)';
  ctx.lineWidth = 0.7 * s;
  ctx.stroke();
  // 滴落
  const drip = (t * 0.8) % 1;
  const dripY = baseY - (20 + level * 3) * s - dropOffset(drip) * 6 * s;
  ctx.fillStyle = 'rgba(184,255,233,0.7)';
  ctx.beginPath();
  ctx.arc(foot.x + 2 * s, dripY, 1.2 * s, 0, TAU);
  ctx.fill();
  // 等级越高，装置越大：额外的黄铜环与标签
  for (let i = 0; i < Math.floor(level / 2); i++) {
    ctx.strokeStyle = rgba('#ffc75a', 0.28);
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    ctx.ellipse(foot.x + 2 * s, baseY - (4 + i * 5) * s, 13 * s, 7.2 * s, 0, 0, TAU);
    ctx.stroke();
  }
  if (level >= 3) {
    // 管线上的压力表
    gauge(ctx, foot.x - 22 * s, baseY - 42 * s, 4.6 * s, 0.55, { face: '#cfc3a4' });
  }
  if (level >= 4) {
    // 挂着的护身符/纸签
    paperTag(ctx, foot.x + 17 * s, baseY - 32 * s, 9 * s, 18 * s, 0.15, {
      fill: 'rgba(230,214,178,0.85)',
      tear: 0.6,
      shadowBlur: 1,
    });
  }
  // 装置底部的暖光
  drawGlow(ctx, '#63e0c2', foot.x + 2 * s, baseY - 12 * s, 22 * s, 0.1);
}

function dropOffset(t) {
  return t * t;
}

// ---------------- 动态层：气密门 ----------------

export function drawDoor(ctx, env) {
  const { layout, room, theme, state, now } = env;
  const door = layout.door;
  const s = layout.scale;
  const hpPct = doorHpRatio(state);
  const level = clamp(state?.player?.doorLevel || 1, 1, 8);
  const topY = door.topY;
  const leftX = door.left.x;
  const width = Math.abs(door.right.x - door.left.x) + Math.abs(door.right.y - door.left.y);
  const skew = door.right.y - door.left.y;
  const doorW = DOOR_HALF_TILES * 2 * TILE.HW * s;
  const doorH = DOOR_HEIGHT * s;
  const x = layout.door.center.x - doorW / 2;
  const y = door.center.y - doorH;
  const seed = Math.floor(hash01(room.w, room.h, Math.round((state?.player?.doorHp || 0) / 12)) * 9999);
  const flashes = env.pulses || {};

  // 门框/门楣（动态绘制，叠在建筑之上）
  drawDoorFrame(ctx, layout, room, theme);

  // 门后透出的暖光
  drawGlow(ctx, theme.lamp, layout.door.center.x, layout.door.center.y - 10 * s, 62 * s, 0.12);

  ctx.save();
  // 门板（微透视：南墙方向有斜度，用轻微斜切）
  ctx.translate(x, y);
  ctx.transform(1, skew / Math.max(1, doorW), 0, 1, 0, 0);
  const w = doorW;
  const h = doorH;
  // 阴影
  ctx.fillStyle = 'rgba(4,6,8,0.5)';
  ctx.fillRect(3, 4, w, h);
  // 门板底
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, 'rgba(78,82,80,1)');
  g.addColorStop(0.35, 'rgba(62,66,64,1)');
  g.addColorStop(0.7, 'rgba(52,56,54,1)');
  g.addColorStop(1, 'rgba(38,42,40,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // 面板分格
  const panel = 5;
  ctx.strokeStyle = 'rgba(22,24,24,0.65)';
  ctx.lineWidth = 1.4;
  for (let i = 1; i < panel; i++) {
    const py = (h / panel) * i;
    ctx.beginPath();
    ctx.moveTo(2, py);
    ctx.lineTo(w - 2, py);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(160,166,160,0.1)';
  ctx.lineWidth = 1;
  for (let i = 1; i < panel; i++) {
    const py = (h / panel) * i;
    ctx.beginPath();
    ctx.moveTo(2, py + 1.5);
    ctx.lineTo(w - 2, py + 1.5);
    ctx.stroke();
  }
  // 加强筋（按门等级增加）
  const bars = Math.min(6, 1 + level);
  for (let i = 0; i < bars; i++) {
    const by = (h / (bars + 1)) * (i + 1);
    const bg = ctx.createLinearGradient(0, by - 4, 0, by + 4);
    bg.addColorStop(0, 'rgba(96,102,98,1)');
    bg.addColorStop(0.5, 'rgba(66,72,68,1)');
    bg.addColorStop(1, 'rgba(40,44,42,1)');
    ctx.fillStyle = bg;
    ctx.fillRect(6, by - 3.5, w - 12, 7);
    ctx.strokeStyle = 'rgba(20,22,20,0.6)';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(6, by - 3.5, w - 12, 7);
    for (let k = 0; k < 4; k++) {
      rivet(ctx, 10 + (k * (w - 20)) / 3, by, 1.5, 'rgba(28,30,28,0.9)', 'rgba(210,205,180,0.35)');
    }
  }
  // 观察窗
  const winY = h * 0.16;
  ctx.fillStyle = 'rgba(22,26,26,0.95)';
  roundRect(ctx, w * 0.34, winY, w * 0.32, h * 0.1, 3, 'rgba(20,24,22,0.95)');
  const wg = ctx.createLinearGradient(0, winY, 0, winY + h * 0.1);
  wg.addColorStop(0, 'rgba(255,216,150,0.55)');
  wg.addColorStop(1, 'rgba(120,150,160,0.25)');
  ctx.fillStyle = wg;
  roundRect(ctx, w * 0.345, winY + 1.4, w * 0.31, h * 0.1 - 2.8, 2.4, wg);
  // 窗上的裂纹
  ctx.strokeStyle = 'rgba(240,240,220,0.25)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(w * 0.36, winY + 2);
  ctx.lineTo(w * 0.44, winY + h * 0.06);
  ctx.lineTo(w * 0.42, winY + h * 0.09);
  ctx.stroke();
  // 转轮把手
  const wx = w * 0.5;
  const wy = h * 0.56;
  const wr = Math.min(w, h) * 0.15;
  ctx.save();
  ctx.translate(wx, wy);
  ctx.rotate(Math.sin(now * 0.2) * 0.01 + (state?.statuses?.doorSpin || 0));
  ctx.strokeStyle = 'rgba(176,152,102,0.95)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, wr, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(40,34,24,0.7)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    ctx.strokeStyle = 'rgba(150,128,84,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * wr, Math.sin(a) * wr);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(90,76,52,1)';
  ctx.beginPath();
  ctx.arc(0, 0, wr * 0.22, 0, TAU);
  ctx.fill();
  ctx.restore();
  // 铰链
  ctx.fillStyle = 'rgba(34,36,34,0.95)';
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(2, h * 0.18 + i * h * 0.24, 6, h * 0.08);
  }
  // 门上的警示牌
  paperTag(ctx, w * 0.27, h * 0.35, w * 0.2, h * 0.16, -0.05, {
    fill: 'rgba(214,200,164,0.9)',
    tear: 0.5,
    shadowBlur: 1.5,
  });
  drawText(ctx, '气密', w * 0.27, h * 0.35 - 2, { size: h * 0.045, color: 'rgba(60,44,26,0.85)', weight: 700 });
  drawText(ctx, 'A-1', w * 0.27, h * 0.35 + 5, { size: h * 0.04, color: 'rgba(60,44,26,0.65)', weight: 700 });
  // 爪痕
  ctx.strokeStyle = 'rgba(200,190,160,0.18)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(w * (0.55 + i * 0.07), h * 0.7);
    ctx.quadraticCurveTo(w * (0.6 + i * 0.07), h * 0.8, w * (0.56 + i * 0.07), h * 0.9);
    ctx.stroke();
  }

  // 受损裂纹与破口
  const damage = 1 - hpPct;
  if (damage > 0.03) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    const cracks = Math.round(damage * 9);
    for (let i = 0; i < cracks; i++) {
      const cx = w * (0.15 + hash01(seed, i, 1) * 0.7);
      const cy = h * (0.12 + hash01(seed, i, 2) * 0.74);
      crackLine(ctx, cx, cy, hash01(seed, i, 3) * TAU, 8 + hash01(seed, i, 4) * 22, 'rgba(10,12,12,0.75)', 0.9 + damage * 1.2, seed + i * 7, 2);
    }
    // 凹陷和污渍
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = `rgba(12,14,14,${0.1 + damage * 0.2})`;
      ctx.beginPath();
      ctx.ellipse(w * hash01(seed, i, 5), h * hash01(seed, i, 6), (4 + damage * 10) * s, (3 + damage * 7) * s, 0, 0, TAU);
      ctx.fill();
    }
    // 低血时的破口火光
    if (hpPct < 0.25) {
      const flick = 0.5 + 0.5 * Math.sin(now * 9.3);
      ctx.fillStyle = `rgba(255,120,60,${0.1 + flick * 0.2})`;
      ctx.beginPath();
      ctx.moveTo(w * 0.15, h * 0.7);
      ctx.lineTo(w * 0.3, h * 0.62);
      ctx.lineTo(w * 0.27, h * 0.78);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // 受击闪白
  if (flashes.door > 0.01) {
    ctx.fillStyle = `rgba(255,236,210,${flashes.door * 0.5})`;
    ctx.fillRect(0, 0, w, h);
  }
  // 维修锁定封印
  const lockUntil = env.repairLockUntil || 0;
  if (lockUntil > env.simNow) {
    const lockA = 0.4 + 0.3 * Math.sin(now * 4);
    ctx.strokeStyle = `rgba(255,107,87,${lockA})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.34, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w / 2 - 8, h / 2);
    ctx.lineTo(w / 2 + 8, h / 2);
    ctx.moveTo(w / 2, h / 2 - 8);
    ctx.lineTo(w / 2, h / 2 + 8);
    ctx.stroke();
    // 红色符文
    ctx.fillStyle = `rgba(255,107,87,${lockA * 0.6})`;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + now * 0.4;
      ctx.beginPath();
      ctx.arc(w / 2 + Math.cos(a) * Math.min(w, h) * 0.4, h / 2 + Math.sin(a) * Math.min(w, h) * 0.4, 2.2, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();

  // 门框上的警报灯（动态）
  const alarmColor = hpPct > 0.6 ? '#7ed9a7' : hpPct > 0.3 ? '#ffc75a' : '#ff5b47';
  const alarmPulse = 0.55 + 0.45 * Math.sin(now * (hpPct < 0.3 ? 8 : 3));
  const lampPos = project(layout, door.tileX, layout.roomH);
  drawGlow(ctx, alarmColor, lampPos.x, topY + 4 * s, 16 * s, 0.3 + alarmPulse * 0.3);
  ctx.fillStyle = alarmColor;
  ctx.beginPath();
  ctx.arc(lampPos.x, topY + 4 * s, 3 * s, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,16,12,0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 门底向走廊漏出的光
  const spillW = doorW * 0.9;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const spill = ctx.createLinearGradient(0, layout.door.center.y, 0, layout.door.center.y + 30 * s);
  spill.addColorStop(0, 'rgba(255,207,130,0.12)');
  spill.addColorStop(1, 'rgba(255,207,130,0)');
  ctx.fillStyle = spill;
  ctx.fillRect(layout.door.center.x - spillW / 2, layout.door.center.y, spillW, 30 * s);
  ctx.restore();

  // 门外地面上的暖光 + 影子
  drawGlow(ctx, '#ffcb7a', layout.door.center.x, layout.door.center.y + 10 * s, 54 * s, 0.08);
}

function doorHpRatio(state) {
  const hp = state?.player?.doorHp;
  const max = state?.player?.doorMaxHp;
  if (typeof hp !== 'number' || typeof max !== 'number' || max <= 0) return 1;
  return clamp(hp / max, 0, 1);
}

// ---------------- 动态层：走廊 ----------------

export function drawCorridorDynamic(ctx, env) {
  const { layout, room, theme, state, now, simNow } = env;
  const t = now;
  const s = layout.scale;
  const roommates = Array.isArray(state?.roommates) ? state.roommates : [];
  const slots = layout.roommates;

  // 走廊冷灯闪烁
  for (let i = 0; i < 2; i++) {
    const lx = room.w * (0.2 + i * 1.1) + 0.4;
    const p = project(layout, lx, layout.roomH + 0.15);
    const flick = 0.7 + 0.3 * Math.sin(t * (7 + i) + i * 2) * (hash01(i, 3) > 0.85 ? 0.2 : 1);
    drawGlow(ctx, CORRIDOR.lamp, p.x, p.y - 70 * s, 34 * s, 0.16 * flick);
    drawGlow(ctx, CORRIDOR.light, p.x, p.y - 4 * s, 80 * s, 0.05 * flick);
  }

  // 舍友门灯
  for (let i = 0; i < slots.length && i < (roommates.length || slots.length); i++) {
    const slot = slots[i];
    const mate = roommates[i];
    const alive = mate ? mate.alive !== false : true;
    const anchor = project(layout, slot.x, layout.roomH + 0.02);
    const doorBottom = anchor.y - 3 * s;
    if (alive) {
      const warm = 'rgba(255,199,102,0.9)';
      const flick = 0.85 + 0.15 * Math.sin(t * 2.2 + i * 1.7);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba('#ffc75a', 0.14 * flick);
      ctx.fillRect(anchor.x - 21 * s, doorBottom, 42 * s, 7 * s);
      ctx.restore();
      drawGlow(ctx, '#ffc75a', anchor.x, doorBottom + 4 * s, 28 * s, 0.16 * flick);
      // 门缝
      ctx.fillStyle = warm;
      ctx.fillRect(anchor.x - 20 * s, doorBottom, 40 * s, 1.6 * s);
    } else {
      ctx.fillStyle = 'rgba(60,66,70,0.7)';
      ctx.fillRect(anchor.x - 20 * s, doorBottom, 40 * s, 1.4 * s);
      // 封条
      ctx.strokeStyle = 'rgba(180,164,110,0.35)';
      ctx.lineWidth = 1.6 * s;
      ctx.beginPath();
      ctx.moveTo(anchor.x - 22 * s, doorBottom - 14 * s);
      ctx.lineTo(anchor.x + 22 * s, doorBottom + 3 * s);
      ctx.stroke();
    }
    // 门牌号（动态，从舍友房间读）
    const label = mate?.roomId ? String(mate.roomId).replace(/\D/g, '').slice(-3) || '???' : '';
    if (label) {
      ctx.save();
      ctx.fillStyle = alive ? 'rgba(240,225,190,0.85)' : 'rgba(140,150,150,0.45)';
      ctx.font = `700 ${8 * s}px ${FONT_SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText(label, anchor.x, anchor.y - 58 * s);
      ctx.restore();
    }
  }

  // 走廊雾（缓慢漂移的冷雾团）
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 5; i++) {
    const phase = hash01(i, 31) * TAU;
    const speed = 0.03 + hash01(i, 32) * 0.04;
    const cx = project(layout, layout.corridor.left + 0.5 + hash01(i, 33) * (layout.corridor.right - layout.corridor.left), layout.roomH + 0.4 + hash01(i, 34) * (layout.corridor.depth - 0.6));
    const x = cx.x + Math.sin(t * speed * TAU + phase) * 60 * s;
    const y = cx.y + Math.cos(t * speed * 0.7 * TAU + phase) * 10 * s;
    ctx.fillStyle = 'rgba(96,125,145,0.035)';
    blobPath(ctx, x, y, (90 + hash01(i, 35) * 120) * s, (22 + hash01(i, 36) * 20) * s, i + 3, t * 0.2, 0.3, 16);
    ctx.fill();
  }
  ctx.restore();

  // 预备阶段的预兆：黑暗里的眼睛
  if (state?.phase === 'prep' && typeof state.prepRemaining === 'number' && state.prepRemaining < 14) {
    const p = project(layout, room.w * 0.5 + 0.7, room.h + 1.9);
    const wake = clamp(1 - state.prepRemaining / 14, 0, 1);
    const blink = 0.6 + 0.4 * Math.sin(t * 1.7);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, '#ff6b57', p.x - 9 * s, p.y - 10 * s, 10 * s, 0.2 * wake * blink);
    drawGlow(ctx, '#ff6b57', p.x + 9 * s, p.y - 10 * s, 10 * s, 0.2 * wake * blink);
    ctx.fillStyle = `rgba(255,138,110,${wake * 0.7})`;
    ctx.beginPath();
    ctx.ellipse(p.x - 9 * s, p.y - 10 * s, 2.6 * s, 1.4 * s, 0.1, 0, TAU);
    ctx.ellipse(p.x + 9 * s, p.y - 10 * s, 2.6 * s, 1.4 * s, -0.1, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // 远处偶尔的冷闪电
  if (state?.phase === 'night') {
    const cyc = t % 17;
    if (cyc > 16.7) {
      const a = (cyc - 16.7) / 0.3;
      const flick = Math.sin(a * Math.PI) * 0.06;
      ctx.save();
      ctx.fillStyle = `rgba(150,190,220,${flick})`;
      ctx.fillRect(0, layout.cssH * 0.42, layout.cssW, layout.cssH * 0.5);
      ctx.restore();
    }
  }
}

export { doorHpRatio };


