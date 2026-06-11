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
import { AgentOS } from './core';
import type { SchemaRule } from './guard/schema-gate';

type ServerConfig = {
  port: number;
  host?: string;
  /** API token for authentication. If set, all requests must include `Authorization: Bearer <token>` */
  apiToken?: string;
};

export function createServer(config?: Partial<ServerConfig>) {
  const port = config?.port ?? 3300;
  const host = config?.host ?? '127.0.0.1';
  const apiToken = config?.apiToken;

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // ---- API Token Authentication ----
  if (apiToken) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      // Skip health check and dashboard (static page)
      if (req.path === '/health' || req.path === '/dashboard' || req.path.startsWith('/dashboard/')) {
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

  // ---- Health ----

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  // ---- Dashboard ----

  const dashboardHtml = require('fs').readFileSync(
    require('path').join(__dirname, 'dashboard.html'), 'utf-8'
  );

  app.get('/dashboard', (_req: Request, res: Response) => {
    res.type('html').send(dashboardHtml);
  });

  // Rich report for dashboard
  app.get('/pipeline/report', (_req: Request, res: Response) => {
    const r = baseAos.getReport();
    const audit = baseAos.guard.audit.query({ limit: 20 });
    res.json({
      ...r,
      uptime: `${Math.floor(process.uptime())}s`,
      timeline: audit.map(e => ({
        tool: e.toolName, ts: e.completedAt, verify: e.verifyGate.status, risk: e.riskGate.score,
      })),
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

  // ---- Pipeline: Report ----

  app.get('/pipeline/report', (_req: Request, res: Response) => {
    res.json({ report: baseAos.statusReport() });
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
      return new Promise<void>((resolve) => {
        server = app.listen(port, host, () => {
          console.log(`🛡️ Sentinel AgentOS HTTP server → http://${host}:${port}`);
          console.log(`   Health: http://${host}:${port}/health`);
          resolve();
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
