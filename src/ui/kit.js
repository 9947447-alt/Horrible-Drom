// UI 工具层：格式化、静态组件片段、内容数据派生。
// 只读 content/state；不修改任何游戏状态。

import {
  CONFIG, DIFFICULTIES, DAMAGE_TYPES, NIGHTMARES, REACTIONS,
  ACID_STAGES, SPECIAL_TOWERS, DEVICES, ROOMS,
  getBuildDef, getAcidStage, getAcidStats, getAcidUpgradeCost, getAcidBuildCost,
  getSpecialStats, getSpecialUpgradeCost, getDeviceStats, getDeviceUpgradeCost,
  getBuildingStats, getBuildingLabel, getUpgradeCost, getRoom, roman,
} from '../content/index.js';
import { icon } from './icons.js';

export { CONFIG, DIFFICULTIES, DAMAGE_TYPES, NIGHTMARES, REACTIONS, ACID_STAGES, SPECIAL_TOWERS, DEVICES, ROOMS };
export { getBuildDef, getAcidStage, getAcidStats, getAcidUpgradeCost, getAcidBuildCost, getSpecialStats, getSpecialUpgradeCost, getDeviceStats, getDeviceUpgradeCost, getBuildingStats, getBuildingLabel, getUpgradeCost, getRoom, roman };

// ---------- 基础 ----------

export function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

export function clamp(value, min = 0, max = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function fmtInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(fallback);
  return Math.round(n).toLocaleString('zh-CN');
}

export function fmtNum(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 10000) return `${(n / 1000).toFixed(1)}k`;
  if (abs >= 100) return String(Math.round(n));
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(digits);
}

export function fmtRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '+0';
  return `+${n >= 10 ? n.toFixed(0) : n.toFixed(1)}`;
}

// 明确的人类可读时长："6 分 57 秒"，避免和夜钟 HH:MM 混淆。
export function fmtSpan(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return '—';
  const total = Math.max(0, Math.ceil(n));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  if (m <= 0) return `${sec} 秒`;
  if (sec <= 0) return `${m} 分`;
  return `${m} 分 ${sec} 秒`;
}

export function fmtDuration(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return '--:--';
  const total = Math.max(0, Math.ceil(n));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// state.clock 为 0..360，映射成 00:00 .. 06:00 的夜钟。
export function fmtClock(clock) {
  const total = Math.max(0, Math.round(Number(clock) || 0));
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function fmtPct(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0%';
  return `${(n * 100).toFixed(digits)}%`;
}

export function pad2(n) {
  return String(Math.max(0, Math.floor(Number(n) || 0))).padStart(2, '0');
}

export function difficultyOf(id) {
  return DIFFICULTIES[id] || DIFFICULTIES.normal;
}

export function phaseLabel(state) {
  const phase = state && state.phase;
  if (phase === 'prep') return '准备阶段';
  if (phase === 'night') return '守夜中';
  if (phase === 'victory') return '天亮了';
  if (phase === 'defeat') return '门已破';
  return '守夜中';
}

// ---------- 图标 / 组件片段 ----------

export function iconBadge(name, cls = '', size = 16) {
  return `<span class="ico-badge ${cls}" aria-hidden="true">${icon(name, '', size)}</span>`;
}

export function keycap(label) {
  return `<kbd class="keycap">${esc(label)}</kbd>`;
}

export function costHtml(cost) {
  const dream = num(cost && cost.dream);
  const reagent = num(cost && cost.reagent);
  const parts = [];
  if (dream > 0) parts.push(`<span class="cost cost--dream" title="梦能">${icon('dream', 'cost__ico', 13)}<b>${fmtInt(dream)}</b></span>`);
  if (reagent > 0) parts.push(`<span class="cost cost--reagent" title="试剂">${icon('reagent', 'cost__ico', 13)}<b>${fmtInt(reagent)}</b></span>`);
  if (!parts.length) parts.push('<span class="cost cost--free">免费</span>');
  return `<span class="costs">${parts.join('')}</span>`;
}

export function costText(cost) {
  const parts = [];
  if (cost && cost.dream) parts.push(`梦能 ${fmtInt(cost.dream)}`);
  if (cost && cost.reagent) parts.push(`试剂 ${fmtInt(cost.reagent)}`);
  return parts.join(' · ') || '免费';
}

export function btn(opts = {}) {
  const {
    act = '', id = '', value = '', label = '', iconName = '', cls = 'btn',
    tip = '', pressed = null, reason = '', extra = '', type = 'button', ariaLabel = '',
  } = opts;
  const attrs = [`type="${type}"`, `class="${cls}${reason ? ' is-disabled' : ''}"`];
  if (act) attrs.push(`data-act="${esc(act)}"`);
  if (id) attrs.push(`data-id="${esc(id)}"`);
  if (value !== '' && value != null) attrs.push(`data-value="${esc(value)}"`);
  if (tip) attrs.push(`data-tip="${esc(tip)}"`, `title="${esc(tip)}"`);
  if (reason) attrs.push(`aria-disabled="true"`, `data-reason="${esc(reason)}"`, `data-tip="${esc(reason)}"`, `title="${esc(reason)}"`);
  if (pressed === true) attrs.push('aria-pressed="true"');
  if (pressed === false) attrs.push('aria-pressed="false"');
  if (ariaLabel) attrs.push(`aria-label="${esc(ariaLabel)}"`);
  if (extra) attrs.push(extra);
  const ic = iconName ? icon(iconName, 'btn__ico', 16) : '';
  return `<button ${attrs.join(' ')}>${ic}${label ? `<span class="btn__label">${label}</span>` : ''}</button>`;
}

export function iconBtn(opts = {}) {
  return btn({ cls: 'iconbtn', ...opts });
}

// 血条 / 进度条。scale 写入 CSS 自定义属性，避免数字抖动。
export function bar(cls, pctValue, opts = {}) {
  const pct = Math.round(clamp(pctValue) * 1000) / 10;
  const tone = opts.tone ? ` bar--${opts.tone}` : '';
  const label = opts.label ? ` aria-label="${esc(opts.label)}"` : '';
  const role = opts.decorative ? 'aria-hidden="true"' : 'role="progressbar"';
  const extra = opts.decorative ? '' : ` aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"`;
  return `<span class="bar ${cls || ''}${tone}" ${role}${label}${extra}><i class="bar__fill" style="--v:${pct}%"></i></span>`;
}

export function pips(count, max, cls = '') {
  let out = '';
  for (let i = 1; i <= max; i += 1) {
    out += `<i class="pip${i <= count ? ' is-on' : ''}"></i>`;
  }
  return `<span class="pips ${cls}" aria-hidden="true">${out}</span>`;
}

// ---------- 设置 ----------

export function mergeSettings(state, getSettings) {
  let base = {};
  try {
    const fromFn = typeof getSettings === 'function' ? getSettings() : null;
    if (fromFn && typeof fromFn === 'object') base = { ...fromFn };
  } catch (err) {
    base = {};
  }
  if (state && state.settings && typeof state.settings === 'object') {
    base = { ...base, ...state.settings };
  }
  return {
    volume: clamp(base.volume == null ? 0.6 : base.volume),
    muted: Boolean(base.muted),
    reducedMotion: Boolean(base.reducedMotion),
    shake: base.shake !== false,
  };
}

// ---------- 音效 / 状态提示 ----------

export function damageTypeMeta(type) {
  return DAMAGE_TYPES[type] || { name: type || '未知', color: '#d9c9ad', icon: 'impact' };
}

export function damageTag(type, extraCls = '') {
  const meta = damageTypeMeta(type);
  return `<span class="dtag ${extraCls}" style="--dtag:${meta.color}" title="${esc(meta.name)}伤害">${icon(meta.icon, '', 13)}<span>${esc(meta.name)}</span></span>`;
}

export function weaknessTags(nightmareDef) {
  if (!nightmareDef) return '';
  const weak = (nightmareDef.weaknesses || []).map((t) => {
    const meta = damageTypeMeta(t);
    return `<span class="dtag dtag--weak" style="--dtag:${meta.color}" data-tip="${esc(meta.name)} 弱点 · 伤害 ×1.5" title="${esc(meta.name)} 弱点 · 伤害 ×1.5">${icon(meta.icon, '', 13)}<span>${esc(meta.name)}</span></span>`;
  });
  const resist = (nightmareDef.resistances || []).map((t) => {
    const meta = damageTypeMeta(t);
    return `<span class="dtag dtag--resist" style="--dtag:${meta.color}" data-tip="${esc(meta.name)} 抗性 · 伤害 ×0.5" title="${esc(meta.name)} 抗性 · 伤害 ×0.5">${icon(meta.icon, '', 13)}<span>${esc(meta.name)}</span></span>`;
  });
  return `<span class="dtags">${weak.join('')}${resist.join('')}</span>`;
}

// ---------- 建筑派生 ----------

export function buildingIconName(building) {
  if (!building) return 'spark';
  if (building.type === 'acid') return getAcidStage(building.stage).icon || 'acid';
  const def = getBuildDef(building.type);
  return (def && def.icon) || 'spark';
}

export function buildingAccent(building) {
  if (!building) return '#ffc75a';
  if (building.type === 'acid') return getAcidStage(building.stage).accent || '#b8e37a';
  const def = getBuildDef(building.type);
  return (def && def.accent) || '#ffc75a';
}

export function buildingName(building) {
  if (!building) return '未知装置';
  if (building.type === 'acid') return getAcidStage(building.stage).name;
  const def = getBuildDef(building.type);
  return def ? def.name : building.type;
}

export function buildingLevelLabel(building) {
  if (!building) return '';
  if (building.type === 'acid') return `${roman(building.level)} 级 · 阶段 ${building.stage}/6`;
  if (getBuildDef(building.type) && getBuildDef(building.type).maxLevel === 10) return roman(building.level);
  return ['', 'I', 'II', 'III'][building.level] || String(building.level);
}

export function deviceEffectLine(type, stats) {
  if (!stats) return '';
  switch (type) {
    case 'analyzer': return `试剂 +${fmtNum(stats.reagentPerSec || 0, 1)}/s`;
    case 'condenser': return `减速 ${fmtPct(stats.slowPct)} · 冷伤 ${fmtNum(stats.coldDps || 0, 1)}/s · 范围 ${fmtNum(stats.range, 1)}`;
    case 'vent': return `反隐 ${fmtNum(stats.revealRange, 1)} · 风伤 ${fmtNum(stats.windDps || 0, 1)}/s · 威胁 -${fmtPct(stats.threatReduction)}`;
    case 'catalyst': return `反应效率 +${fmtPct(stats.reactionBoost)} · 范围 ${fmtNum(stats.range, 1)}`;
    case 'neutralizer': return `修门 ${fmtNum(stats.repairPerSec || 0, 0)}/s · 减伤 ${fmtPct(stats.doorDamageReduction)} · 范围 ${fmtNum(stats.range, 1)}`;
    case 'accelerator': return `相邻攻速 +${fmtPct(stats.attackSpeedBonus)} · 范围 ${fmtNum(stats.range, 1)}${stats.electric ? ' · 附电' : ''}`;
    case 'atm': return `伤害→梦能 ${fmtPct(stats.conversion)} · 上限 ${fmtNum(stats.capPerSec, 0)}/s · 范围 ${fmtNum(stats.range, 1)}`;
    default: return '';
  }
}

export function buildingStatParts(building) {
  if (!building) return [];
  const stats = getBuildingStats(building);
  if (!stats) return [];
  if (building.type === 'acid') {
    const type = damageTypeMeta(stats.damageType);
    return [
      `伤害 ${fmtNum(stats.damage, 1)}`,
      `间隔 ${fmtNum(stats.interval, 2)}s`,
      `范围 ${fmtNum(stats.range, 1)}`,
      `类型 ${type.name}`,
    ];
  }
  const special = SPECIAL_TOWERS.find((s) => s.type === building.type);
  if (special) {
    const type = damageTypeMeta(special.damageType);
    return [
      `伤害 ${fmtNum(stats.damage, 1)}`,
      `间隔 ${fmtNum(stats.interval, 2)}s`,
      `范围 ${fmtNum(stats.range, 1)}`,
      `类型 ${type.name}`,
    ];
  }
  return [deviceEffectLine(building.type, stats)];
}

export function upgradeSummary(building) {
  if (!building) return { text: '', reason: '无可升级目标' };
  const cost = getUpgradeCost(building);
  if (!cost) return { text: '已达最高等级', reason: '已达最高等级' };
  const stats = getBuildingStats(building);
  if (cost.kind === 'evolve') {
    return {
      text: `研究进入 ${cost.nextName}`,
      detail: `研究后本塔进入 ${cost.nextName} I，并解锁新阶段`,
      cost,
      kind: 'evolve',
    };
  }
  let detail = '';
  if (building.type === 'acid') {
    const next = getAcidStats(building.stage, building.level + 1);
    detail = `伤害 ${fmtNum(stats.damage, 1)} → ${fmtNum(next.damage, 1)} · 间隔 ${fmtNum(stats.interval, 2)} → ${fmtNum(next.interval, 2)}s`;
  } else if (SPECIAL_TOWERS.some((s) => s.type === building.type)) {
    const next = getSpecialStats(building.type, building.level + 1);
    detail = `伤害 ${fmtNum(stats.damage, 1)} → ${fmtNum(next.damage, 1)} · 间隔 ${fmtNum(stats.interval, 2)} → ${fmtNum(next.interval, 2)}s`;
  } else {
    const next = getDeviceStats(building.type, building.level + 1);
    detail = `升级后：${deviceEffectLine(building.type, next)}`;
  }
  return { text: `升至 ${roman(cost.nextLevel)}`, detail, cost, kind: 'level' };
}

// 估算拆除返还（按 content 价格推导，仅供参考展示）。
export function refundEstimate(building) {
  if (!building) return 0;
  let total = 0;
  if (building.type === 'acid') {
    total += getAcidBuildCost(building.stage).dream || 0;
    for (let lv = 1; lv < building.level; lv += 1) {
      const c = getAcidUpgradeCost(building.stage, lv);
      if (c) total += c.dream || 0;
    }
  } else {
    const def = getBuildDef(building.type);
    total += (def && def.buildCost && def.buildCost.dream) || 0;
    if (SPECIAL_TOWERS.some((s) => s.type === building.type)) {
      for (let lv = 1; lv < building.level; lv += 1) {
        const c = getSpecialUpgradeCost(building.type, lv);
        if (c) total += c.dream || 0;
      }
    } else {
      for (let lv = 1; lv < building.level; lv += 1) {
        const c = getDeviceUpgradeCost(building.type, lv);
        if (c) total += c.dream || 0;
      }
    }
  }
  return Math.floor(total * (CONFIG.sellRefund || 0.5));
}

// ---------- 玩家经济派生 ----------

export function bedIncome(state) {
  const level = num(state && state.player && state.player.bedLevel, 1);
  const diff = difficultyOf(state && state.difficulty);
  const base = (CONFIG.bed.income && CONFIG.bed.income[level]) || 0;
  return base * (diff.economyMult || 1);
}

export function reagentIncome(state) {
  const buildings = (state && state.buildings) || [];
  return buildings.reduce((sum, b) => {
    if (b.type !== 'analyzer') return sum;
    const stats = getDeviceStats('analyzer', b.level);
    return sum + (stats.reagentPerSec || 0);
  }, 0);
}

export function doorRepairCost(state) {
  const player = (state && state.player) || {};
  const missing = Math.max(0, num(player.doorMaxHp, 180) - num(player.doorHp, 180));
  const raw = missing * CONFIG.repair.costPerHp;
  if (missing <= 0) return 0;
  return Math.max(CONFIG.repair.minCost, Math.round(raw));
}

export function showerCooldownLeft(state) {
  const now = num(state && state.now, 0);
  const ready = num(state && state.player && state.player.showerReadyAt, 0);
  return Math.max(0, ready - now);
}

export function dawnRemaining(state) {
  if (!state) return 0;
  const nightElapsed = num(state.nightElapsed, null);
  if (nightElapsed != null) return Math.max(0, num(state.dawnAt, 480) - nightElapsed);
  const clock = num(state.clock, 0);
  return Math.max(0, (1 - clock / 360) * num(state.dawnAt, 480));
}

export function bedUpgradeGate(state) {
  const level = num(state && state.player && state.player.bedLevel, 1);
  const nextLevel = level + 1;
  const need = CONFIG.bed.doorGate && CONFIG.bed.doorGate[nextLevel];
  return need ? { bedLevel: nextLevel, doorLevel: need } : null;
}

// ---------- 房间 / 梦魇预览 ----------

export function roomStarterLabel(room) {
  if (!room || !room.starter) return '无';
  const s = room.starter;
  if (s.type === 'acid') {
    const def = getAcidStage(s.stage || 1);
    return `${def.name} ${roman(s.level || 1)}`;
  }
  const def = getBuildDef(s.type);
  return def ? `${def.name} ${roman(s.level || 1)}` : s.type;
}

// 选房界面“今晚主魇”：优先 state.nightmarePreview，其次由房间序号稳定映射。
export function roomNightmarePreview(state, room) {
  const preview = state && state.nightmarePreview;
  if (typeof preview === 'string') {
    const found = NIGHTMARES.find((n) => n.id === preview || n.name === preview);
    if (found) return found;
  }
  if (preview && typeof preview === 'object' && preview.id) {
    const found = NIGHTMARES.find((n) => n.id === preview.id);
    if (found) return found;
  }
  const index = Math.max(0, ROOMS.findIndex((r) => r.id === room.id));
  return NIGHTMARES[index % NIGHTMARES.length];
}

// ---------- 事件 ----------

const EVENT_ICON = {
  build: 'hammer',
  upgrade: 'upgrade',
  reaction: 'spark',
  nightmare: 'skull',
  skill: 'burst',
  damage: 'impact',
  kill: 'skull',
  repair: 'wrench',
  resource: 'dream',
  roommate: 'users',
  door: 'door',
  dawn: 'sun',
  warn: 'warning',
  info: 'info',
};

export function eventIcon(kind) {
  return EVENT_ICON[kind] || EVENT_ICON.info;
}

// ---------- 各类按钮状态 ----------

export function disabledReasonForResource(state, cost) {
  const player = (state && state.player) || {};
  const dream = num(player.dream);
  const reagent = num(player.reagent);
  if (cost && cost.dream && dream < cost.dream) return `梦能不足：需要 ${fmtInt(cost.dream)}，当前 ${fmtInt(dream)}`;
  if (cost && cost.reagent && reagent < cost.reagent) return `试剂不足：需要 ${fmtInt(cost.reagent)}，当前 ${fmtInt(reagent)}`;
  return '';
}
