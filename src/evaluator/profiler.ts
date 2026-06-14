import {
  PreExecMetrics,
  RuntimeMetrics,
  PostExecMetrics,
} from '../types';
import { ImplicitFeedbackEngine } from './feedback';

/**
 * Agent quality profile — accumulated across all evaluations.
 */
export interface AgentProfile {
  /** Overall quality score (0-100) */
  overallScore: number;
  /** Number of operations evaluated */
  totalOps: number;
  /** Score breakdown by metric category */
  breakdown: {
    preExec: number | null; // Average param + context quality (null = no data)
    runtime: number | null; // Average adaptive score (null = no data)
    postExec: number | null; // Average outcome score (null = no data)
    userSatisfaction: number; // From implicit feedback (-1..1 mapped to 0..100)
  };
  /** Trend data */
  trends: {
    improving: boolean;
    recentOps: number; // Ops in last 24h
    recentScore: number; // Score in last 24h
  };
  /** Areas needing attention */
  warnings: string[];
  /** Kudos for good patterns */
  strengths: string[];
}

/**
 * AgentProfiler — builds and maintains the agent's quality profile.
 *
 * Aggregates PreExec + Runtime + PostExec metrics and
 * ImplicitFeedback to produce a composite quality score
 * that improves over time through self-correction.
 */
export class AgentProfiler {
  private feedbackEngine: ImplicitFeedbackEngine;

  private preMetrics: PreExecMetrics[] = [];
  private runMetrics: RuntimeMetrics[] = [];
  private postMetrics: PostExecMetrics[] = [];
  private sessionScores: Map<string, number[]> = new Map();
  // Circular buffer cap — prevent unbounded memory growth
  private static readonly MAX_HISTORY = 200;

  constructor(feedbackEngine: ImplicitFeedbackEngine) {
    this.feedbackEngine = feedbackEngine;
  }

  /**
   * Record a complete evaluation cycle for one tool call.
   */
  recordCycle(sessionId: string, pre: PreExecMetrics, run: RuntimeMetrics, post: PostExecMetrics): void {
    // Ensure timestamp is set for trend filtering
    if (!pre.timestamp) pre.timestamp = Date.now();
    if (!post.timestamp) (post as any).timestamp = Date.now();
    this.preMetrics.push(pre);
    this.runMetrics.push(run);
    this.postMetrics.push(post);

    // Trim oldest entries to prevent unbounded memory growth
    while (this.preMetrics.length > AgentProfiler.MAX_HISTORY) this.preMetrics.shift();
    while (this.runMetrics.length > AgentProfiler.MAX_HISTORY) this.runMetrics.shift();
    while (this.postMetrics.length > AgentProfiler.MAX_HISTORY) this.postMetrics.shift();

    // Track per-session scores
    const sessionScores = this.sessionScores.get(sessionId) ?? [];
    sessionScores.push(post.outcomeScore);
    this.sessionScores.set(sessionId, sessionScores);
  }

  /** Clean up session scores to prevent memory leak */
  clearSession(sessionId: string): void {
    this.sessionScores.delete(sessionId);
  }

  /**
   * Build the current agent profile.
   */
  getProfile(sessionId?: string): AgentProfile {
    const totalOps = this.preMetrics.length;

    // Pre-exec scores
    const preExecScore = this.average(
      this.preMetrics.map((m) =>
        ((m.paramQuality.score + m.contextUtilization.score) / 2) * 100,
      ),
    ) ?? 0;

    // Runtime scores
    const runtimeScore = this.average(
      this.runMetrics.map((m) => m.adaptiveScore * 100),
    ) ?? 0;

    // Post-exec scores
    const postExecScore = this.average(
      this.postMetrics.map((m) => m.outcomeScore * 100),
    ) ?? 0;

    // User satisfaction
    const satisfaction = this.feedbackEngine.getSatisfactionScore(sessionId);
    const satisfactionScore = ((satisfaction + 1) / 2) * 100; // Map -1..1 to 0..100

    // Overall: weighted — only include dimensions with data
    let overallScore = 0;
    let totalWeight = 0;
    if (this.preMetrics.length > 0) { overallScore += preExecScore * 0.2; totalWeight += 0.2; }
    if (this.runMetrics.length > 0) { overallScore += runtimeScore * 0.25; totalWeight += 0.25; }
    if (this.postMetrics.length > 0) { overallScore += postExecScore * 0.3; totalWeight += 0.3; }
    overallScore += satisfactionScore * 0.25; totalWeight += 0.25; // always include satisfaction
    overallScore = totalWeight > 0 ? Math.round(overallScore / totalWeight) : 50;

    // Recent trend
    const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recentPre = this.preMetrics.filter((m) => m.timestamp >= recentCutoff);
    const recentRun = this.runMetrics.slice(-recentPre.length);
    const recentPost = this.postMetrics.slice(-recentPre.length);

    const recentScore = recentPre.length > 0
      ? Math.round(
        (this.average(recentPre.map((m) => (m.paramQuality.score + m.contextUtilization.score) / 2)) ?? 0) * 100 * 0.2 +
        (this.average(recentRun.map((m) => m.adaptiveScore)) ?? 0) * 100 * 0.25 +
        (this.average(recentPost.map((m) => m.outcomeScore)) ?? 0) * 100 * 0.3 +
        satisfactionScore * 0.25,
      )
      : overallScore;

    // Warnings and strengths
    const warnings: string[] = [];
    const strengths: string[] = [];

    if (this.runMetrics.length > 0 && runtimeScore < 0.5) {
      warnings.push('High retry rate — consider more planning before execution');
    }
    if (this.postMetrics.length > 0 && postExecScore < 0.5) {
      warnings.push('Low verify pass rate — verify results before claiming success');
    }
    if (satisfaction < -0.3) {
      warnings.push('User satisfaction declining — review recent sessions');
    }

    if (runtimeScore > 0.9) {
      strengths.push('Excellent execution reliability');
    }
    if (postExecScore > 0.9) {
      strengths.push('Verify gate passing consistently');
    }
    if (satisfaction > 0.5) {
      strengths.push('Strong positive user feedback');
    }

    return {
      overallScore: Number.isNaN(overallScore) ? 50 : overallScore, // 0-100, default 50 if no data
      totalOps,
      breakdown: {
        preExec: totalOps > 0 ? Math.round(preExecScore * 100) / 100 : null,
        runtime: totalOps > 0 ? Math.round(runtimeScore * 100) / 100 : null,
        postExec: totalOps > 0 ? Math.round(postExecScore * 100) / 100 : null,
        userSatisfaction: Math.round(satisfactionScore * 100) / 100,
      },
      trends: {
        improving: recentScore > overallScore,
        recentOps: recentPre.length,
        recentScore: Math.round(recentScore) / 100,
      },
      warnings,
      strengths,
    };
  }

  private average(values: number[]): number | null {
    if (values.length === 0) return null;
    const sum = values.reduce((s, v) => s + v, 0);
    return Number.isNaN(sum) ? null : sum / values.length;
  }
}
