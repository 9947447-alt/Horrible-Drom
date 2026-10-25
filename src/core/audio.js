// WebAudio 程序化音效与夜噪，不加载任何外部音频。
// 浏览器要求用户手势后才能启动 AudioContext，控制器会在首次点击/按键时 unlock。

export function createAudio(initialSettings = {}) {
  let ctx = null;
  let master = null;
  let ambience = null;
  let ambienceGain = null;
  let ambienceFilter = null;
  let noiseSource = null;
  let hum = null;
  let paused = false;
  let volume = clamp(initialSettings.volume ?? 0.55, 0, 1);
  let muted = Boolean(initialSettings.muted);
  let startedNight = false;
  let lastSfx = Object.create(null);

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
    return ctx;
  }

  function unlock() {
    const c = ensure();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
  }

  function makeNoise(duration = 1.2) {
    const c = ensure();
    if (!c) return null;
    const length = Math.max(1, Math.floor(c.sampleRate * duration));
    const buffer = c.createBuffer(1, length, c.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    const src = c.createBufferSource();
    src.buffer = buffer;
    return src;
  }

  function startNight() {
    const c = ensure();
    if (!c || startedNight) {
      if (ambienceGain) ambienceGain.gain.setTargetAtTime(0.14, c.currentTime, 0.7);
      return;
    }
    startedNight = true;
    ambience = c.createGain();
    ambienceGain = c.createGain();
    ambienceFilter = c.createBiquadFilter();
    ambienceFilter.type = 'lowpass';
    ambienceFilter.frequency.value = 520;
    ambienceFilter.Q.value = 0.6;

    noiseSource = makeNoise(4);
    if (noiseSource) {
      noiseSource.loop = true;
      const noiseGain = c.createGain();
      noiseGain.gain.value = 0.22;
      noiseSource.connect(noiseGain).connect(ambienceFilter);
    }

    hum = c.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = 52;
    const humGain = c.createGain();
    humGain.gain.value = 0.12;
    hum.connect(humGain).connect(ambienceFilter);

    const lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(ambienceFilter.frequency);

    ambienceFilter.connect(ambienceGain).connect(master);
    ambienceGain.gain.value = 0.13;
    try {
      noiseSource.start();
      hum.start();
      lfo.start();
    } catch {
      /* already started */
    }
  }

  function stopNight() {
    if (!startedNight) return;
    startedNight = false;
    try {
      noiseSource?.stop();
      hum?.stop();
    } catch {
      /* ignore */
    }
    noiseSource = null;
    hum = null;
    if (ambienceGain && ctx) {
      ambienceGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    }
    ambience = null;
    ambienceGain = null;
    ambienceFilter = null;
  }

  function setPaused(value) {
    paused = Boolean(value);
    if (ambienceGain && ctx) {
      ambienceGain.gain.setTargetAtTime(paused ? 0.04 : 0.13, ctx.currentTime, 0.25);
    }
  }

  function setVolume(v) {
    volume = clamp(Number(v) || 0, 0, 1);
    if (master && ctx) {
      master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.1);
    }
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (master && ctx) {
      master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.08);
    }
  }

  function tone({ freq = 440, dur = 0.1, type = 'sine', gain = 0.12, slide = 0, delay = 0 }) {
    const c = ensure();
    if (!c || muted) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.015, dur * 0.2));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function hit({ dur = 0.12, gain = 0.18, cutoff = 900, delay = 0 }) {
    const c = ensure();
    if (!c || muted) return;
    const src = makeNoise(dur + 0.08);
    if (!src) return;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const env = c.createGain();
    const t0 = c.currentTime + delay;
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(env).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  const sounds = {
    click: () => tone({ freq: 760, dur: 0.045, type: 'triangle', gain: 0.045 }),
    error: () => {
      tone({ freq: 180, dur: 0.09, type: 'square', gain: 0.05 });
      tone({ freq: 150, dur: 0.12, type: 'square', gain: 0.04, delay: 0.06 });
    },
    build: () => {
      hit({ dur: 0.16, gain: 0.22, cutoff: 700 });
      tone({ freq: 210, dur: 0.1, type: 'triangle', gain: 0.08, slide: -80 });
    },
    upgrade: () => {
      tone({ freq: 440, dur: 0.08, type: 'triangle', gain: 0.06 });
      tone({ freq: 660, dur: 0.09, type: 'triangle', gain: 0.055, delay: 0.07 });
      tone({ freq: 990, dur: 0.12, type: 'triangle', gain: 0.05, delay: 0.14 });
    },
    sell: () => {
      tone({ freq: 520, dur: 0.09, type: 'triangle', gain: 0.05 });
      tone({ freq: 330, dur: 0.12, type: 'triangle', gain: 0.04, delay: 0.08 });
    },
    coin: () => {
      tone({ freq: 1180, dur: 0.05, type: 'sine', gain: 0.035 });
      tone({ freq: 1660, dur: 0.07, type: 'sine', gain: 0.03, delay: 0.04 });
    },
    attack: () => hit({ dur: 0.05, gain: 0.035, cutoff: 2200 }),
    door_hit: () => {
      hit({ dur: 0.2, gain: 0.25, cutoff: 300 });
      tone({ freq: 90, dur: 0.17, type: 'sine', gain: 0.1, slide: -30 });
    },
    ghost_hit: () => hit({ dur: 0.1, gain: 0.08, cutoff: 700 }),
    reaction: () => {
      tone({ freq: 520, dur: 0.18, type: 'sine', gain: 0.07 });
      tone({ freq: 780, dur: 0.22, type: 'sine', gain: 0.05, delay: 0.03 });
      tone({ freq: 1040, dur: 0.3, type: 'sine', gain: 0.04, delay: 0.09 });
    },
    level_up: () => {
      tone({ freq: 110, dur: 0.7, type: 'sawtooth', gain: 0.03, slide: 80 });
      tone({ freq: 330, dur: 0.25, type: 'sine', gain: 0.05, delay: 0.15 });
      tone({ freq: 494, dur: 0.3, type: 'sine', gain: 0.045, delay: 0.3 });
    },
    skill: () => {
      tone({ freq: 220, dur: 0.5, type: 'sawtooth', gain: 0.035, slide: -100 });
      hit({ dur: 0.3, gain: 0.05, cutoff: 1100 });
    },
    elimination: () => {
      tone({ freq: 80, dur: 0.6, type: 'sine', gain: 0.09, slide: -30 });
      hit({ dur: 0.45, gain: 0.12, cutoff: 240 });
    },
    warning: () => {
      tone({ freq: 880, dur: 0.08, type: 'square', gain: 0.04 });
      tone({ freq: 660, dur: 0.1, type: 'square', gain: 0.04, delay: 0.12 });
    },
    shower: () => {
      hit({ dur: 0.6, gain: 0.08, cutoff: 5000 });
      tone({ freq: 920, dur: 0.4, type: 'sine', gain: 0.03, slide: 400 });
    },
    repair: () => {
      hit({ dur: 0.12, gain: 0.08, cutoff: 1200 });
      tone({ freq: 480, dur: 0.08, type: 'triangle', gain: 0.04 });
    },
    radio: () => {
      tone({ freq: 880, dur: 0.06, type: 'square', gain: 0.028 });
      tone({ freq: 1320, dur: 0.08, type: 'square', gain: 0.024, delay: 0.08 });
      hit({ dur: 0.12, gain: 0.025, cutoff: 2400, delay: 0.04 });
    },
    relic: () => {
      tone({ freq: 660, dur: 0.09, type: 'sine', gain: 0.05 });
      tone({ freq: 990, dur: 0.12, type: 'sine', gain: 0.045, delay: 0.06 });
      tone({ freq: 1320, dur: 0.18, type: 'sine', gain: 0.035, delay: 0.12 });
    },
    victory: () => {
      [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.5, type: 'sine', gain: 0.06, delay: i * 0.12 }));
    },
    defeat: () => {
      [330, 277, 220, 165].forEach((f, i) => tone({ freq: f, dur: 0.5, type: 'triangle', gain: 0.06, delay: i * 0.15 }));
      hit({ dur: 0.7, gain: 0.1, cutoff: 200, delay: 0.2 });
    },
  };

  function play(name, throttleMs = 0) {
    const c = ensure();
    if (!c || muted) return;
    const fn = sounds[name];
    if (!fn) return;
    const now = performance.now();
    if (throttleMs && lastSfx[name] && now - lastSfx[name] < throttleMs) return;
    lastSfx[name] = now;
    fn();
  }

  function setDanger(level) {
    if (!ambienceFilter || !ctx || !startedNight) return;
    const v = Math.max(0, Math.min(1, level || 0));
    ambienceFilter.frequency.setTargetAtTime(520 + v * 650, ctx.currentTime, 0.8);
    if (ambienceGain) ambienceGain.gain.setTargetAtTime(0.115 + v * 0.06, ctx.currentTime, 0.8);
  }

  function destroy() {
    stopNight();
    if (ctx) {
      ctx.close().catch(() => {});
      ctx = null;
    }
  }

  return { unlock, startNight, stopNight, setPaused, setVolume, setMuted, play, setDanger, destroy };
}
