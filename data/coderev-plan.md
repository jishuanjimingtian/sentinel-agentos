# 🚀 Code Review Agent — 完整开发规划

**项目代号：** `coderev`
**技术栈：** Node.js / TypeScript
**目标市场：** 开发者、开发团队
**变现模式：** Open Core（开源免费 + 企业付费）

---

## 一、项目概况

### 做什么？
一个 AI 驱动的代码审查 CLI 工具。提 PR 的时候自动分析 diff，发现 bug、安全漏洞、代码规范问题、优化建议。

### 为什么 Node.js / TypeScript？
- ✅ 本机有 Node.js v24.13.0、npm 11.6.2
- ✅ CLI 工具开发 TypeScript 生态成熟（Commander, Ink, Chalk）
- ✅ 对 AI 模型 API 调用原生支持好
- ❌ Python 本机没有，安装复杂

### 为什么用 DeepSeek API？
- ¥1/百万 token，成本极低
- 中文/代码能力优秀
- 按量付费，零月费

---

## 二、里程碑总览

```
Phase 1 ─── Phase 2 ─── Phase 3 ───→ 持续迭代
 1-2周       3-4周       5-8周
  CLI 核心   GitHub 集成   开源发布
  MVP        Action 自动   + 社区反馈
             审查
```

---

## 三、Phase 1：CLI 核心功能（第1-2周）

### 目标
命令行工具可以输入代码 diff，输出结构化的 review 报告。

### 技术点

| 模块 | 技术 | 学习内容 |
|------|------|---------|
| CLI 框架 | Commander.js / yargs | 命令解析、参数处理 |
| 语言 | TypeScript | 类型系统、编译流程 |
| LLM 调用 | DeepSeek API (OpenAI 兼容) | API 调用、流式响应 |
| 输出 | Chalk / Terminal格式化 | 终端彩色输出 |
| 配置 | dotenv / JSON config | 配置文件管理 |
| 包管理 | npm / pnpm | 发布、依赖管理 |

### 功能清单

```
coderev review <diff文件或stdin>
  → 输出结构化的 review 结果:
    🔴 Critical: 安全漏洞、空指针、逻辑错误
    🟡 Warning:  代码异味、规范对齐
    🟢 Suggestion: 性能优化、可读性改进
    💡 Note:       架构建议

coderev init
  → 在当前项目创建 .coderevrc 配置文件

coderev config
  → 查看/设置配置 (API key, 规则等)

coderev --help
  → 帮助信息
```

### 交付物
- [ ] 项目脚手架搭建（TypeScript + ESLint + Jest）
- [ ] CLI 命令框架（review / init / config / help）
- [ ] diff 解析模块（解析统一 diff 格式）
- [ ] DeepSeek API 调用模块（prompt 工程）
- [ ] review 结果格式化输出
- [ ] 配置文件读写
- [ ] 基本测试覆盖

---

## 四、Phase 2：GitHub 集成（第3-4周）

### 目标
PR 提交后自动触发 review，评论到 PR 上。

### 功能

```
GitHub Action:
  on: [pull_request]
  steps:
    - uses: coderev-action@v1
    - run: coderev review
    - posts comment to PR
```

### 技术点

| 模块 | 技术 | 学习内容 |
|------|------|---------|
| GitHub Action | 自定义 Action | Action 开发规范 |
| GitHub API | Octokit | REST API、PR 评论 |
| CI/CD | GitHub Actions | Workflow 语法 |
| 部署 | npm 发布 | 包发布流程 |

### 交付物
- [ ] GitHub Action 集成（自动获取 PR diff）
- [ ] GitHub App（可选，更灵活）
- [ ] 评论格式化（markdown 表格）
- [ ] 增量 review（只 review 新增变更）
- [ ] 示例仓库 + 文档

---

## 五、Phase 3：开源发布（第5-8周）

### 目标
GitHub 开源，积累用户和反馈，形成社区。

### 要做的事
- [ ] README 中文/英文双语
- [ ] 完善文档（安装、配置、使用、FAQ）
- [ ] 示例仓库（showcase 效果）
- [ ] 发布到 npm
- [ ] Twitter / 掘金 / V2EX 宣传
- [ ] 收集 Issue 和反馈
- [ ] 根据反馈迭代

### 变现窗口
| 时机 | 做什么 |
|------|--------|
| ⭐ 达 100 Stars | 推出 SaaS 版本（免费额度+付费升级） |
| ⭐ 达 500 Stars | 推出企业私有化部署方案 |
| ⭐ 达 1000 Stars | 考虑全职/融资/团队 |

---

## 六、第一阶段·第1周详细计划

### Day 1-2：项目脚手架
```
mkdir coderev && cd coderev
npm init -y
npm install -D typescript @types/node jest ts-jest
npm install commander chalk dotenv openai
npx tsc --init
```
- 搭好目录结构
- TypeScript 编译通过
- 第一个 Hello World CLI 跑通

### Day 3-4：CLI 框架 + 配置
- 实现 `coderev init` 命令
- 实现 `coderev config` 命令
- 配置文件读写（.coderevrc JSON）
- 参数解析

### Day 5-6：核心 review 功能
- diff 解析器（解析 unified diff）
- DeepSeek API 调用
- Prompt 模板设计
- 结果格式化输出

### Day 7：测试 + 收尾
- 单元测试覆盖
- 手动端到端测试
- README 初步文档

---

## 七、技术栈清单

| 工具 | 用途 |
|------|------|
| Node.js v24 | 运行时 |
| TypeScript | 语言 |
| Commander.js | CLI 框架 |
| Chalk | 彩色终端输出 |
| OpenAI SDK | DeepSeek API 调用（兼容 OpenAI） |
| dotenv | 环境变量 |
| Octokit | GitHub API |
| Jest | 测试框架 |
| ESLint + Prettier | 代码规范 |
| GitHub Actions | CI/CD |

---

## 八、学习路径（与我同步）

做这个项目的过程中，我会逐步掌握：

| 阶段 | 学会 |
|------|------|
| Phase 1 | TypeScript 基础、CLI 开发、API 调用、prompt 工程 |
| Phase 2 | GitHub API、CI/CD、Action 开发 |
| Phase 3 | 开源运营、npm 发布、文档写作 |
| 持续 | LLM 能力边界、代码审查最佳实践 |

---

## 九、风险 & 应对

| 风险 | 应对方案 |
|------|---------|
| DeepSeek API 不稳定 | 支持多模型后端（Ollama/OpenAI/通义） |
| 网络不好搜不了资料 | 本地已有知识 + 你帮我查 |
| 代码质量问题 | 先出 MVP，迭代优化 |
| 时间不够 | 每天 heartbeat 汇报进度，你随时调整优先级 |

---

**下一阶段：Phase 1 启动！** 🚀
