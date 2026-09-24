/**
 * Fail if any doc reports a tool count that no longer matches the source.
 *
 * The numbers in README/docs are written by hand. This script derives the
 * authoritative count directly from src/core/server.ts and src/tools/** using
 * the TypeScript compiler API, so documentation checks do not depend on any
 * marketing-site build artifacts.
 *
 * Run: npm run verify:tool-counts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { PHOTOSHOP_PROMPT_TEMPLATES } from '../src/prompts/registry.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS_DIR = join(ROOT, 'src', 'tools');

const FILES = [
  'AGENTS.md',
  'package.json',
  'README.md',
  'llms.txt',
  'docs/architecture.md',
  'docs/available-tools.md',
  'docs/development.md',
  'docs/photoshop-guard-architecture.md',
  'docs/painting-policy/foundations.md',
  'docs/prompt-layer.md',
  'docs/uxp-migration-inventory.md',
  'server.json',
];

function listToolSourceFiles(): string[] {
  const files = [join(ROOT, 'src', 'core', 'server.ts')];
  for (const name of readdirSync(TOOLS_DIR)) {
    if (name.endsWith('-tools.ts')) files.push(join(TOOLS_DIR, name));
  }
  const recipes = join(TOOLS_DIR, 'recipes');
  if (existsSync(recipes)) {
    for (const name of readdirSync(recipes)) {
      if (name.endsWith('.ts') && name !== 'index.ts' && !name.startsWith('_')) {
        files.push(join(recipes, name));
      }
    }
  }
  return files;
}

function propertyValue(node: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined {
  for (const item of node.properties) {
    if (!ts.isPropertyAssignment(item)) continue;
    const name = item.name;
    const text = ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : '';
    if (text === key) return item.initializer;
  }
  return undefined;
}

function collectStringConsts(source: ts.SourceFile): Map<string, string> {
  const values = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))
    ) {
      values.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
}

function literalString(node: ts.Expression | undefined, consts: Map<string, string>): string {
  if (!node) return '';
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node)) return consts.get(node.text) ?? '';
  return '';
}

function getToolCounts(): { total: number; atomic: number; recipes: number; guard: number } {
  const names = new Set<string>();
  for (const file of listToolSourceFiles()) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const consts = collectStringConsts(source);
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const name = literalString(propertyValue(node, 'name'), consts);
        if (name.startsWith('photoshop_') && propertyValue(node, 'description')) names.add(name);
      }
      // A few schema-identical tool definitions are generated through a small
      // local helper rather than repeated object literals. Count their literal
      // names too so this static verifier continues to match tools/list.
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'cycleTool'
      ) {
        const name = literalString(node.arguments[0], consts);
        if (name.startsWith('photoshop_')) names.add(name);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const recipes = [...names].filter((name) => name.startsWith('photoshop_recipe_')).length;
  const guard = [...names].filter((name) => name.startsWith('photoshop_guard_')).length;
  return { total: names.size, atomic: names.size - recipes, recipes, guard };
}

function main(): void {
  const data = getToolCounts();

  const allowed = new Set([data.total, data.atomic, data.recipes]);
  const problems: string[] = [];

  // Counts as written in prose: "124 tools", "108 atomic", "16 recipe workflows".
  // Deliberately narrow so test-run tallies and image widths are not flagged.
  const COUNT = /\b(\d{2,3})\s+(?:total\s+)?(?:atomic|recipe|tools?\b)/gi;
  // The compact-v2 cutover retired the old 146/149 catalog totals. Catch those
  // parenthetical forms without treating unrelated test/prompt totals as tool counts.
  const STALE_TOTAL = /\b(146|149)\s+total\b/gi;
  const GUARD_COUNT = /\b(\d{1,3})\s+(?:public\s+)?(?:embedded\s+)?Guard tools?\b/gi;
  const PROMPT_COUNT = /\b(\d{1,3})\s+(?:MCP\s+)?prompt templates?\b|\b(\d{1,3})\s+MCP prompts?\b/gi;
  const promptCount = PHOTOSHOP_PROMPT_TEMPLATES.length;

  for (const file of FILES) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const match of [...line.matchAll(COUNT), ...line.matchAll(STALE_TOTAL)]) {
        const n = Number(match[1]);
        if (allowed.has(n)) continue;
        problems.push(
          `${file}:${i + 1} reports ${n} — expected ${data.total}/${data.atomic}/${data.recipes}\n    ${line.trim()}`,
        );
      }
      for (const match of line.matchAll(GUARD_COUNT)) {
        const n = Number(match[1]);
        if (n !== data.guard) {
          problems.push(
            `${file}:${i + 1} reports ${n} Guard tools — expected ${data.guard}\n    ${line.trim()}`
          );
        }
      }
      for (const match of line.matchAll(PROMPT_COUNT)) {
        const n = Number(match[1] ?? match[2]);
        if (n !== promptCount) {
          problems.push(
            `${file}:${i + 1} reports ${n} MCP prompt templates — expected ${promptCount}\n    ${line.trim()}`
          );
        }
      }
    });
  }

  if (problems.length) {
    console.error(
      `Tool counts are out of date (source of truth: ${data.total} total = ${data.atomic} atomic + ${data.recipes} recipes)\n`,
    );
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }

  console.log(
    `catalog counts consistent: ${data.total} = ${data.atomic} atomic + ${data.recipes} recipes; ` +
      `${data.guard} Guard tools; ${promptCount} MCP prompt templates`
  );
}

main();
