/**
 * Sentinel AgentOS HTTP Server
 *
 * Lightweight Express HTTP API that wraps the full Sentinel AgentOS
 * pipeline behind RESTful JSON endpoints. Any language can call it.
 *
 * Quick start:
 *   npx sentinel-agentos server --port 3300
 *
 * Endpoints:
 *   POST /pipeline/pre       Pre-exec validation + risk scoring
 *   POST /pipeline/post      Post-exec verification + audit
 *   GET  /pipeline/report    Status report
 *   GET  /pipeline/profile   Agent quality profile
 *
 *   POST /guard/schema       Register schema rules
 *   GET  /guard/schema       List schema rules
 *
 *   POST /memory/preference  Set a preference
 *   POST /memory/fact        Add a fact
 *   POST /memory/rule        Learn a rule
 *   GET  /memory/context     Get injected context
 *
 *   GET  /audit              Query audit log
 *   GET  /health             Health check
 *
 *   POST /session/end        End session
 *   POST /feedback           Record implicit feedback
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as path from 'path';
import { AgentOS } from './core';
import type { SchemaRule } from './guard/schema-gate';
import { DashboardAPI } from './dashboard/api';
import { AuditAnalyzer } from './audit-analyzer';
import { findAuditFile, loadAuditEntries } from './dashboard/audit-source';
import { parseToolParameters, resolveEntryRisk } from './dashboard/entry-risk';

function extractTimelineParams(e: Record<string, unknown>): string {
  const obj = parseToolParameters(e.toolParameters ?? e.params);
  if (!obj) return '';

  if (typeof obj.command === 'string') return obj.command;
  if (typeof obj.value === 'string') return obj.value;
  if (typeof obj.path === 'string') {
    if (obj.content != null) {
      return JSON.stringify({ path: obj.path, content: obj.content });
    }
    return obj.path;
  }
  if (Array.isArray(obj.edits)) {
    const edits = obj.edits as Array<{ oldText?: string; newText?: string }>;
    return JSON.stringify({
      path: obj.path ?? obj.file ?? '',
      edits: edits.length,
      preview: edits[0]?.oldText?.slice(0, 100) ?? edits[0]?.newText?.slice(0, 100) ?? '',
    });
  }
  if (typeof obj.preview === 'string') {
    return JSON.stringify({
      path: obj.path ?? obj.file ?? '',
      preview: obj.preview.slice(0, 120),
    });
  }

  const s = JSON.stringify(obj);
  return s.length > 320 ? s.slice(0, 320) + '…' : s;
}

function extractSessionId(e: Record<string, unknown>): string | null {
  if (typeof e.sessionId === 'string' && e.sessionId) return e.sessionId;
  const obj = parseToolParameters(e.toolParameters ?? e.params);
  if (obj && typeof obj.sessionId === 'string') return obj.sessionId;
  const raw = String(e.toolParameters ?? e.params ?? '');
  const m = raw.match(/"sessionId"\s*:\s*"([^"]+)"/);
  return m?.[1] ?? null;
}

function toolPassRate(entries: Record<string, unknown>[], match: (tool: string) => boolean): number | null {
  const subset = entries.filter((e) => match(String(e.tool || e.toolName || '')));
  if (!subset.length) return null;
  const passed = subset.filter((e) => e.ok !== false).length;
  return Math.round((passed / subset.length) * 100);
}

function buildAuditReport(entries: Record<string, unknown>[]) {
  const total = entries.length;
  const fails = entries.filter((e) => e.ok === false || (e as { verifyGate?: { status?: string } }).verifyGate?.status === 'FAIL').length;
  const passes = total - fails;
  const passRate = total > 0 ? Math.round((passes / total) * 100) : 0;
  const highRisk = entries.filter((e) => resolveEntryRisk(e) > 5).length;

  const sessions = new Set<string>();
  for (const e of entries) {
    const sid = extractSessionId(e);
    if (sid) sessions.add(sid);
  }
  const activeDays = new Set(
    entries.map((e) => String(e.ts ?? e.completedAt ?? '').slice(0, 10)).filter(Boolean),
  );

  const preExecScore = passRate;
  const postExecScore = toolPassRate(entries, (t) => ['write', 'edit', 'exec'].includes(t)) ?? passRate;
  const satisfaction = toolPassRate(entries, (t) => ['read', 'memory_search', 'memory_get', 'web_search', 'web_fetch'].includes(t)) ?? passRate;
  const overallScore = Math.round(preExecScore * 0.4 + postExecScore * 0.35 + satisfaction * 0.25);

  const timelineLimit = 50;
  const timeline = entries.slice(-timelineLimit).map((e) => {
    const failed = e.ok === false || (e as { verifyGate?: { status?: string } }).verifyGate?.status === 'FAIL';
    return {
      tool: e.tool || e.toolName || 'exec',
      ts: e.completedAt || e.ts || Date.now(),
      params: extractTimelineParams(e),
      verify: failed ? 'FAIL' : 'PASS',
      risk: resolveEntryRisk(e),
    };
  });

  return {
    audit: {
      totalOperations: total,
      verifyFailures: fails,
      highRiskOps: highRisk,
      sessionsTracked: sessions.size || activeDays.size || 1,
      totalBlocked: fails,
      passRate,
    },
    quality: {
      overallScore,
      preExecScore,
      postExecScore,
      satisfaction,
      source: 'audit.jsonl',
    },
    meta: {
      timelineShown: timeline.length,
      timelineTotal: total,
      dataSource: 'audit.jsonl',
    },
    timeline,
  };
}

type ServerConfig = {
  port: number;
  host?: string;
  /** API token for authentication. If set, all requests must include `Authorization: Bearer <token>` */
  apiToken?: string;
  /** Workspace root for rules config */
  workspace?: string;
};

export function createServer(config?: Partial<ServerConfig>) {
  const port = config?.port ?? 3300;
  const host = config?.host ?? '127.0.0.1';
  const apiToken = config?.apiToken;
  const workspaceRoot = config?.workspace
    ?? process.env.OPENCLAW_WORKSPACE
    ?? path.resolve(process.cwd(), '..', '..');

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // ---- API Token Authentication ----
  if (apiToken) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      // Only health check is public
      if (req.path === '/health') {
        next();
        return;
      }

      const auth = req.headers.authorization;
      const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;

      if (token !== apiToken) {
        res.status(401).json({ error: 'Unauthorized: invalid or missing API token' });
        return;
      }

      next();
    });
  }

  // Each request gets its own AgentOS tracker, but we keep one base instance
  // for shared memory (semantic/episodic) and accumulated profile.
  const baseAos = new AgentOS();
  const dashAPI = new DashboardAPI(baseAos, workspaceRoot);
  const analyzer = new AuditAnalyzer(workspaceRoot);

  // 启动事故自动扫描
  analyzer.startAutoScan();

  // ---- Dashboard API Routes ----

  app.get('/api/stats', (_req: Request, res: Response) => {
    res.json(dashAPI.getStats());
  });

  app.get('/api/timeline', (_req: Request, res: Response) => {
    res.json(dashAPI.getTimeline());
  });

  app.get('/api/hotmap', (_req: Request, res: Response) => {
    res.json(dashAPI.getHotmap());
  });

  app.get('/api/audit', (req: Request, res: Response) => {
    const page = parseInt(String(req.query.page ?? '1'), 10);
    const pageSize = parseInt(String(req.query.pageSize ?? '20'), 10);
    res.json(dashAPI.getAuditPage(page, pageSize));
  });

  app.get('/api/health-runtime', (_req: Request, res: Response) => {
    res.json(dashAPI.getRuntimeHealth());
  });

  app.get('/api/debug/audit', (_req: Request, res: Response) => {
    const auditPath = findAuditFile(process.cwd(), workspaceRoot);
    const entries = loadAuditEntries(process.cwd(), undefined, workspaceRoot);
    res.json({
      auditPath,
      entryCount: entries.length,
      workspaceRoot,
      cwd: process.cwd(),
      timeline: dashAPI.getTimeline(),
      hotmapTop: dashAPI.getHotmap().slice(0, 5),
    });
  });

  // ---- Incidents API ----

  app.get('/api/incidents', (_req: Request, res: Response) => {
    analyzer.scan();
    res.json(analyzer.loadIncidents());
  });

  app.get('/api/incidents/meta', (_req: Request, res: Response) => {
    const auditPath = findAuditFile(process.cwd(), workspaceRoot);
    res.json({
      auditPath,
      incidentsDir: path.join(workspaceRoot, '.agentos', 'incidents'),
      scanIntervalSec: 3,
      rules: [
        'config_overwrite — openclaw.json 被清空',
        'high_risk_exec — 最近 50 条中 ≥3 次高风险 (score>5)',
        'mass_delete — 最近 30 条中 ≥5 次删除',
        'schema_violation — 最近 100 条中 ≥3 次 Schema 失败',
        'guard_blocks — 最近 100 条中 ≥5 次 Guard 拦截',
      ],
      total: analyzer.loadIncidents().length,
      unresolved: analyzer.loadUnresolved().length,
    });
  });

  app.get('/api/incidents/unresolved', (_req: Request, res: Response) => {
    res.json(analyzer.loadUnresolved());
  });

  app.post('/api/incidents/:id/resolve', (req: Request, res: Response) => {
    const ok = analyzer.resolveIncident(req.params.id as string);
    res.json({ ok });
  });

  app.get('/api/incidents/scan', (_req: Request, res: Response) => {
    const incidents = analyzer.scan();
    res.json({ scanned: true, newIncidents: incidents.length });
  });

  // ---- Rules API ----

  app.get('/api/rules', (_req: Request, res: Response) => {
    const configPath = require('path').join(workspaceRoot, '.agentos', 'rules.json');
    const fs2 = require('fs');
    let config = null;
    if (fs2.existsSync(configPath)) {
      try {
        config = JSON.parse(fs2.readFileSync(configPath, 'utf-8'));
      } catch { /* ignore */ }
    }
    // Always return the builtin keys + user config
    res.json({ config, path: configPath });
  });

  app.post('/api/rules/save', (req: Request, res: Response) => {
    const configPath = require('path').join(workspaceRoot, '.agentos', 'rules.json');
    const fs2 = require('fs');
    const body = req.body || {};
    // Merge: preserve version, _comment if not set
    if (!body.version) body.version = '1.0';
    fs2.writeFileSync(configPath, JSON.stringify(body, null, 2), 'utf-8');
    res.json({ ok: true });
  });

  // ---- Health ----

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  // ---- Dashboard ----

  const assetsDir = path.join(__dirname, '..', 'assets');
  app.use('/assets', express.static(assetsDir, { maxAge: '1h' }));

  const dashboardPath = path.join(__dirname, 'dashboard.html');
  let dashboardHtml = '<h1>Dashboard unavailable</h1>';
  try {
    dashboardHtml = require('fs').readFileSync(dashboardPath, 'utf-8');
  } catch {
    dashboardHtml = `<!DOCTYPE html><html><head><title>Sentinel AgentOS</title><meta charset="utf-8"><style>body{font-family:system-ui;background:#0d1117;color:#c9d1d9;display:grid;place-items:center;height:100vh;margin:0}h1{color:#58a6ff}a{color:#58a6ff}</style></head><body><div style="text-align:center"><h1>🛡️ Sentinel AgentOS</h1><p style="color:#8b949e">Dashboard requires authentication token.</p><p>Start server with <code>--token YOUR_TOKEN</code></p></div></body></html>`;
  }

  // Inject auth token into dashboard page for API calls
  const dashboardHtmlWithToken = dashboardHtml.replace('__TOKEN__', apiToken || '');

  app.get('/dashboard', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    res.type('html').send(dashboardHtmlWithToken);
  });

  // Rich report for dashboard — reads real workspace audit.jsonl
  app.get('/pipeline/report', (_req: Request, res: Response) => {
    const entries = loadAuditEntries(process.cwd(), undefined, workspaceRoot);
    const auditPath = findAuditFile(process.cwd(), workspaceRoot);

    const report = buildAuditReport(entries);
    res.json({
      ...report,
      meta: {
        ...report.meta,
        auditPath: auditPath ?? null,
      },
      uptime: `${Math.floor(process.uptime())}s`,
    });
  });

  // ---- Pipeline: Pre-exec ----

  app.post('/pipeline/pre', (req: Request, res: Response) => {
    try {
      const { sessionId, agentId, toolName, parameters, affectedFiles } = req.body;
      if (!toolName) {
        res.status(400).json({ error: 'toolName is required' });
        return;
      }

      const result = baseAos.executePipeline({
        sessionId: sessionId ?? 'http_session',
        agentId: agentId ?? 'http_agent',
        toolName,
        parameters: parameters ?? {},
        affectedFiles: affectedFiles ?? [],
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Pipeline: Post-exec ----

  app.post('/pipeline/post', (req: Request, res: Response) => {
    try {
      const {
        sessionId, agentId, toolName, toolParameters,
        toolResult, snapshot, startTime, endTime,
        retryCount, wasSelfCorrected, hadTimeout,
        userAccepted, userProvidedEdit, resultWasUsed,
      } = req.body;

      if (!toolName) {
        res.status(400).json({ error: 'toolName is required' });
        return;
      }

      const result = baseAos.completeExecution({
        sessionId: sessionId ?? 'http_session',
        agentId: agentId ?? 'http_agent',
        toolName,
        toolParameters: toolParameters ?? {},
        toolResult: toolResult ?? null,
        snapshot: snapshot ?? null,
        startTime: startTime ?? Date.now() - 100,
        endTime: endTime ?? Date.now(),
        retryCount: retryCount ?? 0,
        wasSelfCorrected: wasSelfCorrected ?? false,
        hadTimeout: hadTimeout ?? false,
        userAccepted: userAccepted ?? true,
        userProvidedEdit: userProvidedEdit ?? false,
        resultWasUsed: resultWasUsed ?? false,
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Pipeline: Profile ----

  app.get('/pipeline/profile', (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string | undefined;
    res.json(baseAos.getProfile(sessionId));
  });

  // ---- Guard: Register schema rules ----

  app.post('/guard/schema', (req: Request, res: Response) => {
    try {
      const rule: SchemaRule = req.body;
      if (!rule.tool) {
        res.status(400).json({ error: 'rule.tool is required' });
        return;
      }
      baseAos.guard.schema.registerRule(rule);
      res.json({ ok: true, tool: rule.tool });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Guard: List rules ----

  app.get('/guard/schema', (req: Request, res: Response) => {
    const toolName = req.query.tool as string | undefined;
    // SchemaGate doesn't expose a public list — use a partial dump
    res.json({ tool: toolName ?? '*', note: 'Schema rules are active but listing requires internal API upgrade' });
  });

  // ---- Memory ----

  app.post('/memory/preference', (req: Request, res: Response) => {
    const { key, value } = req.body;
    baseAos.memory.semantic.setPreference(key, value);
    res.json({ ok: true });
  });

  app.post('/memory/fact', (req: Request, res: Response) => {
    const { fact } = req.body;
    baseAos.memory.semantic.addFact(fact);
    res.json({ ok: true });
  });

  app.post('/memory/rule', (req: Request, res: Response) => {
    const { rule, source } = req.body;
    baseAos.memory.semantic.learnRule(rule, source);
    res.json({ ok: true });
  });

  app.get('/memory/context', (_req: Request, res: Response) => {
    res.json({ context: baseAos.injectContext() });
  });

  // ---- Audit ----

  app.get('/audit', (req: Request, res: Response) => {
    const limit = parseInt(String(req.query.limit ?? '20'), 10);
    const toolName = req.query.tool as string | undefined;
    const status = req.query.status as string | undefined;
    const entries = baseAos.guard.audit.query({
      limit,
      ...(toolName ? { toolName } : {}),
      ...(status ? { status } : {}),
    });
    res.json(entries);
  });

  // ---- Session ----

  app.post('/session/end', (req: Request, res: Response) => {
    const { sessionId } = req.body;
    baseAos.endSession(sessionId ?? 'http_session');
    res.json({ ok: true });
  });

  // ---- Feedback ----

  app.post('/feedback', (req: Request, res: Response) => {
    const { signal, sessionId, operationId, confidence, source } = req.body;
    baseAos.recordFeedback(signal, sessionId, operationId, confidence, source);
    res.json({ ok: true });
  });

  // ---- Error handling ----

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Sentinel HTTP]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  let server: ReturnType<typeof app.listen> | null = null;

  return {
    app,
    start: () => {
      return new Promise<void>((resolve, reject) => {
        server = app.listen(port, host, () => {
          console.log(`🛡️ Sentinel AgentOS HTTP server → http://${host}:${port}`);
          console.log(`   Health: http://${host}:${port}/health`);
          console.log(`   Audit:  ${findAuditFile(process.cwd(), workspaceRoot) ?? '(not found)'}`);
          resolve();
        });
        server?.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            reject(new Error(`Port ${port} is already in use. Stop the old server (Ctrl+C) and run npm start again.`));
          } else {
            reject(err);
          }
        });
      });
    },
    stop: () => {
      return new Promise<void>((resolve) => {
        server?.close(() => resolve());
      });
    },
    getPort: () => port,
    getInstance: () => baseAos,
  };
}

// Allow direct invocation via `npx ts-node src/server.ts` or compiled `node dist/server.js`
if (require.main === module) {
  const args = process.argv.slice(2);
  const portArg = args.indexOf('--port');
  const port = portArg >= 0 ? parseInt(args[portArg + 1] ?? '3300', 10) : 3300;
  const hostArg = args.indexOf('--host');
  const host = hostArg >= 0 ? args[hostArg + 1] ?? '127.0.0.1' : '127.0.0.1';

  createServer({ port, host }).start();
}
