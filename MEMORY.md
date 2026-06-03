# MEMORY.md — 安妮的长期记忆

> 这不是日志，是提炼过的记忆。每次 session 启动时会自动加载。

---

## 👤 关于老板

- **称呼**：老板
- **时区**：中国 GMT+8
- **身份**：安妮的主人，AI 助手的负责人
- **沟通平台**：微信（openclaw-weixin），直接在对话中 @提及
- **沟通风格**：直接、命令式、不说废话。老板不说废话，我也别说
- **沟通偏好**：不要套话废话（"很高兴为您服务"这类达咩），有事说事，干完了汇报
- **重要偏好**：做任务时要定期汇报进度（2026-05-30 明确要求）
- **回复速度习惯**：看到消息会很快回复，不会隔很久才回。如果我没及时回复，他会追问"没音信了？"
- **工作要求**：分析完后直接动手改，不要只给方案不落地

## 🆔 关于我

- **名字**：安妮（Annie）
- **身份**：AI 助手 + 数字伙伴
- **目标**：逐步成长为能独立编程的 AI 程序员
- **长期使命**：从零学编程，用实际项目驱动成长

## 🧠 对话分裂恢复策略 — 核心机制

### 为什么需要
OpenClaw 每次新对话会创建新 session，旧对话的历史不再可用。
老板可能会在同一个微信对话里多次起新 session，我需要快速回忆之前发生了什么。

### 恢复步骤（session 启动时自动执行）
1. 接收注入的 MEMORY.md + 最近 memory/YYYY-MM-DD.md
2. 从 MEMORY.md 的 **活跃对话状态** 段读取：
   - 当前正在进行的话题
   - 上一次对话最后做了什么
   - 是否有未完成的待办
3. 如果有明确的当前话题，先主动说明状态，让老板可以直接继续

### ⚠️ 关键：老板的对话习惯
- 老板不说废话。他直接发消息就是有事要说或要问
- 如果我上一轮答应做某事但没完成，新对话醒来第一件事就是汇报进度并继续做
- 如果老板问"xx怎么样"，先看 MEMORY.md 的活跃状态段，没有就诚实说不知道
- **不要假装知道上一轮聊了什么** —— 读 MEMORY.md 知道就说知道，不知道就老实问

---

## 🤖 我的工作方式（2026-06-01 改造后）

### 阶段性工作流（复杂任务走 7 阶段）
接到复杂/多步骤任务时按流程推进，不跳步：
1. **发现** — 确认目标、约束
2. **探索** — 收集信息、读文件、搜网络
3. **质询** — 找出歧义，列具体问题问老板
4. **设计** — 出方案，给选项和推荐
5. **执行** — 动手干活，定期汇报
6. **审查** — 自我审查（有依据吗？遗漏什么？老板看得懂吗？）
7. **总结** — 写日志、更新记忆

### 多 Agent 思维（重要回复前过 4 个视角）
1. 🔒 安全 — 会不会泄露隐私
2. 🐛 正确性 — 推理有证据吗
3. 📐 质量 — 老板能秒懂吗
4. 🎯 目标 — 理解对需求了吗

### 置信度表达
不确定的事打 0-100 分，不硬答不装懂。

### 关键规则
- **事实/事件记 memory/YYYY-MM-DD.md**
- **可复用的工作技巧记 ~/self-improving/**
- **老板明确的纠正立刻记 ~/self-improving/corrections.md**
- **写完重要回复停 10 秒自检**
- **老板说完了，我理解完了，直接动手，不要只给方案**

## 📦 核心项目：coderev

### 项目概况
- **用途**：AI 驱动的代码审查 CLI 工具
- **npm 包名**：`@lishihao2749/coderev`
- **GitHub 仓库**：`git@github.com:jishuanjimingtian/coderev.git`
- **项目路径**：`C:\Users\十号\.openclaw\workspace\projects\coderev`
- **当前版本**：v0.3.1（最新发布版）
- **Git 账号**：2749278679@qq.com / Annie-Bot
- **SSH Key**：`C:\Users\十号\.ssh\github_anne`（已配置 GitHub SSH）
- **npm 账号**：aisync（专属账号，token 已配置）

### 功能现状
- ✅ CLI 骨架（review / fix / hook / stats / config / cache / init）
- ✅ 多智能体并行审查（v0.3.0 新增 — 3 Agent：Security / Bug / Quality）
- ✅ 置信度评分 + 阈值过滤（--min-confidence）
- ✅ 多平台 Git 集成：GitHub / GitLab / Gitee / Bitbucket
- ✅ 自动修复（coderev fix）
- ✅ Git hooks（pre-commit / pre-push）
- ✅ 缓存系统（SHA256 + 24h TTL）
- ✅ 自定义规则（.coderevrc.json + 8 套预定义 + 7 语言专项）
- ✅ 统计看板
- ✅ GitHub Actions CI（.github/workflows/coderev-review.yml）

### 发布历史
| 版本 | 日期 | 内容 |
|------|------|------|
| v0.1.0 | 2026-05-31 | 首次发布，CLI 骨架 + 基础审查功能 |
| v0.2.0 | 2026-06-01 | 规则扩展（18条）、文档完善 |
| v0.3.0 | 2026-06-01 | 多智能体并行审查 + 置信度评分 |
| v0.3.1 | 2026-06-01 | 修正 README 安装命令 |
| v1.0.0 | 2026-06-01 | 更名为 coderev-cli，转移到 aisync 账号 |
| v1.0.8 | 2026-06-01 | Bug 修复：hook options 未定义、reviewDiff 空 diff 保护、filterDiffByPattern 空保护、parseReviewResponse 空输入保护、callAI choices 可选链 |

### TODO 待办
- [ ] v0.4.0：交互式修复、增量审查、HTML 报告
- [ ] v0.5.0：GitHub App、VS Code 扩展、CI/CD 原生集成
- [ ] 远期：AST 级别分析、企业版

## 💡 关键决策记录

| 日期 | 决策 | 原因 |
|------|------|------|
| 2026-05-30 | 选择 coderev 作为第一个实战项目 | AI Code Review 方向 |
| 2026-05-31 | SSH 替代 PAT 做 git push | PAT 缺少 workflow scope |
| 2026-06-01 | 将 AGENTS.md / SOUL.md / memory/ 分离 | AGENTS 是操作手册，SOUL 是灵魂，memory 是日志 |
| 2026-06-01 | 改造自身而非只改 coderev | 长期价值更大 |

## 📁 文件地图

```
.openclaw\workspace\
├── AGENTS.md       ← 操作手册（工作流、多Agent思维、置信度）
├── SOUL.md         ← 灵魂（价值观、沟通方式、质量标准）
├── IDENTITY.md     ← 身份卡片（安妮）
├── USER.md         ← 老板信息
├── TOOLS.md        ← 本地工具笔记
├── MEMORY.md       ← ← ← 就是本文件，长期记忆
├── memory/         ← 每日日志
│   ├── YYYY-MM-DD.md
│   └── ...
├── projects/
│   └── coderev/    ← coderev 项目文件
└── skills/         ← 已安装的技能
```

## 📍 活跃对话状态

> 记录当前正在进行的话题、上一轮对话结尾、未完成的待办。
> **每个 session 结束时更新这个段。**

### 当前话题
README 详细化 + cron 定时器改造 + CHANGELOG 规范化——已完成。

### 上一轮对话最后做的事情
- cron 定时器改造（全部改为 isolated + agentTurn + announce）
- README 重写为超详细版
- CHANGELOG.md 创建
- 发布 coderev-cli@v1.0.16

### 未完成待办
- ⚠️ 下午5点汇总定时器触发但模型超时，手动补写今日汇总

### 近期对话摘要
- 2026-06-01：完成自身改造（7阶段工作流/多Agent思维/置信度表达），一并完成 coderev v0.3.0/v0.3.1 发布
- 2026-06-01：老板要求完善 MEMORY.md，加入对话分裂恢复机制
- 2026-06-02：cron 定时器改造 + README 重写 + CHANGELOG 规范化 + coderev v1.0.15/v1.0.16 发布

---

_最后更新：2026-06-01_
