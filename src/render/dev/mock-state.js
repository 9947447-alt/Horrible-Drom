// 开发预览用的假 GameState（仅 src/render/dev 使用，不进入生产入口）。
// 与 docs/CONTRACT.md 的字段保持一致；用真实 content 数据决定外观。

import {
  getRoom, ROOMS, NIGHTMARES, REACTIONS, getAcidStage, getBuildDef,
} from '../../content/index.js';

const ROOMMATE_ROOM_IDS = ['room-302', 'room-303', 'room-304', 'room-305', 'room-306'];

function building(id, type, tile, extra = {}) {
  return {
    id,
    type,
    stage: extra.stage ?? 1,
    level: extra.level ?? 1,
    tile,
    disabledUntil: 0,
    overheat: 0,
    isStarter: !!extra.isStarter,
  };
}

// 按房间尺寸给一套有代表性的建筑布局（会过滤掉床/占位/越界格）。
function layoutBuildings(room) {
  const occupied = new Set();
  const blocked = new Set((room.blocked || []).map((b) => `${b.x},${b.y}`));
  for (let y = room.bed.y; y < room.bed.y + room.bed.h; y++) {
    for (let x = room.bed.x; x < room.bed.x + room.bed.w; x++) occupied.add(`${x},${y}`);
  }
  for (const b of blocked) occupied.add(b);
  const specs = [
    ['acid-1', 'acid', 1, 1],
    ['acid-2', 'acid', 2, 2],
    ['acid-3', 'acid', 3, 3],
    ['acid-4', 'acid', 4, 1],
    ['acid-5', 'acid', 5, 2],
    ['acid-6', 'acid', 6, 3],
    ['chlorate-x', 'chlorate', 1, 10],
    ['benzene-x', 'benzene', 1, 10],
    ['analyzer-1', 'analyzer', 1, 3],
    ['condenser-1', 'condenser', 1, 3],
    ['vent-1', 'vent', 1, 3],
    ['catalyst-1', 'catalyst', 1, 3],
    ['neutralizer-1', 'neutralizer', 1, 3],
    ['accelerator-1', 'accelerator', 1, 3],
    ['atm-1', 'atm', 1, 3],
  ];
  const prefer = [
    // 有构图的布局：炮台在中间，设备靠墙
    [4, 2], [2, 1], [3, 1], [2, 3], [3, 3], [4, 3],
    [1, 4], [2, 4],
    [5, 1], [4, 1], [5, 2], [3, 2], [1, 2], [2, 2], [5, 3],
    [1, 3], [0, 3], [0, 4], [5, 4], [1, 1], [0, 2],
  ];
  const result = [];
  let idx = 0;
  for (const [id, type, stage, level] of specs) {
    let tile = null;
    while (idx < prefer.length) {
      const [x, y] = prefer[idx++];
      const key = `${x},${y}`;
      if (x >= 0 && y >= 0 && x < room.w && y < room.h && !occupied.has(key)) {
        occupied.add(key);
        tile = { x, y };
        break;
      }
    }
    if (!tile) {
      // 房间小时从前往后找空位
      for (let y = 0; y < room.h && !tile; y++) {
        for (let x = 0; x < room.w && !tile; x++) {
          const key = `${x},${y}`;
          if (!occupied.has(key)) {
            occupied.add(key);
            tile = { x, y };
          }
        }
      }
    }
    if (!tile) continue;
    result.push(building(id, type, tile, { stage, level, isStarter: id === room.starter.type + '-1' }));
  }
  return result;
}

function makeNightmare(type, index, opts = {}) {
  const def = NIGHTMARES.find((n) => n.id === type) || NIGHTMARES[0];
  const level = opts.level ?? (index === 0 ? 9 : 12);
  const hpScale = [0, 1, 1.18, 1.39, 1.64, 1.94, 2.29, 2.7, 3.19, 3.76, 4.44, 5.24, 6.18, 7.29, 8.6];
  const maxHp = Math.round(900 * (hpScale[level] || 1) * (def.hpMult || 1) * (opts.hpMult || 1));
  return {
    id: `n-${index + 1}`,
    type,
    secondary: !!opts.secondary,
    level,
    hp: opts.hp ?? Math.round(maxHp * (opts.hpPct ?? 0.62)),
    maxHp,
    damage: 12,
    attackInterval: def.attackInterval || 1.8,
    attackTimer: opts.attackTimer ?? 1.1,
    state: opts.state || 'attack',
    targetRoomId: opts.targetRoomId || null,
    spawnAt: 35,
    announceAt: 34,
    disabledUntil: 0,
    revealUntil: 0,
    statuses: { burnUntil: 0, slowUntil: 0, stunUntil: 0, repairLockUntil: 0 },
    skillLevelsFired: [3, 6],
  };
}

function makeRoommates() {
  return ROOMMATE_ROOM_IDS.map((rid, i) => ({
    id: `mate-${i + 1}`,
    roomId: rid,
    name: ['阿凯', '小满', '老白', '雨桐', '六六'][i],
    color: ['#ffb45e', '#63e0c2', '#9ecbff', '#e7a37a', '#c7a8ff'][i],
    alive: i !== 3,
    doorHp: 280,
    maxDoorHp: 280,
    offense: 3,
    threat: 1,
  }));
}

function makeReactions(buildings) {
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const near = (a, b) => a && b && Math.abs(a.tile.x - b.tile.x) + Math.abs(a.tile.y - b.tile.y) <= 2;
  const list = [];
  const push = (id, a, b) => {
    if (byId.get(a) && byId.get(b)) list.push({ id, name: id, aId: a, bId: b });
  };
  push('catalytic_oxidation', 'acid-2', 'catalyst-1');
  push('low_temp_condensation', 'condenser-1', 'vent-1');
  push('electromagnetic_quench', 'accelerator-1', 'condenser-1');
  push('detonation_oxidation', 'chlorate-x', 'catalyst-1');
  push('aromatic_resonance', 'benzene-x', 'accelerator-1');
  return list;
}

function makeFx(state, opts) {
  const now = state.now;
  const fx = [];
  const add = (kind, space, x, y, text, color, ttl, offset) => {
    fx.push({
      id: `fx-${fx.length}`,
      kind,
      space,
      x,
      y,
      text,
      color,
      bornAt: now - (offset || 0),
      ttl,
    });
  };
  add('damage', 'tile', 2, 3, '24', '#ff9a5c', 1.1, 0.1);
  add('damage', 'tile', 3, 3, '18', '#b8e37a', 1.2, 0.4);
  add('damage', 'door', 0, 0, '36', '#ff9a5c', 1.0, 0.2);
  add('damage', 'boss', 0, 0, '52', '#ffd27a', 1.2, 0.5);
  add('skill', 'screen', 0.5, 0.18, '六元护盾', '#b49bff', 2.2, 0.6);
  add('reaction', 'tile', 2, 4, '芳烃共振', '#ff9ab5', 2.4, 1.0);
  add('text', 'door', 0, 0, '门体受损', '#ff6b57', 1.6, 0.8);
  return fx;
}

export function createMockState(opts = {}) {
  const roomId = opts.roomId || 'room-301';
  const room = getRoom(roomId);
  const phase = opts.phase || 'night';
  const now = opts.now ?? 132;
  const doorMaxHp = 600;
  const lowHp = !!opts.lowHp;
  const buildings = layoutBuildings(room);
  const monsters = (opts.monsters || ['benzene', 'formaldehyde']).slice(0, 2);
  const activeNightmares = monsters.map((type, i) => makeNightmare(type, i, {
    level: opts.levels ? opts.levels[i] : undefined,
    secondary: i === 1,
    hpPct: lowHp ? 0.18 : (i === 0 ? 0.58 : 0.42),
    attackTimer: i === 0 ? 1.25 : 0.7,
    targetRoomId: i === 0 || opts.bothPlayer ? null : ROOMMATE_ROOM_IDS[1],
    state: i === 0 ? 'attack' : (opts.secondaryRoam ? 'roam' : 'attack'),
    revealUntil: opts.reveal ? (opts.now ?? 132) + 60 : 0,
  }));
  if (opts.single) activeNightmares.length = 1;
  const state = {
    version: 1,
    screen: opts.screen || 'game',
    phase,
    paused: false,
    difficulty: 'nightmare',
    seed: 20251025,
    roomId: room.id,
    now,
    prepRemaining: phase === 'prep' ? 12 : 0,
    nightElapsed: phase === 'night' || phase === 'victory' ? Math.max(0, now - 25) : 0,
    clock: 90,
    dawnAt: 480,
    spawnAt: 35,
    player: {
      roomId: room.id,
      dream: opts.dream ?? 268,
      reagent: opts.reagent ?? 34,
      bedLevel: opts.bedLevel ?? 5,
      doorLevel: opts.doorLevel ?? 4,
      doorHp: lowHp ? Math.round(doorMaxHp * 0.22) : opts.doorHp ?? 468,
      doorMaxHp,
      showerReadyAt: 0,
      threat: 2,
    },
    acidUnlocked: 6,
    buildings,
    reactions: makeReactions(buildings),
    activeNightmares,
    minions: [],
    roommates: makeRoommates(),
    pressure: { level: 7, xp: 500, nextLevelXp: 865 },
    events: [],
    fx: [],
    ui: {
      buildMode: opts.buildMode || null,
      selectedBuildingId: opts.selectedBuildingId === undefined ? 'acid-3' : opts.selectedBuildingId,
      hoverTile: opts.hoverTile || null,
    },
    stats: { dreamEarned: 0, reagentEarned: 0, damageDealt: 0, kills: 0, builds: 0, reactions: 0, repairs: 0 },
    result: null,
    settings: {
      volume: 0.6,
      muted: false,
      reducedMotion: false,
      shake: opts.shake !== false,
    },
  };
  state.fx = makeFx(state, opts);
  if (opts.selectedBuildingId === null) state.ui.selectedBuildingId = null;
  if (opts.buildMode) state.ui.hoverTile = opts.hoverTile || { x: 3, y: 2 };
  return state;
}

// 让预览里的动画持续运行；不改渲染逻辑，只推进 mock 状态。
export function animateMockState(state, dt) {
  const d = Math.min(dt, 0.05);
  state.now += d;
  if (state.phase === 'night') state.nightElapsed += d;
  for (const n of state.activeNightmares) {
    if (n.state === 'attack') {
      n.attackTimer += d;
      if (n.attackTimer > n.attackInterval) n.attackTimer = 0.35;
    }
  }
  // 让飘字循环出现，便于截图与人工观察
  for (const f of state.fx) {
    if (state.now - f.bornAt > f.ttl) {
      f.bornAt = state.now - 0.05;
      if (f.kind === 'damage') {
        const num = 8 + Math.floor(Math.random() * 40);
        f.text = String(num);
      }
    }
  }
  // 门血缓慢波动，稳定在设定值附近
  const p = state.player;
  if (p.doorHp < p.doorMaxHp * 0.9) {
    p.doorHp = Math.min(p.doorMaxHp, p.doorHp + d * 2);
  }
}

export { ROOMS };
