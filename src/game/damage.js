// 伤害与门体结算：统一处理伤害类型倍率、减伤、压力经验与统计。

import {
  CONFIG,
  DAMAGE_TYPES,
  WEAKNESS_MULT,
  RESIST_MULT,
  getNightmare,
  getDeviceStats,
} from '../content/index.js';
import { getInternals, monsterState } from './internals.js';
import { pushEvent, pushFx } from './fx.js';
import { doorPoint, tileDistance } from './geometry.js';
import { addPressureXp } from './pressure.js';
import { hasReaction } from './reactions.js';

/**
 * 伤害类型倍率：弱点 1.5×，抗性 0.5×。
 * 第一个参数既接受梦魇对象，也接受梦魇类型 id（便于 UI 展示弱点图标）。
 */
export function getDamageMultiplier(nightmare, damageType) {
  const def = getNightmare(typeof nightmare === 'string' ? nightmare : nightmare && nightmare.type);
  if (!def) return 1;
  if ((def.weaknesses || []).includes(damageType)) return WEAKNESS_MULT;
  if ((def.resistances || []).includes(damageType)) return RESIST_MULT;
  return 1;
}

function killNightmare(state, nightmare) {
  nightmare.state = 'dead';
  state.stats.kills += 1;
  const def = getNightmare(nightmare.type);
  pushEvent(state, `${def.name} 被滴定干净了。`, 'ghost_hit');
  pushFx(state, {
    kind: 'skill',
    space: 'screen',
    x: 0,
    y: 0,
    text: `${def.short} 消散`,
    color: def.accent,
    ttl: 2,
  });
}

/**
 * 对梦魇造成伤害。opts.silent 用于设备/舍友的持续伤害（不刷飘字）。
 * 返回实际造成的伤害（已含类型倍率与减伤）。
 */
export function applyDamageToNightmare(state, nightmare, amount, damageType = 'physical', opts = {}) {
  if (!nightmare || nightmare.state === 'dead') return 0;
  const raw = Number(amount);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const ns = monsterState(state, nightmare.id);
  let damage = raw * getDamageMultiplier(nightmare, damageType);
  if (ns.sunderUntil > state.now) damage *= 1 + ns.sunderPct;
  if (ns.shieldUntil > state.now) damage *= 1 - ns.shieldPct;
  if (damageType === 'physical' && ns.physicalResistUntil > state.now) damage *= 0.7;
  nightmare.hp = Math.max(0, nightmare.hp - damage);
  state.stats.damageDealt += damage;
  if (!opts.silent) {
    const type = DAMAGE_TYPES[damageType] || DAMAGE_TYPES.physical;
    pushFx(state, {
      kind: 'damage',
      space: 'boss',
      x: 0,
      y: 0,
      text: `${Math.max(1, Math.round(damage))}`,
      color: type.color,
      ttl: 0.65,
    });
  }
  if (nightmare.hp <= 0) killNightmare(state, nightmare);
  return damage;
}

export function applyDamageToMinion(state, minion, amount, opts = {}) {
  if (!minion || !minion.alive) return 0;
  const raw = Number(amount);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  minion.hp = Math.max(0, minion.hp - raw);
  state.stats.damageDealt += raw;
  if (!opts.silent) {
    pushFx(state, {
      kind: 'damage',
      space: 'door',
      x: 0,
      y: 0,
      text: `${Math.max(1, Math.round(raw))}`,
      color: '#d9c9ad',
      ttl: 0.6,
    });
  }
  if (minion.hp <= 0) {
    minion.alive = false;
    addPressureXp(state, CONFIG.nightmare.xpPerMinion);
  }
  return raw;
}

// 靠近门的中和池 + “中和屏障”反应链提供的总减伤（上限 50%）。
export function getDoorDamageReduction(state) {
  const point = doorPoint(state);
  let reduction = 0;
  for (const building of state.buildings) {
    if (building.type !== 'neutralizer' || building.disabledUntil > state.now) continue;
    const stats = getDeviceStats('neutralizer', building.level);
    if (tileDistance(building.tile, point) <= stats.range + 1e-9) {
      reduction += stats.doorDamageReduction || 0;
    }
  }
  if (hasReaction(state, 'neutralization_barrier')) reduction += 0.12;
  return Math.min(0.5, reduction);
}

/**
 * 伤害某一扇门（玩家或 AI 舍友）。
 * opts: { roomId, nightmare, kind: 'attack'|'dot'|'skill'|'minion' }
 */
export function damageDoor(state, amount, opts = {}) {
  const raw = Number(amount);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const roomId = opts.roomId || state.player.roomId;
  const isPlayer = roomId === state.player.roomId;
  let damage = raw;

  if (isPlayer) {
    if (opts.kind && opts.kind !== 'attack' && opts.kind !== 'minion') {
      const internals = getInternals(state);
      if (internals.player.purifyUntil > state.now) damage *= 0.5;
    }
    if (opts.nightmare && opts.nightmare.type === 'formaldehyde' && state.pressure.level >= 12) {
      // 甲醛 Lv12「浸泡」：门受到的伤害增加
      damage *= 1.2;
    }
    damage = Math.max(0, damage * (1 - getDoorDamageReduction(state)));
    state.player.doorHp = Math.max(0, state.player.doorHp - damage);
    if (damage >= 1) {
      pushEvent(state, `气密门受到 ${Math.round(damage)} 点伤害。`, 'door_hit');
      pushFx(state, {
        kind: 'damage',
        space: 'door',
        x: 0,
        y: 0,
        text: `-${Math.round(damage)}`,
        color: '#ff6b57',
        ttl: 0.7,
      });
    }
  } else {
    const roommate = state.roommates.find((rm) => rm.roomId === roomId && rm.alive);
    if (!roommate) return 0;
    damage = Math.max(0, damage);
    roommate.doorHp = Math.max(0, roommate.doorHp - damage);
  }

  addPressureXp(
    state,
    damage * CONFIG.nightmare.xpPerDoorDamage * (isPlayer ? 1 : CONFIG.nightmare.roommateAggroWeight),
  );
  return damage;
}
