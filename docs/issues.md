# AgentOS 问题待办清单

> 从 AgentOS 接入和运行中收集的问题，按优先级排列

## P0 — 影响核心功能

| # | 问题 | 现象 | 影响 | 方案 |
|---|------|------|------|------|
| 1 | **stats 统计 byTool 大量 undefined** | `byTool: { exec: 1, undefined: 39 }` | 统计不准，undefined 操作无法分类 | ✅ **已修** plugin hook 写入改为 `toolName` + AgentOS audit-log.ts 兼容 `tool` fallback |
| 2 | **profile totalOps 显示 0** | `totalOps: 0` 但 stats 里是 40 | 质量评分不更新 | ⏳ 需要 Evaluator pipeline 在轻量模式下也记录 metric（需额外开发），短期内不影响使用 |

## P1 — 影响数据质量

| # | 问题 | 现象 | 影响 | 方案 |
|---|------|------|------|------|
| 3 | **audit.jsonl 两种格式混杂** | 轻量行 + 完整行混在一个文件里 | 后续分析/回滚功能可能出错 | ✅ **已修** plugin hook 写入统一为 `toolName` + `stage: "light"` 标记，数据可同时支持两种读取 |
| 4 | **profile warning 假阳性** | "High retry rate" / "Low verify pass rate" 实际不存在 | 误导判断 | 初始化时不要预设 warning，等真实数据积累后再生成 |

## P1 — 影响数据质量

| # | 问题 | 现象 | 影响 | 方案 |
|---|------|------|------|------|
| 11 | **记忆系统未同步到 memory_search** | Agent 启动后 memory_search 搜不到 agentOS 记忆（Semantic/Episodic） | 每次重启 agentOS 记忆对 Agent 不可见，无法利用历史上下文 | session_end 时将 getSearchableSnapshot() 写入 workspace/memory/agentos-memory.md，同步到 OpenClaw 索引范围 |

## P1 — 影响数据质量（续）

| # | 问题 | 现象 | 影响 | 方案 |
|---|------|------|------|------|
| 11 | **记忆系统未同步到 memory_search** | Agent 启动后 memory_search 搜不到 agentOS 记忆（详见上午记录） | 每次重启 agentOS 记忆对 Agent 不可见 | ✅ **已修** endSession() 中写入 workspace/memory/agentos-memory.md |
| 12 | **双端确认同步** | 需要确认的操作仅在电脑端弹窗，微信端无法同步操作 | 人不在电脑旁时无法及时确认/拒绝操作 | 待设计：pending 队列持久化 + 微信消息带操作ID + 任一端确认后同步取消另一端 |

## P2 — 增强和优化

| # | 问题 | 现象 | 影响 | 方案 |
|---|------|------|------|------|
| 5 | **语义规则里有过时的 preCheck/postCheck 引用** | 已清理 ✅ | — | — |
| 6 | **episodic 记录了所有 exec 命令原文** | 包括自己查自己(如 `npx sentinel-agentos stats`) | 噪音多，记忆不精准 | 跳过 `sentinel-agentos` 自身命令、`echo` 无意义命令 |
| 7 | **session_start hook 注入的上下文不够突出** | 规则列表太长，Agent 不一定注意到关键规则 | 重要规则可能被忽略 | 把 P0 级规则（如 "npm publish 前确认版本号"）提到最前面 |
| 8 | **缺少自动清理 cron** | episodic 10KB / audit 10KB 今天刚开始 | 长时间跑会膨胀 | 加周度压缩 + 月度 rotate 的 cron 定时器 |
| 9 | **semantic.json 编辑脆弱** | 手动编辑 json 可能破坏格式 | 加 CLI 命令 `rule add/delete/list` | 加 CLI 命令 |
| 10 | **profiler overallScore NaN** | 之前有 NaN 记录，需验证是否修复 | 可能影响评分 | 复查 profiler 代码，确认 v0.3.10 已修复 |

## 已修复

| # | 问题 | 修复 |
|---|------|------|
| ✅ | `sentinel.execute()` 不存在 | 改为 Plugin hook 自动拦截 |
| ✅ | Plugin 加载不了 | 用 `openclaw plugins install` 走 global 安装 |
| ✅ | 过时 preCheck/postCheck 规则 | 已从 semantic.json 删除 |
| ✅ | 测试日志残留 | 已清理 audit/episodic/feedback |
| ✅ | P0-1 stats byTool undefined | plugin 写入 `toolName` + audit-log 兼容 `tool` fallback |
| ✅ | P1-3 双格式混杂 | 统一 `toolName` + 加 `stage: "light"` 标记 |
