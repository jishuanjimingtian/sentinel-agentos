/**
 * Confidence Scoring Engine — D1–D5 五维度评分
 *
 * 置信度 = Agent 执行当前操作的可信度 (0–100)
 * 分数越高 → 越信任 → 越少弹窗
 *
 * 五维度：
 *   D1: 命令风险评分 (0-100) — 基于 RiskGate 的 Impact × Reversibility × Sensitivity
 *   D2: 用户历史行为 (0-100) — 三阶匹配：一阶(完全匹配)/二阶(同工具)/三阶(同类别)
 *   D3: 上下文相关性 (0-100) — lastAIMessage 关键词与当前操作的匹配度
 *   D4: 路径敏感度 (0-100) — 操作文件/路径的危险级分类
 *   D5: 时间模式 (0-100) — 时间/频率异常的惩罚分
 *
 * 最终置信度 = \u03a3(Di × Wi) / \u03a3Wi
 *   权重: D1(35) D2(25) D3(20) D4(10) D5(10)
 */

import { RiskAction, RiskScore } from './types';

// ============================================================
// Types
// ============================================================

export interface D1Score {
  /** 0-100, 越高越安全 */
  score: number;
  rawRiskScore: number;
  action: RiskAction;
}

export interface D2Score {
  /** 0-100 */
  score: number;
  /** 匹配深度: 'exact' | 'same-tool' | 'same-category' | 'none' */
  matchLevel: 'exact' | 'same-tool' | 'same-category' | 'none';
  /** 该操作历史执行次数 */
  historyCount: number;
}

export interface D3Score {
  /** 0-100 */
  score: number;
  /** 匹配到的关键词数 */
  matchedKeywords: number;
  /** 总扫描关键词数 */
  totalKeywords: number;
}

export interface D4Score {
  /** 0-100 */
  score: number;
  /** 路径危险等级 */
  dangerLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  /** 匹配的路径类型 */
  pathType: string;
}

export interface D5Score {
  /** 0-100 */
  score: number;
  /** 是否在非工作时间 */
  isOffHours: boolean;
  /** 该操作在当前时段内的频率 */
  frequency: number;
}

export interface ConfidenceResult {
  /** 最终置信度 0-100 */
  confidence: number;
  /** 五个维度的原始分 */
  dimensions: {
    d1: D1Score;
    d2: D2Score;
    d3: D3Score;
    d4: D4Score;
    d5: D5Score;
  };
  /** 决策 */
  decision: 'auto-approve' | 'confirm' | 'block';
}

// ============================================================
// 权重
// ============================================================

const WEIGHTS = { d1: 35, d2: 25, d3: 20, d4: 10, d5: 10 } as const;

// ============================================================
// D1 — 命令风险评分
// ============================================================

/**
 * D1: 将 RiskGate 的 raw risk score 映射到 0-100 置信分。
 *
 * RiskGate 分数范围通常 [0, 15]。映射：
 *   score \u2264 0.5  \u2192 100 (自动放行)
 *   score \u2264 1.0  \u2192 90  (很安全)
 *   score \u2264 3.0  \u2192 70  (需要通知)
 *   score \u2264 5.0  \u2192 50  (需要确认)
 *   score \u2264 8.0  \u2192 30  (高风险)
 *   score > 8.0  \u2192 10  (极高风险)
 */
export function scoreD1(riskScore: RiskScore): D1Score {
  const raw = riskScore.score;
  let score: number;

  if (raw <= 0.5) score = 100;
  else if (raw <= 1.0) score = 90;
  else if (raw <= 3.0) score = 70;
  else if (raw <= 5.0) score = 50;
  else if (raw <= 8.0) score = 30;
  else score = 10;

  if (riskScore.action === 'deny') {
    score = Math.min(score, 5);
  }

  return { score, rawRiskScore: raw, action: riskScore.action };
}

// ============================================================
// D2 — 用户历史行为评分
// ============================================================

/**
 * D2: 基于用户对该操作的历史行为评分。
 *
 * 三阶匹配：
 *   exact (一阶)     \u2192 完全相同 tool+参数
 *   same-tool (二阶) \u2192 同一 tool，不同参数
 *   same-category (三阶) \u2192 同类 tool
 *   none \u2192 新操作
 */
export function scoreD2(
  _toolName: string,
  _params: Record<string, unknown>,
  history: {
    exactMatchCount: number;
    sameToolCount: number;
    sameCategoryCount: number;
  },
): D2Score {
  const { exactMatchCount, sameToolCount, sameCategoryCount } = history;

  if (exactMatchCount >= 10) {
    return { score: clamp(95 + Math.min(exactMatchCount, 5), 0, 100), matchLevel: 'exact', historyCount: exactMatchCount };
  }
  if (exactMatchCount >= 3) {
    return { score: 90, matchLevel: 'exact', historyCount: exactMatchCount };
  }
  if (exactMatchCount > 0) {
    return { score: 80, matchLevel: 'exact', historyCount: exactMatchCount };
  }

  if (sameToolCount >= 20) {
    return { score: 85, matchLevel: 'same-tool', historyCount: sameToolCount };
  }
  if (sameToolCount >= 5) {
    return { score: 70, matchLevel: 'same-tool', historyCount: sameToolCount };
  }
  if (sameToolCount > 0) {
    return { score: 60, matchLevel: 'same-tool', historyCount: sameToolCount };
  }

  if (sameCategoryCount >= 10) {
    return { score: 60, matchLevel: 'same-category', historyCount: sameCategoryCount };
  }
  if (sameCategoryCount > 0) {
    return { score: 45, matchLevel: 'same-category', historyCount: sameCategoryCount };
  }

  return { score: 30, matchLevel: 'none', historyCount: 0 };
}

// ============================================================
// D3 — 上下文相关性评分
// ============================================================

const TOOL_KEYWORDS: Record<string, string[]> = {
  exec: ['运行', '执行', '跑', 'run', 'execute', '启动', '测试', '构建', 'install', 'build', 'test'],
  write: ['写', '创建', '创建文件', '写入', 'write', 'create', '修改', '编辑', '更新文件'],
  read: ['读', '查看', '检查', '读取', 'read', '看', '显示', 'cat', '打开文件'],
  edit: ['修改', '编辑', '替换', '改', 'edit', 'replace', '更新', '修改文件'],
  delete: ['删除', '移除', '清理', 'delete', 'remove', 'rm', 'del', '清理文件'],
  web_search: ['搜索', '查', '搜', 'search', '查找', '查询', '找'],
  web_fetch: ['打开网页', 'fetch', '抓取', '下载', '爬', '访问'],
};

export function scoreD3(toolName: string, lastAIMessage: string): D3Score {
  const keywords = TOOL_KEYWORDS[toolName];
  if (!keywords || !lastAIMessage) {
    return { score: 50, matchedKeywords: 0, totalKeywords: 0 };
  }

  let matched = 0;
  const lowerMsg = lastAIMessage.toLowerCase();

  for (const kw of keywords) {
    if (kw.length >= 2 && lowerMsg.includes(kw.toLowerCase())) {
      matched++;
    }
  }

  const ratio = keywords.length > 0 ? matched / keywords.length : 0;
  let score: number;

  if (ratio >= 0.5) score = 95;
  else if (ratio >= 0.3) score = 80;
  else if (ratio >= 0.15) score = 60;
  else if (ratio > 0) score = 45;
  else score = 30;

  return { score, matchedKeywords: matched, totalKeywords: keywords.length };
}

// ============================================================
// D4 — 路径敏感度评级
// ============================================================

const PATH_DANGER_RULES: Array<{
  pattern: RegExp;
  level: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  type: string;
}> = [
  { pattern: /\.env$/i, level: 'critical', type: '环境变量文件' },
  { pattern: /\.(key|pem|p12|pfx|jks|keystore|secret)$/i, level: 'critical', type: '密钥文件' },
  { pattern: /credentials\./i, level: 'critical', type: '凭据文件' },
  { pattern: /\\\.git\\/i, level: 'high', type: 'Git 内部文件' },
  { pattern: /\\node_modules\\/i, level: 'medium', type: '依赖目录' },
  { pattern: /openclaw\.json$/i, level: 'high', type: '系统配置文件' },
  { pattern: /\\dist\\/i, level: 'medium', type: '构建输出目录' },
  { pattern: /\\\.agentos\\/i, level: 'medium', type: 'AgentOS 内部目录' },
  { pattern: /\.(ts|js|tsx|jsx)$/i, level: 'safe', type: '源代码' },
  { pattern: /\.(md|txt|json|yaml|yml|toml)$/i, level: 'safe', type: '文档/配置' },
  { pattern: /\.(css|scss|less|html)$/i, level: 'safe', type: '前端文件' },
  { pattern: /\\tests?\\/i, level: 'safe', type: '测试目录' },
  { pattern: /\\src\\/i, level: 'safe', type: '源码目录' },
];

const PATH_LEVEL_SCORES: Record<string, number> = {
  safe: 100,
  low: 80,
  medium: 50,
  high: 20,
  critical: 5,
};

export function scoreD4(path?: string): D4Score {
  if (!path) {
    return { score: 100, dangerLevel: 'safe', pathType: '无路径操作' };
  }

  for (const rule of PATH_DANGER_RULES) {
    if (rule.pattern.test(path)) {
      const level = PATH_LEVEL_SCORES[rule.level];
      return {
        score: level !== undefined ? level : 60,
        dangerLevel: rule.level,
        pathType: rule.type,
      };
    }
  }

  return { score: 60, dangerLevel: 'medium', pathType: '未知路径' };
}

// ============================================================
// D5 — 时间模式评分
// ============================================================

export function scoreD5(
  now: Date,
  recentSameToolCount: number,
  _recentTimeWindowMs: number = 5 * 60 * 1000,
): D5Score {
  const hour = now.getHours();
  const isOffHours = hour >= 22 || hour < 8;

  let score = 100;

  if (isOffHours) {
    score -= 20;
  }

  const freq = recentSameToolCount;
  if (freq >= 5) {
    score -= 30;
  } else if (freq >= 3) {
    score -= 15;
  } else if (freq >= 2) {
    score -= 5;
  }

  return { score: clamp(score, 0, 100), isOffHours, frequency: freq };
}

// ============================================================
// 综合置信度
// ============================================================

export function computeConfidence(dimensions: {
  d1: D1Score;
  d2: D2Score;
  d3: D3Score;
  d4: D4Score;
  d5: D5Score;
}): ConfidenceResult {
  const { d1, d2, d3, d4, d5 } = dimensions;

  const weighted =
    d1.score * WEIGHTS.d1 +
    d2.score * WEIGHTS.d2 +
    d3.score * WEIGHTS.d3 +
    d4.score * WEIGHTS.d4 +
    d5.score * WEIGHTS.d5;

  const totalWeight = WEIGHTS.d1 + WEIGHTS.d2 + WEIGHTS.d3 + WEIGHTS.d4 + WEIGHTS.d5;
  const confidence = Math.round(weighted / totalWeight);

  let decision: 'auto-approve' | 'confirm' | 'block';
  if (confidence >= 80) {
    decision = 'auto-approve';
  } else if (confidence >= 40) {
    decision = 'confirm';
  } else {
    decision = 'block';
  }

  return { confidence, dimensions: { d1, d2, d3, d4, d5 }, decision };
}

// ============================================================
// 工具函数
// ============================================================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
