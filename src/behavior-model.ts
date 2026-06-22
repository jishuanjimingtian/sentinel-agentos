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

  // ============================================================
  // Self-Evolution Rules (v1.4.2)
  // ============================================================

  /**
   * 计算 allowRate — 被允许的操作比例（最近 N 条）
   */
  getAllowRate(toolName: string, recentCount: number = 50): number {
    const relevant = this.entries.filter(e => e.toolName === toolName).slice(-recentCount);
    if (relevant.length === 0) return 0.5;
    const allowed = relevant.filter(e => e.confirmed || e.success).length;
    return allowed / relevant.length;
  }

  /**
   * 获取全局 allowRate
   */
  getGlobalAllowRate(recentCount: number = 100): number {
    const recent = this.entries.slice(-recentCount);
    if (recent.length === 0) return 0.5;
    const allowed = recent.filter(e => e.confirmed || e.success).length;
    return allowed / recent.length;
  }

  /**
   * 运行自进化规则：
   * - 30 天未使用的模式 → 置信度偏移归零
   * - allowRate >= 80% 且 hits >= 10 → 额外放松 -5
   * - allowRate < 20% 且 hits >= 5 → 额外收紧 +5
   * - 全局 allowRate > 90% → 置信度底池提高 10
   * - 全局 allowRate < 30% → 置信度底池降至 0
   *
   * @returns { evolved: number, floor: number, adjustments: Record<string, number> }
   */
  evolve(): { evolved: number; floor: number; adjustments: Record<string, number> } {
    const now = Date.now();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    let evolved = 0;

    // --- 1. 清除 30 天未使用的旧条目 ---
    const before = this.entries.length;
    this.entries = this.entries.filter(e => (now - e.timestamp) < THIRTY_DAYS || (e.confirmed || e.success));
    evolved = before - this.entries.length;

    // --- 2. 按 toolName 计算 allowRate 偏移 ---
    const adjustments: Record<string, number> = {};
    const toolNames = [...new Set(this.entries.map(e => e.toolName))];

    for (const tn of toolNames) {
      const relevant = this.entries.filter(e => e.toolName === tn);
      const hits = relevant.length;
      if (hits < 5) continue; // 数据太少不做调整

      const allowed = relevant.filter(e => e.confirmed || e.success).length;
      const rate = allowed / hits;

      let offset = 0;
      if (rate >= 0.8 && hits >= 10) {
        offset = -5; // 高频允许 → 放松
      } else if (rate < 0.2 && hits >= 5) {
        offset = 5;  // 高频拒绝 → 收紧
      }

      if (offset !== 0) {
        adjustments[tn] = offset;
      }
    }

    // --- 3. 全局 allowRate 决定置信度底池 (0-20) ---
    const globalRate = this.getGlobalAllowRate(100);
    let floor = 0;
    if (globalRate > 0.9) {
      floor = 10;
    } else if (globalRate > 0.7) {
      floor = 5;
    } else if (globalRate < 0.3) {
      floor = 0;
    } else {
      floor = 3;
    }

    this.save();
    return { evolved, floor, adjustments };
  }

  /**
   * 获取给定 tool 的置信度偏移值
   */
  getConfidenceOffset(toolName: string): number {
    const globalAllow = this.getGlobalAllowRate(100);
    let offset = 0;

    // 全局松弛度
    if (globalAllow > 0.9) offset -= 5;
    else if (globalAllow < 0.3) offset += 5;

    // 工具级 allowRate 偏移
    const rate = this.getAllowRate(toolName, 50);
    const hits = this.entries.filter(e => e.toolName === toolName).length;
    if (rate >= 0.8 && hits >= 10) offset -= 5;
    else if (rate < 0.2 && hits >= 5) offset += 5;

    return offset;
  }
}
