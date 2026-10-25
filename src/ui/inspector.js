// 建筑检查面板：选中建筑后的属性 / 升级 / 研究 / 拆除。
// 悬浮于建造栏上方，高度受控，不遮住房间中心。

import { getUpgradeCost } from '../content/index.js';
import { icon } from './icons.js';
import {
  esc, fmtNum, num, buildingName, buildingLevelLabel, buildingIconName, buildingAccent,
  buildingStatParts, upgradeSummary, refundEstimate, disabledReasonForResource, pips, roman,
} from './kit.js';

export function createInspector({ onUpgrade, onEvolve, onSell, onDeselect, notify }) {
  const el = document.createElement('div');
  el.className = 'inspector';
  el.hidden = true;
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', '建筑检查面板');
  let currentKey = '';
  let state = null;
  let refs = {};
  let building = null;

  function paintButtons() {
    if (!building) return;
    const player = (state && state.player) || {};
    const now = num(state && state.now, 0);
    const disabled = num(building.disabledUntil, 0) > now;
    const cost = getUpgradeCost(building);
    const isMax = !cost;
    const isEvolve = Boolean(cost && cost.kind === 'evolve');

    if (refs.upBtn) {
      refs.upBtn.hidden = isEvolve;
      if (!isEvolve) {
        let reason = '';
        if (isMax) reason = '已达最高等级';
        else if (disabled) reason = '装置被干扰，暂时无法升级';
        else reason = disabledReasonForResource(state, cost);
        refs.upBtn.classList.toggle('is-disabled', Boolean(reason));
        refs.upBtn.setAttribute('aria-disabled', reason ? 'true' : 'false');
        const tip = reason || `升级到 ${cost ? roman(cost.nextLevel) : ''}：${cost ? `梦能 ${cost.dream}${cost.reagent ? ` · 试剂 ${cost.reagent}` : ''}` : '已满级'}`;
        refs.upBtn.setAttribute('data-tip', tip);
        refs.upBtn.setAttribute('title', tip);
        if (reason) {
          refs.upBtn.setAttribute('data-reason', reason);
        } else {
          refs.upBtn.removeAttribute('data-reason');
        }
        const label = refs.upBtn.querySelector('[data-label]');
        if (label) label.textContent = isMax ? '已满级' : `升级 ${cost && cost.nextLevel ? roman(cost.nextLevel) : ''}`;
        const costEl = refs.upBtn.querySelector('[data-cost]');
        if (costEl) costEl.innerHTML = isMax ? '' : costChip(cost);
      }
    }

    if (refs.evoBtn) {
      refs.evoBtn.hidden = !isEvolve;
      if (isEvolve) {
        const reason = disabledReasonForResource(state, cost);
        refs.evoBtn.classList.toggle('is-disabled', Boolean(reason));
        refs.evoBtn.setAttribute('aria-disabled', reason ? 'true' : 'false');
        const tip = reason || `研究进入 ${cost.nextName}（阶段 ${building.stage + 1}）`;
        refs.evoBtn.setAttribute('data-tip', tip);
        refs.evoBtn.setAttribute('title', tip);
        if (reason) refs.evoBtn.setAttribute('data-reason', reason);
        else refs.evoBtn.removeAttribute('data-reason');
        const costEl = refs.evoBtn.querySelector('[data-cost]');
        if (costEl) costEl.innerHTML = costChip(cost);
      }
    }

    if (refs.sellBtn) {
      const refund = refundEstimate(building);
      const tip = `拆除返还约 ${refund} 梦能（50%）`;
      refs.sellBtn.setAttribute('data-tip', tip);
      refs.sellBtn.setAttribute('title', tip);
      const label = refs.sellBtn.querySelector('[data-label]');
      if (label && !label.textContent.includes('拆除')) label.textContent = '拆除';
    }
    void player;
    void isMax;
  }

  function costChip(cost) {
    const parts = [];
    if (cost.dream) parts.push(`<span class="cost cost--dream">${icon('dream', 'cost__ico', 12)}${cost.dream}</span>`);
    if (cost.reagent) parts.push(`<span class="cost cost--reagent">${icon('reagent', 'cost__ico', 12)}${cost.reagent}</span>`);
    return parts.join('');
  }

  function rebuild() {
    const b = building;
    el.hidden = false;
    const stats = buildingStatParts(b);
    const next = upgradeSummary(b);
    const maxLevel = b.type === 'acid' ? 3 : 0;
    const isEvolved = b.type === 'acid' && b.level >= 3 && b.stage < 6;
    el.style.setProperty('--insp-accent', buildingAccent(b));
    const now = num(state && state.now, 0);
    const disrupted = num(b.disabledUntil, 0) > now;
    const statusChips = [
      disrupted ? `<span class="mini-chip mini-chip--warn" data-tip="被梦魇技能干扰">${icon('alert', '', 12)} 干扰 ${(num(b.disabledUntil) - now).toFixed(1)}s</span>` : '',
      b.isStarter ? '<span class="mini-chip" data-tip="房间自带装置">起始</span>' : '',
      b.overheat ? '<span class="mini-chip mini-chip--warn" data-tip="连续射击过热">过热</span>' : '',
    ].join('');
    el.innerHTML = `
      <span class="inspector__accent" aria-hidden="true"></span>
      <div class="inspector__main">
        <div class="inspector__titleline">
          <span class="inspector__icon">${icon(buildingIconName(b), '', 20)}</span>
          <b class="inspector__name">${esc(buildingName(b))}</b>
          <span class="inspector__level">${esc(buildingLevelLabel(b))}</span>
          ${b.type === 'acid' ? pips(b.level, 3, 'pips--sm') : ''}
          ${statusChips}
        </div>
        <div class="inspector__stats">${stats.map((part) => `<span>${esc(part)}</span>`).join('')}</div>
        <div class="inspector__next">
          ${next.detail ? `${icon('upgrade', '', 12)}<span>${esc(next.detail)}</span>` : ''}
          ${isEvolved ? `<span class="inspector__hint">${icon('spark', '', 12)}研究后本塔进入下一阶段 I 级</span>` : ''}
        </div>
      </div>
      <div class="inspector__actions">
        <button type="button" class="btn btn--primary btn--sm" data-insp="upgrade">
          ${icon('upgrade', 'btn__ico', 14)}<span class="btn__label" data-label></span><span class="btn__cost" data-cost></span>
        </button>
        <button type="button" class="btn btn--study btn--sm" data-insp="evolve" hidden>
          ${icon('spark', 'btn__ico', 14)}<span class="btn__label" data-label>研究下一阶段</span><span class="btn__cost" data-cost></span>
        </button>
        <button type="button" class="btn btn--coral btn--sm" data-insp="sell">
          ${icon('trash', 'btn__ico', 14)}<span class="btn__label">拆除</span>
        </button>
        <button type="button" class="iconbtn iconbtn--xs inspector__close" data-insp="deselect" aria-label="关闭检查面板" data-tip="关闭（Esc）">
          ${icon('close', '', 14)}
        </button>
      </div>`;
    refs = {
      upBtn: el.querySelector('[data-insp="upgrade"]'),
      evoBtn: el.querySelector('[data-insp="evolve"]'),
      sellBtn: el.querySelector('[data-insp="sell"]'),
      closeBtn: el.querySelector('[data-insp="deselect"]'),
    };
    if (refs.upBtn) refs.upBtn.classList.toggle('inspector__hidden-upgrade', isEvolved);
    paintButtons();
    void maxLevel;
  }

  el.addEventListener('click', (event) => {
    const upgrade = event.target.closest('[data-insp="upgrade"]');
    if (upgrade) {
      if (upgrade.getAttribute('aria-disabled') === 'true') {
        if (typeof notify === 'function') notify(upgrade.getAttribute('data-reason') || '当前无法升级', 'warn');
        return;
      }
      if (typeof onUpgrade === 'function') onUpgrade();
      return;
    }
    const evolve = event.target.closest('[data-insp="evolve"]');
    if (evolve) {
      if (evolve.getAttribute('aria-disabled') === 'true') {
        if (typeof notify === 'function') notify(evolve.getAttribute('data-reason') || '当前无法研究', 'warn');
        return;
      }
      if (typeof onEvolve === 'function') onEvolve();
      return;
    }
    const sell = event.target.closest('[data-insp="sell"]');
    if (sell) {
      if (typeof onSell === 'function') onSell();
      return;
    }
    if (event.target.closest('[data-insp="deselect"]')) {
      if (typeof onDeselect === 'function') onDeselect();
    }
  });

  function update(nextState) {
    state = nextState || state;
    const list = (state && state.buildings) || [];
    const id = state && state.ui && state.ui.selectedBuildingId;
    building = id ? list.find((b) => b && b.id === id) || null : null;
    if (!building) {
      el.hidden = true;
      currentKey = '';
      return;
    }
    const key = `${building.id}|${building.type}|${building.level}|${building.stage}`;
    if (key !== currentKey) {
      currentKey = key;
      rebuild();
    }
    paintButtons();
  }

  return { el, update, getBuilding: () => building };
}
