// 主菜单与选房屏幕。DOM 只构建一次，数值/选中态通过 update 差量刷新。

import { ROOMS, getRoom } from '../content/index.js';
import { icon } from './icons.js';
import {
  esc, btn, iconBtn, keycap, difficultyOf,
  roomStarterLabel, roomNightmarePreview,
} from './kit.js';

const MENU_SKETCH = `
<svg class="record-sketch" viewBox="0 0 400 206" role="img" aria-label="手绘宿舍夜景：吊灯、窗户、书桌与冷凝床">
  <g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
    <path d="M0 176h400" opacity=".5"/>
    <path d="M0 182h400" opacity=".2"/>
    <!-- 吊灯与光锥 -->
    <path d="M92 8v22" opacity=".65"/>
    <path d="M82 30h20l7 10H75Z"/>
    <circle cx="92" cy="49" r="6"/>
    <path d="M92 55v5" opacity=".6"/>
    <path d="M92 58 22 172M92 58l92 114M92 58l-30 114" opacity=".14"/>
    <path d="M92 58l44 114" opacity=".14"/>
    <!-- 窗户 -->
    <path d="M262 34h104v84H262Z"/>
    <path d="M314 34v84M262 76h104"/>
    <circle cx="344" cy="54" r="10" opacity=".8"/>
    <path d="M268 98c8-8 14-4 20-8s10 2 16 0 12-4 18 2 12 2 18 1 14 2 22-2" opacity=".45"/>
    <path d="M290 118v-8h6v8M296 110l4-5 4 5v8" opacity=".55"/>
    <!-- 海报 -->
    <path d="M34 42h56v52H34Z"/>
    <path d="M40 54h44M40 62h44M40 70h30M40 78h36" opacity=".55"/>
    <circle cx="76" cy="48" r="4" opacity=".5"/>
    <path d="m62 86 5-8 5 8Z" opacity=".45"/>
    <!-- 床 -->
    <path d="M22 176v-28h74v28M22 148h30v-14H22Z"/>
    <path d="M36 148v-6M58 148v-6" opacity=".5"/>
    <path d="M148 168h44v-18h-44Z" opacity=".8"/>
    <path d="M166 150v-8h14v8" opacity=".6"/>
    <!-- 书桌与器具 -->
    <path d="M196 176v-30h84v30M196 162h84" opacity=".8"/>
    <path d="M214 162v-8h10v8Z" opacity=".7"/>
    <path d="M232 156l4-10 4 10v6h-8Z" opacity=".7"/>
    <path d="M248 162v-14M244 148h8" opacity=".6"/>
    <path d="M268 158c0-6 5-6 5 0" opacity=".6"/>
    <path d="M148 176h-12" opacity=".4"/>
  </g>
  <g class="record-anno" fill="currentColor" font-size="8" font-family="ui-monospace, Menlo, monospace" opacity=".78">
    <text x="258" y="26">02:47 · 走廊有动静</text>
    <text x="120" y="46">23:00 熄灯</text>
    <text x="34" y="106">观察记录</text>
    <text x="206" y="140">床 → 梦能</text>
    <text x="196" y="194">本页请勿撕下</text>
    <text x="316" y="132">C₆H₆ + ?</text>
  </g>
  <g class="record-mark" stroke="currentColor" fill="none" opacity=".55">
    <circle cx="320" cy="68" r="50" stroke-dasharray="2 5" stroke-width=".8"/>
    <path d="m212 118 8 4M266 122l10-2" stroke-width=".8"/>
  </g>
</svg>`;

function menuActions(label, iconName, menu, cls = 'btn', tip = '') {
  return btn({ label, iconName, cls, tip, extra: `data-menu="${menu}"` });
}

export function createMenuScreen() {
  const el = document.createElement('div');
  el.className = 'screen screen--menu';
  el.innerHTML = `
    <div class="menu-wall" aria-hidden="true"></div>
    <div class="menu-wrap">
      <header class="menu-top">
        <div class="brand">
          <span class="brand__mark">${icon('lamp', 'brand__ico', 20)}</span>
          <span class="brand__text">
            <b>熄灯之后</b>
            <small>化学系旧宿舍 · 夜间生存记录</small>
          </span>
        </div>
        <nav class="menu-topnav" aria-label="菜单">
          ${menuActions('梦魇图鉴', 'book', 'codex', 'btn btn--quiet btn--sm')}
          ${menuActions('设置', 'settings', 'settings', 'btn btn--quiet btn--sm')}
          ${menuActions('制作说明', 'info', 'about', 'btn btn--quiet btn--sm')}
        </nav>
      </header>

      <main class="menu-main">
        <section class="menu-hero">
          <p class="kicker"><span class="kicker__rule"></span>实验记录 No.031 · 熄灯后 23:00</p>
          <h1 class="menu-title">
            <span class="menu-title__main">熄灯之后</span>
            <span class="menu-title__tail">：反应</span>
          </h1>
          <p class="menu-en">HORRIBLE DORM <span>:</span> REACTION</p>
          <p class="menu-lead">
            化学系旧宿舍，熄灯后梦魇成群。躺上冷凝床产出梦能，搭起实验装置，
            用酸与反应链把整夜的噩梦滴定到天亮。
          </p>
          <div class="menu-actions">
            ${btn({ label: '开始守夜', iconName: 'play', cls: 'btn btn--primary btn--lg', extra: 'data-menu="start"' })}
            ${menuActions('梦魇图鉴', 'book', 'codex')}
            ${menuActions('设置', 'sliders', 'settings')}
            ${menuActions('制作说明', 'notebook', 'about', 'btn btn--quiet')}
          </div>
          <p class="menu-meta">
            <span>${icon('clock', '', 14)} 单局 6–10 分钟</span>
            <span>${icon('shield', '', 14)} 无联网 · 无内购</span>
            <span>${icon('flask', '', 14)} 全部程序化绘制</span>
          </p>
          <ul class="menu-hints" aria-label="操作提示">
            <li>${keycap('1–0')} 建造</li>
            <li>${keycap('R')} 维修气密门</li>
            <li>${keycap('Q')} 应急喷淋</li>
            <li>${keycap('Space')} 暂停</li>
          </ul>
        </section>

        <aside class="menu-record" aria-label="值班记录">
          <div class="record-card paper">
            <span class="tape tape--tl" aria-hidden="true"></span>
            <span class="tape tape--tr" aria-hidden="true"></span>
            <span class="tape tape--bl" aria-hidden="true"></span>
            <div class="record-card__head">
              <span class="record-card__form">FD-031 / 宿舍值班</span>
              <span class="record-card__stamp">守夜中</span>
            </div>
            ${MENU_SKETCH}
            <dl class="record-list">
              <div><dt>熄灯</dt><dd>23:00</dd></div>
              <div><dt>天亮</dt><dd>06:00</dd></div>
              <div><dt>舍友</dt><dd>5 间亮灯</dd></div>
              <div><dt>记录人</dt><dd>301 室值班生</dd></div>
            </dl>
            <p class="record-note">
              <span class="record-note__mark">!</span>
              本作化学元素均为幻想设定，不构成任何现实实验配方或操作指导。
            </p>
          </div>
          <div class="menu-log">
            <span class="menu-log__label">夜间观察</span>
            <ul>
              <li><span>23:04</span> 走廊尽头传来玻璃摩擦声。</li>
              <li><span>01:36</span> 301 室冷凝床压力稳定。</li>
              <li><span>03:12</span> 气密门出现第一道划痕。</li>
            </ul>
          </div>
        </aside>
      </main>

      <footer class="menu-foot">
        <span>Horrible Dorm: Reaction · v1.0</span>
        <span class="menu-foot__sep">/</span>
        <span>幻想化学塔防 · 键盘与鼠标操作</span>
        <span class="menu-foot__right">熄灯后请保持安静</span>
      </footer>
    </div>`;

  el.addEventListener('click', (event) => {
    const target = event.target.closest('[data-menu]');
    if (!target) return;
    const kind = target.getAttribute('data-menu');
    el.dispatchEvent(new CustomEvent('menu', { detail: { kind }, bubbles: true }));
  });

  return {
    el,
    update() {},
    destroy() {},
  };
}

const PROP_LABELS = {
  fan: '老风扇', thermos: '暖水瓶', poster: '海报', pipes: '裸露管道', bookshelf: '旧书柜',
  plant: '绿植', balcony: '阳台门', laundry: '晾衣绳', slope: '斜屋顶', boxes: '纸箱',
  lamp: '台灯', desk: '书桌', mirror: '旧镜子',
};

function roomCard(room, sketchIndex) {
  const tags = (room.props || []).slice(0, 3)
    .map((p) => `<span class="room-tag">${esc(PROP_LABELS[p] || p)}</span>`).join('');
  return `
    <button type="button" class="room-card ${sketchIndex % 2 ? 'room-card--alt' : ''}"
      data-room-pick="${esc(room.id)}" aria-pressed="false" style="--room-accent:${esc(room.accent)}">
      <span class="room-card__accent" aria-hidden="true"></span>
      <span class="room-card__top">
        <span class="room-card__num">${esc(room.number)}</span>
        <span class="room-card__name">${esc(room.name)}</span>
        <span class="room-card__check" aria-hidden="true">${icon('check', '', 14)}</span>
      </span>
      <span class="room-card__sub">${esc(room.subtitle)}</span>
      <span class="room-card__desc">${esc(room.desc)}</span>
      <span class="room-card__specs">
        <span class="room-spec"><span class="room-spec__k">面积</span><span class="room-spec__v">${room.w} × ${room.h} 格</span></span>
        <span class="room-spec"><span class="room-spec__k">起始</span><span class="room-spec__v">${esc(roomStarterLabel(room))}</span></span>
        <span class="room-spec room-spec--boss"><span class="room-spec__k">主魇</span><span class="room-spec__v" data-room-boss="${esc(room.id)}">—</span></span>
      </span>
      <span class="room-card__tags">${tags}</span>
    </button>`;
}

export function createRoomScreen() {
  const el = document.createElement('div');
  el.className = 'screen screen--room';
  el.innerHTML = `
    <div class="room-bg" aria-hidden="true"></div>
    <div class="room-wrap">
      <header class="room-top">
        <div class="room-top__left">
          ${btn({ label: '返回', iconName: 'arrowLeft', cls: 'btn btn--quiet btn--sm', extra: 'data-room-back="1"' })}
          <div class="room-heading">
            <p class="kicker kicker--sm">熄灯前 · 选一间宿舍</p>
            <h2 class="room-title">今晚睡哪儿？</h2>
          </div>
        </div>
        <div class="room-top__right">
          <span class="room-diff">
            <span class="room-diff__label">难度</span>
            <b data-room-diff-label>普通</b>
            ${btn({ label: '更改', cls: 'btn btn--ghost btn--xs', extra: 'data-room-diff="1"' })}
          </span>
          ${iconBtn({ iconName: 'book', ariaLabel: '梦魇图鉴', tip: '梦魇图鉴', extra: 'data-room-codex="1"', cls: 'iconbtn iconbtn--sm' })}
          ${iconBtn({ iconName: 'settings', ariaLabel: '设置', tip: '设置', extra: 'data-room-settings="1"', cls: 'iconbtn iconbtn--sm' })}
        </div>
      </header>

      <main class="room-grid" role="group" aria-label="六间宿舍">
        ${ROOMS.map((room, i) => roomCard(room, i)).join('')}
      </main>

      <footer class="room-foot">
        <div class="room-foot__summary">
          <span class="room-foot__label">值班表</span>
          <p data-room-selected>—</p>
        </div>
        <div class="room-foot__actions">
          <span class="room-foot__hint">${keycap('←')} ${keycap('→')} 切换 · ${keycap('Enter')} 确认</span>
          ${btn({ label: '开始守夜', iconName: 'play', cls: 'btn btn--primary btn--lg', extra: 'data-room-confirm="1"' })}
        </div>
      </footer>
    </div>`;

  let selectedId = ROOMS[0] ? ROOMS[0].id : null;
  let lastDifficulty = null;
  let lastBossKey = '';
  let firstPaint = true;
  const bossSlots = Array.from(el.querySelectorAll('[data-room-boss]'));
  const cards = Array.from(el.querySelectorAll('[data-room-pick]'));
  const diffLabel = el.querySelector('[data-room-diff-label]');
  const selectedLine = el.querySelector('[data-room-selected]');
  const confirmBtn = el.querySelector('[data-room-confirm]');
  const summaryRoom = () => getRoom(selectedId);

  function paintSelection() {
    cards.forEach((card) => {
      const on = card.getAttribute('data-room-pick') === selectedId;
      card.classList.toggle('is-selected', on);
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const room = summaryRoom();
    if (room && selectedLine) {
      selectedLine.innerHTML = `<b>${esc(room.number)} ${esc(room.name)}</b><span>${esc(room.subtitle)}</span><span class="room-foot__meta">${room.w}×${room.h} 格 · ${esc(roomStarterLabel(room))}</span>`;
    }
    if (room && confirmBtn) {
      const label = confirmBtn.querySelector('.btn__label');
      if (label) label.textContent = `进入 ${room.number} · 开始守夜`;
    }
  }

  function paintBosses(state) {
    bossSlots.forEach((slot) => {
      const room = getRoom(slot.getAttribute('data-room-boss'));
      const nightmare = roomNightmarePreview(state, room);
      if (!nightmare) { slot.textContent = '未知'; return; }
      slot.innerHTML = `<span class="room-boss" style="--boss-accent:${esc(nightmare.accent)}">${icon('skull', '', 13)}${esc(nightmare.name)}</span>`;
    });
  }

  function paintDifficulty(state) {
    const diff = difficultyOf(state && state.difficulty);
    if (diffLabel) diffLabel.textContent = diff.name;
    lastDifficulty = diff.id;
  }

  el.addEventListener('click', (event) => {
    const pick = event.target.closest('[data-room-pick]');
    if (pick) {
      selectedId = pick.getAttribute('data-room-pick');
      paintSelection();
      return;
    }
    if (event.target.closest('[data-room-confirm]')) {
      if (selectedId) el.dispatchEvent(new CustomEvent('roomselect', { detail: { kind: 'confirm', roomId: selectedId }, bubbles: true }));
      return;
    }
    if (event.target.closest('[data-room-back]')) {
      el.dispatchEvent(new CustomEvent('roomselect', { detail: { kind: 'back' }, bubbles: true }));
      return;
    }
    if (event.target.closest('[data-room-diff]')) {
      el.dispatchEvent(new CustomEvent('roomselect', { detail: { kind: 'difficulty' }, bubbles: true }));
      return;
    }
    if (event.target.closest('[data-room-codex]')) {
      el.dispatchEvent(new CustomEvent('roomselect', { detail: { kind: 'codex' }, bubbles: true }));
      return;
    }
    if (event.target.closest('[data-room-settings]')) {
      el.dispatchEvent(new CustomEvent('roomselect', { detail: { kind: 'settings' }, bubbles: true }));
    }
  });

  function update(state) {
    const diff = difficultyOf(state && state.difficulty);
    const bossKey = `${diff.id}|${state && state.nightmarePreview ? JSON.stringify(state.nightmarePreview) : ''}`;
    if (diff.id !== lastDifficulty) paintDifficulty(state);
    if (firstPaint || bossKey !== lastBossKey) {
      lastBossKey = bossKey;
      firstPaint = false;
      paintBosses(state);
    }
    paintSelection();
  }

  paintDifficulty(null);
  paintSelection();

  return {
    el,
    update,
    getSelected: () => selectedId,
    setSelected(id) {
      if (getRoom(id)) { selectedId = id; paintSelection(); }
    },
    move(delta) {
      const ids = ROOMS.map((r) => r.id);
      const at = Math.max(0, ids.indexOf(selectedId));
      selectedId = ids[(at + delta + ids.length) % ids.length];
      paintSelection();
    },
    confirm() {
      if (selectedId) el.dispatchEvent(new CustomEvent('roomselect', { detail: { kind: 'confirm', roomId: selectedId }, bubbles: true }));
    },
    destroy() {},
  };
}

export function difficultySummary(diffId) {
  const d = difficultyOf(diffId);
  const mins = d.dawnSeconds ? (d.dawnSeconds / 60) : 0;
  const minsText = mins ? `${Number.isInteger(mins) ? mins : mins.toFixed(1)} 分钟` : '—';
  return `${d.name} · 天亮 ${minsText} · 梦魇 ${d.secondary ? '双魇' : '单魇'}`;
}

// 给 overlays 的难度卡使用
export function difficultyStats(def) {
  const rows = [
    { k: '守夜时长', v: `${(() => { const m = (def.dawnSeconds || 0) / 60; return Number.isInteger(m) ? m : m.toFixed(1); })()} 分钟` },
    { k: '梦魇数量', v: def.secondary ? '2 只 · 04:00 增援' : '1 只' },
    { k: '梦魇生命', v: `× ${def.hpMult}` },
    { k: '梦魇伤害', v: `× ${def.dmgMult}` },
    { k: '梦能效率', v: `× ${def.economyMult}` },
  ];
  return rows;
}
