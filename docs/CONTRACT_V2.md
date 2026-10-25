# v2.1 契约：室友网络 + 值班记录 + 每日挑战

本文件是 `docs/CONTRACT.md` 的增补；v1 契约仍然有效。

## 范围

1. **室友网络（A）**：5 位舍友有性格、求援、亲密度、遗物回收与可见回馈。
2. **值班记录/成就（D1）**：记录页、成就解锁、结算显示新成就。
3. **每日挑战（D2）**：固定日期种子 + 2 个修饰词，独立记录。
4. 不做：房间独有规则、新装置、酸系分支、皮肤（留 v2.2+）。

## 内容 `src/content/social.js`

已导出：

- `ROOMMATE_TRAITS`：id → `{name, desc, request:{title,text,cost,reward,rewardLabel}, bondLine}`
- `RELIC_REWARDS`：遗物奖励池
- `ACHIEVEMENTS` / `ACHIEVEMENT_LOOKUP`
- `DAILY_MODIFIERS` / `DAILY_LOOKUP`
- `getDailyPlan(date)` → `{key, seed, modifierIds, modifiers, label}`
- `getDailyEffects(modifierIds)` → `{economyMult, doorHpMult, dawnBonus, nightmareHpMult}`

## GameState 新增

```js
state.mode = 'classic' | 'daily'
state.daily = null | {
  key, seed, modifierIds, label
}
state.dailyEffects = { economyMult, doorHpMult, dawnBonus, nightmareHpMult }
state.roommates[i] = {
  ...v1 fields,
  trait: 'economist'|'gunner'|'turtle'|'chemist'|'lucky',
  bond: 0..3,
  request: null | {
    id, trait, title, text,
    cost: { dream, reagent },
    rewardLabel,
    expiresAt,   // state.now 秒
    reward: { kind, value }
  },
  relic: null | {
    id, label, color, reward: { kind, min/max? or value }, cost: { reagent }
  }
}
state.stats = {
  ...v1,
  roommateSupports: 0,   // 接受的求援次数
  relics: 0              // 回收遗物次数
}
```

## 模拟层 API 增补

### createRun 选项

```js
createRun({
  roomId, difficulty, seed, settings, nightmareId, secondaryNightmareId,
  mode: 'classic' | 'daily',
  daily: null | { key, seed, modifierIds, label }  // 由 controller 传入
})
```

- 每日挑战以 `difficulty:'normal'` 为基础，使用 `daily.seed` 作为 seed；`state.mode='daily'`。
- 应用 `getDailyEffects(modifierIds)`：
  - `economyMult`：床与层析仪收入乘数。
  - `doorHpMult`：初始气密门最大耐久（以及初始 HP）乘数。
  - `dawnBonus`：`dawnAt += dawnBonus`。
  - `nightmareHpMult`：梦魇最大生命/当前生命乘数（recompute 时应用）。
- 每日记录/成就由 controller 处理，模拟层只提供 stats 和 state.daily。

### 室友网络

- 求援生成：
  - 首次约 45–55 秒（失败后间隔约 40–55 秒），仅夜晚；
  - 同一时间全局最多 1 个 request；
  - 从存活的室友中按 trait 生成模板；
  - `expiresAt = now + 18` 秒；过期自动忽略，不惩罚资源。
- 接受 `answerRoommateRequest(state, accept)`：
  - accept=true 时检查/扣除 cost，`bond = min(3, bond+1)`，`stats.roommateSupports++`；
  - 应用 reward：
    - `dream` / `reagent`：直接加资源；
    - `roommateOffense`：该室友 offense 永久 +value；
    - `doorHealPct`：玩家门回复最大耐久百分比；
    - `lucky`：随机从 dream/reagent/doorHealPct 中选一个，值在合理区间，生成 result 供事件文案；
  - 顺带修复该室友门的 8%（让“支援”有世界反馈）；
  - 清空 request、安排下一次求援、发 `kind:'radio'` 事件与 fx。
  - accept=false：清空 request、安排下一次求援，发温和事件，不扣资源。
- 舍友淘汰时：
  - 生成 `relic`，奖励池随机；遗物不消失直到被回收或本局结束；
  - 发 `kind:'relic'` 事件。
- `collectRoommateRelic(state, roommateId)`：
  - 花费 8 试剂（bond>=2 时 4），应用遗物奖励，`stats.relics++`，清空 relic，发事件/fx。
- 求援/遗物不得在 prep 或已结束阶段生效；无效操作返回 `{ok:false,error:'中文原因'}`。
- 所有新增数值都集中在 `src/content/social.js` 或 `src/game` 常量；不改 v1 内容平衡。

### 每日挑战 UI 任务

- controller `startDaily()` 使用 `getDailyPlan()`；`state.daily` 会传入。
- UI 负责展示每日修饰词；选房后调用 `selectRoom`。
- 模拟层不得依赖 UI；每日种子/修饰词全部走 state。

## 成就（controller 计算，不改模拟层）

controller 在结算时根据 `state`/`state.result` 计算新成就，合并进 `records.achievements`，设置 `state.newAchievements`（字符串数组），saveSave。成就定义见 `ACHIEVEMENTS`。

判定：

- `first_dawn`：胜利
- `nightmare_clear`：噩梦难度胜利
- `night_banisher`：胜利且 reason 不含“天亮”
- `no_repair`：胜利且 `stats.repairs===0`
- `reaction_six`：胜利且 `stats.reactions>=6`
- `roommate_savior`：`stats.roommateSupports>=3`
- `relic_hunter`：`stats.relics>=2`
- `pressure_14`：胜利且 `pressure.level>=14`
- `daily_clear`：`mode==='daily'` 且胜利

## 值班记录

`records` 增补：

```js
records.achievements = { [id]: timestamp }  // 已解锁
records.daily = { [key]: { runs, wins, bestNight, bestGrade } }
```

UI 记录页需要展示：

- 总场次/胜场/最佳夜钟；
- 三难度各自 runs/wins/bestNight；
- 每日挑战当日记录；
- 9 个成就的解锁态与说明。

## UI actions 增补

```js
startDaily()
answerRoommateRequest(accept)
collectRoommateRelic(roommateId)
goRoomSelect() // 现有；mode 由 controller 内部保持
```

UI 不得直接修改 state。

## 验收

- `node --test` 全绿；新增室友/每日/成就测试。
- 187 项浏览器回归保持通过；新增路径加测试。
- 每日挑战有固定日期文案、两个修饰词显示、独立记录。
- 室友求援接受/忽略/过期、遗物回收、bond 至少基本可用；不阻断核心战斗。
- 每日/室友功能均为可选，不改变 v1 普通难度平衡目标。
