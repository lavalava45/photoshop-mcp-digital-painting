import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();

describe('full UXP migration completeness', () => {
  it('has zero pending P1/P2/P3 catalog tools in the generated inventory', async () => {
    const inventory = await readFile(join(ROOT, 'docs', 'uxp-migration-inventory.md'), 'utf8');
    expect(inventory).not.toContain('UXP migration pending');
    for (const tier of ['P1', 'P2', 'P3']) {
      expect(inventory).toMatch(new RegExp(`### Remaining non-UXP ${tier} catalog tools\\s+\\n\\s*- None\\.`));
    }
  });

  it('keeps the source and UXP plugin bridge revisions identical', async () => {
    const protocol = await readFile(join(ROOT, 'src', 'core', 'guard', 'protocol-version.ts'), 'utf8');
    const plugin = await readFile(join(ROOT, 'uxp-plugin', 'main.js'), 'utf8');
    const sourceRevision = protocol.match(/UXP_BRIDGE_REVISION = '([^']+)'/)?.[1];
    const pluginRevision = plugin.match(/BRIDGE_REVISION = '([^']+)'/)?.[1];
    expect(sourceRevision).toBeTruthy();
    expect(pluginRevision).toBe(sourceRevision);
  });

  it('wires every phased UXP dispatcher into the live plugin command handler', async () => {
    const plugin = await readFile(join(ROOT, 'uxp-plugin', 'main.js'), 'utf8');
    const modules = [
      'p1-document-ops',
      'p1-selection-ops',
      'p1-layer-ops',
      'p2-adjustment-ops',
      'p2-filter-ops',
      'p2-text-export-ops',
      'p3-utility-ops',
      'p3-document-data-ops',
      'p3-layer-advanced-ops',
    ];
    for (const moduleName of modules) {
      expect(plugin).toContain(`require('./${moduleName}')`);
    }
  });

  it('has no stale production-tool guard that disables the pre-dispatch legacy fallback', async () => {
    const toolsDir = join(ROOT, 'src', 'tools');
    const names = (await readdir(toolsDir)).filter((name) => name.endsWith('-tools.ts'));
    const forbidden = [
      'legacy ExtendScript/COM fallback is disabled',
      'fallback is disabled',
      'requires the UXP backend; legacy',
    ];
    for (const name of names) {
      const source = await readFile(join(toolsDir, name), 'utf8');
      for (const pattern of forbidden) expect(source).not.toContain(pattern);
    }
  });
});
