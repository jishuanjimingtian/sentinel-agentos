# AgentOS

> **AI Agent 操作系统** — 确定性 Guard 层 + 分层记忆 + 自动评估，让任何 Agent 变得可靠、可审计、可改进。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-99%2F99-brightgreen)](https://github.com/jishuanjimingtian/agentos/actions)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

---

## 🤔 为什么需要 AgentOS

AI Agent 面临五大核心问题，现有框架都没能真正解决：

| 痛点 | 现状 | AgentOS 方案 |
|------|------|-------------|
| 🔴 **幻觉导致错误操作** | Prompt 里说"请不要删除重要文件"——这是愿望，不是约束 | Guard 层确定性校验，不依赖 LLM 判断 |
| 🔴 **越权/危险操作** | 无分级控制，要么全禁要么全放 | Risk Gate 四维数学公式，0-100 自动分级 |
| 🔴 **记不住、记不对** | 本质是"把对话扔进向量库"，只有检索没有理解 | 三层记忆架构，像人脑一样自动评级、压缩、遗忘 |
| 🔴 **出事查不到原因** | Agent 做了什么、为什么做、做对了没——全不可追溯 | 每次操作前后 diff 记录，JSONL 不可篡改审计日志 |
| 🔴 **不知道 Agent 好不好** | 最多有个 success rate 计数器 | 三阶段自动评估 + 隐性反馈捕获 + 质量画像 |

---

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        AgentOS 架构                              │
│                                                                  │
│  任意 Agent 框架（OpenClaw / LangChain / CrewAI / 自研）          │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    AgentOS 内核                             │  │
│  │                                                             │  │
│  │  ┌─────────┐   ┌──────────┐   ┌────────────┐              │  │
│  │  │  Guard  │   │  Memory  │   │  Evaluator │              │  │
│  │  │  层     │   │  层      │   │  层        │              │  │
│  │  ├─────────┤   ├──────────┤   ├────────────┤              │  │
│  │  │ Schema  │   │ Working  │   │ Pre-exec   │              │  │
│  │  │  Gate   │   │ Memory   │   │ Evaluator  │              │  │
│  │  │    ↓    │   │    ↓     │   │     ↓      │              │  │
│  │  │ Risk    │   │ Episodic │   │ Runtime    │              │  │
│  │  │  Gate   │   │ Memory   │   │ Evaluator  │              │  │
│  │  │    ↓    │   │    ↓     │   │     ↓      │              │  │
│  │  │ Snapshot│   │ Semantic │   │ Post-exec  │              │  │
│  │  │  Gate   │   │ Memory   │   │ Evaluator  │              │  │
│  │  │    ↓    │   └──────────┘   │     ↓      │              │  │
│  │  │ Verify  │                  │ Feedback   │              │  │
│  │  │  Gate   │                  │ Engine     │              │  │
│  │  │    ↓    │                  │     ↓      │              │  │
│  │  │ Audit   │                  │ Profiler   │              │  │
│  │  │  Log    │                  └────────────┘              │  │
│  │  └─────────┘                                              │  │
│  │                                                             │  │
│  │  ┌─────────────────────────────────────────────────────┐   │  │
│  │  │               Sandbox Executor 沙箱                  │   │  │
│  │  │         (direct / sandbox / dry-run)                 │   │  │
│  │  └─────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│              ┌───────────────┴───────────────┐                   │
│              ▼                               ▼                   │
│        安全执行                            可靠记忆               │
│        全程审计                            持续改进               │
└─────────────────────────────────────────────────────────────────┘
```

### 设计哲学

| 原则 | 含义 | 反例 |
|------|------|------|
| **确定性优先** | 能不用 LLM 就不用，用确定性代码实现 | 用 LLM 做安全判断 |
| **可审计优先** | 所有操作可追溯、可回滚、可解释 | Agent 操作后无日志 |
| **渐进增强** | 框架无关，可增量接入，不要求替换现有架构 | LangChain 的强绑定 |

### 不是 Agent，是 Agent 的操作系统

| 类比 | 对应 |
|------|------|
| 应用程序 | 任意 Agent 框架 |
| 操作系统 | AgentOS |
| 内核 | Schema Gate + Risk Gate（确定性代码，零 LLM 依赖） |
| 文件系统 | 分层 Memory Store |
| 日志系统 | 操作级审计日志（不可篡改，支持回滚） |
| 性能监控 | Evaluator 三阶段评估 |

---

## ✨ 功能介绍

### 🛡️ Guard 层（6 个组件，零 LLM 依赖）

#### Schema Gate — 参数格式校验

在 tool call 执行前拦截无效调用。支持 **10 种校验**：

| 校验项 | 说明 | 示例 |
|--------|------|------|
| 必填参数 | 字段必须存在 | `delete_file` 必须提供 `path` |
| 类型检查 | string/number/boolean/object/array | `path` 必须是 string |
| 允许值 | 枚举约束 | `mode` 只能是 `read`/`write`/`append` |
| 数值范围 | min/max | `max_tokens` 必须在 1-100000 |
| 长度范围 | 字符串/数组长度 | `query` 至少 3 个字符 |
| 正则匹配 | 格式校验 | `email` 必须符合邮箱格式 |
| 路径约束 | 路径在 workspace 内 | 不能写系统目录 |
| 路径白名单/黑名单 | 允许/禁止的文件模式 | 禁止 `.env`、`.key`、`.pem` |
| 参数依赖性 | 如果 `auto_merge=true` 则 `base_branch` 必填 | |
| 参数互斥 | `content` 和 `file_path` 不能同时存在 | |
| 参数大小 | 内容不超过指定字节数 | `content` ≤ 1MB |
| 敏感标记 | 标记为 secret，日志中自动脱敏 | |

#### Risk Gate — 风险分级

四维数学公式，零 LLM：

```
RiskScore = Impact × (1 - Reversibility) × Sensitivity × (1 + ErrorRate)
```

| 分数区间 | 动作 |
|----------|------|
| ≤ 0.5 | 🟢 自动放行 |
| ≤ 1.0 | 🔵 执行后通知 |
| ≤ 3.0 | 🟡 暂停等待用户确认 |
| > 8.0 | 🔴 直接拒绝 |

#### Snapshot Gate — 执行前快照

只记录文件 SHA-256 hash + git 状态，不做全量备份，极快。

#### Verify Gate — 执行后校验

**8 项确定性校验**，检测 Agent 幻觉：

| 校验项 | 说明 |
|--------|------|
| 文件存在性 | Agent 声称创建了文件 → `fs.existsSync()` 验证 |
| 文件变更 | 对比快照 hash，确认文件真的改了 |
| Lint 通过 | 代码文件 → ESLint 验证 |
| TypeCheck | TypeScript 文件 → `tsc --noEmit` 验证 |
| 格式合法 | 声称返回 JSON → 真解析验证 |
| 返回值非空 | 不应为空但为空 → 标记 WARN |
| npm 发布 | 声称发布成功 → `npm view` 真实验证 |
| git push | 声称推送成功 → `git ls-remote` 对比 |

#### Audit Log — 不可篡改审计

追加写入 JSONL 文件，每次操作前后完整记录（Schema + Risk + Snapshot + Verify + Diff）。支持按 session/tool/status 查询。

#### Rollback — 回滚

基于 Snapshot + Git 自动回滚。Verify Gate FAIL + 高风险 → 自动触发。

#### Sandbox Executor — 沙箱执行

三种模式：
- **direct**：直接执行（默认）
- **sandbox**：受限执行，支持网络策略（none/localhost/whitelist）和文件系统策略（writablePaths/readonlyPaths）
- **dry-run**：预览模式，不实际执行

内置危险命令检测（`rm -rf /`、`sudo`、fork bomb、`curl|bash` 等）。

---

### 🧠 Memory 层（3 层，像人脑一样记忆）

```
Working Memory  →  Episodic Memory  →  Semantic Memory
──────────────────────────────────────────────────────
当前会话         →  跨会话事件线      →  永久知识
1 session 存活   →  数周-数月存活     →  永久存活
< 50KB           →  < 500KB          →  < 100KB
```

| 层 | 用途 | 关键能力 |
|----|------|---------|
| **Working Memory** | 当前会话实时上下文 | 消息/任务/工具缓存/打开文件/token 预算管理 |
| **Episodic Memory** | 跨会话事件时间线 | 9 种事件类型、自动重要性评分、渐进压缩（full→summary→one-liner→forgotten）、JSON 持久化 |
| **Semantic Memory** | 提炼后的永久知识 | 用户偏好/事实、项目上下文、学习到的规则（置信度）、术语表 |

#### Session 启动上下文注入

新 session 自动从 Semantic + Episodic 注入最相关上下文：

```
[AgentOS Memory Context]
你正在帮助用户"老板"处理项目"coderev"。
上次会话中你们讨论了 Guard 层的设计方案。
关键提醒：
- 老板偏好直接、不说废话的沟通方式
- 发布 npm 前必须更新 CHANGELOG.md
- 上次你犯了 X 错误，老板纠正为 Y
```

---

### 📊 Evaluator 层（三阶段 + 隐性反馈）

#### 三阶段评估

```
Pre-exec 评估  →  Runtime 评估  →  Post-exec 评估
    ↓                ↓                ↓
参数质量          重试次数          验证结果
风险分数          自适应评分        用户接受度
上下文利用        工具选择准确性     结果利用度
```

#### 隐性反馈捕获（核心差异点）

不靠"👍👎"，靠行为推断满意度：

| 用户行为 | 隐性信号 | 强度 |
|----------|---------|------|
| 用户删除了 Agent 创建的代码 | `user_deleted_code` | -0.8 |
| 用户打断了 Agent | `user_interrupted` | -0.6 |
| 用户修改了 Agent 输出 | `user_modified_output` | -0.5 |
| 用户重复了相同指令 | `user_repeated_instruction` | -0.3 |
| 用户立即继续对话 | `user_immediate_continue` | +0.3 |
| 用户说"做得好" | `user_explicit_approval` | +0.6 |
| 用户使用了 Agent 的结果 | `user_used_result` | +0.7 |
| 用户分享了 Agent 输出 | `user_shared_output` | +0.8 |

#### Agent 质量画像

自动累积生成，包含：综合评分、四维分解、趋势（改善/恶化）、警告、优点。

```
=== AgentOS Status Report ===

Quality Score: 85/100 📈
Total Operations: 156 (12 in last 24h)

--- Breakdown ---
Pre-Exec:   92/100
Runtime:    88/100
Post-Exec:  85/100
Satisfaction: 82/100

--- Audit ---
Total: 156 | Failures: 2 | High-Risk: 3

--- ⚠️ Warnings ---
- 2 verify failures in last 24h — review session #3

--- ✅ Strengths ---
- Excellent execution reliability
- Strong positive user feedback
```

---

## 📦 安装

```bash
npm install @agentos/core
```

⚠️ **npm 包尚未发布**，当前请从源码使用：

```bash
git clone git@github.com:jishuanjimingtian/agentos.git
cd agentos
npm install
npm test        # 99 tests, all passing
npm run build   # 编译到 dist/
```

---

## 🚀 使用说明

### 基础用法

```typescript
import { AgentOS } from 'agentos';

// 初始化
const aos = new AgentOS({
  workspaceRoot: process.cwd(),
  maxWorkingTokens: 50000,
  maxEpisodicSizeKb: 500,
});

// 设置记忆
aos.memory.semantic.setPreference('language', 'zh-CN');
aos.memory.semantic.addFact('用户在北京，偏好简洁沟通');
aos.memory.semantic.learnRule('提交前运行 npm test', 'session_1');

// 设置 Guard 规则
aos.guard.schema.registerRule({
  tool: 'write_file',
  required: ['path', 'content'],
  types: { path: 'string', content: 'string' },
  pathDeny: { path: ['.env', '*.key', '*.pem', '.git/**'] },
  maxSize: { content: 1048576 }, // 1MB
  secrets: ['content'],           // 日志中脱敏
});

// 执行前：校验 + 快照
const { preExec, snapshot } = aos.executePipeline({
  sessionId: 'session_1',
  agentId: 'main_agent',
  toolName: 'write_file',
  parameters: { path: 'src/main.ts', content: 'console.log("hello");' },
  affectedFiles: ['src/main.ts'],
});

// 检查风险
console.log(`Risk: ${preExec.riskScore.score} → ${preExec.riskScore.action}`);
// → Risk: 0.19 → auto

// 执行后：验证 + 审计
const result = aos.completeExecution({
  sessionId: 'session_1',
  agentId: 'main_agent',
  toolName: 'write_file',
  toolParameters: { path: 'src/main.ts', content: 'console.log("hello");' },
  toolResult: 'file written',
  snapshot,
  startTime: Date.now() - 500,
  endTime: Date.now(),
  retryCount: 0,
  wasSelfCorrected: false,
  hadTimeout: false,
  userAccepted: true,
  userProvidedEdit: false,
  resultWasUsed: true,
});

console.log(`Post-exec score: ${result.postExec.outcomeScore}`);
console.log(`Audit entry: ${result.auditEntry.id}`);

// 记录反馈
aos.recordFeedback('user_immediate_continue', 'session_1');

// 查看报告
console.log(aos.statusReport());
```

### 接入现有 Agent 框架

```typescript
// 你的 Agent 执行器里
import { AgentOS } from 'agentos';

const aos = new AgentOS({ workspaceRoot: process.cwd() });

async function safeToolCall(toolName: string, params: Record<string, unknown>) {
  const sessionId = getCurrentSessionId();

  // 1. Pre-exec: 校验 + 风险 + 快照
  const { preExec, snapshot } = aos.executePipeline({
    sessionId,
    agentId: 'my_agent',
    toolName,
    parameters: params,
  });

  if (preExec.riskScore.action === 'deny') {
    throw new Error(`Tool "${toolName}" rejected: risk score ${preExec.riskScore.score}`);
  }

  if (preExec.riskScore.action === 'confirm') {
    const approved = await askUserConfirmation(
      `Risk score ${preExec.riskScore.score}. Allow ${toolName}?`
    );
    if (!approved) return;
  }

  const startTime = Date.now();

  // 2. 执行
  const result = await yourActualToolCall(toolName, params);
  const endTime = Date.now();

  // 3. Post-exec: 验证 + 审计 + 画像更新
  return aos.completeExecution({
    sessionId,
    agentId: 'my_agent',
    toolName,
    toolParameters: params,
    toolResult: result,
    snapshot,
    startTime,
    endTime,
    retryCount: 0,
    wasSelfCorrected: false,
    hadTimeout: false,
    userAccepted: true,
    userProvidedEdit: false,
    resultWasUsed: false,
  });
}
```

### 使用沙箱

```typescript
import { SandboxExecutor } from 'agentos';

const sandbox = new SandboxExecutor({
  mode: 'sandbox',
  workspaceRoot: process.cwd(),
  timeoutMs: 30000,
  networkAccess: 'whitelist',
  networkWhitelist: ['api.github.com', 'registry.npmjs.org'],
  writablePaths: ['src/', 'tests/', 'dist/'],
  allowedTools: ['read_file', 'write_file', 'edit', 'exec'],
  forbiddenTools: ['rm', 'unlink', 'sudo'],
});

// Pre-flight 验证
const rejection = sandbox.validate('rm', { path: 'src/main.ts' });
// → { success: false, sandboxRejectReason: 'Tool "rm" is forbidden' }

// 执行
const result = await sandbox.execute('exec', {
  command: 'npm test',
  cwd: process.cwd(),
});
```

### 使用 API 层

```typescript
import { AgentOS, AgentOSAPI } from 'agentos';

const api = new AgentOSAPI(new AgentOS());

// Guard
api.guardRegisterRule({
  tool: 'delete_file',
  required: ['path'],
  pathScope: { path: 'workspace' },
});

// Memory
api.memorySetPreference('language', 'zh-CN');
api.memoryLearnRule('Never push directly to main', 'code_review_1');

// Pipeline
const result = await api.pipelineExecute({...});
const audit = api.auditQuery({ toolName: 'write_file', limit: 10 });

// Profile
const profile = api.getProfile();
const report = api.getStatusReport();

// Session
api.endSession('session_1');
```

---

## 📖 使用案例

### 案例 1：拦截危险命令

```typescript
const aos = new AgentOS();

const { preExec } = aos.executePipeline({
  sessionId: 's1', agentId: 'a1',
  toolName: 'exec',
  parameters: { command: 'rm -rf /home' },
});

console.log(preExec.riskScore);
// → { score: 9.18, action: 'deny', dimensions: { impact: 10, reversibility: 0, ... } }
// 🔴 自动拒绝！
```

### 案例 2：检测 Agent 幻觉

```typescript
// Agent 声称"写入了文件"，但实际没有
const { preExec, snapshot } = aos.executePipeline({
  sessionId: 's1', agentId: 'a1',
  toolName: 'write_file',
  parameters: { path: 'nonexistent/file.ts', content: 'code' },
});

// Agent 的 tool result 说成功了，但文件没被创建
const result = aos.completeExecution({
  ...,
  toolResult: 'file written successfully', // ← Agent 幻觉！
  snapshot,
  ...
});

console.log(result.postExec.verifyPassed); // → false
// Verify Gate 检测到文件不存在 → FAIL
```

### 案例 3：跨会话记忆

```typescript
// Session 1: 学到偏好
const aos1 = new AgentOS();
aos1.memory.semantic.setPreference('language', 'zh-CN');
aos1.memory.semantic.learnRule('测试前先编译', 'session_1');
aos1.endSession('session_1');

// Session 2: 自动注入
const aos2 = new AgentOS();
const context = aos2.injectContext();
console.log(context);
// [AgentOS Semantic Memory]
// ## Preferences
// - language: "zh-CN"
// ## Learned Rules
// - [50%] 测试前先编译
```

### 案例 4：隐性反馈驱动改进

```typescript
const aos = new AgentOS();

// 用户删除了 Agent 创建的代码
aos.recordFeedback('user_deleted_code', 's1');

// 用户连续3次修改 Agent 输出
aos.recordFeedback('user_modified_output', 's1');
aos.recordFeedback('user_modified_output', 's1');
aos.recordFeedback('user_modified_output', 's1');

const stats = aos.evaluator.feedback.stats();
console.log(stats);
// → { totalSignals: 4, positiveSignals: 0, negativeSignals: 4, averageStrength: -0.57 }

const profile = aos.getProfile();
console.log(profile.warnings);
// → ["User satisfaction declining — review recent sessions"]
```

### 案例 5：沙箱保护

```typescript
const sandbox = new SandboxExecutor({
  mode: 'sandbox',
  workspaceRoot: '/project',
  timeoutMs: 5000,
  networkAccess: 'none',           // 禁止网络
  writablePaths: ['src/', 'logs/'], // 只能写这两个目录
  forbiddenTools: ['rm', 'git_push'],
});

// 禁网 + 限路径 + 禁工具 → 三重保险
await sandbox.execute('exec', { command: 'npm test' });     // ✅ OK
await sandbox.execute('exec', { command: 'curl evil.com' }); // ❌ 网络被黑洞
```

---

## 🧪 测试

```bash
npm test
```

```
PASS tests/guard/schema-gate.test.ts       (21 tests)
PASS tests/guard/risk-gate.test.ts         (20 tests)
PASS tests/guard/snapshot-verify-audit.test.ts (17 tests)
PASS tests/memory/memory.test.ts           (29 tests)
PASS tests/core.test.ts                    (12 tests)
────────────────────────────────────────────────
Test Suites: 5 passed, 5 total
Tests:       99 passed, 99 total
```

---

## ⚠️ 常见问题

### Q: AgentOS 和 LangChain / CrewAI 什么关系？

AgentOS **不是竞争对手**，是基础设施层。LangChain/CrewAI 是 Agent 框架，AgentOS 是给它们提供安全、记忆、评估的操作系统。可以增量接入任何框架。

### Q: 为什么 Guard 层不用 LLM？

LLM 做安全判断 = 用问题制造者来解决问题。Schema 校验是纯工程数学——类型检查、范围检查、hash 对比——这些 LLM 反而做不好（会幻觉）。确定性代码 = 0 幻觉。

### Q: Memory 层和 RAG 有什么区别？

RAG = 把对话扔进向量库做检索。AgentOS Memory = 人脑模型：

- **Working** → 当前会话实时上下文
- **Episodic** → 自动重要性评分 + 渐进压缩（不重要的事最终遗忘）
- **Semantic** → 提炼后的永久知识

最重要的是：**AgentOS 会自动写入记忆，不需要 Agent 手动管理**。

### Q: 会不会很慢？

不会。Guard 层所有校验都是 `fs.existsSync()`、hash 对比、数学公式，每个校验 **< 1ms**。Snapshot 只记录 hash 不复制文件。整个流水线开销可忽略。

### Q: 能用在生产环境吗？

v1.0 已完成 100% 设计文档覆盖率、99 个测试全通过、TypeScript 严格模式。API 稳定，可以集成。但建议先在测试环境跑一段时间。

### Q: npm 包什么时候发布？

TODO。当前可以直接 `git clone` + `npm link` 使用。

### Q: AgentOS 支持多 Agent 吗？

当前单 Agent 场景已完整支持。多 Agent 会话隔离、跨 Agent 记忆共享在路线图上。

### Q: 沙箱模式安全吗？

v1.0 沙箱基于环境变量 + 路径校验 + 命令模式检测，不是容器级隔离。v2.0 计划支持 Docker 沙箱。

### Q: 怎么看 Audit Log？

```bash
cat .agentos/audit.jsonl | jq '.'
```

或通过 API：

```typescript
const entries = api.auditQuery({ minScore: 3.0 }); // 查看高风险操作
```

---

## 🗺️ 路线图

| 版本 | 内容 | 状态 |
|------|------|:--:|
| v0.1 | 项目脚手架 + 类型定义 + 核心骨架 | ✅ |
| v0.2 | Guard 层（Schema + Risk + Snapshot + Verify + Audit Log + Rollback） | ✅ |
| v0.3 | Memory 层（Working + Episodic + Semantic）| ✅ |
| v0.4 | Evaluator 层（Pre/Runtime/Post + 隐性反馈 + 质量画像） | ✅ |
| v1.0 | Sandbox 执行器 + API 层 + Schema x- 扩展 + 校验补齐 | ✅ |
| v1.1 | npm 发布 | 📋 |
| v2.0 | Docker 沙箱、Dashboard、SaaS 云端 | 📋 |

---

## 📂 源码结构

```
src/
├── index.ts               # 导出入口（30+ 导出）
├── core.ts                 # AgentOS 主循环
├── api.ts                  # SDK 协议层（25+ 方法）
├── types/index.ts          # 完整类型定义
├── guard/
│   ├── schema-gate.ts      # Schema 校验（12 种规则）
│   ├── risk-gate.ts        # 风险评分（四维公式）
│   ├── snapshot-verify.ts  # 快照 + 验证 + 回滚
│   ├── audit-log.ts        # 审计日志
│   └── sandbox.ts          # 沙箱执行器
├── memory/
│   ├── working.ts          # 工作记忆
│   ├── episodic.ts         # 情景记忆
│   └── semantic.ts         # 语义记忆
└── evaluator/
    ├── exec-evaluator.ts   # 三阶段评估器
    ├── feedback.ts         # 隐性反馈引擎
    └── profiler.ts         # Agent 质量画像
```

---

## 📄 License

MIT
