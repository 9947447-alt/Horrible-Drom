// 模拟层私有状态：随机源、计时器、逐实体冷却等。
// 放在 WeakMap 中，避免污染对 UI / 渲染公开的 GameState 形状（契约字段保持不变）。

import { createRng, normalizeSeed } from './rng.js';

const store = new WeakMap();

function createInternals(state) {
  const buildingCount = Array.isArray(state.buildings) ? state.buildings.length : 0;
  return {
    rng: createRng(normalizeSeed(state.seed)),
    // 室友网络使用独立随机流，避免改变 v1 战斗的随机序列（v1 行为不回归）
    socialRng: createRng(normalizeSeed(`${state.seed}:social`)),
    // 自增 id 计数器
    buildingSeq: Math.max(1, buildingCount),
    nightmareSeq: 0,
    minionSeq: 0,
    eventSeq: 0,
    fxSeq: 0,
    // v2.1 室友求援：下一次求援的 nightElapsed 阈值 / 请求与遗物 id 序号
    nextRequestAt: null,
    requestSeq: 0,
    relicSeq: 0,
    // 逐实体内部计时
    towers: new Map(), // buildingId -> { cooldown, shots, burstTimer, speedDebuffUntil, speedDebuffPct }
    monsters: new Map(), // nightmareId -> 见 monsterState()
    minionStates: new Map(),
    roommateStates: new Map(),
    // 玩家侧临时状态（技能造成的减益 / 净化）
    player: {
      dreamMultUntil: 0,
      dreamMult: 1,
      towerSlowUntil: 0,
      towerSlowMult: 1,
      purifyUntil: 0,
    },
    // 刷怪 / 宣告
    mainSpawned: false,
    mainAnnounced: false,
    secondarySpawned: false,
    secondaryAnnounced: false,
    lastEliminationAt: -1e9,
    lastCoinEventAt: -1e9,
    lastGhostHitEventAt: -1e9,
    // 取款机每秒结算窗口
    atm: new Map(),
    // 当前激活的反应链 pair key 集合
    activePairs: new Set(),
    reactionIds: new Set(),
  };
}

export function getInternals(state) {
  let internals = store.get(state);
  if (!internals) {
    internals = createInternals(state);
    store.set(state, internals);
  }
  return internals;
}

export function random(state) {
  return getInternals(state).rng();
}

// 闭区间随机整数
export function randomInt(state, min, max) {
  if (max <= min) return min;
  return min + Math.floor(random(state) * (max - min + 1));
}

export function pickRandom(state, list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return list[randomInt(state, 0, list.length - 1)];
}

export function nextBuildingId(state) {
  const internals = getInternals(state);
  internals.buildingSeq += 1;
  return `b-${internals.buildingSeq}`;
}

export function nextNightmareId(state) {
  const internals = getInternals(state);
  internals.nightmareSeq += 1;
  return `n-${internals.nightmareSeq}`;
}

export function nextMinionId(state) {
  const internals = getInternals(state);
  internals.minionSeq += 1;
  return `m-${internals.minionSeq}`;
}

export function nextEventId(state) {
  const internals = getInternals(state);
  internals.eventSeq += 1;
  return `e-${internals.eventSeq}`;
}

export function nextFxId(state) {
  const internals = getInternals(state);
  internals.fxSeq += 1;
  return `fx-${internals.fxSeq}`;
}

export function towerState(state, buildingId) {
  const internals = getInternals(state);
  let entry = internals.towers.get(buildingId);
  if (!entry) {
    entry = {
      cooldown: 0,
      shots: 0,
      burstTimer: 0,
      speedDebuffUntil: 0,
      speedDebuffPct: 0,
    };
    internals.towers.set(buildingId, entry);
  }
  return entry;
}

export function monsterState(state, nightmareId) {
  const internals = getInternals(state);
  let entry = internals.monsters.get(nightmareId);
  if (!entry) {
    entry = {
      attackAt: 0,
      nextSwitchAt: 0,
      retreatUntil: 0,
      nextRetreatAt: 0,
      nextStealthAt: 0,
      nextSummonAt: 0,
      nextRainAt: 0,
      nextExplosionAt: 0,
      nextPhysicalResistAt: 0,
      burnUntil: 0,
      burnDps: 0,
      sunderUntil: 0,
      sunderPct: 0,
      shieldUntil: 0,
      shieldPct: 0,
      physicalResistUntil: 0,
      slowUntil: 0,
      slowPct: 0,
      splitCount: 0,
      dots: [],
      pendingExplosion: null,
    };
    internals.monsters.set(nightmareId, entry);
  }
  return entry;
}

export function minionState(state, minionId) {
  const internals = getInternals(state);
  let entry = internals.minionStates.get(minionId);
  if (!entry) {
    entry = { attackTimer: 0 };
    internals.minionStates.set(minionId, entry);
  }
  return entry;
}

export function roommateState(state, roommateId) {
  const internals = getInternals(state);
  let entry = internals.roommateStates.get(roommateId);
  if (!entry) {
    entry = { timer: 0 };
    internals.roommateStates.set(roommateId, entry);
  }
  return entry;
}
