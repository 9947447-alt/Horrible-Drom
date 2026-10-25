// v2.1：室友性格、无线电求援、遗物、成就与每日挑战数据。

export const ROOMMATE_TRAITS = {
  economist: {
    id: 'economist',
    name: '经济流',
    title: '会算账的人',
    desc: '把每一度电都记在账本上。求援偏借钱，回报是额外的梦能。',
    request: {
      title: '周转一下',
      text: '“先借我一点梦能，明早连本带利还你。”',
      cost: { dream: 25, reagent: 0 },
      reward: { kind: 'dream', value: 55 },
      rewardLabel: '梦能 +55',
    },
    bondLine: '阿凯把私房钱从门缝底下塞了回来。',
  },
  gunner: {
    id: 'gunner',
    name: '炮台流',
    title: '床底下全是零件',
    desc: '嘴上说躺平，手里一直在改炮台。求援后会帮你分担火力。',
    request: {
      title: '借点零件',
      text: '“给我点梦能，我把床板改成炮架。”',
      cost: { dream: 20, reagent: 0 },
      reward: { kind: 'roommateOffense', value: 2.4 },
      rewardLabel: '小满火力 +2.4/s',
    },
    bondLine: '小满的炮台从床底伸了出来。',
  },
  turtle: {
    id: 'turtle',
    name: '龟缩流',
    title: '门后三层被子',
    desc: '不轻易出门，但很懂怎么把门修好。求援后给你的门加一层缓冲。',
    request: {
      title: '门轴响了',
      text: '“分我一点试剂，我把你那边的门轴也垫一下。”',
      cost: { dream: 0, reagent: 8 },
      reward: { kind: 'doorHealPct', value: 0.12 },
      rewardLabel: '气密门回复 12%',
    },
    bondLine: '老白隔着墙给你递来一截缓冲胶条。',
  },
  chemist: {
    id: 'chemist',
    name: '反应流',
    title: '浓度就是一切',
    desc: '实验记录本写满配方。求援后会回赠试剂，偶尔还会帮你稳住反应链。',
    request: {
      title: '缺一支试剂',
      text: '“借我一点梦能，我把多余的试剂给你。”',
      cost: { dream: 20, reagent: 0 },
      reward: { kind: 'reagent', value: 14 },
      rewardLabel: '试剂 +14',
    },
    bondLine: '雨桐从门缝里递来一支标着浓度的试剂。',
  },
  lucky: {
    id: 'lucky',
    name: '运气流',
    title: '六六的第六感',
    desc: '总能在最糟的夜里摸到好东西。求援回报完全随机。',
    request: {
      title: '赌一把',
      text: '“借我点梦能，我翻翻床底，说不定有惊喜。”',
      cost: { dream: 25, reagent: 0 },
      reward: { kind: 'lucky', value: 0 },
      rewardLabel: '随机谢礼',
    },
    bondLine: '六六从床底摸出一样东西，看不出是什么，但好像是好东西。',
  },
};

// 回收舍友遗物时可能开出的奖励。
export const RELIC_REWARDS = [
  { kind: 'dream', min: 70, max: 120, label: '梦能结晶', color: '#ffc75a' },
  { kind: 'reagent', min: 12, max: 22, label: '试剂瓶', color: '#63e0c2' },
  { kind: 'doorHealPct', min: 0.08, max: 0.14, label: '缓冲胶条', color: '#c7e8a8' },
];

export const ACHIEVEMENTS = [
  { id: 'first_dawn', name: '第一次天亮', desc: '任意难度取得一次胜利。', icon: 'sun' },
  { id: 'nightmare_clear', name: '噩梦通关', desc: '在噩梦难度取得胜利。', icon: 'skull' },
  { id: 'night_banisher', name: '滴定完成', desc: '在天亮前击退全部梦魇。', icon: 'spark' },
  { id: 'no_repair', name: '一扇好门', desc: '不维修气密门并取得胜利。', icon: 'shield' },
  { id: 'reaction_six', name: '反应堆', desc: '单局累计激活 6 次反应链。', icon: 'reaction' },
  { id: 'roommate_savior', name: '无线电守夜人', desc: '接受 3 次室友求援。', icon: 'radio' },
  { id: 'relic_hunter', name: '遗物收藏家', desc: '回收 2 件舍友遗物。', icon: 'archive' },
  { id: 'pressure_14', name: '终焉之前', desc: '在夜魇压力 Lv.14 下取得胜利。', icon: 'pressure' },
  { id: 'daily_clear', name: '今日值班', desc: '完成一次每日挑战并取得胜利。', icon: 'clock' },
  { id: 'abyss_clear', name: '深渊归来', desc: '在深渊难度取得胜利。', icon: 'skull' },
];

export const DAILY_MODIFIERS = [
  {
    id: 'thin_air',
    name: '雾夜',
    desc: '雾气压低产出：梦能与试剂收入 -10%。',
    effects: { economyMult: 0.9 },
    accent: '#8c9aa8',
  },
  {
    id: 'brittle',
    name: '薄门',
    desc: '气密门最大耐久 -15%。',
    effects: { doorHpMult: 0.85 },
    accent: '#ff6b57',
  },
  {
    id: 'long_night',
    name: '长夜',
    desc: '天亮延后 45 秒。',
    effects: { dawnBonus: 45 },
    accent: '#ffc75a',
  },
  {
    id: 'high_pressure',
    name: '高压',
    desc: '梦魇生命 +12%。',
    effects: { nightmareHpMult: 1.12 },
    accent: '#b49bff',
  },
];

export const DAILY_LOOKUP = Object.fromEntries(DAILY_MODIFIERS.map((m) => [m.id, m]));
export const ACHIEVEMENT_LOOKUP = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function dailyKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 每日挑战：固定日期种子 + 两个不同的修饰词。
 * UI 可在菜单/选房展示；模拟层只接收 modifierIds 与 seed。
 */
export function getDailyPlan(date = new Date()) {
  const key = dailyKey(date);
  const seed = hashString(`horrible-dorm:${key}`) || 1;
  const first = DAILY_MODIFIERS[seed % DAILY_MODIFIERS.length];
  let second = DAILY_MODIFIERS[(seed >>> 5) % DAILY_MODIFIERS.length];
  if (second.id === first.id) {
    second = DAILY_MODIFIERS[(DAILY_MODIFIERS.indexOf(first) + 1) % DAILY_MODIFIERS.length];
  }
  return {
    key,
    seed,
    modifierIds: [first.id, second.id],
    modifiers: [first, second],
    label: `每日守夜 · ${key}`,
  };
}

export function getDailyEffects(modifierIds = []) {
  const effects = {
    economyMult: 1,
    doorHpMult: 1,
    dawnBonus: 0,
    nightmareHpMult: 1,
  };
  for (const id of modifierIds) {
    const mod = DAILY_LOOKUP[id];
    if (!mod) continue;
    for (const [key, value] of Object.entries(mod.effects || {})) {
      if (key === 'dawnBonus') effects.dawnBonus += value;
      else effects[key] *= value;
    }
  }
  return effects;
}
