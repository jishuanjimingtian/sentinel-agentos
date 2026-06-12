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
    preExec: number; // Average param + context quality
    runtime: number; // Average adaptive score
    postExec: number; // Average outcome score
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

    // Track per-session scores
    const sessionScores = this.sessionScores.get(sessionId) ?? [];
    sessionScores.push(post.outcomeScore);
    this.sessionScores.set(sessionId, sessionScores);
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
    );

    // Runtime scores
    const runtimeScore = this.average(
      this.runMetrics.map((m) => m.adaptiveScore * 100),
    );

    // Post-exec scores
    const postExecScore = this.average(
      this.postMetrics.map((m) => m.outcomeScore * 100),
    );

    // User satisfaction
    const satisfaction = this.feedbackEngine.getSatisfactionScore(sessionId);
    const satisfactionScore = ((satisfaction + 1) / 2) * 100; // Map -1..1 to 0..100

    // Overall: weighted
    const overallScore = Math.round(
      preExecScore * 0.2 +
      runtimeScore * 0.25 +
      postExecScore * 0.3 +
      satisfactionScore * 0.25,
    );

    // Recent trend
    const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recentPre = this.preMetrics.filter((m) => m.timestamp >= recentCutoff);
    const recentRun = this.runMetrics.slice(-recentPre.length);
    const recentPost = this.postMetrics.slice(-recentPre.length);

    const recentScore = recentPre.length > 0
      ? Math.round(
        this.average(recentPre.map((m) => (m.paramQuality.score + m.contextUtilization.score) / 2)) * 100 * 0.2 +
        this.average(recentRun.map((m) => m.adaptiveScore)) * 100 * 0.25 +
        this.average(recentPost.map((m) => m.outcomeScore)) * 100 * 0.3 +
        satisfactionScore * 0.25,
      )
      : overallScore;

    // Warnings and strengths
    const warnings: string[] = [];
    const strengths: string[] = [];

    if (runtimeScore < 0.5) {
      warnings.push('High retry rate — consider more planning before execution');
    }
    if (postExecScore < 0.5) {
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
      overallScore: overallScore, // 0-100
      totalOps,
      breakdown: {
        preExec: Math.round(preExecScore * 100) / 100,
        runtime: Math.round(runtimeScore * 100) / 100,
        postExec: Math.round(postExecScore * 100) / 100,
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

  private average(values: number[]): number {
    return values.length > 0
      ? values.reduce((s, v) => s + v, 0) / values.length
      : 0;
  }
}
