# AgentOS 开发计划 (v1.2 - v2.1)

> 基于智能审批、增值能力、能力拓展方向三份文档的任务排期
> v1.1 已取消：核心包+插件架构合理，无需独立化

---

## 一、版本全景

```
v1.2 ──→ v1.3 ──→ v1.4 ──→ v1.5 ──→ v2.0 ──→ v2.1
可配置     Dashboard   智能审批     断点续传   协作记忆池   通用化(远)
(1周)     (4周)      (3周)      (3周)     (3周)     (P3)
            │           │
            └── 含：故障复盘
                        └── 含：信用体系+健康体检+意图预测+工作区维护
```

---

## 二、详解### v1.2：可配置（1周）

**目标：** 用户可自定义拦截规则。

| 任务 | 文件 | 工时 | 验收 |
|------|------|------|------|
| 规则加载模块 | src/rule-loader.ts | 0.5天 | 读取 .agentos/rules.json |
| 自定义 DANGEROUS 规则 | src/rule-loader.ts | 0.5天 | 新增规则生效 |
| 自定义 WARNING 规则 | src/rule-loader.ts | 0.5天 | 新增规则生效 |
| 自定义 SENSITIVE/PROTECTED | src/rule-loader.ts | 0.5天 | 新增规则生效 |
| 热加载 | fs.watch 监听 rules.json | 0.5天 | 修改后5秒内生效 |
| 禁用内置规则 | rules.json 支持 "disabled": ["rule-key"] | 0.5天 | 禁用后拦截取消 |
| 规则优先级调整 | rules.json 支持 "override-severity" | 0.5天 | warning↔dangerous 切换 |
| 写示例 .agentos/rules.json | 项目根目录 | 0.5天 | 模板文件可参考 |
| 发版 v1.2 | npm publish + CHANGELOG | 0.5天 | npm 包 v1.2.0 |

**安全设计：** rules.json 格式错误时仅输出 warn，不阻止插件启动。



**同步规则：** 核心包 sentinel-agentos 发版时，插件 sentinel-agentos-plugin 同步适配发版。双包同步，功能不落后。
---

### v1.3：Dashboard + 故障复盘（4周）

**目标：** 可视化面板 + 自动事故复盘。

#### Dashboard 子任务（3周）

| 任务 | 文件 | 工时 | 验收 |
|------|------|------|------|
| 注册 3 个 HTTP 路由 | src/index.ts | 0.5天 | /sentinel/dashboard 可访问 |
| 统计卡片（4张） | src/dashboard/dashboard.html | 1天 | 显示实时数据 |
| 拦截趋势图（纯CSS柱状） | src/dashboard/dashboard.html | 0.5天 | 7天趋势 |
| 拦截记录列表 | src/dashboard/dashboard.html | 0.5天 | 最近20条+分页 |
| 工具热力图 | src/dashboard/dashboard.html | 0.5天 | exec/read/write 统计 |
| 运行时监控面板 | src/dashboard/dashboard.html | 1天 | JVM/GC/线程/CPU |
| 工作区健康面板 | src/dashboard/dashboard.html | 0.5天 | tidy 巡检结果展示 |
| 暗色主题样式 | src/dashboard/styles.css | 0.5天 | 与 OpenClaw 一致 |
| 数据查询 API | src/dashboard/api.ts | 0.5天 | /api/stats, /api/audit |
| 前端联调 | 与后端 API 打通 | 1天 | 所有面板数据正常 |

#### 故障复盘子任务（1周，与 Dashboard 并行）

| 任务 | 文件 | 工时 | 验收 |
|------|------|------|------|
| 事故检测模块 | src/audit-analyzer.ts | 0.5天 | 检测 openclaw.json 被覆盖等异常 |
| 事故报告生成 | src/audit-analyzer.ts | 1天 | 自动生成复盘 Markdown |
| 事故持久化 | .agentos/incidents/ 目录 | 0.5天 | 事故文件可查 |
| 关联分析 | 从事故回溯到 Agent 意图 | 0.5天 | 显示操作链 |
| Dashboard 事故 tab | src/dashboard/dashboard.html | 1天 | 最近事故列表+详情 |
| 发版 v1.3 | npm publish + CHANGELOG | 0.5天 | npm 包 v1.3.0 |

**关键交付：** 再发生 openclaw.json 被清空这种事故，3 秒自动生成复盘报告。

---

### v1.4：智能审批 + 信用体系 + 健康体检（3周）

#### 智能审批主任务（2周）

| 任务 | 文件 | 工时 | 验收 |
|------|------|------|------|
| 置信度评分引擎 | src/scoring.ts | 1天 | 五维度评分，输出 0-100 |
| DANGER_RATING 评级表 | src/scoring.ts | 0.5天 | 28+18 条规则绑定 S1-S5 |
| D2 用户历史行为评分 | src/behavior-model.ts | 1天 | 三阶匹配：一阶/二阶/三阶 |
| D3 上下文相关性评分 | src/scoring.ts | 0.5天 | lastAIMessage 关键词匹配 |
| D4 路径敏感度评级 | src/scoring.ts | 0.5天 | 路径类型分类 |
| D5 时间模式评分 | src/scoring.ts | 0.5天 | 时间/频率异常 |
| 决策映射 | src/index.ts 改造 | 1天 | 5段置信度→5种行为 |
| 替代方案库 | src/alternatives.ts | 0.5天 | 28+18 条规则绑定替代方案 |
| 行为模型持久化 | src/behavior-model.ts | 1天 | .agentos/behavior-model.json |
| 自进化规则 | src/behavior-model.ts | 0.5天 | 30天清理/allowRate调整 |
| 降级测试 | 删除 behavior-model.json | 0.5天 | 降级为原生拦截 |

#### 信用体系子任务（0.5周，与智能审批并行）

| 任务 | 文件 | 工时 | 验收 |
|------|------|------|------|
| 信用等级模块 | src/credit.ts | 0.5天 | L0-L3 四级 |
| 信用升降规则 | src/credit.ts | 0.5天 | 自动升级/降级 |
| 信用影响置信度 | 集成到 scoring.ts | 0.5天 | L3 less noisy |
| .agentos/credit.json | 信用模型持久化 | 0.5天 | 配置文件 |

#### 健康体检子任务（0.5周，与智能审批并行）

| 任务 | 文件 | 工时 | 验收 |
|------|------|------|------|
| 健康指标采集 | src/health.ts | 0.5天 | 重复率/错误率/延迟 |
| 异常自动处置 | src/health.ts | 0.5天 | 警告/严重处置 |
| Dashboard 健康 tab | src/dashboard/dashboard.html | 1天 | Agent 健康卡 |
| 异常推送 | 微信通知 | 0.5天 | Agent 异常时推送 |

**发版 v1.4：** npm publish + CHANGELOG（0.5天）

**关键交付：** npm publish 允许3次后不再弹窗；Agent 卡了自动通知你。

---

### v1.5：断点续传 + 意图预测 + 工作区维护（3周）

#### 断点续传子任务（1周）

| 任务 | 文件 | 工时 | 验收 |
|------|------|------|------|
| Session 摘要生成 | src/session-summary.ts | 1天 | 200-400字摘要 |
| session 结束时自动总结 | src/index.ts onSessionEnd | 0.5天 | 写入 .agentos/session-summary.json |
| session 开始时注入 | src/index.ts onSessionStart | 0.5天 | 注入到 system prompt |
| 与现在的 session_start 合并 | src/index.ts 清理旧代码 | 0.5天 | 不重复注入 |
| 测试：session 结束后重启 | 完整测试 | 0.5天 | 上下文正确恢复 |

#### 意图预测子任务（0.5周）

| 任务 | 文件 | 工时 | 验收 |
|------|------|------|------|
| 关键词映射表 | src/predict.ts | 0.5天 | 6组关键词→命令映射 |
| 意图预测注入 | src/predict.ts 集成到 before_prompt_build | 0.5天 | Agent 执行前收到安全提醒 |
| 与置信度评分联动 | 集成到 D3 维度 | 0.5天 | 预测命中时置信度-15 |

#### 工作区维护子任务（1.5周）

| 任务 | 文件 | 工时 | 验收 |
|------|------|------|------|
| 根目录策略检查 | src/tidy.ts | 0.5天 | 检测碎片/空文件/错位 |
| 临时脚本清理 | src/tidy.ts | 0.5天 | 自动移入 .agentos/.trash |
| 访问控制 workzone.json | src/tidy.ts | 1天 | 读取+执行工作区规则 |
| tidy --dry-run | 命令行入口 | 0.5天 | 只列出建议不执行 |
| tidy --auto | 命令行入口 | 0.5天 | 自动低风险清理 |
| 每日自动巡检 | 集成到 session_start | 0.5天 | session 开始前跑一次 |
| Dashboard 健康面板 | src/dashboard/dashboard.html | 0.5天 | 巡检结果展示 |

**发版 v1.5：** npm publish + CHANGELOG（0.5天）

---

### v2.0：多 Agent 协作记忆池（3周）

| 任务 | 文件 | 工时 | 验收 |
|------|------|------|------|
| shared-memory 目录结构 | .agentos/shared-memory/ | 0.5天 | 目录初始化 |
| per-Agent 状态文件 | src/shared-memory.ts | 1天 | 主Agent/coderev/learn bot 各自状态 |
| 跨 Agent 事件通知 | src/shared-memory.ts | 1天 | shared-events.jsonl |
| 共享冲突检测 | src/shared-memory.ts 集成到 before_tool_call | 1天 | 两个 Agent 写同一文件时排队 |
| Dashboard 协作 tab | src/dashboard/dashboard.html | 1天 | 显示各 Agent 状态 |
| 测试：多 Agent 并行 | coderev bot + 安妮同时跑 | 1天 | 不冲突 |
| 发版 v2.0 | npm publish + CHANGELOG | 0.5天 | npm 包 v2.0.0 |

---

### v2.0：多Agent协作记忆池(3周)

_（内容不变，略）_

---

## 三、工时汇总

| 版本 | 工期 | 核心交付 |
|------|------|---------|
| v1.1 | - | 已取消 |
| v1.2 | 1周 | 规则可配置（第一个版本） |
| v1.3 | 4周 | Dashboard + 故障复盘 |
| v1.4 | 3周 | 智能审批 + 信用体系 + 健康体检 |
| v1.5 | 3周 | 断点续传 + 意图预测 + 工作区维护 |
| v2.0 | 3周 | 协作记忆池 |
| **总计** | **16周** | **v1.2-v2.1 (核心包+插件同步)** |

**并行策略：** v1.3、v1.4 有部分可并行；v1.4 三个子任务并行（智能审批/信用/健康）。**发版规则：** 每个版本同时发布核心包 + 插件。

**最快可交付：**
- 第1周：v1.2 可配置 ✅
- 第4-5周：v1.3 Dashboard + 故障复盘 ✅


- 第4-5周：v1.3 Dashboard ✅
- 第7-8周：v1.4 智能审批 ✅
- 第10-11周：v1.5 断点续传 ✅
- 第14-16周：v2.0 协作记忆池 ✅
