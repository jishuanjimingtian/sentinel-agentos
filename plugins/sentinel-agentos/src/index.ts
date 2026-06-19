/**
 * Sentinel AgentOS OpenClaw Plugin (v1.4)
 *
 * v1.4 智能审批集成：
 *   - before_tool_call: 置信度评分 (D1-D5) + 行为追踪 + 确定性拦截
 *   - after_tool_call: 审计 + 行为记录
 *   - session_start: 上下文注入 + 记忆快照
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { AgentOS, BehaviorModel, CreditSystem, computeConfidence, scoreD1, scoreD2, scoreD3, scoreD4, scoreD5, RuleLoader } from "sentinel-agentos";
import type { ConfidenceResult, LoadedRules } from "sentinel-agentos";
import * as path from "node:path";
import * as fs from "node:fs";

// ═══════════════════════════════════════
// Types
// ═══════════════════════════════════════

interface ToolCallEvent {
  toolName: string;
  params?: Record<string, unknown>;
  error?: unknown;
  startedAt?: number;
  completedAt?: number;
}

// ═══════════════════════════════════════
// Global state
// ═══════════════════════════════════════

let aos: AgentOS | null = null;
let aosReady = false;
let workspaceRoot = "";

// v1.4 独立实例（核心包未就绪时的备用）
let behaviorModel: BehaviorModel | null = null;
let creditSystem: CreditSystem | null = null;

// Circuit breaker
let consecutiveErrors = 0;
const CB_THRESHOLD = 5;
const CB_COOLDOWN_MS = 300_000;
let cbOpenUntil = 0;
let cbTotalTrips = 0;

// 上一次 AI 消息摘要
let lastAIMessage = "";

// 审计去重
const recentAuditKeys = new Set<string>();
let auditKeyCleanupTs = 0;

// ═══════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════

function detectWorkspace(): string {
  if (process.env.OPENCLAW_WORKSPACE) return process.env.OPENCLAW_WORKSPACE;
  const home = process.env.USERPROFILE || process.env.HOME || "";
  return path.join(home, ".openclaw", "workspace");
}

function globMatch(pattern: string, filepath: string): boolean {
  const SENTINEL = "\x00";
  const p = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, `${SENTINEL}**${SENTINEL}`)
    .replace(/\*/g, "[^/\\\\]*")
    .replace(new RegExp(`${SENTINEL}\\*\\*${SENTINEL}`, "g"), ".*");
  return new RegExp(`(^|[/\\\\])${p}$`, "i").test(filepath);
}

function dateStamp(): string {
  return new Date().toISOString().split("T")[0];
}

let pluginApi: any = null;

function log(msg: string): void {
  const cbState = cbOpenUntil > Date.now() ? " [CB:OPEN]" : consecutiveErrors > 0 ? ` [CB:${consecutiveErrors}/${CB_THRESHOLD}]` : "";
  const text = `[Sentinel]${cbState} ${msg}`;
  if (pluginApi?.logger?.info) pluginApi.logger.info(text);
  else console.log(text);
}

function warn(msg: string): void {
  const text = `[Sentinel] ${msg}`;
  if (pluginApi?.logger?.warn) pluginApi.logger.warn(text);
  else console.warn(text);
}

// ═══════════════════════════════════════
// Circuit Breaker
// ═══════════════════════════════════════

function cbIsOpen(): boolean {
  if (cbOpenUntil === 0) return false;
  if (Date.now() > cbOpenUntil) {
    cbOpenUntil = 0;
    consecutiveErrors = 0;
    log("Circuit breaker 冷却结束，恢复审计");
    return false;
  }
  return true;
}

function cbRecordError(): void {
  consecutiveErrors++;
  if (consecutiveErrors >= CB_THRESHOLD) {
    cbOpenUntil = Date.now() + CB_COOLDOWN_MS;
    cbTotalTrips++;
    warn(`Circuit breaker 触发！连续 ${consecutiveErrors} 次异常，暂停审计 ${CB_COOLDOWN_MS / 1000}s (总计 ${cbTotalTrips} 次)`);
  }
}

function cbRecordSuccess(): void {
  if (consecutiveErrors > 0) consecutiveErrors = Math.max(0, consecutiveErrors - 1);
}

// ═══════════════════════════════════════
// 审计日志
// ═══════════════════════════════════════

const MAX_AUDIT_SIZE = 1_048_576;
const AUDIT_RETENTION_DAYS = 7;

function rotateAuditLog(auditDir: string): string {
  const auditFile = path.join(auditDir, "audit.jsonl");
  try {
    if (fs.existsSync(auditFile)) {
      const stat = fs.statSync(auditFile);
      if (stat.size > MAX_AUDIT_SIZE) {
        const archive = path.join(auditDir, `audit-${dateStamp()}.jsonl`);
        if (!fs.existsSync(archive)) {
          fs.renameSync(auditFile, archive);
          log(`审计日志已归档: audit-${dateStamp()}.jsonl (${(stat.size / 1024).toFixed(1)} KB)`);
        } else {
          fs.writeFileSync(auditFile, "", "utf-8");
          log(`审计日志已清空 (已有当天归档)`);
        }
      }
    }
    const files = fs.readdirSync(auditDir).filter(f => f.startsWith("audit-") && f.endsWith(".jsonl"));
    const cutoff = Date.now() - AUDIT_RETENTION_DAYS * 86_400_000;
    for (const f of files) {
      const fp = path.join(auditDir, f);
      try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return path.join(auditDir, "audit.jsonl");
}

let auditBuffer: string[] = [];
let auditFlushTimer: ReturnType<typeof setTimeout> | null = null;
let auditFilePath = "";

function auditWrite(line: string): void {
  auditBuffer.push(line);
  if (auditBuffer.length >= 20) auditFlush();
  else if (!auditFlushTimer) auditFlushTimer = setTimeout(auditFlush, 2000).unref();
}

function auditFlush(): void {
  if (auditFlushTimer) { clearTimeout(auditFlushTimer); auditFlushTimer = null; }
  if (auditBuffer.length === 0 || !auditFilePath) return;
  const batch = auditBuffer.splice(0);
  setImmediate(() => {
    try { fs.appendFileSync(auditFilePath, batch.join("\n") + "\n", "utf-8"); } catch { /* discard */ }
  });
}

// ═══════════════════════════════════════
// 规则定义
// ═══════════════════════════════════════

const DANGEROUS_COMMANDS: Array<[RegExp, string]> = [
  [/rm\s+-rf\s+\//, "rm -rf / — 删除整个系统"],
  [/sudo\s+rm/, "sudo rm — 提权删除"],
  [/chmod\s+777/, "chmod 777 — 开放所有权限"],
  [/mv\s+\/[^\s]*\s+\/dev\/null/, "mv ... /dev/null — 破坏关键路径"],
  [/:\{\s*:\|[\s]*:&\s*\};?\s*:/, "Fork Bomb — 耗尽系统资源"],
  [/>\s*\/dev\/sd[a-z]\d*/, "覆盖磁盘设备 — 破坏分区表"],
  [/dd\s+if=.+\s+of=\/dev\/sd/, "dd 写入磁盘设备 — 覆盖分区"],
  [/del\s+\/f\s+\/s/, "del /f /s — 强制递归删除"],
  [/rd\s+\/s\s+\/q\s+[A-Z]:\\/, "rd /s /q C:\\ — 递归删除盘符"],
  [/Remove-Item\s.*-Recurse\s.*-Force/, "Remove-Item -Recurse -Force — PowerShell 递归删除"],
  [/format\s+[a-z]:/, "format — 格式化磁盘"],
  [/cipher\s+\/w/, "cipher /w — 安全擦除磁盘空间"],
  [/docker\s+run\s+.*-v\s+\/\s*:\s*\/host/, "docker run -v /:/host — 挂载宿主机根目录"],
  [/docker\s+run\s+.*--privileged/, "docker run --privileged — 特权容器"],
  [/DROP\s+DATABASE\b/, "DROP DATABASE — 删除数据库"],
  [/DROP\s+TABLE\b/, "DROP TABLE — 删除表"],
  [/TRUNCATE\s+(TABLE\s+)?\w+/, "TRUNCATE — 清空表数据"],
  [/nc\s+-e/, "nc -e — 反向 Shell"],
  [/\|\s*sh$/, "管道到 sh — 执行未知脚本"],
  [/\|\s*bash$/, "管道到 bash — 执行未知脚本"],
  [/curl\s+.*\|\s*(ba)?sh/, "curl | sh — 执行远程脚本"],
  [/wget\s+.*-O\s*-\s*\|/, "wget 管道 — 执行远程脚本"],
];

const WARNING_COMMANDS: Array<[RegExp, string]> = [
  [/git\s+push\s+--force/, "git push --force — 强制推送"],
  [/git\s+push\s+-f\b/, "git push -f — 强制推送"],
  [/git\s+reset\s+--hard/, "git reset --hard — 硬重置"],
  [/git\s+commit\s+--amend\s+--no-edit/, "git commit --amend — 修改提交历史"],
  [/npm\s+publish/, "npm publish — 发布到 npm 仓库"],
  [/npm\s+unpublish/, "npm unpublish — 下架包"],
  [/docker\s+rm/, "docker rm — 删除容器"],
  [/docker\s+system\s+prune/, "docker system prune — 清理 Docker"],
];

const SENSITIVE_PATTERNS = [
  ".env", ".env.*", "*.key", "*.pem", "*.p12", "*.pfx", "*.jks", "*.keystore",
  ".git/**", "**/credentials/**", "**/secrets/**", "**/SECRETS/**",
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock",
];

const PROTECTED_PATTERNS = [
  "openclaw.json", "openclaw.*.json", "config.yaml", "config.yml",
  "gateway.yaml", "gateway.yml", "gateway.json",
  "AGENTS.md", "SOUL.md", "MEMORY.md", "USER.md",
];

const WATCHDOG_PATTERNS: RegExp[] = [
  /health/i, /3408/, /3456/, /dashboard-watchdog/i,
  /cleanup-session-locks/i, /agentos-memory-sync/i,
  /mem-sync/i, /episodic.*sync/i,
  /^echo\s/, /^npx sentinel-agentos/,
];

// ═══════════════════════════════════════
// 内容校验
// ═══════════════════════════════════════

function validateContent(filepath: string, content: string): string | null {
  const ext = path.extname(filepath).toLowerCase();
  if (ext === ".json") {
    try { JSON.parse(content); return null; }
    catch (e: unknown) { return `JSON 语法错误: ${e instanceof Error ? e.message : String(e)}`; }
  }
  if ((ext === ".yaml" || ext === ".yml") && content.includes("\t") && content.includes("  ")) {
    return "YAML 缩进混用：同时包含 tab 和空格";
  }
  return null;
}

function expandNodeEval(cmd: string): string | null {
  const m = cmd.match(/node\s+-e\s+"([^"]*)"/);
  if (!m) return null;
  const expanded = m[1].replace(/'([^']*)'\s*\+\s*'([^']*)'/g, "'$1$2'");
  if (expanded === m[1]) return null;
  return expandNodeEval(cmd.replace(m[1], expanded)) || cmd.replace(m[1], expanded);
}

function isWatchdogCommand(cmd: string): boolean {
  for (const re of WATCHDOG_PATTERNS) { if (re.test(cmd)) return true; }
  return false;
}

// ═══════════════════════════════════════
// 简易风险评分（AgentOS 未就绪时用）
// ═══════════════════════════════════════

const FALLBACK_RISK: Record<string, number> = {
  exec: 3, write: 2, edit: 2, delete: 4, read: 0.3,
  web_search: 0.5, web_fetch: 0.5, apply_patch: 3,
};

function fallbackRiskScore(toolName: string, params?: Record<string, unknown>): number {
  const base = FALLBACK_RISK[toolName] ?? 1;
  const cmd = String(params?.command || "");
  if (/rm\s+-rf\s+\//.test(cmd)) return 10;
  if (/sudo/.test(cmd)) return 8;
  if (/drop\s|truncate\s|format\s/.test(cmd)) return 9;
  if (/git\s+push\s+--force/.test(cmd)) return 5;
  if (/npm\s+publish/.test(cmd)) return 4;
  return base;
}

// ═══════════════════════════════════════
// AgentOS 异步初始化
// ═══════════════════════════════════════

function initAgentOSAsync(): void {
  setImmediate(() => {
    try {
      aos = new AgentOS({ workspaceRoot });

      // v1.4 智能审批直接挂到 AgentOS 实例上
      if (typeof (aos as any).scoring === "object") {
        log(`v1.4 智能审批已就绪 (置信度+行为+信用)`);
      } else {
        // 备用：单独初始化
        behaviorModel = new BehaviorModel();
        (behaviorModel as any).enablePersistence(workspaceRoot);
        creditSystem = new CreditSystem();
        (creditSystem as any).enablePersistence(workspaceRoot);
        log(`v1.4 智能审批已就绪 (备用模式)`);
      }

      aosReady = true;
      deduplicateEpisodic();
      log(`AgentOS v0.4.0 已加载 → ${workspaceRoot}`);
    } catch (e: unknown) {
      warn(`AgentOS 初始化失败: ${e instanceof Error ? e.message : String(e)}`);
      aos = null;
      aosReady = false;
    }
  });
}

function deduplicateEpisodic(): void {
  if (!aos) return;
  try {
    const events = aos.memory.episodic as unknown as {
      events?: Array<{ id: string; type: string; content: string; tags?: string[] }>;
      count?: number;
    };
    if (!events.events || !Array.isArray(events.events)) return;
    const seen = new Set<string>();
    const deduped: typeof events.events = [];
    for (const ev of events.events) {
      if (ev.tags?.some(t => t === "sync")) continue;
      if (ev.content && (ev.content.includes("Sync completed") || ev.content.includes("health"))) continue;
      const key = `${ev.type}::${ev.content}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(ev);
    }
    const before = events.events.length;
    events.events = deduped;
    if (events.count !== undefined) events.count = deduped.length;
    const removed = before - deduped.length;
    if (removed > 0) log(`episodic 去重: ${before} → ${deduped.length} (删除 ${removed})`);
  } catch { /* non-critical */ }
}

// ═══════════════════════════════════════
// v1.4 置信度包装器
// ═══════════════════════════════════════

function computeConfidenceForTool(
  toolName: string,
  params: Record<string, unknown>,
  lastMsg: string,
): ConfidenceResult {
  const riskScore = aosReady && aos
    ? aos.guard.risk.evaluate(toolName, params)
    : { score: fallbackRiskScore(toolName, params), action: "confirm", dimensions: {} };

  if (aosReady && aos && typeof (aos as any).computeConfidence === "function") {
    return (aos as any).computeConfidence(toolName, params, riskScore, lastMsg);
  }

  // 备用：直接用核心包导出的函数
  const d1 = scoreD1(riskScore as any);
  const history = { exactMatchCount: 0, sameToolCount: 0, sameCategoryCount: 0 };
  const d2 = scoreD2(toolName, params, history);
  const d3 = scoreD3(toolName, lastMsg);
  const p = String(params?.path || params?.file || "");
  const d4 = scoreD4(p);
  const d5 = scoreD5(new Date(), 0);
  return computeConfidence({ d1, d2, d3, d4, d5 });
}

function recordBehaviorForTool(
  toolName: string,
  params: Record<string, unknown>,
  success: boolean,
  confirmed: boolean,
): void {
  if (aosReady && aos && typeof (aos as any).recordBehavior === "function") {
    (aos as any).recordBehavior(toolName, params, success, confirmed);
  } else if (behaviorModel) {
    behaviorModel.record({ toolName, params, success, confirmed });
  }
}

// ═══════════════════════════════════════
// 插件入口
// ═══════════════════════════════════════

const plugin = definePluginEntry({
  id: "sentinel-agentos",
  name: "Sentinel AgentOS",
  description: "v1.4 智能审批: 置信度评分 + 行为追踪 + 信用体系 + Guard",

  register(api) {
    pluginApi = api;
    workspaceRoot = detectWorkspace();

    const auditDir = path.join(workspaceRoot, ".agentos");
    try { fs.mkdirSync(auditDir, { recursive: true }); } catch { /* ok */ }
    auditFilePath = rotateAuditLog(auditDir);

    // ══════════════════════════════════
    // v1.2: 用户自定义规则加载 + 热加载
    // ══════════════════════════════════

    // 生成示例 rules.json（如不存在）
    RuleLoader.generateTemplate(workspaceRoot);

    // 启动 RuleLoader
    const ruleLoader = new RuleLoader(workspaceRoot);
    let loadedRules: LoadedRules = ruleLoader.load();

    // 动态规则数组（通过闭包引用，热加载后更新）
    let allDangerousCommands = mergeCommandRules(DANGEROUS_COMMANDS, loadedRules, 'dangerous');
    let allWarningCommands = mergeCommandRules(WARNING_COMMANDS, loadedRules, 'warning');
    let allSensitivePatterns = mergeStringLists(SENSITIVE_PATTERNS, loadedRules.sensitivePatterns, loadedRules.disabledRules);
    let allProtectedPatterns = mergeStringLists(PROTECTED_PATTERNS, loadedRules.protectedPatterns, loadedRules.disabledRules);

    log(`rules.json: ${loadedRules.userRuleCount} 自定义规则 / ${loadedRules.disabledCount} 禁用 / ${loadedRules.severityOverrides.size} 优先级覆盖`);

    // 热加载监听
    ruleLoader.onChange((newRules: LoadedRules) => {
      loadedRules = newRules;
      allDangerousCommands = mergeCommandRules(DANGEROUS_COMMANDS, loadedRules, 'dangerous');
      allWarningCommands = mergeCommandRules(WARNING_COMMANDS, loadedRules, 'warning');
      allSensitivePatterns = mergeStringLists(SENSITIVE_PATTERNS, loadedRules.sensitivePatterns, loadedRules.disabledRules);
      allProtectedPatterns = mergeStringLists(PROTECTED_PATTERNS, loadedRules.protectedPatterns, loadedRules.disabledRules);
      log(`热加载完成: ${loadedRules.userRuleCount} 自定义 / ${loadedRules.disabledCount} 禁用`);
    });
    ruleLoader.startWatch();

    // 异步初始化 AgentOS（不阻塞 gateway 启动）
    initAgentOSAsync();

    // ══════════════════════════════════
    // Hook 0: before_prompt_build — 对话上下文
    // ══════════════════════════════════

    api.on("before_prompt_build", async (event: any) => {
      try {
        const msgs: any[] = event?.messages ?? [];
        const userMsgs = msgs.filter((m: any) => m.role === "user" && typeof m.content === "string").slice(-2);
        if (userMsgs.length > 0) {
          lastAIMessage = userMsgs.map((m: any) => (m.content as string).slice(0, 200)).join(" | ");
        }
      } catch { /* non-critical */ }
    });

    // ══════════════════════════════════
    // Hook 1: before_tool_call — v1.4 置信度评分 + 拦截 (P100)
    // ══════════════════════════════════

    api.on("before_tool_call", async (event: ToolCallEvent) => {
      const { toolName, params } = event;
      const p = (params as Record<string, unknown>)?.path || (params as Record<string, unknown>)?.file || "";
      const contextHint = lastAIMessage ? `\n\n📋 最近任务: ${lastAIMessage}` : "";

      // v1.4 计算置信度
      const confidenceResult = computeConfidenceForTool(toolName, params || {}, lastAIMessage);
      const { confidence, decision, dimensions } = confidenceResult;
      const { d1, d2, d3, d4, d5 } = dimensions;

      // 记录行为
      recordBehaviorForTool(toolName, params || {}, true, decision !== "block");

      // 置信度摘要（始终显示，即使没有 AI 消息）
      const confSummary =
        `📊 置信度: ${confidence}/100 (${decision})\n` +
        `  D1(命令风险): ${d1.score}/100\n` +
        `  D2(历史行为): ${d2.score}/100 (${d2.matchLevel})\n` +
        `  D3(上下文): ${d3.score}/100 (${d3.matched}/${d3.total}关键词)\n` +
        `  D4(路径): ${d4.score}/100 (${d4.pathType})\n` +
        `  D5(时间): ${d5.score}/100${d5.offHours ? " 🌙" : ""}`;

      // auto-approve: 直接放行
      if (decision === "auto-approve") {
        return;
      }

      // block: 直接拦截
      if (decision === "block") {
        const reason = `置信度过低 (${confidence}/100)  (D1=${d1.score} D2=${d2.score} D3=${d3.score} D4=${d4.score} D5=${d5.score})`;
        return { block: true, blockReason: `🚫 Sentinel: ${reason}` };
      }

      // confirm (40-79): 按规则弹窗
      // ── 危险命令拦截 ──
      if (toolName === "exec" && (params as Record<string, unknown>)?.command) {
        const cmd = String((params as Record<string, unknown>).command);
        const expandedCmd = expandNodeEval(cmd);
        const checkCmd = expandedCmd || cmd;
        for (const [re, desc] of allDangerousCommands) {
          if (re.test(checkCmd)) {
            return {
              requireApproval: {
                title: "🚫 Sentinel 拦截",
                description: `${confSummary}\n\nSentinel: ${desc}\n\n命令: ${cmd.substring(0, 200)}${contextHint}`,
                severity: "critical" as const,
                timeoutMs: 60_000,
                timeoutBehavior: "deny" as const,
              },
            };
          }
        }
        for (const [re, desc] of allWarningCommands) {
          if (re.test(checkCmd)) {
            return {
              requireApproval: {
                title: "⚠️ 需要确认",
                description: `${confSummary}\n\nSentinel: ${desc}\n\n命令: ${cmd.substring(0, 200)}${contextHint}`,
                severity: "warning" as const,
                timeoutMs: 60_000,
                timeoutBehavior: "deny" as const,
              },
            };
          }
        }
      }

      // ── 敏感文件拦截 ──
      if (p && ["write", "edit", "delete", "read"].includes(toolName)) {
        for (const ptn of allSensitivePatterns) {
          if (globMatch(ptn, String(p))) {
            return { block: true, blockReason: `🚫 Sentinel: 敏感文件 — "${p}" 匹配 "${ptn}"` };
          }
        }
      }

      // ── 保护文件确认 ──
      if (p && ["write", "edit", "delete"].includes(toolName)) {
        for (const pf of allProtectedPatterns) {
          if (globMatch(pf, String(p))) {
            return {
              requireApproval: {
                title: "⚠️ 修改核心配置",
                description: `${confSummary}\n\nSentinel: 文件 "${p}" 受保护，修改可能导致系统不可用。确认继续？${contextHint}`,
                severity: "warning" as const,
                timeoutMs: 60_000,
                timeoutBehavior: "deny" as const,
              },
            };
          }
        }
      }

      // ── 内容语法校验 ──
      if (p && ["write", "edit"].includes(toolName) && (params as Record<string, unknown>)?.content) {
        const err = validateContent(String(p), String((params as Record<string, unknown>).content));
        if (err) return { block: true, blockReason: `🚫 Sentinel: ${err}` };
      }

      // 通用确认
      return {
        requireApproval: {
          title: "⚠️ 操作需要确认",
          description: `${confSummary}\n\n操作: ${toolName}\n${contextHint}`,
          severity: "warning" as const,
          timeoutMs: 60_000,
          timeoutBehavior: "deny" as const,
        },
      };
    }, { priority: 100 });

    // ══════════════════════════════════
    // Hook 2: after_tool_call — 异步审计 (P90)
    // ══════════════════════════════════

    let lastAuditTs = 0;

    api.on("after_tool_call", async (event: ToolCallEvent) => {
      const { toolName, params, error, startedAt, completedAt } = event;

      // 跳过 watchdog
      if (toolName === "exec" && (params as Record<string, unknown>)?.command) {
        if (isWatchdogCommand(String((params as Record<string, unknown>).command))) return;
      }

      // 审计去重
      const now = Date.now();
      const hash = `${toolName}:${JSON.stringify(params || {}).slice(0, 80)}`;
      if (now - auditKeyCleanupTs > 60_000) { recentAuditKeys.clear(); auditKeyCleanupTs = now; }
      if (recentAuditKeys.has(hash)) return;
      recentAuditKeys.add(hash);

      const isBurst = now - lastAuditTs < 2000;
      lastAuditTs = now;

      // 轻量审计
      const lightLine = JSON.stringify({
        id: `audit_${now}`,
        ts: new Date().toISOString(),
        toolName, ok: !error, stage: "light",
        ...(isBurst ? {} : { toolParameters: params ? JSON.stringify(params).substring(0, 200) : "{}" }),
      });
      auditWrite(lightLine);
      if (isBurst) return;
      if (cbIsOpen()) return;

      // 异步 AgentOS pipeline
      const done = { value: false };
      const timeoutId = setTimeout(() => {
        if (!done.value) { done.value = true; cbRecordError(); warn(`after_tool_call 超时 (${toolName})`); }
      }, 500);

      setImmediate(() => {
        if (done.value) return;
        try {
          if (!aos || !aosReady) { done.value = true; clearTimeout(timeoutId); return; }

          // episodic 记录
          if (toolName === "exec" && (params as Record<string, unknown>)?.command) {
            const cmd = String((params as Record<string, unknown>).command);
            const isNoise = /^(echo|dir|ls|cat|type|Get-|Select-|Measure-|npx sentinel|openclaw |node -v|npm -v|git status|git log|git diff)/i.test(cmd.trim());
            if (!isNoise) aos.memory.episodic.record("tool_call", cmd, ["exec"], []);
          }

          if (!error) aos.recordFeedback("user_used_result", "plugin_session");
          cbRecordSuccess();
        } catch (e: unknown) {
          cbRecordError();
          warn(`after_tool_call 异常: ${e instanceof Error ? e.message : String(e)}`);
        }
        done.value = true;
        clearTimeout(timeoutId);
      });
    }, { priority: 90 });

    // ══════════════════════════════════
    // Hook 3: session_start — 上下文注入 + 记忆快照
    // ══════════════════════════════════

    api.on("session_start", async () => {
      if (!aos || !aosReady) return;
      setImmediate(() => {
        try {
          const allEvents = aos!.memory.episodic.getAll();
          const topEvents = allEvents.filter((e: { importance: number }) => e.importance >= 0.6).slice(0, 5);

          const parts: string[] = [];

          try {
            const sem = aos!.memory.semantic.generateContextSummary(800);
            if (sem) parts.push(sem);
          } catch { /* degrade */ }

          if (topEvents.length > 0) {
            const lines = ['[AgentOS Episodic Memory]', ''];
            for (const ev of topEvents) {
              const date = new Date(ev.timestamp).toISOString().split('T')[0];
              const content = (ev.content || '').slice(0, 150);
              lines.push(`📝 [${date}] ${content}`);
              if (lines.join('\n').length > 600) break;
            }
            parts.push(lines.join('\n'));
          }

          const ctx = parts.join('\n\n---\n\n');
          log(`上下文已注入 (${ctx.length} chars, ${topEvents.length} 精选事件 / ${allEvents.length} 总计)`);

          // 可搜索索引
          try {
            const snapshot = aos!.memory.episodic.getSearchableSnapshot(50);
            if (snapshot) {
              const memDir = path.join(workspaceRoot, "memory");
              fs.mkdirSync(memDir, { recursive: true });
              fs.writeFileSync(path.join(memDir, "agentos-episodic.md"), snapshot, "utf-8");
              log(`可搜索索引已写入 memory/agentos-episodic.md`);
            }
          } catch { /* non-critical */ }
        } catch { /* non-critical */ }
      });
    });

    // v1.4 信用体系初始化（独立于 AgentOS 核心实例）
    setImmediate(() => {
      try {
        if (!creditSystem) {
          creditSystem = new CreditSystem();
          (creditSystem as any).enablePersistence(workspaceRoot);
        }
        creditSystem.applyInactivityDecay();
        log(`信用体系已就绪`);

        // 信用报告
        const agents = creditSystem.getAllAgents();
        const agentCount = Object.keys(agents).length;
        if (agentCount > 0) {
          const summary = Object.entries(agents)
            .map(([id, a]) => `${id}: L${a.level} (${a.totalOps} ops)`)
            .join(", ");
          log(`信用报告: ${summary}`);
        } else {
          log(`信用报告: 尚无 Agent 数据`);
        }
      } catch { /* non-critical */ }
    });

    log(`✅ v1.4 已注册: before_tool_call(置信度/行为/拦截) + after_tool_call(审计) + session_start + 自定义规则(${loadedRules.userRuleCount})`);
    log(`拦截规则: 危险x${allDangerousCommands.length} | 警告x${allWarningCommands.length} | 敏感文件x${allSensitivePatterns.length} | 保护文件x${allProtectedPatterns.length} | CB阈值=${CB_THRESHOLD}`);
  },
});

// ═══════════════════════════════════════
// v1.2: 规则合并工具
// ═══════════════════════════════════════

/**
 * 合并内置命令规则 + 用户自定义规则。
 * - 支持 disabled 列表过滤内置规则
 * - 支持 overrideSeverity 升降级
 * - 自定义规则追加到末尾
 */
function mergeCommandRules(
  builtin: Array<[RegExp, string]>,
  loaded: LoadedRules,
  category: 'dangerous' | 'warning',
): Array<[RegExp, string]> {
  const result: Array<[RegExp, string]> = [];
  const { disabledRules, severityOverrides } = loaded;

  // 1. 内置规则：按 disabled/override 过滤
  for (const [re, desc] of builtin) {
    // 生成 key（从描述中提取或使用正则字符串）
    const key = descToKey(desc);

    // 禁用检查
    if (disabledRules.has(key)) continue;

    // 优先级覆盖检查
    const override = severityOverrides.get(key);
    if (override) {
      if (category === 'dangerous' && override === 'warning') continue;  // 降级：不放入 dangerous
      if (category === 'warning' && override === 'dangerous') continue;  // 升级：不放入 warning
    }

    result.push([re, desc]);
  }

  // 2. 用户自定义规则（已在 RuleLoader 中处理好 disabled/override）
  const custom = category === 'dangerous' ? loaded.dangerousCommands : loaded.warningCommands;
  for (const [re, desc] of custom) {
    result.push([re, desc]);
  }

  return result;
}

/**
 * 合并内置字符串列表 + 用户自定义列表。
 * 禁用的 pattern 会被过滤掉。
 */
function mergeStringLists(
  builtin: string[],
  custom: string[],
  disabledRules: Set<string>,
): string[] {
  const result: string[] = [];

  for (const item of builtin) {
    if (!disabledRules.has(item)) {
      result.push(item);
    }
  }

  for (const item of custom) {
    result.push(item);
  }

  return result;
}

/**
 * 从描述文本中提取规则 key。
 * 尝试从内置规则描述中提取可引用的 key。
 */
function descToKey(desc: string): string {
  // 常见 key 映射
  const KEY_MAP: Record<string, string> = {
    'rm -rf / — 删除整个系统': 'rm-rf-root',
    'sudo rm — 提权删除': 'sudo-rm',
    'chmod 777 — 开放所有权限': 'chmod-777',
    'Fork Bomb — 耗尽系统资源': 'fork-bomb',
    '覆盖磁盘设备 — 破坏分区表': 'dd-overwrite',
    'del /f /s — 强制递归删除': 'del-f-s',
    'rd /s /q C:\\ — 递归删除盘符': 'rd-s-q',
    'Remove-Item -Recurse -Force — PowerShell 递归删除': 'remove-item-recurse',
    'format — 格式化磁盘': 'format-disk',
    'cipher /w — 安全擦除磁盘空间': 'cipher-w',
    'docker run -v /:/host — 挂载宿主机根目录': 'docker-mount-host',
    'docker run --privileged — 特权容器': 'docker-privileged',
    'docker exec -it — 进入运行中容器': 'docker-exec',
    'DROP DATABASE — 删除数据库': 'drop-database',
    'DROP TABLE — 删除表': 'drop-table',
    'TRUNCATE — 清空表数据': 'truncate',
    'nc -e — 反向 Shell': 'nc-reverse-shell',
    'PowerShell 下载文件到本地': 'powershell-download',
    'base64 解码管道 — 编码逃逸': 'base64-decode',
    'base64 内联解码 — 编码逃逸': 'base64-inline',
    '管道到 sh — 执行未知脚本': 'pipe-sh',
    '管道到 bash — 执行未知脚本': 'pipe-bash',
    'curl | sh — 执行远程脚本': 'curl-pipe-sh',
    'wget 管道 — 执行远程脚本': 'wget-pipe',
    'git push --force — 强制推送': 'git-push-force',
    'git push -f — 强制推送': 'git-push-f',
    'git reset --hard — 硬重置': 'git-reset-hard',
    'git commit --amend — 修改提交历史': 'git-commit-amend',
    'npm publish — 发布到 npm 仓库': 'npm-publish',
    'npm unpublish — 下架包': 'npm-unpublish',
    'pip install — 安装 Python 包': 'pip-install',
    'gem install — 安装 Ruby 包': 'gem-install',
    'cargo install — 安装 Rust 包': 'cargo-install',
    'go install — 安装 Go 包': 'go-install',
    'docker rm — 删除容器': 'docker-rm',
    'docker system prune — 清理 Docker': 'docker-prune',
  };

  if (KEY_MAP[desc]) return KEY_MAP[desc];

  // 回退：用描述的前几个词生成 key
  return desc
    .split(' — ')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export default plugin;
