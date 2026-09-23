import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PreviewBarriers } from '../src/core/preview-barriers.js';
const dirs: string[] = [];
function temp() { const p = mkdtempSync(join(tmpdir(), 'ps-barrier-')); dirs.push(p); return p; }
afterEach(() => { for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true }); });
describe('durable preview barrier', () => {
  it('survives a fresh server instance, including an interrupted mutation', () => {
    const dir = temp();
    new PreviewBarriers(dir).set(42, {
      planId: 'one',
      operationId: 'guard-one',
      operationSequence: 7,
      requiresExternalPreview: true,
    });
    const interrupted = new PreviewBarriers(dir).get(42);
    expect(interrupted?.requiresExternalPreview).toBe(true);
    expect(interrupted?.operationId).toBe('guard-one');
    expect(interrupted?.operationSequence).toBe(7);
    new PreviewBarriers(dir).set(42, {
      planId: 'one',
      operationId: 'guard-one',
      operationSequence: 7,
      requiresExternalPreview: false,
      sha256: 'abc',
    });
    const classified = new PreviewBarriers(dir).get(42);
    expect(classified?.sha256).toBe('abc');
    expect(classified?.operationId).toBe('guard-one');
    new PreviewBarriers(dir).delete(42);
    expect(new PreviewBarriers(dir).get(42)).toBeUndefined();
  });
  it('fails closed on corrupt disk state', () => {
    const dir = temp();
    writeFileSync(join(dir, '42.json'), '{}');
    expect(() => new PreviewBarriers(dir).get(42)).toThrow('Invalid preview barrier');
  });
});
