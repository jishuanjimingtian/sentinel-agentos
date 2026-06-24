/**
 * Credit System 鈥?淇＄敤绛夌骇妯″潡
 *
 * 鍥涚骇淇＄敤浣撶郴锛?
 *   L3 瀹屽叏淇′换
 *   L2 楂樺害淇′换
 *   L1 鍩烘湰淇′换
 *   L0 涓嶄俊浠?
 *
 * 淇＄敤鍗囬檷鑷姩鏍规嵁琛屼负璋冩暣銆?
 */

import * as fs from 'fs';
import * as path from 'path';

export type CreditLevel = 0 | 1 | 2 | 3;

export interface AgentCredit {
  level: CreditLevel;
  totalOps: number;
  denied: number;
  allowedOps: number;
  lastActivity: number;
  consecutiveSuccesses: number;
  consecutiveDenials: number;
}

export interface CreditConfig {
  agents: Record<string, AgentCredit>;
  defaultLevel: CreditLevel;
  lastUpdated: number;
}

const SUCCESS_UPGRADE_THRESHOLD = 5;     // 从 10 降到 5：更快升级
const DENIAL_DOWNGRADE_THRESHOLD = 3;
const INACTIVITY_DOWNGRADE_DAYS = 30;

function clampLevel(value: number): CreditLevel {
  if (value <= 0) return 0;
  if (value >= 3) return 3;
  return value as CreditLevel;
}

export function creditToConfidenceBoost(level: number): number {
  switch (level) {
    case 3: return 10;
    case 2: return 5;
    case 1: return 0;
    case 0: return -20;
    default: return 0;
  }
}

export function creditToConfidenceThresholds(level: CreditLevel): {
  autoApproveMin: number;
  confirmMin: number;
} {
  switch (level) {
    case 3: return { autoApproveMin: 50, confirmMin: 20 };  // L3: 大幅放宽，真信任
    case 2: return { autoApproveMin: 65, confirmMin: 30 };  // L2: 合理放宽
    case 1: return { autoApproveMin: 70, confirmMin: 35 };  // L1: 2026-06-24 降 5 点解决默认弹窗
    case 0: return { autoApproveMin: 85, confirmMin: 50 };  // L0: 可疑用户，但还是有机会自动批准
    default: return { autoApproveMin: 70, confirmMin: 35 }; // 默认走 L1 2026-06-24
  }
}

export class CreditSystem {
  private config: CreditConfig;
  private storagePath?: string;

  constructor() {
    this.config = {
      agents: {},
      defaultLevel: 1,  // 🔧 默认从 L1 开始，给用户基本信任
      lastUpdated: Date.now(),
    };
  }

  enablePersistence(workspaceRoot: string): void {
    this.storagePath = path.join(workspaceRoot, '.agentos', 'credit.json');
    this.load();
  }

  getAgent(agentId: string): AgentCredit {
    if (!this.config.agents[agentId]) {
      this.config.agents[agentId] = {
        level: this.config.defaultLevel,
        totalOps: 0,
        denied: 0,
        allowedOps: 0,
        lastActivity: 0,
        consecutiveSuccesses: 0,
        consecutiveDenials: 0,
      };
    }
    return this.config.agents[agentId]!;
  }

  recordOutcome(agentId: string, allowed: boolean, wasBlocked: boolean): void {
    const agent = this.getAgent(agentId);
    agent.totalOps++;
    agent.lastActivity = Date.now();

    if (allowed) {
      agent.allowedOps++;
      agent.consecutiveSuccesses++;
      agent.consecutiveDenials = 0;

      if (agent.consecutiveSuccesses >= SUCCESS_UPGRADE_THRESHOLD && agent.level < 3) {
        agent.level = clampLevel(agent.level + 1);
        agent.consecutiveSuccesses = 0;
      }
    } else {
      agent.denied++;
      agent.consecutiveDenials++;
      agent.consecutiveSuccesses = 0;

      if (agent.consecutiveDenials >= DENIAL_DOWNGRADE_THRESHOLD && agent.level > 0) {
        agent.level = clampLevel(agent.level - 1);
        agent.consecutiveDenials = 0;
      }
    }

    if (wasBlocked) {
      agent.level = clampLevel(agent.level - 2);
      agent.consecutiveDenials = 0;
    }

    this.save();
  }

  applyInactivityDecay(): void {
    const cutoff = Date.now() - INACTIVITY_DOWNGRADE_DAYS * 24 * 60 * 60 * 1000;
    let changed = false;

    for (const agentId of Object.keys(this.config.agents)) {
      const agent = this.config.agents[agentId]!;
      if (agent.lastActivity > 0 && agent.lastActivity < cutoff && agent.level > 0) {
        agent.level = clampLevel(agent.level - 1);
        changed = true;
      }
    }

    if (changed) this.save();
  }

  getLevel(agentId: string): CreditLevel {
    return this.getAgent(agentId).level;
  }

  setLevel(agentId: string, level: CreditLevel): void {
    this.getAgent(agentId).level = level;
    this.save();
  }

  get defaultLevel(): CreditLevel {
    return this.config.defaultLevel;
  }

  setDefaultLevel(level: CreditLevel): void {
    this.config.defaultLevel = level;
    this.save();
  }

  getAllAgents(): Record<string, AgentCredit> {
    const copy: Record<string, AgentCredit> = {};
    for (const [id, agent] of Object.entries(this.config.agents)) {
      copy[id] = { ...agent };
    }
    return copy;
  }

  private save(): void {
    if (!this.storagePath) return;
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.config.lastUpdated = Date.now();
      fs.writeFileSync(this.storagePath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch {
      // non-critical
    }
  }

  private load(): void {
    if (!this.storagePath) return;
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf-8');
        this.config = JSON.parse(raw);
      }
    } catch {
      this.config.agents = {};
    }
  }
}
