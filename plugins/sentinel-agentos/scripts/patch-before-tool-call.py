#!/usr/bin/env python3
"""Patch the before_tool_call hook to add confidence scoring (v1.4)."""

import sys, os

script_dir = os.path.dirname(os.path.abspath(__file__))
src_path = os.path.join(script_dir, '..', 'src', 'index.ts')

with open(src_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Step 1: Add getRiskScore before plugin entry
old_marker = '═══════════════════════════════════════\n// 插件入口'
new_marker = '''═══════════════════════════════════════
// getRiskScore — 简易版风险评分（不依赖核心包 RiskGate）
// ═══════════════════════════════════════

const SIMPLE_RISK_2: Record<string, number> = {
  exec: 3, write: 2, edit: 2, delete: 4, read: 0.3,
  web_search: 0.5, web_fetch: 0.5, apply_patch: 3,
};

function getRiskScore(toolName: string, params?: Record<string, unknown>): number {
  const base = SIMPLE_RISK_2[toolName] ?? 1;
  const cmd = String(params?.command || "");
  if (/rm\\s+-rf\\s+\\//.test(cmd)) return 10;
  if (/sudo/.test(cmd)) return 8;
  if (/drop\\s|truncate\\s|format\\s/.test(cmd)) return 9;
  if (/git\\s+push\\s+--force/.test(cmd)) return 5;
  if (/npm\\s+publish/.test(cmd)) return 4;
  return base;
}

''' + old_marker

if old_marker in content:
    content = content.replace(old_marker, new_marker, 1)
    print("✅ getRiskScore added")
else:
    print("⚠️ getRiskScore marker not found, checking if already added...")
    if 'getRiskScore' in content:
        print("  Already present, skipping")
    else:
        print("  ERROR: cannot find insertion point")
        sys.exit(1)

# Step 2: Replace the before_tool_call hook body
old_hook_marker = """    // ══════════════════════════════════
    // Hook 1: before_tool_call — 确定性拦截 (P100)
    //
    // 纯内存、纯正则、零 I/O。
    // 即使 AgentOS 未就绪也正常工作（规则是硬编码的）。
    // ══════════════════════════════════

    api.on("before_tool_call", async (event: ToolCallEvent) => {
      const { toolName, params } = event;
      const p = (params as Record<string, unknown>)?.path || (params as Record<string, unknown>)?.file || "";

      // 构建上下文提示
      const contextHint = lastAIMessage
        ? `\\n\\n📋 最近任务: ${lastAIMessage}`
        : "";

      // ── 危险命令拦截 ──
      if (toolName === "exec" && (params as Record<string, unknown>)?.command) {
        const cmd = String((params as Record<string, unknown>).command);
        // 展开 inline 脚本中的字符串拼接绕过（e.g. 'np'+'m pu'+'blish'）
        const expandedCmd = expandNodeEval(cmd);
        const checkCmd = expandedCmd || cmd;
        for (const [re, desc] of DANGEROUS_COMMANDS) {
          if (re.test(checkCmd)) {
            return {
              requireApproval: {
                title: "\\uD83D\\uDEAB Sentinel 拦截",
                description: `Sentinel: ${desc}\\n\\n命令: ${cmd.substring(0, 200)}${contextHint}`,
                severity: "critical" as const,
                timeoutMs: 60_000,
                timeoutBehavior: "deny" as const,
              },
            };
          }
        }
        for (const [re, desc] of WARNING_COMMANDS) {
          if (re.test(checkCmd)) {
            return {
              requireApproval: {
                title: "\\u26A0\\uFE0F 需要确认",
                description: `Sentinel: ${desc}\\n\\n命令: ${cmd.substring(0, 200)}${contextHint}`,
                severity: "warning" as const,
                timeoutMs: 60_000,
                timeoutBehavior: "deny" as const,
              },
            };
          }
        }
      }

      // ── 敏感文件拦截 ──
      if (p && ["write", "edit", "delete", "read"].includes(toolName)) {
        for (const ptn of SENSITIVE_PATTERNS) {
          if (globMatch(ptn, String(p))) {
            return { block: true, blockReason: `\\uD83D\\uDEAB Sentinel: 敏感文件 — "${p}" 匹配 "${ptn}"` };
          }
        }
      }

      // ── 保护文件确认 ──
      if (p && ["write", "edit", "delete"].includes(toolName)) {
        for (const pf of PROTECTED_PATTERNS) {
          if (globMatch(pf, String(p))) {
            return {
              requireApproval: {
                title: "\\u26A0\\uFE0F 修改核心配置",
                description: `Sentinel: 文件 "${p}" 受保护，修改可能导致系统不可用。确认继续？${contextHint}`,
                severity: "warning" as const,
                timeoutMs: 60_000,
                timeoutBehavior: "deny" as const,
              },
            };
          }
        }
      }

      // ── 内容语法校验 ──
      if (p && ["write", "edit"].includes(toolName) && (params as Record<string, unknown>)?.content) {
        const err = validateContent(String(p), String((params as Record<string, unknown>).content));
        if (err) {
          return { block: true, blockReason: `\\uD83D\\uDEAB Sentinel: ${err}` };
        }
      }
    }, { priority: 100 });"""

new_hook_marker = """    // ══════════════════════════════════
    // Hook 1: before_tool_call — 置信度评分 + 确定性拦截 (P100)
    //
    // v1.4 智能审批：先算置信度，再根据分数调整弹窗行为。
    // 高置信度操作 → 减少弹窗；低置信度 → 严格拦截。
    // ══════════════════════════════════

    api.on("before_tool_call", async (event: ToolCallEvent) => {
      const { toolName, params } = event;
      const p = (params as Record<string, unknown>)?.path || (params as Record<string, unknown>)?.file || "";

      // 构建上下文提示
      const contextHint = lastAIMessage
        ? `\\n\\n📋 最近任务: ${lastAIMessage}`
        : "";

      // ---- 计算置信度 ----
      const riskScore = getRiskScore(toolName, params);
      const confidenceResult = computeConfidence(toolName, params || {}, riskScore, lastAIMessage);

      // 记录行为
      recordBehavior(toolName, params || {}, true, true);

      // 如果置信度 >= 80，直接放行（不弹窗）
      if (confidenceResult.decision === "auto-approve") {
        return;
      }

      // 如果置信度 < 40，直接拦截
      if (confidenceResult.decision === "block") {
        const reason = `置信度过低 (${confidenceResult.confidence}/100)`;
        if (confidenceResult.alternatives.length > 0) {
          return { block: true, blockReason: `\\uD83D\\uDEAB Sentinel: ${reason}\\n\\n\\uD83D\\uDCA1 替代方案:\\n${confidenceResult.alternatives.map(a => `  \\u2022 ${a}`).join("\\n")}` };
        }
        return { block: true, blockReason: `\\uD83D\\uDEAB Sentinel: ${reason}` };
      }

      // 置信度 40-79：需要确认，构建信心摘要
      const { d1, d2, d3, d4, d5 } = confidenceResult.dimensions;
      const confSummary =
        `\\uD83D\\uDCCA 置信度: ${confidenceResult.confidence}/100\\n` +
        `  D1(命令风险): ${d1.score}/100\\n` +
        `  D2(历史行为): ${d2.score}/100 (${d2.matchLevel}, ${d2.count}次)\\n` +
        `  D3(上下文匹配): ${d3.score}/100 (${d3.matched}/${d3.total}关键词)\\n` +
        `  D4(路径敏感): ${d4.score}/100 (${d4.pathType})\\n` +
        `  D5(时间模式): ${d5.score}/100${d5.offHours ? " \\uD83C\\uDF19" : ""}`;

      // ── 危险命令拦截 ──
      if (toolName === "exec" && (params as Record<string, unknown>)?.command) {
        const cmd = String((params as Record<string, unknown>).command);
        const expandedCmd = expandNodeEval(cmd);
        const checkCmd = expandedCmd || cmd;
        for (const [re, desc] of DANGEROUS_COMMANDS) {
          if (re.test(checkCmd)) {
            return {
              requireApproval: {
                title: "\\uD83D\\uDEAB Sentinel 拦截",
                description: `${confSummary}\\n\\nSentinel: ${desc}\\n\\n命令: ${cmd.substring(0, 200)}${contextHint}`,
                severity: "critical" as const,
                timeoutMs: 60_000,
                timeoutBehavior: "deny" as const,
              },
            };
          }
        }
        for (const [re, desc] of WARNING_COMMANDS) {
          if (re.test(checkCmd)) {
            return {
              requireApproval: {
                title: "\\u26A0\\uFE0F 需要确认",
                description: `${confSummary}\\n\\nSentinel: ${desc}\\n\\n命令: ${cmd.substring(0, 200)}${contextHint}`,
                severity: "warning" as const,
                timeoutMs: 60_000,
                timeoutBehavior: "deny" as const,
              },
            };
          }
        }
      }

      // ── 敏感文件拦截 ──
      if (p && ["write", "edit", "delete", "read"].includes(toolName)) {
        for (const ptn of SENSITIVE_PATTERNS) {
          if (globMatch(ptn, String(p))) {
            return { block: true, blockReason: `\\uD83D\\uDEAB Sentinel: 敏感文件 — "${p}" 匹配 "${ptn}"` };
          }
        }
      }

      // ── 保护文件确认 ──
      if (p && ["write", "edit", "delete"].includes(toolName)) {
        for (const pf of PROTECTED_PATTERNS) {
          if (globMatch(pf, String(p))) {
            return {
              requireApproval: {
                title: "\\u26A0\\uFE0F 修改核心配置",
                description: `${confSummary}\\n\\nSentinel: 文件 "${p}" 受保护，修改可能导致系统不可用。确认继续？${contextHint}`,
                severity: "warning" as const,
                timeoutMs: 60_000,
                timeoutBehavior: "deny" as const,
              },
            };
          }
        }
      }

      // ── 内容语法校验 ──
      if (p && ["write", "edit"].includes(toolName) && (params as Record<string, unknown>)?.content) {
        const err = validateContent(String(p), String((params as Record<string, unknown>).content));
        if (err) {
          return { block: true, blockReason: `\\uD83D\\uDEAB Sentinel: ${err}` };
        }
      }

      // 置信度确认级别且没有匹配到规则 → 也弹通用确认
      return {
        requireApproval: {
          title: "\\u26A0\\uFE0F 操作需要确认",
          description: `${confSummary}\\n\\n操作: ${toolName}\\n${contextHint}`,
          severity: "warning" as const,
          timeoutMs: 60_000,
          timeoutBehavior: "deny" as const,
        },
      };
    }, { priority: 100 });"""

if old_hook_marker in content:
    content = content.replace(old_hook_marker, new_hook_marker, 1)
    print("✅ before_tool_call hook updated with confidence scoring")
else:
    print("⚠️ before_tool_call marker not found, checking if already updated...")
    if 'confidenceResult' in content:
        print("  Already contains confidence scoring, skipping")
    else:
        print("  ERROR: cannot find before_tool_call to patch")
        print(f"  Looking for marker (first 80 chars): {repr(old_hook_marker[:80])}")
        # Debug: find similar text
        idx = content.find('before_tool_call')
        if idx >= 0:
            print(f"  Found 'before_tool_call' at position {idx}")
            print(f"  Context: ...{content[idx-30:idx+50]}...")
        sys.exit(1)

with open(src_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Plugin index.ts patched successfully")
print(f"  File size: {os.path.getsize(src_path)} bytes")
