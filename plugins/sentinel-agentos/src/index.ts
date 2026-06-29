/**
 * Sentinel AgentOS OpenClaw Plugin (v1.5)
 *
 * 纯胶水层 — 完整映射核心包 sentinel-agentos 的所有功能。
 * 不写任何独立逻辑，只做 OpenClaw event ↔ 核心包 API 的转换。
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { sentinelPlugin } from "sentinel-agentos";
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

let plugin: ReturnType<typeof sentinelPlugin> | null = null;
let pluginStartTime = 0;
let workspaceRoot = "";
let pluginApi: any = null;

// ═══════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════

function detectWorkspace(): string {
  if (process.env.OPENCLAW_WORKSPACE) return process.env.OPENCLAW_WORKSPACE;
  const home = process.env.USERPROFILE || process.env.HOME || "";
  return path.join(home, ".openclaw", "workspace");
}

function log(msg: string): void {
  const text = `[Sentinel] ${msg}`;
  if (pluginApi?.logger?.info) pluginApi.logger.info(text);
  else console.log(text);
}

function warn(msg: string): void {
  const text = `[Sentinel] ${msg}`;
  if (pluginApi?.logger?.warn) pluginApi.logger.warn(text);
  else console.warn(text);
}

// ═══════════════════════════════════════
// OpenClaw Plugin Entry
// ═══════════════════════════════════════

const entry = definePluginEntry({
  id: "sentinel-agentos",
  name: "Sentinel AgentOS",
  description: "v1.5 智能审批: 核心包完整功能映射",

  register(api) {
    pluginApi = api;
    workspaceRoot = detectWorkspace();

    // 🚀 所有功能走核心包 sentinelPlugin()
    try {
      plugin = sentinelPlugin({ workspaceRoot });
      pluginStartTime = Date.now();
      log(`核心包已加载 (白名单 ${plugin.whitelist.getRules().length} 条规则)`);
    } catch (e: unknown) {
      warn(`核心包加载失败: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    // ══════════════════════════════════
    // Hook 0: before_prompt_build — 对话上下文（记忆注入）
    // ══════════════════════════════════

    api.on("before_prompt_build", async (event: any) => {
      try {
        if (event?.sessionId) {
          plugin!.sessionStart(event.sessionId);
        }
      } catch { /* non-critical */ }
    });

    // ══════════════════════════════════
    // Hook 1: before_tool_call — 核心包全链路
    // ══════════════════════════════════

    api.on("before_tool_call", async (event: ToolCallEvent) => {
      const { toolName, params } = event as any;

      // 核心包 onBeforeTool：白名单 + RiskGate + Schema + 信用体系 + computeConfidence
      const result = plugin!.onBeforeTool(toolName, params || {});

      // 白名单命中 → 直接放行
      if (result.whitelisted) {
        return;
      }

      // auto-approve / silent-allow → 放行
      if (result.confidenceDecision === "auto-approve" || result.confidenceDecision === "silent-allow") {
        return;
      }

      // confirm / strict-confirm / block → 弹窗
      const isBlock = result.confidenceDecision === "block";
      const isStrict = result.confidenceDecision === "strict-confirm";
      return {
        requireApproval: {
          title: isBlock ? "Sentinel 拦截 (置信度过低)" : isStrict ? "操作需严格确认" : "操作需要确认",
          description: [
            `置信度: ${result.confidence ?? '?'}/100 (${result.confidenceDecision ?? '?'})`,
            `信用等级: L${result.creditLevel ?? 1}`,
            result.reason ? `原因: ${result.reason}` : "",
            `操作: ${toolName}`,
          ].filter(Boolean).join("\n"),
          severity: isBlock || isStrict ? ("critical" as const) : ("warning" as const),
          timeoutMs: isStrict ? 120_000 : 60_000,
          timeoutBehavior: "deny" as const,
        },
      };
    }, { priority: 100 });

    // ══════════════════════════════════
    // Hook 2: after_tool_call — 核心包完整后处理
    // ══════════════════════════════════

    api.on("after_tool_call", async (event: ToolCallEvent) => {
      const { toolName, params, error, startedAt, agentId } = event as any;
      if (!plugin) return;

      setImmediate(() => {
        try {
          const afterResult = plugin!.onAfterTool(
            toolName,
            params || {},
            { error: error ? String(error) : undefined, ok: !error },
            startedAt || Date.now(),
            { retryCount: 0, wasSelfCorrected: false, hadTimeout: false, userAccepted: !error, resultWasUsed: !error },
          );
          log(`审计: ${toolName} → ${afterResult.verifyDetail} (L${afterResult.creditLevel})`);
        } catch (e: unknown) {
          warn(`after_tool_call 异常: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
    }, { priority: 90 });

    // ══════════════════════════════════
    // Hook 3: session_start — 完整上下文注入
    // ══════════════════════════════════

    api.on("session_start", async (event: any) => {
      const sid = event?.sessionId || `session_${Date.now()}`;
      if (!plugin) return;

      setImmediate(() => {
        try {
          plugin!.sessionStart(sid);
        } catch { /* non-critical */ }
      });
    });

    // ══════════════════════════════════
    // Hook 4: session_end — 核心包完整收尾
    // ══════════════════════════════════

    api.on("session_end", async (event: any) => {
      const sid = event?.sessionId;
      if (!plugin || !sid) return;

      setImmediate(() => {
        try {
          const summary = plugin!.sessionEnd(sid);
          if (summary) {
            log(`会话结束: ${summary.summary}`);
          }
        } catch (e: unknown) {
          warn(`session_end 异常: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
    });

    // ══════════════════════════════════
    // 周期性自进化（每 30 分钟触发一次）
    // ══════════════════════════════════

    setInterval(() => {
      if (!plugin) return;
      try {
        const evolution = plugin!.wrapped.aos.scoring.behavior.evolve();
        plugin!.wrapped.aos.scoring.credit.applyInactivityDecay();
        if (evolution.evolved > 0) log(`周期自进化: ${evolution.evolved} 条过期清理`);
      } catch { /* non-critical */ }
    }, 30 * 60 * 1000).unref();

    // 初始日志
    const status = plugin.healthCheck();
    log(`✅ 核心包完整映射已注册`);
    log(`白名单规则: ${plugin.whitelist.getRules().length} 条`);
    log(`配置目录: ${workspaceRoot}`);
  },
});

export default entry;
