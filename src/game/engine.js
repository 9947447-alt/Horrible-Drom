// 模拟主循环：60Hz 固定子步推进准备/夜晚、刷怪、战斗、压力、胜负。

import { getInternals } from './internals.js';
import { pruneFx, pushEvent } from './fx.js';
import { getIncomeRates, tickEconomy } from './economy.js';
import { getVentThreatReduction, tickDevices } from './devices.js';
import { tickTowers } from './combat.js';
import {
  applyPressureLevels,
  hasPendingNightmare,
  tickMinions,
  tickNightmares,
  tickSpawns,
} from './nightmare.js';
import { tickRoommates } from './roommates.js';
import { tickPressure } from './pressure.js';
import { finishRun } from './result.js';
import { getAvailableAcidStages, getBuildLimit } from './build.js';

const SUBSTEP = 1 / 60;
// 极端 dt（例如切后台回来）保护：最多补算 300 秒，其余丢弃。
const MAX_STEP_SECONDS = 300;

export function step(state, dt) {
  if (!state || (state.phase !== 'prep' && state.phase !== 'night') || state.paused) return state;
  let left = Number(dt);
  if (!Number.isFinite(left) || left <= 0) return state;
  left = Math.min(left, MAX_STEP_SECONDS);
  while (left > 1e-9 && (state.phase === 'prep' || state.phase === 'night')) {
    const sub = Math.min(SUBSTEP, left);
    tick(state, sub);
    left -= sub;
  }
  return state;
}

function enterNight(state) {
  state.phase = 'night';
  state.prepRemaining = 0;
  pushEvent(state, '熄灯了。梦魇正在走廊里醒来，守住气密门。', 'warning');
}

function updatePlayerThreat(state) {
  const towerCount = state.buildings.filter(
    (building) => building.type === 'acid' || building.type === 'chlorate' || building.type === 'benzene',
  ).length;
  const ventReduction = getVentThreatReduction(state);
  const base = 2.4 + towerCount * 0.35 + state.player.bedLevel * 0.12;
  state.player.threat = Math.max(0.6, base * (1 - Math.min(0.5, ventReduction)));
}

function cleanupEntities(state) {
  for (let i = state.activeNightmares.length - 1; i >= 0; i -= 1) {
    if (state.activeNightmares[i].state === 'dead') state.activeNightmares.splice(i, 1);
  }
  for (let i = state.minions.length - 1; i >= 0; i -= 1) {
    if (!state.minions[i].alive) state.minions.splice(i, 1);
  }
}

function checkVictory(state) {
  if (state.nightElapsed >= state.dawnAt) {
    finishRun(state, 'victory', '天亮了，梦魇退回黑暗');
    return;
  }
  if (state.activeNightmares.length === 0 && !hasPendingNightmare(state)) {
    finishRun(state, 'victory', '所有梦魇都被滴定干净');
  }
}

function tick(state, dt) {
  state.now += dt;

  // ---------- 准备阶段：只走经济与倒计时 ----------
  if (state.phase === 'prep') {
    state.prepRemaining = Math.max(0, state.prepRemaining - dt);
    tickEconomy(state, dt);
    if (state.prepRemaining <= 1e-9) enterNight(state);
    pruneFx(state);
    return;
  }

  // ---------- 夜晚 ----------
  state.nightElapsed += dt;
  state.clock = Math.min(360, (state.nightElapsed / state.dawnAt) * 360);

  tickEconomy(state, dt);
  updatePlayerThreat(state);
  tickDevices(state, dt);
  tickSpawns(state);
  tickNightmares(state, dt);
  tickMinions(state, dt);
  tickTowers(state, dt);
  tickRoommates(state, dt);

  const newLevels = tickPressure(state, dt);
  if (newLevels.length > 0) applyPressureLevels(state, newLevels);

  cleanupEntities(state);
  pruneFx(state);

  // 门破优先于天亮结算
  if (state.player.doorHp <= 0) {
    finishRun(state, 'defeat', '气密门被梦魇击破');
    return;
  }
  checkVictory(state);
}

/**
 * UI 用的只读预览数据（收入、当前梦魇、建造上限等）。
 * activeNightmares / buildCount 均为数量，详细信息从 state 中读取。
 */
export function getPreviewStats(state) {
  const internals = getInternals(state);
  const income = getIncomeRates(state);
  const buildLimits = {};
  for (const type of [
    'acid',
    'chlorate',
    'benzene',
    'analyzer',
    'condenser',
    'vent',
    'catalyst',
    'neutralizer',
    'accelerator',
    'atm',
  ]) {
    buildLimits[type] = getBuildLimit(state, type);
  }
  const pendingSpawn = !internals.mainSpawned && state.now < state.spawnAt;
  return {
    dreamPerSec: Math.round(income.dreamPerSec * 100) / 100,
    reagentPerSec: Math.round(income.reagentPerSec * 100) / 100,
    activeNightmares: state.activeNightmares.filter((nightmare) => nightmare.state !== 'dead').length,
    buildCount: state.buildings.length,
    acidUnlocked: state.acidUnlocked,
    availableAcidStages: getAvailableAcidStages(state),
    buildLimits,
    doorHpPct: state.player.doorMaxHp > 0 ? state.player.doorHp / state.player.doorMaxHp : 0,
    clock: state.clock,
    nextSpawnIn: pendingSpawn ? Math.max(0, state.spawnAt - state.now) : 0,
    nextLevelXp: state.pressure.nextLevelXp,
    activeReactions: state.reactions.map((pair) => ({ id: pair.id, name: pair.name })),
    nightmarePreview: state.nightmarePreview || null,
    difficulty: state.difficulty,
  };
}

