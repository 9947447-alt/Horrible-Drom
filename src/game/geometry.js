// 房间几何与范围判定：所有距离都以「格」为单位（格中心欧氏距离）。

import { getRoom, isBuildableTile, getBuildingStats } from '../content/index.js';

const DEVICE_TYPES = new Set([
  'analyzer',
  'condenser',
  'vent',
  'catalyst',
  'neutralizer',
  'accelerator',
  'atm',
]);

export function roomOf(state) {
  return getRoom(state.roomId);
}

export function buildingById(state, id) {
  return state.buildings.find((building) => building.id === id) || null;
}

export function tileDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// 门位于南墙中央：tile 为门内最近的一格地面，point 为门所在的墙面点（范围判定用）。
export function doorInfo(room) {
  const x = Math.floor(room.w / 2);
  return {
    tile: { x, y: room.h - 1 },
    point: { x, y: room.h - 0.5 },
    wall: { x, y: room.h },
  };
}

export function doorPoint(state) {
  return doorInfo(roomOf(state)).point;
}

export function isOccupied(state, tile) {
  return state.buildings.some(
    (building) => building.tile && building.tile.x === tile.x && building.tile.y === tile.y,
  );
}

// 放置合法性：格子必须在房间里、不是床/固定障碍、且没有被已有装置占用。
export function checkTile(state, tile) {
  const room = roomOf(state);
  if (!tile || !Number.isInteger(tile.x) || !Number.isInteger(tile.y)) {
    return { ok: false, error: '请选择放置格子' };
  }
  if (!isBuildableTile(room, tile)) {
    return { ok: false, error: '该格子无法放置装置' };
  }
  if (isOccupied(state, tile)) {
    return { ok: false, error: '该格子已有装置' };
  }
  return { ok: true };
}

// 功能设备的光环半径（用于反应链 / 加速器 / 取款机等“相邻”判定）。
export function auraRange(building) {
  if (!building || !DEVICE_TYPES.has(building.type)) return 0;
  const stats = getBuildingStats(building);
  if (!stats) return 0;
  return Math.max(Number(stats.range) || 0, Number(stats.revealRange) || 0);
}

// 两个建筑是否“相邻/在彼此的光环范围里”。基础相邻为八方向（对角距离 1.42）。
export function isNear(state, a, b) {
  if (!a || !b) return false;
  const radius = Math.max(1.42, auraRange(a), auraRange(b));
  return tileDistance(a.tile, b.tile) <= radius + 1e-9;
}

export function inRadius(building, radius, point) {
  return tileDistance(building.tile, point) <= (Number(radius) || 0) + 1e-9;
}

export function doorDistance(state, building) {
  return tileDistance(building.tile, doorPoint(state));
}

// 炮台射程是否够得到玩家门口（梦魇来袭时的抽象位置）。
export function inDoorRange(state, building) {
  const stats = getBuildingStats(building);
  if (!stats) return false;
  return doorDistance(state, building) <= (Number(stats.range) || 0) + 1e-9;
}
