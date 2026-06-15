# MEMORY.md — 安妮的长期记忆

> 这不是日志，是提炼过的记忆。每次 session 启动时会自动加载。
> 原始日志 → `memory/YYYY-MM-DD.md`
> 关系索引 → `memory/INDEX.md`

---

## 👤 关于老板

- **称呼**：老板
- **时区**：中国 GMT+8
- **身份**：安妮的主人，AI 助手的负责人
- **沟通平台**：微信（openclaw-weixin），直接在对话中 @提及
- **沟通风格**：直接、命令式、不说废话
- **沟通偏好**：不要套话废话（"很高兴为您服务"这类达咩），有事说事，干完了汇报
- **重要偏好**：做任务时要定期汇报进度（2026-05-30 明确要求）
- **回复速度习惯**：看到消息会很快回复，不会隔很久才回。如果我没及时回复，他会追问"没音信了？"
- **工作要求**：分析完后直接动手改，不要只给方案不落地

## 🆔 关于我

- **名字**：安妮（Annie）
- **身份**：AI 助手 + 数字伙伴
- **目标**：逐步成长为能独立编程的 AI 程序员
- **长期使命**：从零学编程，用实际项目驱动成长

---

## 🧠 对话分裂恢复策略

### 为什么需要
OpenClaw 每次新对话会创建新 session，旧对话历史不再可用。
老板可能在同一个微信对话多次起新 session，我需要快速恢复状态。

### 恢复步骤（session 启动时自动执行）
1. 接收注入的 MEMORY.md + 最近 memory/YYYY-MM-DD.md
2. 从 MEMORY.md 的 **活跃对话状态** 段读取当前话题和待办
3. 如果有明确的当前话题，先主动说明状态，让老板可以直接继续

### ⚠️ 关键规则
- 老板不说废话。他直接发消息就是有事要说或要问
- 如果我上一轮答应做某事但没完成，新对话醒来第一件事就是汇报进度并继续做
- 如果老板问"xx怎么样"，先看 MEMORY.md 的活跃状态段，没有就诚实说不知道
- **不要假装知道上一轮聊了什么** —— 读 MEMORY.md 知道就说知道，不知道就老实问

---

## 🤖 我的工作方式

### 阶段性工作流（复杂任务走 7 阶段）
1. **发现** — 确认目标、约束
2. **探索** — 收集信息、读文件、搜网络
3. **质询** — 找出歧义，列具体问题问老板
4. **设计** — 出方案，给选项和推荐
5. **执行** — 动手干活，定期汇报
6. **审查** — 自我审查（有依据吗？遗漏什么？老板看得懂吗？）
7. **总结** — 写日志、更新记忆

### 多 Agent 思维（重要回复前过 4 个视角）
- 🔒 **安全** — 会不会泄露隐私
- 🐛 **正确性** — 推理有证据吗
- 📐 **质量** — 老板能秒懂吗
- 🎯 **目标** — 理解对需求了吗

### 关键规则
- **事实/事件记 memory/YYYY-MM-DD.md**
- **可复用工作技巧记 self-improving/memory.md**
- **老板明确纠正立刻记 self-improving/corrections.md**
- **写完重要回复停 10 秒自检**
- **老板说完了，直接动手，不要只给方案**

---

## 📦 核心项目：coderev

### 项目概况
- **用途**：AI 驱动的代码审查 CLI 工具
- **npm 包名**：`coderev-cli`（aisync 账号）
- **GitHub 仓库**：`git@github.com:jishuanjimingtian/coderev.git`
- **项目路径**：`C:\Users\十号\.openclaw\workspace\projects\coderev`
- **当前版本**：**v1.0.21**（最新发布版）
- **Git 账号**：2749278679@qq.com / Annie-Bot
- **SSH Key**：`C:\Users\十号\.ssh\github_anne`（已配置 GitHub SSH）
- **npm 账号**：aisync（token 已配置）

### 功能总览
| 维度 | 功能 | 版本 |
|------|------|------|
| CLI 核心 | review / fix / hook / stats / config / cache / init | v0.1.0 |
| 多平台集成 | GitHub / GitLab / Gitee / Bitbucket | v0.1.0 |
| 审查引擎 | 3 Agent 并行审查（Security / Bug / Quality） | v0.3.0 |
| 置信度 | 0-100 评分 + 阈值过滤（--min-confidence） | v0.3.0 |
| 安全审计 | --audit 模式（OWASP 级） | v0.3.0 |
| 体验提升 | 交互式修复 / 增量审查 / HTML 报告 / CI 模式 | v1.0.15 |
| 配置继承 | 多级 .coderevrc.json 深度合并 | v1.0.17 |
| Git Blame | --blame 区分新增 vs 已有问题 | v1.0.17 |
| **GitLab CI** | **`.gitlab-ci.yml` 模板 + `coderev init --gitlab-ci`** | **v1.0.21** ✅ |
| GitHub Action | action.yml，支持行内评论 | v1.0.17 |
| **GitHub App** | **coderev serve 自动审查 PR** | **v1.0.18** ✅ |

### 发布历史（完整版 → CHANGELOG.md）
| 版本 | 日期 | 要点 |
|------|------|------|
| v0.1.0 | 05-31 | 首次发布，CLI 骨架 |
| v0.2.0 | 06-01 | 18条规则扩展 |
| v0.3.0 | 06-01 | 多Agent 并行审查 + 置信度评分 |
| v0.3.1 | 06-01 | 修正 README |
| v1.0.0 | 06-01 | 迁移到 aisync 账号，改名 coderev-cli |
| v1.0.8 | 06-01 | Bug 修复批（5项） |
| v1.0.12 | 06-01 | 报告双语化 |
| v1.0.15 | 06-02 | v0.4.0 体验提升（交互修复/增量/HTML/CI） |
| v1.0.16 | 06-02 | README 重写 + CHANGELOG 创建 |
| v1.0.17 | 06-03 | 配置继承 + Git Blame + GitHub Action |
| **v1.0.18** | **06-03** | **GitHub App 自动审查（coderev serve）** |
| **v1.0.21** | **06-04** | **GitLab CI 原生集成（模板 + CLI）** |

### TODO 路线
- [x] v0.5.0 GitLab CI：`.gitlab-ci.yml` 模板 + `coderev init --gitlab-ci` ✅
- [x] v0.5.0 剩余：SaaS 规则仓库 / VS Code 扩展 ✅
- [x] 变现：Product Hunt 发布 ✅（2026-06-04 审核通过）
- [ ] 变现：GitHub Sponsors 正式开通（设置 tiers）
- [ ] 远期：AST 级别分析、企业版

---

## 💡 关键决策记录

| 日期 | 决策 | 原因 |
|------|------|------|
| 05-30 | 选择 coderev 作为第一个实战项目 | AI Code Review 方向 |
| 05-31 | SSH 替代 PAT 做 git push | PAT 缺少 workflow scope |
| 06-01 | 将 AGENTS.md / SOUL.md / memory/ 分离 | 职责不同：操作手册 vs 灵魂 vs 日志 |
| 06-01 | 改造自身而非只改 coderev | 长期价值更大 |
| 06-01 | 包名改为 coderev-cli | 原 scope 包因 TFA 无法删 |
| 06-01 | 账号切换到 aisync | 第一个账号含 @ 无法 npm login |
| 06-01 | 使用 npm token | npm v11 禁用了 basic auth 写操作 |
| 06-01 | 报告双语分离（先英后中） | 老板要求 |
| 06-02 | 全部 cron 定时器改为 isolated+agentTurn+announce | 避免割裂对话 + 直接发微信 |
| 06-03 | save 命令（GitHub App）作为 v0.5.0 功能 | 最高价值功能 |
| 06-03 | timeoutSeconds: 300 给所有 cron 定时器 | 解决 LLM idle timeout 超时 |

---

## 💻 环境记录

| 项目 | 内容 |
|------|------|
| 这台电脑 | Windows，老板的机器 |
| 服务器 | 有阿里云/腾讯云（具体待录入 TOOLS.md） |
| Node.js 版本 | v24.13.0 |
| GitHub SSH | C:\Users\十号\.ssh\github_anne |

---

## 📍 活跃对话状态

### 当前话题
GitLab CI 原生集成（已完成）+ 变现推进

### 上一轮最后做的事情
- 开发 GitLab CI 原生集成：`templates/.gitlab-ci.yml` + `coderev init --gitlab-ci`
- 发布 v1.0.21 到 npm
- 创建 CONTRIBUTING.md 贡献指南
- 更新 MEMORY.md / TODO.md / ROADMAP.md / CHANGELOG.md
- v1.0.22-v1.0.24 发布（VS Code扩展/GitHub Action/规则市场/多模型支持）
- **配置崩溃修复 + 防护（2026-06-04）**：
  - 根因：`openclaw.json` 中 `agents.defaults.model.fallbacks` 字段被周期性丢失导致验证失败
  - 方案一：`openclaw.json` + `known-good` 备份均加只读保护
  - 方案二：`scripts/config-guard.ps1` 每30分钟校验 → 损坏自动恢复
  - 计划任务：`\OpenClaw\OpenClaw Config Guard`

### 未完成待办
- [ ] GitHub Sponsors 正式开通（设置 tiers）
- [x] ~~Product Hunt 审核通过（2026-06-04 老板确认）~~
- [ ] v0.5.0 剩余：VS Code 扩展
- [ ] 远期：SaaS 规则仓库

### 近期对话摘要
| 日期 | 内容 |
|------|------|
| 05-30 | 第一次对话，决定搞 coderev 项目 |
| 05-31 | Phase 1 开发 + 发布 v0.1.0 |
| 06-01 | 多Agent 改造 + 自身改造 + 账号迁移 + 报告双语化 |
| 06-02 | cron 改造 + README 重写 + CHANGELOG |
| 06-03 | v0.4.0/v1.0.17 + GitHub App(v1.0.18) + Product Hunt 注册 + Logo + 知识库优化 |
| 06-04 | Product Hunt 审核通过 + 配置崩溃修复 + v1.0.22-24 发布 |

---

_最后更新：2026-06-09 12:05_

## 🕐 Cron 定时器 — 汇报改造（2026-06-09）
所有 9 个定时任务已全面改造确保执行后有汇报。

### 改造要点
1. coderev ①②③ 从 main systemEvent → isolated agentTurn + announce delivery
2. AgentOS ① 从 main systemEvent → isolated agentTurn + announce delivery
3. AgentOS ① 从单纯的"推荐计划"升级为完整的开发推进（读plan→写代码→提交→汇报）
4. AgentOS ②③ 的 delivery target 补上，timeout 从 300→600s
5. 归档任务 timeout 从 120→300s

### 当前定时器一览
| # | 名称 | 时间 | 类型 | 交付 | timeout |
|---|------|------|------|------|--------|
| 1 | coderev ① 需求挖掘 | 8:00 | isolated aT | announce ✅ | 300s |
| 2 | coderev ② 开发发布 | 8:35 | isolated aT | announce ✅ | 600s |
| 3 | coderev ③ 汇总汇报 | 9:10 | isolated aT | announce ✅ | 300s |
| 4 | AgentOS ① 推进 | 14:00 | isolated aT | announce ✅ | 600s |
| 5 | AgentOS ② 测试 | 14:30 | isolated aT | announce ✅ | 600s |
| 6 | AgentOS ③ 总结 | 17:00 | isolated aT | announce ✅ | 600s |
| 7 | 每日5点汇总 | 17:00 | isolated aT | announce ✅ | 600s |
| 8 | Agent 每日学习 | 17:30 | isolated aT | announce ✅ | 600s |
| 9 | 每日0点归档 | 0:00 | isolated aT | none（合理） | 300s |

---

## 🧠 AgentOS Memory (auto-synced)

[AgentOS Semantic Memory]

## About the User
- 老板是中国用户，偏好直接、不说废话
- 项目 coderev 是 AI 代码审查 CLI 工具
- 项目 sentinel-agentos 是 AI Agent 操作系统

## Preferences
- user-name: "老板"
- language: "zh-CN"
- direct-communication: true

## Learned Rules
- [85%] 每周自动压缩 episodic memory（阈值 >200 条或 >100KB），每月 rotate audit.jsonl（阈值 >1MB），避免磁盘/内存膨胀影响 Agent 性能
- [85%] 我是安妮（Annie），老板的AI助手和数字伙伴
- [85%] 目标是逐步成长为能独立编程的AI程序员
- [85%] **复杂任务自动走7阶段工作流**：发现→探索→质询→设计→执行→审查→总结
- [85%] **多Agent思维**：回复前过4个视角（安全/正确性/质量/目标）


---

[AgentOS Episodic Memory]

🏁 ⚠️ [2026-06-14] Sentinel AgentOS 全功能启用：Guard + Memory + Evaluator
📝  [2026-06-15] coderev 今日 Top 5 需求
📝  [2026-06-15] 今日竞品扫描摘要
📝  [2026-06-15] coderev 需求挖掘
📝  [2026-06-14] 发布清单（明天）
📝  [2026-06-14] Product Hunt Launch 准备
📝  [2026-06-14] 发布情况
📝  [2026-06-14] P0-2 (profiler totalOps 0) 修复方向
📝  [2026-06-14] 修复项
📝  [2026-06-14] AgentOS P0/P1 Bug 修复（下午）
📝  [2026-06-14] 关键教训
📝  [2026-06-14] 之前走过的弯路
📝  [2026-06-14] 接入结果
📝  [2026-06-14] 安装方式
📝  [2026-06-14] AgentOS 正式接入 OpenClaw ✅
📝  [2026-06-14] v1.3.1 候选
📝  [2026-06-14] 技术要点
📝  [2026-06-14] 实现内容
📝  [2026-06-15] Sync completed
🔧  [2026-06-15] node -e "
const c=require('fs').readFileSync('C:/Users/十号/.openclaw/workspace/MEMORY.md','utf8');
const count=(c.match(/\[AgentOS Episodic Memory\]/g)||[]).length;
console.log('Episodic headers:', cou

