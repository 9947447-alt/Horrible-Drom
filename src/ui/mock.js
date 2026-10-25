// 开发用静态 mock：给 Lead / QA / 截图工具一份可直接喂给 createUI 的完整状态与动作。
// 仅用于本地预览与集成调试，不参与游戏运行。
//
// 预览页用法（放在任意本地 HTML 的 <script type="module"> 中，不新增正式入口）：
//   import { createUI } from './src/ui/index.js';
//   import { createMockState, createMockActions } from './src/ui/mock.js';
//   const state = createMockState({ mode: 'nightmare' });
//   const actions = createMockActions(state);
//   const ui = createUI({ root: document.querySelector('#ui'), actions, getSettings: () => state.settings, autoTutorial: false });
//   ui.update(state, 0);
//   setInterval(() => ui.update(state, 0.1), 100);

import {
  CONFIG, DIFFICULTIES, NIGHTMARES, ROOMMATE_NAMES, ROOMS, getRoom, getBuildDef,
  ROOMMATE_TRAITS, RELIC_REWARDS, ACHIEVEMENTS, DAILY_LOOKUP, dailyKey, getDailyPlan, getDailyEffects,
} from '../content/index.js';

const TRAIT_BY_INDEX = ['economist', 'gunner', 'turtle', 'chemist', 'lucky'];

function makeRequest(traitId, now) {
  const trait = ROOMMATE_TRAITS[traitId];
  if (!trait) return null;
  return {
    id: `req-${traitId}`,
    trait: traitId,
    title: trait.request.title,
    text: trait.request.text,
    cost: { ...trait.request.cost },
    rewardLabel: trait.request.rewardLabel,
    expiresAt: now + 12,
    reward: { ...trait.request.reward },
  };
}

function makeRelic(index, color) {
  const reward = RELIC_REWARDS[index % RELIC_REWARDS.length];
  return {
    id: `relic-${index + 1}`,
    label: reward.label,
    color: reward.color || color || '#63e0c2',
    reward: { kind: reward.kind, value: reward.min + Math.round((reward.max - reward.min) / 2) },
    cost: { reagent: 8 },
  };
}

function createMockRecords() {
  const now = Date.now();
  const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return dailyKey(d); };
  return {
    runs: 27,
    wins: 16,
    bestNight: 384,
    bestGrade: 'S',
    byDifficulty: {
      easy: { runs: 8, wins: 7, bestNight: 360 },
      normal: { runs: 13, wins: 8, bestNight: 384 },
      nightmare: { runs: 6, wins: 1, bestNight: 422 },
    },
    achievements: {
      first_dawn: now - 86400000 * 3,
      night_banisher: now - 86400000 * 2,
      reaction_six: now - 86400000,
      no_repair: now - 3600000,
    },
    daily: {
      [day(0)]: { runs: 2, wins: 1, bestNight: 488, bestGrade: 'A' },
      [day(-1)]: { runs: 3, wins: 2, bestNight: 470, bestGrade: 'A' },
      [day(-3)]: { runs: 1, wins: 0, bestNight: 0, bestGrade: '' },
    },
  };
}

function nightmare(def, level, { now = 168, secondary = false, hpPct = 0.68, targetRoomId = 'room-303' } = {}) {
  const hpScale = CONFIG.nightmare.hpScale[level] || 1;
  const maxHp = Math.round(CONFIG.nightmare.baseHp * hpScale * def.hpMult);
  return {
    id: secondary ? 'n-secondary' : 'n-primary',
    type: def.id,
    secondary,
    level,
    hp: Math.round(maxHp * hpPct),
    maxHp,
    damage: Math.round(CONFIG.nightmare.baseDamage * (CONFIG.nightmare.dmgScale[level] || 1) * def.dmgMult),
    attackInterval: CONFIG.nightmare.baseInterval,
    attackTimer: 0.9,
    state: 'attack',
    targetRoomId,
    spawnAt: 35,
    announceAt: secondary ? 240 : 35,
    disabledUntil: 0,
    revealUntil: 0,
    statuses: {
      burnUntil: now + 3.4,
      slowUntil: now + 2.1,
      stunUntil: 0,
      repairLockUntil: 0,
    },
    skillLevelsFired: [3, 6],
  };
}

function buildingsFor(room) {
  const base = [
    { id: 'b-1', type: 'acid', stage: 3, level: 2, tile: { x: 4, y: 2 }, disabledUntil: 0, overheat: 0, isStarter: false },
    { id: 'b-2', type: 'catalyst', level: 2, tile: { x: 4, y: 1 }, disabledUntil: 0, overheat: 0, isStarter: false },
    { id: 'b-3', type: 'acid', stage: 3, level: 3, tile: { x: 3, y: 3 }, disabledUntil: 0, overheat: 0, isStarter: false },
    { id: 'b-4', type: 'analyzer', level: 2, tile: { x: 2, y: 4 }, disabledUntil: 0, overheat: 0, isStarter: false },
    { id: 'b-5', type: 'condenser', level: 2, tile: { x: 5, y: 1 }, disabledUntil: 0, overheat: 0, isStarter: false },
    { id: 'b-6', type: 'vent', level: 1, tile: { x: 5, y: 0 }, disabledUntil: 0, overheat: 0, isStarter: false },
    { id: 'b-7', type: 'chlorate', level: 4, tile: { x: 1, y: 3 }, disabledUntil: 0, overheat: 0, isStarter: false },
    { id: 'b-8', type: 'neutralizer', level: 1, tile: { x: 3, y: 4 }, disabledUntil: 0, overheat: 0, isStarter: false },
  ];
  if (room && room.starter) {
    base.unshift({
      id: 'b-starter', type: room.starter.type, stage: room.starter.stage || 1,
      level: room.starter.level || 1, tile: { ...room.starter.tile },
      disabledUntil: 0, overheat: 0, isStarter: true,
    });
  }
  return base;
}

function roommatesFor(now) {
  return ROOMMATE_NAMES.map((meta, index) => {
    const trait = TRAIT_BY_INDEX[index];
    const dead = index >= 4;
    return {
      id: `mate-${index + 1}`,
      roomId: `room-${302 + index}`,
      name: meta.name,
      color: meta.color,
      alive: !dead,
      doorHp: index === 3 ? 72 : CONFIG.roommates.baseDoorHp - index * 34,
      maxDoorHp: CONFIG.roommates.baseDoorHp + index * 30,
      offense: CONFIG.roommates.baseOffense + index,
      threat: 1 + index * 0.35,
      note: meta.note,
      lastHitAt: now - index * 12,
      trait,
      bond: index === 0 ? 2 : index === 2 ? 3 : index === 4 ? 1 : 0,
      request: index === 1 ? makeRequest(trait, now) : null,
      relic: dead ? makeRelic(index, meta.color) : null,
    };
  });
}

function eventsFor(now, room) {
  return [
    { id: 'e-1', at: now - 62, text: '五间宿舍的灯依次亮起，对讲机里传来电流声。', kind: 'roommate' },
    { id: 'e-2', at: now - 51, text: '气密门密封条已检查，准备阶段结束。', kind: 'door' },
    { id: 'e-3', at: now - 40, text: '走廊尽头出现苯环状的轮廓。', kind: 'nightmare' },
    { id: 'e-4', at: now - 34, text: `${room.number} 室：冷凝床升至 Lv.2。`, kind: 'upgrade' },
    { id: 'e-5', at: now - 27, text: '催化氧化反应链已激活：酸系伤害提高。', kind: 'reaction' },
    { id: 'e-6', at: now - 19, text: '苯环幽影发动「共振脉冲」，一座装置短暂停机。', kind: 'skill' },
    { id: 'e-7', at: now - 11, text: '阿凯的门被挠出裂痕，舍友火力压制中。', kind: 'warn' },
    { id: 'e-8', at: now - 4, text: '盐酸炮台命中弱点，造成 34 点腐蚀伤害。', kind: 'damage' },
  ];
}

function baseState(mode) {
  const room = getRoom('room-303');
  const now = 168;
  const diff = mode === 'easy' ? 'easy' : mode === 'nightmare' ? 'nightmare' : 'normal';
  return {
    version: 1,
    screen: 'game',
    phase: 'night',
    paused: false,
    difficulty: diff,
    seed: 20261025,
    roomId: room.id,
    now,
    prepRemaining: 0,
    nightElapsed: now,
    clock: 168 / 480 * 360,
    dawnAt: 480,
    spawnAt: 35,
    player: {
      roomId: room.id,
      dream: 236,
      reagent: 27,
      bedLevel: 3,
      doorLevel: 4,
      doorHp: 642,
      doorMaxHp: 1050,
      showerReadyAt: now - 5,
      threat: 2.4,
    },
    acidUnlocked: 3,
    buildings: buildingsFor(room),
    reactions: [
      { id: 'catalytic_oxidation', name: '催化氧化', aId: 'b-1', bId: 'b-2' },
      { id: 'low_temp_condensation', name: '低温凝析', aId: 'b-5', bId: 'b-6' },
      { id: 'neutralization_barrier', name: '中和屏障', aId: 'b-8', bId: 'b-8' },
    ],
    activeNightmares: [nightmare(NIGHTMARES[0], 6, { now })],
    minions: [],
    roommates: roommatesFor(now),
    pressure: { level: 6, xp: 355, nextLevelXp: 480 },
    events: eventsFor(now, room),
    fx: [],
    ui: {
      buildMode: null,
      selectedBuildingId: null,
      hoverTile: null,
    },
    stats: {
      dreamEarned: 1284,
      reagentEarned: 96,
      damageDealt: 8421,
      kills: 0,
      builds: 8,
      reactions: 3,
      repairs: 2,
      roommateSupports: 2,
      relics: 1,
    },
    result: null,
    settings: { volume: 0.6, muted: false, reducedMotion: false, shake: true },
    mode: 'classic',
    daily: null,
    dailyEffects: { economyMult: 1, doorHpMult: 1, dawnBonus: 0, nightmareHpMult: 1 },
    records: createMockRecords(),
    newAchievements: [],
  };
}

export function createMockState(options = {}) {
  const { mode = 'night', overrides = {} } = options;
  const state = baseState(mode);
  const room = getRoom(state.roomId);
  const now = state.now;
  const wantsDaily = ['daily', 'menuDaily', 'roomDaily', 'victoryDaily', 'defeatDaily'].includes(mode) || Boolean(options.daily);
  if (wantsDaily) {
    const plan = getDailyPlan();
    state.mode = 'daily';
    state.daily = plan;
    state.dailyEffects = getDailyEffects(plan.modifierIds);
    state.difficulty = 'normal';
    state.dawnAt = Math.round(state.dawnAt + (state.dailyEffects.dawnBonus || 0));
    state.events.push({ id: 'e-daily', at: now - 6, text: `每日守夜 · ${plan.key}：${plan.modifierIds.map((id) => (DAILY_LOOKUP[id] || {}).name || id).join(' / ')}。`, kind: 'daily' });
  }

  const clearSocial = () => {
    state.roommates = (state.roommates || []).map((mate) => ({ ...mate, request: null, relic: null }));
  };

  if (mode === 'menu' || mode === 'menuDaily') {
    state.screen = 'menu';
    state.phase = 'prep';
    clearSocial();
  } else if (mode === 'roomSelect' || mode === 'roomDaily') {
    state.screen = 'roomSelect';
    state.phase = 'prep';
    clearSocial();
  } else if (mode === 'empty') {
    state.phase = 'prep';
    state.prepRemaining = 25;
    state.now = 0;
    state.nightElapsed = 0;
    state.clock = 0;
    state.activeNightmares = [];
    state.buildings = [];
    state.reactions = [];
    state.roommates = [];
    state.events = [];
    state.pressure = { level: 1, xp: 0, nextLevelXp: 220 };
    state.player = {
      roomId: room.id,
      dream: 70,
      reagent: 0,
      bedLevel: 1,
      doorLevel: 1,
      doorHp: 180,
      doorMaxHp: 180,
      showerReadyAt: 0,
      threat: 1,
    };
    state.stats = {
      dreamEarned: 0, reagentEarned: 0, damageDealt: 0, kills: 0, builds: 0,
      reactions: 0, repairs: 0, roommateSupports: 0, relics: 0,
    };
  } else if (mode === 'prep') {
    state.phase = 'prep';
    state.mode = 'classic';
    state.daily = null;
    state.dailyEffects = { economyMult: 1, doorHpMult: 1, dawnBonus: 0, nightmareHpMult: 1 };
    clearSocial();
    state.prepRemaining = 18;
    state.now = 7;
    state.nightElapsed = 0;
    state.clock = 0;
    state.activeNightmares = [];
    state.player.dream = 70;
    state.player.reagent = 0;
    state.player.doorHp = 180;
    state.player.doorMaxHp = 180;
    state.buildings = state.buildings.filter((b) => b.isStarter);
    state.reactions = [];
    state.events = state.events.slice(0, 3);
  } else if (mode === 'nightmare') {
    state.difficulty = 'nightmare';
    state.activeNightmares = [
      nightmare(NIGHTMARES[0], 8, { now, targetRoomId: 'room-303' }),
      nightmare(NIGHTMARES[2], 5, { now, secondary: true, targetRoomId: 'room-304' }),
    ];
    state.events.push({ id: 'e-9', at: now - 2, text: '04:00：第二只梦魇从断电的 304 室钻出。', kind: 'nightmare' });
  } else if (mode === 'victory' || mode === 'defeat' || mode === 'victoryDaily' || mode === 'defeatDaily') {
    const victory = mode === 'victory' || mode === 'victoryDaily';
    clearSocial();
    state.phase = victory ? 'victory' : 'defeat';
    state.clock = victory ? 360 : 214 / 480 * 360;
    state.activeNightmares = victory ? [] : [nightmare(NIGHTMARES[0], 14, { now, hpPct: 0.35 })];
    state.result = {
      outcome: victory ? 'victory' : 'defeat',
      reason: victory
        ? '最后一只梦魇在晨光里溶解，冷凝床的压力表缓缓归零。'
        : '气密门的最后一道密封条断裂，走廊的风吹灭了床头的灯。',
      grade: victory ? 'S' : 'C',
      title: victory ? '天亮之后，反应终止' : '门板倒向房间内侧',
      lines: victory
        ? ['酸系反应链完成闭环。', '5 名舍友中有 4 名撑到了天亮。']
        : ['梦魇在 Lv.14 完成终焉形态。', '下一次记得把中和池靠近门。'],
    };
    state.stats = {
      dreamEarned: victory ? 2841 : 1512,
      reagentEarned: victory ? 218 : 104,
      damageDealt: victory ? 42680 : 18420,
      kills: victory ? 2 : 0,
      builds: victory ? 14 : 9,
      reactions: victory ? 5 : 2,
      repairs: victory ? 7 : 3,
      roommateSupports: victory ? 4 : 1,
      relics: victory ? 2 : 0,
    };
    state.newAchievements = victory
      ? ['first_dawn', 'roommate_savior', 'reaction_six'].concat(state.mode === 'daily' ? ['daily_clear'] : [])
      : [];
    if (!victory) {
      state.player.doorHp = 0;
    }
  }

  const merged = { ...state, ...overrides };
  if (overrides.player) merged.player = { ...state.player, ...overrides.player };
  if (overrides.ui) merged.ui = { ...state.ui, ...overrides.ui };
  if (overrides.stats) merged.stats = { ...state.stats, ...overrides.stats };
  if (overrides.daily) merged.daily = overrides.daily;
  if (overrides.dailyEffects) merged.dailyEffects = { ...state.dailyEffects, ...overrides.dailyEffects };
  if (overrides.records) merged.records = { ...state.records, ...overrides.records };
  if (overrides.roommates) merged.roommates = overrides.roommates;
  if (overrides.newAchievements) merged.newAchievements = overrides.newAchievements;
  return merged;
}

export function createMockActions(state) {
  const actions = {
    calls: [],
    _record(name, args) {
      this.calls.push({ name, args: args || [] });
    },
    goMenu() {
      this._record('goMenu');
      state.screen = 'menu';
      state.paused = false;
    },
    goRoomSelect() {
      this._record('goRoomSelect');
      state.screen = 'roomSelect';
      state.paused = false;
    },
    startDaily() {
      this._record('startDaily');
      const plan = getDailyPlan();
      state.mode = 'daily';
      state.daily = plan;
      state.dailyEffects = getDailyEffects(plan.modifierIds);
      state.screen = 'roomSelect';
      state.phase = 'prep';
      state.paused = false;
      state.difficulty = 'normal';
      state.dawnAt = Math.round((state.dawnAt || 480) + (state.dailyEffects.dawnBonus || 0));
      return { ok: true };
    },
    setDifficulty(id) {
      this._record('setDifficulty', [id]);
      if (DIFFICULTIES[id]) state.difficulty = id;
      return { ok: true };
    },
    selectRoom(roomId) {
      this._record('selectRoom', [roomId]);
      const room = getRoom(roomId);
      state.roomId = room.id;
      state.screen = 'game';
      state.phase = 'prep';
      state.paused = false;
      state.prepRemaining = 25;
      state.now = 0;
      state.nightElapsed = 0;
      state.clock = 0;
      state.result = null;
      state.newAchievements = [];
      state.activeNightmares = [];
      state.buildings = (state.buildings || []).filter((b) => b.isStarter);
      state.reactions = [];
      state.player.dream = 70;
      state.player.reagent = 0;
      state.player.doorHp = state.player.doorMaxHp;
      state.roommates = roommatesFor(0).map((mate) => ({ ...mate, request: null, relic: null }));
      state.stats = { ...state.stats, roommateSupports: 0, relics: 0, builds: 0, reactions: 0, repairs: 0 };
      state.ui.buildMode = null;
      state.ui.selectedBuildingId = null;
      state.events = [{ id: 'mock-select', at: 0, text: `选择 ${room.number} ${room.name}，准备开始守夜。`, kind: 'info' }];
      return { ok: true };
    },
    answerRoommateRequest(accept) {
      this._record('answerRoommateRequest', [accept]);
      const owner = (state.roommates || []).find((mate) => mate.request);
      if (!owner) return { ok: false, error: '没有待处理的求援' };
      const request = owner.request;
      if (accept) {
        const cost = request.cost || {};
        if (state.player.dream < (cost.dream || 0)) return { ok: false, error: `梦能不足：需要 ${cost.dream}` };
        if (state.player.reagent < (cost.reagent || 0)) return { ok: false, error: `试剂不足：需要 ${cost.reagent}` };
        state.player.dream -= cost.dream || 0;
        state.player.reagent -= cost.reagent || 0;
        owner.bond = Math.min(3, (owner.bond || 0) + 1);
        state.stats.roommateSupports = (state.stats.roommateSupports || 0) + 1;
        const reward = request.reward || {};
        const value = Number(reward.value) || 0;
        if (reward.kind === 'dream') state.player.dream += value;
        else if (reward.kind === 'reagent') state.player.reagent += value;
        else if (reward.kind === 'roommateOffense') owner.offense = (owner.offense || 0) + value;
        else if (reward.kind === 'doorHealPct') {
          state.player.doorHp = Math.min(state.player.doorMaxHp, state.player.doorHp + Math.round(state.player.doorMaxHp * value));
        } else if (reward.kind === 'lucky') state.player.dream += 40;
        owner.doorHp = Math.min(owner.maxDoorHp, owner.doorHp + Math.round(owner.maxDoorHp * 0.08));
      }
      state.events.push({ id: `ev-radio-${Date.now()}`, at: state.now, text: accept ? `${owner.name} 的求援已回应。` : `${owner.name} 的求援被暂时放下。`, kind: 'radio' });
      owner.request = null;
      return { ok: true };
    },
    collectRoommateRelic(roommateId) {
      this._record('collectRoommateRelic', [roommateId]);
      const mate = (state.roommates || []).find((entry) => entry.id === roommateId);
      if (!mate || !mate.relic) return { ok: false, error: '这件遗物已经不在原处' };
      const cost = mate.relic.cost || { reagent: 8 };
      if (state.player.reagent < (cost.reagent || 0)) return { ok: false, error: `试剂不足：需要 ${cost.reagent}` };
      state.player.reagent -= cost.reagent || 0;
      state.stats.relics = (state.stats.relics || 0) + 1;
      const reward = mate.relic.reward || {};
      const value = Number(reward.value) || 0;
      if (reward.kind === 'dream') state.player.dream += value;
      else if (reward.kind === 'reagent') state.player.reagent += value;
      else if (reward.kind === 'doorHealPct') {
        state.player.doorHp = Math.min(state.player.doorMaxHp, state.player.doorHp + Math.round(state.player.doorMaxHp * value));
      }
      state.events.push({ id: `ev-relic-${Date.now()}`, at: state.now, text: `回收 ${mate.name} 的遗物：${mate.relic.label}。`, kind: 'relic' });
      mate.relic = null;
      return { ok: true };
    },
    pause() {
      this._record('pause');
      state.paused = true;
      return { ok: true };
    },
    resume() {
      this._record('resume');
      state.paused = false;
      return { ok: true };
    },
    togglePause() {
      this._record('togglePause');
      state.paused = !state.paused;
      return { ok: true };
    },
    restart() {
      this._record('restart');
      state.phase = 'prep';
      state.paused = false;
      state.prepRemaining = 25;
      state.now = 0;
      state.nightElapsed = 0;
      state.clock = 0;
      state.result = null;
      state.newAchievements = [];
      state.activeNightmares = [];
      state.ui.buildMode = null;
      state.ui.selectedBuildingId = null;
      state.player.doorHp = state.player.doorMaxHp;
      state.player.dream = 70;
      state.player.reagent = 0;
      state.roommates = roommatesFor(0).map((mate) => ({ ...mate, request: null, relic: null }));
      return { ok: true };
    },
    startBuild(type, buildOptions) {
      this._record('startBuild', [type, buildOptions]);
      const opts = buildOptions || {};
      let cost = null;
      if (type === 'acid') {
        cost = { dream: 35, reagent: 0 };
      } else {
        const def = getBuildDef(type);
        cost = def && def.buildCost ? def.buildCost : null;
      }
      if (cost) {
        if (state.player.dream < (cost.dream || 0)) return { ok: false, error: `梦能不足：需要 ${cost.dream}，当前 ${Math.floor(state.player.dream)}` };
        if (state.player.reagent < (cost.reagent || 0)) return { ok: false, error: `试剂不足：需要 ${cost.reagent}，当前 ${Math.floor(state.player.reagent)}` };
      }
      state.ui.buildMode = { type, ...opts };
      return { ok: true };
    },
    cancelBuild() {
      this._record('cancelBuild');
      state.ui.buildMode = null;
      return { ok: true };
    },
    placeAt(tile) {
      this._record('placeAt', [tile]);
      if (!state.ui.buildMode) return { ok: false, error: '没有处于建造模式' };
      const mode = state.ui.buildMode;
      state.buildings.push({
        id: `b-mock-${state.buildings.length + 1}`,
        type: mode.type,
        stage: mode.stage || 1,
        level: 1,
        tile: tile || { x: 2, y: 2 },
        disabledUntil: 0,
        overheat: 0,
        isStarter: false,
      });
      state.ui.buildMode = null;
      return { ok: true };
    },
    selectBuilding(id) {
      this._record('selectBuilding', [id]);
      state.ui.selectedBuildingId = id || null;
      return { ok: true };
    },
    upgradeSelected() {
      this._record('upgradeSelected');
      const b = state.buildings.find((entry) => entry.id === state.ui.selectedBuildingId);
      if (!b) return { ok: false, error: '没有选中的装置' };
      if (b.level >= 10) return { ok: false, error: '已达最高等级' };
      b.level += 1;
      return { ok: true };
    },
    sellSelected() {
      this._record('sellSelected');
      const index = state.buildings.findIndex((entry) => entry.id === state.ui.selectedBuildingId);
      if (index < 0) return { ok: false, error: '没有选中的装置' };
      state.buildings.splice(index, 1);
      state.ui.selectedBuildingId = null;
      return { ok: true };
    },
    evolveSelected() {
      this._record('evolveSelected');
      const b = state.buildings.find((entry) => entry.id === state.ui.selectedBuildingId);
      if (!b || b.type !== 'acid' || b.level < 3) return { ok: false, error: '只有 III 级酸塔可以研究' };
      b.stage = Math.min(6, b.stage + 1);
      b.level = 1;
      state.acidUnlocked = Math.max(state.acidUnlocked, b.stage);
      return { ok: true };
    },
    upgradeBed() {
      this._record('upgradeBed');
      state.player.bedLevel = Math.min(CONFIG.bed.maxLevel, state.player.bedLevel + 1);
      return { ok: true };
    },
    upgradeDoor() {
      this._record('upgradeDoor');
      state.player.doorLevel = Math.min(CONFIG.door.maxLevel, state.player.doorLevel + 1);
      state.player.doorMaxHp = CONFIG.door.hp[state.player.doorLevel] || state.player.doorMaxHp;
      state.player.doorHp = state.player.doorMaxHp;
      return { ok: true };
    },
    repairDoor() {
      this._record('repairDoor');
      state.player.doorHp = state.player.doorMaxHp;
      return { ok: true };
    },
    useShower() {
      this._record('useShower');
      const heal = Math.round(state.player.doorMaxHp * CONFIG.shower.healPct);
      state.player.doorHp = Math.min(state.player.doorMaxHp, state.player.doorHp + heal);
      state.player.showerReadyAt = state.now + CONFIG.shower.cooldown;
      return { ok: true };
    },
    openHelp() { this._record('openHelp'); return { ok: true }; },
    closeHelp() { this._record('closeHelp'); return { ok: true }; },
    setSetting(key, value) {
      this._record('setSetting', [key, value]);
      state.settings[key] = value;
      return { ok: true };
    },
    goResult() {
      this._record('goResult');
      return { ok: true };
    },
  };
  return actions;
}

export function createMock(options = {}) {
  const state = createMockState(options);
  const actions = createMockActions(state);
  return { state, actions };
}

export { DIFFICULTIES, NIGHTMARES, ROOMS };
