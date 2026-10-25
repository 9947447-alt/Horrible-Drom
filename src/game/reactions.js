// 反应链：相邻满足条件自动生效（内容见 src/content/reactions.js）。
// 这里负责重新计算 state.reactions，并记录激活/熄灭，供模拟层与 UI 共用。

import { REACTION_LOOKUP, getDeviceStats } from '../content/index.js';
import { getInternals } from './internals.js';
import { pushEvent, pushFx } from './fx.js';
import { doorPoint, isNear, tileDistance } from './geometry.js';

// 建筑对之间的反应规则（“中和屏障”单独处理：门不是建筑）。
const PAIR_RULES = [
  { id: 'catalytic_oxidation', a: 'acid', b: 'catalyst' },
  { id: 'low_temp_condensation', a: 'condenser', b: 'vent' },
  { id: 'electromagnetic_quench', a: 'accelerator', b: 'condenser' },
  { id: 'detonation_oxidation', a: 'chlorate', b: 'catalyst' },
  { id: 'aromatic_resonance', a: 'benzene', b: 'accelerator' },
];

function pairKey(pair) {
  const ids = [String(pair.aId), String(pair.bId)].sort();
  return `${pair.id}:${ids[0]}|${ids[1]}`;
}

function makePair(reactionId, aId, bId) {
  const def = REACTION_LOOKUP[reactionId];
  return { id: reactionId, name: def ? def.name : reactionId, aId, bId };
}

/**
 * 重新计算激活中的反应链。
 * state.reactions 每种反应只保留一条（与 UI / mock 一致），返回同一数组。
 * 返回 [{ id, name, aId, bId }]。
 */
export function recomputeReactions(state) {
  const internals = getInternals(state);
  const point = doorPoint(state);
  const allPairs = [];

  for (const rule of PAIR_RULES) {
    const listA = state.buildings.filter((building) => building.type === rule.a);
    const listB = state.buildings.filter((building) => building.type === rule.b);
    for (const a of listA) {
      for (const b of listB) {
        if (!isNear(state, a, b)) continue;
        allPairs.push(makePair(rule.id, a.id, b.id));
      }
    }
  }

  // 中和屏障：中和池靠近气密门即可（门以 'door' 作为虚拟建筑 id）。
  for (const neutralizer of state.buildings.filter((building) => building.type === 'neutralizer')) {
    const stats = getDeviceStats('neutralizer', neutralizer.level);
    if (tileDistance(neutralizer.tile, point) <= stats.range + 1e-9) {
      allPairs.push(makePair('neutralization_barrier', neutralizer.id, 'door'));
    }
  }

  // 同一反应链只保留一个代表实例（渲染只画一条连线；UI 计数 0..6）
  const byId = new Map();
  for (const pair of allPairs) {
    if (!byId.has(pair.id)) byId.set(pair.id, pair);
  }
  const next = [...byId.values()];
  const previousIds = internals.reactionIds || new Set();

  // 新激活的反应链：记统计 + 事件 + 特效
  for (const pair of next) {
    if (previousIds.has(pair.id)) continue;
    state.stats.reactions += 1;
    const def = REACTION_LOOKUP[pair.id];
    pushEvent(state, `反应链激活：${pair.name}`, 'reaction');
    const source = state.buildings.find((building) => building.id === pair.aId);
    pushFx(state, {
      kind: 'reaction',
      space: source ? 'tile' : 'door',
      x: source ? source.tile.x : 0,
      y: source ? source.tile.y : 0,
      text: pair.name,
      color: def ? def.accent : '#ffffff',
      ttl: 1.4,
    });
  }

  internals.activePairs = new Set(next.map((pair) => pairKey(pair)));
  internals.reactionIds = new Set(next.map((pair) => pair.id));
  state.reactions = next;
  return next;
}

export function hasReaction(state, reactionId) {
  return getInternals(state).reactionIds.has(reactionId);
}

export function reactionPairs(state, reactionId) {
  return state.reactions.filter((pair) => pair.id === reactionId);
}
