// 《熄灯之后：反应》全局配置。数值集中于此，方便无头模拟调参。

export const CONFIG = {
  version: 1,
  prepDuration: 25,
  spawnDelay: 35,
  firstAttackDelay: 30,
  startingDream: 70,
  startingReagent: 0,
  sellRefund: 0.5,

  map: {
    width: 6,
    height: 5,
    bedWidth: 2,
    bedHeight: 2,
  },

  bed: {
    maxLevel: 8,
    income: [0, 2.0, 3.4, 5.8, 9.8, 16.5, 28, 47, 80],
    upgradeCost: [0, 40, 75, 130, 220, 360, 580, 900],
    // 床达到这些等级时，门至少要达到对应等级
    doorGate: { 4: 2, 6: 4, 8: 6 },
  },

  door: {
    maxLevel: 8,
    hp: [0, 180, 340, 600, 1050, 1800, 3000, 5000, 8000],
    upgradeCost: [0, 45, 85, 150, 250, 400, 640, 980],
    upgradeReagent: [0, 0, 0, 4, 8, 14, 22, 34],
  },

  repair: {
    costPerHp: 0.16,
    minCost: 3,
  },

  shower: {
    cooldown: 45,
    healPct: 0.14,
    purifySeconds: 5,
  },

  acid: {
    maxStage: 6,
    maxTier: 3,
    tierMult: [0, 1, 1.55, 2.25],
    rangePerTier: 0.16,
    intervalPerTier: 0.045,
    unlockDiscount: 0.72,
  },

  special: {
    maxLevel: 10,
  },

  device: {
    maxLevel: 3,
  },

  nightmare: {
    baseHp: 900,
    baseDamage: 10,
    baseInterval: 1.8,
    hpScale: [0, 1, 1.18, 1.39, 1.64, 1.94, 2.29, 2.7, 3.19, 3.76, 4.44, 5.24, 6.18, 7.29, 8.6],
    dmgScale: [0, 1, 1.12, 1.25, 1.4, 1.57, 1.76, 1.97, 2.21, 2.47, 2.77, 3.1, 3.47, 3.89, 4.36],
    // 达到某等级所需累计压力经验；索引 = 等级
    pressureXpForLevel: [0, 0, 50, 120, 215, 335, 480, 655, 865, 1115, 1410, 1755, 2155, 2615, 3140],
    xpPerSecond: 2.4,
    xpPerDoorDamage: 0.10,
    xpPerElimination: 180,
    xpPerMinion: 12,
    retreatHpPct: 0.15,
    retreatDuration: 12,
    healPerSecondPct: 0.035,
    targetSwitchInterval: 18,
    maxLevel: 14,
    // 梦魇攻击对 AI 舍友的换算压力（避免 AI 太容易/太难死）
    roommateAggroWeight: 0.9,
  },

  pressure: {
    skillsAt: [3, 6, 9, 12, 14],
  },

  roommates: {
    damageTickInterval: 2.0,
    baseDoorHp: 280,
    doorGrowthPerMinute: 180,
    baseOffense: 3,
    offenseGrowthPerMinute: 2.4,
    firstEliminationMinTime: 150,
    eliminationCooldown: 55,
  },

  fx: {
    maxEvents: 14,
    maxFx: 48,
  },
};

export const DIFFICULTIES = {
  easy: {
    id: 'easy',
    name: '简单',
    sub: '先学会躺平',
    desc: '一只梦魇；资源更宽裕，适合熟悉反应链。',
    hpMult: 0.75,
    dmgMult: 0.7,
    economyMult: 1.15,
    dawnSeconds: 360,
    secondary: false,
    secondaryAt: Infinity,
    accent: '#7ed9a7',
    targetWin: '≥85%',
  },
  normal: {
    id: 'normal',
    name: '普通',
    sub: '长夜的标准答案',
    desc: '一只梦魇；完整经济与技能压力，推荐首次体验。',
    hpMult: 1,
    dmgMult: 1,
    economyMult: 1,
    dawnSeconds: 480,
    secondary: false,
    secondaryAt: Infinity,
    accent: '#ffc75a',
    targetWin: '60%–75%',
  },
  nightmare: {
    id: 'nightmare',
    name: '噩梦',
    sub: '双魇夜',
    desc: '主魇之外，04:00 还会从黑掉的宿舍里钻出第二只梦魇。',
    hpMult: 1.25,
    dmgMult: 1.15,
    economyMult: 0.95,
    dawnSeconds: 570,
    secondary: true,
    secondaryAt: 240,
    accent: '#ff6b57',
    targetWin: '30%–45%',
  },
};
