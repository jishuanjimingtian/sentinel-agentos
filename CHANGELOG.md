# Changelog

## v0.2.0 (2026-06-11)

### 🆕 新功能

- **`sentinel-agentos init`** — 一键安装 Sentinel Guard Skill 到 OpenClaw workspace
  - 自动创建 `skills/sentinel-guard/` 目录
  - 复制 `sentinel-guard.js` + `SKILL.md` + 测试脚本
  - 自动添加 `.sentinel-audit/` 到 `.gitignore`
- **轻量 Guard (`sentinel-light.js`)** — 纯内存正则匹配，4.4μs/次，零依赖
  - 9 条危险命令黑名单（`rm -rf /`、`sudo rm`、`mkfs`、`fork bomb`、`dd` 等）
  - 6 条高风险确认规则（`git push --force`、`npm publish` 等）
  - 17 条敏感文件保护（`.env`、`*.key`、`*.pem`、`.git/**` 等）
  - 13 条保护文件（`package.json`、`MEMORY.md` 等）
- **全功能 Guard** — preCheck 轻量拦截 + postCheck AgentOS 完整审计
  - Schema Gate：参数格式 + 路径黑白名单
  - Risk Gate：四维公式 0-100 自动分级
  - Snapshot Gate：git HEAD + 文件 hash
  - Verify Gate：8 项确定性校验
  - Audit Log：JSONL 持久化不可篡改
  - 全局单例 + 审计日志持久化
- **Memory 层全启用**
  - Working Memory：工具调用消息缓存
  - Episodic Memory：事件时间线自动记录
  - Semantic Memory：用户偏好 + 事实 + 学习规则
- **Evaluator 层全启用**
  - Pre-Exec / Runtime / Post-Exec 三阶段评估
  - Implicit Feedback 隐性反馈引擎
  - Agent Profiler 质量画像

### 📝 文档

- README 补充 Token 鉴权说明（HTTP API Bearer Token）
- README 补充完整接口使用说明（CLI/SDK/HTTP 共 30+ 条接口）
- FAQ 新增 3 条（Token 怎么设置、泄漏了怎么办、是否需要 API Key）

### 🔧 改进

- `package.json` files 注册 `scripts/sentinel-light.js` 为可发布模块
- CLI 添加 `init` 命令和更新后 help 文本

---

## v0.1.3 (2026-06-10)

- README 中英双语
- v1.0 设计文档 100% 覆盖
- 99/99 测试全通过

## v0.1.2

- CLI 自然 key=value 参数语法

## v0.1.1

- 添加 LICENSE，改名为 sentinel-agentos

## v0.1.0

- 初始发布
- Guard 层（6 组件）
- Memory 层（3 层）
- Evaluator 层（5 组件）
- Sandbox 沙箱
- HTTP API Server
- CLI 命令行
- SDK 嵌入式 API
- OpenClaw 插件
