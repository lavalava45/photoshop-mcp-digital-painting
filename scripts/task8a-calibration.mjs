#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
export const DEFAULT_MANIFEST = path.join(ROOT, 'tests', 'fixtures', 'task8a-heldout-manifest.json');

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function validateManifest(manifest, root = ROOT) {
  const errors = [];
  const ids = new Set();
  for (const item of manifest.cases ?? []) {
    if (!/^case-\d{3}$/.test(item.case_id)) errors.push(`non-neutral case id: ${item.case_id}`);
    if (ids.has(item.case_id)) errors.push(`duplicate case id: ${item.case_id}`);
    ids.add(item.case_id);
    if (!/^case-\d{3}-before\.(?:jpg|png)$/.test(item.neutral_before_filename)) {
      errors.push(`non-neutral before filename: ${item.neutral_before_filename}`);
    }
    if (!/^case-\d{3}-after\.(?:jpg|png)$/.test(item.neutral_after_filename)) {
      errors.push(`non-neutral after filename: ${item.neutral_after_filename}`);
    }
    if (!fs.existsSync(path.resolve(root, item.source_before))) errors.push(`missing source_before: ${item.case_id}`);
    if (!fs.existsSync(path.resolve(root, item.source_after))) errors.push(`missing source_after: ${item.case_id}`);
    if (item.human_reference !== null && typeof item.human_reference !== 'object') {
      errors.push(`invalid human_reference shape: ${item.case_id}`);
    }
  }
  const baselineBudget = JSON.stringify(manifest.evidence_budget?.baseline ?? []);
  const criticBudget = JSON.stringify(manifest.evidence_budget?.critic ?? []);
  if (baselineBudget !== criticBudget) errors.push('baseline and critic evidence budgets differ');
  if (manifest.evidence_budget?.producer_reports_withheld !== true) errors.push('producer reports must be withheld');
  if (manifest.evidence_budget?.producer_verdicts_withheld !== true) errors.push('producer verdicts must be withheld');
  return errors;
}

export function criticPacketForCase(item) {
  return {
    case_id: item.case_id,
    before_filename: item.neutral_before_filename,
    after_filename: item.neutral_after_filename,
    brief: item.brief,
    pass_goal: item.pass_goal,
    preservation_constraints: item.preservation_constraints,
  };
}

export function labeledCaseIds(manifest, humanFile) {
  const refs = humanFile?.references ?? {};
  return (manifest.cases ?? [])
    .filter(item => refs[item.case_id] && refs[item.case_id].status === 'complete')
    .map(item => item.case_id);
}

export function pendingCaseIds(manifest, humanFile) {
  const labeled = new Set(labeledCaseIds(manifest, humanFile));
  return (manifest.cases ?? []).map(item => item.case_id).filter(id => !labeled.has(id));
}

export function buildRunnableEvaluationPlan(manifest, humanFile) {
  const labeled = new Set(labeledCaseIds(manifest, humanFile));
  const canonical = new Map((manifest.cases ?? []).map(item => [item.case_id, item]));
  const repeats = new Map((manifest.repeats ?? []).map(item => [item.evaluation_id, item.case_id]));
  const build = (mode) => (manifest.orders?.[mode] ?? [])
    .map(evaluationId => {
      const caseId = repeats.get(evaluationId) ?? evaluationId;
      if (!labeled.has(caseId)) return null;
      const item = canonical.get(caseId);
      return item ? { evaluation_id: evaluationId, mode, packet: criticPacketForCase(item) } : null;
    })
    .filter(Boolean);
  return { baseline: build('baseline'), critic: build('critic') };
}

function requireCompletedReferences(manifest, humanFile) {
  const pending = pendingCaseIds(manifest, humanFile);
  if (pending.length) {
    throw new Error(`human references incomplete; pending: ${pending.join(', ')}`);
  }
  return humanFile.references;
}

function normalizeDecision(value) {
  return ['finding', 'no_finding', 'abstain'].includes(value) ? value : 'abstain';
}

function scoreMode(manifest, references, results, mode) {
  const rows = results?.[mode] ?? [];
  let trueDetections = 0;
  let falseAlarms = 0;
  let abstentions = 0;
  let appropriateAbstentions = 0;
  let usefulnessMatches = 0;
  let usefulnessEligible = 0;
  let latencyMs = 0;
  let latencyCount = 0;
  for (const row of rows) {
    const reference = references[row.case_id];
    if (!reference) continue;
    const decision = normalizeDecision(row.decision);
    if (decision === 'finding' && reference.finding_expected === true) trueDetections++;
    if (decision === 'finding' && reference.finding_expected === false) falseAlarms++;
    if (decision === 'abstain') {
      abstentions++;
      if (reference.ambiguity_expected === true) appropriateAbstentions++;
    }
    if (reference.useful_action && row.suggested_action) {
      usefulnessEligible++;
      if (reference.useful_action === row.suggested_action) usefulnessMatches++;
    }
    if (Number.isFinite(row.latency_ms)) {
      latencyMs += row.latency_ms;
      latencyCount++;
    }
  }
  return {
    evaluated: rows.length,
    true_detections: trueDetections,
    false_alarms: falseAlarms,
    abstentions,
    appropriate_abstentions: appropriateAbstentions,
    usefulness: {
      action_matches: usefulnessMatches,
      eligible: usefulnessEligible
    },
    latency: {
      total_ms: latencyMs,
      mean_ms: latencyCount ? latencyMs / latencyCount : null
    }
  };
}

export function scoreCompletedCalibration(manifest, humanFile, resultsFile) {
  const references = requireCompletedReferences(manifest, humanFile);
  return {
    baseline: scoreMode(manifest, references, resultsFile, 'baseline'),
    critic: scoreMode(manifest, references, resultsFile, 'critic')
  };
}

function usage() {
  process.stderr.write([
    'Usage:',
    '  node scripts/task8a-calibration.mjs validate [manifest.json]',
    '  node scripts/task8a-calibration.mjs labels <human-reference.json> [manifest.json]',
    '  node scripts/task8a-calibration.mjs plan <human-reference.json> [manifest.json]',
    '  node scripts/task8a-calibration.mjs score <human-reference.json> <results.json> [manifest.json]',
    '',
    'This harness never invokes a critic or Photoshop. plan emits only already-human-labeled cases.'
  ].join('\n') + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const manifestPath = path.resolve(args.at(-1)?.endsWith('.json') && command !== 'score' && args.length > 1
    ? args.at(-1)
    : DEFAULT_MANIFEST);
  const manifest = readJson(manifestPath);
  if (command === 'validate') {
    const errors = validateManifest(manifest);
    process.stdout.write(JSON.stringify({ ok: errors.length === 0, errors }, null, 2) + '\n');
    process.exitCode = errors.length ? 1 : 0;
  } else if (command === 'labels') {
    if (!args[0]) { usage(); process.exitCode = 2; }
    else {
      const human = readJson(path.resolve(args[0]));
      process.stdout.write(JSON.stringify({
        valid_human_labels: labeledCaseIds(manifest, human),
        pending_user_labels: pendingCaseIds(manifest, human)
      }, null, 2) + '\n');
    }
  } else if (command === 'plan') {
    if (!args[0]) { usage(); process.exitCode = 2; }
    else {
      const human = readJson(path.resolve(args[0]));
      process.stdout.write(JSON.stringify(buildRunnableEvaluationPlan(manifest, human), null, 2) + '\n');
    }
  } else if (command === 'score') {
    if (!args[0] || !args[1]) { usage(); process.exitCode = 2; }
    else {
      const human = readJson(path.resolve(args[0]));
      const results = readJson(path.resolve(args[1]));
      process.stdout.write(JSON.stringify(scoreCompletedCalibration(manifest, human, results), null, 2) + '\n');
    }
  } else {
    usage();
    process.exitCode = 2;
  }
}
