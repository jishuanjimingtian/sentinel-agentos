import { AgentOS } from '../src';

describe('AgentOS', () => {
  it('should initialize with config', () => {
    const aos = new AgentOS({
      workspaceRoot: '/tmp/test',
      maxWorkingTokens: 50000,
      maxEpisodicSizeKb: 500,
      guardConfig: {
        riskGate: {
          autoApprove: 0.5,
          notify: 1.0,
          confirm: 3.0,
          deny: 8.0,
        },
      },
    });

    expect(aos.getConfig().workspaceRoot).toBe('/tmp/test');
    expect(aos.getConfig().guardConfig?.riskGate?.deny).toBe(8.0);
    expect(aos.getConfig().maxWorkingTokens).toBe(50000);
  });

  it('should initialize with defaults', () => {
    const aos = new AgentOS();
    const config = aos.getConfig();
    expect(config.workspaceRoot).toBe(process.cwd());
    expect(config.maxWorkingTokens).toBe(50000);
  });

  it('should expose all layers', () => {
    const aos = new AgentOS();
    // Memory layer
    expect(aos.memory.working).toBeDefined();
    expect(aos.memory.episodic).toBeDefined();
    expect(aos.memory.semantic).toBeDefined();
    // Guard layer
    expect(aos.guard.schema).toBeDefined();
    expect(aos.guard.risk).toBeDefined();
    expect(aos.guard.snapshot).toBeDefined();
    expect(aos.guard.verify).toBeDefined();
    expect(aos.guard.audit).toBeDefined();
    // Evaluator layer
    expect(aos.evaluator.preExec).toBeDefined();
    expect(aos.evaluator.runtime).toBeDefined();
    expect(aos.evaluator.postExec).toBeDefined();
    expect(aos.evaluator.feedback).toBeDefined();
    expect(aos.evaluator.profiler).toBeDefined();
  });

  it('should execute pipeline and return pre-exec metrics', () => {
    const aos = new AgentOS();
    const result = aos.executePipeline({
      sessionId: 's1',
      agentId: 'a1',
      toolName: 'read_file',
      parameters: { path: 'src/main.ts' },
      affectedFiles: ['src/main.ts'],
    });

    expect(result.preExec).toBeDefined();
    expect(result.preExec.paramQuality.score).toBeGreaterThanOrEqual(0);
    expect(result.snapshot).toBeDefined();
    expect(result.profile).toBeDefined();
  });

  it('should complete execution and return full metrics', () => {
    const aos = new AgentOS();
    const pre = aos.executePipeline({
      sessionId: 's2',
      agentId: 'a2',
      toolName: 'write_file',
      parameters: { path: 'test.txt', content: 'hello' },
      affectedFiles: ['test.txt'],
    });

    const result = aos.completeExecution({
      sessionId: 's2',
      agentId: 'a2',
      toolName: 'write_file',
      toolParameters: { path: 'test.txt', content: 'hello' },
      toolResult: 'ok',
      snapshot: pre.snapshot,
      startTime: Date.now() - 100,
      endTime: Date.now(),
      retryCount: 0,
      wasSelfCorrected: false,
      hadTimeout: false,
      userAccepted: true,
      userProvidedEdit: false,
      resultWasUsed: true,
    });

    expect(result.runtime).toBeDefined();
    expect(result.postExec).toBeDefined();
    expect(result.auditEntry).toBeDefined();
    expect(result.auditEntry.toolName).toBe('write_file');
    expect(result.profile).toBeDefined();
  });

  it('should record implicit feedback', () => {
    const aos = new AgentOS();
    aos.recordFeedback('user_immediate_continue', 's3', 'op_1');

    const stats = aos.evaluator.feedback.stats();
    expect(stats.totalSignals).toBeGreaterThanOrEqual(1);
    expect(stats.positiveSignals).toBeGreaterThanOrEqual(1);
  });

  it('should inject memory context', () => {
    const aos = new AgentOS();
    aos.memory.semantic.setPreference('language', 'zh-CN');
    aos.memory.semantic.addFact('User is in Shanghai');

    const context = aos.injectContext();
    expect(context).toContain('Shanghai');
  });

  it('should end session and clear working memory', () => {
    const aos = new AgentOS();
    aos.memory.working.addMessage('user', 'hello');
    aos.memory.working.setTask({ description: 'test', steps: [] });

    expect(aos.memory.working.recentMessages.length).toBeGreaterThan(0);

    aos.endSession('s4');

    expect(aos.memory.working.recentMessages).toHaveLength(0);
    expect(aos.memory.working.currentTask).toBeUndefined();
  });

  it('should generate status report', () => {
    const aos = new AgentOS();
    const report = aos.statusReport();

    expect(report).toContain('AgentOS Status Report');
    expect(report).toContain('Quality Score');
    expect(report).toContain('Breakdown');
    expect(report).toContain('Audit');
  });

  it('should get audit stats', () => {
    const aos = new AgentOS();
    const stats = aos.getAuditStats();
    expect(stats.totalOperations).toBeGreaterThanOrEqual(0);
  });

  it('should get agent profile', () => {
    const aos = new AgentOS();
    const profile = aos.getProfile();
    expect(profile.overallScore).toBeGreaterThanOrEqual(0);
    expect(profile.totalOps).toBeGreaterThanOrEqual(0);
    expect(profile.warnings).toBeDefined();
    expect(profile.strengths).toBeDefined();
  });
});
