import * as engine from '../game/index.js';
import { createRenderer } from '../render/index.js';
import { createUI } from '../ui/index.js';
import { createAudio } from '../core/audio.js';
import {
  loadSave, saveSave, recordRun,
} from '../core/storage.js';
import {
  NIGHTMARES, DIFFICULTIES, CONFIG,
} from '../content/index.js';

function nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function pickNightmarePreview(difficulty) {
  const pool = NIGHTMARES.slice();
  const main = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  let secondary = null;
  if (difficulty === 'nightmare' && pool.length) {
    secondary = pool[Math.floor(Math.random() * pool.length)];
  }
  return { mainId: main.id, secondaryId: secondary?.id || null };
}

function makeMetaState(screen, difficulty, settings, records, preview) {
  return {
    version: 1,
    screen,
    phase: 'prep',
    paused: false,
    difficulty,
    seed: 0,
    roomId: null,
    now: 0,
    prepRemaining: 0,
    nightElapsed: 0,
    clock: 0,
    dawnAt: 0,
    spawnAt: 0,
    player: {
      roomId: null,
      dream: 0,
      reagent: 0,
      bedLevel: 1,
      doorLevel: 1,
      doorHp: 0,
      doorMaxHp: 0,
      showerReadyAt: 0,
      threat: 0,
    },
    acidUnlocked: 1,
    buildings: [],
    reactions: [],
    activeNightmares: [],
    minions: [],
    roommates: [],
    pressure: { level: 1, xp: 0, nextLevelXp: 0 },
    events: [],
    fx: [],
    ui: { buildMode: null, selectedBuildingId: null, hoverTile: null },
    stats: { dreamEarned: 0, reagentEarned: 0, damageDealt: 0, kills: 0, builds: 0, reactions: 0, repairs: 0 },
    result: null,
    settings,
    records,
    nightmarePreview: preview,
  };
}

function makeSeed() {
  try {
    const data = new Uint32Array(1);
    crypto.getRandomValues(data);
    return data[0] || Date.now() % 2147483647;
  } catch {
    return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  }
}

export function createController(canvas, uiRoot) {
  const save = loadSave();
  const settings = save.settings;
  let records = save.records;
  let difficulty = 'normal';
  let preview = pickNightmarePreview(difficulty);
  let state = makeMetaState('menu', difficulty, settings, records, preview);
  let pausedByUI = false;
  let lastFrame = nowMs();
  let rafId = 0;
  let lastUiError = '';
  let lastRenderError = '';
  let lastEventSeen = new Set();
  let resultHandled = false;
  let lastDangerUpdate = 0;

  const audio = createAudio(settings);
  const renderer = createRenderer(canvas);

  const actions = {
    goRoomSelect() {
      preview = pickNightmarePreview(difficulty);
      state = makeMetaState('roomSelect', difficulty, settings, records, preview);
      audio.stopNight();
      audio.play('click');
      ui?.update(state, 0);
    },
    goMenu() {
      state = makeMetaState('menu', difficulty, settings, records, preview);
      audio.stopNight();
      audio.play('click');
      ui?.update(state, 0);
    },
    setDifficulty(id) {
      if (!DIFFICULTIES[id]) return;
      difficulty = id;
      state.difficulty = id;
      if (state.screen === 'roomSelect') {
        preview = pickNightmarePreview(difficulty);
        state.nightmarePreview = preview;
      }
      audio.play('click');
      ui?.update(state, 0);
    },
    selectRoom(roomId) {
      startRun(roomId, difficulty);
    },
    pause() {
      if (state.screen !== 'game') return;
      if (state.phase !== 'prep' && state.phase !== 'night') return;
      pausedByUI = true;
      state.paused = true;
      audio.setPaused(true);
      audio.play('click');
    },
    resume() {
      pausedByUI = false;
      state.paused = false;
      audio.setPaused(false);
      audio.play('click');
    },
    togglePause() {
      if (state.paused) actions.resume();
      else actions.pause();
    },
    restart() {
      if (!state.roomId) {
        actions.goRoomSelect();
        return;
      }
      startRun(state.roomId, state.difficulty || difficulty, { keepPreview: true });
    },
    startBuild(type, options = {}) {
      if (state.screen !== 'game' || state.phase === 'victory' || state.phase === 'defeat') return;
      if (!type) return;
      state.ui.buildMode = { type, ...options };
      state.ui.selectedBuildingId = null;
      audio.play('click');
    },
    cancelBuild() {
      state.ui.buildMode = null;
      state.ui.selectedBuildingId = null;
      state.ui.hoverTile = null;
    },
    placeAt(tile) {
      if (!state.ui.buildMode || !tile) return;
      const mode = state.ui.buildMode;
      const result = engine.build(state, mode.type, mode, tile);
      if (!result || result.ok === false) {
        audio.play('error');
        ui?.notify(result?.error || '这里不能建造。', 'error');
        return;
      }
      audio.play('build');
      const id = result.id;
      if (id) state.ui.selectedBuildingId = id;
      state.ui.buildMode = null;
      ui?.update(state, 0);
    },
    selectBuilding(id) {
      if (!id) return;
      state.ui.buildMode = null;
      state.ui.selectedBuildingId = id;
      audio.play('click');
    },
    clearSelection() {
      state.ui.selectedBuildingId = null;
    },
    upgradeSelected() {
      const id = state.ui.selectedBuildingId;
      if (!id) return;
      const result = engine.upgradeBuilding(state, id);
      if (!result || result.ok === false) {
        audio.play('error');
        ui?.notify(result?.error || '无法升级。', 'error');
        return;
      }
      audio.play('upgrade');
      ui?.update(state, 0);
    },
    evolveSelected() {
      const id = state.ui.selectedBuildingId;
      if (!id) return;
      const result = engine.evolveAcid(state, id);
      if (!result || result.ok === false) {
        audio.play('error');
        ui?.notify(result?.error || '无法进阶。', 'error');
        return;
      }
      audio.play('upgrade');
      ui?.update(state, 0);
    },
    sellSelected() {
      const id = state.ui.selectedBuildingId;
      if (!id) return;
      const result = engine.sellBuilding(state, id);
      if (!result || result.ok === false) {
        audio.play('error');
        ui?.notify(result?.error || '无法拆除。', 'error');
        return;
      }
      audio.play('sell');
      state.ui.selectedBuildingId = null;
      ui?.update(state, 0);
    },
    upgradeBed() {
      const result = engine.upgradeBed(state);
      if (!result || result.ok === false) {
        audio.play('error');
        ui?.notify(result?.error || '冷凝床暂时无法升级。', 'error');
        return;
      }
      audio.play('upgrade');
      ui?.update(state, 0);
    },
    upgradeDoor() {
      const result = engine.upgradeDoor(state);
      if (!result || result.ok === false) {
        audio.play('error');
        ui?.notify(result?.error || '气密门暂时无法升级。', 'error');
        return;
      }
      audio.play('upgrade');
      ui?.update(state, 0);
    },
    repairDoor() {
      const result = engine.repairDoor(state);
      if (!result || result.ok === false) {
        audio.play('error');
        ui?.notify(result?.error || '不需要维修。', 'error');
        return;
      }
      audio.play('repair');
      ui?.update(state, 0);
    },
    useShower() {
      const result = engine.useShower(state);
      if (!result || result.ok === false) {
        audio.play('error');
        ui?.notify(result?.error || '应急喷淋还未就绪。', 'error');
        return;
      }
      audio.play('shower');
      ui?.update(state, 0);
    },
    setSetting(key, value) {
      if (!(key in settings)) return;
      settings[key] = value;
      state.settings = settings;
      if (key === 'volume') audio.setVolume(value);
      if (key === 'muted') audio.setMuted(value);
      saveSave({ settings, records });
      document.documentElement.dataset.reducedMotion = settings.reducedMotion ? 'true' : 'false';
      ui?.update(state, 0);
    },
    toggleFullscreen() {
      try {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
      } catch {
        /* ignore */
      }
    },
    openHelp() { /* UI 本地管理 */ },
    closeHelp() { /* UI 本地管理 */ },
    notify(message, kind = 'info') {
      ui?.notify(message, kind);
    },
    getRecords() {
      return records;
    },
  };

  const ui = createUI({
    root: uiRoot,
    actions,
    getSettings: () => settings,
    getRecords: () => records,
  });

  function startRun(roomId, diff, options = {}) {
    const runDifficulty = DIFFICULTIES[diff] ? diff : difficulty;
    if (!options.keepPreview) preview = pickNightmarePreview(runDifficulty);
    const seed = makeSeed();
    let run;
    try {
      run = engine.createRun({
        roomId,
        difficulty: runDifficulty,
        seed,
        settings,
        nightmareId: preview?.mainId,
        secondaryNightmareId: preview?.secondaryId,
      });
    } catch (error) {
      console.error('创建对局失败', error);
      ui?.notify('熄灯失败：模拟层未能启动。', 'error');
      return;
    }
    if (!run) return;
    run.screen = 'game';
    run.settings = settings;
    run.records = records;
    if (!run.ui) run.ui = { buildMode: null, selectedBuildingId: null, hoverTile: null };
    if (run.activeNightmares?.[0]) {
      preview = {
        mainId: run.activeNightmares[0].type,
        secondaryId: run.activeNightmares.find((n) => n.secondary)?.type || preview?.secondaryId || null,
      };
    }
    run.nightmarePreview = preview;
    state = run;
    difficulty = runDifficulty;
    pausedByUI = false;
    resultHandled = false;
    lastEventSeen = new Set();
    audio.startNight();
    audio.setPaused(false);
    ui?.update(state, 0);
  }

  function processEvents() {
    if (!Array.isArray(state.events)) return;
    for (const event of state.events) {
      if (!event || event.id == null) continue;
      if (lastEventSeen.has(event.id)) continue;
      lastEventSeen.add(event.id);
      const kind = event.kind;
      const throttle = kind === 'attack' ? 90 : kind === 'ghost_hit' ? 110 : kind === 'door_hit' ? 110 : 0;
      if (kind && kind !== 'coin') audio.play(kind, throttle);
      else audio.play('coin', 120);
    }
    if (lastEventSeen.size > 200) {
      lastEventSeen = new Set(Array.from(lastEventSeen).slice(-80));
    }
  }

  function detectPhaseEnd() {
    if (state.screen !== 'game' || resultHandled) return;
    if (state.phase !== 'victory' && state.phase !== 'defeat') return;
    resultHandled = true;
    const grade = state.result?.grade || '';
    records = recordRun(records, {
      difficulty: state.difficulty,
      result: state.result,
      nightElapsed: state.nightElapsed,
      grade,
    });
    state.records = records;
    saveSave({ settings, records });
    audio.setPaused(false);
    audio.play(state.phase === 'victory' ? 'victory' : 'defeat');
  }

  function updateDanger() {
    const t = nowMs();
    if (t - lastDangerUpdate < 600) return;
    lastDangerUpdate = t;
    if (state.screen !== 'game') {
      audio.setDanger(0);
      return;
    }
    const doorRatio = state.player?.doorMaxHp ? state.player.doorHp / state.player.doorMaxHp : 1;
    const engaged = (state.activeNightmares || []).some((n) => n.targetRoomId === state.player?.roomId && n.state !== 'dead');
    const pressure = Math.min(1, ((state.pressure?.level || 1) - 1) / 13);
    audio.setDanger(Math.max((1 - doorRatio) * 0.9, pressure * 0.55, engaged ? 0.35 : 0));
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;

    if (state.screen === 'game' && !state.paused && state.phase !== 'victory' && state.phase !== 'defeat') {
      try {
        engine.step(state, dt);
      } catch (error) {
        console.error('模拟步进失败', error);
        if (!lastUiError) {
          lastUiError = String(error?.message || error);
          ui?.notify('模拟出现异常，本局已暂停。', 'error');
        }
      }
      processEvents();
      detectPhaseEnd();
    }

    try {
      renderer.render(state, now / 1000, dt);
    } catch (error) {
      if (!lastRenderError) {
        lastRenderError = String(error?.message || error);
        console.error('渲染失败', error);
      }
    }

    try {
      ui.update(state, dt);
    } catch (error) {
      if (!lastUiError) {
        lastUiError = String(error?.message || error);
        console.error('界面失败', error);
      }
    }

    updateDanger();
  }

  function onResize() {
    try {
      renderer.resize();
    } catch (error) {
      console.error('resize 失败', error);
    }
  }

  function onPointerMove(event) {
    if (state.screen !== 'game' || state.paused) return;
    try {
      const hit = renderer.pickTile(event.clientX, event.clientY, state);
      state.ui.hoverTile = hit?.tile || null;
      canvas.style.cursor = state.ui.buildMode ? (hit?.tile ? 'crosshair' : 'default') : (hit?.buildingId ? 'pointer' : 'default');
    } catch {
      /* ignore pointer mapping errors */
    }
  }

  function onPointerLeave() {
    state.ui.hoverTile = null;
  }

  function onClick(event) {
    if (state.screen !== 'game' || state.paused) return;
    if (state.ui.buildMode) {
      try {
        const hit = renderer.pickTile(event.clientX, event.clientY, state);
        if (hit?.tile) actions.placeAt(hit.tile);
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      const hit = renderer.pickTile(event.clientX, event.clientY, state);
      if (hit?.buildingId) actions.selectBuilding(hit.buildingId);
      else actions.clearSelection();
    } catch {
      /* ignore */
    }
  }

  function onContextMenu(event) {
    if (state.screen === 'game') {
      event.preventDefault();
      if (state.ui.buildMode) actions.cancelBuild();
      else actions.clearSelection();
    }
  }

  function unlockAudio() {
    audio.unlock();
  }

  function start() {
    renderer.resize();
    document.documentElement.dataset.reducedMotion = settings.reducedMotion ? 'true' : 'false';
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('resize', onResize);
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
    lastFrame = nowMs();
    rafId = requestAnimationFrame(frame);
    ui.update(state, 0);
  }

  function destroy() {
    cancelAnimationFrame(rafId);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('click', onClick);
    canvas.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('resize', onResize);
    ui.destroy?.();
    renderer.destroy?.();
    audio.destroy();
  }

  // 调试钩子：只在 window 上，UI 无法访问；用于截图/验收。
  const debug = {
    get state() { return state; },
    actions,
    engine,
    renderer,
    audio,
    goRoomSelect: actions.goRoomSelect,
    goMenu: actions.goMenu,
    setDifficulty: actions.setDifficulty,
    startRun,
    selectRoom: actions.selectRoom,
    build(type, options, tile) {
      const result = engine.build(state, type, options, tile);
      return result;
    },
    advance(seconds = 1) {
      const steps = Math.max(1, Math.round(seconds * 60));
      for (let i = 0; i < steps; i += 1) engine.step(state, 1 / 60);
      processEvents();
      detectPhaseEnd();
      ui.update(state, 0);
      return state.nightElapsed;
    },
    setDream(value) {
      state.player.dream = Number(value) || 0;
    },
    setReagent(value) {
      state.player.reagent = Number(value) || 0;
    },
    getSettings() { return settings; },
  };
  if (typeof window !== 'undefined') window.__HORRIBLE_DORM = debug;

  return { start, destroy, actions, debug, get state() { return state; } };
}
