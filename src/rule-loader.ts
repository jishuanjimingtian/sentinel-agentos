/**
 * Rule Loader — 用户自定义规则加载 + 热加载
 *
 * 从 .agentos/rules.json 读取用户自定义的拦截规则，
 * 支持：自定义 DANGEROUS/WARNING/SENSITIVE/PROTECTED、
 * 禁用内置规则、覆盖风险等级（override-severity）。
 *
 * v1.2
 */

import * as fs from 'fs';
import * as path from 'path';

// ═══════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════

export interface UserRule {
  /** 规则键名，用于 disabled / override-severity 引用 */
  key: string;
  /** 正则模式 */
  pattern: string;
  /** 描述 */
  description: string;
  /** 标记为内置规则（不可删除，只能禁用） */
  builtin?: boolean;
}

export interface UserFilePattern {
  /** glob 模式 */
  pattern: string;
  /** 描述 */
  description?: string;
  /** 标记为内置 */
  builtin?: boolean;
}

export type Severity = 'dangerous' | 'warning' | 'sensitive' | 'protected';

export interface RulesConfig {
  /** 版本号 */
  version?: string;
  /** 自定义危险命令（追加到 DANGEROUS_COMMANDS） */
  dangerous?: UserRule[];
  /** 自定义警告命令（追加到 WARNING_COMMANDS） */
  warning?: UserRule[];
  /** 自定义敏感文件（追加到 SENSITIVE_PATTERNS） */
  sensitive?: UserFilePattern[];
  /** 自定义保护文件（追加到 PROTECTED_PATTERNS） */
  protected?: UserFilePattern[];
  /** 禁用的内置规则键名列表 */
  disabled?: string[];
  /** 规则优先级覆盖：warning→dangerous 或 dangerous→warning */
  overrideSeverity?: Record<string, Severity>;
  /** 文档注释（可忽略） */
  _comment?: string;
}

export interface LoadedRules {
  /** 合并后的危险命令 */
  dangerousCommands: Array<[RegExp, string, string]>;
  /** 合并后的警告命令 */
  warningCommands: Array<[RegExp, string, string]>;
  /** 合并后的敏感文件 patterns */
  sensitivePatterns: string[];
  /** 合并后的保护文件 patterns */
  protectedPatterns: string[];
  /** 被禁用的规则 key 集合 */
  disabledRules: Set<string>;
  /** 风险覆盖映射 */
  severityOverrides: Map<string, Severity>;
  /** 自定义规则总数 */
  userRuleCount: number;
  /** 被禁用的规则数 */
  disabledCount: number;
}

// ═══════════════════════════════════════
// 默认示例配置
// ═══════════════════════════════════════

export const DEFAULT_RULES_TEMPLATE: RulesConfig = {
  version: '1.0',
  _comment: 'Sentinel AgentOS 自定义规则配置 — 修改后 5 秒内自动生效',
  dangerous: [
    {
      key: 'custom-example-dangerous',
      pattern: 'rm\\s+-rf\\s+\\~',
      description: '自定义危险命令示例：删除用户目录',
    },
  ],
  warning: [
    {
      key: 'custom-example-warning',
      pattern: 'npm\\s+deprecate',
      description: '自定义警告命令示例：废弃 npm 包',
    },
  ],
  sensitive: [
    {
      pattern: '*.token',
      description: '自定义敏感文件：token 文件',
    },
  ],
  protected: [
    {
      pattern: 'nginx.conf',
      description: '自定义保护文件：nginx 配置',
    },
  ],
  disabled: [
    'custom-example-dangerous',
    'custom-example-warning',
  ],
  overrideSeverity: {
    'npm-publish': 'dangerous',
  },
};

// ═══════════════════════════════════════
// Rule Loader
// ═══════════════════════════════════════

export class RuleLoader {
  private configPath: string;
  private loadedRules: LoadedRules | null = null;
  private watcher: fs.FSWatcher | null = null;
  private onChangeCallbacks: Array<(rules: LoadedRules) => void> = [];
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(workspaceRoot: string) {
    this.configPath = path.join(workspaceRoot, '.agentos', 'rules.json');
  }

  /**
   * 加载 rules.json 并返回合并后的规则。
   * 格式错误时返回空规则（仅 warn，不阻止启动）。
   */
  load(): LoadedRules {
    let config: RulesConfig | null = null;

    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        config = JSON.parse(raw) as RulesConfig;
      }
    } catch (e: unknown) {
      console.warn(`[RuleLoader] rules.json 解析失败，使用默认规则: ${e instanceof Error ? e.message : String(e)}`);
      config = null;
    }

    const rules = this.buildRules(config);
    this.loadedRules = rules;
    return rules;
  }

  /**
   * 从配置构建合并后的规则集。
   */
  private buildRules(config: RulesConfig | null): LoadedRules {
    const dangerousCommands: Array<[RegExp, string, string]> = [];
    const warningCommands: Array<[RegExp, string, string]> = [];
    const sensitivePatterns: string[] = [];
    const protectedPatterns: string[] = [];
    const disabledRules = new Set<string>();
    const severityOverrides = new Map<string, Severity>();
    let userRuleCount = 0;
    let disabledCount = 0;

    if (config) {
      // 禁用列表
      if (config.disabled && Array.isArray(config.disabled)) {
        for (const key of config.disabled) {
          disabledRules.add(key);
          disabledCount++;
        }
      }

      // 优先级覆盖
      if (config.overrideSeverity) {
        for (const [key, severity] of Object.entries(config.overrideSeverity)) {
          if (severity === 'dangerous' || severity === 'warning') {
            severityOverrides.set(key, severity);
          }
        }
      }

      // 自定义危险命令
      if (config.dangerous && Array.isArray(config.dangerous)) {
        for (const rule of config.dangerous) {
          if (disabledRules.has(rule.key)) continue;
          try {
            dangerousCommands.push([new RegExp(rule.pattern, 'i'), rule.description, rule.key]);
            userRuleCount++;
          } catch {
            console.warn(`[RuleLoader] 无效正则: ${rule.pattern} (${rule.key})`);
          }
        }
      }

      // 自定义警告命令
      if (config.warning && Array.isArray(config.warning)) {
        for (const rule of config.warning) {
          if (disabledRules.has(rule.key)) continue;

          // 检查是否被覆盖为 dangerous
          if (severityOverrides.get(rule.key) === 'dangerous') {
            dangerousCommands.push([new RegExp(rule.pattern, 'i'), rule.description, rule.key]);
            userRuleCount++;
            continue;
          }

          try {
            warningCommands.push([new RegExp(rule.pattern, 'i'), rule.description, rule.key]);
            userRuleCount++;
          } catch {
            console.warn(`[RuleLoader] 无效正则: ${rule.pattern} (${rule.key})`);
          }
        }
      }

      // 自定义敏感文件
      if (config.sensitive && Array.isArray(config.sensitive)) {
        for (const ptn of config.sensitive) {
          if (disabledRules.has(ptn.pattern)) continue;
          sensitivePatterns.push(ptn.pattern);
          userRuleCount++;
        }
      }

      // 自定义保护文件
      if (config.protected && Array.isArray(config.protected)) {
        for (const ptn of config.protected) {
          if (disabledRules.has(ptn.pattern)) continue;
          protectedPatterns.push(ptn.pattern);
          userRuleCount++;
        }
      }
    }

    return {
      dangerousCommands,
      warningCommands,
      sensitivePatterns,
      protectedPatterns,
      disabledRules,
      severityOverrides,
      userRuleCount,
      disabledCount,
    };
  }

  /**
   * 获取当前加载的规则。
   */
  getRules(): LoadedRules {
    if (!this.loadedRules) {
      return this.load();
    }
    return this.loadedRules;
  }

  /**
   * 注册规则变更回调（热加载通知）。
   */
  onChange(callback: (rules: LoadedRules) => void): void {
    this.onChangeCallbacks.push(callback);
  }

  /**
   * 启动文件监听（热加载）。
   * rules.json 修改后 5 秒内重新加载。
   */
  startWatch(): void {
    // 确保目录存在
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ok */ }
    }

    try {
      this.watcher = fs.watch(this.configPath, (_eventType) => {
        // 防抖：5 秒内多次变更只加载一次
        if (this.reloadTimer) {
          clearTimeout(this.reloadTimer);
        }
        this.reloadTimer = setTimeout(() => {
          console.log('[RuleLoader] rules.json 已变更，重新加载...');
          const rules = this.load();
          for (const cb of this.onChangeCallbacks) {
            try { cb(rules); } catch { /* 回调异常不影响其他 */ }
          }
        }, 5000);
      });
      this.watcher.on('error', (err) => {
        console.warn(`[RuleLoader] 文件监听错误: ${err.message}`);
      });
      console.log(`[RuleLoader] 热加载已启动 → ${this.configPath}`);
    } catch (e: unknown) {
      console.warn(`[RuleLoader] 无法启动热加载: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * 停止文件监听。
   */
  stopWatch(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  /**
   * 生成示例 rules.json 到工作区。
   * 如果已存在则不覆盖。
   */
  static generateTemplate(workspaceRoot: string): string {
    const agentosDir = path.join(workspaceRoot, '.agentos');
    const configPath = path.join(agentosDir, 'rules.json');

    if (!fs.existsSync(agentosDir)) {
      fs.mkdirSync(agentosDir, { recursive: true });
    }

    if (fs.existsSync(configPath)) {
      return configPath; // 已存在，不覆盖
    }

    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_RULES_TEMPLATE, null, 2), 'utf-8');
    console.log(`[RuleLoader] 示例配置已生成 → ${configPath}`);
    return configPath;
  }
}
