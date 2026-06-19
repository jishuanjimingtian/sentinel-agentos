import {
  AgentOSConfig,
  GuardConfig,
  Snapshot,
  AuditEntry,
  PreExecMetrics,
  RuntimeMetrics,
  PostExecMetrics,
  HealthCheckReport,
} from './types';
import { SchemaGate } from './guard/schema-gate';
import { RiskGate } from './guard/risk-gate';
import { SnapshotGate, VerifyGate } from './guard/snapshot-verify';
import { AuditLog } from './guard/audit-log';
import { WorkingMemory } from './memory/working';
import { EpisodicMemory } from './memory/episodic';
import { SemanticMemoryStore } from './memory/semantic';
import { PreExecEvaluator, RuntimeEvaluator, PostExecEvaluator } from './evaluator/exec-evaluator';
import { ImplicitFeedbackEngine } from './evaluator/feedback';
import { AgentProfiler } from './evaluator/profiler';
import type { AgentProfile } from './evaluator/profiler';
import { BehaviorModel } from './behavior-model';
import { CreditSystem, creditToConfidenceBoost, creditToConfidenceThresholds } from './credit';
import { computeConfidence, scoreD1, scoreD2, scoreD3, scoreD4, scoreD5, ConfidenceResult } from './scoring';

/**
 * AgentOS — the complete AI Agent Operating System.
 *
 * Architecture:
 * ```
 * User Request
 *     ↓
 * ┌─────────────┐
 * │ Memory Layer │ ← Semantic + Episodic + Working memory
 * ├─────────────┤
 * │ Guard Layer  │ ← Schema → Risk → Snapshot
 * ├─────────────┤         ↓
 * │ Execute      │ ← Tool call execution
 * ├─────────────┤         ↓
 * │ Verify Layer │ ← Snapshot diff → Verify checks
 * ├─────────────┤         ↓
 * │ Audit Log    │ ← Immutable operation record
 * ├─────────────┤
 * │ Evaluator    │ ← Three-phase metrics + feedback
 * └─────────────┘
 * ```
 */
export class AgentOS {
  private config: AgentOSConfig;

  // Memory Layer
  readonly memory: {
    working: WorkingMemory;
    episodic: EpisodicMemory;
    semantic: SemanticMemoryStore;
  };

  // Guard Layer
  readonly guard: {
    schema: SchemaGate;
    risk: RiskGate;
    snapshot: SnapshotGate;
    verify: VerifyGate;
    audit: AuditLog;
  };

  // Evaluator Layer
  readonly evaluator: {
    preExec: PreExecEvaluator;
    runtime: RuntimeEvaluator;
    postExec: PostExecEvaluator;
    feedback: ImplicitFeedbackEngine;
    profiler: AgentProfiler;
  };

  // v1.4 智能审批
  readonly scoring: {
    behavior: BehaviorModel;
    credit: CreditSystem;
  };

  constructor(config?: Partial<AgentOSConfig>) {
    this.config = {
      workspaceRoot: process.cwd(),
      maxWorkingTokens: 50000,
      maxEpisodicSizeKb: 500,
      guardConfig: {},
      ...config,
    };

    // --- Memory Layer Init ---
    const semantic = new SemanticMemoryStore();
    semantic.enablePersistence(this.config.workspaceRoot!);

    const episodic = new EpisodicMemory(this.config.maxEpisodicSizeKb);
    episodic.enablePersistence(this.config.workspaceRoot!);

    const working = new WorkingMemory(this.config.maxWorkingTokens);

    this.memory = { working, episodic, semantic };

    // --- Guard Layer Init ---
    const schema = new SchemaGate();

    const risk = new RiskGate();

    const snapshot = new SnapshotGate(this.config.workspaceRoot!);

    const verify = new VerifyGate(this.config.workspaceRoot!);

    const audit = new AuditLog(
      this.config.workspaceRoot!,
      schema,
      risk,
    );

    this.guard = { schema, risk, snapshot, verify, audit };

    // --- Evaluator Layer Init ---
    const preExecEval = new PreExecEvaluator(schema, risk, working);
    const runtimeEval = new RuntimeEvaluator();
    const postExecEval = new PostExecEvaluator();
    const feedbackEngine = new ImplicitFeedbackEngine();
    feedbackEngine.enablePersistence(this.config.workspaceRoot!);
    const profiler = new AgentProfiler(feedbackEngine);

    this.evaluator = {
      preExec: preExecEval,
      runtime: runtimeEval,
      postExec: postExecEval,
      feedback: feedbackEngine,
      profiler,
    };

    // --- v1.4 智能审批 Init ---
    const behavior = new BehaviorModel();
    behavior.enablePersistence(this.config.workspaceRoot!);

    const credit = new CreditSystem();
    credit.enablePersistence(this.config.workspaceRoot!);

    this.scoring = { behavior, credit };
  }

  /**
   * Get the current AgentOS configuration.
   */
  getConfig(): Readonly<AgentOSConfig> {
    return this.config;
  }

  /**
   * Full pipeline: process a tool call through all layers.
   *
   * This is the main AgentOS orchestration method.
   * In production this would be called by the agent runtime
   * before/after every tool call.
   */
  executePipeline(options: {
    sessionId: string;
    agentId: string;
    toolName: string;
    parameters: Record<string, unknown>;
    affectedFiles?: string[];
    guardConfig?: GuardConfig;
  }): {
    preExec: PreExecMetrics;
    runtime?: RuntimeMetrics;
    postExec?: PostExecMetrics;
    snapshot: Snapshot | null;
    auditEntry?: AuditEntry;
    profile: AgentProfile;
  } {
    const { sessionId, toolName, parameters, affectedFiles } = options;

    // --- Phase 1: Pre-exec evaluation ---
    const preExec = this.evaluator.preExec.evaluate(toolName, parameters);
    this.memory.working.addMessage('tool', JSON.stringify(parameters));

    // --- Phase 2: Snapshot before execution ---
    const snapshot = this.guard.snapshot.takeSnapshot(
      `call_${Date.now()}`,
      toolName,
      affectedFiles ?? [],
      'file',
    );

    // --- Phase 3: Execute (delegated to runtime — here we return pre-exec state) ---

    // Return the pre-exec state so the runtime can complete
    return {
      preExec,
      snapshot,
      profile: this.evaluator.profiler.getProfile(sessionId),
    };
  }

  /**
   * Complete the pipeline after tool execution.
   *
   * Called by the runtime after the tool call completes
   * (or fails, or times out).
   */
  completeExecution(options: {
    sessionId: string;
    agentId: string;
    toolName: string;
    toolParameters: Record<string, unknown>;
    toolResult: unknown;
    snapshot: Snapshot | null;
    startTime: number;
    endTime: number;
    retryCount: number;
    wasSelfCorrected: boolean;
    hadTimeout: boolean;
    userAccepted: boolean;
    userProvidedEdit: boolean;
    resultWasUsed: boolean;
  }): {
    runtime: RuntimeMetrics;
    postExec: PostExecMetrics;
    auditEntry: AuditEntry;
    profile: AgentProfile;
  } {
    const {
      sessionId, agentId, toolName, toolParameters, toolResult,
      snapshot, startTime, endTime,
      retryCount, wasSelfCorrected, hadTimeout,
      userAccepted, userProvidedEdit, resultWasUsed,
    } = options;

    // --- Phase 1: Runtime evaluation ---
    const runtime = this.evaluator.runtime.evaluate({
      toolName,
      startTime,
      endTime,
      retryCount,
      wasSelfCorrected,
      hadTimeout,
      toolResult,
    });

    // --- Phase 2: Post-exec verification ---
    const verifyResult = snapshot
      ? this.guard.verify.verify(
          toolName,
          snapshot,
          { files: toolParameters['path'] ? [String(toolParameters['path'])] : undefined },
        )
      : { status: 'PASS' as const, checks: [] as import('./types').VerifyCheck[] };

    // --- Phase 3: Post-exec evaluation ---
    const postExec = this.evaluator.postExec.evaluate({
      verifyPassed: verifyResult.status === 'PASS',
      verifyChecks: verifyResult.checks.length,
      verifyFailures: verifyResult.checks.filter((c) => c.status === 'FAIL').length,
      userAccepted,
      userProvidedEdit,
      resultWasUsed,
    });

    // --- Phase 4: Audit log ---
    const auditEntry = this.guard.audit.record({
      sessionId,
      agentId,
      startedAt: startTime,
      completedAt: endTime,
      toolName,
      toolParameters,
      toolResult,
      snapshot,
      verifyStatus: verifyResult.status,
      verifyChecks: verifyResult.checks,
    });

    // --- Phase 5: Track result for utilization scoring ---
    this.evaluator.postExec.trackResult(auditEntry.id, toolResult);

    // --- Phase 5.5: Auto-detect result utilization (after track, avoids race) ---
    this.detectResultUtilization(toolParameters, sessionId);

    // --- Phase 5.6: Credit system — record outcome for trust-based auto-approval (v1.4.1) ---
    const wasBlocked = verifyResult.status !== 'PASS' || postExec.outcomeScore < 0.3;
    this.scoring.credit.recordOutcome(agentId, true, wasBlocked);

    // --- Phase 6: Record in profiler (reuse pre-exec from pipeline start) ---
    const preExecMetric = this.evaluator.preExec.evaluate(toolName, toolParameters);
    this.evaluator.profiler.recordCycle(
      sessionId,
      preExecMetric,
      runtime,
      postExec,
    );

    return {
      runtime,
      postExec,
      auditEntry,
      profile: this.evaluator.profiler.getProfile(sessionId),
    };
  }

  /**
   * Record implicit user feedback.
   */
  recordFeedback(
    signal: Parameters<ImplicitFeedbackEngine['record']>[0],
    sessionId: string,
    operationId?: string,
    confidence?: number,
    source?: string,
  ): void {
    this.evaluator.feedback.record(signal, sessionId, operationId, confidence, source);
  }

  /**
   * Get a JSON report for dashboard consumption.
   */
  getReport(): Record<string, unknown> {
    const profile = this.getProfile();
    const audit = this.getAuditStats();
    return {
      quality: { overallScore: Math.round(profile.overallScore), ...profile.breakdown },
      audit: { ...audit },
      satisfaction: profile.breakdown.userSatisfaction || 0,
      workingMemory: { messages: this.memory.working.getState().recentMessages.length },
      episodicEvents: this.memory.episodic.count || 0,
      warnings: profile.warnings,
      strengths: profile.strengths,
    };
  }

  /**
   * Compute confidence score for a tool call (v1.4 智能审批).
   *
   * D1-D5 五维度评分，结合信用体系调整阈值，返回置信度与决策建议。
   */
  computeConfidence(
    toolName: string,
    params: Record<string, unknown>,
    riskScore: { score: number },
    lastAIMessage?: string,
    agentId?: string,
  ): ConfidenceResult {
    const d1 = scoreD1(riskScore as any);
    const history = this.scoring.behavior.getStats(toolName, params);
    const d2 = scoreD2(toolName, params, history);
    const d3 = scoreD3(toolName, lastAIMessage || '');
    const d4 = scoreD4(String(params?.path || params?.file || ''));
    const now = new Date();
    const freq = this.scoring.behavior.getRecentFrequency(toolName);
    const d5 = scoreD5(now, freq);

    // v1.4.1: 信用体系联动 — 根据 agent 信用等级动态调整决策阈值
    const creditLevel = agentId ? this.scoring.credit.getLevel(agentId) : 1;
    const boost = creditToConfidenceBoost(creditLevel);
    const thresholds = creditToConfidenceThresholds(creditLevel);

    const result = computeConfidence({ d1, d2, d3, d4, d5 });

    // 用信用等级覆盖默认阈值
    const adjustedConfidence = this.clamp0to100(result.confidence + boost);
    let decision: 'auto-approve' | 'confirm' | 'block';
    if (adjustedConfidence >= thresholds.autoApproveMin) {
      decision = 'auto-approve';
    } else if (adjustedConfidence >= thresholds.confirmMin) {
      decision = 'confirm';
    } else {
      decision = 'block';
    }

    return {
      ...result,
      confidence: adjustedConfidence,
      decision,
      dimensions: {
        ...result.dimensions,
        creditBoost: boost,
        creditLevel,
      } as any,
    };
  }

  /**
   * Record a tool call outcome in behavior model (v1.4).
   */
  recordBehavior(
    toolName: string,
    params: Record<string, unknown>,
    success: boolean,
    confirmed: boolean,
  ): void {
    this.scoring.behavior.record({ toolName, params, success, confirmed });
  }

  /**
   * Inject memory context at session startup.
   *
   * Call this at the beginning of every session to load
   * semantic + episodic context into the session prompt.
   */
  injectContext(): string {
    const semanticSummary = this.memory.semantic.generateContextSummary(2000);
    const episodicSummary = this.memory.episodic.generateContextSummary(1500);

    const parts: string[] = [];

    if (semanticSummary) parts.push(semanticSummary);
    if (episodicSummary) parts.push(episodicSummary);

    return parts.join('\n\n---\n\n');
  }

  /**
   * End current session — auto-detect feedback, promote events to episodic,
   * append daily log, clear working memory.
   */
  endSession(sessionId: string, workspaceRoot?: string): void {
    // Phase 1: Auto-detect feedback from audit log
    const recentAudit = this.guard.audit.query({ sessionId, limit: 100 });
    let detected = this.evaluator.feedback.autoDetect(recentAudit, sessionId);

    // Phase 1.5: Detect correction signals from user messages in WorkingMemory
    const messages = this.memory.working.recentMessages.map((m) => ({
      role: m.role,
      content: m.content,
      ts: m.timestamp as number | undefined,
    }));
    const msgDetected = this.evaluator.feedback.detectFromUserMessages(messages, sessionId);
    detected += msgDetected;

    // Phase 2: Promote important working memory items to episodic
    // 2a: Current task
    if (this.memory.working.currentTask) {
      this.memory.episodic.record(
        'milestone',
        `Task completed: ${this.memory.working.currentTask.description}`,
        ['task', 'session-end'],
        [sessionId],
      );
    }

    // 2b: Working memory context snapshot for next session recovery
    this.persistWorkingContext(sessionId);

    // Phase 3: Log learned rules from this session
    const rules = this.memory.semantic.getRules(0.6);
    for (const rule of rules.slice(0, 3)) {
      this.memory.episodic.record(
        'note',
        `Rule: ${rule.rule} (confidence: ${Math.round(rule.confidence * 100)}%)`,
        ['rule', 'semantic'],
        [],
      );
    }

    // Phase 4: Record session end event with stats
    const profile = this.evaluator.profiler.getProfile(sessionId);
    const auditStats = this.guard.audit.stats();
    this.memory.episodic.record(
      'note',
      `Session ended — Score: ${profile.overallScore}/100 | Ops: ${auditStats.totalOperations} | Feedback signals detected: ${detected}`,
      ['session-end', 'summary'],
      [sessionId],
    );

    // Phase 5: Append daily log if workspaceRoot provided
    if (workspaceRoot) {
      this.appendDailyLog(sessionId, workspaceRoot);
    }

    // Phase 5b: Write searchable memory snapshot for memory_search
    if (workspaceRoot) {
      this.writeMemorySnapshot(workspaceRoot);
    }

    // Phase 5: Decay unused semantic rules
    this.memory.semantic.decayUnusedRules();

    // Phase 5.3: Clean up profiler session scores
    this.evaluator.profiler.clearSession(sessionId);

    // Phase 5.5: Force Episodic compression
    this.memory.episodic.record('note', 'Session end', ['session-end'], []);

    // Phase 6: Clear working memory for next session
    this.memory.working.clear();
  }

  /**
   * Persist WorkingMemory context snapshot to Episodic + disk
   * so the next session can recover key context.
   */
  private persistWorkingContext(sessionId: string): void {
    const wm = this.memory.working;

    // Capture open files
    if (wm.openFiles.length > 0) {
      this.memory.episodic.record(
        'note',
        `Open files: ${wm.openFiles.join(', ')}`,
        ['context', 'open-files'],
        [sessionId],
      );
    }

    // Capture recent tool results summary (last 5, truncated)
    const toolKeys = Array.from(wm.recentToolResults.keys()).slice(-5);
    if (toolKeys.length > 0) {
      const summary = toolKeys.map((k) => {
        const r = wm.recentToolResults.get(k)?.result;
        const preview = typeof r === 'string' ? r.substring(0, 80) : JSON.stringify(r ?? '').substring(0, 80);
        return `${k}: ${preview}`;
      }).join(' | ');
      this.memory.episodic.record(
        'note',
        `Recent tool results: ${summary}`,
        ['context', 'tool-results'],
        [sessionId],
      );
    }

    // Capture last user message for continuity
    const lastUserMsg = [...wm.recentMessages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      this.memory.episodic.record(
        'note',
        `Last user message: ${lastUserMsg.content.substring(0, 200)}`,
        ['context', 'last-message'],
        [sessionId],
      );
    }

    // Save working context checkpoint to disk
    if (this.config.workspaceRoot) {
      try {
        const fs = require('fs');
        const path = require('path');
        const agentosDir = path.join(this.config.workspaceRoot, '.agentos');
        if (!fs.existsSync(agentosDir)) fs.mkdirSync(agentosDir, { recursive: true });
        const checkpoint = {
          sessionId,
          timestamp: Date.now(),
          openFiles: wm.openFiles,
          currentTask: wm.currentTask,
          lastUserMessage: lastUserMsg?.content?.substring(0, 200) ?? null,
        };
        fs.writeFileSync(
          path.join(agentosDir, 'working-context.json'),
          JSON.stringify(checkpoint) + '\n',
          'utf-8',
        );
      } catch {
        // Non-critical
      }
    }
  }

  /**
   * Write a searchable memory snapshot to workspace/memory/agentos-memory.md
   * so OpenClaw's memory_search can index it across sessions.
   */
  /**
   * Clamp to 0-100 range.
   */
  private clamp0to100 = (v: number) => Math.max(0, Math.min(100, v));

  private writeMemorySnapshot(workspaceRoot: string): void {
    try {
      const fs = require('fs');
      const path = require('path');

      const memDir = path.join(workspaceRoot, 'memory');
      if (!fs.existsSync(memDir)) {
        fs.mkdirSync(memDir, { recursive: true });
      }

      const snapshotPath = path.join(memDir, 'agentos-memory.md');

      const semanticSummary = this.memory.semantic.generateContextSummary(2000);
      const episodicSnapshot = this.memory.episodic.getSearchableSnapshot(50);

      const content = [
        '# AgentOS Memory Snapshot',
        '',
        `> Auto-generated at ${new Date().toISOString()}`,
        '',
        semanticSummary,
        '',
        '---',
        '',
        episodicSnapshot,
        '',
      ].join('\n');

      fs.writeFileSync(snapshotPath, content, 'utf-8');
    } catch {
      // Non-critical — memory search fallback degrades gracefully
    }
  }

  /**
   * Append evaluation summary to daily log file.
   */
  private appendDailyLog(sessionId: string, workspaceRoot: string): void {
    try {
      const { appendFileSync, existsSync, mkdirSync } = require('fs');
      const path = require('path');
      const dateKey = new Date().toISOString().split('T')[0];
      const memDir = path.join(workspaceRoot, 'memory');
      if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true });

      const dailyFile = path.join(memDir, `${dateKey}.md`);
      const profile = this.evaluator.profiler.getProfile(sessionId);
      const auditStats = this.guard.audit.stats();
      const satisfaction = this.evaluator.feedback.getSatisfactionScore(sessionId);

      const report = [
        '',
        '## 📊 AgentOS Evaluator 今日评估',
        '',
        `**综合评分**: ${profile.overallScore}/100 | Pre:${profile.breakdown.preExec ?? 'N/A'}/100 | Run:${profile.breakdown.runtime ?? 'N/A'}/100 | Post:${profile.breakdown.postExec ?? 'N/A'}/100`,
        `**趋势**: ${profile.trends.improving ? '📈 上升' : '📉 下降'} | **操作数**: ${auditStats.totalOperations} | **满意度**: ${satisfaction}`,
        profile.warnings.length > 0 ? `**⚠️**: ${profile.warnings.join('; ')}` : '',
        profile.strengths.length > 0 ? `**✅**: ${profile.strengths.join('; ')}` : '',
        '',
      ].filter(Boolean).join('\n');

      const existing = existsSync(dailyFile) ? require('fs').readFileSync(dailyFile, 'utf-8') : '';
      if (!existing.includes('AgentOS Evaluator')) {
        appendFileSync(dailyFile, report, 'utf-8');
      }
    } catch (e) {
      console.warn('[AgentOS] Failed to append daily log:', e);
    }
  }

  /**
   * Detect if this tool call's parameters reference a previous result.
   */
  private detectResultUtilization(params: Record<string, unknown>, sessionId: string): void {
    try {
      const allValues = Object.values(params).join(' ');
      const tracker = this.evaluator.postExec['resultReferenceTracker'];
      if (!tracker) return;

      for (const [opId, entry] of tracker) {
        if (entry.referenced) continue;
        const resultStr = JSON.stringify(entry.result);
        // Check if parameters contain a reference to previous result
        if (resultStr.length > 10 && allValues.includes(resultStr.substring(0, 20))) {
          this.evaluator.postExec.markResultReferenced(opId);
          this.evaluator.feedback.record('user_used_result', sessionId, opId, 0.5, 'auto-param-match');
        }
      }
    } catch {
      // Non-critical, silently ignore detection failures
    }
  }

  /**
   * Get audit statistics.
   */
  getAuditStats(): ReturnType<AuditLog['stats']> {
    return this.guard.audit.stats();
  }

  /**
   * Get the current agent quality profile.
   */
  getProfile(sessionId?: string): AgentProfile {
    // 从审计日志获取真实操作总数，修复 profiler 计数器 session 重启归零的问题
    const auditTotal = this.guard.audit.stats().totalOperations;
    return this.evaluator.profiler.getProfile(sessionId, auditTotal);
  }

  /**
   * Get a summarized status report.
   */
  statusReport(): string {
    const profile = this.getProfile();
    const audit = this.getAuditStats();

    const lines = [
      '=== AgentOS Status Report ===',
      '',
      `Quality Score: ${Math.round(profile.overallScore)}/100 ${profile.trends.improving ? '📈' : '📉'}`,
      `Total Operations: ${profile.totalOps} (${profile.trends.recentOps} in last 24h)`,
      '',
      '--- Breakdown ---',
      `Pre-Exec:   ${profile.breakdown.preExec}/100`,
      `Runtime:    ${profile.breakdown.runtime}/100`,
      `Post-Exec:  ${profile.breakdown.postExec}/100`,
      `Satisfaction: ${profile.breakdown.userSatisfaction}/100`,
      '',
      '--- Audit ---',
      `Total: ${audit.totalOperations} | Failures: ${audit.verifyFailures} | High-Risk: ${audit.highRiskOps}`,
    ];

    if (profile.warnings.length > 0) {
      lines.push('', '--- ⚠️ Warnings ---');
      for (const w of profile.warnings) lines.push(`- ${w}`);
    }

    if (profile.strengths.length > 0) {
      lines.push('', '--- ✅ Strengths ---');
      for (const s of profile.strengths) lines.push(`- ${s}`);
    }

    return lines.join('\n');
  }

  /**
   * Health Check — 系统全维度健康体检 (v1.4.1)
   *
   * 返回结构化的体检报告，覆盖以下维度：
   *   - 质量评分 (Quality): profiler + satisfaction
   *   - 审计 (Audit): 操作总量 / 失败 / 高风险
   *   - 信用 (Credit): 各 agent 等级分布
   *   - 记忆 (Memory): working / episodic / semantic 状态
   *   - 规则 (Rules): schema guard 规则数
   *   - 活跃度 (Activity): 24h 操作频率
   *
   * @param full 是否输出完整文本报告 (default: false → 返回对象)
   */
  healthCheck(full?: false): HealthCheckReport;
  healthCheck(full: true): string;
  healthCheck(full = false): HealthCheckReport | string {
    const profile = this.getProfile();
    const audit = this.getAuditStats();

    // 信用维度
    const creditLevels: Record<string, number> = { L0: 0, L1: 0, L2: 0, L3: 0 };
    const creditAgents = this.scoring.credit.getAllAgents();
    for (const agent of Object.values(creditAgents)) {
      const level = agent?.level;
      if (level != null) creditLevels[`L${level}`] = (creditLevels[`L${level}`] ?? 0) + 1;
    }
    const totalCreditAgents = Object.keys(creditAgents).length;
    const avgCreditLevel = totalCreditAgents > 0
      ? ((creditLevels.L3 ?? 0) * 3 + (creditLevels.L2 ?? 0) * 2 + (creditLevels.L1 ?? 0) * 1) / totalCreditAgents
      : 0;

    // 记忆维度
    const workingMsgs = this.memory.working.getState().recentMessages.length;
    const episodicCount = this.memory.episodic.count ?? 0;
    const semanticRules = this.memory.semantic.getRules(0.3).length;

    // guard rules
    const guardRules = (this.guard as any).schema?.rules?.length ?? 0;

    // 活跃度
    const recent24h = this.evaluator.profiler.getProfile(undefined, audit.totalOperations).trends.recentOps;

    // 综合健康等级
    let healthScore = 0;
    healthScore += Math.min(profile.overallScore / 100, 1) * 30;   // quality (0-30)
    healthScore += audit.verifyFailures === 0 ? 25 : Math.max(0, 25 - audit.verifyFailures * 5); // audit (0-25)
    healthScore += Math.min(avgCreditLevel / 3, 1) * 20;           // credit (0-20)
    healthScore += episodicCount > 0 ? 15 : 0;                     // memory (0-15)
    healthScore += guardRules > 0 ? 10 : 0;                        // rules (0-10)
    healthScore = Math.round(healthScore);

    const healthTier = healthScore >= 80 ? 'healthy' : healthScore >= 50 ? 'warning' : 'critical';

    const report: HealthCheckReport = {
      timestamp: new Date().toISOString(),
      healthScore,
      healthTier,
      quality: {
        overallScore: profile.overallScore,
        breakdown: profile.breakdown,
        trends: profile.trends,
        warnings: profile.warnings,
        strengths: profile.strengths,
      },
      audit: {
        totalOperations: audit.totalOperations,
        verifyFailures: audit.verifyFailures,
        highRiskOps: audit.highRiskOps,
      },
      credit: {
        agents: totalCreditAgents,
        averageLevel: Math.round(avgCreditLevel * 100) / 100,
        distribution: creditLevels,
      },
      memory: {
        workingMessages: workingMsgs,
        episodicEvents: episodicCount,
        semanticRules,
      },
      rules: { guardRules, active: guardRules > 0 },
      activity: { recent24h },
    };

    if (full) {
      const lines = [
        '=== 🏥 AgentOS Health Check ===',
        '',
        `Health Score: ${healthScore}/100 (${healthTier.toUpperCase()})`,
        `Timestamp: ${report.timestamp}`,
        '',
        '--- 📊 Quality ---',
        `Overall: ${profile.overallScore}/100 ${profile.trends.improving ? '📈' : '📉'}`,
        `Pre-Exec: ${profile.breakdown.preExec ?? 'N/A'} | Runtime: ${profile.breakdown.runtime ?? 'N/A'} | Post-Exec: ${profile.breakdown.postExec ?? 'N/A'}`,
        `Satisfaction: ${profile.breakdown.userSatisfaction}/100`,
        ...(profile.warnings.length > 0 ? [`⚠️  ${profile.warnings.join('; ')}`] : []),
        ...(profile.strengths.length > 0 ? [`✅ ${profile.strengths.join('; ')}`] : []),
        '',
        '--- 📋 Audit ---',
        `Total Ops: ${audit.totalOperations} | Failures: ${audit.verifyFailures} | High-Risk: ${audit.highRiskOps}`,
        '',
        '--- 🛡️ Credit System ---',
        `Agents: ${totalCreditAgents} | Avg Level: ${report.credit.averageLevel}`,
        `L3: ${creditLevels.L3} | L2: ${creditLevels.L2} | L1: ${creditLevels.L1} | L0: ${creditLevels.L0}`,
        '',
        '--- 🧠 Memory ---',
        `Working: ${workingMsgs} msgs | Episodic: ${episodicCount} events | Semantic: ${semanticRules} rules`,
        '',
        '--- 📏 Guard Rules ---',
        `Active: ${guardRules} rules`,
        '',
        '--- ⚡ Activity ---',
        `24h Ops: ${recent24h}`,
      ];
      return lines.join('\n');
    }

    return report;
  }
}
