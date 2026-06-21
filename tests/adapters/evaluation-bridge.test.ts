/**
 * Evaluation Bridge 娴嬭瘯
 */
import { WorkingMemory } from '../../src/memory/working';
import { EvaluationBridge, resetEvaluationBridge } from '../../src/adapters/evaluation-bridge';

describe('EvaluationBridge', () => {
  let bridge: EvaluationBridge;
  let wm: WorkingMemory;

  beforeEach(() => {
    wm = new WorkingMemory(50000);
    // 鍏堝～鍏呬竴浜涗笂涓嬫枃
    wm.addMessage('user', 'read projects/coderev/src/index.ts');
    wm.addOpenFile('projects/coderev/src/index.ts');
    wm.cacheToolResult('read_file', 'export class Main {}');

    bridge = new EvaluationBridge(wm, 'test-session');
  });

  afterEach(() => {
    resetEvaluationBridge();
  });

  it('should complete a full pre鈫抪ost evaluation cycle', () => {
    const opId = bridge.preExec('read', {
      path: 'projects/coderev/src/index.ts',
      limit: 50,
    });

    expect(opId).toContain('op_');

    bridge.postExec(opId, {
      verifyPassed: true,
      verifyChecks: 1,
      verifyFailures: 0,
      result: { content: 'export class Main {}' },
    });

    const profile = bridge.getProfile();
    expect(profile.totalOps).toBe(1);
    expect(profile.overallScore).toBeGreaterThanOrEqual(0);
    expect(profile.breakdown.preExec).toBeGreaterThan(0);
  });

  it('should detect low-quality parameters', () => {
    const opId = bridge.preExec('write', {
      path: 'somefile.txt',
      content: '',
    });

    bridge.postExec(opId);
    const profile = bridge.getProfile();
    // 绌哄唴瀹瑰簲璇ラ檷浣庤瘎鍒?    expect(profile.breakdown.preExec).toBeLessThanOrEqual(80);
  });

  it('should detect high-quality context-aware parameters', () => {
    const opId = bridge.preExec('read', {
      path: 'projects/coderev/src/index.ts',
      offset: 0,
      limit: 100,
    });

    bridge.postExec(opId, { verifyPassed: true });
    const profile = bridge.getProfile();
    // 璺緞鍖归厤鎵撳紑鐨勬枃浠?= 楂樿瘎鍒?    expect(profile.breakdown.preExec).toBeGreaterThan(50);
  });

  it('should penalize retries and timeouts', () => {
    const opId = bridge.preExec('exec', { command: 'npm test' });
    bridge.postExec(opId, {
      retryCount: 5,
      hadTimeout: true,
    });

    const profile = bridge.getProfile();
    expect(profile.breakdown.runtime).toBeLessThanOrEqual(50);
    // runtimeScore < 50 搴旇瑙﹀彂璀﹀憡
    console.log('WARNINGS:', JSON.stringify(profile.warnings));
    console.log('runtimeScore:', profile.breakdown.runtime);
    const hasRetryWarning = profile.warnings.some(w => w.includes('retry'));
    expect(hasRetryWarning).toBe(true);
    bridge.recordFeedback('user_used_result');
    bridge.recordFeedback('user_explicit_approval');

    const stats = bridge.getFeedbackStats();
    expect(stats.totalSignals).toBe(2);
    expect(stats.positiveSignals).toBe(2);

    const satisfaction = bridge.getSatisfaction();
    expect(satisfaction).toBeGreaterThan(0);
  });

  it('should generate readable report', () => {
    const opId = bridge.preExec('write', {
      path: 'test.ts',
      content: 'console.log("hello");',
    });
    bridge.postExec(opId, { verifyPassed: true });

    const report = bridge.generateReport();
    expect(report).toContain('/100');
    expect(report).toContain('/100');
  });

  it('should generate compact report', () => {
    const opId = bridge.preExec('exec', { command: 'npm test' });
    bridge.postExec(opId);

    const compact = bridge.generateCompactReport();
    expect(compact).toContain('/100');
  });

  it('should track tool accuracy', () => {
    // 涓ゆ鎴愬姛
    for (let i = 0; i < 2; i++) {
      const opId = bridge.preExec('read', { path: 'file.ts' });
      bridge.postExec(opId, { verifyPassed: true, result: 'ok' });
    }

    const acc = bridge.getToolAccuracy();
    expect(acc['read']).toBeDefined();
    expect(acc['read']!.calls).toBe(2);
  });

  it('should export state', () => {
    const opId = bridge.preExec('write', { path: 'test.ts', content: 'x' });
    bridge.postExec(opId, { verifyPassed: true });

    const state = bridge.exportState();
    expect((state as any).sessionId).toBe('test-session');
    expect((state as any).profile).toBeDefined();
  });
});
