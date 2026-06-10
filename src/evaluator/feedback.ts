import { ImplicitFeedback, SignalType } from '../types';
import * as crypto from 'crypto';

/**
 * Generate a unique feedback ID.
 */
function generateFeedbackId(): string {
  return `fb_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * ImplicitFeedbackEngine — captures and interprets implicit user signals.
 *
 * Instead of relying on explicit "thumbs up/down", this engine
 * detects subtle signals from user behavior to infer satisfaction.
 *
 * This is the key differentiator of AgentOS: it learns from
 * what users DO, not just what they SAY.
 *
 * Signal rules (based on DESIGN.md §6.3):
 * - user_deleted_code: User deleted what agent wrote → strong negative (-0.8)
 * - user_modified_output: User modified agent's output → moderate negative (-0.5)
 * - user_repeated_instruction: User repeated same command → mild negative (-0.3)
 * - user_immediate_continue: User immediately continued without edit → positive (+0.3)
 * - user_used_result: User referenced agent's output later → strong positive (+0.7)
 * - user_silence_followed_by_praise: Gap then "谢谢" → mild positive (+0.2)
 * - user_interrupted: User stopped agent mid-execution → negative (-0.6)
 * - agent_self_corrected: Agent caught its own mistake → mild positive for agent (+0.3)
 */
export class ImplicitFeedbackEngine {
  private feedbackLog: ImplicitFeedback[] = [];

  /**
   * Record an implicit feedback signal.
   *
   * @param signal - Type of implicit signal detected
   * @param sessionId - Session where signal was detected
   * @param operationId - Related tool call or request ID
   * @param confidence - How confident we are about this interpretation (0-1)
   * @param source - Where the signal was detected (audit_log, message_pattern, diff)
   */
  record(
    signal: SignalType,
    sessionId: string,
    operationId?: string,
    confidence = 0.8,
    source = 'auto-detected',
  ): ImplicitFeedback {
    const strength = this.getSignalStrength(signal);

    const feedback: ImplicitFeedback = {
      id: generateFeedbackId(),
      timestamp: Date.now(),
      signal,
      strength,
      confidence,
      sessionId,
      operationId,
      source,
    };

    this.feedbackLog.push(feedback);
    return feedback;
  }

  /**
   * Get the default strength for a signal type.
   */
  private getSignalStrength(signal: SignalType): number {
    switch (signal) {
      case 'user_deleted_code': return -0.8;
      case 'user_interrupted': return -0.6;
      case 'user_provided_correction': return -0.7;
      case 'user_modified_output': return -0.5;
      case 'user_repeated_instruction': return -0.3;
      case 'user_ignored_result': return -0.4;
      case 'user_silence_then_praise': return 0.2;
      case 'user_immediate_continue': return 0.3;
      case 'agent_self_corrected': return 0.3;
      case 'user_explicit_approval': return 0.6;
      case 'user_used_result': return 0.7;
      case 'user_shared_output': return 0.8; // User shared agent output → strong positive
      default: return 0;
    }
  }

  /**
   * Compute the aggregate satisfaction score from all feedback.
   *
   * Weighted by confidence and recency (newer signals matter more).
   * Returns a score from -1.0 (very unhappy) to +1.0 (very happy).
   */
  getSatisfactionScore(sessionId?: string, recentHours = 24): number {
    let relevant = this.feedbackLog;

    if (sessionId) {
      relevant = relevant.filter((f) => f.sessionId === sessionId);
    }

    // Only consider recent signals
    const cutoff = Date.now() - recentHours * 60 * 60 * 1000;
    relevant = relevant.filter((f) => f.timestamp >= cutoff);

    if (relevant.length === 0) return 0;

    let weightedSum = 0;
    let totalWeight = 0;

    for (const fb of relevant) {
      // Recency weight: newer = more important
      const ageHours = (Date.now() - fb.timestamp) / (60 * 60 * 1000);
      const recencyWeight = Math.max(0.1, 1 - ageHours / recentHours);

      const weight = fb.confidence * recencyWeight;
      weightedSum += fb.strength * weight;
      totalWeight += weight;
    }

    return totalWeight > 0
      ? Math.round((weightedSum / totalWeight) * 100) / 100
      : 0;
  }

  /**
   * Get feedback events, optionally filtered.
   */
  query(filter: {
    signal?: SignalType;
    sessionId?: string;
    minStrength?: number;
    maxStrength?: number;
    since?: number;
    limit?: number;
  } = {}): ImplicitFeedback[] {
    let results = this.feedbackLog;

    if (filter.signal) {
      results = results.filter((f) => f.signal === filter.signal);
    }
    if (filter.sessionId) {
      results = results.filter((f) => f.sessionId === filter.sessionId);
    }
    if (filter.minStrength !== undefined) {
      results = results.filter((f) => f.strength >= filter.minStrength!);
    }
    if (filter.maxStrength !== undefined) {
      results = results.filter((f) => f.strength <= filter.maxStrength!);
    }
    if (filter.since !== undefined) {
      results = results.filter((f) => f.timestamp >= filter.since!);
    }

    results.sort((a, b) => b.timestamp - a.timestamp);

    const limit = filter.limit ?? 50;
    return results.slice(0, limit);
  }

  /**
   * Get feedback summary statistics.
   */
  stats(): {
    totalSignals: number;
    positiveSignals: number;
    negativeSignals: number;
    averageStrength: number;
    mostCommonSignal: SignalType | null;
  } {
    const positive = this.feedbackLog.filter((f) => f.strength > 0);
    const negative = this.feedbackLog.filter((f) => f.strength < 0);
    const avgStrength = this.feedbackLog.length > 0
      ? this.feedbackLog.reduce((s, f) => s + f.strength, 0) / this.feedbackLog.length
      : 0;

    // Most common signal
    const counts = new Map<SignalType, number>();
    for (const fb of this.feedbackLog) {
      counts.set(fb.signal, (counts.get(fb.signal) || 0) + 1);
    }
    let mostCommon: SignalType | null = null;
    let maxCount = 0;
    for (const [sig, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = sig;
      }
    }

    return {
      totalSignals: this.feedbackLog.length,
      positiveSignals: positive.length,
      negativeSignals: negative.length,
      averageStrength: Math.round(avgStrength * 100) / 100,
      mostCommonSignal: mostCommon,
    };
  }
}
