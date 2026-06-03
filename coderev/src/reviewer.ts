import { ReviewResult, ReviewContext } from './types.js';
import { builtinRules } from './rules.js';

export async function review(content: string): Promise<ReviewResult[]> {
  const lines = content.split('\n');
  const fileExtension = guessFileExtension(lines);
  const ctx: ReviewContext = { lines, fileExtension };

  const results: ReviewResult[] = [];

  for (const rule of builtinRules) {
    for (let i = 0; i < lines.length; i++) {
      const result = rule.check(lines[i], i + 1, ctx);
      if (result) {
        results.push(result);
      }
    }
  }

  // 按行号排序
  results.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return results;
}

function guessFileExtension(lines: string[]): string {
  // 尝试从文件头注释或第一行推断
  // 简单策略：检查是否包含 import/export 语法
  for (const line of lines.slice(0, 20)) {
    if (/import\s+.*\s+from/.test(line)) return '.ts';
    if (/^(import|export)\s/.test(line)) return '.ts';
  }
  return '.js';
}
