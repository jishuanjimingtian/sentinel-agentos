/**
 * Whitelist — 操作白名单
 *
 * 定义哪些工具调用可以完全跳过审批（0 延迟 0 弹窗）。
 * 规则持久化到 .agentos/whitelist.json。
 *
 * 规则类型：
 *   - exact:   完全匹配 tool + 参数模式
 *   - tool:    只匹配 tool 名（不检查参数）
 *   - pattern: tool + 正则匹配参数文本
 *   - command: tool=exec + command 前缀匹配
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// Types
// ============================================================

export type WhitelistRuleType = 'exact' | 'tool' | 'pattern' | 'command';

export interface WhitelistRule {
  /** 规则唯一 ID */
  id: string;
  /** 规则类型 */
  type: WhitelistRuleType;
  /** 工具名 */
  tool: string;
  /** 参数匹配模式（取决于 type） */
  pattern?: string;
  /** 添加时间 */
  createdAt: number;
  /** 备注 */
  label?: string;
}

export interface WhitelistConfig {
  rules: WhitelistRule[];
  lastUpdated: number;
}

// ============================================================
// Whitelist Engine
// ============================================================

export class Whitelist {
  private rules: WhitelistRule[] = [];
  private storagePath?: string;
  private compiledPatterns: Map<string, RegExp> = new Map();

  constructor() {}

  /** 启用磁盘持久化 */
  enablePersistence(workspaceRoot: string): void {
    this.storagePath = path.join(workspaceRoot, '.agentos', 'whitelist.json');
    this.load();
  }

  // ============================================================
  // 规则管理
  // ============================================================

  /** 添加规则 */
  addRule(rule: Omit<WhitelistRule, 'id' | 'createdAt'>): WhitelistRule {
    const r: WhitelistRule = {
      ...rule,
      id: `wl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    };
    this.rules.push(r);
    if (r.type === 'pattern' && r.pattern) {
      try {
        this.compiledPatterns.set(r.id, new RegExp(r.pattern, 'i'));
      } catch { /* 无效正则静默忽略 */ }
    }
    this.save();
    return r;
  }

  /** 删除规则 */
  removeRule(id: string): boolean {
    const before = this.rules.length;
    this.rules = this.rules.filter(r => r.id !== id);
    this.compiledPatterns.delete(id);
    if (this.rules.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  /** 获取所有规则 */
  getRules(): WhitelistRule[] {
    return [...this.rules];
  }

  /** 清空所有规则 */
  clear(): void {
    this.rules = [];
    this.compiledPatterns.clear();
    this.save();
  }

  // ============================================================
  // 匹配检查
  // ============================================================

  /**
   * 检查操作是否命中白名单。
   * 命中 → 完全跳过审批链路。
   */
  isWhitelisted(toolName: string, params: Record<string, unknown>): boolean {
    for (const rule of this.rules) {
      if (rule.tool !== toolName) continue;

      switch (rule.type) {
        case 'tool':
          // 只匹配工具名
          return true;

        case 'exact':
          // 完全匹配参数
          if (rule.pattern !== undefined) {
            const paramStr = JSON.stringify(params);
            if (paramStr === rule.pattern) return true;
          }
          break;

        case 'command':
          // exec 命令前缀匹配
          if (toolName === 'exec' && rule.pattern) {
            const cmd = params['command'];
            if (typeof cmd === 'string' && cmd.startsWith(rule.pattern)) {
              return true;
            }
          }
          break;

        case 'pattern':
          // 正则匹配参数文本
          if (rule.pattern) {
            const compiled = this.compiledPatterns.get(rule.id);
            if (compiled) {
              const paramText = Object.values(params)
                .filter(v => typeof v === 'string')
                .join(' ');
              if (compiled.test(paramText)) return true;
            }
          }
          break;
      }
    }
    return false;
  }

  // ============================================================
  // 持久化
  // ============================================================

  private save(): void {
    if (!this.storagePath) return;
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data: WhitelistConfig = { rules: this.rules, lastUpdated: Date.now() };
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch { /* 静默 */ }
  }

  private load(): void {
    if (!this.storagePath) return;
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf-8');
        const data: WhitelistConfig = JSON.parse(raw);
        this.rules = data.rules ?? [];
        // 编译正则
        for (const r of this.rules) {
          if (r.type === 'pattern' && r.pattern) {
            try { this.compiledPatterns.set(r.id, new RegExp(r.pattern, 'i')); } catch {}
          }
        }
      }
    } catch { this.rules = []; }
  }

  /** 获取规则总数 */
  get size(): number {
    return this.rules.length;
  }
}
