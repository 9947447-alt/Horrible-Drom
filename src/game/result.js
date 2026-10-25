// 结算：胜负结果、评级、结算文案。

import { DIFFICULTIES } from '../content/index.js';
import { pushEvent, pushFx } from './fx.js';

export function formatClock(clock = 0) {
  const total = Math.max(0, Math.min(360, clock));
  const hours = Math.floor(total / 60);
  const minutes = Math.floor(total % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function gradeOf(state, outcome) {
  const doorPct = state.player.doorMaxHp > 0 ? state.player.doorHp / state.player.doorMaxHp : 0;
  const survivePct = state.dawnAt > 0 ? Math.min(1, state.nightElapsed / state.dawnAt) : 1;
  const score =
    outcome === 'victory'
      ? 55 +
        doorPct * 25 +
        Math.min(20, state.stats.reactions * 2) +
        state.stats.kills * 8 +
        Math.min(10, state.pressure.level)
      : 8 + survivePct * 35 + doorPct * 20 + state.stats.kills * 6;
  let grade = 'D';
  if (score >= 95) grade = 'S';
  else if (score >= 82) grade = 'A';
  else if (score >= 68) grade = 'B';
  else if (score >= 52) grade = 'C';
  const titles =
    outcome === 'victory'
      ? { S: '滴定大师', A: '天亮之前', B: '守住了门', C: '惨胜', D: '勉强活到天亮' }
      : { S: '无冕的守夜人', A: '差一点天亮', B: '长夜未央', C: '门后的黑暗', D: '熄灯之后' };
  return { grade, title: titles[grade] };
}

/**
 * 结束本局。幂等：重复调用直接返回已有 result。
 * result 形状见 docs/CONTRACT.md：{ outcome, reason, grade, title, lines }
 */
export function finishRun(state, outcome, reason) {
  if (state.result) return state.result;
  const difficulty = DIFFICULTIES[state.difficulty] || DIFFICULTIES.normal;
  const { grade, title } = gradeOf(state, outcome);
  const dawnVictory = outcome === 'victory' && /天亮/.test(reason);
  if (dawnVictory) state.clock = 360;
  // 摘要行按结局分支：天亮 / 全部击退 / 门破
  let headline;
  if (dawnVictory) {
    headline = `难度：${difficulty.name} · 坚守到 06:00 天亮`;
  } else if (outcome === 'victory') {
    headline = `难度：${difficulty.name} · 全部梦魇被滴定（${formatClock(state.clock)} 结束）`;
  } else {
    headline = `难度：${difficulty.name} · 门破于 ${formatClock(state.clock)}`;
  }
  const lines = [
    headline,
    `梦魇击杀 ${state.stats.kills} · 造成伤害 ${Math.round(state.stats.damageDealt)}`,
    `全局压力 Lv.${state.pressure.level} · 触发反应链 ${state.stats.reactions} 次`,
    `累计梦能 ${Math.round(state.stats.dreamEarned)} · 试剂 ${Math.round(state.stats.reagentEarned)}`,
    `建造 ${state.stats.builds} 次 · 维修 ${state.stats.repairs} 次`,
  ];
  state.phase = outcome;
  state.result = { outcome, reason, grade, title, lines };
  pushEvent(state, outcome === 'victory' ? '天亮了，梦魇退回黑暗。' : '气密门被击破……', outcome);
  pushFx(state, {
    kind: 'skill',
    space: 'screen',
    x: 0,
    y: 0,
    text: outcome === 'victory' ? '天亮' : '门破',
    color: outcome === 'victory' ? '#ffd479' : '#ff6b57',
    ttl: 3,
  });
  return state.result;
}
