import { AgentOS } from './src';

const aos = new AgentOS({ workspaceRoot: process.cwd() });

const r = aos.computeConfidence(
  'exec',
  { command: 'npm publish --access public' },
  { score: 8.5 },
  'publish new version to npm',
  'publisher',
);

console.log(JSON.stringify({
  confidence: r.confidence,
  decision: r.decision,
  creditLevel: (r.dimensions as any).creditLevel,
  boost: (r.dimensions as any).creditBoost,
  d1: r.dimensions.d1.score,
  d2: r.dimensions.d2.score,
  d3: r.dimensions.d3.score,
  d4: r.dimensions.d4.score,
  d5: r.dimensions.d5.score,
}, null, 2));
