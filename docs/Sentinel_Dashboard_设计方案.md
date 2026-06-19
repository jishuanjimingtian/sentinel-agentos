# Sentinel Dashboard 可视化页面设计方案

> 版本 v1.0 | 2026-06-16 | HTML 单页应用, 零依赖, 暗色主题

---

## 一、设计目标

让用户一眼看懂 Sentinel 的运行状态、拦截历史、工作区健康度。

设计原则：
- 零配置：开箱即用，不需要额外服务或数据库
- 纯前端：单个 HTML 文件，直接读取 .agentos/ 下的 JSON 数据
- 本地优先：所有数据在本地，不联网
- 暗色主题：与 OpenClaw 控制台风格一致

---

## 二、页面布局

```
┌──────────────────────────────────────────────────┐
│  Sentinel Dashboard                   v1.0.7      │
├──────────┬──────────┬──────────┬─────────────────┤
│ 今日拦截  │ 审计总量   │ 活跃规则  │ CB 状态         │
│   12 次  │  1,100   │  46 条   │ 正常            │
├──────────┴──────────┴──────────┴─────────────────┤
│                                                  │
│     [拦截趋势图: 最近 7 天柱状图]                   │
│     ██████ ████ ████████ ██ █████                │
│                                                  │
├─────────────────────┬────────────────────────────┤
│ 最近拦截 (Top10)     │ 审计热力图                   │
│ rm -rf /   直接拒    │ exec  ████████████ 616     │
│ npm publish 弹窗允   │ read  ████████     176     │
│ del /f /s   弹窗拒   │ edit  ██████       73      │
│ ...                 │ write ██████       72      │
├─────────────────────┴────────────────────────────┤
│ 工作区健康度                                      │
│ [健康] 发现 3 个临时脚本 2 个空文件 建议清理        │
└──────────────────────────────────────────────────┘
```

---

## 三、功能模块详述

### 3.1 顶部统计卡片 (4个)

| 卡片 | 数据源 | 刷新 | 说明 |
|------|--------|------|------|
| 今日拦截 | audit.jsonl 当天记录 | 10秒 | 实时拦截次数, 颜色:红色>0/绿色=0 |
| 累计审计 | API stats | 30秒 | 总操作量, 鼠标悬停显示按工具分类 |
| 活跃规则 | 插件启动时报告 | 不变 | DANGEROUS+WARNING+敏感+保护总数 |
| CB 状态 | 插件内部变量 | 10秒 | 正常(绿)/打开(红)/熔断次数 |

卡片样式：深色圆角矩形，左上角图标，右下角数字，hover 放大 1.02x。

### 3.2 拦截趋势图

- 横轴：最近 7 天 (Mon-Sun)
- 双纵轴：拦截次数(柱) + 通过率(折线)
- 颜色：红=拒绝, 橙=弹窗, 绿=放行
- 实现：纯 CSS flexbox + div 柱状图, 不依赖 Chart.js
- 柱高 = 当天拦截数 / 7天最大值 * 100%
- 通过率线 = 放行数 / 总操作数 * 100%

### 3.3 最近拦截记录

- 从 audit.jsonl 读取最近 20 条, 分页加载更多
- 每行：时间 | 命令(截断50字符) | 结果 | 置信度(v1.4+)
- 颜色标记：红=block, 橙=requireApproval, 绿=allowed
- 点击某行 → 展开完整命令+上下文+路径+决策建议
- 搜索过滤：支持按命令关键词搜索

### 3.4 工具热力图

- 按工具类型(exec/read/write/edit/web_*) 分组统计
- 水平柱状图, 颜色深度代表操作频率
- 实现：宽度 = 该工具次数 / 总次数 * 100% 的 div bar
- 左侧工具名, 右侧次数
- 排名自动刷新

### 3.5 规则命中率

- 每个 DANGEROUS/WARNING 规则显示命中次数
- 颜色编码：绿=高命中(>10/月), 黄=中(1-10), 灰=零命中(dead rule)
- 按命中次数降序排列
- 展开每条规则：显示最近 3 次命中详情
- 零命中的规则可一键禁用

### 3.6 工作区健康面板 (v1.5+)

- 显示 tidy 巡检结果
- 状态灯：绿=健康, 黄=有建议, 红=有严重问题
- 列出：碎片文件/空目录/错位文件/过期备份
- 一键清理按钮 → 执行 tidy --auto
- 清理后自动刷新面板

### 3.7 时间线视图

- 按时间倒序展示今天所有操作
- 左侧时间戳, 右侧操作卡片
- 拦截操作红色左边框高亮
- 每张卡片：工具图标 + 命令摘要 + 结果
- 无限滚动自动加载更多

---

## 四、技术选型

| 项 | 选择 | 原因 |
|------|------|------|
| 框架 | 无框架 (Vanilla JS) | 零依赖, 极小体积(<50KB) |
| 图表 | 纯 CSS flexbox + div | 简单可靠, 不需要外部库 |
| 样式 | 内联 style 标签 | 单文件部署 |
| 数据 | fetch API 读取本地 JSON | 通过 Sentinel HTTP 路由 |
| 刷新 | setInterval | 简单可靠 |
| 主题 | CSS 变量暗色主题 | 一致性 |

---

## 五、配色方案 (暗色主题)

```css
:root {
  --bg-primary: #0f172a;       /* 深蓝黑背景 */
  --bg-card: #1e293b;          /* 卡片背景 */
  --bg-card-hover: #273548;    /* 卡片悬停 */
  --text-primary: #e2e8f0;     /* 主文字 */
  --text-secondary: #94a3b8;   /* 次要文字 */
  --text-muted: #64748b;       /* 淡化文字 */
  --accent-blue: #3b82f6;      /* 强调蓝 */
  --accent-green: #22c55e;     /* 放行绿 */
  --accent-red: #ef4444;       /* 拦截红 */
  --accent-orange: #f59e0b;    /* 弹窗橙 */
  --accent-purple: #8b5cf6;    /* 统计紫 */
  --border: #334155;           /* 边框 */
  --radius: 8px;
  --shadow: 0 4px 6px -1px rgba(0,0,0,0.3);
}
```

---

## 六、后端 API 设计

插件注册 3 个 HTTP 路由：

| 路由 | 方法 | 返回 | 说明 |
|------|------|------|------|
| /sentinel/dashboard | GET | HTML | 返回 dashboard.html |
| /sentinel/api/stats | GET | JSON | 实时统计 |
| /sentinel/api/audit | GET | JSON | 审计查询 |

### API 响应格式

**GET /sentinel/api/stats**
```json
{
  "todayIntercepts": 12,
  "totalOps": 1100,
  "activeRules": 46,
  "cbStatus": "normal",
  "byTool": {"exec": 616, "read": 176},
  "trend7d": [8, 3, 5, 12, 7, 4, 2],
  "allowRate": 0.83
}
```

**GET /sentinel/api/audit?since=24h&limit=20**
```json
{
  "total": 45,
  "records": [
    {"ts":"2026-06-16T11:25","tool":"exec","cmd":"rm -rf /","result":"blocked","score":95}
  ]
}
```

---

## 七、文件结构

```
plugins/sentinel-agentos/
├── src/
│   ├── index.ts              # 注册 HTTP 路由
│   └── dashboard/
│       ├── dashboard.html    # 单页应用 (< 800行)
│       ├── api.ts            # 数据查询逻辑
│       └── styles.css        # 暗色主题样式
```

---

## 八、实现计划

| 步骤 | 内容 | 工时 |
|------|------|------|
| 1 | index.ts 注册 3 个 HTTP 路由 + 数据 API | 0.5天 |
| 2 | dashboard.html 基础布局 + 暗色主题 | 1天 |
| 3 | 统计卡片 + 趋势图(纯CSS柱状) | 0.5天 |
| 4 | 拦截记录列表 + 工具热力图 | 0.5天 |
| 5 | 规则命中率 + 工作区健康面板 | 0.5天 |
| 6 | 时间线视图 | 0.5天 |
| 7 | 联调测试 | 0.5天 |

总工时：约 4 天

---

## 九、访问方式

开发阶段：`https://localhost:18789/sentinel/dashboard`

生产部署：通过 OpenClaw Gateway 插件页面访问，或独立 HTTP 端口。

---

> 扩展 Dashboard 设计方案, 增加 JVM/GC/进程监控面板

---

## Agent 运行时监控面板

在 Dashboard 新增第 5 个顶级 tab：「运行时」

```
┌──────────────────────────────────────────────┐
│  [概览] [拦截] [审计] [健康] [运行时] [设置]  │
├──────────────────────────────────────────────┤
│                                              │
│  ┌─────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ CPU 使用  │ │ 内存使用   │ │ GC 统计       │  │
│  │  23%     │ │ 512MB/2G  │ │ Minor: 42次   │  │
│  │ [████░░] │ │ [██████░░]│ │ Full:   3次   │  │
│  └─────────┘ └──────────┘ └───────────────┘  │
│                                              │
│  ┌──────────────────┐ ┌────────────────────┐ │
│  │ 内存趋势 (1h)      │ │ GC 时间分布         │ │
│  │    /\    /\       │ │ Minor GC avg 12ms  │ │
│  │   /  \  /  \____  │ │ Full GC avg  240ms │ │
│  │  /    \/         │ │ Total GC time 2.3s │ │
│  └──────────────────┘ └────────────────────┘ │
│                                              │
│  ┌──────────────────────────────────────────┐│
│  │ 线程监控                                  ││
│  │ 活跃: 8  峰值: 24  阻塞: 0  等待: 3      ││
│  │ [活] [活] [活] [活] [活] [活] [等] [等]   ││
│  └──────────────────────────────────────────┘│
│                                              │
│  ┌──────────────────────────────────────────┐│
│  │ Node.js Runtime 信息                      ││
│  │ V8 Heap: 128MB/512MB | Event Loop Lag    ││
│  │ Handles: 42 | Requests: 156/min          ││
│  └──────────────────────────────────────────┘│
└──────────────────────────────────────────────┘
```

---

## 一、针对不同运行时的监控

### 1.1 Java Agent (JVM)

| 监控项 | 数据来源 | 刷新 | 展示方式 |
|--------|---------|------|---------|
| Heap 使用 | MemoryMXBean.getHeapMemoryUsage() | 5秒 | 进度条 + 数值 |
| Non-Heap | MemoryMXBean.getNonHeapMemoryUsage() | 5秒 | 进度条 |
| GC 次数 | GarbageCollectorMXBean.getCollectionCount() | 5秒 | 卡片数字 |
| GC 耗时 | GarbageCollectorMXBean.getCollectionTime() | 5秒 | 累计毫秒 |
| GC 类型 | PS Scavenge(Minor) / PS MarkSweep(Full) | 5秒 | 分类统计 |
| 线程数 | ThreadMXBean.getThreadCount() | 5秒 | 活跃/峰值/阻塞/等待 |
| 类加载 | ClassLoadingMXBean | 30秒 | 已加载/未加载 |
| 运行时间 | RuntimeMXBean.getUptime() | 30秒 | 天:时:分 |
| CPU 时间 | OperatingSystemMXBean | 10秒 | 进度条百分比 |
| 死锁检测 | ThreadMXBean.findDeadlockedThreads() | 30秒 | 警报名单 |

### 1.2 Node.js Agent

| 监控项 | 数据来源 | 刷新 | 展示方式 |
|--------|---------|------|---------|
| Heap Used | process.memoryUsage().heapUsed | 5秒 | 进度条 |
| Heap Total | process.memoryUsage().heapTotal | 5秒 | 数值 |
| RSS | process.memoryUsage().rss | 5秒 | 数值 |
| External | process.memoryUsage().external | 5秒 | Buffer 内存 |
| Event Loop Lag | perf_hooks.monitorEventLoopDelay | 5秒 | 毫秒 + 趋势图 |
| Active Handles | process._getActiveHandles() | 10秒 | 数量 |
| Active Requests | process._getActiveRequests() | 10秒 | 数量 |
| CPU User/System | process.cpuUsage() | 10秒 | 微秒 → 百分比 |
| Uptime | process.uptime() | 30秒 | 时间格式 |

### 1.3 操作系统级别 (适用于所有运行时)

| 监控项 | 数据来源 | 说明 |
|--------|---------|------|
| 系统内存 | os.freemem() / os.totalmem() | 整机内存 |
| 系统 CPU | os.cpus() | 每个核心负载 |
| 磁盘使用 | fs.statfs (Linux) | 数据目录磁盘空间 |
| 网络 IO | os.networkInterfaces() | 收发字节数 |

---

## 二、GC 详细视图

### 2.1 GC 实时瀑布图

```
最近 50 次 GC 事件 (横轴=时间, 纵轴=耗时ms)
┌────────────────────────────────────────┐
│  250ms ┤                          ■    │  ← Full GC 耗时高
│  200ms ┤                               │
│  150ms ┤                               │
│  100ms ┤                               │
│   50ms ┤     ■  ■ ■                    │
│   10ms ┤  ■ ■■■■■■ ■ ■  ■ ■ ■■■ ■ ■   │  ← Minor GC 频繁但快
│    0ms ┤■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■│
└────────────────────────────────────────┘
```

颜色：绿=Minor GC (<50ms), 黄=Full GC (50-200ms), 红=Full GC (>200ms)

### 2.2 GC 统计摘要

| 指标 | 值 |
|------|-----|
| Minor GC 总次数 | 1,247 |
| Minor GC 平均耗时 | 12ms |
| Minor GC 频率 | 3.2次/分钟 |
| Full GC 总次数 | 3 |
| Full GC 平均耗时 | 240ms |
| Full GC 上次时间 | 2小时前 |
| GC 暂停总时间 | 15.6秒 |
| GC 吞吐率 | 99.92% (非GC时间/总时间) |

### 2.3 堆内存分布

```
堆内存使用详情
┌────────────────────────────────────────┐
│ Eden        ████████████████░░░  78%   │
│ Survivor 0  ████░░░░░░░░░░░░░░  22%   │
│ Survivor 1  ░░░░░░░░░░░░░░░░░░  0%    │
│ Old Gen     ██████░░░░░░░░░░░░  35%   │
│ Metaspace   ████████████████░░  82%   │
└────────────────────────────────────────┘
```

---

## 三、告警规则

| 告警 | 条件 | 级别 | 通知方式 |
|------|------|------|---------|
| 内存使用 > 85% | heapUsed / heapMax > 0.85 | ⚠️ 警告 | 面板红闪 |
| 内存使用 > 95% | heapUsed / heapMax > 0.95 | 🔴 严重 | 面板红闪 + 推送 |
| Full GC 频率过高 | > 2次/10分钟 | ⚠️ 警告 | 面板提醒 |
| Full GC 耗时过长 | 单次 > 1秒 | 🔴 严重 | 面板红闪 |
| 死锁检测到 | findDeadlockedThreads() 非空 | 🔴 严重 | 面板红闪 + 推送 |
| CPU > 90% 持续 5 分钟 | cpuUsage 持续高 | ⚠️ 警告 | 面板提醒 |
| Event Loop Lag > 100ms | Node.js 持续高延迟 | ⚠️ 警告 | 面板提醒 |

---

## 四、数据采集方式

### 4.1 插件内采集 (Node.js Agent)

```typescript
// src/dashboard/runtime-metrics.ts

import * as os from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";

function collectNodeMetrics() {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    rss: mem.rss,
    external: mem.external,
    cpuUser: cpu.user,
    cpuSystem: cpu.system,
    uptime: process.uptime(),
    systemMemFree: os.freemem(),
    systemMemTotal: os.totalmem(),
    loadAvg: os.loadavg(),
  };
}
```

### 4.2 远程 Agent 采集 (Java JVM)

通过 Sentinel Agent 的 sidecar 进程定期读取 JMX 指标：

```typescript
// Sentinel 作为数据聚合层, 接收各 Agent 上报的指标

interface AgentMetrics {
  agentId: string;
  runtime: "java" | "node" | "python";
  timestamp: number;
  metrics: {
    heap?: { used: number; max: number };
    gc?: { minorCount: number; minorTime: number; fullCount: number; fullTime: number };
    threads?: { active: number; blocked: number; waiting: number; peak: number };
    cpu?: number;
    uptime?: number;
  };
}
```

### 4.3 HTTP 路由

```
GET /sentinel/api/runtime
  → 返回当前 Sentinel 所在 Node.js 进程的运行时指标

GET /sentinel/api/runtime/:agentId
  → 返回指定 Agent 的运行时指标

GET /sentinel/api/runtime/:agentId/gc
  → 返回最近 50 次 GC 事件
```

---

## 五、前端展示实现

### 5.1 GC 瀑布图

纯 CSS + div 实现，不需要 Canvas：

```css
.gc-chart {
  position: relative;
  height: 250px;
  background: var(--bg-card);
  border-left: 2px solid var(--text-muted);
  border-bottom: 2px solid var(--text-muted);
}
.gc-point {
  position: absolute;
  width: 8px;
  border-radius: 2px;
}
.gc-point.minor { background: var(--accent-green); }
.gc-point.full  { background: var(--accent-red); }
```

### 5.2 内存环形图

纯 SVG 环形进度条：

```html
<svg viewBox="0 0 120 120">
  <circle cx="60" cy="60" r="50" class="ring-bg"/>
  <circle cx="60" cy="60" r="50" class="ring-fill"
          stroke-dasharray="240 360"
          stroke="var(--accent-blue)"/>
  <text x="60" y="65" class="ring-text">78%</text>
</svg>
```

### 5.3 实时折线图

每 5 秒 append 新数据点，左侧滚动：

```javascript
function updateLineChart(data, element) {
  const max = Math.max(...data);
  const bars = data.slice(-60).map(v => {
    const h = (v / max) * 100;
    return `<div class="bar" style="height:${h}%"></div>`;
  });
  element.innerHTML = bars.join("");
}
```

---

## 六、实现计划 (Dashboard v1.1 扩展)

| 步骤 | 内容 | 工时 |
|------|------|------|
| 1 | runtime-metrics.ts: Node.js 指标采集 | 0.5天 |
| 2 | /api/runtime 路由 + 数据聚合 | 0.5天 |
| 3 | 运行时面板布局 (卡片 + 进度条) | 0.5天 |
| 4 | GC 瀑布图 + 堆内存分布 | 1天 |
| 5 | 内存趋势图 + CPU 折线图 (纯CSS) | 0.5天 |
| 6 | 告警规则 + 面板红闪效果 | 0.5天 |
| 7 | 远程 Agent 上报接口 (sidecar) | 1天 |
| 8 | 联调测试 | 0.5天 |

总工时：约 5 天 (含远程支持)

---

## 七、完整 tab 导航结构

```
Sentinel Dashboard
├── [概览]   ← 4卡片 + 趋势图 + 快速状态
├── [拦截]   ← 拦截记录 + 规则命中率
├── [审计]   ← 工具热力图 + 审计查询
├── [健康]   ← 工作区健康面板 + tidy
├── [运行时] ← JVM/GC/线程/CPU 💡 本次新增
└── [设置]   ← 规则配置 + 阈值调整
```