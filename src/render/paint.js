// 程序化“纸雕 + 墨线”绘制工具：软光、阴影、纸纹、笔触、火焰、裂纹、标牌。
// 这里不保存画面状态，全部函数只依赖传入的 ctx 与参数；精灵缓存是只读的。

import { TAU, clamp, lerp, hash01, rgba, mixColor, darken, lighten, rngFrom } from './util.js';
import { FONT_SANS, FONT_SERIF } from './themes.js';
import { tracePolygon } from './layout.js';

// ---------------- 画布/精灵缓存 ----------------

const glowCache = new Map();
const GRAIN_CACHE = new Map();
let shadowSprite = null;

export function makeCanvas(width, height) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(width));
    c.height = Math.max(1, Math.ceil(height));
    return c;
  }
  return { width, height, getContext: () => null };
}

export function createRng(seed) {
  return rngFrom(seed);
}

/** 生成一张柔光精灵（中心亮、向外透明），按颜色缓存。 */
export function getGlowSprite(color, size = 96) {
  const key = `${color}|${size}`;
  const hit = glowCache.get(key);
  if (hit) return hit;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, rgba(color, 0.95));
    g.addColorStop(0.28, rgba(color, 0.5));
    g.addColorStop(0.62, rgba(color, 0.16));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  if (glowCache.size > 80) glowCache.clear();
  glowCache.set(key, c);
  return c;
}

export function drawGlow(ctx, color, x, y, radius, alpha = 1, squash = 1) {
  const sprite = getGlowSprite(color);
  const prevAlpha = ctx.globalAlpha;
  const prevOp = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = prevAlpha * clamp(alpha, 0, 1);
  ctx.drawImage(sprite, x - radius, y - radius * squash, radius * 2, radius * 2 * squash);
  ctx.globalAlpha = prevAlpha;
  ctx.globalCompositeOperation = prevOp;
}

export function getShadowSprite() {
  if (shadowSprite) return shadowSprite;
  const size = 128;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.62)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.24)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  shadowSprite = c;
  return c;
}

export function drawSoftShadow(ctx, x, y, rx, ry, alpha = 0.5) {
  const sprite = getShadowSprite();
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = prevAlpha * clamp(alpha, 0, 1);
  ctx.drawImage(sprite, x - rx, y - ry, rx * 2, ry * 2);
  ctx.globalAlpha = prevAlpha;
}

/** 小颗粒噪声贴图（静态层和全屏覆盖层用）。 */
export function getGrainTile(seed = 7, size = 128) {
  const key = `${seed}|${size}`;
  const hit = GRAIN_CACHE.get(key);
  if (hit) return hit;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  if (ctx && typeof ctx.createImageData === 'function') {
    const img = ctx.createImageData(size, size);
    const rand = rngFrom(seed);
    for (let i = 0; i < size * size; i++) {
      const r = rand();
      const light = r > 0.5;
      const a = Math.floor(rand() * (light ? 34 : 40));
      const p = i * 4;
      img.data[p] = light ? 255 : 0;
      img.data[p + 1] = light ? 246 : 0;
      img.data[p + 2] = light ? 224 : 0;
      img.data[p + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
  }
  GRAIN_CACHE.set(key, c);
  return c;
}

// ---------------- 基础形状 ----------------

export { tracePolygon };

export function fillPoly(ctx, points, fill) {
  if (!points || points.length < 3) return;
  tracePolygon(ctx, points);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function strokePoly(ctx, points, color, width = 1, close = true) {
  if (!points || points.length < 2) return;
  tracePolygon(ctx, points, close);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

export function line(ctx, x1, y1, x2, y2, color, width = 1) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

export function dashedLine(ctx, x1, y1, x2, y2, color, width = 1, dash = [4, 4]) {
  ctx.save();
  ctx.beginPath();
  ctx.setLineDash(dash);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

export function roundRectPath(ctx, x, y, w, h, r = 3) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export function roundRect(ctx, x, y, w, h, r, fill) {
  roundRectPath(ctx, x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

/** 有机 blob 闭合路径：用正弦扰动椭圆半径，再以二次曲线平滑。 */
export function blobPath(ctx, cx, cy, rx, ry, seed = 1, t = 0, wobble = 0.12, points = 20) {
  const pts = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * TAU;
    const k = 1 + wobble * Math.sin(a * 3 + seed * 2.3 + t * 1.6) + wobble * 0.6 * Math.sin(a * 5 - seed * 1.7 + t * 2.4);
    pts.push({ x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k });
  }
  ctx.beginPath();
  const first = pts[0];
  const last = pts[points - 1];
  ctx.moveTo((first.x + last.x) / 2, (first.y + last.y) / 2);
  for (let i = 0; i < points; i++) {
    const p = pts[i];
    const n = pts[(i + 1) % points];
    ctx.quadraticCurveTo(p.x, p.y, (p.x + n.x) / 2, (p.y + n.y) / 2);
  }
  ctx.closePath();
}

/** 手绘抖动多边形。 */
export function roughPolyPath(ctx, points, seed = 1, wobble = 1.2, close = true) {
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const jx = (hash01(seed, i, 1) - 0.5) * wobble;
    const jy = (hash01(seed, i, 2) - 0.5) * wobble;
    if (i === 0) ctx.moveTo(p.x + jx, p.y + jy);
    else ctx.lineTo(p.x + jx, p.y + jy);
  }
  if (close) ctx.closePath();
}

/** 两遍轻微错位的描边，模拟铅笔/墨线的手感。 */
export function roughStroke(ctx, points, seed, opts = {}) {
  const width = opts.width ?? 1.4;
  const color = opts.color ?? 'rgba(10,8,6,0.55)';
  const wobble = opts.wobble ?? 1.6;
  const passes = opts.passes ?? 2;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let p = 0; p < passes; p++) {
    ctx.globalAlpha = (opts.alpha ?? 0.7) * (p === 0 ? 1 : 0.5);
    roughPolyPath(ctx, points, seed + p * 17, wobble * (p ? 1.5 : 1), opts.close ?? true);
    ctx.strokeStyle = color;
    ctx.lineWidth = width * (p ? 0.7 : 1);
    ctx.stroke();
  }
  ctx.restore();
}

/** 斜线阴影填充（静态层用）。 */
export function hatchPoly(ctx, points, color, spacing = 7, width = 1, seed = 1) {
  ctx.save();
  tracePolygon(ctx, points);
  ctx.clip();
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - 20;
  const maxX = Math.max(...xs) + 20;
  const minY = Math.min(...ys) - 20;
  const maxY = Math.max(...ys) + 20;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  for (let i = 0, x = minX; x < maxX; x += spacing, i++) {
    ctx.beginPath();
    ctx.moveTo(x, minY);
    ctx.lineTo(x + (maxY - minY) * 0.55, maxY);
    ctx.globalAlpha = 0.5 + 0.5 * hash01(seed, i);
    ctx.stroke();
  }
  ctx.restore();
}

/** 有机污渍。 */
export function stainShape(ctx, cx, cy, radius, color, alpha = 0.25, seed = 1) {
  ctx.save();
  blobPath(ctx, cx, cy, radius, radius * 0.72, seed, 0, 0.22, 16);
  ctx.fillStyle = rgba(color, alpha);
  ctx.fill();
  blobPath(ctx, cx + radius * 0.3, cy + radius * 0.2, radius * 0.6, radius * 0.4, seed + 5, 0, 0.3, 12);
  ctx.fillStyle = rgba(color, alpha * 0.7);
  ctx.fill();
  ctx.restore();
}

/** 墨点飞溅。 */
export function inkSplat(ctx, cx, cy, radius, color, alpha = 0.5, seed = 1) {
  ctx.save();
  ctx.fillStyle = rgba(color, alpha);
  blobPath(ctx, cx, cy, radius, radius * 0.78, seed, 0, 0.28, 14);
  ctx.fill();
  for (let i = 0; i < 5; i++) {
    const a = hash01(seed, i, 3) * TAU;
    const d = radius * (1.1 + hash01(seed, i, 4) * 0.9);
    const r = radius * (0.06 + hash01(seed, i, 5) * 0.14);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** 裂纹线（带分叉）。 */
export function crackLine(ctx, x, y, angle, length, color, width = 1, seed = 1, depth = 3) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  let cx = x;
  let cy = y;
  let a = angle;
  for (let i = 0; i < 7; i++) {
    const seg = (length / 7) * (0.55 + hash01(seed, i) * 0.9);
    a += (hash01(seed, i, 2) - 0.5) * 0.8;
    const nx = cx + Math.cos(a) * seg;
    const ny = cy + Math.sin(a) * seg;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    if (depth > 0 && i > 2 && hash01(seed, i, 6) > 0.55) {
      crackLine(ctx, nx, ny, a + (hash01(seed, i, 7) - 0.5) * 1.8, length * 0.35, color, width * 0.6, seed + i * 13, depth - 1);
    }
    cx = nx;
    cy = ny;
  }
  ctx.restore();
}

/** 火焰：多层舌状路径，供鬼火/燃烧器使用。 */
export function flameShape(ctx, x, baseY, w, h, t, seed = 1, colors = {}) {
  const hot = colors.hot || '#f3ffe0';
  const mid = colors.mid || '#a8ff9e';
  const low = colors.low || '#3f9a50';
  const layers = [
    { k: 1, color: low, alpha: 0.85 },
    { k: 0.68, color: mid, alpha: 0.85 },
    { k: 0.36, color: hot, alpha: 0.9 },
  ];
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const fw = w * layer.k;
    const fh = h * layer.k * (0.92 + 0.08 * Math.sin(t * 5 + seed + li));
    const sway = Math.sin(t * 3.1 + seed * 1.7 + li) * fw * 0.12;
    ctx.beginPath();
    ctx.moveTo(x - fw / 2, baseY);
    ctx.quadraticCurveTo(x - fw * 0.62, baseY - fh * 0.45, x + sway * 0.5, baseY - fh);
    ctx.quadraticCurveTo(x + fw * 0.62, baseY - fh * 0.45, x + fw / 2, baseY);
    ctx.quadraticCurveTo(x, baseY + fh * 0.14, x - fw / 2, baseY);
    ctx.closePath();
    ctx.fillStyle = rgba(layer.color, layer.alpha);
    ctx.fill();
  }
}

/** 电火花折线（返回终点，方便复用）。 */
export function boltPath(ctx, x1, y1, x2, y2, seed = 1, segments = 8, jitter = 10) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  let px = x1;
  let py = y1;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const nx = lerp(x1, x2, t) + (hash01(seed, i, 1) - 0.5) * jitter * (i === segments ? 0 : 1);
    const ny = lerp(y1, y2, t) + (hash01(seed, i, 2) - 0.5) * jitter * (i === segments ? 0 : 1);
    ctx.lineTo(nx, ny);
    px = nx;
    py = ny;
  }
  return { x: px, y: py };
}

/** 热浪/波纹折线。 */
export function wavePath(ctx, x1, y1, x2, y2, amp = 3, waves = 4, phase = 0) {
  ctx.beginPath();
  const steps = Math.max(8, waves * 6);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = lerp(x1, x2, t);
    const y = lerp(y1, y2, t) + Math.sin(t * TAU * waves + phase) * amp * Math.sin(t * Math.PI);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/** 蜘蛛网。 */
export function cobweb(ctx, x, y, radius, color, alpha = 0.18, seed = 1) {
  ctx.save();
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = 0.7;
  const spokes = 5;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * (Math.PI / 2) + hash01(seed, i) * 0.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
    ctx.stroke();
  }
  for (let r = radius * 0.32; r < radius; r *= 1.5) {
    ctx.beginPath();
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * (Math.PI / 2) + 0.1;
      if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.globalAlpha = alpha * (1 - r / radius) * 2;
    ctx.stroke();
  }
  ctx.restore();
}

/** 墙纸剥落/石膏斑块。 */
export function plasterPatch(ctx, cx, cy, rx, ry, color, alpha, seed = 1, points = 14) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const a = (i / points) * TAU;
    const k = 0.62 + hash01(seed, i, 1) * 0.5;
    const x = cx + Math.cos(a) * rx * k;
    const y = cy + Math.sin(a) * ry * k;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = rgba(color, alpha);
  ctx.fill();
  ctx.restore();
}

/** 纸片/胶带/标签：带一点撕裂与折痕。 */
export function paperTag(ctx, x, y, w, h, angle, opts = {}) {
  const fill = opts.fill || '#e8dcc0';
  const edge = opts.edge || 'rgba(84,64,40,0.5)';
  const fold = opts.fold || 'rgba(60,44,26,0.18)';
  const tear = opts.tear ?? 1.2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle || 0);
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2 + (hash01(w, h, 1) - 0.5) * tear * 2);
  ctx.lineTo(w / 2 - (hash01(w, h, 2) - 0.5) * tear * 3, h / 2);
  ctx.lineTo(-w / 2 + (hash01(w, h, 3) - 0.5) * tear * 2, h / 2 - (hash01(w, h, 4) - 0.5) * tear);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.shadowColor = opts.shadow || 'rgba(0,0,0,0.32)';
  ctx.shadowBlur = opts.shadowBlur ?? 3;
  ctx.shadowOffsetY = opts.shadowOffsetY ?? 1.5;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = edge;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // 折痕
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 2, -h / 2 + 2);
  ctx.lineTo(w / 2 - 2, -h / 2 + 2);
  ctx.strokeStyle = fold;
  ctx.stroke();
  ctx.restore();
}

/** 胶带。 */
export function tapeStrip(ctx, x, y, w, h, angle, color = 'rgba(232,220,188,0.5)') {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle || 0);
  ctx.fillStyle = color;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 0.7;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

/** 文本（统一字体栈与描边）。 */
export function drawText(ctx, str, x, y, opts = {}) {
  const size = opts.size ?? 14;
  const weight = opts.weight ?? 600;
  const font = opts.font || FONT_SANS;
  ctx.save();
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = opts.align || 'center';
  ctx.textBaseline = opts.baseline || 'middle';
  if (opts.alpha != null) ctx.globalAlpha *= clamp(opts.alpha, 0, 1);
  if (opts.stroke) {
    ctx.lineJoin = 'round';
    ctx.strokeStyle = opts.stroke;
    ctx.lineWidth = opts.strokeWidth ?? Math.max(2, size * 0.22);
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = opts.color || '#f3e7cf';
  ctx.fillText(str, x, y);
  ctx.restore();
}

/** 中文竖排（用于门牌/告示）。 */
export function drawVerticalText(ctx, chars, x, y, size, opts = {}) {
  const step = opts.step ?? size * 1.15;
  for (let i = 0; i < chars.length; i++) {
    drawText(ctx, chars[i], x, y + i * step, { ...opts, size });
  }
}

/** 一张小纸牌（等级标签、门牌等）。 */
export function drawTag(ctx, x, y, width, height, text, opts = {}) {
  const angle = opts.angle || 0;
  paperTag(ctx, x, y, width, height, angle, {
    fill: opts.fill || '#e8dcc0',
    tear: 0.8,
    shadowBlur: 2,
  });
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (opts.bar) {
    ctx.fillStyle = opts.bar;
    ctx.fillRect(-width / 2 + 1.5, -height / 2 + 1.5, 2.4, height - 3);
  }
  drawText(ctx, text, opts.bar ? 1.5 : 0, 0.5, {
    size: opts.size ?? Math.max(9, height * 0.56),
    color: opts.color || '#3a2c1c',
    weight: opts.weight ?? 700,
    font: opts.font || FONT_SANS,
  });
  ctx.restore();
}

/** 水平纸带横幅（技能名/反应名）。 */
export function drawBanner(ctx, x, y, text, color, opts = {}) {
  ctx.save();
  const size = opts.size ?? 12;
  ctx.font = `700 ${size}px ${FONT_SANS}`;
  const tw = ctx.measureText(text).width;
  const padX = size * 0.7;
  const w = tw + padX * 2;
  const h = size * 1.9;
  ctx.globalAlpha *= opts.alpha ?? 1;
  ctx.fillStyle = 'rgba(11,17,27,0.82)';
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2, 'rgba(11,17,27,0.82)');
  ctx.strokeStyle = rgba(color, 0.65);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x - w / 2 + h * 0.45, y, h * 0.18, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
  drawText(ctx, text, x + h * 0.12, y + 0.5, { size, color, weight: 700 });
  ctx.restore();
}

/** 弧线虚线（射程圈）。 */
export function dashedEllipse(ctx, cx, cy, rx, ry, opts = {}) {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, TAU);
  ctx.setLineDash(opts.dash || [5, 6]);
  ctx.lineDashOffset = opts.offset || 0;
  ctx.strokeStyle = opts.color || 'rgba(244,234,212,0.4)';
  ctx.lineWidth = opts.width ?? 1.2;
  ctx.globalAlpha *= opts.alpha ?? 1;
  ctx.stroke();
  ctx.restore();
}

/** 柔和的径向渐变光池（静态层用；动态请用 drawGlow 精灵）。 */
export function lightPool(ctx, cx, cy, rx, ry, color, alpha = 0.25) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / Math.max(1, rx));
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(1, rx));
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.45, rgba(color, alpha * 0.45));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(1, rx), 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** 竖直线性渐变填充（墙面）。 */
export function verticalGradient(ctx, x, y, w, h, stops) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  for (const [pos, color] of stops) g.addColorStop(pos, color);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

export function lerpColor(a, b, t) {
  return mixColor(a, b, t);
}

export { darken, lighten };

export function tintShape(ctx, points, color, alpha) {
  fillPoly(ctx, points, rgba(color, alpha));
}

/** 小圆点（铆钉/尘埃）。 */
export function dot(ctx, x, y, r, color) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
}

export function gearPath(ctx, cx, cy, r, teeth, rotation = 0) {
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * TAU + rotation;
    const rr = i % 2 === 0 ? r : r * 0.78;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export { FONT_SANS, FONT_SERIF };
