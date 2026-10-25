import { createController } from './app/controller.js';

const canvas = document.getElementById('game-canvas');
const uiRoot = document.getElementById('ui');
const boot = document.getElementById('boot-screen');
const bootError = document.getElementById('boot-error');

function hideBoot() {
  if (!boot) return;
  boot.classList.add('is-hidden');
  setTimeout(() => { boot.hidden = true; }, 600);
}

function fail(error) {
  console.error(error);
  if (bootError) {
    bootError.hidden = false;
    bootError.textContent = `启动失败：${error?.message || error}\n请确认使用本地服务器打开，而不是 file://。`;
  }
  if (boot) boot.classList.remove('is-hidden');
}

try {
  if (!canvas || !uiRoot) throw new Error('页面结构缺失');
  const controller = createController(canvas, uiRoot);
  controller.start();
  window.__dorm = controller;
  // 等待首帧后再收起启动层，避免白闪。
  requestAnimationFrame(() => requestAnimationFrame(hideBoot));
} catch (error) {
  fail(error);
}
