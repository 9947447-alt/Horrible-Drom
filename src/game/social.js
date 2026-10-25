// v2.1 室友网络：无线电求援、亲密度（bond）、遗物回收。
//
// 设计约束：
// - 求援完全可选：忽略/过期不扣资源、不惩罚；
// - 同一时间全局最多 1 个求援；首次约 45–55 秒出现，之后约 40–55 秒再来；
// - 只在夜晚生效（准备阶段与结算后无效）；
// - 所有随机都走独立的 social RNG 流，不改变 v1 战斗的随机序列。

import { RELIC_REWARDS, ROOMMATE_TRAITS } from '../content/index.js';
import { getInternals, pickRandom, roommateState } from './internals.js';
import { pushEvent, pushFx } from './fx.js';
import { canPayCost, payCost } from './economy.js';

export const SOCIAL = {
  firstRequestMin: 45,
  firstRequestMax: 55,
  nextRequestMin: 40,
  nextRequestMax: 55,
  requestTtl: 18,
  bondMax: 3,
  // 接受求援时顺带修复该舍友门的比例（让“支援”有世界反馈）
  roommateDoorHealPct: 0.08,
  // 遗物回收试剂花费；与舍友 bond>=2 时打折
  relicCost: 8,
  relicCostBonded: 4,
  // lucky 求援的随机谢礼区间
  luckyDreamMin: 40,
  luckyDreamMax: 80,
  luckyReagentMin: 8,
  luckyReagentMax: 18,
  luckyHealMin: 0.08,
  luckyHealMax: 0.16,
};

function socialRandom(state) {
  return getInternals(state).socialRng();
}

function socialRange(state, min, max) {
  return min + socialRandom(state) * (max - min);
}

function socialInt(state, min, max) {
  return Math.round(socialRange(state, min, max));
}

function ensureNight(state) {
  if (!state || (state.phase !== 'prep' && state.phase !== 'night')) {
    return { ok: false, error: '本局已经结束' };
  }
  if (state.phase === 'prep') {
    return { ok: false, error: '熄灯之后才能收到无线电' };
  }
  return { ok: true };
}

function traitOf(roommate) {
  return ROOMMATE_TRAITS[roommate && roommate.trait] || ROOMMATE_TRAITS.economist;
}

function scheduleNextRequest(state) {
  const internals = getInternals(state);
  internals.nextRequestAt =
    state.nightElapsed + socialRange(state, SOCIAL.nextRequestMin, SOCIAL.nextRequestMax);
}

export function getActiveRoommateRequest(state) {
  if (!state || !Array.isArray(state.roommates)) return null;
  const holder = state.roommates.find((roommate) => roommate && roommate.request) || null;
  if (!holder) return null;
  return { roommate: holder, request: holder.request };
}

// ------------------------------ 求援生成 / 过期 ------------------------------

function makeRequest(state, roommate, trait) {
  const internals = getInternals(state);
  const template = trait.request || {};
  internals.requestSeq += 1;
  return {
    id: `req-${internals.requestSeq}`,
    trait: trait.id || roommate.trait,
    title: template.title || '无线电求援',
    text: template.text || '',
    cost: {
      dream: Number(template.cost && template.cost.dream) || 0,
      reagent: Number(template.cost && template.cost.reagent) || 0,
    },
    rewardLabel: template.rewardLabel || '',
    expiresAt: state.now + SOCIAL.requestTtl,
    reward: {
      kind: (template.reward && template.reward.kind) || 'dream',
      value: Number(template.reward && template.reward.value) || 0,
    },
  };
}

function generateRequest(state) {
  const internals = getInternals(state);
  const alive = state.roommates.filter((roommate) => roommate.alive);
  if (!alive.length) {
    // 没有活着的舍友：稍后再试（不会因此产生任何惩罚）
    internals.nextRequestAt = state.nightElapsed + 30;
    return null;
  }
  const roommate = pickRandom(state, alive) || alive[0];
  const trait = traitOf(roommate);
  const request = makeRequest(state, roommate, trait);
  roommate.request = request;
  pushEvent(
    state,
    `无线电：${roommate.name}「${request.title}」${request.text}（${SOCIAL.requestTtl} 秒内可应答）`,
    'radio',
  );
  pushFx(state, {
    kind: 'text',
    space: 'screen',
    x: 0,
    y: 0,
    text: `无线电 · ${roommate.name}`,
    color: roommate.color || '#ffc75a',
    ttl: 2.2,
  });
  return request;
}

/**
 * 每帧推进室友网络：求援生成与过期。只应在夜晚调用（engine 保证）。
 * 返回当前活跃求援（或 null）。
 */
export function tickSocial(state, dt) {
  if (!state || state.phase !== 'night') return getActiveRoommateRequest(state);
  const internals = getInternals(state);
  if (typeof internals.nextRequestAt !== 'number') {
    internals.nextRequestAt =
      state.nightElapsed + socialRange(state, SOCIAL.firstRequestMin, SOCIAL.firstRequestMax);
  }

  const active = getActiveRoommateRequest(state);
  if (active) {
    if (state.now >= active.request.expiresAt) {
      active.roommate.request = null;
      scheduleNextRequest(state);
      pushEvent(state, `无线电里 ${active.roommate.name} 的声音被杂音盖过去了……`, 'radio');
    }
    return getActiveRoommateRequest(state);
  }

  if (state.nightElapsed < internals.nextRequestAt) return null;
  return generateRequest(state);
}

// ------------------------------ 奖励结算 ------------------------------

function rewardLabel(roommate, reward) {
  if (reward.kind === 'dream') return `梦能 +${reward.value}`;
  if (reward.kind === 'reagent') return `试剂 +${reward.value}`;
  if (reward.kind === 'roommateOffense') return `${roommate.name} 火力 +${reward.value}`;
  if (reward.kind === 'doorHealPct') return `气密门回复 ${reward.healed || 0} 点`;
  return reward.label || '谢礼';
}

/**
 * 应用一条社交奖励。返回 { kind, value, label, healed? } 供事件文案与测试。
 * lucky 会先随机决定实际奖励，再递归应用。
 */
export function applySocialReward(state, roommate, rewardInput) {
  const reward = rewardInput || { kind: 'dream', value: 0 };
  const kind = reward.kind;
  if (kind === 'lucky') {
    const roll = socialRandom(state);
    if (roll < 1 / 3) {
      return applySocialReward(state, roommate, {
        kind: 'dream',
        value: socialInt(state, SOCIAL.luckyDreamMin, SOCIAL.luckyDreamMax),
      });
    }
    if (roll < 2 / 3) {
      return applySocialReward(state, roommate, {
        kind: 'reagent',
        value: socialInt(state, SOCIAL.luckyReagentMin, SOCIAL.luckyReagentMax),
      });
    }
    return applySocialReward(state, roommate, {
      kind: 'doorHealPct',
      value: Math.round(socialRange(state, SOCIAL.luckyHealMin, SOCIAL.luckyHealMax) * 100) / 100,
    });
  }
  if (kind === 'dream') {
    const value = Math.max(0, Math.round(Number(reward.value) || 0));
    state.player.dream += value;
    state.stats.dreamEarned += value;
    const result = { kind, value, label: `梦能 +${value}` };
    return result;
  }
  if (kind === 'reagent') {
    const value = Math.max(0, Math.round(Number(reward.value) || 0));
    state.player.reagent += value;
    state.stats.reagentEarned += value;
    return { kind, value, label: `试剂 +${value}` };
  }
  if (kind === 'roommateOffense') {
    const value = Math.max(0, Math.round((Number(reward.value) || 0) * 10) / 10);
    const rs = roommateState(state, roommate.id);
    rs.offenseBonus = (rs.offenseBonus || 0) + value;
    roommate.offense = Math.round(((Number(roommate.offense) || 0) + value) * 10) / 10;
    const label = `${roommate.name} 火力 +${value}/s`;
    return { kind, value, label };
  }
  if (kind === 'doorHealPct') {
    const pct = Math.max(0, Number(reward.value) || 0);
    const healed = Math.round(state.player.doorMaxHp * pct);
    state.player.doorHp = Math.min(state.player.doorMaxHp, state.player.doorHp + healed);
    return { kind, value: pct, healed, label: `气密门回复 ${healed} 点` };
  }
  return { kind, value: 0, label: '一枚用不上的零件' };
}

// ------------------------------ 求援应答 ------------------------------

/**
 * 应答当前求援。accept=false 表示忽略（不扣资源）。
 * @returns {{ok:true, accepted:boolean, ...}|{ok:false, error:string}}
 */
export function answerRoommateRequest(state, accept = true) {
  const night = ensureNight(state);
  if (!night.ok) return night;

  const active = getActiveRoommateRequest(state);
  if (!active) return { ok: false, error: '现在没有待应答的求援' };
  const { roommate, request } = active;

  if (state.now >= request.expiresAt) {
    roommate.request = null;
    scheduleNextRequest(state);
    pushEvent(state, '那条求援已经过期了。', 'radio');
    return { ok: false, error: '这条求援已经过期了' };
  }

  const accepting = Boolean(accept);
  if (!accepting) {
    roommate.request = null;
    scheduleNextRequest(state);
    const eventText = `${roommate.name} 的无线电安静了下去（求援已忽略）。`;
    pushEvent(state, eventText, 'radio');
    pushFx(state, {
      kind: 'text',
      space: 'screen',
      x: 0,
      y: 0,
      text: `${roommate.name} · 已忽略`,
      color: roommate.color || '#8c9aa8',
      ttl: 1.6,
    });
    return {
      ok: true,
      accepted: false,
      roommateId: roommate.id,
      roommateName: roommate.name,
      eventText,
    };
  }

  const cost = request.cost || { dream: 0, reagent: 0 };
  const afford = canPayCost(state, cost);
  if (!afford.ok) return afford;
  payCost(state, cost);

  roommate.bond = Math.min(SOCIAL.bondMax, (Number(roommate.bond) || 0) + 1);
  state.stats.roommateSupports = (Number(state.stats.roommateSupports) || 0) + 1;
  const reward = applySocialReward(state, roommate, request.reward);

  // 世界反馈：舍友的门回复 8%
  const doorHeal = Math.round((Number(roommate.maxDoorHp) || 0) * SOCIAL.roommateDoorHealPct);
  roommate.doorHp = Math.min(roommate.maxDoorHp, (Number(roommate.doorHp) || 0) + doorHeal);

  const trait = traitOf(roommate);
  const bondLine = trait.bondLine || '';
  roommate.request = null;
  scheduleNextRequest(state);

  const eventText = `${roommate.name}：${bondLine} ${rewardLabel(roommate, reward)}（bond ${roommate.bond}）`.trim();
  pushEvent(state, eventText, 'radio');
  pushFx(state, {
    kind: 'text',
    space: 'screen',
    x: 0,
    y: 0,
    text: `${roommate.name} · ${reward.label}`,
    color: roommate.color || '#ffc75a',
    ttl: 2,
  });

  return {
    ok: true,
    accepted: true,
    roommateId: roommate.id,
    roommateName: roommate.name,
    trait: trait.id || roommate.trait,
    bond: roommate.bond,
    reward,
    cost: { ...cost },
    eventText,
  };
}

// ------------------------------ 遗物 ------------------------------

// 舍友被淘汰时调用（roommates.js 内）：生成一件待回收的遗物。
export function createRoommateRelic(state, roommate) {
  if (!roommate) return null;
  // 该舍友若还有未应答的求援，信号随房间一起熄灭
  if (roommate.request) {
    roommate.request = null;
    scheduleNextRequest(state);
    pushEvent(state, `${roommate.name} 的无线电信号中断了。`, 'radio');
  }
  if (roommate.relic) return roommate.relic;
  const internals = getInternals(state);
  const pool = Array.isArray(RELIC_REWARDS) && RELIC_REWARDS.length
    ? RELIC_REWARDS
    : [{ kind: 'dream', min: 70, max: 120, label: '梦能结晶', color: '#ffc75a' }];
  const entry = pool[Math.floor(socialRandom(state) * pool.length) % pool.length];
  const bonded = (Number(roommate.bond) || 0) >= 2;
  internals.relicSeq += 1;
  const relic = {
    id: `relic-${internals.relicSeq}`,
    label: entry.label || '舍友遗物',
    color: entry.color || '#ffc75a',
    reward: {
      kind: entry.kind || 'dream',
      min: Number(entry.min),
      max: Number(entry.max),
    },
    cost: { reagent: bonded ? SOCIAL.relicCostBonded : SOCIAL.relicCost },
  };
  roommate.relic = relic;
  pushEvent(
    state,
    `${roommate.name} 的房间里留下了遗物：${relic.label}（回收需 ${relic.cost.reagent} 试剂）`,
    'relic',
  );
  pushFx(state, {
    kind: 'text',
    space: 'screen',
    x: 0,
    y: 0,
    text: `遗物 · ${relic.label}`,
    color: relic.color,
    ttl: 2.4,
  });
  return relic;
}

function rollRelicReward(state, relic) {
  const reward = relic.reward || { kind: 'dream', min: 70, max: 120 };
  const kind = reward.kind || 'dream';
  if (kind === 'dream') {
    return applySocialReward(state, null, {
      kind: 'dream',
      value: socialInt(state, Number(reward.min) || 70, Number(reward.max) || 120),
    });
  }
  if (kind === 'reagent') {
    return applySocialReward(state, null, {
      kind: 'reagent',
      value: socialInt(state, Number(reward.min) || 12, Number(reward.max) || 22),
    });
  }
  if (kind === 'doorHealPct') {
    const value = Math.round(
      socialRange(state, Number(reward.min) || 0.08, Number(reward.max) || 0.14) * 100,
    ) / 100;
    return applySocialReward(state, null, { kind: 'doorHealPct', value });
  }
  return applySocialReward(state, null, { kind, value: Number(reward.value) || 0 });
}

/**
 * 回收舍友遗物：默认 8 试剂，舍友 bond>=2 时 4 试剂。
 * @returns {{ok:true, ...}|{ok:false, error:string}}
 */
export function collectRoommateRelic(state, roommateId) {
  const night = ensureNight(state);
  if (!night.ok) return night;
  const roommate = state.roommates.find((entry) => entry && entry.id === roommateId);
  if (!roommate) return { ok: false, error: '找不到这位舍友' };
  if (!roommate.relic) return { ok: false, error: '这里没有可回收的遗物' };

  const bonded = (Number(roommate.bond) || 0) >= 2;
  const cost = { reagent: bonded ? SOCIAL.relicCostBonded : SOCIAL.relicCost };
  if (state.player.reagent < cost.reagent) {
    return { ok: false, error: `试剂不足（回收需要 ${cost.reagent} 试剂）` };
  }
  state.player.reagent -= cost.reagent;
  const relic = roommate.relic;
  const reward = rollRelicReward(state, relic);
  roommate.relic = null;
  state.stats.relics = (Number(state.stats.relics) || 0) + 1;

  const eventText = `回收 ${relic.label}：${reward.label}`;
  pushEvent(state, eventText, 'relic');
  pushFx(state, {
    kind: 'text',
    space: 'screen',
    x: 0,
    y: 0,
    text: reward.label,
    color: relic.color || '#ffc75a',
    ttl: 2,
  });

  return {
    ok: true,
    roommateId: roommate.id,
    roommateName: roommate.name,
    label: relic.label,
    color: relic.color,
    cost,
    reward,
    eventText,
  };
}

