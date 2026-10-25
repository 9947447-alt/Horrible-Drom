// AI 舍友：门体成长、火力反击、淘汰节奏。

import { CONFIG } from '../content/index.js';
import { getInternals, roommateState } from './internals.js';
import { pushEvent, pushFx } from './fx.js';
import { applyDamageToMinion, applyDamageToNightmare } from './damage.js';
import { addPressureXp } from './pressure.js';
import { createRoommateRelic } from './social.js';

export function tickRoommates(state, dt) {
  if (!state.roommates.length) return;
  const internals = getInternals(state);
  const minutes = state.nightElapsed / 60;

  for (const roommate of state.roommates) {
    if (!roommate.alive) continue;

    // 门随夜晚变厚，火力随夜晚变强
    const maxDoorHp = Math.round(
      CONFIG.roommates.baseDoorHp + CONFIG.roommates.doorGrowthPerMinute * minutes,
    );
    if (maxDoorHp > roommate.maxDoorHp) {
      roommate.doorHp += maxDoorHp - roommate.maxDoorHp;
      roommate.maxDoorHp = maxDoorHp;
    }
    // 求援奖励的永久火力加成（v1 默认 0，不改变默认平衡）
    const rs = roommateState(state, roommate.id);
    const offenseBonus = Number(rs.offenseBonus) || 0;
    roommate.offense =
      Math.round(
        (CONFIG.roommates.baseOffense +
          CONFIG.roommates.offenseGrowthPerMinute * minutes +
          offenseBonus) *
          10,
      ) / 10;

    // 舍友火力：反击正在挠自己房门的梦魇 / 小怪
    rs.timer -= dt;
    if (rs.timer <= 0) {
      rs.timer = CONFIG.roommates.damageTickInterval;
      const target = state.activeNightmares.find(
        (nightmare) => nightmare.state !== 'dead' && nightmare.targetRoomId === roommate.roomId,
      );
      if (target) applyDamageToNightmare(state, target, roommate.offense, 'physical', { silent: true });
      const minion = state.minions.find(
        (m) => m.alive && m.targetRoomId === roommate.roomId,
      );
      if (minion) applyDamageToMinion(state, minion, roommate.offense * 1.5, { silent: true });
    }

    // 淘汰：门破后要满足节奏锁（最早淘汰时间 + 淘汰冷却）
    if (roommate.doorHp <= 0) {
      const allowed =
        state.nightElapsed >= CONFIG.roommates.firstEliminationMinTime &&
        state.now - internals.lastEliminationAt >= CONFIG.roommates.eliminationCooldown;
      if (!allowed) {
        roommate.doorHp = 1;
        continue;
      }
      internals.lastEliminationAt = state.now;
      roommate.alive = false;
      roommate.doorHp = 0;
      addPressureXp(state, CONFIG.nightmare.xpPerElimination);
      pushEvent(state, `舍友 ${roommate.name} 的房门被拖走了……`, 'elimination');
      pushFx(state, {
        kind: 'skill',
        space: 'screen',
        x: 0,
        y: 0,
        text: `${roommate.name} 被淘汰`,
        color: roommate.color,
        ttl: 2,
      });
      // v2.1：舍友房间灯灭，留下一件待回收的遗物
      createRoommateRelic(state, roommate);
      // 正在攻击该房间的梦魇改换目标
      for (const nightmare of state.activeNightmares) {
        if (nightmare.targetRoomId === roommate.roomId) {
          nightmare.targetRoomId = state.player.roomId;
        }
      }
    }
  }
}
