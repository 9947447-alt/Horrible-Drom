// 功能设备：冷凝器（减速/冷伤）、通风柜（反隐/风伤/降威胁）、中和池（修门/减伤）。

import { getBuildingStats, getDeviceStats } from '../content/index.js';
import { monsterState } from './internals.js';
import { doorPoint, inRadius } from './geometry.js';
import { applyDamageToNightmare } from './damage.js';
import { hasReaction } from './reactions.js';

// 冷凝器 + 低温凝析对玩家门口梦魇的总减速（取最强值，不叠加）。
export function getPlayerDoorSlow(state) {
  const point = doorPoint(state);
  const bonus = hasReaction(state, 'low_temp_condensation') ? 0.12 : 0;
  let slow = 0;
  for (const building of state.buildings) {
    if (building.type !== 'condenser' || building.disabledUntil > state.now) continue;
    const stats = getDeviceStats('condenser', building.level);
    if (!inRadius(building, stats.range, point)) continue;
    slow = Math.max(slow, (stats.slowPct || 0) + bonus);
  }
  return Math.min(0.75, slow);
}

// 通风柜对玩家威胁的削减（降低梦魇切换目标时选中玩家的权重）。
export function getVentThreatReduction(state) {
  const point = doorPoint(state);
  let reduction = 0;
  for (const building of state.buildings) {
    if (building.type !== 'vent' || building.disabledUntil > state.now) continue;
    const stats = getDeviceStats('vent', building.level);
    if (!inRadius(building, stats.revealRange, point)) continue;
    reduction = Math.max(reduction, stats.threatReduction || 0);
  }
  return reduction;
}

export function tickDevices(state, dt) {
  if (!state.buildings.length) return;
  const point = doorPoint(state);
  const barrier = hasReaction(state, 'neutralization_barrier');
  const condensation = hasReaction(state, 'low_temp_condensation');

  for (const building of state.buildings) {
    if (building.disabledUntil > state.now) continue;
    const stats = getBuildingStats(building);
    if (!stats) continue;

    switch (building.type) {
      case 'condenser': {
        if (!inRadius(building, stats.range, point)) break;
        const damage = (stats.coldDps || 0) * dt;
        if (damage <= 0) break;
        for (const nightmare of state.activeNightmares) {
          if (nightmare.state !== 'attack' || nightmare.targetRoomId !== state.player.roomId) continue;
          applyDamageToNightmare(state, nightmare, damage, 'cold', { silent: true });
        }
        break;
      }
      case 'vent': {
        const revealRange = condensation ? (stats.revealRange || 0) + 0.6 : stats.revealRange || 0;
        if (!inRadius(building, revealRange, point)) break;
        for (const nightmare of state.activeNightmares) {
          if (nightmare.state !== 'attack' || nightmare.targetRoomId !== state.player.roomId) continue;
          nightmare.revealUntil = Math.max(nightmare.revealUntil || 0, state.now + 2.5);
          const damage = (stats.windDps || 0) * dt;
          if (damage > 0) applyDamageToNightmare(state, nightmare, damage, 'wind', { silent: true });
        }
        break;
      }
      case 'neutralizer': {
        if (!inRadius(building, stats.range, point)) break;
        const regen = (stats.repairPerSec || 0) + (barrier ? 2 : 0);
        state.player.doorHp = Math.min(
          state.player.doorMaxHp,
          state.player.doorHp + regen * dt,
        );
        // 清除腐蚀类门伤持续效果
        for (const nightmare of state.activeNightmares) {
          const ns = monsterState(state, nightmare.id);
          if (!Array.isArray(ns.dots) || ns.dots.length === 0) continue;
          ns.dots = ns.dots.filter(
            (dot) => dot.roomId !== state.player.roomId || dot.kind !== 'corrosion',
          );
        }
        break;
      }
      default:
        break;
    }
  }
}
