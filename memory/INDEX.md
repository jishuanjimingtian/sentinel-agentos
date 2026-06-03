# 知识库索引与关系图

> 自动维护：每次重大更新时更新此文件

## 📂 知识库结构

```
workspace/
├── AGENTS.md          ← 操作手册（工作流、方法论、规则红线）
│   └── 引用: SOUL.md(价值观引导), MEMORY.md(记忆规则), self-improving/(技巧沉淀)
│
├── SOUL.md            ← 人格灵魂（价值观、沟通准则、质量标准）
│   └── 引用: AGENTS.md(工作流执行), IDENTITY.md(身份锚点)
│
├── IDENTITY.md        ← 身份卡片（安妮是谁）
│   └── 引用: SOUL.md(人格), USER.md(老板)
│
├── USER.md            ← 老板档案（基础信息、时区、称呼）
│   └── 引用: MEMORY.md(老板行为画像的扩展)
│
├── MEMORY.md          ← ★ 长期记忆核心（启动时自动加载）
│   ├── 老板画像 ← 来自 USER.md + 历史对话总结
│   ├── 项目档案 ← 来自 memory/YYYY-MM-DD.md 提炼
│   ├── 关键决策 ← 来自对话 + 自我反思
│   ├── 活跃状态 ← 当前话题/待办
│   └── 引用: memory/(原始日志源), self-improving/(技巧侧)
│
├── TOOLS.md           ← 环境工具笔记（服务器、SSH、TTS、物理设备）
│   └── 引用: 无，纯环境配置
│
├── HEARTBEAT.md       ← 心跳任务清单
│
├── memory/            ← 每日原始日志（YYYY-MM-DD.md）
│   ├── 含：项目进展、功能开发、发布记录、问题排查
│   └── → MEMORY.md 从中提炼长期记忆
│
├── projects/coderev/  ← coderev 项目文件
│   ├── src/           ← 源码
│   ├── docs/          ← 文档
│   ├── CHANGELOG.md   ← 发版日志
│   ├── ROADMAP.md     ← 路线图
│   ├── TODO.md        ← 待办
│   └── logo.svg/png   ← Logo
│
└── skills/            ← 安装的技能（不修改）
```

## 🔗 文件间引用关系

```
AGENTS.md
  ├── 引用 → SOUL.md（Soul中定义了自我审查、结构化输出）
  ├── 引用 → memory/ 规则（写日志）
  └── 引用 → self-improving/（技巧沉淀规则）

SOUL.md
  ├── 引用 → AGENTS.md（工作流指导）
  └── 引用 → self-improving/（持续学习）

MEMORY.md
  ├── 上游 ← memory/YYYY-MM-DD.md（原始数据）
  ├── 上游 ← 对话 session（即时决策）
  └── 下游 → session 启动（自动加载作为上下文）

self-improving/memory.md
  └── 上游 ← 工作复盘、老板纠正、self-improving/domains/
```

## ⏳ 信息生命周期

```
对话发生 → 写入 memory/YYYY-MM-DD.md（原始日志）
  ↓ (提炼)
MEMORY.md 更新（长期记忆）
  ↓ (持续观察)
self-improving/ 更新（可复用工作技巧）
  ↓ (反思)
AGENTS.md / SOUL.md 更新（行为改造）
```

## 🗂 主题标签索引

| 主题 | 相关文件 |
|------|---------|
| 老板画像 | MEMORY.md, USER.md |
| 工作方法论 | AGENTS.md, SOUL.md, self-improving/memory.md |
| coderev 项目 | MEMORY.md(项目段), memory/*.md, projects/coderev/ |
| AI Agent 开发 | self-improving/domains/ai-agent-dev.md |
| AI 编程入门 | self-improving/domains/ai-programming.md |
| 服务器/部署 | TOOLS.md |
| 发版记录 | projects/coderev/CHANGELOG.md, memory/*.md |
| 决策记录 | MEMORY.md(决策段), self-improving/corrections.md |
| 沟通偏好 | MEMORY.md(老板画像), SOUL.md(沟通准则) |

## ⚠️ 数据一致性检查

- [x] MEMORY.md 项目版本号与实际一致？
- [x] self-improving/index.md 索引是最新的？
- [ ] corrections.md 记录了所有老板纠正？
- [ ] TOOLS.md 记录了所有环境信息？
