// 模态层：难度 / 暂停 / 帮助与图鉴 / 设置 / 结算 / 首次教程 / 制作说明。
// 所有按钮通过 ctx.call(actions) 或 ctx.openOverlay / ctx.closeOverlay 走控制器。

import {
  CONFIG, DIFFICULTIES, NIGHTMARES, REACTIONS, ACID_STAGES, SPECIAL_TOWERS, DEVICES,
  ACHIEVEMENTS, ACHIEVEMENT_LOOKUP, DAILY_LOOKUP, getDailyPlan,
  getRoom, getDeviceStats, roman,
} from '../content/index.js';
import { icon } from './icons.js';
import {
  esc, fmtInt, fmtNum, fmtDuration, fmtSpan, fmtClock, fmtNight, fmtDateStamp, clamp, num, difficultyOf,
  btn, keycap, costHtml, weaknessTags, damageTypeMeta,
  deviceEffectLine, fmtRate, bedIncome, reagentIncome, dawnRemaining,
} from './kit.js';
import { difficultyStats } from './screens.js';

const HELP_TABS = [
  { id: 'nightmares', label: '梦魇图鉴', icon: 'skull' },
  { id: 'builds', label: '建造目录', icon: 'grid' },
  { id: 'reactions', label: '反应链', icon: 'spark' },
  { id: 'operations', label: '操作与规则', icon: 'keyboard' },
];

function shell(opts) {
  const root = document.createElement('div');
  root.className = `overlay overlay--${opts.kind || 'default'}${opts.rootClass ? ` ${opts.rootClass}` : ''}`;
  const panelClass = `overlay__panel${opts.panelClass ? ` ${opts.panelClass}` : ''}`;
  root.innerHTML = `
    <div class="overlay__backdrop"${opts.dismissible ? ' data-overlay-dismiss="1"' : ''}></div>
    <div class="${panelClass}" role="dialog" aria-modal="true" aria-label="${esc(opts.title || '对话')}">
      ${opts.head || ''}
      <div class="overlay__body">${opts.body || ''}</div>
      ${opts.foot || ''}
    </div>`;
  if (opts.dismissible) {
    const backdrop = root.querySelector('[data-overlay-dismiss]');
    if (backdrop && typeof opts.onDismiss === 'function') backdrop.addEventListener('click', opts.onDismiss);
  }
  return root;
}

function headHtml({ kicker = '', title = '', sub = '', close = true, closeLabel = '关闭' }) {
  return `
    <header class="overlay__head">
      <div class="overlay__heading">
        ${kicker ? `<p class="kicker kicker--sm">${esc(kicker)}</p>` : ''}
        <h2 class="overlay__title">${esc(title)}</h2>
        ${sub ? `<p class="overlay__sub">${esc(sub)}</p>` : ''}
      </div>
      ${close ? `<button type="button" class="iconbtn overlay__close" data-overlay-close="${esc(closeLabel)}" aria-label="${esc(closeLabel)}" data-tip="${esc(closeLabel)}（Esc）">${icon('close', '', 18)}</button>` : ''}
    </header>`;
}

function bindClose(root, ctx) {
  root.querySelectorAll('[data-overlay-close]').forEach((node) => {
    node.addEventListener('click', () => ctx.closeOverlay());
  });
}

// ---------- 难度 ----------
function renderDifficulty(ctx) {
  const state = ctx.state || {};
  const current = difficultyOf(state.difficulty);
  let selected = current.id;
  const cards = Object.values(DIFFICULTIES).map((def) => `
    <button type="button" class="diff-card${def.id === selected ? ' is-selected' : ''}" data-diff="${esc(def.id)}"
      style="--diff-accent:${esc(def.accent)}" aria-pressed="${def.id === selected ? 'true' : 'false'}">
      <span class="diff-card__stripe" aria-hidden="true"></span>
      <span class="diff-card__head">
        <span class="diff-card__name">${esc(def.name)}</span>
        <span class="diff-card__sub">${esc(def.sub)}</span>
        <span class="diff-card__check">${icon('check', '', 14)}</span>
      </span>
      <span class="diff-card__desc">${esc(def.desc)}</span>
      <span class="diff-card__stats">
        ${difficultyStats(def).map((row) => `<span class="diff-stat"><span>${esc(row.k)}</span><b>${esc(row.v)}</b></span>`).join('')}
      </span>
      <span class="diff-card__target">目标通关率 <b>${esc(def.targetWin || '—')}</b></span>
    </button>`).join('');

  const body = `
    <p class="overlay__lead">夜的长度决定梦的长度。难度只影响梦魇成长与资源，不改变基本规则。</p>
    <div class="diff-grid">${cards}</div>
    <p class="overlay__note">${icon('info', '', 14)} 可随时返回主菜单重选；对局中不会切换难度。</p>`;
  const foot = `
    <div class="overlay__foot-inner">
      ${btn({ label: '返回', iconName: 'arrowLeft', cls: 'btn btn--quiet', extra: 'data-overlay-close="返回"' })}
      <div class="overlay__foot-right">
        <span class="overlay__foot-hint">选择后进入宿舍值班表</span>
        ${btn({ label: '继续 · 选择宿舍', iconName: 'arrowRight', cls: 'btn btn--primary', extra: 'data-diff-confirm="1"' })}
      </div>
    </div>`;
  const root = shell({
    kind: 'difficulty', title: '选择难度', dismissible: true, onDismiss: () => ctx.closeOverlay(),
    panelClass: 'panel--paper panel--wide', body, foot,
    head: headHtml({ kicker: '熄灯之前 · 今晚的值班安排', title: '今晚的夜有多长？', sub: '简单适合熟悉反应链，噩梦会在 04:00 追加第二只梦魇。' }),
  });
  bindClose(root, ctx);

  function paint() {
    root.querySelectorAll('[data-diff]').forEach((card) => {
      const on = card.getAttribute('data-diff') === selected;
      card.classList.toggle('is-selected', on);
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  root.querySelectorAll('[data-diff]').forEach((card) => {
    card.addEventListener('click', () => {
      selected = card.getAttribute('data-diff');
      paint();
      ctx.call('setDifficulty', [selected]);
    });
  });
  const confirm = root.querySelector('[data-diff-confirm]');
  if (confirm) {
    confirm.addEventListener('click', () => {
      ctx.pickDifficulty(selected);
    });
  }
  return root;
}

// ---------- 暂停 ----------
function renderPause(ctx) {
  const state = ctx.state || {};
  const room = getRoom(state.roomId);
  const diff = difficultyOf(state.difficulty);
  const player = state.player || {};
  const body = `
    <div class="pause-summary">
      <div class="pause-summary__line">
        <span><small>房间</small><b>${esc(room.number)} ${esc(room.name)}</b></span>
        <span><small>难度</small><b>${esc(diff.name)}${diff.secondary ? ' · 双魇' : ''}</b></span>
        <span><small>夜钟</small><b class="mono">${fmtClock(state.clock || 0)}</b></span>
        <span><small>天亮还剩</small><b class="mono">${fmtSpan(dawnRemaining(state))}</b></span>
      </div>
      <div class="pause-summary__line pause-summary__line--sub">
        <span><small>梦能</small><b>${fmtInt(player.dream)} <em>${fmtRate(bedIncome(state))}/s</em></b></span>
        <span><small>试剂</small><b>${fmtInt(player.reagent)} <em>${fmtRate(reagentIncome(state))}/s</em></b></span>
        <span><small>气密门</small><b>${fmtInt(player.doorHp)} / ${fmtInt(player.doorMaxHp)}</b></span>
        <span><small>梦魇</small><b>${(state.activeNightmares || []).length} 只</b></span>
      </div>
    </div>
    <div class="pause-actions">
      ${btn({ label: '继续守夜', iconName: 'play', cls: 'btn btn--primary btn--lg', extra: 'data-pause="resume"' })}
      ${btn({ label: '帮助与图鉴', iconName: 'book', extra: 'data-pause="help"' })}
      ${btn({ label: '设置', iconName: 'sliders', extra: 'data-pause="settings"' })}
      ${btn({ label: '重新开始', iconName: 'restart', cls: 'btn btn--quiet', extra: 'data-pause="restart"' })}
      ${btn({ label: '返回主菜单', iconName: 'home', cls: 'btn btn--quiet', extra: 'data-pause="menu"' })}
    </div>
    <div class="pause-hints">
      <span>${keycap('Space')} 继续</span>
      <span>${keycap('Esc')} 返回游戏</span>
      <span>${keycap('1–0')} 建造</span>
      <span>${keycap('R')} 维修</span>
      <span>${keycap('Q')} 喷淋</span>
    </div>`;
  const foot = `<div class="overlay__foot-inner overlay__foot-inner--center">
      <span class="overlay__stamp overlay__stamp--dim">暂停 · 记录中断</span>
    </div>`;
  const root = shell({
    kind: 'pause', title: '暂停', dismissible: true, onDismiss: () => ctx.closeOverlay(),
    panelClass: 'panel--paper panel--pause', body, foot,
    head: headHtml({ kicker: '夜间记录 · 中断', title: '暂停守夜', sub: '梦魇不会体谅实验记录的中断。' }),
  });
  bindClose(root, ctx);
  root.querySelectorAll('[data-pause]').forEach((node) => {
    node.addEventListener('click', () => {
      const action = node.getAttribute('data-pause');
      if (action === 'resume') ctx.closeOverlay();
      else if (action === 'help') ctx.openOverlay('help', 'operations');
      else if (action === 'settings') ctx.openOverlay('settings');
      else if (action === 'restart') {
        ctx.call('restart');
        ctx.closeOverlay({ skipResume: true });
      } else if (action === 'menu') {
        ctx.call('goMenu');
        ctx.closeOverlay({ skipResume: true });
      }
    });
  });
  return root;
}

// ---------- 帮助与图鉴 ----------
function nightmareCard(def) {
  const skills = (def.skills || []).map((sk) => `
    <li class="skill-row">
      <span class="skill-row__lv">Lv.${sk.level}</span>
      <span class="skill-row__name">${esc(sk.name)}</span>
      <span class="skill-row__desc">${esc(sk.desc)}</span>
    </li>`).join('');
  return `
    <article class="codex-card" style="--codex-accent:${esc(def.accent)}">
      <div class="codex-card__head">
        <span class="codex-card__icon">${icon('skull', '', 18)}</span>
        <div class="codex-card__title">
          <b>${esc(def.name)}</b>
          <small>${esc(def.title)}</small>
        </div>
        <span class="codex-card__tag">${esc(def.mechanic)}</span>
      </div>
      <p class="codex-card__desc">${esc(def.desc)}</p>
      <div class="codex-card__tags">${weaknessTags(def)}</div>
      <ul class="skill-list">${skills}</ul>
      <div class="codex-card__stats">
        <span>生命 ×${def.hpMult}</span>
        <span>伤害 ×${def.dmgMult}</span>
        <span>终焉 · ${esc(def.finalForm || '—')}</span>
      </div>
    </article>`;
}

function buildCatalogPanel() {
  const acidRows = ACID_STAGES.map((stage) => `
    <li class="catalog-row" style="--catalog-accent:${esc(stage.accent)}">
      <span class="catalog-row__icon">${icon(stage.icon || 'acid', '', 17)}</span>
      <span class="catalog-row__main">
        <b>阶段 ${roman(stage.stage)} · ${esc(stage.name)}</b>
        <small>${esc(stage.mechanic)} · ${esc(stage.desc)}</small>
      </span>
      <span class="catalog-row__meta">
        <span class="catalog-row__type">${damageTypeMeta(stage.damageType).name} ${fmtNum(stage.baseDamage, 1)}</span>
        <span class="catalog-row__cost">${costHtml(stage.buildCost)}</span>
      </span>
    </li>`).join('');
  const specialRows = SPECIAL_TOWERS.map((def) => `
    <li class="catalog-row" style="--catalog-accent:${esc(def.accent)}">
      <span class="catalog-row__icon">${icon(def.icon, '', 17)}</span>
      <span class="catalog-row__main"><b>${esc(def.name)}</b><small>${esc(def.mechanic)} · ${esc(def.desc)}</small></span>
      <span class="catalog-row__meta">
        <span class="catalog-row__type">${damageTypeMeta(def.damageType).name} · Lv I–${roman(def.maxLevel)}</span>
        <span class="catalog-row__cost">${costHtml(def.buildCost)}</span>
      </span>
    </li>`).join('');
  const deviceRows = DEVICES.map((def) => {
    const stats = getDeviceStats(def.type, 1);
    return `
      <li class="catalog-row" style="--catalog-accent:${esc(def.accent)}">
        <span class="catalog-row__icon">${icon(def.icon, '', 17)}</span>
        <span class="catalog-row__main"><b>${esc(def.name)}</b></span>
        <span class="catalog-row__meta">
          <span class="catalog-row__type">${esc(deviceEffectLine(def.type, stats))}${def.maxCount ? ` · 限 ${def.maxCount}` : ''}</span>
          <span class="catalog-row__cost">${costHtml(def.buildCost)}</span>
        </span>
      </li>`;
  }).join('');
  return `
    <section class="codex-section">
      <h3 class="codex-section__title">${icon('acid', '', 16)} 酸系主炮 · 六阶段进化</h3>
      <p class="codex-section__note">已解锁的阶段可以直接起建新塔；每座塔可从 I 级升至 III，再研究进入下一阶段。</p>
      <ul class="catalog-list">${acidRows}</ul>
    </section>
    <section class="codex-section">
      <h3 class="codex-section__title">${icon('burst', '', 16)} 特化炮台</h3>
      <ul class="catalog-list">${specialRows}</ul>
    </section>
    <section class="codex-section">
      <h3 class="codex-section__title">${icon('flask', '', 16)} 功能设备</h3>
      <ul class="catalog-list">${deviceRows}</ul>
    </section>`;
}

function reactionsPanel() {
  const cards = REACTIONS.map((reaction) => `
    <article class="reaction-card" style="--reaction-accent:${esc(reaction.accent)}">
      <div class="reaction-card__head">
        <span class="reaction-card__icon">${icon(reaction.icon || 'spark', '', 17)}</span>
        <b>${esc(reaction.name)}</b>
        <span class="reaction-card__req">${esc((reaction.requires || []).map((key) => ({
          acid: '酸系炮台', catalyst: '催化台', condenser: '冷凝器', vent: '通风柜',
          accelerator: '加速器', chlorate: '氯酸钾炮台', benzene: '苯炮台', neutralizer: '中和池', door: '气密门',
        }[key] || key)).join(' + '))}</span>
      </div>
      <p>${esc(reaction.desc)}</p>
    </article>`).join('');
  return `
    <p class="overlay__lead">相邻满足条件的装置会自动构成反应链，不消耗点击。房间格子与摆放顺序决定能拿到哪几条反应。</p>
    <div class="reaction-card-grid">${cards}</div>
    <div class="help-note">${icon('info', '', 15)}<span>“相邻”指上下左右四格；斜角不计。已激活的反应链会实时显示在对局右侧面板，并把结果写进事件流。</span></div>`;
}

function operationsPanel(ctx) {
  return `
    <div class="ops-grid">
      <section class="ops-card">
        <h3>${icon('keyboard', '', 16)} 键盘</h3>
        <ul class="ops-list">
          <li><span>${keycap('1')}–${keycap('0')}</span><b>选择建造卡</b></li>
          <li><span>${keycap('Q')}</span><b>应急喷淋</b></li>
          <li><span>${keycap('R')}</span><b>维修气密门</b></li>
          <li><span>${keycap('Space')}</span><b>暂停 / 继续</b></li>
          <li><span>${keycap('Esc')}</span><b>取消建造 / 关闭面板 / 暂停</b></li>
        </ul>
        <p class="ops-note">鼠标点击房间格子放置装置；右键取消建造。</p>
      </section>
      <section class="ops-card">
        <h3>${icon('target', '', 16)} 守夜规则</h3>
        <ul class="ops-list ops-list--rules">
          <li><span>目标</span><b>坚持到 06:00 天亮，或清空所有梦魇</b></li>
          <li><span>失败</span><b>气密门耐久归零</b></li>
          <li><span>准备</span><b>开局 ${CONFIG.prepDuration} 秒自由布防，梦魇随后苏醒</b></li>
          <li><span>资源</span><b>冷凝床产梦能，层析仪产试剂</b></li>
          <li><span>成长</span><b>梦魇靠挠门与淘汰舍友升级，技能节点 3/6/9/12/14</b></li>
          <li><span>噩梦</span><b>04:00 追加第二只梦魇</b></li>
        </ul>
      </section>
      <section class="ops-card">
        <h3>${icon('spark', '', 16)} 构筑提示</h3>
        <ul class="ops-list ops-list--rules">
          <li><span>床门</span><b>床升级到 4/6/8 前，门需先到 2/4/6 级</b></li>
          <li><span>酸系</span><b>塔到 III 级后“研究”可解锁下一阶段并提升全局阶段</b></li>
          <li><span>反应</span><b>催化台是酸系核心；冷凝器 + 通风柜负责减速反隐</b></li>
          <li><span>门体</span><b>中和池靠近门可回血；R 维修、Q 喷淋应急</b></li>
        </ul>
        ${ctx && typeof ctx.openTutorial === 'function' ? btn({ label: '重新查看首次教程', iconName: 'question', cls: 'btn btn--quiet btn--sm', extra: 'data-help-tutorial="1"' }) : ''}
      </section>
    </div>
    <div class="help-note help-note--safety">
      ${icon('warning', '', 15)}
      <span><b>安全边界：</b>作品中的酸系、氯酸钾、苯环与反应链均为幻想要素，用于命名与玩法叙事，不包含任何现实实验配方，也不构成实验操作指导。请勿在现实中模仿任何加热、混合或爆炸行为。</span>
    </div>`;
}

function renderHelp(ctx) {
  let activeTab = HELP_TABS.some((tab) => tab.id === ctx.tab) ? ctx.tab : 'nightmares';
  const panels = {
    nightmares: () => `
      <p class="overlay__lead">六种化学形态的梦魇。弱点伤害 ×1.5，抗性伤害 ×0.5；技能按压力等级依次苏醒。</p>
      <div class="codex-grid">${NIGHTMARES.map(nightmareCard).join('')}</div>`,
    builds: buildCatalogPanel,
    reactions: reactionsPanel,
    operations: () => operationsPanel(ctx),
  };
  const tabs = HELP_TABS.map((tab) => `
    <button type="button" class="help-tab${tab.id === activeTab ? ' is-active' : ''}" role="tab"
      aria-selected="${tab.id === activeTab ? 'true' : 'false'}" data-help-tab="${tab.id}">
      ${icon(tab.icon, '', 15)}<span>${esc(tab.label)}</span>
    </button>`).join('');
  const body = `
    <div class="help-tabs" role="tablist" aria-label="帮助分类">${tabs}</div>
    <div class="help-panels">
      ${HELP_TABS.map((tab) => `<div class="help-panel${tab.id === activeTab ? ' is-active' : ''}" data-help-panel="${tab.id}" role="tabpanel">${panels[tab.id]()}</div>`).join('')}
    </div>`;
  const root = shell({
    kind: 'help', title: '帮助与图鉴', dismissible: true, onDismiss: () => ctx.closeOverlay(),
    panelClass: 'panel--paper panel--help', body,
    head: headHtml({ kicker: '夜间观察手册 · 非卖品', title: '帮助与图鉴', sub: '梦魇、装置、反应链与操作，一页存档。' }),
  });
  bindClose(root, ctx);
  function activate(id) {
    activeTab = id;
    root.querySelectorAll('[data-help-tab]').forEach((tab) => {
      const on = tab.getAttribute('data-help-tab') === id;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    root.querySelectorAll('[data-help-panel]').forEach((panel) => {
      panel.classList.toggle('is-active', panel.getAttribute('data-help-panel') === id);
    });
  }
  root.querySelectorAll('[data-help-tab]').forEach((tab) => {
    tab.addEventListener('click', () => activate(tab.getAttribute('data-help-tab')));
  });
  const tutorialBtn = root.querySelector('[data-help-tutorial]');
  if (tutorialBtn && typeof ctx.openTutorial === 'function') {
    tutorialBtn.addEventListener('click', () => ctx.openTutorial());
  }
  return root;
}

// ---------- 设置 ----------
function renderSettings(ctx) {
  const current = ctx.settings || {};
  const volumePct = Math.round(clamp(current.volume) * 100);
  const body = `
    <div class="settings-list">
      <div class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__ico">${icon('volume', '', 17)}</span>
          <div><b>主音量</b><small>梦呓与装置的合成音效</small></div>
        </div>
        <div class="setting-row__control setting-row__control--slider">
          <input type="range" min="0" max="100" step="1" value="${volumePct}" data-setting-range="volume" aria-label="主音量" />
          <output data-setting-output="volume">${volumePct}%</output>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__ico">${icon(current.muted ? 'mute' : 'volume', '', 17)}</span>
          <div><b>静音</b><small>保留画面，关闭全部声音</small></div>
        </div>
        <div class="setting-row__control">
          ${btn({ label: current.muted ? '已静音' : '未静音', cls: `btn btn--toggle${current.muted ? ' is-on' : ''}`, extra: `data-setting-toggle="muted" aria-pressed="${current.muted ? 'true' : 'false'}"` })}
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__ico">${icon('motion', '', 17)}</span>
          <div><b>减少动效</b><small>关闭面板入场、事件滚动与脉冲动画</small></div>
        </div>
        <div class="setting-row__control">
          ${btn({ label: current.reducedMotion ? '已开启' : '未开启', cls: `btn btn--toggle${current.reducedMotion ? ' is-on' : ''}`, extra: `data-setting-toggle="reducedMotion" aria-pressed="${current.reducedMotion ? 'true' : 'false'}"` })}
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-row__label">
          <span class="setting-row__ico">${icon('shake', '', 17)}</span>
          <div><b>屏幕震动</b><small>梦魇攻击与爆炸时的镜头反馈</small></div>
        </div>
        <div class="setting-row__control">
          ${btn({ label: current.shake ? '已开启' : '已关闭', cls: `btn btn--toggle${current.shake ? ' is-on' : ''}`, extra: `data-setting-toggle="shake" aria-pressed="${current.shake ? 'true' : 'false'}"` })}
        </div>
      </div>
    </div>
    <p class="overlay__note">${icon('info', '', 14)} 设置会立即写入；若控制器尚未接入音频，音量与静音会先保存在状态里。</p>`;
  const foot = `<div class="overlay__foot-inner overlay__foot-inner--end">
      ${btn({ label: '完成', iconName: 'check', cls: 'btn btn--primary', extra: 'data-overlay-close="完成"' })}
    </div>`;
  const root = shell({
    kind: 'settings', title: '设置', dismissible: true, onDismiss: () => ctx.closeOverlay(),
    panelClass: 'panel--paper panel--settings', body, foot,
    head: headHtml({ kicker: '值班室设备 · 调校', title: '设置', sub: '所有调整即时生效。' }),
  });
  bindClose(root, ctx);

  const volumeInput = root.querySelector('[data-setting-range="volume"]');
  if (volumeInput) {
    volumeInput.addEventListener('input', () => {
      const value = clamp(Number(volumeInput.value) / 100);
      const output = root.querySelector('[data-setting-output="volume"]');
      if (output) output.textContent = `${Math.round(value * 100)}%`;
      ctx.call('setSetting', ['volume', value]);
    });
  }
  root.querySelectorAll('[data-setting-toggle]').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const key = toggle.getAttribute('data-setting-toggle');
      const isOn = toggle.getAttribute('aria-pressed') === 'true';
      const next = !isOn;
      toggle.setAttribute('aria-pressed', next ? 'true' : 'false');
      toggle.classList.toggle('is-on', next);
      const label = toggle.querySelector('.btn__label');
      if (label) label.textContent = next ? '已开启' : '未开启';
      if (key === 'muted' && label) label.textContent = next ? '已静音' : '未静音';
      ctx.call('setSetting', [key, next]);
    });
  });
  return root;
}

// ---------- 制作说明 ----------
function renderAbout(ctx) {
  const body = `
    <div class="about-grid">
      <section class="about-card">
        <h3>${icon('lamp', '', 16)} 设计方向</h3>
        <p>暖灯宿舍 × 化学实验记录本。墨蓝夜色里，纸色记录卡、胶带、印章与危险标识构成全部视觉语言；配色取自旧宿舍的暖灯、试剂的青与警报的珊瑚。</p>
        <p>所有图形均由 CSS 与内联 SVG 程序化绘制，没有外部图片、字体或 CDN。</p>
      </section>
      <section class="about-card">
        <h3>${icon('flask', '', 16)} 技术实现</h3>
        <ul class="about-list">
          <li>原生 ES Modules，无运行时依赖、无构建步骤</li>
          <li>Canvas 等距场景 + DOM HUD 分层</li>
          <li>WebAudio 合成音效</li>
          <li>支持 prefers-reduced-motion 与键盘操作</li>
        </ul>
      </section>
      <section class="about-card about-card--warn">
        <h3>${icon('warning', '', 16)} 内容边界</h3>
        <p>作品中的化学名词、酸系进化与反应链均为幻想要素，用于命名与玩法叙事，<b>不包含任何现实实验配方，也不构成实验操作指导</b>。</p>
        <p>请勿在现实中模仿任何装置、加热、混合或爆炸行为。</p>
      </section>
      <section class="about-card">
        <h3>${icon('users', '', 16)} 制作</h3>
        <p>个人原创项目 · v1.1</p>
        <p>玩法骨架致敬经典“守门发育”类型，名称、美术、文案、数值与系统均为原创实现。</p>
      </section>
    </div>`;
  const foot = `<div class="overlay__foot-inner overlay__foot-inner--end">
      ${btn({ label: '合上记录', iconName: 'book', cls: 'btn btn--primary', extra: 'data-overlay-close="合上记录"' })}
    </div>`;
  const root = shell({
    kind: 'about', title: '制作说明', dismissible: true, onDismiss: () => ctx.closeOverlay(),
    panelClass: 'panel--paper panel--about', body, foot,
    head: headHtml({ kicker: '记录本末页 · 制作者留', title: '制作说明', sub: '关于玩法、实现与安全边界。' }),
  });
  bindClose(root, ctx);
  return root;
}

// ---------- 值班记录 / 成就 ----------
const DIFF_ORDER = Object.keys(DIFFICULTIES);
const DAILY_MOD_ICONS = { thin_air: 'wind', brittle: 'door', long_night: 'moon', high_pressure: 'pressure' };

function achievementCard(def, unlockedAt) {
  const unlocked = Boolean(unlockedAt);
  return `
    <article class="ach-card${unlocked ? ' is-unlocked' : ' is-locked'}" style="--ach-accent:${unlocked ? '#ffc75a' : '#8c9aa8'}">
      <span class="ach-card__icon">${icon(def.icon || 'star', '', 20)}</span>
      <div class="ach-card__body">
        <div class="ach-card__head">
          <b>${esc(def.name)}</b>
          <span class="ach-card__state">${unlocked ? '已解锁' : '未解锁'}</span>
        </div>
        <p>${esc(def.desc)}</p>
        ${unlocked ? `<span class="ach-card__date">${esc(fmtDateStamp(unlockedAt))}</span>` : ''}
      </div>
      <span class="ach-card__stamp" aria-hidden="true">${unlocked ? 'DONE' : '—'}</span>
    </article>`;
}

function dailyModChips(plan) {
  if (!plan || !Array.isArray(plan.modifierIds)) return '';
  return plan.modifierIds.map((id) => {
    const mod = DAILY_LOOKUP[id];
    if (!mod) return '';
    return `<span class="daily-mod-mini" style="--mod-accent:${esc(mod.accent)}" data-tip="${esc(mod.desc)}">${icon(DAILY_MOD_ICONS[id] || 'flask', '', 12)}<span>${esc(mod.name)}</span></span>`;
  }).join('');
}

function planForKey(key) {
  if (!key) return null;
  const date = new Date(`${key}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return getDailyPlan(date);
}

function renderRecords(ctx) {
  const state = ctx.state || {};
  const fallback = state.records || ctx.records || (typeof ctx.getRecords === 'function' ? ctx.getRecords() : null) || {};
  const records = {
    runs: num(fallback.runs, 0),
    wins: num(fallback.wins, 0),
    bestNight: num(fallback.bestNight, 0),
    bestGrade: fallback.bestGrade || '',
    byDifficulty: fallback.byDifficulty || {},
    achievements: fallback.achievements || {},
    daily: fallback.daily || {},
  };
  const unlockedIds = Object.keys(records.achievements);
  const winRate = records.runs > 0 ? Math.round((records.wins / records.runs) * 100) : 0;
  const todayPlan = (state.daily && state.daily.key) ? state.daily : getDailyPlan();
  const todayKey = todayPlan && todayPlan.key;
  const dailyKeys = Object.keys(records.daily).sort().reverse();
  const totalAch = ACHIEVEMENTS.length;
  const unlockedCount = ACHIEVEMENTS.filter((def) => records.achievements[def.id]).length;

  const diffCards = DIFF_ORDER.map((id) => {
    const def = DIFFICULTIES[id];
    const bucket = records.byDifficulty[id] || {};
    const runs = num(bucket.runs, 0);
    const wins = num(bucket.wins, 0);
    const rate = runs > 0 ? Math.round((wins / runs) * 100) : 0;
    return `
      <article class="rec-diff" style="--diff-accent:${esc(def.accent)}">
        <header class="rec-diff__head">
          <b>${esc(def.name)}</b>
          <span>${runs} 场 · ${wins} 胜</span>
        </header>
        <span class="bar bar--rec"><i style="--v:${rate}%;--bar-color:${esc(def.accent)}"></i></span>
        <div class="rec-diff__meta">
          <span>胜率 <b>${rate}%</b></span>
          <span>最佳夜钟 <b>${fmtNight(bucket.bestNight || 0)}</b></span>
        </div>
      </article>`;
  }).join('');

  const dailyRows = dailyKeys.slice(0, 6).map((key) => {
    const bucket = records.daily[key] || {};
    const plan = planForKey(key);
    const isToday = key === todayKey;
    return `
      <li class="rec-daily-row${isToday ? ' is-today' : ''}">
        <span class="rec-daily-row__date">${isToday ? '今日 · ' : ''}${esc(key)}</span>
        <span class="rec-daily-row__mods">${dailyModChips(plan)}</span>
        <span class="rec-daily-row__stat">${num(bucket.wins, 0)} 胜 / ${num(bucket.runs, 0)} 场</span>
        <span class="rec-daily-row__best">${fmtNight(bucket.bestNight || 0)}</span>
      </li>`;
  }).join('');

  const todayBucket = todayKey ? records.daily[todayKey] : null;
  const dailySection = `
    <section class="records-section records-section--daily">
      <h3 class="records-section__title">${icon('calendar', '', 15)} 每日守夜</h3>
      <div class="rec-today">
        <div class="rec-today__head">
          <b>${esc(todayPlan ? (todayPlan.label || `每日守夜 · ${todayKey}`) : '每日守夜')}</b>
          <span>${todayBucket ? `${num(todayBucket.wins, 0)} 胜 / ${num(todayBucket.runs, 0)} 场` : '今天还没守夜'}</span>
        </div>
        <div class="rec-today__mods">${dailyModChips(todayPlan)}</div>
        <div class="rec-today__meta">固定普通难度 · 独立记录 · ${records.daily[todayKey] ? `最佳夜钟 ${fmtNight(records.daily[todayKey].bestNight || 0)}` : '完成后记录在此'}</div>
      </div>
      ${dailyRows
        ? `<ul class="rec-daily-list">${dailyRows}</ul>`
        : `<p class="records-empty">${icon('info', '', 13)} 还没有每日挑战记录。每日守夜每天 0 点更新，两个修饰词与本机记录独立保存。</p>`}
    </section>`;

  const body = `
    <div class="records-summary">
      <div class="rec-tile"><span class="rec-tile__k">总场次</span><b class="rec-tile__v">${fmtInt(records.runs)}</b><small>全部难度</small></div>
      <div class="rec-tile"><span class="rec-tile__k">胜场</span><b class="rec-tile__v">${fmtInt(records.wins)}</b><small>胜率 ${winRate}%</small></div>
      <div class="rec-tile"><span class="rec-tile__k">最佳夜钟</span><b class="rec-tile__v mono">${fmtNight(records.bestNight)}</b><small>最长守夜</small></div>
      <div class="rec-tile"><span class="rec-tile__k">最佳评级</span><b class="rec-tile__v">${esc(records.bestGrade || '—')}</b><small>历史最优</small></div>
    </div>
    <div class="records-grid">
      <section class="records-section records-section--diff">
        <h3 class="records-section__title">${icon('shield', '', 15)} 全部难度</h3>
        <div class="rec-diff-list">${diffCards}</div>
      </section>
      ${dailySection}
    </div>
    <section class="records-section records-section--ach">
      <div class="records-section__head">
        <h3 class="records-section__title">${icon('trophy', '', 15)} 成就</h3>
        <span class="records-ach-count"><b>${unlockedCount}</b> / ${totalAch}</span>
      </div>
      <div class="ach-grid">${ACHIEVEMENTS.map((def) => achievementCard(def, records.achievements[def.id])).join('')}</div>
    </section>
    <p class="overlay__note">${icon('info', '', 14)} 值班记录保存在本机浏览器，不上传、不联网；换浏览器或清理站点数据会清空。成就与每日记录在结算时写入。</p>`;
  const foot = `<div class="overlay__foot-inner">
      <span class="overlay__foot-hint">本机存档 · ${esc(todayKey || '')}</span>
      <div class="overlay__foot-right">
        ${btn({ label: '合上记录', iconName: 'notebook', cls: 'btn btn--primary', extra: 'data-overlay-close="合上记录"' })}
      </div>
    </div>`;
  const root = shell({
    kind: 'records', title: '值班记录', dismissible: true, onDismiss: () => ctx.closeOverlay(),
    panelClass: 'panel--paper panel--records', body, foot,
    head: headHtml({ kicker: '本机存档 · 手写记录', title: '值班记录', sub: '每一夜的梦能、舍友与天亮，都留在这里。' }),
  });
  bindClose(root, ctx);
  return root;
}

// ---------- 结算 ----------
function renderResult(ctx) {
  const state = ctx.state || {};
  const result = state.result || {};
  const stats = state.stats || {};
  const victory = (result.outcome || state.phase) === 'victory';
  const dawnVictory = victory && /天亮/.test(result.reason || '');
  const victoryStamp = dawnVictory ? '天亮' : '滴定';
  const grade = result.grade || (victory ? 'A' : '—');
  const title = result.title || (victory ? '天亮了，噩梦退散' : '气密门被推开');
  const room = getRoom(state.roomId);
  const diff = difficultyOf(state.difficulty);
  const isDaily = state.mode === 'daily' || Boolean(state.daily);
  const daily = isDaily ? (state.daily || getDailyPlan()) : null;
  const dailyMods = daily && Array.isArray(daily.modifierIds)
    ? daily.modifierIds.map((id) => DAILY_LOOKUP[id]).filter(Boolean)
    : [];
  const newAchievements = Array.isArray(state.newAchievements) ? state.newAchievements : [];
  const newAchDefs = newAchievements
    .map((id) => ACHIEVEMENT_LOOKUP[id] || { id, name: id, desc: '', icon: 'star' });
  const extraStats = [];
  if (num(stats.roommateSupports, 0) > 0) extraStats.push({ icon: 'radio', label: `无线电支援 ×${num(stats.roommateSupports, 0)}` });
  if (num(stats.relics, 0) > 0) extraStats.push({ icon: 'archive', label: `遗物回收 ×${num(stats.relics, 0)}` });
  const statRows = [
    { k: '击退梦魇', v: `${fmtInt(stats.kills)} 只`, icon: 'skull' },
    { k: '造成伤害', v: fmtInt(stats.damageDealt), icon: 'impact' },
    { k: '建造装置', v: `${fmtInt(stats.builds)} 座`, icon: 'grid' },
    { k: '激活反应', v: `${fmtInt(stats.reactions)} 条`, icon: 'spark' },
    { k: '门体维修', v: `${fmtInt(stats.repairs)} 次`, icon: 'wrench' },
    { k: '累计梦能', v: fmtInt(stats.dreamEarned), icon: 'dream' },
    { k: '累计试剂', v: fmtInt(stats.reagentEarned), icon: 'reagent' },
    { k: '压力等级', v: `Lv.${num(state.pressure && state.pressure.level, 1)}`, icon: 'pressure' },
  ];
  const body = `
    <div class="result-hero">
      <div class="result-stamp ${victory ? 'is-win' : 'is-loss'}" aria-hidden="true">
        <span>${victory ? victoryStamp : '门破'}</span>
      </div>
      <div class="result-title">
        <p class="kicker kicker--sm">${esc(room.number)} 室 · ${esc(diff.name)} · 记录终止</p>
        ${daily ? `<div class="result-daily"><span class="result-daily__stamp">${icon('calendar', '', 12)} 每日</span><b>${esc(daily.label || `每日守夜 · ${daily.key || ''}`)}</b>${dailyMods.map((mod) => `<span class="daily-mod-mini" style="--mod-accent:${esc(mod.accent)}">${icon(DAILY_MOD_ICONS[mod.id] || 'flask', '', 11)}${esc(mod.name)}</span>`).join('')}</div>` : ''}
        <h2>${esc(title)}</h2>
        <p class="result-reason">${esc(result.reason || (victory ? '第一缕晨光落在旧宿舍的窗台上。' : '走廊安静了下来，门板倒向房间内侧。'))}</p>
        ${(result.lines || []).length ? `<ul class="result-lines">${result.lines.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>` : ''}
        ${extraStats.length ? `<div class="result-extra">${extraStats.map((row) => `<span>${icon(row.icon, '', 12)}${esc(row.label)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="result-grade ${victory ? 'is-win' : 'is-loss'}">
        <span class="result-grade__label">评级</span>
        <span class="result-grade__value">${esc(String(grade))}</span>
      </div>
    </div>
    ${newAchDefs.length ? `
    <div class="result-new">
      <span class="result-new__label">${icon('star', '', 14)} 新成就</span>
      <ul class="result-new__list">
        ${newAchDefs.map((def) => `<li><span class="result-new__ico">${icon(def.icon || 'star', '', 14)}</span><b>${esc(def.name)}</b></li>`).join('')}
      </ul>
    </div>` : ''}
    <div class="result-stats">
      ${statRows.map((row) => `<div class="result-stat"><span class="result-stat__k">${icon(row.icon, '', 14)}${esc(row.k)}</span><b class="result-stat__v">${esc(row.v)}</b></div>`).join('')}
    </div>
    <div class="result-actions">
      ${btn({ label: '再来一局', iconName: 'restart', cls: 'btn btn--primary btn--lg', extra: 'data-result="restart"' })}
      ${btn({ label: '查看图鉴', iconName: 'book', extra: 'data-result="codex"' })}
      ${btn({ label: '值班记录', iconName: 'notebook', cls: 'btn btn--quiet', extra: 'data-result="records"' })}
      ${btn({ label: '返回主菜单', iconName: 'home', cls: 'btn btn--quiet', extra: 'data-result="menu"' })}
    </div>
    <p class="result-foot">${icon('info', '', 13)} ${daily ? '每日守夜记录与新成就已写入值班记录。' : '重新开始会沿用同一间宿舍与难度；返回主菜单可重新选择。'}</p>`;
  const root = shell({
    kind: 'result', title: '守夜结算', rootClass: victory ? 'overlay--win' : 'overlay--loss',
    panelClass: 'panel--paper panel--result', body,
    head: '',
  });
  const restart = root.querySelector('[data-result="restart"]');
  if (restart) restart.addEventListener('click', () => ctx.call('restart'));
  const menu = root.querySelector('[data-result="menu"]');
  if (menu) menu.addEventListener('click', () => ctx.call('goMenu'));
  const codex = root.querySelector('[data-result="codex"]');
  if (codex) codex.addEventListener('click', () => ctx.openOverlay('help', 'nightmares'));
  const recordsBtn = root.querySelector('[data-result="records"]');
  if (recordsBtn) recordsBtn.addEventListener('click', () => ctx.openOverlay('records'));
  return root;
}

// ---------- 首次教程 ----------
const TUTORIAL_STEPS = [
  {
    icon: 'target', title: '活到天亮',
    body: '守住这间宿舍：坚持到夜钟 06:00，或清空所有梦魇即胜利；气密门耐久归零则守夜失败。',
    note: '梦魇会挠门、淘汰舍友并逐渐成长，压力等级越高，技能越危险。',
  },
  {
    icon: 'dream', title: '躺平发育',
    body: '冷凝床每秒产出梦能，层析仪产出试剂。开局准备阶段可以自由布防，梦魇苏醒后也不要停止发育。',
    note: '床升级到 4 / 6 / 8 级前，气密门需要先到 2 / 4 / 6 级。',
  },
  {
    icon: 'grid', title: '搭起装置',
    body: '用底部建造卡（1–0）选择装置，再点击房间空格放置。选中已建装置可升级、研究或拆除。',
    note: '房间格子有限；酸系主炮要攒够梦能与试剂才能铺开。',
  },
  {
    icon: 'spark', title: '反应链',
    body: '相邻满足条件的装置会自动构成反应链：催化台配酸系、冷凝器配通风柜、加速器配苯炮台……',
    note: '酸塔升到 III 后可“研究”进入下一阶段，并解锁更高级的新塔。',
  },
  {
    icon: 'door', title: '守门应急',
    body: '按 R 维修气密门，按 Q 应急喷淋；按 Space 暂停，Esc 取消建造或关闭面板。',
    note: '帮助与图鉴在右上角书页按钮；这一页随时能重新翻看。',
  },
];

function renderTutorial(ctx) {
  let step = 0;
  const body = `
    <div class="tutorial">
      <div class="tutorial__art" data-tut-art>${icon('target', '', 44)}</div>
      <div class="tutorial__content">
        <p class="tutorial__step" data-tut-step>第 1 / ${TUTORIAL_STEPS.length} 页</p>
        <h3 class="tutorial__title" data-tut-title></h3>
        <p class="tutorial__body" data-tut-body></p>
        <p class="tutorial__note" data-tut-note></p>
        <div class="tutorial__dots" data-tut-dots aria-hidden="true"></div>
      </div>
    </div>`;
  const foot = `<div class="overlay__foot-inner">
      <div class="overlay__foot-left">
        <button type="button" class="btn btn--quiet btn--sm" data-tut-skip>跳过教程</button>
      </div>
      <div class="overlay__foot-right">
        <button type="button" class="btn btn--quiet btn--sm" data-tut-back>上一页</button>
        <button type="button" class="btn btn--primary" data-tut-next>下一页</button>
      </div>
    </div>`;
  const root = shell({
    kind: 'tutorial', title: '首次教程', panelClass: 'panel--paper panel--tutorial', body, foot,
    head: headHtml({ kicker: '值班须知 · 第一夜', title: '熄灯之后，先别慌', sub: '五页记录，读完就能守到天亮。', close: false }),
  });
  const art = root.querySelector('[data-tut-art]');
  const stepEl = root.querySelector('[data-tut-step]');
  const titleEl = root.querySelector('[data-tut-title]');
  const bodyEl = root.querySelector('[data-tut-body]');
  const noteEl = root.querySelector('[data-tut-note]');
  const dots = root.querySelector('[data-tut-dots]');
  const backBtn = root.querySelector('[data-tut-back]');
  const nextBtn = root.querySelector('[data-tut-next]');
  const skipBtn = root.querySelector('[data-tut-skip]');

  function paint() {
    const current = TUTORIAL_STEPS[step];
    if (art) art.innerHTML = icon(current.icon, '', 44);
    if (stepEl) stepEl.textContent = `第 ${step + 1} / ${TUTORIAL_STEPS.length} 页`;
    if (titleEl) titleEl.textContent = current.title;
    if (bodyEl) bodyEl.textContent = current.body;
    if (noteEl) noteEl.textContent = current.note;
    if (dots) {
      dots.innerHTML = TUTORIAL_STEPS.map((_, i) => `<i class="${i === step ? 'is-on' : ''}"></i>`).join('');
    }
    if (backBtn) backBtn.hidden = step === 0;
    if (nextBtn) {
      const label = nextBtn.querySelector('.btn__label') || nextBtn;
      label.textContent = step === TUTORIAL_STEPS.length - 1 ? '开始布防' : '下一页';
    }
  }
  backBtn.addEventListener('click', () => { if (step > 0) { step -= 1; paint(); } });
  nextBtn.addEventListener('click', () => {
    if (step < TUTORIAL_STEPS.length - 1) { step += 1; paint(); }
    else ctx.closeOverlay();
  });
  skipBtn.addEventListener('click', () => ctx.closeOverlay());
  paint();
  return root;
}

// ---------- 导出 ----------
export function renderOverlay(spec, ctx) {
  const name = spec && spec.name;
  if (name === 'difficulty') return renderDifficulty(ctx);
  if (name === 'pause') return renderPause(ctx);
  if (name === 'help') return renderHelp(ctx);
  if (name === 'settings') return renderSettings(ctx);
  if (name === 'about') return renderAbout(ctx);
  if (name === 'records') return renderRecords(ctx);
  if (name === 'result') return renderResult(ctx);
  if (name === 'tutorial') return renderTutorial(ctx);
  return null;
}

export { HELP_TABS };
void CONFIG;
void buildCatalogPanel;
