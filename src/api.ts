import { AgentOS } from './core';
import { AuditEntry } from './types';
import type { AgentProfile } from './evaluator/profiler';
import type { SchemaRule } from './guard/schema-gate';
import type { ExecutionContext } from './guard/sandbox';

/**
 * AgentOS API — SDK protocol layer.
 *
 * JSON-RPC 2.0 compatible interface for external agent frameworks.
 * No HTTP/WS server in v1.0 — this is an in-process SDK API.
 *
 * Methods are named as `namespace.method` per OpenRPC convention:
 * - guard.schema.registerRule
 * - agentos.pipeline.execute
 * - memory.context.inject
 * - audit.query
 * - profile.get
 */
export class AgentOSAPI {
  private aos: AgentOS;

  constructor(aos: AgentOS) {
    this.aos = aos;
  }

  // ========== Guard Methods ==========

  /** Register a schema validation rule */
  guardRegisterRule(rule: SchemaRule): void {
    this.aos.guard.schema.registerRule(rule);
  }

  /** Register multiple schema rules at once */
  guardRegisterRules(rules: SchemaRule[]): void {
    this.aos.guard.schema.registerRules(rules);
  }

  /** Check if a tool has schema rules */
  guardHasRule(toolName: string): boolean {
    return this.aos.guard.schema.hasRule(toolName);
  }

  /** Get all registered schema rules */
  guardGetRules(): SchemaRule[] {
    return this.aos.guard.schema.getRules();
  }

  /** Evaluate risk score for a tool call */
  guardEvaluateRisk(toolName: string, params: Record<string, unknown>): {
    score: number;
    action: string;
    dimensions: Record<string, number>;
  } {
    const result = this.aos.guard.risk.evaluate(toolName, params);
    return {
      score: result.score,
      action: result.action,
      dimensions: { ...result.dimensions },
    };
  }

  /** Update risk thresholds */
  guardSetRiskThresholds(thresholds: {
    autoApprove?: number;
    notify?: number;
    confirm?: number;
    deny?: number;
  }): void {
    this.aos.guard.risk.setThresholds(thresholds);
  }

  // ========== Pipeline Methods ==========

  /** Execute the full pre-exec pipeline (before tool runs) */
  async pipelineExecute(params: {
    sessionId: string;
    agentId: string;
    toolName: string;
    toolParameters: Record<string, unknown>;
    affectedFiles?: string[];
    executionContext?: Partial<ExecutionContext>;
  }): Promise<{
    preExec: ReturnType<AgentOS['evaluator']['preExec']['evaluate']>;
    snapshot: ReturnType<AgentOS['guard']['snapshot']['takeSnapshot']> | null;
    profile: AgentProfile;
    sandboxRejection?: string;
  }> {
    const result = this.aos.executePipeline({
      sessionId: params.sessionId,
      agentId: params.agentId,
      toolName: params.toolName,
      parameters: params.toolParameters,
      affectedFiles: params.affectedFiles,
    });

    return {
      preExec: result.preExec,
      snapshot: result.snapshot,
      profile: result.profile,
    };
  }

  /** Complete the pipeline after tool execution */
  pipelineComplete(params: {
    sessionId: string;
    agentId: string;
    toolName: string;
    toolParameters: Record<string, unknown>;
    toolResult: unknown;
    snapshot: any | null;
    startTime: number;
    endTime: number;
    retryCount?: number;
    wasSelfCorrected?: boolean;
    hadTimeout?: boolean;
    userAccepted?: boolean;
    userProvidedEdit?: boolean;
    resultWasUsed?: boolean;
  }): {
    runtime: ReturnType<AgentOS['evaluator']['runtime']['evaluate']>;
    postExec: ReturnType<AgentOS['evaluator']['postExec']['evaluate']>;
    auditEntry: AuditEntry;
    profile: AgentProfile;
  } {
    return this.aos.completeExecution({
      ...params,
      retryCount: params.retryCount ?? 0,
      wasSelfCorrected: params.wasSelfCorrected ?? false,
      hadTimeout: params.hadTimeout ?? false,
      userAccepted: params.userAccepted ?? true,
      userProvidedEdit: params.userProvidedEdit ?? false,
      resultWasUsed: params.resultWasUsed ?? false,
    });
  }

  // ========== Memory Methods ==========

  /** Inject memory context for session startup */
  memoryInjectContext(): string {
    return this.aos.injectContext();
  }

  /** Add a working memory message */
  memoryAddMessage(role: 'user' | 'agent' | 'tool', content: string): void {
    this.aos.memory.working.addMessage(role, content);
  }

  /** Set current task */
  memorySetTask(task: { description: string; steps: Array<{ step: string; status: string }> }): void {
    this.aos.memory.working.setTask({
      description: task.description,
      steps: task.steps.map((s) => ({
        step: s.step,
        status: s.status as 'pending' | 'in_progress' | 'done',
      })),
    });
  }

  /** Cache a tool result */
  memoryCacheResult(toolName: string, result: unknown): void {
    this.aos.memory.working.cacheToolResult(toolName, result);
  }

  /** Record an episodic event */
  memoryRecordEvent(
    type: any,
    content: string,
    tags?: string[],
    relatedEntities?: string[],
  ): void {
    this.aos.memory.episodic.record(type, content, tags, relatedEntities);
  }

  /** Set a semantic user preference */
  memorySetPreference(key: string, value: unknown): void {
    this.aos.memory.semantic.setPreference(key, value);
  }

  /** Get a semantic user preference */
  memoryGetPreference<T = unknown>(key: string): T | undefined {
    return this.aos.memory.semantic.getPreference<T>(key);
  }

  /** Learn a rule in semantic memory */
  memoryLearnRule(rule: string, source: string): void {
    this.aos.memory.semantic.learnRule(rule, source);
  }

  /** Define a glossary term */
  memoryDefineTerm(term: string, meaning: string): void {
    this.aos.memory.semantic.defineTerm(term, meaning);
  }

  /** Set project context */
  memorySetProjectContext(
    projectName: string,
    context: {
      description?: string;
      techStack?: string[];
      conventions?: string[];
      architecture?: string;
      knownIssues?: string[];
    },
  ): void {
    this.aos.memory.semantic.setProjectContext(projectName, context);
  }

  // ========== Audit Methods ==========

  /** Query audit log */
  auditQuery(filter: {
    sessionId?: string;
    toolName?: string;
    verifyStatus?: 'PASS' | 'WARN' | 'FAIL';
    minScore?: number;
    maxScore?: number;
    limit?: number;
  } = {}): AuditEntry[] {
    return this.aos.guard.audit.query(filter);
  }

  /** Get audit statistics */
  auditStats(): ReturnType<AgentOS['getAuditStats']> {
    return this.aos.getAuditStats();
  }

  // ========== Feedback Methods ==========

  /** Record implicit user feedback */
  recordFeedback(
    signal: Parameters<AgentOS['evaluator']['feedback']['record']>[0],
    sessionId: string,
    operationId?: string,
    confidence?: number,
  ): void {
    this.aos.recordFeedback(signal, sessionId, operationId, confidence);
  }

  /** Get satisfaction score */
  getSatisfaction(sessionId?: string, recentHours?: number): number {
    return this.aos.evaluator.feedback.getSatisfactionScore(sessionId, recentHours);
  }

  /** Get feedback statistics */
  feedbackStats(): ReturnType<AgentOS['evaluator']['feedback']['stats']> {
    return this.aos.evaluator.feedback.stats();
  }

  // ========== Profile Methods ==========

  /** Get agent quality profile */
  getProfile(sessionId?: string): AgentProfile {
    return this.aos.getProfile(sessionId);
  }

  /** Get agent status report (human-readable) */
  getStatusReport(): string {
    return this.aos.statusReport();
  }

  /** Get session overview */
  getSessionOverview(): {
    profile: AgentProfile;
    audit: ReturnType<AgentOS['getAuditStats']>;
    satisfaction: number;
    workingMemory: {
      messages: number;
      openFiles: number;
      budget: { used: number; limit: number };
    };
    episodicEvents: number;
    semanticRules: number;
  } {
    return {
      profile: this.aos.getProfile(),
      audit: this.aos.getAuditStats(),
      satisfaction: this.aos.evaluator.feedback.getSatisfactionScore(),
      workingMemory: {
        messages: this.aos.memory.working.recentMessages.length,
        openFiles: this.aos.memory.working.openFiles.length,
        budget: this.aos.memory.working.budget,
      },
      episodicEvents: this.aos.memory.episodic.count,
      semanticRules: this.aos.memory.semantic.getAllRules().length,
    };
  }

  /** End session and clean up */
  endSession(sessionId: string): void {
    this.aos.endSession(sessionId);
  }
}
