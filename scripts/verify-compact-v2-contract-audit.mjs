import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const auditFile = path.join(root, 'docs', 'compact-v2-contract-audit.md');
const audit = fs.readFileSync(auditFile, 'utf8');

const requiredHeadings = [
  '## 1. State-transition table',
  '## 2. Round-trip ledger',
  '## 3. Schema ownership matrix',
  '## 4. Exact deletion / migration manifest',
  '## 5. Artist/Planner → Compiler → Guard → Critic ownership matrix',
  '## 6. Capability-snapshot contract',
  '## 7. Top blockers ordered by first/next meaningful-paint impact',
  '## 8. Executable regression scenarios',
  '## 9. Stale instruction audit',
  '## 10. 13b acceptance status',
];

const missingHeadings = requiredHeadings.filter((heading) => !audit.includes(heading));
if (missingHeadings.length) {
  throw new Error(`compact-v2 audit missing required sections: ${missingHeadings.join(', ')}`);
}

const requiredTerms = [
  '`next_pass`',
  '`next_operation`',
  '`previous_report`',
  '`previous_operation_ack`',
  '`previous_visual_verdict`',
  '`photoshop_guard_report`',
  '`photoshop_guard_ack_operation`',
  '`photoshop_guard_verdict`',
  '`execution_outcome`',
  '`artistic_outcome`',
  '`global_brief_outcome`',
  '`strategy_signature`',
  '`comparison_metric`',
  '`PersistentMcpClient`',
  '`photoshop-session.mjs`',
  '`legacy_contract_removed`',
  '`uxp_bridge_unavailable`',
];

const missingTerms = requiredTerms.filter((term) => !audit.includes(term));
if (missingTerms.length) {
  throw new Error(`compact-v2 audit lost required deletion/migration references: ${missingTerms.join(', ')}`);
}

if (!/13b[^\n]{0,120}(behavior accepted|required audit artifacts and behavior gates are now accepted)/i.test(audit)) {
  throw new Error('compact-v2 audit must explicitly state the current 13b behavior acceptance');
}

const instructionFiles = [
  'AGENTS.md',
  'README.md',
  'docs/architecture.md',
  'docs/available-tools.md',
  'docs/development.md',
  'docs/digital-painting-agent-skill.md',
  'docs/digital-painting.md',
  'docs/photoshop-guard-architecture.md',
  'docs/prompt-layer.md',
  'docs/painting-policy/foundations.md',
  'docs/painting-policy/operations.md',
  'docs/painting-policy/optimization-audit.md',
  'docs/uxp-migration-inventory.md',
  'src/prompts/instructions.ts',
  'src/prompts/templates/digital-painting-control.ts',
];

const removedPublicTokens = [
  /\bnext_operation\b/,
  /\bprevious_report(?:_ack)?\b/,
  /\bprevious_operation_ack\b/,
  /\bprevious_visual_verdict\b/,
  /\bphotoshop_guard_cycle_start\b/,
  /\bphotoshop_guard_report\b/,
  /\bphotoshop_guard_ack_operation\b/,
  /\bphotoshop_guard_verdict\b/,
  /\blegacy full contract\b/i,
  /\bfull Guard contract\b/i,
];

const staleCurrentCounts = [
  /\b(?:146|149)\s+tools?\b/i,
  /\b(?:146|149)-tool\b/i,
  /\b(?:146|149)\s+total\b/i,
  /\b(?:14|15)\s+public Guard tools?\b/i,
  /\b(?:14|15)\s+Guard tools?\b/i,
];

const forbiddenRecommendations = [
  /(?:use|call|send)\s+`?next_operation`?\s+(?:for|as)\s+(?:the\s+)?normal/i,
  /(?:use|call)\s+`?photoshop_guard_report`?\s+(?:for|as)\s+(?:the\s+)?normal/i,
  /(?:use|call)\s+`?photoshop_guard_ack_operation`?\s+(?:for|as)\s+(?:the\s+)?normal/i,
  /(?:use|call)\s+`?photoshop_guard_verdict`?\s+(?:for|as)\s+(?:the\s+)?normal/i,
];

const violations = [];
for (const relative of instructionFiles) {
  const text = fs.readFileSync(path.join(root, relative), 'utf8');
  for (const pattern of removedPublicTokens) {
    if (pattern.test(text)) violations.push(`${relative}: removed public token ${pattern}`);
  }
  for (const pattern of staleCurrentCounts) {
    if (pattern.test(text)) violations.push(`${relative}: stale public catalog count ${pattern}`);
  }
  for (const pattern of forbiddenRecommendations) {
    if (pattern.test(text)) violations.push(`${relative}: ${pattern}`);
  }
}

if (violations.length) {
  throw new Error(`maintained public compact-v2 surfaces regressed:\n${violations.join('\n')}`);
}

console.log('OK: compact-v2 13b audit artifact is structurally complete and current behavior acceptance is recorded.');
