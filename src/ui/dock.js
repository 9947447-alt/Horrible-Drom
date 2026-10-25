// 底部建造栏：分类 / 酸系阶段选择 / 热键 / 费用与不可用原因。
// 只读 state，点击通过 onBuild 回调交给控制器动作。

import {
  CONFIG, getBuildDef, getAcidStage, getAcidBuildCost, getSpecialDef, getDeviceDef,
  getSpecialUpgradeCost, getDeviceUpgradeCost, getAcidUpgradeCost, roman, formatCost,
} from '../content/index.js';
import { icon } from './icons.js';
import {
  esc, fmtInt, fmtNum, costHtml, costText, disabledReasonForResource, damageTypeMeta, buildingIconName,
} from './kit.js';

const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const CATALOG = [
  { type: 'acid', category: 'tower', name: '酸系主炮', short: '酸系', icon: 'acid', accent: '#b8e37a', meta: '六阶段 · I–III' },
  { type: 'chlorate', category: 'tower', name: '氯酸钾炮台', short: '氯酸钾', icon: 'burst', accent: '#ffe27a', meta: 'Lv I–X' },
  { type: 'benzene', category: 'tower', name: '苯炮台', short: '苯', icon: 'ring', accent: '#ff9ab5', meta: 'Lv I–X' },
  { type: 'analyzer', category: 'device', name: '层析仪', short: '层析仪', icon: 'layers', accent: '#63e0c2', meta: 'I–III 级' },
  { type: 'condenser', category: 'device', name: '冷凝器', short: '冷凝器', icon: 'snow', accent: '#8fd8ff', meta: 'I–III 级' },
  { type: 'vent', category: 'device', name: '通风柜', short: '通风柜', icon: 'wind', accent: '#9ee7d8', meta: 'I–III 级' },
  { type: 'catalyst', category: 'device', name: '催化台', short: '催化台', icon: 'spark', accent: '#ffb45e', meta: 'I–III 级' },
  { type: 'neutralizer', category: 'device', name: '中和池', short: '中和池', icon: 'pool', accent: '#c7e8a8', meta: 'I–III 级' },
  { type: 'accelerator', category: 'device', name: '加速器', short: '加速器', icon: 'bolt', accent: '#ffe27a', meta: 'I–III 级 · 限 2' },
  { type: 'atm', category: 'device', name: '梦能取款机', short: '取款机', icon: 'cash', accent: '#c7a8ff', meta: 'I–III 级 · 限 2' },
];

CATALOG.forEach((item, index) => { item.hotkey = HOTKEYS[index]; });

function countBuildings(state, type) {
  const list = (state && state.buildings) || [];
  return list.filter((b) => b && b.type === type).length;
}

function cardBuildInfo(item, state) {
  if (item.type === 'acid') {
    const unlocked = Math.max(1, Math.min(6, Number(state && state.acidUnlocked) || 1));
    const stage = getAcidStage(unlocked);
    const cost = getAcidBuildCost(unlocked);
    return {
      name: '酸系主炮',
      meta: `I→${roman(unlocked)} · 可研究`,
      cost,
      accent: stage.accent,
      icon: stage.icon || 'acid',
      typeMeta: damageTypeMeta(stage.damageType).name,
      tip: `${stage.name}起建可选。点击选择已解锁阶段；新塔从该阶段 I 级开始，III 级后可研究下一阶段。`,
    };
  }
  const def = getBuildDef(item.type);
  const cost = def && def.buildCost ? { ...def.buildCost } : null;
  let meta = item.meta;
  let next = '';
  if (item.type === 'chlorate' || item.type === 'benzene') {
    const special = getSpecialDef(item.type);
    meta = `I→II · 满${roman(special.maxLevel)}`;
    const up = getSpecialUpgradeCost(item.type, 1);
    if (up) next = `下级 ${roman(2)}：${costText(up)}`;
  } else {
    const dev = getDeviceDef(item.type);
    meta = `I→II${dev.maxCount ? ` · 限${dev.maxCount}` : ''}`;
    const up = getDeviceUpgradeCost(item.type, 1);
    if (up) next = `下级 ${roman(2)}：${costText(up)}`;
  }
  const baseTip = def ? def.desc : item.name;
  return {
    name: item.name,
    meta,
    cost,
    accent: item.accent,
    icon: item.icon,
    typeMeta: def ? damageTypeMeta(def.damageType || '').name : '',
    tip: next ? `${baseTip}｜建造价 ${costText(cost)}；${next}` : baseTip,
  };
}

function unavailableReason(item, state) {
  if (item.type === 'acid') {
    const unlocked = Math.max(1, Math.min(6, Number(state && state.acidUnlocked) || 1));
    const cheapest = getAcidBuildCost(1);
    const diff = disabledReasonForResource(state, cheapest);
    if (diff) return `最低阶段也造不起：${diff}`;
    return '';
  }
  const def = getBuildDef(item.type);
  if (!def) return '未知装置';
  const count = countBuildings(state, item.type);
  if (def.maxCount && count >= def.maxCount) return `已达数量上限（${count}/${def.maxCount}）`;
  return disabledReasonForResource(state, def.buildCost);
}

function buildCardHtml(item, state, hotkeyEnabled) {
  const info = cardBuildInfo(item, state);
  const reason = unavailableReason(item, state);
  const tip = reason ? `${reason}｜${info.tip}` : info.tip;
  return `
    <button type="button" class="build-card${reason ? ' is-poor' : ''}${hotkeyEnabled ? '' : ' no-hotkey'}"
      data-dock-build="${esc(item.type)}" data-tip="${esc(tip)}" title="${esc(tip)}"
      style="--card-accent:${esc(info.accent)}" aria-label="${esc(info.name)}，${esc(info.meta)}">
      <span class="build-card__top">
        <span class="build-card__icon">${icon(info.icon, '', 20)}</span>
        <span class="build-card__key">${hotkeyEnabled ? esc(item.hotkey) : '·'}</span>
      </span>
      <span class="build-card__name">${esc(item.name)}</span>
      <span class="build-card__meta">${esc(info.meta)}</span>
      <span class="build-card__cost">${info.cost ? costHtml(info.cost) : '<span class="cost cost--free">—</span>'}</span>
    </button>`;
}

function stageRowHtml(stage, unlocked, state) {
  const stageDef = getAcidStage(stage);
  const cost = getAcidBuildCost(stage);
  const isLocked = stage > unlocked;
  const reason = isLocked ? `未解锁 · 酸系研究到阶段 ${stage - 1} III 后可解锁` : disabledReasonForResource(state, cost);
  const tip = reason ? `${stageDef.name}：${reason}` : `${stageDef.name}：${stageDef.desc}`;
  return `
    <button type="button" class="stage-row${isLocked ? ' is-locked' : ''}${reason ? ' is-poor' : ''}"
      data-dock-acid="${stage}" data-tip="${esc(tip)}" title="${esc(tip)}"
      style="--stage-accent:${esc(stageDef.accent)}" aria-label="${esc(stageDef.name)} 阶段 ${stage}">
      <span class="stage-row__badge">${isLocked ? icon('lock', '', 13) : roman(stage)}</span>
      <span class="stage-row__main">
        <b>${esc(stageDef.name)}</b>
        <small>${esc(stageDef.mechanic)} · ${esc(stageDef.desc)}</small>
      </span>
      <span class="stage-row__side">
        <span class="stage-row__dmg">${icon(stageDef.icon || 'acid', '', 13)}${esc(damageTypeMeta(stageDef.damageType).name)} ${fmtNum(stageDef.baseDamage, 1)}</span>
        ${isLocked ? '<span class="stage-row__lock">阶段未解锁</span>' : costHtml(cost)}
      </span>
    </button>`;
}

export function createDock({ onBuild, onCancel, notify, getState }) {
  const el = document.createElement('footer');
  el.className = 'dock';
  el.setAttribute('aria-label', '建造栏');
  el.innerHTML = `
    <div class="dock__tabs" role="tablist" aria-label="建造分类">
      <button type="button" class="dock-tab is-active" data-dock-tab="tower" role="tab" aria-selected="true">
        <span class="dock-tab__ico">${icon('burst', '', 15)}</span>
        <span class="dock-tab__label">炮台</span>
        <span class="dock-tab__count">3</span>
      </button>
      <button type="button" class="dock-tab" data-dock-tab="device" role="tab" aria-selected="false">
        <span class="dock-tab__ico">${icon('flask', '', 15)}</span>
        <span class="dock-tab__label">设备</span>
        <span class="dock-tab__count">7</span>
      </button>
      <div class="dock__mode" hidden data-dock-mode>
        <span class="dock__mode-dot" aria-hidden="true"></span>
        <span data-dock-mode-label>建造中</span>
      </div>
    </div>
    <div class="dock__cards" data-dock-cards></div>
    <div class="dock-pop paper" data-dock-pop hidden role="dialog" aria-label="选择酸系阶段"></div>
    <div class="dock__flavor" data-dock-flavor hidden>
      <span class="dock__flavor-kicker">实验台 · 记录</span>
      <p data-dock-flavor-text>相邻装置会自动构成反应链。酸塔升到 III 级后可研究下一阶段。</p>
      <span class="dock__flavor-meta" data-dock-flavor-meta>右键 / Esc 取消建造</span>
    </div>`;

  const cardsEl = el.querySelector('[data-dock-cards]');
  const tabs = Array.from(el.querySelectorAll('[data-dock-tab]'));
  const cancelBtns = Array.from(el.querySelectorAll('[data-dock-cancel]'));
  const modeEl = el.querySelector('[data-dock-mode]');
  const modeLabel = el.querySelector('[data-dock-mode-label]');
  const popEl = el.querySelector('[data-dock-pop]');
  const flavorEl = el.querySelector('[data-dock-flavor]');
  const flavorText = el.querySelector('[data-dock-flavor-text]');
  const flavorMeta = el.querySelector('[data-dock-flavor-meta]');

  let category = 'tower';
  let state = null;
  let acidOpen = false;
  let builtForUnlock = -1;
  let builtCategory = '';
  let outsideHandler = null;
  const cardRefs = new Map();

  function currentState() {
    const s = typeof getState === 'function' ? getState() : state;
    return s || state;
  }

  function makeCard(item, hotkeyEnabled) {
    const wrap = document.createElement('div');
    wrap.innerHTML = buildCardHtml(item, currentState(), hotkeyEnabled).trim();
    return wrap.firstElementChild;
  }

  function renderCards(force = false) {
    const s = currentState();
    const unlocked = Math.max(1, Number(s && s.acidUnlocked) || 1);
    if (!force && category === builtCategory && unlocked === builtForUnlock) return;
    builtCategory = category;
    builtForUnlock = unlocked;
    cardsEl.innerHTML = '';
    cardRefs.clear();
    CATALOG.filter((item) => item.category === category).forEach((item) => {
      const card = makeCard(item, true);
      cardsEl.appendChild(card);
      cardRefs.set(item.type, card);
    });
    if (flavorEl) flavorEl.hidden = false;
    refreshCards();
  }

  function refreshCards() {
    const s = currentState();
    CATALOG.forEach((item) => {
      const card = cardRefs.get(item.type);
      if (!card) return;
      const reason = unavailableReason(item, s);
      card.classList.toggle('is-poor', Boolean(reason));
      const tip = reason ? reason : cardBuildInfo(item, s).tip;
      card.setAttribute('data-tip', tip);
      card.setAttribute('title', tip);
      card.classList.toggle('is-arming', Boolean(s && s.ui && s.ui.buildMode && s.ui.buildMode.type === item.type));
      const costEl = card.querySelector('.build-card__cost');
      if (costEl) {
        const info = cardBuildInfo(item, s);
        const next = info.cost ? costHtml(info.cost) : '';
        if (costEl.innerHTML !== next) costEl.innerHTML = next;
      }
    });
    tabs.forEach((tab) => {
      const on = tab.getAttribute('data-dock-tab') === category;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (flavorEl) {
      const isTower = category === 'tower';
      flavorEl.hidden = !isTower;
      if (isTower) {
        const unlocked = Math.max(1, Math.min(6, Number(s && s.acidUnlocked) || 1));
        const count = ((s && s.buildings) || []).length;
        const reactions = ((s && s.reactions) || []).length;
        if (flavorText) flavorText.textContent = `酸系已解锁 I–${roman(unlocked)} · 已建 ${count} 座装置 · 反应链 ${reactions}/6`;
        if (flavorMeta) flavorMeta.textContent = '1–0 选择 · 右键 / Esc 取消';
      }
    }
  }

  function setCategory(next) {
    if (next !== 'tower' && next !== 'device') return;
    if (next === category) return;
    category = next;
    if (acidOpen) closePopover();
    renderCards(true);
  }

  function popoverPosition() {
    if (!acidOpen) return;
    const card = cardRefs.get('acid');
    if (!card || !popEl.parentElement) return;
    const dockRect = el.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const left = Math.max(8, Math.min(cardRect.left - dockRect.left, el.clientWidth - popEl.offsetWidth - 8));
    popEl.style.left = `${left}px`;
  }

  function renderPopover() {
    const s = currentState();
    const unlocked = Math.max(1, Math.min(6, Number(s && s.acidUnlocked) || 1));
    popEl.innerHTML = `
      <div class="dock-pop__head">
        <span class="dock-pop__title">${icon('acid', '', 15)}酸系主炮 · 选择起始阶段</span>
        <span class="dock-pop__unlock">已解锁 I–${roman(unlocked)}</span>
        <button type="button" class="dock-pop__close iconbtn iconbtn--xs" data-dock-pop-close aria-label="关闭阶段选择">${icon('close', '', 14)}</button>
      </div>
      <div class="dock-pop__list">
        ${[1, 2, 3, 4, 5, 6].map((stage) => stageRowHtml(stage, unlocked, s)).join('')}
      </div>
      <div class="dock-pop__foot">
        <span>点卡片默认进入建造；选其它阶段会切换。建塔后从 I 升到 III，再研究下一阶段。</span>
        <span class="dock-pop__tip">${icon('info', '', 13)} 未解锁阶段需先研究</span>
      </div>`;
    popEl.hidden = false;
    acidOpen = true;
    popoverPosition();
    if (!outsideHandler) {
      outsideHandler = (event) => {
        if (!el.contains(event.target)) closePopover();
      };
      document.addEventListener('pointerdown', outsideHandler, true);
    }
    el.classList.add('dock--pop-open');
  }

  function closePopover() {
    if (!acidOpen) return;
    acidOpen = false;
    popEl.hidden = true;
    popEl.innerHTML = '';
    el.classList.remove('dock--pop-open');
    if (outsideHandler) {
      document.removeEventListener('pointerdown', outsideHandler, true);
      outsideHandler = null;
    }
    const acidCard = cardRefs.get('acid');
    if (acidCard && typeof acidCard.focus === 'function') acidCard.focus();
  }

  function openPopover() {
    renderPopover();
  }

  function activate(item) {
    if (!item) return;
    if (item.type === 'acid') {
      if (acidOpen) { closePopover(); return; }
      openPopover();
      // 直接点“酸系主炮”就进入可放置状态：默认选已解锁且当前买得起的最高阶段。
      // 阶段弹层只是“可选修改”，不是必须先点一下才能建造。否则用户点完卡片再点地板时，
      // 外部 pointerdown 只会关闭弹层，看起来像“酸炮放不下去”。
      const s = currentState();
      const unlocked = Math.max(1, Math.min(6, Number(s && s.acidUnlocked) || 1));
      let stage = unlocked;
      while (stage > 1 && disabledReasonForResource(s, getAcidBuildCost(stage))) stage -= 1;
      if (!disabledReasonForResource(s, getAcidBuildCost(stage)) && typeof onBuild === 'function') {
        onBuild('acid', { stage });
      }
      return;
    }
    closePopover();
    if (typeof onBuild === 'function') onBuild(item.type, {});
  }

  function handleAction(kind, value, btnNode) {
    const s = currentState();
    if (kind === 'tab') { setCategory(value); return; }
    if (kind === 'build') {
      const item = CATALOG.find((entry) => entry.type === value);
      if (!item) return;
      if (item.category !== category) setCategory(item.category);
      activate(item);
      return;
    }
    if (kind === 'acid-stage') {
      const stage = Number(value);
      const unlocked = Math.max(1, Math.min(6, Number(s && s.acidUnlocked) || 1));
      if (stage > unlocked) {
        if (typeof notify === 'function') notify(`阶段 ${stage} 尚未解锁：先研究到阶段 ${stage - 1} 的 III 级`, 'warn');
        return;
      }
      const cost = getAcidBuildCost(stage);
      const reason = disabledReasonForResource(s, cost);
      if (reason) {
        if (typeof notify === 'function') notify(`${getAcidStage(stage).name}：${reason}`, 'warn');
        return;
      }
      closePopover();
      if (typeof onBuild === 'function') onBuild('acid', { stage });
      return;
    }
    if (kind === 'cancel') {
      closePopover();
      if (typeof onCancel === 'function') onCancel();
      return;
    }
    if (kind === 'pop-close') { closePopover(); return; }
    void btnNode;
  }

  el.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-dock-tab]');
    if (tab) { handleAction('tab', tab.getAttribute('data-dock-tab'), tab); return; }
    const build = event.target.closest('[data-dock-build]');
    if (build) { handleAction('build', build.getAttribute('data-dock-build'), build); return; }
    const stage = event.target.closest('[data-dock-acid]');
    if (stage) { handleAction('acid-stage', stage.getAttribute('data-dock-acid'), stage); return; }
    if (event.target.closest('[data-dock-pop-close]')) { handleAction('pop-close'); return; }
    if (event.target.closest('[data-dock-cancel]')) { handleAction('cancel'); }
  });

  function update(nextState) {
    state = nextState || state;
    if (category === 'tower') renderCards(false);
    else renderCards(false);
    refreshCards();
    const buildMode = state && state.ui && state.ui.buildMode;
    const active = Boolean(buildMode);
    cancelBtns.forEach((btnNode) => { btnNode.hidden = !active; });
    modeEl.hidden = !active;
    if (active) {
      const type = buildMode.type;
      let label = '建造中';
      if (type === 'acid') label = `建造 · ${getAcidStage(buildMode.stage || 1).short}`;
      else {
        const item = CATALOG.find((entry) => entry.type === type);
        label = `建造 · ${item ? item.short : type}`;
      }
      modeLabel.textContent = label;
    }
    if (acidOpen) {
      const unlocked = Math.max(1, Number(state && state.acidUnlocked) || 1);
      renderPopover();
      void unlocked;
    }
  }

  function handleHotkey(key) {
    if (!HOTKEYS.includes(key)) return false;
    if (acidOpen) { closePopover(); return true; }
    const item = CATALOG.find((entry) => entry.hotkey === key);
    if (!item) return false;
    if (item.category !== category) setCategory(item.category);
    activate(item);
    return true;
  }

  function handleEscape() {
    if (acidOpen) { closePopover(); return true; }
    return false;
  }

  renderCards(true);

  return {
    el,
    update,
    handleHotkey,
    handleEscape,
    closePopover,
    isPopoverOpen: () => acidOpen,
    destroy() {
      if (outsideHandler) document.removeEventListener('pointerdown', outsideHandler, true);
      outsideHandler = null;
    },
  };
}
