#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const WORKER = path.join(__dirname, 'task19-cache-ab-worker.ts');
const DEFAULT_OUTPUT = path.join(ROOT, 'docs', 'task19-cache-ab-benchmark.json');

export function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarize(rows) {
  const summary = {};
  for (const condition of ['cold', 'warm']) {
    const selected = rows.filter(row => row.condition === condition);
    summary[condition] = {
      n: selected.length,
      preparation_host_calls_median: median(selected.map(row => row.preparation_host_calls)),
      preparation_cache_hits_median: median(selected.map(row =>
        row.preparation_cache_events.filter(event => event.reason === 'hit').length)),
      preparation_cache_misses_median: median(selected.map(row =>
        row.preparation_cache_events.filter(event => String(event.reason).startsWith('miss_')).length)),
      guard_preflight_ms_median: median(selected.map(row => row.guard_preflight_ms)),
      photoshop_dispatch_ms_median: median(selected.map(row => row.photoshop_dispatch_ms)),
      semantic_cycle_wall_ms_median: median(selected.map(row => row.semantic_cycle_wall_ms)),
    };
  }
  return summary;
}

export function runBenchmark({ pairs = 3 } = {}) {
  const rows = [];
  const childPids = [];
  for (let pair = 1; pair <= pairs; pair++) {
    const child = spawnSync(process.execPath, ['--import', 'tsx', WORKER, String(pair)], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, PHOTOSHOP_GUARD_MODE: 'off' },
    });
    if (child.status !== 0) throw new Error(`pair ${pair} child failed (${child.status}): ${child.stderr || child.stdout}`);
    const line = child.stdout.trim().split(/\r?\n/).at(-1);
    const payload = JSON.parse(line);
    if (!Array.isArray(payload.rows) || payload.rows.length !== 2) throw new Error(`pair ${pair} emitted invalid row count`);
    rows.push(...payload.rows);
    childPids.push(payload.rows[0].child_pid);
  }
  const summary = summarize(rows);
  return {
    schema: 'photoshop.task19.cache_ab_benchmark.v1',
    generated_at: new Date().toISOString(),
    mode: 'repository-safe-synthetic-dispatch',
    pairs,
    child_process_cold_reset: new Set(childPids).size === pairs,
    child_pids: childPids,
    safety: {
      photoshop_invoked: false,
      artwork_mutation: false,
      note: 'Exercises production VisualMicroPlan preparation-cache code with delayed local handlers; paint handler is synthetic and never calls Photoshop.',
    },
    rows,
    medians: summary,
    observed_improvement: {
      preparation_host_calls: summary.warm.preparation_host_calls_median < summary.cold.preparation_host_calls_median,
      semantic_cycle_wall_ms: summary.warm.semantic_cycle_wall_ms_median < summary.cold.semantic_cycle_wall_ms_median,
    },
    limitation: 'Repository measurement only. guard_preflight_ms measures preflightVisualMicroPlanForExecution, not the full embedded Guard compiler. It does not establish compact-v2 live Photoshop preparation-cache latency or live Guard capability-snapshot cold timing.',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = path.resolve(process.argv[2] ?? DEFAULT_OUTPUT);
  const result = runBenchmark({ pairs: 3 });
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ output, medians: result.medians, observed_improvement: result.observed_improvement }, null, 2) + '\n');
}
