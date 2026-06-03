#!/usr/bin/env node

import { Command } from 'commander';
import { review } from './reviewer.js';
import { readFileSync } from 'fs';

const program = new Command();

program
  .name('coderev')
  .description('AI-powered code review agent')
  .version('0.1.0');

program
  .command('review')
  .description('Review a diff or source file')
  .argument('<path>', 'Path to diff file or source file')
  .option('-f, --format <fmt>', 'Output format: terminal|json', 'terminal')
  .action(async (path: string, options: { format: string }) => {
    try {
      const content = readFileSync(path, 'utf-8');
      const results = await review(content);
      
      if (options.format === 'json') {
        console.log(JSON.stringify(results, null, 2));
      } else {
        for (const r of results) {
          const icon = r.severity === 'error' ? '🔴' : r.severity === 'warning' ? '🟡' : '🔵';
          console.log(`${icon} [${r.severity.toUpperCase()}] ${r.rule}`);
          console.log(`   ${r.message}`);
          if (r.line) console.log(`   Line ${r.line}`);
          console.log();
        }
        console.log(`\n📊 Total: ${results.length} issues found`);
      }
    } catch (err) {
      console.error('❌ Error:', (err as Error).message);
      process.exit(1);
    }
  });

program.parse();
