#!/usr/bin/env node

/**
 * Sentinel AgentOS CLI
 *
 * Command-line interface for Sentinel AgentOS operations.
 *
 * Quick start:
 *   npx sentinel-agentos validate --tool write_file --params '{"path":"foo.ts"}'
 *   npx sentinel-agentos audit --limit 10
 *   npx sentinel-agentos status
 *   npx sentinel-agentos server --port 3300
 */

import { AgentOS } from './core';

function printHelp(): void {
  console.log(`
🛡️ Sentinel AgentOS CLI

Usage:
  sentinel-agentos <command> [options]

Commands:
  validate     Validate tool parameters against schema rules
  risk         Calculate risk score for a tool call
  audit        Query the audit log
  stats        Show audit statistics
  profile      Show agent quality profile
  status       Show full status report
  server       Start HTTP API server
  memory       Show memory context
  help         Show this help

Examples:
  sentinel-agentos validate --tool exec --params '{"command":"rm -rf /"}'
  sentinel-agentos risk --tool delete_file --params '{"path":"config.key"}'
  sentinel-agentos audit --limit 10
  sentinel-agentos status
  sentinel-agentos server --port 3300
`);
}

function fatal(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg && arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      const next = args[i + 1];
      const val = (next !== undefined && !next.startsWith('--')) ? next : 'true';
      result[key] = val;
      if (val !== 'true') i++;
    }
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? '';
  const opts = parseArgs(args.slice(1));

  if (!cmd || cmd === 'help') {
    printHelp();
    return;
  }

  const aos = new AgentOS();

  switch (cmd) {
    case 'validate': {
      const tool = opts.tool ?? fatal('--tool required');
      const params = opts.params ? JSON.parse(opts.params) : {};
      const result = aos.executePipeline({
        sessionId: 'cli',
        agentId: 'cli',
        toolName: tool,
        parameters: params,
      });
      console.log(JSON.stringify(result.preExec.schemaCheck, null, 2));
      break;
    }

    case 'risk': {
      const tool = opts.tool ?? fatal('--tool required');
      const params = opts.params ? JSON.parse(opts.params) : {};
      const result = aos.executePipeline({
        sessionId: 'cli',
        agentId: 'cli',
        toolName: tool,
        parameters: params,
      });
      console.log(JSON.stringify(result.preExec.riskScore, null, 2));
      break;
    }

    case 'audit': {
      const limit = parseInt(opts.limit ?? '20', 10);
      const entries = aos.guard.audit.query({ limit });
      console.log(JSON.stringify(entries, null, 2));
      break;
    }

    case 'stats': {
      const stats = aos.getAuditStats();
      console.log(JSON.stringify(stats, null, 2));
      break;
    }

    case 'profile': {
      const profile = aos.getProfile();
      console.log(JSON.stringify(profile, null, 2));
      break;
    }

    case 'status': {
      console.log(aos.statusReport());
      break;
    }

    case 'server': {
      const port = parseInt(opts.port ?? '3300', 10);
      const host = opts.host ?? '127.0.0.1';
      const token = opts.token;

      // Dynamic import to avoid requiring express at CLI startup
      try {
        const { createServer } = await import('./server');
        const server = createServer({ port, host, apiToken: token });
        await server.start();
        console.log('Press Ctrl+C to stop');

        process.on('SIGINT', async () => {
          console.log('\nShutting down...');
          await server.stop();
          process.exit(0);
        });
      } catch (err: any) {
        fatal(`Failed to start server: ${err.message}`);
      }
      break;
    }

    case 'memory': {
      const context = aos.injectContext();
      console.log(context || '(no memory context yet)');
      break;
    }

    default:
      fatal(`Unknown command: ${cmd}. Run 'sentinel-agentos help' for usage.`);
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
