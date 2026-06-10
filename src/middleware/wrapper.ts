/**
 * Sentinel AgentOS Middleware — Framework-Agnostic Wrapper
 *
 * Wraps any Agent's tool-call execution in Sentinel's Guard + Memory + Evaluator pipeline.
 * One-line integration — no changes to your Agent logic.
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
  postCheck: (toolName: string, params: Record<string, unknown>, result: unknown, snapshot: any, startTime: number) => {
    runtime: any;
    postExec: PostExecMetrics;
    audit: AuditEntry;
    profile: AgentProfile;
  };

  /** Full pipeline: pre-check → execute callback → post-check */
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

  /** Raw AgentOS instance for advanced use */
  readonly aos: AgentOS;
}

export function wrapAgent(config?: Partial<AgentOSConfig>): WrappedAgent {
  const aos = new AgentOS(config);

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
        ? `Risk score ${preExec.riskScore.score} → DENY (${preExec.riskScore.dimensions?.impact} impact)`
        : undefined;

      return { preExec, snapshot, allowed, reason };
    },

    postCheck(toolName, params, result, snapshot, startTime) {
      const ret = aos.completeExecution({
        sessionId: `wrapped_${sessionCounter}`,
        agentId: 'wrapped_agent',
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

      // Pre-check
      const { preExec, snapshot } = aos.executePipeline({
        sessionId: sid,
        agentId: aid,
        toolName,
        parameters: params,
        affectedFiles: opts?.affectedFiles,
      });

      if (preExec.riskScore.action === 'deny') {
        return {
          allowed: false,
          reason: `Risk score ${preExec.riskScore.score} → ${preExec.riskScore.action}`,
          profile: aos.getProfile(sid),
        };
      }

      // Optionally warn for 'confirm' level — but in middleware we auto-proceed
      // In production you'd hook this into your Agent's confirmation loop

      const startTime = Date.now();

      // Execute
      let result: R;
      try {
        result = await Promise.resolve(fn());
      } catch (err: any) {
        // Execution failed — still record in audit
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
  };

  return wrapped;
}
