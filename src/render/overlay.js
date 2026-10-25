// 全屏叠加层：暗角、纸纹、边缘压暗（给 DOM HUD 让出可读性）。
// 在 resize / DPR 变化时重建一次，之后每帧只需一次 drawImage。

import { rgba, rngFrom, hash01, TAU } from './util.js';
import { makeCanvas, getGrainTile } from './paint.js';

export function buildOverlayCanvas(cssW, cssH, dpr) {
  const canvas = makeCanvas(cssW * dpr, cssH * dpr);
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  // 中央亮、四周沉下去的暗角
  const cx = cssW * 0.5;
  const cy = cssH * 0.46;
  const radius = Math.max(cssW, cssH) * 0.72;
  const vg = ctx.createRadialGradient(cx, cy, radius * 0.28, cx, cy, radius);
  vg.addColorStop(0, 'rgba(8,10,14,0)');
  vg.addColorStop(0.55, 'rgba(8,10,14,0.1)');
  vg.addColorStop(0.82, 'rgba(6,8,11,0.32)');
  vg.addColorStop(1, 'rgba(4,6,9,0.62)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, cssW, cssH);

  // 给 DOM HUD 的压暗：左右上下的边缘渐变
  const edge = (x0, y0, x1, y1, stops) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [p, c] of stops) g.addColorStop(p, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cssW, cssH);
  };
  edge(0, 0, 0, cssH * 0.12, [[0, 'rgba(5,7,10,0.5)'], [1, 'rgba(5,7,10,0)']]);
  edge(0, cssH, 0, cssH * 0.83, [[0, 'rgba(5,7,10,0.62)'], [1, 'rgba(5,7,10,0)']]);
  edge(0, 0, cssW * 0.15, 0, [[0, 'rgba(5,7,10,0.4)'], [1, 'rgba(5,7,10,0)']]);
  edge(cssW, 0, cssW * 0.84, 0, [[0, 'rgba(5,7,10,0.5)'], [1, 'rgba(5,7,10,0)']]);

  // 纸纹颗粒（非常轻）
  const grain = getGrainTile(19, 128);
  if (grain) {
    const pattern = ctx.createPattern(grain, 'repeat');
    if (pattern) {
      ctx.save();
      ctx.globalAlpha = 0.055;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.restore();
    }
  }
  // 横向的纸张纤维与划痕
  const rand = rngFrom(1337);
  ctx.save();
  for (let i = 0; i < 11; i++) {
    const y = rand() * cssH;
    const x = rand() * cssW * 0.7;
    const len = cssW * (0.1 + rand() * 0.3);
    ctx.strokeStyle = `rgba(240,230,206,${0.012 + rand() * 0.02})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (rand() - 0.5) * 3);
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const x = rand() * cssW;
    const y = rand() * cssH;
    ctx.fillStyle = `rgba(230,218,190,${0.02 + rand() * 0.03})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.5 + rand() * 1.4, 0, TAU);
    ctx.fill();
  }
  // 四角的轻微油墨脏污
  const corners = [
    [0, 0, 1, 1],
    [cssW, 0, -1, 1],
    [0, cssH, 1, -1],
    [cssW, cssH, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.min(cssW, cssH) * 0.22);
    g.addColorStop(0, 'rgba(8,8,10,0.16)');
    g.addColorStop(1, 'rgba(8,8,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cssW, cssH);
  }
  ctx.restore();
  return canvas;
}
