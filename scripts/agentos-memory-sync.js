/**
 * AgentOS Memory Sync — 每次心跳/会话结束时同步
 *
 * 核心逻辑：
 * 1. 读取 memory/YYYY-MM-DD.md 提取关键事件 → Episodic
 * 2. 读取 self-improving/ 提取规则 → Semantic
 * 3. 生成上下文块追加到 MEMORY.md 末尾（新 session 自动加载）
 *
 * 运行: node scripts/agentos-memory-sync.js
 */
const path = require('path');
const fs = require('fs');

const WORKSPACE = path.resolve(__dirname, '..');
const DIST = path.join(WORKSPACE, 'projects', 'agentos', 'dist', 'adapters', 'memory-bridge.js');

try { require(DIST); } catch {
  require('ts-node').register({
    project: path.join(WORKSPACE, 'projects', 'agentos', 'tsconfig.json'),
  });
}

const { MemoryBridge } = require(DIST);

const bridge = new MemoryBridge(WORKSPACE);
const now = new Date();
const dateKey = now.toISOString().split('T')[0];
const dailyFile = path.join(WORKSPACE, 'memory', `${dateKey}.md`);

// === 1. 从今天日志同步 Episodic 事件（去重：已存在的事件不再追加）===
if (fs.existsSync(dailyFile)) {
  // 获取已有事件内容做去重
  const existingSet = new Set();
  const epiEvents = bridge.episodic?.events || [];
  for (const ev of epiEvents) {
    existingSet.add(`${ev.type}::${ev.content}`);
  }

  const content = fs.readFileSync(dailyFile, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('##')) {
      const title = trimmed.replace(/^#+\s*/, '');
      const key = `note::${title}`;
      if (!existingSet.has(key)) {
        bridge.recordEvent('note', title, ['daily', 'section'], []);
        existingSet.add(key);
      }
    } else if (trimmed.match(/^-\s*[✅❌🔧📦🧠]/) || trimmed.startsWith('- **')) {
      const snippet = trimmed.slice(0, 200);
      if (trimmed.includes('修复') || trimmed.includes('fix')) {
        const key = `tool_call::${snippet}`;
        if (!existingSet.has(key)) {
          bridge.recordEvent('tool_call', snippet, ['fix', dateKey], []);
          existingSet.add(key);
        }
      } else if (trimmed.includes('发布') || trimmed.includes('publish')) {
        const key = `publish::${snippet}`;
        if (!existingSet.has(key)) {
          bridge.recordEvent('publish', snippet, ['publish', dateKey], []);
          existingSet.add(key);
        }
      } else if (trimmed.includes('完成') || trimmed.includes('✅')) {
        const key = `milestone::${snippet}`;
        if (!existingSet.has(key)) {
          bridge.recordEvent('milestone', snippet, ['done', dateKey], []);
          existingSet.add(key);
        }
      }
    }
  }
}

// === 2. 同步 self-improving 规则到 Semantic ===
const selfDir = path.join(WORKSPACE, 'self-improving');
if (fs.existsSync(selfDir)) {
  const corrFile = path.join(selfDir, 'corrections.md');
  const memFile = path.join(selfDir, 'memory.md');

  if (fs.existsSync(corrFile)) {
    const corrs = fs.readFileSync(corrFile, 'utf-8');
    for (const line of corrs.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ') && trimmed.length > 10) {
        bridge.learnRule(trimmed.replace(/^-\s*/, ''), `corrections-${dateKey}`);
      }
    }
  }

  if (fs.existsSync(memFile)) {
    const mem = fs.readFileSync(memFile, 'utf-8');
    for (const line of mem.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ') && trimmed.length > 15) {
        bridge.learnRule(trimmed.replace(/^-\s*/, ''), `self-improving-${dateKey}`);
      }
    }
  }
}

// === 3. 结束当前 session 记录（用固定 key 避免每小时重复）===
bridge.recordEvent('note', `Sync completed`, ['sync', dateKey], []);
bridge.onSessionEnd(true);
bridge.flush();

// === 4. 生成上下文块并追加到 MEMORY.md ===
const context = bridge.onSessionStart();
const block = [
  '',
  '---',
  '',
  '## 🧠 AgentOS Memory (auto-synced)',
  '',
  context || '_暂无记忆数据_',
  '',
].join('\n');

// 写入独立文件（备用）
const ctxFile = path.join(WORKSPACE, 'memory', 'agentos-memory.md');
fs.writeFileSync(ctxFile, block, 'utf-8');

// 追加到 MEMORY.md（新 session 启动时自动加载）
const memoryMd = path.join(WORKSPACE, 'MEMORY.md');
if (fs.existsSync(memoryMd)) {
  let memContent = fs.readFileSync(memoryMd, 'utf-8');

  // 移除旧的 AgentOS 块
  const marker = '## 🧠 AgentOS Memory (auto-synced)';
  const idx = memContent.indexOf(marker);
  if (idx !== -1) {
    const nextSep = memContent.indexOf('\n---', idx + marker.length);
    if (nextSep !== -1) {
      memContent = memContent.slice(0, idx).trimEnd() + '\n' + memContent.slice(nextSep);
    } else {
      memContent = memContent.slice(0, idx).trimEnd() + '\n';
    }
  }

  memContent = memContent.trimEnd() + '\n' + block + '\n';
  fs.writeFileSync(memoryMd, memContent, 'utf-8');
  console.error(`[AgentOS] MEMORY.md updated`);
}

console.error(`[AgentOS] Memory synced @ ${now.toISOString()}`);
console.error(`  Episodic: ${bridge.getEpisodicMemory().count} events`);
console.error(`  Semantic: ${bridge.getSemanticMemory().getMemory().userFacts.length} facts`);
