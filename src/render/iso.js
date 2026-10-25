// 等距实体小工具：盒子/圆柱/薄板/铆钉/仪表/阀门的通用画法。
// 房间道具与建筑共用，保持“纸雕模型”的统一质感。

import { TAU, rgba, clamp, hash01, mixColor, darken } from './util.js';
import { projectElevated, tileCenter } from './layout.js';
import { fillPoly, strokePoly, roundRect, drawText, FONT_SANS, dot } from './paint.js';

/**
 * 等距长方体。返回顶面四角，便于继续加装饰。
 * 只画朝向镜头的南/东两个侧面。
 */
export function isoBox(ctx, layout, x0, y0, x1, y1, zTop, opts = {}) {
  const zBottom = opts.zBottom ?? 0;
  const top = [
    projectElevated(layout, x0, y0, zTop),
    projectElevated(layout, x1, y0, zTop),
    projectElevated(layout, x1, y1, zTop),
    projectElevated(layout, x0, y1, zTop),
  ];
  const topLine = opts.line ?? 'rgba(20,14,9,0.5)';
  const lineWidth = opts.lineWidth ?? 1;
  const south = [
    projectElevated(layout, x0, y1, zBottom),
    projectElevated(layout, x1, y1, zBottom),
    projectElevated(layout, x1, y1, zTop),
    projectElevated(layout, x0, y1, zTop),
  ];
  const east = [
    projectElevated(layout, x1, y0, zBottom),
    projectElevated(layout, x1, y1, zBottom),
    projectElevated(layout, x1, y1, zTop),
    projectElevated(layout, x1, y0, zTop),
  ];
  const alpha = opts.alpha ?? 1;
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (opts.south !== false) {
    fillPoly(ctx, south, opts.southFill || 'rgba(58,40,25,0.95)');
    if (opts.southShade) fillPoly(ctx, south, opts.southShade);
  }
  if (opts.east !== false) {
    fillPoly(ctx, east, opts.eastFill || 'rgba(42,28,17,0.95)');
    if (opts.eastShade) fillPoly(ctx, east, opts.eastShade);
  }
  if (opts.top !== false) {
    fillPoly(ctx, top, opts.topFill || 'rgba(126,96,63,1)');
    if (opts.topHighlight) {
      fillPoly(
        ctx,
        top,
        opts.topHighlight
      );
    }
  }
  if (opts.outline !== false) {
    ctx.globalAlpha *= 0.9;
    strokePoly(ctx, top, topLine, lineWidth);
    ctx.globalAlpha *= 0.6;
    strokePoly(ctx, south, topLine, lineWidth * 0.8);
  }
  ctx.restore();
  return { top, south, east };
}

/** 等距圆柱（罐/桶/柱）。高度向上。 */
export function isoCylinder(ctx, layout, cx, cy, radiusTiles, heightWorld, opts = {}) {
  const s = layout.scale;
  const base = projectElevated(layout, cx, cy, 0);
  const rx = radiusTiles * layout.hw * s;
  const ry = radiusTiles * layout.hh * s;
  const h = heightWorld * s;
  const topY = base.y - h;
  const alpha = opts.alpha ?? 1;
  ctx.save();
  ctx.globalAlpha *= alpha;
  // 侧面
  ctx.beginPath();
  ctx.moveTo(base.x - rx, topY);
  ctx.lineTo(base.x - rx, base.y);
  ctx.ellipse(base.x, base.y, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(base.x + rx, topY);
  ctx.ellipse(base.x, topY, rx, ry, 0, 0, Math.PI, false);
  ctx.closePath();
  const g = ctx.createLinearGradient(base.x - rx, base.y, base.x + rx, base.y);
  g.addColorStop(0, opts.sideDark || 'rgba(40,34,26,0.95)');
  g.addColorStop(0.45, opts.side || 'rgba(96,82,64,0.97)');
  g.addColorStop(1, opts.sideLight || 'rgba(66,55,42,0.97)');
  ctx.fillStyle = g;
  ctx.fill();
  if (opts.band) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(base.x - rx, topY + h * 0.35, rx * 2, h * 0.16);
    ctx.clip();
    ctx.fillStyle = opts.band;
    ctx.fillRect(base.x - rx, topY + h * 0.35, rx * 2, h * 0.16);
    ctx.restore();
  }
  // 顶面
  ctx.beginPath();
  ctx.ellipse(base.x, topY, rx, ry, 0, 0, TAU);
  ctx.fillStyle = opts.top || 'rgba(128,110,86,1)';
  ctx.fill();
  if (opts.topInner) {
    ctx.beginPath();
    ctx.ellipse(base.x, topY, rx * 0.72, ry * 0.72, 0, 0, TAU);
    ctx.fillStyle = opts.topInner;
    ctx.fill();
  }
  if (opts.outline !== false) {
    ctx.strokeStyle = opts.line || 'rgba(18,13,9,0.55)';
    ctx.lineWidth = opts.lineWidth ?? 1;
    ctx.stroke();
  }
  ctx.restore();
  return { base, topY, rx, ry, h };
}

/** 屏幕空间圆柱（建筑上的小罐子），cx/cy 为底部中心。 */
export function screenCylinder(ctx, cx, cy, rx, ry, h, opts = {}) {
  const topY = cy - h;
  ctx.save();
  ctx.globalAlpha *= opts.alpha ?? 1;
  ctx.beginPath();
  ctx.moveTo(cx - rx, topY);
  ctx.lineTo(cx - rx, cy);
  ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(cx + rx, topY);
  ctx.ellipse(cx, topY, rx, ry, 0, 0, Math.PI, false);
  ctx.closePath();
  const g = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
  g.addColorStop(0, opts.sideDark || 'rgba(38,32,25,0.96)');
  g.addColorStop(0.4, opts.side || 'rgba(104,90,70,0.97)');
  g.addColorStop(1, opts.sideLight || 'rgba(58,48,37,0.97)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, topY, rx, ry, 0, 0, TAU);
  ctx.fillStyle = opts.top || 'rgba(140,122,96,1)';
  ctx.fill();
  if (opts.rim) {
    ctx.strokeStyle = opts.rim;
    ctx.lineWidth = opts.lineWidth ?? 1;
    ctx.stroke();
  }
  ctx.restore();
  return { topY, rx, ry };
}

/** 屏幕空间薄板（底座装饰、平台）。 */
export function screenPlate(ctx, cx, cy, rx, ry, h, fill, edge) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - rx, cy - h);
  ctx.lineTo(cx - rx, cy);
  ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(cx + rx, cy - h);
  ctx.ellipse(cx, cy - h, rx, ry, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

/** 等距地面上的小圆斑/铆钉。 */
export function floorDot(ctx, layout, cx, cy, r, color) {
  const p = projectElevated(layout, cx, cy, 0.2);
  const rxp = r * layout.hw * layout.scale;
  const ryp = r * layout.hh * layout.scale;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rxp, ryp, 0, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
}

/** 圆铆钉/螺栓（屏幕上）。 */
export function rivet(ctx, x, y, r, color = 'rgba(30,24,18,0.8)', highlight = 'rgba(255,240,210,0.35)') {
  dot(ctx, x, y, r, color);
  ctx.beginPath();
  ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.42, 0, TAU);
  ctx.fillStyle = highlight;
  ctx.fill();
}

/** 压力表/仪表盘。 */
export function gauge(ctx, x, y, r, value, opts = {}) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = opts.face || '#d8c9a8';
  ctx.fill();
  ctx.strokeStyle = opts.rim || 'rgba(34,26,18,0.85)';
  ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.stroke();
  const a0 = Math.PI * 0.78;
  const a1 = Math.PI * 2.22;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.74, a0, a1);
  ctx.strokeStyle = opts.track || 'rgba(70,54,36,0.6)';
  ctx.lineWidth = Math.max(0.8, r * 0.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.74, a0, a0 + (a1 - a0) * clamp(value, 0, 1));
  ctx.strokeStyle = opts.needleColor || '#b8452f';
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.16, 0, TAU);
  ctx.fillStyle = 'rgba(40,30,20,0.9)';
  ctx.fill();
  ctx.restore();
}

/** 阀门轮盘。 */
export function valveWheel(ctx, x, y, r, color = '#8c7a5e', angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.4, r * 0.2);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.22, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** 纸标签（建筑铭牌）。 */
export function nameplate(ctx, x, y, text, opts = {}) {
  ctx.save();
  const size = opts.size ?? 8;
  const w = opts.width ?? Math.max(24, ctx.measureText(text).width + size * 1.4);
  const h = opts.height ?? size * 1.9;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, 1.5, opts.fill || 'rgba(226,212,184,0.9)');
  ctx.strokeStyle = opts.edge || 'rgba(50,38,24,0.7)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  drawText(ctx, text, x, y + 0.4, {
    size,
    color: opts.color || '#3a2c1c',
    weight: 700,
    font: FONT_SANS,
  });
  ctx.restore();
}

// 常用金属/玻璃色（保持统一的旧实验室 Palette）。
export const ISO = {
  iron: ['rgba(52,56,60,1)', 'rgba(96,102,106,1)'],
  brass: ['rgba(120,92,48,1)', 'rgba(186,150,88,1)'],
  glass: 'rgba(176,214,206,0.32)',
  paper: '#d9c9a7',
  rust: 'rgba(128,66,38,0.9)',
  ink: 'rgba(16,12,9,0.85)',
};
