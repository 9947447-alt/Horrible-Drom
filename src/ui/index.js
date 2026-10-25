// 《熄灯之后：反应》DOM 界面入口。
//
// 用法（由 index.html 的控制器调用）：
//   import { createUI } from './src/ui/index.js';
//   const ui = createUI({
//     root: document.querySelector('#ui'),
//     actions: { ... },            // 见 docs/CONTRACT.md
//     getSettings: () => state.settings,
//   });
//   // 每帧：ui.update(state, dt)
//   // 通知：ui.notify('梦能不足', 'warn')
//   // 卸载：ui.destroy()
//
// 静态 mock 预览（不新增入口 HTML，可直接粘进任意本地预览页的 <script type="module">）：
//   import { createUI } from './src/ui/index.js';
//   import { createMockState, createMockActions } from './src/ui/mock.js';
//   const state = createMockState({ mode: 'night' });
//   const actions = createMockActions(state);
//   const ui = createUI({ root: document.querySelector('#ui'), actions, getSettings: () => state.settings, autoTutorial: false });
//   ui.update(state, 0);
//
// 本模块只读 state，所有状态变更都通过 actions。

import { icon } from './icons.js';
import { mergeSettings } from './kit.js';
import { createMenuScreen, createRoomScreen } from './screens.js';
import { createHud } from './hud.js';
import { renderOverlay } from './overlays.js';

const STYLE_URL = new URL('../../styles/main.css', import.meta.url).href;

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

function ensureStyles(doc) {
  if (!doc || !doc.head) return;
  const found = doc.querySelector('link[data-hd-styles], link[href$="styles/main.css"]');
  if (found) return;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = STYLE_URL;
  link.setAttribute('data-hd-styles', '1');
  doc.head.appendChild(link);
}

function normalizeScreen(state) {
  if (!state || typeof state !== 'object') return 'menu';
  if (state.screen === 'game' || state.screen === 'roomSelect') return state.screen;
  return 'menu';
}

const TOAST_ICON = { info: 'info', success: 'check', warn: 'warning', error: 'alert' };
const ENDED = new Set(['victory', 'defeat']);
const TUTORIAL_KEY = 'hd-tutorial-seen-v1';

function readTutorialSeen(doc) {
  try {
    if (!doc || !doc.defaultView || !doc.defaultView.localStorage) return false;
    return doc.defaultView.localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch (error) {
    return false;
  }
}

function writeTutorialSeen(doc) {
  try {
    if (!doc || !doc.defaultView || !doc.defaultView.localStorage) return;
    doc.defaultView.localStorage.setItem(TUTORIAL_KEY, '1');
  } catch (error) {
    /* 隐私模式等场景静默降级为会话内记忆 */
  }
}

function criticalKey(state) {
  if (!state || state.screen !== 'game') return `${state && state.screen}|${state && state.difficulty}`;
  const build = state.ui && state.ui.buildMode;
  return [
    state.phase, state.paused ? 1 : 0,
    build ? `${build.type}:${build.stage || ''}` : '',
    state.ui ? state.ui.selectedBuildingId : '',
    state.acidUnlocked, state.difficulty, state.roomId,
    state.result ? `${state.result.outcome || ''}${state.result.grade || ''}` : '',
  ].join('|');
}

function resultKey(state) {
  const result = state.result || {};
  const stats = state.stats || {};
  return [
    'result', state.phase, result.outcome || '', result.grade || '', result.title || '',
    result.reason || '', (result.lines || []).join('~'),
    stats.kills, stats.damageDealt, stats.builds, stats.reactions, stats.repairs,
    stats.dreamEarned, stats.reagentEarned, state.pressure && state.pressure.level,
  ].join('|');
}

export function createUI(options = {}) {
  const { root, actions = {}, getSettings, autoTutorial = true, autoStyles = true, tutorialKey } = options;
  if (!root || typeof root.appendChild !== 'function') {
    throw new Error('createUI: 需要传入 #ui 根容器');
  }
  const doc = root.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) throw new Error('createUI: 当前环境没有 document');
  if (autoStyles) ensureStyles(doc);

  const wrap = doc.createElement('div');
  wrap.className = 'hd-ui';
  wrap.setAttribute('data-hd-ui', '1');
  wrap.innerHTML = `
    <div class="hd-screen-host" data-hd-screens></div>
    <div class="hd-overlay-host" data-hd-overlays hidden></div>
    <div class="hd-toasts" data-hd-toasts role="status" aria-live="polite" aria-atomic="false"></div>
    <div class="hd-rotate-tip" role="status" aria-label="请横屏使用">
      <div class="hd-rotate-tip__card paper">
        <span class="hd-rotate-tip__icon">${icon('rotate', '', 40)}</span>
        <b>请横屏守夜</b>
        <p>旧宿舍的走廊是横向的。旋转设备后，房间与建造栏才能完整展开。</p>
      </div>
    </div>
    <div class="hd-boot" data-hd-boot role="status" aria-label="正在载入界面">
      <div class="hd-boot__card">
        <span class="hd-boot__mark">${icon('lamp', '', 30)}</span>
        <div class="hd-boot__text">
          <b>正在点亮走廊…</b>
          <small>Horrible Dorm: Reaction</small>
        </div>
        <span class="hd-boot__scan" aria-hidden="true"></span>
      </div>
    </div>`;
  root.replaceChildren(wrap);

  const screensHost = wrap.querySelector('[data-hd-screens]');
  const overlayHost = wrap.querySelector('[data-hd-overlays]');
  const toastHost = wrap.querySelector('[data-hd-toasts]');
  const boot = wrap.querySelector('[data-hd-boot]');

  const local = {
    state: null,
    screen: null,
    view: null,
    overlay: null,
    overlayKey: null,
    resumeOnClose: false,
    pauseDismissed: false,
    tutorialSeen: readTutorialSeen(doc),
    returnFocus: null,
    hudClock: 0,
    screenClock: 0,
    hudKey: '',
    booted: false,
    destroyed: false,
    styleLink: null,
    errorShown: false,
  };
  const timers = new Set();
  const warnedActions = new Set();
  const boundKeyHandler = (event) => onKeyDown(event);

  // ---------- 通用 ----------
  function safeCall(name, args = []) {
    const fn = actions ? actions[name] : null;
    if (typeof fn !== 'function') {
      if (!warnedActions.has(name)) {
        warnedActions.add(name);
        if (typeof console !== 'undefined' && console.warn) console.warn(`[UI] actions 缺少 ${name}，相关按钮将不会生效`);
      }
      return undefined;
    }
    try {
      return fn.apply(actions, args);
    } catch (error) {
      if (typeof console !== 'undefined' && console.error) console.error(`[UI] actions.${name} 抛出异常`, error);
      notify(`操作失败：${error && error.message ? error.message : '未知错误'}`, 'error');
      return undefined;
    }
  }

  function call(name, args = []) {
    const result = safeCall(name, args);
    if (result && typeof result === 'object' && result.ok === false) {
      notify(result.error || '当前无法执行该操作', 'warn');
    }
    return result;
  }

  function notify(message, kind = 'info') {
    if (!message || local.destroyed) return;
    const toast = doc.createElement('div');
    toast.className = `toast toast--${TOAST_ICON[kind] ? kind : 'info'}`;
    toast.innerHTML = `<span class="toast__ico">${icon(TOAST_ICON[kind] || 'info', '', 16)}</span><span class="toast__text"></span><span class="toast__bar" aria-hidden="true"></span>`;
    const text = toast.querySelector('.toast__text');
    if (text) text.textContent = String(message);
    toastHost.appendChild(toast);
    while (toastHost.children.length > 3) toastHost.removeChild(toastHost.firstChild);
    const timer = setTimeout(() => {
      timers.delete(timer);
      toast.classList.add('is-out');
      const removeTimer = setTimeout(() => {
        timers.delete(removeTimer);
        toast.remove();
      }, 260);
      timers.add(removeTimer);
    }, 3800);
    timers.add(timer);
  }

  function hideBoot() {
    if (local.booted || !boot) return;
    local.booted = true;
    boot.classList.add('is-hidden');
    const timer = setTimeout(() => {
      timers.delete(timer);
      boot.remove();
    }, 420);
    timers.add(timer);
  }

  function applySettings(state) {
    let merged;
    try {
      merged = mergeSettings(state, getSettings);
    } catch (err) {
      merged = mergeSettings(null, null);
    }
    wrap.classList.toggle('hd-reduce-motion', Boolean(merged.reducedMotion));
    wrap.classList.toggle('hd-muted', Boolean(merged.muted));
  }

  // ---------- 屏幕 ----------
  function clearScreen() {
    if (local.view && typeof local.view.destroy === 'function') {
      try { local.view.destroy(); } catch (err) { /* noop */ }
    }
    local.view = null;
    screensHost.innerHTML = '';
  }

  function mountScreen(state) {
    const screen = normalizeScreen(state);
    if (screen === local.screen && local.view) return;
    local.screen = screen;
    clearScreen();
    try {
      if (screen === 'menu') {
        const view = createMenuScreen();
        view.el.addEventListener('menu', (event) => {
          const kind = event.detail && event.detail.kind;
          if (kind === 'start') openOverlay('difficulty');
          else if (kind === 'codex') openOverlay('help', 'nightmares');
          else if (kind === 'settings') openOverlay('settings');
          else if (kind === 'about') openOverlay('about');
        });
        local.view = view;
      } else if (screen === 'roomSelect') {
        const view = createRoomScreen();
        view.el.addEventListener('roomselect', (event) => {
          const detail = event.detail || {};
          if (detail.kind === 'confirm') call('selectRoom', [detail.roomId]);
          else if (detail.kind === 'back') call('goMenu');
          else if (detail.kind === 'difficulty') openOverlay('difficulty');
          else if (detail.kind === 'codex') openOverlay('help', 'nightmares');
          else if (detail.kind === 'settings') openOverlay('settings');
        });
        local.view = view;
      } else {
        const view = createHud({
          call,
          notify,
          openOverlay,
          togglePause,
        });
        local.view = view;
      }
      screensHost.appendChild(local.view.el);
      if (typeof local.view.update === 'function') local.view.update(state);
    } catch (error) {
      renderFatal(error);
    }
  }

  function renderFatal(error) {
    if (typeof console !== 'undefined' && console.error) console.error('[UI] 界面渲染失败', error);
    screensHost.innerHTML = `
      <div class="hd-fatal">
        <div class="hd-fatal__card paper">
          <p class="kicker kicker--sm">记录中断</p>
          <h2>界面没能点亮</h2>
          <p>走廊的电路出了点问题。可以先返回主菜单或刷新页面重试。</p>
          <pre>${String((error && error.message) || error || '未知错误').slice(0, 400)}</pre>
          <div class="hd-fatal__actions">
            <button class="btn btn--primary" data-fatal="retry">重新渲染</button>
            <button class="btn btn--quiet" data-fatal="menu">返回主菜单</button>
          </div>
        </div>
      </div>`;
    const retry = screensHost.querySelector('[data-fatal="retry"]');
    if (retry) retry.addEventListener('click', () => {
      local.screen = null;
      local.view = null;
      if (local.state) mountScreen(local.state);
    });
    const menu = screensHost.querySelector('[data-fatal="menu"]');
    if (menu) menu.addEventListener('click', () => call('goMenu'));
  }

  function updateScreen(state, force = false) {
    if (!local.view) return;
    const now = nowMs();
    if (!force && now - local.screenClock < 100) return;
    local.screenClock = now;
    try {
      if (typeof local.view.update === 'function') local.view.update(state);
    } catch (error) {
      if (!local.errorShown) {
        local.errorShown = true;
        if (typeof console !== 'undefined' && console.error) console.error('[UI] 屏幕更新失败', error);
        notify('界面更新遇到问题，已保留当前画面', 'warn');
      }
    }
  }

  function updateHud(state) {
    if (!local.view || local.screen !== 'game' || typeof local.view.update !== 'function') return;
    const now = nowMs();
    if (now - local.hudClock < 100) return;
    local.hudClock = now;
    try {
      local.view.update(state);
    } catch (error) {
      if (!local.errorShown) {
        local.errorShown = true;
        if (typeof console !== 'undefined' && console.error) console.error('[UI] HUD 更新失败', error);
        notify('HUD 更新异常，数值可能暂停刷新', 'warn');
      }
    }
  }

  // ---------- 模态 ----------
  function overlayAutoSpec(state) {
    if (!state || state.screen !== 'game') return null;
    if (state.phase === 'victory' || state.phase === 'defeat') return { name: 'result' };
    if (state.paused && !local.pauseDismissed) return { name: 'pause' };
    return null;
  }

  function currentOverlaySpec() {
    if (local.overlay) return { name: local.overlay.name, tab: local.overlay.tab };
    return overlayAutoSpec(local.state);
  }

  function overlayBuildKey(spec, state) {
    if (!spec) return '';
    if (spec.name === 'result') return resultKey(state || {});
    if (spec.name === 'pause') return `pause|${state && state.roomId}|${state && state.phase}`;
    return `${spec.name}|${spec.tab || ''}`;
  }

  function overlayContext(spec) {
    return {
      state: local.state,
      tab: spec.tab,
      settings: mergeSettings(local.state, getSettings),
      call,
      closeOverlay,
      openOverlay,
      openTutorial,
      pickDifficulty,
      getSettings,
    };
  }

  function renderOverlayNow(force = false) {
    const state = local.state;
    const spec = currentOverlaySpec();
    const wasHidden = overlayHost.hidden;
    if (!spec) {
      if (!overlayHost.hidden) {
        overlayHost.hidden = true;
        overlayHost.innerHTML = '';
        overlayHost.removeAttribute('data-key');
        local.overlayKey = null;
        restoreFocus();
      } else if (force) {
        overlayHost.innerHTML = '';
      }
      return;
    }
    const key = overlayBuildKey(spec, state);
    if (!force && !wasHidden && local.overlayKey === key) return;
    if (wasHidden) {
      local.returnFocus = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
    }
    let node = null;
    try {
      node = renderOverlay(spec, overlayContext(spec));
    } catch (error) {
      if (typeof console !== 'undefined' && console.error) console.error('[UI] 模态渲染失败', error);
    }
    overlayHost.hidden = false;
    overlayHost.innerHTML = '';
    if (node) overlayHost.appendChild(node);
    else {
      overlayHost.innerHTML = `<div class="overlay"><div class="overlay__backdrop"></div><div class="overlay__panel panel--paper"><div class="overlay__body"><p>面板加载失败，请按 Esc 返回。</p></div></div></div>`;
    }
    local.overlayKey = key;
    overlayHost.setAttribute('data-key', key);
    const focusTarget = overlayHost.querySelector('[data-autofocus]')
      || overlayHost.querySelector('.overlay__panel .btn--primary, .overlay__panel button, .overlay__panel input');
    if (focusTarget && typeof focusTarget.focus === 'function') {
      try { focusTarget.focus({ preventScroll: true }); } catch (err) { focusTarget.focus(); }
    }
  }

  function restoreFocus() {
    const target = local.returnFocus;
    local.returnFocus = null;
    if (target && target.isConnected && typeof target.focus === 'function') {
      try { target.focus({ preventScroll: true }); } catch (err) { target.focus(); }
    }
  }

  function openOverlay(name, tab) {
    if (local.destroyed) return;
    const state = local.state;
    const playing = state && state.screen === 'game'
      && (state.phase === 'prep' || state.phase === 'night');
    const wasOpen = Boolean(local.overlay);
    if (playing && !state.paused) {
      local.resumeOnClose = true;
      safeCall('pause');
    } else if (!wasOpen) {
      local.resumeOnClose = false;
    }
    local.overlay = { name, tab: tab || null };
    renderOverlayNow(true);
  }

  function openTutorial() {
    if (local.destroyed) return;
    const state = local.state;
    const playing = state && state.screen === 'game'
      && (state.phase === 'prep' || state.phase === 'night');
    if (playing && !state.paused) {
      local.resumeOnClose = true;
      safeCall('pause');
    }
    local.overlay = { name: 'tutorial' };
    renderOverlayNow(true);
  }

  function closeOverlay(options = {}) {
    const state = local.state;
    const wasLocal = Boolean(local.overlay);
    const ended = state && ENDED.has(state.phase);
    const playing = state && state.screen === 'game' && !ended;
    local.overlay = null;
    let shouldResume = false;
    if (!options.skipResume) {
      if (wasLocal && local.resumeOnClose && playing) shouldResume = true;
      else if (!wasLocal && state && state.screen === 'game' && state.paused && playing) shouldResume = true;
    }
    local.resumeOnClose = false;
    if (shouldResume) {
      local.pauseDismissed = true;
      safeCall('resume');
    }
    renderOverlayNow(true);
  }

  function pickDifficulty(id) {
    if (id) call('setDifficulty', [id]);
    local.overlay = null;
    const state = local.state || {};
    if (state.screen === 'roomSelect') {
      renderOverlayNow(true);
      return;
    }
    call('goRoomSelect');
    renderOverlayNow(true);
  }

  function togglePause() {
    const state = local.state;
    if (!state || state.screen !== 'game') return;
    if (state.phase === 'victory' || state.phase === 'defeat') return;
    if (local.overlay) return;
    if (state.paused) {
      local.pauseDismissed = true;
      call('resume');
    } else {
      local.pauseDismissed = false;
      call('pause');
    }
  }

  // ---------- 键盘 ----------
  function isTypingTarget(target) {
    if (!target) return false;
    const tag = String(target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (target.isContentEditable) return true;
    return false;
  }

  function trapOverlayFocus(event) {
    const panel = overlayHost.querySelector('.overlay__panel');
    if (!panel) return;
    const focusables = Array.from(panel.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'))
      .filter((node) => !node.hidden && node.getAttribute('aria-hidden') !== 'true');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = doc.activeElement;
    if (!overlayHost.contains(active)) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    }
  }

  function onKeyDown(event) {
    if (local.destroyed || !event) return;
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    const state = local.state;

    if (key === 'Escape') {
      if (isTypingTarget(event.target) && !local.overlay && !overlayHost.hidden) {
        // 输入控件聚焦时，Esc 仍允许关闭最上层模态。
        closeOverlay();
        event.preventDefault();
        return;
      }
      if (handleEscape()) event.preventDefault();
      return;
    }

    if (key === 'Tab' && !overlayHost.hidden) {
      trapOverlayFocus(event);
      return;
    }

    if (isTypingTarget(event.target)) return;

    if (local.overlay) return;

    if (!state) return;
    if (state.screen === 'game') {
      if (state.phase === 'victory' || state.phase === 'defeat') return;
      if (key === ' ' || key === 'Spacebar') {
        event.preventDefault();
        togglePause();
        return;
      }
      if (state.paused) return;
      if (key === 'q' || key === 'Q') {
        event.preventDefault();
        call('useShower');
        return;
      }
      if (key === 'r' || key === 'R') {
        event.preventDefault();
        call('repairDoor');
        return;
      }
      if (/^[0-9]$/.test(key)) {
        if (local.view && typeof local.view.handleHotkey === 'function') {
          if (local.view.handleHotkey(key)) event.preventDefault();
        }
      }
      return;
    }

    if (state.screen === 'roomSelect') {
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        event.preventDefault();
        if (local.view && typeof local.view.move === 'function') local.view.move(key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (key === 'Enter') {
        event.preventDefault();
        if (local.view && typeof local.view.confirm === 'function') local.view.confirm();
      }
      return;
    }

    if (state.screen === 'menu' && key === 'Enter') {
      event.preventDefault();
      openOverlay('difficulty');
    }
  }

  function handleEscape() {
    if (local.overlay) {
      closeOverlay();
      return true;
    }
    const state = local.state;
    if (!state) return false;
    if (state.screen === 'game') {
      if (state.phase === 'victory' || state.phase === 'defeat') return true;
      if (local.view && typeof local.view.handleEscape === 'function' && local.view.handleEscape()) return true;
      if (state.paused) {
        local.pauseDismissed = true;
        call('resume');
        return true;
      }
      local.pauseDismissed = false;
      call('pause');
      return true;
    }
    if (state.screen === 'roomSelect') {
      call('goMenu');
      return true;
    }
    return false;
  }

  // ---------- 主更新 ----------
  function update(state, dt) {
    if (local.destroyed) return;
    void dt;
    const nextState = state && typeof state === 'object' ? state : local.state;
    if (!nextState) return;
    local.state = nextState;
    applySettings(nextState);
    if (local.state.paused === false) local.pauseDismissed = false;

    const screen = normalizeScreen(nextState);
    if (screen !== local.screen || !local.view) mountScreen(nextState);
    else updateScreen(nextState);

    if (local.screen === 'game') {
      const key = criticalKey(nextState);
      if (key !== local.hudKey) {
        local.hudKey = key;
        local.hudClock = 0;
      }
      updateHud(nextState);
      // 首次进入对局：教程只出现一次（仅准备/夜晚阶段）。
      if (autoTutorial && !local.tutorialSeen && !local.overlay
        && (nextState.phase === 'prep' || nextState.phase === 'night')) {
        local.tutorialSeen = true;
        writeTutorialSeen(doc);
        openTutorial();
      }
    }

    renderOverlayNow(false);
    hideBoot();
  }

  doc.addEventListener('keydown', onKeyDown);
  // Esc 的兜底：部分控制器会把 Escape 吃掉，这里不重复绑定，仅提供公开方法。
  return {
    update,
    notify,
    destroy() {
      if (local.destroyed) return;
      local.destroyed = true;
      doc.removeEventListener('keydown', onKeyDown);
      clearScreen();
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      wrap.remove();
    },
    // 调试用：返回当前内部快照（不参与契约）。
    _debug() {
      return {
        screen: local.screen,
        overlay: local.overlay,
        hudKey: local.hudKey,
        tutorialSeen: local.tutorialSeen,
        tutorialKey: tutorialKey || TUTORIAL_KEY,
      };
    },
  };
}

export default createUI;
