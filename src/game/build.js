// 建造 / 升级 / 拆除 / 酸系进阶与建造上限。

import {
  CONFIG,
  getBuildDef,
  getBuildCost,
  getBuildingLabel,
  getUpgradeCost,
} from '../content/index.js';
import { nextBuildingId } from './internals.js';
import { pushEvent, pushFx } from './fx.js';
import { buildingById, checkTile } from './geometry.js';
import {
  addInvested,
  canPayCost,
  ensurePlayable,
  investedRefund,
  payCost,
  refundCost,
} from './economy.js';
import { recomputeReactions } from './reactions.js';

export function getBuildLimit(state, type) {
  const def = getBuildDef(type);
  if (!def) return { current: 0, max: 0 };
  const current = state.buildings.filter((building) => building.type === type).length;
  const max = Number.isFinite(def.maxCount) ? def.maxCount : null;
  return { current, max };
}

export function getAvailableAcidStages(state) {
  const stages = [];
  for (let stage = 1; stage <= Math.max(1, state.acidUnlocked); stage += 1) stages.push(stage);
  return stages;
}

// 建造预检查：UI 可用它给按钮生成 disabled 原因
export function checkBuild(state, type, options = {}, tile) {
  const playable = ensurePlayable(state);
  if (!playable.ok) return playable;
  const def = getBuildDef(type);
  if (!def) return { ok: false, error: '未知的建筑类型' };
  const opts = options || {};
  let stage = 1;
  if (type === 'acid') {
    stage = opts.stage ?? state.acidUnlocked;
    if (!Number.isInteger(stage) || stage < 1 || stage > CONFIG.acid.maxStage) {
      return { ok: false, error: '非法的酸系阶段' };
    }
    if (stage > state.acidUnlocked) {
      return { ok: false, error: `酸系第 ${stage} 阶段尚未解锁（当前解锁 ${state.acidUnlocked} 阶）` };
    }
  }
  const limit = getBuildLimit(state, type);
  if (limit.max !== null && limit.current >= limit.max) {
    return { ok: false, error: `${def.name}最多只能放置 ${limit.max} 座` };
  }
  const tileCheck = checkTile(state, tile);
  if (!tileCheck.ok) return tileCheck;
  const cost = type === 'acid' ? getBuildCost('acid', { stage }) : getBuildCost(type);
  if (!cost) return { ok: false, error: '该建筑缺少造价配置' };
  const afford = canPayCost(state, cost);
  if (!afford.ok) return afford;
  return { ok: true, stage, cost, def, limit };
}

export function build(state, type, options = {}, tile) {
  const check = checkBuild(state, type, options, tile);
  if (!check.ok) return check;
  payCost(state, check.cost);
  const building = {
    id: nextBuildingId(state),
    type,
    level: 1,
    tile: { x: tile.x, y: tile.y },
    disabledUntil: 0,
    overheat: 0,
    isStarter: false,
    starter: false, // 旧字段兼容别名
    invested: { dream: check.cost.dream || 0, reagent: check.cost.reagent || 0 },
  };
  if (type === 'acid') building.stage = check.stage;
  state.buildings.push(building);
  state.stats.builds += 1;
  pushEvent(state, `建成 ${getBuildingLabel(building)}。`, 'build');
  pushFx(state, {
    kind: 'text',
    space: 'tile',
    x: building.tile.x,
    y: building.tile.y,
    text: getBuildingLabel(building),
    color: check.def.accent || '#9ee7d8',
    ttl: 1.2,
  });
  recomputeReactions(state);
  return { ok: true, id: building.id, stage: building.stage };
}

export function upgradeBuilding(state, id) {
  const playable = ensurePlayable(state);
  if (!playable.ok) return playable;
  const building = buildingById(state, id);
  if (!building) return { ok: false, error: '找不到该装置' };
  const cost = getUpgradeCost(building);
  if (!cost) return { ok: false, error: '该装置已达到最高等级' };
  if (cost.kind !== 'level') {
    return { ok: false, error: '酸塔到达 III 级后需要使用「进阶」研究下一阶段' };
  }
  const afford = canPayCost(state, cost);
  if (!afford.ok) return afford;
  payCost(state, cost);
  addInvested(building, cost);
  building.level = cost.nextLevel;
  pushEvent(state, `${getBuildingLabel(building)} 升级完成。`, 'upgrade');
  pushFx(state, {
    kind: 'text',
    space: 'tile',
    x: building.tile.x,
    y: building.tile.y,
    text: `Lv.${building.level}`,
    color: '#ffe27a',
    ttl: 1,
  });
  recomputeReactions(state);
  return { ok: true, id: building.id, level: building.level };
}

export function sellBuilding(state, id) {
  const playable = ensurePlayable(state);
  if (!playable.ok) return playable;
  const index = state.buildings.findIndex((building) => building.id === id);
  if (index < 0) return { ok: false, error: '找不到该装置' };
  const building = state.buildings[index];
  const refund = investedRefund(building);
  refundCost(state, refund);
  state.buildings.splice(index, 1);
  pushEvent(
    state,
    `拆除 ${getBuildingLabel(building)}，返还梦能 ${refund.dream}${refund.reagent ? ` · 试剂 ${refund.reagent}` : ''}。`,
    'sell',
  );
  pushFx(state, {
    kind: 'text',
    space: 'tile',
    x: building.tile.x,
    y: building.tile.y,
    text: `+${refund.dream}`,
    color: '#ffc75a',
    ttl: 1,
  });
  recomputeReactions(state);
  return { ok: true, id: building.id, refund };
}

/**
 * 酸系进阶：III 级酸塔花费研究成本进入下一阶段，同时提升全局解锁阶段。
 * 任意已解锁阶段的 III 级酸塔都可以进阶（不会降低 acidUnlocked）。
 */
export function evolveAcid(state, id) {
  const playable = ensurePlayable(state);
  if (!playable.ok) return playable;
  const building = buildingById(state, id);
  if (!building) return { ok: false, error: '找不到该装置' };
  if (building.type !== 'acid') return { ok: false, error: '只有酸系炮台可以进阶' };
  if (building.level < CONFIG.acid.maxTier) {
    return { ok: false, error: '酸塔需要先升到 III 级才能进阶' };
  }
  const cost = getUpgradeCost(building);
  if (!cost || cost.kind !== 'evolve') return { ok: false, error: '已经是最高阶段' };
  const afford = canPayCost(state, cost);
  if (!afford.ok) return afford;
  payCost(state, cost);
  addInvested(building, cost);
  const previousStage = building.stage;
  building.stage = cost.nextStage;
  building.level = 1;
  state.acidUnlocked = Math.max(state.acidUnlocked, cost.nextStage);
  pushEvent(
    state,
    `酸系研究完成：${getBuildingLabel(building)}（第 ${previousStage} → ${cost.nextStage} 阶段）。`,
    'upgrade',
  );
  pushFx(state, {
    kind: 'skill',
    space: 'tile',
    x: building.tile.x,
    y: building.tile.y,
    text: cost.nextName || `阶段 ${cost.nextStage}`,
    color: '#b8e37a',
    ttl: 1.6,
  });
  recomputeReactions(state);
  return { ok: true, id: building.id, stage: building.stage, acidUnlocked: state.acidUnlocked };
}

export function getBuildingById(state, id) {
  return buildingById(state, id);
}

