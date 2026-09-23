import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const runDir = path.join(root, 'processes', 'compact-v2-live-acceptance-process', 'run-04');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const preflight = readJson(path.join(runDir, 'operator-preflight.json'));
const trace = readJson(path.join(runDir, 'runtime-window-visual-executed.json'));
const operation = readJson(
  path.join(root, '.photoshop-runtime', 'controller', 'operations', 'final-build-visual-20.json'),
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(preflight.loaded_child?.started_after_current_dist_build === true, 'preflight child/build ordering is not proven');
assert(preflight.uxp_companion?.connected === true, 'UXP companion is not proven connected');
assert(preflight.uxp_companion?.revision_match === true, 'UXP revision equality is not proven');
assert(operation.pid === preflight.loaded_child.pid, 'visual operation did not run under the preflighted child PID');
assert(operation.phase === 'completed', 'visual operation did not complete');
assert(operation.operation_receipt?.execution === 'completed', 'visual operation receipt is not completed');
assert(operation.verdict?.execution_outcome === 'completed', 'visual execution outcome is not completed');
assert(operation.verdict?.artistic_outcome === 'resolved', 'bounded visual target did not close as resolved');
assert(operation.preview?.sha256 && operation.preview?.sha256 !== operation.baseline_preview?.sha256, 'visual preview did not change');
assert(trace.no_legacy_helper_process_observed === true, 'legacy helper process was observed in the acceptance window');
assert(trace.no_photoshop_foreground_transition_observed === true, 'Photoshop foreground transition was observed');
assert(trace.photoshop_foreground_transition_count === 0, 'Photoshop foreground transition count is non-zero');

const result = {
  protocol: 'photoshop.final_runtime_acceptance.v1',
  passed: true,
  preflight_captured_at_utc: preflight.captured_at_utc,
  child_pid: preflight.loaded_child.pid,
  child_creation_utc: preflight.loaded_child.creation_utc,
  dist: preflight.dist,
  uxp_companion: preflight.uxp_companion,
  visual_operation: {
    operation_id: operation.id,
    tool: operation.tool,
    child_pid: operation.pid,
    phase: operation.phase,
    execution_outcome: operation.verdict.execution_outcome,
    artistic_outcome: operation.verdict.artistic_outcome,
    before_sha256: operation.baseline_preview?.sha256 ?? null,
    after_sha256: operation.preview?.sha256 ?? null,
    comparison_metric: operation.verdict.comparison_metric ?? null,
  },
  runtime_window: {
    started_at_utc: trace.started_at_utc,
    ended_at_utc: trace.ended_at_utc,
    sample_interval_ms: trace.sample_interval_ms,
    photoshop_foreground_transition_count: trace.photoshop_foreground_transition_count,
    legacy_helper_processes: trace.legacy_helper_processes,
    no_legacy_helper_process_observed: trace.no_legacy_helper_process_observed,
    no_photoshop_foreground_transition_observed: trace.no_photoshop_foreground_transition_observed,
  },
};

const output = path.join(runDir, 'final-runtime-verification.json');
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(output);
