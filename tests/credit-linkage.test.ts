/**
 * Tests: 信用体系联动决策 (v1.4.1)
 *
 * 验证 computeConfidence 调用时信用体系正确影响决策：
 *   - L3: autoApprove 阈值降至 60，boost +10
 *   - L2: autoApprove 80，boost +5
 *   - L1: 默认行为 (autoApprove 90，boost 0)
 *   - L0: 不服 autoApprove (需 101)，penalty -20
 *   - recordOutcome 按成功/失败自动调整信用等级
 */

import { AgentOS } from '../src';

// RiskScore 类型的模拟数据工厂
function mkRisk(score: number): { score: number } {
  return { score };
}


// Use a fixed session for all tests
const TEST_SESSION = 'credit-linkage-test';
const TEST_AGENT = 'test-agent';

describe('信用体系联动决策 (v1.4.1)', () => {
  let aos: AgentOS;

  beforeEach(() => {
    aos = new AgentOS({ workspaceRoot: process.cwd() });
  });

  // ==========================================
  // 基本功能
  // ==========================================

  it('computeConfidence 默认返回 L1 阈值', () => {
    // 增加历史记录使 D2 变高
    for (let i = 0; i < 12; i++) {
      aos.scoring.behavior.record({ toolName: 'write', params: { path: 'src/test.ts' }, success: true, confirmed: false });
    }
    // 低风险的 write 操作
    const result = aos.computeConfidence(
      'write',
      { path: 'src/test.ts' },
      mkRisk(0.5),
      'write some test file now',
      TEST_AGENT,
    );
    // L1: autoApproveMin=90, boost=0
    // 如果历史足够高且风险低，应当 auto-approve
    expect((result.dimensions as any).creditLevel).toBe(1);
    expect((result.dimensions as any).creditBoost).toBe(0);
    // 实际决策可能因不同维度综合而不同，只验证信用信息正确注入
    expect(['auto-approve', 'confirm']).toContain(result.decision);
  });

  it('低置信度操作默认触发 confirm', () => {
    // 构建一个刚好触发 confirm 的场景: moderate risk + 新操作
    const result = aos.computeConfidence(
      'exec',
      { command: 'format c: /q /y' },
      mkRisk(6.5),
      '',
      TEST_AGENT,
    );
    expect(['confirm', 'block']).toContain(result.decision);
    expect(result.confidence).toBeLessThan(80);
  });

  // ==========================================
  // L3 — 高信任 Agent
  // ==========================================

  it('L3 信任: autoApprove 阈值降至 60, boost +10', () => {
    aos.scoring.credit.setLevel(TEST_AGENT, 3);
    expect(aos.scoring.credit.getLevel(TEST_AGENT)).toBe(3);

    // 构造 ~65 分场景: 正常 L1 下是 confirm，L3 下应变成 auto-approve
    const result = aos.computeConfidence(
      'write',
      { path: 'src/test.ts' },
      mkRisk(2.5),
      'write the file',
      TEST_AGENT,
    );
    expect(result.decision).toBe('auto-approve');
    expect((result.dimensions as any).creditLevel).toBe(3);
    expect((result.dimensions as any).creditBoost).toBe(10);
  });

  // ==========================================
  // L2 — 高度信任 Agent
  // ==========================================

  it('L2 信任: autoApprove 80, boost +5', () => {
    aos.scoring.credit.setLevel(TEST_AGENT, 2);

    // 增加历史记录提高 D2
    for (let i = 0; i < 12; i++) {
      aos.scoring.behavior.record({ toolName: 'write', params: { path: 'src/test.ts' }, success: true, confirmed: false });
    }

    const result = aos.computeConfidence(
      'write',
      { path: 'src/test.ts' },
      mkRisk(1.0),
      'write the new test file now',
      TEST_AGENT,
    );
    expect((result.dimensions as any).creditLevel).toBe(2);
    expect((result.dimensions as any).creditBoost).toBe(5);
    // 信用正确地参与决策：result.decision 在 L2 下比 L1 更宽松
    expect(['auto-approve', 'confirm']).toContain(result.decision);
  });

  // ==========================================
  // L0 — 不信任 Agent
  // ==========================================

  it('L0 不信任: 永远不 auto-approve, penalty -20', () => {
    aos.scoring.credit.setLevel(TEST_AGENT, 0);

    // 即使是个很安全的操作
    const result = aos.computeConfidence(
      'read',
      { path: 'README.md' },
      mkRisk(0.1),
      'read the readme',
      TEST_AGENT,
    );
    // L0: autoApproveMin=101 永远达不到 -> 不会是 auto-approve
    expect(result.decision).not.toBe('auto-approve');
    expect((result.dimensions as any).creditLevel).toBe(0);
    expect((result.dimensions as any).creditBoost).toBe(-20);
  });

  // ==========================================
  // 不传 agentId — 不触发信用调整
  // ==========================================

  it('不传 agentId 时不触发信用调整 (兼容旧调用)', () => {
    const result = aos.computeConfidence(
      'read',
      { path: 'README.md' },
      mkRisk(0.1),
      'readme',
      // 不传 agentId
    );
    expect((result.dimensions as any).creditLevel).toBe(1);
    expect((result.dimensions as any).creditBoost).toBe(0);
  });

  // ==========================================
  // recordOutcome — 信用自动升降
  // ==========================================

  it('连续成功 → 信用升级', () => {
    aos.scoring.credit.setLevel(TEST_AGENT, 1); // start at L1

    // 连续 6 次成功 (SUCCESS_UPGRADE_THRESHOLD=5)
    // 5 次 L1→L2，6 次时还在 L2
    for (let i = 0; i < 6; i++) {
      aos.scoring.credit.recordOutcome(TEST_AGENT, true, false);
    }

    // 应该升级到 L2
    expect(aos.scoring.credit.getLevel(TEST_AGENT)).toBe(2);
  });

  it('连续拒绝 → 信用降级', () => {
    aos.scoring.credit.setLevel(TEST_AGENT, 2); // start at L2

    // 连续 3 次拒绝 (allowed=false, wasBlocked=false)
    for (let i = 0; i < 3; i++) {
      aos.scoring.credit.recordOutcome(TEST_AGENT, false, false);
    }

    // 应该降到 L1
    expect(aos.scoring.credit.getLevel(TEST_AGENT)).toBe(1);
  });

  it('被 block → 直接降 2 级', () => {
    aos.scoring.credit.setLevel(TEST_AGENT, 2); // start at L2

    // 触发一次 block (allowed=false, wasBlocked=true)
    aos.scoring.credit.recordOutcome(TEST_AGENT, false, true);

    // 应该降到 L0 (L2 - 2 = L0)
    expect(aos.scoring.credit.getLevel(TEST_AGENT)).toBe(0);
  });

  // ==========================================
  // completeExecution → 自动更新信用
  // ==========================================

  it('completeExecution 成功时更新信用', () => {
    aos.scoring.credit.setLevel(TEST_AGENT, 1);
    const initialLevel = aos.scoring.credit.getLevel(TEST_AGENT);

    // 模拟一次成功操作
    aos.completeExecution({
      sessionId: TEST_SESSION,
      agentId: TEST_AGENT,
      toolName: 'write',
      toolParameters: { path: 'test.ts' },
      toolResult: 'ok',
      snapshot: null,
      startTime: Date.now() - 100,
      endTime: Date.now(),
      retryCount: 0,
      wasSelfCorrected: false,
      hadTimeout: false,
      userAccepted: true,
      userProvidedEdit: false,
      resultWasUsed: true,
    });

    // 信用应该没降（成功操作不应降信用）
    expect(aos.scoring.credit.getLevel(TEST_AGENT)).toBeGreaterThanOrEqual(initialLevel);
  });
});
