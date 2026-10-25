#!/usr/bin/env node
// 无头平衡模拟器：用简单的“玩家机器人”跑不同难度/种子，输出胜率、时长、门压。
// 用法：node tools/balance-sim.mjs [--runs 20] [--difficulty normal] [--strategy mixed]
import {
  createRun, step, build, upgradeBuilding, sellBuilding, upgradeBed, upgradeDoor,
  repairDoor, useShower, evolveAcid, getBuildLimit, getIncomeRates,
} from '../src/game/index.js';
import {
  CONFIG, DIFFICULTIES, ROOMS, getRoom, isBuildableTile,
  getBuildCost, getUpgradeCost, getAcidBuildCost, getAcidStats, getBuildingStats,
  getSpecialStats,
} from '../src/content/index.js';

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}
const RUNS = Number(arg('runs', '20'));
const DIFFICULTY = arg('difficulty', 'normal');
const STRATEGY = arg('strategy', 'mixed');
const ROOM_ID = arg('room', 'room-301');

// 调参覆盖（仅模拟进程内，不写文件）：--base-hp 2200 --base-dmg 16 --interval 1.8 --normal-hp 1.2 等
for (const [key, value] of Object.entries({
  baseHp: arg('base-hp'), baseDamage: arg('base-dmg'), baseInterval: arg('interval'),
})) {
  if (value !== undefined && value !== '') CONFIG.nightmare[key] = Number(value);
}
for (const diff of ['easy', 'normal', 'nightmare']) {
  const hp = arg(`${diff}-hp`); const dmg = arg(`${diff}-dmg`);
  if (hp) DIFFICULTIES[diff].hpMult = Number(hp);
  if (dmg) DIFFICULTIES[diff].dmgMult = Number(dmg);
}

function freeTiles(state) {
  const room = getRoom(state.roomId);
  const list = [];
  for (let y = 0; y < room.h; y += 1) {
    for (let x = 0; x < room.w; x += 1) {
      const tile = { x, y };
      if (!isBuildableTile(room, tile)) continue;
      if (state.buildings.some((b) => b.tile.x === x && b.tile.y === y)) continue;
      list.push(tile);
    }
  }
  return list;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function doorDistance(state, tile) {
  return dist(tile, state.doorPoint);
}

function count(state, type) {
  return state.buildings.filter((b) => b.type === type).length;
}

function canAfford(state, cost) {
  if (!cost) return false;
  return state.player.dream >= (cost.dream || 0) && state.player.reagent >= (cost.reagent || 0);
}

function pickTile(state, type, options = {}) {
  const free = freeTiles(state);
  if (!free.length) return null;
  const anchor = options.anchor;
  const maxDoor = options.maxDoor;
  let pool = free;
  if (maxDoor != null) pool = pool.filter((t) => doorDistance(state, t) <= maxDoor);
  if (!pool.length) pool = free;
  if (anchor) {
    pool.sort((a, b) => dist(a, anchor) - dist(b, anchor));
  } else if (options.awayFromDoor) {
    pool.sort((a, b) => doorDistance(state, b) - doorDistance(state, a));
  } else {
    pool.sort((a, b) => doorDistance(state, a) - doorDistance(state, b));
  }
  return pool[0] || null;
}

function buildAt(state, type, tile, stage) {
  if (!tile) return null;
  const limit = getBuildLimit(state, type);
  if (limit && limit.max != null && limit.current >= limit.max) return null;
  const result = build(state, type, stage ? { stage } : {}, tile);
  return result?.ok ? result.id : null;
}

function highestAcid(state) {
  return state.acidUnlocked;
}

function maybeUpgradeTowers(state, strategy) {
  // 主炮优先：先升到 III，再进阶。
  const acids = state.buildings.filter((b) => b.type === 'acid');
  const acid = acids.sort((a, b) => (a.stage * 10 + a.level) - (b.stage * 10 + b.level)).at(-1);
  if (acid) {
    if (acid.level < 3) {
      if (canAfford(state, getUpgradeCost(acid))) return upgradeBuilding(state, acid.id);
    } else if (acid.stage < 6) {
      if (canAfford(state, getUpgradeCost(acid))) return evolveAcid(state, acid.id);
    }
  }
  if (strategy !== 'acid') {
    const specials = state.buildings
      .filter((b) => strategy === 'mixed' ? (b.type === 'chlorate' || b.type === 'benzene') : b.type === strategy)
      .sort((a, b) => b.level - a.level);
    for (const s of specials) {
      const cost = getUpgradeCost(s);
      if (cost && canAfford(state, cost)) return upgradeBuilding(state, s.id);
    }
  }
  const devices = state.buildings.filter((b) => b.type === 'accelerator' || b.type === 'catalyst');
  for (const d of devices) {
    const cost = getUpgradeCost(d);
    if (cost && canAfford(state, cost)) return upgradeBuilding(state, d.id);
  }
  return null;
}

function act(state, strategy) {
  if (state.phase !== 'prep' && state.phase !== 'night') return;
  const p = state.player;
  const doorRatio = p.doorMaxHp > 0 ? p.doorHp / p.doorMaxHp : 1;

  // 1) 保命
  if (doorRatio < 0.55) {
    const shower = useShower(state);
    if (shower.ok) return;
    if (doorRatio < 0.45) {
      const repair = repairDoor(state);
      if (repair.ok) return;
    }
  }

  // 2) 门 / 床
  const doorCost = { dream: CONFIG.door.upgradeCost[p.doorLevel] || 0, reagent: CONFIG.door.upgradeReagent[p.doorLevel] || 0 };
  const bedCost = { dream: CONFIG.bed.upgradeCost[p.bedLevel] || 0, reagent: 0 };
  const gate = CONFIG.bed.doorGate[p.bedLevel + 1];
  if (p.doorLevel < 8 && doorCost.dream > 0 && canAfford(state, doorCost)) {
    if (doorRatio < 0.75 || p.doorLevel < (gate || 99) - 1 || p.dream > doorCost.dream * 2.1) {
      const r = upgradeDoor(state);
      if (r.ok) return;
    }
  }
  if (p.bedLevel < CONFIG.bed.maxLevel && canAfford(state, bedCost)) {
    const nextGate = CONFIG.bed.doorGate[p.bedLevel + 1];
    if (!nextGate || p.doorLevel >= nextGate) {
      const r = upgradeBed(state);
      if (r.ok) return;
    }
  }

  // 3) 早期经济：层析仪
  if (count(state, 'analyzer') < (state.nightElapsed > 90 ? 2 : 1)) {
    const cost = getBuildCost('analyzer');
    if (canAfford(state, cost)) {
      const id = buildAt(state, 'analyzer', pickTile(state, 'analyzer', { awayFromDoor: true }));
      if (id) return;
    }
  }

  // 4) 主炮：优先高阶段，数量受格子/资源约束
  const acidCount = count(state, 'acid');
  if (acidCount < (strategy === 'acid' ? 8 : 5)) {
    const stage = highestAcid(state);
    const cost = getAcidBuildCost(stage);
    if (canAfford(state, cost)) {
      const stats = getAcidStats(stage, 1);
      const tile = pickTile(state, 'acid', { maxDoor: stats.range - 0.05 });
      const id = buildAt(state, 'acid', tile, stage);
      if (id) return;
    }
  }

  // 5) 特化炮台
  const wantsSpecial = strategy !== 'acid' && count(state, strategy === 'mixed' ? 'chlorate' : strategy) < (strategy === 'mixed' ? 1 : 3);
  if (wantsSpecial) {
    const type = strategy === 'mixed' ? 'chlorate' : strategy;
    const cost = getBuildCost(type);
    if (canAfford(state, cost)) {
      const tile = pickTile(state, type, { maxDoor: (getSpecialStats(type, 1).range || 3) - 0.1 });
      if (buildAt(state, type, tile)) return;
    }
  }

  // 6) 反应与功能设备
  const acidTower = state.buildings.find((b) => b.type === 'acid');
  const catalystCount = count(state, 'catalyst');
  if (acidTower && catalystCount < 2) {
    const cost = getBuildCost('catalyst');
    if (canAfford(state, cost)) {
      const tile = pickTile(state, 'catalyst', { anchor: acidTower.tile });
      if (tile && dist(tile, acidTower.tile) <= 2.2 && buildAt(state, 'catalyst', tile)) return;
    }
  }
  if (count(state, 'condenser') < 1) {
    const cost = getBuildCost('condenser');
    if (canAfford(state, cost)) {
      const tile = pickTile(state, 'condenser', { maxDoor: 3.5 });
      if (buildAt(state, 'condenser', tile)) return;
    }
  }
  const condenser = state.buildings.find((b) => b.type === 'condenser');
  if (condenser && count(state, 'vent') < 1) {
    const cost = getBuildCost('vent');
    if (canAfford(state, cost)) {
      const tile = pickTile(state, 'vent', { anchor: condenser.tile });
      if (tile && dist(tile, condenser.tile) <= 3.2 && buildAt(state, 'vent', tile)) return;
    }
  }
  if (count(state, 'neutralizer') < 1) {
    const cost = getBuildCost('neutralizer');
    if (canAfford(state, cost)) {
      const tile = pickTile(state, 'neutralizer', { maxDoor: 3.0 });
      if (buildAt(state, 'neutralizer', tile)) return;
    }
  }
  if (count(state, 'accelerator') < 2) {
    const cost = getBuildCost('accelerator');
    if (canAfford(state, cost)) {
      const tile = pickTile(state, 'accelerator', { anchor: acidTower?.tile });
      if (tile) {
        const id = buildAt(state, 'accelerator', tile);
        if (id) return;
      }
    }
  }
  if (count(state, 'atm') < 2) {
    const cost = getBuildCost('atm');
    if (canAfford(state, cost)) {
      const tile = pickTile(state, 'atm', { anchor: acidTower?.tile });
      if (tile) {
        const id = buildAt(state, 'atm', tile);
        if (id) return;
      }
    }
  }

  // 7) 升级塔/设备
  return maybeUpgradeTowers(state, strategy);
}

function runSeed(seed) {
  const state = createRun({ roomId: ROOM_ID, difficulty: DIFFICULTY, seed });
  let actionClock = 0;
  let lastAction = -1;
  const dt = 0.2;
  let maxPressure = 1;
  let worstDoor = 1;
  while ((state.phase === 'prep' || state.phase === 'night') && state.now < 1000) {
    step(state, dt);
    actionClock += dt;
    maxPressure = Math.max(maxPressure, state.pressure.level);
    worstDoor = Math.min(worstDoor, state.player.doorHp / state.player.doorMaxHp);
    if (actionClock - lastAction >= 0.5) {
      lastAction = actionClock;
      try { act(state, STRATEGY); } catch (error) { /* keep sim running */ }
    }
  }
  return {
    seed,
    outcome: state.result?.outcome || 'timeout',
    reason: state.result?.reason || '',
    night: Math.round(state.nightElapsed),
    door: Math.round(state.player.doorHp),
    worstDoor: +(worstDoor * 100).toFixed(1),
    level: maxPressure,
    kills: state.stats.kills,
    damage: Math.round(state.stats.damageDealt),
    buildings: state.buildings.length,
    acid: state.acidUnlocked,
    reactions: state.reactions.length,
    grade: state.result?.grade || '-',
  };
}

const results = [];
for (let i = 0; i < RUNS; i += 1) {
  const seed = 1009 + i * 7919;
  results.push(runSeed(seed));
}
const wins = results.filter((r) => r.outcome === 'victory').length;
const defeats = results.filter((r) => r.outcome === 'defeat').length;
const avg = (key) => (results.reduce((sum, r) => sum + r[key], 0) / results.length).toFixed(1);
console.log(`\n${DIFFICULTY} / ${STRATEGY} / ${ROOM_ID} / ${RUNS} seeds`);
console.log(`wins ${wins}/${RUNS} (${((wins / RUNS) * 100).toFixed(0)}%) · defeats ${defeats} · timeout ${RUNS - wins - defeats}`);
console.log(`avg night ${avg('night')}s · avg pressure Lv${avg('level')} · avg kills ${avg('kills')} · avg damage ${avg('damage')} · avg worst door ${avg('worstDoor')}% · avg buildings ${avg('buildings')}`);
console.table(results.map((r) => ({
  seed: r.seed, outcome: r.outcome, night: r.night, door: r.door, worstDoor: r.worstDoor,
  Lv: r.level, kills: r.kills, acid: r.acid, reactions: r.reactions, grade: r.grade, reason: r.reason,
})));
