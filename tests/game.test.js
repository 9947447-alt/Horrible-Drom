// 游戏模拟层逻辑测试：经济、建造、酸系解锁、反应链、伤害类型、梦魇升级/技能、胜负、确定性。
// 运行：node --test tests/game.test.js

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRun,
  step,
  build,
  upgradeBuilding,
  sellBuilding,
  upgradeBed,
  upgradeDoor,
  repairDoor,
  useShower,
  evolveAcid,
  getAvailableAcidStages,
  getBuildLimit,
  getPreviewStats,
  getDamageMultiplier,
} from '../src/game/index.js';

import {
  CONFIG,
  DIFFICULTIES,
  NIGHTMARES,
  getRoom,
  isBuildableTile,
  getAcidBuildCost,
  getBuildingStats,
} from '../src/content/index.js';

// ------------------------------ 测试辅助 ------------------------------

const REQUIRED_STATE_KEYS = [
  'version',
  'screen',
  'phase',
  'paused',
  'difficulty',
  'seed',
  'roomId',
  'now',
  'prepRemaining',
  'nightElapsed',
  'clock',
  'dawnAt',
  'spawnAt',
  'player',
  'acidUnlocked',
  'buildings',
  'reactions',
  'activeNightmares',
  'minions',
  'roommates',
  'pressure',
  'events',
  'fx',
  'ui',
  'stats',
  'result',
  'settings',
];

function makeRun(overrides = {}) {
  return createRun({ roomId: 'room-301', difficulty: 'normal', seed: 7, ...overrides });
}

function fund(state, dream = 1e6, reagent = 1e6) {
  state.player.dream = dream;
  state.player.reagent = reagent;
}

// 推进 seconds 秒（到本局结束为止）
function advance(state, seconds, dt = 0.1) {
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

// 推进到主魇已经生成之后（spawnAt 使用 run 绝对秒；避免测试硬编码时间）
function advanceToSpawn(state, extra = 2) {
  const remaining = Math.max(0, state.spawnAt - state.now);
  advance(state, remaining + extra, 0.2);
}

function freeTiles(state) {
  const room = getRoom(state.roomId);
  const tiles = [];
  for (let y = 0; y < room.h; y += 1) {
    for (let x = 0; x < room.w; x += 1) {
      const tile = { x, y };
      if (!isBuildableTile(room, tile)) continue;
      if (state.buildings.some((b) => b.tile.x === x && b.tile.y === y)) continue;
      tiles.push(tile);
    }
  }
  return tiles;
}

function approx(actual, expected, epsilon = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `期望 ${expected}，实际 ${actual}`,
  );
}

function reactionIds(state) {
  return new Set(state.reactions.map((pair) => pair.id));
}

// ------------------------------ 1. 初始化 ------------------------------

test('createRun 返回契约形状，并完成房间/床/门/起始道具/舍友初始化', () => {
  const state = makeRun();
  for (const key of REQUIRED_STATE_KEYS) {
    assert.ok(key in state, `GameState 缺少字段 ${key}`);
  }
  assert.equal(state.version, CONFIG.version);
  assert.equal(state.screen, 'game');
  assert.equal(state.phase, 'prep');
  assert.equal(state.paused, false);
  assert.equal(state.difficulty, 'normal');
  assert.equal(typeof state.seed, 'number');
  assert.equal(state.roomId, 'room-301');
  assert.equal(state.prepRemaining, CONFIG.prepDuration);
  assert.equal(state.nightElapsed, 0);
  assert.equal(state.clock, 0);
  assert.equal(state.dawnAt, DIFFICULTIES.normal.dawnSeconds);
  assert.equal(state.spawnAt, CONFIG.spawnDelay);
  assert.equal(state.result, null);

  // 玩家
  assert.equal(state.player.roomId, 'room-301');
  assert.equal(state.player.bedLevel, 1);
  assert.equal(state.player.doorLevel, 1);
  assert.equal(state.player.doorMaxHp, CONFIG.door.hp[1]);
  assert.equal(state.player.doorHp, state.player.doorMaxHp);
  assert.equal(state.player.dream, CONFIG.startingDream);
  assert.equal(state.player.showerReadyAt, 0);
  assert.equal(typeof state.player.threat, 'number');

  // 起始道具已经放进 buildings 并占据格子
  assert.equal(state.buildings.length, 1);
  const starter = state.buildings[0];
  const room = getRoom('room-301');
  assert.equal(starter.isStarter, true);
  assert.equal(starter.starter, true); // 旧字段兼容别名
  assert.equal(starter.type, room.starter.type);
  assert.equal(starter.stage, room.starter.stage);
  assert.deepEqual(starter.tile, room.starter.tile);
  assert.equal(isBuildableTile(room, starter.tile), true);

  // 舍友：5 名，占其它房间，全部存活
  assert.equal(state.roommates.length, 5);
  assert.ok(state.roommates.every((rm) => rm.alive));
  assert.ok(state.roommates.every((rm) => rm.roomId !== state.player.roomId));
  assert.ok(
    state.roommates.every(
      (rm) => typeof rm.doorHp === 'number' && typeof rm.offense === 'number' && typeof rm.threat === 'number',
    ),
  );

  // 事件 / UI / 设置 / 梦魇预览
  assert.ok(Array.isArray(state.events) && state.events.length >= 1);
  assert.equal(typeof state.events[0].kind, 'string');
  assert.ok(Array.isArray(state.fx));
  assert.deepEqual(state.ui, { buildMode: null, selectedBuildingId: null, hoverTile: null });
  assert.equal(state.settings.volume, 0.6);
  assert.equal(state.settings.muted, false);
  assert.ok(NIGHTMARES.some((def) => def.id === state.nightmarePreview.mainId));
  assert.equal(state.nightmarePreview.secondaryId, null);
  assert.equal(state.pressure.level, 1);
  assert.equal(state.pressure.xp, 0);
  assert.equal(state.pressure.nextLevelXp, CONFIG.nightmare.pressureXpForLevel[2]);

  // UI 预览数据
  const preview = getPreviewStats(state);
  assert.equal(typeof preview.dreamPerSec, 'number');
  assert.equal(typeof preview.reagentPerSec, 'number');
  assert.equal(preview.activeNightmares, 0);
  assert.equal(preview.buildCount, 1);
  assert.equal(preview.acidUnlocked, 1);
  assert.deepEqual(state.doorTile, { x: 3, y: 4 });
});

// ------------------------------ 2. 经济 ------------------------------

test('准备阶段倒计时结束后进入夜晚；冷凝床产梦能、层析仪产试剂、难度经济系数生效', () => {
  const normal = makeRun();
  advance(normal, 10);
  approx(normal.player.dream, CONFIG.startingDream + CONFIG.bed.income[1] * 10);
  assert.equal(normal.phase, 'prep');
  assert.ok(normal.stats.dreamEarned > 0);

  // 25 秒准备结束 → 夜晚
  advance(normal, 16);
  assert.equal(normal.phase, 'night');
  assert.equal(normal.prepRemaining, 0);
  assert.ok(normal.nightElapsed > 0);

  // 简单难度经济倍率更高
  const easy = makeRun({ difficulty: 'easy' });
  advance(easy, 10);
  approx(
    easy.player.dream,
    CONFIG.startingDream + CONFIG.bed.income[1] * 10 * DIFFICULTIES.easy.economyMult,
  );

  // 层析仪产试剂
  const lab = makeRun();
  fund(lab, 1000, 0);
  assert.equal(build(lab, 'analyzer', {}, freeTiles(lab)[0]).ok, true);
  advance(lab, 5);
  const expectedReagent =
    getBuildingStats(lab.buildings.find((b) => b.type === 'analyzer')).reagentPerSec * 5;
  approx(lab.player.reagent, expectedReagent, 1e-6);
  approx(lab.stats.reagentEarned, expectedReagent, 1e-6);
});

// ------------------------------ 3. 建造 ------------------------------

test('建造扣费、占格校验、非法格子拒绝、失败返回中文原因', () => {
  const state = makeRun();
  fund(state, 1000, 100);
  const tiles = freeTiles(state);
  const tile = tiles[0];

  const result = build(state, 'acid', { stage: 1 }, tile);
  assert.equal(result.ok, true);
  assert.equal(typeof result.id, 'string');
  assert.equal(state.buildings.length, 2);
  approx(state.player.dream, 1000 - getAcidBuildCost(1).dream);
  approx(state.player.reagent, 100 - getAcidBuildCost(1).reagent);

  // 同格重复建造
  assert.equal(build(state, 'acid', {}, tile).ok, false);
  assert.match(build(state, 'acid', {}, tile).error, /已有/);

  // 床格 / 固定障碍 / 越界
  const room = getRoom('room-301');
  for (const bad of [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 9, y: 9 }]) {
    const check = build(state, 'acid', {}, bad);
    assert.equal(check.ok, false);
    assert.equal(typeof check.error, 'string');
    assert.ok(isBuildableTile(room, bad) === false);
  }

  // 缺 tile / 未知类型 / 未解锁阶段
  assert.equal(build(state, 'acid', {}, undefined).ok, false);
  assert.match(build(state, 'acid', {}, undefined).error, /格子/);
  assert.equal(build(state, 'rocket', {}, freeTiles(state)[0]).ok, false);
  assert.match(build(state, 'acid', { stage: 2 }, freeTiles(state)[0]).error, /解锁/);

  // 夜晚也可以继续建造（发育守门）
  advance(state, 26);
  assert.equal(state.phase, 'night');
  const nightResult = build(state, 'chlorate', {}, freeTiles(state)[0]);
  assert.equal(nightResult.ok, true);
});

// ------------------------------ 4. 建造上限 ------------------------------

test('只有 accelerator/atm 各限 2 座，其余建筑不设数量上限', () => {
  const state = makeRun();
  fund(state, 1e6, 1e6);

  const limits = {};
  for (const type of ['acid', 'chlorate', 'benzene', 'analyzer', 'condenser', 'vent', 'catalyst', 'neutralizer']) {
    limits[type] = getBuildLimit(state, type);
  }
  for (const [type, limit] of Object.entries(limits)) {
    assert.equal(limit.max, null, `${type} 不应有数量上限`);
  }
  assert.deepEqual(getBuildLimit(state, 'accelerator'), { current: 0, max: 2 });
  assert.deepEqual(getBuildLimit(state, 'atm'), { current: 0, max: 2 });
  assert.deepEqual(getBuildLimit(state, 'nonsense'), { current: 0, max: 0 });

  // 加速器第 3 座失败
  const tierTiles = freeTiles(state);
  assert.equal(build(state, 'accelerator', {}, tierTiles[0]).ok, true);
  assert.equal(build(state, 'accelerator', {}, tierTiles[1]).ok, true);
  const third = build(state, 'accelerator', {}, tierTiles[2]);
  assert.equal(third.ok, false);
  assert.match(third.error, /最多/);
  assert.deepEqual(getBuildLimit(state, 'accelerator'), { current: 2, max: 2 });

  // 酸塔可以建很多座
  let acidOk = 0;
  for (const tile of tierTiles.slice(2, 8)) {
    if (build(state, 'acid', {}, tile).ok) acidOk += 1;
  }
  assert.ok(acidOk >= 4, `酸塔应可多座，实际 ${acidOk}`);
  assert.equal(getBuildLimit(state, 'acid').max, null);

  // room-306 的起始取款机占用 1 个名额
  const atmRoom = createRun({ roomId: 'room-306', seed: 3 });
  fund(atmRoom);
  assert.deepEqual(getBuildLimit(atmRoom, 'atm'), { current: 1, max: 2 });
  assert.equal(build(atmRoom, 'atm', {}, freeTiles(atmRoom)[0]).ok, true);
  assert.deepEqual(getBuildLimit(atmRoom, 'atm'), { current: 2, max: 2 });
  assert.equal(build(atmRoom, 'atm', {}, freeTiles(atmRoom)[0]).ok, false);
});

// ------------------------------ 5. 酸系解锁 / 进阶 / 拆除 ------------------------------

test('酸塔 III 级可进阶并提升全局解锁；新塔可从已解锁阶段起建；拆除返还 50%', () => {
  const state = makeRun();
  fund(state, 1e6, 1e6);
  const starter = state.buildings[0];

  assert.equal(upgradeBuilding(state, starter.id).ok, true);
  assert.equal(upgradeBuilding(state, starter.id).ok, true);
  assert.equal(starter.level, 3);
  const overflow = upgradeBuilding(state, starter.id);
  assert.equal(overflow.ok, false);
  assert.match(overflow.error, /进阶/);

  const evolve = evolveAcid(state, starter.id);
  assert.equal(evolve.ok, true);
  assert.equal(starter.stage, 2);
  assert.equal(starter.level, 1);
  assert.equal(state.acidUnlocked, 2);
  assert.deepEqual(getAvailableAcidStages(state), [1, 2]);

  // 未解锁阶段不可建造；已解锁阶段可建造
  const tiles = freeTiles(state);
  assert.equal(build(state, 'acid', { stage: 3 }, tiles[0]).ok, false);
  const stage2 = build(state, 'acid', { stage: 2 }, tiles[0]);
  assert.equal(stage2.ok, true);
  assert.equal(state.buildings.find((b) => b.id === stage2.id).stage, 2);

  // 不传 stage 时从当前解锁阶段起建
  const defaultStage = build(state, 'acid', {}, tiles[1]);
  assert.equal(defaultStage.ok, true);
  assert.equal(state.buildings.find((b) => b.id === defaultStage.id).stage, state.acidUnlocked);

  // 拆除返还 50%
  const beforeDream = state.player.dream;
  const sold = sellBuilding(state, stage2.id);
  assert.equal(sold.ok, true);
  const expectedRefund = Math.floor(getAcidBuildCost(2).dream * CONFIG.sellRefund);
  approx(state.player.dream, beforeDream + expectedRefund);
  assert.equal(state.buildings.some((b) => b.id === stage2.id), false);

  // 一路研究到第 6 阶段
  while (state.acidUnlocked < 6) {
    while (starter.level < 3) {
      const upgrade = upgradeBuilding(state, starter.id);
      assert.equal(upgrade.ok, true, upgrade.error);
    }
    const levelUp = evolveAcid(state, starter.id);
    assert.equal(levelUp.ok, true, levelUp.error);
  }
  assert.equal(state.acidUnlocked, 6);
  assert.equal(starter.stage, 6);
  assert.deepEqual(getAvailableAcidStages(state), [1, 2, 3, 4, 5, 6]);

  // 满阶段后不可再进阶
  upgradeBuilding(state, starter.id);
  upgradeBuilding(state, starter.id);
  const capped = evolveAcid(state, starter.id);
  assert.equal(capped.ok, false);
  assert.match(capped.error, /最高/);

  // 可以直接建第 6 阶段
  const before = state.player.dream;
  const stage6 = build(state, 'acid', { stage: 6 }, freeTiles(state)[0]);
  assert.equal(stage6.ok, true);
  approx(state.player.dream, before - getAcidBuildCost(6).dream);
});

// ------------------------------ 6. 床 / 门 / 维修 / 淋浴 ------------------------------

test('门升级回满、维修花费、淋浴冷却与冷凝床门禁', () => {
  const state = makeRun();
  fund(state, 5000, 100);

  const doorUpgrade = upgradeDoor(state);
  assert.equal(doorUpgrade.ok, true);
  assert.equal(state.player.doorLevel, 2);
  assert.equal(state.player.doorMaxHp, CONFIG.door.hp[2]);
  assert.equal(state.player.doorHp, state.player.doorMaxHp);

  state.player.doorHp = 100;
  const repair = repairDoor(state);
  assert.equal(repair.ok, true);
  assert.equal(state.player.doorHp, state.player.doorMaxHp);
  assert.equal(state.stats.repairs, 1);
  assert.equal(repairDoor(state).ok, false);

  // 淋浴：冷却 + 回复比例
  state.player.doorHp = state.player.doorMaxHp - 100;
  const hpBefore = state.player.doorHp;
  const shower = useShower(state);
  assert.equal(shower.ok, true);
  assert.equal(shower.healed, Math.round(state.player.doorMaxHp * CONFIG.shower.healPct));
  assert.ok(state.player.doorHp > hpBefore);
  assert.equal(state.player.showerReadyAt, CONFIG.shower.cooldown);
  const again = useShower(state);
  assert.equal(again.ok, false);
  assert.match(again.error, /冷却/);

  // 床升级受门等级门禁
  const gated = makeRun();
  fund(gated, 5000, 100);
  gated.player.bedLevel = 3;
  gated.player.doorLevel = 1;
  const blocked = upgradeBed(gated);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /气密门/);
  gated.player.doorLevel = 2;
  const allowed = upgradeBed(gated);
  assert.equal(allowed.ok, true);
  assert.equal(gated.player.bedLevel, 4);

  // 满级床
  gated.player.bedLevel = CONFIG.bed.maxLevel;
  assert.equal(upgradeBed(gated).ok, false);
});

// ------------------------------ 7. 反应链 ------------------------------

test('相邻反应链自动激活、记录统计、拆除后失效', () => {
  const state = makeRun();
  fund(state);

  // 催化氧化：起始酸塔 (4,2) + 催化台 (4,3)
  const catalyst = build(state, 'catalyst', {}, { x: 4, y: 3 });
  assert.equal(catalyst.ok, true);
  assert.ok(reactionIds(state).has('catalytic_oxidation'));
  assert.ok(state.reactions.every((pair) => pair.aId && pair.bId && pair.name));
  assert.ok(state.stats.reactions >= 1);
  assert.ok(state.events.some((event) => event.kind === 'reaction'));

  // 低温凝析：冷凝器 + 通风柜相邻
  assert.equal(build(state, 'condenser', {}, { x: 2, y: 2 }).ok, true);
  assert.equal(build(state, 'vent', {}, { x: 2, y: 3 }).ok, true);
  assert.ok(reactionIds(state).has('low_temp_condensation'));

  // 中和屏障：中和池靠近气密门（房间 301 门在 (3, 4.5)）
  assert.equal(build(state, 'neutralizer', {}, { x: 3, y: 4 }).ok, true);
  assert.ok(reactionIds(state).has('neutralization_barrier'));

  // 拆除催化台 → 催化氧化消失
  assert.equal(sellBuilding(state, catalyst.id).ok, true);
  assert.equal(reactionIds(state).has('catalytic_oxidation'), false);
});

// ------------------------------ 8. 伤害类型 ------------------------------

test('伤害类型弱点 1.5×、抗性 0.5×，实际梦魇沿用同一判定', () => {
  assert.equal(getDamageMultiplier('benzene', 'heat'), 1.5);
  assert.equal(getDamageMultiplier('benzene', 'electric'), 1.5);
  assert.equal(getDamageMultiplier('benzene', 'corrosion'), 0.5);
  assert.equal(getDamageMultiplier('mercury', 'physical'), 0.5);
  assert.equal(getDamageMultiplier('mercury', 'cold'), 1.5);
  assert.equal(getDamageMultiplier('formaldehyde', 'heat'), 1.5);
  assert.equal(getDamageMultiplier('phosphorus', 'heat'), 0.5);
  assert.equal(getDamageMultiplier('phosphorus', 'cold'), 1.5);
  assert.equal(getDamageMultiplier('benzene', 'wind'), 1);

  const state = makeRun({ nightmareId: 'mercury' });
  fund(state);
  advanceToSpawn(state);
  const nightmare = state.activeNightmares[0];
  assert.equal(nightmare.type, 'mercury');
  assert.equal(getDamageMultiplier(nightmare, 'physical'), 0.5);
  assert.equal(getDamageMultiplier(nightmare, 'electric'), 1.5);
});

// ------------------------------ 9. 压力升级 / 技能 / 小怪 ------------------------------

test('压力等级驱动梦魇升级，3 级技能触发并召唤小怪', () => {
  const state = createRun({ roomId: 'room-301', difficulty: 'normal', seed: 3, nightmareId: 'formaldehyde' });
  fund(state);
  state.player.doorMaxHp = 1e9;
  state.player.doorHp = 1e9;

  advanceToSpawn(state);
  const nightmare = state.activeNightmares[0];
  assert.ok(nightmare, '梦魇应在 spawnAt 后出现');
  assert.equal(nightmare.level, state.pressure.level);

  let guard = 0;
  while (state.pressure.level < 3 && guard < 200) {
    advance(state, 1);
    guard += 1;
  }
  assert.ok(state.pressure.level >= 3);
  assert.equal(nightmare.level, state.pressure.level);
  assert.equal(state.pressure.nextLevelXp, CONFIG.nightmare.pressureXpForLevel[state.pressure.level + 1]);
  assert.ok(nightmare.skillLevelsFired.includes(3));
  assert.ok(state.events.some((event) => event.kind === 'skill'));
  // 甲醛 Lv3「标本虫」召唤小怪
  assert.ok(state.minions.some((minion) => minion.kind === 'specimen'));
  assert.ok(nightmare.maxHp > CONFIG.nightmare.baseHp);
});

// ------------------------------ 10. 天亮胜利 ------------------------------

test('到达 dawnAt 判定胜利，result 含评级与统计，结算后 step 不再推进', () => {
  const state = makeRun();
  advance(state, 26);
  assert.equal(state.phase, 'night');
  fund(state);
  state.player.doorHp = state.player.doorMaxHp;
  state.nightElapsed = state.dawnAt - 0.5;
  const nowBeforeFinish = state.now;
  step(state, 1);

  assert.equal(state.phase, 'victory');
  assert.equal(state.clock, 360);
  assert.equal(state.result.outcome, 'victory');
  assert.match(state.result.reason, /天亮/);
  assert.ok(['S', 'A', 'B', 'C', 'D'].includes(state.result.grade));
  assert.ok(state.result.lines.length >= 3);
  assert.match(state.result.lines[0], /06:00/);
  assert.equal(state.screen, 'game');
  assert.ok(state.events.some((event) => event.kind === 'victory'));
  // 结算发生在天亮那一刻，step 立即停止推进
  assert.ok(state.now > nowBeforeFinish && state.now <= nowBeforeFinish + 1.01);

  const frozenNow = state.now;
  step(state, 5);
  assert.equal(state.now, frozenNow);
});

// ------------------------------ 11. 门破失败 ------------------------------

test('气密门 HP≤0 立即失败，result 记录原因', () => {
  const state = makeRun();
  fund(state);
  advanceToSpawn(state);
  const nightmare = state.activeNightmares[0];
  assert.ok(nightmare);
  nightmare.state = 'attack';
  nightmare.targetRoomId = state.player.roomId;
  nightmare.attackTimer = 0.001;
  state.player.doorHp = 1;
  step(state, 0.5);

  assert.equal(state.phase, 'defeat');
  assert.equal(state.result.outcome, 'defeat');
  assert.match(state.result.reason, /门/);
  assert.ok(state.result.lines.length >= 3);
});

// ------------------------------ 12. 击杀胜利 ------------------------------

test('击杀全部活跃梦魇判定胜利', () => {
  const state = makeRun();
  fund(state);
  advanceToSpawn(state);
  const nightmare = state.activeNightmares[0];
  // 生命上限压小，保证单发炮台伤害直接致死（不会先触发回巢）
  nightmare.maxHp = 5;
  nightmare.hp = 5;
  nightmare.state = 'attack';
  nightmare.targetRoomId = state.player.roomId;
  step(state, 0.5);

  assert.equal(state.phase, 'victory');
  assert.match(state.result.reason, /滴定/);
  assert.equal(state.stats.kills, 1);
  assert.equal(state.activeNightmares.length, 0);
  // 提前胜利的摘要不应写成 06:00 天亮
  assert.doesNotMatch(state.result.lines[0], /06:00/);
});

// ------------------------------ 13. 噩梦难度副魇 ------------------------------

test('噩梦难度在 secondaryAt 追加第二只不同类型的梦魇', () => {
  const state = createRun({ roomId: 'room-301', difficulty: 'nightmare', seed: 9 });
  fund(state);
  state.player.doorMaxHp = 1e9;
  state.player.doorHp = 1e9;
  state.pressure.level = CONFIG.nightmare.maxLevel;
  state.pressure.xp = CONFIG.nightmare.pressureXpForLevel[CONFIG.nightmare.maxLevel];
  assert.ok(state.nightmarePreview.secondaryId);

  advance(state, CONFIG.prepDuration + DIFFICULTIES.nightmare.secondaryAt + 12, 2);
  assert.ok(state.nightElapsed >= DIFFICULTIES.nightmare.secondaryAt);
  const secondary = state.activeNightmares.find((nightmare) => nightmare.secondary);
  assert.ok(secondary, '噩梦难度应出现副魇');
  assert.equal(secondary.type, state.nightmarePreview.secondaryId);
  const main = state.activeNightmares.find((nightmare) => !nightmare.secondary);
  if (main) assert.notEqual(main.type, secondary.type);
  // 时钟映射：夜晚进度 → 0..360（06:00 天亮）
  approx(state.clock, Math.min(360, (state.nightElapsed / state.dawnAt) * 360), 0.5);
});

// ------------------------------ 14. 确定性 ------------------------------

test('同一 seed + 同一操作序列完全可复现', () => {
  function play(seed) {
    const state = createRun({ roomId: 'room-301', difficulty: 'normal', seed });
    fund(state);
    build(state, 'catalyst', {}, { x: 4, y: 3 });
    build(state, 'acid', { stage: 1 }, { x: 3, y: 3 });
    upgradeBuilding(state, state.buildings[0].id);
    advance(state, 120, 0.25);
    return JSON.stringify(state);
  }
  const first = play(11);
  const second = play(11);
  assert.equal(first, second);

  const third = play(12);
  assert.notEqual(first, third);
});

// ------------------------------ 15. 特化塔 / 设备等级上限 ------------------------------

test('氯酸钾 I–X、设备 I–III 的升级上限', () => {
  const state = makeRun();
  fund(state, 1e7, 1e7);

  const chlorate = build(state, 'chlorate', {}, freeTiles(state)[0]);
  assert.equal(chlorate.ok, true);
  for (let i = 1; i < CONFIG.special.maxLevel; i += 1) {
    const upgraded = upgradeBuilding(state, chlorate.id);
    assert.equal(upgraded.ok, true, upgraded.error);
  }
  const chlorateBuilding = state.buildings.find((b) => b.id === chlorate.id);
  assert.equal(chlorateBuilding.level, CONFIG.special.maxLevel);
  const maxedChlorate = upgradeBuilding(state, chlorate.id);
  assert.equal(maxedChlorate.ok, false);
  assert.match(maxedChlorate.error, /最高/);

  const analyzer = build(state, 'analyzer', {}, freeTiles(state)[0]);
  assert.equal(analyzer.ok, true);
  for (let i = 1; i < CONFIG.device.maxLevel; i += 1) {
    assert.equal(upgradeBuilding(state, analyzer.id).ok, true);
  }
  assert.equal(state.buildings.find((b) => b.id === analyzer.id).level, CONFIG.device.maxLevel);
  assert.equal(upgradeBuilding(state, analyzer.id).ok, false);
});

// ------------------------------ 16. 取款机 ------------------------------

test('梦能取款机把相邻炮台伤害转化为梦能，并有每秒上限', () => {
  const state = createRun({ roomId: 'room-306', difficulty: 'normal', seed: 5 });
  fund(state, 1e7, 1e7);
  state.acidUnlocked = 6;

  // room-306 起始取款机在 (4,2)，周围放 4 座满级第 6 阶段酸塔
  const tiles = [
    { x: 4, y: 3 },
    { x: 3, y: 3 },
    { x: 5, y: 3 },
    { x: 3, y: 2 },
  ];
  for (const tile of tiles) {
    const built = build(state, 'acid', { stage: 6 }, tile);
    assert.equal(built.ok, true, built.error);
    upgradeBuilding(state, built.id);
    upgradeBuilding(state, built.id);
  }

  // 进入夜晚并等待梦魇出现
  advanceToSpawn(state);
  assert.equal(state.phase, 'night');
  const nightmare = state.activeNightmares[0];
  nightmare.state = 'attack';
  nightmare.targetRoomId = state.player.roomId;
  nightmare.attackTimer = 1e6;
  nightmare.hp = 1e6;
  state.player.doorMaxHp = 1e9;
  state.player.doorHp = 1e9;

  const earnedBefore = state.stats.dreamEarned;
  advance(state, 6, 0.1);
  const gained = state.stats.dreamEarned - earnedBefore;
  const bedIncome = CONFIG.bed.income[1] * DIFFICULTIES.normal.economyMult * 6;
  // 有转化：明显高于纯床收入；有上限：不超过 床收入 + 2 座取款机上上限中的 1 座上限 * 6
  assert.ok(gained > bedIncome + 5, `取款机应产生额外梦能，实际 ${gained}`);
  assert.ok(gained <= bedIncome + 8 * 6 + 2, `取款机转化应有每秒上限，实际 ${gained}`);
});

// ------------------------------ 17. 暂停 / 无效操作 ---------------

test('暂停时不推进；无效操作返回错误而不抛异常', () => {
  const state = makeRun();
  state.paused = true;
  step(state, 5);
  assert.equal(state.now, 0);
  state.paused = false;

  assert.doesNotThrow(() => {
    assert.equal(build(state, 'acid', {}, undefined).ok, false);
    assert.equal(upgradeBuilding(state, 'nope').ok, false);
    assert.equal(sellBuilding(state, 'nope').ok, false);
    assert.equal(evolveAcid(state, 'nope').ok, false);
    assert.equal(repairDoor(state).ok, false); // 满血
    state.player.dream = 0;
    assert.equal(upgradeBed(state).ok, false); // 梦能不足
  });
});

// ------------------------------ 18. 酸塔进阶等级门槛 ------------------------------

test('酸塔未到 III 级不能进阶，III 级才能进阶', () => {
  const state = makeRun();
  fund(state);
  const starter = state.buildings[0];

  const early = evolveAcid(state, starter.id);
  assert.equal(early.ok, false);
  assert.match(early.error, /III/);
  assert.equal(state.acidUnlocked, 1);
  assert.equal(starter.stage, 1);

  // I → II → III 只能走普通升级
  assert.equal(upgradeBuilding(state, starter.id).ok, true);
  assert.equal(evolveAcid(state, starter.id).ok, false);
  assert.equal(upgradeBuilding(state, starter.id).ok, true);
  assert.equal(starter.level, CONFIG.acid.maxTier);

  const evolved = evolveAcid(state, starter.id);
  assert.equal(evolved.ok, true);
  assert.equal(starter.stage, 2);
  assert.equal(starter.level, 1);
  assert.equal(state.acidUnlocked, 2);
});

// ------------------------------ 19. 反应链实际生效 ------------------------------

test('催化氧化反应实际提高相邻酸塔伤害', () => {
  function damageOverFiveSeconds(withCatalyst) {
    const state = createRun({ roomId: 'room-301', difficulty: 'normal', seed: 4, nightmareId: 'mercury' });
    fund(state);
    if (withCatalyst) {
      assert.equal(build(state, 'catalyst', {}, { x: 4, y: 3 }).ok, true);
      assert.ok(reactionIds(state).has('catalytic_oxidation'));
    }
    advanceToSpawn(state);
    const nightmare = state.activeNightmares[0];
    nightmare.state = 'attack';
    nightmare.targetRoomId = state.player.roomId;
    nightmare.attackTimer = 1e6; // 不挠门，只挨打
    nightmare.maxHp = 1e6;
    nightmare.hp = 1e6;
    state.player.doorMaxHp = 1e9;
    state.player.doorHp = 1e9;
    const before = state.stats.damageDealt;
    advance(state, 5, 0.05);
    return state.stats.damageDealt - before;
  }

  const plain = damageOverFiveSeconds(false);
  const boosted = damageOverFiveSeconds(true);
  assert.ok(plain > 0, '无反应时炮台也应造成伤害');
  assert.ok(
    boosted > plain * 1.15,
    `催化氧化应显著提高伤害：普通 ${plain.toFixed(1)}，反应 ${boosted.toFixed(1)}`,
  );
});

// ------------------------------ 20. 六种梦魇 Lv14 冒烟测试 ------------------------------

test('六种梦魇在 Lv14 与全部技能触发场景下不崩溃', () => {
  for (const def of NIGHTMARES) {
    assert.doesNotThrow(() => {
      const state = createRun({
        roomId: 'room-301',
        difficulty: 'nightmare',
        seed: 2,
        nightmareId: def.id,
      });
      fund(state);
      state.player.doorMaxHp = 1e9;
      state.player.doorHp = 1e9;
      state.pressure.level = CONFIG.nightmare.maxLevel;
      state.pressure.xp = CONFIG.nightmare.pressureXpForLevel[CONFIG.nightmare.maxLevel];
      advanceToSpawn(state, 12);
      const nightmare = state.activeNightmares.find((entry) => !entry.secondary);
      assert.ok(nightmare, `${def.id} 应已生成`);
      assert.equal(nightmare.type, def.id);
      assert.equal(nightmare.level, CONFIG.nightmare.maxLevel);
      assert.equal(nightmare.skillLevelsFired.length, 5);
      assert.ok(nightmare.maxHp > 0 && nightmare.hp > 0);
    }, `${def.id} 在 Lv14 场景崩溃`);
  }
});
