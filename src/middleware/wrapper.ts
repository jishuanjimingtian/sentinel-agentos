/**
 * Sentinel AgentOS Middleware 鈥?Framework-Agnostic Wrapper
 *
 * Wraps any Agent's tool-call execution in Sentinel's Guard + Memory + Evaluator pipeline.
 * One-line integration 鈥?no changes to your Agent logic.
 *
 * Usage:
 *   import { wrapAgent } from 'sentinel-agentos';
 *   const sentinel = wrapAgent({ workspaceRoot: '/project' });
 *   const result = await sentinel.execute('write_file', { path: 'src/main.ts', ... }, callback);
 */

import { AgentOS } from '../core';
import type { AgentOSConfig, PreExecMetrics, PostExecMetrics, AuditEntry } from '../types';
import type { AgentProfile } from '../evaluator/profiler';

export interface WrappedAgent {
  /** Call this before every tool execution */
  preCheck: (toolName: string, params: Record<string, unknown>) => {
    preExec: PreExecMetrics;
    snapshot: any;
    allowed: boolean;
    reason?: string;
  };

  /** Call this after every tool execution */
  postCheck: (toolName: string, params: Record<string, unknown>, result: unknown, snapshot: any, startTime: number, opts?: {
    retryCount?: number;
    wasSelfCorrected?: boolean;
    hadTimeout?: boolean;
    userAccepted?: boolean;
    userProvidedEdit?: boolean;
    resultWasUsed?: boolean;
  }) => {
    runtime: any;
    postExec: PostExecMetrics;
    audit: AuditEntry;
    profile: AgentProfile;
  };

  /** Full pipeline: pre-check 鈫?execute callback 鈫?post-check */
  execute: <R>(
    toolName: string,
    params: Record<string, unknown>,
    fn: () => R | Promise<R>,
    opts?: { sessionId?: string; agentId?: string; affectedFiles?: string[] },
  ) => Promise<{
    allowed: boolean;
    reason?: string;
    result?: R;
    runtime?: any;
    postExec?: PostExecMetrics;
    audit?: AuditEntry;
    profile?: AgentProfile;
  }>;

  /** Inject memory context at session start */
  injectContext: () => string;

  /** End session */
  endSession: (sessionId: string) => void;

  /** Get status report */
  statusReport: () => string;

  /** Health check report (v1.4.1) */
  healthCheck: (full?: boolean) => import('../types').HealthCheckReport | string;

  /** Raw AgentOS instance for advanced use */
  readonly aos: AgentOS;

  /** 🚀 v1.5.0 白名单 */
  readonly whitelist: {
    addRule: (rule: { type: 'exact' | 'tool' | 'pattern' | 'command'; tool: string; pattern?: string; label?: string }) => any;
    removeRule: (id: string) => boolean;
    getRules: () => any[];
    isWhitelisted: (tool: string, params: Record<string, unknown>) => boolean;
    clear: () => void;
  };
}

export function wrapAgent(config?: Partial<AgentOSConfig>): WrappedAgent {
  const aos = new AgentOS(config);

  // 🚀 v1.5.0 默认白名单 — 安全操作直接跳过审批
  aos.whitelist.addRule({ type: 'tool', tool: 'read', label: '读操作默认放行' });
  aos.whitelist.addRule({ type: 'tool', tool: 'web_search', label: '搜索操作默认放行' });
  aos.whitelist.addRule({ type: 'tool', tool: 'web_fetch', label: '抓取操作默认放行' });
  aos.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'npm ', label: 'npm 命令放行' });
  aos.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'node ', label: 'node 命令放行' });
  aos.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'tsc ', label: 'tsc 编译放行' });
  aos.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'cd ', label: 'cd 命令放行' });
  aos.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'ls', label: 'ls 命令放行' });
  aos.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'dir', label: 'dir 命令放行' });
  aos.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'cat ', label: 'cat 命令放行' });
  aos.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'type ', label: 'type 命令放行' });
  aos.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'echo ', label: 'echo 命令放行' });
  aos.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'which ', label: 'which 命令放行' });
  aos.whitelist.addRule({ type: 'command', tool: 'exec', pattern: 'where ', label: 'where 命令放行' });
  aos.whitelist.addRule({ type: 'pattern', tool: 'exec', pattern: '^git (status|diff|log|branch|checkout [^-]|add|commit|pull|fetch|clone|merge|rebase [^-]|stash)', label: 'git 安全操作放行' });
  aos.whitelist.addRule({ type: 'pattern', tool: 'write', pattern: 'src[/\\\\].*\\.(ts|js|tsx|jsx|css|scss|html|json|md)$', label: '源码写入放行' });
  aos.whitelist.addRule({ type: 'pattern', tool: 'write', pattern: 'tests?[/\\\\].*\\.(ts|js|tsx|jsx)$', label: '测试文件写入放行' });
  aos.whitelist.addRule({ type: 'pattern', tool: 'edit', pattern: 'src[/\\\\].*\\.(ts|js|tsx|jsx|css|scss|html|json|md)$', label: '源码编辑放行' });

  let sessionCounter = 0;

  const wrapped: WrappedAgent = {
    aos,

    preCheck(toolName, params) {
      const { preExec, snapshot } = aos.executePipeline({
        sessionId: `wrapped_${sessionCounter}`,
        agentId: 'wrapped_agent',
        toolName,
        parameters: params,
      });

      const allowed = preExec.riskScore.action !== 'deny';
      const reason = !allowed
        ? `Risk score ${preExec.riskScore.score} 鈫?DENY (${preExec.riskScore.dimensions?.impact} impact)`
        : undefined;

      return { preExec, snapshot, allowed, reason };
    },

    postCheck(toolName, params, result, snapshot, startTime, opts?: {
      retryCount?: number;
      wasSelfCorrected?: boolean;
      hadTimeout?: boolean;
      userAccepted?: boolean;
      userProvidedEdit?: boolean;
      resultWasUsed?: boolean;
    }) {
      const ret = aos.completeExecution({
        sessionId: `wrapped_${sessionCounter}`,
        agentId: 'wrapped_agent',
        toolName,
        toolParameters: params,
        toolResult: result,
        snapshot,
        startTime,
        endTime: Date.now(),
        retryCount: opts?.retryCount ?? 0,
        wasSelfCorrected: opts?.wasSelfCorrected ?? false,
        hadTimeout: opts?.hadTimeout ?? false,
        userAccepted: opts?.userAccepted ?? true,
        userProvidedEdit: opts?.userProvidedEdit ?? false,
        resultWasUsed: opts?.resultWasUsed ?? false,
      });

      return {
        runtime: ret.runtime,
        postExec: ret.postExec,
        audit: ret.auditEntry,
        profile: ret.profile,
      };
    },

    async execute<R>(
      toolName: string,
      params: Record<string, unknown>,
      fn: () => R | Promise<R>,
      opts?: { sessionId?: string; agentId?: string; affectedFiles?: string[] },
    ) {
      const sid = opts?.sessionId ?? `wrapped_${++sessionCounter}`;
      const aid = opts?.agentId ?? 'wrapped_agent';

      // Memory context at session start
      if (sessionCounter === 1) {
        aos.injectContext();
      }

      // 🚀 v1.5.0 白名单：跳过全部审批链路
      if (aos.whitelist.isWhitelisted(toolName, params)) {
        let result: R;
        try {
          result = await Promise.resolve(fn());
        } catch (err: any) {
          return { allowed: true, result: undefined as any, reason: `Execution failed: ${err.message}` };
        }
        return { allowed: true, result };
      }

      // Pre-check
      const { preExec, snapshot } = aos.executePipeline({
        sessionId: sid,
        agentId: aid,
        toolName,
        parameters: params,
        affectedFiles: opts?.affectedFiles,
      });

      // v1.4.1: 淇＄敤鑱斿姩鍐崇瓥 鈥?鐢?computeConfidence (鍚?credit boost) 瑕嗗啓 deny 鍒ゅ畾
      const confidence = aos.computeConfidence(
        toolName, params, preExec.riskScore, undefined, aid,
      );

      if (confidence.decision === 'block') {
        aos.scoring.credit.recordOutcome(aid, false, true);
        return {
          allowed: false,
          reason: `Confidence ${confidence.confidence} (L${aos.scoring.credit.getLevel(aid)}) 鈫?BLOCK`,
          profile: aos.getProfile(sid),
        };
      }

      // Optionally warn for 'confirm' level 鈥?but in middleware we auto-proceed
      // In production you'd hook this into your Agent's confirmation loop
      if (confidence.decision === 'confirm') {
        // Track that confirmation was required
        aos.scoring.behavior.record({ toolName, params, success: false, confirmed: false });
      }

      const startTime = Date.now();

      // Execute
      let result: R;
      try {
        result = await Promise.resolve(fn());
      } catch (err: any) {
        // Execution failed 鈥?still record in audit
        const ret = aos.completeExecution({
          sessionId: sid,
          agentId: aid,
          toolName,
          toolParameters: params,
          toolResult: { error: err.message },
          snapshot,
          startTime,
          endTime: Date.now(),
          retryCount: 0,
          wasSelfCorrected: false,
          hadTimeout: false,
          userAccepted: false,
          userProvidedEdit: false,
          resultWasUsed: false,
        });

        return {
          allowed: true,
          result: undefined as any,
          reason: `Execution failed: ${err.message}`,
          runtime: ret.runtime,
          postExec: ret.postExec,
          audit: ret.auditEntry,
          profile: ret.profile,
        };
      }

      // Post-check
      const ret = aos.completeExecution({
        sessionId: sid,
        agentId: aid,
        toolName,
        toolParameters: params,
        toolResult: result,
        snapshot,
        startTime,
        endTime: Date.now(),
        retryCount: 0,
        wasSelfCorrected: false,
        hadTimeout: false,
        userAccepted: true,
        userProvidedEdit: false,
        resultWasUsed: false,
      });

      return {
        allowed: true,
        result,
        runtime: ret.runtime,
        postExec: ret.postExec,
        audit: ret.auditEntry,
        profile: ret.profile,
      };
    },

    injectContext() {
      return aos.injectContext();
    },

    endSession(sid) {
      // Cast needed because endSession is typed narrowly in core
      aos.endSession(sid);
    },

    statusReport() {
      return aos.statusReport();
    },

    healthCheck(full?: boolean) {
      return aos.healthCheck(full as any);
    },

    // 🚀 v1.5.0 白名单
    whitelist: {
      addRule: (rule) => aos.whitelist.addRule(rule),
      removeRule: (id) => aos.whitelist.removeRule(id),
      getRules: () => aos.whitelist.getRules(),
      isWhitelisted: (tool, params) => aos.whitelist.isWhitelisted(tool, params),
      clear: () => aos.whitelist.clear(),
    },
  };

  return wrapped;
}
