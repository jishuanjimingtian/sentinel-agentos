/**
 * Audit Analyzer — 事故检测 + 自动复盘
 *
 * v1.3
 *
 * 监控审计日志，检测异常事件（如 openclaw.json 被覆盖、高风险操作），
 * 自动生成事故复盘 Markdown 报告。
 *
 * 关键交付：再发生 openclaw.json 被清空这种事，3 秒自动生成复盘报告。
 */

import * as path from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { loadAuditEntries } from './dashboard/audit-source';
import { entryParams, resolveEntryRisk } from './dashboard/entry-risk';

export interface Incident {
  id: string;
  type: 'config_overwrite' | 'high_risk_exec' | 'mass_delete' | 'schema_violation' | 'pipeline_failure' | 'guard_blocks';
  title: string;
  description: string;
  timestamp: number;
  severity: 'critical' | 'warning' | 'info';
  operationChain: string[];
  affectedFiles?: string[];
  resolved: boolean;
  resolvedAt?: number;
  reportPath?: string;
}

export interface DetectionRule {
  name: string;
  type: Incident['type'];
  severity: Incident['severity'];
  check: (entries: any[]) => Incident | null;
}

// ═══════════════════════════════════════
// 检测规则
// ═══════════════════════════════════════

const DETECTION_RULES: DetectionRule[] = [
  {
    name: 'openclaw.json 被覆盖',
    type: 'config_overwrite',
    severity: 'critical',
    check: (entries): Incident | null => {
      const relevant = entries.filter((e: Record<string, unknown>) => {
        const params = entryParams(e);
        const pathVal = String(params.path ?? '');
        const content = params.content != null ? String(params.content) : '';
        return pathVal.includes('openclaw.json') && content === '{}';
      });
      if (relevant.length === 0) return null;
      const last = relevant[relevant.length - 1];
      return {
        id: `inc_config_${Date.now()}`,
        type: 'config_overwrite',
        title: 'openclaw.json 被清空',
        description: 'openclaw.json 配置文件被清空为 {}，可能导致 Gateway 配置丢失',
        timestamp: last.completedAt || last.ts || Date.now(),
        severity: 'critical',
        operationChain: relevant.map((e: any) => e.toolName || e.tool || 'write'),
        affectedFiles: relevant.map((e: any) => (e.toolParameters || e.params || {}).path).filter(Boolean),
        resolved: false,
      };
    },
  },
  {
    name: '高风险操作频发',
    type: 'high_risk_exec',
    severity: 'warning',
    check: (entries): Incident | null => {
      const recent = entries.slice(-50);
      const highRisk = recent.filter((e: Record<string, unknown>) => resolveEntryRisk(e) > 5);
      if (highRisk.length < 3) return null;

      const chain = highRisk.map((e: Record<string, unknown>) => {
        const tool = String(e.toolName || e.tool || 'exec');
        const params = entryParams(e);
        const cmd = params.command ? String(params.command).slice(0, 60) : '';
        return cmd ? `${tool}: ${cmd}` : tool;
      });

      return {
        id: `inc_risk_${Date.now()}`,
        type: 'high_risk_exec',
        title: `高风险操作密集（最近 ${highRisk.length} 次）`,
        description: `最近 50 次操作中检测到 ${highRisk.length} 次高风险操作（score > 5）`,
        timestamp: highRisk[highRisk.length - 1]?.completedAt || Date.now(),
        severity: 'warning',
        operationChain: chain,
        resolved: false,
      };
    },
  },
  {
    name: '批量删除',
    type: 'mass_delete',
    severity: 'critical',
    check: (entries): Incident | null => {
      const recent = entries.slice(-30);
      const deletes = recent.filter((e: Record<string, unknown>) => {
        const tool = String(e.toolName || e.tool || '');
        return tool === 'delete' || tool === 'rm';
      });
      if (deletes.length < 5) return null;

      return {
        id: `inc_delete_${Date.now()}`,
        type: 'mass_delete',
        title: `批量删除操作（${deletes.length} 次）`,
        description: `最近 30 次操作中包含 ${deletes.length} 次删除操作`,
        timestamp: deletes[deletes.length - 1]?.completedAt || Date.now(),
        severity: 'critical',
        operationChain: deletes.map((e: Record<string, unknown>) => {
          const params = entryParams(e);
          return `${e.toolName || e.tool}: ${params.path || params.file || ''}`;
        }),
        affectedFiles: deletes.map((e: Record<string, unknown>) => String(entryParams(e).path ?? '')).filter(Boolean),
        resolved: false,
      };
    },
  },
  {
    name: 'Schema 违规',
    type: 'schema_violation',
    severity: 'warning',
    check: (entries): Incident | null => {
      const recent = entries.slice(-100);
      const violations = recent.filter((e: any) => {
        return e.schemaGate?.errors && e.schemaGate.errors.length > 0;
      });
      if (violations.length < 3) return null;

      return {
        id: `inc_schema_${Date.now()}`,
        type: 'schema_violation',
        title: `Schema 验证反复失败（${violations.length} 次）`,
        description: `最近 100 次调用中 ${violations.length} 次 Schema 校验失败`,
        timestamp: violations[violations.length - 1]?.completedAt || Date.now(),
        severity: 'warning',
        operationChain: violations.map((e: any) => {
          const params = e.toolParameters || e.params || {};
          return `${e.toolName || e.tool}: params=${JSON.stringify(params).slice(0, 80)}`;
        }),
        resolved: false,
      };
    },
  },
  {
    name: 'Guard 拦截频发',
    type: 'guard_blocks',
    severity: 'warning',
    check: (entries): Incident | null => {
      const recent = entries.slice(-100);
      const blocked = recent.filter((e: Record<string, unknown>) => e.ok === false);
      if (blocked.length < 5) return null;

      const chain = blocked.slice(-8).map((e: Record<string, unknown>) => {
        const tool = String(e.toolName || e.tool || 'exec');
        const params = entryParams(e);
        const hint = params.command || params.path || params.value || '';
        return hint ? `${tool}: ${String(hint).slice(0, 50)}` : tool;
      });

      return {
        id: `inc_guard_${Date.now()}`,
        type: 'guard_blocks',
        title: `Guard 拦截频发（最近 ${blocked.length} 次）`,
        description: `最近 100 次操作中有 ${blocked.length} 次被 Sentinel Guard 拦截（ok=false）`,
        timestamp: Number(blocked[blocked.length - 1]?.ts ?? blocked[blocked.length - 1]?.completedAt ?? Date.now()),
        severity: 'warning',
        operationChain: chain,
        resolved: false,
      };
    },
  },
];

// ═══════════════════════════════════════
// Audit Analyzer
// ═══════════════════════════════════════

export class AuditAnalyzer {
  private workspaceRoot: string;
  private incidentsDir: string;
  private maxIncidents: number;
  private checkIntervalMs: number;
  private lastEntriesHash: string = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private onChangeCallbacks: Array<(incidents: Incident[]) => void> = [];

  constructor(workspaceRoot: string, options?: {
    maxIncidents?: number;
    checkIntervalMs?: number;
  }) {
    this.workspaceRoot = workspaceRoot;
    this.incidentsDir = path.join(workspaceRoot, '.agentos', 'incidents');
    this.maxIncidents = options?.maxIncidents ?? 50;
    this.checkIntervalMs = options?.checkIntervalMs ?? 3000; // 3 秒扫描一次

    // 确保目录存在
    if (!existsSync(this.incidentsDir)) {
      mkdirSync(this.incidentsDir, { recursive: true });
    }
  }

  /**
   * 扫描审计日志并检测新事故
   * 返回本次新检测到的事故列表
   */
  scan(): Incident[] {
    const entries = this.readRecentEntries(500);
    const currentHash = entries.map((e: any) => e.id || '').join(',');
    if (currentHash === this.lastEntriesHash) return []; // 无新数据
    this.lastEntriesHash = currentHash;

    const newIncidents: Incident[] = [];

    for (const rule of DETECTION_RULES) {
      const incident = rule.check(entries);
      if (incident) {
        // 去重：检查是否有相同类型的未解决事故
        const existing = this.loadIncidents().filter(
          (i) => i.type === incident.type && !i.resolved
        );
        if (existing.length > 0) continue;

        // 保存事故
        this.saveIncident(incident);
        newIncidents.push(incident);

        // 生成复盘报告
        const reportPath = this.generateReport(incident, entries);
        incident.reportPath = reportPath;

        // 自动清理超量
        this.pruneIncidents();
      }
    }

    return newIncidents;
  }

  /**
   * 读取最近的审计条目
   */
  private readRecentEntries(maxLines: number): any[] {
    return loadAuditEntries(process.cwd(), maxLines, this.workspaceRoot);
  }

  /**
   * 保存事故到文件
   */
  private saveIncident(incident: Incident): void {
    const fp = path.join(this.incidentsDir, `${incident.id}.json`);
    writeFileSync(fp, JSON.stringify(incident, null, 2), 'utf-8');
  }

  /**
   * 加载所有事故
   */
  loadIncidents(): Incident[] {
    try {
      if (!existsSync(this.incidentsDir)) return [];
      const raw = readdirSync(this.incidentsDir)
        .filter((f: string) => f.endsWith('.json'))
        .map((f: string) => {
          try {
            return JSON.parse(readFileSync(path.join(this.incidentsDir, f), 'utf-8')) as Incident;
          } catch { return null; }
        })
        .filter(Boolean) as Incident[];
      return raw.sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      return [];
    }
  }

  /**
   * 加载未解决的事故
   */
  loadUnresolved(): Incident[] {
    return this.loadIncidents().filter((i) => !i.resolved);
  }

  /**
   * 标记事故已解决
   */
  resolveIncident(id: string): boolean {
    const incidents = this.loadIncidents();
    const target = incidents.find((i) => i.id === id);
    if (!target) return false;
    target.resolved = true;
    target.resolvedAt = Date.now();
    this.saveIncident(target);
    return true;
  }

  /**
   * 生成复盘 Markdown 报告
   */
  private generateReport(incident: Incident, entries: any[]): string {
    const date = new Date(incident.timestamp).toISOString();
    const chain = incident.operationChain.map((op, i) => `  ${i + 1}. \`${op}\``).join('\n');

    // 关联分析：回溯到操作链的完整上下文
    const relatedEntries = entries.filter((e: any) => {
      const tool = e.toolName || e.tool || '';
      return incident.operationChain.some((op) => op.startsWith(tool));
    });

    const relatedTable = relatedEntries.map((e: any) => {
      const ts = new Date(e.completedAt || e.ts || Date.now()).toISOString().slice(11, 19);
      const tool = e.toolName || e.tool || '?';
      const params = JSON.stringify(e.toolParameters || e.params || {}).slice(0, 100);
      return `| ${ts} | ${tool} | \`${params}\` | ${e.ok === false ? '❌' : '✅'} |`;
    }).join('\n');

    const report = `# 🛡️ Sentinel AgentOS 事故复盘报告

## 事故概要

| 项目 | 内容 |
|------|------|
| **ID** | ${incident.id} |
| **类型** | ${incident.type} |
| **严重度** | ${incident.severity === 'critical' ? '🔴 严重' : incident.severity === 'warning' ? '🟡 警告' : '🔵 信息'} |
| **时间** | ${date} |
| **标题** | ${incident.title} |

## 描述

${incident.description}

## 操作链

${chain}

## 关联操作详情

| 时间 | 工具 | 参数 | 状态 |
|------|------|------|------|
${relatedTable}

## 影响分析

${incident.type === 'config_overwrite' ? '配置被覆盖可能导致系统重启后配置丢失或异常行为。建议：立即检查 openclaw.json 文件完整性，必要时从备份恢复。' :
  incident.type === 'mass_delete' ? `检测到批量删除操作（${incident.operationChain.length} 次），建议检查删除的文件是否需要恢复。` :
  '建议审查该操作序列，确认是否符合预期行为。'}

## 建议

1. 检查审计日志确认操作来源
2. 验证受影响文件状态
3. 必要时恢复数据
4. 考虑在规则中禁用或限制该操作

---

*自动生成于 ${new Date().toISOString()}*
*Sentinel AgentOS Audit Analyzer*
`;

    const reportPath = path.join(this.incidentsDir, `${incident.id}.md`);
    writeFileSync(reportPath, report, 'utf-8');
    return reportPath;
  }

  /**
   * 清理超量事故
   */
  private pruneIncidents(): void {
    const incidents = this.loadIncidents();
    if (incidents.length <= this.maxIncidents) return;

    const toRemove = incidents.slice(this.maxIncidents);
    for (const inc of toRemove) {
      try {
        const jsonPath = path.join(this.incidentsDir, `${inc.id}.json`);
        if (existsSync(jsonPath)) unlinkSync(jsonPath);
        if (inc.reportPath && existsSync(inc.reportPath)) unlinkSync(inc.reportPath);
      } catch { /* skip */ }
    }
  }

  /**
   * 启动定时扫描
   */
  startAutoScan(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        const newIncidents = this.scan();
        for (const inc of newIncidents) {
          console.log(`[AuditAnalyzer] 🚨 检测到新事故: ${inc.title} (${inc.severity})`);
        }
        if (newIncidents.length > 0) {
          for (const cb of this.onChangeCallbacks) {
            try { cb(this.loadIncidents()); } catch { /* skip */ }
          }
        }
      } catch (e: unknown) {
        console.warn(`[AuditAnalyzer] 扫描异常: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, this.checkIntervalMs);
  }

  /**
   * 停止定时扫描
   */
  stopAutoScan(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 注册事故变更回调
   */
  onChange(callback: (incidents: Incident[]) => void): void {
    this.onChangeCallbacks.push(callback);
  }
}
