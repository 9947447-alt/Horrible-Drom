// 炮台战斗：射程、攻速、范围/连锁、反应链增伤、过热、取款机转化。

import { getBuildingStats, getDeviceStats } from '../content/index.js';
import { getInternals, monsterState, random, towerState } from './internals.js';
import { inDoorRange } from './geometry.js';
import { pushEvent, pushFx } from './fx.js';
import { applyDamageToMinion, applyDamageToNightmare } from './damage.js';
import { hasReaction } from './reactions.js';

const TOWER_TYPES = new Set(['acid', 'chlorate', 'benzene']);

export function isTowerType(type) {
  return TOWER_TYPES.has(type);
}

// 玩家门口正在进攻的目标（梦魇 / 小怪）
export function collectDoorTargets(state) {
  const targets = [];
  for (const nightmare of state.activeNightmares) {
    if (!nightmare || nightmare.state !== 'attack') continue;
    if (nightmare.targetRoomId !== state.player.roomId) continue;
    const stealthed =
      nightmare.statuses && nightmare.statuses.stealthUntil > state.now;
    if (stealthed && !(nightmare.revealUntil > state.now)) continue;
    targets.push({ kind: 'nightmare', ref: nightmare });
  }
  for (const minion of state.minions) {
    if (!minion.alive || minion.targetRoomId !== state.player.roomId) continue;
    targets.push({ kind: 'minion', ref: minion });
  }
  return targets;
}

// 计算每座炮台的战斗上下文（每帧重建，房间内装置数量很小）
export function getTowerContexts(state) {
  const contexts = new Map();
  const accelerators = state.buildings.filter((building) => building.type === 'accelerator');
  const catalysts = state.buildings.filter((building) => building.type === 'catalyst');
  const quench = hasReaction(state, 'electromagnetic_quench');
  const catalytic = hasReaction(state, 'catalytic_oxidation');
  const detonation = hasReaction(state, 'detonation_oxidation');
  const aromatic = hasReaction(state, 'aromatic_resonance');

  for (const building of state.buildings) {
    if (!TOWER_TYPES.has(building.type)) continue;
    const stats = getBuildingStats(building);
    if (!stats) continue;
    const context = {
      stats,
      inRange: inDoorRange(state, building),
      damageMult: 1,
      speedMult: 1,
      chains: stats.chains || 0,
      aoe: stats.aoe || 0,
      spread: false,
      periodicBurst: 0,
      electric: false,
      extraElectricDamage: 0,
      stunChance: 0,
    };

    // 加速器光环：攻速 / 电属性
    for (const accelerator of accelerators) {
      const accelStats = getDeviceStats('accelerator', accelerator.level);
      const distance = Math.hypot(
        building.tile.x - accelerator.tile.x,
        building.tile.y - accelerator.tile.y,
      );
      if (distance > accelStats.range + 1e-9) continue;
      context.speedMult *= 1 + accelStats.attackSpeedBonus;
      if (accelStats.electric) {
        context.electric = true;
        context.extraElectricDamage += stats.damage * 0.15;
      }
      if (quench) context.stunChance += 0.08;
    }

    // 催化氧化：酸系伤害提升、灼烧扩散
    if (building.type === 'acid' && catalytic) {
      for (const catalyst of catalysts) {
        const catalystStats = getDeviceStats('catalyst', catalyst.level);
        const distance = Math.hypot(
          building.tile.x - catalyst.tile.x,
          building.tile.y - catalyst.tile.y,
        );
        if (distance > Math.max(1.42, catalystStats.range) + 1e-9) continue;
        context.damageMult += 0.24 * (1 + catalystStats.reactionBoost);
        context.spread = true;
      }
    }

    // 爆鸣氧化：氯酸钾范围与周期性爆裂
    if (building.type === 'chlorate' && detonation) {
      for (const catalyst of catalysts) {
        const catalystStats = getDeviceStats('catalyst', catalyst.level);
        const distance = Math.hypot(
          building.tile.x - catalyst.tile.x,
          building.tile.y - catalyst.tile.y,
        );
        if (distance > Math.max(1.42, catalystStats.range) + 1e-9) continue;
        context.damageMult += 0.2 * (1 + catalystStats.reactionBoost);
        context.aoe += 0.35 * (1 + catalystStats.reactionBoost);
        context.periodicBurst = 4.5;
      }
    }

    // 芳烃共振：苯炮台连锁 + 攻速
    if (building.type === 'benzene' && aromatic) {
      for (const accelerator of accelerators) {
        const accelStats = getDeviceStats('accelerator', accelerator.level);
        const distance = Math.hypot(
          building.tile.x - accelerator.tile.x,
          building.tile.y - accelerator.tile.y,
        );
        if (distance > accelStats.range + 1e-9) continue;
        context.chains += 1;
        context.speedMult *= 1.25;
      }
    }

    contexts.set(building.id, context);
  }
  return contexts;
}

function convertDamageToDream(state, sourceBuilding, dealt) {
  if (!(dealt > 0)) return;
  const internals = getInternals(state);
  const second = Math.floor(state.now);
  for (const atm of state.buildings) {
    if (atm.type !== 'atm' || atm.disabledUntil > state.now) continue;
    const stats = getDeviceStats('atm', atm.level);
    const distance = Math.hypot(
      sourceBuilding.tile.x - atm.tile.x,
      sourceBuilding.tile.y - atm.tile.y,
    );
    if (distance > stats.range + 1e-9) continue;
    let record = internals.atm.get(atm.id);
    if (!record || record.second !== second) {
      record = { second, earned: 0 };
      internals.atm.set(atm.id, record);
    }
    const remaining = Math.max(0, stats.capPerSec - record.earned);
    const gain = Math.min(remaining, dealt * stats.conversion);
    if (gain <= 0) continue;
    record.earned += gain;
    state.player.dream += gain;
    state.stats.dreamEarned += gain;
    if (state.now - internals.lastCoinEventAt >= 3 && gain >= 1) {
      internals.lastCoinEventAt = state.now;
      pushEvent(state, `取款机结算 +${Math.round(gain)} 梦能。`, 'coin');
    }
  }
}

function hitTarget(state, entry, amount, damageType, sourceBuilding, silent = false) {
  let dealt = 0;
  if (entry.kind === 'nightmare') {
    dealt = applyDamageToNightmare(state, entry.ref, amount, damageType, { silent });
  } else {
    dealt = applyDamageToMinion(state, entry.ref, amount, { silent });
  }
  if (sourceBuilding) convertDamageToDream(state, sourceBuilding, dealt);
  return dealt;
}

// 酸炮命中后的附加效果（内容 effects 字段）
function applyAcidHitEffects(state, building, context, nightmare, dealt) {
  if (building.type !== 'acid') return;
  const now = state.now;
  const ns = monsterState(state, nightmare.id);
  const stats = context.stats;
  const effects = stats.effects || {};
  if (effects.slow) {
    ns.slowUntil = now + 2.5;
    ns.slowPct = Math.max(ns.slowPct || 0, effects.slow);
    nightmare.statuses.slowUntil = ns.slowUntil; // 供 UI 展示“减速”
  }
  if (effects.knockback) {
    nightmare.attackTimer = Math.max(0, (nightmare.attackTimer || 0) - 0.15);
  }
  if (effects.sunder) {
    ns.sunderUntil = now + 4;
    ns.sunderPct = Math.max(ns.sunderPct || 0, effects.sunder);
  }
  if (effects.burn) {
    ns.burnUntil = now + 3;
    ns.burnDps = Math.max(ns.burnDps || 0, dealt * effects.burn + 1);
    nightmare.statuses.burnUntil = ns.burnUntil; // 供 UI 展示“灼烧”
  }
  if (effects.reveal) {
    nightmare.revealUntil = Math.max(nightmare.revealUntil || 0, now + effects.reveal);
  }
  if (effects.purge) {
    ns.dots = [];
  }
}

function fireTower(state, building, context, tower, targets) {
  const primary = targets.find((entry) => entry.kind === 'nightmare') || targets[0];
  if (!primary) return;
  const sourceStats = context.stats;
  const damageType = sourceStats.damageType || 'physical';
  const amount = sourceStats.damage * context.damageMult;
  const dealt = hitTarget(state, primary, amount, damageType, building);
  if (primary.kind === 'nightmare') applyAcidHitEffects(state, building, context, primary.ref, dealt);

  // 加速器 II 级附带的电属性
  if (context.electric && context.extraElectricDamage > 0) {
    hitTarget(state, primary, context.extraElectricDamage, 'electric', building, true);
  }

  // 连锁（苯炮台）
  if (context.chains > 0) {
    let chained = 0;
    for (const entry of targets) {
      if (entry === primary) continue;
      if (chained >= context.chains) break;
      hitTarget(state, entry, amount * 0.7, damageType, building, true);
      chained += 1;
    }
  }

  // 溅射 / 范围（酸阶段 4+、氯酸钾）
  if (context.aoe > 0) {
    const splash = Math.min(0.8, 0.35 + context.aoe * 0.2);
    for (const entry of targets) {
      if (entry === primary) continue;
      hitTarget(state, entry, amount * splash, damageType, building, true);
    }
  }

  // 催化氧化「灼烧 / 腐蚀扩散」：单发酸弹也会向其它目标溅射少量热伤害并点燃
  if (context.spread && context.aoe === 0 && building.type === 'acid') {
    for (const entry of targets) {
      if (entry === primary) continue;
      const spreadDealt = hitTarget(state, entry, amount * 0.25, 'heat', building, true);
      if (entry.kind === 'nightmare' && spreadDealt > 0) {
        const ns = monsterState(state, entry.ref.id);
        ns.burnUntil = Math.max(ns.burnUntil, state.now + 2);
        ns.burnDps = Math.max(ns.burnDps, spreadDealt * 0.1 + 0.5);
        entry.ref.statuses.burnUntil = ns.burnUntil;
      }
    }
  }

  // 爆鸣氧化：周期性大范围爆裂
  if (context.periodicBurst > 0) {
    tower.burstTimer += sourceStats.interval || 1;
    if (tower.burstTimer >= context.periodicBurst) {
      tower.burstTimer = 0;
      for (const entry of targets) {
        hitTarget(state, entry, amount * 1.4, 'heat', building);
      }
      pushFx(state, {
        kind: 'reaction',
        space: 'tile',
        x: building.tile.x,
        y: building.tile.y,
        text: '爆鸣氧化',
        color: '#ff8d6b',
        ttl: 1.1,
      });
    }
  }

  // 过热（氯酸钾）
  if (sourceStats.overheatAfter) {
    tower.shots += 1;
    if (tower.shots >= sourceStats.overheatAfter) {
      tower.shots = 0;
      building.overheat = sourceStats.overheatDuration || 3.4;
      pushEvent(state, '氯酸钾炮台过热，需要冷却。', 'warning');
      pushFx(state, {
        kind: 'text',
        space: 'tile',
        x: building.tile.x,
        y: building.tile.y,
        text: '过热',
        color: '#ff8d6b',
        ttl: 1.2,
      });
    }
  }

  // 电磁淬火：概率眩晕
  if (context.stunChance > 0 && primary.kind === 'nightmare' && random(state) < context.stunChance) {
    primary.ref.statuses.stunUntil = Math.max(
      primary.ref.statuses.stunUntil || 0,
      state.now + 0.8,
    );
  }

  // 受击事件（限频，避免刷屏）
  const internals = getInternals(state);
  if (state.now - internals.lastGhostHitEventAt >= 0.6) {
    internals.lastGhostHitEventAt = state.now;
    pushEvent(state, `炮台命中梦魇，造成 ${Math.round(dealt)} 点伤害。`, 'ghost_hit');
  }
}

export function tickTowers(state, dt) {
  if (!state.buildings.length) return;
  const internals = getInternals(state);
  const contexts = getTowerContexts(state);
  const targets = collectDoorTargets(state);
  for (const building of state.buildings) {
    const context = contexts.get(building.id);
    if (!context) continue;
    const tower = towerState(state, building.id);

    if (building.overheat > 0) {
      building.overheat = Math.max(0, building.overheat - dt);
      tower.shots = 0;
      continue;
    }
    if (building.disabledUntil > state.now) continue;

    let speed = context.speedMult;
    if (internals.player.towerSlowUntil > state.now) speed *= internals.player.towerSlowMult;
    if (tower.speedDebuffUntil > state.now) speed *= 1 - tower.speedDebuffPct;
    tower.cooldown = Math.max(0, tower.cooldown - dt * speed);

    if (!context.inRange) {
      tower.cooldown = 0;
      continue;
    }
    if (targets.length === 0) {
      tower.cooldown = 0;
      continue;
    }
    if (tower.cooldown > 0) continue;
    tower.cooldown = Math.max(0.15, context.stats.interval || 1);
    fireTower(state, building, context, tower, targets);
  }
}

