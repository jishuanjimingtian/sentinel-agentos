/**
 * Sentinel AgentOS Unified Guard — 统一入口
 *
 * 一个 sentinel.execute() 走完三层：
 *   Guard (确定性拦截 + Schema + Risk) → Execute → Verify + Audit
 *                         ↓
 *                   Memory (Working+Episodic+Semantic)
 *                         ↓
 *                   Evaluator (Pre+Runtime+Post + Profiler)
 *
 * 调用方式：
 *   const sentinel = require('./sentinel-guard');
 *   const result = await sentinel.execute('exec', { command: 'npm test' }, () => exec(...));
 *
 * 初始化时自动：
 *   1. 加载 guard-rules.json 配置（黑白名单可编辑）
 *   2. 检测并迁移 MEMORY.md → Semantic Memory（仅首次）
 */

const { AgentOS } = require('sentinel-agentos');
const fs = require('fs');
const path = require('path');

const SKILL_DIR = __dirname;
const AUDIT_DIR = path.join(SKILL_DIR, '.sentinel-audit');
const RULES_PATH = path.join(SKILL_DIR, 'guard-rules.json');
const MIGRATION_FLAG = path.join(SKILL_DIR, '.sentinel-migrated');

// ══════════════════════════════════
// 加载 Guard 规则配置
// ══════════════════════════════════

function loadRulesConfig() {
  if (fs.existsSync(RULES_PATH)) {
    try {
      const raw = fs.readFileSync(RULES_PATH, 'utf-8');
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[Sentinel] guard-rules.json 解析失败，使用内置默认规则');
    }
  }
  return null;
}

const rulesConfig = loadRulesConfig();

// 从配置或默认值提取规则
const DANGEROUS = (rulesConfig?.dangerous || [
  ['rm -rf /', '删除整个系统'],
  ['rm -rf ~', '删除用户目录'],
  ['sudo rm', '超级用户删除'],
  ['mkfs', '格式化磁盘'],
  ['dd if=', '可能覆盖分区'],
  ['fork bomb|:\\(\\)', 'fork bomb — 系统崩溃'],
  ['chmod 777 -R /', '权限全开'],
  ['del /F /S [A-Z]:\\\\', '全盘删除'],
  ['> /dev/sd[a-z]', '写入磁盘设备'],
]).map(([pattern, desc]) => [new RegExp(pattern, 'i'), desc]);

const WARNING = (rulesConfig?.warning || [
  ['git push --force', '强制覆盖'],
  ['git reset --hard', '不可逆'],
  ['npm publish\\b', '发布公共包'],
  ['npm unpublish\\b', '从 npm 删除'],
  ['DROP (TABLE|DATABASE)', '删除数据库'],
  ['TRUNCATE (TABLE )?', '清空表'],
]).map(([pattern, desc]) => [new RegExp(pattern, 'i'), desc]);

const SENSITIVE_FILES = rulesConfig?.sensitiveFiles || [
  '.env', '.env.*', '*.key', '*.pem', '*.p12', '*.pfx', '*.jks', '*.keystore',
  '.git/**', '**/credentials/**', '**/secrets/**', '**/SECRETS/**',
];

const PROTECTED_FILES = rulesConfig?.protectedFiles || [
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.gitignore', 'AGENTS.md', 'SOUL.md', 'MEMORY.md', 'USER.md',
];

const SCHEMA_RULES = rulesConfig?.schema || [
  { tool: 'exec', required: ['command'] },
  {
    tool: 'write', required: ['path', 'content'],
    pathDeny: ['.env', '*.key', '*.pem', '.git/**', '**/credentials/**'],
    maxSize: { content: 1048576 }, secrets: ['content'],
  },
  { tool: 'read', required: ['path'], pathDeny: ['.env', '*.key'] },
  { tool: 'edit', required: ['path'], pathDeny: ['.env', '*.key', '.git/**'] },
  {
    tool: 'delete', required: ['path'],
    pathDeny: ['.env', '*.key', '*.pem', '.git/**', 'node_modules/**', 'package.json'],
  },
];

function globMatch(pattern, p) {
  p = (p || '').replace(/\\/g, '/');
  if (!pattern.includes('*')) return p === pattern || p.endsWith('/' + pattern);
  const re = '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(.*/)?').replace(/\*/g, '[^/]*') + '$';
  return new RegExp(re).test(p);
}

// ══════════════════════════════════
// 全局单例初始化
// ══════════════════════════════════

if (!global.__sentinel_aos) {
  const aos = new AgentOS({
    workspaceRoot: process.cwd(),
    maxWorkingTokens: 50000,
    maxEpisodicSizeKb: 500,
  });

  // 注册 Schema 规则
  const schemaRules = SCHEMA_RULES.map(r => {
    const rule = { tool: r.tool, required: r.required };
    if (r.pathDeny) rule.pathDeny = { path: r.pathDeny };
    if (r.maxSize) rule.maxSize = r.maxSize;
    if (r.secrets) rule.secrets = r.secrets;
    return rule;
  });
  aos.guard.schema.registerRules(schemaRules);

  // 从磁盘恢复审计
  const auditFile = path.join(AUDIT_DIR, 'audit.jsonl');
  if (fs.existsSync(auditFile)) {
    try {
      fs.readFileSync(auditFile, 'utf-8').trim().split('\n').filter(Boolean).forEach(line => {
        aos.guard.audit.entries.push(JSON.parse(line));
      });
    } catch {}
  }

  // ══════════════════════════════════
  // 自动迁移 MEMORY.md → Semantic Memory（仅首次）
  // ══════════════════════════════════
  if (!fs.existsSync(MIGRATION_FLAG)) {
    try {
      // 确定 MEMORY.md 位置：优先 process.cwd() 向上找 workspace 根
      // 注意：模块加载时 cwd 可能是 skill 目录本身
      let memoryPath = path.join(process.cwd(), 'MEMORY.md');
      if (!fs.existsSync(memoryPath)) {
        // 尝试 workspace 根目录（skill 目录的上两级）
        memoryPath = path.resolve(SKILL_DIR, '..', '..', 'MEMORY.md');
      }
      let migrated = 0;

      if (fs.existsSync(memoryPath)) {
        const content = fs.readFileSync(memoryPath, 'utf-8');
        const sections = parseMemoryMd(content);

        // 提取 section 数据：同时处理 bullet 列表和表格行
        const extractData = (sectionName) => {
          const lines = sections[sectionName] || [];
          return lines
            .filter(l => l.trim().length > 10)
            .map(l => l.replace(/^\|\s*/, '').replace(/\s*\|$/, '').trim());
        };

        // 关于老板（bullet 格式）
        const bossData = extractData('👤 关于老板');
        for (const line of bossData) {
          aos.memory.semantic.addFact(line);
          migrated++;
        }

        // 关于我（bullet 格式）
        const meData = extractData('🆔 关于我');
        for (const line of meData) {
          aos.memory.semantic.addFact(line);
          migrated++;
        }

        // 工作方式规则
        const workway = sections['🤖 我的工作方式'] || [];
        for (const bullet of workway) {
          if (bullet.trim().length > 10) {
            aos.memory.semantic.learnRule(bullet, 'MEMORY.md migration');
            migrated++;
          }
        }

        // 项目上下文
        const coderevSection = sections['📦 核心项目：coderev'];
        if (coderevSection) {
          aos.memory.semantic.setProjectContext('coderev', {
            description: 'AI 驱动的代码审查 CLI 工具',
            techStack: ['TypeScript', 'Node.js', 'CLI'],
          });
          migrated++;
        }

        const agentosSection = sections['📦 Sentinel AgentOS'] || sections['📦 Sentinel AgentOS（项目 #2）'];
        if (agentosSection) {
          aos.memory.semantic.setProjectContext('agentos', {
            description: 'AI Agent 操作系统 — 确定性 Guard + 分层记忆 + 自动评估',
            techStack: ['TypeScript', 'Node.js', 'Jest'],
          });
          migrated++;
        }

        // 环境记录
        const envData = extractData('💻 环境记录');
        for (const line of envData) {
          aos.memory.semantic.addFact(line);
          migrated++;
        }

        // 关键决策记录
        const decisions = extractData('💡 关键决策记录');
        for (const line of decisions) {
          if (line.trim().length > 10) {
            aos.memory.episodic.record('decision', line, ['migration'], []);
            migrated++;
          }
        }

        console.log(`[Sentinel] MEMORY.md 迁移完成: ${migrated} 条 → Semantic/Episodic Memory`);
      }

      // 写入迁移标记
      fs.writeFileSync(MIGRATION_FLAG, JSON.stringify({
        migratedAt: new Date().toISOString(),
        sourceFile: memoryPath,
        itemsMigrated: migrated,
      }, null, 2));
    } catch (e) {
      console.warn('[Sentinel] MEMORY.md 迁移失败:', e.message);
    }
  }

  // 注入默认语义记忆（不覆盖迁移数据）
  const existingPrefs = Object.keys(aos.memory.semantic.getMemory().userPreferences || {});
  if (!existingPrefs.includes('user-name')) aos.memory.semantic.setPreference('user-name', '老板');
  if (!existingPrefs.includes('language')) aos.memory.semantic.setPreference('language', 'zh-CN');
  if (!existingPrefs.includes('direct-communication')) aos.memory.semantic.setPreference('direct-communication', true);

  const facts = aos.memory.semantic.getMemory().userFacts || [];
  if (facts.length === 0) {
    aos.memory.semantic.addFact('老板是中国用户，偏好直接、不说废话');
    aos.memory.semantic.addFact('项目 coderev 是 AI 代码审查 CLI 工具');
    aos.memory.semantic.addFact('项目 sentinel-agentos 是 AI Agent 操作系统');
  }

  const rules = aos.memory.semantic.getAllRules();
  if (rules.length === 0) {
    aos.memory.semantic.learnRule('高风险操作前必须 preCheck', 'sentinel_init');
    aos.memory.semantic.learnRule('操作完成后必须 postCheck 审计', 'sentinel_init');
    aos.memory.semantic.learnRule('npm publish 前必须确认版本号', 'sentinel_init');
  }

  aos.memory.episodic.record('milestone',
    'Sentinel AgentOS 全功能启用：Guard + Memory + Evaluator',
    ['init', 'milestone'], ['sentinel-agentos']);

  global.__sentinel_aos = aos;
  global.__sentinel_session_id = 1;
}

const aos = global.__sentinel_aos;
let opCounter = 0;

// ══════════════════════════════════
// 辅助：解析 MEMORY.md
// ══════════════════════════════════

function parseMemoryMd(content) {
  const sections = {};
  let currentSection = '';
  const lines = content.split('\n');

  for (const line of lines) {
    if (line.startsWith('## ')) {
      currentSection = line.replace('## ', '').trim();
      sections[currentSection] = sections[currentSection] || [];
    } else if (currentSection && line.trim().startsWith('- ')) {
      sections[currentSection].push(line.trim().replace(/^-\s*/, ''));
    }
  }
  return sections;
}

// ══════════════════════════════════
// 统一入口
// ══════════════════════════════════

async function execute(toolName, params, fn, opts = {}) {
  const sid = opts.sessionId || `s${global.__sentinel_session_id}`;

  // ── 确定性命令拦截 ──
  if (toolName === 'exec' && params.command) {
    const cmd = String(params.command);
    for (const [re, desc] of DANGEROUS) {
      if (re.test(cmd)) {
        return {
          allowed: false, blocked: true, risk: 'DENY',
          reason: `🚫 危险命令: ${desc}`,
        };
      }
    }
    for (const [re, desc] of WARNING) {
      if (re.test(cmd)) {
        return {
          allowed: false, blocked: true, risk: 'CONFIRM',
          reason: `⚠️ 需要确认: ${desc}`,
          needsConfirmation: true,
        };
      }
    }
  }

  // ── 确定性文件拦截 ──
  const p = params.path || params.file;
  if (p && ['write', 'edit', 'delete', 'read'].includes(toolName)) {
    for (const ptn of SENSITIVE_FILES) {
      if (globMatch(ptn, p)) {
        return {
          allowed: false, blocked: true, risk: 'DENY',
          reason: `🚫 敏感文件: "${p}" → "${ptn}"`,
        };
      }
    }
  }
  if (toolName === 'delete' && p) {
    for (const pf of PROTECTED_FILES) {
      if (String(p) === pf || String(p).endsWith('/' + pf) || String(p).endsWith('\\' + pf)) {
        return {
          allowed: false, blocked: true, risk: 'DENY',
          reason: `🚫 保护文件: "${pf}"`,
        };
      }
    }
  }

  // ── AgentOS Pipeline ──
  const { preExec, snapshot } = aos.executePipeline({
    sessionId: sid,
    agentId: 'openclaw',
    toolName,
    parameters: params,
    affectedFiles: opts.affectedFiles,
  });

  if (preExec.riskScore.action === 'deny') {
    return {
      allowed: false, blocked: true, risk: 'DENY',
      reason: `🚫 Risk Score ${preExec.riskScore.score} → ${preExec.riskScore.action}`,
    };
  }

  // ── 执行 ──
  const startTime = Date.now();
  let result;
  try {
    result = await Promise.resolve(fn());
  } catch (err) {
    aos.completeExecution({
      sessionId: sid, agentId: 'openclaw', toolName,
      toolParameters: params, toolResult: { error: err.message },
      snapshot, startTime, endTime: Date.now(),
      retryCount: 0, wasSelfCorrected: false, hadTimeout: false,
      userAccepted: false, userProvidedEdit: false, resultWasUsed: false,
    });
    return { allowed: true, result: undefined, blocked: false, risk: 'auto', error: err.message };
  }
  const endTime = Date.now();

  // ── Verify + Audit + Evaluator ──
  const completed = aos.completeExecution({
    sessionId: sid, agentId: 'openclaw', toolName,
    toolParameters: params, toolResult: result,
    snapshot, startTime, endTime,
    retryCount: 0, wasSelfCorrected: false, hadTimeout: false,
    userAccepted: true, userProvidedEdit: false, resultWasUsed: true,
  });

  // ── Memory 同步 ──
  aos.memory.working.addMessage('tool', `${toolName}: ${JSON.stringify(params || {}).slice(0, 200)}`);
  aos.memory.working.cacheToolResult(toolName, result);
  aos.recordFeedback('user_used_result', sid);
  if (toolName === 'exec' && params.command) {
    aos.memory.episodic.record('tool_call', String(params.command), ['exec'], []);
  }

  // ── 审计持久化 ──
  const auditId = `op_${++opCounter}`;
  try {
    if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
    fs.appendFileSync(path.join(AUDIT_DIR, 'audit.jsonl'), JSON.stringify({
      id: auditId, ts: new Date().toISOString(), sessionId: sid,
      tool: toolName,
      params: JSON.stringify(params || {}).slice(0, 200),
      result: String(result || '').slice(0, 100),
      verify: completed.auditEntry?.verifyGate?.status,
      riskScore: completed.postExec?.verifyScore,
      profile: completed.profile?.overallScore,
    }) + '\n');
  } catch {}

  return {
    allowed: true, blocked: false, risk: 'auto',
    result, auditId,
    verify: completed.auditEntry?.verifyGate?.status,
    profile: completed.profile?.overallScore,
  };
}

// ══════════════════════════════════
// 兼容旧接口
// ══════════════════════════════════

function preCheck(toolName, params) {
  if (toolName === 'exec' && params.command) {
    const cmd = String(params.command);
    for (const [re, desc] of DANGEROUS) {
      if (re.test(cmd)) return { passed: false, block: true, risk: 'DENY', reason: `🚫 危险命令: ${desc}` };
    }
    for (const [re, desc] of WARNING) {
      if (re.test(cmd)) return { passed: false, block: true, risk: 'CONFIRM', reason: `⚠️ 需要确认: ${desc}`, needsConfirmation: true };
    }
  }
  const p = params.path || params.file;
  if (p && ['write', 'edit', 'delete', 'read'].includes(toolName)) {
    for (const ptn of SENSITIVE_FILES) {
      if (globMatch(ptn, p)) return { passed: false, block: true, risk: 'DENY', reason: `🚫 敏感文件: "${p}" → "${ptn}"` };
    }
  }
  if (toolName === 'delete' && p) {
    for (const pf of PROTECTED_FILES) {
      if (String(p) === pf || String(p).endsWith('/' + pf) || String(p).endsWith('\\' + pf))
        return { passed: false, block: true, risk: 'DENY', reason: `🚫 保护文件: "${pf}"` };
    }
  }
  return { passed: true, risk: 'auto' };
}

function postCheck(toolName, params, result) {
  const entry = {
    id: `${++opCounter}`, ts: new Date().toISOString(),
    sessionId: `s${global.__sentinel_session_id}`,
    tool: toolName,
    params: typeof params === 'string' ? params.slice(0, 200) : JSON.stringify(params || {}).slice(0, 200),
    result: String(result || '').slice(0, 100),
  };
  aos.memory.working.addMessage('tool', `${toolName}: ${entry.params}`);
  try {
    if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });
    fs.appendFileSync(path.join(AUDIT_DIR, 'audit.jsonl'), JSON.stringify(entry) + '\n');
  } catch {}

  setImmediate(() => {
    try {
      const sid = `s${global.__sentinel_session_id}_op${opCounter}`;
      const { preExec, snapshot } = aos.executePipeline({
        sessionId: sid, agentId: 'openclaw', toolName, parameters: params || {},
      });
      const claimed = {};
      if (['write', 'edit', 'delete'].includes(toolName) && params?.path) claimed.files = [String(params.path)];
      if (result) claimed.result = result;
      aos.completeExecution({
        sessionId: sid, agentId: 'openclaw', toolName,
        toolParameters: params || {}, toolResult: result ?? null,
        snapshot, startTime: Date.now() - 500, endTime: Date.now(),
        retryCount: 0, wasSelfCorrected: false, hadTimeout: false,
        userAccepted: true, userProvidedEdit: false, resultWasUsed: true,
      });
      aos.recordFeedback('user_used_result', `s${global.__sentinel_session_id}`);
      if (toolName === 'exec' && params?.command) {
        aos.memory.episodic.record('tool_call', String(params.command), ['exec'], []);
      }
    } catch {}
  });

  return { auditId: entry.id, verify: 'QUEUED' };
}

// ══════════════════════════════════
// 辅助功能
// ══════════════════════════════════

function audit(limit = 10) {
  return aos.guard.audit.query({ limit });
}

function status() {
  return aos.statusReport();
}

function injectContext() {
  return aos.injectContext();
}

function feedback(signal, sessionId) {
  if (signal === 'query') {
    // Query mode: feedback('query', { filter })
    return aos.evaluator.feedback.query(sessionId || {});
  }
  if (signal === 'stats') {
    return aos.evaluator.feedback.stats();
  }
  aos.recordFeedback(signal, sessionId || `s${global.__sentinel_session_id}`);
}

function endSession() {
  const sid = `s${global.__sentinel_session_id}`;
  // Pass workspace root so endSession auto-appends daily log (v0.3.4)
  const workspaceRoot = path.resolve(SKILL_DIR, '..', '..');
  aos.endSession(sid, workspaceRoot);
  global.__sentinel_session_id++;
}

function fullStatus() {
  return {
    sessionId: `s${global.__sentinel_session_id}`,
    opCount: opCounter,
    audit: aos.guard.audit.stats(),
    profile: aos.getProfile(),
    satisfaction: aos.evaluator.feedback.getSatisfactionScore(),
    workingMemory: {
      messages: aos.memory.working.recentMessages.length,
      budget: aos.memory.working.budget,
      cachedResults: aos.memory.working.recentToolResults?.size || 0,
    },
    episodicEvents: aos.memory.episodic.count,
    semanticRules: aos.memory.semantic.getAllRules().length,
    preferences: aos.memory.semantic.getPreference('language'),
  };
}

// ══════════════════════════════════
// Evaluator 报告
// ══════════════════════════════════

function compactReport() {
  const profile = aos.getProfile();
  const parts = [
    `## 📊 AgentOS Evaluator 今日评估`,
    '',
    `**综合评分**: ${profile.overallScore}/100 | Pre:${profile.breakdown.preExec}/100 | Run:${profile.breakdown.runtime}/100 | Post:${profile.breakdown.postExec}/100`,
    `**趋势**: ${profile.trends.improving ? '📈 上升' : '📉 下降'} | **操作数**: ${profile.totalOps}`,
  ];
  if (profile.warnings.length > 0) parts.push(`**⚠️**: ${profile.warnings.join('; ')}`);
  if (profile.strengths.length > 0) parts.push(`**✅**: ${profile.strengths.join('; ')}`);
  parts.push('');
  return parts.join('\n');
}

function fullReport() {
  const profile = aos.getProfile();
  const auditStats = aos.guard.audit.stats();
  const satisfaction = aos.evaluator.feedback.getSatisfactionScore();

  return [
    '═══ 📊 AgentOS Evaluator 报告 ═══',
    '',
    `🎯 综合评分: ${profile.overallScore}/100`,
    '',
    '📈 分项评分:',
    `  ├─ 参数质量:   ${profile.breakdown.preExec}/100`,
    `  ├─ 执行质量:   ${profile.breakdown.runtime}/100`,
    `  ├─ 结果验证:   ${profile.breakdown.postExec}/100`,
    `  └─ 用户满意度: ${profile.breakdown.userSatisfaction}/100`,
    '',
    `📊 趋势: ${profile.trends.improving ? '📈 上升' : '📉 下降'} (最近${profile.trends.recentOps}次: ${Math.round(profile.trends.recentScore)}/100)`,
    '',
    `🛡️ 审计: ${auditStats.totalOperations} 次操作 | ${auditStats.verifyFailures} 失败 | ${auditStats.highRiskOps} 高危`,
    `📐 满意度: ${satisfaction}`,
    '',
    ...(profile.strengths.length > 0 ? ['✅ 亮点:', ...profile.strengths.map(s => `  · ${s}`), ''] : []),
    ...(profile.warnings.length > 0 ? ['⚠️ 需改进:', ...profile.warnings.map(w => `  · ${w}`), ''] : []),
    '══════════════════════════════',
  ].join('\n');
}

function appendDailyLog() {
  try {
    const dateKey = new Date().toISOString().split('T')[0];
    const memoryDir = path.join(SKILL_DIR, '..', '..', 'memory');
    const dailyFile = path.join(memoryDir, `${dateKey}.md`);
    const report = compactReport();

    if (fs.existsSync(dailyFile)) {
      const existing = fs.readFileSync(dailyFile, 'utf-8');
      if (existing.includes('AgentOS Evaluator')) return;
    }

    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
    fs.appendFileSync(dailyFile, `\n${report}\n`, 'utf-8');
  } catch (e) { /* 静默 */ }
}

module.exports = { execute, preCheck, postCheck, audit, status, injectContext, feedback, endSession, fullStatus, compactReport, fullReport };
