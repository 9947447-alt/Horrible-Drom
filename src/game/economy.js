// 经济与玩家操作：冷凝床/层析仪产出、床与门升级、维修、淋浴。

import { CONFIG, DIFFICULTIES, getDeviceStats } from '../content/index.js';
import { getInternals } from './internals.js';
import { pushEvent, pushFx } from './fx.js';

export function ensurePlayable(state) {
  if (!state || (state.phase !== 'prep' && state.phase !== 'night')) {
    return { ok: false, error: '本局已经结束' };
  }
  return { ok: true };
}

export function canPayCost(state, cost) {
  if (!cost) return { ok: true };
  const dream = Number(cost.dream) || 0;
  const reagent = Number(cost.reagent) || 0;
  if (state.player.dream < dream) return { ok: false, error: '梦能不足' };
  if (state.player.reagent < reagent) return { ok: false, error: '试剂不足' };
  return { ok: true };
}

export function payCost(state, cost) {
  if (!cost) return;
  state.player.dream = Math.max(0, state.player.dream - (Number(cost.dream) || 0));
  state.player.reagent = Math.max(0, state.player.reagent - (Number(cost.reagent) || 0));
}

export function refundCost(state, cost) {
  if (!cost) return;
  state.player.dream += Number(cost.dream) || 0;
  state.player.reagent += Number(cost.reagent) || 0;
}

export function addInvested(building, cost) {
  if (!building.invested) building.invested = { dream: 0, reagent: 0 };
  building.invested.dream += Number(cost.dream) || 0;
  building.invested.reagent += Number(cost.reagent) || 0;
}

// 拆除返还：按累计投入的 50% 计算
export function investedRefund(building) {
  const invested = building.invested || { dream: 0, reagent: 0 };
  return {
    dream: Math.floor((invested.dream || 0) * CONFIG.sellRefund),
    reagent: Math.floor((invested.reagent || 0) * CONFIG.sellRefund),
  };
}

export function getDreamMultiplier(state) {
  const internals = getInternals(state);
  if (internals.player.dreamMultUntil > state.now) return internals.player.dreamMult;
  return 1;
}

// UI / getPreviewStats 用的当前收入（每秒）
export function getIncomeRates(state) {
  const difficulty = DIFFICULTIES[state.difficulty] || DIFFICULTIES.normal;
  const bedIncome = CONFIG.bed.income[state.player.bedLevel] || 0;
  let reagentPerSec = 0;
  for (const building of state.buildings) {
    if (building.type === 'analyzer' && building.disabledUntil <= state.now) {
      reagentPerSec += getDeviceStats('analyzer', building.level).reagentPerSec || 0;
    }
  }
  return {
    dreamPerSec: bedIncome * difficulty.economyMult * getDreamMultiplier(state),
    reagentPerSec: reagentPerSec * difficulty.economyMult,
  };
}

export function tickEconomy(state, dt) {
  const income = getIncomeRates(state);
  const dream = income.dreamPerSec * dt;
  const reagent = income.reagentPerSec * dt;
  if (dream > 0) {
    state.player.dream += dream;
    state.stats.dreamEarned += dream;
  }
  if (reagent > 0) {
    state.player.reagent += reagent;
    state.stats.reagentEarned += reagent;
  }
}

// 「臭气锁修」等技能会在一段时间内锁住维修与升级
export function isRepairLocked(state) {
  return state.activeNightmares.some(
    (nightmare) =>
      nightmare.state !== 'dead' &&
      nightmare.statuses &&
      nightmare.statuses.repairLockUntil > state.now,
  );
}

export function upgradeBed(state) {
  const playable = ensurePlayable(state);
  if (!playable.ok) return playable;
  const nextLevel = state.player.bedLevel + 1;
  if (nextLevel > CONFIG.bed.maxLevel) return { ok: false, error: '冷凝床已达到最高等级' };
  const gate = CONFIG.bed.doorGate[nextLevel];
  if (gate && state.player.doorLevel < gate) {
    return { ok: false, error: `需要气密门达到 ${gate} 级才能继续升级冷凝床` };
  }
  const cost = { dream: CONFIG.bed.upgradeCost[nextLevel] || 0, reagent: 0 };
  const afford = canPayCost(state, cost);
  if (!afford.ok) return afford;
  payCost(state, cost);
  state.player.bedLevel = nextLevel;
  pushEvent(state, `冷凝床升级到 ${nextLevel} 级。`, 'upgrade');
  pushFx(state, {
    kind: 'text',
    space: 'tile',
    x: 0,
    y: 0,
    text: `床 Lv.${nextLevel}`,
    color: '#8fd8ff',
    ttl: 1.1,
  });
  return { ok: true, level: nextLevel };
}

export function upgradeDoor(state) {
  const playable = ensurePlayable(state);
  if (!playable.ok) return playable;
  if (isRepairLocked(state)) return { ok: false, error: '门被臭气锁住，暂时无法维修或升级' };
  const nextLevel = state.player.doorLevel + 1;
  if (nextLevel > CONFIG.door.maxLevel) return { ok: false, error: '气密门已达到最高等级' };
  const cost = {
    dream: CONFIG.door.upgradeCost[nextLevel] || 0,
    reagent: CONFIG.door.upgradeReagent[nextLevel] || 0,
  };
  const afford = canPayCost(state, cost);
  if (!afford.ok) return afford;
  payCost(state, cost);
  state.player.doorLevel = nextLevel;
  state.player.doorMaxHp = CONFIG.door.hp[nextLevel];
  state.player.doorHp = state.player.doorMaxHp;
  pushEvent(state, `气密门升级到 ${nextLevel} 级，门体恢复完整。`, 'upgrade');
  pushFx(state, {
    kind: 'text',
    space: 'door',
    x: 0,
    y: 0,
    text: `门 Lv.${nextLevel}`,
    color: '#ffc75a',
    ttl: 1.2,
  });
  return { ok: true, level: nextLevel };
}

export function repairDoor(state) {
  const playable = ensurePlayable(state);
  if (!playable.ok) return playable;
  if (isRepairLocked(state)) return { ok: false, error: '门被臭气锁住，暂时无法维修' };
  const missing = state.player.doorMaxHp - state.player.doorHp;
  if (missing <= 0) return { ok: false, error: '气密门状态良好，无需维修' };
  const cost = {
    dream: Math.max(CONFIG.repair.minCost, Math.ceil(missing * CONFIG.repair.costPerHp)),
    reagent: 0,
  };
  const afford = canPayCost(state, cost);
  if (!afford.ok) return afford;
  payCost(state, cost);
  state.player.doorHp = state.player.doorMaxHp;
  state.stats.repairs += 1;
  pushEvent(state, `维修气密门（${Math.round(missing)} 点）。`, 'repair');
  pushFx(state, { kind: 'text', space: 'door', x: 0, y: 0, text: '维修', color: '#7ed9a7', ttl: 1 });
  return { ok: true, repaired: Math.round(missing) };
}

export function useShower(state) {
  const playable = ensurePlayable(state);
  if (!playable.ok) return playable;
  if (state.now < state.player.showerReadyAt) {
    return { ok: false, error: `淋浴冷却中（${Math.ceil(state.player.showerReadyAt - state.now)} 秒）` };
  }
  const missing = state.player.doorMaxHp - state.player.doorHp;
  if (missing <= 0) return { ok: false, error: '气密门状态良好，不需要淋浴' };
  const heal = Math.round(state.player.doorMaxHp * CONFIG.shower.healPct);
  state.player.doorHp = Math.min(state.player.doorMaxHp, state.player.doorHp + heal);
  state.player.showerReadyAt = state.now + CONFIG.shower.cooldown;
  const internals = getInternals(state);
  internals.player.purifyUntil = state.now + CONFIG.shower.purifySeconds;
  // 淋浴冲掉门上的持续伤害
  for (const ns of internals.monsters.values()) {
    if (Array.isArray(ns.dots)) ns.dots = ns.dots.filter((dot) => dot.roomId !== state.player.roomId);
  }
  pushEvent(state, `冲了个战斗澡，门体回复 ${heal} 点。`, 'shower');
  pushFx(state, { kind: 'text', space: 'door', x: 0, y: 0, text: '淋浴', color: '#8fd8ff', ttl: 1.2 });
  return { ok: true, healed: heal, readyAt: state.player.showerReadyAt };
}

// 供测试 / UI 判断淋浴冷却
export function getShowerRemaining(state) {
  return Math.max(0, state.player.showerReadyAt - state.now);
}

