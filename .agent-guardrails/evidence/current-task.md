# v1.0.0 发布验证记录

## 范围与方案

从固定提交 75c3e7d75447e895497d442ccb2e905295b14e7d 单独克隆。
游戏现有模式是零依赖的 HTML + CSS + ES Modules；保留原结构，用 .nojekyll 托管。
原开发目录和 8787 服务未修改，1.1 的工作区改动未纳入发布。
计划托管于公开仓库 9947447-alt/Horrible-Drom，Pages 固定 release/v1.0，标签 v1.0.0。

## 已执行验证

- QA_URL=http://127.0.0.1:8788 npm test：35 通过，0 失败，0 跳过，含真实 Chrome E2E。
- npm run check：通过。
- 基线差异检查：src、styles、index.html、package.json、tests 无改动。
- 初步凭据扫描未命中私钥、GitHub token、API key 或硬编码密码。

## 风险与边界

- 安全：发布用户要求的游戏到公开 GitHub / Pages；沿用已登录 GitHub CLI，凭据不写入仓库。游戏本地存档不上传。
- 依赖：未增加生产/开发包依赖，无锁文件变化。agent-guardrails 0.21.0 仅用于本次本地检查。
- 性能与可访问性：运行资源及 HTML 无变化，没有新增网络依赖，页面体积与交互语义保持原样。
- 连续性：源码、样式和测试沿用 1.0 基线；使用单独 Pages 分支，防止后续 main 开发覆盖 1.0。
- 线上构建与真实浏览器验证将在推送后执行，未在此预先宣称通过。

## Review notes

发布差异仅为 .nojekyll、README、版本文档与仓库规则要求的 guardrail 配置/记录。
首次检查发现任务契约未列出 bootstrap 必需文件，且类型名称需使用工具实际支持的 docs、guardrails-internal、other；已按九个准确文件修正契约，没有扩展游戏代码范围或关闭检查。
顶层目录广度来自托管标记、文档与检查设施；PROJECT_STATE.md 只是项目状态文档，不是游戏状态管理源码。
保护区域 index.html 以及 src、styles、package.json、tests 均未修改。

最终本地发布检查：npx agent-guardrails check --base-ref HEAD~1 --commands-run "QA_URL=http://127.0.0.1:8788 npm test,npm run check" --review 通过（90/100，0 error，3 warning）。
三条提示涉及发布设施跨顶层路径，以及把 docs/PROJECT_STATE.md 误识别为游戏状态管理；已人工核实都属于文档/发布范围。
