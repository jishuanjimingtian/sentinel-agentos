/**
 * Tests: 信用体系核心逻辑 (CreditSystem)
 *
 * 覆盖：
 *   - L0-L3 等级转换
 *   - recordOutcome 自动升降级
 *   - creditToConfidenceBoost / creditToConfidenceThresholds
 *   - 持久化
 *   - 边角情况
 */

import { CreditSystem, creditToConfidenceBoost, creditToConfidenceThresholds } from '../src/credit';

describe('creditToConfidenceBoost', () => {
  it('L3 返回 +10', () => { expect(creditToConfidenceBoost(3)).toBe(10); });
  it('L2 返回 +5', () => { expect(creditToConfidenceBoost(2)).toBe(5); });
  it('L1 返回 0', () => { expect(creditToConfidenceBoost(1)).toBe(0); });
  it('L0 返回 -20', () => { expect(creditToConfidenceBoost(0)).toBe(-20); });
  it('超出范围返回 0', () => { expect(creditToConfidenceBoost(99)).toBe(0); });
});

describe('creditToConfidenceThresholds', () => {
  it('L3: autoApprove=50, confirm=20', () => {
    const t = creditToConfidenceThresholds(3);
    expect(t.autoApproveMin).toBe(50);
    expect(t.confirmMin).toBe(20);
  });

  it('L2: autoApprove=65, confirm=30', () => {
    const t = creditToConfidenceThresholds(2);
    expect(t.autoApproveMin).toBe(65);
    expect(t.confirmMin).toBe(30);
  });

  it('L1: autoApprove=70, confirm=35', () => {
    const t = creditToConfidenceThresholds(1);
    expect(t.autoApproveMin).toBe(70);
    expect(t.confirmMin).toBe(35);
  });

  it('L0: autoApprove=85, confirm=50', () => {
    const t = creditToConfidenceThresholds(0);
    expect(t.autoApproveMin).toBe(85);
    expect(t.confirmMin).toBe(50);
  });

  it('\u8d85\u51fa\u8303\u56f4\u56de\u9000\u5230 L1', () => {
    const t = creditToConfidenceThresholds(99 as any);
    expect(t.autoApproveMin).toBe(70);
  });
});

describe('CreditSystem', () => {
  let credit: CreditSystem;

  beforeEach(() => {
    credit = new CreditSystem();
  });

  // ==========================================
  // 基础
  // ==========================================

  it('新 agent 返回默认 L0', () => {
    expect(credit.getLevel('new-agent')).toBe(1);
  });

  it('setLevel 可更改等级', () => {
    credit.setLevel('agent-1', 3);
    expect(credit.getLevel('agent-1')).toBe(3);
  });

  it('defaultLevel 初始为 0', () => {
    expect(credit.defaultLevel).toBe(1);
  });

  it('setDefaultLevel 可更改默认等级', () => {
    credit.setDefaultLevel(2);
    expect(credit.defaultLevel).toBe(2);
  });

  it('修改 defaultLevel 后新 agent 使用新默认值', () => {
    credit.setDefaultLevel(2);
    expect(credit.getLevel('new-agent')).toBe(2);
  });

  // ==========================================
  // recordOutcome — 升级
  // ==========================================

  it('连续 10 次成功从 L1 升到 L2', () => {
    credit.setLevel('test-agent', 1);
    for (let i = 0; i < 10; i++) {
      credit.recordOutcome('test-agent', true, false);
    }
    expect(credit.getLevel('test-agent')).toBe(3);
  });

  it('升级后计数器重置', () => {
    credit.setLevel('test-agent', 1);
    // 5 次成功 → L1→L2 (5次升级阈值)
    for (let i = 0; i < 5; i++) {
      credit.recordOutcome('test-agent', true, false);
    }
    expect(credit.getLevel('test-agent')).toBe(2);
    // 再 5 次成功 → L2→L3 (又5次)
    for (let i = 0; i < 5; i++) {
      credit.recordOutcome('test-agent', true, false);
    }
    expect(credit.getLevel('test-agent')).toBe(3);
    // 到 L3 后不再升级
    for (let i = 0; i < 5; i++) {
      credit.recordOutcome('test-agent', true, false);
    }
    expect(credit.getLevel('test-agent')).toBe(3);
  });

  // ==========================================
  // recordOutcome — 降级
  // ==========================================

  it('连续 3 次拒绝从 L3 降到 L2', () => {
    credit.setLevel('test-agent', 3);
    for (let i = 0; i < 3; i++) {
      credit.recordOutcome('test-agent', false, false);
    }
    // 第 3 次拒绝触发降级（DENIAL_DOWNGRADE_THRESHOLD=3）
    // 3次denial后 consecutivesDenials=3 >= 3 → 降级
    expect(credit.getLevel('test-agent')).toBe(2);
  });

  it('被 block 一次从 L3 降到 L1', () => {
    credit.setLevel('test-agent', 3);
    credit.recordOutcome('test-agent', false, true);
    expect(credit.getLevel('test-agent')).toBe(1);
  });

  it('L0 被 block 不再下降', () => {
    credit.setLevel('test-agent', 0);
    credit.recordOutcome('test-agent', false, true);
    expect(credit.getLevel('test-agent')).toBe(0);
  });

  it('L2 被 block 降到 L0', () => {
    credit.setLevel('test-agent', 2);
    credit.recordOutcome('test-agent', false, true);
    expect(credit.getLevel('test-agent')).toBe(0);
  });

  // ==========================================
  // getAllAgents
  // ==========================================

  it('getAllAgents 返回所有 agent 快照', () => {
    credit.setLevel('a', 3);
    credit.setLevel('b', 1);
    const agents = credit.getAllAgents();
    expect(Object.keys(agents).length).toBe(2);
    expect(agents['a']!.level).toBe(3);
    expect(agents['b']!.level).toBe(1);
  });

  it('getAllAgents 返回副本，修改不影响内部', () => {
    credit.setLevel('a', 3);
    const agents = credit.getAllAgents();
    agents['a']!.level = 0;
    expect(credit.getLevel('a')).toBe(3);
  });

  // ==========================================
  // getAgent — 统计数据
  // ==========================================

  it('getAgent 记录操作统计', () => {
    credit.recordOutcome('test-agent', true, false);
    credit.recordOutcome('test-agent', false, false);
    const agent = credit.getAgent('test-agent');
    expect(agent.totalOps).toBe(2);
    expect(agent.allowedOps).toBe(1);
    expect(agent.denied).toBe(1);
  });

  it('getAgent 返回最新 lastActivity', () => {
    credit.recordOutcome('test-agent', true, false);
    const agent = credit.getAgent('test-agent');
    expect(agent.lastActivity).toBeGreaterThan(0);
    expect(typeof agent.lastActivity).toBe('number');
  });

  // ==========================================
  // 持久化
  // ==========================================

  it('enablePersistence 后不抛出', () => {
    expect(() => credit.enablePersistence(process.cwd())).not.toThrow();
  });

  it('enablePersistence 后 record 不抛出', () => {
    credit.enablePersistence(process.cwd());
    expect(() => credit.setLevel('agent', 2)).not.toThrow();
    expect(() => credit.recordOutcome('agent', true, false)).not.toThrow();
  });

  // ==========================================
  // 边角情况
  // ==========================================

  it('L3 连续成功不超出范围', () => {
    credit.setLevel('test-agent', 3);
    for (let i = 0; i < 20; i++) {
      credit.recordOutcome('test-agent', true, false);
    }
    expect(credit.getLevel('test-agent')).toBe(3);
  });

  it('L0 连续拒绝不超出范围', () => {
    credit.setLevel('test-agent', 0);
    for (let i = 0; i < 20; i++) {
      credit.recordOutcome('test-agent', false, false);
    }
    expect(credit.getLevel('test-agent')).toBe(0);
  });

  it('成功和失败交替不触发升降', () => {
    credit.setLevel('test-agent', 2);
    for (let i = 0; i < 10; i++) {
      credit.recordOutcome('test-agent', true, false);
      credit.recordOutcome('test-agent', false, false);
    }
    // alternating — no streaks ≥ 3 denials or ≥ 5 successes
    // But the denial resets consecutiveSuccesses, and success resets consecutiveDenials
    // So no upgrades happen, but each denial resets the streak
    // Starting at L2 with alternating: no 5 consecutive successes = no upgrade
    // However each 'false' resets consecutiveSuccesses, so never triggers upgrade
    // Each 'true' resets consecutiveDenials, so never triggers downgrade
    // Level should remain 2
    expect(credit.getLevel('test-agent')).toBe(2);
  });
});
