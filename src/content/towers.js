import { CONFIG } from './config.js';

// 伤害类型：heat 热 / cold 冷 / electric 电 / wind 风 / corrosion 腐蚀 / physical 物理
export const DAMAGE_TYPES = {
  heat: { name: '热', color: '#ff9a5c', icon: 'flame' },
  cold: { name: '冷', color: '#8fd8ff', icon: 'snow' },
  electric: { name: '电', color: '#ffe27a', icon: 'bolt' },
  wind: { name: '风', color: '#9ee7d8', icon: 'wind' },
  corrosion: { name: '腐蚀', color: '#b8e37a', icon: 'drop' },
  physical: { name: '物理', color: '#d9c9ad', icon: 'impact' },
};

// 酸系主炮：一条全局解锁的进化线。
export const ACID_STAGES = [
  {
    stage: 1,
    id: 'silica',
    name: '硅酸炮台',
    short: '硅酸',
    desc: '凝胶弹丸，减速并造成物理伤害。便宜、可靠，适合铺开局。',
    mechanic: '减速 12%',
    damageType: 'physical',
    accent: '#9ee7d8',
    icon: 'tube',
    baseDamage: 7,
    baseInterval: 1.15,
    baseRange: 3.4,
    aoe: 0,
    buildCost: { dream: 35, reagent: 0 },
    effects: { slow: 0.12 },
  },
  {
    stage: 2,
    id: 'carbonic',
    name: '碳酸炮台',
    short: '碳酸',
    desc: '高频气泡连射，单发伤害低，但能持续打断梦魇的施法。',
    mechanic: '连射 · 轻微击退',
    damageType: 'corrosion',
    accent: '#a7e9d4',
    icon: 'bubbles',
    baseDamage: 4.5,
    baseInterval: 0.55,
    baseRange: 2.9,
    aoe: 0,
    buildCost: { dream: 65, reagent: 0 },
    effects: { knockback: 0.15 },
  },
  {
    stage: 3,
    id: 'hydrochloric',
    name: '盐酸炮台',
    short: '盐酸',
    desc: '腐蚀点射，命中后短暂削韧，使后续攻击造成更多伤害。',
    mechanic: '破甲 · 单体',
    damageType: 'corrosion',
    accent: '#b8e37a',
    icon: 'droplet',
    baseDamage: 14,
    baseInterval: 1.0,
    baseRange: 3.6,
    aoe: 0,
    buildCost: { dream: 110, reagent: 6 },
    effects: { sunder: 0.12 },
  },
  {
    stage: 4,
    id: 'sulfuric',
    name: '硫酸炮台',
    short: '硫酸',
    desc: '脱水灼烧，留下持续伤害；对有机类梦魇尤其有效。',
    mechanic: '灼烧 DoT · 溅射',
    damageType: 'heat',
    accent: '#ffb45e',
    icon: 'flask',
    baseDamage: 17,
    baseInterval: 1.25,
    baseRange: 3.5,
    aoe: 0.65,
    buildCost: { dream: 180, reagent: 14 },
    effects: { burn: 0.16, splash: 0.3 },
  },
  {
    stage: 5,
    id: 'hypochlorous',
    name: '次氯酸炮台',
    short: '次氯酸',
    desc: '氧化漂白：范围净化毒雾、照出潜影，同时造成风/热混合伤害。',
    mechanic: '净化 · 反隐',
    damageType: 'wind',
    accent: '#a7f0ff',
    icon: 'spray',
    baseDamage: 13,
    baseInterval: 0.95,
    baseRange: 3.8,
    aoe: 0.9,
    buildCost: { dream: 260, reagent: 24 },
    effects: { reveal: 4, purge: true },
  },
  {
    stage: 6,
    id: 'perchloric',
    name: '高氯酸炮台',
    short: '高氯酸',
    desc: '过氧爆轰：向门外投送大范围爆炸，代价是较高的试剂消耗。',
    mechanic: '范围爆破 · 高热',
    damageType: 'heat',
    accent: '#ff8d6b',
    icon: 'burst',
    baseDamage: 34,
    baseInterval: 1.7,
    baseRange: 3.9,
    aoe: 1.3,
    buildCost: { dream: 380, reagent: 38 },
    effects: { splash: 0.6, burn: 0.08 },
  },
];

export const ACID_LOOKUP = Object.fromEntries(ACID_STAGES.map((s) => [s.stage, s]));

export function getAcidStage(stage) {
  return ACID_LOOKUP[stage] || ACID_STAGES[0];
}

export function getAcidBuildCost(stage) {
  return { ...getAcidStage(stage).buildCost };
}

export function getAcidStats(stage, level = 1) {
  const s = getAcidStage(stage);
  const t = CONFIG.acid.tierMult[level] || 1;
  return {
    ...s,
    damage: s.baseDamage * t,
    interval: s.baseInterval * (1 - CONFIG.acid.intervalPerTier * (level - 1)),
    range: s.baseRange + CONFIG.acid.rangePerTier * (level - 1),
    aoe: s.aoe + (level >= 3 && s.aoe > 0 ? 0.25 : 0),
    level,
    tierMult: t,
  };
}

// 升级/进阶价格。level 为当前等级；未达 III 时返回普通升级，III 时返回进阶。
export function getAcidUpgradeCost(stage, level) {
  const cur = getAcidStage(stage);
  if (level < CONFIG.acid.maxTier) {
    return {
      kind: 'level',
      nextLevel: level + 1,
      dream: Math.round(cur.buildCost.dream * (level === 1 ? 0.7 : 1.15)),
      reagent: level === 1 ? 0 : Math.round(2 + stage * 0.8),
    };
  }
  if (stage < CONFIG.acid.maxStage) {
    const next = getAcidStage(stage + 1);
    return {
      kind: 'evolve',
      nextStage: stage + 1,
      nextName: next.name,
      dream: Math.round(next.buildCost.dream * CONFIG.acid.unlockDiscount),
      reagent: next.buildCost.reagent,
    };
  }
  return null;
}

// ---------- 特化炮台：I–X ----------

export const SPECIAL_TOWERS = [
  {
    type: 'chlorate',
    category: 'tower',
    name: '氯酸钾炮台',
    short: '氯酸钾',
    desc: '积累氧压，周期性轰出范围爆炸；连续射击会过热。适合清小怪与区域压制。',
    mechanic: '范围爆发 · 过热',
    damageType: 'heat',
    accent: '#ffe27a',
    icon: 'burst',
    maxLevel: 10,
    buildCost: { dream: 120, reagent: 4 },
    baseDamage: 26,
    baseInterval: 2.2,
    baseRange: 3.1,
    baseAoe: 1.35,
    levelGain: 0.16,
  },
  {
    type: 'benzene',
    category: 'tower',
    name: '苯炮台',
    short: '苯',
    desc: '共振链在梦魇之间弹射，叠加共振层数；对双魇与群体目标的控制力极强。',
    mechanic: '连锁 · 共振控制',
    damageType: 'physical',
    accent: '#ff9ab5',
    icon: 'ring',
    maxLevel: 10,
    buildCost: { dream: 105, reagent: 3 },
    baseDamage: 8,
    baseInterval: 0.85,
    baseRange: 3.5,
    chains: 2,
    levelGain: 0.15,
  },
];

export const SPECIAL_LOOKUP = Object.fromEntries(SPECIAL_TOWERS.map((s) => [s.type, s]));

export function getSpecialDef(type) {
  return SPECIAL_LOOKUP[type] || SPECIAL_TOWERS[0];
}

export function getSpecialStats(type, level = 1) {
  const def = getSpecialDef(type);
  const l = Math.max(1, Math.min(def.maxLevel, level));
  const dmgMult = 1 + def.levelGain * (l - 1);
  const base = {
    ...def,
    level: l,
    damage: def.baseDamage * dmgMult,
    interval: Math.max(0.35, def.baseInterval - 0.035 * (l - 1)),
    range: def.baseRange + 0.035 * (l - 1),
  };
  if (type === 'chlorate') {
    return {
      ...base,
      aoe: def.baseAoe + 0.06 * (l - 1),
      overheatAfter: 5 + Math.floor(l / 2),
      overheatDuration: 3.4,
    };
  }
  return {
    ...base,
    chains: def.chains + Math.floor((l - 1) / 3),
    stunChance: Math.min(0.4, 0.04 + l * 0.022),
    resonance: true,
  };
}

export function getSpecialUpgradeCost(type, level) {
  const def = getSpecialDef(type);
  if (level >= def.maxLevel) return null;
  const next = level + 1;
  const factor = 0.55 + 0.36 * level;
  return {
    kind: 'level',
    nextLevel: next,
    dream: Math.round(def.buildCost.dream * factor),
    reagent: Math.round(2 + level * 1.6 + (type === 'chlorate' ? 1 : 0)),
  };
}

// ---------- 功能设备：I–III ----------

export const DEVICES = [
  {
    type: 'analyzer',
    category: 'device',
    name: '层析仪',
    short: '层析仪',
    desc: '持续分离梦能残液，产出试剂。高阶反应链的燃料来源。',
    accent: '#63e0c2',
    icon: 'layers',
    maxLevel: 3,
    buildCost: { dream: 45, reagent: 0 },
    reagentPerSec: [0, 0.45, 0.8, 1.3],
  },
  {
    type: 'condenser',
    category: 'device',
    name: '冷凝器',
    short: '冷凝器',
    desc: '在范围内降低梦魇速度，并持续造成少量冷伤害；与通风柜形成低温凝析。',
    accent: '#8fd8ff',
    icon: 'snow',
    maxLevel: 3,
    buildCost: { dream: 55, reagent: 0 },
    slowPct: [0, 0.18, 0.28, 0.38],
    coldDps: [0, 1.5, 3, 5],
    range: [0, 2.8, 3.2, 3.6],
  },
  {
    type: 'vent',
    category: 'device',
    name: '通风柜',
    short: '通风柜',
    desc: '抽走毒雾、照出潜影，降低房间威胁；少量风伤害。',
    accent: '#9ee7d8',
    icon: 'wind',
    maxLevel: 3,
    buildCost: { dream: 50, reagent: 0 },
    revealRange: [0, 3.8, 4.4, 5.0],
    windDps: [0, 1, 2, 4],
    threatReduction: [0, 0.1, 0.2, 0.3],
  },
  {
    type: 'catalyst',
    category: 'device',
    name: '催化台',
    short: '催化台',
    desc: '提高相邻酸系/氯酸钾炮台的反应效率，是反应链的核心。',
    accent: '#ffb45e',
    icon: 'spark',
    maxLevel: 3,
    buildCost: { dream: 65, reagent: 2 },
    reactionBoost: [0, 0.2, 0.32, 0.45],
    range: [0, 1.8, 2.1, 2.4],
  },
  {
    type: 'neutralizer',
    category: 'device',
    name: '中和池',
    short: '中和池',
    desc: '靠近气密门时自动修补门体，清除腐蚀与酸雾。',
    accent: '#c7e8a8',
    icon: 'pool',
    maxLevel: 3,
    buildCost: { dream: 60, reagent: 0 },
    repairPerSec: [0, 3, 6, 10],
    range: [0, 2.4, 2.8, 3.2],
    doorDamageReduction: [0, 0.05, 0.08, 0.12],
  },
  {
    type: 'accelerator',
    category: 'device',
    name: '加速器',
    short: '加速器',
    desc: '提高相邻炮台攻速；等级 II 起附带电属性。最多 2 座。',
    accent: '#ffe27a',
    icon: 'bolt',
    maxLevel: 3,
    buildCost: { dream: 80, reagent: 4 },
    maxCount: 2,
    attackSpeedBonus: [0, 0.2, 0.35, 0.5],
    electric: [false, false, true, true],
    range: [0, 1.9, 2.1, 2.3],
  },
  {
    type: 'atm',
    category: 'device',
    name: '梦能取款机',
    short: '取款机',
    desc: '把相邻炮台造成的伤害按比例结算成梦能，有每秒上限。最多 2 座。',
    accent: '#c7a8ff',
    icon: 'cash',
    maxLevel: 3,
    buildCost: { dream: 90, reagent: 0 },
    maxCount: 2,
    conversion: [0, 0.08, 0.12, 0.16],
    capPerSec: [0, 8, 14, 22],
    range: [0, 1.9, 2.1, 2.3],
  },
];

export const DEVICE_LOOKUP = Object.fromEntries(DEVICES.map((d) => [d.type, d]));

export function getDeviceDef(type) {
  return DEVICE_LOOKUP[type] || DEVICES[0];
}

export function getDeviceStats(type, level = 1) {
  const def = getDeviceDef(type);
  const l = Math.max(1, Math.min(def.maxLevel, level));
  const pick = (arr, fallback = 0) => (Array.isArray(arr) ? (arr[l] ?? fallback) : arr);
  return {
    ...def,
    level: l,
    reagentPerSec: pick(def.reagentPerSec),
    slowPct: pick(def.slowPct),
    coldDps: pick(def.coldDps),
    range: pick(def.range),
    revealRange: pick(def.revealRange),
    windDps: pick(def.windDps),
    threatReduction: pick(def.threatReduction),
    reactionBoost: pick(def.reactionBoost),
    repairPerSec: pick(def.repairPerSec),
    doorDamageReduction: pick(def.doorDamageReduction),
    attackSpeedBonus: pick(def.attackSpeedBonus),
    electric: def.electric ? Boolean(def.electric[l]) : false,
    conversion: pick(def.conversion),
    capPerSec: pick(def.capPerSec),
  };
}

export function getDeviceUpgradeCost(type, level) {
  const def = getDeviceDef(type);
  if (level >= def.maxLevel) return null;
  return {
    kind: 'level',
    nextLevel: level + 1,
    dream: Math.round(def.buildCost.dream * (0.6 + 0.45 * level)),
    reagent: Math.round(1 + level * 1.4),
  };
}

// ---------- 统一建造目录 ----------

export const ACID_DEF = {
  type: 'acid',
  category: 'tower',
  name: '酸系主炮',
  short: '酸系',
  desc: '从硅酸到高氯酸的六阶段进化线。曾解锁的阶段，新炮台可直接从该阶段起建。',
  mechanic: '六阶段 · 每阶段 I–III',
  accent: '#b8e37a',
  icon: 'acid',
  maxLevel: 3,
};

export const BUILD_DEFS = [ACID_DEF, ...SPECIAL_TOWERS, ...DEVICES];

export const BUILD_LOOKUP = Object.fromEntries(BUILD_DEFS.map((d) => [d.type, d]));

export function getBuildDef(type) {
  return BUILD_LOOKUP[type] || null;
}

export function getBuildCost(type, options = {}) {
  if (type === 'acid') {
    return getAcidBuildCost(options.stage || 1);
  }
  const def = getBuildDef(type);
  return def ? { ...def.buildCost } : null;
}

export function getUpgradeCost(building) {
  if (!building) return null;
  if (building.type === 'acid') return getAcidUpgradeCost(building.stage, building.level);
  if (SPECIAL_LOOKUP[building.type]) return getSpecialUpgradeCost(building.type, building.level);
  if (DEVICE_LOOKUP[building.type]) return getDeviceUpgradeCost(building.type, building.level);
  return null;
}

export function getBuildingStats(building) {
  if (!building) return null;
  if (building.type === 'acid') return getAcidStats(building.stage, building.level);
  if (SPECIAL_LOOKUP[building.type]) return getSpecialStats(building.type, building.level);
  if (DEVICE_LOOKUP[building.type]) return getDeviceStats(building.type, building.level);
  return null;
}

export function getBuildingLabel(building) {
  if (!building) return '未知装置';
  if (building.type === 'acid') {
    const s = getAcidStage(building.stage);
    return `${s.short} ${['', 'I', 'II', 'III'][building.level] || building.level}`;
  }
  const def = getBuildDef(building.type);
  if (!def) return building.type;
  if (SPECIAL_LOOKUP[building.type]) return `${def.short} ${roman(building.level)}`;
  return `${def.short} ${['', 'I', 'II', 'III'][building.level] || building.level}`;
}

export function roman(n) {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] || String(n);
}

export function formatCost(cost) {
  if (!cost) return '';
  const parts = [];
  if (cost.dream) parts.push(`梦能 ${cost.dream}`);
  if (cost.reagent) parts.push(`试剂 ${cost.reagent}`);
  return parts.join(' · ');
}
