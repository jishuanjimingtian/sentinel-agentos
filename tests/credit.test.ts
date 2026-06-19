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
  it('L3: autoApprove=60, confirm=25', () => {
    const t = creditToConfidenceThresholds(3);
    expect(t.autoApproveMin).toBe(60);
    expect(t.confirmMin).toBe(25);
  });

  it('L2: autoApprove=80, confirm=40', () => {
    const t = creditToConfidenceThresholds(2);
    expect(t.autoApproveMin).toBe(80);
    expect(t.confirmMin).toBe(40);
  });

  it('L1: autoApprove=90, confirm=50', () => {
    const t = creditToConfidenceThresholds(1);
    expect(t.autoApproveMin).toBe(90);
    expect(t.confirmMin).toBe(50);
  });

  it('L0: autoApprove=101 (永不), confirm=60', () => {
    const t = creditToConfidenceThresholds(0);
    expect(t.autoApproveMin).toBe(101);
    expect(t.confirmMin).toBe(60);
  });

  it('超出范围回退到 L1', () => {
    const t = creditToConfidenceThresholds(99 as any);
    expect(t.autoApproveMin).toBe(90);
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
    expect(credit.getLevel('new-agent')).toBe(0);
  });

  it('setLevel 可更改等级', () => {
    credit.setLevel('agent-1', 3);
    expect(credit.getLevel('agent-1')).toBe(3);
  });

  it('defaultLevel 初始为 0', () => {
    expect(credit.defaultLevel).toBe(0);
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
    expect(credit.getLevel('test-agent')).toBe(2);
  });

  it('升级后计数器重置', () => {
    credit.setLevel('test-agent', 1);
    // 9 次成功 — 还不够
    for (let i = 0; i < 9; i++) {
      credit.recordOutcome('test-agent', true, false);
    }
    expect(credit.getLevel('test-agent')).toBe(1);
    // 第 10 次
    credit.recordOutcome('test-agent', true, false);
    expect(credit.getLevel('test-agent')).toBe(2);
    // 再连续 10 次升级到 L3
    for (let i = 0; i < 10; i++) {
      credit.recordOutcome('test-agent', true, false);
    }
    expect(credit.getLevel('test-agent')).toBe(3);
  });

  // ==========================================
  // recordOutcome — 降级
  // ==========================================

  it('连续 3 次拒绝从 L2 降到 L1', () => {
    credit.setLevel('test-agent', 2);
    for (let i = 0; i < 3; i++) {
      credit.recordOutcome('test-agent', false, false);
    }
    expect(credit.getLevel('test-agent')).toBe(1);
  });

  it('被 block 一次直接降 2 级', () => {
    credit.setLevel('test-agent', 3);
    credit.recordOutcome('test-agent', false, true);
    expect(credit.getLevel('test-agent')).toBe(1);
  });

  it('L0 被 block 不再下降', () => {
    credit.setLevel('test-agent', 0);
    credit.recordOutcome('test-agent', false, true);
    expect(credit.getLevel('test-agent')).toBe(0);
  });

  it('L3 被 block 降到 L1', () => {
    credit.setLevel('test-agent', 3);
    credit.recordOutcome('test-agent', false, true);
    expect(credit.getLevel('test-agent')).toBe(1);
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
    // alternating — no streaks ≥ 3 denials or ≥ 10 successes
    expect(credit.getLevel('test-agent')).toBe(2);
  });
});
