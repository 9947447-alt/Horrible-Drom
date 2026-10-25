# Agent 工作规则

写入前阅读本文件、docs/PROJECT_STATE.md、README.md 和目标文件。

非平凡任务先运行 npx agent-guardrails plan；如果存在 .agent-guardrails/task-contract.json，遵守允许路径、要求命令和验证记录约束。

保持修改小且易于审查，复用现有模式；保留已有用户改动。
1.0 发布边界见 docs/RELEASE-1.0.md。未经用户明确要求，不移动 release/v1.0 或重新打 v1.0.0 标签。

完成前更新 .agent-guardrails/evidence/current-task.md，真实记录测试、风险与剩余限制，并运行：

```bash
npx agent-guardrails check --base-ref HEAD~1
```

检查发现问题应先修复，不得宣称完成；命令不存在时提示先运行 npx agent-guardrails setup。
需要的检查必须真实执行，行为变化应有适当测试。报告实际结果，禁止以改弱测试或检查规则制造通过。
