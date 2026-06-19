# AgentOS 能力拓展方向

> 围绕 AI Agent 安全 + 记忆系统核心定位的 6 个延伸方向

---

## 方向一：跨 Agent 信用体系

### 问题场景
Sentinel 对所有 Agent 一视同仁——不管是谁执行危险命令，弹窗方式完全一样。但实际上：
- 安妮（主 Agent）是你最信任的，频繁被弹窗浪费你时间
- coderev bot 每天 8 点自动跑，你不在电脑旁，弹窗没人点
- 未知 Agent 或 cron 中临时创建的 Agent 信任度应该极低

### 设计方案

**信用等级体系：**

| 等级 | 名称 | 低风险放行阈值 | 高风险处置 | 适用对象 |
|------|------|--------------|-----------|---------|
| L3 | 完全信任 | 50 | 仅极高风险弹窗 | 主 Agent（安妮） |
| L2 | 高度信任 | 30 | 中风险弹窗+替代方案 | coderev bot |
| L1 | 基本信任 | 15 | 中低风险弹窗 | 定时学习 bot |
| L0 | 不信任 | 0 | 全部弹窗+严格审查 | 未知 Agent |

**信用升降规则：**

| 行为 | 信用变化 | 说明 |
|------|---------|------|
| 连续 10 次操作无拦截/无拒绝 | +1 级 | 稳定运行可升级 |
| 被用户拒绝 3 次 | -1 级 | 连续被拒说明行为不当 |
| 执行被 Sentinel block 的命令 | -2 级 | 试图执行危险命令 |
| 30 天未活动 | -1 级 | 长期未用降低信用 |
| 新 Agent 首次操作 | 从 L0 开始 | 不信任任何新来者 |

**技术实现：**

```json
// .agentos/credit.json
{
  "agents": {
    "main": { "level": 3, "totalOps": 1100, "denied": 5, "allowedOps": 1095 },
    "coderev-bot": { "level": 2, "totalOps": 320, "denied": 12, "allowedOps": 308 },
    "learn-bot": { "level": 1, "totalOps": 45, "denied": 2, "allowedOps": 43 }
  },
  "defaultLevel": 0
}
```

**价值：** 不只拦截恶意，还能"信任好人"。让安妮少被弹窗打扰。

---

## 方向二：操作意图预测

### 问题场景
Sentinel 现在只能被动拦截——等 Agent 执行了危险命令后才弹窗。如果在 Agent **想**执行危险命令之前就给出预警，安全效果更好。

### 设计方案

**预测逻辑：**

```
Agent 说: "我需要清理一下临时文件"
    ↓
Sentinel before_prompt_build 扫描:
  关键词: 清理、删除、移除 → 可能触发 rm/del 系列命令
    ↓
主动注入安全提示到 system prompt:
  "⚠️ 清理文件时请注意：使用精确路径，避免 rm -rf /，
   推荐先确认文件列表再执行删除。"
    ↓
Agent 还没执行就收到了安全提醒
```

**关键词映射表：**

| Agent 意图关键词 | 预计可能执行的命令 | 注入的安全提示 |
|-----------------|-----------------|--------------|
| 清理、删除、移除 | rm, del, rmdir | "请精确指定要删除的路径，确认后再执行" |
| 发版、发布 | npm publish, git push | "发布前请确认版本号、CHANGELOG已更新" |
| 重启、重置 | reboot, shutdown, docker restart | "重启前确认没有正在运行的任务" |
| 安装、下载 | npm install, pip install, curl | "请确认安装来源可信，避免恶意包" |
| 修改配置 | chmod, chown, 写 openclaw.json | "修改系统配置前请备份原文件" |
| 数据库操作 | mysql, psql, mongo | "数据库操作请先确认连接的是测试库还是生产库" |

**技术实现：**
- 在 `before_prompt_build` hook 中新增轻量关键词扫描
- 内存中加载 KEYWORD_ALERT 映射表（< 1KB）
- 注入到 system prompt 末尾，不影响原有 prompt 结构

**价值：** 从「事后拦截」升级为「事前提醒」。防患于未然。

---

## 方向三：操作回放 + 故障复盘

### 问题场景
出了问题时（比如今天 openclaw.json 被清空），你只能手动去读 audit.jsonl，一条条翻找原因。效率低，容易遗漏。

### 设计方案

**自动事故检测：**

```
audit.jsonl 实时监控 →
  检测到异常事件:
    - write openclaw.json = {} (系统配置被清空)
    - rm -rf /project (项目文件被删)
    - edit MEMORY.md → 删除全部记忆
    - npm unpublish (误下架包)
  ↓
自动标记为「事故」→ 触发复盘流程
```

**复盘报告自动生成：**

```
事故发生时间: 2026-06-16 11:32:13
事故类型: 系统配置被覆盖
受影响文件: openclaw.json (14.9KB → 3字节)
事故操作链:
  1. [11:30:10] Agent说 "排查 Sentinel 功能验证"
  2. [11:32:13] write openclaw.json = {} ← 事故点
  3. [11:32:15] audit.jsonl 停止写入 ← 连锁影响
根因分析: Agent 测试敏感文件拦截时误写 openclaw.json
恢复方案: 已从 openclaw.json.clobbered.2026-06-16T02:15 恢复
建议: 将 openclaw.json 加入 PROTECTED_PATTERNS
```

**回放功能：**

```
用户查询: "今天 11:30-11:35 发生了什么"

Sentinel 回放:
  [11:30:10] exec: echo "test" (正常)
  [11:30:28] write: .agentos/test-write.txt (正常)
  [11:32:13] write: openclaw.json = {} ← ⚠️
  [11:32:15] audit 写入停止 (连锁影响)

关联分析:
  - 此操作来源于 Agent "排查 Sentinel 功能验证"
  - 用户点过允许（弹窗+确认）
  - 之后 audit 停了 5 小时才恢复
```

**技术实现：**
- 基于已有 audit.jsonl，新增 `audit-analyzer.ts` 模块
- 每分钟自动扫描最近 100 条审计记录
- 异常检测规则：配置表 + 内容匹配（如 `openclaw.json` + `content = "{}"`）
- 事故报告写入 `.agentos/incidents/2026-06-16-113213.md`

**价值：** 出事了 3 秒查根因，不再是「谁动了我的配置」。

---

## 方向四：跨 Session 记忆传递（断点续传）

### 问题场景
每次 Agent 重启后，只知道 MEMORY.md 里手动记的东西。如果上一个 session 正在开发 Sentinel 到一半，重启后不知道做到哪了。

### 设计方案

**Session 结束时自动总结：**

```
Session 结束 →
  AgentOS 扫描本次 session 的关键事件:
    - 改了哪些文件: src/index.ts (6次), package.json (2次)
    - 发了什么版本: v1.0.7
    - 讨论了什么: 智能审批方案、工作区维护
    - 遇到了什么: openclaw.json 被误清空
  ↓
生成 Session 摘要 (200-400字):
  "本次会话: 排查 Sentinel v1.0.5 问题 + 发布 v1.0.7。
   完成: 规则补齐28+18、审计同步写入、弹窗上下文。
   事故: 误写 openclaw.json，已恢复。
   未完成: npm publish 被弹窗拦截需手动确认。"
```

**下次 Session 开始时精准注入：**

```
新 Session 开始 →
  Sentinel 读取上一个 session 的摘要
  注入到 Agent system prompt:
    "[上次会话摘要] 你正在做 Sentinel 插件排查和开发，
    上次完成了 v1.0.7 发布，遇到了 openclaw.json 被清空的事故。
    npm publish 被弹窗拦截了，需要用户手动确认。"
  ↓
  Agent 直接知道上下文，不用再翻 MEMORY.md
```

**与现在 session_start 的区别：**

| 对比 | 现在的 session_start | 新的 session resume |
|------|-------------------|-------------------|
| 注入内容 | 全量 episodic 事件快照 | 精选 3-5 条关键摘要 |
| 注入大小 | 1000-3000 字符 | 200-400 字符 |
| 噪音 | 高（88行重复） | 低（只选最重要的） |
| 关联性 | 弱（时间排序） | 强（按重要性排序） |

**技术实现：**

```typescript
// session 结束时
function onSessionEnd() {
  const summary = generateSessionSummary({
    filesChanged: getChangedFiles(),
    commitsMade: getGitLog(),
    incidents: getIncidents(),
    pendingTasks: getPendingTasks(),
    decisions: getKeyDecisions(),
  });
  fs.writeFileSync(".agentos/session-summary.json", summary);
}

// session 开始时
function onSessionStart() {
  const lastSummary = readLastSessionSummary();
  if (lastSummary) {
    api.injectContext(`[上次会话摘要] ${lastSummary}`);
  }
}
```

**价值：** 重启后 Agent 马上知道「上次做到哪了」——不用再翻记忆。

---

## 方向五：Agent 健康度体检

### 问题场景
Agent 在后台跑着可能陷入无限循环、重复操作、上下文崩溃，用户只能在发现问题后手动干预。

### 设计方案

**实时健康指标：**

| 指标 | 阈值 | 级别 | 自动处置 |
|------|------|------|---------|
| 操作重复率 | 同一命令5分钟内 >= 3次 | ⚠️ 警告 | 注入提示 "检测到重复操作，是否陷入循环？" |
| 上下文饱和度 | context 使用 > 90% | ⚠️ 警告 | 提示 "上下文即将满载，考虑精简任务" |
| 错误率 | 最近10次工具调用失败 >= 30% | 🔴 严重 | 暂停 Agent，推送通知 |
| 响应延迟 | 工具调用间隔 > 60秒 | ⚠️ 警告 | 记录延迟，不干预 |
| 死锁检测 | CPU < 1% + 无操作 > 2分钟 | 🔴 严重 | 尝试恢复/重启 Agent |
| 内存泄漏 | 内存使用持续增长 > 10%/30min | ⚠️ 警告 | 记录并建议重启 Gateway |

**健康仪表盘：**

```
┌────────────────────────────────────────┐
│ Agent 健康状态                          │
├────────────────────────────────────────┤
│ 安妮 (主Agent)                          │
│ 🟢 健康 | 操作: 1100 | 错误率: 0.5%    │
│ 上下文: 248K/1M (25%) | 运行: 4h 1m    │
├────────────────────────────────────────┤
│ coderev ② 开发发布                      │
│ 🔴 异常 | 连续失败: 5次                │
│ 上次: LLM request failed (10:12)       │
│ [诊断] [重启] [禁用]                    │
├────────────────────────────────────────┤
│ 定时学习 bot                            │
│ 🟡 延迟 | 上次运行耗时 159s (平时 80s) │
│ [查看日志]                              │
└────────────────────────────────────────┘
```

**技术实现：**
- 利用 Sentinel 已有的 stats + audit 数据
- 每 30 秒计算一次健康指标
- Dashboard "健康" tab 中展示
- 异常时自动推送到微信

**价值：** Agent 卡住了你能第一时间知道，不等出事故。

---

## 方向六：多 Agent 协作记忆池

### 问题场景
安妮、coderev bot、学习 bot 各自跑各自的，互不知道对方做了啥。coderev bot 更新了 TODO.md，安妮下次对话不知道有这事。

### 设计方案

**共享记忆池结构：**

```
.agentos/shared-memory/
├── agent-main.json       ← 安妮的记忆（私有不共享）
├── agent-coderev.json    ← coderev bot 的记忆（共享摘要）
├── agent-learn.json      ← 学习 bot 的记忆（共享摘要）
├── shared-events.jsonl   ← 跨 Agent 事件通知
└── mutual-awareness.json ← 各 Agent 的当前状态
```

**跨 Agent 事件通知：**

```json
{
  "from": "coderev-bot",
  "to": ["main-agent"],
  "type": "task-completed",
  "summary": "coderev 需求挖掘完成，发现3个新需求更新到TODO.md",
  "ts": "2026-06-16T08:05:00Z",
  "importance": 0.7
}
```

**协作规则：**

| 场景 | 行为 |
|------|------|
| coderev bot 更新了 projects/coderev/ | 主Agent下次启动时看摘要 |
| 主Agent 正在改 plugins/sentinel/ | coderev bot 避开该目录 |
| 学习 bot 发现新技术 | 写入 shared-events，所有Agent可见 |
| 两个 Agent 同时想写同一个文件 | Sentinel 介入：后到的排队等待 |

**技术实现：**
- 在 `.agentos/shared-memory/` 下维护 per-agent 状态文件
- `session_start` 时读取 shared-events.jsonl 中未读事件
- Sentinel 在 `before_tool_call` 阶段检查共享冲突
- 用文件锁（`fs.writeFileSync` + rename）保证原子性

**价值：** 多个 Agent 协同工作时互不影响，且知道对方做了什么。

---

## 优先级总览

| 方向 | 价值 | 难度 | 建议版本 | 工期 |
|------|------|------|---------|------|
| 操作回放 + 故障复盘 | 🔴 刚需 | 低 | v1.3 | 1周 |
| 跨 Agent 信用体系 | 🔴 高频 | 中 | v1.4 | 1周 |
| Agent 健康度体检 | 🔴 高频 | 低 | v1.4 | 1周 |
| 跨 Session 记忆传递 | 🟡 核心 | 中 | v1.5 | 2周 |
| 操作意图预测 | 🟡 增强 | 低 | v1.5 | 1周 |
| 多 Agent 协作记忆池 | 🟢 远期 | 高 | v2.0 | 3周 |

**建议执行顺序：**
```
v1.1 → 独立化 (去掉核心包依赖)
v1.2 → 规则可配置 (teams也能用)
v1.3 → Dashboard + 故障复盘 (出事了能看见)
v1.4 → 信用体系 + 健康体检 (不用管也能自检)
v1.5 → 断点续传 + 意图预测 (核心智能能力)
v2.0 → 协作记忆池 (多Agent协同)
```
