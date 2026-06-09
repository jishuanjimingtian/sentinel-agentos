# AgentOS 今日计划 — 2026-06-09

- 当前阶段: Phase 0 — 项目初始化
- 推荐任务: 0.1 + 0.2 + 0.3 — 创建项目结构 + ESLint/Prettier + Jest 配置
- 理由:
  1. 设计文档（DESIGN.md、架构文档、任务清单）三大件已全部写完，今天上午 10:37 刚更新
  2. 但项目目录一行代码没有（无 .ts/.json 文件），Phase 0 零进度
  3. Phase 0 预计只需 0.5 天（4h），全部 5 个子任务可以在一个下午搞定
  4. 做完 Phase 0 才能进入 Phase 1（Schema Gate），这是所有后续的物理基础
  5. 下午块状时间（2-5pm），适合一次性跑通脚手架
- 具体要做:
  1. 初始化 npm 包 @agentos/core，TypeScript 严格模式，tsc --noEmit 通过
  2. 配置 ESLint + Prettier，eslint --quiet 通过
  3. 配置 Jest 测试框架，npx jest 跑通 1 个示例测试
- 预计工时: 3-4 小时（5 个子任务总计 4h，实际有并行空间）
- skip: true（老板决定今天到此为止，明天继续 Phase 1）
- 备注: 今天定时器改造完成，AgentOS ① 首次 isolated 跑通(400s)，Phase 0 实际代码产出待明天
