# 实现契约 v1

所有模块使用原生 ES Modules，无运行时依赖、无构建步骤。不要引入 npm 包或外部 CDN 资源。

## 文件边界

| 范围 | 负责人 | 目录 |
|---|---|---|
| 内容数据、核心、控制器、音频、入口 | Lead | `index.html`, `src/main.js`, `src/core/**`, `src/app/**`, `src/content/**`, `src/audio/**`, `tools/serve.mjs` |
| 游戏模拟 | systems-dev | `src/game/**`, `tests/game*.test.js` |
| DOM 界面 | ui-dev | `src/ui/**`, `styles/**` |
| Canvas 渲染 | render-dev | `src/render/**` |
| 独立 QA | qa-dev | `tests/e2e/**`, `tools/qa/**`, 只读产品源码 |

不要跨范围写文件；发现契约问题先报告，由 Lead 修改契约与内容。

## 模块公共 API

### 内容 `src/content/index.js`

```js
export { CONFIG, DIFFICULTIES } from './config.js';
export { ROOMS } from './rooms.js';
export {
  ACID_STAGES, SPECIAL_TOWERS, DEVICES, BUILD_DEFS,
  getBuildDef, getAcidStage, getAcidStats, getAcidCost,
  getSpecialStats, getSpecialUpgradeCost, getDeviceStats,
  getDeviceUpgradeCost, getBuildingStats, getUpgradeCost, getBuildCost
} from './towers.js';
export { NIGHTMARES, getNightmare } from './nightmares.js';
export { REACTIONS } from './reactions.js';
```

### 游戏模拟 `src/game/index.js`

```js
export function createRun({ roomId, difficulty, seed, settings }) // 返回 GameState
export function step(state, dt) // 原地更新；dt 秒，内部按 60Hz 子步进
export function getPreviewStats(state) // 给 UI 用：当前收入/反应等可选
export function build(state, type, options, tile) // {ok, error?}
export function upgradeBuilding(state, id) // {ok, error?}
export function sellBuilding(state, id) // {ok, error?}
export function upgradeBed(state)
export function upgradeDoor(state)
export function repairDoor(state)
export function useShower(state)
export function evolveAcid(state, id) // 酸塔达到 III 后研究/进阶段
export function getAvailableAcidStages(state)
export function getBuildLimit(state, type) // {current, max|null}
```

`createRun` 之后状态处于 `phase:'prep'`；`step` 负责 prep 倒计时结束后进入 `night`，并在 `spawnAt` 生成梦魇。

### 界面 `src/ui/index.js`

```js
export function createUI({ root, actions, getSettings })
// -> { update(state, dt), notify(msg, kind), destroy() }
```

- `root` 是 `#ui` 容器，UI 自己构建全部 DOM。
- UI 每帧可调用 `update`，但内部应节流 HUD 更新到 ~10–15Hz。
- UI 只读 state；修改必须通过 `actions`。
- `actions` 由控制器提供，至少包含：

```js
{
  goRoomSelect(), selectRoom(roomId), goMenu(), setDifficulty(id),
  pause(), resume(), togglePause(), restart(),
  startBuild(type, options), cancelBuild(), placeAt(tile),
  selectBuilding(id), upgradeSelected(), sellSelected(), evolveSelected(),
  upgradeBed(), upgradeDoor(), repairDoor(), useShower(),
  openHelp(), closeHelp(), setSetting(key, value), goResult?()
}
```

- 对局中 UI 需要展示：夜钟/压力等级/梦魇血条（含双魇、弱点图标、技能节点）、梦能/试剂、床/门状态、建造栏、建筑检查面板、反应链、舍友灯态、事件流、教程提示。
- 所有按钮必须有 disabled 原因提示；所有建造卡显示名称、等级/阶段、费用、伤害类型、下一级变化。
- 模态层由 UI 本地管理；暂停时调用 `pause()`。
- 移动端横屏可玩，竖屏显示旋转提示；支持 `prefers-reduced-motion`。

### 渲染 `src/render/index.js`

```js
export function createRenderer(canvas)
// -> {
//   resize(),
//   render(state, nowSeconds, deltaSeconds),
//   pickTile(clientX, clientY, state), // {tile:{x,y}, buildingId?}|null
//   getLayout(state), // 可选调试
//   destroy()
// }
```

- Canvas 铺满窗口；CSS 尺寸由 `#game-canvas` 保证；内部按 DPR 缩放。
- 只在 `state.screen === 'game'` 时绘制世界；菜单/选房由 UI 的 CSS 背景处理。画布在菜单时保持透明/暗色即可。
- 渲染内容：等距宿舍剖面、床、气密门、走廊、6 种梦魇、玩家房间网格、所有建筑、反应连线、射程/放置预览、选中高亮、受击/火焰/冷雾/电击/爆炸、伤害数字、胜利/失败氛围。
- 放置预览读取 `state.ui.buildMode`、`state.ui.hoverTile`、`state.ui.selectedBuildingId`。
- 事件/伤害数字读取 `state.fx`（见下），渲染端自行消费过期项。
- 渲染端不得修改 state。

### 控制器与入口

- `src/app/controller.js` 创建 state、绑定 canvas 指针、键盘、requestAnimationFrame；调用 `step`、`ui.update`、`renderer.render`、音频。
- `src/main.js` 只负责启动控制器。
- 所有屏幕切换、暂停、重开、设置都由控制器管理；UI 调用 actions。
- 指针点击经 `renderer.pickTile` 转换为 tile/building，再调用 build/select 动作。

## GameState 形状

```js
{
  version: 1,
  screen: 'menu' | 'roomSelect' | 'game',
  phase: 'prep' | 'night' | 'victory' | 'defeat',
  paused: false,
  difficulty: 'easy' | 'normal' | 'nightmare',
  seed: 123,
  roomId: 'room-301',
  now: 0,                 // 本次 run 经过秒数（含 prep）
  prepRemaining: 25,
  nightElapsed: 0,        // 夜晚开始后的秒数
  clock: 0,               // 0..360，展示为 00:00..06:00
  dawnAt: 480,            // nightElapsed 达到此值即天亮
  spawnAt: 35,
  player: {
    roomId, dream: 60, reagent: 0,
    bedLevel: 1, doorLevel: 1, doorHp: 180, doorMaxHp: 180,
    showerReadyAt: 0, threat: 1
  },
  acidUnlocked: 1,        // 已解锁的最高酸阶段 1..6
  buildings: [Building],
  reactions: [ { id, name, aId, bId } ],
  activeNightmares: [Nightmare],
  minions: [Minion],
  roommates: [Roommate],
  pressure: { level: 1, xp: 0, nextLevelXp: 220 },
  events: [ { id, at, text, kind } ],
  fx: [Fx],
  ui: {
    buildMode: null,      // {type:'acid',stage:2} | {type:'chlorate'} | {type:'analyzer'}
    selectedBuildingId: null,
    hoverTile: null       // {x,y}
  },
  stats: { dreamEarned:0, reagentEarned:0, damageDealt:0, kills:0, builds:0, reactions:0, repairs:0 },
  result: null,           // {outcome,reason,grade,title,lines:[string]}
  settings: { volume:0.6, muted:false, reducedMotion:false, shake:true }
}
```

`Building`：

```js
{
  id: 'b-12', type: 'acid'|'chlorate'|'benzene'|'analyzer'|'condenser'|'vent'|'catalyst'|'neutralizer'|'accelerator'|'atm',
  stage: 1..6,       // 仅 acid
  level: 1..10,      // acid/devices: 1..3; chlorate/benzene: 1..10
  tile: { x, y },
  disabledUntil: 0,
  overheat: 0,
  isStarter: true|false
}
```

`Nightmare`：

```js
{
  id: 'n-1', type: 'benzene'|'phosphorus'|'mercury'|'hydrogen_sulfide'|'carbon_monoxide'|'formaldehyde',
  secondary: false,
  level: 1..14,
  hp: 900, maxHp: 900,
  damage: 12, attackInterval: 1.8, attackTimer: 0,
  state: 'roam'|'attack'|'retreat'|'dead',
  targetRoomId: 'room-301',
  spawnAt: 0, announceAt: 0,
  disabledUntil: 0, revealUntil: 0,
  statuses: { burnUntil:0, slowUntil:0, stunUntil:0, repairLockUntil:0 },
  skillLevelsFired: [3,6]
}
```

`Roommate`：

```js
{ id, roomId, name, color, alive, doorHp, maxDoorHp, offense, threat }
```

`Minion`：

```js
{ id, kind:'droplet'|'specimen', hp, damage, tile? / targetRoomId, alive }
```

`Fx`：

```js
{ id, kind:'damage'|'text'|'reaction'|'skill', space:'tile'|'door'|'boss'|'screen',
  x, y, text, color, bornAt, ttl }
```

- `state.events` 保留最近 12 条；`state.fx` 保留最近 40 条。渲染端只读。
- 所有时间单位秒；`now` 由控制器/`step` 累加。

## 游戏规则摘要（实现判据）

- **目标**：活到 `dawnAt` 秒，或击杀全部活跃梦魇。气密门 HP≤0 立即失败。
- **准备阶段**：可以建造/升级；`prepRemaining` 归零进入夜晚，梦魇在 `spawnAt` 苏醒。
- **资源**：冷凝床产梦能；层析仪产试剂；取款机把相邻炮台伤害转化为梦能（有每秒上限）。
- **建造**：房间格子不同；床占 2×2、门在外墙、起始道具已占据一格。除 `accelerator`/`atm`（maxCount=2）外，所有建筑不设数量上限，只受格子、资源限制。
- **酸系**：`acidUnlocked` 为全局解锁阶段。可建造任意已解锁阶段；每座酸塔可升 I–III。塔到 III 后可花费资源“进阶/研究”，提升全局解锁并让该塔进入下一阶段 I。新塔可直接从已解锁阶段开始。
- **氯酸钾 / 苯**：各自 1–10 级；可多座；等级独立。
- **设备**：1–3 级；除加速器/取款机外不限数量。
- **梦魇等级**：全局压力 1–14，技能在 3/6/9/12/14；Lv14 终焉后不再升级。噩梦难度在 04:00 追加第二只不同类型的梦魇。
- **难度**：简单/普通单魇，噩梦双魇；数值见 `DIFFICULTIES`。
- **舍友**：5 名 AI 舍友各有门/火力/威胁，会被梦魇淘汰；他们的火力也会伤害梦魇。
- **反应链**：相邻满足条件自动激活，见 `REACTIONS`；至少包含催化氧化、低温凝析、电磁淬火、爆鸣氧化、芳烃共振、中和屏障。
- **平衡目标**：普通难度通关率 60–75%；避免开场无解、隐藏克制、永久控制；具体曲线由 Lead 调参。

## 开发约定

- 全部中文文案；代码标识符用英文。
- 不引入第三方库、字体文件、外部图片或音频 URL；所有美术用 Canvas/CSS/SVG 程序化生成，音频用 WebAudio 合成。
- 不修改 `package.json` 依赖；不执行 network 请求。
- 不改动他人目录；接口变更先报告 Lead。
- 完成后运行 `npm test`（或 `node --test tests/`）并在 `state` 中保留调试标记便于截图。
