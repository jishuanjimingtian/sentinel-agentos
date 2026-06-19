/**
 * Tests: AgentOS core
 *
 * 验证核心类的初始化和基本配置。
 */

import { AgentOS } from '../src';

describe('AgentOS', () => {
  it('should initialize with default config', () => {
    const aos = new AgentOS();
    expect(aos.getConfig()).toBeDefined();
    expect(typeof aos.getConfig().workspaceRoot).toBe('string');
  });

  it('should initialize with partial config', () => {
    const aos = new AgentOS({
      workspaceRoot: '/test/workspace',
      maxWorkingTokens: 10000,
      maxEpisodicSizeKb: 100,
    });
    expect(aos.getConfig().workspaceRoot).toBe('/test/workspace');
    expect(aos.getConfig().maxWorkingTokens).toBe(10000);
    expect(aos.getConfig().maxEpisodicSizeKb).toBe(100);
  });

  it('should return readonly config', () => {
    const aos = new AgentOS({ workspaceRoot: '/test' });
    const config = aos.getConfig();
    expect(config.workspaceRoot).toBe('/test');
  });

  it('should expose all sub-layers', () => {
    const aos = new AgentOS();
    expect(aos.memory).toBeDefined();
    expect(aos.memory.working).toBeDefined();
    expect(aos.memory.episodic).toBeDefined();
    expect(aos.memory.semantic).toBeDefined();
    expect(aos.guard).toBeDefined();
    expect(aos.evaluator).toBeDefined();
    expect(aos.scoring).toBeDefined();
    expect(aos.scoring.behavior).toBeDefined();
    expect(aos.scoring.credit).toBeDefined();
  });

  it('should run pipeline without crashing', () => {
    const aos = new AgentOS();
    const result = aos.executePipeline({
      sessionId: 'test',
      agentId: 'test-agent',
      toolName: 'read',
      parameters: { path: 'test.txt' },
    });
    expect(result).toHaveProperty('preExec');
    expect(result).toHaveProperty('snapshot');
    expect(result).toHaveProperty('profile');
  });

  it('should complete execution without crashing', () => {
    const aos = new AgentOS();
    const result = aos.completeExecution({
      sessionId: 'test',
      agentId: 'test-agent',
      toolName: 'read',
      toolParameters: { path: 'test.txt' },
      toolResult: 'content',
      snapshot: { id: 'snap_1', toolCallId: 'call_1', timestamp: Date.now(), scope: 'file' as const, fileHashes: {}, envVars: {}, gitHead: 'HEAD', gitDirty: false },
      startTime: Date.now() - 100,
      endTime: Date.now(),
      retryCount: 0,
      wasSelfCorrected: false,
      hadTimeout: false,
      userAccepted: true,
      userProvidedEdit: false,
      resultWasUsed: true,
    });
    expect(result).toHaveProperty('runtime');
    expect(result).toHaveProperty('postExec');
    expect(result).toHaveProperty('auditEntry');
    expect(result).toHaveProperty('profile');
  });

  it('computeConfidence returns valid result', () => {
    const aos = new AgentOS();
    const result = aos.computeConfidence(
      'read',
      { path: 'test.txt' },
      { score: 0.5 },
      'Read the test file',
    );
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('decision');
    expect(typeof result.confidence).toBe('number');
    expect(['auto-approve', 'confirm', 'block']).toContain(result.decision);
  });

  it('statusReport returns a string', () => {
    const aos = new AgentOS();
    const report = aos.statusReport();
    expect(typeof report).toBe('string');
    expect(report.length).toBeGreaterThan(10);
  });

  it('endSession does not throw', () => {
    const aos = new AgentOS();
    expect(() => aos.endSession('test-session')).not.toThrow();
  });
});
