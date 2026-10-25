// v2.1 模拟层测试：室友求援 / 亲密度 / 遗物 + 每日挑战修饰词。
// 运行：node --test tests/v2-social.test.js

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRun,
  step,
  answerRoommateRequest,
  collectRoommateRelic,
  getActiveRoommateRequest,
  getPreviewStats,
  SOCIAL,
} from '../src/game/index.js';

import {
  CONFIG,
  DIFFICULTIES,
  ROOMMATE_TRAITS,
  RELIC_REWARDS,
  getDailyEffects,
  getDailyPlan,
} from '../src/content/index.js';

// ------------------------------ 测试辅助 ------------------------------

function makeRun(overrides = {}) {
  return createRun({ roomId: 'room-301', difficulty: 'normal', seed: 7, ...overrides });
}

function protectDoor(state, hp = 1e9) {
  state.player.doorMaxHp = hp;
  state.player.doorHp = hp;
}

// 推进 seconds 秒（到本局结束为止）
function advance(state, seconds, dt = 0.5) {
  let elapsed = 0;
  while (
    elapsed < seconds - 1e-9 &&
    (state.phase === 'prep' || state.phase === 'night')
  ) {
    const slice = Math.min(dt, seconds - elapsed);
    step(state, slice);
    elapsed += slice;
  }
}

// 等到第一条无线电求援出现（最多 maxNightSeconds 个夜晚秒）
function waitForRequest(state, maxNightSeconds = 70) {
  const deadline = state.nightElapsed + maxNightSeconds;
  while (state.phase === 'night' && state.nightElapsed < deadline) {
    step(state, 0.5);
    const active = getActiveRoommateRequest(state);
    if (active) return active;
  }
  return getActiveRoommateRequest(state);
}

// 把某个舍友的门砸到 0，等引擎按淘汰节奏判定（逐 tick 尝试，避免门体成长回血干扰）
function eliminateRoommate(state, roommate) {
  for (let i = 0; i < 160 && roommate.alive; i += 1) {
    roommate.doorHp = 0;
    step(state, 0.05);
  }
  return !roommate.alive;
}

function approx(actual, expected, epsilon = 1e-6, message = '') {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${message} 期望 ${expected}，实际 ${actual}`,
  );
}

// ------------------------------ 1. 经典模式不回归 ------------------------------

test('经典模式保留 v1 状态，并新增 mode/daily/dailyEffects 与室友网络字段', () => {
  const state = makeRun();
  // v1 契约字段不回归
  assert.equal(state.phase, 'prep');
  assert.equal(state.player.dream, CONFIG.startingDream);
  assert.equal(state.player.doorMaxHp, CONFIG.door.hp[1]);
  assert.equal(state.dawnAt, DIFFICULTIES.normal.dawnSeconds);
  assert.equal(state.roommates.length, 5);
  assert.equal(state.buildings.length, 1);
  assert.equal(state.buildings[0].isStarter, true);
  assert.equal(state.stats.roommateSupports, 0);
  assert.equal(state.stats.relics, 0);
  assert.equal(typeof getPreviewStats(state).dreamPerSec, 'number');

  // v2.1 新字段
  assert.equal(state.mode, 'classic');
  assert.equal(state.daily, null);
  assert.deepEqual(state.dailyEffects, {
    economyMult: 1,
    doorHpMult: 1,
    dawnBonus: 0,
    nightmareHpMult: 1,
  });
  for (const roommate of state.roommates) {
    assert.ok(Object.hasOwn(ROOMMATE_TRAITS, roommate.trait), `未知 trait ${roommate.trait}`);
    assert.equal(roommate.bond, 0);
    assert.equal(roommate.request, null);
    assert.equal(roommate.relic, null);
    assert.ok(roommate.alive);
  }
});

// ------------------------------ 2. 每日 createRun ------------------------------

test('每日 createRun：使用 daily.seed、固定普通难度、应用修饰词效果', () => {
  const plan = getDailyPlan(new Date(2026, 9, 25));
  const state = createRun({
    roomId: 'room-301',
    difficulty: 'nightmare', // daily 模式应回落到 normal
    seed: 999,
    mode: 'daily',
    daily: plan,
  });

  assert.equal(state.mode, 'daily');
  assert.equal(state.difficulty, 'normal');
  assert.equal(state.seed, plan.seed >>> 0);
  assert.equal(state.daily.key, plan.key);
  assert.equal(state.daily.seed, plan.seed >>> 0);
  assert.deepEqual(state.daily.modifierIds, plan.modifierIds);
  assert.equal(state.daily.label, plan.label);
  assert.deepEqual(state.dailyEffects, getDailyEffects(plan.modifierIds));
  assert.equal(state.dawnAt, DIFFICULTIES.normal.dawnSeconds + state.dailyEffects.dawnBonus);
  assert.equal(
    state.player.doorMaxHp,
    Math.max(1, Math.round(CONFIG.door.hp[1] * state.dailyEffects.doorHpMult)),
  );
  assert.equal(state.player.doorHp, state.player.doorMaxHp);

  // 同一天：不管传入什么 seed，实际 seed / 梦魇预览都由 daily 决定
  const other = createRun({ roomId: 'room-301', seed: 1, mode: 'daily', daily: plan });
  assert.equal(other.seed, state.seed);
  assert.deepEqual(other.nightmarePreview, state.nightmarePreview);
});

// ------------------------------ 3. 每日固定种子 ------------------------------

test('每日固定日期 plan 稳定：同日期同 seed，不同日期不同 seed，同 plan 模拟可复现', () => {
  const planA = getDailyPlan(new Date(2026, 9, 25));
  const planA2 = getDailyPlan(new Date(2026, 9, 25));
  const planB = getDailyPlan(new Date(2026, 9, 26));
  assert.equal(planA.key, planA2.key);
  assert.equal(planA.seed, planA2.seed);
  assert.deepEqual(planA.modifierIds, planA2.modifierIds);
  assert.notEqual(planA.seed, planB.seed);
  assert.equal(planA.modifierIds.length, 2);

  function play(seed) {
    const state = createRun({ roomId: 'room-301', seed, mode: 'daily', daily: planA });
    protectDoor(state, 1e9);
    state.player.dream = 500;
    advance(state, CONFIG.prepDuration + 100, 0.5); // 夜晚约 100 秒：求援生成/过期都在内
    return JSON.stringify(state);
  }
  assert.equal(play(123), play(456));
});

// ------------------------------ 4. 每日修饰词逐项生效 ------------------------------

test('每日修饰词对接经济 / 门耐久 / 天亮时间 / 梦魇 HP，且不改变经典默认值', () => {
  // economyMult（雾夜）
  const classic = makeRun({ seed: 7 });
  const thinAir = createRun({
    roomId: 'room-301',
    seed: 7,
    mode: 'daily',
    daily: { key: 't', seed: 7, modifierIds: ['thin_air'] },
  });
  advance(classic, 10);
  advance(thinAir, 10);
  const baseIncome = CONFIG.bed.income[1] * DIFFICULTIES.normal.economyMult * 10;
  approx(classic.player.dream, CONFIG.startingDream + baseIncome, 1e-6, '经典收入');
  approx(thinAir.player.dream, CONFIG.startingDream + baseIncome * 0.9, 1e-6, '雾夜收入');

  // doorHpMult（薄门）
  const brittle = createRun({
    roomId: 'room-301',
    mode: 'daily',
    daily: { key: 't', seed: 7, modifierIds: ['brittle'] },
  });
  assert.equal(brittle.player.doorMaxHp, Math.round(CONFIG.door.hp[1] * 0.85));
  assert.equal(brittle.player.doorHp, brittle.player.doorMaxHp);

  // dawnBonus（长夜）
  const longNight = createRun({
    roomId: 'room-301',
    mode: 'daily',
    daily: { key: 't', seed: 7, modifierIds: ['long_night'] },
  });
  assert.equal(longNight.dawnAt, DIFFICULTIES.normal.dawnSeconds + 45);

  // nightmareHpMult（高压）
  const nightmareId = 'mercury';
  const plain = makeRun({ seed: 9, nightmareId });
  protectDoor(plain);
  advance(plain, plain.spawnAt + 2);
  const boosted = createRun({
    roomId: 'room-301',
    seed: 9,
    mode: 'daily',
    nightmareId,
    daily: { key: 't', seed: 9, modifierIds: ['high_pressure'] },
  });
  protectDoor(boosted);
  advance(boosted, boosted.spawnAt + 2);
  const plainNightmare = plain.activeNightmares.find((entry) => !entry.secondary);
  const boostedNightmare = boosted.activeNightmares.find((entry) => !entry.secondary);
  assert.ok(plainNightmare && boostedNightmare);
  assert.equal(plainNightmare.level, boostedNightmare.level);
  approx(boostedNightmare.maxHp / plainNightmare.maxHp, 1.12, 0.01, '高压梦魇生命倍率');

  // 多修饰词叠加
  assert.deepEqual(getDailyEffects(['thin_air', 'brittle', 'long_night', 'high_pressure']), {
    economyMult: 0.9,
    doorHpMult: 0.85,
    dawnBonus: 45,
    nightmareHpMult: 1.12,
  });
});

// ------------------------------ 5. 求援生成 / 唯一 / 过期 ------------------------------

test('求援只在夜晚出现：首次 45–55 秒、全局最多一个、18 秒后自动过期', () => {
  const state = makeRun({ seed: 21 });
  protectDoor(state, 1e9);

  // 准备阶段不能应答
  const prepAnswer = answerRoommateRequest(state, true);
  assert.equal(prepAnswer.ok, false);
  assert.match(prepAnswer.error, /熄灯/);

  advance(state, CONFIG.prepDuration + 1);
  assert.equal(state.phase, 'night');
  assert.equal(getActiveRoommateRequest(state), null);

  const first = waitForRequest(state);
  assert.ok(first, '夜晚应生成求援');
  const { roommate, request } = first;
  assert.match(request.id, /^req-/);
  assert.ok(request.title && request.text && request.rewardLabel);
  assert.ok(Object.hasOwn(ROOMMATE_TRAITS, request.trait));
  assert.equal(request.trait, roommate.trait);
  assert.ok(request.cost.dream + request.cost.reagent > 0);
  assert.ok(request.reward && request.reward.kind);
  assert.equal(state.roommates.filter((entry) => entry.request).length, 1);
  // 首次出现时间约 45–55 秒
  assert.ok(state.nightElapsed >= 44.5, `首次求援过早：${state.nightElapsed}`);
  assert.ok(state.nightElapsed <= 56, `首次求援过晚：${state.nightElapsed}`);
  // 18 秒有效期
  const ttl = request.expiresAt - state.now;
  assert.ok(ttl > 16.5 && ttl <= 18.01, `有效期异常：${ttl}`);

  // 不操作 → 自动过期，不扣资源
  const dreamBefore = state.player.dream;
  const reagentBefore = state.player.reagent;
  advance(state, SOCIAL.requestTtl + 2);
  assert.equal(getActiveRoommateRequest(state), null);
  assert.ok(state.player.dream >= dreamBefore);
  assert.ok(state.player.reagent >= reagentBefore);
  assert.ok(state.events.some((event) => event.kind === 'radio'));

  // 之后还可以再收到求援
  const next = waitForRequest(state, 75);
  assert.ok(next, '过期后应安排下一次求援');
});

// ------------------------------ 6. 接受求援 ------------------------------

test('接受求援：扣费、bond+1、奖励生效、舍友门 8% 修复、radio 事件', () => {
  const state = makeRun({ seed: 11 });
  protectDoor(state, 4000);
  state.player.dream = 1000;
  state.player.reagent = 100;
  advance(state, CONFIG.prepDuration + 1);
  const active = waitForRequest(state);
  assert.ok(active);
  const { roommate, request } = active;
  const trait = ROOMMATE_TRAITS[request.trait];

  roommate.doorHp = 10; // 让“修复 8%”可见
  state.player.doorHp = Math.round(state.player.doorMaxHp * 0.5); // 让门回复类奖励可见
  const snapshot = {
    dream: state.player.dream,
    reagent: state.player.reagent,
    doorHp: state.player.doorHp,
    roommateDoorHp: roommate.doorHp,
    offense: roommate.offense,
    bond: roommate.bond,
    supports: state.stats.roommateSupports,
  };

  const result = answerRoommateRequest(state, true);
  assert.equal(result.ok, true);
  assert.equal(result.accepted, true);
  assert.equal(result.roommateId, roommate.id);
  assert.ok(result.reward && reqRewardKindValid(result.reward.kind));
  assert.equal(roommate.bond, snapshot.bond + 1);
  assert.equal(state.stats.roommateSupports, snapshot.supports + 1);
  assert.equal(roommate.request, null);
  assert.ok(state.events.some((event) => event.kind === 'radio'));

  // 按奖励类型核对资源变化（未 step，收入不会混入）
  const cost = request.cost;
  const dreamDelta = state.player.dream - snapshot.dream;
  const reagentDelta = state.player.reagent - snapshot.reagent;
  const expectedKind = trait.request.reward.kind;
  if (expectedKind === 'lucky') {
    assert.ok(['dream', 'reagent', 'doorHealPct'].includes(result.reward.kind));
  } else {
    assert.equal(result.reward.kind, expectedKind);
  }
  if (result.reward.kind === 'dream') {
    approx(dreamDelta, -cost.dream + result.reward.value, 1e-6, '梦能奖励');
    approx(reagentDelta, -cost.reagent, 1e-6, '梦能奖励试剂');
  } else if (result.reward.kind === 'reagent') {
    approx(reagentDelta, -cost.reagent + result.reward.value, 1e-6, '试剂奖励');
    approx(dreamDelta, -cost.dream, 1e-6, '试剂奖励梦能');
  } else if (result.reward.kind === 'roommateOffense') {
    approx(dreamDelta, -cost.dream, 1e-6, '火力奖励不返资源');
    approx(reagentDelta, -cost.reagent, 1e-6, '火力奖励不返资源');
    assert.ok(roommate.offense > snapshot.offense, '舍友火力应永久提高');
  } else if (result.reward.kind === 'doorHealPct') {
    approx(dreamDelta, -cost.dream, 1e-6, '门回复不返资源');
    approx(reagentDelta, -cost.reagent, 1e-6, '门回复不返资源');
    assert.ok(state.player.doorHp > snapshot.doorHp, '玩家门应被修复');
  }

  // 世界反馈：该舍友门回复 8%
  assert.ok(
    roommate.doorHp >= snapshot.roommateDoorHp + Math.round(roommate.maxDoorHp * SOCIAL.roommateDoorHealPct) - 1,
    '舍友门应回复约 8%',
  );
});

function reqRewardKindValid(kind) {
  return ['dream', 'reagent', 'roommateOffense', 'doorHealPct'].includes(kind);
}

// ------------------------------ 7. 拒绝求援 ------------------------------

test('拒绝求援：只清空请求、不扣资源、不增加 bond', () => {
  const state = makeRun({ seed: 13 });
  protectDoor(state, 1e9);
  advance(state, CONFIG.prepDuration + 1);
  const active = waitForRequest(state);
  assert.ok(active);
  const holder = active.roommate;
  const snapshot = {
    dream: state.player.dream,
    reagent: state.player.reagent,
    bond: holder.bond,
    supports: state.stats.roommateSupports,
  };

  const result = answerRoommateRequest(state, false);
  assert.equal(result.ok, true);
  assert.equal(result.accepted, false);
  assert.equal(holder.request, null);
  assert.equal(state.player.dream, snapshot.dream);
  assert.equal(state.player.reagent, snapshot.reagent);
  assert.equal(holder.bond, snapshot.bond);
  assert.equal(state.stats.roommateSupports, snapshot.supports);
  assert.ok(state.events.some((event) => event.kind === 'radio'));
});

// ------------------------------ 8. 资源不足 ------------------------------

test('资源不足时不能接受求援，求援保留且可以重试', () => {
  const state = makeRun({ seed: 17 });
  protectDoor(state, 1e9);
  advance(state, CONFIG.prepDuration + 1);
  const active = waitForRequest(state);
  assert.ok(active);
  // 求援出现后再清零资源（避免期间床收入补足）
  state.player.dream = 0;
  state.player.reagent = 0;

  const refused = answerRoommateRequest(state, true);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /不足/);
  assert.ok(getActiveRoommateRequest(state), '资源不足时求援应保留');
  assert.equal(state.stats.roommateSupports, 0);

  // 补足资源后可重试成功
  state.player.dream = 1000;
  state.player.reagent = 100;
  const retried = answerRoommateRequest(state, true);
  assert.equal(retried.ok, true);
  assert.equal(state.stats.roommateSupports, 1);
});

// ------------------------------ 9. 遗物生成 / 回收 ------------------------------

test('舍友淘汰生成遗物；回收扣 8 试剂、application stats.relics++、二次回收失败', () => {
  const state = makeRun({ seed: 3 });
  protectDoor(state, 1e9);
  state.player.reagent = 100;
  advance(state, CONFIG.prepDuration + 1);
  state.nightElapsed = Math.max(state.nightElapsed, 200); // 过淘汰节奏锁
  const roommate = state.roommates.find((entry) => entry.alive);
  assert.equal(eliminateRoommate(state, roommate), true);
  assert.equal(roommate.alive, false);
  assert.ok(roommate.relic, '淘汰后应生成遗物');
  assert.match(roommate.relic.id, /^relic-/);
  assert.ok(RELIC_REWARDS.some((entry) => entry.kind === roommate.relic.reward.kind));
  assert.equal(roommate.relic.cost.reagent, SOCIAL.relicCost);
  assert.ok(state.events.some((event) => event.kind === 'relic'));
  assert.equal(state.stats.relics, 0);

  const snapshot = { dream: state.player.dream, reagent: state.player.reagent };
  const collected = collectRoommateRelic(state, roommate.id);
  assert.equal(collected.ok, true);
  assert.equal(collected.cost.reagent, SOCIAL.relicCost);
  assert.equal(state.player.reagent, snapshot.reagent - SOCIAL.relicCost);
  assert.equal(state.stats.relics, 1);
  assert.equal(roommate.relic, null);
  if (collected.reward.kind === 'dream') {
    assert.equal(state.player.dream, snapshot.dream + collected.reward.value);
  } else if (collected.reward.kind === 'reagent') {
    assert.equal(state.player.reagent, snapshot.reagent - SOCIAL.relicCost + collected.reward.value);
  } else if (collected.reward.kind === 'doorHealPct') {
    assert.ok(collected.reward.healed >= 0);
  }
  // 二次回收失败
  assert.equal(collectRoommateRelic(state, roommate.id).ok, false);
});

// ------------------------------ 10. 遗物 bond 折扣 ------------------------------

test('舍友 bond>=2 时遗物回收只花 4 试剂', () => {
  const state = makeRun({ seed: 5 });
  protectDoor(state, 1e9);
  state.player.reagent = 100;
  advance(state, CONFIG.prepDuration + 1);
  state.nightElapsed = Math.max(state.nightElapsed, 200);
  const roommate = state.roommates.find((entry) => entry.alive);
  roommate.bond = 2;
  assert.equal(eliminateRoommate(state, roommate), true);
  assert.equal(roommate.relic.cost.reagent, SOCIAL.relicCostBonded);

  const beforeReagent = state.player.reagent;
  const collected = collectRoommateRelic(state, roommate.id);
  assert.equal(collected.ok, true);
  assert.equal(collected.cost.reagent, SOCIAL.relicCostBonded);
  assert.equal(state.player.reagent, beforeReagent - SOCIAL.relicCostBonded);
});

// ------------------------------ 11. lucky / roommateOffense 奖励路径 ------------------------------

test('lucky 随机奖励与 roommateOffense 永久火力奖励都实际生效', () => {
  const state = makeRun({ seed: 5 });
  protectDoor(state, 4000);
  state.player.dream = 500;
  state.player.reagent = 100;
  state.player.doorHp = 2000;
  advance(state, CONFIG.prepDuration + 1);

  // 手动构造一个“运气流”求援（避免依赖随机抽到六六）
  const luckyMate = state.roommates[0];
  luckyMate.request = {
    id: 'req-lucky',
    trait: 'lucky',
    title: '赌一把',
    text: '“借我点梦能，我翻翻床底。”',
    cost: { dream: 25, reagent: 0 },
    rewardLabel: '随机谢礼',
    expiresAt: state.now + SOCIAL.requestTtl,
    reward: { kind: 'lucky', value: 0 },
  };
  const beforeLucky = {
    dream: state.player.dream,
    reagent: state.player.reagent,
    doorHp: state.player.doorHp,
  };
  const luckyResult = answerRoommateRequest(state, true);
  assert.equal(luckyResult.ok, true);
  assert.ok(['dream', 'reagent', 'doorHealPct'].includes(luckyResult.reward.kind));
  if (luckyResult.reward.kind === 'dream') {
    approx(state.player.dream, beforeLucky.dream - 25 + luckyResult.reward.value, 1e-6);
  } else if (luckyResult.reward.kind === 'reagent') {
    approx(state.player.reagent, beforeLucky.reagent + luckyResult.reward.value, 1e-6);
    approx(state.player.dream, beforeLucky.dream - 25, 1e-6);
  } else {
    assert.ok(state.player.doorHp >= beforeLucky.doorHp);
  }

  // 手动构造“炮台流”求援，验证永久火力奖励
  const gunnerMate = state.roommates[1];
  gunnerMate.request = {
    id: 'req-gunner',
    trait: 'gunner',
    title: '借点零件',
    text: '“给我点梦能，我把床板改成炮架。”',
    cost: { dream: 20, reagent: 0 },
    rewardLabel: '火力 +2.4/s',
    expiresAt: state.now + SOCIAL.requestTtl,
    reward: { kind: 'roommateOffense', value: 2.4 },
  };
  state.player.dream = 100;
  const offenseBefore = gunnerMate.offense;
  const gunnerResult = answerRoommateRequest(state, true);
  assert.equal(gunnerResult.ok, true);
  assert.equal(gunnerResult.reward.kind, 'roommateOffense');
  assert.ok(gunnerMate.offense > offenseBefore);
  // step 后 tickRoommates 重算火力时仍保留加成
  advance(state, 1);
  assert.ok(gunnerMate.offense >= offenseBefore + 2.4 - 1e-6, '求援火力加成应永久保留');
});

// ------------------------------ 12. 无效操作不抛异常 ------------------------------

test('求援/遗物所有无效操作返回 {ok:false,error} 且不抛异常', () => {
  // 准备阶段
  const state = makeRun({ seed: 23 });
  assert.doesNotThrow(() => {
    const answer = answerRoommateRequest(state, true);
    assert.equal(answer.ok, false);
    assert.equal(typeof answer.error, 'string');
    const collect = collectRoommateRelic(state, 'r-1');
    assert.equal(collect.ok, false);
    assert.equal(typeof collect.error, 'string');
    assert.equal(collectRoommateRelic(state, 'nope').ok, false);
  });

  // 夜晚但没有求援
  protectDoor(state, 1e9);
  advance(state, CONFIG.prepDuration + 1);
  if (!getActiveRoommateRequest(state)) {
    assert.equal(answerRoommateRequest(state, true).ok, false);
  }
  assert.equal(collectRoommateRelic(state, 'nope').ok, false);

  // 已结束阶段
  state.phase = 'defeat';
  state.result = { outcome: 'defeat', reason: '气密门被击破', grade: 'D', title: '熄灯之后', lines: [] };
  assert.doesNotThrow(() => {
    assert.equal(answerRoommateRequest(state, true).ok, false);
    assert.equal(collectRoommateRelic(state, 'r-1').ok, false);
  });
});

// ------------------------------ 13. 社交 + 每日确定性 ------------------------------

test('每日 + 社交全流程同 seed 可复现（求援生成、过期、遗物）', () => {
  const plan = getDailyPlan(new Date(2026, 9, 25));
  function play() {
    const state = createRun({ roomId: 'room-301', seed: 424242, mode: 'daily', daily: plan });
    protectDoor(state, 1e9);
    state.player.dream = 1000;
    state.player.reagent = 100;
    advance(state, CONFIG.prepDuration + 120, 0.5);
    return JSON.stringify(state);
  }
  assert.equal(play(), play());
});

// ------------------------------ 14. 求援奖励不影响 v1 默认数值 ------------------------------

test('v1 默认平衡未被改变：经典模式门/天亮/梦魇基础数值与原契约一致', () => {
  const state = makeRun();
  assert.equal(state.dawnAt, 480);
  assert.equal(state.player.doorMaxHp, 180);
  assert.equal(state.dailyEffects.economyMult, 1);
  assert.equal(state.dailyEffects.doorHpMult, 1);
  assert.equal(state.dailyEffects.dawnBonus, 0);
  assert.equal(state.dailyEffects.nightmareHpMult, 1);
  assert.equal(state.stats.roommateSupports, 0);
  assert.equal(state.stats.relics, 0);
});
