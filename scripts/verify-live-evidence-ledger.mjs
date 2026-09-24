import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = join(ROOT, 'docs', 'live-evidence-ledger.json');
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const problems = [];

if (ledger.schema !== 'photoshop-mcp.live-evidence-ledger.v1') {
  problems.push('unexpected or missing ledger schema');
}
if (!Array.isArray(ledger.entries) || ledger.entries.length === 0) {
  problems.push('ledger entries must be a non-empty array');
}

const seen = new Set();
for (const entry of ledger.entries ?? []) {
  if (typeof entry.path !== 'string' || !entry.path.length) {
    problems.push('entry path must be a non-empty string');
    continue;
  }
  if (seen.has(entry.path)) problems.push(`duplicate ledger path: ${entry.path}`);
  seen.add(entry.path);

  if (
    !entry.path.startsWith('.photoshop-runtime/') &&
    !entry.path.startsWith('processes/')
  ) {
    problems.push(`evidence path must stay under ignored runtime/process storage: ${entry.path}`);
  }
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) {
    problems.push(`invalid byte count for ${entry.path}`);
  }
  if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    problems.push(`invalid SHA-256 for ${entry.path}`);
  }
  if (!Array.isArray(entry.claims) || entry.claims.length === 0) {
    problems.push(`missing claim mapping for ${entry.path}`);
  }

  const localPath = join(ROOT, entry.path);
  if (existsSync(localPath)) {
    const bytes = statSync(localPath).size;
    const sha256 = createHash('sha256').update(readFileSync(localPath)).digest('hex');
    if (bytes !== entry.bytes) {
      problems.push(`local evidence byte count changed for ${entry.path}: ${bytes} != ${entry.bytes}`);
    }
    if (sha256 !== entry.sha256) {
      problems.push(`local evidence SHA-256 changed for ${entry.path}: ${sha256} != ${entry.sha256}`);
    }
  }
}

if (problems.length) {
  throw new Error(`Live-evidence ledger verification failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
}

console.log(
  `live evidence ledger ok — ${ledger.entries.length} hashed runtime/process artifacts accounted for`
);
