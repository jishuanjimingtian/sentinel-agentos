# Changelog

## v0.4.0 (2026-06-17)

### 🆕 v1.3 Dashboard + 故障复盘

- **Dashboard Tab 导航** — 📊概览/📈趋势/🔥热力图/🚨事故 四 Tab 切换
- **统计卡片** — 总操作/通过率/高风险/质量评分/会话数，动画数字过渡
- **7天趋势图** — 纯 CSS 柱状图展示每日拦截趋势（/api/timeline）
- **工具热力图** — exec/read/write 调用量条形分布（/api/hotmap）
- **故障复盘引擎** — 检测 openclaw.json 被覆盖、高风险操作频发、批量删除等异常
  - 3 秒自动扫描审计日志
  - 自动生成 Markdown 复盘报告
  - 事故列表持久化（.agentos/incidents/）
  - Dashboard 事故 Tab 可标记解决
- **Dashboard API** — /api/stats, /api/timeline, /api/hotmap, /api/audit, /api/incidents
- **新增模块** src/dashboard/api.ts, src/audit-analyzer.ts
- **新增导出** DashboardAPI, AuditAnalyzer

---

## v0.3.13 (2026-06-17)

### 🆕 v1.2 可配置规则

- **自定义规则追加** — 支持 `.agentos/rules.json` 配置 4 类自定义规则
  - `dangerous` — 追加危险命令黑名单，匹配即拦截
  - `warning` — 追加警告命令，匹配弹窗确认
  - `sensitive` — 追加敏感文件 glob 模式，命中 block
  - `protected` — 追加保护文件 glob 模式，命中弹窗确认
- **禁用内置规则** — `disabled` 数组可禁用任意内置规则（按 key 匹配）
- **优先级覆盖** — `overrideSeverity` 支持 warning↔dangerous 升降级
- **热加载** — `fs.watch` 监听 rules.json，修改后 5 秒内自动生效
- **格式容错** — rules.json 解析失败时仅 warn，不阻止启动
- **示例模板** — 插件启动时自动生成 `.agentos/rules.json` 模板文件
- **新增 `src/rule-loader.ts`** — 规则加载 + 解析 + 热加载引擎
- **42 条内置规则 key 映射** — 支持按描述名引用禁用/覆盖

---

## v0.3.11 (2026-06-14)

### 🐛 修复

- **P0-1 stats byTool 统计 undefined** — audit-log.ts 加 `toolName || tool` fallback，兼容 plugin hook 轻量审计
- **P1-3 审计格式统一** — plugin hook 写入使用 `toolName` 字段 + `stage: "light"` 标记
- **P1-4 profile 假阳性 warning** — profiler.ts warning 加 `this.*Metrics.length > 0` 条件，无数据时不发 warning
- **P2-6 episodic 噪音过滤** — plugin WATCHDOG_PATTERNS 加 `echo` 和 `npx sentinel-agentos` 过滤
- **episodic 压缩无限循环** — compressIfNeeded 加 `MAX_ITERATIONS=100` 安全帽 + last-resort filter
- **generateContextSummary 截断不精确** — 改为严格 `result.slice(0, maxChars-3) + '...'`
- **episodic 测试不稳定** — getAll 排序测试改为容忍同 ms 事件；truncate 测试放宽限制

### 🧪 测试

- 15 套件 296 测试全部通过（含 4 skip）

---

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
