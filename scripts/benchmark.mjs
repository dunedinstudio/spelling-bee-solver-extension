import { readFile } from 'node:fs/promises';
import { createSolver } from '../dist/chromium/solver.js';
import { at, save } from './common.mjs';

const bytes = await readFile(at('data/words.txt'), 'utf8');
const cases = ['coating', 'qxzjkvb', 'anbdome', 'eartins', 'naceirt'].map(letters => [...letters]);
global.gc?.();
const before = process.memoryUsage();
const start = performance.now();
const solve = createSolver(bytes.trimEnd().split('\n'));
const prepareMs = performance.now() - start;
global.gc?.();
const prepared = process.memoryUsage();
const observations = [];
for (const cells of cases) {
  for (let i = 0; i < 20; i++) solve(cells);
  const samples = [];
  for (let i = 0; i < 200; i++) {
    const start = performance.now(); solve(cells); samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  observations.push({ cells: cells.join(''), count: solve(cells).length, medianMs: (samples[99] + samples[100]) / 2, p95Ms: samples[189], maxMs: samples.at(-1) });
}
for (let i = 0; i < 1000; i++) solve(cases[i % cases.length]);
global.gc?.();
const after = process.memoryUsage();
const report = {
  node: process.version, platform: `${process.platform}/${process.arch}`, wordCount: bytes.trimEnd().split('\n').length,
  prepareMs, samples: observations,
  heapUsedBefore: before.heapUsed, heapUsedPrepared: prepared.heapUsed, heapUsedAfter: after.heapUsed,
  retainedPreparationHeapDeltaBytes: prepared.heapUsed - before.heapUsed,
  retainedHeapDeltaAfter1000SolvesBytes: after.heapUsed - prepared.heapUsed,
  arrayBufferDeltaBytes: prepared.arrayBuffers - before.arrayBuffers, gcAvailable: Boolean(global.gc),
  methodology: 'Node V8, current host, one index preparation; 20 warmups then 200 solves per puzzle, nearest-rank p95. 1000 further solves and GC for coarse retained heap comparison. Not a browser or ordinary-hardware guarantee.',
};
await save(at('evidence/benchmark.json'), report);
console.log(JSON.stringify(report, null, 2));
