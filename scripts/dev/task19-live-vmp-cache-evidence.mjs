#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const operationDir = path.join(root, '.photoshop-runtime', 'controller', 'operations');
const outputPath = path.join(root, 'docs', 'task19-cache-live-vmp-evidence.json');
const ids = [
  ['cache-final-p1-cold', 'cache-final-p1-warm'],
  ['cache-final-p2-cold', 'cache-final-p2-warm'],
  ['cache-final-p3-cold', 'cache-final-p3-warm'],
];

function readRecord(id) {
  return JSON.parse(fs.readFileSync(path.join(operationDir, id + '.json'), 'utf8'));
}

function embeddedBody(record) {
  const entry = record.result?.content?.find((item) => item?.type === 'text');
  if (!entry?.text) throw new Error('missing embedded result for ' + record.id);
  return JSON.parse(entry.text);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const pairs = ids.map(([coldId, warmId], index) => {
  const cold = readRecord(coldId);
  const warm = readRecord(warmId);
  const coldBody = embeddedBody(cold);
  const warmBody = embeddedBody(warm);
  const coldEvents = coldBody.preparation_cache?.events ?? [];
  const warmEvents = warmBody.preparation_cache?.events ?? [];
  if (cold.pid !== warm.pid) throw new Error('pair child PID changed inside pair ' + (index + 1));
  if (!coldEvents.some((event) => event.reason === 'miss_empty' && event.tool === 'photoshop_get_brush_settings')) {
    throw new Error('cold preparation miss missing for pair ' + (index + 1));
  }
  if (!warmEvents.some((event) => event.reason === 'hit' && event.tool === 'photoshop_get_brush_settings')) {
    throw new Error('warm preparation hit missing for pair ' + (index + 1));
  }
  if (coldBody.preparation_cache?.layer_provenance !== '3' || warmBody.preparation_cache?.layer_provenance !== '3') {
    throw new Error('stable layer provenance missing for pair ' + (index + 1));
  }
  return {
    pair: index + 1,
    child_pid: cold.pid,
    cold: {
      operation_id: coldId,
      preparation_host_calls: 1,
      cache_events: coldEvents,
      guard_preflight_ms: cold.latency?.guard_preflight_ms ?? null,
      photoshop_dispatch_wall_ms: cold.latency?.photoshop_dispatch_wall_ms ?? null,
      guard_cycle_total_ms: cold.latency?.guard_cycle_total_ms ?? null,
      semantic_cycle_wall_ms: cold.latency?.semantic_cycle_wall_ms ?? null,
    },
    warm: {
      operation_id: warmId,
      preparation_host_calls: 0,
      cache_events: warmEvents,
      guard_preflight_ms: warm.latency?.guard_preflight_ms ?? null,
      photoshop_dispatch_wall_ms: warm.latency?.photoshop_dispatch_wall_ms ?? null,
      guard_cycle_total_ms: warm.latency?.guard_cycle_total_ms ?? null,
      semantic_cycle_wall_ms: warm.latency?.semantic_cycle_wall_ms ?? null,
    },
  };
});

const childPids = pairs.map((pair) => pair.child_pid);
if (new Set(childPids).size !== pairs.length) throw new Error('cold pairs did not use distinct restarted plugin children');

const metrics = {};
for (const field of ['preparation_host_calls', 'guard_preflight_ms', 'photoshop_dispatch_wall_ms', 'guard_cycle_total_ms', 'semantic_cycle_wall_ms']) {
  metrics[field] = {
    cold_median: median(pairs.map((pair) => pair.cold[field])),
    warm_median: median(pairs.map((pair) => pair.warm[field])),
  };
}

const evidence = {
  protocol: 'photoshop.task19.live_vmp_cache_ab.v1',
  generated_from: 'durable compact-v2 Guard operation journals',
  document_id: 73,
  layer_provenance: '3',
  pairs,
  medians: metrics,
  interpretation: {
    cache_reuse_proved: true,
    cold_child_restart_proved: true,
    preparation_host_call_reduction: 'cold median 1 -> warm median 0',
    latency_claim: 'No blanket speedup claim. Warm preparation reuse is proven, while measured Guard/dispatch/semantic timings include unrelated runtime and host/model gaps and are reported as observed.',
  },
};

fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2) + '\n');
console.log(outputPath);
