// 战斗视觉反馈：装饰性弹道、命中粒子、爆炸环、反应/电弧、屏幕震动、
// state.fx 飘字与技能文字、设备环境动画。
// 只做“看起来对”的装饰，真实伤害与命中由游戏模拟层决定。

import {
  TAU, clamp, lerp, hash01, hashString, rngFrom, rgba, mixColor, darken, lighten,
  easeOutCubic, easeOutBack, smoothNoise,
} from './util.js';
import { project, tileCenter, projectElevated } from './layout.js';
import {
  drawGlow, drawBanner, drawText, drawTag, boltPath, blobPath, flameShape,
  roundRect, drawSoftShadow, paperTag, FONT_SANS, FONT_SERIF,
} from './paint.js';
import { getBuildingMuzzle } from './buildings.js';
import { nightmareBodyCenter } from './nightmares.js';
import {
  getBuildingStats, getAcidStage, getSpecialStats, getDeviceStats, getBuildingLabel,
} from '../content/index.js';
import { getDamageColor, FX_STYLE } from './themes.js';

const BODY_TOP = 116;
const MAX_PARTICLES = 340;
const MAX_PROJECTILES = 48;
const MAX_RINGS = 24;
const MAX_BEAMS = 18;
const MAX_TEXT = 48;

function createParticle() {
  return {
    active: false, x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0.9,
    life: 0, maxLife: 1, size: 3, color: '#fff', shape: 'dot',
    additive: false, alpha: 1, rot: 0, vr: 0, wobble: 0, seed: 0,
  };
}

export function createFxSystem() {
  const particles = Array.from({ length: MAX_PARTICLES }, createParticle);
  const projectiles = [];
  for (let i = 0; i < MAX_PROJECTILES; i++) {
    projectiles.push({
      active: false, x: 0, y: 0, sx: 0, sy: 0, tx: 0, ty: 0, t: 0,
      dur: 0.4, color: '#fff', size: 4, kind: 'droplet', trail: 0,
      seed: 1, wobble: 0, targetId: null, spin: 0, arc: 0,
    });
  }
  const rings = Array.from({ length: MAX_RINGS }, () => ({
    active: false, x: 0, y: 0, r: 0, maxR: 40, life: 0, maxLife: 0.4,
    color: '#fff', width: 2, squash: 0.5, fill: false,
  }));
  const beams = Array.from({ length: MAX_BEAMS }, () => ({
    active: false, x1: 0, y1: 0, x2: 0, y2: 0, life: 0, maxLife: 0.18,
    color: '#fff', width: 2, seed: 1, jagged: 6, glow: true,
  }));
  const texts = Array.from({ length: MAX_TEXT }, () => ({ active: false }));
  const fireTimers = new Map();
  const seenFx = new Map();
  const pulses = { door: 0, boss: new Map(), screen: 0 };
  let shakeAmp = 0;
  let shakeSeed = 1;
  let particleCursor = 0;
  let simTime = 0;

  // ---------------- 粒子 ----------------

  function spawnParticle(x, y, opts = {}) {
    let slot = null;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const idx = (particleCursor + i) % MAX_PARTICLES;
      if (!particles[idx].active) {
        slot = particles[idx];
        particleCursor = (idx + 1) % MAX_PARTICLES;
        break;
      }
    }
    if (!slot) {
      // 满了就顶掉游标处
      slot = particles[particleCursor];
      particleCursor = (particleCursor + 1) % MAX_PARTICLES;
    }
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.vx = opts.vx ?? 0;
    slot.vy = opts.vy ?? 0;
    slot.g = opts.g ?? 0;
    slot.drag = opts.drag ?? 0.92;
    slot.maxLife = opts.life ?? 0.6;
    slot.life = slot.maxLife;
    slot.size = opts.size ?? 3;
    slot.color = opts.color ?? '#f3e7cf';
    slot.shape = opts.shape ?? 'dot';
    slot.additive = !!opts.additive;
    slot.alpha = opts.alpha ?? 1;
    slot.rot = opts.rot ?? 0;
    slot.vr = opts.vr ?? 0;
    slot.wobble = opts.wobble ?? 0;
    slot.seed = opts.seed ?? 1;
    return slot;
  }

  function spawnBurst(x, y, opts = {}) {
    const n = opts.count ?? 8;
    const color = opts.color ?? '#ffc75a';
    const speed = opts.speed ?? 80;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (opts.angle ?? 0) + (hash01(i, 3) - 0.5) * 0.6;
      const s = speed * (0.4 + hash01(i, 4) * 0.9);
      spawnParticle(x, y, {
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * (opts.squash ?? 0.55) + (opts.vy ?? 0),
        g: opts.g ?? 120,
        life: (opts.life ?? 0.55) * (0.6 + hash01(i, 5) * 0.7),
        size: (opts.size ?? 2.4) * (0.6 + hash01(i, 6) * 0.9),
        color,
        shape: opts.shape ?? 'dot',
        additive: opts.additive ?? true,
        drag: opts.drag ?? 0.9,
        seed: i,
      });
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.vy += p.g * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.wobble) p.x += Math.sin((p.maxLife - p.life) * 9 + p.seed) * p.wobble * dt;
    }
  }

  function drawParticles(ctx, additive) {
    ctx.save();
    if (additive) ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      if (!p.active || p.additive !== additive) continue;
      const k = clamp(p.life / p.maxLife, 0, 1);
      const a = p.alpha * Math.min(1, k * 1.6);
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.shape === 'streak') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillRect(-p.size * 3, -p.size * 0.5, p.size * 3.4, p.size);
        ctx.restore();
      } else if (p.shape === 'frost') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const ang = (i / 3) * Math.PI;
          ctx.moveTo(-Math.cos(ang) * p.size, -Math.sin(ang) * p.size);
          ctx.lineTo(Math.cos(ang) * p.size, Math.sin(ang) * p.size);
        }
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      } else if (p.shape === 'ring') {
        ctx.save();
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.6 - k), 0, TAU);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.6 + 0.6 * k), 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------------- 冲击环 / 光束 ----------------

  function spawnRing(x, y, opts = {}) {
    const ring = rings.find((r) => !r.active);
    if (!ring) return;
    ring.active = true;
    ring.x = x;
    ring.y = y;
    ring.r = opts.startR ?? 4;
    ring.maxR = opts.maxR ?? 40;
    ring.life = ring.maxLife = opts.life ?? 0.4;
    ring.color = opts.color ?? '#ffc75a';
    ring.width = opts.width ?? 2;
    ring.squash = opts.squash ?? 0.5;
    ring.fill = !!opts.fill;
  }

  function updateRings(dt) {
    for (const r of rings) {
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.active = false;
        continue;
      }
      const k = 1 - r.life / r.maxLife;
      r.r = lerp(r.r, r.maxR, 1 - Math.pow(0.001, dt));
      r._k = k;
    }
  }

  function drawRings(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const r of rings) {
      if (!r.active) continue;
      const k = clamp(1 - r.life / r.maxLife, 0, 1);
      const a = (1 - k) * 0.6;
      ctx.strokeStyle = rgba(r.color, a);
      ctx.lineWidth = r.width * (1 - k * 0.5);
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r, r.r * r.squash, 0, 0, TAU);
      if (r.fill) {
        ctx.fillStyle = rgba(r.color, a * 0.14);
        ctx.fill();
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function spawnBeam(x1, y1, x2, y2, opts = {}) {
    const beam = beams.find((b) => !b.active);
    if (!beam) return;
    beam.active = true;
    beam.x1 = x1;
    beam.y1 = y1;
    beam.x2 = x2;
    beam.y2 = y2;
    beam.life = beam.maxLife = opts.life ?? 0.16;
    beam.color = opts.color ?? '#ff9ab5';
    beam.width = opts.width ?? 2;
    beam.seed = opts.seed ?? Math.floor(Math.random() * 9999);
    beam.jagged = opts.jagged ?? 6;
    beam.glow = opts.glow !== false;
  }

  function updateBeams(dt) {
    for (const b of beams) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) b.active = false;
    }
  }

  function drawBeams(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of beams) {
      if (!b.active) continue;
      const a = clamp(b.life / b.maxLife, 0, 1);
      if (b.glow) {
        drawGlow(ctx, b.color, b.x1, b.y1, 14, a * 0.35);
        drawGlow(ctx, b.color, b.x2, b.y2, 14, a * 0.35);
      }
      ctx.strokeStyle = rgba(b.color, a * 0.85);
      ctx.lineWidth = b.width;
      ctx.beginPath();
      boltPath(ctx, b.x1, b.y1, b.x2, b.y2, b.seed, b.jagged, 12);
      ctx.stroke();
      ctx.strokeStyle = rgba('#fff6e0', a * 0.5);
      ctx.lineWidth = Math.max(0.6, b.width * 0.35);
      ctx.beginPath();
      boltPath(ctx, b.x1, b.y1, b.x2, b.y2, b.seed + 1, b.jagged, 8);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------- 装饰性弹道 ----------------

  const FIRE_DATA = {
    acid: { kind: 'acid' },
    chlorate: { kind: 'fireball' },
    benzene: { kind: 'chain' },
  };

  function fireInterval(b) {
    try {
      const stats = getBuildingStats(b);
      if (stats && typeof stats.interval === 'number') return clamp(stats.interval, 0.35, 2.6);
    } catch (e) { /* 忽略内容缺失 */ }
    return b.type === 'benzene' ? 0.85 : b.type === 'chlorate' ? 2.2 : 1.1;
  }

  function pickTarget(env, from) {
    const visuals = env.nightmareVisuals || [];
    let best = null;
    let bestD = Infinity;
    for (const v of visuals) {
      if (v.hidden) continue;
      const c = nightmareBodyCenter(v);
      const d = Math.hypot(c.x - from.x, c.y - from.y);
      if (d < bestD) {
        bestD = d;
        best = { v, c };
      }
    }
    return best;
  }

  function spawnProjectile(env, b, target) {
    const proj = projectiles.find((p) => !p.active);
    if (!proj) return;
    const muzzle = getBuildingMuzzle(env.layout, b, target.c);
    const stats = safeStats(b);
    const accent = stats?.accent || (b.type === 'acid' ? getAcidStage(b.stage || 1).accent : '#ffc75a');
    const kind = b.type === 'acid'
      ? (b.stage >= 5 ? 'spray' : b.stage === 2 ? 'bubble' : b.stage === 4 ? 'flame' : b.stage === 6 ? 'rocket' : 'droplet')
      : b.type === 'chlorate' ? 'fireball' : 'droplet';
    const dist = Math.hypot(target.c.x - muzzle.x, target.c.y - muzzle.y);
    proj.active = true;
    proj.x = muzzle.x;
    proj.y = muzzle.y;
    proj.sx = muzzle.x;
    proj.sy = muzzle.y;
    proj.tx = target.c.x + (hash01(proj.tx, 2) - 0.5) * 6;
    proj.ty = target.c.y + (hash01(proj.ty, 3) - 0.5) * 6;
    proj.t = 0;
    proj.dur = clamp(dist / (b.type === 'chlorate' ? 520 : 640), 0.16, 0.65);
    proj.color = accent;
    proj.size = (b.type === 'chlorate' ? 6 : b.type === 'acid' ? 3.4 + (b.stage - 1) * 0.4 : 4) * env.layout.scale;
    proj.kind = kind;
    proj.trail = 0;
    proj.seed = hashString(b.id || 'b') % 999;
    proj.wobble = b.type === 'acid' && b.stage === 2 ? 8 : 2;
    proj.targetId = target.v.n?.id;
    proj.arc = kind === 'fireball' || kind === 'rocket' ? 26 * env.layout.scale : 0;
    // 炮口火光
    spawnBurst(muzzle.x, muzzle.y, {
      count: 3, color: accent, speed: 34, size: 1.8, life: 0.25, angle: muzzle.angle, g: 20,
    });
    return proj;
  }

  function updateProjectiles(dt, env) {
    for (const p of projectiles) {
      if (!p.active) continue;
      p.t += dt;
      const k = clamp(p.t / p.dur, 0, 1);
      const e = easeOutCubic(k);
      p.x = lerp(p.sx, p.tx, e);
      p.y = lerp(p.sy, p.ty, e) - Math.sin(e * Math.PI) * p.arc;
      if (p.wobble) p.y += Math.sin(e * 18 + p.seed) * p.wobble * (1 - e) * 0.3;
      p.spin += dt * 8;
      // 拖尾
      p.trail -= dt;
      if (p.trail <= 0 && k < 0.9) {
        p.trail = 0.03;
        if (p.kind === 'fireball' || p.kind === 'rocket' || p.kind === 'flame') {
          spawnParticle(p.x, p.y, {
            vx: (Math.random() - 0.5) * 20, vy: -10 - Math.random() * 20,
            life: 0.3 + Math.random() * 0.2, size: p.size * (0.4 + Math.random() * 0.5),
            color: p.kind === 'rocket' ? '#ffd9a0' : p.color, additive: true, g: -12,
          });
        } else if (p.kind === 'spray' || p.kind === 'bubble') {
          spawnParticle(p.x, p.y, {
            vx: (Math.random() - 0.5) * 26, vy: (Math.random() - 0.5) * 12,
            life: 0.2 + Math.random() * 0.2, size: 1 + Math.random() * 1.4,
            color: p.color, additive: true, g: 30,
          });
        } else {
          spawnParticle(p.x, p.y, {
            vx: 0, vy: 6, life: 0.22, size: p.size * 0.45, color: p.color, additive: true, g: 20,
          });
        }
      }
      if (k >= 1) {
        p.active = false;
        onProjectileHit(p, env);
      }
    }
  }

  function onProjectileHit(p, env) {
    const color = p.color;
    const count = p.kind === 'fireball' ? 14 : p.kind === 'spray' ? 9 : 7;
    spawnBurst(p.tx, p.ty, {
      count,
      color,
      speed: p.kind === 'fireball' ? 150 : 95,
      size: p.size * 0.55,
      life: 0.45,
      g: p.kind === 'fireball' ? 60 : 130,
      additive: true,
    });
    if (p.kind === 'fireball') {
      spawnRing(p.tx, p.ty, { maxR: 34 * env.layout.scale, color, width: 2.4, life: 0.34, fill: true });
      addShake(1.1);
    } else if (p.kind === 'spray') {
      spawnRing(p.tx, p.ty, { maxR: 22 * env.layout.scale, color, width: 1.2, life: 0.28 });
    }
    // 命中闪白（给梦魇）
    if (p.targetId) pulseBoss(p.targetId, p.kind === 'fireball' ? 0.55 : 0.35);
  }

  function drawProjectiles(ctx, env) {
    for (const p of projectiles) {
      if (!p.active) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      const ang = Math.atan2(p.ty - p.sy, p.tx - p.sx);
      ctx.rotate(ang);
      if (p.kind === 'fireball' || p.kind === 'rocket') {
        drawGlow(ctx, p.color, 0, 0, p.size * 3.2, 0.5);
        ctx.fillStyle = '#fff2cc';
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.6, 0, TAU);
        ctx.fill();
        ctx.fillStyle = rgba(p.color, 0.8);
        ctx.beginPath();
        ctx.ellipse(-p.size * 0.7, 0, p.size * 1.2, p.size * 0.7, 0, 0, TAU);
        ctx.fill();
      } else if (p.kind === 'bubble') {
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = rgba(p.color, 0.7);
          ctx.beginPath();
          ctx.arc(-i * p.size * 1.2, Math.sin(p.spin + i) * 2, p.size * (0.6 - i * 0.12), 0, TAU);
          ctx.fill();
        }
      } else if (p.kind === 'spray') {
        for (let i = 0; i < 4; i++) {
          const a = -0.4 + i * 0.26;
          ctx.fillStyle = rgba(p.color, 0.6);
          ctx.beginPath();
          ctx.arc(Math.cos(a) * 6 - i * 2, Math.sin(a) * 6, p.size * 0.32, 0, TAU);
          ctx.fill();
        }
      } else if (p.kind === 'flame') {
        drawGlow(ctx, p.color, 0, 0, p.size * 2.6, 0.5);
        flameShape(ctx, 0, 3, p.size * 2.4, p.size * 3.2, p.spin, p.seed, {
          hot: '#fff0c8', mid: p.color, low: '#a04a24',
        });
      } else {
        // 液滴/凝胶
        ctx.fillStyle = rgba(p.color, 0.85);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 1.4, p.size * 0.85, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.arc(p.size * 0.3, -p.size * 0.25, p.size * 0.3, 0, TAU);
        ctx.fill();
        drawGlow(ctx, p.color, 0, 0, p.size * 2, 0.2);
      }
      if (p.kind === 'spray' || p.kind === 'bubble') ctx.globalCompositeOperation = 'lighter';
      ctx.restore();
    }
  }

  // ---------------- 每帧装饰射击 ----------------

  function updateCosmeticFire(env, dt) {
    if (!env.state || env.state.screen !== 'game') return;
    if (env.state.phase !== 'night' && env.state.phase !== 'victory') return;
    const simNow = env.simNow;
    const buildings = env.state.buildings || [];
    let fired = 0;
    for (const b of buildings) {
      if (!b || !b.tile) continue;
      if (b.type !== 'acid' && b.type !== 'chlorate' && b.type !== 'benzene') continue;
      if (typeof b.disabledUntil === 'number' && b.disabledUntil > simNow) continue;
      if (typeof b.overheat === 'number' && b.overheat > 0) {
        // 过热时冒烟
        if (Math.random() < dt * 6) {
          const p = tileCenter(env.layout, b.tile.x, b.tile.y);
          spawnParticle(p.x + (Math.random() - 0.5) * 12, p.y - 28, {
            vx: (Math.random() - 0.5) * 8, vy: -18 - Math.random() * 12,
            life: 0.6, size: 2 + Math.random() * 2, color: 'rgba(210,205,190,0.5)',
            additive: false, g: -6,
          });
        }
        continue;
      }
      let entry = fireTimers.get(b.id);
      if (!entry) {
        entry = { next: simNow + hash01(b.tile.x, b.tile.y, 7) * 0.9 };
        fireTimers.set(b.id, entry);
      }
      if (simNow < entry.next) continue;
      if (fired >= 5) break;
      const from = tileCenter(env.layout, b.tile.x, b.tile.y);
      const target = pickTarget(env, from);
      if (!target) {
        entry.next = simNow + 0.4;
        continue;
      }
      if (b.type === 'benzene') {
        fireBenzeneChain(env, b, target, simNow);
        entry.next = simNow + fireInterval(b) * (0.85 + Math.random() * 0.3);
      } else {
        spawnProjectile(env, b, target);
        entry.next = simNow + fireInterval(b) * (0.85 + Math.random() * 0.3);
      }
      fired++;
    }
  }

  function fireBenzeneChain(env, b, target, simNow) {
    const muzzle = getBuildingMuzzle(env.layout, b, target.c);
    const accent = '#ff9ab5';
    spawnBeam(muzzle.x, muzzle.y, target.c.x, target.c.y, {
      color: accent, width: 2, life: 0.14, seed: Math.floor(simNow * 40) % 9999, jagged: 5,
    });
    pulseBoss(target.v.n?.id, 0.3);
    // 第二段共振：跳到另一只梦魇
    const others = (env.nightmareVisuals || []).filter((v) => v !== target.v && !v.hidden);
    if (others.length) {
      const second = others[0];
      const c2 = nightmareBodyCenter(second);
      spawnBeam(target.c.x, target.c.y, c2.x, c2.y, {
        color: accent, width: 1.4, life: 0.18, seed: Math.floor(simNow * 40) % 9999 + 3, jagged: 6,
      });
      pulseBoss(second.n?.id, 0.2);
    }
  }

  // ---------------- 设备环境动画 ----------------

  function drawBuildingAmbient(ctx, env) {
    const buildings = env.state?.buildings || [];
    const s = env.layout.scale;
    const t = env.now;
    for (const b of buildings) {
      if (!b || !b.tile) continue;
      if (typeof b.disabledUntil === 'number' && b.disabledUntil > env.simNow) continue;
      const p = tileCenter(env.layout, b.tile.x, b.tile.y);
      switch (b.type) {
        case 'analyzer': {
          for (let i = 0; i < 2; i++) {
            const ph = (t * 0.6 + i * 0.5 + hash01(b.tile.x, b.tile.y)) % 1;
            ctx.fillStyle = `rgba(99,224,194,${(1 - ph) * 0.5})`;
            ctx.beginPath();
            ctx.arc(p.x + Math.sin(ph * 6 + i) * 3 * s, p.y - (34 + ph * 16) * s, 1.4 * s, 0, TAU);
            ctx.fill();
          }
          break;
        }
        case 'condenser': {
          for (let i = 0; i < 3; i++) {
            const ph = (t * 0.25 + i * 0.33) % 1;
            ctx.strokeStyle = `rgba(143,216,255,${(1 - ph) * 0.22})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y - (14 + ph * 26) * s, (8 + ph * 12) * s, (3 + ph * 5) * s, 0, 0, TAU);
            ctx.stroke();
          }
          break;
        }
        case 'vent': {
          for (let i = 0; i < 3; i++) {
            const ph = (t * 0.5 + i * 0.33) % 1;
            ctx.strokeStyle = `rgba(158,231,216,${(1 - ph) * 0.22})`;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(p.x - (8 + i * 4) * s, p.y - (44 - ph * 8) * s);
            ctx.lineTo(p.x - (14 + i * 5) * s - ph * 10 * s, p.y - (54 - ph * 10) * s);
            ctx.stroke();
          }
          break;
        }
        case 'catalyst': {
          if (Math.sin(t * 4 + hash01(b.tile.x, b.tile.y) * 9) > 0.9) {
            const ph = (t * 1.6) % 1;
            ctx.fillStyle = `rgba(255,180,94,${(1 - ph) * 0.8})`;
            ctx.beginPath();
            ctx.arc(p.x + Math.sin(t * 9) * 8 * s, p.y - (22 + ph * 14) * s, 1.2 * s, 0, TAU);
            ctx.fill();
          }
          break;
        }
        case 'neutralizer': {
          for (let i = 0; i < 2; i++) {
            const ph = (t * 0.5 + i * 0.5 + hash01(b.tile.x, b.tile.y)) % 1;
            ctx.fillStyle = `rgba(199,232,168,${(1 - ph) * 0.35})`;
            ctx.beginPath();
            ctx.arc(p.x + Math.sin(i * 4 + t) * 8 * s, p.y - ph * 10 * s, 1.2 * s, 0, TAU);
            ctx.fill();
          }
          break;
        }
        case 'accelerator': {
          if (b.level >= 2) {
            const seed = Math.floor(t * 9 + hash01(b.tile.x, b.tile.y) * 10);
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = 'rgba(255,226,122,0.3)';
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            boltPath(ctx, p.x - 14 * s, p.y - 26 * s, p.x + 14 * s, p.y - 32 * s, seed, 6, 6 * s);
            ctx.stroke();
            ctx.restore();
          }
          break;
        }
        case 'atm': {
          if (Math.sin(t * 2 + hash01(b.tile.x, b.tile.y) * 7) > 0.6) {
            const ph = (t * 0.8) % 1;
            ctx.fillStyle = `rgba(199,168,255,${(1 - ph) * 0.5})`;
            ctx.beginPath();
            ctx.arc(p.x + Math.sin(t * 3) * 6 * s, p.y - (30 + ph * 12) * s, 1.1 * s, 0, TAU);
            ctx.fill();
          }
          break;
        }
        default:
          break;
      }
    }
  }

  // ---------------- 屏幕震动 / 脉冲 ----------------

  function addShake(amount) {
    shakeAmp = Math.min(13, shakeAmp + amount);
    shakeSeed = Math.floor(Math.random() * 9999) + 1;
  }

  function pulseBoss(id, amount) {
    if (!id) return;
    pulses.boss.set(id, Math.min(1, (pulses.boss.get(id) || 0) + amount));
  }

  function getShake(env) {
    const settings = env?.state?.settings;
    if (settings && settings.shake === false) return { x: 0, y: 0, amp: 0 };
    if (settings && settings.reducedMotion) return { x: 0, y: 0, amp: 0 };
    if (shakeAmp < 0.02) return { x: 0, y: 0, amp: 0 };
    const decay = shakeAmp / 13;
    const x = smoothNoise(simTime * 47, shakeSeed) * shakeAmp * 0.7;
    const y = smoothNoise(simTime * 43, shakeSeed + 7) * shakeAmp * 0.55;
    return { x, y, amp: shakeAmp };
  }

  // ---------------- state.fx 飘字 ----------------

  function digestStateFx(state, simNow) {
    const fx = Array.isArray(state?.fx) ? state.fx : [];
    const liveIds = new Set();
    for (const item of fx) {
      if (!item) continue;
      const id = item.id ?? `${item.bornAt}|${item.text}|${item.kind}`;
      liveIds.add(id);
      if (!seenFx.has(id)) {
        seenFx.set(id, simNow);
        const kind = item.kind || 'text';
        if (kind === 'damage') {
          if (item.space === 'door') {
            pulses.door = 1;
            addShake(2.2);
          } else if (item.space === 'boss') {
            addShake(1.1);
            // 附近所有梦魇轻微闪白（无法可靠对应单只）
            for (const v of env_pulses_targets || []) {
              pulseBoss(v, 0.28);
            }
          } else {
            addShake(0.5);
          }
        } else if (kind === 'skill') {
          addShake(3.2);
          pulses.screen = 1;
        } else if (kind === 'reaction') {
          addShake(0.6);
        }
      }
    }
    // 清理已消失的 fx 记录
    if (seenFx.size > 160) {
      for (const id of [...seenFx.keys()]) {
        if (!liveIds.has(id)) seenFx.delete(id);
      }
    }
  }

  let env_pulses_targets = [];
  function setPulseTargets(ids) {
    env_pulses_targets = ids;
  }

  function fxScreenPos(env, item) {
    const { layout } = env;
    const s = layout.scale;
    const space = item.space || 'tile';
    if (space === 'tile') {
      const p = project(layout, (item.x ?? 0) + 0.5, (item.y ?? 0) + 0.5);
      return { x: p.x, y: p.y - 22 * s };
    }
    if (space === 'door') {
      const d = layout.door;
      const ox = Math.abs(item.x || 0) <= 2 ? (item.x || 0) * d.width : item.x || 0;
      const oy = Math.abs(item.y || 0) <= 2 ? (item.y || 0) * d.height * 0.4 : item.y || 0;
      // 门上方 1/4 门高处，避免遮住门体与门前的梦魇
      return { x: d.center.x + ox * 0.3, y: d.topY - 10 * s + oy * 0.2 };
    }
    if (space === 'boss') {
      const visuals = env.nightmareVisuals || [];
      if (visuals.length) {
        const idx = Math.abs(Math.round(item.y || 0)) % visuals.length;
        const v = visuals[idx];
        const c = nightmareBodyCenter(v);
        const top = v.groundY - BODY_TOP * v.u;
        return { x: c.x + (hash01(item.id ? item.id.length : 3, 2) - 0.5) * 26 * s, y: top - 14 * s };
      }
      return { x: layout.cssW * 0.5, y: layout.cssH * 0.4 };
    }
    // screen
    const x = Math.abs(item.x || 0) <= 1 ? (item.x || 0.5) * layout.cssW : item.x || layout.cssW * 0.5;
    const y = Math.abs(item.y || 0) <= 1 ? (item.y || 0.3) * layout.cssH : item.y || layout.cssH * 0.3;
    return { x: clamp(x, 20, layout.cssW - 20), y: clamp(y, 30, layout.cssH - 20) };
  }

  function drawStateFx(ctx, env) {
    const fx = Array.isArray(env.state?.fx) ? env.state.fx : [];
    if (!fx.length) return;
    const simNow = env.simNow;
    const s = env.layout.scale;
    for (const item of fx) {
      if (!item) continue;
      const born = typeof item.bornAt === 'number' ? item.bornAt : simNow;
      const ttl = typeof item.ttl === 'number' ? item.ttl : 1.1;
      const age = simNow - born;
      if (age < 0 || age > ttl) continue;
      const k = clamp(age / ttl, 0, 1);
      const pos = fxScreenPos(env, item);
      const kind = item.kind || 'text';
      const color = item.color || (kind === 'damage' ? '#f3e7cf' : '#ffc75a');
      const text = String(item.text ?? '');
      if (!text) continue;
      ctx.save();
      if (kind === 'damage') {
        const pop = easeOutBack(clamp(age / 0.16, 0, 1));
        const rise = easeOutCubic(k) * FX_STYLE.damage.rise * s;
        const alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
        const numeric = /^[0-9]+$/.test(text);
        const size = clamp((numeric && Number(text) >= 20 ? 18 : 14) * s, 11, 22);
        ctx.globalAlpha *= clamp(alpha, 0, 1);
        ctx.translate(pos.x + Math.sin(k * 6 + 1) * 3, pos.y - rise);
        ctx.rotate((hash01(item.id ? String(item.id).length : 3, 2) - 0.5) * 0.12);
        ctx.scale(pop, pop);
        drawText(ctx, text, 0, 0, {
          size,
          weight: 800,
          color: toInkColor(color),
          stroke: 'rgba(8,6,4,0.85)',
          strokeWidth: size * 0.28,
        });
      } else if (kind === 'skill' || kind === 'reaction') {
        const alpha = k > 0.65 ? 1 - (k - 0.65) / 0.35 : Math.min(1, age / 0.12);
        const rise = easeOutCubic(k) * FX_STYLE.skill.rise * s;
        ctx.globalAlpha *= clamp(alpha, 0, 1);
        drawBanner(ctx, pos.x, pos.y - rise, text, color, { size: 11 * s, alpha: 1 });
      } else {
        const alpha = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
        const rise = easeOutCubic(k) * FX_STYLE.text.rise * s;
        ctx.globalAlpha *= clamp(alpha, 0, 1);
        drawText(ctx, text, pos.x, pos.y - rise, {
          size: clamp(11 * s, 9, 13),
          weight: 600,
          color: toInkColor(color),
          stroke: 'rgba(8,6,4,0.8)',
          strokeWidth: 3,
        });
      }
      ctx.restore();
    }
  }

  function toInkColor(color) {
    return color && typeof color === 'string' ? color : '#f3e7cf';
  }

  // ---------------- 屏幕叠层（受击闪光/警报） ----------------

  function drawScreenFx(ctx, env) {
    const { layout } = env;
    if (pulses.door > 0.04) {
      ctx.save();
      ctx.globalAlpha = pulses.door * 0.12;
      const g = ctx.createRadialGradient(
        layout.cssW / 2, layout.cssH * 0.55, layout.cssH * 0.25,
        layout.cssW / 2, layout.cssH * 0.55, layout.cssW * 0.75
      );
      g.addColorStop(0, 'rgba(255,80,60,0)');
      g.addColorStop(1, 'rgba(255,70,50,1)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, layout.cssW, layout.cssH);
      ctx.restore();
    }
    if (pulses.screen > 0.05) {
      ctx.save();
      ctx.fillStyle = `rgba(255,236,206,${pulses.screen * 0.06})`;
      ctx.fillRect(0, 0, layout.cssW, layout.cssH);
      ctx.restore();
    }
  }

  // ---------------- 主循环 ----------------

  return {
    reset() {
      for (const p of particles) p.active = false;
      for (const p of projectiles) p.active = false;
      for (const r of rings) r.active = false;
      for (const b of beams) b.active = false;
      fireTimers.clear();
      seenFx.clear();
      pulses.door = 0;
      pulses.screen = 0;
      pulses.boss.clear();
      shakeAmp = 0;
      simTime = 0;
    },
    update(dt, env) {
      const d = clamp(dt || 0, 0, 0.05);
      simTime += d;
      const simNow = env.simNow;
      setPulseTargets((env.nightmareVisuals || []).map((v) => v.n && v.n.id).filter(Boolean));
      digestStateFx(env.state, simNow);
      updateCosmeticFire(env, d);
      updateParticles(d);
      updateProjectiles(d, env);
      updateRings(d);
      updateBeams(d);
      // 衰减
      shakeAmp *= Math.exp(-5.5 * d);
      pulses.door *= Math.exp(-7 * d);
      pulses.screen *= Math.exp(-6 * d);
      for (const [id, v] of pulses.boss) {
        const nv = v * Math.exp(-8 * d);
        if (nv < 0.02) pulses.boss.delete(id);
        else pulses.boss.set(id, nv);
      }
    },
    draw(ctx, env) {
      drawBuildingAmbient(ctx, env);
      drawBeams(ctx);
      drawProjectiles(ctx, env);
      drawRings(ctx);
      drawParticles(ctx, false);
      drawParticles(ctx, true);
    },
    drawText(ctx, env) {
      drawStateFx(ctx, env);
    },
    drawScreen(ctx, env) {
      drawScreenFx(ctx, env);
    },
    getShake(env) {
      return getShake(env);
    },
    getPulses() {
      return pulses;
    },
    addShake,
    pulseBoss,
  };
}

function safeStats(b) {
  try {
    return getBuildingStats(b);
  } catch (e) {
    return null;
  }
}
