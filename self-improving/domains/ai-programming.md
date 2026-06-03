# Domain: AI Programming

## Learning Goals
- 掌握 Python、TypeScript、Go 等编程语言
- 理解大模型架构、训练、推理、微调
- 学会构建 AI Agent 系统
- 掌握前后端全栈开发能力
- 学会 DevOps、CI/CD、部署

## Progress
- 2026-05-30: 搭建了自我改进系统和 Proactivity 技能
- 2026-05-30: 项目方向确定 — AI Code Review Agent (coderev)
- 2026-06-01: **深入分析 Claude Code 插件架构**，提炼9个核心设计原则
- 2026-06-01: 完成自身改造 —— 阶段性工作流 / 多Agent思维 / 置信度表达

## 从 Claude Code 学到的架构设计原则

### 多Agent并行
- Claude Code 的 code-review 插件启动4个Agent并行审查
- 每个Agent独立打分，最终合并过滤
- ✅ 应用到自身：回复前模拟多视角检查

### 阶段性工作流
- feature-dev 插件7阶段：发现→探索→质询→设计→实现→审查→总结
- 每个阶段完成后才进入下一阶段，不跳步
- ✅ 应用到自身：AGENTS.md 加入阶段性工作流

### 置信度评分
- 每个issue打0-100，80以上才报告
- 区分"绝对确定的"和"可能性高的"
- ✅ 应用到自身：SOUL.md 加入置信度表达规范

### 渐进式披露
- 技能三层次：元数据→核心SKILL.md→参考资料
- 只在触发时才加载深层知识
- 已有基础（self-improving），需要加强触发词

### 强触发词
- 每个skill有精确的触发短语
- 避免加载无关内容浪费上下文

### 独立验证
- feature-dev 第6阶段专门用于自审代码
- ✅ 应用到自身：SOUL.md 加入自我审查规范

## 当前项目
- 项目: Code Review Agent (coderev)
- 最新版本: v0.3.1（多智能体并行审查 + 置信度评分）
- 技术栈: Node.js
- API: DeepSeek / OpenAI

## Lessons Learned
- 看源码比看文档更能学到真东西
- 不要只学表面（功能），要学背后（哲学/架构）
- 改自己比改项目更难，但长期价值更大

## Code Patterns
