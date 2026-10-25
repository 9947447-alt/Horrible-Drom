import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRun, upgradeBed, upgradeDoor,
} from '../src/game/index.js';
import { getBedUpgradeCost, getDoorUpgradeCost } from '../src/content/index.js';

test('冷凝床升级显示/扣费同源：下一等级成本与实际扣费一致', () => {
  const state = createRun({ roomId: 'room-301', difficulty: 'normal', seed: 41 });
  state.player.dream = 5000;
  const cost = getBedUpgradeCost(state.player.bedLevel);
  assert.ok(cost);
  assert.equal(cost.nextLevel, 2);
  const before = state.player.dream;
  const result = upgradeBed(state);
  assert.equal(result.ok, true);
  assert.equal(state.player.bedLevel, 2);
  assert.equal(before - state.player.dream, cost.dream);
});

test('气密门升级显示/扣费同源：梦能与试剂都和下一等级成本一致', () => {
  const state = createRun({ roomId: 'room-301', difficulty: 'normal', seed: 42 });
  state.player.dream = 5000;
  state.player.reagent = 500;
  const cost = getDoorUpgradeCost(state.player.doorLevel);
  assert.ok(cost);
  assert.equal(cost.nextLevel, 2);
  const beforeDream = state.player.dream;
  const beforeReagent = state.player.reagent;
  const result = upgradeDoor(state);
  assert.equal(result.ok, true);
  assert.equal(state.player.doorLevel, 2);
  assert.equal(beforeDream - state.player.dream, cost.dream);
  assert.equal(beforeReagent - state.player.reagent, cost.reagent);
});

test('高阶门升级也一致：Lv4→Lv5 带试剂成本', () => {
  const state = createRun({ roomId: 'room-301', difficulty: 'normal', seed: 43 });
  state.player.dream = 10000;
  state.player.reagent = 500;
  state.player.doorLevel = 4;
  state.player.doorMaxHp = 1050;
  state.player.doorHp = 1050;
  const cost = getDoorUpgradeCost(4);
  assert.ok(cost.reagent > 0);
  const beforeDream = state.player.dream;
  const beforeReagent = state.player.reagent;
  assert.equal(upgradeDoor(state).ok, true);
  assert.equal(beforeDream - state.player.dream, cost.dream);
  assert.equal(beforeReagent - state.player.reagent, cost.reagent);
  assert.equal(state.player.doorLevel, 5);
});
