/**
 * Sentinel AgentOS OpenClaw Plugin (v1.0.6)
 *
 * 安全接入版：同步审计 + 可配置规则 + 弹窗上下文
 *
 * Hook 生命周期:
 * - before_tool_call (priority 100): 确定性拦截，纯内存，零 I/O，永不阻塞
 * - after_tool_call (priority 90): 异步审计，500ms 超时，异常自动降级
 * - session_start: 异步注入上下文
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { AgentOS, RuleLoader } from "sentinel-agentos";
import type { LoadedRules } from "sentinel-agentos";
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

// ── 上一次 AI 消息摘要（用于弹窗上下文） ──
let lastAIMessage = "";

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
  const SENTINEL = "\x00";
  const p = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, `${SENTINEL}**${SENTINEL}`)
    .replace(/\*/g, "[^/\\\\]*")
    .replace(new RegExp(`${SENTINEL}\\*\\*${SENTINEL}`, "g"), ".*");
  return new RegExp(`(^|[/\\\\])${p}$`, "i").test(filepath);
}

/** 秒级时间戳用于审计文件名 */
function dateStamp(): string {
  return new Date().toISOString().split("T")[0];
}

/** 输出日志，带 circuit-breaker 状态 */
let pluginApi: any = null;  // register 时注入

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
  // ── Linux 高危 ──
  [/rm\s+-rf\s+\//, "rm -rf / — 删除整个系统"],
  [/sudo\s+rm/, "sudo rm — 提权删除"],
  [/chmod\s+777/, "chmod 777 — 开放所有权限"],
  [/mv\s+\/[^\s]*\s+\/dev\/null/, "mv ... /dev/null — 破坏关键路径"],
  [/:\{\s*:\|[\s]*:&\s*\};?\s*:/, "Fork Bomb — 耗尽系统资源"],
  [/>\s*\/dev\/sd[a-z]\d*/, "覆盖磁盘设备 — 破坏分区表"],
  [/dd\s+if=.+\s+of=\/dev\/sd/, "dd 写入磁盘设备 — 覆盖分区"],
  // ── Windows 高危 ──
  [/del\s+\/f\s+\/s/, "del /f /s — 强制递归删除"],
  [/rd\s+\/s\s+\/q\s+[A-Z]:\\/, "rd /s /q C:\\ — 递归删除盘符"],
  [/Remove-Item\s.*-Recurse\s.*-Force/, "Remove-Item -Recurse -Force — PowerShell 递归删除"],
  [/format\s+[a-z]:/, "format — 格式化磁盘"],
  [/cipher\s+\/w/, "cipher /w — 安全擦除磁盘空间"],
  // ── Docker 逃逸 ──
  [/docker\s+run\s+.*-v\s+\/\s*:\s*\/host/, "docker run -v /:/host — 挂载宿主机根目录"],
  [/docker\s+run\s+.*--privileged/, "docker run --privileged — 特权容器"],
  [/docker\s+exec\s+-it/, "docker exec -it — 进入运行中容器"],
  // ── 数据库高危 ──
  [/DROP\s+DATABASE\b/, "DROP DATABASE — 删除数据库"],
  [/DROP\s+TABLE\b/, "DROP TABLE — 删除表"],
  [/TRUNCATE\s+(TABLE\s+)?\w+/, "TRUNCATE — 清空表数据"],
  // ── 网络外泄 ──
  [/nc\s+-e/, "nc -e — 反向 Shell"],
  [/powershell\s+(Invoke-WebRequest|iwr)\s.*-OutFile/, "PowerShell 下载文件到本地"],
  // ── 编码逃逸 ──
  [/base64\s.*-d\s*\|/, "base64 解码管道 — 编码逃逸"],
  [/echo\s+[A-Za-z0-9+/=]{20,}\s*\|\s*base64/, "base64 内联解码 — 编码逃逸"],
  // ── 管道执行 ──
  [/\|\s*sh$/, "管道到 sh — 执行未知脚本"],
  [/\|\s*bash$/, "管道到 bash — 执行未知脚本"],
  [/curl\s+.*\|\s*(ba)?sh/, "curl | sh — 执行远程脚本"],
  [/wget\s+.*-O\s*-\s*\|/, "wget 管道 — 执行远程脚本"],
];

const WARNING_COMMANDS: Array<[RegExp, string]> = [
  // ── Git 高危 ──
  [/git\s+push\s+--force/, "git push --force — 强制推送"],
  [/git\s+push\s+-f\b/, "git push -f — 强制推送"],
  [/git\s+reset\s+--hard/, "git reset --hard — 硬重置"],
  [/git\s+commit\s+--amend\s+--no-edit/, "git commit --amend — 修改提交历史"],
  [/git\s+rebase\s+-i/, "git rebase -i — 交互式变基"],
  // ── 包管理器 ──
  [/npm\s+publish/, "npm publish — 发布到 npm 仓库"],
  [/npm\s+unpublish/, "npm unpublish — 下架包"],
  [/pip\s+install/, "pip install — 安装 Python 包"],
  [/gem\s+install/, "gem install — 安装 Ruby 包"],
  [/cargo\s+install/, "cargo install — 安装 Rust 包"],
  [/go\s+install\b/, "go install — 安装 Go 包"],
  // ── Docker 警告 ──
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

/** 展开 node -e 内联脚本中的字符串拼接绕过 */
function expandNodeEval(cmd: string): string | null {
  // 匹配 node -e "..." 形式的 inline eval
  const m = cmd.match(/node\s+-e\s+"([^"]*)"/);
  if (!m) return null;
  const script = m[1];
  // 展开所有 'xx'+'yy' 形式为 xxyy
  const expanded = script.replace(/'([^']*)'\s*\+\s*'([^']*)'/g, "'$1$2'");
  // 递归展开（处理 'a'+'b'+'c'）
  const prev = script;
  if (expanded === prev) return null;
  return expandNodeEval(cmd.replace(m[1], expanded)) || cmd.replace(m[1], expanded);
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
  description: "确定性 Guard + 分层记忆 + 自动评估 (v1.2 可配置规则)",

  register(api) {
    pluginApi = api;
    workspaceRoot = detectWorkspace();

    // 确保审计目录存在（同步，极快）
    const auditDir = path.join(workspaceRoot, ".agentos");
    try { fs.mkdirSync(auditDir, { recursive: true }); } catch { /* ok */ }

    // rotate 审计日志
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
    // Hook 0: 捕获最近对话上下文（用于弹窗意图提示）
    // ══════════════════════════════════
    api.on("before_prompt_build", async (event: any) => {
      try {
        const msgs: any[] = event?.messages ?? [];
        // 取最近 2 条用户消息作为上下文
        const userMsgs = msgs
          .filter((m: any) => m.role === "user" && typeof m.content === "string")
          .slice(-2);
        if (userMsgs.length > 0) {
          lastAIMessage = userMsgs.map((m: any) =>
            (m.content as string).slice(0, 200)
          ).join(" | ");
        }
      } catch { /* 非关键 */ }
    });

    // ══════════════════════════════════
    // Hook 1: before_tool_call — 确定性拦截 (P100)
    //
    // 纯内存、纯正则、零 I/O。
    // 即使 AgentOS 未就绪也正常工作（规则是硬编码的）。
    // ══════════════════════════════════

    api.on("before_tool_call", async (event: ToolCallEvent) => {
      const { toolName, params } = event;
      const p = (params as Record<string, unknown>)?.path || (params as Record<string, unknown>)?.file || "";

      // 构建上下文提示
      const contextHint = lastAIMessage
        ? `\n\n📋 最近任务: ${lastAIMessage}`
        : "";

      // ── 危险命令拦截 ──
      if (toolName === "exec" && (params as Record<string, unknown>)?.command) {
        const cmd = String((params as Record<string, unknown>).command);
        // 展开 inline 脚本中的字符串拼接绕过（e.g. 'np'+'m pu'+'blish'）
        const expandedCmd = expandNodeEval(cmd);
        const checkCmd = expandedCmd || cmd;
        for (const [re, desc] of allDangerousCommands) {
          if (re.test(checkCmd)) {
            return {
              requireApproval: {
                title: "🚫 Sentinel 拦截",
                description: `Sentinel: ${desc}\n\n命令: ${cmd.substring(0, 200)}${contextHint}`,
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
                description: `Sentinel: ${desc}\n\n命令: ${cmd.substring(0, 200)}${contextHint}`,
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
                description: `Sentinel: 文件 "${p}" 受保护，修改可能导致系统不可用。确认继续？${contextHint}`,
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

          // episodic 记录（仅非噪音 exec 命令）
          if (toolName === "exec" && (params as Record<string, unknown>)?.command) {
            const cmd = String((params as Record<string, unknown>).command);
            // 跳过短暂/查询类命令，减少噪音
            const isNoise = /^(echo|dir|ls|cat|type|Get-|Select-|Measure-|npx sentinel|openclaw |node -v|npm -v|git status|git log|git diff)/i.test(cmd.trim());
            if (!isNoise) {
              aos.memory.episodic.record("tool_call", cmd, ["exec"], []);
            }
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
    // Hook 3: session_start — 精简上下文注入
    //
    // 关键优化：只注入最近 5 条高重要性 episodic 事件 + 语义摘要。
    // 避免全量 episodic 膨胀导致 MEMORY.md 越来越大 → token 浪费。
    // ══════════════════════════════════

    api.on("session_start", async () => {
      if (!aos || !aosReady) return;
      setImmediate(() => {
        try {
          // 只取最近 5 条高重要性事件（importance >= 0.6）
          const allEvents = aos!.memory.episodic.getAll();
          const topEvents = allEvents
            .filter((e: { importance: number }) => e.importance >= 0.6)
            .slice(0, 5);

          const parts: string[] = [];

          // 语义记忆（最多 800 字符）
          try {
            const sem = aos!.memory.semantic.generateContextSummary(800);
            if (sem) parts.push(sem);
          } catch { /* 降级 */ }

          // 精选 episodic（最多 600 字符）
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

          // 可搜索索引：写入 memory/agentos-episodic.md 供 memory_search 索引
          try {
            const snapshot = aos!.memory.episodic.getSearchableSnapshot(50);
            if (snapshot) {
              const memDir = path.join(workspaceRoot, "memory");
              fs.mkdirSync(memDir, { recursive: true });
              fs.writeFileSync(path.join(memDir, "agentos-episodic.md"), snapshot, "utf-8");
              log(`可搜索索引已写入 memory/agentos-episodic.md`);
            }
          } catch { /* 非关键 */ }
        } catch { /* 非关键 */ }
      });
    });

    log(`✅ 已注册 3 hook: before_tool_call(P100) + after_tool_call(P90/async) + session_start + 可搜索索引(agentos-episodic) + 自定义规则(${loadedRules.userRuleCount})`);
    log(`拦截规则: 危险x${allDangerousCommands.length} | 警告x${allWarningCommands.length} | 敏感文件x${allSensitivePatterns.length} | 保护文件x${allProtectedPatterns.length} | JSON/YAML校验 | CB阈值=${CB_THRESHOLD} | CB熔断次数=${cbTotalTrips}`);
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
