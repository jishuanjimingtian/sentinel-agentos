/**
 * Tests: 行为追踪模型 (BehaviorModel)
 *
 * 覆盖：
 *   - 记录行为
 *   - 获取三阶匹配统计
 *   - 频率统计
 *   - 持久化
 *   - 边界情况
 */

import { BehaviorModel } from '../src/behavior-model';

describe('BehaviorModel', () => {
  let model: BehaviorModel;

  beforeEach(() => {
    model = new BehaviorModel();
  });

  // ==========================================
  // record
  // ==========================================

  it('应成功记录一次行为', () => {
    expect(() => model.record({ toolName: 'write', params: { path: 'test.ts' }, success: true, confirmed: false })).not.toThrow();
  });

  it('多次记录生成不同的条目', () => {
    model.record({ toolName: 'exec', params: { command: 'npm test' }, success: true, confirmed: false });
    model.record({ toolName: 'exec', params: { command: 'npm test' }, success: false, confirmed: false });
    const all = model.getAllEntries();
    expect(all.length).toBe(2);
    expect(all[0]!.timestamp).toBeLessThanOrEqual(all[1]!.timestamp);
  });

  // ==========================================
  // getStats — 三阶匹配
  // ==========================================

  it('无历史时三阶计数均为 0', () => {
    const stats = model.getStats('write', { path: 'test.ts' });
    expect(stats.exactMatchCount).toBe(0);
    expect(stats.sameToolCount).toBe(0);
    expect(stats.sameCategoryCount).toBe(0);
  });

  it('记录后 exactMatchCount 正确', () => {
    model.record({ toolName: 'write', params: { path: 'test.ts' }, success: true, confirmed: false });
    model.record({ toolName: 'write', params: { path: 'test.ts' }, success: true, confirmed: false });
    const stats = model.getStats('write', { path: 'test.ts' });
    expect(stats.exactMatchCount).toBe(2);
  });

  it('sameToolCount 包含同 tool 不同参数', () => {
    model.record({ toolName: 'write', params: { path: 'a.ts' }, success: true, confirmed: false });
    model.record({ toolName: 'write', params: { path: 'b.ts' }, success: true, confirmed: false });
    const stats = model.getStats('write', { path: 'c.ts' });
    expect(stats.exactMatchCount).toBe(0);
    expect(stats.sameToolCount).toBe(2);
  });

  // ==========================================
  // getRecentFrequency
  // ==========================================

  it('无操作返回 0', () => {
    expect(model.getRecentFrequency('write')).toBe(0);
  });

  it('最近 5 分钟内的操作被统计', () => {
    model.record({ toolName: 'exec', params: { command: 'ls' }, success: true, confirmed: false });
    model.record({ toolName: 'exec', params: { command: 'pwd' }, success: true, confirmed: false });
    model.record({ toolName: 'exec', params: { command: 'date' }, success: true, confirmed: false });
    const freq = model.getRecentFrequency('exec');
    expect(freq).toBe(3);
  });

  it('不同 tool 的操作不被计入', () => {
    model.record({ toolName: 'read', params: {}, success: true, confirmed: false });
    model.record({ toolName: 'write', params: {}, success: true, confirmed: false });
    expect(model.getRecentFrequency('read')).toBe(1);
    expect(model.getRecentFrequency('write')).toBe(1);
  });

  // ==========================================
  // 持久化
  // ==========================================

  it('enablePersistence 不抛出异常', () => {
    expect(() => model.enablePersistence(process.cwd())).not.toThrow();
  });

  it('enablePersistence 后 record 不抛出', () => {
    model.enablePersistence(process.cwd());
    expect(() => model.record({ toolName: 'test', params: {}, success: true, confirmed: false })).not.toThrow();
  });

  // ==========================================
  // getAllEntries
  // ==========================================

  it('getAllEntries 返回所有记录', () => {
    model.record({ toolName: 'a', params: {}, success: true, confirmed: false });
    model.record({ toolName: 'b', params: {}, success: true, confirmed: false });
    expect(model.getAllEntries().length).toBe(2);
  });

  it('getAllEntries 返回的条目有正确结构', () => {
    model.record({ toolName: 'read', params: { path: 'test.ts' }, success: true, confirmed: false });
    const entries = model.getAllEntries();
    const entry = entries[0]!;
    expect(entry.toolName).toBe('read');
    expect(entry.success).toBe(true);
    expect(entry.confirmed).toBe(false);
    expect(entry.paramSignature).toBeDefined();
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  // ==========================================
  // clear
  // ==========================================

  it('清空所有记录后数据归零', () => {
    model.record({ toolName: 'a', params: {}, success: true, confirmed: false });
    model.record({ toolName: 'b', params: {}, success: true, confirmed: false });
    model.clear();
    expect(model.getAllEntries().length).toBe(0);
    expect(model.getStats('a', {}).exactMatchCount).toBe(0);
    expect(model.getRecentFrequency('a')).toBe(0);
  });

  // ==========================================
  // 边界情况
  // ==========================================

  it('空参数不崩溃', () => {
    expect(() => model.record({ toolName: 'test', params: {}, success: true, confirmed: false })).not.toThrow();
  });

  it('超大参数不崩溃', () => {
    const huge = { path: 'x'.repeat(10000) };
    expect(() => model.record({ toolName: 'test', params: huge, success: true, confirmed: false })).not.toThrow();
  });
});
