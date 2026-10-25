# v1.1.0 发布验证记录

## 范围与现有模式

发布 DS 固定提交 e2f979963d3027e8c3f502637d752ca6149e1651（包版本 1.1.0）。
沿用零依赖 HTML/CSS/ES Modules、.nojekyll 和固定版本 Pages 分支。
独立克隆并合并远程 main 的发布历史，原开发目录和服务不变。
仅更新 README、项目状态、发布说明及本验证记录/契约；src、styles、index.html、package.json、tests 与 DS 基线一致。

## 已执行命令与结果

- QA_URL=http://127.0.0.1:8788 npm test：50/50 通过，无失败/跳过，含真实 Chrome E2E。
- npm run check：通过。
- node src/render/selfcheck.mjs：385/385 通过。
- 隔离 cwd 执行现有 tools/qa/regress.mjs：187/187 通过，46 张截图，0 console error / exception / warning；输出留在 .git/qa-v1.1，未覆盖 DS 已提交报告。
- git diff e2f9799 -- src styles index.html package.json tests：无差异。
- 新入口真实浏览器检查：v1.1 菜单、每日日期/双修饰词选房页、四难度/十成就记录页正常。

## Review notes

使用 code-review-and-quality 技能检查测试意图、控制器/模拟层/存储和 UI 对接、输入编码与依赖。未发现阻断启动/核心游玩的发布问题。
发现并确认两项非阻断随机一致性问题：控制器每日预览使用 Math.random 并覆盖日期种子预览；求援接收者抽签消费战斗 RNG。保留 DS 原实现，后续修复建议与限制已写入 docs/RELEASE-1.1.md。

## 风险与回退

- 安全：沿用已授权 GitHub CLI 身份；无凭据进入仓库，无新增外部数据流，本地存档不上传。
- 依赖：无新增生产/开发依赖、无锁文件变化。仅使用已有本地检查工具。
- 性能/a11y：发布步骤未改运行代码/样式/语义；既有浏览器回归的响应式和渲染检查通过，不构成全平台性能保证。
- 连续性：整合已有发布历史，保持 1.0 标签和发布分支固定；新版本使用 release/v1.1。
- 线上验证待推送后进行；尚未宣称线上完整对局或平衡验证。
