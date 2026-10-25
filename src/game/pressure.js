// 全局压力等级（1–14）：梦魇等级、技能节点都由它驱动。

import { CONFIG } from '../content/index.js';

export function getNextLevelXp(level) {
  if (level >= CONFIG.nightmare.maxLevel) return null;
  const next = CONFIG.nightmare.pressureXpForLevel[level + 1];
  return Number.isFinite(next) ? next : null;
}

export function addPressureXp(state, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  state.pressure.xp += amount;
}

/**
 * 夜晚每帧累计压力经验并结算升级。返回本次新达到的等级数组。
 * 等级技能的实际生效由 nightmare.applyPressureLevels 处理（避免模块循环依赖）。
 */
export function tickPressure(state, dt) {
  state.pressure.xp += CONFIG.nightmare.xpPerSecond * dt;
  const newLevels = [];
  const maxLevel = CONFIG.nightmare.maxLevel;
  while (state.pressure.level < maxLevel) {
    const next = state.pressure.level + 1;
    const need = CONFIG.nightmare.pressureXpForLevel[next];
    if (state.pressure.xp >= need) {
      state.pressure.level = next;
      newLevels.push(next);
    } else {
      break;
    }
  }
  state.pressure.nextLevelXp = getNextLevelXp(state.pressure.level);
  return newLevels;
}

