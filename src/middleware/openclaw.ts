/**
 * Sentinel AgentOS Middleware — OpenClaw Plugin
 *
 * Seamless integration with OpenClaw agent runtime.
 * Hooks into OpenClaw's tool-call lifecycle to add Guard + Memory + Evaluator.
 *
 * Usage:
 *   In your OpenClaw skill or agent config:
 *
 *   import { sentinelPlugin } from 'sentinel-agentos';
 *
 *   const plugin = sentinelPlugin({ workspaceRoot: '/workspace' });
 *   plugin.onBeforeTool((toolName, params) => { ... });  // returns risk + schema
 *   plugin.onAfterTool((toolName, params, result) => { ... });  // returns verify + audit
 */

import { wrapAgent, WrappedAgent } from './wrapper';
import type { AgentOSConfig } from '../types';

export interface OpenClawPlugin {
  readonly wrapped: WrappedAgent;

  /** Called before an OpenClaw tool call */
  onBeforeTool: (toolName: string, params: Record<string, unknown>) => {
    allowed: boolean;
    whitelisted: boolean;
    riskScore: number;
    riskAction: string;
    confidence?: number;
    confidenceDecision?: string;
    creditLevel?: number;
    schemaErrors?: string[];
    reason?: string;
  };

  /** Called after an OpenClaw tool call */
  onAfterTool: (
    toolName: string,
    params: Record<string, unknown>,
    result: unknown,
    startTime: number,
    opts?: { retryCount?: number; wasSelfCorrected?: boolean; hadTimeout?: boolean; userAccepted?: boolean; userProvidedEdit?: boolean; resultWasUsed?: boolean },
  ) => {
    verifyPassed: boolean;
    verifyDetail: string;
    verifyChecks?: { name: string; status: string; detail?: string }[];
    auditId: string;
    riskDimensions?: { impact: number; reversibility: number; sensitivity: number; errorRate: number };
    creditLevel?: number;
    profile?: any;
  };

  /** Session management — start returns memory context, end returns summary */
  sessionStart: (sessionId: string) => string;
  sessionEnd: (sessionId: string) => { summary: string; creditLevel: number; detectedSignals: number; evolvedRules: number; ruleCount: number } | void;

  /** Feedback hooks — call these when user signals are detected */
  recordApproval: (sessionId: string) => void;
  recordCorrection: (sessionId: string) => void;
  recordDeletion: (sessionId: string) => void;

  /** Health check report (v1.4.1) */
  healthCheck: (full?: boolean) => import('../types').HealthCheckReport | string;

  /** Dashboard / status report */
  getStatusReport: () => string;
  getDashboardData: () => Record<string, unknown>;

  /** 🚀 v1.5.0 白名单 */
  readonly whitelist: WrappedAgent['whitelist'];
}

/**
 * Create an OpenClaw plugin that wraps Sentinel AgentOS.
 */
export function sentinelPlugin(config?: Partial<AgentOSConfig>): OpenClawPlugin {
  const wrapped = wrapAgent(config);
  const sessionStates = new Map<string, { startTime: number }>();

  // Register safe default rules for common OpenClaw tools
  wrapped.aos.guard.schema.registerRules([
    {
      tool: 'write',
      required: ['path', 'content'],
      pathDeny: { path: ['.env', '*.key', '*.pem', '.git/**', '**/SECRETS/**', '**/credentials/**'] },
    },
    {
      tool: 'read',
      required: ['path'],
      pathDeny: { path: ['.env', '*.key', '*.pem'] },
    },
    {
      tool: 'exec',
      required: ['command'],
    },
    {
      tool: 'edit',
      required: ['path'],
      pathDeny: { path: ['.env', '*.key', '*.pem', '.git/**'] },
    },
    {
      tool: 'delete',
      required: ['path'],
      pathDeny: { path: ['.env', '*.key', '*.pem', '.git/**', 'node_modules/**'] },
    },
  ]);

  // 🚀 v1.5.0 默认白名单 — 安全操作直接跳过审批，0 延迟
  // read: 读文件是纯安全操作
  wrapped.whitelist.addRule({ type: 'tool', tool: 'read', label: '读操作默认放行' });
  // web_search / web_fetch: 只读网络操作
  wrapped.whitelist.addRule({ type: 'tool', tool: 'web_search', label: '搜索操作默认放行' });
  wrapped.whitelist.addRule({ type: 'tool', tool: 'web_fetch', label: '抓取操作默认放行' });
  // exec 常用安全命令
  wrapped.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'npm ', label: 'npm 命令放行' });
  wrapped.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'node ', label: 'node 命令放行' });
  wrapped.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'tsc ', label: 'tsc 编译放行' });
  wrapped.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'cd ', label: 'cd 命令放行' });
  wrapped.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'ls', label: 'ls 命令放行' });
  wrapped.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'dir', label: 'dir 命令放行' });
  wrapped.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'cat ', label: 'cat 命令放行' });
  wrapped.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'type ', label: 'type 命令放行' });
  wrapped.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'pwd', label: 'pwd 命令放行' });
  wrapped.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'echo ', label: 'echo 命令放行' });
  wrapped.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'ping ', label: 'ping 命令放行' });
  wrapped.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'which ', label: 'which 命令放行' });
  wrapped.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'where ', label: 'where 命令放行' });
  // git 安全操作（不含 force push 等危险子命令）
  wrapped.whitelist.addRule({ type: 'pattern', tool: 'exec', pattern: '^git (status|diff|log|branch|checkout [^-]|add|commit|pull|fetch|clone|merge|rebase [^-]|stash)', label: 'git 安全操作放行' });
  // 常用文件写入：src/ 和 tests/ 下的源码
  wrapped.whitelist.addRule({ type: 'pattern', tool: 'write', pattern: 'src\\(.*\\){0,1}\\.(ts|js|tsx|jsx|css|scss|html|json|md)$', label: '源码写入放行' });
  wrapped.whitelist.addRule({ type: 'pattern', tool: 'write', pattern: 'tests?\\(.*\\){0,1}\\.(ts|js|tsx|jsx)$', label: '测试文件写入放行' });
  wrapped.whitelist.addRule({ type: 'pattern', tool: 'edit', pattern: 'src\\(.*\\){0,1}\\.(ts|js|tsx|jsx|css|scss|html|json|md)$', label: '源码编辑放行' });

  let lastSnapshot: any = null;

  return {
    wrapped,

    onBeforeTool(toolName, params) {
      // 🚀 v1.5.0 白名单：跳过全部审批链路
      if (wrapped.whitelist.isWhitelisted(toolName, params)) {
        return {
          allowed: true,
          whitelisted: true,
          riskScore: 0,
          riskAction: 'auto',
          schemaErrors: undefined,
        };
      }

      const check = wrapped.preCheck(toolName, params);
      lastSnapshot = check.snapshot;

      // 🚀 v1.5.0 信用体系联动
      const confidence = wrapped.aos.computeConfidence(
        toolName, params, check.preExec.riskScore, undefined, 'openclaw',
      );

      const allowed = confidence.decision !== 'block';
      const schemaErrors = check.preExec.schemaCheck?.errors?.map((e: any) => e.message) ?? [];

      return {
        allowed,
        whitelisted: false,
        riskScore: check.preExec.riskScore.score,
        riskAction: check.preExec.riskScore.action,
        confidence: confidence.confidence,
        confidenceDecision: confidence.decision,
        creditLevel: (confidence.dimensions as any).creditLevel,
        schemaErrors: schemaErrors.length > 0 ? schemaErrors : undefined,
        reason: !allowed ? `Confidence ${confidence.confidence} → ${confidence.decision}` : undefined,
      };
    },

    onAfterTool(toolName, params, result, startTime, opts) {
      // 使用传入的实际参数，而不是硬编码默认值
      const check = wrapped.postCheck(toolName, params, result, lastSnapshot, startTime, {
        ...opts,
      });

      // 🚀 记录 behavior 用于自进化
      wrapped.aos.recordBehavior(toolName, params, true, false);
      const creditLevel = wrapped.aos.scoring.credit.getLevel('openclaw');

      // 提取 verify 检查详情
      const verifyChecks = check.audit?.verifyGate?.checks?.map((c: any) => ({
        name: c.name,
        status: c.status,
        detail: c.detail,
      }));

      return {
        verifyPassed: check.postExec.verifyPassed,
        verifyDetail: check.postExec.outcomeScore >= 0.7 ? 'PASS' : check.postExec.outcomeScore >= 0.4 ? 'WARN' : 'FAIL',
        verifyChecks: verifyChecks?.length ? verifyChecks : undefined,
        auditId: check.audit.id,
        riskDimensions: (check.audit as any)?.riskGate?.dimensions,
        creditLevel,
        profile: check.profile ? {
          overallScore: check.profile.overallScore || 0,
          totalOps: check.profile.totalOps || 0,
          breakdown: check.profile.breakdown,
        } : undefined,
      };
    },

    sessionStart(sessionId) {
      const startTime = Date.now();
      sessionStates.set(sessionId, { startTime });
      return wrapped.injectContext();
    },

    /**
     * End session and return a brief summary with auto-evolution results.
     */
    sessionEnd(sessionId): { summary: string; creditLevel: number; detectedSignals: number; evolvedRules: number; ruleCount: number } | void {
      const startInfo = sessionStates.get(sessionId);
      const duration = startInfo ? Math.round((Date.now() - startInfo.startTime) / 1000) : 0;
      const creditLevel = wrapped.aos.scoring.credit.getLevel('openclaw');

      // 🚀 触发自进化
      const evolution = wrapped.aos.scoring.behavior.evolve();
      wrapped.aos.scoring.credit.applyInactivityDecay();

      wrapped.endSession(sessionId);
      sessionStates.delete(sessionId);

      const ruleCount = wrapped.aos.memory.semantic.getRules(0.6).length;
      const summary = `Session ended (${duration}s) — Credit L${creditLevel} | Evolved: ${evolution.evolved} rules | Rules: ${ruleCount}`;
      wrapped.aos.memory.episodic.record(
        'milestone',
        summary,
        ['session', 'milestone'],
        [],
      );
      return { summary, creditLevel, detectedSignals: 0, evolvedRules: evolution.evolved, ruleCount };
    },

    recordApproval(sessionId) {
      wrapped.aos.recordFeedback('user_explicit_approval', sessionId);
    },

    recordCorrection(sessionId) {
      wrapped.aos.recordFeedback('user_modified_output', sessionId);
    },

    recordDeletion(sessionId) {
      wrapped.aos.recordFeedback('user_deleted_code', sessionId);
    },

    healthCheck(full?: boolean) {
      return wrapped.aos.healthCheck(full as any);
    },

    getStatusReport() {
      return wrapped.aos.statusReport();
    },

    getDashboardData() {
      return wrapped.aos.getReport();
    },

    whitelist: wrapped.whitelist,
  };
}
