// 梦魇：生成、等级/属性缩放、目标切换、回巢、30 个技能效果、小怪。

import {
  CONFIG,
  DIFFICULTIES,
  NIGHTMARES,
  getBuildingLabel,
  getNightmare,
} from '../content/index.js';
import {
  getInternals,
  minionState,
  monsterState,
  nextMinionId,
  nextNightmareId,
  pickRandom,
  random,
  towerState,
} from './internals.js';
import { pushEvent, pushFx } from './fx.js';
import { applyDamageToNightmare, damageDoor } from './damage.js';
import { getPlayerDoorSlow } from './devices.js';

const TOWER_TYPES = new Set(['acid', 'chlorate', 'benzene']);

// 内容里没有给出的小怪基础数值，在这里做最小补充（不修改 content）。
const MINION_BASE = {
  droplet: { hp: 52, damage: 5, interval: 1.35 },
  specimen: { hp: 84, damage: 7.5, interval: 1.75 },
};

function isTowerBuilding(building) {
  return TOWER_TYPES.has(building.type);
}

// 根据梦魇等级与难度重算属性（升级时保持当前生命百分比）。
export function recomputeNightmareStats(state, nightmare) {
  const def = getNightmare(nightmare.type);
  const difficulty = DIFFICULTIES[state.difficulty] || DIFFICULTIES.normal;
  const level = Math.max(1, Math.min(CONFIG.nightmare.maxLevel, nightmare.level));
  // v2.1 每日修饰词：梦魇生命乘数（classic 恒为 1）
  const dailyHpMult =
    state.dailyEffects && Number.isFinite(Number(state.dailyEffects.nightmareHpMult))
      ? Number(state.dailyEffects.nightmareHpMult)
      : 1;
  const maxHp =
    CONFIG.nightmare.baseHp *
    (def.hpMult || 1) *
    (CONFIG.nightmare.hpScale[level] || 1) *
    difficulty.hpMult *
    dailyHpMult;
  const damage =
    CONFIG.nightmare.baseDamage *
    (def.dmgMult || 1) *
    (CONFIG.nightmare.dmgScale[level] || 1) *
    difficulty.dmgMult;
  const ratio = nightmare.maxHp > 0 ? nightmare.hp / nightmare.maxHp : 1;
  nightmare.maxHp = Math.round(maxHp);
  nightmare.hp = Math.round(maxHp * ratio);
  nightmare.damage = Math.round(damage * 10) / 10;
  // speed 在这里解释为整体节奏：越快的梦魇攻击间隔越短。
  nightmare.attackInterval =
    CONFIG.nightmare.baseInterval / (def.speed || 1);
  return nightmare;
}

// ------------------------------ 刷怪 ------------------------------

export function tickSpawns(state) {
  const internals = getInternals(state);
  const difficulty = DIFFICULTIES[state.difficulty] || DIFFICULTIES.normal;

  if (!internals.mainAnnounced && state.now >= state.spawnAt - 5) {
    internals.mainAnnounced = true;
    pushEvent(state, '走廊尽头传来湿漉漉的脚步声……', 'warning');
  }
  if (!internals.mainSpawned && state.now >= state.spawnAt) {
    internals.mainSpawned = true;
    spawnNightmare(state, { secondary: false });
  }

  if (!difficulty.secondary) return;
  if (!internals.secondaryAnnounced && state.nightElapsed >= difficulty.secondaryAt - 10) {
    internals.secondaryAnnounced = true;
    pushEvent(state, '某间黑掉的宿舍里，有什么在回应第一声挠门。', 'warning');
  }
  if (!internals.secondarySpawned && state.nightElapsed >= difficulty.secondaryAt) {
    internals.secondarySpawned = true;
    spawnNightmare(state, { secondary: true });
  }
}

export function spawnNightmare(state, options = {}) {
  const internals = getInternals(state);
  const secondary = Boolean(options.secondary);
  const preview = state.nightmarePreview || {};
  const mainId = preview.mainId;
  let type = options.type;
  if (!type) {
    if (secondary) {
      const candidates = NIGHTMARES.filter((def) => def.id !== mainId);
      type = preview.secondaryId && preview.secondaryId !== mainId
        ? preview.secondaryId
        : pickRandom(state, candidates).id;
    } else {
      type = mainId || pickRandom(state, NIGHTMARES).id;
    }
  }
  const def = getNightmare(type);
  const nightmare = {
    id: nextNightmareId(state),
    type: def.id,
    secondary,
    level: state.pressure.level,
    hp: 0,
    maxHp: 0,
    damage: 0,
    attackInterval: CONFIG.nightmare.baseInterval,
    attackTimer: 0,
    state: 'roam',
    targetRoomId: state.player.roomId,
    spawnAt: state.now,
    announceAt: state.now,
    disabledUntil: 0,
    revealUntil: 0,
    statuses: {
      burnUntil: 0,
      slowUntil: 0,
      stunUntil: 0,
      repairLockUntil: 0,
      stealthUntil: 0,
      shieldUntil: 0,
    },
    skillLevelsFired: [],
  };
  recomputeNightmareStats(state, nightmare);
  nightmare.hp = nightmare.maxHp;
  const ns = monsterState(state, nightmare.id);
  ns.attackAt = secondary
    ? state.now + 8
    : CONFIG.prepDuration + CONFIG.firstAttackDelay;
  ns.nextSwitchAt = ns.attackAt + getSwitchInterval(state, nightmare);
  state.activeNightmares.push(nightmare);

  // 已经达到的等级技能在现身时立即结算一次（周期性技能由每帧逻辑接管）。
  for (const skill of def.skills) {
    if (skill.level <= state.pressure.level) {
      nightmare.skillLevelsFired.push(skill.level);
      fireNightmareSkill(state, nightmare, skill);
    }
  }

  pushEvent(
    state,
    secondary
      ? `第二只梦魇现身：${def.name}（Lv.${nightmare.level}）`
      : `梦魇苏醒了：${def.name}（Lv.${nightmare.level}）`,
    'warning',
  );
  pushFx(state, {
    kind: 'skill',
    space: 'screen',
    x: 0,
    y: 0,
    text: def.name,
    color: def.accent,
    ttl: 2.4,
  });
  return nightmare;
}

// ------------------------------ 压力升级 ------------------------------

export function applyPressureLevels(state, levels) {
  for (const level of levels) {
    for (const nightmare of state.activeNightmares) {
      if (nightmare.state === 'dead') continue;
      nightmare.level = level;
      recomputeNightmareStats(state, nightmare);
      const def = getNightmare(nightmare.type);
      for (const skill of def.skills) {
        if (skill.level !== level) continue;
        if (nightmare.skillLevelsFired.includes(level)) continue;
        nightmare.skillLevelsFired.push(level);
        fireNightmareSkill(state, nightmare, skill);
      }
    }
    pushEvent(state, `压力等级提升：Lv.${level}`, 'level_up');
  }
}

// ------------------------------ 每帧 AI ------------------------------

function weightedPick(state, items) {
  const total = items.reduce((sum, item) => sum + Math.max(0.001, item.weight), 0);
  let roll = random(state) * total;
  for (const item of items) {
    roll -= Math.max(0.001, item.weight);
    if (roll <= 0) return item.roomId;
  }
  return items[items.length - 1].roomId;
}

function getSwitchInterval(state, nightmare) {
  const def = getNightmare(nightmare.type);
  const base = CONFIG.nightmare.targetSwitchInterval;
  if (def.id === 'carbon_monoxide' && state.pressure.level >= 12) return base * 0.5;
  return base;
}

function switchTarget(state, nightmare, ns) {
  const candidates = [
    { roomId: state.player.roomId, weight: Math.max(0.6, state.player.threat || 1) },
  ];
  for (const roommate of state.roommates) {
    if (roommate.alive) candidates.push({ roomId: roommate.roomId, weight: Math.max(0.05, roommate.threat || 0.6) });
  }
  const others = candidates.filter((item) => item.roomId !== nightmare.targetRoomId);
  const pool = others.length > 0 ? others : candidates;
  nightmare.targetRoomId = weightedPick(state, pool);
  ns.nextSwitchAt = state.now + getSwitchInterval(state, nightmare);
  const def = getNightmare(nightmare.type);
  if (nightmare.targetRoomId === state.player.roomId) {
    pushEvent(state, `${def.name} 转向你的房间。`, 'attack');
  } else {
    const roommate = state.roommates.find((rm) => rm.roomId === nightmare.targetRoomId);
    pushEvent(state, `${def.name} 转向 ${roommate ? roommate.name : '舍友'} 的房间。`, 'attack');
  }
}

function ensureTarget(state, nightmare, ns) {
  if (nightmare.targetRoomId === state.player.roomId) return true;
  const roommate = state.roommates.find(
    (rm) => rm.roomId === nightmare.targetRoomId && rm.alive,
  );
  if (roommate) return true;
  nightmare.targetRoomId = state.player.roomId;
  ns.nextSwitchAt = state.now + getSwitchInterval(state, nightmare);
  return true;
}

function enterRetreat(state, nightmare, ns) {
  const def = getNightmare(nightmare.type);
  nightmare.state = 'retreat';
  ns.retreatUntil = state.now + CONFIG.nightmare.retreatDuration;
  pushEvent(state, `${def.name} 血量见底，缩回黑暗里舔伤口。`, 'warning');
  pushFx(state, {
    kind: 'skill',
    space: 'screen',
    x: 0,
    y: 0,
    text: '回巢',
    color: def.accent,
    ttl: 1.6,
  });
}

function performAttack(state, nightmare, def) {
  const ns = monsterState(state, nightmare.id);
  const stealthed = nightmare.statuses.stealthUntil > state.now && (nightmare.revealUntil || 0) <= state.now;
  let damage = nightmare.damage;
  if (stealthed && state.pressure.level >= 9) damage *= 1.8; // 背刺
  damageDoor(state, damage, { roomId: nightmare.targetRoomId, nightmare, kind: 'attack' });
  ns.lastAttackAt = state.now;
}

function tickDots(state, nightmare, ns, dt) {
  if (!Array.isArray(ns.dots) || ns.dots.length === 0) return;
  const now = state.now;
  for (const dot of ns.dots) {
    if (dot.until <= now) continue;
    damageDoor(state, dot.dps * dt, {
      roomId: dot.roomId || nightmare.targetRoomId,
      nightmare,
      kind: dot.kind || 'dot',
    });
  }
  ns.dots = ns.dots.filter((dot) => dot.until > now);
}

function healPercent(state, nightmare, percentPerSecond, dt) {
  nightmare.hp = Math.min(nightmare.maxHp, nightmare.hp + nightmare.maxHp * percentPerSecond * dt);
}

function applyPassives(state, nightmare, ns, def, dt) {
  const level = state.pressure.level;
  const ratio = nightmare.maxHp > 0 ? nightmare.hp / nightmare.maxHp : 1;

  // 汞形怪：按损失生命分裂液滴
  if (def.id === 'mercury' && level >= 3) {
    const thresholds = [0.75, 0.5, 0.25];
    while (ns.splitCount < thresholds.length && ratio <= thresholds[ns.splitCount]) {
      ns.splitCount += 1;
      const bonus = level >= 14 ? 1.5 : 1;
      spawnMinion(state, 'droplet', nightmare.targetRoomId, { bonus });
    }
  }

  // 甲醛标本：未被灼烧时自愈
  if (def.id === 'formaldehyde' && level >= 6 && nightmare.statuses.burnUntil <= state.now && ns.burnUntil <= state.now) {
    healPercent(state, nightmare, 0.015, dt);
  }

  // 汞形怪 Lv12 重构：有小怪时缓慢回血
  if (def.id === 'mercury' && level >= 12) {
    const hasMinion = state.minions.some((m) => m.alive && m.targetRoomId === nightmare.targetRoomId);
    if (hasMinion) healPercent(state, nightmare, 0.005, dt);
  }

  // 终焉形态：持续门伤
  if (def.id === 'phosphorus' && level >= 14) {
    damageDoor(state, 10 * dt, { roomId: nightmare.targetRoomId, nightmare, kind: 'dot' });
  }
  if (def.id === 'hydrogen_sulfide' && level >= 14) {
    damageDoor(state, 2 * dt, { roomId: nightmare.targetRoomId, nightmare, kind: 'dot' });
  }
}

function runPeriodicSkills(state, nightmare, ns, def, dt) {
  const level = state.pressure.level;
  const now = state.now;

  if (def.id === 'formaldehyde' && level >= 3) {
    if (!ns.nextSummonAt) ns.nextSummonAt = now + 6;
    if (now >= ns.nextSummonAt) {
      const count = level >= 14 ? 3 : 2;
      const bonus = level >= 14 ? 1.4 : 1;
      for (let i = 0; i < count; i += 1) {
        spawnMinion(state, 'specimen', nightmare.targetRoomId, { bonus });
      }
      ns.nextSummonAt = now + (level >= 14 ? 9 : 18);
    }
  }

  if (def.id === 'mercury' && level >= 9) {
    if (!ns.nextRainAt) ns.nextRainAt = now + 10;
    if (now >= ns.nextRainAt) {
      const bonus = level >= 14 ? 1.5 : 1;
      for (let i = 0; i < 2; i += 1) {
        spawnMinion(state, 'droplet', nightmare.targetRoomId, { bonus });
      }
      ns.nextRainAt = now + 20;
    }
  }

  if (def.id === 'carbon_monoxide' && level >= 3) {
    if (nightmare.statuses.stealthUntil <= now && now >= ns.nextStealthAt) {
      nightmare.statuses.stealthUntil = now + (level >= 14 ? 9 : 6);
      ns.nextStealthAt = now + 14;
      pushFx(state, {
        kind: 'skill',
        space: 'door',
        x: 0,
        y: 0,
        text: '无形',
        color: '#a9b7c7',
        ttl: 1.2,
      });
    }
  }

  if (def.id === 'phosphorus' && level >= 12) {
    if (!ns.nextExplosionAt) ns.nextExplosionAt = now + 12;
    if (now >= ns.nextExplosionAt && !ns.pendingExplosion) {
      ns.pendingExplosion = { at: now + 2, damage: 55 + level * 4 };
      ns.nextExplosionAt = now + 24;
      pushEvent(state, '白磷鬼火开始蓄力，门口越来越亮……', 'warning');
    }
  }
}

export function tickNightmares(state, dt) {
  if (!state.activeNightmares.length) return;
  const playerRoomId = state.player.roomId;
  const doorSlow = getPlayerDoorSlow(state);

  for (const nightmare of state.activeNightmares) {
    if (!nightmare || nightmare.state === 'dead') continue;
    const def = getNightmare(nightmare.type);
    const ns = monsterState(state, nightmare.id);

    // 压力等级同步（技能由 applyPressureLevels 统一结算）
    if (nightmare.level !== state.pressure.level) {
      nightmare.level = state.pressure.level;
      recomputeNightmareStats(state, nightmare);
    }

    applyPassives(state, nightmare, ns, def, dt);

    // 灼烧 DoT（酸阶段 4+ / 6 命中附加）
    if (ns.burnUntil > state.now && ns.burnDps > 0) {
      applyDamageToNightmare(state, nightmare, ns.burnDps * dt, 'heat', { silent: true });
      if (nightmare.state === 'dead') continue;
    } else if (ns.burnUntil <= state.now) {
      ns.burnDps = 0;
    }

    // 回巢判定
    if (
      nightmare.state === 'attack' &&
      nightmare.maxHp > 0 &&
      nightmare.hp / nightmare.maxHp <= CONFIG.nightmare.retreatHpPct &&
      state.now >= ns.nextRetreatAt
    ) {
      // 回巢有冷却：持续输出高的玩家可以在它下次逃回前把血磨光
      ns.nextRetreatAt = state.now + 45;
      enterRetreat(state, nightmare, ns);
    }
    if (nightmare.state === 'retreat') {
      healPercent(state, nightmare, CONFIG.nightmare.healPerSecondPct, dt);
      if (state.now >= ns.retreatUntil) {
        nightmare.state = 'attack';
        ns.attackTimer = Math.max(0.4, nightmare.attackInterval * 0.6);
        ns.nextSwitchAt = state.now + getSwitchInterval(state, nightmare);
        pushEvent(state, `${def.name} 又回到了门外。`, 'attack');
      }
      continue;
    }

    // 游荡 → 开始挠门
    if (nightmare.state === 'roam') {
      if (state.now >= ns.attackAt) {
        nightmare.state = 'attack';
        ns.attackTimer = Math.max(0.4, nightmare.attackInterval * 0.6);
        ns.nextSwitchAt = state.now + getSwitchInterval(state, nightmare);
        pushEvent(state, `${def.name} 开始挠门。`, 'attack');
      }
      continue;
    }

    ensureTarget(state, nightmare, ns);
    runPeriodicSkills(state, nightmare, ns, def, dt);
    tickDots(state, nightmare, ns, dt);

    // 已蓄力的爆燃
    if (ns.pendingExplosion && state.now >= ns.pendingExplosion.at) {
      const burst = ns.pendingExplosion;
      ns.pendingExplosion = null;
      damageDoor(state, burst.damage, { roomId: nightmare.targetRoomId, nightmare, kind: 'skill' });
      pushEvent(state, `${def.name} 的爆燃轰在门上！`, 'attack');
      pushFx(state, {
        kind: 'skill',
        space: 'door',
        x: 0,
        y: 0,
        text: '爆燃',
        color: def.accent,
        ttl: 1.2,
      });
    }

    // 攻击节奏
    if (nightmare.statuses.stunUntil <= state.now) {
      let slow = 0;
      if (nightmare.targetRoomId === playerRoomId) slow = doorSlow;
      if (nightmare.statuses.slowUntil > state.now) slow = Math.max(slow, ns.slowPct || 0);
      let rate = 1 - Math.min(0.8, slow);
      if (def.id === 'phosphorus' && state.pressure.level >= 6 && nightmare.hp < nightmare.maxHp * 0.4) {
        rate *= 1.25; // 低血狂暴
      }
      nightmare.attackTimer -= dt * Math.max(0.15, rate);
      if (nightmare.attackTimer <= 0) {
        nightmare.attackTimer = Math.max(0.45, nightmare.attackInterval);
        performAttack(state, nightmare, def);
      }
    }

    if (state.now >= ns.nextSwitchAt) switchTarget(state, nightmare, ns);
  }
}

// ------------------------------ 小怪 ------------------------------

export function spawnMinion(state, kind, targetRoomId, options = {}) {
  const base = MINION_BASE[kind] || MINION_BASE.droplet;
  const pressure = state.pressure.level;
  const scale = 1 + (pressure - 1) * 0.16;
  const bonus = options.bonus || 1;
  const hp = Math.round(base.hp * scale * bonus);
  const minion = {
    id: nextMinionId(state),
    kind,
    hp,
    maxHp: hp,
    damage: Math.round(base.damage * scale * bonus * 10) / 10,
    attackInterval: base.interval,
    targetRoomId,
    alive: true,
  };
  state.minions.push(minion);
  const ms = minionState(state, minion.id);
  ms.attackTimer = base.interval;
  pushFx(state, {
    kind: 'text',
    space: 'door',
    x: 0,
    y: 0,
    text: kind === 'droplet' ? '液滴' : '标本虫',
    color: kind === 'droplet' ? '#c9d6de' : '#e8b6c8',
    ttl: 1,
  });
  return minion;
}

export function tickMinions(state, dt) {
  if (!state.minions.length) return;
  for (const minion of state.minions) {
    if (!minion.alive) continue;
    const roomAlive =
      minion.targetRoomId === state.player.roomId ||
      state.roommates.some((rm) => rm.roomId === minion.targetRoomId && rm.alive);
    if (!roomAlive) {
      minion.alive = false;
      continue;
    }
    const ms = minionState(state, minion.id);
    ms.attackTimer -= dt;
    if (ms.attackTimer <= 0) {
      ms.attackTimer = minion.attackInterval;
      damageDoor(state, minion.damage, { roomId: minion.targetRoomId, kind: 'minion' });
    }
  }
}

// ------------------------------ 技能效果 ------------------------------

function pickTower(state) {
  const towers = state.buildings.filter(
    (building) => isTowerBuilding(building) && building.disabledUntil <= state.now,
  );
  return pickRandom(state, towers);
}

export function fireNightmareSkill(state, nightmare, skill) {
  const def = getNightmare(nightmare.type);
  const ns = monsterState(state, nightmare.id);
  const internals = getInternals(state);
  const now = state.now;

  pushEvent(state, `${def.name} 施放【${skill.name}】`, 'skill');
  pushFx(state, {
    kind: 'skill',
    space: 'screen',
    x: 0,
    y: 0,
    text: skill.name,
    color: def.accent,
    ttl: 1.6,
  });

  switch (skill.kind) {
    case 'disable_tower': {
      const tower = pickTower(state);
      if (tower) {
        tower.disabledUntil = now + 2.5;
        pushEvent(state, `${getBuildingLabel(tower)} 被共振干扰停机 2.5 秒。`, 'warning');
      }
      break;
    }
    case 'disable_tower_wide': {
      for (let i = 0; i < 2; i += 1) {
        const tower = pickTower(state);
        if (tower) tower.disabledUntil = now + 2.5;
      }
      break;
    }
    case 'final_disable': {
      for (const building of state.buildings) {
        if (isTowerBuilding(building)) building.disabledUntil = now + 3.2;
      }
      break;
    }
    case 'shield': {
      ns.shieldUntil = now + 5;
      ns.shieldPct = 0.3;
      break;
    }
    case 'corridor_storm': {
      ns.dots.push({ kind: 'storm', roomId: nightmare.targetRoomId, dps: 12, until: now + 8 });
      break;
    }
    case 'burn_door': {
      ns.dots.push({ kind: 'burn', roomId: nightmare.targetRoomId, dps: 10, until: now + 6 });
      break;
    }
    case 'fire_wall': {
      for (const other of state.activeNightmares) {
        if (other.state === 'dead') continue;
        other.statuses.repairLockUntil = Math.max(other.statuses.repairLockUntil || 0, now + 6);
      }
      ns.dots.push({ kind: 'fire', roomId: nightmare.targetRoomId, dps: 8, until: now + 6 });
      break;
    }
    case 'explosion': {
      ns.pendingExplosion = { at: now + 2, damage: 60 + state.pressure.level * 4 };
      break;
    }
    case 'repair_lock': {
      for (const other of state.activeNightmares) {
        if (other.state === 'dead') continue;
        other.statuses.repairLockUntil = Math.max(other.statuses.repairLockUntil || 0, now + 4);
      }
      pushEvent(state, '门被瘴气锁住，暂时无法维修或升级 4 秒。', 'warning');
      break;
    }
    case 'corrosion_cloud': {
      internals.player.towerSlowUntil = now + 6;
      internals.player.towerSlowMult = 0.75;
      break;
    }
    case 'toxic_fog': {
      ns.dots.push({ kind: 'toxic', roomId: nightmare.targetRoomId, dps: 5, until: now + 10 });
      break;
    }
    case 'choke': {
      internals.player.dreamMultUntil = now + 5;
      internals.player.dreamMult = 0.55;
      break;
    }
    case 'stealth':
    case 'final_stealth': {
      nightmare.statuses.stealthUntil = now + (skill.kind === 'final_stealth' ? 9 : 6);
      ns.nextStealthAt = now + 14;
      break;
    }
    case 'income_cut': {
      internals.player.dreamMultUntil = now + 6;
      internals.player.dreamMult = 0.7;
      break;
    }
    case 'summon': {
      const bonus = state.pressure.level >= 14 ? 1.4 : 1;
      for (let i = 0; i < 2; i += 1) spawnMinion(state, 'specimen', nightmare.targetRoomId, { bonus });
      break;
    }
    case 'droplet_rain': {
      for (let i = 0; i < 2; i += 1) spawnMinion(state, 'droplet', nightmare.targetRoomId);
      break;
    }
    case 'fix': {
      const tower = pickTower(state);
      if (tower) {
        const towerInternals = towerState(state, tower.id);
        towerInternals.speedDebuffUntil = now + 6;
        towerInternals.speedDebuffPct = 0.4;
        pushEvent(state, `${getBuildingLabel(tower)} 被标本固定，攻速下降。`, 'warning');
      }
      break;
    }
    case 'enrage':
    case 'physical_resist':
    case 'split':
    case 'reform':
    case 'final_mercury':
    case 'backstab':
    case 'target_switch':
    case 'regen':
    case 'door_vuln':
    case 'final_specimen':
    default:
      // 被动技能：生效逻辑分散在 applyPassives / performAttack / damageDoor 中
      break;
  }
}

// 供引擎判断是否还有未出场的主线梦魇
export function hasPendingNightmare(state) {
  const internals = getInternals(state);
  const difficulty = DIFFICULTIES[state.difficulty] || DIFFICULTIES.normal;
  if (!internals.mainSpawned) return true;
  if (difficulty.secondary && !internals.secondarySpawned) return true;
  return false;
}

