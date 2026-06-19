/**
 * Behavior Model — 用户行为历史追踪与持久化
 *
 * 记录每个 tool 的用户操作历史，提供三阶匹配查询用于 D2 评分。
 * 自动持久化到 .agentos/behavior-model.json，跨 session 保留。
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// Types
// ============================================================

export interface BehaviorEntry {
  /** 工具名 */
  toolName: string;
  /** 参数摘要（用于一阶精确匹配） */
  paramSignature: string;
  /** 工具类别 */
  category: string;
  /** 操作时间戳 */
  timestamp: number;
  /** 是否成功 */
  success: boolean;
  /** 用户是否确认了 */
  confirmed: boolean;
}

export interface BehaviorStats {
  exactMatchCount: number;
  sameToolCount: number;
  sameCategoryCount: number;
}

export interface BehaviorModelData {
  entries: BehaviorEntry[];
  lastUpdated: number;
}

/**
 * 工具名到类别的映射（用于三阶匹配）
 */
const TOOL_CATEGORIES: Record<string, string> = {
  exec: 'command',
  write: 'file',
  read: 'file',
  edit: 'file',
  delete: 'file',
  web_search: 'network',
  web_fetch: 'network',
  apply_patch: 'file',
};

/**
 * 生成参数签名用于精确匹配。
 * 取所有参数值的排序拼接，忽略 undefined/function。
 */
function paramSignature(params: Record<string, unknown>): string {
  const keys = Object.keys(params).sort();
  return keys
    .map((k) => `${k}=${JSON.stringify(params[k] ?? '')}`)
    .join('&');
}

/**
 * Behavior Model — 跨 session 持久化的用户行为历史。
 */
export class BehaviorModel {
  private entries: BehaviorEntry[] = [];
  private storagePath?: string;
  private maxEntries: number;

  constructor(maxEntries = 5000) {
    this.maxEntries = maxEntries;
  }

  /** 启用磁盘持久化 */
  enablePersistence(workspaceRoot: string): void {
    this.storagePath = path.join(workspaceRoot, '.agentos', 'behavior-model.json');
    this.load();
  }

  /** 记录一次操作 */
  record(op: {
    toolName: string;
    params: Record<string, unknown>;
    success: boolean;
    confirmed: boolean;
  }): void {
    const entry: BehaviorEntry = {
      toolName: op.toolName,
      paramSignature: paramSignature(op.params),
      category: TOOL_CATEGORIES[op.toolName] ?? 'other',
      timestamp: Date.now(),
      success: op.success,
      confirmed: op.confirmed,
    };

    this.entries.push(entry);

    // 超过最大条目时，移除最旧的一半
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-Math.floor(this.maxEntries / 2));
    }

    this.save();
  }

  /**
   * 查询三阶匹配统计。
   *
   * exactMatchCount: 相同 toolName + 相同参数模式
   * sameToolCount:   相同 toolName，任意参数
   * sameCategoryCount: 相同类别，任意 tool
   */
  getStats(toolName: string, params: Record<string, unknown>): BehaviorStats {
    const sig = paramSignature(params);
    const category = TOOL_CATEGORIES[toolName] ?? 'other';

    let exactMatchCount = 0;
    let sameToolCount = 0;
    let sameCategoryCount = 0;

    for (const entry of this.entries) {
      if (entry.toolName === toolName && entry.paramSignature === sig) {
        exactMatchCount++;
      }
      if (entry.toolName === toolName) {
        sameToolCount++;
      }
      if (entry.category === category) {
        sameCategoryCount++;
      }
    }

    return { exactMatchCount, sameToolCount, sameCategoryCount };
  }

  /**
   * 获取指定 tool 在指定时间窗口内的操作频率。
   */
  getRecentFrequency(toolName: string, windowMs: number = 5 * 60 * 1000): number {
    const cutoff = Date.now() - windowMs;
    let count = 0;
    for (const entry of this.entries) {
      if (entry.toolName === toolName && entry.timestamp >= cutoff) {
        count++;
      }
    }
    return count;
  }

  /** 获取 total 操作数 */
  get totalOps(): number {
    return this.entries.length;
  }

  /** 获取所有条目 */
  getAllEntries(): BehaviorEntry[] {
    return [...this.entries];
  }

  /** 清空所有条目 */
  clear(): void {
    this.entries = [];
    this.save();
  }

  // ============================================================
  // Persistence
  // ============================================================

  private save(): void {
    if (!this.storagePath) return;
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: BehaviorModelData = {
        entries: this.entries,
        lastUpdated: Date.now(),
      };
      fs.writeFileSync(this.storagePath, JSON.stringify(data), 'utf-8');
    } catch {
      // 非关键，静默失败
    }
  }

  private load(): void {
    if (!this.storagePath) return;
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf-8');
        const data: BehaviorModelData = JSON.parse(raw);
        this.entries = data.entries ?? [];
      }
    } catch {
      this.entries = [];
    }
  }
}
