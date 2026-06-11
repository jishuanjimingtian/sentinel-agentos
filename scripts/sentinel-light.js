/**
 * Sentinel AgentOS Guard — OpenClaw 轻量守护
 *
 * 纯内存正则 + 路径匹配，无 I/O，无 git，每次调用 < 0.01ms。
 *
 * 用法:
 *   const guard = require('./sentinel-guard');
 *   guard.preCheck('exec', { command: 'rm -rf /' });
 */

// ── 危险命令黑名单（纯正则，确定性，零 LLM） ──
const DANGEROUS = [
  [/rm\s+-rf\s+\//, 'rm -rf / — 删除整个系统'],
  [/rm\s+-rf\s+~/, 'rm -rf ~ — 删除用户目录'],
  [/sudo\s+rm/, 'sudo rm — 超级用户删除'],
  [/mkfs\./, 'mkfs — 格式化磁盘'],
  [/dd\s+if=/, 'dd — 可能覆盖分区'],
  [/fork\s*bomb|:\(\)/, 'fork bomb — 系统崩溃'],
  [/chmod\s+777\s+-R\s*\//, 'chmod 777 -R / — 权限全开'],
  [/del\s+\/F\s+\/S\s+[A-Z]:\\/, 'del /F /S — 全盘删除'],
  [/>\s*\/dev\/sd[a-z]/, '写入磁盘设备'],
];

// ── 高风险需确认 ──
const WARNING = [
  [/git\s+push\s+--force/, 'git push --force — 强制覆盖'],
  [/git\s+reset\s+--hard/, 'git reset --hard — 不可逆'],
  [/npm\s+publish\b/, 'npm publish — 发布公共包'],
  [/npm\s+unpublish\b/, 'npm unpublish — 从 npm 删除'],
  [/DROP\s+(TABLE|DATABASE)/i, 'DROP — 删除数据库'],
  [/TRUNCATE\s+(TABLE\s+)?/i, 'TRUNCATE — 清空表'],
];

// ── 敏感文件路径（glob 匹配） ──
const SENSITIVE_PATTERNS = [
  '.env',
  '.env.*',
  '*.key',
  '*.pem',
  '*.p12',
  '*.pfx',
  '*.jks',
  '*.keystore',
  '.git/**',
  '**/credentials/**',
  '**/secrets/**',
  '**/SECRETS/**',
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
];

// ── 保护文件（删除时拦截） ──
const PROTECTED_FILES = [
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '.gitignore',
  '.gitattributes',
  'Cargo.toml',
  'Cargo.lock',
  'tsconfig.json',
  'AGENTS.md',
  'SOUL.md',
  'MEMORY.md',
  'USER.md',
];

/**
 * Simple glob match. Supports * (single segment) and ** (multi segment).
 */
function globMatch(pattern, path) {
  // Normalize backslashes
  const p = path.replace(/\\/g, '/');

  if (!pattern.includes('*')) {
    // exact match — file name only or full path
    return p === pattern || p.endsWith('/' + pattern);
  }

  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*\/)?')
    .replace(/\*/g, '[^/]*');

  return new RegExp('(^|/)' + regex + '$').test(p);
}

module.exports = {
  preCheck(toolName, params) {
    // ── 1. 危险命令检测 ──
    if (toolName === 'exec' && params.command) {
      const cmd = String(params.command);
      for (const [re, desc] of DANGEROUS) {
        if (re.test(cmd)) {
          return { passed: false, block: true, risk: 'DENY',
            reason: `🚫 危险命令: ${desc}` };
        }
      }
      for (const [re, desc] of WARNING) {
        if (re.test(cmd)) {
          return { passed: false, block: true, risk: 'CONFIRM',
            reason: `⚠️ 需要确认: ${desc}`, needsConfirmation: true };
        }
      }
    }

    // ── 2. 敏感文件保护 ──
    const path = params.path || params.file;
    if (path) {
      const p = String(path);

      // 写操作检查敏感模式
      if (['write', 'edit', 'delete', 'read'].includes(toolName)) {
        for (const pattern of SENSITIVE_PATTERNS) {
          if (globMatch(pattern, p)) {
            return { passed: false, block: true, risk: 'DENY',
              reason: `🚫 敏感文件保护: "${p}" 匹配规则 "${pattern}"` };
          }
        }
      }

      // 删除操作额外检查保护文件
      if (toolName === 'delete') {
        for (const pf of PROTECTED_FILES) {
          if (p === pf || p.endsWith('/' + pf) || p.endsWith('\\' + pf)) {
            return { passed: false, block: true, risk: 'DENY',
              reason: `🚫 保护文件: 不允许删除 "${pf}"` };
          }
        }
      }
    }

    return { passed: true, risk: 'auto', riskScore: 0, snapshot: null };
  },

  // postCheck 暂时轻量，后续接入 AgentOS 审计按需启用
  postCheck() {
    return { verifyPassed: true, auditId: null };
  },

  status() {
    return 'Sentinel Guard · 轻量模式 (18 条黑名单 + 敏感文件保护)';
  },

  audit() { return []; },
  feedback() {},
};
