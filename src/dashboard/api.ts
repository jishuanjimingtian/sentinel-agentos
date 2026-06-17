/**
 * Dashboard API — Sentinel AgentOS 可视化数据查询接口
 *
 * v1.3
 *
 * 提供：
 * - /api/stats       — 统计卡片数据（总量/通过/高风险/拦截）
 * - /api/timeline    — 7天趋势（拦截趋势图）
 * - /api/hotmap      — 工具调用热力图（exec/read/write 分布）
 * - /api/incidents   — 事故列表（故障复盘）
 * - /api/audit       — 拦截记录列表（分页）
 * - /api/health      — 运行时监控（CPU/内存/GC）
 */

import type { AgentOS } from '../core';
import { findAuditFile, loadAuditEntries } from './audit-source';

export interface StatsResponse {
  totalOperations: number;
  passes: number;
  failures: number;
  highRiskOps: number;
  totalBlocked: number;
  sessionsTracked: number;
  qualityScore: number;
  uptimeSeconds: number;
}

export interface TimelinePoint {
  date: string;
  total: number;
  blocked: number;
}

export interface HotmapEntry {
  tool: string;
  calls: number;
  failures: number;
  percentage: number;
}

export interface IncidentRecord {
  id: string;
  type: string;
  title: string;
  description: string;
  timestamp: number;
  operationChain: string[];
  severity: 'critical' | 'warning' | 'info';
  resolved: boolean;
}

export interface AuditPage {
  entries: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export class DashboardAPI {
  private aos: AgentOS;
  private workspaceRoot: string;
  private startTime: number;

  constructor(aos: AgentOS, workspaceRoot: string) {
    this.aos = aos;
    this.workspaceRoot = workspaceRoot;
    this.startTime = Date.now();
  }

  /** 当前使用的审计日志路径（调试用） */
  getAuditPath(): string | null {
    return findAuditFile(process.cwd(), this.workspaceRoot);
  }

  private readAllAuditEntries(): Record<string, unknown>[] {
    return loadAuditEntries(process.cwd(), undefined, this.workspaceRoot);
  }

  /**
   * 统计卡片数据
   */
  getStats(): StatsResponse {
    const report = this.aos.getReport() || {};
    const audit = this.aos.getAuditStats();
    const quality = report.quality as Record<string, unknown> || {};

    return {
      totalOperations: audit.totalOperations,
      passes: audit.totalOperations - audit.verifyFailures,
      failures: audit.verifyFailures,
      highRiskOps: audit.highRiskOps,
      totalBlocked: audit.verifyFailures,
      sessionsTracked: audit.sessionsTracked ?? 1,
      qualityScore: (quality.overallScore as number) ?? 0,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  /**
   * 7 天拦截趋势（全量审计日志）
   */
  getTimeline(): TimelinePoint[] {
    const entries = this.readAllAuditEntries();
    const dayBuckets = new Map<string, { total: number; blocked: number }>();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().split('T')[0];
      dayBuckets.set(d as string, { total: 0, blocked: 0 });
    }

    for (const entry of entries) {
      const raw = entry.completedAt ?? entry.ts ?? entry.timestamp ?? 0;
      const tsVal = typeof raw === 'string' ? Date.parse(raw) : Number(raw);
      if (!tsVal) continue;
      const date = new Date(tsVal).toISOString().split('T')[0];
      const bucket = dayBuckets.get(date!);
      if (!bucket) continue;
      bucket.total++;
      const verifyGate = entry.verifyGate as { status?: string } | undefined;
      if (entry.ok === false || verifyGate?.status === 'FAIL') {
        bucket.blocked++;
      }
    }

    return Array.from(dayBuckets.entries()).map(([date, data]) => ({
      date: (date as string).slice(5),
      total: data.total,
      blocked: data.blocked,
    }));
  }

  /**
   * 工具热力图（全量审计日志）
   */
  getHotmap(): HotmapEntry[] {
    const entries = this.readAllAuditEntries();
    const toolBuckets = new Map<string, { calls: number; failures: number }>();

    for (const entry of entries) {
      const tool = String(entry.toolName || entry.tool || 'unknown');
      const bucket = toolBuckets.get(tool) || { calls: 0, failures: 0 };
      bucket.calls++;
      const verifyGate = entry.verifyGate as { status?: string } | undefined;
      if (entry.ok === false || verifyGate?.status === 'FAIL') {
        bucket.failures++;
      }
      toolBuckets.set(tool, bucket);
    }

    const total = entries.length || 1;
    return Array.from(toolBuckets.entries())
      .map(([tool, data]) => ({
        tool,
        calls: data.calls,
        failures: data.failures,
        percentage: Math.round((data.calls / total) * 100),
      }))
      .sort((a, b) => b.calls - a.calls);
  }

  /**
   * 获取拦截记录列表（分页）
   */
  getAuditPage(page: number = 1, pageSize: number = 20): AuditPage {
    const entries = this.readAllAuditEntries();
    const total = entries.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const paged = entries.slice(start, start + pageSize).reverse();

    return {
      entries: paged,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  /**
   * 运行时健康数据
   */
  getRuntimeHealth(): Record<string, unknown> {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    return {
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
        external: Math.round(mem.external / 1024 / 1024 * 100) / 100,
      },
      cpu: {
        user: cpu.user,
        system: cpu.system,
      },
      uptime: process.uptime(),
      nodeVersion: process.version,
      platform: process.platform,
      pid: process.pid,
    };
  }
}
