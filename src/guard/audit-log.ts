import { AuditEntry, VerifyStatus, Snapshot, VerifyCheck } from '../types';
import { SnapshotGate } from './snapshot-verify';
import { RiskGate } from './risk-gate';
import { SchemaGate } from './schema-gate';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Generate a unique audit entry ID.
 */
function generateAuditId(): string {
  return `audit_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Audit Log — append-only, immutable operation record.
 *
 * Every tool call that passes through AgentOS Guard gets logged here.
 * The log is an append-only JSONL file — entries are never deleted or modified.
 *
 * In production: use SQLite WAL or a remote append-only service.
 * MVP: flat JSONL file.
 */
export class AuditLog {
  private logPath: string;
  private schemaGate: SchemaGate;
  private riskGate: RiskGate;
  private snapshotGate: SnapshotGate;

  constructor(
    workspaceRoot: string,
    schemaGate: SchemaGate,
    riskGate: RiskGate,
  ) {
    this.logPath = path.join(workspaceRoot, '.agentos', 'audit.jsonl');
    this.schemaGate = schemaGate;
    this.riskGate = riskGate;
    this.snapshotGate = new SnapshotGate(workspaceRoot);
  }

  /**
   * Record a tool call in the audit log.
   *
   * Called AFTER execution completes. Returns the full audit entry.
   */
  record(options: {
    sessionId: string;
    agentId: string;
    startedAt: number;
    completedAt: number;
    toolName: string;
    toolParameters: Record<string, unknown>;
    toolResult: unknown;
    snapshot: Snapshot | null;
    verifyStatus: VerifyStatus;
    verifyChecks: VerifyCheck[];
  }): AuditEntry {
    const entry: AuditEntry = {
      id: generateAuditId(),
      sessionId: options.sessionId,
      agentId: options.agentId,
      startedAt: options.startedAt,
      completedAt: options.completedAt,
      durationMs: options.completedAt - options.startedAt,
      toolName: options.toolName,
      toolParameters: this.sanitizeParams(options.toolParameters),
      toolResult: this.truncateResult(options.toolResult),
      schemaGate: this.schemaGate.check(options.toolName, options.toolParameters),
      riskGate: this.riskGate.evaluate(options.toolName, options.toolParameters),
      snapshot: options.snapshot,
      verifyGate: {
        status: options.verifyStatus,
        checks: options.verifyChecks,
      },
      diff: options.snapshot
        ? this.snapshotGate.computeDiff(options.snapshot)
        : null,
    };

    this.append(entry);
    return entry;
  }

  /**
   * Query audit entries by filter.
   */
  query(filter: {
    sessionId?: string;
    toolName?: string;
    verifyStatus?: VerifyStatus;
    minScore?: number;
    maxScore?: number;
    limit?: number;
  } = {}): AuditEntry[] {
    const entries = this.readAll();
    let results = entries;

    if (filter.sessionId) {
      results = results.filter((e) => e.sessionId === filter.sessionId);
    }
    if (filter.toolName) {
      results = results.filter((e) => e.toolName === filter.toolName);
    }
    if (filter.verifyStatus) {
      results = results.filter((e) => e.verifyGate.status === filter.verifyStatus);
    }
    if (filter.minScore !== undefined) {
      results = results.filter((e) => e.riskGate.score >= filter.minScore!);
    }
    if (filter.maxScore !== undefined) {
      results = results.filter((e) => e.riskGate.score <= filter.maxScore!);
    }

    const limit = filter.limit ?? 100;
    return results.slice(-limit);
  }

  /**
   * Get summary statistics from the audit log.
   */
  stats(): {
    totalOperations: number;
    byTool: Record<string, number>;
    averageRiskScore: number;
    verifyFailures: number;
    sessionsTracked: number;
    highRiskOps: number;
  } {
    const entries = this.readAll();

    const byTool: Record<string, number> = {};
    let totalScore = 0;
    let verifyFailures = 0;
    let highRiskOps = 0;
    const sessions = new Set<string>();

    for (const entry of entries) {
      byTool[entry.toolName] = (byTool[entry.toolName] || 0) + 1;
      totalScore += entry.riskGate.score;
      if (entry.verifyGate.status === 'FAIL') verifyFailures++;
      if (entry.riskGate.score > 3.0) highRiskOps++;
      sessions.add(entry.sessionId);
    }

    return {
      totalOperations: entries.length,
      byTool,
      averageRiskScore: entries.length > 0
        ? Math.round((totalScore / entries.length) * 100) / 100
        : 0,
      verifyFailures,
      sessionsTracked: sessions.size,
      highRiskOps,
    };
  }

  /**
   * Saintize sensitive parameters before logging.
   */
  private sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
    const sensitive = ['token', 'password', 'secret', 'key', 'api_key', 'auth'];
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
      if (sensitive.some((s) => key.toLowerCase().includes(s))) {
        sanitized[key] = '***REDACTED***';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Truncate large results to prevent log bloat.
   */
  private truncateResult(result: unknown, maxChars = 5000): unknown {
    const str = typeof result === 'string'
      ? result
      : JSON.stringify(result);

    if (str.length > maxChars) {
      return str.slice(0, maxChars) + `... [truncated ${str.length - maxChars} chars]`;
    }

    return result;
  }

  /**
   * Append an entry to the JSONL audit log file.
   */
  private append(entry: AuditEntry): void {
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(this.logPath, line, 'utf-8');
  }

  /**
   * Read all audit entries from the log file.
   */
  private readAll(): AuditEntry[] {
    try {
      if (!fs.existsSync(this.logPath)) return [];

      const content = fs.readFileSync(this.logPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      return lines.map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }
}
