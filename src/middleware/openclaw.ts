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
    riskScore: number;
    riskAction: string;
    schemaErrors?: string[];
  };

  /** Called after an OpenClaw tool call */
  onAfterTool: (
    toolName: string,
    params: Record<string, unknown>,
    result: unknown,
    startTime: number,
  ) => {
    verifyPassed: boolean;
    verifyDetail: string;
    auditId: string;
  };

  /** Session management */
  sessionStart: (sessionId: string) => string;
  sessionEnd: (sessionId: string) => void;

  /** Feedback hooks — call these when user signals are detected */
  recordApproval: (sessionId: string) => void;
  recordCorrection: (sessionId: string) => void;
  recordDeletion: (sessionId: string) => void;
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

  let lastSnapshot: any = null;

  return {
    wrapped,

    onBeforeTool(toolName, params) {
      const check = wrapped.preCheck(toolName, params);
      lastSnapshot = check.snapshot;

      const schemaErrors = check.preExec.schemaCheck?.errors?.map((e: any) => e.message) ?? [];

      return {
        allowed: check.allowed,
        riskScore: check.preExec.riskScore.score,
        riskAction: check.preExec.riskScore.action,
        schemaErrors: schemaErrors.length > 0 ? schemaErrors : undefined,
      };
    },

    onAfterTool(toolName, params, result, startTime) {
      const check = wrapped.postCheck(toolName, params, result, lastSnapshot, startTime);
      return {
        verifyPassed: check.postExec.verifyPassed,
        verifyDetail: check.runtime.adaptiveScore >= 0.7 ? 'OK' : 'WARN',
        auditId: check.audit.id,
      };
    },

    sessionStart(sessionId) {
      const startTime = Date.now();
      sessionStates.set(sessionId, { startTime });
      return wrapped.injectContext();
    },

    sessionEnd(sessionId) {
      wrapped.endSession(sessionId);
      sessionStates.delete(sessionId);
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
  };
}
