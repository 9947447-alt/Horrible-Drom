// 对局 HUD：顶部夜钟/梦魇、左侧舍友与事件、右侧设施与反应链、底部建造栏与检查面板。
// 所有数值来自 state，更新节流由 index.js 控制；这里只做 10Hz 级别的文本/宽度刷新。

import {
  CONFIG, getBedUpgradeCost, getDoorUpgradeCost, REACTIONS, ROOMMATE_NAMES,
  ROOMMATE_TRAITS, DAILY_LOOKUP, getDailyPlan,
  getAcidStage, getBuildDef, getNightmare,
} from '../content/index.js';
import { icon } from './icons.js';
import {
  esc, fmtInt, fmtNum, fmtRate, fmtDuration, fmtSpan, fmtClock, fmtPct, clamp, num, difficultyOf,
  phaseLabel, costHtml, keycap, bedIncome, reagentIncome,
  doorRepairCost, showerCooldownLeft, dawnRemaining, bedUpgradeGate,
  disabledReasonForResource, eventIcon, damageTypeMeta,
} from './kit.js';
import { createDock } from './dock.js';
import { createInspector } from './inspector.js';

const ACTIVE_STATUS = [
  { key: 'burnUntil', label: '灼烧', icon: 'flame', tone: 'warm' },
  { key: 'slowUntil', label: '减速', icon: 'snow', tone: 'cold' },
  { key: 'stunUntil', label: '眩晕', icon: 'bolt', tone: 'light' },
  { key: 'repairLockUntil', label: '锁修', icon: 'lock', tone: 'warn' },
];

const SKILL_LEVELS = [3, 6, 9, 12, 14];

function doorLocked(state) {
  const now = num(state && state.now, 0);
  const list = (state && state.activeNightmares) || [];
  return list.some((nm) => nm && nm.statuses && num(nm.statuses.repairLockUntil, 0) > now);
}

function buildFacilities() {
  return `
  <section class="panel panel--fac" aria-label="设施与床门">
    <div class="panel__head">
      <span class="panel__title">${icon('bed', '', 15)} 床与门</span>
      <span class="panel__meta" data-ref="facMeta">—</span>
    </div>

    <div class="fac fac--bed" data-ref="bedCard">
      <div class="fac__row">
        <span class="fac__icon">${icon('bed', '', 18)}</span>
        <span class="fac__name">冷凝床 <small>Lv.<b data-ref="bedLevel">1</b></small></span>
        <span class="fac__rate" data-ref="bedRate">+2.0/s</span>
      </div>
      <div class="fac__note" data-ref="bedNote">下一级 +3.4/s</div>
      <button type="button" class="btn btn--primary btn--sm fac__btn" data-act="hud.bedUpgrade" data-ref="bedBtn">
        ${icon('upgrade', 'btn__ico', 14)}<span class="btn__label">升级冷凝床</span>
        <span class="btn__cost" data-ref="bedCost"></span>
      </button>
    </div>

    <div class="fac fac--door" data-ref="doorCard">
      <div class="fac__row">
        <span class="fac__icon">${icon('door', '', 18)}</span>
        <span class="fac__name">气密门 <small>Lv.<b data-ref="doorLevel">1</b></small></span>
        <span class="fac__hpNum" data-ref="doorHpText">180 / 180</span>
      </div>
      <span class="bar bar--hp fac__bar" data-ref="doorBar" role="progressbar" aria-label="气密门耐久" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><i class="bar__fill" style="--v:100%"></i></span>
      <div class="fac__actions">
        <button type="button" class="btn btn--ghost btn--xs" data-act="hud.doorUpgrade" data-ref="doorUpBtn">
          ${icon('upgrade', 'btn__ico', 13)}<span class="btn__label">升级</span><span class="btn__cost" data-ref="doorUpCost"></span>
        </button>
        <button type="button" class="btn btn--study btn--xs" data-act="hud.repair" data-ref="repairBtn">
          ${icon('wrench', 'btn__ico', 13)}<span class="btn__label">维修</span><span class="btn__cost" data-ref="repairCost"></span>
        </button>
        <button type="button" class="btn btn--cold btn--xs" data-act="hud.shower" data-ref="showerBtn">
          ${icon('shower', 'btn__ico', 13)}<span class="btn__label">喷淋</span><span class="btn__cd" data-ref="showerCd"></span>
        </button>
      </div>
      <div class="fac__note" data-ref="doorNote"></div>
    </div>
  </section>`;
}

function buildHudSkeleton() {
  return `
    <div class="hud-vignette" aria-hidden="true"></div>

    <header class="hud-top" aria-label="对局状态">
      <div class="hud-clock">
        <div class="hud-clock__row">
          <span class="hud-clock__ico" data-ref="phaseIcon">${icon('moon', '', 18)}</span>
          <span class="hud-clock__tag">夜钟</span>
          <span class="hud-clock__time" data-ref="clock">00:00</span>
          <span class="hud-phase" data-ref="phaseChip">准备阶段</span>
        </div>
        <div class="hud-clock__sub">
          <span data-ref="dawnLabel">天亮 06:00</span>
          <span class="hud-dot">·</span>
          <span class="hud-diff" data-ref="diffLabel">普通</span>
        </div>
        <div class="hud-daily-row" data-ref="dailyRow" hidden>
          <span class="hud-daily-stamp">${icon('calendar', '', 12)} 每日</span>
          <span class="hud-daily-mods" data-ref="dailyMods"></span>
        </div>
      </div>

      <div class="hud-nightmares" data-ref="nightmareWrap" aria-live="off"></div>

      <div class="hud-res">
        <div class="res res--dream" data-ref="dreamChip" data-tip="梦能：冷凝床产出，用于建造与升级">
          <span class="res__ico">${icon('dream', '', 16)}</span>
          <span class="res__val" data-ref="dream">0</span>
          <span class="res__rate" data-ref="dreamRate">+0/s</span>
        </div>
        <div class="res res--reagent" data-ref="reagentChip" data-tip="试剂：层析仪产出，用于高阶装置与反应研究">
          <span class="res__ico">${icon('reagent', '', 16)}</span>
          <span class="res__val" data-ref="reagent">0</span>
          <span class="res__rate" data-ref="reagentRate">+0/s</span>
        </div>
        <div class="res res--pressure" data-ref="pressureChip" data-tip="压力等级：梦魇的成长刻度，等级越高技能越强">
          <span class="res__ico">${icon('pressure', '', 16)}</span>
          <span class="res__val">Lv.<b data-ref="pressureLevel">1</b></span>
          <span class="res__bar"><i data-ref="pressureFill"></i></span>
        </div>
        <div class="hud-btns">
          <button type="button" class="iconbtn" data-act="hud.codex" aria-label="帮助与图鉴" data-tip="帮助 / 图鉴">${icon('book', '', 18)}</button>
          <button type="button" class="iconbtn" data-act="hud.settings" aria-label="设置" data-tip="设置">${icon('sliders', '', 18)}</button>
          <button type="button" class="iconbtn" data-act="hud.pause" aria-label="暂停" data-tip="暂停（Space）" data-ref="pauseBtn">${icon('pause', '', 18)}</button>
        </div>
        <div class="hud-drawers">
          <button type="button" class="iconbtn iconbtn--sm hud-drawer-btn" data-act="hud.toggleLeft" data-ref="leftDrawerBtn" aria-label="显示舍友与事件" data-tip="舍友 / 事件">${icon('users', '', 16)}</button>
          <button type="button" class="iconbtn iconbtn--sm" data-act="hud.toggleRight" aria-label="显示设施与反应" data-tip="设施 / 反应">${icon('flask', '', 16)}</button>
        </div>
      </div>
    </header>

    <div class="hud-prep" data-ref="prepRibbon" hidden>
      <span class="hud-prep__label" data-ref="prepLabel">布防中 · 00:25</span>
      <span class="hud-prep__bar"><i data-ref="prepBar"></i></span>
      <span class="hud-prep__hint" data-ref="prepHint">首魇将在 00:35 苏醒</span>
      <span class="hud-prep__hint hud-prep__hint--keys">${keycap('1–0')} 建造</span>
    </div>

    <aside class="hud-left" aria-label="舍友与走廊事件">
      <section class="panel panel--mates">
        <div class="panel__head">
          <span class="panel__title">${icon('users', '', 15)} 舍友灯态</span>
          <span class="panel__meta" data-ref="mateCount">—</span>
        </div>
        <ul class="mate-list" data-ref="mateList"></ul>
        <div class="radio-slot" data-ref="radioSlot" hidden></div>
        <div class="panel__foot" data-ref="matesFoot"><span>熄灯后互相照应</span><span class="panel__foot-mark">NIGHT</span></div>
      </section>
      <section class="panel panel--events">
        <div class="panel__head">
          <span class="panel__title">${icon('activity', '', 15)} 走廊动静</span>
          <span class="panel__meta" data-ref="eventCount">0</span>
        </div>
        <ul class="event-list" data-ref="eventList"></ul>
        <div class="panel__foot"><span data-ref="eventFoot">对讲机 · 记录最近 14 条</span><span class="panel__foot-mark">LIVE</span></div>
      </section>
    </aside>

    <aside class="hud-right" aria-label="设施与反应链">
      ${buildFacilities()}
      <section class="panel panel--reactions">
        <div class="panel__head">
          <span class="panel__title">${icon('spark', '', 15)} 反应链</span>
          <span class="panel__meta" data-ref="reactionCount">0 / 6</span>
        </div>
        <ul class="reaction-list" data-ref="reactionList"></ul>
        <div class="panel__foot"><span>上下左右相邻 · 自动生效</span><span class="panel__foot-mark">AUTO</span></div>
      </section>
    </aside>

    <div class="hud-banner" data-ref="banner" hidden>
      <span class="hud-banner__ico" data-ref="bannerIcon">${icon('grid', '', 16)}</span>
      <span class="hud-banner__text" data-ref="bannerText"></span>
      <span class="hud-banner__hint">点击房间空格放置 · 右键 / Esc 取消</span>
      <button type="button" class="btn btn--coral btn--xs" data-act="hud.cancelBuild">${icon('close', 'btn__ico', 13)}<span class="btn__label">取消</span></button>
    </div>

    <div class="hud-inspector-slot" data-ref="inspectorSlot"></div>
    <div class="hud-dock-slot" data-ref="dockSlot"></div>
    <div class="hud-drawer-scrim" data-act="hud.closeDrawers" aria-hidden="true"></div>

    <div class="hud-mobile-hint" data-ref="mobileHint">
      <span>${icon('expand', '', 14)} 小屏模式：侧栏可点右上角图标展开</span>
      <button type="button" class="iconbtn iconbtn--xs" data-act="hud.closeMobileHint" aria-label="关闭提示">${icon('close', '', 13)}</button>
    </div>`;
}

const REACTION_NAMES = {
  acid: '酸系炮台',
  catalyst: '催化台',
  condenser: '冷凝器',
  vent: '通风柜',
  accelerator: '加速器',
  chlorate: '氯酸钾炮台',
  benzene: '苯炮台',
  neutralizer: '中和池',
  door: '气密门',
};

function reactionRequires(reaction) {
  return (reaction.requires || []).map((key) => REACTION_NAMES[key] || key).join(' + ');
}

export function createHud({ call, notify, openOverlay, togglePause }) {
  const el = document.createElement('div');
  el.className = 'hud';
  el.innerHTML = buildHudSkeleton();
  const refs = {};
  el.querySelectorAll('[data-ref]').forEach((node) => { refs[node.dataset.ref] = node; });

  let state = null;
  let lastMateKey = '';
  let lastEventKey = '';
  let lastReactionKey = '';
  let lastNightmareKey = '';
  let nightmareRefs = [];
  let mateRefs = [];
  let radioRefs = null;
  let radioKey = '';
  let lastDailyPlanKey = '';
  let lastPhase = '';
  let lastBuildModeKey = '';
  let mobileHintDismissed = false;

  const dock = createDock({
    getState: () => state,
    notify,
    onBuild: (type, options) => {
      if (typeof call === 'function') call('startBuild', [type, options]);
    },
    onCancel: () => {
      if (typeof call === 'function') call('cancelBuild');
    },
  });
  const inspector = createInspector({
    notify,
    onUpgrade: () => call('upgradeSelected'),
    onEvolve: () => call('evolveSelected'),
    onSell: () => call('sellSelected'),
    onDeselect: () => call('selectBuilding', [null]),
  });
  if (refs.dockSlot) refs.dockSlot.appendChild(dock.el);
  if (refs.inspectorSlot) refs.inspectorSlot.appendChild(inspector.el);

  // ---------- 操作绑定 ----------
  el.addEventListener('click', (event) => {
    const node = event.target.closest('[data-act]');
    if (!node) return;
    const act = node.getAttribute('data-act');
    if (!act || !act.startsWith('hud.')) return;
    if (node.getAttribute('aria-disabled') === 'true') {
      if (typeof notify === 'function') notify(node.getAttribute('data-reason') || '当前无法执行', 'warn');
      return;
    }
    switch (act) {
      case 'hud.pause': if (typeof togglePause === 'function') togglePause(); break;
      case 'hud.codex': if (typeof openOverlay === 'function') openOverlay('help', 'nightmares'); break;
      case 'hud.settings': if (typeof openOverlay === 'function') openOverlay('settings'); break;
      case 'hud.supportRequest': call('answerRoommateRequest', [true]); break;
      case 'hud.ignoreRequest': call('answerRoommateRequest', [false]); break;
      case 'hud.collectRelic': call('collectRoommateRelic', [node.getAttribute('data-id')]); break;
      case 'hud.bedUpgrade': call('upgradeBed'); break;
      case 'hud.doorUpgrade': call('upgradeDoor'); break;
      case 'hud.repair': call('repairDoor'); break;
      case 'hud.shower': call('useShower'); break;
      case 'hud.cancelBuild': call('cancelBuild'); break;
      case 'hud.deselect': call('selectBuilding', [null]); break;
      case 'hud.toggleLeft': {
        const opened = el.classList.toggle('hud--left-open');
        if (opened) {
          if (refs.leftDrawerBtn) refs.leftDrawerBtn.classList.remove('has-alert');
          if (refs.radioSlot && !refs.radioSlot.hidden) {
            requestAnimationFrame(() => {
              try { refs.radioSlot.scrollIntoView({ block: 'center' }); } catch (err) { /* noop */ }
            });
          }
        }
        break;
      }
      case 'hud.toggleRight': el.classList.toggle('hud--right-open'); break;
      case 'hud.closeDrawers':
        el.classList.remove('hud--left-open', 'hud--right-open');
        break;
      case 'hud.closeMobileHint': {
        mobileHintDismissed = true;
        if (refs.mobileHint) refs.mobileHint.hidden = true;
        break;
      }
      default: break;
    }
  });

  // ---------- 顶部 ----------
  function paintTop(s) {
    const clockValue = Number.isFinite(Number(s.clock))
      ? Number(s.clock)
      : (num(s.nightElapsed, 0) / Math.max(1, num(s.dawnAt, 480))) * 360;
    if (refs.clock) refs.clock.textContent = fmtClock(clockValue);
    if (refs.phaseChip) {
      refs.phaseChip.textContent = phaseLabel(s);
      refs.phaseChip.dataset.phase = s.phase || 'night';
    }
    if (refs.phaseIcon) {
      const name = s.phase === 'prep' ? 'lamp' : (s.phase === 'victory' ? 'sun' : 'moon');
      refs.phaseIcon.innerHTML = icon(name, '', 18);
    }
    const diff = difficultyOf(s.difficulty);
    if (refs.diffLabel) refs.diffLabel.textContent = `${diff.name}${diff.secondary ? ' · 双魇' : ''}`;
    if (refs.dawnLabel) {
      if (s.phase === 'prep') {
        const spawnIn = Math.max(0, num(s.spawnAt, CONFIG.spawnDelay) - num(s.nightElapsed, 0));
        refs.dawnLabel.textContent = `天亮 06:00 · 首魇 ${fmtSpan(spawnIn)}后苏醒`;
      } else if (s.phase === 'victory') {
        refs.dawnLabel.textContent = /天亮/.test(s.result?.reason || '')
          ? '夜魇散尽 · 天亮了'
          : '全部梦魇已被滴定 · 夜色将退';
      } else if (s.phase === 'defeat') {
        refs.dawnLabel.textContent = '气密门已破';
      } else {
        refs.dawnLabel.textContent = `天亮还剩 ${fmtSpan(dawnRemaining(s))}`;
      }
    }
    const player = s.player || {};
    if (refs.dream) setText(refs.dream, fmtInt(player.dream));
    if (refs.reagent) setText(refs.reagent, fmtInt(player.reagent));
    if (refs.dreamRate) setText(refs.dreamRate, `${fmtRate(bedIncome(s))}/s`);
    if (refs.reagentRate) setText(refs.reagentRate, `${fmtRate(reagentIncome(s))}/s`);
    const pressure = s.pressure || {};
    if (refs.pressureLevel) setText(refs.pressureLevel, String(num(pressure.level, 1)));
    if (refs.pressureFill) {
      const next = num(pressure.nextLevelXp, 220);
      const pct = clamp(next > 0 ? num(pressure.xp, 0) / next : 0);
      refs.pressureFill.style.width = `${(pct * 100).toFixed(1)}%`;
    }
    if (refs.pauseBtn) {
      const paused = Boolean(s.paused);
      if (refs.pauseBtn.dataset.paused !== String(paused)) {
        refs.pauseBtn.dataset.paused = String(paused);
        refs.pauseBtn.innerHTML = icon(paused ? 'play' : 'pause', '', 18);
        refs.pauseBtn.setAttribute('aria-label', paused ? '继续' : '暂停');
        refs.pauseBtn.setAttribute('data-tip', paused ? '继续（Space）' : '暂停（Space）');
      }
    }
  }

  function setText(node, value) {
    if (!node) return;
    if (node.textContent !== value) node.textContent = value;
  }

  // ---------- 夜魇 ----------
  function nightmareKey(s) {
    const list = (s.activeNightmares || []).filter(Boolean);
    return list.map((nm) => `${nm.id}:${nm.type}:${nm.level}:${Boolean(nm.secondary)}`).join('|') + `#${num(s.pressure && s.pressure.level, 1)}`;
  }

  function buildNightmareCard(nm) {
    const def = getNightmare(nm.type);
    const accent = def.accent || '#b49bff';
    const skills = (def.skills || []).map((sk) => {
      const lit = num(nm.level, 1) >= sk.level;
      return `<span class="skill-node${lit ? ' is-lit' : ''}" style="--sk:${accent}" data-tip="Lv.${sk.level} ${esc(sk.name)} · ${esc(sk.desc)}">${sk.level}</span>`;
    }).join('');
    const weaknesses = (def.weaknesses || []).map((type) => {
      const meta = damageTypeMeta(type);
      return `<span class="dtag dtag--icon dtag--weak" style="--dtag:${meta.color}" data-tip="弱点 · ${esc(meta.name)} 伤害 ×1.5">${icon(meta.icon, '', 12)}</span>`;
    }).join('');
    const resists = (def.resistances || []).map((type) => {
      const meta = damageTypeMeta(type);
      return `<span class="dtag dtag--icon dtag--resist" style="--dtag:${meta.color}" data-tip="抗性 · ${esc(meta.name)} 伤害 ×0.5">${icon(meta.icon, '', 12)}</span>`;
    }).join('');
    const weakNames = (def.weaknesses || []).map((type) => damageTypeMeta(type).name).join('、');
    const resistNames = (def.resistances || []).map((type) => damageTypeMeta(type).name).join('、');
    const weakScreenReaderText = `弱点：${weakNames}${resistNames ? `；抗性：${resistNames}` : ''}`;
    const card = document.createElement('div');
    card.className = `nm${nm.secondary ? ' nm--secondary' : ''}`;
    card.style.setProperty('--nm-accent', accent);
    card.innerHTML = `
      <div class="nm__head">
        <span class="nm__icon">${icon('skull', '', 17)}</span>
        <span class="nm__name">${esc(def.name)}<small>${esc(def.title)}</small></span>
        ${nm.secondary ? '<span class="nm__tag">增援</span>' : ''}
        <span class="nm__lv">Lv.<b>${num(nm.level, 1)}</b></span>
        <span class="nm__status"></span>
      </div>
      <div class="nm__hprow">
        <span class="bar bar--nm"><i class="bar__fill"></i></span>
        <span class="nm__hpText">—</span>
      </div>
      <div class="nm__meta">
        <span class="nm__weak" aria-label="${esc(weakScreenReaderText)}">${weaknesses}${resists}<span class="sr-only">${esc(weakScreenReaderText)}</span></span>
        <span class="nm__status"></span>
        <span class="nm__skills" data-tip="技能节点 Lv.3 / 6 / 9 / 12 / 14">${skills}</span>
        <span class="nm__mechanic">${esc(def.mechanic)}</span>
      </div>`;
    return {
      el: card,
      fill: card.querySelector('.bar__fill'),
      bar: card.querySelector('.bar'),
      hpText: card.querySelector('.nm__hpText'),
      status: card.querySelector('.nm__status'),
      lv: card.querySelector('.nm__lv b'),
    };
  }

  function buildNightmareEmpty(s) {
    const spawnIn = Math.max(0, num(s.spawnAt, CONFIG.spawnDelay) - num(s.nightElapsed, 0));
    const wrap = document.createElement('div');
    wrap.className = 'nm nm--empty';
    wrap.innerHTML = `
      <span class="nm__emptyIcon">${icon('ghost', '', 22)}</span>
      <span class="nm__emptyText">
        <b>走廊深处还很安静</b>
        <small>${s.phase === 'prep' ? `首魇预计 ${fmtSpan(spawnIn)}后苏醒 · 趁现在布防` : '梦魇暂时退去，切莫松懈'}</small>
      </span>
      <span class="nm__emptyBadge">${icon('clock', '', 13)} 夜钟 ${fmtClock(s.clock || 0)}</span>`;
    return wrap;
  }

  function paintNightmares(s) {
    const key = nightmareKey(s);
    if (key !== lastNightmareKey) {
      lastNightmareKey = key;
      const wrap = refs.nightmareWrap;
      if (!wrap) return;
      wrap.innerHTML = '';
      nightmareRefs = [];
      const list = (s.activeNightmares || []).filter((nm) => nm && nm.state !== 'dead' && num(nm.hp, 1) > 0);
      wrap.dataset.count = String(list.length);
      if (!list.length) {
        wrap.appendChild(buildNightmareEmpty(s));
      } else {
        list.forEach((nm) => {
          const cardRefs = buildNightmareCard(nm);
          wrap.appendChild(cardRefs.el);
          nightmareRefs.push(cardRefs);
        });
      }
    }
    // 数值刷新
    const list = (s.activeNightmares || []).filter((nm) => nm && nm.state !== 'dead');
    nightmareRefs.forEach((cardRefs, index) => {
      const nm = list[index];
      if (!nm) return;
      const max = Math.max(1, num(nm.maxHp, 1));
      const pct = clamp(num(nm.hp, 0) / max);
      if (cardRefs.fill) cardRefs.fill.style.width = `${(pct * 100).toFixed(2)}%`;
      if (cardRefs.bar) cardRefs.bar.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
      if (cardRefs.hpText) setText(cardRefs.hpText, `${fmtInt(Math.max(0, num(nm.hp)))}/${fmtInt(max)}`);
      if (cardRefs.lv) setText(cardRefs.lv, String(num(nm.level, 1)));
      if (cardRefs.status) {
        const statuses = nm.statuses || {};
        const now = num(s.now, 0);
        const active = ACTIVE_STATUS.filter((st) => num(statuses[st.key], 0) > now);
        const extra = [];
        if (num(nm.revealUntil, 0) > now) extra.push({ label: '显形', icon: 'eye', tone: 'light' });
        if (num(nm.disabledUntil, 0) > now && !active.some((a) => a.key === 'stunUntil')) {
          extra.push({ label: '受制', icon: 'bolt', tone: 'light' });
        }
        const all = active.concat(extra);
        cardRefs.status.innerHTML = all.map((st) => `<span class="status status--${st.tone}" data-tip="状态 · ${esc(st.label)}">${icon(st.icon, '', 12)}</span>`).join('');
      }
    });
  }

  // ---------- 舍友 / 无线电求援 / 遗物 ----------
  const RADIO_WINDOW = 18;
  const TRAIT_DEFS = ROOMMATE_TRAITS || {};

  function bondPips(bond) {
    const n = Math.max(0, Math.min(3, Number(bond) || 0));
    let out = '<span class="mate__bond" data-tip="亲密度 ' + n + '/3">';
    for (let i = 1; i <= 3; i += 1) out += `<i class="bond-pip${i <= n ? ' is-on' : ''}"></i>`;
    out += '</span>';
    return out;
  }

  function relicCost(mate) {
    const relic = mate && mate.relic;
    if (!relic) return 0;
    return Number(relic.cost && relic.cost.reagent) || 0;
  }

  function paintDailyPlan(s) {
    const row = refs.dailyRow;
    if (!row) return;
    let plan = s && (s.mode === 'daily' || s.daily) ? s.daily : null;
    if (!plan && s && s.mode === 'daily') {
      try { plan = getDailyPlan(); } catch (err) { plan = null; }
    }
    if (!plan || !Array.isArray(plan.modifierIds)) {
      row.hidden = true;
      if (lastDailyPlanKey) { lastDailyPlanKey = ''; if (refs.dailyMods) refs.dailyMods.innerHTML = ''; }
      return;
    }
    row.hidden = false;
    const key = `${plan.key || ''}|${plan.modifierIds.join(',')}`;
    if (key === lastDailyPlanKey) return;
    lastDailyPlanKey = key;
    if (!refs.dailyMods) return;
    refs.dailyMods.innerHTML = plan.modifierIds.map((id) => {
      const mod = DAILY_LOOKUP[id];
      if (!mod) return '';
      return `<span class="hud-daily-mod" style="--mod-accent:${esc(mod.accent)}" data-tip="${esc(mod.name)} · ${esc(mod.desc)}">${esc(mod.name)}</span>`;
    }).join('');
  }

  function buildRadioCard(owner, request) {
    const slot = refs.radioSlot;
    if (!slot) return null;
    const trait = TRAIT_DEFS[owner.trait];
    const ownerName = owner.name || '舍友';
    slot.innerHTML = `
      <div class="radio-card" style="--radio-accent:${esc(owner.color || '#ffc75a')}">
        <div class="radio-card__head">
          <span class="radio-card__ico">${icon('radio', '', 15)}</span>
          <span class="radio-card__title">
            <b>${esc(ownerName)} · 求援</b>
            <small>${esc(request.title || (trait && trait.request.title) || '无线电求援')}</small>
          </span>
          <span class="radio-card__time"><i data-ref="radioTimerFill"></i></span>
          <b class="radio-card__secs" data-ref="radioSecs">—</b>
        </div>
        <p class="radio-card__text" data-tip="${esc(request.text || '')}">${esc(request.text || '')}</p>
        <div class="radio-card__meta">
          <span class="radio-card__cost">${costHtml(request.cost || {})}</span>
          <span class="radio-card__reward">${icon('spark', '', 12)} ${esc(request.rewardLabel || '谢礼')}</span>
        </div>
        <div class="radio-card__actions">
          <button type="button" class="btn btn--primary btn--xs radio-card__support" data-act="hud.supportRequest">${icon('bond', 'btn__ico', 13)}<span class="btn__label">支援</span></button>
          <button type="button" class="btn btn--quiet btn--xs radio-card__ignore" data-act="hud.ignoreRequest">忽略</button>
        </div>
      </div>`;
    radioRefs = {
      card: slot.querySelector('.radio-card'),
      support: slot.querySelector('.radio-card__support'),
      secs: slot.querySelector('[data-ref="radioSecs"]'),
      fill: slot.querySelector('[data-ref="radioTimerFill"]'),
      text: slot.querySelector('.radio-card__text'),
    };
    return radioRefs;
  }

  function paintRadio(s) {
    const slot = refs.radioSlot;
    if (!slot) return;
    const list = (s.roommates || []).filter(Boolean);
    const owner = list.find((mate) => mate.request && mate.alive !== false);
    const request = owner && owner.request;
    if (!request) {
      if (!slot.hidden) slot.hidden = true;
      if (radioRefs) { slot.innerHTML = ''; radioRefs = null; radioKey = ''; }
      if (refs.matesFoot) refs.matesFoot.hidden = false;
      if (refs.leftDrawerBtn) refs.leftDrawerBtn.classList.remove('has-alert');
      return;
    }
    const now = num(s.now, 0);
    const remain = Math.max(0, Math.ceil(num(request.expiresAt, 0) - now));
    if (remain <= 0) {
      if (!slot.hidden) slot.hidden = true;
      if (refs.matesFoot) refs.matesFoot.hidden = false;
      if (refs.leftDrawerBtn) refs.leftDrawerBtn.classList.remove('has-alert');
      return;
    }
    const key = `${owner.id || owner.roomId}|${request.id || request.title}`;
    if (!radioRefs || key !== radioKey) {
      radioKey = key;
      buildRadioCard(owner, request);
    }
    slot.hidden = false;
    if (refs.matesFoot) refs.matesFoot.hidden = true;
    if (refs.leftDrawerBtn) {
      refs.leftDrawerBtn.classList.add('has-alert');
      refs.leftDrawerBtn.setAttribute('data-tip', '舍友 / 事件 · 有求援');
    }
    if (!radioRefs) return;
    if (radioRefs.secs) setText(radioRefs.secs, `${remain}s`);
    if (radioRefs.fill) radioRefs.fill.style.width = `${clamp(remain / RADIO_WINDOW) * 100}%`;
    if (radioRefs.card) {
      radioRefs.card.classList.toggle('is-urgent', remain <= 5);
      radioRefs.card.style.setProperty('--radio-accent', owner.color || '#ffc75a');
    }
    const reason = disabledReasonForResource(s, request.cost || {});
    if (radioRefs.support) {
      radioRefs.support.setAttribute('data-clean-tip', '接受求援：扣除资源，提升亲密度并获得回报');
      setDisabled(radioRefs.support, reason);
    }
  }

  function paintRoommates(s) {
    const list = (s.roommates || []).filter(Boolean);
    const requestOwnerId = (list.find((mate) => mate.request) || {}).id || '';
    const key = list.length
      ? list.map((r) => [
        r.id || r.roomId, r.alive ? 1 : 0, r.trait || '', r.bond == null ? '' : r.bond,
        r.request ? (r.request.id || r.request.title) : '', r.relic ? (r.relic.id || r.relic.label) : '',
      ].join(':')).join('|')
      : 'empty';
    if (key !== lastMateKey) {
      lastMateKey = key;
      const ul = refs.mateList;
      if (!ul) return;
      ul.innerHTML = '';
      mateRefs = [];
      if (!list.length) {
        ROOMMATE_NAMES.forEach((meta) => {
          const li = document.createElement('li');
          li.className = 'mate mate--ghost';
          li.style.setProperty('--mate-color', meta.color);
          li.innerHTML = `
            <span class="mate__lamp" aria-hidden="true"></span>
            <span class="mate__body"><span class="mate__line"><b>${esc(meta.name)}</b><small>${esc(meta.note)}</small></span><span class="mate__hint">等待对讲机接通…</span></span>`;
          ul.appendChild(li);
        });
        if (refs.mateCount) refs.mateCount.textContent = '待同步';
      } else {
        list.forEach((mate) => {
          const li = document.createElement('li');
          li.className = 'mate';
          li.style.setProperty('--mate-color', mate.color || '#ffc75a');
          const alive = Boolean(mate.alive);
          const trait = TRAIT_DEFS[mate.trait];
          const traitName = trait ? trait.name : (mate.note || '');
          const relic = mate.relic;
          const relicLine = (!alive && relic) ? `
            <span class="mate__relic" style="--relic-color:${esc(relic.color || '#63e0c2')}">
              <span class="mate__relic-name" data-tip="${esc(relic.label || '遗物')} · 回收获得随机奖励">${icon('archive', '', 12)}${esc(relic.label || '遗物')}</span>
              <button type="button" class="btn btn--ghost btn--xs mate__relic-btn" data-act="hud.collectRelic" data-id="${esc(mate.id || '')}" data-clean-tip="回收遗物">
                ${icon('archive', 'btn__ico', 12)}<span class="btn__label">回收</span><span class="cost cost--reagent" data-ref="relicCost">${icon('reagent', 'cost__ico', 12)}${relicCost(mate)}</span>
              </button>
            </span>` : '';
          li.innerHTML = `
            <span class="mate__lamp" aria-hidden="true"></span>
            <span class="mate__body">
              <span class="mate__line">
                <b>${esc(mate.name || '舍友')}</b>
                ${traitName ? `<span class="mate__trait" data-tip="${esc(trait ? trait.desc : '舍友性格')}">${esc(traitName)}</span>` : ''}
                ${bondPips(mate.bond)}
                <span class="mate__state"></span>
              </span>
              ${alive ? '<span class="mate__door"><i></i></span>' : ''}
              ${relicLine}
            </span>`;
          li._bar = li.querySelector('.mate__door i');
          li._state = li.querySelector('.mate__state');
          li._lamp = li.querySelector('.mate__lamp');
          li._relicBtn = li.querySelector('.mate__relic-btn');
          ul.appendChild(li);
          mateRefs.push({ el: li, mate });
        });
      }
    }
    const targets = new Set(((s.activeNightmares || []).filter(Boolean)).map((nm) => nm.targetRoomId));
    mateRefs.forEach(({ el: row }, index) => {
      const fresh = list[index];
      const alive = fresh ? Boolean(fresh.alive) : false;
      const isCaller = Boolean(fresh && requestOwnerId && (fresh.id === requestOwnerId));
      row.classList.toggle('is-dead', !alive);
      row.classList.toggle('is-target', alive && targets.has(fresh && fresh.roomId));
      row.classList.toggle('is-caller', isCaller);
      const max = Math.max(1, num(fresh && fresh.maxDoorHp, 1));
      const hp = clamp(num(fresh && fresh.doorHp, 0) / max);
      if (row._bar) row._bar.style.width = `${(hp * 100).toFixed(1)}%`;
      if (row._state) {
        let label = alive ? `门 ${Math.round(hp * 100)}%` : '已淘汰';
        if (alive && targets.has(fresh && fresh.roomId)) label = '被追击';
        if (isCaller) label = '求援中';
        setText(row._state, label);
      }
      if (row._lamp) row._lamp.classList.toggle('is-lit', alive);
      if (row._relicBtn) {
        const cost = { reagent: relicCost(fresh) };
        const reason = disabledReasonForResource(s, cost);
        row._relicBtn.setAttribute('data-clean-tip', '回收遗物：获得随机奖励');
        setDisabled(row._relicBtn, reason);
      }
    });
    if (list.length && refs.mateCount) {
      const aliveCount = list.filter((r) => r.alive).length;
      setText(refs.mateCount, `${aliveCount}/${list.length} 亮灯`);
    }
  }

  // ---------- 事件流 ----------
  function paintEvents(s) {
    const events = (s.events || []).filter(Boolean);
    const key = events.map((evt) => evt.id).join('|');
    if (key === lastEventKey) return;
    lastEventKey = key;
    const ul = refs.eventList;
    if (!ul) return;
    ul.innerHTML = '';
    if (!events.length) {
      const li = document.createElement('li');
      li.className = 'event event--empty';
      li.innerHTML = `<span class="event__text">还没有值得记录的事。熄灯后，走廊会先发出声音。</span>`;
      ul.appendChild(li);
    } else {
      events.slice(-12).reverse().forEach((evtToRender) => {
        const li = document.createElement('li');
        li.className = `event event--${esc(evtToRender.kind || 'info')}`;
        li.dataset.eventId = evtToRender.id;
        const at = Number.isFinite(Number(evtToRender.at)) ? Number(evtToRender.at) : 0;
        li.innerHTML = `
          <span class="event__time">${fmtDuration(at)}</span>
          <span class="event__ico">${icon(eventIcon(evtToRender.kind), '', 13)}</span>
          <span class="event__text">${esc(evtToRender.text || '')}</span>`;
        ul.appendChild(li);
      });
    }
    if (refs.eventCount) refs.eventCount.textContent = String(events.length);
  }

  // ---------- 设施 ----------
  function setDisabled(node, reason) {
    if (!node) return;
    const on = Boolean(reason);
    node.classList.toggle('is-disabled', on);
    node.setAttribute('aria-disabled', on ? 'true' : 'false');
    if (on) {
      node.setAttribute('data-reason', reason);
      node.setAttribute('data-tip', reason);
      node.setAttribute('title', reason);
    } else {
      node.removeAttribute('data-reason');
      const tip = node.getAttribute('data-clean-tip') || '';
      if (tip) node.setAttribute('data-tip', tip);
      else node.removeAttribute('data-tip');
      node.removeAttribute('title');
    }
  }

  function paintFacilities(s) {
    const player = s.player || {};
    const level = Math.max(1, Math.min(CONFIG.bed.maxLevel, num(player.bedLevel, 1)));
    if (refs.bedLevel) setText(refs.bedLevel, String(level));
    if (refs.bedRate) setText(refs.bedRate, `${fmtRate(bedIncome(s))}/s`);
    const bedCost = getBedUpgradeCost(level);
    if (refs.bedCost) refs.bedCost.innerHTML = bedCost ? costHtml(bedCost) : '';
    if (refs.bedNote) {
      if (level >= CONFIG.bed.maxLevel) {
        setText(refs.bedNote, '已达最高等级');
      } else {
        const nextLevel = level + 1;
        const gate = bedUpgradeGate(s);
        const nextIncome = (CONFIG.bed.income[nextLevel] || 0) * difficultyOf(s.difficulty).economyMult;
        setText(refs.bedNote, `下一级 +${fmtNum(nextIncome, 1)}/s${gate ? ` · 需门 Lv.${gate.doorLevel}` : ''}`);
      }
    }
    if (refs.bedBtn) {
      let reason = '';
      if (level >= CONFIG.bed.maxLevel) reason = '冷凝床已达最高等级';
      else {
        const gate = bedUpgradeGate(s);
        if (gate && num(player.doorLevel, 1) < gate.doorLevel) {
          reason = `冷凝床升级到 Lv.${gate.bedLevel} 需要气密门先到 Lv.${gate.doorLevel}`;
        } else {
          reason = disabledReasonForResource(s, bedCost);
        }
      }
      refs.bedBtn.setAttribute('data-clean-tip', '升级冷凝床：提高每秒梦能产出');
      setDisabled(refs.bedBtn, reason);
    }

    const doorLevel = Math.max(1, Math.min(CONFIG.door.maxLevel, num(player.doorLevel, 1)));
    if (refs.doorLevel) setText(refs.doorLevel, String(doorLevel));
    const hp = Math.max(0, num(player.doorHp, 0));
    const maxHp = Math.max(1, num(player.doorMaxHp, 1));
    if (refs.doorHpText) setText(refs.doorHpText, `${fmtInt(hp)} / ${fmtInt(maxHp)}`);
    if (refs.doorBar) {
      const pct = clamp(hp / maxHp);
      const fill = refs.doorBar.querySelector('.bar__fill');
      if (fill) fill.style.width = `${(pct * 100).toFixed(2)}%`;
      refs.doorBar.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
      refs.doorBar.classList.toggle('is-low', pct <= 0.3);
    }
    const locked = doorLocked(s);
    const now = num(s.now, 0);

    const doorUpCost = getDoorUpgradeCost(doorLevel);
    if (refs.doorUpCost) refs.doorUpCost.innerHTML = doorUpCost ? costHtml(doorUpCost) : '';
    if (refs.doorUpBtn) {
      refs.doorUpBtn.setAttribute('data-clean-tip', '升级气密门：提高耐久上限');
      let reason = '';
      if (!doorUpCost) reason = '气密门已达最高等级';
      else if (locked) reason = '臭气锁修中：暂时无法升级或维修门';
      else reason = disabledReasonForResource(s, doorUpCost);
      setDisabled(refs.doorUpBtn, reason);
    }

    const repairCost = doorRepairCost(s);
    if (refs.repairCost) refs.repairCost.innerHTML = hp < maxHp ? costHtml({ dream: repairCost }) : '';
    if (refs.repairBtn) {
      refs.repairBtn.setAttribute('data-clean-tip', `维修气密门：按缺失耐久计费，至少 ${CONFIG.repair.minCost} 梦能`);
      let reason = '';
      if (hp >= maxHp) reason = '气密门耐久完好，无需维修';
      else if (locked) reason = '臭气锁修中：暂时无法维修';
      else reason = disabledReasonForResource(s, { dream: repairCost });
      setDisabled(refs.repairBtn, reason);
    }

    const cd = showerCooldownLeft(s);
    if (refs.showerCd) setText(refs.showerCd, cd > 0 ? `${Math.ceil(cd)}s` : '就绪');
    if (refs.showerBtn) {
      refs.showerBtn.setAttribute('data-clean-tip', `应急喷淋：修复 ${fmtPct(CONFIG.shower.healPct)} 门体耐久并短暂净化`);
      let reason = '';
      if (cd > 0) reason = `应急喷淋冷却中：还需 ${Math.ceil(cd)} 秒`;
      else if (hp >= maxHp) reason = '气密门耐久完好，无需喷淋';
      setDisabled(refs.showerBtn, reason);
    }
    if (refs.doorNote) {
      let note = `维修 ${repairCost} 梦能 · 喷淋 ${cd > 0 ? `${Math.ceil(cd)}s` : '就绪'}`;
      if (locked) note = '臭气弥漫：门体操作被锁定';
      setText(refs.doorNote, note);
    }
    if (refs.facMeta) {
      setText(refs.facMeta, `梦 ${fmtRate(bedIncome(s))}/s · 剂 ${fmtRate(reagentIncome(s))}/s`);
    }
    void now;
  }

  // ---------- 反应链 ----------
  function paintReactions(s) {
    const active = (s.reactions || []).filter(Boolean);
    const activeIds = active.map((r) => r.id || r.name);
    const key = activeIds.join('|');
    if (key === lastReactionKey) return;
    lastReactionKey = key;
    const ul = refs.reactionList;
    if (!ul) return;
    const activeSet = new Set(activeIds);
    ul.innerHTML = REACTIONS.map((reaction) => {
      const on = activeSet.has(reaction.id) || activeSet.has(reaction.name);
      return `
        <li class="reaction${on ? ' is-active' : ''}" style="--reaction-accent:${esc(reaction.accent || '#ffc75a')}" data-tip="${esc(reaction.desc)}">
          <span class="reaction__ico">${icon(reaction.icon || 'spark', '', 14)}</span>
          <span class="reaction__main">
            <b>${esc(reaction.name)}</b>
            <small>${esc(reactionRequires(reaction))}</small>
          </span>
          <span class="reaction__state">${on ? icon('check', '', 12) + '激活' : '未构成'}</span>
        </li>`;
    }).join('');
    if (refs.reactionCount) setText(refs.reactionCount, `${activeIds.length} / ${REACTIONS.length}`);
  }

  // ---------- 建造提示 / 准备条 ----------
  function paintBanner(s) {
    const buildMode = s.ui && s.ui.buildMode;
    const key = buildMode ? `${buildMode.type}:${buildMode.stage || ''}` : '';
    if (key !== lastBuildModeKey) {
      lastBuildModeKey = key;
      if (refs.banner) {
        if (!buildMode) {
          refs.banner.hidden = true;
        } else {
          refs.banner.hidden = false;
          let name = '装置';
          let iconName = 'grid';
          let accent = '#ffc75a';
          if (buildMode.type === 'acid') {
            const stage = getAcidStage(buildMode.stage || 1);
            name = stage.name;
            iconName = stage.icon || 'acid';
            accent = stage.accent;
          } else {
            const def = getBuildDef(buildMode.type);
            name = def ? def.name : buildMode.type;
            iconName = def ? def.icon : 'grid';
            accent = def ? def.accent : '#ffc75a';
          }
          refs.banner.style.setProperty('--banner-accent', accent);
          if (refs.bannerIcon) refs.bannerIcon.innerHTML = icon(iconName, '', 16);
          if (refs.bannerText) refs.bannerText.textContent = `建造模式 · ${name}`;
        }
      }
    } else if (refs.banner && refs.banner.hidden && buildMode) {
      refs.banner.hidden = false;
    }
  }

  function paintPrep(s) {
    const prep = s.phase === 'prep';
    const ribbon = refs.prepRibbon;
    if (!ribbon) return;
    if (!prep) { ribbon.hidden = true; return; }
    ribbon.hidden = false;
    const remain = num(s.prepRemaining, Math.max(0, CONFIG.prepDuration - num(s.nightElapsed, 0)));
    const total = Math.max(1, num(CONFIG.prepDuration, 25));
    const pct = clamp(remain / total);
    if (refs.prepBar) refs.prepBar.style.width = `${(pct * 100).toFixed(1)}%`;
    if (refs.prepLabel) setText(refs.prepLabel, `布防中 · 还剩 ${fmtSpan(remain)}`);
    if (refs.prepHint) {
      const spawnIn = Math.max(0, num(s.spawnAt, CONFIG.spawnDelay) - num(s.nightElapsed, 0));
      setText(refs.prepHint, `首魇将在 ${fmtSpan(spawnIn)}后苏醒`);
    }
  }

  // ---------- 主更新 ----------
  function update(nextState) {
    if (!nextState || typeof nextState !== 'object') return;
    state = nextState;
    paintTop(state);
    paintDailyPlan(state);
    paintNightmares(state);
    paintRoommates(state);
    paintRadio(state);
    paintEvents(state);
    paintFacilities(state);
    paintReactions(state);
    paintBanner(state);
    paintPrep(state);
    dock.update(state);
    inspector.update(state);
    if (lastPhase !== state.phase) {
      lastPhase = state.phase;
      el.dataset.phase = state.phase || '';
    }
    if (!mobileHintDismissed && refs.mobileHint && !refs.mobileHint.hidden) {
      // 仅在小屏 CSS 下显示，由样式控制。
    }
  }

  function handleEscape() {
    if (dock.handleEscape()) return true;
    if (dock.isPopoverOpen()) return true;
    if (state && state.ui && state.ui.buildMode) {
      call('cancelBuild');
      return true;
    }
    if (state && state.ui && state.ui.selectedBuildingId) {
      call('selectBuilding', [null]);
      return true;
    }
    if (el.classList.contains('hud--left-open') || el.classList.contains('hud--right-open')) {
      el.classList.remove('hud--left-open', 'hud--right-open');
      return true;
    }
    return false;
  }

  function handleHotkey(key) {
    return dock.handleHotkey(key);
  }

  function destroy() {
    dock.destroy();
  }

  return { el, update, handleEscape, handleHotkey, destroy };
}
