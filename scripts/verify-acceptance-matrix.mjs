import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MATRIX = join(ROOT, 'docs', 'roadmap-final-acceptance-matrix.md');
const VITEST_CONFIG = join(ROOT, 'vitest.config.ts');

function toPosix(value) {
  return value.split(sep).join('/');
}

function collectTests(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) collectTests(full, acc);
    else if (name.endsWith('.test.ts')) acc.push(toPosix(relative(ROOT, full)));
  }
  return acc;
}

const matrix = readFileSync(MATRIX, 'utf8');
const cited = [
  ...new Set([...matrix.matchAll(/[A-Za-z0-9._/-]+\.test\.ts/g)].map((match) => match[0])),
].sort();
const tests = [...collectTests(join(ROOT, 'src')), ...collectTests(join(ROOT, 'tests'))].sort();
const byBasename = new Map();

for (const file of tests) {
  const basename = file.slice(file.lastIndexOf('/') + 1);
  const matches = byBasename.get(basename) ?? [];
  matches.push(file);
  byBasename.set(basename, matches);
}

const problems = [];
for (const citation of cited) {
  if (citation.includes('/')) {
    if (!tests.includes(citation)) problems.push(`matrix cites missing/non-Vitest test ${citation}`);
    continue;
  }

  const matches = byBasename.get(citation) ?? [];
  if (matches.length === 0) problems.push(`matrix cites missing test ${citation}`);
  if (matches.length > 1) {
    problems.push(`matrix test citation ${citation} is ambiguous: ${matches.join(', ')}`);
  }
}

const config = readFileSync(VITEST_CONFIG, 'utf8');
if (!config.includes("include: ['src/**/*.test.ts', 'tests/**/*.test.ts']")) {
  problems.push('vitest.config.ts must include all source test families under src/** and tests/**');
}
if (!config.includes("exclude: ['dist/**', 'node_modules/**']")) {
  problems.push('vitest.config.ts must exclude dist/** and node_modules/**');
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const acceptance = String(pkg.scripts?.['test:acceptance'] ?? '');
if (!acceptance.includes('vitest run') || /\.test\.ts/.test(acceptance)) {
  problems.push(
    'test:acceptance must run source-wide Vitest discovery rather than a hand-maintained test-file list'
  );
}

if (problems.length) {
  throw new Error(
    `Acceptance-matrix coverage drift:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`
  );
}

console.log(
  `acceptance matrix coverage ok — ${cited.length} cited test names resolve inside ${tests.length} source Vitest files`
);
