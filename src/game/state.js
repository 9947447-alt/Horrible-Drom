// 创建一局新游戏（GameState 初始化）。

import {
  CONFIG,
  DIFFICULTIES,
  NIGHTMARES,
  ROOMS,
  ROOMMATE_NAMES,
  getBuildCost,
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
    };
  });
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
 * @param {string} [options.difficulty] easy | normal | nightmare
 * @param {number|string} [options.seed] 随机种子
 * @param {object} [options.settings] 音量等设置，合并到 state.settings
 * @param {string} [options.nightmareId] 可选：指定主魇（选房预览用）
 * @param {string} [options.secondaryNightmareId] 可选：指定副魇
 */
export function createRun({ roomId, difficulty, seed, settings, nightmareId, secondaryNightmareId } = {}) {
  const room = getRoom(roomId);
  const difficultyId = DIFFICULTIES[difficulty] ? difficulty : 'normal';
  const diff = DIFFICULTIES[difficultyId];
  const numericSeed = normalizeSeed(seed ?? 1);
  const door = doorInfo(room);

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
    dawnAt: diff.dawnSeconds,
    spawnAt: CONFIG.spawnDelay,
    player: {
      roomId: room.id,
      dream: CONFIG.startingDream,
      reagent: CONFIG.startingReagent,
      bedLevel: 1,
      doorLevel: 1,
      doorHp: CONFIG.door.hp[1],
      doorMaxHp: CONFIG.door.hp[1],
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
