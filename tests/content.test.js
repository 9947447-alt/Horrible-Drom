import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOMS, ACID_STAGES, SPECIAL_TOWERS, DEVICES, NIGHTMARES, REACTIONS,
  isBuildableTile, getAcidStage, getAcidStats, getAcidUpgradeCost,
  getSpecialStats, getSpecialUpgradeCost, getDeviceStats, getDeviceUpgradeCost,
  getBuildingLabel, DIFFICULTIES, CONFIG,
} from '../src/content/index.js';

test('六个房间尺寸与起始道具有效', () => {
  const ids = new Set();
  for (const room of ROOMS) {
    assert.ok(!ids.has(room.id), '房间 id 唯一');
    ids.add(room.id);
    assert.ok(room.w >= 4 && room.h >= 4, `${room.id} 至少 4x4`);
    assert.ok(room.starter && room.starter.type, `${room.id} 有起始道具`);
    assert.ok(isBuildableTile(room, room.starter.tile), `${room.id} 起始道具在可建造格`);
    assert.equal(room.bed.w, 2);
    assert.equal(room.bed.h, 2);
    let free = 0;
    for (let y = 0; y < room.h; y += 1) for (let x = 0; x < room.w; x += 1) if (isBuildableTile(room, { x, y })) free += 1;
    assert.ok(free >= 8, `${room.id} 至少 8 个空位`);
  }
  assert.equal(ROOMS.length, 6);
});

test('酸系六阶段与 I–III 成长', () => {
  assert.equal(ACID_STAGES.length, 6);
  for (const stage of ACID_STAGES) {
    const s1 = getAcidStats(stage.stage, 1);
    const s3 = getAcidStats(stage.stage, 3);
    assert.ok(s3.damage > s1.damage);
    assert.ok(s3.range >= s1.range);
    assert.ok(stage.buildCost.dream > 0);
    assert.ok(['heat', 'cold', 'electric', 'wind', 'corrosion', 'physical'].includes(s1.damageType));
  }
  assert.deepEqual(getAcidStage(99).stage, 1);
  const evolve = getAcidUpgradeCost(1, 3);
  assert.equal(evolve.kind, 'evolve');
  assert.equal(evolve.nextStage, 2);
});

test('特化炮台 I–X 与设备 I–III', () => {
  assert.equal(SPECIAL_TOWERS.length, 2);
  for (const t of SPECIAL_TOWERS) {
    assert.equal(t.maxLevel, 10);
    assert.ok(getSpecialStats(t.type, 10).damage > getSpecialStats(t.type, 1).damage);
    assert.equal(getSpecialUpgradeCost(t.type, 10), null);
  }
  assert.ok(DEVICES.length >= 7);
  for (const d of DEVICES) {
    assert.equal(d.maxLevel, 3);
    assert.ok(getDeviceStats(d.type, 3));
    assert.equal(getDeviceUpgradeCost(d.type, 3), null);
  }
  const capped = DEVICES.filter((d) => d.maxCount);
  assert.deepEqual(capped.map((d) => d.type).sort(), ['accelerator', 'atm']);
});

test('六种梦魇有差异弱点、抗性与 14 级技能', () => {
  assert.equal(NIGHTMARES.length, 6);
  const types = new Set();
  for (const n of NIGHTMARES) {
    assert.ok(!types.has(n.id));
    types.add(n.id);
    assert.ok(n.weaknesses.length >= 2);
    assert.ok(n.resistances.length >= 1);
    assert.equal(n.skills.length, 5);
    assert.deepEqual(n.skills.map((s) => s.level), [3, 6, 9, 12, 14]);
    assert.ok(n.finalForm);
  }
  assert.equal(new Set(NIGHTMARES.map((n) => n.weaknesses.join(','))).size, 6);
});

test('反应链包含六条且需求有效', () => {
  assert.equal(REACTIONS.length, 6);
  const known = new Set(['acid', 'chlorate', 'benzene', ...DEVICES.map((d) => d.type), 'door']);
  for (const r of REACTIONS) {
    assert.ok(r.requires.length >= 2);
    for (const req of r.requires) assert.ok(known.has(req), `${r.id} 需求未知：${req}`);
  }
});

test('难度矩阵完整、普通与噩梦天亮时长正确', () => {
  for (const key of ['easy', 'normal', 'nightmare', 'abyss']) {
    assert.ok(DIFFICULTIES[key]);
    assert.ok(DIFFICULTIES[key].dawnSeconds >= 300);
  }
  assert.equal(DIFFICULTIES.nightmare.secondary, true);
  assert.equal(DIFFICULTIES.normal.secondary, false);
  assert.equal(CONFIG.nightmare.maxLevel, 14);
});

test('建筑标签可读', () => {
  assert.match(getBuildingLabel({ type: 'acid', stage: 4, level: 2 }), /硫酸/);
  assert.match(getBuildingLabel({ type: 'chlorate', level: 7 }), /VII/);
  assert.match(getBuildingLabel({ type: 'atm', level: 2 }), /II/);
});

test('v2.1 室友性格/每日挑战/成就数据完整', async () => {
  const social = await import('../src/content/social.js');
  assert.equal(social.ROOMMATE_TRAITS.economist.request.cost.dream > 0, true);
  assert.equal(Object.keys(social.ACHIEVEMENTS).length >= 9, true);
  assert.equal(social.DAILY_MODIFIERS.length >= 4, true);
  const a = social.getDailyPlan(new Date('2026-10-25T12:00:00'));
  const b = social.getDailyPlan(new Date('2026-10-25T23:00:00'));
  assert.deepEqual(a.modifierIds, b.modifierIds);
  assert.equal(a.modifierIds.length, 2);
  assert.notEqual(a.modifierIds[0], a.modifierIds[1]);
  const effects = social.getDailyEffects(['thin_air', 'brittle']);
  assert.equal(effects.economyMult, 0.9);
  assert.equal(effects.doorHpMult, 0.85);
});
