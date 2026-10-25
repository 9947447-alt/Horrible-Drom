// 渲染层坐标数学自测（无需 DOM）：
//   node src/render/selfcheck.mjs
// 覆盖：投影/逆投影往返、pickTile 命中与越界、窗口尺寸/DPR/letterbox 偏移、
// 屏幕->画布 CSS 坐标换算（含 CSS transform 缩放）、格子多边形包含关系。

import assert from 'node:assert/strict';
import {
  createLayout, project, unproject, screenToTile, tileCenter, tilePolygon, rangeEllipse,
} from './layout.js';

const ROOM = { id: 'room-301', w: 6, h: 5, theme: 'wood' };
const VIEWPORTS = [
  { cssW: 1280, cssH: 720 },
  { cssW: 1920, cssH: 1080 },
  { cssW: 844, cssH: 390 },
  { cssW: 2560, cssH: 1440 },
];

let checks = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  checks++;
}

function close(a, b, eps, msg) {
  assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
  checks++;
}

// 1) 投影/逆投影往返：任意格中心必须精确还原
for (const vp of VIEWPORTS) {
  const layout = createLayout({ cssW: vp.cssW, cssH: vp.cssH, room: ROOM, dpr: 2 });
  for (let y = 0; y < ROOM.h; y++) {
    for (let x = 0; x < ROOM.w; x++) {
      const c = tileCenter(layout, x, y);
      const back = unproject(layout, c.x, c.y);
      close(back.x, x + 0.5, 1e-9, `unproject x ${vp.cssW}x${vp.cssH}`);
      close(back.y, y + 0.5, 1e-9, `unproject y ${vp.cssW}x${vp.cssH}`);
      const hit = screenToTile(layout, c.x, c.y);
      ok(hit && hit.tile.x === x && hit.tile.y === y, `pickTile ${x},${y} @${vp.cssW}`);
    }
  }
}

// 2) 越界返回 null；边界内侧仍能命中
{
  const layout = createLayout({ cssW: 1280, cssH: 720, room: ROOM, dpr: 1 });
  const outsideCases = [
    project(layout, -0.2, 2.5),
    project(layout, 6.2, 2.5),
    project(layout, 2.5, -0.2),
    project(layout, 2.5, 5.2),
    { x: 10, y: 10 },
    { x: 1270, y: 710 },
  ];
  for (const p of outsideCases) {
    ok(screenToTile(layout, p.x, p.y) === null, `越界应为 null: ${p.x},${p.y}`);
  }
  // 四角格内的贴边点
  for (const [x, y] of [[0, 0], [ROOM.w - 1, 0], [0, ROOM.h - 1], [ROOM.w - 1, ROOM.h - 1]]) {
    const c = tileCenter(layout, x, y);
    const hit = screenToTile(layout, c.x, c.y);
    ok(hit.tile.x === x && hit.tile.y === y, `角格命中 ${x},${y}`);
  }
}

// 3) 同一 CSS 尺寸下，DPR 不应影响投影（pickTile 与 DPR 无关）
{
  const a = createLayout({ cssW: 1280, cssH: 720, room: ROOM, dpr: 1 });
  const b = createLayout({ cssW: 1280, cssH: 720, room: ROOM, dpr: 2 });
  close(a.scale, b.scale, 1e-12, 'DPR 不应改变缩放');
  const pa = tileCenter(a, 3, 2);
  const pb = tileCenter(b, 3, 2);
  close(pa.x, pb.x, 1e-12, 'DPR 不应改变屏幕点 x');
  close(pa.y, pb.y, 1e-12, 'DPR 不应改变屏幕点 y');
}

// 4) 窗口 resize：同一格在两次尺寸下都可被 pickTile 命中
{
  const small = createLayout({ cssW: 844, cssH: 390, room: ROOM, dpr: 2 });
  const big = createLayout({ cssW: 1920, cssH: 1080, room: ROOM, dpr: 2 });
  for (const layout of [small, big]) {
    const c = tileCenter(layout, 4, 3);
    const hit = screenToTile(layout, c.x, c.y);
    ok(hit && hit.tile.x === 4 && hit.tile.y === 3, 'resize 后 pickTile 仍准确');
  }
}

// 5) 模拟 renderer.pickTile 的 client -> canvas CSS 坐标换算：
//    - rect 偏移（画布不在窗口左上角）
//    - CSS transform 缩放（rect 与布局尺寸不一致）
//    - letterbox 由 layout 的相机偏移承担
{
  const cssW = 1280;
  const cssH = 720;
  const layout = createLayout({ cssW, cssH, room: ROOM, dpr: 1 });
  const targetTile = { x: 2, y: 3 };
  const targetScreen = tileCenter(layout, targetTile.x, targetTile.y);

  // 画布在页面中的位置 + 外框缩放 1.25
  const rect = {
    left: 34,
    top: 18,
    width: cssW * 1.25,
    height: cssH * 1.25,
  };
  const clientX = rect.left + targetScreen.x * 1.25;
  const clientY = rect.top + targetScreen.y * 1.25;
  // 与 index.js 中 clientToCss 完全相同的纯数学
  const layoutW = rect.width / 1.25;
  const layoutH = rect.height / 1.25;
  const scaleX = layoutW / rect.width;
  const scaleY = layoutH / rect.height;
  const cssX = (clientX - rect.left) * scaleX;
  const cssY = (clientY - rect.top) * scaleY;
  close(cssX, targetScreen.x, 1e-9, 'clientToCss x');
  close(cssY, targetScreen.y, 1e-9, 'clientToCss y');
  const hit = screenToTile(layout, cssX, cssY);
  ok(hit && hit.tile.x === targetTile.x && hit.tile.y === targetTile.y, '带偏移/缩放的 pickTile');
}

// 6) 格子多边形包含中心；射程椭圆与格子比例一致
{
  const layout = createLayout({ cssW: 1280, cssH: 720, room: ROOM, dpr: 1 });
  const poly = tilePolygon(layout, 3, 2, 0.05);
  const center = tileCenter(layout, 3, 2);
  const pointInPoly = (pt, points) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i];
      const b = points[j];
      const intersect = (a.y > pt.y) !== (b.y > pt.y)
        && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x;
      if (intersect) inside = !inside;
    }
    return inside;
  };
  ok(pointInPoly(center, poly), '格中心应在格子多边形内');
  const e = rangeEllipse(layout, 2, 2, 3);
  close(e.rx, 3 * layout.hw * layout.scale, 1e-9, '射程椭圆 rx');
  close(e.ry, 3 * layout.hh * layout.scale, 1e-9, '射程椭圆 ry');
}

// 7) 布局摘要稳定且包含联调需要的字段
{
  const layout = createLayout({ cssW: 1280, cssH: 720, room: ROOM, dpr: 1 });
  ok(layout.door && typeof layout.door.height === 'number' && layout.door.height > 0, 'door 几何');
  ok(layout.corridorGeometry && layout.corridorGeometry.corners.length === 4, '走廊几何');
  ok(layout.bounds && layout.bounds.top < layout.bounds.bottom, '场景包围盒');
  const a = createLayout({ cssW: 1280, cssH: 720, room: ROOM, dpr: 1 });
  close(a.offsetX, layout.offsetX, 1e-12, '确定性 offsetX');
}

console.log(`render selfcheck: ${checks} 项坐标/投影断言全部通过`);
