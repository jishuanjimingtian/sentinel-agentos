import {
  PreExecMetrics,
  RuntimeMetrics,
  PostExecMetrics,
  RiskScore,
  SchemaCheck,
} from '../types';
import { SchemaGate } from '../guard/schema-gate';
import { RiskGate } from '../guard/risk-gate';
import { WorkingMemory } from '../memory/working';

/**
 * PreExecEvaluator — captures metrics before tool execution.
 *
 * Watches the Guard layer output and WorkingMemory context
 * to score parameter quality, context utilization, and risk.
 */
export class PreExecEvaluator {
  private schemaGate: SchemaGate;
  private riskGate: RiskGate;
  private workingMemory: WorkingMemory;

  constructor(
    schemaGate: SchemaGate,
    riskGate: RiskGate,
    workingMemory: WorkingMemory,
  ) {
    this.schemaGate = schemaGate;
    this.riskGate = riskGate;
    this.workingMemory = workingMemory;
  }

  /**
   * Evaluate a tool call before execution.
   */
  evaluate(
    toolName: string,
    parameters: Record<string, unknown>,
  ): PreExecMetrics {
    // 1. Schema check
    const schemaCheck: SchemaCheck = this.schemaGate.check(toolName, parameters);

    // 2. Risk assessment
    const riskScore: RiskScore = this.riskGate.evaluate(toolName, parameters);

    // 3. Parameter quality: does the agent use context-aware params?
    const paramQuality = this.evaluateParamQuality(toolName, parameters);

    // 4. Context utilization: is the agent leveraging WorkingMemory?
    const contextUtilization = this.evaluateContextUtilization(toolName, parameters);

    return {
      timestamp: Date.now(),
      toolName,
      schemaCheck,
      riskScore,
      paramQuality,
      contextUtilization,
    };
  }

  /**
   * Score parameter quality based on contextual awareness.
   *
   * High quality: path contains session-relevant project paths,
   * content references open files, etc.
   * Low quality: bare strings, random-looking paths, missing files.
   */
  private evaluateParamQuality(
    _toolName: string,
    parameters: Record<string, unknown>,
  ): PreExecMetrics['paramQuality'] {
    let score = 0.5; // neutral start
    const observations: string[] = [];

    // Check if path references an open file
    if (typeof parameters['path'] === 'string') {
      const path = parameters['path'] as string;
      if (this.workingMemory.openFiles.some((f) => path.includes(f))) {
        score += 0.3;
        observations.push('Path references an open file');
      }
      if (path.startsWith('/') || path.match(/^[A-Z]:\\/)) {
        observations.push('Absolute path used');
      }
    }

    // Check if content parameter is meaningful
    if (typeof parameters['content'] === 'string') {
      const content = parameters['content'] as string;
      if (content.length > 20) {
        score = Math.min(1.0, score + 0.1);
      }
      if (content.length === 0) {
        score -= 0.2;
        observations.push('Empty content — possible error');
      }
    }

    // Check for file paths in multiple parameters
    const filePaths = Object.values(parameters).filter(
      (v) => typeof v === 'string' && (v.includes('.ts') || v.includes('.js') || v.includes('.json')),
    );

    if (filePaths.length > 1) {
      score = Math.min(1.0, score + 0.1);
      observations.push('Multiple file references — coordinated operation');
    }

    return {
      score: Math.round(Math.max(0, Math.min(1, score)) * 100) / 100,
      observations,
    };
  }

  /**
   * Score how well the agent uses stored context.
   */
  private evaluateContextUtilization(
    _toolName: string,
    parameters: Record<string, unknown>,
  ): PreExecMetrics['contextUtilization'] {
    let score = 0.4;
    const patterns: string[] = [];

    // Check if agent references recent messages
    if (this.workingMemory.recentMessages.length > 0) {
      score += 0.1;
      patterns.push(`${this.workingMemory.recentMessages.length} recent messages available`);
    }

    // Check if agent uses cached tool results
    const cachedCount = this.workingMemory.recentToolResults.size;
    if (cachedCount > 0) {
      score += 0.1;
      patterns.push(`${cachedCount} cached results available`);
    }

    // Check parameter values for context patterns
    const allValues = Object.values(parameters).map(String).join(' ');
    for (const msg of this.workingMemory.recentMessages.slice(-3)) {
      const words = msg.content.split(/\s+/).filter((w) => w.length > 3);
      for (const word of words.slice(0, 5)) {
        if (allValues.includes(word)) {
          score += 0.1;
          patterns.push(`Parameter references recent context: "${word}"`);
        }
      }
    }

    return {
      score: Math.round(Math.min(1.0, score) * 100) / 100,
      patterns,
    };
  }
}

/**
 * RuntimeEvaluator — captures metrics during execution.
 *
 * Tracks retries, self-corrections, timeouts, and
 * whether the agent selected the right tool for the job.
 */
export class RuntimeEvaluator {
  /**
   * Evaluate a completed tool execution.
   */
  evaluate(options: {
    toolName: string;
    startTime: number;
    endTime: number;
    retryCount: number;
    wasSelfCorrected: boolean;
    hadTimeout: boolean;
    expectedTool?: string; // For tool selection accuracy
    toolResult: unknown;
  }): RuntimeMetrics {
    const durationMs = options.endTime - options.startTime;
    const toolSuccess = !options.hadTimeout && options.toolResult !== undefined;

    // Tool selection accuracy
    const toolSelectionMatch = options.expectedTool
      ? options.toolName === options.expectedTool
      : undefined;

    // Adaptive score: composite of retry rate, timeout, correction
    let adaptiveScore = 1.0;
    adaptiveScore -= options.retryCount * 0.15; // Each retry costs 0.15
    if (options.hadTimeout) adaptiveScore -= 0.5;
    if (options.wasSelfCorrected) adaptiveScore += 0.2; // Self-correction is good!
    adaptiveScore = Math.max(0, Math.min(1, adaptiveScore));

    return {
      retryCount: options.retryCount,
      selfCorrected: options.wasSelfCorrected,
      hadTimeout: options.hadTimeout,
      toolSuccess,
      toolSelectionMatch,
      adaptiveScore: Math.round(adaptiveScore * 100) / 100,
      durationMs,
    };
  }
}

/**
 * PostExecEvaluator — captures metrics after execution.
 *
 * Scores verify results, user acceptance patterns,
 * and checks if the agent actually used its own result later.
 */
export class PostExecEvaluator {
  /**
   * Evaluate post-execution outcomes.
   */
  evaluate(options: {
    verifyPassed: boolean;
    verifyChecks: number; // Total number of verify checks
    verifyFailures: number;
    userAccepted: boolean; // Did user accept the result?
    userProvidedEdit: boolean; // Did user modify/edit after?
    resultWasUsed: boolean; // Did agent reference this result later?
    diffLinesChanged?: number;
  }): PostExecMetrics {
    // Verify score
    const verifyScore = options.verifyChecks > 0
      ? 1 - (options.verifyFailures / options.verifyChecks)
      : 1;

    // User acceptance
    const acceptance = options.userAccepted ? 1.0 : options.userProvidedEdit ? 0.3 : 0.7;

    // Composite outcome score
    const outcomeScore = (
      verifyScore * 0.3 +
      acceptance * 0.4 +
      (options.resultWasUsed ? 0.3 : 0)
    );

    // Overall health flag
    const healthy = verifyScore > 0.8 && acceptance > 0.5;

    return {
      verifyPassed: options.verifyPassed,
      verifyScore: Math.round(verifyScore * 100) / 100,
      userAccepted: options.userAccepted,
      userEditRate: options.userProvidedEdit ? 1 : 0,
      resultUtilized: options.resultWasUsed,
      outcomeScore: Math.round(outcomeScore * 100) / 100,
      healthy,
      diffLinesChanged: options.diffLinesChanged,
    };
  }
}
