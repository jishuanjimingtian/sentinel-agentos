/**
 * Sentinel AgentOS OpenClaw Plugin (v1.1.0)
 *
 * 安全接入版：异步非阻塞 + circuit breaker + 审计 rotate + 去重
 *
 * Hook 生命周期:
 * - before_tool_call (priority 100): 确定性拦截，纯内存，零 I/O，永不阻塞
 * - after_tool_call (priority 90): 异步审计，500ms 超时，异常自动降级
 * - session_start: 异步注入上下文
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { AgentOS } from "sentinel-agentos";
import * as path from "node:path";
import * as fs from "node:fs";

// ═══════════════════════════════════════
// 类型
// ═══════════════════════════════════════

interface ToolCallEvent {
  toolName: string;
  params?: Record<string, unknown>;
  error?: unknown;
  startedAt?: number;
  completedAt?: number;
}

// ═══════════════════════════════════════
// 全局状态
// ═══════════════════════════════════════

let aos: AgentOS | null = null;
let aosReady = false;       // AgentOS 初始化完成标志
let workspaceRoot = "";

// ── Circuit Breaker ──
let consecutiveErrors = 0;
const CB_THRESHOLD = 5;
const CB_COOLDOWN_MS = 300_000; // 5 分钟
let cbOpenUntil = 0;
let cbTotalTrips = 0;

// ── 审计去重 ──
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
  const p = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "§§")
    .replace(/\*/g, "[^/\\\\]*")
    .replace(/§§/g, ".*");
  return new RegExp(`(^|[/\\\\])${p}$`, "i").test(filepath);
}

/** 秒级时间戳用于审计文件名 */
function dateStamp(): string {
  return new Date().toISOString().split("T")[0];
}

/** 输出日志，带 circuit-breaker 状态 */
function log(msg: string): void {
  const cbState = cbOpenUntil > Date.now() ? " [CB:OPEN]" : consecutiveErrors > 0 ? ` [CB:${consecutiveErrors}/${CB_THRESHOLD}]` : "";
  console.log(`[Sentinel]${cbState} ${msg}`);
}

function warn(msg: string): void {
  console.warn(`[Sentinel] ${msg}`);
}

// ═══════════════════════════════════════
// Circuit Breaker
// ═══════════════════════════════════════

function cbIsOpen(): boolean {
  if (cbOpenUntil === 0) return false;
  if (Date.now() > cbOpenUntil) {
    // 冷却结束，半开
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
  if (consecutiveErrors > 0) {
    consecutiveErrors = Math.max(0, consecutiveErrors - 1);
  }
}

// ═══════════════════════════════════════
// 审计日志 rotate
// ═══════════════════════════════════════

const MAX_AUDIT_SIZE = 1_048_576; // 1 MB
const AUDIT_RETENTION_DAYS = 7;

function rotateAuditLog(auditDir: string): string {
  const auditFile = path.join(auditDir, "audit.jsonl");
  try {
    if (fs.existsSync(auditFile)) {
      const stat = fs.statSync(auditFile);
      if (stat.size > MAX_AUDIT_SIZE) {
        const archive = path.join(auditDir, `audit-${dateStamp()}.jsonl`);
        // 如果当天已有归档，追加；否则重命名
        if (!fs.existsSync(archive)) {
          fs.renameSync(auditFile, archive);
          log(`审计日志已归档: audit-${dateStamp()}.jsonl (${(stat.size / 1024).toFixed(1)} KB)`);
        } else {
          // 已有当天归档，直接清空当前
          fs.writeFileSync(auditFile, "", "utf-8");
          log(`审计日志已清空 (已有当天归档)`);
        }
      }
    }

    // 清理过期归档
    const files = fs.readdirSync(auditDir).filter(f => f.startsWith("audit-") && f.endsWith(".jsonl"));
    const cutoff = Date.now() - AUDIT_RETENTION_DAYS * 86_400_000;
    for (const f of files) {
      const fp = path.join(auditDir, f);
      try {
        if (fs.statSync(fp).mtimeMs < cutoff) {
          fs.unlinkSync(fp);
          log(`已删除过期审计: ${f}`);
        }
      } catch { /* skip */ }
    }
  } catch (e) {
    // rotate 失败不影响主流程
  }
  return path.join(auditDir, "audit.jsonl");
}

// ═══════════════════════════════════════
// 审计写入（异步非阻塞）
// ═══════════════════════════════════════

let auditBuffer: string[] = [];
let auditFlushTimer: ReturnType<typeof setTimeout> | null = null;
let auditFilePath = "";

function auditWrite(line: string): void {
  auditBuffer.push(line);
  if (auditBuffer.length >= 20) {
    auditFlush();
  } else if (!auditFlushTimer) {
    // 最多等 2 秒批量写
    auditFlushTimer = setTimeout(auditFlush, 2000).unref();
  }
}

function auditFlush(): void {
  if (auditFlushTimer) { clearTimeout(auditFlushTimer); auditFlushTimer = null; }
  if (auditBuffer.length === 0 || !auditFilePath) return;

  const batch = auditBuffer.splice(0);
  // 异步写，不阻塞事件循环
  setImmediate(() => {
    try {
      fs.appendFileSync(auditFilePath, batch.join("\n") + "\n", "utf-8");
    } catch {
      // 丢弃这批（宁可丢审计也不能崩）
    }
  });
}

// ═══════════════════════════════════════
// 规则定义（不变）
// ═══════════════════════════════════════

const DANGEROUS_COMMANDS: Array<[RegExp, string]> = [
  [/rm\s+-rf\s+\//, "rm -rf / — 删除整个系统"],
  [/sudo\s+rm/, "sudo rm — 提权删除"],
  [/chmod\s+777/, "chmod 777 — 开放所有权限"],
  [/del\s+\/f\s+\/s/, "del /f /s — 强制递归删除"],
  [/format\s+[a-z]:/, "format — 格式化磁盘"],
  [/\|\s*sh$/, "管道到 sh — 执行未知脚本"],
  [/curl\s+.*\|\s*(ba)?sh/, "curl | sh — 执行远程脚本"],
  [/wget\s+.*-O\s*-\s*\|/, "wget 管道 — 执行远程脚本"],
  [/npm\s+publish/, "npm publish — 发布到 npm 仓库"],
];

const WARNING_COMMANDS: Array<[RegExp, string]> = [
  [/git\s+push\s+--force/, "git push --force — 强制推送"],
  [/git\s+reset\s+--hard/, "git reset --hard — 硬重置"],
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
  // 噪音命令——忽略自身工具调用
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
  if (ext === ".yaml" || ext === ".yml") {
    if (content.includes("\t") && content.includes("  ")) {
      return "YAML 缩进混用：同时包含 tab 和空格";
    }
  }
  return null;
}

/** 判断命令是否为 watchdog/内部健康检查 */
function isWatchdogCommand(cmd: string): boolean {
  for (const re of WATCHDOG_PATTERNS) {
    if (re.test(cmd)) return true;
  }
  return false;
}

// ═══════════════════════════════════════
// AgentOS 异步初始化
// ═══════════════════════════════════════

function initAgentOSAsync(): void {
  // 使用 setImmediate 推迟到事件循环下一轮，不阻塞 register()
  setImmediate(() => {
    try {
      aos = new AgentOS({ workspaceRoot });
      aosReady = true;

      // 去重：清理初始化产生的重复 milestone
      deduplicateEpisodic();

      log(`AgentOS 已加载 → ${workspaceRoot}`);
    } catch (e: unknown) {
      warn(`AgentOS 初始化失败: ${e instanceof Error ? e.message : String(e)}`);
      aos = null;
      aosReady = false;
    }
  });
}

/** episodic 初始化去重 + 跳过 watchdog 记录 */
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
      // 跳过 watchdog/sync 事件
      if (ev.tags && ev.tags.some(t => t === "sync")) continue;
      if (ev.content && (ev.content.includes("Sync completed") || ev.content.includes("health"))) continue;

      // 重复 milestone 去重
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
  } catch { /* 非关键 */ }
}

// ═══════════════════════════════════════
// 插件入口
// ═══════════════════════════════════════

const plugin = definePluginEntry({
  id: "sentinel-agentos",
  name: "Sentinel AgentOS",
  description: "确定性 Guard + 分层记忆 + 自动评估 (安全接入版 v1.1)",

  register(api) {
    workspaceRoot = detectWorkspace();

    // 确保审计目录存在（同步，极快）
    const auditDir = path.join(workspaceRoot, ".agentos");
    try { fs.mkdirSync(auditDir, { recursive: true }); } catch { /* ok */ }

    // rotate 审计日志
    auditFilePath = rotateAuditLog(auditDir);

    // 异步初始化 AgentOS（不阻塞 gateway 启动）
    initAgentOSAsync();

    // ══════════════════════════════════
    // Hook 1: before_tool_call — 确定性拦截 (P100)
    //
    // 纯内存、纯正则、零 I/O。
    // 即使 AgentOS 未就绪也正常工作（规则是硬编码的）。
    // ══════════════════════════════════

    api.on("before_tool_call", async (event: ToolCallEvent) => {
      const { toolName, params } = event;
      const p = (params as Record<string, unknown>)?.path || (params as Record<string, unknown>)?.file || "";

      // ── 危险命令拦截 ──
      if (toolName === "exec" && (params as Record<string, unknown>)?.command) {
        const cmd = String((params as Record<string, unknown>).command);
        for (const [re, desc] of DANGEROUS_COMMANDS) {
          if (re.test(cmd)) {
            return { block: true, blockReason: `🚫 Sentinel: ${desc}` };
          }
        }
        for (const [re, desc] of WARNING_COMMANDS) {
          if (re.test(cmd)) {
            return {
              requireApproval: {
                title: "⚠️ 需要确认",
                description: `Sentinel: ${desc}\n\n命令: ${cmd.substring(0, 200)}`,
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
        for (const ptn of SENSITIVE_PATTERNS) {
          if (globMatch(ptn, String(p))) {
            return { block: true, blockReason: `🚫 Sentinel: 敏感文件 — "${p}" 匹配 "${ptn}"` };
          }
        }
      }

      // ── 保护文件确认 ──
      if (p && ["write", "edit", "delete"].includes(toolName)) {
        for (const pf of PROTECTED_PATTERNS) {
          if (globMatch(pf, String(p))) {
            return {
              requireApproval: {
                title: "⚠️ 修改核心配置",
                description: `Sentinel: 文件 "${p}" 受保护，修改可能导致系统不可用。确认继续？`,
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
        if (err) {
          return { block: true, blockReason: `🚫 Sentinel: ${err}` };
        }
      }
    }, { priority: 100 });

    // ══════════════════════════════════
    // Hook 2: after_tool_call — 异步审计 (P90)
    //
    // 全部操作在 setImmediate 里执行，500ms 硬超时。
    // AgentOS 未就绪或 circuit breaker 打开时降级为纯文件审计。
    // ══════════════════════════════════

    let lastAuditTs = 0;

    api.on("after_tool_call", async (event: ToolCallEvent) => {
      const { toolName, params, error, startedAt, completedAt } = event;

      // 跳过 watchdog
      if (toolName === "exec" && (params as Record<string, unknown>)?.command) {
        if (isWatchdogCommand(String((params as Record<string, unknown>).command))) return;
      }

      // 审计去重：1 秒内相同的 tool+params hash 跳过
      const now = Date.now();
      const hash = `${toolName}:${JSON.stringify(params || {}).slice(0, 80)}`;
      if (now - auditKeyCleanupTs > 60_000) {
        recentAuditKeys.clear();
        auditKeyCleanupTs = now;
      }
      if (recentAuditKeys.has(hash)) return;
      recentAuditKeys.add(hash);

      // backpressure: 2 秒内快速连续调用只记轻量日志
      const isBurst = now - lastAuditTs < 2000;
      lastAuditTs = now;

      // 轻量审计行（不管 CB 状态都记）
      const lightLine = JSON.stringify({
        id: `audit_${now}`,
        ts: new Date().toISOString(),
        toolName: toolName,
        ok: !error,
        stage: "light",
        ...(isBurst ? {} : { toolParameters: params ? JSON.stringify(params).substring(0, 200) : "{}" }),
      });
      auditWrite(lightLine);

      // 如果只是 burst 模式，到此为止
      if (isBurst) return;

      // circuit breaker 检查：打开时不走 AgentOS 完整 pipeline
      if (cbIsOpen()) return;

      // ── 异步 AgentOS pipeline ──
      const done = { value: false };
      const timeoutId = setTimeout(() => {
        if (!done.value) {
          done.value = true;
          cbRecordError();
          warn(`after_tool_call 超时 (${toolName})`);
        }
      }, 500);

      setImmediate(() => {
        if (done.value) return; // 已超时

        try {
          if (!aos || !aosReady) {
            done.value = true;
            clearTimeout(timeoutId);
            return;
          }

          // episodic 记录（仅 exec 命令，跳过 watchdog 已在上面做了）
          if (toolName === "exec" && (params as Record<string, unknown>)?.command) {
            aos.memory.episodic.record(
              "tool_call",
              String((params as Record<string, unknown>).command),
              ["exec"],
              [],
            );
          }

          // 反馈
          if (!error) {
            aos.recordFeedback("user_used_result", "plugin_session");
          }

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
    // Hook 3: session_start — 注入上下文
    // ══════════════════════════════════

    api.on("session_start", async () => {
      if (!aos || !aosReady) return;
      setImmediate(() => {
        try {
          const ctx = aos!.injectContext();
          log(`上下文已注入 (${ctx.length} chars)`);
        } catch { /* 非关键 */ }
      });
    });

    log("✅ 已注册 3 hook: before_tool_call(P100) + after_tool_call(P90/async) + session_start");
    log(`拦截规则: 危险x${DANGEROUS_COMMANDS.length} | 警告x${WARNING_COMMANDS.length} | 敏感文件x${SENSITIVE_PATTERNS.length} | 保护文件x${PROTECTED_PATTERNS.length} | JSON/YAML校验 | CB阈值=${CB_THRESHOLD}`);
  },
});

export default plugin;
