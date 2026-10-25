// 等距投影与画面构图（纯函数）。渲染器的所有屏幕坐标都从这里的投影推导，
// pickTile 使用的逆变换也在这里，便于独立自测。
//
// 坐标系约定：
//   - 房间格 (x, y) 的“地面角点”投影为 sx = (x - y) * hw, sy = (x + y) * hh。
//   - 屏幕坐标单位是 CSS px；DPR 缩放由画布上下文处理。
//   - 床位于左上（0,0）角落；南墙 y = h 是靠近镜头、被剖切的一侧，门外即走廊。
//   - 北墙（y = 0）与西墙（x = 0）是完整背墙，可见墙纸与窗户。

import { clamp } from './util.js';

export const TILE = Object.freeze({
  HW: 54, // 世界单位：格子半宽
  HH: 25, // 世界单位：格子半高（2:1 略压扁，更接近宿舍俯视）
  WALL_H: 118, // 背墙高度（世界单位）
  CUT_H: 16, // 剖切前的矮墙高度
  NEIGHBOR_WALL_H: 104,
  CORRIDOR_DEPTH: 2.15, // 走廊在 y 方向的深度（格）
  CORRIDOR_LEFT: 2.2, // 走廊向房间左侧延伸（格）
  CORRIDOR_RIGHT: 5.9, // 走廊向走廊深处（屏幕右下）延伸（格），容纳其余宿舍门
  DOOR_HALF_TILES: 0.9, // 气密门半宽（格）
  DOOR_HEIGHT: 88, // 气密门高度（世界单位）
});

export const LAYOUT_KEYS = Object.freeze([
  'cssW', 'cssH', 'scale', 'offsetX', 'offsetY', 'hw', 'hh', 'roomW', 'roomH',
]);

// 走廊里舍友宿舍门的槽位：第一个在左，其余在右（配合 5 名舍友）。
export const ROOMMATE_SLOTS = Object.freeze([
  { side: 'left', x: -0.86 },
  { side: 'right', x: 0.9 },
  { side: 'right', x: 2.28 },
  { side: 'right', x: 3.66 },
  { side: 'right', x: 5.04 },
]);

function finite(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * 计算一帧的投影参数。
 * @param {object} opts
 * @param {number} opts.cssW 画布 CSS 宽
 * @param {number} opts.cssH 画布 CSS 高
 * @param {{w:number,h:number,theme?:string,id?:string}} opts.room
 * @param {number} [opts.dpr] 实际渲染 DPR（已含自适应）
 * @param {number} [opts.fitWidth=0.585] 房间地板占画面宽度目标
 * @param {number} [opts.verticalBias=0.455] 房间地板中心在画面高度的位置
 */
export function createLayout({ cssW, cssH, room, dpr = 1, fitWidth = 0.575, verticalBias = 0.45 }) {
  const viewW = Math.max(1, finite(cssW, 1280));
  const viewH = Math.max(1, finite(cssH, 720));
  const roomW = Math.max(1, Math.round(finite(room?.w, 6)));
  const roomH = Math.max(1, Math.round(finite(room?.h, 5)));

  const { HW: hw, HH: hh } = TILE;
  const floorW = (roomW + roomH) * hw;
  const floorH = (roomW + roomH) * hh;
  const corridorH = TILE.CORRIDOR_DEPTH * 2 * hh;
  const sceneH = floorH + TILE.WALL_H + corridorH + TILE.CUT_H;

  // 先按“房间占画面 58.5% 宽”定尺度，再受高度预算约束，避免大房间顶到 HUD。
  const scale = clamp(
    Math.min((viewW * fitWidth) / floorW, (viewH * 0.9) / sceneH),
    0.52,
    2.7
  );

  const centerWorldX = ((roomW - roomH) / 2) * hw;
  const centerWorldY = ((roomW + roomH) / 2) * hh;
  const offsetX = viewW * 0.5 - centerWorldX * scale;
  const offsetY = viewH * verticalBias - centerWorldY * scale;

  const layout = {
    version: 1,
    cssW: viewW,
    cssH: viewH,
    dpr: Math.max(1, finite(dpr, 1)),
    roomW,
    roomH,
    roomId: room?.id || 'room-301',
    themeId: room?.theme || 'wood',
    hw,
    hh,
    scale,
    offsetX,
    offsetY,
    fitWidth,
    verticalBias,
    // 供 HUD 遮挡检查的中央安全区（视觉焦点大致范围）
    safe: {
      x: viewW * 0.17,
      y: viewH * 0.12,
      w: viewW * 0.66,
      h: viewH * 0.66,
    },
    corridor: {
      left: -TILE.CORRIDOR_LEFT,
      right: roomW + TILE.CORRIDOR_RIGHT,
      depth: TILE.CORRIDOR_DEPTH,
    },
    roommates: ROOMMATE_SLOTS.map((slot) => ({
      ...slot,
      x: slot.side === 'left' ? slot.x : roomW + slot.x,
    })),
  };

  layout.floor = floorGeometry(layout);
  layout.walls = wallGeometry(layout);
  layout.door = doorGeometry(layout);
  layout.corridorGeometry = corridorGeometry(layout);
  layout.lamp = lampGeometry(layout);
  layout.bounds = sceneBounds(layout);
  return layout;
}

// ---------------- 基础投影 ----------------

/** 地面坐标 -> CSS 屏幕坐标。 */
export function project(layout, x, y) {
  return {
    x: layout.offsetX + (x - y) * layout.hw * layout.scale,
    y: layout.offsetY + (x + y) * layout.hh * layout.scale,
  };
}

/** 地面坐标 + 世界高度 -> CSS 屏幕坐标（高度向上为负）。 */
export function projectElevated(layout, x, y, z = 0) {
  const p = project(layout, x, y);
  p.y -= z * layout.scale;
  return p;
}

/** CSS 屏幕坐标 -> 连续地面坐标（逆变换，pickTile 的核心）。 */
export function unproject(layout, screenX, screenY) {
  const worldX = (screenX - layout.offsetX) / layout.scale;
  const worldY = (screenY - layout.offsetY) / layout.scale;
  const u = worldX / layout.hw;
  const v = worldY / layout.hh;
  return { x: (u + v) / 2, y: (v - u) / 2 };
}

/**
 * 屏幕坐标 -> 房间格。命中房间范围返回格与连续坐标，否则 null。
 * @returns {{tile:{x:number,y:number}, fx:number, fy:number}|null}
 */
export function screenToTile(layout, screenX, screenY) {
  if (!layout) return null;
  const p = unproject(layout, screenX, screenY);
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  if (p.x < 0 || p.y < 0 || p.x >= layout.roomW || p.y >= layout.roomH) return null;
  return { tile: { x: tx, y: ty }, fx: p.x, fy: p.y };
}

/** 单个格子的四角（CSS 屏幕坐标），inset 以格为单位内缩。 */
export function tilePolygon(layout, tx, ty, inset = 0) {
  const a = project(layout, tx + inset, ty + inset);
  const b = project(layout, tx + 1 - inset, ty + inset);
  const c = project(layout, tx + 1 - inset, ty + 1 - inset);
  const d = project(layout, tx + inset, ty + 1 - inset);
  return [a, b, c, d];
}

/** 格中心屏幕坐标。 */
export function tileCenter(layout, tx, ty) {
  return project(layout, tx + 0.5, ty + 0.5);
}

/** 以格单位表示半径的等距圆：返回屏幕椭圆参数。 */
export function rangeEllipse(layout, tx, ty, radiusTiles) {
  const c = tileCenter(layout, tx, ty);
  return {
    x: c.x,
    y: c.y,
    rx: radiusTiles * layout.hw * layout.scale,
    ry: radiusTiles * layout.hh * layout.scale,
  };
}

// ---------------- 上下文变换：在“瓷砖空间/墙面空间”里作画 ----------------

/** 瓷砖空间变换（x 向右下，y 向左下）。 */
export function tileTransform(layout) {
  const s = layout.scale;
  return {
    a: layout.hw * s,
    b: layout.hh * s,
    c: -layout.hw * s,
    d: layout.hh * s,
    e: layout.offsetX,
    f: layout.offsetY,
  };
}

/** 南墙（y = h）墙面空间：水平沿房间 x，垂直向上。 */
export function southWallTransform(layout, heightScale = 1) {
  const s = layout.scale;
  const h = layout.roomH;
  return {
    a: layout.hw * s,
    b: layout.hh * s,
    c: 0,
    d: -s * heightScale,
    e: layout.offsetX - h * layout.hw * s,
    f: layout.offsetY + h * layout.hh * s,
  };
}

/** 北墙（y = 0）墙面空间。 */
export function northWallTransform(layout) {
  const s = layout.scale;
  return {
    a: layout.hw * s,
    b: layout.hh * s,
    c: 0,
    d: -s,
    e: layout.offsetX,
    f: layout.offsetY,
  };
}

/** 西墙（x = 0）墙面空间。 */
export function westWallTransform(layout) {
  const s = layout.scale;
  return {
    a: -layout.hw * s,
    b: layout.hh * s,
    c: 0,
    d: -s,
    e: layout.offsetX,
    f: layout.offsetY,
  };
}

export function applyMatrix(ctx, m) {
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  return m;
}

/** 把屏幕坐标点数组描成路径。 */
export function tracePolygon(ctx, points, close = true) {
  if (!points || !points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (close) ctx.closePath();
}

// ---------------- 房间几何 ----------------

function floorGeometry(layout) {
  const { roomW: w, roomH: h } = layout;
  const corners = [project(layout, 0, 0), project(layout, w, 0), project(layout, w, h), project(layout, 0, h)];
  return { corners };
}

function wallGeometry(layout) {
  const { roomW: w, roomH: h } = layout;
  const s = layout.scale;
  const wallH = TILE.WALL_H;
  const cutH = TILE.CUT_H;

  // 背墙：北墙（从 (0,0) 到 (w,0)），西墙（从 (0,0) 到 (0,h)）。
  const northBaseA = project(layout, 0, 0);
  const northBaseB = project(layout, w, 0);
  const westBaseA = project(layout, 0, 0);
  const westBaseB = project(layout, 0, h);

  const north = {
    side: 'north',
    transform: northWallTransform(layout),
    base: [northBaseA, northBaseB],
    height: wallH,
    screenHeight: wallH * s,
    lengthTiles: w,
    top: [
      { x: northBaseA.x, y: northBaseA.y - wallH * s },
      { x: northBaseB.x, y: northBaseB.y - wallH * s },
    ],
  };
  const west = {
    side: 'west',
    transform: westWallTransform(layout),
    base: [westBaseA, westBaseB],
    height: wallH,
    screenHeight: wallH * s,
    lengthTiles: h,
    top: [
      { x: westBaseA.x, y: westBaseA.y - wallH * s },
      { x: westBaseB.x, y: westBaseB.y - wallH * s },
    ],
  };

  // 靠近镜头的两条剖切矮墙：南墙（含气密门）与东墙。
  const southTransform = southWallTransform(layout, cutH / TILE.CUT_H);
  const southBase = [project(layout, 0, h), project(layout, w, h)];
  const eastBase = [project(layout, w, 0), project(layout, w, h)];
  const south = {
    side: 'south',
    transform: southTransform,
    base: southBase,
    height: cutH,
    screenHeight: cutH * s,
    lengthTiles: w,
  };
  const east = {
    side: 'east',
    base: eastBase,
    screenHeight: cutH * s,
    lengthTiles: h,
  };

  return { north, west, south, east };
}

function doorGeometry(layout) {
  const { roomW: w, roomH: h } = layout;
  const half = TILE.DOOR_HALF_TILES;
  const cx = w / 2;
  const center = project(layout, cx, h);
  const left = project(layout, cx - half, h);
  const right = project(layout, cx + half, h);
  const s = layout.scale;
  return {
    center,
    left,
    right,
    widthWorld: half * 2 * layout.hw,
    width: right.x - left.x + Math.abs(right.y - left.y) * 0 + 0,
    heightWorld: TILE.DOOR_HEIGHT,
    height: TILE.DOOR_HEIGHT * s,
    bottom: center.y,
    topY: center.y - TILE.DOOR_HEIGHT * s,
    transform: southWallTransform(layout),
    tileX: cx,
    tileY: h,
  };
}

function corridorGeometry(layout) {
  const { roomW: w, roomH: h } = layout;
  const { left, right, depth } = layout.corridor;
  const y0 = h;
  const y1 = h + depth;
  const corners = [
    project(layout, left, y0),
    project(layout, right, y0),
    project(layout, right, y1),
    project(layout, left, y1),
  ];
  const nearLine = [project(layout, left, y1), project(layout, right, y1)];
  const farLine = [project(layout, left, y0), project(layout, right, y0)];
  // 对面宿舍立面：在 y = h 这条墙线上，房间左右两段完整的墙。
  const leftWall = {
    from: left,
    to: -0.12,
    base: [project(layout, left, h), project(layout, -0.12, h)],
  };
  const rightWall = {
    from: w + 0.12,
    to: right,
    base: [project(layout, w + 0.12, h), project(layout, right, h)],
  };
  return { corners, nearLine, farLine, leftWall, rightWall, width: right - left, depth };
}

function lampGeometry(layout) {
  const { roomW: w, roomH: h } = layout;
  const base = project(layout, w * 0.46, h * 0.42);
  return {
    anchor: base,
    hang: TILE.WALL_H * 0.82 * layout.scale,
    bulbY: base.y - TILE.WALL_H * 0.72 * layout.scale,
  };
}

function sceneBounds(layout) {
  const pts = [];
  const walls = layout.walls;
  if (walls) {
    pts.push(...walls.north.top, ...walls.west.top);
    pts.push(...walls.north.base, ...walls.west.base);
  }
  const c = layout.corridorGeometry;
  if (c) pts.push(...c.corners);
  const door = layout.door;
  if (door) {
    pts.push({ x: door.left.x, y: door.topY }, { x: door.right.x, y: door.topY });
  }
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const p of pts) {
    if (!p) continue;
    if (p.x < left) left = p.x;
    if (p.x > right) right = p.x;
    if (p.y < top) top = p.y;
    if (p.y > bottom) bottom = p.y;
  }
  if (!Number.isFinite(left)) return { left: 0, top: 0, right: layout.cssW, bottom: layout.cssH };
  return { left, top, right, bottom };
}

/** 给调试/联调使用的摘要。 */
export function layoutSummary(layout) {
  if (!layout) return null;
  return {
    canvas: { cssW: layout.cssW, cssH: layout.cssH, dpr: layout.dpr },
    room: { id: layout.roomId, w: layout.roomW, h: layout.roomH, theme: layout.themeId },
    tile: { hw: layout.hw, hh: layout.hh, scale: layout.scale },
    origin: { x: layout.offsetX, y: layout.offsetY },
    door: {
      x: layout.door.center.x,
      y: layout.door.center.y,
      height: layout.door.height,
      topY: layout.door.topY,
    },
    corridor: layout.corridor,
    bounds: layout.bounds,
    safe: layout.safe,
  };
}
