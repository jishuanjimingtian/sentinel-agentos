

--- 续：智能审批改造方案 ---

## Sentinel 增值能力总览

| 能力 | 版本 | 一句话 | 状态 |
|------|------|--------|------|
| 智能审批 | v1.4 | 基于置信度的行为学习 | 已设计 |
| 访问控制 | v1.5 | Agent 只在允许区域工作 | 已设计 |
| 工作区维护 | v1.5 | 自动巡检 + 整理碎片 | 已设计 |
| 价值分析 | v1.6 | 日报 + 热力图 + 效率建议 | 规划中 |

---

## 访问控制 (Access Control Zones)

### 目标

限定每个 Agent 只能在自己的工作区域内读写，防止 Agent 误操作越界破坏。

### 核心规则

| 规则 | 说明 |
|------|------|
| 项目隔离 | coderev Agent 只能操作 projects/coderev/** |
| 共享区域 | output/ 所有 Agent 可写 |
| 记忆保护 | memory/ 只主 Agent 可写，其他 Agent 只读 |
| 配置保护 | .agentos/ 只 Sentinel 自身可写 |
| 根目录清理 | workspace 根目录不允许放项目文件 |
| 默认拒绝 | 未知 Agent 或未配置路径 → 不可写 |

### 配置文件 (.agentos/workzone.json)

```json
{
  "version": 1,
  "zones": {
    "main-agent": {
      "agentId": "main",
      "writable": ["**"],
      "readonly": [],
      "blocked": []
    },
    "coderev-bot": {
      "agentId": "coderev-cron",
      "writable": ["projects/coderev/**", "output/**"],
      "readonly": ["memory/**", "reports/**"],
      "blocked": ["plugins/**", ".agentos/**", "MEMORY.md", "SOUL.md"]
    },
    "default": {
      "agentId": "*",
      "writable": ["output/**"],
      "readonly": ["*.md", "docs/**"],
      "blocked": ["**"]
    }
  },
  "rootPolicy": {
    "allowFiles": ["AGENTS.md", "SOUL.md", "MEMORY.md", "USER.md", "TOOLS.md", "HEARTBEAT.md"],
    "projectFilesMustBeInProjects": true,
    "scriptsMustBeInScripts": true
  }
}
```

### 违规处理

| 违规类型 | 处置 | 提示 |
|---------|------|------|
| Agent 写入 blocked 区域 | block | "coderev-bot 不能修改 plugins/sentinel/" |
| 根目录创建项目文件 | requireApproval | "项目文件应放在 projects/ 下，确定创建？" |
| 未知 Agent 写入 | requireApproval | "未知 Agent 尝试写文件，确认身份？" |
| Agent 写保护文件 | block | "MEMORY.md 只允许主 Agent 修改" |

---

## 工作区维护 (Workspace Tidying)

### 目标

自动发现工作区碎片、过期文件、错位文件，建议或自动整理。

### 巡检规则

| 巡检项 | 判断条件 | 动作 | 风险 |
|--------|---------|------|------|
| 临时脚本 | `.cjs`/`.js` 文件名含 fix_/temp_/apply_/gen-，24h未修改 | 移到 .trash/ | 低 |
| 空文件 | 文件 0 字节 | 移到 .trash/ | 无 |
| 空目录 | 目录为空，7天未修改 | 删除 | 无 |
| 错位项目文件 | 根目录下的 `.ts`/`.json`/`.md` 属于项目但放错位置 | 建议移到 projects/ | 中(需确认) |
| 过期备份 | openclaw.json.bak.* 超过 10 个 | 保留最新 3 个 | 低 |
| 过期输出 | output/ 下文件超过 30 天 | 移到 .trash/archive/ | 低 |
| 碎片 md | 根目录下超过 3 个独立 .md 文件 | 建议归入 docs/ 或 memory/ | 中(需确认) |
| 孤立依赖 | node_modules/ 在非项目目录 | 建议删除 | 中(需确认) |

### 配置 (.agentos/tidy.json)

```json
{
  "version": 1,
  "schedule": "daily",
  "autoClean": ["empty-files", "temp-scripts", "expired-backups"],
  "requireApproval": ["misplaced-projects", "fragmented-docs", "orphan-deps"],
  "trashDir": ".agentos/.trash",
  "trashRetentionDays": 30,
  "ignorePatterns": ["node_modules/**", ".git/**"]
}
```

### 操作方式

| 命令 | 效果 |
|------|------|
| `sentinel tidy --dry-run` | 只列出建议，不执行 |
| `sentinel tidy --auto` | 自动执行低风险清理 |
| `sentinel tidy --interactive` | 逐项确认 |

### 每日自动巡检

在 session_start 时跑一次轻量扫描（只检测低风险项），生成报告但不自动执行。

---

## 根目录策略 (Root Policy)

### 允许在 workspace 根目录存放的文件

| 文件 | 说明 |
|------|------|
| AGENTS.md | Agent 操作手册 |
| SOUL.md | Agent 人格定义 |
| MEMORY.md | 长期记忆 |
| USER.md | 用户档案 |
| TOOLS.md | 工具配置 |
| HEARTBEAT.md | 心跳任务 |
| IDENTITY.md | Agent 身份 |

### 不允许在根目录的文件

| 类型 | 示例 | 应放在 |
|------|------|--------|
| 项目源码 | .ts, .js, .py | projects/<项目名>/ |
| 配置备份 | openclaw.json.bak.* | .agentos/backups/ |
| 临时脚本 | fix_*.js, apply_*.cjs | .agentos/scripts/ 或删除 |
| 生成文档 | *.docx, *.pdf | output/ 或 docs/ |
| 日志文件 | *.log, *.jsonl | .agentos/ |
| 依赖目录 | node_modules/ | 各项目目录内 |

---

## 实现计划

| 阶段 | 功能 | 版本 | 时间 |
|------|------|------|------|
| 1 | 根目录策略 + 违规检测 | v1.5 | 1周 |
| 2 | Agent 工作区隔离 (workzone.json) | v1.5 | 1周 |
| 3 | 每日自动巡检 + dry-run | v1.5 | 0.5周 |
| 4 | 一键整理 (tidy --auto) | v1.5 | 0.5周 |
