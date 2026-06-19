---

## 远景：v2.1 通用化（优先级：低，列入长期规划）

### 目标
将 Sentinel 从 OpenClaw 专属插件解耦为标准 AI Agent 安全中间件，支持任何 Agent 框架集成。

### 核心思路

当前耦合点：
- `definePluginEntry()` 是 OpenClaw 专属
- `api.on("before_tool_call")` 依赖 OpenClaw hook
- `detectWorkspace()` 依赖 OpenClaw 环境变量
- `api.logger` 是 OpenClaw 专属

### 三个交付形态

| 形态 | 适用场景 | 部署方式 |
|------|---------|---------|
| `@sentinel/core` | 任何 JS/TS Agent 框架 | npm 包，import 即用 |
| Sentinel Sidecar | 非 JS Agent（如 Python CrewAI） | Docker 容器 + HTTP API |
| Sentinel Plugin | OpenClaw | 当前形态，继续维护 |

### 核心改造

| 改造点 | 当前 | 目标 |
|--------|------|------|
| 入口 | definePluginEntry() | export { SentinelCore, createSentinel } |
| 拦截 | api.on("before_tool_call") | POST /intercept HTTP API |
| 审计 | fs.appendFileSync 写 workspace | writable audit store interface |
| 配置 | openclaw.plugin.json | .agentos/config.yaml 独立配置 |
| 日志 | api.logger | std logger interface |

### 工期（远期）：4周，优先级低于 v1.1-v2.0
