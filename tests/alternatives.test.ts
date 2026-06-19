/**
 * Tests: 替代方案库 (alternatives)
 *
 * 覆盖：
 *   - findAlternative 精确匹配
 *   - findAlternativesByPrefix 前缀匹配
 *   - getAllAlternatives 全量
 *   - 不存在的 key
 *   - 边界情况
 */

import { findAlternative, findAlternativesByPrefix, getAllAlternatives } from '../src/alternatives';

describe('findAlternative', () => {
  it('精确匹配 rm-rf-root 返回对应替代方案', () => {
    const alt = findAlternative('rm-rf-root');
    expect(alt).toBeDefined();
    expect(alt!.ruleKey).toBe('rm-rf-root');
    expect(alt!.suggestion).toContain('删除');
    expect(alt!.example).toBeDefined();
  });

  it('精确匹配 npm-publish 返回发布建议', () => {
    const alt = findAlternative('npm-publish');
    expect(alt).toBeDefined();
    expect(alt!.suggestion).toContain('版本号');
  });

  it('精确匹配 exec-dangerous 返回命令建议', () => {
    const alt = findAlternative('exec-dangerous');
    expect(alt).toBeDefined();
    expect(alt!.suggestion).toContain('安全');
  });

  it('不存在的 key 返回 undefined', () => {
    expect(findAlternative('nonexistent-key')).toBeUndefined();
  });

  it('空字符串 key 返回 undefined', () => {
    expect(findAlternative('')).toBeUndefined();
  });
});

describe('findAlternativesByPrefix', () => {
  it('git- 前缀返回所有 Git 操作替代方案', () => {
    const alts = findAlternativesByPrefix('git-');
    expect(alts.length).toBe(2);
    expect(alts.map((a) => a.ruleKey)).toEqual(
      expect.arrayContaining(['git-push-force', 'git-reset-hard']),
    );
  });

  it('rm- 前缀返回所有 rm 相关方案', () => {
    const alts = findAlternativesByPrefix('rm-');
    expect(alts.length).toBeGreaterThanOrEqual(2);
    alts.forEach((a) => expect(a.ruleKey).toMatch(/^rm-/));
  });

  it('空前缀返回所有方案', () => {
    const alts = findAlternativesByPrefix('');
    expect(alts.length).toBe(getAllAlternatives().length);
  });

  it('不存在的前缀返回空数组', () => {
    expect(findAlternativesByPrefix('zzz-')).toEqual([]);
  });
});

describe('getAllAlternatives', () => {
  it('返回所有替代方案且数量正确', () => {
    const all = getAllAlternatives();
    expect(all.length).toBeGreaterThan(10);
    expect(all.length).toBe(16);
  });

  it('返回副本，修改不影响内部', () => {
    const all = getAllAlternatives();
    const origLen = all.length;
    all.pop();
    expect(getAllAlternatives().length).toBe(origLen);
  });

  it('每条方案都有必要字段', () => {
    for (const alt of getAllAlternatives()) {
      expect(alt.ruleKey).toBeTruthy();
      expect(alt.suggestion).toBeTruthy();
    }
  });
});
