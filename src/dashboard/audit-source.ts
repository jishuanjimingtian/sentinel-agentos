/**
 * 统一审计日志路径解析 — Dashboard / API / Analyzer 共用
 *
 * 优先级（与 OpenClaw workspace 布局一致）：
 * 1. {workspaceRoot}/.agentos/audit.jsonl  — 显式 workspace
 * 2. {cwd}/../../.agentos/audit.jsonl       — 从 projects/agentos 上溯到 workspace 根
 * 3. {cwd}/.agentos/audit.jsonl            — 项目本地
 */

import * as fs from 'fs';
import * as path from 'path';

export function getAuditPathCandidates(baseDir: string, workspaceRoot?: string): string[] {
  const cwd = path.resolve(baseDir);
  const candidates: string[] = [];

  // OpenClaw workspace 根目录（projects/agentos → ../../.agentos）
  candidates.push(path.resolve(cwd, '..', '..', '.agentos', 'audit.jsonl'));

  if (workspaceRoot) {
    const wr = path.join(path.resolve(workspaceRoot), '.agentos', 'audit.jsonl');
    if (!candidates.includes(wr)) candidates.push(wr);
  }

  const local = path.join(cwd, '.agentos', 'audit.jsonl');
  if (!candidates.includes(local)) candidates.push(local);

  return candidates;
}

export function findAuditFile(baseDir: string = process.cwd(), workspaceRoot?: string): string | null {
  for (const fp of getAuditPathCandidates(baseDir, workspaceRoot)) {
    try {
      if (fs.existsSync(fp)) return fp;
    } catch {
      /* skip */
    }
  }
  return null;
}

export function loadAuditEntries(
  baseDir: string = process.cwd(),
  maxLines?: number,
  workspaceRoot?: string,
): Record<string, unknown>[] {
  const auditPath = findAuditFile(baseDir, workspaceRoot);
  if (!auditPath) return [];

  try {
    const content = fs.readFileSync(auditPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    const slice = maxLines != null && maxLines > 0 ? lines.slice(-maxLines) : lines;
    return slice
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((e): e is Record<string, unknown> => e != null);
  } catch {
    return [];
  }
}
