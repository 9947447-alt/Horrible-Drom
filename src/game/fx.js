// 事件流与特效事件：只服务于 UI / 渲染，不依赖 DOM。
// 事件 kind 使用简短的英文标识，便于音频层做映射。

import { CONFIG } from '../content/index.js';
import { nextEventId, nextFxId } from './internals.js';

/**
 * 推送一条事件。state.events 只保留最近 CONFIG.fx.maxEvents 条。
 * event: { id, at, kind, text }
 */
export function pushEvent(state, text, kind = 'warning', at) {
  const event = {
    id: nextEventId(state),
    at: at ?? state.now,
    kind,
    text,
  };
  state.events.push(event);
  const max = CONFIG.fx.maxEvents;
  if (state.events.length > max) state.events.splice(0, state.events.length - max);
  return event;
}

/**
 * 推送一条特效事件。state.fx 只保留最近 CONFIG.fx.maxFx 条。
 * fx: { id, kind, space, x, y, text, color, bornAt, ttl }
 */
export function pushFx(state, options = {}) {
  const fx = {
    id: nextFxId(state),
    kind: options.kind || 'text',
    space: options.space || 'tile',
    x: options.x ?? 0,
    y: options.y ?? 0,
    text: options.text ?? '',
    color: options.color || '#ffffff',
    bornAt: state.now,
    ttl: options.ttl ?? 0.9,
  };
  state.fx.push(fx);
  const max = CONFIG.fx.maxFx;
  if (state.fx.length > max) state.fx.splice(0, state.fx.length - max);
  return fx;
}

// 清理明显过期的 fx（多留 2 秒给渲染端消费）。
export function pruneFx(state) {
  const now = state.now;
  for (let i = state.fx.length - 1; i >= 0; i -= 1) {
    const fx = state.fx[i];
    if (now > fx.bornAt + fx.ttl + 2) state.fx.splice(i, 1);
  }
}
