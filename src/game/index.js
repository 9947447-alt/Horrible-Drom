// 《熄灯之后：反应》游戏模拟层公共 API（无 DOM、无渲染、无第三方依赖）。
// UI / 控制器只通过这里读写游戏状态。

export { createRun, DEFAULT_SETTINGS } from './state.js';
export { step, getPreviewStats } from './engine.js';
export {
  build,
  upgradeBuilding,
  sellBuilding,
  evolveAcid,
  getAvailableAcidStages,
  getBuildLimit,
  checkBuild,
  getBuildingById,
} from './build.js';
export {
  upgradeBed,
  upgradeDoor,
  repairDoor,
  useShower,
  getIncomeRates,
  getShowerRemaining,
} from './economy.js';
export { getDamageMultiplier } from './damage.js';
export { formatClock } from './result.js';
