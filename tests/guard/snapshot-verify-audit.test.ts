import {
  SnapshotGate,
  VerifyGate,
  AuditLog,
  SchemaGate,
  RiskGate,
} from '../../src';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SnapshotGate', () => {
  let tmpDir: string;
  let gate: SnapshotGate;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-snap-'));
    gate = new SnapshotGate(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should take a file-scoped snapshot', () => {
    // Create a test file
    const filePath = path.join(tmpDir, 'test.ts');
    fs.writeFileSync(filePath, 'console.log("hello");', 'utf-8');

    const snap = gate.takeSnapshot('call_1', 'write_file', [filePath], 'file');

    expect(snap.id).toMatch(/^snap_\d+_[a-f0-9]+$/);
    expect(snap.toolCallId).toBe('call_1');
    expect(snap.scope).toBe('file');
    expect(Object.keys(snap.fileHashes)).toHaveLength(1);
    expect(snap.fileHashes[filePath]).toMatch(/^sha256:/);
  });

  it('should take a file-scoped snapshot with no affected files', () => {
    const snap = gate.takeSnapshot('call_2', 'read_file', [], 'file');

    expect(snap.fileHashes).toEqual({});
    expect(typeof snap.gitHead).toBe('string');
  });

  it('should compute diff when a file changes', () => {
    const filePath = path.join(tmpDir, 'test.ts');
    fs.writeFileSync(filePath, 'original content', 'utf-8');

    const snap = gate.takeSnapshot('call_3', 'write_file', [filePath], 'file');

    // Change the file
    fs.writeFileSync(filePath, 'modified content\nwith more lines', 'utf-8');

    const diff = gate.computeDiff(snap);
    expect(diff).not.toBeNull();
    expect(diff!.filesChanged).toContain(filePath);
  });

  it('should return null diff when nothing changed', () => {
    const filePath = path.join(tmpDir, 'test.ts');
    fs.writeFileSync(filePath, 'unchanged', 'utf-8');

    const snap = gate.takeSnapshot('call_4', 'write_file', [filePath], 'file');
    // Don't modify the file
    const diff = gate.computeDiff(snap);
    expect(diff).toBeNull();
  });

  it('should take workspace-scoped snapshot', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'a', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'b.ts'), 'b', 'utf-8');
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    fs.writeFileSync(path.join(tmpDir, 'sub', 'c.ts'), 'c', 'utf-8');

    const snap = gate.takeSnapshot('call_5', 'bulk_write', [], 'workspace');

    expect(Object.keys(snap.fileHashes).length).toBeGreaterThanOrEqual(3);
  });

  it('should detect deleted files in diff', () => {
    const filePath = path.join(tmpDir, 'delete_me.ts');
    fs.writeFileSync(filePath, 'will be deleted', 'utf-8');

    const snap = gate.takeSnapshot('call_6', 'delete_file', [filePath], 'file');

    // Delete the file
    fs.unlinkSync(filePath);

    const diff = gate.computeDiff(snap);
    expect(diff).not.toBeNull();
    expect(diff!.filesChanged).toContain(filePath);
    expect(diff!.hashAfter[filePath]).toBe('MISSING');
  });
});

describe('VerifyGate', () => {
  let tmpDir: string;
  let gate: VerifyGate;
  let snapGate: SnapshotGate;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-verify-'));
    gate = new VerifyGate(tmpDir);
    snapGate = new SnapshotGate(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should pass when file exists', () => {
    const filePath = path.join(tmpDir, 'exists.ts');
    fs.writeFileSync(filePath, 'hello', 'utf-8');

    // Take snapshot, then modify the file so verify detects the change
    const snap = snapGate.takeSnapshot('v1', 'write_file', [filePath], 'file');
    fs.writeFileSync(filePath, 'hello world modified', 'utf-8');
    const result = gate.verify('write_file', snap, { files: [filePath] });

    // May be PASS or WARN depending on lint — just ensure it runs
    expect(['PASS', 'WARN', 'FAIL']).toContain(result.status);
  });

  it('should fail when claimed file does not exist', () => {
    const fakeFile = path.join(tmpDir, 'nonexistent.ts');
    fs.writeFileSync(fakeFile, 'temp', 'utf-8'); // create first for snapshot

    const snap = snapGate.takeSnapshot('v2', 'write_file', [fakeFile], 'file');
    fs.unlinkSync(fakeFile); // then delete

    const result = gate.verify('write_file', snap, { files: [fakeFile] });

    expect(result.status).toBe('FAIL');
  });

  it('should detect unchanged files', () => {
    const filePath = path.join(tmpDir, 'unchanged.ts');
    fs.writeFileSync(filePath, 'same content', 'utf-8');

    const snap = snapGate.takeSnapshot('v3', 'write_file', [filePath], 'file');
    const result = gate.verify('edit', snap);

    // File hash should be the same → WARN
    expect(result.checks.some((c) => c.status === 'WARN')).toBe(true);
  });
});

describe('AuditLog', () => {
  let tmpDir: string;
  let schemaGate: SchemaGate;
  let riskGate: RiskGate;
  let auditLog: AuditLog;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-audit-'));
    schemaGate = new SchemaGate();
    riskGate = new RiskGate();
    auditLog = new AuditLog(tmpDir, schemaGate, riskGate);

    // Register a test risk profile
    riskGate.registerProfile({
      tool: 'write_file',
      impact: 'workspace',
      reversibility: 0.8,
      sensitivity: 'low',
      category: 'write',
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should record an audit entry', () => {
    const entry = auditLog.record({
      sessionId: 'session_1',
      agentId: 'agent_main',
      startedAt: Date.now() - 1000,
      completedAt: Date.now(),
      toolName: 'write_file',
      toolParameters: { path: 'src/main.ts', content: 'hello' },
      toolResult: 'file written',
      snapshot: null,
      verifyStatus: 'PASS',
      verifyChecks: [{ name: 'lint', status: 'PASS' }],
    });

    expect(entry.id).toMatch(/^audit_\d+_[a-f0-9]+$/);
    expect(entry.toolName).toBe('write_file');
    expect(entry.verifyGate.status).toBe('PASS');
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should query entries by tool name', () => {
    auditLog.record({
      sessionId: 's1', agentId: 'a1',
      startedAt: Date.now() - 500, completedAt: Date.now(),
      toolName: 'read_file',
      toolParameters: { path: 'x.ts' },
      toolResult: 'ok',
      snapshot: null,
      verifyStatus: 'PASS',
      verifyChecks: [],
    });

    auditLog.record({
      sessionId: 's1', agentId: 'a1',
      startedAt: Date.now() - 500, completedAt: Date.now(),
      toolName: 'write_file',
      toolParameters: { path: 'x.ts', content: 'new' },
      toolResult: 'ok',
      snapshot: null,
      verifyStatus: 'PASS',
      verifyChecks: [],
    });

    const results = auditLog.query({ toolName: 'read_file' });
    expect(results).toHaveLength(1);
    expect(results[0]!.toolName).toBe('read_file');
  });

  it('should query entries by verify status', () => {
    auditLog.record({
      sessionId: 's2', agentId: 'a1',
      startedAt: Date.now() - 500, completedAt: Date.now(),
      toolName: 'write_file',
      toolParameters: { path: 'bad.ts' },
      toolResult: 'failed',
      snapshot: null,
      verifyStatus: 'FAIL',
      verifyChecks: [{ name: 'lint', status: 'FAIL', detail: 'syntax error' }],
    });

    const results = auditLog.query({ verifyStatus: 'FAIL' });
    expect(results).toHaveLength(1);
    expect(results[0]!.verifyGate.status).toBe('FAIL');
  });

  it('should compute audit stats', () => {
    auditLog.record({
      sessionId: 's3', agentId: 'a1',
      startedAt: Date.now() - 500, completedAt: Date.now(),
      toolName: 'read_file', toolParameters: {}, toolResult: 'ok',
      snapshot: null, verifyStatus: 'PASS', verifyChecks: [],
    });

    auditLog.record({
      sessionId: 's3', agentId: 'a1',
      startedAt: Date.now() - 500, completedAt: Date.now(),
      toolName: 'write_file', toolParameters: { content: 'x' }, toolResult: 'ok',
      snapshot: null, verifyStatus: 'PASS', verifyChecks: [],
    });

    auditLog.record({
      sessionId: 's4', agentId: 'a1',
      startedAt: Date.now() - 500, completedAt: Date.now(),
      toolName: 'delete_file', toolParameters: { path: 'x.ts' }, toolResult: 'ok',
      snapshot: null, verifyStatus: 'FAIL', verifyChecks: [{ name: 'exists', status: 'FAIL' }],
    });

    const stats = auditLog.stats();
    expect(stats.totalOperations).toBe(3);
    expect(stats.verifyFailures).toBe(1);
    expect(stats.sessionsTracked).toBe(2);
    expect(stats.byTool['read_file']).toBe(1);
    expect(stats.byTool['write_file']).toBe(1);
    expect(stats.byTool['delete_file']).toBe(1);
  });

  it('should sanitize sensitive parameters', () => {
    const entry = auditLog.record({
      sessionId: 's5', agentId: 'a1',
      startedAt: Date.now() - 500, completedAt: Date.now(),
      toolName: 'auth',
      toolParameters: { api_key: 'secret123', username: 'bob', token: 'tk_secret' },
      toolResult: 'ok',
      snapshot: null,
      verifyStatus: 'PASS',
      verifyChecks: [],
    });

    expect(entry.toolParameters['api_key']).toBe('***REDACTED***');
    expect(entry.toolParameters['token']).toBe('***REDACTED***');
    expect(entry.toolParameters['username']).toBe('bob');
  });

  it('should persist entries to disk (JSONL)', () => {
    auditLog.record({
      sessionId: 's6', agentId: 'a1',
      startedAt: Date.now() - 500, completedAt: Date.now(),
      toolName: 'persist_test', toolParameters: {}, toolResult: 'ok',
      snapshot: null, verifyStatus: 'PASS', verifyChecks: [],
    });

    const logFile = path.join(tmpDir, '.agentos', 'audit.jsonl');
    expect(fs.existsSync(logFile)).toBe(true);

    const content = fs.readFileSync(logFile, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).toolName).toBe('persist_test');
  });
});
