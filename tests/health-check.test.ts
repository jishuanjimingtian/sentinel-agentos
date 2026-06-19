/**
 * Tests: 健康体检 (v1.4.1)
 *
 * 验证 healthCheck() 返回完整、正确的体检报告：
 *   - 返回结构符合 HealthCheckReport 类型
 *   - 各维度数据合理
 *   - 文本模式可读
 */

import { AgentOS } from '../src';

const TEST_SESSION = 'health-check-test';
const TEST_AGENT = 'health-agent';

describe('健康体检 (v1.4.1)', () => {
  let aos: AgentOS;

  beforeEach(() => {
    aos = new AgentOS({ workspaceRoot: process.cwd() });
  });

  // ==========================================
  // 基本结构
  // ==========================================

  it('healthCheck() 返回正确的结构', () => {
    const report = aos.healthCheck() as any;

    expect(report).toHaveProperty('timestamp');
    expect(report).toHaveProperty('healthScore');
    expect(report).toHaveProperty('healthTier');
    expect(report).toHaveProperty('quality');
    expect(report).toHaveProperty('audit');
    expect(report).toHaveProperty('credit');
    expect(report).toHaveProperty('memory');
    expect(report).toHaveProperty('rules');
    expect(report).toHaveProperty('activity');
  });

  it('healthScore 是 0-100 的数字', () => {
    const report = aos.healthCheck() as any;
    expect(typeof report.healthScore).toBe('number');
    expect(report.healthScore).toBeGreaterThanOrEqual(0);
    expect(report.healthScore).toBeLessThanOrEqual(100);
  });

  it('healthTier 是 healthy / warning / critical 之一', () => {
    const report = aos.healthCheck() as any;
    expect(['healthy', 'warning', 'critical']).toContain(report.healthTier);
  });

  it('timestamp 是有效的 ISO 时间', () => {
    const report = aos.healthCheck() as any;
    const ts = new Date(report.timestamp);
    expect(ts.getTime()).not.toBeNaN();
  });

  // ==========================================
  // quality 维度
  // ==========================================

  it('quality 包含 overallScore 和 breakdown', () => {
    const report = aos.healthCheck() as any;
    expect(report.quality).toHaveProperty('overallScore');
    expect(report.quality).toHaveProperty('breakdown');
    expect(report.quality).toHaveProperty('trends');
    expect(report.quality).toHaveProperty('warnings');
    expect(report.quality).toHaveProperty('strengths');
    expect(Array.isArray(report.quality.warnings)).toBe(true);
    expect(Array.isArray(report.quality.strengths)).toBe(true);
  });

  // ==========================================
  // audit 维度
  // ==========================================

  it('audit 包含总量、失败数、高风险数', () => {
    const report = aos.healthCheck() as any;
    expect(report.audit).toHaveProperty('totalOperations');
    expect(report.audit).toHaveProperty('verifyFailures');
    expect(report.audit).toHaveProperty('highRiskOps');
    expect(typeof report.audit.totalOperations).toBe('number');
  });

  // ==========================================
  // credit 维度
  // ==========================================

  it('credit 包含 agent 数、平均等级、分布', () => {
    const report = aos.healthCheck() as any;
    expect(report.credit).toHaveProperty('agents');
    expect(report.credit).toHaveProperty('averageLevel');
    expect(report.credit).toHaveProperty('distribution');

    // 分布应包含 L0-L3
    expect(report.credit.distribution).toHaveProperty('L0');
    expect(report.credit.distribution).toHaveProperty('L1');
    expect(report.credit.distribution).toHaveProperty('L2');
    expect(report.credit.distribution).toHaveProperty('L3');
  });

  it('有 agent 操作后 credit 分布更新', () => {
    // 使用唯一 agent 名称避免与其他测试残留冲突
    const uniqueSuffix = Date.now();
    aos.scoring.credit.setLevel(`hc-agent-L3-${uniqueSuffix}`, 3);
    aos.scoring.credit.setLevel(`hc-agent-L1-${uniqueSuffix}`, 1);

    const report = aos.healthCheck() as any;
    expect(report.credit.agents).toBeGreaterThanOrEqual(2);
    expect(report.credit.distribution.L3).toBeGreaterThanOrEqual(1);
    expect(report.credit.distribution.L1).toBeGreaterThanOrEqual(1);
  });

  // ==========================================
  // memory 维度
  // ==========================================

  it('memory 包含 working / episodic / semantic 数据', () => {
    const report = aos.healthCheck() as any;
    expect(report.memory).toHaveProperty('workingMessages');
    expect(report.memory).toHaveProperty('episodicEvents');
    expect(report.memory).toHaveProperty('semanticRules');
    expect(typeof report.memory.workingMessages).toBe('number');
    expect(typeof report.memory.episodicEvents).toBe('number');
  });

  // ==========================================
  // rules 维度
  // ==========================================

  it('rules 包含 guard 规则数', () => {
    const report = aos.healthCheck() as any;
    expect(report.rules).toHaveProperty('guardRules');
    expect(report.rules).toHaveProperty('active');
    expect(typeof report.rules.guardRules).toBe('number');
  });

  // ==========================================
  // activity 维度
  // ==========================================

  it('activity 包含 24h 操作数', () => {
    const report = aos.healthCheck() as any;
    expect(report.activity).toHaveProperty('recent24h');
    expect(typeof report.activity.recent24h).toBe('number');
  });

  // ==========================================
  // 文本模式
  // ==========================================

  it('healthCheck(true) 返回可读文本', () => {
    const text = aos.healthCheck(true) as string;
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(50);
    expect(text).toContain('Health Check');
    expect(text).toContain('Health Score');
  });

  it('文本模式包含各维度标签', () => {
    const text = aos.healthCheck(true) as string;
    expect(text).toContain('Quality');
    expect(text).toContain('Audit');
    expect(text).toContain('Credit');
    expect(text).toContain('Memory');
    expect(text).toContain('Guard');
    expect(text).toContain('Activity');
  });

  // ==========================================
  // 操作后的报告
  // ==========================================

  it('执行操作后 healthScore 应该合理', () => {
    // 做几次操作，产生数据
    for (let i = 0; i < 3; i++) {
      aos.completeExecution({
        sessionId: TEST_SESSION,
        agentId: TEST_AGENT,
        toolName: 'read',
        toolParameters: { path: 'test.txt' },
        toolResult: 'content',
        snapshot: { id: `snap_${i}`, toolCallId: `call_${i}`, timestamp: Date.now(), scope: 'file', fileHashes: {}, envVars: {}, gitHead: 'HEAD', gitDirty: false },
        startTime: Date.now() - 100,
        endTime: Date.now(),
        retryCount: 0,
        wasSelfCorrected: false,
        hadTimeout: false,
        userAccepted: true,
        userProvidedEdit: false,
        resultWasUsed: true,
      });
    }

    const report = aos.healthCheck() as any;

    // 有数据后相关字段不应是 0
    expect(report.audit.totalOperations).toBeGreaterThan(0);
    // quality 应有值
    expect(typeof report.quality.overallScore).toBe('number');
    // activity 应有操作数
    expect(report.activity.recent24h).toBeGreaterThan(0);
  });

  // ==========================================
  // 边角情况
  // ==========================================

  it('空状态报告不崩溃', () => {
    expect(() => aos.healthCheck()).not.toThrow();
    expect(() => aos.healthCheck(true)).not.toThrow();
  });
});
