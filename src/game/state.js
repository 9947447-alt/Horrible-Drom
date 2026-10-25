// 创建一局新游戏（GameState 初始化）。

import {
  CONFIG,
  DIFFICULTIES,
  NIGHTMARES,
  ROOMS,
  ROOMMATE_NAMES,
  getBuildCost,
  getDailyEffects,
  getRoom,
} from '../content/index.js';
import { getInternals } from './internals.js';
import { pushEvent } from './fx.js';
import { recomputeReactions } from './reactions.js';
import { doorInfo } from './geometry.js';
import { normalizeSeed } from './rng.js';
import { getNextLevelXp } from './pressure.js';

export const DEFAULT_SETTINGS = {
  volume: 0.6,
  muted: false,
  reducedMotion: false,
  shake: true,
};

// 室友性格（trait）与内容 ROOMMATE_NAMES 一一对应，缺失时按顺序回退。
const TRAIT_FALLBACK = ['economist', 'gunner', 'turtle', 'chemist', 'lucky'];

function buildRoommates(playerRoomId) {
  const otherRooms = ROOMS.filter((room) => room.id !== playerRoomId);
  return ROOMMATE_NAMES.map((entry, index) => {
    const room = otherRooms[index] || ROOMS[index] || ROOMS[0];
    return {
      id: `r-${index + 1}`,
      roomId: room.id,
      name: entry.name,
      color: entry.color,
      alive: true,
      doorHp: CONFIG.roommates.baseDoorHp,
      maxDoorHp: CONFIG.roommates.baseDoorHp,
      offense: CONFIG.roommates.baseOffense,
      threat: 0.6,
      // v2.1 室友网络
      trait: entry.trait || TRAIT_FALLBACK[index % TRAIT_FALLBACK.length],
      bond: 0,
      request: null,
      relic: null,
    };
  });
}

// 每日挑战参数归一化：模拟层只认 { key, seed, modifierIds, label }。
function normalizeDaily(daily) {
  const source = daily && typeof daily === 'object' ? daily : {};
  const modifierIds = Array.isArray(source.modifierIds)
    ? source.modifierIds.filter((id) => typeof id === 'string')
    : [];
  const key = typeof source.key === 'string' && source.key ? source.key : 'daily';
  const label = typeof source.label === 'string' && source.label ? source.label : `每日守夜 · ${key}`;
  return { key, seed: source.seed, modifierIds, label };
}

function buildStarterBuilding(room) {
  const starter = room.starter;
  const cost = getBuildCost(starter.type, { stage: starter.stage || 1 }) || {
    dream: 0,
    reagent: 0,
  };
  const building = {
    id: 'b-1',
    type: starter.type,
    level: starter.level || 1,
    tile: { x: starter.tile.x, y: starter.tile.y },
    disabledUntil: 0,
    overheat: 0,
    isStarter: true,
    starter: true, // 旧字段兼容别名
    invested: { dream: cost.dream || 0, reagent: cost.reagent || 0 },
  };
  if (starter.type === 'acid') building.stage = starter.stage || 1;
  return building;
}

// 选房预览：由 seed（或显式传入的 id）决定本局主魇 / 副魇，UI 可在选房时展示。
function buildNightmarePreview({ seed, difficulty, nightmareId, secondaryNightmareId }) {
  const ids = NIGHTMARES.map((def) => def.id);
  const mainId = ids.includes(nightmareId)
    ? nightmareId
    : ids[normalizeSeed(`${seed}:main`) % ids.length];
  const diff = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
  const others = ids.filter((id) => id !== mainId);
  let secondaryId = null;
  if (diff.secondary) {
    secondaryId = ids.includes(secondaryNightmareId) && secondaryNightmareId !== mainId
      ? secondaryNightmareId
      : others[normalizeSeed(`${seed}:secondary`) % others.length];
  }
  return { mainId, secondaryId };
}

/**
 * 创建一局。
 * @param {object} options
 * @param {string} [options.roomId] 宿舍 id
 * @param {string} [options.difficulty] easy | normal | nightmare（daily 模式固定 normal）
 * @param {number|string} [options.seed] 随机种子
 * @param {object} [options.settings] 音量等设置，合并到 state.settings
 * @param {string} [options.nightmareId] 可选：指定主魇（选房预览用）
 * @param {string} [options.secondaryNightmareId] 可选：指定副魇
 * @param {'classic'|'daily'} [options.mode] v2.1：经典 / 每日挑战
 * @param {object} [options.daily] v2.1：每日计划 { key, seed, modifierIds, label }
 */
export function createRun({
  roomId,
  difficulty,
  seed,
  settings,
  nightmareId,
  secondaryNightmareId,
  mode = 'classic',
  daily = null,
} = {}) {
  const room = getRoom(roomId);
  // 每日挑战以普通难度为基础；其种子来自 daily.seed，保证同一天所有人同一局。
  const dailyMode = mode === 'daily';
  const normalizedDaily = dailyMode ? normalizeDaily(daily) : null;
  const dailyEffects = getDailyEffects(normalizedDaily ? normalizedDaily.modifierIds : []);
  const difficultyId = dailyMode ? 'normal' : (DIFFICULTIES[difficulty] ? difficulty : 'normal');
  const diff = DIFFICULTIES[difficultyId];
  const rawSeed = dailyMode && normalizedDaily.seed !== undefined ? normalizedDaily.seed : seed;
  const numericSeed = normalizeSeed(rawSeed ?? 1);
  const door = doorInfo(room);
  const baseDoorHp = CONFIG.door.hp[1] || 1;
  const initialDoorMaxHp = Math.max(1, Math.round(baseDoorHp * dailyEffects.doorHpMult));

  const state = {
    version: CONFIG.version,
    screen: 'game',
    phase: 'prep',
    paused: false,
    difficulty: difficultyId,
    seed: numericSeed,
    roomId: room.id,
    now: 0,
    prepRemaining: CONFIG.prepDuration,
    nightElapsed: 0,
    clock: 0,
    dawnAt: diff.dawnSeconds + dailyEffects.dawnBonus,
    // v2.1：经典 / 每日挑战与每日修饰词效果（classic 时全部为默认值）
    mode: dailyMode ? 'daily' : 'classic',
    daily: normalizedDaily
      ? {
        key: normalizedDaily.key,
        seed: numericSeed,
        modifierIds: normalizedDaily.modifierIds.slice(),
        label: normalizedDaily.label,
      }
      : null,
    dailyEffects,
    spawnAt: CONFIG.spawnDelay,
    player: {
      roomId: room.id,
      dream: CONFIG.startingDream,
      reagent: CONFIG.startingReagent,
      bedLevel: 1,
      doorLevel: 1,
      doorHp: initialDoorMaxHp,
      doorMaxHp: initialDoorMaxHp,
      showerReadyAt: 0,
      threat: 1,
    },
    acidUnlocked: 1,
    buildings: [buildStarterBuilding(room)],
    reactions: [],
    activeNightmares: [],
    minions: [],
    roommates: buildRoommates(room.id),
    pressure: { level: 1, xp: 0, nextLevelXp: getNextLevelXp(1) },
    events: [],
    fx: [],
    ui: {
      buildMode: null,
      selectedBuildingId: null,
      hoverTile: null,
    },
    stats: {
      dreamEarned: 0,
      reagentEarned: 0,
      damageDealt: 0,
      kills: 0,
      builds: 0,
      reactions: 0,
      repairs: 0,
      // v2.1 室友网络统计
      roommateSupports: 0,
      relics: 0,
    },
    result: null,
    settings: { ...DEFAULT_SETTINGS, ...(settings || {}) },
    // 契约未定义的实用扩展：门的位置（渲染/UI 可直接读取；模拟内部也在用）
    doorTile: door.tile,
    doorPoint: door.point,
    // 选房预览：本局将出现的梦魇（确定性的“剧透”）
    nightmarePreview: buildNightmarePreview({
      seed: numericSeed,
      difficulty: difficultyId,
      nightmareId,
      secondaryNightmareId,
    }),
  };

  // 初始化随机源与内部计时
  getInternals(state);
  pushEvent(state, '熄灯前的最后准备：先躺上冷凝床，再决定门与炮台。', 'warning', 0);
  recomputeReactions(state);
  return state;
}
