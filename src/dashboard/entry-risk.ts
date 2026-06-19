/**
 * 审计条目风险分估算 — Dashboard / 事故检测共用
 * 轻量 audit.jsonl 无 riskGate 时，用 RiskGate 实时估算
 */

import { RiskGate, type ToolRiskProfile } from '../guard/risk-gate';

const REPORT_RISK_PROFILES: ToolRiskProfile[] = [
  { tool: 'read', impact: 'local', reversibility: 1, sensitivity: 'low', category: 'read' },
  { tool: 'memory_search', impact: 'local', reversibility: 1, sensitivity: 'low', category: 'read' },
  { tool: 'memory_get', impact: 'local', reversibility: 1, sensitivity: 'low', category: 'read' },
  { tool: 'write', impact: 'workspace', reversibility: 0.3, sensitivity: 'medium', category: 'write' },
  { tool: 'edit', impact: 'workspace', reversibility: 0.5, sensitivity: 'medium', category: 'write' },
  { tool: 'exec', impact: 'workspace', reversibility: 0.4, sensitivity: 'medium', category: 'compute' },
  { tool: 'process', impact: 'workspace', reversibility: 0.4, sensitivity: 'medium', category: 'compute' },
  { tool: 'web_search', impact: 'workspace', reversibility: 0.9, sensitivity: 'low', category: 'network' },
  { tool: 'web_fetch', impact: 'workspace', reversibility: 0.9, sensitivity: 'low', category: 'network' },
  { tool: 'delete', impact: 'project', reversibility: 0.1, sensitivity: 'high', category: 'delete' },
];

const reportRiskGate = new RiskGate();
reportRiskGate.registerProfiles(REPORT_RISK_PROFILES);

function unescapeJsonStr(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\').replace(/\\"/g, '"');
}

export function parseToolParameters(raw: unknown): Record<string, unknown> | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { value: trimmed };
  }

  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    const out: Record<string, unknown> = {};
    const pathM = trimmed.match(/"path"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (pathM?.[1]) out.path = unescapeJsonStr(pathM[1]);
    const cmdM = trimmed.match(/"command"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (cmdM?.[1]) out.command = unescapeJsonStr(cmdM[1]);
    const oldM = trimmed.match(/"oldText"\s*:\s*"((?:[^"\\]|\\.)*)/);
    const newM = trimmed.match(/"newText"\s*:\s*"((?:[^"\\]|\\.)*)/);
    const preview = oldM?.[1] ? unescapeJsonStr(oldM[1]) : newM?.[1] ? unescapeJsonStr(newM[1]) : '';
    if (preview) out.preview = preview;
    if (trimmed.includes('"edits"')) out.edits = [{ oldText: preview || '…' }];
    return Object.keys(out).length ? out : null;
  }
}

export function resolveEntryRisk(e: Record<string, unknown>): number {
  const riskRaw = (e as { riskGate?: { score?: number }; risk?: number }).riskGate?.score
    ?? (e as { risk?: number }).risk;
  if (riskRaw != null && !Number.isNaN(Number(riskRaw))) return Number(riskRaw);

  const tool = String(e.toolName || e.tool || 'exec');
  const params = parseToolParameters(e.toolParameters ?? e.params) ?? {};
  const score = reportRiskGate.evaluate(tool, params).score;
  const failed = e.ok === false || (e as { verifyGate?: { status?: string } }).verifyGate?.status === 'FAIL';
  return failed ? Math.max(score, 3.5) : score;
}

export function entryParams(e: Record<string, unknown>): Record<string, unknown> {
  return parseToolParameters(e.toolParameters ?? e.params) ?? {};
}
