import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { AgentOS, BehaviorModel, CreditSystem } from "sentinel-agentos";
import { computeConfidence, scoreD1, scoreD2, scoreD3, scoreD4, scoreD5 } from "sentinel-agentos";
import * as path from "node:path";
import * as fs from "node:fs";
let aos = null;
let aosReady = false;
let workspaceRoot = "";
let behaviorModel = null;
let creditSystem = null;
let consecutiveErrors = 0;
const CB_THRESHOLD = 5;
const CB_COOLDOWN_MS = 3e5;
let cbOpenUntil = 0;
let cbTotalTrips = 0;
let lastAIMessage = "";
const recentAuditKeys = /* @__PURE__ */ new Set();
let auditKeyCleanupTs = 0;
function detectWorkspace() {
  if (process.env.OPENCLAW_WORKSPACE) return process.env.OPENCLAW_WORKSPACE;
  const home = process.env.USERPROFILE || process.env.HOME || "";
  return path.join(home, ".openclaw", "workspace");
}
function globMatch(pattern, filepath) {
  const SENTINEL = "\0";
  const p = pattern.replace(/\./g, "\\.").replace(/\*\*/g, `${SENTINEL}**${SENTINEL}`).replace(/\*/g, "[^/\\\\]*").replace(new RegExp(`${SENTINEL}\\*\\*${SENTINEL}`, "g"), ".*");
  return new RegExp(`(^|[/\\\\])${p}$`, "i").test(filepath);
}
function dateStamp() {
  return (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
}
let pluginApi = null;
function log(msg) {
  const cbState = cbOpenUntil > Date.now() ? " [CB:OPEN]" : consecutiveErrors > 0 ? ` [CB:${consecutiveErrors}/${CB_THRESHOLD}]` : "";
  const text = `[Sentinel]${cbState} ${msg}`;
  if (pluginApi?.logger?.info) pluginApi.logger.info(text);
  else console.log(text);
}
function warn(msg) {
  const text = `[Sentinel] ${msg}`;
  if (pluginApi?.logger?.warn) pluginApi.logger.warn(text);
  else console.warn(text);
}
function cbIsOpen() {
  if (cbOpenUntil === 0) return false;
  if (Date.now() > cbOpenUntil) {
    cbOpenUntil = 0;
    consecutiveErrors = 0;
    log("Circuit breaker \u51B7\u5374\u7ED3\u675F\uFF0C\u6062\u590D\u5BA1\u8BA1");
    return false;
  }
  return true;
}
function cbRecordError() {
  consecutiveErrors++;
  if (consecutiveErrors >= CB_THRESHOLD) {
    cbOpenUntil = Date.now() + CB_COOLDOWN_MS;
    cbTotalTrips++;
    warn(`Circuit breaker \u89E6\u53D1\uFF01\u8FDE\u7EED ${consecutiveErrors} \u6B21\u5F02\u5E38\uFF0C\u6682\u505C\u5BA1\u8BA1 ${CB_COOLDOWN_MS / 1e3}s (\u603B\u8BA1 ${cbTotalTrips} \u6B21)`);
  }
}
function cbRecordSuccess() {
  if (consecutiveErrors > 0) consecutiveErrors = Math.max(0, consecutiveErrors - 1);
}
const MAX_AUDIT_SIZE = 1048576;
const AUDIT_RETENTION_DAYS = 7;
function rotateAuditLog(auditDir) {
  const auditFile = path.join(auditDir, "audit.jsonl");
  try {
    if (fs.existsSync(auditFile)) {
      const stat = fs.statSync(auditFile);
      if (stat.size > MAX_AUDIT_SIZE) {
        const archive = path.join(auditDir, `audit-${dateStamp()}.jsonl`);
        if (!fs.existsSync(archive)) {
          fs.renameSync(auditFile, archive);
          log(`\u5BA1\u8BA1\u65E5\u5FD7\u5DF2\u5F52\u6863: audit-${dateStamp()}.jsonl (${(stat.size / 1024).toFixed(1)} KB)`);
        } else {
          fs.writeFileSync(auditFile, "", "utf-8");
          log(`\u5BA1\u8BA1\u65E5\u5FD7\u5DF2\u6E05\u7A7A (\u5DF2\u6709\u5F53\u5929\u5F52\u6863)`);
        }
      }
    }
    const files = fs.readdirSync(auditDir).filter((f) => f.startsWith("audit-") && f.endsWith(".jsonl"));
    const cutoff = Date.now() - AUDIT_RETENTION_DAYS * 864e5;
    for (const f of files) {
      const fp = path.join(auditDir, f);
      try {
        if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
      } catch {
      }
    }
  } catch {
  }
  return path.join(auditDir, "audit.jsonl");
}
let auditBuffer = [];
let auditFlushTimer = null;
let auditFilePath = "";
function auditWrite(line) {
  auditBuffer.push(line);
  if (auditBuffer.length >= 20) auditFlush();
  else if (!auditFlushTimer) auditFlushTimer = setTimeout(auditFlush, 2e3).unref();
}
function auditFlush() {
  if (auditFlushTimer) {
    clearTimeout(auditFlushTimer);
    auditFlushTimer = null;
  }
  if (auditBuffer.length === 0 || !auditFilePath) return;
  const batch = auditBuffer.splice(0);
  setImmediate(() => {
    try {
      fs.appendFileSync(auditFilePath, batch.join("\n") + "\n", "utf-8");
    } catch {
    }
  });
}
const DANGEROUS_COMMANDS = [
  [/rm\s+-rf\s+\//, "rm -rf / \u2014 \u5220\u9664\u6574\u4E2A\u7CFB\u7EDF"],
  [/sudo\s+rm/, "sudo rm \u2014 \u63D0\u6743\u5220\u9664"],
  [/chmod\s+777/, "chmod 777 \u2014 \u5F00\u653E\u6240\u6709\u6743\u9650"],
  [/mv\s+\/[^\s]*\s+\/dev\/null/, "mv ... /dev/null \u2014 \u7834\u574F\u5173\u952E\u8DEF\u5F84"],
  [/:\{\s*:\|[\s]*:&\s*\};?\s*:/, "Fork Bomb \u2014 \u8017\u5C3D\u7CFB\u7EDF\u8D44\u6E90"],
  [/>\s*\/dev\/sd[a-z]\d*/, "\u8986\u76D6\u78C1\u76D8\u8BBE\u5907 \u2014 \u7834\u574F\u5206\u533A\u8868"],
  [/dd\s+if=.+\s+of=\/dev\/sd/, "dd \u5199\u5165\u78C1\u76D8\u8BBE\u5907 \u2014 \u8986\u76D6\u5206\u533A"],
  [/del\s+\/f\s+\/s/, "del /f /s \u2014 \u5F3A\u5236\u9012\u5F52\u5220\u9664"],
  [/rd\s+\/s\s+\/q\s+[A-Z]:\\/, "rd /s /q C:\\ \u2014 \u9012\u5F52\u5220\u9664\u76D8\u7B26"],
  [/Remove-Item\s.*-Recurse\s.*-Force/, "Remove-Item -Recurse -Force \u2014 PowerShell \u9012\u5F52\u5220\u9664"],
  [/format\s+[a-z]:/, "format \u2014 \u683C\u5F0F\u5316\u78C1\u76D8"],
  [/cipher\s+\/w/, "cipher /w \u2014 \u5B89\u5168\u64E6\u9664\u78C1\u76D8\u7A7A\u95F4"],
  [/docker\s+run\s+.*-v\s+\/\s*:\s*\/host/, "docker run -v /:/host \u2014 \u6302\u8F7D\u5BBF\u4E3B\u673A\u6839\u76EE\u5F55"],
  [/docker\s+run\s+.*--privileged/, "docker run --privileged \u2014 \u7279\u6743\u5BB9\u5668"],
  [/DROP\s+DATABASE\b/, "DROP DATABASE \u2014 \u5220\u9664\u6570\u636E\u5E93"],
  [/DROP\s+TABLE\b/, "DROP TABLE \u2014 \u5220\u9664\u8868"],
  [/TRUNCATE\s+(TABLE\s+)?\w+/, "TRUNCATE \u2014 \u6E05\u7A7A\u8868\u6570\u636E"],
  [/nc\s+-e/, "nc -e \u2014 \u53CD\u5411 Shell"],
  [/\|\s*sh$/, "\u7BA1\u9053\u5230 sh \u2014 \u6267\u884C\u672A\u77E5\u811A\u672C"],
  [/\|\s*bash$/, "\u7BA1\u9053\u5230 bash \u2014 \u6267\u884C\u672A\u77E5\u811A\u672C"],
  [/curl\s+.*\|\s*(ba)?sh/, "curl | sh \u2014 \u6267\u884C\u8FDC\u7A0B\u811A\u672C"],
  [/wget\s+.*-O\s*-\s*\|/, "wget \u7BA1\u9053 \u2014 \u6267\u884C\u8FDC\u7A0B\u811A\u672C"]
];
const WARNING_COMMANDS = [
  [/git\s+push\s+--force/, "git push --force \u2014 \u5F3A\u5236\u63A8\u9001"],
  [/git\s+push\s+-f\b/, "git push -f \u2014 \u5F3A\u5236\u63A8\u9001"],
  [/git\s+reset\s+--hard/, "git reset --hard \u2014 \u786C\u91CD\u7F6E"],
  [/git\s+commit\s+--amend\s+--no-edit/, "git commit --amend \u2014 \u4FEE\u6539\u63D0\u4EA4\u5386\u53F2"],
  [/npm\s+publish/, "npm publish \u2014 \u53D1\u5E03\u5230 npm \u4ED3\u5E93"],
  [/npm\s+unpublish/, "npm unpublish \u2014 \u4E0B\u67B6\u5305"],
  [/docker\s+rm/, "docker rm \u2014 \u5220\u9664\u5BB9\u5668"],
  [/docker\s+system\s+prune/, "docker system prune \u2014 \u6E05\u7406 Docker"]
];
const SENSITIVE_PATTERNS = [
  ".env",
  ".env.*",
  "*.key",
  "*.pem",
  "*.p12",
  "*.pfx",
  "*.jks",
  "*.keystore",
  ".git/**",
  "**/credentials/**",
  "**/secrets/**",
  "**/SECRETS/**",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock"
];
const PROTECTED_PATTERNS = [
  "openclaw.json",
  "openclaw.*.json",
  "config.yaml",
  "config.yml",
  "gateway.yaml",
  "gateway.yml",
  "gateway.json",
  "AGENTS.md",
  "SOUL.md",
  "MEMORY.md",
  "USER.md"
];
const WATCHDOG_PATTERNS = [
  /health/i,
  /3408/,
  /3456/,
  /dashboard-watchdog/i,
  /cleanup-session-locks/i,
  /agentos-memory-sync/i,
  /mem-sync/i,
  /episodic.*sync/i,
  /^echo\s/,
  /^npx sentinel-agentos/
];
function validateContent(filepath, content) {
  const ext = path.extname(filepath).toLowerCase();
  if (ext === ".json") {
    try {
      JSON.parse(content);
      return null;
    } catch (e) {
      return `JSON \u8BED\u6CD5\u9519\u8BEF: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  if ((ext === ".yaml" || ext === ".yml") && content.includes("	") && content.includes("  ")) {
    return "YAML \u7F29\u8FDB\u6DF7\u7528\uFF1A\u540C\u65F6\u5305\u542B tab \u548C\u7A7A\u683C";
  }
  return null;
}
function expandNodeEval(cmd) {
  const m = cmd.match(/node\s+-e\s+"([^"]*)"/);
  if (!m) return null;
  const expanded = m[1].replace(/'([^']*)'\s*\+\s*'([^']*)'/g, "'$1$2'");
  if (expanded === m[1]) return null;
  return expandNodeEval(cmd.replace(m[1], expanded)) || cmd.replace(m[1], expanded);
}
function isWatchdogCommand(cmd) {
  for (const re of WATCHDOG_PATTERNS) {
    if (re.test(cmd)) return true;
  }
  return false;
}
const FALLBACK_RISK = {
  exec: 3,
  write: 2,
  edit: 2,
  delete: 4,
  read: 0.3,
  web_search: 0.5,
  web_fetch: 0.5,
  apply_patch: 3
};
function fallbackRiskScore(toolName, params) {
  const base = FALLBACK_RISK[toolName] ?? 1;
  const cmd = String(params?.command || "");
  if (/rm\s+-rf\s+\//.test(cmd)) return 10;
  if (/sudo/.test(cmd)) return 8;
  if (/drop\s|truncate\s|format\s/.test(cmd)) return 9;
  if (/git\s+push\s+--force/.test(cmd)) return 5;
  if (/npm\s+publish/.test(cmd)) return 4;
  return base;
}
function initAgentOSAsync() {
  setImmediate(() => {
    try {
      aos = new AgentOS({ workspaceRoot });
      if (typeof aos.scoring === "object") {
        log(`v1.4 \u667A\u80FD\u5BA1\u6279\u5DF2\u5C31\u7EEA (\u7F6E\u4FE1\u5EA6+\u884C\u4E3A+\u4FE1\u7528)`);
      } else {
        behaviorModel = new BehaviorModel();
        behaviorModel.enablePersistence(workspaceRoot);
        creditSystem = new CreditSystem();
        creditSystem.enablePersistence(workspaceRoot);
        log(`v1.4 \u667A\u80FD\u5BA1\u6279\u5DF2\u5C31\u7EEA (\u5907\u7528\u6A21\u5F0F)`);
      }
      aosReady = true;
      deduplicateEpisodic();
      log(`AgentOS v0.4.0 \u5DF2\u52A0\u8F7D \u2192 ${workspaceRoot}`);
    } catch (e) {
      warn(`AgentOS \u521D\u59CB\u5316\u5931\u8D25: ${e instanceof Error ? e.message : String(e)}`);
      aos = null;
      aosReady = false;
    }
  });
}
function deduplicateEpisodic() {
  if (!aos) return;
  try {
    const events = aos.memory.episodic;
    if (!events.events || !Array.isArray(events.events)) return;
    const seen = /* @__PURE__ */ new Set();
    const deduped = [];
    for (const ev of events.events) {
      if (ev.tags?.some((t) => t === "sync")) continue;
      if (ev.content && (ev.content.includes("Sync completed") || ev.content.includes("health"))) continue;
      const key = `${ev.type}::${ev.content}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(ev);
    }
    const before = events.events.length;
    events.events = deduped;
    if (events.count !== void 0) events.count = deduped.length;
    const removed = before - deduped.length;
    if (removed > 0) log(`episodic \u53BB\u91CD: ${before} \u2192 ${deduped.length} (\u5220\u9664 ${removed})`);
  } catch {
  }
}
function computeConfidenceForTool(toolName, params, lastMsg) {
  const riskScore = aosReady && aos ? aos.guard.risk.evaluate(toolName, params) : { score: fallbackRiskScore(toolName, params), action: "confirm", dimensions: {} };
  if (aosReady && aos && typeof aos.computeConfidence === "function") {
    return aos.computeConfidence(toolName, params, riskScore, lastMsg);
  }
  const d1 = scoreD1(riskScore);
  const history = { exactMatchCount: 0, sameToolCount: 0, sameCategoryCount: 0 };
  const d2 = scoreD2(toolName, params, history);
  const d3 = scoreD3(toolName, lastMsg);
  const p = String(params?.path || params?.file || "");
  const d4 = scoreD4(p);
  const d5 = scoreD5(/* @__PURE__ */ new Date(), 0);
  return computeConfidence({ d1, d2, d3, d4, d5 });
}
function recordBehaviorForTool(toolName, params, success, confirmed) {
  if (aosReady && aos && typeof aos.recordBehavior === "function") {
    aos.recordBehavior(toolName, params, success, confirmed);
  } else if (behaviorModel) {
    behaviorModel.record({ toolName, params, success, confirmed });
  }
}
const plugin = definePluginEntry({
  id: "sentinel-agentos",
  name: "Sentinel AgentOS",
  description: "v1.4 \u667A\u80FD\u5BA1\u6279: \u7F6E\u4FE1\u5EA6\u8BC4\u5206 + \u884C\u4E3A\u8FFD\u8E2A + \u4FE1\u7528\u4F53\u7CFB + Guard",
  register(api) {
    pluginApi = api;
    workspaceRoot = detectWorkspace();
    const auditDir = path.join(workspaceRoot, ".agentos");
    try {
      fs.mkdirSync(auditDir, { recursive: true });
    } catch {
    }
    auditFilePath = rotateAuditLog(auditDir);
    initAgentOSAsync();
    api.on("before_prompt_build", async (event) => {
      try {
        const msgs = event?.messages ?? [];
        const userMsgs = msgs.filter((m) => m.role === "user" && typeof m.content === "string").slice(-2);
        if (userMsgs.length > 0) {
          lastAIMessage = userMsgs.map((m) => m.content.slice(0, 200)).join(" | ");
        }
      } catch {
      }
    });
    api.on("before_tool_call", async (event) => {
      const { toolName, params } = event;
      const p = params?.path || params?.file || "";
      const contextHint = lastAIMessage ? `

\u{1F4CB} \u6700\u8FD1\u4EFB\u52A1: ${lastAIMessage}` : "";
      const confidenceResult = computeConfidenceForTool(toolName, params || {}, lastAIMessage);
      const { confidence, decision, dimensions } = confidenceResult;
      const { d1, d2, d3, d4, d5 } = dimensions;
      recordBehaviorForTool(toolName, params || {}, true, decision !== "block");
      const confSummary = !lastAIMessage ? "" : `\u{1F4CA} \u7F6E\u4FE1\u5EA6: ${confidence}/100
  D1(\u547D\u4EE4\u98CE\u9669): ${d1.score}/100
  D2(\u5386\u53F2\u884C\u4E3A): ${d2.score}/100 (${d2.matchLevel})
  D3(\u4E0A\u4E0B\u6587): ${d3.score}/100 (${d3.matched}/${d3.total}\u5173\u952E\u8BCD)
  D4(\u8DEF\u5F84): ${d4.score}/100 (${d4.pathType})
  D5(\u65F6\u95F4): ${d5.score}/100${d5.offHours ? " \u{1F319}" : ""}`;
      if (decision === "auto-approve") {
        return;
      }
      if (decision === "block") {
        const reason = `\u7F6E\u4FE1\u5EA6\u8FC7\u4F4E (${confidence}/100)  (D1=${d1.score} D2=${d2.score} D3=${d3.score} D4=${d4.score} D5=${d5.score})`;
        return { block: true, blockReason: `\u{1F6AB} Sentinel: ${reason}` };
      }
      if (toolName === "exec" && params?.command) {
        const cmd = String(params.command);
        const expandedCmd = expandNodeEval(cmd);
        const checkCmd = expandedCmd || cmd;
        for (const [re, desc] of DANGEROUS_COMMANDS) {
          if (re.test(checkCmd)) {
            return {
              requireApproval: {
                title: "\u{1F6AB} Sentinel \u62E6\u622A",
                description: `${confSummary}

Sentinel: ${desc}

\u547D\u4EE4: ${cmd.substring(0, 200)}${contextHint}`,
                severity: "critical",
                timeoutMs: 6e4,
                timeoutBehavior: "deny"
              }
            };
          }
        }
        for (const [re, desc] of WARNING_COMMANDS) {
          if (re.test(checkCmd)) {
            return {
              requireApproval: {
                title: "\u26A0\uFE0F \u9700\u8981\u786E\u8BA4",
                description: `${confSummary}

Sentinel: ${desc}

\u547D\u4EE4: ${cmd.substring(0, 200)}${contextHint}`,
                severity: "warning",
                timeoutMs: 6e4,
                timeoutBehavior: "deny"
              }
            };
          }
        }
      }
      if (p && ["write", "edit", "delete", "read"].includes(toolName)) {
        for (const ptn of SENSITIVE_PATTERNS) {
          if (globMatch(ptn, String(p))) {
            return { block: true, blockReason: `\u{1F6AB} Sentinel: \u654F\u611F\u6587\u4EF6 \u2014 "${p}" \u5339\u914D "${ptn}"` };
          }
        }
      }
      if (p && ["write", "edit", "delete"].includes(toolName)) {
        for (const pf of PROTECTED_PATTERNS) {
          if (globMatch(pf, String(p))) {
            return {
              requireApproval: {
                title: "\u26A0\uFE0F \u4FEE\u6539\u6838\u5FC3\u914D\u7F6E",
                description: `${confSummary}

Sentinel: \u6587\u4EF6 "${p}" \u53D7\u4FDD\u62A4\uFF0C\u4FEE\u6539\u53EF\u80FD\u5BFC\u81F4\u7CFB\u7EDF\u4E0D\u53EF\u7528\u3002\u786E\u8BA4\u7EE7\u7EED\uFF1F${contextHint}`,
                severity: "warning",
                timeoutMs: 6e4,
                timeoutBehavior: "deny"
              }
            };
          }
        }
      }
      if (p && ["write", "edit"].includes(toolName) && params?.content) {
        const err = validateContent(String(p), String(params.content));
        if (err) return { block: true, blockReason: `\u{1F6AB} Sentinel: ${err}` };
      }
      return {
        requireApproval: {
          title: "\u26A0\uFE0F \u64CD\u4F5C\u9700\u8981\u786E\u8BA4",
          description: `${confSummary}

\u64CD\u4F5C: ${toolName}
${contextHint}`,
          severity: "warning",
          timeoutMs: 6e4,
          timeoutBehavior: "deny"
        }
      };
    }, { priority: 100 });
    let lastAuditTs = 0;
    api.on("after_tool_call", async (event) => {
      const { toolName, params, error, startedAt, completedAt } = event;
      if (toolName === "exec" && params?.command) {
        if (isWatchdogCommand(String(params.command))) return;
      }
      const now = Date.now();
      const hash = `${toolName}:${JSON.stringify(params || {}).slice(0, 80)}`;
      if (now - auditKeyCleanupTs > 6e4) {
        recentAuditKeys.clear();
        auditKeyCleanupTs = now;
      }
      if (recentAuditKeys.has(hash)) return;
      recentAuditKeys.add(hash);
      const isBurst = now - lastAuditTs < 2e3;
      lastAuditTs = now;
      const lightLine = JSON.stringify({
        id: `audit_${now}`,
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        toolName,
        ok: !error,
        stage: "light",
        ...isBurst ? {} : { toolParameters: params ? JSON.stringify(params).substring(0, 200) : "{}" }
      });
      auditWrite(lightLine);
      if (isBurst) return;
      if (cbIsOpen()) return;
      const done = { value: false };
      const timeoutId = setTimeout(() => {
        if (!done.value) {
          done.value = true;
          cbRecordError();
          warn(`after_tool_call \u8D85\u65F6 (${toolName})`);
        }
      }, 500);
      setImmediate(() => {
        if (done.value) return;
        try {
          if (!aos || !aosReady) {
            done.value = true;
            clearTimeout(timeoutId);
            return;
          }
          if (toolName === "exec" && params?.command) {
            const cmd = String(params.command);
            const isNoise = /^(echo|dir|ls|cat|type|Get-|Select-|Measure-|npx sentinel|openclaw |node -v|npm -v|git status|git log|git diff)/i.test(cmd.trim());
            if (!isNoise) aos.memory.episodic.record("tool_call", cmd, ["exec"], []);
          }
          if (!error) aos.recordFeedback("user_used_result", "plugin_session");
          cbRecordSuccess();
        } catch (e) {
          cbRecordError();
          warn(`after_tool_call \u5F02\u5E38: ${e instanceof Error ? e.message : String(e)}`);
        }
        done.value = true;
        clearTimeout(timeoutId);
      });
    }, { priority: 90 });
    api.on("session_start", async () => {
      if (!aos || !aosReady) return;
      setImmediate(() => {
        try {
          const allEvents = aos.memory.episodic.getAll();
          const topEvents = allEvents.filter((e) => e.importance >= 0.6).slice(0, 5);
          const parts = [];
          try {
            const sem = aos.memory.semantic.generateContextSummary(800);
            if (sem) parts.push(sem);
          } catch {
          }
          if (topEvents.length > 0) {
            const lines = ["[AgentOS Episodic Memory]", ""];
            for (const ev of topEvents) {
              const date = new Date(ev.timestamp).toISOString().split("T")[0];
              const content = (ev.content || "").slice(0, 150);
              lines.push(`\u{1F4DD} [${date}] ${content}`);
              if (lines.join("\n").length > 600) break;
            }
            parts.push(lines.join("\n"));
          }
          const ctx = parts.join("\n\n---\n\n");
          log(`\u4E0A\u4E0B\u6587\u5DF2\u6CE8\u5165 (${ctx.length} chars, ${topEvents.length} \u7CBE\u9009\u4E8B\u4EF6 / ${allEvents.length} \u603B\u8BA1)`);
          try {
            const snapshot = aos.memory.episodic.getSearchableSnapshot(50);
            if (snapshot) {
              const memDir = path.join(workspaceRoot, "memory");
              fs.mkdirSync(memDir, { recursive: true });
              fs.writeFileSync(path.join(memDir, "agentos-episodic.md"), snapshot, "utf-8");
              log(`\u53EF\u641C\u7D22\u7D22\u5F15\u5DF2\u5199\u5165 memory/agentos-episodic.md`);
            }
          } catch {
          }
        } catch {
        }
      });
    });
    setImmediate(() => {
      try {
        if (!creditSystem) {
          creditSystem = new CreditSystem();
          creditSystem.enablePersistence(workspaceRoot);
        }
        creditSystem.applyInactivityDecay();
        log(`\u4FE1\u7528\u4F53\u7CFB\u5DF2\u5C31\u7EEA`);
        const agents = creditSystem.getAllAgents();
        const agentCount = Object.keys(agents).length;
        if (agentCount > 0) {
          const summary = Object.entries(agents).map(([id, a]) => `${id}: L${a.level} (${a.totalOps} ops)`).join(", ");
          log(`\u4FE1\u7528\u62A5\u544A: ${summary}`);
        } else {
          log(`\u4FE1\u7528\u62A5\u544A: \u5C1A\u65E0 Agent \u6570\u636E`);
        }
      } catch {
      }
    });
    log("\u2705 v1.4 \u5DF2\u6CE8\u518C: before_tool_call(\u7F6E\u4FE1\u5EA6/\u884C\u4E3A/\u62E6\u622A) + after_tool_call(\u5BA1\u8BA1) + session_start(\u8BB0\u5FC6)");
    log(`\u62E6\u622A\u89C4\u5219: \u5371\u9669x${DANGEROUS_COMMANDS.length} | \u8B66\u544Ax${WARNING_COMMANDS.length} | CB\u9608\u503C=${CB_THRESHOLD}`);
  }
});
var index_default = plugin;
export {
  index_default as default
};
//# sourceMappingURL=index.mjs.map
