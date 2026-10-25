// 反应链：相邻满足条件自动生效，不消耗点击。
// effect 字段由模拟层读取；UI 只展示名称/说明/组成。

export const REACTIONS = [
  {
    id: 'catalytic_oxidation',
    name: '催化氧化',
    desc: '酸系炮台与催化台相邻：酸系伤害提高，灼烧/腐蚀扩散。',
    requires: ['acid', 'catalyst'],
    accent: '#ffb45e',
    effect: { acidDamageBonus: 0.24, spread: true },
    icon: 'spark',
  },
  {
    id: 'low_temp_condensation',
    name: '低温凝析',
    desc: '冷凝器与通风柜相邻：强化减速与反隐，对气体与磷火梦魇额外有效。',
    requires: ['condenser', 'vent'],
    accent: '#8fd8ff',
    effect: { slowBonus: 0.12, reveal: true },
    icon: 'snow',
  },
  {
    id: 'electromagnetic_quench',
    name: '电磁淬火',
    desc: '加速器与冷凝器相邻：炮台附带电/冷属性，有概率眩晕金属与液态梦魇。',
    requires: ['accelerator', 'condenser'],
    accent: '#ffe27a',
    effect: { electric: true, stunChance: 0.08 },
    icon: 'bolt',
  },
  {
    id: 'detonation_oxidation',
    name: '爆鸣氧化',
    desc: '氯酸钾炮台与催化台相邻：周期轰出更大范围的氧化爆裂。',
    requires: ['chlorate', 'catalyst'],
    accent: '#ff8d6b',
    effect: { aoeBonus: 0.35, damageBonus: 0.2, interval: 4.5 },
    icon: 'burst',
  },
  {
    id: 'aromatic_resonance',
    name: '芳烃共振',
    desc: '苯炮台与加速器相邻：连锁次数增加，攻速提高，适合双魇控场。',
    requires: ['benzene', 'accelerator'],
    accent: '#ff9ab5',
    effect: { chainBonus: 1, attackSpeedBonus: 0.25 },
    icon: 'ring',
  },
  {
    id: 'neutralization_barrier',
    name: '中和屏障',
    desc: '中和池靠近气密门：门持续回复，并降低气体/腐蚀伤害。',
    requires: ['neutralizer', 'door'],
    accent: '#c7e8a8',
    effect: { doorRegen: 2, damageReduction: 0.12 },
    icon: 'pool',
  },
];

export const REACTION_LOOKUP = Object.fromEntries(REACTIONS.map((r) => [r.id, r]));
