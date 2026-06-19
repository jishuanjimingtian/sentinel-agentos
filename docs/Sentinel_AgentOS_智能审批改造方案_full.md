# Sentinel AgentOS 智能审批改造方案

> 版本 v1.4 | 2026-06-16 | 基于置信度评分的行为学习系统

---

## 一、改造目标

将 Sentinel 从「被动拦截器」升级为「智能安全顾问」。核心能力：

1. **置信度评分**：对每次拦截请求计算 0-100 的置信度分数，替代简单的危险/警告二分
2. **行为学习**：基于用户历史决策自动调整置信度，越用越精准
3. **替代方案**：拦截时主动提示更安全的替代命令
4. **免打扰**：高频允许的操作自动降级，减少弹窗

---

## 二、架构设计

### 2.1 新增模块

| 模块 | 文件 | 职责 |
|------|------|------|
| 置信度引擎 | src/scoring.ts | 多维度评分、决策映射 |
| 行为模型 | src/behavior-model.ts | 历史模式存储、读取、更新 |
| 替代方案库 | src/alternatives.ts | 每条规则的替代命令映射 |

### 2.2 数据流

```
before_tool_call 触发
      ↓
命中 DANGEROUS / WARNING 规则
      ↓
ScoringEngine.score() 算置信度 (0-100)
      ↓
┌─────┬──────────────────────────────┐
│ <25 │ 25-45    │ 45-70  │ 70-85   │ 85+   │
│ 放行│ 弹窗+替代│ 需确认│ 需理由 │ 直接拒│
└─────┴──────────────────────────────┘
      ↓
用户决策 → BehaviorModel.record()
      ↓
下次同类请求：置信度自动调整
```

---

## 三、功能点详细说明

### 3.1 置信度评分引擎 (ScoringEngine)

**文件：src/scoring.ts**

#### 3.1.1 入口函数

```typescript
function calculateScore(event: ToolCallEvent, rule: RuleDef, model: BehaviorModel): number
// 返回 0-100 的置信度分数
// 0 = 确定安全，100 = 确定恶意
```

#### 3.1.2 五维度评分模型

| 维度编号 | 维度名称 | 权重 | 数据来源 | 说明 |
|---------|---------|------|---------|------|
| D1 | 命令危险度 | 35% | DANGER_RATING 静态表 | 命令本身的破坏级别 S1-S5 |
| D2 | 用户历史行为 | 25% | behavior-model.json | 之前对相似命令的决策 |
| D3 | 上下文相关性 | 20% | lastAIMessage 全局变量 | 最近任务与命令是否匹配 |
| D4 | 路径敏感度 | 15% | event.params.path/command | 目标路径的敏感级别 |
| D5 | 时间模式 | 5% | Date.now() + 历史 | 时间、频率异常检测 |

ok

### D2：用户历史行为评分

三阶匹配：
- 一阶：命令hash完全一致
- 二阶：参数模板匹配
- 三阶：意图语义匹配

| 匹配条件 | 调节 |
|---------|------|
| 一阶匹配+允许过 | 置信度=0 直接放行 |
| 二阶匹配允许>=3次 | -30 |
| 二阶匹配允许1-2次 | -15 |
| 二阶匹配从未见过 | 0 |
| 二阶匹配曾被拒绝 | +20 |
| 三阶语义匹配 | -10 |

### D3：上下文相关性评分

从 latestAIMessage 提取：

| 信号 | 调节 |
|-----|------|
| 命令与任务高度匹配 | -25 |
| 部分匹配 | -10 |
| 无关 | +10 |
| 矛盾 | +30 |
| 上下文缺失 | +5 |
| prompt injection 嫌疑 | +40 |

### D4：路径敏感度

| 路径 | 加分 |
|------|------|
| 系统核心路径 | +25 |
| 用户数据路径 | +15 |
| 项目路径 | +5 |
| 临时目录 | -10 |
| 隐藏文件/目录 | +10 |
| git仓库内 | +5 |
| 二进制文件 | +5 |
| 配置文件 | +10 |

### D5：时间模式

| 条件 | 加分 |
|------|------|
| 深夜 23:00-7:00 | +10 |
| 首次该命令类型 | +5 |
| 高频重复 | +5 |
| 拒绝后重试 | +15 |
| 工作时间 | 0 |

---

## 决策映射表

| 区间 | 行为 | 弹窗 |
|------|------|-----|
| 0-25 | 静默放行 | 无 |
| 25-45 | 轻提醒 | 黄色+替代+10秒自动放行 |
| 45-70 | 确认弹窗 | 橙色+替代+需手动确认 |
| 70-85 | 严格确认 | 红色+需输入理由 |
| 85-100 | 自动拒绝 | 无弹窗,记录严重事件 |

## 替代方案库

| 命令 | 替代方案 |
|------|---------|
| del /f /s | rmdir /s /q 或确认文件列表 |
| rm -rf / | 用精确路径 rm -rf <path> |
| chmod 777 | chmod 755 或按用户授权 |
| docker -v /:/host | 挂具体目录 -v /host/data:/data |
| docker --privileged | --cap-add=NET_ADMIN |
| DROP DATABASE | 先 pgdump 备份 |
| npm publish | npm publish --dry-run |
| git push --force | git push --force-with-lease |
| nc -e, format C: | 禁止替代,直接拒绝 |

## 行为模型

文件：`.agentos/behavior-model.json`

数据结构：
- patterns: { "命令模式": {count, allowed, denied, lastSeen, contextKeywords, confidenceOffset} }
- semanticPatterns: { "意图标签": {commandFamilies, count, confidenceOffset} }
- globalStats: {totalIntercepts, totalAllowed, totalDenied, allowRate}
- confidenceFloor: 全局置信度底线

API：
- load() - 启动时加载
- record(event, rule, decision, score) - 记录决策
- getOffset(event, rule) - 返回置信度调节值
- getStats() - 返回全局统计
- decay() - 每月清理过期模式

自进化规则：
- 30天未使用的模式 confidenceOffset 归零
- allowRate >= 80% 且 hits >= 10 → 额外 -5 放宽
- allowRate < 20% 且 hits >= 5 → 额外 +5 收紧
- 全局 allowRate > 90% → confidenceFloor 提高到 10
- 全局 allowRate < 30% → confidenceFloor 降低到 0

## 改造范围

| 类型 | 文件 | 改动 |
|------|------|------|
| 新增 | src/scoring.ts | 250行 |
| 新增 | src/behavior-model.ts | 200行 |
| 新增 | src/alternatives.ts | 80行 |
| 修改 | src/index.ts | 50行 |

兼容性：behavior-model.json 不存在 → 降级为原生拦截
回滚：删除三个新文件 + 还原 index.ts 即可

## 实现计划

| 步 | 内容 | 时间 |
|----|------|------|
| 1 | scoring.ts 五维度评分引擎 | 0.5天 |
| 2 | behavior-model.ts 行为模型 | 0.5天 |
| 3 | alternatives.ts 替代方案库 | 2小时 |
| 4 | index.ts 集成决策分支 | 1天 |
| 5 | 测试30个场景覆盖所有置信度区间 | 1天 |
| 6 | 发版 v1.4 + CHANGELOG | 0.5天 |

## 验收标准

1. npm publish 在用户允许 >=3 次后静默放行 (置信度<25)
2. del /f /s /tmp/test 弹窗显示替代方案 (置信度 25-70)
3. rm -rf / 首次执行直接拒绝 (置信度>85)
4. 用户拒绝后5分钟内再次相同操作置信度+15偏移
5. behavior-model.json 在10次操作后至少包含3条模式
6. 删除 behavior-model.json 后降级为原生拦截
7. 28+18 条规则均有对应替代方案

## 与 Claude Code Auto Mode 对比

| 维度 | Claude Code | Sentinel v1.4 |
|------|-------------|--------------|
| 决策方式 | 神经网络 classifier | 五维度评分+统计 |
| 学习方式 | 在线随机采样训练 | 用户行为模式聚合 |
| 替代方案 | Run anyway / Modify | 预定义替代命令库 |
| 可解释性 | 黑盒 | 每维度独立可解释 |
| 部署 | 服务端 | 本地隐私友好 |
| 冷启动 | 需预训练 | 规则匹配后降级学习 |

## 关键词检测表

上下文关键词 (降分)：
build, deploy, publish, release, test, debug, check, verify, inspect,
log, status, list, show, display, print, echo, read, cat, type,
clean, clear, remove, delete, reset, restart, refresh

注入关键词 (加分)：
ignore previous, forget earlier, disregard above, new instruction,
you are now, from now on, override, bypass, skip check,
do not ask, just do it, no confirmation, immediately