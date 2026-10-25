// 《熄灯之后：反应》全局配置。数值集中于此，方便无头模拟调参。

export const CONFIG = {
  version: 1,
  prepDuration: 25,
  spawnDelay: 65,
  firstAttackDelay: 50,
  startingDream: 100,
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
    income: [0, 3.0, 5.0, 8.0, 13.0, 21.0, 34.0, 55.0, 90.0],
    upgradeCost: [0, 35, 65, 110, 180, 300, 480, 760],
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
    costPerHp: 0.09,
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
    baseHp: 2200,
    baseDamage: 19,
    baseInterval: 2.0,
    hpScale: [0, 1, 1.15, 1.32, 1.52, 1.75, 2.0, 2.3, 2.65, 3.05, 3.5, 4.03, 4.63, 5.32, 6.12],
    dmgScale: [0, 1, 1.1, 1.21, 1.33, 1.46, 1.61, 1.77, 1.95, 2.15, 2.36, 2.6, 2.86, 3.15, 3.46],
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
    hpMult: 1.2,
    dmgMult: 1.18,
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
    hpMult: 1.5,
    dmgMult: 1.42,
    economyMult: 0.95,
    dawnSeconds: 570,
    secondary: true,
    secondaryAt: 380,
    accent: '#ff6b57',
    targetWin: '30%–45%',
  },
};
