# Sentinel AgentOS Plugin

> OpenClaw 插件 — 确定性 Guard + 分层记忆 + 自动评估，框架层自动拦截所有 Agent 工具调用。

## 安装

```bash
npm install -g sentinel-agentos-plugin
openclaw plugins install sentinel-agentos-plugin
openclaw gateway restart
```

> `sentinel-agentos` 核心包会自动安装为依赖，无需额外操作。

## 功能

安装后自动注册 3 个 OpenClaw hook：

| Hook | 优先级 | 功能 |
|------|:--:|------|
| `before_tool_call` | P100 | 危险命令拦截(9 pattern)、敏感文件拦截(16 pattern)、保护文件确认(11 pattern)、JSON/YAML 语法校验 |
| `after_tool_call` | P90 | 异步轻量审计、episodic memory 记录、feedback 信号、circuit breaker 熔断 |
| `session_start` | — | 注入 Semantic Memory 上下文到 Agent prompt |

## 验证

```bash
openclaw plugins list | grep sentinel-agentos
npx sentinel-agentos status
npx sentinel-agentos stats
```

## 卸载

```bash
openclaw plugins uninstall sentinel-agentos
npm uninstall -g sentinel-agentos-plugin sentinel-agentos
```

## 依赖

- OpenClaw >= 2026.6.6
- [sentinel-agentos](https://www.npmjs.com/package/sentinel-agentos) >= 0.3.10
