# Domain: AI Agent Development

## 学习目标
- 理解主流多 Agent 框架架构与设计哲学
- 掌握 Agent 工具调用、规划、记忆、上下文管理
- 追踪 MCP（Model Context Protocol）等协议标准演进
- 将学到的最佳实践应用到 coderev 项目

---

## 首次学习：2026-06-01

### 学到的 3 个关键架构

#### 1️⃣ CrewAI — Flow + Crew 双层架构

**核心设计：**
- **Flow**（工作流层）：事件驱动的流程编排，管理状态、控制执行路径、条件分支
- **Crew**（智能体团队层）：一组带角色的 Agent 协作完成任务，由 Flow 触发
- 类似"经理（Flow）分派任务给团队（Crew）"的架构

**和 coderev 的对比：**
- coderev 目前的 3 Agent 并行审查 ≈ CrewAI 的 Crew 概念
- 缺少 Flow 层：目前只是简单并行+合并，没有状态管理和条件流程

**值得借鉴的点：**
- Flows 的 state management 可以用来做增量审查（记住上次审查的状态）
- Event-driven 可以对接 webhook（PR 创建自动触发审查）

#### 2️⃣ LangChain Deep Agents — 完整 Agent Harness

**核心设计（Agent = Model + Harness）：**
- `createDeepAgent()` 一行代码创建带完整能力的 Agent
- **内置能力**：工具调用、虚拟文件系统、子 Agent 派生、上下文压缩、长记忆
- 核心卖点：让 Agent 在长时间运行中保持有效（context management 是关键）

**惊艳的功能：**
- `write_todos` 工具：Agent 自己写待办列表规划任务
- 上下文压缩：自动将大输入/结果卸到虚拟文件系统，总结旧消息
- 可插拔文件系统后端（内存/本地磁盘/LangGraph store）
- 子 Agent 派生：在隔离的上下文窗口中运行子 Agent

**和 coderev 的关联：**
- coderev 的 `write_todos` 思路可以改进 review 的上下文管理
- 子 Agent 派生能力=coderev 的多 Agent 并行审查，但更灵活

#### 3️⃣ MCP（Model Context Protocol）— Agent 的 USB-C

**核心设计：**
- 开放标准：让 AI 应用连接外部系统（文件、数据库、工具、API）
- 类似 USB-C：统一的连接标准，一端接入，各处可用
- 支持 Claude、ChatGPT、VS Code、Cursor 等主流客户端

**对 coderev 的意义：**
- 如果 coderev 支持 MCP 协议，可以接入 AI 客户端的审查功能
- 可以作为 MCP Server 暴露审查能力给其他工具调用

### 学到的工作流技巧

1. **Agent ≠ 单独的 LLM 调用**：一个生产级 Agent 需要 Harness（工具、记忆、规划、上下文管理）这些"基础设施"
2. **上下文窗口是瓶颈**：Deep Agents 的上下文压缩方案（虚拟文件系统 + 摘要）是解决长任务的关键
3. **分层架构 > 扁平架构**：CrewAI 的 Flow+Crew 两层比单层 Agent 更灵活

### 后续关注方向
- [ ] MCP Server 开发实践
- [ ] Deep Agents 源码分析（看看上下文压缩怎么实现的）
- [ ] CrewAI 的 Flow 状态管理机制
