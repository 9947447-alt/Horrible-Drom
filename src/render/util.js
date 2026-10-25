// 通用数学 / 颜色 / 确定性随机工具。纯函数，可在 Node 中直接导入测试。
// 渲染层的小工具都放这里，避免各模块重复实现。

export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function invLerp(a, b, v) {
  if (a === b) return 0;
  return clamp((v - a) / (b - a), 0, 1);
}

export function smoothstep(edge0, edge1, x) {
  const t = invLerp(edge0, edge1, x);
  return t * t * (3 - 2 * t);
}

export function easeOutCubic(t) {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u;
}

export function easeInOutSine(t) {
  return 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
}

export function easeOutBack(t) {
  const u = clamp(t, 0, 1) - 1;
  return 1 + 2.4 * u * u * u + 1.4 * u * u;
}

export function easeOutElastic(t) {
  const u = clamp(t, 0, 1);
  if (u === 0 || u === 1) return u;
  return Math.pow(2, -9 * u) * Math.sin((u * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
}

// 帧率无关的指数趋近。
export function damp(current, target, lambda, dt) {
  const t = 1 - Math.exp(-lambda * Math.max(0, dt));
  return current + (target - current) * t;
}

// 32 位整数混淆（渲染用的确定性随机，不参与游戏逻辑）。
export function hash32(n) {
  let x = (n | 0) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

// 组合多个数值得到一个 [0,1) 的确定性随机数。
export function hash01(...nums) {
  let h = 0x9e3779b9;
  for (let i = 0; i < nums.length; i++) {
    const n = nums[i] | 0;
    h = (hash32(h ^ n) + 0x7f4a7c15) >>> 0;
    h = hash32(h + i * 0x27d4eb2d);
  }
  return h / 4294967296;
}

// 字符串 -> 32 位种子。
export function hashString(str) {
  let h = 0x811c9dc5;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFrom(seed) {
  return mulberry32(typeof seed === 'string' ? hashString(seed) : seed >>> 0);
}

export function rngRange(rng, min, max) {
  return min + (max - min) * rng();
}

export function rngInt(rng, min, max) {
  return Math.floor(min + (max - min + 1) * rng());
}

export function pickWeighted(rng, list) {
  if (!list || !list.length) return null;
  let total = 0;
  for (const item of list) total += item.weight ?? 1;
  let r = rng() * total;
  for (const item of list) {
    r -= item.weight ?? 1;
    if (r <= 0) return item;
  }
  return list[list.length - 1];
}

// 平滑的确定性噪声，用于灯光闪烁 / 火焰抖动。
export function smoothNoise(t, seed = 1) {
  return (
    Math.sin(t * 1.7 + seed * 1.13) * 0.5 +
    Math.sin(t * 3.1 + seed * 2.71) * 0.3 +
    Math.sin(t * 7.3 + seed * 0.57) * 0.2
  );
}

export function pulse(t, speed = 1, phase = 0) {
  return 0.5 + 0.5 * Math.sin((t * speed + phase) * TAU);
}

export function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function angleTo(x1, y1, x2, y2) {
  return Math.atan2(y2 - y1, x2 - x1);
}

// ---------------- 颜色 ----------------

const COLOR_CACHE = new Map();

export function hexToRgb(hex) {
  let h = String(hex || '#000').replace('#', '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r, g, b) {
  const c = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

// 输出 rgba 字符串；带缓存避免每帧拼字符串。
export function rgba(hex, alpha = 1) {
  const a = Math.round(clamp(alpha, 0, 1) * 1000) / 1000;
  const key = `${hex}|${a}`;
  const hit = COLOR_CACHE.get(key);
  if (hit) return hit;
  const { r, g, b } = hexToRgb(hex);
  const out = `rgba(${r}, ${g}, ${b}, ${a})`;
  if (COLOR_CACHE.size < 4096) COLOR_CACHE.set(key, out);
  return out;
}

export function mixColor(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const u = clamp(t, 0, 1);
  return rgbToHex(lerp(a.r, b.r, u), lerp(a.g, b.g, u), lerp(a.b, b.b, u));
}

export function darken(hex, amt = 0.2) {
  return mixColor(hex, '#000000', amt);
}

export function lighten(hex, amt = 0.2) {
  return mixColor(hex, '#ffffff', amt);
}

// 向暖色/冷色偏移，做出“灯光下的颜色”。
export function shade(hex, hue, amt) {
  return mixColor(hex, hue, amt);
}

export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function contrastText(hex) {
  return luminance(hex) > 0.55 ? '#1a1611' : '#f4ead4';
}

// ---------------- 格式化 ----------------

export function fmtInt(n) {
  const v = Math.round(Number(n) || 0);
  return String(v);
}

export function fmtShort(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 10000) return `${(v / 1000).toFixed(1)}k`;
  if (Math.abs(v) >= 100) return String(Math.round(v));
  if (Math.abs(v) >= 10) return String(Math.round(v * 10) / 10);
  return String(Math.round(v * 10) / 10);
}

export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export function roman(n) {
  return ROMAN[clamp(Math.round(n) || 0, 0, 10)] || String(n);
}

export function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

export function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function choose(v, fallback) {
  return v === undefined || v === null ? fallback : v;
}
